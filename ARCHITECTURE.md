# Cypherflix Hub — Architecture

> **Single source of truth for the plugin's design**. If a task spec or
> code comment contradicts this document, the document wins. Update this
> first, then the code.
>
> Every external surface referenced here (Jellyfin's `ApiClient`, the
> Plugin Pages plugin, native class chains, the grabber API) is verified
> against primary source. Citations live in `.recon/`. Don't add a new
> claim here without one.

## North Star

**One plugin, one backend, all media kinds.** Cypherflix Hub (Jellyfin
plugin) is the single UI front for `cypherflix-grabber` (Python/FastAPI
service), which owns metadata, follow / queue / search / grab pipelines for
books, comics, audiobooks, music, movies, TV, and anime. C# integration via
`IRemoteMetadataProvider` makes Jellyfin library scans pull through us.
Sonarr / Radarr / Lidarr / Mylar3 are migrated off once each kind reaches
parity.

## Versions we target (verified)

- **Jellyfin server:** 10.11.8 (`/System/Info/Public` on the NAS, May 2026).
- **`jellyfin-apiclient`:** 1.11.0 (bundled into jellyfin-web 10.11.8).
- **Plugin Pages plugin:** 2.4.9.0, GUID `5b6550fa-a014-4f4c-8a2c-59a43680ac6d`,
  hard-depends on File Transformation `5e87cc92-571a-4d8d-8d98-d2d4147f9f90`.
- **`cypherflix-grabber`:** 2.0.0 (FastAPI, OpenAPI at `/openapi.json`,
  external on `http://192.168.1.165:7960`).

## Repository layout

```
jellyfin-plugin-cypherflix-hub/
├── Jellyfin.Plugin.CypherflixHub/      ← C# plugin project (compiles to DLL)
│   ├── Api/                            ← server-side controllers
│   │   ├── WebController.cs            ← serves dist/* + the page HTML fragments
│   │   └── ProxyController.cs          ← /Cypherflix/api/* → grabber /api/v1/*
│   ├── Configuration/                  ← admin config UI
│   ├── Services/                       ← C# services (grabber client)
│   └── Plugin.cs                       ← ALSO writes Plugin Pages config.json
│
├── Web/                                ← TypeScript source for the frontend
│   ├── bootstrap.ts                    ← single entry, dispatches by hash
│   ├── components/                     ← shared UI primitives, native-class markup
│   │   ├── card.ts                     ← single source of truth for card markup
│   │   ├── carousel.ts                 ← verticalSection + emby-scroller pattern
│   │   ├── detailPage.ts               ← native .itemDetailPage chrome
│   │   ├── toast.ts                    ← singleton on document.body
│   │   ├── indicators.ts
│   │   ├── queueFab.ts
│   │   └── candidatesModal.ts
│   ├── pages/                          ← one per Plugin Page
│   │   ├── discover.ts
│   │   ├── queue.ts
│   │   ├── following.ts
│   │   └── detail.ts
│   ├── state/
│   │   ├── api.ts                      ← typed fetch wrappers (grabber)
│   │   ├── followState.ts              ← in-memory state + CustomEvent bus
│   │   └── jellyfin.ts                 ← ApiClient helpers (sessionReady, auth)
│   ├── inject.ts                       ← native-page DOM injection (slim)
│   ├── styles/main.css
│   └── types/
│       ├── api.ts                      ← cypherflix-grabber API shapes (verified)
│       └── jellyfin.d.ts               ← ambient types for window.ApiClient (verified)
│
├── dist/                               ← (gitignored) Vite build output
│   ├── cypherflix-hub.[hash].js        ← embedded as DLL resource
│   ├── cypherflix-hub.[hash].css
│   └── manifest.json                   ← C# resolves hashed names from this
│
├── package.json                        ← npm deps (vite, typescript, eslint)
├── tsconfig.json                       ← strict TypeScript config
├── vite.config.ts                      ← single hashed bundle config
├── ARCHITECTURE.md                     ← this file
├── ROADMAP.md                          ← long-term phase plan
├── manifest.json                       ← Jellyfin plugin catalog entry
└── .recon/                             ← verified surface citations (committed)
    ├── apiclient-verification.md
    ├── plugin-pages-verification.md
    ├── native-classes-verification.md
    ├── grabber-openapi-diff.md
    └── grabber-openapi.json
```

## Build pipeline

```
┌─────────────┐    ┌────────────┐    ┌──────────────┐    ┌────────────────┐
│ Web/**/*.ts │──▶ │ npm build  │──▶ │ dist/*.js+css│──▶ │ MSBuild embeds │
└─────────────┘    │ (Vite)     │    │ + manifest   │    │ as resource    │
                   └────────────┘    └──────────────┘    └────────────────┘
```

1. `npm run build` — Vite bundles all `Web/**/*.ts` into a **single hashed
   JS file + single hashed CSS file** under `dist/`. Manifest written to
   `dist/manifest.json` mapping the entry to its hashed filename.
2. MSBuild's `BeforeBuild` target runs the npm build automatically.
3. The csproj's `<EmbeddedResource Include="dist/**" />` ships the bundle
   inside the DLL.
4. C# `WebController` reads `dist/manifest.json` at startup and exposes the
   bundle at `/CypherflixHub/Web/{hashedName}`. Every build invalidates the
   hash, which invalidates browser caches automatically.

The single-bundle choice is deliberate. Jellyfin's WebController exposes
resources by static name; multi-chunk builds would need a routing layer
that's not worth our scale.

## Entry point — Plugin Pages (verified surface)

We use [IAmParadox27's Plugin Pages 2.4.9.0](https://github.com/IAmParadox27/jellyfin-plugin-pages)
(already installed on the NAS) to register sidebar entries. Full
verification is in `.recon/plugin-pages-verification.md`; the summary
below is what code must do.

### The real `PluginPage` shape

`Jellyfin.Plugin.PluginPages.Library.PluginPage` has **four** properties:

| Property | Type | Purpose |
|---|---|---|
| `Id` | `string?` | Dedup key. We use namespaced ids: `Jellyfin.Plugin.CypherflixHub.Discover`, `…Queue`, `…Following`. |
| `Url` | `string?` | URL that returns an HTML **fragment** to be appended into Jellyfin's `.userPluginSettingsContainer`. Plugin Pages 2.4.1.0+ auto-prefixes the Jellyfin base URL when `Url` starts with `/`. |
| `DisplayText` | `string?` | Sidebar label. |
| `Icon` | `string?` | Material Icons class name (e.g. `"explore"`). |

There is **no** `Route`, `DisplayName`, `ScriptUrls`, or `StylesheetUrls`.
Earlier drafts of this doc claimed those fields existed — they do not.

### Why we cannot DI-inject `IPluginPagesManager`

Plugin Pages registers `IPluginPagesManager` as a singleton in Jellyfin's
DI container. **But** Jellyfin loads each third-party plugin into its own
`AssemblyLoadContext`, so a consumer plugin asking for `IPluginPagesManager`
gets either nothing (if the type identity doesn't match across ALCs) or a
silent no-op. The only supported registration mechanism is the JSON
drop-in below.

### How `Plugin.cs` actually registers our pages

Mirror IAmParadox27's own consumer plugin (Home Screen Sections). On
construction, `Plugin.cs`:

1. Computes the path
   `<applicationPaths.PluginConfigurationsPath>/Jellyfin.Plugin.PluginPages/config.json`.
2. Reads (or creates) the JSON; ensures a top-level `pages` array.
3. For each of our pages, looks up an entry by `Id` and:
   - If absent or its `"Version"` < our current `CYPHERFLIX_PAGE_CONFIG_VERSION`,
     remove + re-add the entry.
   - Else leave it alone.
4. Writes the file back.

Plugin Pages reads this file once, on its own startup, and registers each
entry via its own DI'd manager. That means **the user must restart Jellyfin
once after a plugin upgrade that bumps `CYPHERFLIX_PAGE_CONFIG_VERSION`**,
which is unavoidable and matches HSS's behaviour.

The only NuGet dep this needs is `Newtonsoft.Json`; do **not** add a
`<PackageReference>` for Plugin Pages itself (no NuGet exists, and a direct
assembly reference would cross the ALC boundary).

### How HTML fragments get served

Each `Url` we register points at a route on our own `WebController` that
returns an **HTML fragment** (no `<!DOCTYPE>`, no `<html>`, no `<head>`).
That fragment includes our `<script src="…">` and `<link rel="stylesheet" href="…">`
tags pointing at the hashed bundle in `dist/`. The fragment's root element
hosts whatever the page module renders.

```csharp
// Schematic — final shape lives in WebController.cs
[HttpGet("CypherflixHub/discover")]
public IActionResult Discover() {
    string js  = WebController.GetBundleUrl() + ".js";
    string css = WebController.GetBundleUrl() + ".css";
    string html = $@"
<link rel=""stylesheet"" href=""{css}"" />
<script src=""{js}"" type=""module""></script>
<div id=""cypherflix-hub-root"" data-page=""discover""></div>";
    return Content(html, "text/html; charset=utf-8");
}
```

The TS bootstrap reads `data-page` off `#cypherflix-hub-root` and
dispatches into the matching page module.

## Component contract

Every component in `Web/components/` exports:

```ts
export interface ComponentRenderOpts<T> {
    item: T;
    // …kind-specific options
}

export function render(opts: ComponentRenderOpts<T>): string;
export function mount(host: HTMLElement, opts: ComponentRenderOpts<T>): void;
export function refreshState(host: HTMLElement, fs: FollowState): void;
```

Pages consume only these exports — no inline markup. If `card.ts` is the
sole producer of card markup, every page renders identical cards by
construction. No drift.

## Native class chains (verified)

The components mirror Jellyfin 10.11.8's home page exactly, so themes
apply automatically. Full citations with line numbers are in
`.recon/native-classes-verification.md`. Key facts that earlier drafts
got wrong:

- **`verticalSection` is the outer wrapper.** `emby-scroller-container`
  is added to the `emby-scroller`'s parent **at upgrade time** by the
  custom-element constructor — we do not write that class ourselves.
- **Title containers vary by row type.** LatestMedia / "Latest in X" rows
  use `<div class="sectionTitleContainer sectionTitleContainer-cards padded-left"><h2>…</h2></div>`.
  Resume / NextUp rows use a **bare** `<h2 class="sectionTitle sectionTitle-cards padded-left">`.
- **Cards.** Outer chain is
  `<div class="card overflowPortraitCard card-hoverable card-withuserdata" data-action="link">`.
  Image is set via `data-src` on `.cardImageContainer` and the lazy loader
  paints it as `background-image` — there is no `<img>` tag.
- **Hover overlay.** Native uses `<button is="paper-icon-button-light"
  class="cardOverlayButton cardOverlayButton-hover cardOverlayFab-primary">`
  with the icon set in **codepoint mode** (`<span class="material-icons
  play_arrow" aria-hidden="true"></span>` — empty body, the class carries
  the codepoint). Our queue FAB swaps `play_arrow` for `queue`.
- **Card hover is pure CSS.** No JS class toggling. The `card-hoverable`
  ancestor + Jellyfin's stylesheet do the work.
- **Indicators live in `.cardIndicators`** (sibling of `.cardScalable`),
  not inside any overlay button.
- **Item detail page.** Outer chain is `<div id="itemDetailPage" class="page
  libraryPage itemDetailPage noSecondaryNavPage selfBackdropPage">`. The
  action bar is `<div class="mainDetailButtons focuscontainer-x">` (NOT
  `.detailButtons`). Each button is `<button is="emby-button" class="button-flat
  detailButton">` with **only** `<div class="detailButton-content"><span
  class="material-icons detailButton-icon ${icon}"></span></div>` —
  10.11.8 dropped the `<div class="detailButton-text">` label, label is
  carried as the button's `title` attribute (tooltip).
- **Toast.** Singleton `<div class="toastContainer">` mounted on
  `document.body` (not inside the page). Per-toast `<div class="toast">`
  uses textContent. Lifecycle: `+toastVisible` at 300 ms, `+toastHide` at
  3300 ms, remove at 3600 ms.

## State management

Two flavours:

**Per-session state** (`Web/state/followState.ts`):
- Followed author / series ids
- Queue request status by external id (book id, comic issue id, etc.)
- Loaded once per page load via parallel `/following` + `/requests`
- Mutated via `markFollowed`, `markUnfollowed`, `markQueued`
- Each mutation dispatches a `cypherflix:*` CustomEvent on `document`. Every
  visible component re-renders without re-fetching.

**Per-render derived state** (component-local):
- e.g., a card's "is this followed?" — recomputed from followState whenever
  the card mounts or an event fires.

Deliberately no global store framework. At our scale the CustomEvent bus +
module-scoped state is enough.

## API client + auth

`Web/state/api.ts` wraps every grabber endpoint with typed fetch helpers.
Types come from `Web/types/api.ts` — verified against the live grabber's
OpenAPI document and live response samples. See
`.recon/grabber-openapi-diff.md` for the full diff. Codegen via
`openapi-typescript` is **deferred to v4.1**: the grabber's FastAPI routes
do not yet declare `response_model=…`, so OpenAPI cannot describe response
shapes; once the grabber is annotated, codegen becomes viable.

Auth flow:
1. `window.ApiClient.accessToken()` provides the user's Jellyfin token.
2. Forwarded as `X-Emby-Token` to the plugin's reverse-proxy
   `WebController` route (`/Cypherflix/api/...`).
3. C# verifies the token (`[Authorize]`), then calls grabber's
   `/api/v1/...` with the grabber API token.

Plugin code never embeds the grabber token — it lives only in the C# side.

`Web/types/jellyfin.d.ts` is grounded against unminified
`jellyfin-apiclient` 1.11.0 source recovered from the npm tarball
sourcemap. See `.recon/apiclient-verification.md`. Key signatures:

- `accessToken(): string | null` — synchronous, null when not logged in.
- `getCurrentUser(enableCache?: boolean): Promise<User>`.
- `getItem(userId: string | null | undefined, itemId: string)` — `userId`
  is genuinely nullable.
- `getItems(userId: string | null | undefined, options?)` — second param
  is `options` (matching upstream), not `query`.
- `getUrl(name, params?, serverAddress?)` — 3-arg, third arg is real.
- `serverAddress(val?)` — single overloaded getter/setter.

Don't declare a method on `JellyfinApiClient` without a citation in
`.recon/apiclient-verification.md`.

## Native DOM injection (`inject.ts`)

Independent of Plugin Pages. `MutationObserver` on `document.body` watches
for Jellyfin's native pages — book detail, missing-item cards, etc. — and
injects:

- Follow button on `.mainDetailButtons` (NOT `.detailButtons`) for book /
  audiobook / comic detail pages where we can map the item to a Hardcover
  author or ComicVine volume.
- "More by Author" carousel section on book detail pages.
- Queue button overlay on missing-item cards (top-right corner).

This continues to work alongside Plugin Pages — the two don't overlap:
Plugin Pages handles OUR pages, inject.ts handles JELLYFIN's pages.

## Strict TypeScript

`tsconfig.json` enables every strictness flag we can stand:

- `strict: true` (rolls in `noImplicitAny`, `strictNullChecks`, etc.)
- `noUncheckedIndexedAccess` — `arr[i]` returns `T | undefined`, must be
  narrowed before use
- `exactOptionalPropertyTypes` — `{ x?: T }` ≠ `{ x: T | undefined }`
- `noUnusedLocals`, `noUnusedParameters`
- `noFallthroughCasesInSwitch`
- `useUnknownInCatchVariables`

This catches: forgetting `existed: true` paths, using fields that became
optional, passing string where number was expected, dead code, fall-through
switch bugs. Not a substitute for runtime testing — but kills the easy
class of bugs at compile time.

## What the C# side owns vs the TS side

- **C# (server)**: Plugin registration via the Plugin Pages JSON drop-in,
  reverse-proxy controller, configuration UI, file-transformation hooks,
  metadata-provider implementations (v4.5+), HTML fragment routes that
  load the bundle.
- **TS (client)**: Every UI surface in the browser. Pages, components,
  Jellyfin native-page injections, API client, state bus.

Firewall: nothing in `Web/` mutates server state beyond what the public
REST API permits. The C# side never inlines TS — only serves the
precompiled bundle.

## Long-term roadmap

Each phase fits inside this skeleton without architectural change:

| Version | Phase | Adds |
|---|---|---|
| **v4.0** | Stabilise | TypeScript + Vite + Plugin Pages config drop-in + componentised UI. Same backend. |
| **v4.1** | Movies + codegen | TMDB client + movie matcher in grabber. Movie row on Discover. Grabber `response_model=…` everywhere; switch TS types to openapi-typescript codegen. |
| **v4.2** | TV | TVDB / TMDB-TV clients. Per-episode + per-season requests. |
| **v4.3** | Anime | AniList + nyaa indexers. Fansub-aware matcher. |
| **v4.4** | Music | MusicBrainz + Spotify (optional). Album / artist follows. |
| **v4.5** | Metadata Provider | C# `IRemoteMetadataProvider` for movies / TV / books. Jellyfin scans go through us. |
| **v4.6** | File Organiser | Cypherflix-owned post-grab file-organisation pipeline. Replaces Sonarr/Radarr/Mylar3 organisers. |
| **v5.0** | Servarr Deprecation | Migration tools. Stack-down. Endgame. |

See `ROADMAP.md` for per-phase deliverables, risks, and time estimates.

## v4.0 delivery checklist

- [x] **Recon** — ApiClient surface, Plugin Pages surface, native class chains, grabber OpenAPI all verified
- [x] **Day 1 (in progress)** — Vite + tsconfig + types/api.ts + types/jellyfin.d.ts + state/jellyfin.ts
- [ ] **Day 1 (rest)** — state/api.ts (typed fetch wrapper), state/followState.ts, components/toast.ts, components/card.ts
- [ ] **Day 2** — components/carousel.ts, components/detailPage.ts, components/queueFab.ts, components/indicators.ts, components/candidatesModal.ts, pages/{discover,queue,following,detail}.ts, inject.ts
- [ ] **Day 3** — Plugin.cs Plugin Pages JSON drop-in. WebController fragment routes. MSBuild target. Drop Custom Tabs / JavaScript Injector deps for our pages.
- [ ] **Day 4** — Cleanup. Playwright smoke test. Ship.
