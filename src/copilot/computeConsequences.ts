import {
  BASELINE_ATTENDANCE,
  BASELINE_RECOMMENDED_PREP,
  CORRECTED_ATTENDANCE,
  CORRECTED_RECOMMENDED_PREP,
  CURRENT_PLAN,
  FOCUS_DATE,
  SAFETY_FLOOR,
} from "./demoConstants";
import { ActionType } from "./actionPolicy";

export function computeExpectedConsequences(
  actionType: ActionType,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  switch (actionType) {
    case "ATTENDANCE_UPDATE": {
      const prev = (before.expectedAttendance as number) ?? BASELINE_ATTENDANCE;
      const next = (after.expectedAttendance as number) ?? CORRECTED_ATTENDANCE;
      return [
        `Recalculates ${FOCUS_DATE} forecast attendance from ${prev} to ${next} students.`,
        `Recommended preparation adjusts from ${BASELINE_RECOMMENDED_PREP} to ${CORRECTED_RECOMMENDED_PREP} meals when attendance reaches ${CORRECTED_ATTENDANCE}.`,
        "Mitigates meal shortage risk as registered counts are restored.",
      ];
    }
    case "PREPARATION_OVERRIDE": {
      const prev = (before.currentPreparationPlan as number) ?? CURRENT_PLAN;
      const next = (after.proposedQuantity as number) ?? BASELINE_RECOMMENDED_PREP;
      return [
        `Changes active preparation plan from ${prev} to ${next} meals.`,
        `Safety floor of ${SAFETY_FLOOR} meals remains enforced.`,
        `Estimated preventable surplus shifts relative to the ${CURRENT_PLAN}-meal baseline plan.`,
      ];
    }
    case "SURPLUS_ALERT":
      return [
        "Notifies eligible local recovery partners regarding potential excess food.",
        "Alert is labeled as provisional and unconfirmed until same-day verification.",
        "Partners may stage routing before final surplus confirmation.",
      ];
    case "PARTNER_SELECTION": {
      const prev = (before.selectedPartnerId as string) ?? "metro-food-bank";
      const next = (after.selectedPartnerId as string) ?? prev;
      return [
        `Redirects surplus recovery route from ${prev} to ${next}.`,
        "Capacity and transport constraints for the selected partner apply.",
        "Human coordinator must confirm refrigeration and packaging rules at handoff.",
      ];
    }
    case "ALERT_CANCELLATION":
      return [
        "Cancels the active provisional surplus alert broadcast.",
        "Recovery partners are notified that routing is no longer required.",
        "Reversible if surplus materializes later in the service window.",
      ];
    default:
      return [];
  }
}
