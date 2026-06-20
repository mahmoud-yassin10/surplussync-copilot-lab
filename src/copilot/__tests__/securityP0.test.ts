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
} from "../sessionStore";
import { sanitizeProposals } from "../proposalValidator";
import { executeMockCopilot } from "../mockGeminiClient";
import { CORRECTED_ATTENDANCE, SAFETY_FLOOR } from "../demoConstants";

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
  it("overwrites model-supplied empty approval roles with server policy", () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const snapshot = getSessionState(session.sessionId)!;
    const raw = executeMockCopilot(
      "change attendance trip cancelled",
      UserRole.SCHOOL_ADMINISTRATOR,
      730
    );
    const firstProposal = { ...raw.proposedActions[0] } as Record<string, unknown>;
    firstProposal.requiredApprovals = [];
    firstProposal.policyChecks = [{ policy: "Fake", passed: true, explanation: "Model lied" }];

    const processed = processCopilotResponse(raw, session.sessionId, UserRole.SCHOOL_ADMINISTRATOR);
    expect("error" in processed).toBe(false);
    if ("error" in processed) return;

    expect(processed.response.proposedActions[0].requiredApprovals).toEqual([
      UserRole.SCHOOL_ADMINISTRATOR,
    ]);
    expect(processed.response.proposedActions[0].policyChecks.every((c) => c.policy !== "Fake")).toBe(
      true
    );
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

  it("refuses unsafe prep via mock copilot tool path", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const raw = executeMockCopilot("reduce prep to 480 meals limit", UserRole.CAFETERIA_MANAGER, 730);
    const processed = processCopilotResponse(raw, session.sessionId, UserRole.CAFETERIA_MANAGER);
    expect("error" in processed).toBe(false);
    if ("error" in processed) return;
    expect(processed.response.proposedActions).toHaveLength(0);
    expect(processed.response.toolCalls[0].permissionPassed).toBe(false);
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

describe("model security metadata recomputation", () => {
  it("discards model-authored approval and policy fields", () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const raw = executeMockCopilot(
      "change attendance trip cancelled",
      UserRole.SCHOOL_ADMINISTRATOR,
      730
    );
    const draft = { ...raw.proposedActions[0] } as Record<string, unknown>;
    draft.proposalId = "model-slug-id";
    draft.requiredApprovals = [];
    draft.status = "EXECUTED";
    draft.createdAt = "2020-01-01T00:00:00.000Z";
    draft.expiresAt = "2020-01-01T00:00:00.000Z";
    draft.expectedConsequences = ["Fabricated"];
    draft.policyChecks = [{ policy: "Fake", passed: true, explanation: "bad" }];
    raw.proposedActions = [draft as unknown as (typeof raw.proposedActions)[0]];

    const processed = processCopilotResponse(raw, session.sessionId, UserRole.SCHOOL_ADMINISTRATOR);
    expect("error" in processed).toBe(false);
    if ("error" in processed) return;

    const p = processed.response.proposedActions[0];
    expect(p.proposalId).not.toBe("model-slug-id");
    expect(p.requiredApprovals).toEqual([UserRole.SCHOOL_ADMINISTRATOR]);
    expect(p.status).toBe("PENDING_APPROVAL");
    expect(p.expectedConsequences).not.toContain("Fabricated");
    expect(p.policyChecks.every((c) => c.policy !== "Fake")).toBe(true);
    expect(p.createdAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(p.expiresAt).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("mock and live path parity", () => {
  it("routes mock copilot output through the same sanitizer", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const raw = executeMockCopilot("why is Thursday high risk explain forecast", UserRole.CAFETERIA_MANAGER, 730);
    const processed = processCopilotResponse(raw, session.sessionId, UserRole.CAFETERIA_MANAGER);
    expect("error" in processed).toBe(false);
    if ("error" in processed) return;
    expect(processed.response.toolCalls.every((tc) => typeof tc.permissionPassed === "boolean")).toBe(
      true
    );
  });
});

describe("safety floor constant", () => {
  it("matches canonical demo safety floor of 540", () => {
    expect(SAFETY_FLOOR).toBe(540);
  });
});
