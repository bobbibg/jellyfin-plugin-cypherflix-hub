#!/usr/bin/env bash
#
# Cypherflix Hub v4.0 ship script — run from Git Bash on Bobbi's machine.
#
# Does the local cleanup + build + push that the workspace sandbox can't
# do (workspace can't unlink files in the mounted Windows filesystem).
#
# Steps:
#   1. Sanity-check: we're on the right repo, on a clean branch.
#   2. Delete the legacy JS tree under Jellyfin.Plugin.CypherflixHub/Web/.
#   3. npm install + tsc --noEmit + npm run build.
#   4. dotnet build to confirm C# compiles + bundle is embedded.
#   5. git add -A + commit + push to GitHub main (CI builds + releases).
#   6. Print the next-steps URL the user opens to install the upgrade.
#
# Run with:  bash scripts/ship-v4.0.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

GREEN=$'\033[1;32m'
YELLOW=$'\033[1;33m'
RED=$'\033[1;31m'
DIM=$'\033[2m'
RESET=$'\033[0m'

step() { echo; echo "${GREEN}==>${RESET} $*"; }
warn() { echo "${YELLOW}!!${RESET} $*"; }
fail() { echo "${RED}xx${RESET} $*" >&2; exit 1; }

# -- 1. Sanity ----------------------------------------------------------------

step "1/6  Sanity check"
[ -f Jellyfin.Plugin.CypherflixHub/Jellyfin.Plugin.CypherflixHub.csproj ] || fail "Run from the plugin repo root."
[ -f vite.config.ts ] || fail "vite.config.ts missing — wrong repo or v4.0 not staged."
[ -f Web/bootstrap.ts ] || fail "Web/bootstrap.ts missing — v4.0 source not present."

CSPROJ_VERSION=$(grep -oPm1 "(?<=<Version>)[^<]+" Jellyfin.Plugin.CypherflixHub/Jellyfin.Plugin.CypherflixHub.csproj)
echo "  csproj <Version>: ${CSPROJ_VERSION}"
[[ "$CSPROJ_VERSION" =~ ^4\. ]] || fail "csproj version is ${CSPROJ_VERSION} — expected 4.x for the v4.0 ship."

# Working tree should be clean of unrelated changes (the staged v4.0 changes
# we made via the agent are expected, so we DON'T abort on dirty trees —
# we just print a summary so the user can sanity-check.
echo "${DIM}Current git status:${RESET}"
git status --short || true

# -- 2. Delete legacy JS ------------------------------------------------------

step "2/6  Removing legacy Jellyfin.Plugin.CypherflixHub/Web/"
if [ -d Jellyfin.Plugin.CypherflixHub/Web ]; then
    git rm -rf --quiet Jellyfin.Plugin.CypherflixHub/Web 2>/dev/null || rm -rf Jellyfin.Plugin.CypherflixHub/Web
    echo "  removed."
else
    echo "  already absent."
fi

# -- 3. Web build -------------------------------------------------------------

step "3/6  Web build (npm install + typecheck + vite build)"
# Always npm install — a partial node_modules from a half-failed previous run
# has bitten us (vite present, typescript missing → 'tsc not found').
# `npm install` with package-lock.json is fast (~5s) when already up to date.
npm install --no-audit --no-fund
npx tsc --noEmit
npm run build

[ -f Web/dist/manifest.json ] || fail "Vite did not produce Web/dist/manifest.json."
echo "  Web/dist contents:"
ls Web/dist/

# -- 4. dotnet build ----------------------------------------------------------

step "4/6  dotnet build"
dotnet build Jellyfin.Plugin.CypherflixHub/Jellyfin.Plugin.CypherflixHub.csproj \
    --configuration Release \
    -p:SkipNpmBuild=true

# -- 5. Commit + push ---------------------------------------------------------

step "5/6  Commit + push to GitHub origin"
git add -A
if git diff --cached --quiet; then
    warn "Nothing to commit. Skipping push."
else
    git commit -m "v${CSPROJ_VERSION}: TypeScript/Vite refactor + Plugin Pages registration

- Strict-typed TypeScript frontend (Web/) replacing legacy JS
- Single hashed Vite bundle embedded as a DLL resource
- Plugin Pages config.json drop-in for sidebar registration
- Native class chains re-verified against jellyfin-web 10.11.8
- Grabber API types verified against live OpenAPI

See .recon/ for citations and ARCHITECTURE.md for the v4.0 design."
    git push origin HEAD:main
fi

# Also push to nas (homelab GitOps) if the remote exists.
if git remote get-url nas >/dev/null 2>&1; then
    step "5b/6  Pushing to nas (homelab GitOps)"
    git push nas HEAD:main || warn "nas push failed — non-fatal, plugin is delivered via GitHub release."
fi

# -- 6. Tail ------------------------------------------------------------------

step "6/6  Done"
cat <<EOF

${GREEN}v${CSPROJ_VERSION} pushed.${RESET} GitHub Actions (.github/workflows/build.yml) will:
  - npm ci + tsc + npm run build + dotnet publish
  - zip the DLL + Newtonsoft.Json
  - create release v${CSPROJ_VERSION}
  - update manifest.json on main

Next:
  1. Watch CI:  https://github.com/bobbibg/jellyfin-plugin-cypherflix-hub/actions
  2. Once green: open Jellyfin → Dashboard → Plugins → Catalog → Cypherflix Hub
     → Install (or Upgrade) → restart Jellyfin once.
  3. The Plugin Pages JSON drop-in fires on plugin start; the Discover/Queue/
     Following entries appear in the user-settings sidebar after the restart.

If the sidebar entries don't appear after restart, check
${YELLOW}/config/plugins/configurations/Jellyfin.Plugin.PluginPages/config.json${RESET}
on the NAS — it should contain three entries with Id starting
"Jellyfin.Plugin.CypherflixHub.".
EOF
