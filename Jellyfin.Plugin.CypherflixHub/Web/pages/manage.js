// Manage view — visually mirrors Watchlist's Movie History grid.
// Renders into a Custom Tab anchor div (.sections.cypherflix-manage). The
// outer .sections.watchlist class on the parent inherits KefinTweaks's
// styling for tabs / cards / pagination / search.
//
// 5 status buckets:
//   Wanted (incl. failed/blocked so admin can retry) → wanted/failed/blocked
//   Downloading                                       → searching/snatched/downloading
//   Downloaded                                        → importing
//   Enriching   (queue for metadata enrichment)        → tagging
//   Complete                                           → done

let api;
let isCurrentUserAdmin;

const STATUS_TABS = [
    { id: 'wanted',      label: 'Wanted',      statuses: ['wanted', 'failed', 'blocked'] },
    { id: 'downloading', label: 'Downloading', statuses: ['searching', 'snatched', 'downloading'] },
    { id: 'downloaded',  label: 'Downloaded',  statuses: ['importing'] },
    { id: 'enriching',   label: 'Enriching',   statuses: ['tagging'] },
    { id: 'complete',    label: 'Complete',    statuses: ['done'] },
];

const KINDS = [
    { value: '',            label: 'All' },
    { value: 'comic_issue', label: 'Comics' },
    { value: 'book',        label: 'Books' },
    { value: 'audiobook',   label: 'Audiobooks' },
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

function statusOverlay(status) {
    const cls = 'cf-status-overlay cf-status-overlay-' + status;
    return '<div class="' + cls + '">' + status.toUpperCase() + '</div>';
}

function kindIcon(kind) {
    if (kind === 'book')         return 'menu_book';
    if (kind === 'comic_issue')  return 'auto_stories';
    if (kind === 'audiobook')    return 'headphones';
    return 'collections_bookmark';
}

function primaryTitle(r) {
    const parts = [];
    if (r.series_name) parts.push(r.series_name);
    if (r.issue_number) parts.push('#' + r.issue_number);
    return parts.length ? parts.join(' ') : (r.title || '(untitled)');
}

function renderCard(r, isAdmin) {
    const meta = [];
    if (r.series_year)  meta.push('<span class="movie-year">' + escapeHtml(String(r.series_year)) + '</span>');
    if (r.release_date) meta.push('<span class="movie-runtime"><span class="material-icons">event</span>' + escapeHtml(fmtDate(r.release_date)) + '</span>');

    // Subtitle is the author when known. Falls back to the issue/book
    // title when authors aren't on the row (common for comics where the
    // ComicVine response we ingest doesn't always include credits).
    const subtitleLine = r.authors
        ? '<div class="cf-card-subtitle">' + escapeHtml(r.authors) + '</div>'
        : (r.title && r.title !== r.series_name
            ? '<div class="cf-card-subtitle">' + escapeHtml(r.title) + '</div>'
            : '');
    const summary = r.summary
        ? '<div class="cf-card-summary">' + escapeHtml(r.summary.slice(0, 220)) + (r.summary.length > 220 ? '…' : '') + '</div>'
        : '';
    const reasonLine = r.status_reason
        ? '<div class="cf-card-reason">' + escapeHtml(r.status_reason) + '</div>'
        : '';

    const adminActions = isAdmin ? `
        <div class="movie-actions">
            <button class="movie-action-btn cf-retry"        title="Reset to wanted"><span class="material-icons">replay</span></button>
            <button class="movie-action-btn cf-refresh-meta" title="Refresh metadata"><span class="material-icons">cloud_sync</span></button>
            <button class="movie-action-btn cf-regrab"       title="Re-grab"><span class="material-icons">file_download</span></button>
        </div>` : '';

    // The cf-needs-cover marker is what the lazy-cover loader looks for
    // post-render — items without a cached cover get one fetched on-demand.
    const poster = r.cover_url
        ? '<img src="' + escapeHtml(r.cover_url) + '" alt="" loading="lazy" />'
        : '<div class="movie-poster-placeholder cf-needs-cover" data-request-id="' + r.id + '"><span class="material-icons">' + kindIcon(r.kind) + '</span></div>';

    return `
        <div class="movie-card cf-card cf-card-${r.kind} cf-card-status-${r.status}" data-id="${r.id}">
            <div class="movie-poster cf-portrait-poster">
                ${poster}
                <div class="movie-poster-overlay">${statusOverlay(r.status)}</div>
            </div>
            <div class="movie-details">
                <div class="cf-card-body">
                    <h3 class="movie-title">${escapeHtml(primaryTitle(r))}</h3>
                    ${subtitleLine}
                    <div class="movie-meta">${meta.join('')}</div>
                    ${summary}
                    ${reasonLine}
                </div>
                ${adminActions}
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

// Lazy-fetch covers for cards that don't have one yet. Sequential to
// avoid hammering ComicVine/Hardcover; SafeClient on the backend rate-
// limits anyway. Aborts the in-flight chain when the user navigates away.
async function fillMissingCovers(host, abortSignal) {
    const placeholders = host.querySelectorAll('.movie-poster-placeholder.cf-needs-cover[data-request-id]');
    for (const ph of placeholders) {
        if (abortSignal && abortSignal.aborted) return;
        const id = parseInt(ph.dataset.request_id || ph.dataset.requestId, 10);
        if (!Number.isFinite(id)) continue;
        try {
            const data = await api.getRequestCover(id);
            if (abortSignal && abortSignal.aborted) return;
            const url = data && data.cover_url;
            if (!url) continue;
            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.className = 'cf-cover-loading';
            img.src = url;
            img.onload = () => img.classList.replace('cf-cover-loading', 'cf-cover-loaded');
            // Replace the placeholder with the real image.
            ph.replaceWith(img);
        } catch (_) { /* leave placeholder */ }
    }
}

function renderEmpty(msg) {
    return `
        <div class="movie-history-empty-message">
            <div class="empty-message-icon"><span class="material-icons">inbox</span></div>
            <h3 class="empty-message-title">No requests in this view</h3>
            <p class="empty-message-subtitle">${escapeHtml(msg || 'Try a different bucket or kind.')}</p>
        </div>`;
}

function renderLoading() {
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

export async function render(root) {
    const cb = '?cb=' + Date.now();
    ({ api } = await import('./api.js' + cb));
    ({ isCurrentUserAdmin } = await import('./user.js' + cb));
    const isAdmin = await isCurrentUserAdmin();

    let activeTab = STATUS_TABS[0];
    let kindFilter = '';
    let searchTerm = '';
    let currentPage = 1;
    let allItems = [];
    // AbortController so navigating away cancels in-flight cover fetches.
    let coverAbort = new AbortController();

    root.classList.add('cf-host');
    root.innerHTML = `
        <div class="cf-glass-backdrop"></div>
        <div class="cf-host-inner">
            <div class="watchlist-tabs cf-status-tabs">
                ${STATUS_TABS.map((t, i) => `
                    <button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${t.label}</button>
                `).join('')}
            </div>

            <div class="watchlist-header tab-header">
                <h2 class="cf-page-title">Manage Requests</h2>
                <div class="watchlist-header-stats-container">
                    <div class="watchlist-header-stats cf-stats-total">— total</div>
                    <div class="watchlist-header-stats cf-stats-tab">— in view</div>
                </div>
                <div class="watchlist-header-right">
                    <select class="cf-styled-select cf-kind">
                        ${KINDS.map(k => '<option value="' + k.value + '">' + k.label + '</option>').join('')}
                    </select>
                    <button class="cf-icon-button cf-refresh" title="Refresh">
                        <span class="material-icons">refresh</span>
                    </button>
                    ${isAdmin ? '<button class="cf-icon-button cf-sweep" title="Trigger sweep"><span class="material-icons">play_arrow</span></button>' : ''}
                </div>
            </div>

            <div class="cf-search-row">
                <span class="material-icons cf-search-icon">search</span>
                <input type="search" class="cf-search-fullwidth cf-search" placeholder="Search by title, series, author…" autocomplete="off" />
            </div>

            <div class="cf-status-msg"></div>
            <div class="cf-pagination-top"></div>
            <div class="paginated-container">
                <div class="movie-history-grid cf-card-grid cf-rows">${renderLoading()}</div>
            </div>
            <div class="cf-pagination-bottom"></div>
        </div>`;

    const $ = (sel) => root.querySelector(sel);
    const list      = $('.cf-rows');
    const msg       = $('.cf-status-msg');
    const searchEl  = $('.cf-search');
    const kindEl    = $('.cf-kind');
    const statsTab  = $('.cf-stats-tab');
    const statsAll  = $('.cf-stats-total');
    const pagTop    = $('.cf-pagination-top');
    const pagBottom = $('.cf-pagination-bottom');

    function applySearch(items) {
        if (!searchTerm) return items;
        const q = searchTerm.toLowerCase();
        return items.filter(r =>
            (r.series_name || '').toLowerCase().includes(q) ||
            (r.title || '').toLowerCase().includes(q) ||
            (r.authors || '').toLowerCase().includes(q) ||
            (r.summary || '').toLowerCase().includes(q)
        );
    }

    function renderPage() {
        const filtered = applySearch(allItems);
        const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        if (currentPage > totalPages) currentPage = totalPages;
        const slice = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

        statsTab.textContent = filtered.length + ' in view';
        list.innerHTML = slice.length
            ? slice.map(r => renderCard(r, isAdmin)).join('')
            : renderEmpty(searchTerm ? 'No matches for that search.' : null);
        pagTop.innerHTML    = renderPagination(currentPage, totalPages, 'top');
        pagBottom.innerHTML = renderPagination(currentPage, totalPages, 'bottom');

        // Kick off lazy cover loading for the cards just rendered. Cancel
        // any prior chain so paginating doesn't pile up requests.
        coverAbort.abort();
        coverAbort = new AbortController();
        void fillMissingCovers(list, coverAbort.signal);
    }

    async function refresh() {
        msg.textContent = '';
        list.innerHTML = renderLoading();
        pagTop.innerHTML = '';
        pagBottom.innerHTML = '';
        try {
            const items = [];
            for (const s of activeTab.statuses) {
                const params = { limit: 500, status: s };
                if (kindFilter) params.kind = kindFilter;
                const data = await api.listRequests(params);
                items.push(...(data.items || []));
            }
            items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
            allItems = items;
            currentPage = 1;
            statsAll.textContent = items.length + ' total';
            renderPage();
        } catch (err) {
            list.innerHTML = renderError(err);
            statsAll.textContent = '— total';
            statsTab.textContent = '— in view';
        }
    }

    // Status sub-tabs
    root.querySelectorAll('.cf-status-tabs button').forEach((b) => {
        b.addEventListener('click', () => {
            root.querySelectorAll('.cf-status-tabs button').forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            activeTab = STATUS_TABS.find((t) => t.id === b.dataset.tab) || STATUS_TABS[0];
            void refresh();
        });
    });

    // Per-card admin actions
    if (isAdmin) {
        list.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn || btn.classList.contains('pagination-btn')) return;
            const card = btn.closest('.movie-card[data-id]');
            if (!card) return;
            const id = parseInt(card.dataset.id, 10);
            try {
                if (btn.classList.contains('cf-retry')) {
                    await api.retryRequest(id);
                    msg.textContent = 'Reset to wanted.';
                } else if (btn.classList.contains('cf-refresh-meta')) {
                    msg.textContent = 'Refreshing metadata…';
                    await api.refreshMetadata(id);
                    msg.textContent = 'Metadata refreshed.';
                } else if (btn.classList.contains('cf-regrab')) {
                    if (!confirm('Delete the existing file and re-search? This cannot be undone.')) return;
                    msg.textContent = 'Re-grabbing…';
                    await api.regrabRequest(id);
                    msg.textContent = 'Re-grab kicked off.';
                }
                await refresh();
            } catch (err) {
                msg.textContent = 'Error: ' + err.message;
            }
        });

        const sweep = root.querySelector('.cf-sweep');
        if (sweep) sweep.addEventListener('click', async () => {
            try {
                await api.triggerSweep();
                msg.textContent = 'Sweep started.';
                setTimeout(refresh, 1500);
            } catch (err) {
                msg.textContent = 'Error: ' + err.message;
            }
        });
    }

    // Pagination delegation
    [pagTop, pagBottom].forEach((host) => {
        host.addEventListener('click', (e) => {
            const btn = e.target.closest('button.pagination-btn');
            if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
            const target = parseInt(btn.dataset.page, 10);
            if (!Number.isFinite(target)) return;
            currentPage = target;
            renderPage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    root.querySelector('.cf-refresh').addEventListener('click', refresh);
    kindEl.addEventListener('change', () => { kindFilter = kindEl.value; void refresh(); });

    let searchDebounce;
    searchEl.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            searchTerm = (searchEl.value || '').trim();
            currentPage = 1;
            renderPage();
        }, 200);
    });

    refresh();
}
