# API-002 — SearchController

**Goal:** the public search endpoint the Discover tab calls.

## File

- `Api/SearchController.cs`

## Routes

```
GET /CypherflixHub/Search?q=<query>&types=<csv>&limit=25&offset=0
```

`types` is a CSV of `MediaType` enum names: `Movie,TvShow,Book,...`. Omit
to search all types.

`[Authorize]` — any authed user, no admin requirement.

## Behaviour

1. Resolve the calling Jellyfin user id from claims.
2. Build a `SearchQuery`:
   ```csharp
   new SearchQuery {
       Query = q,
       UserId = userId.ToString("N"),
       TypesFilter = parseTypes(types),
       Limit = clamp(limit, 1, 100),
       Offset = max(offset, 0)
   }
   ```
3. `await _searchAggregator.SearchAsync(query, userId.ToString("N"), ct)`.
4. Return as JSON array.

## Error handling

- Empty `q` → return empty array (not an error).
- Aggregator throwing → 500 with the message logged.

## Acceptance criteria

- `GET /CypherflixHub/Search?q=brooklyn` returns Brooklyn Nine-Nine with
  `MediaType=TvShow` and (if Jellyseerr provider configured) at least
  one entry.
- A library item gets `InLibrary=true`.

---

Status: needs-review
