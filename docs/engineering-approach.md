# Engineering Approach

This repo is organized around one product claim: a coding agent should be able to
query USAspending through MCP with enough semantic context to build correct,
scoped, evidence-aware requests.

## Design Posture

The semantic MCP is not produced by endpoint-specific extraction code. Endpoint
knowledge is authored by a general coding agent with broad local autonomy and a
clear artifact contract.

The codebase should therefore separate three responsibilities:

- **Agent authorship**: model-owned investigation, probing, reconciliation, and
  business-semantic writing.
- **Generic gates**: schema validation, evidence-link checks, MCP loading,
  request validation, self-story gates, smoke tests, and frontier story gates.
- **Runtime execution**: deterministic MCP tools that expose semantic context and
  make scoped USAspending calls.
- **Exploratory learning**: story agents use the MCP as written, discover
  reusable semantic gaps, and feed those learnings back into bundle repair or
  generic runtime affordance work.

This distinction matters. Deterministic checks are useful when they enforce a
general contract. They are misaligned when they encode endpoint-specific
semantic answers that the agent should have discovered and justified.

## Non-Negotiable Artifacts

Every semantic endpoint must produce:

```text
endpoint.json
semantics.json
evidence.jsonl
usage.md
```

Those files are the interface between agents, validators, the MCP runtime, and
future orchestration frameworks. Any new workflow should improve how these
artifacts are produced or tested, not bypass them.

Semantic affordances inside `endpoint.json` are part of this artifact contract.
When a handoff key, measure warning, or follow-up pattern matters for downstream
analysis, the model should declare it in the bundle with evidence. Runtime code
may expose those declarations structurally, but it must not invent endpoint
semantics on its own.

If exploratory story work discovers useful meaning in joins, caveats, workflows,
or usage prose, the preferred repair is to promote that meaning into
`semanticAffordances` before asking the runtime to expose it. Runtime affordance
work should apply declared semantics, not mine arbitrary text for endpoint
meaning.

## Autonomy Model

The primary runner is `scripts/agents`, using the OpenAI Agents SDK.

Default mode is `full_access`:

- producer, reviewer, repairer, and story agents receive `full_access_shell_command`
- they can inspect source, run scripts, call live APIs, run MCP checks, and debug
  validation failures through shell when narrow tools are insufficient
- the contract stays strict: autonomy does not lower evidence or validation
  standards

No approval-gated or restricted autonomy mode is part of the active
architecture. The only practical boundaries are host/process boundaries:
filesystem and network access available to the SDK process, non-interactive
command execution, timeout limits, and output limits. Quality gates are not
access controls; they are the artifact acceptance contract.

## Validation Philosophy

Validation should be strict, generic, and artifact-focused:

- required files must exist
- schemas must parse
- evidence references must resolve
- observed facts must cite evidence
- availability claims must cite live probes
- contradictions, caveats, and risky-but-valid request patterns must remain visible
- prose must not introduce claims absent from JSON artifacts
- producer self-story gates must exercise the candidate bundle through MCP
  before finalization, with owned blocker/major gaps repaired inside the same
  agent run
- story reports should separate the story answer from generalizable learnings
  and runtime affordance requests, so the loop improves the MCP rather than only
  grading one scenario

Do not weaken validators to make one generated bundle pass. Fix the bundle or
surface the blocker.

## Code Organization Rules

- Put semantic production logic in `scripts/agents`.
- Keep MCP runtime and semantic bundle loading in `scripts/mcp`.
- Keep shared schemas in `src/agent/core`.
- Remove prototype generators once a stronger agentic workflow supersedes them.
- Do not keep compatibility paths for retired raw-profile tooling.
- Prefer tests that prove role instructions, tool access, artifact contracts,
  validators, and MCP behavior over tests that snapshot generated endpoint facts.

## Acceptance Bar

A change is aligned with this repo only if it helps answer at least one of these
questions:

- Can an agent produce a richer semantic bundle for a hard endpoint?
- Can another agent use the MCP bundle to ask and answer an interesting
  USAspending question?
- Does validation catch a real class of artifact or MCP failures without
  encoding endpoint-specific answers?
- Does the runtime expose the semantic context needed to construct valid,
  scoped API calls?

If the answer is no, the code is likely scaffolding or dead weight.
