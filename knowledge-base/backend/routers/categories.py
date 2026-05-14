from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.deps import get_current_user
from backend.models import Article, Category
from backend.schemas import CategoryCreate, CategoryOut, CategoryUpdate

router = APIRouter(tags=["categories"])


def _slugify(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    return slug.strip("-")


def _category_or_404(db: Session, category_id: UUID) -> Category:
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return cat


def _with_count(db: Session, category: Category) -> CategoryOut:
    count = (
        db.query(func.count(Article.id))
        .filter(Article.category_id == category.id, Article.deleted_at.is_(None))
        .scalar()
    ) or 0
    out = CategoryOut.model_validate(category)
    out.article_count = count
    return out


# ── GET /api/categories ───────────────────────────────────────────────────────

@router.get("", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    categories = db.query(Category).order_by(Category.name).all()
    return [_with_count(db, c) for c in categories]


# ── GET /api/categories/{id} ──────────────────────────────────────────────────

@router.get("/{category_id}", response_model=CategoryOut)
def get_category(category_id: UUID, db: Session = Depends(get_db)):
    cat = _category_or_404(db, category_id)
    return _with_count(db, cat)


# ── POST /api/categories ──────────────────────────────────────────────────────

@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    slug = _slugify(payload.name)
    # Make slug unique if it already exists
    existing = db.query(Category).filter(Category.slug == slug).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Category '{payload.name}' already exists")

    cat = Category(name=payload.name, slug=slug, color=payload.color, description=payload.description)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return _with_count(db, cat)


# ── PUT /api/categories/{id} ──────────────────────────────────────────────────

@router.put("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: UUID,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    cat = _category_or_404(db, category_id)
    if payload.name is not None:
        cat.name = payload.name
        cat.slug = _slugify(payload.name)
    if payload.color is not None:
        cat.color = payload.color
    if payload.description is not None:
        cat.description = payload.description
    db.commit()
    db.refresh(cat)
    return _with_count(db, cat)


# ── DELETE /api/categories/{id} ───────────────────────────────────────────────

@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    cat = _category_or_404(db, category_id)
    # Unlink articles before deleting
    db.query(Article).filter(Article.category_id == category_id).update({"category_id": None})
    db.delete(cat)
    db.commit()
