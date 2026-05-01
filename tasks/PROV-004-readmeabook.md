# PROV-004 — ReadMeABook provider

**Goal:** implement `IMediaProvider` for ReadMeABook (audiobook discovery
+ request, with built-in SAB integration).

## Inputs

- ReadMeABook GitHub: search for the project (community fork — confirm URL
  during impl)
- Cypherflix homelab compose: `stacks/nas/docker-compose.fragment-books-stack.yaml`
  has the planned ReadMeABook config
- Compare to Jellyseerr's request flow — ReadMeABook is the audiobook analogue

## Files to create

- `Providers/ReadMeABook/ReadMeABookProvider.cs`
- `Providers/ReadMeABook/ReadMeABookClient.cs`

## Type metadata

| Member | Value |
|---|---|
| `TypeId` | `"readmeabook"` |
| `DisplayName` | `"ReadMeABook"` |
| `Description` | `"Audiobook discovery and request tool with built-in download client integration."` |
| `SupportedMediaTypes` | `[Audiobook]` |
| `SupportedCapabilities` | `[Search, Index, Request, RequestStatus]` |
| `IconUrl` | (look up the upstream logo URL during impl) |

### Config schema

| Key | Label | Type | Required | Default |
|---|---|---|---|---|
| `url` | "URL" | `Url` | yes | `http://192.168.1.165:<port>` |
| `api_key` | "API Key" | `ApiKey` | yes | — |
| `default_quality` | "Default quality preset" | `Select` | no | `m4b` |

## Behaviour

**Note:** the exact ReadMeABook API surface is not yet documented in the
homelab repo. The first agent on this task should:

1. Stand up a real ReadMeABook instance (follow `BOOKS-STACK-SETUP.md`)
2. Inspect its API via the running container (`/api/...` endpoints, Swagger
   if available)
3. Document the endpoints used here
4. Then implement the provider

If an agent picks this up before ReadMeABook is deployed, **stop and ping
Bobbi to deploy it first**, or pivot to a stub that returns empty results
for every operation (so the rest of the build doesn't block on this).

## Acceptance criteria

- TestConnection returns ok against a real instance.
- Search returns audiobook results.
- Request creates a download in ReadMeABook's queue.
- IndexAsync returns the user's wanted/library list.

---

Status: not-started — BLOCKED on ReadMeABook deployment + API docs
