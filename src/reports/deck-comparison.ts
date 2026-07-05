import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CategoryMetrics, SegmentationReport } from "../types.js";
import { loadConfig } from "../config.js";
import { computeSeasonalOutlook, type SeasonalOutlook } from "../engine/seasonality.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const exportsDir = join(root, "data", "exports");

export interface DeckComparisonReport {
  timestamp: string;
  source_deck: string;
  feed_status: string;
  market_benchmarks: {
    metric: string;
    deck_value: string;
    feed_value: string;
    delta: string;
    assessment: string;
  }[];
  scenario_comparison: {
    scenario: string;
    deck_occupancy_pct: number;
    deck_adr: number;
    feed_cabin_occupancy_pct: number | null;
    feed_hotel_occupancy_pct: number | null;
    occ_variance_vs_base: string;
  }[];
  comp_properties: {
    name: string;
    deck_adr: number;
    deck_rev_per_unit_66pct: number;
    feed_tier_a_cabin_occ_pct: number;
    feed_implied_rev_per_unit: number;
    adr_vs_feed_occ_note: string;
  }[];
  artbliss_portfolio: {
    phase: string;
    units: number;
    deck_room_revenue: number;
    deck_noi: number;
    feed_projected_room_revenue: number;
    feed_projected_noi: number;
    revenue_delta: number;
    revenue_delta_pct: number;
    assumptions: string;
  }[];
  visitor_segmentation: {
    baseline: number;
    deck_had_segmentation: boolean;
    feed_segments: SegmentationReport["segments"];
    day_tripper_residual: number;
    day_tripper_share_pct: number;
  };
  bridge_summary: {
    supports_underwriting: string[];
    challenges_underwriting: string[];
    data_gaps: string[];
  };
  seasonal_outlook: SeasonalOutlook;
}

interface DiscoveredComp {
  deck_name: string;
  source: string;
  adr?: number;
}

function loadDiscoveredComps(): DiscoveredComp[] {
  const p = join(root, "data", "discovered-comps.json");
  if (!existsSync(p)) return [];
  try {
    return (JSON.parse(readFileSync(p, "utf-8")) as { discovered: DiscoveredComp[] }).discovered ?? [];
  } catch {
    return [];
  }
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function pctDelta(feed: number, deck: number): string {
  const d = feed - deck;
  return `${d >= 0 ? "+" : ""}${fmt(d)} pp`;
}

function roomRevenue(units: number, occPct: number, adr: number): number {
  return units * 365 * (occPct / 100) * adr;
}

function metric(
  name: string,
  deck: string,
  feed: string,
  delta: string,
  assessment: string
) {
  return { metric: name, deck_value: deck, feed_value: feed, delta, assessment };
}

export function buildDeckComparisonReport(
  tierA: CategoryMetrics[],
  tierB: CategoryMetrics[],
  segmentation: SegmentationReport
): DeckComparisonReport {
  const { underwriting } = loadConfig();
  const uw = underwriting;
  const cabin = tierA.find((m) => m.lodging_category === "Cabin");
  const hotelA = tierA.find((m) => m.lodging_category === "Hotel");
  const hotelB = tierB.find((m) => m.lodging_category === "Hotel");

  const feedCabinOcc = cabin?.estimated_occupancy_rate ?? null;
  const feedHotelOccA = hotelA?.estimated_occupancy_rate ?? null;
  const baseAdr = uw.scenarios.base.blended_adr;
  const baseOcc = uw.scenarios.base.occupancy_pct;
  const deckNoiMargin = 0.455;

  const compRows = uw.comp_properties.map((c) => {
    const feedOcc = feedCabinOcc ?? baseOcc;
    const impliedRev = roomRevenue(1, feedOcc, c.avg_adr);
    return {
      name: c.name,
      deck_adr: c.avg_adr,
      deck_rev_per_unit_66pct: c.rev_per_unit_at_66pct,
      feed_tier_a_cabin_occ_pct: feedOcc,
      feed_implied_rev_per_unit: Math.round(impliedRev),
      adr_vs_feed_occ_note:
        feedOcc > baseOcc
          ? `Feed occ ${fmt(feedOcc)}% exceeds deck base ${baseOcc}% — rev/unit uplift vs deck @ 66%`
          : `Feed occ below deck base — conservative vs comp scrape`,
    };
  });

  const artblissIRevDeck = 329303;
  const artblissINoiDeck = 149749;
  const artblissIIRevDeck = 823258;
  const artblissIINoiDeck = 374351;

  const feedOccForProjection = feedCabinOcc ?? baseOcc;
  const artblissIRevFeed = roomRevenue(4, feedOccForProjection, baseAdr);
  const artblissIIRevFeed = roomRevenue(10, feedOccForProjection, baseAdr);

  const portfolio = [
    {
      phase: "Artbliss I (4 units, in operation)",
      units: 4,
      deck_room_revenue: artblissIRevDeck,
      deck_noi: artblissINoiDeck,
      feed_projected_room_revenue: Math.round(artblissIRevFeed),
      feed_projected_noi: Math.round(artblissIRevFeed * deckNoiMargin),
      revenue_delta: Math.round(artblissIRevFeed - artblissIRevDeck),
      revenue_delta_pct: Math.round(((artblissIRevFeed - artblissIRevDeck) / artblissIRevDeck) * 1000) / 10,
      assumptions: `Feed cabin occ ${fmt(feedOccForProjection)}% applied to deck base ADR $${baseAdr}; same 45.5% NOI margin`,
    },
    {
      phase: "Artbliss II (10 units, full buildout)",
      units: 10,
      deck_room_revenue: artblissIIRevDeck,
      deck_noi: artblissIINoiDeck,
      feed_projected_room_revenue: Math.round(artblissIIRevFeed),
      feed_projected_noi: Math.round(artblissIIRevFeed * deckNoiMargin),
      revenue_delta: Math.round(artblissIIRevFeed - artblissIIRevDeck),
      revenue_delta_pct: Math.round(((artblissIIRevFeed - artblissIIRevDeck) / artblissIIRevDeck) * 1000) / 10,
      assumptions: `Same unit economic as Artbliss I, scaled to 10 units`,
    },
  ];

  const scenarios = (["conservative", "base", "upside"] as const).map((key) => {
    const s = uw.scenarios[key];
    return {
      scenario: key.charAt(0).toUpperCase() + key.slice(1),
      deck_occupancy_pct: s.occupancy_pct,
      deck_adr: s.blended_adr,
      feed_cabin_occupancy_pct: feedCabinOcc,
      feed_hotel_occupancy_pct: feedHotelOccA,
      occ_variance_vs_base:
        feedCabinOcc != null
          ? pctDelta(feedCabinOcc, s.occupancy_pct)
          : "N/A",
    };
  });

  const marketBenchmarks = [
    metric(
      "CoStar Hotel Occupancy (Stevenson submarket)",
      `${uw.market_benchmarks_ttm.costar_hotel_occupancy_pct}%`,
      feedHotelOccA != null ? `${fmt(feedHotelOccA)}%` : "N/A",
      feedHotelOccA != null ? pctDelta(feedHotelOccA, uw.market_benchmarks_ttm.costar_hotel_occupancy_pct) : "N/A",
      feedHotelOccA != null && feedHotelOccA > uw.market_benchmarks_ttm.costar_hotel_occupancy_pct
        ? "Feed shows stronger hotel demand than CoStar TTM"
        : "Aligned or below CoStar"
    ),
    metric(
      "STR/Cabin Occupancy (live Airbnb + comp discovery)",
      `${baseOcc}% (deck AirDNA 12-listing anchor)`,
      feedCabinOcc != null ? `${fmt(feedCabinOcc)}%` : "N/A",
      feedCabinOcc != null ? pctDelta(feedCabinOcc, baseOcc) : "N/A",
      feedCabinOcc != null && feedCabinOcc > baseOcc
        ? "Feed cabin occ above deck base — upside to room revenue if sustained"
        : "At or below deck base case"
    ),
    metric(
      "ADR (deck AirDNA vs live proxy)",
      `$${uw.market_benchmarks_ttm.airdna_adr} (AirDNA TTM)`,
      `$${baseAdr} bridge ADR; see discovered-comps.json for live Airbnb comp rates`,
      "—",
      "Deck $347 anchors Artbliss revenue; Skamania etc. may have live Airbnb ADR in discovery file"
    ),
    metric(
      "AirDNA RevPAR (12-listing comp, TTM)",
      `$${uw.market_benchmarks_ttm.airdna_revpar}`,
      feedCabinOcc != null ? `$${Math.round((feedCabinOcc / 100) * baseAdr)}` : "N/A",
      feedCabinOcc != null
        ? `$${Math.round((feedCabinOcc / 100) * baseAdr - uw.market_benchmarks_ttm.airdna_revpar)}`
        : "N/A",
      "RevPAR derived from feed occ x deck ADR"
    ),
    metric(
      "Peak Season Occ (Jun–Aug, deck)",
      `${uw.seasonality.peak.occupancy_pct}%`,
      feedCabinOcc != null ? `${fmt(feedCabinOcc)}% (blended feed proxy)` : "N/A",
      "—",
      "Feed is 30-day snapshot; deck peak is 80.9%"
    ),
    metric(
      "Off-Peak Occ (Dec–Feb, deck)",
      `${uw.seasonality.off_peak.occupancy_pct}%`,
      "Not yet decomposed in feed",
      "—",
      "Requires monthly feed decomposition"
    ),
    metric(
      "Tier B Hotel Occ (Gorge extended)",
      "Not in deck (visitor fill only)",
      hotelB != null ? `${fmt(hotelB.estimated_occupancy_rate)}%` : "N/A",
      "—",
      "Extended radius for 2.9M visitor reconciliation"
    ),
  ];

  const supports: string[] = [];
  const challenges: string[] = [];
  const gaps: string[] = [];

  if (feedCabinOcc != null && feedCabinOcc >= baseOcc) {
    supports.push(
      `Tier A cabin occupancy (${fmt(feedCabinOcc)}%) meets or exceeds deck base case (${baseOcc}%) — supports Artbliss revenue thesis`
    );
  } else if (feedCabinOcc != null) {
    challenges.push(
      `Tier A cabin occupancy (${fmt(feedCabinOcc)}%) trails deck base (${baseOcc}%) — monitor before upsizing scenario`
    );
  }

  if (feedHotelOccA != null && feedHotelOccA > uw.market_benchmarks_ttm.costar_hotel_occupancy_pct) {
    supports.push(`Stevenson hotel feed (${fmt(feedHotelOccA)}%) above CoStar TTM (${uw.market_benchmarks_ttm.costar_hotel_occupancy_pct}%) — strong submarket`);
  }

  const discovered = loadDiscoveredComps();
  const liveAirbnbAdrs = discovered.filter((d) => d.source === "airbnb" && d.adr).map((d) => d.adr!);

  gaps.push(
    "Deck uses AirDNA dashboard (12 curated listings, TTM). Feed uses live Airbnb search + auto-discovered comp websites — similar market signal, not the same dataset."
  );
  gaps.push(
    "Occupancy is live from Airbnb weekly search, hotel pages, recreation.gov, and OR parks — not simulated."
  );
  gaps.push(
    liveAirbnbAdrs.length
      ? `Partial live ADR: ${liveAirbnbAdrs.length} comp(s) from Airbnb (e.g. $${liveAirbnbAdrs[0]}). Artbliss revenue bridge still uses deck $${baseAdr} ADR.`
      : `Artbliss revenue bridge uses deck $${baseAdr} ADR; no live Airbnb ADR in latest discovery run.`
  );
  gaps.push("Visitor segmentation is new vs deck — deck did not parse 2.9M into lodging buckets.");
  gaps.push(
    `Full gorge inventory counts needed to reduce ${segmentation.reconciliation.day_tripper_share_pct}% day-tripper residual.`
  );
  gaps.push("Single ~30-day snapshot — deck benchmarks are trailing twelve months.");

  if (portfolio[0].revenue_delta > 0) {
    supports.push(
      `Artbliss I projected room revenue ${fmtUsd(portfolio[0].feed_projected_room_revenue)} vs deck ${fmtUsd(portfolio[0].deck_room_revenue)} (+${portfolio[0].revenue_delta_pct}%)`
    );
  }

  const seasonalOutlook =
    feedCabinOcc != null ? computeSeasonalOutlook(feedCabinOcc) : computeSeasonalOutlook(baseOcc);

  if (seasonalOutlook.artbliss_i.feed_seasonal_noi > seasonalOutlook.artbliss_i.deck_base_noi) {
    supports.push(
      `Seasonally adjusted Artbliss I NOI ${fmtUsd(seasonalOutlook.artbliss_i.feed_seasonal_noi)} vs deck base ${fmtUsd(seasonalOutlook.artbliss_i.deck_base_noi)} — realistic annual case with peak/off-peak shape`
    );
  }

  gaps.push(
    "Seasonal case scales deck peak/shoulder/off-peak shape by live snapshot occ — not yet validated with month-by-month feed data."
  );

  return {
    timestamp: new Date().toISOString(),
    source_deck: "Roam Hospitality - Artbliss Investor Underwriting Deck (June 2026)",
    feed_status: "Live feed — Airbnb STR, auto-discovered deck comps, recreation.gov, OR parks, hotels",
    market_benchmarks: marketBenchmarks,
    scenario_comparison: scenarios,
    comp_properties: compRows,
    artbliss_portfolio: portfolio,
    visitor_segmentation: {
      baseline: segmentation.annual_visitor_baseline,
      deck_had_segmentation: false,
      feed_segments: segmentation.segments,
      day_tripper_residual: segmentation.reconciliation.day_tripper_residual,
      day_tripper_share_pct: segmentation.reconciliation.day_tripper_share_pct,
    },
    bridge_summary: {
      supports_underwriting: supports,
      challenges_underwriting: challenges,
      data_gaps: gaps,
    },
    seasonal_outlook: seasonalOutlook,
  };
}

export function renderDeckComparisonMarkdown(report: DeckComparisonReport): string {
  const lines: string[] = [
    "# Artbliss Underwriting Comparison Report",
    "",
    "**Deck:** Roam Hospitality Investor Underwriting (June 2026)  ",
    `**Feed generated:** ${report.timestamp.slice(0, 10)}  `,
    `**Feed status:** ${report.feed_status}`,
    "",
    "---",
    "",
    "## Executive Summary",
    "",
    "This report bridges the original Roam Hospitality underwriting deck against the Art Bliss Market Intelligence Engine feed. Tier A (Stevenson comp set) drives direct underwriting comparisons; Tier B fills the 2.9M annual visitor baseline.",
    "",
  ];

  if (report.bridge_summary.supports_underwriting.length) {
    lines.push("### Supports Underwriting", "");
    for (const s of report.bridge_summary.supports_underwriting) {
      lines.push(`- ${s}`);
    }
    lines.push("");
  }

  if (report.bridge_summary.challenges_underwriting.length) {
    lines.push("### Challenges / Watch Items", "");
    for (const c of report.bridge_summary.challenges_underwriting) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "## 1. Market Benchmarks — Deck vs Feed",
    "",
    "| Metric | Deck (Original) | Feed (Tier A) | Delta | Assessment |",
    "|--------|-----------------|---------------|-------|------------|"
  );

  for (const m of report.market_benchmarks) {
    lines.push(`| ${m.metric} | ${m.deck_value} | ${m.feed_value} | ${m.delta} | ${m.assessment} |`);
  }

  lines.push(
    "",
    "---",
    "",
    "## 2. Scenario Matrix — Deck Cases vs Feed Occupancy",
    "",
    "| Scenario | Deck Occ | Deck ADR | Feed Cabin Occ | Feed Hotel Occ | Occ Variance vs Deck |",
    "|----------|----------|----------|----------------|----------------|----------------------|"
  );

  for (const s of report.scenario_comparison) {
    lines.push(
      `| ${s.scenario} | ${s.deck_occupancy_pct}% | $${s.deck_adr} | ${s.feed_cabin_occupancy_pct ?? "—"}% | ${s.feed_hotel_occupancy_pct ?? "—"}% | ${s.occ_variance_vs_base} |`
    );
  }

  lines.push(
    "",
    "---",
    "",
    "## 3. Comp Properties — Deck ADR vs Feed-Implied Revenue",
    "",
    "| Property | Deck ADR | Deck Rev/Unit @ 66% | Feed Cabin Occ | Feed Implied Rev/Unit | Note |",
    "|----------|----------|---------------------|----------------|----------------------|------|"
  );

  for (const c of report.comp_properties) {
    lines.push(
      `| ${c.name} | $${c.deck_adr} | $${c.deck_rev_per_unit_66pct.toLocaleString()} | ${c.feed_tier_a_cabin_occ_pct}% | $${c.feed_implied_rev_per_unit.toLocaleString()} | ${c.adr_vs_feed_occ_note} |`
    );
  }

  lines.push(
    "",
    "---",
    "",
    "## 4. Artbliss Portfolio Impact — Deck Y1 Base vs Feed Projection",
    "",
    "| Phase | Units | Deck Room Rev | Feed Proj. Room Rev | Delta | Deck NOI | Feed Proj. NOI |",
    "|-------|-------|---------------|---------------------|-------|----------|----------------|"
  );

  for (const p of report.artbliss_portfolio) {
    lines.push(
      `| ${p.phase} | ${p.units} | $${p.deck_room_revenue.toLocaleString()} | $${p.feed_projected_room_revenue.toLocaleString()} | +${p.revenue_delta_pct}% | $${p.deck_noi.toLocaleString()} | $${p.feed_projected_noi.toLocaleString()} |`
    );
  }

  lines.push("", "*Assumptions:* " + report.artbliss_portfolio[0].assumptions, "");

  const so = report.seasonal_outlook;
  const seasonalDeltaPct =
    Math.round(
      ((so.artbliss_i.feed_seasonal_noi - so.artbliss_i.deck_base_noi) / so.artbliss_i.deck_base_noi) * 1000
    ) / 10;

  lines.push(
    "---",
    "",
    "## 5. Seasonally Adjusted Outlook — Realistic Annual Case",
    "",
    "The feed snapshot (~30 days) can overstate a full year if taken in peak season. This case applies the **deck's peak / shoulder / off-peak shape** scaled to the live snapshot occupancy, with **month-level ADR** ($361 peak / $341 shoulder / $345 off-peak).",
    "",
    "| Case | Blended Occ | Blended ADR | Artbliss I Room Rev | Artbliss I NOI |",
    "|------|------------:|------------:|--------------------:|---------------:|",
    `| Deck base (flat) | ${fmt(so.deck_annual_occ_pct)}% | $${Math.round(so.deck_annual_adr)} | $${so.artbliss_i.deck_base_room_revenue.toLocaleString()} | $${so.artbliss_i.deck_base_noi.toLocaleString()} |`,
    `| Feed snapshot (flat $347) | ${fmt(so.feed_snapshot_occ_pct)}% | $347 | $${so.artbliss_i.feed_snapshot_room_revenue.toLocaleString()} | $${so.artbliss_i.feed_snapshot_noi.toLocaleString()} |`,
    `| **Feed seasonal ← recommended** | **${fmt(so.feed_adjusted_occ_pct)}%** | **$${Math.round(so.feed_adjusted_adr)}** | **$${so.artbliss_i.feed_seasonal_room_revenue.toLocaleString()}** | **$${so.artbliss_i.feed_seasonal_noi.toLocaleString()}** |`,
    "",
    `Artbliss II (seasonal): **$${so.artbliss_ii.feed_seasonal_room_revenue.toLocaleString()}** room revenue · **$${so.artbliss_ii.feed_seasonal_noi.toLocaleString()}** NOI (${seasonalDeltaPct >= 0 ? "+" : ""}${seasonalDeltaPct}% vs deck base I).`,
    "",
    "| Season | Months | Deck Occ | Feed-Adjusted Occ | ADR |",
    "|--------|-------:|---------:|------------------:|----:|"
  );

  for (const b of so.bands) {
    lines.push(
      `| ${b.name} | ${b.months} | ${fmt(b.deck_occ_pct)}% | ${fmt(b.feed_adjusted_occ_pct)}% | $${b.adr} |`
    );
  }

  lines.push("", `*Methodology:* ${so.methodology}`, "");

  lines.push(
    "---",
    "",
    "## 6. Visitor Segmentation — New from Feed (Not in Deck)",
    "",
    `The deck anchors to CoStar + AirDNA for **pricing and occupancy** but does not segment the **${report.visitor_segmentation.baseline.toLocaleString()}** annual Gorge visitors into lodging buckets. The feed adds:`,
    "",
    "| Segment | Geo Tier | Implied Annual Visitors | Share of Baseline |",
    "|---------|----------|------------------------:|------------------:|"
  );

  for (const s of report.visitor_segmentation.feed_segments) {
    lines.push(
      `| ${s.category} | ${s.geo_tier} | ${s.implied_annual_visitors.toLocaleString()} | ${s.share_of_baseline_pct}% |`
    );
  }

  lines.push(
    "",
    `**Day tripper residual:** ${report.visitor_segmentation.day_tripper_residual.toLocaleString()} (${report.visitor_segmentation.day_tripper_share_pct}% of baseline) — overnight lodging tracked in feed does not yet explain full visitor volume; expand Tier B inventory counts.`,
    "",
    "---",
    "",
    "## 7. Data Gaps & Next Steps",
    ""
  );

  for (const g of report.bridge_summary.data_gaps) {
    lines.push(`- ${g}`);
  }

  lines.push(
    "",
    "---",
    "",
    "*Generated by art-bliss-research. Re-run `npm run run` to refresh with latest live scrapes.*"
  );

  return lines.join("\n");
}

export function writeDeckComparisonReport(
  tierA: CategoryMetrics[],
  tierB: CategoryMetrics[],
  segmentation: SegmentationReport
): DeckComparisonReport {
  mkdirSync(exportsDir, { recursive: true });
  const report = buildDeckComparisonReport(tierA, tierB, segmentation);
  writeFileSync(join(exportsDir, "deck-comparison.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(exportsDir, "deck-comparison.md"), renderDeckComparisonMarkdown(report));
  return report;
}

export function printDeckComparisonSummary(report: DeckComparisonReport) {
  console.log("\n=== Deck vs Feed Comparison ===");
  console.log(`Source: ${report.source_deck}`);
  for (const p of report.artbliss_portfolio) {
    console.log(
      `  ${p.phase}: deck ${fmtUsd(p.deck_room_revenue)} -> feed ${fmtUsd(p.feed_projected_room_revenue)} (${p.revenue_delta_pct >= 0 ? "+" : ""}${p.revenue_delta_pct}%)`
    );
  }
  console.log(`  Day trippers (new): ${report.visitor_segmentation.day_tripper_residual.toLocaleString()} (${report.visitor_segmentation.day_tripper_share_pct}%)`);
  const so = report.seasonal_outlook;
  console.log(
    `  Seasonal Artbliss I NOI: ${fmtUsd(so.artbliss_i.feed_seasonal_noi)} (vs deck base ${fmtUsd(so.artbliss_i.deck_base_noi)}, snapshot ${fmtUsd(so.artbliss_i.feed_snapshot_noi)})`
  );
  console.log("  Written: data/exports/deck-comparison.md + .json\n");
}
