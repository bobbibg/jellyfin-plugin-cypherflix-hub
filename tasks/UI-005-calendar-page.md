# UI-005 — Calendar page

**Goal:** upcoming releases across all providers in a month-grid view.

## File

- `Jellyfin.Plugin.CypherflixHub/Web/pages/calendar.js`

## Conventions

Same as UI-003/004.

## TEMPLATE

```
[ < Apr 2026 > ]                      [ type filter chips ]

   Mon  Tue  Wed  Thu  Fri  Sat  Sun
   --   --   01   02   03   04   05
   ...
   27   28   29   30   01   02   03

(below grid, mobile-first list view)
   Apr 14 — Hyperion Falls (Book) — Dan Simmons
   Apr 17 — Severance s2e8 (TV) — ...
   ...
```

Day cells with releases get a small badge `(n)` and on click filter the
list below.

## Behaviour

- On render: `GET /CypherflixHub/Calendar?start=<month-start>&end=<month-end>`.
- Month nav: arrow buttons → re-query, replace grid + list.
- Click an entry → opens Jellyfin item if available, else `ExternalUrl`.
- "Today" cell highlighted with `--jf-palette-primary-main`.

## Acceptance criteria

- Current month renders without errors.
- Sonarr/Radarr upcoming entries show correctly via Jellyseerr provider.
- Readarr book releases show on their `ReleaseDate`.
- Type filter narrows to e.g. only Books.

---

Status: not-started — needs API-004
