import { getRiskBands } from "../db/database.js";

/**
 * Risk-band classification.
 *
 * IMPORTANT: these bands are analytical categories for triage and reporting.
 * A Pixalate probability is a risk assessment for the submitted signal or
 * signal combination — it is NOT proof that a request is fraudulent.
 */

// Cache the risk bands once per process lifetime. All callers use the cached
// value unless they pass explicit bands. This avoids N DB queries when
// classifying many values (e.g. computeAggregates loops over every result).
let cachedBands: { elevatedFrom: number; highFrom: number; veryHighFrom: number } | null = null;

/** Synchronous classification using the cached bands. Safe to call after the
 * first async `classifyRisk` has populated the cache (which happens on the
 * first `classifyRisk` call in a given process). */
export function classifyRiskSync(probability: number | null): RiskBand {
  if (probability === null || Number.isNaN(probability)) return "lower";
  const b = cachedBands ?? { elevatedFrom: 0.5, highFrom: 0.75, veryHighFrom: 0.9 };
  if (probability >= b.veryHighFrom) return "very_high";
  if (probability >= b.highFrom) return "high";
  if (probability >= b.elevatedFrom) return "elevated";
  return "lower";
}

export type RiskBand = "lower" | "elevated" | "high" | "very_high";
export interface RiskBandDefinition {
  band: RiskBand;
  label: string;
  from: number; // inclusive
  to: number; // inclusive
}

export async function classifyRisk(
  probability: number | null,
  bands?: { elevatedFrom: number; highFrom: number; veryHighFrom: number }
): Promise<RiskBand> {
  if (probability === null || Number.isNaN(probability)) return "lower";
  const b = bands ?? (cachedBands ??= await getRiskBands());
  if (probability >= b.veryHighFrom) return "very_high";
  if (probability >= b.highFrom) return "high";
  if (probability >= b.elevatedFrom) return "elevated";
  return "lower";
}

export interface RiskBandCount {
  band: RiskBand;
  count: number;
  pct: number;
}

export function riskBandLabel(band: RiskBand): string {
  switch (band) {
    case "lower":
      return "Lower risk";
    case "elevated":
      return "Elevated risk";
    case "high":
      return "High risk";
    case "very_high":
      return "Very high risk";
  }
}

export async function riskBandsWithRanges(): Promise<RiskBandDefinition[]> {
  const b = await getRiskBands();
  const definitions: RiskBandDefinition[] = [
    { band: "lower", label: "Lower risk", from: 0, to: Math.max(0, b.elevatedFrom - 0.01) },
    { band: "elevated", label: "Elevated risk", from: b.elevatedFrom, to: Math.max(b.elevatedFrom, b.highFrom - 0.01) },
    { band: "high", label: "High risk", from: b.highFrom, to: Math.max(b.highFrom, b.veryHighFrom - 0.01) },
    { band: "very_high", label: "Very high risk", from: b.veryHighFrom, to: 1 },
  ];
  return definitions.map((d) => ({ ...d, to: Math.min(1, d.to) }));
}

export const RISK_BAND_ORDER: RiskBand[] = ["lower", "elevated", "high", "very_high"];

export async function describeBand(probability: number): Promise<string> {
  const band = await classifyRisk(probability);
  return `${riskBandLabel(band)} (${probability.toFixed(2)})`;
}

/**
 * Histogram bins used across the dashboard and reports.
 * Default bins: 0.00-0.09 … 0.90-1.00
 */
export const DEFAULT_HISTOGRAM_BINS = [
  { from: 0.0, to: 0.09 },
  { from: 0.1, to: 0.19 },
  { from: 0.2, to: 0.29 },
  { from: 0.3, to: 0.39 },
  { from: 0.4, to: 0.49 },
  { from: 0.5, to: 0.59 },
  { from: 0.6, to: 0.69 },
  { from: 0.7, to: 0.79 },
  { from: 0.8, to: 0.89 },
  { from: 0.9, to: 1.0 },
];

export function histogramBin(probability: number): number {
  const idx = Math.min(9, Math.floor(probability * 10));
  return idx < 0 ? 0 : idx;
}