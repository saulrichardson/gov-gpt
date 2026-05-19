# Download Status

Use `GET /api/v2/download/status` after you have already started a USAspending download job and have its exact `file_name`. This endpoint tells you whether the job is still processing, finished, or failed, and it marks the boundary between semantic MCP polling and the raw archive-retrieval step that follows.

## When not to use it
- Do **not** use this endpoint to start a new download job.
- Do **not** use it to inspect award, transaction, or account rows directly.
- Do **not** use it to discover jobs by search criteria; it looks up one exact `file_name`.
- Do **not** expect it to inspect ZIP members or CSV headers for you; that happens after polling, outside this MCP surface.

## Request shape
- **Method:** `GET`
- **Path:** `/api/v2/download/status`
- **Query parameter:**
  - `file_name` (required, string): exact ZIP filename returned by a prior download endpoint response.

Example template:

```http
GET /api/v2/download/status?file_name=FILE_NAME_FROM_DOWNLOAD_RESPONSE.zip HTTP/1.1
Host: api.usaspending.gov
```

## How to interpret the response
Successful responses describe one download job and its archive metadata:
- `status`: backend job state. Docs list `ready`, `running`, `finished`, and `failed`, but source code shows additional backend states can exist.
- `message`: usually `null`, but intended for failure context.
- `file_name`: echoes the requested job identifier.
- `file_url`: the eventual archive URL. It can appear before the archive is actually retrievable.
- `total_size`: archive size in kilobytes when known.
- `total_rows` and `total_columns`: counts for generated CSV content. Before a successful terminal state, treat them as provisional.
- `seconds_elapsed`: elapsed processing time serialized as a string.

Reviewer-backed bounded polling on 2026-05-14 observed:
- HTTP 200
- `status: "running"`
- `message: null`
- absolute `file_url`
- `total_size: null`
- `total_rows: 0`
- `total_columns: 0`
- string `seconds_elapsed`
- supplemental raw fetches of the returned `file_url` still returned `403` while the job remained nonterminal

Error responses can instead return only:

```json
{"detail":"..."}
```

That happens for missing, blank, or unknown `file_name` values.

## Safe interpretation rules
- Treat `status` as an open-ended backend state string, not a guaranteed closed enum.
- Treat `file_url` as a future retrieval location until the job reaches a successful archive-ready state. Do **not** assume its presence means the ZIP is downloadable yet.
- Treat `total_rows`, `total_columns`, and any non-null `total_size` in nonterminal states as operational metadata, not final analytical facts.
- This endpoint answers job readiness only. It does **not** tell you which archive member to parse or whether emitted CSV headers match your downstream schema.

## Post-`file_url` handoff for pipeline builders
This endpoint is the end of the semantic MCP polling surface for the async download workflow. After that point, continue with ordinary HTTP and ZIP/CSV tooling.

1. **Start upstream and retain context.** Keep the exact `file_name`, the initiating endpoint slug, and the requested export columns or other output-shaping inputs from the job-creation call.
2. **Poll until the job is decisive.** While status remains nonterminal, keep polling this endpoint and do not begin ingest just because `file_url` is populated.
3. **Switch to raw retrieval after success.** Once the job reaches a successful archive-ready state, fetch `file_url` with normal HTTP tooling rather than another semantic endpoint.
4. **Inspect the ZIP outside MCP.** Open the archive, identify the member(s) expected for the initiating endpoint, and choose the file that matches your pipeline's grain.
5. **Validate parser headers before loading.** Compare the emitted CSV header row with the initiating endpoint's requested export columns or documented output contract before treating the file as dashboard-ready.
6. **Handle failures explicitly.** If status becomes `failed`, use `message` when present and repair or restart the upstream download request.

## Typical workflow
1. Start a download job from an initiating endpoint such as `v2__download__awards`.
2. Capture the returned `file_name` or extract it from `status_url`.
3. Poll `v2__download__status` with that exact `file_name`.
4. While the job is nonterminal, treat `file_url`, `total_rows`, and `total_columns` as provisional metadata only.
5. After successful completion, leave MCP polling, fetch `file_url`, inspect the returned ZIP, and validate the CSV header row before analysis.
6. If the job fails, inspect `message` when present or restart the download workflow.

## Safe usage tips
- Preserve `file_name` exactly as returned; near matches are not resolved.
- Handle 400/404 error payloads separately from 200 responses.
- Carry forward the initiating request context so you know which archive member names and headers to expect after retrieval.
- Avoid treating nonterminal row and column totals as final analytical facts.
