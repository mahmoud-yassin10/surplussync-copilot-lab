import { randomUUID } from "crypto";
import { UserRole } from "../types";
import {
  ActionType,
  canApproveAction,
  canProposeAction,
  deriveRequiredApprovals,
  isActionType,
} from "./actionPolicy";
import { computeExpectedConsequences } from "./computeConsequences";
import {
  BASELINE_ATTENDANCE,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  FOCUS_DATE,
  PREVENTABLE_SURPLUS_BASELINE,
  PREVENTABLE_SURPLUS_CORRECTED,
  PROPOSAL_TTL_MS,
  SAFETY_FLOOR,
} from "./demoConstants";
import {
  AIActionProposalSchema,
  AlertCancellationAfterSchema,
  AttendanceUpdateAfterSchema,
  PartnerSelectionAfterSchema,
  PreparationOverrideAfterSchema,
  RawProposedActionSchema,
  SanitizedProposal,
  SurplusAlertAfterSchema,
  UserRoleSchema,
} from "./schemas";
import type { SessionSnapshot } from "./sessionStore";

export interface ProposalValidationResult {
  accepted: SanitizedProposal[];
  rejected: Array<{ reason: string; actionType?: string }>;
}

export interface PolicyCheck {
  policy: string;
  passed: boolean;
  explanation: string;
}

export const PARTNER_PREREQUISITES_INCOMPLETE = "PARTNER_PREREQUISITES_INCOMPLETE";
export const PARTNER_SELECTION_PROPOSAL_STALE = "PARTNER_SELECTION_PROPOSAL_STALE";
export const COPILOT_PROPOSALS_DISABLED = "COPILOT_PROPOSALS_DISABLED";

function evaluatePolicyChecks(
  actionType: ActionType,
  after: Record<string, unknown>,
  session: SessionSnapshot
): PolicyCheck[] {
  const checks: PolicyCheck[] = [];

  switch (actionType) {
    case "PREPARATION_OVERRIDE": {
      const qty = after.proposedQuantity as number;
      checks.push({
        policy: "Safety Floor",
        passed: qty >= SAFETY_FLOOR,
        explanation:
          qty >= SAFETY_FLOOR
            ? `Proposed quantity ${qty} meets the ${SAFETY_FLOOR}-meal safety floor.`
            : `Proposed quantity ${qty} violates the ${SAFETY_FLOOR}-meal safety floor.`,
      });
      break;
    }
    case "ATTENDANCE_UPDATE": {
      const att = after.expectedAttendance as number;
      checks.push({
        policy: "Enrollment Bound Check",
        passed: att >= SAFETY_FLOOR && att <= session.school.mealEligibleStudents,
        explanation: `${att} falls within eligible enrollment bounds (${SAFETY_FLOOR}–${session.school.mealEligibleStudents}).`,
      });
      break;
    }
    case "PARTNER_SELECTION": {
      const partnerId = after.selectedPartnerId as string;
      const partner = session.partners.find((p) => p.id === partnerId);
      const prereq = session.partnerPrerequisites;
      checks.push({
        policy: "Partner Availability",
        passed: !!partner?.isAvailable,
        explanation: partner?.isAvailable
          ? `Partner ${partner.name} is available for routing.`
          : `Partner ${partnerId} is unavailable or unknown.`,
      });
      checks.push({
        policy: "Surplus Confirmed",
        passed: prereq.surplusConfirmed && typeof prereq.surplusMeals === "number" && prereq.surplusMeals > 0,
        explanation:
          prereq.surplusConfirmed && typeof prereq.surplusMeals === "number" && prereq.surplusMeals > 0
            ? `Confirmed surplus is ${prereq.surplusMeals} meals.`
            : "Surplus must be confirmed before partner selection.",
      });
      checks.push({
        policy: "Food Safety Checklist",
        passed: prereq.foodSafetyChecklistComplete,
        explanation: prereq.foodSafetyChecklistComplete
          ? "Required food-safety checklist is complete."
          : "Required food-safety checklist is incomplete.",
      });
      checks.push({
        policy: "Recovery Window",
        passed: prereq.recoveryWindowValid,
        explanation: prereq.recoveryWindowValid
          ? "Recovery window is still valid."
          : "Recovery window is missing or no longer valid.",
      });
      checks.push({
        policy: "Proposal Mode",
        passed: prereq.proposalsPermitted,
        explanation: prereq.proposalsPermitted
          ? "Current session mode permits executable proposals."
          : "Current session mode blocks executable proposals.",
      });
      checks.push({
        policy: "Partner Capacity",
        passed:
          !!partner &&
          typeof prereq.surplusMeals === "number" &&
          prereq.surplusMeals > 0 &&
          partner.capacityMeals >= prereq.surplusMeals,
        explanation:
          partner && typeof prereq.surplusMeals === "number" && prereq.surplusMeals > 0
            ? `${partner.name} capacity is ${partner.capacityMeals} meals for ${prereq.surplusMeals} confirmed surplus meals.`
            : "Partner capacity cannot be evaluated until surplus is confirmed.",
      });
      break;
    }
    case "SURPLUS_ALERT":
      checks.push({
        policy: "Pre-alert Verification",
        passed: true,
        explanation: "Alert carries mandatory unconfirmed disclaimer.",
      });
      break;
    case "ALERT_CANCELLATION":
      checks.push({
        policy: "Active Alert Check",
        passed: session.alertStatus !== "NONE",
        explanation:
          session.alertStatus !== "NONE"
            ? "An active or draft alert exists and may be cancelled."
            : "No active alert to cancel.",
      });
      break;
  }

  return checks;
}

function getExpectedBeforeState(
  actionType: ActionType,
  session: SessionSnapshot
): Record<string, unknown> {
  switch (actionType) {
    case "ATTENDANCE_UPDATE":
      return {
        expectedAttendance: session.forecast.expectedAttendance,
        recommendedPreparation: session.forecast.recommendedPreparation,
      };
    case "PREPARATION_OVERRIDE":
      return { currentPreparationPlan: session.school.currentPreparationPlan };
    case "PARTNER_SELECTION":
      return {
        selectedPartnerId: session.selectedPartnerId,
        partnerPrerequisitesRevision: session.partnerPrerequisites.revision,
        partnerPrerequisitesResetVersion: session.partnerPrerequisites.resetVersion,
        partnerPrerequisitesCancellationVersion: session.partnerPrerequisites.cancellationVersion,
      };
    case "SURPLUS_ALERT":
      return { alertStatus: session.alertStatus };
    case "ALERT_CANCELLATION":
      return { alertStatus: session.alertStatus };
    default:
      return {};
  }
}

function normalizeAfterPayload(
  actionType: ActionType,
  after: Record<string, unknown>
): Record<string, unknown> | null {
  try {
    switch (actionType) {
      case "ATTENDANCE_UPDATE":
        return AttendanceUpdateAfterSchema.parse(after);
      case "PREPARATION_OVERRIDE":
        return PreparationOverrideAfterSchema.parse(after);
      case "PARTNER_SELECTION":
        return PartnerSelectionAfterSchema.parse(after);
      case "SURPLUS_ALERT":
        return SurplusAlertAfterSchema.parse(after);
      case "ALERT_CANCELLATION":
        return AlertCancellationAfterSchema.parse(after);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function allPolicyChecksPassed(checks: PolicyCheck[]): boolean {
  return checks.length > 0 && checks.every((c) => c.passed);
}

export function sanitizeProposals(
  rawProposals: unknown[],
  session: SessionSnapshot,
  requestingRole: UserRole
): ProposalValidationResult {
  const accepted: SanitizedProposal[] = [];
  const rejected: Array<{ reason: string; actionType?: string }> = [];

  for (const raw of rawProposals) {
    const parsed = RawProposedActionSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ reason: "Malformed proposal structure", actionType: undefined });
      continue;
    }

    const draft = parsed.data;
    if (!isActionType(draft.actionType)) {
      rejected.push({ reason: `Unknown action type: ${draft.actionType}`, actionType: draft.actionType });
      continue;
    }

    const actionType = draft.actionType;

    if (!session.proposalsPermitted) {
      rejected.push({ reason: COPILOT_PROPOSALS_DISABLED, actionType });
      continue;
    }

    if (!canProposeAction(requestingRole, actionType)) {
      rejected.push({
        reason: `Role ${requestingRole} cannot propose ${actionType}`,
        actionType,
      });
      continue;
    }

    const normalizedAfter = normalizeAfterPayload(actionType, draft.after);
    if (!normalizedAfter) {
      rejected.push({ reason: `Invalid after payload for ${actionType}`, actionType });
      continue;
    }

    const expectedBefore = getExpectedBeforeState(actionType, session);
    const policyChecks = evaluatePolicyChecks(actionType, normalizedAfter, session);

    if (!allPolicyChecksPassed(policyChecks)) {
      rejected.push({
        reason:
          actionType === "PARTNER_SELECTION"
            ? PARTNER_PREREQUISITES_INCOMPLETE
            : `Policy check failed for ${actionType}`,
        actionType,
      });
      continue;
    }

    const beforeMatches = Object.entries(expectedBefore).every(
      ([key, value]) => draft.before?.[key] === undefined || draft.before[key] === value
    );
    if (!beforeMatches) {
      rejected.push({
        reason:
          actionType === "PARTNER_SELECTION"
            ? "PARTNER_SELECTION_PROPOSAL_STALE"
            : `Stale before-state for ${actionType}`,
        actionType,
      });
      continue;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MS);

    const proposal: SanitizedProposal = {
      proposalId: randomUUID(),
      actionType,
      title: draft.title,
      summary: draft.summary,
      reason: draft.reason,
      requestedByRole: requestingRole,
      affectedEntities: draft.affectedEntities ?? [],
      before: expectedBefore,
      after: normalizedAfter,
      expectedConsequences: computeExpectedConsequences(actionType, expectedBefore, normalizedAfter),
      risks: draft.risks ?? [],
      policyChecks,
      requiredApprovals: deriveRequiredApprovals(actionType),
      reversible: draft.reversible ?? true,
      status: "PENDING_APPROVAL",
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    const validated = AIActionProposalSchema.safeParse(proposal);
    if (!validated.success) {
      rejected.push({ reason: "Sanitized proposal failed schema validation", actionType });
      continue;
    }

    accepted.push(validated.data);
  }

  return { accepted, rejected };
}

export interface ExecutionValidationResult {
  ok: boolean;
  statusCode: number;
  error?: string;
}

export function validateProposalForExecution(
  proposal: SanitizedProposal,
  session: SessionSnapshot,
  approvingRole: UserRole
): ExecutionValidationResult {
  if (proposal.status === "EXECUTED") {
    return { ok: false, statusCode: 409, error: "Proposal already executed" };
  }
  if (proposal.status === "REJECTED") {
    return { ok: false, statusCode: 409, error: "Proposal was rejected" };
  }
  if (proposal.status !== "PENDING_APPROVAL") {
    return { ok: false, statusCode: 409, error: `Proposal status is ${proposal.status}` };
  }

  const expiresAt = new Date(proposal.expiresAt).getTime();
  if (Date.now() > expiresAt) {
    return { ok: false, statusCode: 410, error: "Proposal expired" };
  }

  if (!canApproveAction(approvingRole, proposal.actionType)) {
    return {
      ok: false,
      statusCode: 403,
      error: `Role ${approvingRole} cannot approve ${proposal.actionType}`,
    };
  }

  if (!session.proposalsPermitted) {
    return { ok: false, statusCode: 423, error: COPILOT_PROPOSALS_DISABLED };
  }

  const expectedBefore = getExpectedBeforeState(proposal.actionType, session);
  const isStale = Object.entries(expectedBefore).some(
    ([key, value]) => proposal.before[key] !== value
  );
  if (isStale) {
    return {
      ok: false,
      statusCode: 409,
      error:
        proposal.actionType === "PARTNER_SELECTION"
          ? "PARTNER_SELECTION_PROPOSAL_STALE"
          : "Proposal before-state no longer matches session",
    };
  }

  const policyChecks = evaluatePolicyChecks(proposal.actionType, proposal.after, session);
  if (!allPolicyChecksPassed(policyChecks)) {
    return {
      ok: false,
      statusCode: 422,
      error:
        proposal.actionType === "PARTNER_SELECTION"
          ? PARTNER_PREREQUISITES_INCOMPLETE
          : "Policy checks failed at execution time",
    };
  }

  if (proposal.actionType === "PARTNER_SELECTION") {
    const prereqStillCurrent =
      proposal.before.partnerPrerequisitesRevision === session.partnerPrerequisites.revision &&
      proposal.before.partnerPrerequisitesResetVersion === session.partnerPrerequisites.resetVersion &&
      proposal.before.partnerPrerequisitesCancellationVersion ===
        session.partnerPrerequisites.cancellationVersion;
    if (!prereqStillCurrent) {
      return { ok: false, statusCode: 409, error: "PARTNER_SELECTION_PROPOSAL_STALE" };
    }
  }

  return { ok: true, statusCode: 200 };
}

export function buildPartnerSelectionDraft(
  session: SessionSnapshot,
  requestingRole: UserRole,
  partnerId: string
): ProposalValidationResult {
  const partner = session.partners.find((p) => p.id === partnerId);
  if (!partner) {
    return { accepted: [], rejected: [{ reason: `Unknown partner: ${partnerId}` }] };
  }

  return sanitizeProposals(
    [
      {
        actionType: "PARTNER_SELECTION",
        title: `Propose Recovery Route Override to ${partner.name}`,
        summary: `Redirect surplus distribution route to ${partner.name} for ${FOCUS_DATE}.`,
        reason: "Interactive route selection in laboratory UI.",
        after: { selectedPartnerId: partnerId },
        before: { selectedPartnerId: session.selectedPartnerId },
        affectedEntities: [
          { type: "PARTNER", id: partner.id, label: partner.name },
          {
            type: "PARTNER",
            id: session.selectedPartnerId,
            label:
              session.partners.find((p) => p.id === session.selectedPartnerId)?.name ??
              session.selectedPartnerId,
          },
        ],
        risks: partner.hasRefrigeratedVehicle
          ? ["Verify packaging rules at handoff."]
          : ["Partner has no refrigerated vehicle — hot/chilled items may be ineligible."],
      },
    ],
    session,
    requestingRole
  );
}

export function attendanceExecutionPatch(
  after: Record<string, unknown>
): { expectedAttendance: number; recommendedPreparation: number; estimatedPreventableSurplus: number } {
  const expectedAttendance = after.expectedAttendance as number;
  const recommendedPreparation =
    expectedAttendance === CORRECTED_ATTENDANCE
      ? CORRECTED_RECOMMENDED_PREP
      : BASELINE_ATTENDANCE === expectedAttendance
        ? 562
        : sessionRecommendedFallback(expectedAttendance);

  const estimatedPreventableSurplus =
    expectedAttendance === CORRECTED_ATTENDANCE
      ? PREVENTABLE_SURPLUS_CORRECTED
      : PREVENTABLE_SURPLUS_BASELINE;

  return { expectedAttendance, recommendedPreparation, estimatedPreventableSurplus };
}

function sessionRecommendedFallback(attendance: number): number {
  if (attendance >= CORRECTED_ATTENDANCE) return CORRECTED_RECOMMENDED_PREP;
  return 562;
}

export function parseUserRole(value: unknown): UserRole | null {
  const parsed = UserRoleSchema.safeParse(value);
  return parsed.success ? (parsed.data as UserRole) : null;
}
