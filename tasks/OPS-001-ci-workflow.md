# OPS-001 — GitHub Actions release workflow

**Goal:** the workflow that on every push to `main` produces a release zip
and updates `manifest.json` with the new version + checksum.

## File

- `.github/workflows/build.yml` (a stub already exists — confirm it matches
  the SendToKindle pattern)

## Reference

Use SendToKindle's workflow as the template — battle-tested in this homelab.
Read it at `C:\Users\Bobbi\Code\jellyfin-plugin-send-to-kindle\.github\workflows\build.yml`
before adapting.

## Critical steps

1. Checkout
2. Setup .NET 8
3. `dotnet publish -c Release -o out Jellyfin.Plugin.CypherflixHub/Jellyfin.Plugin.CypherflixHub.csproj`
4. Verify the third-party DLLs we need are in `out/` (Meilisearch + transitive
   deps, Newtonsoft.Json for File Transformation interop). If not, copy them
   explicitly.
5. Read the version from `Jellyfin.Plugin.CypherflixHub.csproj`.
6. Zip `out/Jellyfin.Plugin.CypherflixHub.dll` + the third-party DLLs into
   `cypherflix-hub_<version>.zip`.
7. Compute MD5 of the zip.
8. Update `manifest.json` — append a new entry to `versions[]` for the
   plugin entry with `c1f1e571-...` GUID:
   ```json
   {
     "version": "<x.y.z>.0",
     "changelog": "Automated release",
     "targetAbi": "10.10.7.0",
     "sourceUrl": "https://github.com/bobbibg/jellyfin-plugin-cypherflix-hub/releases/download/v<x.y.z>/cypherflix-hub_<x.y.z>.zip",
     "checksum": "<md5>",
     "timestamp": "<iso>"
   }
   ```
9. Commit the manifest change back to `main` with `[skip ci]` to avoid loops.
10. Create a GitHub release, attach the zip.

## targetAbi

Match `Jellyfin.Controller` / `Jellyfin.Model` package version. Currently
`10.10.7.0`. Bump when those packages bump.

## Permissions

The workflow needs `permissions: contents: write` to push the manifest
update + create the release.

## Acceptance criteria

- Push to main → workflow runs green.
- New entry appears in `manifest.json`.
- New release exists on GitHub with the zip attached.
- The manifest URL
  `https://raw.githubusercontent.com/bobbibg/jellyfin-plugin-cypherflix-hub/main/manifest.json`
  validates against Jellyfin's plugin catalogue parser.

---

Status: needs-review
