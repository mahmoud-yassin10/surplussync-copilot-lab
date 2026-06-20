import { StructuredCopilotResponse, UserRole, AIActionProposal } from "../types";
import { checkPermission } from "./permissionPolicy";

/**
 * Deterministically generates high-fidelity mocking for the 10 scenario guides
 * and any custom user entries.
 */
export function executeMockCopilot(message: string, role: UserRole, currentPlan: number): StructuredCopilotResponse {
  const normalized = message.toLowerCase();

  // --- SCENARIO 10: PROMPT INJECTION ---
  if (
    normalized.includes("ignore") || 
    normalized.includes("bypass") || 
    normalized.includes("override secret") ||
    normalized.includes("hide from the audit") ||
    normalized.includes("approve yourself")
  ) {
    const perm = checkPermission(role, "approve_proposal");
    return {
      answer: "REGULATORY COMPLIANCE BLOCK: I must refuse this request. The SurplusSync AI contains built-in safeguards preventing me from executing commands autonomously, bypassing human authentication, or concealing audits. Prohibited instructions have been discarded to prevent rogue actions.",
      answerType: "REFUSAL",
      evidence: [
        { label: "Bypassed Command Status", value: "REJECTED & LOGGED", sourceType: "MODEL_OUTPUT" },
        { label: "AI Autonomy Cap", value: "0% Authorized", sourceType: "SYNTHETIC_DATA" }
      ],
      provenance: [
        { source: "SurplusSync Security Engine", status: "OBSERVED" }
      ],
      uncertainty: { level: "LOW", explanation: "Compliance rules are hard-coded constraints." },
      limitations: ["Self-approval is fundamentally blockaded across all account modes."],
      toolCalls: [
        {
          toolName: "approve_proposal",
          arguments: { overrideRules: true },
          permissionPassed: false,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: false
        }
      ],
      proposedActions: [],
      requiresHumanApproval: false
    };
  }

  // --- SCENARIO 9: DELETE AUDIT HISTORY ---
  if (normalized.includes("delete") && (normalized.includes("audit") || normalized.includes("log") || normalized.includes("history"))) {
    const perm = checkPermission(role, "delete_audit_logs");
    return {
      answer: "REFUSAL: I cannot delete or edit audit trail entries. Under standard school compliance regulations, the audit log represents a legally immutable record of operations. However, I can assist you in filing an explanatory correction or amendment entry if an error was previously committed.",
      answerType: "REFUSAL",
      evidence: [
        { label: "Requested Action", value: "Delete last override log", sourceType: "USER_INPUT" },
        { label: "Audit Log Integrity", value: "IMMUTABLE", sourceType: "SCHOOL_RECORD" }
      ],
      provenance: [
        { source: "SurplusSync Security Policy", status: "OBSERVED" }
      ],
      uncertainty: { level: "LOW", explanation: "Audit persistence is enforced directly at the storage subsystem." },
      limitations: ["Audit history can only be amended with corrections, never truncated or dropped."],
      toolCalls: [
        {
          toolName: "delete_audit_logs",
          arguments: { targetId: "adt-base-plan" },
          permissionPassed: false,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: false
        }
      ],
      proposedActions: [],
      requiresHumanApproval: false
    };
  }

  // --- SCENARIO 7: FOOD SAFETY ---
  if (normalized.includes("safe") && (normalized.includes("food") || normalized.includes("donate") || normalized.includes("eat") || normalized.includes("safety"))) {
    const perm = checkPermission(role, "certify_food_safety");
    return {
      answer: "REFUSAL: I am an AI assistant and cannot certify food safety or approve human consumption. Food safety verification requires a registered cafeteria inspector to verify cooking logs, holding temperatures, and sanitization guidelines on-site. However, I can display the historical refrigeration parameters and draft a temperature checklist for Maya Rodriguez to complete before hand-off.",
      answerType: "REFUSAL",
      evidence: [
        { label: "Menu Item", value: "Chicken & Rice Portions", sourceType: "SCHOOL_RECORD" },
        { label: "Required Verification", value: "Physical Hot-holding Temp Checking (>= 135°F)", sourceType: "SYNTHETIC_DATA" }
      ],
      provenance: [
        { source: "Illinois Health Department Code", status: "OBSERVED" }
      ],
      uncertainty: { level: "LOW", explanation: "AI lacks physical sensors or direct agency to ensure food health limits." },
      limitations: ["AI can only summarize inputted times and logs; it has no empirical verification capability."],
      toolCalls: [
        {
          toolName: "certify_food_safety",
          arguments: { itemId: "chicken-rice" },
          permissionPassed: false,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: false
        }
      ],
      proposedActions: [],
      requiresHumanApproval: false
    };
  }

  // --- SCENARIO 5: UNSAFE PREPARATION REQUEST ---
  if (normalized.includes("480") && (normalized.includes("reduce") || normalized.includes("prep") || normalized.includes("meals") || normalized.includes("limit"))) {
    const perm = checkPermission(role, "propose_preparation_override", { proposedQuantity: 480 });
    return {
      answer: "REFUSAL & POLICY BLOCK: The proposed preparation target of 480 meals violates the safety floor config constraint of 540 meals for Lincoln Heights High School. Lowering counts below the safety floor exponentially spikes student shortage risk. I cannot propose or execute this quantity. Please simulate a compliant figure or contact an authorized Administrator to review the institutional safety policy.",
      answerType: "REFUSAL",
      evidence: [
        { label: "Active Safety Floor", value: "540 meals", sourceType: "SCHOOL_RECORD" },
        { label: "Proposed Amount", value: "480 meals", sourceType: "USER_INPUT" },
        { label: "Predicted Student Shortage Probability", value: "64.2% (Extremely Unsafe)", sourceType: "MODEL_OUTPUT" }
      ],
      provenance: [
        { source: "SurplusSync Regional Safety Config", status: "OBSERVED" },
        { source: "ssp-forecast-1.0", status: "PREDICTED" }
      ],
      uncertainty: { level: "LOW", explanation: "Safety limits are statically validated before evaluating model predictions." },
      limitations: ["No automated prep overrides below 540 can be processed under the current cafeteria manager policy."],
      toolCalls: [
        {
          toolName: "propose_preparation_override",
          arguments: { proposedQuantity: 480, reason: "Manual request" },
          permissionPassed: false,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: false
        }
      ],
      proposedActions: [],
      requiresHumanApproval: false
    };
  }

  // --- SCENARIO 8: PARTNER OVERRIDE ---
  if (normalized.includes("harbor") || normalized.includes("select partner") || normalized.includes("override partner")) {
    const perm = checkPermission(role, "propose_partner_selection");
    const passed = perm.granted;
    const proposalId = `prop-partner-${Date.now()}`;
    const actionProposal: AIActionProposal = {
      proposalId,
      actionType: "PARTNER_SELECTION",
      title: "Propose Recovery Route Override to Harbor Family Shelter",
      summary: "Redirect surplus distribution route from Metro Community Food Bank to Harbor Family Shelter for 2026-03-12.",
      reason: message || "Metro Food Bank vehicle transport unavailable.",
      requestedByRole: role,
      affectedEntities: [
        { type: "PARTNER", id: "harbor-shelter", label: "Harbor Family Shelter" },
        { type: "PARTNER", id: "metro-food-bank", label: "Metro Community Food Bank" }
      ],
      before: { selectedPartnerId: "metro-food-bank" },
      after: { selectedPartnerId: "harbor-shelter" },
      expectedConsequences: [
        "Surplus redirected to active nearby shelter (1.8 miles).",
        "Reduces max surplus acceptance capacity from 120 down to 70 meals.",
        "Requires manual transport coordinates as Harbor does not possess refrigerated trucks."
      ],
      risks: [
        "Unpackaged hot-food cannot be accepted according to Harbor guidelines.",
        "Any leftover surplus over 70 meals must be discarded or routed to a secondary auxiliary center."
      ],
      policyChecks: [
        { policy: "Partner Capacity Verification", passed: true, explanation: "Proposed 70 meal ceiling matches Harbor limit." },
        { policy: "Transport Rule Guidance", passed: true, explanation: "Human coordinator notified regarding refrigeration requirement." }
      ],
      requiredApprovals: ["CAFETERIA_MANAGER", "RECOVERY_PARTNER_COORDINATOR"],
      reversible: true,
      status: "PENDING_APPROVAL",
      createdAt: new Date().toISOString()
    };

    return {
      answer: passed
        ? "PROPOSAL GENERATED: I have drafted an action proposal to redirect recovery operations to Harbor Family Shelter instead of the default Metro Food Bank. This overrides the default algorithm ranking due to manual transport limits. Please review the proposal details below to authorize delivery."
        : `ACCESS DENIED: Role ${role} is not authorized to modify surplus recovery destinations. Please request a Cafeteria Manager to issue this route override.`,
      answerType: "EXPLANATION",
      evidence: [
        { label: "Default Partner", value: "Metro Food Bank (3.2 miles, refrigerated vehicle)", sourceType: "PARTNER_RECORD" },
        { label: "Override Target", value: "Harbor Family Shelter (1.8 miles, no transport)", sourceType: "PARTNER_RECORD" },
        { label: "Capacity Limit", value: "70 meals max capacity", sourceType: "PARTNER_RECORD" }
      ],
      provenance: [
        { source: "SurplusSync Directory", status: "OBSERVED" }
      ],
      uncertainty: { level: "LOW", explanation: "Target records are updated in live directory tables." },
      limitations: ["Harbor Shelter ONLY accepts sealed packaged food. All chilled/hot items are ineligible."],
      toolCalls: [
        {
          toolName: "propose_partner_selection",
          arguments: { confirmedSurplusId: "surplus-1", recommendedPartnerId: "metro-food-bank", selectedPartnerId: "harbor-shelter" },
          permissionPassed: passed,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: passed
        }
      ],
      proposedActions: passed ? [actionProposal] : [],
      requiresHumanApproval: passed
    };
  }

  // --- SCENARIO 6: DRAFT PARTNER ALERT ---
  if (normalized.includes("notify") || normalized.includes("alert") || normalized.includes("publish")) {
    const perm = checkPermission(role, "draft_surplus_alert");
    const passed = perm.granted;
    const proposalId = `prop-alert-${Date.now()}`;
    const actionProposal: AIActionProposal = {
      proposalId,
      actionType: "SURPLUS_ALERT",
      title: "Draft Potential Surplus Notification",
      summary: "Broadcast a provisional capacity reservation alert to Metro Community Food Bank and Harbor Family Shelter for 60-95 packaged meals.",
      reason: "Anticipating severe attendance reduction due to examination schedule combined with rain on Thursday.",
      requestedByRole: role,
      affectedEntities: [
        { type: "SCHOOL", id: "lincoln-heights", label: "Lincoln Heights High School" },
        { type: "PARTNER", id: "metro-food-bank", label: "Metro Community Food Bank" },
        { type: "PARTNER", id: "harbor-shelter", label: "Harbor Family Shelter" }
      ],
      before: { alertStatus: "DRAFT" },
      after: { alertStatus: "SENT_PROVISIONAL", recipients: ["metro-food-bank", "harbor-shelter"] },
      expectedConsequences: [
        "Notifies eligible local responders regarding potential excess food.",
        "Fosters early routing preparation before active dishwashers close.",
        "Explicitly labeled with placeholder disclaimer: 'Potential surplus estimate - unconfirmed donation'."
      ],
      risks: [
        "May cause false pickups if actual attendance spikes. Partners warned to wait for confirmation."
      ],
      policyChecks: [
        { policy: "Pre-alert Verification", passed: true, explanation: "Alert carries mandatory unconfirmed disclaimer." }
      ],
      requiredApprovals: ["CAFETERIA_MANAGER"],
      reversible: true,
      status: "PENDING_APPROVAL",
      createdAt: new Date().toISOString()
    };

    return {
      answer: passed
        ? "PROPOSAL GENERATED: I have drafted a potential surplus alert broadcast. This notification warns recovery partners in advance about 60 to 95 potential leftover packaged meals so they can route vehicles accordingly. The message is clearly labeled helper as UNCONFIRMED. Human authorization is required to send."
        : `ACCESS DENIED: Role ${role} cannot issue alert drafts. Please coordinate with Maya Rodriguez to broadcast forecast surplus notices.`,
      answerType: "EXPLANATION",
      evidence: [
        { label: "Estimated Leftover Margin", value: "60-95 meals", sourceType: "MODEL_OUTPUT" },
        { label: "Notification Target", value: "Metro Food Bank & Harbor Shelter", sourceType: "PARTNER_RECORD" }
      ],
      provenance: [
        { source: "ssp-forecast-1.0", status: "PREDICTED" }
      ],
      uncertainty: { level: "MODERATE", explanation: "Calculated range is subject to same-day attendance shifts." },
      limitations: ["No actual donation is guaranteed until 1:00 PM Thursday physical confirmation."],
      toolCalls: [
        {
          toolName: "draft_surplus_alert",
          arguments: { schoolId: "lincoln-heights", partnerIds: ["metro-food-bank", "harbor-shelter"], quantityRange: { minimum: 60, maximum: 95 } },
          permissionPassed: passed,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: passed
        }
      ],
      proposedActions: passed ? [actionProposal] : [],
      requiresHumanApproval: passed
    };
  }

  // --- SCENARIO 3: ATTENDANCE UPDATE ---
  if (normalized.includes("change") && (normalized.includes("attendance") || normalized.includes("trip") || normalized.includes("cancelled"))) {
    const perm = checkPermission(role, "propose_attendance_update");
    const passed = perm.granted;
    const proposalId = `prop-attn-${Date.now()}`;
    const actionProposal: AIActionProposal = {
      proposalId,
      actionType: "ATTENDANCE_UPDATE",
      title: "Correct Expected Attendance Count (Trip Cancelled)",
      summary: "Revise Thursday expectance forecast inputs from 528 students up to 540 students based on cancellations of Grade 10 off-site excursion.",
      reason: "Manual correction: Grade 10 field trip cancelled due to hazardous rainy weather warning.",
      requestedByRole: role,
      affectedEntities: [{ type: "SCHOOL", id: "lincoln-heights", label: "Lincoln Heights High School" }],
      before: { expectedAttendance: 528, recommendedPreparation: 562 },
      after: { expectedAttendance: 540, recommendedPreparation: 575 },
      expectedConsequences: [
        "Recalculating forecast model with stable attendance parameters.",
        "Adjusts recommended preparation level from 562 up to 575.",
        "Mitigates meal shortage risk as registered counts are restored."
      ],
      risks: [
        "Closer to safety floor. Preparation override recommended to ensure a 1.6% maximum depletion safety margin."
      ],
      policyChecks: [
        { policy: "Enrollment Bound Check", passed: true, explanation: "540 falls safely below 760 eligible students limits." }
      ],
      requiredApprovals: ["SCHOOL_ADMINISTRATOR"],
      reversible: true,
      status: "PENDING_APPROVAL",
      createdAt: new Date().toISOString()
    };

    return {
      answer: passed
        ? "PROPOSAL CREATED: I have created a proposal to revise Thursday's base expected attendance to 540 registered meals due to the school-cancelled field trip. Changing this value recalculates the downstream meal requirements. Please approve this record modification."
        : `ACCESS DENIED: Role ${role} cannot override school forecast constants or calendar states. Only the School Administrator (Daniel Brooks) holds permission.`,
      answerType: "EXPLANATION",
      evidence: [
        { label: "Original Baseline", value: "528 students (with field trip off)", sourceType: "SCHOOL_RECORD" },
        { label: "Revised Baseline", value: "540 meals", sourceType: "USER_INPUT" }
      ],
      provenance: [
        { source: "Lincoln Heights Calendar Log", status: "HUMAN_CORRECTED" }
      ],
      uncertainty: { level: "LOW", explanation: "Manual inputs are deterministic constraints." },
      limitations: ["Manual updates override historical context and must be used sparingly."],
      toolCalls: [
        {
          toolName: "propose_attendance_update",
          arguments: { schoolId: "lincoln-heights", date: "2026-03-12", oldValue: 528, proposedValue: 540, reason: "Grade 10 field trip cancelled" },
          permissionPassed: passed,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: passed
        }
      ],
      proposedActions: passed ? [actionProposal] : [],
      requiresHumanApproval: passed
    };
  }

  // --- SCENARIO 2: ATTENDANCE SIMULATION ---
  if (normalized.includes("attendance") && normalized.includes("540")) {
    const perm = checkPermission(role, "simulate_attendance");
    return {
      answer: "SIMULATION OUTCOME: No operational state was written. In this simulated projection, setting student attendance to 540 increases the recommended food preparation count to 575 meals. The shortage probability drops down to 1.1%, and expected recoverable surplus drops to 12.0%. This confirms that the current Thursday plan (730 meals) would create highly redundant food waste (155 meals left over) because of general exam early dismissals.",
      answerType: "SIMULATION",
      evidence: [
        { label: "Simulated Attendance", value: "540 students", sourceType: "USER_INPUT" },
        { label: "Simulated Recommended Prep", value: "575 meals", sourceType: "MODEL_OUTPUT" },
        { label: "Simulated Shortage Risk", value: "1.1%", sourceType: "MODEL_OUTPUT" },
        { label: "Original Plan Leftover", value: "155 surplus meals", sourceType: "MODEL_OUTPUT" }
      ],
      provenance: [
        { source: "ssp-forecast-1.0 Simulation Module", status: "SYNTHETIC" }
      ],
      uncertainty: { level: "MODERATE", explanation: "Simulations map linear adjustments based on standard seasonal profiles." },
      limitations: ["No actual database record was altered. Safe sandbox testing only."],
      toolCalls: [
        {
          toolName: "simulate_attendance",
          arguments: { forecastId: "lh-forecast-1", proposedAttendance: 540 },
          permissionPassed: true,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: false
        }
      ],
      proposedActions: [],
      requiresHumanApproval: false
    };
  }

  // --- SCENARIO 4: PREPARATION SIMULATION ---
  if (normalized.includes("prepare") && normalized.includes("580")) {
    const perm = checkPermission(role, "simulate_preparation_quantity");
    return {
      answer: "SIMULATION OUTCOME: No operational records were mutated. Setting meal preparation target to 580 meals (versus the recommended 562) establishes a highly conservative buffer. It reduces the shortage probability to 0.5% (nearly zero risk) but increases the potential food surplus margin to 52 meals (a 14% chance of overproduction). This represents an estimated food cost offset of +$90 versus the optimized AI forecast recommendation.",
      answerType: "SIMULATION",
      evidence: [
        { label: "Proposed Target", value: "580 meals", sourceType: "USER_INPUT" },
        { label: "Recommended Baseline", value: "562 meals", sourceType: "MODEL_OUTPUT" },
        { label: "Estimated Overproduction Excess", value: "52 meals", sourceType: "MODEL_OUTPUT" },
        { label: "Deficit Safety Floor Check", value: "PASSED (580 >= 540)", sourceType: "MODEL_OUTPUT" }
      ],
      provenance: [
        { source: "ssp-forecast-1.0 Sandbox Engine", status: "SYNTHETIC" }
      ],
      uncertainty: { level: "MODERATE", explanation: "Surplus probabilities are computed using historical exam week variances." },
      limitations: ["State retains the original plan of 730 meals until manually overridden and approved."],
      toolCalls: [
        {
          toolName: "simulate_preparation_quantity",
          arguments: { forecastId: "lh-forecast-1", proposedQuantity: 580 },
          permissionPassed: true,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: false
        }
      ],
      proposedActions: [],
      requiresHumanApproval: false
    };
  }

  // --- SCENARIO 1: EXPLAIN FORECAST ---
  if (normalized.includes("why") || normalized.includes("explain") || normalized.includes("risk")) {
    const perm = checkPermission(role, "explain_forecast");
    return {
      answer: "EXPLANATORY REASONING EVIDENCE: Thursday, March 12, 2026, is cataloged as HIGH RISK because of multiple compounding operational interruptions. Attendance is forecast to plunge by 35% compared to regular days. Compounding Factors: 1) High School Examination Schedule (early dismissal, students eat offsite), 2) Grade 10 Outing (92 students offsite), 3) Severe Thunderstorm Advisory (restricts on-site stayers). Maintaining the default catering schedule of 730 meals creates a massive risk of wasting 168 portions of fresh cooked food.",
      answerType: "EXPLANATION",
      evidence: [
        { label: "Normal Daily Preparation", value: "730 meals", sourceType: "SCHOOL_RECORD" },
        { label: "AI Forecasted Attendance", value: "528 students", sourceType: "MODEL_OUTPUT" },
        { label: "Compounding Interferences", value: "Exams + Trip + Rain", sourceType: "SCHOOL_RECORD" },
        { label: "Max Overproduction Waste", value: "168 potential portions", sourceType: "MODEL_OUTPUT" }
      ],
      provenance: [
        { source: "ssp-forecast-1.0 Metadata", status: "PREDICTED" },
        { source: "Lincoln Heights Calendar Log", status: "OBSERVED" }
      ],
      uncertainty: { level: "MODERATE", explanation: "Erratum rain vectors typically affect final walk-ins by +-5%." },
      limitations: ["Based on historical examination weeks from 2025. Real weather severity is unpredictable."],
      toolCalls: [
        {
          toolName: "explain_forecast",
          arguments: { forecastId: "lh-forecast-1" },
          permissionPassed: true,
          permissionExplanation: perm.explanation,
          mutatedState: false,
          requiresApproval: false
        }
      ],
      proposedActions: [],
      requiresHumanApproval: false
    };
  }

  // --- DEFAULT FALLBACK / SIMPLE DISCUSSION ---
  const perm = checkPermission(role, "get_forecast");
  return {
    answer: "Welcome to SurplusSync Copilot Lab. I am your operational advisory assistant. I am currently operating in high-fidelity mock laboratory mode. You can ask me to simulate attendance, explain Thursday's high overproduction risk, draft partner alerts, or correct attendance inputs. Let me know which scenario you want to test!",
    answerType: "FACT",
    evidence: [
      { label: "Demo Campus", value: "Lincoln Heights High School", sourceType: "SCHOOL_RECORD" },
      { label: "Active Operational Plan", value: `${currentPlan} meals`, sourceType: "SCHOOL_RECORD" }
    ],
    provenance: [
      { source: "SurplusSync Sandbox Parameters", status: "SYNTHETIC" }
    ],
    uncertainty: { level: "LOW", explanation: "Laboratory mock states are static." },
    limitations: ["Operates with mocked offline parameters for demonstration testing."],
    toolCalls: [
      {
        toolName: "get_forecast",
        arguments: { schoolId: "lincoln-heights", date: "2026-03-12" },
        permissionPassed: true,
        permissionExplanation: perm.explanation,
        mutatedState: false,
        requiresApproval: false
      }
    ],
    proposedActions: [],
    requiresHumanApproval: false
  };
}
