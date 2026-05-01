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
/// Fan-out aggregator that powers the Requests tab.
/// <list type="bullet">
///   <item><description><see cref="GetForUserAsync"/> calls every provider
///     instance with the <see cref="Capability.RequestStatus"/> capability in
///     parallel, merges, and sorts by <see cref="RequestStatus.CreatedAt"/>
///     descending.</description></item>
///   <item><description><see cref="SubmitAsync"/> resolves a single
///     <see cref="ProviderInstance"/> by id and dispatches to its
///     <see cref="IMediaProvider.RequestAsync"/>.</description></item>
/// </list>
/// Each per-provider call is wrapped in a 5-second timeout (see
/// <see cref="AggregatorHelpers.InvokeWithTimeoutAsync{T}"/>) and any
/// exception or timeout drops that provider's contribution rather than
/// propagating — see ARCHITECTURE.md §6.
/// </summary>
public class RequestAggregator
{
    private readonly ProviderRegistry _registry;
    private readonly ILogger<RequestAggregator> _logger;

    public RequestAggregator(ProviderRegistry registry, ILogger<RequestAggregator> logger)
    {
        _registry = registry;
        _logger = logger;
    }

    /// <summary>
    /// Returns every <see cref="RequestStatus"/> the calling user has across
    /// every enabled provider instance with the
    /// <see cref="Capability.RequestStatus"/> capability. Result is sorted by
    /// <see cref="RequestStatus.CreatedAt"/> descending. A provider erroring
    /// out logs a warning and contributes an empty list.
    /// </summary>
    public async Task<IReadOnlyList<RequestStatus>> GetForUserAsync(string userId, CancellationToken ct)
    {
        PluginConfiguration? config = Plugin.Instance?.Configuration;
        ProviderInstance[] instances = config?.Providers ?? Array.Empty<ProviderInstance>();
        if (instances.Length == 0)
        {
            return Array.Empty<RequestStatus>();
        }

        List<Task<IReadOnlyList<RequestStatus>>> tasks = new();
        foreach (ProviderInstance instance in instances)
        {
            if (!instance.Enabled)
            {
                continue;
            }

            HashSet<Capability> capabilities = AggregatorHelpers.ParseCapabilities(instance.EnabledCapabilities);
            if (!capabilities.Contains(Capability.RequestStatus))
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

            // Capture the loop variable so each task closes over the right instance.
            ProviderInstance capturedInstance = instance;
            IMediaProvider capturedProvider = provider;
            tasks.Add(AggregatorHelpers.InvokeWithTimeoutAsync<IReadOnlyList<RequestStatus>>(
                _logger,
                capturedInstance,
                operation: nameof(IMediaProvider.GetRequestStatusesAsync),
                work: token => capturedProvider.GetRequestStatusesAsync(userId, cfg, token),
                emptyFallback: Array.Empty<RequestStatus>(),
                ct));
        }

        if (tasks.Count == 0)
        {
            return Array.Empty<RequestStatus>();
        }

        IReadOnlyList<RequestStatus>[] results = await Task.WhenAll(tasks).ConfigureAwait(false);

        return results
            .SelectMany(static r => r)
            .OrderByDescending(static r => r.CreatedAt)
            .ToArray();
    }

    /// <summary>
    /// Submits <paramref name="payload"/> to a single provider instance
    /// identified by <paramref name="providerInstanceId"/>. Returns
    /// <c>Ok=false</c> with a descriptive message if the instance is missing,
    /// disabled, or doesn't have the <see cref="Capability.Request"/>
    /// capability enabled. Otherwise the provider's own
    /// <see cref="RequestSubmissionResult"/> is returned verbatim — providers
    /// own their error semantics for the request flow per ARCHITECTURE.md
    /// §3.4.
    /// </summary>
    public Task<RequestSubmissionResult> SubmitAsync(
        Guid providerInstanceId,
        RequestPayload payload,
        CancellationToken ct)
    {
        PluginConfiguration? config = Plugin.Instance?.Configuration;
        ProviderInstance[] instances = config?.Providers ?? Array.Empty<ProviderInstance>();

        ProviderInstance? instance = instances.FirstOrDefault(i => i.Id == providerInstanceId);
        if (instance is null)
        {
            _logger.LogWarning(
                "Request submission rejected: provider instance {InstanceId} not found.",
                providerInstanceId);
            return Task.FromResult(new RequestSubmissionResult
            {
                Ok = false,
                Message = "Provider instance not found or request capability disabled"
            });
        }

        HashSet<Capability> capabilities = AggregatorHelpers.ParseCapabilities(instance.EnabledCapabilities);
        if (!instance.Enabled || !capabilities.Contains(Capability.Request))
        {
            _logger.LogWarning(
                "Request submission rejected: provider instance '{InstanceName}' ({InstanceId}) is disabled or lacks the Request capability.",
                instance.Name,
                instance.Id);
            return Task.FromResult(new RequestSubmissionResult
            {
                Ok = false,
                Message = "Provider instance not found or request capability disabled"
            });
        }

        IMediaProvider? provider = _registry.Get(instance.TypeId);
        if (provider is null)
        {
            _logger.LogWarning(
                "Request submission rejected: provider instance '{InstanceName}' ({InstanceId}) references unknown type '{TypeId}'.",
                instance.Name,
                instance.Id,
                instance.TypeId);
            return Task.FromResult(new RequestSubmissionResult
            {
                Ok = false,
                Message = "Provider instance not found or request capability disabled"
            });
        }

        ProviderConfig cfg = AggregatorHelpers.HydrateConfig(instance, capabilities);

        // Per spec: do NOT catch — the provider is contract-bound to handle
        // its own errors and translate them into a RequestSubmissionResult.
        return provider.RequestAsync(payload, cfg, ct);
    }
}
