# Grabber source reconcile (deployed -> local)

Run from this sandbox we can reach the live grabber's OpenAPI on
http://192.168.1.165:7960 but we cannot SSH to the NAS (no key in the
sandbox). The actual container source extraction has to happen from
Bobbi's workstation (which has SSH keys + the sudoers NOPASSWD setup
from `scripts/setup-nas-sudoers.sh`). A ready-to-run extraction script is
staged at:

    /sessions/gallant-sleepy-gauss/mnt/outputs/grabber-reconcile/extract-from-container.sh

What follows is the reconcile plan based on (1) the live OpenAPI dump
at `outputs/grabber-reconcile/docs/live-openapi.json`, (2) the existing
recon notes in `.recon/grabber-openapi-diff.md`, and (3) the local
working-tree state of the homelab repo. Items marked **[needs container
extraction]** require the script above to run before they can be
finalised.

## Headline findings

- **The local source tree is NOT just behind on commits — it's behind on
  files.** Some hot-patches DO exist as uncommitted changes in the
  working tree (`api/following.py`, `api/queue.py`,
  `db/queries/following.py` are untracked; `discover.py`,
  `requests_router.py`, `db/migrations.py`, `db/models.py`,
  `db/queries/releases.py`, `db/queries/requests.py`,
  `clients/hardcover.py`, `__main__.py`, `api/blocklist.py`,
  `api/watchlist.py`, `db/queries/watchlist.py` are modified but not
  committed). But:
- **Other hot-patches do NOT exist locally at all.** The 7 routes called
  out in the brief (`/discover/search`, `/discover/item/{kind}/{source_id}`,
  `/discover/author/{id}/bibliography`, `/requests/{id}/candidates`,
  `/grab`, `/loosen`, `/blocklist-release`) are absent from every
  `api/*.py` file on disk, including the dirty ones. The route handlers
  must be extracted from the container.
- **`app.py` on disk is stale relative to the deployed wiring.** It
  imports `watchlist` (legacy, empty file) but not `following` or
  `queue`. The deployed app must wire `following.router` and
  `queue.router` (the OpenAPI proves it), so `app.py` itself is one of
  the files needing reconciliation.
- **`db/models.py` is truncated** — the on-disk file ends mid-`BlockedCreatorRow`
  (last line is `    reason: str | None`, no trailing fields, no `HaveCountsRow`
  defined though `db/queries/following.py:120` returns `models.HaveCountsRow`).
  The container almost certainly has the complete file.

## OpenAPI gap (computed precisely)

Live container has 29 routes; local source files have 22 routes wired
across `health`, `following` (uncommitted), `requests_router`, `ops`,
`discover`, `blocklist`, `queue` (uncommitted). The 7 missing locally
are exactly the brief's hot-patch list:

```
GET  /api/v1/discover/search
GET  /api/v1/discover/item/{kind}/{source_id}
GET  /api/v1/discover/author/{author_id}/bibliography
GET  /api/v1/requests/{request_id}/candidates
POST /api/v1/requests/{request_id}/grab
POST /api/v1/requests/{request_id}/loosen
POST /api/v1/requests/{request_id}/blocklist-release
```

OpenAPI signatures (schemas locked in by the live container):

| Route | Inputs | Body schema |
|---|---|---|
| `GET /discover/search` | `q: str (required)`, `kind?: 'book'\|'comic'`, `limit?: int = 20` | n/a |
| `GET /discover/item/{kind}/{source_id}` | `kind: 'book'\|'comic_issue'\|'comic_series'`, `source_id: str` | n/a |
| `GET /discover/author/{author_id}/bibliography` | `author_id: int` | n/a |
| `GET /requests/{request_id}/candidates` | `request_id: int`, `strictness?: 'strict'\|'loose'\|'raw' = 'raw'` | n/a |
| `POST /requests/{request_id}/grab` | `request_id: int` | `GrabBody { release_id: str (req), download_url: str (req), title: str (req), protocol: 'usenet'\|'torrent' (req), indexer?, size_bytes? }` |
| `POST /requests/{request_id}/loosen` | `request_id: int` | none |
| `POST /requests/{request_id}/blocklist-release` | `request_id: int` | `BlocklistRelease { release_id: int (req), reason?: string }` |

Response shapes are NOT declared in OpenAPI (the v4.1 codegen track is
specifically about adding `response_model=` to every route — see
`.recon/v41-codegen-plan.md`). Live shapes verified via curl during
recon:

- `/discover/search` -> `DiscoverPage = { items: DiscoverItem[], total: number }`
- `/discover/item/...` -> `DiscoverItemDetail`
- `/discover/author/.../bibliography` -> `AuthorBibliography`
- `/requests/.../candidates` -> `CandidatesResponse`
- `/requests/.../grab` -> verified via plugin frontend; shape unknown to OpenAPI
- `/requests/.../loosen` -> wraps `CandidatesResponse` plus `auto_loosened: bool`
- `/requests/.../blocklist-release` -> declared as `Dict[str, str]` in OpenAPI

## Files only on container (need to be added locally) — [needs container extraction]

Best estimate based on FastAPI conventions + the local layout:

- **`api/discover.py`** — must grow `/search`, `/item/{kind}/{source_id}`,
  `/author/{id}/bibliography` handlers. The local file has the helpers
  (`_already_have_book_ids`, `_already_have_comic_volume_ids`,
  `_is_already_have`, `_map_volume_to_discover_item` etc.) but only
  exports `/trending` and `/coming-soon`.
- **`api/requests_router.py`** — must grow `/candidates`, `/grab`,
  `/loosen`, `/blocklist-release` handlers. Local file has `/retry`
  with auto-loosen logic in v3.0.1 style but no manual-search endpoints.
- **`api/app.py`** — must `include_router(following.router, prefix=...)`
  and `include_router(queue.router, prefix=...)` since the live OpenAPI
  surfaces both. Local `app.py` does not.
- Possibly **new service modules**: `services/manual_search.py`,
  `services/blocklist.py`, or similar. Cannot confirm without
  container introspection — list will be filled in when the extraction
  script runs.

## Files differing (need to be merged)

Already in the working tree as `git status` "modified":

- `api/blocklist.py` — partial diff visible: `model_dump(mode="json")` was
  truncated to `model_dump(mode="js` mid-string in one location. **Local
  is broken** — apply container version.
- `api/discover.py`, `api/requests_router.py`, `api/watchlist.py`,
  `db/migrations.py`, `db/models.py`, `db/queries/releases.py`,
  `db/queries/requests.py`, `db/queries/watchlist.py`,
  `clients/hardcover.py`, `__main__.py` — all need diffs vs container.

Untracked (already-existing local additions that just need committing):

- `api/following.py`
- `api/queue.py`
- `db/queries/following.py`

## New DB migrations on container — [needs container extraction]

Local `db/migrations.py` MIGRATIONS list:

```python
(1, migrate_0001_initial),
(2, migrate_0002_creator_blocklist),
(3, migrate_0003_rename_watchlist_to_following),
(4, migrate_0004_user_loosened_at),
```

Whether 0005+ exist on the container can only be verified by extracting
`db/migrations.py` from the container. The brief implies one might —
manual-search infrastructure could need a `manual_grab_attempts` table
or similar, and a per-request `blocklisted_releases` linking table is
plausible for `/blocklist-release`. **The extraction script's first
priority should be to grab `db/migrations.py` and the container's
sqlite schema (`sudo docker exec ... sqlite3 /config/cypherflix.db
'.schema'`).**

## Truncated local files restored from container — [needs container extraction]

- **`db/models.py`** — local file is 135 lines, ends mid-class. Must
  define `HaveCountsRow` (referenced by `db/queries/following.py:120` as
  `models.HaveCountsRow`) and complete `BlockedCreatorRow` (missing
  `added_at`, `added_by`). The complete model surface is implicit from
  the schema response shapes in `.recon/grabber-openapi-diff.md`:
  ```python
  class HaveCountsRow(_Row):
      following_id: int
      have: int
      wanted: int
      total: int

  class BlockedCreatorRow(_Row):
      id: int
      canonical_name: str
      aliases_json: str
      hardcover_author_id: int | None
      comicvine_person_id: int | None
      tmdb_person_id: int | None
      anilist_staff_id: int | None
      reason: str | None
      added_at: datetime
      added_by: str | None
  ```
  These are confirmed by live JSON samples but the canonical version
  must be pulled from the container for byte-identical reproduction
  (especially because the container almost certainly defines extra rows
  for the new manual-search / release-blocklist features).

## Schema concern: silent migration drift

If the container has migrations 0005+ that aren't in `db/migrations.py`
on disk, then a naive `git push nas main` would deploy a Python image
whose `apply_pending` knows about migrations 1..4 only. The newly
deployed code would fail to startup-check existing schema (or worse,
crash on encountering tables it didn't create). **Concrete safety check
before committing:** after extraction, ensure every column referenced in
new route code corresponds to a migration registered in `MIGRATIONS`.
Re-deploying without this would break the running system.

A second concern: **the `app.py` on disk imports the empty
`watchlist.py`.** If the container's `app.py` has dropped `watchlist`
in favour of `following`, deploying the local `app.py` would re-mount
the legacy router (which is now an empty stub). The plugin currently
talks to `/following/*` — the legacy `/watchlist/*` paths would 404.
Plugin frontend wouldn't notice, but anything still hitting the old
route would. Confirm via container `app.py`.

## Apply procedure (for Bobbi to run locally — no commands run on her screen by us)

The reconciled files will be staged at
`/sessions/gallant-sleepy-gauss/mnt/outputs/grabber-reconcile/` once the
extraction script runs. Until then, only the extraction script and this
plan are present.

### Step 1 — extract from container (Bobbi's workstation, Bash)

```bash
cd C:/Users/Bobbi/Code/homelab
bash /c/Users/Bobbi/AppData/Roaming/Claude/local-agent-mode-sessions/.../outputs/grabber-reconcile/extract-from-container.sh
# Or copy the script into the repo first:
#   cp .../outputs/grabber-reconcile/extract-from-container.sh /tmp/
#   bash /tmp/extract-from-container.sh
```

The script writes:
- `./grabber-reconcile-out/container/` — full mirror of `/app/cypherflix_grabber/` from the container
- `./grabber-reconcile-out/diffs/` — one `.diff` per file that differs
- `./grabber-reconcile-out/SUMMARY.md` — list of new + differing files

### Step 2 — review the diffs

```bash
cd C:/Users/Bobbi/Code/homelab
cat grabber-reconcile-out/SUMMARY.md
# review every diff, especially:
#   diffs/api__app.py.diff
#   diffs/api__discover.py.diff
#   diffs/api__requests_router.py.diff
#   diffs/db__migrations.py.diff
#   diffs/db__models.py.diff
ls grabber-reconcile-out/container/api/   # any files NOT in local source?
```

### Step 3 — copy container files into local source

```bash
cd C:/Users/Bobbi/Code/homelab
LOCAL=stacks/nas/cypherflix-grabber/src/cypherflix_grabber
# Replace differing files
cp grabber-reconcile-out/container/api/app.py            $LOCAL/api/app.py
cp grabber-reconcile-out/container/api/discover.py       $LOCAL/api/discover.py
cp grabber-reconcile-out/container/api/requests_router.py $LOCAL/api/requests_router.py
cp grabber-reconcile-out/container/api/blocklist.py       $LOCAL/api/blocklist.py
cp grabber-reconcile-out/container/db/migrations.py       $LOCAL/db/migrations.py
cp grabber-reconcile-out/container/db/models.py           $LOCAL/db/models.py
cp grabber-reconcile-out/container/db/queries/releases.py $LOCAL/db/queries/releases.py
cp grabber-reconcile-out/container/db/queries/requests.py $LOCAL/db/queries/requests.py
cp grabber-reconcile-out/container/db/queries/watchlist.py $LOCAL/db/queries/watchlist.py
cp grabber-reconcile-out/container/db/queries/following.py $LOCAL/db/queries/following.py
cp grabber-reconcile-out/container/clients/hardcover.py    $LOCAL/clients/hardcover.py
cp grabber-reconcile-out/container/__main__.py             $LOCAL/__main__.py
cp grabber-reconcile-out/container/api/following.py        $LOCAL/api/following.py
cp grabber-reconcile-out/container/api/queue.py            $LOCAL/api/queue.py
# plus any container-only files reported by SUMMARY.md (e.g. services/*.py)
```

### Step 4 — verify schema integrity

```bash
# Compare migrations
grep MIGRATIONS -A 10 $LOCAL/db/migrations.py
# Compare live DB schema vs local (run from local shell with NAS SSH):
ssh bobbi@192.168.1.165 'sudo docker exec CypherflixGrabberV2 sqlite3 /config/cypherflix.db ".schema"' \
    > grabber-reconcile-out/live.schema.sql
# Hand-check that every CREATE TABLE / ADD COLUMN matches a migration
```

### Step 5 — commit + deploy

```bash
cd C:/Users/Bobbi/Code/homelab
git add stacks/nas/cypherflix-grabber/
git diff --staged --stat   # review
git commit -m "grabber: reconcile hot-patched routes (search/discover/candidates/grab/loosen/blocklist-release)

Pulls deployed-only routes back into source control:
- /api/v1/discover/{search,item/{kind}/{source_id},author/{id}/bibliography}
- /api/v1/requests/{id}/{candidates,grab,loosen,blocklist-release}
Plus completes db/models.py truncation and resolves api/blocklist.py
half-applied edit. Wires api.following + api.queue routers in app.py.
Adds migrations 0005+ if any."
# Backup to GitHub first, NAS deploy second:
git push github main
git push nas main
```

The post-receive hook on the NAS bare repo handles the deploy. Watch
`docker logs CypherflixGrabberV2` for migration output.

### Step 6 — sanity-check after deploy

```bash
# Confirm route count unchanged (still 29) — proves we didn't drop anything
curl -s http://192.168.1.165:7960/openapi.json | python3 -c '
import json, sys
spec = json.load(sys.stdin)
print(len(spec["paths"]), "paths")
for p in sorted(spec["paths"]): print(" ", p)
'
# And health endpoint stays green
curl -s http://192.168.1.165:7960/api/v1/health | python3 -m json.tool
```

If the openapi route count drops below 29 OR `/api/v1/health` 500s, roll
back: `git push nas main --force-with-lease HEAD~1:main` (after
verifying HEAD~1 was the prior good commit).
