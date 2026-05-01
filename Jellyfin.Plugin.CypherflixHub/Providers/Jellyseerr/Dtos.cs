using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.CypherflixHub.Providers.Jellyseerr;

// =============================================================================
// DTOs for the subset of the Jellyseerr/Overseerr API we consume.
// Source: https://api-docs.overseerr.dev/  +
// https://github.com/Fallenbagel/jellyseerr (User entity adds jellyfinUsername /
// jellyfinUserId on top of the upstream User schema).
//
// We deliberately model only the fields we use; unknown fields are ignored by
// System.Text.Json by default. All primitive numerics are nullable to tolerate
// schema drift across Jellyseerr versions.
// =============================================================================

public sealed class StatusResponse
{
    [JsonPropertyName("version")]
    public string? Version { get; set; }

    [JsonPropertyName("commitTag")]
    public string? CommitTag { get; set; }
}

// ----- Search ----------------------------------------------------------------

public sealed class SearchResponse
{
    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("totalPages")]
    public int TotalPages { get; set; }

    [JsonPropertyName("totalResults")]
    public int TotalResults { get; set; }

    [JsonPropertyName("results")]
    public List<SearchResultDto>? Results { get; set; }
}

/// <summary>
/// Union of MovieResult / TvResult / PersonResult — fields that don't apply to
/// a given mediaType are simply null. We filter to mediaType in {movie,tv}.
/// </summary>
public sealed class SearchResultDto
{
    [JsonPropertyName("id")]
    public long Id { get; set; }

    /// <summary>"movie" | "tv" | "person".</summary>
    [JsonPropertyName("mediaType")]
    public string? MediaType { get; set; }

    // Movie fields
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("originalTitle")]
    public string? OriginalTitle { get; set; }

    [JsonPropertyName("releaseDate")]
    public string? ReleaseDate { get; set; }

    // TV fields
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("originalName")]
    public string? OriginalName { get; set; }

    [JsonPropertyName("firstAirDate")]
    public string? FirstAirDate { get; set; }

    // Common
    [JsonPropertyName("overview")]
    public string? Overview { get; set; }

    [JsonPropertyName("posterPath")]
    public string? PosterPath { get; set; }

    [JsonPropertyName("backdropPath")]
    public string? BackdropPath { get; set; }

    [JsonPropertyName("voteAverage")]
    public double? VoteAverage { get; set; }

    [JsonPropertyName("genreIds")]
    public List<int>? GenreIds { get; set; }

    [JsonPropertyName("mediaInfo")]
    public MediaInfoDto? MediaInfo { get; set; }
}

/// <summary>
/// Inline media metadata attached to search/discover hits when Jellyseerr already
/// knows about the item (because it's been requested or imported).
/// status: 1=UNKNOWN, 2=PENDING, 3=PROCESSING, 4=PARTIALLY_AVAILABLE, 5=AVAILABLE, 6=DELETED.
/// </summary>
public sealed class MediaInfoDto
{
    [JsonPropertyName("id")]
    public long? Id { get; set; }

    [JsonPropertyName("tmdbId")]
    public long? TmdbId { get; set; }

    [JsonPropertyName("tvdbId")]
    public long? TvdbId { get; set; }

    [JsonPropertyName("status")]
    public int? Status { get; set; }

    [JsonPropertyName("mediaType")]
    public string? MediaType { get; set; }
}

// ----- Discover --------------------------------------------------------------

public sealed class DiscoverResponse
{
    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("totalPages")]
    public int TotalPages { get; set; }

    [JsonPropertyName("results")]
    public List<SearchResultDto>? Results { get; set; }
}

// ----- Request ---------------------------------------------------------------

public sealed class RequestListResponse
{
    [JsonPropertyName("pageInfo")]
    public PageInfoDto? PageInfo { get; set; }

    [JsonPropertyName("results")]
    public List<MediaRequestDto>? Results { get; set; }
}

public sealed class PageInfoDto
{
    [JsonPropertyName("pages")]
    public int Pages { get; set; }

    [JsonPropertyName("pageSize")]
    public int PageSize { get; set; }

    [JsonPropertyName("results")]
    public int Results { get; set; }

    [JsonPropertyName("page")]
    public int Page { get; set; }
}

/// <summary>
/// status: 1=PENDING, 2=APPROVED, 3=DECLINED.
/// </summary>
public sealed class MediaRequestDto
{
    [JsonPropertyName("id")]
    public long Id { get; set; }

    [JsonPropertyName("status")]
    public int Status { get; set; }

    [JsonPropertyName("createdAt")]
    public string? CreatedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public string? UpdatedAt { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("media")]
    public RequestMediaDto? Media { get; set; }

    [JsonPropertyName("requestedBy")]
    public UserDto? RequestedBy { get; set; }

    [JsonPropertyName("seasons")]
    public List<RequestSeasonDto>? Seasons { get; set; }
}

/// <summary>
/// The "media" embedded inside a MediaRequest. Includes the same status int as
/// MediaInfoDto plus the title fields Jellyseerr resolves from TMDB.
/// </summary>
public sealed class RequestMediaDto
{
    [JsonPropertyName("id")]
    public long? Id { get; set; }

    [JsonPropertyName("tmdbId")]
    public long? TmdbId { get; set; }

    [JsonPropertyName("tvdbId")]
    public long? TvdbId { get; set; }

    [JsonPropertyName("mediaType")]
    public string? MediaType { get; set; }

    [JsonPropertyName("status")]
    public int? Status { get; set; }

    // Jellyseerr enriches the media object on list responses with these
    // human-readable bits resolved against TMDB.
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("posterPath")]
    public string? PosterPath { get; set; }
}

public sealed class RequestSeasonDto
{
    [JsonPropertyName("id")]
    public long? Id { get; set; }

    [JsonPropertyName("seasonNumber")]
    public int SeasonNumber { get; set; }

    [JsonPropertyName("status")]
    public int? Status { get; set; }
}

// ----- POST /request body ----------------------------------------------------

public sealed class CreateRequestBody
{
    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = "";

    [JsonPropertyName("mediaId")]
    public long MediaId { get; set; }

    [JsonPropertyName("userId")]
    public int? UserId { get; set; }

    /// <summary>
    /// For TV: array of season numbers, OR the literal string "all". We always
    /// send "all" by default (overridable via Extras["seasons"]).
    /// </summary>
    [JsonPropertyName("seasons")]
    public object? Seasons { get; set; }

    [JsonPropertyName("tvdbId")]
    public long? TvdbId { get; set; }
}

// ----- User ------------------------------------------------------------------

public sealed class UserListResponse
{
    [JsonPropertyName("pageInfo")]
    public PageInfoDto? PageInfo { get; set; }

    [JsonPropertyName("results")]
    public List<UserDto>? Results { get; set; }
}

public sealed class UserDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("email")]
    public string? Email { get; set; }

    [JsonPropertyName("username")]
    public string? Username { get; set; }

    [JsonPropertyName("plexUsername")]
    public string? PlexUsername { get; set; }

    /// <summary>Jellyseerr-only field (not in Overseerr).</summary>
    [JsonPropertyName("jellyfinUsername")]
    public string? JellyfinUsername { get; set; }

    /// <summary>Jellyseerr-only field; the Jellyfin user GUID as a string.</summary>
    [JsonPropertyName("jellyfinUserId")]
    public string? JellyfinUserId { get; set; }

    [JsonPropertyName("displayName")]
    public string? DisplayName { get; set; }
}
