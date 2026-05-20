import { Agent, Runner } from "@openai/agents";
import { existsSync } from "fs";
import { isAbsolute, join } from "path";
import { z } from "zod";
import { AgentRunSummarySchema, ARTIFACT_FILE_NAMES, type AgentRunSummary } from "./artifactContract.js";
import { DEFAULT_AUTONOMY_MODE, type AutonomyMode } from "./autonomy.js";
import { requireOpenAIApiKey } from "./env.js";
import { buildEndpointAgentInstructions, buildEndpointAgentTask } from "./instructions.js";
import { repoRoot } from "./paths.js";
import { createEndpointAgentTools } from "./tools.js";
import { createFullAccessTools } from "./fullAccessTools.js";

export const ReasoningEffortSchema = z.enum(["none", "low", "medium", "high", "xhigh"]);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export type SemanticEndpointAgentOptions = {
  slug?: string;
  outRoot: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  promote: boolean;
  currentDate?: string;
  autonomy?: AutonomyMode;
};

export type RunSemanticEndpointAgentOptions = SemanticEndpointAgentOptions & {
  slug: string;
  maxTurns: number;
  timeoutMs: number;
  streamEvents: boolean;
};

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createSemanticEndpointAgent(options: SemanticEndpointAgentOptions) {
  const currentDate = options.currentDate ?? todayYmd();
  const autonomy = options.autonomy ?? DEFAULT_AUTONOMY_MODE;
  return new Agent({
    name: "USAspending Semantic Endpoint Producer",
    handoffDescription:
      "Builds evidence-backed Semantic Profile V2 bundles for individual USAspending API endpoints.",
    instructions: buildEndpointAgentInstructions({
      currentDate,
      outRoot: options.outRoot,
      promote: options.promote,
      autonomy,
    }),
    model: options.model,
    modelSettings: {
      parallelToolCalls: autonomy === "full_access",
      reasoning: {
        effort: options.reasoningEffort,
        summary: "concise",
      },
      text: {
        verbosity: "medium",
      },
      truncation: "auto",
    },
    tools: [...createEndpointAgentTools(options.outRoot), ...(autonomy === "full_access" ? createFullAccessTools() : [])],
    toolUseBehavior: stopAfterFinalizedBundle(),
    outputType: AgentRunSummarySchema,
  });
}

function logStreamEvent(event: any) {
  if (event?.type === "agent_updated_stream_event") {
    console.error(JSON.stringify({ event: "agents_sdk_agent_updated", agentName: event.agent?.name }));
    return;
  }
  if (event?.type !== "run_item_stream_event") return;

  const item = event.item as any;
  const rawItem = item?.rawItem ?? {};
  const detail =
    rawItem.name ??
    rawItem.tool_name ??
    rawItem.type ??
    rawItem.call_id ??
    rawItem.id ??
    item?.type ??
    "unknown";

  console.error(
    JSON.stringify({
      event: "agents_sdk_run_event",
      name: event.name,
      itemType: item?.type,
      detail,
    })
  );
}

function normalizeToolOutput(output: unknown): Record<string, unknown> | null {
  if (!output) return null;
  if (typeof output === "object" && !Array.isArray(output)) return output as Record<string, unknown>;
  if (typeof output !== "string") return null;
  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

export function missingAgentRunArtifacts(summary: AgentRunSummary, root = repoRoot): string[] {
  if (!(summary.status === "completed" && summary.validationPassed)) return [];
  const expectedNames = new Set(ARTIFACT_FILE_NAMES);
  const reportedNames = new Set(summary.artifacts.map((path) => path.split("/").pop()).filter(Boolean));
  const missingNames = [...expectedNames].filter((name) => !reportedNames.has(name));
  const missingPaths = summary.artifacts.filter((path) => {
    const resolved = isAbsolute(path) ? path : join(root, path);
    return !existsSync(resolved);
  });
  return [...missingNames.map((name) => `<missing artifact entry:${name}>`), ...missingPaths];
}

function assertAgentRunArtifacts(summary: AgentRunSummary): AgentRunSummary {
  const missing = missingAgentRunArtifacts(summary);
  if (missing.length > 0) {
    throw new Error(
      `Agent reported a completed validated bundle, but expected artifact files are missing: ${missing.join(", ")}`
    );
  }
  return summary;
}

function stopAfterFinalizedBundle() {
  const keepGoing = { isFinalOutput: false as const, isInterrupted: undefined };
  return (_context: any, toolResults: any[]) => {
    const finalizeResult = [...toolResults].reverse().find(
      (result) => result?.type === "function_output" && result?.tool?.name === "finalize_validated_bundle"
    );
    if (!finalizeResult) return keepGoing;

    const output = normalizeToolOutput(finalizeResult.output);
    const summary = AgentRunSummarySchema.safeParse(output);
    if (!summary.success) return keepGoing;

    return {
      isFinalOutput: true as const,
      isInterrupted: undefined,
      finalOutput: JSON.stringify(summary.data),
    };
  };
}

export async function runSemanticEndpointAgent(options: RunSemanticEndpointAgentOptions): Promise<AgentRunSummary> {
  requireOpenAIApiKey();
  const currentDate = options.currentDate ?? todayYmd();
  const agent = createSemanticEndpointAgent({ ...options, autonomy: options.autonomy ?? DEFAULT_AUTONOMY_MODE, currentDate });
  const runner = new Runner({
    workflowName: "USAspending semantic endpoint production",
    traceIncludeSensitiveData: false,
    traceMetadata: {
      slug: options.slug,
      outRoot: options.outRoot,
      promote: String(options.promote),
    },
  });

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort(new Error(`Agents SDK endpoint run exceeded timeoutMs=${options.timeoutMs}`));
  }, options.timeoutMs);

  let result;
  try {
    result = await runner.run(
      agent,
      buildEndpointAgentTask({
        slug: options.slug,
        outRoot: options.outRoot,
        currentDate,
        promote: options.promote,
      }),
      {
        maxTurns: options.maxTurns,
        stream: true,
        signal: abortController.signal,
      }
    );

    for await (const event of result) {
      if (options.streamEvents) logStreamEvent(event);
    }
  } finally {
    clearTimeout(timeout);
  }

  if (result.cancelled) {
    throw new Error(
      "Agent run was cancelled before finalize_validated_bundle returned structured final output. Partial artifacts may exist on disk, but completion must happen inside the agent loop."
    );
  }

  if (result.error) {
    throw result.error;
  }

  let finalOutput: unknown;
  try {
    finalOutput = result.finalOutput;
  } catch (error: any) {
    throw error;
  }

  if (!finalOutput) {
    throw new Error(
      "Agent run ended without structured final output from finalize_validated_bundle. Partial artifacts may exist on disk, but the run is not complete."
    );
  }

  return assertAgentRunArtifacts(AgentRunSummarySchema.parse(finalOutput));
}
