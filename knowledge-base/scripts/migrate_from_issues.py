#!/usr/bin/env python3
"""
Import Issues & Requests markdown files into the knowledge base.

Usage:
    python scripts/migrate_from_issues.py                        # default path
    python scripts/migrate_from_issues.py /path/to/Issues        # custom path
    python scripts/migrate_from_issues.py --dry-run              # preview only
    python scripts/migrate_from_issues.py --reset                # delete existing imported articles first

The script reads every .md file inside the folder, parses fields, creates
categories from the "Related to" header, and inserts Articles into PostgreSQL.
"""

import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from backend.database import SessionLocal, create_tables
from backend.models import Article, Category


# ── Default path to the Issues Requests folder ────────────────────────────────
DEFAULT_ISSUES_DIR = Path.home() / \
    "Downloads/Private & Shared/Issues Requests & Resolutions/Issues Requests"

# ── Category colour palette (cycles through these) ────────────────────────────
CATEGORY_COLOURS = {
    "platform":           "#6366f1",   # indigo
    "cm":                 "#10b981",   # emerald
    "commitment manager": "#10b981",
    "zesty disk":         "#f59e0b",   # amber
    "zd":                 "#f59e0b",
    "rds":                "#3b82f6",   # blue
    "kompass":            "#8b5cf6",   # violet
}

FALLBACK_COLOURS = ["#ec4899", "#14b8a6", "#f97316", "#64748b"]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:120]


def _colour_for(name: str, index: int) -> str:
    key = name.lower().strip()
    for k, v in CATEGORY_COLOURS.items():
        if k in key or key in k:
            return v
    return FALLBACK_COLOURS[index % len(FALLBACK_COLOURS)]


def _extract_header_field(text: str, field: str) -> str:
    """Extract a loose header field like  'Related to: Platform' or '#Tags: foo'."""
    pattern = re.compile(
        rf"(?:^|\n)[#\s]*{re.escape(field)}\s*[:\-]\s*(.+)",
        re.IGNORECASE
    )
    m = pattern.search(text)
    return m.group(1).strip() if m else ""


def _extract_section(text: str, *headings) -> str:
    """Return the body of the first matching ## Heading section."""
    for heading in headings:
        pattern = re.compile(
            rf"##\s+{re.escape(heading)}[^\n]*\n(.*?)(?=\n##\s|\Z)",
            re.IGNORECASE | re.DOTALL
        )
        m = pattern.search(text)
        if m:
            body = m.group(1).strip()
            # Strip <aside> blocks (Notion callouts)
            body = re.sub(r"<aside>.*?</aside>", "", body, flags=re.DOTALL).strip()
            # Strip HTML tags
            body = re.sub(r"<[^>]+>", "", body)
            # Strip markdown image lines
            body = re.sub(r"!\[.*?\]\(.*?\)", "", body)
            # Collapse 3+ blank lines → 2
            body = re.sub(r"\n{3,}", "\n\n", body)
            return body.strip()
    return ""


def _extract_sf_case(text: str) -> str:
    """Pull the first Salesforce case number from a Links section."""
    # Match patterns like [00012345](...) or SF-00012345
    m = re.search(r"\[(\d{7,})\]", text)
    if m:
        return m.group(1)
    m = re.search(r"SF[-\s]?(\d{5,})", text, re.IGNORECASE)
    if m:
        return m.group(1)
    return "N/A"


def _extract_jira(text: str) -> str:
    m = re.search(r"(https?://[^\s\)]+jira[^\s\)]+)", text, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _parse_date(raw: str):
    if not raw:
        return None
    raw = raw.strip()
    for fmt in ("%B %d, %Y", "%B %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_md(path: Path) -> dict:
    """Parse a single markdown file and return a dict of article fields."""
    text = path.read_text(encoding="utf-8", errors="replace")

    # Title: first # heading
    title_m = re.match(r"#\s+(.+)", text.strip())
    title = title_m.group(1).strip() if title_m else path.stem

    # Clean up UUID suffixes like "Change organization name 20709cc4dfb..."
    title = re.sub(r"\s+[0-9a-f]{20,}$", "", title).strip()

    prop        = _extract_header_field(text, "Property") or \
                  _extract_header_field(text, "")  # bare ": Issue" style
    tags        = _extract_header_field(text, "#Tags") or \
                  _extract_header_field(text, "Tags")
    related_to  = _extract_header_field(text, "Related to")
    status      = _extract_header_field(text, "Status")
    date_raw    = _extract_header_field(text, "Date of creation")

    # Handle bare ": Issue" / ": Service Request" lines at top of file
    if not prop:
        bare_m = re.search(r"^:\s*(Issue|Service Request|General Question)", text, re.MULTILINE)
        prop = bare_m.group(1) if bare_m else ""

    description = _extract_section(
        text,
        "Issue description", "Request Description",
        "Question", "Issue Description", "Description"
    )
    symptoms    = _extract_section(text, "Symptoms")
    solution    = _extract_section(text, "Resolution")

    if symptoms:
        description = (description + "\n\n**Symptoms:**\n" + symptoms).strip() if description \
                      else ("**Symptoms:**\n" + symptoms)

    sf_case     = _extract_sf_case(text)
    jira_link   = _extract_jira(text)
    created_at  = _parse_date(date_raw) or datetime.now(timezone.utc)

    return {
        "title":       title,
        "prop":        prop,
        "tags":        tags,
        "related_to":  related_to.strip() if related_to else "",
        "status":      status,
        "description": description,
        "solution":    solution,
        "sf_case":     sf_case,
        "jira_link":   jira_link,
        "created_at":  created_at,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def migrate(issues_dir: str, dry_run: bool = False, reset: bool = False):
    folder = Path(issues_dir)
    if not folder.exists():
        print(f"[ERROR] Folder not found: {folder}")
        sys.exit(1)

    md_files = sorted(folder.glob("*.md"))
    print(f"Found {len(md_files)} markdown files in {folder}\n")

    if dry_run:
        print("[DRY RUN] No changes will be written.\n")

    create_tables()
    db: Session = SessionLocal()

    try:
        if reset and not dry_run:
            deleted = db.query(Article).filter(
                Article.sf_case != None
            ).delete(synchronize_session=False)
            db.commit()
            print(f"[RESET] Deleted {deleted} existing articles.\n")

        # ── Step 1: collect unique "Related to" values → categories ──────────
        related_values: set[str] = set()
        parsed: list[dict] = []

        for md in md_files:
            try:
                data = parse_md(md)
                parsed.append(data)
                if data["related_to"]:
                    # "CM, RDS" → ["CM", "RDS"]
                    for part in data["related_to"].split(","):
                        v = part.strip()
                        if v:
                            related_values.add(v)
            except Exception as e:
                print(f"  [WARN] Could not parse {md.name}: {e}")

        # ── Step 2: ensure categories exist ──────────────────────────────────
        cat_map: dict[str, uuid.UUID] = {}  # name → id

        for i, name in enumerate(sorted(related_values)):
            slug = _slugify(name)
            existing = db.query(Category).filter_by(slug=slug).first()
            if existing:
                cat_map[name] = existing.id
                print(f"  [CAT]  Already exists: {name}")
            else:
                colour = _colour_for(name, i)
                if not dry_run:
                    cat = Category(
                        name=name,
                        slug=slug,
                        color=colour,
                        description=f"Issues and requests related to {name}",
                    )
                    db.add(cat)
                    db.flush()   # get the id before commit
                    cat_map[name] = cat.id
                    print(f"  [CAT]  Created: {name} ({colour})")
                else:
                    cat_map[name] = uuid.uuid4()
                    print(f"  [DRY]  Would create category: {name} ({colour})")

        if not dry_run:
            db.commit()

        print()

        # ── Step 3: insert articles ───────────────────────────────────────────
        inserted = skipped = errors = 0

        for data in parsed:
            try:
                # Resolve category_id: use first value from "Related to"
                related_to = data["related_to"]
                category_id = None
                if related_to:
                    first_rel = related_to.split(",")[0].strip()
                    category_id = cat_map.get(first_rel)

                summary = data["title"]
                if len(summary) > 490:
                    summary = summary[:487] + "..."

                # Build a unique-enough ID from the title slug
                slug_id = _slugify(data["title"])[:40].strip("-")
                article_id = f"page_{slug_id}"

                # Avoid duplicates
                if db.get(Article, article_id):
                    print(f"  [SKIP] Already exists: {article_id}")
                    skipped += 1
                    continue

                if dry_run:
                    print(f"  [DRY]  Would insert: {article_id} — {summary[:60]}")
                    inserted += 1
                    continue

                article = Article(
                    id=article_id,
                    summary=summary,
                    sf_case=data["sf_case"],
                    jira_link=data["jira_link"],
                    description=data["description"],
                    solution=data["solution"],
                    related_page_ids=[],
                    images=[],
                    category_id=category_id,
                    created_at=data["created_at"],
                    updated_at=data["created_at"],
                )
                db.add(article)
                print(f"  [OK]   {article_id} — {summary[:60]}")
                inserted += 1

            except Exception as e:
                print(f"  [ERR]  {data.get('title', '?')}: {e}")
                errors += 1

        if not dry_run:
            db.commit()

        print(f"\n{'Dry run' if dry_run else 'Done'}. "
              f"Inserted {inserted}, skipped {skipped}, errors {errors}.")

    except Exception as e:
        db.rollback()
        print(f"\n[FATAL] {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    args   = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry    = "--dry-run" in sys.argv
    reset  = "--reset"   in sys.argv

    folder = args[0] if args else str(DEFAULT_ISSUES_DIR)
    migrate(folder, dry_run=dry, reset=reset)
