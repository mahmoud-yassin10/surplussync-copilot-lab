import type { CopilotExplanationDraft } from "./copilotResponseAssembler";
import {
  CANONICAL_INTERVAL_BASELINE,
  CANONICAL_INTERVAL_CORRECTED,
} from "./canonicalMlFeatures";
import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  BASELINE_SHORTAGE_PROB,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  CORRECTED_SHORTAGE_PROB,
  CURRENT_PLAN,
  PREVENTABLE_SURPLUS_BASELINE,
  PREVENTABLE_SURPLUS_CORRECTED,
} from "./demoConstants";
import { BANNED_TOOLS } from "./toolRegistry";
import { EvidenceItemSchema, ProvenanceItemSchema } from "./schemas";
import type { z } from "zod";

type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
type ProvenanceItem = z.infer<typeof ProvenanceItemSchema>;
export interface MockToolPlanItem {
  name: string;
  args: Record<string, unknown>;
}

function formatPct(prob: number): string {
  return `${(prob * 100).toFixed(1)}%`;
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

  if (
    (normalized.includes("prep") || normalized.includes("preparation") || normalized.includes("meals")) &&
    (normalized.includes("adjust") ||
      normalized.includes("change") ||
      normalized.includes("set") ||
      normalized.includes("override") ||
      /\b\d{3}\b/.test(normalized))
  ) {
    const qtyMatch = normalized.match(/\b(4\d{2}|5\d{2}|6\d{2}|7\d{2})\b/);
    const proposedQuantity = qtyMatch ? Number(qtyMatch[1]) : CORRECTED_RECOMMENDED_PREP;
    return [
      {
        name: "propose_preparation_override",
        args: { proposedQuantity, reason: message },
      },
    ];
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
  const limitations: string[] = ["Synthetic demo data."];
  const provenance: ProvenanceItem[] = [];
  const evidence: EvidenceItem[] = [];
  const forecastTool = toolResults.find((t) => t.name === "get_attendance_forecast" && t.ok);
  if (forecastTool) {
    const attendance = Number(forecastTool.output.expectedAttendance ?? BASELINE_ATTENDANCE);
    const intervalLow = Number(forecastTool.output.intervalLow ?? CANONICAL_INTERVAL_BASELINE.low);
    const intervalHigh = Number(forecastTool.output.intervalHigh ?? CANONICAL_INTERVAL_BASELINE.high);
    const recommendedPrep = Number(forecastTool.output.recommendedPrep ?? BASELINE_RECOMMENDED_PREP);
    const preventableSurplus = Number(
      forecastTool.output.preventableSurplus ?? PREVENTABLE_SURPLUS_BASELINE,
    );
    const shortageProb = Number(forecastTool.output.shortageProb ?? BASELINE_SHORTAGE_PROB);
    const risk = String(forecastTool.output.risk ?? "high");
    evidence.push(
      { label: "Expected attendance", value: String(attendance), sourceType: "MODEL_OUTPUT" },
      {
        label: "Attendance interval",
        value: `${intervalLow}–${intervalHigh}`,
        sourceType: "MODEL_OUTPUT",
      },
      { label: "Recommended preparation", value: String(recommendedPrep), sourceType: "MODEL_OUTPUT" },
      { label: "Preventable surplus", value: String(preventableSurplus), sourceType: "MODEL_OUTPUT" },
      { label: "Shortage probability", value: formatPct(shortageProb), sourceType: "MODEL_OUTPUT" },
      { label: "Risk", value: risk, sourceType: "MODEL_OUTPUT" },
    );
  }

  const simTool = toolResults.find((t) => t.name === "simulate_attendance_correction" && t.ok);
  if (simTool) {
    const attendance = Number(simTool.output.expectedAttendance ?? CORRECTED_ATTENDANCE);
    const intervalLow = Number(simTool.output.intervalLow ?? CANONICAL_INTERVAL_CORRECTED.low);
    const intervalHigh = Number(simTool.output.intervalHigh ?? CANONICAL_INTERVAL_CORRECTED.high);
    const recommendedPrep = Number(simTool.output.recommendedPrep ?? CORRECTED_RECOMMENDED_PREP);
    const preventableSurplus = Number(
      simTool.output.preventableSurplus ?? PREVENTABLE_SURPLUS_CORRECTED,
    );
    const shortageProb = Number(simTool.output.shortageProb ?? CORRECTED_SHORTAGE_PROB);
    const risk = String(simTool.output.risk ?? "high");
    evidence.push(
      { label: "Simulated attendance", value: String(attendance), sourceType: "MODEL_OUTPUT" },
      {
        label: "Simulated interval",
        value: `${intervalLow}–${intervalHigh}`,
        sourceType: "MODEL_OUTPUT",
      },
      {
        label: "Simulated recommended preparation",
        value: String(recommendedPrep),
        sourceType: "MODEL_OUTPUT",
      },
      { label: "Preventable surplus", value: String(preventableSurplus), sourceType: "MODEL_OUTPUT" },
      { label: "Shortage probability", value: formatPct(shortageProb), sourceType: "MODEL_OUTPUT" },
      { label: "Risk", value: risk, sourceType: "MODEL_OUTPUT" },
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
    const attendance = Number(simTool.output.expectedAttendance ?? CORRECTED_ATTENDANCE);
    const intervalLow = Number(simTool.output.intervalLow ?? CANONICAL_INTERVAL_CORRECTED.low);
    const intervalHigh = Number(simTool.output.intervalHigh ?? CANONICAL_INTERVAL_CORRECTED.high);
    const recommendedPrep = Number(simTool.output.recommendedPrep ?? CORRECTED_RECOMMENDED_PREP);
    const preventableSurplus = Number(
      simTool.output.preventableSurplus ?? PREVENTABLE_SURPLUS_CORRECTED,
    );
    const shortageProb = Number(simTool.output.shortageProb ?? CORRECTED_SHORTAGE_PROB);
    return {
      answer:
        `SIMULATION OUTCOME (what-if only — no operational state was written): If the cancelled field trip returns students, simulated attendance rises to ${attendance} (${intervalLow}–${intervalHigh}), recommended preparation becomes ${recommendedPrep}, preventable surplus is ${preventableSurplus}, shortage probability is ${formatPct(shortageProb)}, and risk remains high. Session attendance stays at ${BASELINE_ATTENDANCE} with recommended preparation ${BASELINE_RECOMMENDED_PREP} until a proposal is approved.`,
      answerType: "SIMULATION",
      evidence,
      provenance,
      uncertainty: { level: "MODERATE", explanation: "Simulation does not mutate stored session values." },
      limitations: [
        ...limitations,
        "Stored session forecast remains unchanged until a proposal is approved.",
      ],
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
    const attendance = Number(forecastTool.output.expectedAttendance ?? BASELINE_ATTENDANCE);
    const intervalLow = Number(forecastTool.output.intervalLow ?? CANONICAL_INTERVAL_BASELINE.low);
    const intervalHigh = Number(forecastTool.output.intervalHigh ?? CANONICAL_INTERVAL_BASELINE.high);
    const recommendedPrep = Number(forecastTool.output.recommendedPrep ?? BASELINE_RECOMMENDED_PREP);
    const preventableSurplus = Number(
      forecastTool.output.preventableSurplus ?? PREVENTABLE_SURPLUS_BASELINE,
    );
    const shortageProb = Number(forecastTool.output.shortageProb ?? BASELINE_SHORTAGE_PROB);
    return {
      answer:
        `Thursday is flagged high risk because expected attendance is ${attendance} (${intervalLow}–${intervalHigh}), recommended preparation is ${recommendedPrep} against a ${CURRENT_PLAN}-meal plan, preventable surplus is estimated at ${preventableSurplus} meals, and shortage probability is ${formatPct(shortageProb)}.`,
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
