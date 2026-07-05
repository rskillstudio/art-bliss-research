#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mindMakinaRoot = process.env.MIND_MAKINA_ROOT
  ?? join(root, "..", "..", "Mind Makina");

function run(cmd: string, args: string[], env?: Record<string, string>): number {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });
  return r.status ?? 1;
}

function main(): void {
  const siteUrl = process.env.ARTBLISS_SITE_URL ?? "https://mindmakina.com/artbliss-deck";
  console.log("Refreshing exports + site/...");
  if (run("npm", ["run", "run"], { ARTBLISS_SITE_URL: siteUrl }) !== 0) process.exit(1);
  if (run("npm", ["run", "copy:site"], { MIND_MAKINA_ROOT: mindMakinaRoot }) !== 0) process.exit(1);
  console.log(`\nCopied to ${mindMakinaRoot}/artbliss-deck`);
  console.log("Push Mind Makina to deploy: https://mindmakina.com/artbliss-deck\n");
}

main();
