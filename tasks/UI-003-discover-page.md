# UI-003 — Discover page

**Goal:** the search/browse experience on the Discover tab.

## File

- `Jellyfin.Plugin.CypherflixHub/Web/pages/discover.js` (embedded resource)

## Conventions

- Follow `JELLYFIN-INTEGRATION.md` §4.2 for `ApiClient` / `Dashboard` usage.
- Use Jellyfin's existing `.cardBox` / `.card` / `.cardImage` classes for
  result cards so they match library item cards. Verify the exact class
  names against jellyfin-web during implementation, and add findings to
  `JELLYFIN-INTEGRATION.md`.

## Module shape (called by bootstrap.js)

```js
return {
    render(container) {
        container.innerHTML = TEMPLATE;
        wireUp(container);
    }
};
```

## TEMPLATE

```
[ search input — debounced 250ms ]
[ type filter chips: All / Movies / TV / Books / Comics / Audiobooks / Music ]
[ infinite scroll grid of result cards ]
```

Empty state: friendly message "Type to search across your stack".

## Result card

For each `SearchResult`:
- Poster (from `PosterUrl`)
- Title + Year + MediaType badge
- Action button:
  - If `InLibrary` → "Play" (deep-link `/web/index.html#/details?id={JellyfinItemId}`)
  - Else if `RequestPending` → "Pending" badge + status text
  - Else if some configured provider with `Request` capability handles
    this `MediaType` → "Request" (POST /CypherflixHub/Requests)
  - Else → no action button

## Search

- Debounced input → `GET /CypherflixHub/Search?q=<q>&types=<csv>&limit=24&offset=<n>`
- On scroll near bottom: bump offset, append.
- On type filter change: reset offset, re-query.

## Request flow

Click "Request" → optimistically replace button with spinner → POST →
on success: replace with "Pending" badge.

## Acceptance criteria

- Typing "dune" returns results within 1 second.
- Library items show "Play" and play correctly when clicked.
- Movies/TV without library coverage show "Request" and successfully
  submit through Jellyseerr.
- Type filter narrows results.
- No console errors.

---

Status: not-started — needs API-002, API-003
