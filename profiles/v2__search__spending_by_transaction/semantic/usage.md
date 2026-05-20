# Spending by Transaction

## When to use this endpoint

Use `v2__search__spending_by_transaction` when you need actual transaction rows behind a USAspending advanced-search filter set.

This endpoint is the right choice when you need:

- one row per matching transaction
- transaction-level obligation screening
- modification-level or action-date-level inspection
- projection-driven row output where you choose which columns appear

## When not to use it

Do **not** use this endpoint when you need:

- one row per award
- grouped totals by geography, time, or category
- a bulk export of very large result sets
- award-level totals inferred from transaction rows alone

If the question is award-centric, this clean-slate MCP surface is not sufficient yet. Preserve `generated_internal_id` from interesting rows so a future promoted parent-award bundle can pick up the analysis without relying on display `Award ID`.

## Core request shape

Send a `POST` request to `/api/v2/search/spending_by_transaction/` with JSON body fields:

- `filters` — required advanced-search filter object
- `fields` — required list of response column labels
- `sort` — required field label used for ordering
- `order` — optional `asc` or `desc`; documented default `desc`
- `page` — optional page number; documented default `1`
- `limit` — optional page size; documented default `10`

The source validator also enforces:

- `sort` must be one of the requested `fields` (live negative probe confirmed HTTP 400 when this rule is violated)
- `limit <= 100`
- `(page - 1) * limit < 50000`
- `award_type_codes` is required inside `filters`

## Good starter request

```json
{
  "filters": {
    "time_period": [
      {
        "start_date": "2024-01-01",
        "end_date": "2024-12-31"
      }
    ],
    "award_type_codes": ["A", "B", "C", "D"]
  },
  "fields": [
    "Award ID",
    "Mod",
    "Recipient Name",
    "Action Date",
    "Transaction Amount",
    "Awarding Agency",
    "Awarding Sub Agency",
    "Award Type"
  ],
  "page": 1,
  "limit": 5,
  "sort": "Transaction Amount",
  "order": "desc"
}
```

Use a bounded `time_period` for first-pass analysis. Unbounded transaction searches are valid but usually broader than an analytical screen needs.

## Useful filter families

The documented filter surface includes:

- `keywords`
- `description`
- `time_period`
- `award_type_codes`
- `agencies`
- `recipient_search_text`
- `recipient_locations`
- `place_of_performance_locations`
- `award_ids`
- `award_amounts`
- `program_numbers`
- `naics_codes`
- `tas_codes`
- `psc_codes`
- `contract_pricing_type_codes`
- `set_aside_type_codes`
- `extent_competed_type_codes`
- `treasury_account_components`
- `program_activities`
- `def_codes`
- `award_unique_id`

### Important caveats about the filter surface

- Docs list `filters.program_activity`, but source inspection suggests the actual view validator may no longer accept it. Prefer `filters.program_activities`.
- Docs describe `time_period` as action-date filtering. Source inspection also found an undocumented `time_period[].date_type` option, but live support is not yet confirmed in this draft.
- Source inspection found an undocumented `filters.recipient_id` field.
- Quoted `award_ids` are documented to request exact matching.


### Agency-bounded screening

A live 2026-05-20 probe confirmed this awarding-agency filter shape for a bounded Department of Defense contract transaction screen:

```json
{
  "filters": {
    "time_period": [
      {
        "start_date": "2024-01-01",
        "end_date": "2024-12-31"
      }
    ],
    "award_type_codes": ["A", "B", "C", "D"],
    "agencies": [
      {
        "name": "Department of Defense",
        "tier": "toptier",
        "type": "awarding"
      }
    ]
  },
  "fields": [
    "Award ID",
    "Mod",
    "Recipient Name",
    "Action Date",
    "Transaction Amount",
    "Awarding Agency",
    "Awarding Sub Agency",
    "Award Type"
  ],
  "page": 1,
  "limit": 5,
  "sort": "Transaction Amount",
  "order": "desc"
}
```

In the live result, all five returned rows had `Awarding Agency = Department of Defense`.

## How to choose fields

The response is **projection-driven**.

That means:

- most visible row keys come from the `fields` list you sent
- derived labels such as `Recipient Location`, `Primary Place of Performance`, `NAICS`, `PSC`, and `Assistance Listing` can return nested objects rather than simple strings
- source code appends `internal_id` and `generated_internal_id` to every row even if you did not request them

A live 2026-05-20 preview also confirmed that `Recipient Location` comes back as a nested object with country, state, city, county, address, ZIP, and foreign-postal keys rather than a single display string.

Do not parse this endpoint as if it always returned one fixed default row schema.

## How to read the response

The top-level response includes:

- `limit`
- `page_metadata`
- `results`
- usually `messages` on the normal search path

### Pagination

`page_metadata` contains:

- `page`
- `hasNext`
- `hasPrevious`
- `next`
- `previous`

This is regular page/limit pagination, but the source blocks very deep paging once the request window reaches 50,000 rows.

### Row interpretation

Each row is one transaction, not one award.

Important fields include:

- `Transaction Amount` — transaction-level obligation amount
- `Action Date` — transaction action date when requested
- `Award ID` — display identifier for humans
- `generated_internal_id` — best parent-award identity handle to preserve as row context
- `internal_id` — internal numeric award id

## Parent award handoff note

When a transaction row looks interesting:

1. Keep the row-level context you screened on.
2. Capture `generated_internal_id` from that row.
3. Treat that value as parent-award context rather than relying on the display `Award ID`.

`generated_internal_id` is the safer reusable parent-award identity handle. No parent-award detail or funding bundle is currently promoted in the clean-slate MCP, so this bundle preserves the handoff value without advertising an unavailable follow-up endpoint.

## Measurement caveat

`Transaction Amount` is a **transaction** measure mapped from `federal_action_obligation`.

Use it for:

- ranking transaction rows
- screening large obligation events
- summing returned transaction rows when the question is explicitly transaction-level

Do **not** use it as if it were:

- lifetime award amount
- one-row-per-award amount
- current-period outlays

Multiple returned rows can belong to the same award.

## Availability note

A live bounded contract transaction probe on 2026-05-20 returned HTTP 200 with transaction rows, page metadata, helper ids, and the standard earliest-search-date warning, so the endpoint is currently callable.

## Edge case: `no intersection`

A live 2026-05-20 probe confirmed that `filters.award_type_codes: ["no intersection"]` returns HTTP 200 with an empty `results` array and page metadata showing no next or previous page. That short-circuit response also omitted `messages`. Treat this as a source sentinel for an already-empty filter intersection, not as a normal search result page.
