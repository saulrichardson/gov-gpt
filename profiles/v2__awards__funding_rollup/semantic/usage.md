# Award Funding Rollup (`v2__awards__funding_rollup`)

## When to use this endpoint
Use this endpoint when you already know one award identifier and want a **quick funding footprint summary** for that award:
- total transaction obligated amount
- count of distinct awarding agencies
- count of distinct funding agencies
- count of distinct federal accounts

For compact dashboards, treat this endpoint as a **revealed File C funding/accounting evidence tile**, not as a headline award-total tile.

Live availability was confirmed on 2026-05-12 with a successful `POST /api/v2/awards/funding_rollup/` call.

## When not to use it
- Do **not** use it for row-level funding detail by reporting period, agency, account, object class, or program activity.
- Do **not** use it to search across many awards; the request is scoped to one `award_id`.
- Do **not** expect pagination or sorting behavior. The docs sample body shows `page`, `sort`, `order`, and `limit`, but source and retired-profile evidence indicate those fields are ignored.
- Do **not** treat an all-zero response as proof that the award identifier is valid. Current-profile evidence indicates unknown award ids can still return `200` with zeros.
- Do **not** present `total_transaction_obligated_amount` as if it were the same measure as search `Award Amount`, award-detail `total_obligation`, or a guaranteed match to award-detail `total_account_obligation`.

## Request shape
**Method:** `POST`  
**Path:** `/api/v2/awards/funding_rollup/`  
**Content-Type:** `application/json`

### Required body field
- `award_id` — required. Source code accepts either:
  - a generated award id string such as `CONT_AWD_...`
  - an integer internal award id

In normal workflows, the generated award id string is the safer/common choice.

### Legacy doc-only fields to avoid
The staged docs sample body also shows:
- `page`
- `sort`
- `order`
- `limit`

Keep them in mind only as a **documented contradiction**. Source and retired-profile evidence indicate the implementation reads only `award_id`, and the endpoint always returns a single aggregate object.

### Primary safe request template
```json
{
  "award_id": "CONT_AWD_DEAC5206NA25396_8900_-NONE-_-NONE-"
}
```

## Response shape
The response is a single JSON object with four top-level fields:
- `total_transaction_obligated_amount`
- `awarding_agency_count`
- `funding_agency_count`
- `federal_account_count`

Observed live example:
```json
{
  "total_transaction_obligated_amount": 2729344672.23,
  "awarding_agency_count": 1,
  "funding_agency_count": 1,
  "federal_account_count": 17
}
```

## How to interpret the fields
- `total_transaction_obligated_amount` is an aggregate sum across revealed `financial_accounts_by_awards` records linked to the award.
- Treat that monetary field as a **revealed funding/accounting measure** that can reconcile differently across awards.
- `awarding_agency_count` is a distinct count of awarding top-tier agencies, not a row count.
- `funding_agency_count` is a distinct count of funding top-tier agencies, not a row count.
- `federal_account_count` is a distinct count of federal-account combinations, not a transaction count.

Treat the three count fields as **breadth indicators** for the award's funding footprint.

## Compact dashboard comparison guidance
If you place this rollup beside search or award detail in a dashboard, label it as **revealed funding/accounting evidence**.

Use a **multi-measure reconciliation check**, not a single default comparison target:
1. Compare `funding_rollup.total_transaction_obligated_amount` against the relevant award-detail totals for the same award.
2. Include `total_account_obligation` in that check, but do **not** assume it is the primary expected match for every award.
3. Also check outlay-style measures such as `total_account_outlay` or `total_outlay` when those are available.
4. Use headline `total_obligation` only when you are explicitly explaining why the funding rollup and award headline tell different stories.
5. If you need the reason for a difference, continue to the detailed award funding endpoint.

Reviewer-backed examples show different reconciliation patterns:

| Award | Award detail totals | Funding rollup | What it means |
|---|---|---|---|
| `HT940216C0001` | `total_obligation = 51269205263.03`; `total_account_obligation = 321840` | `total_transaction_obligated_amount = 321840` | This rollup aligned with `total_account_obligation`, not the headline obligation. |
| `DEAC3243AL00036` | `total_account_obligation = 331046047`; `total_account_outlay/total_outlay = 576372104.83` | `total_transaction_obligated_amount = 576368263` | This rollup diverged materially from `total_account_obligation` and aligned much more closely with an outlay-style measure. |

So the rollup is best understood as a compact revealed funding/accounting slice whose cleanest reconciliation path can vary by award.

## Practical workflow
1. Obtain a valid `award_id` for the award you care about.
2. Send a minimal JSON body with only `award_id`.
3. Read the rollup as a one-row summary of revealed funding breadth for that award.
4. If you compare it to award detail, test multiple reconciliation paths instead of checking only `total_account_obligation` first.
5. If you need the underlying explanation, continue with the detailed award funding endpoint rather than expecting this route to page or sort.

## Caveats
- The docs sample body is misleading about `page`, `sort`, `order`, and `limit`; treat them as ignored legacy fields for this route.
- Unknown or bad award ids may return `200` with all zeros instead of an error.
- The total can be negative for some awards.
- The aggregation is based on revealed File C funding records, so it should be interpreted as funding-data rollup evidence rather than a generic award metadata summary.
- Different awards can reconcile along different paths. Some align with `total_account_obligation`; others align more closely with outlay-style measures.
