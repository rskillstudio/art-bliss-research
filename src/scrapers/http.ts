import axios from "axios";

export const http = axios.create({
  timeout: 30000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json,text/html,application/xhtml+xml",
  },
});

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function dateRange(days: number, start = new Date()): string[] {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export function monthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`;
}

export function decodeAirbnbListingId(encoded: string): string | null {
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const match = decoded.match(/:(\d+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function parsePriceAmount(price?: string | null): number | undefined {
  if (!price) return undefined;
  const n = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}
