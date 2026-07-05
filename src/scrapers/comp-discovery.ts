import * as cheerio from "cheerio";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeoTier, UnitSnapshot } from "../types.js";
import { loadConfig } from "../config.js";
import { http, sleep } from "./http.js";
import {
  fetchSearchWindow,
  loadScraperSources,
  type ParsedListing,
} from "./airbnb.js";
import { simulateCabinsAndStr } from "./simulation.js";

export interface CompProfile {
  deck_name: string;
  keywords: string[];
  search_queries: string[];
  website_urls: string[];
  units: number;
  tier: GeoTier;
}

export interface DiscoveredComp {
  deck_name: string;
  source: "airbnb" | "website" | "simulation";
  confidence: number;
  listing_id?: string;
  listing_title?: string;
  website_url?: string;
  adr?: number;
  units: number;
  matched_keywords: string[];
}

export interface CompDiscoveryResult {
  discovered: DiscoveredComp[];
  snapshots: UnitSnapshot[];
  unmatched: string[];
  matchedListingIds: Set<string>;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

function scoreListing(title: string, comp: CompProfile): { score: number; matched: string[] } {
  const norm = normalize(title);
  const matched = comp.keywords.filter((kw) => norm.includes(normalize(kw)));
  if (matched.length === 0) return { score: 0, matched: [] };
  const score = (matched.length / comp.keywords.length) * 100;
  // bonus if deck name fragments appear
  if (comp.deck_name.toLowerCase().includes("treehouse") && norm.includes("treehouse")) {
    return { score: Math.min(100, score + 25), matched: [...matched, "treehouse"] };
  }
  return { score, matched };
}

function deckAdr(deckName: string): number | undefined {
  const { underwriting } = loadConfig();
  const comp = underwriting.comp_properties.find((c) => c.name === deckName);
  return comp?.avg_adr ?? underwriting.scenarios.base.blended_adr;
}

function occupancyFromWebsiteHtml(html: string): number {
  const text = cheerio.load(html)("body").text().toLowerCase();
  if (text.includes("sold out") || text.includes("no availability") || text.includes("fully booked")) {
    return 0.9;
  }
  if (text.includes("book now") || text.includes("check availability") || text.includes("reserve")) {
    return 0.72;
  }
  return loadConfig().underwriting.scenarios.base.occupancy_pct / 100;
}

function extractAirbnbIdsFromHtml(html: string): string[] {
  return [...new Set([...html.matchAll(/airbnb\.com\/rooms\/(\d+)/g)].map((m) => m[1]))];
}

async function probeWebsite(url: string): Promise<{ html: string; airbnbIds: string[]; occ: number } | null> {
  try {
    const { data: html } = await http.get<string>(url, { responseType: "text" });
    return { html, airbnbIds: extractAirbnbIdsFromHtml(html), occ: occupancyFromWebsiteHtml(html) };
  } catch {
    return null;
  }
}

function listingSnapshots(
  comp: CompProfile,
  listing: ParsedListing,
  dates: string[],
  source: DiscoveredComp["source"]
): UnitSnapshot[] {
  const adr = listing.adr ?? deckAdr(comp.deck_name);
  const rows: UnitSnapshot[] = [];
  for (const date of dates) {
    rows.push({
      unitId: `${comp.deck_name}#airbnb:${listing.id}`,
      propertyName: comp.deck_name,
      category: "Cabin",
      tier: comp.tier,
      date,
      status: listing.availableDates.has(date) ? "available" : "booked",
      adr,
    });
  }
  return rows;
}

function websiteSnapshots(comp: CompProfile, url: string, occ: number, dates: string[]): UnitSnapshot[] {
  const adr = deckAdr(comp.deck_name);
  const rows: UnitSnapshot[] = [];
  for (let u = 0; u < comp.units; u++) {
    for (const date of dates) {
      const hash = (date.split("-").reduce((a, p) => a + Number(p), 0) * 31 + u * 17) % 100;
      rows.push({
        unitId: `${comp.deck_name}#${u + 1}`,
        propertyName: comp.deck_name,
        category: "Cabin",
        tier: comp.tier,
        date,
        status: hash / 100 < occ ? "booked" : "available",
        adr,
      });
    }
  }
  return rows;
}

function saveDiscovery(discovered: DiscoveredComp[]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = join(root, "data");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "discovered-comps.json"), JSON.stringify({ updated: new Date().toISOString(), discovered }, null, 2));
}

export async function discoverDeckComps(
  listings: Map<string, ParsedListing>,
  dates: string[]
): Promise<CompDiscoveryResult> {
  const sources = loadScraperSources();
  const cfg = sources.comp_discovery;
  if (!cfg?.enabled) {
    return { discovered: [], snapshots: [], unmatched: [], matchedListingIds: new Set() };
  }

  const threshold = (cfg as { match_score_threshold?: number }).match_score_threshold ?? 55;
  const comps = cfg.comps as CompProfile[];
  const discovered: DiscoveredComp[] = [];
  const snapshots: UnitSnapshot[] = [];
  const matchedListingIds = new Set<string>();
  const matchedComps = new Set<string>();

  console.log("  [comp-discovery] Matching deck comps...");

  // 1) Match against pooled Airbnb results
  for (const comp of comps) {
    let best: { listing: ParsedListing; score: number; matched: string[] } | null = null;
    for (const listing of listings.values()) {
      const { score, matched } = scoreListing(listing.title, comp);
      if (score >= threshold && (!best || score > best.score)) {
        best = { listing, score, matched };
      }
    }
    if (best) {
      matchedComps.add(comp.deck_name);
      matchedListingIds.add(best.listing.id);
      discovered.push({
        deck_name: comp.deck_name,
        source: "airbnb",
        confidence: best.score,
        listing_id: best.listing.id,
        listing_title: best.listing.title,
        adr: best.listing.adr ?? deckAdr(comp.deck_name),
        units: comp.units,
        matched_keywords: best.matched,
      });
      snapshots.push(...listingSnapshots(comp, best.listing, dates, "airbnb"));
      console.log(`  [comp-discovery] ${comp.deck_name} -> Airbnb "${best.listing.title}" (${best.score.toFixed(0)}%)`);
    }
  }

  // 2) Targeted Airbnb searches for unmatched
  const areaA = sources.airbnb_searches.find((s) => s.tier === "A");
  for (const comp of comps.filter((c) => !matchedComps.has(c.deck_name))) {
    for (const query of comp.search_queries) {
      try {
        const checkin = dates[0];
        const checkout = dates[Math.min(7, dates.length - 1)] ?? dates[0];
        const found = await fetchSearchWindow(query, comp.tier, checkin, checkout, areaA);
        await sleep(sources.request_delay_ms);

        let best: { listing: ParsedListing; score: number; matched: string[] } | null = null;
        for (const listing of found) {
          const { score, matched } = scoreListing(listing.title, comp);
          if (score >= threshold && (!best || score > best.score)) {
            best = { listing, score, matched };
          }
        }
        if (best) {
          matchedComps.add(comp.deck_name);
          matchedListingIds.add(best.listing.id);
          listings.set(best.listing.id, best.listing);
          discovered.push({
            deck_name: comp.deck_name,
            source: "airbnb",
            confidence: best.score,
            listing_id: best.listing.id,
            listing_title: best.listing.title,
            adr: best.listing.adr ?? deckAdr(comp.deck_name),
            units: comp.units,
            matched_keywords: best.matched,
          });
          snapshots.push(...listingSnapshots(comp, best.listing, dates, "airbnb"));
          console.log(`  [comp-discovery] ${comp.deck_name} -> Airbnb search "${best.listing.title}" (${best.score.toFixed(0)}%)`);
          break;
        }
      } catch (err) {
        console.warn(`  [comp-discovery] search "${query}": ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // 3) Website probe for still-unmatched
  for (const comp of comps.filter((c) => !matchedComps.has(c.deck_name))) {
    for (const url of comp.website_urls) {
      const probe = await probeWebsite(url);
      await sleep(300);
      if (!probe) continue;

      if (probe.airbnbIds.length > 0) {
        const id = probe.airbnbIds[0];
        const pseudo: ParsedListing = {
          id,
          title: comp.deck_name,
          tier: comp.tier,
          adr: deckAdr(comp.deck_name),
          availableDates: new Set(dates),
        };
        matchedComps.add(comp.deck_name);
        matchedListingIds.add(id);
        discovered.push({
          deck_name: comp.deck_name,
          source: "website",
          confidence: 75,
          listing_id: id,
          website_url: url,
          adr: deckAdr(comp.deck_name),
          units: comp.units,
          matched_keywords: ["airbnb-link-on-site"],
        });
        snapshots.push(...listingSnapshots(comp, pseudo, dates, "website"));
        console.log(`  [comp-discovery] ${comp.deck_name} -> Airbnb ID ${id} from ${url}`);
        break;
      }

      matchedComps.add(comp.deck_name);
      discovered.push({
        deck_name: comp.deck_name,
        source: "website",
        confidence: 65,
        website_url: url,
        adr: deckAdr(comp.deck_name),
        units: comp.units,
        matched_keywords: ["website-booking-signals"],
      });
      snapshots.push(...websiteSnapshots(comp, url, probe.occ, dates));
      console.log(`  [comp-discovery] ${comp.deck_name} -> website ${url} (~${Math.round(probe.occ * 100)}% occ proxy)`);
      break;
    }
  }

  const unmatched = comps.filter((c) => !matchedComps.has(c.deck_name)).map((c) => c.deck_name);

  // 4) Simulation fallback for unmatched only
  if (unmatched.length > 0) {
    console.warn(`  [comp-discovery] Unmatched (simulation fallback): ${unmatched.join(", ")}`);
    const simAll = simulateCabinsAndStr("A", dates);
    for (const name of unmatched) {
      snapshots.push(...simAll.filter((s) => s.propertyName.includes(name.split(" ")[0]) || s.propertyName === name));
      discovered.push({
        deck_name: name,
        source: "simulation",
        confidence: 0,
        units: comps.find((c) => c.deck_name === name)?.units ?? 1,
        matched_keywords: [],
      });
    }
    // If sim filter missed, add generic sim rows for comp names from seed
    for (const name of unmatched) {
      if (!snapshots.some((s) => s.propertyName === name)) {
        const comp = comps.find((c) => c.deck_name === name)!;
        const simRows = simulateCabinsAndStr("A", dates).filter((s) =>
          s.propertyName.toLowerCase().includes(normalize(name).split(" ")[0])
        );
        if (simRows.length) snapshots.push(...simRows);
        else {
          const occ = loadConfig().underwriting.scenarios.base.occupancy_pct / 100;
          for (let u = 0; u < comp.units; u++) {
            for (const date of dates) {
              const hash = (date.split("-").reduce((a, p) => a + Number(p), 0) * 31 + u * 17) % 100;
              snapshots.push({
                unitId: `${name}#${u + 1}`,
                propertyName: name,
                category: "Cabin",
                tier: "A",
                date,
                status: hash / 100 < occ ? "booked" : "available",
                adr: deckAdr(name),
              });
            }
          }
        }
      }
    }
  }

  saveDiscovery(discovered);
  return { discovered, snapshots, unmatched, matchedListingIds };
}

export function filterNonCompListings(
  listings: Map<string, ParsedListing>,
  matchedIds: Set<string>
): Map<string, ParsedListing> {
  const out = new Map<string, ParsedListing>();
  for (const [id, listing] of listings) {
    if (!matchedIds.has(id)) out.set(id, listing);
  }
  return out;
}
