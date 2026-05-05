# PROV-006 — Radarr provider (Phase 2)

**Goal:** direct `IMediaProvider` for Radarr — primarily for the **calendar
feed** (Jellyseerr's calendar relay is sparse) and per-instance quality
control. Symmetric to PROV-005 (Sonarr).

## Inputs

- Radarr v3 API: https://radarr.video/docs/api/
- Homelab Radarr at http://192.168.1.165:7400

## Files

- `Providers/Radarr/RadarrProvider.cs`
- `Providers/Radarr/RadarrClient.cs`
- `Providers/Radarr/Dtos.cs`

## Type metadata

| Member | Value |
|---|---|
| `TypeId` | `"radarr"` |
| `DisplayName` | `"Radarr"` |
| `Description` | `"Movie management. Multi-instance — useful for separating mainline vs. niche profiles."` |
| `IconUrl` | `"https://raw.githubusercontent.com/Radarr/Radarr/develop/Logo/256.png"` |
| `SupportedMediaTypes` | `[Movie]` |
| `SupportedCapabilities` | `[Search, Index, Request, RequestStatus, Calendar]` |

### Config schema

| Key | Label | Type | Required | Default |
|---|---|---|---|---|
| `url` | "URL" | `Url` | yes | `http://192.168.1.165:7400` |
| `api_key` | "API Key" | `ApiKey` | yes | — |
| `root_folder` | "Root folder" | `Text` | yes | `/data/movies` |
| `quality_profile_id` | "Quality profile id" | `Number` | yes | `1` |
| `minimum_availability` | "Minimum availability" | `Select` | yes | `released` (options: `announced`, `inCinemas`, `released`, `preDB`) |
| `tag` | "Auto-apply tag" | `Text` | no | — |

## Behaviour summary

Symmetric to Sonarr (PROV-005):

- `TestConnectionAsync` → `GET /api/v3/system/status`
- `SearchAsync` → in-library via `GET /api/v3/movie`, lookup via `GET /api/v3/movie/lookup?term=`.
- `RequestAsync` → flip monitored or `POST /api/v3/movie` with `tmdbId`, `cfg.root_folder`, `cfg.quality_profile_id`, `cfg.minimum_availability`. Trigger `MoviesSearch` command. Idempotent on conflict.
- `GetRequestStatusesAsync` → monitored movies missing files; queue items → `InProgress`.
- `IndexAsync` → `GET /api/v3/movie` paginated.
- `GetCalendarAsync` → `GET /api/v3/calendar?start=…&end=…`. Map → `CalendarEntry`.

## Coexistence with Jellyseerr

Both PROV-002 (Jellyseerr) and PROV-006 can be enabled. The aggregator
will dedupe by `(MediaType, ExternalId)` — Radarr's `tmdbId` matches
Jellyseerr's. For requests, the admin should prefer one or the other on
the Discover UI to avoid double-submits — this is a UI-level concern for
a future enhancement, not a provider concern.

## Acceptance criteria

- TestConnection ok.
- Calendar populated with real movie release dates.
- Adding a movie via Radarr provider results in a quality-profile-correct
  download.

---

Status: queued — Phase 2
