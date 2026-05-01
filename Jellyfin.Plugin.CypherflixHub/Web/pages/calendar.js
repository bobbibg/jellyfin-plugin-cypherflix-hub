/*
 * Cypherflix Hub — Calendar page module (UI-005).
 *
 * Loaded by Web/bootstrap.js via fetch + new Function("ApiClient", "Dashboard", code).
 * Data source: GET /CypherflixHub/Calendar?start=<iso>&end=<iso>&types=<csv>
 * (Api/CalendarController.cs, API-004) returning CalendarEntry[] (see
 * Core/Models.cs).
 *
 * Layout:
 *   < [Month YYYY] >                                  [type filter chips]
 *   [ 7-column day grid; cells with releases get (n) badge; today highlighted ]
 *   [ flat list of releases sorted by ReleaseDate; clicking a cell filters the list ]
 */
"use strict";

// ---------------------------------------------------------------------------
// Type filter chips — id matches the MediaType enum name on the server.
// "all" is special and clears the others.
// ---------------------------------------------------------------------------
var TYPE_FILTERS = [
    { id: "all", label: "All" },
    { id: "Movie", label: "Movies" },
    { id: "TvShow", label: "TV" },
    { id: "Book", label: "Books" },
    { id: "Comic", label: "Comics" },
    { id: "Audiobook", label: "Audiobooks" },
    { id: "Music", label: "Music" }
];

// JS getDay() is Sunday=0; we render Monday-first per the spec.
var WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

var STYLE_ID = "cypherflix-calendar-style";

// ---------------------------------------------------------------------------
// Inline stylesheet — injected once. All colours via --jf-palette-* with
// fallbacks per JELLYFIN-INTEGRATION.md §5.
// ---------------------------------------------------------------------------
var STYLE_CONTENT = [
    ".cypherflix-cal { padding: 1rem; }",
    ".cypherflix-cal__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem; }",
    ".cypherflix-cal__nav { display: flex; align-items: center; gap: .75rem; }",
    ".cypherflix-cal__nav-btn { background: transparent; border: 1px solid var(--jf-palette-divider, rgba(255,255,255,.12)); color: var(--jf-palette-text-primary, #fff); cursor: pointer; padding: .25rem .75rem; border-radius: 4px; font-size: 1rem; }",
    ".cypherflix-cal__nav-btn:hover { background: var(--jf-palette-action-hover, rgba(255,255,255,.08)); }",
    ".cypherflix-cal__month-label { font-size: 1.25rem; min-width: 12ch; text-align: center; }",
    ".cypherflix-cal__filters { display: flex; flex-wrap: wrap; gap: .25rem; }",
    ".cypherflix-cal__chip { background: transparent; border: 1px solid var(--jf-palette-divider, rgba(255,255,255,.12)); color: var(--jf-palette-text-secondary, rgba(255,255,255,.7)); cursor: pointer; padding: .25rem .75rem; border-radius: 999px; font-size: .875rem; }",
    ".cypherflix-cal__chip--active { background: var(--jf-palette-primary-main, #00a4dc); color: var(--jf-palette-primary-contrastText, rgba(0,0,0,.87)); border-color: var(--jf-palette-primary-main, #00a4dc); }",
    ".cypherflix-cal__weekday-row { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 4px; }",
    ".cypherflix-cal__weekday { text-align: center; font-size: .75rem; text-transform: uppercase; color: var(--jf-palette-text-secondary, rgba(255,255,255,.7)); padding: .25rem 0; }",
    ".cypherflix-cal__grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }",
    ".cypherflix-cal__cell { aspect-ratio: 1 / 1; border: 1px solid var(--jf-palette-divider, rgba(255,255,255,.12)); border-radius: 4px; padding: .25rem; display: flex; flex-direction: column; align-items: flex-start; justify-content: space-between; background: var(--jf-palette-background-paper, #202020); color: var(--jf-palette-text-primary, #fff); font-size: .875rem; }",
    ".cypherflix-cal__cell--empty { background: transparent; border-color: transparent; cursor: default; }",
    ".cypherflix-cal__cell--has-releases { cursor: pointer; }",
    ".cypherflix-cal__cell--has-releases:hover { background: var(--jf-palette-action-hover, rgba(255,255,255,.08)); }",
    ".cypherflix-cal__cell--today { background: var(--jf-palette-primary-main, #00a4dc); color: var(--jf-palette-primary-contrastText, rgba(0,0,0,.87)); border-color: var(--jf-palette-primary-main, #00a4dc); }",
    ".cypherflix-cal__cell--selected { outline: 2px solid var(--jf-palette-primary-main, #00a4dc); outline-offset: -2px; }",
    ".cypherflix-cal__badge { background: var(--jf-palette-primary-main, #00a4dc); color: var(--jf-palette-primary-contrastText, rgba(0,0,0,.87)); border-radius: 999px; padding: 0 .4rem; font-size: .7rem; align-self: flex-end; }",
    ".cypherflix-cal__cell--today .cypherflix-cal__badge { background: var(--jf-palette-background-paper, #202020); color: var(--jf-palette-text-primary, #fff); }",
    ".cypherflix-cal__list { margin-top: 1.5rem; }",
    ".cypherflix-cal__list-clear { background: transparent; border: 1px solid var(--jf-palette-divider, rgba(255,255,255,.12)); color: var(--jf-palette-text-primary, #fff); cursor: pointer; padding: .25rem .75rem; border-radius: 4px; font-size: .875rem; margin-bottom: .5rem; }",
    ".cypherflix-cal__list-clear:hover { background: var(--jf-palette-action-hover, rgba(255,255,255,.08)); }",
    ".cypherflix-cal__row { display: grid; grid-template-columns: 6em auto 1fr auto; gap: .75rem; align-items: center; padding: .5rem .25rem; border-bottom: 1px solid var(--jf-palette-divider, rgba(255,255,255,.12)); cursor: pointer; }",
    ".cypherflix-cal__row:hover { background: var(--jf-palette-action-hover, rgba(255,255,255,.08)); }",
    ".cypherflix-cal__row-date { color: var(--jf-palette-text-secondary, rgba(255,255,255,.7)); font-variant-numeric: tabular-nums; }",
    ".cypherflix-cal__row-type { color: var(--jf-palette-text-secondary, rgba(255,255,255,.7)); font-size: .75rem; text-transform: uppercase; }",
    ".cypherflix-cal__row-title { font-weight: 500; }",
    ".cypherflix-cal__row-subtitle { color: var(--jf-palette-text-secondary, rgba(255,255,255,.7)); }",
    ".cypherflix-cal__empty { color: var(--jf-palette-text-secondary, rgba(255,255,255,.7)); padding: 2rem; text-align: center; }"
].join("\n");

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_CONTENT;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) {
    if (s === null || s === undefined) {
        return "";
    }
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function startOfMonth(year, month) {
    return new Date(year, month, 1, 0, 0, 0, 0);
}

function endOfMonth(year, month) {
    // Day 0 of next month = last day of this month.
    return new Date(year, month + 1, 0, 23, 59, 59, 999);
}

function isoDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

// Mon-first weekday: Mon=0, Tue=1, ..., Sun=6.
function monFirstDay(d) {
    var sundayFirst = d.getDay();
    return (sundayFirst + 6) % 7;
}

function getEntryDate(entry) {
    var raw = entry.ReleaseDate || entry.releaseDate;
    if (!raw) { return null; }
    var d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Template + entry-point
// ---------------------------------------------------------------------------
var TEMPLATE = [
    "<div class=\"cypherflix-cal\">",
    "  <div class=\"cypherflix-cal__header\">",
    "    <div class=\"cypherflix-cal__nav\">",
    "      <button type=\"button\" class=\"cypherflix-cal__nav-btn\" data-cypherflix-nav=\"prev\" aria-label=\"Previous month\">&lt;</button>",
    "      <span class=\"cypherflix-cal__month-label\" data-cypherflix-month-label></span>",
    "      <button type=\"button\" class=\"cypherflix-cal__nav-btn\" data-cypherflix-nav=\"next\" aria-label=\"Next month\">&gt;</button>",
    "    </div>",
    "    <div class=\"cypherflix-cal__filters\" data-cypherflix-filters></div>",
    "  </div>",
    "  <div class=\"cypherflix-cal__weekday-row\" data-cypherflix-weekdays></div>",
    "  <div class=\"cypherflix-cal__grid\" data-cypherflix-grid></div>",
    "  <div class=\"cypherflix-cal__list\" data-cypherflix-list></div>",
    "</div>"
].join("");

function render(container) {
    ensureStyles();
    container.innerHTML = TEMPLATE;

    var now = new Date();
    var state = {
        container: container,
        year: now.getFullYear(),
        month: now.getMonth(),
        activeFilters: ["all"],
        entries: [],
        selectedDay: null,
        // Generation token — drops stale fetch responses if the user clicks
        // through months faster than the network responds.
        fetchToken: 0
    };

    renderWeekdayHeader(container);
    renderFilterChips(state);
    wireMonthNav(state);
    refresh(state);
}

function renderWeekdayHeader(container) {
    var row = container.querySelector("[data-cypherflix-weekdays]");
    var html = "";
    for (var i = 0; i < WEEKDAY_HEADERS.length; i++) {
        html += "<div class=\"cypherflix-cal__weekday\">" + escapeHtml(WEEKDAY_HEADERS[i]) + "</div>";
    }
    row.innerHTML = html;
}

function renderFilterChips(state) {
    var host = state.container.querySelector("[data-cypherflix-filters]");
    var html = "";
    for (var i = 0; i < TYPE_FILTERS.length; i++) {
        var f = TYPE_FILTERS[i];
        var active = state.activeFilters.indexOf(f.id) >= 0;
        html += "<button type=\"button\" class=\"cypherflix-cal__chip"
            + (active ? " cypherflix-cal__chip--active" : "")
            + "\" data-cypherflix-filter=\"" + escapeHtml(f.id) + "\">"
            + escapeHtml(f.label) + "</button>";
    }
    host.innerHTML = html;

    var chips = host.querySelectorAll("[data-cypherflix-filter]");
    for (var j = 0; j < chips.length; j++) {
        chips[j].addEventListener("click", function (e) {
            var id = e.currentTarget.getAttribute("data-cypherflix-filter");
            toggleFilter(state, id);
            renderFilterChips(state);
            refresh(state);
        });
    }
}

function toggleFilter(state, id) {
    if (id === "all") {
        state.activeFilters = ["all"];
        return;
    }
    // Picking a specific type clears "all".
    var without = state.activeFilters.filter(function (x) { return x !== "all"; });
    var idx = without.indexOf(id);
    if (idx >= 0) {
        without.splice(idx, 1);
    } else {
        without.push(id);
    }
    state.activeFilters = without.length ? without : ["all"];
}

function wireMonthNav(state) {
    var prev = state.container.querySelector("[data-cypherflix-nav=\"prev\"]");
    var next = state.container.querySelector("[data-cypherflix-nav=\"next\"]");
    prev.addEventListener("click", function () {
        state.month -= 1;
        if (state.month < 0) { state.month = 11; state.year -= 1; }
        state.selectedDay = null;
        refresh(state);
    });
    next.addEventListener("click", function () {
        state.month += 1;
        if (state.month > 11) { state.month = 0; state.year += 1; }
        state.selectedDay = null;
        refresh(state);
    });
}

// ---------------------------------------------------------------------------
// Fetch + paint
// ---------------------------------------------------------------------------
function refresh(state) {
    var token = ++state.fetchToken;
    var start = startOfMonth(state.year, state.month);
    var end = endOfMonth(state.year, state.month);

    paintMonthLabel(state);

    var data = { start: isoDate(start), end: isoDate(end) };
    if (state.activeFilters.indexOf("all") < 0) {
        data.types = state.activeFilters.join(",");
    }

    ApiClient.ajax({
        type: "GET",
        url: ApiClient.getUrl("CypherflixHub/Calendar"),
        data: data,
        dataType: "json"
    }).then(function (entries) {
        if (token !== state.fetchToken) {
            return;
        }
        state.entries = Array.isArray(entries) ? entries : [];
        paintGrid(state);
        paintList(state);
    }, function (err) {
        if (token !== state.fetchToken) {
            return;
        }
        state.entries = [];
        paintGrid(state);
        paintList(state);
        if (Dashboard && typeof Dashboard.alert === "function") {
            var msg = (err && err.statusText) ? err.statusText : "Failed to load calendar";
            Dashboard.alert(msg);
        }
    });
}

function paintMonthLabel(state) {
    var label = state.container.querySelector("[data-cypherflix-month-label]");
    var d = startOfMonth(state.year, state.month);
    label.textContent = d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function entriesByDay(state) {
    var by = {};
    for (var i = 0; i < state.entries.length; i++) {
        var d = getEntryDate(state.entries[i]);
        if (!d) { continue; }
        if (d.getFullYear() !== state.year || d.getMonth() !== state.month) {
            // Server may include boundary days; only paint cells inside the
            // currently visible month.
            continue;
        }
        var key = d.getDate();
        if (!by[key]) { by[key] = []; }
        by[key].push(state.entries[i]);
    }
    return by;
}

function paintGrid(state) {
    var grid = state.container.querySelector("[data-cypherflix-grid]");
    var first = startOfMonth(state.year, state.month);
    var last = endOfMonth(state.year, state.month);
    var leadingBlanks = monFirstDay(first);
    var totalDays = last.getDate();
    var byDay = entriesByDay(state);
    var today = new Date();

    var html = "";
    for (var i = 0; i < leadingBlanks; i++) {
        html += "<div class=\"cypherflix-cal__cell cypherflix-cal__cell--empty\"></div>";
    }
    for (var day = 1; day <= totalDays; day++) {
        var releases = byDay[day] || [];
        var dayDate = new Date(state.year, state.month, day);
        var classes = ["cypherflix-cal__cell"];
        if (releases.length) { classes.push("cypherflix-cal__cell--has-releases"); }
        if (sameDay(dayDate, today)) { classes.push("cypherflix-cal__cell--today"); }
        if (state.selectedDay !== null && state.selectedDay === day) {
            classes.push("cypherflix-cal__cell--selected");
        }
        var badge = releases.length
            ? "<span class=\"cypherflix-cal__badge\">" + releases.length + "</span>"
            : "";
        html += "<div class=\"" + classes.join(" ") + "\" data-cypherflix-day=\"" + day + "\">"
            + "<span>" + day + "</span>"
            + badge
            + "</div>";
    }
    // Trailing blanks to keep the grid rectangular.
    var totalCells = leadingBlanks + totalDays;
    var trailing = (7 - (totalCells % 7)) % 7;
    for (var t = 0; t < trailing; t++) {
        html += "<div class=\"cypherflix-cal__cell cypherflix-cal__cell--empty\"></div>";
    }
    grid.innerHTML = html;

    var cells = grid.querySelectorAll("[data-cypherflix-day]");
    for (var c = 0; c < cells.length; c++) {
        cells[c].addEventListener("click", function (e) {
            var dayAttr = e.currentTarget.getAttribute("data-cypherflix-day");
            var dayNum = parseInt(dayAttr, 10);
            if (isNaN(dayNum)) { return; }
            var hasReleases = e.currentTarget.classList.contains("cypherflix-cal__cell--has-releases");
            if (!hasReleases && state.selectedDay !== dayNum) { return; }
            state.selectedDay = state.selectedDay === dayNum ? null : dayNum;
            paintGrid(state);
            paintList(state);
        });
    }
}

function renderRow(entry, date, idx) {
    var dateText = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    var typeText = entry.MediaType || entry.mediaType || "";
    var title = entry.Title || entry.title || "(untitled)";
    var subtitle = entry.Subtitle || entry.subtitle || "";
    var external = entry.ExternalUrl || entry.externalUrl;
    var jellyfinId = entry.JellyfinItemId || entry.jellyfinItemId;

    var trailing = (jellyfinId || external)
        ? "<span class=\"cypherflix-cal__row-link\" aria-hidden=\"true\">&rarr;</span>"
        : "<span></span>";

    return "<div class=\"cypherflix-cal__row\" data-cypherflix-row=\"" + idx + "\" tabindex=\"0\">"
        + "<span class=\"cypherflix-cal__row-date\">" + escapeHtml(dateText) + "</span>"
        + "<span class=\"cypherflix-cal__row-type\">" + escapeHtml(typeText) + "</span>"
        + "<span><span class=\"cypherflix-cal__row-title\">" + escapeHtml(title) + "</span>"
        + (subtitle ? " <span class=\"cypherflix-cal__row-subtitle\">" + escapeHtml(subtitle) + "</span>" : "")
        + "</span>"
        + trailing
        + "</div>";
}

function openEntry(entry) {
    var jellyfinId = entry.JellyfinItemId || entry.jellyfinItemId;
    if (jellyfinId) {
        window.location.href = "/web/index.html#/details?id=" + encodeURIComponent(jellyfinId);
        return;
    }
    var external = entry.ExternalUrl || entry.externalUrl;
    if (external) {
        window.open(external, "_blank", "noopener,noreferrer");
    }
}

function paintList(state) {
    var host = state.container.querySelector("[data-cypherflix-list]");
    var visible = state.entries
        .map(function (e) {
            var d = getEntryDate(e);
            return d ? { entry: e, date: d } : null;
        })
        .filter(function (x) { return x !== null; })
        .filter(function (x) {
            return x.date.getFullYear() === state.year
                && x.date.getMonth() === state.month;
        });

    if (state.selectedDay !== null) {
        visible = visible.filter(function (x) { return x.date.getDate() === state.selectedDay; });
    }

    visible.sort(function (a, b) { return a.date.getTime() - b.date.getTime(); });

    if (!visible.length) {
        var msg = state.selectedDay !== null
            ? "Nothing scheduled for this day."
            : "Nothing upcoming this month.";
        host.innerHTML = "<div class=\"cypherflix-cal__empty\">" + escapeHtml(msg) + "</div>";
        return;
    }

    var html = "";
    if (state.selectedDay !== null) {
        html += "<button type=\"button\" class=\"cypherflix-cal__list-clear\" data-cypherflix-list-clear>Show whole month</button>";
    }
    for (var i = 0; i < visible.length; i++) {
        html += renderRow(visible[i].entry, visible[i].date, i);
    }
    host.innerHTML = html;

    var clearBtn = host.querySelector("[data-cypherflix-list-clear]");
    if (clearBtn) {
        clearBtn.addEventListener("click", function () {
            state.selectedDay = null;
            paintGrid(state);
            paintList(state);
        });
    }

    var rows = host.querySelectorAll("[data-cypherflix-row]");
    for (var r = 0; r < rows.length; r++) {
        rows[r].addEventListener("click", function (e) {
            var idx = parseInt(e.currentTarget.getAttribute("data-cypherflix-row"), 10);
            if (isNaN(idx) || idx < 0 || idx >= visible.length) { return; }
            openEntry(visible[idx].entry);
        });
    }
}

return {
    render: render
};
