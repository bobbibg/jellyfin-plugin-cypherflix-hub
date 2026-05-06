# Cypherflix Hub

> ⚠️ **This plugin is not for public release.**
>
> Cypherflix Hub is a **personal hobby project**. It only works alongside
> [`cypherflix-grabber`](https://github.com/bobbibg/cypherflix-grabber)
> — which is a **private repository** that I do not distribute. Without
> the grabber backend running on a reachable URL there is nothing for
> this plugin to talk to and it will do absolutely nothing useful.
>
> The code has been heavily vibe-coded across many late-night
> sessions. It targets exactly one Jellyfin install (mine), one home
> network (mine), and one media library layout (mine). It assumes the
> [Custom Tabs](https://github.com/iAmParadox27/jellyfin-plugin-customtabs)
> and [KefinTweaks](https://github.com/ranaldsgift/KefinTweaks) plugins
> are installed, that the
> [JavaScript Injector](https://github.com/johnpc/jellyfin-plugin-javascript-injector)
> plugin is loading the bootstrap script, and that the user has admin
> permissions inside Jellyfin.
>
> If you've found this repo and want to use it: **please don't**.
> I cannot support installations outside my own setup, the ABI surface
> can change without notice, and there's no graceful failure path when
> the dependencies it expects aren't there. Fork it, copy ideas, learn
> from the patterns — but don't install the build artefacts on a
> Jellyfin server you care about.
>
> **No guarantee this repo stays where it is.** It may be made
> private, deleted, archived, or moved to a different account /
> manifest URL with no notice. If anything here is useful to you,
> **fork it now** so you have your own copy at a URL you control.
>
> **If I ever decide to open-source either of these (or Cypherflix
> Grabber), I'll do that explicitly at a later time** — until then,
> assume nothing about long-term availability.

---

A Jellyfin plugin that drops a unified Discover / Manage UI into the
home page tab strip, backed entirely by the private
`cypherflix-grabber` HTTP API. Books, comics, audiobooks, and
(planned) movies, TV, anime, manga all run through one workflow with
one set of status pills and one search bar.

## What it actually does

- **Discover tab** — browses Hardcover trending books, ComicVine recent
  issues, Coming Soon (driven by the user's active watchlist), and a
  unified search across both providers. Cards have a "+ Request" CTA
  that POSTs the pre-baked watchlist payload to the grabber.
- **Manage tab** — five-bucket view (Wanted / Downloading / Downloaded /
  Enriching / Complete) over every active request the grabber is
  tracking. Per-card admin actions: Retry, Refresh metadata, Re-grab.
- **Reverse-proxy controller** — `/Cypherflix/api/*` forwards to the
  grabber's `/api/v1/*` with the configured token, gated by Jellyfin's
  `[Authorize]` attribute so non-authed clients can't reach it.
- **Lazy cover loader** — wanted items without a cached cover get one
  fetched on-demand via the grabber's `/requests/{id}/cover` endpoint;
  the placeholder is replaced with a fading-in `<img>` when the URL
  comes back.

## Architecture

The plugin is a thin C# shell. The active code is JavaScript:

- `bootstrap.js` is loaded by the JavaScript Injector plugin on every
  page-show. It looks for two anchor `<div>`s inside the active
  Custom Tabs body — `.sections.cypherflix-discover` and
  `.sections.cypherflix-manage` — and renders the corresponding page
  module into them. Custom Tabs handles tab visibility / activation;
  this plugin only paints content.
- `pages/manage.js` and `pages/discover.js` build their UI using the
  KefinTweaks Watchlist plugin's CSS class names verbatim
  (`.progress-card`, `.movie-card`, `.watchlist-tabs`, etc.) so styling
  cascades from there with no theming work on this side.
- `pages/api.js` calls the reverse-proxy controller, forwarding the
  Jellyfin user's `ApiClient.accessToken()` as `X-Emby-Token`. Handles
  session-readiness wait and one-shot 401 retry.

## Required plugins

This plugin will not function without all of:

| Plugin                | Why                                                         |
|-----------------------|-------------------------------------------------------------|
| Custom Tabs           | Hosts the `<div class="sections cypherflix-*"></div>` anchors |
| KefinTweaks           | Provides the CSS this plugin's UI inherits from             |
| JavaScript Injector   | Loads `bootstrap.js` on every page                          |
| File Transformation   | (Used during plugin install for index.html injection)       |

And the private `cypherflix-grabber` running at the URL configured in
the plugin settings.

## License

MIT — see `LICENSE`. No warranty, no support.
