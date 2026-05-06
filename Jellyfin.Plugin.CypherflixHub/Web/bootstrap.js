// Cypherflix Hub bootstrap — pure renderer.
//
// This script does NOT inject menu items or top tabs. Tabs are added by the
// admin via the Custom Tabs plugin; sidenav links are added by the admin
// via the KefinTweaks plugin's Custom Menu Links feature. Our job is to
// render Discover / Manage content into anchor <div>s that those plugins
// host inside their tab bodies.
//
// Setup (one-time, by an admin):
//   1. Custom Tabs plugin → add tabs with these bodies:
//        Title: Discover    Body: <div class="sections cypherflix-discover"></div>
//        Title: Manage      Body: <div class="sections cypherflix-manage"></div>
//   2. KefinTweaks plugin → add Custom Menu Links pointing at
//        #/home?tab=N for each Discover / Manage tab index.
//
// On every home view-show, hashchange, or DOM mutation we look for our
// anchor divs and render into them. Custom Tabs only mounts the active
// tab's body, so navigating away naturally tears our DOM down — no
// container hiding to manage.

(function () {
    'use strict';
    if (window.__cypherflixHubLoaded) return;
    window.__cypherflixHubLoaded = true;

    const STYLE_URL = '/CypherflixHub/Web/styles.css';
    const ANCHORS = {
        discover: { selector: '.sections.cypherflix-discover', module: '/CypherflixHub/Web/pages/discover.js' },
        manage:   { selector: '.sections.cypherflix-manage',   module: '/CypherflixHub/Web/pages/manage.js'   },
    };

    function ensureStyles() {
        if (document.querySelector('link[data-cypherflix]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = STYLE_URL;
        link.setAttribute('data-cypherflix', '');
        document.head.appendChild(link);
    }

    // Module cache survives the page; cache-buster ensures plugin upgrades
    // load fresh code on the next render.
    const _moduleCache = {};
    async function loadModule(url) {
        if (_moduleCache[url]) return _moduleCache[url];
        const cb = url.indexOf('?') === -1 ? '?cb=' + Date.now() : '&cb=' + Date.now();
        _moduleCache[url] = await import(url + cb);
        return _moduleCache[url];
    }

    async function renderInto(host, key) {
        const a = ANCHORS[key];
        if (!a || host.dataset.cfRendered === '1') return;
        host.dataset.cfRendered = '1';
        try {
            const mod = await loadModule(a.module);
            host.innerHTML = '';
            await mod.render(host);
        } catch (err) {
            console.warn('cypherflix-hub: render failed for', key, err);
            host.innerHTML =
                '<div class="movie-history-empty-message">' +
                '  <div class="empty-message-icon"><span class="material-icons">error_outline</span></div>' +
                '  <h3 class="empty-message-title">Cypherflix Hub failed to load</h3>' +
                '  <p class="empty-message-subtitle">' + String(err && err.message || err) + '</p>' +
                '</div>';
            delete host.dataset.cfRendered;
        }
    }

    // Custom Tabs creates one customTab_<N> content container per tab on
    // first config save, but doesn't always backfill containers when new
    // tabs are added later — so the tab BUTTON appears but the BODY doesn't.
    // We patch by reading the Custom Tabs plugin config, finding any tab
    // whose ContentHtml contains one of our anchor signatures, and cloning
    // a customTab_<N> div into existence with the configured HTML.
    async function ensureCustomTabContainers() {
        // Jellyfin keeps SPA pages mounted, only toggling .hide. We must
        // backfill into the CURRENTLY VISIBLE .libraryPage so our containers
        // siblings the visible homeTab / customTab_0 — not some hidden one.
        const liveLib = document.querySelector('.libraryPage:not(.hide)');
        if (!liveLib) return;
        const proto = liveLib.querySelector('[id^="customTab_"]');
        if (!proto) return;  // Custom Tabs hasn't initialised — try again later.
        const parent = proto.parentElement;
        if (!parent || parent !== liveLib) return;
        // Skip if our containers already exist as DIRECT children of the
        // live libraryPage. Otherwise check anew (allows recovery if user
        // reconfigures Custom Tabs mid-session).
        const haveOurs = !!liveLib.querySelector(':scope > .sections.cypherflix-discover, :scope > .sections.cypherflix-manage');
        const client = window.ApiClient;
        if (!client || typeof client.accessToken !== 'function') return;
        const tok = client.accessToken();
        if (!tok) return;
        const base = (typeof client.serverAddress === 'function' ? client.serverAddress() : '') || '';
        if (haveOurs) return;
        try {
            const plugins = await fetch(base + '/Plugins', {
                credentials: 'same-origin',
                headers: { 'X-Emby-Token': tok },
            }).then((r) => (r.ok ? r.json() : null));
            if (!Array.isArray(plugins)) return;
            const ct = plugins.find((p) => /custom.?tabs/i.test(p && p.Name || ''));
            if (!ct) return;
            const cfg = await fetch(base + '/Plugins/' + ct.Id + '/Configuration', {
                credentials: 'same-origin',
                headers: { 'X-Emby-Token': tok },
            }).then((r) => (r.ok ? r.json() : null));
            if (!cfg || !Array.isArray(cfg.Tabs)) return;
            const ourSigs = ['cypherflix-discover', 'cypherflix-manage'];
            for (let i = 0; i < cfg.Tabs.length; i++) {
                const t = cfg.Tabs[i] || {};
                const html = t.ContentHtml || '';
                const isOurs = ourSigs.some((s) => html.indexOf(s) !== -1);
                if (!isOurs) continue;
                // Skip if a sibling with this index already exists IN THE LIVE
                // libraryPage. Duplicate IDs may exist from older runs in
                // hidden libraryPages — those are OK to leave alone.
                if (liveLib.querySelector(':scope > [data-index="' + (i + 2) + '"]')) continue;
                // Clone the prototype's wrapper attributes so Jellyfin's
                // tab-routing logic recognises our container.
                const node = proto.cloneNode(false);
                node.id = 'customTab_' + i;
                if (proto.dataset.index !== undefined) {
                    node.dataset.index = String(i + 2);  // Home=0, Favourites=1, custom=2+
                }
                node.innerHTML = html;
                liveLib.appendChild(node);
            }
        } catch (_) { /* best-effort; observer will retry */ }
    }

    // After every render pass, if the URL points at one of our backfilled
    // tabs but Jellyfin's tab-routing left it inactive (Jellyfin caches
    // the tab list at page-load time, before our containers existed), we
    // activate it manually: add is-active to ours, strip from siblings,
    // sync the tab-strip button states. This mirrors what Jellyfin does
    // internally for the tab it does know about.
    function syncActiveCustomTab() {
        const m = (window.location.hash || '').match(/[?&]tab=(\d+)/);
        if (!m) return;
        const liveLib = document.querySelector('.libraryPage:not(.hide)');
        if (!liveLib) return;
        const wantIdx = parseInt(m[1], 10);
        const wanted = liveLib.querySelector(':scope > [id^="customTab_"][data-index="' + wantIdx + '"]');
        if (!wanted) return;
        if (wanted.classList.contains('is-active')) return;  // Jellyfin handled it.
        // Deactivate every other tab pane in the same parent.
        liveLib.querySelectorAll(':scope > .tabContent').forEach((p) => p.classList.remove('is-active'));
        wanted.classList.add('is-active');
        // Sync top tab-strip buttons: deactivate others, activate ours.
        document.querySelectorAll('.tabs-viewmenubar .emby-tab-button').forEach((b) => b.classList.remove('emby-tab-button-active'));
        const btn = document.querySelector('.tabs-viewmenubar .emby-tab-button[data-index="' + wantIdx + '"]');
        if (btn) btn.classList.add('emby-tab-button-active');
    }

    function tryRenderAll() {
        ensureStyles();
        // Best-effort backfill any missing customTab_<N> containers.
        void ensureCustomTabContainers();
        // Activate our tab if the URL says so but Jellyfin didn't.
        syncActiveCustomTab();
        for (const key of Object.keys(ANCHORS)) {
            const host = document.querySelector(ANCHORS[key].selector + ':not([data-cf-rendered="1"])');
            if (host) void renderInto(host, key);
        }
    }

    function bootHooks() {
        // Prefer KefinTweaksUtils.onViewPage when available — fires
        // whenever the user enters / re-enters a home view.
        const utils = window.KefinTweaksUtils;
        if (utils && typeof utils.onViewPage === 'function') {
            try { utils.onViewPage(() => tryRenderAll(), { pages: ['home', 'home.html'] }); } catch (_) {}
        }

        window.addEventListener('hashchange', tryRenderAll);

        // Debounced MutationObserver — picks up the moment Custom Tabs
        // mounts the anchor div for the active tab. Self-stabilising
        // because renderInto sets dataset.cfRendered, so we no-op once
        // the page has rendered.
        let timer = null;
        new MutationObserver(() => {
            if (timer) return;
            timer = setTimeout(() => { timer = null; tryRenderAll(); }, 150);
        }).observe(document.body || document.documentElement, { childList: true, subtree: true });

        tryRenderAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootHooks);
    } else {
        bootHooks();
    }

    // Debug helper
    window.cypherflix = {
        retry: () => {
            for (const key of Object.keys(ANCHORS)) {
                const host = document.querySelector(ANCHORS[key].selector);
                if (host) delete host.dataset.cfRendered;
            }
            tryRenderAll();
        },
        anchors: ANCHORS,
    };
}());
