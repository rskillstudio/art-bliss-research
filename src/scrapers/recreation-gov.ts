import type { AvailabilityStatus, UnitSnapshot } from "../types.js";
import { loadConfig } from "../config.js";
import { http, monthStart, sleep } from "./http.js";

interface RecGovMonthResponse {
  campsites?: Record<
    string,
    {
      campsite_id?: string;
      site?: string;
      availabilities?: Record<string, string>;
    }
  >;
}

function mapStatus(raw: string, rules: { booked: string[]; available: string[] }): AvailabilityStatus {
  if (rules.available.some((s) => raw.toLowerCase().includes(s.toLowerCase()))) return "available";
  if (raw === "Not Reservable" || raw === "Closed") return "closed_season";
  if (rules.booked.some((s) => raw.toLowerCase().includes(s.toLowerCase()))) return "booked";
  if (raw === "Not Released" || raw === "Not Yet Released") return "blocked";
  return "unknown";
}

function inSeason(date: string, open: string, close: string): boolean {
  const monthDay = date.slice(5);
  return monthDay >= open && monthDay <= close;
}

export async function scrapeRecreationGovCampsites(dates: string[]): Promise<UnitSnapshot[]> {
  const { campsites } = loadConfig();
  const facilities = campsites.facilities.filter((f) => f.source === "recreation.gov");
  const rules = campsites.parsing_rules as {
    recreation_gov_booked_statuses?: string[];
    recreation_gov_available_statuses?: string[];
  };
  const booked = rules.recreation_gov_booked_statuses ?? ["Reserved", "Not Available"];
  const available = rules.recreation_gov_available_statuses ?? ["Available", "Open"];

  const snapshots: UnitSnapshot[] = [];
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];

  for (const facility of facilities) {
    const siteAvailability = new Map<string, Map<string, AvailabilityStatus>>();

    for (const month of months) {
      const startDate = monthStart(new Date(`${month}-01T12:00:00Z`));
      const url = `https://www.recreation.gov/api/camps/availability/campground/${facility.facility_id}/month?start_date=${encodeURIComponent(startDate)}`;
      try {
        const { data } = await http.get<RecGovMonthResponse>(url);
        for (const [siteKey, site] of Object.entries(data.campsites ?? {})) {
          const unitId = `${facility.name}#${site.site ?? siteKey}`;
          if (!siteAvailability.has(unitId)) siteAvailability.set(unitId, new Map());
          const map = siteAvailability.get(unitId)!;
          for (const [iso, status] of Object.entries(site.availabilities ?? {})) {
            const day = iso.slice(0, 10);
            map.set(day, mapStatus(status, { booked, available }));
          }
        }
        await sleep(400);
      } catch (err) {
        console.warn(`  [recreation.gov] ${facility.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    for (const [unitId, days] of siteAvailability) {
      for (const date of dates) {
        if (!inSeason(date, facility.season_open ?? "01-01", facility.season_close ?? "12-31")) {
          snapshots.push({
            unitId,
            propertyName: facility.name,
            category: "Campsite",
            tier: facility.tier,
            date,
            status: "closed_season",
          });
          continue;
        }
        snapshots.push({
          unitId,
          propertyName: facility.name,
          category: "Campsite",
          tier: facility.tier,
          date,
          status: days.get(date) ?? "unknown",
        });
      }
    }
  }

  return snapshots;
}
