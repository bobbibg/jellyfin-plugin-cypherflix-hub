// Shared toast helper. Same Jellyfin-native bottom-center snackbar that
// the Send to Kindle plugin uses. Module instead of inline-in-discover so
// item_detail.js / candidates_modal.js / following.js can reuse it.

export function showToast(message) {
    if (typeof window.require === 'function') {
        try {
            window.require(['toast'], function (toast) {
                if (typeof toast === 'function') toast(message);
                else if (toast && typeof toast.default === 'function') toast.default(message);
                else if (toast && typeof toast.show === 'function') toast.show(message);
                else _renderFallback(message);
            }, function () { _renderFallback(message); });
            return;
        } catch (_) { /* fall through */ }
    }
    _renderFallback(message);
}

function _renderFallback(message) {
    let host = document.getElementById('cypherflixToastHost');
    if (!host) {
        host = document.createElement('div');
        host.id = 'cypherflixToastHost';
        host.style.cssText =
            'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
            'z-index:10000;display:flex;flex-direction:column;gap:8px;align-items:center;' +
            'pointer-events:none;';
        document.body.appendChild(host);
    }
    const toast = document.createElement('div');
    toast.style.cssText =
        'background:#323232;color:#fff;padding:0.85em 1.4em;border-radius:4px;' +
        'box-shadow:0 3px 5px rgba(0,0,0,0.3);font-size:0.95em;' +
        'opacity:0;transition:opacity 200ms ease-in;';
    toast.textContent = message;
    host.appendChild(toast);
    window.requestAnimationFrame(() => { toast.style.opacity = '1'; });
    window.setTimeout(() => {
        toast.style.opacity = '0';
        window.setTimeout(() => toast.remove(), 250);
    }, 3500);
}
