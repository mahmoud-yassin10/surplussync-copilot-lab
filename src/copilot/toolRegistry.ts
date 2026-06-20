import { FunctionDeclaration, Type } from "@google/genai";

export const READ_ONLY_TOOLS = [
  "read_operational_state",
  "get_attendance_forecast",
  "simulate_attendance_correction",
  "list_recovery_partners",
  "read_audit_storyline",
] as const;

export const PROPOSAL_TOOLS = [
  "propose_attendance_update",
  "propose_preparation_override",
  "propose_surplus_alert",
  "propose_partner_selection",
  "propose_alert_cancellation",
] as const;

export const ALLOWED_TOOLS = [...READ_ONLY_TOOLS, ...PROPOSAL_TOOLS] as const;

export type AllowedToolName = (typeof ALLOWED_TOOLS)[number];

export const BANNED_TOOLS = [
  "approve_proposal",
  "execute_proposal",
  "mutate_state",
  "delete_audit",
  "replace_audit",
  "undo",
  "send_alert_directly",
  "reserve_partner_directly",
  "assign_driver",
  "complete_pickup",
  "execute_action",
  "approve_proposal",
  "delete_audit_logs",
  "certify_food_safety",
] as const;

export function isAllowedTool(name: string): name is AllowedToolName {
  return (ALLOWED_TOOLS as readonly string[]).includes(name);
}

export function isBannedTool(name: string): boolean {
  return (BANNED_TOOLS as readonly string[]).includes(name);
}

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "read_operational_state",
    description: "Read the authoritative server session operational snapshot.",
    parametersJsonSchema: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "get_attendance_forecast",
    description:
      "Fetch the canonical Thursday attendance forecast from the ML service for the locked demo school/date.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "simulate_attendance_correction",
    description:
      "Simulate cancelling the Grade 10 field trip via ML what-if. Does not mutate session state.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        scenario: { type: Type.STRING, description: "Only trip_cancelled is supported." },
      },
    },
  },
  {
    name: "list_recovery_partners",
    description: "List recovery partners from the server session directory.",
    parametersJsonSchema: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "read_audit_storyline",
    description: "Read append-only audit storyline from the server session.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        limit: { type: Type.INTEGER },
      },
    },
  },
  {
    name: "propose_attendance_update",
    description:
      "Create a pending attendance correction proposal. Does not execute. Requires later human approval.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING },
      },
      required: ["reason"],
    },
  },
  {
    name: "propose_preparation_override",
    description: "Create a pending preparation override proposal (>=540 meals).",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        proposedQuantity: { type: Type.INTEGER },
        reason: { type: Type.STRING },
      },
      required: ["proposedQuantity", "reason"],
    },
  },
  {
    name: "propose_surplus_alert",
    description: "Create a pending provisional surplus alert proposal.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: { reason: { type: Type.STRING } },
      required: ["reason"],
    },
  },
  {
    name: "propose_partner_selection",
    description: "Create a pending partner route override proposal.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        partnerId: { type: Type.STRING },
        reason: { type: Type.STRING },
      },
      required: ["partnerId", "reason"],
    },
  },
  {
    name: "propose_alert_cancellation",
    description: "Create a pending alert cancellation proposal.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: { reason: { type: Type.STRING } },
      required: ["reason"],
    },
  },
];
