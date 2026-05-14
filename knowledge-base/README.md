# Knowledge Base

A support-team knowledge base with AI-powered search, JIRA/Salesforce links, and a terminal CLI. React 19 frontend, FastAPI backend, PostgreSQL.

See [CLAUDE.md](./CLAUDE.md) for the full architecture overview.

---

## Running locally

```bash
# Recommended — Docker brings up db, backend, and frontend
docker-compose up --build

# App:        http://localhost:3000
# API docs:   http://localhost:8000/api/docs
```

Manual setup (three terminals):

```bash
# 1) database
docker-compose up db

# 2) backend
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# 3) frontend
npm install
npm start
```

---

## `kb-cli` — manage pages from the terminal

`scripts/kb_cli.py` is a stdlib-only Python script that talks to the FastAPI backend. No extra dependencies needed.

### Setup

```bash
chmod +x scripts/kb_cli.py
alias kb='python3 /full/path/to/scripts/kb_cli.py'

# Defaults to http://localhost:8000 — override if needed:
export KB_API_BASE=http://localhost:8000
export KB_API_TOKEN=...      # only if backend auth is enabled
export EDITOR=vim            # vim / nano / code -w …
```

### Commands

| Command | Purpose |
|---|---|
| `kb list` | List active pages |
| `kb list --view archived` | List archived pages |
| `kb list --view all --search sso` | Search across summary / case / description / solution |
| `kb list --category <uuid>` | Filter by category |
| `kb show <id>` | Render one page in the terminal |
| `kb show <id> --json` | Same, but raw JSON |
| `kb new` | Open `$EDITOR` with a JSON template, save to create |
| `kb new --file page.json` | Create from a JSON file |
| `kb new --stdin` | Create from piped JSON |
| `kb edit <id>` | Open `$EDITOR` pre-filled with current values |
| `kb archive <id>` | Soft-delete |
| `kb restore <id>` | Un-archive |
| `kb ask "<question>"` | Query the AI assistant |

Aliases: `ls` for `list`, `cat` for `show`, `add` for `new`, `rm` for `archive`.

### Quick examples

```bash
# Search and pick an id, then read it
kb ls --search "login fails"
kb show 7a3c1f9e8d2b

# Edit interactively
kb edit 7a3c1f9e8d2b           # opens $EDITOR; save & close to commit

# Pipe in a structured page
cat <<'EOF' | kb new --stdin
{
  "summary": "DNS resolution flapping on east-1 cluster",
  "sf_case": "00125501",
  "jira_link": "https://jira.company.com/browse/OPS-882",
  "description": "Pods intermittently fail to resolve service hostnames.",
  "solution": "1. Restart coredns deployment.\n2. Verify NetworkPolicy.\n3. Re-test.",
  "related_page_ids": []
}
EOF

# Ask the assistant
kb ask "what causes 5xx after a region failover?"
```

The `edit` command writes a JSON template to a temp file, opens it in `$EDITOR`, and `PUT`s the result on save. Leave the file unchanged (or empty) to abort.

---

## React `npm` scripts

| Script | Description |
|---|---|
| `npm start` | Dev server at http://localhost:3000 |
| `npm test` | Jest in watch mode |
| `npm run build` | Production build into `build/` |

---

## Layout overview

```
backend/         FastAPI app (main.py, routers, models, schemas)
src/             React app — components/, hooks/, App.js
scripts/         CLI utilities (kb_cli.py, migrate_from_json.py)
docker-compose.yml
Dockerfile
db.json          (legacy seed data for migrate_from_json.py)
```
