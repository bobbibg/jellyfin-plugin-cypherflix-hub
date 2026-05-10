/**
 * Cypherflix Hub bootstrap.
 *
 * Plugin Pages 2.4.9.0 already mounts our HTML fragment inside
 * `.userPluginSettingsContainer` (verified in
 * `.recon/plugin-pages-verification.md`). Each page fragment carries a
 * single root element:
 *
 *     <div id="cypherflix-hub-root" data-page="discover|queue|following|detail">
 *
 * On bundle load we look up the `data-page` attribute and dispatch into
 * the matching page module's `render(host)` function. We also kick off
 * `inject.ts` once so native-Jellyfin DOM injections (Follow buttons on
 * book pages, queue FAB on missing items) start observing.
 *
 * No Custom Tabs / KefinTweaks workarounds — those are entirely gone in
 * v4.0 because Plugin Pages does the routing for us.
 */

// CSS side-effect import — Vite only bundles CSS that's imported by a TS
// module. Without this, `Web/styles/main.css` is skipped, the embedded
// `bundle.css` resource is missing, and the WebController returns 404
// for the <link> tag injected into every fragment.
import './styles/main.css';

import { bootJellyfinInjections } from './inject';
import * as discover from './pages/discover';
import * as queue from './pages/queue';
import * as following from './pages/following';
import * as detail from './pages/detail';

type PageKey = 'discover' | 'queue' | 'following' | 'detail';

interface PageModule {
    render(host: HTMLElement): Promise<void> | void;
}

const PAGES: Record<PageKey, PageModule> = {
    discover,
    queue,
    following,
    detail,
};

const ROOT_ID = 'cypherflix-hub-root';
const DATA_ATTR = 'page';

async function renderRoot(): Promise<void> {
    const host = document.getElementById(ROOT_ID);
    if (!host) return;
    if (host.dataset['cfRendered'] === '1') return;

    const pageKey = host.dataset[DATA_ATTR] as PageKey | undefined;
    if (!pageKey || !(pageKey in PAGES)) {
        renderError(host, `Unknown cypherflix page: "${pageKey ?? '<missing>'}"`);
        return;
    }

    host.dataset['cfRendered'] = '1';
    try {
        await PAGES[pageKey].render(host);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        renderError(host, msg);
        delete host.dataset['cfRendered'];
    }
}

function renderError(host: HTMLElement, msg: string): void {
    host.innerHTML =
        `<div class="movie-history-empty-message">` +
        `<div class="empty-message-icon"><span class="material-icons">error_outline</span></div>` +
        `<h3 class="empty-message-title">Cypherflix Hub failed to load</h3>` +
        `<p class="empty-message-subtitle">${escapeText(msg)}</p>` +
        `</div>`;
}

function escapeText(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function boot(): void {
    if (window.__cypherflixHubLoaded) {
        // Bundle was loaded twice — re-render is still safe but skip the
        // injection observer since it would double-bind.
        void renderRoot();
        return;
    }
    window.__cypherflixHubLoaded = true;

    // Fragment is already in the DOM by the time this script runs (Plugin
    // Pages does `ApiClient.ajax({type:'GET',url:pageUrl})` then appends
    // before evaluating the inline scripts).
    void renderRoot();

    // Native-page injection observer: runs once, lives forever.
    try {
        bootJellyfinInjections();
    } catch (err) {
        console.warn('cypherflix-hub: injection bootstrap failed', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
