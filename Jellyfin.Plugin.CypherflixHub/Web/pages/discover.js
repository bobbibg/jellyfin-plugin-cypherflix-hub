/*
 * Cypherflix Hub - Discover page module (UI-003).
 *
 * Loaded by Web/bootstrap.js via:
 *   const fn = new Function("ApiClient", "Dashboard", code);
 *   const mod = fn(window.ApiClient, window.Dashboard);
 *
 * That construction makes `code` the body of an anonymous function whose
 * args are ApiClient + Dashboard, so a top-level `return` at the bottom of
 * this file is the value `fn` returns. Don't refactor this into IIFE shape;
 * the caller relies on the function-body return semantics.
 *
 * Markup uses Jellyfin's native item-card classes (`cardBox`, `card`,
 * `cardScalable`, `cardPadder`, `cardImageContainer`, `cardText`,
 * `cardFooter`, `itemsContainer`). See JELLYFIN-INTEGRATION.md §4.1.1 for
 * source citations.
 */
"use strict";

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

// Page-size matches the API default; bootstrap.js does no caching of result
// pages so 24 keeps the first paint snappy without too much re-fetch on
// scroll.
var PAGE_SIZE = 24;

// Search input is debounced so we don't hammer the back-end on every
// keystroke. 250ms feels live without spamming Meilisearch.
var SEARCH_DEBOUNCE_MS = 250;

// Kick a "load next page" fetch when the viewport bottom is within this many
// pixels of the document bottom. 200px is enough to feel preloaded on a
// laptop trackpad without firing prematurely on small windows.
var SCROLL_TRIGGER_PX = 200;

// Filter chips. The "All" chip is exclusive of the rest (clicking it clears
// the others); other chips multi-select. The MediaType identifiers MUST
// match the C# enum names in Core/MediaType.cs verbatim, since SearchController
// parses the CSV via `Enum.TryParse`.
var FILTERS = [
    { id: "all",       label: "All",        type: null },
    { id: "movies",    label: "Movies",     type: "Movie" },
    { id: "tv",        label: "TV",         type: "TvShow" },
    { id: "books",     label: "Books",      type: "Book" },
    { id: "comics",    label: "Comics",     type: "Comic" },
    { id: "audiobooks", label: "Audiobooks", type: "Audiobook" },
    { id: "music",     label: "Music",      type: "Music" }
];

// Friendly labels for the MediaType badge on each card. Keep keys aligned
// with Core/MediaType.cs so a server-only update doesn't break the UI.
var MEDIA_TYPE_LABELS = {
    Movie: "Movie",
    TvShow: "TV",
    Book: "Book",
    Comic: "Comic",
    Audiobook: "Audiobook",
    Music: "Music",
    Other: "Other"
};

// -----------------------------------------------------------------------
// Page-scoped CSS — appended once on first render. Kept self-contained so
// UI-004/005 don't have to coordinate edits to shared styles.css.
// All custom colours go through --jf-palette-* with sensible fallbacks
// (see JELLYFIN-INTEGRATION.md §5).
// -----------------------------------------------------------------------

var STYLE_TAG_ID = "cypherflix-discover-styles";

var STYLES = [
    ".cypherflix-discover{display:flex;flex-direction:column;gap:1.25em;}",
    ".cypherflix-discover__searchbar{display:flex;}",
    ".cypherflix-discover__searchInput{flex:1;padding:0.65em 0.9em;font-size:1.05em;border-radius:4px;border:1px solid var(--jf-palette-divider,rgba(255,255,255,0.12));background:var(--jf-palette-background-paper,#202020);color:var(--jf-palette-text-primary,#fff);outline:none;}",
    ".cypherflix-discover__searchInput:focus{border-color:var(--jf-palette-primary-main,#00a4dc);}",
    ".cypherflix-discover__filters{display:flex;flex-wrap:wrap;gap:0.5em;}",
    ".cypherflix-discover__chip{padding:0.4em 0.95em;border-radius:999px;border:1px solid var(--jf-palette-divider,rgba(255,255,255,0.12));background:transparent;color:var(--jf-palette-text-secondary,rgba(255,255,255,0.7));cursor:pointer;font-size:0.9em;}",
    ".cypherflix-discover__chip:hover{background:var(--jf-palette-action-hover,rgba(255,255,255,0.08));}",
    ".cypherflix-discover__chip.is-active{background:var(--jf-palette-primary-main,#00a4dc);color:var(--jf-palette-primary-contrastText,rgba(0,0,0,0.87));border-color:var(--jf-palette-primary-main,#00a4dc);}",
    ".cypherflix-discover__grid.itemsContainer{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1em;}",
    ".cypherflix-discover .cardBox{margin:0;}",
    ".cypherflix-discover .cardImageContainer{position:relative;width:100%;aspect-ratio:2/3;background:var(--jf-palette-background-paper,#202020);border-radius:4px;overflow:hidden;display:flex;align-items:center;justify-content:center;}",
    ".cypherflix-discover .cardImageContainer img{width:100%;height:100%;object-fit:cover;display:block;}",
    ".cypherflix-discover__posterFallback{font-size:2.2em;color:var(--jf-palette-text-secondary,rgba(255,255,255,0.7));font-weight:600;}",
    ".cypherflix-discover .cardText{font-size:0.95em;font-weight:500;color:var(--jf-palette-text-primary,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:0.5em;}",
    ".cypherflix-discover__meta{display:flex;align-items:center;gap:0.4em;font-size:0.8em;color:var(--jf-palette-text-secondary,rgba(255,255,255,0.7));margin-top:0.15em;}",
    ".cypherflix-discover__badge{padding:0.1em 0.5em;border-radius:3px;background:var(--jf-palette-action-focus,rgba(255,255,255,0.12));font-size:0.85em;}",
    ".cypherflix-discover__action{margin-top:0.5em;display:flex;}",
    ".cypherflix-discover__btn{flex:1;padding:0.5em 0.75em;border-radius:4px;border:none;cursor:pointer;font-size:0.85em;text-align:center;text-decoration:none;display:inline-block;}",
    ".cypherflix-discover__btn--play{background:var(--jf-palette-primary-main,#00a4dc);color:var(--jf-palette-primary-contrastText,rgba(0,0,0,0.87));}",
    ".cypherflix-discover__btn--request{background:var(--jf-palette-background-paper,#202020);color:var(--jf-palette-text-primary,#fff);border:1px solid var(--jf-palette-divider,rgba(255,255,255,0.12));}",
    ".cypherflix-discover__btn--request:hover{background:var(--jf-palette-action-hover,rgba(255,255,255,0.08));}",
    ".cypherflix-discover__btn[disabled]{opacity:0.65;cursor:default;}",
    ".cypherflix-discover__pending{flex:1;padding:0.5em 0.75em;border-radius:4px;background:var(--jf-palette-action-focus,rgba(255,255,255,0.12));color:var(--jf-palette-text-secondary,rgba(255,255,255,0.7));font-size:0.85em;text-align:center;}",
    ".cypherflix-discover__empty{padding:3em 1em;text-align:center;color:var(--jf-palette-text-secondary,rgba(255,255,255,0.7));font-size:1.05em;}",
    ".cypherflix-discover__loading{padding:1em;text-align:center;color:var(--jf-palette-text-secondary,rgba(255,255,255,0.7));}"
].join("");

function ensureStyles() {
    if (document.getElementById(STYLE_TAG_ID)) return;
    var tag = document.createElement("style");
    tag.id = STYLE_TAG_ID;
    tag.textContent = STYLES;
    document.head.appendChild(tag);
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

// Replace HTML special chars before we drop user data into innerHTML.
function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Map a hit + the user's currently active filter set into a friendly badge
// label. Falls back to the raw enum name if MediaType is something we
// haven't seen.
function badgeLabel(mediaType) {
    return MEDIA_TYPE_LABELS[mediaType] || mediaType || "";
}

// Detail-page deep-link for an in-library item. Mirrors Jellyfin's own
// hash routing: `/web/index.html#/details?id={JellyfinItemId}`.
function detailsUrl(jellyfinItemId) {
    return "/web/index.html#/details?id=" + encodeURIComponent(jellyfinItemId);
}

// Build the action area for a card based on its state. Returns an HTML
// string. The card-wrapping wireUp logic uses data-role attrs on these
// elements to find them after innerHTML rebuild.
function actionMarkup(result) {
    if (result.InLibrary && result.JellyfinItemId) {
        return ""
            + "<a class=\"cypherflix-discover__btn cypherflix-discover__btn--play\" "
            + "href=\"" + esc(detailsUrl(result.JellyfinItemId)) + "\" "
            + "data-role=\"play\">Play</a>";
    }
    if (result.RequestPending) {
        return ""
            + "<div class=\"cypherflix-discover__pending\" data-role=\"pending\">Pending</div>";
    }
    // Per ARCHITECTURE.md §8.2 + the task spec we always offer Request when
    // the item is neither in-library nor already pending. The back-end
    // resolves whether the provider actually supports Request and returns
    // 400 with a friendly message if not — we surface that via Dashboard.alert.
    return ""
        + "<button type=\"button\" "
        + "class=\"cypherflix-discover__btn cypherflix-discover__btn--request\" "
        + "data-role=\"request\">Request</button>";
}

// Markup for one result card. Uses Jellyfin's native cardBox/card/cardScalable
// stack so visual style inherits whatever theme the user is on. We deliberately
// omit `cardOverlayContainer` because we don't yet ship a hover overlay —
// adding it later is a pure CSS change inside the existing markup.
function cardMarkup(result, index) {
    var year = result.Year ? String(result.Year) : "";
    var badge = badgeLabel(result.MediaType);
    var meta = [year, badge].filter(function (x) { return x; }).join(" • ");

    var posterMarkup;
    if (result.PosterUrl) {
        posterMarkup = ""
            + "<img loading=\"lazy\" alt=\"\" "
            + "src=\"" + esc(result.PosterUrl) + "\" "
            + "onerror=\"this.style.display='none';"
            + "this.parentNode.classList.add('cypherflix-discover__posterFallbackContainer');\" />";
    } else {
        // No poster URL. Show a single-character monogram so the grid keeps
        // a uniform aspect ratio.
        var initial = (result.Title || "?").trim().charAt(0).toUpperCase();
        posterMarkup = "<div class=\"cypherflix-discover__posterFallback\">"
            + esc(initial) + "</div>";
    }

    return ""
        + "<div class=\"cardBox\" data-result-index=\"" + index + "\">"
        + "<div class=\"card portraitCard\">"
        + "<div class=\"cardScalable\">"
        + "<div class=\"cardPadder cardPadder-portrait\"></div>"
        + "<div class=\"cardImageContainer\">"
        + posterMarkup
        + "</div>"
        + "</div>"
        + "<div class=\"cardText\" title=\"" + esc(result.Title || "") + "\">"
        + esc(result.Title || "")
        + "</div>"
        + (meta ? "<div class=\"cypherflix-discover__meta\">"
            + "<span class=\"cypherflix-discover__badge\">" + esc(badge) + "</span>"
            + (year ? "<span>" + esc(year) + "</span>" : "")
            + "</div>" : "")
        + "<div class=\"cypherflix-discover__action\">"
        + actionMarkup(result)
        + "</div>"
        + "</div>"
        + "</div>";
}

// -----------------------------------------------------------------------
// Top-level template — built once on render(); inner content (chips, grid)
// is filled in by wireUp(). innerHTML uses static literals only so we
// don't need to escape anything here.
// -----------------------------------------------------------------------

var TEMPLATE = ""
    + "<div class=\"cypherflix-discover cypherflix-page\">"
    + "<div class=\"cypherflix-discover__searchbar\">"
    + "<input type=\"search\" "
    + "class=\"cypherflix-discover__searchInput\" "
    + "data-role=\"search-input\" "
    + "autocomplete=\"off\" "
    + "spellcheck=\"false\" "
    + "placeholder=\"Search across your stack...\" />"
    + "</div>"
    + "<div class=\"cypherflix-discover__filters\" data-role=\"filters\"></div>"
    + "<div class=\"cypherflix-discover__grid itemsContainer\" data-role=\"grid\"></div>"
    + "<div class=\"cypherflix-discover__loading\" data-role=\"loading\" hidden>Loading...</div>"
    + "<div class=\"cypherflix-discover__empty\" data-role=\"empty\">"
    + "Type to search across your stack."
    + "</div>"
    + "</div>";

// -----------------------------------------------------------------------
// render — entry point invoked by bootstrap.js. Wires up state machine.
// -----------------------------------------------------------------------

function render(container) {
    ensureStyles();
    container.innerHTML = TEMPLATE;
    wireUp(container);
}

function wireUp(container) {
    // Snapshot DOM nodes we mutate often.
    var input = container.querySelector("[data-role='search-input']");
    var filtersHost = container.querySelector("[data-role='filters']");
    var grid = container.querySelector("[data-role='grid']");
    var loading = container.querySelector("[data-role='loading']");
    var empty = container.querySelector("[data-role='empty']");

    // ---- Filter chips ----
    // "All" chip starts active; clicking another deactivates "All". Clicking
    // the only active non-All chip falls back to "All" so the user can't end
    // up in a "no filters at all" dead state.
    var activeFilters = new Set(["all"]);

    var chipNodes = {};
    FILTERS.forEach(function (f) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "cypherflix-discover__chip";
        chip.setAttribute("data-filter-id", f.id);
        chip.textContent = f.label;
        if (activeFilters.has(f.id)) chip.classList.add("is-active");
        chip.addEventListener("click", function () { onChipClicked(f.id); });
        filtersHost.appendChild(chip);
        chipNodes[f.id] = chip;
    });

    function onChipClicked(id) {
        if (id === "all") {
            activeFilters = new Set(["all"]);
        } else if (activeFilters.has(id)) {
            activeFilters.delete(id);
            if (activeFilters.size === 0 || (activeFilters.size === 1 && activeFilters.has("all"))) {
                activeFilters = new Set(["all"]);
            }
        } else {
            activeFilters.delete("all");
            activeFilters.add(id);
        }
        // Update visuals.
        Object.keys(chipNodes).forEach(function (cid) {
            chipNodes[cid].classList.toggle("is-active", activeFilters.has(cid));
        });
        // Reset paging and re-query.
        offset = 0;
        results = [];
        grid.innerHTML = "";
        scheduleSearch(0);
    }

    function activeTypesCsv() {
        if (activeFilters.has("all")) return null;
        var types = [];
        FILTERS.forEach(function (f) {
            if (f.type && activeFilters.has(f.id)) types.push(f.type);
        });
        return types.length === 0 ? null : types.join(",");
    }

    // ---- Search state ----
    // `queryToken` is bumped whenever a user-visible parameter changes (text,
    // filters). Every fetch checks the token after awaiting; if it changed,
    // we discard the stale response. This avoids the classic "fast typer
    // sees old results" race.
    var queryToken = 0;
    var debounceHandle = null;
    var offset = 0;
    var results = [];
    var loadingMore = false;
    var noMoreResults = false;

    function scheduleSearch(delay) {
        if (debounceHandle !== null) {
            clearTimeout(debounceHandle);
            debounceHandle = null;
        }
        debounceHandle = setTimeout(function () {
            debounceHandle = null;
            doSearch(true);
        }, delay);
    }

    function doSearch(reset) {
        var q = (input.value || "").trim();
        var token = ++queryToken;

        if (reset) {
            offset = 0;
            results = [];
            grid.innerHTML = "";
            noMoreResults = false;
        }

        if (q.length === 0) {
            empty.hidden = false;
            empty.textContent = "Type to search across your stack.";
            loading.hidden = true;
            return;
        }

        empty.hidden = true;
        loading.hidden = false;
        loadingMore = true;

        var params = { q: q, limit: PAGE_SIZE, offset: offset };
        var typesCsv = activeTypesCsv();
        if (typesCsv) params.types = typesCsv;

        ApiClient.ajax({
            type: "GET",
            url: ApiClient.getUrl("CypherflixHub/Search"),
            data: params,
            dataType: "json"
        }).then(function (page) {
            if (token !== queryToken) return; // stale
            loading.hidden = true;
            loadingMore = false;
            var batch = Array.isArray(page) ? page : [];
            if (batch.length < PAGE_SIZE) noMoreResults = true;
            if (batch.length === 0 && results.length === 0) {
                empty.hidden = false;
                empty.textContent = "No results for \"" + q + "\".";
                return;
            }
            appendResults(batch);
        }).catch(function (err) {
            if (token !== queryToken) return;
            loading.hidden = true;
            loadingMore = false;
            // On error, leave whatever was already in the grid alone — the
            // user shouldn't lose context just because one fetch failed.
            // eslint-disable-next-line no-console
            console.error("[CypherflixHub] Search request failed", err);
            if (results.length === 0) {
                empty.hidden = false;
                empty.textContent = "Search failed. Try again.";
            }
        });
    }

    function appendResults(batch) {
        var startIndex = results.length;
        results = results.concat(batch);
        var html = "";
        for (var i = 0; i < batch.length; i++) {
            html += cardMarkup(batch[i], startIndex + i);
        }
        // appendChild via a temp wrapper so we don't blow away listeners on
        // existing cards.
        var tmp = document.createElement("div");
        tmp.innerHTML = html;
        while (tmp.firstChild) grid.appendChild(tmp.firstChild);
    }

    // ---- Search input handling ----
    input.addEventListener("input", function () {
        scheduleSearch(SEARCH_DEBOUNCE_MS);
    });
    // Pressing Enter forces an immediate query (skips the remaining debounce).
    input.addEventListener("keydown", function (evt) {
        if (evt.key === "Enter") {
            evt.preventDefault();
            scheduleSearch(0);
        }
    });

    // ---- Infinite scroll ----
    function onMaybeLoadMore() {
        if (loadingMore || noMoreResults) return;
        if ((input.value || "").trim().length === 0) return;
        var doc = document.documentElement;
        var distance = doc.scrollHeight - (window.scrollY + window.innerHeight);
        if (distance < SCROLL_TRIGGER_PX) {
            offset = results.length;
            doSearch(false);
        }
    }
    // Use both window scroll (Jellyfin's main scroll container is the body
    // viewport on most pages) and a passive listener — keeps the main thread
    // free during fling-scroll on touchpads.
    window.addEventListener("scroll", onMaybeLoadMore, { passive: true });

    // ---- Card actions (event delegation) ----
    grid.addEventListener("click", function (evt) {
        var btn = evt.target.closest("[data-role='request']");
        if (!btn) return;
        evt.preventDefault();
        var box = btn.closest("[data-result-index]");
        if (!box) return;
        var idx = parseInt(box.getAttribute("data-result-index"), 10);
        if (Number.isNaN(idx) || idx < 0 || idx >= results.length) return;
        submitRequest(idx, box, btn);
    });

    function submitRequest(index, box, btn) {
        var result = results[index];
        if (!result) return;
        var originalLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Requesting...";

        var body = {
            ProviderInstanceId: result.ProviderInstanceId,
            ExternalId: result.ExternalId,
            MediaType: result.MediaType,
            Extras: null
        };

        ApiClient.ajax({
            type: "POST",
            url: ApiClient.getUrl("CypherflixHub/Requests"),
            data: JSON.stringify(body),
            contentType: "application/json",
            dataType: "json"
        }).then(function () {
            // Mutate the cached result so subsequent re-renders (or scroll
            // re-attaches) reflect the new state.
            results[index] = Object.assign({}, result, { RequestPending: true });
            var actionHost = box.querySelector(".cypherflix-discover__action");
            if (actionHost) {
                actionHost.innerHTML = ""
                    + "<div class=\"cypherflix-discover__pending\" data-role=\"pending\">Pending</div>";
            }
        }).catch(function (err) {
            btn.disabled = false;
            btn.textContent = originalLabel;
            // Try to surface the API's friendly Message field; fall back to
            // a generic message if the error didn't carry a parseable body.
            var msg = "Request failed.";
            if (err && err.responseJSON && err.responseJSON.Message) {
                msg = err.responseJSON.Message;
            } else if (err && err.statusText) {
                msg = "Request failed: " + err.statusText;
            }
            try { Dashboard.alert(msg); } catch (e) { /* Dashboard not ready */ }
            // eslint-disable-next-line no-console
            console.error("[CypherflixHub] Request submission failed", err);
        });
    }

    // ---- Cleanup ----
    // bootstrap.js wipes container.innerHTML on route change, so DOM listeners
    // attached to the container subtree are GC'd. The window-scoped scroll
    // listener however leaks; observe container removal and detach ours.
    var detachObserver = new MutationObserver(function () {
        if (!document.body.contains(container) || container.classList.contains("hide")) {
            window.removeEventListener("scroll", onMaybeLoadMore);
            detachObserver.disconnect();
        }
    });
    detachObserver.observe(document.body, { childList: true, subtree: true });

    // Initial state: focus the input so the user can start typing right
    // away. Empty-state message is already in place from TEMPLATE.
    try { input.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
}

// -----------------------------------------------------------------------
// Module export — top-level `return` works because bootstrap.js evaluates
// us via `new Function("ApiClient", "Dashboard", code)`.
// -----------------------------------------------------------------------

return {
    render: render
};
