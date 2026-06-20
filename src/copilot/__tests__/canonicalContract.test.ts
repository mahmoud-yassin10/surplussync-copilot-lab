import { describe, it, expect } from "vitest";
import {
  buildCanonicalForecastFallback,
  buildCanonicalWhatIfTripCancelledFallback,
  CORRECTED_SAFETY_BUFFER_MEALS,
  pickCanonicalContractFields,
  validateCanonicalForecastInvariants,
  validateCanonicalWhatIfInvariants,
} from "../canonicalMlFeatures";
import {
  ForecastProvider,
  resetForecastProviderForTests,
} from "../forecastProvider";

const mlForecastBody = {
  ...buildCanonicalForecastFallback(),
  modelVersion: "ssp-forecast-1.0",
};

const mlWhatIfBody = {
  ...buildCanonicalWhatIfTripCancelledFallback(),
  modelVersion: "ssp-forecast-1.0",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("canonical ML contract", () => {
  it("locks baseline fallback values", () => {
    const baseline = buildCanonicalForecastFallback();
    validateCanonicalForecastInvariants(baseline);
    expect(baseline.expectedAttendance).toBe(528);
    expect(baseline.intervalLow).toBe(497);
    expect(baseline.intervalHigh).toBe(557);
    expect(baseline.recommendedPrep).toBe(562);
    expect(baseline.preventableSurplus).toBe(168);
    expect(baseline.shortageProb).toBe(0.041);
    expect(baseline.risk).toBe("high");
    expect(baseline.decisionStatus).toBe("PROPOSED");
    expect(baseline.approvalRequired).toBe(true);
    expect(baseline.safetyFloorApplied).toBe(true);
  });

  it("locks trip-cancelled what-if fallback values", () => {
    const corrected = buildCanonicalWhatIfTripCancelledFallback();
    validateCanonicalWhatIfInvariants(corrected);
    expect(corrected.expectedAttendance).toBe(540);
    expect(corrected.intervalLow).toBe(512);
    expect(corrected.intervalHigh).toBe(568);
    expect(corrected.recommendedPrep).toBe(575);
    expect(corrected.preventableSurplus).toBe(155);
    expect(corrected.shortageProb).toBe(0.034);
    expect(corrected.risk).toBe("high");
    expect(corrected.recommendedPrep - corrected.intervalHigh).toBe(CORRECTED_SAFETY_BUFFER_MEALS);
    expect(CORRECTED_SAFETY_BUFFER_MEALS).toBe(7);
    expect(corrected.decisionStatus).toBe("PROPOSED");
    expect(corrected.approvalRequired).toBe(true);
    expect(corrected.safetyFloorApplied).toBe(true);
  });

  it("matches live ML and fallback baseline contract except model version", async () => {
    resetForecastProviderForTests();
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async (url) => {
        if (url.endsWith("/v1/forecast")) return jsonResponse(mlForecastBody);
        return jsonResponse({ status: "ok" });
      },
    });

    const live = await provider.getAttendanceForecast();
    const fallback = buildCanonicalForecastFallback();

    expect(live.provenance.source).toBe("ml");
    expect(pickCanonicalContractFields(live.forecast)).toEqual(
      pickCanonicalContractFields(fallback)
    );
    expect(live.forecast.modelVersion).toBe("ssp-forecast-1.0");
    expect(fallback.modelVersion).toBe("ssp-forecast-canonical-fallback");
  });

  it("matches live ML and fallback what-if contract except model version", async () => {
    resetForecastProviderForTests();
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async (url) => {
        if (url.endsWith("/v1/what-if")) return jsonResponse(mlWhatIfBody);
        return jsonResponse(mlForecastBody);
      },
    });

    const live = await provider.simulateAttendanceCorrection();
    const fallback = buildCanonicalWhatIfTripCancelledFallback();

    expect(live.provenance.source).toBe("ml");
    expect(pickCanonicalContractFields(live.forecast)).toEqual(
      pickCanonicalContractFields(fallback)
    );
    expect(live.forecast.expectedAttendance).not.toBe(528);
    expect(live.forecast.recommendedPrep).not.toBe(562);
    expect(live.forecast.modelVersion).toBe("ssp-forecast-1.0");
    expect(fallback.modelVersion).toBe("ssp-forecast-canonical-fallback");
  });

  it("discloses fallback provenance with identical contract values when ML is down", async () => {
    resetForecastProviderForTests();
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async () => new Response("down", { status: 503 }),
    });

    const forecast = await provider.getAttendanceForecast();
    const simulation = await provider.simulateAttendanceCorrection();

    expect(forecast.provenance.source).toBe("local-canonical-fallback");
    expect(forecast.provenance.fallbackUsed).toBe(true);
    expect(simulation.provenance.source).toBe("local-canonical-fallback");
    expect(simulation.provenance.fallbackUsed).toBe(true);

    expect(pickCanonicalContractFields(forecast.forecast)).toEqual(
      pickCanonicalContractFields(buildCanonicalForecastFallback())
    );
    expect(pickCanonicalContractFields(simulation.forecast)).toEqual(
      pickCanonicalContractFields(buildCanonicalWhatIfTripCancelledFallback())
    );
  });
});
