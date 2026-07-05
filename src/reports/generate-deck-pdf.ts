import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultHtml = join(root, "site", "deck.html");
const defaultPdf = join(root, "site", "artbliss-investor-deck.pdf");

export async function generateDeckPdf(options?: {
  htmlPath?: string;
  outputPath?: string;
}): Promise<boolean> {
  const htmlPath = options?.htmlPath ?? defaultHtml;
  const outputPath = options?.outputPath ?? defaultPdf;

  if (!existsSync(htmlPath)) {
    console.warn(`  Skipped PDF — deck HTML not found: ${htmlPath}`);
    return false;
  }

  let puppeteer: typeof import("puppeteer");
  try {
    puppeteer = await import("puppeteer");
  } catch {
    console.warn("  Skipped PDF — install puppeteer: npm install");
    return false;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });

  try {
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.goto(pathToFileURL(resolve(htmlPath)).href, {
      waitUntil: "networkidle0",
      timeout: 90_000,
    });
    await page.evaluate(() => document.fonts.ready);

    await page.pdf({
      path: outputPath,
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    const rel = outputPath.startsWith(root) ? outputPath.slice(root.length + 1) : outputPath;
    console.log(`  Generated: ${rel}`);
    return true;
  } finally {
    await browser.close();
  }
}
