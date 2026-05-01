/*
 * Cypherflix Hub — SPA bootstrap
 * Injected into Jellyfin's index.html by Services/IndexHtmlTransform.cs
 * (served as an embedded resource by Api/WebController.cs).
 *
 * Selectors and native markup verified against jellyfin-web v10.10.7 source.
 * See JELLYFIN-INTEGRATION.md §7.4 for the source citations.
 */
(function () {
    "use strict";

    // Idempotency: index.html may be re-evaluated (SPA navigation, theme reload)
    // and the script tag itself is guarded against double-injection in
    // IndexHtmlTransform, but defend in depth here too.
    if (window.__cypherflixHubLoaded) return;
    window.__cypherflixHubLoaded = true;

    // ------------------------------------------------------------------
    // Tab definitions
    // ------------------------------------------------------------------
    // id: stable DOM marker (data-cypherflix-tab) AND module-naming key.
    // The page module file name is everything after the dash:
    //   "cypherflix-discover" -> "/CypherflixHub/Web/pages/discover.js"
    const TAB_DEFS = [
        { id: "cypherflix-discover", label: "Discover", hash: "#/cypherflix/discover" },
        { id: "cypherflix-requests", label: "Requests", hash: "#/cypherflix/requests" },
        { id: "cypherflix-calendar", label: "Calendar", hash: "#/cypherflix/calendar" }
    ];

    // ------------------------------------------------------------------
    // Selectors (jellyfin-web v10.10.7 — see JELLYFIN-INTEGRATION.md §7.4)
    // ------------------------------------------------------------------
    const HEADER_TABS_SELECTOR = ".skinHeader .headerTabs";
    // Inside .headerTabs Jellyfin renders <div is="emby-tabs"><div class="emby-tabs-slider">…</div></div>
    // The slider is where native tab buttons live; we mount alongside them.
    const TAB_SLIDER_SELECTOR = ".emby-tabs-slider";
    const MAIN_VIEW_SELECTOR = ".mainAnimatedPages";
    // Cypherflix's own page container, mounted inside .mainAnimatedPages.
    // We render into this rather than fighting Jellyfin's .mainAnimatedPage
    // animation transitions.
    const CYPHERFLIX_VIEW_ID = "cypherflixHubView";

    // Style/marker ids — keep in one place so ensureStyles + injectTabs
    // can share idempotency keys.
    const STYLES_LINK_ID = "cypherflix-hub-styles";
    const TAB_DATA_ATTR = "data-cypherflix-tab";

    // ------------------------------------------------------------------
    // ensureStyles — inject /CypherflixHub/Web/styles.css once.
    // ------------------------------------------------------------------
    function ensureStyles() {
        if (document.getElementById(STYLES_LINK_ID)) return;
        const link = document.createElement("link");
        link.id = STYLES_LINK_ID;
        link.rel = "stylesheet";
        link.href = "/CypherflixHub/Web/styles.css";
        document.head.appendChild(link);
    }

    // ------------------------------------------------------------------
    // injectTabs — add our three tabs to the title-bar tab strip.
    // Reuses Jellyfin's native button markup (`is="emby-button"` + class
    // "emby-tab-button" + inner .emby-button-foreground) so the tabs
    // visually match first-party tabs without us shipping our own button
    // styles. We do NOT set data-index — that attribute is wired to
    // Jellyfin's TabbedView/maintabsmanager, and we route via hashchange.
    // ------------------------------------------------------------------
    function injectTabs() {
        const headerTabs = document.querySelector(HEADER_TABS_SELECTOR);
        if (!headerTabs) return false;

        // Prefer mounting inside .emby-tabs-slider (where native buttons
        // sit). If the slider hasn't rendered yet on this page (e.g. a
        // page without the home tab strip), append directly to .headerTabs;
        // the watcher will re-run on the next navigation.
        const target = headerTabs.querySelector(TAB_SLIDER_SELECTOR) || headerTabs;

        let injectedAny = false;
        for (const def of TAB_DEFS) {
            // Idempotent — skip if our marker is already present anywhere
            // in the document (covers re-injection after a partial nav).
            if (document.querySelector(`[${TAB_DATA_ATTR}="${def.id}"]`)) {
                continue;
            }

            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("is", "emby-button");
            button.className = "emby-tab-button";
            button.setAttribute(TAB_DATA_ATTR, def.id);

            const inner = document.createElement("div");
            inner.className = "emby-button-foreground";
            inner.textContent = def.label;
            button.appendChild(inner);

            button.addEventListener("click", function (evt) {
                evt.preventDefault();
                if (window.location.hash !== def.hash) {
                    window.location.hash = def.hash;
                } else {
                    // Same hash → hashchange won't fire; re-render explicitly.
                    onRouteChange();
                }
            });

            target.appendChild(button);
            injectedAny = true;
        }

        updateActiveTab();
        return injectedAny;
    }

    // ------------------------------------------------------------------
    // updateActiveTab — toggle the native `emby-tab-button-active` class
    // on whichever Cypherflix tab matches the current hash. Native tabs
    // get untouched.
    // ------------------------------------------------------------------
    function updateActiveTab() {
        const hash = window.location.hash;
        const buttons = document.querySelectorAll(`[${TAB_DATA_ATTR}]`);
        buttons.forEach((btn) => {
            const id = btn.getAttribute(TAB_DATA_ATTR);
            const def = TAB_DEFS.find((t) => t.id === id);
            const isActive = !!def && def.hash === hash;
            btn.classList.toggle("emby-tab-button-active", isActive);
        });
    }

    // ------------------------------------------------------------------
    // ensureViewContainer — own a <div id="cypherflixHubView"> inside
    // .mainAnimatedPages. We never touch Jellyfin's own .mainAnimatedPage
    // children. The container is shown/hidden by us, not by Jellyfin's
    // view manager, so we don't get into a fight with it.
    // ------------------------------------------------------------------
    function ensureViewContainer() {
        let container = document.getElementById(CYPHERFLIX_VIEW_ID);
        if (container) return container;

        const main = document.querySelector(MAIN_VIEW_SELECTOR);
        if (!main) return null;

        container = document.createElement("div");
        container.id = CYPHERFLIX_VIEW_ID;
        container.className = "cypherflix-view hide";
        main.appendChild(container);
        return container;
    }

    // Show our view, hide Jellyfin's currently-visible page so it doesn't
    // bleed through. We add `.hide` to native pages (matching Jellyfin's
    // own visibility convention) and remove it from ours.
    function showCypherflixView(container) {
        const main = document.querySelector(MAIN_VIEW_SELECTOR);
        if (main) {
            main.querySelectorAll(".mainAnimatedPage").forEach((p) => {
                p.classList.add("hide");
            });
        }
        container.classList.remove("hide");
    }

    // Hide our view (used when route doesn't match a Cypherflix tab).
    function hideCypherflixView() {
        const container = document.getElementById(CYPHERFLIX_VIEW_ID);
        if (container) container.classList.add("hide");
        // We deliberately do NOT un-hide Jellyfin's pages here — Jellyfin's
        // own view manager owns their visibility and will restore them on
        // its own route change.
    }

    // ------------------------------------------------------------------
    // onRouteChange — read the hash, dispatch to the matching page module.
    // Module spec: `new Function("ApiClient","Dashboard", code)` returns
    // an object with `render(container)`. See ARCHITECTURE.md §8.1.
    // ------------------------------------------------------------------
    // Tiny in-memory cache to avoid re-fetching the same module on every
    // toggle. Pages are small and rarely change at runtime.
    const moduleCache = new Map();

    async function onRouteChange() {
        updateActiveTab();
        const hash = window.location.hash;
        const match = TAB_DEFS.find((t) => hash === t.hash);
        if (!match) {
            hideCypherflixView();
            return;
        }

        const container = ensureViewContainer();
        if (!container) return;

        showCypherflixView(container);
        container.innerHTML = "";

        const pageName = match.id.split("-")[1]; // "cypherflix-discover" -> "discover"
        const url = `/CypherflixHub/Web/pages/${pageName}.js`;

        try {
            let code = moduleCache.get(url);
            if (code === undefined) {
                const resp = await fetch(url, { credentials: "same-origin" });
                if (!resp.ok) {
                    container.textContent = `Failed to load ${pageName} (${resp.status}).`;
                    return;
                }
                code = await resp.text();
                moduleCache.set(url, code);
            }

            // Page modules execute in a controlled scope with the two
            // globals Jellyfin always exposes — see JELLYFIN-INTEGRATION.md §4.2.
            // eslint-disable-next-line no-new-func
            const fn = new Function("ApiClient", "Dashboard", code);
            const mod = fn(window.ApiClient, window.Dashboard);
            if (mod && typeof mod.render === "function") {
                mod.render(container);
            } else {
                container.textContent = `Page ${pageName} did not export a render(container) function.`;
            }
        } catch (err) {
            // Surface module errors visibly in the page rather than
            // silently swallowing them in the console — non-technical
            // users won't have devtools open.
            container.textContent = `Error loading ${pageName}: ${err && err.message ? err.message : err}`;
            // eslint-disable-next-line no-console
            console.error("[CypherflixHub] route error", err);
        }
    }

    // ------------------------------------------------------------------
    // Boot — wait for the SPA to mount the .headerTabs strip, then
    // attach. Once attached, set up a defensive watcher on .skinHeader
    // that re-injects the tabs whenever our markers disappear (Jellyfin
    // re-renders .headerTabs on navigation).
    // ------------------------------------------------------------------
    function attach() {
        ensureStyles();
        if (!injectTabs()) return false;
        window.addEventListener("hashchange", onRouteChange);
        onRouteChange();
        return true;
    }

    function watchForReinjection() {
        const skinHeader = document.querySelector(".skinHeader");
        // TODO(UI-001): verify on live deploy — confirm .skinHeader is the
        // correct re-render boundary. If Jellyfin replaces .skinHeader
        // wholesale, observe document.body instead and use a debounce.
        const watchTarget = skinHeader || document.body;
        const reinjectObserver = new MutationObserver(() => {
            if (!document.querySelector(`[${TAB_DATA_ATTR}="${TAB_DEFS[0].id}"]`)) {
                injectTabs();
            }
        });
        reinjectObserver.observe(watchTarget, { childList: true, subtree: true });
    }

    const bootObserver = new MutationObserver(() => {
        if (document.querySelector(HEADER_TABS_SELECTOR)) {
            if (attach()) {
                bootObserver.disconnect();
                watchForReinjection();
            }
        }
    });

    if (document.body) {
        bootObserver.observe(document.body, { childList: true, subtree: true });
        // The script is `defer`-loaded so DOM is parsed by the time we run,
        // but the SPA may already have rendered the header — try once
        // synchronously to skip the first MutationObserver tick.
        if (document.querySelector(HEADER_TABS_SELECTOR) && attach()) {
            bootObserver.disconnect();
            watchForReinjection();
        }
    } else {
        // Defensive — should not happen with `defer`, but degrade gracefully.
        document.addEventListener("DOMContentLoaded", () => {
            bootObserver.observe(document.body, { childList: true, subtree: true });
        });
    }
})();
