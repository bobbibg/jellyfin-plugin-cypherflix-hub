# OPS-002 — Init git repo + push to GitHub

**Goal:** make the scaffold visible so agents can be spawned against it.

## Steps

```bash
cd C:\Users\Bobbi\Code\jellyfin-plugin-cypherflix-hub
git init -b main
git add .
git commit -m "Initial scaffold: core abstractions + docs + CI stub"
gh repo create bobbibg/jellyfin-plugin-cypherflix-hub --public --source=. --remote=origin --push
```

(Use Git Bash, not Windows OpenSSH — see homelab CLAUDE.md.)

## After push

1. Confirm GitHub Actions workflow runs (it will fail on the first push
   because the build code isn't real yet — that's expected).
2. Confirm the manifest URL is reachable:
   ```bash
   curl -sI https://raw.githubusercontent.com/bobbibg/jellyfin-plugin-cypherflix-hub/main/manifest.json
   ```
3. Add the URL to your Jellyfin plugin sources (it'll show "Cypherflix Hub"
   with no installable versions until OPS-001 produces one).

## Acceptance criteria

- Repo exists at `github.com/bobbibg/jellyfin-plugin-cypherflix-hub`.
- `main` branch contains the scaffold + all task specs.
- Manifest URL returns 200.

---

Status: done
