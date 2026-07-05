export type LodgingCategory = "Hotel" | "STR" | "Cabin" | "Campsite";
export type GeoTier = "A" | "B";
export type AvailabilityStatus = "available" | "booked" | "blocked" | "closed_season" | "unknown";

export interface UnitSnapshot {
  unitId: string;
  propertyName: string;
  category: LodgingCategory;
  tier: GeoTier;
  date: string;
  status: AvailabilityStatus;
  adr?: number;
}

export interface CategoryMetrics {
  timestamp: string;
  lodging_category: LodgingCategory;
  geo_tier: GeoTier;
  total_units_tracked: number;
  estimated_occupancy_rate: number;
  implied_visitor_count: number;
}

export interface SegmentationReport {
  timestamp: string;
  annual_visitor_baseline: number;
  segments: {
    category: LodgingCategory | "DayTripper";
    geo_tier: GeoTier | "residual";
    implied_annual_visitors: number;
    share_of_baseline_pct: number;
  }[];
  reconciliation: {
    accounted_visitors: number;
    day_tripper_residual: number;
    day_tripper_share_pct: number;
  };
  deck_benchmarks: {
    costar_hotel_occupancy_pct: number;
    airdna_adr: number;
    base_scenario_occupancy_pct: number;
    base_scenario_adr: number;
  };
}

export interface ScraperResult {
  source: string;
  tier: GeoTier;
  snapshots: UnitSnapshot[];
  scraped_at: string;
}
