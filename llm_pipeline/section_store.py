"""Copy of section_store from hyphenated package (see that file for docs)."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

ISO_FMT = "%Y-%m-%dT%H:%M:%SZ"


def _utcnow() -> str:  # pragma: no cover – trivial
    return time.strftime(ISO_FMT, time.gmtime())


class SectionStore:
    def __init__(self, db_url: str | Path = "store.db") -> None:  # noqa: D401
        if str(db_url).startswith("sqlite:///"):
            db_url = str(db_url)[10:]

        self.path = Path(db_url)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self._ensure_schema()

    def upsert(self, *, id: str, content: str, meta: dict | None = None) -> None:
        now = _utcnow()
        meta_json = json.dumps(meta or {})
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO sections(id, content, meta, created_at, updated_at)
                VALUES (:id, :content, :meta, :now, :now)
                ON CONFLICT(id) DO UPDATE SET
                  content    = excluded.content,
                  meta       = excluded.meta,
                  updated_at = excluded.updated_at
                """,
                {"id": id, "content": content, "meta": meta_json, "now": now},
            )

    def get(self, id: str):  # noqa: D401
        cur = self.conn.execute("SELECT * FROM sections WHERE id = ?", (id,))
        row = cur.fetchone()
        return dict(row) if row else None
    
    def list_ids(self):  # noqa: D401
        cur = self.conn.execute("SELECT id FROM sections ORDER BY id")
        return [r[0] for r in cur.fetchall()]

    def _ensure_schema(self) -> None:  # noqa: D401
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sections (
                id          TEXT PRIMARY KEY,
                content     TEXT NOT NULL,
                meta        JSON NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
            """
        )
        self.conn.commit()

    def __enter__(self):  # noqa: D401
        return self

    def __exit__(self, exc_type, exc, tb):  # noqa: D401
        self.conn.close()

