/**
 * Single source of truth for cypherflix card markup.
 *
 * Mirrors Jellyfin 10.11.8 home-page card chain exactly so themes apply
 * automatically. Class chain verified in
 * `.recon/native-classes-verification.md`:
 *
 *   <div class="card overflowPortraitCard card-hoverable card-withuserdata"
 *        data-id="..." data-type="..." data-action="link">
 *     <div class="cardBox cardBox-bottompadded">
 *       <div class="cardScalable">
 *         <div class="cardPadder cardPadder-overflowPortrait"></div>
 *         <a href="..."
 *            class="cardImageContainer coveredImage cardContent itemAction lazy"
 *            data-action="link" data-src="<imageUrl>"
 *            aria-label="<name>" role="img"></a>
 *         <div class="cardOverlayContainer itemAction" data-action="link">
 *           <!-- queueFab.renderQueueFab() -->
 *         </div>
 *         <div class="cardIndicators">
 *           <!-- indicators.renderIndicators() -->
 *         </div>
 *       </div>
 *       <div class="cardFooter cardFooter-transparent">
 *         <div class="cardText cardTextCentered"><bdi>Title</bdi></div>
 *         <div class="cardText cardText-secondary cardTextCentered"><bdi>Subtitle</bdi></div>
 *       </div>
 *     </div>
 *   </div>
 *
 * Notes that earlier code got wrong:
 *   - Image is set via `data-src` on `.cardImageContainer`. The lazy loader
 *     paints `background-image` itself. We do NOT use `<img>`.
 *   - Hover overlay reveal is pure CSS via the `card-hoverable` ancestor.
 *   - `cardIndicators` is a sibling of `cardScalable`'s children — render
 *     ONLY the chips that apply (don't use `hidden` — Jellyfin's stylesheet
 *     overrides `display`).
 */

import { getQueueState, isFollowing } from '../state/followState';
import type { DiscoverItem, FollowTarget } from '../types/api';

import { renderIndicators } from './indicators';
import { renderQueueFab, type QueueFabState } from './queueFab';

export interface CardOpts {
    item: DiscoverItem;
    /**
     * Optional override for the click target. Defaults to our internal
     * detail route `#/cypherflix/details/{kind}/{source_id}`.
     */
    href?: string;
    /**
     * If false, suppress the hover queue FAB (e.g. on the Queue tab where
     * adding-again is meaningless). Defaults to true.
     */
    showQueueFab?: boolean;
}

/** Render a card as an HTML string ready to insert into an items container. */
export function renderCard(opts: CardOpts): string {
    const { item } = opts;
    const showFab = opts.showQueueFab ?? true;

    const followed = followedFor(item);
    const queue = getQueueState(item);

    const fabState = mapFabState(queue);
    const fabHtml = showFab ? renderQueueFab({ state: fabState, action: 'cypherflix-queue' }) : '';
    const indicatorsHtml = renderIndicators({ followed, queue });

    const href = opts.href ?? defaultHref(item);
    const title = item.title;
    const subtitle = subtitleFor(item);

    const imageUrl = item.cover_url ?? '';
    // Cover image: we set `background-image` inline rather than relying on
    // Jellyfin's `lazyLoader` (which observes `class="lazy"`+`data-src=`).
    // The lazy loader is registered at app boot and observes content under
    // Jellyfin's main shell; content rendered into the Plugin-Pages
    // user-settings container is outside its scope, so cards rendered there
    // never get their data-src promoted to a background-image and the
    // poster slot stays blank. Inline style sidesteps the observer.
    // We keep `class="lazy"` + `data-src=…` for forward compat (and so any
    // theme rule keyed on `.lazy` still applies) — they're harmless when
    // the inline style already paints the image.
    const imageStyle = imageUrl ? ` style="background-image: url('${escapeAttr(imageUrl)}');"` : '';
    // We tag the outer with our own data-cypherflix-* attributes so click
    // delegation knows where to dispatch (queue add vs navigate).
    return (
        `<div class="card overflowPortraitCard card-hoverable card-withuserdata"` +
        ` data-cypherflix-kind="${escapeAttr(item.kind)}"` +
        ` data-cypherflix-source="${escapeAttr(item.source)}"` +
        ` data-cypherflix-source-id="${escapeAttr(item.source_id)}"` +
        ` data-action="link">` +
        `<div class="cardBox cardBox-bottompadded">` +
        `<div class="cardScalable">` +
        `<div class="cardPadder cardPadder-overflowPortrait"></div>` +
        `<a href="${escapeAttr(href)}"` +
        ` class="cardImageContainer coveredImage cardContent itemAction lazy"` +
        ` data-action="link"` +
        (imageUrl ? ` data-src="${escapeAttr(imageUrl)}"` : '') +
        imageStyle +
        ` aria-label="${escapeAttr(title)}" role="img"></a>` +
        `<div class="cardOverlayContainer itemAction" data-action="link">` +
        fabHtml +
        `</div>` +
        `<div class="cardIndicators">` +
        indicatorsHtml +
        `</div>` +
        `</div>` +
        `<div class="cardFooter cardFooter-transparent">` +
        `<div class="cardText cardTextCentered"><bdi>${escapeText(title)}</bdi></div>` +
        (subtitle
            ? `<div class="cardText cardText-secondary cardTextCentered"><bdi>${escapeText(subtitle)}</bdi></div>`
            : '') +
        `</div>` +
        `</div>` +
        `</div>`
    );
}

/**
 * Re-render only the indicators + queue FAB on an already-mounted card.
 * Called when the followState event bus fires, so peer cards reflect the
 * change without a full re-render.
 */
export function refreshCardState(card: HTMLElement, item: DiscoverItem): void {
    const followed = followedFor(item);
    const queue = getQueueState(item);

    const indicators = card.querySelector('.cardIndicators');
    if (indicators) indicators.innerHTML = renderIndicators({ followed, queue });

    const overlay = card.querySelector('.cardOverlayContainer');
    if (overlay) {
        const showFab = overlay.querySelector('.cardOverlayButton-hover');
        if (showFab) {
            overlay.innerHTML = renderQueueFab({
                state: mapFabState(queue),
                action: 'cypherflix-queue',
            });
        }
    }
}

/* -------------------------------------------------------------------------
 * Internals
 * ----------------------------------------------------------------------- */

function defaultHref(item: DiscoverItem): string {
    return (
        `#/cypherflix/details/${encodeURIComponent(item.kind)}` +
        `/${encodeURIComponent(item.source_id)}`
    );
}

function subtitleFor(item: DiscoverItem): string {
    if (item.kind === 'comic_issue') {
        const parts: string[] = [];
        if (item.series_name) parts.push(item.series_name);
        if (item.issue_number) parts.push(`#${item.issue_number}`);
        if (item.year) parts.push(`(${item.year})`);
        return parts.join(' ');
    }
    if (item.authors) return item.authors;
    if (item.year) return String(item.year);
    return '';
}

function mapFabState(queue: ReturnType<typeof getQueueState>): QueueFabState {
    if (queue === 'downloaded') return 'downloaded';
    if (queue === 'queued') return 'queued';
    return 'add';
}

/**
 * Detect whether the user follows the author/series this card represents.
 * Tries each follow target the discover payload exposes.
 */
function followedFor(item: DiscoverItem): boolean {
    if (isFollowing(item.watchlist_payload)) return true;
    // Some items carry alternates (e.g. a book with both author + series
    // follow-targets). For now, the `watchlist_payload` is the primary; if
    // we extend DiscoverItem with secondaries later, check them here too.
    return false;
}

/** For UI surfaces that need to look up follow state with a known target. */
export function followedByTarget(target: FollowTarget): boolean {
    return isFollowing(target);
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
