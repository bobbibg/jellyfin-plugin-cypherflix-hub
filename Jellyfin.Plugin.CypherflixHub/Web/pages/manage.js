// Manage view — visually parallels KefinTweaks Watchlist > Series Progress.
// Wraps in .sections.watchlist so KefinTweaks's CSS styles us; uses
// .watchlist-tabs / .watchlist-header.tab-header / .progress-card patterns
// verbatim. KefinTweaks's JS only fires on #/home routes so it won't try
// to render into our slot.
//
// Imports happen INSIDE render() with a cache-buster so plugin upgrades
// reliably evict stale module instances.
let api;
let isCurrentUserAdmin;

const STATUS_TABS = [
    { id: 'wanted',     label: 'Wanted',      statuses: ['wanted'] },
    { id: 'inProgress', label: 'In progress', statuses: ['searching', 'snatched', 'downloading', 'importing', 'tagging'] },
    { id: 'done',       label: 'Done',        statuses: ['done'] },
    { id: 'issues',     label: 'Issues',      statuses: ['failed', 'blocked'] },
    { id: 'all',        label: 'All',         statuses: null },
];

const KINDS = [
    { value: '',            label: 'All' },
    { value: 'comic_issue', label: 'Comics' },
    { value: 'book',        label: 'Books' },
    { value: 'audiobook',   label: 'Audiobooks' },
];

const PAGE_SIZE = 20;

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

function fmtDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString(); } catch (_) { return s; }
}

function fmtDateTime(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleString(); } catch (_) { return s; }
}

// Map our DB status onto a progress-card colour class. KefinTweaks ships
// progress-card-completed (green); we add custom modifiers for the other
// states using KefinTweaks's colour palette.
function statusModifierClass(status) {
    if (status === 'done')      return 'progress-card-completed';
    if (status === 'failed' || status === 'blocked') return 'cf-card-failed';
    return '';
}

function statusBadge(status) {
    if (status === 'done') {
        return '<span class="completion-badge">✓ ' + status.toUpperCase() + '</span>';
    }
    return '<span class="cf-status-badge cf-status-badge-' + status + '">' + status.toUpperCase() + '</span>';
}

function progressBar(pct, status) {
    const bar = pct == null ? null : Math.max(0, Math.min(100, Math.round(pct)));
    const completed = status === 'done';
    const wrapClass = 'progress-bar' + (completed ? ' progress-bar-completed' : '');
    const fillStyle = bar == null ? 'width: 0%' : 'width: ' + bar + '%';
    return `
        <div class="progress-bar-container">
            <div class="${wrapClass}">
                <div class="progress-bar-fill" style="${fillStyle}"></div>
            </div>
        </div>`;
}

function primaryTitle(r) {
    const parts = [];
    if (r.series_name) parts.push(r.series_name);
    if (r.issue_number) parts.push('#' + r.issue_number);
    if (parts.length) return parts.join(' ');
    return r.title || '(untitled)';
}

function renderCard(r, isAdmin) {
    const mod   = statusModifierClass(r.status);
    const stats = [];
    if (r.title && r.title !== r.series_name) stats.push('<strong>' + escapeHtml(r.title) + '</strong>');
    if (r.series_year)  stats.push(escapeHtml(String(r.series_year)));
    if (r.release_date) stats.push('Released ' + escapeHtml(fmtDate(r.release_date)));
    if (r.authors)      stats.push(escapeHtml(r.authors));

    const reasonLine = r.status_reason
        ? '<div class="progress-last-watched cf-status-reason"><strong>Reason:</strong> ' + escapeHtml(r.status_reason) + '</div>'
        : '';

    const lastUpdated = r.updated_at
        ? '<div class="progress-last-watched">Last update: ' + escapeHtml(fmtDateTime(r.updated_at)) + '</div>'
        : '';

    const adminActions = isAdmin ? `
        <div class="progress-actions">
            <button class="action-link cf-retry"        title="Reset to wanted">+ Retry</button>
            <button class="action-link cf-refresh-meta" title="Refresh metadata from providers">+ Refresh metadata</button>
            <button class="action-link cf-regrab"       title="Delete file and re-search">+ Re-grab</button>
        </div>` : '';

    const poster = r.cover_url
        ? '<img src="' + escapeHtml(r.cover_url) + '" alt="" loading="lazy" />'
        : '<div class="movie-poster-placeholder"><span class="material-icons">' + (r.kind === 'book' ? 'menu_book' : r.kind === 'audiobook' ? 'headphones' : 'auto_stories') + '</span></div>';

    return `
        <div class="progress-card ${mod}" data-id="${r.id}">
            <div class="progress-card-content">
                <div class="progress-poster">${poster}</div>
                <div class="progress-details">
                    <div class="progress-header">
                        <h3 class="progress-title">${escapeHtml(primaryTitle(r))} ${statusBadge(r.status)}</h3>
                    </div>
                    ${r.progress_pct != null ? progressBar(r.progress_pct, r.status) : ''}
                    <div class="progress-stats">${stats.join(' <span class="progress-stats-separator">·</span> ')}</div>
                    ${lastUpdated}
                    ${reasonLine}
                    ${adminActions}
                </div>
            </div>
        </div>`;
}

function renderEmpty(msg) {
    return `
        <div class="progress-empty-message">
            <div class="empty-message-icon"><span class="material-icons">inbox</span></div>
            <h3 class="empty-message-title">No requests in this view</h3>
            <p class="empty-message-subtitle">${escapeHtml(msg || 'Try a different filter or kind.')}</p>
        </div>`;
}

function renderLoading() {
    return '<div class="progress-empty-message"><div class="empty-message-icon"><span class="material-icons">hourglass_top</span></div><p class="empty-message-subtitle">Loading…</p></div>';
}

function renderError(err) {
    return '<div class="progress-empty-message"><div class="empty-message-icon"><span class="material-icons">error_outline</span></div><h3 class="empty-message-title">Error</h3><p class="empty-message-subtitle">' + escapeHtml(err.message || String(err)) + '</p></div>';
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
    // Window of pages around the current one
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

    root.innerHTML = `
        <div class="sections watchlist cypherflix-manage">
            <div class="watchlist-tabs">
                ${STATUS_TABS.map((t, i) => `
                    <button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${t.label}</button>
                `).join('')}
            </div>

            <div data-tab="manage-content" class="active">
                <div class="watchlist-header tab-header">
                    <h2 class="cf-page-title">Manage Requests</h2>
                    <div class="watchlist-header-stats-container">
                        <div class="watchlist-header-stats cf-stats-total">— total</div>
                        <div class="watchlist-header-stats cf-stats-tab">— in view</div>
                    </div>
                    <div class="watchlist-header-right">
                        <select class="sort-button cf-kind">
                            ${KINDS.map(k => '<option value="' + k.value + '">' + k.label + '</option>').join('')}
                        </select>
                        <button class="sort-button cf-refresh" title="Refresh">
                            <span class="material-icons">refresh</span>
                        </button>
                        ${isAdmin ? '<button class="sort-button cf-sweep" title="Trigger sweep"><span class="material-icons">play_arrow</span><span class="sort-label">Sweep</span></button>' : ''}
                    </div>
                </div>

                <div class="search-container">
                    <div class="search-input-wrapper">
                        <span class="material-icons search-icon">search</span>
                        <input type="search" class="search-input cf-search" placeholder="Search requests…" autocomplete="off" />
                    </div>
                </div>

                <div class="cf-status-msg"></div>
                <div class="cf-pagination-top"></div>
                <div class="paginated-container">
                    <div class="progress-series cf-rows">${renderLoading()}</div>
                </div>
                <div class="cf-pagination-bottom"></div>
            </div>
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
            (r.authors || '').toLowerCase().includes(q)
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
    }

    async function refresh() {
        msg.textContent = '';
        list.innerHTML = renderLoading();
        pagTop.innerHTML = '';
        pagBottom.innerHTML = '';
        try {
            const items = [];
            const statuses = activeTab.statuses || [null];
            for (const s of statuses) {
                const params = { limit: 500 };
                if (s) params.status = s;
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
    root.querySelectorAll('.watchlist-tabs button').forEach((b) => {
        b.addEventListener('click', () => {
            root.querySelectorAll('.watchlist-tabs button').forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            activeTab = STATUS_TABS.find((t) => t.id === b.dataset.tab) || STATUS_TABS[0];
            void refresh();
        });
    });

    // Per-row admin actions
    if (isAdmin) {
        list.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn || btn.classList.contains('pagination-btn')) return;
            const card = btn.closest('.progress-card[data-id]');
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

    // Pagination delegation (top + bottom share handler)
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
    kindEl.addEventListener('change', () => {
        kindFilter = kindEl.value;
        void refresh();
    });

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
