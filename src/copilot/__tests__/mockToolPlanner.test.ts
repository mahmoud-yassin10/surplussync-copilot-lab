import { describe, expect, it } from "vitest";
import { buildMockExplanation, planMockTools } from "../mockToolPlanner";
import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  PREVENTABLE_SURPLUS_BASELINE,
  PREVENTABLE_SURPLUS_CORRECTED,
} from "../demoConstants";

describe("mock tool planner", () => {
  it("routes preparation adjustment requests to propose_preparation_override", () => {
    const plan = planMockTools("Please adjust Thursday preparation to 575 meals.");
    expect(plan).toEqual([
      {
        name: "propose_preparation_override",
        args: {
          proposedQuantity: 575,
          reason: "Please adjust Thursday preparation to 575 meals.",
        },
      },
    ]);
  });

  it("includes all canonical baseline facts in forecast explanations", () => {
    const explanation = buildMockExplanation("Why is Thursday high risk?", [
      {
        name: "get_attendance_forecast",
        ok: true,
        output: {
          expectedAttendance: BASELINE_ATTENDANCE,
          intervalLow: 497,
          intervalHigh: 557,
          recommendedPrep: BASELINE_RECOMMENDED_PREP,
          preventableSurplus: PREVENTABLE_SURPLUS_BASELINE,
          shortageProb: 0.041,
          risk: "high",
        },
      },
    ]);
    expect(explanation.answer).toContain("528");
    expect(explanation.answer).toContain("497");
    expect(explanation.answer).toContain("557");
    expect(explanation.answer).toContain("562");
    expect(explanation.answer).toContain("168");
    expect(explanation.answer).toContain("4.1%");
    expect(explanation.answer.toLowerCase()).toContain("high risk");
    expect(explanation.provenance).toHaveLength(0);
  });

  it("includes all canonical simulation facts without mutating state", () => {
    const explanation = buildMockExplanation(
      "What happens if attendance changes to 540 because a cancelled trip returns students to school?",
      [
        {
          name: "simulate_attendance_correction",
          ok: true,
          output: {
            expectedAttendance: CORRECTED_ATTENDANCE,
            intervalLow: 512,
            intervalHigh: 568,
            recommendedPrep: CORRECTED_RECOMMENDED_PREP,
            preventableSurplus: PREVENTABLE_SURPLUS_CORRECTED,
            shortageProb: 0.034,
            risk: "high",
            sessionMutated: false,
          },
        },
      ],
    );
    expect(explanation.answerType).toBe("SIMULATION");
    expect(explanation.answer.toLowerCase()).toContain("simulation");
    expect(explanation.answer).toContain("540");
    expect(explanation.answer).toContain("512");
    expect(explanation.answer).toContain("568");
    expect(explanation.answer).toContain("575");
    expect(explanation.answer).toContain("155");
    expect(explanation.answer).toContain("3.4%");
    expect(explanation.answer.toLowerCase()).toContain("high");
    expect(explanation.answer).toContain("528");
    expect(explanation.answer).toContain("562");
  });
});
