using System;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.CypherflixHub.Api;

/// <summary>
/// Serves the v4.0 Vite-built JS/CSS bundle plus the HTML fragments that
/// Plugin Pages mounts inside Jellyfin's <c>.userPluginSettingsContainer</c>.
///
/// Routes:
///   <list type="bullet">
///     <item><c>GET /CypherflixHub/Web/bundle.js</c>  — hashed JS bundle (resolved from manifest)</item>
///     <item><c>GET /CypherflixHub/Web/bundle.css</c> — hashed CSS bundle (resolved from manifest)</item>
///     <item><c>GET /CypherflixHub/discover</c>      — Plugin Pages fragment (data-page=discover)</item>
///     <item><c>GET /CypherflixHub/queue</c>         — Plugin Pages fragment (data-page=queue)</item>
///     <item><c>GET /CypherflixHub/following</c>     — Plugin Pages fragment (data-page=following)</item>
///     <item><c>GET /CypherflixHub/details/{kind}/{sourceId}</c> — fragment (data-page=detail)</item>
///   </list>
///
/// The Vite build embeds three files into the assembly under the
/// <c>Web.dist.</c> resource prefix:
///   <list type="bullet">
///     <item><c>manifest.json</c>     — Vite manifest mapping logical entries to hashed filenames</item>
///     <item><c>cypherflix-hub.[hash].js</c></item>
///     <item><c>cypherflix-hub.[hash].css</c></item>
///   </list>
///
/// The fragment routes are <c>[AllowAnonymous]</c> because Plugin Pages
/// invokes them via <c>ApiClient.ajax</c> without forwarding the
/// <c>Authorization</c> header. Authentication for the page contents
/// happens upstream (the user must already be logged in to be inside
/// Jellyfin's settings UI), and the fragments contain no secrets.
/// </summary>
[ApiController]
[Route("CypherflixHub")]
[AllowAnonymous]
public class WebController : ControllerBase
{
    /// <summary>
    /// Resource prefix where Vite outputs are embedded. The csproj has
    /// <c>&lt;EmbeddedResource Include="Web/dist/**" /&gt;</c> which produces
    /// resource names like <c>Jellyfin.Plugin.CypherflixHub.Web.dist.manifest.json</c>.
    /// </summary>
    private const string DistResourcePrefix = "Jellyfin.Plugin.CypherflixHub.Web.dist.";

    /// <summary>
    /// Cache of resolved bundle filenames (without dir prefix). Read once
    /// from <c>manifest.json</c> at first request; stays valid for the
    /// lifetime of the loaded DLL.
    /// </summary>
    private static readonly ConcurrentDictionary<string, string> BundleNameCache = new();

    [HttpGet("Web/bundle.js")]
    public IActionResult BundleJs() => ServeBundle("js", "application/javascript; charset=utf-8");

    [HttpGet("Web/bundle.css")]
    public IActionResult BundleCss() => ServeBundle("css", "text/css; charset=utf-8");

    [HttpGet("discover")]
    public IActionResult Discover() => Fragment("discover");

    [HttpGet("queue")]
    public IActionResult Queue() => Fragment("queue");

    [HttpGet("following")]
    public IActionResult Following() => Fragment("following");

    [HttpGet("details/{kind}/{sourceId}")]
    public IActionResult Details(string kind, string sourceId)
    {
        // Pass the kind + sourceId down to the fragment as data-* attrs so
        // the page module can read them without parsing the URL.
        return Fragment("detail", new { kind, sourceId });
    }

    private IActionResult Fragment(string pageKey, object? extraDataAttrs = null)
    {
        var jsHref = $"/CypherflixHub/Web/bundle.js?v={ResolveVersion()}";
        var cssHref = $"/CypherflixHub/Web/bundle.css?v={ResolveVersion()}";

        var dataAttrs = new StringBuilder();
        dataAttrs.Append($" data-page=\"{HtmlAttr(pageKey)}\"");
        if (extraDataAttrs is not null)
        {
            foreach (var prop in extraDataAttrs.GetType().GetProperties())
            {
                var value = prop.GetValue(extraDataAttrs)?.ToString() ?? string.Empty;
                // Convert PascalCase or camelCase property names to kebab-case
                // for HTML data-* attribute conventions.
                var attr = ToKebab(prop.Name);
                dataAttrs.Append(" data-cypherflix-")
                    .Append(attr)
                    .Append("=\"")
                    .Append(HtmlAttr(value))
                    .Append('"');
            }
        }

        var html =
            $"<link rel=\"stylesheet\" href=\"{cssHref}\" />\n" +
            $"<script type=\"module\" src=\"{jsHref}\"></script>\n" +
            $"<div id=\"cypherflix-hub-root\"{dataAttrs}></div>\n";

        SetNoCacheHeaders();
        return Content(html, "text/html; charset=utf-8");
    }

    private IActionResult ServeBundle(string ext, string contentType)
    {
        var resourceName = ResolveBundleResource(ext);
        if (resourceName is null) return NotFound();

        var asm = typeof(WebController).Assembly;
        using var stream = asm.GetManifestResourceStream(resourceName);
        if (stream is null) return NotFound();
        using var ms = new MemoryStream();
        stream.CopyTo(ms);

        // The bundle filename is content-hashed, so the URL is effectively
        // immutable. But we serve it from a stable URL (`bundle.js`) for
        // simplicity, so use no-store to keep the browser honest across
        // plugin upgrades. Files are tiny.
        SetNoCacheHeaders();
        return File(ms.ToArray(), contentType);
    }

    private static string? ResolveBundleResource(string ext)
    {
        return BundleNameCache.GetOrAdd(ext, key => LoadBundleResourceName(key) ?? string.Empty)
            is { Length: > 0 } cached ? cached : null;
    }

    private static string? LoadBundleResourceName(string ext)
    {
        var asm = typeof(WebController).Assembly;
        var manifestResource = DistResourcePrefix + "manifest.json";

        // Vite manifest format (manifest:true): keys are entry source paths,
        // values are objects with `file` (the hashed output filename).
        // Example:
        //   {
        //     "Web/bootstrap.ts": {
        //       "file": "cypherflix-hub.A1B2C3D4.js",
        //       "css": ["cypherflix-hub.E5F6G7H8.css"],
        //       "isEntry": true
        //     }
        //   }
        try
        {
            using var stream = asm.GetManifestResourceStream(manifestResource);
            if (stream is null)
            {
                // Fall back to any resource matching the extension — covers
                // the case where Vite ran with manifest disabled.
                return FindByExtension(asm, ext);
            }
            using var sr = new StreamReader(stream);
            var json = JObject.Parse(sr.ReadToEnd());

            // Find the entry whose isEntry==true.
            JObject? entry = null;
            foreach (var prop in json.Properties())
            {
                if (prop.Value is JObject obj && obj.Value<bool?>("isEntry") == true)
                {
                    entry = obj;
                    break;
                }
            }
            if (entry is null) return FindByExtension(asm, ext);

            string? hashedName;
            if (string.Equals(ext, "js", StringComparison.Ordinal))
            {
                hashedName = entry.Value<string>("file");
            }
            else
            {
                // CSS lives under `css` array on the entry record.
                var cssArray = entry.Value<JArray>("css");
                hashedName = cssArray?.OfType<JValue>().FirstOrDefault()?.Value<string>();
            }

            if (string.IsNullOrEmpty(hashedName)) return FindByExtension(asm, ext);
            // hashedName is e.g. "assets/cypherflix-hub.A1B2C3D4.js" — translate
            // path separators into the resource-name dot convention.
            var rel = hashedName!.Replace('/', '.').Replace('\\', '.');
            return DistResourcePrefix + rel;
        }
        catch
        {
            return FindByExtension(asm, ext);
        }
    }

    private static string? FindByExtension(Assembly asm, string ext)
    {
        var suffix = "." + ext;
        return asm.GetManifestResourceNames()
            .FirstOrDefault(n => n.StartsWith(DistResourcePrefix, StringComparison.Ordinal) && n.EndsWith(suffix, StringComparison.Ordinal));
    }

    private static string ResolveVersion()
    {
        // Use the assembly's informational version so the cache-buster query
        // string flips on every plugin rebuild even if the hashed filenames
        // happen to match (rare).
        var asm = typeof(WebController).Assembly;
        var info = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>();
        return info?.InformationalVersion ?? asm.GetName().Version?.ToString() ?? "v4";
    }

    private void SetNoCacheHeaders()
    {
        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";
    }

    private static string HtmlAttr(string s)
    {
        return s
            .Replace("&", "&amp;", StringComparison.Ordinal)
            .Replace("\"", "&quot;", StringComparison.Ordinal)
            .Replace("<", "&lt;", StringComparison.Ordinal)
            .Replace(">", "&gt;", StringComparison.Ordinal);
    }

    private static string ToKebab(string s)
    {
        if (string.IsNullOrEmpty(s)) return s;
        var sb = new StringBuilder(s.Length + 4);
        for (int i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (i > 0 && char.IsUpper(c))
            {
                sb.Append('-');
            }
            sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }
}
