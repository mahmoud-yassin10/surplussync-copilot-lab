export interface MlConfig {
  serviceUrl: string;
  requestTimeoutMs: number;
  allowFallback: boolean;
}

export function getMlConfig(overrides?: Partial<MlConfig>): MlConfig {
  const serviceUrl = overrides?.serviceUrl ?? process.env.ML_SERVICE_URL ?? "http://127.0.0.1:8000";
  const requestTimeoutMs =
    overrides?.requestTimeoutMs ??
    Number.parseInt(process.env.ML_REQUEST_TIMEOUT_MS ?? "5000", 10);
  const allowFallback =
    overrides?.allowFallback ??
    process.env.ALLOW_COPILOT_FORECAST_FALLBACK !== "false";

  return { serviceUrl, requestTimeoutMs, allowFallback };
}
