using System;
using System.Collections.Generic;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.CypherflixHub.Configuration;

public class PluginConfiguration : BasePluginConfiguration
{
    public PluginConfiguration()
    {
        Providers = Array.Empty<ProviderInstance>();
        MeilisearchUrl = "http://meilisearch:7700";
        MeilisearchApiKey = "";
        IndexIntervalMinutes = 60;
        JellyseerrUserMap = Array.Empty<JellyseerrUserMapping>();
    }

    /// <summary>Configured provider instances. The admin UI manages this list.</summary>
    public ProviderInstance[] Providers { get; set; }

    /// <summary>Where to reach Meilisearch (internal docker hostname or LAN URL).</summary>
    public string MeilisearchUrl { get; set; }

    /// <summary>Meilisearch master/admin API key (or scoped key with index-write).</summary>
    public string MeilisearchApiKey { get; set; }

    /// <summary>How often the indexer runs each provider (minutes).</summary>
    public int IndexIntervalMinutes { get; set; }

    /// <summary>
    /// Cached mapping of Jellyfin user GUID → Jellyseerr user id. Populated on
    /// first request submission (and on first call to GetRequestStatusesAsync) by
    /// matching the Jellyfin username against the Jellyseerr user list. Stored
    /// here so we don't have to re-resolve on every request.
    /// </summary>
    public JellyseerrUserMapping[] JellyseerrUserMap { get; set; }
}

/// <summary>
/// One configured provider — saved in plugin XML. Mirrors how Sonarr stores its
/// indexer/download-client list.
/// </summary>
public class ProviderInstance
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TypeId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Enabled { get; set; } = true;

    /// <summary>Capabilities the admin enabled — subset of the type's SupportedCapabilities.</summary>
    public string[] EnabledCapabilities { get; set; } = Array.Empty<string>();

    /// <summary>Field values keyed by ConfigField.Key — serialised as KV pairs.</summary>
    public ConfigEntry[] Config { get; set; } = Array.Empty<ConfigEntry>();
}

/// <summary>XML serializer doesn't handle Dictionary cleanly — use a list of pairs.</summary>
public class ConfigEntry
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

/// <summary>
/// One row in <see cref="PluginConfiguration.JellyseerrUserMap"/>. XML-friendly
/// shape (no dictionaries) so Jellyfin's XML serialiser produces clean output.
/// </summary>
public class JellyseerrUserMapping
{
    public Guid JellyfinUserId { get; set; }
    public int JellyseerrUserId { get; set; }
}
