"""Centralized configuration helpers.

Currently only handles a single *OUTPUT_ROOT* directory which is used by
various CLI helpers to determine where result artefacts (SQLite DBs, log
files, …) are written.  The value is resolved in this order:

1. Environment variable ``OUTPUT_ROOT`` if set.
2. A ``.env`` file located at the repository root (one directory above this
   module) containing a line ``OUTPUT_ROOT=/abs/path``.
3. Fallback to ``<cwd>/outputs`` in the current process directory.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


_ENV_FILE_CANDIDATE = Path(__file__).resolve().parent.parent / ".env"


def _load_dotenv() -> None:  # noqa: D401 – internal helper
    """Populate ``os.environ`` from a simple ``.env`` file if it exists."""

    if not _ENV_FILE_CANDIDATE.exists():
        return

    for line in _ENV_FILE_CANDIDATE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"')  # strip optional quotes
        # Do not overwrite explicitly provided environment variables so that
        # callers can override values on the command line.
        if key and key not in os.environ:
            os.environ[key] = val


def get_output_root() -> Path:  # noqa: D401 – public helper
    """Return the directory where all generated artefacts should be stored."""

    # Ensure environment variables from .env are available before we check
    # them the first time.  The operation is idempotent and cheap (~1 µs).
    _load_dotenv()

    root: Optional[str] = os.environ.get("OUTPUT_ROOT")
    if root:
        p = Path(root).expanduser()
        if not p.is_absolute():
            # Interpret relative paths as relative to the repository root (the
            # directory containing the .env file) so they are independent of
            # the current working directory.
            p = (_ENV_FILE_CANDIDATE.parent / p).resolve()
        return p

    # Fallback – keep the previous behaviour of writing to ./outputs so tests
    # continue to pass even without an explicit configuration.
    return (Path.cwd() / "outputs").resolve()
