import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  BASELINE_SHORTAGE_PROB,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  CORRECTED_SHORTAGE_PROB,
  CURRENT_PLAN,
  FOCUS_DATE,
  PREVENTABLE_SURPLUS_BASELINE,
  PREVENTABLE_SURPLUS_CORRECTED,
} from "./demoConstants";
import type { MlForecastFeaturesInput } from "./mlSchemas";
import type { MlForecastResponse } from "./mlSchemas";

export const CANONICAL_SCHOOL_ID = "lhphs";

export const CANONICAL_INTERVAL_BASELINE = { low: 497, high: 557 } as const;
export const CANONICAL_INTERVAL_CORRECTED = { low: 512, high: 568 } as const;
export const CORRECTED_SAFETY_BUFFER_MEALS =
  CORRECTED_RECOMMENDED_PREP - CANONICAL_INTERVAL_CORRECTED.high;

/** Contract fields compared between live ML and canonical fallback (excludes modelVersion). */
export const CANONICAL_CONTRACT_FIELDS = [
  "date",
  "expectedAttendance",
  "intervalLow",
  "intervalHigh",
  "recommendedPrep",
  "preventableSurplus",
  "shortageProb",
  "risk",
  "approvalRequired",
  "decisionStatus",
  "safetyFloorApplied",
] as const;

export type CanonicalContractField = (typeof CANONICAL_CONTRACT_FIELDS)[number];

/** Server-owned canonical ML request — never accept model-supplied feature overrides. */
export function buildCanonicalForecastFeatures(): MlForecastFeaturesInput {
  return {
    school_id: CANONICAL_SCHOOL_ID,
    date: FOCUS_DATE,
    enrolled: 820,
    eligible: 760,
    normal_prep: CURRENT_PLAN,
    expected_attendance: BASELINE_ATTENDANCE,
    is_exam: true,
    trip_students: 112,
    early_dismissal: true,
    rain_probability: 0.78,
    rain_inches: 1.08,
    temperature_f: 46,
    menu_name: "Chicken & rice",
    menu_popularity: 1.061,
    recent_attendance_7d: 708,
    recent_attendance_14d: 706,
  };
}

export function buildCanonicalTripCancelledChanges(): Record<string, number> {
  return {
    trip_students: 0,
    expected_attendance: CORRECTED_ATTENDANCE,
  };
}

export function isCanonicalDemoScope(params?: {
  schoolId?: string;
  date?: string;
}): boolean {
  if (params?.schoolId && params.schoolId !== CANONICAL_SCHOOL_ID) return false;
  if (params?.date && params.date !== FOCUS_DATE) return false;
  return true;
}

export function buildCanonicalForecastFallback(): MlForecastResponse {
  return {
    date: FOCUS_DATE,
    expectedAttendance: BASELINE_ATTENDANCE,
    intervalLow: CANONICAL_INTERVAL_BASELINE.low,
    intervalHigh: CANONICAL_INTERVAL_BASELINE.high,
    recommendedPrep: BASELINE_RECOMMENDED_PREP,
    shortageProb: BASELINE_SHORTAGE_PROB,
    largeSurplusProb: 0.12,
    preventableSurplus: PREVENTABLE_SURPLUS_BASELINE,
    risk: "high",
    dataQuality: "high",
    modelVersion: "ssp-forecast-canonical-fallback",
    approvalRequired: true,
    decisionStatus: "PROPOSED",
    safetyFloorApplied: true,
  };
}

export function buildCanonicalWhatIfTripCancelledFallback(): MlForecastResponse {
  return {
    date: FOCUS_DATE,
    expectedAttendance: CORRECTED_ATTENDANCE,
    intervalLow: CANONICAL_INTERVAL_CORRECTED.low,
    intervalHigh: CANONICAL_INTERVAL_CORRECTED.high,
    recommendedPrep: CORRECTED_RECOMMENDED_PREP,
    shortageProb: CORRECTED_SHORTAGE_PROB,
    largeSurplusProb: 0.12,
    preventableSurplus: PREVENTABLE_SURPLUS_CORRECTED,
    risk: "high",
    dataQuality: "high",
    modelVersion: "ssp-forecast-canonical-fallback",
    approvalRequired: true,
    decisionStatus: "PROPOSED",
    safetyFloorApplied: true,
  };
}

export function pickCanonicalContractFields(
  forecast: MlForecastResponse
): Pick<MlForecastResponse, CanonicalContractField> {
  return {
    date: forecast.date,
    expectedAttendance: forecast.expectedAttendance,
    intervalLow: forecast.intervalLow,
    intervalHigh: forecast.intervalHigh,
    recommendedPrep: forecast.recommendedPrep,
    preventableSurplus: forecast.preventableSurplus,
    shortageProb: forecast.shortageProb,
    risk: forecast.risk,
    approvalRequired: forecast.approvalRequired,
    decisionStatus: forecast.decisionStatus,
    safetyFloorApplied: forecast.safetyFloorApplied,
  };
}

export function validateCanonicalForecastInvariants(forecast: MlForecastResponse): void {
  if (forecast.expectedAttendance !== BASELINE_ATTENDANCE) {
    throw new Error(`Canonical forecast attendance invariant failed: ${forecast.expectedAttendance}`);
  }
  if (forecast.recommendedPrep !== BASELINE_RECOMMENDED_PREP) {
    throw new Error(`Canonical forecast prep invariant failed: ${forecast.recommendedPrep}`);
  }
  if (
    forecast.intervalLow !== CANONICAL_INTERVAL_BASELINE.low ||
    forecast.intervalHigh !== CANONICAL_INTERVAL_BASELINE.high
  ) {
    throw new Error("Canonical forecast interval invariant failed");
  }
  if (forecast.shortageProb !== BASELINE_SHORTAGE_PROB) {
    throw new Error(`Canonical forecast shortage probability invariant failed: ${forecast.shortageProb}`);
  }
}

export function validateCanonicalWhatIfInvariants(forecast: MlForecastResponse): void {
  if (forecast.expectedAttendance !== CORRECTED_ATTENDANCE) {
    throw new Error(`Canonical what-if attendance invariant failed: ${forecast.expectedAttendance}`);
  }
  if (forecast.recommendedPrep !== CORRECTED_RECOMMENDED_PREP) {
    throw new Error(`Canonical what-if prep invariant failed: ${forecast.recommendedPrep}`);
  }
  if (
    forecast.intervalLow !== CANONICAL_INTERVAL_CORRECTED.low ||
    forecast.intervalHigh !== CANONICAL_INTERVAL_CORRECTED.high
  ) {
    throw new Error("Canonical what-if interval invariant failed");
  }
  if (forecast.shortageProb !== CORRECTED_SHORTAGE_PROB) {
    throw new Error(`Canonical what-if shortage probability invariant failed: ${forecast.shortageProb}`);
  }
  if (forecast.risk !== "high") {
    throw new Error(`Canonical what-if risk invariant failed: ${forecast.risk}`);
  }
  if (forecast.recommendedPrep - forecast.intervalHigh !== CORRECTED_SAFETY_BUFFER_MEALS) {
    throw new Error("Canonical what-if safety buffer invariant failed");
  }
}
