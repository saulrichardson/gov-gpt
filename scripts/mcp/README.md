# USAspending Semantic MCP Runtime

`scripts/mcp` is the runtime package for the semantic MCP surface.

It loads promoted Semantic Profile V2 bundles from:

```text
profiles/<slug>/semantic/
  endpoint.json
  semantics.json
  evidence.jsonl
  usage.md
```

The MCP does not expose legacy raw-profile wrapper tools. The only promoted
runtime contract is the semantic bundle plus generic semantic tools for
discovery, inspection, validation, bounded calls, evidence, and usage guidance.

## Tools

- `usaspending.findEndpoints`
  Search promoted semantic endpoints by business purpose, concepts, request
  strategy, slug, and path.
- `usaspending.findConcepts`
  Search entities, measures, dimensions, suitable questions, caveats, and
  not-suitable-for cases across bundles.
- `usaspending.findWorkflows`
  Search higher-level endpoint workflows.
- `usaspending.getEndpointSchema`
  Return `endpoint.json`.
- `usaspending.getEndpointSemantics`
  Return `semantics.json`.
- `usaspending.getAnalysisPacket`
  Return a consolidated packet for endpoint selection, request construction,
  response interpretation, caveats, workflows, and evidence refs.
- `usaspending.getRequestTemplate`
  Return evidence-backed templates, optionally ranked by use case.
- `usaspending.listRequestFields`
  Return request facts, optionally filtered by status.
- `usaspending.validateRequest`
  Preflight the basic shape of a proposed request against the semantic endpoint
  facts.
- `usaspending.explainValidationError`
  Explain validation failures or warnings using the endpoint artifact.
- `usaspending.callEndpoint`
  Make a bounded live USAspending API call through the semantic endpoint
  contract. The result includes the raw response plus a semantic execution
  receipt derived from agent-authored bundle affordances, such as extracted
  handoff values, measure warnings, and recommended follow-ups.
- `usaspending.getEvidence`
  Return evidence records from `evidence.jsonl`.
- `usaspending.getUsageGuide`
  Return `usage.md`.

## Resources

- `usaspending://semantic/all`
- `usaspending://semantic/schema/<slug>`
- `usaspending://semantic/semantics/<slug>`
- `usaspending://semantic/evidence/<slug>`
- `usaspending://semantic/usage/<slug>`

## Validation

```bash
npm --prefix scripts/mcp run typecheck
npm --prefix scripts/mcp run test
scripts/mcp/bin/validate-semantic-bundles
scripts/mcp/bin/smoke-server
scripts/mcp/bin/smoke-client
```

`validate-semantic-bundles` loads every promoted bundle and enforces schema
validity, evidence links, availability evidence, and usage-guide consistency.

`smoke-client` starts the MCP over stdio, verifies that the semantic-only tool
surface is present, verifies that per-endpoint raw wrapper tools are absent, and
exercises discovery, analysis packets, and basic request preflight. Set
`SMOKE_CALL_API=1` to also execute a small live call through
`usaspending.callEndpoint`.

## Design Boundary

The runtime is intentionally generic. It may validate schemas, load bundles,
preflight basic request shape, enforce host allowlists, and report tool errors.
It should not hard-code endpoint-specific business semantics or become an
exhaustive API rule engine. Endpoint-specific meaning belongs in the
agent-authored semantic bundle, and coding agents may use visible API errors to
repair requests when docs, source, and live behavior disagree.

When `endpoint.json` declares `semanticAffordances`, the runtime can expose them
structurally. For example, a bundle may declare that a raw response path is a
handoff key for another endpoint; `callEndpoint` can then return that value in a
semantic receipt without knowing anything endpoint-specific about USAspending.
