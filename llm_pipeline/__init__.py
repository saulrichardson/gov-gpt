"""Light-weight runtime that sits *after* `auto_mcp.extractor_llm`.

This package provides three building blocks:

1. converter.load_function_specs(db_path)
   Read every row from the SectionStore and convert the stored YAML into
   a ChatGPT/MCP-style *function definition* plus a Python callable that
   will execute the real HTTP request.

2. executor.call_endpoint(row_yaml, base_url, **kwargs)
   Internal helper used by the generated callables to perform an HTTP
   request given the function arguments.

3. smoke_test (module with CLI)
   A minimal repeatable test that walks through all SectionStore rows,
   fills in dummy values for parameters and verifies that the endpoint is
   reachable (HTTP status < 500).

The code purposefully stays dependency-light; the only external modules
are `requests` (ubiquitous) and the optional `PyYAML` for richer YAML
parsing.
"""

from __future__ import annotations

__all__ = [
    "converter",
    "executor",
]
