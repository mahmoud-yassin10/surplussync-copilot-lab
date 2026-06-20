import React, { useState, useEffect, useRef } from "react";
import { 
  UserRole, 
  SchoolDetails, 
  SchoolForecast, 
  RecoveryPartner, 
  AuditEntry, 
  AIActionProposal, 
  StructuredCopilotResponse, 
  EvidenceItem, 
  ProvenanceItem,
  ToolCallDetails
} from "./types";
import { INITIAL_SCHOOL, INITIAL_FORECAST, INITIAL_PARTNERS, INITIAL_AUDIT_LOGS, SIMILAR_HISTORICAL_DAYS } from "./data/mockData";
import { SCENARIOS, Scenario } from "./data/scenarios";
import { checkPermission } from "./copilot/permissionPolicy";
import { INTEGRATION_DOCUMENTATION_MARKDOWN } from "./data/integrationContract";
import { 
  Shield, 
  Users, 
  Award, 
  Database, 
  Send, 
  RotateCcw, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  FileText, 
  Terminal, 
  Search, 
  Activity, 
  ArrowRight,
  Sparkles,
  Info,
  Layers,
  Check,
  Ban,
  UploadCloud,
  Code
} from "lucide-react";

interface ChatMessage {
  id: string;
  sender: "USER" | "AI";
  timestamp: string;
  text: string;
  responseObj?: StructuredCopilotResponse;
  isError?: boolean;
}

export default function App() {
  // --- Active Application States ---
  const [activeRole, setActiveRole] = useState<UserRole>(UserRole.CAFETERIA_MANAGER);
  const [school, setSchool] = useState<SchoolDetails>(INITIAL_SCHOOL);
  const [forecast, setForecast] = useState<SchoolForecast>(INITIAL_FORECAST);
  const [partners, setPartners] = useState<RecoveryPartner[]>(INITIAL_PARTNERS);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>(INITIAL_AUDIT_LOGS);
  
  // --- Selected Partner State (for route tracing) ---
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("metro-food-bank");
  // --- Alert Sent Status ---
  const [alertStatus, setAlertStatus] = useState<"DRAFT" | "SENT_PROVISIONAL" | "NONE">("NONE");
  
  // --- Proposal Pool ---
  const [proposals, setProposals] = useState<AIActionProposal[]>([]);
  
  // --- Chat Feed States ---
  const [chatFeed, setChatFeed] = useState<ChatMessage[]>([
    {
      id: "welcome-msg",
      sender: "AI",
      timestamp: new Date().toISOString(),
      text: "Hello! Welcome to the **SurplusSync Copilot Lab**.\n\nI am your auxiliary AI Operations Copilot assistant. My goal is to help you analyze Thursday demand forecasts, simulate different preparation targets, draft partner safety notifications, and coordinate food rescue routes. \n\nI operate under strict safety guidelines: I cannot certify food safety autonomously, make modifications without your explicit approval, or violate our school meal safety floor of **540 meals**.\n\nChoose an active simulation role above or run one of the built-in scenarios below to inspect me in action!",
    }
  ]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [apiConfig, setApiConfig] = useState<{ hasGeminiApiKey: boolean; activePort: number }>({
    hasGeminiApiKey: false,
    activePort: 3000
  });
  const [forceMock, setForceMock] = useState(false);
  
  // --- Right-Side Active Inspector Tab ---
  const [inspectorTab, setInspectorTab] = useState<"tool" | "structured" | "permission" | "transparency" | "proposals" | "audit" | "docs">("transparency");
  
  // --- Last AI Response for Inspections ---
  const [lastAIResponse, setLastAIResponse] = useState<StructuredCopilotResponse | null>(null);
  
  // --- Custom Audit Addition Ref (amendments) ---
  const [correctionText, setCorrectionText] = useState("");
  const [isAddingCorrection, setIsAddingCorrection] = useState(false);
  
  // --- Auto-scroll hook ---
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch server status on mount
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => setApiConfig(data))
      .catch((err) => console.log("Failed to query server config, running with standard local config: ", err));
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatFeed, isLoading]);

  // --- Send message to Copilot Endpoint ---
  const triggerCopilotQuery = async (queryText: string) => {
    if (!queryText.trim() || isLoading) return;

    // Append user's chat bubble
    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: "USER",
      timestamp: new Date().toISOString(),
      text: queryText,
    };
    setChatFeed((prev) => [...prev, userMsg]);
    setInputText("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: queryText,
          role: activeRole,
          currentPlan: school.currentPreparationPlan,
          schoolState: school,
          forecastState: forecast,
          partnersState: partners,
          forceMockMode: forceMock
        }),
      });

      const data = await response.json();
      const payload: StructuredCopilotResponse = data.result;

      // Handle raw tool calls permission status dynamically or inject defaults
      const responseMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: "AI",
        timestamp: new Date().toISOString(),
        text: payload.answer,
        responseObj: payload
      };
      
      setChatFeed((prev) => [...prev, responseMsg]);
      setLastAIResponse(payload);
      
      // Auto-focus relevant tab based on type
      if (payload.answerType === "REFUSAL") {
        setInspectorTab("permission");
      } else if (payload.proposedActions && payload.proposedActions.length > 0) {
        setInspectorTab("proposals");
      } else {
        setInspectorTab("transparency");
      }

      // If the AI response contains a valid action proposal, append it to our local laboratory proposal state pool
      if (payload.proposedActions && payload.proposedActions.length > 0) {
        setProposals((prev) => [...prev, ...payload.proposedActions]);
      }

    } catch (error: any) {
      console.error("API error:", error);
      setChatFeed((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: "AI",
          timestamp: new Date().toISOString(),
          text: `Error contacting the server laboratory. Please review your server logs.`,
          isError: true
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Deterministic Human Approval execution ---
  const handleApproveProposal = (proposal: AIActionProposal) => {
    // 1. Verify role permission constraints before executing
    if (!proposal.requiredApprovals.includes(activeRole)) {
      alert(`Access Denied! Standard regulatory procedures require authorization from a [${proposal.requiredApprovals.join(" or ")}] to approve this action. Your current active role is [${activeRole}]. Please switch roles to proceed.`);
      return;
    }

    // 2. Perform deterministic local state updates based on verified proposal requirements
    const oldSchool = { ...school };
    const oldSelectedPartner = selectedPartnerId;
    const oldAlertStatus = alertStatus;

    if (proposal.actionType === "ATTENDANCE_UPDATE") {
      const targetAtt = proposal.after.expectedAttendance || 540;
      setForecast((prev) => ({
        ...prev,
        expectedAttendance: targetAtt,
        estimatedPreventableSurplus: Math.max(0, school.currentPreparationPlan - prev.recommendedPreparation)
      }));
      // Recalculate deterministic stats
      const predictedMin = Math.round(targetAtt - 31);
      const predictedMax = Math.round(targetAtt + 29);
      setForecast((prev) => ({
        ...prev,
        predictionInterval: { min: predictedMin, max: predictedMax, intervalType: "80% prediction interval" }
      }));
    } 
    else if (proposal.actionType === "PREPARATION_OVERRIDE") {
      const targetPrep = proposal.after.proposedQuantity || 562;
      setSchool((prev) => ({
        ...prev,
        currentPreparationPlan: targetPrep
      }));
    }
    else if (proposal.actionType === "SURPLUS_ALERT") {
      setAlertStatus("SENT_PROVISIONAL");
    }
    else if (proposal.actionType === "PARTNER_SELECTION") {
      const targetPartner = proposal.after.selectedPartnerId || "harbor-shelter";
      setSelectedPartnerId(targetPartner);
    }
    else if (proposal.actionType === "ALERT_CANCELLATION") {
      setAlertStatus("NONE");
    }

    // Update proposal state
    setProposals((prev) => 
      prev.map((p) => p.proposalId === proposal.proposalId ? { ...p, status: "EXECUTED" as any } : p)
    );

    // 3. Create legally immutable audit trail record
    const auditId = `adt-${Date.now().toString().slice(-4)}`;
    const newAudit: AuditEntry = {
      auditId,
      timestamp: new Date().toISOString(),
      actor: activeRole === UserRole.CAFETERIA_MANAGER ? school.cafeteriaManager : school.schoolAdministrator,
      actorType: "HUMAN",
      action: proposal.title,
      role: activeRole,
      proposalId: proposal.proposalId,
      before: proposal.before,
      after: proposal.after,
      reason: proposal.reason,
      permissionDecision: "GRANTED",
      approvalDecision: "APPROVED_BY_USER",
      executionResult: "SUCCESS",
      reversibility: proposal.reversible,
      undoStatus: "NOT_APPLICABLE"
    };

    setAuditLogs((prev) => [newAudit, ...prev]);

    // Append system status confirmation in chat
    const confirmText = `ACTION EXECUTED: Proposal "${proposal.title}" has been verified, authorized by ${activeRole}, and executed successfully. System state updated in-memory. Immutable audit log registered as '${auditId}'.`;
    setChatFeed((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        sender: "AI",
        timestamp: new Date().toISOString(),
        text: confirmText
      }
    ]);
  };

  const handleRejectProposal = (proposal: AIActionProposal) => {
    // Update state to rejected
    setProposals((prev) => 
      prev.map((p) => p.proposalId === proposal.proposalId ? { ...p, status: "REJECTED" as any } : p)
    );

    // Log the human rejection
    const newAudit: AuditEntry = {
      auditId: `adt-rej-${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toISOString(),
      actor: activeRole === UserRole.CAFETERIA_MANAGER ? school.cafeteriaManager : school.schoolAdministrator,
      actorType: "HUMAN",
      action: `Rejected proposal: ${proposal.title}`,
      role: activeRole,
      proposalId: proposal.proposalId,
      before: proposal.before,
      after: null,
      reason: "User cancelled proposal in approval gate workspace.",
      permissionDecision: "GRANTED",
      approvalDecision: "REJECTED_BY_USER",
      executionResult: "CANCELLED",
      reversibility: false,
    };

    setAuditLogs((prev) => [newAudit, ...prev]);
  };

  // --- Real Reversible State Undo ---
  const handleUndoAudit = (audit: AuditEntry) => {
    // Find the original before parameters
    if (!audit.before || !audit.proposalId) return;

    // Check which proposal it maps to and revert corresponding states deterministically
    const targetProposal = proposals.find((p) => p.proposalId === audit.proposalId);
    if (!targetProposal) return;

    if (targetProposal.actionType === "ATTENDANCE_UPDATE") {
      const prevAtt = audit.before.expectedAttendance || 468;
      setForecast((prev) => ({
        ...prev,
        expectedAttendance: prevAtt
      }));
    }
    else if (targetProposal.actionType === "PREPARATION_OVERRIDE") {
      const prevPrep = audit.before.currentPreparationPlan || 730;
      setSchool((prev) => ({ ...prev, currentPreparationPlan: prevPrep }));
    }
    else if (targetProposal.actionType === "SURPLUS_ALERT") {
      setAlertStatus("NONE");
    }
    else if (targetProposal.actionType === "PARTNER_SELECTION") {
      const prevPartner = audit.before.selectedPartnerId || "metro-food-bank";
      setSelectedPartnerId(prevPartner);
    }

    // Set audit status to reversed
    setAuditLogs((prev) => 
      prev.map((a) => a.auditId === audit.auditId ? { ...a, undoStatus: "REVERSED" as const } : a)
    );

    // Also update proposal state
    setProposals((prev) => 
      prev.map((p) => p.proposalId === audit.proposalId ? { ...p, status: "UNDONE" as any } : p)
    );

    const undoMsg = `UNDO TRIGGERED: Action "${audit.action}" has been completely reverted. Previous state values restored. Reversal registered under audit ID '${audit.auditId}'.`;
    setChatFeed((prev) => [
      ...prev,
      {
        id: `sys-undo-${Date.now()}`,
        sender: "AI",
        timestamp: new Date().toISOString(),
        text: undoMsg
      }
    ]);
  };

  // --- Add explanatory correction (Amendment) to immutable logs ---
  const handleAddAuditCorrection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionText.trim()) return;

    const newAudit: AuditEntry = {
      auditId: `adt-cor-${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toISOString(),
      actor: activeRole === UserRole.CAFETERIA_MANAGER ? school.cafeteriaManager : school.schoolAdministrator,
      actorType: "HUMAN",
      action: "REGISTER AMENDMENT CORRECTION",
      role: activeRole,
      before: null,
      after: null,
      reason: correctionText,
      permissionDecision: "GRANTED",
      approvalDecision: "BYPASSED",
      executionResult: "SUCCESS",
      reversibility: false,
    };

    setAuditLogs((prev) => [newAudit, ...prev]);
    setCorrectionText("");
    setIsAddingCorrection(false);
  };

  const runScenarioDirectly = (scenario: Scenario) => {
    triggerCopilotQuery(scenario.request);
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] font-sans flex flex-col antialiased">
      {/* --- Top Global Header --- */}
      <header className="border-b border-[#21262d] bg-[#161b22] px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shrink-0 shadow-md">
        <div className="flex items-center gap-3">
          <div className="bg-violet-900/40 border border-violet-500/50 p-2.5 rounded-lg flex items-center justify-center shadow-inner">
            <Layers className="text-violet-400 w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white flex items-center gap-2">
              SurplusSync Copilot Lab <span className="text-xs bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-800 font-normal">Active Laboratory</span>
            </h1>
            <p className="text-xs text-[#8b949e]">USAII Global AI Hackathon 2026 — High School Track — Environment Category</p>
          </div>
        </div>

        {/* --- Global Model State Telemetry --- */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Key status indicator */}
          <div className="bg-black/40 border border-[#30363d] px-3 py-1.5 rounded-md flex items-center gap-2 text-xs">
            <span className={`w-2.5 h-2.5 rounded-full ${apiConfig.hasGeminiApiKey ? "bg-emerald-500" : "bg-amber-500 animate-ping"}`} />
            <span className="text-[#8b949e]">Key Access:</span>
            <span className="font-mono text-white">
              {apiConfig.hasGeminiApiKey ? "API KEY CONFIGURED" : "NO KEY - MOCK MODE ACTIVE"}
            </span>
          </div>

          <div className="flex items-center bg-[#21262d] rounded-md p-1 border border-[#30363d] text-xs">
            <button
              onClick={() => setForceMock(false)}
              disabled={!apiConfig.hasGeminiApiKey}
              className={`px-3 py-1 rounded transition-all duration-200 ${
                !forceMock && apiConfig.hasGeminiApiKey
                  ? "bg-violet-600 text-white font-medium"
                  : "text-[#8b949e] hover:text-[#c9d1d9] disabled:opacity-50"
              }`}
            >
              Gemini Mode
            </button>
            <button
              onClick={() => setForceMock(true)}
              className={`px-3 py-1 rounded transition-all duration-200 ${
                forceMock || !apiConfig.hasGeminiApiKey
                  ? "bg-amber-600 text-white font-medium"
                  : "text-[#8b949e] hover:text-[#c9d1d9]"
              }`}
            >
              Mock Fallback
            </button>
          </div>
        </div>
      </header>

      {/* --- User Role Interactive Selector --- */}
      <section className="bg-[#161b22] px-6 py-2 border-b border-[#21262d] flex flex-wrap items-center gap-3 text-xs">
        <span className="text-amber-400 font-medium flex items-center gap-1">
          <Shield className="w-3.5 h-3.5" /> SELECT YOUR SECURITY ROLE:
        </span>
        <div className="flex flex-wrap gap-2 py-1">
          {Object.values(UserRole).map((role) => (
            <button
              key={role}
              onClick={() => setActiveRole(role)}
              className={`px-3 py-1.5 rounded-full border text-xs cursor-pointer font-medium transition-all ${
                activeRole === role
                  ? "bg-amber-500/10 border-amber-500/60 text-amber-300"
                  : "bg-transparent border-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] hover:border-[#8b949e]"
              }`}
            >
              {role.replace("_", " ")}
            </button>
          ))}
        </div>
      </section>

      {/* --- Three-Column Lab Environment --- */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 p-5 bg-[#0d1117] select-none overflow-y-auto">
        
        {/* =======================================================
            1) LEFT COLUMN: OPERATIONAL CONTEXT (lg:span-3)
            ======================================================= */}
        <section id="operational-context" className="lg:col-span-3 flex flex-col gap-4">
          
          {/* Fictional Campus State */}
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#21262d] pb-2 mb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-400" /> Demo Headquarters
              </h3>
              <span className="text-[10px] bg-blue-950/40 text-blue-400 border border-blue-900 px-2 py-0.5 rounded font-mono">USA-East</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-[#0d1117] p-2.5 rounded-lg border border-[#21262d]">
                <div className="text-[#8b949e] font-medium">U.S. Demonstration School</div>
                <div className="font-semibold text-white text-sm mt-0.5">{school.name}</div>
                <div className="text-[11px] text-blue-400/90 mt-1">{school.location}</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#0d1117] p-2 rounded-lg border border-[#21262d]">
                  <span className="text-[11px] text-[#8b949e]">Registered</span>
                  <div className="text-sm font-semibold text-white">{school.registeredStudents} students</div>
                </div>
                <div className="bg-[#0d1117] p-2 rounded-lg border border-[#21262d]">
                  <span className="text-[11px] text-[#8b949e]">Meal Eligible</span>
                  <div className="text-sm font-semibold text-white">{school.mealEligibleStudents} students</div>
                </div>
              </div>

              <div className="bg-[#0d1117] p-2.5 rounded-md border border-[#21262d] flex items-center justify-between">
                <span className="text-[#8b949e]">Cafeteria Manager:</span>
                <span className="font-medium text-white">{school.cafeteriaManager}</span>
              </div>
              <div className="bg-[#0d1117] p-2.5 rounded-md border border-[#21262d] flex items-center justify-between">
                <span className="text-[#8b949e]">Administrator:</span>
                <span className="font-medium text-white">{school.schoolAdministrator}</span>
              </div>
            </div>
          </div>

          {/* Operational Variables & Forecasts */}
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4 shadow-sm flex-1">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 border-b border-[#21262d] pb-2 mb-3">
              <Activity className="w-4 h-4 text-emerald-400" /> Operational Parameters
            </h3>

            <div className="space-y-4 text-xs">
              {/* Date selection telemetry */}
              <div className="flex items-center justify-between bg-[#161b30]/30 border border-violet-900/40 p-2.5 rounded-lg">
                <span className="text-violet-300 font-medium">Selected Lab Target Date</span>
                <span className="font-mono text-white text-sm font-semibold">2026-06-25 (Thursday)</span>
              </div>

              {/* Attendance parameter */}
              <div className="bg-[#0d1117] p-3 rounded-lg border border-[#21262d]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#8b949e] font-medium">Expected Attendance</span>
                  <span className="text-[10px] bg-blue-950 text-blue-400 px-1.5 py-0.2 rounded font-mono border border-blue-800">PREDICTED MODEL INPUT</span>
                </div>
                <div className="text-xl font-bold text-white tracking-tight flex items-baseline gap-1.5">
                  {forecast.expectedAttendance} <span className="text-xs text-[#8b949e] font-normal">students</span>
                </div>
                <div className="text-[11px] text-gray-400 mt-1 italic">
                  80% Prediction interval: {forecast.predictionInterval.min} - {forecast.predictionInterval.max} students
                </div>
              </div>

              {/* Meal target */}
              <div className="bg-[#0d1117] p-3 rounded-lg border border-[#21262d]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#8b949e] font-medium">Current Prep Plan Target</span>
                  <span className="text-[10px] bg-emerald-950 text-emerald-400 px-1.5 py-0.2 rounded font-mono border border-emerald-900">ACTIVE STATE</span>
                </div>
                <div className="text-xl font-bold text-emerald-400 tracking-tight flex items-baseline gap-1.5">
                  {school.currentPreparationPlan} <span className="text-xs text-emerald-500/80 font-normal">meals</span>
                </div>
                <div className="text-[11px] text-[#8b949e] mt-1">
                  Normal Default Target: <span className="text-white">{school.regularDailyPreparation} meals</span> | Safety Floor: <span className="text-white">{school.safetyFloorCount}</span>
                </div>
                {school.currentPreparationPlan !== school.regularDailyPreparation && (
                  <div className="mt-2 text-[10px] bg-emerald-950/60 border border-emerald-900/50 p-1.5 rounded text-emerald-300">
                    * Human override approved in laboratory records
                  </div>
                )}
              </div>

              {/* Prevented surplus display */}
              <div className="bg-[#0d1117] p-2.5 rounded-lg border border-[#21262d] flex justify-between items-center bg-teal-950/10 border-teal-900/30">
                <span className="text-[#8b949e]">Prevented Surplus (Untouched)</span>
                <span className="font-semibold text-teal-400 font-mono">
                  {Math.max(0, school.regularDailyPreparation - school.currentPreparationPlan)} meals
                </span>
              </div>

              {/* Selected Route tracker display */}
              <div className="bg-[#0d1117] p-3 rounded-lg border border-[#21262d]">
                <span className="text-[#8b949e] text-[11px]">Selected Destination Route</span>
                <div className="mt-1 font-semibold text-white flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  {partners.find((p) => p.id === selectedPartnerId)?.name || "Not Selected"}
                </div>
                <div className="mt-1 text-[11px] text-blue-400">
                  Distance: {partners.find((p) => p.id === selectedPartnerId)?.distanceMiles} miles
                </div>
              </div>

              {/* Provisional Alert status tracker */}
              <div className="bg-[#0d1117] p-3 rounded-lg border border-[#21262d] flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-[#8b949e]">Provisional alert trigger</span>
                  <div className="font-semibold text-white mt-0.5">
                    {alertStatus === "NONE" ? "DRAFT (NOT YET SENT)" : "BROADCAST ACTIVE"}
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono border ${
                  alertStatus === "NONE" 
                    ? "bg-[#21262d] text-[#8b949e] border-[#30363d]" 
                    : "bg-emerald-950/80 text-emerald-400 border-emerald-800"
                }`}>
                  {alertStatus === "NONE" ? "None" : "Sent"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* =======================================================
            2) CENTER COLUMN: COPILOT WORKSPACE (lg:span-5)
            ======================================================= */}
        <section id="copilot-workspace" className="lg:col-span-5 flex flex-col gap-4">
          
          {/* Chat Panel Box */}
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl flex-1 flex flex-col overflow-hidden shadow-lg h-[460px]">
            {/* Header */}
            <div className="border-b border-[#21262d] bg-[#161b22] px-4 py-3 flex items-center justify-between text-xs font-semibold">
              <span className="text-white flex items-center gap-2">
                <Sparkles className="text-violet-400 w-4 h-4" /> AI Operations Copilot
              </span>
              <span className="text-violet-400 bg-violet-950 px-2.5 py-0.5 rounded-full border border-violet-800 tracking-wide">
                MODEL: gemini-3.5-flash
              </span>
            </div>

            {/* Chat Messages Feed */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 font-normal text-sm leading-relaxed scrollbar-thin scrollbar-thumb-gray-800">
              {chatFeed.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.sender === "USER" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 border ${
                    msg.sender === "USER"
                      ? "bg-violet-950/50 border-violet-800/80 text-[#e6edf3]"
                      : msg.isError
                        ? "bg-red-950/40 border-red-900/60 text-red-300"
                        : "bg-[#0d1117] border-[#21262d] text-[#e6edf3]"
                  }`}>
                    {/* Prefix label for compliance visibility */}
                    <div className="text-[10px] text-[#8b949e] mb-1 font-mono uppercase tracking-wider flex items-center justify-between">
                      <span>{msg.sender === "USER" ? `You (${activeRole.replace("_", " ")})` : "SurplusSync Copilot AI"}</span>
                      <span>{msg.timestamp.slice(11, 19)}</span>
                    </div>
                    
                    {/* Text Body parsed with bold highlights */}
                    <div className="whitespace-pre-wrap select-text selection:bg-violet-700 font-sans">
                      {msg.text.split("**").map((chunk, idx) => 
                        idx % 2 === 1 ? <strong key={idx} className="text-white font-semibold">{chunk}</strong> : chunk
                      )}
                    </div>

                    {/* Render embedded Action Proposal inside Chat Feed if available */}
                    {msg.responseObj && msg.responseObj.proposedActions && msg.responseObj.proposedActions.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-[#21262d]">
                        {msg.responseObj.proposedActions.map((proposal) => (
                          <div key={proposal.proposalId} className="bg-[#161b22] border border-amber-500/40 rounded-xl p-3 shadow-inner">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs font-semibold text-amber-300 flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 animate-pulse" /> PENDING PROPOSAL GENERATION
                              </span>
                            </div>
                            <h4 className="text-xs font-bold text-white mb-1 uppercase">{proposal.title}</h4>
                            <p className="text-[11px] text-gray-300 mb-2">{proposal.summary}</p>
                            
                            <div className="grid grid-cols-2 gap-2 text-[10px] mb-2 font-mono">
                              <div className="bg-black/30 p-1 rounded">
                                <span className="text-[#8b949e]">PREVIOUS:</span>
                                <div className="text-white font-medium">{JSON.stringify(proposal.before)}</div>
                              </div>
                              <div className="bg-black/30 p-1 rounded">
                                <span className="text-[#8b949e]">PROPOSED:</span>
                                <div className="text-white font-semibold">{JSON.stringify(proposal.after)}</div>
                              </div>
                            </div>

                            <div className="text-[10px] text-gray-400 italic mb-2">
                              Required approval authority: <span className="text-white font-semibold">{proposal.requiredApprovals.join(", ")}</span>
                            </div>

                            {/* Human-in-the-loop actions */}
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleApproveProposal(proposal)}
                                className="flex-1 bg-emerald-600/95 hover:bg-emerald-700 active:bg-emerald-800 text-white font-semibold text-xs py-1 px-2.5 rounded transition duration-150 cursor-pointer shadow-sm shadow-emerald-950/20"
                              >
                                Approve & Execute
                              </button>
                              <button
                                onClick={() => handleRejectProposal(proposal)}
                                className="bg-[#21262d] hover:bg-red-950 text-xs text-red-400 py-1 px-2.5 rounded border border-[#30363d] cursor-pointer"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat Input Area */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                triggerCopilotQuery(inputText);
              }}
              className="border-t border-[#21262d] bg-[#161b22] p-3 flex gap-2"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ask SurplusSync Copilot..."
                className="flex-1 bg-[#0d1117] border border-[#21262d] focus:border-violet-500/80 focus:ring-1 focus:ring-violet-500 rounded-lg px-3.5 py-2 text-sm text-[#e6edf3] placeholder-[#8b949e] outline-none"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading}
                className="bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white p-2 rounded-lg cursor-pointer transition disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-t-transparent border-white rounded-full animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </form>
          </div>

          {/* Built-in Scenario Launcher */}
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4 shadow-sm">
            <h3 className="text-xs font-bold text-amber-400 tracking-wider uppercase mb-2">
              Laboratory Scenario Launcher
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 overflow-x-auto select-none">
              {SCENARIOS.map((scen) => (
                <button
                  key={scen.id}
                  onClick={() => runScenarioDirectly(scen)}
                  className="px-2 py-1.5 transition text-left cursor-pointer hover:bg-violet-950/20 rounded-md border border-[#21262d] hover:border-violet-800 text-[11px] group text-[#8b949e] hover:text-[#e6edf3] font-normal"
                  title={`${scen.title}\n\nBehavior: ${scen.expectedBehavior}`}
                >
                  <div className="font-semibold text-white group-hover:text-violet-300 text-[10px] truncate">{scen.title.split(":")[1].trim()}</div>
                  <div className="text-[9px] text-[#8b949e] mt-0.5 line-clamp-1">{scen.category}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* =======================================================
            3) RIGHT COLUMN: INSPECTOR & GOVERNANCE (lg:span-4)
            ======================================================= */}
        <section id="inspector-tabs" className="lg:col-span-4 flex flex-col gap-4">
          
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4 flex-1 flex flex-col overflow-hidden shadow-lg h-[500px]">
            {/* Tab Controls Navigation */}
            <div className="flex border-b border-[#21262d] pb-2 overflow-x-auto gap-1 text-[11px] font-semibold shrink-0">
              <button
                onClick={() => setInspectorTab("transparency")}
                className={`px-2.5 py-1.5 rounded-t-md transition ${inspectorTab === "transparency" ? "bg-[#21262d] text-white border border-[#21262d] border-b-transparent" : "text-[#8b949e] hover:text-white"}`}
              >
                Transparency
              </button>
              <button
                onClick={() => setInspectorTab("proposals")}
                className={`px-2.5 py-1.5 rounded-t-md transition relative ${inspectorTab === "proposals" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-white"}`}
              >
                Proposals
                {proposals.filter((p) => p.status === "PENDING_APPROVAL").length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-amber-500 text-black font-extrabold w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] border border-black animate-bounce" />
                )}
              </button>
              <button
                onClick={() => setInspectorTab("permission")}
                className={`px-2.5 py-1.5 rounded-t-md transition ${inspectorTab === "permission" ? "bg-[#21262d] text-white animate-pulse" : "text-[#8b949e] hover:text-white"}`}
              >
                Permissions
              </button>
              <button
                onClick={() => setInspectorTab("tool")}
                className={`px-2.5 py-1.5 rounded-t-md transition ${inspectorTab === "tool" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-white"}`}
              >
                Tools
              </button>
              <button
                onClick={() => setInspectorTab("audit")}
                className={`px-2.5 py-1.5 rounded-t-md transition ${inspectorTab === "audit" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-white"}`}
              >
                Audit Log
              </button>
              <button
                onClick={() => setInspectorTab("docs")}
                className={`px-2.5 py-1.5 rounded-t-md transition ${inspectorTab === "docs" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-white"}`}
              >
                Docs
              </button>
            </div>

            {/* Tab Panels */}
            <div className="flex-1 overflow-y-auto mt-3 text-xs">
              
              {/* === TRANSPARENCY PANEL === */}
              {inspectorTab === "transparency" && (
                <div className="space-y-3">
                  <h4 className="font-bold text-white uppercase text-[11px] pb-1 border-b border-[#21262d]">Copilot Traceability Parameters</h4>
                  
                  {lastAIResponse ? (
                    <div className="space-y-3">
                      <div className="bg-[#0d1117] p-2.5 rounded border border-[#21262d]">
                        <span className="text-[#8b949e] font-medium font-mono text-[9px] uppercase tracking-wider">Estimated Model Uncertainty</span>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            lastAIResponse.uncertainty.level === "HIGH" ? "bg-red-950 text-red-300 border border-red-900" :
                            lastAIResponse.uncertainty.level === "MODERATE" ? "bg-amber-950 text-amber-300 border border-amber-900" :
                            "bg-emerald-950 text-emerald-300 border border-emerald-900"
                          }`}>
                            {lastAIResponse.uncertainty.level} RISK UNCERTAINTY
                          </span>
                        </div>
                        <p className="mt-1.5 text-gray-300 leading-relaxed italic">"{lastAIResponse.uncertainty.explanation}"</p>
                      </div>

                      <div className="bg-[#0d1117] p-2.5 rounded border border-[#21262d]">
                        <span className="text-[#8b949e] font-mono text-[9px] uppercase">Data Provenance & Trust Labels</span>
                        <div className="space-y-1.5 mt-2">
                          {lastAIResponse.provenance.map((prov, i) => (
                            <div key={i} className="flex justify-between items-center bg-[#161b22] px-2 py-1 rounded">
                              <span className="text-[#c9d1d9] font-medium">{prov.source}</span>
                              <span className="text-[9px] uppercase font-mono text-blue-400 font-semibold">{prov.status}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-[#0d1117] p-2.5 rounded border border-[#21262d]">
                        <span className="text-[#8b949e] font-mono text-[9px] uppercase">Operational Limitations Warning</span>
                        <ul className="list-disc list-inside mt-1.5 space-y-1 text-gray-400 pl-1 leading-normal">
                          {lastAIResponse.limitations.map((lim, i) => (
                            <li key={i}>{lim}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="bg-[#0d1117] p-2.5 rounded border border-[#21262d]">
                        <span className="text-[#8b949e] font-mono text-[9px] uppercase">Model Evidence Retrieved</span>
                        <div className="space-y-1 mt-1.5">
                          {lastAIResponse.evidence.map((ev, i) => (
                            <div key={i} className="text-[11px] flex justify-between dev-data-row border-b border-gray-900 py-1">
                              <span className="text-gray-300 font-sans">{ev.label}:</span>
                              <span className="font-semibold text-white font-mono">{ev.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-[#8b949e] italic">
                      No query submitted this turn. Trigger a scenario launcher or type a question to inspect model confidence vectors here.
                    </div>
                  )}
                </div>
              )}

              {/* === ACTION PROPOSALS GRID === */}
              {inspectorTab === "proposals" && (
                <div className="space-y-3">
                  <h4 className="font-bold text-white uppercase text-[11px] pb-1 border-b border-[#21262d]">Human Approval Workspace</h4>
                  
                  {proposals.length > 0 ? (
                    <div className="space-y-3">
                      {proposals.slice().reverse().map((prop, index) => (
                        <div key={prop.proposalId || index} className={`p-3 rounded-lg border ${
                          prop.status === "PENDING_APPROVAL" 
                            ? "bg-amber-950/10 border-amber-500/40" 
                            : prop.status === "EXECUTED" 
                              ? "bg-emerald-950/20 border-emerald-900/40" 
                              : "bg-[#21262d]/50 border-[#30363d]"
                        }`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-mono font-bold text-blue-400">{prop.actionType}</span>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-mono uppercase font-bold tracking-wide ${
                              prop.status === "PENDING_APPROVAL" ? "bg-amber-500/20 text-amber-300" :
                              prop.status === "EXECUTED" ? "bg-emerald-500/20 text-emerald-300" : "bg-gray-800 text-gray-400"
                            }`}>
                              {prop.status}
                            </span>
                          </div>
                          <div className="font-bold text-white mb-1">{prop.title}</div>
                          <p className="text-gray-300 text-[11px] mb-2 leading-relaxed">{prop.summary}</p>
                          
                          {prop.status === "PENDING_APPROVAL" && (
                            <div className="mt-2.5 p-2 bg-black/40 rounded border border-[#30363d] space-y-1">
                              <div className="text-[10px] text-gray-400">
                                Required Role Approval: <span className="text-amber-300 font-bold">{prop.requiredApprovals.join(", ")}</span>
                              </div>
                              <div className="flex gap-2 pt-1.5">
                                <button
                                  onClick={() => handleApproveProposal(prop)}
                                  className="bg-emerald-600 font-semibold px-2 py-1 rounded text-white flex-1 hover:bg-emerald-700 cursor-pointer text-[11px]"
                                >
                                  Approve & Execute
                                </button>
                                <button
                                  onClick={() => handleRejectProposal(prop)}
                                  className="bg-[#21262d] px-2 py-1 rounded text-red-400 hover:bg-red-950 text-[11px] border border-[#30363d] cursor-pointer"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-[#8b949e] italic">
                      Zero operational action proposals generated. Trigger Scenario 3, Scenario 6, or Scenario 8 to spawn actionable workflows.
                    </div>
                  )}
                </div>
              )}

              {/* === PERMISSION WORKSPACE === */}
              {inspectorTab === "permission" && (
                <div className="space-y-3">
                  <h4 className="font-bold text-white uppercase text-[11px] pb-1 border-b border-[#21262d]">Security Guard Sandbox</h4>
                  
                  <div className="bg-[#0d1117] p-3 rounded border border-[#21262d] space-y-3.5">
                    <div className="flex justify-between items-center bg-[#161b22] p-2 rounded">
                      <span>Active Monitored Session Role:</span>
                      <span className="font-mono text-amber-300 font-bold bg-amber-950 px-2 py-0.5 rounded border border-amber-900">{activeRole}</span>
                    </div>

                    <div className="border-t border-[#21262d] pt-3">
                      <h5 className="font-semibold text-white mb-1.5 uppercase text-[10px] text-gray-400">Policy Constraints Checked On Server</h5>
                      <div className="space-y-2">
                        <div className="flex items-start gap-2 text-[11px] bg-black/30 p-2 rounded">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="text-white font-bold">Safety Floor Rule:</span> Must prepare at least 540 meals to maintain critical school reserves.
                          </div>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] bg-black/30 p-2 rounded">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="text-white font-bold">Autonomous Immutability:</span> Model must fail-fast and refuse requests to delete audit records.
                          </div>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] bg-[#221515] p-2 rounded border border-red-900/30">
                          <Ban className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="text-red-300 font-bold">Uncertified Food Safety Refusal:</span> AI lacks physical verification and must refuse consumption certification.
                          </div>
                        </div>
                      </div>
                    </div>

                    {lastAIResponse && lastAIResponse.toolCalls && lastAIResponse.toolCalls.length > 0 && (
                      <div className="border-t border-[#21262d] pt-3">
                        <h5 className="font-semibold text-white mb-1 text-[10px] uppercase">Active Command Evaluation</h5>
                        {lastAIResponse.toolCalls.map((tc, idx) => (
                          <div key={idx} className="bg-[#161b22] p-2.5 rounded border border-[#30363d] space-y-1">
                            <div className="flex justify-between font-mono text-[10px]">
                              <span className="text-[#8e99a8]">{tc.toolName}</span>
                              <span className={tc.permissionPassed ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                                {tc.permissionPassed ? "GRANTED" : "DENIED"}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1 italic">"{tc.permissionExplanation}"</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* === TOOL INTERNALS INSPECTOR === */}
              {inspectorTab === "tool" && (
                <div className="space-y-3">
                  <h4 className="font-bold text-white uppercase text-[11px] pb-1 border-b border-[#21262d]">Active Tool Diagnostics</h4>
                  
                  {lastAIResponse && lastAIResponse.toolCalls && lastAIResponse.toolCalls.length > 0 ? (
                    <div className="space-y-2.5">
                      {lastAIResponse.toolCalls.map((tc, idx) => (
                        <div key={idx} className="bg-[#0d1117] p-2.5 rounded border border-[#21262d] space-y-2">
                          <div className="font-mono text-xs text-violet-300 flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <Terminal className="w-3.5 h-3.5 text-blue-400" /> {tc.toolName}
                            </span>
                            <span className="text-[9px] bg-[#1f242c] px-2 py-0.5 text-gray-400 rounded">Function Declaration</span>
                          </div>
                          
                          <div className="space-y-1.5">
                            <div className="text-[10px] text-[#8b949e] uppercase font-mono">Arguments Transmitted:</div>
                            <pre className="p-2 bg-black/60 rounded text-[10px] font-mono text-emerald-400 overflow-x-auto text-wrap">
                              {JSON.stringify(tc.arguments, null, 2)}
                            </pre>
                          </div>

                          <div className="space-y-1 border-t border-gray-900 pt-2 text-[10px] leading-relaxed">
                            <div className="flex justify-between">
                              <span className="text-gray-400">Mutates Database Directly:</span>
                              <span className="font-medium text-white">{tc.mutatedState ? "True (UNSAFE - PROHIBITED)" : "False (PROPOSAL SAFE)"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Human Approval Prerequisite:</span>
                              <span className="font-medium text-white">{tc.requiresApproval ? "Yes (BLOCK GUARD)" : "No (READ ONLY)"}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-[#8b949e] italic">
                      Zero model-level function callbacks captured this turn.
                    </div>
                  )}

                  {/* Collapsed Raw JSON Inspector */}
                  {lastAIResponse && (
                    <div className="border-t border-[#21262d] pt-3 mt-3">
                      <details className="cursor-pointer group">
                        <summary className="text-[11px] text-violet-400 font-semibold uppercase flex items-center justify-between">
                          <span>Inspect Full Raw Structured Output</span>
                          <span className="text-gray-400 group-open:rotate-180 transition">&#9662;</span>
                        </summary>
                        <pre className="p-2 bg-black/70 rounded text-[10px] font-mono text-amber-500 overflow-x-auto mt-2 leading-relaxed text-wrap">
                          {JSON.stringify(lastAIResponse, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              )}

              {/* === AUDIT LOG TIMELINE === */}
              {inspectorTab === "audit" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#21262d] pb-1">
                    <h4 className="font-bold text-white uppercase text-[11px]">Audit History Log (Immutable)</h4>
                    <button
                      onClick={() => setIsAddingCorrection(true)}
                      className="text-[10px] text-amber-400 bg-amber-950/40 hover:bg-amber-900 border border-amber-900/60 px-2 py-0.5 rounded cursor-pointer"
                    >
                      File Correction
                    </button>
                  </div>

                  {/* Manual correction logger form */}
                  {isAddingCorrection && (
                    <form onSubmit={handleAddAuditCorrection} className="bg-[#0D1117] p-2.5 rounded border border-amber-500/50 space-y-2 animate-fade-in">
                      <div className="text-[10px] text-amber-300 font-semibold uppercase">Register Explanation Amendment</div>
                      <textarea
                        value={correctionText}
                        onChange={(e) => setCorrectionText(e.target.value)}
                        placeholder="State your operational corrections or notes..."
                        className="w-full h-14 bg-black/40 text-xs p-1.5 border border-[#30363d] focus:border-amber-500 rounded outline-none text-[#e6edf3]"
                      />
                      <div className="flex justify-end gap-1.5 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setIsAddingCorrection(false)}
                          className="px-2 py-1 text-gray-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2 py-1 rounded cursor-pointer"
                        >
                          Append Statement
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-3 mt-2 pr-1.5 scrollbar-thin">
                    {auditLogs.map((log) => (
                      <div key={log.auditId} className="bg-[#0d1117] p-2.5 rounded border border-[#21262d] space-y-1.5 text-[11px]">
                        <div className="flex justify-between items-center bg-[#161b22] px-2 py-1 rounded">
                          <span className="font-mono text-gray-400 text-[10px]">{log.auditId}</span>
                          <span className="text-[9px] text-[#8b949e]">{log.timestamp.slice(11, 19)}</span>
                        </div>
                        
                        <div className="space-y-1 leading-normal pl-1 text-[#c9d1d9]">
                          <div>
                            <span className="text-[#8b949e]">Actor:</span> <span className="text-white font-semibold">{log.actor}</span> ({log.role?.replace("_", " ") || "SYSTEM"})
                          </div>
                          <div>
                            <span className="text-[#8b949e]">Action:</span> <span className="text-white font-semibold">{log.action}</span>
                          </div>
                          {log.reason && (
                            <div className="text-gray-450 italic mt-0.5 text-[#8b949e]">
                              &ldquo;{log.reason}&rdquo;
                            </div>
                          )}
                        </div>

                        {/* Audit verification tag */}
                        <div className="flex justify-between items-center text-[10px] border-t border-gray-900 pt-1.5 pl-1 shrink-0">
                          <span className="text-emerald-400 font-semibold font-mono">&#10004; VERIFIED AUDIT</span>
                          
                          {/* Reversible Action controls */}
                          {log.reversibility && (
                            log.undoStatus === "REVERSED" ? (
                              <span className="text-amber-400 italic font-mono">[REVERSED]</span>
                            ) : (
                              <button
                                onClick={() => handleUndoAudit(log)}
                                className="text-sky-400 hover:text-sky-300 font-bold bg-[#161b22] px-2 py-0.5 rounded border border-[#30363d] cursor-pointer flex items-center gap-1"
                              >
                                <RotateCcw className="w-2.5 h-2.5" /> Revert State (Undo)
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* === INTEGRATION CONTRACT === */}
              {inspectorTab === "docs" && (
                <div className="space-y-3">
                  <h4 className="font-bold text-white uppercase text-[11px] pb-1 border-b border-[#21262d]">Developers Integration Contract</h4>
                  <div className="bg-[#0d1117] p-3 rounded border border-[#21262d] text-gray-300 font-normal prose prose-invert overflow-x-auto text-[11px] leading-relaxed select-text space-y-3 font-mono">
                    <div className="bg-[#1c222b] p-2 rounded text-[10px] text-amber-300 border border-amber-900/50">
                      * This JSON integration payload maps directly to structural layouts inside SurplusSync dashboards.
                    </div>
                    <pre className="text-wrap whitespace-pre text-[9px] text-gray-400">
                      {INTEGRATION_DOCUMENTATION_MARKDOWN}
                    </pre>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Recovery Partners Capacity Panel */}
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4 shadow-sm flex-1 flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center justify-between border-b border-[#21262d] pb-2 mb-3">
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-400" /> Rescue Network
                </span>
                <span className="text-xs text-[#8b949e] font-sans font-normal">Ranked by score</span>
              </h3>

              <div className="space-y-2.5 select-none overflow-y-auto max-h-[160px] pr-1.5 scrollbar-thin">
                {partners.map((partner) => {
                  const isRouteSelected = partner.id === selectedPartnerId;
                  return (
                    <div 
                      key={partner.id} 
                      onClick={() => {
                        setSelectedPartnerId(partner.id);
                        // Push log to state
                        const auditId = `adt-sel-${Date.now().toString().slice(-4)}`;
                        const newAudit: AuditEntry = {
                          auditId,
                          timestamp: new Date().toISOString(),
                          actor: activeRole === UserRole.CAFETERIA_MANAGER ? school.cafeteriaManager : school.schoolAdministrator,
                          actorType: "HUMAN",
                          action: `Selected route partner: ${partner.name}`,
                          role: activeRole,
                          before: { selectedPartnerId },
                          after: { selectedPartnerId: partner.id },
                          reason: "Interactive route selector override in laboratory matrix ui.",
                          permissionDecision: "GRANTED",
                          approvalDecision: "APPROVED_BY_USER",
                          executionResult: "SUCCESS",
                          reversibility: true,
                          undoStatus: "NOT_APPLICABLE"
                        };
                        setAuditLogs((prev) => [newAudit, ...prev]);
                      }}
                      className={`p-2.5 rounded-lg border text-xs cursor-pointer transition flex justify-between items-center ${
                        isRouteSelected 
                          ? "bg-blue-950/25 border-blue-500/70" 
                          : "bg-[#0d1117] border-[#21262d] hover:border-gray-700"
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-white flex items-center gap-1">
                          {partner.name}
                          {partner.hasRefrigeratedVehicle && (
                            <span className="text-[10px] bg-sky-950 text-sky-400 px-1 py-0.2 rounded border border-sky-900 font-mono">Cold-Trans</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#8b949e]">
                          Distance: {partner.distanceMiles} miles | Capacity: {partner.capacityMeals} meals
                        </div>
                      </div>

                      <div className="text-right flex items-center gap-2">
                        <div>
                          <div className={`font-mono font-bold ${partner.isAvailable ? "text-emerald-400" : "text-red-400"}`}>
                            {partner.isAvailable ? "Available" : "Closed"}
                          </div>
                          <div className="text-[9px] text-[#8b949e]">Reliability: {(partner.reliabilityScore * 100).toFixed(0)}%</div>
                        </div>
                        <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          isRouteSelected ? "border-blue-400 bg-blue-500/10" : "border-[#30363d]"
                        }`}>
                          {isRouteSelected && <div className="w-2 h-2 rounded-full bg-blue-400" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#21262d] text-[11px] text-[#8b949e] flex items-center gap-1.5 bg-black/40 p-2 rounded-lg">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" /> Selection updates physical delivery routes deterministically in state.
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
