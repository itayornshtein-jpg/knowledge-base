# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage Dockerfile
#
# Stages:
#   backend  — Python + FastAPI only (used by docker-compose for local dev)
#   frontend — Node build of the React app
#   prod     — Final production image: Python serving the React static build
#
# Local dev:   docker-compose up --build
# Production:  docker build -t kb-app . && docker run -p 8000:8000 kb-app
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: React build ──────────────────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app

COPY package*.json ./
RUN npm ci --silent

COPY public/ ./public/
COPY src/ ./src/
RUN npm run build
# Output: /app/build/


# ── Stage 2: Python backend (also used standalone by docker-compose) ──────────
FROM python:3.12-slim AS backend
WORKDIR /app

# System deps for psycopg2-binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]


# ── Stage 3: Production image (backend + React static files) ─────────────────
FROM backend AS prod

# Copy the React build into /app/static so FastAPI can serve it
COPY --from=frontend /app/build ./static/

# Bake in the git SHA for traceability (passed as build-arg from CI)
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
