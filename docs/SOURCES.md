# Art Bliss Market Intelligence — Data Sources

Last updated with live scraper config and June 2026 deck benchmarks.

## Live feed (scraped weekly)

| Source | What it provides | Tier | Method |
|--------|------------------|------|--------|
| **Airbnb search** | STR + cabin listing availability, implied occupancy, listing counts | A: Stevenson (12 mi) · B: Hood River (35 mi) | HTTP JSON bootstrap |
| **Skamania Lodge** | Hotel booking signals (~80 rooms) | A | HTTP page scrape |
| **Columbia Gorge Hotel** | Hotel booking signals (~40 rooms) | B | HTTP page scrape |
| **Best Western Hood River Inn** | Hotel booking signals (~60 rooms) | B | HTTP page scrape |
| **recreation.gov API** | Wyeth Campground, Eagle Creek Campground availability | A / B | Public REST API |
| **Oregon State Parks** | Ainsworth, Viento, Memaloose campsite availability | B | Reserve America HTTP POST |
| **Comp auto-discovery** | Skamania treehouses (Airbnb), Wilder & Pine, Tenzen Springs | A | Airbnb search + website probes |

### Comp discovery detail

| Deck comp | Live source |
|-----------|-------------|
| Skamania Lodge — Treehouses | Airbnb listing search + skamania.com/stay/treehouses |
| Wilder & Pine — Cabins | wilderandpine.com/cabins |
| Tenzen Springs — Cabins | tenzensprings.com |

Saved to `data/discovered-comps.json` after each run.

---

## Deck benchmarks (static config — not re-scraped)

From **Roam Hospitality Investor Underwriting Deck (June 2026)** in `config/underwriting.json`:

| Source | Metric | Value |
|--------|--------|-------|
| **CoStar** | Stevenson hotel occupancy (TTM) | 66.3% |
| **AirDNA** | Gorge STR/cabin ADR (12-listing comp, TTM) | $347 |
| **AirDNA** | RevPAR | $197 |
| **AirDNA** | Annual rev per listing | $54,300 |
| **AirROI / deck** | ADR growth assumption | 4% YoY |
| **Deck scenarios** | Conservative / base / upside occ & ADR | 58–70% · $315–375 |

Artbliss revenue bridge uses deck **$347 ADR** unless live comp ADR is shown separately (e.g. Skamania $519 on Airbnb).

---

## Visitor baseline

| Source | Value | Notes |
|--------|-------|-------|
| **Columbia Gorge visitor baseline** | 2,900,000 / year | `config/geo-bounds.json` — Tier B fills residual day-trippers |

---

## Geography

| Tier | Radius | Center | Purpose |
|------|--------|--------|---------|
| **A (primary)** | 12 mi | Stevenson, WA | Deck underwriting comp set |
| **B (extended)** | 35 mi | Hood River corridor | 2.9M visitor reconciliation |

---

## Fallback

If a live scraper fails, **simulation** fills gaps (`config/scraper-sources.json`: `fallback_to_simulation: true`). Occupancy is inferred from booked vs available snapshots over ~30 days — not property P&Ls.

---

## What this is not

- Not the AirDNA API (uses Airbnb search proxy + deck ADR anchor)
- Not CoStar live feed (uses deck TTM benchmark vs live hotel scrape)
- Not trailing-twelve-months for feed occupancy (single ~30-day snapshot, seasonal case adjusts)
