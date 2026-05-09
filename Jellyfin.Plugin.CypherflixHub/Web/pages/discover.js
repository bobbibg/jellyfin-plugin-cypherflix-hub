// Discover view — Jellyseerr-style home page.
// Full-width horizontal carousels per category. Each card shows JUST
// the cover by default; hover/touch reveals title + year + author/
// summary + Add-to-Queue button via a vertical gradient overlay.
//
// Anchor div class stays .sections.cypherflix-discover.
// Sub-tabs are gone — search lives inline at the top; when active, it
// replaces the category list with a result grid.

let api;

const PAGE_SIZE = 24;

const CATEGORIES = [
    { id: 'trending-books',  title: 'Trending Books',  loader: () => api.discoverTrending('book',  30) },
    { id: 'trending-comics', title: 'Trending Comics', loader: () => api.discoverTrending('comic', 30) },
    { id: 'coming-soon',     title: 'Coming Soon',     loader: () => api.discoverComingSoon(30) },
    // Movies / TV / anime / manga rows light up once those clients land
    // server-side (see docs/plans/movies-tv-integration.md). Until then
    // we don't render empty-state placeholders for them — the home page
    // stays clean.
];

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

// --- toast ----------------------------------------------------------------
// Jellyfin-native bottom-center snackbar. Tries the RequireJS-bundled
// toast module first (how IntroSkipper / Send-to-Kindle do it) and
// falls back to a self-rendered #323232 snackbar matching Jellyfin's
// native style. 3.5s auto-dismiss with fade.

function showToast(message) {
    if (typeof window.require === 'function') {
        try {
            window.require(['toast'], function (toast) {
                if (typeof toast === 'function') toast(message);
                else if (toast && typeof toast.default === 'function') toast.default(message);
                else if (toast && typeof toast.show === 'function') toast.show(message);
                else renderFallbackToast(message);
            }, function () { renderFallbackToast(message); });
            return;
        } catch (_) { /* fall through */ }
    }
    renderFallbackToast(message);
}

function renderFallbackToast(message) {
    let host = document.getElementById('cypherflixToastHost');
    if (!host) {
        host = document.createElement('div');
        host.id = 'cypherflixToastHost';
        host.style.cssText =
            'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
            'z-index:10000;display:flex;flex-direction:column;gap:8px;align-items:center;' +
            'pointer-events:none;';
        document.body.appendChild(host);
    }
    const toast = document.createElement('div');
    toast.style.cssText =
        'background:#323232;color:#fff;padding:0.85em 1.4em;border-radius:4px;' +
        'box-shadow:0 3px 5px rgba(0,0,0,0.3);font-size:0.95em;' +
        'opacity:0;transition:opacity 200ms ease-in;';
    toast.textContent = message;
    host.appendChild(toast);
    window.requestAnimationFrame(() => { toast.style.opacity = '1'; });
    window.setTimeout(() => {
        toast.style.opacity = '0';
        window.setTimeout(() => toast.remove(), 250);
    }, 3500);
}

function fmtDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString(); } catch (_) { return s; }
}

function kindIcon(kind) {
    if (kind === 'book')         return 'menu_book';
    if (kind === 'comic_issue')  return 'auto_stories';
    if (kind === 'comic_series') return 'auto_stories';
    if (kind === 'movie')        return 'movie';
    if (kind === 'tv_episode')   return 'tv';
    return 'collections_bookmark';
}

function aspectClassFor(kind) {
    if (kind === 'movie' || kind === 'tv_episode' || kind === 'anime_episode') return 'cf-d-poster-landscape';
    return 'cf-d-poster-portrait';
}

// v3.1.1 — cards use Jellyfin's EXACT native markup so the active theme
// styles them for free. Class chain confirmed against a live home-page
// render via Chrome devtools (the recon DOM-walk):
//
//   div.card.overflowPortraitCard.card-hoverable
//     div.cardBox.cardBox-bottompadded
//       div.cardScalable
//         div.cardPadder.cardPadder-overflowPortrait
//           [optional] span.cardImageIcon.material-icons.<kindIcon>   ← placeholder when no cover_url
//         a.cardImageContainer.coveredImage.cardContent.itemAction.lazy
//             style="background-image:url(<cover>)"                   ← Jellyfin paints covers as bg-image
//             div.cardIndicators                                      ← persistent star / tick badges
//         div.cardOverlayContainer.itemAction
//           div.cardOverlayButton-br.flex
//             button[is=paper-icon-button-light].cardOverlayButton.cardOverlayButton-hover  ← Queue FAB
//               span.material-icons.cardOverlayButtonIcon.cardOverlayButtonIcon-hover.add
//       div.cardFooter
//         div.cardText.cardText-first
//         div.cardText.cardText-secondary
//
// We don't add custom CSS for any of these — Jellyfin's stylesheet
// handles every visual aspect (hover scale, bottom padding, footer text
// styles, hover overlay reveal). Only the indicator badges have custom
// styling, since those are our addition.
function renderCard(item) {
    const titleParts = [];
    if (item.series_name) titleParts.push(item.series_name);
    if (item.issue_number) titleParts.push('#' + item.issue_number);
    const title = titleParts.join(' ') || item.title || '(untitled)';

    let secondary = '';
    if (item.year)        secondary = String(item.year);
    else if (item.authors) secondary = item.authors.split(',')[0].trim();

    const aspectClass    = aspectClassFor(item.kind);
    const isLandscape    = aspectClass === 'cf-d-poster-landscape';
    // Native uses cardPadder-overflowPortrait for the home-page overflow
    // rows (different from cardPadder-portrait used inside detail pages).
    const wrapperCardCls = isLandscape ? 'overflowBackdropCard'         : 'overflowPortraitCard';
    const padderCls      = isLandscape ? 'cardPadder-overflowBackdrop'  : 'cardPadder-overflowPortrait';

    // Native paints covers as a CSS background-image on the cardImageContainer
    // <a> rather than via <img>. Falls back to a cardImageIcon glyph inside
    // the cardPadder when there's no cover (matches how Jellyfin shows
    // unknown-item placeholders).
    const padderInner = item.cover_url
        ? ''
        : `<span class="cardImageIcon material-icons ${kindIcon(item.kind)}" aria-hidden="true"></span>`;
    const coverStyle = item.cover_url
        ? ` style="background-image:url('${escapeHtml(item.cover_url)}')"`
        : '';

    // Indicators wrap in native's .cardIndicators slot (top-right corner of
    // the cover) — Jellyfin already positions this for us. Inner .indicator
    // class gives us the rounded-pill look; per-state colour comes from a
    // small custom modifier.
    const indicators = `
        <div class="cardIndicators cf-d-card-indicators" hidden>
            <div class="indicator cf-d-card-indicator-star" title="Following" hidden>
                <span class="material-icons star" aria-hidden="true"></span>
            </div>
            <div class="indicator cf-d-card-indicator-queued" title="Queued" hidden>
                <span class="material-icons check" aria-hidden="true"></span>
            </div>
            <div class="indicator cf-d-card-indicator-downloaded" title="Downloaded" hidden>
                <span class="material-icons check" aria-hidden="true"></span>
            </div>
        </div>`;

    // Native hover overlay — same shape as the home page's hover-reveal
    // (paper-icon-button-light, .cardOverlayButton-hover, sitting in the
    // .cardOverlayButton-br.flex bottom-row cluster). Just our `add` icon
    // instead of native's `play_arrow`.
    const queueFab = `
        <div class="cardOverlayContainer itemAction">
            <div class="cardOverlayButton-br flex">
                <button is="paper-icon-button-light" type="button"
                        class="cardOverlayButton cardOverlayButton-hover paper-icon-button-light cf-d-card-queue-fab"
                        title="Queue this">
                    <span class="material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover add" aria-hidden="true"></span>
                </button>
            </div>
        </div>`;

    return `
        <div class="card ${wrapperCardCls} card-hoverable cf-d-card"
             data-source="${escapeHtml(item.source || '')}"
             data-source-id="${escapeHtml(item.source_id || '')}"
             data-kind="${escapeHtml(item.kind || '')}"
             tabindex="0">
            <div class="cardBox cardBox-bottompadded">
                <div class="cardScalable">
                    <div class="cardPadder ${padderCls}">
                        ${padderInner}
                    </div>
                    <a class="cardImageContainer coveredImage cardContent itemAction lazy"
                       href="#/cypherflix/details?kind=${encodeURIComponent(item.kind || '')}&source_id=${encodeURIComponent(item.source_id || '')}"
                       ${coverStyle}>
                        ${indicators}
                    </a>
                    ${queueFab}
                </div>
                <div class="cardFooter">
                    <div class="cardText cardText-first" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                    ${secondary ? '<div class="cardText cardText-secondary">' + escapeHtml(secondary) + '</div>' : ''}
                </div>
            </div>
        </div>`;
}

/** Apply current follow_state to a card's persistent indicators + Queue
 *  FAB visibility. v3.1.1 dropped the per-card Follow link entirely; the
 *  Follow action lives on the detail page only. */
function _refreshCardState(card, fs) {
    let item = null;
    try { item = JSON.parse(card.dataset.payload || '{}'); } catch (_) {}
    if (!item) return;

    const indContainer  = card.querySelector('.cf-d-card-indicators');
    const star          = card.querySelector('.cf-d-card-indicator-star');
    const queuedDot     = card.querySelector('.cf-d-card-indicator-queued');
    const downloadedDot = card.querySelector('.cf-d-card-indicator-downloaded');
    const queueFab      = card.querySelector('.cf-d-card-queue-fab');

    const isFollowed = fs.isFollowing(item.watchlist_payload);
    const queueState = fs.getQueueState(item);

    if (star) star.hidden = !isFollowed;
    if (queuedDot) queuedDot.hidden = queueState !== 'queued';
    if (downloadedDot) downloadedDot.hidden = queueState !== 'downloaded';
    if (indContainer) {
        indContainer.hidden = !(isFollowed || queueState !== 'none');
    }

    // Queue FAB hides once queued — native pattern: the resume FAB
    // disappears once the item is fully played. Same idea here.
    if (queueFab) queueFab.hidden = (queueState !== 'none');
}

function skeletonCard(aspectClass) {
    // Skeleton uses the same native .card chain so dimensions match real
    // cards perfectly and we get the same scroll-snap behaviour. The
    // shimmer lives on the cardImageContainer.
    const isLandscape = aspectClass === 'cf-d-poster-landscape';
    const wrapper = isLandscape ? 'overflowBackdropCard'        : 'overflowPortraitCard';
    const padder  = isLandscape ? 'cardPadder-overflowBackdrop' : 'cardPadder-overflowPortrait';
    return `
        <div class="card ${wrapper} cf-d-card-skeleton">
            <div class="cardBox cardBox-bottompadded">
                <div class="cardScalable">
                    <div class="cardPadder ${padder}"></div>
                    <div class="cardImageContainer coveredImage cardContent cf-q-skeleton-shimmer"></div>
                </div>
                <div class="cardFooter">
                    <div class="cardText cardText-first cf-q-skeleton-shimmer" style="height:14px"></div>
                </div>
            </div>
        </div>`;
}

// v3.1.1 — recon against the live home page (Chrome devtools DOM walk)
// confirmed the exact home-row markup:
//
//   div.verticalSection.emby-scroller-container
//     div.sectionTitleContainer.sectionTitleContainer-cards.padded-left
//       h2.sectionTitle.sectionTitle-cards   (no padding classes — wrapper has them)
//     div[is=emby-scroller].padded-top-focusscale.padded-bottom-focusscale.emby-scroller
//         data-centerfocus="true" data-scroll-mode-x="custom"
//       div[is=emby-itemscontainer].itemsContainer.scrollSlider.focuscontainer-x.animatedScrollX
//
// We previously had `.no-padding` on the scroller (which prevented the
// horizontal padding native depends on for proper edge alignment) and
// were missing `.emby-scroller-container`, `.sectionTitleContainer*`,
// `.animatedScrollX`, and `data-scroll-mode-x="custom"`. Fixed.
function renderCategoryRow(cat) {
    return `
        <div class="verticalSection emby-scroller-container cf-d-row" data-row-id="${escapeHtml(cat.id)}">
            <div class="sectionTitleContainer sectionTitleContainer-cards padded-left">
                <h2 class="sectionTitle sectionTitle-cards">
                    <span class="cf-d-row-title">${escapeHtml(cat.title)}</span>
                    <span class="cf-d-row-status"></span>
                </h2>
            </div>
            <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale emby-scroller"
                 data-centerfocus="true" data-scroll-mode-x="custom">
                <div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x animatedScrollX">
                    ${Array(8).fill(skeletonCard('cf-d-poster-portrait')).join('')}
                </div>
            </div>
        </div>`;
}

// v3.1: scroll/arrow behaviour now comes from Jellyfin's native
// emby-scroller / emby-itemscontainer web components. No custom JS needed —
// these are no-op shims kept so older callers don't crash.
function updateRowArrows(_rowEl) { /* native emby-scroller handles this */ }
function attachRowArrows(_rowEl) { /* native emby-scroller handles this */ }

async function loadCategoryRow(rowEl, cat, msg) {
    const scroller = rowEl.querySelector('.itemsContainer');
    const status = rowEl.querySelector('.cf-d-row-status');
    try {
        const data = await cat.loader();
        const items = (data && (data.items || [])) || [];
        if (!items.length) {
            scroller.innerHTML = '<div class="cf-d-row-empty">Nothing here yet.</div>';
            status.textContent = '0';
            return;
        }
        scroller.innerHTML = items.map(renderCard).join('');
        scroller.querySelectorAll('.cf-d-card[data-source-id]').forEach((card, i) => {
            try { card.dataset.payload = JSON.stringify(items[i]); } catch (_) {}
        });
        status.textContent = items.length + (items.length === 1 ? ' item' : ' items');
        // Mark cards whose author/series the user already follows.
        try {
            const cb2 = '?cb=' + Date.now();
            const fs = await import('./follow_state.js' + cb2);
            scroller.querySelectorAll('.cf-d-card[data-source-id]').forEach((c) =>
                _refreshCardState(c, fs));
        } catch (_) {}
        // Refresh arrow disabled state once content has rendered
        requestAnimationFrame(() => updateRowArrows(rowEl));
    } catch (err) {
        scroller.innerHTML = '<div class="cf-d-row-empty">Error: ' + escapeHtml(err.message || String(err)) + '</div>';
        if (msg) msg.textContent = 'Error loading "' + cat.title + '": ' + (err.message || String(err));
    }
}

// --- Add-to-Queue ---------------------------------------------------------
//
// v3.0: Queue is now strictly per-item — clicking the button creates a
// `requests` row for that specific book / comic issue and fires the
// searcher on it immediately. The author/series follow concept is
// available as a separate hover-overlay link and from the Item Detail
// page.

function _buildQueuePayload(item) {
    // Prefer the server-supplied queue_payload when present (Item Detail
    // endpoint provides it). Discover trending/search items don't yet, so
    // fall back to deriving from the discover-item shape.
    if (item.queue_payload) return item.queue_payload;

    if (item.kind === 'book' && item.source === 'hardcover') {
        return {
            kind: 'book',
            series_name: item.series_name || item.title,
            title: item.title,
            hardcover_book_id: parseInt(item.source_id, 10),
            series_year: item.year || undefined,
            authors: item.authors || undefined,
            release_date: item.release_date || undefined,
        };
    }
    if (item.kind === 'comic_issue' && item.source === 'comicvine') {
        return {
            kind: 'comic_issue',
            series_name: item.series_name || item.title,
            title: item.title,
            comicvine_issue_id: parseInt(item.source_id, 10),
            issue_number: item.issue_number || undefined,
            series_year: item.year || undefined,
            release_date: item.release_date || undefined,
        };
    }
    return null;
}

async function handleAddToQueue(card, msg) {
    let item;
    try { item = JSON.parse(card.dataset.payload || '{}'); }
    catch (_) { item = {}; }

    const title = item.title || (item.watchlist_payload && item.watchlist_payload.display_name) || 'item';
    const body  = _buildQueuePayload(item);
    if (!body) {
        showToast(`Can't queue ${title} — missing identifier.`);
        return;
    }
    try {
        const res = await api.queueAdd(body);
        const existed = res && res.existed === true;
        showToast(existed ? `Already in your queue: ${title}` : `Queued: ${title}`);
        // Update central state — dispatches cypherflix:queued; the listener
        // hides the Queue button on this AND every other card pointing at
        // the same source_id.
        const cb = '?cb=' + Date.now();
        const fs = await import('./follow_state.js' + cb);
        fs.markQueued(item, res && res.status ? res.status : 'wanted');
        if (msg) msg.textContent = '';
    } catch (err) {
        const m = String(err && err.message || err);
        showToast(`Couldn't queue ${title}: ${m}`);
        if (msg) msg.textContent = '';
    }
}

async function handleFollow(card, target) {
    if (!target) return;
    const name = target.display_name || 'this';
    try {
        const res = await api.createFollowing(target);
        const existed = res && res.existed === true;
        showToast(existed ? `Already following: ${name}` : `Following: ${name}`);
        // Update central state + dispatch event so every other visible card
        // by the same author/series re-renders its Follow link.
        const cb = '?cb=' + Date.now();
        const fs = await import('./follow_state.js' + cb);
        fs.markFollowed(target);
    } catch (err) {
        const m = String(err && err.message || err);
        showToast(`Couldn't follow ${name}: ${m}`);
    }
}

function _refreshCardFollowState(card, isFollowingFn) {
    const link = card.querySelector('.cf-d-card-follow');
    if (!link) return;
    let payload = null;
    try { payload = JSON.parse(card.dataset.payload || '{}').watchlist_payload; } catch (_) {}
    if (!payload) return;
    if (isFollowingFn(payload)) {
        link.classList.add('cf-d-card-follow-active');
        // Replace the inner text node only, preserve the icon span.
        const labelSpan = link.querySelectorAll('span')[1];
        if (labelSpan) labelSpan.textContent = 'Following';
    } else {
        link.classList.remove('cf-d-card-follow-active');
    }
}

function markQueued(btn, label) {
    if (!btn) return;
    btn.innerHTML = '<span class="material-icons">check</span><span>' + label + '</span>';
    btn.disabled = true;
    btn.classList.add('cf-d-card-cta-queued');
}

// --- search ---------------------------------------------------------------

async function runSearch(host, query, kind, msg) {
    if (!query) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = '<div class="cf-d-search-grid">' +
        Array(8).fill(skeletonCard('cf-d-poster-portrait')).join('') +
        '</div>';
    try {
        const data = await api.discoverSearch(query, kind || undefined, 60);
        const items = (data && data.items) || [];
        if (!items.length) {
            host.innerHTML = '<div class="cf-d-row-empty">No results for "' + escapeHtml(query) + '".</div>';
            return;
        }
        const grid = document.createElement('div');
        grid.className = 'cf-d-search-grid';
        grid.innerHTML = items.map(renderCard).join('');
        grid.querySelectorAll('.cf-d-card[data-source-id]').forEach((card, i) => {
            try { card.dataset.payload = JSON.stringify(items[i]); } catch (_) {}
        });
        host.innerHTML = '';
        host.appendChild(grid);
        try {
            const cb = '?cb=' + Date.now();
            const fs = await import('./follow_state.js' + cb);
            grid.querySelectorAll('.cf-d-card[data-source-id]').forEach((c) =>
                _refreshCardState(c, fs));
        } catch (_) {}
    } catch (err) {
        host.innerHTML = '<div class="cf-d-row-empty">Error: ' + escapeHtml(err.message || String(err)) + '</div>';
    }
}

// --- entry point ----------------------------------------------------------

export async function render(root) {
    const _cb = '?cb=' + Date.now();
    ({ api } = await import('./api.js' + _cb));

    // v3.0.1: prime the follow-state cache so cards render their Follow link
    // pre-marked when the user already follows the target. Fire-and-forget —
    // if it hasn't loaded by render time, cards re-mark on the next event.
    const followState = await import('./follow_state.js' + _cb);
    followState.loadFollowing();

    // Re-render Follow chips on every visible card whenever the central
    // state flips. Covers: initial load resolve, follow from a peer card,
    // follow from the Item Detail modal.
    document.addEventListener('cypherflix:followed', () => {
        root.querySelectorAll('.cf-d-card[data-source-id]').forEach((c) =>
            _refreshCardFollowState(c, followState.isFollowing));
    });
    document.addEventListener('cypherflix:unfollowed', () => {
        root.querySelectorAll('.cf-d-card[data-source-id]').forEach((c) =>
            _refreshCardFollowState(c, followState.isFollowing));
    });

    root.classList.add('cf-host', 'cf-discover-host');
    root.innerHTML = `
        <div class="cf-glass-backdrop"></div>
        <div class="cf-d-search-bar">
            <span class="material-icons cf-d-search-icon">search</span>
            <input type="search" class="cf-d-search-input" placeholder="Search books and comics…" autocomplete="off" />
            <select class="cf-styled-select cf-d-search-kind">
                <option value="">All</option>
                <option value="book">Books</option>
                <option value="comic">Comics</option>
            </select>
        </div>
        <div class="cf-d-status-msg"></div>
        <div class="cf-d-search-results"></div>
        <div class="cf-d-rows">
            ${CATEGORIES.map(renderCategoryRow).join('')}
        </div>`;

    const $ = (s) => root.querySelector(s);
    const msg          = $('.cf-d-status-msg');
    const searchInput  = $('.cf-d-search-input');
    const searchKind   = $('.cf-d-search-kind');
    const searchHost   = $('.cf-d-search-results');
    const rowsHost     = $('.cf-d-rows');

    // load each category in parallel; row stays skeleton until its data lands
    CATEGORIES.forEach((cat) => {
        const rowEl = root.querySelector('[data-row-id="' + cat.id + '"]');
        if (!rowEl) return;
        attachRowArrows(rowEl);
        void loadCategoryRow(rowEl, cat, msg);
    });

    // search — debounced; when active hide the category rows
    let searchDebounce;
    let lastQuery = '';
    function triggerSearch() {
        const q = (searchInput.value || '').trim();
        if (q === lastQuery) return;
        lastQuery = q;
        if (!q) {
            searchHost.innerHTML = '';
            rowsHost.style.display = '';
            return;
        }
        rowsHost.style.display = 'none';
        void runSearch(searchHost, q, searchKind.value, msg);
    }
    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(triggerSearch, 350);
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchDebounce); triggerSearch(); }
        if (e.key === 'Escape') { searchInput.value = ''; clearTimeout(searchDebounce); triggerSearch(); }
    });
    searchKind.addEventListener('change', () => { lastQuery = ''; triggerSearch(); });

    // v3.1.1: navigation is now driven by the native <a class="cardImageContainer"
    // href="#/cypherflix/details?..."> on each card — clicks on the cover
    // simply trigger the browser's hashchange and our bootstrap router
    // mounts the detail page. We only need to intercept the Queue FAB
    // (preventDefault + stopPropagation, otherwise the surrounding <a>
    // would also navigate).
    root.addEventListener('click', async (e) => {
        const queueBtn = e.target.closest('.cf-d-card-queue-fab');
        if (queueBtn) {
            e.preventDefault();
            e.stopPropagation();
            const card = queueBtn.closest('.cf-d-card[data-source-id]');
            if (card) await handleAddToQueue(card, msg);
            return;
        }
        // v3.1.1: card-body navigation is handled by the native <a class="cardImageContainer"
        // href="#/cypherflix/details?..."> on each card — the browser fires
        // hashchange and bootstrap mounts the detail page. No manual handler
        // needed.
    });
}
