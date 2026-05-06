// Manage view — list of requests with status filter and per-row actions.
// Renders as a Jellyfin-native paperList of listItems (the same pattern
// Jellyfin uses for track lists, episode lists, etc.). Actions appear in
// .listItemAside on the right; for non-admin users the actions cluster
// (and the Trigger Sweep button) hide entirely.
import { api } from './api.js';
import { isCurrentUserAdmin } from './user.js';

const STATUSES = ['wanted','searching','snatched','downloading','importing','tagging','done','failed','blocked'];
const KINDS = [
    { value: '', label: 'All' },
    { value: 'comic_issue', label: 'Comics' },
    { value: 'book', label: 'Books' },
    { value: 'audiobook', label: 'Audiobooks' },
];

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

function statusPill(s) {
    return '<span class="cf-pill cf-pill-' + s + '">' + s + '</span>';
}

function fmtDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString(); } catch (_) { return s; }
}

// "Series Name #129 — Issue Title" / "Author — Book Title" — collapses null
// fields cleanly so we never render dangling separators.
function primaryLine(r) {
    return r.series_name || r.title || '(untitled)';
}
function secondaryLine(r) {
    const parts = [];
    if (r.issue_number) parts.push('#' + r.issue_number);
    if (r.title && r.title !== r.series_name) parts.push(r.title);
    if (r.series_year) parts.push(String(r.series_year));
    if (r.release_date) parts.push(fmtDate(r.release_date));
    return parts.join(' · ');
}

export async function render(root) {
    const isAdmin = await isCurrentUserAdmin();

    // Top-level layout uses Jellyfin's standard padded-* page conventions.
    // Toolbar selects + buttons are emby-* custom elements styled by Jellyfin.
    root.innerHTML = `
        <div class="padded-left padded-right padded-top">
            <h1 class="sectionTitle">Cypherflix Manage</h1>

            <div class="cf-toolbar">
                <div class="selectContainer selectContainer-inline">
                    <label class="selectLabel" for="cf-mng-status">Status</label>
                    <select is="emby-select" id="cf-mng-status" class="emby-select-withcolor cf-status">
                        <option value="">All statuses</option>
                        ${STATUSES.map(s => '<option value="' + s + '">' + s + '</option>').join('')}
                    </select>
                </div>
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

            <div class="paperList cf-rows">
                <div class="listItem cf-loading">Loading…</div>
            </div>
        </div>`;

    const $ = (sel) => root.querySelector(sel);
    const list = $('.cf-rows');
    const statusFilter = $('.cf-status');
    const kindFilter = $('.cf-kind');
    const msg = $('.cf-status-msg');
    statusFilter.value = 'wanted';

    // Each request renders as a Jellyfin-native .listItem. The icon button
    // pattern (paper-icon-button-light + emby-button) matches the action
    // buttons used on item-detail pages (e.g. play / mark-watched).
    function renderRow(r) {
        const adminActions = isAdmin ? `
            <div class="listItem-aside cf-actions">
                <button is="paper-icon-button-light" type="button" class="paper-icon-button-light emby-button cf-retry"        title="Retry"><span class="material-icons" aria-hidden="true">replay</span></button>
                <button is="paper-icon-button-light" type="button" class="paper-icon-button-light emby-button cf-refresh-meta" title="Refresh metadata"><span class="material-icons" aria-hidden="true">cloud_sync</span></button>
                <button is="paper-icon-button-light" type="button" class="paper-icon-button-light emby-button cf-regrab"      title="Re-grab"><span class="material-icons" aria-hidden="true">file_download</span></button>
            </div>` : '';
        const progressLine = r.progress_pct == null ? '' :
            '<div class="listItemBodyText secondary">Progress: ' + Math.round(r.progress_pct) + '%</div>';
        return `
            <div class="listItem listItem-border" data-id="${r.id}">
                <div class="listItemBody two-line">
                    <div class="listItemBodyText">${escapeHtml(primaryLine(r))}</div>
                    <div class="listItemBodyText secondary">${escapeHtml(secondaryLine(r))}</div>
                    ${progressLine}
                </div>
                <div class="listItem-aside cf-status-cell">${statusPill(r.status)}</div>
                ${adminActions}
            </div>`;
    }

    async function refresh() {
        msg.textContent = '';
        list.innerHTML = '<div class="listItem cf-loading">Loading…</div>';
        try {
            const params = { limit: 200 };
            if (statusFilter.value) params.status = statusFilter.value;
            if (kindFilter.value)   params.kind   = kindFilter.value;
            const data = await api.listRequests(params);
            if (!data.items.length) {
                list.innerHTML = '<div class="listItem cf-empty">No requests in this state.</div>';
                return;
            }
            list.innerHTML = data.items.map(renderRow).join('');
        } catch (err) {
            list.innerHTML = '<div class="listItem cf-error">Error: ' + escapeHtml(err.message) + '</div>';
        }
    }

    if (isAdmin) {
        list.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const item = btn.closest('.listItem[data-id]');
            if (!item) return;
            const id = parseInt(item.dataset.id, 10);
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
    statusFilter.addEventListener('change', refresh);
    kindFilter.addEventListener('change', refresh);

    refresh();
}
