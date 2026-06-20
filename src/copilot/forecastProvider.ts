/**
 * P1 ForecastProvider — server adapter stub (not implemented in P0).
 *
 * The Copilot Lab must not invent or independently calculate operational forecast
 * values. In P1, authoritative forecast and what-if results will be fetched from
 * the SurplusSync ML service and injected into the server session / tool loop.
 *
 * Planned endpoints:
 *   POST {ML_SERVICE_URL}/v1/forecast
 *     Body: { schoolId, date, menuContext? }
 *     Returns: { expectedAttendance, recommendedPreparation, intervals, riskLevel, ... }
 *
 *   POST {ML_SERVICE_URL}/v1/what-if
 *     Body: { schoolId, date, attendance?, preparationPlan? }
 *     Returns: { recommendedPreparation, shortageProbability, surplusProbability, ... }
 *
 * Until this adapter exists:
 *   - Session state initializes from demoConstants / mockData canonical values.
 *   - Mock and Gemini paths may *explain* those values but must not mutate them
 *     without a validated, human-approved proposal.
 *   - Simulation answers should reference fixed demo numbers (562 baseline, 575 corrected).
 */
export const FORECAST_PROVIDER_P1 = {
  forecastPath: "/v1/forecast",
  whatIfPath: "/v1/what-if",
  envKey: "ML_SERVICE_URL",
} as const;

export type ForecastProviderStatus = "NOT_IMPLEMENTED_P0";

export function getForecastProviderStatus(): ForecastProviderStatus {
  return "NOT_IMPLEMENTED_P0";
}
