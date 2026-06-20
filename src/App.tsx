import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
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

interface ServerSessionState {
  sessionId: string;
  role: UserRole;
  school: SchoolDetails;
  forecast: SchoolForecast;
  partners: RecoveryPartner[];
  auditLogs: AuditEntry[];
  proposals: AIActionProposal[];
  selectedPartnerId: string;
  alertStatus: "DRAFT" | "SENT_PROVISIONAL" | "NONE";
}

export default function App() {
  // --- Active Application States (rendered from server session snapshot) ---
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
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
  const [apiConfig, setApiConfig] = useState<{ hasGeminiApiKey: boolean; activePort: number; allowForceMock?: boolean }>({
    hasGeminiApiKey: false,
    activePort: 3000,
    allowForceMock: true,
  });
  const [forceMock, setForceMock] = useState(false);

  const [inspectorTab, setInspectorTab] = useState<"tool" | "structured" | "permission" | "transparency" | "proposals" | "audit" | "docs">("transparency");
  const [lastAIResponse, setLastAIResponse] = useState<StructuredCopilotResponse | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [isAddingCorrection, setIsAddingCorrection] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const applySessionState = (state: ServerSessionState) => {
    setActiveRole(state.role);
    setSchool(state.school);
    setForecast(state.forecast);
    setPartners(state.partners);
    setAuditLogs(state.auditLogs);
    setProposals(state.proposals);
    setSelectedPartnerId(state.selectedPartnerId);
    setAlertStatus(state.alertStatus);
  };

  useEffect(() => {
    fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: UserRole.CAFETERIA_MANAGER }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.sessionId && data.state) {
          setSessionId(data.sessionId);
          applySessionState(data.state);
          setSessionReady(true);
        }
      })
      .catch((err) => console.error("Failed to create demo session:", err));

    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => setApiConfig(data))
      .catch((err) => console.log("Failed to query server config: ", err));
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatFeed, isLoading]);

  const handleRoleChange = async (role: UserRole) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/session/${sessionId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (res.ok && data.state) {
        applySessionState(data.state);
      }
    } catch (err) {
      console.error("Failed to update session role:", err);
    }
  };

  // --- Send message to Copilot Endpoint ---
  const triggerCopilotQuery = async (queryText: string) => {
    if (!queryText.trim() || isLoading || !sessionId) return;

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
          sessionId,
          message: queryText,
          ...(apiConfig.allowForceMock && forceMock ? { forceMockMode: true } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Copilot request failed");
      }

      const payload: StructuredCopilotResponse = data.result;
      if (data.state) {
        applySessionState(data.state);
      }

      const responseMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: "AI",
        timestamp: new Date().toISOString(),
        text: payload.answer,
        responseObj: payload,
      };
      
      setChatFeed((prev) => [...prev, responseMsg]);
      setLastAIResponse(payload);
      
      if (payload.answerType === "REFUSAL") {
        setInspectorTab("permission");
      } else if (payload.proposedActions && payload.proposedActions.length > 0) {
        setInspectorTab("proposals");
      } else {
        setInspectorTab("transparency");
      }

    } catch (error: unknown) {
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

  const handleApproveProposal = async (proposal: AIActionProposal) => {
    if (!sessionId) return;

    try {
      const res = await fetch(`/api/session/${sessionId}/proposals/${proposal.proposalId}/approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Approval denied by server policy.");
        return;
      }

      applySessionState(data.state);

      const confirmText = `ACTION EXECUTED: Proposal "${proposal.title}" has been verified, authorized by ${data.state.role}, and executed successfully. System state updated on server. Immutable audit log registered.`;
      setChatFeed((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          sender: "AI",
          timestamp: new Date().toISOString(),
          text: confirmText
        }
      ]);
    } catch (error) {
      console.error("Approval error:", error);
      alert("Failed to reach approval endpoint.");
    }
  };

  const handleRejectProposal = async (proposal: AIActionProposal) => {
    if (!sessionId) return;

    try {
      const res = await fetch(`/api/session/${sessionId}/proposals/${proposal.proposalId}/reject`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Rejection failed.");
        return;
      }
      applySessionState(data.state);
    } catch (error) {
      console.error("Rejection error:", error);
      alert("Failed to reach rejection endpoint.");
    }
  };

  const handlePartnerSelectionRequest = async (partnerId: string) => {
    if (!sessionId || partnerId === selectedPartnerId) return;

    try {
      const res = await fetch(`/api/session/${sessionId}/proposals/partner-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Partner selection requires an approved proposal.");
        return;
      }
      applySessionState(data.state);
      setInspectorTab("proposals");
    } catch (error) {
      console.error("Partner selection error:", error);
      alert("Failed to create partner selection proposal.");
    }
  };

  const handleUndoAudit = (_audit: AuditEntry) => {
    alert("State reversal is not available in P0. Undo will be routed through the server in a later phase.");
  };

  // --- Add explanatory correction (Amendment) to immutable logs ---
  const handleAddAuditCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionText.trim() || !sessionId) return;

    try {
      const res = await fetch(`/api/session/${sessionId}/audit/amendment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: correctionText }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to register audit amendment.");
        return;
      }
      applySessionState(data.state);
      setCorrectionText("");
      setIsAddingCorrection(false);
    } catch (error) {
      console.error("Audit amendment error:", error);
      alert("Failed to reach audit amendment endpoint.");
    }
  };

  const runScenarioDirectly = (scenario: Scenario) => {
    triggerCopilotQuery(scenario.request);
  };

  const formatValue = (obj: any) => {
    if (!obj) return "None";
    if (obj.expectedAttendance !== undefined) return `${obj.expectedAttendance} Students`;
    if (obj.recommendedPreparation !== undefined) return `${obj.recommendedPreparation} Meals (recommended)`;
    if (obj.proposedQuantity !== undefined) return `${obj.proposedQuantity} Meals`;
    if (obj.currentPreparationPlan !== undefined) return `${obj.currentPreparationPlan} Meals`;
    if (obj.selectedPartnerId !== undefined) {
      if (obj.selectedPartnerId === "harbor-shelter") return "Harbor Family Shelter";
      if (obj.selectedPartnerId === "metro-food-bank") return "Metro Food Bank";
      return obj.selectedPartnerId.replace(/-/g, " ").toUpperCase();
    }
    return JSON.stringify(obj);
  };

  const activePendingProposal = proposals.slice().reverse().find((p) => p.status === "PENDING_APPROVAL");

  return (
    <div className="min-h-screen bg-[#070b19] text-[#e2e8f0] font-sans flex flex-col antialiased">
      {/* --- Top Global Header --- */}
      <header className="border-b border-[#1b254a] bg-[#0b0f24] px-6 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shrink-0 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="bg-violet-950/50 border border-violet-500/40 p-2.5 rounded-xl flex items-center justify-center shadow-inner">
            <Layers className="text-violet-400 w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              SurplusSync Copilot Lab 
              <span className="text-xs bg-emerald-950/80 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-850 font-medium">
                Active Research Sandbox
              </span>
            </h1>
            <p className="text-xs text-[#94a3b8] font-semibold">USAII Global AI Hackathon 2026 — High School Track — Environment Platform</p>
          </div>
        </div>

        {/* --- Global Model State Telemetry --- */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-black/35 border border-[#1e2a4f] px-3.5 py-2 rounded-lg flex items-center gap-2 text-xs shadow-inner">
            <span className={`w-2 h-2 rounded-full ${apiConfig.hasGeminiApiKey ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
            <span className="text-[#94a3b8]">Live API Link:</span>
            <span className="font-mono text-slate-100 font-semibold text-[11px]">
              {apiConfig.hasGeminiApiKey ? "GEMINI SECURED" : "MOCK FALLBACK"}
            </span>
          </div>

          <div className="flex items-center bg-[#11162d] rounded-lg p-1 border border-[#1b254a] text-xs shadow-sm">
            <button
              onClick={() => setForceMock(false)}
              disabled={!apiConfig.hasGeminiApiKey || !apiConfig.allowForceMock}
              className={`px-3 py-1.5 rounded-md transition-all duration-200 cursor-pointer ${
                !forceMock && apiConfig.hasGeminiApiKey
                  ? "bg-violet-600 text-white font-bold shadow-md shadow-violet-900/30"
                  : "text-[#94a3b8] hover:text-white disabled:opacity-50"
              }`}
            >
              Gemini AI
            </button>
            <button
              onClick={() => setForceMock(true)}
              className={`px-3 py-1.5 rounded-md transition-all duration-200 cursor-pointer ${
                forceMock || !apiConfig.hasGeminiApiKey
                  ? "bg-amber-600 text-white font-bold shadow-md shadow-amber-900/30"
                  : "text-[#94a3b8] hover:text-white"
              }`}
            >
              Demo Sandbox
            </button>
          </div>
        </div>
      </header>

      {/* --- User Role Interactive Selector --- */}
      <section className="bg-[#0b0f1e] px-6 py-2.5 border-b border-[#1a2548] flex flex-wrap items-center gap-3 text-xs shadow-sm">
        <span className="text-amber-400 font-semibold flex items-center gap-1">
          <Shield className="w-3.5 h-3.5 text-amber-500" /> SIMULATE SYSTEM LOGIN ROLE:
        </span>
        <div className="flex flex-wrap gap-2 py-0.5">
          {Object.values(UserRole).map((role) => (
            <button
              key={role}
              onClick={() => handleRoleChange(role)}
              className={`px-3.5 py-1.5 rounded-md border text-xs cursor-pointer font-bold tracking-wide transition-all ${
                activeRole === role
                  ? "bg-amber-500/10 border-amber-500/80 text-amber-300 shadow-md shadow-amber-950/25"
                  : "bg-transparent border-[#1e2a4f] text-[#94a3b8] hover:text-[#cbd5e1] hover:border-slate-500"
              }`}
            >
              {role.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </section>

      {/* --- Three-Column Lab Environment --- */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 bg-[#070b19] select-none overflow-y-auto">
        
        {/* =======================================================
            1) LEFT COLUMN: OPERATIONAL CONTEXT (lg:span-3)
            ======================================================= */}
        <section id="operational-context" className="lg:col-span-3 flex flex-col gap-5">
          
          {/* Fictional Campus State */}
          <div className="bg-[#11162d] border border-[#202e5c] rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#1b254a] pb-3 mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-400" /> Demo Headquarters
              </h3>
              <span className="text-[10px] bg-blue-950/60 text-blue-300 border border-blue-900 px-2 py-0.5 rounded font-mono font-bold">USA-East-1</span>
            </div>

            <div className="space-y-4">
              <div className="bg-[#0d122b] p-3.5 rounded-xl border border-[#1b254a]">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Demonstration High School</div>
                <div className="font-extrabold text-[#f8fafc] text-base mt-1 leading-tight">{school.name}</div>
                <div className="text-xs text-blue-400/90 mt-1 font-medium">{school.location}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0d122b] p-3 rounded-xl border border-[#1b254a]">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-0.5">Registered</span>
                  <div className="text-base font-extrabold text-white">{school.registeredStudents} students</div>
                </div>
                <div className="bg-[#0d122b] p-3 rounded-xl border border-[#1b254a]">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-0.5">Meal Eligible</span>
                  <div className="text-base font-extrabold text-white">{school.mealEligibleStudents} students</div>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs bg-[#0d122b] p-2.5 rounded-lg border border-[#1b254a]/60">
                  <span className="text-[#94a3b8] font-medium">Head Chef:</span>
                  <span className="font-bold text-slate-200">{school.cafeteriaManager}</span>
                </div>
                <div className="flex items-center justify-between text-xs bg-[#0d122b] p-2.5 rounded-lg border border-[#1b254a]/60">
                  <span className="text-[#94a3b8] font-medium">Administrator:</span>
                  <span className="font-bold text-slate-200">{school.schoolAdministrator}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Operational Variables & Forecasts */}
          <div className="bg-[#11162d] border border-[#202e5c] rounded-2xl p-5 shadow-lg flex-1 flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2 border-b border-[#1b254a] pb-3 mb-4">
                <Activity className="w-4 h-4 text-emerald-400" /> Operational Parameters
              </h3>

              <div className="space-y-4">
                {/* Date selection telemetry */}
                <div className="flex items-center justify-between bg-[#0e132c] border border-violet-900/40 p-3 rounded-xl">
                  <span className="text-violet-300 font-bold text-xs uppercase tracking-wide">Target Date</span>
                  <span className="font-mono text-white text-xs font-extrabold bg-violet-950/80 px-2.5 py-0.5 rounded border border-violet-850">Thursday (Next)</span>
                </div>

                {/* Expected Attendance */}
                <div className="bg-[#0d122b] p-4 rounded-xl border border-[#1b254a]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Expected Attendance</span>
                    <span className="text-[8px] bg-blue-950 text-blue-400 px-1.5 py-0.5 rounded font-mono font-extrabold border border-blue-900">PREDICTOR INPUT</span>
                  </div>
                  <div className="text-4xl font-extrabold text-[#f8fafc] tracking-tight flex items-baseline gap-1 font-sans">
                    {forecast.expectedAttendance} <span className="text-xs text-[#94a3b8] font-semibold">students</span>
                  </div>
                  <div className="text-[11px] text-[#94a3b8] mt-1.5 font-medium">
                    80% model margin: <span className="font-mono text-white">{forecast.predictionInterval.min} - {forecast.predictionInterval.max}</span>
                  </div>
                </div>

                {/* Meal target */}
                <div className="bg-[#0d122b] p-4 rounded-xl border border-[#1b254a]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Preparation Target</span>
                    <span className="text-[8px] bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-extrabold border border-emerald-900">ACTIVE STATE</span>
                  </div>
                  <div className="text-4xl font-extrabold text-emerald-400 tracking-tight flex items-baseline gap-1 font-sans">
                    {school.currentPreparationPlan} <span className="text-xs text-emerald-500/80 font-bold">meals</span>
                  </div>
                  <div className="text-[11px] text-[#94a3b8] mt-2 leading-relaxed font-semibold">
                    Baseline: <span className="text-slate-100 font-mono">{school.regularDailyPreparation}</span> • Safety Minimum: <span className="text-slate-100 font-mono">{school.safetyFloorCount}</span>
                  </div>
                  {school.currentPreparationPlan !== school.regularDailyPreparation && (
                    <div className="mt-2 text-[10px] bg-teal-950/60 border border-teal-900/40 p-2 rounded text-teal-300 font-semibold">
                      * Human regulatory change override active in memory
                    </div>
                  )}
                </div>

                {/* Prevented surplus display */}
                <div className="bg-[#0d122b] p-3 rounded-xl border border-[#1b254a]/70 flex justify-between items-center bg-teal-950/15">
                  <span className="text-[#94a3b8] font-bold text-xs uppercase tracking-wide">Prevented Food Waste</span>
                  <span className="font-extrabold text-teal-300 font-mono text-base bg-teal-950/80 px-2.5 py-0.5 rounded border border-teal-900">
                    {Math.max(0, school.regularDailyPreparation - school.currentPreparationPlan)} Meals
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-[#1b254a]/70 space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-slate-400">Selected Route:</span>
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-400 inline-block animate-pulse" />
                  {partners.find((p) => p.id === selectedPartnerId)?.name || "Not Selected"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-slate-400">Emergency Broadcast:</span>
                <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded border ${
                  alertStatus === "NONE" 
                    ? "bg-[#161a2b] text-[#94a3b8] border-[#293556]"
                    : "bg-emerald-950 text-emerald-300 border-emerald-800"
                }`}>
                  {alertStatus === "NONE" ? "UNSENT DRAFT" : "ALERT SYSTEM SENT"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* =======================================================
            2) CENTER COLUMN: COPILOT WORKSPACE (lg:span-5)
            ======================================================= */}
        <section id="copilot-workspace" className="lg:col-span-12 xl:col-span-5 flex flex-col gap-5">
          
          {/* STICKY ACTIVE PROPOSAL CARD - THE ULTIMATE VISUAL FOCAL POINT */}
          <AnimatePresence mode="wait">
            {activePendingProposal && (
              <motion.div
                key={activePendingProposal.proposalId}
                initial={{ opacity: 0, y: -20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 350, damping: 25 }}
                className="bg-[#1f1a16] border-2 border-amber-550/70 rounded-2xl p-5 shadow-[0_0_40px_-5px_rgba(245,158,11,0.25)] flex flex-col gap-4 relative overflow-hidden"
              >
                {/* Visual Gold glow behind */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 blur-2xl rounded-full pointer-events-none" />

                <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                  <span className="text-xs font-extrabold text-amber-400 flex items-center gap-1.5 tracking-wider uppercase">
                    <AlertTriangle className="w-5 h-5 text-amber-500 animate-pulse" /> operational authorization gate
                  </span>
                  <span className="bg-amber-950/80 border border-amber-800/80 text-amber-300 text-[9px] font-mono px-2 py-0.5 rounded uppercase font-bold">
                    human-in-the-loop validation
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-black text-white uppercase tracking-wide">{activePendingProposal.title}</h4>
                  <p className="text-xs text-amber-100/80 mt-1 leading-relaxed">{activePendingProposal.summary}</p>
                </div>

                {/* Giant Typography Parameter Shift Indicator */}
                <div className="grid grid-cols-1 md:grid-cols-11 items-center justify-center gap-3 py-3 px-4 bg-[#0d0c13]/90 rounded-xl border border-amber-955/35">
                  <div className="md:col-span-5 text-center">
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Previous System State</div>
                    <div className="text-sm font-bold font-mono text-slate-300 bg-slate-900/40 py-1.5 px-2 rounded border border-slate-800">
                      {formatValue(activePendingProposal.before)}
                    </div>
                  </div>
                  <div className="md:col-span-1 flex items-center justify-center">
                    <ArrowRight className="w-5 h-5 text-amber-400 rotate-90 md:rotate-0" />
                  </div>
                  <div className="md:col-span-5 text-center">
                    <div className="text-[10px] text-amber-450 font-bold uppercase tracking-wider mb-1">Proposed Override</div>
                    <div className="text-xl font-black font-mono text-amber-350 bg-amber-950/15 py-1 px-2 rounded border border-amber-500/40 drop-shadow-[0_0_12px_rgba(245,158,11,0.25)]">
                      {formatValue(activePendingProposal.after)}
                    </div>
                  </div>
                </div>

                {/* Pre-Execution Policy Checks Lists */}
                <div className="bg-[#0e0c12]/50 p-3 rounded-xl border border-amber-950/40 space-y-2">
                  <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Automatic Security Safety Checks:</div>
                  <div className="space-y-1">
                    {activePendingProposal.policyChecks ? (
                      activePendingProposal.policyChecks.map((chk, index) => {
                        const safetyExceeded = chk.policy.includes("Safety Floor") && activePendingProposal.after.proposedQuantity < 540;
                        return (
                          <div key={index} className="flex items-start gap-2 text-xs">
                            {chk.passed && !safetyExceeded ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                            )}
                            <div className="text-[11px] text-slate-200">
                              <span className="font-bold">{chk.policy}</span> • <span className="text-slate-400">{chk.explanation}</span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-slate-400 italic text-[11px]">No automatic checklists attached.</div>
                    )}
                  </div>
                </div>

                {/* Clearance warning card */}
                {(() => {
                  const isUserAuthorized = activePendingProposal.requiredApprovals.includes(activeRole);
                  return (
                    <div className="space-y-3">
                      {!isUserAuthorized ? (
                        <div className="bg-amber-950/40 border border-amber-800/60 p-3 rounded-xl flex items-start gap-2 text-xs text-amber-300">
                          <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 animate-bounce" />
                          <div>
                            <span className="font-bold">Access Restrained:</span> Switch your login role in the top selector to{" "}
                            <span className="underline font-black text-white">{activePendingProposal.requiredApprovals.join(" or ")}</span> to approve this execution.
                          </div>
                        </div>
                      ) : (
                        <div className="bg-emerald-950/30 border border-emerald-800/40 p-2.5 rounded-xl flex items-center gap-2 text-xs text-emerald-400">
                          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>Your simulated role is <span className="font-bold underline">{activeRole}</span>. You have regulatory credentials to sign this proposal.</span>
                        </div>
                      )}

                      {/* Controls Footer */}
                      <div className="flex gap-2.5 pt-1">
                        <button
                          onClick={() => handleApproveProposal(activePendingProposal)}
                          disabled={!isUserAuthorized}
                          className={`flex-1 font-bold py-3 px-4 rounded-xl text-xs transition-all duration-200 flex items-center justify-center gap-2 shadow-lg ${
                            isUserAuthorized
                              ? "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:scale-[1.01]"
                              : "bg-emerald-950/20 text-emerald-500/30 border border-emerald-950/45 cursor-not-allowed"
                          }`}
                        >
                          <CheckCircle2 className="w-4 h-4" /> Sign & Execute Operations Change
                        </button>
                        <button
                          onClick={() => handleRejectProposal(activePendingProposal)}
                          className="bg-[#2B1B22]/80 hover:bg-rose-950 text-rose-300 hover:text-rose-100 py-3 px-4 rounded-xl text-xs border border-rose-950 cursor-pointer shadow-md transition-all duration-200"
                        >
                          Decline Request
                        </button>
                      </div>
                    </div>
                  );
                })()}

              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat Panel Box */}
          <div className="bg-[#10162d] border border-[#1e2a4f] rounded-2xl flex-1 flex flex-col overflow-hidden shadow-2xl h-[470px]">
            {/* Header */}
            <div className="border-b border-[#1b254a] bg-[#0c1022] px-4 py-3.5 flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-100 flex items-center gap-2 font-bold uppercase tracking-wider">
                <Sparkles className="text-violet-400 w-4 h-4" /> AI Operations Copilot
              </span>
              <span className="text-violet-300 bg-violet-950 px-2.5 py-0.5 rounded-full border border-violet-850 tracking-wider font-mono text-[10px]">
                MODEL: gemini-3.5-flash
              </span>
            </div>

            {/* Chat Messages Feed */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 font-normal text-sm leading-relaxed scrollbar-thin scrollbar-thumb-slate-800">
              <div className="space-y-4">
                {chatFeed.map((msg) => (
                  <div key={msg.id} className={`flex flex-col ${msg.sender === "USER" ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[90%] rounded-2xl px-4 py-3 border ${
                      msg.sender === "USER"
                        ? "bg-[#2c1d53]/70 border-violet-800/60 text-[#cbd5e1]"
                        : msg.isError
                          ? "bg-red-950/30 border-red-900/50 text-red-350"
                          : "bg-[#0d122b]/95 border-[#1e2a4f] text-[#f1f5f9]"
                    }`}>
                      {/* Prefix label for compliance visibility */}
                      <div className="text-[9px] text-[#94a3b8] mb-1.5 font-mono uppercase tracking-widest flex items-center justify-between border-b border-slate-800 pb-1">
                        <span className="font-bold">{msg.sender === "USER" ? `SIM OPERATOR (${activeRole.replace(/_/g, " ")})` : "SURPLUSSYNC CO-PILOT SUB-SYSTEM"}</span>
                        <span>{msg.timestamp.slice(11, 16)} GMT</span>
                      </div>
                      
                      {/* Text Body parsed with bold highlights */}
                      <div className="whitespace-pre-wrap select-text selection:bg-violet-700 font-sans text-xs md:text-sm">
                        {msg.text.split("**").map((chunk, idx) => 
                          idx % 2 === 1 ? <strong key={idx} className="text-white font-extrabold">{chunk}</strong> : chunk
                        )}
                      </div>

                      {/* Render embedded Action Proposal inside Chat Feed if available */}
                      {msg.responseObj && msg.responseObj.proposedActions && msg.responseObj.proposedActions.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-[#1b254a]/60">
                          {msg.responseObj.proposedActions.map((proposal) => {
                            const isPending = proposal.status === "PENDING_APPROVAL";
                            return (
                              <div key={proposal.proposalId} className="bg-[#191e38] border border-amber-500/30 rounded-xl p-3 shadow-inner mt-2">
                                <span className="text-[10px] font-extrabold text-[#f59e0b] bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800 uppercase tracking-wider flex items-center gap-1.5 w-max mb-2">
                                  <AlertTriangle className="w-3 h-3 text-amber-500 animate-pulse" /> {proposal.status}
                                </span>
                                <h4 className="text-xs font-bold text-white uppercase">{proposal.title}</h4>
                                <p className="text-[11px] text-[#cbd5e1] mt-1 mb-2 leading-relaxed">{proposal.summary}</p>
                                
                                {isPending && (
                                  <div className="mt-2 text-[10px] text-amber-300 italic">
                                    Verify clearance authorization and sign using Gating Matrix above
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div ref={chatBottomRef} />
            </div>

            {/* Chat Input Area */}
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                triggerCopilotQuery(inputText);
              }}
              className="border-t border-[#1b254a]/80 bg-[#0c1022] p-3 flex gap-2"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ask co-pilot to check Wednesday data or run updates..."
                className="flex-1 bg-[#090d1c] border border-[#1b254a] focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-lg px-3.5 py-2.5 text-xs text-[#cbd5e1] placeholder-slate-500 outline-none"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading}
                className="bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white p-2.5 rounded-lg cursor-pointer transition disabled:opacity-50"
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
          <div className="bg-[#11162d] border border-[#202e5c] rounded-2xl p-4 shadow-lg">
            <h3 className="text-[10px] font-extrabold text-[#94a3b8] tracking-widest uppercase mb-2">
              Laboratory Scenario Simulator Launcher
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 overflow-x-auto select-none">
              {SCENARIOS.map((scen) => (
                <button
                  key={scen.id}
                  onClick={() => runScenarioDirectly(scen)}
                  className="px-2 py-1.5 transition text-left cursor-pointer bg-[#0c112b] hover:bg-violet-950/20 rounded-lg border border-[#1e2a4f] hover:border-violet-800 text-[10px] group text-[#cbd5e1] hover:text-[#f8fafc] font-normal"
                  title={`${scen.title}\n\nExpected Response: ${scen.expectedBehavior}`}
                >
                  <div className="font-extrabold text-[#f1f5f9] group-hover:text-violet-300 text-[10px] truncate">{scen.title.replace("Scenario ", "S")}</div>
                  <div className="text-[9px] text-[#94a3b8] mt-0.5 line-clamp-1">{scen.category}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* =======================================================
            3) RIGHT COLUMN: INSPECTOR & GOVERNANCE (lg:span-4)
            ======================================================= */}
        <section id="inspector-tabs" className="lg:col-span-12 xl:col-span-4 flex flex-col gap-5">
          
          <div className="bg-[#10162d] border border-[#1e2a4f] rounded-2xl p-5 flex-1 flex flex-col overflow-hidden shadow-2xl h-[530px]">
            {/* Tab Controls Navigation */}
            <div className="flex border-b border-[#1b254a] pb-3 overflow-x-auto gap-1 text-[11px] font-bold tracking-wide uppercase shrink-0">
              <button
                onClick={() => setInspectorTab("transparency")}
                className={`px-3 py-2 rounded-lg transition-all cursor-pointer ${inspectorTab === "transparency" ? "bg-violet-950/80 text-violet-300 border border-violet-800/40" : "text-slate-400 hover:text-white"}`}
              >
                Traceability
              </button>
              <button
                onClick={() => setInspectorTab("proposals")}
                className={`px-3 py-2 rounded-lg transition-all relative cursor-pointer ${inspectorTab === "proposals" ? "bg-amber-950/70 text-amber-300 border border-amber-800/40" : "text-slate-400 hover:text-white"}`}
              >
                Proposals
                {proposals.filter((p) => p.status === "PENDING_APPROVAL").length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-amber-500 text-black font-extrabold w-4 h-4 rounded-full flex items-center justify-center text-[9px] border border-[#10162d] animate-bounce" />
                )}
              </button>
              <button
                onClick={() => setInspectorTab("permission")}
                className={`px-3 py-2 rounded-lg transition-all cursor-pointer ${inspectorTab === "permission" ? "bg-slate-900 border border-slate-800 text-slate-100" : "text-slate-400 hover:text-white"}`}
              >
                Guardrails
              </button>
              <button
                onClick={() => setInspectorTab("tool")}
                className={`px-3 py-2 rounded-lg transition-all cursor-pointer ${inspectorTab === "tool" ? "bg-slate-900 border border-slate-800 text-slate-100" : "text-slate-400 hover:text-white"}`}
              >
                Tools
              </button>
              <button
                onClick={() => setInspectorTab("audit")}
                className={`px-3 py-2 rounded-lg transition-all cursor-pointer ${inspectorTab === "audit" ? "bg-slate-900 border border-slate-800 text-slate-100" : "text-slate-400 hover:text-white"}`}
              >
                Audit Log
              </button>
              <button
                onClick={() => setInspectorTab("docs")}
                className={`px-3 py-2 rounded-lg transition-all cursor-pointer ${inspectorTab === "docs" ? "bg-slate-900 border border-slate-800 text-slate-100" : "text-slate-400 hover:text-white"}`}
              >
                Docs
              </button>
            </div>

            {/* Tab Panels */}
            <div className="flex-1 overflow-y-auto mt-4 text-xs">
              
              {/* === TRANSPARENCY PANEL === */}
              {inspectorTab === "transparency" && (
                <div className="space-y-4">
                  <h4 className="font-extrabold text-[#f1f5f9] uppercase text-[11px] tracking-wider pb-1.5 border-b border-[#1b254a]/60">Copilot Explainability Traceability Log</h4>
                  
                  {lastAIResponse ? (
                    <div className="space-y-3.5">
                      <div className="bg-[#0c112b] p-3.5 rounded-xl border border-[#1b254a]">
                        <span className="text-slate-400 font-bold font-mono text-[9px] uppercase tracking-wider block mb-1">Estimated Uncertainty & Error Margin</span>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className={`px-2.5 py-0.5 rounded text-[10px] font-black tracking-wide ${
                            lastAIResponse.uncertainty.level === "HIGH" ? "bg-rose-950 text-rose-300 border border-rose-900" :
                            lastAIResponse.uncertainty.level === "MODERATE" ? "bg-amber-950 text-amber-300 border border-amber-900" :
                            "bg-emerald-950 text-emerald-300 border border-emerald-900"
                          }`}>
                            {lastAIResponse.uncertainty.level} RISK ESTIMATION
                          </span>
                        </div>
                        <p className="mt-2 text-[#cbd5e1] leading-relaxed italic text-xs">"{lastAIResponse.uncertainty.explanation}"</p>
                      </div>

                      <div className="bg-[#0c112b] p-3.5 rounded-xl border border-[#1b254a]">
                        <span className="text-slate-400 font-bold font-mono text-[9px] uppercase block mb-2">Data Provenance Source Attribution</span>
                        <div className="space-y-2">
                          {lastAIResponse.provenance.map((prov, i) => (
                            <div key={i} className="flex justify-between items-center bg-[#10162d] px-3 py-1.5 rounded-lg border border-[#1b254a]/50">
                              <span className="text-[#f1f5f9] font-bold text-[11px]">{prov.source}</span>
                              <span className="text-[9px] uppercase font-mono text-blue-400 font-extrabold bg-blue-950/80 px-2 py-0.5 rounded border border-blue-900">{prov.status}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-[#0c112b] p-3.5 rounded-xl border border-[#1b254a]">
                        <span className="text-slate-400 font-bold font-mono text-[9px] uppercase block mb-1">Model Reasoning Constraints</span>
                        <ul className="list-disc list-inside mt-2 space-y-1.5 text-[#cbd5e1] pl-1 leading-relaxed text-xs">
                          {lastAIResponse.limitations.map((lim, i) => (
                            <li key={i}>{lim}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="bg-[#0c112b] p-3.5 rounded-xl border border-[#1b254a]">
                        <span className="text-slate-400 font-bold font-mono text-[9px] uppercase block mb-2">Confidence Logic Evidence Evidence</span>
                        <div className="space-y-1.5">
                          {lastAIResponse.evidence.map((ev, i) => (
                            <div key={i} className="text-[11px] flex justify-between border-b border-[#1b254a]/40 py-1.5">
                              <span className="text-slate-300 font-medium">{ev.label}:</span>
                              <span className="font-extrabold text-white font-mono">{ev.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-slate-500 italic text-xs leading-relaxed">
                      No queries run. Use the Simulator Launcher or ask the model a question to populate evidence streams.
                    </div>
                  )}
                </div>
              )}

              {/* === ACTION PROPOSALS GRID === */}
              {inspectorTab === "proposals" && (
                <div className="space-y-4">
                  <h4 className="font-extrabold text-[#f1f5f9] uppercase text-[11px] tracking-wider pb-1.5 border-b border-[#1b254a]/60">Proposals Sandbox Audit</h4>
                  
                  {proposals.length > 0 ? (
                    <div className="space-y-3.5">
                      {proposals.slice().reverse().map((prop, index) => (
                        <div key={prop.proposalId || index} className={`p-4 rounded-xl border ${
                          prop.status === "PENDING_APPROVAL" 
                            ? "bg-amber-950/10 border-amber-500/40" 
                            : prop.status === "EXECUTED" 
                              ? "bg-emerald-950/20 border-emerald-900/40" 
                              : "bg-slate-900/50 border-slate-800"
                        }`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-mono font-bold uppercase text-blue-400 tracking-wider font-semibold">{prop.actionType}</span>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-mono uppercase font-black tracking-widest ${
                              prop.status === "PENDING_APPROVAL" ? "bg-amber-500/20 text-amber-300" :
                              prop.status === "EXECUTED" ? "bg-emerald-500/25 text-emerald-300" : "bg-zinc-800 text-zinc-400"
                            }`}>
                              {prop.status}
                            </span>
                          </div>
                          <div className="font-bold text-white mb-1 uppercase tracking-wide text-xs">{prop.title}</div>
                          <p className="text-[#cbd5e1] text-[11px] mt-1 leading-relaxed">{prop.summary}</p>
                          
                          {prop.status === "PENDING_APPROVAL" && (() => {
                            const isUserAuthorized = prop.requiredApprovals.includes(activeRole);
                            return (
                            <div className="mt-3 p-3 bg-black/40 rounded-lg border border-[#1b254a]/40 space-y-1.5">
                              <div className="text-[10px] text-slate-400 font-semibold">
                                Required Safe Credentials: <span className="text-amber-300 font-extrabold">{prop.requiredApprovals.join(", ")}</span>
                              </div>
                              <div className="flex gap-2 pt-1">
                                <button
                                  onClick={() => handleApproveProposal(prop)}
                                  disabled={!isUserAuthorized}
                                  className={`font-extrabold px-3 py-1.5 rounded-lg flex-1 text-xs ${
                                    isUserAuthorized
                                      ? "bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer"
                                      : "bg-emerald-950/20 text-emerald-500/30 border border-emerald-950/45 cursor-not-allowed"
                                  }`}
                                >
                                  Sign & Execute
                                </button>
                                <button
                                  onClick={() => handleRejectProposal(prop)}
                                  className="bg-[#21262d] px-3 py-1.5 rounded-lg text-rose-400 hover:bg-rose-950 text-xs border border-[#30363d] cursor-pointer"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-slate-500 italic text-xs">
                      No operational proposals issued. Ask Copilot to make an change.
                    </div>
                  )}
                </div>
              )}

              {/* === PERMISSION WORKSPACE === */}
              {inspectorTab === "permission" && (
                <div className="space-y-4">
                  <h4 className="font-extrabold text-[#f1f5f9] uppercase text-[11px] tracking-wider pb-1.5 border-b border-[#1b254a]/60">Safety Guardrails Sandbox</h4>
                  
                  <div className="bg-[#0c112b] p-4 rounded-xl border border-[#1b254a] space-y-4">
                    <div className="flex justify-between items-center bg-[#10162d] p-3 rounded-lg border border-[#1b254a]/60">
                      <span className="font-semibold text-slate-300 text-xs">Simulated Security Environment:</span>
                      <span className="font-mono text-amber-300 font-extrabold bg-amber-950 px-2.5 py-1 rounded border border-amber-900 text-xs">{activeRole}</span>
                    </div>

                    <div className="border-t border-[#1b254a]/60 pt-3">
                      <h5 className="font-extrabold text-slate-300 mb-2 uppercase text-[10px] tracking-widest">Active System Policies Verified</h5>
                      <div className="space-y-2">
                        <div className="flex items-start gap-2 text-[11px] bg-black/30 p-2.5 rounded-lg border border-slate-900">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="text-white font-bold block mb-0.5">Safety Floor Rule</span>
                            <span className="text-slate-400">Preparation targets cannot fall below 540 meals to safeguard child food security.</span>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] bg-black/30 p-2.5 rounded-lg border border-slate-900">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="text-white font-bold block mb-0.5">Audit Trail Immutability</span>
                            <span className="text-slate-400">Autonomous deletion commands must fail-fast with a permissions error.</span>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] bg-[#22121c] p-2.5 rounded-lg border border-red-900/35">
                          <Ban className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="text-red-300 font-bold block mb-0.5">Certify Food Safety Prohibited</span>
                            <span className="text-slate-400">Autonomous systems are strictly prohibited from issuing physical wellness certificates.</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* === TOOL INTERNALS INSPECTOR === */}
              {inspectorTab === "tool" && (
                <div className="space-y-4">
                  <h4 className="font-extrabold text-[#f1f5f9] uppercase text-[11px] tracking-wider pb-1.5 border-b border-[#1b254a]/60">Function Tool Diagnostics</h4>
                  
                  {lastAIResponse && lastAIResponse.toolCalls && lastAIResponse.toolCalls.length > 0 ? (
                    <div className="space-y-3">
                      {lastAIResponse.toolCalls.map((tc, idx) => (
                        <div key={idx} className="bg-[#0c112b] p-3.5 rounded-xl border border-[#1b254a] space-y-3">
                          <div className="font-mono text-xs text-violet-300 flex items-center justify-between">
                            <span className="flex items-center gap-1.5 font-bold">
                              <Terminal className="w-3.5 h-3.5 text-blue-400 animate-pulse" /> {tc.toolName}
                            </span>
                            <span className="text-[9px] bg-slate-900 px-2 py-0.5 text-slate-400 rounded font-semibold">Model-Issued Call</span>
                          </div>
                          
                          <div className="space-y-1.5">
                            <details className="cursor-pointer group">
                              <summary className="text-[10px] text-[#94a3b8] uppercase font-bold tracking-wide flex items-center justify-between">
                                <span>Inspect Call Parameters ({Object.keys(tc.arguments || {}).length})</span>
                                <span className="text-slate-500 font-bold text-xs group-open:rotate-180">&#9662;</span>
                              </summary>
                              <pre className="p-3 bg-black/60 rounded-lg text-[10px] font-mono text-emerald-400 overflow-x-auto text-wrap mt-2 leading-relaxed leading-normal">
                                {JSON.stringify(tc.arguments, null, 2)}
                              </pre>
                            </details>
                          </div>

                          <div className="space-y-1.5 border-t border-[#1b254a]/50 pt-3 text-[10px] leading-relaxed">
                            <div className="flex justify-between">
                              <span className="text-slate-400">State Mutated Directly:</span>
                              <span className="font-bold text-white">{tc.mutatedState ? "True (UNSAFE)" : "False (SAFETIED)"}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Prerequisite Gate Validation:</span>
                              <span className="font-bold text-white">{tc.requiresApproval ? "Yes (GATED)" : "No (READ-ONLY)"}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-10 text-slate-500 italic text-xs">
                      No API tool executions recorded in this sandbox session.
                    </div>
                  )}

                  {/* Collapsed Raw JSON Inspector */}
                  {lastAIResponse && (
                    <div className="border-t border-[#1b254a]/60 pt-3 mt-3">
                      <details className="cursor-pointer group">
                        <summary className="text-[11px] text-violet-400 font-extrabold uppercase flex items-center justify-between">
                          <span>Developer SDK Raw JSON Response</span>
                          <span className="text-slate-500 group-open:rotate-180 transition">&#9662;</span>
                        </summary>
                        <pre className="p-3 bg-black/70 rounded-lg text-[10px] font-mono text-amber-500 overflow-x-auto mt-2 leading-relaxed text-wrap">
                          {JSON.stringify(lastAIResponse, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              )}

              {/* === AUDIT LOG TIMELINE === */}
              {inspectorTab === "audit" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[#1b254a]/60 pb-1.5">
                    <h4 className="font-extrabold text-[#f1f5f9] uppercase text-[11px] tracking-wider">Audit Log Matrix</h4>
                    <button
                      onClick={() => setIsAddingCorrection(true)}
                      className="text-[10px] text-amber-300 bg-amber-950/50 hover:bg-amber-900 border border-amber-850 px-2.5 py-1 rounded-md cursor-pointer font-bold uppercase transition"
                    >
                      Audit Correction
                    </button>
                  </div>

                  {/* Manual correction logger form */}
                  {isAddingCorrection && (
                    <form onSubmit={handleAddAuditCorrection} className="bg-[#0c112b] p-3 rounded-xl border border-amber-500/50 space-y-2.5">
                      <div className="text-[10px] text-amber-300 font-bold uppercase">Insert Signed Operator Entry Amendment</div>
                      <textarea
                        value={correctionText}
                        onChange={(e) => setCorrectionText(e.target.value)}
                        placeholder="State your operational explanation or notes..."
                        className="w-full h-16 bg-slate-900 text-xs p-2 border border-slate-800 focus:border-amber-500 rounded-lg outline-none text-[#e6edf3]"
                      />
                      <div className="flex justify-end gap-1.5 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setIsAddingCorrection(false)}
                          className="px-2 py-1 text-slate-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="bg-amber-600 hover:bg-amber-550 text-white font-extrabold px-3 py-1 rounded-lg cursor-pointer"
                        >
                          Sign Amendment
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-3 mt-2 pr-1 ml-0.5">
                    {auditLogs.map((log) => (
                      <div key={log.auditId} className="bg-[#0c112b] p-3.5 rounded-xl border border-[#1b254a] space-y-2 text-[11px]">
                        <div className="flex justify-between items-center bg-[#10162d] px-2 py-1.5 rounded-lg border border-[#1b254a]/50">
                          <span className="font-mono text-slate-400 text-[10px] font-bold">{log.auditId.toUpperCase()}</span>
                          <span className="text-[9px] text-[#94a3b8] font-mono">{log.timestamp.slice(11, 19)} GMT</span>
                        </div>
                        
                        <div className="space-y-1 pl-1 text-[#f8fafc]">
                          <div>
                            <span className="text-slate-400">Issuer:</span> <span className="text-white font-bold">{log.actor}</span> <span className="text-[10px] bg-slate-900 px-1.5 py-0.2 rounded text-slate-300 uppercase font-mono font-bold">{(log.role || "SYSTEM").replace(/_/g, " ")}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Action:</span> <span className="text-emerald-300 font-semibold">{log.action}</span>
                          </div>
                          {log.reason && (
                            <div className="text-slate-400 italic mt-1.5 pl-2 border-l border-[#1b254a] py-0.5">
                              &ldquo;{log.reason}&rdquo;
                            </div>
                          )}
                        </div>

                        {/* Audit verification tag */}
                        <div className="flex justify-between items-center text-[10px] border-t border-[#1b254a]/50 pt-2.5 pl-1">
                          <span className="text-emerald-400 font-bold font-mono tracking-wide flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> SIGNED TRUST RECORD
                          </span>
                          
                          {/* Reversible Action controls */}
                          {log.reversibility && (
                            log.undoStatus === "REVERSED" ? (
                              <span className="text-amber-400 italic font-mono font-bold bg-amber-950/80 px-2 py-0.5 rounded border border-amber-900">[AMENDED-REVERSED]</span>
                            ) : (
                              <button
                                onClick={() => handleUndoAudit(log)}
                                className="text-sky-300 hover:text-sky-100 font-extrabold bg-[#10162d] px-2 py-1 rounded border border-[#1b254a] cursor-pointer flex items-center gap-1 transition"
                              >
                                <RotateCcw className="w-2.5 h-2.5" /> Undo Action
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
                <div className="space-y-4">
                  <h4 className="font-extrabold text-[#f1f5f9] uppercase text-[11px] tracking-wider pb-1.5 border-b border-[#1b254a]/60">Integration Contracts</h4>
                  <div className="bg-[#0c112b] p-4 rounded-xl border border-[#1b254a] text-slate-300 font-medium overflow-x-auto text-[11px] leading-relaxed select-text space-y-3 font-mono">
                    <div className="bg-[#10162d] p-3 rounded-lg text-[10px] text-amber-300 border border-amber-900/50 font-sans font-bold leading-normal">
                      * This JSON integration footprint maps exactly to structural state pipelines inside school dashboards.
                    </div>
                    <pre className="text-wrap whitespace-pre text-[9px] text-slate-400">
                      {INTEGRATION_DOCUMENTATION_MARKDOWN}
                    </pre>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Recovery Partners Capacity Panel */}
          <div className="bg-[#10162d] border border-[#1e2a4f] rounded-2xl p-5 shadow-2xl flex-1 flex flex-col justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#cbd5e1] flex items-center justify-between border-b border-[#1b254a] pb-3 mb-4">
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-400" /> Rescue Network
                </span>
                <span className="text-[10px] text-slate-400 font-sans font-bold">Available Delivery Routes</span>
              </h3>

              <div className="space-y-3 select-none overflow-y-auto max-h-[170px] pr-1 scrollbar-thin">
                {partners.map((partner) => {
                  const isRouteSelected = partner.id === selectedPartnerId;
                  return (
                    <div 
                      key={partner.id} 
                      onClick={() => handlePartnerSelectionRequest(partner.id)}
                      className={`p-3 rounded-xl border text-xs cursor-pointer transition flex justify-between items-center ${
                        isRouteSelected 
                          ? "bg-blue-950/30 border-blue-500/70 shadow-md" 
                          : "bg-[#0c112b] border-[#1e2a4f] hover:border-slate-500"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="font-extrabold text-white flex items-center gap-1.5">
                          {partner.name}
                          {partner.hasRefrigeratedVehicle && (
                            <span className="text-[9px] bg-sky-950/80 text-sky-300 px-1.5 py-0.2 rounded border border-sky-850 font-mono font-bold">Cold-Safe</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-semibold">
                          Distance: {partner.distanceMiles} miles | Capacity: {partner.capacityMeals} meals
                        </div>
                      </div>

                      <div className="text-right flex items-center gap-2">
                        <div>
                          <div className={`font-mono font-bold text-[10px] ${partner.isAvailable ? "text-emerald-400" : "text-red-400"}`}>
                            {partner.isAvailable ? "Available" : "Closed"}
                          </div>
                          <div className="text-[9px] text-[#94a3b8] font-semibold">Score: {(partner.reliabilityScore * 100).toFixed(0)}%</div>
                        </div>
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                          isRouteSelected ? "border-blue-400 bg-blue-500/10" : "border-[#1e2a4f]"
                        }`}>
                          {isRouteSelected && <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#1b254a]/60 text-[10px] text-[#94a3b8] font-semibold flex items-center gap-2 bg-slate-950/35 p-2 rounded-lg">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" /> Target route choices trigger real-time physical logistics audits inside state memory.
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
