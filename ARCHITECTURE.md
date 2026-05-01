# Cypherflix Hub — Architecture

This document is the **single source of truth** for the design of
`jellyfin-plugin-cypherflix-hub`. Every task spec in `tasks/` references
sections here. If a task spec contradicts this document, the document wins.

If you are an agent picking up a task, the reading order is:

1. `JELLYFIN-INTEGRATION.md` — every Jellyfin / third-party class name,
   namespace, and API surface this plugin depends on, with sources. **Do not
   invent class names that aren't in that doc — add them there with citations
   first if you need new ones.**
2. This file (`ARCHITECTURE.md`) — the overall design.
3. Your task spec under `tasks/`.
4. The existing code under `Jellyfin.Plugin.CypherflixHub/`.

---

## 1. What this plugin does

It replaces the Requests and Calendar tabs that JF Enhanced provides, but
generalised over multiple **providers** instead of being hardwired to
Jellyseerr. It also adds a **Discover** tab with unified search backed by
Meilisearch.

Concretely the plugin ships:

| Tab | Source | Notes |
|---|---|---|
| **Discover** | Meilisearch index of all providers + Jellyfin library | Live search, type filters, "Request" / "Play" buttons |
| **Requests** | All providers' `GetRequestStatusesAsync` aggregated | Replaces JF Enhanced Requests |
| **Calendar** | All providers' `GetCalendarAsync` aggregated | Replaces JF Enhanced Calendar |
| **Plugin settings page** (admin) | Native Jellyfin plugin config | Add/edit provider instances + Meilisearch URL |

The design goal: **adding a new provider type is one new C# class + one DI
registration line.** No changes to controllers, no changes to UI, no DB
migrations. The admin enables an instance, configures it, and it appears
everywhere automatically.

---

## 2. Repo layout

```
jellyfin-plugin-cypherflix-hub/
├── ARCHITECTURE.md                      ← this file
├── PROMPTS.md                           ← agent invocation templates
├── README.md
├── manifest.json                        ← Jellyfin plugin catalogue manifest
├── tasks/                               ← per-task specs (one md per agent run)
│   ├── CORE-*.md                        (foundations — done)
│   ├── PROV-*.md                        (provider implementations)
│   ├── SVC-*.md                         (services: Meilisearch, indexer, aggregators)
│   ├── API-*.md                         (controllers exposed to the web UI)
│   └── UI-*.md                          (web UI tabs + admin page)
├── .github/workflows/build.yml          ← CI: builds .dll + zip + bumps manifest
└── Jellyfin.Plugin.CypherflixHub/
    ├── Jellyfin.Plugin.CypherflixHub.csproj
    ├── Plugin.cs                        ← BasePlugin entry
    ├── PluginServiceRegistrator.cs      ← DI wiring
    ├── Configuration/
    │   ├── PluginConfiguration.cs
    │   └── configPage.html              ← native admin settings page
    ├── Core/                            ← provider abstraction + shared models
    │   ├── IMediaProvider.cs            ← THE central contract
    │   ├── ProviderRegistry.cs
    │   ├── ProviderConfig.cs
    │   ├── ConfigField.cs
    │   ├── MediaType.cs
    │   ├── Capability.cs
    │   └── Models.cs
    ├── Providers/                       ← one folder per provider implementation
    │   ├── Jellyfin/                    (PROV-001)
    │   ├── Jellyseerr/                  (PROV-002)
    │   ├── Readarr/                     (PROV-003)
    │   ├── ReadMeABook/                 (PROV-004)
    │   └── ...
    ├── Services/
    │   ├── MeilisearchClient.cs         (SVC-001)
    │   ├── IndexerService.cs            (SVC-002)
    │   ├── FileTransformationRegistrar.cs (SVC-005 — replaces ScriptInjector;
    │   │                                   uses File Transformation plugin)
    │   ├── IndexHtmlTransform.cs        (SVC-005 — static callback target)
    │   └── Aggregators/
    │       ├── SearchAggregator.cs      (SVC-003)
    │       ├── RequestAggregator.cs     (SVC-004)
    │       └── CalendarAggregator.cs    (SVC-004)
    ├── Api/                             ← ASP.NET controllers (web API the UI calls)
    │   ├── ProvidersController.cs       (API-001)
    │   ├── SearchController.cs          (API-002)
    │   ├── RequestsController.cs        (API-003)
    │   ├── CalendarController.cs        (API-004)
    │   └── WebController.cs             (API-005 — serves bootstrap.js + page modules)
    └── Web/                             ← embedded JS/CSS/HTML for the UI
        ├── inject.js                    ← bootstraps everything (UI-001)
        ├── styles.css
        ├── pages/
        │   ├── discover.js              (UI-003)
        │   ├── requests.js              (UI-004)
        │   └── calendar.js              (UI-005)
        └── admin/
            └── configPage.js            (UI-002)
```

---

## 3. Provider abstraction (the core)

**File:** `Core/IMediaProvider.cs`

Every external service the user might want to search/request/calendar against
implements `IMediaProvider`. There is **one C# class per provider TYPE**
(`JellyseerrProvider`, `ReadarrProvider`, …). The admin can configure
**multiple INSTANCES of a type** — e.g. two Readarrs (books + comics), each
with its own URL and API key.

The interface has three groups of members:

### 3.1 Type metadata (static)

These describe the provider type itself and never change at runtime. The admin
UI reads them when listing available types and rendering the per-instance
config form.

```csharp
string TypeId { get; }                              // "jellyseerr"
string DisplayName { get; }                         // "Jellyseerr"
string Description { get; }                         // shown when picking a type
string? IconUrl { get; }
IReadOnlyList<MediaType> SupportedMediaTypes { get; }       // [Movie, TvShow]
IReadOnlyList<Capability> SupportedCapabilities { get; }    // [Search, Request, ...]
IReadOnlyList<ConfigField> ConfigSchema { get; }            // form fields
```

### 3.2 Per-instance operations

Each method takes a `ProviderConfig` (the hydrated config for one specific
instance) so the provider class itself stays stateless.

```csharp
Task<TestResult>                       TestConnectionAsync(cfg, ct);
Task<IReadOnlyList<SearchResult>>      SearchAsync(query, cfg, ct);
Task<RequestSubmissionResult>          RequestAsync(payload, cfg, ct);
Task<IReadOnlyList<RequestStatus>>     GetRequestStatusesAsync(userId, cfg, ct);
Task<IndexBatch>                       IndexAsync(since, cfg, ct);
Task<IReadOnlyList<CalendarEntry>>     GetCalendarAsync(query, cfg, ct);
```

### 3.3 Capability gating

Providers declare which capabilities they support via
`SupportedCapabilities`, and the admin can disable any of them per instance
(stored in `ProviderInstance.EnabledCapabilities`).

The framework **never calls a method whose capability is disabled**. Aggregators
filter providers by capability before dispatching. This means:

- A Spotify provider can declare only `Search` and `Discover` and never have
  `RequestAsync` called.
- A Readarr instance configured for "books only, no calendar" simply doesn't
  show up in the calendar feed.
- Implementations should still return safe empties (`Array.Empty<…>()`) for
  unsupported capabilities in case the gate is bypassed.

### 3.4 Provider implementation requirements

Every provider must:

1. **Be stateless.** All instance state comes through `ProviderConfig`. No
   private fields holding URLs/keys.
2. **Be resilient.** Network blips → return empty list, log warning, do not
   throw out to the framework.
3. **Be idempotent.** `RequestAsync` for an already-requested item returns
   success with the existing status, not an error.
4. **Translate to/from the unified models** in `Core/Models.cs`. Never leak
   provider-specific types out of the provider folder.
5. **Be registered as a singleton** in `PluginServiceRegistrator.cs`.

See `tasks/PROV-*.md` for per-provider detail.

---

## 4. Configuration storage

### 4.1 Plugin-level config

`Configuration/PluginConfiguration.cs` is the root of everything Jellyfin
serialises to `plugins/CypherflixHub.xml`. It owns:

```
Providers[]              ← every configured instance (mixed types)
MeilisearchUrl
MeilisearchApiKey
IndexIntervalMinutes
```

### 4.2 Per-instance config

Each `ProviderInstance` carries:

```
Id                        Guid (stable across renames)
TypeId                    "jellyseerr"
Name                      "Movies (Jellyseerr)"
Enabled                   bool
EnabledCapabilities[]     subset of the type's SupportedCapabilities
Config[]                  ConfigEntry[] {Key, Value} — keyed by ConfigField.Key
```

`ConfigEntry[]` is used instead of `Dictionary<string,string>` because the XML
serialiser produces ugly `<Items><Item><Key>…` for dicts. The plain array
serialises cleanly.

### 4.3 Hydrated config (`ProviderConfig`)

When the framework calls a provider method, it builds a `ProviderConfig` with:

- `InstanceId`, `InstanceName`
- `EnabledCapabilities` as a `HashSet<Capability>`
- `Fields` as `Dictionary<string,string>`

Providers use `cfg.Get("api_key")` / `cfg.GetOrDefault("url", "https://…")`.

---

## 5. Meilisearch indexing

### 5.1 Per-provider indexes

Each provider instance gets its own Meilisearch index, named:

```
cypherflix_<providerTypeId>_<instanceId-short>
```

e.g. `cypherflix_readarr_a1b2c3d4`. This keeps batch deletes simple
(`Replace = true` clears the index for that instance) and means one provider
choking doesn't poison the others.

The unified search aggregator queries all of them in parallel and merges
results, so the UI never has to know there are multiple indexes.

### 5.2 Document schema

Documents are uniform across providers — see `IndexDocument` in
`Core/Models.cs`. Fields include `Id`, `MediaType`, `Title`, `Subtitle`,
`Description`, `PosterUrl`, `Year`, `Tags`, `Extras` (provider-specific KV).

Meilisearch settings (per index, set at creation time):

```json
{
  "searchableAttributes": ["title", "subtitle", "description", "tags"],
  "filterableAttributes": ["mediaType", "year", "tags"],
  "sortableAttributes": ["year"],
  "displayedAttributes": ["*"]
}
```

### 5.3 Indexer service

`Services/IndexerService.cs` is a `BackgroundService` that wakes every
`IndexIntervalMinutes`, iterates configured + enabled instances with the
`Index` capability, calls `IndexAsync(since: lastRun, cfg, ct)`, applies the
returned `IndexBatch` to the per-instance index, and stores the new "since"
timestamp.

It also runs once on startup. See `tasks/SVC-002.md`.

### 5.4 Jellyfin library indexing

The user's existing Jellyfin library is itself a provider — see
`Providers/Jellyfin/JellyfinProvider.cs` (PROV-001). This is what powers the
"Play" button in Discover when a search hit is already in the library.

---

## 6. Aggregators

Three aggregators sit between the controllers and the providers. They are
singletons.

### 6.1 SearchAggregator (`SVC-003`)

Queries Meilisearch (which already contains every provider's index) and
post-processes:

1. Decorate hits with `InLibrary=true` + `JellyfinItemId` if the matching
   Jellyfin index has them.
2. Decorate hits with `RequestPending=true` if the user has an open request
   in any request-capable provider for the same `ExternalId`.
3. Apply media-type filter, paginate.

Live keyword search bypasses Meilisearch and fans out to providers' `SearchAsync`
in parallel, then merges. (Meilisearch has the bulk catalogue; live `SearchAsync`
exists for "request something not yet indexed" — e.g. a brand new movie.)

### 6.2 RequestAggregator (`SVC-004`)

`GetForUserAsync(userId, ct)` → fans out across all providers with
`RequestStatus` capability, returns merged list grouped by media type.

`SubmitAsync(providerInstanceId, payload, ct)` → resolves to one provider,
calls `RequestAsync`.

### 6.3 CalendarAggregator (`SVC-004`)

`GetAsync(start, end, userId, ct)` → fans out, merges, sorts by
`ReleaseDate`. Returns a flat list; the UI groups by date.

All aggregators **fail gracefully**: a provider erroring out is logged and its
contribution dropped; the rest still return.

---

## 7. Web API (controllers)

All under `/CypherflixHub/...`, all return JSON, all require an
authenticated Jellyfin user (use `[Authorize]` + claim parsing — DO NOT use
`[Authorize(Policy="DefaultAuthorization")]`, see "Lessons learned" below).

| Route | Method | Purpose | Task |
|---|---|---|---|
| `/CypherflixHub/Providers` | GET | All available types + configured instances. Admin only. | API-001 |
| `/CypherflixHub/Providers/Types` | GET | Available provider types (metadata only). Admin only. | API-001 |
| `/CypherflixHub/Providers/Test` | POST | Test a config against a type before saving. Admin only. | API-001 |
| `/CypherflixHub/Search?q=…&types=…` | GET | Unified search. Authed user. | API-002 |
| `/CypherflixHub/Requests` | GET | Current user's requests across providers. | API-003 |
| `/CypherflixHub/Requests` | POST | Submit a request. Body: RequestPayload. | API-003 |
| `/CypherflixHub/Calendar?start=…&end=…&types=…` | GET | Calendar entries in window. | API-004 |

Admin-only endpoints check the `Jellyfin-IsAdministrator` claim manually
inside the action — see SendToKindle plugin v1.1.x for the proven pattern.

---

## 8. Web UI

### 8.1 Injection strategy

We use the **File Transformation plugin** (mandatory dependency) — the same
mechanism Custom Tabs, Plugin Pages, and Home Sections use. We do **not**
patch `index.html` on disk ourselves (that's brittle on JF updates) and we
do **not** depend on Custom Tabs (no programmatic API) or Plugin Pages (no
programmatic API yet).

See `JELLYFIN-INTEGRATION.md` §2 for the verbatim reflection registration
recipe and §7 for the full SPA injection plan.

The flow:

1. `Services/FileTransformationRegistrar.cs` (`SVC-005`) is an
   `IHostedService`. On `StartAsync` it uses the reflection recipe from
   `JELLYFIN-INTEGRATION.md` §2.2 to register one transformation:
   - `FileNamePattern`: regex matching `index.html`
   - `CallbackAssembly` / `CallbackClass` / `CallbackMethod`: our static
     transformation method
2. The static method receives `JObject { contents: "<index.html>" }` and
   returns the same JSON with `<script src="/CypherflixHub/Web/bootstrap.js" defer></script>`
   inserted before `</body>` (idempotent — guard with a marker comment).
3. `bootstrap.js` (served by `Api/WebController.cs` from an embedded
   resource) waits for the Jellyfin SPA to mount, then:
   - Inserts three tab buttons into the native title-bar tab strip with the
     same classes Jellyfin uses (verify selector in `JELLYFIN-INTEGRATION.md`
     §8 open question #2 before coding).
   - Registers hash-route handlers for `#/cypherflix/discover`,
     `…/requests`, `…/calendar`.
   - On route match, fetches the page-specific module from
     `/CypherflixHub/Web/pages/<name>.js`, evaluates it, and renders into
     the main view container (Jellyfin uses `.skinBody` / `.mainAnimatedPages`
     — confirm during implementation).

Pages call the controllers in §7 via the existing `ApiClient` global so they
inherit auth headers automatically.

### 8.2 Pages

- **Discover** (`UI-003`): search bar (debounced), type-filter chips, infinite
  grid of result cards. Card actions: Play (if `InLibrary`), View Status (if
  `RequestPending`), Request (otherwise).
- **Requests** (`UI-004`): grouped by provider type. Each row shows status
  pill, progress bar (if `InProgress`), poster, title.
- **Calendar** (`UI-005`): month grid. Day cells list scheduled releases.
  "Today" highlighted. Click a row → opens Jellyfin item if available, else
  external provider URL.

### 8.3 Admin page (`UI-002`)

Native Jellyfin plugin settings page (already wired up via `Plugin.cs:GetPages`,
`MenuSection = "server"`). Uses **only** the web components, CSS classes, and
JS globals listed in `JELLYFIN-INTEGRATION.md` §4 — no invented names.

Page root must be:
```html
<div data-role="page"
     class="page type-interior pluginConfigurationPage"
     data-require="emby-input,emby-button,emby-select,emby-checkbox,emby-textarea">
```

Form rows follow the canonical pattern (verbatim from
`JELLYFIN-INTEGRATION.md` §4.1):

```html
<div class="inputContainer">
    <label class="inputLabel inputLabelUnfocused" for="X">Label</label>
    <input is="emby-input" type="text" id="X" />
    <div class="fieldDescription">Helper text</div>
</div>
```

Use `var(--jf-palette-*, fallback)` for any custom colours so the page
matches the active theme.

Sections:

1. **Meilisearch** — URL, API key, index interval. Test button.
2. **Providers** — list of configured instances with edit/delete. Add button
   opens a modal: pick type from dropdown → render fields from
   `ConfigSchema` → Test button → Save.

Use `Dashboard.showLoadingMsg()` / `hideLoadingMsg()` and
`Dashboard.processPluginConfigurationUpdateResult(...)` for feedback,
`Dashboard.alert(...)` for errors. `ApiClient.getPluginConfiguration(GUID)`
and `ApiClient.updatePluginConfiguration(GUID, cfg)` for the round trip.

---

## 9. Plugin lifecycle

1. `Plugin.cs` is constructed by Jellyfin at startup. `Instance` static is
   set so other classes can read config without DI gymnastics.
2. `PluginServiceRegistrator.RegisterServices` runs during DI build:
   - `ProviderRegistry` (singleton)
   - Every `IMediaProvider` implementation (singleton)
   - `MeilisearchClient` (singleton)
   - `IndexerService` (hosted)
   - `SearchAggregator`, `RequestAggregator`, `CalendarAggregator` (singletons)
   - `ScriptInjector` (hosted)
3. `IndexerService.StartAsync` runs an immediate index pass, then loops on
   the configured interval.
4. Jellyfin auto-discovers controllers under `Api/`.

---

## 10. Lessons learned (from the SendToKindle plugin)

These bit us on the previous plugin and **must not** be repeated here.

1. **Do NOT use `[Authorize(Policy = "DefaultAuthorization")]`.** The policy
   isn't registered on Jellyfin 10.10/10.11 and every request 500s. Use bare
   `[Authorize]` plus manual claim parsing (`User.FindFirst("Jellyfin-UserId")`,
   `User.FindFirst("Jellyfin-IsAdministrator")`).
2. **Set `<CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>`** in
   the csproj or transitive deps (Meilisearch, MailKit, etc.) won't be
   shipped in the published bundle.
3. **List third-party DLLs explicitly in `.github/workflows/build.yml`** when
   producing the release zip — `dotnet publish` doesn't always include
   everything we need at the top level. See SendToKindle v1.1.3 workflow for
   the proven recipe.
4. **`IPluginServiceRegistrator` lives in `MediaBrowser.Controller.Plugins`,
   not `Jellyfin.Api.Helpers`.** The latter isn't on NuGet.
5. **Embedded resources need exact namespace paths.** When referenced from
   `Plugin.cs:GetPages`, the path is
   `<RootNamespace>.<Folder>.<File>` with dots, e.g.
   `Jellyfin.Plugin.CypherflixHub.Configuration.configPage.html`.
6. **All script/CSS injection must run after Jellyfin's web app boots.** Use
   `MutationObserver` on `document.body` or wait on
   `window.ApiClient`.

---

## 11. Coding standards

- C# 12, .NET 8, nullable enabled, file-scoped namespaces.
- One public type per file (model classes can share if tightly coupled — see
  `Models.cs`).
- XML doc comments on every public member that another agent or future-you
  would benefit from. Be terse but specific.
- No `var` for primitive types where the type isn't obvious from the RHS.
- Constructors take dependencies; no service locators except `Plugin.Instance`
  for config.
- Tests are not required for the first cut, but every aggregator method must
  have at least a happy-path manual smoke (curl recipe in the task spec).

---

## 12. Adding a provider — step by step

1. Create `Providers/<Name>/` with these files:
   - `<Name>Provider.cs` implementing `IMediaProvider`
   - `<Name>Client.cs` for raw HTTP calls (keep `Provider.cs` thin)
   - `<Name>Models.cs` for any DTO structs the client needs
2. Register it in `PluginServiceRegistrator.cs`:
   ```csharp
   serviceCollection.AddSingleton<Core.IMediaProvider, Providers.<Name>.<Name>Provider>();
   ```
3. Bump version in `.csproj` and `manifest.json`.
4. Push — CI builds the zip and updates `manifest.json` checksum.

That's it. The admin UI picks up the new type automatically the next time
they open the settings page. No controller changes, no UI changes, no DB
migrations.

---

## 13. Versioning & release

- Semantic versioning. Pre-1.0 means "any release can break things".
- Manifest URL the user adds in Jellyfin:
  `https://raw.githubusercontent.com/bobbibg/jellyfin-plugin-cypherflix-hub/main/manifest.json`
- CI workflow (`build.yml`) is responsible for:
  - Building the .dll
  - Bundling it + transitive deps into a zip
  - Computing the zip's MD5
  - Updating `manifest.json` with the new version, MD5, sourceUrl
  - Committing the manifest update back to `main`
  - Creating a GitHub release with the zip attached

The SendToKindle plugin's workflow is the proven template — copy it, change
names, done.
