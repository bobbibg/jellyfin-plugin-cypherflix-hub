/**
 * Cypherflix grabber API types — version 2.0.0 (cypherflix-grabber).
 *
 * EVERY type below is verified against the live grabber's OpenAPI document
 * (request shapes) AND live curl responses (response shapes), captured in
 * `.recon/grabber-openapi-diff.md` and `.recon/grabber-openapi.json`.
 *
 * Caveat: the grabber's FastAPI routes do not declare `response_model=...`,
 * so OpenAPI alone cannot validate response shapes. Until that's fixed
 * grabber-side, types here remain hand-written; codegen via
 * openapi-typescript is deferred to v4.1.
 *
 * Do NOT add a field here without a matching live sample (or a Pydantic
 * model on the grabber side that we can cite).
 */

/* -------------------------------------------------------------------------
 * Enums — verified against OpenAPI request schemas + live samples.
 * ----------------------------------------------------------------------- */

export type FollowingKind = 'comic_series' | 'book_author' | 'book_series';

export type RequestKind = 'comic_issue' | 'book' | 'audiobook';

/**
 * RequestStatus is NOT an OpenAPI-declared enum (the routes accept plain
 * `string` query params). Values below come from the grabber's Python
 * source `db/migrations.py` and `services/state_machine.py`. Re-verify if
 * a new state appears in a live response.
 */
export type RequestStatus =
    | 'wanted'
    | 'searching'
    | 'snatched'
    | 'downloading'
    | 'importing'
    | 'tagging'
    | 'done'
    | 'failed'
    | 'blocked';

export type MonitorMode = 'all' | 'new_only' | 'specific_volumes';

/**
 * The Discover detail/search/coming-soon endpoints accept this wider enum.
 * `/discover/trending` accepts a NARROWER enum — see TrendingKind.
 */
export type DiscoverItemKind = 'book' | 'comic_issue' | 'comic_series';

/**
 * `/discover/trending?kind=` rejects the wider DiscoverItemKind set with
 * 422 (verified live). Use this enum on the trending call site only.
 */
export type TrendingKind = 'book' | 'comic';

export type DiscoverItemSource = 'hardcover' | 'comicvine';

export type Protocol = 'usenet' | 'torrent';

export type CandidateStrictness = 'strict' | 'loose' | 'raw';

export type QueueState = 'none' | 'queued' | 'downloading' | 'in_library';

/* -------------------------------------------------------------------------
 * Following + Discover targets.
 * ----------------------------------------------------------------------- */

/** Pre-baked watchlist payload — frontend POSTs this verbatim to /following. */
export interface FollowTarget {
    kind: FollowingKind;
    display_name: string;
    hardcover_author_id?: number;
    hardcover_series_id?: number;
    comicvine_id?: number;
}

export interface DiscoverItem {
    kind: DiscoverItemKind;
    source: DiscoverItemSource;
    source_id: string;
    title: string;
    series_name: string | null;
    issue_number: string | null;
    year: number | null;
    authors: string | null;
    release_date: string | null;
    cover_url: string | null;
    summary: string | null;
    watchlist_kind: FollowingKind;
    watchlist_payload: FollowTarget;
}

export interface DiscoverPage {
    items: DiscoverItem[];
    total: number;
}

/** GET /api/v1/following */
export interface FollowingRow {
    id: number;
    kind: FollowingKind;
    display_name: string;
    comicvine_id: number | null;
    hardcover_author_id: number | null;
    hardcover_series_id: number | null;
    monitor_mode: MonitorMode;
    cutoff_year: number | null;
    added_at: string;
    added_by: string | null;
    active: boolean;
    /** Best-effort author portrait / series cover. */
    picture_url: string | null;
    /** Heuristic for finished comic series (true → hidden by default). */
    is_finished: boolean;
}

export interface FollowingPage {
    items: FollowingRow[];
    total: number;
    /** Count of finished series filtered out — only > 0 when include_finished=false. */
    finished_hidden: number;
}

/** POST /api/v1/following body. */
export interface FollowingCreate {
    kind: FollowingKind;
    display_name: string;
    comicvine_id?: number | null;
    hardcover_author_id?: number | null;
    hardcover_series_id?: number | null;
    monitor_mode?: MonitorMode;
    cutoff_year?: number | null;
    added_by?: string | null;
}

/** PATCH /api/v1/following/{id} body — only these two fields are accepted. */
export interface FollowingPatch {
    active?: boolean;
    monitor_mode?: MonitorMode;
}

/* -------------------------------------------------------------------------
 * Queue + Requests.
 * ----------------------------------------------------------------------- */

/** POST /api/v1/queue/add */
export interface QueueAddBody {
    kind: RequestKind;
    series_name: string;
    title?: string;
    comicvine_issue_id?: number;
    hardcover_book_id?: number;
    isbn_13?: string;
    series_year?: number;
    issue_number?: string;
    authors?: string;
    release_date?: string;
    following_id?: number;
}

/**
 * Response shape unverified against a live POST sample as of round 4 recon.
 * Re-verify with a real POST during v4.0 implementation.
 */
export interface QueueAddResponse {
    request_id: number;
    status: RequestStatus;
    existed: boolean;
}

/** Row in /api/v1/requests list. */
export interface RequestRow {
    id: number;
    following_id: number | null;
    kind: RequestKind;
    comicvine_issue_id: number | null;
    hardcover_book_id: number | null;
    isbn_13: string | null;
    series_name: string;
    series_year: number | null;
    issue_number: string | null;
    title: string | null;
    authors: string | null;
    release_date: string | null;
    status: RequestStatus;
    status_reason: string | null;
    progress_pct: number | null;
    size_mb: number | null;
    imported_path: string | null;
    is_user_watch: boolean;
    retries: number;
    created_at: string;
    updated_at: string;
    /** Set when the user explicitly loosened search via /loosen. */
    user_loosened_at: string | null;
    cover_url?: string | null;
    summary?: string | null;
}

export interface RequestsPage {
    items: RequestRow[];
    total: number;
}

/**
 * GET /api/v1/requests/{id} returns this wrapper, NOT a flat RequestRow.
 * (Plugin's prior typing was wrong — the response is `{request, releases}`.)
 */
export interface RequestDetail {
    request: RequestRow;
    releases: ReleaseAttempt[];
}

export interface ReleaseAttempt {
    id: number;
    request_id: number;
    title_norm: string;
    protocol: Protocol;
    indexer: string | null;
    size_bytes: number | null;
    download_url: string | null;
    score: number | null;
    /** Saw 'succeeded' in samples; full enum not yet documented grabber-side. */
    state: string;
    sab_nzo_id: string | null;
    qbit_hash: string | null;
    /** Saw 'auto' in samples — origin of the grab attempt. */
    source: string;
    attempted_at: string;
}

/** GET /api/v1/requests/{id}/cover */
export interface RequestCoverResponse {
    cover_url: string | null;
    /** Saw 'cache' in samples — provenance of the URL. */
    source: string;
}

/* -------------------------------------------------------------------------
 * Discover detail + bibliography.
 * ----------------------------------------------------------------------- */

/** GET /api/v1/discover/item/{kind}/{source_id} — full record + follow targets. */
export interface DiscoverItemDetail {
    kind: DiscoverItemKind;
    source: DiscoverItemSource;
    source_id: string;
    title: string;
    release_date: string | null;
    summary: string | null;
    page_count?: number | null;
    rating?: number | null;
    users_count?: number | null;
    cover_url: string | null;
    series?: string | null;
    issue_number?: string | null;
    /**
     * Books use `contribution`, comic_issues use `role` — confirmed from
     * live samples. Both fields optional; one will be present.
     */
    contributors: Array<{
        id: number;
        name: string;
        contribution?: string;
        role?: string;
    }>;
    queue_payload: QueueAddBody;
    follow_targets: {
        author?: FollowTarget;
        series?: FollowTarget;
        story_arc?: FollowTarget & { supported?: boolean };
    };
}

/** GET /api/v1/discover/author/{id}/bibliography */
export interface AuthorBibliography {
    author_id: number;
    series: Array<{
        series_id: number;
        series_name: string;
        follow_target: FollowTarget;
        books: BibliographyBook[];
    }>;
    standalone: BibliographyBook[];
}

export interface BibliographyBook {
    hardcover_book_id: number;
    title: string;
    release_date: string | null;
    year: number | null;
    cover_url: string | null;
    authors: string | null;
    contribution: string | null;
    queue_state: QueueState;
    request_id: number | null;
    queue_payload: QueueAddBody;
    /** Float — e.g. 0.0, 1.0, 1.5. */
    series_position?: number;
}

/* -------------------------------------------------------------------------
 * Candidates + grab (search recovery).
 * ----------------------------------------------------------------------- */

/** GET /api/v1/requests/{id}/candidates */
export interface CandidatesResponse {
    request_id: number;
    strictness: CandidateStrictness;
    query: string;
    items: Candidate[];
    total: number;
}

export interface Candidate {
    release_id: string;
    title: string;
    indexer: string | null;
    protocol: Protocol | null;
    size_bytes: number | null;
    age_seconds: number | null;
    /**
     * Newznab category tree — NESTED OBJECTS, not flat numbers. Each
     * category has an id, optional human name, and recursive subCategories.
     */
    categories: NewznabCategory[];
    download_url: string | null;
    info_url: string | null;
    seeders: number | null;
    leechers: number | null;
    score: number | null;
    matched_signals: string[];
    rejected_signals: string[];
    is_blocklisted: boolean;
}

export interface NewznabCategory {
    id: number;
    name?: string;
    subCategories: NewznabCategory[];
}

/** POST /api/v1/requests/{id}/grab */
export interface GrabBody {
    /** Confirmed `string` in OpenAPI request schema (despite the name). */
    release_id: string;
    download_url: string;
    title: string;
    protocol: Protocol;
    indexer?: string | null;
    size_bytes?: number | null;
}

/** POST /api/v1/requests/{id}/blocklist-release */
export interface BlocklistReleaseBody {
    release_id: number;
    reason?: string | null;
}

/* -------------------------------------------------------------------------
 * Blocklisted creators (admin).
 * ----------------------------------------------------------------------- */

export interface BlockedCreatorRow {
    id: number;
    canonical_name: string;
    /**
     * JSON-encoded `string[]` — frontend MUST `JSON.parse(aliases_json)`
     * before iterating. The grabber stores it as a string column and the
     * API returns it un-parsed.
     */
    aliases_json: string;
    hardcover_author_id: number | null;
    comicvine_person_id: number | null;
    tmdb_person_id: number | null;
    anilist_staff_id: number | null;
    reason: string | null;
    added_at: string;
    added_by: string | null;
}

export interface BlockedCreatorsPage {
    items: BlockedCreatorRow[];
    total: number;
}

/** POST /api/v1/blocklist/creators body. */
export interface CreatorCreateBody {
    canonical_name: string;
    aliases: string[];
    reason?: string | null;
    added_by?: string | null;
}

/* -------------------------------------------------------------------------
 * Health + admin sweep params.
 * ----------------------------------------------------------------------- */

export interface HealthResponse {
    status: string;
    version: string;
    in_flight: {
        search: boolean;
        enrich: string[];
    };
    clients: Record<string, ClientHealth>;
}

export interface ClientHealth {
    source: string;
    breaker_open: boolean;
    consecutive_failures: number;
    current_cooldown: number;
    requests_last_minute: number;
    requests_last_hour: number;
    minute_budget_remaining: number;
    hour_budget_remaining: number;
    aborted_keys_count: number;
}

export interface SweepParams {
    dry_run?: boolean;
    limit?: number;
}

export interface ReorganizeParams {
    dry_run?: boolean;
    limit?: number;
}

export interface RequestsListParams {
    kind?: RequestKind;
    status?: RequestStatus;
    following_id?: number;
    limit?: number;
    offset?: number;
}
