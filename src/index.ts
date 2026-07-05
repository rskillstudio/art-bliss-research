#!/usr/bin/env node
import { runAllScrapers } from "./scrapers/index.js";
import {
  calculateOccupancyMetrics,
  persistScraperResults,
  loadStoredScraperResults,
} from "./engine/occupancy.js";
import {
  buildSegmentationReport,
  printSummary,
  writeCsv,
  writeJsonReport,
} from "./reports/segmentation.js";
import {
  printDeckComparisonSummary,
  writeDeckComparisonReport,
} from "./reports/deck-comparison.js";
import { writeInvestorDeck } from "./reports/investor-deck.js";
import { writeVajraEmail } from "./reports/vajra-email.js";
import { publishSite } from "./reports/site-publisher.js";
import { generateDeckPdf } from "./reports/generate-deck-pdf.js";

const SITE_URL = process.env.ARTBLISS_SITE_URL ?? "https://mindmakina.com/artbliss-deck";
const command = process.argv[2] ?? "all";

async function scrape() {
  console.log("Running scrapers (Tier A primary + Tier B visitor fill)...");
  const results = await runAllScrapers();
  const count = persistScraperResults(results);
  console.log(`Persisted ${count} snapshot rows.`);
  return results;
}

async function analyzeFromStore() {
  const results = loadStoredScraperResults();
  if (results.length === 0) {
    return analyze();
  }
  const tierA = calculateOccupancyMetrics(results, "A");
  const tierB = calculateOccupancyMetrics(results, "B");
  return { tierA, tierB, results };
}

async function analyze(results?: Awaited<ReturnType<typeof runAllScrapers>>) {
  const data = results ?? (await runAllScrapers());
  const tierA = calculateOccupancyMetrics(data, "A");
  const tierB = calculateOccupancyMetrics(data, "B");
  return { tierA, tierB, results: data };
}

async function report(results?: Awaited<ReturnType<typeof runAllScrapers>>) {
  const { tierA, tierB } = results
    ? await (async () => ({ tierA: calculateOccupancyMetrics(results, "A"), tierB: calculateOccupancyMetrics(results, "B") }))()
    : await analyzeFromStore();
  const segmentation = buildSegmentationReport(tierA, tierB);

  writeCsv(tierA, "occupancy-tier-a-primary.csv");
  writeCsv(tierB, "occupancy-tier-b-extended.csv");
  writeCsv([...tierA, ...tierB], "occupancy-all.csv");
  writeJsonReport(segmentation, "visitor-segmentation.json");

  const comparison = writeDeckComparisonReport(tierA, tierB, segmentation);
  writeInvestorDeck(tierA, tierB, segmentation, comparison);
  writeVajraEmail(comparison, SITE_URL);
  publishSite(comparison, SITE_URL);
  await generateDeckPdf().catch((err) => console.warn("  PDF generation failed:", err.message));

  printSummary(segmentation, tierA);
  printDeckComparisonSummary(comparison);
  console.log("Exports written to data/exports/");
  console.log("Site published to site/ — see site/DEPLOY.md");
}

async function main() {
  switch (command) {
    case "scrape":
      await scrape();
      break;
    case "analyze": {
      const { tierA, tierB } = await analyzeFromStore();
      console.log("Tier A:", tierA);
      console.log("Tier B:", tierB);
      break;
    }
    case "report":
      await report();
      break;
    case "publish-site":
      await report();
      break;
    case "all":
    default: {
      const results = await scrape();
      await report(results);
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
