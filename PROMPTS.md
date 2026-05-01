# Agent invocation templates

These are the prompts to feed Claude Code (or whichever agent driver) when
dispatching parallel work. Each is **self-contained** — the agent doesn't
need access to this conversation.

The template assumes the agent has a checkout of
`bobbibg/jellyfin-plugin-cypherflix-hub` (after OPS-002).

## How to use this file

For each task you want to dispatch, copy the matching block, fill in any
`{{ placeholder }}`, and paste it as the agent's initial prompt. The agent
should produce a PR (or commit on a branch) when done.

Recommended dispatching order:

1. **First:** OPS-002 (init the repo). Single-thread, no parallelism here.
2. **Then in parallel:** OPS-001, SVC-001, SVC-005, all PROV-* (provider
   types are independent).
3. **After SVC-001 done:** SVC-002.
4. **After all PROV-* + SVC-001/002 done:** SVC-003, SVC-004.
5. **After SVC-003/004 done:** API-001..005.
6. **After API-005 + SVC-005 done:** UI-001.
7. **After API-001 done:** UI-002.
8. **After UI-001 done:** UI-003, UI-004, UI-005 in parallel.

Each agent run should end with the agent updating its task spec's `Status:`
footer and committing.

---

## Universal preamble (prepend to every task prompt)

```
You are working on the cypherflix-hub Jellyfin plugin. The repo is checked
out at the working directory. Your job is to complete ONE task spec in
tasks/.

Before writing any code, read these in order:
1. JELLYFIN-INTEGRATION.md — every Jellyfin/third-party class name and API
   surface this plugin uses, with sources. DO NOT INVENT NAMES that aren't
   in this doc; if you need one that isn't there, add it (with a citation
   to a real source) before using it.
2. ARCHITECTURE.md — the overall design.
3. The task spec you are assigned.
4. Existing code under Jellyfin.Plugin.CypherflixHub/ — especially
   Core/IMediaProvider.cs, Core/Models.cs, and Plugin.cs.

Coding rules:
- Target .NET 8, nullable enabled, file-scoped namespaces.
- Use Jellyfin's standard logging via ILogger<T>.
- For controllers, use bare [Authorize] (NEVER
  [Authorize(Policy = "DefaultAuthorization")]). Parse claims manually.
- Keep changes scoped to the files listed in your task spec. If a change
  outside that scope seems necessary, explain why in your commit message.
- Build verification: run `dotnet build` and confirm zero warnings before
  declaring done.

Output:
- A focused commit (or PR) with all the files for this task.
- Update tasks/<your-task>.md footer to "Status: needs-review".
- Note any deviations from the spec or unanswered questions in the commit
  body.
```

---

## CORE-* — already done

(Nothing to dispatch — `Core/*.cs` and `Configuration/PluginConfiguration.cs`
exist.)

---

## PROV-001 — Jellyfin self provider

```
{{universal preamble}}

Your task: tasks/PROV-001-jellyfin.md

The crucial dependency for this provider is Jellyfin's own ILibraryManager.
Read MediaBrowser.Controller.Library.ILibraryManager via the published
Jellyfin.Controller 10.10.7 API (NuGet) before writing the client.

Pay particular attention to BaseItemKind enum values — these change
between JF versions. Use only the kinds confirmed in
JELLYFIN-INTEGRATION.md or the live API surface.
```

---

## PROV-002 — Jellyseerr provider

```
{{universal preamble}}

Your task: tasks/PROV-002-jellyseerr.md

The Jellyseerr API is Overseerr-compatible. Reference docs at
https://api-docs.overseerr.dev/ — but verify endpoints behave the same on
the actual Jellyseerr fork against this homelab's instance at
http://192.168.1.165:7920 if you have access.

User-id mapping is the trickiest part — read the spec section on that
twice before implementing.
```

---

## PROV-003 — Readarr provider (Faustvii fork)

```
{{universal preamble}}

Your task: tasks/PROV-003-readarr.md

This is the Faustvii fork (image: readarr:local in the homelab). The API
shape mostly matches stock Readarr v0.x but verify any endpoint that's
flaky against the running instance at http://192.168.1.165:7650.

Multi-instance is critical here — the admin will configure separate
instances for books, audiobooks, comics. Make sure cfg.media_type is the
single source of truth for which MediaType your IndexDocuments use.
```

---

## PROV-004 — ReadMeABook provider

```
{{universal preamble}}

Your task: tasks/PROV-004-readmeabook.md

NOTE: This provider is BLOCKED until ReadMeABook is deployed to the homelab
and its API is documented. If you pick this up before that's done, either:
(a) ping Bobbi and pause, or
(b) ship a stub provider that returns empty results, leaving TODOs for the
    real implementation.

If shipping a stub, mark the spec status as "stub-only — needs ReadMeABook
deployment before completion".
```

---

## SVC-001 — MeilisearchClient

```
{{universal preamble}}

Your task: tasks/SVC-001-meilisearch-client.md

The Meilisearch NuGet package is already in the .csproj at v0.15.4. Use
its API verbatim — do not write your own HTTP client. Check the package
docs: https://github.com/meilisearch/meilisearch-dotnet
```

---

## SVC-002 — IndexerService

```
{{universal preamble}}

Your task: tasks/SVC-002-indexer-service.md

Depends on SVC-001 — confirm the MeilisearchClient surface is in place
before starting. Test plan: register a test provider that returns 3
hard-coded IndexDocuments, confirm they land in Meilisearch within
IndexIntervalMinutes (set it to 1 minute for the test).
```

---

## SVC-003 — SearchAggregator

```
{{universal preamble}}

Your task: tasks/SVC-003-search-aggregator.md

Depends on SVC-001 (Meilisearch read) and SVC-004 (RequestAggregator for
RequestPending decoration).

The library decoration step (step 4) is the trickiest — for the first cut,
match by exact title + year case-insensitive. We can fuzz-match later.
```

---

## SVC-004 — Request + Calendar Aggregators

```
{{universal preamble}}

Your task: tasks/SVC-004-request-and-calendar-aggregators.md

Two small classes that both fan out across providers and merge results.
The pattern is similar enough that you can share helpers.

Make sure provider exceptions are CAUGHT and DOWNGRADED to a logged
warning — never propagate. If one provider fails, the others should still
return.
```

---

## SVC-005 — FileTransformationRegistrar

```
{{universal preamble}}

Your task: tasks/SVC-005-file-transformation-registrar.md

This is the trickiest service because of cross-load-context reflection.
Read JELLYFIN-INTEGRATION.md §2 in full before writing a line of code.

CRITICAL: confirm the IndexHtmlTransform.Transform signature against the
File Transformation source repo — the README is ambiguous about whether
the callback mutates the input JObject or returns a new string.

Resolve open question #1 in JELLYFIN-INTEGRATION.md (File Transformation
GUID) and update both that doc and manifest.json.
```

---

## API-001 — ProvidersController

```
{{universal preamble}}

Your task: tasks/API-001-providers-controller.md

Pay attention to secret masking — the GET endpoints must NEVER return
plaintext password/api-key fields. The POST endpoint must MERGE submitted
"***" values back to the previously stored value, not save "***".
```

---

## API-002 — SearchController

```
{{universal preamble}}

Your task: tasks/API-002-search-controller.md

Tiny controller — just plumbs HTTP query params into a SearchQuery and
calls SearchAggregator. Most of the work happened in SVC-003.
```

---

## API-003 — RequestsController

```
{{universal preamble}}

Your task: tasks/API-003-requests-controller.md

Tiny controller. Same pattern as API-002.
```

---

## API-004 — CalendarController

```
{{universal preamble}}

Your task: tasks/API-004-calendar-controller.md

Tiny controller. Same pattern as API-002 / 003.
```

---

## API-005 — WebController

```
{{universal preamble}}

Your task: tasks/API-005-web-controller.md

The trick here is the embedded resource path resolution. Verify by listing
manifest resources at runtime in a unit test or a quick log line.
```

---

## UI-001 — bootstrap.js

```
{{universal preamble}}

Your task: tasks/UI-001-bootstrap.md

PRE-FLIGHT REQUIRED: before writing code, you MUST inspect a running
Jellyfin 10.10.7 instance to identify the exact CSS selectors used for
the title-bar tab strip and the main view container. Document your
findings in JELLYFIN-INTEGRATION.md §8 (open question 2) and commit that
update along with your bootstrap.js changes.

If you don't have a live JF to inspect, look at the jellyfin-web source
in the master branch — start with src/components/headroom and
src/controllers — and document your best guess with a TODO to verify on
deploy.
```

---

## UI-002 — Admin settings page

```
{{universal preamble}}

Your task: tasks/UI-002-admin-page.md

Use ONLY the elements / classes / globals listed in
JELLYFIN-INTEGRATION.md §4. If you find yourself wanting one that isn't
listed, add it to that doc with a source citation FIRST.

Test by deploying the plugin to the homelab and going through the full
add → test → save → edit → save flow with a Jellyseerr instance.
```

---

## UI-003 / UI-004 / UI-005 — Discover / Requests / Calendar pages

```
{{universal preamble}}

Your task: tasks/UI-{NNN}-{name}.md

Each page module exposes `render(container)`. The page-specific spec has
the template + behaviour.

Match Jellyfin's native card classes for visual consistency — verify the
exact class names against jellyfin-web source and add findings to
JELLYFIN-INTEGRATION.md (any new selectors you reference that aren't
already documented).
```

---

## OPS-001 — CI workflow

```
{{universal preamble}}

Your task: tasks/OPS-001-ci-workflow.md

Use C:\Users\Bobbi\Code\jellyfin-plugin-send-to-kindle\.github\workflows\build.yml
as the template — it's battle-tested and produces a working manifest +
release. Adapt names but keep the structure.

The trickiest step is "verify third-party DLLs are in out/" — for this
plugin we need at minimum Meilisearch.dll plus its transitive deps
(System.Text.Json, etc.) and Newtonsoft.Json (for File Transformation
JObject interop).
```

---

## OPS-002 — Initial commit + GitHub repo

```
{{universal preamble}}

Your task: tasks/OPS-002-initial-commit.md

Use Git Bash, not Windows OpenSSH (per homelab CLAUDE.md). The user's
gh CLI is already authed.

The first push will trigger the (still-broken) GitHub Actions workflow —
that's expected; OPS-001 fixes it.
```
