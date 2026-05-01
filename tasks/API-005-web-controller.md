# API-005 — WebController

**Goal:** serve the embedded JS/CSS that powers the three tabs.

## File

- `Api/WebController.cs`

## Routes

All `[AllowAnonymous]` — content is the same for everyone, and pages call
authenticated APIs themselves via `ApiClient`.

```
GET /CypherflixHub/Web/bootstrap.js
GET /CypherflixHub/Web/styles.css
GET /CypherflixHub/Web/pages/{page}.js
```

`{page}` is one of `discover`, `requests`, `calendar`, `admin`.

## Behaviour

For each route, look up the matching `EmbeddedResource` and `File()` it back
with the right MIME type.

```csharp
private ActionResult ServeEmbedded(string resourcePath, string contentType)
{
    var assembly = typeof(Plugin).Assembly;
    var fullName = $"{typeof(Plugin).Namespace}.{resourcePath}";
    var stream = assembly.GetManifestResourceStream(fullName);
    if (stream == null) return NotFound(fullName);
    return File(stream, contentType);
}
```

Map:
- `bootstrap.js` → `Web.bootstrap.js`, `application/javascript`
- `styles.css` → `Web.styles.css`, `text/css`
- `pages/{page}.js` → `Web.pages.{page}.js`, `application/javascript`

## Cache headers

Set `Cache-Control: max-age=300` so the browser caches for 5 minutes —
shorter than typical CDN, long enough to feel snappy. Page reloads pick up
plugin updates within 5 minutes; admins can hard-refresh for instant
update.

## Acceptance criteria

- `curl /CypherflixHub/Web/bootstrap.js` returns the embedded JS.
- 404 for an unknown page name.
- Content-Type headers correct.

---

Status: needs-review
