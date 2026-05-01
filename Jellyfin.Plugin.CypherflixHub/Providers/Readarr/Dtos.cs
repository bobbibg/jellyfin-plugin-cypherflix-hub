using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.CypherflixHub.Providers.Readarr;

// =============================================================================
// DTOs for the subset of the Readarr (Faustvii fork) v1 API we consume.
//
// Source: https://readarr.com/docs/api/ — see JELLYFIN-INTEGRATION.md §8 for
// the full endpoint table and the validation-error idempotency contract.
//
// Only fields we actually read are declared; unknown fields are ignored by
// System.Text.Json by default. Numeric fields are nullable to tolerate schema
// drift across Readarr 0.x point releases and the Faustvii fork.
// =============================================================================

// ----- System status ---------------------------------------------------------

public sealed class SystemStatusDto
{
    [JsonPropertyName("version")]
    public string? Version { get; set; }

    [JsonPropertyName("appName")]
    public string? AppName { get; set; }
}

// ----- Image -----------------------------------------------------------------

public sealed class ImageDto
{
    /// <summary>"poster" | "cover" | "fanart" | "logo" | "headshot".</summary>
    [JsonPropertyName("coverType")]
    public string? CoverType { get; set; }

    [JsonPropertyName("url")]
    public string? Url { get; set; }

    [JsonPropertyName("remoteUrl")]
    public string? RemoteUrl { get; set; }
}

// ----- Statistics ------------------------------------------------------------

public sealed class BookStatisticsDto
{
    [JsonPropertyName("bookFileCount")]
    public int BookFileCount { get; set; }

    [JsonPropertyName("bookCount")]
    public int BookCount { get; set; }

    [JsonPropertyName("totalBookCount")]
    public int TotalBookCount { get; set; }

    [JsonPropertyName("sizeOnDisk")]
    public long SizeOnDisk { get; set; }
}

// ----- Book ------------------------------------------------------------------

public sealed class BookDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("titleSlug")]
    public string? TitleSlug { get; set; }

    [JsonPropertyName("seriesTitle")]
    public string? SeriesTitle { get; set; }

    [JsonPropertyName("overview")]
    public string? Overview { get; set; }

    /// <summary>Goodreads / Open Library work key. Use as the cross-instance ExternalId for not-yet-added books.</summary>
    [JsonPropertyName("foreignBookId")]
    public string? ForeignBookId { get; set; }

    [JsonPropertyName("authorId")]
    public int? AuthorId { get; set; }

    [JsonPropertyName("authorTitle")]
    public string? AuthorTitle { get; set; }

    [JsonPropertyName("monitored")]
    public bool Monitored { get; set; }

    [JsonPropertyName("anyEditionOk")]
    public bool? AnyEditionOk { get; set; }

    [JsonPropertyName("releaseDate")]
    public string? ReleaseDate { get; set; }

    [JsonPropertyName("added")]
    public string? Added { get; set; }

    [JsonPropertyName("ratings")]
    public RatingsDto? Ratings { get; set; }

    [JsonPropertyName("images")]
    public List<ImageDto>? Images { get; set; }

    [JsonPropertyName("editions")]
    public List<EditionDto>? Editions { get; set; }

    [JsonPropertyName("author")]
    public AuthorDto? Author { get; set; }

    [JsonPropertyName("statistics")]
    public BookStatisticsDto? Statistics { get; set; }

    [JsonPropertyName("seriesPosition")]
    public string? SeriesPosition { get; set; }

    [JsonPropertyName("genres")]
    public List<string>? Genres { get; set; }
}

public sealed class RatingsDto
{
    [JsonPropertyName("votes")]
    public int? Votes { get; set; }

    [JsonPropertyName("value")]
    public double? Value { get; set; }
}

public sealed class EditionDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("overview")]
    public string? Overview { get; set; }

    [JsonPropertyName("monitored")]
    public bool Monitored { get; set; }

    [JsonPropertyName("isEbook")]
    public bool? IsEbook { get; set; }

    [JsonPropertyName("foreignEditionId")]
    public string? ForeignEditionId { get; set; }

    [JsonPropertyName("images")]
    public List<ImageDto>? Images { get; set; }
}

// ----- Author ----------------------------------------------------------------

public sealed class AuthorDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("authorName")]
    public string? AuthorName { get; set; }

    [JsonPropertyName("authorNameLastFirst")]
    public string? AuthorNameLastFirst { get; set; }

    [JsonPropertyName("foreignAuthorId")]
    public string? ForeignAuthorId { get; set; }

    [JsonPropertyName("titleSlug")]
    public string? TitleSlug { get; set; }

    [JsonPropertyName("overview")]
    public string? Overview { get; set; }

    [JsonPropertyName("rootFolderPath")]
    public string? RootFolderPath { get; set; }

    [JsonPropertyName("qualityProfileId")]
    public int QualityProfileId { get; set; }

    [JsonPropertyName("metadataProfileId")]
    public int MetadataProfileId { get; set; }

    [JsonPropertyName("monitored")]
    public bool Monitored { get; set; }

    [JsonPropertyName("monitorNewItems")]
    public string? MonitorNewItems { get; set; }

    [JsonPropertyName("tags")]
    public List<int>? Tags { get; set; }

    [JsonPropertyName("images")]
    public List<ImageDto>? Images { get; set; }

    [JsonPropertyName("addOptions")]
    public AuthorAddOptionsDto? AddOptions { get; set; }
}

public sealed class AuthorAddOptionsDto
{
    [JsonPropertyName("monitor")]
    public string Monitor { get; set; } = "future";

    [JsonPropertyName("booksToMonitor")]
    public List<string>? BooksToMonitor { get; set; }

    [JsonPropertyName("monitored")]
    public bool Monitored { get; set; } = true;

    [JsonPropertyName("searchForMissingBooks")]
    public bool SearchForMissingBooks { get; set; }
}

// ----- Book add payload ------------------------------------------------------

public sealed class BookAddPayloadDto
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("foreignBookId")]
    public string? ForeignBookId { get; set; }

    [JsonPropertyName("monitored")]
    public bool Monitored { get; set; } = true;

    [JsonPropertyName("anyEditionOk")]
    public bool AnyEditionOk { get; set; } = true;

    [JsonPropertyName("authorId")]
    public int? AuthorId { get; set; }

    [JsonPropertyName("author")]
    public AuthorDto? Author { get; set; }

    [JsonPropertyName("editions")]
    public List<EditionDto>? Editions { get; set; }

    [JsonPropertyName("addOptions")]
    public BookAddOptionsDto? AddOptions { get; set; }
}

public sealed class BookAddOptionsDto
{
    [JsonPropertyName("addType")]
    public string AddType { get; set; } = "automatic";

    [JsonPropertyName("searchForNewBook")]
    public bool SearchForNewBook { get; set; } = true;
}

// ----- Tag -------------------------------------------------------------------

public sealed class TagDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("label")]
    public string? Label { get; set; }
}

public sealed class CreateTagBody
{
    [JsonPropertyName("label")]
    public string Label { get; set; } = "";
}

// ----- Queue -----------------------------------------------------------------

public sealed class QueueResponseDto
{
    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("pageSize")]
    public int PageSize { get; set; }

    [JsonPropertyName("totalRecords")]
    public int TotalRecords { get; set; }

    [JsonPropertyName("records")]
    public List<QueueItemDto>? Records { get; set; }
}

public sealed class QueueItemDto
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("bookId")]
    public int? BookId { get; set; }

    [JsonPropertyName("authorId")]
    public int? AuthorId { get; set; }

    [JsonPropertyName("size")]
    public double? Size { get; set; }

    [JsonPropertyName("sizeleft")]
    public double? SizeLeft { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("trackedDownloadStatus")]
    public string? TrackedDownloadStatus { get; set; }

    [JsonPropertyName("trackedDownloadState")]
    public string? TrackedDownloadState { get; set; }

    [JsonPropertyName("timeleft")]
    public string? TimeLeft { get; set; }
}

// ----- Command ---------------------------------------------------------------

public sealed class CommandBody
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("bookIds")]
    public List<int>? BookIds { get; set; }

    [JsonPropertyName("authorIds")]
    public List<int>? AuthorIds { get; set; }
}

// ----- Validation error ------------------------------------------------------

/// <summary>
/// Servarr-standard validation error shape returned as a 400 body when an entity
/// already exists. We inspect this to detect "already added" cases and recover
/// the existing record via a follow-up GET.
/// </summary>
public sealed class ValidationFailureDto
{
    [JsonPropertyName("propertyName")]
    public string? PropertyName { get; set; }

    [JsonPropertyName("errorMessage")]
    public string? ErrorMessage { get; set; }

    [JsonPropertyName("errorCode")]
    public string? ErrorCode { get; set; }
}
