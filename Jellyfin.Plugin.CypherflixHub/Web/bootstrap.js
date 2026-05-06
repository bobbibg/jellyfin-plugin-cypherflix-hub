// Cypherflix Hub bootstrap — runs once per Jellyfin web load.
// Adds Discover + Manage entries into the user drawer's pluginMenuOptions
// container, listens for hashchange, and mounts our routed pages on top of
// Jellyfin's content area. No floating overlays, no custom modal — pages
// integrate with Jellyfin's existing SPA chrome.

(function () {
    'use strict';
    if (window.__cypherflixHubLoaded) return;
    window.__cypherflixHubLoaded = true;

    const ROUTES = {
        '#/cypherflix/discover': { module: '/CypherflixHub/Web/pages/discover.js', title: 'Discover' },
        '#/cypherflix/manage':   { module: '/CypherflixHub/Web/pages/manage.js',   title: 'Manage'   },
    };

    const STYLE_URL = '/CypherflixHub/Web/styles.css';
    const CONTAINER_ID = 'cypherflixPage';

    // ----- styles --------------------------------------------------------
    function ensureStyles() {
        if (document.querySelector('link[data-cypherflix]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = STYLE_URL;
        link.setAttribute('data-cypherflix', '');
        document.head.appendChild(link);
    }

    // ----- sidenav injection --------------------------------------------
    // Render an emby-linkbutton matching native Jellyfin nav items.
    function navLink(href, icon, label, extraClass) {
        const a = document.createElement('a');
        a.setAttribute('is', 'emby-linkbutton');
        a.className = 'navMenuOption lnkMediaFolder emby-button ' + (extraClass || '');
        a.href = href;
        a.dataset.cfNav = label;
        a.innerHTML =
            '<span class="material-icons navMenuOptionIcon" aria-hidden="true">' + icon + '</span>' +
            '<span class="navMenuOptionText">' + label + '</span>';
        return a;
    }

    function mountUserDrawerLinks() {
        // pluginMenuOptions is a class on the drawer's plugin section (where
        // links like "Modular Home" live). Other Jellyfin plugins use it the
        // same way. Falls back to libraryMenuOptions if the plugin section
        // isn't rendered yet — better visible than missing.
        const host =
            document.querySelector('.pluginMenuOptions') ||
            document.querySelector('.libraryMenuOptions');
        if (!host) return false;
        if (host.querySelector('[data-cf-nav]')) return true;
        host.appendChild(navLink('#/cypherflix/discover', 'auto_stories', 'Discover'));
        host.appendChild(navLink('#/cypherflix/manage',   'fact_check',   'Manage'));
        return true;
    }

    // Admin dashboard side has a Material-UI drawer with a different DOM
    // shape — list-of-buttons inside a <ul>. We append a single "Cypherflix
    // Manage" item so admins can jump to the Manage page without leaving the
    // dashboard chrome. React doesn't unmount sibling DOM, so this sticks.
    function mountAdminDrawerLink() {
        const drawer = document.querySelector('.MuiDrawer-paper.MuiDrawer-paperAnchorDock');
        if (!drawer) return false;
        const list = drawer.querySelector('ul');
        if (!list) return false;
        if (list.querySelector('[data-cf-admin-nav]')) return true;
        // Match the Mui list item shape — clone the structure of an existing
        // entry so theme classes flow through, then swap the contents.
        const proto = list.querySelector('a.MuiButtonBase-root');
        if (!proto) return false;
        const li = document.createElement('li');
        li.className = proto.parentElement?.className || '';
        li.setAttribute('data-cf-admin-nav', '');
        const a = document.createElement('a');
        a.className = proto.className;
        a.setAttribute('tabindex', '0');
        a.href = '#/cypherflix/manage';
        a.innerHTML =
            '<div class="MuiListItemIcon-root ' +
            (proto.querySelector('.MuiListItemIcon-root')?.className || '') +
            '"><span class="material-icons" aria-hidden="true">fact_check</span></div>' +
            '<div class="MuiListItemText-root ' +
            (proto.querySelector('.MuiListItemText-root')?.className || '') +
            '"><span class="MuiTypography-root MuiTypography-body1 MuiListItemText-primary">Cypherflix Manage</span></div>';
        li.appendChild(a);
        list.appendChild(li);
        return true;
    }

    // ----- routed page container ----------------------------------------
    // Find Jellyfin's main page container (where .page elements live) and
    // create our own .page sibling that we toggle visibility on.
    function ensurePageContainer() {
        let container = document.getElementById(CONTAINER_ID);
        if (container) return container;
        const host =
            document.querySelector('.mainAnimatedPagesContainer') ||
            document.querySelector('.skinBody') ||
            document.body;
        container = document.createElement('div');
        container.id = CONTAINER_ID;
        // Match Jellyfin's .page conventions so theme-level page styles apply.
        container.className = 'page hide cypherflixPage padded-bottom-page';
        container.setAttribute('data-cf-page', '');
        host.appendChild(container);
        return container;
    }

    // ----- routing -------------------------------------------------------
    let currentModule = null;

    function showOurPage(container) {
        // Hide Jellyfin's own pages so our content is what's visible.
        document.querySelectorAll('.page:not(.cypherflixPage)').forEach(p => {
            if (!p.classList.contains('hide')) {
                p.dataset.cfHidden = '1';
                p.classList.add('hide');
            }
        });
        container.classList.remove('hide');
    }

    function hideOurPage(container) {
        container.classList.add('hide');
        // Unhide everything we hid so Jellyfin's SPA goes back to normal.
        document.querySelectorAll('.page[data-cf-hidden="1"]').forEach(p => {
            p.classList.remove('hide');
            delete p.dataset.cfHidden;
        });
    }

    async function renderRoute(hash) {
        ensureStyles();
        const container = ensurePageContainer();
        const route = ROUTES[hash];
        if (!route) {
            hideOurPage(container);
            currentModule = null;
            return;
        }
        document.title = 'Cypherflix ' + route.title;
        showOurPage(container);
        container.innerHTML =
            '<div class="padded-left padded-right padded-top">' +
            '  <div class="cf-loading">Loading ' + route.title + '…</div>' +
            '</div>';
        try {
            const mod = await import(route.module);
            currentModule = mod;
            await mod.render(container);
        } catch (err) {
            console.error('cypherflix-hub: failed to load', route.module, err);
            container.innerHTML =
                '<div class="padded-left padded-right padded-top">' +
                '  <div class="cf-error">Failed to load ' + route.title + ': ' +
                String(err && err.message || err) + '</div>' +
                '</div>';
        }
    }

    function onHashChange() {
        renderRoute(window.location.hash);
    }

    // ----- mount loop ----------------------------------------------------
    // Jellyfin re-renders portions of the DOM (drawer, page area) on
    // navigation, so we re-attempt sidenav injection whenever the body
    // mutates. Cheap because mountUserDrawerLinks() short-circuits.
    // tryMount is idempotent for the bits that don't depend on state. We
    // explicitly do NOT call renderRoute here — that mutates the DOM heavily
    // (hides all sibling .page elements), and the MutationObserver below
    // would loop. renderRoute fires only on hashchange + initial load.
    let mounting = false;
    function tryMount() {
        if (mounting) return;
        mounting = true;
        try {
            mountUserDrawerLinks();
            mountAdminDrawerLink();
            ensurePageContainer();
            // If we're on a Cypherflix route but Jellyfin has unhidden every
            // page during a navigation it routed itself, re-apply our hide
            // state by toggling the container — but DON'T re-import the
            // module or re-render content.
            const route = ROUTES[window.location.hash];
            const container = document.getElementById(CONTAINER_ID);
            if (route && container && container.classList.contains('hide')) {
                showOurPage(container);
            }
        } finally {
            mounting = false;
        }
    }

    let observerTimer = null;
    function debouncedMount() {
        if (observerTimer) return;
        observerTimer = setTimeout(() => {
            observerTimer = null;
            tryMount();
        }, 150);
    }

    document.addEventListener('DOMContentLoaded', tryMount);
    tryMount();
    new MutationObserver(debouncedMount).observe(
        document.body || document.documentElement,
        { childList: true, subtree: true },
    );

    window.addEventListener('hashchange', onHashChange);
    if (ROUTES[window.location.hash]) renderRoute(window.location.hash);

    // Expose for debugging
    window.cypherflix = {
        navigate: (where) => {
            const h = where.startsWith('#/') ? where : '#/cypherflix/' + where;
            window.location.hash = h;
        },
    };
}());
