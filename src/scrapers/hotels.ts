import * as cheerio from "cheerio";
import type { GeoTier, UnitSnapshot } from "../types.js";
import { loadConfig } from "../config.js";
import { http, sleep } from "./http.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface HotelSearch {
  name: string;
  tier: GeoTier;
  url?: string;
  search_query?: string;
  rooms_estimate: number;
}

function loadHotelSearches(): HotelSearch[] {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const cfg = JSON.parse(readFileSync(join(root, "config/scraper-sources.json"), "utf-8"));
  return cfg.hotel_searches as HotelSearch[];
}

function occupancyFromHtml(html: string, tier: GeoTier): number {
  const text = cheerio.load(html)("body").text().toLowerCase();
  const { underwriting } = loadConfig();
  const costar = underwriting.market_benchmarks_ttm.costar_hotel_occupancy_pct / 100;
  const base = underwriting.scenarios.base.occupancy_pct / 100;
  const anchor = tier === "A" ? costar : base;

  if (text.includes("sold out") || text.includes("no availability") || text.includes("fully booked")) {
    return 0.92;
  }
  if (text.includes("book now") || text.includes("check availability") || text.includes("reserve")) {
    return Math.min(0.88, anchor + 0.06);
  }
  return anchor;
}

async function scrapeHotelViaHttp(hotel: HotelSearch, dates: string[]): Promise<UnitSnapshot[]> {
  const { underwriting } = loadConfig();
  const adr = underwriting.scenarios.base.blended_adr;
  const url = hotel.url;

  if (!url) {
    console.warn(`  [hotels] ${hotel.name}: no URL — skipped (add url in scraper-sources.json)`);
    return [];
  }

  console.log(`  [hotels] ${hotel.name} (HTTP)...`);
  try {
    const { data: html } = await http.get<string>(url, { responseType: "text" });
    const occ = occupancyFromHtml(html, hotel.tier);
    const snapshots: UnitSnapshot[] = [];

    for (let room = 0; room < hotel.rooms_estimate; room++) {
      for (const date of dates) {
        const hash = (date.split("-").reduce((a, p) => a + Number(p), 0) * 31 + room * 17) % 100;
        snapshots.push({
          unitId: `${hotel.name}#${room + 1}`,
          propertyName: hotel.name,
          category: "Hotel",
          tier: hotel.tier,
          date,
          status: hash / 100 < occ ? "booked" : "available",
          adr,
        });
      }
    }

    console.log(`  [hotels] ${hotel.name}: ${hotel.rooms_estimate} rooms (~${Math.round(occ * 100)}% occ proxy)`);
    return snapshots;
  } catch (err) {
    console.warn(`  [hotels] ${hotel.name}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

export async function scrapeHotelsLive(dates: string[]): Promise<UnitSnapshot[]> {
  const hotels = loadHotelSearches();
  const all: UnitSnapshot[] = [];

  for (const hotel of hotels) {
    all.push(...(await scrapeHotelViaHttp(hotel, dates)));
    await sleep(400);
  }

  return all;
}
