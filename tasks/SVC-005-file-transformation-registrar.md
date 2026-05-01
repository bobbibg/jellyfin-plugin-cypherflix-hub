# SVC-005 — FileTransformationRegistrar + IndexHtmlTransform

**Goal:** wire up the File Transformation plugin (mandatory dependency) so
our SPA bootstrap script gets injected into Jellyfin's `index.html`.

This is the trickiest service because it relies on reflection across plugin
load contexts. **Read `JELLYFIN-INTEGRATION.md` §2 in full before writing
a line of code.**

## Files

- `Services/FileTransformationRegistrar.cs` — `IHostedService` that
  registers the transformation on startup
- `Services/IndexHtmlTransform.cs` — static class containing the callback
  method invoked by File Transformation

## FileTransformationRegistrar

```csharp
public class FileTransformationRegistrar : IHostedService
{
    public FileTransformationRegistrar(ILogger<FileTransformationRegistrar> logger);

    Task IHostedService.StartAsync(CancellationToken ct);
    Task IHostedService.StopAsync(CancellationToken ct);
}
```

`StartAsync` runs the registration on a background task — File
Transformation plugin may not yet be loaded when this runs. Strategy:
poll for the plugin's assembly with a 5-sec interval, give up after 60s
with a warning log.

The registration payload (verbatim shape from `JELLYFIN-INTEGRATION.md` §2.3):

```csharp
var payload = JObject.FromObject(new
{
    id = Guid.Parse("c1f1e571-7ba8-4d6a-9e2b-3a4f0c5d7e8c"),  // distinct from plugin GUID
    fileNamePattern = "index\\.html",
    callbackAssembly = typeof(IndexHtmlTransform).Assembly.FullName,
    callbackClass = typeof(IndexHtmlTransform).FullName,
    callbackMethod = nameof(IndexHtmlTransform.Transform)
});
```

The reflection invocation is verbatim from the README:

```csharp
var ftAssembly = AssemblyLoadContext.All.SelectMany(x => x.Assemblies)
    .FirstOrDefault(x => x.FullName?.Contains(".FileTransformation") ?? false);
if (ftAssembly == null) { /* retry/log */ return; }

var pluginInterface = ftAssembly.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface");
pluginInterface?.GetMethod("RegisterTransformation")?.Invoke(null, new object?[] { payload });
```

## IndexHtmlTransform

```csharp
public static class IndexHtmlTransform
{
    private const string Marker = "<!-- CypherflixHub-Injected -->";
    private const string ScriptTag =
        Marker + "\n<script src=\"/CypherflixHub/Web/bootstrap.js\" defer></script>\n";

    /// <summary>
    /// File Transformation callback. Receives JObject { contents: "<file>" },
    /// returns the modified JObject (mutates `contents`).
    /// </summary>
    public static void Transform(JObject payload)
    {
        var contents = payload["contents"]?.Value<string>();
        if (string.IsNullOrEmpty(contents)) return;
        if (contents.Contains(Marker, StringComparison.Ordinal)) return; // idempotent

        var bodyClose = contents.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        if (bodyClose < 0) return;

        var patched = contents.Insert(bodyClose, ScriptTag);
        payload["contents"] = patched;
    }
}
```

The signature shape (`(JObject) -> void`, mutating the input) matches what
File Transformation invokes via reflection. **Confirm against File
Transformation source before shipping** — if the actual signature returns
the new string instead of mutating, adjust accordingly. The README is
ambiguous; cross-reference `Jellyfin.Plugin.FileTransformation.PluginInterface.cs`
in the upstream repo:
https://github.com/IAmParadox27/jellyfin-plugin-file-transformation/blob/main/src/Jellyfin.Plugin.FileTransformation/PluginInterface.cs

## DI wiring

In `PluginServiceRegistrator.cs`:

```csharp
serviceCollection.AddHostedService<Services.FileTransformationRegistrar>();
```

(Don't register `IndexHtmlTransform` — it's static.)

## Manifest dependency

Add to `manifest.json`:

```json
"dependencies": [
  { "name": "File Transformation",
    "guid": "<File Transformation plugin GUID — confirm from https://www.iamparadox.dev/jellyfin/plugins/manifest.json>" }
]
```

## Acceptance criteria

- Plugin starts cleanly when File Transformation is installed.
- Plugin starts cleanly with a warning log when File Transformation is
  NOT installed (don't crash).
- `/web/index.html` (after a Jellyfin restart) contains the
  `<!-- CypherflixHub-Injected -->` marker exactly once.
- `bootstrap.js` is reachable at `/CypherflixHub/Web/bootstrap.js` (needs
  API-005).

---

Status: needs-review

## Implementation notes (delta from spec)

- **Callback signature corrected:** the spec example showed `(JObject) -> void`
  with mutation. Verification of the upstream
  `Jellyfin.Plugin.FileTransformation.Helpers.TransformationHelper.ApplyTransformation`
  (https://raw.githubusercontent.com/IAmParadox27/jellyfin-plugin-file-transformation/main/src/Jellyfin.Plugin.FileTransformation/Helpers/TransformationHelper.cs)
  shows it actually invokes the callback as
  `(string)method.Invoke(null, new object?[] { paramObj })`, so the required
  signature is **`(JObject) -> string`**. `IndexHtmlTransform.Transform`
  returns the (possibly modified) contents instead of mutating. JELLYFIN-INTEGRATION.md §2.3
  was updated with the verified signature and the source URL.
- **Open question #1 closed.** File Transformation plugin GUID =
  `5e87cc92-571a-4d8d-8d98-d2d4147f9f90`. Recorded in `manifest.json`,
  JELLYFIN-INTEGRATION.md §2.5, and §8 (table marked closed).
- **Newtonsoft.Json added as a compile-only dependency** (`PrivateAssets=all`,
  `ExcludeAssets=runtime`) so we can construct/consume `JObject` against the
  same type the host's File Transformation plugin loads. The DLL is NOT
  shipped — verified absent from `bin/Debug/net8.0/`.
- **Graceful degradation:** if File Transformation isn't installed, the
  registrar logs a warning after 60s and the plugin keeps running (no UI
  tabs). Any reflection failure is caught and logged — never propagated.
