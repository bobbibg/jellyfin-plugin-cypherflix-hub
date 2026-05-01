using System;
using System.Collections.Generic;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Providers.Jellyfin;

/// <summary>
/// Thin wrapper over <see cref="ILibraryManager"/> that the
/// <see cref="JellyfinProvider"/> uses for the lookups it needs. Keeps the
/// provider declarative — call sites don't have to construct
/// <see cref="InternalItemsQuery"/> objects directly and we have one place to
/// catch transient failures and log warnings instead of leaking exceptions
/// out to the framework.
/// </summary>
public class JellyfinClient
{
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<JellyfinClient> _logger;

    /// <summary>
    /// The <see cref="BaseItemKind"/> values this plugin treats as
    /// user-facing media — verified against Jellyfin.Data 10.10.7. See
    /// JELLYFIN-INTEGRATION.md §1.1.2.
    /// </summary>
    public static readonly BaseItemKind[] SupportedItemKinds =
    {
        BaseItemKind.Movie,
        BaseItemKind.Series,
        BaseItemKind.Season,
        BaseItemKind.Episode,
        BaseItemKind.Book,
        BaseItemKind.MusicAlbum,
        BaseItemKind.Audio,
        BaseItemKind.AudioBook,
    };

    public JellyfinClient(ILibraryManager libraryManager, ILogger<JellyfinClient> logger)
    {
        _libraryManager = libraryManager;
        _logger = logger;
    }

    /// <summary>
    /// Live keyword search across the supported item kinds. Returns an empty
    /// list (and logs a warning) on any error — the framework should never
    /// see an exception from a provider.
    /// </summary>
    public IReadOnlyList<BaseItem> Search(string searchTerm, int limit, int offset)
    {
        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return Array.Empty<BaseItem>();
        }

        try
        {
            var query = new InternalItemsQuery
            {
                SearchTerm = searchTerm,
                IncludeItemTypes = SupportedItemKinds,
                Recursive = true,
                Limit = limit > 0 ? limit : null,
                StartIndex = offset > 0 ? offset : null,
                EnableTotalRecordCount = false,
            };

            var result = _libraryManager.GetItemsResult(query);
            return result?.Items ?? Array.Empty<BaseItem>();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jellyfin library search failed for term '{Term}'", searchTerm);
            return Array.Empty<BaseItem>();
        }
    }

    /// <summary>
    /// Snapshot of every item in the library matching the supported kinds, up
    /// to <paramref name="maxItems"/>. Returns an empty list on error.
    /// </summary>
    public IReadOnlyList<BaseItem> Snapshot(int maxItems)
    {
        try
        {
            var query = new InternalItemsQuery
            {
                IncludeItemTypes = SupportedItemKinds,
                Recursive = true,
                Limit = maxItems > 0 ? maxItems : null,
                EnableTotalRecordCount = false,
            };

            var result = _libraryManager.GetItemsResult(query);
            return result?.Items ?? Array.Empty<BaseItem>();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Jellyfin library snapshot failed");
            return Array.Empty<BaseItem>();
        }
    }
}
