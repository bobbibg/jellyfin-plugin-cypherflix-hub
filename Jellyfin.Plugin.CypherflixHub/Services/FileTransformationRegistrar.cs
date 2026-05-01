using System;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.CypherflixHub.Services;

/// <summary>
/// Registers our <c>index.html</c> transformation with the File Transformation
/// plugin (https://github.com/IAmParadox27/jellyfin-plugin-file-transformation).
///
/// File Transformation cannot be referenced as a NuGet/project dependency
/// because Jellyfin loads each plugin into a separate <see cref="AssemblyLoadContext"/>;
/// the only way to talk to it is via reflection. See JELLYFIN-INTEGRATION.md
/// §2 for the verbatim recipe.
///
/// Lifecycle:
/// 1. <see cref="StartAsync"/> kicks off a background poll task and returns
///    immediately — it MUST NOT block Jellyfin's host startup.
/// 2. The poll loop checks every <see cref="PollInterval"/> for the File
///    Transformation assembly to be loaded into any <see cref="AssemblyLoadContext"/>.
/// 3. On hit, we resolve the static <c>PluginInterface.RegisterTransformation</c>
///    method and invoke it with our payload.
/// 4. After <see cref="PollTimeout"/> with no hit, we log a warning and give
///    up — the plugin must continue to function (degraded: no UI tabs) when
///    File Transformation isn't installed.
/// </summary>
public sealed class FileTransformationRegistrar : IHostedService
{
    /// <summary>
    /// A stable, plugin-scoped GUID for this transformation. Distinct from the
    /// host plugin's own <see cref="Plugin.Id"/> (note the trailing <c>c</c> vs
    /// the plugin's <c>b</c>) so File Transformation can disambiguate
    /// registrations.
    /// </summary>
    private static readonly Guid TransformationId =
        Guid.Parse("c1f1e571-7ba8-4d6a-9e2b-3a4f0c5d7e8c");

    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(60);

    private readonly ILogger<FileTransformationRegistrar> _logger;
    private CancellationTokenSource? _cts;
    private Task? _pollTask;

    public FileTransformationRegistrar(ILogger<FileTransformationRegistrar> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        // Fire-and-track on the thread pool so host startup is not blocked.
        _pollTask = Task.Run(() => PollAndRegisterAsync(_cts.Token), _cts.Token);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_cts is not null)
        {
            try
            {
                _cts.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // Already stopped.
            }
        }

        if (_pollTask is not null)
        {
            try
            {
                await _pollTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Expected on shutdown.
            }
            catch (Exception ex)
            {
                // Don't propagate — host shutdown must not be blocked by us.
                _logger.LogDebug(ex, "FileTransformationRegistrar poll task ended with an exception during shutdown.");
            }
        }

        _cts?.Dispose();
        _cts = null;
        _pollTask = null;
    }

    private async Task PollAndRegisterAsync(CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                if (TryRegister())
                {
                    return;
                }

                if (DateTime.UtcNow >= deadline)
                {
                    _logger.LogWarning(
                        "File Transformation plugin assembly not found after {Timeout}s. " +
                        "Cypherflix Hub UI tabs will not be injected. Install the File " +
                        "Transformation plugin (GUID 5e87cc92-571a-4d8d-8d98-d2d4147f9f90) " +
                        "and restart Jellyfin.",
                        PollTimeout.TotalSeconds);
                    return;
                }

                try
                {
                    await Task.Delay(PollInterval, ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            // Last-resort guard: never crash the host because we couldn't
            // register a UI transformation.
            _logger.LogError(ex, "Unexpected error in FileTransformationRegistrar poll loop. Continuing without UI injection.");
        }
    }

    /// <summary>
    /// Attempt one registration. Returns true on success, false if File
    /// Transformation isn't loaded yet (caller should retry).
    /// </summary>
    private bool TryRegister()
    {
        // Reflection recipe — verbatim from JELLYFIN-INTEGRATION.md §2.2 (and
        // the File Transformation README).
        Assembly? fileTransformationAssembly =
            AssemblyLoadContext.All.SelectMany(x => x.Assemblies).FirstOrDefault(x =>
                x.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) ?? false);

        if (fileTransformationAssembly is null)
        {
            return false;
        }

        try
        {
            Type? pluginInterfaceType = fileTransformationAssembly.GetType(
                "Jellyfin.Plugin.FileTransformation.PluginInterface");

            if (pluginInterfaceType is null)
            {
                _logger.LogWarning(
                    "File Transformation assembly '{Assembly}' was found but the PluginInterface type was not. " +
                    "The plugin's API may have changed; skipping registration.",
                    fileTransformationAssembly.FullName);
                return true; // stop polling — it isn't going to fix itself
            }

            MethodInfo? register = pluginInterfaceType.GetMethod("RegisterTransformation");
            if (register is null)
            {
                _logger.LogWarning(
                    "File Transformation PluginInterface.RegisterTransformation method not found. " +
                    "The plugin's API may have changed; skipping registration.");
                return true;
            }

            var payload = BuildPayload();
            register.Invoke(null, new object?[] { payload });

            _logger.LogInformation(
                "Registered Cypherflix Hub index.html transformation with File Transformation " +
                "(transformation id {Id}).",
                TransformationId);
            return true;
        }
        catch (Exception ex)
        {
            // We found the assembly but invocation failed. Log and stop —
            // retrying won't help if the API itself is mismatched.
            _logger.LogError(ex,
                "Failed to register Cypherflix Hub transformation with File Transformation. " +
                "UI tabs will not be injected. Continuing.");
            return true;
        }
    }

    private static JObject BuildPayload()
    {
        // Shape: TransformationRegistrationPayload (JELLYFIN-INTEGRATION.md §2.3).
        // Property names use camelCase to match the upstream
        // [JsonPropertyName] attributes used by File Transformation's
        // ToObject<TransformationRegistrationPayload>() call.
        return JObject.FromObject(new
        {
            id = TransformationId,
            fileNamePattern = "index\\.html",
            callbackAssembly = typeof(IndexHtmlTransform).Assembly.FullName,
            callbackClass = typeof(IndexHtmlTransform).FullName,
            callbackMethod = nameof(IndexHtmlTransform.Transform)
        });
    }
}
