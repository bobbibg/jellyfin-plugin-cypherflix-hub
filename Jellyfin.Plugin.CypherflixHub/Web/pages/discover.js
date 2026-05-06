// Discover view — Seer-style browse over books + comics. Renders into a
// Custom Tab anchor div (.sections.cypherflix-discover). 3 sub-tabs:
// Trending / Coming Soon / Search.

let api;

const SUB_TABS = [
    { id: 'trending',   label: 'Trending'    },
    { id: 'comingSoon', label: 'Coming Soon' },
    { id: 'search',     label: 'Search'      },
];

const PAGE_SIZE = 24;

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
    return 'collections_bookmark';
}

function renderCard(item) {
    const titleParts = [];
    if (item.series_name) titleParts.push(item.series_name);
    if (item.issue_number) titleParts.push('#' + item.issue_number);
    const title = titleParts.join(' ') || item.title || '(untitled)';

    // Subtitle is the author when known. Falls back to the alt-title only
    // when no author info is available (rare for books, common for comics).
    const subtitle = item.authors
        ? '<div class="cf-card-subtitle">' + escapeHtml(item.authors) + '</div>'
        : (item.title && item.title !== item.series_name
            ? '<div class="cf-card-subtitle">' + escapeHtml(item.title) + '</div>'
            : '');

    const meta = [];
    if (item.year)         meta.push('<span class="movie-year">' + escapeHtml(String(item.year)) + '</span>');
    if (item.release_date) meta.push('<span class="movie-runtime"><span class="material-icons">event</span>' + escapeHtml(fmtDate(item.release_date)) + '</span>');

    const summary = item.summary
        ? '<div class="cf-card-summary">' + escapeHtml(item.summary.slice(0, 160)) + (item.summary.length > 160 ? '…' : '') + '</div>'
        : '';

    const poster = item.cover_url
        ? '<img src="' + escapeHtml(item.cover_url) + '" alt="" loading="lazy" />'
        : '<div class="movie-poster-placeholder"><span class="material-icons">' + kindIcon(item.kind) + '</span></div>';

    return `
        <div class="movie-card cf-card cf-card-${item.kind} cf-discover-card"
             data-source="${escapeHtml(item.source)}"
             data-source-id="${escapeHtml(item.source_id)}">
            <div class="movie-poster cf-portrait-poster">
                ${poster}
                <div class="movie-poster-overlay"></div>
            </div>
            <div class="movie-details">
                <div class="cf-card-body">
                    <h3 class="movie-title">${escapeHtml(title)}</h3>
                    ${subtitle}
                    <div class="movie-meta">${meta.join('')}</div>
                    ${summary}
                </div>
                <div class="movie-actions">
                    <button class="movie-action-btn cf-request-btn">
                        <span class="material-icons">add</span>
                        <span>Request</span>
                    </button>
                </div>
            </div>
        </div>`;
}

function skeletonGrid(count) {
    const card = `
        <div class="cf-skeleton-card">
            <div class="cf-skeleton-poster"></div>
            <div class="cf-skeleton-line line-title"></div>
            <div class="cf-skeleton-line line-sub"></div>
            <div class="cf-skeleton-line line-meta"></div>
        </div>`;
    return '<div class="cf-skeleton-grid">' + Array(count).fill(card).join('') + '</div>';
}

function renderEmpty(msg) {
    return '<div class="movie-history-empty-message"><div class="empty-message-icon"><span class="material-icons">explore</span></div><h3 class="empty-message-title">Nothing to show</h3><p class="empty-message-subtitle">' + escapeHtml(msg || '') + '</p></div>';
}

function renderLoading(_msg) {
    return skeletonGrid(PAGE_SIZE);
}

function renderError(err) {
    return '<div class="movie-history-empty-message"><div class="empty-message-icon"><span class="material-icons">error_outline</span></div><h3 class="empty-message-title">Error</h3><p class="empty-message-subtitle">' + escapeHtml(err.message || String(err)) + '</p></div>';
}

function renderPagination(page, totalPages, position) {
    if (totalPages <= 1) return '';
    const cls = position === 'top' ? 'pagination pagination-top' : 'pagination pagination-bottom';
    const btn = (label, target, disabled, active) => {
        const c = ['pagination-btn'];
        if (active) c.push('active');
        if (disabled) c.push('disabled');
        return `<button class="${c.join(' ')}" data-page="${target}"${disabled ? ' disabled' : ''}>${label}</button>`;
    };
    const pages = [];
    const window = 2;
    const start = Math.max(1, page - window);
    const end = Math.min(totalPages, page + window);
    if (start > 1) pages.push(1);
    if (start > 2) pages.push('…');
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < totalPages - 1) pages.push('…');
    if (end < totalPages) pages.push(totalPages);
    const pageHtml = pages.map(p =>
        p === '…' ? '<span class="pagination-ellipsis">…</span>' : btn(String(p), p, false, p === page)
    ).join('');
    return `
        <div class="${cls}">
            <div class="pagination-info">Page ${page} of ${totalPages}</div>
            <div class="pagination-controls">
                ${btn('<span class="material-icons">chevron_left</span>', page - 1, page <= 1)}
                <div class="pagination-pages">${pageHtml}</div>
                ${btn('<span class="material-icons">chevron_right</span>', page + 1, page >= totalPages)}
            </div>
        </div>`;
}

async function handleRequest(card, msg) {
    const item = JSON.parse(card.dataset.payload || '{}');
    if (!item.watchlist_payload) {
        msg.textContent = 'No watchlist payload on item.';
        return;
    }
    const body = { kind: item.watchlist_kind, ...item.watchlist_payload };
    try {
        await api.createWatchlist(body);
        msg.textContent = 'Added to watchlist.';
        const btn = card.querySelector('.cf-request-btn');
        if (btn) {
            btn.innerHTML = '<span class="material-icons">check</span><span>Requested</span>';
            btn.disabled = true;
            btn.classList.add('favorited');
        }
    } catch (err) {
        msg.textContent = 'Error: ' + (err.message || String(err));
    }
}

function setupPaginatedGrid(host, items, msg) {
    let page = 1;
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const grid     = host.querySelector('.cf-grid');
    const pagTop   = host.querySelector('.cf-pagination-top');
    const pagBot   = host.querySelector('.cf-pagination-bottom');

    function paint() {
        const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        grid.innerHTML = slice.length ? slice.map(renderCard).join('') : renderEmpty('Nothing here yet.');
        grid.querySelectorAll('.movie-card[data-source-id]').forEach((card, i) => {
            try { card.dataset.payload = JSON.stringify(slice[i]); } catch (_) {}
        });
        pagTop.innerHTML = renderPagination(page, totalPages, 'top');
        pagBot.innerHTML = renderPagination(page, totalPages, 'bottom');
    }

    [pagTop, pagBot].forEach((p) => {
        p.addEventListener('click', (e) => {
            const btn = e.target.closest('button.pagination-btn');
            if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
            const target = parseInt(btn.dataset.page, 10);
            if (!Number.isFinite(target)) return;
            page = target;
            paint();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    grid.addEventListener('click', async (e) => {
        const btn = e.target.closest('.cf-request-btn');
        if (!btn) return;
        const card = btn.closest('.movie-card[data-source-id]');
        if (card) await handleRequest(card, msg);
    });

    paint();
}

const SHELL = `
    <div class="cf-pagination-top"></div>
    <div class="paginated-container">
        <div class="movie-history-grid cf-card-grid cf-grid"></div>
    </div>
    <div class="cf-pagination-bottom"></div>`;

async function renderTrending(host, msg) {
    msg.textContent = '';
    host.innerHTML = `
        <div class="watchlist-header tab-header">
            <h2 class="cf-page-title">Trending</h2>
            <div class="watchlist-header-stats-container">
                <div class="watchlist-header-stats cf-stats-books">— books</div>
                <div class="watchlist-header-stats cf-stats-comics">— comics</div>
            </div>
        </div>
        <div class="cf-trending-row" data-row="books">
            <h3 class="sectionTitle sectionTitle-cards" style="margin: 1.2em 0 0.4em;">Trending Books</h3>
            ${SHELL}
        </div>
        <div class="cf-trending-row" data-row="comics">
            <h3 class="sectionTitle sectionTitle-cards" style="margin: 1.2em 0 0.4em;">Trending Comics</h3>
            ${SHELL}
        </div>`;

    // Seed both grids with skeletons immediately so the page doesn't
    // render as a hollow shell during the network round-trip.
    host.querySelector('[data-row="books"]  .cf-grid').innerHTML = skeletonGrid(8);
    host.querySelector('[data-row="comics"] .cf-grid').innerHTML = skeletonGrid(8);

    try {
        const [books, comics] = await Promise.all([
            api.discoverTrending('book', 30).catch(() => ({ items: [] })),
            api.discoverTrending('comic', 30).catch(() => ({ items: [] })),
        ]);
        const bItems = books.items || [];
        const cItems = comics.items || [];
        host.querySelector('.cf-stats-books').textContent  = bItems.length + ' books';
        host.querySelector('.cf-stats-comics').textContent = cItems.length + ' comics';
        setupPaginatedGrid(host.querySelector('[data-row="books"]'),  bItems,  msg);
        setupPaginatedGrid(host.querySelector('[data-row="comics"]'), cItems, msg);
        // Surface a hint when Hardcover isn't returning anything — usually
        // means HARDCOVER_API_TOKEN isn't set on the grabber container.
        if (!bItems.length) {
            const grid = host.querySelector('[data-row="books"] .cf-grid');
            grid.innerHTML = renderEmpty('No books from Hardcover. Set HARDCOVER_API_TOKEN on the grabber container — get a free token at hardcover.app/account/api.');
        }
    } catch (err) {
        host.innerHTML = renderError(err);
    }
}

async function renderComingSoon(host, msg) {
    msg.textContent = '';
    host.innerHTML = `
        <div class="watchlist-header tab-header">
            <h2 class="cf-page-title">Coming Soon — From Your Watchlist</h2>
            <div class="watchlist-header-stats-container">
                <div class="watchlist-header-stats cf-stats-total">— upcoming</div>
            </div>
        </div>
        ${SHELL}`;
    host.querySelector('.cf-grid').innerHTML = skeletonGrid(8);
    try {
        const data = await api.discoverComingSoon(60);
        const items = data.items || [];
        host.querySelector('.cf-stats-total').textContent = items.length + ' upcoming';
        setupPaginatedGrid(host, items, msg);
    } catch (err) {
        host.innerHTML = renderError(err);
    }
}

async function renderSearch(host, msg) {
    msg.textContent = '';
    host.innerHTML = `
        <div class="watchlist-header tab-header">
            <h2 class="cf-page-title">Search</h2>
            <div class="watchlist-header-right">
                <select class="cf-styled-select cf-search-kind">
                    <option value="">All</option>
                    <option value="book">Books</option>
                    <option value="comic">Comics</option>
                </select>
            </div>
        </div>
        <div class="cf-search-row">
            <span class="material-icons cf-search-icon">search</span>
            <input type="search" class="cf-search-fullwidth cf-search-input" placeholder="Search books and comics…" autocomplete="off" />
        </div>
        ${SHELL}`;

    const grid    = host.querySelector('.cf-grid');
    const pagTop  = host.querySelector('.cf-pagination-top');
    const pagBot  = host.querySelector('.cf-pagination-bottom');
    const input   = host.querySelector('.cf-search-input');
    const kindEl  = host.querySelector('.cf-search-kind');

    grid.innerHTML = renderEmpty('Type to search across books and comics.');

    let lastQuery = '';
    let inflight = 0;
    let debounce;

    async function go() {
        const q = (input.value || '').trim();
        if (!q) {
            grid.innerHTML = renderEmpty('Type to search across books and comics.');
            pagTop.innerHTML = ''; pagBot.innerHTML = '';
            return;
        }
        if (q === lastQuery) return;
        lastQuery = q;
        const myToken = ++inflight;
        grid.innerHTML = renderLoading('Searching…');
        pagTop.innerHTML = ''; pagBot.innerHTML = '';
        try {
            const data = await api.discoverSearch(q, kindEl.value || undefined, 60);
            if (myToken !== inflight) return;
            const items = data.items || [];
            if (!items.length) {
                grid.innerHTML = renderEmpty('No results.');
                return;
            }
            setupPaginatedGrid(host, items, msg);
        } catch (err) {
            if (myToken !== inflight) return;
            grid.innerHTML = renderError(err);
        }
    }

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(go, 350);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); go(); }
    });
    kindEl.addEventListener('change', () => { lastQuery = ''; go(); });
}

export async function render(root) {
    ({ api } = await import('./api.js?cb=' + Date.now()));

    root.classList.add('cf-host');
    root.innerHTML = `
        <div class="cf-glass-backdrop"></div>
        <div class="cf-host-inner">
            <div class="watchlist-tabs cf-discover-tabs">
                ${SUB_TABS.map((t, i) => `
                    <button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${t.label}</button>
                `).join('')}
            </div>
            <div class="cf-status-msg"></div>
            <div class="cf-tab-host"></div>
        </div>`;

    const tabHost = root.querySelector('.cf-tab-host');
    const msg = root.querySelector('.cf-status-msg');

    async function activate(id) {
        if (id === 'trending')   return renderTrending(tabHost, msg);
        if (id === 'comingSoon') return renderComingSoon(tabHost, msg);
        if (id === 'search')     return renderSearch(tabHost, msg);
    }

    root.querySelectorAll('.cf-discover-tabs button').forEach((b) => {
        b.addEventListener('click', () => {
            root.querySelectorAll('.cf-discover-tabs button').forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            void activate(b.dataset.tab);
        });
    });

    void activate('trending');
}
