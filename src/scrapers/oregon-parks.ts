import * as cheerio from "cheerio";
import type { UnitSnapshot } from "../types.js";
import { loadConfig } from "../config.js";
import { http, sleep } from "./http.js";

function inSeason(date: string, open: string, close: string): boolean {
  const monthDay = date.slice(5);
  return monthDay >= open && monthDay <= close;
}

interface SiteRow {
  site: string;
  status: "available" | "booked";
}

/** Parse availability counts from Reserve America HTML (no browser required). */
function parseAvailabilityCounts(html: string): { available: number; reserved: number } {
  const $ = cheerio.load(html);
  const text = $("body").text().toLowerCase();

  // Prefer explicit site table rows when present
  const rows: SiteRow[] = [];
  $("#shoppingitems tr.br, table.shoppingitems tr").each((_, row) => {
    const label = $(row).find(".siteListLabel, .site-label").text().trim();
    const last = $(row).find("td").last().text().trim().toLowerCase();
    if (!label) return;
    const booked = last.includes("reserved") || last.includes("not avail") || last.includes("unavailable");
    rows.push({ site: label, status: booked ? "booked" : "available" });
  });

  if (rows.length > 0) {
    return {
      available: rows.filter((r) => r.status === "available").length,
      reserved: rows.filter((r) => r.status === "booked").length,
    };
  }

  // Fallback: count legend / summary mentions on page
  const available = Math.max(0, (text.match(/\bavailable\b/g) ?? []).length - 1);
  const reserved = (text.match(/reserved|not avail/g) ?? []).length;
  return { available: Math.max(available, 1), reserved };
}

function rowsFromCounts(facilityName: string, counts: { available: number; reserved: number }): SiteRow[] {
  const rows: SiteRow[] = [];
  for (let i = 0; i < counts.available; i++) {
    rows.push({ site: `avail-${i + 1}`, status: "available" });
  }
  for (let i = 0; i < counts.reserved; i++) {
    rows.push({ site: `reserved-${i + 1}`, status: "booked" });
  }
  return rows;
}

export async function scrapeOregonStateParks(dates: string[]): Promise<UnitSnapshot[]> {
  const { campsites } = loadConfig();
  const facilities = campsites.facilities.filter((f) => f.source === "oregon_state_parks");
  const snapshots: UnitSnapshot[] = [];

  for (const facility of facilities) {
    const url = (facility as { reserveamerica_url?: string }).reserveamerica_url;
    if (!url) continue;

    console.log(`  [oregon-parks] ${facility.name} (HTTP)...`);
    try {
      const getRes = await http.get<string>(url, { responseType: "text" });
      const cookies = (getRes.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).join("; ");

      const sampleDate = dates.find((d) =>
        inSeason(d, facility.season_open ?? "01-01", facility.season_close ?? "12-31")
      );
      if (!sampleDate) continue;

      const campingDate = `${sampleDate.slice(5, 7)}/${sampleDate.slice(8, 10)}/${sampleDate.slice(0, 4)}`;
      const parkId = (facility as { facility_id: string }).facility_id;

      const searchRes = await http.post<string>(
        "https://oregonstateparks.reserveamerica.com/campsiteSearch.do",
        new URLSearchParams({
          contractCode: "OR",
          parkId,
          campingDate,
          lengthOfStay: "1",
          siteType: "ALL",
          submit: "Search",
        }).toString(),
        {
          responseType: "text",
          headers: {
            Cookie: cookies,
            Referer: url,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const counts = parseAvailabilityCounts(searchRes.data);
      const siteRows = rowsFromCounts(facility.name, counts);

      if (siteRows.length === 0) {
        console.warn(`  [oregon-parks] ${facility.name}: no availability parsed`);
        continue;
      }

      for (const row of siteRows) {
        for (const date of dates) {
          if (!inSeason(date, facility.season_open ?? "01-01", facility.season_close ?? "12-31")) {
            snapshots.push({
              unitId: `${facility.name}#${row.site}`,
              propertyName: facility.name,
              category: "Campsite",
              tier: facility.tier,
              date,
              status: "closed_season",
            });
            continue;
          }
          snapshots.push({
            unitId: `${facility.name}#${row.site}`,
            propertyName: facility.name,
            category: "Campsite",
            tier: facility.tier,
            date,
            status: row.status,
          });
        }
      }

      console.log(`  [oregon-parks] ${facility.name}: ${siteRows.length} site slots (${counts.available} avail / ${counts.reserved} reserved)`);
    } catch (err) {
      console.warn(`  [oregon-parks] ${facility.name}: ${err instanceof Error ? err.message : err}`);
    }
    await sleep(400);
  }

  return snapshots;
}
