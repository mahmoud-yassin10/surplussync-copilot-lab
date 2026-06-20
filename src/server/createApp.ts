import express, { Express, Request, Response } from "express";
import { GoogleGenAI, Type } from "@google/genai";
import { executeMockCopilot } from "../copilot/mockGeminiClient";
import { SYSTEM_PROMPT } from "../copilot/systemPrompt";
import { processCopilotResponse } from "../copilot/copilotResponseProcessor";
import {
  AuditAmendmentRequestSchema,
  CopilotRequestSchema,
  CreateSessionRequestSchema,
  PartnerSelectionRequestSchema,
  UpdateSessionRoleSchema,
} from "../copilot/schemas";
import {
  appendAuditAmendment,
  approveProposal,
  createPartnerSelectionProposal,
  createSession,
  getSessionState,
  rejectProposal,
  updateSessionRole,
  SessionSnapshot,
} from "../copilot/sessionStore";
import { UserRole } from "../types";

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING },
    answerType: { type: Type.STRING },
    evidence: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          value: { type: Type.STRING },
          sourceType: { type: Type.STRING },
        },
        required: ["label", "value", "sourceType"],
      },
    },
    provenance: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          source: { type: Type.STRING },
          status: { type: Type.STRING },
        },
        required: ["source", "status"],
      },
    },
    uncertainty: {
      type: Type.OBJECT,
      properties: {
        level: { type: Type.STRING },
        explanation: { type: Type.STRING },
      },
      required: ["level", "explanation"],
    },
    limitations: { type: Type.ARRAY, items: { type: Type.STRING } },
    toolCalls: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          toolName: { type: Type.STRING },
          arguments: { type: Type.OBJECT, properties: {} },
        },
        required: ["toolName", "arguments"],
      },
    },
    proposedActions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          actionType: { type: Type.STRING },
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          reason: { type: Type.STRING },
          after: { type: Type.OBJECT, properties: {} },
          before: { type: Type.OBJECT, properties: {} },
          risks: { type: Type.ARRAY, items: { type: Type.STRING } },
          reversible: { type: Type.BOOLEAN },
        },
        required: ["actionType", "title", "summary", "reason", "after"],
      },
    },
    requiresHumanApproval: { type: Type.BOOLEAN },
  },
  required: [
    "answer",
    "answerType",
    "evidence",
    "provenance",
    "uncertainty",
    "limitations",
    "toolCalls",
    "proposedActions",
    "requiresHumanApproval",
  ],
};

export interface LabAppOptions {
  isProduction?: boolean;
  /** Treat Gemini as available for mode resolution (used in tests). */
  geminiAvailable?: boolean;
  /** Bypass Gemini/mock routing and return this payload (tests only). */
  testCopilotExecutor?: (message: string, session: SessionSnapshot) => unknown;
  geminiApiKey?: string;
  port?: number;
}

function resolveGeminiClient(options: LabAppOptions): GoogleGenAI | null {
  if (options.geminiAvailable === false) return null;
  if (options.geminiAvailable === true) {
    return { models: { generateContent: async () => ({ text: "{}" }) } } as unknown as GoogleGenAI;
  }
  const API_KEY = options.geminiApiKey ?? process.env.GEMINI_API_KEY;
  if (!API_KEY || API_KEY === "MY_GEMINI_API_KEY" || API_KEY.trim() === "") {
    return null;
  }
  try {
    return new GoogleGenAI({
      apiKey: API_KEY,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
  } catch {
    return null;
  }
}

export function createLabApp(options: LabAppOptions = {}): Express {
  const app = express();
  app.use(express.json());

  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const PORT = options.port ?? 3000;
  const ai = resolveGeminiClient(options);

  app.post("/api/session", (req: Request, res: Response) => {
    const parsed = CreateSessionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid session creation payload" });
      return;
    }
    const role = (parsed.data.role as UserRole) ?? UserRole.CAFETERIA_MANAGER;
    const state = createSession(role);
    res.status(201).json({
      sessionId: state.sessionId,
      state,
      notice: "Demo session isolation only — not production authentication.",
    });
  });

  app.get("/api/session/:sessionId/state", (req: Request, res: Response) => {
    const state = getSessionState(req.params.sessionId);
    if (!state) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ state });
  });

  app.patch("/api/session/:sessionId/role", (req: Request, res: Response) => {
    const parsed = UpdateSessionRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid role payload" });
      return;
    }
    const state = updateSessionRole(req.params.sessionId, parsed.data.role as UserRole);
    if (!state) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ state });
  });

  app.post("/api/session/:sessionId/audit/amendment", (req: Request, res: Response) => {
    const parsed = AuditAmendmentRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid audit amendment payload" });
      return;
    }
    const result = appendAuditAmendment(
      req.params.sessionId,
      parsed.data.reason,
      parsed.data.relatedAuditId
    );
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }
    res.status(201).json({ state: result.state, amendment: result.amendment });
  });

  app.post("/api/session/:sessionId/proposals/partner-selection", (req: Request, res: Response) => {
    const parsed = PartnerSelectionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid partner selection payload" });
      return;
    }
    const result = createPartnerSelectionProposal(req.params.sessionId, parsed.data.partnerId);
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }
    res.status(result.statusCode).json({ state: result.state, proposals: result.proposals });
  });

  app.post("/api/session/:sessionId/proposals/:proposalId/approve", (req: Request, res: Response) => {
    const result = approveProposal(req.params.sessionId, req.params.proposalId);
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }
    res.json({ state: result.state });
  });

  app.post("/api/session/:sessionId/proposals/:proposalId/reject", (req: Request, res: Response) => {
    const result = rejectProposal(req.params.sessionId, req.params.proposalId);
    if (!result.ok) {
      res.status(result.statusCode).json({ error: result.error });
      return;
    }
    res.json({ state: result.state });
  });

  app.post("/api/copilot", async (req: Request, res: Response) => {
    try {
      const parsed = CopilotRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid copilot request", details: parsed.error.flatten() });
        return;
      }

      const { sessionId, message } = parsed.data;
      const session = getSessionState(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const forceMockRequested = parsed.data.forceMockMode === true;
      const forceMockMode = !isProduction && forceMockRequested;
      const useMock = forceMockMode || !ai;

      let rawResult: unknown;

      if (options.testCopilotExecutor && !useMock) {
        rawResult = options.testCopilotExecutor(message, session);
      } else if (useMock) {
        rawResult = executeMockCopilot(message, session.role, session.school.currentPreparationPlan);
      } else {
        const contextualPrompt = `
CURRENT OPERATIONAL STATE FOR RESOLUTION (authoritative server snapshot):
- Active School Details: ${JSON.stringify(session.school)}
- Active Forecast: ${JSON.stringify(session.forecast)}
- Active Partners: ${JSON.stringify(session.partners)}
- Active User Role: ${session.role}
- Current Active Preparation Target: ${session.school.currentPreparationPlan} meals
- Selected Partner: ${session.selectedPartnerId}
- Alert Status: ${session.alertStatus}

USER MESSAGE TO RESOLVE:
"${message}"
`;

        const response = await ai!.models.generateContent({
          model: "gemini-3.5-flash",
          contents: contextualPrompt,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            temperature: 0.1,
          },
        });

        rawResult = JSON.parse(response.text || "{}");
      }

      const processed = processCopilotResponse(rawResult, sessionId, session.role);
      if ("error" in processed) {
        res.status(422).json({ error: processed.error });
        return;
      }

      res.json({
        result: processed.response,
        state: getSessionState(sessionId),
        mode: useMock ? "MOCK_FALLBACK" : "GEMINI_LIVE",
        rejectedProposals: processed.rejectedProposals,
      });
    } catch (error: unknown) {
      console.error("Gemini Copilot execution failed:", error);
      const sessionId = req.body?.sessionId;
      const session = typeof sessionId === "string" ? getSessionState(sessionId) : null;
      if (!session) {
        res.status(500).json({ error: "Copilot failed and session is unavailable for fallback" });
        return;
      }
      const rawFallback = executeMockCopilot(
        req.body.message ?? "",
        session.role,
        session.school.currentPreparationPlan
      );
      const processed = processCopilotResponse(rawFallback, sessionId, session.role);
      if ("error" in processed) {
        res.status(500).json({ error: processed.error });
        return;
      }
      res.json({
        result: processed.response,
        state: getSessionState(sessionId),
        mode: "MOCK_FALLBACK",
        warning: "Server connection or API call encountered an error. Safely resolved via local laboratory fallback.",
        rejectedProposals: processed.rejectedProposals,
      });
    }
  });

  app.get("/api/config", (_req: Request, res: Response) => {
    const API_KEY = options.geminiApiKey ?? process.env.GEMINI_API_KEY;
    res.json({
      hasGeminiApiKey: !!API_KEY && API_KEY !== "MY_GEMINI_API_KEY" && API_KEY.trim() !== "",
      activePort: PORT,
      isProduction,
      allowForceMock: !isProduction,
      sessionNotice: "Demo session isolation only — not production authentication.",
    });
  });

  return app;
}
