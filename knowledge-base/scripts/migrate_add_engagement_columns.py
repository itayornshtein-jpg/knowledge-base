#!/usr/bin/env python3
"""
Add the `is_starred` and `view_count` columns to the existing `articles` table,
plus the new indexes, without dropping data.

Safe to run multiple times — every statement is `IF NOT EXISTS`.

Usage:
    python -m scripts.migrate_add_engagement_columns
    # or
    python scripts/migrate_add_engagement_columns.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running this file directly without `python -m`.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from backend.database import engine  # noqa: E402


STATEMENTS = [
    # Columns ------------------------------------------------------------
    'ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT FALSE;',
    'ALTER TABLE articles ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;',
    # Indexes used by routers/knowledge.py search + sort ----------------
    'CREATE INDEX IF NOT EXISTS ix_article_summary_lower ON articles (LOWER(summary));',
    'CREATE INDEX IF NOT EXISTS ix_article_sf_case_lower ON articles (LOWER(sf_case));',
    'CREATE INDEX IF NOT EXISTS ix_article_description_lower ON articles (LOWER(description));',
    'CREATE INDEX IF NOT EXISTS ix_article_solution_lower ON articles (LOWER(solution));',
    'CREATE INDEX IF NOT EXISTS ix_article_deleted_at ON articles (deleted_at);',
    'CREATE INDEX IF NOT EXISTS ix_article_category_id ON articles (category_id);',
    'CREATE INDEX IF NOT EXISTS ix_article_created_at ON articles (created_at DESC);',
    'CREATE INDEX IF NOT EXISTS ix_article_is_starred ON articles (is_starred);',
    'CREATE INDEX IF NOT EXISTS ix_article_view_count ON articles (view_count DESC);',
]


def run() -> None:
    with engine.begin() as conn:
        for stmt in STATEMENTS:
            print(f"→ {stmt}")
            conn.execute(text(stmt))
    print("\n✓ migration complete")


if __name__ == "__main__":
    run()
