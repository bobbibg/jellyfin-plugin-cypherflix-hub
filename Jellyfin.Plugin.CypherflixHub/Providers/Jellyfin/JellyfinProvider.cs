using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.CypherflixHub.Core;
using MediaBrowser.Controller.Entities;
using Microsoft.Extensions.Logging;

// Disambiguate against Jellyfin.Data.Enums.MediaType — when both namespaces
// are imported the unqualified MediaType refers to the Jellyfin enum, which
// has different members. We always mean our own.
using MediaType = Jellyfin.Plugin.CypherflixHub.Core.MediaType;

namespace Jellyfin.Plugin.CypherflixHub.Providers.Jellyfin;

/// <summary>
/// The "self" provider — the user's local Jellyfin library presented as an
/// <see cref="IMediaProvider"/>. Two roles:
/// <list type="bullet">
/// <item><description><b>Search</b> — the search aggregator decorates external
/// search hits with <c>InLibrary=true</c> (and the <c>JellyfinItemId</c> for
/// the Play button) when this provider also returns the same item.</description></item>
/// <item><description><b>Index</b> — the indexer service writes this provider's
/// snapshot into Meilisearch so the Discover tab can browse the local library
/// alongside everything else.</description></item>
/// </list>
/// The provider declares no <see cref="Capability.Request"/> /
/// <see cref="Capability.RequestStatus"/> / <see cref="Capability.Calendar"/> —
/// the framework will not call those methods, but we return safe empties just
/// in case.
/// </summary>
public class JellyfinProvider : IMediaProvider
{
    /// <summary>Cap on the number of items we ship in a single index pass.
    /// Pagination is post-MVP.</summary>
    private const int MaxIndexItems = 50_000;

    private readonly JellyfinClient _client;
    private readonly ILogger<JellyfinProvider> _logger;

    public JellyfinProvider(JellyfinClient client, ILogger<JellyfinProvider> logger)
    {
        _client = client;
        _logger = logger;
    }

    /// <inheritdoc />
    public string TypeId => "jellyfin";

    /// <inheritdoc />
    public string DisplayName => "Jellyfin Library";

    /// <inheritdoc />
    public string Description =>
        "Your local Jellyfin library — used to mark items as already-in-library and provide Play buttons.";

    /// <inheritdoc />
    public string? IconUrl => null;

    /// <inheritdoc />
    public IReadOnlyList<MediaType> SupportedMediaTypes { get; } = new[]
    {
        MediaType.Movie,
        MediaType.TvShow,
        MediaType.Book,
        MediaType.Comic,
        MediaType.Audiobook,
        MediaType.Music,
    };

    /// <inheritdoc />
    public IReadOnlyList<Capability> SupportedCapabilities { get; } = new[]
    {
        Capability.Search,
        Capability.Index,
    };

    /// <inheritdoc />
    public IReadOnlyList<ConfigField> ConfigSchema { get; } = Array.Empty<ConfigField>();

    /// <inheritdoc />
    public Task<TestResult> TestConnectionAsync(ProviderConfig cfg, CancellationToken ct)
    {
        // The local Jellyfin library is always reachable from inside the host process.
        return Task.FromResult(new TestResult { Ok = true, Message = "Local library." });
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<SearchResult>> SearchAsync(
        SearchQuery query, ProviderConfig cfg, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(query.Query))
        {
            return Task.FromResult<IReadOnlyList<SearchResult>>(Array.Empty<SearchResult>());
        }

        IReadOnlyList<BaseItem> items;
        try
        {
            items = _client.Search(query.Query, query.Limit, query.Offset);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "JellyfinProvider.SearchAsync failed for '{Query}'", query.Query);
            return Task.FromResult<IReadOnlyList<SearchResult>>(Array.Empty<SearchResult>());
        }

        var typesFilter = query.TypesFilter;
        var results = new List<SearchResult>(items.Count);

        foreach (var item in items)
        {
            var mediaType = MapMediaType(item.GetBaseItemKind());
            if (mediaType == MediaType.Other)
            {
                continue;
            }

            if (typesFilter is not null && !typesFilter.Contains(mediaType))
            {
                continue;
            }

            var jellyfinId = item.Id.ToString("N");
            results.Add(new SearchResult
            {
                ProviderTypeId = TypeId,
                ProviderInstanceId = cfg.InstanceId,
                ExternalId = jellyfinId,
                MediaType = mediaType,
                Title = item.Name ?? string.Empty,
                Subtitle = BuildSubtitle(item, mediaType),
                Description = item.Overview,
                PosterUrl = $"/Items/{jellyfinId}/Images/Primary",
                Year = item.ProductionYear,
                Tags = item.Tags?.Length > 0 ? item.Tags : null,
                InLibrary = true,
                JellyfinItemId = jellyfinId,
                RequestPending = false,
            });
        }

        return Task.FromResult<IReadOnlyList<SearchResult>>(results);
    }

    /// <inheritdoc />
    public Task<RequestSubmissionResult> RequestAsync(
        RequestPayload payload, ProviderConfig cfg, CancellationToken ct)
    {
        // Defensive: this capability is not declared so the aggregator should
        // never call us — return a clear error if it does.
        return Task.FromResult(new RequestSubmissionResult
        {
            Ok = false,
            Message = "Jellyfin provider does not handle requests",
        });
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<RequestStatus>> GetRequestStatusesAsync(
        string userId, ProviderConfig cfg, CancellationToken ct)
    {
        return Task.FromResult<IReadOnlyList<RequestStatus>>(Array.Empty<RequestStatus>());
    }

    /// <inheritdoc />
    public Task<IndexBatch> IndexAsync(DateTime? since, ProviderConfig cfg, CancellationToken ct)
    {
        IReadOnlyList<BaseItem> items;
        try
        {
            items = _client.Snapshot(MaxIndexItems);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "JellyfinProvider.IndexAsync snapshot failed");
            items = Array.Empty<BaseItem>();
        }

        var documents = new List<IndexDocument>(items.Count);
        foreach (var item in items)
        {
            var mediaType = MapMediaType(item.GetBaseItemKind());
            if (mediaType == MediaType.Other)
            {
                continue;
            }

            var jellyfinId = item.Id.ToString("N");
            documents.Add(new IndexDocument
            {
                Id = jellyfinId,
                MediaType = mediaType,
                Title = item.Name ?? string.Empty,
                Subtitle = BuildSubtitle(item, mediaType),
                Description = item.Overview,
                PosterUrl = $"/Items/{jellyfinId}/Images/Primary",
                Year = item.ProductionYear,
                Tags = item.Tags?.Length > 0 ? item.Tags : null,
            });
        }

        return Task.FromResult(new IndexBatch
        {
            Documents = documents,
            Replace = true,
        });
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<CalendarEntry>> GetCalendarAsync(
        CalendarQuery query, ProviderConfig cfg, CancellationToken ct)
    {
        return Task.FromResult<IReadOnlyList<CalendarEntry>>(Array.Empty<CalendarEntry>());
    }

    /// <summary>
    /// Map a Jellyfin <see cref="BaseItemKind"/> to one of our unified
    /// <see cref="MediaType"/> values. Returns <see cref="MediaType.Other"/>
    /// for anything we don't surface (e.g. folders, channels, photos).
    /// See JELLYFIN-INTEGRATION.md §1.1.2.
    /// </summary>
    private static MediaType MapMediaType(BaseItemKind kind) => kind switch
    {
        BaseItemKind.Movie => MediaType.Movie,
        BaseItemKind.Series => MediaType.TvShow,
        BaseItemKind.Season => MediaType.TvShow,
        BaseItemKind.Episode => MediaType.TvShow,
        BaseItemKind.Book => MediaType.Book,
        BaseItemKind.MusicAlbum => MediaType.Music,
        BaseItemKind.Audio => MediaType.Music,
        BaseItemKind.AudioBook => MediaType.Audiobook,
        _ => MediaType.Other,
    };

    /// <summary>
    /// Pick a sensible secondary line for a result — year for movies, album
    /// name for music tracks, falling back to the year for everything else.
    /// </summary>
    private static string? BuildSubtitle(BaseItem item, MediaType mediaType)
    {
        if (mediaType == MediaType.Music && !string.IsNullOrEmpty(item.Album))
        {
            return item.Album;
        }

        if (item.ProductionYear is int year)
        {
            return year.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        return null;
    }
}
