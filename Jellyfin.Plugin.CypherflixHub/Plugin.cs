using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Jellyfin.Plugin.CypherflixHub.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.CypherflixHub;

/// <summary>
/// Cypherflix Hub — books + comics frontend for the cypherflix-grabber V2
/// backend. Thin C# shell that:
///
///   <list type="number">
///     <item>Registers the admin config page via <see cref="IHasWebPages"/></item>
///     <item>Reverse-proxies <c>/Cypherflix/api/*</c> to the grabber (see <c>Api/CypherflixController</c>)</item>
///     <item>Serves the Vite-built bundle + Plugin Pages HTML fragments (see <c>Api/WebController</c>)</item>
///     <item>Drops a JSON record into Plugin Pages's config.json so our 3 pages appear in the sidebar</item>
///     <item>Registers an index.html transform with File Transformation so <c>inject.ts</c> runs on every Jellyfin page</item>
///   </list>
///
/// The Plugin Pages registration uses the file-drop pattern (verified in
/// <c>.recon/plugin-pages-verification.md</c>) — direct DI of
/// <c>IPluginPagesManager</c> would not work because Jellyfin loads each
/// plugin into its own <see cref="System.Runtime.Loader.AssemblyLoadContext"/>,
/// so the type identity wouldn't match across the boundary.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>
    /// Bumping this triggers a rewrite of our entries in Plugin Pages's
    /// <c>config.json</c> on next plugin start. Bump whenever you change
    /// the page list, route URLs, or icons.
    /// </summary>
    private const int PluginPageConfigVersion = 1;

    private readonly IApplicationPaths _applicationPaths;

    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        _applicationPaths = applicationPaths;

        try
        {
            RegisterPluginPagesEntries();
        }
        catch (Exception ex)
        {
            // Non-fatal: if we can't write the file, the plugin still works
            // for native-page injection via File Transformation. Log via
            // Console because we don't have a logger in the constructor.
            Console.Error.WriteLine($"[CypherflixHub] Plugin Pages config update failed: {ex.Message}");
        }
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Cypherflix Hub";

    public override Guid Id => Guid.Parse("c1f1e571-7ba8-4d6a-9e2b-3a4f0c5d7e8b");

    public override string Description =>
        "Books + comics UI for the cypherflix-grabber V2 backend. " +
        "Adds Discover, Queue, and Following pages plus native injections " +
        "into Jellyfin's book / author / series detail pages.";

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        // This is Jellyfin's BUILT-IN PluginPageInfo (admin config page) —
        // not to be confused with the Plugin Pages plugin's separate
        // PluginPage type used for sidebar entries below.
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

    private void RegisterPluginPagesEntries()
    {
        var pluginPagesConfigDir = Path.Combine(
            _applicationPaths.PluginConfigurationsPath,
            "Jellyfin.Plugin.PluginPages");
        var pluginPagesConfig = Path.Combine(pluginPagesConfigDir, "config.json");

        Directory.CreateDirectory(pluginPagesConfigDir);

        JObject config = File.Exists(pluginPagesConfig)
            ? JObject.Parse(File.ReadAllText(pluginPagesConfig))
            : new JObject();

        if (!config.ContainsKey("pages"))
        {
            config["pages"] = new JArray();
        }
        var pages = (JArray)config["pages"]!;

        var ownerNs = typeof(Plugin).Namespace ?? "Jellyfin.Plugin.CypherflixHub";
        // Three sidebar entries. The 4th route (/details/{kind}/{sourceId})
        // is reachable by clicking a card — no sidebar entry needed.
        var entries = new[]
        {
            new PluginPageEntry($"{ownerNs}.Discover",  "/CypherflixHub/discover",  "Discover",  "explore"),
            new PluginPageEntry($"{ownerNs}.Queue",     "/CypherflixHub/queue",     "Queue",     "queue_music"),
            new PluginPageEntry($"{ownerNs}.Following", "/CypherflixHub/following", "Following", "bookmarks"),
        };

        bool dirty = false;

        // Drop our existing entries that are older than the current version
        // so they get re-added with up-to-date URLs / icons.
        var existing = pages.OfType<JObject>()
            .Where(p =>
            {
                var id = p.Value<string>("Id");
                return id != null && id.StartsWith(ownerNs, StringComparison.Ordinal);
            })
            .ToList();
        foreach (var entry in existing)
        {
            var version = entry.Value<int?>("Version") ?? 0;
            if (version < PluginPageConfigVersion)
            {
                pages.Remove(entry);
                dirty = true;
            }
        }

        // Add any of ours that aren't already there.
        foreach (var e in entries)
        {
            var hasMatch = pages.OfType<JObject>().Any(p => p.Value<string>("Id") == e.Id);
            if (hasMatch) continue;

            pages.Add(new JObject
            {
                ["Id"] = e.Id,
                ["Url"] = e.Url,
                ["DisplayText"] = e.DisplayText,
                ["Icon"] = e.Icon,
                ["Version"] = PluginPageConfigVersion,
            });
            dirty = true;
        }

        if (dirty)
        {
            File.WriteAllText(pluginPagesConfig, config.ToString(Formatting.Indented));
        }
    }

    private sealed record PluginPageEntry(string Id, string Url, string DisplayText, string Icon);
}
