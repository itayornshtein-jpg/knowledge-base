"""
/api/knowledge  —  drop-in replacement for the Flask routes.

Kept the same URL shape (/api/knowledge, /api/knowledge/<id>/archive …)
so the React frontend needs zero changes to its fetch calls.
"""
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.deps import get_current_user
from backend.models import Article
from backend.schemas import ArticleCreate, ArticleOut, ArticleUpdate, Stats

router = APIRouter(tags=["knowledge"])


def _now():
    return datetime.now(timezone.utc)


def _article_or_404(db: Session, article_id: str) -> Article:
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    return article


# ── GET /api/knowledge ────────────────────────────────────────────────────────

@router.get("", response_model=list[ArticleOut])
def list_articles(
    view: Literal["active", "archived", "all"] = Query("active"),
    search: Optional[str] = Query(None),
    category_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Article)

    # Filter by archive state
    if view == "active":
        q = q.filter(Article.deleted_at.is_(None))
    elif view == "archived":
        q = q.filter(Article.deleted_at.isnot(None))
    # "all" → no filter

    # Filter by category
    if category_id:
        q = q.filter(Article.category_id == category_id)

    # Full-text search across summary, sf_case, description, solution
    if search:
        term = f"%{search.lower()}%"
        q = q.filter(
            or_(
                func.lower(Article.summary).like(term),
                func.lower(Article.sf_case).like(term),
                func.lower(Article.description).like(term),
                func.lower(Article.solution).like(term),
                func.lower(Article.jira_link).like(term),
            )
        )

    return q.order_by(Article.created_at.desc()).all()


# ── GET /api/knowledge/stats ──────────────────────────────────────────────────

@router.get("/stats", response_model=Stats)
def get_stats(db: Session = Depends(get_db)):
    from backend.models import Category
    active = db.query(Article).filter(Article.deleted_at.is_(None)).count()
    archived = db.query(Article).filter(Article.deleted_at.isnot(None)).count()
    cats = db.query(Category).count()
    return Stats(active=active, archived=archived, total=active + archived, categories=cats)


# ── GET /api/knowledge/{id} ───────────────────────────────────────────────────

@router.get("/{article_id}", response_model=ArticleOut)
def get_article(article_id: str, db: Session = Depends(get_db)):
    return _article_or_404(db, article_id)


# ── POST /api/knowledge ───────────────────────────────────────────────────────

@router.post("", response_model=ArticleOut, status_code=status.HTTP_201_CREATED)
def create_article(
    payload: ArticleCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    article = Article(**payload.model_dump())
    db.add(article)
    db.commit()
    db.refresh(article)
    return article


# ── PUT /api/knowledge/{id} ───────────────────────────────────────────────────

@router.put("/{article_id}", response_model=ArticleOut)
def update_article(
    article_id: str,
    payload: ArticleUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    article = _article_or_404(db, article_id)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(article, field, value)
    article.updated_at = _now()
    db.commit()
    db.refresh(article)
    return article


# ── POST /api/knowledge/{id}/archive ─────────────────────────────────────────

@router.post("/{article_id}/archive", response_model=ArticleOut)
def archive_article(
    article_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    article = _article_or_404(db, article_id)
    if article.deleted_at:
        raise HTTPException(status_code=400, detail="Article is already archived")
    article.deleted_at = _now()
    db.commit()
    db.refresh(article)
    return article


# ── POST /api/knowledge/{id}/restore ─────────────────────────────────────────

@router.post("/{article_id}/restore", response_model=ArticleOut)
def restore_article(
    article_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    article = _article_or_404(db, article_id)
    if not article.deleted_at:
        raise HTTPException(status_code=400, detail="Article is not archived")
    article.deleted_at = None
    db.commit()
    db.refresh(article)
    return article


# ── DELETE /api/knowledge/{id} (hard delete) ──────────────────────────────────

@router.delete("/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_article(
    article_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    article = _article_or_404(db, article_id)
    db.delete(article)
    db.commit()
