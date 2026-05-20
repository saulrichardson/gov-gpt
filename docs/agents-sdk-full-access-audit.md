# Agents SDK Full-Access Audit

Date: 2026-05-19

## Purpose

Verify that the Agents SDK workflow gives agents as much local autonomy as this
Codex session, then stress-test whether high-autonomy agents produce useful
USAspending semantic MCP bundles.

Current conclusion: the active workflow now runs only in full-access execution
mode. The former restricted mode has been removed from the architecture. The
remaining controls are artifact acceptance gates, not approval gates.

## Access Model

Default autonomy mode is now `full_access`.

```bash
npm --prefix scripts/agents run semantic:agent -- --slug <slug>
npm --prefix scripts/agents run semantic:review -- --slug <slug>
npm --prefix scripts/agents run semantic:repair -- --slug <slug> --review-report <report>
npm --prefix scripts/agents run semantic:story -- --question "<question>"
```

All four roles accept:

```bash
--autonomy full_access
```

`full_access` is the default and active autonomy posture.

## What Full-Access Mode Adds

Full-access mode adds `full_access_shell_command` to each Agents SDK role:

- producer
- reviewer
- repairer
- story gate

The tool runs arbitrary shell commands through `/bin/zsh` with the SDK process
environment, local filesystem access, and network access. Its schema requires
explicit nullable fields:

```json
{
  "command": "pwd",
  "cwd": null,
  "timeoutMs": null,
  "maxOutputChars": null
}
```

Full-access mode also enables parallel tool calls:

```ts
parallelToolCalls: autonomy === "full_access"
```

The active architecture does not include an approval-gated or restricted agent
mode.

This is not a persistent interactive terminal. Each call is a one-shot command,
with host/process permissions, command timeout, and output truncation as runtime
mechanics. Within those mechanics, the agent can inspect files, run scripts,
create helper artifacts, call live APIs, exercise MCP tools, and debug failures
without asking for approval.

The design intent is contract-first autonomy: the agent is given a known output
contract and acceptance bar, then it is free to run any command it needs to meet
that contract. The orchestration should not encode endpoint-specific paths or
force the agent through a predetermined investigation recipe. It should enforce
artifact validity, evidence, and MCP usefulness after the fact.

## Runtime Verification

Agents SDK package:

```json
{
  "name": "@openai/agents",
  "version": "0.5.4"
}
```

The smoke test confirms the producer has the full-access shell tool:

```bash
npm --prefix scripts/agents run smoke
```

Observed:

```json
{
  "hasOpenAIKey": true,
  "usedCodexKeyAlias": true,
  "toolNames": [
    "load_endpoint_context",
    "read_repo_file",
    "search_repo",
    "list_directory",
    "probe_usaspending_api",
    "write_artifact_file",
    "validate_semantic_bundle",
    "run_self_story_gate",
    "promote_semantic_bundle",
    "finalize_validated_bundle",
    "list_output_files",
    "full_access_shell_command"
  ]
}
```

Direct local invocation of the full-access tool succeeded:

```json
{
  "ok": true,
  "cwd": "/Users/saulrichardson/projects/gov-gpt",
  "command": "pwd",
  "stdout": "/Users/saulrichardson/projects/gov-gpt\n"
}
```

A direct network check through the same tool returned `HTTP/1.1 200 OK` from
`https://api.usaspending.gov/api/v2/references/award_types/`.

## Configuration Bug Found And Fixed

The first real full-access agent run failed before endpoint work:

```text
400 Invalid schema for function 'full_access_shell_command':
'required' is required to be supplied and to be an array including every key
in properties. Missing 'cwd'.
```

Cause: the model-facing tool schema used optional properties. Fix: make `cwd`,
`timeoutMs`, and `maxOutputChars` required nullable fields and instruct agents
to pass `null` for defaults.

This is an important audit result: local tool invocation worked before this
fix, but the model API rejected the schema. The access mode is now verified at
the API schema boundary.

## Stress-Tested Endpoints

Two high-autonomy producer runs were executed:

```bash
npm --prefix scripts/agents run semantic:agent -- \
  --slug v2__awards__funding \
  --out-root runs/agents-sdk-full-access-dig \
  --autonomy full_access

npm --prefix scripts/agents run semantic:agent -- \
  --slug v2__disaster__spending_by_geography \
  --out-root runs/agents-sdk-full-access-dig \
  --autonomy full_access
```

Both produced valid Semantic Profile V2 bundles:

```bash
npm --prefix scripts/agents run semantic:validate -- \
  --root runs/agents-sdk-full-access-dig

USASPENDING_SEMANTIC_BUNDLE_GLOB='/Users/saulrichardson/projects/gov-gpt/runs/agents-sdk-full-access-dig/*/endpoint.json' \
  scripts/mcp/bin/validate-semantic-bundles
```

Final validation:

- `v2__awards__funding`: available, 6 evidence records, 5 request facts, 28
  response facts and 2 contradictions.
- `v2__disaster__spending_by_geography`: available, 8 evidence records, 10
  request facts, 10 response facts, and 2 contradictions.

## Useful MCP Result

The story gate passed after two repair iterations:

```bash
npm --prefix scripts/agents run semantic:story -- \
  --bundle-glob '/Users/saulrichardson/projects/gov-gpt/runs/agents-sdk-full-access-dig/*/endpoint.json' \
  --autonomy full_access \
  --output runs/agents-sdk-story/full-access-dig-disaster-funding-story-after-repair.json
```

The MCP was useful in concrete ways:

- Disaster geography semantics helped the story agent send a valid object body
  despite contradictory docs that typed the body as a string.
- It explained `scope` and the default `recipient_location` behavior.
- It explained null/uncoded geography buckets and why the endpoint is not
  award-level detail.
- It added a concrete state-level drilldown mapping: non-null `shape_code`
  values become downstream award-search location objects such as
  `{"country":"USA","state":"CA"}`, routed to `recipient_locations` or
  `place_of_performance_locations` based on `scope`.
- Award funding semantics framed rows as federal-account/accounting slices, not
  award totals.
- It warned that default sort behavior contradicts docs, so callers should set
  `sort` and `order` explicitly.
- It captured that `disaster_emergency_fund_code` is string-or-null in live data
  rather than boolean.
- It captured null `gross_outlay_amount` and negative obligation values.
- It exposed a machine-readable safe template for
  `getRequestTemplate(..., useCase: "safe template")`.

Direct MCP check after repair:

```json
{
  "slug": "v2__awards__funding",
  "templates": [
    {
      "name": "safe-template-award-funding-page",
      "request": {
        "body": {
          "award_id": "CONT_AWD_0002_2800_SS001740003_2800",
          "page": 1,
          "limit": 10,
          "sort": "reporting_fiscal_date",
          "order": "desc"
        }
      }
    }
  ]
}
```

The validated full-access bundles for `v2__awards__funding` and
`v2__disaster__spending_by_geography` were then promoted into
`profiles/<slug>/semantic/`. A promoted-bundle story gate over the six semantic
bundles found a downstream weakness in
`v2__search__spending_by_award_count`: the disaster-geography-to-award-count
workflow worked live, but the downstream bundle still warned on live-supported
filters and lacked a ready request template. Three task-scoped repair agents
updated that bundle, after which a direct MCP acceptance check for the Virginia
DEFC `L` drilldown returned `valid: true` with no warnings.

## Failure Modes Observed

Full-access mode increased capability, but it did not remove the need for gates:

- The disaster producer initially wrote a scratch bundle under
  `_v2__disaster__spending_by_geography` before later writing the correct slug
  directory. The scratch directory had to be removed so MCP globs would not see
  duplicate slugs.
- Parallel repair agents briefly raced: the awards-funding repair validated
  while the disaster repair had a transient missing evidence reference. A fresh
  root validation after both repairs passed.
- Story testing caught a machine-readability gap: a template existed in prose
  and endpoint artifacts, but its name/description did not match the use case
  `safe template`, so `getRequestTemplate` returned an empty list until repaired.

These are not reasons to avoid Full-access mode. They are reasons to keep generic
validation and story gates.

## Current Conclusion

The Agents SDK agents now have broad local and network autonomy through shell
access by default, plus their role-specific semantic tools. The high-autonomy
producer/reviewer/repair/story loop produced useful MCP semantics for two
complicated endpoints, promoted them into the MCP surface, and then improved a
third promoted bundle when story testing found a real downstream usability gap.

The right shape is:

1. Run producers in Full-access mode.
2. Validate generated bundles generically.
3. Run story gates in full-access mode so the agent can diagnose MCP, bundle, and live-call issues without an approval loop.
4. Repair via narrow tasks, still with full-access shell authority by default.
5. Promote only after validation plus story acceptance.

## Follow-Up: Semantic Affordance Receipts

A later iteration kept the same full-access posture but changed the quality bar:
story agents now report reusable semantic learnings and runtime affordance
requests in addition to pass/fail story results.

The important finding was that high-quality prose in `semantics.json` and
`usage.md` is not enough for a downstream coding agent. If a caller needs a
handoff key, a measure warning, or a next-call recommendation at execution time,
the bundle should declare it in `endpoint.json.semanticAffordances`.

The runtime support added in this iteration is generic:

- extract declared handoff values from live responses
- return declared measure warnings with observed response values when available
- return declared recommended follow-ups

The runtime does not infer endpoint-specific business meaning from arbitrary
text. The agent declares the semantics; the MCP exposes them structurally.

The follow-up stress test used a FY2026 contract outlier story across
`v2__search__spending_by_award`, `v2__awards__award_id`, and
`v2__awards__funding`. After scoped repairs, live MCP calls returned semantic
receipts that carried `generated_internal_id` as `canonical_award_lookup_id`,
warned that bounded-screen `Award Amount` is not current-period spend, and
warned that funding rows have their own reporting-period scope. The story gate
then passed with high confidence and produced a defensible legacy-contract
analysis without adding endpoint-specific runtime branches.
