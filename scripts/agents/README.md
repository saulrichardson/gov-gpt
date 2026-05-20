# USAspending Semantic Agents SDK Runner

This package is the Agents SDK implementation of the semantic endpoint producer,
reviewer, repairer, and MCP story-gate workflow.

The agent is intentionally responsible for the endpoint knowledge. The
TypeScript code supplies repository tools, scoped live USAspending probe tools,
artifact writes, validation, in-loop self-story gates, promotion, and
full-access shell access. It does not deterministically extract or synthesize
endpoint facts.

Default autonomy mode is `full_access`. In that mode every role receives
`full_access_shell_command`, which can run arbitrary local shell commands with
the SDK process filesystem and network access. There is no approval-gated or
restricted autonomy mode in the active architecture; `full_access` is the
execution posture.

Full-access mode is contract-first: give the coding agent the semantic artifact
contract and acceptance gates, then let it run whatever local commands, scripts,
tests, live probes, or MCP workflows it needs to satisfy that contract.

Story runs are exploratory learning loops, not only pass/fail tests. A story
agent uses the promoted MCP as a downstream coding agent, attempts a real
analysis, and returns both the story result and reusable semantic learnings:
handoff gaps, measure-interpretation issues, dashboard-safety risks,
request-construction gaps, response-shape surprises, workflow gaps, and runtime
affordance requests. Those findings become task-scoped repair or synthesis work.

## Run

```bash
npm --prefix scripts/agents install
npm --prefix scripts/agents run semantic:agent -- \
  --slug v2__search__spending_by_transaction \
  --out-root runs/agents-sdk-demo \
  --reasoning-effort high \
  --timeout-ms 1200000
```

Complex fresh endpoints can need long first-pass context gathering, probing, and
self-story time. The default producer timeout is 20 minutes so the agent has
room to validate and finalize inside the agent loop.

The runner loads `.env.local` and `.env`. If `OPENAI_API_KEY` is absent and
`CODEX_API_KEY` is present, it maps `CODEX_API_KEY` into `OPENAI_API_KEY` for the
current process only.

To promote a validated bundle into the MCP-loaded profile directory:

```bash
npm --prefix scripts/agents run semantic:agent -- \
  --slug v2__search__spending_by_transaction \
  --out-root runs/agents-sdk-demo \
  --reasoning-effort high \
  --promote
```

To review, repair, and story-test a generated bundle:

```bash
npm --prefix scripts/agents run semantic:review -- \
  --slug v2__recipient \
  --out-root runs/agents-sdk \
  > runs/review.json

npm --prefix scripts/agents run semantic:repair -- \
  --slug v2__recipient \
  --out-root runs/agents-sdk \
  --review-report runs/review.json \
  --task-id repair-task-id

npm --prefix scripts/agents run semantic:story -- \
  --question "Tell an evidence-backed story using the semantic MCP" \
  --bundle-glob "/abs/path/to/*/endpoint.json" \
  --output runs/story.json
```

To run high-ceiling story stress tests and produce a repair queue:

```bash
npm --prefix scripts/agents run semantic:frontier -- \
  --output-dir runs/agents-sdk-frontier/latest \
  --bundle-glob "/abs/path/to/profiles/*/semantic/endpoint.json"
```

The frontier suite writes each story report, `frontier-suite-summary.json`, and
`frontier-repair-queue.json`. Story and review repair tasks should include
`targetSlug` when one endpoint bundle owns the repair. Queue entries with
`status: "ready"` include suggested prepare, repair, validate, and
post-review promotion commands. Entries with `status: "needs_triage"` are
usually cross-endpoint or missing `targetSlug`; route them before starting a
repair agent.

The repairer is task-scoped. It loads the existing bundle, executes the selected
repair task, writes the affected artifacts, calls
`repair_validate_semantic_bundle`, and returns `status: "repaired"` only after
validation passes. In full-access mode it also has shell access for inspection,
tests, and supplemental verification.

## Verification

```bash
npm --prefix scripts/agents run typecheck
npm --prefix scripts/agents run test
npm --prefix scripts/agents run smoke
```

The smoke command does not call the OpenAI API. A real endpoint run does.
Real runs print event milestones for agent updates, tool calls, and tool outputs
without printing tool payloads. Use `--quiet-events` to suppress those logs.

Producer completion is intentionally inside the agentic loop. A passing
`validate_semantic_bundle` call does not stop the run. Before promotion or
finalization, the producer must call `run_self_story_gate` with a realistic
endpoint-specific question. That tool stages the candidate bundle alongside the
promoted semantic bundles, runs the MCP story agent against that staged surface,
and returns owned blocker/major gaps while the producer can still repair the
artifacts. The producer then inspects the declared output directory with
`list_output_files` and calls `finalize_validated_bundle`. Promotion and
finalization both refuse to succeed unless the self-story report is ready.
Finalization reruns validation and refuses to return a success summary unless
the exact four canonical files exist under `<out-root>/<slug>/`, so story, path,
and inventory mistakes are visible to the agent while it can still fix them.

If the SDK run ends before `finalize_validated_bundle` returns structured final
output, the run fails. Partial files can still be inspected manually, but the
runner does not recover, promote, or complete endpoint work outside the agentic
loop.

## Artifact Contract

Each successful run writes:

```text
<out-root>/<slug>/
  endpoint.json
  semantics.json
  evidence.jsonl
  usage.md
```

The validation tools currently invoke the shared semantic validator:

```bash
npm --prefix scripts/agents run semantic:validate -- --root <out-root>
```

The agent must use validation before returning `status: "completed"`. The
validator is package-local because semantic authoring, validation, and
agent-loop repair are one workflow. Completion still requires the stronger
producer finalization gate, not validation alone.
