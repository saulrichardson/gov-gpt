"""CLI to run `auto_mcp.extractor_llm` over an entire documentation tree.

Example
-------
    python -m llm_pipeline.batch_extract sections.db usaspending-api/api_docs

The script walks the *root_dir* recursively and feeds every ``*.md``,
``*.yaml`` and ``*.yml`` file to the LLM extractor, accumulating the
results into the shared SQLite DB (default ``sections.db``).

Environment
-----------
Requires ``OPENAI_API_KEY`` to be set and the ``openai`` package to be
installed – those requirements are identical to running
``python -m auto_mcp.extractor_llm`` directly.
"""

# The import above already brings in *annotations* future once; remove duplicate

"""Parallel batch extractor wrapper around ``auto_mcp.extractor_llm``.

Each documentation file is processed concurrently (default 8 worker threads,
configurable via ``-j/--jobs``).  This speeds up large documentation trees
while still respecting OpenAI rate limits.
"""

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List

# ---------------------------------------------------------------------------
# Dependency handling – auto_mcp.extractor_llm ------------------------------
# ---------------------------------------------------------------------------

try:
    from auto_mcp.extractor_llm import run_extraction  # type: ignore
except ModuleNotFoundError as exc:  # pragma: no cover – graceful message
    msg = (
        "The parallel batch extractor relies on the `auto_mcp` package\n"
        "which is not installed in the current environment.  Install it via\n\n"
        "    pip install auto_mcp\n\n"
        "or add the repository containing `auto_mcp.extractor_llm` to your\n"
        "PYTHONPATH, then rerun the command."
    )
    raise SystemExit(msg) from exc


_DEFAULT_EXTS = (".md", ".yaml", ".yml")
# Default number of parallel workers.  Adjust as appropriate for your OpenAI
# rate limit – each worker may produce up to ~3 RPM (depends on the size of
# the chunk and retry behaviour inside ``run_extraction``).
_DEFAULT_JOBS = 8


def _walk_files(root: Path, exts=_DEFAULT_EXTS) -> List[Path]:  # noqa: D401
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in exts)


def _main(argv):  # noqa: D401 – mini CLI
    if len(argv) < 2:
        print(
            (
                "Usage: python -m llm_pipeline.batch_extract <db_path> [root_dir …]\n"
                "Default root: usaspending-api/usaspending_api/api_contracts/contracts"
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)

    db_path = Path(argv[1])
    # Default to the authoritative API-Blueprint sources only.
    root_dirs = [
        Path(p)
        for p in (
            argv[2:]
            or [Path("usaspending-api/usaspending_api/api_contracts/contracts")]
        )
    ]

    doc_files = []
    for rd in root_dirs:
        doc_files.extend(_walk_files(rd))
    if not doc_files:
        print(f"No documentation files found under {root_dir}")
        raise SystemExit(1)

    print(f"Found {len(doc_files)} files -> extracting into {db_path}\n")

    t0 = time.time()
    for i, f in enumerate(doc_files, 1):
        # try to print path relative to the first matching root for readability
        rel = None
        for rd in root_dirs:
            try:
                rel = f.relative_to(rd)
                break
            except ValueError:
                continue
        rel = rel or f
        print(f"[{i}/{len(doc_files)}] {rel}", end=" ... ")
        try:
            run_extraction(f, db_path)
            print("done")
        except Exception as exc:
            print(f"ERROR: {exc}")

    print(f"\nCompleted in {time.time() - t0:.1f}s – DB at {db_path}")


# ---------------------------------------------------------------------------
# Parallel variant (preferred) ------------------------------------------------
# ---------------------------------------------------------------------------


def _main(argv):  # noqa: D401 – parallel CLI replacing the sequential version
    import argparse

    parser = argparse.ArgumentParser(
        prog="python -m llm_pipeline.batch_extract",
        description="Extract documentation files in parallel using OpenAI LLM",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "db_path",
        nargs="?",
        default=Path("output/sections.db"),
        type=Path,
        help="SQLite DB path to write to (default: output/sections.db)",
    )
    parser.add_argument(
        "root_dir",
        nargs="*",
        type=Path,
        help="Root directories to scan (default: official contracts dir)",
    )
    parser.add_argument(
        "-j", "--jobs", type=int, default=_DEFAULT_JOBS, help="Parallel workers"
    )

    args = parser.parse_args(argv[1:])

    db_path: Path = args.db_path
    # Ensure parent directory exists when a custom (or default) path contains
    # folders such as "output/sections.db".
    if db_path.parent and not db_path.parent.exists():
        db_path.parent.mkdir(parents=True, exist_ok=True)
    roots: List[Path] = args.root_dir or [
        Path("usaspending-api/usaspending_api/api_contracts/contracts")
    ]
    jobs = max(1, args.jobs)

    doc_files: List[Path] = []
    for rt in roots:
        doc_files.extend(_walk_files(rt))

    if not doc_files:
        print("No documentation files found – aborting", file=sys.stderr)
        raise SystemExit(1)

    print(
        f"Found {len(doc_files)} files – extracting with {jobs} worker(s) into {db_path}\n"
    )

    t0 = time.time()

    def _worker(path: Path):  # noqa: D401 – helper for pool
        try:
            run_extraction(path, db_path)
            return None
        except Exception as exc:  # noqa: BLE001
            return exc

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = {pool.submit(_worker, p): p for p in doc_files}
        for i, fut in enumerate(as_completed(futures), 1):
            path = futures[fut]
            rel = _relative_to_any(path, roots)
            err = fut.result()
            if err is None:
                print(f"[{i}/{len(doc_files)}] {rel} … done")
            else:
                print(f"[{i}/{len(doc_files)}] {rel} … ERROR: {err}")

    print(f"\nCompleted in {time.time() - t0:.1f}s – DB at {db_path}")


def _relative_to_any(p: Path, roots: List[Path]) -> Path:  # noqa: D401
    for rd in roots:
        try:
            return p.relative_to(rd)
        except ValueError:
            continue
    return p


if __name__ == "__main__":  # pragma: no cover
    _main(sys.argv)
