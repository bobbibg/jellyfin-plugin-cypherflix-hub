/**
 * Candidates modal — search-recovery escape hatch.
 *
 * Opened from the Queue tab when a request is stuck. Shows raw indexer
 * hits so the user can pick one to grab manually, bypassing the strict
 * matcher.
 *
 * Strictness modes (from the manual-search-recovery spec):
 *   - strict — pre-filtered by the matcher (default)
 *   - loose  — auto-loosened query (also calls /loosen so the request
 *              keeps using loose strictness on subsequent searches)
 *   - raw    — full raw indexer hits, no filtering
 */

import {
    requestCandidates,
    loosenRequest,
    requestGrab,
    blocklistRelease,
} from '../state/api';
import { showToast } from './toast';
import type {
    Candidate,
    CandidateStrictness,
    RequestRow,
} from '../types/api';

export interface CandidatesModalOpts {
    requestId: number;
    /** Optional — used for the modal subtitle. */
    requestRow?: RequestRow;
    /** Default strictness on open; defaults to `raw`. */
    strictness?: CandidateStrictness;
}

const STYLE_ID = 'cypherflixCandidatesStyles';
const BACKDROP_ID = 'cypherflixCandidates-backdrop';

let escListener: ((e: KeyboardEvent) => void) | null = null;

export function open(opts: CandidatesModalOpts): Promise<void> {
    ensureStyles();
    const modal = buildModal();
    const start = opts.strictness ?? 'raw';

    const closeBtn = modal.querySelector<HTMLButtonElement>('.cf-cd-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    modal.querySelectorAll<HTMLButtonElement>('.cf-cd-strictness button').forEach((btn) => {
        btn.addEventListener('click', () => {
            const s = btn.dataset['s'] as CandidateStrictness | undefined;
            if (s) void loadStrictness(modal, opts.requestId, s, opts.requestRow);
        });
    });

    const body = modal.querySelector<HTMLElement>('.cf-cd-body');
    if (body) {
        body.addEventListener('click', (e) => {
            void handleBodyClick(e, opts.requestId);
        });
    }

    return loadStrictness(modal, opts.requestId, start, opts.requestRow);
}

export function close(): void {
    const backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) return;
    backdrop.classList.remove('cf-cd-open');
    if (escListener) {
        document.removeEventListener('keydown', escListener);
        escListener = null;
    }
    window.setTimeout(() => backdrop.remove(), 200);
}

/* -------------------------------------------------------------------------
 * Internals
 * ----------------------------------------------------------------------- */

function buildModal(): HTMLElement {
    const backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.innerHTML =
        `<div class="cf-cd-modal" role="dialog" aria-modal="true">` +
        `<div class="cf-cd-header">` +
        `<button class="cf-cd-close" aria-label="Close" type="button">` +
        `<span class="material-icons">close</span>` +
        `</button>` +
        `<h3 class="cf-cd-title">Candidates</h3>` +
        `<div class="cf-cd-subtitle"></div>` +
        `<div class="cf-cd-strictness">` +
        `<button data-s="strict" type="button">Strict</button>` +
        `<button data-s="loose" type="button">Loose</button>` +
        `<button data-s="raw" type="button" class="active">Raw</button>` +
        `</div>` +
        `</div>` +
        `<div class="cf-cd-body">` +
        `<div class="cf-cd-loading">` +
        `<span class="material-icons">hourglass_top</span> Searching indexers…` +
        `</div>` +
        `</div>` +
        `</div>`;

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close();
    });
    escListener = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', escListener);

    document.body.appendChild(backdrop);
    window.requestAnimationFrame(() => backdrop.classList.add('cf-cd-open'));

    const modal = backdrop.querySelector<HTMLElement>('.cf-cd-modal');
    if (!modal) throw new Error('candidates modal failed to build');
    return modal;
}

async function loadStrictness(
    modal: HTMLElement,
    requestId: number,
    strictness: CandidateStrictness,
    requestRow: RequestRow | undefined,
): Promise<void> {
    const body = modal.querySelector<HTMLElement>('.cf-cd-body');
    const subtitle = modal.querySelector<HTMLElement>('.cf-cd-subtitle');
    if (!body || !subtitle) return;

    body.innerHTML =
        `<div class="cf-cd-loading">` +
        `<span class="material-icons">hourglass_top</span> Searching indexers…` +
        `</div>`;
    modal.querySelectorAll<HTMLButtonElement>('.cf-cd-strictness button').forEach((b) => {
        b.classList.toggle('active', b.dataset['s'] === strictness);
    });

    try {
        let items: Candidate[];
        let query: string;
        if (strictness === 'loose') {
            const detail = await loosenRequest(requestId);
            // Loosen kicks an internal search and returns the request
            // detail; for a fresh candidates list we still need to call
            // /candidates afterwards.
            void detail;
            const c = await requestCandidates(requestId, 'loose');
            items = c.items;
            query = c.query;
        } else {
            const c = await requestCandidates(requestId, strictness);
            items = c.items;
            query = c.query;
        }

        const titleText = requestRow
            ? requestRow.title ?? requestRow.series_name
            : 'Request ' + requestId;
        subtitle.textContent = `${titleText} — query "${query}" · ${items.length} hits`;

        if (items.length === 0) {
            body.innerHTML =
                `<div class="cf-cd-empty">` +
                `<span class="material-icons">search_off</span>` +
                `<h3>No releases found</h3>` +
                `<p>Try a different strictness or wait — indexers may not have indexed this yet.</p>` +
                `</div>`;
            return;
        }

        body.innerHTML = items.map(renderRow).join('');
        body.querySelectorAll<HTMLElement>('.cf-cd-row').forEach((rowEl, i) => {
            const item = items[i];
            if (item) rowEl.dataset['payload'] = JSON.stringify(item);
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        body.innerHTML =
            `<div class="cf-cd-empty">` +
            `<span class="material-icons">error_outline</span>` +
            `<h3>Search failed</h3>` +
            `<p>${escapeHtml(msg)}</p>` +
            `</div>`;
    }
}

async function handleBodyClick(e: MouseEvent, requestId: number): Promise<void> {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const grabBtn = target.closest<HTMLButtonElement>('.cf-cd-grab');
    const blockBtn = target.closest<HTMLButtonElement>('.cf-cd-block');
    if (!grabBtn && !blockBtn) return;

    const row = target.closest<HTMLElement>('.cf-cd-row');
    if (!row) return;

    let payload: Partial<Candidate> = {};
    try {
        payload = JSON.parse(row.dataset['payload'] ?? '{}') as Partial<Candidate>;
    } catch {
        /* fall back to empty */
    }

    if (grabBtn) {
        grabBtn.disabled = true;
        grabBtn.innerHTML = '<span class="material-icons">hourglass_top</span>Snatching…';
        try {
            await requestGrab(requestId, {
                release_id: payload.release_id ?? '',
                download_url: payload.download_url ?? '',
                title: payload.title ?? '',
                protocol: payload.protocol ?? 'usenet',
                indexer: payload.indexer ?? null,
                size_bytes: payload.size_bytes ?? null,
            });
            grabBtn.innerHTML = '<span class="material-icons">check</span>Snatched';
            showToast(`Grabbed: ${payload.title ?? 'release'}`);
            window.setTimeout(close, 800);
        } catch (err) {
            grabBtn.disabled = false;
            grabBtn.innerHTML = '<span class="material-icons">download</span>Grab';
            const msg = err instanceof Error ? err.message : String(err);
            showToast(`Couldn't grab: ${msg}`);
        }
        return;
    }

    if (blockBtn) {
        row.classList.add('cf-cd-blocked');
        const grab = row.querySelector<HTMLButtonElement>('.cf-cd-grab');
        if (grab) grab.disabled = true;
        // Try the release-level blocklist endpoint. Candidates from /candidates
        // don't always carry a numeric release row id (only attempted grabs
        // do), so this may 404 — in which case we still hide visually.
        const releaseIdNumeric = Number(payload.release_id);
        if (Number.isFinite(releaseIdNumeric)) {
            try {
                await blocklistRelease(requestId, {
                    release_id: releaseIdNumeric,
                    reason: 'manual block from candidates modal',
                });
                showToast('Blocked from future searches.');
                return;
            } catch {
                /* fall through to optimistic-only behaviour */
            }
        }
        showToast('Hidden from this list.');
    }
}

function renderRow(item: Candidate): string {
    const meta: string[] = [];
    if (item.indexer) meta.push(escapeHtml(item.indexer));
    if (item.protocol) meta.push(escapeHtml(item.protocol));
    if (item.size_bytes) meta.push(fmtBytes(item.size_bytes));
    if (item.age_seconds != null) meta.push(fmtAge(item.age_seconds));
    if (item.seeders != null) meta.push(`S:${item.seeders} L:${item.leechers ?? 0}`);

    const releaseId = item.release_id ?? '';
    const protocol = item.protocol ?? 'usenet';
    const blockedClass = item.is_blocklisted ? ' cf-cd-blocked' : '';
    const grabDisabled = item.is_blocklisted ? ' disabled' : '';
    const metaHtml = meta.map((m) => `<span>${m}</span>`).join('');

    return (
        `<div class="cf-cd-row${blockedClass}"` +
        ` data-release-id="${escapeHtml(releaseId)}"` +
        ` data-protocol="${escapeHtml(protocol)}">` +
        `<div>` +
        `<div class="cf-cd-row-title">${escapeHtml(item.title)}</div>` +
        `<div class="cf-cd-row-meta">${metaHtml}</div>` +
        `</div>` +
        `<div class="cf-cd-row-actions">` +
        `<button class="cf-cd-grab" type="button"${grabDisabled}>` +
        `<span class="material-icons">download</span>Grab` +
        `</button>` +
        `<button class="cf-cd-block" type="button" title="Add to blocklist">` +
        `<span class="material-icons">block</span>` +
        `</button>` +
        `</div>` +
        `</div>`
    );
}

function fmtBytes(n: number): string {
    if (!n) return '';
    if (n > 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (n > 1024 * 1024) return (n / (1024 * 1024)).toFixed(0) + ' MB';
    if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
    return String(n) + ' B';
}

function fmtAge(seconds: number): string {
    const days = seconds / 86400;
    if (days > 365) return (days / 365).toFixed(1) + 'y';
    if (days > 30) return (days / 30).toFixed(1) + 'mo';
    if (days > 1) return Math.round(days) + 'd';
    if (seconds > 3600) return Math.round(seconds / 3600) + 'h';
    return Math.round(seconds / 60) + 'm';
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        c === '&' ? '&amp;' :
        c === '<' ? '&lt;' :
        c === '>' ? '&gt;' :
        c === '"' ? '&quot;' :
        '&#39;',
    );
}

function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
    #${BACKDROP_ID} {
        position: fixed; inset: 0; background: rgba(0,0,0,0.7);
        z-index: 9001; display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.18s ease;
    }
    #${BACKDROP_ID}.cf-cd-open { opacity: 1; }
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
    .cf-cd-strictness { display: inline-flex; gap: 4px; margin-top: 10px; }
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
    .cf-cd-row-title { font-size: 13px; line-height: 1.4; word-break: break-word; }
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
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
}

export const candidatesModal = { open, close };
