/**
 * Native-Jellyfin DOM injection.
 *
 * Three jobs, all behind a single MutationObserver tied to `document.body`:
 *
 *   1. Item detail page (Book / AudioBook / Series) — inject a Follow
 *      button into `.mainDetailButtons` (verified class name from
 *      `.recon/native-classes-verification.md`; legacy code that referenced
 *      `.detailButtons` was wrong).
 *   2. Book detail page — inject a "More by author" carousel underneath
 *      the `.mainDetailButtons` row.
 *   3. Missing items in any view — inject a Queue FAB into the card's
 *      `.cardOverlayContainer` (verified to be the canonical hover-overlay
 *      slot in 10.11.8).
 *
 * Re-entrancy: under the observer we can be called multiple times before
 * an in-flight async fetch resolves. Each injector reads the candidate
 * element, marks it with `data-cf-injected` BEFORE awaiting any I/O, then
 * re-checks the element is still attached and the inject mark is still its
 * own afterwards. A second short-circuit lock (`_injectingBookButton`)
 * prevents two parallel scans from racing on the same row.
 */

import { renderCarousel } from './components/carousel';
import { renderDetailButton } from './components/detailPage';
import { renderQueueFab } from './components/queueFab';
import { showToast } from './components/toast';
import { discoverAuthorBibliography, discoverSearch, queueAdd } from './state/api';
import { currentUserId } from './state/jellyfin';
import type { DiscoverItem } from './types/api';

const INJECT_MARK = 'data-cf-injected';
const FOLLOW_ACTION = 'cypherflix-jf-follow';
const QUEUE_ACTION = 'cypherflix-jf-queue';

let _injectingBookButton = false;

/* -------------------------------------------------------------------------
 * Public boot
 * ----------------------------------------------------------------------- */

export function bootJellyfinInjections(): void {
    if (window.__cypherflixInjectionsBooted) return;
    window.__cypherflixInjectionsBooted = true;

    const observer = new MutationObserver(scheduleInject);
    const root = document.body ?? document.documentElement;
    if (root) observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('hashchange', scheduleInject);
    scheduleInject();
}

let _scheduled = false;
function scheduleInject(): void {
    if (_scheduled) return;
    _scheduled = true;
    window.setTimeout(() => {
        _scheduled = false;
        void runInjections();
    }, 200);
}

async function runInjections(): Promise<void> {
    try {
        await Promise.all([
            injectDetailPageButtons(),
            injectMoreByAuthor(),
            injectQueueOnMissingCards(),
        ]);
    } catch {
        /* swallow — try again on the next observer tick */
    }
}

/* -------------------------------------------------------------------------
 * 1. Follow button on Book / AudioBook / Series detail pages
 * ----------------------------------------------------------------------- */

async function injectDetailPageButtons(): Promise<void> {
    if (_injectingBookButton) return;

    const buttonsRow = document.querySelector<HTMLElement>(
        `.itemDetailPage:not(.hide) .mainDetailButtons:not([${INJECT_MARK}-follow])`,
    );
    if (!buttonsRow) return;

    // Lock + tag synchronously so a re-entrant observer tick skips us.
    _injectingBookButton = true;
    buttonsRow.setAttribute(`${INJECT_MARK}-follow`, '1');

    try {
        const itemId = currentDetailItemId();
        if (!itemId) return;
        const item = await fetchJellyfinItem(itemId);
        if (!item) return;

        // Re-check after the await — observer may have replaced the row.
        if (!buttonsRow.isConnected) return;

        const supportedTypes = ['Book', 'AudioBook', 'Series'];
        if (!supportedTypes.includes(item.Type)) return;

        // Resolution path varies per item type:
        //  - Book / AudioBook → look up Hardcover author by name
        //  - Series → not yet wired (no tvdb/tmdb follow targets in grabber)
        const authorName = primaryAuthorName(item);
        if (!authorName) return;

        const target = await resolveFollowTarget(item, authorName);
        if (!target) return;

        const html = renderDetailButton({
            icon: 'notifications',
            title: `Follow ${target.display_name}`,
            action: FOLLOW_ACTION,
            extraClass: 'cf-jf-follow-btn',
        });
        const wrapper = document.createElement('span');
        wrapper.innerHTML = html;
        const btn = wrapper.firstElementChild;
        if (!(btn instanceof HTMLElement)) return;
        btn.dataset['cypherflixFollowPayload'] = JSON.stringify(target);
        btn.addEventListener('click', () => {
            void onFollowClick(btn, target);
        });
        buttonsRow.appendChild(btn);
    } finally {
        _injectingBookButton = false;
    }
}

interface FollowTargetLite {
    kind: 'book_author' | 'comic_series';
    display_name: string;
    hardcover_author_id?: number;
    comicvine_id?: number;
}

async function resolveFollowTarget(
    item: JellyfinItem,
    authorName: string,
): Promise<FollowTargetLite | null> {
    // 1. Direct ProviderIds — fast path if a metadata plugin wrote the field.
    const pids = item.ProviderIds ?? {};
    const direct = pids['Hardcover'];
    if (direct !== undefined) {
        const id = Number.parseInt(direct, 10);
        if (Number.isFinite(id)) {
            return {
                kind: 'book_author',
                display_name: authorName,
                hardcover_author_id: id,
            };
        }
    }

    // 2. Name-search via the grabber's discover endpoint. Single shot — if
    //    nothing matches, we silently skip injection.
    try {
        const res = await discoverSearch(authorName, { kind: 'book', limit: 5 });
        const lower = authorName.toLowerCase();
        const match = res.items.find((it) => (it.authors ?? '').toLowerCase().includes(lower));
        const wp = match?.watchlist_payload;
        if (wp?.kind === 'book_author' && wp.hardcover_author_id !== undefined) {
            return {
                kind: 'book_author',
                display_name: authorName,
                hardcover_author_id: wp.hardcover_author_id,
            };
        }
    } catch {
        /* ignore; we just don't inject the button */
    }
    return null;
}

async function onFollowClick(btn: HTMLElement, target: FollowTargetLite): Promise<void> {
    btn.setAttribute('disabled', 'true');
    try {
        const { createFollowing } = await import('./state/api');
        const body: {
            kind: 'book_author' | 'comic_series';
            display_name: string;
            hardcover_author_id?: number;
            comicvine_id?: number;
        } = { kind: target.kind, display_name: target.display_name };
        if (target.hardcover_author_id !== undefined) {
            body.hardcover_author_id = target.hardcover_author_id;
        }
        if (target.comicvine_id !== undefined) {
            body.comicvine_id = target.comicvine_id;
        }
        await createFollowing(body);
        showToast(`Following: ${target.display_name}`);
        // Swap the icon to the "active" check so the user sees feedback.
        const icon = btn.querySelector('.detailButton-icon');
        if (icon) {
            icon.classList.remove('notifications');
            icon.classList.add('check');
        }
    } catch (err) {
        btn.removeAttribute('disabled');
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Couldn't follow: ${msg}`);
    }
}

/* -------------------------------------------------------------------------
 * 2. More-by-author rail on Book / AudioBook detail pages
 * ----------------------------------------------------------------------- */

async function injectMoreByAuthor(): Promise<void> {
    const ribbon = document.querySelector<HTMLElement>(
        `.itemDetailPage:not(.hide) .detailRibbon:not([${INJECT_MARK}-moreby])`,
    );
    if (!ribbon) return;
    ribbon.setAttribute(`${INJECT_MARK}-moreby`, '1');

    const itemId = currentDetailItemId();
    if (!itemId) return;
    const item = await fetchJellyfinItem(itemId);
    if (!item) return;
    if (!ribbon.isConnected) return;
    if (!['Book', 'AudioBook'].includes(item.Type)) return;

    const authorName = primaryAuthorName(item);
    if (!authorName) return;

    let authorId = numberFromProvider(item.ProviderIds?.['Hardcover']);
    if (authorId === null) {
        // Fall through to name search — same heuristic as the Follow button.
        try {
            const res = await discoverSearch(authorName, { kind: 'book', limit: 5 });
            const lower = authorName.toLowerCase();
            const match = res.items.find(
                (it) => (it.authors ?? '').toLowerCase().includes(lower),
            );
            const wp = match?.watchlist_payload;
            if (wp?.kind === 'book_author' && wp.hardcover_author_id !== undefined) {
                authorId = wp.hardcover_author_id;
            }
        } catch {
            return;
        }
    }
    if (authorId === null) return;

    let bib;
    try {
        bib = await discoverAuthorBibliography(authorId);
    } catch {
        return;
    }
    if (!bib || (bib.series.length === 0 && bib.standalone.length === 0)) return;
    if (!ribbon.isConnected) return;

    const items: DiscoverItem[] = [];
    for (const g of bib.series) {
        for (const b of g.books) items.push(bibBookToItem(b, g.series_name, authorId));
    }
    for (const b of bib.standalone) items.push(bibBookToItem(b, null, authorId));

    if (items.length === 0) return;

    const railHost = document.createElement('div');
    railHost.className = 'cf-jf-moreby-host';
    railHost.innerHTML = renderCarousel({
        title: 'More by author',
        items,
        titleStyle: 'bare',
        showQueueFab: true,
    });
    ribbon.insertAdjacentElement('afterend', railHost);
}

function bibBookToItem(
    b: {
        hardcover_book_id: number;
        title: string;
        release_date: string | null;
        year: number | null;
        cover_url: string | null;
        authors: string | null;
    },
    seriesName: string | null,
    authorId: number,
): DiscoverItem {
    return {
        kind: 'book',
        source: 'hardcover',
        source_id: String(b.hardcover_book_id),
        title: b.title,
        series_name: seriesName,
        issue_number: null,
        year: b.year,
        authors: b.authors,
        release_date: b.release_date,
        cover_url: b.cover_url,
        summary: null,
        watchlist_kind: 'book_author',
        watchlist_payload: {
            kind: 'book_author',
            display_name: b.authors ?? 'Author',
            hardcover_author_id: authorId,
        },
    };
}

/* -------------------------------------------------------------------------
 * 3. Queue FAB on Missing cards
 * ----------------------------------------------------------------------- */

async function injectQueueOnMissingCards(): Promise<void> {
    const indicators = document.querySelectorAll<HTMLElement>('.missingIndicator');
    for (const indicator of indicators) {
        const card = indicator.closest<HTMLElement>('.card');
        if (!card) continue;
        if (card.hasAttribute(`${INJECT_MARK}-queue`)) continue;
        card.setAttribute(`${INJECT_MARK}-queue`, '1');

        const itemId = card.dataset['id'];
        const itemType = card.dataset['type'];
        if (!itemId || !itemType) continue;
        if (!['Book', 'AudioBook'].includes(itemType)) continue;

        // Native overlay slot — verified canonical hover-overlay anchor.
        const overlay =
            card.querySelector<HTMLElement>('.cardOverlayContainer') ??
            (() => {
                const scalable = card.querySelector('.cardScalable');
                if (!scalable) return null;
                const o = document.createElement('div');
                o.className = 'cardOverlayContainer itemAction';
                o.dataset['action'] = 'link';
                scalable.appendChild(o);
                return o;
            })();
        if (!overlay) continue;

        const fabHtml = renderQueueFab({ state: 'add', action: QUEUE_ACTION });
        const wrapper = document.createElement('span');
        wrapper.innerHTML = fabHtml;
        const btn = wrapper.firstElementChild;
        if (!(btn instanceof HTMLElement)) continue;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            void onMissingQueueClick(btn, itemId);
        });
        overlay.appendChild(btn);
    }
}

async function onMissingQueueClick(btn: HTMLElement, itemId: string): Promise<void> {
    const item = await fetchJellyfinItem(itemId);
    if (!item) {
        showToast("Couldn't read item details from Jellyfin");
        return;
    }
    const hcId = numberFromProvider(item.ProviderIds?.['Hardcover']);
    if (hcId === null) {
        showToast('No Hardcover id on this item — link it first');
        return;
    }
    btn.setAttribute('disabled', 'true');
    const icon = btn.querySelector('.cardOverlayButtonIcon');
    if (icon) {
        icon.classList.remove('queue');
        icon.classList.add('hourglass_top');
    }
    try {
        const res = await queueAdd({
            kind: 'book',
            series_name: item.Name,
            title: item.Name,
            hardcover_book_id: hcId,
        });
        showToast(res.existed ? `Already queued: ${item.Name}` : `Queued: ${item.Name}`);
        if (icon) {
            icon.classList.remove('hourglass_top');
            icon.classList.add('check');
        }
    } catch (err) {
        btn.removeAttribute('disabled');
        if (icon) {
            icon.classList.remove('hourglass_top');
            icon.classList.add('queue');
        }
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Couldn't queue: ${msg}`);
    }
}

/* -------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */

function currentDetailItemId(): string | null {
    const m = (window.location.hash || '').match(/[?&]id=([0-9a-f-]+)/i);
    return m && m[1] ? m[1] : null;
}

async function fetchJellyfinItem(itemId: string): Promise<JellyfinItem | null> {
    const ac = window.ApiClient;
    if (!ac) return null;
    try {
        const userId = await currentUserId();
        if (!userId) return null;
        return await ac.getItem(userId, itemId);
    } catch {
        return null;
    }
}

function primaryAuthorName(item: JellyfinItem): string | null {
    const people = item.People ?? [];
    for (const p of people) {
        if (p.Type === 'Author' || p.Role === 'Author') return p.Name;
    }
    if (item.AlbumArtist) return item.AlbumArtist;
    return null;
}

function numberFromProvider(raw: string | undefined): number | null {
    if (!raw) return null;
    const id = Number.parseInt(raw, 10);
    return Number.isFinite(id) ? id : null;
}

declare global {
    interface Window {
        __cypherflixInjectionsBooted?: boolean;
    }
}
