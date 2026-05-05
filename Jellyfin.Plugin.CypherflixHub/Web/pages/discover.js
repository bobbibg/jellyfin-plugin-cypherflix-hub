// Discover view — backend health + watchlist summary. Catalog/search lands once
// the backend's /api/v1/catalog/{kind}/* endpoints ship.
import { api } from './api.js';

export async function render(root) {
    root.innerHTML = `
        <div class="cf-discover">
            <h2>Discover</h2>
            <div class="cf-card">
                <h3>Backend</h3>
                <div class="cf-health">Checking…</div>
            </div>
            <div class="cf-card">
                <h3>Watchlist</h3>
                <div class="cf-watchlist-summary">Loading…</div>
            </div>
            <div class="cf-card">
                <h3>Search & subscribe</h3>
                <p class="cf-muted">
                    Live catalogue search lands when the backend's
                    <code>/api/v1/catalog/{kind}/*</code> endpoints ship. Until then,
                    use the <strong>Manage</strong> tab to drive the existing
                    requests, or POST a watchlist directly via the API.
                </p>
            </div>
        </div>`;

    const health = root.querySelector('.cf-health');
    const wl = root.querySelector('.cf-watchlist-summary');

    try {
        const h = await api.health();
        health.innerHTML = `
            <div class="cf-status-row"><strong>Status:</strong> <span class="cf-pill cf-pill-done">${escapeHtml(h.status)}</span></div>
            <div class="cf-status-row"><strong>Version:</strong> ${escapeHtml(h.version)}</div>
            <div class="cf-status-row"><strong>Search in flight:</strong> ${h.in_flight && h.in_flight.search ? 'yes' : 'no'}</div>
            ${h.clients ? renderClients(h.clients) : ''}`;
    } catch (err) {
        health.innerHTML = `<div class="cf-error">Unreachable: ${escapeHtml(err.message)}</div>`;
    }

    try {
        const data = await api.listWatchlist();
        const byKind = {};
        for (const w of (data.items || [])) byKind[w.kind] = (byKind[w.kind] || 0) + 1;
        wl.innerHTML = `
            <div>Total: <strong>${data.total ?? 0}</strong></div>
            <ul class="cf-list">
                ${Object.entries(byKind).map(([k, n]) => `<li>${escapeHtml(k)}: <strong>${n}</strong></li>`).join('') || '<li class="cf-muted">No watchlists yet.</li>'}
            </ul>`;
    } catch (err) {
        wl.innerHTML = `<div class="cf-error">Couldn't load watchlist: ${escapeHtml(err.message)}</div>`;
    }
}

function renderClients(clients) {
    const rows = Object.entries(clients).map(([name, snap]) => `
        <tr>
            <td>${escapeHtml(name)}</td>
            <td>${snap.breaker_open ? '<span class="cf-pill cf-pill-failed">open</span>' : '<span class="cf-pill cf-pill-done">closed</span>'}</td>
            <td>${snap.requests_last_minute}/min</td>
            <td>${snap.requests_last_hour}/hr</td>
        </tr>`).join('');
    return `
        <details>
            <summary>Provider clients</summary>
            <table class="cf-table cf-table-sm">
                <thead><tr><th>Source</th><th>Breaker</th><th>1m</th><th>1h</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </details>`;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
