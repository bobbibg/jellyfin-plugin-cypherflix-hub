// v3.1: Discover detail PAGE (replaces the modal in v3.0).
//
// Routed by `#/cypherflix/details?kind=...&source_id=...`. Mounts into a
// host that bootstrap inserts directly under the active .libraryPage so
// Jellyfin's existing detail-page CSS applies — the layout is intentionally
// indistinguishable from a native item detail page, with the additions:
//
// - "Not in library" badge over the cover (since we don't have it yet)
// - Queue + Follow buttons in the .detailButtons row
// - More-by-author section under contributors, grouped by series first then
//   standalone, with per-row Queue buttons for missing entries
//
// Back navigation goes to history.back() via the standard browser back
// button — Jellyfin preserves the previous tab's scroll position natively.

let api;
let showToast;
let followState;

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

function fmtYear(s) {
    if (!s || s.length < 4) return '';
    return s.slice(0, 4);
}

function parseHash() {
    const m = (window.location.hash || '').match(/#\/cypherflix\/details\?(.*)$/);
    if (!m) return null;
    const params = new URLSearchParams(m[1]);
    const kind = params.get('kind');
    const sourceId = params.get('source_id');
    if (!kind || !sourceId) return null;
    return { kind, sourceId };
}

// ----- skeleton + render -------------------------------------------------

function renderSkeleton(host) {
    host.innerHTML = `
        <div class="page itemDetailPage cf-d-detail-page">
            <div class="detailPagePrimaryContainer padded-left padded-right">
                <div class="detailImageContainer cf-d-detail-cover">
                    <div class="cf-d-detail-cover-skeleton cf-q-skeleton-shimmer"></div>
                </div>
                <div class="detailPagePrimaryInner">
                    <div class="cf-q-skeleton-line cf-q-skeleton-shimmer" style="width: 40%; height: 12px;"></div>
                    <div class="cf-q-skeleton-line cf-q-skeleton-shimmer" style="width: 70%; height: 28px; margin-top: 12px;"></div>
                    <div class="cf-q-skeleton-line cf-q-skeleton-shimmer" style="width: 50%; height: 14px; margin-top: 8px;"></div>
                </div>
            </div>
        </div>`;
}

function renderError(host, msg) {
    host.innerHTML = `
        <div class="page itemDetailPage cf-d-detail-page">
            <div class="detailPagePrimaryContainer padded-left padded-right">
                <div class="cf-d-detail-error">
                    <span class="material-icons">error_outline</span>
                    <h2>Couldn't load this item</h2>
                    <p>${escapeHtml(msg || 'Unknown error.')}</p>
                </div>
            </div>
        </div>`;
}

// ----- contributors carousel --------------------------------------------

function renderContributors(detail) {
    const contribs = (detail.contributors || []).filter((c) => c && c.name);
    if (!contribs.length) return '';
    const cards = contribs.map((c) => `
        <div class="card overflowPortraitCard card-hoverable" data-author-id="${c.id || ''}">
            <div class="cardBox">
                <div class="cardScalable">
                    <div class="cardPadder cardPadder-portrait"></div>
                    <div class="cardImageContainer coveredImage cardContent itemAction"
                         style="background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center;">
                        <span class="material-icons" style="font-size: 48px; color: rgba(255,255,255,0.45);">person</span>
                    </div>
                </div>
                <div class="cardFooter">
                    <div class="cardText cardText-first cardTextCentered">${escapeHtml(c.name)}</div>
                    ${c.contribution ? '<div class="cardText cardText-secondary cardTextCentered">' + escapeHtml(c.contribution) + '</div>' : ''}
                </div>
            </div>
        </div>`).join('');
    return `
        <h2 class="sectionTitle detailSectionHeader">Contributors</h2>
        <div is="emby-itemscontainer" class="itemsContainer focuscontainer-x scrollX hiddenScrollX padded-left-focusscale padded-right-focusscale">
            ${cards}
        </div>`;
}

// ----- More-by-author carousel ------------------------------------------

function _bookStateBadge(state) {
    switch (state) {
        case 'in_library':
            return '<div class="cf-d-detail-bib-badge cf-d-detail-bib-badge-have"><span class="material-icons">check_circle</span>In library</div>';
        case 'downloading':
            return '<div class="cf-d-detail-bib-badge cf-d-detail-bib-badge-dl"><span class="material-icons">cloud_download</span>Downloading</div>';
        case 'queued':
            return '<div class="cf-d-detail-bib-badge cf-d-detail-bib-badge-q"><span class="material-icons">schedule</span>Queued</div>';
        default:
            return '';
    }
}

function _bookCardHtml(book, currentBookId) {
    const isCurrent = book.hardcover_book_id === currentBookId;
    const cover = book.cover_url
        ? `<img src="${escapeHtml(book.cover_url)}" loading="lazy" alt="" />`
        : `<div class="cf-d-detail-bib-placeholder"><span class="material-icons">menu_book</span></div>`;
    const yr = book.year ? '<span class="cardText cardText-secondary">' + escapeHtml(String(book.year)) + '</span>' : '';
    const queueBtn = (book.queue_state === 'none' && !isCurrent)
        ? `<button type="button" class="cf-d-detail-bib-queue raised raised-mini" data-book-id="${book.hardcover_book_id}">
              <span class="material-icons">add</span>Queue
           </button>`
        : '';
    return `
        <div class="card overflowPortraitCard ${isCurrent ? 'cf-d-detail-bib-current' : ''}"
             data-source-id="${book.hardcover_book_id}">
            <div class="cardBox">
                <div class="cardScalable">
                    <div class="cardPadder cardPadder-portrait"></div>
                    <div class="cardImageContainer coveredImage cardContent itemAction">
                        ${cover}
                        ${_bookStateBadge(book.queue_state)}
                    </div>
                </div>
                <div class="cardFooter">
                    <div class="cardText cardText-first" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
                    ${yr}
                    ${queueBtn}
                </div>
            </div>
        </div>`;
}

function renderMoreBy(bibliography, currentBookId) {
    if (!bibliography) return '';
    const series = bibliography.series || [];
    const standalone = bibliography.standalone || [];
    if (!series.length && !standalone.length) return '';

    const seriesBlocks = series.map((g) => {
        const cards = g.books.map((b) => _bookCardHtml(b, currentBookId)).join('');
        return `
            <h2 class="sectionTitle detailSectionHeader cf-d-detail-bib-series-title">
                ${escapeHtml(g.series_name)}
                <button type="button"
                        class="cf-d-detail-bib-follow-series raised-mini button-flat"
                        data-target='${escapeHtml(JSON.stringify(g.follow_target))}'>
                    <span class="material-icons">add</span>Follow series
                </button>
            </h2>
            <div is="emby-itemscontainer" class="itemsContainer focuscontainer-x scrollX hiddenScrollX padded-left-focusscale padded-right-focusscale">
                ${cards}
            </div>`;
    }).join('');

    const standaloneBlock = standalone.length ? `
        <h2 class="sectionTitle detailSectionHeader">Standalone</h2>
        <div is="emby-itemscontainer" class="itemsContainer focuscontainer-x scrollX hiddenScrollX padded-left-focusscale padded-right-focusscale">
            ${standalone.map((b) => _bookCardHtml(b, currentBookId)).join('')}
        </div>` : '';

    return `
        <div class="cf-d-detail-bib-section">
            ${seriesBlocks}
            ${standaloneBlock}
        </div>`;
}

// ----- main render -------------------------------------------------------

function renderDetail(host, detail, bibliography) {
    const cover = detail.cover_url
        ? `<img src="${escapeHtml(detail.cover_url)}" alt="" />`
        : `<div class="cf-d-detail-cover-placeholder"><span class="material-icons">menu_book</span></div>`;

    const subtitle = (detail.contributors || [])
        .filter((c) => !c.contribution || /author|writer|illustrator|artist/i.test(c.contribution || ''))
        .slice(0, 3)
        .map((c) => c.name)
        .join(', ');

    const stats = [];
    if (detail.kind === 'book') stats.push('Book');
    else if (detail.kind === 'comic_issue') stats.push('Comic');
    else if (detail.kind === 'comic_series') stats.push('Comic Series');
    if (detail.release_date) stats.push(escapeHtml(fmtYear(detail.release_date)));
    if (detail.page_count) stats.push(escapeHtml(String(detail.page_count)) + ' pages');
    if (detail.rating) stats.push('★ ' + escapeHtml(Number(detail.rating).toFixed(1)));

    const ft = detail.follow_targets || {};
    const queuePayload = detail.queue_payload || null;

    // Native button shape (recon against jellyfin-web's itemDetails template):
    //   <button is="emby-button" class="button-flat detailButton" title="...">
    //     <div class="detailButton-content">
    //       <span class="material-icons detailButton-icon ICON"></span>
    //     </div>
    //   </button>
    // We add a sibling text label inside .detailButton-content so the action
    // is readable — Queue/Follow aren't recognisable as glyphs alone.
    const _detailBtn = (icon, label, extraClass, dataAttr) => `
        <button is="emby-button" type="button"
                class="button-flat detailButton ${extraClass}"
                title="${escapeHtml(label)}"
                ${dataAttr || ''}>
            <div class="detailButton-content">
                <span class="material-icons detailButton-icon ${icon}" aria-hidden="true"></span>
                <span class="cf-d-detail-button-label">${escapeHtml(label)}</span>
            </div>
        </button>`;

    const followBtns = [];
    if (ft.author) {
        followBtns.push(_detailBtn(
            'person_add', 'Follow ' + ft.author.display_name,
            'cf-d-detail-follow',
            "data-target='" + escapeHtml(JSON.stringify(ft.author)) + "'",
        ));
    }
    if (ft.series) {
        followBtns.push(_detailBtn(
            'collections_bookmark', 'Follow ' + ft.series.display_name,
            'cf-d-detail-follow',
            "data-target='" + escapeHtml(JSON.stringify(ft.series)) + "'",
        ));
    }

    const queueBtn = queuePayload
        ? _detailBtn('add', 'Queue this', 'cf-d-detail-queue')
        : '';

    host.innerHTML = `
        <div class="page itemDetailPage cf-d-detail-page">
            <div class="detailPagePrimaryContainer padded-left padded-right">
                <div class="detailImageContainer cf-d-detail-cover">
                    ${cover}
                    <div class="cf-d-detail-missing-badge">
                        <span class="material-icons">cloud_download</span>
                        Not in library
                    </div>
                </div>
                <div class="detailPagePrimaryInner">
                    <div class="itemMiscInfo">${stats.join(' · ')}</div>
                    <h2 class="itemDetailsTitle">${escapeHtml(detail.title || 'Untitled')}</h2>
                    ${subtitle ? '<div class="itemDetailsBy">by ' + escapeHtml(subtitle) + '</div>' : ''}

                    <div class="mainDetailButtons focuscontainer-x">
                        ${queueBtn}
                        ${followBtns.join('')}
                    </div>

                    ${detail.summary ? `
                        <h2 class="sectionTitle detailSectionHeader">Overview</h2>
                        <div class="detailOverview">${escapeHtml(detail.summary)}</div>` : ''}

                    ${renderContributors(detail)}

                    ${renderMoreBy(bibliography, detail.kind === 'book' ? parseInt(detail.source_id, 10) : null)}
                </div>
            </div>
        </div>`;

    _wireActions(host, detail, queuePayload, ft);
}

function _wireActions(host, detail, queuePayload, ft) {
    // Queue this — primary CTA on the page
    const queueBtn = host.querySelector('.cf-d-detail-queue');
    if (queueBtn && queuePayload) {
        // Pre-mark if already queued (use the queue_state from /discover/item).
        const item = { kind: detail.kind, source: detail.source, source_id: detail.source_id };
        const qs = followState ? followState.getQueueState(item) : 'none';
        if (qs !== 'none') {
            queueBtn.disabled = true;
            queueBtn.classList.add('cf-d-detail-action-active');
            queueBtn.querySelector('.cf-d-detail-button-label').textContent =
                qs === 'downloaded' ? 'In library' : 'Queued';
        }
        queueBtn.addEventListener('click', async () => {
            try {
                const res = await api.queueAdd(queuePayload);
                const existed = res && res.existed === true;
                showToast(existed
                    ? `Already in your queue: ${detail.title}`
                    : `Queued: ${detail.title}`);
                queueBtn.disabled = true;
                queueBtn.classList.add('cf-d-detail-action-active');
                queueBtn.querySelector('.cf-d-detail-button-label').textContent = 'Queued';
                if (followState) followState.markQueued(item, res && res.status ? res.status : 'wanted');
            } catch (err) {
                showToast(`Couldn't queue: ${err.message || err}`);
            }
        });
    }

    // Top-level Follow buttons
    host.querySelectorAll('.cf-d-detail-follow').forEach((btn) => {
        let target;
        try { target = JSON.parse(btn.dataset.target || '{}'); } catch (_) { return; }
        if (followState && followState.isFollowing(target)) {
            btn.disabled = true;
            btn.classList.add('cf-d-detail-action-active');
            btn.querySelector('.cf-d-detail-button-label').textContent = 'Following';
        }
        btn.addEventListener('click', async () => {
            try {
                const res = await api.createFollowing(target);
                const existed = res && res.existed === true;
                showToast(existed
                    ? `Already following: ${target.display_name}`
                    : `Following: ${target.display_name}`);
                btn.disabled = true;
                btn.classList.add('cf-d-detail-action-active');
                btn.querySelector('.cf-d-detail-button-label').textContent = 'Following';
                if (followState) followState.markFollowed(target);
            } catch (err) {
                showToast(`Couldn't follow: ${err.message || err}`);
            }
        });
    });

    // Per-bibliography-row Queue buttons
    host.addEventListener('click', async (e) => {
        const qBtn = e.target.closest('.cf-d-detail-bib-queue');
        if (qBtn) {
            const card = qBtn.closest('.card');
            const bookId = parseInt(qBtn.dataset.bookId, 10);
            // We know this is the current author's bibliography → POST a
            // minimal queue payload. The backend back-fills the rest from
            // upstream metadata when it imports.
            const titleEl = card.querySelector('.cardText-first');
            const title = (titleEl && titleEl.textContent) || 'Book';
            qBtn.disabled = true;
            qBtn.innerHTML = '<span class="material-icons">hourglass_top</span>';
            try {
                const res = await api.queueAdd({
                    kind: 'book',
                    series_name: title,
                    title,
                    hardcover_book_id: bookId,
                });
                const existed = res && res.existed === true;
                showToast(existed ? `Already queued: ${title}` : `Queued: ${title}`);
                // Replace button with badge.
                qBtn.outerHTML = '<div class="cf-d-detail-bib-badge cf-d-detail-bib-badge-q"><span class="material-icons">schedule</span>Queued</div>';
            } catch (err) {
                qBtn.disabled = false;
                qBtn.innerHTML = '<span class="material-icons">add</span>Queue';
                showToast(`Couldn't queue: ${err.message || err}`);
            }
            return;
        }

        // Per-series follow on bibliography section title
        const fSeriesBtn = e.target.closest('.cf-d-detail-bib-follow-series');
        if (fSeriesBtn) {
            let target;
            try { target = JSON.parse(fSeriesBtn.dataset.target || '{}'); } catch (_) { return; }
            try {
                const res = await api.createFollowing(target);
                const existed = res && res.existed === true;
                showToast(existed
                    ? `Already following: ${target.display_name}`
                    : `Following: ${target.display_name}`);
                fSeriesBtn.disabled = true;
                fSeriesBtn.innerHTML = '<span class="material-icons">check</span>Following';
                if (followState) followState.markFollowed(target);
            } catch (err) {
                showToast(`Couldn't follow: ${err.message || err}`);
            }
        }
    });
}

// ----- entry point -------------------------------------------------------

export async function render(host) {
    const cb = '?cb=' + Date.now();
    if (!api)         ({ api }       = await import('./api.js' + cb));
    if (!showToast)   ({ showToast } = await import('./toast.js' + cb));
    if (!followState) followState     = await import('./follow_state.js' + cb);

    const route = parseHash();
    if (!route) {
        renderError(host, 'Invalid detail route — expected #/cypherflix/details?kind=...&source_id=...');
        return;
    }

    renderSkeleton(host);

    let detail;
    try {
        detail = await api.discoverItem(route.kind, route.sourceId);
    } catch (err) {
        renderError(host, err.message || String(err));
        return;
    }

    // For books with an author target, fetch the full bibliography in
    // parallel with the rest of the render — render the page first with
    // detail, then upgrade with the More-by-author section when ready.
    let bibliography = null;
    const authorId =
        detail.follow_targets && detail.follow_targets.author
            ? detail.follow_targets.author.hardcover_author_id
            : null;
    if (authorId) {
        try {
            bibliography = await api.discoverAuthorBibliography(authorId);
        } catch (_) { /* non-fatal */ }
    }

    // Prime follow state so the buttons render in the right initial state.
    if (followState) await followState.loadFollowing();

    renderDetail(host, detail, bibliography);

    // Re-render Follow / Queue states on subsequent events.
    document.addEventListener('cypherflix:followed', () => _refreshActions(host, detail));
    document.addEventListener('cypherflix:queued',   () => _refreshActions(host, detail));
}

function _refreshActions(host, detail) {
    if (!followState) return;
    const queueBtn = host.querySelector('.cf-d-detail-queue');
    if (queueBtn) {
        const item = { kind: detail.kind, source: detail.source, source_id: detail.source_id };
        const qs = followState.getQueueState(item);
        if (qs !== 'none') {
            queueBtn.disabled = true;
            queueBtn.classList.add('cf-d-detail-action-active');
            const txt = queueBtn.querySelector('.cf-d-detail-button-label');
            if (txt) txt.textContent = qs === 'downloaded' ? 'In library' : 'Queued';
        }
    }
    host.querySelectorAll('.cf-d-detail-follow').forEach((btn) => {
        let target;
        try { target = JSON.parse(btn.dataset.target || '{}'); } catch (_) { return; }
        if (followState.isFollowing(target)) {
            btn.disabled = true;
            btn.classList.add('cf-d-detail-action-active');
            const txt = btn.querySelector('.cf-d-detail-button-label');
            if (txt) txt.textContent = 'Following';
        }
    });
}
