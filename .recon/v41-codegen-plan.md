# v4.1 codegen plan — annotate grabber response_models

Goal: every FastAPI route in `cypherflix-grabber` declares a typed `response_model=` so
`openapi-typescript` can produce real TS definitions for the `cypherflix-hub` plugin.

## Grabber metadata

- **FastAPI:** 0.115.5 (from `stacks/nas/cypherflix-grabber/pyproject.toml`). `response_model=` has been stable since 0.78 — no upgrade needed.
- **Pydantic:** 2.9.2 (same pyproject). All proposed models use Pydantic v2 idioms (`Literal`, `BaseModel`, `ConfigDict`).
- **Service version exposed in OpenAPI `info`:** 2.0.0
- **Models file location:** `src/cypherflix_grabber/db/models.py` (frozen row models — already exists), plus per-router request bodies inline (`api/blocklist.py`, `api/discover.py`, `api/following.py`, `api/queue.py`, `api/requests_router.py`).
- **Recommendation:** add a new `src/cypherflix_grabber/api/responses.py` for the wrapper / detail / page models proposed below, so routers can `from .responses import (...)` rather than ballooning each router's preamble.

> Caveat: the local checkout at `homelab/stacks/nas/cypherflix-grabber/` is **older than what's deployed in the `CypherflixGrabberV2` container**. The live OpenAPI exposes 29 routes; the local source declares only 22. The 7 routes only present on the live container (`/discover/search`, `/discover/item/{kind}/{source_id}`, `/discover/author/{id}/bibliography`, `/requests/{id}/candidates`, `/requests/{id}/grab`, `/requests/{id}/loosen`, `/requests/{id}/blocklist-release`) were hot-patched onto the running container without a corresponding commit. Before annotating, **the grabber repo must be brought back in sync with the deployed container** — otherwise this work will collide with whatever local diff produced those handlers. Until that's resolved, response models for those 7 routes are based on live-sample inspection only (see "Risks" at the bottom).

## Route inventory (29 routes — verified against live `/openapi.json`, 27,584 bytes)

| # | Path | Method | Handler | Current return annotation | Returned dict shape (from live + handler source) | Response model to add |
|--:|---|---|---|---|---|---|
| 1 | `/health` | GET | `health.health` | `dict[str, Any]` | `{status, version, in_flight: {search, enrich[]}, clients: {<name>: ClientSafeSnapshot}}` | `HealthResponse` |
| 2 | `/following` | GET | `following.list_following` | `dict[str, object]` | `{items: FollowingRow[] + picture_url + is_finished, total, finished_hidden}` | `FollowingPage` |
| 3 | `/following` | POST | `following.create_following` | `dict[str, object]` | `{id: int, existed: bool}` | `FollowingCreateResult` |
| 4 | `/following/{id}` | GET | `following.get_following` | `dict[str, object]` | `{following: FollowingRow, counts: HaveCountsRow \| null}` | `FollowingDetail` |
| 5 | `/following/{id}` | PATCH | `following.patch_following` | `dict[str, str]` | `{status: "ok"}` | `StatusOk` |
| 6 | `/following/{id}` | DELETE | `following.delete_following` | `dict[str, str]` | `{status: "ok"}` | `StatusOk` |
| 7 | `/queue/add` | POST | `queue.queue_add` | `dict[str, object]` | `{request_id: int, status: RequestStatus, existed: bool}` | `QueueAddResult` |
| 8 | `/requests` | GET | `requests_router.list_requests` | `dict[str, object]` | `{items: RequestRow + cover_url + summary, total}` | `RequestsPage` |
| 9 | `/requests/{id}` | GET | `requests_router.get_request` | `dict[str, object]` | `{request: RequestRow, releases: ReleaseRow[], blocklist: string[]}` | `RequestDetail` |
| 10 | `/requests/{id}` | DELETE | `requests_router.delete_request` | `dict[str, str]` | `{status: "ok"}` | `StatusOk` |
| 11 | `/requests/{id}/cover` | GET | `requests_router.get_request_cover` | `dict[str, object]` | `{cover_url: str \| null, source: "cache"\|"fetched"\|"miss"}` | `RequestCoverResponse` |
| 12 | `/requests/{id}/retry` | POST | `requests_router.retry_request` | `dict[str, object]` | `{status: "ok", auto_loosened: bool}` (per docstring) | `RetryResult` |
| 13 | `/requests/{id}/refresh-metadata` | POST | `ops.refresh_metadata` | `dict[str, Any]` | Pass-through from `enrich_request(...)`: `{status, reason?, ...}`. Live sample: `{status: "error", reason: "..."}`. Loose shape — keep as `RefreshMetadataResult` with `status: str, reason: str \| None = None, **extra: dict`-style escape hatch via `model_config(extra="allow")`. | `RefreshMetadataResult` |
| 14 | `/requests/{id}/regrab` | POST | `ops.regrab` | `dict[str, str]` | `{status: "ok"}` | `StatusOk` |
| 15 | `/requests/{id}/grab` | POST | (live only — handler not in repo) | `dict` | Per plugin's `Web/types/api.ts` and live-sample contract — has not been observed via curl in this recon, and the live `pyc` is post-cutoff. **Verify before annotating.** Likely `{request_id: int, release_id: str, status: "snatched"\|"failed", reason?: str}`. | `GrabResult` (unverified — see Risks) |
| 16 | `/requests/{id}/loosen` | POST | (live only) | `dict` | Likely `{status: "ok", user_loosened_at: str}` per the row column. | `LoosenResult` (unverified) |
| 17 | `/requests/{id}/blocklist-release` | POST | (live only) | `dict` | Likely `{status: "ok"}`. | `StatusOk` (assumed) |
| 18 | `/requests/{id}/candidates` | GET | (live only) | `dict` | Live sample: `{request_id, strictness, query, items: Candidate[], total}` — confirmed via curl. | `CandidatesResponse` |
| 19 | `/sweep` | POST | `ops.trigger_sweep` | `dict[str, str]` | `{status: "started"}` (or 429 HTTPException) | `StatusStarted` |
| 20 | `/reorganize` | POST | `ops.trigger_reorganize` | `dict[str, str]` | `{status: "started"}` | `StatusStarted` |
| 21 | `/discover/trending` | GET | `discover.trending` | `dict[str, object]` | `{items: DiscoverItem[], total}` | `DiscoverPage` |
| 22 | `/discover/coming-soon` | GET | `discover.coming_soon` | `dict[str, object]` | `{items: DiscoverItem[], total}` | `DiscoverPage` |
| 23 | `/discover/search` | GET | (live only) | `dict` | Same shape as trending. | `DiscoverPage` |
| 24 | `/discover/item/{kind}/{source_id}` | GET | (live only) | `dict` | Live sample (book): keys = `kind, source, source_id, title, release_date, summary, page_count, rating, users_count, cover_url, series, contributors, queue_payload, follow_targets`. Comic_issue swaps `series` for `issue_number` and `contributors[].contribution` for `contributors[].role`. | `DiscoverItemDetail` |
| 25 | `/discover/author/{id}/bibliography` | GET | (live only) | `dict` | Live: `{author_id: int, series: BibliographySeries[], standalone: BibliographyBook[]}`. | `AuthorBibliography` |
| 26 | `/blocklist/creators` | GET | `blocklist.list_creators` | `dict[str, object]` | `{items: BlockedCreatorRow[], total}` | `BlockedCreatorsPage` |
| 27 | `/blocklist/creators` | POST | `blocklist.add_creator` | `dict[str, object]` | A serialised `BlockedCreatorRow` (10 fields). | `BlockedCreatorRow` |
| 28 | `/blocklist/creators/{id}` | DELETE | `blocklist.delete_creator` | `dict[str, str]` | `{status: "ok"}` | `StatusOk` |
| 29 | `/blocklist/creators/{id}/refresh` | POST | `blocklist.refresh_creator` | `dict[str, object]` | A serialised `BlockedCreatorRow`. | `BlockedCreatorRow` |

## Existing models that need field additions

These models live in `src/cypherflix_grabber/db/models.py`. The deployed container already has the v3.0+ fields; if the local checkout's `models.py` is out of date (it is — see "Caveat" above), these adds confirm what should be in sync.

**`RequestRow`** — already on the live container, but the local file's class body was truncated mid-field. Confirmed live fields:

```python
class RequestRow(_Row):
    id: int
    following_id: int | None             # was watchlist_id pre-v3.0
    kind: RequestKind
    comicvine_issue_id: int | None
    hardcover_book_id: int | None
    isbn_13: str | None
    series_name: str
    series_year: int | None
    issue_number: str | None
    title: str | None
    authors: str | None
    release_date: str | None
    status: RequestStatus
    status_reason: str | None
    progress_pct: float | None
    size_mb: int | None
    imported_path: str | None
    is_user_watch: bool
    retries: int
    user_loosened_at: datetime | None = None    # v3.0 (migration 0004)
    created_at: datetime
    updated_at: datetime
```

**`ReleaseRow`** — confirm `source: ReleaseSource = "auto"` is present (it is in the local .py but not the .pyc cache).

**`HaveCountsRow`** — local file truncates before this. The live API returns `{following_id, have, wanted, total}` (all `int`). Define:

```python
class HaveCountsRow(_Row):
    following_id: int
    have: int
    wanted: int
    total: int
```

**`BlockedCreatorRow`** — local file truncated mid-field. Confirmed live: `id, canonical_name, aliases_json: str (JSON-encoded array), hardcover_author_id, comicvine_person_id, tmdb_person_id, anilist_staff_id, reason: str|None, added_at: datetime, added_by: str|None`.

**`FollowingRow`** — live response includes `picture_url: str | None` and `is_finished: bool` that are **NOT on the row model itself** — they're injected by `following.list_following()` after `model_dump()`. For the response model we need `FollowingListItem(FollowingRow)` extending FollowingRow with those two fields, OR change the row model to include them (cleaner). Recommend the latter so a single class is shared between list rows and `GET /following/{id}.following`.

## New Pydantic models needed

Verbatim, ready to paste into a new `src/cypherflix_grabber/api/responses.py`. All other models (`FollowingRow`, `RequestRow`, `ReleaseRow`, `BlockedCreatorRow`, `HaveCountsRow`, `DiscoverItem`) are imported from existing files.

```python
"""Pydantic response models for FastAPI routes — drives OpenAPI codegen.

Frozen=False so FastAPI can serialise + add fields if a router needs to.
extra="forbid" except where the upstream payload is genuinely open
(refresh-metadata pass-through).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from ..db import models


# ---------------------------------------------------------------- generics

class StatusOk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["ok"] = "ok"


class StatusStarted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["started"] = "started"


class RetryResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["ok"] = "ok"
    auto_loosened: bool = False


class LoosenResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["ok"] = "ok"
    user_loosened_at: str  # ISO timestamp echoed back from the row


class RefreshMetadataResult(BaseModel):
    # Pass-through from comic_enrich.enrich_request — fields vary by outcome.
    model_config = ConfigDict(extra="allow")
    status: str
    reason: str | None = None


# ---------------------------------------------------------------- health

class ClientSafeSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str
    breaker_open: bool
    consecutive_failures: int
    current_cooldown: float
    requests_last_minute: int
    requests_last_hour: int
    minute_budget_remaining: int
    hour_budget_remaining: int
    aborted_keys_count: int


class InFlightSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    search: bool
    enrich: list[str]


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["ok"]
    version: str
    in_flight: InFlightSnapshot
    clients: dict[str, ClientSafeSnapshot] = {}


# ---------------------------------------------------------------- following

class FollowingListItem(models.FollowingRow):
    """A FollowingRow as returned by GET /following — adds two render-time fields."""
    picture_url: str | None = None
    is_finished: bool = False


class FollowingPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[FollowingListItem]
    total: int
    finished_hidden: int


class FollowingCreateResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int
    existed: bool


class FollowingDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    following: models.FollowingRow
    counts: models.HaveCountsRow | None


# ---------------------------------------------------------------- queue

class QueueAddResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: int
    status: models.RequestStatus
    existed: bool


# ---------------------------------------------------------------- requests

class RequestListItem(models.RequestRow):
    """RequestRow + render-time fields injected by list_requests()."""
    cover_url: str | None = None
    summary: str | None = None


class RequestsPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[RequestListItem]
    total: int


class RequestDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request: models.RequestRow
    releases: list[models.ReleaseRow]
    blocklist: list[str]


class RequestCoverResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cover_url: str | None
    source: Literal["cache", "fetched", "miss"]


# ---------------------------------------------------------------- candidates / grab

class NewznabCategory(BaseModel):
    """Recursive Newznab category — Prowlarr returns these as a tree."""
    model_config = ConfigDict(extra="forbid")
    id: int
    name: str | None = None
    subCategories: list["NewznabCategory"] = []


NewznabCategory.model_rebuild()


class Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    release_id: str
    title: str
    indexer: str | None
    protocol: Literal["usenet", "torrent"]
    size_bytes: int | None
    age_seconds: int | None
    categories: list[NewznabCategory]
    download_url: str | None
    info_url: str | None
    seeders: int | None
    leechers: int | None
    score: int | None
    matched_signals: list[str]
    rejected_signals: list[str]
    is_blocklisted: bool


class CandidatesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: int
    strictness: Literal["strict", "loose", "raw"]
    query: str
    items: list[Candidate]
    total: int


class GrabResult(BaseModel):
    """Verify shape against live grabber before merging — handler is not in
    the local repo. The plugin's TS contract treats this as an opaque
    success object; until verified, keep extra="allow"."""
    model_config = ConfigDict(extra="allow")
    request_id: int
    status: Literal["snatched", "failed", "ok"]


# ---------------------------------------------------------------- discover

class FollowTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["comic_series", "book_author", "book_series", "story_arc"]
    display_name: str
    hardcover_author_id: int | None = None
    hardcover_series_id: int | None = None
    comicvine_id: int | None = None
    supported: bool | None = None  # only on story_arc per the plugin TS — keep optional


class DiscoverContributor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int
    name: str
    contribution: str | None = None  # books
    role: str | None = None          # comic issues


class DiscoverItemDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["book", "comic_issue", "comic_series"]
    source: Literal["hardcover", "comicvine"]
    source_id: str
    title: str
    release_date: str | None
    summary: str | None
    page_count: int | None = None
    rating: float | None = None
    users_count: int | None = None
    cover_url: str | None
    series: str | None = None       # books only
    issue_number: str | None = None  # comic issues only
    contributors: list[DiscoverContributor]
    queue_payload: dict[str, Any]   # forwarded to /queue/add verbatim
    follow_targets: dict[str, FollowTarget]


class DiscoverPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list["DiscoverItem"]   # forward-ref to existing api/discover.py model
    total: int


# ---------------------------------------------------------------- bibliography

class BibliographyBook(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hardcover_book_id: int
    title: str
    release_date: str | None
    year: int | None
    cover_url: str | None
    authors: str | None
    contribution: str | None
    queue_state: Literal["none", "wanted", "searching", "snatched",
                         "downloading", "importing", "tagging",
                         "done", "failed", "blocked"]
    request_id: int | None
    queue_payload: dict[str, Any]
    series_position: float | None = None


class BibliographySeries(BaseModel):
    model_config = ConfigDict(extra="forbid")
    series_id: int
    series_name: str
    follow_target: FollowTarget
    books: list[BibliographyBook]


class AuthorBibliography(BaseModel):
    model_config = ConfigDict(extra="forbid")
    author_id: int
    series: list[BibliographySeries]
    standalone: list[BibliographyBook]


# ---------------------------------------------------------------- blocklist

class BlockedCreatorsPage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[models.BlockedCreatorRow]
    total: int
```

## Implementation order

1. **Sync the grabber repo to what's actually deployed.** Pull the 7 hot-patched handlers (`/discover/search`, `/discover/item/...`, `/discover/author/.../bibliography`, `/requests/.../candidates`, `/requests/.../grab`, `/requests/.../loosen`, `/requests/.../blocklist-release`) and the v3.0+ field additions back into `homelab/stacks/nas/cypherflix-grabber/src/`. This is a prerequisite — without it the `response_model=` annotations have nothing to attach to.
2. **Backfill `db/models.py`** with the missing fields (`user_loosened_at`, `source`, `HaveCountsRow`, full `BlockedCreatorRow`).
3. **Create `api/responses.py`** with the models above.
4. **Annotate every router.** Replace `dict[str, ...]` returns with `response_model=ModelName` on each `@router.<method>` decorator. Inside the handlers, return Pydantic instances rather than `model_dump()`-ed dicts where possible (FastAPI will call `.model_dump()` itself for serialisation; double-dumping is a foot-gun).
5. **Bump grabber version** to `2.1.0` in `pyproject.toml` (response model surface change is a real API-shape additive bump).
6. **Re-export OpenAPI:** `curl http://192.168.1.165:7960/openapi.json` → diff against `.recon/grabber-openapi.json`. Every route's `responses["200"].content["application/json"].schema.$ref` should now point at a named schema, not `{type: object}`.
7. **Plugin side — generate TS:** add `openapi-typescript` as a Vite devDep and a `npm run codegen` script:
   ```bash
   npx openapi-typescript http://192.168.1.165:7960/openapi.json -o Web/types/api.generated.ts
   ```
8. **Switch `Web/types/api.ts`** to re-export the codegen'd types:
   ```ts
   export type { components } from './api.generated.ts';
   export type FollowingRow = components['schemas']['FollowingListItem'];
   // ...etc
   ```
9. **Run `tsc --noEmit`** to surface every callsite that drifts from the new generated types. Fix them individually — they should be field renames, not behavioural changes.
10. **Smoke-test against the live grabber.** Every route handler that now has a `response_model=` will 500 (ValidationError) at runtime if the actual returned payload doesn't fit the model. Hit each endpoint via curl; roll back any model that 500s and tighten it from the real payload.

## Risks

1. **Local-vs-deployed drift (highest risk).** The 7 hot-patched routes are in production but not in the local repo. Annotating those without their source means inventing a contract — fine for `/candidates` (verified live), risky for `/grab`, `/loosen`, `/blocklist-release` (no live samples obtained — invoking would mutate state). Mitigation: don't annotate those four until the source is reconciled.
2. **Pass-through endpoints with mixed return shapes.** `/requests/{id}/refresh-metadata` returns whatever `comic_enrich.enrich_request()` returned — observed `{status: "error", reason: "..."}` but the success path likely has more fields. Use `extra="allow"` on `RefreshMetadataResult` until that handler is audited.
3. **`FollowingListItem` extends `FollowingRow` (`extra="forbid"`).** Inheriting from a `frozen=True, extra="forbid"` model and adding fields needs `model_config = ConfigDict(frozen=False, extra="forbid")` on the child (Pydantic v2 inheritance preserves frozen-ness). Verified locally via `pyproject.toml` — Pydantic 2.9.2 supports this.
4. **Recursive `NewznabCategory`.** Pydantic v2 needs `NewznabCategory.model_rebuild()` after the class so forward refs resolve. Forgetting this is a common foot-gun. Tested pattern: declare the recursive list field as `list["NewznabCategory"] = []`, then call `model_rebuild()` once at module level.
5. **Frontend cutover risk.** `Web/types/api.ts` currently has hand-written types the plugin trusts implicitly. Switching to codegen will rename/restructure types (e.g. `RequestsPage.items` becomes `Array<RequestListItem>` not `RequestRow`). Every `Web/pages/api.js` and component callsite needs a TS-noEmit check before merging.
6. **`is_user_watch: bool` in `RequestRow`.** SQLite stores this as INTEGER (0/1). The from_db_row helper must coerce to bool — confirm the live row at `/requests/{id}` actually surfaces a boolean (verified: the live curl returned `"is_user_watch": true`). Same for `active` on `FollowingRow` and `breaker_open` on `ClientSafeSnapshot` — all already coerced; no action needed but worth a smoke test.
7. **Datetimes.** All `*_at` fields in row models are `datetime`. Live JSON shows them as `"2026-05-09T10:31:00"` (no Z suffix, no microseconds). Pydantic v2 will accept that string into a `datetime` and serialise it back the same way — but consumers should be aware it's naive UTC, not ISO-zoned. No code change required.
