# Cypherflix Hub — task specs

Each file in this folder is a **self-contained brief** for a Claude Code agent.
The agent should be able to complete the task with no questions asked, given:

1. `ARCHITECTURE.md` (the design)
2. `JELLYFIN-INTEGRATION.md` (the ground-truth API surface)
3. The task spec itself

Read all three before starting.

## Naming

- `CORE-*` — foundations (already complete)
- `PROV-*` — `IMediaProvider` implementations (one provider per task)
- `SVC-*` — cross-cutting services (Meilisearch, indexer, aggregators, FT registrar)
- `API-*` — ASP.NET controllers
- `UI-*` — web UI (admin page, bootstrap, three tabs)
- `OPS-*` — repo / build / release setup

## Dependency graph

```
CORE-* (done)
   │
   ├──→ PROV-001 (Jellyfin)            ──┐
   ├──→ PROV-002 (Jellyseerr)          ──┤
   ├──→ PROV-003 (Readarr)             ──┤  Can run all PROV in parallel
   └──→ ... future providers           ──┘
                                          │
   SVC-001 (MeilisearchClient)            │
       │                                  │
       └──→ SVC-002 (IndexerService) ──┐  │
                                       ▼  ▼
                            SVC-003 (SearchAggregator)
                            SVC-004 (Request + Calendar Aggregators)

   SVC-005 (FileTransformationRegistrar)  ── independent

   API-001..005  ── needs CORE; ideally needs SVC-003/004 to be useful

   UI-002 (admin page)  ── needs API-001
   UI-001 (bootstrap)   ── needs SVC-005 + WebController
   UI-003..005 (tabs)   ── need UI-001 + API-002/003/004

   OPS-001 (CI workflow)        ── independent
   OPS-002 (initial commit + GH repo) ── independent
```

## Status convention

Add a footer to each spec:

```
Status: not-started | in-progress (agent X) | needs-review | done
```

Update it as you go.
