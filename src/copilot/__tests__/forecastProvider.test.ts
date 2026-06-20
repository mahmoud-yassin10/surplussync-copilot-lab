import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ForecastProvider,
  ForecastProviderError,
  resetForecastProviderForTests,
} from "../forecastProvider";
import { buildCanonicalForecastFallback, buildCanonicalWhatIfTripCancelledFallback } from "../canonicalMlFeatures";

const canonicalForecastBody = buildCanonicalForecastFallback();
const canonicalWhatIfBody = {
  ...buildCanonicalWhatIfTripCancelledFallback(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ForecastProvider", () => {
  beforeEach(() => {
    resetForecastProviderForTests();
    vi.useRealTimers();
  });

  it("reports ML health success", async () => {
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async (url) => {
        if (url.endsWith("/health")) return jsonResponse({ status: "ok", modelLoaded: true });
        throw new Error("unexpected");
      },
    });
    const health = await provider.getHealth();
    expect(health.mlReachable).toBe(true);
    expect(health.status).toBe("ok");
  });

  it("returns canonical forecast from ML", async () => {
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async (url, init) => {
        if (url.endsWith("/v1/forecast")) return jsonResponse(canonicalForecastBody);
        return jsonResponse({ status: "ok" });
      },
    });
    const result = await provider.getAttendanceForecast();
    expect(result.forecast.expectedAttendance).toBe(528);
    expect(result.forecast.recommendedPrep).toBe(562);
    expect(result.forecast.shortageProb).toBe(0.041);
    expect(result.provenance.source).toBe("ml");
    expect(result.provenance.approvalRequired).toBe(true);
    expect(result.provenance.decisionStatus).toBe("PROPOSED");
  });

  it("returns canonical attendance what-if from ML", async () => {
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async (url) => {
        if (url.endsWith("/v1/what-if")) return jsonResponse(canonicalWhatIfBody);
        return jsonResponse(canonicalForecastBody);
      },
    });
    const result = await provider.simulateAttendanceCorrection();
    expect(result.forecast.expectedAttendance).toBe(540);
    expect(result.forecast.recommendedPrep).toBe(575);
    expect(result.forecast.intervalLow).toBe(512);
    expect(result.forecast.intervalHigh).toBe(568);
    expect(result.forecast.preventableSurplus).toBe(155);
    expect(result.forecast.shortageProb).toBe(0.034);
    expect(result.provenance.source).toBe("ml");
  });

  it("rejects malformed ML response", async () => {
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: false },
      fetchFn: async () => jsonResponse({ bad: true }),
    });
    await expect(provider.getAttendanceForecast()).rejects.toMatchObject({
      code: "ML_INVALID_RESPONSE",
    });
  });

  it("times out ML requests", async () => {
    vi.useFakeTimers();
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 50, allowFallback: false },
      fetchFn: async (_url, init) =>
        new Promise((resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
          setTimeout(() => resolve(jsonResponse(canonicalForecastBody)), 200);
        }),
    });
    const promise = provider.getAttendanceForecast();
    vi.advanceTimersByTime(60);
    await expect(promise).rejects.toMatchObject({ code: "ML_TIMEOUT" });
  });

  it("uses canonical fallback when ML unavailable and fallback enabled", async () => {
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async () => new Response("down", { status: 503 }),
    });
    const result = await provider.getAttendanceForecast();
    expect(result.provenance.source).toBe("local-canonical-fallback");
    expect(result.provenance.fallbackUsed).toBe(true);
  });

  it("fails when fallback disabled and ML unavailable", async () => {
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: false },
      fetchFn: async () => new Response("down", { status: 503 }),
    });
    await expect(provider.getAttendanceForecast()).rejects.toBeInstanceOf(ForecastProviderError);
  });

  it("rejects unsupported noncanonical date without fabricated features", async () => {
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async () => jsonResponse(canonicalForecastBody),
    });
    await expect(
      provider.getAttendanceForecast({ schoolId: "lhphs", date: "2026-06-25" })
    ).rejects.toMatchObject({ code: "UNSUPPORTED_DEMO_SCOPE" });
  });

  it("discloses fallback provenance when ML is unavailable", async () => {
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async () => new Response("down", { status: 503 }),
    });
    const result = await provider.getAttendanceForecast();
    expect(result.provenance.source).toBe("local-canonical-fallback");
    expect(result.provenance.fallbackUsed).toBe(true);
    expect(result.provenance.decisionStatus).toBe("PROPOSED");
    expect(result.provenance.approvalRequired).toBe(true);
  });
});
