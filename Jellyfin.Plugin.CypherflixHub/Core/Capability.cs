namespace Jellyfin.Plugin.CypherflixHub.Core;

/// <summary>
/// Each capability corresponds to one method on <see cref="IMediaProvider"/>.
/// A provider declares which capabilities it supports (e.g. ReadarrProvider may
/// support Search + Index + Request + Calendar but not Recommendations).
///
/// Per-instance toggles let admins turn off capabilities on a configured
/// provider — e.g. "use this Readarr for Search only, not Calendar".
/// </summary>
public enum Capability
{
    /// <summary>Live keyword search against the provider.</summary>
    Search,

    /// <summary>Periodic indexing into Meilisearch (catalogue browse).</summary>
    Index,

    /// <summary>Request a specific item.</summary>
    Request,

    /// <summary>Read user's request statuses (pending / approved / available).</summary>
    RequestStatus,

    /// <summary>Upcoming releases / scheduled items.</summary>
    Calendar,

    /// <summary>Recommendations / discover feeds (e.g. Jellyseerr Discover, Lidarr Discover).</summary>
    Discover
}
