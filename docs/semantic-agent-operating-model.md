# Semantic Agent Operating Model

The active workflow uses OpenAI Agents SDK in `scripts/agents` to produce,
review, repair, and story-test Semantic Profile V2 bundles.

The goal is not deterministic endpoint extraction. The goal is a general coding
agent that can reason from docs, source, live probes, and promoted semantic
bundles, then author a useful semantic MCP bundle on the first serious pass.

## Default Autonomy

Default autonomy is `full_access`.

Agents receive broad shell, filesystem, environment, and network access through
the configured workflow. They may inspect source, run scripts, create helper
artifacts, call the USAspending API, start the MCP, and run tests as needed.

The control surface is the artifact contract plus validation and story gates:

- `endpoint.json`
- `semantics.json`
- `evidence.jsonl`
- `usage.md`

## Roles

- Producer
  Authors the four-file bundle, validates it, probes when useful, runs the
  self-story gate, repairs owned story gaps, and finalizes.
- Reviewer
  Independently judges semantic richness, evidence quality, request usefulness,
  response interpretation, and MCP usability.
- Repairer
  Executes a selected repair task against an existing bundle, validates, and
  returns a structured repair report.
- Story agent
  Uses the MCP like a downstream coding agent: discovery, analysis packet,
  request template, basic preflight, live call, recoverable API-error handling,
  evidence, interpretation, and reusable semantic learning.
- Frontier suite
  Runs harder story questions and emits a repair queue.

## Producer Loop

1. Load endpoint context.
2. Write the four preliminary artifacts early.
3. Validate with `validate_semantic_bundle`.
4. Repair schema and evidence-reference failures immediately.
5. Run scoped live probes only when they answer a material semantic question.
6. Record every useful probe in `evidence.jsonl`.
7. Reconcile docs, source, probes, and caveats into endpoint facts.
8. Run `run_self_story_gate` with a realistic downstream question.
9. Repair owned blocker/major story findings.
10. Rerun validation and the self-story gate.
11. Inspect output files with `list_output_files`.
12. Complete with `finalize_validated_bundle`.

Validation alone is not completion.

Probe coverage is purposeful, not exhaustive. The producer should validate the
core semantic contract and preserve uncertainty for unprobed branches instead
of trying to enumerate every API combination.

## What The Agent Must Preserve

- documented fields with explicit statuses, even if unprobed
- nested request fields that matter for real analysis
- response grain and dynamic response-shape caveats
- opaque code labels or lookup paths
- row-order and ranking meaning
- measure reconciliation and lifetime-versus-period meaning
- sample-versus-full-population boundaries
- async/export boundaries
- semantic affordances such as handoff keys, measure interpretations, and
  recommended follow-ups when downstream agents need structured handles
- contradictions and risky-but-valid request patterns
- visible API failure modes that help a future coding agent recover

## Exploratory MCP Learning

Story agents are expected to behave like black-box MCP users. They should answer
the analysis question as far as the MCP allows, then report what the MCP taught
them that should generalize beyond that one story.

Every story report distinguishes:

- the narrative story and live values observed in the run
- MCP gaps that blocked or weakened the story
- `generalizableLearnings`, such as handoff, request-construction,
  response-shape, measure-interpretation, dashboard-safety, workflow, or
  evidence-gap lessons
- `runtimeAffordanceRequests`, where the bundle may already know the meaning but
  the MCP should expose it through generic structured behavior
- repair tasks that a repair agent can execute against one or more semantic
  bundles

If meaning exists only in prose, joins, workflows, or caveats, the first repair
should normally be a `semantic_affordance` bundle task that declares that meaning
in `endpoint.json.semanticAffordances`. Runtime affordance requests are reserved
for cases where the bundle already declares the affordance and the MCP fails to
present it generically.

This keeps the loop agentic. The story agent discovers the gap by using the MCP;
the repair or synthesis agent turns the learning into durable bundle content or
generic runtime affordances.

Prefer bundle guidance over new validation machinery. A story agent is allowed
to hit a documented API error, inspect it, and repair the request. Promote a
new generic runtime validation rule only when the same avoidable failure keeps
blocking agents despite clear bundle guidance.

## Commands

Produce a bundle:

```bash
npm --prefix scripts/agents run semantic:agent -- \
  --slug v2__search__spending_by_transaction \
  --out-root runs/agents-sdk \
  --reasoning-effort high
```

Validate a run root:

```bash
npm --prefix scripts/agents run semantic:validate -- --root runs/agents-sdk
```

Review:

```bash
npm --prefix scripts/agents run semantic:review -- \
  --slug v2__search__spending_by_transaction \
  --out-root runs/agents-sdk
```

Repair:

```bash
npm --prefix scripts/agents run semantic:repair -- \
  --slug v2__search__spending_by_transaction \
  --out-root runs/agents-sdk \
  --review-report runs/review.json \
  --task-id <repair-task-id>
```

Story-test:

```bash
npm --prefix scripts/agents run semantic:story -- \
  --question "Can the semantic MCP support a contract outlier dashboard?"
```

Frontier suite:

```bash
npm --prefix scripts/agents run semantic:frontier -- \
  --output-dir runs/agents-sdk-frontier/latest
```

## Acceptance Bar

The bundle is good only if another agent can use the MCP to do useful work:

- discover the right endpoint
- understand why it is the right endpoint
- construct a valid bounded request
- avoid known misleading calls
- call the live API when safe
- interpret returned rows in business terms
- cite evidence for important claims

That is the durable product target.
