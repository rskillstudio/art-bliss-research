import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CategoryMetrics, SegmentationReport } from "../types.js";
import { loadConfig } from "../config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const exportsDir = join(root, "data", "exports");

function ensureExportsDir() {
  mkdirSync(exportsDir, { recursive: true });
}

/** Missing Data Solver: isolate Day Tripper residual from 2.9M baseline */
export function buildSegmentationReport(
  tierAMetrics: CategoryMetrics[],
  tierBMetrics: CategoryMetrics[]
): SegmentationReport {
  const { geo, underwriting } = loadConfig();
  const baseline = geo.annual_visitor_baseline;
  const timestamp = new Date().toISOString();

  const allMetrics = [...tierAMetrics, ...tierBMetrics];
  const byCategory = new Map<string, number>();

  for (const m of allMetrics) {
    byCategory.set(m.lodging_category, (byCategory.get(m.lodging_category) ?? 0) + m.implied_visitor_count);
  }

  const segments = [
    ...tierAMetrics.map((m) => ({
      category: m.lodging_category,
      geo_tier: "A" as const,
      implied_annual_visitors: m.implied_visitor_count,
      share_of_baseline_pct: Math.round((m.implied_visitor_count / baseline) * 1000) / 10,
    })),
    ...tierBMetrics.map((m) => ({
      category: m.lodging_category,
      geo_tier: "B" as const,
      implied_annual_visitors: m.implied_visitor_count,
      share_of_baseline_pct: Math.round((m.implied_visitor_count / baseline) * 1000) / 10,
    })),
  ];

  const accounted = [...byCategory.values()].reduce((a, b) => a + b, 0);
  const dayTripper = Math.max(0, baseline - accounted);

  segments.push({
    category: "DayTripper",
    geo_tier: "residual",
    implied_annual_visitors: dayTripper,
    share_of_baseline_pct: Math.round((dayTripper / baseline) * 1000) / 10,
  });

  return {
    timestamp,
    annual_visitor_baseline: baseline,
    segments,
    reconciliation: {
      accounted_visitors: accounted,
      day_tripper_residual: dayTripper,
      day_tripper_share_pct: Math.round((dayTripper / baseline) * 1000) / 10,
    },
    deck_benchmarks: {
      costar_hotel_occupancy_pct: underwriting.market_benchmarks_ttm.costar_hotel_occupancy_pct,
      airdna_adr: underwriting.market_benchmarks_ttm.airdna_adr,
      base_scenario_occupancy_pct: underwriting.scenarios.base.occupancy_pct,
      base_scenario_adr: underwriting.scenarios.base.blended_adr,
    },
  };
}

export function writeCsv(metrics: CategoryMetrics[], filename: string) {
  ensureExportsDir();
  const header = "timestamp,lodging_category,geo_tier,total_units_tracked,estimated_occupancy_rate,implied_visitor_count";
  const rows = metrics.map(
    (m) =>
      `${m.timestamp},${m.lodging_category},${m.geo_tier},${m.total_units_tracked},${m.estimated_occupancy_rate},${m.implied_visitor_count}`
  );
  writeFileSync(join(exportsDir, filename), [header, ...rows].join("\n"));
}

export function writeJsonReport(report: SegmentationReport, filename: string) {
  ensureExportsDir();
  writeFileSync(join(exportsDir, filename), JSON.stringify(report, null, 2));
}

export function printSummary(report: SegmentationReport, tierAMetrics: CategoryMetrics[]) {
  console.log("\n=== Artbliss Market Intelligence Report ===");
  console.log(`Baseline: ${report.annual_visitor_baseline.toLocaleString()} annual visitors`);
  console.log("\n--- Tier A (Primary — Stevenson comp set, deck underwriting) ---");
  for (const m of tierAMetrics) {
    console.log(
      `  ${m.lodging_category.padEnd(10)} | ${m.total_units_tracked} units | ${m.estimated_occupancy_rate}% occ | ~${m.implied_visitor_count.toLocaleString()} visitors/yr`
    );
  }
  console.log("\n--- Visitor Segmentation ---");
  for (const s of report.segments) {
    console.log(
      `  ${String(s.category).padEnd(12)} [${s.geo_tier}] ${s.implied_annual_visitors.toLocaleString().padStart(12)} (${s.share_of_baseline_pct}%)`
    );
  }
  console.log("\n--- Deck Benchmarks (TTM) ---");
  console.log(`  CoStar hotel occ: ${report.deck_benchmarks.costar_hotel_occupancy_pct}%`);
  console.log(`  AirDNA ADR: $${report.deck_benchmarks.airdna_adr}`);
  console.log(`  Base scenario: ${report.deck_benchmarks.base_scenario_occupancy_pct}% @ $${report.deck_benchmarks.base_scenario_adr}`);
  console.log(`\n  Day tripper residual: ${report.reconciliation.day_tripper_residual.toLocaleString()} (${report.reconciliation.day_tripper_share_pct}%)\n`);
}
