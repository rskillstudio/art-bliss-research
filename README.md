# Art Bliss Market Intelligence Engine

Hyper-local occupancy proxy and visitor segmentation for the **Artbliss** cabin portfolio in **Stevenson, WA**. Configured from the Roam Hospitality investor underwriting deck (June 2026).

## Strategy

| Tier | Purpose | Radius | Stay types |
|------|---------|--------|------------|
| **A — Primary** | Direct deck underwriting | 12 mi from Stevenson | Boutique **Cabins** + **STR** + Stevenson **Hotels** |
| **B — Extended** | Fill 2.9M annual visitor baseline | 35 mi (Gorge corridor) | Hotels, STR, Cabins, **Campsites** |

Tier A matches the deck comp set: Skamania Lodge Treehouses, Wilder & Pine, Tenzen Springs, CoStar Stevenson hotel submarket (66.3% occ), AirDNA 12-listing STR benchmark ($347 ADR).

Tier B exists only to reconcile overnight lodging against the **2,900,000** annual visitor figure and isolate the **Day Tripper** residual.

## Quick start

```bash
cd art-bliss-research
npm install
npm run run          # scrape -> analyze -> export
```

Individual steps:

```bash
npm run scrape       # collect availability snapshots
npm run analyze      # print occupancy metrics
npm run report       # export CSV/JSON segmentation
```

## Outputs

Written to `data/exports/`:

| File | Contents |
|------|----------|
| `occupancy-tier-a-primary.csv` | Deck-aligned Stevenson comp set metrics |
| `occupancy-tier-b-extended.csv` | Gorge-wide fill for visitor reconciliation |
| `occupancy-all.csv` | Combined |
| `visitor-segmentation.json` | Full segmentation + day tripper residual |
| `deck-comparison.md` | **Deck vs feed comparison report** (parallel to Roam deck) |
| `deck-comparison.json` | Same comparison in structured JSON |
| `data/discovered-comps.json` | Auto-discovered comp sources (Airbnb ID, website URL, confidence) |

## Config (from deck)

| File | Source |
|------|--------|
| `config/geo-bounds.json` | Stevenson primary / Gorge extended tiers |
| `config/underwriting.json` | CoStar 66.3%, AirDNA $347, scenario matrix |
| `config/lodging-seed.csv` | Skamania, Wilder & Pine, Tenzen Springs + hotels |
| `config/campsites.json` | Tier B campgrounds (visitor fill only) |

## Deck benchmarks (reference)

| Metric | Value |
|--------|-------|
| CoStar hotel occupancy (TTM) | 66.3% |
| AirDNA ADR (12-listing comp) | $347 |
| Base scenario | 65% occ @ $347 ADR |
| Peak season (Jun-Aug) | 80.9% occ / $361 ADR |
| Off-peak (Dec-Feb) | 38.9% occ / $345 ADR |

## Architecture

```
src/scrapers/     -> Cabin/STR, hotel OTA, campsite availability
src/engine/       -> Daily snapshot storage (JSON) + occupancy calculator
src/reports/      -> Missing Data Solver -> visitor segmentation export
config/           -> Geo tiers, deck comps, campsite parsing rules
```

## Live scrapers (wired)

| Source | Module | Method |
|--------|--------|--------|
| **Airbnb STR** | `src/scrapers/airbnb.ts` | Search JSON bootstrap — Stevenson + Hood River weekly windows |
| **Recreation.gov** | `src/scrapers/recreation-gov.ts` | Public availability API (Wyeth, Eagle Creek) |
| **Oregon State Parks** | `src/scrapers/oregon-parks.ts` | HTTP — Reserve America HTML (Ainsworth, Viento, Memaloose) |
| **Hotels** | `src/scrapers/hotels.ts` | HTTP — property pages (Skamania, Columbia Gorge, Hood River Inn) |
| **Deck comp cabins** | `src/scrapers/comp-discovery.ts` | Auto-match Airbnb + probe official sites (Skamania, Wilder & Pine, Tenzen) |

No browser install required — all scrapers use HTTP + JSON/HTML parsing (axios + cheerio).

If a live source fails, the engine falls back to deck-calibrated simulation for that segment (`config/scraper-sources.json` → `fallback_to_simulation`).

Keep Tier A scrapes tight to Stevenson. Only expand to Tier B when segment totals fall short of the 2.9M baseline.

## Reference

Roam Hospitality — Artbliss Investor Underwriting Deck (June 2026), in the parent `Art Bliss` folder.
