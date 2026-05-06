// Manage view — list of requests with status filter and per-row actions.
// Renders into a routed page using Jellyfin's own classes (.detailTable,
// .raised, .button-flat, .selectContainer). Actions column hides for
// non-admin users.
import { api } from './api.js';
import { isCurrentUserAdmin } from './user.js';

const STATUSES = ['wanted','searching','snatched','downloading','importing','tagging','done','failed','blocked'];
const KINDS = [
    { value: '', label: 'All' },
    { value: 'comic_issue', label: 'Comics' },
    { value: 'book', label: 'Books' },
    { value: 'audiobook', label: 'Audiobooks' },
];

function statusPill(s) {
    return '<span class="cf-pill cf-pill-' + s + '">' + s + '</span>';
}
function fmtDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString(); } catch (_) { return s; }
}
function rowTitle(r) {
    const parts = [];
    if (r.issue_number) parts.push('#' + r.issue_number);
    if (r.title) parts.push(r.title);
    return parts.join(' — ');
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

export async function render(root) {
    const isAdmin = await isCurrentUserAdmin();

    // Use Jellyfin's .padded-* + .sectionTitle conventions so the layout
    // matches every other native page.
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

            <div class="detailTable-wrapper">
                <table class="detailTable cf-table-requests">
                    <thead>
                        <tr>
                            <th class="detailTableHeaderCell">Series</th>
                            <th class="detailTableHeaderCell">Issue / Title</th>
                            <th class="detailTableHeaderCell">Year</th>
                            <th class="detailTableHeaderCell">Released</th>
                            <th class="detailTableHeaderCell">Status</th>
                            <th class="detailTableHeaderCell">Progress</th>
                            ${isAdmin ? '<th class="detailTableHeaderCell">Actions</th>' : ''}
                        </tr>
                    </thead>
                    <tbody class="cf-rows">
                        <tr><td colspan="${isAdmin ? 7 : 6}" class="detailTableBodyCell cf-loading">Loading…</td></tr>
                    </tbody>
                </table>
            </div>
        </div>`;

    const $ = (sel) => root.querySelector(sel);
    const tbody = $('.cf-rows');
    const statusFilter = $('.cf-status');
    const kindFilter = $('.cf-kind');
    const msg = $('.cf-status-msg');
    statusFilter.value = 'wanted';

    async function refresh() {
        msg.textContent = '';
        const cols = isAdmin ? 7 : 6;
        tbody.innerHTML = `<tr><td colspan="${cols}" class="detailTableBodyCell cf-loading">Loading…</td></tr>`;
        try {
            const params = { limit: 200 };
            if (statusFilter.value) params.status = statusFilter.value;
            if (kindFilter.value) params.kind = kindFilter.value;
            const data = await api.listRequests(params);
            if (!data.items.length) {
                tbody.innerHTML = `<tr><td colspan="${cols}" class="detailTableBodyCell cf-empty">No requests in this state.</td></tr>`;
                return;
            }
            tbody.innerHTML = data.items.map(r => `
                <tr data-id="${r.id}">
                    <td class="detailTableBodyCell">${escapeHtml(r.series_name || '')}</td>
                    <td class="detailTableBodyCell">${escapeHtml(rowTitle(r))}</td>
                    <td class="detailTableBodyCell">${r.series_year == null ? '' : r.series_year}</td>
                    <td class="detailTableBodyCell">${fmtDate(r.release_date)}</td>
                    <td class="detailTableBodyCell">${statusPill(r.status)}</td>
                    <td class="detailTableBodyCell">${r.progress_pct == null ? '' : Math.round(r.progress_pct) + '%'}</td>
                    ${isAdmin ? `
                    <td class="detailTableBodyCell cf-actions">
                        <button is="emby-button" type="button" class="raised button-flat button-flat-mini cf-retry" title="Retry"><span class="material-icons" aria-hidden="true">replay</span></button>
                        <button is="emby-button" type="button" class="raised button-flat button-flat-mini cf-refresh-meta" title="Refresh metadata"><span class="material-icons" aria-hidden="true">cloud_sync</span></button>
                        <button is="emby-button" type="button" class="raised button-flat button-flat-mini cf-regrab" title="Re-grab"><span class="material-icons" aria-hidden="true">file_download</span></button>
                    </td>` : ''}
                </tr>`).join('');
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="${cols}" class="detailTableBodyCell cf-error">Error: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    if (isAdmin) {
        tbody.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const tr = btn.closest('tr');
            if (!tr) return;
            const id = parseInt(tr.dataset.id, 10);
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
