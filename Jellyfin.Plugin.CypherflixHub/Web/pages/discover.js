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

// Cover-only card. Title / metadata / CTA live in an overlay that's
// invisible until hover/focus/touch.
function renderCard(item) {
    const titleParts = [];
    if (item.series_name) titleParts.push(item.series_name);
    if (item.issue_number) titleParts.push('#' + item.issue_number);
    const title = titleParts.join(' ') || item.title || '(untitled)';

    const subtitle = item.authors
        ? item.authors
        : (item.title && item.title !== item.series_name ? item.title : '');

    const meta = [];
    if (item.year)         meta.push(escapeHtml(String(item.year)));
    if (item.release_date) meta.push(escapeHtml(fmtDate(item.release_date)));

    const summary = item.summary
        ? escapeHtml(item.summary.slice(0, 200)) + (item.summary.length > 200 ? '…' : '')
        : '';

    const poster = item.cover_url
        ? '<img src="' + escapeHtml(item.cover_url) + '" alt="" loading="lazy" />'
        : '<div class="cf-d-poster-placeholder"><span class="material-icons">' + kindIcon(item.kind) + '</span></div>';

    // v3.0.1 — persistent indicators slot. Always present in the DOM so the
    // event-driven re-render just toggles `hidden` rather than rebuilding
    // the card. State is applied by _refreshCardState after follow_state
    // resolves; first paint shows nothing if state hasn't loaded yet, then
    // upgrades on the next event tick.
    const indicators = `
        <div class="cf-d-card-indicators" hidden>
            <div class="cf-d-card-indicator cf-d-card-indicator-star" title="Following" hidden>
                <span class="material-icons">star</span>
            </div>
            <div class="cf-d-card-indicator cf-d-card-indicator-queued" title="Queued" hidden>
                <span class="material-icons">check</span>
            </div>
            <div class="cf-d-card-indicator cf-d-card-indicator-downloaded" title="Downloaded" hidden>
                <span class="material-icons">check</span>
            </div>
        </div>`;

    // v3.0: secondary "+ Follow" link in the hover overlay. The discover-item
    // shape carries a watchlist_payload that names the relevant author or
    // series; the link copy reflects that target. Falls back to no link when
    // the item doesn't expose a follow target.
    const wp = item.watchlist_payload;
    const followLabel = wp && wp.display_name
        ? (wp.kind === 'book_author' ? 'Follow ' + wp.display_name :
           wp.kind === 'book_series' ? 'Follow series' :
           wp.kind === 'comic_series' ? 'Follow ' + wp.display_name : 'Follow')
        : null;
    const followLink = followLabel
        ? '<button type="button" class="cf-d-card-follow"><span class="material-icons">add</span><span>' + escapeHtml(followLabel) + '</span></button>'
        : '';

    return `
        <div class="cf-d-card ${aspectClassFor(item.kind)}"
             data-source="${escapeHtml(item.source || '')}"
             data-source-id="${escapeHtml(item.source_id || '')}"
             data-kind="${escapeHtml(item.kind || '')}"
             tabindex="0">
            <div class="cf-d-card-poster">${poster}${indicators}</div>
            <div class="cf-d-card-overlay">
                <div class="cf-d-card-overlay-grad"></div>
                <div class="cf-d-card-overlay-body">
                    <div class="cf-d-card-title">${escapeHtml(title)}</div>
                    ${subtitle ? '<div class="cf-d-card-subtitle">' + escapeHtml(subtitle) + '</div>' : ''}
                    ${meta.length ? '<div class="cf-d-card-meta">' + meta.join(' · ') + '</div>' : ''}
                    ${summary ? '<div class="cf-d-card-summary">' + summary + '</div>' : ''}
                    <div class="cf-d-card-actions">
                        <button class="cf-d-card-cta">
                            <span class="material-icons">add</span>
                            <span>Queue</span>
                        </button>
                        ${followLink}
                    </div>
                </div>
            </div>
        </div>`;
}

/** Apply current follow_state to a card's indicators + Queue button visibility. */
function _refreshCardState(card, fs) {
    let item = null;
    try { item = JSON.parse(card.dataset.payload || '{}'); } catch (_) {}
    if (!item) return;

    const indContainer = card.querySelector('.cf-d-card-indicators');
    const star = card.querySelector('.cf-d-card-indicator-star');
    const queuedDot = card.querySelector('.cf-d-card-indicator-queued');
    const downloadedDot = card.querySelector('.cf-d-card-indicator-downloaded');
    const queueBtn = card.querySelector('.cf-d-card-cta');
    const followLink = card.querySelector('.cf-d-card-follow');

    const isFollowed = fs.isFollowing(item.watchlist_payload);
    const queueState = fs.getQueueState(item);

    if (star) star.hidden = !isFollowed;
    if (queuedDot) queuedDot.hidden = queueState !== 'queued';
    if (downloadedDot) downloadedDot.hidden = queueState !== 'downloaded';
    if (indContainer) {
        indContainer.hidden = !(isFollowed || queueState !== 'none');
    }

    // Queue button vanishes once queued (any state). The space simply
    // collapses — no jumping; Follow link reflows naturally.
    if (queueBtn) queueBtn.hidden = (queueState !== 'none');

    // Follow link visual state mirrors star.
    if (followLink) {
        if (isFollowed) {
            followLink.classList.add('cf-d-card-follow-active');
            const labelSpan = followLink.querySelectorAll('span')[1];
            if (labelSpan) labelSpan.textContent = 'Following';
        } else {
            followLink.classList.remove('cf-d-card-follow-active');
        }
    }
}

function skeletonCard(aspectClass) {
    return `
        <div class="cf-d-card cf-d-card-skeleton ${aspectClass}">
            <div class="cf-d-card-poster cf-q-skeleton-shimmer"></div>
        </div>`;
}

// v3.1 — recon-matched native carousel structure. Recon against jellyfin-web's
// itemDetails template confirmed the exact pattern:
//   <div class="verticalSection detailVerticalSection ...">
//     <h2 class="sectionTitle sectionTitle-cards padded-right">TITLE</h2>
//     <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale no-padding" data-centerfocus="true">
//       <div is="emby-itemscontainer" class="scrollSlider focuscontainer-x itemsContainer">
//         <!-- cards -->
//       </div>
//     </div>
//   </div>
function renderCategoryRow(cat) {
    return `
        <div class="verticalSection detailVerticalSection cf-d-row" data-row-id="${escapeHtml(cat.id)}">
            <h2 class="sectionTitle sectionTitle-cards padded-left padded-right">
                <span class="cf-d-row-title">${escapeHtml(cat.title)}</span>
                <span class="cf-d-row-status"></span>
            </h2>
            <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale no-padding" data-centerfocus="true">
                <div is="emby-itemscontainer" class="scrollSlider focuscontainer-x itemsContainer">
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

    // v3.0: delegated click handler covers Queue button, Follow link, and
    // click-to-detail-page (clicking the card body anywhere away from the
    // action buttons opens the Item Detail modal). All three live on the
    // .cf-d-card surface so one listener handles the lot.
    root.addEventListener('click', async (e) => {
        const queueBtn = e.target.closest('.cf-d-card-cta');
        if (queueBtn) {
            const card = queueBtn.closest('.cf-d-card[data-source-id]');
            if (card) await handleAddToQueue(card, msg);
            e.stopPropagation();
            return;
        }
        const followBtn = e.target.closest('.cf-d-card-follow');
        if (followBtn) {
            const card = followBtn.closest('.cf-d-card[data-source-id]');
            if (!card) return;
            try {
                const item = JSON.parse(card.dataset.payload || '{}');
                await handleFollow(card, item.watchlist_payload);
            } catch (_) { /* ignore */ }
            e.stopPropagation();
            return;
        }
        const card = e.target.closest('.cf-d-card[data-source-id]');
        if (card) {
            // v3.1: navigate to the standalone detail route. The bootstrap
            // hashchange hook mounts the page into the active .libraryPage
            // and Jellyfin's back button restores the previous tab+scroll.
            const kind = card.dataset.kind;
            const sourceId = card.dataset.sourceId;
            if (kind && sourceId) {
                window.location.hash =
                    '#/cypherflix/details?kind=' + encodeURIComponent(kind) +
                    '&source_id=' + encodeURIComponent(sourceId);
            }
        }
    });
}
