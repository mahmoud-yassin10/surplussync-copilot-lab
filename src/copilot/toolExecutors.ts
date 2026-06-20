import { UserRole } from "../types";
import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  FOCUS_DATE,
} from "./demoConstants";
import { ForecastProvider, ForecastProviderError } from "./forecastProvider";
import { checkPermission } from "./permissionPolicy";
import { sanitizeProposals } from "./proposalValidator";
import {
  GetAttendanceForecastArgsSchema,
  ListRecoveryPartnersArgsSchema,
  ProposeAlertCancellationArgsSchema,
  ProposeAttendanceUpdateArgsSchema,
  ProposePartnerSelectionArgsSchema,
  ProposePreparationOverrideArgsSchema,
  ProposeSurplusAlertArgsSchema,
  ReadAuditStorylineArgsSchema,
  ReadOperationalStateArgsSchema,
  SimulateAttendanceCorrectionArgsSchema,
} from "./toolArgumentSchemas";
import { AllowedToolName } from "./toolRegistry";
import type { ForecastProvenance } from "./mlSchemas";
import { addSanitizedProposals, getSession, SessionSnapshot } from "./sessionStore";
import type { SanitizedProposal } from "./schemas";
import type { ToolCallDetails } from "../types";

export interface ToolExecutionContext {
  sessionId: string;
  role: UserRole;
  forecastProvider: ForecastProvider;
  createdProposalIds: string[];
  provenanceNotes: Array<{ source: string; status: string }>;
  limitations: string[];
}

export interface ToolExecutionResult {
  ok: boolean;
  output: Record<string, unknown>;
  error?: string;
  toolCall: ToolCallDetails;
  proposalsCreated?: SanitizedProposal[];
}

function snapshot(sessionId: string): SessionSnapshot | null {
  const session = getSession(sessionId);
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    role: session.role,
    school: session.school,
    forecast: session.forecast,
    partners: session.partners,
    auditLogs: session.auditLogs,
    proposals: session.proposals,
    selectedPartnerId: session.selectedPartnerId,
    alertStatus: session.alertStatus,
    proposalsPermitted: session.proposalsPermitted,
    partnerPrerequisites: session.partnerPrerequisites,
  };
}

function permissionForTool(toolName: AllowedToolName, role: UserRole, args?: Record<string, unknown>) {
  const map: Record<AllowedToolName, string> = {
    read_operational_state: "get_forecast",
    get_attendance_forecast: "get_forecast",
    simulate_attendance_correction: "simulate_attendance",
    list_recovery_partners: "list_recovery_partners",
    read_audit_storyline: "get_audit_history",
    propose_attendance_update: "propose_attendance_update",
    propose_preparation_override: "propose_preparation_override",
    propose_surplus_alert: "draft_surplus_alert",
    propose_partner_selection: "propose_partner_selection",
    propose_alert_cancellation: "propose_alert_cancellation",
  };
  return checkPermission(role, map[toolName], args);
}

function recordProvenance(ctx: ToolExecutionContext, provenance: ForecastProvenance): void {
  ctx.provenanceNotes.push({
    source:
      provenance.source === "ml"
        ? "SurplusSync ML Service"
        : "SurplusSync Canonical Fallback",
    status: provenance.fallbackUsed ? "SYNTHETIC" : "PREDICTED",
  });
  if (provenance.fallbackUsed) {
    ctx.limitations.push(
      "Forecast numbers were served from local canonical fallback because the ML service was unavailable."
    );
  }
}

function parseArgs<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, args: unknown):
  | { ok: true; data: T }
  | { ok: false; error: string } {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: "Malformed tool arguments" };
  return { ok: true, data: parsed.data as T };
}

export async function executeTool(
  toolName: AllowedToolName,
  rawArgs: unknown,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const perm = permissionForTool(toolName, ctx.role, rawArgs as Record<string, unknown>);
  const baseCall: Omit<ToolCallDetails, "returnedValue"> = {
    toolName,
    arguments: (rawArgs as Record<string, unknown>) ?? {},
    permissionPassed: perm.granted,
    permissionExplanation: perm.explanation,
    mutatedState: false,
    requiresApproval: toolName.startsWith("propose_"),
  };

  if (!perm.granted) {
    return {
      ok: false,
      output: { error: perm.explanation },
      error: perm.explanation,
      toolCall: { ...baseCall, returnedValue: { error: perm.explanation } },
    };
  }

  const session = snapshot(ctx.sessionId);
  if (!session) {
    return {
      ok: false,
      output: { error: "Session not found" },
      error: "Session not found",
      toolCall: { ...baseCall, returnedValue: { error: "Session not found" } },
    };
  }

  try {
    switch (toolName) {
      case "read_operational_state": {
        parseArgs(ReadOperationalStateArgsSchema, rawArgs);
        const output = {
          schoolId: "lincoln-heights",
          mlSchoolId: "lhphs",
          focusDate: FOCUS_DATE,
          role: session.role,
          currentPreparationPlan: session.school.currentPreparationPlan,
          expectedAttendance: session.forecast.expectedAttendance,
          recommendedPreparation: session.forecast.recommendedPreparation,
          selectedPartnerId: session.selectedPartnerId,
          alertStatus: session.alertStatus,
          pendingProposals: session.proposals.filter((p) => p.status === "PENDING_APPROVAL").length,
        };
        return {
          ok: true,
          output,
          toolCall: { ...baseCall, returnedValue: output },
        };
      }

      case "get_attendance_forecast": {
        const args = parseArgs(GetAttendanceForecastArgsSchema, rawArgs);
        if (args.ok === false) return malformed(baseCall, args.error);
        const result = await ctx.forecastProvider.getAttendanceForecast({
          schoolId: args.data.schoolId,
          date: args.data.date,
        });
        recordProvenance(ctx, result.provenance);
        const output = {
          ...result.forecast,
          provenance: result.provenance,
        };
        return { ok: true, output, toolCall: { ...baseCall, returnedValue: output } };
      }

      case "simulate_attendance_correction": {
        const args = parseArgs(SimulateAttendanceCorrectionArgsSchema, rawArgs);
        if (args.ok === false) return malformed(baseCall, args.error);
        const result = await ctx.forecastProvider.simulateAttendanceCorrection({
          schoolId: args.data.schoolId,
          date: args.data.date,
        });
        recordProvenance(ctx, result.provenance);
        const output = {
          scenario: "trip_cancelled",
          expectedAttendance: result.forecast.expectedAttendance,
          intervalLow: result.forecast.intervalLow,
          intervalHigh: result.forecast.intervalHigh,
          recommendedPrep: result.forecast.recommendedPrep,
          preventableSurplus: result.forecast.preventableSurplus,
          shortageProb: result.forecast.shortageProb,
          risk: result.forecast.risk,
          provenance: result.provenance,
          sessionMutated: false,
        };
        return { ok: true, output, toolCall: { ...baseCall, returnedValue: output } };
      }

      case "list_recovery_partners": {
        parseArgs(ListRecoveryPartnersArgsSchema, rawArgs);
        const output = {
          partners: session.partners.map((p) => ({
            id: p.id,
            name: p.name,
            capacityMeals: p.capacityMeals,
            isAvailable: p.isAvailable,
            distanceMiles: p.distanceMiles,
          })),
        };
        return { ok: true, output, toolCall: { ...baseCall, returnedValue: output } };
      }

      case "read_audit_storyline": {
        const args = parseArgs(ReadAuditStorylineArgsSchema, rawArgs);
        if (args.ok === false) return malformed(baseCall, args.error);
        const limit = args.data.limit ?? 20;
        const output = {
          entries: session.auditLogs.slice(0, limit),
          appendOnly: true,
        };
        return { ok: true, output, toolCall: { ...baseCall, returnedValue: output } };
      }

      case "propose_attendance_update": {
        const args = parseArgs(ProposeAttendanceUpdateArgsSchema, rawArgs);
        if (args.ok === false) return malformed(baseCall, args.error);
        const { accepted, rejected } = sanitizeProposals(
          [
            {
              actionType: "ATTENDANCE_UPDATE",
              title: "Correct Expected Attendance Count (Trip Cancelled)",
              summary: `Revise ${FOCUS_DATE} expected attendance from ${BASELINE_ATTENDANCE} to ${CORRECTED_ATTENDANCE}.`,
              reason: args.data.reason,
              before: {
                expectedAttendance: session.forecast.expectedAttendance,
                recommendedPreparation: session.forecast.recommendedPreparation,
              },
              after: {
                expectedAttendance: CORRECTED_ATTENDANCE,
                recommendedPreparation: CORRECTED_RECOMMENDED_PREP,
              },
            },
          ],
          session,
          ctx.role
        );
        if (accepted.length === 0) {
          return proposalRejected(baseCall, rejected[0]?.reason ?? "Proposal rejected");
        }
        addSanitizedProposals(ctx.sessionId, accepted);
        ctx.createdProposalIds.push(...accepted.map((p) => p.proposalId));
        return {
          ok: true,
          output: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          proposalsCreated: accepted,
          toolCall: {
            ...baseCall,
            requiresApproval: true,
            returnedValue: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          },
        };
      }

      case "propose_preparation_override": {
        const args = parseArgs(ProposePreparationOverrideArgsSchema, rawArgs);
        if (args.ok === false) return malformed(baseCall, args.error);
        const { accepted, rejected } = sanitizeProposals(
          [
            {
              actionType: "PREPARATION_OVERRIDE",
              title: "Propose Preparation Plan Override",
              summary: `Change preparation plan to ${args.data.proposedQuantity} meals.`,
              reason: args.data.reason,
              before: { currentPreparationPlan: session.school.currentPreparationPlan },
              after: { proposedQuantity: args.data.proposedQuantity },
            },
          ],
          session,
          ctx.role
        );
        if (accepted.length === 0) {
          return proposalRejected(baseCall, rejected[0]?.reason ?? "Proposal rejected");
        }
        addSanitizedProposals(ctx.sessionId, accepted);
        ctx.createdProposalIds.push(...accepted.map((p) => p.proposalId));
        return {
          ok: true,
          output: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          proposalsCreated: accepted,
          toolCall: {
            ...baseCall,
            requiresApproval: true,
            returnedValue: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          },
        };
      }

      case "propose_surplus_alert": {
        const args = parseArgs(ProposeSurplusAlertArgsSchema, rawArgs);
        if (args.ok === false) return malformed(baseCall, args.error);
        const { accepted, rejected } = sanitizeProposals(
          [
            {
              actionType: "SURPLUS_ALERT",
              title: "Draft Potential Surplus Notification",
              summary: "Broadcast provisional surplus alert to recovery partners.",
              reason: args.data.reason,
              before: { alertStatus: session.alertStatus },
              after: {
                alertStatus: "SENT_PROVISIONAL",
                recipients: ["metro-food-bank", "harbor-shelter"],
              },
            },
          ],
          session,
          ctx.role
        );
        if (accepted.length === 0) {
          return proposalRejected(baseCall, rejected[0]?.reason ?? "Proposal rejected");
        }
        addSanitizedProposals(ctx.sessionId, accepted);
        ctx.createdProposalIds.push(...accepted.map((p) => p.proposalId));
        return {
          ok: true,
          output: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          proposalsCreated: accepted,
          toolCall: {
            ...baseCall,
            requiresApproval: true,
            returnedValue: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          },
        };
      }

      case "propose_partner_selection": {
        const args = parseArgs(ProposePartnerSelectionArgsSchema, rawArgs);
        if (args.ok === false) return malformed(baseCall, args.error);
        const partner = session.partners.find((p) => p.id === args.data.partnerId);
        const { accepted, rejected } = sanitizeProposals(
          [
            {
              actionType: "PARTNER_SELECTION",
              title: `Propose Recovery Route Override to ${partner?.name ?? args.data.partnerId}`,
              summary: `Redirect surplus route to ${partner?.name ?? args.data.partnerId} for ${FOCUS_DATE}.`,
              reason: args.data.reason,
              before: { selectedPartnerId: session.selectedPartnerId },
              after: { selectedPartnerId: args.data.partnerId },
            },
          ],
          session,
          ctx.role
        );
        if (accepted.length === 0) {
          return proposalRejected(baseCall, rejected[0]?.reason ?? "Proposal rejected");
        }
        addSanitizedProposals(ctx.sessionId, accepted);
        ctx.createdProposalIds.push(...accepted.map((p) => p.proposalId));
        return {
          ok: true,
          output: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          proposalsCreated: accepted,
          toolCall: {
            ...baseCall,
            requiresApproval: true,
            returnedValue: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          },
        };
      }

      case "propose_alert_cancellation": {
        const args = parseArgs(ProposeAlertCancellationArgsSchema, rawArgs);
        if (args.ok === false) return malformed(baseCall, args.error);
        const { accepted, rejected } = sanitizeProposals(
          [
            {
              actionType: "ALERT_CANCELLATION",
              title: "Propose Surplus Alert Cancellation",
              summary: "Cancel the active provisional surplus alert.",
              reason: args.data.reason,
              before: { alertStatus: session.alertStatus },
              after: { alertStatus: "NONE" },
            },
          ],
          session,
          ctx.role
        );
        if (accepted.length === 0) {
          return proposalRejected(baseCall, rejected[0]?.reason ?? "Proposal rejected");
        }
        addSanitizedProposals(ctx.sessionId, accepted);
        ctx.createdProposalIds.push(...accepted.map((p) => p.proposalId));
        return {
          ok: true,
          output: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          proposalsCreated: accepted,
          toolCall: {
            ...baseCall,
            requiresApproval: true,
            returnedValue: { status: "PENDING_APPROVAL", proposalIds: accepted.map((p) => p.proposalId) },
          },
        };
      }

      default:
        return malformed(baseCall, "Unknown tool");
    }
  } catch (error) {
    if (error instanceof ForecastProviderError && error.code === "UNSUPPORTED_DEMO_SCOPE") {
      return {
        ok: false,
        output: { error: error.message },
        error: error.message,
        toolCall: { ...baseCall, returnedValue: { error: error.message } },
      };
    }
    throw error;
  }
}

function malformed(
  baseCall: Omit<ToolCallDetails, "returnedValue">,
  error: string
): ToolExecutionResult {
  return {
    ok: false,
    output: { error },
    error,
    toolCall: { ...baseCall, permissionPassed: false, permissionExplanation: error, returnedValue: { error } },
  };
}

function proposalRejected(
  baseCall: Omit<ToolCallDetails, "returnedValue">,
  error: string
): ToolExecutionResult {
  return {
    ok: false,
    output: { error },
    error,
    toolCall: { ...baseCall, returnedValue: { error } },
  };
}
