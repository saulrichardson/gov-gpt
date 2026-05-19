# Semantic Profile V2

Semantic Profile V2 is the durable artifact contract for the USAspending
semantic MCP.

The contract exists because API documentation, source behavior, live behavior,
and business usage do not collapse into a simple request schema. A downstream
coding agent needs to know what an endpoint means, how to call it, what the
response grain is, what caveats matter, and what evidence supports those
claims.

## Files

```text
endpoint.json
semantics.json
evidence.jsonl
usage.md
```

## `endpoint.json`

`endpoint.json` is the callable and interpretable endpoint contract. It records:

- endpoint method, host, and path
- availability status, confidence, verification date, and evidence refs
- provenance sources
- request facts, including nested body/query/path fields
- request templates
- request validation warnings for valid but risky near-miss calls
- response shape, response fields, and pagination facts
- contradictions, quirks, gaps, and risks

Request fact paths are relative to their transport root:

- POST body field: `filters.time_period`
- query field: `page`
- path field: `award_id`

Do not prefix body paths with `body.` or query paths with `query.`.

## `semantics.json`

`semantics.json` captures the business layer:

- summary
- business purpose
- analytical grain
- primary entities
- measures
- dimensions
- suitable questions
- not-suitable-for cases
- joins
- workflows
- caveats

This file is where the bundle explains what the endpoint can support beyond a
successful HTTP response.

## `evidence.jsonl`

Each line is an evidence record. Evidence sources can include:

- documentation
- live probes
- source code
- derived checks
- reviewer reports
- MCP story gates
- retired artifacts used as historical context

Every non-trivial claim in `endpoint.json` and `semantics.json` should cite one
or more evidence ids. If evidence is incomplete, keep the field and mark it
`documented_unverified`, `inferred`, `unknown`, or a gap instead of inventing
certainty.

## `usage.md`

`usage.md` is a caller guide for downstream agents. It should explain:

- when to use the endpoint
- when not to use it
- request templates and required fields
- response interpretation
- joins and workflows
- caveats and known traps

It must not include prompt text, validation logs, private reasoning, or process
narration.

## Validation

Run-root validation:

```bash
npm --prefix scripts/agents run semantic:validate -- --root <run-root>
```

Promoted-bundle validation:

```bash
scripts/mcp/bin/validate-semantic-bundles
```

Validation checks schema shape, evidence references, availability evidence,
contradiction policy, and usage consistency. It is a generic gate, not a
semantic author.

## Promotion Criteria

A bundle is promotion-grade when:

- all four files exist under the declared output directory
- schema validation passes
- material claims cite evidence
- live availability cites at least one live probe when the endpoint is marked
  `available` or `partially_available`
- documented-but-unprobed fields are preserved with explicit statuses
- contradictions, gaps, risks, and caveats are visible
- request templates are bounded and useful
- a self-story MCP gate shows that another agent can use the bundle for a
  realistic analytical question or returns repair tasks that have been handled

The source of truth is the validated semantic bundle, not the orchestration
framework that produced it.
