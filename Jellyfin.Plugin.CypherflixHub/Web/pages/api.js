// Cypherflix Hub — backend client. Same-origin, talks through the plugin's
// reverse proxy at /Cypherflix/api/* (the C# controller adds the API token
// before forwarding to /api/v1/*).
const BASE = '/Cypherflix/api';

async function http(method, path, body) {
    const opts = { method, credentials: 'same-origin' };
    if (body !== undefined) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    const r = await fetch(BASE + path, opts);
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
    retryRequest:     (id)                            => http('POST', '/requests/' + id + '/retry'),
    refreshMetadata:  (id)                            => http('POST', '/requests/' + id + '/refresh-metadata'),
    regrabRequest:    (id)                            => http('POST', '/requests/' + id + '/regrab'),
    triggerSweep:     ()                              => http('POST', '/sweep'),
    triggerReorganize: (dryRun)                       => http('POST', '/reorganize?dry_run=' + (dryRun ? 'true' : 'false')),
};
