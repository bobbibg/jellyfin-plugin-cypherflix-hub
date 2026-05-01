using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Configuration;
using Jellyfin.Plugin.CypherflixHub.Core;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Services;

/// <summary>
/// Background service that periodically calls <see cref="IMediaProvider.IndexAsync"/>
/// on every configured + enabled provider instance whose
/// <see cref="ProviderInstance.EnabledCapabilities"/> contains the string form of
/// <see cref="Capability.Index"/>, and applies the resulting <see cref="IndexBatch"/>
/// to Meilisearch via <see cref="MeilisearchClient"/>.
///
/// <para>
/// Lifecycle:
/// <list type="number">
///   <item><description><see cref="StartAsync"/> kicks off a background <see cref="Task"/>
///     and returns immediately so it does not block Jellyfin's host startup.</description></item>
///   <item><description>The loop runs an immediate first pass on startup, then sleeps
///     for <see cref="PluginConfiguration.IndexIntervalMinutes"/> minutes between passes
///     (re-read each iteration so admin edits take effect without a restart).</description></item>
///   <item><description>Per-instance failures are caught and logged; the loop continues
///     processing the rest of the instances and remains alive across iterations.</description></item>
///   <item><description><see cref="StopAsync"/> cancels the loop and awaits it with a
///     short bounded timeout.</description></item>
/// </list>
/// </para>
///
/// <para>See ARCHITECTURE.md §5.3 (indexer) and §9 (lifecycle), and
/// <c>tasks/SVC-002-indexer-service.md</c> for the full spec.</para>
/// </summary>
public sealed class IndexerService : IHostedService, IDisposable
{
    /// <summary>How long <see cref="StopAsync"/> waits for the loop to drain before giving up.</summary>
    private static readonly TimeSpan StopTimeout = TimeSpan.FromSeconds(5);

    private readonly ProviderRegistry _registry;
    private readonly MeilisearchClient _meili;
    private readonly ILogger<IndexerService> _logger;

    /// <summary>
    /// In-memory map of <see cref="ProviderInstance.Id"/> → time of the last
    /// successful index pass start. Passed to providers as the <c>since</c>
    /// argument so they can return deltas where supported. First run is
    /// <c>null</c>. Not persisted: on restart we redo a full pass — Meilisearch
    /// dedupes by document id so this is cheap.
    /// </summary>
    private readonly Dictionary<Guid, DateTime?> _lastRun = new();

    private CancellationTokenSource? _cts;
    private Task? _loopTask;
    private bool _disposed;

    public IndexerService(
        ProviderRegistry registry,
        MeilisearchClient meili,
        ILogger<IndexerService> logger)
    {
        _registry = registry;
        _meili = meili;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        // Fire-and-track on the thread pool so host startup is NOT blocked.
        // The first pass runs inside the loop (see RunLoopAsync) — per spec
        // "It also runs once on startup".
        _loopTask = Task.Run(() => RunLoopAsync(_cts.Token), _cts.Token);

        _logger.LogDebug("IndexerService started.");
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogDebug("IndexerService stopping.");

        if (_cts is not null)
        {
            try
            {
                _cts.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // Already stopped — fine.
            }
        }

        if (_loopTask is not null)
        {
            // Bounded wait so a misbehaving provider can't hold up Jellyfin shutdown.
            Task delay = Task.Delay(StopTimeout, cancellationToken);
            try
            {
                Task completed = await Task.WhenAny(_loopTask, delay).ConfigureAwait(false);
                if (completed != _loopTask)
                {
                    _logger.LogWarning(
                        "IndexerService loop did not complete within {TimeoutSeconds}s of cancellation; abandoning wait.",
                        StopTimeout.TotalSeconds);
                }
                else
                {
                    // Surface terminal exceptions (other than the expected cancellation) at debug.
                    await _loopTask.ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
                // Expected when the loop exits via the cancellation token.
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "IndexerService loop ended with an exception during shutdown.");
            }
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _cts?.Dispose();
        _cts = null;
        _loopTask = null;
    }

    /// <summary>
    /// The main loop: run a pass, then sleep for the configured interval, repeat.
    /// </summary>
    private async Task RunLoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    await RunPassAsync(ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    // Cancellation propagated from the inner work — exit cleanly.
                    return;
                }
                catch (Exception ex)
                {
                    // RunPassAsync is supposed to swallow per-instance exceptions
                    // already; this is a last-resort guard so any other unexpected
                    // failure (e.g. reading config) doesn't kill the loop.
                    _logger.LogError(ex, "Unexpected error during indexer pass; will retry on next interval.");
                }

                TimeSpan delay = ComputeNextDelay();
                try
                {
                    await Task.Delay(delay, ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    // Shutdown requested mid-sleep — exit cleanly.
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            // Last-resort guard: never let an exception escape the background task
            // unobserved.
            _logger.LogError(ex, "IndexerService loop terminated unexpectedly.");
        }
    }

    /// <summary>
    /// Reads a snapshot of the plugin configuration and runs one indexing pass
    /// across every enabled provider instance with the <see cref="Capability.Index"/>
    /// capability. Per-instance failures are logged and swallowed so one bad
    /// instance can't take down the rest.
    /// </summary>
    private async Task RunPassAsync(CancellationToken ct)
    {
        PluginConfiguration? config = Plugin.Instance?.Configuration;
        if (config is null)
        {
            _logger.LogDebug("Plugin configuration not yet available; skipping indexer pass.");
            return;
        }

        ProviderInstance[] instances = config.Providers ?? Array.Empty<ProviderInstance>();
        if (instances.Length == 0)
        {
            _logger.LogDebug("No provider instances configured; skipping indexer pass.");
            return;
        }

        foreach (ProviderInstance instance in instances)
        {
            if (ct.IsCancellationRequested)
            {
                return;
            }

            if (!instance.Enabled)
            {
                continue;
            }

            HashSet<Capability> capabilities = ParseCapabilities(instance.EnabledCapabilities);
            if (!capabilities.Contains(Capability.Index))
            {
                continue;
            }

            try
            {
                await RunInstanceAsync(instance, capabilities, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Cooperative shutdown — bubble up so the loop exits cleanly.
                throw;
            }
            catch (Exception ex)
            {
                // Per-spec hard rule: a single instance MUST NOT crash the loop.
                _logger.LogError(
                    ex,
                    "Indexing failed for provider instance '{InstanceName}' ({InstanceId}, type {TypeId}); continuing with remaining instances.",
                    instance.Name,
                    instance.Id,
                    instance.TypeId);
            }
        }
    }

    /// <summary>
    /// Index one provider instance: resolve the provider, hydrate its config,
    /// fetch the batch, ensure the Meilisearch index exists, and apply the batch.
    /// </summary>
    private async Task RunInstanceAsync(
        ProviderInstance instance,
        HashSet<Capability> capabilities,
        CancellationToken ct)
    {
        IMediaProvider? provider = _registry.Get(instance.TypeId);
        if (provider is null)
        {
            _logger.LogWarning(
                "Provider instance '{InstanceName}' ({InstanceId}) references unknown type '{TypeId}'; skipping.",
                instance.Name,
                instance.Id,
                instance.TypeId);
            return;
        }

        ProviderConfig cfg = HydrateConfig(instance, capabilities);

        // Capture the pass-start time BEFORE calling IndexAsync so any documents
        // written upstream during the run are still picked up by the NEXT pass's
        // delta query. This is the standard high-water-mark pattern.
        DateTime passStartUtc = DateTime.UtcNow;
        DateTime? since = _lastRun.TryGetValue(instance.Id, out DateTime? lastRun) ? lastRun : null;

        _logger.LogDebug(
            "Indexing provider instance '{InstanceName}' ({InstanceId}, type {TypeId}); since={Since}.",
            instance.Name,
            instance.Id,
            instance.TypeId,
            since);

        IndexBatch batch = await provider.IndexAsync(since, cfg, ct).ConfigureAwait(false);

        await _meili.EnsureIndexAsync(instance.TypeId, instance.Id, ct).ConfigureAwait(false);
        await _meili.ApplyAsync(instance.TypeId, instance.Id, batch, ct).ConfigureAwait(false);

        _lastRun[instance.Id] = passStartUtc;

        _logger.LogInformation(
            "Indexed provider instance '{InstanceName}' ({InstanceId}, type {TypeId}): {DocumentCount} document(s){DeleteSuffix}{ReplaceSuffix}.",
            instance.Name,
            instance.Id,
            instance.TypeId,
            batch.Documents.Count,
            batch.DeleteIds is { Count: > 0 } ? $", {batch.DeleteIds.Count} deletion(s)" : string.Empty,
            batch.Replace ? ", replace=true" : string.Empty);
    }

    /// <summary>
    /// Hydrates a <see cref="ProviderConfig"/> from a stored
    /// <see cref="ProviderInstance"/>. Field values come from
    /// <see cref="ProviderInstance.Config"/> (serialised as a list of KV pairs);
    /// duplicate keys keep the last-wins value.
    /// </summary>
    private static ProviderConfig HydrateConfig(ProviderInstance instance, HashSet<Capability> capabilities)
    {
        Dictionary<string, string> fields = new(StringComparer.Ordinal);
        ConfigEntry[] entries = instance.Config ?? Array.Empty<ConfigEntry>();
        foreach (ConfigEntry entry in entries)
        {
            if (string.IsNullOrEmpty(entry.Key))
            {
                continue;
            }

            fields[entry.Key] = entry.Value ?? string.Empty;
        }

        return new ProviderConfig
        {
            InstanceId = instance.Id,
            InstanceName = instance.Name,
            EnabledCapabilities = capabilities,
            Fields = fields
        };
    }

    /// <summary>
    /// Parses the string-typed <see cref="ProviderInstance.EnabledCapabilities"/>
    /// list into a <see cref="HashSet{T}"/> of <see cref="Capability"/> values.
    /// Unknown / unparseable entries are dropped silently — they're admin-side
    /// data whose validation is the UI's responsibility.
    /// </summary>
    private static HashSet<Capability> ParseCapabilities(string[]? raw)
    {
        HashSet<Capability> set = new();
        if (raw is null)
        {
            return set;
        }

        foreach (string s in raw)
        {
            if (Enum.TryParse(s, ignoreCase: true, out Capability cap))
            {
                set.Add(cap);
            }
        }

        return set;
    }

    /// <summary>
    /// Re-reads <see cref="PluginConfiguration.IndexIntervalMinutes"/> on each
    /// iteration so admin edits take effect without a restart. Floors the value
    /// at 1 minute to defend against bad config (0 / negative would mean a
    /// hot-spin loop).
    /// </summary>
    private static TimeSpan ComputeNextDelay()
    {
        int minutes = Plugin.Instance?.Configuration?.IndexIntervalMinutes ?? 60;
        if (minutes < 1)
        {
            minutes = 1;
        }

        return TimeSpan.FromMinutes(minutes);
    }
}
