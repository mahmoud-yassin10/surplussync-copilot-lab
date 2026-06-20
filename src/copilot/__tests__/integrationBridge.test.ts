import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createLabApp } from "../../server/createApp";
import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  CURRENT_PLAN,
} from "../demoConstants";
import { authorizeMainAppService } from "../integrationAuth";
import { validateReconciliationRequest } from "../reconciliationSchemas";
import { reconcileSessionFromMainApp } from "../reconcileSessionFromMainApp";
import {
  addSanitizedProposals,
  approveProposal,
  clearAllSessions,
  createSession,
  getKnownPartnerIds,
  getSessionState,
} from "../sessionStore";
import { COPILOT_PROPOSALS_DISABLED, sanitizeProposals } from "../proposalValidator";
import { UserRole } from "../../types";

const TEST_TOKEN = "test-main-app-integration-token";

function baselinePayload(overrides: Record<string, unknown> = {}) {
  return {
    source: "surplussync-plus",
    stateVersion: "ssp_state_v2",
    role: UserRole.CAFETERIA_MANAGER,
    operational: {
      expectedAttendance: BASELINE_ATTENDANCE,
      recommendedPreparation: BASELINE_RECOMMENDED_PREP,
      currentPreparationPlan: CURRENT_PLAN,
      attendanceCorrected: false,
      provisionalAlertsSent: false,
      selectedPartnerId: "metro-food-bank",
    },
    ...overrides,
  };
}

function correctedPayload(overrides: Record<string, unknown> = {}) {
  return baselinePayload({
    role: UserRole.SCHOOL_ADMINISTRATOR,
    operational: {
      expectedAttendance: CORRECTED_ATTENDANCE,
      recommendedPreparation: CORRECTED_RECOMMENDED_PREP,
      currentPreparationPlan: CURRENT_PLAN,
      attendanceCorrected: true,
      provisionalAlertsSent: false,
      selectedPartnerId: "harbor-shelter",
    },
    ...overrides,
  });
}

function authHeader(token = TEST_TOKEN) {
  return { Authorization: `Bearer ${token}` };
}

function createIntegrationApp(token: string | null = TEST_TOKEN) {
  return createLabApp({ mainAppServiceToken: token, geminiAvailable: false });
}

describe("integration auth", () => {
  it("accepts the correct bearer token", () => {
    expect(authorizeMainAppService(`Bearer ${TEST_TOKEN}`, TEST_TOKEN)).toEqual({ ok: true });
  });

  it("rejects a missing token", () => {
    const result = authorizeMainAppService(undefined, TEST_TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.statusCode).toBe(401);
    expect(result.error).not.toContain(TEST_TOKEN);
  });

  it("rejects an incorrect token", () => {
    const result = authorizeMainAppService("Bearer wrong-token", TEST_TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.statusCode).toBe(401);
  });

  it("disables endpoints when integration token is absent", () => {
    const result = authorizeMainAppService(`Bearer ${TEST_TOKEN}`, null);
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.statusCode).toBe(503);
  });
});

describe("reconciliation schema", () => {
  const partners = getKnownPartnerIds();

  it("accepts a valid baseline snapshot", () => {
    const result = validateReconciliationRequest(baselinePayload(), partners);
    expect(result.ok).toBe(true);
  });

  it("accepts a valid corrected snapshot", () => {
    const result = validateReconciliationRequest(correctedPayload(), partners);
    expect(result.ok).toBe(true);
  });

  it("accepts allowed current preparation plan values", () => {
    for (const plan of [730, 562, 575] as const) {
      const payload = baselinePayload({
        operational: {
          ...baselinePayload().operational,
          currentPreparationPlan: plan,
        },
      });
      expect(validateReconciliationRequest(payload, partners).ok).toBe(true);
    }
  });

  it("accepts proposal mode from the main app snapshot", () => {
    const result = validateReconciliationRequest(
      baselinePayload({
        operational: {
          ...baselinePayload().operational,
          proposalsPermitted: false,
        },
      }),
      partners
    );
    expect(result.ok).toBe(true);
  });

  it("rejects impossible attendance and recommendation combinations", () => {
    const payload = baselinePayload({
      operational: {
        ...baselinePayload().operational,
        attendanceCorrected: false,
        expectedAttendance: CORRECTED_ATTENDANCE,
        recommendedPreparation: CORRECTED_RECOMMENDED_PREP,
      },
    });
    const result = validateReconciliationRequest(payload, partners);
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.statusCode).toBe(422);
  });

  it("rejects unknown partner IDs", () => {
    const payload = baselinePayload({
      operational: {
        ...baselinePayload().operational,
        selectedPartnerId: "unknown-partner",
      },
    });
    const result = validateReconciliationRequest(payload, partners);
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.statusCode).toBe(422);
  });

  it("rejects arbitrary extra top-level properties", () => {
    const result = validateReconciliationRequest(
      { ...baselinePayload(), proposals: [{ actionType: "ATTENDANCE_UPDATE" }] },
      partners
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.statusCode).toBe(422);
  });

  it("rejects audit injection", () => {
    const result = validateReconciliationRequest(
      { ...baselinePayload(), auditLogs: [{ action: "forged" }] },
      partners
    );
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.statusCode).toBe(422);
  });
});

function validated(payload: unknown) {
  const result = validateReconciliationRequest(payload, getKnownPartnerIds());
  if (result.ok === false) throw new Error(result.error);
  return result.data;
}

describe("reconcileSessionFromMainApp", () => {
  beforeEach(() => clearAllSessions());

  it("updates reconcilable session fields without executing proposals", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const snapshot = getSessionState(session.sessionId)!;
    const { accepted } = sanitizeProposals(
      [
        {
          actionType: "ATTENDANCE_UPDATE",
          title: "Attendance correction",
          summary: "Trip cancelled",
          reason: "Weather",
          after: { expectedAttendance: CORRECTED_ATTENDANCE },
          before: {
            expectedAttendance: BASELINE_ATTENDANCE,
            recommendedPreparation: BASELINE_RECOMMENDED_PREP,
          },
        },
      ],
      snapshot,
      UserRole.SCHOOL_ADMINISTRATOR
    );
    addSanitizedProposals(session.sessionId, accepted);

    const result = reconcileSessionFromMainApp(session.sessionId, validated(correctedPayload()));
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.state?.proposals[0].status).toBe("PENDING_APPROVAL");
    expect(result.state?.forecast.expectedAttendance).toBe(CORRECTED_ATTENDANCE);
  });

  it("does not delete audit history", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const beforeCount = getSessionState(session.sessionId)!.auditLogs.length;
    reconcileSessionFromMainApp(session.sessionId, validated(correctedPayload()));
    const after = getSessionState(session.sessionId)!;
    expect(after.auditLogs.length).toBeGreaterThan(beforeCount);
    expect(after.auditLogs.some((a) => a.auditId === "adt-init")).toBe(true);
  });

  it("is idempotent for identical reconciliation payloads", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const payload = validated(correctedPayload());
    reconcileSessionFromMainApp(session.sessionId, payload);
    const auditAfterFirst = getSessionState(session.sessionId)!.auditLogs.length;
    const second = reconcileSessionFromMainApp(session.sessionId, payload);
    expect(second.idempotent).toBe(true);
    expect(second.changed).toBe(false);
    expect(getSessionState(session.sessionId)!.auditLogs.length).toBe(auditAfterFirst);
  });

  it("appends one server audit entry when reconciliation changes state", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    const before = getSessionState(session.sessionId)!.auditLogs.length;
    reconcileSessionFromMainApp(session.sessionId, validated(correctedPayload()));
    const after = getSessionState(session.sessionId)!.auditLogs.length;
    expect(after - before).toBe(1);
    expect(getSessionState(session.sessionId)!.auditLogs[0].action).toBe(
      "MAIN_APP_STATE_RECONCILIATION"
    );
  });

  it("reconciles manual mode and blocks new proposals", () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    const result = reconcileSessionFromMainApp(
      session.sessionId,
      validated(
        baselinePayload({
          role: UserRole.SCHOOL_ADMINISTRATOR,
          operational: {
            ...baselinePayload().operational,
            proposalsPermitted: false,
          },
        })
      )
    );
    expect(result.ok).toBe(true);
    expect(result.state?.proposalsPermitted).toBe(false);

    const { accepted, rejected } = sanitizeProposals(
      [
        {
          actionType: "ATTENDANCE_UPDATE",
          title: "Attendance correction",
          summary: "Trip cancelled",
          reason: "Weather",
          after: { expectedAttendance: CORRECTED_ATTENDANCE },
          before: {
            expectedAttendance: BASELINE_ATTENDANCE,
            recommendedPreparation: BASELINE_RECOMMENDED_PREP,
          },
        },
      ],
      getSessionState(session.sessionId)!,
      UserRole.SCHOOL_ADMINISTRATOR
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe(COPILOT_PROPOSALS_DISABLED);
  });

  it("leaves stale proposals failing execution validation after reconciliation", () => {
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
          before: {
            expectedAttendance: BASELINE_ATTENDANCE,
            recommendedPreparation: BASELINE_RECOMMENDED_PREP,
          },
        },
      ],
      snapshot,
      UserRole.SCHOOL_ADMINISTRATOR
    );
    addSanitizedProposals(session.sessionId, accepted);
    reconcileSessionFromMainApp(session.sessionId, validated(correctedPayload()));

    const approval = approveProposal(session.sessionId, accepted[0].proposalId);
    expect(approval.ok).toBe(false);
    expect(approval.statusCode).toBe(409);
    expect(approval.error).toContain("before-state");
  });
});

describe("HTTP integration bridge", () => {
  beforeEach(() => clearAllSessions());

  it("accepts reconciliation with a correct token", async () => {
    const app = createIntegrationApp();
    const created = await request(app).post("/api/session").send({});
    const res = await request(app)
      .post(`/api/integration/session/${created.body.sessionId}/reconcile`)
      .set(authHeader())
      .send(baselinePayload());
    expect(res.status).toBe(200);
    expect(res.body.state.forecast.expectedAttendance).toBe(BASELINE_ATTENDANCE);
  });

  it("rejects reconciliation without authorization", async () => {
    const app = createIntegrationApp();
    const created = await request(app).post("/api/session").send({});
    const res = await request(app)
      .post(`/api/integration/session/${created.body.sessionId}/reconcile`)
      .send(baselinePayload());
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(TEST_TOKEN);
  });

  it("rejects reconciliation with an incorrect token", async () => {
    const app = createIntegrationApp();
    const created = await request(app).post("/api/session").send({});
    const res = await request(app)
      .post(`/api/integration/session/${created.body.sessionId}/reconcile`)
      .set(authHeader("wrong"))
      .send(baselinePayload());
    expect(res.status).toBe(401);
  });

  it("returns 503 when integration token is not configured", async () => {
    const app = createIntegrationApp(null);
    const created = await request(app).post("/api/session").send({});
    const res = await request(app)
      .post(`/api/integration/session/${created.body.sessionId}/reconcile`)
      .set(authHeader())
      .send(baselinePayload());
    expect(res.status).toBe(503);
  });

  it("does not expose the integration token in /api/config", async () => {
    const app = createIntegrationApp();
    const res = await request(app).get("/api/config");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(TEST_TOKEN);
    expect(res.body).not.toHaveProperty("mainAppServiceToken");
  });

  it("maps provisionalAlertsSent to alert status", async () => {
    const app = createIntegrationApp();
    const created = await request(app).post("/api/session").send({});
    const res = await request(app)
      .post(`/api/integration/session/${created.body.sessionId}/reconcile`)
      .set(authHeader())
      .send(
        baselinePayload({
          operational: {
            ...baselinePayload().operational,
            provisionalAlertsSent: true,
          },
        })
      );
    expect(res.body.state.alertStatus).toBe("SENT_PROVISIONAL");
  });

  it("deletes the targeted integration session", async () => {
    const app = createIntegrationApp();
    const created = await request(app).post("/api/session").send({});
    const sessionId = created.body.sessionId as string;
    const del = await request(app)
      .delete(`/api/integration/session/${sessionId}`)
      .set(authHeader());
    expect(del.status).toBe(204);
    const state = await request(app).get(`/api/session/${sessionId}/state`);
    expect(state.status).toBe(404);
  });

  it("cannot delete another session without the exact session ID", async () => {
    const app = createIntegrationApp();
    const first = await request(app).post("/api/session").send({});
    const second = await request(app).post("/api/session").send({});
    const del = await request(app)
      .delete(`/api/integration/session/${first.body.sessionId}`)
      .set(authHeader());
    expect(del.status).toBe(204);
    const survivor = await request(app).get(`/api/session/${second.body.sessionId}/state`);
    expect(survivor.status).toBe(200);
  });

  it("returns 404 when deleting an unknown session", async () => {
    const app = createIntegrationApp();
    const res = await request(app)
      .delete("/api/integration/session/00000000-0000-4000-8000-000000000099")
      .set(authHeader());
    expect(res.status).toBe(404);
  });
});
