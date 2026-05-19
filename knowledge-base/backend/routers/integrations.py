"""
External integrations.

`/api/integrations/salesforce/case/{case_number}` fetches a single Salesforce case
(by CaseNumber, not the 15/18-char Id) and returns a normalised payload the
composer can drop directly into the Resolution textarea.

The endpoint degrades gracefully:
  • 200 → case data, with `resolution` populated
  • 404 → case number not found in Salesforce
  • 503 → Salesforce isn't configured (no credentials in settings/.env)
  • 502 → Salesforce responded with an error (auth failed, etc.)

Auth: either set SF_ACCESS_TOKEN + SF_INSTANCE_URL, or set SF_USERNAME,
SF_PASSWORD, SF_SECURITY_TOKEN and we'll do username-password OAuth on demand.
"""
from __future__ import annotations

import urllib.parse
import urllib.request
import urllib.error
import json
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel

from backend.config import get_settings


router = APIRouter(tags=["integrations"])
settings = get_settings()


# ── Response shape ────────────────────────────────────────────────────────────

class SFCasePreview(BaseModel):
    case_number: str
    subject: str = ""
    status: str = ""
    description: str = ""
    resolution: str = ""           # combined: latest comments if present, else case description
    comments: list[str] = []
    sf_id: Optional[str] = None
    instance_url: Optional[str] = None


# ── Auth helpers ──────────────────────────────────────────────────────────────

_token_cache: dict[str, str] = {"access_token": "", "instance_url": ""}


def _http_post(url: str, body: dict, headers: dict | None = None) -> tuple[int, bytes]:
    data = urllib.parse.urlencode(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _http_get(url: str, token: str) -> tuple[int, bytes]:
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _resolve_credentials() -> tuple[str, str]:
    """Return (access_token, instance_url) or raise HTTPException(503)."""
    # 1) Pre-set access token wins
    if settings.sf_access_token and settings.sf_instance_url:
        return settings.sf_access_token, settings.sf_instance_url.rstrip("/")

    # 2) Cached token from a prior username-password flow
    if _token_cache["access_token"] and _token_cache["instance_url"]:
        return _token_cache["access_token"], _token_cache["instance_url"]

    # 3) Username + password + security token → exchange for a token
    if settings.sf_username and settings.sf_password and settings.sf_security_token:
        status, raw = _http_post(
            "https://login.salesforce.com/services/oauth2/token",
            {
                "grant_type": "password",
                "client_id": "PlatformCLI",
                "username": settings.sf_username,
                "password": settings.sf_password + settings.sf_security_token,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if status != 200:
            raise HTTPException(status_code=502, detail=f"Salesforce auth failed: {raw[:300]!r}")
        payload = json.loads(raw)
        token = payload.get("access_token") or ""
        instance = (payload.get("instance_url") or "").rstrip("/")
        if not token or not instance:
            raise HTTPException(status_code=502, detail="Salesforce returned an empty token.")
        _token_cache["access_token"] = token
        _token_cache["instance_url"] = instance
        return token, instance

    raise HTTPException(
        status_code=503,
        detail=(
            "Salesforce is not configured. Set SF_ACCESS_TOKEN + SF_INSTANCE_URL "
            "(preferred) or SF_USERNAME + SF_PASSWORD + SF_SECURITY_TOKEN in the "
            "backend environment."
        ),
    )


# ── SOQL helpers ──────────────────────────────────────────────────────────────

def _query(token: str, instance: str, soql: str) -> dict:
    url = f"{instance}/services/data/{settings.sf_api_version}/query?q={urllib.parse.quote(soql)}"
    status, raw = _http_get(url, token)
    if status == 401:
        # Token expired — drop cache so the next request re-auths
        _token_cache["access_token"] = ""
        raise HTTPException(
            status_code=502, detail="Salesforce auth token expired. Retry the request."
        )
    if status >= 400:
        raise HTTPException(
            status_code=502, detail=f"Salesforce query failed ({status}): {raw[:300]!r}"
        )
    return json.loads(raw)


def _normalise_case_number(value: str) -> str:
    """Strip non-digits and zero-pad to 8 chars (Salesforce default)."""
    digits = re.sub(r"\D", "", value or "")
    if not digits:
        return value
    return digits.zfill(8)


def _strip_html(text: str) -> str:
    """Cheap HTML→text: collapse tags, preserve line breaks where useful."""
    if not text:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/salesforce/case/{case_number}", response_model=SFCasePreview)
def get_sf_case(case_number: str = Path(..., min_length=1, max_length=64)):
    token, instance = _resolve_credentials()
    normalised = _normalise_case_number(case_number)

    # Look up the case by CaseNumber.
    soql = (
        "SELECT Id, CaseNumber, Subject, Status, Description "
        "FROM Case "
        f"WHERE CaseNumber = '{normalised}' "
        "LIMIT 1"
    )
    result = _query(token, instance, soql)
    records = result.get("records") or []
    if not records:
        raise HTTPException(status_code=404, detail=f"Salesforce case {normalised} not found")

    case = records[0]
    sf_id = case.get("Id")

    # Pull the latest public case comments (most recent first)
    comments_q = _query(
        token, instance,
        f"SELECT CommentBody, CreatedDate FROM CaseComment "
        f"WHERE ParentId = '{sf_id}' AND IsPublished = TRUE "
        f"ORDER BY CreatedDate DESC LIMIT 5"
    )
    comments = [_strip_html(r.get("CommentBody") or "") for r in (comments_q.get("records") or [])]
    comments = [c for c in comments if c]

    # Stitch the resolution string the composer pastes into its textarea:
    # comments in chronological order so steps read top-to-bottom.
    resolution_parts = list(reversed(comments)) if comments else []
    if not resolution_parts and case.get("Description"):
        resolution_parts = [_strip_html(case["Description"])]
    resolution = "\n\n".join(p for p in resolution_parts if p).strip()

    return SFCasePreview(
        case_number=case.get("CaseNumber") or normalised,
        subject=case.get("Subject") or "",
        status=case.get("Status") or "",
        description=_strip_html(case.get("Description") or ""),
        resolution=resolution,
        comments=comments,
        sf_id=sf_id,
        instance_url=instance,
    )
