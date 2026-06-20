import { describe, it, expect, beforeEach, vi } from "vitest";
import { GoogleGenAI } from "@google/genai";
import { UserRole } from "../../types";
import { clearAllSessions, createSession, getSession, getSessionState } from "../sessionStore";
import { ForecastProvider } from "../forecastProvider";
import { buildCanonicalForecastFallback, buildCanonicalWhatIfTripCancelledFallback } from "../canonicalMlFeatures";
import { runControlledToolLoop, MAX_TOOL_LOOP_ITERATIONS } from "../toolLoop";
import { ALLOWED_TOOLS, BANNED_TOOLS } from "../toolRegistry";

function mlFetch() {
  return async (url: string) => {
    if (url.endsWith("/v1/forecast")) {
      return new Response(JSON.stringify(buildCanonicalForecastFallback()), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/v1/what-if")) {
      return new Response(JSON.stringify(buildCanonicalWhatIfTripCancelledFallback()), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ status: "ok", modelLoaded: true }), {
      headers: { "content-type": "application/json" },
    });
  };
}

describe("tool loop", () => {
  beforeEach(() => clearAllSessions());

  it("read forecast tool returns ML numbers", async () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    const result = await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "forecast",
      role: UserRole.CAFETERIA_MANAGER,
      forecastProvider: provider,
      testGeminiSteps: [{ functionCalls: [{ name: "get_attendance_forecast", args: {} }] }],
    });
    const output = result.toolCalls[0].returnedValue as Record<string, unknown>;
    expect(output.expectedAttendance).toBe(528);
    expect(output.recommendedPrep).toBe(562);
  });

  it("attendance simulation returns 540/575 without mutating session", async () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const before = getSessionState(session.sessionId)!.forecast.expectedAttendance;
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    const result = await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "simulate",
      role: UserRole.SCHOOL_ADMINISTRATOR,
      forecastProvider: provider,
      testGeminiSteps: [{ functionCalls: [{ name: "simulate_attendance_correction", args: { scenario: "trip_cancelled" } }] }],
    });
    const output = result.toolCalls[0].returnedValue as Record<string, unknown>;
    expect(output.expectedAttendance).toBe(540);
    expect(output.recommendedPrep).toBe(575);
    expect(output.preventableSurplus).toBe(155);
    const provenance = output.provenance as { source: string; fallbackUsed: boolean };
    expect(provenance.source).toBe("ml");
    expect(provenance.fallbackUsed).toBe(false);
    expect(getSessionState(session.sessionId)!.forecast.expectedAttendance).toBe(before);
  });

  it("proposal tool creates PENDING_APPROVAL without executing", async () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "apply",
      role: UserRole.SCHOOL_ADMINISTRATOR,
      forecastProvider: provider,
      testGeminiSteps: [
        {
          functionCalls: [
            { name: "propose_attendance_update", args: { reason: "Trip cancelled due to weather." } },
          ],
        },
      ],
    });
    const state = getSessionState(session.sessionId)!;
    expect(state.proposals[0].status).toBe("PENDING_APPROVAL");
    expect(state.forecast.expectedAttendance).toBe(528);
  });

  it("rejects preparation below safety floor", async () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    const result = await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "unsafe",
      role: UserRole.CAFETERIA_MANAGER,
      forecastProvider: provider,
      testGeminiSteps: [
        {
          functionCalls: [
            {
              name: "propose_preparation_override",
              args: { proposedQuantity: 480, reason: "Reduce waste" },
            },
          ],
        },
      ],
    });
    expect(result.toolCalls[0].returnedValue).toMatchObject({ error: expect.any(String) });
    expect(getSessionState(session.sessionId)!.proposals).toHaveLength(0);
  });

  it("rejects unknown and banned tools", async () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    const unknown = await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "x",
      role: UserRole.CAFETERIA_MANAGER,
      forecastProvider: provider,
      testGeminiSteps: [{ functionCalls: [{ name: "mutate_state", args: {} }] }],
    });
    expect(unknown.toolCalls[0].permissionPassed).toBe(false);

    const banned = await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "x",
      role: UserRole.CAFETERIA_MANAGER,
      forecastProvider: provider,
      testGeminiSteps: [{ functionCalls: [{ name: "delete_audit", args: {} }] }],
    });
    expect(banned.toolCalls[0].permissionPassed).toBe(false);
    expect(BANNED_TOOLS).toContain("delete_audit");
    expect(ALLOWED_TOOLS).not.toContain("delete_audit" as never);
  });

  it("stops repeated identical tool calls", async () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    const result = await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "repeat",
      role: UserRole.CAFETERIA_MANAGER,
      forecastProvider: provider,
      testGeminiSteps: [
        {
          functionCalls: [
            { name: "get_attendance_forecast", args: {} },
            { name: "get_attendance_forecast", args: {} },
            { name: "get_attendance_forecast", args: {} },
          ],
        },
      ],
    });
    expect(result.stoppedReason).toContain("Repeated identical");
  });

  it("blocks unauthorized role from attendance proposal", async () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    const result = await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "apply",
      role: UserRole.CAFETERIA_MANAGER,
      forecastProvider: provider,
      testGeminiSteps: [
        { functionCalls: [{ name: "propose_attendance_update", args: { reason: "Attempt escalation" } }] },
      ],
    });
    expect(result.toolCalls[0].permissionPassed).toBe(false);
  });

  it("rejects malformed tool arguments", async () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    const result = await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "bad args",
      role: UserRole.SCHOOL_ADMINISTRATOR,
      forecastProvider: provider,
      testGeminiSteps: [
        {
          functionCalls: [
            { name: "propose_attendance_update", args: { reason: "" } },
            { name: "simulate_attendance_correction", args: { scenario: "invalid" } },
          ],
        },
      ],
    });
    expect(result.toolCalls[0].returnedValue).toMatchObject({ error: "Malformed tool arguments" });
    expect(result.toolCalls[1].returnedValue).toMatchObject({ error: "Malformed tool arguments" });
  });

  it("enforces maximum tool loop iterations for live Gemini path", async () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    const generateContent = vi.fn().mockImplementation(() => {
      const limit = generateContent.mock.calls.length + 1;
      return Promise.resolve({
        functionCalls: [{ name: "read_audit_storyline", args: { limit } }],
      });
    });
    const fakeAi = { models: { generateContent } } as unknown as GoogleGenAI;

    const result = await runControlledToolLoop({
      sessionId: session.sessionId,
      message: "loop",
      role: UserRole.CAFETERIA_MANAGER,
      forecastProvider: provider,
      ai: fakeAi,
    });

    expect(generateContent).toHaveBeenCalledTimes(MAX_TOOL_LOOP_ITERATIONS);
    expect(result.stoppedReason).toContain("Maximum tool loop iterations");
    expect(result.toolCalls.length).toBe(MAX_TOOL_LOOP_ITERATIONS);
  });

  it("refuses banned approval and execution tools", async () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: mlFetch(),
    });
    for (const banned of ["approve_proposal", "execute_proposal", "undo"] as const) {
      const result = await runControlledToolLoop({
        sessionId: session.sessionId,
        message: "x",
        role: UserRole.SCHOOL_ADMINISTRATOR,
        forecastProvider: provider,
        testGeminiSteps: [{ functionCalls: [{ name: banned, args: {} }] }],
      });
      expect(result.toolCalls[0].permissionPassed).toBe(false);
      expect(getSessionState(session.sessionId)!.proposals).toHaveLength(0);
    }
  });

  it("does not expose audit deletion tools", () => {
    expect(ALLOWED_TOOLS).not.toContain("delete_audit");
    expect(ALLOWED_TOOLS).not.toContain("replace_audit");
    expect(BANNED_TOOLS).toContain("delete_audit");
  });
});
