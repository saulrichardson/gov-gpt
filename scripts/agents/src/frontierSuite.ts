import { mkdirSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, relative } from "path";
import { z } from "zod";
import { DEFAULT_AUTONOMY_MODE, type AutonomyMode } from "./autonomy.js";
import { repoRoot } from "./paths.js";
import { ReasoningEffortSchema, runSemanticStoryAgent, type SemanticStoryAgentOptions } from "./storyAgent.js";
import { SemanticStoryReportSchema, type SemanticStoryReport } from "./storyContract.js";

export const DEFAULT_FRONTIER_CHALLENGES = [
  {
    id: "contract-outlier-dashboard",
    question:
      "Use the promoted USAspending semantic MCP as if you were building a compact contract outlier dashboard. Start from semantic discovery, use scoped high-value contract search, validate every request, inspect at least two candidate awards if possible, drill into detail and funding for the more interesting one, and tell the most evidence-backed outlier story you can. Prefer surprising interpretation over merely picking the biggest number. Report gaps that prevent a richer dashboard.",
  },
  {
    id: "geography-time-contrast",
    question:
      "Use the promoted USAspending semantic MCP to build a small geographic/time contrast story. Start from semantic discovery. Try to compare a scoped spending_over_time trend with spending_by_geography or disaster geography for the same scope. Validate requests before live calls, keep limits small, and explain whether the MCP can support a coherent map-plus-trend dashboard or where the semantic contract breaks.",
  },
  {
    id: "download-to-analysis-handoff",
    question:
      "Use the promoted USAspending semantic MCP to test whether an agent could move from semantic discovery into a scoped export/download workflow and then into analysis. Do not run a huge export. Use templates and validation, make only scoped live calls, and judge whether the MCP explains enough business semantics for a future dashboard pipeline. Report any fragile or underspecified handoffs.",
  },
] as const;

const FrontierChallengeSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
  })
  .strict();

const FrontierRepairCommandSchema = z
  .object({
    prepareWorkspace: z.string(),
    runRepair: z.string(),
    validate: z.string(),
    promoteAfterReview: z.string(),
  })
  .strict();

export const FrontierRepairQueueItemSchema = z
  .object({
    challengeId: z.string(),
    challengeOutputPath: z.string(),
    taskId: z.string(),
    status: z.enum(["ready", "needs_triage"]),
    targetSlug: z.string().optional(),
    priority: z.enum(["blocker", "major", "minor"]),
    affectedArtifacts: z.array(z.enum(["endpoint.json", "semantics.json", "evidence.jsonl", "usage.md"])),
    objective: z.string(),
    evidenceToUse: z.array(z.string()),
    expectedOutcome: z.string(),
    suggestedCommands: FrontierRepairCommandSchema.optional(),
    triageReason: z.string().optional(),
  })
  .strict();

export const FrontierSuiteReportSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    status: z.enum(["passed", "needs_repair", "blocked"]),
    challengeCount: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    needsRepairCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    totalGapCount: z.number().int().nonnegative(),
    repairQueuePath: z.string(),
    repairQueueCount: z.number().int().nonnegative(),
    repairReadyCount: z.number().int().nonnegative(),
    repairNeedsTriageCount: z.number().int().nonnegative(),
    challengeReports: z.array(
      z
        .object({
          id: z.string(),
          question: z.string(),
          outputPath: z.string(),
          status: z.enum(["passed", "needs_repair", "blocked"]),
          confidence: z.enum(["low", "medium", "high"]),
          summary: z.string(),
          gapCount: z.number().int().nonnegative(),
          majorOrBlockerGapCount: z.number().int().nonnegative(),
          recommendedNextStep: z.string(),
        })
        .strict()
    ),
    topGaps: z.array(
      z
        .object({
          challengeId: z.string(),
          severity: z.enum(["blocker", "major", "minor"]),
          title: z.string(),
          affectedSlug: z.string().optional(),
          suggestedRepair: z.string(),
        })
        .strict()
    ),
  })
  .strict();

export type FrontierChallenge = z.infer<typeof FrontierChallengeSchema>;
export type FrontierRepairQueueItem = z.infer<typeof FrontierRepairQueueItemSchema>;
export type FrontierSuiteReport = z.infer<typeof FrontierSuiteReportSchema>;

export type FrontierSuiteOptions = {
  challenges: FrontierChallenge[];
  outputDir: string;
  repairOutRoot: string;
  bundleGlob?: string;
  model: string;
  reasoningEffort: z.infer<typeof ReasoningEffortSchema>;
  maxTurns: number;
  timeoutMs: number;
  requestTimeoutMs: number;
  streamEvents: boolean;
  autonomy: AutonomyMode;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function suiteStatus(reports: SemanticStoryReport[]): FrontierSuiteReport["status"] {
  if (reports.some((report) => report.status === "blocked")) return "blocked";
  if (reports.some((report) => report.status === "needs_repair")) return "needs_repair";
  return "passed";
}

function toRepoPath(path: string): string {
  if (!isAbsolute(path)) return path;
  const rel = relative(repoRoot, path);
  if (!rel || rel.startsWith("..") || rel === "..") return path;
  return rel;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandsForRepairTask(targetSlug: string, challengeOutputPath: string, taskId: string, repairOutRoot: string) {
  const sourceDir = join("profiles", targetSlug, "semantic");
  const repairRoot = toRepoPath(repairOutRoot);
  const targetDir = join(repairRoot, targetSlug);
  const reportPath = toRepoPath(challengeOutputPath);
  const artifactFiles = ["endpoint.json", "semantics.json", "evidence.jsonl", "usage.md"];

  return {
    prepareWorkspace: [
      "mkdir",
      "-p",
      shellQuote(repairRoot),
      "&&",
      "rm",
      "-rf",
      shellQuote(targetDir),
      "&&",
      "cp",
      "-R",
      shellQuote(sourceDir),
      shellQuote(targetDir),
    ].join(" "),
    runRepair: [
      "npm --prefix scripts/agents run semantic:repair --",
      "--slug",
      shellQuote(targetSlug),
      "--out-root",
      shellQuote(repairRoot),
      "--review-report",
      shellQuote(reportPath),
      "--task-id",
      shellQuote(taskId),
    ].join(" "),
    validate: ["npm --prefix scripts/agents run semantic:validate -- --root", shellQuote(repairRoot)].join(" "),
    promoteAfterReview: [
      "mkdir",
      "-p",
      shellQuote(sourceDir),
      "&&",
      "cp",
      ...artifactFiles.map((fileName) => shellQuote(join(targetDir, fileName))),
      shellQuote(sourceDir),
      "&&",
      "scripts/mcp/bin/validate-semantic-bundles",
    ].join(" "),
  };
}

export function buildFrontierRepairQueue(
  reports: Array<{ challenge: FrontierChallenge; report: SemanticStoryReport; outputPath: string }>,
  repairOutRoot: string
): FrontierRepairQueueItem[] {
  const queue = reports.flatMap(({ challenge, report, outputPath }) =>
    report.repairTasks.map((task) => {
      const targetSlug = task.targetSlug;
      const status = targetSlug ? "ready" : "needs_triage";
      return FrontierRepairQueueItemSchema.parse({
        challengeId: challenge.id,
        challengeOutputPath: outputPath,
        taskId: task.id,
        status,
        ...(targetSlug ? { targetSlug } : {}),
        priority: task.priority,
        affectedArtifacts: task.affectedArtifacts,
        objective: task.objective,
        evidenceToUse: task.evidenceToUse,
        expectedOutcome: task.expectedOutcome,
        ...(targetSlug
          ? { suggestedCommands: commandsForRepairTask(targetSlug, outputPath, task.id, repairOutRoot) }
          : {
              triageReason:
                "The story repair task did not include targetSlug. Route this task to a specific endpoint bundle before running semantic:repair.",
            }),
      });
    })
  );

  return queue.sort((a, b) => {
    const priorityOrder = { blocker: 0, major: 1, minor: 2 };
    const statusOrder = { ready: 0, needs_triage: 1 };
    return (
      statusOrder[a.status] - statusOrder[b.status] ||
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      a.challengeId.localeCompare(b.challengeId) ||
      a.taskId.localeCompare(b.taskId)
    );
  });
}

function storyOptions(options: FrontierSuiteOptions, question: string): SemanticStoryAgentOptions {
  return {
    question,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    maxTurns: options.maxTurns,
    timeoutMs: options.timeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
    streamEvents: options.streamEvents,
    autonomy: options.autonomy,
    ...(options.bundleGlob ? { bundleGlob: options.bundleGlob } : {}),
  };
}

export async function runFrontierSuite(options: FrontierSuiteOptions): Promise<FrontierSuiteReport> {
  const challenges = z.array(FrontierChallengeSchema).min(1).parse(options.challenges);
  mkdirSync(options.outputDir, { recursive: true });

  const reports: Array<{ challenge: FrontierChallenge; report: SemanticStoryReport; outputPath: string }> = [];
  for (const challenge of challenges) {
    const report = await runSemanticStoryAgent(storyOptions(options, challenge.question));
    const parsed = SemanticStoryReportSchema.parse(report);
    const outputPath = join(options.outputDir, `${slugify(challenge.id)}.json`);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
    reports.push({ challenge, report: parsed, outputPath });
  }

  const topGaps = reports.flatMap(({ challenge, report }) =>
    report.mcpGaps
      .filter((gap) => gap.severity !== "minor")
      .map((gap) => ({
        challengeId: challenge.id,
        severity: gap.severity,
        title: gap.title,
        ...(gap.affectedSlug ? { affectedSlug: gap.affectedSlug } : {}),
        suggestedRepair: gap.suggestedRepair,
      }))
  );
  const repairQueue = buildFrontierRepairQueue(reports, options.repairOutRoot);
  const repairQueuePath = join(options.outputDir, "frontier-repair-queue.json");
  writeFileSync(
    repairQueuePath,
    `${JSON.stringify(z.array(FrontierRepairQueueItemSchema).parse(repairQueue), null, 2)}\n`,
    "utf-8"
  );

  const suiteReport: FrontierSuiteReport = {
    generatedAt: new Date().toISOString(),
    status: suiteStatus(reports.map(({ report }) => report)),
    challengeCount: reports.length,
    passedCount: reports.filter(({ report }) => report.status === "passed").length,
    needsRepairCount: reports.filter(({ report }) => report.status === "needs_repair").length,
    blockedCount: reports.filter(({ report }) => report.status === "blocked").length,
    totalGapCount: reports.reduce((sum, { report }) => sum + report.mcpGaps.length, 0),
    repairQueuePath,
    repairQueueCount: repairQueue.length,
    repairReadyCount: repairQueue.filter((item) => item.status === "ready").length,
    repairNeedsTriageCount: repairQueue.filter((item) => item.status === "needs_triage").length,
    challengeReports: reports.map(({ challenge, report, outputPath }) => ({
      id: challenge.id,
      question: challenge.question,
      outputPath,
      status: report.status,
      confidence: report.confidence,
      summary: report.summary,
      gapCount: report.mcpGaps.length,
      majorOrBlockerGapCount: report.mcpGaps.filter((gap) => gap.severity !== "minor").length,
      recommendedNextStep: report.recommendedNextStep,
    })),
    topGaps,
  };
  const summaryPath = join(options.outputDir, "frontier-suite-summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(FrontierSuiteReportSchema.parse(suiteReport), null, 2)}\n`, "utf-8");
  return suiteReport;
}

export { ReasoningEffortSchema, DEFAULT_AUTONOMY_MODE };
