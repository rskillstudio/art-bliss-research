import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadJson<T>(relativePath: string): T {
  const raw = readFileSync(join(root, relativePath), "utf-8");
  return JSON.parse(raw) as T;
}

export interface GeoBoundsConfig {
  market_name: string;
  annual_visitor_baseline: number;
  tiers: Record<
    "A" | "B",
    {
      label: string;
      purpose: string;
      center: { lat: number; lng: number; label: string };
      radius_miles: number;
      zips: string[];
      towns: string[];
      lodging_categories: string[];
    }
  >;
}

export interface UnderwritingConfig {
  market_benchmarks_ttm: {
    costar_hotel_occupancy_pct: number;
    airdna_adr: number;
    airdna_revpar: number;
  };
  scenarios: {
    base: { occupancy_pct: number; blended_adr: number };
  };
  comp_properties: {
    name: string;
    units: number;
    avg_adr: number;
  }[];
  segmentation_defaults: {
    avg_party_size: number;
    avg_length_of_stay_nights: number;
    persons_per_campsite: number;
  };
}

export interface CampsiteFacility {
  facility_id: string;
  name: string;
  source: string;
  tier: "A" | "B";
  persons_per_site: number;
}

export interface CampsitesConfig {
  facilities: CampsiteFacility[];
  parsing_rules: Record<string, unknown>;
}

export interface LodgingSeedRow {
  name: string;
  category: string;
  tier: "A" | "B";
  lat: number;
  lng: number;
  zip: string;
  town: string;
  deck_comp: boolean;
  units?: number;
}

export function loadConfig() {
  const geo = loadJson<GeoBoundsConfig>("config/geo-bounds.json");
  const underwriting = loadJson<UnderwritingConfig>("config/underwriting.json");
  const campsites = loadJson<CampsitesConfig>("config/campsites.json");

  const seedRaw = readFileSync(join(root, "config/lodging-seed.csv"), "utf-8");
  const lodgingSeed: LodgingSeedRow[] = seedRaw
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => {
      const [name, category, tier, lat, lng, zip, town, , deckComp, units] = line.split(",");
      return {
        name,
        category,
        tier: tier as "A" | "B",
        lat: Number(lat),
        lng: Number(lng),
        zip,
        town,
        deck_comp: deckComp === "true",
        units: units ? Number(units) : undefined,
      };
    });

  return { geo, underwriting, campsites, lodgingSeed };
}

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function inTier(
  lat: number,
  lng: number,
  tier: "A" | "B",
  geo: GeoBoundsConfig
): boolean {
  const t = geo.tiers[tier];
  return haversineMiles(lat, lng, t.center.lat, t.center.lng) <= t.radius_miles;
}
