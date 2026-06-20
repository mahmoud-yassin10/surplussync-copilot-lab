import { UserRole } from "../types";
import { checkPermission } from "./permissionPolicy";
import {
  RawCopilotResponseSchema,
  StructuredCopilotResponseSchema,
  SanitizedProposal,
} from "./schemas";
import { sanitizeProposals } from "./proposalValidator";
import { addSanitizedProposals, getSession, SessionSnapshot } from "./sessionStore";

export interface ProcessedCopilotResponse {
  response: ReturnType<typeof StructuredCopilotResponseSchema.parse>;
  rejectedProposals: Array<{ reason: string; actionType?: string }>;
  newProposals: SanitizedProposal[];
}

/**
 * Normalizes mock or Gemini output through the same Zod schemas, permission checks,
 * and proposal sanitizer before anything reaches the client or session store.
 */
export function processCopilotResponse(
  raw: unknown,
  sessionId: string,
  requestingRole: UserRole
): ProcessedCopilotResponse | { error: string } {
  const session = getSession(sessionId);
  if (!session) {
    return { error: "Session not found" };
  }

  const parsed = RawCopilotResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Malformed model output" };
  }

  const draft = parsed.data;
  const snapshot: SessionSnapshot = {
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

  const toolCalls = draft.toolCalls.map((tc) => {
    const policy = checkPermission(requestingRole, tc.toolName, tc.arguments);
    const isProposeTool = tc.toolName.startsWith("propose_") || tc.toolName === "draft_surplus_alert";
    return {
      toolName: tc.toolName,
      arguments: tc.arguments ?? {},
      permissionPassed: policy.granted,
      permissionExplanation: policy.explanation,
      mutatedState: false,
      requiresApproval: isProposeTool && policy.granted,
    };
  });

  const { accepted, rejected } = sanitizeProposals(draft.proposedActions, snapshot, requestingRole);

  if (accepted.length > 0) {
    addSanitizedProposals(sessionId, accepted);
  }

  const limitations = [...draft.limitations];
  if (rejected.length > 0) {
    limitations.push(
      `Server rejected ${rejected.length} proposal(s): ${rejected.map((r) => r.reason).join("; ")}`
    );
  }

  const response = StructuredCopilotResponseSchema.parse({
    answer: draft.answer,
    answerType: draft.answerType,
    evidence: draft.evidence,
    provenance: draft.provenance,
    uncertainty: draft.uncertainty,
    limitations,
    toolCalls,
    proposedActions: accepted,
    requiresHumanApproval: accepted.length > 0,
  });

  return { response, rejectedProposals: rejected, newProposals: accepted };
}
