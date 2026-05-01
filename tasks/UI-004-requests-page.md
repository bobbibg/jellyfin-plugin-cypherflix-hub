# UI-004 — Requests page

**Goal:** the user's requests across all providers, replacing what JF
Enhanced shows on its Requests tab.

## File

- `Jellyfin.Plugin.CypherflixHub/Web/pages/requests.js`

## Conventions

Same as UI-003 — use Jellyfin's native classes, follow `JELLYFIN-INTEGRATION.md`.

## TEMPLATE

```
[ tabs:    All  |  Pending  |  In Progress  |  Available  |  Failed ]
[ list grouped by media type ]

  Movies (Jellyseerr)
    [poster] Title (Year)            [status pill]    [external link]
    ...

  Books (Readarr - Books)
    [poster] Title - Author          [progress bar]   [external link]
    ...
```

## Status pills

| State | Pill colour | Text |
|---|---|---|
| `Pending` | warning | Pending |
| `Approved` | info | Approved |
| `InProgress` | primary | Downloading (n%) |
| `Available` | success | Available |
| `Failed` | error | Failed |
| `Declined` | neutral | Declined |

Use `--jf-palette-*` colours.

## Behaviour

- On render: `GET /CypherflixHub/Requests` → group by `ProviderTypeId` →
  render.
- Refresh button (top right) → re-fetch.
- "Available" rows: clicking the title navigates to the Jellyfin item
  detail page if `JellyfinItemId` is known. (The aggregator can decorate
  with library matches similarly to SearchAggregator step 4 — coordinate
  with SVC-004 agent.)
- "Failed" rows: tooltip with `Message`.
- Tab filter is client-side.

## Acceptance criteria

- Empty state if user has no requests.
- Pending request appears immediately after submission via Discover.
- Status updates on refresh as Sonarr/Readarr progress.

---

Status: not-started — needs API-003
