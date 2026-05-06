using System;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.CypherflixHub.Api;

/// <summary>
/// Serves embedded JS/CSS for the Cypherflix Hub UI.
///   GET /CypherflixHub/Web/bootstrap.js          — entry script
///   GET /CypherflixHub/Web/styles.css            — shared stylesheet
///   GET /CypherflixHub/Web/pages/{page}.js       — any page module
///
/// The embedded-resource lookup itself acts as the safety check: only files
/// that were bundled into the assembly at build time can be served. The
/// regex on `page` blocks path-traversal attempts.
/// </summary>
[ApiController]
[Route("CypherflixHub/Web")]
[AllowAnonymous]
public class WebController : ControllerBase
{
    private static readonly Regex SafePageName = new("^[a-zA-Z0-9_-]+$", RegexOptions.Compiled);

    [HttpGet("bootstrap.js")]
    public ActionResult Bootstrap() => ServeEmbedded("Web.bootstrap.js", "application/javascript");

    [HttpGet("styles.css")]
    public ActionResult Styles() => ServeEmbedded("Web.styles.css", "text/css");

    [HttpGet("pages/{page}.js")]
    public ActionResult Page(string page)
    {
        if (string.IsNullOrEmpty(page) || !SafePageName.IsMatch(page))
        {
            return NotFound();
        }
        return ServeEmbedded($"Web.pages.{page}.js", "application/javascript");
    }

    private ActionResult ServeEmbedded(string suffix, string contentType)
    {
        var asm = typeof(WebController).Assembly;
        var resourceName = $"{typeof(WebController).Namespace!.Replace(".Api", "", StringComparison.Ordinal)}.{suffix}";
        // Resource names look like: Jellyfin.Plugin.CypherflixHub.Web.bootstrap.js
        using var stream = asm.GetManifestResourceStream(resourceName);
        if (stream is null) return NotFound();
        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        // Plugin JS/CSS changes whenever the plugin DLL is updated; tell the
        // browser never to cache so stale modules don't survive a plugin
        // rebuild. The files are tiny (10-30 KB) so re-fetching per-page is
        // fine.
        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";
        return File(ms.ToArray(), contentType);
    }
}
