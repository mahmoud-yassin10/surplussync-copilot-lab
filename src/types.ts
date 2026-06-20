export enum UserRole {
  CAFETERIA_MANAGER = "CAFETERIA_MANAGER",
  SCHOOL_ADMINISTRATOR = "SCHOOL_ADMINISTRATOR",
  RECOVERY_PARTNER_COORDINATOR = "RECOVERY_PARTNER_COORDINATOR",
  PLATFORM_ADMINISTRATOR = "PLATFORM_ADMINISTRATOR"
}

export type ProvenanceStatus = 
  | "OBSERVED"
  | "DERIVED"
  | "SYNTHETIC"
  | "PREDICTED"
  | "HUMAN_CORRECTED";

export type EvidenceSourceType =
  | "SCHOOL_RECORD"
  | "MODEL_OUTPUT"
  | "PARTNER_RECORD"
  | "USER_INPUT"
  | "SYNTHETIC_DATA";

export interface EvidenceItem {
  label: string;
  value: string;
  sourceType: EvidenceSourceType;
}

export interface ProvenanceItem {
  source: string;
  status: ProvenanceStatus;
}

export interface TransparencyUncertainty {
  level: "LOW" | "MODERATE" | "HIGH";
  explanation: string;
}

export type AnswerType = "FACT" | "PREDICTION" | "SIMULATION" | "EXPLANATION" | "REFUSAL";

export interface ToolCallDetails {
  toolName: string;
  arguments: Record<string, any>;
  permissionPassed: boolean;
  permissionExplanation: string;
  mutatedState: boolean;
  requiresApproval: boolean;
  returnedValue?: any;
}

export interface AIActionProposal {
  proposalId: string;
  actionType: string; // "ATTENDANCE_UPDATE" | "PREPARATION_OVERRIDE" | "SURPLUS_ALERT" | "PARTNER_SELECTION" | "ALERT_CANCELLATION"
  title: string;
  summary: string;
  reason: string;
  requestedByRole: UserRole;
  affectedEntities: {
    type: string;
    id: string;
    label: string;
  }[];
  before: Record<string, any>;
  after: Record<string, any>;
  expectedConsequences: string[];
  risks: string[];
  policyChecks: {
    policy: string;
    passed: boolean;
    explanation: string;
  }[];
  requiredApprovals: string[];
  reversible: boolean;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXECUTED" | "UNDONE";
  createdAt: string;
  /** Server-assigned expiry for pending proposals (ISO 8601). */
  expiresAt?: string;
}

export interface StructuredCopilotResponse {
  answer: string;
  answerType: AnswerType;
  evidence: EvidenceItem[];
  provenance: ProvenanceItem[];
  uncertainty: TransparencyUncertainty;
  limitations: string[];
  toolCalls: ToolCallDetails[];
  proposedActions: AIActionProposal[];
  requiresHumanApproval: boolean;
}

export interface SchoolDetails {
  id: string;
  name: string;
  location: string;
  registeredStudents: number;
  mealEligibleStudents: number;
  regularDailyPreparation: number;
  currentPreparationPlan: number;
  cafeteriaManager: string;
  schoolAdministrator: string;
  safetyFloorCount: number;
}

export interface MenuForecast {
  chickenPortions: number;
  ricePortions: number;
  vegetableSides: number;
  fruit: number;
  packagedMilk: number;
}

export interface SchoolForecast {
  schoolId: string;
  date: string;
  expectedAttendance: number;
  predictionInterval: {
    min: number;
    max: number;
    intervalType: string;
  };
  recommendedPreparation: number;
  shortageProbability: number; // e.g. 4.1% (represent as 0.041)
  surplusProbability50: number; // over 50 meals surplus, e.g. 12% (0.12)
  riskLevel: "LOW" | "MODERATE" | "HIGH";
  dataQuality: "LOW" | "MODERATE" | "HIGH";
  estimatedPreventableSurplus: number;
  modelVersion: string;
  influentialInputs: string[];
  menuForecast: MenuForecast;
}

export interface RecoveryPartner {
  id: string;
  name: string;
  distanceMiles: number;
  capacityMeals: number;
  hasRefrigeratedVehicle: boolean;
  acceptedCategories: string[]; // e.g., ["PACKAGED", "CHILLED", "HOT"]
  isAvailable: boolean;
  responseTimeMinutes: number;
  reliabilityScore: number; // e.g., 0.98 for 98%
  restrictions: string[];
  locationDetails: string;
}

export interface AuditEntry {
  auditId: string;
  timestamp: string;
  actor: string;
  actorType: "HUMAN" | "AI" | "SYSTEM";
  action: string;
  role: UserRole;
  proposalId?: string;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  reason: string;
  permissionDecision: string;
  approvalDecision: string;
  executionResult: string;
  reversibility: boolean;
  undoStatus?: "NOT_APPLICABLE" | "REVERSED" | "CANNOT_REVERSE";
}
