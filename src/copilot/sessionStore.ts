import { randomUUID } from "crypto";
import {
  AuditEntry,
  RecoveryPartner,
  SchoolDetails,
  SchoolForecast,
  UserRole,
} from "../types";
import {
  INITIAL_AUDIT_LOGS,
  INITIAL_FORECAST,
  INITIAL_PARTNERS,
  INITIAL_SCHOOL,
} from "../data/mockData";
import { FOCUS_DATE } from "./demoConstants";
import {
  attendanceExecutionPatch,
  buildPartnerSelectionDraft,
  COPILOT_PROPOSALS_DISABLED,
  PARTNER_PREREQUISITES_INCOMPLETE,
  PARTNER_SELECTION_PROPOSAL_STALE,
  sanitizeProposals,
  validateProposalForExecution,
} from "./proposalValidator";
import { SanitizedProposal } from "./schemas";

export type AlertStatus = "DRAFT" | "SENT_PROVISIONAL" | "NONE";

export interface PartnerPrerequisites {
  surplusConfirmed: boolean;
  surplusMeals: number | null;
  foodSafetyChecklistComplete: boolean;
  recoveryWindowValid: boolean;
  proposalsPermitted: boolean;
  resetVersion: number;
  cancellationVersion: number;
  revision: number;
}

export interface SessionSnapshot {
  sessionId: string;
  role: UserRole;
  school: SchoolDetails;
  forecast: SchoolForecast;
  partners: RecoveryPartner[];
  auditLogs: AuditEntry[];
  proposals: SanitizedProposal[];
  selectedPartnerId: string;
  alertStatus: AlertStatus;
  proposalsPermitted: boolean;
  partnerPrerequisites: PartnerPrerequisites;
}

interface LabSession extends SessionSnapshot {
  createdAt: number;
}

const sessions = new Map<string, LabSession>();

export const DEFAULT_PARTNER_PREREQUISITES: PartnerPrerequisites = {
  surplusConfirmed: false,
  surplusMeals: null,
  foodSafetyChecklistComplete: false,
  recoveryWindowValid: false,
  proposalsPermitted: true,
  resetVersion: 0,
  cancellationVersion: 0,
  revision: 0,
};

function createInitialSnapshot(role: UserRole): Omit<LabSession, "sessionId" | "createdAt"> {
  return {
    role,
    school: structuredClone(INITIAL_SCHOOL),
    forecast: structuredClone(INITIAL_FORECAST),
    partners: structuredClone(INITIAL_PARTNERS),
    auditLogs: structuredClone(INITIAL_AUDIT_LOGS),
    proposals: [],
    selectedPartnerId: "metro-food-bank",
    alertStatus: "NONE",
    proposalsPermitted: true,
    partnerPrerequisites: structuredClone(DEFAULT_PARTNER_PREREQUISITES),
  };
}

export function createSession(role: UserRole = UserRole.CAFETERIA_MANAGER): SessionSnapshot {
  const sessionId = randomUUID();
  const session: LabSession = {
    sessionId,
    createdAt: Date.now(),
    ...createInitialSnapshot(role),
  };
  sessions.set(sessionId, session);
  return toSnapshot(session);
}

export function getSession(sessionId: string): LabSession | undefined {
  return sessions.get(sessionId);
}

export function getSessionState(sessionId: string): SessionSnapshot | null {
  const session = sessions.get(sessionId);
  return session ? toSnapshot(session) : null;
}

export function getKnownPartnerIds(sessionId?: string): string[] {
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) return session.partners.map((p) => p.id);
  }
  return structuredClone(INITIAL_PARTNERS).map((p) => p.id);
}

export function deleteIntegrationSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

export function updateSessionRole(sessionId: string, role: UserRole): SessionSnapshot | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.role = role;
  return toSnapshot(session);
}

export function addSanitizedProposals(
  sessionId: string,
  proposals: SanitizedProposal[]
): SessionSnapshot | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.proposals.push(...proposals);
  return toSnapshot(session);
}

export function updatePartnerPrerequisitesForTest(
  sessionId: string,
  patch: Partial<PartnerPrerequisites>
): SessionSnapshot | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.partnerPrerequisites = {
    ...session.partnerPrerequisites,
    ...patch,
  };
  return toSnapshot(session);
}

export function updateProposalsPermittedForTest(
  sessionId: string,
  proposalsPermitted: boolean
): SessionSnapshot | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  session.proposalsPermitted = proposalsPermitted;
  return toSnapshot(session);
}

export interface ApproveResult {
  ok: boolean;
  statusCode: number;
  error?: string;
  state?: SessionSnapshot;
}

export function approveProposal(sessionId: string, proposalId: string): ApproveResult {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, statusCode: 404, error: "Session not found" };
  }

  const proposal = session.proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) {
    return { ok: false, statusCode: 404, error: "Proposal not found" };
  }

  const validation = validateProposalForExecution(proposal, toSnapshot(session), session.role);
  if (!validation.ok) {
    if (shouldAuditFailedExecution(validation.error)) {
      appendFailedExecutionAudit(session, proposal, validation.error ?? "Proposal execution failed");
    }
    return { ok: false, statusCode: validation.statusCode, error: validation.error };
  }

  applyProposalMutation(session, proposal);
  proposal.status = "EXECUTED";

  const auditId = `adt-${Date.now().toString().slice(-6)}`;
  const actor =
    session.role === UserRole.CAFETERIA_MANAGER
      ? session.school.cafeteriaManager
      : session.school.schoolAdministrator;

  const audit: AuditEntry = {
    auditId,
    timestamp: new Date().toISOString(),
    actor,
    actorType: "HUMAN",
    action: proposal.title,
    role: session.role,
    proposalId: proposal.proposalId,
    before: proposal.before,
    after: proposal.after,
    reason: proposal.reason,
    permissionDecision: "GRANTED",
    approvalDecision: "APPROVED_BY_USER",
    executionResult: "SUCCESS",
    reversibility: proposal.reversible,
    undoStatus: "NOT_APPLICABLE",
  };

  session.auditLogs.unshift(audit);
  return { ok: true, statusCode: 200, state: toSnapshot(session) };
}

export function rejectProposal(sessionId: string, proposalId: string): ApproveResult {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, statusCode: 404, error: "Session not found" };
  }

  const proposal = session.proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) {
    return { ok: false, statusCode: 404, error: "Proposal not found" };
  }

  if (proposal.status === "EXECUTED") {
    return { ok: false, statusCode: 409, error: "Proposal already executed" };
  }
  if (proposal.status === "REJECTED") {
    return { ok: false, statusCode: 409, error: "Proposal already rejected" };
  }

  proposal.status = "REJECTED";

  const actor =
    session.role === UserRole.CAFETERIA_MANAGER
      ? session.school.cafeteriaManager
      : session.school.schoolAdministrator;

  const audit: AuditEntry = {
    auditId: `adt-rej-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    actor,
    actorType: "HUMAN",
    action: `Rejected proposal: ${proposal.title}`,
    role: session.role,
    proposalId: proposal.proposalId,
    before: proposal.before,
    after: null,
    reason: "User declined proposal in approval gate workspace.",
    permissionDecision: "GRANTED",
    approvalDecision: "REJECTED_BY_USER",
    executionResult: "CANCELLED",
    reversibility: false,
  };

  session.auditLogs.unshift(audit);
  return { ok: true, statusCode: 200, state: toSnapshot(session) };
}

export function createPartnerSelectionProposal(
  sessionId: string,
  partnerId: string
): { ok: boolean; statusCode: number; error?: string; state?: SessionSnapshot; proposals?: SanitizedProposal[] } {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, statusCode: 404, error: "Session not found" };
  }

  const result = buildPartnerSelectionDraft(toSnapshot(session), session.role, partnerId);
  if (result.accepted.length === 0) {
    return {
      ok: false,
      statusCode: 403,
      error: result.rejected[0]?.reason ?? "Partner selection not permitted",
    };
  }

  session.proposals.push(...result.accepted);
  return { ok: true, statusCode: 201, state: toSnapshot(session), proposals: result.accepted };
}

export function appendAuditAmendment(
  sessionId: string,
  reason: string,
  relatedAuditId?: string
): {
  ok: boolean;
  statusCode: number;
  error?: string;
  state?: SessionSnapshot;
  amendment?: AuditEntry;
} {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, statusCode: 404, error: "Session not found" };
  }

  if (relatedAuditId) {
    const exists = session.auditLogs.some((a) => a.auditId === relatedAuditId);
    if (!exists) {
      return { ok: false, statusCode: 404, error: "Related audit entry not found" };
    }
  }

  const actor =
    session.role === UserRole.CAFETERIA_MANAGER
      ? session.school.cafeteriaManager
      : session.role === UserRole.SCHOOL_ADMINISTRATOR
        ? session.school.schoolAdministrator
        : session.role;

  const amendment: AuditEntry = {
    auditId: `adt-amd-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    actor: String(actor),
    actorType: "HUMAN",
    action: "AUDIT AMENDMENT (non-destructive)",
    role: session.role,
    proposalId: relatedAuditId,
    before: null,
    after: { amendmentType: "EXPLANATORY_CORRECTION", relatedAuditId: relatedAuditId ?? null },
    reason,
    permissionDecision: "GRANTED",
    approvalDecision: "BYPASSED",
    executionResult: "AMENDMENT_APPENDED",
    reversibility: false,
  };

  session.auditLogs.unshift(amendment);
  return { ok: true, statusCode: 201, state: toSnapshot(session), amendment };
}

/** Test helper — expire a pending proposal immediately. */
export function expireProposalForTest(sessionId: string, proposalId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  const proposal = session.proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) return false;
  proposal.expiresAt = new Date(Date.now() - 60_000).toISOString();
  return true;
}

function applyProposalMutation(session: LabSession, proposal: SanitizedProposal): void {
  switch (proposal.actionType) {
    case "ATTENDANCE_UPDATE": {
      const patch = attendanceExecutionPatch(proposal.after);
      session.forecast.expectedAttendance = patch.expectedAttendance;
      session.forecast.recommendedPreparation = patch.recommendedPreparation;
      session.forecast.estimatedPreventableSurplus = patch.estimatedPreventableSurplus;
      const predictedMin = Math.round(patch.expectedAttendance - 31);
      const predictedMax = Math.round(patch.expectedAttendance + 29);
      session.forecast.predictionInterval = {
        min: predictedMin,
        max: predictedMax,
        intervalType: "80% prediction interval",
      };
      break;
    }
    case "PREPARATION_OVERRIDE":
      session.school.currentPreparationPlan = proposal.after.proposedQuantity as number;
      break;
    case "SURPLUS_ALERT":
      session.alertStatus = "SENT_PROVISIONAL";
      break;
    case "PARTNER_SELECTION":
      session.selectedPartnerId = proposal.after.selectedPartnerId as string;
      break;
    case "ALERT_CANCELLATION":
      session.alertStatus = "NONE";
      break;
  }
}

function appendFailedExecutionAudit(
  session: LabSession,
  proposal: SanitizedProposal,
  reason: string
): void {
  const alreadyRecorded = session.auditLogs.some(
    (a) =>
      a.proposalId === proposal.proposalId &&
      a.executionResult === "FAILED" &&
      a.reason === reason
  );
  if (alreadyRecorded) return;

  const actor =
    session.role === UserRole.CAFETERIA_MANAGER
      ? session.school.cafeteriaManager
      : session.role === UserRole.SCHOOL_ADMINISTRATOR
        ? session.school.schoolAdministrator
        : session.role;

  session.auditLogs.unshift({
    auditId: `adt-fail-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    actor: String(actor),
    actorType: "HUMAN",
    action: `Failed proposal execution: ${proposal.title}`,
    role: session.role,
    proposalId: proposal.proposalId,
    before: proposal.before,
    after: null,
    reason,
    permissionDecision: "DENIED",
    approvalDecision: "APPROVED_BY_USER",
    executionResult: "FAILED",
    reversibility: false,
  });
}

function shouldAuditFailedExecution(error?: string): boolean {
  return (
    error === COPILOT_PROPOSALS_DISABLED ||
    error === PARTNER_PREREQUISITES_INCOMPLETE ||
    error === PARTNER_SELECTION_PROPOSAL_STALE
  );
}

function toSnapshot(session: LabSession): SessionSnapshot {
  return {
    sessionId: session.sessionId,
    role: session.role,
    school: structuredClone(session.school),
    forecast: structuredClone(session.forecast),
    partners: structuredClone(session.partners),
    auditLogs: structuredClone(session.auditLogs),
    proposals: structuredClone(session.proposals),
    selectedPartnerId: session.selectedPartnerId,
    alertStatus: session.alertStatus,
    proposalsPermitted: session.proposalsPermitted,
    partnerPrerequisites: structuredClone(session.partnerPrerequisites),
  };
}

/** Test helper — clears all sessions. */
export function clearAllSessions(): void {
  sessions.clear();
}

/** Ensures forecast date matches canonical demo on session creation. */
export function ensureCanonicalForecastDate(forecast: SchoolForecast): void {
  forecast.date = FOCUS_DATE;
}

ensureCanonicalForecastDate(INITIAL_FORECAST);
