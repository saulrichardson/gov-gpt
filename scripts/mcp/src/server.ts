import { readFileSync } from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createToolErrorResult } from "./toolErrors.js";
import { scoreSearchQuery } from "./search.js";
import { loadSemanticBundles } from "./loadSemanticBundles.js";
import type { SemanticBundle } from "./loadSemanticBundles.js";
import { callSemanticEndpoint, validateSemanticRequest } from "./semanticRequest.js";
import {
  analysisPacketFromSemanticBundle,
  endpointSummaryFromSemanticBundle,
} from "./semanticDiscovery.js";

type LoadedSemanticBundles = ReturnType<typeof loadSemanticBundles>;

function summarizeParamNames(names: string[], max = 6): string {
  if (!Array.isArray(names) || names.length === 0) return "none";
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")}, +${names.length - max} more`;
}

function plannerStrategyHint(planner: any): string {
  if (!planner || typeof planner !== "object") return "no planner metadata";
  const parts: string[] = [];
  const required = Array.isArray(planner.requiredParams) ? planner.requiredParams : [];
  const optional = Array.isArray(planner.optionalParams) ? planner.optionalParams : [];
  const uncertainOptional = Array.isArray(planner.uncertainOptionalParams) ? planner.uncertainOptionalParams : [];
  const riskyOptional = Array.isArray(planner.riskyOptionalParams) ? planner.riskyOptionalParams : [];
  const query = Array.isArray(planner.queryParams) ? planner.queryParams : [];
  const body = Array.isArray(planner.bodyParams) ? planner.bodyParams : [];
  const path = Array.isArray(planner.pathParams) ? planner.pathParams : [];

  parts.push(`required=[${summarizeParamNames(required, 4)}]`);
  if (optional.length > 0) parts.push(`optionalSafe=[${summarizeParamNames(optional, 4)}]`);
  if (uncertainOptional.length > 0) parts.push(`optionalUncertain=[${summarizeParamNames(uncertainOptional, 4)}]`);
  if (riskyOptional.length > 0) parts.push(`optionalRisky=[${summarizeParamNames(riskyOptional, 4)}]`);
  parts.push(`locations(query=${query.length}, body=${body.length}, path=${path.length})`);

  if (planner.supportsFiltering) parts.push("supports=filtering");
  if (planner.supportsPagination) parts.push("supports=pagination");
  if (planner.supportsSorting) parts.push("supports=sorting");
  if (planner.supportsDateRange) parts.push("supports=date_range");
  return parts.join("; ");
}

function sortBySearchScore<T>(items: T[], score: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .map((candidate) => candidate.item);
}

function semanticSearchFields(bundle: SemanticBundle): string[] {
  const semantics = bundle.semantics;
  return [
    bundle.slug,
    bundle.endpoint.endpoint.path,
    semantics.summary,
    semantics.businessPurpose,
    semantics.analyticalGrain,
    ...semantics.primaryEntities.flatMap((item) => [item.name, item.description]),
    ...semantics.measures.flatMap((item) => [item.name, item.description]),
    ...semantics.dimensions.flatMap((item) => [item.name, item.description]),
    ...semantics.suitableQuestions.flatMap((item) => [item.name, item.description]),
    ...semantics.notSuitableFor.flatMap((item) => [item.name, item.description]),
    ...semantics.workflows.flatMap((workflow) => [workflow.name, workflow.description]),
    ...semantics.caveats.map((note) => note.statement),
  ];
}

function requireSemanticBundle(semanticLoaded: LoadedSemanticBundles, slug: string): SemanticBundle {
  const bundle = semanticLoaded.bundlesBySlug[slug];
  if (!bundle) {
    throw new Error(`unknown semantic slug: ${slug}`);
  }
  return bundle;
}

function rankedTemplates(bundle: SemanticBundle, useCase?: string) {
  return sortBySearchScore(bundle.endpoint.request.templates, (template) =>
    scoreSearchQuery(useCase, [template.name, template.description, bundle.slug, bundle.semantics.businessPurpose])
  );
}

function registerSemanticTools(server: any, semanticLoaded: LoadedSemanticBundles) {
  const semanticBySlug = semanticLoaded.bundlesBySlug;

  server.registerTool(
    "usaspending.findEndpoints",
    {
      description:
        "Search promoted USAspending semantic endpoints by business meaning, analytical grain, concepts, workflows, request strategy, slug, and API path.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ query, limit }: { query?: string; limit?: number }) => {
      try {
        const n = limit ?? 20;
        const discoverySummaries = semanticLoaded.bundles.map((bundle) => endpointSummaryFromSemanticBundle(bundle));
        const matches = discoverySummaries
          .map((summary, index) => {
            const semanticBundle = semanticBySlug[summary.slug];
            return {
              summary,
              index,
              score: scoreSearchQuery(query, [
                summary.slug,
                summary.path,
                summary.description || "",
                ...(summary.tags || []),
                ...(summary.capabilities || []),
                plannerStrategyHint((summary as any).planner),
                ...(semanticBundle ? semanticSearchFields(semanticBundle) : []),
              ]),
            };
          })
          .filter((candidate) => candidate.score > 0)
          .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.index - right.index;
          })
          .map((candidate) => candidate.summary);
        const results = matches.slice(0, n).map((summary) => ({
          ...summary,
          strategyHint: plannerStrategyHint((summary as any).planner),
          toolName: "usaspending.callEndpoint",
          schemaTool: "usaspending.getEndpointSchema",
          semanticsTool: "usaspending.getEndpointSemantics",
          schemaUri: `usaspending://semantic/schema/${summary.slug}`,
          semanticGuideUri: `usaspending://semantic/usage/${summary.slug}`,
          businessPurpose: semanticBySlug[summary.slug]?.semantics.businessPurpose,
          analyticalGrain: semanticBySlug[summary.slug]?.semantics.analyticalGrain,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
          structuredContent: { results },
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.findEndpoints", query, limit });
      }
    }
  );

  server.registerTool(
    "usaspending.findConcepts",
    {
      description:
        "Search semantic concepts, business purposes, analytical grains, measures, dimensions, and caveats across promoted USAspending semantic endpoint bundles.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ query, limit }: { query?: string; limit?: number }) => {
      try {
        const candidates = semanticLoaded.bundles.flatMap((bundle) => {
          const conceptGroups = [
            ["entity", bundle.semantics.primaryEntities],
            ["measure", bundle.semantics.measures],
            ["dimension", bundle.semantics.dimensions],
            ["suitable_question", bundle.semantics.suitableQuestions],
            ["not_suitable_for", bundle.semantics.notSuitableFor],
          ] as const;
          return conceptGroups.flatMap(([type, items]) =>
            items.map((item) => ({
              type,
              slug: bundle.slug,
              endpointPath: bundle.endpoint.endpoint.path,
              name: item.name,
              description: item.description,
              businessPurpose: bundle.semantics.businessPurpose,
              analyticalGrain: bundle.semantics.analyticalGrain,
              evidenceRefs: item.evidenceRefs,
              score: scoreSearchQuery(query, [
                type,
                item.name,
                item.description,
                bundle.slug,
                bundle.semantics.summary,
                bundle.semantics.businessPurpose,
                bundle.semantics.analyticalGrain,
              ]),
            }))
          );
        });
        const results = candidates
          .filter((candidate) => candidate.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, limit ?? 20)
          .map(({ score, ...rest }) => rest);
        return {
          content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
          structuredContent: { results },
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.findConcepts", query, limit });
      }
    }
  );

  server.registerTool(
    "usaspending.findWorkflows",
    {
      description:
        "Search evidence-backed higher-level workflows that combine endpoint semantics, request templates, caveats, and follow-up calls.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ query, limit }: { query?: string; limit?: number }) => {
      try {
        const candidates = semanticLoaded.bundles.flatMap((bundle) =>
          bundle.semantics.workflows.map((workflow) => ({
            slug: bundle.slug,
            endpointPath: bundle.endpoint.endpoint.path,
            name: workflow.name,
            description: workflow.description,
            steps: workflow.steps,
            evidenceRefs: workflow.evidenceRefs,
            businessPurpose: bundle.semantics.businessPurpose,
            score: scoreSearchQuery(query, [
              workflow.name,
              workflow.description,
              ...workflow.steps.map((step) => step.action),
              bundle.slug,
              bundle.semantics.businessPurpose,
              bundle.semantics.analyticalGrain,
            ]),
          }))
        );
        const results = candidates
          .filter((candidate) => candidate.score > 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, limit ?? 20)
          .map(({ score, ...rest }) => rest);
        return {
          content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
          structuredContent: { results },
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.findWorkflows", query, limit });
      }
    }
  );

  server.registerTool(
    "usaspending.getEndpointSchema",
    {
      description:
        "Get the promoted Semantic Profile V2 endpoint schema: request facts, response facts, availability, templates, behavior notes, and validation warnings.",
      inputSchema: {
        slug: z.string(),
      },
    },
    async ({ slug }: { slug: string }) => {
      try {
        const bundle = requireSemanticBundle(semanticLoaded, slug);
        return {
          content: [{ type: "text", text: JSON.stringify(bundle.endpoint, null, 2) }],
          structuredContent: bundle.endpoint as any,
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.getEndpointSchema", slug });
      }
    }
  );

  server.registerTool(
    "usaspending.getEndpointSemantics",
    {
      description:
        "Get business meaning for a promoted endpoint: purpose, analytical grain, entities, measures, dimensions, suitable questions, joins, workflows, and caveats.",
      inputSchema: {
        slug: z.string(),
      },
    },
    async ({ slug }: { slug: string }) => {
      try {
        const bundle = requireSemanticBundle(semanticLoaded, slug);
        return {
          content: [{ type: "text", text: JSON.stringify(bundle.semantics, null, 2) }],
          structuredContent: bundle.semantics as any,
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.getEndpointSemantics", slug });
      }
    }
  );

  server.registerTool(
    "usaspending.getAnalysisPacket",
    {
      description:
        "Get a consolidated semantic analysis packet for a promoted endpoint: purpose, grain, request construction, workflows, caveats, response interpretation, evidence refs, and optional usage/evidence detail.",
      inputSchema: {
        slug: z.string(),
        includeUsageGuide: z.boolean().optional(),
        includeEvidence: z.boolean().optional(),
      },
    },
    async ({
      slug,
      includeUsageGuide,
      includeEvidence,
    }: {
      slug: string;
      includeUsageGuide?: boolean;
      includeEvidence?: boolean;
    }) => {
      try {
        const bundle = requireSemanticBundle(semanticLoaded, slug);
        const payload = analysisPacketFromSemanticBundle(bundle, { includeUsageGuide, includeEvidence });
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload as any,
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.getAnalysisPacket", slug });
      }
    }
  );

  server.registerTool(
    "usaspending.getUsageGuide",
    {
      description: "Get the caller-facing semantic usage guide for a promoted endpoint.",
      inputSchema: {
        slug: z.string(),
      },
    },
    async ({ slug }: { slug: string }) => {
      try {
        const bundle = requireSemanticBundle(semanticLoaded, slug);
        const payload = { slug, usage: bundle.usage };
        return {
          content: [{ type: "text", text: bundle.usage }],
          structuredContent: payload,
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.getUsageGuide", slug });
      }
    }
  );

  server.registerTool(
    "usaspending.getRequestTemplate",
    {
      description: "Return evidence-backed request templates for a promoted semantic endpoint, optionally ranked by use case.",
      inputSchema: {
        slug: z.string(),
        useCase: z.string().optional(),
      },
    },
    async ({ slug, useCase }: { slug: string; useCase?: string }) => {
      try {
        const bundle = requireSemanticBundle(semanticLoaded, slug);
        const templates = rankedTemplates(bundle, useCase);
        const payload = {
          slug,
          templates,
          usageGuideUri: `usaspending://semantic/usage/${slug}`,
          schemaUri: `usaspending://semantic/schema/${slug}`,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload as any,
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.getRequestTemplate", slug, useCase });
      }
    }
  );

  server.registerTool(
    "usaspending.listRequestFields",
    {
      description:
        "List request fields for a promoted semantic endpoint, including nested filters and live/documented status classifications.",
      inputSchema: {
        slug: z.string(),
        status: z.string().optional(),
      },
    },
    async ({ slug, status }: { slug: string; status?: string }) => {
      try {
        const bundle = requireSemanticBundle(semanticLoaded, slug);
        const fields = bundle.endpoint.request.parameters.filter((field) => !status || field.status === status);
        const payload = { slug, fields };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload as any,
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.listRequestFields", slug, status });
      }
    }
  );

  server.registerTool(
    "usaspending.validateRequest",
    {
      description:
        "Preflight a proposed semantic request against known required fields, statuses, enum values, contradictions, and current evidence-backed caveats.",
      inputSchema: {
        slug: z.string(),
        request: z.any(),
      },
    },
    async ({ slug, request }: { slug: string; request: any }) => {
      try {
        const bundle = requireSemanticBundle(semanticLoaded, slug);
        const validation = validateSemanticRequest(bundle.endpoint, request);
        return {
          content: [{ type: "text", text: JSON.stringify(validation, null, 2) }],
          structuredContent: validation as any,
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.validateRequest", slug, request });
      }
    }
  );

  server.registerTool(
    "usaspending.explainValidationError",
    {
      description:
        "Explain why a proposed request is risky or invalid using the semantic bundle's request facts, statuses, contradictions, and evidence references.",
      inputSchema: {
        slug: z.string(),
        request: z.any(),
        error: z.string().optional(),
      },
    },
    async ({ slug, request, error }: { slug: string; request: any; error?: string }) => {
      try {
        const bundle = requireSemanticBundle(semanticLoaded, slug);
        const validation = validateSemanticRequest(bundle.endpoint, request);
        const payload = {
          slug,
          inputError: error,
          valid: validation.valid,
          errors: validation.errors,
          warnings: validation.warnings,
          relevantCaveats: [
            ...bundle.endpoint.behavior.contradictions,
            ...bundle.endpoint.behavior.quirks,
            ...bundle.endpoint.behavior.gaps,
            ...bundle.endpoint.behavior.risks,
          ],
          usageGuideUri: `usaspending://semantic/usage/${slug}`,
          evidenceUri: `usaspending://semantic/evidence/${slug}`,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload as any,
        };
      } catch (caught) {
        return createToolErrorResult(caught, { tool: "usaspending.explainValidationError", slug, request, error });
      }
    }
  );

  server.registerTool(
    "usaspending.callEndpoint",
    {
      description:
        "Call a promoted semantic endpoint by slug after semantic preflight validation. Prefer this after getEndpointSemantics/getRequestTemplate for non-trivial calls.",
      inputSchema: {
        slug: z.string(),
        request: z.any(),
      },
    },
    async ({ slug, request }: { slug: string; request: any }) => {
      try {
        const bundle = requireSemanticBundle(semanticLoaded, slug);
        const result = await callSemanticEndpoint(bundle.endpoint, request);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as any,
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.callEndpoint", slug, request });
      }
    }
  );

  server.registerTool(
    "usaspending.getEvidence",
    {
      description: "Get evidence.jsonl records for a promoted semantic endpoint bundle.",
      inputSchema: {
        slug: z.string(),
        refs: z.array(z.string()).optional(),
      },
    },
    async ({ slug, refs }: { slug: string; refs?: string[] }) => {
      try {
        const semanticBundle = requireSemanticBundle(semanticLoaded, slug);
        const wanted = new Set(refs ?? []);
        const records =
          wanted.size > 0 ? semanticBundle.evidence.filter((record) => wanted.has(record.id)) : semanticBundle.evidence;
        const payload = {
          slug,
          records,
          missingRefs: wanted.size > 0 ? [...wanted].filter((ref) => !records.some((record) => record.id === ref)) : [],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload as any,
        };
      } catch (error) {
        return createToolErrorResult(error, { tool: "usaspending.getEvidence", slug });
      }
    }
  );

  server.registerResource(
    "semantic_all",
    "usaspending://semantic/all",
    {
      mimeType: "application/json",
      description: "All promoted Semantic Profile V2 endpoint bundles in one payload.",
    },
    async (uri: any) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(
            semanticLoaded.bundles.map((bundle) => ({
              endpoint: bundle.endpoint,
              semantics: bundle.semantics,
              evidence: bundle.evidence,
              usage: bundle.usage,
            })),
            null,
            2
          ),
        },
      ],
    })
  );

  for (const bundle of semanticLoaded.bundles) {
    const slug = bundle.slug;
    server.registerResource(
      `semantic_schema_${slug}`,
      `usaspending://semantic/schema/${slug}`,
      {
        mimeType: "application/json",
        description: "Semantic Profile V2 endpoint schema.",
      },
      async (uri: any) => ({
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: readFileSync(bundle.paths.endpoint, "utf-8"),
          },
        ],
      })
    );

    server.registerResource(
      `semantic_semantics_${slug}`,
      `usaspending://semantic/semantics/${slug}`,
      {
        mimeType: "application/json",
        description: "Semantic Profile V2 business semantics.",
      },
      async (uri: any) => ({
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: readFileSync(bundle.paths.semantics, "utf-8"),
          },
        ],
      })
    );

    server.registerResource(
      `semantic_evidence_${slug}`,
      `usaspending://semantic/evidence/${slug}`,
      {
        mimeType: "application/jsonl",
        description: "Semantic Profile V2 evidence ledger.",
      },
      async (uri: any) => ({
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/jsonl",
            text: readFileSync(bundle.paths.evidence, "utf-8"),
          },
        ],
      })
    );

    server.registerResource(
      `semantic_usage_${slug}`,
      `usaspending://semantic/usage/${slug}`,
      {
        mimeType: "text/markdown",
        description: "Caller-facing semantic usage guide.",
      },
      async (uri: any) => ({
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/markdown",
            text: readFileSync(bundle.paths.usage, "utf-8"),
          },
        ],
      })
    );
  }
}

async function main() {
  const semanticLoaded = loadSemanticBundles();
  if (semanticLoaded.bundles.length === 0) {
    throw new Error("[SEMANTIC_BUNDLE_LOAD_FAILED] semanticBundleCount=0");
  }

  const schemaVersions = Array.from(new Set(semanticLoaded.bundles.map((bundle) => bundle.endpoint.schemaVersion)));
  const startupLog = {
    event: "mcp_startup",
    schemaVersions,
    semanticBundleCount: semanticLoaded.bundles.length,
    publicToolMode: "semantic_only",
    semanticSlugs: semanticLoaded.bundles.map((bundle) => bundle.slug),
    buildVersion: process.env.BUILD_VERSION || "dev",
  };
  console.error(JSON.stringify(startupLog));

  const server = new McpServer({
    name: "usaspending-mcp-server",
    version: "0.1.0",
  }) as any;
  registerSemanticTools(server, semanticLoaded);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    JSON.stringify({
      event: "mcp_listening",
      schemaVersions,
      semanticBundleCount: semanticLoaded.bundles.length,
      publicToolMode: "semantic_only",
      buildVersion: process.env.BUILD_VERSION || "dev",
    })
  );
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "mcp_fatal", detail }));
  process.exit(1);
});
