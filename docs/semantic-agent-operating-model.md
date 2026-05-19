# Semantic Endpoint Agent Operating Model

This is the operating model for a general coding agent that builds USAspending
MCP endpoint knowledge. The agent is not a deterministic extractor. It receives
a high-level endpoint task, investigates freely inside the repo and live API,
and ships a validated artifact bundle.

## Goal

For one endpoint slug, produce a Semantic Profile V2 bundle that another coding
agent can use to query the USAspending API correctly and understand the endpoint
business semantics.

The final artifact is:

```text
runs/<job>/<slug>/
  endpoint.json
  semantics.json
  evidence.jsonl
  usage.md
```

Promotion copies the same four-file bundle to:

```text
profiles/<slug>/semantic/
  endpoint.json
  semantics.json
  evidence.jsonl
  usage.md
```

The MCP runtime loads only promoted bundles from `profiles/<slug>/semantic/`.
Run `scripts/mcp/bin/validate-semantic-bundles` before treating a bundle as part
of the semantic MCP surface.

The current runnable implementation of this operating model is the OpenAI
Agents SDK package in `scripts/agents`:

```bash
npm --prefix scripts/agents run semantic:agent -- \
  --slug v2__search__spending_by_geography \
  --out-root runs/agents-sdk-demo \
  --reasoning-effort high
```

Use `--promote` only when the generated bundle should be copied into
`profiles/<slug>/semantic/` after validation.

Agents SDK runs default to full-access execution. Each role receives a
`full_access_shell_command` tool with broad local shell and network access, plus
parallel tool calls. There is no approval-gated or restricted autonomy mode in
the active architecture; `full_access` is the execution posture.

The contract is the artifact and acceptance bar, not the agent's path. In
full-access mode the coding agent should use whatever commands, scripts, API probes, source
inspection, generated helper artifacts, or MCP/story workflows are needed to
produce a correct semantic MCP bundle. The workflow should constrain outputs and
validation, not pre-decide the investigation strategy.

The current quality loop has four model-owned roles:

```bash
# Produce one semantic bundle.
make agents-semantic SLUG=v2__recipient AGENTS_OUT_ROOT=runs/agents-sdk

# Review a generated bundle and emit repairTasks.
make agents-review SLUG=v2__recipient AGENTS_OUT_ROOT=runs/agents-sdk

# Repair one review/story task in a task-scoped pass.
make agents-repair \
  SLUG=v2__recipient \
  AGENTS_OUT_ROOT=runs/agents-sdk \
  AGENTS_REVIEW_REPORT=runs/review.json \
  AGENTS_REPAIR_TASK_ID=repair-task-id

# Use the MCP itself to tell an analytical story and emit repairTasks.
make agents-story \
  AGENTS_BUNDLE_GLOB='/abs/{profiles/*/semantic,runs/*}/endpoint.json' \
  AGENTS_STORY_OUTPUT=runs/story.json

# Run a suite of high-ceiling story gates and aggregate gaps.
npm --prefix scripts/agents run semantic:frontier -- \
  --output-dir runs/agents-sdk-frontier/<name> \
  --bundle-glob '/abs/profiles/*/semantic/endpoint.json' \
  --reasoning-effort high
```

The producer also has a self-story gate. Before promotion or finalization it
must call `run_self_story_gate` with a realistic endpoint-specific question.
That tool stages the candidate bundle alongside promoted semantic bundles and
runs the MCP story agent while the producer can still repair the candidate
artifacts. Promotion and finalization check this report, so a producer cannot
skip the self-story gate and still report a completed bundle.

The standalone story agent is the current promotion-grade acceptance test: it
does not edit files. It discovers endpoints through the MCP, reads endpoint
semantics, validates requests, calls scoped endpoints, tells a short
evidence-backed story, and reports any MCP usability gaps as repair tasks.
When discovery returns raw endpoints, the story agent must inspect
`hasSemanticProfile` before calling semantic-only tools. A raw-only endpoint may
be a useful fallback, but it is not a promoted semantic route and should not be
treated as one until a bundle exists.

The frontier suite is the current high-ceiling stress harness. It runs multiple
story gates in sequence and writes each report plus
`frontier-suite-summary.json` and `frontier-repair-queue.json`. The suite
wrapper is deterministic orchestration; the actual judgments remain model-owned
story runs. Use it when asking whether the semantic MCP can support
dashboard-shaped analysis, cross-endpoint handoffs, async download workflows, or
other higher-order tasks rather than one endpoint in isolation.

Story gates should test both the happy path and the near-miss path. A promoted
bundle can be story-ready when the intended request validates cleanly, while a
semantically risky but still valid variation emits an evidence-backed warning.
For those cases, use `request.validationWarnings` in `endpoint.json` rather than
hard-coding endpoint-specific validator behavior.

Story and review repair tasks should set `targetSlug` when one endpoint bundle
owns the repair. The frontier repair queue preserves the model-authored repair
task and adds routing state:

- `status: "ready"` means the task has a `targetSlug` and includes suggested
  prepare, repair, validate, and post-review promotion commands.
- `status: "needs_triage"` means the task is cross-endpoint or missing
  `targetSlug`; route it to an owning bundle before running `semantic:repair`.

This keeps the loop agentic while removing a manual translation step between
story-gate findings and the next repair-agent run.

The repair agent is allowed to edit artifacts, but it should stay focused on the
selected finding rather than becoming a second producer. It should load the
bundle, execute the selected repair task, write the affected artifacts, run
`repair_validate_semantic_bundle`, and return `status=repaired` only if
validation passes. Completion discipline is part of the contract: once the
selected task is plausibly satisfied, the repairer should stop optional
investigation, validate, and return. Any additional opportunity it notices
should be recorded as unresolved or recommended next-review focus. In full-access mode
it may use shell access to inspect, test, or validate when the narrow repair
tools are not enough. For selected `repairTasks` with concrete `evidenceToUse`,
the repair report is presumed to contain enough task evidence; the repairer
should inspect the target artifacts and run extra source or live probes only
when it can name the specific missing fact that blocks the repair.

## Agent Task

Ask the coding agent to do this:

1. Read the V2 schema, staged endpoint docs, current promoted profile, and any
   local source code needed to understand behavior.
2. Create the four-file output skeleton early, before extended probing or broad
   source exploration. The skeleton should use `documented_unverified`,
   `inferred`, and `unknown` statuses rather than waiting for perfect certainty.
3. Validate the preliminary skeleton before live probes. Fix schema typos,
   missing evidence ids, and policy failures immediately, then use probes to
   refine an already-valid bundle.
4. Build a coverage ledger from docs and current profile:
   - documented path/query/body fields
   - nested fields, sort objects, filters, pagination controls
   - documented response fields
   - current MCP exposed fields and missing fields
   - initial status for doc-only facts: `documented_unverified`
5. Maintain `evidence.jsonl` while working. Every claim ID cited by
   `endpoint.json` or `semantics.json` must already exist in the evidence ledger.
6. Run a purposeful live probe set. Start small, usually 3-5 probes, then expand
   only when the endpoint's semantics or workflow genuinely require more
   evidence:
   - one baseline/happy path
   - one default/minimal request, if applicable
   - one pagination or sorting probe, if applicable
   - one negative/error probe for an important enum, nested key, or missing field
   - one availability or join probe when it materially improves semantics
   - for workflows that require a transient identifier from another endpoint,
     one scoped prerequisite setup call may be necessary before the target
     endpoint can be live-probed
   Record why any extra probes were necessary.
7. Reconcile the coverage ledger into `endpoint.json`:
   - preserve material fields with statuses
   - do not drop doc-only fields
   - do not hide current-MCP missing fields
   - keep request fact paths relative to their transport root: `filters.foo`
     for body fields, not `body.filters.foo`; `page` for query fields, not
     `query.page`
   - classify docs/live disagreements as `contradicted`
   - classify 404/non-JSON stale routes as `observed_unavailable`
   - add `request.validationWarnings` for optional-field omissions or value
     combinations that are valid transport-level requests but risky for a
     documented workflow
8. Write `semantics.json`:
   - business purpose
   - analytical grain
   - primary entities, measures, dimensions
   - suitable and unsuitable questions
   - joins and workflows
   - caveats
   - analysis affordances: code labels or lookup requirements, sort/ranking
     guarantees, measure reconciliation guidance, lifetime-versus-period
     meaning, sample-versus-full-population boundaries, async/export artifact
     boundaries, and observed-versus-inferred shared filters
9. Write `usage.md` last. It is a caller guide, not a work log. It must be
   consistent with the final JSON artifacts; after a live probe confirms
   availability, remove stale draft language that says live availability is
   unconfirmed or provisional.
10. Run a consistency audit across the four artifacts: availability, request
    templates, caveats, gaps, and live-probe claims must describe the same
    evidence state.
11. Run final validation. Fix artifact failures. Do not weaken the validator.
12. Run `run_self_story_gate` with a realistic downstream question for this
    endpoint. If it returns owned blocker or major gaps, repair the bundle,
    rerun validation, and rerun the self-story gate. If it returns only
    non-owned cross-endpoint issues or minor residual risks, carry those into
    the final summary instead of silently editing unrelated bundles.
13. Inspect the declared output directory with `list_output_files`, then call
    `finalize_validated_bundle`. Validation alone is not a completion signal:
    finalization is the in-loop gate that verifies the four canonical files are
    actually under `<out-root>/<slug>/`. If it reports missing files, correct
    the artifact paths and rerun validation plus finalization before returning.

## Non-Negotiables

- The bundle is the deliverable, not a pile of probes.
- The known contract is non-negotiable; the means are intentionally open-ended
  in full-access mode.
- Smaller validated bundle with explicit gaps beats an unfinished investigation.
- Evidence references must resolve.
- Current-MCP gaps must be represented as facts, not omitted.
- Analysis affordances are part of the product. A bundle that makes a valid API
  call but leaves a downstream agent guessing about code meanings, row ordering,
  measure reconciliation, sampling boundaries, or filter confidence is not yet
  story-ready.
- Evidence copied from a reviewer report or MCP story gate must use
  `source.kind=review_report` or `source.kind=mcp_story_gate`. Reserve
  `source.kind=live_probe` for direct API probes with request/response evidence.
- User-facing artifacts must not contain process narration like "I am treating
  your instructions literally."
- User-facing artifacts must not contradict the JSON state. If
  `endpoint.availability.status` is `available` or `partially_available`,
  `usage.md` must not say live availability is unconfirmed.
- The agent may inspect and probe freely in full-access mode, but it must stop
  investigating once it can classify the major facts and satisfy the artifact
  contract.
- A repairer may not keep spending turns on optional enrichments after the
  selected task is satisfied. It must validate and return a structured report so
  the next loop can decide whether further work is worth owning.
- A repairer handling a story-derived task with explicit `evidenceToUse` should
  not re-run broad endpoint research. Extra probes are for named missing facts,
  failed validation, or a concrete contradiction in the target artifacts.
- A producer may not declare success immediately after validation. It must
  run the self-story gate and finalize inside the agentic loop so story-level,
  path, and artifact-inventory mistakes are repaired by the same agent run, not
  by a parent process after the fact.
- Promotion and finalization must fail loudly if the self-story report is
  missing or still has owned blocker/major gaps.

## Status Model

Use status as the scaling primitive:

- `documented_unverified`: docs say it exists, not yet confirmed
- `documented_and_observed`: docs and live probes agree
- `observed`: live probes discovered behavior not clearly documented
- `contradicted`: docs and live behavior disagree
- `observed_unavailable`: route or behavior is unavailable in live probes
- `inferred`: derived from evidence but not directly probed
- `unknown`: explicitly unresolved

This prevents the core failure of the old pipeline: turning "not fully probed"
into "not part of the MCP."

## First-Try Acceptance Criteria

A first-pass endpoint bundle is acceptable when:

- `npm --prefix scripts/codex run semantic:validate -- --root <job-root>` passes.
- `run_self_story_gate` has exercised the candidate bundle through the MCP, or
  the final summary explicitly explains why the gate was blocked by external
  conditions.
- `endpoint.json` contains every material documented request field, with status.
- `semantics.json` has an analytical grain and business purpose tied to evidence.
- `usage.md` is consistent with the JSON artifacts and contains no process notes.
- Remaining uncertainty is explicit in `gaps` or `caveats`.

Promotion-grade acceptance additionally requires an MCP story gate for at least
one realistic analytical question. The story gate should pass only when another
coding agent can discover the endpoint, build a request from the semantic
surface, preflight it, call it, and explain the result without relying on hidden
knowledge of the API.

Discovery acceptance includes semantic-only bundles. If a promoted semantic
bundle exists without a legacy raw profile, `usaspending.findEndpoints` should
still surface it from the semantic artifact metadata.

## Failure Modes Seen In The Spike

The first free-range SDK attempt over-investigated and timed out without final
artifacts. The second produced useful endpoint files but missed `evidence.jsonl`
and leaked process narration into `usage.md`. Those failures changed the model:

- create the four-file skeleton early
- write evidence first, then cite it
- cap probes
- synthesize before optional exploration
- write `usage.md` last
- run a final consistency audit so broad endpoints do not retain stale draft
  caveats after live probes
- enforce an explicit validation-first rule and probe/search budgets in the
  agent instructions

The Agents SDK runner encodes those lessons as agent instructions and tool
contracts, while keeping endpoint facts and prose authored by the model.

Later story-gate runs found additional failure modes:

- validators can pass while MCP preflight rejects a valid story request because
  enum evidence was narrowed too aggressively
- request fact paths like `body.filters` make valid body requests look missing
  to the MCP runtime
- broad repair can write correct artifacts but fail to return a final report;
  single-task repair with explicit validation is more reliable
- story and review reports need to be allowable evidence sources when they carry
  scoped MCP/live-call observations into a repair task
- async endpoints can require a prerequisite workflow to create a fresh
  `file_name` or similar identifier before the target endpoint can be probed
  honestly
- concurrent producer runs can report success after agents move or stash output
  directories; the endpoint runner now checks that a completed validated summary
  points to real `endpoint.json`, `semantics.json`, `evidence.jsonl`, and
  `usage.md` files on disk
- frontier story suites are effective at finding business-semantics gaps that
  endpoint validators cannot see, such as fiscal month bucket labeling,
  geography rows for territories/uncoded buckets, and preview-vs-download
  continuity limits
- story-gate repair tasks need machine-readable routing metadata (`targetSlug`)
  and an emitted repair queue, otherwise a human has to translate model findings
  into the next repair-agent invocation
