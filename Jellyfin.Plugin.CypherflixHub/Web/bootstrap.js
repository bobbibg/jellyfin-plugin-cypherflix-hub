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

    function tryRenderAll() {
        ensureStyles();
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
