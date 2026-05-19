# Award Detail (`v2__awards__award_id`)

## When to use this endpoint
Use this endpoint when you already know a specific USAspending award identifier and need the award-profile payload for that one award: identifiers, recipient and agency context, award-level financial summary fields, and category-specific contract/IDV or assistance details.

In cross-endpoint workflows, normalize the handoff identifier as `canonical_award_lookup_id`:
- `v2__search__spending_by_award` exposes it as `generated_internal_id`
- this endpoint accepts it as path field `award_id`
- this endpoint returns the same business key as `generated_unique_award_id`
- `v2__awards__funding` expects the same value under request body field `award_id`

Use this endpoint when a contract outlier screen needs one-award procurement interpretation that search rows do not carry. The most decision-useful procurement fields live inside `latest_transaction_contract_data`, and this bundle now maps the exact response paths you need for competition, solicitation, pricing, multi-year, interagency-authority, PSC, and NAICS review.

Live availability was confirmed on 2026-05-11 with a successful `GET /api/v2/awards/CONT_AWD_H907_9700_SPE2DX16D1500_9700/` call.

## When not to use it
- Do not use it to search across awards; it returns one award object for one path identifier.
- Do not use it as a transaction listing or award-funding history endpoint.
- Do not treat the display `Award ID` label from search results as the canonical follow-up identifier when a generated helper id is available; carry `canonical_award_lookup_id` instead.

## Request shape
**Method:** `GET`
**Path:** `/api/v2/awards/{award_id}/`

### Path field
- `award_id` — required. Docs say it accepts a generated award hash or an internal database id.
- In semantic workflows, treat this path field as the carrier for `canonical_award_lookup_id`.
- If you are chaining from `v2__search__spending_by_award`, take `generated_internal_id` and pass it here unchanged.
- Source code distinguishes digit-only values from string award ids and retries a legacy generated-award-id lookup when the string lookup misses.
- Current-profile evidence indicates the canonical route includes a trailing slash and preserves case.

### Request templates
Generated-id example:
```http
GET /api/v2/awards/CONT_AWD_H907_9700_SPE2DX16D1500_9700/ HTTP/1.1
Host: api.usaspending.gov
```

Numeric-id example:
```http
GET /api/v2/awards/306293964/ HTTP/1.1
Host: api.usaspending.gov
```

## Response shape
The response is one JSON object for the requested award.

Common fields observed/documented on the live contract sample include:
- `id`, `generated_unique_award_id`, `category`, `type`, `type_description`, `description`
- `total_obligation`, `subaward_count`, `total_subaward_amount`
- `awarding_agency`, `funding_agency`, `recipient`
- `period_of_performance`, `place_of_performance`, `executive_details`
- `total_account_outlay`, `total_account_obligation`, `account_outlays_by_defc`, `account_obligations_by_defc`
- `total_outlay` (returned as `null` in the live contract sample; docs describe it inconsistently)

Treat `generated_unique_award_id` as this endpoint's response label for `canonical_award_lookup_id`. If you continue to `v2__awards__funding`, send that same string unchanged under the funding request body field `award_id`.

Category-specific sections:
- **Contracts / IDVs:** `piid`, `latest_transaction_contract_data`, `parent_award`, `naics_hierarchy`, `psc_hierarchy`
- **Assistance / loans / direct payments / grants:** `record_type`, `fain`, `uri`, `cfda_info`, `funding_opportunity`, and category-specific funding or loan totals

## Structured procurement response facts for contracts and IDVs
When `category` is procurement-oriented, read these named paths instead of treating `latest_transaction_contract_data` as opaque nested JSON:

| Fact family | JSON path(s) | How to use it |
|---|---|---|
| Competition extent | `latest_transaction_contract_data.extent_competed`, `latest_transaction_contract_data.extent_competed_description` | Use the code for exact logic and the description for labels such as `FULL AND OPEN COMPETITION`. |
| Offer count | `latest_transaction_contract_data.number_of_offers_received` | Count-like field for how many offers were received on the latest transaction. Treat small literal-looking values such as `1` as informative when they align with the other competition labels, but do not assume values such as `999` are literal counts; some observed edge values appear coded or unresolved. |
| Solicitation procedure | `latest_transaction_contract_data.solicitation_procedures`, `latest_transaction_contract_data.solicitation_procedures_description` | Distinguish negotiated or other solicitation approaches without raw schema archaeology. |
| Pricing type | `latest_transaction_contract_data.type_of_contract_pricing`, `latest_transaction_contract_data.type_of_contract_pricing_description` | Separate fixed-price, cost-type, and other pricing structures when comparing large awards. |
| Multi-year flag | `latest_transaction_contract_data.multi_year_contract`, `latest_transaction_contract_data.multi_year_contract_description` | Identify long-horizon procurements that may look like outliers because they span multiple years. |
| Interagency authority | `latest_transaction_contract_data.interagency_contracting_authority`, `latest_transaction_contract_data.interagency_contracting_authority_description` | Surface authorities such as Economy Act arrangements on the latest transaction. |
| PSC context | `latest_transaction_contract_data.product_or_service_code`, `psc_hierarchy.base_code.description` | Keep the PSC code and pair it with the hierarchy description for readable dashboard labels. |
| NAICS context | `latest_transaction_contract_data.naics`, `naics_hierarchy.base_code.description` | Keep the NAICS code and pair it with the hierarchy description for readable industry context. |

## Example procurement interpretations
Reviewer-backed award-detail evidence showed these exact paths are useful in real outlier drilldowns:

### Humana `CONT_AWD_HT940216C0001_9700_-NONE-_-NONE-`
- `latest_transaction_contract_data.solicitation_procedures = NP`
- `latest_transaction_contract_data.solicitation_procedures_description = NEGOTIATED PROPOSAL/QUOTE`
- `latest_transaction_contract_data.number_of_offers_received = 4`
- `latest_transaction_contract_data.extent_competed = A`
- `latest_transaction_contract_data.extent_competed_description = FULL AND OPEN COMPETITION`
- `latest_transaction_contract_data.type_of_contract_pricing = U`
- `latest_transaction_contract_data.type_of_contract_pricing_description = COST PLUS FIXED FEE`
- `latest_transaction_contract_data.multi_year_contract = N`
- `latest_transaction_contract_data.interagency_contracting_authority = X`
- `latest_transaction_contract_data.interagency_contracting_authority_description = NOT APPLICABLE`
- `latest_transaction_contract_data.product_or_service_code = Q201`
- `latest_transaction_contract_data.naics = 524114`

### Sandia `CONT_AWD_DENA0003525_8900_-NONE-_-NONE-`
- `latest_transaction_contract_data.extent_competed = A`
- `latest_transaction_contract_data.extent_competed_description = FULL AND OPEN COMPETITION`
- `latest_transaction_contract_data.number_of_offers_received = 4`
- `latest_transaction_contract_data.type_of_contract_pricing = U`
- `latest_transaction_contract_data.type_of_contract_pricing_description = COST PLUS FIXED FEE`
- `latest_transaction_contract_data.multi_year_contract = Y`
- `latest_transaction_contract_data.multi_year_contract_description = YES`
- `latest_transaction_contract_data.interagency_contracting_authority = A`
- `latest_transaction_contract_data.interagency_contracting_authority_description = ECONOMY ACT`
- `latest_transaction_contract_data.product_or_service_code = M1JZ`
- `latest_transaction_contract_data.naics = 561210`

## Offer-count edge-value guidance
Use `latest_transaction_contract_data.number_of_offers_received` as a competition clue, not as a universally self-decoding measure.

- If the field returns a small literal-looking value such as `1` and it agrees with the other competition labels, you can use it as direct evidence of a thin-offer or sole-source posture. Reviewer-backed AI award detail for `CONT_AWD_W911QX25C0002_9700_-NONE-_-NONE-` paired `number_of_offers_received = 1` with `NOT COMPETED` and `ONLY ONE SOURCE`.
- If the field returns a sentinel-like value such as `999`, do **not** narrate that as a literal `999 offers` finding. Reviewer-backed AI award detail for `CONT_AWD_W911QX20C0023_9700_-NONE-_-NONE-` paired `number_of_offers_received = 999` with `FULL AND OPEN COMPETITION` and `BASIC RESEARCH`, but no companion decoding label for the offers field.
- When the offers count looks coded or unresolved, lean on `extent_competed_description`, `solicitation_procedures_description`, pricing, and other procurement context before telling a competition story.

## How to interpret it
Treat the payload as an award-detail summary object, not as a rowset. The endpoint combines one award's identifying information with nested business context.

Check `category` first:
- procurement branches add contract-detail, classification, and parent-award sections
- assistance branches add CFDA and funding-opportunity sections and may include assistance- or loan-specific financial totals

For procurement awards, the fields above come from `latest_transaction_contract_data`. That means they reflect the latest transaction's contract metadata, not necessarily a lifetime-invariant summary for the award. Read `number_of_offers_received` as count-like competition metadata, but do not assume every returned value is a literal count.

`total_account_outlay` and `total_account_obligation` come from DEFC/account rows. `total_outlay` is a separate award-level outlay measure and should not be assumed equivalent.

Prefer description fields for display labels when available. Keep the coded values too if you need exact matching, filters, or downstream joins.

## Practical workflow
1. Obtain `canonical_award_lookup_id`. If you are chaining from `v2__search__spending_by_award`, prefer `generated_internal_id` over the display `Award ID`.
2. Call `GET /api/v2/awards/{award_id}/` with `canonical_award_lookup_id` in the path and keep the trailing slash.
3. Inspect `category` before reading nested fields.
4. If `category` is contract or IDV, read the structured procurement paths above before deciding whether you need funding drilldown.
5. When you need other award-specific drilldowns, reuse `generated_unique_award_id` as the same `canonical_award_lookup_id` even if the downstream request field is also named `award_id`.

## Caveats
- Related award endpoints relabel the same generated award business key; keeping the semantic alias `canonical_award_lookup_id` prevents avoidable handoff mistakes.
- The procurement facts listed above are procurement-only; assistance responses will not populate them.
- Because those facts come from `latest_transaction_contract_data`, they describe the latest transaction on the award rather than every historical transaction.
- `latest_transaction_contract_data.number_of_offers_received` can mix literal-looking counts with unresolved coded values such as `999`; treat edge values as ambiguous unless other competition labels or outside documentation decode them.
- This repair covers the dashboard-relevant procurement facts, but `latest_transaction_contract_data` still contains additional contract-detail members that are not individually mapped here.
- The docs are inconsistent about `funding_opportunity` naming; the structure section misspells it as `funding_opportunty`.
- The docs are also inconsistent about `total_outlay` across award families, but the live contract response included the field.
- Current-profile evidence indicates some invalid string paths can return HTML 404 pages instead of JSON errors.
