import {
  Content,
  createPartFromFunctionResponse,
  FunctionCall,
  GoogleGenAI,
  Type,
} from "@google/genai";
import { UserRole } from "../types";
import { getSession } from "./sessionStore";
import { ForecastProvider } from "./forecastProvider";
import {
  AllowedToolName,
  BANNED_TOOLS,
  isAllowedTool,
  isBannedTool,
  TOOL_DECLARATIONS,
} from "./toolRegistry";
import { executeTool, ToolExecutionContext, ToolExecutionResult } from "./toolExecutors";
import { TOOL_LOOP_SYSTEM_PROMPT } from "./systemPrompt";

export const MAX_TOOL_LOOP_ITERATIONS = 5;
export const MAX_IDENTICAL_TOOL_CALLS = 2;

export interface ToolLoopResult {
  toolCalls: ToolExecutionResult["toolCall"][];
  createdProposalIds: string[];
  limitations: string[];
  provenanceNotes: Array<{ source: string; status: string }>;
  contents: Content[];
  stoppedReason?: string;
}

export interface ToolLoopOptions {
  sessionId: string;
  message: string;
  role: UserRole;
  forecastProvider: ForecastProvider;
  ai?: GoogleGenAI;
  mockPlanner?: (message: string) => Array<{ name: string; args: Record<string, unknown> }>;
  testGeminiSteps?: Array<{ functionCalls?: FunctionCall[]; text?: string }>;
}

function toolResponseId(name: string, iteration: number): string {
  return `${name}-${iteration}`;
}

function callSignature(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args)}`;
}

export async function runControlledToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const session = getSession(options.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const ctx: ToolExecutionContext = {
    sessionId: options.sessionId,
    role: options.role,
    forecastProvider: options.forecastProvider,
    createdProposalIds: [],
    provenanceNotes: [],
    limitations: [],
  };

  const toolCalls: ToolExecutionResult["toolCall"][] = [];
  const contents: Content[] = [
    {
      role: "user",
      parts: [{ text: `${TOOL_LOOP_SYSTEM_PROMPT}\n\nActive role: ${options.role}\n\nUser message:\n${options.message}` }],
    },
  ];

  const identicalCounts = new Map<string, number>();
  let stoppedReason: string | undefined;
  let stepIndex = 0;

  for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration++) {
    let functionCalls: FunctionCall[] = [];

    if (options.testGeminiSteps) {
      const step = options.testGeminiSteps[stepIndex];
      stepIndex += 1;
      if (!step) break;
      functionCalls = step.functionCalls ?? [];
      if (!functionCalls.length) break;
    } else if (options.mockPlanner) {
      const planned = options.mockPlanner(options.message);
      functionCalls = planned.map((p) => ({ name: p.name, args: p.args }));
      if (!functionCalls.length) break;
      iteration = MAX_TOOL_LOOP_ITERATIONS;
    } else if (options.ai) {
      const response = await options.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          temperature: 0.1,
        },
      });
      functionCalls = response.functionCalls ?? [];
      if (!functionCalls.length) break;
    } else {
      break;
    }

    const modelParts = functionCalls.map((fc) => ({
      functionCall: { name: fc.name, args: fc.args ?? {} },
    }));
    contents.push({ role: "model", parts: modelParts });

    const responseParts = [];
    for (const fc of functionCalls) {
      const name = fc.name ?? "";
      const args = (fc.args ?? {}) as Record<string, unknown>;

      if (isBannedTool(name) || !isAllowedTool(name)) {
        const error = isBannedTool(name)
          ? `Tool '${name}' is prohibited in the Copilot laboratory.`
          : `Unknown tool '${name}'.`;
        ctx.limitations.push(error);
        toolCalls.push({
          toolName: name,
          arguments: args,
          permissionPassed: false,
          permissionExplanation: error,
          mutatedState: false,
          requiresApproval: false,
          returnedValue: { error },
        });
        responseParts.push(createPartFromFunctionResponse(toolResponseId(name, iteration), name, { error }));
        continue;
      }

      const sig = callSignature(name, args);
      const count = (identicalCounts.get(sig) ?? 0) + 1;
      identicalCounts.set(sig, count);
      if (count > MAX_IDENTICAL_TOOL_CALLS) {
        stoppedReason = "Repeated identical tool call limit reached";
        const error = stoppedReason;
        toolCalls.push({
          toolName: name,
          arguments: args,
          permissionPassed: false,
          permissionExplanation: error,
          mutatedState: false,
          requiresApproval: false,
          returnedValue: { error },
        });
        responseParts.push(createPartFromFunctionResponse(toolResponseId(name, iteration), name, { error }));
        break;
      }

      const result = await executeTool(name as AllowedToolName, args, ctx);
      toolCalls.push(result.toolCall);
      responseParts.push(createPartFromFunctionResponse(toolResponseId(name, iteration), name, result.output));
    }

    contents.push({ role: "user", parts: responseParts });

    if (stoppedReason) break;
    if (options.mockPlanner || options.testGeminiSteps) break;
  }

  if (!stoppedReason && !options.mockPlanner && !options.testGeminiSteps && options.ai) {
    const iterationsUsed = contents.filter((c) => c.role === "model").length;
    if (iterationsUsed >= MAX_TOOL_LOOP_ITERATIONS) {
      stoppedReason = "Maximum tool loop iterations reached";
      ctx.limitations.push(stoppedReason);
    }
  }

  return {
    toolCalls,
    createdProposalIds: ctx.createdProposalIds,
    limitations: ctx.limitations,
    provenanceNotes: ctx.provenanceNotes,
    contents,
    stoppedReason,
  };
}

export const EXPLANATION_RESPONSE_SCHEMA = {
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
  },
  required: ["answer", "answerType", "evidence", "provenance", "uncertainty", "limitations"],
};

export function isBannedToolName(name: string): boolean {
  return (BANNED_TOOLS as readonly string[]).includes(name);
}
