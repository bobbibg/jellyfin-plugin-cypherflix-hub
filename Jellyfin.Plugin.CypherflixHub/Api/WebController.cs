using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.CypherflixHub.Api;

/// <summary>
/// Serves embedded JS/CSS for the Cypherflix Hub UI.
///   GET /CypherflixHub/Web/bootstrap.js   — entry script (injected into index.html)
///   GET /CypherflixHub/Web/styles.css     — shared stylesheet
///   GET /CypherflixHub/Web/pages/{page}.js — per-tab module (manage, discover, api)
/// </summary>
[ApiController]
[Route("CypherflixHub/Web")]
[AllowAnonymous]
public class WebController : ControllerBase
{
    private static readonly HashSet<string> AllowedPages = new(StringComparer.OrdinalIgnoreCase)
    {
        "manage",
        "discover",
        "api",
    };

    [HttpGet("bootstrap.js")]
    public ActionResult Bootstrap() => ServeEmbedded("Web.bootstrap.js", "application/javascript");

    [HttpGet("styles.css")]
    public ActionResult Styles() => ServeEmbedded("Web.styles.css", "text/css");

    [HttpGet("pages/{page}.js")]
    public ActionResult Page(string page)
    {
        if (string.IsNullOrEmpty(page) || !AllowedPages.Contains(page))
        {
            return NotFound();
        }
        return ServeEmbedded($"Web.pages.{page.ToLowerInvariant()}.js", "application/javascript");
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
        return File(ms.ToArray(), contentType);
    }
}
