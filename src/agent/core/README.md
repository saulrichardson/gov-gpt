# Shared Semantic Schemas

`src/agent/core` contains shared contracts used by the agent workflow and MCP
runtime.

The active contract is `semanticProfileSchema.ts`, which defines the Semantic
Profile V2 bundle:

```text
endpoint.json
semantics.json
evidence.jsonl
usage.md
```

The schema is intentionally strict about artifact shape, field statuses,
evidence references, endpoint availability, request templates, response facts,
and business semantics. It does not author endpoint-specific meaning; the
Agents SDK workflow in `scripts/agents` does that work and then validates the
result.

## Validation Ownership

Run-root validation lives in the Agents SDK package:

```bash
npm --prefix scripts/agents run semantic:validate -- --root <run-root>
```

Promoted-bundle validation lives in the MCP package:

```bash
scripts/mcp/bin/validate-semantic-bundles
```

Both validators consume the same schema and enforce generic quality gates. They
must not encode endpoint-specific semantic answers.
