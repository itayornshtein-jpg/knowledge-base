# Knowledge Base — Project Context for Claude

## What this project is
A support-team knowledge base. Engineers log support cases with problem descriptions and resolutions. The app has AI-powered search (Claude or OpenAI) and integrates with JIRA and Salesforce.

## Stack
| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.12), SQLAlchemy 2.0, PostgreSQL 16 |
| Frontend | React 19 (CRA), plain CSS |
| Auth | JWT (dev) → AWS Cognito + Google SSO (prod) |
| Database | PostgreSQL via RDS in production, Docker locally |
| Storage | Base64 inline (dev) → S3 presigned URLs (prod) |
| Deploy | Docker on EC2, GitLab CI/CD pipeline |

## Running locally
```bash
# Option A — Docker (recommended, starts everything)
docker-compose up --build

# Option B — manual
# Terminal 1: start PostgreSQL (or use the docker db service only)
docker-compose up db

# Terminal 2: start backend
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# Terminal 3: start frontend
npm install
npm start
```

The app is at http://localhost:3000, API docs at http://localhost:8000/api/docs.

## Key files
```
backend/
  main.py          — FastAPI app, middleware, mounts static files
  config.py        — Settings (reads .env locally, AWS Secrets Manager in prod)
  database.py      — SQLAlchemy engine + session
  models.py        — ORM models: Article, Category
  schemas.py       — Pydantic request/response schemas
  deps.py          — FastAPI dependencies (DB session, auth)
  routers/
    knowledge.py   — CRUD for /api/knowledge (articles)
    categories.py  — CRUD for /api/categories
    assistant.py   — AI Q&A at /api/assistant

src/
  App.js           — Root component, state, layout
  hooks/
    useEntries.js  — Article fetching + mutations
    useCategories.js — Category fetching + mutations
    useAssistant.js  — AI assistant chat
  components/
    Sidebar.js     — Navigation + category filter
    ComposerModal.js — Create/edit article form
    CategoryModal.js — Create/delete categories
    ArticleList.js — Filtered, paginated article list
    ArticleDetail.js — Full article view
    AssistantPanel.js — AI chat panel
```

## Environment
Copy `.env.example` to `.env` and fill in values. The only required field for local dev is `DATABASE_URL` (already set in `.env.example` for docker-compose).

To enable the AI assistant, add either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

## Database migrations
The app auto-creates tables on startup (`create_tables()` in `database.py`). For schema changes, add them to `models.py` and run:
```bash
# Drop and recreate all tables (dev only — destroys data)
python -c "from backend.database import Base, engine; Base.metadata.drop_all(engine); Base.metadata.create_all(engine)"
```
For production schema changes without data loss, use Alembic (not yet configured).

## Migrate old db.json data
```bash
python scripts/migrate_from_json.py              # uses db.json in project root
python scripts/migrate_from_json.py --dry-run    # preview only
```

## Deploy
Push to `main` on GitLab → CI pipeline automatically builds, pushes to ECR, deploys to EC2 via SSM.

Manual deploy:
```bash
docker build -t kb-app --target prod .
docker tag kb-app:latest YOUR_ECR_URI:latest
docker push YOUR_ECR_URI:latest
```

## API quick reference
| Method | Path | Description |
|---|---|---|
| GET | /api/knowledge | List articles (params: view, search, category_id) |
| POST | /api/knowledge | Create article |
| PUT | /api/knowledge/{id} | Update article |
| POST | /api/knowledge/{id}/archive | Soft-delete |
| POST | /api/knowledge/{id}/restore | Un-archive |
| GET | /api/categories | List categories |
| POST | /api/categories | Create category |
| DELETE | /api/categories/{id} | Delete category |
| POST | /api/assistant | Ask AI a question |
| GET | /api/health | Health check |
| GET | /api/docs | Interactive Swagger UI |
