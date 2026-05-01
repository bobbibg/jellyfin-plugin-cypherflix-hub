namespace Jellyfin.Plugin.CypherflixHub.Core;

/// <summary>
/// Categories of content that providers can deal with. A provider declares which
/// it supports via <see cref="IMediaProvider.SupportedMediaTypes"/>; the UI uses
/// these for grouping search results and powering type filters.
/// </summary>
public enum MediaType
{
    Movie,
    TvShow,
    Book,
    Comic,
    Audiobook,
    Music,
    Other
}
