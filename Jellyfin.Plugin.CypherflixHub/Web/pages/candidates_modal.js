// Candidates modal — search-recovery escape hatch.
// Opened from the Queue tab admin row when a request is stuck. Shows raw
// indexer hits so the user can pick one to grab manually, bypassing the
// strict matcher. Per the manual-search-recovery spec, v3.0 ships Tier 3
// (raw); Tier 2 (loose mode) is wired but currently behaves identically.

let api;
let showToast;

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

function fmtBytes(n) {
    if (!n) return '';
    if (n > 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (n > 1024 * 1024)        return (n / (1024 * 1024)).toFixed(0) + ' MB';
    if (n > 1024)               return (n / 1024).toFixed(0) + ' KB';
    return String(n) + ' B';
}

function fmtAge(seconds) {
    if (seconds == null) return '';
    const days = seconds / 86400;
    if (days > 365) return (days / 365).toFixed(1) + 'y';
    if (days > 30)  return (days / 30).toFixed(1) + 'mo';
    if (days > 1)   return Math.round(days) + 'd';
    if (seconds > 3600) return Math.round(seconds / 3600) + 'h';
    return Math.round(seconds / 60) + 'm';
}

function ensureModalStyles() {
    if (document.getElementById('cypherflixCandidatesStyles')) return;
    const css = `
    #cypherflixCandidates-backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,0.7);
        z-index: 9001; display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.18s ease;
    }
    #cypherflixCandidates-backdrop.cf-cd-open { opacity: 1; }
    .cf-cd-modal {
        background: #1c1c1e; color: #fff; border-radius: 10px;
        max-width: 980px; width: calc(100% - 48px); max-height: calc(100vh - 96px);
        overflow: hidden; display: flex; flex-direction: column;
        box-shadow: 0 24px 60px rgba(0,0,0,0.6);
    }
    .cf-cd-header {
        position: relative; padding: 18px 24px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .cf-cd-title { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
    .cf-cd-subtitle { font-size: 12px; color: rgba(255,255,255,0.6); }
    .cf-cd-strictness {
        display: inline-flex; gap: 4px; margin-top: 10px;
    }
    .cf-cd-strictness button {
        padding: 4px 12px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.04); color: #fff; cursor: pointer;
        font-size: 12px; font-family: inherit;
    }
    .cf-cd-strictness button.active { background: #00a4dc; border-color: #00a4dc; }
    .cf-cd-close {
        position: absolute; top: 12px; right: 12px; width: 32px; height: 32px;
        border-radius: 50%; background: rgba(0,0,0,0.45); border: none; color: #fff;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
    }
    .cf-cd-close:hover { background: rgba(0,0,0,0.7); }
    .cf-cd-body { padding: 0 24px 20px; overflow-y: auto; }
    .cf-cd-row {
        display: grid; grid-template-columns: 1fr auto;
        gap: 12px; padding: 12px 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .cf-cd-row:last-child { border-bottom: none; }
    .cf-cd-row-title {
        font-size: 13px; line-height: 1.4; word-break: break-word;
    }
    .cf-cd-row-meta {
        font-size: 11px; color: rgba(255,255,255,0.6);
        margin-top: 4px; display: flex; gap: 10px; flex-wrap: wrap;
    }
    .cf-cd-row-actions { display: flex; gap: 6px; align-items: flex-start; }
    .cf-cd-row-actions button {
        padding: 6px 10px; border-radius: 4px; border: none; cursor: pointer;
        font-size: 12px; font-weight: 600; font-family: inherit;
        display: inline-flex; align-items: center; gap: 4px;
    }
    .cf-cd-grab { background: #00a4dc; color: #fff; }
    .cf-cd-grab:hover { background: #0078d4; }
    .cf-cd-grab[disabled] { background: rgba(76,175,80,0.85); cursor: default; }
    .cf-cd-block {
        background: rgba(239,68,68,0.18); color: #fff;
        border: 1px solid rgba(239,68,68,0.35);
    }
    .cf-cd-block:hover { background: rgba(239,68,68,0.32); }
    .cf-cd-blocked .cf-cd-row-title { opacity: 0.45; }
    .cf-cd-loading, .cf-cd-empty {
        padding: 60px 24px; text-align: center; color: rgba(255,255,255,0.6);
    }
    `;
    const style = document.createElement('style');
    style.id = 'cypherflixCandidatesStyles';
    style.textContent = css;
    document.head.appendChild(style);
}

function _escClose(e) { if (e.key === 'Escape') close(); }

function close() {
    const backdrop = document.getElementById('cypherflixCandidates-backdrop');
    if (!backdrop) return;
    backdrop.classList.remove('cf-cd-open');
    document.removeEventListener('keydown', _escClose);
    setTimeout(() => backdrop.remove(), 200);
}

function buildModal() {
    const backdrop = document.createElement('div');
    backdrop.id = 'cypherflixCandidates-backdrop';
    backdrop.innerHTML = `
        <div class="cf-cd-modal" role="dialog" aria-modal="true">
            <div class="cf-cd-header">
                <button class="cf-cd-close" aria-label="Close"><span class="material-icons">close</span></button>
                <h3 class="cf-cd-title">Candidates</h3>
                <div class="cf-cd-subtitle"></div>
                <div class="cf-cd-strictness">
                    <button data-s="strict">Strict</button>
                    <button data-s="loose">Loose</button>
                    <button data-s="raw" class="active">Raw</button>
                </div>
            </div>
            <div class="cf-cd-body">
                <div class="cf-cd-loading">
                    <span class="material-icons">hourglass_top</span> Searching indexers…
                </div>
            </div>
        </div>`;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', _escClose);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('cf-cd-open'));
    return backdrop.querySelector('.cf-cd-modal');
}

function renderRow(item, requestId) {
    const meta = [];
    if (item.indexer)     meta.push(escapeHtml(item.indexer));
    if (item.protocol)    meta.push(escapeHtml(item.protocol));
    if (item.size_bytes)  meta.push(fmtBytes(item.size_bytes));
    if (item.age_seconds) meta.push(fmtAge(item.age_seconds));
    if (item.seeders != null) meta.push('S:' + item.seeders + ' L:' + (item.leechers || 0));
    return `
        <div class="cf-cd-row${item.is_blocklisted ? ' cf-cd-blocked' : ''}"
             data-release-id="${escapeHtml(item.release_id || '')}"
             data-protocol="${escapeHtml(item.protocol || 'usenet')}">
            <div>
                <div class="cf-cd-row-title">${escapeHtml(item.title)}</div>
                <div class="cf-cd-row-meta">${meta.map((m) => '<span>' + m + '</span>').join('')}</div>
            </div>
            <div class="cf-cd-row-actions">
                <button class="cf-cd-grab" type="button"${item.is_blocklisted ? ' disabled' : ''}>
                    <span class="material-icons">download</span>Grab
                </button>
                <button class="cf-cd-block" type="button" title="Add to blocklist">
                    <span class="material-icons">block</span>
                </button>
            </div>
        </div>`;
}

async function loadStrictness(modal, requestId, strictness, requestRow) {
    const body = modal.querySelector('.cf-cd-body');
    const subtitle = modal.querySelector('.cf-cd-subtitle');
    body.innerHTML = '<div class="cf-cd-loading"><span class="material-icons">hourglass_top</span> Searching indexers…</div>';
    modal.querySelectorAll('.cf-cd-strictness button').forEach((b) => {
        b.classList.toggle('active', b.dataset.s === strictness);
    });

    try {
        const data = strictness === 'loose'
            ? await api.requestLoosen(requestId)
            : await api.requestCandidates(requestId, strictness);
        subtitle.textContent =
            (requestRow ? requestRow.title || requestRow.series_name : 'Request ' + requestId) +
            ' — query "' + (data.query || '') + '" · ' + (data.items || []).length + ' hits';
        if (!data.items || !data.items.length) {
            body.innerHTML = `
                <div class="cf-cd-empty">
                    <span class="material-icons">search_off</span>
                    <h3>No releases found</h3>
                    <p>Try a different strictness or wait — indexers may not have indexed this yet.</p>
                </div>`;
            return;
        }
        body.innerHTML = data.items.map((it) => renderRow(it, requestId)).join('');
        // Keep raw payloads on the row so we can forward to /grab.
        body.querySelectorAll('.cf-cd-row').forEach((rowEl, i) => {
            try { rowEl.dataset.payload = JSON.stringify(data.items[i]); } catch (_) {}
        });
    } catch (err) {
        body.innerHTML = `
            <div class="cf-cd-empty">
                <span class="material-icons">error_outline</span>
                <h3>Search failed</h3>
                <p>${escapeHtml(err.message || String(err))}</p>
            </div>`;
    }
}

export async function open({ requestId, requestRow, strictness }) {
    ensureModalStyles();
    const cb = '?cb=' + Date.now();
    if (!api)        ({ api }       = await import('./api.js' + cb));
    if (!showToast)  ({ showToast } = await import('./toast.js' + cb));

    const modal = buildModal();
    const start = strictness || 'raw';

    modal.querySelector('.cf-cd-close').addEventListener('click', close);
    modal.querySelectorAll('.cf-cd-strictness button').forEach((btn) => {
        btn.addEventListener('click', () => loadStrictness(modal, requestId, btn.dataset.s, requestRow));
    });

    modal.querySelector('.cf-cd-body').addEventListener('click', async (e) => {
        const grabBtn  = e.target.closest('.cf-cd-grab');
        const blockBtn = e.target.closest('.cf-cd-block');
        if (!(grabBtn || blockBtn)) return;
        const row = e.target.closest('.cf-cd-row');
        if (!row) return;
        let payload = {};
        try { payload = JSON.parse(row.dataset.payload || '{}'); } catch (_) {}
        if (grabBtn) {
            grabBtn.disabled = true;
            grabBtn.innerHTML = '<span class="material-icons">hourglass_top</span>Snatching…';
            try {
                await api.requestGrab(requestId, {
                    release_id:   payload.release_id || '',
                    download_url: payload.download_url || '',
                    title:        payload.title || '',
                    protocol:     payload.protocol || 'usenet',
                    indexer:      payload.indexer || null,
                    size_bytes:   payload.size_bytes || null,
                });
                grabBtn.innerHTML = '<span class="material-icons">check</span>Snatched';
                showToast(`Grabbed: ${payload.title || 'release'}`);
                setTimeout(close, 800);
            } catch (err) {
                grabBtn.disabled = false;
                grabBtn.innerHTML = '<span class="material-icons">download</span>Grab';
                showToast(`Couldn't grab: ${err.message || err}`);
            }
        } else if (blockBtn) {
            row.classList.add('cf-cd-blocked');
            const grab = row.querySelector('.cf-cd-grab');
            if (grab) grab.disabled = true;
            showToast('Blocked from future searches.');
            // The /requests/{id}/blocklist-release endpoint takes a numeric
            // release_id from `releases` — these candidates aren't in that
            // table yet (no auto-grab attempt). For v3.0 we just hide it
            // visually; v3.1 will plumb a per-title blocklist endpoint.
        }
    });

    await loadStrictness(modal, requestId, start, requestRow);
}

export const candidatesModal = { open, close };
