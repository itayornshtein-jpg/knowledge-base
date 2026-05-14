from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from backend.config import get_settings
from backend.database import create_tables
from backend.routers import knowledge, categories, assistant

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup tasks before accepting requests."""
    create_tables()
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routes ────────────────────────────────────────────────────────────────
app.include_router(knowledge.router,   prefix="/api/knowledge")
app.include_router(categories.router,  prefix="/api/categories")
app.include_router(assistant.router,   prefix="/api/assistant")


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


# ── Serve React build in production ──────────────────────────────────────────
# In development, React runs on port 3000 and proxies to here.
# In Docker/production, we serve the React build from /static.
_static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.isdir(_static_dir):
    app.mount("/static", StaticFiles(directory=_static_dir), name="static")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_react(full_path: str):
        """Catch-all: serve React's index.html for client-side routing."""
        index = os.path.join(_static_dir, "index.html")
        return FileResponse(index)
