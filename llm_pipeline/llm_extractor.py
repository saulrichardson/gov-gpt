"""LLM-powered documentation extractor (self-contained replacement for auto_mcp).

Given a Markdown or YAML file that describes a REST endpoint, call an
OpenAI model to distil the *machine-readable* bits and store them inside
the shared ``SectionStore`` database.

The extracted object roughly matches the schema produced by the original
`auto_mcp.extractor_llm` project so the rest of the pipeline (converter,
executor, smoke_test) continues to work unchanged.

Fields returned by the LLM prompt (all optional; empty values are fine):

    method           – GET | POST | …
    path             – "/api/v2/…"
    summary          – short human description
    path_params      – mapping name -> {type, description, required}
    query_params     – same structure as path_params
    request_body     – free-form JSON schema or description
    auth             – "none" | "apiKey" | …

Environment requirements
------------------------
• ``OPENAI_API_KEY`` must be set.
• ``openai`` python package installed.

If either condition is *not* satisfied we transparently fall back to the
lightweight heuristic extractor so that local development and CI remain
unblocked.
"""

from __future__ import annotations

import json
import os
import textwrap
from pathlib import Path
from typing import Dict


from .section_store import SectionStore


# ---------------------------------------------------------------------------
# Capability detection – decide at import time whether OpenAI is available.
# ---------------------------------------------------------------------------


_OPENAI_AVAILABLE = False
try:
    import openai  # type: ignore

    if os.getenv("OPENAI_API_KEY"):
        _OPENAI_AVAILABLE = True
except ModuleNotFoundError:  # pragma: no cover – gracefully handled
    _OPENAI_AVAILABLE = False

# Fallback heuristic extractor (imported lazily only when needed)
# ---------------------------------------------------------------------------
# Public API – drop-in replacement for auto_mcp.extractor_llm.run_extraction
# ---------------------------------------------------------------------------


def run_extraction(  # noqa: D401 – external entry point
    doc_path: Path,
    db_path: Path | str,
    *,
    model: str = "gpt-4o-mini",
    temperature: float = 0.0,
) -> None:
    """Parse *doc_path* via OpenAI and upsert the result into *db_path*.

    If the OpenAI client/key is unavailable, the function routes the call
    to ``llm_pipeline.simple_extractor.run_extraction`` instead so callers
    do not need to care about setup.
    """

    if not _OPENAI_AVAILABLE:
        raise EnvironmentError(
            "OpenAI client not available – ensure `openai` package is installed "
            "and OPENAI_API_KEY is set. Offline fallback has been removed."
        )

    text = doc_path.read_text(encoding="utf-8", errors="replace")

    system_prompt = """
    You are an assistant that extracts *structured* API metadata from
    documentation files.  Return ONLY valid JSON following *exactly* this
    schema; do NOT wrap it in markdown:

    {
      "method": "GET | POST | PUT | DELETE | PATCH | OPTIONS | HEAD",
      "path": "/api/v2/…",
      "summary": "Human one-line description",
      "path_params": {
        "id": {"type": "string", "description": "…", "required": true},
        "...": {"type": "…", "description": "…", "required": false}
      },
      "query_params": {"…": {"type": "string", "description": "…", "required": false}},
      "request_body": "Textual description or JSON schema",
      "auth": "none | apiKey | basic | oauth2"
    }
    """

    user_prompt = textwrap.dedent(
        f"""
        Extract metadata from the following API documentation file.  If a
        field is missing in the docs leave it empty/null.  Remember:
        output *ONLY* the JSON object, without markdown fences or extra
        keys.

        --- BEGIN DOC ---
        {text}
        --- END DOC ---
        """
    )

    client = openai.OpenAI()
    rsp = client.chat.completions.create(
        model=model,
        temperature=temperature,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    content = rsp.choices[0].message.content.strip()

    # Occasionally the model wraps the JSON in markdown; strip fences.
    if content.startswith("```"):
        content = content.strip("`\n")

    try:
        parsed: Dict[str, object] = json.loads(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"LLM returned invalid JSON for {doc_path}: {content}") from exc

    # Store pretty-printed for readability.
    content_str = json.dumps(parsed, indent=2, ensure_ascii=False)

    with SectionStore(db_path) as store:
        store.upsert(id=str(doc_path), content=content_str, meta={"source": "llm_extractor"})
