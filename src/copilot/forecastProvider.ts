import { z } from "zod";
import {
  buildCanonicalForecastFallback,
  buildCanonicalForecastFeatures,
  buildCanonicalTripCancelledChanges,
  buildCanonicalWhatIfTripCancelledFallback,
  validateCanonicalForecastInvariants,
  validateCanonicalWhatIfInvariants,
} from "./canonicalMlFeatures";
import { getMlConfig, type MlConfig } from "./mlConfig";
import {
  ForecastProvenance,
  mlForecastResponseSchema,
  mlHealthResponseSchema,
  mlWhatIfRequestSchema,
  type MlForecastResponse,
} from "./mlSchemas";

export class ForecastProviderError extends Error {
  constructor(
    public readonly code:
      | "ML_URL_ABSENT"
      | "ML_TIMEOUT"
      | "ML_UNAVAILABLE"
      | "ML_INVALID_RESPONSE"
      | "ML_FALLBACK_DISABLED"
      | "UNSUPPORTED_DEMO_SCOPE",
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "ForecastProviderError";
  }
}

export type MlFetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ForecastProviderOptions {
  config?: Partial<MlConfig>;
  fetchFn?: MlFetchFn;
}

export interface ForecastResult {
  forecast: MlForecastResponse;
  provenance: ForecastProvenance;
}

function withProvenance(
  source: ForecastProvenance["source"],
  mlReachable: boolean,
  fallbackUsed: boolean
): ForecastProvenance {
  return {
    source,
    mlReachable,
    fallbackUsed,
    decisionStatus: "PROPOSED",
    approvalRequired: true,
  };
}

async function fetchMlJson<T>(
  path: string,
  init: RequestInit,
  parse: (json: unknown) => T,
  config: MlConfig,
  fetchFn: MlFetchFn
): Promise<T> {
  if (!config.serviceUrl) {
    throw new ForecastProviderError("ML_URL_ABSENT", "ML_SERVICE_URL is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetchFn(`${config.serviceUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ForecastProviderError(
        "ML_UNAVAILABLE",
        detail || `ML service responded with ${response.status}`,
        response.status
      );
    }

    const json: unknown = await response.json();
    try {
      return parse(json);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ForecastProviderError("ML_INVALID_RESPONSE", "ML service returned malformed payload");
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ForecastProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ForecastProviderError(
        "ML_TIMEOUT",
        `ML request timed out after ${config.requestTimeoutMs}ms`
      );
    }
    throw new ForecastProviderError(
      "ML_UNAVAILABLE",
      error instanceof Error ? error.message : "ML service request failed"
    );
  } finally {
    clearTimeout(timeout);
  }
}

export class ForecastProvider {
  private readonly config: MlConfig;
  private readonly fetchFn: MlFetchFn;

  constructor(options: ForecastProviderOptions = {}) {
    this.config = getMlConfig(options.config);
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  }

  async getHealth(): Promise<{ status: string; modelLoaded: boolean; mlReachable: boolean }> {
    try {
      const data = await fetchMlJson(
        "/health",
        { method: "GET" },
        (json) => mlHealthResponseSchema.parse(json),
        this.config,
        this.fetchFn
      );
      return {
        status: data.status,
        modelLoaded: data.modelLoaded ?? false,
        mlReachable: true,
      };
    } catch (error) {
      if (error instanceof ForecastProviderError && error.code === "ML_TIMEOUT") throw error;
      return { status: "unavailable", modelLoaded: false, mlReachable: false };
    }
  }

  async getAttendanceForecast(scope?: { schoolId?: string; date?: string }): Promise<ForecastResult> {
    if (scope?.schoolId || scope?.date) {
      const { isCanonicalDemoScope } = await import("./canonicalMlFeatures");
      if (!isCanonicalDemoScope(scope)) {
        throw new ForecastProviderError(
          "UNSUPPORTED_DEMO_SCOPE",
          "UNSUPPORTED_DEMO_SCOPE: only lhphs on 2026-03-12 is supported in this laboratory demo."
        );
      }
    }

    try {
      const body = buildCanonicalForecastFeatures();
      const forecast = await fetchMlJson(
        "/v1/forecast",
        { method: "POST", body: JSON.stringify(body) },
        (json) => mlForecastResponseSchema.parse(json),
        this.config,
        this.fetchFn
      );
      validateCanonicalForecastInvariants(forecast);
      return {
        forecast,
        provenance: withProvenance("ml", true, false),
      };
    } catch (error) {
      if (error instanceof ForecastProviderError && error.code === "UNSUPPORTED_DEMO_SCOPE") {
        throw error;
      }
      if (!this.config.allowFallback) {
        throw error instanceof ForecastProviderError
          ? error
          : new ForecastProviderError(
              "ML_FALLBACK_DISABLED",
              "ML service unavailable and ALLOW_COPILOT_FORECAST_FALLBACK is disabled"
            );
      }
      const forecast = buildCanonicalForecastFallback();
      return {
        forecast,
        provenance: withProvenance("local-canonical-fallback", false, true),
      };
    }
  }

  async simulateAttendanceCorrection(scope?: {
    schoolId?: string;
    date?: string;
  }): Promise<ForecastResult> {
    if (scope?.schoolId || scope?.date) {
      const { isCanonicalDemoScope } = await import("./canonicalMlFeatures");
      if (!isCanonicalDemoScope(scope)) {
        throw new ForecastProviderError(
          "UNSUPPORTED_DEMO_SCOPE",
          "UNSUPPORTED_DEMO_SCOPE: only lhphs on 2026-03-12 is supported in this laboratory demo."
        );
      }
    }

    const requestBody = mlWhatIfRequestSchema.parse({
      base: buildCanonicalForecastFeatures(),
      changes: buildCanonicalTripCancelledChanges(),
    });

    try {
      const forecast = await fetchMlJson(
        "/v1/what-if",
        { method: "POST", body: JSON.stringify(requestBody) },
        (json) => mlForecastResponseSchema.parse(json),
        this.config,
        this.fetchFn
      );
      validateCanonicalWhatIfInvariants(forecast);
      return {
        forecast,
        provenance: withProvenance("ml", true, false),
      };
    } catch (error) {
      if (error instanceof ForecastProviderError && error.code === "UNSUPPORTED_DEMO_SCOPE") {
        throw error;
      }
      if (!this.config.allowFallback) {
        throw new ForecastProviderError(
          "ML_FALLBACK_DISABLED",
          "ML service unavailable and ALLOW_COPILOT_FORECAST_FALLBACK is disabled"
        );
      }
      const forecast = buildCanonicalWhatIfTripCancelledFallback();
      return {
        forecast,
        provenance: withProvenance("local-canonical-fallback", false, true),
      };
    }
  }
}

let defaultProvider: ForecastProvider | null = null;

export function getForecastProvider(options?: ForecastProviderOptions): ForecastProvider {
  if (!options) {
    if (!defaultProvider) defaultProvider = new ForecastProvider();
    return defaultProvider;
  }
  return new ForecastProvider(options);
}

export function resetForecastProviderForTests(): void {
  defaultProvider = null;
}
