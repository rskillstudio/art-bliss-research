import type { GeoTier, ScraperResult, UnitSnapshot } from "../types.js";
import { loadConfig } from "../config.js";
import { dateRange } from "./http.js";

function simulateOccupancy(baseRate: number, date: string, salt = 0): boolean {
  const month = new Date(date).getMonth() + 1;
  const seasonal =
    month >= 6 && month <= 8 ? baseRate + 0.15 : month <= 2 || month === 12 ? baseRate - 0.25 : baseRate;
  const clamped = Math.min(0.95, Math.max(0.05, seasonal));
  const hash = date.split("-").reduce((a, p) => a + Number(p), 0);
  return ((hash * 31 + salt * 17) % 100) / 100 < clamped;
}

function compAdr(name: string): number | undefined {
  const { underwriting } = loadConfig();
  const match = underwriting.comp_properties.find((c) =>
    name.toLowerCase().includes(c.name.split(" ")[0].toLowerCase())
  );
  return match?.avg_adr ?? underwriting.scenarios.base.blended_adr;
}

export function simulateCabinsAndStr(tier: GeoTier, dates: string[]): UnitSnapshot[] {
  const { underwriting, lodgingSeed } = loadConfig();
  const baseOcc = underwriting.scenarios.base.occupancy_pct / 100;
  const targets = lodgingSeed.filter(
    (r) => r.tier === tier && (r.category === "Cabin" || r.category === "STR")
  );
  const snapshots: UnitSnapshot[] = [];

  for (const row of targets) {
    const unitCount = row.units ?? 1;
    for (let u = 0; u < unitCount; u++) {
      for (const date of dates) {
        snapshots.push({
          unitId: `${row.name}#${u + 1}`,
          propertyName: row.name,
          category: row.category === "STR" ? "STR" : "Cabin",
          tier,
          date,
          status: simulateOccupancy(baseOcc, date, u) ? "booked" : "available",
          adr: row.deck_comp ? compAdr(row.name) : underwriting.scenarios.base.blended_adr,
        });
      }
    }
  }
  return snapshots;
}

export function simulateHotels(tier: GeoTier, dates: string[]): UnitSnapshot[] {
  const { underwriting, lodgingSeed } = loadConfig();
  const occ =
    tier === "A"
      ? underwriting.market_benchmarks_ttm.costar_hotel_occupancy_pct / 100
      : underwriting.scenarios.base.occupancy_pct / 100;
  const hotels = lodgingSeed.filter((r) => r.tier === tier && r.category === "Hotel");
  const snapshots: UnitSnapshot[] = [];
  const roomsPerHotel = tier === "A" ? 80 : 60;

  for (const hotel of hotels) {
    for (let room = 0; room < roomsPerHotel; room++) {
      for (const date of dates) {
        snapshots.push({
          unitId: `${hotel.name}#${room + 1}`,
          propertyName: hotel.name,
          category: "Hotel",
          tier,
          date,
          status: simulateOccupancy(occ, date, room) ? "booked" : "available",
          adr: underwriting.scenarios.base.blended_adr,
        });
      }
    }
  }
  return snapshots;
}

export function simulateCampsites(dates: string[]): UnitSnapshot[] {
  const { campsites } = loadConfig();
  const snapshots: UnitSnapshot[] = [];
  const baseOcc = 0.55;

  for (const facility of campsites.facilities) {
    const sites = facility.tier === "A" ? 16 : 30;
    for (let s = 0; s < sites; s++) {
      for (const date of dates) {
        const month = new Date(date).getMonth() + 1;
        const inSeason = month >= 4 && month <= 10;
        snapshots.push({
          unitId: `${facility.name}#${s + 1}`,
          propertyName: facility.name,
          category: "Campsite",
          tier: facility.tier,
          date,
          status: !inSeason ? "closed_season" : simulateOccupancy(baseOcc, date, s) ? "booked" : "available",
        });
      }
    }
  }
  return snapshots;
}
