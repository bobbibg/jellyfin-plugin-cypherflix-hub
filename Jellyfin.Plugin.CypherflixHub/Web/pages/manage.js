// Manage view — visually matched to the KefinTweaks Watchlist plugin.
// Reuses its .watchlist-tabs / .progress-card / .progress-poster /
// .progress-details / .progress-actions class names so its CSS styles
// our elements automatically.
//
// Imports happen INSIDE render() with a cache-buster so we never get
// stuck on a stale cached api.js after a plugin upgrade — Cache-Control
// alone doesn't evict the ES-module-graph cache when URLs are stable.
let api;
let isCurrentUserAdmin;

// Status sub-tab grouping — collapses the nine raw DB states into the
// five buckets users actually care about. The "In progress" group covers
// every state that means "the request is being worked on right now".
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

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

function fmtDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString(); } catch (_) { return s; }
}

function statusPill(s) {
    return '<span class="cf-pill cf-pill-' + s + '">' + s + '</span>';
}

// One card per request — DOM mirrors KefinTweaks's progress-card so its
// stylesheet (loaded by their plugin) styles us for free.
function renderCard(r, isAdmin) {
    const kindIcon = r.kind === 'book' ? 'menu_book'
        : r.kind === 'audiobook' ? 'headphones'
        : 'auto_stories';   // comics → book-stack

    const titleParts = [];
    if (r.series_name) titleParts.push(r.series_name);
    if (r.issue_number) titleParts.push('#' + r.issue_number);
    const primary = titleParts.join(' ') || r.title || '(untitled)';
    const subtitle = r.title && r.title !== r.series_name ? r.title : '';

    const stats = [];
    if (r.series_year)  stats.push(String(r.series_year));
    if (r.release_date) stats.push('Released ' + fmtDate(r.release_date));
    if (r.authors)      stats.push(r.authors);
    if (r.progress_pct != null) stats.push(Math.round(r.progress_pct) + '%');

    const actions = isAdmin ? `
        <div class="progress-actions">
            <button class="action-link cf-retry"        title="Reset to wanted">+ Retry</button>
            <button class="action-link cf-refresh-meta" title="Refresh metadata from providers">+ Refresh metadata</button>
            <button class="action-link cf-regrab"      title="Delete file and re-search">+ Re-grab</button>
        </div>` : '';

    return `
        <div class="progress-card cf-request-card" data-id="${r.id}">
            <div class="progress-card-content">
                <div class="progress-poster cf-progress-poster">
                    <span class="material-icons cf-poster-fallback" aria-hidden="true">${kindIcon}</span>
                </div>
                <div class="progress-details">
                    <div class="progress-header">
                        <h3 class="progress-title">${escapeHtml(primary)}</h3>
                        ${statusPill(r.status)}
                    </div>
                    ${subtitle ? '<div class="progress-last-watched">' + escapeHtml(subtitle) + '</div>' : ''}
                    <div class="progress-stats">${stats.map(escapeHtml).join(' · ')}</div>
                    ${r.status_reason ? '<div class="progress-last-watched cf-status-reason">' + escapeHtml(r.status_reason) + '</div>' : ''}
                    ${actions}
                </div>
            </div>
        </div>`;
}

export async function render(root) {
    const cb = '?cb=' + Date.now();
    ({ api } = await import('./api.js' + cb));
    ({ isCurrentUserAdmin } = await import('./user.js' + cb));
    const isAdmin = await isCurrentUserAdmin();

    // Wrap in a sibling-of-watchlist .sections div so KefinTweaks-scoped
    // CSS rules (which are typically scoped to .sections.watchlist) still
    // partially apply. We add our own `.cypherflix-manage` modifier for any
    // tweaks specific to this page.
    root.innerHTML = `
        <div class="padded-left padded-right padded-top">
            <h1 class="sectionTitle">Manage Requests</h1>

            <div class="cypherflix-manage">
                <div class="watchlist-tabs cf-status-tabs">
                    ${STATUS_TABS.map((t, i) => `
                        <button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${t.label}</button>
                    `).join('')}
                </div>
                <div class="cf-toolbar">
                    <div class="selectContainer selectContainer-inline">
                        <label class="selectLabel" for="cf-mng-kind">Kind</label>
                        <select is="emby-select" id="cf-mng-kind" class="emby-select-withcolor cf-kind">
                            ${KINDS.map(k => '<option value="' + k.value + '">' + k.label + '</option>').join('')}
                        </select>
                    </div>
                    <button is="emby-button" type="button" class="raised button-flat cf-refresh">
                        <span class="material-icons" aria-hidden="true">refresh</span>
                        <span>Refresh</span>
                    </button>
                    ${isAdmin ? `
                    <button is="emby-button" type="button" class="raised button-flat cf-sweep">
                        <span class="material-icons" aria-hidden="true">play_arrow</span>
                        <span>Trigger sweep</span>
                    </button>` : ''}
                    <span class="cf-status-msg"></span>
                </div>

                <div class="cf-cards">
                    <div class="progress-card cf-loading">Loading…</div>
                </div>
            </div>
        </div>`;

    const $ = (sel) => root.querySelector(sel);
    const cardsHost = $('.cf-cards');
    const kindFilter = $('.cf-kind');
    const msg = $('.cf-status-msg');

    let activeTab = STATUS_TABS[0];

    async function refresh() {
        msg.textContent = '';
        cardsHost.innerHTML = '<div class="progress-card cf-loading">Loading…</div>';
        try {
            const items = [];
            const statuses = activeTab.statuses || [null];
            // For multi-status tabs we issue one fetch per status and merge.
            // The backend pages per-status anyway and this keeps the limit
            // semantics predictable per group.
            for (const s of statuses) {
                const params = { limit: 200 };
                if (s) params.status = s;
                if (kindFilter.value) params.kind = kindFilter.value;
                const data = await api.listRequests(params);
                items.push(...(data.items || []));
            }
            if (!items.length) {
                cardsHost.innerHTML = '<div class="progress-card cf-empty">No requests in this view.</div>';
                return;
            }
            // Sort: most-recently-updated first.
            items.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
            cardsHost.innerHTML = items.map(r => renderCard(r, isAdmin)).join('');
        } catch (err) {
            cardsHost.innerHTML = '<div class="progress-card cf-error">Error: ' + escapeHtml(err.message) + '</div>';
        }
    }

    // Status sub-tab switching. Mirrors KefinTweaks's pattern: toggle
    // .active on the buttons, then re-fetch with the new filter set.
    root.querySelectorAll('.cf-status-tabs button').forEach((b) => {
        b.addEventListener('click', () => {
            root.querySelectorAll('.cf-status-tabs button').forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            activeTab = STATUS_TABS.find((t) => t.id === b.dataset.tab) || STATUS_TABS[0];
            void refresh();
        });
    });

    if (isAdmin) {
        cardsHost.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
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

    root.querySelector('.cf-refresh').addEventListener('click', refresh);
    kindFilter.addEventListener('change', refresh);

    refresh();
}
