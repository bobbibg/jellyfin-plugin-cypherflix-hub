# SVC-003 — SearchAggregator

**Goal:** answer "search across everything" by combining the Meilisearch
catalogue with live `SearchAsync` calls, then decorating with library +
request-pending state.

## Files

- `Services/Aggregators/SearchAggregator.cs`

## Public surface

```csharp
public class SearchAggregator
{
    public SearchAggregator(
        ProviderRegistry registry,
        MeilisearchClient meili,
        RequestAggregator requests,            // injected, see SVC-004
        ILogger<SearchAggregator> logger);

    public Task<IReadOnlyList<SearchResult>> SearchAsync(
        SearchQuery query,
        string callingUserId,
        CancellationToken ct);
}
```

## Algorithm

1. Snapshot config; build the list of `(typeId, instanceId)` pairs that have
   `Enabled=true` + `Search` capability.
2. **Indexed search** (fast): query Meilisearch via
   `MeilisearchClient.SearchAsync(...)`, mapping results to `SearchResult`
   with `InLibrary=false, RequestPending=false` initially.
3. **Live search** (parallel, may return new hits not yet indexed): for
   each provider with `Search` capability, fan out
   `provider.SearchAsync(query, cfg, ct)` with a 3-second timeout per
   provider. Merge into the result set, deduping by
   `(ProviderTypeId, ExternalId)`.
4. **Library decoration:** for any hit with `MediaType` ∈ {Movie, TvShow,
   Book, Comic, Audiobook, Music}, look up the Jellyfin index
   (provider type `jellyfin`) for a match by title+year+mediaType. If
   found, set `InLibrary=true` and `JellyfinItemId`.
5. **Request decoration:** call
   `requests.GetForUserAsync(callingUserId, ct)` once. For each hit,
   `RequestPending=true` if there's a non-completed request matching
   `(ProviderTypeId, ExternalId)` or, fallback, by title+year+mediaType.
6. Apply `query.TypesFilter` and pagination, return.

## Failure handling

- Meilisearch unreachable → log, skip step 2, rely on live search.
- Any one provider's live search throwing → log warning, drop that
  provider's contribution.
- Empty result set is a valid response.

## Acceptance criteria

- Returns ≤ `query.Limit` results.
- A book in the Jellyfin library has `InLibrary=true, JellyfinItemId` set.
- A movie with an open Jellyseerr request has `RequestPending=true`.
- A 3-second hang in one provider does not stall the whole call.

---

Status: not-started — needs CORE, SVC-001, SVC-004
