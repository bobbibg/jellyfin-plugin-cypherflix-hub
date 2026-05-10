/**
 * Hover overlay FAB on a card — mirrors Jellyfin's native play-button.
 *
 * Markup verified in `.recon/native-classes-verification.md`:
 *   <button is="paper-icon-button-light"
 *           class="cardOverlayButton cardOverlayButton-hover itemAction
 *                  paper-icon-button-light cardOverlayFab-primary"
 *           data-action="${action}" title="${title}">
 *     <span class="material-icons cardOverlayButtonIcon
 *                  cardOverlayButtonIcon-hover ${codepointIcon}"
 *           aria-hidden="true"></span>
 *   </button>
 *
 * Hover reveal is pure CSS — Jellyfin's stylesheet flips opacity/visibility
 * via the `card-hoverable` ancestor. We do NOT toggle classes from JS.
 *
 * Codepoint mode: the icon's class name carries the Material Icons code
 * point (the span body is empty). Ligature mode (`<span class="material-icons">queue</span>`)
 * also works visually but doesn't match how jellyfin-web renders these
 * buttons, so themes that customise codepoint mode break.
 */

export type QueueFabState = 'add' | 'queued' | 'downloaded';

export interface QueueFabOpts {
    state: QueueFabState;
    /** `data-action` attribute — used by inject.ts / page-level click handlers to identify the button. */
    action?: string;
}

const ICONS: Record<QueueFabState, { codepoint: string; title: string }> = {
    add: { codepoint: 'queue', title: 'Add to Queue' },
    queued: { codepoint: 'hourglass_top', title: 'In Queue' },
    downloaded: { codepoint: 'check', title: 'Downloaded' },
};

/** Returns the FAB button HTML. Place inside `.cardOverlayContainer`. */
export function renderQueueFab(opts: QueueFabOpts): string {
    const { codepoint, title } = ICONS[opts.state];
    const action = opts.action ?? 'cypherflix-queue';
    return (
        `<button is="paper-icon-button-light" type="button"` +
        ` class="cardOverlayButton cardOverlayButton-hover itemAction` +
        ` paper-icon-button-light cardOverlayFab-primary"` +
        ` data-action="${escapeAttr(action)}" title="${escapeAttr(title)}">` +
        `<span class="material-icons cardOverlayButtonIcon` +
        ` cardOverlayButtonIcon-hover ${codepoint}" aria-hidden="true"></span>` +
        `</button>`
    );
}

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
