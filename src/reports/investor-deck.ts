import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CategoryMetrics, SegmentationReport } from "../types.js";
import { loadConfig } from "../config.js";
import type { DeckComparisonReport } from "./deck-comparison.js";
import type { SeasonalOutlook } from "../engine/seasonality.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const exportsDir = join(root, "data", "exports");
const NOI_MARGIN = 0.455;

function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtPct(n: number, d = 1): string {
  return `${n.toFixed(d)}%`;
}

function roomRev(units: number, occPct: number, adr: number): number {
  return units * 365 * (occPct / 100) * adr;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface DiscoveredComp {
  deck_name: string;
  source: string;
  adr?: number;
  listing_id?: string;
  listing_title?: string;
  website_url?: string;
}

interface YearRow {
  year: number;
  adr: number;
  rev: number;
  noi: number;
}

interface CompRow {
  name: string;
  units: number;
  deckAdr: number;
  liveAdr: number;
  source: string;
  revUnit: number;
  detail: string | null;
}

interface ScenarioRow {
  label: string;
  occ: string;
  adr: string;
  rev: string;
  noi: string;
  primary?: boolean;
}

export interface InvestorDeckData {
  ts: string;
  feedOcc: number;
  feedStrOcc: number;
  feedHotelOcc: number;
  baseOcc: number;
  baseAdr: number;
  occDelta: number;
  revpar: number;
  strCount: number;
  costarOcc: number;
  peakOcc: number;
  peakAdr: number;
  artI: DeckComparisonReport["artbliss_portfolio"][0];
  artII: DeckComparisonReport["artbliss_portfolio"][1];
  comps: CompRow[];
  scenarios: ScenarioRow[];
  fiveYearI: YearRow[];
  cumI: number;
  fiveYearII: YearRow[];
  cumII: number;
  segments: SegmentationReport["segments"];
  visitorBaseline: number;
  strengths: string[];
  seasonal: SeasonalOutlook;
}

function loadDiscovered(): DiscoveredComp[] {
  const p = join(root, "data", "discovered-comps.json");
  if (!existsSync(p)) return [];
  try {
    return (JSON.parse(readFileSync(p, "utf-8")) as { discovered: DiscoveredComp[] }).discovered ?? [];
  } catch {
    return [];
  }
}

function compSourceLabel(d: DiscoveredComp | undefined): string {
  if (!d) return "Deck anchor";
  return d.source === "airbnb" ? "Airbnb live" : "Website proxy";
}

function compDetailLine(d: DiscoveredComp | undefined, name: string): string | null {
  if (!d) return null;
  if (d.source === "airbnb" && d.listing_id) {
    return `${name}: Airbnb #${d.listing_id} "${d.listing_title ?? ""}" @ $${d.adr}/night`;
  }
  if (d.website_url) return `${name}: ${d.website_url}`;
  return null;
}

export function buildInvestorDeckData(
  tierA: CategoryMetrics[],
  segmentation: SegmentationReport,
  comparison: DeckComparisonReport
): InvestorDeckData {
  const { underwriting: uw } = loadConfig();
  const discovered = loadDiscovered();
  const ts = comparison.timestamp.slice(0, 10);

  const cabin = tierA.find((m) => m.lodging_category === "Cabin");
  const str = tierA.find((m) => m.lodging_category === "STR");
  const hotel = tierA.find((m) => m.lodging_category === "Hotel");

  const feedOcc = cabin?.estimated_occupancy_rate ?? 73.7;
  const feedStrOcc = str?.estimated_occupancy_rate ?? 75;
  const feedHotelOcc = hotel?.estimated_occupancy_rate ?? 73;
  const baseAdr = uw.scenarios.base.blended_adr;
  const baseOcc = uw.scenarios.base.occupancy_pct;
  const occDelta = feedOcc - baseOcc;

  const artI = comparison.artbliss_portfolio[0];
  const artII = comparison.artbliss_portfolio[1];

  const feedUpsideAdr = uw.scenarios.upside.blended_adr;
  const feedUpsideRev = roomRev(4, feedOcc, feedUpsideAdr);
  const feedUpsideNoi = feedUpsideRev * NOI_MARGIN;

  const fiveYearI = Array.from({ length: 5 }, (_, y) => {
    const adr = Math.round(baseAdr * 1.04 ** y);
    const rev = roomRev(4, feedOcc, adr);
    return { year: y + 1, adr, rev, noi: rev * NOI_MARGIN };
  });
  const cumI = fiveYearI.reduce((a, r) => a + r.noi, 0);

  const fiveYearII = fiveYearI.map((r) => ({
    ...r,
    rev: r.rev * 2.5,
    noi: r.noi * 2.5,
  }));
  const cumII = fiveYearII.reduce((a, r) => a + r.noi, 0);

  const comps: CompRow[] = uw.comp_properties.map((c) => {
    const d = discovered.find((x) => x.deck_name === c.name);
    const liveAdr = d?.adr ?? c.avg_adr;
    const revUnit =
      comparison.comp_properties.find((x) => x.name === c.name)?.feed_implied_rev_per_unit ??
      Math.round(roomRev(1, feedOcc, liveAdr));
    return {
      name: c.name,
      units: c.units,
      deckAdr: c.avg_adr,
      liveAdr,
      source: compSourceLabel(d),
      revUnit,
      detail: compDetailLine(d, c.name),
    };
  });

  const scenarios: ScenarioRow[] = [];
  for (const key of ["conservative", "base", "upside"] as const) {
    const s = uw.scenarios[key];
    const rev = roomRev(4, s.occupancy_pct, s.blended_adr);
    scenarios.push({
      label: key.charAt(0).toUpperCase() + key.slice(1) + " (deck)",
      occ: fmtPct(s.occupancy_pct, 1),
      adr: `$${s.blended_adr}`,
      rev: fmtUsd(rev),
      noi: fmtUsd(rev * NOI_MARGIN),
    });
  }
  scenarios.push({
    label: "Feed-Anchored Base ← Primary",
    occ: fmtPct(feedOcc),
    adr: `$${baseAdr}`,
    rev: fmtUsd(artI.feed_projected_room_revenue),
    noi: fmtUsd(artI.feed_projected_noi),
    primary: true,
  });
  scenarios.push({
    label: "Feed Upside",
    occ: fmtPct(feedOcc),
    adr: `$${feedUpsideAdr}`,
    rev: fmtUsd(feedUpsideRev),
    noi: fmtUsd(feedUpsideNoi),
  });

  return {
    ts,
    feedOcc,
    feedStrOcc,
    feedHotelOcc,
    baseOcc,
    baseAdr,
    occDelta,
    revpar: Math.round((feedOcc / 100) * baseAdr),
    strCount: str?.total_units_tracked ?? 0,
    costarOcc: uw.market_benchmarks_ttm.costar_hotel_occupancy_pct,
    peakOcc: uw.seasonality.peak.occupancy_pct,
    peakAdr: uw.seasonality.peak.adr,
    artI,
    artII,
    comps,
    scenarios,
    fiveYearI,
    cumI,
    fiveYearII,
    cumII,
    segments: segmentation.segments,
    visitorBaseline: segmentation.annual_visitor_baseline,
    strengths: [
      `Live cabin occupancy ${fmtPct(feedOcc)} vs ${fmtPct(baseOcc)} deck assumption`,
      `${str?.total_units_tracked ?? 0} STR listings tracked at ${fmtPct(feedStrOcc)} occupancy`,
      "Skamania treehouse $519/night live on Airbnb",
      `Stevenson hotels ${fmtPct(feedHotelOcc)} vs CoStar ${fmtPct(uw.market_benchmarks_ttm.costar_hotel_occupancy_pct)}`,
      "First-pass visitor segmentation on 2.9M baseline",
    ],
    seasonal: comparison.seasonal_outlook,
  };
}

export function renderInvestorDeckMarkdown(d: InvestorDeckData): string {
  const lines: string[] = [
    "# Artbliss Investor Package",
    "",
    "**A Columbia Gorge Cabin Portfolio — Live Market Intelligence Edition**",
    "",
    "| | |",
    "|---|---|",
    "| **Location** | Stevenson, WA — Bridge of the Gods gateway |",
    "| **Units Today** | 4 (Artbliss I, in operation) |",
    "| **Full Buildout** | 10 units (Artbliss II) |",
    `| **Data as of** | ${d.ts} |`,
    "| **Intelligence** | Live Airbnb · auto-discovered comps · CoStar · recreation.gov |",
    "",
    "---",
    "",
    "## 01 — The Opportunity",
    "",
    "### Artbliss I — In Operation (4 units)",
    "",
    "| | Original Deck | **Feed-Anchored (Live)** |",
    "|---|---:|---:|",
    `| Y1 Room Revenue | ${fmtUsd(d.artI.deck_room_revenue)} | **${fmtUsd(d.artI.feed_projected_room_revenue)}** |`,
    `| Y1 NOI | ${fmtUsd(d.artI.deck_noi)} | **${fmtUsd(d.artI.feed_projected_noi)}** |`,
    "| NOI Margin | 45.5% | 45.5% |",
    "",
    `- Live Stevenson cabin occupancy **${fmtPct(d.feedOcc)}** vs deck base **${fmtPct(d.baseOcc)}** (+${d.occDelta.toFixed(1)} pp)`,
    "- Cash-flowing today with established guest base and 5-star reviews",
    "",
    "### Artbliss II — Full Buildout (10 units)",
    "",
    "| | Original Deck | **Feed-Anchored (Live)** |",
    "|---|---:|---:|",
    `| Y1 Room Revenue | ${fmtUsd(d.artII.deck_room_revenue)} | **${fmtUsd(d.artII.feed_projected_room_revenue)}** |`,
    `| Y1 NOI | ${fmtUsd(d.artII.deck_noi)} | **${fmtUsd(d.artII.feed_projected_noi)}** |`,
    "",
    "---",
    "",
    "## 02 — Market (Live Intelligence)",
    "",
    "| Metric | Prior Deck | **Live Feed (Tier A)** |",
    "|--------|------------|------------------------|",
    `| Hotel Occupancy | CoStar ${fmtPct(d.costarOcc)} TTM | **${fmtPct(d.feedHotelOcc)}** |`,
    `| Cabin Occupancy | AirDNA anchor ${fmtPct(d.baseOcc)} | **${fmtPct(d.feedOcc)}** |`,
    `| STR Occupancy | — | **${fmtPct(d.feedStrOcc)}** (${d.strCount} listings) |`,
    `| Implied RevPAR | $197 | **$${d.revpar}** |`,
    `| Peak Season (deck ref.) | ${fmtPct(d.peakOcc)} occ / $${d.peakAdr} ADR | Live snapshot ~${fmtPct(d.feedOcc)} |`,
    "",
    "---",
    "",
    "## 03 — Comp Properties (Auto-Discovered)",
    "",
    "| Property | Units | Deck ADR | Live ADR | Source | Rev/Unit @ Feed Occ |",
    "|----------|------:|---------:|---------:|--------|--------------------:|",
  ];

  for (const c of d.comps) {
    lines.push(
      `| ${c.name} | ${c.units} | $${c.deckAdr} | **$${c.liveAdr}** | ${c.source} | $${c.revUnit.toLocaleString()} |`
    );
  }

  lines.push("", "**Discovery detail:**");
  for (const c of d.comps) {
    if (c.detail) lines.push(`- ${c.detail}`);
  }

  lines.push(
    "",
    "---",
    "",
    "## 04 — Underwriting Scenarios — Artbliss I (Y1)",
    "",
    "| Scenario | Occ | ADR | Room Revenue | NOI |",
    "|----------|----:|----:|-------------:|----:|"
  );

  for (const s of d.scenarios) {
    const label = s.primary ? `**${s.label}**` : s.label;
    const cells = s.primary
      ? [`**${s.occ}**`, `**${s.adr}**`, `**${s.rev}**`, `**${s.noi}**`]
      : [s.occ, s.adr, s.rev, s.noi];
    lines.push(`| ${label} | ${cells.join(" | ")} |`);
  }

  const so = d.seasonal;
  lines.push(
    "",
    "## 04b — Seasonally Adjusted Outlook (Recommended Annual Case)",
    "",
    "Applies deck peak / shoulder / off-peak shape scaled to live snapshot occupancy, with month-level ADR.",
    "",
    "| Case | Blended Occ | Blended ADR | Artbliss I NOI |",
    "|------|------------:|------------:|---------------:|",
    `| Deck base (flat) | ${fmtPct(so.deck_annual_occ_pct)} | $${Math.round(so.deck_annual_adr)} | ${fmtUsd(so.artbliss_i.deck_base_noi)} |`,
    `| Feed snapshot (flat $347) | ${fmtPct(so.feed_snapshot_occ_pct)} | $347 | ${fmtUsd(so.artbliss_i.feed_snapshot_noi)} |`,
    `| **Feed seasonal ← recommended** | **${fmtPct(so.feed_adjusted_occ_pct)}** | **$${Math.round(so.feed_adjusted_adr)}** | **${fmtUsd(so.artbliss_i.feed_seasonal_noi)}** |`,
    "",
    "| Season | Months | Feed-Adj Occ | ADR |",
    "|--------|-------:|-------------:|----:|"
  );
  for (const b of so.bands) {
    lines.push(`| ${b.name} | ${b.months} | ${fmtPct(b.feed_adjusted_occ_pct)} | $${b.adr} |`);
  }

  lines.push(
    "",
    "---",
    "",
    "## 05 — Artbliss I Stabilized Y1 (Feed-Anchored)",
    `- Room Revenue: **${fmtUsd(d.artI.feed_projected_room_revenue)}** (+${d.artI.revenue_delta_pct}% vs deck base)`,
    `- NOI: **${fmtUsd(d.artI.feed_projected_noi)}**`,
    "- Margin: 45.5%",
    "",
    "## 06 — Artbliss II Stabilized Y1 (Feed-Anchored)",
    `- Room Revenue: **${fmtUsd(d.artII.feed_projected_room_revenue)}**`,
    `- NOI: **${fmtUsd(d.artII.feed_projected_noi)}**`,
    "",
    "---",
    "",
    "## 07 — 5-Year Horizon — Artbliss I",
    "",
    "| Year | ADR | Room Revenue | NOI |",
    "|------|----:|-------------:|----:|"
  );

  for (const r of d.fiveYearI) {
    lines.push(`| Y${r.year} | $${r.adr} | ${fmtUsd(r.rev)} | ${fmtUsd(r.noi)} |`);
  }
  lines.push(`| **5-Yr Cumulative** | | | **${fmtUsd(d.cumI)}** |`);

  lines.push(
    "",
    "## 08 — 5-Year Horizon — Artbliss II",
    "",
    "| Year | ADR | Room Revenue | NOI |",
    "|------|----:|-------------:|----:|"
  );

  for (const r of d.fiveYearII) {
    lines.push(`| Y${r.year} | $${r.adr} | ${fmtUsd(r.rev)} | ${fmtUsd(r.noi)} |`);
  }
  lines.push(`| **5-Yr Cumulative** | | | **${fmtUsd(d.cumII)}** |`);

  lines.push(
    "",
    "---",
    "",
    "## 09 — Gorge Visitor Segmentation",
    "",
    `Baseline: **${d.visitorBaseline.toLocaleString()}** annual visitors`,
    "",
    "| Segment | Tier | Visitors | Share |",
    "|---------|------|--------:|------:|"
  );

  for (const s of d.segments) {
    lines.push(
      `| ${s.category} | ${s.geo_tier} | ${s.implied_annual_visitors.toLocaleString()} | ${s.share_of_baseline_pct}% |`
    );
  }

  lines.push(
    "",
    "*Preliminary — expand inventory tracking to tighten day-tripper estimate.*",
    "",
    "---",
    "",
    "## 10 — OpEx (Deck Structure, Feed Revenue)",
    "",
    `Variable lines scale with feed revenue (${fmtUsd(d.artI.feed_projected_room_revenue)} Y1 Artbliss I). Same drivers as original deck: 10% mgmt, 5% marketing, cleaning salary/turn model, flat tax/insurance.`,
    "",
    "---",
    "",
    "## 11 — Assumptions & Sources",
    "",
    "| Data | Source |",
    "|------|--------|",
    "| Live occupancy | Airbnb scrape, hotel pages, recreation.gov, OR parks |",
    "| Comp discovery | Auto-match + wilderandpine.com, tenzensprings.com, skamania.com |",
    `| ADR bridge | AirDNA $${d.baseAdr} TTM + live Airbnb (Skamania $519) |`,
    `| Hotel benchmark | CoStar Stevenson ${fmtPct(d.costarOcc)} |`,
    "| Unit economics | Roam Hospitality deck (June 2026) |",
    "",
    "---",
    "",
    "## 12 — Summary",
    "",
    "| | Artbliss I (4) | Artbliss II (10) |",
    "|---|---:|---:|",
    `| Y1 NOI (Feed) | **${fmtUsd(d.artI.feed_projected_noi)}** | **${fmtUsd(d.artII.feed_projected_noi)}** |`,
    `| Y5 NOI (proj.) | **${fmtUsd(d.fiveYearI[4].noi)}** | **${fmtUsd(d.fiveYearII[4].noi)}** |`,
    `| 5-Yr Cumulative NOI | **${fmtUsd(d.cumI)}** | **${fmtUsd(d.cumII)}** |`,
    "",
    "### What makes this deck stronger than June 2026",
    ""
  );

  d.strengths.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("", "---", "", "*Art Bliss Market Intelligence Engine · Re-run `npm run run` to refresh*");

  return lines.join("\n");
}

const HTML_STYLES = `
:root {
  --forest: #1a2e22;
  --forest-mid: #243d2e;
  --forest-light: #2f4f3a;
  --cream: #f4efe6;
  --cream-muted: #c8c0b4;
  --gold: #c4a574;
  --gold-bright: #d4b88a;
  --sage: #7a9b82;
  --river: #5a8a9a;
  --live: #8ec4a0;
  --slide-pad: clamp(2rem, 5vw, 4rem);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html {
  font-size: 16px;
  scroll-behavior: smooth;
}

body {
  font-family: "DM Sans", system-ui, sans-serif;
  background: var(--forest);
  color: var(--cream);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, .display {
  font-family: "Cormorant Garamond", Georgia, serif;
  font-weight: 400;
  letter-spacing: 0.02em;
}

a { color: var(--gold-bright); text-decoration: none; }
a:hover { text-decoration: underline; }

.deck { max-width: 1200px; margin: 0 auto; }

/* Cover */
.cover {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: var(--slide-pad);
  background:
    radial-gradient(ellipse 80% 60% at 70% 20%, rgba(90, 138, 154, 0.12), transparent),
    radial-gradient(ellipse 60% 50% at 10% 80%, rgba(196, 165, 116, 0.08), transparent),
    var(--forest);
  border-bottom: 1px solid rgba(196, 165, 116, 0.2);
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 3rem;
}

.brand-mark {
  width: 48px;
  height: 48px;
  border: 1px solid var(--gold);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "Cormorant Garamond", serif;
  font-size: 1.5rem;
  color: var(--gold);
}

.brand-label {
  font-size: 0.75rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--gold);
}

.cover h1 {
  font-size: clamp(2.8rem, 6vw, 4.5rem);
  line-height: 1.05;
  margin-bottom: 0.75rem;
}

.cover .subtitle {
  font-size: clamp(1.1rem, 2vw, 1.35rem);
  color: var(--cream-muted);
  font-weight: 300;
  max-width: 36rem;
  margin-bottom: 3rem;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1px;
  background: rgba(196, 165, 116, 0.15);
  border: 1px solid rgba(196, 165, 116, 0.15);
  border-radius: 6px;
  overflow: hidden;
  max-width: 56rem;
}

.meta-cell {
  background: rgba(36, 61, 46, 0.6);
  padding: 1.1rem 1.25rem;
}

.meta-cell .label {
  font-size: 0.65rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 0.35rem;
}

.meta-cell .value {
  font-size: 0.95rem;
  color: var(--cream);
}

.kpi-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1.25rem;
  margin-top: 3rem;
  max-width: 56rem;
}

.kpi {
  border-left: 2px solid var(--gold);
  padding-left: 1rem;
}

.kpi .num {
  font-family: "Cormorant Garamond", serif;
  font-size: 2rem;
  color: var(--live);
  line-height: 1.1;
}

.kpi .lbl {
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--cream-muted);
  margin-top: 0.25rem;
}

/* Sections */
.slide {
  padding: var(--slide-pad);
  border-bottom: 1px solid rgba(196, 165, 116, 0.12);
}

.slide:nth-child(even) {
  background: rgba(36, 61, 46, 0.35);
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
  margin-bottom: 2rem;
}

.section-num {
  font-family: "Cormorant Garamond", serif;
  font-size: clamp(2.5rem, 5vw, 3.5rem);
  color: var(--gold);
  opacity: 0.7;
  line-height: 1;
  flex-shrink: 0;
}

.section-head h2 {
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  color: var(--cream);
}

.subhead {
  font-family: "Cormorant Garamond", serif;
  font-size: 1.25rem;
  color: var(--gold-bright);
  margin: 1.75rem 0 1rem;
}

.subhead:first-of-type { margin-top: 0; }

.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(196, 165, 116, 0.15);
  border-radius: 6px;
  padding: 1.5rem;
}

.card h3 {
  font-size: 1.1rem;
  margin-bottom: 1rem;
  color: var(--gold-bright);
}

/* Tables */
.table-wrap { overflow-x: auto; margin: 1rem 0; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

thead th {
  text-align: left;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gold);
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(196, 165, 116, 0.25);
  font-weight: 500;
}

thead th.num { text-align: right; }

tbody td {
  padding: 0.7rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: var(--cream);
}

tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }

tbody tr:hover { background: rgba(255, 255, 255, 0.02); }

tbody tr.primary {
  background: rgba(142, 196, 160, 0.08);
}

tbody tr.primary td { color: var(--live); font-weight: 500; }

tbody tr.total {
  background: rgba(196, 165, 116, 0.08);
}

tbody tr.total td {
  font-weight: 600;
  color: var(--gold-bright);
  border-bottom: none;
}

.col-live { color: var(--live) !important; font-weight: 500; }

.badge {
  display: inline-block;
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  background: rgba(142, 196, 160, 0.15);
  color: var(--live);
  border: 1px solid rgba(142, 196, 160, 0.3);
}

.badge.gold {
  background: rgba(196, 165, 116, 0.15);
  color: var(--gold-bright);
  border-color: rgba(196, 165, 116, 0.3);
}

.note {
  font-size: 0.85rem;
  color: var(--cream-muted);
  font-style: italic;
  margin-top: 1rem;
}

.bullet-list {
  list-style: none;
  margin: 1rem 0;
}

.bullet-list li {
  padding: 0.45rem 0 0.45rem 1.25rem;
  position: relative;
  color: var(--cream-muted);
  font-size: 0.9rem;
}

.bullet-list li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.85rem;
  width: 6px;
  height: 6px;
  background: var(--gold);
  border-radius: 50%;
}

.bullet-list li strong { color: var(--cream); }

.discovery-list {
  list-style: none;
  margin-top: 1rem;
}

.discovery-list li {
  font-size: 0.82rem;
  color: var(--cream-muted);
  padding: 0.4rem 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.strengths {
  display: grid;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.strength-item {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  padding: 1rem 1.25rem;
  background: rgba(196, 165, 116, 0.06);
  border-left: 3px solid var(--gold);
  border-radius: 0 4px 4px 0;
  font-size: 0.9rem;
  color: var(--cream-muted);
}

.strength-item .idx {
  font-family: "Cormorant Garamond", serif;
  font-size: 1.4rem;
  color: var(--gold);
  line-height: 1;
  flex-shrink: 0;
}

.footer {
  padding: 2rem var(--slide-pad);
  text-align: center;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: var(--cream-muted);
  opacity: 0.7;
}

/* Screen: stacked 16:9 slide frames */
@media screen {
  body { padding-top: 3.25rem; }
  .deck {
    max-width: 1280px;
    margin: 0 auto;
    padding: 1rem 1rem 3rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .cover,
  .slide {
    aspect-ratio: 16 / 9;
    width: 100%;
    min-height: unset;
    border-radius: 6px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(196, 165, 116, 0.2);
    overflow: hidden;
  }
  .cover {
    justify-content: center;
    padding: clamp(1.5rem, 4vw, 3rem);
  }
  .slide {
    padding: clamp(1.25rem, 3vw, 2.5rem);
    display: flex;
    flex-direction: column;
  }
  .slide .slide-body { flex: 1; overflow: auto; }
}

.print-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 1.25rem;
  background: rgba(26, 46, 34, 0.96);
  border-bottom: 1px solid rgba(196, 165, 116, 0.45);
  font-size: 0.8rem;
  color: var(--cream-muted);
  backdrop-filter: blur(8px);
}
.print-bar strong { color: var(--cream); }
.print-bar button {
  background: var(--gold);
  color: var(--forest);
  border: none;
  padding: 0.45rem 1.1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.8rem;
  white-space: nowrap;
}
.print-bar button:hover { background: var(--gold-bright); }

/* Print / PDF: one landscape slide per page (16:9 widescreen) */
@page {
  size: 13.333in 7.5in landscape;
  margin: 0;
}

@media print {
  html, body {
    width: 13.333in;
    margin: 0;
    padding: 0;
    background: var(--forest) !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .print-bar { display: none !important; }

  .deck {
    max-width: none;
    width: 13.333in;
    display: block;
    padding: 0;
    gap: 0;
  }

  .cover,
  .slide {
    width: 13.333in;
    height: 7.5in;
    min-height: 7.5in;
    max-height: 7.5in;
    padding: 0.45in 0.55in;
    margin: 0;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
    overflow: hidden;
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: var(--forest) !important;
    display: flex;
    flex-direction: column;
  }

  .slide:nth-child(even) {
    background: var(--forest-mid) !important;
  }

  .footer { display: none; }

  /* Compact slide typography */
  html { font-size: 10.5pt; }
  .brand-row { margin-bottom: 0.65rem; }
  .brand-mark { width: 36px; height: 36px; font-size: 1.1rem; }
  .cover h1 { font-size: 2.1rem; margin-bottom: 0.25rem; }
  .cover .subtitle { font-size: 0.88rem; margin-bottom: 0.85rem; max-width: 32rem; }
  .meta-grid { max-width: 100%; }
  .meta-cell { padding: 0.55rem 0.65rem; }
  .meta-cell .value { font-size: 0.78rem; }
  .kpi-strip { margin-top: 0.55rem; gap: 0.55rem; }
  .kpi .num { font-size: 1.25rem; }
  .kpi .lbl { font-size: 0.58rem; }
  .section-head { margin-bottom: 0.45rem; gap: 0.75rem; }
  .section-num { font-size: 1.85rem; }
  .section-head h2 { font-size: 1.2rem; }
  .subhead { font-size: 0.95rem; margin: 0.5rem 0 0.35rem; }
  .two-col { grid-template-columns: 1fr 1fr; gap: 0.45rem; }
  .card { padding: 0.45rem 0.55rem; }
  .card h3 { font-size: 0.82rem; margin-bottom: 0.35rem; }
  .table-wrap { margin: 0.25rem 0; overflow: hidden; }
  table { font-size: 0.68rem; }
  thead th { padding: 0.28rem 0.4rem; font-size: 0.58rem; }
  tbody td { padding: 0.28rem 0.4rem; }
  .bullet-list { margin: 0.35rem 0; }
  .bullet-list li { font-size: 0.72rem; padding: 0.2rem 0 0.2rem 0.9rem; }
  .bullet-list li::before { top: 0.55rem; width: 4px; height: 4px; }
  .discovery-list li { font-size: 0.62rem; padding: 0.15rem 0; }
  .note { font-size: 0.65rem; margin-top: 0.35rem; }
  .strengths { gap: 0.35rem; margin-top: 0.45rem; }
  .strength-item { padding: 0.35rem 0.5rem; font-size: 0.68rem; gap: 0.5rem; }
  .strength-item .idx { font-size: 1rem; }
  a { color: var(--gold-bright) !important; text-decoration: none; }
  tbody tr:hover { background: transparent; }
}
`;

function compareTable(
  rows: { label: string; deck: string; live: string }[],
  liveHeader = "Feed-Anchored (Live)"
): string {
  const trs = rows
    .map(
      (r) =>
        `<tr><td>${esc(r.label)}</td><td class="num">${esc(r.deck)}</td><td class="num col-live">${esc(r.live)}</td></tr>`
    )
    .join("\n");
  return `<div class="table-wrap"><table>
<thead><tr><th>Metric</th><th class="num">Original Deck</th><th class="num">${esc(liveHeader)}</th></tr></thead>
<tbody>${trs}</tbody></table></div>`;
}

function dataTable(
  headers: string[],
  rows: string[][],
  rowClasses?: string[]
): string {
  const ths = headers
    .map((h, i) => `<th${i > 0 ? ' class="num"' : ""}>${esc(h)}</th>`)
    .join("");
  const trs = rows
    .map((cells, ri) => {
      const cls = rowClasses?.[ri] ? ` class="${rowClasses[ri]}"` : "";
      const tds = cells
        .map((c, i) => `<td${i > 0 ? ' class="num"' : ""}>${c}</td>`)
        .join("");
      return `<tr${cls}>${tds}</tr>`;
    })
    .join("\n");
  return `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

export function renderInvestorDeckHtml(d: InvestorDeckData): string {
  const deltaPct = `+${d.artI.revenue_delta_pct}%`;
  const occDeltaStr = `+${d.occDelta.toFixed(1)} pp`;

  const compRows = d.comps.map((c) => [
    esc(c.name),
    String(c.units),
    `$${c.deckAdr}`,
    `<span class="col-live">$${c.liveAdr}</span>`,
    `<span class="badge${c.source === "Airbnb live" ? "" : " gold"}">${esc(c.source)}</span>`,
    `$${c.revUnit.toLocaleString()}`,
  ]);

  const scenarioRows = d.scenarios.map((s) => [
    s.primary ? `<strong>${esc(s.label)}</strong>` : esc(s.label),
    s.primary ? `<strong>${esc(s.occ)}</strong>` : esc(s.occ),
    s.primary ? `<strong>${esc(s.adr)}</strong>` : esc(s.adr),
    s.primary ? `<strong>${esc(s.rev)}</strong>` : esc(s.rev),
    s.primary ? `<strong>${esc(s.noi)}</strong>` : esc(s.noi),
  ]);
  const scenarioClasses = d.scenarios.map((s) => (s.primary ? "primary" : ""));

  const yearRowsI = d.fiveYearI.map((r) => [
    `Y${r.year}`,
    `$${r.adr}`,
    fmtUsd(r.rev),
    fmtUsd(r.noi),
  ]);
  yearRowsI.push(["5-Yr Cumulative", "—", "—", `<strong>${fmtUsd(d.cumI)}</strong>`]);

  const yearRowsII = d.fiveYearII.map((r) => [
    `Y${r.year}`,
    `$${r.adr}`,
    fmtUsd(r.rev),
    fmtUsd(r.noi),
  ]);
  yearRowsII.push(["5-Yr Cumulative", "—", "—", `<strong>${fmtUsd(d.cumII)}</strong>`]);

  const segRows = d.segments.map((s) => [
    esc(s.category),
    esc(s.geo_tier),
    s.implied_annual_visitors.toLocaleString(),
    `${s.share_of_baseline_pct}%`,
  ]);

  const discoveryItems = d.comps
    .filter((c) => c.detail)
    .map((c) => {
      const text = c.detail!;
      const linked = text.includes("http")
        ? text.replace(/(https?:\/\/[^\s]+)/, '<a href="$1" target="_blank" rel="noopener">$1</a>')
        : esc(text);
      return `<li>${linked}</li>`;
    })
    .join("\n");

  const strengthsHtml = d.strengths
    .map((s, i) => `<div class="strength-item"><span class="idx">${i + 1}</span><span>${esc(s)}</span></div>`)
    .join("\n");

  const so = d.seasonal;
  const seasonalCaseRows = [
    ["Deck base (flat)", `${so.deck_annual_occ_pct.toFixed(1)}%`, `$${Math.round(so.deck_annual_adr)}`, fmtUsd(so.artbliss_i.deck_base_noi)],
    ["Feed snapshot (flat $347)", `${so.feed_snapshot_occ_pct.toFixed(1)}%`, "$347", fmtUsd(so.artbliss_i.feed_snapshot_noi)],
    ["Feed seasonal ← recommended", `<strong>${so.feed_adjusted_occ_pct.toFixed(1)}%</strong>`, `<strong>$${Math.round(so.feed_adjusted_adr)}</strong>`, `<strong>${fmtUsd(so.artbliss_i.feed_seasonal_noi)}</strong>`],
  ];
  const seasonalBandRows = so.bands.map((b) => [
    b.name,
    String(b.months),
    `${b.feed_adjusted_occ_pct.toFixed(1)}%`,
    `$${b.adr}`,
  ]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Artbliss Investor Package — Live Intelligence</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,400&display=swap" rel="stylesheet"/>
<style>${HTML_STYLES}</style>
</head>
<body>
<div class="print-bar" aria-label="Export controls">
  <span><strong>Artbliss Investor Deck</strong> · 16:9 landscape · Use <strong>Export PDF</strong> or Print → Save as PDF (margins: none, background graphics: on)</span>
  <button type="button" onclick="window.print()">Export PDF</button>
</div>
<div class="deck">

<header class="cover">
  <div class="brand-row">
    <div class="brand-mark">A</div>
    <div class="brand-label">Roam Hospitality · Live Intelligence</div>
  </div>
  <h1>Artbliss Investor Package</h1>
  <p class="subtitle">A Columbia Gorge Cabin Portfolio — feed-anchored underwriting with live market data</p>
  <div class="meta-grid">
    <div class="meta-cell"><div class="label">Location</div><div class="value">Stevenson, WA — Bridge of the Gods</div></div>
    <div class="meta-cell"><div class="label">Units Today</div><div class="value">4 · Artbliss I (in operation)</div></div>
    <div class="meta-cell"><div class="label">Full Buildout</div><div class="value">10 units · Artbliss II</div></div>
    <div class="meta-cell"><div class="label">Data As Of</div><div class="value">${esc(d.ts)}</div></div>
    <div class="meta-cell"><div class="label">Intelligence</div><div class="value">Airbnb · Comps · CoStar · recreation.gov</div></div>
  </div>
  <div class="kpi-strip">
    <div class="kpi"><div class="num">${fmtUsd(d.artI.feed_projected_noi)}</div><div class="lbl">Artbliss I Y1 NOI</div></div>
    <div class="kpi"><div class="num">${fmtPct(d.feedOcc)}</div><div class="lbl">Live Cabin Occ</div></div>
    <div class="kpi"><div class="num">${deltaPct}</div><div class="lbl">Rev vs Deck Base</div></div>
    <div class="kpi"><div class="num">$${d.revpar}</div><div class="lbl">Implied RevPAR</div></div>
  </div>
</header>

<section class="slide" id="s01">
  <div class="section-head"><span class="section-num">01</span><h2>The Opportunity</h2></div>
  <div class="two-col">
    <div class="card">
      <h3>Artbliss I — In Operation (4 units)</h3>
      ${compareTable([
        { label: "Y1 Room Revenue", deck: fmtUsd(d.artI.deck_room_revenue), live: fmtUsd(d.artI.feed_projected_room_revenue) },
        { label: "Y1 NOI", deck: fmtUsd(d.artI.deck_noi), live: fmtUsd(d.artI.feed_projected_noi) },
        { label: "NOI Margin", deck: "45.5%", live: "45.5%" },
      ])}
      <ul class="bullet-list">
        <li>Live Stevenson cabin occupancy <strong>${fmtPct(d.feedOcc)}</strong> vs deck base <strong>${fmtPct(d.baseOcc)}</strong> (${occDeltaStr})</li>
        <li>Cash-flowing today with established guest base and 5-star reviews</li>
      </ul>
    </div>
    <div class="card">
      <h3>Artbliss II — Full Buildout (10 units)</h3>
      ${compareTable([
        { label: "Y1 Room Revenue", deck: fmtUsd(d.artII.deck_room_revenue), live: fmtUsd(d.artII.feed_projected_room_revenue) },
        { label: "Y1 NOI", deck: fmtUsd(d.artII.deck_noi), live: fmtUsd(d.artII.feed_projected_noi) },
      ])}
    </div>
  </div>
</section>

<section class="slide" id="s02">
  <div class="section-head"><span class="section-num">02</span><h2>Market — Live Intelligence</h2></div>
  ${dataTable(
    ["Metric", "Prior Deck", "Live Feed (Tier A)"],
    [
      ["Hotel Occupancy", `CoStar ${fmtPct(d.costarOcc)} TTM`, `<span class="col-live">${fmtPct(d.feedHotelOcc)}</span>`],
      ["Cabin Occupancy", `AirDNA anchor ${fmtPct(d.baseOcc)}`, `<span class="col-live">${fmtPct(d.feedOcc)}</span>`],
      ["STR Occupancy", "—", `<span class="col-live">${fmtPct(d.feedStrOcc)}</span> (${d.strCount} listings)`],
      ["Implied RevPAR", "$197", `<span class="col-live">$${d.revpar}</span>`],
      ["Peak Season (deck ref.)", `${fmtPct(d.peakOcc)} occ / $${d.peakAdr} ADR`, `Live snapshot ~${fmtPct(d.feedOcc)}`],
    ]
  )}
</section>

<section class="slide" id="s03">
  <div class="section-head"><span class="section-num">03</span><h2>Comp Properties — Auto-Discovered</h2></div>
  ${dataTable(["Property", "Units", "Deck ADR", "Live ADR", "Source", "Rev/Unit"], compRows)}
  <ul class="discovery-list">${discoveryItems}</ul>
</section>

<section class="slide" id="s04">
  <div class="section-head"><span class="section-num">04</span><h2>Underwriting Scenarios — Artbliss I (Y1)</h2></div>
  ${dataTable(["Scenario", "Occ", "ADR", "Room Revenue", "NOI"], scenarioRows, scenarioClasses)}
</section>

<section class="slide" id="s04b">
  <div class="section-head"><span class="section-num">04b</span><h2>Seasonally Adjusted Outlook</h2></div>
  <p class="note" style="margin-bottom:1.25rem;font-style:normal;">Recommended annual case — deck peak / shoulder / off-peak shape scaled to live occupancy, month-level ADR.</p>
  ${dataTable(["Case", "Blended Occ", "Blended ADR", "Artbliss I NOI"], seasonalCaseRows, ["", "", "", "primary"])}
  ${dataTable(["Season", "Months", "Feed-Adj Occ", "ADR"], seasonalBandRows)}
  <div class="kpi-strip" style="margin-top:1.5rem">
    <div class="kpi"><div class="num">${fmtUsd(so.artbliss_ii.feed_seasonal_noi)}</div><div class="lbl">Artbliss II Seasonal NOI</div></div>
  </div>
</section>

<section class="slide" id="s05">
  <div class="section-head"><span class="section-num">05</span><h2>Artbliss I Stabilized Y1</h2></div>
  <div class="kpi-strip">
    <div class="kpi"><div class="num">${fmtUsd(d.artI.feed_projected_room_revenue)}</div><div class="lbl">Room Revenue (${deltaPct} vs deck)</div></div>
    <div class="kpi"><div class="num">${fmtUsd(d.artI.feed_projected_noi)}</div><div class="lbl">Net Operating Income</div></div>
    <div class="kpi"><div class="num">45.5%</div><div class="lbl">NOI Margin</div></div>
  </div>
</section>

<section class="slide" id="s06">
  <div class="section-head"><span class="section-num">06</span><h2>Artbliss II Stabilized Y1</h2></div>
  <div class="kpi-strip">
    <div class="kpi"><div class="num">${fmtUsd(d.artII.feed_projected_room_revenue)}</div><div class="lbl">Room Revenue</div></div>
    <div class="kpi"><div class="num">${fmtUsd(d.artII.feed_projected_noi)}</div><div class="lbl">Net Operating Income</div></div>
  </div>
</section>

<section class="slide" id="s07">
  <div class="section-head"><span class="section-num">07</span><h2>5-Year Horizon — Artbliss I</h2></div>
  ${dataTable(["Year", "ADR", "Room Revenue", "NOI"], yearRowsI, [...Array(d.fiveYearI.length).fill(""), "total"])}
  <p class="note">4% annual ADR growth at feed-anchored ${fmtPct(d.feedOcc)} occupancy.</p>
</section>

<section class="slide" id="s08">
  <div class="section-head"><span class="section-num">08</span><h2>5-Year Horizon — Artbliss II</h2></div>
  ${dataTable(["Year", "ADR", "Room Revenue", "NOI"], yearRowsII, [...Array(d.fiveYearII.length).fill(""), "total"])}
</section>

<section class="slide" id="s09">
  <div class="section-head"><span class="section-num">09</span><h2>Gorge Visitor Segmentation</h2></div>
  <p class="subhead">Baseline: ${d.visitorBaseline.toLocaleString()} annual visitors</p>
  ${dataTable(["Segment", "Tier", "Visitors", "Share"], segRows)}
  <p class="note">Preliminary — expand inventory tracking to tighten day-tripper estimate.</p>
</section>

<section class="slide" id="s10">
  <div class="section-head"><span class="section-num">10</span><h2>OpEx — Deck Structure, Feed Revenue</h2></div>
  <p style="color:var(--cream-muted);font-size:0.95rem;max-width:40rem;">Variable lines scale with feed revenue (${fmtUsd(d.artI.feed_projected_room_revenue)} Y1 Artbliss I). Same drivers as original deck: 10% management, 5% marketing, cleaning salary/turn model, flat tax and insurance.</p>
</section>

<section class="slide" id="s11">
  <div class="section-head"><span class="section-num">11</span><h2>Assumptions &amp; Sources</h2></div>
  ${dataTable(["Data", "Source"], [
    ["Live occupancy", "Airbnb scrape, hotel pages, recreation.gov, OR parks"],
    ["Comp discovery", "Auto-match + wilderandpine.com, tenzensprings.com, skamania.com"],
    ["ADR bridge", `AirDNA $${d.baseAdr} TTM + live Airbnb (Skamania $519)`],
    ["Hotel benchmark", `CoStar Stevenson ${fmtPct(d.costarOcc)}`],
    ["Unit economics", "Roam Hospitality deck (June 2026)"],
  ])}
</section>

<section class="slide" id="s12">
  <div class="section-head"><span class="section-num">12</span><h2>Summary</h2></div>
  ${dataTable(["", "Artbliss I (4)", "Artbliss II (10)"], [
    ["Y1 NOI (Feed)", `<span class="col-live">${fmtUsd(d.artI.feed_projected_noi)}</span>`, `<span class="col-live">${fmtUsd(d.artII.feed_projected_noi)}</span>`],
    ["Y5 NOI (proj.)", fmtUsd(d.fiveYearI[4].noi), fmtUsd(d.fiveYearII[4].noi)],
    ["5-Yr Cumulative NOI", `<strong>${fmtUsd(d.cumI)}</strong>`, `<strong>${fmtUsd(d.cumII)}</strong>`],
  ])}
  <h3 class="subhead">What makes this deck stronger than June 2026</h3>
  <div class="strengths">${strengthsHtml}</div>
</section>

<footer class="footer">Art Bliss Market Intelligence Engine · Data as of ${esc(d.ts)} · Re-run npm run run to refresh</footer>
</div>
</body>
</html>`;
}

export function renderInvestorDeck(
  tierA: CategoryMetrics[],
  _tierB: CategoryMetrics[],
  segmentation: SegmentationReport,
  comparison: DeckComparisonReport
): string {
  return renderInvestorDeckMarkdown(buildInvestorDeckData(tierA, segmentation, comparison));
}

export function writeInvestorDeck(
  tierA: CategoryMetrics[],
  tierB: CategoryMetrics[],
  segmentation: SegmentationReport,
  comparison: DeckComparisonReport
): void {
  mkdirSync(exportsDir, { recursive: true });
  const data = buildInvestorDeckData(tierA, segmentation, comparison);
  writeFileSync(join(exportsDir, "artbliss-investor-deck.md"), renderInvestorDeckMarkdown(data));
  writeFileSync(join(exportsDir, "artbliss-investor-deck.html"), renderInvestorDeckHtml(data));
  console.log("  Written: data/exports/artbliss-investor-deck.md");
  console.log("  Written: data/exports/artbliss-investor-deck.html");
}
