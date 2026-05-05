// Cypherflix Hub bootstrap. Injected into Jellyfin's index.html. Adds a "Cypherflix"
// entry to the user menu and renders the Manage / Discover tabs in a slide-over panel.

(function () {
    'use strict';
    if (window.__cypherflixHubLoaded) return;
    window.__cypherflixHubLoaded = true;

    const STYLE_URL = '/CypherflixHub/Web/styles.css';
    const PAGES = {
        manage:   '/CypherflixHub/Web/pages/manage.js',
        discover: '/CypherflixHub/Web/pages/discover.js',
    };

    function ensureStyles() {
        if (document.querySelector('link[data-cypherflix]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = STYLE_URL;
        link.setAttribute('data-cypherflix', '');
        document.head.appendChild(link);
    }

    function makePanel() {
        let panel = document.getElementById('cf-hub-panel');
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = 'cf-hub-panel';
        panel.className = 'cf-panel cf-hidden';
        panel.innerHTML = `
            <div class="cf-panel-header">
                <h2>Cypherflix</h2>
                <nav class="cf-tabs">
                    <button class="cf-tab cf-tab-active" data-page="manage">Manage</button>
                    <button class="cf-tab" data-page="discover">Discover</button>
                </nav>
                <button class="cf-close" aria-label="Close">×</button>
            </div>
            <div class="cf-panel-body" id="cf-page-root">
                <div class="cf-loading">Loading…</div>
            </div>`;
        document.body.appendChild(panel);

        panel.querySelector('.cf-close').addEventListener('click', () => panel.classList.add('cf-hidden'));
        panel.querySelectorAll('.cf-tab').forEach(t => t.addEventListener('click', () => {
            panel.querySelectorAll('.cf-tab').forEach(x => x.classList.remove('cf-tab-active'));
            t.classList.add('cf-tab-active');
            void loadPage(t.dataset.page);
        }));
        return panel;
    }

    async function loadPage(name) {
        const root = document.getElementById('cf-page-root');
        if (!root) return;
        root.innerHTML = '<div class="cf-loading">Loading…</div>';
        try {
            const mod = await import(PAGES[name]);
            await mod.render(root);
        } catch (err) {
            root.innerHTML = `<div class="cf-error">Failed to load page: ${String(err && err.message || err)}</div>`;
        }
    }

    function openPanel() {
        ensureStyles();
        const panel = makePanel();
        panel.classList.remove('cf-hidden');
        const active = panel.querySelector('.cf-tab.cf-tab-active');
        if (active) void loadPage(active.dataset.page || 'manage');
    }

    // Mount a top-bar entry. Try a few known selectors so we work across
    // jellyfin-web minor versions.
    function mountTrigger() {
        if (document.querySelector('.cf-trigger')) return;
        const headerRight = document.querySelector('.headerRight, .skinHeader-userMenuButtons, .headerUser, .skinHeader');
        if (!headerRight) return;
        const btn = document.createElement('button');
        btn.className = 'cf-trigger headerButton headerButtonRight paper-icon-button-light';
        btn.title = 'Cypherflix';
        btn.innerHTML = '<span class="material-icons" aria-hidden="true">auto_stories</span>';
        btn.addEventListener('click', (e) => { e.preventDefault(); openPanel(); });
        headerRight.appendChild(btn);
    }

    function tryMount() {
        try { mountTrigger(); } catch (_) {}
    }

    // Mount on initial load and observe DOM changes — Jellyfin re-renders
    // the header on navigation in some flows.
    document.addEventListener('DOMContentLoaded', tryMount);
    tryMount();
    const observer = new MutationObserver(tryMount);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

    // Keyboard shortcut (Shift+C) to open the panel — handy during dev.
    document.addEventListener('keydown', (e) => {
        if (e.shiftKey && (e.key === 'C' || e.key === 'c') && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const target = e.target;
            const tag = (target && target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;
            openPanel();
        }
    });

    // Expose for debugging / external triggers
    window.cypherflix = { open: openPanel };
}());
