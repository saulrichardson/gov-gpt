"""CLI helper that pings every endpoint stored in SectionStore.

Usage::

    python -m llm_pipeline.smoke_test <db_path> <base_url> [limit]

If *limit* is provided only the first *N* endpoints are tested.
"""

# Smoke-test helper that pings every endpoint stored in ``SectionStore`` and
# records the result in a timestamped log file (``./logs/smoke_test_<ts>.log``
# by default).

from __future__ import annotations

import sys
import time
from pathlib import Path

# Centralised output directory helper
from llm_pipeline.config import get_output_root  # type: ignore

from section_store import SectionStore

# When the package is executed as a script (``python smoke_test.py``) the
# relative import ``from .executor`` does not work because the module is not
# part of a package.  We therefore use an absolute import that succeeds in
# both contexts: standalone file execution *and* ``python -m llm_pipeline``.

try:
    from executor import call_endpoint  # type: ignore
except ModuleNotFoundError:  # pragma: no cover – package context
    from llm_pipeline.executor import call_endpoint  # type: ignore

import datetime


def _main(argv):  # noqa: D401 – simple CLI
    if len(argv) < 2:
        print(
            "Usage: python -m llm_pipeline.smoke_test <db_path> [base_url] [limit]\n"
            "Default base_url: https://api.usaspending.gov",
            file=sys.stderr,
        )
        raise SystemExit(1)

    db_path = Path(argv[1])
    base_url = argv[2] if len(argv) > 2 else "https://api.usaspending.gov"
    limit = int(argv[3]) if len(argv) > 3 else None

    store = SectionStore(db_path)

    # ------------------------------------------------------------------
    # Logging setup
    # ------------------------------------------------------------------

    log_path = _create_log_file()
    with log_path.open("w", encoding="utf-8") as _log_fp:

        def _log(msg: str) -> None:  # noqa: D401 – local helper
            print(msg)
            print(msg, file=_log_fp, flush=True)

        tested = 0
        ok = bad = 0

        t0 = time.time()

        for row_id in store.list_ids():
            if limit and tested >= limit:
                break

            row = store.get(row_id)
            spec_yaml = row["content"]

            try:
                import yaml  # type: ignore

                spec = yaml.safe_load(spec_yaml) or {}
            except Exception:
                _log(f"{row_id}: YAML parse error – skipped")
                bad += 1
                continue

            # Build dummy args – gather placeholders from path template and
            # explicitly declared *path_params* section so we supply every
            # required argument.

            import re

            path_tpl = spec.get("path", "/")
            tpl_placeholders = set(re.findall(r"{([^}]+)}", path_tpl))
            declared_params = set((spec.get("path_params") or {}).keys())

            dummy_args = {name: f"test_{name}" for name in tpl_placeholders | declared_params}

            try:
                rsp = call_endpoint(spec, base_url=base_url, **dummy_args)
                status = rsp["status_code"]
                if status < 500:
                    _log(f"{row_id}: OK {status}")
                    ok += 1
                else:
                    _log(f"{row_id}: FAIL {status}")
                    bad += 1
            except Exception as exc:
                _log(f"{row_id}: EXC {exc}")
                bad += 1

            tested += 1

        elapsed = time.time() - t0
        _log(f"Tested {tested} endpoints – {ok} ok, {bad} bad in {elapsed:.1f}s")


def _create_log_file() -> Path:  # noqa: D401
    """Return a (created) path ``logs/smoke_test_<timestamp>.log``."""

    out_dir = get_output_root()
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / "smoke_test.log"


if __name__ == "__main__":  # pragma: no cover
    _main(sys.argv)
