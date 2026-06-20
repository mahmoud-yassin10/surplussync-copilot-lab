import type { CopilotExplanationDraft } from "./copilotResponseAssembler";
import { BANNED_TOOLS } from "./toolRegistry";
import { EvidenceItemSchema, ProvenanceItemSchema } from "./schemas";
import type { z } from "zod";

type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
type ProvenanceItem = z.infer<typeof ProvenanceItemSchema>;
export interface MockToolPlanItem {
  name: string;
  args: Record<string, unknown>;
}

export function planMockTools(message: string): MockToolPlanItem[] {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("ignore") ||
    normalized.includes("bypass") ||
    normalized.includes("approve yourself") ||
    normalized.includes("hide from the audit")
  ) {
    return [{ name: "approve_proposal", args: {} }];
  }

  if (normalized.includes("delete") && (normalized.includes("audit") || normalized.includes("log"))) {
    return [{ name: "delete_audit", args: {} }];
  }

  if (normalized.includes("480") && (normalized.includes("prep") || normalized.includes("reduce"))) {
    return [
      {
        name: "propose_preparation_override",
        args: { proposedQuantity: 480, reason: "User requested unsafe reduction" },
      },
    ];
  }

  if (normalized.includes("harbor") || normalized.includes("select partner")) {
    return [
      {
        name: "propose_partner_selection",
        args: { partnerId: "harbor-shelter", reason: message },
      },
    ];
  }

  if (normalized.includes("notify") || normalized.includes("alert") || normalized.includes("publish")) {
    return [{ name: "propose_surplus_alert", args: { reason: message } }];
  }

  if (
    normalized.includes("apply") ||
    (normalized.includes("change") && normalized.includes("attendance")) ||
    (normalized.includes("trip") && normalized.includes("cancel"))
  ) {
    if (normalized.includes("simulate") || normalized.includes("what if") || normalized.includes("what happens")) {
      return [{ name: "simulate_attendance_correction", args: { scenario: "trip_cancelled" } }];
    }
    return [
      { name: "simulate_attendance_correction", args: { scenario: "trip_cancelled" } },
      { name: "propose_attendance_update", args: { reason: message } },
    ];
  }

  if (normalized.includes("attendance") && normalized.includes("540")) {
    return [{ name: "simulate_attendance_correction", args: { scenario: "trip_cancelled" } }];
  }

  if (normalized.includes("why") || normalized.includes("explain") || normalized.includes("forecast")) {
    return [{ name: "get_attendance_forecast", args: {} }];
  }

  if (normalized.includes("partner")) {
    return [{ name: "list_recovery_partners", args: {} }];
  }

  if (normalized.includes("audit")) {
    return [{ name: "read_audit_storyline", args: { limit: 10 } }];
  }

  return [{ name: "read_operational_state", args: {} }];
}

export function buildMockExplanation(
  message: string,
  toolResults: Array<{ name: string; ok: boolean; output: Record<string, unknown> }>
): CopilotExplanationDraft {
  const normalized = message.toLowerCase();
  const limitations: string[] = [];
  const provenance: ProvenanceItem[] = [];
  const evidence: EvidenceItem[] = [];
  const forecastTool = toolResults.find((t) => t.name === "get_attendance_forecast" && t.ok);
  if (forecastTool) {
    const prov = forecastTool.output.provenance as { source?: string; fallbackUsed?: boolean } | undefined;
    if (prov?.fallbackUsed) {
      limitations.push("Forecast served from local canonical fallback.");
      provenance.push({ source: "SurplusSync Canonical Fallback", status: "SYNTHETIC" });
    } else {
      provenance.push({ source: "SurplusSync ML Service", status: "PREDICTED" });
    }
    evidence.push(
      { label: "Expected Attendance", value: String(forecastTool.output.expectedAttendance), sourceType: "MODEL_OUTPUT" },
      { label: "Recommended Prep", value: String(forecastTool.output.recommendedPrep), sourceType: "MODEL_OUTPUT" },
      {
        label: "Prediction Interval",
        value: `${forecastTool.output.intervalLow}-${forecastTool.output.intervalHigh}`,
        sourceType: "MODEL_OUTPUT",
      }
    );
  }

  const simTool = toolResults.find((t) => t.name === "simulate_attendance_correction" && t.ok);
  if (simTool) {
    const prov = simTool.output.provenance as { fallbackUsed?: boolean } | undefined;
    if (prov?.fallbackUsed) {
      limitations.push("What-if simulation served from local canonical fallback.");
    }
    evidence.push(
      { label: "Simulated Attendance", value: String(simTool.output.expectedAttendance), sourceType: "MODEL_OUTPUT" },
      { label: "Simulated Recommended Prep", value: String(simTool.output.recommendedPrep), sourceType: "MODEL_OUTPUT" }
    );
  }

  const bannedAttempt = toolResults.find((t) => (BANNED_TOOLS as readonly string[]).includes(t.name));
  if (bannedAttempt || normalized.includes("bypass") || normalized.includes("ignore")) {
    return {
      answer:
        "REGULATORY COMPLIANCE BLOCK: I must refuse requests to bypass approval, self-execute, or alter audit history. No operational state was changed.",
      answerType: "REFUSAL",
      evidence: [{ label: "Action Status", value: "REFUSED", sourceType: "MODEL_OUTPUT" }],
      provenance: [{ source: "SurplusSync Security Engine", status: "OBSERVED" }],
      uncertainty: { level: "LOW", explanation: "Policy enforcement is deterministic." },
      limitations: ["Self-approval and audit deletion are prohibited."],
    };
  }

  const proposalCreated = toolResults.some(
    (t) => t.name.startsWith("propose_") && t.ok && t.output.status === "PENDING_APPROVAL"
  );
  const proposalRejected = toolResults.some((t) => t.name.startsWith("propose_") && !t.ok);

  if (proposalRejected) {
    return {
      answer:
        "I could not create the requested proposal because server policy rejected it. No session state was mutated.",
      answerType: "REFUSAL",
      evidence,
      provenance: provenance.length ? provenance : [{ source: "SurplusSync Policy Engine", status: "OBSERVED" }],
      uncertainty: { level: "LOW", explanation: "Proposal sanitation is server-authoritative." },
      limitations,
    };
  }

  if (simTool && !proposalCreated) {
    return {
      answer:
        "SIMULATION OUTCOME: No operational state was written. Cancelling the field trip raises expected attendance to 540 and recommended preparation to 575 meals. Human approval is required before applying this correction.",
      answerType: "SIMULATION",
      evidence,
      provenance: provenance.length ? provenance : [{ source: "SurplusSync ML What-If", status: "SYNTHETIC" }],
      uncertainty: { level: "MODERATE", explanation: "Simulation does not mutate stored session values." },
      limitations: [...limitations, "Stored session forecast remains unchanged until a proposal is approved."],
    };
  }

  if (proposalCreated) {
    return {
      answer:
        "PROPOSAL CREATED: I drafted a pending operational change. It requires explicit human approval through the laboratory approval gate before any session state is mutated.",
      answerType: "EXPLANATION",
      evidence,
      provenance: provenance.length ? provenance : [{ source: "SurplusSync Proposal Engine", status: "DERIVED" }],
      uncertainty: { level: "LOW", explanation: "Proposal remains pending until signed." },
      limitations,
    };
  }

  if (forecastTool) {
    return {
      answer:
        "Thursday's attendance forecast shows 528 expected students with a recommended preparation of 562 meals. The 80% prediction interval spans 497 to 557 students.",
      answerType: "PREDICTION",
      evidence,
      provenance,
      uncertainty: { level: "MODERATE", explanation: "Exam week and weather elevate uncertainty." },
      limitations,
    };
  }

  return {
    answer: "I inspected the current operational session state. Ask me to explain Thursday's forecast, simulate attendance corrections, or draft a pending proposal.",
    answerType: "FACT",
    evidence,
    provenance: [{ source: "SurplusSync Session Store", status: "OBSERVED" }],
    uncertainty: { level: "LOW", explanation: "Session snapshot is authoritative." },
    limitations,
  };
}
