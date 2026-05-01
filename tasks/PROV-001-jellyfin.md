# PROV-001 — Jellyfin "self" provider

**Goal:** implement `IMediaProvider` for the local Jellyfin library so that
search/discover can mark items as `InLibrary=true` and surface a "Play"
button instead of "Request".

## Inputs

- `Core/IMediaProvider.cs` (already exists — read it first)
- `Core/Models.cs` (already exists)
- `JELLYFIN-INTEGRATION.md` §1 — class names you'll use
- The Jellyfin `ILibraryManager` API

## Files to create

- `Providers/Jellyfin/JellyfinProvider.cs` — implements `IMediaProvider`
- `Providers/Jellyfin/JellyfinClient.cs` — thin wrapper over `ILibraryManager`
  for the lookups we need (so the provider stays declarative)

## Type metadata

| Member | Value |
|---|---|
| `TypeId` | `"jellyfin"` |
| `DisplayName` | `"Jellyfin Library"` |
| `Description` | `"Your local Jellyfin library — used to mark items as already-in-library and provide Play buttons."` |
| `IconUrl` | `null` (use Jellyfin's default plugin icon) |
| `SupportedMediaTypes` | `[Movie, TvShow, Book, Comic, Audiobook, Music]` |
| `SupportedCapabilities` | `[Search, Index]` (no `Request`, no `Calendar`) |
| `ConfigSchema` | empty array — no configuration needed; this provider is implicit |

## Behaviour

- `TestConnectionAsync` — always returns `Ok=true` (no remote service).
- `SearchAsync` — uses `ILibraryManager.GetItemsResult(new InternalItemsQuery { SearchTerm = query.Query, IncludeItemTypes = … })` and translates the results to `SearchResult` with `InLibrary=true`, `JellyfinItemId=<item.Id>`, no `RequestPending`. Honour `query.Limit`/`Offset`.
- `RequestAsync` — return `RequestSubmissionResult { Ok=false, Message="Jellyfin provider does not handle requests" }`. (The aggregator will never call this because we don't declare `Request` capability — but defensive default.)
- `GetRequestStatusesAsync` — return `Array.Empty<RequestStatus>()`.
- `IndexAsync` — full snapshot of every library item with the supported media types. Return `IndexBatch { Replace = true, Documents = [...] }`. Map `BaseItem` → `IndexDocument` (`Id = item.Id.ToString("N")`, `MediaType` from `BaseItemKind`, `Title = item.Name`, `Subtitle = artist/author/year`, `PosterUrl = "/Items/{id}/Images/Primary"`, `Year = item.ProductionYear`, etc.). Cap at the first 50,000 items for the first pass; pagination can come later.
- `GetCalendarAsync` — return `Array.Empty<CalendarEntry>()`.

## Mapping `BaseItemKind` → `MediaType`

| `BaseItemKind` | `MediaType` |
|---|---|
| `Movie` | `Movie` |
| `Series`, `Season`, `Episode` | `TvShow` |
| `Book` | `Book` (from Bookshelf plugin — confirm the `BaseItemKind` name during impl) |
| `MusicAlbum`, `Audio` | `Music` |
| anything else | `Other` (skip) |

For comics (.cbz served via Bookshelf), they currently appear as `Book`
items with appropriate metadata — treat as `Book` for now and revisit if
the comics library grows a dedicated kind.

## Acceptance criteria

- Plugin builds with no warnings.
- Registering it in `PluginServiceRegistrator` does not break startup.
- `IndexAsync` returns at least one document on a non-empty library.
- `SearchAsync("dune")` returns Dune-related library items as `SearchResult`
  with `InLibrary=true`.

## Verification recipe

After deploy:

```bash
curl -s -H "X-Emby-Token: $JF_KEY" \
  "https://192.168.1.165:7900/CypherflixHub/Search?q=dune" \
  | jq '.[] | select(.InLibrary == true) | {Title, JellyfinItemId, MediaType}'
```

(Requires API-002 to be done — coordinate with that agent.)

---

Status: not-started
