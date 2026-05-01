# API-004 — CalendarController

**Goal:** GET upcoming releases in a date window.

## File

- `Api/CalendarController.cs`

## Route

```
GET /CypherflixHub/Calendar?start=<iso>&end=<iso>&types=<csv>
```

`[Authorize]` — authed user.

Defaults: `start = today`, `end = today + 30 days` if not given.

## Behaviour

1. Parse query params.
2. Build `CalendarQuery { Start, End, TypesFilter, UserId }`.
3. `await _calendarAggregator.GetAsync(query, ct)`.
4. Return the array.

## Acceptance criteria

- Returns Sonarr/Radarr upcoming entries (via Jellyseerr provider) for the
  next 30 days.
- `?types=Book` filters to book releases only.
- Sorted by `ReleaseDate` ascending.

---

Status: needs-review
