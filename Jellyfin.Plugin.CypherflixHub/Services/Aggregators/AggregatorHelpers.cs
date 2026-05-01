using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Configuration;
using Jellyfin.Plugin.CypherflixHub.Core;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Services.Aggregators;

/// <summary>
/// Shared plumbing used by <see cref="RequestAggregator"/> and
/// <see cref="CalendarAggregator"/>. The same patterns are used by
/// <see cref="IndexerService"/> — capability parsing, config hydration, and
/// per-provider exception/timeout containment — but lifted here so the
/// aggregators stay focused on fan-out and merging.
/// </summary>
internal static class AggregatorHelpers
{
    /// <summary>
    /// The maximum time we will wait for ANY single provider call before we
    /// drop its contribution. Prevents one slow provider from holding up the
    /// whole aggregated response.
    /// </summary>
    public static readonly TimeSpan PerProviderTimeout = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Parses the string-typed <see cref="ProviderInstance.EnabledCapabilities"/>
    /// list into a <see cref="HashSet{T}"/> of <see cref="Capability"/> values.
    /// Unknown / unparseable entries are dropped silently.
    /// </summary>
    public static HashSet<Capability> ParseCapabilities(string[]? raw)
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
    /// Hydrates a <see cref="ProviderConfig"/> from a stored
    /// <see cref="ProviderInstance"/>. Field values come from
    /// <see cref="ProviderInstance.Config"/> (a list of KV pairs); duplicate
    /// keys keep the last-wins value.
    /// </summary>
    public static ProviderConfig HydrateConfig(ProviderInstance instance, HashSet<Capability> capabilities)
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
    /// Invokes <paramref name="work"/> with a per-call timeout and a try/catch
    /// that converts any exception (including timeout cancellation) into the
    /// supplied <paramref name="emptyFallback"/>. The outer
    /// <paramref name="ct"/> is honoured — a real shutdown still cancels.
    /// </summary>
    /// <remarks>
    /// Uses <see cref="CancellationTokenSource.CreateLinkedTokenSource(CancellationToken)"/>
    /// + <see cref="CancellationTokenSource.CancelAfter(TimeSpan)"/> so the
    /// dropped-task leak that <c>Task.WhenAny(task, Task.Delay)</c> would cause
    /// is avoided — the underlying provider call sees the cancellation and can
    /// abort cleanly.
    /// </remarks>
    public static async Task<T> InvokeWithTimeoutAsync<T>(
        ILogger logger,
        ProviderInstance instance,
        string operation,
        Func<CancellationToken, Task<T>> work,
        T emptyFallback,
        CancellationToken ct)
    {
        using CancellationTokenSource cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(PerProviderTimeout);

        try
        {
            return await work(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Real shutdown — propagate so callers can stop fanning out.
            throw;
        }
        catch (OperationCanceledException)
        {
            logger.LogWarning(
                "{Operation} timed out after {TimeoutSeconds}s for provider instance '{InstanceName}' ({InstanceId}, type {TypeId}); dropping its contribution.",
                operation,
                PerProviderTimeout.TotalSeconds,
                instance.Name,
                instance.Id,
                instance.TypeId);
            return emptyFallback;
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "{Operation} failed for provider instance '{InstanceName}' ({InstanceId}, type {TypeId}); dropping its contribution.",
                operation,
                instance.Name,
                instance.Id,
                instance.TypeId);
            return emptyFallback;
        }
    }
}
