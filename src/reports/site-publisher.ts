import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeckComparisonReport } from "./deck-comparison.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const exportsDir = join(root, "data", "exports");
const siteDir = join(root, "site");

/** Root-absolute path so downloads work even when URL has no trailing slash. */
function assetUrl(siteUrl: string, file: string): string {
  const base = siteUrl.replace(/\/$/, "");
  try {
    const path = new URL(base).pathname.replace(/\/$/, "") || "";
    return `${path}/${file}`;
  } catch {
    return file;
  }
}


function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function renderDashboard(report: DeckComparisonReport, siteUrl: string): string {
  const ts = report.timestamp.slice(0, 10);
  const artI = report.artbliss_portfolio[0];
  const so = report.seasonal_outlook;
  const cabinOcc = report.scenario_comparison[1]?.feed_cabin_occupancy_pct ?? so.feed_snapshot_occ_pct;
  const hotelOcc = report.scenario_comparison[1]?.feed_hotel_occupancy_pct ?? 73;

  const supports = report.bridge_summary.supports_underwriting
    .slice(0, 4)
    .map((s) => `<li>${s.replace(/</g, "&lt;")}</li>`)
    .join("\n");

  const gaps = report.bridge_summary.data_gaps
    .slice(0, 5)
    .map((g) => `<li>${g.replace(/</g, "&lt;")}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Artbliss Deck Refresher · Mind Makina</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet"/>
<style>
:root{--forest:#1a2e22;--cream:#f4efe6;--muted:#c8c0b4;--gold:#c4a574;--live:#8ec4a0;--card:rgba(255,255,255,.04)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"DM Sans",system-ui,sans-serif;background:var(--forest);color:var(--cream);line-height:1.55;min-height:100vh}
.wrap{max-width:960px;margin:0 auto;padding:2rem 1.5rem 4rem}
h1,h2{font-family:"Cormorant Garamond",serif;font-weight:400}
.badge{display:inline-block;font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;padding:.25rem .6rem;border:1px solid var(--gold);color:var(--gold);border-radius:3px;margin-bottom:1rem}
h1{font-size:clamp(2rem,5vw,3rem);margin-bottom:.5rem}
.lead{color:var(--muted);max-width:36rem;margin-bottom:2rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin:2rem 0}
.kpi{background:var(--card);border:1px solid rgba(196,165,116,.2);border-radius:8px;padding:1.25rem}
.kpi .n{font-family:"Cormorant Garamond",serif;font-size:1.85rem;color:var(--live)}
.kpi .l{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-top:.35rem}
.kpi .s{font-size:.75rem;color:var(--muted);margin-top:.25rem}
.panel{background:var(--card);border:1px solid rgba(196,165,116,.15);border-radius:8px;padding:1.5rem;margin:1.5rem 0}
.panel h2{font-size:1.35rem;margin-bottom:1rem;color:var(--gold)}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th,td{padding:.65rem .75rem;text-align:left;border-bottom:1px solid rgba(255,255,255,.06)}
th{font-size:.65rem;text-transform:uppercase;letter-spacing:.1em;color:var(--gold)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
tr.highlight td{color:var(--live);font-weight:500}
ul{margin:.75rem 0 0 1.1rem;color:var(--muted);font-size:.9rem}
ul li{margin:.35rem 0}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin:2rem 0}
.btn{display:inline-block;padding:.65rem 1.25rem;border-radius:4px;font-size:.85rem;text-decoration:none;font-weight:500}
.btn-primary{background:var(--gold);color:var(--forest)}
.btn-secondary{border:1px solid var(--gold);color:var(--gold)}
.footer{text-align:center;font-size:.75rem;color:var(--muted);margin-top:3rem;opacity:.8}
.updated{font-size:.8rem;color:var(--muted);margin-bottom:1.5rem}
</style>
</head>
<body>
<div class="wrap">
  <div class="badge">Live Intelligence · Refresher</div>
  <h1>Artbliss Investor Deck</h1>
  <p class="lead">Updated underwriting vs the June 2026 Roam Hospitality deck — Stevenson cabin portfolio with live market feed.</p>
  <p class="updated">Last refreshed: <strong>${ts}</strong></p>

  <div class="download-banner">
    <a class="btn btn-primary btn-lg" href="${assetUrl(siteUrl, "artbliss-investor-deck.pdf")}" download="Artbliss-Investor-Deck.pdf">↓ Download Investor Deck (PDF)</a>
    <span class="download-hint">16:9 landscape · ${ts}</span>
  </div>

  <div class="actions">
    <a class="btn btn-primary" href="${assetUrl(siteUrl, "artbliss-investor-deck.pdf")}" download="Artbliss-Investor-Deck.pdf">Download PDF</a>
    <a class="btn btn-secondary" href="${assetUrl(siteUrl, "deck.html")}">Open Full Investor Deck</a>
    <a class="btn btn-secondary" href="${assetUrl(siteUrl, "data.json")}">Download Data (JSON)</a>
  </div>

  <div class="grid">
    <div class="kpi"><div class="n">${fmtUsd(so.artbliss_i.feed_seasonal_noi)}</div><div class="l">Artbliss I NOI</div><div class="s">Seasonal (recommended)</div></div>
    <div class="kpi"><div class="n">${cabinOcc.toFixed(1)}%</div><div class="l">Cabin Occ</div><div class="s">vs deck 65%</div></div>
    <div class="kpi"><div class="n">${hotelOcc.toFixed(1)}%</div><div class="l">Hotel Occ</div><div class="s">vs CoStar 66.3%</div></div>
    <div class="kpi"><div class="n">+${artI.revenue_delta_pct}%</div><div class="l">Rev Uplift</div><div class="s">Snapshot vs deck base</div></div>
  </div>

  <div class="panel">
    <h2>Three Cases — Artbliss I (Y1)</h2>
    <table>
      <thead><tr><th>Case</th><th class="num">Blended Occ</th><th class="num">NOI</th></tr></thead>
      <tbody>
        <tr><td>Deck base (June 2026)</td><td class="num">${so.deck_annual_occ_pct.toFixed(1)}%</td><td class="num">${fmtUsd(so.artbliss_i.deck_base_noi)}</td></tr>
        <tr><td>Feed snapshot (flat $347 ADR)</td><td class="num">${so.feed_snapshot_occ_pct.toFixed(1)}%</td><td class="num">${fmtUsd(so.artbliss_i.feed_snapshot_noi)}</td></tr>
        <tr class="highlight"><td>Feed seasonal ← recommended</td><td class="num">${so.feed_adjusted_occ_pct.toFixed(1)}%</td><td class="num">${fmtUsd(so.artbliss_i.feed_seasonal_noi)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="panel">
    <h2>Seasonal Shape (Feed-Adjusted)</h2>
    <table>
      <thead><tr><th>Season</th><th class="num">Months</th><th class="num">Occ</th><th class="num">ADR</th></tr></thead>
      <tbody>
        ${so.bands.map((b) => `<tr><td>${b.name}</td><td class="num">${b.months}</td><td class="num">${b.feed_adjusted_occ_pct.toFixed(1)}%</td><td class="num">$${b.adr}</td></tr>`).join("\n        ")}
      </tbody>
    </table>
  </div>

  <div class="panel">
    <h2>Supports Underwriting</h2>
    <ul>${supports}</ul>
  </div>

  <div class="panel">
    <h2>Caveats</h2>
    <ul>${gaps}</ul>
  </div>

  <p class="footer">Art Bliss Market Intelligence Engine · <a href="${siteUrl}" style="color:var(--gold)">${siteUrl}</a><br/>Re-run <code>npm run publish-site</code> to refresh</p>
</div>
</body>
</html>`;
}

export function publishSite(report: DeckComparisonReport, siteUrl = "https://mindmakina.com/artbliss-deck"): void {
  mkdirSync(siteDir, { recursive: true });

  const deckHtml = join(exportsDir, "artbliss-investor-deck.html");
  if (existsSync(deckHtml)) {
    copyFileSync(deckHtml, join(siteDir, "deck.html"));
  }

  writeFileSync(join(siteDir, "index.html"), renderDashboard(report, siteUrl));

  const snapshot = {
    updated: report.timestamp,
    site_url: siteUrl,
    artbliss_i: report.artbliss_portfolio[0],
    artbliss_ii: report.artbliss_portfolio[1],
    seasonal_outlook: report.seasonal_outlook,
    market: report.market_benchmarks,
    caveats: report.bridge_summary.data_gaps,
  };
  writeFileSync(join(siteDir, "data.json"), JSON.stringify(snapshot, null, 2));
  writeFileSync(join(exportsDir, "site-data.json"), JSON.stringify(snapshot, null, 2));

  console.log("  Published: site/index.html + site/deck.html + site/data.json (+ PDF if generated)");
}

export function writeDeployReadme(siteUrl = "https://mindmakina.com/artbliss-deck"): void {
  const readme = `# Deploy Artbliss Deck Refresher

Static site output: \`site/\`

## mindmakina.com/artbliss-deck

### Option A — Cloudflare Pages (recommended if mindmakina.com is on Cloudflare)

1. \`npm run publish-site\` (or \`npm run run\` which includes publish)
2. Cloudflare Dashboard → Pages → Create project → Direct Upload
3. Upload the \`site/\` folder
4. Custom domain: \`mindmakina.com\` with path \`/artbliss-deck\` via:
   - **Workers route** + static assets, or
   - Pages project at \`artbliss-deck.mindmakina.com\`, or
   - Single Pages site with \`site/\` at \`/artbliss-deck\` in your main site repo

\`\`\`bash
npx wrangler pages deploy site --project-name=artbliss-deck
\`\`\`

### Option B — Google Sites

1. Create a new Google Site
2. Embed → Embed code → paste iframe:
   \`<iframe src="${siteUrl}/deck.html" width="100%" height="800"></iframe>\`
3. Link KPI cards to ${siteUrl} dashboard

### Option C — Google Sheets (data only)

Import \`site/data.json\` or \`data/exports/site-data.json\` via Apps Script, or paste seasonal table from \`deck-comparison.md\`.

## Refresh cadence

\`\`\`bash
cd art-bliss-research
npm run run          # scrape + report + publish site
npm run publish-site # re-publish only (uses latest exports)
\`\`\`

Public URL: ${siteUrl}
`;

  writeFileSync(join(root, "site", "DEPLOY.md"), readme);
}

export function publishSiteFromExports(siteUrl?: string): void {
  const url = siteUrl ?? "https://mindmakina.com/artbliss-deck";
  const jsonPath = join(exportsDir, "deck-comparison.json");
  if (!existsSync(jsonPath)) {
    throw new Error("Run npm run report first — deck-comparison.json not found");
  }
  const report = JSON.parse(readFileSync(jsonPath, "utf-8")) as DeckComparisonReport;
  publishSite(report, url);
  writeDeployReadme(url);
}
