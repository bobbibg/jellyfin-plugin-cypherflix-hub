# PROV-005 — Sonarr provider (Phase 2)

**Goal:** direct `IMediaProvider` for Sonarr — gives us proper TV calendar
data and lets a dedicated **anime Sonarr instance** sit alongside the
standard one, each with its own quality profile, root folder, and tag set.

Currently we lean on Jellyseerr (PROV-002) to bridge to Sonarr/Radarr.
Jellyseerr covers request submission well, but the calendar feed is
indirect and quality-profile control per-anime/per-standard is awkward via
Jellyseerr. A first-class Sonarr provider closes that gap.

## Inputs

- Sonarr v4 API: https://sonarr.tv/docs/api/
- Existing homelab Sonarr at http://192.168.1.165:7300 (CLAUDE.md)
- For the anime instance, the user is expected to deploy a second Sonarr
  container (e.g. `sonarr-anime` on a new port) before configuring this
  provider — out of scope for this task

## Files

- `Providers/Sonarr/SonarrProvider.cs`
- `Providers/Sonarr/SonarrClient.cs`
- `Providers/Sonarr/Dtos.cs`

## Type metadata

| Member | Value |
|---|---|
| `TypeId` | `"sonarr"` |
| `DisplayName` | `"Sonarr"` |
| `Description` | `"TV management. Multi-instance — configure standard + anime instances separately."` |
| `IconUrl` | `"https://raw.githubusercontent.com/Sonarr/Sonarr/develop/Logo/256.png"` |
| `SupportedMediaTypes` | `[TvShow]` |
| `SupportedCapabilities` | `[Search, Index, Request, RequestStatus, Calendar]` |

### Config schema

| Key | Label | Type | Required | Default | Description |
|---|---|---|---|---|---|
| `url` | "URL" | `Url` | yes | `http://192.168.1.165:7300` | LAN URL |
| `api_key` | "API Key" | `ApiKey` | yes | — | Sonarr Settings → General |
| `series_type` | "Series type" | `Select` | yes | `standard` | Options: `standard`, `daily`, `anime`. Drives the default `seriesType` on new series. |
| `root_folder` | "Root folder" | `Text` | yes | `/data/tv` | Used when adding new series |
| `quality_profile_id` | "Quality profile id" | `Number` | yes | `1` | From `GET /api/v3/qualityprofile` |
| `language_profile_id` | "Language profile id" | `Number` | no | — | From `GET /api/v3/languageprofile` (anime instances often want JA→EN) |
| `tag` | "Auto-apply tag" | `Text` | no | — | Optional tag for routing/filtering |

## Behaviour summary

- `TestConnectionAsync` → `GET /api/v3/system/status`
- `SearchAsync` → two-phase like Readarr:
  1. `GET /api/v3/series` filtered by title for in-library hits
  2. `GET /api/v3/series/lookup?term=…` for not-yet-added
- `RequestAsync` → if series exists + unmonitored: `PUT /api/v3/series/{id}` to flip monitored, then `POST /api/v3/command { name:"SeriesSearch", seriesId:[id] }`. If new: `POST /api/v3/series` with `seriesType = cfg.series_type`, then trigger the search command. Idempotent on conflict.
- `GetRequestStatusesAsync` → series with `monitored=true && statistics.episodeFileCount < statistics.episodeCount`. Map queue items → `InProgress` with `ProgressPercent`.
- `IndexAsync` → `GET /api/v3/series` paginated, monitored only for the first cut.
- `GetCalendarAsync` → `GET /api/v3/calendar?start=…&end=…`. Map → `CalendarEntry`. Subtitle = "S{season}E{episode} {title}".

## Multi-instance note

Both standard and anime Sonarrs are SEPARATE INSTANCES of this same
provider type. The aggregator naturally combines their results. `series_type`
should match the typical content of the instance, but Sonarr enforces it
per-series anyway — it's just the default for new adds.

## Acceptance criteria

- TestConnection ok against either standard or anime Sonarr.
- Calendar shows real TV release dates (replacing the empty Jellyseerr
  calendar feed for TV).
- Anime series added through the anime Sonarr instance pick up the right
  quality + language profiles.

---

Status: queued — Phase 2, start after Phase 1 brief lands
