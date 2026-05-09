// Item Detail modal — full metadata for one Discover item with context-aware
// Queue + Follow buttons. Opened by clicking a card body in Discover.
//
// Data source: GET /api/v1/discover/item/{kind}/{source_id} which returns
// the full upstream record plus pre-baked queue_payload + follow_targets
// dict naming the eligible Follow buttons (author, series, story_arc).
// Buttons that don't have a target in the response are not rendered.

let api;
let showToast;

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
}

function fmtDate(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString(); } catch (_) { return s; }
}

function ensureModalStyles() {
    if (document.getElementById('cypherflixItemDetailStyles')) return;
    const css = `
    #cypherflixItemDetail-backdrop {
        position: fixed; inset: 0;
        background: linear-gradient(180deg,
            rgba(20, 24, 38, 0.55) 0%,
            rgba(15, 17, 28, 0.78) 100%);
        backdrop-filter: blur(24px) saturate(140%);
        -webkit-backdrop-filter: blur(24px) saturate(140%);
        z-index: 9001; display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.18s ease;
    }
    #cypherflixItemDetail-backdrop.cf-id-open { opacity: 1; }
    .cf-id-modal {
        /* Same glass treatment used by the discover page itself, so the
           modal feels like a panel of the page rather than a foreign
           system dialog. */
        background: rgba(28, 28, 30, 0.7);
        backdrop-filter: blur(28px) saturate(140%);
        -webkit-backdrop-filter: blur(28px) saturate(140%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #fff; border-radius: 12px;
        max-width: 880px; width: calc(100% - 48px); max-height: calc(100vh - 96px);
        overflow: hidden; display: flex; flex-direction: column;
        box-shadow: 0 24px 60px rgba(0,0,0,0.6);
        font-family: inherit;
    }
    .cf-id-header {
        position: relative; display: flex; gap: 20px; padding: 24px;
        background: linear-gradient(180deg, rgba(0,0,0,0.4), rgba(0,0,0,0));
        border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .cf-id-cover { flex: 0 0 160px; }
    .cf-id-cover img {
        width: 160px; height: 240px; object-fit: cover; border-radius: 6px;
        background: #2a2a2c;
    }
    .cf-id-cover-placeholder {
        width: 160px; height: 240px; border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        background: #2a2a2c; color: rgba(255,255,255,0.35);
    }
    .cf-id-cover-placeholder .material-icons { font-size: 64px; }
    .cf-id-meta { flex: 1 1 auto; min-width: 0; }
    .cf-id-title { font-size: 22px; font-weight: 700; line-height: 1.25; margin: 0 0 6px; }
    .cf-id-subtitle { font-size: 14px; color: rgba(255,255,255,0.7); margin-bottom: 12px; }
    .cf-id-statline {
        display: flex; gap: 14px; flex-wrap: wrap;
        font-size: 12px; color: rgba(255,255,255,0.6);
        margin-bottom: 16px;
    }
    .cf-id-statline span { display: inline-flex; align-items: center; gap: 4px; }
    .cf-id-actions {
        display: flex; flex-wrap: wrap; gap: 8px;
    }
    .cf-id-actions button {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer;
        font-size: 13px; font-weight: 600; font-family: inherit;
    }
    .cf-id-action-primary { background: #00a4dc; color: #fff; }
    .cf-id-action-primary:hover { background: #0078d4; }
    .cf-id-action-primary[disabled] { background: rgba(76,175,80,0.85); cursor: default; }
    .cf-id-action-secondary {
        background: rgba(255,255,255,0.12); color: #fff;
        border: 1px solid rgba(255,255,255,0.18);
    }
    .cf-id-action-secondary:hover { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.32); }
    .cf-id-action-secondary[disabled] {
        background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.4);
        cursor: not-allowed; border-color: rgba(255,255,255,0.08);
    }
    .cf-id-action-active { background: rgba(76,175,80,0.85); color: #fff; cursor: default; }
    .cf-id-body { padding: 20px 24px; overflow-y: auto; }
    .cf-id-section { margin-bottom: 20px; }
    .cf-id-section h4 {
        font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
        color: rgba(255,255,255,0.55); margin: 0 0 8px;
    }
    .cf-id-summary { line-height: 1.55; color: rgba(255,255,255,0.85); white-space: pre-wrap; }
    .cf-id-contributors { display: flex; flex-wrap: wrap; gap: 6px; }
    .cf-id-contributor {
        font-size: 12px; padding: 4px 10px; background: rgba(255,255,255,0.08);
        border-radius: 12px; color: rgba(255,255,255,0.85);
    }
    .cf-id-close {
        position: absolute; top: 12px; right: 12px; width: 32px; height: 32px;
        border-radius: 50%; background: rgba(0,0,0,0.45); border: none; color: #fff;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
    }
    .cf-id-close:hover { background: rgba(0,0,0,0.7); }
    .cf-id-loading, .cf-id-error {
        padding: 60px 24px; text-align: center; color: rgba(255,255,255,0.7);
    }
    `;
    const style = document.createElement('style');
    style.id = 'cypherflixItemDetailStyles';
    style.textContent = css;
    document.head.appendChild(style);
}

function buildModal() {
    const backdrop = document.createElement('div');
    backdrop.id = 'cypherflixItemDetail-backdrop';
    backdrop.innerHTML = `
        <div class="cf-id-modal" role="dialog" aria-modal="true">
            <div class="cf-id-loading"><span class="material-icons">hourglass_top</span><br>Loading…</div>
        </div>`;
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close();
    });
    document.addEventListener('keydown', _escClose);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('cf-id-open'));
    return backdrop.querySelector('.cf-id-modal');
}

function _escClose(e) { if (e.key === 'Escape') close(); }

function close() {
    const backdrop = document.getElementById('cypherflixItemDetail-backdrop');
    if (!backdrop) return;
    backdrop.classList.remove('cf-id-open');
    document.removeEventListener('keydown', _escClose);
    setTimeout(() => backdrop.remove(), 200);
}

function renderError(modal, msg) {
    modal.innerHTML = '<div class="cf-id-error"><span class="material-icons">error_outline</span><br>'
        + escapeHtml(msg || 'Couldn\'t load this item.') + '</div>';
}

function renderDetail(modal, detail) {
    const cover = detail.cover_url
        ? '<img src="' + escapeHtml(detail.cover_url) + '" alt="" loading="lazy" />'
        : '<div class="cf-id-cover-placeholder"><span class="material-icons">menu_book</span></div>';

    const stats = [];
    if (detail.release_date) stats.push('<span><span class="material-icons">event</span>' + escapeHtml(fmtDate(detail.release_date)) + '</span>');
    if (detail.page_count)   stats.push('<span><span class="material-icons">menu_book</span>' + escapeHtml(String(detail.page_count)) + ' pages</span>');
    if (detail.users_count)  stats.push('<span><span class="material-icons">groups</span>' + escapeHtml(String(detail.users_count)) + ' readers</span>');
    if (detail.rating)       stats.push('<span><span class="material-icons">star</span>' + escapeHtml(Number(detail.rating).toFixed(1)) + '</span>');
    if (detail.issue_number) stats.push('<span>#' + escapeHtml(String(detail.issue_number)) + '</span>');

    const subtitle = (detail.contributors || [])
        .filter((c) => !c.contribution || /author|writer|illustrator|artist/i.test(c.contribution || ''))
        .slice(0, 3)
        .map((c) => c.name)
        .join(', ');

    const ft = detail.follow_targets || {};
    const queuePayload = detail.queue_payload || null;

    const followBtns = [];
    if (ft.author) {
        followBtns.push(
            '<button type="button" class="cf-id-action-secondary cf-id-follow"' +
            ' data-target="author">' +
            '<span class="material-icons">person_add</span>' +
            'Follow ' + escapeHtml(ft.author.display_name) + '</button>'
        );
    }
    if (ft.series) {
        followBtns.push(
            '<button type="button" class="cf-id-action-secondary cf-id-follow"' +
            ' data-target="series">' +
            '<span class="material-icons">collections_bookmark</span>' +
            'Follow ' + escapeHtml(ft.series.display_name) + '</button>'
        );
    }
    if (ft.story_arc) {
        const supported = ft.story_arc.supported !== false;
        followBtns.push(
            '<button type="button" class="cf-id-action-secondary cf-id-follow"' +
            (supported ? '' : ' disabled title="Coming in v3.1"') +
            ' data-target="story_arc">' +
            '<span class="material-icons">timeline</span>' +
            'Follow ' + escapeHtml(ft.story_arc.display_name) +
            (supported ? '' : ' (soon)') + '</button>'
        );
    }

    const queueBtn = queuePayload
        ? '<button type="button" class="cf-id-action-primary cf-id-queue">' +
          '<span class="material-icons">add</span>Queue this</button>'
        : '';

    modal.innerHTML = `
        <div class="cf-id-header">
            <div class="cf-id-cover">${cover}</div>
            <div class="cf-id-meta">
                <div class="cf-id-title">${escapeHtml(detail.title || 'Untitled')}</div>
                ${subtitle ? '<div class="cf-id-subtitle">' + escapeHtml(subtitle) + '</div>' : ''}
                <div class="cf-id-statline">${stats.join('')}</div>
                <div class="cf-id-actions">
                    ${queueBtn}
                    ${followBtns.join('')}
                </div>
            </div>
            <button class="cf-id-close" aria-label="Close"><span class="material-icons">close</span></button>
        </div>
        <div class="cf-id-body">
            ${detail.summary ? '<div class="cf-id-section"><h4>Summary</h4><div class="cf-id-summary">' + escapeHtml(detail.summary) + '</div></div>' : ''}
            ${(detail.contributors && detail.contributors.length) ? '<div class="cf-id-section"><h4>Contributors</h4><div class="cf-id-contributors">' + detail.contributors.map((c) => '<span class="cf-id-contributor">' + escapeHtml(c.name) + (c.contribution ? ' · ' + escapeHtml(c.contribution) : '') + '</span>').join('') + '</div></div>' : ''}
        </div>`;

    modal.querySelector('.cf-id-close').addEventListener('click', close);

    const queueBtnEl = modal.querySelector('.cf-id-queue');
    if (queueBtnEl) {
        queueBtnEl.addEventListener('click', async () => {
            try {
                const res = await api.queueAdd(queuePayload);
                const existed = res && res.existed === true;
                showToast(existed ? `Already in your queue: ${detail.title}` : `Queued: ${detail.title}`);
                queueBtnEl.disabled = true;
                queueBtnEl.classList.add('cf-id-action-active');
                queueBtnEl.innerHTML = '<span class="material-icons">check</span>'
                    + (existed ? 'In queue' : 'Queued');
            } catch (err) {
                showToast(`Couldn't queue: ${err.message || err}`);
            }
        });
    }

    // Pre-mark Follow buttons whose target the user already follows.
    (async () => {
        try {
            const cb = '?cb=' + Date.now();
            const fs = await import('./follow_state.js' + cb);
            await fs.loadFollowing();
            modal.querySelectorAll('.cf-id-follow').forEach((btn) => {
                const target = ft[btn.dataset.target];
                if (target && fs.isFollowing(target)) {
                    btn.disabled = true;
                    btn.classList.add('cf-id-action-active');
                    btn.innerHTML = '<span class="material-icons">check</span>Following';
                }
            });
        } catch (_) { /* fail-quiet */ }
    })();

    modal.querySelectorAll('.cf-id-follow').forEach((btn) => {
        const targetKey = btn.dataset.target;
        const target = ft[targetKey];
        if (!target || target.supported === false) return;
        btn.addEventListener('click', async () => {
            try {
                const res = await api.createFollowing(target);
                const existed = res && res.existed === true;
                showToast(existed
                    ? `Already following: ${target.display_name}`
                    : `Following: ${target.display_name}`);
                btn.disabled = true;
                btn.classList.add('cf-id-action-active');
                btn.innerHTML = '<span class="material-icons">check</span>Following';
                const cb = '?cb=' + Date.now();
                const fs = await import('./follow_state.js' + cb);
                fs.markFollowed(target);
            } catch (err) {
                showToast(`Couldn't follow: ${err.message || err}`);
            }
        });
    });
}

async function open({ kind, sourceId }) {
    ensureModalStyles();
    if (!api) {
        const cb = '?cb=' + Date.now();
        ({ api }      = await import('./api.js' + cb));
    }
    if (!showToast) {
        // The toast helper is exported by discover.js — reuse via a thin
        // import. Avoid a circular dep by lazy-loading on first use.
        const cb = '?cb=' + Date.now();
        const mod = await import('./toast.js' + cb).catch(() => null);
        if (mod && mod.showToast) showToast = mod.showToast;
        else showToast = (m) => { try { window.alert(m); } catch (_) {} };
    }

    const modal = buildModal();
    try {
        const detail = await api.discoverItem(kind, sourceId);
        renderDetail(modal, detail);
    } catch (err) {
        renderError(modal, err.message || String(err));
    }
}

export const itemDetail = { open, close };
