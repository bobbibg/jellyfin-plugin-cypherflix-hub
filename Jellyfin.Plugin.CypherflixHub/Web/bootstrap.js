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
        // Prefer KefinTweaksUtils.addCustomMenuLink when it's installed —
        // that's the same helper KefinTweaks's Watchlist uses, and it
        // handles its own re-mount lifecycle properly. Falls back to direct
        // injection into customMenuOptions otherwise.
        if (window.KefinTweaksUtils && typeof window.KefinTweaksUtils.addCustomMenuLink === 'function') {
            if (window.__cypherflixDrawerLinksMounted) return true;
            try {
                window.KefinTweaksUtils.addCustomMenuLink('Discover', 'auto_stories', '#/cypherflix/discover');
                window.KefinTweaksUtils.addCustomMenuLink('Manage',   'fact_check',   '#/cypherflix/manage');
                window.__cypherflixDrawerLinksMounted = true;
                return true;
            } catch (_) { /* fall through */ }
        }
        // Fallback: direct DOM injection.
        const host =
            document.querySelector('.customMenuOptions') ||
            document.querySelector('.libraryMenuOptions') ||
            document.querySelector('.pluginMenuOptions');
        if (!host) return false;
        if (host.querySelector('[data-cf-nav]')) return true;
        const manage   = navLink('#/cypherflix/manage',   'fact_check',   'Manage');
        const discover = navLink('#/cypherflix/discover', 'auto_stories', 'Discover');
        host.insertBefore(manage,   host.firstChild);
        host.insertBefore(discover, host.firstChild);
        return true;
    }

    // Inject a "Discover" tab into the Home page's tab strip
    // (.tabs-viewmenubar .emby-tabs-slider), positioned just before the
    // Watchlist tab when present so the order reads
    //   Home  ·  Favourites  ·  Discover  ·  Watchlist.
    // The tab is a plain <button> matching Jellyfin's emby-tab-button class
    // — clicking it navigates to our route rather than participating in
    // the data-index/?tab=N sequence the home page uses.
    function mountTopTab() {
        const slider = document.querySelector('.tabs-viewmenubar .emby-tabs-slider');
        if (!slider) return false;
        if (slider.querySelector('[data-cf-tab]')) return true;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('is', 'emby-button');
        btn.className = 'emby-tab-button emby-button';
        btn.setAttribute('data-cf-tab', 'discover');
        btn.innerHTML = '<div class="emby-button-foreground">Discover</div>';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.location.hash = '#/cypherflix/discover';
        });
        // Insert before the first Watchlist-style button (Custom Tabs
        // creates buttons with id="customTabButton_*"). Failing that,
        // append to the end.
        const watchlistBtn = slider.querySelector('[id^="customTabButton_"]') ||
                             Array.from(slider.querySelectorAll('button')).find(b =>
                                 b.textContent.trim() === 'Watchlist');
        if (watchlistBtn) {
            slider.insertBefore(btn, watchlistBtn);
        } else {
            slider.appendChild(btn);
        }
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
            mountTopTab();
            ensurePageContainer();

            // When Jellyfin's own router doesn't recognise our hash it shows
            // its #fallbackPage ("Page not found") on top of ours. Same can
            // happen if the SPA re-renders any other .page mid-navigation.
            // While a Cypherflix route is active, keep every non-Cypherflix
            // page hidden — the per-element class guard makes this self-
            // stabilising (no mutations once they're all hidden).
            const route = ROUTES[window.location.hash];
            const container = document.getElementById(CONTAINER_ID);
            if (route && container) {
                if (container.classList.contains('hide')) {
                    showOurPage(container);
                }
                document.querySelectorAll('.page:not(.cypherflixPage)').forEach((p) => {
                    if (!p.classList.contains('hide')) {
                        p.dataset.cfHidden = '1';
                        p.classList.add('hide');
                    }
                });
                // Override Jellyfin's "Page not found" header — its router sets
                // both the document title and the .pageTitle element when our
                // hash doesn't match a Jellyfin route. Re-apply each tick so
                // we win the race.
                const wantTitle = 'Cypherflix ' + route.title;
                if (document.title !== wantTitle) document.title = wantTitle;
                document.querySelectorAll('.pageTitle').forEach((el) => {
                    if (el.textContent !== route.title) el.textContent = route.title;
                });
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
