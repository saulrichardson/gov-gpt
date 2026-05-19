import type { SemanticBundle } from "./loadSemanticBundles.js";

export type ParamLocation = "query" | "body" | "path";
export type ShipTier = "representative";
export type PlannerParameter = {
  name: string;
  location: ParamLocation;
  required: boolean;
  description: string;
  types: string[];
  status?: string;
  constraints?: string[];
};
export type PlannerMetadata = {
  parameterCount: number;
  requiredParams: string[];
  optionalParams: string[];
  safeOptionalParams: string[];
  uncertainOptionalParams: string[];
  riskyOptionalParams: string[];
  queryParams: string[];
  bodyParams: string[];
  pathParams: string[];
  supportsPagination: boolean;
  supportsSorting: boolean;
  supportsFiltering: boolean;
  supportsDateRange: boolean;
  parameters: PlannerParameter[];
};
export type SemanticDiscoverySummary = {
  slug: string;
  description: string;
  path: string;
  method: string;
  shipTier: ShipTier;
  tags: string[];
  capabilities: string[];
  planner: PlannerMetadata;
  semanticReadiness?: "promoted_semantic_bundle";
  semanticAvailability?: SemanticBundle["endpoint"]["availability"]["status"];
};

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function normalizeDiscoveryTerm(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function semanticTags(bundle: SemanticBundle): string[] {
  return uniqueStrings([
    "semantic_profile",
    `${bundle.endpoint.availability.status}_semantic`,
    ...bundle.semantics.primaryEntities.map((item) => normalizeDiscoveryTerm(item.name)),
    ...bundle.semantics.measures.map((item) => normalizeDiscoveryTerm(item.name)),
    ...bundle.semantics.dimensions.map((item) => normalizeDiscoveryTerm(item.name)),
  ]).slice(0, 40);
}

function semanticCapabilities(bundle: SemanticBundle): string[] {
  return uniqueStrings([
    ...bundle.semantics.workflows.map((workflow) => normalizeDiscoveryTerm(workflow.name)),
    ...bundle.semantics.suitableQuestions.map((question) => normalizeDiscoveryTerm(question.name)),
  ]).slice(0, 40);
}

function plannerLocationFromSemanticLocation(location: string): ParamLocation {
  if (location === "path" || location === "query") return location;
  return "body";
}

function semanticPlannerParameterDescription(fact: SemanticBundle["endpoint"]["request"]["parameters"][number]): string {
  const qualifiers = [`status=${fact.status}`];
  if (fact.required) qualifiers.push("required");
  if (fact.constraints.length > 0) qualifiers.push(`constraints=${fact.constraints.slice(0, 2).join("; ")}`);
  return `${fact.description} (${qualifiers.join("; ")})`;
}

function semanticPlannerFromBundle(bundle: SemanticBundle): PlannerMetadata {
  const parameters: PlannerParameter[] = bundle.endpoint.request.parameters
    .filter((fact) => fact.direction === "request")
    .map((fact) => ({
      name: fact.path,
      location: plannerLocationFromSemanticLocation(fact.location),
      required: fact.required,
      description: semanticPlannerParameterDescription(fact),
      types: [fact.type],
      status: fact.status,
      constraints: fact.constraints,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const requiredParams = parameters.filter((param) => param.required).map((param) => param.name);
  const optionalParameters = parameters.filter((param) => !param.required);
  const safeOptionalParams = optionalParameters
    .filter((param) => param.status === "observed" || param.status === "documented_and_observed")
    .map((param) => param.name);
  const uncertainOptionalParams = optionalParameters
    .filter((param) => ["documented_unverified", "inferred", "unknown"].includes(param.status ?? ""))
    .map((param) => param.name);
  const riskyOptionalParams = optionalParameters
    .filter((param) => ["contradicted", "observed_unavailable"].includes(param.status ?? ""))
    .map((param) => param.name);
  const optionalParams = safeOptionalParams;
  const queryParams = parameters.filter((param) => param.location === "query").map((param) => param.name);
  const bodyParams = parameters.filter((param) => param.location === "body").map((param) => param.name);
  const pathParams = parameters.filter((param) => param.location === "path").map((param) => param.name);
  const names = parameters.map((param) => param.name.toLowerCase());

  return {
    parameterCount: parameters.length,
    requiredParams,
    optionalParams,
    safeOptionalParams,
    uncertainOptionalParams,
    riskyOptionalParams,
    queryParams,
    bodyParams,
    pathParams,
    supportsPagination: names.some((name) => /\b(page|limit|offset|cursor)\b/.test(name)),
    supportsSorting: names.some((name) => /\b(sort|order)\b/.test(name)),
    supportsFiltering: names.some((name) => name.includes("filter")),
    supportsDateRange: names.some((name) => /time_period|date|fiscal_year|fy/.test(name)),
    parameters,
  };
}

export function endpointSummaryFromSemanticBundle(bundle: SemanticBundle): SemanticDiscoverySummary {
  return {
    slug: bundle.slug,
    description: bundle.semantics.summary || bundle.semantics.businessPurpose,
    path: bundle.endpoint.endpoint.path,
    method: bundle.endpoint.endpoint.method,
    shipTier: "representative",
    tags: semanticTags(bundle),
    capabilities: semanticCapabilities(bundle),
    planner: semanticPlannerFromBundle(bundle),
    semanticReadiness: "promoted_semantic_bundle",
    semanticAvailability: bundle.endpoint.availability.status,
  };
}

function uniqueEvidenceRefs(refGroups: string[][]): string[] {
  return Array.from(new Set(refGroups.flat().filter(Boolean)));
}

function compactEvidence(bundle: SemanticBundle, refs: string[]) {
  const wanted = new Set(refs);
  return bundle.evidence
    .filter((record) => wanted.has(record.id))
    .map((record) => ({
      id: record.id,
      source: record.source,
      probeName: record.probeName,
      request: record.request,
      response: record.response
        ? {
            status: record.response.status,
            ok: record.response.ok,
            contentType: record.response.contentType,
            bodyShape: record.response.bodyShape,
          }
        : undefined,
      observations: record.observations,
    }));
}

export function analysisPacketFromSemanticBundle(
  bundle: SemanticBundle,
  options: { includeUsageGuide?: boolean; includeEvidence?: boolean } = {}
) {
  const endpoint = bundle.endpoint;
  const semantics = bundle.semantics;
  const requestFacts = endpoint.request.parameters;
  const responseFacts = endpoint.response.fields;
  const caveats = [...semantics.caveats, ...endpoint.behavior.risks, ...endpoint.behavior.quirks];
  const gaps = [...endpoint.behavior.gaps, ...endpoint.behavior.contradictions];
  const evidenceRefs = uniqueEvidenceRefs([
    endpoint.availability.evidenceRefs,
    ...endpoint.request.templates.map((template) => template.evidenceRefs),
    ...endpoint.request.validationWarnings.map((warning) => warning.evidenceRefs),
    ...semantics.workflows.map((workflow) => workflow.evidenceRefs),
    ...semantics.caveats.map((caveat) => caveat.evidenceRefs),
    ...endpoint.behavior.risks.map((risk) => risk.evidenceRefs),
    ...endpoint.behavior.quirks.map((quirk) => quirk.evidenceRefs),
    ...endpoint.behavior.gaps.map((gap) => gap.evidenceRefs),
    ...endpoint.behavior.contradictions.map((contradiction) => contradiction.evidenceRefs),
  ]);

  const uncertainRequestFacts = requestFacts.filter((fact) =>
    ["documented_unverified", "inferred", "unknown", "contradicted"].includes(fact.status)
  );
  const interpretationWarnings = [
    ...caveats.map((note) => ({ kind: "caveat", ...note })),
    ...gaps.map((note) => ({ kind: "gap_or_contradiction", ...note })),
  ];

  return {
    schemaVersion: "1.0.0",
    slug: bundle.slug,
    endpoint: endpoint.endpoint,
    availability: endpoint.availability,
    summary: semantics.summary,
    businessPurpose: semantics.businessPurpose,
    analyticalGrain: semantics.analyticalGrain,
    analysisSurface: {
      primaryEntities: semantics.primaryEntities,
      measures: semantics.measures,
      dimensions: semantics.dimensions,
      suitableQuestions: semantics.suitableQuestions,
      notSuitableFor: semantics.notSuitableFor,
      joins: semantics.joins,
      workflows: semantics.workflows,
    },
    requestConstruction: {
      contentType: endpoint.request.contentType,
      requiredFields: requestFacts.filter((fact) => fact.required),
      optionalFields: requestFacts.filter((fact) => !fact.required),
      uncertainFields: uncertainRequestFacts,
      templates: endpoint.request.templates,
      validationWarnings: endpoint.request.validationWarnings,
    },
    responseInterpretation: {
      contentType: endpoint.response.contentType,
      shapeSummary: endpoint.response.shapeSummary,
      fields: responseFacts,
      pagination: endpoint.response.pagination ?? null,
      caveats,
      gaps,
      interpretationWarnings,
    },
    recommendedMcpCallOrder: [
      "usaspending.findEndpoints",
      "usaspending.getAnalysisPacket",
      "usaspending.getRequestTemplate",
      "usaspending.validateRequest",
      "usaspending.callEndpoint",
      "usaspending.getEvidence",
    ],
    evidence: {
      totalRecords: bundle.evidence.length,
      keyEvidenceRefs: evidenceRefs,
      records: options.includeEvidence === true ? compactEvidence(bundle, evidenceRefs) : undefined,
    },
    usageGuide: options.includeUsageGuide === false ? undefined : bundle.usage,
  };
}
