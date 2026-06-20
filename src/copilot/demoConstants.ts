/**
 * Canonical demonstration values aligned with SurplusSync Plus (surplussync-plus-web).
 * Server sessions initialize from these constants — client-supplied state is never authoritative.
 */
export const FOCUS_DATE = "2026-03-12";
export const BASELINE_ATTENDANCE = 528;
export const BASELINE_RECOMMENDED_PREP = 562;
export const CORRECTED_ATTENDANCE = 540;
export const CORRECTED_RECOMMENDED_PREP = 575;
export const CURRENT_PLAN = 730;
export const SAFETY_FLOOR = 540;
export const PREVENTABLE_SURPLUS_BASELINE = 168; // 730 - 562
export const PREVENTABLE_SURPLUS_CORRECTED = 155; // 730 - 575
export const BASELINE_SHORTAGE_PROB = 0.041;
export const CORRECTED_SHORTAGE_PROB = 0.034;

/** Demo session TTL for pending proposals (30 minutes). */
export const PROPOSAL_TTL_MS = 30 * 60 * 1000;
