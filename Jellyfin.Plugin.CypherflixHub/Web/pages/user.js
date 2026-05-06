// Resolve the current Jellyfin user via window.ApiClient. Cached for the
// lifetime of this module load so repeated isAdmin checks don't refetch.

let _userPromise = null;

export function getCurrentUser() {
    if (_userPromise) return _userPromise;
    _userPromise = (async () => {
        const client = window.ApiClient;
        if (!client) return null;
        // ApiClient.getCurrentUser() returns a Promise resolving to the user
        // object (or null when nobody's logged in). It's the same call the
        // Jellyfin web client uses internally.
        try {
            return await client.getCurrentUser();
        } catch (_) {
            return null;
        }
    })();
    return _userPromise;
}

export async function isCurrentUserAdmin() {
    const u = await getCurrentUser();
    if (!u) return false;
    // Jellyfin's user payload exposes Policy.IsAdministrator.
    return !!(u.Policy && u.Policy.IsAdministrator);
}
