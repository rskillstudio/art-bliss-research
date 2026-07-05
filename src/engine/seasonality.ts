import { loadConfig } from "../config.js";

export interface SeasonBand {
  name: string;
  months: number[];
  occupancy_pct: number;
  adr: number;
}

export interface SeasonalOutlook {
  deck_annual_occ_pct: number;
  deck_annual_adr: number;
  feed_snapshot_occ_pct: number;
  feed_adjusted_occ_pct: number;
  feed_adjusted_adr: number;
  occ_scale_factor: number;
  bands: {
    name: string;
    months: number;
    deck_occ_pct: number;
    feed_adjusted_occ_pct: number;
    adr: number;
  }[];
  artbliss_i: {
    deck_base_room_revenue: number;
    feed_snapshot_room_revenue: number;
    feed_seasonal_room_revenue: number;
    deck_base_noi: number;
    feed_snapshot_noi: number;
    feed_seasonal_noi: number;
  };
  artbliss_ii: {
    feed_seasonal_room_revenue: number;
    feed_seasonal_noi: number;
  };
  methodology: string;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const NOI_MARGIN = 0.455;
const UNITS_I = 4;
const UNITS_II = 10;

function monthBand(month: number, bands: SeasonBand[]): SeasonBand {
  const band = bands.find((b) => b.months.includes(month));
  if (!band) throw new Error(`Month ${month} not assigned to a season band`);
  return band;
}

function annualMetricsFromBands(bands: SeasonBand[], occScale = 1): { occPct: number; adr: number; roomRevPerUnit: number } {
  let bookedNights = 0;
  let revenue = 0;
  let totalNights = 0;

  for (let m = 1; m <= 12; m++) {
    const band = monthBand(m, bands);
    const days = DAYS_IN_MONTH[m - 1];
    const occ = Math.min(95, band.occupancy_pct * occScale);
    bookedNights += days * (occ / 100);
    revenue += days * (occ / 100) * band.adr;
    totalNights += days;
  }

  return {
    occPct: (bookedNights / totalNights) * 100,
    adr: revenue / bookedNights,
    roomRevPerUnit: revenue,
  };
}

function roomRev(units: number, occPct: number, adr: number): number {
  return units * 365 * (occPct / 100) * adr;
}

export function buildSeasonBands(): SeasonBand[] {
  const { underwriting: uw } = loadConfig();
  const peak = uw.seasonality.peak;
  const off = uw.seasonality.off_peak;
  const shoulder = uw.seasonality.shoulder;

  return [
    { name: "Peak", months: peak.months, occupancy_pct: peak.occupancy_pct, adr: peak.adr },
    {
      name: "Shoulder",
      months: shoulder.months,
      occupancy_pct: shoulder.occupancy_pct,
      adr: shoulder.adr,
    },
    { name: "Off-Peak", months: off.months, occupancy_pct: off.occupancy_pct, adr: off.adr },
  ];
}

export function computeSeasonalOutlook(feedSnapshotOccPct: number): SeasonalOutlook {
  const { underwriting: uw } = loadConfig();
  const bands = buildSeasonBands();
  const deckAnnual = annualMetricsFromBands(bands);
  const scale = feedSnapshotOccPct / deckAnnual.occPct;
  const feedAdjusted = annualMetricsFromBands(bands, scale);

  const bandRows = bands.map((b) => ({
    name: b.name,
    months: b.months.length,
    deck_occ_pct: b.occupancy_pct,
    feed_adjusted_occ_pct: Math.min(95, b.occupancy_pct * scale),
    adr: b.adr,
  }));

  const deckBaseRev = roomRev(UNITS_I, uw.scenarios.base.occupancy_pct, uw.scenarios.base.blended_adr);
  const feedSnapshotRev = roomRev(UNITS_I, feedSnapshotOccPct, uw.scenarios.base.blended_adr);
  const feedSeasonalRev = feedAdjusted.roomRevPerUnit * UNITS_I;

  return {
    deck_annual_occ_pct: deckAnnual.occPct,
    deck_annual_adr: deckAnnual.adr,
    feed_snapshot_occ_pct: feedSnapshotOccPct,
    feed_adjusted_occ_pct: feedAdjusted.occPct,
    feed_adjusted_adr: feedAdjusted.adr,
    occ_scale_factor: scale,
    bands: bandRows,
    artbliss_i: {
      deck_base_room_revenue: Math.round(deckBaseRev),
      feed_snapshot_room_revenue: Math.round(feedSnapshotRev),
      feed_seasonal_room_revenue: Math.round(feedSeasonalRev),
      deck_base_noi: Math.round(deckBaseRev * NOI_MARGIN),
      feed_snapshot_noi: Math.round(feedSnapshotRev * NOI_MARGIN),
      feed_seasonal_noi: Math.round(feedSeasonalRev * NOI_MARGIN),
    },
    artbliss_ii: {
      feed_seasonal_room_revenue: Math.round(feedAdjusted.roomRevPerUnit * UNITS_II),
      feed_seasonal_noi: Math.round(feedAdjusted.roomRevPerUnit * UNITS_II * NOI_MARGIN),
    },
    methodology:
      "Deck peak/shoulder/off-peak bands from June 2026 underwriting; feed snapshot occ scales all bands proportionally; revenue uses month-level occ × ADR (not flat $347).",
  };
}
