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

    return `
        <div class="cf-d-card ${aspectClassFor(item.kind)}"
             data-source="${escapeHtml(item.source || '')}"
             data-source-id="${escapeHtml(item.source_id || '')}"
             tabindex="0">
            <div class="cf-d-card-poster">${poster}</div>
            <div class="cf-d-card-overlay">
                <div class="cf-d-card-overlay-grad"></div>
                <div class="cf-d-card-overlay-body">
                    <div class="cf-d-card-title">${escapeHtml(title)}</div>
                    ${subtitle ? '<div class="cf-d-card-subtitle">' + escapeHtml(subtitle) + '</div>' : ''}
                    ${meta.length ? '<div class="cf-d-card-meta">' + meta.join(' · ') + '</div>' : ''}
                    ${summary ? '<div class="cf-d-card-summary">' + summary + '</div>' : ''}
                    <button class="cf-d-card-cta">
                        <span class="material-icons">add</span>
                        <span>Add to Queue</span>
                    </button>
                </div>
            </div>
        </div>`;
}

function skeletonCard(aspectClass) {
    return `
        <div class="cf-d-card cf-d-card-skeleton ${aspectClass}">
            <div class="cf-d-card-poster cf-q-skeleton-shimmer"></div>
        </div>`;
}

function renderCategoryRow(cat) {
    return `
        <section class="cf-d-row" data-row-id="${escapeHtml(cat.id)}">
            <header class="cf-d-row-header">
                <h2 class="cf-d-row-title">${escapeHtml(cat.title)}</h2>
                <span class="cf-d-row-status"></span>
            </header>
            <div class="cf-d-row-viewport">
                <button type="button" class="cf-d-row-arrow cf-d-row-arrow-left disabled" aria-label="Scroll left">
                    <span class="material-icons">chevron_left</span>
                </button>
                <div class="cf-d-row-scroller">
                    ${Array(8).fill(skeletonCard('cf-d-poster-portrait')).join('')}
                </div>
                <button type="button" class="cf-d-row-arrow cf-d-row-arrow-right" aria-label="Scroll right">
                    <span class="material-icons">chevron_right</span>
                </button>
            </div>
        </section>`;
}

function updateRowArrows(rowEl) {
    const scroller = rowEl.querySelector('.cf-d-row-scroller');
    const left  = rowEl.querySelector('.cf-d-row-arrow-left');
    const right = rowEl.querySelector('.cf-d-row-arrow-right');
    if (!scroller || !left || !right) return;
    const atStart = scroller.scrollLeft <= 4;
    const atEnd   = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
    left.classList.toggle('disabled', atStart);
    right.classList.toggle('disabled', atEnd);
}

function attachRowArrows(rowEl) {
    const scroller = rowEl.querySelector('.cf-d-row-scroller');
    const left  = rowEl.querySelector('.cf-d-row-arrow-left');
    const right = rowEl.querySelector('.cf-d-row-arrow-right');
    if (!scroller || !left || !right) return;
    const step = () => Math.max(scroller.clientWidth * 0.85, 200);
    left .addEventListener('click', () => scroller.scrollBy({ left: -step(), behavior: 'smooth' }));
    right.addEventListener('click', () => scroller.scrollBy({ left:  step(), behavior: 'smooth' }));
    scroller.addEventListener('scroll', () => updateRowArrows(rowEl), { passive: true });
    requestAnimationFrame(() => updateRowArrows(rowEl));
}

async function loadCategoryRow(rowEl, cat, msg) {
    const scroller = rowEl.querySelector('.cf-d-row-scroller');
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
        // Refresh arrow disabled state once content has rendered
        requestAnimationFrame(() => updateRowArrows(rowEl));
    } catch (err) {
        scroller.innerHTML = '<div class="cf-d-row-empty">Error: ' + escapeHtml(err.message || String(err)) + '</div>';
        if (msg) msg.textContent = 'Error loading "' + cat.title + '": ' + (err.message || String(err));
    }
}

// --- Add-to-Queue ---------------------------------------------------------

async function handleAddToQueue(card, msg) {
    let item;
    try { item = JSON.parse(card.dataset.payload || '{}'); }
    catch (_) { item = {}; }
    if (!item.watchlist_payload) {
        msg.textContent = 'No watchlist payload on this item.';
        return;
    }
    const body = { kind: item.watchlist_kind, ...item.watchlist_payload };
    const btn = card.querySelector('.cf-d-card-cta');
    try {
        await api.createWatchlist(body);
        msg.textContent = 'Added to queue.';
        markQueued(btn, 'Queued');
    } catch (err) {
        // Duplicate watchlist entry - the grabber returns 409. Treat as
        // visual success since the user's intent is already true.
        const m = String(err && err.message || err);
        if (m.includes('409') || /already|duplicate|exists/i.test(m)) {
            msg.textContent = 'Already in your queue.';
            markQueued(btn, 'In queue');
        } else {
            msg.textContent = 'Error: ' + m;
        }
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
    } catch (err) {
        host.innerHTML = '<div class="cf-d-row-empty">Error: ' + escapeHtml(err.message || String(err)) + '</div>';
    }
}

// --- entry point ----------------------------------------------------------

export async function render(root) {
    ({ api } = await import('./api.js?cb=' + Date.now()));

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

    // Add-to-Queue delegated click handler — works for both category rows
    // and search-results grid since they share the .cf-d-card class.
    root.addEventListener('click', async (e) => {
        const btn = e.target.closest('.cf-d-card-cta');
        if (!btn) return;
        const card = btn.closest('.cf-d-card[data-source-id]');
        if (card) await handleAddToQueue(card, msg);
    });
}
