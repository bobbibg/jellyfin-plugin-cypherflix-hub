/**
 * Toast / snackbar — mirrors Jellyfin 10.11.8's native toast.
 *
 * Markup verified in `.recon/native-classes-verification.md`:
 *   - Singleton `<div class="toastContainer">` mounted on `document.body`
 *   - Per toast: `<div class="toast">{textContent}</div>`
 *   - Lifecycle:
 *       +0    ms  insert into container
 *       +300  ms  add `toastVisible`  (slide-in)
 *       +3300 ms  add `toastHide`     (slide-out — total visible 3 s)
 *       +3600 ms  remove from DOM
 *
 * Uses textContent, never innerHTML — toast strings are user-derived
 * (e.g. error messages from the grabber) and must not be HTML-injected.
 */

const CONTAINER_ID = 'cypherflixToastContainer';
const SHOW_DELAY_MS = 300;
const VISIBLE_MS = 3000;
const HIDE_MS = 300;

function ensureContainer(): HTMLElement {
    let host = document.getElementById(CONTAINER_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = CONTAINER_ID;
    host.className = 'toastContainer';
    document.body.appendChild(host);
    return host;
}

/**
 * Show a toast. Multiple toasts stack vertically inside the container —
 * Jellyfin's native CSS handles the column layout.
 */
export function showToast(message: string): void {
    const host = ensureContainer();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    host.appendChild(toast);

    // Force a reflow before adding the visible class so the transition fires.
    void toast.offsetWidth;
    window.setTimeout(() => {
        toast.classList.add('toastVisible');
    }, SHOW_DELAY_MS);

    window.setTimeout(() => {
        toast.classList.add('toastHide');
    }, SHOW_DELAY_MS + VISIBLE_MS);

    window.setTimeout(() => {
        toast.remove();
        // Drop the container itself if it's empty so we don't leave stray
        // wrappers around when the page unloads.
        if (host.childElementCount === 0 && host.parentNode) {
            host.parentNode.removeChild(host);
        }
    }, SHOW_DELAY_MS + VISIBLE_MS + HIDE_MS);
}
