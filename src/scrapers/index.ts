import type { GeoTier, ScraperResult, UnitSnapshot } from "../types.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dateRange } from "./http.js";
import { scrapeRecreationGovCampsites } from "./recreation-gov.js";
import {
  listingsToSnapshots,
  loadScraperSources,
  searchAllAirbnbListings,
} from "./airbnb.js";
import { discoverDeckComps, filterNonCompListings } from "./comp-discovery.js";
import { scrapeOregonStateParks } from "./oregon-parks.js";
import { scrapeHotelsLive } from "./hotels.js";
import { simulateCabinsAndStr, simulateCampsites, simulateHotels } from "./simulation.js";

function loadScraperConfig() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  return JSON.parse(readFileSync(join(root, "config/scraper-sources.json"), "utf-8")) as {
    snapshot_days: number;
    fallback_to_simulation: boolean;
  };
}

function result(source: string, tier: GeoTier, snapshots: UnitSnapshot[]): ScraperResult {
  return { source, tier, snapshots, scraped_at: new Date().toISOString() };
}

function mergeOrFallback(live: UnitSnapshot[], simulated: UnitSnapshot[], label: string): UnitSnapshot[] {
  if (live.length > 0) {
    console.log(`  [${label}] live: ${live.length} rows`);
    return live;
  }
  console.warn(`  [${label}] live empty — using simulation (${simulated.length} rows)`);
  return simulated;
}

export async function scrapeCabinsAndStr(tier: GeoTier = "A"): Promise<ScraperResult> {
  const cfg = loadScraperConfig();
  const dates = dateRange(cfg.snapshot_days);
  const simulated = simulateCabinsAndStr(tier, dates);

  if (tier === "A") {
    const sources = loadScraperSources();
    const compQueries = (sources.comp_discovery?.comps ?? []).flatMap((c) =>
      c.search_queries.map((q) => ({ query: q, tier: "A" as const }))
    );
    const listings = await searchAllAirbnbListings(dates, compQueries);
    const { snapshots: compSnapshots, matchedListingIds, discovered } = await discoverDeckComps(listings, dates);

    const strOnly = filterNonCompListings(listings, matchedListingIds);
    const strSnapshots = listingsToSnapshots(strOnly, dates).map((s) => ({ ...s, tier: "A" as const }));

    const liveCount = discovered.filter((d) => d.source !== "simulation").length;
    console.log(`  [comp-discovery] ${liveCount}/${discovered.length} comps live`);

    const merged = [...strSnapshots, ...compSnapshots];
    return result("airbnb_str+comps_auto", tier, mergeOrFallback(merged, simulated, "cabins/str A"));
  }

  const listings = await searchAllAirbnbListings(dates);
  const live = listingsToSnapshots(listings, dates).filter((s) => s.tier === "B");
  return result("airbnb_str_extended", tier, mergeOrFallback(live, simulated, "cabins/str B"));
}

export async function scrapeHotels(tier: GeoTier): Promise<ScraperResult> {
  const cfg = loadScraperConfig();
  const dates = dateRange(cfg.snapshot_days);
  const simulated = simulateHotels(tier, dates);
  const liveAll = await scrapeHotelsLive(dates);
  const live = liveAll.filter((s) => s.tier === tier);
  return result(tier === "A" ? "hotels_stevenson_live" : "hotels_gorge_live", tier, mergeOrFallback(live, simulated, `hotels ${tier}`));
}

export async function scrapeCampsites(): Promise<ScraperResult> {
  const cfg = loadScraperConfig();
  const dates = dateRange(cfg.snapshot_days);
  const simulated = simulateCampsites(dates);

  console.log("  [campsites] recreation.gov...");
  const recGov = await scrapeRecreationGovCampsites(dates);
  console.log("  [campsites] Oregon state parks (HTTP)...");
  const orParks = await scrapeOregonStateParks(dates);
  const live = [...recGov, ...orParks];

  return result("campsites_live", "B", mergeOrFallback(live, simulated, "campsites"));
}

export async function runAllScrapers(): Promise<ScraperResult[]> {
  console.log("Running live scrapers...");
  return [
    await scrapeCabinsAndStr("A"),
    await scrapeHotels("A"),
    await scrapeCabinsAndStr("B"),
    await scrapeHotels("B"),
    await scrapeCampsites(),
  ];
}
