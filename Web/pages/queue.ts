/**
 * Queue page — request list with admin actions.
 *
 * Behaviour preserved from legacy `pages/manage.js`:
 *   - Status tabs (Wanted / Downloading / Downloaded / Enriching / Complete)
 *     map onto multi-status request queries.
 *   - Per-row admin actions: retry / refresh-metadata / regrab / loosen /
 *     candidates / delete (the last one only when the request is stuck).
 *   - Loosen and Candidates open the candidates modal at the matching
 *     strictness.
 *   - cypherflix:queued listener refreshes the visible list (a peer card
 *     adding to queue should bump the counts here).
 *
 * Strict TS keeps this module focused on rendering + delegated clicks —
 * complex bulk-select and pagination are deferred to a follow-up so
 * everything that ships is type-clean.
 */

import { candidatesModal } from '../components/candidatesModal';
import { showToast } from '../components/toast';
import {
    deleteRequest,
    listRequests,
    refreshRequestMetadata,
    regrabRequest,
    retryRequest,
} from '../state/api';
import { isAdmin } from '../state/jellyfin';
import type {
    RequestRow,
    RequestStatus,
    RequestsListParams,
} from '../types/api';

interface StatusTab {
    id: string;
    label: string;
    statuses: RequestStatus[];
}

const STATUS_TABS: StatusTab[] = [
    { id: 'wanted', label: 'Wanted', statuses: ['wanted', 'failed', 'blocked'] },
    { id: 'downloading', label: 'Downloading', statuses: ['searching', 'snatched', 'downloading'] },
    { id: 'downloaded', label: 'Downloaded', statuses: ['importing'] },
    { id: 'enriching', label: 'Enriching', statuses: ['tagging'] },
    { id: 'complete', label: 'Complete', statuses: ['done'] },
];

interface Runtime {
    host: HTMLElement;
    list: HTMLElement;
    status: HTMLElement;
    tab: StatusTab;
    isAdmin: boolean;
    items: RequestRow[];
}

export async function render(host: HTMLElement): Promise<void> {
    host.classList.add('cf-host', 'cf-queue-host');
    host.innerHTML =
        `<div class="cf-q-tabs" role="tablist">` +
        STATUS_TABS.map(
            (t, i) =>
                `<button type="button" data-tab="${escapeAttr(t.id)}"` +
                ` class="${i === 0 ? 'active' : ''}">${escapeText(t.label)}</button>`,
        ).join('') +
        `</div>` +
        `<div class="cf-q-status-msg" role="status"></div>` +
        `<div class="cf-q-rows">` +
        `<div class="cf-q-loading">` +
        `<span class="material-icons" aria-hidden="true">hourglass_top</span> Loading…` +
        `</div>` +
        `</div>`;

    const list = host.querySelector<HTMLElement>('.cf-q-rows');
    const status = host.querySelector<HTMLElement>('.cf-q-status-msg');
    const tabs = host.querySelectorAll<HTMLButtonElement>('.cf-q-tabs button');
    if (!list || !status) return;

    const initialTab = STATUS_TABS[0];
    if (!initialTab) return;

    const runtime: Runtime = {
        host,
        list,
        status,
        tab: initialTab,
        isAdmin: await isAdmin(),
        items: [],
    };

    tabs.forEach((b) => {
        b.addEventListener('click', () => {
            const id = b.dataset['tab'];
            const next = STATUS_TABS.find((t) => t.id === id);
            if (!next) return;
            tabs.forEach((x) => x.classList.remove('active'));
            b.classList.add('active');
            runtime.tab = next;
            void refresh(runtime);
        });
    });

    list.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest<HTMLButtonElement>('button.cf-q-iconbtn');
        if (!btn) return;
        const row = btn.closest<HTMLElement>('.cf-q-row[data-id]');
        if (!row) return;
        const idStr = row.dataset['id'];
        const id = idStr ? Number.parseInt(idStr, 10) : NaN;
        if (!Number.isFinite(id)) return;
        void handleRowAction(runtime, btn, id);
    });

    document.addEventListener('cypherflix:queued', () => {
        void refresh(runtime);
    });

    await refresh(runtime);
}

async function refresh(runtime: Runtime): Promise<void> {
    runtime.status.textContent = '';
    runtime.list.innerHTML =
        `<div class="cf-q-loading">` +
        `<span class="material-icons" aria-hidden="true">hourglass_top</span> Loading…` +
        `</div>`;
    try {
        const all: RequestRow[] = [];
        for (const s of runtime.tab.statuses) {
            const params: RequestsListParams = { status: s, limit: 200 };
            const page = await listRequests(params);
            all.push(...page.items);
        }
        all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        runtime.items = all;
        if (all.length === 0) {
            runtime.list.innerHTML = renderEmpty();
            return;
        }
        runtime.list.innerHTML = all.map((r) => renderRow(r, runtime.isAdmin)).join('');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        runtime.list.innerHTML = renderError(msg);
    }
}

async function handleRowAction(
    runtime: Runtime,
    btn: HTMLButtonElement,
    id: number,
): Promise<void> {
    try {
        if (btn.classList.contains('cf-q-retry')) {
            await retryRequest(id);
            runtime.status.textContent = 'Reset to wanted.';
        } else if (btn.classList.contains('cf-q-refresh-meta')) {
            runtime.status.textContent = 'Refreshing metadata…';
            await refreshRequestMetadata(id);
            runtime.status.textContent = 'Metadata refreshed.';
        } else if (btn.classList.contains('cf-q-regrab')) {
            if (!window.confirm('Delete the existing file and re-search?')) return;
            await regrabRequest(id);
            runtime.status.textContent = 'Re-grab kicked off.';
        } else if (btn.classList.contains('cf-q-remove')) {
            if (!window.confirm('Remove this from the queue?')) return;
            await deleteRequest(id);
            runtime.status.textContent = 'Removed from queue.';
        } else if (btn.classList.contains('cf-q-loosen')) {
            const requestRow = runtime.items.find((r) => r.id === id);
            await candidatesModal.open(
                requestRow
                    ? { requestId: id, requestRow, strictness: 'loose' }
                    : { requestId: id, strictness: 'loose' },
            );
            return;
        } else if (btn.classList.contains('cf-q-candidates')) {
            const requestRow = runtime.items.find((r) => r.id === id);
            await candidatesModal.open(
                requestRow
                    ? { requestId: id, requestRow, strictness: 'raw' }
                    : { requestId: id, strictness: 'raw' },
            );
            return;
        }
        await refresh(runtime);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        runtime.status.textContent = `Error: ${msg}`;
        showToast(`Action failed: ${msg}`);
    }
}

function renderRow(r: RequestRow, isAdmin: boolean): string {
    const cover = r.cover_url
        ? `<img src="${escapeAttr(r.cover_url)}" alt="" loading="lazy" />`
        : `<div class="cf-q-poster-placeholder"><span class="material-icons" aria-hidden="true">menu_book</span></div>`;

    const title = primaryTitle(r);
    const subtitle = subtitleFor(r);
    const reason = r.status_reason
        ? `<div class="cf-q-row-reason">${escapeText(r.status_reason)}</div>`
        : '';

    const stuck =
        r.status === 'failed' ||
        r.status === 'blocked' ||
        (r.status === 'wanted' && r.retries >= 3);

    const adminActions = isAdmin
        ? `<div class="cf-q-row-actions">` +
          iconBtn('cf-q-retry', 'replay', 'Retry') +
          iconBtn('cf-q-refresh-meta', 'cloud_sync', 'Refresh metadata') +
          iconBtn('cf-q-regrab', 'file_download', 'Re-grab') +
          iconBtn('cf-q-loosen', 'tune', 'Loosen search') +
          iconBtn('cf-q-candidates', 'manage_search', 'Show indexer candidates') +
          (stuck
              ? iconBtn('cf-q-remove cf-q-iconbtn-danger', 'delete_outline', 'Remove from queue')
              : '') +
          `</div>`
        : '';

    return (
        `<div class="cf-q-row cf-q-row-status-${escapeAttr(r.status)}" data-id="${r.id}">` +
        `<div class="cf-q-row-cover">${cover}</div>` +
        `<div class="cf-q-row-body">` +
        `<div class="cf-q-row-title">${escapeText(title)}</div>` +
        (subtitle ? `<div class="cf-q-row-subtitle">${escapeText(subtitle)}</div>` : '') +
        reason +
        `</div>` +
        `<div class="cf-q-row-status"><span class="cf-q-pill cf-q-pill-${escapeAttr(r.status)}">${escapeText(r.status)}</span></div>` +
        adminActions +
        `</div>`
    );
}

function iconBtn(extraClass: string, icon: string, title: string): string {
    return (
        `<button type="button" class="cf-q-iconbtn ${extraClass}" title="${escapeAttr(title)}">` +
        `<span class="material-icons" aria-hidden="true">${escapeAttr(icon)}</span>` +
        `</button>`
    );
}

function primaryTitle(r: RequestRow): string {
    const parts: string[] = [];
    if (r.series_name) parts.push(r.series_name);
    if (r.issue_number) parts.push(`#${r.issue_number}`);
    if (parts.length) return parts.join(' ');
    return r.title ?? '(untitled)';
}

function subtitleFor(r: RequestRow): string {
    if (r.authors) return r.authors;
    if (r.title && r.title !== r.series_name) return r.title;
    return '';
}

function renderEmpty(): string {
    return (
        `<div class="cf-q-empty">` +
        `<span class="material-icons" aria-hidden="true">inbox</span>` +
        `<h3>No items in this view</h3>` +
        `<p>Try a different bucket.</p>` +
        `</div>`
    );
}

function renderError(msg: string): string {
    return (
        `<div class="cf-q-empty cf-q-empty-error">` +
        `<span class="material-icons" aria-hidden="true">error_outline</span>` +
        `<h3>Error</h3>` +
        `<p>${escapeText(msg)}</p>` +
        `</div>`
    );
}

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
