import { getMainAppServiceToken } from "./integrationConfig";

export type IntegrationAuthResult =
  | { ok: true }
  | { ok: false; statusCode: 401 | 503; error: string };

export function authorizeMainAppService(
  authorizationHeader: string | undefined,
  tokenOverride?: string | null
): IntegrationAuthResult {
  const token = tokenOverride ?? getMainAppServiceToken();
  if (!token) {
    return {
      ok: false,
      statusCode: 503,
      error: "Main app integration is not configured",
    };
  }

  if (!authorizationHeader || authorizationHeader !== `Bearer ${token}`) {
    return { ok: false, statusCode: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
