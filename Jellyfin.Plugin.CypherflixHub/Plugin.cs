using System;
using System.Collections.Generic;
using Jellyfin.Plugin.CypherflixHub.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.CypherflixHub;

/// <summary>
/// Cypherflix Hub — unified search/discover/requests/calendar across the whole stack.
/// See ARCHITECTURE.md for the full design.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Cypherflix Hub";

    public override Guid Id => Guid.Parse("c1f1e571-7ba8-4d6a-9e2b-3a4f0c5d7e8b");

    public override string Description =>
        "Unified search, discover, requests, and calendar across Jellyseerr, " +
        "Readarr, ReadMeABook, and any future provider. Replaces the JF Enhanced " +
        "Requests/Calendar tabs with multi-provider versions.";

    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = "CypherflixHub",
                EmbeddedResourcePath = $"{GetType().Namespace}.Configuration.configPage.html",
                MenuSection = "server",
                DisplayName = "Cypherflix Hub"
            }
        };
    }
}
