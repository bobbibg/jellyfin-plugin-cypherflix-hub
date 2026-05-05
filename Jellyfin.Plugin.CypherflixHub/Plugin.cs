using System;
using System.Collections.Generic;
using Jellyfin.Plugin.CypherflixHub.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.CypherflixHub;

/// <summary>
/// Cypherflix Hub — books + comics frontend for the cypherflix-grabber V2 backend.
/// Thin C# shell: registers an admin config page, injects a JS bundle into the
/// Jellyfin web UI, and reverse-proxies /Cypherflix/api/* to the grabber.
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
        "Books + comics UI for the cypherflix-grabber V2 backend. " +
        "Adds Manage and Discover tabs for watchlists and requests.";

    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = "CypherflixHub",
                EmbeddedResourcePath = $"{GetType().Namespace}.Configuration.configPage.html",
                MenuSection = "server",
                DisplayName = "Cypherflix Hub",
            },
        };
    }
}
