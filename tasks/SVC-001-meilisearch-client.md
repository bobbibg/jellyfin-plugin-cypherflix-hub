# SVC-001 — MeilisearchClient

**Goal:** thin wrapper over the official `Meilisearch` NuGet package
(version 0.15.4, already in `.csproj`) that hides the per-instance index
naming convention from the rest of the code.

## Files

- `Services/MeilisearchClient.cs`

## Public surface

```csharp
public class MeilisearchClient
{
    public MeilisearchClient(ILogger<MeilisearchClient> logger);

    /// <summary>Returns null if Meilisearch isn't configured.</summary>
    public Meilisearch.MeilisearchClient? GetRaw();

    /// <summary>Index name for one provider instance.</summary>
    public string IndexName(string providerTypeId, Guid instanceId);

    /// <summary>Idempotent: creates index + sets searchable/filterable attrs.</summary>
    public Task EnsureIndexAsync(string providerTypeId, Guid instanceId, CancellationToken ct);

    /// <summary>Apply an IndexBatch to the provider's index.</summary>
    public Task ApplyAsync(string providerTypeId, Guid instanceId,
                           Core.IndexBatch batch, CancellationToken ct);

    /// <summary>Multi-index search across the listed instances. Merges + dedupes by Id.</summary>
    public Task<IReadOnlyList<Core.IndexDocument>> SearchAsync(
        IEnumerable<(string TypeId, Guid InstanceId)> instances,
        string query,
        IReadOnlySet<Core.MediaType>? typeFilter,
        int limit, int offset,
        CancellationToken ct);
}
```

## Index name convention

```
cypherflix_<typeId>_<first8charsOfInstanceId>
```

e.g. `cypherflix_readarr_a1b2c3d4`. Lowercase only, no special chars
(Meilisearch indexes don't allow them).

## Index settings (set in `EnsureIndexAsync`)

```csharp
var settings = new Settings {
    SearchableAttributes = new[] { "title", "subtitle", "description", "tags" },
    FilterableAttributes = new[] { "mediaType", "year", "tags" },
    SortableAttributes = new[] { "year" },
    DisplayedAttributes = new[] { "*" }
};
await index.UpdateSettingsAsync(settings);
```

## Reading config

`Plugin.Instance!.Configuration.MeilisearchUrl` and `MeilisearchApiKey`. If
either is empty/null, `GetRaw()` returns `null` and all public methods
return empty results / no-ops with a log warning.

## Acceptance criteria

- `EnsureIndexAsync` is idempotent — calling twice doesn't error.
- `ApplyAsync` with `Replace=true` clears the index first.
- `ApplyAsync` with `DeleteIds` non-null deletes those before adding new docs.
- `SearchAsync` across two indexes returns merged hits ordered by
  Meilisearch's relevance score (sum-merge ranks).

## Verification

After deploy, with at least one provider indexed:

```bash
curl -s "http://192.168.1.165:<meili-port>/indexes" \
  -H "Authorization: Bearer $MEILI_KEY" | jq
```

Should list `cypherflix_*` indexes.

---

Status: needs-review
