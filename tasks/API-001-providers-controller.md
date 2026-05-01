# API-001 — ProvidersController

**Goal:** the admin-facing API powering the settings page. Lists configured
instances, lists available types + their schemas, tests a connection,
saves changes.

## File

- `Api/ProvidersController.cs`

## Routes (all under `/CypherflixHub`)

All routes:
- `[ApiController]` + `[Route("CypherflixHub")]`
- Bare `[Authorize]` on each action — see `JELLYFIN-INTEGRATION.md` §1.3
- Admin-only actions check `IsAdmin()` claim manually and return `Forbid()` if not admin

```csharp
public class ProvidersController : ControllerBase
{
    public ProvidersController(ProviderRegistry registry,
                               ILogger<ProvidersController> logger);
}
```

### `GET /CypherflixHub/Providers/Types` (admin)

Returns metadata for every registered provider type. Shape:

```json
[
  {
    "TypeId": "jellyseerr",
    "DisplayName": "Jellyseerr",
    "Description": "...",
    "IconUrl": "...",
    "SupportedMediaTypes": ["Movie", "TvShow"],
    "SupportedCapabilities": ["Search", "Index", "Request", "RequestStatus"],
    "ConfigSchema": [
      { "Key": "url", "Label": "URL", "Type": "Url", "Required": true, ... }
    ]
  },
  ...
]
```

### `GET /CypherflixHub/Providers` (admin)

Returns the configured instances from `Plugin.Instance!.Configuration.Providers[]`.
Same shape as stored, but secrets (any `Type=Password|ApiKey`) are masked
to `"***"` in the response. Pair with `Types` to render the form.

### `POST /CypherflixHub/Providers` (admin)

Body:
```json
{
  "Id": "<guid or omit for new>",
  "TypeId": "jellyseerr",
  "Name": "Movies (Jellyseerr)",
  "Enabled": true,
  "EnabledCapabilities": ["Search","Request","RequestStatus","Index"],
  "Config": [{ "Key": "url", "Value": "..." }, ...]
}
```

- Validate `TypeId` exists in registry.
- Validate every required `ConfigField` has a value.
- If `Id` matches existing instance, **merge** config (don't blow away
  masked secret values — if value is `"***"`, keep the old one).
- Save: append/replace in `Plugin.Instance!.Configuration.Providers[]`,
  call `Plugin.Instance!.SaveConfiguration()`.

### `DELETE /CypherflixHub/Providers/{id}` (admin)

Remove the instance with that Guid from the array, save.

### `POST /CypherflixHub/Providers/Test` (admin)

Body: same shape as the POST above (no `Id` needed — this is pre-save).

- Resolve provider, hydrate `ProviderConfig` from the body, call
  `provider.TestConnectionAsync(cfg, ct)`.
- Return the `TestResult` directly.

## Acceptance criteria

- Non-admin gets `403` on every endpoint.
- Saving an instance writes to `plugins/CypherflixHub.xml`.
- Reading after save returns the instance with secrets masked.
- Test endpoint returns `{Ok:true}` against a working provider.

---

Status: not-started
