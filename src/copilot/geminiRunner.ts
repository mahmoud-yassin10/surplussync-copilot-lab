import { GoogleGenAI } from "@google/genai";
import { UserRole } from "../types";
import { assembleCopilotResponse } from "./copilotResponseAssembler";
import { CopilotExplanationDraftSchema } from "./copilotResponseAssembler";
import { ForecastProvider } from "./forecastProvider";
import { buildMockExplanation, planMockTools } from "./mockToolPlanner";
import { getSession } from "./sessionStore";
import {
  EXPLANATION_RESPONSE_SCHEMA,
  resolveGeminiModel,
  runControlledToolLoop,
  ToolLoopOptions,
} from "./toolLoop";
import { FunctionCall } from "@google/genai";

export interface CopilotTurnResult {
  ok: boolean;
  mode: "MOCK_TOOL_LOOP" | "GEMINI_TOOL_LOOP";
  error?: string;
  processed?: ReturnType<typeof assembleCopilotResponse>;
  warning?: string;
}

export interface CopilotRunnerOptions {
  sessionId: string;
  message: string;
  mode: "mock" | "live";
  ai?: GoogleGenAI | null;
  forecastProvider?: ForecastProvider;
  testGeminiSteps?: Array<{ functionCalls?: FunctionCall[]; text?: string }>;
}

export async function runCopilotTurn(options: CopilotRunnerOptions): Promise<CopilotTurnResult> {
  const session = getSession(options.sessionId);
  if (!session) {
    return { ok: false, mode: "MOCK_TOOL_LOOP", error: "Session not found" };
  }

  const forecastProvider = options.forecastProvider ?? new ForecastProvider();
  const loopOptions: ToolLoopOptions = {
    sessionId: options.sessionId,
    message: options.message,
    role: session.role as UserRole,
    forecastProvider,
    ai: options.mode === "live" ? options.ai ?? undefined : undefined,
    mockPlanner: options.mode === "mock" ? planMockTools : undefined,
    testGeminiSteps: options.testGeminiSteps,
  };

  const loopResult = await runControlledToolLoop(loopOptions);

  let explanation;
  let warning = loopResult.stoppedReason;
  if (options.mode === "mock" || !options.ai) {
    explanation = buildMockExplanation(
      options.message,
      loopResult.toolCalls.map((tc) => ({
        name: tc.toolName,
        ok: tc.permissionPassed && !(tc.returnedValue as { error?: string })?.error,
        output: (tc.returnedValue as Record<string, unknown>) ?? {},
      }))
    );
  } else {
    const summaryPrompt = {
      role: "user" as const,
      parts: [
        {
          text:
            "Using the tool results above, produce the final JSON explanation only. Do not include proposals or toolCalls. Cite forecast provenance (ML vs canonical fallback vs session state).",
        },
      ],
    };
    const contents = [...loopResult.contents, summaryPrompt];
    const response = await options.ai.models.generateContent({
      model: resolveGeminiModel(),
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: EXPLANATION_RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    });
    let rawExplanation: unknown = {};
    try {
      rawExplanation = JSON.parse(response.text || "{}");
    } catch {
      rawExplanation = {};
    }
    const parsed = CopilotExplanationDraftSchema.safeParse(rawExplanation);
    if (!parsed.success) {
      explanation = buildMockExplanation(
        options.message,
        loopResult.toolCalls.map((tc) => ({
          name: tc.toolName,
          ok: tc.permissionPassed && !(tc.returnedValue as { error?: string })?.error,
          output: (tc.returnedValue as Record<string, unknown>) ?? {},
        }))
      );
      explanation.limitations = [
        ...explanation.limitations,
        "Live Gemini explanation did not match the required schema; deterministic explanation was used for display.",
      ];
      warning = [warning, "Malformed final Gemini explanation"].filter(Boolean).join("; ");
    } else {
      explanation = parsed.data;
    }
  }

  const assembled = assembleCopilotResponse({
    sessionId: options.sessionId,
    explanation,
    toolCalls: loopResult.toolCalls,
    createdProposalIds: loopResult.createdProposalIds,
    extraLimitations: loopResult.limitations,
    extraProvenance: loopResult.provenanceNotes,
  });

  if ("error" in assembled) {
    return { ok: false, mode: options.mode === "mock" ? "MOCK_TOOL_LOOP" : "GEMINI_TOOL_LOOP", error: assembled.error };
  }

  return {
    ok: true,
    mode: options.mode === "mock" ? "MOCK_TOOL_LOOP" : "GEMINI_TOOL_LOOP",
    processed: assembled,
    warning,
  };
}
