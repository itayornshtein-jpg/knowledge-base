from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Column, String, Text, DateTime, ForeignKey, Boolean, Index, Integer, func
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.orm import relationship

from backend.database import Base


def _now():
    return datetime.now(timezone.utc)


class Category(Base):
    __tablename__ = "categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(100), nullable=False)
    slug = Column(String(120), unique=True, nullable=False)
    color = Column(String(7), default="#6366f1")   # hex color for UI badges
    description = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=_now)

    articles = relationship("Article", back_populates="category")

    def __repr__(self):
        return f"<Category {self.name}>"


class Article(Base):
    """
    Matches the existing db.json shape so the React front-end needs minimal changes.
    New fields (category_id) are nullable so migrated articles remain valid.
    """
    __tablename__ = "articles"

    # Keep the existing page_xxx ID format for drop-in compatibility
    id = Column(String(64), primary_key=True, default=lambda: f"page_{uuid4().hex[:12]}")

    summary = Column(String(500), nullable=False)
    sf_case = Column(String(100), nullable=False)
    jira_link = Column(Text, default="")
    description = Column(Text, nullable=False, default="")
    solution = Column(Text, nullable=False, default="")

    # PostgreSQL native arrays — store related article IDs and base64 images
    related_page_ids = Column(ARRAY(Text), default=list, nullable=False)
    images = Column(ARRAY(Text), default=list, nullable=False)

    # Soft delete (archive)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    # Category (optional — null means "uncategorised")
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    category = relationship("Category", back_populates="articles")

    # Engagement
    is_starred = Column(Boolean, nullable=False, default=False, server_default="false")
    view_count = Column(Integer, nullable=False, default=0, server_default="0")

    # Audit timestamps
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)

    # Functional indexes on lowercased text columns —
    # matches the LIKE-based search in routers/knowledge.py.
    # For very large datasets, replace with a pg_trgm GIN index.
    __table_args__ = (
        Index("ix_article_summary_lower", func.lower(summary)),
        Index("ix_article_sf_case_lower", func.lower(sf_case)),
        Index("ix_article_description_lower", func.lower(description)),
        Index("ix_article_solution_lower", func.lower(solution)),
        Index("ix_article_deleted_at", deleted_at),
        Index("ix_article_category_id", category_id),
        Index("ix_article_created_at", created_at.desc()),
        Index("ix_article_is_starred", is_starred),
        Index("ix_article_view_count", view_count.desc()),
    )

    def __repr__(self):
        return f"<Article {self.id}: {self.summary[:40]}>"
