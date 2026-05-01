using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Jellyfin.Plugin.CypherflixHub.Core;

/// <summary>
/// The contract every provider implements. One C# class per provider TYPE
/// (Jellyseerr, Readarr, ReadMeABook, Spotify, …). Multiple INSTANCES of a type
/// can be configured by the admin (e.g. two Readarr instances, one for books
/// and one for comics, each with their own URL + API key).
///
/// Implementations should be:
/// - Stateless. Per-instance state lives in the <see cref="ProviderConfig"/>
///   passed in on every call.
/// - Tolerant to missing capabilities — the framework will only call methods
///   for capabilities the admin has enabled on the instance.
/// - Resilient to transient failures — return empty results on network blips
///   rather than throwing.
///
/// See ARCHITECTURE.md → "Adding a provider" for a step-by-step guide.
/// </summary>
public interface IMediaProvider
{
    // ---------- Type metadata (static, used by the admin UI) ----------------

    /// <summary>Stable identifier, lowercase-with-hyphens. Persisted in config.</summary>
    string TypeId { get; }

    /// <summary>Display name for the admin UI ("Jellyseerr", "Readarr").</summary>
    string DisplayName { get; }

    /// <summary>One-paragraph description shown when picking a provider type.</summary>
    string Description { get; }

    /// <summary>Optional icon URL or asset name used in the admin UI.</summary>
    string? IconUrl { get; }

    /// <summary>Which media types this provider deals with.</summary>
    IReadOnlyList<MediaType> SupportedMediaTypes { get; }

    /// <summary>Which capabilities this provider implements.</summary>
    IReadOnlyList<Capability> SupportedCapabilities { get; }

    /// <summary>Schema for the per-instance config form rendered by the admin UI.</summary>
    IReadOnlyList<ConfigField> ConfigSchema { get; }

    // ---------- Per-instance operations -------------------------------------

    /// <summary>Verify the instance's URL/credentials work.</summary>
    Task<TestResult> TestConnectionAsync(ProviderConfig cfg, CancellationToken ct);

    /// <summary>
    /// Live keyword search. Should return quickly (used in the search bar
    /// onChange flow). Should respect <paramref name="query.TypesFilter"/>.
    /// </summary>
    Task<IReadOnlyList<SearchResult>> SearchAsync(SearchQuery query, ProviderConfig cfg, CancellationToken ct);

    /// <summary>
    /// Submit a request. Implementations should be idempotent — re-requesting
    /// an existing item should be a no-op that returns success.
    /// </summary>
    Task<RequestSubmissionResult> RequestAsync(RequestPayload payload, ProviderConfig cfg, CancellationToken ct);

    /// <summary>List the user's requests in this provider.</summary>
    Task<IReadOnlyList<RequestStatus>> GetRequestStatusesAsync(string userId, ProviderConfig cfg, CancellationToken ct);

    /// <summary>
    /// Periodic catalogue snapshot for Meilisearch. Called by the IndexerService
    /// roughly hourly; implementations should be cheap on the second call (use
    /// <paramref name="since"/> to fetch deltas where the upstream API supports it).
    /// </summary>
    Task<IndexBatch> IndexAsync(System.DateTime? since, ProviderConfig cfg, CancellationToken ct);

    /// <summary>Upcoming items in the date window.</summary>
    Task<IReadOnlyList<CalendarEntry>> GetCalendarAsync(CalendarQuery query, ProviderConfig cfg, CancellationToken ct);
}

/// <summary>Result of <see cref="IMediaProvider.RequestAsync"/>.</summary>
public class RequestSubmissionResult
{
    public required bool Ok { get; init; }
    public RequestStatus? Status { get; init; }
    public string? Message { get; init; }
}
