using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Core;
using Meilisearch;
using Microsoft.Extensions.Logging;
using MeiliIndex = Meilisearch.Index;
using RawClient = Meilisearch.MeilisearchClient;
using RawSearchQuery = Meilisearch.SearchQuery;

namespace Jellyfin.Plugin.CypherflixHub.Services;

/// <summary>
/// Thin wrapper over the official <c>Meilisearch</c> .NET client (v0.15.4) that
/// hides the per-instance index naming convention from the rest of the plugin.
/// </summary>
/// <remarks>
/// <para>
/// Reads <see cref="Configuration.PluginConfiguration.MeilisearchUrl"/> and
/// <see cref="Configuration.PluginConfiguration.MeilisearchApiKey"/> from
/// <c>Plugin.Instance!.Configuration</c> on every call so the admin can change
/// them at runtime without restarting Jellyfin. If either is empty/null,
/// <see cref="GetRaw"/> returns <c>null</c> and the public methods become
/// safe no-ops with a logged warning.
/// </para>
/// <para>
/// See <c>ARCHITECTURE.md</c> §5 for the indexing strategy and
/// <c>tasks/SVC-001-meilisearch-client.md</c> for the public surface contract.
/// </para>
/// </remarks>
public class MeilisearchClient
{
    /// <summary>How long to wait for index-create / settings-update tasks server-side.</summary>
    private const int TaskWaitTimeoutMs = 10_000;

    /// <summary>Primary key declared on every Meilisearch index this plugin creates.</summary>
    private const string PrimaryKey = "id";

    private readonly ILogger<MeilisearchClient> _logger;

    public MeilisearchClient(ILogger<MeilisearchClient> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Returns a configured raw <see cref="Meilisearch.MeilisearchClient"/> from
    /// the plugin configuration, or <c>null</c> if Meilisearch isn't configured.
    /// </summary>
    public RawClient? GetRaw()
    {
        Configuration.PluginConfiguration? cfg = Plugin.Instance?.Configuration;
        if (cfg is null)
        {
            return null;
        }

        string url = cfg.MeilisearchUrl;
        string apiKey = cfg.MeilisearchApiKey;
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(apiKey))
        {
            return null;
        }

        return new RawClient(url, apiKey);
    }

    /// <summary>
    /// Computes the Meilisearch index name for one provider instance.
    /// Format: <c>cypherflix_&lt;typeId&gt;_&lt;first8charsOfInstanceId&gt;</c>.
    /// </summary>
    public string IndexName(string providerTypeId, Guid instanceId)
    {
        string normalisedType = NormaliseSegment(providerTypeId);
        string shortId = instanceId.ToString("N").Substring(0, 8).ToLowerInvariant();
        return $"cypherflix_{normalisedType}_{shortId}";
    }

    /// <summary>
    /// Idempotently creates the index for the given provider instance and applies
    /// the canonical searchable / filterable / sortable attribute settings.
    /// Calling twice is safe: existing indexes are detected via
    /// <see cref="Meilisearch.MeilisearchClient.GetIndexAsync"/> and only their settings are refreshed.
    /// </summary>
    public async Task EnsureIndexAsync(string providerTypeId, Guid instanceId, CancellationToken ct)
    {
        RawClient? raw = GetRaw();
        if (raw is null)
        {
            LogNotConfigured(nameof(EnsureIndexAsync));
            return;
        }

        string uid = IndexName(providerTypeId, instanceId);

        bool indexExists = await IndexExistsAsync(raw, uid, ct).ConfigureAwait(false);
        if (!indexExists)
        {
            try
            {
                TaskInfo createTask = await raw.CreateIndexAsync(uid, PrimaryKey, ct).ConfigureAwait(false);
                await raw.WaitForTaskAsync(createTask.TaskUid, TaskWaitTimeoutMs, cancellationToken: ct).ConfigureAwait(false);
            }
            catch (MeilisearchApiError ex) when (string.Equals(ex.Code, "index_already_exists", StringComparison.OrdinalIgnoreCase))
            {
                // Race with another caller — that's fine; carry on to settings update.
                _logger.LogDebug(ex, "Meilisearch index {Uid} already existed on create; continuing.", uid);
            }
        }

        Settings settings = new Settings
        {
            SearchableAttributes = new[] { "title", "subtitle", "description", "tags" },
            FilterableAttributes = new[] { "mediaType", "year", "tags" },
            SortableAttributes = new[] { "year" },
            DisplayedAttributes = new[] { "*" }
        };

        MeiliIndex index = raw.Index(uid);
        TaskInfo settingsTask = await index.UpdateSettingsAsync(settings, ct).ConfigureAwait(false);
        await raw.WaitForTaskAsync(settingsTask.TaskUid, TaskWaitTimeoutMs, cancellationToken: ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Applies an <see cref="IndexBatch"/> to the provider's index.
    /// Honours <see cref="IndexBatch.Replace"/> (clears the index first),
    /// <see cref="IndexBatch.DeleteIds"/> (deletes those IDs before insert),
    /// and <see cref="IndexBatch.Documents"/> (adds them).
    /// </summary>
    public async Task ApplyAsync(string providerTypeId, Guid instanceId, IndexBatch batch, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(batch);

        RawClient? raw = GetRaw();
        if (raw is null)
        {
            LogNotConfigured(nameof(ApplyAsync));
            return;
        }

        // Ensure the index exists before we try to write to it.
        await EnsureIndexAsync(providerTypeId, instanceId, ct).ConfigureAwait(false);

        string uid = IndexName(providerTypeId, instanceId);
        MeiliIndex index = raw.Index(uid);

        if (batch.Replace)
        {
            try
            {
                TaskInfo clearTask = await index.DeleteAllDocumentsAsync(ct).ConfigureAwait(false);
                await raw.WaitForTaskAsync(clearTask.TaskUid, TaskWaitTimeoutMs, cancellationToken: ct).ConfigureAwait(false);
            }
            catch (MeilisearchApiError ex)
            {
                _logger.LogWarning(ex, "Failed to clear Meilisearch index {Uid} before replace; continuing.", uid);
            }
        }
        else if (batch.DeleteIds is { Count: > 0 })
        {
            try
            {
                TaskInfo deleteTask = await index.DeleteDocumentsAsync(batch.DeleteIds, ct).ConfigureAwait(false);
                await raw.WaitForTaskAsync(deleteTask.TaskUid, TaskWaitTimeoutMs, cancellationToken: ct).ConfigureAwait(false);
            }
            catch (MeilisearchApiError ex)
            {
                _logger.LogWarning(ex, "Failed to delete documents in Meilisearch index {Uid}; continuing.", uid);
            }
        }

        if (batch.Documents.Count == 0)
        {
            return;
        }

        IEnumerable<MeiliDocument> serialisable = batch.Documents.Select(MeiliDocument.From);
        TaskInfo addTask = await index.AddDocumentsAsync(serialisable, PrimaryKey, ct).ConfigureAwait(false);
        await raw.WaitForTaskAsync(addTask.TaskUid, TaskWaitTimeoutMs, cancellationToken: ct).ConfigureAwait(false);
    }

    /// <summary>
    /// Multi-index search. Queries every named instance's index in parallel,
    /// merges the hits (de-duping by <see cref="IndexDocument.Id"/> and keeping
    /// the highest Meilisearch ranking score), then applies <paramref name="typeFilter"/>,
    /// <paramref name="offset"/>, and <paramref name="limit"/>.
    /// </summary>
    public async Task<IReadOnlyList<IndexDocument>> SearchAsync(
        IEnumerable<(string TypeId, Guid InstanceId)> instances,
        string query,
        IReadOnlySet<MediaType>? typeFilter,
        int limit,
        int offset,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(instances);

        RawClient? raw = GetRaw();
        if (raw is null)
        {
            LogNotConfigured(nameof(SearchAsync));
            return Array.Empty<IndexDocument>();
        }

        // Per-index "fetch enough rows to cover offset+limit", then we paginate post-merge.
        int perIndexLimit = Math.Max(0, offset) + Math.Max(0, limit);
        if (perIndexLimit == 0)
        {
            return Array.Empty<IndexDocument>();
        }

        string? filter = BuildTypeFilter(typeFilter);

        List<Task<IEnumerable<JsonElement>>> searches = instances
            .Select(inst => SearchOneIndexAsync(raw, IndexName(inst.TypeId, inst.InstanceId), query, filter, perIndexLimit, ct))
            .ToList();

        IEnumerable<JsonElement>[] results = await Task.WhenAll(searches).ConfigureAwait(false);

        // Merge by Id, keeping the best (highest) ranking score across indexes.
        Dictionary<string, ScoredHit> bestById = new Dictionary<string, ScoredHit>(StringComparer.Ordinal);
        foreach (IEnumerable<JsonElement> indexHits in results)
        {
            foreach (JsonElement hit in indexHits)
            {
                if (!TryReadId(hit, out string id))
                {
                    continue;
                }

                double score = TryReadScore(hit);
                if (!bestById.TryGetValue(id, out ScoredHit existing) || score > existing.Score)
                {
                    bestById[id] = new ScoredHit(score, hit);
                }
            }
        }

        IEnumerable<IndexDocument> merged = bestById.Values
            .OrderByDescending(h => h.Score)
            .Skip(Math.Max(0, offset))
            .Take(Math.Max(0, limit))
            .Select(h => MeiliDocument.ToIndexDocument(h.Hit))
            .Where(d => d is not null)
            .Select(d => d!);

        return merged.ToList();
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private async Task<IEnumerable<JsonElement>> SearchOneIndexAsync(
        RawClient raw,
        string uid,
        string query,
        string? filter,
        int limit,
        CancellationToken ct)
    {
        try
        {
            MeiliIndex index = raw.Index(uid);
            RawSearchQuery sq = new RawSearchQuery
            {
                Limit = limit,
                ShowRankingScore = true
            };
            if (!string.IsNullOrEmpty(filter))
            {
                sq.Filter = filter;
            }

            ISearchable<JsonElement> result = await index.SearchAsync<JsonElement>(query, sq, ct).ConfigureAwait(false);
            return result.Hits ?? Array.Empty<JsonElement>();
        }
        catch (MeilisearchApiError ex) when (string.Equals(ex.Code, "index_not_found", StringComparison.OrdinalIgnoreCase))
        {
            // An instance was added but not yet indexed — that's normal, not an error.
            _logger.LogDebug("Meilisearch index {Uid} does not exist yet; skipping during search.", uid);
            return Array.Empty<JsonElement>();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Search against Meilisearch index {Uid} failed; skipping.", uid);
            return Array.Empty<JsonElement>();
        }
    }

    private static async Task<bool> IndexExistsAsync(RawClient raw, string uid, CancellationToken ct)
    {
        try
        {
            await raw.GetIndexAsync(uid, ct).ConfigureAwait(false);
            return true;
        }
        catch (MeilisearchApiError ex) when (string.Equals(ex.Code, "index_not_found", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
    }

    private static string? BuildTypeFilter(IReadOnlySet<MediaType>? typeFilter)
    {
        if (typeFilter is null || typeFilter.Count == 0)
        {
            return null;
        }

        // mediaType = 'Movie' OR mediaType = 'TvShow' ...
        IEnumerable<string> clauses = typeFilter.Select(t => $"mediaType = '{t}'");
        return string.Join(" OR ", clauses);
    }

    private static bool TryReadId(JsonElement hit, out string id)
    {
        if (hit.ValueKind == JsonValueKind.Object
            && hit.TryGetProperty("id", out JsonElement idEl)
            && idEl.ValueKind == JsonValueKind.String)
        {
            string? raw = idEl.GetString();
            if (!string.IsNullOrEmpty(raw))
            {
                id = raw;
                return true;
            }
        }

        id = string.Empty;
        return false;
    }

    private static double TryReadScore(JsonElement hit)
    {
        if (hit.ValueKind == JsonValueKind.Object
            && hit.TryGetProperty("_rankingScore", out JsonElement scoreEl)
            && scoreEl.ValueKind == JsonValueKind.Number
            && scoreEl.TryGetDouble(out double score))
        {
            return score;
        }

        return 0d;
    }

    private void LogNotConfigured(string operation)
    {
        _logger.LogWarning(
            "Meilisearch is not configured (URL or API key missing); {Operation} is a no-op.",
            operation);
    }

    private static string NormaliseSegment(string raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return "unknown";
        }

        // Meilisearch index UIDs only allow [A-Za-z0-9_-]. Strip everything else, lowercase.
        char[] buffer = new char[raw.Length];
        int len = 0;
        foreach (char c in raw)
        {
            if (char.IsLetterOrDigit(c) || c == '_' || c == '-')
            {
                buffer[len++] = char.ToLowerInvariant(c);
            }
        }

        return len == 0 ? "unknown" : new string(buffer, 0, len);
    }

    // -------------------------------------------------------------------------
    // Document shape sent to / read from Meilisearch.
    // Field names map 1:1 with the searchable / filterable / sortable attributes
    // configured in EnsureIndexAsync.
    // -------------------------------------------------------------------------

    private readonly record struct ScoredHit(double Score, JsonElement Hit);

    private sealed class MeiliDocument
    {
        [JsonPropertyName("id")] public string Id { get; set; } = string.Empty;
        [JsonPropertyName("mediaType")] public string MediaType { get; set; } = string.Empty;
        [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
        [JsonPropertyName("subtitle")] public string? Subtitle { get; set; }
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("posterUrl")] public string? PosterUrl { get; set; }
        [JsonPropertyName("year")] public int? Year { get; set; }
        [JsonPropertyName("tags")] public IReadOnlyList<string>? Tags { get; set; }
        [JsonPropertyName("extras")] public IReadOnlyDictionary<string, string>? Extras { get; set; }

        public static MeiliDocument From(IndexDocument doc) => new MeiliDocument
        {
            Id = doc.Id,
            MediaType = doc.MediaType.ToString(),
            Title = doc.Title,
            Subtitle = doc.Subtitle,
            Description = doc.Description,
            PosterUrl = doc.PosterUrl,
            Year = doc.Year,
            Tags = doc.Tags,
            Extras = doc.Extras
        };

        public static IndexDocument? ToIndexDocument(JsonElement hit)
        {
            if (hit.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            string? id = TryGetString(hit, "id");
            string? title = TryGetString(hit, "title");
            string? mediaTypeStr = TryGetString(hit, "mediaType");
            if (id is null || title is null || mediaTypeStr is null)
            {
                return null;
            }

            if (!Enum.TryParse(mediaTypeStr, ignoreCase: true, out MediaType mediaType))
            {
                mediaType = Core.MediaType.Other;
            }

            return new IndexDocument
            {
                Id = id,
                MediaType = mediaType,
                Title = title,
                Subtitle = TryGetString(hit, "subtitle"),
                Description = TryGetString(hit, "description"),
                PosterUrl = TryGetString(hit, "posterUrl"),
                Year = TryGetInt(hit, "year"),
                Tags = TryGetStringArray(hit, "tags"),
                Extras = TryGetStringDict(hit, "extras")
            };
        }

        private static string? TryGetString(JsonElement obj, string name) =>
            obj.TryGetProperty(name, out JsonElement el) && el.ValueKind == JsonValueKind.String
                ? el.GetString()
                : null;

        private static int? TryGetInt(JsonElement obj, string name) =>
            obj.TryGetProperty(name, out JsonElement el) && el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out int v)
                ? v
                : null;

        private static IReadOnlyList<string>? TryGetStringArray(JsonElement obj, string name)
        {
            if (!obj.TryGetProperty(name, out JsonElement el) || el.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            List<string> list = new List<string>(el.GetArrayLength());
            foreach (JsonElement item in el.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String)
                {
                    string? s = item.GetString();
                    if (s is not null)
                    {
                        list.Add(s);
                    }
                }
            }

            return list;
        }

        private static IReadOnlyDictionary<string, string>? TryGetStringDict(JsonElement obj, string name)
        {
            if (!obj.TryGetProperty(name, out JsonElement el) || el.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            Dictionary<string, string> dict = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (JsonProperty prop in el.EnumerateObject())
            {
                if (prop.Value.ValueKind == JsonValueKind.String)
                {
                    string? v = prop.Value.GetString();
                    if (v is not null)
                    {
                        dict[prop.Name] = v;
                    }
                }
            }

            return dict;
        }
    }
}
