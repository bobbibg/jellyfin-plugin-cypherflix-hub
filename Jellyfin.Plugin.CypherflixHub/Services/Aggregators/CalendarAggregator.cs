using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Configuration;
using Jellyfin.Plugin.CypherflixHub.Core;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Services.Aggregators;

/// <summary>
/// Fan-out aggregator that powers the Calendar tab. Calls every provider
/// instance with the <see cref="Capability.Calendar"/> capability in parallel,
/// merges the results, applies <see cref="CalendarQuery.TypesFilter"/>, and
/// sorts by <see cref="CalendarEntry.ReleaseDate"/> ascending.
///
/// Each per-provider call is wrapped in a 5-second timeout (see
/// <see cref="AggregatorHelpers.InvokeWithTimeoutAsync{T}"/>); any exception
/// or timeout drops that provider's contribution rather than propagating —
/// see ARCHITECTURE.md §6.
/// </summary>
public class CalendarAggregator
{
    private readonly ProviderRegistry _registry;
    private readonly ILogger<CalendarAggregator> _logger;

    public CalendarAggregator(ProviderRegistry registry, ILogger<CalendarAggregator> logger)
    {
        _registry = registry;
        _logger = logger;
    }

    /// <summary>
    /// Returns the merged calendar window from every enabled provider
    /// instance with the <see cref="Capability.Calendar"/> capability,
    /// filtered to the media types in <see cref="CalendarQuery.TypesFilter"/>
    /// when set, and sorted by ascending release date.
    /// </summary>
    public async Task<IReadOnlyList<CalendarEntry>> GetAsync(CalendarQuery query, CancellationToken ct)
    {
        PluginConfiguration? config = Plugin.Instance?.Configuration;
        ProviderInstance[] instances = config?.Providers ?? Array.Empty<ProviderInstance>();
        if (instances.Length == 0)
        {
            return Array.Empty<CalendarEntry>();
        }

        List<Task<IReadOnlyList<CalendarEntry>>> tasks = new();
        foreach (ProviderInstance instance in instances)
        {
            if (!instance.Enabled)
            {
                continue;
            }

            HashSet<Capability> capabilities = AggregatorHelpers.ParseCapabilities(instance.EnabledCapabilities);
            if (!capabilities.Contains(Capability.Calendar))
            {
                continue;
            }

            IMediaProvider? provider = _registry.Get(instance.TypeId);
            if (provider is null)
            {
                _logger.LogWarning(
                    "Provider instance '{InstanceName}' ({InstanceId}) references unknown type '{TypeId}'; skipping.",
                    instance.Name,
                    instance.Id,
                    instance.TypeId);
                continue;
            }

            ProviderConfig cfg = AggregatorHelpers.HydrateConfig(instance, capabilities);

            // Capture the loop variables so each task closes over the right instance.
            ProviderInstance capturedInstance = instance;
            IMediaProvider capturedProvider = provider;
            tasks.Add(AggregatorHelpers.InvokeWithTimeoutAsync<IReadOnlyList<CalendarEntry>>(
                _logger,
                capturedInstance,
                operation: nameof(IMediaProvider.GetCalendarAsync),
                work: token => capturedProvider.GetCalendarAsync(query, cfg, token),
                emptyFallback: Array.Empty<CalendarEntry>(),
                ct));
        }

        if (tasks.Count == 0)
        {
            return Array.Empty<CalendarEntry>();
        }

        IReadOnlyList<CalendarEntry>[] results = await Task.WhenAll(tasks).ConfigureAwait(false);

        IEnumerable<CalendarEntry> merged = results.SelectMany(static r => r);

        IReadOnlySet<MediaType>? typesFilter = query.TypesFilter;
        if (typesFilter is { Count: > 0 })
        {
            merged = merged.Where(e => typesFilter.Contains(e.MediaType));
        }

        return merged
            .OrderBy(static e => e.ReleaseDate)
            .ToArray();
    }
}
