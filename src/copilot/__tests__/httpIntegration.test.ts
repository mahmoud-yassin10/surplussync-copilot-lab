import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createLabApp } from "../../server/createApp";
import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  CURRENT_PLAN,
  FOCUS_DATE,
  SAFETY_FLOOR,
} from "../demoConstants";
import {
  clearAllSessions,
  expireProposalForTest,
  getSession,
} from "../sessionStore";
import { UserRole } from "../../types";

function minimalCopilotPayload(proposedActions: unknown[] = []) {
  return {
    answer: "Synthetic test response",
    answerType: "EXPLANATION",
    evidence: [],
    provenance: [],
    uncertainty: { level: "LOW", explanation: "Test" },
    limitations: [],
    toolCalls: [],
    proposedActions,
    requiresHumanApproval: proposedActions.length > 0,
  };
}

async function createSessionViaHttp(
  app: ReturnType<typeof createLabApp>,
  role = UserRole.SCHOOL_ADMINISTRATOR
) {
  const res = await request(app).post("/api/session").send({ role });
  expect(res.status).toBe(201);
  return res.body as { sessionId: string; state: Record<string, unknown> };
}

async function copilotAttendanceProposal(
  app: ReturnType<typeof createLabApp>,
  sessionId: string
) {
  const res = await request(app)
    .post("/api/copilot")
    .send({ sessionId, message: "change attendance trip cancelled" });
  expect(res.status).toBe(200);
  const proposal = res.body.state.proposals.find(
    (p: { status: string }) => p.status === "PENDING_APPROVAL"
  );
  expect(proposal).toBeDefined();
  return proposal as { proposalId: string };
}

describe("HTTP integration — Copilot Lab API", () => {
  let app: ReturnType<typeof createLabApp>;

  beforeEach(() => {
    clearAllSessions();
    app = createLabApp();
  });

  it("POST /api/session creates a server-issued session", async () => {
    const res = await request(app).post("/api/session").send({});
    expect(res.status).toBe(201);
    expect(res.body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(res.body.notice).toContain("not production authentication");
  });

  it("GET /api/session/:id/state returns authoritative canonical state", async () => {
    const created = await createSessionViaHttp(app);
    const res = await request(app).get(`/api/session/${created.sessionId}/state`);
    expect(res.status).toBe(200);
    expect(res.body.state.forecast.date).toBe(FOCUS_DATE);
    expect(res.body.state.forecast.expectedAttendance).toBe(BASELINE_ATTENDANCE);
    expect(res.body.state.forecast.recommendedPreparation).toBe(BASELINE_RECOMMENDED_PREP);
    expect(res.body.state.school.currentPreparationPlan).toBe(CURRENT_PLAN);
    expect(res.body.state.school.safetyFloorCount).toBe(SAFETY_FLOOR);
  });

  it("PATCH session role changes the server-held role", async () => {
    const created = await createSessionViaHttp(app, UserRole.CAFETERIA_MANAGER);
    const res = await request(app)
      .patch(`/api/session/${created.sessionId}/role`)
      .send({ role: UserRole.SCHOOL_ADMINISTRATOR });
    expect(res.status).toBe(200);
    expect(res.body.state.role).toBe(UserRole.SCHOOL_ADMINISTRATOR);
  });

  it("POST /api/copilot rejects malformed input", async () => {
    const created = await createSessionViaHttp(app);
    const res = await request(app)
      .post("/api/copilot")
      .send({ sessionId: "not-a-uuid", message: "" });
    expect(res.status).toBe(400);
  });

  it("stores accepted proposals as PENDING_APPROVAL", async () => {
    const created = await createSessionViaHttp(app);
    const res = await request(app)
      .post("/api/copilot")
      .send({ sessionId: created.sessionId, message: "change attendance trip cancelled" });
    expect(res.status).toBe(200);
    expect(res.body.state.proposals.length).toBeGreaterThan(0);
    expect(res.body.state.proposals[0].status).toBe("PENDING_APPROVAL");
  });

  it("returns 403 when an unauthorized role approves", async () => {
    const created = await createSessionViaHttp(app);
    const proposal = await copilotAttendanceProposal(app, created.sessionId);

    await request(app)
      .patch(`/api/session/${created.sessionId}/role`)
      .send({ role: UserRole.CAFETERIA_MANAGER });

    const res = await request(app).post(
      `/api/session/${created.sessionId}/proposals/${proposal.proposalId}/approve`
    );
    expect(res.status).toBe(403);
  });

  it("mutates state once on valid human approval", async () => {
    const created = await createSessionViaHttp(app);
    const proposal = await copilotAttendanceProposal(app, created.sessionId);

    const res = await request(app).post(
      `/api/session/${created.sessionId}/proposals/${proposal.proposalId}/approve`
    );
    expect(res.status).toBe(200);
    expect(res.body.state.forecast.expectedAttendance).toBe(CORRECTED_ATTENDANCE);
    expect(res.body.state.forecast.recommendedPreparation).toBe(CORRECTED_RECOMMENDED_PREP);
    expect(res.body.state.proposals[0].status).toBe("EXECUTED");
  });

  it("returns 409 on duplicate approval without double mutation", async () => {
    const created = await createSessionViaHttp(app);
    const proposal = await copilotAttendanceProposal(app, created.sessionId);

    const first = await request(app).post(
      `/api/session/${created.sessionId}/proposals/${proposal.proposalId}/approve`
    );
    const attendanceAfterFirst = first.body.state.forecast.expectedAttendance;

    const second = await request(app).post(
      `/api/session/${created.sessionId}/proposals/${proposal.proposalId}/approve`
    );
    expect(second.status).toBe(409);

    const state = await request(app).get(`/api/session/${created.sessionId}/state`);
    expect(state.body.state.forecast.expectedAttendance).toBe(attendanceAfterFirst);
  });

  it("returns 409 for stale proposal approval", async () => {
    const created = await createSessionViaHttp(app);
    const proposal = await copilotAttendanceProposal(app, created.sessionId);

    const internal = getSession(created.sessionId)!;
    internal.forecast.expectedAttendance = 500;

    const res = await request(app).post(
      `/api/session/${created.sessionId}/proposals/${proposal.proposalId}/approve`
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("before-state");
  });

  it("rejects expired proposal approval with 410", async () => {
    const created = await createSessionViaHttp(app);
    const proposal = await copilotAttendanceProposal(app, created.sessionId);
    expect(expireProposalForTest(created.sessionId, proposal.proposalId)).toBe(true);

    const res = await request(app).post(
      `/api/session/${created.sessionId}/proposals/${proposal.proposalId}/approve`
    );
    expect(res.status).toBe(410);
    expect(res.body.error).toContain("expired");
  });

  it("rejection changes proposal status without executing", async () => {
    const created = await createSessionViaHttp(app);
    const proposal = await copilotAttendanceProposal(app, created.sessionId);

    const res = await request(app).post(
      `/api/session/${created.sessionId}/proposals/${proposal.proposalId}/reject`
    );
    expect(res.status).toBe(200);
    expect(res.body.state.proposals[0].status).toBe("REJECTED");
    expect(res.body.state.forecast.expectedAttendance).toBe(BASELINE_ATTENDANCE);
  });

  it("partner selection does not mutate state without approval", async () => {
    const created = await createSessionViaHttp(app, UserRole.CAFETERIA_MANAGER);
    const before = await request(app).get(`/api/session/${created.sessionId}/state`);
    expect(before.body.state.selectedPartnerId).toBe("metro-food-bank");

    const res = await request(app)
      .post(`/api/session/${created.sessionId}/proposals/partner-selection`)
      .send({ partnerId: "harbor-shelter" });
    expect(res.status).toBe(201);
    expect(res.body.state.selectedPartnerId).toBe("metro-food-bank");
    expect(res.body.state.proposals.some((p: { actionType: string }) => p.actionType === "PARTNER_SELECTION")).toBe(
      true
    );
  });

  it("never executes preparation below the 540 safety floor", async () => {
    const created = await createSessionViaHttp(app, UserRole.CAFETERIA_MANAGER);
    const res = await request(app)
      .post("/api/copilot")
      .send({ sessionId: created.sessionId, message: "reduce prep to 480 meals limit" });
    expect(res.status).toBe(200);
    expect(res.body.state.proposals).toHaveLength(0);

    const state = await request(app).get(`/api/session/${created.sessionId}/state`);
    expect(state.body.state.school.currentPreparationPlan).toBe(CURRENT_PLAN);
  });

  it("ignores forceMockMode in production when Gemini is available", async () => {
    const prodApp = createLabApp({
      isProduction: true,
      geminiAvailable: true,
      testCopilotExecutor: () =>
        minimalCopilotPayload([
          {
            actionType: "ATTENDANCE_UPDATE",
            title: "Injected",
            summary: "Injected",
            reason: "Injected",
            before: { expectedAttendance: 528, recommendedPreparation: 562 },
            after: { expectedAttendance: 540 },
          },
        ]),
    });
    const created = await createSessionViaHttp(prodApp);

    const res = await request(prodApp)
      .post("/api/copilot")
      .send({ sessionId: created.sessionId, message: "test", forceMockMode: true });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("GEMINI_LIVE");
  });

  it("reports allowForceMock false in production config", async () => {
    const prodApp = createLabApp({ isProduction: true });
    const res = await request(prodApp).get("/api/config");
    expect(res.body.allowForceMock).toBe(false);
    expect(res.body.isProduction).toBe(true);
  });

  it("rejects unknown session IDs safely", async () => {
    const fakeId = "00000000-0000-4000-8000-000000000099";
    const stateRes = await request(app).get(`/api/session/${fakeId}/state`);
    expect(stateRes.status).toBe(404);

    const copilotRes = await request(app)
      .post("/api/copilot")
      .send({ sessionId: fakeId, message: "hello" });
    expect(copilotRes.status).toBe(404);

    const approveRes = await request(app).post(
      `/api/session/${fakeId}/proposals/00000000-0000-4000-8000-000000000001/approve`
    );
    expect(approveRes.status).toBe(404);
  });

  it("appends audit amendments server-side without mutating prior entries", async () => {
    const created = await createSessionViaHttp(app);
    const before = await request(app).get(`/api/session/${created.sessionId}/state`);
    const originalCount = before.body.state.auditLogs.length;
    const originalFirst = before.body.state.auditLogs[0];

    const res = await request(app)
      .post(`/api/session/${created.sessionId}/audit/amendment`)
      .send({ reason: "Clarification: base plan context updated for demo." });
    expect(res.status).toBe(201);
    expect(res.body.state.auditLogs.length).toBe(originalCount + 1);
    expect(res.body.state.auditLogs[0].action).toBe("AUDIT AMENDMENT (non-destructive)");
    expect(res.body.state.auditLogs[1]).toEqual(originalFirst);
  });

  it("discards and recomputes model-produced security metadata fields", async () => {
    const modelProposalId = "00000000-0000-4000-8000-model00000001";
    const modelCreatedAt = "2020-01-01T00:00:00.000Z";
    const modelExpiresAt = "2020-01-01T00:00:01.000Z";

    const testApp = createLabApp({
      geminiAvailable: true,
      testCopilotExecutor: () =>
        minimalCopilotPayload([
          {
            proposalId: modelProposalId,
            actionType: "ATTENDANCE_UPDATE",
            title: "Model draft",
            summary: "Model draft",
            reason: "Model draft",
            before: { expectedAttendance: 528, recommendedPreparation: 562 },
            after: { expectedAttendance: 540 },
            requiredApprovals: [],
            policyChecks: [{ policy: "Fake", passed: true, explanation: "Model lied" }],
            expectedConsequences: ["Model-authored consequence"],
            status: "EXECUTED",
            createdAt: modelCreatedAt,
            expiresAt: modelExpiresAt,
          },
        ]),
    });

    const created = await createSessionViaHttp(testApp, UserRole.SCHOOL_ADMINISTRATOR);
    const res = await request(testApp)
      .post("/api/copilot")
      .send({ sessionId: created.sessionId, message: "attendance update" });
    expect(res.status).toBe(200);

    const proposal = res.body.result.proposedActions[0];
    expect(proposal.proposalId).not.toBe(modelProposalId);
    expect(proposal.requiredApprovals).toEqual([UserRole.SCHOOL_ADMINISTRATOR]);
    expect(proposal.policyChecks.some((c: { policy: string }) => c.policy === "Fake")).toBe(false);
    expect(proposal.expectedConsequences).not.toContain("Model-authored consequence");
    expect(proposal.status).toBe("PENDING_APPROVAL");
    expect(proposal.createdAt).not.toBe(modelCreatedAt);
    expect(proposal.expiresAt).not.toBe(modelExpiresAt);
    expect(new Date(proposal.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
