// Discover view — Jellyseerr-style home for books + comics. v1.0.x ships
// the page shell, search bar, and live status; trending / coming-soon rows
// + per-card request CTA land in v1.1 once the backend `/discover/*` endpoints
// are in place. Watchlist summary stays here so the page is useful day-one.
import { api } from './api.js';

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

export async function render(root) {
    root.innerHTML = `
        <div class="padded-left padded-right padded-top">
            <h1 class="sectionTitle">Discover</h1>

            <div class="cf-search-bar">
                <div class="inputContainer flex-grow">
                    <input is="emby-input" type="search" class="emby-input cf-search-input"
                           placeholder="Search books and comics — coming in v1.1"
                           disabled aria-disabled="true" />
                </div>
                <button is="emby-button" type="button" class="raised button-flat" disabled>
                    <span class="material-icons" aria-hidden="true">search</span>
                </button>
            </div>

            <div class="cf-row" data-row="trending-books">
                <h2 class="sectionTitle sectionTitle-cards">Trending Books</h2>
                <div class="cf-scroller cf-trending-books">
                    <div class="cf-loading">Loading…</div>
                </div>
            </div>

            <div class="cf-row" data-row="trending-comics">
                <h2 class="sectionTitle sectionTitle-cards">Trending Comics</h2>
                <div class="cf-scroller cf-trending-comics">
                    <div class="cf-loading">Loading…</div>
                </div>
            </div>

            <div class="cf-row" data-row="coming-soon">
                <h2 class="sectionTitle sectionTitle-cards">Coming Soon — From Your Library</h2>
                <div class="cf-scroller cf-coming-soon">
                    <div class="cf-loading">Loading…</div>
                </div>
            </div>

            <div class="cf-row">
                <h2 class="sectionTitle">Your watchlist</h2>
                <div class="cf-watchlist-summary cf-muted">Loading…</div>
            </div>

            <div class="cf-row">
                <h2 class="sectionTitle">Backend status</h2>
                <div class="cf-health cf-muted">Checking…</div>
            </div>
        </div>`;

    const placeholderText =
        'Trending content lands once <code>/api/v1/discover/trending</code> ships in v1.1.';
    const placeholderRow = (target) => {
        target.innerHTML = '<div class="cf-empty padded-left padded-right">' + placeholderText + '</div>';
    };
    placeholderRow(root.querySelector('.cf-trending-books'));
    placeholderRow(root.querySelector('.cf-trending-comics'));
    placeholderRow(root.querySelector('.cf-coming-soon'));

    const wl = root.querySelector('.cf-watchlist-summary');
    const health = root.querySelector('.cf-health');

    try {
        const data = await api.listWatchlist();
        const byKind = {};
        for (const w of (data.items || [])) byKind[w.kind] = (byKind[w.kind] || 0) + 1;
        wl.classList.remove('cf-muted');
        wl.innerHTML =
            'Total: <strong>' + (data.total == null ? 0 : data.total) + '</strong>' +
            (Object.keys(byKind).length
                ? ' &nbsp;·&nbsp; ' +
                  Object.entries(byKind)
                      .map(([k, n]) => escapeHtml(k) + ': <strong>' + n + '</strong>')
                      .join(' &nbsp;·&nbsp; ')
                : '');
    } catch (err) {
        wl.innerHTML = '<span class="cf-error">Couldn’t load watchlist: ' + escapeHtml(err.message) + '</span>';
    }

    try {
        const h = await api.health();
        health.classList.remove('cf-muted');
        const breakerOpen = Object.values(h.clients || {}).filter(c => c.breaker_open).length;
        health.innerHTML =
            'Status: <span class="cf-pill cf-pill-' + (h.status === 'ok' ? 'done' : 'failed') + '">' + escapeHtml(h.status) + '</span>' +
            ' &nbsp;·&nbsp; Version: <strong>' + escapeHtml(h.version) + '</strong>' +
            ' &nbsp;·&nbsp; Search: ' + ((h.in_flight && h.in_flight.search) ? 'in flight' : 'idle') +
            ' &nbsp;·&nbsp; Breakers open: <strong>' + breakerOpen + '</strong>';
    } catch (err) {
        health.innerHTML = '<span class="cf-error">Backend unreachable: ' + escapeHtml(err.message) + '</span>';
    }
}
