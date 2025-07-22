"""Convert SectionStore rows into ChatGPT/MCP function definitions.

The *sole* responsibility of this module is to map the YAML blobs produced
by the LLM extractor into:

1. a JSON *function schema* suitable for ``functions=[…]`` in the
   ChatCompletion API,
2. a **callable** that performs the actual HTTP request when the LLM
   invokes the function.

The mapping rules are intentionally minimal – they only rely on the
fields documented in extractor_llm/README.md.
"""

from __future__ import annotations

import json
import re
import types
from pathlib import Path
from typing import Any, Dict, List, Tuple

try:
    import yaml  # type: ignore

    _YAML_AVAILABLE = True
except ModuleNotFoundError:  # pragma: no cover – optional dep
    _YAML_AVAILABLE = False


from section_store import SectionStore


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


_NAME_CLEAN_RE = re.compile(r"[^a-zA-Z0-9_]+")


def _safe_name(s: str) -> str:  # noqa: D401
    """Turn arbitrary identifier into a valid Python-ish snake_case name."""

    s = s.lower().replace("/", "_").replace("{", "").replace("}", "")
    s = _NAME_CLEAN_RE.sub("_", s)
    return re.sub(r"_+", "_", s).strip("_")


def _parse_yaml(text: str) -> Dict[str, Any]:  # noqa: D401
    if _YAML_AVAILABLE:
        return yaml.safe_load(text) or {}

    # Naïve fallback – assume the blob is JSON-compatible YAML.
    return json.loads(text)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_function_specs(
    db_path: str | Path = "sections.db", *, base_url: str = "https://api.usaspending.gov"
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Return *(function_schema_list, callable_map)* ready for ChatGPT.

    Each callable is stored in a dict keyed by **function.name** so an
    orchestrator can do `callable_map[fn_name](**args)` when the model
    emits a tool call.
    """

    store = SectionStore(db_path)
    fn_schemas: List[Dict[str, Any]] = []
    callables: Dict[str, Any] = {}

    for row_id in store.list_ids():
        row = store.get(row_id)
        if not row:
            continue

        spec = _parse_yaml(row["content"])

        method: str = spec.get("method", "GET").upper()
        path: str = spec.get("path", "/")
        summary: str = spec.get("summary", "")

        name = _safe_name(f"{method}_{path}")

        # Build parameter JSON schema (path + query only for now)
        properties: Dict[str, Any] = {}
        required: List[str] = []

        for param_set_key in ("path_params", "query_params"):
            for pname, pdata in (spec.get(param_set_key) or {}).items():
                properties[pname] = {
                    "type": pdata.get("type", "string"),
                    "description": pdata.get("description", ""),
                }
                if pdata.get("required"):
                    required.append(pname)

        if spec.get("request_body"):
            properties["body"] = {
                "type": "object",
                "description": "HTTP request body (JSON)",
            }

        param_schema: Dict[str, Any] = {
            "type": "object",
            "properties": properties,
            "required": required,
        }

        fn_schema = {
            "type": "function",
            "function": {
                "name": name,
                "description": summary or f"Call {method} {path}",
                "parameters": param_schema,
            },
        }

        fn_schemas.append(fn_schema)

        # Build the actual Python callable using a closure.
        def _make_callable(m: str, p: str, spec: Dict[str, Any]):  # noqa: D401
            def _call(**kwargs):  # type: ignore[override]
                from .executor import call_endpoint  # local import to avoid cycle

                return call_endpoint(spec, base_url=base_url, **kwargs)

            _call.__name__ = _safe_name(f"exec_{m}_{p}")
            _call.__qualname__ = _call.__name__
            return _call

        callables[name] = _make_callable(method, path, spec)

    return fn_schemas, callables
