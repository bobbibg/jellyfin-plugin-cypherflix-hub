/**
 * Helpers around Jellyfin's window.ApiClient.
 *
 * Centralises:
 *   - safe access (ApiClient may not be ready immediately on first paint)
 *   - the X-Emby-Token header construction
 *   - one-shot 401 retry on cold-start (token may not be bound yet)
 */

let _sessionReady: Promise<boolean> | null = null;

/**
 * Resolve when Jellyfin's session is fully bound — the access token exists
 * AND a real user can be fetched. We see the token before the session is
 * bound on cold-start, which makes the first call to a [Authorize]-gated
 * controller 401 unnecessarily. This gate avoids that.
 *
 * Caps at 5 seconds — past that the user is genuinely not logged in and
 * we should fail fast rather than hang.
 */
export function sessionReady(): Promise<boolean> {
    if (_sessionReady) return _sessionReady;
    _sessionReady = (async () => {
        const start = Date.now();
        while (Date.now() - start < 5000) {
            try {
                const u = await window.ApiClient?.getCurrentUser?.();
                if (u && u.Id) return true;
            } catch {
                /* retry */
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        return false;
    })();
    return _sessionReady;
}

/**
 * Build auth headers for a fetch to a Jellyfin-authenticated endpoint
 * (our own [Authorize]-gated reverse-proxy controller). Returns an empty
 * object if no token is available — caller's request will likely 401,
 * which is the right signal for the user to retry / re-login.
 */
export function authHeaders(): Record<string, string> {
    try {
        const tok = window.ApiClient?.accessToken();
        if (!tok) return {};
        return {
            'X-Emby-Token': tok,
            'Authorization': `MediaBrowser Token="${tok}"`,
        };
    } catch {
        return {};
    }
}

/** Returns the current user's Jellyfin Id, or null. */
export async function currentUserId(): Promise<string | null> {
    try {
        const u = await window.ApiClient?.getCurrentUser?.();
        return u?.Id ?? null;
    } catch {
        return null;
    }
}

/** Returns true if the current user has admin privileges. */
export async function isAdmin(): Promise<boolean> {
    try {
        const u = await window.ApiClient?.getCurrentUser?.();
        return Boolean(u?.Policy?.IsAdministrator);
    } catch {
        return false;
    }
}
