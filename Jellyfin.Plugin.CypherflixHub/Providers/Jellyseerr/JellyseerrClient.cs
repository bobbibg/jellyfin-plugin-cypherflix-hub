using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Providers.Jellyseerr;

/// <summary>
/// Thin HTTP wrapper around the Jellyseerr REST API. Stateless — every call
/// takes the base URL and API key explicitly so the same client instance can
/// service multiple configured Jellyseerr instances.
///
/// Resilience strategy: callers in <see cref="JellyseerrProvider"/> are
/// responsible for catching <see cref="HttpRequestException"/> and friends and
/// returning safe empties. This class deliberately surfaces failures so the
/// provider can decide whether to log a warning, retry, or treat a 4xx as a
/// successful "no result".
/// </summary>
public sealed class JellyseerrClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _http;
    private readonly ILogger<JellyseerrClient> _logger;

    public JellyseerrClient(HttpClient http, ILogger<JellyseerrClient> logger)
    {
        _http = http;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /// <summary>GET /api/v1/status — used for connection tests.</summary>
    public async Task<HttpResponseMessage> GetStatusRawAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Get, baseUrl, "/api/v1/status", apiKey);
        return await _http.SendAsync(req, ct).ConfigureAwait(false);
    }

    public async Task<SearchResponse?> SearchAsync(string baseUrl, string apiKey, string query, int page, CancellationToken ct)
    {
        var path = $"/api/v1/search?query={Uri.EscapeDataString(query)}&page={page}";
        return await GetJsonAsync<SearchResponse>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    public async Task<DiscoverResponse?> DiscoverMoviesTrendingAsync(string baseUrl, string apiKey, int take, CancellationToken ct)
    {
        var path = $"/api/v1/discover/movies/trending?take={take}";
        return await GetJsonAsync<DiscoverResponse>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    public async Task<DiscoverResponse?> DiscoverTvTrendingAsync(string baseUrl, string apiKey, int take, CancellationToken ct)
    {
        var path = $"/api/v1/discover/tv/trending?take={take}";
        return await GetJsonAsync<DiscoverResponse>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    public async Task<DiscoverResponse?> DiscoverMoviesAsync(string baseUrl, string apiKey, int take, CancellationToken ct)
    {
        var path = $"/api/v1/discover/movies?take={take}";
        return await GetJsonAsync<DiscoverResponse>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    public async Task<DiscoverResponse?> DiscoverTvAsync(string baseUrl, string apiKey, int take, CancellationToken ct)
    {
        var path = $"/api/v1/discover/tv?take={take}";
        return await GetJsonAsync<DiscoverResponse>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    public async Task<RequestListResponse?> GetRequestsAsync(string baseUrl, string apiKey, int? userId, int take, CancellationToken ct)
    {
        var path = userId is null
            ? $"/api/v1/request?filter=all&take={take}"
            : $"/api/v1/request?filter=all&take={take}&requestedBy={userId.Value}";
        return await GetJsonAsync<RequestListResponse>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// POST /api/v1/request. Returns (response, parsed) — caller inspects the
    /// status code to detect 409/already-exists and falls back to a list lookup.
    /// </summary>
    public async Task<(HttpResponseMessage Response, MediaRequestDto? Created)> CreateRequestAsync(
        string baseUrl, string apiKey, CreateRequestBody body, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Post, baseUrl, "/api/v1/request", apiKey);
        req.Content = JsonContent.Create(body, options: JsonOptions);

        // We can't return a using'd HttpResponseMessage and still let the caller
        // read it, so don't dispose here — the caller does.
        var response = await _http.SendAsync(req, ct).ConfigureAwait(false);

        MediaRequestDto? created = null;
        if (response.IsSuccessStatusCode)
        {
            try
            {
                created = await response.Content.ReadFromJsonAsync<MediaRequestDto>(JsonOptions, ct).ConfigureAwait(false);
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "Failed to parse Jellyseerr POST /request response body");
            }
        }

        return (response, created);
    }

    public async Task<UserListResponse?> GetUsersAsync(string baseUrl, string apiKey, int take, CancellationToken ct)
    {
        var path = $"/api/v1/user?take={take}";
        return await GetJsonAsync<UserListResponse>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private async Task<T?> GetJsonAsync<T>(string baseUrl, string apiKey, string path, CancellationToken ct)
        where T : class
    {
        using var req = BuildRequest(HttpMethod.Get, baseUrl, path, apiKey);
        using var response = await _http.SendAsync(req, ct).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning(
                "Jellyseerr GET {Path} returned {Status}",
                path,
                (int)response.StatusCode);
            return null;
        }

        try
        {
            return await response.Content.ReadFromJsonAsync<T>(JsonOptions, ct).ConfigureAwait(false);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse Jellyseerr response from {Path}", path);
            return null;
        }
    }

    private static HttpRequestMessage BuildRequest(HttpMethod method, string baseUrl, string path, string apiKey)
    {
        var url = CombineUrl(baseUrl, path);
        var req = new HttpRequestMessage(method, url);
        req.Headers.Add("X-Api-Key", apiKey);
        req.Headers.Add("Accept", "application/json");
        return req;
    }

    /// <summary>
    /// Joins a base URL (which may or may not end with a slash) with an absolute
    /// path. Avoids the WebUtility/Path quirks around backslashes on Windows.
    /// </summary>
    private static Uri CombineUrl(string baseUrl, string path)
    {
        var trimmed = baseUrl.TrimEnd('/');
        return new Uri(trimmed + path, UriKind.Absolute);
    }

    /// <summary>
    /// Safe-read the response body for diagnostics. Caller should not assume
    /// the body is small — we cap it.
    /// </summary>
    public static async Task<string> ReadBodySafeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var reader = new System.IO.StreamReader(stream, Encoding.UTF8);
            var buffer = new char[2048];
            var read = await reader.ReadAsync(buffer, ct).ConfigureAwait(false);
            return new string(buffer, 0, read);
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <summary>True for response codes that indicate "already exists" semantics.</summary>
    public static bool IsAlreadyExists(HttpStatusCode status, string? body)
    {
        if (status == HttpStatusCode.Conflict)
        {
            return true;
        }

        if (status == HttpStatusCode.BadRequest && !string.IsNullOrEmpty(body))
        {
            // Jellyseerr returns 400 with a body containing "already exists" in
            // older builds; tolerate both.
            return body.Contains("already exists", StringComparison.OrdinalIgnoreCase);
        }

        return false;
    }
}
