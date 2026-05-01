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
    }

    /// <summary>Configured provider instances. The admin UI manages this list.</summary>
    public ProviderInstance[] Providers { get; set; }

    /// <summary>Where to reach Meilisearch (internal docker hostname or LAN URL).</summary>
    public string MeilisearchUrl { get; set; }

    /// <summary>Meilisearch master/admin API key (or scoped key with index-write).</summary>
    public string MeilisearchApiKey { get; set; }

    /// <summary>How often the indexer runs each provider (minutes).</summary>
    public int IndexIntervalMinutes { get; set; }
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
