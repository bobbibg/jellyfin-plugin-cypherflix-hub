# Grabber OpenAPI ↔ Web/types/api.ts diff

## Live grabber

- Container: `CypherflixGrabberV2`
- External URL: `http://192.168.1.165:7960` (port 7960:7960 in `stacks/nas/docker-compose.yaml`)
- Auth: **None on `/openapi.json` and all `/api/v1/*` reads tested.** `CYPHERFLIX_API_TOKEN=` is set empty in compose; the C# proxy injects whatever the grabber expects, but live curl with no Authorization header succeeds for every endpoint. No bearer or token was needed for this recon.
- OpenAPI dump: `.recon/grabber-openapi.json` (27,584 bytes)
- API per `info`: `cypherflix-grabber` v`2.0.0`
- All paths are mounted under `/api/v1/*`. The plugin's `Web/pages/api.js` uses `/Cypherflix/api/*` (the C# reverse-proxy controller rewrites that to `/api/v1/*`). The path mapping is correct.

## Endpoint coverage

### Plugin uses (from `Web/pages/api.js`)

| Path | Method | Status | Notes |
|---|---|---|---|
| `/health` | GET | ✓ matches | Returns `{status, version, in_flight, clients}` (richer than implied) |
| `/following` | GET | ✓ matches | Plugin sends `?kind`. **OpenAPI also accepts `?include_finished=boolean`** — plugin ignores it, but `FollowingPage.finished_hidden` only ever > 0 if you don't pass `include_finished=true` |
| `/following/{id}` | GET | ✓ matches | |
| `/following` | POST | ✓ matches | Body schema = `FollowingCreate` |
| `/following/{id}` | PATCH | ✓ matches | Body schema = `FollowingPatch` (only `active` + `monitor_mode`) |
| `/following/{id}` | DELETE | ✓ matches | |
| `/queue/add` | POST | ✓ matches | Body schema = `QueueAdd` |
| `/requests` | GET | ✓ matches | Plugin sends arbitrary query params; OpenAPI declares `kind, status, following_id, watchlist_id, limit, offset` |
| `/requests/{id}` | GET | ✗ **shape mismatch** | Returns `{request: RequestRow, releases: ReleaseAttempt[]}`, NOT a flat RequestRow. Plugin's `getRequest()` would currently treat `r.request` as undefined |
| `/requests/{id}/cover` | GET | ✓ matches | Returns `{cover_url, source}` — plugin doesn't have a typed shape for this yet |
| `/requests/{id}/retry` | POST | ✓ matches | |
| `/requests/{id}/refresh-metadata` | POST | ✓ matches | |
| `/requests/{id}/regrab` | POST | ✓ matches | |
| `/requests/{id}` | DELETE | ✓ matches | |
| `/blocklist/creators` | GET | ✓ matches | Returns `{items: [...], total}` — plugin currently has no `BlockedCreatorsPage` type at all |
| `/blocklist/creators` | POST | ✓ matches | Body schema = `CreatorCreate` (canonical_name, aliases[], reason?, added_by?) |
| `/blocklist/creators/{id}` | DELETE | ✓ matches | |
| `/blocklist/creators/{id}/refresh` | POST | ✓ matches | |
| `/sweep` | POST | ✓ matches | Plugin sends no params; OpenAPI declares optional `?dry_run=bool&limit=int` |
| `/reorganize` | POST | ✓ matches | Plugin sends `?dry_run`; OpenAPI also declares optional `?limit=int` |
| `/discover/trending` | GET | ✗ **enum mismatch** | OpenAPI `kind` is **required** and enum is exactly `book \| comic` (NOT `book_author/book_series/comic_series/comic_issue/etc`). Plugin treats `kind` as optional and passes the wider DiscoverItemKind set — passing `comic_issue` will 422 |
| `/discover/coming-soon` | GET | ✓ matches | Optional `?limit`. Endpoint timed out during recon; not necessarily dead, just slow |
| `/discover/search` | GET | ✓ matches | `q` required; `kind`/`limit` optional |
| `/discover/item/{kind}/{source_id}` | GET | ✓ matches | `kind` enum exactly `book \| comic_issue \| comic_series` — same as TS `DiscoverItemDetail.kind` |
| `/discover/author/{id}/bibliography` | GET | ✓ matches | |
| `/requests/{id}/candidates` | GET | ✓ matches | Optional `?strictness=strict\|loose\|raw` |
| `/requests/{id}/grab` | POST | ✓ matches | Body schema = `GrabBody` |
| `/requests/{id}/loosen` | POST | ✓ matches | |

### OpenAPI has but plugin doesn't use

- **`POST /api/v1/requests/{id}/blocklist-release`** — body `BlocklistRelease { release_id: int (required), reason?: string|null }`. Adds an individual release ID (not creator) to the block list. Not exposed in current Candidates modal but probably wanted for v4.0+.

### OpenAPI uses query parameters the plugin doesn't pass

- `/requests` — `?watchlist_id` (legacy alias of `following_id`, still accepted)
- `/sweep` — `?dry_run`, `?limit`
- `/reorganize` — `?limit`
- `/following` — `?include_finished=true` (without it, finished comic series are hidden and counted in `finished_hidden`)

## Schema diff

> **Critical caveat:** the OpenAPI doc declares **request body** schemas (FollowingCreate, FollowingPatch, QueueAdd, GrabBody, BlocklistRelease, CreatorCreate) but **does NOT declare any response schemas** — every endpoint just declares its 200 response as bare `{type: "object"}`. The TS response shapes (`FollowingRow`, `RequestRow`, `DiscoverItem`, `DiscoverItemDetail`, `Candidate`, `AuthorBibliography`, `BibliographyBook`, etc.) cannot be validated against the schema; they must be validated against **live samples**. All "OpenAPI" rows below for response types are reconstructed from real curl responses.

### `FollowingKind`
- TS: `'comic_series' | 'book_author' | 'book_series'`
- OpenAPI (FollowingCreate.kind): `'comic_series' | 'book_author' | 'book_series'`
- **Diff: ✓ match**

### `RequestKind`
- TS: `'comic_issue' | 'book' | 'audiobook'`
- OpenAPI (QueueAdd.kind): `'comic_issue' | 'book' | 'audiobook'`
- **Diff: ✓ match**

### `RequestStatus`
- TS: `'wanted' | 'searching' | 'snatched' | 'downloading' | 'importing' | 'tagging' | 'done' | 'failed' | 'blocked'`
- OpenAPI: not declared as enum — plain `string` in query params
- Live samples seen so far: `wanted`, `done`. `searching`, `downloading` queries returned empty.
- **Diff: cannot validate from OpenAPI; TS is best-effort. Recommend grepping grabber Python source `request.py` enum to confirm.**

### `MonitorMode`
- TS: `'all' | 'new_only' | 'specific_volumes'`
- OpenAPI (FollowingCreate.monitor_mode default `all`): `'all' | 'new_only' | 'specific_volumes'`
- **Diff: ✓ match**

### `DiscoverItemKind`
- TS: `'book' | 'comic_issue' | 'comic_series'`
- OpenAPI: same enum on `/discover/item/{kind}/...`
- BUT: `/discover/trending?kind=...` enum is `'book' | 'comic'` — narrower
- **Diff: ✓ match for DiscoverItemKind, but plugin code that funnels DiscoverItemKind into trending will break — needs a separate `TrendingKind = 'book' | 'comic'` type**

### `DiscoverItemSource`
- TS: `'hardcover' | 'comicvine'`
- Live: confirmed both values appear
- **Diff: ✓ match**

### `FollowTarget`
- TS: `{kind, display_name, hardcover_author_id?, hardcover_series_id?, comicvine_id?}`
- Live (sample from `/discover/item/.../follow_targets`): same fields, all optional except `kind` and `display_name`
- **Diff: ✓ match. Note: `story_arc` follow_target carries `supported?: boolean` per TS; live API does not return story_arc in our samples — verify this still exists.**

### `DiscoverItem` (search/trending row)
- TS fields: `kind, source, source_id, title, series_name, issue_number, year, authors, release_date, cover_url, summary, watchlist_kind, watchlist_payload`
- Live: all 13 fields confirmed present
- **Diff: ✓ match**

### `DiscoverPage`
- TS: `{items: DiscoverItem[], total: number}`
- Live: `{items, total}` — confirmed
- **Diff: ✓ match**

### `FollowingRow`
- TS: `{id, kind, display_name, comicvine_id, hardcover_author_id, hardcover_series_id, monitor_mode, cutoff_year, added_at, added_by, active, picture_url?, is_finished?}`
- Live: all 13 fields present, including `picture_url: null` and `is_finished: false`
- **Diff: ✓ match**

### `FollowingPage`
- TS: `{items, total, finished_hidden}`
- Live: `{items, total, finished_hidden}` — confirmed
- **Diff: ✓ match**

### `QueueAddBody`
- TS: `{kind, series_name, title?, comicvine_issue_id?, hardcover_book_id?, isbn_13?, series_year?, issue_number?, authors?, release_date?, following_id?}`
- OpenAPI (`QueueAdd`): `kind` and `series_name` required (with `series_name` `maxLength: 255, minLength: 1`); all other fields nullable optional. Same field set.
- **Diff: ✓ match**

### `QueueAddResponse`
- TS: `{request_id, status, existed}`
- OpenAPI: response declared as bare `{type: object}` — could not retrieve a live sample (would require a live POST). TS shape is plausible but **unverified against live response**.
- **Diff: needs live verification with a real POST during the v4.0 work.**

### `RequestRow`
- TS fields: `id, following_id, kind, comicvine_issue_id, hardcover_book_id, isbn_13, series_name, series_year, issue_number, title, authors, release_date, status, status_reason, progress_pct, size_mb, imported_path, is_user_watch, retries, created_at, updated_at, cover_url?, summary?`
- Live row also includes: **`user_loosened_at: string | null`** ← **MISSING IN TS**
- All other fields confirmed present and types match
- **Diff: ✗ TS missing `user_loosened_at: string | null`**

### `RequestsPage`
- TS: `{items, total}`
- Live: `{items, total}`
- **Diff: ✓ match**

### `GET /requests/{id}` response shape
- **Plugin's `getRequest(id)` is currently broken at the type level.**
- Live response is `{request: RequestRow, releases: ReleaseAttempt[]}` — NOT a flat `RequestRow`.
- TS does not model this. Need a new type:
  ```ts
  export interface RequestDetail {
      request: RequestRow;
      releases: ReleaseAttempt[];
  }
  export interface ReleaseAttempt {
      id: number;
      request_id: number;
      title_norm: string;
      protocol: 'usenet' | 'torrent';
      indexer: string | null;
      size_bytes: number | null;
      download_url: string | null;
      score: number | null;
      state: string;            // saw 'succeeded' — full enum unknown from samples
      sab_nzo_id: string | null;
      qbit_hash: string | null;
      source: string;           // saw 'auto'
      attempted_at: string;
  }
  ```

### `GET /requests/{id}/cover` response shape
- **Not modelled in TS at all.**
- Live: `{cover_url: string, source: string}` (saw `source: "cache"`). Add:
  ```ts
  export interface RequestCoverResponse {
      cover_url: string | null;
      source: string;
  }
  ```

### `DiscoverItemDetail`
- TS: `{kind, source, source_id, title, release_date, summary, page_count?, rating?, users_count?, cover_url, series?, issue_number?, contributors[], queue_payload, follow_targets}`
- Live (book): all fields present except `series` is null in 1984 sample (but still present as a key with value null), `issue_number` not present at all on book items
- Live (comic_issue): `series` not present, `issue_number: "135"` present, `contributors[i].role` instead of `contribution`
- **Diff: ✓ shape matches but the comment in TS calls `contributors[].contribution` and `.role` both optional. Live confirms: books use `contribution`, comic_issues use `role`. TS already reflects this.**

### `AuthorBibliography`
- TS: `{author_id, series: [{series_id, series_name, follow_target, books[]}], standalone[]}`
- Live: confirmed exactly this shape
- **Diff: ✓ match**

### `BibliographyBook`
- TS: `{hardcover_book_id, title, release_date, year, cover_url, authors, contribution, queue_state, request_id, queue_payload, series_position?}`
- Live: all fields present. `series_position` is float (e.g. `0.0`).
- **Diff: ✓ match**

### `CandidatesResponse`
- TS: `{request_id, strictness, query, items, total}`
- Live: same shape
- **Diff: ✓ match**

### `Candidate`
- TS: `{release_id, title, indexer, protocol, size_bytes, age_seconds, categories: number[], download_url, info_url, seeders, leechers, score, matched_signals[], rejected_signals[], is_blocklisted}`
- Live `categories`: **`Array<{id: number, name?: string, subCategories: NewznabCategory[]}>` — NESTED OBJECTS, not `number[]`.**
  ```json
  "categories": [
    {"id": 7000, "name": "Books", "subCategories": [...]},
    {"id": 107000, "subCategories": []},
    {"id": 7030, "name": "Books/Comics", "subCategories": []},
    ...
  ]
  ```
- All other fields confirmed.
- **Diff: ✗ `categories` type wrong. Replace with:**
  ```ts
  export interface NewznabCategory {
      id: number;
      name?: string;
      subCategories: NewznabCategory[];
  }
  // and Candidate.categories: NewznabCategory[]
  ```

### `GrabBody`
- TS: `{release_id, download_url, title, protocol, indexer?, size_bytes?}`
- OpenAPI: `release_id, download_url, title, protocol` required; `indexer, size_bytes` nullable optional. **`release_id` is `string` (not `number` despite OpenAPI Title casing — confirmed: `"type":"string"`)**
- **Diff: ✓ match (`release_id` is string in both)**

### Blocklist creator response
- **Not modelled in TS** but plugin uses `listBlockedCreators()`. Live shape:
  ```json
  {
    "items": [
      {
        "id": 1,
        "canonical_name": "J.K. Rowling",
        "aliases_json": "[\"JK Rowling\", \"Joanne Rowling\", \"Robert Galbraith\"]",
        "hardcover_author_id": 80626,
        "comicvine_person_id": 77952,
        "tmdb_person_id": null,
        "anilist_staff_id": null,
        "reason": "transphobia",
        "added_at": "2026-05-08T09:47:33",
        "added_by": null
      }
    ],
    "total": 1
  }
  ```
- **Note: `aliases_json` is a JSON-encoded string, not a `string[]` — frontend has to `JSON.parse(row.aliases_json)`.**
- Recommended types:
  ```ts
  export interface BlockedCreatorRow {
      id: number;
      canonical_name: string;
      aliases_json: string;          // JSON-encoded string[] — must parse
      hardcover_author_id: number | null;
      comicvine_person_id: number | null;
      tmdb_person_id: number | null;
      anilist_staff_id: number | null;
      reason: string | null;
      added_at: string;
      added_by: string | null;
  }
  export interface BlockedCreatorsPage {
      items: BlockedCreatorRow[];
      total: number;
  }
  ```

### `/health` response
- Not in TS. Live: `{status, version, in_flight: {search: bool, enrich: string[]}, clients: {<name>: {source, breaker_open, consecutive_failures, current_cooldown, requests_last_minute, requests_last_hour, minute_budget_remaining, hour_budget_remaining, aborted_keys_count}}}`. Worth typing if v4.0 surfaces a status panel.

## Recommendations

### Hard fixes for `Web/types/api.ts` before v4.0 ships

1. **Add `user_loosened_at: string | null`** to `RequestRow`.
2. **Replace `Candidate.categories: number[]`** with `NewznabCategory[]` (nested-object type) — current typing is a fiction.
3. **Add `RequestDetail` and `ReleaseAttempt`** for `GET /requests/{id}`. The plugin's `getRequest()` returns this shape, not a flat `RequestRow`.
4. **Add `RequestCoverResponse`** for `GET /requests/{id}/cover`.
5. **Add `BlockedCreatorRow` + `BlockedCreatorsPage`** for `GET /blocklist/creators`.
6. **Split `DiscoverItemKind` from `TrendingKind`**: `TrendingKind = 'book' | 'comic'` (the trending endpoint rejects the wider enum).

### Endpoints to add to `Web/pages/api.js`

- `blocklistRelease(id, body)` → `POST /requests/{id}/blocklist-release` (release-level block, not creator-level).
- `listFollowing` should accept an `include_finished` flag — current code does not request it, so finished comic series are silently hidden.
- `triggerSweep`, `triggerReorganize` should accept `limit` so admin tools can run capped passes.

### Strategy: hand-written vs generated types

OpenAPI codegen alone is **insufficient** here. Out of 24 endpoints, only the request bodies are fully typed; every response is `{type: object}`. Recommendation:

- Either annotate every FastAPI route with `response_model=...` on the grabber side (adds ~30 lines of Pydantic models — biggest win) and THEN switch to `openapi-typescript`-generated types for the v4.0 build pipeline.
- Or keep `Web/types/api.ts` hand-written for v4.0, fix the bugs above, and revisit codegen in v4.1 once the grabber side has been annotated.

Lower-friction path: **add `response_model` to every `@router` in the grabber, regenerate OpenAPI, then codegen on the plugin side.** Would also let the TS layer track grabber Pydantic schema changes automatically.
