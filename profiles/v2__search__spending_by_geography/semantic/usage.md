# Spending by Geography

## When to use this endpoint

Use `v2__search__spending_by_geography` when the answer needs geography buckets rather than award-level rows. This is the right endpoint for a:

- state spending map
- county or district geography map
- country spending comparison map
- choropleth or other geography heatmap
- geography panel in a dashboard
- map panel paired with `v2__search__spending_over_time`

It summarizes advanced-search filters into one row per geography bucket across:

- states
- counties
- congressional districts
- countries

You can summarize by either:

- `scope = place_of_performance`
- `scope = recipient_location`

And you can choose the aggregation source with `spending_level`:

- `transactions` (documented default)
- `awards`
- `subawards`

## Choose this instead of spending_by_award when

Use this endpoint instead of an award-detail search when you need:

- one row per geography bucket for a map or choropleth
- a state or county layer that will be joined to map shapes
- a geography summary panel beside a matching trend chart
- location totals first, with award drilldown only as a later follow-up step

If the next action is to inspect individual awards or transactions behind a geography bucket, use an award-detail endpoint after you finish the geography summary step.

## When not to use it

Do **not** use this endpoint when you need:

- award-level or transaction-level rows
- documented pagination or sort controls for scrolling large detail sets
- search coverage earlier than `2007-10-01`

This endpoint returns grouped geography totals, not detailed records.

## Core request shape

Send a `POST` request to `/api/v2/search/spending_by_geography/` with JSON body fields:

- `filters` — required `AdvancedFilterObject`
- `scope` — required; `place_of_performance` or `recipient_location`
- `geo_layer` — required; `state`, `county`, `district`, or `country`
- `spending_level` — optional; defaults to `transactions`
- `geo_layer_filters` — optional list of geography codes to limit the returned rows
- `subawards` — optional legacy boolean; prefer `spending_level = subawards`

## Request templates

### Minimal state aggregation

```json
{
  "filters": {
    "keywords": ["infrastructure"]
  },
  "scope": "place_of_performance",
  "geo_layer": "state"
}
```

### Same-scope dashboard state map

Use this when you want the geography or map panel of a bounded domestic contract dashboard that also uses `v2__search__spending_over_time` for the companion trend. This reviewer-validated request shape later returned HTTP 200 with `scope = place_of_performance`, `geo_layer = state`, `spending_level = transactions`, and 57 geography rows.

```json
{
  "filters": {
    "time_period": [
      {
        "start_date": "2024-01-01",
        "end_date": "2024-06-30"
      }
    ],
    "place_of_performance_scope": "domestic",
    "award_type_codes": ["A", "B", "C"]
  },
  "scope": "place_of_performance",
  "geo_layer": "state"
}
```

Set `filters.place_of_performance_scope` explicitly instead of relying on the documented state-layer domestic default when the map must match a paired trend request exactly.

### County aggregation by recipient location

```json
{
  "filters": {
    "recipient_scope": "domestic",
    "recipient_search_text": ["school district"]
  },
  "scope": "recipient_location",
  "geo_layer": "county",
  "spending_level": "awards"
}
```

## Important filter families

The endpoint reuses the broader advanced-search filter object. Common documented filter families include:

- `time_period`
- `agencies`
- `place_of_performance_locations`
- `recipient_locations`
- `recipient_search_text`
- `recipient_type_names`
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
- `object_class`
- `program_activity`
- `program_activities`
- `def_codes`

Two scope-related filters have documented defaults of `domestic` only for `geo_layer` values `county`, `district`, and `state`:

- `filters.place_of_performance_scope`
- `filters.recipient_scope`

Reviewer-observed same-scope state-map evidence also proved `filters.place_of_performance_scope: "domestic"` together with `filters.award_type_codes: ["A", "B", "C"]` on a successful request.

## How to read the response

The response echoes:

- `scope`
- `geo_layer`
- `spending_level`

The main payload is `results`, where each row represents one geography bucket with fields such as:

- `shape_code` — geography identifier; when `geo_layer = state`, reviewer-observed output can include territorial codes and an empty string for an uncoded bucket
- `display_name` — geography label; may be `null` for an uncoded bucket in state results
- `aggregated_amount` — aggregated obligation amount
- `population` — nullable
- `per_capita` — nullable
- `total_outlays` — only documented for `spending_level = awards`

A `messages` array may also appear with warnings or guidance.

## Interpretation tips

- Treat each row as one geography unit at the selected `geo_layer`.
- Use `shape_code` together with `geo_layer` when joining to reference geography tables or map shapes.
- For `geo_layer = state`, do not assume only the 50 states plus DC; reviewer-observed output also included `GU`, `PR`, `VI`, `MP`, and `AS`.
- Treat `shape_code = ""` with `display_name = null` as an uncoded bucket and filter or label it explicitly before joining to state map shapes.
- Do not treat returned row order as a ranking. Reviewer-observed live state results placed Illinois (`4122006232.61`) and Pennsylvania (`6663007323.8`) before Virginia (`36056943153.79`), and California (`15091679399.12`) before Texas (`17762658845.64`). Sort client-side by `aggregated_amount` or another explicit metric before building ranked state or geography lists.
- Handle `population` and `per_capita` as nullable.
- Do not assume `total_outlays` exists unless you requested award-level spending.

## Caveats

- The documented sample warns that `subawards` will be deprecated; use `spending_level = subawards` for new work.
- The documented sample also warns that search time periods are currently limited to an earliest date of `2007-10-01`.
- Some nested filter object details are defined in shared `search_filters` documentation rather than on this page.
- Reviewer-observed live state results included `GU`, `PR`, `VI`, `MP`, and `AS` plus one blank uncoded bucket; do not assume only the 50 states plus DC.
- Response row order is not a ranking guarantee; sort explicitly before showing top states or other ranked geography lists.
- The docs do not describe pagination fields for this endpoint.
