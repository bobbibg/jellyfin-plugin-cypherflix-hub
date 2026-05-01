# Cypherflix Hub

A Jellyfin plugin that adds **Discover / Requests / Calendar** tabs across
your whole stack — Jellyseerr, Readarr, Spotify, anything you
plug in via the provider framework. Replaces the JF Enhanced
Requests/Calendar tabs with multi-provider versions and adds
Meilisearch-backed unified search.

> **Status: under construction.** The provider framework, configuration
> models, and full architecture docs are in place. Provider implementations,
> services, controllers, and UI pages are scoped as parallelizable agent
> tasks under `tasks/`.

## Install

```
Manifest URL:  https://raw.githubusercontent.com/bobbibg/jellyfin-plugin-cypherflix-hub/main/manifest.json
```

Required Jellyfin version: **10.10.7**.
Required other plugins: **File Transformation** (used for SPA tab + page
injection — see ARCHITECTURE.md §8.1).

## Documentation

- `ARCHITECTURE.md` — design, repo layout, provider abstraction, indexing
  strategy, lifecycle, "how to add a provider" guide. Read this first.
- `JELLYFIN-INTEGRATION.md` — every Jellyfin / third-party class name,
  namespace, and API contract this plugin depends on, with source URLs.
  No invented class names — everything is grounded.
- `PROMPTS.md` — Claude Code agent invocation templates for each
  parallelizable task.
- `tasks/` — one self-contained brief per agent run.

## Repo layout

See `ARCHITECTURE.md` §2 for the full tree. Top-level dirs:

- `Jellyfin.Plugin.CypherflixHub/` — the plugin source
- `tasks/` — per-task specs for parallel agent runs
- `.github/workflows/` — CI

## Development

Start by reading the three docs above in order. To dispatch an agent on
a specific task, copy the matching block from `PROMPTS.md`, paste into
your agent driver, and let it run.

## License

MIT — see `LICENSE`.
