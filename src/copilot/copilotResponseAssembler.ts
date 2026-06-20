import { z } from "zod";
import { AnswerTypeSchema, EvidenceItemSchema, ProvenanceItemSchema, TransparencyUncertaintySchema } from "./schemas";
import type { ToolCallDetails } from "../types";
import { StructuredCopilotResponseSchema, type SanitizedProposal } from "./schemas";
import { getSession } from "./sessionStore";

export const CopilotExplanationDraftSchema = z.object({
  answer: z.string(),
  answerType: AnswerTypeSchema,
  evidence: z.array(EvidenceItemSchema).default([]),
  provenance: z.array(ProvenanceItemSchema).default([]),
  uncertainty: TransparencyUncertaintySchema,
  limitations: z.array(z.string()).default([]),
});

export type CopilotExplanationDraft = z.infer<typeof CopilotExplanationDraftSchema>;

export interface AssembleCopilotInput {
  sessionId: string;
  explanation: CopilotExplanationDraft;
  toolCalls: ToolCallDetails[];
  createdProposalIds: string[];
  extraLimitations?: string[];
  extraProvenance?: Array<{ source: string; status: string }>;
}

export function assembleCopilotResponse(input: AssembleCopilotInput) {
  const session = getSession(input.sessionId);
  if (!session) {
    return { error: "Session not found" } as const;
  }

  const proposals: SanitizedProposal[] = session.proposals.filter((p) =>
    input.createdProposalIds.includes(p.proposalId)
  );

  const limitations = [
    ...input.explanation.limitations,
    ...(input.extraLimitations ?? []),
  ];
  const provenance = [...input.explanation.provenance, ...(input.extraProvenance ?? [])];

  const response = StructuredCopilotResponseSchema.parse({
    answer: input.explanation.answer,
    answerType: input.explanation.answerType,
    evidence: input.explanation.evidence,
    provenance,
    uncertainty: input.explanation.uncertainty,
    limitations,
    toolCalls: input.toolCalls,
    proposedActions: proposals,
    requiresHumanApproval: proposals.some((p) => p.status === "PENDING_APPROVAL"),
  });

  return {
    response,
    rejectedProposals: [] as Array<{ reason: string; actionType?: string }>,
    newProposals: proposals,
  };
}
