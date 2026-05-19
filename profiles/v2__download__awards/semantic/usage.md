# Award Download

Use `v2__download__awards` when the caller needs a generated ZIP export. The response is a download job descriptor, not award rows.

## Bounded export starter that also round-trips into preview

Use this small contract-oriented starter when you want one request shape that can be previewed on `v2__search__spending_by_award` and then exported with a common dashboard field set:

```json
{
  "filters": {
    "keywords": ["forest"],
    "award_type_codes": ["A", "B", "C", "D"]
  },
  "limit": 1,
  "file_format": "csv",
  "columns": [
    "award_id_piid",
    "recipient_name",
    "total_obligated_amount",
    "awarding_agency_name"
  ]
}
```

Keyword-only requests are still valid on `v2__download__awards`, but they do **not** preview unchanged on `v2__search__spending_by_award`. Reviewer-backed validation on the paired preview workflow failed until `filters.award_type_codes` was added.

A paired preview request for the same contract-oriented scope is:

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

Successful download responses include:

- `status_url`: URL for polling job status.
- `file_name`: ZIP filename and status lookup key.
- `file_url`: eventual generated file URL.
- `download_request`: normalized backend request, including injected defaults.

Treat `download_request` as the effective request. A live probe on `2026-05-09` showed that omitted `award_type_codes` were injected into `download_request.filters`, including `F001` through `F010` in addition to procurement, assistance, IDV, and `-1` values.

## Preview-to-download continuity caveat

Use `v2__search__spending_by_award` to preview the same filtered population before exporting, but keep the continuity boundary explicit:

- Continuity is at the **filter-population** level only.
- Preview `fields` are display labels like `Award ID`, `Recipient Name`, `Award Amount`, and `Awarding Agency`; they are **not** download column IDs.
- Preview controls such as `sort`, `order`, `page`, and preview `limit` do **not** define the export row order or export schema.
- If you begin with a keyword-led export idea, add `award_type_codes` before previewing the same scope on `spending_by_award`.
- If a pipeline needs to compare preview output with the export, choose explicit identifier columns on purpose rather than assuming the first preview row or preview label schema carries forward.

## Curated preview-to-export crosswalk

A bounded live archive inspection on `2026-05-14` verified the common contract-oriented dashboard field set on the emitted prime-award CSV member. The header row matched the requested column IDs exactly: `award_id_piid,recipient_name,total_obligated_amount,awarding_agency_name`.

The semantic bundle now exposes the same starter schema in machine-readable request metadata through the `columns[]` fact. Treat those four IDs as the bundle's verified-safe starter set for bounded dashboard exports; other column IDs may still be valid API inputs, but they remain unresolved in this bundle until another bounded export or source-backed review verifies them.

| Preview label in `spending_by_award` | Download column ID | Current evidence status | Meaning for pipeline consumers |
| --- | --- | --- | --- |
| `Award ID` | `award_id_piid` | Live-verified bounded prime CSV header; reviewer-confirmed earlier; source-backed column mapping | PIID-style contract award identifier. Good contract-oriented join key, but not universal across mixed award types. |
| `Recipient Name` | `recipient_name` | Live-verified bounded prime CSV header; reviewer-confirmed earlier; source-backed column mapping | Recipient legal/business name on the exported award row. |
| `Award Amount` | `total_obligated_amount` | Live-verified bounded prime CSV header; source-backed semantic mapping | Closest export column to the preview's award amount measure; both preview and award-download mappings trace this field family to `total_obligation`. |
| `Awarding Agency` | `awarding_agency_name` | Live-verified bounded prime CSV header; source-backed semantic mapping | Closest export column to the preview's awarding agency display name. |

Important identifier caveat: source-defined award download mappings also expose `award_id_fain` and `award_id_uri`, so do not assume `award_id_piid` is the only identifier column for mixed award-type exports.

## Starter ZIP artifact contract

For the bounded dashboard starter request above, the first post-download parser step is explicit in machine-readable response facts:

- `file_url.archive_members[]`: observed manifest for the reviewed starter ZIP, including `Contracts_PrimeAwardSummaries_2026-05-14_H03M12S48_1.csv` and `Contracts_Subawards_2026-05-14_H03M12S51.csv`
- `file_url.prime_award_summary_member`: prime summary member to parse first, `Contracts_PrimeAwardSummaries_2026-05-14_H03M12S48_1.csv`
- `file_url.subaward_member`: companion member that can also be present, `Contracts_Subawards_2026-05-14_H03M12S51.csv`
- `file_url.prime_award_summary_header[]`: verified prime header quartet `award_id_piid,recipient_name,total_obligated_amount,awarding_agency_name`

Use those facts to choose the first parser and header validation rule for the starter export without inspecting every ZIP member ad hoc.

Poll `v2__download__status` or the returned `status_url` until the job is terminal. In the live four-column export:

- nonterminal status responses stayed `running`
- `total_rows` and `total_columns` remained provisional until completion
- `file_url` returned `403` while the job was still nonterminal
- once status became `finished`, raw retrieval of `file_url` returned a ZIP with archive members `Contracts_PrimeAwardSummaries_...csv` and `Contracts_Subawards_...csv`

For the common dashboard field set above, inspect the prime-summary CSV member first and bind the parser to the emitted header names, not to preview labels. The finished starter ZIP also contained a companion `Contracts_Subawards_...csv` member, which should be treated as a separate subaward-grain artifact. The verified prime-summary header line was:

```text
award_id_piid,recipient_name,total_obligated_amount,awarding_agency_name
```

Validation behavior observed on `2026-05-09` and `2026-05-14`:

- `filters` must contain at least one key; `{ "filters": {} }` returns 400.
- `file_format` accepts `csv`, `tsv`, and `pstxt`; `xlsx` returns 400.
- A small `limit` is accepted and echoed.

This is still not a full export catalog. Use the verified `columns[]` starter set for bounded dashboard exports. If a pipeline needs additional preview fields or export columns beyond `Award ID`, `Recipient Name`, `Award Amount`, and `Awarding Agency`, treat those mappings as unresolved until they are verified by another bounded export or a source-backed column review.

For workflows, preview with `v2__search__spending_by_award` when the user needs immediate JSON rows. Use this endpoint when the next step is an export job, then poll `v2__download__status` or the returned `status_url` with `file_name`.
