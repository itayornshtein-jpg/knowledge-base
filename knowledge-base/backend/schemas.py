from __future__ import annotations
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ── Categories ────────────────────────────────────────────────────────────────

class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")
    description: str = ""


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    description: Optional[str] = None


class CategoryOut(CategoryBase):
    id: UUID
    slug: str
    created_at: datetime
    article_count: int = 0

    model_config = {"from_attributes": True}


# ── Articles ──────────────────────────────────────────────────────────────────

class ArticleBase(BaseModel):
    summary: str = Field(..., min_length=1, max_length=500)
    sf_case: str = Field(..., min_length=1, max_length=100)
    jira_link: str = ""
    description: str = Field(default="")
    solution: str = Field(default="")
    related_page_ids: list[str] = []
    images: list[str] = []
    category_id: Optional[UUID] = None

    @field_validator("related_page_ids")
    @classmethod
    def dedupe_related(cls, v):
        seen = set()
        return [x for x in v if x and not (x in seen or seen.add(x))]

    @field_validator("images")
    @classmethod
    def filter_empty_images(cls, v):
        return [x for x in v if x]


class ArticleCreate(ArticleBase):
    pass


class ArticleUpdate(BaseModel):
    summary: Optional[str] = Field(None, min_length=1, max_length=500)
    sf_case: Optional[str] = Field(None, min_length=1)
    jira_link: Optional[str] = None
    description: Optional[str] = None
    solution: Optional[str] = None
    related_page_ids: Optional[list[str]] = None
    images: Optional[list[str]] = None
    category_id: Optional[UUID] = None


class CategoryMini(BaseModel):
    id: UUID
    name: str
    color: str
    slug: str

    model_config = {"from_attributes": True}


class ArticleOut(ArticleBase):
    id: str
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    category: Optional[CategoryMini] = None

    model_config = {"from_attributes": True}


# ── Search / Stats ────────────────────────────────────────────────────────────

class SearchResult(BaseModel):
    articles: list[ArticleOut]
    total: int
    query: str


class Stats(BaseModel):
    active: int
    archived: int
    total: int
    categories: int


# ── Assistant ─────────────────────────────────────────────────────────────────

class AssistantRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)


class AssistantResponse(BaseModel):
    answer: str
    sources: list[str] = []   # article IDs used as context
