import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { AgentRunSummarySchema } from "../src/artifactContract.js";
import { createSemanticEndpointAgent, missingAgentRunArtifacts } from "../src/endpointAgent.js";
import { buildFrontierRepairQueue } from "../src/frontierSuite.js";
import { DEFAULT_SEARCH_GLOBS, buildEndpointAgentInstructions, buildEndpointAgentTask } from "../src/instructions.js";
import { repoRoot } from "../src/paths.js";
import { SemanticRepairReportSchema } from "../src/repairContract.js";
import { createSemanticRepairAgent, filterReviewReportToRepairTask } from "../src/repairAgent.js";
import { SemanticReviewReportSchema } from "../src/reviewContract.js";
import { createSemanticReviewAgent } from "../src/reviewAgent.js";
import { unexpectedRepairArtifactFiles } from "../src/reviewTools.js";
import { SemanticStoryReportSchema } from "../src/storyContract.js";
import { createSemanticStoryAgent } from "../src/storyAgent.js";
import { createEndpointAgentTools } from "../src/tools.js";

describe("Agents SDK semantic endpoint producer", () => {
  function completedSummary(slug = "v2__recipient") {
    return {
      slug,
      status: "completed",
      outputRoot: "runs/agents-sdk-test",
      promoted: false,
      validationPassed: true,
      summary: "Finalized after validation and artifact inventory.",
      keyFindings: ["Availability is available."],
      artifacts: [
        `runs/agents-sdk-test/${slug}/endpoint.json`,
        `runs/agents-sdk-test/${slug}/semantics.json`,
        `runs/agents-sdk-test/${slug}/evidence.jsonl`,
        `runs/agents-sdk-test/${slug}/usage.md`,
      ],
      nextSteps: [],
    };
  }

  it("creates a single autonomous agent with the required artifact tools", () => {
    const agent = createSemanticEndpointAgent({
      outRoot: "runs/agents-sdk-test",
      model: "gpt-5.4",
      reasoningEffort: "high",
      promote: false,
      currentDate: "2026-05-09",
    });

    expect(agent.outputType).toBe(AgentRunSummarySchema);
    expect(agent.tools.map((tool) => tool.name)).toEqual([
      "load_endpoint_context",
      "read_repo_file",
      "search_repo",
      "list_directory",
      "probe_usaspending_api",
      "write_artifact_file",
      "validate_semantic_bundle",
      "run_self_story_gate",
      "promote_semantic_bundle",
      "finalize_validated_bundle",
      "list_output_files",
      "full_access_shell_command",
    ]);
  });

  it("keeps the instructions agentic while making validation non-negotiable", () => {
    const instructions = buildEndpointAgentInstructions({
      currentDate: "2026-05-09",
      outRoot: "runs/agents-sdk-test",
      promote: true,
    });

    expect(instructions).toContain("You own the endpoint understanding and artifact content");
    expect(instructions).toContain("Do not behave like a deterministic extractor");
    expect(instructions).toContain("Validation-first loop");
    expect(instructions).toContain("Run a purposeful live probe set");
    expect(instructions).toContain("Expand only when the endpoint's semantics or workflow genuinely require more evidence");
    expect(instructions).toContain("must include at least one live_probe evidence id");
    expect(instructions).toContain("usage.md must be consistent with endpoint.json and semantics.json");
    expect(instructions).toContain("perform one consistency audit");
    expect(instructions).toContain("Request fact paths must be relative");
    expect(instructions).toContain("Always call validate_semantic_bundle");
    expect(instructions).toContain("Before promotion or finalization, call run_self_story_gate");
    expect(instructions).toContain("source.kind=mcp_story_gate");
    expect(instructions).toContain("A successful validate_semantic_bundle call is not completion");
    expect(instructions).toContain("call list_output_files");
    expect(instructions).toContain("call finalize_validated_bundle");
    expect(instructions).toContain("call promote_semantic_bundle");
    expect(instructions).toContain("Full-access autonomous mode");
    expect(instructions).toContain("full_access_shell_command");
  });

  it("builds a concrete endpoint task with explicit tool arguments", () => {
    const task = buildEndpointAgentTask({
      slug: "v2__search__spending_by_geography",
      outRoot: "runs/agents-sdk-test",
      currentDate: "2026-05-09",
      promote: false,
    });

    expect(task).toContain("Endpoint slug: v2__search__spending_by_geography");
    expect(task).toContain('"maxCharsPerFile":16000');
    expect(task).toContain(JSON.stringify(DEFAULT_SEARCH_GLOBS));
    expect(task).toContain('queryJson: "{}"');
    expect(task).toContain("run_self_story_gate");
  });

  it("keeps the agent running after validation so it can inspect and finalize artifacts", async () => {
    const agent = createSemanticEndpointAgent({
      slug: "v2__recipient",
      outRoot: "runs/agents-sdk-test",
      model: "gpt-5.4",
      reasoningEffort: "high",
      promote: false,
      currentDate: "2026-05-09",
    });

    const result = await (agent.toolUseBehavior as any)({}, [
      {
        type: "function_output",
        tool: { name: "validate_semantic_bundle" },
        output: {
          ok: true,
          stdout: "semantic artifacts valid",
          stderr: "",
        },
      },
    ]);

    expect(result.isFinalOutput).toBe(false);
  });

  it("stops only when finalize_validated_bundle returns a structured summary", async () => {
    const agent = createSemanticEndpointAgent({
      slug: "v2__recipient",
      outRoot: "runs/agents-sdk-test",
      model: "gpt-5.4",
      reasoningEffort: "high",
      promote: false,
      currentDate: "2026-05-09",
    });

    const result = await (agent.toolUseBehavior as any)({}, [
      {
        type: "function_output",
        tool: { name: "finalize_validated_bundle" },
        output: JSON.stringify(completedSummary()),
      },
    ]);

    expect(result.isFinalOutput).toBe(true);
    const summary = AgentRunSummarySchema.parse(JSON.parse(result.finalOutput));
    expect(summary.slug).toBe("v2__recipient");
    expect(summary.validationPassed).toBe(true);
    expect(summary.keyFindings).toContain("Availability is available.");
  });

  it("reports canonical artifact inventory before finalization", async () => {
    const outRoot = `runs/agents-contract-${Date.now()}`;
    const slug = "v2__recipient";
    const dir = join(repoRoot, outRoot, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "endpoint.json"), "{}\n", "utf-8");
    writeFileSync(join(dir, "usage.md"), "# Usage\n", "utf-8");

    try {
      const listTool = createEndpointAgentTools(outRoot).find((tool) => tool.name === "list_output_files") as any;
      const result = await listTool.invoke({}, JSON.stringify({ slug, outRoot }), {});

      expect(result.complete).toBe(false);
      expect(result.missingRequiredFiles).toEqual(["semantics.json", "evidence.jsonl"]);
      expect(result.requiredFiles).toHaveLength(4);
      expect(result.files.map((file: any) => file.fileName)).toEqual(["endpoint.json", "usage.md"]);
    } finally {
      rmSync(join(repoRoot, outRoot), { recursive: true, force: true });
    }
  });

  it("refuses producer finalization before the self-story gate runs", async () => {
    const outRoot = `runs/agents-self-story-required-${Date.now()}`;
    const slug = "v2__search__spending_over_time";
    cpSync(join(repoRoot, "profiles", slug, "semantic"), join(repoRoot, outRoot, slug), { recursive: true });

    try {
      const finalizeTool = createEndpointAgentTools(outRoot).find((tool) => tool.name === "finalize_validated_bundle") as any;
      const result = await finalizeTool.invoke(
        {},
        JSON.stringify({
          slug,
          outRoot,
          promoted: false,
          summary: "Should not finalize without a self-story report.",
        }),
        {}
      );

      expect(String(result)).toContain("self-story gate is required before promotion/finalization");
      expect(String(result)).toContain("Call run_self_story_gate before promotion or finalization");
    } finally {
      rmSync(join(repoRoot, outRoot), { recursive: true, force: true });
    }
  });

  it("detects completed producer summaries whose artifact files are not on disk", () => {
    const root = join(tmpdir(), `gov-gpt-agent-artifacts-${Date.now()}`);
    const artifactDir = join(root, "runs", "demo", "v2__recipient");
    mkdirSync(artifactDir, { recursive: true });
    for (const name of ["endpoint.json", "evidence.jsonl", "semantics.json"]) {
      writeFileSync(join(artifactDir, name), "", "utf-8");
    }

    const summary = AgentRunSummarySchema.parse({
      slug: "v2__recipient",
      status: "completed",
      outputRoot: "runs/demo",
      promoted: false,
      validationPassed: true,
      summary: "Validated.",
      keyFindings: [],
      artifacts: [
        "runs/demo/v2__recipient/endpoint.json",
        "runs/demo/v2__recipient/evidence.jsonl",
        "runs/demo/v2__recipient/semantics.json",
        "runs/demo/v2__recipient/usage.md",
      ],
      nextSteps: [],
    });

    expect(existsSync(join(artifactDir, "usage.md"))).toBe(false);
    expect(missingAgentRunArtifacts(summary, root)).toEqual(["runs/demo/v2__recipient/usage.md"]);
  });

  it("creates a model-owned reviewer agent without write or validation tools", () => {
    const agent = createSemanticReviewAgent({
      outRoot: "runs/agents-sdk-stress",
      model: "gpt-5.4",
      reasoningEffort: "high",
    });

    expect(agent.outputType).toBe(SemanticReviewReportSchema);
    expect(agent.tools.map((tool) => tool.name)).toEqual([
      "load_semantic_review_context",
      "review_read_repo_file",
      "review_search_repo",
      "review_probe_usaspending_api",
      "full_access_shell_command",
    ]);
  });

  it("creates a model-owned repair agent with artifact writes and validation", () => {
    const agent = createSemanticRepairAgent({
      outRoot: "runs/agents-sdk-stress",
      model: "gpt-5.4",
      reasoningEffort: "high",
    });

    expect(agent.outputType).toBe(SemanticRepairReportSchema);
    expect(agent.tools.map((tool) => tool.name)).toEqual([
      "load_semantic_repair_context",
      "repair_write_artifact_file",
      "repair_validate_semantic_bundle",
      "full_access_shell_command",
    ]);
    expect(String(agent.instructions)).toContain("call repair_validate_semantic_bundle");
    expect(String(agent.instructions)).toContain("source.kind review_report or mcp_story_gate");
    expect(String(agent.instructions)).toContain("concrete evidenceToUse");
    expect(String(agent.instructions)).toContain("Leave only endpoint.json, semantics.json, evidence.jsonl, and usage.md");
    expect(String(agent.instructions)).toContain("Full-access autonomous mode");
  });

  it("detects scratch files left in a repair artifact directory", () => {
    const outRoot = `runs/agents-repair-scratch-${Date.now()}`;
    const slug = "v2__recipient";
    const dir = join(repoRoot, outRoot, slug);
    mkdirSync(dir, { recursive: true });
    for (const name of ["endpoint.json", "semantics.json", "evidence.jsonl", "usage.md"]) {
      writeFileSync(join(dir, name), "{}\n", "utf-8");
    }
    writeFileSync(join(dir, "usage.repaired.md"), "scratch\n", "utf-8");
    mkdirSync(join(dir, "scratch"), { recursive: true });

    try {
      expect(unexpectedRepairArtifactFiles(outRoot)).toEqual([
        `${outRoot}/${slug}/scratch`,
        `${outRoot}/${slug}/usage.repaired.md`,
      ]);
    } finally {
      rmSync(join(repoRoot, outRoot), { recursive: true, force: true });
    }
  });

  it("narrows a reviewer report to one repair task without changing the task content", () => {
    const report = {
      slug: "v2__recipient",
      status: "needs_repair",
      readinessForPromotion: "repair_first",
      confidence: "high",
      summary: "Two actionable findings.",
      strengths: ["The bundle is useful."],
      findings: [],
      repairTasks: [
        {
          id: "repair-order-case-sensitivity",
          targetSlug: "v2__recipient",
          priority: "major",
          affectedArtifacts: ["endpoint.json", "semantics.json", "evidence.jsonl", "usage.md"],
          objective: "Preserve lowercase-only order behavior.",
          evidenceToUse: ["order=ASC returns HTTP 400"],
          expectedOutcome: "Callers are told to use lowercase asc/desc.",
        },
        {
          id: "repair-overshoot-pagination-note",
          priority: "minor",
          affectedArtifacts: ["endpoint.json", "evidence.jsonl", "usage.md"],
          objective: "Capture overshoot page exhaustion.",
          evidenceToUse: ["page=20000000 returns 200 with empty results"],
          expectedOutcome: "Pagination loops treat empty terminal pages as exhaustion.",
        },
      ],
      recommendedNextAgentInstruction: "Repair both tasks.",
      followUpProbeIdeas: [],
    };

    const narrowed = SemanticReviewReportSchema.parse(
      JSON.parse(filterReviewReportToRepairTask(JSON.stringify(report), "repair-order-case-sensitivity"))
    );

    expect(narrowed.repairTasks).toHaveLength(1);
    expect(narrowed.repairTasks[0].id).toBe("repair-order-case-sensitivity");
    expect(narrowed.recommendedNextAgentInstruction).toContain("Repair only 'repair-order-case-sensitivity'");
  });

  it("narrows a story report to one repair task", () => {
    const report = {
      question: "Can the MCP tell a story?",
      status: "needs_repair",
      confidence: "high",
      summary: "Story gate found a semantic gap.",
      endpointsUsed: [],
      mcpCalls: [],
      story: "The story worked but exposed a gap.",
      keyFindings: [],
      mcpGaps: [],
      repairTasks: [
        {
          id: "repair-story-gap",
          targetSlug: "v2__search__spending_by_award",
          priority: "major",
          affectedArtifacts: ["endpoint.json", "semantics.json", "usage.md"],
          objective: "Promote a missing nested request field.",
          evidenceToUse: ["Story MCP call succeeded with the missing field."],
          expectedOutcome: "MCP callers can discover and validate the field.",
        },
      ],
      recommendedNextStep: "Repair and rerun story gate.",
    };

    const narrowed = JSON.parse(filterReviewReportToRepairTask(JSON.stringify(report), "repair-story-gap"));

    expect(narrowed.repairTasks).toHaveLength(1);
    expect(narrowed.repairTasks[0].id).toBe("repair-story-gap");
    expect(narrowed.repairTasks[0].targetSlug).toBe("v2__search__spending_by_award");
    expect(narrowed.recommendedNextAgentInstruction).toContain("Repair only 'repair-story-gap'");
  });

  it("turns frontier story repair tasks into a runnable repair queue when target slugs are present", () => {
    const reports = [
      {
        challenge: {
          id: "contract-outlier-dashboard",
          question: "Can the MCP support a contract outlier dashboard?",
        },
        outputPath: join(repoRoot, "runs", "frontier", "contract-outlier-dashboard.json"),
        report: SemanticStoryReportSchema.parse({
          question: "Can the MCP support a contract outlier dashboard?",
          status: "needs_repair",
          confidence: "high",
          summary: "Useful, but one endpoint needs repair.",
          endpointsUsed: [],
          mcpCalls: [],
          story: "The story exposed a dashboard gap.",
          keyFindings: [],
          mcpGaps: [],
          repairTasks: [
            {
              id: "repair-dashboard-fields",
              targetSlug: "v2__search__spending_by_award",
              priority: "major",
              affectedArtifacts: ["endpoint.json", "semantics.json", "usage.md"],
              objective: "Add dashboard field guidance.",
              evidenceToUse: ["story_call_mcp_tool getEndpointSemantics showed no field bundle."],
              expectedOutcome: "Agents can discover dashboard fields without guessing.",
            },
          ],
          recommendedNextStep: "Repair and rerun the story gate.",
        }),
      },
      {
        challenge: {
          id: "cross-endpoint-handoff",
          question: "Can the MCP support a cross-endpoint handoff?",
        },
        outputPath: join(repoRoot, "runs", "frontier", "cross-endpoint-handoff.json"),
        report: SemanticStoryReportSchema.parse({
          question: "Can the MCP support a cross-endpoint handoff?",
          status: "needs_repair",
          confidence: "medium",
          summary: "Needs routing.",
          endpointsUsed: [],
          mcpCalls: [],
          story: "The story exposed a cross-endpoint gap.",
          keyFindings: [],
          mcpGaps: [],
          repairTasks: [
            {
              id: "repair-cross-endpoint",
              priority: "major",
              affectedArtifacts: ["semantics.json", "usage.md"],
              objective: "Clarify a cross-endpoint workflow.",
              evidenceToUse: ["story gate could not route the workflow."],
              expectedOutcome: "A human or planner can choose the owning endpoint.",
            },
          ],
          recommendedNextStep: "Route and repair.",
        }),
      },
    ];

    const queue = buildFrontierRepairQueue(reports, join(repoRoot, "runs", "frontier", "repair-work"));

    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      challengeId: "contract-outlier-dashboard",
      taskId: "repair-dashboard-fields",
      status: "ready",
      targetSlug: "v2__search__spending_by_award",
      priority: "major",
    });
    expect(queue[0].suggestedCommands?.runRepair).toContain("--slug 'v2__search__spending_by_award'");
    expect(queue[0].suggestedCommands?.runRepair).toContain("--task-id 'repair-dashboard-fields'");
    expect(queue[1]).toMatchObject({
      challengeId: "cross-endpoint-handoff",
      taskId: "repair-cross-endpoint",
      status: "needs_triage",
      triageReason: expect.stringContaining("targetSlug"),
    });
  });

  it("creates a model-owned story gate agent with only MCP story tools", async () => {
    const { agent, close } = createSemanticStoryAgent({
      model: "gpt-5.4",
      reasoningEffort: "medium",
      bundleGlob: "/repo/profiles/*/semantic/endpoint.json",
      requestTimeoutMs: 30000,
    });

    try {
      expect(agent.outputType).toBe(SemanticStoryReportSchema);
      expect(agent.tools.map((tool) => tool.name)).toEqual([
        "story_list_mcp_tools",
        "story_call_mcp_tool",
        "full_access_shell_command",
      ]);
      expect(String(agent.instructions)).toContain("agentic MCP acceptance test");
      expect(String(agent.instructions)).toContain("Use validateRequest before callEndpoint");
      expect(String(agent.instructions)).toContain("only promoted query surface");
      expect(String(agent.instructions)).toContain("usually 8-12 MCP calls are enough");
      expect(String(agent.instructions)).toContain("include evidence.jsonl in affectedArtifacts");
      expect(String(agent.instructions)).toContain("Full-access autonomous mode");
    } finally {
      await close();
    }
  });
});
