# USAspending MCP Target Shape

The MCP is the product surface. Agent frameworks produce and test its knowledge,
but the source of truth is the validated semantic bundle.

## Target Experience

A downstream coding agent should be able to:

1. Discover relevant USAspending endpoints from a natural-language analytical
   goal.
2. Inspect endpoint business meaning, analytical grain, entities, measures,
   dimensions, joins, caveats, and workflows.
3. Construct a bounded valid request from evidence-backed templates and field
   facts.
4. Preflight the basic request shape and inspect semantic guidance.
5. Make a scoped live call.
6. Recover from visible API errors when docs/source/live behavior disagree.
7. Interpret the response in business terms.
8. Inspect evidence behind non-trivial claims.

## Runtime Tools

The promoted MCP exposes semantic tools only:

- `usaspending.findEndpoints`
- `usaspending.findConcepts`
- `usaspending.findWorkflows`
- `usaspending.getEndpointSchema`
- `usaspending.getEndpointSemantics`
- `usaspending.getAnalysisPacket`
- `usaspending.getRequestTemplate`
- `usaspending.listRequestFields`
- `usaspending.validateRequest`
- `usaspending.explainValidationError`
- `usaspending.callEndpoint`
- `usaspending.getEvidence`
- `usaspending.getUsageGuide`

There are no per-endpoint raw wrapper tools in the forward runtime.

## Semantic Bundle Requirements

Every promoted endpoint must include:

- request fields with statuses and evidence
- response fields with statuses and evidence
- availability status and live evidence when marked callable
- request templates that are safe and bounded
- request guidance and sparing validation warnings for valid but risky calls
- business purpose and analytical grain
- entities, measures, dimensions, workflows, and caveats
- evidence records for material claims
- a caller-facing usage guide

## What Makes It Valuable

The MCP adds value when it helps an agent prevent, recognize, or recover from
errors a thin wrapper would allow:

- using a display award id where a generated internal id is required
- confusing lifetime award amounts with period activity
- treating sample rows as a full population
- assuming a row order is a ranking
- missing a required nested filter
- calling a download endpoint as if it returned immediate analysis rows
- trusting documentation that live probes or source contradict

## Promotion Bar

Promotion requires validation and a story gate. The story gate must use the MCP
like a real downstream agent and either produce a defensible analytical story or
return owned repair tasks.

The target is not just "the endpoint call succeeds." The target is "the MCP
helps another agent ask and answer a meaningful federal spending question."
