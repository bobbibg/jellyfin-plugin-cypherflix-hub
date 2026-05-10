/**
 * Ambient declarations for things Jellyfin's web bundle attaches to `window`
 * that we use from our plugin code. Strict-typed hand-rolled — Jellyfin doesn't
 * publish .d.ts files we can pull in.
 *
 * EVERY method below is verified against the deployed bundle on the NAS
 * (Jellyfin 10.11.8, jellyfin-apiclient 1.11.0) AND the unminified
 * `src/apiClient.js` recovered from the npm tarball's source map. See
 * `.recon/apiclient-verification.md` for citations.
 *
 * Do not add a new method here without first finding a `key:"<name>",value:`
 * entry in the bundle (or a `<name>(...)` declaration in the unminified source).
 * No assumed methods — they cause runtime undefined-is-not-a-function errors.
 */

export {};

declare global {
    /**
     * Jellyfin's API client — covers item lookup, library queries, auth.
     *
     * Source: jellyfin-apiclient 1.11.0 / src/apiClient.js (npm tarball,
     * see .recon/apiclient-verification.md for line-by-line citations).
     */
    interface JellyfinApiClient {
        /** Returns the bearer token if logged in, otherwise null. Synchronous. */
        accessToken(): string | null;

        /** Returns the current user GUID if logged in, otherwise null. Synchronous. */
        getCurrentUserId(): string | null;

        /**
         * Resolves the current user. `enableCache` (default true) controls
         * whether to use the localStorage-cached user when offline. Rejects
         * (with no value) if no current user id is set.
         */
        getCurrentUser(enableCache?: boolean): Promise<JellyfinUser>;

        /**
         * Hits `Users/{userId}/Items/{itemId}` if `userId` is truthy, otherwise
         * `Items/{itemId}` (server-wide). Throws synchronously on missing
         * `itemId`.
         */
        getItem(
            userId: string | null | undefined,
            itemId: string,
        ): Promise<JellyfinItem>;

        /**
         * Hits `Users/{userId}/Items?<options>` if `userId` is a string,
         * otherwise `Items?<options>` (server-wide). Note the parameter is
         * `options` (matching upstream source), not `query`.
         */
        getItems(
            userId: string | null | undefined,
            options?: Record<string, unknown>,
        ): Promise<JellyfinItemsResult>;

        /**
         * Pure pass-through to `this.fetch(request, includeAuthorization)`.
         * Param name is `request` per upstream source.
         */
        ajax<T = unknown>(
            request: JellyfinAjaxRequest,
            includeAuthorization?: boolean,
        ): Promise<T>;

        /**
         * Build an absolute URL. Throws on empty `name`. Throws if no
         * server address is configured AND no `serverAddress` override is
         * passed. The 3rd parameter is real and load-bearing.
         */
        getUrl(
            name: string,
            params?: Record<string, unknown> | null,
            serverAddress?: string,
        ): string;

        /**
         * Getter/setter overload on a single method. Always returns the
         * current address. Setting throws if `val` does not start with
         * `http`.
         */
        serverAddress(val?: string): string;

        /**
         * Throws synchronously on missing `id` or `configuration`. Body is
         * JSON-stringified internally — pass an object, not a string.
         * Endpoint returns 204 No Content; treat the resolved value as
         * void.
         */
        updatePluginConfiguration(id: string, configuration: unknown): Promise<unknown>;
    }

    /**
     * Shape passed to `ApiClient.ajax()`. Confirmed keys are quoted from
     * call sites in the bundle (e.g. `updatePluginConfiguration` uses
     * `type / url / data / contentType`); `headers` and `dataType` are
     * confirmed from the upstream `fetchWithFailover` decode logic.
     */
    interface JellyfinAjaxRequest {
        type: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
        url: string;
        data?: unknown;
        contentType?: string;
        dataType?: 'json' | 'text';
        headers?: Record<string, string>;
    }

    /**
     * Shape returned by `ApiClient.getItems()` and other paginated endpoints.
     * Confirmed against the Jellyfin server OpenAPI schema (`ItemsResult`).
     */
    interface JellyfinItemsResult {
        Items: JellyfinItem[];
        TotalRecordCount: number;
        StartIndex: number;
    }

    interface JellyfinUser {
        Id: string;
        Name: string;
        Policy?: { IsAdministrator?: boolean };
    }

    /**
     * Subset of Jellyfin's `BaseItemDto`. We only declare fields we read
     * — anything else is not assumed to exist. Add fields here as we hit
     * them, with a comment pointing at the call site.
     */
    interface JellyfinItem {
        Id: string;
        ServerId?: string;
        Name: string;
        /** 'Book' | 'AudioBook' | 'Movie' | 'Series' | 'Season' | 'Episode' | ... */
        Type: string;
        ProductionYear?: number;
        Overview?: string;
        ProviderIds?: Record<string, string>;
        People?: JellyfinPerson[];
        ImageTags?: Record<string, string>;
        BackdropImageTags?: string[];
        UserData?: { Played?: boolean; PlayCount?: number };
        Tags?: string[];
        Genres?: string[];
        AlbumArtist?: string;
    }

    interface JellyfinPerson {
        Id?: string;
        Name: string;
        /** 'Author' | 'Actor' | 'Director' | 'Writer' | ... */
        Type?: string;
        Role?: string;
        ProviderIds?: Record<string, string>;
    }

    /** KefinTweaks helper utilities — Jellyfin Tweaks plugin exposes these. */
    interface KefinTweaksUtils {
        onViewPage(handler: () => void, opts?: { pages?: string[] }): void;
    }

    interface Window {
        ApiClient?: JellyfinApiClient;
        ApiClientFactory?: { getApiClient(): JellyfinApiClient };
        KefinTweaksUtils?: KefinTweaksUtils;

        /** Used by bootstrap to enforce a single boot per page. */
        __cypherflixHubLoaded?: boolean;

        /** Jellyfin's webpack chunks array (read-only — we don't push to it). */
        webpackChunk?: unknown[];
    }
}
