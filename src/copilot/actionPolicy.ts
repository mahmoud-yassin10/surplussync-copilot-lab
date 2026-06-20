import { UserRole } from "../types";

export const ACTION_TYPES = [
  "ATTENDANCE_UPDATE",
  "PREPARATION_OVERRIDE",
  "SURPLUS_ALERT",
  "PARTNER_SELECTION",
  "ALERT_CANCELLATION",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

/** Roles that may initiate (propose) each action type. PLATFORM_ADMINISTRATOR is excluded from all operational proposals. */
const PROPOSE_MATRIX: Record<ActionType, UserRole[]> = {
  ATTENDANCE_UPDATE: [UserRole.SCHOOL_ADMINISTRATOR],
  PREPARATION_OVERRIDE: [UserRole.CAFETERIA_MANAGER],
  SURPLUS_ALERT: [UserRole.CAFETERIA_MANAGER],
  PARTNER_SELECTION: [UserRole.CAFETERIA_MANAGER, UserRole.RECOVERY_PARTNER_COORDINATOR],
  ALERT_CANCELLATION: [UserRole.CAFETERIA_MANAGER, UserRole.RECOVERY_PARTNER_COORDINATOR],
};

/** Roles that may approve (sign) each action type. Derived server-side — never trusted from model output. */
const APPROVAL_MATRIX: Record<ActionType, UserRole[]> = {
  ATTENDANCE_UPDATE: [UserRole.SCHOOL_ADMINISTRATOR],
  PREPARATION_OVERRIDE: [UserRole.CAFETERIA_MANAGER],
  SURPLUS_ALERT: [UserRole.CAFETERIA_MANAGER],
  PARTNER_SELECTION: [UserRole.CAFETERIA_MANAGER, UserRole.RECOVERY_PARTNER_COORDINATOR],
  ALERT_CANCELLATION: [UserRole.CAFETERIA_MANAGER, UserRole.RECOVERY_PARTNER_COORDINATOR],
};

export function deriveRequiredApprovals(actionType: ActionType): UserRole[] {
  return [...APPROVAL_MATRIX[actionType]];
}

export function canProposeAction(role: UserRole, actionType: ActionType): boolean {
  if (role === UserRole.PLATFORM_ADMINISTRATOR) return false;
  return PROPOSE_MATRIX[actionType].includes(role);
}

export function canApproveAction(role: UserRole, actionType: ActionType): boolean {
  if (role === UserRole.PLATFORM_ADMINISTRATOR) return false;
  return APPROVAL_MATRIX[actionType].includes(role);
}
