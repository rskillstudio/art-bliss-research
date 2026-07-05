#!/usr/bin/env node
/**
 * Deploy site/ to DigitalOcean Spaces (S3-compatible) + optional CDN via doctl.
 *
 * Required env:
 *   SPACES_ACCESS_KEY_ID
 *   SPACES_SECRET_ACCESS_KEY
 *   SPACES_BUCKET (default: artbliss-deck)
 *   SPACES_REGION (default: sfo3)
 *
 * Optional:
 *   SPACES_PREFIX (default: "" — use "artbliss-deck" for path-style on shared bucket)
 *   DIGITALOCEAN_ACCESS_TOKEN — for doctl CDN + bucket CORS via API
 *   CDN_DOMAIN — e.g. artbliss-deck.mindmakina.com
 */
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(root, "site");

const REGION = process.env.SPACES_REGION ?? "sfo3";
const BUCKET = process.env.SPACES_BUCKET ?? "artbliss-deck";
const PREFIX = (process.env.SPACES_PREFIX ?? "").replace(/^\/|\/$/g, "");
const ENDPOINT = process.env.SPACES_ENDPOINT ?? `https://${REGION}.digitaloceanspaces.com`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function objectKey(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  return PREFIX ? `${PREFIX}/${normalized}` : normalized;
}

function publicUrl(key: string): string {
  if (process.env.CDN_DOMAIN) {
    return `https://${process.env.CDN_DOMAIN}/${key.replace(/^artbliss-deck\//, "")}`;
  }
  return `https://${BUCKET}.${REGION}.digitaloceanspaces.com/${key}`;
}

async function ensureBucket(client: S3Client): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log(`Bucket exists: ${BUCKET}`);
  } catch {
    console.log(`Creating bucket: ${BUCKET} (${REGION})`);
    await client.send(
      new CreateBucketCommand({
        Bucket: BUCKET,
        ACL: "public-read",
      })
    );
  }
}

async function uploadSite(client: S3Client): Promise<string[]> {
  const files = walk(siteDir);
  const urls: string[] = [];

  for (const file of files) {
    const rel = relative(siteDir, file);
    const key = objectKey(rel);
    const ext = rel.slice(rel.lastIndexOf("."));
    const contentType = MIME[ext] ?? "application/octet-stream";

    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: createReadStream(file),
        ACL: "public-read",
        ContentType: contentType,
        CacheControl: ext === ".html" ? "public, max-age=300" : "public, max-age=3600",
      })
    );
    const url = publicUrl(key);
    urls.push(url);
    console.log(`  ↑ ${key}`);
  }
  return urls;
}

function runPublishSite(): void {
  console.log("Refreshing site/ from latest exports...");
  const r = spawnSync("npm", ["run", "publish-site"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) {
    throw new Error("publish-site failed");
  }
}

function tryCdnSetup(): void {
  const token = process.env.DIGITALOCEAN_ACCESS_TOKEN;
  const domain = process.env.CDN_DOMAIN;
  if (!token || !domain) return;

  const origin = `${BUCKET}.${REGION}.digitaloceanspaces.com`;
  console.log(`\nConfiguring CDN for ${domain} → ${origin}...`);
  const r = spawnSync(
    "doctl",
    [
      "compute",
      "cdn",
      "create",
      "--domain",
      domain,
      "--origin",
      origin,
      "--access-token",
      token,
    ],
    { stdio: "inherit" }
  );
  if (r.status === 0) {
    console.log(`CDN live: https://${domain}`);
  } else {
    console.warn("CDN setup skipped or failed — configure manually in DO control panel.");
  }
}

async function main(): Promise<void> {
  const keyId = process.env.SPACES_ACCESS_KEY_ID;
  const secret = process.env.SPACES_SECRET_ACCESS_KEY;

  if (!existsSync(siteDir)) {
    runPublishSite();
  }

  if (!keyId || !secret) {
    console.error(`
Missing Spaces credentials. Create a Spaces access key in DigitalOcean:
  Control Panel → API → Spaces access keys → Generate new key

Then run:
  export SPACES_ACCESS_KEY_ID="your-key"
  export SPACES_SECRET_ACCESS_KEY="your-secret"
  export SPACES_BUCKET="artbliss-deck"
  export SPACES_REGION="sfo3"
  npm run deploy:do

Optional custom domain:
  export DIGITALOCEAN_ACCESS_TOKEN="your-pat"
  export CDN_DOMAIN="artbliss-deck.mindmakina.com"
`);
    process.exit(1);
  }

  if (process.argv.includes("--refresh")) {
    runPublishSite();
  }

  const client = new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
    forcePathStyle: false,
  });

  await ensureBucket(client);
  console.log(`Uploading ${siteDir} → s3://${BUCKET}/${PREFIX ? PREFIX + "/" : ""}`);
  const urls = await uploadSite(client);

  const indexKey = objectKey("index.html");
  const deckKey = objectKey("deck.html");
  console.log("\n=== Deployed to DigitalOcean Spaces ===");
  console.log(`Dashboard:  ${publicUrl(indexKey)}`);
  console.log(`Investor deck: ${publicUrl(deckKey)}`);
  console.log(`Data JSON:  ${publicUrl(objectKey("data.json"))}`);

  tryCdnSetup();

  if (process.env.ARTBLISS_SITE_URL) {
    console.log(`\nSet ARTBLISS_SITE_URL=${publicUrl("").replace(/\/$/, "")} before publish for correct email links.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
