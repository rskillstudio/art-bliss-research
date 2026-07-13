import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mindMakinaRoot =
  process.env.MIND_MAKINA_ROOT ?? join(root, "..", "..", "Mind Makina");
const targetDir = join(mindMakinaRoot, "artbliss-deck");
const siteDir = join(root, "site");

const requiredFiles = ["index.html", "deck.html", "data.json", "artbliss-investor-deck.pdf"] as const;
const pdfHref = "/artbliss-deck/artbliss-investor-deck.pdf";

if (!existsSync(siteDir)) {
  console.error("site/ not found — run npm run publish-site first");
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });

for (const file of requiredFiles) {
  const src = join(siteDir, file);
  if (!existsSync(src)) {
    console.error(`missing required site/${file} — run npm run report (or generate-pdf) first`);
    process.exit(1);
  }
  cpSync(src, join(targetDir, file), { force: true });
  console.log(`copied artbliss-deck/${file}`);
}

for (const file of ["index.html", "deck.html"] as const) {
  const html = readFileSync(join(targetDir, file), "utf-8");
  if (!html.includes(`href="${pdfHref}"`)) {
    console.error(
      `${file} missing root-absolute PDF link (${pdfHref}) — relative links break without a trailing slash`
    );
    process.exit(1);
  }
}

console.log(`smoke ok: PDF present + href="${pdfHref}" in index.html and deck.html`);
