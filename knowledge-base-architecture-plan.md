# Knowledge Base Platform — Architecture & Migration Plan

## Executive Summary

This document covers the full architecture plan for migrating your support team knowledge base from a local Python/React app with `db.json` storage to a production-grade system on AWS. It includes hosting, authentication, database, CI/CD via GitLab, integrations (JIRA, Salesforce, Claude AI), and AI-powered remote editing.

---

## 1. Current State

| Dimension | Current |
|---|---|
| Frontend | React |
| Backend | Python |
| Database | `db.json` (flat file) |
| Hosting | Local machine |
| Auth | None / manual |
| CI/CD | None |
| Integrations | None |

---

## 2. Target Architecture

### Infrastructure: AWS (EC2-based)

**Why EC2 (not Lambda or ECS for now):** For a small team (under 50 users), EC2 gives you full control, predictable cost, and the easiest migration path from a locally-running Python app. ECS (Fargate) would be the natural next step once you need multi-container orchestration or zero-downtime rolling deploys.

```
Browser / Clients
      │
   CloudFront (CDN + WAF)
      │
   ALB (HTTPS termination, SSL via ACM)
      │
   EC2 t3.small / t3.medium
   ┌─────────────────────────────────┐
   │  Docker container               │
   │  - Nginx (reverse proxy)        │
   │  - FastAPI (Python backend)     │
   │  - React build (static files)   │
   └─────────────────────────────────┘
      │
   ┌──────────┬──────────┬───────────┐
   │          │          │           │
  RDS        S3       ElastiCache
PostgreSQL  (files)   Redis
```

### Key AWS Services

| Service | Role | Notes |
|---|---|---|
| EC2 (t3.small) | Application host | Start small, resize if needed |
| RDS PostgreSQL | Primary database | db.t3.micro for small teams |
| S3 | File/attachment storage | Lifecycle rules to archive old files |
| CloudFront | CDN + WAF | Serves static React build, protects backend |
| ALB | Load balancer | HTTPS termination, health checks |
| ACM | SSL certificate | Free, auto-renews |
| Route 53 | DNS | Point your domain to CloudFront/ALB |
| ElastiCache Redis | Sessions + caching | `cache.t3.micro` |
| ECR | Docker image registry | Used by GitLab CI pipeline |
| AWS SSM | Secure shell access | No SSH key management needed |
| Cognito | Auth / Google IdP | Manages OAuth tokens |
| Secrets Manager | API keys & credentials | JIRA, Salesforce, Claude tokens |

---

## 3. Authentication: Google SSO via AWS Cognito

### Architecture

```
User browser
    │
    ├─→ Hits /login
    │       │
    │   CloudFront → ALB → EC2 (FastAPI)
    │       │
    │   Redirect to Cognito Hosted UI
    │       │
    │   Cognito ──→ Google OAuth 2.0
    │       │       (users sign in with Google)
    │       │
    │   Cognito returns JWT tokens
    │       │
    └─→ EC2 validates JWT on every API request
```

### Implementation Steps

1. **Create a Cognito User Pool** in AWS console
2. **Add Google as a Social IdP:** Go to User Pool → Sign-in experience → Federated identity provider sign-in → Add Google. You need a Google OAuth client ID and secret from Google Cloud Console (https://console.cloud.google.com → APIs & Services → Credentials).
3. **Configure app client:** Create an app client in the User Pool with the redirect URIs pointing to your domain.
4. **FastAPI backend:** Use the `python-jose` and `boto3` libraries to validate Cognito JWT tokens on every protected endpoint:

```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer
import jwt

def verify_token(token: str = Depends(HTTPBearer())):
    try:
        payload = jwt.decode(token.credentials, options={"verify_signature": False})
        # Verify against Cognito JWKS endpoint
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
```

5. **Frontend:** Use AWS Amplify JS library or the Cognito Hosted UI redirect for the login flow.

### Trade-offs

- **Cognito vs. rolling your own OAuth:** Cognito adds complexity upfront but handles token refresh, MFA, and user management for free. Worth it over time.
- **Hosted UI vs. custom UI:** Start with Cognito Hosted UI (fast to set up), then customize later.

---

## 4. Database: PostgreSQL on RDS

### Why PostgreSQL (Recommendation)

For a knowledge base with support team use (articles, tags, search, user attribution), PostgreSQL is the right choice because:
- Native full-text search (`tsvector` / `tsquery`) — no Elasticsearch needed at your scale
- JSON columns for flexible metadata (article properties, integration sync data)
- Widely understood by developers and AI coding assistants
- RDS managed service handles backups, patching, failover

DynamoDB would be better if your access patterns were entirely key-based and you needed auto-scaling to millions. Aurora would be better at 500+ concurrent users. Neither fits your situation yet.

### Recommended RDS Configuration

```
Instance: db.t3.micro (scale to db.t3.small if needed)
Engine: PostgreSQL 16
Multi-AZ: No (small team — enable when you need HA)
Storage: gp3, 20 GB to start (auto-scaling enabled)
Backups: 7-day retention
```

### Core Data Model

```sql
-- Users (synced from Cognito on first login)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    cognito_sub TEXT UNIQUE,
    role TEXT DEFAULT 'viewer',   -- viewer | editor | admin
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Articles (main KB content)
CREATE TABLE articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT,                  -- Markdown
    content_tsv TSVECTOR,          -- Full-text search vector
    slug TEXT UNIQUE,
    author_id UUID REFERENCES users(id),
    category_id UUID REFERENCES categories(id),
    status TEXT DEFAULT 'draft',   -- draft | published | archived
    metadata JSONB DEFAULT '{}',   -- flexible extra fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search index
CREATE INDEX articles_content_tsv_idx ON articles USING GIN(content_tsv);

-- Trigger to auto-update search vector
CREATE TRIGGER articles_tsv_update
    BEFORE INSERT OR UPDATE ON articles
    FOR EACH ROW EXECUTE FUNCTION
    tsvector_update_trigger(content_tsv, 'pg_catalog.english', title, content);

-- Categories
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES categories(id),
    slug TEXT UNIQUE
);

-- Attachments (metadata only — file lives in S3)
CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
    filename TEXT,
    s3_key TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT,
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integration sync state (tracks last sync per external system)
CREATE TABLE integration_sync (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL,           -- 'jira' | 'salesforce' | etc.
    external_id TEXT NOT NULL,
    article_id UUID REFERENCES articles(id),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    UNIQUE(source, external_id)
);

-- Audit log
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action TEXT,
    entity_type TEXT,
    entity_id UUID,
    diff JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Migration from db.json

1. Write a one-time migration script: read `db.json` → insert rows into PostgreSQL via `psycopg2`
2. Run it in a local staging environment first
3. Verify row counts and spot-check content
4. Run it once more against production RDS immediately after launch (with the app in maintenance mode)

---

## 5. CI/CD with GitLab

### Pipeline Overview

```
GitLab Push (main or feature branch)
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Stage 1: TEST                                   │
│  - pytest (Python unit tests)                   │
│  - jest (React component tests)                 │
│  - flake8 / eslint (linting)                    │
└────────────────────┬────────────────────────────┘
                     │ (only on main branch)
                     ▼
┌─────────────────────────────────────────────────┐
│ Stage 2: BUILD                                  │
│  - docker build -t kb-app .                     │
│  - Tag with Git SHA + :latest                   │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ Stage 3: PUSH                                   │
│  - docker push → ECR (AWS)                      │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│ Stage 4: DEPLOY                                 │
│  - SSH into EC2 (or use AWS SSM)                │
│  - docker pull latest image from ECR            │
│  - docker stop old container                    │
│  - docker run new container                     │
│  - Health check via ALB                         │
└─────────────────────────────────────────────────┘
```

### `.gitlab-ci.yml`

```yaml
stages:
  - test
  - build
  - push
  - deploy

variables:
  AWS_REGION: us-east-1
  ECR_REPO: <account-id>.dkr.ecr.us-east-1.amazonaws.com/kb-app
  IMAGE_TAG: $CI_COMMIT_SHORT_SHA

test:
  stage: test
  image: python:3.12
  script:
    - pip install -r requirements.txt
    - pytest tests/ --tb=short
    - cd frontend && npm ci && npm run test -- --watchAll=false
  cache:
    paths:
      - .pip_cache/
      - frontend/node_modules/

build:
  stage: build
  image: docker:24
  services:
    - docker:dind
  only:
    - main
  script:
    - docker build -t $ECR_REPO:$IMAGE_TAG -t $ECR_REPO:latest .

push:
  stage: push
  image: docker:24
  services:
    - docker:dind
  only:
    - main
  before_script:
    - apk add --no-cache aws-cli
    - aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO
  script:
    - docker push $ECR_REPO:$IMAGE_TAG
    - docker push $ECR_REPO:latest

deploy:
  stage: deploy
  image: python:3.12
  only:
    - main
  before_script:
    - pip install awscli --quiet
  script:
    - |
      aws ssm send-command \
        --instance-ids $EC2_INSTANCE_ID \
        --document-name "AWS-RunShellScript" \
        --parameters 'commands=[
          "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO",
          "docker pull $ECR_REPO:latest",
          "docker stop kb-app || true",
          "docker rm kb-app || true",
          "docker run -d --name kb-app --restart=always -p 8000:8000 --env-file /etc/kb-app.env $ECR_REPO:latest"
        ]'
```

### GitLab CI Variables (set in GitLab → Settings → CI/CD → Variables)

| Variable | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user with ECR push + SSM run permissions |
| `AWS_SECRET_ACCESS_KEY` | As above |
| `EC2_INSTANCE_ID` | The EC2 instance to deploy to |

### Dockerfile (root of project)

```dockerfile
# Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Python backend + serve static files
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/build ./static/
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 6. Integration Layer

The integration layer lives in the FastAPI backend as a set of service adapters. Each integration gets its own module under `backend/integrations/`.

```
backend/
  integrations/
    __init__.py
    jira.py         ← JIRA REST API client
    salesforce.py   ← Salesforce REST API client
    claude.py       ← Anthropic API client
    webhooks.py     ← Inbound webhooks from Slack, JIRA, etc.
```

All credentials are stored in **AWS Secrets Manager** and loaded at startup — never in environment variable files or source code.

### JIRA Integration

**Use case:** Attach JIRA tickets to knowledge base articles; when a ticket is resolved, suggest or auto-create a KB article.

```python
# backend/integrations/jira.py
import httpx
from backend.config import settings

class JiraClient:
    def __init__(self):
        self.base_url = f"https://{settings.JIRA_DOMAIN}.atlassian.net/rest/api/3"
        self.auth = (settings.JIRA_EMAIL, settings.JIRA_API_TOKEN)

    async def get_issue(self, issue_key: str) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{self.base_url}/issue/{issue_key}",
                auth=self.auth
            )
            r.raise_for_status()
            return r.json()

    async def create_issue(self, summary: str, description: str, project_key: str) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base_url}/issue",
                json={
                    "fields": {
                        "project": {"key": project_key},
                        "summary": summary,
                        "description": {"type": "doc", "version": 1,
                                        "content": [{"type": "paragraph",
                                                     "content": [{"type": "text", "text": description}]}]},
                        "issuetype": {"name": "Task"}
                    }
                },
                auth=self.auth
            )
            r.raise_for_status()
            return r.json()
```

### Salesforce Integration

**Use case:** Surface KB articles inside Salesforce case views; sync case categories to KB categories.

```python
# backend/integrations/salesforce.py
from simple_salesforce import Salesforce

def get_sf_client():
    return Salesforce(
        username=settings.SF_USERNAME,
        password=settings.SF_PASSWORD,
        security_token=settings.SF_TOKEN
    )

def search_articles_for_case(case_description: str) -> list:
    # Uses KB full-text search to suggest articles for a Salesforce case
    ...
```

### Claude AI Integration

**Use case:** AI search (semantic + keyword), auto-draft article from a support conversation, summarize an article.

```python
# backend/integrations/claude.py
import anthropic

client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

async def answer_from_kb(question: str, relevant_articles: list[str]) -> str:
    context = "\n\n".join(relevant_articles)
    message = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        system="You are a helpful support assistant. Answer based only on the provided knowledge base articles.",
        messages=[
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"}
        ]
    )
    return message.content[0].text

async def draft_article_from_ticket(ticket_text: str) -> dict:
    message = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=2048,
        system="You write clear, concise knowledge base articles for a support team.",
        messages=[
            {"role": "user", "content": f"Turn this support ticket into a KB article:\n\n{ticket_text}"}
        ]
    )
    return {"content": message.content[0].text}
```

### API Endpoints for Integrations

```
POST /api/integrations/jira/attach      — Link a JIRA issue to an article
GET  /api/integrations/jira/{issue_key} — Fetch JIRA issue details
POST /api/integrations/ai/answer        — Ask AI a question against the KB
POST /api/integrations/ai/draft         — Draft an article from raw text
POST /api/integrations/salesforce/sync  — Sync case categories
POST /api/webhooks/jira                 — Receive JIRA webhook events
POST /api/webhooks/salesforce           — Receive Salesforce platform events
```

---

## 7. Remote AI Editing via Terminal

### Architecture

The goal is to be able to sit at your local terminal, run Claude Code (or a similar AI CLI), and have it directly read, write, and deploy changes to your knowledge base — both the codebase and the content.

**Two complementary approaches:**

### Approach A: Claude Code + AWS SSM (code changes)

Claude Code on your local machine connects to the EC2 instance via AWS Systems Manager Session Manager — no SSH keys needed, just IAM credentials.

```bash
# Start a shell session on EC2 from your local terminal
aws ssm start-session --target i-<instance-id>

# Or use the SSM port forwarding to connect your editor
aws ssm start-session \
  --target i-<instance-id> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8000"],"localPortNumber":["8000"]}'
```

Claude Code (claude.ai/code) can then:
- Read and write files in the EC2 instance via the SSM session
- Run bash commands to restart the Docker container
- Execute database migrations
- Push commits back to GitLab (triggering the CI/CD pipeline)

Add a `CLAUDE.md` file at the root of the project so Claude Code understands the deployment context:

```markdown
# CLAUDE.md — deployment context

## Stack
- Frontend: React (build output in /static/)
- Backend: FastAPI (Python 3.12) in /backend/
- Database: PostgreSQL via RDS (connection string in AWS Secrets Manager)

## Run locally
docker build -t kb-app . && docker run -p 8000:8000 --env-file .env kb-app

## Deploy
Push to `main` branch — GitLab CI handles build and deploy automatically.

## DB migrations
cd backend && alembic upgrade head

## Secrets
Never hardcode credentials. All secrets are in AWS Secrets Manager under prefix `kb-app/`.
```

### Approach B: Admin API (content changes)

For editing knowledge base content from your terminal using AI, expose a secured Admin API:

```
POST /api/admin/articles          — Create article
PUT  /api/admin/articles/{id}     — Update article
POST /api/admin/import            — Bulk import from JSON/CSV

Authorization: Bearer <admin-token>
```

A local script (or Claude Code tool call) can then:

```bash
# Example: use AI to draft an article from a JIRA ticket, then push it to KB
claude "Create a KB article from JIRA ticket KB-123" \
  --tool jira_fetch \
  --tool kb_api_post
```

This works because Claude Code supports custom MCP tools — you can define a small MCP server that wraps your KB Admin API, making it callable by Claude Code from your local terminal.

### Summary: Which to use when

| Task | Method |
|---|---|
| Edit code, run migrations | Claude Code + SSM session into EC2 |
| Create/edit KB articles | Claude Code + KB Admin API (via MCP) |
| Deploy changes | Push to GitLab `main` branch → CI pipeline auto-deploys |
| Debug production issues | SSM session + live log tailing |

---

## 8. Security Considerations

- All secrets (DB password, API keys) in **AWS Secrets Manager** — never in `.env` files in the repo
- EC2 in a **private subnet** — only accessible via ALB (public) and SSM (private)
- RDS in a **private subnet** — not exposed to the internet
- **WAF rules** on CloudFront: rate limiting, common CVE protection
- **S3 bucket policy:** Block all public access; presigned URLs for file downloads
- **IAM least-privilege:** GitLab CI IAM user has only ECR push + SSM run permissions
- **Cognito:** Enforce email verification, set token expiry to 1 hour
- **CORS:** FastAPI CORS middleware restricted to your CloudFront domain only

---

## 9. Migration Phases

### Phase 1 — Foundation (weeks 1–2)
- Set up AWS account structure (VPC, subnets, security groups)
- Launch EC2, RDS, S3, ElastiCache, ECR
- Set up Route 53 + ACM + CloudFront + ALB
- Dockerize the existing Python/React app
- Run db.json → PostgreSQL migration script
- Deploy manually once to confirm it all works

### Phase 2 — Auth & CI/CD (weeks 2–3)
- Set up Cognito User Pool + Google IdP
- Add JWT validation to FastAPI
- Build the GitLab CI pipeline (`.gitlab-ci.yml`)
- First automated deploy via pipeline

### Phase 3 — Integrations (weeks 3–5)
- JIRA integration (attach issues to articles)
- Claude AI integration (AI search, article drafting)
- Salesforce integration (article suggestions in cases)

### Phase 4 — Remote AI Editing (week 5–6)
- Set up Claude Code with SSM access
- Define KB Admin API
- Build a small MCP server wrapping the KB API
- Write `CLAUDE.md` for project context

### Phase 5 — Hardening (ongoing)
- Add WAF rules
- Set up CloudWatch dashboards + alarms
- Enable RDS Multi-AZ
- Add automated backups test (restore drill)

---

## 10. Cost Estimate (small team, under 50 users)

| Service | Estimated Monthly Cost |
|---|---|
| EC2 t3.small | ~$17 |
| RDS db.t3.micro (PostgreSQL) | ~$15 |
| ElastiCache cache.t3.micro | ~$12 |
| S3 + CloudFront (low traffic) | ~$5 |
| ALB | ~$18 |
| ECR storage | ~$1 |
| Route 53 | ~$1 |
| Secrets Manager | ~$1 |
| **Total** | **~$70/month** |

Reserve instances (1-year) would reduce this by ~30%.

---

## 11. What to Revisit as the System Grows

- **EC2 → ECS Fargate** when you need zero-downtime rolling deploys or want to scale the backend independently of the frontend.
- **RDS → Aurora PostgreSQL** when you hit consistent load and need read replicas.
- **ElastiCache → larger node** if session/cache hit rate drops below 90%.
- **Add a vector DB** (e.g. pgvector extension on RDS, or Pinecone) for semantic AI search once keyword full-text search is insufficient.
- **Add Slack integration** (post article updates to channels, slash command to search KB) — the integration pattern is identical to JIRA/Salesforce above.
- **Multi-AZ RDS + EC2 Auto Scaling Group** when availability SLA matters.
