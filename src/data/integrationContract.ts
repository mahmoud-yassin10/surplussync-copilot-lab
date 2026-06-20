export const INTEGRATION_DOCUMENTATION_MARKDOWN = `### SurplusSync Copilot Laboratory — Integration Contract

The Copilot is structured as an **auxiliary operations copilot subsystem**. It handles predictive analysis, simulation, drafting, and explaining. It **never** writes mutations directly to the active system database; instead, it outputs action proposals specifying human actions to invoke.

#### 1. Context Payload Interface
To query the copilot server endpoint \`/api/copilot\`, transmit the following JSON payload:

\`\`\`typescript
export interface CopilotContext {
  // Current active user question or command
  message: string;
  
  // Authorized operational role
  role: "CAFETERIA_MANAGER" | "SCHOOL_ADMINISTRATOR" | "RECOVERY_PARTNER_COORDINATOR" | "PLATFORM_ADMINISTRATOR";
  
  // Current catering preparation settings (context for predictive math)
  currentPlan: number;
  
  // In-memory states representing simulated modifications
  schoolState: {
    id: string;
    name: string;
    registeredStudents: number;
    mealEligibleStudents: number;
    regularDailyPreparation: number;
    currentPreparationPlan: number;
    safetyFloorCount: number;
  };
  
  forecastState: {
    expectedAttendance: number;
    recommendedPreparation: number;
    riskLevel: string;
    menuForecast: {
      chickenPortions: number;
      ricePortions: number;
      packagedMilk: number;
    };
  };
  
  partnersState: Array<{
    id: string;
    name: string;
    capacityMeals: number;
    isAvailable: boolean;
  }>;
}
\`\`\`

#### 2. Response Proposal Schema
The server resolves with a structured payload that represents the \`StructuredCopilotResponse\` object:

\`\`\`typescript
export interface StructuredCopilotResponse {
  answer: string;                  // Plain-text conversational response
  answerType: "FACT" | "PREDICTION" | "SIMULATION" | "EXPLANATION" | "REFUSAL";
  evidence: Array<{
    label: string;
    value: string;
    sourceType: "SCHOOL_RECORD" | "MODEL_OUTPUT" | "PARTNER_RECORD" | "USER_INPUT" | "SYNTHETIC_DATA";
  }>;
  provenance: Array<{
    source: string;
    status: "OBSERVED" | "DERIVED" | "SYNTHETIC" | "PREDICTED" | "HUMAN_CORRECTED";
  }>;
  uncertainty: {
    level: "LOW" | "MODERATE" | "HIGH";
    explanation: string;
  };
  limitations: string[];           // Known model bounds for user warning
  toolCalls: Array<{
    toolName: string;
    arguments: Record<string, any>;
    permissionPassed: boolean;     // Validated server-side prior to packaging
    permissionExplanation: string;
    mutatedState: boolean;
    requiresApproval: boolean;
  }>;
  proposedActions: Array<{
    proposalId: string;
    actionType: "ATTENDANCE_UPDATE" | "PREPARATION_OVERRIDE" | "SURPLUS_ALERT" | "PARTNER_SELECTION" | "ALERT_CANCELLATION";
    title: string;
    summary: string;
    reason: string;
    requestedByRole: string;
    affectedEntities: Array<{ type: string; id: string; label: string; }>;
    before: Record<string, any>;
    after: Record<string, any>;
    policyChecks: Array<{ policy: string; passed: boolean; explanation: string; }>;
    requiredApprovals: string[];   // Roles needed to sign off
    reversible: boolean;
    status: "PENDING_APPROVAL";
    createdAt: string;
  }>;
  requiresHumanApproval: boolean;
}
\`\`\`

#### 3. Execution Pipeline & Role Authorization
All proposed mutations MUST execute through standard deterministic client controller code. Step-by-step pipeline:
1. **AI Generation**: Copilot creates a proposal with \`status: "PENDING_APPROVAL"\`.
2. **Permission Check**: The system validates that the user's *actively logged role* belongs to the proposal's \`requiredApprovals\` array.
3. **Execution Handler**: A deterministic function executes the state alteration (e.g., editing the meal target or sending email alerts) using standard REST APIs, then writes a legally immutable audit entry inside \`AuditHistory\`.
`;
