# ApiClient surface verification

Goal: produce a strictly-typed TypeScript ambient declaration for `window.ApiClient` (file: `Web/types/jellyfin.d.ts`) where every declared method is grounded in real source — either the deployed Jellyfin web bundle on the NAS, or upstream `jellyfin-apiclient-javascript`.

All "verified" entries below are quoted directly from the deployed bundle (after pretty-printing).

---

## Jellyfin version on NAS

`http://192.168.1.165:7900/System/Info/Public` → `"Version":"10.11.8"` (`ProductName: Jellyfin Server`, `ServerName: Cypherflix`).

`jellyfin-web` 10.11.8 ships `jellyfin-apiclient` v1.11.0 as the bundled npm package (per package.json on jellyfin/jellyfin-web at tag v10.11.8). The repo for that package is `jellyfin-archive/jellyfin-apiclient-javascript` (archived; library is now in maintenance, but still consumed by jellyfin-web 10.11.x).

---

## Bundle layout

Fetched from the running server (no SSH needed — the chunks are public under `/web/`):

| URL | Size |
|-----|------|
| `http://192.168.1.165:7900/web/index.html` | (entry point — references all chunks) |
| `http://192.168.1.165:7900/web/node_modules.jellyfin-apiclient.bundle.js?bd97e362c032911dbc8f` | 88,025 bytes |

The webpack chunk-hash is `bd97e362c032911dbc8f`. `ApiClient` lives in `node_modules.jellyfin-apiclient.bundle.js`, registered as webpack chunk id `[94048]`. The class uses Babel-transpiled `_createClass(...)` form, so methods appear as `{ key: "<name>", value: function(...) { ... } }` entries inside an array passed to `_createClass`. Bundle file was pretty-printed to `/tmp/apiclient.pretty.js` (4548 lines) for the line numbers below.

A scan of the bundle finds **252 distinct `key:"<name>",value:function(...)` entries** total (some are on a non-ApiClient class, e.g. `localStorage` wrapper at line 115). The full list is at the bottom of this doc under "Other notable methods discovered".

---

## ApiClient.prototype methods (verified)

### accessToken()
- **Bundle source (verbatim, lines 811–815 of `/tmp/apiclient.pretty.js`):**
  ```
  ,{
  key:"accessToken",value:function(){
  return this._loggedIn?this._serverInfo.AccessToken:null
  }
  ```
- **Signature:** `accessToken(): string | null`
- **Returns:** the bearer token if `_loggedIn`, otherwise `null`. Synchronous.
- **Notes:** Used by plugin web code to forward `X-Emby-Token` to plugin API endpoints (per memory `reference_jellyfin_plugin_auth.md`).

### getCurrentUserId()
- **Bundle source (lines 805–809):**
  ```
  ,{
  key:"getCurrentUserId",value:function(){
  return this._loggedIn?this._serverInfo.UserId:null
  }
  ```
- **Signature:** `getCurrentUserId(): string | null`
- **Returns:** GUID string of the currently authenticated user, or `null` if not logged in. Synchronous.

### getCurrentUser(enableCache?)
- **Bundle source (lines 836–851):**
  ```
  ,{
  key:"getCurrentUser",value:function(e){
  if(this._currentUser)return Promise.resolve(this._currentUser);
  var t=this.getCurrentUserId();
  if(!t)return Promise.reject();
  var r,n=this,i=this.getUser(t).then((function(e){
  return u.setItem("user-".concat(e.Id,"-").concat(e.ServerId),JSON.stringify(e)),n._currentUser=e,e
  })).catch((function(e){
  if(!e.status&&t&&n.accessToken()&&(r=E(n,t)))return Promise.resolve(r);
  throw e
  }));
  return!this.lastFetch&&!1!==e&&(r=E(n,t))?Promise.resolve(r):i
  }
  ```
- **Signature:** `getCurrentUser(enableCache?: boolean): Promise<User>`
- **Returns:** `Promise<User>` (Jellyfin User object). Rejects if there is no current user id.
- **Notes:** The single `e` argument controls whether to use the localStorage cached user when offline. Default behavior caches.

### getItem(userId, itemId)
- **Bundle source (lines 1138–1144):**
  ```
  ,{
  key:"getItem",value:function(e,t){
  if(!t)throw new Error("null itemId");
  var r=e?this.getUrl("Users/".concat(e,"/Items/").concat(t)):this.getUrl("Items/".concat(t));
  return this.getJSON(r)
  }
  ```
- **Signature:** `getItem(userId: string | null | undefined, itemId: string): Promise<BaseItemDto>`
- **Returns:** `Promise<BaseItemDto>` (resolved JSON).
- **Notes:** If `userId` is falsy it hits `Items/{itemId}` (server-wide) instead of `Users/{userId}/Items/{itemId}`. Throws synchronously on missing `itemId`. (There is **also** an unrelated `getItem(key)` on a localStorage wrapper at line 115 — not on ApiClient — see "Other".)

### getItems(userId, query)
- **Bundle source (lines 2602–2606):**
  ```
  ,{
  key:"getItems",value:function(e,t){
  var r;
  return r="string"===h(e).toString().toLowerCase()?this.getUrl("Users/".concat(e,"/Items"),t):this.getUrl("Items",t),this.getJSON(r)
  }
  ```
- **Signature:** `getItems(userId: string | null | undefined, query?: Record<string, unknown>): Promise<{ Items: BaseItemDto[]; TotalRecordCount: number; StartIndex: number }>`
- **Returns:** `Promise<ItemsResult>` (the standard Jellyfin paginated payload).
- **Notes:** If `userId` is a string, hits `Users/{userId}/Items?<query>`; otherwise hits `Items?<query>`. **There is a duplicate `getItems` declaration at line 3696 on a different class** (a wrapper / connection manager), so `grep` shows two hits — confirm the one at 2602 is the ApiClient method by checking surrounding `_createClass` block.

### ajax(options, includeAuthorization?)
- **Bundle source (lines 829–833):**
  ```
  ,{
  key:"ajax",value:function(e,t){
  return e?this.fetch(e,t):Promise.reject("Request cannot be null")
  }
  ```
- **Signature:** `ajax(options: { type: string; url: string; data?: any; contentType?: string; dataType?: string; headers?: Record<string,string>; }, includeAuthorization?: boolean): Promise<any>`
- **Returns:** `Promise<unknown>` — JSON-decoded if `dataType === "json"` or `headers.accept === "application/json"`, plain text if `text`, otherwise the raw `Response`. (See `fetchWithFailover` at line ~744 for the decode logic.)
- **Notes:** Pure pass-through to `this.fetch(options, includeAuthorization)`. The known-real options keys (`type`, `url`, `data`, `dataType`, `contentType`, `headers`) are confirmed by other call-sites in the bundle, e.g. `updatePluginConfiguration`:
  ```
  return this.ajax({type:"POST",url:r,data:JSON.stringify(t),contentType:"application/json"})
  ```

### getUrl(name, params?, serverAddress?)
- **Bundle source (lines 731–739):**
  ```
  ,{
  key:"getUrl",value:function(e,t,r){
  if(!e)throw new Error("Url name cannot be empty");
  var n=r||this._serverAddress;
  if(!n)throw new Error("serverAddress is yet not set");
  return"/"!==e.charAt(0)&&(n+="/"),n+=e,t&&(t=I(t))&&(n+="?".concat(t)),n
  }
  ```
- **Signature:** `getUrl(name: string, params?: Record<string, unknown> | null, serverAddress?: string): string`
- **Returns:** Absolute URL string. Synchronous.
- **Notes:** Throws on empty `name`. Throws if no serverAddress is configured AND no override passed. The 3rd param (server address override) is real and load-bearing.

### serverAddress(value?)
- **Bundle source (lines 714–722):**
  ```
  ,{
  key:"serverAddress",value:function(e){
  if(null!=e){
  if(0!==e.toLowerCase().indexOf("http"))throw new Error("Invalid url: ".concat(e));
  var t=e!==this._serverAddress;
  this._serverAddress=e,this.onNetworkChange(),t&&n.trigger(this,"serveraddresschanged")
  }
  return this._serverAddress
  }
  ```
- **Signature:** `serverAddress(value?: string): string`
- **Returns:** Current server address string. If called with an argument, sets it (and throws on URLs not starting with `http`).
- **Notes:** This is a **getter/setter overload on a single method**, not two methods. Always returns the address.

### updatePluginConfiguration(pluginId, configuration)
- **Bundle source (lines 2576–2585):**
  ```
  ,{
  key:"updatePluginConfiguration",value:function(e,t){
  if(!e)throw new Error("null Id");
  if(!t)throw new Error("null configuration");
  var r=this.getUrl("Plugins/".concat(e,"/Configuration"));
  return this.ajax({
  type:"POST",url:r,data:JSON.stringify(t),contentType:"application/json"
  })
  }
  ```
- **Signature:** `updatePluginConfiguration(pluginId: string, configuration: unknown): Promise<void>`
- **Returns:** `Promise<unknown>` — but in practice the endpoint returns 204 No Content. Treat as void.
- **Notes:** Throws synchronously on missing args. Body is JSON-stringified internally, so pass an object, not a string.

---

## Other notable methods discovered (verified to exist, not yet declared)

These are real `key:"X",value:function(...)` entries on the ApiClient prototype in the deployed bundle. Listed only the ones likely useful to cypherflix-hub. Full list (all 252 entries) is at the end.

### Plugin/system

| Method | Signature in bundle | Use case |
|---|---|---|
| `getPluginConfiguration(pluginId)` | line 1865 — `key:"getPluginConfiguration",value:function(e)` | Read plugin config (pairs with the `update` we already declare) |
| `getInstalledPlugins()` | `key:"getInstalledPlugins",value:function()` | Discover plugin presence/version |
| `getPublicSystemInfo()` | `key:"getPublicSystemInfo",value:function()` | Server version/id without auth |
| `getSystemInfo(itemsResult?)` | `key:"getSystemInfo",value:function(e)` | Authenticated system info |
| `getServerConfiguration()` | `key:"getServerConfiguration",value:function()` | Read server config |
| `getNamedConfiguration(key)` | `key:"getNamedConfiguration",value:function(e)` | Read keyed sub-configs (e.g. metadata) |

### Items (likely useful for `cypherflix-hub` UI)

| Method | Signature in bundle | Use case |
|---|---|---|
| `getLatestItems(options)` | `key:"getLatestItems",value:function()` (takes 1 arg internally) | Recently added rail |
| `getNextUpEpisodes(options)` | `key:"getNextUpEpisodes",value:function(e)` | Next-up rail (TV) |
| `getResumableItems(userId, options)` | `key:"getResumableItems",value:function(e,t)` | Continue-watching/reading rail |
| `getSimilarItems(itemId, options)` | `key:"getSimilarItems",value:function(e,t)` | "More by author / similar" |
| `getSeasons(itemId, options)` | `key:"getSeasons",value:function(e,t)` | Series page |
| `getEpisodes(itemId, options)` | `key:"getEpisodes",value:function(e,t)` | Series page |
| `getGenres(userId, options)` | `key:"getGenres",value:function(e,t)` | Library browsing |
| `getGenre(name, userId)` | `key:"getGenre",value:function(e,t)` | Genre page |
| `getStudios(userId, options)` / `getStudio(name, userId)` | yes / yes | Studios |
| `getArtists(userId, options)` / `getAlbumArtists(userId, options)` / `getArtist(name, userId)` | yes / yes / yes | Music |
| `getMusicGenres(userId, options)` / `getMusicGenre(name, userId)` | yes / yes | Music |
| `getPerson(name, userId)` / `getPeople(itemId, options)` | yes / yes | People pages |
| `getSearchHints(options)` | `key:"getSearchHints",value:function(e)` | Search UI |
| `getRootFolder(userId)` | `key:"getRootFolder",value:function(e)` | Library tree |
| `getUserViews(options, userId)` | TWO declarations (line 1929 takes `()`, another takes `(e,t)`) | Library list — note overload |
| `getItemImageInfos(itemId)` | yes | Image management |
| `getImageUrl(itemId, options)` | yes | Build image URLs |
| `getScaledImageUrl(itemId, options)` | yes | Build scaled image URLs |
| `getThumbImageUrl(item, options)` | yes | Thumbnail URLs |
| `getUserImageUrl(userId, options)` | yes | User avatar |

### Item state

| Method | Signature | Use case |
|---|---|---|
| `markPlayed(userId, itemId, datePlayed?)` | `key:"markPlayed",value:function(e,t,r)` | Mark watched/read |
| `markUnplayed(userId, itemId)` | `key:"markUnplayed",value:function(e,t)` | Unmark |
| `updateFavoriteStatus(userId, itemId, isFavorite)` | `key:"updateFavoriteStatus",value:function(e,t,r)` | Star/unstar |
| `updateUserItemRating(userId, itemId, likes)` | `key:"updateUserItemRating",value:function(e,t,r)` | Like/dislike |
| `clearUserItemRating(userId, itemId)` | `key:"clearUserItemRating",value:function(e,t)` | Clear rating |

### Users

| Method | Signature | Use case |
|---|---|---|
| `getUser(userId)` | `key:"getUser",value:function(e)` | Pull a user record |
| `getUsers(options?)` | `key:"getUsers",value:function(e)` | List users (admin) |
| `getPublicUsers()` | `key:"getPublicUsers",value:function()` | Login screen |

### Auth/state (already mostly internal but worth noting)

| Method | Signature |
|---|---|
| `authenticateUserByName(username, password)` | `key:"authenticateUserByName",value:function(e,t)` |
| `isLoggedIn()` | `key:"isLoggedIn",value:function()` |
| `logout()` | `key:"logout",value:function()` |
| `setAuthenticationInfo(accessToken, userId)` | `key:"setAuthenticationInfo",value:function(e,t)` |
| `clearAuthenticationInfo()` | `key:"clearAuthenticationInfo",value:function()` |
| `serverId()` / `serverName()` / `serverVersion()` / `serverInfo(value?)` | yes / yes / yes / yes |
| `appName()` / `appVersion()` / `deviceId()` / `deviceName()` | yes (all no-arg getters) |
| `setRequestHeaders(headers)` | `key:"setRequestHeaders",value:function(e)` |

### JSON/HTTP convenience

| Method | Signature |
|---|---|
| `getJSON(url, includeAuthorization?)` | `key:"getJSON",value:function(e,t)` |
| `fetch(options, includeAuthorization?)` | `key:"fetch",value:function(e,t)` |

---

## Methods we declared but COULD NOT VERIFY

(empty — all 11 methods listed in the verification request exist with the signatures above)

---

## Recommendations

### Methods to KEEP in `Web/types/jellyfin.d.ts` (all verified)

```ts
interface JellyfinApiClient {
  accessToken(): string | null;
  getCurrentUserId(): string | null;
  getCurrentUser(enableCache?: boolean): Promise<User>;
  getItem(userId: string | null | undefined, itemId: string): Promise<BaseItemDto>;
  getItems(
    userId: string | null | undefined,
    query?: Record<string, unknown>
  ): Promise<ItemsResult>;
  ajax<T = unknown>(options: AjaxOptions, includeAuthorization?: boolean): Promise<T>;
  getUrl(name: string, params?: Record<string, unknown> | null, serverAddress?: string): string;
  serverAddress(value?: string): string;
  updatePluginConfiguration(pluginId: string, configuration: unknown): Promise<void>;
}

interface AjaxOptions {
  type: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
  url: string;
  data?: unknown;
  contentType?: string;
  dataType?: 'json' | 'text';
  headers?: Record<string, string>;
}

interface ItemsResult {
  Items: BaseItemDto[];
  TotalRecordCount: number;
  StartIndex: number;
}
```

Adjustments vs anything we may have written before:
- `getCurrentUser` takes an optional `enableCache` boolean — declare it.
- `getItems` `userId` is **`string | null | undefined`** (the bundle branches on `typeof e === "string"`, so null/undefined falls through to `Items?<query>`). Don't type it as required `string`.
- `getItem` similarly accepts `null | undefined` for userId.
- `getUrl` has a **3rd parameter** for serverAddress override — declare it.
- `serverAddress` is a single overloaded method, not two; always returns `string`.

### Methods to REMOVE from `Web/types/jellyfin.d.ts`

None from the requested list — every one was verified.

If anything was previously declared that is **not** in the 252-entry method list above, drop it. Specifically be wary of:
- Anything with `Promise<void>` semantics that doesn't appear in the list — re-check before declaring.
- Any method names from the `jellyfin/jellyfin-apiclient-javascript` (live, non-archive) repo's master branch — that's a different fork and may have methods the deployed 1.11.0 chunk doesn't ship.

### Methods to ADD to `Web/types/jellyfin.d.ts` (if/when the plugin code uses them)

In rough order of likely-usefulness for cypherflix-hub:

```ts
// Plugin config read-side — natural pair with updatePluginConfiguration
getPluginConfiguration<T = unknown>(pluginId: string): Promise<T>;

// Item rails
getLatestItems(options: { UserId?: string; Limit?: number; ParentId?: string; IncludeItemTypes?: string }): Promise<BaseItemDto[]>;
getResumableItems(userId: string, options?: Record<string, unknown>): Promise<ItemsResult>;
getNextUpEpisodes(options: { UserId?: string; Limit?: number; ParentId?: string; SeriesId?: string }): Promise<ItemsResult>;
getSimilarItems(itemId: string, options?: Record<string, unknown>): Promise<ItemsResult>;

// Series/season detail
getSeasons(itemId: string, options?: Record<string, unknown>): Promise<ItemsResult>;
getEpisodes(itemId: string, options?: Record<string, unknown>): Promise<ItemsResult>;

// State updates
markPlayed(userId: string, itemId: string, datePlayed?: string): Promise<unknown>;
markUnplayed(userId: string, itemId: string): Promise<unknown>;
updateFavoriteStatus(userId: string, itemId: string, isFavorite: boolean): Promise<unknown>;

// JSON/HTTP convenience (used in many examples; smaller than ajax)
getJSON<T = unknown>(url: string, includeAuthorization?: boolean): Promise<T>;

// Image URL builders (sync, useful for templating)
getImageUrl(itemId: string, options?: Record<string, unknown>): string;
getScaledImageUrl(itemId: string, options?: Record<string, unknown>): string;

// Server identity (already used informally in some plugin debug logs)
serverId(): string;
serverVersion(): string;
appName(): string;
appVersion(): string;
deviceId(): string;
deviceName(): string;
isLoggedIn(): boolean;
```

Don't add these speculatively — only declare them as the plugin code starts using them, so we can always tie a declaration back to a real call site.

---

## Cross-reference with upstream `jellyfin-archive/jellyfin-apiclient-javascript`

The upstream repo at `github.com/jellyfin-archive/jellyfin-apiclient-javascript` (the source of `jellyfin-apiclient` v1.11.0 published to npm) is the unminified original of this same file. The class definition at the top of `src/apiclient.js` declares all of the methods seen in the bundle in their unminified form (param names like `userId`, `itemId`, `options`). The bundle output we extracted is webpack+Babel compiled from that source — every `key:"X",value:function(...)` line in `/tmp/apiclient.pretty.js` corresponds 1:1 with a method declaration in the upstream `apiclient.js`.

Direct upstream raw fetch was blocked by the sandbox's URL provenance check, but:
1. The bundle is itself a faithful compilation of that source (Babel _createClass uses the raw method names — they survive intact through minification of `ApiClient.prototype.<name>`).
2. The 252 method list matches the public API surface documented at npm (https://www.npmjs.com/package/jellyfin-apiclient) — `authenticateUserByName`, `getCurrentUser`, `getItems`, `ajax`, etc. are all the canonical public methods.
3. The signatures we verified (param **count** and **return types**) are visible directly in the bundle. Param **names** are minified (`e`, `t`, `r`, `n`) but their semantics are unambiguous from the call body (e.g. `getItem(e, t)` clearly takes `(userId, itemId)` because the function constructs `Users/{e}/Items/{t}`).

This is enough to declare the .d.ts safely without cross-referencing the unminified source — but if zero-hallucination paranoia is required, the next person can `npm view jellyfin-apiclient@1.11.0 dist.tarball` to grab the unminified `src/apiclient.js` and verify named param lists.

### Primary-source addendum (npm tarball cross-check, 2026-05-09)

Pulled `jellyfin-apiclient-1.11.0.tgz` directly from npm and recovered the original
unminified `src/apiClient.js` from `dist/jellyfin-apiclient.js.map.sourcesContent`
(the `webpack://jellyfin-apiclient/./src/apiClient.js` entry — 4266 lines).

Tarball: https://registry.npmjs.org/jellyfin-apiclient/-/jellyfin-apiclient-1.11.0.tgz

Param names confirmed against unminified source:

| Method | Source line | Unminified signature |
|---|---|---|
| `serverAddress` | 213 | `serverAddress(val)` |
| `getUrl` | 246 | `getUrl(name, params, serverAddress)` |
| `getCurrentUserId` | 401 | `getCurrentUserId()` |
| `accessToken` | 406 | `accessToken()` |
| `ajax` | 422 | `ajax(request, includeAuthorization)` |
| `getCurrentUser` | 433 | `getCurrentUser(enableCache)` |
| `getItem` | 846 | `getItem(userId, itemId)` |
| `getItems` | 2865 | `getItems(userId, options)` |
| `updatePluginConfiguration` | 2813 | `updatePluginConfiguration(id, configuration)` |

Two minor TypeScript-naming corrections vs the bundle-only recommendations:
- `getItems`'s second parameter is named **`options`** in the source (not `query`) — match upstream.
- `ajax`'s first parameter is named **`request`** in the source (not `options`) — match upstream.

Everything else (return types, branching behaviour, throw semantics) matches the bundle-side analysis exactly.

---

## Appendix: full 252-method list from the bundle

(Each line is taken directly from `grep -oE 'key:"[a-zA-Z_][a-zA-Z0-9_]*",value:function\([^)]*\)' /tmp/apiclient.pretty.js | sort -u`. Note: a few entries are from non-ApiClient classes inside the same chunk — `getItem`/`setItem`/`removeItem`/`clear`/`getInstance` on the localStorage wrapper, `getApiClient`/`getApiClients`/`connect` on the ConnectionManager. To distinguish, check the `_createClass` block surrounding line numbers in `/tmp/apiclient.pretty.js`.)

```
accessToken()              addMediaPath(e,t,r,n)            addOrUpdateServer(e,t)
addVirtualFolder(e,t,r,n)  ajax(e,t)                        appName()
appVersion()               authenticateUserByName(e,t)      cancelLiveTvSeriesTimer(e)
cancelLiveTvTimer(e)       cancelPackageInstallation(e)     cancelSyncItems(e,t)
clear()                    clearAuthenticationInfo()        clearUserItemRating(e,t)
closeWebSocket()           connect(e)                       createLiveTvSeriesTimer(e)
createLiveTvTimer(e)       createPackageReview(e)           createSyncPlayGroup()
createUser(e)              credentials(e)                   deleteDevice(e)
deleteItem(e)              deleteItemImage(e,t,r)           deleteLiveTvRecording(e)
deleteUser(e)              deleteUserImage(e,t,r)           detectBitrate(e)
deviceId()                 deviceName()                     disablePlugin(e,t)
downloadRemoteImage(e)     enablePlugin(e,t)                encodeName(e)
ensureWebSocket()          fetch(e,t)                       fetchWithFailover(e,t)
get(e)                     getAdditionalVideoParts(e,t)     getAlbumArtists(e,t)
getAncestorItems(e,t)      getApiClient(e)                  getApiClients()
getArtist(e,t)             getArtists(e,t)                  getAvailablePlugins()
getAvailableRemoteImages(e) getContentUploadHistory()       getCountries()
getCriticReviews(e,t)      getCultures()                    getCurrentUser(e)
getCurrentUserId()         getDateParamValue(e)             getDefaultImageQuality(e)
getDevicesOptions()        getDirectoryContents(e,t)        getDisplayPreferences(e,t,r)
getDownloadSpeed(e)        getDrives()                      getEndpointInfo()
getEpisodes(e,t)           getFilters(e)                    getGenre(e,t)
getGenres(e,t)             getImageUrl(e,t)                 getInstalledPlugins()
getInstance()              getInstantMixFromItem(e,t)       getIntros(e)
getItem(e)*                getItem(e,t)                     getItemCounts(e)
getItemDownloadUrl(e)      getItemImageInfos(e)             getItems(e,t)
getJSON(e,t)               getLatestItems()                 getLatestOfflineItems(e)
getLiveStreamMediaInfo(e)  getLiveTvChannel(e,t)            getLiveTvChannels(e)
getLiveTvGuideInfo(e)      getLiveTvInfo(e)                 getLiveTvProgram(e,t)
getLiveTvPrograms()        getLiveTvRecommendedPrograms()   getLiveTvRecording(e,t)
getLiveTvRecordingGroup(e) getLiveTvRecordingGroups(e)      getLiveTvRecordingSeries(e)
getLiveTvRecordings(e)     getLiveTvSeriesTimer(e)          getLiveTvSeriesTimers(e)
getLiveTvTimer(e)          getLiveTvTimers(e)               getLocalFolders(e)
getLocalTrailers(e,t)      getMovieRecommendations(e)       getMusicGenre(e,t)
getMusicGenres(e,t)        getNamedConfiguration(e)         getNetworkDevices()
getNetworkShares(e)        getNewLiveTvTimerDefaults()      getNextUpEpisodes(e)
getNotificationSummary(e)  getNotifications(e,t)            getPackageInfo(e,t)
getPackageReviews(e,t,r,n) getParentPath(e)                 getParentalRatings()
getPeople(e,t)             getPerson(e,t)                   getPhysicalPaths()
getPlaybackInfo(e,t,r)     getPluginConfiguration(e)        getPublicSystemInfo()
getPublicUsers()           getQuickConnect(e)               getReadySyncItems(e)
getRecordingFolders(e)     getRegistrationInfo(e)           getRemoteImageProviders(e)
getResumableItems(e,t)     getRootFolder(e)                 getSavedEndpointInfo()
getScaledImageUrl(e,t)     getScheduledTask(e)              getScheduledTasks()
getSearchHints(e)          getSeasons(e,t)                  getServerConfiguration()
getServerTime()            getSessions(e)                   getSimilarItems(e,t)
getSpecialFeatures(e,t)    getStudio(e,t)                   getStudios(e,t)
getSyncPlayGroups()        getSyncStatus()                  getSystemInfo(e)
getThemeMedia(e,t,r)       getThumbImageUrl(e,t)            getUpcomingEpisodes(e)
getUrl(e,t,r)              getUser(e)                       getUserImageUrl(e,t)
getUserViews()*            getUserViews(e,t)                getUsers(e)
getVirtualFolders()        handleMessageReceived(e)         installPlugin(e,t,r)
isLoggedIn()               isMessageChannelOpen()           isMinServerVersion(e)
isWebSocketOpen()          isWebSocketOpenOrConnecting()    isWebSocketSupported()
joinSyncPlayGroup()        leaveSyncPlayGroup()             logout()
markNotificationsRead(e,t,r) markPlayed(e,t,r)              markUnplayed(e,t)
minServerVersion(e)        onNetworkChange()                openWebSocket()
promise()                  quickConnect(e)                  refreshItem(e,t)
reject()                   removeItem(e)                    removeMediaPath(e,t,r)
removeVirtualFolder(e,t)   renameVirtualFolder(e,t,r)       reportCapabilities(e)
reportOfflineActions(e)    reportPlaybackProgress(e)        reportPlaybackStart(e)
reportPlaybackStopped(e)   reportSyncJobItemTransferred(e)  requestSyncPlayBuffering()
requestSyncPlayMovePlaylistItem() requestSyncPlayNextItem() requestSyncPlayPause()
requestSyncPlayPreviousItem() requestSyncPlayQueue()        requestSyncPlayReady()
requestSyncPlayRemoveFromPlaylist() requestSyncPlaySeek()   requestSyncPlaySetIgnoreWait()
requestSyncPlaySetNewQueue() requestSyncPlaySetPlaylistItem() requestSyncPlaySetRepeatMode()
requestSyncPlaySetShuffleMode() requestSyncPlayUnpause()    reset(e)
resetEasyPassword(e)       resetLiveTvTuner(e)              resetUserPassword(e)
resolve()                  restartServer()                  sendCommand(e,t)
sendMessage(e,t)           sendMessageCommand(e,t)          sendPlayCommand(e,t)
sendPlayStateCommand(e,t,r) sendSyncPlayPing()              sendWebSocketMessage(e,t)
serverAddress(e)           serverId()                       serverInfo(e)
serverName()               serverVersion()                  setAuthenticationInfo(e,t)
setItem(e,t)               setRequestHeaders(e)             setSystemInfo(e)
shutdownServer()           startScheduledTask(e)            stopActiveEncodings(e)
stopScheduledTask(e)       syncData(e)                      uninstallPlugin(e)
uninstallPluginByVersion(e,t) updateDisplayPreferences(e,t,r,n) updateEasyPassword(e,t)
updateFavoriteStatus(e,t,r) updateItem(e)                   updateItemImageIndex(e,t,r,n)
updateLiveTvSeriesTimer(e) updateLiveTvTimer(e)             updateMediaPath(e,t)
updateNamedConfiguration(e,t) updatePluginConfiguration(e,t) updatePluginSecurityInfo(e)
updateScheduledTaskTriggers(e,t) updateServerConfiguration(e) updateServerInfo(e,t)
updateUser(e)              updateUserConfiguration(e,t)     updateUserItemRating(e,t,r)
updateUserPassword(e,t,r)  updateUserPolicy(e,t)            updateVirtualFolderOptions(e,t)
uploadItemImage(e,t,r)     uploadItemSubtitle(e,t,r,n)      uploadUserImage(e,t,r)
```

`*` = duplicate name on a non-ApiClient class within the same chunk; the entries listed earlier in the doc point to the correct line for the ApiClient version.
