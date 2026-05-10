/**
 * Horizontal-scrolling row of cards. Mirrors Jellyfin 10.11.8's home-page
 * "Latest in <Library>" pattern — verified in
 * `.recon/native-classes-verification.md`.
 *
 * Two title patterns exist on the home page:
 *   - LatestMedia (named library row): wrapped in
 *       <div class="sectionTitleContainer sectionTitleContainer-cards padded-left">
 *         <h2 class="sectionTitle sectionTitle-cards">…</h2>
 *       </div>
 *   - Resume / NextUp: BARE
 *       <h2 class="sectionTitle sectionTitle-cards padded-left">…</h2>
 *
 * The scroller itself is the same in both cases:
 *   <div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">
 *     <div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">
 *       <!-- cards -->
 *     </div>
 *   </div>
 *
 * Notes:
 *   - `emby-scroller-container` is added to the scroller's parent automatically
 *     by the custom-element constructor at upgrade time. Don't write it.
 *   - The scroll arrows are injected by the emby-scroller component itself.
 *   - The outer wrapper class is `verticalSection`.
 */

import { renderCard, refreshCardState } from './card';
import type { DiscoverItem } from '../types/api';

export type CarouselTitleStyle = 'wrapped' | 'bare';

export interface CarouselOpts {
    title: string;
    items: DiscoverItem[];
    /**
     * `wrapped` (default) renders the LatestMedia-style title container.
     * `bare` renders just the `<h2>` (NextUp/Resume style).
     */
    titleStyle?: CarouselTitleStyle;
    /** Optional "More" link — anchored on the title container. */
    moreHref?: string;
    /**
     * Forwarded to the card component. When false, suppresses the hover
     * queue FAB on every card in this row.
     */
    showQueueFab?: boolean;
}

export function renderCarousel(opts: CarouselOpts): string {
    const titleStyle = opts.titleStyle ?? 'wrapped';
    const showQueueFab = opts.showQueueFab ?? true;

    const cards = opts.items
        .map((item) => renderCard({ item, showQueueFab }))
        .join('');

    const titleHtml = titleStyle === 'wrapped'
        ? renderWrappedTitle(opts.title, opts.moreHref)
        : renderBareTitle(opts.title);

    return (
        `<div class="verticalSection">` +
        titleHtml +
        `<div is="emby-scroller" class="padded-top-focusscale padded-bottom-focusscale" data-centerfocus="true">` +
        `<div is="emby-itemscontainer" class="itemsContainer scrollSlider focuscontainer-x">` +
        cards +
        `</div>` +
        `</div>` +
        `</div>`
    );
}

function renderWrappedTitle(title: string, moreHref?: string): string {
    const titleText = `<h2 class="sectionTitle sectionTitle-cards">${escapeText(title)}</h2>`;
    if (moreHref) {
        return (
            `<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">` +
            `<a is="emby-linkbutton" href="${escapeAttr(moreHref)}"` +
            ` class="more button-flat button-flat-mini sectionTitleTextButton">` +
            titleText +
            `<span class="material-icons chevron_right" aria-hidden="true"></span>` +
            `</a>` +
            `</div>`
        );
    }
    return (
        `<div class="sectionTitleContainer sectionTitleContainer-cards padded-left">` +
        titleText +
        `</div>`
    );
}

function renderBareTitle(title: string): string {
    return `<h2 class="sectionTitle sectionTitle-cards padded-left">${escapeText(title)}</h2>`;
}

/**
 * Re-render the indicators + queue FAB on every card in this carousel.
 * Wire this into the `cypherflix:followed/unfollowed/queued` listeners on
 * the page so a single mutation updates every visible card without a
 * re-fetch.
 */
export function refreshCarouselState(
    host: HTMLElement,
    items: DiscoverItem[],
): void {
    const cards = host.querySelectorAll<HTMLElement>('.card');
    cards.forEach((card, idx) => {
        const item = items[idx];
        if (item) refreshCardState(card, item);
    });
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
