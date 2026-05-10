/**
 * Card indicator chips — top-right of the card cover.
 *
 * Markup verified in `.recon/native-classes-verification.md`:
 *   <div class="cardIndicators">
 *     <div class="<name>Indicator indicator">
 *       <span class="material-icons indicatorIcon ${codepointName}" aria-hidden="true"></span>
 *     </div>
 *   </div>
 *
 * Render only the chips that ARE active — Jellyfin's stylesheet sets
 * `.cardIndicators { display: flex }`, so an empty placeholder div with
 * `hidden` does NOT actually hide. Dynamic injection it is.
 */

import type { CardQueueState } from '../state/followState';

export interface IndicatorOpts {
    /** True when the user follows the author/series/etc. underlying this card. */
    followed: boolean;
    /** Current queue state derived from followState.getQueueState. */
    queue: CardQueueState;
}

/** Returns the inner HTML for the `.cardIndicators` container. */
export function renderIndicators(opts: IndicatorOpts): string {
    const chips: string[] = [];

    if (opts.followed) {
        chips.push(chip('followingIndicator', 'notifications_active'));
    }
    if (opts.queue === 'downloaded') {
        chips.push(chip('playedIndicator', 'check'));
    } else if (opts.queue === 'queued') {
        chips.push(chip('queuedIndicator', 'hourglass_top'));
    }

    return chips.join('');
}

function chip(extraClass: string, materialIcon: string): string {
    return (
        `<div class="${extraClass} indicator">` +
        `<span class="material-icons indicatorIcon ${materialIcon}" aria-hidden="true"></span>` +
        `</div>`
    );
}
