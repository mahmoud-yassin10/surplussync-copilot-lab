import { GoogleGenAI, Type } from "@google/genai";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { StructuredCopilotResponse, UserRole } from "../types";

let aiInstance: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === "MY_GEMINI_API_KEY" || key.trim() === "") {
      throw new Error("GEMINI_API_KEY not configured or is placeholder");
    }
    aiInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

/**
 * Sends request to real Gemini API with system instructions, forcing JSON schema response
 */
export async function callRealGemini(
  message: string,
  role: UserRole,
  currentPlan: number,
  history: { role: "user" | "model"; parts: { text: string }[] }[] = []
): Promise<StructuredCopilotResponse> {
  const ai = getGeminiClient();

  // Incorporate previous messages to maintain continuity
  const contents = [
    ...history,
    {
      role: "user" as const,
      parts: [
        {
          text: `Active User Role: ${role}\nCurrent Cafeteria Preparation Plan: ${currentPlan} meals\n\nUser Question:\n${message}`,
        },
      ],
    },
  ];

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.1, // low temperature for extreme adherence to policy output
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: {
            type: Type.STRING,
            description: "The primary answer or simulation overview.",
          },
          answerType: {
            type: Type.STRING,
            description: "Categorize response type (e.g. FACT | PREDICTION | SIMULATION | EXPLANATION | REFUSAL)",
          },
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
          limitations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          toolCalls: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                toolName: { type: Type.STRING },
                arguments: { type: Type.OBJECT },
                permissionPassed: { type: Type.BOOLEAN },
                permissionExplanation: { type: Type.STRING },
                mutatedState: { type: Type.BOOLEAN },
                requiresApproval: { type: Type.BOOLEAN },
              },
              required: ["toolName", "arguments", "permissionPassed", "permissionExplanation"],
            },
          },
          proposedActions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                proposalId: { type: Type.STRING },
                actionType: { type: Type.STRING },
                title: { type: Type.STRING },
                summary: { type: Type.STRING },
                reason: { type: Type.STRING },
                requestedByRole: { type: Type.STRING },
                before: { type: Type.OBJECT },
                after: { type: Type.OBJECT },
                expectedConsequences: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                risks: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                policyChecks: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      policy: { type: Type.STRING },
                      passed: { type: Type.BOOLEAN },
                      explanation: { type: Type.STRING },
                    },
                    required: ["policy", "passed", "explanation"],
                  },
                },
                requiredApprovals: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                reversible: { type: Type.BOOLEAN },
                status: { type: Type.STRING },
              },
              required: ["proposalId", "actionType", "title", "summary", "reason", "requestedByRole", "status"],
            },
          },
          requiresHumanApproval: { type: Type.BOOLEAN },
        },
        required: ["answer", "answerType", "evidence", "provenance", "uncertainty", "limitations", "toolCalls", "proposedActions", "requiresHumanApproval"],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("No response text received from Gemini");
  }

  // Parse structured output
  return JSON.parse(text) as StructuredCopilotResponse;
}
