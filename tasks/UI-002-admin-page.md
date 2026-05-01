# UI-002 — Admin settings page

**Goal:** the native Jellyfin plugin settings page where the admin
configures Meilisearch + provider instances.

The page entry is already wired up in `Plugin.cs:GetPages()` and the file
exists as `Configuration/configPage.html` (currently a placeholder).
This task replaces the placeholder with the working page.

## Files to edit

- `Jellyfin.Plugin.CypherflixHub/Configuration/configPage.html`

## Conventions — strict adherence required

- Use **only** the elements/classes/JS globals listed in
  `JELLYFIN-INTEGRATION.md` §4. No invented names.
- Page root must declare `data-require="emby-input,emby-button,emby-select,emby-checkbox,emby-textarea"`.
- Use `<div class="inputContainer">…</div>` for input rows, with the
  `inputLabel inputLabelUnfocused` label and `fieldDescription` helper
  per the canonical pattern in §4.1.
- Use `Dashboard.showLoadingMsg/hideLoadingMsg/alert` and the
  `processPluginConfigurationUpdateResult` helper.
- Use `var(--jf-palette-*, fallback)` for any colour we set.
- Plugin GUID for `ApiClient.getPluginConfiguration`: `c1f1e571-7ba8-4d6a-9e2b-3a4f0c5d7e8b`

## Page layout

### Section 1: Meilisearch

```
[ inputContainer ] URL              http://meilisearch:7700
[ inputContainer ] API key (password)
[ inputContainer ] Index interval (minutes) 60
[ button ] Save
[ button ] Test connection         → POST /CypherflixHub/Meilisearch/Test
```

(For the test endpoint, add a method to `ProvidersController` or a small
`MeilisearchController` — coordinate with API-001 agent. If it doesn't
exist yet, hide the Test button.)

### Section 2: Providers

Render a list from `GET /CypherflixHub/Providers`. Each row:

```
[icon] [name]        [type]        [enabled toggle]   [Edit] [Delete]
```

"Add provider" button opens a modal:

1. **Step 1 — pick type:** `<select>` populated from
   `GET /CypherflixHub/Providers/Types`.
2. **Step 2 — fill form:** render `ConfigSchema` dynamically:
   - `Text` / `Password` / `ApiKey` / `Url` → `<input is="emby-input">`
   - `Boolean` → `<input is="emby-checkbox">`
   - `Number` → `<input is="emby-input" type="number">`
   - `Select` → `<select is="emby-select">` with `Options`
   - `Multiline` → `<textarea is="emby-textarea">`
   Plus Name + Enabled-Capabilities checkboxes (subset of
   `SupportedCapabilities`).
3. **Step 3 — test:** "Test connection" button hits
   `POST /CypherflixHub/Providers/Test` with the form values.
4. **Step 4 — save:** `POST /CypherflixHub/Providers`.

## Acceptance criteria

- Admin can add a Jellyseerr instance, test it, save it, see it in the list.
- Re-opening the page shows the saved instance with secrets masked as
  "***".
- Editing a saved instance and saving without changing the password keeps
  the original password (the API merges masked secrets — see API-001).
- All form elements look like native Jellyfin form elements.

---

Status: needs-review
