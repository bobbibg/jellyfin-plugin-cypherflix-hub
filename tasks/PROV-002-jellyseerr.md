# PROV-002 — Jellyseerr provider

**Goal:** implement `IMediaProvider` for Jellyseerr (movies + TV requests).

This is the closest analogue to what JF Enhanced's Seer integration does —
read its source for inspiration:
https://github.com/n00bcodr/Jellyfin-Enhanced

## Inputs

- `Core/IMediaProvider.cs`, `Core/Models.cs`
- `JELLYFIN-INTEGRATION.md` for class names
- Jellyseerr API docs: https://api-docs.overseerr.dev/ (Jellyseerr is an
  Overseerr fork with the same API)

## Files to create

- `Providers/Jellyseerr/JellyseerrProvider.cs`
- `Providers/Jellyseerr/JellyseerrClient.cs`
- `Providers/Jellyseerr/Dtos.cs` (or split per endpoint)

## Type metadata

| Member | Value |
|---|---|
| `TypeId` | `"jellyseerr"` |
| `DisplayName` | `"Jellyseerr"` |
| `Description` | `"Movie and TV request manager. Provides Discover catalogue and request submission for Sonarr/Radarr."` |
| `IconUrl` | `"https://raw.githubusercontent.com/Fallenbagel/jellyseerr/develop/public/logo.png"` |
| `SupportedMediaTypes` | `[Movie, TvShow]` |
| `SupportedCapabilities` | `[Search, Index, Request, RequestStatus, Discover]` |
| `ConfigSchema` | see below |

### Config schema

| Key | Label | Type | Required | Default | Description |
|---|---|---|---|---|---|
| `url` | "URL" | `Url` | yes | `http://192.168.1.165:7920` | Internal LAN URL |
| `api_key` | "API Key" | `ApiKey` | yes | — | Jellyseerr API key (Settings → General → API Key) |
| `quality_profile_movie` | "Movie quality profile (optional)" | `Text` | no | — | Override the default profile for new movie requests |
| `quality_profile_tv` | "TV quality profile (optional)" | `Text` | no | — | Override default for TV |

## Behaviour

### `TestConnectionAsync`

`GET {url}/api/v1/status` with `X-Api-Key`. Return `Ok=true` if 200. Surface
status code/message on failure.

### `SearchAsync`

`GET {url}/api/v1/search?query={q}&page=1`

Translate `MediaInfo` → `SearchResult`. The `InLibrary` and `RequestPending`
flags are filled in by the aggregator (don't try to do it here — Jellyseerr's
own data on this is unreliable across instances). Use `mediaInfo.tmdbId` (or
`tvdbId` for TV) as `ExternalId`. `ExternalUrl = "{url}/{mediaType}/{tmdbId}"`.

### `RequestAsync`

`POST {url}/api/v1/request` with body
```json
{ "mediaType": "movie"|"tv", "mediaId": <tmdbId>, "userId": <jellyseerrUserId>, "seasons": [...] }
```

Idempotency: if Jellyseerr returns 409 / "already exists", look up the
existing request and return success with its current status.

### `GetRequestStatusesAsync`

`GET {url}/api/v1/request/?filter=all&take=100&userId={jellyseerrUserId}`

Map `MediaRequest.status` (1=pending, 2=approved, 3=declined, 4=available) +
`media.status` → our `RequestState` enum.

| Jellyseerr | Our `RequestState` |
|---|---|
| status=1 | `Pending` |
| status=2 + media.status=2 | `Approved` |
| status=2 + media.status=3 | `InProgress` |
| status=2 + media.status=5 | `Available` |
| status=3 | `Declined` |

### `IndexAsync`

Trending + popular endpoints once per run, dedupe:

- `GET {url}/api/v1/discover/movies/trending?take=200`
- `GET {url}/api/v1/discover/tv/trending?take=200`
- `GET {url}/api/v1/discover/movies?take=200`
- `GET {url}/api/v1/discover/tv?take=200`

Map each result to `IndexDocument`. `IndexBatch.Replace = true` so we always
have a fresh trending list. Cap at ~1000 documents per run for the first
cut.

`since` is unused for now — Jellyseerr's discover endpoints don't take a
delta filter.

### `GetCalendarAsync`

Jellyseerr doesn't have a first-class calendar endpoint, but it forwards
"upcoming" data from Sonarr/Radarr. For the first cut, return `Array.Empty`
and rely on Sonarr/Radarr providers (future PROV) for calendar data.

## Mapping helpers

User-id mapping: when the calling user submits a request, we need their
Jellyseerr user id. Strategy: keep a per-user map in
`PluginConfiguration.JellyseerrUserMap[]` (Jellyfin user GUID →
Jellyseerr user id), populated on first request via
`GET /api/v1/user?take=100` matching by Jellyfin's "name" field. Fall back
to the admin user (id=1) if no match.

## Acceptance criteria

- Builds clean.
- `TestConnectionAsync` returns `Ok=true` against a real Jellyseerr.
- `SearchAsync("Brooklyn 99")` returns the show with TMDB id.
- `IndexAsync` returns ≥100 docs.
- `RequestAsync` for an unrequested movie creates a Jellyseerr request.
- Re-requesting the same movie returns `Ok=true` with the existing status.

## Verification recipe

After deploy + admin configures the instance:

```bash
curl -s -H "X-Emby-Token: $JF_KEY" \
  "https://192.168.1.165:7900/CypherflixHub/Providers" \
  | jq '.[] | select(.TypeId == "jellyseerr")'
```

---

Status: needs-review
