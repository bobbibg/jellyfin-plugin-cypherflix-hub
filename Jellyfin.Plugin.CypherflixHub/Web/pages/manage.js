// Queue view (formerly "Manage") — visually mirrors KefinTweaks
// Watchlist > Series Progress: full-width row strip per item with a
// small portrait cover (~80px), inline progress bar, status pill,
// and a right-aligned action cluster.
//
// Anchor div class stays .sections.cypherflix-manage so existing
// Custom Tabs / KefinTweaks config keeps working — only the visible
// label changes to "Queue".
//
// Five status buckets (no All): Wanted / Downloading / Downloaded /
// Enriching / Complete. Failed/blocked items roll into Wanted with a
// red-tinted status pill so admin can retry or remove from queue.

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

function kindIcon(kind) {
    if (kind === 'book')         return 'menu_book';
    if (kind === 'comic_issue')  return 'auto_stories';
    if (kind === 'audiobook')    return 'headphones';
    return 'collections_bookmark';
}

// --- progress bar ---------------------------------------------------------
// Each row gets a full-width slim bar along the bottom of the strip.
// Width = progress_pct when present; else heuristic per status.

function progressFor(r) {
    if (r.progress_pct != null) return Math.max(0, Math.min(100, Math.round(r.progress_pct)));
    switch (r.status) {
        case 'wanted':       return 0;
        case 'failed':       return 0;
        case 'blocked':      return 0;
        case 'searching':    return 10;
        case 'snatched':     return 20;
        case 'downloading':  return 50;
        case 'importing':    return 75;
        case 'tagging':      return 90;
        case 'done':         return 100;
        default:             return 0;
    }
}

function statusPill(status) {
    return '<span class="cf-q-pill cf-q-pill-' + status + '">' + status + '</span>';
}

function primaryTitle(r) {
    const parts = [];
    if (r.series_name) parts.push(r.series_name);
    if (r.issue_number) parts.push('#' + r.issue_number);
    return parts.length ? parts.join(' ') : (r.title || '(untitled)');
}

function subtitleFor(r) {
    if (r.authors) return r.authors;
    if (r.title && r.title !== r.series_name) return r.title;
    return '';
}

function metaLineFor(r) {
    const bits = [];
    if (r.series_year)  bits.push(r.series_year);
    if (r.release_date) bits.push('Released ' + fmtDate(r.release_date));
    if (r.size_mb)      bits.push(Math.round(r.size_mb) + ' MB');
    if (r.retries > 0)  bits.push(r.retries + ' retr' + (r.retries === 1 ? 'y' : 'ies'));
    return bits.join(' · ');
}

// One row per request — full-width horizontal strip. Cover left, body
// flex-grow, action cluster right, progress bar across the bottom.
function renderRow(r, isAdmin, isSelected) {
    const poster = r.cover_url
        ? '<img src="' + escapeHtml(r.cover_url) + '" alt="" loading="lazy" />'
        : '<div class="cf-q-poster-placeholder cf-needs-cover" data-request-id="' + r.id + '">' +
              '<span class="material-icons">' + kindIcon(r.kind) + '</span>' +
          '</div>';

    const subtitle = subtitleFor(r);
    const reason = r.status_reason
        ? '<div class="cf-q-row-reason">' + escapeHtml(r.status_reason) + '</div>'
        : '';

    const progress = progressFor(r);
    const stuck = r.status === 'failed' || r.status === 'blocked' || (r.status === 'wanted' && r.retries >= 3);

    // v3.0.1: Loosen + Candidates are always available to admins now —
    // they're escape hatches the user reaches for whenever a queued item
    // hasn't snatched yet, not just after the auto-grabber has tried and
    // failed three times. The 'stuck' gate was hiding them from a freshly
    // queued book that simply hadn't been picked up yet.
    const adminActions = isAdmin ? `
        <div class="cf-q-row-actions">
            <button class="cf-q-iconbtn cf-q-retry"        title="Retry"><span class="material-icons">replay</span></button>
            <button class="cf-q-iconbtn cf-q-refresh-meta" title="Refresh metadata"><span class="material-icons">cloud_sync</span></button>
            <button class="cf-q-iconbtn cf-q-regrab"       title="Re-grab"><span class="material-icons">file_download</span></button>
            <button class="cf-q-iconbtn cf-q-loosen"       title="Loosen search (broader matcher)"><span class="material-icons">tune</span></button>
            <button class="cf-q-iconbtn cf-q-candidates"   title="Show indexer candidates"><span class="material-icons">manage_search</span></button>
            ${stuck ? '<button class="cf-q-iconbtn cf-q-remove cf-q-iconbtn-danger" title="Remove from queue"><span class="material-icons">delete_outline</span></button>' : ''}
        </div>` : '';

    const checkClass = isSelected ? ' cf-q-row-selected' : '';
    // v3.0.1: only render the progress bar for the in-flight statuses where
    // a partial bar carries information. Static states (wanted, failed,
    // done, blocked, etc.) just looked like a weird border.
    const showProgress = (
        r.status === 'downloading' ||
        r.status === 'snatched' ||
        r.status === 'importing' ||
        r.status === 'tagging'
    );
    const progressBar = showProgress ? `
            <div class="cf-q-row-progress">
                <div class="cf-q-row-progress-fill cf-q-row-progress-${r.status}" style="width: ${progress}%"></div>
            </div>` : '';
    return `
        <div class="cf-q-row cf-q-row-status-${r.status}${checkClass}" data-id="${r.id}">
            <label class="cf-q-row-checkbox" title="Select"><input type="checkbox" class="cf-q-row-check" data-id="${r.id}"${isSelected ? ' checked' : ''} /></label>
            <div class="cf-q-row-cover">${poster}</div>
            <div class="cf-q-row-body">
                <div class="cf-q-row-title">${escapeHtml(primaryTitle(r))}</div>
                ${subtitle ? '<div class="cf-q-row-subtitle">' + escapeHtml(subtitle) + '</div>' : ''}
                <div class="cf-q-row-meta">${escapeHtml(metaLineFor(r))}</div>
                ${reason}
            </div>
            <div class="cf-q-row-status">${statusPill(r.status)}</div>
            ${adminActions}
            ${progressBar}
        </div>`;
}

// --- skeleton + empty/error/loading states --------------------------------

function skeletonRows(count) {
    const row = `
        <div class="cf-q-row cf-q-row-skeleton">
            <div class="cf-q-row-cover cf-q-skeleton-shimmer"></div>
            <div class="cf-q-row-body">
                <div class="cf-q-skeleton-line cf-q-skeleton-shimmer" style="width:60%; height:16px"></div>
                <div class="cf-q-skeleton-line cf-q-skeleton-shimmer" style="width:40%; height:12px; margin-top:8px"></div>
                <div class="cf-q-skeleton-line cf-q-skeleton-shimmer" style="width:30%; height:10px; margin-top:6px"></div>
            </div>
        </div>`;
    return Array(count).fill(row).join('');
}

function renderEmpty(msg) {
    return `
        <div class="cf-q-empty">
            <span class="material-icons">inbox</span>
            <h3>No items in this view</h3>
            <p>${escapeHtml(msg || 'Try a different bucket or kind.')}</p>
        </div>`;
}
function renderError(err) {
    return `
        <div class="cf-q-empty cf-q-empty-error">
            <span class="material-icons">error_outline</span>
            <h3>Error</h3>
            <p>${escapeHtml(err.message || String(err))}</p>
        </div>`;
}

// --- pagination -----------------------------------------------------------

function renderPagination(page, totalPages, totalAll, totalView) {
    const cls = 'cf-q-pagination';
    const btn = (label, target, disabled, active) => {
        const c = ['cf-q-page-btn'];
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
        p === '…'
            ? '<span class="cf-q-page-ellipsis">…</span>'
            : btn(String(p), p, false, p === page)
    ).join('');
    return `
        <div class="${cls}">
            <div class="cf-q-page-info">Page ${page} of ${Math.max(1, totalPages)} · ${totalAll} total · ${totalView} in view</div>
            <div class="cf-q-page-controls">
                ${btn('<span class="material-icons">chevron_left</span>', page - 1, page <= 1)}
                <div class="cf-q-page-nums">${pageHtml}</div>
                ${btn('<span class="material-icons">chevron_right</span>', page + 1, page >= totalPages)}
            </div>
        </div>`;
}

// --- lazy cover loader ----------------------------------------------------

async function fillMissingCovers(host, abortSignal) {
    const placeholders = host.querySelectorAll('.cf-needs-cover[data-request-id]');
    for (const ph of placeholders) {
        if (abortSignal && abortSignal.aborted) return;
        const id = parseInt(ph.dataset.requestId || ph.dataset.request_id || '0', 10);
        if (!Number.isFinite(id) || id === 0) continue;
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
            ph.replaceWith(img);
        } catch (_) { /* leave placeholder */ }
    }
}

// --- entry point ----------------------------------------------------------

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
    let coverAbort = new AbortController();
    // Multi-select state.
    //   selectedIds  = Set of explicitly checked ids (when allMode=false)
    //   excludedIds  = Set of explicitly UN-checked ids (when allMode=true)
    //   allMode      = Select-all-across-pages active. Effective selection
    //                  = allItems' ids minus excludedIds.
    const selectedIds = new Set();
    const excludedIds = new Set();
    let allMode = false;

    function isRowSelected(id) {
        return allMode ? !excludedIds.has(id) : selectedIds.has(id);
    }
    function effectiveSelection() {
        if (!allMode) return [...selectedIds];
        // applySearch is defined below; the closure captures it lazily
        return applySearch(allItems).map((r) => r.id).filter((id) => !excludedIds.has(id));
    }
    function clearSelection() {
        selectedIds.clear();
        excludedIds.clear();
        allMode = false;
    }

    root.classList.add('cf-host', 'cf-queue-host');
    root.innerHTML = `
        <div class="cf-glass-backdrop"></div>
        <div class="cf-q-tabs">
            ${STATUS_TABS.map((t, i) => `
                <button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${t.label}</button>
            `).join('')}
        </div>
        <div class="cf-host-inner cf-queue-inner">
            <div class="cf-q-toolbar">
                <div class="cf-q-search-wrap">
                    <span class="material-icons cf-q-search-icon">search</span>
                    <input type="search" class="cf-q-search" placeholder="Search the queue…" autocomplete="off" />
                </div>
                <select class="cf-styled-select cf-q-kind">
                    ${KINDS.map(k => '<option value="' + k.value + '">' + k.label + '</option>').join('')}
                </select>
                <button class="cf-icon-button cf-q-refresh" title="Refresh">
                    <span class="material-icons">refresh</span>
                </button>
                ${isAdmin ? '<button class="cf-icon-button cf-q-sweep" title="Trigger sweep (run grabber now)"><span class="material-icons">bolt</span></button>' : ''}
            </div>
            <div class="cf-q-status-msg"></div>
            <div class="cf-q-bulkbar" hidden></div>
            <div class="cf-q-pagination-top"></div>
            <div class="cf-q-rows">${skeletonRows(PAGE_SIZE)}</div>
            <div class="cf-q-pagination-bottom"></div>
        </div>`;

    const $ = (sel) => root.querySelector(sel);
    const list      = $('.cf-q-rows');
    const msg       = $('.cf-q-status-msg');
    const searchEl  = $('.cf-q-search');
    const kindEl    = $('.cf-q-kind');
    const pagTop    = $('.cf-q-pagination-top');
    const pagBottom = $('.cf-q-pagination-bottom');

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

        list.innerHTML = slice.length
            ? slice.map(r => renderRow(r, isAdmin, isRowSelected(r.id))).join('')
            : renderEmpty(searchTerm ? 'No matches for that search.' : null);

        const pagHtml = renderPagination(currentPage, totalPages, allItems.length, filtered.length);
        pagTop.innerHTML    = pagHtml;
        pagBottom.innerHTML = pagHtml;
        renderBulkBar(filtered);

        coverAbort.abort();
        coverAbort = new AbortController();
        void fillMissingCovers(list, coverAbort.signal);
    }

    function renderBulkBar(filtered) {
        const bar = $('.cf-q-bulkbar');
        const count = effectiveSelection().length;
        const totalFiltered = filtered.length;
        if (count === 0) {
            bar.hidden = true;
            bar.innerHTML = '';
            return;
        }
        // Show "Select all X across all pages" only when the current
        // page's items are all checked but allMode isn't yet on AND
        // there are pages beyond the current view.
        const sliceStart = (currentPage - 1) * PAGE_SIZE;
        const slice = filtered.slice(sliceStart, sliceStart + PAGE_SIZE);
        const sliceAllChecked = slice.length > 0 && slice.every((r) => isRowSelected(r.id));
        const moreToSelect = !allMode && sliceAllChecked && totalFiltered > slice.length;

        bar.hidden = false;
        bar.innerHTML = `
            <span class="cf-q-bulkbar-count">${count} selected</span>
            ${moreToSelect ? '<button type="button" class="cf-q-bulkbar-link cf-q-bulkbar-selall">Select all ' + totalFiltered + ' across pages</button>' : ''}
            ${allMode ? '<button type="button" class="cf-q-bulkbar-link cf-q-bulkbar-clearall">Clear all</button>' : '<button type="button" class="cf-q-bulkbar-link cf-q-bulkbar-clear">Clear</button>'}
            <span class="cf-q-bulkbar-spacer"></span>
            ${isAdmin ? `
                <button type="button" class="cf-q-bulkbar-btn cf-q-bulkbar-retry"  title="Retry selected"><span class="material-icons">replay</span><span>Retry</span></button>
                <button type="button" class="cf-q-bulkbar-btn cf-q-bulkbar-remove cf-q-bulkbar-btn-danger" title="Remove selected"><span class="material-icons">delete_outline</span><span>Remove</span></button>
            ` : ''}
        `;
    }

    async function bulkAction(verb, ids) {
        const fn = verb === 'retry' ? api.retryRequest : api.deleteRequest;
        let ok = 0, fail = 0;
        msg.textContent = verb === 'retry' ? 'Retrying ' + ids.length + '…' : 'Removing ' + ids.length + '…';
        const CONCURRENCY = 4;
        let i = 0;
        async function worker() {
            while (i < ids.length) {
                const id = ids[i++];
                try { await fn(id); ok++; } catch (_) { fail++; }
            }
        }
        await Promise.all(Array(CONCURRENCY).fill(0).map(worker));
        msg.textContent = (verb === 'retry' ? 'Retried ' : 'Removed ') + ok + (fail ? ' (' + fail + ' failed)' : '');
    }

    async function refresh({ keepPage = false } = {}) {
        msg.textContent = '';
        const previousPage = currentPage;
        list.innerHTML = skeletonRows(PAGE_SIZE);
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
            // Preserve page on row-action refreshes (retry/blocklist/delete);
            // renderPage clamps if dataset shrunk.
            currentPage = keepPage ? previousPage : 1;
            renderPage();
        } catch (err) {
            list.innerHTML = renderError(err);
        }
    }

    // status sub-tabs
    root.querySelectorAll('.cf-q-tabs button').forEach((b) => {
        b.addEventListener('click', () => {
            root.querySelectorAll('.cf-q-tabs button').forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            activeTab = STATUS_TABS.find((t) => t.id === b.dataset.tab) || STATUS_TABS[0];
            void refresh();
        });
    });

    // Row checkbox handler. Lives outside the isAdmin gate because reading
    // is fine for non-admins (they just won't see bulk action buttons).
    list.addEventListener('change', (e) => {
        const cb = e.target.closest('.cf-q-row-check');
        if (!cb) return;
        const id = parseInt(cb.dataset.id, 10);
        if (!Number.isFinite(id)) return;
        if (allMode) {
            if (cb.checked) excludedIds.delete(id);
            else excludedIds.add(id);
        } else {
            if (cb.checked) selectedIds.add(id);
            else selectedIds.delete(id);
        }
        const row = cb.closest('.cf-q-row');
        if (row) row.classList.toggle('cf-q-row-selected', cb.checked);
        renderBulkBar(applySearch(allItems));
    });

    // Bulk action bar handler
    const bulkBar = $('.cf-q-bulkbar');
    bulkBar.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.classList.contains('cf-q-bulkbar-selall')) {
            allMode = true;
            selectedIds.clear();
            excludedIds.clear();
            renderPage();
            return;
        }
        if (btn.classList.contains('cf-q-bulkbar-clear') || btn.classList.contains('cf-q-bulkbar-clearall')) {
            clearSelection();
            renderPage();
            return;
        }
        if (btn.classList.contains('cf-q-bulkbar-retry') || btn.classList.contains('cf-q-bulkbar-remove')) {
            const ids = effectiveSelection();
            if (!ids.length) return;
            const verb = btn.classList.contains('cf-q-bulkbar-retry') ? 'retry' : 'remove';
            const noun = verb === 'retry' ? 'reset to wanted' : 'permanently removed';
            if (!confirm(ids.length + ' item' + (ids.length === 1 ? '' : 's') + ' will be ' + noun + '. Continue?')) return;
            await bulkAction(verb, ids);
            clearSelection();
            await refresh({ keepPage: true });
        }
    });

    // per-row admin actions
    if (isAdmin) {
        list.addEventListener('click', async (e) => {
            const btn = e.target.closest('button.cf-q-iconbtn');
            if (!btn) return;
            const row = btn.closest('.cf-q-row[data-id]');
            if (!row) return;
            const id = parseInt(row.dataset.id, 10);
            try {
                if (btn.classList.contains('cf-q-retry')) {
                    await api.retryRequest(id);
                    msg.textContent = 'Reset to wanted.';
                } else if (btn.classList.contains('cf-q-refresh-meta')) {
                    msg.textContent = 'Refreshing metadata…';
                    await api.refreshMetadata(id);
                    msg.textContent = 'Metadata refreshed.';
                } else if (btn.classList.contains('cf-q-regrab')) {
                    if (!confirm('Delete the existing file and re-search? This cannot be undone.')) return;
                    msg.textContent = 'Re-grabbing…';
                    await api.regrabRequest(id);
                    msg.textContent = 'Re-grab kicked off.';
                } else if (btn.classList.contains('cf-q-remove')) {
                    if (!confirm('Remove this from the queue? The author/series follow stays — you can add it again from Discover.')) return;
                    await api.deleteRequest(id);
                    msg.textContent = 'Removed from queue.';
                } else if (btn.classList.contains('cf-q-loosen')) {
                    // v3.0 search-recovery — Loosen sets the user_loosened_at
                    // flag on the request and opens the Candidates modal.
                    const cb = '?cb=' + Date.now();
                    const { open: openCandidates } = await import('./candidates_modal.js' + cb);
                    const requestRow = allItems.find((r) => r.id === id) || null;
                    await openCandidates({ requestId: id, requestRow, strictness: 'loose' });
                    return;  // modal handles UI, skip refresh
                } else if (btn.classList.contains('cf-q-candidates')) {
                    const cb = '?cb=' + Date.now();
                    const { open: openCandidates } = await import('./candidates_modal.js' + cb);
                    const requestRow = allItems.find((r) => r.id === id) || null;
                    await openCandidates({ requestId: id, requestRow, strictness: 'raw' });
                    return;
                }
                // Preserve current page after a row-level action
                await refresh({ keepPage: true });
            } catch (err) {
                msg.textContent = 'Error: ' + err.message;
            }
        });

        const sweep = root.querySelector('.cf-q-sweep');
        if (sweep) sweep.addEventListener('click', async () => {
            try {
                await api.triggerSweep();
                msg.textContent = 'Sweep started.';
                setTimeout(() => refresh({ keepPage: true }), 1500);
            } catch (err) {
                msg.textContent = 'Error: ' + err.message;
            }
        });
    }

    // pagination delegation
    [pagTop, pagBottom].forEach((host) => {
        host.addEventListener('click', (e) => {
            const btn = e.target.closest('button.cf-q-page-btn');
            if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
            const target = parseInt(btn.dataset.page, 10);
            if (!Number.isFinite(target)) return;
            currentPage = target;
            renderPage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    root.querySelector('.cf-q-refresh').addEventListener('click', refresh);
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
