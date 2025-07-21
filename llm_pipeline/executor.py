"""Utility that actually performs the HTTP request for a stored spec."""

from __future__ import annotations

import json
import re
from typing import Any, Dict

try:
    import requests  # type: ignore

    _REQUESTS = True
except ModuleNotFoundError:  # pragma: no cover – optional dep
    _REQUESTS = False


_PATH_VAR_RE = re.compile(r"{([^}]+)}")


def _fill_path(path_tpl: str, vars: Dict[str, Any]):  # noqa: D401
    def _repl(match):
        key = match.group(1)
        if key not in vars:
            raise ValueError(f"missing path param: {key}")
        return str(vars[key])

    return _PATH_VAR_RE.sub(_repl, path_tpl)


def call_endpoint(
    spec: Dict[str, Any],
    *,
    base_url: str = "https://api.usaspending.gov",
    timeout: float = 10.0,
    **kwargs,
):  # noqa: D401,E501
    """Execute the HTTP request described by *spec*.

    kwargs are the arguments provided by the LLM (path/query/body, …).
    """

    method: str = spec.get("method", "GET").upper()
    path_tpl: str = spec.get("path", "/")

    # Determine path and query parameters.
    #
    # ``spec`` may omit the explicit *path_params* section even though the path
    # template contains ``{placeholders}``.  In that case the smoke-tests (and
    # any other caller providing dummy values) will pass those arguments via
    # *kwargs*, but we would previously ignore them because the key was not
    # present in *path_params*.  This in turn made :pyfunc:`_fill_path` raise
    # ``ValueError("missing path param: …")``.
    #
    # To be more forgiving – and to match the behaviour one would intuitively
    # expect – we treat every placeholder that appears in *path_tpl* as a path
    # parameter, whether or not it is explicitly declared.

    tpl_placeholders = set(_PATH_VAR_RE.findall(path_tpl))
    declared_params = set((spec.get("path_params") or {}).keys())

    path_params = declared_params | tpl_placeholders

    query_params = set((spec.get("query_params") or {}).keys())

    path_values = {k: kwargs.pop(k) for k in list(kwargs.keys()) if k in path_params}
    query_values = {k: kwargs.pop(k) for k in list(kwargs.keys()) if k in query_params}

    body = kwargs.get("body")

    url = f"{base_url.rstrip('/')}{_fill_path(path_tpl, path_values)}"

    headers: Dict[str, str] = {}

    # Very naive auth handling – extend as needed.
    auth_type = spec.get("auth", "none")
    if auth_type == "apiKey" and (token := kwargs.get("api_key")):
        headers["Authorization"] = token

    if not _REQUESTS:
        raise RuntimeError("`requests` package not available – executor cannot run.")

    rsp = requests.request(
        method,
        url,
        params=query_values,
        json=body,
        headers=headers,
        timeout=timeout,
    )

    return {
        "status_code": rsp.status_code,
        "headers": dict(rsp.headers),
        "body": _safe_body(rsp),
    }


def _safe_body(rsp):  # noqa: D401
    ct = rsp.headers.get("content-type", "")
    if "application/json" in ct.lower():
        try:
            return rsp.json()
        except Exception:  # pragma: no cover – lenient
            return rsp.text[:1000]
    return rsp.text[:1000]
