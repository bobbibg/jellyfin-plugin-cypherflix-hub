// Following tab — manages the user's monitored authors / series.
// v3.0: this is the v2.x "watchlist" feature, renamed for clarity (Jellyfin
// Tweaks already exposes its own "Watchlist") and stripped of any per-item
// queueing semantics — Following is strictly "auto-queue new releases as
// they come out". Per-item queues live in the Queue tab.

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

const KIND_OPTIONS = [
    { value: '',              label: 'All' },
    { value: 'book_author',   label: 'Authors' },
    { value: 'book_series',   label: 'Book series' },
    { value: 'comic_series',  label: 'Comic series' },
];

const KIND_LABEL = {
    book_author:  'Author',
    book_series:  'Book series',
    comic_series: 'Comic series',
};

const KIND_ICON = {
    book_author:  'person',
    book_series:  'menu_book',
    comic_series: 'auto_stories',
};

const MONITOR_LABEL = {
    all:              'All releases',
    new_only:         'New only',
    specific_volumes: 'Specific volumes',
};

function renderRow(row) {
    const icon = KIND_ICON[row.kind] || 'collections_bookmark';
    const kindLabel = KIND_LABEL[row.kind] || row.kind;
    const monitor = MONITOR_LABEL[row.monitor_mode] || row.monitor_mode;
    return `
        <div class="cf-fol-row" data-id="${row.id}">
            <div class="cf-fol-icon"><span class="material-icons">${icon}</span></div>
            <div class="cf-fol-body">
                <div class="cf-fol-name">${escapeHtml(row.display_name)}</div>
                <div class="cf-fol-meta">
                    <span class="cf-fol-kind">${escapeHtml(kindLabel)}</span>
                    <span class="cf-fol-dot">·</span>
                    <span class="cf-fol-mode">${escapeHtml(monitor)}</span>
                    <span class="cf-fol-dot">·</span>
                    <span class="cf-fol-added">added ${escapeHtml(fmtDate(row.added_at))}</span>
                </div>
            </div>
            <div class="cf-fol-actions">
                <select class="cf-fol-monitor" title="Monitor mode">
                    <option value="all"${row.monitor_mode === 'all' ? ' selected' : ''}>All releases</option>
                    <option value="new_only"${row.monitor_mode === 'new_only' ? ' selected' : ''}>New only</option>
                </select>
                <button type="button" class="cf-fol-unfollow" title="Unfollow">
                    <span class="material-icons">person_remove</span>
                </button>
            </div>
        </div>`;
}

function renderShell(host) {
    host.innerHTML = `
        <div class="cf-fol-host">
            <div class="cf-fol-header">
                <h2 class="cf-fol-title">Following</h2>
                <div class="cf-fol-toolbar">
                    <select class="cf-fol-kind-filter">
                        ${KIND_OPTIONS.map((o) =>
                            '<option value="' + o.value + '">' + o.label + '</option>'
                        ).join('')}
                    </select>
                </div>
            </div>
            <div class="cf-fol-list">
                <div class="cf-fol-loading">
                    <span class="material-icons">hourglass_top</span> Loading…
                </div>
            </div>
        </div>`;
}

async function loadAndRender(host, kindFilter) {
    const list = host.querySelector('.cf-fol-list');
    list.innerHTML = '<div class="cf-fol-loading"><span class="material-icons">hourglass_top</span> Loading…</div>';
    try {
        const data = await api.listFollowing(kindFilter || undefined);
        const items = (data && data.items) || [];
        if (!items.length) {
            list.innerHTML = `
                <div class="cf-fol-empty">
                    <span class="material-icons">bookmark_border</span>
                    <h3>You're not following anyone yet</h3>
                    <p>Open an item on Discover, then click "Follow author" or "Follow series" to monitor for new releases.</p>
                </div>`;
            return;
        }
        list.innerHTML = items.map(renderRow).join('');
    } catch (err) {
        list.innerHTML = `
            <div class="cf-fol-error">
                <span class="material-icons">error_outline</span>
                <h3>Couldn't load Following</h3>
                <p>${escapeHtml(err.message || String(err))}</p>
            </div>`;
    }
}

export async function render(root) {
    const cb = '?cb=' + Date.now();
    ({ api } = await import('./api.js' + cb));
    ({ showToast } = await import('./toast.js' + cb));

    root.classList.add('cf-host', 'cf-following-host');
    renderShell(root);

    const kindFilter = root.querySelector('.cf-fol-kind-filter');
    let currentKind = '';

    kindFilter.addEventListener('change', () => {
        currentKind = kindFilter.value || '';
        loadAndRender(root, currentKind);
    });

    root.addEventListener('click', async (e) => {
        const unfollowBtn = e.target.closest('.cf-fol-unfollow');
        if (unfollowBtn) {
            const row = unfollowBtn.closest('.cf-fol-row');
            const id = row && row.dataset.id;
            if (!id) return;
            const name = (row.querySelector('.cf-fol-name') || {}).textContent || 'item';
            try {
                await api.deleteFollowing(parseInt(id, 10));
                showToast(`Unfollowed: ${name}`);
                row.remove();
                if (!root.querySelectorAll('.cf-fol-row').length) {
                    loadAndRender(root, currentKind);
                }
            } catch (err) {
                showToast(`Couldn't unfollow: ${err.message || err}`);
            }
        }
    });

    root.addEventListener('change', async (e) => {
        const sel = e.target.closest('.cf-fol-monitor');
        if (!sel) return;
        const row = sel.closest('.cf-fol-row');
        const id = row && row.dataset.id;
        if (!id) return;
        try {
            await api.patchFollowing(parseInt(id, 10), { monitor_mode: sel.value });
            showToast('Monitor mode updated.');
        } catch (err) {
            showToast(`Couldn't update: ${err.message || err}`);
        }
    });

    await loadAndRender(root, currentKind);
}
