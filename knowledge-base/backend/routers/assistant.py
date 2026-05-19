"""
AI assistant endpoint.

Priority order for LLM:
  1. Anthropic (Claude) — if ANTHROPIC_API_KEY is set
  2. OpenAI             — if OPENAI_API_KEY is set  (keeps compatibility with existing app)
  3. Fallback           — keyword search only, no LLM
"""
import json
from typing import Iterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.database import get_db
from backend.models import Article
from backend.schemas import AssistantRequest, AssistantResponse

router = APIRouter(tags=["assistant"])
settings = get_settings()

MAX_CONTEXT_ARTICLES = 5
MAX_CONTENT_CHARS = 800  # chars per article to keep prompt concise


def _find_relevant_articles(db: Session, query: str) -> list[Article]:
    """Simple keyword search to find articles relevant to the question."""
    terms = [t.strip() for t in query.lower().split() if len(t.strip()) > 2]
    if not terms:
        return []

    conditions = []
    for term in terms[:5]:  # cap at 5 terms
        like = f"%{term}%"
        conditions.append(func.lower(Article.summary).like(like))
        conditions.append(func.lower(Article.description).like(like))
        conditions.append(func.lower(Article.solution).like(like))

    return (
        db.query(Article)
        .filter(Article.deleted_at.is_(None), or_(*conditions))
        .limit(MAX_CONTEXT_ARTICLES)
        .all()
    )


def _build_context(articles: list[Article]) -> str:
    if not articles:
        return "No relevant knowledge base articles found."
    parts = []
    for a in articles:
        content = f"[{a.id}] {a.summary}\n"
        if a.description:
            content += f"Issue: {a.description[:MAX_CONTENT_CHARS]}\n"
        if a.solution:
            content += f"Solution: {a.solution[:MAX_CONTENT_CHARS]}\n"
        if a.sf_case:
            content += f"SF Case: {a.sf_case}\n"
        parts.append(content)
    return "\n---\n".join(parts)


def _call_claude(question: str, context: str) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        system=(
            "You are a helpful support engineer assistant. "
            "Answer the question using ONLY the knowledge base articles provided. "
            "If the answer isn't in the articles, say so clearly. "
            "Be concise and practical. Reference the article ID when relevant."
        ),
        messages=[
            {
                "role": "user",
                "content": f"Knowledge base articles:\n{context}\n\nQuestion: {question}",
            }
        ],
    )
    return msg.content[0].text


def _call_openai(question: str, context: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a helpful support engineer assistant. "
                    "Answer using ONLY the knowledge base articles provided. "
                    "If the answer isn't there, say so clearly."
                ),
            },
            {
                "role": "user",
                "content": f"Knowledge base articles:\n{context}\n\nQuestion: {question}",
            },
        ],
        max_tokens=1024,
    )
    return response.choices[0].message.content


@router.post("", response_model=AssistantResponse)
def ask_assistant(payload: AssistantRequest, db: Session = Depends(get_db)):
    articles = _find_relevant_articles(db, payload.question)
    context = _build_context(articles)
    source_ids = [a.id for a in articles]

    # Choose LLM based on available keys
    if settings.anthropic_api_key:
        try:
            answer = _call_claude(payload.question, context)
            return AssistantResponse(answer=answer, sources=source_ids)
        except Exception as e:
            if not settings.openai_api_key:
                raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    if settings.openai_api_key:
        try:
            answer = _call_openai(payload.question, context)
            return AssistantResponse(answer=answer, sources=source_ids)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    # No LLM configured — return keyword search results as plain text
    if not articles:
        answer = "No relevant articles found for your question. Try different keywords."
    else:
        lines = [f"• [{a.sf_case}] {a.summary}" for a in articles]
        answer = "Related articles (no AI key configured):\n" + "\n".join(lines)

    return AssistantResponse(answer=answer, sources=source_ids)


# ── Streaming variants ────────────────────────────────────────────────────────

def _stream_claude(question: str, context: str) -> Iterator[str]:
    import anthropic
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    with client.messages.stream(
        model="claude-opus-4-6",
        max_tokens=1024,
        system=(
            "You are a helpful support engineer assistant. "
            "Answer the question using ONLY the knowledge base articles provided. "
            "If the answer isn't in the articles, say so clearly. "
            "Be concise and practical. Reference the article ID when relevant."
        ),
        messages=[
            {
                "role": "user",
                "content": f"Knowledge base articles:\n{context}\n\nQuestion: {question}",
            }
        ],
    ) as stream:
        for text in stream.text_stream:
            if text:
                yield text


def _stream_openai(question: str, context: str) -> Iterator[str]:
    from openai import OpenAI
    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a helpful support engineer assistant. "
                    "Answer using ONLY the knowledge base articles provided. "
                    "If the answer isn't there, say so clearly."
                ),
            },
            {
                "role": "user",
                "content": f"Knowledge base articles:\n{context}\n\nQuestion: {question}",
            },
        ],
        max_tokens=1024,
        stream=True,
    )
    for chunk in response:
        try:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content
        except (IndexError, AttributeError):
            continue


def _sse(data: str, event: str | None = None) -> bytes:
    """Format a single Server-Sent Events frame."""
    out = ""
    if event:
        out += f"event: {event}\n"
    # SSE requires every newline in data to be its own `data:` line
    for line in data.split("\n"):
        out += f"data: {line}\n"
    out += "\n"
    return out.encode("utf-8")


@router.post("/stream")
def ask_assistant_stream(payload: AssistantRequest, db: Session = Depends(get_db)):
    """
    Server-Sent Events endpoint. Streams text deltas as `data: <chunk>` frames,
    then emits a final `event: sources\ndata: {ids:[...]}` frame and `event: done`.

    Falls back to the non-streaming flow when no LLM key is configured —
    a single `data: <answer>` frame followed by `sources` + `done`.
    """
    articles = _find_relevant_articles(db, payload.question)
    context = _build_context(articles)
    source_ids = [a.id for a in articles]

    def emit() -> Iterator[bytes]:
        try:
            if settings.anthropic_api_key:
                try:
                    for chunk in _stream_claude(payload.question, context):
                        yield _sse(chunk)
                    yield _sse(json.dumps({"ids": source_ids}), event="sources")
                    yield _sse("", event="done")
                    return
                except Exception as e:
                    if not settings.openai_api_key:
                        yield _sse(f"Assistant error: {e}", event="error")
                        return

            if settings.openai_api_key:
                try:
                    for chunk in _stream_openai(payload.question, context):
                        yield _sse(chunk)
                    yield _sse(json.dumps({"ids": source_ids}), event="sources")
                    yield _sse("", event="done")
                    return
                except Exception as e:
                    yield _sse(f"Assistant error: {e}", event="error")
                    return

            # No LLM key — emit the keyword-search fallback as a single frame
            if not articles:
                answer = "No relevant articles found for your question. Try different keywords."
            else:
                lines = [f"• [{a.sf_case}] {a.summary}" for a in articles]
                answer = "Related articles (no AI key configured):\n" + "\n".join(lines)
            yield _sse(answer)
            yield _sse(json.dumps({"ids": source_ids}), event="sources")
            yield _sse("", event="done")
        except Exception as e:  # noqa: BLE001
            yield _sse(f"Unexpected error: {e}", event="error")

    return StreamingResponse(
        emit(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable nginx buffering if present
            "Connection": "keep-alive",
        },
    )
