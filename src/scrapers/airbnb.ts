import type { GeoTier, UnitSnapshot } from "../types.js";
import { haversineMiles } from "../config.js";
import { decodeAirbnbListingId, http, parsePriceAmount, sleep } from "./http.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AirbnbSearchConfig {
  label: string;
  tier: GeoTier;
  query: string;
  lat: number;
  lng: number;
  radius_miles: number;
}

export interface ParsedListing {
  id: string;
  title: string;
  tier: GeoTier;
  lat?: number;
  lng?: number;
  adr?: number;
  availableDates: Set<string>;
}

export function loadScraperSources() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  return JSON.parse(readFileSync(join(root, "config/scraper-sources.json"), "utf-8")) as {
    airbnb_searches: AirbnbSearchConfig[];
    snapshot_days: number;
    request_delay_ms: number;
    comp_discovery?: { enabled: boolean; comps: { search_queries: string[] }[] };
  };
}

export function extractListingsFromHtml(html: string, tier: GeoTier): ParsedListing[] {
  const listings = new Map<string, ParsedListing>();
  const scripts = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)];

  for (const [, raw] of scripts) {
    if (raw.length < 50000) continue;
    try {
      walkJson(JSON.parse(raw), tier, listings);
    } catch {
      /* skip malformed */
    }
  }
  return [...listings.values()];
}

function walkJson(
  node: unknown,
  tier: GeoTier,
  listings: Map<string, ParsedListing>
): void {
  if (Array.isArray(node)) {
    for (const item of node) walkJson(item, tier, listings);
    return;
  }
  if (!node || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  if (obj.__typename === "StaySearchResult") {
    const demand = obj.demandStayListing as Record<string, unknown> | undefined;
    const encoded = demand?.id as string | undefined;
    const numericId = encoded ? decodeAirbnbListingId(encoded) : null;
    if (!numericId) return;

    const priceLine = (obj.structuredDisplayPrice as Record<string, unknown> | undefined)?.primaryLine as
      | Record<string, unknown>
      | undefined;
    const location = demand?.location as Record<string, unknown> | undefined;
    const coord = location?.coordinate as Record<string, unknown> | undefined;
    const nameLocalized = obj.nameLocalized as Record<string, unknown> | undefined;

    listings.set(numericId, {
      id: numericId,
      title:
        (obj.title as string) ??
        (nameLocalized?.localizedStringWithTranslationPreference as string) ??
        numericId,
      tier,
      lat: coord?.latitude as number | undefined,
      lng: coord?.longitude as number | undefined,
      adr: parsePriceAmount(priceLine?.price as string),
      availableDates: listings.get(numericId)?.availableDates ?? new Set(),
    });
  }

  for (const value of Object.values(obj)) walkJson(value, tier, listings);
}

function filterByRadius(listings: ParsedListing[], search: AirbnbSearchConfig): ParsedListing[] {
  return listings.filter((l) => {
    if (l.lat == null || l.lng == null) return true;
    return haversineMiles(l.lat, l.lng, search.lat, search.lng) <= search.radius_miles;
  });
}

export async function fetchSearchWindow(
  locationQuery: string,
  tier: GeoTier,
  checkin: string,
  checkout: string,
  radiusFilter?: AirbnbSearchConfig
): Promise<ParsedListing[]> {
  const areaSlug =
    radiusFilter?.query ??
    (tier === "A" ? "Stevenson--WA--United-States" : "Hood-River--OR--United-States");
  const fullUrl = `https://www.airbnb.com/s/${areaSlug}/homes?query=${encodeURIComponent(locationQuery)}&checkin=${checkin}&checkout=${checkout}&adults=2`;
  const { data: html } = await http.get<string>(fullUrl, { responseType: "text" });
  const found = extractListingsFromHtml(html, tier);
  return radiusFilter ? filterByRadius(found, radiusFilter) : found;
}

function buildWindows(dates: string[]) {
  const windows: { checkin: string; checkout: string; dates: string[] }[] = [];
  for (let i = 0; i < dates.length; i += 7) {
    const chunk = dates.slice(i, i + 7);
    if (chunk.length < 2) continue;
    const checkoutDate = new Date(chunk[chunk.length - 1]);
    checkoutDate.setDate(checkoutDate.getDate() + 1);
    windows.push({
      checkin: chunk[0],
      checkout: checkoutDate.toISOString().slice(0, 10),
      dates: chunk,
    });
  }
  return windows;
}

function mergeListing(into: Map<string, ParsedListing>, item: ParsedListing, windowDates: string[]) {
  const existing = into.get(item.id) ?? { ...item, availableDates: new Set<string>() };
  for (const d of windowDates) existing.availableDates.add(d);
  into.set(item.id, existing);
}

/** Search Airbnb across geo windows; optionally add comp-specific queries. */
export async function searchAllAirbnbListings(
  dates: string[],
  extraQueries: { query: string; tier: GeoTier }[] = []
): Promise<Map<string, ParsedListing>> {
  const sources = loadScraperSources();
  const listings = new Map<string, ParsedListing>();
  const windows = buildWindows(dates);

  for (const search of sources.airbnb_searches) {
    console.log(`  [airbnb] Searching ${search.label}...`);
    for (const window of windows) {
      try {
        const found = await fetchSearchWindow(search.query.replace(/-/g, " "), search.tier, window.checkin, window.checkout, search);
        for (const item of found) mergeListing(listings, item, window.dates);
        await sleep(sources.request_delay_ms);
      } catch (err) {
        console.warn(`  [airbnb] ${search.label} ${window.checkin}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  for (const { query, tier } of extraQueries) {
    console.log(`  [airbnb] Comp query: "${query}"...`);
    const area = sources.airbnb_searches.find((s) => s.tier === tier);
    for (const window of windows) {
      try {
        const found = await fetchSearchWindow(query, tier, window.checkin, window.checkout, area);
        for (const item of found) mergeListing(listings, item, window.dates);
        await sleep(sources.request_delay_ms);
      } catch (err) {
        console.warn(`  [airbnb] comp "${query}": ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  return listings;
}

export function listingsToSnapshots(listings: Map<string, ParsedListing>, dates: string[]): UnitSnapshot[] {
  const snapshots: UnitSnapshot[] = [];
  for (const listing of listings.values()) {
    for (const date of dates) {
      snapshots.push({
        unitId: `airbnb:${listing.id}`,
        propertyName: listing.title,
        category: "STR",
        tier: listing.tier,
        date,
        status: listing.availableDates.has(date) ? "available" : "booked",
        adr: listing.adr,
      });
    }
  }
  return snapshots;
}

export async function scrapeAirbnbListings(dates: string[]): Promise<UnitSnapshot[]> {
  const listings = await searchAllAirbnbListings(dates);
  const snapshots = listingsToSnapshots(listings, dates);
  console.log(`  [airbnb] ${listings.size} listings, ${snapshots.length} snapshot rows`);
  return snapshots;
}
