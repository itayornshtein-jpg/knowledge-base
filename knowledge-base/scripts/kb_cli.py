#!/usr/bin/env python3
"""
kb-cli — manage knowledge-base pages from the terminal.

Talks to the FastAPI backend (default http://localhost:8000).
Override with KB_API_BASE env var.

Examples:
  kb-cli list
  kb-cli list --view archived --search "sso"
  kb-cli show <id>
  kb-cli new                          # interactive prompts
  kb-cli new --file page.json         # from JSON file
  kb-cli edit <id>                    # opens $EDITOR with the page as YAML/JSON
  kb-cli archive <id>
  kb-cli restore <id>
  kb-cli ask "why does login fail after SSO?"
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

API_BASE = os.environ.get("KB_API_BASE", "http://localhost:8000")
TOKEN = os.environ.get("KB_API_TOKEN", "")
EDITOR = os.environ.get("EDITOR", "nano")


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _request(method: str, path: str, body: dict | None = None, params: dict | None = None) -> Any:
    url = f"{API_BASE}{path}"
    if params:
        clean = {k: v for k, v in params.items() if v is not None}
        if clean:
            url += "?" + urlencode(clean)

    headers = {"Accept": "application/json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"

    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"

    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw)
    except HTTPError as e:
        try:
            detail = json.loads(e.read()).get("detail", e.reason)
        except Exception:
            detail = e.reason
        sys.exit(f"error: {method} {path} → HTTP {e.code} ({detail})")
    except URLError as e:
        sys.exit(f"error: could not reach {API_BASE} — is the backend running?\n       {e.reason}")


# ── Output ────────────────────────────────────────────────────────────────────

def _color(s: str, code: str) -> str:
    if not sys.stdout.isatty():
        return s
    return f"\033[{code}m{s}\033[0m"

BOLD = lambda s: _color(s, "1")
DIM = lambda s: _color(s, "2;37")
GREEN = lambda s: _color(s, "32")
ORANGE = lambda s: _color(s, "33")
BLUE = lambda s: _color(s, "34")
RED = lambda s: _color(s, "31")


def _print_table(rows: list[dict]) -> None:
    if not rows:
        print(DIM("(no pages)"))
        return

    width = os.get_terminal_size((100, 20)).columns if sys.stdout.isatty() else 100
    summary_w = max(20, width - 60)

    print(f"{BOLD('ID'):<14} {BOLD('STATUS'):<10} {BOLD('CASE'):<12} {BOLD('SUMMARY')}")
    print(DIM("─" * min(width, 100)))
    for r in rows:
        status = ORANGE("archived") if r.get("deleted_at") else GREEN("active")
        case = r.get("sf_case", "—")[:12]
        summary = (r.get("summary") or "")[:summary_w]
        rid = (r.get("id") or "")[:12]
        print(f"{rid:<14} {status:<19} {case:<12} {summary}")


def _print_page(entry: dict) -> None:
    print()
    print(BOLD(entry.get("summary", "(no summary)")))
    print(DIM(f"id: {entry.get('id')}  ·  SF Case {entry.get('sf_case')}  ·  "
              f"{'archived' if entry.get('deleted_at') else 'active'}"))
    if entry.get("jira_link"):
        print(BLUE(entry["jira_link"]))
    print()
    print(BOLD("Issue:"))
    print(entry.get("description", "").strip() or DIM("(empty)"))
    print()
    print(BOLD("Resolution:"))
    print(entry.get("solution", "").strip() or DIM("(empty)"))
    related = entry.get("related_page_ids") or []
    if related:
        print()
        print(BOLD("Related:"), ", ".join(related))
    print()


# ── Editor flow ───────────────────────────────────────────────────────────────

EDITABLE_FIELDS = ["summary", "sf_case", "jira_link", "description", "solution",
                   "related_page_ids", "category_id"]


def _open_in_editor(initial: dict) -> dict | None:
    template = {f: initial.get(f, [] if f == "related_page_ids" else "") for f in EDITABLE_FIELDS}
    header = (
        "# Edit the JSON below, save, and close the editor.\n"
        "# Lines starting with '#' are stripped before submitting.\n"
        "# Leave the file unchanged or empty to abort.\n\n"
    )

    with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as f:
        f.write(header)
        json.dump(template, f, indent=2)
        path = f.name

    try:
        subprocess.call([*EDITOR.split(), path])
        with open(path) as f:
            content = f.read()
    finally:
        os.unlink(path)

    stripped = "\n".join(line for line in content.splitlines() if not line.lstrip().startswith("#")).strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError as e:
        sys.exit(f"error: invalid JSON — {e}")


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_list(args):
    rows = _request("GET", "/api/knowledge", params={
        "view": args.view,
        "search": args.search,
        "category_id": args.category,
    })
    _print_table(rows or [])
    print(DIM(f"\n{len(rows or [])} page(s) · {API_BASE}"))


def cmd_show(args):
    entry = _request("GET", f"/api/knowledge/{args.id}")
    if args.json:
        print(json.dumps(entry, indent=2))
    else:
        _print_page(entry)


def cmd_new(args):
    if args.file:
        body = json.loads(Path(args.file).read_text())
    elif args.stdin:
        body = json.loads(sys.stdin.read())
    else:
        body = _open_in_editor({}) or sys.exit("aborted: empty editor input")

    for required in ("summary", "sf_case", "description", "solution"):
        if not body.get(required):
            sys.exit(f"error: '{required}' is required")

    created = _request("POST", "/api/knowledge", body=body)
    print(GREEN(f"✓ created {created.get('id')}"))
    if args.show:
        _print_page(created)


def cmd_edit(args):
    current = _request("GET", f"/api/knowledge/{args.id}")
    updated = _open_in_editor(current)
    if updated is None:
        sys.exit("aborted: no changes")
    saved = _request("PUT", f"/api/knowledge/{args.id}", body=updated)
    print(GREEN(f"✓ updated {saved.get('id')}"))


def cmd_archive(args):
    _request("POST", f"/api/knowledge/{args.id}/archive")
    print(ORANGE(f"✓ archived {args.id}"))


def cmd_restore(args):
    _request("POST", f"/api/knowledge/{args.id}/restore")
    print(GREEN(f"✓ restored {args.id}"))


def cmd_ask(args):
    question = " ".join(args.question)
    if not question:
        sys.exit("error: provide a question")
    response = _request("POST", "/api/assistant", body={"question": question})
    print()
    print(BOLD("Q:"), question)
    print(BOLD("A:"), response.get("answer", "(no answer)"))
    sources = response.get("sources") or []
    if sources:
        print()
        print(DIM("Sources:"))
        for s in sources:
            print(DIM(f"  · {s.get('summary')} — SF {s.get('sf_case')} ({s.get('id')})"))
    print()


# ── Argparse ──────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(
        prog="kb-cli",
        description="Manage the Knowledge Base from the terminal.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"API base: {API_BASE} (override with KB_API_BASE)",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", aliases=["ls"], help="List pages")
    p_list.add_argument("--view", choices=["active", "archived", "all"], default="active")
    p_list.add_argument("--search", help="Search summary/case/description/solution")
    p_list.add_argument("--category", help="Filter by category UUID")
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", aliases=["cat"], help="Show one page")
    p_show.add_argument("id")
    p_show.add_argument("--json", action="store_true", help="Raw JSON")
    p_show.set_defaults(func=cmd_show)

    p_new = sub.add_parser("new", aliases=["add"], help="Create a page")
    p_new.add_argument("--file", help="Read JSON body from file")
    p_new.add_argument("--stdin", action="store_true", help="Read JSON body from stdin")
    p_new.add_argument("--show", action="store_true", help="Print the created page")
    p_new.set_defaults(func=cmd_new)

    p_edit = sub.add_parser("edit", help="Open a page in $EDITOR and save")
    p_edit.add_argument("id")
    p_edit.set_defaults(func=cmd_edit)

    p_arch = sub.add_parser("archive", aliases=["rm"], help="Soft-delete a page")
    p_arch.add_argument("id")
    p_arch.set_defaults(func=cmd_archive)

    p_rest = sub.add_parser("restore", help="Restore a soft-deleted page")
    p_rest.add_argument("id")
    p_rest.set_defaults(func=cmd_restore)

    p_ask = sub.add_parser("ask", help="Ask the AI assistant")
    p_ask.add_argument("question", nargs="+")
    p_ask.set_defaults(func=cmd_ask)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
