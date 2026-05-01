/*
 * Cypherflix Hub — Requests page module (UI-004).
 *
 * Loaded by Web/bootstrap.js via fetch + new Function("ApiClient", "Dashboard", code).
 * Data source: GET /CypherflixHub/Requests (Api/RequestsController.cs, API-003)
 * which returns RequestStatus[] (see Core/Models.cs).
 *
 * Renders a row of state-filter tabs, a Refresh button, and one section per
 * provider type with a list of requests. Filtering is purely client-side —
 * we fetch once, then toggle a `.cypherflix-pill__row--hidden` class on rows
 * as the user changes tabs.
 */
"use strict";

// ---------------------------------------------------------------------------
// Constants — shared between TEMPLATE and the runtime helpers below.
// ---------------------------------------------------------------------------
//
// The five filters mirror the categories agreed in the spec (UI-004 §TEMPLATE).
// "all" is special — it matches every state. The others are matched against
// RequestStatus.State (see Core/Models.cs RequestState).
const STATE_FILTERS = [
    { key: "all", label: "All", states: null },
    { key: "Pending", label: "Pending", states: ["Pending", "Approved"] },
    { key: "InProgress", label: "In Progress", states: ["InProgress"] },
    { key: "Available", label: "Available", states: ["Available"] },
    { key: "Failed", label: "Failed", states: ["Failed", "Declined"] }
];

// State -> pill class + display text mapping. Class names are local
// `cypherflix-pill-*`; their colours are defined in the inline <style>
// injected by ensureStyles() below.
const PILL_BY_STATE = {
    Pending: { cls: "cypherflix-pill-warning", text: "Pending" },
    Approved: { cls: "cypherflix-pill-info", text: "Approved" },
    InProgress: { cls: "cypherflix-pill-primary", text: "Downloading" },
    Available: { cls: "cypherflix-pill-success", text: "Available" },
    Failed: { cls: "cypherflix-pill-error", text: "Failed" },
    Declined: { cls: "cypherflix-pill-neutral", text: "Declined" }
};

// MediaType -> human-readable group-header noun. Falls back to the raw value
// (capitalised) if a new MediaType is added on the server before this file
// is updated.
const MEDIA_TYPE_LABEL = {
    Movie: "Movies",
    TvShow: "TV",
    Book: "Books",
    Audiobook: "Audiobooks",
    Music: "Music"
};

// Idempotency key for the inline <style> tag — page can re-render on Refresh
// without piling up duplicate <style> blocks.
const STYLE_TAG_ID = "cypherflix-requests-style";

// ---------------------------------------------------------------------------
// TEMPLATE — initial markup. Rows are appended into `.cypherflix-requests-list`
// after the GET /CypherflixHub/Requests response is processed.
// ---------------------------------------------------------------------------
const TEMPLATE = '' +
    '<div class="cypherflix-page cypherflix-requests">' +
        '<div class="cypherflix-requests-toolbar">' +
            '<div class="cypherflix-requests-tabs" role="tablist">' +
                STATE_FILTERS.map(function (f) {
                    return '<button type="button" is="emby-button"' +
                        ' class="emby-button cypherflix-requests-tab' +
                        (f.key === "all" ? " cypherflix-requests-tab--active" : "") + '"' +
                        ' data-cypherflix-filter="' + f.key + '">' +
                        '<span>' + escapeHtml(f.label) + '</span>' +
                    '</button>';
                }).join("") +
            '</div>' +
            '<button type="button" is="emby-button" class="raised cypherflix-requests-refresh">' +
                '<span>Refresh</span>' +
            '</button>' +
        '</div>' +
        '<div class="cypherflix-requests-status" role="status" aria-live="polite"></div>' +
        '<div class="cypherflix-requests-list"></div>' +
    '</div>';

// ---------------------------------------------------------------------------
// render(container) — bootstrap entry point. Builds DOM, wires events,
// kicks off the first fetch.
// ---------------------------------------------------------------------------
function render(container) {
    ensureStyles();
    container.innerHTML = TEMPLATE;
    wireUp(container);
    fetchAndRender(container);
}

// ---------------------------------------------------------------------------
// ensureStyles — injects the page's pill + layout rules. Idempotent: keyed
// on STYLE_TAG_ID. Uses --jf-palette-* variables with sensible fallbacks
// per JELLYFIN-INTEGRATION.md §5 so the page tracks the active theme.
// ---------------------------------------------------------------------------
function ensureStyles() {
    if (document.getElementById(STYLE_TAG_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_TAG_ID;
    var muted = "var(--jf-palette-text-secondary,rgba(255,255,255,.7))";
    var divider = "var(--jf-palette-divider,rgba(255,255,255,.12))";
    var primary = "var(--jf-palette-primary-main,#00a4dc)";
    style.textContent = [
        ".cypherflix-requests-toolbar{display:flex;align-items:center;gap:.75em;margin-bottom:1em;flex-wrap:wrap;}",
        ".cypherflix-requests-tabs{display:flex;gap:.25em;flex-wrap:wrap;flex:1 1 auto;}",
        ".cypherflix-requests-tab{background:transparent;color:" + muted + ";border:1px solid " + divider + ";padding:.4em .9em;border-radius:999px;cursor:pointer;font-size:.9em;}",
        ".cypherflix-requests-tab--active{background:" + primary + ";color:var(--jf-palette-primary-contrastText,rgba(0,0,0,.87));border-color:" + primary + ";}",
        ".cypherflix-requests-refresh{flex:0 0 auto;}",
        ".cypherflix-requests-status{color:" + muted + ";font-size:.95em;margin:.5em 0;}",
        ".cypherflix-requests-group{margin-bottom:1.5em;}",
        ".cypherflix-requests-group__title{font-size:1.1em;font-weight:600;margin:0 0 .5em;color:var(--jf-palette-text-primary,#fff);border-bottom:1px solid " + divider + ";padding-bottom:.25em;}",
        ".cypherflix-requests-row{display:flex;align-items:center;gap:.75em;padding:.5em .25em;border-bottom:1px solid " + divider + ";}",
        ".cypherflix-requests-row--hidden{display:none;}",
        ".cypherflix-requests-row__poster{flex:0 0 auto;width:40px;height:60px;background:var(--jf-palette-background-paper,#202020);border-radius:3px;object-fit:cover;}",
        ".cypherflix-requests-row__poster--placeholder{display:flex;align-items:center;justify-content:center;color:" + muted + ";font-size:.7em;}",
        ".cypherflix-requests-row__title{flex:1 1 auto;min-width:0;color:var(--jf-palette-text-primary,#fff);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
        ".cypherflix-requests-row__title-link{color:inherit;text-decoration:none;cursor:pointer;}",
        ".cypherflix-requests-row__title-link:hover{color:var(--jf-palette-primary-light,#33b6e3);text-decoration:underline;}",
        ".cypherflix-requests-row__date{display:block;font-size:.8em;color:" + muted + ";}",
        ".cypherflix-requests-row__pill{flex:0 0 auto;}",
        ".cypherflix-requests-row__link{flex:0 0 auto;color:" + muted + ";text-decoration:none;padding:.25em .5em;}",
        ".cypherflix-requests-row__link:hover{color:" + primary + ";}",
        ".cypherflix-pill{display:inline-block;padding:.2em .65em;border-radius:999px;font-size:.8em;font-weight:500;white-space:nowrap;}",
        ".cypherflix-pill-warning{background:rgba(255,167,38,.18);color:#ffa726;}",
        ".cypherflix-pill-info{background:rgba(0,164,220,.18);color:var(--jf-palette-primary-light,#33b6e3);}",
        ".cypherflix-pill-primary{background:rgba(0,164,220,.25);color:" + primary + ";}",
        ".cypherflix-pill-success{background:rgba(76,175,80,.2);color:#66bb6a;}",
        ".cypherflix-pill-error{background:rgba(198,40,40,.25);color:var(--jf-palette-error-main,#c62828);}",
        ".cypherflix-pill-neutral{background:var(--jf-palette-action-hover,rgba(255,255,255,.08));color:" + muted + ";}",
        ".cypherflix-requests-empty{padding:2em;text-align:center;color:" + muted + ";}"
    ].join("");
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// wireUp(container) — attach event handlers (filter tabs + refresh button).
// Called once per render(). Filter clicks are delegated; each click only
// updates the active class and re-applies visibility, never re-fetches.
// ---------------------------------------------------------------------------
function wireUp(container) {
    var tabs = container.querySelector(".cypherflix-requests-tabs");
    if (tabs) {
        tabs.addEventListener("click", function (evt) {
            var btn = evt.target.closest("[data-cypherflix-filter]");
            if (!btn) return;
            var key = btn.getAttribute("data-cypherflix-filter");
            setActiveFilter(container, key);
            applyFilter(container, key);
        });
    }

    var refresh = container.querySelector(".cypherflix-requests-refresh");
    if (refresh) {
        refresh.addEventListener("click", function () {
            fetchAndRender(container);
        });
    }
}

function setActiveFilter(container, key) {
    var buttons = container.querySelectorAll(".cypherflix-requests-tab");
    buttons.forEach(function (b) {
        var isActive = b.getAttribute("data-cypherflix-filter") === key;
        b.classList.toggle("cypherflix-requests-tab--active", isActive);
    });
}

function applyFilter(container, key) {
    var filter = STATE_FILTERS.find(function (f) { return f.key === key; });
    var rows = container.querySelectorAll(".cypherflix-requests-row");
    rows.forEach(function (row) {
        var state = row.getAttribute("data-cypherflix-state");
        var visible = !filter || filter.states === null
            || filter.states.indexOf(state) !== -1;
        row.classList.toggle("cypherflix-requests-row--hidden", !visible);
    });

    // Hide groups that have no visible rows after filtering — prevents
    // dangling section headers when a filter excludes every row in a group.
    var groups = container.querySelectorAll(".cypherflix-requests-group");
    groups.forEach(function (group) {
        var anyVisible = group.querySelector(
            ".cypherflix-requests-row:not(.cypherflix-requests-row--hidden)"
        );
        group.style.display = anyVisible ? "" : "none";
    });
}

// ---------------------------------------------------------------------------
// fetchAndRender — pulls the current user's requests via ApiClient.ajax
// and rebuilds the list. ApiClient is injected by bootstrap.js per
// ARCHITECTURE.md §8.1 and resolves auth headers automatically. Errors are
// surfaced into the .cypherflix-requests-status pane rather than thrown.
// ---------------------------------------------------------------------------
function fetchAndRender(container) {
    var status = container.querySelector(".cypherflix-requests-status");
    var list = container.querySelector(".cypherflix-requests-list");
    if (status) status.textContent = "Loading…";
    if (list) list.innerHTML = "";

    ApiClient.ajax({
        type: "GET",
        url: ApiClient.getUrl("CypherflixHub/Requests"),
        dataType: "json"
    }).then(function (results) {
        if (status) status.textContent = "";
        renderList(container, results || []);
        var active = container.querySelector(".cypherflix-requests-tab--active");
        var key = active ? active.getAttribute("data-cypherflix-filter") : "all";
        applyFilter(container, key);
    }).catch(function (err) {
        if (status) {
            status.textContent = "Failed to load requests"
                + (err && err.statusText ? " (" + err.statusText + ")." : ".");
        }
    });
}

// ---------------------------------------------------------------------------
// renderList — build the grouped DOM from a RequestStatus[] response. Groups
// are keyed by `${ProviderTypeId}|${MediaType}` so e.g. two Readarrs (books
// vs comics) end up in distinct sections. Within a group, sort by CreatedAt
// descending so the newest request is on top.
// ---------------------------------------------------------------------------
function renderList(container, items) {
    var list = container.querySelector(".cypherflix-requests-list");
    if (!list) return;

    if (!items.length) {
        list.innerHTML = '<div class="cypherflix-requests-empty">'
            + "You haven't requested anything yet."
            + "</div>";
        return;
    }

    // Group by providerTypeId + mediaType.
    var groups = new Map();
    items.forEach(function (req) {
        var providerType = req.ProviderTypeId || req.providerTypeId || "unknown";
        var mediaType = req.MediaType || req.mediaType || "Other";
        var key = providerType + "|" + mediaType;
        if (!groups.has(key)) {
            groups.set(key, {
                providerType: providerType,
                mediaType: mediaType,
                rows: []
            });
        }
        groups.get(key).rows.push(req);
    });

    // Stable group ordering — alphabetical by header label keeps the page
    // calm across refreshes.
    var entries = Array.from(groups.values());
    entries.forEach(function (g) { g.label = groupLabel(g.providerType, g.mediaType); });
    entries.sort(function (a, b) { return a.label.localeCompare(b.label); });

    list.innerHTML = entries.map(function (g) {
        g.rows.sort(function (a, b) {
            var ad = new Date(a.CreatedAt || a.createdAt || 0).getTime();
            var bd = new Date(b.CreatedAt || b.createdAt || 0).getTime();
            return bd - ad;
        });
        return '<section class="cypherflix-requests-group">' +
            '<h3 class="cypherflix-requests-group__title">' + escapeHtml(g.label) + '</h3>' +
            g.rows.map(rowHtml).join("") +
        '</section>';
    }).join("");
}

// Group header heuristic: "<MediaType label> (<ProviderType capitalised>)".
// E.g. "Movies (Jellyseerr)", "Books (Readarr)". Falls back to the raw
// provider type id if MEDIA_TYPE_LABEL doesn't have an entry.
function groupLabel(providerTypeId, mediaType) {
    var media = MEDIA_TYPE_LABEL[mediaType] || capitalise(mediaType || "Other");
    var provider = capitalise(providerTypeId || "Unknown");
    return media + " (" + provider + ")";
}

// One row of the list. Aliases the PascalCase / camelCase variants so the
// page works whether the controller serialises with default or kebab settings.
function rowHtml(req) {
    var state = req.State || req.state || "Pending";
    var pill = PILL_BY_STATE[state] || PILL_BY_STATE.Pending;
    var title = req.Title || req.title || "(untitled)";
    var posterUrl = req.PosterUrl || req.posterUrl;
    var externalUrl = req.ExternalUrl || req.externalUrl;
    var message = req.Message || req.message;
    var progress = req.ProgressPercent != null ? req.ProgressPercent : req.progressPercent;
    var createdAt = req.CreatedAt || req.createdAt;
    var jellyfinItemId = req.JellyfinItemId || req.jellyfinItemId; // future enhancement

    var pillText = pill.text;
    if (state === "InProgress" && typeof progress === "number") {
        pillText = "Downloading (" + Math.round(progress) + "%)";
    }

    var poster = posterUrl
        ? '<img class="cypherflix-requests-row__poster" alt="" loading="lazy" src="' + escapeAttr(posterUrl) + '">'
        : '<div class="cypherflix-requests-row__poster cypherflix-requests-row__poster--placeholder">No image</div>';

    // Failed rows: tooltip the row with the error message per spec.
    var rowTooltip = (state === "Failed" && message)
        ? ' title="' + escapeAttr(message) + '"'
        : '';

    // Available + JellyfinItemId → wrap title in a link to the JF details page.
    // (RequestStatus does not currently carry JellyfinItemId — see PR body.
    // The link only renders when the field is populated by a future
    // aggregator update, otherwise we render a plain span.)
    var titleHtml = (state === "Available" && jellyfinItemId)
        ? '<a class="cypherflix-requests-row__title-link" href="#/details?id='
            + escapeAttr(jellyfinItemId) + '">' + escapeHtml(title) + '</a>'
        : '<span>' + escapeHtml(title) + '</span>';

    var dateLine = createdAt
        ? '<span class="cypherflix-requests-row__date">'
            + escapeHtml(formatDate(createdAt)) + '</span>'
        : '';

    var externalLink = externalUrl
        ? '<a class="cypherflix-requests-row__link" href="' + escapeAttr(externalUrl)
            + '" target="_blank" rel="noopener noreferrer" title="Open in provider">' +
            // Tiny external-link glyph; SVG inlined to avoid a font dependency.
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                '<path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7z"/>' +
            '</svg>' +
        '</a>'
        : '';

    return '<div class="cypherflix-requests-row" data-cypherflix-state="'
        + escapeAttr(state) + '"' + rowTooltip + '>' +
        poster +
        '<div class="cypherflix-requests-row__title">' + titleHtml + dateLine + '</div>' +
        '<span class="cypherflix-pill cypherflix-requests-row__pill ' + pill.cls + '">'
            + escapeHtml(pillText) + '</span>' +
        externalLink +
    '</div>';
}

// ---------------------------------------------------------------------------
// Helpers — small, pure, no deps.
// ---------------------------------------------------------------------------
function capitalise(s) {
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString();
}

function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
    return escapeHtml(s);
}

return { render: render };
