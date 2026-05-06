// Discover view — Seer-style browse over books + comics.
// Three sub-tabs: Trending / Coming Soon / Search.
// Cards reuse KefinTweaks Watchlist .progress-card class names so the
// existing styling applies for free; backend supplies cover_url, so we
// render <img> when present and a material-icon fallback otherwise.
// Each card has a Request CTA that POSTs the pre-baked watchlist_payload
// to /api/v1/watchlist.
//
// api.js is imported dynamically inside render() with a cache-buster so
// plugin upgrades evict the stale module instance reliably.
let api;

const SUB_TABS = [
    { id: 'trending',    label: 'Trending'    },
    { id: 'comingSoon',  label: 'Coming Soon' },
    { id: 'search',      label: 'Search'      },
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

// ----- card rendering --------------------------------------------------

function kindIcon(kind) {
    if (kind === 'book')           return 'menu_book';
    if (kind === 'comic_issue')    return 'auto_stories';
    if (kind === 'comic_series')   return 'auto_stories';
    return 'collections_bookmark';
}

function renderCard(item) {
    const titleParts = [];
    if (item.series_name) titleParts.push(item.series_name);
    if (item.issue_number) titleParts.push('#' + item.issue_number);
    const primary = titleParts.join(' ') || item.title || '(untitled)';
    const subtitle = item.title && item.title !== item.series_name ? item.title : '';

    const stats = [];
    if (item.year)         stats.push(String(item.year));
    if (item.release_date) stats.push(fmtDate(item.release_date));
    if (item.authors)      stats.push(item.authors);

    const poster = item.cover_url
        ? '<img src="' + escapeHtml(item.cover_url) + '" alt="" loading="lazy" />'
        : '<span class="material-icons cf-poster-fallback" aria-hidden="true">' + kindIcon(item.kind) + '</span>';

    return `
        <div class="progress-card cf-discover-card"
             data-source="${escapeHtml(item.source)}"
             data-source-id="${escapeHtml(item.source_id)}"
             data-watchlist-kind="${escapeHtml(item.watchlist_kind)}">
            <div class="progress-card-content">
                <div class="progress-poster cf-progress-poster">${poster}</div>
                <div class="progress-details">
                    <div class="progress-header">
                        <h3 class="progress-title">${escapeHtml(primary)}</h3>
                    </div>
                    ${subtitle ? '<div class="progress-last-watched">' + escapeHtml(subtitle) + '</div>' : ''}
                    <div class="progress-stats">${stats.map(escapeHtml).join(' · ')}</div>
                    ${item.summary ? '<div class="progress-last-watched cf-summary">' + escapeHtml(item.summary.slice(0, 240)) + (item.summary.length > 240 ? '…' : '') + '</div>' : ''}
                    <div class="progress-actions">
                        <button class="action-link cf-request-btn">+ Request</button>
                    </div>
                </div>
            </div>
        </div>`;
}

function renderEmpty(msg) {
    return '<div class="progress-card cf-empty">' + escapeHtml(msg) + '</div>';
}

function renderLoading(msg) {
    return '<div class="progress-card cf-loading">' + escapeHtml(msg || 'Loading…') + '</div>';
}

function renderError(err) {
    return '<div class="progress-card cf-error">Error: ' + escapeHtml(err.message || String(err)) + '</div>';
}

// ----- request CTA ----------------------------------------------------

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
            btn.textContent = '✓ Requested';
            btn.disabled = true;
            btn.classList.add('cf-requested');
        }
    } catch (err) {
        msg.textContent = 'Error: ' + (err.message || String(err));
    }
}

// ----- tab content renderers ------------------------------------------

async function renderTrending(host) {
    host.innerHTML = `
        <div class="cf-row">
            <h2 class="sectionTitle sectionTitle-cards">Trending Books</h2>
            <div class="cf-cards cf-trending-books">${renderLoading()}</div>
        </div>
        <div class="cf-row">
            <h2 class="sectionTitle sectionTitle-cards">Trending Comics</h2>
            <div class="cf-cards cf-trending-comics">${renderLoading()}</div>
        </div>`;
    await Promise.all([
        loadInto(host.querySelector('.cf-trending-books'),  () => api.discoverTrending('book',  20)),
        loadInto(host.querySelector('.cf-trending-comics'), () => api.discoverTrending('comic', 20)),
    ]);
}

async function renderComingSoon(host) {
    host.innerHTML = `
        <div class="cf-row">
            <h2 class="sectionTitle sectionTitle-cards">Coming Soon — From Your Watchlist</h2>
            <div class="cf-cards cf-coming-soon">${renderLoading()}</div>
        </div>`;
    await loadInto(host.querySelector('.cf-coming-soon'), () => api.discoverComingSoon(40));
}

async function renderSearch(host) {
    host.innerHTML = `
        <div class="cf-search-bar">
            <div class="inputContainer flex-grow cf-search-wrap">
                <input is="emby-input" type="search" class="emby-input cf-search-input"
                       placeholder="Search books and comics…" autocomplete="off" />
            </div>
            <div class="selectContainer selectContainer-inline">
                <label class="selectLabel" for="cf-search-kind">Kind</label>
                <select is="emby-select" id="cf-search-kind" class="emby-select-withcolor cf-search-kind">
                    <option value="">All</option>
                    <option value="book">Books</option>
                    <option value="comic">Comics</option>
                </select>
            </div>
            <button is="emby-button" type="button" class="raised button-flat cf-search-go">
                <span class="material-icons" aria-hidden="true">search</span>
                <span>Search</span>
            </button>
        </div>
        <div class="cf-cards cf-search-results">
            <div class="progress-card cf-empty">Type to search across books and comics.</div>
        </div>`;

    const input  = host.querySelector('.cf-search-input');
    const kind   = host.querySelector('.cf-search-kind');
    const goBtn  = host.querySelector('.cf-search-go');
    const results = host.querySelector('.cf-search-results');

    let lastQuery = '';
    let inflight = 0;

    async function go() {
        const q = (input.value || '').trim();
        if (!q) {
            results.innerHTML = '<div class="progress-card cf-empty">Type to search across books and comics.</div>';
            return;
        }
        if (q === lastQuery) return;
        lastQuery = q;
        const myToken = ++inflight;
        results.innerHTML = renderLoading('Searching…');
        try {
            const data = await api.discoverSearch(q, kind.value || undefined, 30);
            if (myToken !== inflight) return;  // newer search superseded
            const items = data.items || data;
            if (!items || !items.length) {
                results.innerHTML = renderEmpty('No results.');
                return;
            }
            renderItemsInto(results, items);
        } catch (err) {
            if (myToken !== inflight) return;
            results.innerHTML = renderError(err);
        }
    }

    let debounce;
    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(go, 350);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(debounce); go(); }
    });
    goBtn.addEventListener('click', () => { clearTimeout(debounce); go(); });
    kind.addEventListener('change', () => { lastQuery = ''; go(); });
}

// ----- shared loaders --------------------------------------------------

async function loadInto(el, fetcher) {
    try {
        const data = await fetcher();
        const items = data.items || data;
        if (!items || !items.length) {
            el.innerHTML = renderEmpty('Nothing here yet.');
            return;
        }
        renderItemsInto(el, items);
    } catch (err) {
        el.innerHTML = renderError(err);
    }
}

function renderItemsInto(el, items) {
    el.innerHTML = items.map(renderCard).join('');
    // Stash the full item on each card so the request handler has everything.
    el.querySelectorAll('.progress-card[data-source-id]').forEach((card, i) => {
        try { card.dataset.payload = JSON.stringify(items[i]); } catch (_) {}
    });
}

// ----- entry point -----------------------------------------------------

export async function render(root) {
    ({ api } = await import('./api.js?cb=' + Date.now()));
    root.innerHTML = `
        <div class="padded-left padded-right padded-top">
            <h1 class="sectionTitle">Discover</h1>
            <div class="cypherflix-discover">
                <div class="watchlist-tabs cf-discover-tabs">
                    ${SUB_TABS.map((t, i) => `
                        <button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${t.label}</button>
                    `).join('')}
                </div>
                <div class="cf-toolbar">
                    <span class="cf-status-msg"></span>
                </div>
                <div class="cf-tab-host"></div>
            </div>
        </div>`;

    const tabHost = root.querySelector('.cf-tab-host');
    const msg = root.querySelector('.cf-status-msg');

    async function activate(id) {
        msg.textContent = '';
        if (id === 'trending')   return renderTrending(tabHost);
        if (id === 'comingSoon') return renderComingSoon(tabHost);
        if (id === 'search')     return renderSearch(tabHost);
    }

    root.querySelectorAll('.cf-discover-tabs button').forEach((b) => {
        b.addEventListener('click', () => {
            root.querySelectorAll('.cf-discover-tabs button').forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            void activate(b.dataset.tab);
        });
    });

    // Click anywhere on the tab host — request button is delegated.
    tabHost.addEventListener('click', async (e) => {
        const btn = e.target.closest('.cf-request-btn');
        if (!btn) return;
        const card = btn.closest('.progress-card[data-source-id]');
        if (!card) return;
        await handleRequest(card, msg);
    });

    // Boot on the Trending tab.
    void activate('trending');
}
