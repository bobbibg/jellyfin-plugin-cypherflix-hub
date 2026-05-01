using System;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.CypherflixHub.Services;

/// <summary>
/// Static callback target invoked by the File Transformation plugin via
/// reflection. See JELLYFIN-INTEGRATION.md §2 for the registration recipe and
/// the upstream invocation site:
/// https://raw.githubusercontent.com/IAmParadox27/jellyfin-plugin-file-transformation/main/src/Jellyfin.Plugin.FileTransformation/Helpers/TransformationHelper.cs
///
/// Per <c>TransformationHelper.ApplyTransformation</c>, File Transformation
/// builds a <see cref="JObject"/> with a single <c>contents</c> property,
/// converts it to the type of the callback's first parameter via
/// <c>obj.ToObject(parameterType)</c>, then casts the return value to
/// <see cref="string"/>:
///
/// <code>
/// transformedString = (string)method.Invoke(null, new object?[] { paramObj })!;
/// </code>
///
/// So the required signature is <c>(JObject) -&gt; string</c> (NOT void/mutating —
/// the README is ambiguous and the JELLYFIN-INTEGRATION.md §2.3 phrasing is
/// the correct one).
/// </summary>
public static class IndexHtmlTransform
{
    /// <summary>
    /// Marker comment used to make the transformation idempotent — if File
    /// Transformation re-invokes the callback over already-patched markup we
    /// must not inject the script tag a second time.
    /// </summary>
    public const string Marker = "<!-- CypherflixHub-Injected -->";

    /// <summary>
    /// The script tag we splice in immediately before the closing
    /// <c>&lt;/body&gt;</c>. Loaded with <c>defer</c> so the document parses
    /// fully before the SPA bootstrap runs.
    /// </summary>
    private const string ScriptTag =
        Marker + "\n<script src=\"/CypherflixHub/Web/bootstrap.js\" defer></script>\n";

    /// <summary>
    /// File Transformation callback.
    /// </summary>
    /// <param name="payload">A <see cref="JObject"/> with a <c>contents</c>
    /// property containing the raw <c>index.html</c> source.</param>
    /// <returns>The (possibly modified) file contents.</returns>
    public static string Transform(JObject payload)
    {
        if (payload is null)
        {
            return string.Empty;
        }

        var contents = payload["contents"]?.Value<string>();
        if (string.IsNullOrEmpty(contents))
        {
            return contents ?? string.Empty;
        }

        // Idempotent — never inject twice.
        if (contents.Contains(Marker, StringComparison.Ordinal))
        {
            return contents;
        }

        var bodyClose = contents.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        if (bodyClose < 0)
        {
            // Defensive: if the file shape is unexpected, return it unmodified
            // rather than corrupt it.
            return contents;
        }

        return contents.Insert(bodyClose, ScriptTag);
    }
}
