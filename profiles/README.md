# Promoted Semantic Bundles

`profiles/` contains the promoted semantic endpoint bundles loaded by the MCP.

Each published endpoint lives at:

```text
profiles/<slug>/semantic/
  endpoint.json
  semantics.json
  evidence.jsonl
  usage.md
```

There is no promoted raw-profile fixture set in the forward architecture.
Endpoint directories without a `semantic/` bundle are not part of the runtime
surface.

## Bundle Files

- `endpoint.json`
  Machine-readable endpoint contract: transport path, availability, request
  facts, response facts, request templates, validation warnings, behavior notes,
  caveats, risks, and evidence references.
- `semantics.json`
  Business meaning: analytical grain, entities, measures, dimensions, suitable
  questions, not-suitable-for cases, joins, workflows, and caveats.
- `evidence.jsonl`
  Evidence ledger. Every material claim in the JSON artifacts should trace to
  one or more evidence records.
- `usage.md`
  Caller-facing guide for coding agents using the MCP.

## Validation

Run the promoted-bundle validator:

```bash
scripts/mcp/bin/validate-semantic-bundles
```

Run run-root validation for newly generated agent artifacts:

```bash
npm --prefix scripts/agents run semantic:validate -- --root <run-root>
```

## Promotion

The producer agent promotes a bundle only after validation and self-story gates
pass. Promotion copies the four canonical files into
`profiles/<slug>/semantic/`.

Manual edits should preserve the four-file contract and rerun validation before
shipping.
