import { z } from "zod";

export const mlForecastFeaturesInputSchema = z.object({
  school_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  enrolled: z.number().int().positive(),
  eligible: z.number().int().positive(),
  normal_prep: z.number().int().nonnegative(),
  menu_name: z.string().min(1),
  menu_popularity: z.number().min(0.5).max(1.5),
  recent_attendance_7d: z.number().nonnegative(),
  recent_attendance_14d: z.number().nonnegative(),
  expected_attendance: z.number().int().nonnegative().optional(),
  is_exam: z.boolean().optional(),
  trip_students: z.number().int().nonnegative().optional(),
  early_dismissal: z.boolean().optional(),
  assembly_students: z.number().int().nonnegative().optional(),
  sports_students: z.number().int().nonnegative().optional(),
  rain_probability: z.number().min(0).max(1).optional(),
  rain_inches: z.number().nonnegative().optional(),
  temperature_f: z.number().optional(),
});

export type MlForecastFeaturesInput = z.infer<typeof mlForecastFeaturesInputSchema>;

export const mlWhatIfChangesSchema = z.record(z.union([z.number(), z.boolean(), z.string()]));

export const mlWhatIfRequestSchema = z.object({
  base: mlForecastFeaturesInputSchema,
  changes: mlWhatIfChangesSchema,
});

export const mlForecastResponseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedAttendance: z.number().int().nonnegative(),
  intervalLow: z.number().int().nonnegative(),
  intervalHigh: z.number().int().nonnegative(),
  recommendedPrep: z.number().int().nonnegative(),
  shortageProb: z.number().min(0).max(1).optional(),
  largeSurplusProb: z.number().min(0).max(1).optional(),
  preventableSurplus: z.number().int().nonnegative(),
  risk: z.enum(["low", "moderate", "high", "critical"]).optional(),
  dataQuality: z.enum(["low", "medium", "high"]).optional(),
  modelVersion: z.string().optional(),
  approvalRequired: z.boolean().default(true),
  decisionStatus: z.literal("PROPOSED").default("PROPOSED"),
  safetyFloorApplied: z.boolean().optional(),
  generatedAt: z.string().optional(),
});

export type MlForecastResponse = z.infer<typeof mlForecastResponseSchema>;

export const mlHealthResponseSchema = z.object({
  status: z.string(),
  modelLoaded: z.boolean().optional(),
  service: z.string().optional(),
});

export const forecastProvenanceSchema = z.object({
  source: z.enum(["ml", "local-canonical-fallback"]),
  mlReachable: z.boolean(),
  fallbackUsed: z.boolean(),
  decisionStatus: z.literal("PROPOSED"),
  approvalRequired: z.literal(true),
});

export type ForecastProvenance = z.infer<typeof forecastProvenanceSchema>;
