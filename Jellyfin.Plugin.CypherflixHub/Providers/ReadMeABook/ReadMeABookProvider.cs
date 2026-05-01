// TODO(PROV-004): replace stub with real implementation once ReadMeABook is deployed and its API is documented.

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Core;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Providers.ReadMeABook;

/// <summary>
/// STUB implementation of <see cref="IMediaProvider"/> for ReadMeABook.
///
/// ReadMeABook is not yet deployed in the homelab and its HTTP API surface is
/// undocumented at the time of writing. Per the PROV-004 task spec
/// ("If an agent picks this up before ReadMeABook is deployed … pivot to a stub
/// that returns empty results for every operation, so the rest of the build
/// doesn't block on this") this class:
///
/// - Returns empty collections / not-ok results for every per-instance operation.
/// - Logs a single warning the first time the stub is exercised so admins know
///   the provider is wired but inert.
/// - Still advertises real type metadata (TypeId, ConfigSchema, capabilities)
///   so the admin UI lists it correctly and a future replacement only changes
///   method bodies, not registration.
///
/// Replace with a real implementation when the upstream API is available — see
/// <c>tasks/PROV-004-readmeabook.md</c> for acceptance criteria.
/// </summary>
public sealed class ReadMeABookProvider : IMediaProvider
{
    // Field keys — kept private constants so the schema and any future call
    // sites can never drift out of sync.
    private const string FieldUrl = "url";
    private const string FieldApiKey = "api_key";
    private const string FieldDefaultQuality = "default_quality";

    private const string StubMessage =
        "ReadMeABook not yet deployed; provider is a stub. See tasks/PROV-004-readmeabook.md.";

    private readonly ILogger<ReadMeABookProvider> _logger;

    /// <summary>
    /// One-time warning latch — the stub is harmless but spamming the log on
    /// every search/index tick adds no value. The first invocation logs; the
    /// rest stay silent.
    /// </summary>
    private static int _warned;

    public ReadMeABookProvider(ILogger<ReadMeABookProvider> logger)
    {
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    // Type metadata
    // -------------------------------------------------------------------------

    public string TypeId => "readmeabook";

    public string DisplayName => "ReadMeABook";

    public string Description =>
        "Audiobook discovery and request tool with built-in download client integration.";

    public string? IconUrl => null;

    public IReadOnlyList<MediaType> SupportedMediaTypes { get; } = new[] { MediaType.Audiobook };

    public IReadOnlyList<Capability> SupportedCapabilities { get; } = new[]
    {
        Capability.Search,
        Capability.Index,
        Capability.Request,
        Capability.RequestStatus
    };

    public IReadOnlyList<ConfigField> ConfigSchema { get; } = new[]
    {
        new ConfigField
        {
            Key = FieldUrl,
            Label = "URL",
            Type = ConfigFieldType.Url,
            Required = true,
            Default = "http://192.168.1.165",
            Description = "Internal LAN URL of the ReadMeABook instance"
        },
        new ConfigField
        {
            Key = FieldApiKey,
            Label = "API Key",
            Type = ConfigFieldType.ApiKey,
            Required = true,
            Description = "ReadMeABook API key"
        },
        new ConfigField
        {
            Key = FieldDefaultQuality,
            Label = "Default quality preset",
            Type = ConfigFieldType.Select,
            Required = false,
            Default = "m4b",
            Description = "Preferred audio container for new requests",
            Options = new[]
            {
                new ConfigOption { Value = "m4b", Label = "m4b" },
                new ConfigOption { Value = "mp3", Label = "mp3" }
            }
        }
    };

    // -------------------------------------------------------------------------
    // Per-instance operations — all stubbed.
    // -------------------------------------------------------------------------

    public Task<TestResult> TestConnectionAsync(ProviderConfig cfg, CancellationToken ct)
    {
        WarnOnce();
        return Task.FromResult(new TestResult
        {
            Ok = false,
            Message = StubMessage
        });
    }

    public Task<IReadOnlyList<SearchResult>> SearchAsync(SearchQuery query, ProviderConfig cfg, CancellationToken ct)
    {
        WarnOnce();
        return Task.FromResult<IReadOnlyList<SearchResult>>(Array.Empty<SearchResult>());
    }

    public Task<RequestSubmissionResult> RequestAsync(RequestPayload payload, ProviderConfig cfg, CancellationToken ct)
    {
        WarnOnce();
        return Task.FromResult(new RequestSubmissionResult
        {
            Ok = false,
            Message = "ReadMeABook stub"
        });
    }

    public Task<IReadOnlyList<RequestStatus>> GetRequestStatusesAsync(string userId, ProviderConfig cfg, CancellationToken ct)
    {
        WarnOnce();
        return Task.FromResult<IReadOnlyList<RequestStatus>>(Array.Empty<RequestStatus>());
    }

    public Task<IndexBatch> IndexAsync(DateTime? since, ProviderConfig cfg, CancellationToken ct)
    {
        WarnOnce();
        return Task.FromResult(new IndexBatch
        {
            Documents = Array.Empty<IndexDocument>(),
            Replace = false
        });
    }

    public Task<IReadOnlyList<CalendarEntry>> GetCalendarAsync(CalendarQuery query, ProviderConfig cfg, CancellationToken ct)
    {
        WarnOnce();
        return Task.FromResult<IReadOnlyList<CalendarEntry>>(Array.Empty<CalendarEntry>());
    }

    /// <summary>
    /// Emit the stub warning at most once per process. Uses
    /// <see cref="Interlocked.Exchange(ref int, int)"/> for thread-safety
    /// without a lock — the cost of a duplicate log line on a race is trivial,
    /// but keeping it lock-free avoids any provider-method contention.
    /// </summary>
    private void WarnOnce()
    {
        if (Interlocked.Exchange(ref _warned, 1) == 0)
        {
            _logger.LogWarning("{Message}", StubMessage);
        }
    }
}
