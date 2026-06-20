import { z } from "zod";
import { ACTION_TYPES } from "./actionPolicy";
import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  CURRENT_PLAN,
  SAFETY_FLOOR,
} from "./demoConstants";

export const UserRoleSchema = z.enum([
  "CAFETERIA_MANAGER",
  "SCHOOL_ADMINISTRATOR",
  "RECOVERY_PARTNER_COORDINATOR",
  "PLATFORM_ADMINISTRATOR",
]);

export const ActionTypeSchema = z.enum(ACTION_TYPES);

export const AnswerTypeSchema = z.enum([
  "FACT",
  "PREDICTION",
  "SIMULATION",
  "EXPLANATION",
  "REFUSAL",
]);

export const EvidenceItemSchema = z.object({
  label: z.string(),
  value: z.string(),
  sourceType: z.enum([
    "SCHOOL_RECORD",
    "MODEL_OUTPUT",
    "PARTNER_RECORD",
    "USER_INPUT",
    "SYNTHETIC_DATA",
  ]),
});

export const ProvenanceItemSchema = z.object({
  source: z.string(),
  status: z.enum(["OBSERVED", "DERIVED", "SYNTHETIC", "PREDICTED", "HUMAN_CORRECTED"]),
});

export const TransparencyUncertaintySchema = z.object({
  level: z.enum(["LOW", "MODERATE", "HIGH"]),
  explanation: z.string(),
});

export const ToolCallDetailsSchema = z.object({
  toolName: z.string(),
  arguments: z.record(z.unknown()),
  permissionPassed: z.boolean(),
  permissionExplanation: z.string(),
  mutatedState: z.boolean(),
  requiresApproval: z.boolean(),
  returnedValue: z.unknown().optional(),
});

/** Model/mock draft — security metadata is stripped and recomputed server-side. */
export const RawProposedActionSchema = z
  .object({
    proposalId: z.string().optional(),
    actionType: z.string(),
    title: z.string(),
    summary: z.string(),
    reason: z.string(),
    requestedByRole: z.string().optional(),
    affectedEntities: z
      .array(
        z.object({
          type: z.string(),
          id: z.string(),
          label: z.string(),
        })
      )
      .optional()
      .default([]),
    before: z.record(z.unknown()).optional().default({}),
    after: z.record(z.unknown()),
    risks: z.array(z.string()).optional().default([]),
    reversible: z.boolean().optional().default(true),
  })
  .passthrough();

export const PolicyCheckSchema = z.object({
  policy: z.string(),
  passed: z.boolean(),
  explanation: z.string(),
});

export const AIActionProposalSchema = z.object({
  proposalId: z.string().uuid(),
  actionType: ActionTypeSchema,
  title: z.string(),
  summary: z.string(),
  reason: z.string(),
  requestedByRole: UserRoleSchema,
  affectedEntities: z.array(
    z.object({
      type: z.string(),
      id: z.string(),
      label: z.string(),
    })
  ),
  before: z.record(z.unknown()),
  after: z.record(z.unknown()),
  expectedConsequences: z.array(z.string()),
  risks: z.array(z.string()),
  policyChecks: z.array(PolicyCheckSchema),
  requiredApprovals: z.array(UserRoleSchema),
  reversible: z.boolean(),
  status: z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED", "EXECUTED", "UNDONE"]),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const StructuredCopilotResponseSchema = z.object({
  answer: z.string(),
  answerType: AnswerTypeSchema,
  evidence: z.array(EvidenceItemSchema),
  provenance: z.array(ProvenanceItemSchema),
  uncertainty: TransparencyUncertaintySchema,
  limitations: z.array(z.string()),
  toolCalls: z.array(ToolCallDetailsSchema),
  proposedActions: z.array(AIActionProposalSchema),
  requiresHumanApproval: z.boolean(),
});

export const CopilotRequestSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1),
  forceMockMode: z.boolean().optional(),
});

export const CreateSessionRequestSchema = z.object({
  role: UserRoleSchema.optional(),
});

export const UpdateSessionRoleSchema = z.object({
  role: UserRoleSchema,
});

export const PartnerSelectionRequestSchema = z.object({
  partnerId: z.string().min(1),
});

export const AuditAmendmentRequestSchema = z.object({
  reason: z.string().min(1).max(2000),
  relatedAuditId: z.string().optional(),
});

export const AttendanceUpdateAfterSchema = z.object({
  expectedAttendance: z.number().int().min(SAFETY_FLOOR).max(760),
});

export const PreparationOverrideAfterSchema = z.object({
  proposedQuantity: z.number().int().min(SAFETY_FLOOR).max(900),
});

export const PartnerSelectionAfterSchema = z.object({
  selectedPartnerId: z.string().min(1),
});

export const SurplusAlertAfterSchema = z.object({
  alertStatus: z.literal("SENT_PROVISIONAL"),
  recipients: z.array(z.string()).optional(),
});

export const AlertCancellationAfterSchema = z.object({
  alertStatus: z.literal("NONE"),
});

export const RawCopilotResponseSchema = z.object({
  answer: z.string(),
  answerType: AnswerTypeSchema,
  evidence: z.array(EvidenceItemSchema).optional().default([]),
  provenance: z.array(ProvenanceItemSchema).optional().default([]),
  uncertainty: TransparencyUncertaintySchema.optional().default({
    level: "LOW",
    explanation: "Default uncertainty envelope applied during sanitization.",
  }),
  limitations: z.array(z.string()).optional().default([]),
  toolCalls: z
    .array(
      z
        .object({
          toolName: z.string(),
          arguments: z.record(z.unknown()).optional().default({}),
        })
        .passthrough()
    )
    .optional()
    .default([]),
  proposedActions: z.array(RawProposedActionSchema).optional().default([]),
  requiresHumanApproval: z.boolean().optional().default(false),
});

export const SessionStateSchema = z.object({
  sessionId: z.string().uuid(),
  role: UserRoleSchema,
  school: z.record(z.unknown()),
  forecast: z.record(z.unknown()),
  partners: z.array(z.record(z.unknown())),
  auditLogs: z.array(z.record(z.unknown())),
  proposals: z.array(AIActionProposalSchema),
  selectedPartnerId: z.string(),
  alertStatus: z.enum(["DRAFT", "SENT_PROVISIONAL", "NONE"]),
});

export type SanitizedProposal = z.infer<typeof AIActionProposalSchema>;

export function buildAttendanceBeforeSnapshot(expectedAttendance: number) {
  return { expectedAttendance, recommendedPreparation: BASELINE_RECOMMENDED_PREP };
}

export function buildAttendanceAfterSnapshot(expectedAttendance: number) {
  const recommendedPreparation =
    expectedAttendance === CORRECTED_ATTENDANCE
      ? CORRECTED_RECOMMENDED_PREP
      : BASELINE_RECOMMENDED_PREP;
  return { expectedAttendance, recommendedPreparation };
}

export function buildPreparationBeforeSnapshot(currentPreparationPlan: number) {
  return { currentPreparationPlan };
}

export function buildPreparationAfterSnapshot(proposedQuantity: number) {
  return { proposedQuantity };
}

export function buildPartnerBeforeSnapshot(selectedPartnerId: string) {
  return { selectedPartnerId };
}

export function buildPartnerAfterSnapshot(selectedPartnerId: string) {
  return { selectedPartnerId };
}

export function buildAlertBeforeSnapshot(alertStatus: string) {
  return { alertStatus };
}

export const CANONICAL_BASELINE = {
  expectedAttendance: BASELINE_ATTENDANCE,
  recommendedPreparation: BASELINE_RECOMMENDED_PREP,
  currentPreparationPlan: CURRENT_PLAN,
  safetyFloor: SAFETY_FLOOR,
} as const;
