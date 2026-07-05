import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mindMakinaRoot =
  process.env.MIND_MAKINA_ROOT ?? join(root, "..", "..", "Mind Makina");
const targetDir = join(mindMakinaRoot, "artbliss-deck");
const siteDir = join(root, "site");

if (!existsSync(siteDir)) {
  console.error("site/ not found — run npm run publish-site first");
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
const files = ["index.html", "deck.html", "data.json", "artbliss-investor-deck.pdf"];
for (const file of files) {
  const src = join(siteDir, file);
  if (!existsSync(src)) {
    console.warn(`skip ${file} — not found in site/`);
    continue;
  }
  cpSync(src, join(targetDir, file), { force: true });
  console.log(`copied artbliss-deck/${file}`);
}
