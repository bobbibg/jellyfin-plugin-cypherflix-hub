/**
 * Item detail page chrome.
 *
 * Mirrors Jellyfin 10.11.8's native `controllers/itemDetails/index.html`
 * structure exactly — verified in `.recon/native-classes-verification.md`.
 *
 *   <div id="itemDetailPage" class="page libraryPage itemDetailPage
 *        noSecondaryNavPage selfBackdropPage" data-role="page" data-backbutton="true">
 *     <div id="itemBackdrop" class="itemBackdrop"></div>
 *     <div class="detailLogo"></div>
 *     <div class="detailPageWrapperContainer">
 *       <div class="detailPagePrimaryContainer">
 *         <div class="detailImageContainer hide-mobile"></div>
 *         <div class="detailRibbon padded-left padded-right">
 *           <div class="infoWrapper">
 *             <div class="detailImageContainer hide-desktop hide-tv"></div>
 *             <div class="nameContainer"><h1>...</h1></div>
 *             <div class="itemMiscInfo itemMiscInfo-primary"></div>
 *             <div class="itemMiscInfo itemMiscInfo-secondary"></div>
 *           </div>
 *           <div class="mainDetailButtons focuscontainer-x">
 *             <!-- detailButton instances -->
 *           </div>
 *         </div>
 *       </div>
 *       <div class="detailPageContent" data-cypherflix-slot="content"></div>
 *     </div>
 *   </div>
 *
 * Each detail button:
 *   <button is="emby-button" type="button"
 *           class="button-flat detailButton ${extraClass}"
 *           title="${tooltipLabel}" data-action="${dataAction}">
 *     <div class="detailButton-content">
 *       <span class="material-icons detailButton-icon ${codepointIcon}"
 *             aria-hidden="true"></span>
 *     </div>
 *   </button>
 *
 * Note that 10.11.8 dropped the `<div class="detailButton-text">` label —
 * label is carried solely as the tooltip on `title`. Earlier drafts of
 * the architecture doc were wrong about this.
 */

export interface DetailButtonOpts {
    /** Material Icons class name (codepoint mode). */
    icon: string;
    /** Tooltip label shown on hover. */
    title: string;
    /** Optional `data-action` for click delegation. */
    action?: string;
    /** Extra class names to add (e.g. `btnFollow`, `cypherflix-queue`). */
    extraClass?: string;
    /** When true, render with the `hide` class (Jellyfin's pattern). */
    hidden?: boolean;
}

export function renderDetailButton(opts: DetailButtonOpts): string {
    const cls = ['button-flat', 'detailButton'];
    if (opts.extraClass) cls.push(opts.extraClass);
    if (opts.hidden) cls.push('hide');

    const action = opts.action ? ` data-action="${escapeAttr(opts.action)}"` : '';

    return (
        `<button is="emby-button" type="button" class="${cls.join(' ')}"` +
        ` title="${escapeAttr(opts.title)}"${action}>` +
        `<div class="detailButton-content">` +
        `<span class="material-icons detailButton-icon ${opts.icon}" aria-hidden="true"></span>` +
        `</div>` +
        `</button>`
    );
}

export interface DetailPageOpts {
    title: string;
    /** Optional secondary line (e.g. authors, series). */
    subtitle?: string;
    /** Optional tertiary line (e.g. release date, page count). */
    metaLine?: string;
    /** Cover image URL — placed in detailImageContainer. */
    coverUrl?: string | null;
    /** Backdrop URL — placed as background-image on `#itemBackdrop`. */
    backdropUrl?: string | null;
    /** mainDetailButtons row — order matters; render Queue/Follow/etc. */
    buttons: DetailButtonOpts[];
    /**
     * Inner content slot — overview text, "More by author" carousel,
     * status panel, etc. Rendered inside `data-cypherflix-slot="content"`.
     */
    contentHtml?: string;
}

export function renderDetailPage(opts: DetailPageOpts): string {
    const buttons = opts.buttons.map(renderDetailButton).join('');

    const cover = opts.coverUrl
        ? `<img class="detailImageImg" src="${escapeAttr(opts.coverUrl)}" alt="" />`
        : '';
    const backdropStyle = opts.backdropUrl
        ? ` style="background-image:url('${escapeAttr(opts.backdropUrl)}');"`
        : '';

    return (
        `<div id="itemDetailPage" data-role="page"` +
        ` class="page libraryPage itemDetailPage noSecondaryNavPage selfBackdropPage"` +
        ` data-backbutton="true">` +
        `<div id="itemBackdrop" class="itemBackdrop"${backdropStyle}></div>` +
        `<div class="detailLogo"></div>` +
        `<div class="detailPageWrapperContainer">` +
        `<div class="detailPagePrimaryContainer">` +
        `<div class="detailImageContainer hide-mobile">${cover}</div>` +
        `<div class="detailRibbon padded-left padded-right">` +
        `<div class="infoWrapper">` +
        `<div class="detailImageContainer hide-desktop hide-tv">${cover}</div>` +
        `<div class="nameContainer">` +
        `<h1 class="parentName">${escapeText(opts.title)}</h1>` +
        (opts.subtitle ? `<h3 class="itemName">${escapeText(opts.subtitle)}</h3>` : '') +
        `</div>` +
        (opts.metaLine
            ? `<div class="itemMiscInfo itemMiscInfo-primary" style="margin-bottom:0.6em;">${escapeText(opts.metaLine)}</div>`
            : '') +
        `</div>` +
        `<div class="mainDetailButtons focuscontainer-x">${buttons}</div>` +
        `</div>` +
        `</div>` +
        `<div class="detailPageContent" data-cypherflix-slot="content">${opts.contentHtml ?? ''}</div>` +
        `</div>` +
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
