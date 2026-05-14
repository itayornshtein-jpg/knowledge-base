#!/usr/bin/env python3
"""
Migrate data from the old db.json flat file into PostgreSQL.

Usage:
    python scripts/migrate_from_json.py              # uses db.json in this folder
    python scripts/migrate_from_json.py path/to/db.json
    python scripts/migrate_from_json.py --dry-run    # print what would be inserted
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow running from the project root without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from backend.database import SessionLocal, create_tables
from backend.models import Article


def parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def migrate(db_file: str, dry_run: bool = False):
    path = Path(db_file)
    if not path.exists():
        print(f"[ERROR] File not found: {db_file}")
        sys.exit(1)

    with open(path, encoding="utf-8") as f:
        records = json.load(f)

    if not isinstance(records, list):
        print("[ERROR] db.json must be a JSON array at the top level.")
        sys.exit(1)

    print(f"Found {len(records)} records in {db_file}")

    if dry_run:
        print("[DRY RUN] No changes will be written.\n")

    create_tables()
    db: Session = SessionLocal()

    inserted = 0
    skipped = 0

    try:
        for raw in records:
            article_id = raw.get("id", "").strip()
            if not article_id:
                print(f"  [SKIP] Record has no id: {raw}")
                skipped += 1
                continue

            # Check for duplicates
            existing = db.get(Article, article_id)
            if existing:
                print(f"  [SKIP] Already exists: {article_id}")
                skipped += 1
                continue

            article = Article(
                id=article_id,
                summary=raw.get("summary", "").strip() or "(no summary)",
                sf_case=raw.get("sf_case", "").strip() or "N/A",
                jira_link=raw.get("jira_link", "").strip(),
                description=raw.get("description", "").strip(),
                solution=raw.get("solution", "").strip(),
                related_page_ids=[
                    r for r in (raw.get("related_page_ids") or []) if r
                ],
                images=[
                    i for i in (raw.get("images") or []) if i
                ],
                deleted_at=parse_dt(raw.get("deleted_at")),
                created_at=parse_dt(raw.get("created_at")) or datetime.now(timezone.utc),
                updated_at=parse_dt(raw.get("updated_at")) or datetime.now(timezone.utc),
            )

            if dry_run:
                print(f"  [DRY] Would insert: {article_id} — {article.summary[:60]}")
            else:
                db.add(article)
                print(f"  [OK]  Inserted: {article_id} — {article.summary[:60]}")

            inserted += 1

        if not dry_run:
            db.commit()
            print(f"\nDone. Inserted {inserted}, skipped {skipped}.")
        else:
            print(f"\nDry run complete. Would insert {inserted}, skip {skipped}.")

    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Migration failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv

    db_file = args[0] if args else os.path.join(os.path.dirname(__file__), "..", "db.json")
    migrate(db_file, dry_run=dry_run)
