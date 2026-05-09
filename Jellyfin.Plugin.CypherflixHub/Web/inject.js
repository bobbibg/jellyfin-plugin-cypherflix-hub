// v3.1 — Jellyfin-page DOM injection.
//
// One MutationObserver, three responsibilities:
//
//   1. Item detail pages (book / series / season / episode) — inject
//      a "Follow" button into the .detailButtons row when we can map the
//      item to a follow target (Hardcover author for books, ComicVine
//      volume for comic series, etc.)
//
//   2. Series detail page — inject a "More by Author" section under the
//      existing .detailPagePrimaryInner content when we can resolve the
//      Hardcover author from the displayed item's metadata.
//
//   3. Missing items in any view — inject a "Queue" button on each
//      missing-item card so the user can pull it without leaving Jellyfin.
//
// Resolution strategy:
//   - Read window.ApiClient.getCurrentItem-equivalent state from the
//     URL hash (Jellyfin's #/details?id=GUID) → fetch the item via
//     /Users/{id}/Items/{id} → extract ProviderIds.
//   - If the Hardcover or ComicVine provider id is set on the item, use
//     it directly. Otherwise fall back to a name-based search via
//     /api/v1/discover/search with a short cache.
//
// Defensive: every injection check is idempotent (data-cf-injected guard)
// and silently no-ops when DOM doesn't match — Jellyfin's web UI rebuilds
// the body on every navigation, so we re-inject on every observer tick
// for newly-mounted detail pages.

let api;
let showToast;
let followState;

const INJECT_MARK = 'data-cf-injected';

// Cached author/series resolutions — name → hardcover_author_id, etc.
// Skips repeated /search calls during a single page session.
const _resolveCache = new Map();

async function _ensureModules() {
    if (api && showToast && followState) return;
    const cb = '?cb=' + Date.now();
    if (!api)         ({ api }       = await import('/CypherflixHub/Web/pages/api.js' + cb));
    if (!showToast)   ({ showToast } = await import('/CypherflixHub/Web/pages/toast.js' + cb));
    if (!followState) followState     = await import('/CypherflixHub/Web/pages/follow_state.js' + cb);
}

// ---- Item detail extraction ---------------------------------------------

function _currentDetailItemId() {
    // Jellyfin uses #/details?id=GUID&serverId=...
    const m = (window.location.hash || '').match(/[?&]id=([0-9a-f-]+)/i);
    return m ? m[1] : null;
}

async function _fetchJellyfinItem(itemId) {
    // Use Jellyfin's ApiClient — it carries the user's session token.
    const ac = window.ApiClient;
    if (!ac || !itemId) return null;
    try {
        const userId = (await ac.getCurrentUser()).Id;
        return await ac.getItem(userId, itemId);
    } catch (_) {
        return null;
    }
}

// ---- Resolve Hardcover author id from a Jellyfin item -------------------

async function _resolveHardcoverAuthorId(item) {
    if (!item) return null;
    // 1. Direct ProviderIds — aspirational fast-path. Recon (May 2026)
    //    confirmed Bobbi's setup has no Hardcover provider plugin
    //    populating ProviderIds.Hardcover, so this path always misses
    //    today. Kept so the path lights up for free if/when the
    //    Cypherflix Metadata plugin gets reinstalled.
    const pids = item.ProviderIds || {};
    if (pids.Hardcover) {
        const id = parseInt(pids.Hardcover, 10);
        if (!Number.isNaN(id)) return id;
    }
    // 2. People array → Author entries → ProviderIds on the person.
    //    Same caveat — Bookshelf doesn't populate this either.
    const people = item.People || [];
    for (const p of people) {
        if ((p.Type === 'Author' || p.Role === 'Author') && p.ProviderIds && p.ProviderIds.Hardcover) {
            const id = parseInt(p.ProviderIds.Hardcover, 10);
            if (!Number.isNaN(id)) return id;
        }
    }
    // 3. Name-search — the actual resolution path in the current
    //    deployment. We hit /api/v1/discover/search with the author
    //    name and pick the first hit whose author string matches.
    //    Cached by lowercased name for the SPA session so revisits
    //    don't re-search.
    const authorName =
        (people.find((p) => p.Type === 'Author' || p.Role === 'Author') || {}).Name ||
        (item.AlbumArtist) || null;
    if (!authorName) return null;
    const cacheKey = 'hc_author:' + authorName.toLowerCase();
    if (_resolveCache.has(cacheKey)) return _resolveCache.get(cacheKey);
    try {
        const res = await api.discoverSearch(authorName, 'book', 5);
        const items = (res && res.items) || [];
        const match = items.find((it) => {
            const a = (it.authors || '').toLowerCase();
            return a.includes(authorName.toLowerCase());
        });
        const wp = match && match.watchlist_payload;
        const id = (wp && wp.kind === 'book_author') ? wp.hardcover_author_id : null;
        _resolveCache.set(cacheKey, id);
        return id;
    } catch (_) {
        _resolveCache.set(cacheKey, null);
        return null;
    }
}

async function _resolveComicSeriesId(item) {
    if (!item) return null;
    const pids = item.ProviderIds || {};
    if (pids.ComicVine || pids.Comicvine) {
        const id = parseInt(pids.ComicVine || pids.Comicvine, 10);
        if (!Number.isNaN(id)) return id;
    }
    return null;
}

// ---- Detail-page Follow button inject -----------------------------------

async function _injectFollowOnDetailPage() {
    // Native template uses .mainDetailButtons (confirmed by recon against
    // jellyfin-web's itemDetails-index-html chunk). The .detailButton class
    // is on the buttons themselves, not the row.
    const buttonsRow = document.querySelector('.itemDetailPage:not(.hide) .mainDetailButtons:not([' + INJECT_MARK + '])');
    if (!buttonsRow) return;
    buttonsRow.setAttribute(INJECT_MARK, 'follow');

    const itemId = _currentDetailItemId();
    if (!itemId) return;
    const item = await _fetchJellyfinItem(itemId);
    if (!item) return;

    let target = null;

    if (['Book', 'AudioBook'].includes(item.Type)) {
        const authorId = await _resolveHardcoverAuthorId(item);
        if (authorId) {
            const authorName =
                (item.People || []).find((p) => p.Type === 'Author' || p.Role === 'Author');
            target = {
                kind: 'book_author',
                display_name: (authorName && authorName.Name) || 'Author',
                hardcover_author_id: authorId,
            };
        }
    } else if (['Series', 'Season', 'Episode'].includes(item.Type)) {
        // For TV series we'd want a tvdb / tmdb provider follow which the
        // backend doesn't model yet. Skip until those land.
    } else if (item.Type === 'BoxSet' && /comic/i.test(item.Tags?.join(',') || '')) {
        const cvId = await _resolveComicSeriesId(item);
        if (cvId) {
            target = {
                kind: 'comic_series',
                display_name: item.Name,
                comicvine_id: cvId,
            };
        }
    }

    if (!target) return;

    // Pre-mark already-following.
    const isFollowing = followState && followState.isFollowing(target);

    // Match the native button markup precisely — recon shows every
    // .detailButton in mainDetailButtons follows this exact shape:
    //   <button is="emby-button" class="button-flat detailButton" title="...">
    //     <div class="detailButton-content">
    //       <span class="material-icons detailButton-icon ICON_NAME"></span>
    //     </div>
    //   </button>
    // Native is icon-only with title for tooltip; we add a small text label
    // below the icon since "Queue"/"Follow" aren't recognisable as glyphs.
    const btn = document.createElement('button');
    btn.setAttribute('is', 'emby-button');
    btn.type = 'button';
    btn.className = 'button-flat detailButton cf-jf-follow-btn';
    btn.title = isFollowing ? 'Following' : 'Follow ' + _shortName(target.display_name);
    btn.dataset.target = JSON.stringify(target);
    if (isFollowing) {
        btn.disabled = true;
        btn.classList.add('cf-jf-follow-active');
    }
    const iconName = isFollowing ? 'check' : 'person_add';
    const labelText = isFollowing ? 'Following' : 'Follow ' + _shortName(target.display_name);
    btn.innerHTML = `
        <div class="detailButton-content">
            <span class="material-icons detailButton-icon ${iconName}" aria-hidden="true"></span>
            <span class="cf-jf-follow-label">${labelText}</span>
        </div>
    `;
    btn.addEventListener('click', async () => {
        try {
            const res = await api.createFollowing(target);
            const existed = res && res.existed === true;
            showToast(existed
                ? `Already following: ${target.display_name}`
                : `Following: ${target.display_name}`);
            btn.disabled = true;
            btn.classList.add('cf-jf-follow-active');
            btn.title = 'Following';
            const iconEl = btn.querySelector('.detailButton-icon');
            if (iconEl) {
                // Native pattern uses the icon name as a class, not text content.
                iconEl.classList.remove('person_add');
                iconEl.classList.add('check');
            }
            const labelEl = btn.querySelector('.cf-jf-follow-label');
            if (labelEl) labelEl.textContent = 'Following';
            if (followState) followState.markFollowed(target);
        } catch (err) {
            showToast(`Couldn't follow: ${err.message || err}`);
        }
    });
    buttonsRow.appendChild(btn);
}

function _shortName(s) {
    if (!s) return '';
    if (s.length <= 20) return s;
    const parts = s.split(' ');
    return parts[parts.length - 1];  // surname-only fallback for long names
}

// ---- Detail-page More-by-author inject ----------------------------------

async function _injectMoreByOnBookDetailPage() {
    const inner = document.querySelector('.itemDetailPage:not(.hide) .detailPagePrimaryInner:not([' + INJECT_MARK + '-moreby])');
    if (!inner) return;
    const itemId = _currentDetailItemId();
    if (!itemId) return;
    const item = await _fetchJellyfinItem(itemId);
    if (!item || !['Book', 'AudioBook'].includes(item.Type)) return;
    inner.setAttribute(INJECT_MARK + '-moreby', '1');

    const authorId = await _resolveHardcoverAuthorId(item);
    if (!authorId) return;

    let bib;
    try {
        bib = await api.discoverAuthorBibliography(authorId);
    } catch (_) {
        return;
    }
    if (!bib || (!bib.series?.length && !bib.standalone?.length)) return;

    // Inline-import the renderMoreBy helper from discover_detail so we
    // don't duplicate the markup.
    const cb = '?cb=' + Date.now();
    const dd = await import('/CypherflixHub/Web/pages/discover_detail.js' + cb).catch(() => null);
    // discover_detail's renderMoreBy is module-private; we can't import it
    // directly. Instead, inline a minimal version.
    const html = _renderMoreByInline(bib, _hardcoverIdFromJellyfinItem(item));
    if (!html) return;

    const section = document.createElement('div');
    section.className = 'cf-jf-moreby-host';
    section.innerHTML = html;
    inner.appendChild(section);

    // Wire per-row Queue buttons via delegated click.
    section.addEventListener('click', async (e) => {
        const qBtn = e.target.closest('.cf-jf-bib-queue');
        if (!qBtn) return;
        const bookId = parseInt(qBtn.dataset.bookId, 10);
        const card = qBtn.closest('.card');
        const titleEl = card && card.querySelector('.cardText-first');
        const title = (titleEl && titleEl.textContent) || 'Book';
        qBtn.disabled = true;
        qBtn.innerHTML = '<span class="material-icons">hourglass_top</span>';
        try {
            const res = await api.queueAdd({
                kind: 'book', series_name: title, title, hardcover_book_id: bookId,
            });
            const existed = res && res.existed === true;
            showToast(existed ? `Already queued: ${title}` : `Queued: ${title}`);
            qBtn.outerHTML = '<div class="cf-jf-bib-badge"><span class="material-icons">schedule</span>Queued</div>';
        } catch (err) {
            qBtn.disabled = false;
            qBtn.innerHTML = '<span class="material-icons">add</span>Queue';
            showToast(`Couldn't queue: ${err.message || err}`);
        }
    });
}

function _hardcoverIdFromJellyfinItem(item) {
    const pids = (item && item.ProviderIds) || {};
    return pids.Hardcover ? parseInt(pids.Hardcover, 10) : null;
}

function _renderMoreByInline(bib, currentBookId) {
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
        );
    }
    function bookCard(b) {
        const isCurrent = b.hardcover_book_id === currentBookId;
        const cover = b.cover_url
            ? `<img src="${escapeHtml(b.cover_url)}" loading="lazy" />`
            : `<div class="cf-jf-bib-placeholder"><span class="material-icons">menu_book</span></div>`;
        const yr = b.year ? `<span class="cardText cardText-secondary">${b.year}</span>` : '';
        const action = (b.queue_state === 'in_library') ? '<div class="cf-jf-bib-badge cf-jf-bib-badge-have"><span class="material-icons">check_circle</span>In library</div>'
                     : (b.queue_state === 'queued' || b.queue_state === 'downloading') ? '<div class="cf-jf-bib-badge"><span class="material-icons">schedule</span>Queued</div>'
                     : (!isCurrent ? `<button class="cf-jf-bib-queue raised raised-mini" data-book-id="${b.hardcover_book_id}"><span class="material-icons">add</span>Queue</button>` : '');
        return `
            <div class="card overflowPortraitCard ${isCurrent ? 'cf-jf-bib-current' : ''}">
                <div class="cardBox">
                    <div class="cardScalable">
                        <div class="cardPadder cardPadder-portrait"></div>
                        <div class="cardImageContainer coveredImage cardContent">
                            ${cover}
                        </div>
                    </div>
                    <div class="cardFooter">
                        <div class="cardText cardText-first" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</div>
                        ${yr}
                        ${action}
                    </div>
                </div>
            </div>`;
    }
    const series = (bib.series || []).map((g) => `
        <div class="verticalSection">
            <h2 class="sectionTitle sectionTitle-cards padded-left">${escapeHtml(g.series_name)}</h2>
            <div is="emby-itemscontainer" class="itemsContainer focuscontainer-x scrollX hiddenScrollX padded-left padded-right">
                ${g.books.map(bookCard).join('')}
            </div>
        </div>`).join('');
    const standalone = (bib.standalone || []).length ? `
        <div class="verticalSection">
            <h2 class="sectionTitle sectionTitle-cards padded-left">More books by this author</h2>
            <div is="emby-itemscontainer" class="itemsContainer focuscontainer-x scrollX hiddenScrollX padded-left padded-right">
                ${bib.standalone.map(bookCard).join('')}
            </div>
        </div>` : '';
    if (!series && !standalone) return '';
    return series + standalone;
}

// ---- Missing items — Queue button injection -----------------------------
//
// Jellyfin renders missing episodes as cards with class .missingEpisode or
// data-missing="true" depending on the version. We detect by looking for
// cards inside an .itemsContainer that have either marker AND don't
// already have a Queue button injected.

async function _injectQueueOnMissingCards() {
    // Native marker for a missing episode/movie/etc is a child element with
    // class .missingIndicator on the card (recon-confirmed against jellyfin-web).
    // No data-missing attribute on the card itself — we walk up from the
    // indicator instead.
    document.querySelectorAll('.missingIndicator').forEach(async (indicator) => {
        const card = indicator.closest('.card');
        if (!card || card.hasAttribute(INJECT_MARK)) return;
        card.setAttribute(INJECT_MARK, 'queue');

        const itemId = card.dataset.id;
        const itemType = card.dataset.type;
        if (!itemId) return;
        // Books/audiobooks only for now — backend tv_episode kind doesn't exist.
        if (!['Book', 'AudioBook'].includes(itemType)) return;

        // .cardImageContainer is the inner image holder. .cardScalable is
        // the parent. Either is a sensible anchor for an absolutely-
        // positioned overlay button (recon-confirmed both classes exist).
        const cardOverlay = card.querySelector('.cardImageContainer') || card.querySelector('.cardScalable');
        if (!cardOverlay) return;
        // Make sure the anchor is positioned so our absolute button
        // anchors against IT and not the page.
        if (getComputedStyle(cardOverlay).position === 'static') {
            cardOverlay.style.position = 'relative';
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cf-jf-card-queue raised raised-mini';
        btn.innerHTML = '<span class="material-icons">add</span>';
        btn.title = 'Queue this';
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const item = await _fetchJellyfinItem(itemId);
            if (!item) {
                showToast("Couldn't read item details from Jellyfin");
                return;
            }
            const hcId = _hardcoverIdFromJellyfinItem(item);
            if (!hcId) {
                showToast("No Hardcover id on this item — link it first");
                return;
            }
            btn.disabled = true;
            btn.innerHTML = '<span class="material-icons">hourglass_top</span>';
            try {
                const res = await api.queueAdd({
                    kind: 'book',
                    series_name: item.Name,
                    title: item.Name,
                    hardcover_book_id: hcId,
                });
                const existed = res && res.existed === true;
                showToast(existed ? `Already queued: ${item.Name}` : `Queued: ${item.Name}`);
                btn.innerHTML = '<span class="material-icons">check</span>';
                btn.classList.add('cf-jf-card-queue-active');
            } catch (err) {
                btn.disabled = false;
                btn.innerHTML = '<span class="material-icons">add</span>';
                showToast(`Couldn't queue: ${err.message || err}`);
            }
        });
        cardOverlay.appendChild(btn);
    });
}

// ---- Observer ------------------------------------------------------------

let _injectTimer = null;
function _scheduleInject() {
    if (_injectTimer) return;
    _injectTimer = setTimeout(async () => {
        _injectTimer = null;
        try {
            await _ensureModules();
            await Promise.all([
                _injectFollowOnDetailPage(),
                _injectMoreByOnBookDetailPage(),
                _injectQueueOnMissingCards(),
            ]);
        } catch (_) { /* swallow — try again on next tick */ }
    }, 200);
}

export function bootJellyfinInjections() {
    if (window.__cypherflixInjectionsBooted) return;
    window.__cypherflixInjectionsBooted = true;

    new MutationObserver(_scheduleInject).observe(
        document.body || document.documentElement,
        { childList: true, subtree: true },
    );
    window.addEventListener('hashchange', _scheduleInject);
    _scheduleInject();
}
