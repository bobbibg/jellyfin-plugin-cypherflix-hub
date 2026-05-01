using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Core;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Providers.Readarr;

/// <summary>
/// IMediaProvider implementation backed by a Readarr (Faustvii fork v0.x)
/// instance. Supports Search, Index, Request, RequestStatus, and Calendar
/// for books, audiobooks, and comics.
///
/// Multi-instance: the admin is expected to configure a separate instance for
/// each library type (books, audiobooks, comics) with its own root folder and
/// quality profile. The <c>media_type</c> config field is the **single source
/// of truth** for the <see cref="Core.MediaType"/> emitted on every
/// <see cref="SearchResult"/>, <see cref="IndexDocument"/>, and
/// <see cref="CalendarEntry"/> from this instance.
///
/// Stateless and resilient — every method takes the hydrated
/// <see cref="ProviderConfig"/>; network failures are caught and translated
/// into safe empties (or <see cref="TestResult"/> / <see cref="RequestSubmissionResult"/>
/// with Ok=false) per the architecture contract in ARCHITECTURE.md §3.4.
///
/// Idempotent — <see cref="RequestAsync"/> for an already-requested book
/// returns Ok=true with the existing record, recovering through the Servarr
/// "already added" 400 validation-failure path documented in
/// JELLYFIN-INTEGRATION.md §8.4.
/// </summary>
public sealed class ReadarrProvider : IMediaProvider
{
    // Field keys — kept private constants so the schema and the call sites can
    // never drift out of sync.
    private const string FieldUrl = "url";
    private const string FieldApiKey = "api_key";
    private const string FieldMediaType = "media_type";
    private const string FieldRootFolder = "root_folder";
    private const string FieldQualityProfileId = "quality_profile_id";
    private const string FieldMetadataProfileId = "metadata_profile_id";
    private const string FieldTag = "tag";

    private const string MediaTypeBook = "book";
    private const string MediaTypeAudiobook = "audiobook";
    private const string MediaTypeComic = "comic";

    private readonly ReadarrClient _client;
    private readonly ILogger<ReadarrProvider> _logger;

    public ReadarrProvider(ReadarrClient client, ILogger<ReadarrProvider> logger)
    {
        _client = client;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    // Type metadata
    // -------------------------------------------------------------------------

    public string TypeId => "readarr";

    public string DisplayName => "Readarr";

    public string Description =>
        "Book, audiobook, and comic management. Multi-instance — configure one per root folder.";

    public string? IconUrl => "https://raw.githubusercontent.com/Readarr/Readarr/develop/Logo/256.png";

    public IReadOnlyList<MediaType> SupportedMediaTypes { get; } = new[]
    {
        MediaType.Book,
        MediaType.Audiobook,
        MediaType.Comic
    };

    public IReadOnlyList<Capability> SupportedCapabilities { get; } = new[]
    {
        Capability.Search,
        Capability.Index,
        Capability.Request,
        Capability.RequestStatus,
        Capability.Calendar
    };

    public IReadOnlyList<ConfigField> ConfigSchema { get; } = new[]
    {
        new ConfigField
        {
            Key = FieldUrl,
            Label = "URL",
            Type = ConfigFieldType.Url,
            Required = true,
            Default = "http://192.168.1.165:7650",
            Description = "Internal LAN URL"
        },
        new ConfigField
        {
            Key = FieldApiKey,
            Label = "API Key",
            Type = ConfigFieldType.ApiKey,
            Required = true,
            Description = "Settings → General → API Key"
        },
        new ConfigField
        {
            Key = FieldMediaType,
            Label = "Library media type",
            Type = ConfigFieldType.Select,
            Required = true,
            Default = MediaTypeBook,
            Description = "Controls how IndexDocument.MediaType is set for this instance.",
            Options = new[]
            {
                new ConfigOption { Value = MediaTypeBook,      Label = "Book" },
                new ConfigOption { Value = MediaTypeAudiobook, Label = "Audiobook" },
                new ConfigOption { Value = MediaTypeComic,     Label = "Comic" }
            }
        },
        new ConfigField
        {
            Key = FieldRootFolder,
            Label = "Root folder path",
            Type = ConfigFieldType.Text,
            Required = true,
            Default = "/library/books",
            Description = "Used when adding new authors/books"
        },
        new ConfigField
        {
            Key = FieldQualityProfileId,
            Label = "Quality profile id",
            Type = ConfigFieldType.Number,
            Required = true,
            Default = "1",
            Description = "From GET /api/v1/qualityprofile"
        },
        new ConfigField
        {
            Key = FieldMetadataProfileId,
            Label = "Metadata profile id",
            Type = ConfigFieldType.Number,
            Required = true,
            Default = "1",
            Description = "From GET /api/v1/metadataprofile"
        },
        new ConfigField
        {
            Key = FieldTag,
            Label = "Auto-apply tag",
            Type = ConfigFieldType.Text,
            Required = false,
            Default = "books",
            Description = "Tag added to authors created via this instance — drives SAB category routing."
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
            using var response = await _client.GetSystemStatusRawAsync(url, apiKey, ct).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var body = await ReadarrClient.ReadBodySafeAsync(response, ct).ConfigureAwait(false);
                return new TestResult
                {
                    Ok = false,
                    Message = $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}",
                    Detail = body
                };
            }

            SystemStatusDto? status = null;
            try
            {
                status = await response.Content.ReadFromJsonAsync<SystemStatusDto>(cancellationToken: ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse Readarr /system/status body");
            }

            var version = status?.Version ?? "(unknown)";
            // Faustvii fork tracks Readarr v0.x — surface a hint when the
            // version doesn't start with "0." but still report Ok (the API
            // shape we use is shared across the Servarr family and shouldn't
            // break if the upstream bumps).
            var detail = $"Readarr {version}";
            if (!string.IsNullOrEmpty(status?.Version) && !status.Version.StartsWith("0.", StringComparison.Ordinal))
            {
                detail += " (note: expected 0.x for the Faustvii fork)";
            }

            return new TestResult { Ok = true, Message = "Connected", Detail = detail };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Readarr TestConnection failed for {Url}", url);
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

        var instanceMediaType = GetInstanceMediaType(cfg);

        // Type-filter early — if this instance's MediaType isn't in the filter
        // there's nothing for us to contribute.
        if (query.TypesFilter is { Count: > 0 } && !query.TypesFilter.Contains(instanceMediaType))
        {
            return Array.Empty<SearchResult>();
        }

        var results = new List<SearchResult>();
        var seenForeignIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        // Phase 1 — already in library. The /book endpoint expects a slug, so
        // try a slug-shaped search first; fall back to filtering the full list
        // by title contains. (Readarr's /book?titleSlug= is exact-match only.)
        try
        {
            var slug = SlugifyForSearch(query.Query);
            List<BookDto>? slugHits = null;
            if (!string.IsNullOrEmpty(slug))
            {
                slugHits = await _client.GetBooksByTitleSlugAsync(url, apiKey, slug, ct).ConfigureAwait(false);
            }

            if (slugHits is { Count: > 0 })
            {
                foreach (var book in slugHits)
                {
                    var mapped = MapLibraryBookToSearchResult(book, cfg, instanceMediaType);
                    if (mapped is null)
                    {
                        continue;
                    }

                    results.Add(mapped);
                    if (!string.IsNullOrEmpty(book.ForeignBookId))
                    {
                        seenForeignIds.Add(book.ForeignBookId);
                    }
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Readarr in-library lookup failed for query={Query}", query.Query);
        }

        // Phase 2 — remote lookup for not-yet-added books.
        try
        {
            var lookup = await _client.LookupBookAsync(url, apiKey, query.Query, ct).ConfigureAwait(false);
            if (lookup is { Count: > 0 })
            {
                foreach (var book in lookup)
                {
                    if (!string.IsNullOrEmpty(book.ForeignBookId) && !seenForeignIds.Add(book.ForeignBookId))
                    {
                        // Already covered by phase 1.
                        continue;
                    }

                    var mapped = MapLookupBookToSearchResult(book, cfg, instanceMediaType);
                    if (mapped is null)
                    {
                        continue;
                    }

                    results.Add(mapped);
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Readarr lookup failed for query={Query}", query.Query);
        }

        if (query.Limit > 0 && results.Count > query.Limit)
        {
            return results.Take(query.Limit).ToList();
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

        var instanceMediaType = GetInstanceMediaType(cfg);

        if (string.IsNullOrEmpty(payload.ExternalId))
        {
            return new RequestSubmissionResult { Ok = false, Message = "ExternalId is required" };
        }

        try
        {
            // Step 1 — does the book already exist in the library?
            BookDto? existing = await FindExistingBookAsync(url, apiKey, payload.ExternalId, ct).ConfigureAwait(false);

            if (existing is not null)
            {
                if (!existing.Monitored)
                {
                    existing.Monitored = true;
                    using var put = await _client.UpdateBookAsync(url, apiKey, existing, ct).ConfigureAwait(false);
                    if (!put.IsSuccessStatusCode)
                    {
                        var bodyText = await ReadarrClient.ReadBodySafeAsync(put, ct).ConfigureAwait(false);
                        _logger.LogWarning(
                            "Readarr PUT /book/{Id} returned {Status}: {Body}",
                            existing.Id, (int)put.StatusCode, bodyText);
                        return new RequestSubmissionResult
                        {
                            Ok = false,
                            Message = $"HTTP {(int)put.StatusCode} {put.ReasonPhrase}"
                        };
                    }
                }

                await TriggerBookSearchAsync(url, apiKey, existing.Id, ct).ConfigureAwait(false);

                return new RequestSubmissionResult
                {
                    Ok = true,
                    Status = MapBookToRequestStatus(existing, cfg, instanceMediaType, RequestState.Approved, null),
                    Message = "Book already in library — re-monitored and search triggered"
                };
            }

            // Step 2 — book missing. Resolve via lookup.
            var lookup = await _client.LookupBookAsync(url, apiKey, payload.ExternalId, ct).ConfigureAwait(false);
            BookDto? lookupBook = null;
            if (lookup is not null)
            {
                foreach (var b in lookup)
                {
                    if (string.Equals(b.ForeignBookId, payload.ExternalId, StringComparison.OrdinalIgnoreCase))
                    {
                        lookupBook = b;
                        break;
                    }
                }

                lookupBook ??= lookup.Count > 0 ? lookup[0] : null;
            }

            if (lookupBook is null)
            {
                return new RequestSubmissionResult
                {
                    Ok = false,
                    Message = $"Readarr lookup found no book matching '{payload.ExternalId}'"
                };
            }

            // Step 3 — ensure author exists.
            var authorId = await EnsureAuthorAsync(url, apiKey, cfg, lookupBook, ct).ConfigureAwait(false);
            if (authorId is null)
            {
                return new RequestSubmissionResult
                {
                    Ok = false,
                    Message = "Failed to resolve or create the author for this book"
                };
            }

            // Step 4 — POST the book.
            var addPayload = new BookAddPayloadDto
            {
                Title = lookupBook.Title,
                ForeignBookId = lookupBook.ForeignBookId,
                Monitored = true,
                AnyEditionOk = true,
                AuthorId = authorId,
                Editions = lookupBook.Editions,
                AddOptions = new BookAddOptionsDto
                {
                    AddType = "automatic",
                    SearchForNewBook = true
                }
            };

            using (var post = await _client.AddBookAsync(url, apiKey, addPayload, ct).ConfigureAwait(false))
            {
                if (post.IsSuccessStatusCode)
                {
                    BookDto? created = null;
                    try
                    {
                        created = await post.Content.ReadFromJsonAsync<BookDto>(cancellationToken: ct).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to parse Readarr POST /book response");
                    }

                    if (created is not null && created.Id > 0)
                    {
                        await TriggerBookSearchAsync(url, apiKey, created.Id, ct).ConfigureAwait(false);
                        return new RequestSubmissionResult
                        {
                            Ok = true,
                            Status = MapBookToRequestStatus(created, cfg, instanceMediaType, RequestState.Approved, null)
                        };
                    }

                    // Successful response but no body — return Ok with a stub status from the lookup.
                    return new RequestSubmissionResult
                    {
                        Ok = true,
                        Status = MapLookupBookToRequestStatus(lookupBook, cfg, instanceMediaType, RequestState.Pending)
                    };
                }

                var body = await ReadarrClient.ReadBodySafeAsync(post, ct).ConfigureAwait(false);
                if (ReadarrClient.IsAlreadyExists(post.StatusCode, body))
                {
                    // Recover the existing record.
                    var recovered = await FindExistingBookAsync(url, apiKey, payload.ExternalId, ct).ConfigureAwait(false);
                    if (recovered is not null)
                    {
                        await TriggerBookSearchAsync(url, apiKey, recovered.Id, ct).ConfigureAwait(false);
                        return new RequestSubmissionResult
                        {
                            Ok = true,
                            Status = MapBookToRequestStatus(recovered, cfg, instanceMediaType, RequestState.Approved, null),
                            Message = "Book was already added — search triggered"
                        };
                    }

                    return new RequestSubmissionResult
                    {
                        Ok = true,
                        Status = MapLookupBookToRequestStatus(lookupBook, cfg, instanceMediaType, RequestState.Pending),
                        Message = "Book was already added"
                    };
                }

                _logger.LogWarning(
                    "Readarr POST /book returned {Status} for foreignBookId={Id}: {Body}",
                    (int)post.StatusCode, payload.ExternalId, body);

                return new RequestSubmissionResult
                {
                    Ok = false,
                    Message = $"HTTP {(int)post.StatusCode} {post.ReasonPhrase}"
                };
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Readarr RequestAsync failed for ExternalId={Id}", payload.ExternalId);
            return new RequestSubmissionResult { Ok = false, Message = ex.Message };
        }
    }

    // -------------------------------------------------------------------------
    // GetRequestStatusesAsync
    // -------------------------------------------------------------------------

    public async Task<IReadOnlyList<RequestStatus>> GetRequestStatusesAsync(string userId, ProviderConfig cfg, CancellationToken ct)
    {
        // Readarr has no per-user request model — userId is intentionally ignored.
        _ = userId;

        if (!TryGetConnection(cfg, out var url, out var apiKey, out _))
        {
            return Array.Empty<RequestStatus>();
        }

        var instanceMediaType = GetInstanceMediaType(cfg);

        List<BookDto>? monitored;
        QueueResponseDto? queue;
        try
        {
            monitored = await _client.GetBooksAsync(url, apiKey, monitoredOnly: true, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Readarr GET /book?monitored=true failed");
            return Array.Empty<RequestStatus>();
        }

        if (monitored is null || monitored.Count == 0)
        {
            return Array.Empty<RequestStatus>();
        }

        try
        {
            queue = await _client.GetQueueAsync(url, apiKey, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Readarr GET /queue failed (continuing without progress decoration)");
            queue = null;
        }

        var queueByBook = new Dictionary<int, QueueItemDto>();
        if (queue?.Records is not null)
        {
            foreach (var item in queue.Records)
            {
                if (item.BookId is { } bookId && !queueByBook.ContainsKey(bookId))
                {
                    queueByBook[bookId] = item;
                }
            }
        }

        var output = new List<RequestStatus>();
        foreach (var book in monitored)
        {
            // Only surface "wanted" books — those without files. Ones with files
            // are already imported.
            if ((book.Statistics?.BookFileCount ?? 0) > 0)
            {
                continue;
            }

            RequestState state = RequestState.Pending;
            double? progress = null;
            string? message = null;

            if (queueByBook.TryGetValue(book.Id, out var qitem))
            {
                state = RequestState.InProgress;
                progress = ComputeProgress(qitem);
                message = qitem.Status;
            }

            var status = MapBookToRequestStatus(book, cfg, instanceMediaType, state, progress);
            if (status is null)
            {
                continue;
            }

            if (message is not null && status.Message is null)
            {
                status = new RequestStatus
                {
                    ProviderTypeId = status.ProviderTypeId,
                    ProviderInstanceId = status.ProviderInstanceId,
                    ExternalId = status.ExternalId,
                    MediaType = status.MediaType,
                    Title = status.Title,
                    State = status.State,
                    CreatedAt = status.CreatedAt,
                    PosterUrl = status.PosterUrl,
                    Message = message,
                    ProgressPercent = status.ProgressPercent,
                    ExternalUrl = status.ExternalUrl
                };
            }

            output.Add(status);
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

        var instanceMediaType = GetInstanceMediaType(cfg);

        List<BookDto>? books;
        try
        {
            books = await _client.GetBooksAsync(url, apiKey, monitoredOnly: true, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Readarr IndexAsync failed during GET /book");
            return EmptyIndexBatch();
        }

        if (books is null || books.Count == 0)
        {
            return new IndexBatch
            {
                Documents = Array.Empty<IndexDocument>(),
                Replace = since is null
            };
        }

        var docs = new List<IndexDocument>(books.Count);
        foreach (var book in books)
        {
            // Client-side `since` filter via book.added (Readarr has no
            // server-side delta filter).
            if (since is { } sinceUtc)
            {
                var added = ParseTimestamp(book.Added);
                if (added is null || added < sinceUtc)
                {
                    continue;
                }
            }

            var doc = MapBookToIndexDocument(book, instanceMediaType);
            if (doc is not null)
            {
                docs.Add(doc);
            }
        }

        return new IndexBatch
        {
            Documents = docs,
            // Full snapshot when there's no `since` cursor (first run); delta
            // otherwise so we don't wipe records that simply weren't updated.
            Replace = since is null
        };
    }

    // -------------------------------------------------------------------------
    // GetCalendarAsync
    // -------------------------------------------------------------------------

    public async Task<IReadOnlyList<CalendarEntry>> GetCalendarAsync(CalendarQuery query, ProviderConfig cfg, CancellationToken ct)
    {
        if (!TryGetConnection(cfg, out var url, out var apiKey, out _))
        {
            return Array.Empty<CalendarEntry>();
        }

        var instanceMediaType = GetInstanceMediaType(cfg);

        if (query.TypesFilter is { Count: > 0 } && !query.TypesFilter.Contains(instanceMediaType))
        {
            return Array.Empty<CalendarEntry>();
        }

        List<BookDto>? items;
        try
        {
            items = await _client.GetCalendarAsync(url, apiKey, query.Start, query.End, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Readarr GET /calendar failed");
            return Array.Empty<CalendarEntry>();
        }

        if (items is null || items.Count == 0)
        {
            return Array.Empty<CalendarEntry>();
        }

        var output = new List<CalendarEntry>(items.Count);
        foreach (var book in items)
        {
            var entry = MapBookToCalendarEntry(book, cfg, instanceMediaType);
            if (entry is not null)
            {
                output.Add(entry);
            }
        }

        return output;
    }

    // =========================================================================
    // Mapping helpers
    // =========================================================================

    private SearchResult? MapLibraryBookToSearchResult(BookDto book, ProviderConfig cfg, MediaType mediaType)
    {
        if (string.IsNullOrEmpty(book.Title))
        {
            return null;
        }

        var externalId = GetBookExternalId(book);
        if (externalId is null)
        {
            return null;
        }

        var inLibrary = (book.Statistics?.BookFileCount ?? 0) > 0;

        return new SearchResult
        {
            ProviderTypeId = TypeId,
            ProviderInstanceId = cfg.InstanceId,
            ExternalId = externalId,
            MediaType = mediaType,
            Title = book.Title!,
            Subtitle = book.AuthorTitle ?? book.Author?.AuthorName,
            Description = book.Overview,
            PosterUrl = SelectPoster(book.Images),
            Year = ParseYear(book.ReleaseDate),
            Rating = book.Ratings?.Value,
            InLibrary = inLibrary,
            ExternalUrl = null
        };
    }

    private SearchResult? MapLookupBookToSearchResult(BookDto book, ProviderConfig cfg, MediaType mediaType)
    {
        if (string.IsNullOrEmpty(book.Title) || string.IsNullOrEmpty(book.ForeignBookId))
        {
            return null;
        }

        return new SearchResult
        {
            ProviderTypeId = TypeId,
            ProviderInstanceId = cfg.InstanceId,
            ExternalId = book.ForeignBookId!,
            MediaType = mediaType,
            Title = book.Title!,
            Subtitle = book.AuthorTitle ?? book.Author?.AuthorName,
            Description = book.Overview,
            PosterUrl = SelectPoster(book.Images),
            Year = ParseYear(book.ReleaseDate),
            Rating = book.Ratings?.Value,
            InLibrary = false
        };
    }

    private IndexDocument? MapBookToIndexDocument(BookDto book, MediaType mediaType)
    {
        if (string.IsNullOrEmpty(book.Title))
        {
            return null;
        }

        var id = GetBookExternalId(book) ?? book.Id.ToString(CultureInfo.InvariantCulture);

        var extras = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["readarrId"] = book.Id.ToString(CultureInfo.InvariantCulture)
        };
        if (!string.IsNullOrEmpty(book.ForeignBookId))
        {
            extras["foreignBookId"] = book.ForeignBookId;
        }
        if (!string.IsNullOrEmpty(book.AuthorTitle))
        {
            extras["author"] = book.AuthorTitle;
        }
        if (!string.IsNullOrEmpty(book.SeriesTitle))
        {
            extras["series"] = book.SeriesTitle;
        }

        return new IndexDocument
        {
            Id = id,
            MediaType = mediaType,
            Title = book.Title!,
            Subtitle = book.AuthorTitle ?? book.Author?.AuthorName,
            Description = book.Overview,
            PosterUrl = SelectPoster(book.Images),
            Year = ParseYear(book.ReleaseDate),
            Tags = book.Genres?.Count > 0 ? book.Genres : null,
            Extras = extras
        };
    }

    private RequestStatus? MapBookToRequestStatus(
        BookDto book,
        ProviderConfig cfg,
        MediaType mediaType,
        RequestState state,
        double? progress)
    {
        if (string.IsNullOrEmpty(book.Title))
        {
            return null;
        }

        var externalId = GetBookExternalId(book);
        if (externalId is null)
        {
            return null;
        }

        var createdAt = ParseTimestamp(book.Added) ?? DateTime.UtcNow;

        return new RequestStatus
        {
            ProviderTypeId = TypeId,
            ProviderInstanceId = cfg.InstanceId,
            ExternalId = externalId,
            MediaType = mediaType,
            Title = book.Title!,
            State = state,
            CreatedAt = createdAt,
            PosterUrl = SelectPoster(book.Images),
            ProgressPercent = progress
        };
    }

    private RequestStatus? MapLookupBookToRequestStatus(
        BookDto book,
        ProviderConfig cfg,
        MediaType mediaType,
        RequestState state)
    {
        if (string.IsNullOrEmpty(book.Title) || string.IsNullOrEmpty(book.ForeignBookId))
        {
            return null;
        }

        return new RequestStatus
        {
            ProviderTypeId = TypeId,
            ProviderInstanceId = cfg.InstanceId,
            ExternalId = book.ForeignBookId!,
            MediaType = mediaType,
            Title = book.Title!,
            State = state,
            CreatedAt = DateTime.UtcNow,
            PosterUrl = SelectPoster(book.Images)
        };
    }

    private CalendarEntry? MapBookToCalendarEntry(BookDto book, ProviderConfig cfg, MediaType mediaType)
    {
        if (string.IsNullOrEmpty(book.Title))
        {
            return null;
        }

        var externalId = GetBookExternalId(book);
        if (externalId is null)
        {
            return null;
        }

        var release = ParseTimestamp(book.ReleaseDate);
        if (release is null)
        {
            return null;
        }

        string? subtitle = null;
        if (!string.IsNullOrEmpty(book.SeriesTitle))
        {
            subtitle = string.IsNullOrEmpty(book.SeriesPosition)
                ? book.SeriesTitle
                : $"{book.SeriesTitle} #{book.SeriesPosition}";
        }
        else if (!string.IsNullOrEmpty(book.AuthorTitle))
        {
            subtitle = book.AuthorTitle;
        }

        return new CalendarEntry
        {
            ProviderTypeId = TypeId,
            ProviderInstanceId = cfg.InstanceId,
            ExternalId = externalId,
            MediaType = mediaType,
            Title = book.Title!,
            ReleaseDate = release.Value,
            Subtitle = subtitle,
            PosterUrl = SelectPoster(book.Images),
            Description = book.Overview,
            Monitored = book.Monitored
        };
    }

    // =========================================================================
    // Lookup + create helpers
    // =========================================================================

    /// <summary>
    /// Look up an existing book by foreign id. Tries the cheap
    /// <c>?titleSlug=foreignBookId</c> form first (works when the slug equals
    /// the foreign id, which is rare but cheap to attempt) then falls back to
    /// scanning the full library.
    /// </summary>
    private async Task<BookDto?> FindExistingBookAsync(string url, string apiKey, string foreignBookId, CancellationToken ct)
    {
        var all = await _client.GetBooksAsync(url, apiKey, monitoredOnly: false, ct).ConfigureAwait(false);
        if (all is null)
        {
            return null;
        }

        foreach (var book in all)
        {
            if (string.Equals(book.ForeignBookId, foreignBookId, StringComparison.OrdinalIgnoreCase))
            {
                return book;
            }
        }

        // Fallback: try the foreign id as a title slug — some workflows pass
        // slug-shaped strings here.
        var slugMatches = await _client.GetBooksByTitleSlugAsync(url, apiKey, foreignBookId, ct).ConfigureAwait(false);
        if (slugMatches is { Count: > 0 })
        {
            return slugMatches[0];
        }

        return null;
    }

    /// <summary>
    /// Ensure the author exists in this Readarr instance, returning the author
    /// id. Looks up the existing author by foreignAuthorId; if missing, runs
    /// /author/lookup and POSTs the chosen result with the configured root
    /// folder, profiles, and tag.
    /// </summary>
    private async Task<int?> EnsureAuthorAsync(string url, string apiKey, ProviderConfig cfg, BookDto lookupBook, CancellationToken ct)
    {
        var foreignAuthorId = lookupBook.Author?.ForeignAuthorId;
        var authorName = lookupBook.AuthorTitle ?? lookupBook.Author?.AuthorName;

        // 1. Existing-author scan.
        var existingAuthors = await _client.GetAuthorsAsync(url, apiKey, ct).ConfigureAwait(false);
        if (existingAuthors is not null)
        {
            foreach (var a in existingAuthors)
            {
                if (!string.IsNullOrEmpty(foreignAuthorId)
                    && string.Equals(a.ForeignAuthorId, foreignAuthorId, StringComparison.OrdinalIgnoreCase))
                {
                    return a.Id;
                }
            }

            if (!string.IsNullOrEmpty(authorName))
            {
                foreach (var a in existingAuthors)
                {
                    if (string.Equals(a.AuthorName, authorName, StringComparison.OrdinalIgnoreCase))
                    {
                        return a.Id;
                    }
                }
            }
        }

        // 2. Need to create the author. Resolve a candidate via /author/lookup
        // unless the lookup payload already gave us a fully-formed author.
        AuthorDto? candidate = lookupBook.Author;
        if ((candidate is null || string.IsNullOrEmpty(candidate.ForeignAuthorId))
            && !string.IsNullOrEmpty(authorName))
        {
            var found = await _client.LookupAuthorAsync(url, apiKey, authorName, ct).ConfigureAwait(false);
            if (found is { Count: > 0 })
            {
                if (!string.IsNullOrEmpty(foreignAuthorId))
                {
                    foreach (var a in found)
                    {
                        if (string.Equals(a.ForeignAuthorId, foreignAuthorId, StringComparison.OrdinalIgnoreCase))
                        {
                            candidate = a;
                            break;
                        }
                    }
                }
                candidate ??= found[0];
            }
        }

        if (candidate is null || string.IsNullOrEmpty(candidate.ForeignAuthorId))
        {
            return null;
        }

        // 3. Fill in instance-level config.
        candidate.RootFolderPath = cfg.GetOrDefault(FieldRootFolder, "/library/books");
        candidate.QualityProfileId = ParseInt(cfg.Get(FieldQualityProfileId), fallback: 1);
        candidate.MetadataProfileId = ParseInt(cfg.Get(FieldMetadataProfileId), fallback: 1);
        candidate.Monitored = true;
        candidate.MonitorNewItems = "all";

        var tagLabel = cfg.Get(FieldTag)?.Trim();
        if (!string.IsNullOrEmpty(tagLabel))
        {
            var tagId = await EnsureTagAsync(url, apiKey, tagLabel!, ct).ConfigureAwait(false);
            if (tagId is not null)
            {
                candidate.Tags ??= new List<int>();
                if (!candidate.Tags.Contains(tagId.Value))
                {
                    candidate.Tags.Add(tagId.Value);
                }
            }
        }

        candidate.AddOptions = new AuthorAddOptionsDto
        {
            Monitor = "future",
            Monitored = true,
            SearchForMissingBooks = false,
            BooksToMonitor = new List<string>()
        };

        // 4. POST.
        using var post = await _client.AddAuthorAsync(url, apiKey, candidate, ct).ConfigureAwait(false);
        if (post.IsSuccessStatusCode)
        {
            try
            {
                var created = await post.Content.ReadFromJsonAsync<AuthorDto>(cancellationToken: ct).ConfigureAwait(false);
                return created?.Id;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse Readarr POST /author response");
                return null;
            }
        }

        var body = await ReadarrClient.ReadBodySafeAsync(post, ct).ConfigureAwait(false);
        if (ReadarrClient.IsAlreadyExists(post.StatusCode, body))
        {
            // Re-scan; the author should be there now (or was already there).
            var rescan = await _client.GetAuthorsAsync(url, apiKey, ct).ConfigureAwait(false);
            if (rescan is not null)
            {
                foreach (var a in rescan)
                {
                    if (!string.IsNullOrEmpty(candidate.ForeignAuthorId)
                        && string.Equals(a.ForeignAuthorId, candidate.ForeignAuthorId, StringComparison.OrdinalIgnoreCase))
                    {
                        return a.Id;
                    }
                }
            }
        }

        _logger.LogWarning(
            "Readarr POST /author returned {Status}: {Body}",
            (int)post.StatusCode, body);
        return null;
    }

    /// <summary>
    /// Ensure a tag with the given label exists; returns its id. Idempotent —
    /// recovers from the Servarr "already exists" 400 by re-fetching the list.
    /// </summary>
    private async Task<int?> EnsureTagAsync(string url, string apiKey, string label, CancellationToken ct)
    {
        var existing = await _client.GetTagsAsync(url, apiKey, ct).ConfigureAwait(false);
        if (existing is not null)
        {
            foreach (var t in existing)
            {
                if (string.Equals(t.Label, label, StringComparison.OrdinalIgnoreCase))
                {
                    return t.Id;
                }
            }
        }

        using var post = await _client.CreateTagAsync(url, apiKey, label, ct).ConfigureAwait(false);
        if (post.IsSuccessStatusCode)
        {
            try
            {
                var created = await post.Content.ReadFromJsonAsync<TagDto>(cancellationToken: ct).ConfigureAwait(false);
                return created?.Id;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse Readarr POST /tag response");
            }
        }
        else
        {
            var body = await ReadarrClient.ReadBodySafeAsync(post, ct).ConfigureAwait(false);
            if (!ReadarrClient.IsAlreadyExists(post.StatusCode, body))
            {
                _logger.LogWarning(
                    "Readarr POST /tag returned {Status}: {Body}",
                    (int)post.StatusCode, body);
                return null;
            }
        }

        // Re-fetch and look it up.
        var refetch = await _client.GetTagsAsync(url, apiKey, ct).ConfigureAwait(false);
        if (refetch is null)
        {
            return null;
        }

        foreach (var t in refetch)
        {
            if (string.Equals(t.Label, label, StringComparison.OrdinalIgnoreCase))
            {
                return t.Id;
            }
        }

        return null;
    }

    private async Task TriggerBookSearchAsync(string url, string apiKey, int bookId, CancellationToken ct)
    {
        try
        {
            var body = new CommandBody
            {
                Name = "BookSearch",
                BookIds = new List<int> { bookId }
            };

            using var response = await _client.SendCommandAsync(url, apiKey, body, ct).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var text = await ReadarrClient.ReadBodySafeAsync(response, ct).ConfigureAwait(false);
                _logger.LogWarning(
                    "Readarr POST /command BookSearch returned {Status} for bookId={Id}: {Body}",
                    (int)response.StatusCode, bookId, text);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Readarr BookSearch command failed for bookId={Id}", bookId);
        }
    }

    // =========================================================================
    // Misc helpers
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
            missing = "Readarr URL is not configured";
            return false;
        }

        if (string.IsNullOrEmpty(apiKey))
        {
            missing = "Readarr API key is not configured";
            return false;
        }

        missing = null;
        return true;
    }

    /// <summary>
    /// Resolve the instance-level <see cref="MediaType"/> from
    /// <c>cfg.Get("media_type")</c>. The single source of truth for every
    /// SearchResult / IndexDocument / CalendarEntry this instance produces.
    /// Falls back to <see cref="MediaType.Book"/> if missing/unknown so the
    /// provider continues to function with a sensible default.
    /// </summary>
    private static MediaType GetInstanceMediaType(ProviderConfig cfg)
    {
        var raw = cfg.Get(FieldMediaType)?.Trim().ToLowerInvariant();
        return raw switch
        {
            MediaTypeAudiobook => MediaType.Audiobook,
            MediaTypeComic => MediaType.Comic,
            MediaTypeBook => MediaType.Book,
            _ => MediaType.Book
        };
    }

    /// <summary>
    /// External id used by aggregators to dedupe across instances and for
    /// request flows. Prefer the foreign id (Goodreads/OL key) so the same
    /// book has a stable id regardless of which Readarr instance returned it.
    /// </summary>
    private static string? GetBookExternalId(BookDto book)
    {
        if (!string.IsNullOrEmpty(book.ForeignBookId))
        {
            return book.ForeignBookId;
        }

        if (book.Id > 0)
        {
            return book.Id.ToString(CultureInfo.InvariantCulture);
        }

        return null;
    }

    /// <summary>
    /// Pick the best image URL out of a list of Servarr images. Prefers the
    /// "cover" coverType, then "poster", then any. Returns the remoteUrl when
    /// available so it works without proxying through Readarr.
    /// </summary>
    private static string? SelectPoster(IReadOnlyList<ImageDto>? images)
    {
        if (images is null || images.Count == 0)
        {
            return null;
        }

        ImageDto? cover = null;
        ImageDto? poster = null;
        ImageDto? any = null;

        foreach (var img in images)
        {
            any ??= img;
            if (string.Equals(img.CoverType, "cover", StringComparison.OrdinalIgnoreCase))
            {
                cover ??= img;
            }
            else if (string.Equals(img.CoverType, "poster", StringComparison.OrdinalIgnoreCase))
            {
                poster ??= img;
            }
        }

        var pick = cover ?? poster ?? any;
        if (pick is null)
        {
            return null;
        }

        return !string.IsNullOrEmpty(pick.RemoteUrl) ? pick.RemoteUrl : pick.Url;
    }

    private static int ParseInt(string? raw, int fallback)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return fallback;
        }

        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : fallback;
    }

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

    /// <summary>
    /// Compute a 0-100 progress percent from a queue item's size + sizeleft.
    /// Returns null if either field is missing or non-positive.
    /// </summary>
    private static double? ComputeProgress(QueueItemDto item)
    {
        var total = item.Size ?? 0d;
        var left = item.SizeLeft ?? 0d;
        if (total <= 0d)
        {
            return null;
        }

        var done = total - left;
        if (done < 0d)
        {
            done = 0d;
        }

        var pct = done / total * 100d;
        if (pct < 0d)
        {
            pct = 0d;
        }
        if (pct > 100d)
        {
            pct = 100d;
        }
        return pct;
    }

    /// <summary>
    /// Lowercase, hyphen-collapsed slug used as a cheap exact-match probe
    /// against Readarr's <c>?titleSlug=</c> filter. Readarr's slugs are
    /// computed off the canonical title, so this is best-effort — if it
    /// misses, phase 2 (lookup) still finds the book.
    /// </summary>
    private static string SlugifyForSearch(string query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return string.Empty;
        }

        var sb = new System.Text.StringBuilder(query.Length);
        var lastWasHyphen = false;

        foreach (var ch in query.Trim().ToLowerInvariant())
        {
            if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'))
            {
                sb.Append(ch);
                lastWasHyphen = false;
            }
            else if (ch is ' ' or '-' or '_' or '.' or ',' or ':' or ';')
            {
                if (!lastWasHyphen && sb.Length > 0)
                {
                    sb.Append('-');
                    lastWasHyphen = true;
                }
            }
            // Drop anything else.
        }

        if (sb.Length > 0 && sb[^1] == '-')
        {
            sb.Length -= 1;
        }

        return sb.ToString();
    }

    private static IndexBatch EmptyIndexBatch() => new()
    {
        Documents = Array.Empty<IndexDocument>(),
        Replace = true
    };
}
