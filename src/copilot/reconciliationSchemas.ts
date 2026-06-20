import { z } from "zod";
import { UserRole } from "../types";
import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
} from "./demoConstants";

const ReconciliationRoleSchema = z.enum([
  UserRole.CAFETERIA_MANAGER,
  UserRole.SCHOOL_ADMINISTRATOR,
  UserRole.RECOVERY_PARTNER_COORDINATOR,
  UserRole.PLATFORM_ADMINISTRATOR,
]);

const OperationalSnapshotSchema = z
  .object({
    expectedAttendance: z.union([z.literal(BASELINE_ATTENDANCE), z.literal(CORRECTED_ATTENDANCE)]),
    recommendedPreparation: z.union([
      z.literal(BASELINE_RECOMMENDED_PREP),
      z.literal(CORRECTED_RECOMMENDED_PREP),
    ]),
    currentPreparationPlan: z.union([z.literal(730), z.literal(562), z.literal(575)]),
    attendanceCorrected: z.boolean(),
    provisionalAlertsSent: z.boolean(),
    selectedPartnerId: z.string().min(1).nullable(),
    proposalsPermitted: z.boolean().optional(),
    partnerPrerequisites: z
      .object({
        surplusConfirmed: z.boolean(),
        surplusMeals: z.number().int().nonnegative().nullable(),
        foodSafetyChecklistComplete: z.boolean(),
        recoveryWindowValid: z.boolean(),
        proposalsPermitted: z.boolean(),
        resetVersion: z.number().int().nonnegative(),
        cancellationVersion: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ReconciliationRequestSchema = z
  .object({
    source: z.literal("surplussync-plus"),
    stateVersion: z.literal("ssp_state_v2"),
    role: ReconciliationRoleSchema,
    operational: OperationalSnapshotSchema,
  })
  .strict();

export type ReconciliationRequest = z.infer<typeof ReconciliationRequestSchema>;

export function validateReconciliationRequest(
  body: unknown,
  knownPartnerIds: readonly string[]
):
  | { ok: true; data: ReconciliationRequest }
  | { ok: false; statusCode: 400 | 422; error: string } {
  const parsed = ReconciliationRequestSchema.safeParse(body);
  if (!parsed.success) {
    const hasExtraKeys =
      typeof body === "object" &&
      body !== null &&
      Object.keys(body as object).some(
        (k) => !["source", "stateVersion", "role", "operational"].includes(k)
      );
    if (hasExtraKeys) {
      return { ok: false, statusCode: 422, error: "Unexpected properties in reconciliation payload" };
    }
    return { ok: false, statusCode: 400, error: "Invalid reconciliation payload" };
  }

  const { operational } = parsed.data;

  if (!operational.attendanceCorrected) {
    if (
      operational.expectedAttendance !== BASELINE_ATTENDANCE ||
      operational.recommendedPreparation !== BASELINE_RECOMMENDED_PREP
    ) {
      return {
        ok: false,
        statusCode: 422,
        error:
          "When attendanceCorrected is false, expectedAttendance must be 528 and recommendedPreparation must be 562",
      };
    }
  } else {
    if (
      operational.expectedAttendance !== CORRECTED_ATTENDANCE ||
      operational.recommendedPreparation !== CORRECTED_RECOMMENDED_PREP
    ) {
      return {
        ok: false,
        statusCode: 422,
        error:
          "When attendanceCorrected is true, expectedAttendance must be 540 and recommendedPreparation must be 575",
      };
    }
  }

  if (operational.selectedPartnerId !== null && !knownPartnerIds.includes(operational.selectedPartnerId)) {
    return { ok: false, statusCode: 422, error: "Unknown recovery partner ID" };
  }

  return { ok: true, data: parsed.data };
}
