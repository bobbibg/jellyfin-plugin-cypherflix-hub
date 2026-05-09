// Shared user-state cache + event bus.
//
// v3.0.1: cards render persistent indicators in the top-right of the cover
// (star if followed, hollow tick if queued, solid tick if downloaded). The
// state is loaded once and updated via custom events fired by handlers, so
// the indicator on any card flips the moment a peer card or the Item Detail
// modal triggers a follow/queue.
//
// Events:
//   cypherflix:followed    detail = follow target payload
//   cypherflix:unfollowed  detail = follow target payload
//   cypherflix:queued      detail = { kind, hardcover_book_id|comicvine_issue_id, status }

let _api;
let _ready = null;

const state = {
    authors: new Set(),     // hardcover_author_id
    bookSeries: new Set(),  // hardcover_series_id
    comicSeries: new Set(), // comicvine_id

    // Per-item queue status: 'wanted' | 'searching' | 'snatched' | 'downloading'
    //                        | 'importing' | 'tagging' | 'done' | 'failed' | 'blocked'
    // Keyed by source identifier; the renderer maps this to:
    //   any non-'done' value     → hollow tick
    //   'done'                   → solid tick
    queueBooks: new Map(),         // hardcover_book_id   → status
    queueComicIssues: new Map(),   // comicvine_issue_id  → status
};

async function _loadApi() {
    if (_api) return _api;
    const cb = '?cb=' + Date.now();
    _api = (await import('./api.js' + cb)).api;
    return _api;
}

export async function loadFollowing() {
    if (_ready) return _ready;
    _ready = (async () => {
        const api = await _loadApi();
        // Fetch follows (with finished included so the star still appears
        // on cards by retired-but-followed authors / series) AND the request
        // queue, in parallel — both are independent reads.
        await Promise.all([
            (async () => {
                try {
                    const data = await api.listFollowing(undefined);
                    const items = (data && data.items) || [];
                    for (const it of items) {
                        if (it.kind === 'book_author' && it.hardcover_author_id) {
                            state.authors.add(it.hardcover_author_id);
                        } else if (it.kind === 'book_series' && it.hardcover_series_id) {
                            state.bookSeries.add(it.hardcover_series_id);
                        } else if (it.kind === 'comic_series' && it.comicvine_id) {
                            state.comicSeries.add(it.comicvine_id);
                        }
                    }
                } catch (_) { /* fail-quiet */ }
            })(),
            (async () => {
                try {
                    // Pull a generous slice; the request count rarely exceeds
                    // a few hundred and a single page is cheaper than paging.
                    const data = await api.listRequests({ limit: 500 });
                    const items = (data && data.items) || [];
                    for (const it of items) {
                        if (it.hardcover_book_id) {
                            state.queueBooks.set(it.hardcover_book_id, it.status);
                        }
                        if (it.comicvine_issue_id) {
                            state.queueComicIssues.set(it.comicvine_issue_id, it.status);
                        }
                    }
                } catch (_) { /* fail-quiet */ }
            })(),
        ]);
    })();
    return _ready;
}

/** 'none' | 'queued' (any non-done status) | 'downloaded' (status=='done'). */
export function getQueueState(item) {
    if (!item) return 'none';
    let status;
    if (item.kind === 'book' && item.source === 'hardcover') {
        const id = parseInt(item.source_id, 10);
        status = state.queueBooks.get(id);
    } else if (item.kind === 'comic_issue' && item.source === 'comicvine') {
        const id = parseInt(item.source_id, 10);
        status = state.queueComicIssues.get(id);
    }
    if (!status) return 'none';
    return status === 'done' ? 'downloaded' : 'queued';
}

export function markQueued(item, status) {
    if (!item) return;
    const s = status || 'wanted';
    if (item.kind === 'book' && item.source === 'hardcover') {
        const id = parseInt(item.source_id, 10);
        if (id) state.queueBooks.set(id, s);
    } else if (item.kind === 'comic_issue' && item.source === 'comicvine') {
        const id = parseInt(item.source_id, 10);
        if (id) state.queueComicIssues.set(id, s);
    }
    document.dispatchEvent(new CustomEvent('cypherflix:queued', {
        detail: { item, status: s },
    }));
}

/** Returns true if the user is following the target described by `payload`. */
export function isFollowing(payload) {
    if (!payload) return false;
    if (payload.kind === 'book_author' && payload.hardcover_author_id != null) {
        return state.authors.has(payload.hardcover_author_id);
    }
    if (payload.kind === 'book_series' && payload.hardcover_series_id != null) {
        return state.bookSeries.has(payload.hardcover_series_id);
    }
    if (payload.kind === 'comic_series' && payload.comicvine_id != null) {
        return state.comicSeries.has(payload.comicvine_id);
    }
    return false;
}

export function markFollowed(payload) {
    if (!payload) return;
    if (payload.kind === 'book_author' && payload.hardcover_author_id != null) {
        state.authors.add(payload.hardcover_author_id);
    } else if (payload.kind === 'book_series' && payload.hardcover_series_id != null) {
        state.bookSeries.add(payload.hardcover_series_id);
    } else if (payload.kind === 'comic_series' && payload.comicvine_id != null) {
        state.comicSeries.add(payload.comicvine_id);
    }
    document.dispatchEvent(new CustomEvent('cypherflix:followed', {
        detail: payload,
    }));
}

export function markUnfollowed(payload) {
    if (!payload) return;
    if (payload.kind === 'book_author' && payload.hardcover_author_id != null) {
        state.authors.delete(payload.hardcover_author_id);
    } else if (payload.kind === 'book_series' && payload.hardcover_series_id != null) {
        state.bookSeries.delete(payload.hardcover_series_id);
    } else if (payload.kind === 'comic_series' && payload.comicvine_id != null) {
        state.comicSeries.delete(payload.comicvine_id);
    }
    document.dispatchEvent(new CustomEvent('cypherflix:unfollowed', {
        detail: payload,
    }));
}
