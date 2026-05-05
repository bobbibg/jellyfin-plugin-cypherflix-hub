# PROV-007 — Librarr provider (Phase 2)

**Goal:** `IMediaProvider` for **Librarr** — a self-hosted book / audiobook
/ manga search-and-download manager that searches 13 sources (Anna's
Archive among them), exposes Torznab + OPDS feeds, and auto-imports into
Calibre / Audiobookshelf / Kavita / Komga.

Source: https://github.com/JeremiahM37/librarr

This complements PROV-003 (Readarr) by providing a much broader search
surface (13 sources vs Readarr's Prowlarr/Usenet pipeline), at the cost of
some metadata polish.

## Pre-flight

Before writing code, the agent on this task MUST:

1. Confirm Librarr's current API surface (it's an actively-developed
   project — verify against the deployed instance, not a snapshot).
2. Document the API in JELLYFIN-INTEGRATION.md (or a new
   THIRD-PARTY-APIS.md if it's getting crowded).
3. Confirm whether Librarr exposes a REST API for search + request, or
   whether we should integrate via Torznab/OPDS protocols.
4. Decide how Librarr coexists with Readarr — they may target
   overlapping libraries. The aggregator's `(TypeId, ExternalId)` dedupe
   should handle most cases.

## Inputs

- Librarr GitHub: https://github.com/JeremiahM37/librarr
- Anna's Archive metadata: not direct (Librarr is the broker)
- Existing PROV-003 (Readarr) for the contract pattern to follow

## Files

- `Providers/Librarr/LibrarrProvider.cs`
- `Providers/Librarr/LibrarrClient.cs`
- `Providers/Librarr/Dtos.cs`

## Type metadata (provisional — confirm during pre-flight)

| Member | Value |
|---|---|
| `TypeId` | `"librarr"` |
| `DisplayName` | `"Librarr"` |
| `Description` | `"Book / audiobook / manga search across 13 sources (Anna's Archive et al.) with auto-import."` |
| `IconUrl` | (look up upstream logo) |
| `SupportedMediaTypes` | `[Book, Audiobook, Comic]` (manga maps to Comic for now — see PROV-003) |
| `SupportedCapabilities` | `[Search, Request, RequestStatus]` (defer `Index` and `Calendar` until we know if Librarr exposes that data) |

### Config schema (provisional)

| Key | Label | Type | Required | Default |
|---|---|---|---|---|
| `url` | "URL" | `Url` | yes | `http://192.168.1.165:<port>` |
| `api_key` | "API Key" | `ApiKey` | yes | — |
| `media_type` | "Library media type" | `Select` | yes | `book` (options: `book`, `audiobook`, `comic`, `manga`) |
| `import_target` | "Import target" | `Select` | no | `audiobookshelf` (options: `calibre`, `audiobookshelf`, `kavita`, `komga`) |
| `confidence_threshold` | "Auto-import confidence threshold (0-100)" | `Number` | no | `80` |

## Behaviour (provisional)

Map to Librarr's actual endpoints once verified. Expected shape:

- `TestConnectionAsync` → some `GET /api/...` health check
- `SearchAsync` → multi-source search; surface result confidence in
  `SearchResult.Tags` so the UI can sort by it
- `RequestAsync` → submit a download for the chosen result (highest
  confidence by default), idempotent on existing item
- `GetRequestStatusesAsync` → queue + completed list

## Coexistence with Anna's Archive directly

Don't try to call Anna's Archive's HTML/scraping endpoints from this
plugin. Librarr is the broker and handles rate-limiting, mirror failover,
and legal positioning. Cypherflix Hub stays on the Librarr API surface
only.

## Acceptance criteria

- TestConnection ok against a deployed Librarr.
- Search returns results from at least 3 of Librarr's 13 sources.
- Request creates a download in Librarr's queue and (eventually) a file
  in the chosen import target.
- Re-requesting an existing item returns the existing record.

---

Status: queued — Phase 2 — BLOCKED on Librarr deployment + API verification.
If picked up before that, ship a stub that returns empty results, like
PROV-004.
