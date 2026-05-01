using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Configuration;
using Jellyfin.Plugin.CypherflixHub.Core;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Providers.Jellyseerr;

/// <summary>
/// IMediaProvider implementation backed by a Jellyseerr (or upstream Overseerr)
/// instance. Exposes Search, Index, Request, RequestStatus, and Discover for
/// movies and TV shows.
///
/// Stateless — every method takes the hydrated <see cref="ProviderConfig"/>
/// containing the per-instance URL and API key. Network failures are caught
/// and translated into safe empties (or <see cref="TestResult"/>/
/// <see cref="RequestSubmissionResult"/> with Ok=false) per the architecture
/// contract in ARCHITECTURE.md §3.4.
/// </summary>
public sealed class JellyseerrProvider : IMediaProvider
{
    // Field keys — kept private constants so the schema and the call sites can
    // never drift out of sync.
    private const string FieldUrl = "url";
    private const string FieldApiKey = "api_key";
    private const string FieldQualityProfileMovie = "quality_profile_movie";
    private const string FieldQualityProfileTv = "quality_profile_tv";

    // Jellyseerr media.status int values (see Dtos.MediaInfoDto comment).
    private const int MediaStatusUnknown = 1;
    private const int MediaStatusPending = 2;
    private const int MediaStatusProcessing = 3;
    private const int MediaStatusPartiallyAvailable = 4;
    private const int MediaStatusAvailable = 5;
    private const int MediaStatusDeleted = 6;

    // MediaRequest.status int values.
    private const int RequestStatusPending = 1;
    private const int RequestStatusApproved = 2;
    private const int RequestStatusDeclined = 3;

    /// <summary>Default Jellyseerr admin user id used as the fallback in the user-id mapping.</summary>
    private const int FallbackJellyseerrUserId = 1;

    /// <summary>
    /// TMDB image base — Jellyseerr returns relative <c>posterPath</c>/<c>backdropPath</c> values.
    /// w500 is what Jellyseerr's own UI uses for cards.
    /// </summary>
    private const string TmdbImagePosterBase = "https://image.tmdb.org/t/p/w500";
    private const string TmdbImageBackdropBase = "https://image.tmdb.org/t/p/w780";

    private readonly JellyseerrClient _client;
    private readonly IUserManager _userManager;
    private readonly ILogger<JellyseerrProvider> _logger;

    public JellyseerrProvider(
        JellyseerrClient client,
        IUserManager userManager,
        ILogger<JellyseerrProvider> logger)
    {
        _client = client;
        _userManager = userManager;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    // Type metadata
    // -------------------------------------------------------------------------

    public string TypeId => "jellyseerr";

    public string DisplayName => "Jellyseerr";

    public string Description =>
        "Movie and TV request manager. Provides Discover catalogue and request submission for Sonarr/Radarr.";

    public string? IconUrl => "https://raw.githubusercontent.com/Fallenbagel/jellyseerr/develop/public/logo.png";

    public IReadOnlyList<MediaType> SupportedMediaTypes { get; } = new[] { MediaType.Movie, MediaType.TvShow };

    public IReadOnlyList<Capability> SupportedCapabilities { get; } = new[]
    {
        Capability.Search,
        Capability.Index,
        Capability.Request,
        Capability.RequestStatus,
        Capability.Discover
    };

    public IReadOnlyList<ConfigField> ConfigSchema { get; } = new[]
    {
        new ConfigField
        {
            Key = FieldUrl,
            Label = "URL",
            Type = ConfigFieldType.Url,
            Required = true,
            Default = "http://192.168.1.165:7920",
            Description = "Internal LAN URL"
        },
        new ConfigField
        {
            Key = FieldApiKey,
            Label = "API Key",
            Type = ConfigFieldType.ApiKey,
            Required = true,
            Description = "Jellyseerr API key (Settings → General → API Key)"
        },
        new ConfigField
        {
            Key = FieldQualityProfileMovie,
            Label = "Movie quality profile (optional)",
            Type = ConfigFieldType.Text,
            Required = false,
            Description = "Override the default profile for new movie requests"
        },
        new ConfigField
        {
            Key = FieldQualityProfileTv,
            Label = "TV quality profile (optional)",
            Type = ConfigFieldType.Text,
            Required = false,
            Description = "Override default for TV"
        }
    };

    // -------------------------------------------------------------------------
    // TestConnectionAsync
    // -------------------------------------------------------------------------

    public async Task<TestResult> TestConnectionAsync(ProviderConfig cfg, CancellationToken ct)
    {
        if (!TryGetConnection(cfg, out var url, out var apiKey, out var missing))
        {
            return new TestResult { Ok = false, Message = missing };
        }

        try
        {
            using var response = await _client.GetStatusRawAsync(url, apiKey, ct).ConfigureAwait(false);
            if (response.IsSuccessStatusCode)
            {
                return new TestResult { Ok = true, Message = "Connected" };
            }

            var body = await JellyseerrClient.ReadBodySafeAsync(response, ct).ConfigureAwait(false);
            return new TestResult
            {
                Ok = false,
                Message = $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}",
                Detail = body
            };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jellyseerr TestConnection failed for {Url}", url);
            return new TestResult { Ok = false, Message = ex.Message };
        }
    }

    // -------------------------------------------------------------------------
    // SearchAsync
    // -------------------------------------------------------------------------

    public async Task<IReadOnlyList<SearchResult>> SearchAsync(SearchQuery query, ProviderConfig cfg, CancellationToken ct)
    {
        if (!TryGetConnection(cfg, out var url, out var apiKey, out _))
        {
            return Array.Empty<SearchResult>();
        }

        SearchResponse? response;
        try
        {
            response = await _client.SearchAsync(url, apiKey, query.Query, page: 1, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jellyseerr search failed for query={Query}", query.Query);
            return Array.Empty<SearchResult>();
        }

        if (response?.Results is null || response.Results.Count == 0)
        {
            return Array.Empty<SearchResult>();
        }

        var results = new List<SearchResult>(response.Results.Count);
        foreach (var dto in response.Results)
        {
            var mapped = MapSearchResult(dto, cfg, url);
            if (mapped is null)
            {
                continue;
            }

            if (query.TypesFilter is { Count: > 0 } && !query.TypesFilter.Contains(mapped.MediaType))
            {
                continue;
            }

            results.Add(mapped);
        }

        return results;
    }

    // -------------------------------------------------------------------------
    // RequestAsync
    // -------------------------------------------------------------------------

    public async Task<RequestSubmissionResult> RequestAsync(RequestPayload payload, ProviderConfig cfg, CancellationToken ct)
    {
        if (!TryGetConnection(cfg, out var url, out var apiKey, out var missing))
        {
            return new RequestSubmissionResult { Ok = false, Message = missing };
        }

        if (!long.TryParse(payload.ExternalId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var tmdbId))
        {
            return new RequestSubmissionResult { Ok = false, Message = $"Invalid TMDB id '{payload.ExternalId}'" };
        }

        var mediaType = payload.MediaType switch
        {
            MediaType.Movie => "movie",
            MediaType.TvShow => "tv",
            _ => null
        };

        if (mediaType is null)
        {
            return new RequestSubmissionResult
            {
                Ok = false,
                Message = $"Jellyseerr does not handle media type {payload.MediaType}"
            };
        }

        var jellyseerrUserId = await ResolveJellyseerrUserIdAsync(payload.UserId, url, apiKey, ct).ConfigureAwait(false);

        var body = new CreateRequestBody
        {
            MediaType = mediaType,
            MediaId = tmdbId,
            UserId = jellyseerrUserId
        };

        if (mediaType == "tv")
        {
            // Default to "all" seasons; allow Extras to override either with the
            // literal string "all" or a comma-separated list of season numbers.
            body.Seasons = ParseSeasonsExtra(payload.Extras);
        }

        try
        {
            var (response, created) = await _client.CreateRequestAsync(url, apiKey, body, ct).ConfigureAwait(false);
            try
            {
                if (response.IsSuccessStatusCode && created is not null)
                {
                    return new RequestSubmissionResult
                    {
                        Ok = true,
                        Status = MapRequestStatus(created, cfg)
                    };
                }

                var bodyText = await JellyseerrClient.ReadBodySafeAsync(response, ct).ConfigureAwait(false);

                if (JellyseerrClient.IsAlreadyExists(response.StatusCode, bodyText))
                {
                    var existing = await FindExistingRequestAsync(url, apiKey, jellyseerrUserId, tmdbId, mediaType, cfg, ct)
                        .ConfigureAwait(false);

                    return new RequestSubmissionResult
                    {
                        Ok = true,
                        Status = existing,
                        Message = "Request already exists"
                    };
                }

                _logger.LogWarning(
                    "Jellyseerr POST /request returned {Status} for tmdbId={TmdbId}: {Body}",
                    (int)response.StatusCode,
                    tmdbId,
                    bodyText);

                return new RequestSubmissionResult
                {
                    Ok = false,
                    Message = $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}"
                };
            }
            finally
            {
                response.Dispose();
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jellyseerr request submission failed for tmdbId={TmdbId}", tmdbId);
            return new RequestSubmissionResult { Ok = false, Message = ex.Message };
        }
    }

    // -------------------------------------------------------------------------
    // GetRequestStatusesAsync
    // -------------------------------------------------------------------------

    public async Task<IReadOnlyList<RequestStatus>> GetRequestStatusesAsync(string userId, ProviderConfig cfg, CancellationToken ct)
    {
        if (!TryGetConnection(cfg, out var url, out var apiKey, out _))
        {
            return Array.Empty<RequestStatus>();
        }

        int? jellyseerrUserId = null;
        if (Guid.TryParse(userId, out var jellyfinGuid))
        {
            jellyseerrUserId = await ResolveJellyseerrUserIdAsync(jellyfinGuid.ToString("D"), url, apiKey, ct)
                .ConfigureAwait(false);
        }

        RequestListResponse? response;
        try
        {
            response = await _client.GetRequestsAsync(url, apiKey, jellyseerrUserId, take: 100, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jellyseerr request list failed");
            return Array.Empty<RequestStatus>();
        }

        if (response?.Results is null || response.Results.Count == 0)
        {
            return Array.Empty<RequestStatus>();
        }

        var output = new List<RequestStatus>(response.Results.Count);
        foreach (var req in response.Results)
        {
            var mapped = MapRequestStatus(req, cfg);
            if (mapped is not null)
            {
                output.Add(mapped);
            }
        }

        return output;
    }

    // -------------------------------------------------------------------------
    // IndexAsync
    // -------------------------------------------------------------------------

    public async Task<IndexBatch> IndexAsync(DateTime? since, ProviderConfig cfg, CancellationToken ct)
    {
        if (!TryGetConnection(cfg, out var url, out var apiKey, out _))
        {
            return EmptyIndexBatch();
        }

        const int Take = 200;
        const int MaxDocs = 1000;

        // Fan out the four discover queries in parallel.
        var tasks = new[]
        {
            SafeDiscoverAsync(() => _client.DiscoverMoviesTrendingAsync(url, apiKey, Take, ct), nameof(JellyseerrClient.DiscoverMoviesTrendingAsync)),
            SafeDiscoverAsync(() => _client.DiscoverTvTrendingAsync(url, apiKey, Take, ct), nameof(JellyseerrClient.DiscoverTvTrendingAsync)),
            SafeDiscoverAsync(() => _client.DiscoverMoviesAsync(url, apiKey, Take, ct), nameof(JellyseerrClient.DiscoverMoviesAsync)),
            SafeDiscoverAsync(() => _client.DiscoverTvAsync(url, apiKey, Take, ct), nameof(JellyseerrClient.DiscoverTvAsync))
        };

        var pages = await Task.WhenAll(tasks).ConfigureAwait(false);

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var docs = new List<IndexDocument>();

        foreach (var page in pages)
        {
            if (page?.Results is null)
            {
                continue;
            }

            foreach (var dto in page.Results)
            {
                if (docs.Count >= MaxDocs)
                {
                    break;
                }

                var doc = MapIndexDocument(dto);
                if (doc is null)
                {
                    continue;
                }

                if (seen.Add(doc.Id))
                {
                    docs.Add(doc);
                }
            }

            if (docs.Count >= MaxDocs)
            {
                break;
            }
        }

        return new IndexBatch
        {
            Documents = docs,
            Replace = true
        };
    }

    // -------------------------------------------------------------------------
    // GetCalendarAsync
    // -------------------------------------------------------------------------

    public Task<IReadOnlyList<CalendarEntry>> GetCalendarAsync(CalendarQuery query, ProviderConfig cfg, CancellationToken ct)
    {
        // Jellyseerr has no first-class calendar endpoint. Sonarr/Radarr providers
        // are the source of truth for upcoming releases — see PROV-002 spec.
        return Task.FromResult<IReadOnlyList<CalendarEntry>>(Array.Empty<CalendarEntry>());
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /// <summary>
    /// Validate the <see cref="ProviderConfig"/> has the URL + API key pair we
    /// need. <paramref name="missing"/> is set to a human-readable message when
    /// the return is false; null otherwise.
    /// </summary>
    private static bool TryGetConnection(ProviderConfig cfg, out string url, out string apiKey, out string? missing)
    {
        url = (cfg.Get(FieldUrl) ?? string.Empty).Trim();
        apiKey = (cfg.Get(FieldApiKey) ?? string.Empty).Trim();

        if (string.IsNullOrEmpty(url))
        {
            missing = "Jellyseerr URL is not configured";
            return false;
        }

        if (string.IsNullOrEmpty(apiKey))
        {
            missing = "Jellyseerr API key is not configured";
            return false;
        }

        missing = null;
        return true;
    }

    private SearchResult? MapSearchResult(SearchResultDto dto, ProviderConfig cfg, string baseUrl)
    {
        var mediaType = ParseMediaType(dto.MediaType);
        if (mediaType is null)
        {
            return null;
        }

        // ExternalId: tmdbId for movies, tvdbId (if present) else tmdbId for TV.
        // Jellyseerr's TV search returns the TMDB id as `id`, and the tvdbId is
        // only available on the embedded mediaInfo when Jellyseerr already knows
        // about the show. Default to dto.Id (TMDB) so search-then-request flows
        // line up: POST /request expects mediaId=tmdbId.
        string externalId;
        if (mediaType == MediaType.TvShow && dto.MediaInfo?.TvdbId is { } tvdb && tvdb > 0)
        {
            externalId = tvdb.ToString(CultureInfo.InvariantCulture);
        }
        else
        {
            externalId = dto.Id.ToString(CultureInfo.InvariantCulture);
        }

        // ExternalUrl per spec: "{url}/{mediaType}/{tmdbId}". Use TMDB id for the
        // path (Jellyseerr's web UI also accepts the tmdb id form).
        var tmdbForLink = dto.Id.ToString(CultureInfo.InvariantCulture);
        var externalUrl = $"{baseUrl.TrimEnd('/')}/{(mediaType == MediaType.Movie ? "movie" : "tv")}/{tmdbForLink}";

        var title = mediaType == MediaType.Movie
            ? (dto.Title ?? dto.OriginalTitle ?? string.Empty)
            : (dto.Name ?? dto.OriginalName ?? string.Empty);

        if (string.IsNullOrEmpty(title))
        {
            return null;
        }

        var year = ParseYear(mediaType == MediaType.Movie ? dto.ReleaseDate : dto.FirstAirDate);

        return new SearchResult
        {
            ProviderTypeId = TypeId,
            ProviderInstanceId = cfg.InstanceId,
            ExternalId = externalId,
            MediaType = mediaType.Value,
            Title = title,
            Subtitle = year?.ToString(CultureInfo.InvariantCulture),
            Description = dto.Overview,
            PosterUrl = BuildImageUrl(dto.PosterPath, TmdbImagePosterBase),
            BackdropUrl = BuildImageUrl(dto.BackdropPath, TmdbImageBackdropBase),
            Year = year,
            Rating = dto.VoteAverage,
            ExternalUrl = externalUrl
            // InLibrary / RequestPending intentionally left default — aggregator fills these.
        };
    }

    private IndexDocument? MapIndexDocument(SearchResultDto dto)
    {
        var mediaType = ParseMediaType(dto.MediaType);
        if (mediaType is null)
        {
            return null;
        }

        var title = mediaType == MediaType.Movie
            ? (dto.Title ?? dto.OriginalTitle ?? string.Empty)
            : (dto.Name ?? dto.OriginalName ?? string.Empty);

        if (string.IsNullOrEmpty(title))
        {
            return null;
        }

        var id = $"{(mediaType == MediaType.Movie ? "movie" : "tv")}:{dto.Id.ToString(CultureInfo.InvariantCulture)}";
        var year = ParseYear(mediaType == MediaType.Movie ? dto.ReleaseDate : dto.FirstAirDate);

        var extras = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["tmdbId"] = dto.Id.ToString(CultureInfo.InvariantCulture)
        };

        if (dto.MediaInfo?.TvdbId is { } tvdb && tvdb > 0)
        {
            extras["tvdbId"] = tvdb.ToString(CultureInfo.InvariantCulture);
        }

        return new IndexDocument
        {
            Id = id,
            MediaType = mediaType.Value,
            Title = title,
            Subtitle = year?.ToString(CultureInfo.InvariantCulture),
            Description = dto.Overview,
            PosterUrl = BuildImageUrl(dto.PosterPath, TmdbImagePosterBase),
            Year = year,
            Extras = extras
        };
    }

    private RequestStatus? MapRequestStatus(MediaRequestDto req, ProviderConfig cfg)
    {
        var media = req.Media;
        if (media is null)
        {
            return null;
        }

        var mediaType = ParseMediaType(media.MediaType);
        if (mediaType is null)
        {
            return null;
        }

        var externalId = (media.TmdbId ?? 0L).ToString(CultureInfo.InvariantCulture);
        if (externalId == "0")
        {
            return null;
        }

        var state = MapRequestState(req.Status, media.Status);

        var title = mediaType == MediaType.Movie
            ? (media.Title ?? media.Name ?? "(unknown)")
            : (media.Name ?? media.Title ?? "(unknown)");

        var createdAt = ParseTimestamp(req.CreatedAt) ?? DateTime.UtcNow;

        return new RequestStatus
        {
            ProviderTypeId = TypeId,
            ProviderInstanceId = cfg.InstanceId,
            ExternalId = externalId,
            MediaType = mediaType.Value,
            Title = title,
            State = state,
            CreatedAt = createdAt,
            RequestedByUserId = req.RequestedBy?.Id.ToString(CultureInfo.InvariantCulture),
            RequestedByUserName = req.RequestedBy?.DisplayName ?? req.RequestedBy?.JellyfinUsername ?? req.RequestedBy?.Username,
            PosterUrl = BuildImageUrl(media.PosterPath, TmdbImagePosterBase)
        };
    }

    /// <summary>
    /// Map (request.status, media.status) → our RequestState enum.
    ///
    /// Per task spec PROV-002:
    /// - request.status = 1 (PENDING) → Pending
    /// - request.status = 2 (APPROVED) + media.status = 2 → Approved
    /// - request.status = 2 (APPROVED) + media.status = 3 → InProgress
    /// - request.status = 2 (APPROVED) + media.status = 5 → Available
    /// - request.status = 3 (DECLINED) → Declined
    /// </summary>
    private static RequestState MapRequestState(int requestStatus, int? mediaStatus)
    {
        if (requestStatus == RequestStatusDeclined)
        {
            return RequestState.Declined;
        }

        if (requestStatus == RequestStatusPending)
        {
            return RequestState.Pending;
        }

        if (requestStatus == RequestStatusApproved)
        {
            return mediaStatus switch
            {
                MediaStatusPending => RequestState.Approved,
                MediaStatusProcessing => RequestState.InProgress,
                MediaStatusPartiallyAvailable => RequestState.InProgress,
                MediaStatusAvailable => RequestState.Available,
                MediaStatusDeleted => RequestState.Failed,
                MediaStatusUnknown => RequestState.Approved,
                null => RequestState.Approved,
                _ => RequestState.Approved
            };
        }

        return RequestState.Pending;
    }

    private async Task<RequestStatus?> FindExistingRequestAsync(
        string url,
        string apiKey,
        int? jellyseerrUserId,
        long tmdbId,
        string mediaType,
        ProviderConfig cfg,
        CancellationToken ct)
    {
        try
        {
            var list = await _client.GetRequestsAsync(url, apiKey, jellyseerrUserId, take: 100, ct).ConfigureAwait(false);
            if (list?.Results is null)
            {
                return null;
            }

            foreach (var req in list.Results)
            {
                if (req.Media?.TmdbId != tmdbId)
                {
                    continue;
                }

                if (!string.Equals(req.Media.MediaType, mediaType, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                return MapRequestStatus(req, cfg);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jellyseerr lookup-after-409 failed for tmdbId={TmdbId}", tmdbId);
        }

        return null;
    }

    /// <summary>
    /// Resolve the current Jellyfin user GUID to its Jellyseerr user id.
    ///
    /// Strategy (per PROV-002 spec):
    /// 1. Look up the cached mapping in <see cref="PluginConfiguration.JellyseerrUserMap"/>.
    /// 2. On miss, GET /api/v1/user?take=100 and match by Jellyfin "name" field
    ///    against jellyfinUsername (then username as a fallback).
    /// 3. Persist the resolved mapping back into PluginConfiguration.
    /// 4. If no match, fall back to the admin user (id=1) and DO NOT cache the
    ///    fallback (so a later rename/re-link still has a chance to resolve).
    /// </summary>
    private async Task<int> ResolveJellyseerrUserIdAsync(string jellyfinUserId, string url, string apiKey, CancellationToken ct)
    {
        if (!Guid.TryParse(jellyfinUserId, out var jellyfinGuid) || jellyfinGuid == Guid.Empty)
        {
            return FallbackJellyseerrUserId;
        }

        var plugin = Plugin.Instance;
        var config = plugin?.Configuration;

        // 1. Cache lookup.
        if (config?.JellyseerrUserMap is { Length: > 0 })
        {
            foreach (var row in config.JellyseerrUserMap)
            {
                if (row.JellyfinUserId == jellyfinGuid)
                {
                    return row.JellyseerrUserId;
                }
            }
        }

        // 2. Need the Jellyfin username to match against Jellyseerr's user list.
        string? jellyfinName = null;
        try
        {
            var jfUser = _userManager.GetUserById(jellyfinGuid);
            jellyfinName = jfUser?.Username;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to resolve Jellyfin user {UserId}", jellyfinGuid);
        }

        if (string.IsNullOrEmpty(jellyfinName))
        {
            return FallbackJellyseerrUserId;
        }

        // 3. Hit Jellyseerr.
        UserListResponse? users;
        try
        {
            users = await _client.GetUsersAsync(url, apiKey, take: 100, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jellyseerr GET /user failed");
            return FallbackJellyseerrUserId;
        }

        if (users?.Results is null)
        {
            return FallbackJellyseerrUserId;
        }

        // Prefer matching by jellyfinUserId (exact GUID), then by jellyfinUsername,
        // then by username. Case-insensitive on usernames.
        UserDto? match = null;
        foreach (var u in users.Results)
        {
            if (!string.IsNullOrEmpty(u.JellyfinUserId)
                && Guid.TryParse(u.JellyfinUserId, out var jfGuid)
                && jfGuid == jellyfinGuid)
            {
                match = u;
                break;
            }
        }

        if (match is null)
        {
            foreach (var u in users.Results)
            {
                if (string.Equals(u.JellyfinUsername, jellyfinName, StringComparison.OrdinalIgnoreCase))
                {
                    match = u;
                    break;
                }
            }
        }

        if (match is null)
        {
            foreach (var u in users.Results)
            {
                if (string.Equals(u.Username, jellyfinName, StringComparison.OrdinalIgnoreCase))
                {
                    match = u;
                    break;
                }
            }
        }

        if (match is null)
        {
            _logger.LogInformation(
                "No Jellyseerr user matched Jellyfin user '{Name}' ({Guid}); falling back to admin id={Admin}",
                jellyfinName,
                jellyfinGuid,
                FallbackJellyseerrUserId);
            return FallbackJellyseerrUserId;
        }

        // 4. Persist.
        if (plugin is not null && config is not null)
        {
            var existing = config.JellyseerrUserMap ?? Array.Empty<JellyseerrUserMapping>();
            var updated = new List<JellyseerrUserMapping>(existing.Length + 1);

            foreach (var row in existing)
            {
                if (row.JellyfinUserId != jellyfinGuid)
                {
                    updated.Add(row);
                }
            }

            updated.Add(new JellyseerrUserMapping
            {
                JellyfinUserId = jellyfinGuid,
                JellyseerrUserId = match.Id
            });

            config.JellyseerrUserMap = updated.ToArray();

            try
            {
                plugin.SaveConfiguration();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to persist Jellyseerr user mapping for {Guid}", jellyfinGuid);
            }
        }

        return match.Id;
    }

    /// <summary>Wrap a discover call to swallow exceptions and never break the gather.</summary>
    private async Task<DiscoverResponse?> SafeDiscoverAsync(Func<Task<DiscoverResponse?>> call, string label)
    {
        try
        {
            return await call().ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jellyseerr {Endpoint} failed during indexing", label);
            return null;
        }
    }

    private static IndexBatch EmptyIndexBatch() => new()
    {
        Documents = Array.Empty<IndexDocument>(),
        Replace = true
    };

    private static MediaType? ParseMediaType(string? raw) => raw switch
    {
        "movie" => MediaType.Movie,
        "tv" => MediaType.TvShow,
        _ => null
    };

    private static int? ParseYear(string? date)
    {
        if (string.IsNullOrEmpty(date) || date.Length < 4)
        {
            return null;
        }

        return int.TryParse(date.AsSpan(0, 4), NumberStyles.Integer, CultureInfo.InvariantCulture, out var year)
            ? year
            : null;
    }

    private static DateTime? ParseTimestamp(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return DateTime.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var ts) ? ts : null;
    }

    private static string? BuildImageUrl(string? relativePath, string baseUrl)
    {
        if (string.IsNullOrEmpty(relativePath))
        {
            return null;
        }

        if (relativePath.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || relativePath.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return relativePath;
        }

        var normalised = relativePath.StartsWith('/') ? relativePath : "/" + relativePath;
        return baseUrl + normalised;
    }

    /// <summary>
    /// Parse the optional <c>seasons</c> extra. Accepts:
    ///   - missing / null / empty → "all"
    ///   - "all"                  → "all"
    ///   - "1,2,3"                → int[] { 1, 2, 3 }
    /// </summary>
    private static object ParseSeasonsExtra(IReadOnlyDictionary<string, string>? extras)
    {
        if (extras is null || !extras.TryGetValue("seasons", out var raw) || string.IsNullOrWhiteSpace(raw))
        {
            return "all";
        }

        if (string.Equals(raw.Trim(), "all", StringComparison.OrdinalIgnoreCase))
        {
            return "all";
        }

        var parts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var seasons = new List<int>(parts.Length);
        foreach (var part in parts)
        {
            if (int.TryParse(part, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n))
            {
                seasons.Add(n);
            }
        }

        return seasons.Count > 0 ? seasons.ToArray() : "all";
    }
}
