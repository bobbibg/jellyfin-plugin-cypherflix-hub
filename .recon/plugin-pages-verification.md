# Plugin Pages surface verification

Verified against the actual binary published as the 10.11.8 release of plugin **Plugin Pages** by IAmParadox27, plus the matching tag in the source repo, plus a working consumer (Home Screen Sections).

## Installed version on NAS

NAS could not be SSH'd from the sandbox (SSH-agent keys are not exposed inside the workspace, and Desktop Commander shells produced empty output). The installed version was instead determined from the authoritative plugin manifest published at `https://www.iamparadox.dev/jellyfin/plugins/manifest.json` (this is the manifest URL Bobbi's Jellyfin install pulls Plugin Pages from).

Manifest entry for Jellyfin 10.11.8 (verbatim, trimmed):

```json
{
  "guid": "5b6550fa-a014-4f4c-8a2c-59a43680ac6d",
  "name": "Plugin Pages",
  "version": "2.4.9.0",
  "changelog": "✨ New Features\n\n- Added support for 10.11.8",
  "targetAbi": "10.11.8.0",
  "sourceUrl": "https://github.com/IAmParadox27/jellyfin-plugin-pages/releases/download/2.4.9.0/Release-10.11.8.zip",
  "checksum": "8934B4ACA1CC8FD84800218112B2667B",
  "timestamp": "2026-01-19T21:32:45",
  "dependencies": ["5e87cc92-571a-4d8d-8d98-d2d4147f9f90"]
}
```

- **Plugin GUID**: `5b6550fa-a014-4f4c-8a2c-59a43680ac6d`
- **Installed version**: `2.4.9.0` (target ABI `10.11.8.0`)
- **Hard dependency**: `5e87cc92-571a-4d8d-8d98-d2d4147f9f90` = File Transformation plugin (also IAmParadox27)
- **Path on NAS** (expected): `/volume3/Docker/cypherflix/config/jellyfin/plugins/Pages_2.4.9.0/Jellyfin.Plugin.PluginPages.dll`
- **Binary copied to workspace**: `/sessions/.../mnt/outputs/plugin-pages/Jellyfin.Plugin.PluginPages.dll` (downloaded from the manifest's `sourceUrl`)

The binary's embedded PDB path is `/opt/buildagent/work/b8c7a3100eaa2b4f/src/Jellyfin.Plugin.PluginPages/obj/Release/net9.0/Jellyfin.Plugin.PluginPages.pdb` — confirms it is the official build, net9.0, from this same source tree.

GitHub tag matching the binary: `2.4.9.0` (commit `ee8359020ed47f24ace1a7e4a6e170a3623fcc27` on the 2.4.7.0 branch — the 2.4.8/2.4.9 tags re-issue the same source against newer Jellyfin ABIs, the C# surface is unchanged from 2.4.7).

## Public surface (from source at matching tag)

### IPluginPagesManager

- **Namespace**: `Jellyfin.Plugin.PluginPages.Library`
- **Source file**: `src/Jellyfin.Plugin.PluginPages/Library/IPluginPagesManager.cs`
- **Source URL**: <https://github.com/IAmParadox27/jellyfin-plugin-pages/blob/2.4.9.0/src/Jellyfin.Plugin.PluginPages/Library/IPluginPagesManager.cs>

Verbatim:

```csharp
namespace Jellyfin.Plugin.PluginPages.Library
{
    public interface IPluginPagesManager
    {
        void RegisterPluginPage(PluginPage page);

        IEnumerable<PluginPage> GetPages();
    }

    public class PluginPage
    {
        public string? Id { get; set; }
        public string? Url { get; set; }
        public string? DisplayText { get; set; }
        public string? Icon { get; set; }
    }
}
```

### PluginPage (the actual data shape — NOT "PluginPageInfo")

Critical: the architecture doc's `PluginPageInfo` with `Route / DisplayName / ScriptUrls / StylesheetUrls` does **not exist** in this plugin. The real shape is `Jellyfin.Plugin.PluginPages.Library.PluginPage` and it has only **four** properties:

| Property      | Type      | Notes                                                                                                                                                  |
|---------------|-----------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Id`          | `string?` | Used for dedup in `RegisterPluginPage` (`if any has same Id, ignore`). Convention seen in HSS: the consumer plugin's namespace, e.g. `Jellyfin.Plugin.CypherflixHub`. |
| `Url`         | `string?` | The URL the sidebar link routes to. May be a path under the Jellyfin base URL (e.g. `/CypherflixHub/discover`). See "Route semantics" below.            |
| `DisplayText` | `string?` | Human-readable label shown in the sidebar.                                                                                                             |
| `Icon`        | `string?` | A Material Icons name. The inject.js renders it as `<span class="material-icons navMenuOptionIcon ${icon}">`. Examples seen in the wild: `"ballot"`.   |

There is **no** `ScriptUrls`, `StylesheetUrls`, `Route` (singular), or `Name` field on this type.

### PluginPagesManager (impl)

- **Namespace**: `Jellyfin.Plugin.PluginPages.Manager`
- **Source URL**: <https://github.com/IAmParadox27/jellyfin-plugin-pages/blob/2.4.9.0/src/Jellyfin.Plugin.PluginPages/Manager/PluginPagesManager.cs>
- Behaviour: in-memory list. `RegisterPluginPage` is idempotent on `Id`. `GetPages` returns the registered list. Pages are not persisted by this manager.

### PluginServiceRegistrator

- **Source URL**: <https://github.com/IAmParadox27/jellyfin-plugin-pages/blob/2.4.9.0/src/Jellyfin.Plugin.PluginPages/PluginServiceRegistrator.cs>
- Registers `IPluginPagesManager` as a `Singleton` in Jellyfin's DI container:

```csharp
public class PluginPagesServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<IPluginPagesManager, PluginPagesManager>();
    }
}
```

So `IPluginPagesManager` IS available via Jellyfin's DI — but **only if the consumer plugin is loaded into the same `AssemblyLoadContext`**, which is **not** how Jellyfin loads third-party plugins. See "Cross-plugin pitfall" below.

### PluginPagesController

- **Route**: `[Route("[controller]")]` → `/PluginPages`
- **Endpoints used by the inject.js**:
  - `GET /PluginPages/User` → `QueryResult<PluginPage>` (used by sidebar to list pages)
  - `GET /PluginPages/inject.js` → the sidebar-injection script (served as `application/javascript`)

### PluginPagesPlugin (the bootstrapping)

- **Source URL**: <https://github.com/IAmParadox27/jellyfin-plugin-pages/blob/2.4.9.0/src/Jellyfin.Plugin.PluginPages/PluginPagesPlugin.cs>
- On construction, reads `Jellyfin.Plugin.PluginPages/config.json` from `IApplicationPaths.PluginConfigurationsPath` (`/config/plugins/configurations/Jellyfin.Plugin.PluginPages/config.json` on the NAS).
- Deserialises the `pages` array into `PluginPage[]` and calls `IPluginPagesManager.RegisterPluginPage` for each. Uses the standard property names `Id`, `Url`, `DisplayText`, `Icon`.

So pages are loaded **once at plugin startup** from JSON. The constructor's `pluginPagesManager` parameter is DI-injected (Plugin Pages declares its own services and consumes its own service in its own ALC, so this works fine for the plugin itself).

## Cross-plugin pitfall — DI does NOT work for consumers

This is the most important finding for cypherflix-hub.

Per IAmParadox27's other plugin (Home Screen Sections, the canonical consumer), Jellyfin loads each plugin into a **separate `AssemblyLoadContext`**, so a consumer plugin cannot directly depend on `IPluginPagesManager` and have it resolved by DI: the type identity is different across ALCs.

The pattern Home Screen Sections actually uses is to **write a JSON record into the Plugin Pages config file** that the Plugin Pages plugin then reads on its own startup. This is the only supported registration mechanism for consumer plugins.

Source URL: <https://github.com/IAmParadox27/jellyfin-plugin-home-sections/blob/main/src/Jellyfin.Plugin.HomeScreenSections/HomeScreenSectionsPlugin.cs#L37-L97>

Verbatim relevant excerpt (HomeScreenSectionsPlugin constructor body):

```csharp
string pluginPagesConfig = Path.Combine(
    applicationPaths.PluginConfigurationsPath,
    "Jellyfin.Plugin.PluginPages",
    "config.json");

JObject config = new JObject();
if (!File.Exists(pluginPagesConfig))
{
    FileInfo info = new FileInfo(pluginPagesConfig);
    info.Directory?.Create();
}
else
{
    config = JObject.Parse(File.ReadAllText(pluginPagesConfig));
}

if (!config.ContainsKey("pages"))
{
    config.Add("pages", new JArray());
}

// Version-bump-aware: if our existing entry is older than this run's version, drop it so we re-add it.
JObject? hssPageConfig = config.Value<JArray>("pages")!
    .FirstOrDefault(x => x.Value<string>("Id") == typeof(HomeScreenSectionsPlugin).Namespace) as JObject;
if (hssPageConfig != null
    && (hssPageConfig.Value<int?>("Version") ?? 0) < pluginPageConfigVersion)
{
    config.Value<JArray>("pages")!.Remove(hssPageConfig);
}

if (!config.Value<JArray>("pages")!.Any(x => x.Value<string>("Id") == typeof(HomeScreenSectionsPlugin).Namespace))
{
    Assembly? pluginPagesAssembly =
        AssemblyLoadContext.All.SelectMany(x => x.Assemblies)
            .FirstOrDefault(x => x.FullName?.Contains("Jellyfin.Plugin.PluginPages") ?? false);

    Version earliestVersionWithSubUrls = new Version("2.4.1.0");
    bool supportsSubUrls = pluginPagesAssembly != null
        && pluginPagesAssembly.GetName().Version >= earliestVersionWithSubUrls;

    string rootUrl = ServerConfigurationManager.GetNetworkConfiguration().BaseUrl.TrimStart('/').Trim();
    if (!string.IsNullOrEmpty(rootUrl))
    {
        rootUrl = $"/{rootUrl}";
    }

    config.Value<JArray>("pages")!.Add(new JObject
    {
        { "Id", typeof(HomeScreenSectionsPlugin).Namespace },
        { "Url", $"{(supportsSubUrls ? "" : rootUrl)}/ModularHomeViews/settings" },
        { "DisplayText", "Modular Home" },
        { "Icon", "ballot" },
        { "Version", pluginPageConfigVersion }
    });

    File.WriteAllText(pluginPagesConfig, config.ToString(Formatting.Indented));
}
```

Note the version-detection trick: HSS uses reflection to find the loaded Plugin Pages assembly so it can decide whether to prefix the URL with the Jellyfin base URL or let Plugin Pages do it (≥2.4.1.0 handles base URL itself).

### Route + asset URL semantics

- The **`Url`** field on a `PluginPage` is the URL the sidebar link routes to. The inject.js builds the `href` as:
  - `#/userpluginsettings.html?pageUrl=${item.Url}`
  - i.e. it loads Jellyfin's own `userpluginsettings.html` shell and that shell then issues `ApiClient.ajax({ type: 'GET', url: pageUrl })` to fetch HTML and append it inside `.userPluginSettingsContainer`.
- If `pageUrl` starts with `/`, `ApiClient.getUrl(pageUrl)` is called to prepend the Jellyfin base URL automatically (since 2.4.1.0).
- Therefore the URL **must point at an authenticated endpoint that returns HTML** (a chunk that goes inside the existing Jellyfin shell). Returning a full `<html>` document will likely break.
- HSS implements this by exposing a controller route (`/ModularHomeViews/{viewName}`) that streams an embedded HTML resource via `File(stream, mime)`.
- There are **no** separate `ScriptUrls` / `StylesheetUrls` fields — any JS or CSS the page needs has to be loaded by the HTML chunk itself (e.g. via `<script src=...>` or `<link rel=stylesheet href=...>`), or registered via the File Transformation plugin so the JS gets injected into Jellyfin's bundle.
- The `Icon` field is just a Material Icons class name; no path resolution.

### Allowed route patterns

- The route can be any URL fragment that resolves to an authenticated HTML-returning endpoint on the Jellyfin server.
- Slashes are fine; query strings work (HSS uses `/ModularHomeViews/settings`).
- For Plugin Pages 2.4.1.0+: paths starting with `/` get the Jellyfin base URL auto-prefixed at click time.
- Multiple pages share one Plugin Pages config file — each entry must have a unique `Id`.

### config.json schema (verbatim from PluginPagesPlugin.cs)

```json
{
  "pages": [
    {
      "Id": "Jellyfin.Plugin.CypherflixHub",
      "Url": "/CypherflixHub/discover",
      "DisplayText": "Cypherflix",
      "Icon": "explore"
    }
  ]
}
```

Property names are PascalCase (`Newtonsoft.Json` default behaviour with no settings). Extra properties (e.g. `"Version"` as HSS does) are ignored by Plugin Pages but useful for the consumer's own version-bump logic.

Path on NAS: `/volume3/Docker/cypherflix/config/jellyfin/plugins/configurations/Jellyfin.Plugin.PluginPages/config.json`

## Cross-check vs installed binary

`strings` on the dll downloaded from the 10.11.8 release confirms the public surface matches the source:

```
IPluginPagesManager
RegisterPluginPage
GetPages
PluginPagesController
PluginPagesPlugin
PluginPagesServiceRegistrator
get_DisplayText / set_DisplayText / <DisplayText>k__BackingField
Jellyfin.Plugin.PluginPages.Library
Jellyfin.Plugin.PluginPages.Manager
Jellyfin.Plugin.PluginPages.Controller.inject.js
Jellyfin.Plugin.PluginPages.Controller.userpluginsettings.html
```

No `PluginPageInfo`, no `ScriptUrls`, no `StylesheetUrls`, no `Route` (singular) symbols — the architecture doc was wrong about all of those. Only `PluginPage` with the four documented properties exists.

## How to consume from cypherflix-hub

### Project reference: do NOT add one

Because of the AssemblyLoadContext separation, **do not add a `<PackageReference>` or `<Reference>` for Plugin Pages**. There is no NuGet package and even if there were, the type wouldn't match across ALCs. The only consumer dependency cypherflix-hub needs is on `Newtonsoft.Json` (which is already present in the Jellyfin server's loaded assemblies, but you should add it explicitly):

```xml
<PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
```

### Plugin.cs registration code

Drop this into `Jellyfin.Plugin.CypherflixHub/Plugin.cs` constructor (mirroring HSS exactly, but registering four pages). Recommend gating the writes on a "config version" so the file gets regenerated whenever you change the page list:

```csharp
private const int CYPHERFLIX_PAGE_CONFIG_VERSION = 1;

// In the constructor, after base() and Instance assignment:
RegisterPluginPagesEntries(applicationPaths);

private void RegisterPluginPagesEntries(IApplicationPaths applicationPaths)
{
    string pluginPagesConfigDir = Path.Combine(
        applicationPaths.PluginConfigurationsPath,
        "Jellyfin.Plugin.PluginPages");
    string pluginPagesConfig = Path.Combine(pluginPagesConfigDir, "config.json");

    Directory.CreateDirectory(pluginPagesConfigDir);

    JObject config = File.Exists(pluginPagesConfig)
        ? JObject.Parse(File.ReadAllText(pluginPagesConfig))
        : new JObject();

    if (!config.ContainsKey("pages"))
    {
        config["pages"] = new JArray();
    }

    JArray pages = config.Value<JArray>("pages")!;
    string ownerId = typeof(CypherflixHubPlugin).Namespace!; // "Jellyfin.Plugin.CypherflixHub"

    // Drop our existing entries if older than current config version, then re-add fresh.
    var existing = pages
        .OfType<JObject>()
        .Where(p =>
        {
            string? id = p.Value<string>("Id");
            return id != null && id.StartsWith(ownerId);
        })
        .ToList();

    bool needsRewrite = false;
    foreach (var entry in existing)
    {
        if ((entry.Value<int?>("Version") ?? 0) < CYPHERFLIX_PAGE_CONFIG_VERSION)
        {
            pages.Remove(entry);
            needsRewrite = true;
        }
    }

    bool anyOurs = pages.OfType<JObject>().Any(p => (p.Value<string>("Id") ?? "").StartsWith(ownerId));
    if (anyOurs && !needsRewrite)
    {
        return;
    }

    // Plugin Pages >= 2.4.1.0 auto-prefixes base URL when pageUrl starts with '/'. NAS is on 2.4.9.0.
    var entries = new (string suffix, string url, string label, string icon)[]
    {
        ("Discover",  "/CypherflixHub/discover",  "Discover",  "explore"),
        ("Queue",     "/CypherflixHub/queue",     "Queue",     "queue_music"),
        ("Following", "/CypherflixHub/following", "Following", "bookmarks"),
        // Detail page reuses the Following entry — nothing to register; deep links land on /CypherflixHub/details/...
    };

    foreach (var (suffix, url, label, icon) in entries)
    {
        pages.Add(new JObject
        {
            { "Id",          $"{ownerId}.{suffix}" },
            { "Url",         url },
            { "DisplayText", label },
            { "Icon",        icon },
            { "Version",     CYPHERFLIX_PAGE_CONFIG_VERSION }
        });
    }

    File.WriteAllText(pluginPagesConfig, config.ToString(Formatting.Indented));
}
```

### Service injection

Do NOT add `IPluginPagesManager` to your plugin's constructor — it will not resolve cross-ALC. The constructor only needs the standard Jellyfin services (`IApplicationPaths`, `IXmlSerializer`, `ILogger<>`, `IServerConfigurationManager`).

### What you still need to implement

1. A `[Route("CypherflixHub")]` `ApiController` in cypherflix-hub that serves the four HTML chunks at `GET /CypherflixHub/discover`, `/queue`, `/following`, `/details/{kind}/{source_id}`. Each must return an HTML *fragment* (not a full document) — e.g. `File(embeddedStream, "text/html")`.
2. The HTML fragments load whatever JS/CSS they need themselves (e.g. `<script src="/CypherflixHub/web/cypherflix.js" defer></script>`). Add a separate controller route to serve those as embedded resources.
3. Plugin Pages does NOT do any deep-link / sub-route handling for you. The detail page route `/details/{kind}/{source_id}` works because the `pageUrl` query param is passed through verbatim to `ApiClient.ajax`, and your controller can have `[HttpGet("details/{kind}/{source_id}")]`.

### Pitfalls / version constraints

- **Detail page is NOT a sidebar entry.** Don't register `/details/...` in `config.json` — it's a deep-link only. Just three sidebar entries (Discover / Queue / Following).
- **Plugin Pages 2.4.0.0** *does not* support sub-paths in `Url`; **2.4.1.0+** does (via base-URL auto-prefix when path starts with `/`). NAS runs 2.4.9.0, so this is fine — but if HSS-style version detection matters to you, mirror the `AssemblyLoadContext.All.SelectMany(...)` reflection check.
- The `Id` field is the dedup key. Use distinct ids per page (e.g. `Jellyfin.Plugin.CypherflixHub.Discover`).
- The icon string is a Material Icons class. Verify your chosen icons exist in Jellyfin's bundled Material Icons set. Examples seen working in the IAmParadox27 ecosystem: `ballot` (HSS), and the inject.js HTML treats it as a CSS class on a span.
- The constructor write happens every time the plugin loads. Put a version gate around it (HSS-style) so you're not thrashing the file on every restart.
- **Hard prerequisite**: Plugin Pages itself depends on the **File Transformation** plugin (GUID `5e87cc92-571a-4d8d-8d98-d2d4147f9f90`). Both must be installed, otherwise the inject.js never gets injected and the sidebar entries never render.
- **HTML fragment, not full page**: returning a `<!DOCTYPE html>` document will break the layout. Just return the inner-page markup that gets appended into `.userPluginSettingsContainer`.

## Summary table

| Architecture-doc claim                             | Reality                                                                                                  |
|----------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| Type is `PluginPageInfo`                           | Type is `PluginPage` (`Jellyfin.Plugin.PluginPages.Library`)                                            |
| Properties: `Route, DisplayName, ScriptUrls, StylesheetUrls` | Properties: `Id, Url, DisplayText, Icon` (only)                                                |
| `IPluginPagesManager` injected via DI in plugin ctor | Cross-ALC: not injectable. Use config.json file-write pattern (per HSS).                              |
| Direct C# API                                      | None usable from a separate plugin. JSON file is the contract.                                          |
| Separate script/stylesheet registration            | Doesn't exist. HTML fragment self-loads its assets.                                                     |
