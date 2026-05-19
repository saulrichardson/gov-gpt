import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, cpSync } from "fs";
import { join, relative } from "path";
import { promisify } from "util";
import { tool } from "@openai/agents";
import { z } from "zod";
import { AgentRunSummarySchema, ARTIFACT_FILE_NAMES, ArtifactFileNameSchema } from "./artifactContract.js";
import { assertSafeOutputRoot, assertSafeReadablePath, repoRelative, repoRoot } from "./paths.js";
import { SemanticStoryReportSchema, type SemanticStoryReport } from "./storyContract.js";

const execFileAsync = promisify(execFile);
const USA_SPENDING_HOST = "https://api.usaspending.gov";

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function readOptional(path: string, maxChars: number): string | null {
  if (!existsSync(path)) return null;
  return truncateText(readFileSync(path, "utf-8"), maxChars);
}

function docPathForSlug(slug: string): string {
  const [version, ...rest] = slug.split("__");
  if (!version || rest.length === 0) throw new Error(`invalid slug: ${slug}`);
  return join(repoRoot, "staging", "docs", version, `${rest.join("/")}.md`);
}

function maybeJsonSample(value: unknown, maxChars: number): unknown {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return value;
  return {
    truncated: true,
    sample: text.slice(0, maxChars),
    omittedChars: text.length - maxChars,
  };
}

function parseJsonObject(raw: string, fieldName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: any) {
    throw new Error(`${fieldName} must be valid JSON: ${error?.message ?? error}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeQueryValue(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error(`query values must be strings, numbers, booleans, or arrays; got ${JSON.stringify(value)}`);
}

function outputDir(outRoot: string, slug: string): string {
  return join(assertSafeOutputRoot(outRoot), slug);
}

function promotedDir(slug: string): string {
  return join(repoRoot, "profiles", slug, "semantic");
}

function requiredArtifactInventory(slug: string, outRoot: string) {
  const dir = outputDir(outRoot, slug);
  const requiredFiles = ARTIFACT_FILE_NAMES.map((fileName) => {
    const path = join(dir, fileName);
    const exists = existsSync(path);
    return {
      fileName,
      path: repoRelative(path),
      exists,
      bytes: exists ? statSync(path).size : 0,
    };
  });
  return {
    path: repoRelative(dir),
    requiredFiles,
    missingRequiredFiles: requiredFiles.filter((file) => !file.exists).map((file) => file.fileName),
    complete: requiredFiles.every((file) => file.exists),
  };
}

function canonicalBundleIsComplete(dir: string): boolean {
  return ARTIFACT_FILE_NAMES.every((fileName) => existsSync(join(dir, fileName)));
}

function copyCanonicalBundle(fromDir: string, toDir: string) {
  for (const fileName of ARTIFACT_FILE_NAMES) {
    const source = join(fromDir, fileName);
    if (!existsSync(source)) throw new Error(`missing source artifact: ${repoRelative(source)}`);
  }
  mkdirSync(toDir, { recursive: true });
  for (const fileName of ARTIFACT_FILE_NAMES) {
    cpSync(join(fromDir, fileName), join(toDir, fileName));
  }
}

function storyGateDir(outRoot: string, slug: string): string {
  return join(assertSafeOutputRoot(outRoot), "_story-gates", slug);
}

function selfStoryReportPath(outRoot: string, slug: string): string {
  return join(storyGateDir(outRoot, slug), "self-story-report.json");
}

function analyzeSelfStoryReport(slug: string, report: SemanticStoryReport) {
  const ownedGaps = report.mcpGaps.filter((gap) => !gap.affectedSlug || gap.affectedSlug === slug);
  const ownedRepairTasks = report.repairTasks.filter((task) => !task.targetSlug || task.targetSlug === slug);
  const blockingOwnedGaps = ownedGaps.filter((gap) => gap.severity === "blocker" || gap.severity === "major");
  const blockingOwnedRepairTasks = ownedRepairTasks.filter(
    (task) => task.priority === "blocker" || task.priority === "major"
  );
  const readyForFinalize =
    report.status !== "blocked" && blockingOwnedGaps.length === 0 && blockingOwnedRepairTasks.length === 0;

  return {
    readyForFinalize,
    report,
    ownedGaps,
    ownedRepairTasks,
    blockingOwnedGaps,
    blockingOwnedRepairTasks,
  };
}

function readSelfStoryReadiness(slug: string, outRoot: string) {
  const reportPath = selfStoryReportPath(outRoot, slug);
  const relReportPath = repoRelative(reportPath);
  if (!existsSync(reportPath)) {
    return {
      exists: false,
      readyForFinalize: false,
      reportPath: relReportPath,
      recommendation: "Call run_self_story_gate before promotion or finalization.",
    };
  }

  const report = SemanticStoryReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf-8")));
  return {
    exists: true,
    reportPath: relReportPath,
    ...analyzeSelfStoryReport(slug, report),
  };
}

function requireSelfStoryReady(slug: string, outRoot: string) {
  const readiness = readSelfStoryReadiness(slug, outRoot);
  if (readiness.readyForFinalize) return readiness;

  const blockingGaps = "blockingOwnedGaps" in readiness ? readiness.blockingOwnedGaps : [];
  const blockingTasks = "blockingOwnedRepairTasks" in readiness ? readiness.blockingOwnedRepairTasks : [];
  throw new Error(
    [
      `self-story gate is required before promotion/finalization for ${slug}`,
      `report: ${readiness.reportPath}`,
      `blocking owned gaps: ${blockingGaps.map((gap) => gap.title).join(", ") || "none"}`,
      `blocking owned repair tasks: ${blockingTasks.map((task) => task.id).join(", ") || "none"}`,
      readiness.recommendation ?? "Repair the owned story gaps, rerun validation, and rerun run_self_story_gate.",
    ].join("\n")
  );
}

function stageSelfStoryBundles(slug: string, outRoot: string) {
  const gateDir = storyGateDir(outRoot, slug);
  const bundlesDir = join(gateDir, "bundles");
  rmSync(bundlesDir, { recursive: true, force: true });
  mkdirSync(bundlesDir, { recursive: true });

  const stagedSlugs: string[] = [];
  const skippedPromotedSlugs: string[] = [];
  const profilesRoot = join(repoRoot, "profiles");
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === slug) continue;
      const semanticDir = join(profilesRoot, entry.name, "semantic");
      if (!existsSync(join(semanticDir, "endpoint.json"))) continue;
      if (!canonicalBundleIsComplete(semanticDir)) {
        skippedPromotedSlugs.push(entry.name);
        continue;
      }
      copyCanonicalBundle(semanticDir, join(bundlesDir, entry.name));
      stagedSlugs.push(entry.name);
    }
  }

  copyCanonicalBundle(outputDir(outRoot, slug), join(bundlesDir, slug));
  stagedSlugs.push(slug);

  return {
    gateDir,
    bundlesDir,
    bundleGlob: join(bundlesDir, "*", "endpoint.json"),
    stagedSlugs: stagedSlugs.sort(),
    skippedPromotedSlugs: skippedPromotedSlugs.sort(),
  };
}

async function runCommand(command: string, args: string[], timeoutMs: number) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: repoRoot,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 4,
      env: process.env,
    });
    return {
      ok: true,
      stdout: truncateText(result.stdout, 6000),
      stderr: truncateText(result.stderr, 6000),
    };
  } catch (error: any) {
    return {
      ok: false,
      stdout: truncateText(String(error?.stdout ?? ""), 6000),
      stderr: truncateText(String(error?.stderr ?? error?.message ?? error), 6000),
    };
  }
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("command did not print a JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

async function validateAndSummarize(slug: string, outRoot: string, promoted: boolean, reason: string) {
  const resolvedOutRoot = assertSafeOutputRoot(outRoot);
  const relOutRoot = relative(repoRoot, resolvedOutRoot);
  const validation = await runCommand(
    "npm",
    ["--prefix", "scripts/agents", "run", "semantic:validate", "--", "--root", relOutRoot],
    60_000
  );

  if (!validation.ok) {
    throw new Error(`semantic bundle validation failed before finalize:\n${validation.stdout}\n${validation.stderr}`);
  }

  const parsed = extractJsonObject(validation.stdout) as any;
  const result = parsed?.results?.find((item: any) => item?.slug === slug);
  if (!result) throw new Error(`validator output did not include slug '${slug}'`);

  const inventory = requiredArtifactInventory(slug, outRoot);
  if (!inventory.complete) {
    throw new Error(
      [
        `semantic bundle finalization requires the four canonical artifacts under ${inventory.path}`,
        `missing: ${inventory.missingRequiredFiles.join(", ")}`,
        "Write or move the files into the declared output directory, then rerun validate_semantic_bundle and finalize_validated_bundle.",
      ].join("\n")
    );
  }
  const artifacts = inventory.requiredFiles.map((file) => file.path);
  const storyReadiness = requireSelfStoryReady(slug, outRoot);
  const storyReport = "report" in storyReadiness ? storyReadiness.report : null;

  return AgentRunSummarySchema.parse({
    slug,
    status: "completed",
    outputRoot: relOutRoot,
    promoted,
    validationPassed: true,
    summary: reason,
    keyFindings: [
      `Validator accepted ${result.requestFacts} request facts and ${result.responseFacts} response facts.`,
      `Availability is ${result.availability}.`,
      `Evidence records: ${result.evidenceRecords}.`,
      `Self-story gate ${storyReport?.status ?? "unknown"}: ${storyReport?.summary ?? "ready"}`,
    ],
    artifacts,
    nextSteps: promoted
      ? ["Run MCP semantic validation and smoke checks against the promoted bundle."]
      : ["Review the generated semantic bundle, then rerun with --promote if it should become part of the MCP surface."],
  });
}

export function createEndpointAgentTools(defaultOutRoot: string) {
  const loadEndpointContext = tool({
    name: "load_endpoint_context",
    description:
      "Load source-of-truth context for one USAspending endpoint slug: staged docs, semantic schema docs, operating model, and existing semantic bundle if any.",
    parameters: z.object({
      slug: z.string(),
      maxCharsPerFile: z.number().int().positive().max(40000),
    }),
    execute: async ({ slug, maxCharsPerFile }) => {
      const stagedDocPath = docPathForSlug(slug);
      const existingSemanticPath = join(repoRoot, "profiles", slug, "semantic", "endpoint.json");
      return {
        repoRoot,
        slug,
        stagedDocPath: repoRelative(stagedDocPath),
        stagedDoc: readOptional(stagedDocPath, maxCharsPerFile),
        semanticProfileGuidePath: "docs/semantic-profile-v2.md",
        semanticProfileGuide: readOptional(join(repoRoot, "docs", "semantic-profile-v2.md"), maxCharsPerFile),
        mcpTargetShapePath: "docs/mcp-target-shape.md",
        mcpTargetShape: readOptional(join(repoRoot, "docs", "mcp-target-shape.md"), maxCharsPerFile),
        operatingModelPath: "docs/semantic-agent-operating-model.md",
        operatingModel: readOptional(join(repoRoot, "docs", "semantic-agent-operating-model.md"), maxCharsPerFile),
        schemaSourcePath: "src/agent/core/semanticProfileSchema.ts",
        schemaSource: readOptional(join(repoRoot, "src", "agent", "core", "semanticProfileSchema.ts"), maxCharsPerFile),
        existingSemanticBundlePath: repoRelative(existingSemanticPath),
        existingSemanticBundle: readOptional(existingSemanticPath, Math.min(maxCharsPerFile, 12000)),
      };
    },
  });

  const readRepoFile = tool({
    name: "read_repo_file",
    description:
      "Read a non-secret repository file by path. Use this to inspect local source, docs, tests, or profile artifacts before making claims.",
    parameters: z.object({
      path: z.string(),
      maxChars: z.number().int().positive().max(50000),
    }),
    execute: async ({ path, maxChars }) => {
      const resolved = assertSafeReadablePath(path);
      if (!existsSync(resolved)) throw new Error(`file not found: ${path}`);
      return {
        path: repoRelative(resolved),
        text: truncateText(readFileSync(resolved, "utf-8"), maxChars),
      };
    },
  });

  const searchRepo = tool({
    name: "search_repo",
    description:
      "Search the repository with ripgrep. Use for finding USAspending source views, validators, tests, docs, and existing examples.",
    parameters: z.object({
      query: z.string(),
      globs: z.array(z.string()),
      maxMatches: z.number().int().positive().max(200),
    }),
    execute: async ({ query, globs, maxMatches }) => {
      const args = ["--line-number", "--no-heading", "--color", "never", "--fixed-strings", query];
      for (const glob of globs) args.push("--glob", glob);
      args.push(repoRoot);
      const result = await runCommand("rg", args, 20_000);
      const lines = result.stdout
        .split("\n")
        .filter(Boolean)
        .slice(0, maxMatches)
        .map((line) => line.replace(`${repoRoot}/`, ""));
      return {
        ok: result.ok || lines.length > 0,
        query,
        matches: lines,
        stderr: result.ok ? undefined : result.stderr,
      };
    },
  });

  const listDirectory = tool({
    name: "list_directory",
    description: "List a repository directory so the agent can discover nearby docs, source files, or output files.",
    parameters: z.object({
      path: z.string(),
    }),
    execute: async ({ path }) => {
      const resolved = assertSafeReadablePath(path);
      if (!existsSync(resolved)) throw new Error(`directory not found: ${path}`);
      if (!statSync(resolved).isDirectory()) throw new Error(`not a directory: ${path}`);
      return {
        path: repoRelative(resolved),
        entries: readdirSync(resolved, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        })),
      };
    },
  });

  const probeUsaspendingApi = tool({
    name: "probe_usaspending_api",
    description:
      "Call the live USAspending API with a scoped probe. Use this to test documented behavior, contradictions, validation errors, defaults, pagination, and response grain.",
    parameters: z.object({
      method: z.enum(["GET", "POST"]),
      path: z.string().startsWith("/api/"),
      queryJson: z.string(),
      bodyJson: z.string().nullable(),
      probeName: z.string(),
      maxBodyChars: z.number().int().positive().max(50000),
    }),
    execute: async ({ method, path, queryJson, bodyJson, probeName, maxBodyChars }) => {
      const query = parseJsonObject(queryJson, "queryJson");
      const body = bodyJson === null ? null : parseJsonObject(bodyJson, "bodyJson");
      const url = new URL(path, USA_SPENDING_HOST);
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, normalizeQueryValue(value));
      }
      const response = await fetch(url, {
        method,
        headers: {
          "user-agent": "gov-gpt-agents-sdk/0.1.0",
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = truncateText(text, maxBodyChars);
      }
      return {
        probeName,
        request: {
          method,
          url: url.toString(),
          path,
          query,
          body: method === "POST" ? body ?? {} : undefined,
        },
        response: {
          status: response.status,
          ok: response.ok,
          contentType: response.headers.get("content-type") ?? undefined,
          bodySample: maybeJsonSample(parsed, maxBodyChars),
        },
      };
    },
  });

  const writeArtifactFile = tool({
    name: "write_artifact_file",
    description:
      "Write one semantic bundle artifact exactly as authored by the agent. The agent owns the JSON/prose content; this tool only writes the file.",
    parameters: z.object({
      slug: z.string(),
      outRoot: z.string(),
      fileName: ArtifactFileNameSchema,
      content: z.string(),
    }),
    execute: async ({ slug, outRoot, fileName, content }) => {
      const dir = outputDir(outRoot, slug);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, fileName);
      writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`, "utf-8");
      return {
        path: repoRelative(path),
        bytes: Buffer.byteLength(content),
      };
    },
  });

  const validateSemanticBundle = tool({
    name: "validate_semantic_bundle",
    description:
      "Run the semantic bundle validator against an output root. Use after writing endpoint.json, semantics.json, evidence.jsonl, and usage.md.",
    parameters: z.object({
      outRoot: z.string(),
    }),
    execute: async ({ outRoot }) => {
      const resolvedOutRoot = assertSafeOutputRoot(outRoot);
      const relOutRoot = relative(repoRoot, resolvedOutRoot);
      const result = await runCommand(
        "npm",
        ["--prefix", "scripts/agents", "run", "semantic:validate", "--", "--root", relOutRoot],
        60_000
      );
      return {
        ok: result.ok,
        outRoot: relOutRoot,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  });

  const runSelfStoryGate = tool({
    name: "run_self_story_gate",
    description:
      "Run an in-loop MCP story gate against the generated bundle plus promoted semantic bundles. Use this before promotion/finalization so the producer can repair story-level MCP usability gaps it owns.",
    parameters: z.object({
      slug: z.string(),
      outRoot: z.string(),
      question: z.string().min(20),
      maxTurns: z.number().int().min(4).max(40).default(18),
      timeoutMs: z.number().int().min(60_000).max(900_000).default(360_000),
      requestTimeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
    }),
    execute: async ({ slug, outRoot, question, maxTurns, timeoutMs, requestTimeoutMs }) => {
      const inventory = requiredArtifactInventory(slug, outRoot);
      if (!inventory.complete) {
        return {
          ok: false,
          phase: "artifact_inventory",
          readyForFinalize: false,
          inventory,
          recommendation:
            "Write endpoint.json, semantics.json, evidence.jsonl, and usage.md under the declared output directory, then validate and rerun the self-story gate.",
        };
      }

      const resolvedOutRoot = assertSafeOutputRoot(outRoot);
      const relOutRoot = relative(repoRoot, resolvedOutRoot);
      const validation = await runCommand(
        "npm",
        ["--prefix", "scripts/agents", "run", "semantic:validate", "--", "--root", relOutRoot],
        60_000
      );
      if (!validation.ok) {
        return {
          ok: false,
          phase: "semantic_validation",
          readyForFinalize: false,
          validation,
          recommendation: "Fix validation errors before running the MCP story gate.",
        };
      }

      const staged = stageSelfStoryBundles(slug, outRoot);
      const reportPath = selfStoryReportPath(outRoot, slug);
      const relReportPath = relative(repoRoot, reportPath);
      const storyRun = await runCommand(
        "npm",
        [
          "--prefix",
          "scripts/agents",
          "run",
          "semantic:story",
          "--",
          "--question",
          question,
          "--bundle-glob",
          staged.bundleGlob,
          "--output",
          relReportPath,
          "--quiet-events",
          "--max-turns",
          String(maxTurns),
          "--timeout-ms",
          String(timeoutMs),
          "--request-timeout-ms",
          String(requestTimeoutMs),
          "--autonomy",
          "full_access",
        ],
        timeoutMs + 15_000
      );

      if (!storyRun.ok || !existsSync(reportPath)) {
        return {
          ok: false,
          phase: "mcp_story_gate",
          readyForFinalize: false,
          reportPath: relReportPath,
          bundleGlob: staged.bundleGlob,
          stagedSlugs: staged.stagedSlugs,
          skippedPromotedSlugs: staged.skippedPromotedSlugs,
          command: storyRun,
          recommendation: "Inspect the story-gate failure, fix setup or artifacts, then rerun the self-story gate.",
        };
      }

      const report = SemanticStoryReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf-8")));
      const readiness = analyzeSelfStoryReport(slug, report);

      return {
        ok: true,
        phase: "mcp_story_gate",
        readyForFinalize: readiness.readyForFinalize,
        reportPath: relReportPath,
        bundleGlob: staged.bundleGlob,
        stagedSlugs: staged.stagedSlugs,
        skippedPromotedSlugs: staged.skippedPromotedSlugs,
        report: readiness.report,
        ownedGaps: readiness.ownedGaps,
        ownedRepairTasks: readiness.ownedRepairTasks,
        blockingOwnedGaps: readiness.blockingOwnedGaps,
        blockingOwnedRepairTasks: readiness.blockingOwnedRepairTasks,
        recommendation: readiness.readyForFinalize
          ? "No blocker or major self-story gaps were assigned to this slug. You may proceed to promotion/finalization after any final validation required by the instructions."
          : "Repair the owned blocker/major story gaps in the bundle, rerun validation, then rerun run_self_story_gate before finalization.",
      };
    },
  });

  const promoteSemanticBundle = tool({
    name: "promote_semantic_bundle",
    description:
      "Promote a validated bundle from the output root to profiles/<slug>/semantic. Only use when the run task explicitly asks for promotion.",
    parameters: z.object({
      slug: z.string(),
      outRoot: z.string(),
    }),
    execute: async ({ slug, outRoot }) => {
      const validation = await runCommand(
        "npm",
        [
          "--prefix",
          "scripts/agents",
          "run",
          "semantic:validate",
          "--",
          "--root",
          relative(repoRoot, assertSafeOutputRoot(outRoot)),
        ],
        60_000
      );
      if (!validation.ok) {
        return {
          ok: false,
          promoted: false,
          validation,
        };
      }

      const storyReadiness = readSelfStoryReadiness(slug, outRoot);
      if (!storyReadiness.readyForFinalize) {
        return {
          ok: false,
          promoted: false,
          validation,
          storyGate: storyReadiness,
          recommendation: "Call run_self_story_gate, repair any owned blocker/major gaps, then rerun promotion.",
        };
      }

      const fromDir = outputDir(outRoot, slug);
      const toDir = promotedDir(slug);
      for (const fileName of ARTIFACT_FILE_NAMES) {
        const source = join(fromDir, fileName);
        if (!existsSync(source)) throw new Error(`missing source artifact: ${repoRelative(source)}`);
      }
      mkdirSync(toDir, { recursive: true });
      for (const fileName of ARTIFACT_FILE_NAMES) {
        cpSync(join(fromDir, fileName), join(toDir, fileName));
      }
      return {
        ok: true,
        promoted: true,
        from: repoRelative(fromDir),
        to: repoRelative(toDir),
      };
    },
  });

  const finalizeValidatedBundle = tool({
    name: "finalize_validated_bundle",
    description:
      "Validate the semantic bundle, require self-story readiness, and return the final AgentRunSummary. Call this only after final artifact edits are complete; the run stops when this succeeds.",
    parameters: z.object({
      slug: z.string(),
      outRoot: z.string(),
      promoted: z.boolean(),
      summary: z.string(),
    }),
    execute: async ({ slug, outRoot, promoted, summary }) => {
      return validateAndSummarize(slug, outRoot, promoted, summary);
    },
  });

  const listOutputFiles = tool({
    name: "list_output_files",
    description: "List files currently written for a slug under the output root.",
    parameters: z.object({
      slug: z.string(),
      outRoot: z.string(),
    }),
    execute: async ({ slug, outRoot }) => {
      const dir = outputDir(outRoot, slug);
      const inventory = requiredArtifactInventory(slug, outRoot);
      if (!existsSync(dir)) return { ...inventory, files: [] };
      return {
        ...inventory,
        files: readdirSync(dir)
          .sort()
          .map((fileName) => {
            const path = join(dir, fileName);
            const stat = statSync(path);
            return {
              fileName,
              path: repoRelative(path),
              type: stat.isDirectory() ? "directory" : "file",
              bytes: stat.isFile() ? stat.size : 0,
            };
          }),
      };
    },
  });

  return [
    loadEndpointContext,
    readRepoFile,
    searchRepo,
    listDirectory,
    probeUsaspendingApi,
    writeArtifactFile,
    validateSemanticBundle,
    runSelfStoryGate,
    promoteSemanticBundle,
    finalizeValidatedBundle,
    listOutputFiles,
  ];
}
