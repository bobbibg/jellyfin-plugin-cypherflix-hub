/**
 * Detail page — shows a discover item with Queue/Follow buttons + a
 * "More by author" carousel for books with a Hardcover author target.
 *
 * Behaviour preserved from legacy `pages/discover_detail.js`:
 *   - Reads kind + source_id from the host's data attributes (set by the
 *     plugin's HTML fragment) or falls back to the legacy hash format.
 *   - Calls discoverItem(kind, sourceId) for the primary record.
 *   - For books with a hardcover_author_id, fetches and renders the
 *     bibliography as a More-by-author rail.
 *   - Buttons: Queue, Follow Author, Follow Series, Follow Story Arc
 *     (story arc only when the backend reports it as supported).
 *   - cypherflix:followed / cypherflix:queued listeners refresh the
 *     button states without a re-fetch.
 */

import { renderCarousel, refreshCarouselState } from '../components/carousel';
import { renderDetailPage, type DetailButtonOpts } from '../components/detailPage';
import { showToast } from '../components/toast';
import {
    createFollowing,
    discoverAuthorBibliography,
    discoverItem,
    queueAdd,
} from '../state/api';
import {
    getQueueState,
    isFollowing,
    loadFollowing,
    markFollowed,
    markQueued,
} from '../state/followState';
import type {
    AuthorBibliography,
    DiscoverItem,
    DiscoverItemDetail,
    DiscoverItemKind,
    FollowTarget,
    FollowingCreate,
} from '../types/api';

const ACTION_QUEUE = 'cypherflix-detail-queue';
const ACTION_FOLLOW_AUTHOR = 'cypherflix-detail-follow-author';
const ACTION_FOLLOW_SERIES = 'cypherflix-detail-follow-series';
const ACTION_FOLLOW_ARC = 'cypherflix-detail-follow-arc';

interface Route {
    kind: DiscoverItemKind;
    sourceId: string;
}

interface BibliographyState {
    bibliography: AuthorBibliography | null;
    items: DiscoverItem[];
    host: HTMLElement | null;
}

export async function render(host: HTMLElement): Promise<void> {
    host.classList.add('cf-host', 'cf-d-detail-route-host');

    const route = parseRoute(host);
    if (!route) {
        host.innerHTML = renderError(
            'Invalid detail route — expected `data-cypherflix-kind` and `data-cypherflix-source-id`.',
        );
        return;
    }

    host.innerHTML = renderLoading();

    let detail: DiscoverItemDetail;
    try {
        detail = await discoverItem(route.kind, route.sourceId);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        host.innerHTML = renderError(msg);
        return;
    }

    // Prime follow state so buttons render in the right initial mode.
    await loadFollowing();

    // Kick off bibliography fetch in parallel — render the page first, then
    // upgrade with the More-by-author rail when ready.
    const bibState: BibliographyState = { bibliography: null, items: [], host: null };
    const authorId = detail.follow_targets.author?.hardcover_author_id;
    const bibPromise =
        authorId !== undefined
            ? discoverAuthorBibliography(authorId).catch(() => null)
            : Promise.resolve(null);

    paint(host, detail);
    wireButtons(host, detail);

    const refreshActions = (): void => paintButtons(host, detail);
    document.addEventListener('cypherflix:followed', refreshActions);
    document.addEventListener('cypherflix:unfollowed', refreshActions);
    document.addEventListener('cypherflix:queued', refreshActions);

    const bib = await bibPromise;
    if (bib) {
        bibState.bibliography = bib;
        const slot = host.querySelector<HTMLElement>('[data-cypherflix-slot="content"]');
        if (slot) {
            const items = collectBibliographyItems(bib);
            bibState.items = items;
            const railHost = document.createElement('div');
            railHost.className = 'cf-d-bib-rail';
            railHost.innerHTML = renderCarousel({
                title: 'More by author',
                items,
                titleStyle: 'bare',
                showQueueFab: true,
            });
            slot.appendChild(railHost);
            bibState.host = railHost;

            document.addEventListener('cypherflix:queued', () => {
                if (bibState.host) refreshCarouselState(bibState.host, bibState.items);
            });
            document.addEventListener('cypherflix:followed', () => {
                if (bibState.host) refreshCarouselState(bibState.host, bibState.items);
            });
        }
    }
}

/* -------------------------------------------------------------------------
 * Painting
 * ----------------------------------------------------------------------- */

function paint(host: HTMLElement, detail: DiscoverItemDetail): void {
    const opts = buildPageOpts(detail);
    host.innerHTML = renderDetailPage(opts);
}

function paintButtons(host: HTMLElement, detail: DiscoverItemDetail): void {
    const opts = buildPageOpts(detail);
    const buttonsRow = host.querySelector<HTMLElement>('.mainDetailButtons');
    if (!buttonsRow) return;
    // Re-render only the buttons row, leaving the rail content untouched.
    const rebuilt = document.createElement('div');
    rebuilt.innerHTML = renderDetailPage({ ...opts, contentHtml: '' });
    const next = rebuilt.querySelector<HTMLElement>('.mainDetailButtons');
    if (next) buttonsRow.innerHTML = next.innerHTML;
}

function buildPageOpts(detail: DiscoverItemDetail): {
    title: string;
    subtitle?: string;
    metaLine?: string;
    coverUrl?: string | null;
    backdropUrl?: string | null;
    buttons: DetailButtonOpts[];
    contentHtml?: string;
} {
    const subtitle = primarySubtitle(detail);
    const metaLine = metaLineFor(detail);
    const buttons = buildButtons(detail);
    const overview = detail.summary
        ? `<div class="detailOverview">${escapeText(detail.summary)}</div>`
        : '';
    return {
        title: detail.title,
        ...(subtitle !== undefined ? { subtitle } : {}),
        ...(metaLine !== undefined ? { metaLine } : {}),
        coverUrl: detail.cover_url,
        backdropUrl: null,
        buttons,
        contentHtml: overview,
    };
}

function buildButtons(detail: DiscoverItemDetail): DetailButtonOpts[] {
    const buttons: DetailButtonOpts[] = [];

    const queueItem: DiscoverItem | null = synthesiseDiscoverItem(detail);
    const queueState = getQueueState(queueItem);
    if (queueState === 'downloaded') {
        buttons.push({
            icon: 'check',
            title: 'In library',
            action: ACTION_QUEUE,
            extraClass: 'cf-d-detail-queue cf-d-detail-action-active',
        });
    } else if (queueState === 'queued') {
        buttons.push({
            icon: 'hourglass_top',
            title: 'Queued',
            action: ACTION_QUEUE,
            extraClass: 'cf-d-detail-queue cf-d-detail-action-active',
        });
    } else {
        buttons.push({
            icon: 'queue',
            title: 'Add to Queue',
            action: ACTION_QUEUE,
            extraClass: 'cf-d-detail-queue',
        });
    }

    const ft = detail.follow_targets;
    if (ft.author) {
        const followed = isFollowing(ft.author);
        buttons.push({
            icon: followed ? 'check' : 'person_add',
            title: followed
                ? `Following ${ft.author.display_name}`
                : `Follow ${ft.author.display_name}`,
            action: ACTION_FOLLOW_AUTHOR,
            extraClass: followed
                ? 'cf-d-detail-follow cf-d-detail-action-active'
                : 'cf-d-detail-follow',
        });
    }
    if (ft.series) {
        const followed = isFollowing(ft.series);
        buttons.push({
            icon: followed ? 'check' : 'collections_bookmark',
            title: followed
                ? `Following ${ft.series.display_name}`
                : `Follow ${ft.series.display_name}`,
            action: ACTION_FOLLOW_SERIES,
            extraClass: followed
                ? 'cf-d-detail-follow cf-d-detail-action-active'
                : 'cf-d-detail-follow',
        });
    }
    if (ft.story_arc && ft.story_arc.supported === true) {
        const followed = isFollowing(ft.story_arc);
        buttons.push({
            icon: followed ? 'check' : 'auto_stories',
            title: followed
                ? `Following ${ft.story_arc.display_name}`
                : `Follow ${ft.story_arc.display_name}`,
            action: ACTION_FOLLOW_ARC,
            extraClass: followed
                ? 'cf-d-detail-follow cf-d-detail-action-active'
                : 'cf-d-detail-follow',
        });
    }

    return buttons;
}

function wireButtons(host: HTMLElement, detail: DiscoverItemDetail): void {
    host.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest<HTMLElement>('[data-action]');
        if (!btn) return;
        const action = btn.dataset['action'];
        if (action === ACTION_QUEUE) {
            void onQueueClick(detail);
            return;
        }
        if (action === ACTION_FOLLOW_AUTHOR && detail.follow_targets.author) {
            void onFollowClick(detail.follow_targets.author);
            return;
        }
        if (action === ACTION_FOLLOW_SERIES && detail.follow_targets.series) {
            void onFollowClick(detail.follow_targets.series);
            return;
        }
        if (action === ACTION_FOLLOW_ARC && detail.follow_targets.story_arc) {
            void onFollowClick(detail.follow_targets.story_arc);
        }
    });
}

async function onQueueClick(detail: DiscoverItemDetail): Promise<void> {
    try {
        const res = await queueAdd(detail.queue_payload);
        showToast(res.existed ? `Already in queue: ${detail.title}` : `Queued: ${detail.title}`);
        const item = synthesiseDiscoverItem(detail);
        if (item) markQueued(item, res.status);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Couldn't queue: ${msg}`);
    }
}

async function onFollowClick(target: FollowTarget): Promise<void> {
    try {
        const body: FollowingCreate = {
            kind: target.kind,
            display_name: target.display_name,
        };
        if (target.hardcover_author_id !== undefined) {
            body.hardcover_author_id = target.hardcover_author_id;
        }
        if (target.hardcover_series_id !== undefined) {
            body.hardcover_series_id = target.hardcover_series_id;
        }
        if (target.comicvine_id !== undefined) {
            body.comicvine_id = target.comicvine_id;
        }
        await createFollowing(body);
        showToast(`Following: ${target.display_name}`);
        markFollowed(target);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Couldn't follow: ${msg}`);
    }
}

/* -------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */

function parseRoute(host: HTMLElement): Route | null {
    const dKind = host.dataset['cypherflixKind'];
    const dSourceId = host.dataset['cypherflixSourceId'];
    const kind = parseKind(dKind);
    if (kind && dSourceId) return { kind, sourceId: dSourceId };

    // Fallback: legacy hash route #/cypherflix/details?kind=...&source_id=...
    const m = (window.location.hash || '').match(/#\/cypherflix\/details\?(.*)$/);
    if (!m || m[1] === undefined) return null;
    const params = new URLSearchParams(m[1]);
    const hashKind = parseKind(params.get('kind'));
    const hashSourceId = params.get('source_id');
    if (!hashKind || !hashSourceId) return null;
    return { kind: hashKind, sourceId: hashSourceId };
}

function parseKind(raw: string | null | undefined): DiscoverItemKind | null {
    if (raw === 'book' || raw === 'comic_issue' || raw === 'comic_series') return raw;
    return null;
}

function primarySubtitle(detail: DiscoverItemDetail): string | undefined {
    const authors = detail.contributors
        .filter((c) => {
            const role = c.contribution ?? c.role;
            if (!role) return true;
            return /author|writer|illustrator|artist/i.test(role);
        })
        .slice(0, 3)
        .map((c) => c.name);
    if (authors.length > 0) return authors.join(', ');
    if (detail.series) return detail.series;
    return undefined;
}

function metaLineFor(detail: DiscoverItemDetail): string | undefined {
    const bits: string[] = [];
    if (detail.kind === 'book') bits.push('Book');
    else if (detail.kind === 'comic_issue') bits.push('Comic');
    else if (detail.kind === 'comic_series') bits.push('Comic Series');
    if (detail.release_date) {
        const yr = detail.release_date.slice(0, 4);
        if (yr) bits.push(yr);
    }
    if (detail.page_count !== null && detail.page_count !== undefined) {
        bits.push(`${detail.page_count} pages`);
    }
    if (detail.rating !== null && detail.rating !== undefined) {
        bits.push(`★ ${Number(detail.rating).toFixed(1)}`);
    }
    return bits.length > 0 ? bits.join(' · ') : undefined;
}

/**
 * Build a synthetic DiscoverItem that the central followState helpers
 * (which expect the lighter discover-row shape) can read. The detail
 * endpoint exposes everything we need, but in a different shape.
 */
function synthesiseDiscoverItem(detail: DiscoverItemDetail): DiscoverItem | null {
    // followState.getQueueState only handles 'book' and 'comic_issue' shapes
    // — no point synthesising for comic_series.
    if (detail.kind !== 'book' && detail.kind !== 'comic_issue') return null;
    return {
        kind: detail.kind,
        source: detail.source,
        source_id: detail.source_id,
        title: detail.title,
        series_name: detail.series ?? null,
        issue_number: detail.issue_number ?? null,
        year: detail.release_date ? Number.parseInt(detail.release_date.slice(0, 4), 10) || null : null,
        authors: null,
        release_date: detail.release_date,
        cover_url: detail.cover_url,
        summary: detail.summary,
        watchlist_kind:
            detail.follow_targets.author?.kind ??
            detail.follow_targets.series?.kind ??
            'book_author',
        watchlist_payload:
            detail.follow_targets.author ??
            detail.follow_targets.series ??
            { kind: 'book_author', display_name: detail.title },
    };
}

/**
 * Flatten an AuthorBibliography into a flat DiscoverItem[] so the existing
 * carousel/card components can render it. Bibliography books carry a
 * `hardcover_book_id` so we treat them as `kind: 'book' / source: 'hardcover'`.
 */
function collectBibliographyItems(bib: AuthorBibliography): DiscoverItem[] {
    const out: DiscoverItem[] = [];
    const push = (
        seriesName: string | null,
        b: AuthorBibliography['series'][number]['books'][number],
    ): void => {
        out.push({
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
                hardcover_author_id: bib.author_id,
            },
        });
    };
    for (const g of bib.series) {
        for (const b of g.books) push(g.series_name, b);
    }
    for (const b of bib.standalone) push(null, b);
    return out;
}

function renderLoading(): string {
    return (
        `<div class="cf-d-detail-loading">` +
        `<span class="material-icons" aria-hidden="true">hourglass_top</span> Loading…` +
        `</div>`
    );
}

function renderError(msg: string): string {
    return (
        `<div class="cf-d-detail-error">` +
        `<span class="material-icons" aria-hidden="true">error_outline</span>` +
        `<h2>Couldn't load this item</h2>` +
        `<p>${escapeText(msg)}</p>` +
        `</div>`
    );
}

function escapeText(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
