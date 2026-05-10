/**
 * Typed fetch wrappers around the cypherflix-grabber backend.
 *
 * Talks to the plugin's reverse proxy at `/Cypherflix/api/*` (the C#
 * `ProxyController` adds the grabber API token before forwarding to the
 * grabber's `/api/v1/*`). Plugin code must NEVER embed the grabber token
 * itself — this is the only auth surface.
 *
 * Every method returns the verified shape from `Web/types/api.ts`. See
 * `.recon/grabber-openapi-diff.md` for the citations that grounded those
 * shapes.
 */

import { authHeaders, sessionReady } from './jellyfin';
import type {
    AuthorBibliography,
    BlockedCreatorRow,
    BlockedCreatorsPage,
    BlocklistReleaseBody,
    CandidateStrictness,
    CandidatesResponse,
    CreatorCreateBody,
    DiscoverItemDetail,
    DiscoverItemKind,
    DiscoverPage,
    FollowingCreate,
    FollowingKind,
    FollowingPage,
    FollowingPatch,
    FollowingRow,
    GrabBody,
    HealthResponse,
    QueueAddBody,
    QueueAddResponse,
    ReorganizeParams,
    RequestCoverResponse,
    RequestDetail,
    RequestsListParams,
    RequestsPage,
    SweepParams,
    TrendingKind,
} from '../types/api';

const BASE = '/Cypherflix/api';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface HttpInit {
    method: HttpMethod;
    body?: unknown;
}

/**
 * Execute a fetch against the proxy with one-shot 401 retry. The retry
 * exists for cold-start: the access token can be present before
 * Jellyfin's session is fully bound, so the first call after page load
 * sometimes 401s even though we'll succeed 250 ms later.
 */
async function http<T>(path: string, init: HttpInit): Promise<T> {
    await sessionReady();

    const exec = async (): Promise<Response> => {
        const headers: Record<string, string> = { ...authHeaders() };
        const opts: RequestInit = {
            method: init.method,
            credentials: 'same-origin',
            headers,
        };
        if (init.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(init.body);
        }
        return fetch(BASE + path, opts);
    };

    let r = await exec();
    if (r.status === 401) {
        await new Promise((res) => setTimeout(res, 250));
        r = await exec();
    }

    if (!r.ok) {
        let detail: string = r.statusText;
        try {
            const j = (await r.json()) as { detail?: string };
            if (j && typeof j.detail === 'string') detail = j.detail;
        } catch {
            /* body was not JSON; keep statusText */
        }
        throw new Error(`HTTP ${r.status}: ${detail}`);
    }

    return (await r.json()) as T;
}

/**
 * Build a query string from an object, dropping undefined / null / empty
 * values. Accepts any plain object — typed interfaces (like SweepParams)
 * lack an index signature, so we cast inside rather than constrain the
 * caller to `Record<string, unknown>`.
 */
function qs(params: object): string {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
        if (v === undefined || v === null || v === '') continue;
        usp.set(k, String(v));
    }
    const s = usp.toString();
    return s ? '?' + s : '';
}

/* -------------------------------------------------------------------------
 * Health
 * ----------------------------------------------------------------------- */

export const health = (): Promise<HealthResponse> =>
    http<HealthResponse>('/health', { method: 'GET' });

/* -------------------------------------------------------------------------
 * Following (renamed from /watchlist in v3.0)
 * ----------------------------------------------------------------------- */

export const listFollowing = (
    opts: { kind?: FollowingKind; include_finished?: boolean } = {},
): Promise<FollowingPage> =>
    http<FollowingPage>('/following' + qs(opts), { method: 'GET' });

export const getFollowing = (id: number): Promise<FollowingRow> =>
    http<FollowingRow>(`/following/${id}`, { method: 'GET' });

export const createFollowing = (body: FollowingCreate): Promise<FollowingRow> =>
    http<FollowingRow>('/following', { method: 'POST', body });

export const patchFollowing = (
    id: number,
    body: FollowingPatch,
): Promise<FollowingRow> =>
    http<FollowingRow>(`/following/${id}`, { method: 'PATCH', body });

export const deleteFollowing = (id: number): Promise<void> =>
    http<void>(`/following/${id}`, { method: 'DELETE' });

/* -------------------------------------------------------------------------
 * Queue + Requests
 * ----------------------------------------------------------------------- */

export const queueAdd = (body: QueueAddBody): Promise<QueueAddResponse> =>
    http<QueueAddResponse>('/queue/add', { method: 'POST', body });

export const listRequests = (params: RequestsListParams = {}): Promise<RequestsPage> =>
    http<RequestsPage>('/requests' + qs(params), { method: 'GET' });

/**
 * GET /requests/{id} returns a wrapper, NOT a flat row. The previous
 * plugin's typing was wrong — fields like `id`, `status`, etc. live on
 * `result.request`, not `result`.
 */
export const getRequest = (id: number): Promise<RequestDetail> =>
    http<RequestDetail>(`/requests/${id}`, { method: 'GET' });

export const getRequestCover = (id: number): Promise<RequestCoverResponse> =>
    http<RequestCoverResponse>(`/requests/${id}/cover`, { method: 'GET' });

export const retryRequest = (id: number): Promise<RequestDetail> =>
    http<RequestDetail>(`/requests/${id}/retry`, { method: 'POST' });

export const refreshRequestMetadata = (id: number): Promise<RequestDetail> =>
    http<RequestDetail>(`/requests/${id}/refresh-metadata`, { method: 'POST' });

export const regrabRequest = (id: number): Promise<RequestDetail> =>
    http<RequestDetail>(`/requests/${id}/regrab`, { method: 'POST' });

export const deleteRequest = (id: number): Promise<void> =>
    http<void>(`/requests/${id}`, { method: 'DELETE' });

export const loosenRequest = (id: number): Promise<RequestDetail> =>
    http<RequestDetail>(`/requests/${id}/loosen`, { method: 'POST', body: {} });

export const requestCandidates = (
    id: number,
    strictness?: CandidateStrictness,
): Promise<CandidatesResponse> =>
    http<CandidatesResponse>(
        `/requests/${id}/candidates` + qs({ strictness }),
        { method: 'GET' },
    );

export const requestGrab = (id: number, body: GrabBody): Promise<RequestDetail> =>
    http<RequestDetail>(`/requests/${id}/grab`, { method: 'POST', body });

export const blocklistRelease = (
    id: number,
    body: BlocklistReleaseBody,
): Promise<RequestDetail> =>
    http<RequestDetail>(`/requests/${id}/blocklist-release`, { method: 'POST', body });

/* -------------------------------------------------------------------------
 * Discover
 * ----------------------------------------------------------------------- */

/**
 * NOTE: trending uses a NARROWER kind enum than the rest of Discover —
 * passing `comic_issue` etc. will 422. Accept only `'book' | 'comic'`.
 */
export const discoverTrending = (
    kind: TrendingKind,
    limit?: number,
): Promise<DiscoverPage> =>
    http<DiscoverPage>('/discover/trending' + qs({ kind, limit }), { method: 'GET' });

export const discoverComingSoon = (limit?: number): Promise<DiscoverPage> =>
    http<DiscoverPage>('/discover/coming-soon' + qs({ limit }), { method: 'GET' });

export const discoverSearch = (
    q: string,
    opts: { kind?: DiscoverItemKind; limit?: number } = {},
): Promise<DiscoverPage> =>
    http<DiscoverPage>('/discover/search' + qs({ q, ...opts }), { method: 'GET' });

export const discoverItem = (
    kind: DiscoverItemKind,
    sourceId: string,
): Promise<DiscoverItemDetail> =>
    http<DiscoverItemDetail>(
        `/discover/item/${encodeURIComponent(kind)}/${encodeURIComponent(sourceId)}`,
        { method: 'GET' },
    );

export const discoverAuthorBibliography = (
    hardcoverAuthorId: number,
): Promise<AuthorBibliography> =>
    http<AuthorBibliography>(
        `/discover/author/${encodeURIComponent(hardcoverAuthorId)}/bibliography`,
        { method: 'GET' },
    );

/* -------------------------------------------------------------------------
 * Blocklisted creators (admin)
 * ----------------------------------------------------------------------- */

export const listBlockedCreators = (): Promise<BlockedCreatorsPage> =>
    http<BlockedCreatorsPage>('/blocklist/creators', { method: 'GET' });

export const addBlockedCreator = (body: CreatorCreateBody): Promise<BlockedCreatorRow> =>
    http<BlockedCreatorRow>('/blocklist/creators', { method: 'POST', body });

export const removeBlockedCreator = (id: number): Promise<void> =>
    http<void>(`/blocklist/creators/${id}`, { method: 'DELETE' });

export const refreshBlockedCreator = (id: number): Promise<BlockedCreatorRow> =>
    http<BlockedCreatorRow>(`/blocklist/creators/${id}/refresh`, { method: 'POST' });

/**
 * Helper for the blocklist UI — `aliases_json` is stored as a JSON-encoded
 * string on the grabber side and returned un-parsed.
 */
export const parseAliases = (row: BlockedCreatorRow): string[] => {
    try {
        const parsed = JSON.parse(row.aliases_json) as unknown;
        return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
        return [];
    }
};

/* -------------------------------------------------------------------------
 * Admin sweeps
 * ----------------------------------------------------------------------- */

export const triggerSweep = (params: SweepParams = {}): Promise<unknown> =>
    http<unknown>('/sweep' + qs(params), { method: 'POST' });

export const triggerReorganize = (params: ReorganizeParams = {}): Promise<unknown> =>
    http<unknown>('/reorganize' + qs(params), { method: 'POST' });
