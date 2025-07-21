"""Shallow re-export so `from section_store import SectionStore` works.

Historically the utility lived as a standalone module.  Some code (and
examples outside this repo) still import it directly.  To avoid breaking
those callers we provide this tiny forwarder.
"""

from llm_pipeline.section_store import SectionStore  # noqa: F401 re-export

__all__ = ["SectionStore"]

