# UI-001 — bootstrap.js (SPA tab + route injection)

**Goal:** the script File Transformation injects into `index.html`. It adds
three tabs to the title bar and dispatches to per-page modules on
hash-route changes.

## File

- `Jellyfin.Plugin.CypherflixHub/Web/bootstrap.js` (embedded resource)

## Pre-flight: confirm selectors against a live Jellyfin

Before writing code, the agent MUST inspect a running Jellyfin 10.10.7
instance and identify:

1. The exact CSS selector for the title-bar tab strip on the home page.
   Likely candidates: `.headerTabs`, `.emby-tabs`, `.tabs-element`.
2. The CSS classes Jellyfin uses on its native tab buttons (so ours match).
3. The container we render page content into. Likely `.skinBody` or
   `.mainAnimatedPages` or one of its child views.

Document findings in `JELLYFIN-INTEGRATION.md` §8 (open question 2) before
shipping.

## Behaviour

```js
(function () {
    "use strict";
    if (window.__cypherflixHubLoaded) return;
    window.__cypherflixHubLoaded = true;

    const TAB_DEFS = [
        { id: "cypherflix-discover",  label: "Discover",  hash: "#/cypherflix/discover"  },
        { id: "cypherflix-requests",  label: "Requests",  hash: "#/cypherflix/requests"  },
        { id: "cypherflix-calendar",  label: "Calendar",  hash: "#/cypherflix/calendar"  }
    ];

    function injectTabs() { /* ... */ }
    function ensureStyles() { /* ... */ }
    function onRouteChange() { /* ... */ }

    // Wait for the SPA to mount, then run.
    const observer = new MutationObserver(() => {
        if (document.querySelector(/* the tab-bar selector */)) {
            ensureStyles();
            injectTabs();
            window.addEventListener("hashchange", onRouteChange);
            onRouteChange();
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
```

## injectTabs

For each `TAB_DEFS` entry:

- If a tab with `data-cypherflix-tab="<id>"` already exists, skip.
- Create a `<button>` with the same classes Jellyfin's own tab buttons
  use (read from `JELLYFIN-INTEGRATION.md` §8).
- `button.dataset.cypherflixTab = id`.
- `onClick` → `window.location.hash = hash`.
- Append to the tab strip container.

## onRouteChange

```js
const hash = window.location.hash;
const match = TAB_DEFS.find(t => hash === t.hash);
if (!match) return;
fetch(`/CypherflixHub/Web/pages/${match.id.split("-")[1]}.js`)
    .then(r => r.text())
    .then(code => {
        // Each page module is wrapped in an IIFE that exports a render(container)
        const fn = new Function("ApiClient", "Dashboard", code);
        const module = fn(window.ApiClient, window.Dashboard);
        const container = document.querySelector(/* main view selector */);
        container.innerHTML = "";
        module.render(container);
    });
```

(Caching: file naming → routing key uses everything after the dash, so
`cypherflix-discover` → `discover.js`.)

## ensureStyles

Inject `<link rel="stylesheet" href="/CypherflixHub/Web/styles.css">` once.

## Acceptance criteria

- Three tabs appear on the home page after a fresh login.
- Clicking each tab updates the URL hash.
- Visiting `#/cypherflix/discover` directly renders the Discover page.
- Bootstrap is idempotent — reloading doesn't double-inject.
- No JS errors in the console.

---

Status: not-started — needs API-005, SVC-005
