import { z } from "zod";
import { SAFETY_FLOOR } from "./demoConstants";

export const ReadOperationalStateArgsSchema = z.object({}).strict();

export const GetAttendanceForecastArgsSchema = z
  .object({
    schoolId: z.string().optional(),
    date: z.string().optional(),
  })
  .strict();

export const SimulateAttendanceCorrectionArgsSchema = z
  .object({
    schoolId: z.string().optional(),
    date: z.string().optional(),
    scenario: z.literal("trip_cancelled").default("trip_cancelled"),
  })
  .strict();

export const ListRecoveryPartnersArgsSchema = z.object({}).strict();

export const ReadAuditStorylineArgsSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const ProposeAttendanceUpdateArgsSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export const ProposePreparationOverrideArgsSchema = z.object({
  proposedQuantity: z.number().int().min(SAFETY_FLOOR).max(900),
  reason: z.string().min(1).max(2000),
});

export const ProposeSurplusAlertArgsSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export const ProposePartnerSelectionArgsSchema = z.object({
  partnerId: z.string().min(1),
  reason: z.string().min(1).max(2000),
});

export const ProposeAlertCancellationArgsSchema = z.object({
  reason: z.string().min(1).max(2000),
});
