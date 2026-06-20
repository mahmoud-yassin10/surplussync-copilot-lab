import { AuditEntry } from "../types";
import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  CURRENT_PLAN,
  PREVENTABLE_SURPLUS_BASELINE,
  PREVENTABLE_SURPLUS_CORRECTED,
} from "./demoConstants";
import type { ReconciliationRequest } from "./reconciliationSchemas";
import {
  DEFAULT_PARTNER_PREREQUISITES,
  getSession,
  getSessionState,
  type AlertStatus,
  type PartnerPrerequisites,
  type SessionSnapshot,
} from "./sessionStore";

export interface ReconcileResult {
  ok: boolean;
  statusCode: number;
  error?: string;
  state?: SessionSnapshot;
  changed?: boolean;
  idempotent?: boolean;
}

interface ReconcilableView {
  role: string;
  expectedAttendance: number;
  recommendedPreparation: number;
  currentPreparationPlan: number;
  alertStatus: AlertStatus;
  selectedPartnerId: string;
  proposalsPermitted: boolean;
  partnerPrerequisites: PartnerPrerequisites;
}

function snapshotReconcilable(session: NonNullable<ReturnType<typeof getSession>>): ReconcilableView {
  return {
    role: session.role,
    expectedAttendance: session.forecast.expectedAttendance,
    recommendedPreparation: session.forecast.recommendedPreparation,
    currentPreparationPlan: session.school.currentPreparationPlan,
    alertStatus: session.alertStatus,
    selectedPartnerId: session.selectedPartnerId,
    proposalsPermitted: session.proposalsPermitted,
    partnerPrerequisites: { ...session.partnerPrerequisites },
  };
}

function reconcilePartnerPrerequisites(
  current: PartnerPrerequisites,
  payload: ReconciliationRequest
): PartnerPrerequisites {
  const incoming = payload.operational.partnerPrerequisites;
  if (!incoming) {
    const next = {
      ...DEFAULT_PARTNER_PREREQUISITES,
      resetVersion: current.resetVersion,
      cancellationVersion: current.cancellationVersion,
      revision: current.revision,
    };
    const changed =
      current.surplusConfirmed !== next.surplusConfirmed ||
      current.surplusMeals !== next.surplusMeals ||
      current.foodSafetyChecklistComplete !== next.foodSafetyChecklistComplete ||
      current.recoveryWindowValid !== next.recoveryWindowValid ||
      current.proposalsPermitted !== next.proposalsPermitted;
    return changed ? { ...next, revision: current.revision + 1 } : next;
  }

  const next: PartnerPrerequisites = {
    surplusConfirmed: incoming.surplusConfirmed,
    surplusMeals: incoming.surplusMeals,
    foodSafetyChecklistComplete: incoming.foodSafetyChecklistComplete,
    recoveryWindowValid: incoming.recoveryWindowValid,
    proposalsPermitted: incoming.proposalsPermitted,
    resetVersion: incoming.resetVersion,
    cancellationVersion: incoming.cancellationVersion,
    revision: current.revision,
  };
  const changed =
    current.surplusConfirmed !== next.surplusConfirmed ||
    current.surplusMeals !== next.surplusMeals ||
    current.foodSafetyChecklistComplete !== next.foodSafetyChecklistComplete ||
    current.recoveryWindowValid !== next.recoveryWindowValid ||
    current.proposalsPermitted !== next.proposalsPermitted ||
    current.resetVersion !== next.resetVersion ||
    current.cancellationVersion !== next.cancellationVersion;

  return changed ? { ...next, revision: current.revision + 1 } : next;
}

function desiredReconcilable(
  session: NonNullable<ReturnType<typeof getSession>>,
  payload: ReconciliationRequest
): ReconcilableView {
  const alertStatus: AlertStatus = payload.operational.provisionalAlertsSent
    ? "SENT_PROVISIONAL"
    : "NONE";

  return {
    role: payload.role,
    expectedAttendance: payload.operational.expectedAttendance,
    recommendedPreparation: payload.operational.recommendedPreparation,
    currentPreparationPlan: payload.operational.currentPreparationPlan,
    alertStatus,
    selectedPartnerId:
      payload.operational.selectedPartnerId ?? session.selectedPartnerId,
    proposalsPermitted: payload.operational.proposalsPermitted ?? session.proposalsPermitted,
    partnerPrerequisites: reconcilePartnerPrerequisites(session.partnerPrerequisites, payload),
  };
}

function reconcilableEqual(a: ReconcilableView, b: ReconcilableView): boolean {
  return (
    a.role === b.role &&
    a.expectedAttendance === b.expectedAttendance &&
    a.recommendedPreparation === b.recommendedPreparation &&
    a.currentPreparationPlan === b.currentPreparationPlan &&
    a.alertStatus === b.alertStatus &&
    a.selectedPartnerId === b.selectedPartnerId &&
    a.proposalsPermitted === b.proposalsPermitted &&
    a.partnerPrerequisites.surplusConfirmed === b.partnerPrerequisites.surplusConfirmed &&
    a.partnerPrerequisites.surplusMeals === b.partnerPrerequisites.surplusMeals &&
    a.partnerPrerequisites.foodSafetyChecklistComplete ===
      b.partnerPrerequisites.foodSafetyChecklistComplete &&
    a.partnerPrerequisites.recoveryWindowValid === b.partnerPrerequisites.recoveryWindowValid &&
    a.partnerPrerequisites.proposalsPermitted === b.partnerPrerequisites.proposalsPermitted &&
    a.partnerPrerequisites.resetVersion === b.partnerPrerequisites.resetVersion &&
    a.partnerPrerequisites.cancellationVersion === b.partnerPrerequisites.cancellationVersion
  );
}

function applyReconcilable(
  session: NonNullable<ReturnType<typeof getSession>>,
  desired: ReconcilableView
): void {
  session.role = desired.role as typeof session.role;
  session.forecast.expectedAttendance = desired.expectedAttendance;
  session.forecast.recommendedPreparation = desired.recommendedPreparation;
  session.school.currentPreparationPlan = desired.currentPreparationPlan;
  session.alertStatus = desired.alertStatus;
  session.selectedPartnerId = desired.selectedPartnerId;
  session.proposalsPermitted = desired.proposalsPermitted;
  session.partnerPrerequisites = { ...desired.partnerPrerequisites };

  if (desired.expectedAttendance === CORRECTED_ATTENDANCE) {
    session.forecast.estimatedPreventableSurplus = PREVENTABLE_SURPLUS_CORRECTED;
    session.forecast.predictionInterval = {
      min: 512,
      max: 568,
      intervalType: "80% prediction interval",
    };
  } else if (desired.expectedAttendance === BASELINE_ATTENDANCE) {
    session.forecast.estimatedPreventableSurplus = PREVENTABLE_SURPLUS_BASELINE;
    session.forecast.predictionInterval = {
      min: 497,
      max: 557,
      intervalType: "80% prediction interval",
    };
  }

  if (desired.currentPreparationPlan === CURRENT_PLAN) {
    session.forecast.estimatedPreventableSurplus =
      desired.currentPreparationPlan - desired.recommendedPreparation;
  }
}

function buildReconciliationAudit(
  before: ReconcilableView,
  after: ReconcilableView,
  role: string
): AuditEntry {
  return {
    auditId: `adt-rec-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    actor: "SurplusSync Plus Integration",
    actorType: "SYSTEM",
    action: "MAIN_APP_STATE_RECONCILIATION",
    role: role as AuditEntry["role"],
    before: { ...before },
    after: { ...after },
    reason: "Canonical workflow snapshot reconciled from SurplusSync Plus.",
    permissionDecision: "GRANTED",
    approvalDecision: "BYPASSED",
    executionResult: "SUCCESS",
    reversibility: false,
  };
}

export function reconcileSessionFromMainApp(
  sessionId: string,
  payload: ReconciliationRequest
): ReconcileResult {
  const session = getSession(sessionId);
  if (!session) {
    return { ok: false, statusCode: 404, error: "Session not found" };
  }

  const before = snapshotReconcilable(session);
  const desired = desiredReconcilable(session, payload);

  if (reconcilableEqual(before, desired)) {
    return {
      ok: true,
      statusCode: 200,
      state: getSessionState(sessionId) ?? undefined,
      changed: false,
      idempotent: true,
    };
  }

  applyReconcilable(session, desired);
  session.auditLogs.unshift(buildReconciliationAudit(before, desired, payload.role));

  return {
    ok: true,
    statusCode: 200,
    state: getSessionState(sessionId) ?? undefined,
    changed: true,
    idempotent: false,
  };
}
