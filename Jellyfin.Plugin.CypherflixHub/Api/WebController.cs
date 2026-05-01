using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Api;

/// <summary>
/// Serves the embedded JS/CSS assets that power the Cypherflix Hub SPA tabs.
/// <list type="bullet">
///   <item><description><c>GET /CypherflixHub/Web/bootstrap.js</c>     — the bootstrap script injected into <c>index.html</c> by <see cref="Services.IndexHtmlTransform"/> (SVC-005).</description></item>
///   <item><description><c>GET /CypherflixHub/Web/styles.css</c>       — shared SPA stylesheet.</description></item>
///   <item><description><c>GET /CypherflixHub/Web/pages/{page}.js</c>  — per-tab page module (<c>discover</c>, <c>requests</c>, <c>calendar</c>, <c>admin</c>).</description></item>
/// </list>
/// All routes are <see cref="AllowAnonymousAttribute">anonymous</see> — content is the same for
/// every user; the page modules call authenticated APIs themselves via the global
/// <c>ApiClient</c> (see ARCHITECTURE.md §8.1).
/// </summary>
/// <remarks>
/// Embedded resources live under <c>Web/</c> in the project (csproj
/// <c>&lt;EmbeddedResource Include="Web\**\*" /&gt;</c>) and resolve to manifest names of the
/// form <c>Jellyfin.Plugin.CypherflixHub.Web.&lt;path-with-dots&gt;</c>
/// (see JELLYFIN-INTEGRATION.md §6.3). The actual asset files are produced by
/// downstream UI tasks (UI-001..UI-005); until they land, every route returns 404 —
/// that is the intended "not yet shipped" path, not an error.
/// </remarks>
[ApiController]
[Route("CypherflixHub/Web")]
[AllowAnonymous]
public class WebController : ControllerBase
{
    /// <summary>
    /// Whitelist of valid page names for <see cref="Page"/>. Anything outside this set is
    /// rejected with 404 — DO NOT use unfiltered user input in the resource path
    /// (path traversal / unintended resource serving).
    /// </summary>
    private static readonly HashSet<string> AllowedPages = new(StringComparer.OrdinalIgnoreCase)
    {
        "discover",
        "requests",
        "calendar",
        "admin"
    };

    private readonly ILogger<WebController> _logger;

    public WebController(ILogger<WebController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Serves <c>Web/bootstrap.js</c> — the script <see cref="Services.IndexHtmlTransform"/>
    /// (SVC-005) injects into <c>index.html</c>. URL: <c>/CypherflixHub/Web/bootstrap.js</c>.
    /// </summary>
    [HttpGet("bootstrap.js")]
    public ActionResult Bootstrap()
        => ServeEmbedded("Web.bootstrap.js", "application/javascript");

    /// <summary>
    /// Serves <c>Web/styles.css</c> — shared stylesheet for all SPA tabs.
    /// URL: <c>/CypherflixHub/Web/styles.css</c>.
    /// </summary>
    [HttpGet("styles.css")]
    public ActionResult Styles()
        => ServeEmbedded("Web.styles.css", "text/css");

    /// <summary>
    /// Serves a per-tab page module from <c>Web/pages/{page}.js</c>. The
    /// <paramref name="page"/> segment is whitelisted (see <see cref="AllowedPages"/>);
    /// any other value yields 404 without touching the resource path.
    /// URL: <c>/CypherflixHub/Web/pages/{page}.js</c>.
    /// </summary>
    /// <param name="page">One of <c>discover</c>, <c>requests</c>, <c>calendar</c>, <c>admin</c>.</param>
    [HttpGet("pages/{page}.js")]
    public ActionResult Page(string page)
    {
        if (string.IsNullOrEmpty(page) || !AllowedPages.Contains(page))
        {
            _logger.LogWarning("Rejected page module request for unknown page: {Page}", page);
            return NotFound();
        }

        // Lower-case for stable dotted resource path even though lookup itself is whitelisted.
        return ServeEmbedded($"Web.pages.{page.ToLowerInvariant()}.js", "application/javascript");
    }

    /// <summary>
    /// Resolves an embedded resource by its dotted path under the plugin namespace and streams
    /// it back with the given MIME type and a 5-minute browser cache.
    /// </summary>
    /// <param name="resourcePath">
    /// Dotted relative path under <c>Jellyfin.Plugin.CypherflixHub</c> — e.g.
    /// <c>Web.bootstrap.js</c> or <c>Web.pages.discover.js</c>.
    /// </param>
    /// <param name="contentType">MIME type for the response (e.g. <c>application/javascript</c>).</param>
    /// <returns>
    /// The resource as a <see cref="FileStreamResult"/>, or <see cref="NotFoundResult"/>
    /// if the embedded resource is not present in the assembly.
    /// </returns>
    private ActionResult ServeEmbedded(string resourcePath, string contentType)
    {
        Assembly assembly = typeof(Plugin).Assembly;
        string fullName = $"{typeof(Plugin).Namespace}.{resourcePath}";
        Stream? stream = assembly.GetManifestResourceStream(fullName);
        if (stream == null)
        {
            _logger.LogWarning("Embedded resource not found: {FullName}", fullName);
            return NotFound(fullName);
        }

        // 5 minutes — long enough to feel snappy; short enough for plugin updates to
        // propagate without users hard-refreshing. See API-005 task spec.
        Response.Headers["Cache-Control"] = "max-age=300";

        // FileStreamResult disposes the stream after writing — do NOT wrap in `using`.
        return File(stream, contentType);
    }
}
