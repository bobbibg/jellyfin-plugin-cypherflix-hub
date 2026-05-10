# v4.1 Movies pipeline design

Recon for adding movies as the 4th `RequestKind` (after `comic_issue`, `book`,
`audiobook`). Goal: Discover-Movies-row + queue + Prowlarr search + grab.
File-organisation stays with Radarr through v4.5; we delete Radarr in v5.0.

Sources cited inline; key references:
- TMDB API: <https://developer.themoviedb.org/reference/intro/getting-started>
- Prowlarr Search wiki: <https://wiki.servarr.com/prowlarr/search>
- TRaSH custom-format axes: <https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/>
- Jellyfin movie naming: <https://jellyfin.org/docs/general/server/media/movies/>

---

## 1. Authentication and rate limits

- **v3 API key** via `?api_key=...` query param OR `Authorization: Bearer <v4 read-token>`.
  Use **v3** for the grabber — simpler, matches existing pattern (Hardcover/ComicVine).
- **Rate limit:** historical "40 req / 10 s" guideline was disabled Dec 2019; current
  CDN cap ~50 req/sec, 20 concurrent connections per IP. As of Dec 2025 TMDB
  publicly stated the limit "removed for normal usage" — so we just rate-limit
  ourselves through `SafeClient` like all other clients (60 rpm, 1000 r/h is
  plenty).
- **API key location:** **NOT YET PROVISIONED.** Bobbi needs to mint one at
  <https://www.themoviedb.org/settings/api> and add it to Proton Pass under
  **Home / "Homelab API Keys"** as field `TMDB_API_KEY`, then to
  `stacks/nas/.env` as `TMDB_API_KEY=...` (`.env` already has `COMICVINE_API_KEY`,
  same shape).

## 2. TMDB API surface we'll use

All paths under `https://api.themoviedb.org`. Image base
`https://image.tmdb.org/t/p/<size>`.

| # | Endpoint | Purpose | Key response fields |
|---|----------|---------|---------------------|
| 1 | `GET /3/configuration` | Cached at startup; gives `images.base_url`, `images.poster_sizes`, `images.backdrop_sizes`. | `images.base_url`, `images.secure_base_url`, `images.poster_sizes`, `images.backdrop_sizes` |
| 2 | `GET /3/trending/movie/{day\|week}` | Discover Trending row. Half-life: day = 24h, week = 7d. | `results[].{id, title, original_title, release_date, overview, poster_path, backdrop_path, vote_average, popularity}` |
| 3 | `GET /3/movie/upcoming?region=GB` | Discover Coming-Soon row. Region defaults to US — pin to `GB`. | `results[]` same as trending + `dates.maximum`, `dates.minimum` |
| 4 | `GET /3/search/movie?query=...&year=...` | User search box. | `results[]` same as trending; `total_results`, `total_pages` |
| 5 | `GET /3/movie/{id}` | Detail page. | adds `runtime`, `genres[].name`, `tagline`, `status`, `imdb_id` (top-level since 2023), `production_companies`, `vote_count`, `budget`, `revenue` |
| 6 | `GET /3/movie/{id}/external_ids` | Fallback for IMDB ID if not on detail. | `imdb_id`, `wikidata_id` etc. |
| 7 | `GET /3/person/{id}/movie_credits` | "More by {director\|actor}" — equivalent of `bibliography`. | `cast[]`, `crew[]` (filter `crew[].job == "Director"`) |

Languages/region: pass `language=en-GB` (override per-call), `region=GB` for
release-date scoping.

## 3. Image URL construction

- Cards: `{secure_base_url}w500{poster_path}`
- Detail hero backdrop: `{secure_base_url}w1280{backdrop_path}`
- Mobile/list thumb: `{secure_base_url}w185{poster_path}`
- Verified poster sizes (TMDB config): `w92, w154, w185, w342, w500, w780, original`
- Backdrop sizes: `w300, w780, w1280, original`

Cache `/configuration` for 24h (TMDB recommends 7d; we're conservative).

## 4. Prowlarr movie search

Same `GET /api/v1/search` endpoint we already use for books/comics
(`clients/prowlarr.py`), differing in:

- **Categories:** `2000` covers all movies; for finer control add
  `2030 (SD), 2040 (HD), 2045 (UHD), 2050 (BluRay)`. Skip `2010 (Foreign)`,
  `2020 (Other)`, `2060 (3D)` by default.
- **ID-based search (high precision):** Prowlarr's Newznab parser reads
  `tmdbid=` and `imdbid=` (without `tt` prefix per Issue #1631). Pass
  `&tmdbid={id}` alongside `query=`; results without an indexer that supports
  it fall back to title search.
- **Response shape:** identical to current — `title, downloadUrl, protocol,
  indexer, indexerId, size, age, guid, infoUrl, categories[].id`,
  plus `seeders`/`leechers` for torrent. `Candidate`-equivalent dataclass
  reuses the current shape.

No new client needed — extend `Prowlarr.search()` with optional
`tmdb_id` / `imdb_id` kwargs that append `&tmdbid=...` to the URL.

## 5. Movie matcher signal taxonomy

11 dimensions (axes only — numeric weights are tuning, not architecture):

| # | Signal | What it means |
|---|--------|---------------|
| 1 | **Title fuzziness** | Token Jaccard between TMDB `title` + `original_title` and release name; allow franchise truncation. |
| 2 | **Year match** | TMDB `release_date` year vs parsed year, ±1 tolerance. **Hard reject** beyond ±2. |
| 3 | **Resolution** | 2160p > 1080p > 720p > SD. Score from user pref; default 1080p preferred, 2160p OK. |
| 4 | **Source/quality** | BluRay > WEB-DL > WEBRip > HDTV > CAM/TS (hard reject CAM/TS/SCREENER unless flagged). |
| 5 | **HDR/DV** | DV+HDR10 > DV > HDR10+ > HDR10 > SDR. Per-user pref (most TVs are HDR-capable). |
| 6 | **Codec** | HEVC/x265 (smaller) vs H264/x264 (compatibility). User pref. |
| 7 | **Audio** | TrueHD-Atmos > DTS-HD MA > EAC3 > AC3 > AAC. Channels: 7.1 > 5.1 > 2.0. |
| 8 | **Release group reputation** | Small positive boost for known scene/p2p groups (FraMeSToR, EbP, etc.). |
| 9 | **Size sanity** | Min ~700MB (filter fakes/sample-only NZBs); max varies by resolution (≤25GB 1080p, ≤80GB 2160p remux). |
| 10 | **Foreign-language flag** | If TMDB `original_language != 'en'` and user wants original audio, allow; else reject `MULTi`/dub-only releases when an English release exists. |
| 11 | **TMDB-id / IMDB-id match in release name** | Strong positive (rare but indexer hint of ID-tagged release). |

Hard rejects: TV markers (`s\d{1,2}e\d{1,2}`), book/comic format (`.epub`, `.cbz`),
CAM/TS/SCREENER, year mismatch >±2, parsed `Sample` flag.

## 6. File organisation conventions (Bobbi's homelab CLAUDE.md + Jellyfin docs)

- Library root: `/data/movies/` (NAS `/volume3/Movies`)
- Folder per movie: `{Title} ({Year}) [tmdbid-{id}]/`
- Main file: `{Title} ({Year}) [tmdbid-{id}].{ext}` (mkv/mp4)
- Subtitles: `{base}.en.srt`, `{base}.es.srt` (language suffix before ext)
- Featurettes/extras: `-trailer.{ext}`, `-behindthescenes.{ext}`,
  `-deleted.{ext}`, `-featurette.{ext}` suffixes; or subfolders
  `behind the scenes/`, `interviews/`, `extras/`.
- Multiple editions: same folder, files distinguished by ` - ` suffix
  e.g. `Movie (Year) [tmdbid-X] - Director's Cut.mkv`,
  `Movie (Year) [tmdbid-X] - Theatrical.mkv`. Jellyfin merges.

(Cypherflix-grabber will not own this layer in v4.1 — Radarr keeps it.
Implement minimal hardlink import only when v4.6 lands.)

## 7. Schema diff (DB migrations needed)

Next migration number is **0005** (existing: 0001 initial, 0002 creator_blocklist,
0003 watchlist→following, 0004 user_loosened_at).

`db/migrations.py` add:

```python
async def migrate_0005_add_movie_kind(db: aiosqlite.Connection) -> None:
    """Add tmdb_movie_id column to requests; movie kind is enforced
    via app-layer enum (SQLite has no CHECK on kind today)."""
    await db.execute("ALTER TABLE requests ADD COLUMN tmdb_movie_id INTEGER")
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_requests_tmdb_movie_id "
        "ON requests(tmdb_movie_id) WHERE tmdb_movie_id IS NOT NULL"
    )
```

No new tables. Movies fit in `requests` with `kind='movie'`. `following` is
**not** extended — actor/director-level "follow" is deferred (v4.2+ alongside
TVDB people-following).

## 8. Type-level changes (TS + Pydantic)

`Web/types/api.ts`:
```ts
- export type RequestKind = 'comic_issue' | 'book' | 'audiobook';
+ export type RequestKind = 'comic_issue' | 'book' | 'audiobook' | 'movie';

- export type DiscoverItemKind = 'book' | 'comic_issue' | 'comic_series';
+ export type DiscoverItemKind = 'book' | 'comic_issue' | 'comic_series' | 'movie';

- export type TrendingKind = 'book' | 'comic';
+ export type TrendingKind = 'book' | 'comic' | 'movie';

- export type DiscoverItemSource = 'hardcover' | 'comicvine';
+ export type DiscoverItemSource = 'hardcover' | 'comicvine' | 'tmdb';

  // QueueAddBody — add:
+ tmdb_movie_id?: number;
+ runtime_minutes?: number;
```

Grabber-side `api/discover.py` `DiscoverItem.kind` Literal expands to include
`"movie"`; new `_tmdb_movie_to_item()` builder; `watchlist_kind` defaults to
`null` for movies (no following target).

`api/queue.py` `QueueAddBody`: add `tmdb_movie_id: int | None = None`,
mark `series_name` optional when `kind='movie'` (movies have no series).

## 9. Frontend wiring

- `Web/state/api.ts`: pass `kind='movie'` to `discoverTrending` / `discoverComingSoon`.
- `Web/pages/discover.ts`: render a 4th row "Movies" (Trending Today) +
  "Coming Soon" row.
- `Web/components/card.ts`: kind-agnostic; subtitle for movies =
  `${runtime}m · ${year}` (mirroring Jellyfin's native movie-card subtitle).
  Falls back to `${year}` if runtime missing.
- `Web/pages/detail.ts`: when `kind='movie'`:
  - hide Follow buttons (no follow targets)
  - show Queue button + Candidates icon (already kind-agnostic)
  - hero backdrop = `backdrop_path` w1280
  - secondary metadata: runtime, genres, vote_average, director (from credits)

## 10. Implementation order

1. **TMDB client** — `clients/tmdb.py` mirroring `hardcover.py`: SafeClient,
   `/configuration` cache, all 7 endpoints. Cheatsheet
   `cheatsheets/tmdb.md`.
2. **DB migration 0005** + Pydantic model updates.
3. **Movie matcher** — `matcher/movie_matcher.py`. Reuse `_tokenize`,
   `_YEAR_RE` from book matcher; introduce `parse_quality()`,
   `parse_resolution()`, `parse_hdr()` shared utility in `matcher/_release_parsing.py`
   (refactor opportunity — book/comic matchers can adopt later).
4. **Discover routes expand** — `api/discover.py` adds `tmdb` source branch in
   `_trending_movies()`, `_coming_soon_movies()`, `_search_movies()`.
5. **Queue route** — `api/queue.py` accepts `kind='movie'` + `tmdb_movie_id`.
6. **Searcher route** — `searcher/movies.py` builds query from TMDB title/year,
   runs `prowlarr.search(query=..., tmdb_id=..., categories=[2000,2030,2040,2045,2050])`.
7. **Frontend wiring** (Web/types, state, pages, card subtitle).
8. **Codegen refresh** — annotate response_models on grabber routes (#46),
   regen `Web/types/api.ts`.
9. **End-to-end test** — queue Inception (id 27205) → expect snatched in <60s.
10. **Defer file-organisation** to v4.6 (#55). Radarr still imports for now.

## 11. Risks and scope cuts

- **Radarr coexistence:** for v4.1 the grabber sends NZB to SAB with category
  `movies` but Radarr's import scanner is also watching `/data/movies/downloads`.
  Risk of double-import. **Mitigation:** point grabber-issued downloads at
  `/data/movies/downloads/cypherflix/` (subfolder) and tell Radarr to ignore
  it. Or: bypass Radarr entirely for cypherflix-queued items by hardlinking
  directly into the library folder in v4.6.
- **TMDB key shared with Jellyfin:** Jellyfin uses TMDB internally with its
  own bundled key. Our key is independent — no collision.
- **No follow targets:** Movies don't currently get a "follow this director"
  feature. UI must not crash when `watchlist_kind=null`. Card already handles
  this for queueing-only items.
- **Newznab indexers vary:** not all support `tmdbid=`. Code path must
  fall back to title+year query and re-rank. The matcher year ±1 catch
  protects against picking up the wrong year.

---

## RECOMMENDED SCOPE CUT FOR v4.1

**SHIP:**
- TMDB client + cheatsheet
- Migration 0005 (add tmdb_movie_id)
- Movie matcher
- Discover Trending + Coming-Soon Movies rows
- Queue button on Movies cards/detail
- Prowlarr movie search via SAB → existing import flow
- Frontend kind-aware card subtitle for movies

**DEFER to v4.6 (#55):**
- File organisation pipeline (Radarr keeps doing it)
- Hardlink-based import bypass
- Multi-edition Director's-Cut handling
- Subtitle download (Bazarr keeps doing it)

**DEFER to v4.2/later:**
- Follow-this-director / follow-this-actor (needs people-following table)
- Watchlist-driven Coming-Soon for followed people
- Multi-region release tracking
