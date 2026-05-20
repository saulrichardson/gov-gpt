import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { loadSemanticBundles } from "../src/loadSemanticBundles.js";
import { scoreSearchQuery } from "../src/search.js";
import {
  analysisPacketFromSemanticBundle,
  endpointSummaryFromSemanticBundle,
} from "../src/semanticDiscovery.js";
import { callSemanticEndpoint, validateSemanticRequest } from "../src/semanticRequest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..", "..");

function requestFact(overrides: Record<string, unknown>) {
  return {
    path: "field",
    direction: "request",
    location: "body",
    type: "string",
    required: false,
    status: "documented_and_observed",
    description: "Test request fact",
    evidenceRefs: ["ev-test"],
    ...overrides,
  };
}

function endpointWithRequestFacts(parameters: Array<Record<string, unknown>>, endpoint = {}) {
  return {
    schemaVersion: "2.0.0",
    slug: "test_endpoint",
    generatedAt: "2026-05-11T00:00:00Z",
    endpoint: {
      method: "POST",
      host: "https://api.usaspending.gov",
      path: "/api/v2/test/",
      ...endpoint,
    },
    availability: {
      status: "available",
      confidence: "high",
      lastVerified: "2026-05-11",
      summary: "Available for tests",
      evidenceRefs: ["ev-test"],
    },
    provenance: {
      sources: [
        {
          id: "ev-test",
          kind: "live_probe",
          title: "Test evidence",
          locator: "test",
        },
      ],
    },
    request: {
      parameters,
      templates: [],
    },
    response: {
      shapeSummary: "Test response",
      fields: [],
      pagination: {
        strategy: "none",
        fields: [],
        evidenceRefs: ["ev-test"],
      },
    },
    behavior: { contradictions: [], quirks: [], gaps: [], risks: [] },
    semanticAffordances: { handoffKeys: [], measureInterpretations: [], recommendedFollowups: [] },
  } as any;
}

describe("semantic bundles", () => {
  it("loads promoted Semantic Profile V2 bundles from profiles/*/semantic", () => {
    const loaded = loadSemanticBundles({ repoRoot });
    expect(loaded.bundles.map((bundle) => bundle.slug)).toEqual(
      expect.arrayContaining([
        "v2__search__spending_by_transaction",
      ])
    );
    for (const bundle of loaded.bundles) {
      expect(bundle.evidence.length).toBeGreaterThan(0);
      expect(bundle.endpoint.request.templates.length).toBeGreaterThan(0);
      expect(bundle.usage).not.toContain("I am treating your instructions");
      expect(
        bundle.evidence.every((record) =>
          ["documentation", "live_probe", "source_code", "derived_check", "review_report", "mcp_story_gate"].includes(
            record.source.kind
          )
        )
      ).toBe(true);
    }
  });

  it("builds discovery metadata directly from promoted semantic bundles", () => {
    const semantic = loadSemanticBundles({ repoRoot });
    const summary = endpointSummaryFromSemanticBundle(semantic.bundlesBySlug.v2__search__spending_by_transaction);

    expect(summary.shipTier).toBe("representative");
    expect(summary.semanticReadiness).toBe("promoted_semantic_bundle");
    expect(summary.semanticAvailability).toBe("available");
    expect(summary.tags || []).toContain("semantic_profile");
    expect(summary.tags || []).toContain("transaction_row");
    expect(summary.capabilities?.length).toBeGreaterThan(0);
  });

  it("surfaces nested semantic request facts in discovery planner metadata", () => {
    const semantic = loadSemanticBundles({ repoRoot });
    const summary = endpointSummaryFromSemanticBundle(semantic.bundlesBySlug.v2__search__spending_by_transaction);
    const planner = summary.planner!;

    expect(planner.requiredParams).toEqual(
      expect.arrayContaining(["filters", "fields", "sort", "filters.award_type_codes"])
    );
    expect(planner.optionalParams).not.toContain("filters.program_activity");
    expect(planner.riskyOptionalParams).toEqual(
      expect.arrayContaining(["filters.program_activity"])
    );
    expect(planner.parameters.find((param) => param.name === "filters.award_type_codes")?.status).toBe(
      "documented_and_observed"
    );
    expect(planner.parameters.find((param) => param.name === "filters.program_activity")?.status).toBe("contradicted");
    expect(planner.parameters.find((param) => param.name === "filters.program_activity")?.description).toContain(
      "status=contradicted"
    );
  });

  it("builds discovery summaries for promoted semantic-only bundles", () => {
    const semantic = loadSemanticBundles({ repoRoot });
    const semanticSummary = endpointSummaryFromSemanticBundle(
      semantic.bundlesBySlug.v2__search__spending_by_transaction
    );

    expect(semanticSummary.slug).toBe("v2__search__spending_by_transaction");
    expect(semanticSummary.path).toBe("/api/v2/search/spending_by_transaction/");
    expect(semanticSummary.shipTier).toBe("representative");
    expect(semanticSummary.semanticReadiness).toBe("promoted_semantic_bundle");
    expect(semanticSummary.tags || []).toContain("semantic_profile");
    expect(semanticSummary.planner?.parameters.length).toBeGreaterThan(0);
    expect(scoreSearchQuery("v2__search__spending_by_transaction", [semanticSummary.slug])).toBeGreaterThan(1000);
  });

  it("builds consolidated analysis packets for semantic MCP consumers", () => {
    const semantic = loadSemanticBundles({ repoRoot });
    const packet = analysisPacketFromSemanticBundle(semantic.bundlesBySlug.v2__search__spending_by_transaction, {
      includeUsageGuide: false,
    });

    expect(packet.slug).toBe("v2__search__spending_by_transaction");
    expect(packet.businessPurpose).toContain("transaction");
    expect(packet.requestConstruction.templates.length).toBeGreaterThan(0);
    expect(packet.requestConstruction.uncertainFields.map((field) => field.path)).toContain(
      "filters.time_period[].date_type"
    );
    expect(packet.responseInterpretation.interpretationWarnings.length).toBeGreaterThan(0);
    expect(packet.recommendedMcpCallOrder).toContain("usaspending.validateRequest");
    expect(packet.usageGuide).toBeUndefined();
  });

  it("ranks exact slug matches ahead of semantically related partial matches", () => {
    const query = "v2__search__spending_by_transaction";
    const exact = scoreSearchQuery(query, ["v2__search__spending_by_transaction", "transaction row dashboard"]);
    const related = scoreSearchQuery(query, [
      "v2__search__spending_by_transaction_count",
      "transaction count workflow for dashboard summaries",
    ]);

    expect(exact).toBeGreaterThan(related);
  });

  it("preflights canonical transaction requests and rejects missing required fields", () => {
    const loaded = loadSemanticBundles({ repoRoot });
    const bundle = loaded.bundlesBySlug.v2__search__spending_by_transaction;
    const template = bundle.endpoint.request.templates.find((item) => item.name === "bounded_contract_transaction_screen");
    expect(template).toBeTruthy();

    const valid = validateSemanticRequest(bundle.endpoint, template?.request.body);
    expect(valid.valid).toBe(true);
    expect(valid.errors).toEqual([]);

    const invalid = validateSemanticRequest(bundle.endpoint, {
      filters: { award_type_codes: ["A", "B", "C", "D"] },
      fields: ["Award ID"],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.some((issue) => issue.path === "sort")).toBe(true);
  });

  it("emits generic semantic warnings for risky optional-field omissions", () => {
    const endpoint = endpointWithRequestFacts([
      requestFact({
        path: "group",
        location: "body",
        required: true,
        documented: { allowedValues: ["month", "quarter"] },
      }),
      requestFact({
        path: "filters.time_period",
        location: "body.filters",
        type: "array",
        required: false,
      }),
      requestFact({
        path: "filters.place_of_performance_scope",
        location: "body.filters",
        required: false,
      }),
      requestFact({
        path: "filters.recipient_scope",
        location: "body.filters",
        required: false,
      }),
    ]);
    endpoint.request.validationWarnings = [
      {
        id: "explicit-location-scope-for-map-comparison",
        path: "filters.place_of_performance_scope",
        message: "Set an explicit location scope before comparing this trend to a geography map.",
        when: {
          missingAll: ["filters.place_of_performance_scope", "filters.recipient_scope"],
          presentAll: ["filters.time_period"],
          valueIn: { group: ["month", "quarter"] },
        },
        evidenceRefs: ["ev-test"],
      },
    ];

    const missingScope = validateSemanticRequest(endpoint, {
      group: "month",
      filters: {
        time_period: [{ start_date: "2024-01-01", end_date: "2024-06-30" }],
      },
    });
    expect(missingScope.valid).toBe(true);
    expect(missingScope.warnings.map((issue) => issue.path)).toContain("filters.place_of_performance_scope");

    const explicitScope = validateSemanticRequest(endpoint, {
      group: "month",
      filters: {
        time_period: [{ start_date: "2024-01-01", end_date: "2024-06-30" }],
        place_of_performance_scope: "domestic",
      },
    });
    expect(explicitScope.valid).toBe(true);
    expect(explicitScope.warnings).toEqual([]);
  });

  it("uses nested semantic fields for transaction request validation", () => {
    const loaded = loadSemanticBundles({ repoRoot });
    const bundle = loaded.bundlesBySlug.v2__search__spending_by_transaction;

    const invalid = validateSemanticRequest(bundle.endpoint, {
      filters: {},
      fields: ["Award ID"],
      sort: "Award ID",
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.map((issue) => issue.path)).toContain("filters.award_type_codes");

    const valid = validateSemanticRequest(bundle.endpoint, {
      filters: {
        time_period: [{ start_date: "2024-01-01", end_date: "2024-12-31" }],
        award_type_codes: ["A", "B", "C", "D"],
      },
      fields: ["Award ID", "Transaction Amount"],
      sort: "Transaction Amount",
      limit: 5,
    });
    expect(valid.valid).toBe(true);

    const broadButValid = validateSemanticRequest(bundle.endpoint, {
      filters: { award_type_codes: ["A"] },
      fields: ["Award ID"],
      sort: "Award ID",
    });
    expect(broadButValid.valid).toBe(true);
    expect(broadButValid.warnings.map((issue) => issue.path)).toContain("filters.time_period");
  });

  it("does not require child fields inside optional nested filter arrays until the parent is present", () => {
    const endpoint = endpointWithRequestFacts([
      requestFact({
        path: "filters.agencies",
        location: "body.filters",
        type: "array",
        required: false,
        description: "Optional agency filter family",
      }),
      requestFact({
        path: "filters.agencies[].type",
        location: "body.filters",
        type: "string",
        required: true,
        description: "Agency filter type when an agency filter is supplied",
      }),
    ]);

    const withoutAgencies = validateSemanticRequest(endpoint, {
      filters: { time_period: [{ start_date: "2025-01-01", end_date: "2025-12-31" }] },
    });
    expect(withoutAgencies.valid).toBe(true);

    const withMalformedAgency = validateSemanticRequest(endpoint, {
      filters: { agencies: [{}] },
    });
    expect(withMalformedAgency.valid).toBe(false);
    expect(withMalformedAgency.errors.map((issue) => issue.path)).toContain("filters.agencies[].type");

    const withAgencyType = validateSemanticRequest(endpoint, {
      filters: { agencies: [{ type: "awarding" }] },
    });
    expect(withAgencyType.valid).toBe(true);
  });

  it("treats sparse observed accepted values as examples unless a documented value set is present", () => {
    const endpoint = endpointWithRequestFacts([
      requestFact({
        path: "sort",
        location: "body.sort",
        type: "string",
        required: false,
        description: "Sort field",
        documented: { notes: "Valid sort values are response fields." },
        observed: { acceptedValues: ["Award ID"] },
      }),
      requestFact({
        path: "order",
        location: "body.sort",
        type: "string",
        required: false,
        description: "Sort direction",
        documented: { allowedValues: ["asc", "desc"] },
        observed: { acceptedValues: ["asc"] },
      }),
    ]);

    const valid = validateSemanticRequest(endpoint, {
      sort: "Award Amount",
      order: "desc",
    });
    expect(valid.valid).toBe(true);

    const invalidOrder = validateSemanticRequest(endpoint, {
      order: "sideways",
    });
    expect(invalidOrder.valid).toBe(false);
    expect(invalidOrder.errors.map((issue) => issue.path)).toContain("order");
  });

  it("extracts path parameters from concrete request paths", () => {
    const endpoint = endpointWithRequestFacts(
      [
        requestFact({
          path: "award_id",
          location: "path",
          type: "string",
          required: true,
          description: "Award identifier",
        }),
      ],
      { method: "GET", path: "/api/v2/awards/{award_id}/" }
    );

    const validation = validateSemanticRequest(endpoint, {
      method: "GET",
      path: "/api/v2/awards/CONT_AWD_123/",
      query: {},
    });
    expect(validation.valid).toBe(true);
    expect(validation.normalizedRequest.pathParams.award_id).toBe("CONT_AWD_123");
  });

  it("accepts bare path parameter fields for simple GET path-template endpoints", () => {
    const endpoint = endpointWithRequestFacts(
      [
        requestFact({
          path: "award_id",
          location: "path",
          type: "string",
          required: true,
          description: "Award identifier",
        }),
      ],
      { method: "GET", path: "/api/v2/awards/{award_id}/" }
    );

    const validation = validateSemanticRequest(endpoint, {
      award_id: "CONT_AWD_DENA0003525_8900_-NONE-_-NONE-",
    });

    expect(validation.valid).toBe(true);
    expect(validation.normalizedRequest.pathParams.award_id).toBe("CONT_AWD_DENA0003525_8900_-NONE-_-NONE-");
    expect(validation.normalizedRequest.query).toEqual({});
  });

  it("returns generic semantic execution receipts from declared affordances", async () => {
    const endpoint = endpointWithRequestFacts(
      [
        requestFact({
          path: "filters.award_type_codes",
          location: "body.filters",
          type: "array",
          required: true,
          description: "Award type filters",
        }),
      ],
      { method: "POST", path: "/api/v2/search/example/" }
    );
    endpoint.semanticAffordances = {
      handoffKeys: [
        {
          name: "canonical_award_lookup_id",
          sourcePath: "results[].generated_internal_id",
          description: "Use this generated id for downstream award calls.",
          targetEndpoints: [{ slug: "v2__example_detail", requestPath: "pathParams.id" }],
          evidenceRefs: ["ev-test"],
        },
      ],
      measureInterpretations: [
        {
          name: "Award Amount",
          path: "results[].Award Amount",
          meaning: "Lifetime award size, not current-period spend.",
          dashboardWarning: "Do not chart this as period spend without follow-up.",
          evidenceRefs: ["ev-test"],
        },
      ],
      recommendedFollowups: [
        {
          trigger: "Use detail before current-period claims.",
          nextSlug: "v2__example_detail",
          reason: "Confirm award vintage.",
          requestMapping: { "pathParams.award_id": "canonical_award_lookup_id" },
          evidenceRefs: ["ev-test"],
        },
      ],
    };

    const result = await callSemanticEndpoint(
      endpoint,
      { filters: { award_type_codes: ["A"] } },
      {
        fetchImpl: (async () =>
          ({
            status: 200,
            headers: new Map([["content-type", "application/json"]]),
            text: async () =>
              JSON.stringify({
                results: [
                  {
                    generated_internal_id: "CONT_AWD_EXAMPLE",
                    "Award Amount": 42,
                  },
                ],
              }),
          }) as any) as any,
      }
    );

    expect(result.semanticReceipt.handoffValues[0]).toMatchObject({
      name: "canonical_award_lookup_id",
      values: [{ sourcePath: "results[0].generated_internal_id", value: "CONT_AWD_EXAMPLE" }],
    });
    expect(result.semanticReceipt.measureWarnings[0]).toMatchObject({
      name: "Award Amount",
      observedValues: [{ sourcePath: "results[0].Award Amount", value: 42 }],
    });
    expect(result.semanticReceipt.recommendedFollowups[0].nextSlug).toBe("v2__example_detail");
  });
});
