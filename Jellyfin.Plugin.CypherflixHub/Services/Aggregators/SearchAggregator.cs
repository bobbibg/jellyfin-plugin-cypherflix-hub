using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Configuration;
using Jellyfin.Plugin.CypherflixHub.Core;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Services.Aggregators;

/// <summary>
/// Fan-out aggregator that powers the Discover tab. Combines:
/// <list type="number">
///   <item><description>The Meilisearch catalogue (one index per configured
///     provider instance) for fast browse-style results.</description></item>
///   <item><description>Live <see cref="IMediaProvider.SearchAsync"/> calls
///     fanned out in parallel for "request something not yet indexed"
///     coverage (e.g. a brand-new movie).</description></item>
/// </list>
/// then decorates the merged hits with two pieces of per-user state:
/// <list type="bullet">
///   <item><description><c>InLibrary</c> + <c>JellyfinItemId</c> when the
///     hit matches an item already in the user's Jellyfin library
///     (looked up via the <c>jellyfin</c>-typed Meilisearch indexes).</description></item>
///   <item><description><c>RequestPending</c> when the calling user has
///     an open request for the hit (via
///     <see cref="RequestAggregator.GetForUserAsync"/>).</description></item>
/// </list>
///
/// <para>Per-provider live search calls are wrapped in a 3-second timeout
/// using a linked <see cref="CancellationTokenSource"/> with
/// <see cref="CancellationTokenSource.CancelAfter(TimeSpan)"/>. Any exception
/// or timeout drops that provider's contribution rather than propagating
/// — see ARCHITECTURE.md §6.1 and tasks/SVC-003-search-aggregator.md.</para>
/// </summary>
public class SearchAggregator
{
    /// <summary>
    /// Per-provider live-search timeout. Tighter than the
    /// <see cref="AggregatorHelpers.PerProviderTimeout"/> shared budget
    /// because the Discover tab fires this on every keystroke.
    /// </summary>
    private static readonly TimeSpan LiveSearchTimeout = TimeSpan.FromSeconds(3);

    /// <summary>The TypeId of the local Jellyfin library provider, used for library decoration.</summary>
    private const string JellyfinTypeId = "jellyfin";

    /// <summary>How many candidates to pull from the Jellyfin index per decoration lookup. First-cut value.</summary>
    private const int LibraryLookupLimit = 10;

    private static readonly HashSet<MediaType> LibraryDecoratableTypes = new()
    {
        MediaType.Movie,
        MediaType.TvShow,
        MediaType.Book,
        MediaType.Comic,
        MediaType.Audiobook,
        MediaType.Music,
    };

    private readonly ProviderRegistry _registry;
    private readonly MeilisearchClient _meili;
    private readonly RequestAggregator _requests;
    private readonly ILogger<SearchAggregator> _logger;

    public SearchAggregator(
        ProviderRegistry registry,
        MeilisearchClient meili,
        RequestAggregator requests,
        ILogger<SearchAggregator> logger)
    {
        _registry = registry;
        _meili = meili;
        _requests = requests;
        _logger = logger;
    }

    /// <summary>
    /// Run the full unified-search pipeline: indexed search, live search,
    /// library + request decoration, type filter, pagination. See class summary
    /// for the algorithm and failure semantics.
    /// </summary>
    public async Task<IReadOnlyList<SearchResult>> SearchAsync(
        SearchQuery query,
        string callingUserId,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);

        // -------------------------------------------------------------------
        // 1. Snapshot config and build the list of (typeId, instanceId) pairs
        //    that have Enabled=true and the Search capability enabled.
        // -------------------------------------------------------------------
        PluginConfiguration? config = Plugin.Instance?.Configuration;
        ProviderInstance[] allInstances = config?.Providers ?? Array.Empty<ProviderInstance>();

        List<SearchableInstance> searchable = new();
        foreach (ProviderInstance instance in allInstances)
        {
            if (!instance.Enabled)
            {
                continue;
            }

            HashSet<Capability> capabilities = AggregatorHelpers.ParseCapabilities(instance.EnabledCapabilities);
            if (!capabilities.Contains(Capability.Search))
            {
                continue;
            }

            searchable.Add(new SearchableInstance(instance, capabilities));
        }

        // Dedup buffer keyed by (ProviderTypeId, ExternalId).
        Dictionary<DedupKey, SearchResult> hits = new();

        // -------------------------------------------------------------------
        // 2. Indexed search via Meilisearch. Provenance is not preserved by
        //    MeilisearchClient.SearchAsync (it merges across indexes), so we
        //    iterate per-instance and call it with a single-element list to
        //    recover (typeId, instanceId) for each hit.
        // -------------------------------------------------------------------
        foreach (SearchableInstance s in searchable)
        {
            if (ct.IsCancellationRequested)
            {
                break;
            }

            IReadOnlyList<IndexDocument> indexHits;
            try
            {
                indexHits = await _meili.SearchAsync(
                    new[] { (s.Instance.TypeId, s.Instance.Id) },
                    query.Query,
                    query.TypesFilter,
                    query.Limit,
                    query.Offset,
                    ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Meilisearch lookup failed for provider instance '{InstanceName}' ({InstanceId}, type {TypeId}); skipping its indexed contribution.",
                    s.Instance.Name,
                    s.Instance.Id,
                    s.Instance.TypeId);
                continue;
            }

            foreach (IndexDocument doc in indexHits)
            {
                SearchResult mapped = MapIndexDocument(doc, s.Instance);
                DedupKey key = new(mapped.ProviderTypeId, mapped.ExternalId);
                hits.TryAdd(key, mapped);
            }
        }

        // -------------------------------------------------------------------
        // 3. Live search: fan out provider.SearchAsync(...) in parallel with a
        //    3-second per-provider timeout (linked CTS + CancelAfter, NOT
        //    Task.WhenAny+Delay). Any exception/timeout drops that provider's
        //    contribution and is logged.
        // -------------------------------------------------------------------
        List<Task<IReadOnlyList<SearchResult>>> liveTasks = new(searchable.Count);
        foreach (SearchableInstance s in searchable)
        {
            IMediaProvider? provider = _registry.Get(s.Instance.TypeId);
            if (provider is null)
            {
                _logger.LogWarning(
                    "Provider instance '{InstanceName}' ({InstanceId}) references unknown type '{TypeId}'; skipping live search.",
                    s.Instance.Name,
                    s.Instance.Id,
                    s.Instance.TypeId);
                continue;
            }

            ProviderConfig cfg = AggregatorHelpers.HydrateConfig(s.Instance, s.Capabilities);

            // Capture loop variables so each task closes over its own instance.
            ProviderInstance capturedInstance = s.Instance;
            IMediaProvider capturedProvider = provider;
            liveTasks.Add(InvokeLiveSearchAsync(capturedProvider, capturedInstance, query, cfg, ct));
        }

        if (liveTasks.Count > 0)
        {
            IReadOnlyList<SearchResult>[] liveResults = await Task.WhenAll(liveTasks).ConfigureAwait(false);
            foreach (IReadOnlyList<SearchResult> contribution in liveResults)
            {
                foreach (SearchResult hit in contribution)
                {
                    DedupKey key = new(hit.ProviderTypeId, hit.ExternalId);
                    // Live results are authoritative for the same key — they
                    // may carry richer fields (e.g. provider-set ExternalUrl)
                    // than the indexed snapshot, so prefer them on conflict.
                    hits[key] = hit;
                }
            }
        }

        // -------------------------------------------------------------------
        // 4. Library decoration. For hits in {Movie, TvShow, Book, Comic,
        //    Audiobook, Music}, look them up in the Jellyfin index by title +
        //    (year if both have one) + mediaType. If a match is found, set
        //    InLibrary=true and JellyfinItemId on the hit.
        //
        //    Optimisation: TODO — batch by mediaType to reduce round-trips.
        //    First cut does one Meilisearch lookup per decoratable hit.
        // -------------------------------------------------------------------
        IReadOnlyList<(string TypeId, Guid InstanceId)> jellyfinIndexes = BuildJellyfinIndexInstances(allInstances);

        if (jellyfinIndexes.Count > 0)
        {
            // Snapshot the values BEFORE iteration: we are going to replace
            // entries in `hits` (init-only properties → with-style copy → new instance).
            List<KeyValuePair<DedupKey, SearchResult>> snapshot = hits.ToList();
            foreach (KeyValuePair<DedupKey, SearchResult> kvp in snapshot)
            {
                if (ct.IsCancellationRequested)
                {
                    break;
                }

                SearchResult hit = kvp.Value;

                // Don't double-decorate: Jellyfin-provider hits already have
                // InLibrary=true + JellyfinItemId set by JellyfinProvider.
                if (hit.InLibrary)
                {
                    continue;
                }

                if (!LibraryDecoratableTypes.Contains(hit.MediaType))
                {
                    continue;
                }

                IReadOnlyList<IndexDocument> candidates;
                try
                {
                    candidates = await _meili.SearchAsync(
                        jellyfinIndexes,
                        hit.Title,
                        new HashSet<MediaType> { hit.MediaType },
                        LibraryLookupLimit,
                        0,
                        ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex,
                        "Library-decoration lookup failed for hit '{Title}' ({MediaType}); leaving InLibrary=false.",
                        hit.Title,
                        hit.MediaType);
                    continue;
                }

                IndexDocument? match = FindLibraryMatch(hit, candidates);
                if (match is not null)
                {
                    SearchResult decorated = WithLibrary(hit, match.Id);
                    hits[kvp.Key] = decorated;
                }
            }
        }

        // -------------------------------------------------------------------
        // 5. Request decoration. Call requests.GetForUserAsync(...) ONCE.
        //    For each hit, set RequestPending=true if there's a non-completed
        //    matching request — primary match by (ProviderTypeId, ExternalId),
        //    fallback by title + (year if both have one) + mediaType.
        // -------------------------------------------------------------------
        IReadOnlyList<RequestStatus>? userRequests = null;
        if (!string.IsNullOrEmpty(callingUserId))
        {
            try
            {
                userRequests = await _requests.GetForUserAsync(callingUserId, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "RequestAggregator.GetForUserAsync failed for user {UserId}; skipping request decoration.",
                    callingUserId);
            }
        }

        if (userRequests is { Count: > 0 })
        {
            HashSet<RequestKey> openExact = new();
            List<RequestStatus> openByMeta = new();
            foreach (RequestStatus rs in userRequests)
            {
                if (!IsOpen(rs.State))
                {
                    continue;
                }

                openExact.Add(new RequestKey(rs.ProviderTypeId, rs.ExternalId));
                openByMeta.Add(rs);
            }

            if (openExact.Count > 0)
            {
                List<KeyValuePair<DedupKey, SearchResult>> snapshot = hits.ToList();
                foreach (KeyValuePair<DedupKey, SearchResult> kvp in snapshot)
                {
                    SearchResult hit = kvp.Value;
                    if (hit.RequestPending)
                    {
                        continue;
                    }

                    bool matches = openExact.Contains(new RequestKey(hit.ProviderTypeId, hit.ExternalId));
                    if (!matches)
                    {
                        // Fallback: title + (year if both have one) + mediaType.
                        foreach (RequestStatus rs in openByMeta)
                        {
                            if (MetaMatch(hit.Title, hit.Year, hit.MediaType, rs.Title, year: null, rs.MediaType))
                            {
                                matches = true;
                                break;
                            }
                        }
                    }

                    if (matches)
                    {
                        hits[kvp.Key] = WithRequestPending(hit);
                    }
                }
            }
        }

        // -------------------------------------------------------------------
        // 6. Apply types filter (live providers may have ignored it) and
        //    paginate. Order is best-effort — Meilisearch already orders by
        //    ranking score; we keep insertion order for stability.
        // -------------------------------------------------------------------
        IEnumerable<SearchResult> filtered = hits.Values;
        if (query.TypesFilter is { Count: > 0 })
        {
            IReadOnlySet<MediaType> filter = query.TypesFilter;
            filtered = filtered.Where(r => filter.Contains(r.MediaType));
        }

        int offset = Math.Max(0, query.Offset);
        int limit = Math.Max(0, query.Limit);
        return filtered.Skip(offset).Take(limit).ToArray();
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Run one provider's live search inside a 3-second timeout. Uses a linked
    /// <see cref="CancellationTokenSource"/> so the underlying work sees the
    /// cancellation and can abort cleanly (no <see cref="Task.WhenAny(Task[])"/>
    /// + <see cref="Task.Delay(TimeSpan)"/> task-leak pattern).
    /// </summary>
    private async Task<IReadOnlyList<SearchResult>> InvokeLiveSearchAsync(
        IMediaProvider provider,
        ProviderInstance instance,
        SearchQuery query,
        ProviderConfig cfg,
        CancellationToken ct)
    {
        using CancellationTokenSource cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(LiveSearchTimeout);

        try
        {
            return await provider.SearchAsync(query, cfg, cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            _logger.LogWarning(
                "Live search timed out after {TimeoutSeconds}s for provider instance '{InstanceName}' ({InstanceId}, type {TypeId}); dropping its contribution.",
                LiveSearchTimeout.TotalSeconds,
                instance.Name,
                instance.Id,
                instance.TypeId);
            return Array.Empty<SearchResult>();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Live search failed for provider instance '{InstanceName}' ({InstanceId}, type {TypeId}); dropping its contribution.",
                instance.Name,
                instance.Id,
                instance.TypeId);
            return Array.Empty<SearchResult>();
        }
    }

    /// <summary>
    /// Map a Meilisearch <see cref="IndexDocument"/> back into a
    /// <see cref="SearchResult"/>. The <c>jellyfin</c>-type provider's index
    /// docs use the Jellyfin item id as their <see cref="IndexDocument.Id"/>,
    /// so we hydrate <c>InLibrary=true</c> + <c>JellyfinItemId</c> directly
    /// without needing a second lookup.
    /// </summary>
    private static SearchResult MapIndexDocument(IndexDocument doc, ProviderInstance instance)
    {
        bool isJellyfin = string.Equals(instance.TypeId, JellyfinTypeId, StringComparison.OrdinalIgnoreCase);

        return new SearchResult
        {
            ProviderTypeId = instance.TypeId,
            ProviderInstanceId = instance.Id,
            ExternalId = doc.Id,
            MediaType = doc.MediaType,
            Title = doc.Title,
            Subtitle = doc.Subtitle,
            Description = doc.Description,
            PosterUrl = doc.PosterUrl,
            Year = doc.Year,
            Tags = doc.Tags,
            InLibrary = isJellyfin,
            JellyfinItemId = isJellyfin ? doc.Id : null,
            RequestPending = false,
        };
    }

    /// <summary>
    /// Build the list of (typeId, instanceId) pairs for every enabled
    /// Jellyfin-typed provider instance. Used as the search target set when
    /// decorating non-Jellyfin hits with <c>InLibrary</c>.
    /// </summary>
    private static IReadOnlyList<(string TypeId, Guid InstanceId)> BuildJellyfinIndexInstances(
        ProviderInstance[] allInstances)
    {
        List<(string TypeId, Guid InstanceId)> list = new();
        foreach (ProviderInstance instance in allInstances)
        {
            if (!instance.Enabled)
            {
                continue;
            }

            if (!string.Equals(instance.TypeId, JellyfinTypeId, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            list.Add((instance.TypeId, instance.Id));
        }

        return list;
    }

    /// <summary>
    /// Find the first Jellyfin-index candidate that matches a hit by
    /// case-insensitive title + (year if both have one) + mediaType.
    /// Returns <c>null</c> if nothing matches.
    /// </summary>
    private static IndexDocument? FindLibraryMatch(SearchResult hit, IReadOnlyList<IndexDocument> candidates)
    {
        foreach (IndexDocument candidate in candidates)
        {
            if (candidate.MediaType != hit.MediaType)
            {
                continue;
            }

            if (!string.Equals(candidate.Title, hit.Title, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (hit.Year.HasValue && candidate.Year.HasValue && hit.Year.Value != candidate.Year.Value)
            {
                continue;
            }

            return candidate;
        }

        return null;
    }

    /// <summary>
    /// Match a hit against a request status by case-insensitive title +
    /// (year if both have one) + mediaType. Year is treated as
    /// <c>nullable + only-compared-when-both-set</c> per the spec.
    /// </summary>
    private static bool MetaMatch(
        string hitTitle,
        int? hitYear,
        MediaType hitType,
        string rsTitle,
        int? year,
        MediaType rsType)
    {
        if (hitType != rsType)
        {
            return false;
        }

        if (!string.Equals(hitTitle, rsTitle, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (hitYear.HasValue && year.HasValue && hitYear.Value != year.Value)
        {
            return false;
        }

        return true;
    }

    /// <summary>
    /// "Open" = state is something we still want to flag in the UI. Per the
    /// spec, we exclude terminal states (Available / Failed / Declined).
    /// </summary>
    private static bool IsOpen(RequestState state) => state switch
    {
        RequestState.Pending => true,
        RequestState.Approved => true,
        RequestState.InProgress => true,
        RequestState.Available => false,
        RequestState.Failed => false,
        RequestState.Declined => false,
        _ => false,
    };

    /// <summary>
    /// Returns a copy of <paramref name="hit"/> with <c>InLibrary=true</c> and
    /// <c>JellyfinItemId</c> set. <see cref="SearchResult"/> uses init-only
    /// setters so we have to recreate it.
    /// </summary>
    private static SearchResult WithLibrary(SearchResult hit, string jellyfinItemId) => new()
    {
        ProviderTypeId = hit.ProviderTypeId,
        ProviderInstanceId = hit.ProviderInstanceId,
        ExternalId = hit.ExternalId,
        MediaType = hit.MediaType,
        Title = hit.Title,
        Subtitle = hit.Subtitle,
        Description = hit.Description,
        PosterUrl = hit.PosterUrl,
        BackdropUrl = hit.BackdropUrl,
        Year = hit.Year,
        Rating = hit.Rating,
        Tags = hit.Tags,
        InLibrary = true,
        JellyfinItemId = jellyfinItemId,
        RequestPending = hit.RequestPending,
        ExternalUrl = hit.ExternalUrl,
    };

    /// <summary>
    /// Returns a copy of <paramref name="hit"/> with <c>RequestPending=true</c>.
    /// </summary>
    private static SearchResult WithRequestPending(SearchResult hit) => new()
    {
        ProviderTypeId = hit.ProviderTypeId,
        ProviderInstanceId = hit.ProviderInstanceId,
        ExternalId = hit.ExternalId,
        MediaType = hit.MediaType,
        Title = hit.Title,
        Subtitle = hit.Subtitle,
        Description = hit.Description,
        PosterUrl = hit.PosterUrl,
        BackdropUrl = hit.BackdropUrl,
        Year = hit.Year,
        Rating = hit.Rating,
        Tags = hit.Tags,
        InLibrary = hit.InLibrary,
        JellyfinItemId = hit.JellyfinItemId,
        RequestPending = true,
        ExternalUrl = hit.ExternalUrl,
    };

    /// <summary>One enabled, search-capable provider instance + its parsed capabilities.</summary>
    private readonly record struct SearchableInstance(ProviderInstance Instance, HashSet<Capability> Capabilities);

    /// <summary>Dedup key: provider type + the provider's external id.</summary>
    private readonly record struct DedupKey(string ProviderTypeId, string ExternalId);

    /// <summary>Open-request lookup key by (type, external-id).</summary>
    private readonly record struct RequestKey(string ProviderTypeId, string ExternalId);
}
