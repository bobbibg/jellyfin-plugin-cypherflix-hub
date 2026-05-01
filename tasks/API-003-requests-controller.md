# API-003 — RequestsController

**Goal:** GET the calling user's requests, POST a new request.

## File

- `Api/RequestsController.cs`

## Routes

```
GET  /CypherflixHub/Requests
POST /CypherflixHub/Requests
```

`[Authorize]` — authed user.

### `GET`

Body: none. Returns `RequestStatus[]` from
`RequestAggregator.GetForUserAsync(userId, ct)`.

### `POST`

Body:
```json
{
  "ProviderInstanceId": "<guid>",
  "ExternalId": "<provider-side id>",
  "MediaType": "Movie",
  "Extras": { "key": "value" }
}
```

(`UserId` is derived from claims, not from the body.)

Behaviour:

1. Build `RequestPayload` with the calling user id.
2. `await _requestAggregator.SubmitAsync(providerInstanceId, payload, ct)`.
3. Return the `RequestSubmissionResult` as JSON. HTTP code:
   - 200 if `Ok=true`
   - 400 if `Ok=false` with `Message`

## Acceptance criteria

- Submitting a movie request to a Jellyseerr provider creates the request
  upstream and returns 200 with the new `RequestStatus`.
- GET returns the just-submitted request.

---

Status: needs-review
