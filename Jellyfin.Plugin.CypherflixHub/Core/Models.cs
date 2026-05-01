using System;
using System.Collections.Generic;

namespace Jellyfin.Plugin.CypherflixHub.Core;

// =============================================================================
// Search
// =============================================================================

public class SearchQuery
{
    public required string Query { get; init; }
    public IReadOnlySet<MediaType>? TypesFilter { get; init; }   // null = all
    public string? UserId { get; init; }
    public int Limit { get; init; } = 25;
    public int Offset { get; init; } = 0;
}

/// <summary>
/// One result row. Same shape across providers so the UI can render uniformly.
/// </summary>
public class SearchResult
{
    public required string ProviderTypeId { get; init; }       // "jellyseerr"
    public required Guid ProviderInstanceId { get; init; }     // which instance returned this
    public required string ExternalId { get; init; }           // provider-side ID (e.g. tmdb id, OL key, readarr book id)
    public required MediaType MediaType { get; init; }
    public required string Title { get; init; }

    public string? Subtitle { get; init; }                     // e.g. author for books, year for movies
    public string? Description { get; init; }
    public string? PosterUrl { get; init; }
    public string? BackdropUrl { get; init; }
    public int? Year { get; init; }
    public double? Rating { get; init; }
    public IReadOnlyList<string>? Tags { get; init; }

    /// <summary>True if the user's library already has this — UI shows Play not Request.</summary>
    public bool InLibrary { get; init; }

    /// <summary>For <see cref="InLibrary"/>=true items, the Jellyfin item id to play.</summary>
    public string? JellyfinItemId { get; init; }

    /// <summary>True if the user already has a request for this — UI shows status.</summary>
    public bool RequestPending { get; init; }

    /// <summary>For deep-linking out to the provider's own UI.</summary>
    public string? ExternalUrl { get; init; }
}

// =============================================================================
// Request
// =============================================================================

public class RequestPayload
{
    public required Guid ProviderInstanceId { get; init; }
    public required string ExternalId { get; init; }
    public required MediaType MediaType { get; init; }
    public required string UserId { get; init; }

    /// <summary>Per-provider extras — e.g. seasons for TV, edition for books.</summary>
    public IReadOnlyDictionary<string, string>? Extras { get; init; }
}

public class RequestStatus
{
    public required string ProviderTypeId { get; init; }
    public required Guid ProviderInstanceId { get; init; }
    public required string ExternalId { get; init; }
    public required MediaType MediaType { get; init; }
    public required string Title { get; init; }
    public required RequestState State { get; init; }
    public required DateTime CreatedAt { get; init; }

    public string? RequestedByUserId { get; init; }
    public string? RequestedByUserName { get; init; }
    public string? PosterUrl { get; init; }
    public string? Message { get; init; }                       // e.g. error reason on Failed
    public double? ProgressPercent { get; init; }               // for InProgress state
    public string? ExternalUrl { get; init; }
}

public enum RequestState
{
    Pending,        // submitted, awaiting approval
    Approved,       // approved, queued for grab
    InProgress,     // grabbing / downloading
    Available,      // grabbed and imported successfully
    Failed,         // grab failed permanently
    Declined        // admin declined the request
}

// =============================================================================
// Calendar
// =============================================================================

public class CalendarQuery
{
    public required DateTime Start { get; init; }
    public required DateTime End { get; init; }
    public IReadOnlySet<MediaType>? TypesFilter { get; init; }
    public string? UserId { get; init; }
}

public class CalendarEntry
{
    public required string ProviderTypeId { get; init; }
    public required Guid ProviderInstanceId { get; init; }
    public required string ExternalId { get; init; }
    public required MediaType MediaType { get; init; }
    public required string Title { get; init; }
    public required DateTime ReleaseDate { get; init; }

    public string? Subtitle { get; init; }                      // e.g. "Season 5 Episode 1", "Book 4"
    public string? PosterUrl { get; init; }
    public string? Description { get; init; }
    public string? ExternalUrl { get; init; }
    public bool Monitored { get; init; }                        // is this on the user's request list?
}

// =============================================================================
// Indexing
// =============================================================================

/// <summary>
/// One batch of records the provider is contributing to Meilisearch on a periodic
/// IndexAsync call. The framework writes them to the provider's dedicated index.
/// </summary>
public class IndexBatch
{
    public required IReadOnlyList<IndexDocument> Documents { get; init; }

    /// <summary>If non-null, the framework deletes documents with these IDs from the
    /// provider's index before adding the new batch (used for full refreshes).</summary>
    public IReadOnlyList<string>? DeleteIds { get; init; }

    /// <summary>True if the index should be cleared before applying this batch.</summary>
    public bool Replace { get; init; }
}

public class IndexDocument
{
    public required string Id { get; init; }                    // provider-unique
    public required MediaType MediaType { get; init; }
    public required string Title { get; init; }

    public string? Subtitle { get; init; }
    public string? Description { get; init; }
    public string? PosterUrl { get; init; }
    public int? Year { get; init; }
    public IReadOnlyList<string>? Tags { get; init; }
    public IReadOnlyDictionary<string, string>? Extras { get; init; }
}

// =============================================================================
// Test
// =============================================================================

public class TestResult
{
    public required bool Ok { get; init; }
    public string? Message { get; init; }
    public string? Detail { get; init; }
}
