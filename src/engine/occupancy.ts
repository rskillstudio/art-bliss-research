import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CategoryMetrics, LodgingCategory, ScraperResult, UnitSnapshot } from "../types.js";
import { loadConfig } from "../config.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const storePath = join(root, "data", "snapshots.json");

interface StoredSnapshot extends UnitSnapshot {
  scraped_at: string;
  source: string;
}

function ensureDataDir() {
  mkdirSync(dirname(storePath), { recursive: true });
}

function readStore(): StoredSnapshot[] {
  if (!existsSync(storePath)) return [];
  return JSON.parse(readFileSync(storePath, "utf-8")) as StoredSnapshot[];
}

function writeStore(rows: StoredSnapshot[]) {
  ensureDataDir();
  writeFileSync(storePath, JSON.stringify(rows, null, 2));
}

export function persistScraperResults(results: ScraperResult[]): number {
  const existing = readStore();
  const incoming: StoredSnapshot[] = results.flatMap((result) =>
    result.snapshots.map((s) => ({
      ...s,
      scraped_at: result.scraped_at,
      source: result.source,
    }))
  );
  writeStore([...existing, ...incoming]);
  return incoming.length;
}

function occupancyFromSnapshots(snapshots: UnitSnapshot[]): number {
  const relevant = snapshots.filter((s) => s.status !== "closed_season" && s.status !== "unknown");
  if (relevant.length === 0) return 0;
  const booked = relevant.filter((s) => s.status === "booked").length;
  return (booked / relevant.length) * 100;
}

function uniqueUnits(snapshots: UnitSnapshot[]): number {
  return new Set(snapshots.map((s) => s.unitId)).size;
}

function annualizeVisitors(
  occupiedUnitNights: number,
  category: LodgingCategory,
  daysObserved: number
): number {
  const { segmentation_defaults: seg } = loadConfig().underwriting;
  const partySize = category === "Campsite" ? seg.persons_per_campsite : seg.avg_party_size;
  const dailyVisitors = (occupiedUnitNights / daysObserved) * partySize;
  return Math.round(dailyVisitors * 365);
}

export function calculateOccupancyMetrics(
  results: ScraperResult[],
  focusTier: "A" | "B" | "all" = "A"
): CategoryMetrics[] {
  const timestamp = new Date().toISOString();
  const allSnapshots = results.flatMap((r) => r.snapshots);
  const filtered =
    focusTier === "all" ? allSnapshots : allSnapshots.filter((s) => s.tier === focusTier);

  const categories: LodgingCategory[] = ["Cabin", "STR", "Hotel", "Campsite"];
  const metrics: CategoryMetrics[] = [];

  for (const category of categories) {
    const catSnapshots = filtered.filter((s) => s.category === category);
    if (catSnapshots.length === 0) continue;

    const dates = [...new Set(catSnapshots.map((s) => s.date))];
    const daysObserved = dates.length || 1;
    const occupiedNights = catSnapshots.filter((s) => s.status === "booked").length;

    metrics.push({
      timestamp,
      lodging_category: category,
      geo_tier: focusTier === "all" ? "B" : focusTier,
      total_units_tracked: uniqueUnits(catSnapshots),
      estimated_occupancy_rate: Math.round(occupancyFromSnapshots(catSnapshots) * 10) / 10,
      implied_visitor_count: annualizeVisitors(occupiedNights, category, daysObserved),
    });
  }

  return metrics;
}

export function loadLatestSnapshots(): UnitSnapshot[] {
  const rows = readStore();
  if (rows.length === 0) return [];
  const latest = rows.reduce((max, r) => (r.scraped_at > max ? r.scraped_at : max), rows[0].scraped_at);
  return rows
    .filter((r) => r.scraped_at === latest)
    .map(({ scraped_at: _s, source: _src, ...rest }) => rest);
}

export function loadStoredScraperResults(): ScraperResult[] {
  const rows = readStore();
  if (rows.length === 0) return [];

  const latestBySource = new Map<string, string>();
  for (const row of rows) {
    const prev = latestBySource.get(row.source);
    if (!prev || row.scraped_at > prev) {
      latestBySource.set(row.source, row.scraped_at);
    }
  }

  const latestRows = rows.filter((r) => latestBySource.get(r.source) === r.scraped_at);
  const byKey = new Map<string, StoredSnapshot[]>();
  for (const row of latestRows) {
    const key = `${row.source}|${row.tier}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  const scrapedAt = latestRows.reduce(
    (max, r) => (r.scraped_at > max ? r.scraped_at : max),
    latestRows[0].scraped_at
  );

  return [...byKey.entries()].map(([key, group]) => {
    const [source, tier] = key.split("|") as [string, "A" | "B"];
    return {
      source,
      tier,
      scraped_at: scrapedAt,
      snapshots: group.map(({ scraped_at: _s, source: _src, ...rest }) => rest),
    };
  });
}
