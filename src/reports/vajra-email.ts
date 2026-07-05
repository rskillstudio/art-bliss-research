import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeckComparisonReport } from "./deck-comparison.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const exportsDir = join(root, "data", "exports");

function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function renderVajraEmail(report: DeckComparisonReport, siteUrl: string): string {
  const ts = report.timestamp.slice(0, 10);
  const artI = report.artbliss_portfolio[0];
  const so = report.seasonal_outlook;
  const seasonalDelta =
    Math.round(
      ((so.artbliss_i.feed_seasonal_noi - so.artbliss_i.deck_base_noi) / so.artbliss_i.deck_base_noi) * 1000
    ) / 10;

  return `Subject: Artbliss underwriting refresh — live market data + realistic annual case (${ts})

Hi Vajra,

Sharing an updated read on the Artbliss opportunity. We rebuilt the June 2026 Roam Hospitality investor deck using live market intelligence from Stevenson and the Columbia Gorge — Airbnb availability, hotel booking signals, recreation.gov, and auto-discovered comp properties (Skamania treehouses, Wilder & Pine, Tenzen Springs).

Live dashboard: ${siteUrl}
Full investor deck (HTML): ${siteUrl}/deck.html

---

THE HEADLINE

Live Stevenson cabin occupancy is running at ${so.feed_snapshot_occ_pct.toFixed(1)}% vs the deck's 65% base case. Hotels are at ${report.scenario_comparison[1]?.feed_hotel_occupancy_pct ?? 73}% vs CoStar's 66.3% TTM. That supports a stronger revenue outlook — but with important caveats below.

THREE CASES FOR ARTBLISS I (4 UNITS, Y1)

| Case | NOI | vs Deck Base ($${so.artbliss_i.deck_base_noi.toLocaleString()}) |
|------|-----:|---|
| Deck base (June 2026) | ${fmtUsd(so.artbliss_i.deck_base_noi)} | — |
| Feed snapshot (flat 73.7% @ $347) | ${fmtUsd(so.artbliss_i.feed_snapshot_noi)} | +${artI.revenue_delta_pct}% |
| Feed seasonal (recommended) | ${fmtUsd(so.artbliss_i.feed_seasonal_noi)} | ${seasonalDelta >= 0 ? "+" : ""}${seasonalDelta}% |

The seasonal case is the one I'd use for a realistic annual conversation. It takes the deck's peak / shoulder / off-peak shape (Jun–Aug at ~81% occ, Dec–Feb at ~39%, shoulder ~70%) and scales it to match today's live market signal. Revenue uses month-level ADR ($361 peak / $341 shoulder / $345 off-peak), not a flat $347.

Artbliss II at full buildout (10 units): ${fmtUsd(so.artbliss_ii.feed_seasonal_noi)} NOI on the same seasonal basis.

---

WHAT'S BETTER THAN THE ORIGINAL DECK

• Cabin and hotel occupancy both exceed deck assumptions — market demand looks healthy, not soft.
• Feed-anchored Artbliss I room revenue is ${fmtUsd(artI.feed_projected_room_revenue)} vs deck ${fmtUsd(artI.deck_room_revenue)} (+${artI.revenue_delta_pct}%).
• Skamania treehouse comp is $519/night live on Airbnb — premium positioning in the comp set is real.
• Implied RevPAR rises from $197 (deck) to ~$256 at feed occupancy.

---

CAVEATS (PLEASE READ)

1. Snapshot vs. trailing twelve months. The feed reflects roughly a 30-day window (${ts}). The deck used AirDNA/CoStar TTM data. If we're in peak Gorge season, the raw snapshot may overstate a full year — that's why the seasonal case above matters.

2. ADR still partly anchored to the deck. Artbliss revenue in the flat feed case uses $347 ADR (AirDNA TTM). We have live Airbnb ADR on Skamania ($519) but haven't yet blended live ADR across the full comp set into the base case. There may be additional upside if Artbliss pricing tracks premium comps.

3. Different methodology than AirDNA. The deck curated 12 listings; our feed tracks ~150 Airbnb listings in Tier A Stevenson. Directionally useful, not apples-to-apples with Brandon's AirDNA dashboard.

4. Occupancy is inferred from availability scrapes — not property P&Ls. Hotel and website comp signals are proxies. recreation.gov and OR parks cover campsites only.

5. Visitor segmentation is preliminary. ~${report.visitor_segmentation.day_tripper_share_pct}% of the 2.9M annual visitors show as "day trippers" because we haven't fully mapped overnight inventory across the Gorge. Don't read that as "no lodging demand."

6. Seasonal scaling is modeled, not measured. We apply a uniform uplift to the deck's seasonal shape based on today's snapshot. Month-by-month feed validation is the next step.

7. OpEx unchanged. All NOI figures use the deck's 45.5% margin. No change to management, cleaning, or tax assumptions.

---

BOTTOM LINE FOR YOU

Yes — the live feed supports a better outlook than the June deck's base case, especially on occupancy. I'd underwrite Artbliss I closer to ${fmtUsd(so.artbliss_i.feed_seasonal_noi)} NOI (seasonal) than ${fmtUsd(so.artbliss_i.deck_base_noi)} (deck base), while keeping the deck's conservative scenario as a stress test for winter softness and financing.

Happy to walk through the dashboard or the full deck together.

Best,
[Your name]

---
Data as of ${ts} · Refreshed via Art Bliss Market Intelligence Engine
Original deck: Roam Hospitality Investor Underwriting (June 2026)
`;
}

export function writeVajraEmail(report: DeckComparisonReport, siteUrl = "https://mindmakina.com/artbliss-deck"): void {
  mkdirSync(exportsDir, { recursive: true });
  writeFileSync(join(exportsDir, "vajra-briefing-email.txt"), renderVajraEmail(report, siteUrl));
  console.log("  Written: data/exports/vajra-briefing-email.txt");
}
