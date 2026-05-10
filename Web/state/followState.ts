/**
 * Shared user-state cache + event bus.
 *
 * Cards across the page render persistent indicators (star if followed,
 * hollow tick if queued, solid tick if downloaded). State is loaded once
 * on page boot and mutated via custom events so the indicator on every
 * visible card flips the moment a peer card or modal triggers a
 * follow/queue. No re-fetch.
 *
 * Custom events fired on `document`:
 *   - cypherflix:followed    — detail = FollowTarget
 *   - cypherflix:unfollowed  — detail = FollowTarget
 *   - cypherflix:queued      — detail = { item: DiscoverItem, status: RequestStatus }
 */

import { listFollowing, listRequests } from './api';
import type {
    DiscoverItem,
    FollowTarget,
    RequestStatus,
} from '../types/api';

/** Custom-event detail shapes — strongly typed for listeners. */
export interface FollowEventDetail {
    payload: FollowTarget;
}
export interface QueueEventDetail {
    item: DiscoverItem;
    status: RequestStatus;
}

declare global {
    interface DocumentEventMap {
        'cypherflix:followed': CustomEvent<FollowEventDetail>;
        'cypherflix:unfollowed': CustomEvent<FollowEventDetail>;
        'cypherflix:queued': CustomEvent<QueueEventDetail>;
    }
}

/** Compact derived state used by indicators / queue FAB. */
export type CardQueueState = 'none' | 'queued' | 'downloaded';

interface FollowStateInternal {
    authors: Set<number>;       // hardcover_author_id
    bookSeries: Set<number>;    // hardcover_series_id
    comicSeries: Set<number>;   // comicvine_id
    queueBooks: Map<number, RequestStatus>;        // hardcover_book_id   → status
    queueComicIssues: Map<number, RequestStatus>;  // comicvine_issue_id  → status
}

const state: FollowStateInternal = {
    authors: new Set(),
    bookSeries: new Set(),
    comicSeries: new Set(),
    queueBooks: new Map(),
    queueComicIssues: new Map(),
};

let _ready: Promise<void> | null = null;

/**
 * Load the user's current follows + queue, once. Subsequent calls return
 * the same promise. Failures are quiet — components fall back to "none"
 * and re-render whenever a mutation event fires.
 */
export function loadFollowing(): Promise<void> {
    if (_ready) return _ready;
    _ready = (async () => {
        await Promise.all([loadFollowingRows(), loadQueueRows()]);
    })();
    return _ready;
}

async function loadFollowingRows(): Promise<void> {
    try {
        // include_finished=true so cards by retired authors / closed
        // series still light up the star.
        const data = await listFollowing({ include_finished: true });
        for (const it of data.items) {
            if (it.kind === 'book_author' && it.hardcover_author_id != null) {
                state.authors.add(it.hardcover_author_id);
            } else if (it.kind === 'book_series' && it.hardcover_series_id != null) {
                state.bookSeries.add(it.hardcover_series_id);
            } else if (it.kind === 'comic_series' && it.comicvine_id != null) {
                state.comicSeries.add(it.comicvine_id);
            }
        }
    } catch {
        /* fail-quiet — followState stays empty, indicators just don't render */
    }
}

async function loadQueueRows(): Promise<void> {
    try {
        // 500 is well above any plausible queue size; cheaper than paging.
        const data = await listRequests({ limit: 500 });
        for (const r of data.items) {
            if (r.hardcover_book_id != null) {
                state.queueBooks.set(r.hardcover_book_id, r.status);
            }
            if (r.comicvine_issue_id != null) {
                state.queueComicIssues.set(r.comicvine_issue_id, r.status);
            }
        }
    } catch {
        /* fail-quiet */
    }
}

/* -------------------------------------------------------------------------
 * Reads
 * ----------------------------------------------------------------------- */

/** Compact queue state for an item shown on a card. */
export function getQueueState(item: DiscoverItem | null | undefined): CardQueueState {
    if (!item) return 'none';
    let status: RequestStatus | undefined;

    if (item.kind === 'book' && item.source === 'hardcover') {
        const id = Number.parseInt(item.source_id, 10);
        status = Number.isFinite(id) ? state.queueBooks.get(id) : undefined;
    } else if (item.kind === 'comic_issue' && item.source === 'comicvine') {
        const id = Number.parseInt(item.source_id, 10);
        status = Number.isFinite(id) ? state.queueComicIssues.get(id) : undefined;
    }

    if (!status) return 'none';
    return status === 'done' ? 'downloaded' : 'queued';
}

/** Returns true if the user is following the target described by `payload`. */
export function isFollowing(payload: FollowTarget | null | undefined): boolean {
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

/* -------------------------------------------------------------------------
 * Mutations — every one fires a custom event so peer cards re-render.
 * ----------------------------------------------------------------------- */

export function markFollowed(payload: FollowTarget): void {
    if (payload.kind === 'book_author' && payload.hardcover_author_id != null) {
        state.authors.add(payload.hardcover_author_id);
    } else if (payload.kind === 'book_series' && payload.hardcover_series_id != null) {
        state.bookSeries.add(payload.hardcover_series_id);
    } else if (payload.kind === 'comic_series' && payload.comicvine_id != null) {
        state.comicSeries.add(payload.comicvine_id);
    }
    document.dispatchEvent(
        new CustomEvent<FollowEventDetail>('cypherflix:followed', {
            detail: { payload },
        }),
    );
}

export function markUnfollowed(payload: FollowTarget): void {
    if (payload.kind === 'book_author' && payload.hardcover_author_id != null) {
        state.authors.delete(payload.hardcover_author_id);
    } else if (payload.kind === 'book_series' && payload.hardcover_series_id != null) {
        state.bookSeries.delete(payload.hardcover_series_id);
    } else if (payload.kind === 'comic_series' && payload.comicvine_id != null) {
        state.comicSeries.delete(payload.comicvine_id);
    }
    document.dispatchEvent(
        new CustomEvent<FollowEventDetail>('cypherflix:unfollowed', {
            detail: { payload },
        }),
    );
}

export function markQueued(item: DiscoverItem, status: RequestStatus = 'wanted'): void {
    if (item.kind === 'book' && item.source === 'hardcover') {
        const id = Number.parseInt(item.source_id, 10);
        if (Number.isFinite(id)) state.queueBooks.set(id, status);
    } else if (item.kind === 'comic_issue' && item.source === 'comicvine') {
        const id = Number.parseInt(item.source_id, 10);
        if (Number.isFinite(id)) state.queueComicIssues.set(id, status);
    }
    document.dispatchEvent(
        new CustomEvent<QueueEventDetail>('cypherflix:queued', {
            detail: { item, status },
        }),
    );
}
