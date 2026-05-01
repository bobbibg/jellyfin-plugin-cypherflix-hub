# SVC-002 — IndexerService

**Goal:** background service that periodically calls `IndexAsync` on every
configured + enabled provider instance with the `Index` capability and
applies the result to Meilisearch.

## Files

- `Services/IndexerService.cs`

## Contract

```csharp
public class IndexerService : IHostedService, IDisposable
{
    public IndexerService(
        ProviderRegistry registry,
        MeilisearchClient meili,
        ILogger<IndexerService> logger);

    Task IHostedService.StartAsync(CancellationToken ct);
    Task IHostedService.StopAsync(CancellationToken ct);
}
```

## Behaviour

- On `StartAsync`, kick off a background `Task` that loops:
  1. Read `Plugin.Instance!.Configuration` snapshot.
  2. For each `ProviderInstance` where `Enabled=true` and
     `EnabledCapabilities` contains `Index`:
     - Resolve the `IMediaProvider` by `TypeId` from `ProviderRegistry`.
     - Hydrate a `ProviderConfig`.
     - `await provider.IndexAsync(since: lastRun[instanceId], cfg, ct)`.
     - `await meili.EnsureIndexAsync(typeId, instanceId, ct)`.
     - `await meili.ApplyAsync(typeId, instanceId, batch, ct)`.
     - Update `lastRun[instanceId] = DateTime.UtcNow`.
     - On exception: log + continue (don't take the whole loop down).
  3. Sleep for `Configuration.IndexIntervalMinutes` minutes.
  4. Goto 1.
- `StopAsync` cancels the loop.

## State

`lastRun` is in-memory; on restart we redo a full pass. Don't persist it
yet — Meilisearch handles dedupe by document id, so repeated indexing is
cheap, and providers can themselves be optimised later.

## Acceptance criteria

- Startup doesn't crash if no instances are configured.
- One enabled instance produces at least one document in Meilisearch
  within `IndexIntervalMinutes`.
- An instance throwing in `IndexAsync` does not stop other instances
  from indexing.

---

Status: not-started — needs SVC-001
