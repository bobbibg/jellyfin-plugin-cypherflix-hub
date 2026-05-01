# Jellyfin Integration Reference

Ground-truth class names, namespaces, and API contracts that this plugin
depends on. Every claim in this doc is sourced; if you change something here,
update the citation.

**Rule:** if you (an agent) need a Jellyfin or third-party class name and it's
not already documented here, **add it here with a source URL** before using
it. No invented names.

---

## 1. Jellyfin core plugin contract

### 1.1 Base classes / interfaces

| Type | Namespace | NuGet package | Source |
|---|---|---|---|
| `BasePlugin<TConfig>` | `MediaBrowser.Common.Plugins` | `Jellyfin.Controller` 10.10.7 | https://github.com/jellyfin/jellyfin |
| `IHasWebPages` | `MediaBrowser.Common.Plugins` | `Jellyfin.Controller` | (same) |
| `IPluginServiceRegistrator` | `MediaBrowser.Controller.Plugins` | `Jellyfin.Controller` | (same) |
| `BasePluginConfiguration` | `MediaBrowser.Model.Plugins` | `Jellyfin.Model` 10.10.7 | (same) |
| `PluginPageInfo` | `MediaBrowser.Model.Plugins` | `Jellyfin.Model` | https://raw.githubusercontent.com/jellyfin/jellyfin/master/MediaBrowser.Model/Plugins/PluginPageInfo.cs |
| `IApplicationPaths` | `MediaBrowser.Common.Configuration` | `Jellyfin.Common` | (same) |
| `IXmlSerializer` | `MediaBrowser.Model.Serialization` | `Jellyfin.Model` | (same) |
| `IServerApplicationHost` | `MediaBrowser.Controller` | `Jellyfin.Controller` | (same) |
| `ILibraryManager` | `MediaBrowser.Controller.Library` | `Jellyfin.Controller` | (same) |
| `IUserManager` | `MediaBrowser.Controller.Library` | `Jellyfin.Controller` | (same) |
| `BaseItem` | `MediaBrowser.Controller.Entities` | `Jellyfin.Controller` | https://raw.githubusercontent.com/jellyfin/jellyfin/master/MediaBrowser.Controller/Entities/BaseItem.cs |
| `InternalItemsQuery` | `MediaBrowser.Controller.Entities` | `Jellyfin.Controller` | https://raw.githubusercontent.com/jellyfin/jellyfin/master/MediaBrowser.Controller/Entities/InternalItemsQuery.cs |
| `BaseItemKind` (enum) | `Jellyfin.Data.Enums` | `Jellyfin.Data` (transitive via `Jellyfin.Model`) | https://raw.githubusercontent.com/jellyfin/jellyfin/master/src/Jellyfin.Data/Enums/BaseItemKind.cs |
| `QueryResult<T>` | `MediaBrowser.Model.Querying` | `Jellyfin.Model` | https://raw.githubusercontent.com/jellyfin/jellyfin/master/MediaBrowser.Model/Querying/QueryResult.cs |

### 1.1.1 `ILibraryManager` methods used by PROV-001

Verified against `Jellyfin.Controller` 10.10.7 by reflecting the shipped DLL
(`C:\Users\<u>\.nuget\packages\jellyfin.controller\10.10.7\lib\net8.0\MediaBrowser.Controller.dll`):

```csharp
QueryResult<BaseItem> GetItemsResult(InternalItemsQuery query);
List<BaseItem>        GetItemList(InternalItemsQuery query);
List<BaseItem>        GetItemList(InternalItemsQuery query, bool allowExternalContent);
List<BaseItem>        GetItemList(InternalItemsQuery query, List<BaseItem> parents);
QueryResult<BaseItem> QueryItems(InternalItemsQuery query);
```

Relevant `InternalItemsQuery` properties (subset, verified by reflection):

| Property | Type |
|---|---|
| `SearchTerm` | `string` |
| `IncludeItemTypes` | `BaseItemKind[]` |
| `Limit` | `int?` |
| `StartIndex` | `int?` |
| `Recursive` | `bool` |
| `EnableTotalRecordCount` | `bool` |

Relevant `BaseItem` members used:

| Member | Type / signature |
|---|---|
| `Id` | `Guid` |
| `Name` | `string` |
| `ProductionYear` | `int?` |
| `Overview` | `string` |
| `PremiereDate` | `DateTime?` |
| `Tags` | `string[]` |
| `DateCreated` | `DateTime` |
| `Album` | `string` |
| `GetBaseItemKind()` | `BaseItemKind` |

### 1.1.2 `BaseItemKind` values used by PROV-001

Full enum verified by loading `Jellyfin.Data.dll` 10.10.7 — the values relevant
to this plugin (subset of 37 total members):

| `BaseItemKind` | Plugin's `MediaType` mapping |
|---|---|
| `Movie` | `Movie` |
| `Series` | `TvShow` |
| `Season` | `TvShow` |
| `Episode` | `TvShow` |
| `Book` | `Book` (covers comics until Jellyfin gains a `Comic` kind) |
| `MusicAlbum` | `Music` |
| `Audio` | `Music` |
| `AudioBook` | `Audiobook` |

Note: there is **no** `Comic` value in `BaseItemKind` 10.10.7. The Bookshelf
plugin exposes `.cbz` files as `Book` items; we treat all `Book` items as
`MediaType.Book` and revisit when/if Jellyfin adds a dedicated comic kind.

### 1.2 `PluginPageInfo` shape (verbatim)

```csharp
namespace MediaBrowser.Model.Plugins
{
    public class PluginPageInfo
    {
        public string Name { get; set; } = string.Empty;
        public string? DisplayName { get; set; }
        public string EmbeddedResourcePath { get; set; } = string.Empty;
        public bool EnableInMainMenu { get; set; }
        public string? MenuSection { get; set; }
        public string? MenuIcon { get; set; }
    }
}
```

`MenuSection` is a free-form string; the only value with verbatim usage in the
wild is `"server"`. There is no enum and no server-side validation. We
default to `"server"` for admin-only settings pages and **do not** rely on a
hypothetical `"user"` value (the SendToKindle plugin used `"user"` in
practice — keep that as the second option, but treat it as best-effort). For
"appears in main left-nav", set `EnableInMainMenu = true`.

### 1.3 Auth attributes — DO NOT USE `[Authorize(Policy = "DefaultAuthorization")]`

That policy is not registered for plugin controllers in JF 10.10/10.11; every
request 500s. Use bare `[Authorize]` and parse claims manually:

```csharp
private Guid GetCurrentUserId()
{
    var v = User.FindFirst("Jellyfin-UserId")?.Value
            ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
    return string.IsNullOrEmpty(v) ? Guid.Empty : Guid.Parse(v);
}

private bool IsAdmin() =>
    string.Equals(User.FindFirst("Jellyfin-IsAdministrator")?.Value, "true",
        StringComparison.OrdinalIgnoreCase);
```

Source: SendToKindle v1.1.3 (battle-tested in this homelab).

### 1.4 Controller discovery

Plugin controllers are discovered automatically by Jellyfin if they live in
the plugin assembly and inherit from `Microsoft.AspNetCore.Mvc.ControllerBase`
with `[ApiController]` + `[Route(...)]`. Routes prefix from the `[Route]`
attribute (e.g. `[Route("CypherflixHub")]` → `/CypherflixHub/...`).

---

## 2. File Transformation plugin (REQUIRED dependency)

We use this to inject our title-bar tabs and SPA bootstrap script into
`index.html`. There is no first-class Jellyfin API for that, so File
Transformation is the proven approach (used by Custom Tabs, Plugin Pages,
Home Sections).

### 2.1 Why we can't reference it directly

Per the File Transformation README: "Due to issues with Jellyfin's plugins
being loaded into different load contexts this cannot be referenced directly.
Instead you can use reflection to invoke the plugin directly to register your
transformation."

So registration is by reflection.

### 2.2 The reflection recipe (verbatim from README)

Source: https://github.com/IAmParadox27/jellyfin-plugin-file-transformation

```csharp
Assembly? fileTransformationAssembly =
    AssemblyLoadContext.All.SelectMany(x => x.Assemblies).FirstOrDefault(x =>
        x.FullName?.Contains(".FileTransformation") ?? false);

if (fileTransformationAssembly != null)
{
    Type? pluginInterfaceType = fileTransformationAssembly.GetType(
        "Jellyfin.Plugin.FileTransformation.PluginInterface");

    if (pluginInterfaceType != null)
    {
        pluginInterfaceType.GetMethod("RegisterTransformation")?
            .Invoke(null, new object?[] { payload });
    }
}
```

### 2.3 Payload shape (verbatim)

Source: https://raw.githubusercontent.com/IAmParadox27/jellyfin-plugin-file-transformation/main/src/Jellyfin.Plugin.FileTransformation/Models/TransformationRegistrationPayload.cs

```csharp
public class TransformationRegistrationPayload
{
    [JsonPropertyName("id")]                     public Guid Id { get; set; }
    [JsonPropertyName("fileNamePattern")]        public string FileNamePattern { get; set; } = string.Empty;
    [JsonPropertyName("transformationEndpoint")] public string TransformationEndpoint { get; set; } = string.Empty;
    [JsonPropertyName("transformationPipe")]     public string? TransformationPipe { get; set; } = null;
    [JsonPropertyName("callbackAssembly")]       public string? CallbackAssembly { get; set; } = null;
    [JsonPropertyName("callbackClass")]          public string? CallbackClass { get; set; } = null;
    [JsonPropertyName("callbackMethod")]         public string? CallbackMethod { get; set; } = null;
}
```

We use the **callback** form (assembly + class + method) — File Transformation
invokes our static method with `JObject { "contents": "<file>" }` and we
return the modified contents.

### 2.4 Where to register

In `PluginServiceRegistrator.RegisterServices` — wire a `BackgroundService`
or `IScheduledTask` that performs the registration on first run. (Doing it
in the registrator directly is too early; the File Transformation plugin
might not be loaded yet.) See Plugin Pages' `StartupService.cs` for the
pattern: https://raw.githubusercontent.com/IAmParadox27/jellyfin-plugin-pages/main/src/Jellyfin.Plugin.PluginPages/Services/StartupService.cs

### 2.5 Manifest entry

Add File Transformation as a `dependency` in `manifest.json`:

```json
{
  "dependencies": [
    {
      "name": "File Transformation",
      "guid": "<File Transformation plugin GUID>"
    }
  ]
}
```

(Confirm the GUID from the File Transformation manifest before shipping.)

---

## 3. Plugin Pages plugin (OPTIONAL — fallback path)

### 3.1 What it does

Adds proper SPA pages (with Jellyfin theming) accessible via the
hamburger-menu "Plugin Settings" section. Backed by File Transformation.

### 3.2 Programmatic registration — NOT YET AVAILABLE

The README says explicitly: *"Currently the only way you can add your own
pages is with the following steps. Edit
`Jellyfin.Plugin.PluginPages/config.json` found in the
`plugins/configurations` folder of the installed Jellyfin instance… There are
plans to add a HTTP request to register pages too but this hasn't been done
just yet."*

The `IPluginPagesManager` DI service exists in source, but the plugin only
populates it at startup from the JSON file. Cross-plugin DI access is broken
by Jellyfin's load-context isolation (same problem File Transformation calls
out). So we **don't** depend on Plugin Pages for tabs — we do it ourselves
via File Transformation.

### 3.3 If we ever want to use it

For reference (NOT used in the initial design):

```csharp
// Source: https://raw.githubusercontent.com/IAmParadox27/jellyfin-plugin-pages/main/src/Jellyfin.Plugin.PluginPages/Library/IPluginPagesManager.cs
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

### 3.4 Custom Tabs plugin — NOT used as a dependency

It has **no** programmatic registration API. Its full surface is a
`PluginConfiguration.Tabs[]` array of `{Title, ContentHtml}` set by the
admin via the plugin's own config page. We would gain nothing by depending
on it; we replicate the same File-Transformation-injects-title-bar pattern
ourselves with proper SPA navigation instead of iframe HTML pasting.

Source: https://raw.githubusercontent.com/IAmParadox27/jellyfin-plugin-custom-tabs/main/src/Jellyfin.Plugin.CustomTabs/Configuration/PluginConfiguration.cs

---

## 4. Jellyfin web custom elements (`<emby-*>`)

Use these in `configPage.html` and any embedded UI for native look-and-feel.
They extend native HTML elements via `is="emby-..."`.

Source: https://github.com/jellyfin/jellyfin-web/tree/master/src/elements

| Element | Native base | Usage |
|---|---|---|
| `emby-button` | `button` | `<button is="emby-button" class="raised button-submit">Save</button>` |
| `emby-linkbutton` | `a` | `<a is="emby-linkbutton" href="...">Click</a>` |
| `emby-checkbox` | `input` | `<input is="emby-checkbox" type="checkbox">` |
| `emby-input` | `input` | `<input is="emby-input" type="text">` |
| `emby-textarea` | `textarea` | `<textarea is="emby-textarea">…</textarea>` |
| `emby-select` | `select` | `<select is="emby-select">…</select>` |
| `emby-radio` | `input` | `<input is="emby-radio" type="radio">` |
| `emby-toggle` | `input` | `<input is="emby-toggle" type="checkbox">` |
| `emby-slider` | `input` | `<input is="emby-slider" type="range">` |
| `emby-collapse` | (custom) | collapsible section |
| `emby-tabs` | (custom) | tab strip |
| `emby-scroller` | (custom) | horizontal scroller |
| `emby-scrollbuttons` | (custom) | left/right scroll arrows |
| `emby-progressbar` | (custom) | linear progress |
| `emby-progressring` | (custom) | radial progress |
| `emby-itemscontainer` | (custom) | grid of item cards |
| `emby-itemrefreshindicator` | (custom) | spinner overlay on items |
| `emby-playstatebutton` | (custom) | watched/unwatched toggle |
| `emby-ratingbutton` | (custom) | favourite heart |
| `emby-programcell` | (custom) | EPG cell |

**Activate them on the page** by listing them in `data-require` on the
page root, e.g.
`<div data-role="page" data-require="emby-input,emby-button,emby-select,emby-checkbox">`.

`paper-icon-button-light` is **not** a custom element — it's a CSS class
applied to a regular `<button>`. Source: `_theme.scss` selectors.

### 4.1 Styling classes (verified used in jellyfin-web)

For buttons:

- `raised` — primary raised style
- `button-submit` — the prominent CTA colour
- `block` — full-width
- `paper-icon-button-light` — minimal icon-only button style

For input rows (the canonical config page form):

- `<div class="inputContainer">…</div>` wraps an input
- `<label class="inputLabel inputLabelUnfocused">` for the label
- `<div class="fieldDescription">` for the helper text
- `<div class="checkboxContainer">…</div>` wraps a checkbox

For sections:

- `<div class="verticalSection verticalSection-extrabottompadding">`
- `<h2 class="sectionTitle">`

For the page root:

- `<div data-role="page" class="page type-interior pluginConfigurationPage" data-require="…">`

Sources: SendToKindle's working configPage.html and the Jellyfin plugin
template at https://raw.githubusercontent.com/jellyfin/jellyfin-plugin-template/master/Jellyfin.Plugin.Template/Configuration/configPage.html.

### 4.2 Global JS objects available

Available on every dashboard page once the script loads:

- `Dashboard.showLoadingMsg()` / `Dashboard.hideLoadingMsg()`
- `Dashboard.alert(message)` — modal alert dialog
- `Dashboard.processPluginConfigurationUpdateResult(result)` — handles the
  "Settings saved" toast after `updatePluginConfiguration`
- `ApiClient.getPluginConfiguration(pluginId)` → Promise<config>
- `ApiClient.updatePluginConfiguration(pluginId, config)` → Promise<result>
- `ApiClient.getUrl(path)` — resolve a server-relative URL
- `ApiClient.ajax({type, url, data, contentType})` — generic call

Source: SendToKindle's working configPage.html.

---

## 5. Jellyfin theme variables (`--jf-palette-*`)

For consistent look across themes, plugin pages should use Jellyfin's CSS
custom properties rather than hard-coded colours.

Source: https://raw.githubusercontent.com/jellyfin/jellyfin-web/master/src/themes/_base/_palette.scss + `_theme.scss`

| Variable | Dark theme value | Use |
|---|---|---|
| `--jf-palette-background-default` | `#101010` | page background |
| `--jf-palette-background-paper` | `#202020` | card / panel background |
| `--jf-palette-primary-main` | `#00a4dc` | primary accent |
| `--jf-palette-primary-dark` | `#00729a` | hover/active primary |
| `--jf-palette-primary-light` | `#33b6e3` | light primary |
| `--jf-palette-primary-contrastText` | `rgba(0,0,0,.87)` | text on primary |
| `--jf-palette-error-main` | `#c62828` | error / destructive |
| `--jf-palette-text-primary` | `#fff` | body text |
| `--jf-palette-text-secondary` | `rgba(255,255,255,.7)` | muted text |
| `--jf-palette-action-hover` | `rgba(255,255,255,.08)` | hover overlay |
| `--jf-palette-action-focus` | `rgba(255,255,255,.12)` | focus overlay |
| `--jf-palette-divider` | `rgba(255,255,255,.12)` | divider lines |
| `--jf-palette-AppBar-defaultBg` | (see _theme.scss) | top bar |
| `--jf-palette-FilledInput-bg` | (see _theme.scss) | filled input bg |
| `--jf-palette-SnackbarContent-bg` | (see _theme.scss) | toast bg |

Naming follows MUI's palette structure: `--jf-palette-<group>-<token>`.
Always provide a sensible fallback: `var(--jf-palette-primary-main, #00a4dc)`.

---

## 6. Confirmed build patterns (from SendToKindle)

These are battle-tested in this homelab. Cypherflix Hub's build follows them.

### 6.1 .csproj must have

```xml
<CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
```

…or transitive deps (Meilisearch, MailKit, etc.) are missing from the
published output.

### 6.2 PrivateAssets on Jellyfin packages

```xml
<PackageReference Include="Jellyfin.Controller" Version="10.10.7">
  <PrivateAssets>all</PrivateAssets>
</PackageReference>
<PackageReference Include="Jellyfin.Model" Version="10.10.7">
  <PrivateAssets>all</PrivateAssets>
</PackageReference>
```

…stops the Jellyfin assemblies from being packaged into our zip (the host
already has them; double-loading breaks DI).

### 6.3 Embedded resources

```xml
<ItemGroup>
  <EmbeddedResource Include="Web\**\*" />
  <EmbeddedResource Include="Configuration\*.html" />
</ItemGroup>
```

The `EmbeddedResourcePath` in `PluginPageInfo` is the dotted form:
`Jellyfin.Plugin.CypherflixHub.Configuration.configPage.html`.

### 6.4 GitHub Actions release workflow

Copy SendToKindle's `.github/workflows/build.yml` as the template. The
critical step is the post-publish DLL list — `dotnet publish` doesn't
always include every transitive dep at the top of the output dir, so the
workflow lists the third-party DLLs it needs explicitly when zipping.

---

## 7. SPA tab + page injection plan

This is the architecture we'll implement (combining everything above).

### 7.1 What we inject

One File Transformation patch on `index.html` that inserts a single
`<script src="/CypherflixHub/Web/bootstrap.js" defer></script>` before
`</body>`.

Our `bootstrap.js` (served by `Api/WebController.cs`) does the heavy
lifting in the browser:

1. Wait for Jellyfin's web app to mount (`MutationObserver` on
   `document.querySelector('.headerTabs')` or similar).
2. Insert three tab buttons into the title bar — styled with the same
   classes Jellyfin uses for native tabs.
3. Register click handlers that update the URL hash to
   `#/cypherflix/discover` etc., and call our route handler to render
   into the main view container.
4. Each route handler `fetch`-es a page-specific JS module from
   `/CypherflixHub/Web/pages/<name>.js`, evaluates it, and lets it render.

### 7.2 Why not iframes (à la Custom Tabs)

Iframes break Jellyfin's SPA navigation, full-page styling, and the API
client (the iframe doesn't share `ApiClient` / auth headers). The native
tab + script approach is more work but renders identically to first-party
pages.

### 7.3 Why not the Plugin Pages plugin

It requires the user to manually edit a JSON file (no programmatic API
yet). For Cypherflix Hub we want zero-config: install plugin → tabs
appear.

---

## 8. Open questions tracked here (so they're answered before related code lands)

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | What is the File Transformation plugin's official GUID? (For manifest dependency declaration.) | first agent on SVC-005 | open — fetch from https://www.iamparadox.dev/jellyfin/plugins/manifest.json |
| 2 | What's the exact CSS selector for the Jellyfin title-bar tabs in 10.10.7? | first agent on UI-001 | open — inspect a live JF instance |
| 3 | Does `MenuSection = "user"` actually work on JF 10.10/10.11, or do we need a different mechanism for per-user pages? | UI-002 agent | open — verify by deploying SendToKindle's `userConfigPage.html` (it already uses `"user"`) |

If you (an agent) answer one of these, **come back and update the table and
the relevant section**, then commit.
