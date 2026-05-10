/**
 * Discover page — Jellyseerr-style home with Trending + Coming Soon rails
 * and an inline search box that swaps the rails for a single results row.
 *
 * Behaviour preserved from legacy `pages/discover.js`:
 *   - Three rails: Trending Books, Trending Comics, Coming Soon
 *   - Debounced search with kind filter (All / Books / Comics)
 *   - Card click navigates via the card's own #/cypherflix/details href
 *   - Hover queue FAB on each card calls queueAdd then markQueued
 *   - cypherflix:followed / cypherflix:queued listeners refresh peer cards
 */

import { renderCarousel, refreshCarouselState } from '../components/carousel';
import { showToast } from '../components/toast';
import {
    discoverComingSoon,
    discoverSearch,
    discoverTrending,
    queueAdd,
} from '../state/api';
import { loadFollowing, markQueued } from '../state/followState';
import type {
    DiscoverItem,
    DiscoverItemKind,
    DiscoverPage,
    QueueAddBody,
} from '../types/api';

interface RailDef {
    key: string;
    title: string;
    load(): Promise<DiscoverPage>;
}

const RAILS: RailDef[] = [
    { key: 'trending-books', title: 'Trending Books', load: () => discoverTrending('book', 24) },
    { key: 'trending-comics', title: 'Trending Comics', load: () => discoverTrending('comic', 24) },
    { key: 'coming-soon', title: 'Coming Soon', load: () => discoverComingSoon(24) },
];

interface RailRuntime {
    def: RailDef;
    items: DiscoverItem[];
    host: HTMLElement;
}

export async function render(host: HTMLElement): Promise<void> {
    host.classList.add('cf-host', 'cf-discover-host');
    host.innerHTML =
        `<div class="cf-d-search-bar">` +
        `<span class="material-icons cf-d-search-icon" aria-hidden="true">search</span>` +
        `<input type="search" class="cf-d-search-input" placeholder="Search books and comics…" autocomplete="off" />` +
        `<select class="cf-d-search-kind">` +
        `<option value="">All</option>` +
        `<option value="book">Books</option>` +
        `<option value="comic_issue">Comics</option>` +
        `</select>` +
        `</div>` +
        `<div class="cf-d-status-msg" role="status"></div>` +
        `<div class="cf-d-search-results" hidden></div>` +
        `<div class="cf-d-rows"></div>`;

    // Prime the follow + queue state cache so first paint shows correct
    // indicators. Fire-and-forget — listeners below will fix up if state
    // arrives after render.
    void loadFollowing();

    const searchInput = host.querySelector<HTMLInputElement>('.cf-d-search-input');
    const searchKind = host.querySelector<HTMLSelectElement>('.cf-d-search-kind');
    const searchHost = host.querySelector<HTMLElement>('.cf-d-search-results');
    const rowsHost = host.querySelector<HTMLElement>('.cf-d-rows');
    if (!searchInput || !searchKind || !searchHost || !rowsHost) return;

    const railRuntimes: RailRuntime[] = [];

    for (const def of RAILS) {
        const railHost = document.createElement('div');
        railHost.dataset['railKey'] = def.key;
        railHost.innerHTML = renderLoadingCarousel(def.title);
        rowsHost.appendChild(railHost);
        const runtime: RailRuntime = { def, items: [], host: railHost };
        railRuntimes.push(runtime);
        void loadRail(runtime);
    }

    let searchItems: DiscoverItem[] = [];

    let debounce: number | undefined;
    let lastQuery = '';
    const triggerSearch = (): void => {
        const q = (searchInput.value || '').trim();
        const kindRaw = searchKind.value;
        if (q === lastQuery) return;
        lastQuery = q;
        if (!q) {
            searchHost.hidden = true;
            searchHost.innerHTML = '';
            rowsHost.hidden = false;
            searchItems = [];
            return;
        }
        rowsHost.hidden = true;
        searchHost.hidden = false;
        const kind = parseSearchKind(kindRaw);
        void runSearch(searchHost, q, kind).then((items) => {
            searchItems = items;
        });
    };

    searchInput.addEventListener('input', () => {
        if (debounce) window.clearTimeout(debounce);
        debounce = window.setTimeout(triggerSearch, 350);
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (debounce) window.clearTimeout(debounce);
            triggerSearch();
        }
        if (e.key === 'Escape') {
            searchInput.value = '';
            if (debounce) window.clearTimeout(debounce);
            triggerSearch();
        }
    });
    searchKind.addEventListener('change', () => {
        lastQuery = '';
        triggerSearch();
    });

    // Card click delegation — only intercept queue FAB clicks; the card's
    // own <a class="cardImageContainer"> navigates on its own.
    host.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const fab = target.closest<HTMLElement>('[data-action="cypherflix-queue"]');
        if (!fab) return;
        e.preventDefault();
        e.stopPropagation();
        const card = fab.closest<HTMLElement>('.card');
        if (!card) return;
        void handleQueueClick(card, railRuntimes, searchItems);
    });

    const refreshAll = (): void => {
        for (const r of railRuntimes) {
            refreshCarouselState(r.host, r.items);
        }
        if (!searchHost.hidden) {
            refreshCarouselState(searchHost, searchItems);
        }
    };

    document.addEventListener('cypherflix:followed', refreshAll);
    document.addEventListener('cypherflix:unfollowed', refreshAll);
    document.addEventListener('cypherflix:queued', refreshAll);
}

async function loadRail(runtime: RailRuntime): Promise<void> {
    try {
        const page = await runtime.def.load();
        runtime.items = page.items;
        runtime.host.innerHTML = renderCarousel({
            title: runtime.def.title,
            items: page.items,
            titleStyle: 'wrapped',
            showQueueFab: true,
        });
        if (page.items.length === 0) {
            runtime.host.innerHTML =
                renderEmptyCarousel(runtime.def.title, 'Nothing here yet.');
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        runtime.host.innerHTML = renderEmptyCarousel(runtime.def.title, `Error: ${msg}`);
    }
}

async function runSearch(
    host: HTMLElement,
    query: string,
    kind: DiscoverItemKind | undefined,
): Promise<DiscoverItem[]> {
    host.innerHTML = renderLoadingCarousel(`Search results — "${query}"`);
    try {
        const opts: { kind?: DiscoverItemKind; limit?: number } = { limit: 60 };
        if (kind !== undefined) opts.kind = kind;
        const page = await discoverSearch(query, opts);
        if (page.items.length === 0) {
            host.innerHTML = renderEmptyCarousel(
                `Search results — "${query}"`,
                `No results for "${query}".`,
            );
            return [];
        }
        host.innerHTML = renderCarousel({
            title: `Search results — "${query}"`,
            items: page.items,
            titleStyle: 'wrapped',
            showQueueFab: true,
        });
        return page.items;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        host.innerHTML = renderEmptyCarousel(`Search — "${query}"`, `Error: ${msg}`);
        return [];
    }
}

async function handleQueueClick(
    card: HTMLElement,
    railRuntimes: RailRuntime[],
    searchItems: DiscoverItem[],
): Promise<void> {
    const sourceId = card.dataset['cypherflixSourceId'];
    if (!sourceId) return;
    const item =
        findItemBySourceId(searchItems, sourceId) ??
        findRailItemBySourceId(railRuntimes, sourceId);
    if (!item) return;

    const body = buildQueuePayload(item);
    if (!body) {
        showToast(`Can't queue ${item.title} — missing identifier.`);
        return;
    }
    try {
        const res = await queueAdd(body);
        showToast(res.existed ? `Already in queue: ${item.title}` : `Queued: ${item.title}`);
        markQueued(item, res.status);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Couldn't queue ${item.title}: ${msg}`);
    }
}

function findItemBySourceId(items: DiscoverItem[], sourceId: string): DiscoverItem | null {
    for (const it of items) {
        if (it.source_id === sourceId) return it;
    }
    return null;
}

function findRailItemBySourceId(
    runtimes: RailRuntime[],
    sourceId: string,
): DiscoverItem | null {
    for (const r of runtimes) {
        const hit = findItemBySourceId(r.items, sourceId);
        if (hit) return hit;
    }
    return null;
}

function buildQueuePayload(item: DiscoverItem): QueueAddBody | null {
    if (item.kind === 'book' && item.source === 'hardcover') {
        const id = Number.parseInt(item.source_id, 10);
        if (!Number.isFinite(id)) return null;
        const body: QueueAddBody = {
            kind: 'book',
            series_name: item.series_name ?? item.title,
            title: item.title,
            hardcover_book_id: id,
        };
        if (item.year !== null) body.series_year = item.year;
        if (item.authors !== null) body.authors = item.authors;
        if (item.release_date !== null) body.release_date = item.release_date;
        return body;
    }
    if (item.kind === 'comic_issue' && item.source === 'comicvine') {
        const id = Number.parseInt(item.source_id, 10);
        if (!Number.isFinite(id)) return null;
        const body: QueueAddBody = {
            kind: 'comic_issue',
            series_name: item.series_name ?? item.title,
            title: item.title,
            comicvine_issue_id: id,
        };
        if (item.issue_number !== null) body.issue_number = item.issue_number;
        if (item.year !== null) body.series_year = item.year;
        if (item.release_date !== null) body.release_date = item.release_date;
        return body;
    }
    return null;
}

/**
 * The trending endpoint accepts only `book | comic` and Discover the wider
 * `book | comic_issue | comic_series`. Map the search-kind dropdown value
 * (which uses the wider enum) to a DiscoverItemKind, falling back to
 * undefined when the user picked "All".
 */
function parseSearchKind(raw: string): DiscoverItemKind | undefined {
    if (raw === 'book' || raw === 'comic_issue' || raw === 'comic_series') return raw;
    return undefined;
}

function renderLoadingCarousel(title: string): string {
    return (
        `<div class="verticalSection">` +
        `<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">` +
        `<h2 class="sectionTitle sectionTitle-cards">${escapeText(title)}</h2>` +
        `</div>` +
        `<div class="cf-d-row-loading">` +
        `<span class="material-icons" aria-hidden="true">hourglass_top</span>` +
        ` Loading…` +
        `</div>` +
        `</div>`
    );
}

function renderEmptyCarousel(title: string, msg: string): string {
    return (
        `<div class="verticalSection">` +
        `<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">` +
        `<h2 class="sectionTitle sectionTitle-cards">${escapeText(title)}</h2>` +
        `</div>` +
        `<div class="cf-d-row-empty">${escapeText(msg)}</div>` +
        `</div>`
    );
}

function escapeText(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
