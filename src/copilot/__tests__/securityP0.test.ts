import { describe, it, expect, beforeEach } from "vitest";
import { UserRole } from "../../types";
import { processCopilotResponse } from "../copilotResponseProcessor";
import {
  clearAllSessions,
  createSession,
  approveProposal,
  getSession,
  addSanitizedProposals,
  getSessionState,
  updateProposalsPermittedForTest,
} from "../sessionStore";
import { COPILOT_PROPOSALS_DISABLED, sanitizeProposals } from "../proposalValidator";
import { runCopilotTurn } from "../geminiRunner";
import { ForecastProvider } from "../forecastProvider";
import { buildCanonicalForecastFallback } from "../canonicalMlFeatures";
import { CORRECTED_ATTENDANCE, SAFETY_FLOOR } from "../demoConstants";

function testForecastProvider() {
  return new ForecastProvider({
    config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
    fetchFn: async (url) => {
      if (url.endsWith("/v1/forecast") || url.endsWith("/v1/what-if")) {
        return new Response(JSON.stringify(buildCanonicalForecastFallback()), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ status: "ok" }));
    },
  });
}

beforeEach(() => {
  clearAllSessions();
});

describe("malformed model output", () => {
  it("rejects structurally invalid copilot payloads", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const result = processCopilotResponse({ answer: 123 }, session.sessionId, UserRole.CAFETERIA_MANAGER);
    expect(result).toHaveProperty("error", "Malformed model output");
  });

  it("rejects copilot requests with invalid session ids via schema", async () => {
    const { CopilotRequestSchema } = await import("../schemas");
    const parsed = CopilotRequestSchema.safeParse({ sessionId: "not-a-uuid", message: "hi" });
    expect(parsed.success).toBe(false);
  });
});

describe("role escalation", () => {
  it("blocks cafeteria manager from proposing attendance updates", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const snapshot = getSessionState(session.sessionId)!;
    const { accepted, rejected } = sanitizeProposals(
      [
        {
          actionType: "ATTENDANCE_UPDATE",
          title: "Escalation attempt",
          summary: "Try to change attendance",
          reason: "Unauthorized",
          after: { expectedAttendance: CORRECTED_ATTENDANCE, recommendedPreparation: 575 },
          before: { expectedAttendance: 528, recommendedPreparation: 562 },
        },
      ],
      snapshot,
      UserRole.CAFETERIA_MANAGER
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toContain("cannot propose");
  });

  it("blocks platform administrator from approving operational proposals", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const snapshot = getSessionState(session.sessionId)!;
    const { accepted } = sanitizeProposals(
      [
        {
          actionType: "PREPARATION_OVERRIDE",
          title: "Prep override",
          summary: "Align to recommendation",
          reason: "Test",
          after: { proposedQuantity: 562 },
          before: { currentPreparationPlan: 730 },
        },
      ],
      snapshot,
      UserRole.CAFETERIA_MANAGER
    );
    addSanitizedProposals(session.sessionId, accepted);

    const internal = getSession(session.sessionId)!;
    internal.role = UserRole.PLATFORM_ADMINISTRATOR;

    const result = approveProposal(session.sessionId, accepted[0].proposalId);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
  });
});

describe("false requiredApprovals metadata", () => {
  it("overwrites model-supplied empty approval roles with server policy", async () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const turn = await runCopilotTurn({
      sessionId: session.sessionId,
      message: "change attendance trip cancelled apply correction",
      mode: "mock",
      forecastProvider: testForecastProvider(),
    });
    expect(turn.ok).toBe(true);
    expect(turn.processed?.response.proposedActions[0]?.requiredApprovals).toEqual([
      UserRole.SCHOOL_ADMINISTRATOR,
    ]);
  });
});

describe("safety floor", () => {
  it("rejects preparation quantities below 540", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const snapshot = getSessionState(session.sessionId)!;
    const { accepted, rejected } = sanitizeProposals(
      [
        {
          actionType: "PREPARATION_OVERRIDE",
          title: "Unsafe prep",
          summary: "Reduce to 480",
          reason: "User request",
          after: { proposedQuantity: 480 },
          before: { currentPreparationPlan: 730 },
        },
      ],
      snapshot,
      UserRole.CAFETERIA_MANAGER
    );
    expect(accepted).toHaveLength(0);
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("refuses unsafe prep via mock tool loop", async () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const turn = await runCopilotTurn({
      sessionId: session.sessionId,
      message: "reduce prep to 480 meals limit",
      mode: "mock",
      forecastProvider: testForecastProvider(),
    });
    expect(turn.ok).toBe(true);
    expect(turn.processed?.response.proposedActions).toHaveLength(0);
    expect(turn.processed?.response.toolCalls[0]?.permissionPassed).toBe(false);
  });
});

describe("stale proposals", () => {
  it("returns 409 when session state diverges from proposal before snapshot", () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const snapshot = getSessionState(session.sessionId)!;
    const { accepted } = sanitizeProposals(
      [
        {
          actionType: "ATTENDANCE_UPDATE",
          title: "Attendance correction",
          summary: "Trip cancelled",
          reason: "Weather",
          after: { expectedAttendance: CORRECTED_ATTENDANCE },
          before: { expectedAttendance: 528, recommendedPreparation: 562 },
        },
      ],
      snapshot,
      UserRole.SCHOOL_ADMINISTRATOR
    );
    addSanitizedProposals(session.sessionId, accepted);

    const internal = getSession(session.sessionId)!;
    internal.forecast.expectedAttendance = 500;

    const result = approveProposal(session.sessionId, accepted[0].proposalId);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(409);
    expect(result.error).toContain("before-state");
  });
});

describe("duplicate approvals", () => {
  it("returns 409 on second approval without double mutation", () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const snapshot = getSessionState(session.sessionId)!;
    const { accepted } = sanitizeProposals(
      [
        {
          actionType: "ATTENDANCE_UPDATE",
          title: "Attendance correction",
          summary: "Trip cancelled",
          reason: "Weather",
          after: { expectedAttendance: CORRECTED_ATTENDANCE },
          before: { expectedAttendance: 528, recommendedPreparation: 562 },
        },
      ],
      snapshot,
      UserRole.SCHOOL_ADMINISTRATOR
    );
    addSanitizedProposals(session.sessionId, accepted);

    const first = approveProposal(session.sessionId, accepted[0].proposalId);
    expect(first.ok).toBe(true);
    const attendanceAfterFirst = getSessionState(session.sessionId)!.forecast.expectedAttendance;

    const second = approveProposal(session.sessionId, accepted[0].proposalId);
    expect(second.ok).toBe(false);
    expect(second.statusCode).toBe(409);

    const attendanceAfterSecond = getSessionState(session.sessionId)!.forecast.expectedAttendance;
    expect(attendanceAfterSecond).toBe(attendanceAfterFirst);
    expect(attendanceAfterSecond).toBe(CORRECTED_ATTENDANCE);
  });
});

describe("manual mode proposal lock", () => {
  it("blocks pending proposal execution when proposal mode is disabled", () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const snapshot = getSessionState(session.sessionId)!;
    const { accepted } = sanitizeProposals(
      [
        {
          actionType: "ATTENDANCE_UPDATE",
          title: "Attendance correction",
          summary: "Trip cancelled",
          reason: "Weather",
          after: { expectedAttendance: CORRECTED_ATTENDANCE },
          before: { expectedAttendance: 528, recommendedPreparation: 562 },
        },
      ],
      snapshot,
      UserRole.SCHOOL_ADMINISTRATOR
    );
    addSanitizedProposals(session.sessionId, accepted);
    updateProposalsPermittedForTest(session.sessionId, false);

    const result = approveProposal(session.sessionId, accepted[0].proposalId);

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(423);
    expect(result.error).toBe(COPILOT_PROPOSALS_DISABLED);
    const state = getSessionState(session.sessionId)!;
    expect(state.forecast.expectedAttendance).toBe(528);
    expect(state.proposals[0].status).toBe("PENDING_APPROVAL");
    expect(state.auditLogs[0].executionResult).toBe("FAILED");
  });
});

describe("model security metadata recomputation", () => {
  it("discards model-authored approval and policy fields via legacy sanitizer", () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const processed = processCopilotResponse(
      {
        answer: "test",
        answerType: "EXPLANATION",
        evidence: [],
        provenance: [],
        uncertainty: { level: "LOW", explanation: "x" },
        limitations: [],
        toolCalls: [],
        proposedActions: [
          {
            actionType: "ATTENDANCE_UPDATE",
            title: "x",
            summary: "x",
            reason: "x",
            before: { expectedAttendance: 528, recommendedPreparation: 562 },
            after: { expectedAttendance: 540 },
            requiredApprovals: [],
            policyChecks: [{ policy: "Fake", passed: true, explanation: "bad" }],
            status: "EXECUTED",
          },
        ],
        requiresHumanApproval: true,
      },
      session.sessionId,
      UserRole.SCHOOL_ADMINISTRATOR
    );
    expect("error" in processed).toBe(false);
    if ("error" in processed) return;
    const p = processed.response.proposedActions[0];
    expect(p.requiredApprovals).toEqual([UserRole.SCHOOL_ADMINISTRATOR]);
    expect(p.status).toBe("PENDING_APPROVAL");
    expect(p.policyChecks.every((c) => c.policy !== "Fake")).toBe(true);
  });
});

describe("mock and live path parity", () => {
  it("routes mock copilot output through the controlled tool loop", async () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const provider = new ForecastProvider({
      config: { serviceUrl: "http://ml.test", requestTimeoutMs: 2000, allowFallback: true },
      fetchFn: async (url) => {
        if (url.endsWith("/v1/forecast")) {
          return new Response(JSON.stringify(buildCanonicalForecastFallback()), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ status: "ok" }));
      },
    });
    const { runCopilotTurn } = await import("../geminiRunner");
    const turn = await runCopilotTurn({
      sessionId: session.sessionId,
      message: "why is Thursday high risk explain forecast",
      mode: "mock",
      forecastProvider: provider,
    });
    expect(turn.ok).toBe(true);
    expect(turn.processed?.response.toolCalls.every((tc) => typeof tc.permissionPassed === "boolean")).toBe(true);
  });
});

describe("safety floor constant", () => {
  it("matches canonical demo safety floor of 540", () => {
    expect(SAFETY_FLOOR).toBe(540);
  });
});
