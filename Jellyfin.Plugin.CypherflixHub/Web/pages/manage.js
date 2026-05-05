// Manage view — list of requests with status filter and per-row actions.
import { api } from './api.js';

const STATUSES = ['wanted','searching','snatched','downloading','importing','tagging','done','failed','blocked'];
const KINDS = [
    { value: '', label: 'All' },
    { value: 'comic_issue', label: 'Comics' },
    { value: 'book', label: 'Books' },
    { value: 'audiobook', label: 'Audiobooks' },
];

function statusClass(s) { return 'cf-pill cf-pill-' + s; }
function fmtDate(s) { if (!s) return ''; try { return new Date(s).toLocaleDateString(); } catch(_) { return s; } }
function rowTitle(r) {
    const parts = [];
    if (r.series_name) parts.push(r.series_name);
    if (r.issue_number) parts.push('#' + r.issue_number);
    if (r.title) parts.push('— ' + r.title);
    return parts.join(' ');
}

export function render(root) {
    root.innerHTML = `
        <div class="cf-toolbar">
            <select class="cf-filter cf-status">
                <option value="">All statuses</option>
                ${STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
            <select class="cf-filter cf-kind">
                ${KINDS.map(k => `<option value="${k.value}">${k.label}</option>`).join('')}
            </select>
            <button class="cf-btn cf-refresh">Refresh</button>
            <button class="cf-btn cf-sweep">Trigger sweep</button>
            <span class="cf-status-msg"></span>
        </div>
        <div class="cf-table-wrap">
            <table class="cf-table">
                <thead><tr>
                    <th>Series</th><th>Issue / Title</th><th>Year</th><th>Released</th>
                    <th>Status</th><th>Progress</th><th>Actions</th>
                </tr></thead>
                <tbody class="cf-rows"><tr><td colspan="7" class="cf-loading">Loading…</td></tr></tbody>
            </table>
        </div>`;

    const $ = (sel) => root.querySelector(sel);
    const tbody = $('.cf-rows');
    const statusFilter = $('.cf-status');
    const kindFilter = $('.cf-kind');
    const msg = $('.cf-status-msg');
    statusFilter.value = 'wanted';

    async function refresh() {
        msg.textContent = '';
        tbody.innerHTML = '<tr><td colspan="7" class="cf-loading">Loading…</td></tr>';
        try {
            const params = { limit: 200 };
            if (statusFilter.value) params.status = statusFilter.value;
            if (kindFilter.value) params.kind = kindFilter.value;
            const data = await api.listRequests(params);
            if (!data.items.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="cf-empty">No requests in this state.</td></tr>';
                return;
            }
            tbody.innerHTML = data.items.map(r => `
                <tr data-id="${r.id}">
                    <td>${escapeHtml(r.series_name || '')}</td>
                    <td>${escapeHtml(rowTitle(r))}</td>
                    <td>${r.series_year ?? ''}</td>
                    <td>${fmtDate(r.release_date)}</td>
                    <td><span class="${statusClass(r.status)}">${r.status}</span></td>
                    <td>${r.progress_pct == null ? '' : Math.round(r.progress_pct) + '%'}</td>
                    <td class="cf-actions">
                        <button class="cf-btn cf-btn-sm cf-retry">Retry</button>
                        <button class="cf-btn cf-btn-sm cf-refresh-meta">Refresh metadata</button>
                        <button class="cf-btn cf-btn-sm cf-regrab">Re-grab</button>
                    </td>
                </tr>`).join('');
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" class="cf-error">Error: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    tbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const tr = btn.closest('tr');
        if (!tr) return;
        const id = parseInt(tr.dataset.id, 10);
        try {
            if (btn.classList.contains('cf-retry'))            { await api.retryRequest(id); msg.textContent = 'Reset to wanted.'; }
            else if (btn.classList.contains('cf-refresh-meta')){ msg.textContent = 'Refreshing metadata…'; await api.refreshMetadata(id); msg.textContent = 'Metadata refreshed.'; }
            else if (btn.classList.contains('cf-regrab'))      {
                if (!confirm('Delete the existing file and re-search? This cannot be undone.')) return;
                msg.textContent = 'Re-grabbing…'; await api.regrabRequest(id); msg.textContent = 'Re-grab kicked off.';
            }
            await refresh();
        } catch (err) { msg.textContent = 'Error: ' + err.message; }
    });

    $('.cf-refresh').addEventListener('click', refresh);
    $('.cf-status').addEventListener('change', refresh);
    $('.cf-kind').addEventListener('change', refresh);
    $('.cf-sweep').addEventListener('click', async () => {
        try { await api.triggerSweep(); msg.textContent = 'Sweep started.'; setTimeout(refresh, 1500); }
        catch (err) { msg.textContent = 'Error: ' + err.message; }
    });

    refresh();
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
