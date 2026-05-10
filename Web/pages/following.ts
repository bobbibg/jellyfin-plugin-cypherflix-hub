/**
 * Following page — list of monitored authors / book series / comic series.
 *
 * Behaviour preserved from legacy `pages/following.js`:
 *   - Header with kind filter dropdown (All / Authors / Book series /
 *     Comic series).
 *   - Each row: avatar (picture_url or kind icon), name, kind label,
 *     monitor mode select, unfollow button.
 *   - Unfollow calls deleteFollowing then markUnfollowed (the central
 *     follow-state cache fires the cypherflix:unfollowed event).
 *   - include_finished=true so retired comic series are still visible
 *     (matches the v3.0.1 default — finished_hidden was confusing users).
 */

import { showToast } from '../components/toast';
import { deleteFollowing, listFollowing, patchFollowing } from '../state/api';
import { markUnfollowed } from '../state/followState';
import type {
    FollowTarget,
    FollowingKind,
    FollowingRow,
    MonitorMode,
} from '../types/api';

interface KindOption {
    value: FollowingKind | '';
    label: string;
}

const KIND_OPTIONS: KindOption[] = [
    { value: '', label: 'All' },
    { value: 'book_author', label: 'Authors' },
    { value: 'book_series', label: 'Book series' },
    { value: 'comic_series', label: 'Comic series' },
];

const KIND_LABEL: Record<FollowingKind, string> = {
    book_author: 'Author',
    book_series: 'Book series',
    comic_series: 'Comic series',
};

const KIND_ICON: Record<FollowingKind, string> = {
    book_author: 'person',
    book_series: 'menu_book',
    comic_series: 'auto_stories',
};

const MONITOR_LABEL: Record<MonitorMode, string> = {
    all: 'All releases',
    new_only: 'New only',
    specific_volumes: 'Specific volumes',
};

interface Runtime {
    host: HTMLElement;
    list: HTMLElement;
    kindFilter: FollowingKind | '';
    items: FollowingRow[];
}

export async function render(host: HTMLElement): Promise<void> {
    host.classList.add('cf-host', 'cf-following-host');
    host.innerHTML =
        `<div class="cf-fol-host">` +
        `<div class="cf-fol-header">` +
        `<h2 class="cf-fol-title">Following</h2>` +
        `<div class="cf-fol-toolbar">` +
        `<select class="cf-fol-kind-filter">` +
        KIND_OPTIONS.map(
            (o) =>
                `<option value="${escapeAttr(o.value)}">${escapeText(o.label)}</option>`,
        ).join('') +
        `</select>` +
        `</div>` +
        `</div>` +
        `<div class="cf-fol-list">` +
        `<div class="cf-fol-loading">` +
        `<span class="material-icons" aria-hidden="true">hourglass_top</span> Loading…` +
        `</div>` +
        `</div>` +
        `</div>`;

    const list = host.querySelector<HTMLElement>('.cf-fol-list');
    const kindFilter = host.querySelector<HTMLSelectElement>('.cf-fol-kind-filter');
    if (!list || !kindFilter) return;

    const runtime: Runtime = {
        host,
        list,
        kindFilter: '',
        items: [],
    };

    kindFilter.addEventListener('change', () => {
        runtime.kindFilter = parseKindFilter(kindFilter.value);
        void loadAndRender(runtime);
    });

    list.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest<HTMLButtonElement>('.cf-fol-unfollow');
        if (!btn) return;
        const row = btn.closest<HTMLElement>('.cf-fol-row[data-id]');
        if (!row) return;
        const idStr = row.dataset['id'];
        const id = idStr ? Number.parseInt(idStr, 10) : NaN;
        if (!Number.isFinite(id)) return;
        const item = runtime.items.find((r) => r.id === id);
        if (!item) return;
        void handleUnfollow(runtime, row, item);
    });

    list.addEventListener('change', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLSelectElement)) return;
        if (!target.classList.contains('cf-fol-monitor')) return;
        const row = target.closest<HTMLElement>('.cf-fol-row[data-id]');
        if (!row) return;
        const idStr = row.dataset['id'];
        const id = idStr ? Number.parseInt(idStr, 10) : NaN;
        if (!Number.isFinite(id)) return;
        const mode = parseMonitorMode(target.value);
        if (!mode) return;
        void handleMonitorChange(id, mode);
    });

    await loadAndRender(runtime);
}

async function loadAndRender(runtime: Runtime): Promise<void> {
    runtime.list.innerHTML =
        `<div class="cf-fol-loading">` +
        `<span class="material-icons" aria-hidden="true">hourglass_top</span> Loading…` +
        `</div>`;
    try {
        const opts: { kind?: FollowingKind; include_finished?: boolean } = {
            include_finished: true,
        };
        if (runtime.kindFilter !== '') opts.kind = runtime.kindFilter;
        const page = await listFollowing(opts);
        runtime.items = page.items;
        if (page.items.length === 0) {
            runtime.list.innerHTML = renderEmpty();
            return;
        }
        const groups = groupByKind(page.items);
        runtime.list.innerHTML = groups
            .map((g) => {
                const heading = `<h3 class="cf-fol-group-heading">${escapeText(KIND_LABEL[g.kind])}</h3>`;
                return heading + g.rows.map(renderRow).join('');
            })
            .join('');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        runtime.list.innerHTML = renderError(msg);
    }
}

interface FollowingGroup {
    kind: FollowingKind;
    rows: FollowingRow[];
}

function groupByKind(items: FollowingRow[]): FollowingGroup[] {
    const order: FollowingKind[] = ['book_author', 'book_series', 'comic_series'];
    const groups = new Map<FollowingKind, FollowingRow[]>();
    for (const k of order) groups.set(k, []);
    for (const it of items) {
        const arr = groups.get(it.kind);
        if (arr) arr.push(it);
    }
    const out: FollowingGroup[] = [];
    for (const k of order) {
        const rows = groups.get(k);
        if (rows && rows.length > 0) out.push({ kind: k, rows });
    }
    return out;
}

async function handleUnfollow(
    runtime: Runtime,
    rowEl: HTMLElement,
    row: FollowingRow,
): Promise<void> {
    try {
        await deleteFollowing(row.id);
        showToast(`Unfollowed: ${row.display_name}`);
        const target = followTargetFromRow(row);
        if (target) markUnfollowed(target);
        rowEl.remove();
        runtime.items = runtime.items.filter((r) => r.id !== row.id);
        if (runtime.items.length === 0) await loadAndRender(runtime);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Couldn't unfollow: ${msg}`);
    }
}

async function handleMonitorChange(id: number, mode: MonitorMode): Promise<void> {
    try {
        await patchFollowing(id, { monitor_mode: mode });
        showToast('Monitor mode updated.');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Couldn't update: ${msg}`);
    }
}

function followTargetFromRow(row: FollowingRow): FollowTarget | null {
    if (row.kind === 'book_author' && row.hardcover_author_id !== null) {
        return {
            kind: 'book_author',
            display_name: row.display_name,
            hardcover_author_id: row.hardcover_author_id,
        };
    }
    if (row.kind === 'book_series' && row.hardcover_series_id !== null) {
        return {
            kind: 'book_series',
            display_name: row.display_name,
            hardcover_series_id: row.hardcover_series_id,
        };
    }
    if (row.kind === 'comic_series' && row.comicvine_id !== null) {
        return {
            kind: 'comic_series',
            display_name: row.display_name,
            comicvine_id: row.comicvine_id,
        };
    }
    return null;
}

function renderRow(row: FollowingRow): string {
    const icon = KIND_ICON[row.kind];
    const kindLabel = KIND_LABEL[row.kind];
    const monitor = MONITOR_LABEL[row.monitor_mode];
    const avatar = row.picture_url
        ? `<div class="cf-fol-avatar"><img src="${escapeAttr(row.picture_url)}" alt="" loading="lazy" /></div>`
        : `<div class="cf-fol-icon"><span class="material-icons" aria-hidden="true">${escapeAttr(icon)}</span></div>`;

    const monitorOptions: MonitorMode[] = ['all', 'new_only', 'specific_volumes'];

    return (
        `<div class="cf-fol-row" data-id="${row.id}">` +
        avatar +
        `<div class="cf-fol-body">` +
        `<div class="cf-fol-name">${escapeText(row.display_name)}</div>` +
        `<div class="cf-fol-meta">` +
        `<span class="cf-fol-kind">${escapeText(kindLabel)}</span>` +
        `<span class="cf-fol-dot">·</span>` +
        `<span class="cf-fol-mode">${escapeText(monitor)}</span>` +
        `<span class="cf-fol-dot">·</span>` +
        `<span class="cf-fol-added">added ${escapeText(fmtDate(row.added_at))}</span>` +
        `</div>` +
        `</div>` +
        `<div class="cf-fol-actions">` +
        `<select class="cf-fol-monitor" title="Monitor mode">` +
        monitorOptions
            .map(
                (m) =>
                    `<option value="${escapeAttr(m)}"${row.monitor_mode === m ? ' selected' : ''}>${escapeText(MONITOR_LABEL[m])}</option>`,
            )
            .join('') +
        `</select>` +
        `<button type="button" class="cf-fol-unfollow" title="Unfollow">` +
        `<span class="material-icons" aria-hidden="true">person_remove</span>` +
        `</button>` +
        `</div>` +
        `</div>`
    );
}

function renderEmpty(): string {
    return (
        `<div class="cf-fol-empty">` +
        `<span class="material-icons" aria-hidden="true">bookmark_border</span>` +
        `<h3>You're not following anyone yet</h3>` +
        `<p>Open an item in Discover and click "Follow author" or "Follow series" to monitor for new releases.</p>` +
        `</div>`
    );
}

function renderError(msg: string): string {
    return (
        `<div class="cf-fol-error">` +
        `<span class="material-icons" aria-hidden="true">error_outline</span>` +
        `<h3>Couldn't load Following</h3>` +
        `<p>${escapeText(msg)}</p>` +
        `</div>`
    );
}

function parseKindFilter(raw: string): FollowingKind | '' {
    if (raw === 'book_author' || raw === 'book_series' || raw === 'comic_series') return raw;
    return '';
}

function parseMonitorMode(raw: string): MonitorMode | null {
    if (raw === 'all' || raw === 'new_only' || raw === 'specific_volumes') return raw;
    return null;
}

function fmtDate(s: string): string {
    if (!s) return '';
    try {
        return new Date(s).toLocaleDateString();
    } catch {
        return s;
    }
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
