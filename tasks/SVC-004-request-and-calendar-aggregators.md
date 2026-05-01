# SVC-004 — RequestAggregator + CalendarAggregator

**Goal:** the two simple fan-out aggregators backing the Requests and
Calendar tabs.

## Files

- `Services/Aggregators/RequestAggregator.cs`
- `Services/Aggregators/CalendarAggregator.cs`

## RequestAggregator surface

```csharp
public class RequestAggregator
{
    public RequestAggregator(ProviderRegistry registry,
                             ILogger<RequestAggregator> logger);

    /// <summary>All requests for the calling user, across providers.</summary>
    public Task<IReadOnlyList<RequestStatus>> GetForUserAsync(
        string userId, CancellationToken ct);

    /// <summary>Submit a new request to one specific provider instance.</summary>
    public Task<RequestSubmissionResult> SubmitAsync(
        Guid providerInstanceId,
        RequestPayload payload,
        CancellationToken ct);
}
```

### `GetForUserAsync`

1. Snapshot config, find `(typeId, instanceId)` pairs with `Enabled=true`
   and `RequestStatus` capability.
2. Fan out `provider.GetRequestStatusesAsync(userId, cfg, ct)` in parallel
   with a 5-sec per-provider timeout.
3. Merge, sort by `CreatedAt` desc.

### `SubmitAsync`

1. Find the `ProviderInstance` by `Id`. 404 (return `Ok=false`) if not found
   or not enabled or doesn't have `Request` capability.
2. Resolve provider, hydrate `ProviderConfig`.
3. `await provider.RequestAsync(payload, cfg, ct)` and return as-is.

## CalendarAggregator surface

```csharp
public class CalendarAggregator
{
    public CalendarAggregator(ProviderRegistry registry,
                              ILogger<CalendarAggregator> logger);

    public Task<IReadOnlyList<CalendarEntry>> GetAsync(
        CalendarQuery query,
        CancellationToken ct);
}
```

### `GetAsync`

1. Snapshot config, find `(typeId, instanceId)` pairs with `Calendar`
   capability + `Enabled`.
2. Fan out in parallel with a 5-sec per-provider timeout.
3. Merge, sort by `ReleaseDate` asc.
4. Apply `query.TypesFilter` if set.

## Failure handling

- A provider erroring → log warning, drop its contribution. Never propagate.
- Empty result is valid.

## Acceptance criteria

- `GetForUserAsync` for a user with no requests returns empty list.
- `SubmitAsync` hits the right provider and returns its `RequestSubmissionResult`.
- `CalendarAggregator.GetAsync(start=now, end=now+30d)` returns upcoming
  Sonarr/Radarr/Readarr entries via Jellyseerr or future TV/movie providers.

---

Status: not-started — needs CORE
