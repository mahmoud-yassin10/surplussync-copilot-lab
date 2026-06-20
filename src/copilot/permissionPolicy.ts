import { UserRole } from "../types";

export interface PermissionResult {
  granted: boolean;
  explanation: string;
}

/**
 * Checks if a specific role is allowed to access/invoke a tool or action category.
 */
export function checkPermission(role: UserRole, toolName: string, payload?: any): PermissionResult {
  // Read-only tools are generally accessible but some have constraints
  switch (toolName) {
    case "get_forecast":
    case "explain_forecast":
    case "simulate_attendance":
    case "simulate_preparation_quantity":
    case "list_similar_days":
    case "list_recovery_partners":
    case "get_partner_capacity":
    case "get_system_policy":
      return {
        granted: true,
        explanation: `Access granted: Read-only tool '${toolName}' is accessible to role ${role}.`
      };

    case "get_audit_history":
      if (role === UserRole.PLATFORM_ADMINISTRATOR || role === UserRole.SCHOOL_ADMINISTRATOR || role === UserRole.CAFETERIA_MANAGER) {
        return {
          granted: true,
          explanation: `Access granted: Audit records can be checked by operational roles.`
        };
      }
      return {
        granted: false,
        explanation: `Access denied: Role ${role} does not have standard authorization to view full system audit history.`
      };

    // Proposal-only tools (create pending actions)
    case "propose_attendance_update":
      if (role === UserRole.SCHOOL_ADMINISTRATOR || role === UserRole.PLATFORM_ADMINISTRATOR) {
        return {
          granted: true,
          explanation: `Access granted: School Administrators are responsible for managing school-level attendance counts.`
        };
      }
      return {
        granted: false,
        explanation: `Access denied: Proposing expected attendance corrections is restricted to School Administrators. Cafeteria managers must escalate attendance concerns.`
      };

    case "propose_preparation_override":
      if (role === UserRole.CAFETERIA_MANAGER || role === UserRole.PLATFORM_ADMINISTRATOR) {
        // Check safety floor constraint
        if (payload && payload.proposedQuantity !== undefined) {
          if (payload.proposedQuantity < 540) {
            return {
              granted: false,
              explanation: `Access Denied: The requested preparation quantity (${payload.proposedQuantity}) violates the safety floor config constraint of 540 meals.`
            };
          }
        }
        return {
          granted: true,
          explanation: `Access granted: Cafeteria Managers are authorized to propose meal preparation target deviations.`
        };
      }
      return {
        granted: false,
        explanation: `Access denied: High-level preparation volume overrides must be proposed by the Cafeteria Manager.`
      };

    case "draft_surplus_alert":
      if (role === UserRole.CAFETERIA_MANAGER || role === UserRole.PLATFORM_ADMINISTRATOR) {
        return {
          granted: true,
          explanation: `Access granted: Cafeteria Managers are authorized to draft pre-emptive surplus alerts.`
        };
      }
      return {
        granted: false,
        explanation: `Access denied: Standard surplus drafting triggers are restricted to the Cafeteria Manager in charge of active meals.`
      };

    case "propose_partner_selection":
      if (role === UserRole.CAFETERIA_MANAGER || role === UserRole.PLATFORM_ADMINISTRATOR || role === UserRole.RECOVERY_PARTNER_COORDINATOR) {
        return {
          granted: true,
          explanation: `Access granted: User handles surplus routing options.`
        };
      }
      return {
        granted: false,
        explanation: `Access denied: Surplus destination rerouting requires operational coordination roles.`
      };

    case "propose_alert_cancellation":
      if (role === UserRole.CAFETERIA_MANAGER || role === UserRole.PLATFORM_ADMINISTRATOR || role === UserRole.RECOVERY_PARTNER_COORDINATOR) {
        return {
          granted: true,
          explanation: `Access granted: Alerts can be cancelled when surplus resolves.`
        };
      }
      return {
        granted: false,
        explanation: `Access denied: Only authorized coordinators can propose alert cancellations.`
      };

    // Banned actions (autonomous executions)
    case "execute_action":
    case "approve_proposal":
      return {
        granted: false,
        explanation: `Access blocked: The AI Copilot is strictly prohibited from direct action execution or approving its own proposals. This requires physical Human-in-the-Loop selection.`
      };

    case "delete_audit_logs":
      return {
        granted: false,
        explanation: `Forbidden: Audit trail records are legally immutable and cannot be deleted by any role, including Administrators.`
      };

    case "certify_food_safety":
      return {
        granted: false,
        explanation: `Forbidden: AI cannot issue legal food safety certifications. An authorized human supervisor must confirm checklists on-site.`
      };

    default:
      return {
        granted: false,
        explanation: `Unknown security scope: Tool '${toolName}' does not have a mapped policy entry.`
      };
  }
}
