import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  CURRENT_PLAN,
  FOCUS_DATE,
  PREVENTABLE_SURPLUS_BASELINE,
  PREVENTABLE_SURPLUS_CORRECTED,
} from "./demoConstants";
import type { MlForecastFeaturesInput } from "./mlSchemas";
import type { MlForecastResponse } from "./mlSchemas";

export const CANONICAL_SCHOOL_ID = "lhphs";

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
    intervalLow: 497,
    intervalHigh: 557,
    recommendedPrep: BASELINE_RECOMMENDED_PREP,
    shortageProb: 0.016,
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
    intervalLow: 509,
    intervalHigh: 571,
    recommendedPrep: CORRECTED_RECOMMENDED_PREP,
    shortageProb: 0.011,
    largeSurplusProb: 0.12,
    preventableSurplus: PREVENTABLE_SURPLUS_CORRECTED,
    risk: "moderate",
    dataQuality: "high",
    modelVersion: "ssp-forecast-canonical-fallback",
    approvalRequired: true,
    decisionStatus: "PROPOSED",
    safetyFloorApplied: true,
  };
}

export function validateCanonicalForecastInvariants(forecast: MlForecastResponse): void {
  if (forecast.expectedAttendance !== BASELINE_ATTENDANCE) {
    throw new Error(`Canonical forecast attendance invariant failed: ${forecast.expectedAttendance}`);
  }
  if (forecast.recommendedPrep !== BASELINE_RECOMMENDED_PREP) {
    throw new Error(`Canonical forecast prep invariant failed: ${forecast.recommendedPrep}`);
  }
  if (forecast.intervalLow !== 497 || forecast.intervalHigh !== 557) {
    throw new Error("Canonical forecast interval invariant failed");
  }
}

export function validateCanonicalWhatIfInvariants(forecast: MlForecastResponse): void {
  if (forecast.expectedAttendance !== CORRECTED_ATTENDANCE) {
    throw new Error(`Canonical what-if attendance invariant failed: ${forecast.expectedAttendance}`);
  }
  if (forecast.recommendedPrep !== CORRECTED_RECOMMENDED_PREP) {
    throw new Error(`Canonical what-if prep invariant failed: ${forecast.recommendedPrep}`);
  }
}
