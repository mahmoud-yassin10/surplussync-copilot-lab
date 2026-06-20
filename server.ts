import express, { Request, Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { executeMockCopilot } from "./src/copilot/mockGeminiClient";
import { SYSTEM_PROMPT } from "./src/copilot/systemPrompt";
import { checkPermission } from "./src/copilot/permissionPolicy";
import { UserRole } from "./src/types";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Shared server-side Google GenAI initialization
let ai: GoogleGenAI | null = null;
const API_KEY = process.env.GEMINI_API_KEY;

if (API_KEY && API_KEY !== "MY_GEMINI_API_KEY" && API_KEY.trim() !== "") {
  try {
    ai = new GoogleGenAI({
      apiKey: API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    console.log("--- Server side: GoogleGenAI client successfully initialized ---");
  } catch (error) {
    console.error("Failed to initialize GoogleGenAI client:", error);
  }
} else {
  console.log("--- Server side: GEMINI_API_KEY not configured. Running in high-fidelity mock laboratory mode ---");
}

// Structured schema for @google/genai type safety config
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING, description: "A friendly, precise and comprehensive explanation of facts, simulation results, or refusal explanation based on school data." },
    answerType: { type: Type.STRING, description: "One of: FACT, PREDICTION, SIMULATION, EXPLANATION, REFUSAL" },
    evidence: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          value: { type: Type.STRING },
          sourceType: { type: Type.STRING, description: "One of: SCHOOL_RECORD, MODEL_OUTPUT, PARTNER_RECORD, USER_INPUT, SYNTHETIC_DATA" }
        },
        required: ["label", "value", "sourceType"]
      }
    },
    provenance: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          source: { type: Type.STRING },
          status: { type: Type.STRING, description: "One of: OBSERVED, DERIVED, SYNTHETIC, PREDICTED, HUMAN_CORRECTED" }
        },
        required: ["source", "status"]
      }
    },
    uncertainty: {
      type: Type.OBJECT,
      properties: {
        level: { type: Type.STRING, description: "LOW, MODERATE, or HIGH" },
        explanation: { type: Type.STRING }
      },
      required: ["level", "explanation"]
    },
    limitations: {
      type: Type.ARRAY,
      items: { type: Type.STRING }
    },
    toolCalls: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          toolName: { type: Type.STRING },
          arguments: { type: Type.OBJECT, properties: {} },
          permissionPassed: { type: Type.BOOLEAN },
          permissionExplanation: { type: Type.STRING },
          mutatedState: { type: Type.BOOLEAN },
          requiresApproval: { type: Type.BOOLEAN }
        },
        required: ["toolName", "arguments", "permissionPassed", "permissionExplanation", "mutatedState", "requiresApproval"]
      }
    },
    proposedActions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          proposalId: { type: Type.STRING },
          actionType: { type: Type.STRING, description: "ATTENDANCE_UPDATE, PREPARATION_OVERRIDE, SURPLUS_ALERT, PARTNER_SELECTION, ALERT_CANCELLATION" },
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          reason: { type: Type.STRING },
          requestedByRole: { type: Type.STRING },
          affectedEntities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                id: { type: Type.STRING },
                label: { type: Type.STRING }
              },
              required: ["type", "id", "label"]
            }
          },
          before: { type: Type.OBJECT, properties: {} },
          after: { type: Type.OBJECT, properties: {} },
          expectedConsequences: { type: Type.ARRAY, items: { type: Type.STRING } },
          risks: { type: Type.ARRAY, items: { type: Type.STRING } },
          policyChecks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                policy: { type: Type.STRING },
                passed: { type: Type.BOOLEAN },
                explanation: { type: Type.STRING }
              },
              required: ["policy", "passed", "explanation"]
            }
          },
          requiredApprovals: { type: Type.ARRAY, items: { type: Type.STRING } },
          reversible: { type: Type.BOOLEAN },
          status: { type: Type.STRING },
          createdAt: { type: Type.STRING }
        },
        required: [
          "proposalId", "actionType", "title", "summary", "reason", "requestedByRole", 
          "affectedEntities", "before", "after", "expectedConsequences", "risks", 
          "policyChecks", "requiredApprovals", "reversible", "status", "createdAt"
        ]
      }
    },
    requiresHumanApproval: { type: Type.BOOLEAN }
  },
  required: [
    "answer", "answerType", "evidence", "provenance", "uncertainty", "limitations", 
    "toolCalls", "proposedActions", "requiresHumanApproval"
  ]
};

// API Route for backend copilot
app.post("/api/copilot", async (req: Request, res: Response) => {
  try {
    const { message, role, currentPlan, schoolState, forecastState, partnersState, forceMockMode } = req.body;

    if (!message || !role) {
      res.status(400).json({ error: "Missing required parameters: message, role" });
      return;
    }

    const useMock = !!forceMockMode || !ai;

    if (useMock) {
      // Execute the robust deterministic fallback immediately
      const mockResult = executeMockCopilot(message, role as UserRole, currentPlan || 730);
      res.json({ result: mockResult, mode: "MOCK_FALLBACK" });
      return;
    }

    // Call the server-side Gemini 3.5 Flash API with strict guidelines
    const contextualPrompt = `
CURRENT OPERATIONAL STATE FOR RESOLUTION:
- Active School Details: ${JSON.stringify(schoolState || {})}
- Active Forecast: ${JSON.stringify(forecastState || {})}
- Active Partners: ${JSON.stringify(partnersState || [])}
- Active User Role: ${role}
- Current Active Preparation Target: ${currentPlan || 730} meals

USER MESSAGE TO RESOLVE:
"${message}"

Remember: You are an auxiliary Copilot laboratory assistant. Evaluate permissions, perform required read-only or proposal simulations accurately, and format your entire response to match the StructuredCopilotResponse schema perfectly. Do NOT output any preambles or markdown wrappers outside the JSON structure.
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

    const parsedResponse = JSON.parse(response.text || "{}");
    
    // Server-side permission policy validation over model toolCalls before returning
    if (parsedResponse.toolCalls && Array.isArray(parsedResponse.toolCalls)) {
      parsedResponse.toolCalls = parsedResponse.toolCalls.map((tc: any) => {
        const policyCheck = checkPermission(role as UserRole, tc.toolName, tc.arguments);
        return {
          ...tc,
          permissionPassed: policyCheck.granted,
          permissionExplanation: policyCheck.explanation
        };
      });
    }

    res.json({ result: parsedResponse, mode: "GEMINI_LIVE" });
  } catch (error: any) {
    console.error("Gemini Copilot execution failed:", error);
    // Fallback gracefully on rate limits or safety filter triggers to prevent crashing
    const mockFallback = executeMockCopilot(req.body.message, req.body.role as UserRole, req.body.currentPlan || 730);
    res.json({ 
      result: mockFallback, 
      mode: "MOCK_FALLBACK",
      warning: "Server connection or API call encountered an error. Safely resolved via local laboratory fallback." 
    });
  }
});

// Server status API endpoint
app.get("/api/config", (req: Request, res: Response) => {
  res.json({
    hasGeminiApiKey: !!API_KEY && API_KEY !== "MY_GEMINI_API_KEY" && API_KEY.trim() !== "",
    activePort: PORT
  });
});

// Configure Vite or Static Bundle distribution
const initServer = async () => {
  if (process.env.NODE_ENV === "production" || process.env.VITE_PROD === "true") {
    // Serve static frontend in production
    app.use(express.static(path.resolve("dist")));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  } else {
    // Inject Vite middleware for beautiful on-the-fly bundling in development
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`=============================================================`);
    console.log(`   SurplusSync Copilot Lab Server listening on port ${PORT}`);
    console.log(`   Internal Live Client Preview Route: http://localhost:3000`);
    console.log(`=============================================================`);
  });
};

initServer().catch((err) => {
  console.error("Failed to boot full-stack laboratory server:", err);
});
