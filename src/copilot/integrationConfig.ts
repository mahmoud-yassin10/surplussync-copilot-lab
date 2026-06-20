/**
 * Server-only integration settings for SurplusSync Plus → Copilot reconciliation.
 * Never expose MAIN_APP_SERVICE_TOKEN to clients, logs, or error payloads.
 */

export function getMainAppServiceToken(override?: string): string | null {
  const raw = override ?? process.env.MAIN_APP_SERVICE_TOKEN;
  if (!raw || raw.trim() === "" || raw === "CHANGE_ME") {
    return null;
  }
  return raw;
}

export function isMainAppIntegrationEnabled(tokenOverride?: string | null): boolean {
  return getMainAppServiceToken(tokenOverride ?? undefined) !== null;
}
