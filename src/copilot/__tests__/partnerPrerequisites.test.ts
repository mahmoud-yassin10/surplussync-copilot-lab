import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createLabApp } from "../../server/createApp";
import { UserRole } from "../../types";
import {
  addSanitizedProposals,
  approveProposal,
  clearAllSessions,
  createSession,
  getSession,
  getSessionState,
  updatePartnerPrerequisitesForTest,
} from "../sessionStore";
import { sanitizeProposals } from "../proposalValidator";

function setValidPartnerPrerequisites(sessionId: string, surplusMeals = 64) {
  updatePartnerPrerequisitesForTest(sessionId, {
    surplusConfirmed: true,
    surplusMeals,
    foodSafetyChecklistComplete: true,
    recoveryWindowValid: true,
    proposalsPermitted: true,
    revision: 1,
  });
}

function createPartnerProposal(sessionId: string, partnerId = "metro-food-bank") {
  const snapshot = getSessionState(sessionId)!;
  const { accepted, rejected } = sanitizeProposals(
    [
      {
        actionType: "PARTNER_SELECTION",
        title: "Partner selection",
        summary: "Select partner after prerequisites.",
        reason: "Test",
        after: { selectedPartnerId: partnerId },
        before: { selectedPartnerId: snapshot.selectedPartnerId },
      },
    ],
    snapshot,
    UserRole.CAFETERIA_MANAGER
  );
  return { accepted, rejected };
}

beforeEach(() => {
  clearAllSessions();
});

describe("partner prerequisite enforcement", () => {
  it("rejects direct API bypass attempts before prerequisites are reconciled", async () => {
    const app = createLabApp({ geminiAvailable: false });
    const created = await request(app).post("/api/session").send({
      role: UserRole.CAFETERIA_MANAGER,
    });

    const res = await request(app)
      .post(`/api/session/${created.body.sessionId}/proposals/partner-selection`)
      .send({ partnerId: "metro-food-bank" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("PARTNER_PREREQUISITES_INCOMPLETE");
    const state = getSessionState(created.body.sessionId)!;
    expect(state.proposals).toHaveLength(0);
    expect(state.selectedPartnerId).toBe("metro-food-bank");
  });

  it("blocks partner proposals when the checklist is incomplete", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    setValidPartnerPrerequisites(session.sessionId);
    updatePartnerPrerequisitesForTest(session.sessionId, {
      foodSafetyChecklistComplete: false,
    });

    const { accepted, rejected } = createPartnerProposal(session.sessionId);

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe("PARTNER_PREREQUISITES_INCOMPLETE");
  });

  it("blocks partner proposals when surplus has not been confirmed", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    setValidPartnerPrerequisites(session.sessionId);
    updatePartnerPrerequisitesForTest(session.sessionId, {
      surplusConfirmed: false,
      surplusMeals: null,
    });

    const { accepted, rejected } = createPartnerProposal(session.sessionId);

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe("PARTNER_PREREQUISITES_INCOMPLETE");
  });

  it("blocks partner proposals when the recovery window is invalid", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    setValidPartnerPrerequisites(session.sessionId);
    updatePartnerPrerequisitesForTest(session.sessionId, {
      recoveryWindowValid: false,
    });

    const { accepted, rejected } = createPartnerProposal(session.sessionId);

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe("PARTNER_PREREQUISITES_INCOMPLETE");
  });

  it("blocks unauthorized roles before creating partner proposals", () => {
    const session = createSession(UserRole.SCHOOL_ADMINISTRATOR);
    setValidPartnerPrerequisites(session.sessionId);
    const snapshot = getSessionState(session.sessionId)!;

    const { accepted, rejected } = sanitizeProposals(
      [
        {
          actionType: "PARTNER_SELECTION",
          title: "Partner selection",
          summary: "Unauthorized role.",
          reason: "Test",
          after: { selectedPartnerId: "metro-food-bank" },
          before: { selectedPartnerId: snapshot.selectedPartnerId },
        },
      ],
      snapshot,
      UserRole.SCHOOL_ADMINISTRATOR
    );

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toContain("cannot propose");
  });

  it("blocks ineligible or insufficient-capacity partners", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    setValidPartnerPrerequisites(session.sessionId, 95);

    const unavailable = createPartnerProposal(session.sessionId, "greenleaf-hub");
    expect(unavailable.accepted).toHaveLength(0);
    expect(unavailable.rejected[0]?.reason).toBe("PARTNER_PREREQUISITES_INCOMPLETE");

    const insufficientCapacity = createPartnerProposal(session.sessionId, "harbor-shelter");
    expect(insufficientCapacity.accepted).toHaveLength(0);
    expect(insufficientCapacity.rejected[0]?.reason).toBe("PARTNER_PREREQUISITES_INCOMPLETE");
  });

  it("allows valid partner selection and keeps duplicate approval idempotent", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    setValidPartnerPrerequisites(session.sessionId, 64);
    const { accepted } = createPartnerProposal(session.sessionId, "metro-food-bank");
    addSanitizedProposals(session.sessionId, accepted);

    const first = approveProposal(session.sessionId, accepted[0].proposalId);
    expect(first.ok).toBe(true);
    expect(first.state?.selectedPartnerId).toBe("metro-food-bank");

    const auditAfterFirst = getSessionState(session.sessionId)!.auditLogs.length;
    const second = approveProposal(session.sessionId, accepted[0].proposalId);
    expect(second.ok).toBe(false);
    expect(second.statusCode).toBe(409);
    expect(getSessionState(session.sessionId)!.selectedPartnerId).toBe("metro-food-bank");
    expect(getSessionState(session.sessionId)!.auditLogs.length).toBe(auditAfterFirst);
  });

  it("fails safely when a proposal is stale", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    setValidPartnerPrerequisites(session.sessionId);
    const { accepted } = createPartnerProposal(session.sessionId, "harbor-shelter");
    addSanitizedProposals(session.sessionId, accepted);
    getSession(session.sessionId)!.selectedPartnerId = "neighborhood-kitchen";

    const approval = approveProposal(session.sessionId, accepted[0].proposalId);

    expect(approval.ok).toBe(false);
    expect(approval.statusCode).toBe(409);
    expect(approval.error).toBe("PARTNER_SELECTION_PROPOSAL_STALE");
    const state = getSessionState(session.sessionId)!;
    expect(state.proposals[0].status).toBe("PENDING_APPROVAL");
    expect(state.auditLogs[0].executionResult).toBe("FAILED");
  });

  it("fails safely after reset invalidates a pending proposal", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    setValidPartnerPrerequisites(session.sessionId);
    const { accepted } = createPartnerProposal(session.sessionId, "harbor-shelter");
    addSanitizedProposals(session.sessionId, accepted);
    updatePartnerPrerequisitesForTest(session.sessionId, {
      resetVersion: 1,
      revision: 2,
    });

    const approval = approveProposal(session.sessionId, accepted[0].proposalId);

    expect(approval.ok).toBe(false);
    expect(approval.statusCode).toBe(409);
    expect(approval.error).toBe("PARTNER_SELECTION_PROPOSAL_STALE");
    const state = getSessionState(session.sessionId)!;
    expect(state.selectedPartnerId).toBe("metro-food-bank");
    expect(state.proposals[0].status).toBe("PENDING_APPROVAL");
  });

  it("revalidates checklist state at approval time", () => {
    const session = createSession(UserRole.CAFETERIA_MANAGER);
    setValidPartnerPrerequisites(session.sessionId);
    const { accepted } = createPartnerProposal(session.sessionId, "harbor-shelter");
    addSanitizedProposals(session.sessionId, accepted);
    updatePartnerPrerequisitesForTest(session.sessionId, {
      foodSafetyChecklistComplete: false,
    });

    const approval = approveProposal(session.sessionId, accepted[0].proposalId);

    expect(approval.ok).toBe(false);
    expect(approval.statusCode).toBe(422);
    expect(approval.error).toBe("PARTNER_PREREQUISITES_INCOMPLETE");
    const state = getSessionState(session.sessionId)!;
    expect(state.selectedPartnerId).toBe("metro-food-bank");
    expect(state.proposals[0].status).toBe("PENDING_APPROVAL");
  });
});
