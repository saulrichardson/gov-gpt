"""LLM-powered documentation extractor.

Given a Markdown or YAML file that describes a REST endpoint, the extractor
invokes an OpenAI model to distil the *machine-readable* parts and stores
them inside the shared ``SectionStore`` database.  Its JSON output matches
the schema expected by the rest of the pipeline (converter, executor,
smoke_test) so it can be used drop-in without additional glue code.

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

The extractor **fails fast** if either requirement is missing – no offline
fallback – so callers immediately know that online access is required.
"""

#
# Enhanced version with Pydantic validation and automatic retries when the
# model returns invalid JSON.  Requires *online* OpenAI access; no offline
# fallback.

from __future__ import annotations

import json
import os
import textwrap
from pathlib import Path

from tenacity import retry, stop_after_attempt, wait_fixed
from pydantic import ValidationError

from .section_store import SectionStore
from .models import ExtractedSpec

# ---------------------------------------------------------------------------
# Ensure OpenAI client & key are present at import time
# ---------------------------------------------------------------------------


try:
    import openai  # type: ignore
except ModuleNotFoundError as exc:  # pragma: no cover – fail fast
    raise EnvironmentError("`openai` package is required but missing. Install it via `pip install openai`."
    ) from exc

if not os.getenv("OPENAI_API_KEY"):
    raise EnvironmentError("OPENAI_API_KEY environment variable not set – online extraction cannot run.")
# Public API – run_extraction()
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



    text = doc_path.read_text(encoding="utf-8", errors="replace")

    system_prompt = """
    You are an assistant that converts human-written REST documentation
    into a MAXIMALLY-RICH machine-readable JSON object.  Follow *exactly*
    the JSON schema below and output ONLY the JSON (no markdown fences).

    IMPORTANT:
    • Keys must appear in the exact *snake_case* shown below – do not
      change casing or invent new keys.
    • Allowed values:
        – auth            : none | apiKey | basic | oauth2
        – pagination.style: link | offset | cursor | none
        – param.type      : string | integer | number | boolean | enum

    ─── Desired JSON shape ───
    {
      "method": "GET | POST | PUT | DELETE | PATCH | OPTIONS | HEAD",
      "path": "/api/v…",                        // full path template
      "summary": "One-line human summary",        // shorter than 120 chars
      "description": "Longer human description",
      "auth": "none | apiKey | basic | oauth2",

      "path_params": {
        "name": {
          "type": "string | integer | number | boolean | enum",
          "description": "…",
          "required": true,
          "enum": ["A", "B"]            // include only if applicable
        },
        "…": { … }
      },

      "query_params": {  // same structure as path_params
        "…": { … }
      },

      "request_body": {
        "json_schema": { … },            // full JSON-Schema Draft-07 if present
        "example": { … }                // representative example body
      },

      "response": {
        "json_schema": { … },
        "examples": [ { … } ]
      },

      "pagination": {
        "style": "link | offset | cursor | none",
        "param_names": ["page", "limit"]
      },

      "errors": [
        { "code": 400, "meaning": "Bad Request" },
        { "code": 404, "meaning": "Not Found" }
      ]
    }

    RULES:
    • If the docs do not mention a field, include the key and set its
      value to null or an empty object/array as appropriate.
    • Do NOT add extra keys.
    • Output MUST be valid JSON – no comments.
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

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1))
    def _call_llm() -> ExtractedSpec:  # noqa: D401 – inner helper
        rsp = client.chat.completions.create(
            model=model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )

        content = rsp.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.strip("`\n")

        try:
            data = json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON: {exc}\nRAW:\n{content}") from exc

        try:
            return ExtractedSpec.model_validate(data)
        except ValidationError as exc:
            raise ValueError(f"Schema validation failed: {exc}\nRAW:\n{content}") from exc

    # ``@retry`` wraps *all* failures into :class:`tenacity.RetryError` once the
    # maximum number of attempts is exhausted.  That container is hard to read
    # and, more importantly, makes it cumbersome for callers (and tests) to
    # branch on the *actual* root-cause exception type.  To keep the public
    # behaviour intuitive we unwrap the error and re-raise the original
    # exception instead.

    from tenacity import RetryError  # local import to avoid polluting exports

    try:
        spec = _call_llm()
    except RetryError as exc:  # pragma: no cover – network dependent
        underlying = exc.last_attempt.exception() if exc.last_attempt else None
        raise underlying or exc  # fall back to wrapper if nothing captured

    with SectionStore(db_path) as store:
        store.upsert(
            id=str(doc_path),
            # pydantic v2's `model_dump_json` no longer supports the
            # `ensure_ascii` keyword, so we simply omit it. The default
            # behaviour already avoids escaping non-ASCII characters.
            content=spec.model_dump_json(indent=2),
            meta={"source": "llm_extractor"},
        )
