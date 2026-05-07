// Cypherflix Hub — backend client. Same-origin, talks through the plugin's
// reverse proxy at /Cypherflix/api/* (the C# controller adds the API token
// before forwarding to /api/v1/*).
const BASE = '/Cypherflix/api';

// Jellyfin's web client exposes window.ApiClient — its accessToken() is the
// bearer that the [Authorize] attribute on our reverse-proxy controller checks.
// Sent both as X-Emby-Token (Jellyfin's preferred header) and as a plain
// Authorization: MediaBrowser Token=... so older clients keep working.
function authHeaders() {
    try {
        const tok = window.ApiClient && typeof window.ApiClient.accessToken === 'function'
            ? window.ApiClient.accessToken()
            : null;
        if (!tok) return {};
        return {
            'X-Emby-Token': tok,
            'Authorization': 'MediaBrowser Token="' + tok + '"',
        };
    } catch (_) {
        return {};
    }
}

// Wait until ApiClient.getCurrentUser resolves to a real user — that's the
// signal Jellyfin's session is fully established and the access token will
// be honoured by [Authorize] controllers. On a fresh page-load the token
// can be present but the session not yet bound, hitting our plugin with a
// 401. Cap the wait at 5 s so a genuinely-not-logged-in user fails fast.
let _sessionReady = null;
function sessionReady() {
    if (_sessionReady) return _sessionReady;
    _sessionReady = (async () => {
        const start = Date.now();
        while (Date.now() - start < 5000) {
            try {
                const u = await window.ApiClient?.getCurrentUser?.();
                if (u && u.Id) return true;
            } catch (_) { /* retry */ }
            await new Promise((r) => setTimeout(r, 100));
        }
        return false;
    })();
    return _sessionReady;
}

async function http(method, path, body) {
    await sessionReady();
    const headers = { ...authHeaders() };
    const opts = { method, credentials: 'same-origin', headers };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    let r = await fetch(BASE + path, opts);
    // One-shot retry on 401 — token may have been refreshed mid-flight, or
    // the session wasn't fully bound yet.
    if (r.status === 401) {
        await new Promise((res) => setTimeout(res, 250));
        const headers2 = { ...authHeaders() };
        const opts2 = { method, credentials: 'same-origin', headers: headers2 };
        if (body !== undefined) {
            headers2['Content-Type'] = 'application/json';
            opts2.body = JSON.stringify(body);
        }
        r = await fetch(BASE + path, opts2);
    }
    if (!r.ok) {
        let detail = r.statusText;
        try { const j = await r.json(); if (j.detail) detail = j.detail; } catch (_) {}
        throw new Error('HTTP ' + r.status + ': ' + detail);
    }
    return r.json();
}

export const api = {
    health:           ()                              => http('GET',  '/health'),
    listWatchlist:    (kind)                          => http('GET',  '/watchlist' + (kind ? '?kind=' + encodeURIComponent(kind) : '')),
    getWatchlist:     (id)                            => http('GET',  '/watchlist/' + id),
    createWatchlist:  (body)                          => http('POST', '/watchlist', body),
    patchWatchlist:   (id, body)                      => http('PATCH', '/watchlist/' + id, body),
    deleteWatchlist:  (id)                            => http('DELETE', '/watchlist/' + id),

    listRequests: (params = {}) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
        }
        const qs = q.toString();
        return http('GET', '/requests' + (qs ? '?' + qs : ''));
    },
    getRequest:       (id)                            => http('GET',  '/requests/' + id),
    getRequestCover:  (id)                            => http('GET',  '/requests/' + id + '/cover'),
    retryRequest:     (id)                            => http('POST', '/requests/' + id + '/retry'),
    refreshMetadata:  (id)                            => http('POST', '/requests/' + id + '/refresh-metadata'),
    regrabRequest:    (id)                            => http('POST', '/requests/' + id + '/regrab'),
    deleteRequest:    (id)                            => http('DELETE', '/requests/' + id),

    // Creator blocklist (admin)
    listBlockedCreators:   ()         => http('GET',    '/blocklist/creators'),
    addBlockedCreator:     (body)     => http('POST',   '/blocklist/creators', body),
    removeBlockedCreator:  (id)       => http('DELETE', '/blocklist/creators/' + id),
    refreshBlockedCreator: (id)       => http('POST',   '/blocklist/creators/' + id + '/refresh'),
    triggerSweep:     ()                              => http('POST', '/sweep'),
    triggerReorganize: (dryRun)                       => http('POST', '/reorganize?dry_run=' + (dryRun ? 'true' : 'false')),

    // Discover — Seer-style browse + search surface backed by Hardcover and
    // ComicVine on the grabber side. Each item carries a pre-baked
    // watchlist_payload that the Request CTA POSTs verbatim.
    discoverTrending:    (kind, limit) => {
        const q = new URLSearchParams();
        if (kind)  q.set('kind', kind);
        if (limit) q.set('limit', String(limit));
        return http('GET', '/discover/trending' + (q.toString() ? '?' + q : ''));
    },
    discoverComingSoon:  (limit) => {
        const q = new URLSearchParams();
        if (limit) q.set('limit', String(limit));
        return http('GET', '/discover/coming-soon' + (q.toString() ? '?' + q : ''));
    },
    discoverSearch:      (q, kind, limit) => {
        const params = new URLSearchParams();
        params.set('q', q);
        if (kind)  params.set('kind', kind);
        if (limit) params.set('limit', String(limit));
        return http('GET', '/discover/search?' + params.toString());
    },
};
