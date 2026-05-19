# Spending by Award

## When to use this endpoint

Use `v2__search__spending_by_award` when you need the actual award or subaward rows behind USAspending advanced-search filters.

This is the row-level search surface for questions like:

- which awards match these filters?
- which recipients or agencies appear in this slice?
- which high-value contract hits already look old, cross-agency, or otherwise outlier-worthy before drilldown?
- which subawards belong to the filtered population?
- which rows should I inspect further with award-detail workflows?

Live probing confirmed award-mode availability and a richer bounded contract outlier screen.
Reviewer-backed story evidence also showed that this bounded screen can surface clearly legacy awards, so it must be read as an activity screen rather than a current-period spend table.

## When not to use it

Do **not** use this endpoint when you need:

- pre-aggregated totals by geography, time, or award type
- a bulk-export workflow for very large populations
- funding-footprint validation or `date_signed` without follow-up detail endpoints
- a current-period spend dashboard that would treat row-level `Award Amount` as a fiscal-year subtotal without follow-up
- fields you did not explicitly include in `fields`

This endpoint returns projected rows, not ready-made aggregates.

## Core request shape

Send `POST /api/v2/search/spending_by_award/` with JSON body keys:

- `filters` — required `AdvancedFilterObject`
- `fields` — required array of API-defined field labels
- `limit` — optional; documented default `10`
- `page` — optional page number
- `sort` — optional sort field label; defaults to the first requested field
- `order` — optional `asc` or `desc`; documented default `desc`
- `subawards` — optional legacy boolean for subaward mode
- `spending_level` — optional `awards` or `subawards`; live probing confirmed the default is `awards`
- `last_record_unique_id` and `last_record_sort_value` — optional paired cursor values for sequential Elasticsearch pagination

## Important filter families

The endpoint reuses the broader advanced-search filter object. Important documented filter families include:

- `keywords`
- `time_period`
- `agencies`
- `recipient_search_text`
- `recipient_locations`
- `place_of_performance_locations`
- `award_type_codes`
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
- `program_activity`
- `program_activities`
- `def_codes`
- `award_unique_id`

Two shared nested shapes matter especially:

- `time_period` changes shape between award-mode and subaward-mode requests.
- location filters use the shared `search_filters` location-object definitions rather than a fully inlined schema on this page.

## Request templates

### Keyword-led preview for paired download workflow

Reviewer-backed 2026-05-14 validation and live preview evidence confirmed that this endpoint accepts a bounded keyword-led contract preview when `filters.keywords` is paired with explicit `award_type_codes`.

```json
{
  "filters": {
    "keywords": ["forest"],
    "award_type_codes": ["A", "B", "C", "D"]
  },
  "fields": ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency"],
  "page": 1,
  "limit": 3,
  "sort": "Award Amount",
  "order": "desc"
}
```

This bounded request returned HTTP `200` and `3` award rows in the reviewer-backed live story.

Use this pattern when you want to preview the same contract-oriented filter population that can later be exported by `v2__download__awards`, but keep the boundary clear:

- on `spending_by_award`, include explicit `award_type_codes` instead of relying on download-time default injection
- preview continuity is at the filter-population level; preview `fields`, `sort`, and `limit` do **not** define export schema or row order
- preview labels such as `Award ID` and `Award Amount` are display fields, not download column IDs

### High-value contract screening

Use this when you want the first page to surface top-dollar contract awards immediately instead of alphabetical award IDs.

This is the machine-readable template for `high_value_award_screening`.

```json
{
  "filters": {
    "award_type_codes": ["A", "B", "C", "D"],
    "time_period": [
      {
        "start_date": "2025-10-01",
        "end_date": "2026-09-30"
      }
    ]
  },
  "fields": ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency"],
  "page": 1,
  "limit": 5,
  "sort": "Award Amount",
  "order": "desc"
}
```

Use this thin leaderboard when you only need the top-dollar candidates and plan to drill into detail immediately. Reviewer-backed live workflow evidence showed this bounded request validating cleanly and still returning `generated_internal_id` on each row even though the template only asks for four visible display fields.

### Compact contract outlier dashboard screen

Use this when you want a richer first-pass contract screen before drilldown.

This is the machine-readable template for `contract_outlier_dashboard_screening`.

```json
{
  "filters": {
    "award_type_codes": ["A", "B", "C", "D"],
    "time_period": [
      {
        "start_date": "2025-10-01",
        "end_date": "2026-09-30"
      }
    ]
  },
  "fields": [
    "Award ID",
    "Recipient Name",
    "Award Amount",
    "Awarding Agency",
    "Awarding Sub Agency",
    "Funding Agency",
    "Funding Sub Agency",
    "Contract Award Type",
    "Start Date",
    "End Date",
    "Last Modified Date"
  ],
  "page": 1,
  "limit": 5,
  "sort": "Award Amount",
  "order": "desc"
}
```

A live 2026-05-14 probe returned HTTP 200 with this richer field set and still exposed `generated_internal_id` on each row for downstream handoff. The first two results already carried useful compact-dashboard context before any follow-up call:

- `HT940216C0001` / HUMANA GOVERNMENT BUSINESS INC — `Award Amount` `51269205263.03`, `Contract Award Type` `DEFINITIVE CONTRACT`, `Start Date` `2016-08-01`, `End Date` `2025-12-31`, `Last Modified Date` `2026-02-10 17:52:09`, awarding and funding sub-agency both `Defense Health Agency`
- `DENA0003525` / NATIONAL TECHNOLOGY & ENGINEERING SOLUTIONS OF SANDIA, LLC — `Award Amount` `42111665692.01`, `Start Date` `2017-01-18`, `End Date` `2027-04-30`, awarding agency `Department of Energy`, funding agency `Department of Defense`, funding sub-agency `Department of the Navy`
- reviewer-backed legacy example `DEAC3243AL00036` / REGENTS OF THE UNIVERSITY OF CALIFORNIA, THE — `Award Amount` `35295689219.18`, `Start Date` `1978-09-30`, `End Date` `2006-05-31`, `Last Modified Date` `2026-05-06 14:28:38`, still returned inside the bounded FY2026 screen

Use this template to spot three common outlier patterns earlier:

- older still-active awards that look new only because the bounded `time_period` is an activity screen
- clearly legacy awards whose visible dates are far older than the bounded period but whose later activity still brings them into scope
- cross-agency-funded contracts that deserve a closer look even before award-detail drilldown

That Regents row is the dashboard-safe reminder: a bounded `time_period` search is an activity screen, not a current-period spend subtotal. The row can be in scope because of later activity or modification even when the visible start and end dates are decades older than the filter window.

Keep the first-screen meanings separate:

- `Award Amount` = lifetime award size on the matched award row
- bounded `time_period` match = evidence that the award had relevant in-period activity or updates somewhere in the search system
- the search row does **not** tell you which specific FY2026 transaction, modification, or funding event caused the match

#### Dashboard-safe follow-up for legacy-looking rows

If a row looks surprisingly old for the bounded `time_period`, treat the search hit as an activity-screen match until follow-up explains it.

1. Compare `Start Date`, `End Date`, and `Last Modified Date` before calling the row a current-period award.
2. If those visible dates make the row look legacy or already ended, label it provisionally as an **activity-screen match**, not as current-period spend.
3. Carry `generated_internal_id` or `canonical_award_lookup_id` into `v2__awards__award_id`. In the reviewer-backed Regents example, award detail confirmed `date_signed` `1978-09-30` and `period_of_performance.end_date` `2006-05-31`.
4. After that confirmation, keep `Award Amount` labeled as lifetime award size. Do **not** chart it as FY2026 spend just because the search window was FY2026.
5. If the dashboard still needs a current-period explanation or number, continue with downstream funding or other current-period evidence workflows; do **not** infer that explanation from `Award Amount` alone.

Safe first-screen wording: "The FY2026 activity screen included legacy award `DEAC3243AL00036`; `Award Amount` is the lifetime award size on that matched row."

Unsafe first-screen wording: "USAspending shows `$35.3B` of FY2026 spend for Regents" based only on this search result.

This richer screen is still only a screen. It does **not** replace award detail or funding endpoints when you need `date_signed`, period-of-performance detail, the specific reason a legacy award matched the period, a current-period spend interpretation, or the revealed funding footprint behind the headline award amount.

### Prime-award preview

Use this for a general bounded award browse. If you specifically want top-dollar contracts first, use **High-value contract screening** or **Compact contract outlier dashboard screen** above.

```json
{
  "filters": {
    "award_type_codes": ["A", "B", "C", "D"],
    "time_period": [
      {
        "start_date": "2025-10-01",
        "end_date": "2026-09-30"
      }
    ]
  },
  "fields": ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency"],
  "page": 1,
  "limit": 10,
  "sort": "Award ID",
  "order": "asc"
}
```

### Subaward preview

```json
{
  "spending_level": "subawards",
  "subawards": true,
  "filters": {
    "award_type_codes": ["A", "B", "C", "D"],
    "time_period": [
      {
        "start_date": "2025-10-01",
        "end_date": "2026-09-30"
      }
    ]
  },
  "fields": ["Sub-Award ID", "Prime Award ID", "Sub-Award Amount", "Sub-Awardee Name"],
  "page": 1,
  "limit": 10,
  "sort": "Sub-Award ID",
  "order": "asc"
}
```

## Canonical award handoff id

Status: `canonical_award_lookup_id` is a derived-only semantic alias in this bundle. Live `callEndpoint` search rows materially surface `generated_internal_id`; they do **not** add a second `canonical_award_lookup_id` property.

Decision rule:

- if you are reading raw search JSON, use `generated_internal_id`
- if you are reading the semantic bundle or analysis packet, read `canonical_award_lookup_id` as the normalized name for that same returned string
- do **not** wait for both keys to appear together or treat them as different ids

For cross-endpoint award drilldowns, distinguish the raw field from the semantic alias:

- raw prime-award search response: read `generated_internal_id`
- semantic bundle alias for that same string: `canonical_award_lookup_id`
- subaward row when you want the linked prime award: `prime_award_generated_internal_id`
- `v2__awards__award_id` request: send the same value as path `award_id`
- `v2__awards__award_id` response: expect the same business key to appear as `generated_unique_award_id`
- `v2__awards__funding` request: send the same value as body `award_id`

If you are inspecting live API JSON only, expect to see `generated_internal_id`, **not** a literal `canonical_award_lookup_id` property. This bundle uses `canonical_award_lookup_id` as the normalized semantic name for that same returned value. The selected AI-keyword competition story reconfirmed that split on live rows `W911QX20C0023` and `W911QX25C0002`: search returned only `generated_internal_id`, and award detail accepted that same string unchanged as `award_id`.

Do **not** substitute the display `Award ID` or `Prime Award ID` when the generated helper is available. Those display fields are useful for humans, but `generated_internal_id` / `canonical_award_lookup_id` is the safer machine handoff key.

Example mapping from reviewer-backed drilldown evidence:

- display `Award ID`: `HT940216C0001`
- raw search field `generated_internal_id`: `CONT_AWD_HT940216C0001_9700_-NONE-_-NONE-`
- bundle alias `canonical_award_lookup_id`: `CONT_AWD_HT940216C0001_9700_-NONE-_-NONE-`

## How to read the response

The top-level response contains:

- `spending_level`
- `limit`
- `results`
- `page_metadata`
- optional `messages`

`results` is a row array, but the row schema is projection-driven:

- you get the field-label columns you requested in `fields`
- rows also include helper identifiers such as `internal_id`
- live award-mode probing also returned `generated_internal_id`, `awarding_agency_id`, and `agency_slug`; the raw response does **not** add a literal `canonical_award_lookup_id` property, so this bundle derives `canonical_award_lookup_id` from `generated_internal_id` as the intended downstream award-drilldown handoff field
- a richer live contract-outlier screen also returned `Awarding Sub Agency`, `Funding Agency`, `Funding Sub Agency`, `Contract Award Type`, `Start Date`, `End Date`, and `Last Modified Date` in the same search rows
- subaward-mode rows are documented to include helpers like `prime_award_internal_id` and `prime_award_generated_internal_id`; when you need the linked prime award, treat `prime_award_generated_internal_id` as the prime-award form of `canonical_award_lookup_id`

`page_metadata` includes at least:

- `page`
- `hasNext`
- optional `last_record_unique_id`
- optional `last_record_sort_value`

## Interpretation tips

- Treat `fields` as part of the contract. Changing `fields` changes the row schema.
- Keep award families consistent with the labels you request. Some labels only make sense for contracts, IDVs, loans, assistance, or subawards.
- Do not assume every requested value is a scalar. Some labels such as `NAICS`, `PSC`, and location fields may be structured objects.
- For downstream award-detail or award-funding workflows, read `generated_internal_id` from raw prime-award search output or the same value as bundle alias `canonical_award_lookup_id`; reuse that string unchanged in related endpoints.
- Treat display `Award ID` as a human-facing label, not as the preferred machine handoff id when `generated_internal_id` / `canonical_award_lookup_id` is available.
- In compact outlier screens, compare `Start Date`, `End Date`, and `Last Modified Date` against `Award Amount` before narrating a result as a fresh period outlier, and compare awarding versus funding agency columns before deciding which rows merit deeper drilldown.
- If you see a row like reviewer-backed Regents award `DEAC3243AL00036` with `Start Date` `1978-09-30`, `End Date` `2006-05-31`, and `Last Modified Date` `2026-05-06 14:28:38` inside an FY2026 screen, read it as legacy-award activity evidence rather than a new FY2026 award.
- Treat bounded `time_period` searches as activity screens. They can surface older long-running or clearly legacy awards, and `Award Amount` is still the award-level value on the row, not a period-only subtotal or current-period spend figure.
- The search row does **not** identify the exact transaction, modification, or funding event that caused a legacy award to match the bounded period. Use the row to spot the outlier, not to explain the current-period event.
- Use award detail and funding endpoints to confirm `date_signed`, period-of-performance detail, current-period meaning, and funding footprint before publishing the outlier story.

## Pagination guidance

Simple paging uses `page` and `limit`, and live probing confirmed that `page_metadata` can also return an Elasticsearch-style cursor pair:

- inspect `page_metadata.last_record_unique_id`
- inspect `page_metadata.last_record_sort_value`
- replay the same request with both cursor values together for the next sequential page

Do not send only one of the two cursor fields.

## Caveats

- Nested filter details are split across shared `search_filters` docs.
- Field labels, valid sort keys, and award families interact; invalid combinations can fail validation.
- The legacy `subawards` boolean and `spending_level` both affect whether rows are awards or subawards.
- Live responses can warn that search dates are currently limited to an earliest date of `2007-10-01`.
- A bounded `time_period` high-value screen can surface older still-active awards or clearly legacy awards. Reviewer-backed FY2026 dashboard evidence returned Regents award `DEAC3243AL00036` with 1978 start and 2006 end dates, so treat `Award Amount` as lifetime award size and check award-detail dates before calling results new awards or current-period spend for the screen.
- Even the richer contract outlier screen is still a first-pass search view. Use award detail and funding endpoints for `date_signed`, period-of-performance confirmation, current-period interpretation, and revealed funding footprint.
