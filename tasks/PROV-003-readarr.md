# PROV-003 — Readarr provider

**Goal:** implement `IMediaProvider` for Readarr (Faustvii fork) so books,
audiobooks, and comics can be searched and requested. **Multiple instances
expected** — admin will likely configure one Readarr instance per root
folder (books / audiobooks / comics) to control quality profiles independently.

## Inputs

- Readarr API docs (Servarr family): https://readarr.com/docs/api/
- Faustvii fork specifics — check the running instance's
  `/api/v1/system/status` for divergence
- Existing homelab config: `CLAUDE.md` "Books / Audiobooks / Comics Pipeline"
- The `MediaType` enum in `Core/MediaType.cs`

## Files to create

- `Providers/Readarr/ReadarrProvider.cs`
- `Providers/Readarr/ReadarrClient.cs`
- `Providers/Readarr/Dtos.cs`

## Type metadata

| Member | Value |
|---|---|
| `TypeId` | `"readarr"` |
| `DisplayName` | `"Readarr"` |
| `Description` | `"Book, audiobook, and comic management. Multi-instance — configure one per root folder."` |
| `IconUrl` | `"https://raw.githubusercontent.com/Readarr/Readarr/develop/Logo/256.png"` |
| `SupportedMediaTypes` | `[Book, Audiobook, Comic]` |
| `SupportedCapabilities` | `[Search, Index, Request, RequestStatus, Calendar]` |

### Config schema

| Key | Label | Type | Required | Default | Description |
|---|---|---|---|---|---|
| `url` | "URL" | `Url` | yes | `http://192.168.1.165:7650` | Internal LAN URL |
| `api_key` | "API Key" | `ApiKey` | yes | — | Settings → General → API Key |
| `media_type` | "Library media type" | `Select` | yes | `book` | Options: `book`, `audiobook`, `comic`, `manga` — controls how `IndexDocument.MediaType` is set. (`manga` maps to `MediaType.Comic` for now; revisit if Jellyfin gains a dedicated manga kind.) |
| `root_folder` | "Root folder path" | `Text` | yes | `/library/books` | Used when adding new authors/books |
| `quality_profile_id` | "Quality profile id" | `Number` | yes | `1` | From `GET /api/v1/qualityprofile` |
| `metadata_profile_id` | "Metadata profile id" | `Number` | yes | `1` | From `GET /api/v1/metadataprofile` |
| `tag` | "Auto-apply tag" | `Text` | no | `books` | Tag added to authors created via this instance — drives SAB category routing per CLAUDE.md |

## Behaviour

### `TestConnectionAsync`

`GET {url}/api/v1/system/status` with `X-Api-Key`. Confirm version starts
with `0.` (Faustvii fork tracks Readarr v0.x).

### `SearchAsync`

Two-phase:

1. **Already in library:** `GET {url}/api/v1/book?titleSlug={slug}` /
   `searchterm`. Map to `SearchResult` with `InLibrary=true` only if the
   book has files (check `book.statistics.bookFileCount > 0`).
2. **Lookup (not yet added):** `GET {url}/api/v1/book/lookup?term={q}`.
   Map to `SearchResult` with `InLibrary=false`.

`MediaType` comes from `cfg.Get("media_type")`.

### `RequestAsync`

If the book exists but is unmonitored: `PUT /api/v1/book/{id}` with
`monitored=true`, then `POST /api/v1/command { name: "BookSearch", bookIds: [id] }`.

If the book doesn't exist yet:

1. `GET /api/v1/author/lookup?term={authorName}` to find/create the author
2. `POST /api/v1/author` if author isn't in DB yet, using `cfg.root_folder`,
   `cfg.quality_profile_id`, `cfg.metadata_profile_id`, `cfg.tag` (resolved
   to a tag id via `GET /api/v1/tag` — create if missing)
3. `POST /api/v1/book` with the editions metadata + the new author id
4. Trigger `BookSearch` command on the new book id

Idempotency: any of the above returning "already exists" → look up the
existing record and continue.

### `GetRequestStatusesAsync`

Readarr has no per-user requests model. Return books in the user's chosen
"watch list" — for now, return all books with `monitored=true && bookFileCount=0`
as `RequestState.Pending` or `InProgress` (depending on whether they're in
the queue). Inspect `GET /api/v1/queue` for InProgress + ProgressPercent.

`userId` is ignored for the first cut (Readarr is admin-shared).

### `IndexAsync`

`GET /api/v1/book?monitored=true` (paginate via `pageSize=1000` if the API
supports it). Map to `IndexDocument`.

`since`: Readarr exposes `added` timestamps on books — if `since != null`,
filter client-side.

### `GetCalendarAsync`

`GET /api/v1/calendar?start={start:yyyy-MM-dd}&end={end:yyyy-MM-dd}`.

Map `CalendarItem` → `CalendarEntry`. `Subtitle` = "Series N #M" if the
book is part of a series.

## Acceptance criteria

- Test connection returns ok.
- `SearchAsync("Hyperion")` returns Hyperion with `InLibrary=true` if it's
  already in the library.
- `RequestAsync` for a not-in-library book creates the author + book +
  triggers a search.
- Re-requesting returns `Ok=true` with the existing record.

---

Status: needs-review
