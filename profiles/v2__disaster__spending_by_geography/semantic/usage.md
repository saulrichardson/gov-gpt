# Disaster spending by geography

## When to use this endpoint
Use `POST /api/v2/disaster/spending_by_geography/` when you need **aggregated disaster or emergency spending by geography** rather than award-level detail. Live probes on 2026-05-10 and 2026-05-15 confirmed that the endpoint is available for **state-level** requests and supports both default recipient geography and explicit place-of-performance geography. Current live confidence is strongest for `geo_layer: "state"`; `county` and `district` are still documented but not re-probed in this repair and should be treated with an explicit caller warning.

Best-fit use cases:
- map DEFC-driven disaster spending by **state** with current live confidence
- compare **obligations** vs **outlays** across geographies
- switch between **recipient location** and **place of performance** with `scope`
- limit the returned rows to a visible map subset with `geo_layer_filters`
- compare `amount`, `award_count`, and `per_capita` across returned geographies after sorting client-side for ranking views

Documented but not reverified in this repair:
- `geo_layer: "county"` — documented, but not re-probed; warn before treating results as equally validated
- `geo_layer: "district"` — documented, but not re-probed; warn before treating results as equally validated
- `spending_type: "face_value_of_loan"` — documented and transport-valid, but not re-probed; treat as lower confidence than `obligation` or `outlay`

## When not to use it
Do **not** use this endpoint when you need:
- award IDs, recipient names, or transaction rows
- a time series in the response
- a recent-only or recipient-bounded geography story driven by shared passthrough filters like `filter.time_period` or `filter.recipient_locations`
- all federal spending regardless of disaster designation
- an end-to-end workflow that stays entirely inside the currently promoted semantic MCP surface for DEFC label translation

Use this endpoint to find interesting geographies first, then drill into award-level endpoints with the same DEFC and geography constraints.

## Request body
Send a **JSON object** body.

Required fields:
- `filter.def_codes`: array of DEFC codes
- `geo_layer`: `state`, `county`, or `district`
  - strongest verified path: `state`
  - validation guidance: if you choose `county` or `district`, treat the request as documented-but-not-reverified in this bundle
- `spending_type`: `obligation`, `outlay`, or `face_value_of_loan`
  - strongest verified measures: `obligation` and `outlay`
  - lower-confidence documented path: `face_value_of_loan` is transport-valid but was not re-probed in this repair, so warn before treating it as equally validated

Optional fields:
- `geo_layer_filters`: list of shape codes to keep in the response
- `scope`: `recipient_location` or `place_of_performance`
  - live probe: omitting `scope` defaulted to `recipient_location`
- `filter.award_type_codes`
- profile-carried shared filter keys such as `filter.time_period`, `filter.recipient_scope`, and `filter.recipient_locations`
  - a 2026-05-15 live probe accepted those keys but returned the same 60-row nationwide `L` state rollup as the unbounded baseline, so **do not rely on them to create recent-only or recipient-bounded geography stories on this endpoint**

## DEFC translation: honest current state
If you start from this geography endpoint and need plain-language output, do **not** assume DEFC translation is currently available as a promoted semantic MCP step in the same surface.

For this repaired bundle, the honest guidance is:
- this endpoint safely supports the geography aggregation itself
- the reviewed promoted semantic surface did **not** expose a promoted semantic DEFC reference endpoint/tool
- `GET /api/v2/references/def_codes/` is therefore an **external/raw fallback**, not a same-surface promoted semantic step

## Fast path to decode DEFC labels
If you need plain-language output, do **not** guess what a DEFC code means or search unrelated endpoints first. The authoritative lookup remains `GET /api/v2/references/def_codes/`, but in the current promoted semantic surface you should treat it as an external/raw fallback.

Recommended sequence:
1. choose or inspect the `filter.def_codes` values you will use here
2. use `GET /api/v2/references/def_codes/` to translate each code into its public law, title, and disaster group
3. call `POST /api/v2/disaster/spending_by_geography/` and attach those translated labels to your map legend, headings, and narrative copy

Example: the staged DEFC reference documents `L` as `Emergency P.L. 116-123` / `Coronavirus Preparedness and Response Supplemental Appropriations Act, 2020` in the `covid_19` group.

## DEFC labels are a separate lookup
This endpoint filters by raw DEFC codes, but those codes are not self-describing in the request or response.

Before writing plain-language analysis:
- resolve each code through the external/raw fallback `GET /api/v2/references/def_codes/` or the published DEFC reference file
- treat the live templates below as **working request shapes**, not as complete business labels
- do not tell users that DEFC translation is already covered end-to-end by the promoted semantic MCP for this endpoint

In the staged DEFC reference, `L` is documented as:
- public law: `Emergency P.L. 116-123`
- title: `Coronavirus Preparedness and Response Supplemental Appropriations Act, 2020`
- disaster group: `covid_19`

## Live-validated request templates

### Minimal state obligation rollup
This template is live-validated, but remember that `"L"` is just the DEFC code. Translate it through the external/raw DEFC reference fallback before presenting a labeled story.

```json
{
  "filter": {
    "def_codes": ["L"]
  },
  "geo_layer": "state",
  "spending_type": "obligation"
}
```

Observed behavior:
- returned `200 OK`
- response echoed `scope: "recipient_location"`
- response included named state rows plus an uncoded aggregate row with `shape_code: null`
- row order was **not** sorted by `amount`; California appeared before larger Maryland, Virginia, District of Columbia, and Massachusetts totals in the live ordering evidence

### Filtered state outlays by place of performance
`geo_layer_filters` is the only geography-bounding control that this bundle reverified for this endpoint.

```json
{
  "filter": {
    "def_codes": ["L"]
  },
  "geo_layer": "state",
  "geo_layer_filters": ["CA", "TX"],
  "scope": "place_of_performance",
  "spending_type": "outlay"
}
```

Observed behavior:
- returned `200 OK`
- response echoed `scope: "place_of_performance"`
- response returned only California and Texas in the sampled probe

## How to interpret the response
The response is one object with:
- `geo_layer`
- `scope`
- `spending_type`
- `results`

Each `results` row is one geography aggregate with:
- `shape_code`
- `display_name`
- `amount`
- `population`
- `per_capita`
- `award_count`

Interpretation notes:
- `amount` changes meaning with `spending_type`.
- `amount` can be negative; the live state probe included a negative obligation total for New Jersey.
- `per_capita` is only meaningful where `population` is populated.
- `shape_code` and `display_name` can be `null` for an uncoded aggregate bucket when geography assignment is missing.
- Sort client-side by `amount`, `per_capita`, or `award_count` before building any top-geography ranking. Response order is not a ranking contract.
- The endpoint is **not paginated**; expect one full `results` array.

## Shared passthrough filters are not a safe bounding contract here
A 2026-05-15 live probe sent `filter.time_period` for April 2020 together with `filter.recipient_scope: "domestic"` and `filter.recipient_locations: [{"country":"USA","state":"CA"}]`.

Observed behavior:
- returned `200 OK`
- still returned a 60-row nationwide state rollup
- still included Maryland, Virginia, District of Columbia, Massachusetts, and other non-California rows
- leading amounts matched the unbounded `def_codes: ["L"]` baseline pattern, so those shared passthrough filters appeared ignored in this run

If you need a recent-only geography story or a same-state bounded disaster slice, use a different endpoint or revalidate those filters yourself before treating them as a contract.

## Concrete drilldown mapping to award search
When `geo_layer` is `state`, you can copy each **non-null** `results.shape_code` directly into a downstream award-search location filter while keeping the same `filter.def_codes`. The state code becomes the `state` value inside a location object such as `{"country":"USA","state":"MD"}`.

Use the downstream location field that matches the geography `scope` you used here:

### If this endpoint used recipient geography
If you omitted `scope` and got the live default `recipient_location`, or if you set `scope: "recipient_location"`, map returned state codes into `recipient_locations` and keep the same DEFC filter. For example, if the geography response highlights Maryland and Delaware:

```json
{
  "filter": {
    "def_codes": ["L"],
    "recipient_scope": "domestic",
    "recipient_locations": [
      {"country": "USA", "state": "MD"},
      {"country": "USA", "state": "DE"}
    ]
  }
}
```

### If this endpoint used place of performance geography
If you set `scope: "place_of_performance"`, map returned state codes into `place_of_performance_locations`. For example, if the geography response highlights California and Texas:

```json
{
  "filter": {
    "def_codes": ["L"],
    "place_of_performance_scope": "domestic",
    "place_of_performance_locations": [
      {"country": "USA", "state": "CA"},
      {"country": "USA", "state": "TX"}
    ]
  }
}
```

Add one of those filter blocks to your downstream award-search endpoint's validated request template, such as `POST /api/v2/search/spending_by_award/`, along with that endpoint's own required paging, sorting, and field-selection keys.

Do **not** copy the uncoded row (`shape_code: null`, `display_name: null`) into a state filter. That row represents spending that could not be assigned to a coded geography bucket, so it needs a broader or different follow-up query.

## Validation behavior to handle
Live probes confirmed two important DEFC validation behaviors:
- `filter.def_codes: []` returned **422** with a minimum-items error
- `filter.def_codes: ["l"]` returned **400** and listed the valid uppercase DEFC codes

So clients should handle both `400` and `422` for bad requests.

Semantic preflight should also warn, even for otherwise valid requests, when:
- `geo_layer: "county"` is used
- `geo_layer: "district"` is used
- `spending_type: "face_value_of_loan"` is used

Those three paths remain documented, but this bundle did not re-probe them live during the current repair, so callers should not treat them as equally verified with the state-level obligation/outlay path.

## Caveats
- The staged docs conflict internally: one schema block says the request is a string, but live probes confirm the endpoint expects an object body.
- DEFC codes in templates are opaque until you resolve them through the external/raw DEFC reference fallback.
- This repair has live confidence for **state** obligation/outlay behavior. `county`, `district`, and `face_value_of_loan` remain documented but not re-probed here.
- A 2026-05-15 probe accepted `filter.time_period`, `filter.recipient_scope`, and `filter.recipient_locations` but did not materially narrow results.
- Returned row order is not a ranking contract.
- Returned geography rows are aggregates, not award records.

## Practical workflow
1. Choose the DEFC set and translate its codes into human labels before writing narrative copy, using the external/raw DEFC reference fallback.
2. Pick the geography grain with `geo_layer`, with highest current confidence at `state`; if you choose `county` or `district`, carry that lower confidence forward in your analysis or UI warning text.
3. Pick the financial measure with `spending_type`; current live confidence is strongest for `obligation` and `outlay`, while `face_value_of_loan` remains documented-but-not-reverified and should be labeled accordingly.
4. Decide whether the geography should reflect the recipient or place of performance using `scope`.
5. Use `geo_layer_filters` to keep interactive map requests bounded.
6. Sort returned rows explicitly before publishing any top-geography ranking.
7. Use the returned `shape_code` values to drive mapping or to seed a second award-level query.
