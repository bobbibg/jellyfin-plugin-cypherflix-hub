using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Providers.Readarr;

/// <summary>
/// Thin HTTP wrapper around the Readarr (Faustvii fork) v1 REST API.
///
/// Stateless — every call takes the base URL and API key explicitly so the
/// same client instance can service multiple configured Readarr instances
/// (one per root folder: books, audiobooks, comics).
///
/// Resilience strategy mirrors <see cref="Jellyseerr.JellyseerrClient"/>: this
/// class surfaces failures so the calling provider can decide whether to log
/// a warning, retry, or treat a 4xx as a successful "no result". Lookups
/// return null on non-success; mutating endpoints return the raw response so
/// the caller can detect the Servarr "already added" 400 body and recover.
///
/// Endpoint surface and shapes are documented in JELLYFIN-INTEGRATION.md §8
/// (https://readarr.com/docs/api/).
/// </summary>
public sealed class ReadarrClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _http;
    private readonly ILogger<ReadarrClient> _logger;

    public ReadarrClient(HttpClient http, ILogger<ReadarrClient> logger)
    {
        _http = http;
        _logger = logger;
    }

    // -------------------------------------------------------------------------
    // System status
    // -------------------------------------------------------------------------

    /// <summary>GET /api/v1/system/status — used for connection tests.</summary>
    public async Task<HttpResponseMessage> GetSystemStatusRawAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Get, baseUrl, "/api/v1/system/status", apiKey);
        return await _http.SendAsync(req, ct).ConfigureAwait(false);
    }

    // -------------------------------------------------------------------------
    // Books
    // -------------------------------------------------------------------------

    /// <summary>GET /api/v1/book — full library list, optionally filtered to monitored.</summary>
    public async Task<List<BookDto>?> GetBooksAsync(string baseUrl, string apiKey, bool monitoredOnly, CancellationToken ct)
    {
        var path = monitoredOnly ? "/api/v1/book?monitored=true" : "/api/v1/book";
        return await GetJsonAsync<List<BookDto>>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    /// <summary>GET /api/v1/book?titleSlug={slug} — exact lookup by slug.</summary>
    public async Task<List<BookDto>?> GetBooksByTitleSlugAsync(string baseUrl, string apiKey, string titleSlug, CancellationToken ct)
    {
        var path = $"/api/v1/book?titleSlug={Uri.EscapeDataString(titleSlug)}";
        return await GetJsonAsync<List<BookDto>>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    /// <summary>GET /api/v1/book/lookup?term={q} — remote search (Goodreads / OL).</summary>
    public async Task<List<BookDto>?> LookupBookAsync(string baseUrl, string apiKey, string term, CancellationToken ct)
    {
        var path = $"/api/v1/book/lookup?term={Uri.EscapeDataString(term)}";
        return await GetJsonAsync<List<BookDto>>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    /// <summary>PUT /api/v1/book/{id} — update an existing book record.</summary>
    public async Task<HttpResponseMessage> UpdateBookAsync(string baseUrl, string apiKey, BookDto book, CancellationToken ct)
    {
        var path = $"/api/v1/book/{book.Id.ToString(CultureInfo.InvariantCulture)}";
        using var req = BuildRequest(HttpMethod.Put, baseUrl, path, apiKey);
        req.Content = JsonContent.Create(book, options: JsonOptions);
        return await _http.SendAsync(req, ct).ConfigureAwait(false);
    }

    /// <summary>POST /api/v1/book — add a new book. Caller disposes the response.</summary>
    public async Task<HttpResponseMessage> AddBookAsync(string baseUrl, string apiKey, BookAddPayloadDto payload, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Post, baseUrl, "/api/v1/book", apiKey);
        req.Content = JsonContent.Create(payload, options: JsonOptions);
        return await _http.SendAsync(req, ct).ConfigureAwait(false);
    }

    // -------------------------------------------------------------------------
    // Authors
    // -------------------------------------------------------------------------

    /// <summary>GET /api/v1/author — full author list (used to recover after "already added").</summary>
    public async Task<List<AuthorDto>?> GetAuthorsAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        return await GetJsonAsync<List<AuthorDto>>(baseUrl, apiKey, "/api/v1/author", ct).ConfigureAwait(false);
    }

    /// <summary>GET /api/v1/author/lookup?term={q} — remote search for an author.</summary>
    public async Task<List<AuthorDto>?> LookupAuthorAsync(string baseUrl, string apiKey, string term, CancellationToken ct)
    {
        var path = $"/api/v1/author/lookup?term={Uri.EscapeDataString(term)}";
        return await GetJsonAsync<List<AuthorDto>>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    /// <summary>POST /api/v1/author — add a new author. Caller disposes the response.</summary>
    public async Task<HttpResponseMessage> AddAuthorAsync(string baseUrl, string apiKey, AuthorDto payload, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Post, baseUrl, "/api/v1/author", apiKey);
        req.Content = JsonContent.Create(payload, options: JsonOptions);
        return await _http.SendAsync(req, ct).ConfigureAwait(false);
    }

    // -------------------------------------------------------------------------
    // Tags
    // -------------------------------------------------------------------------

    public async Task<List<TagDto>?> GetTagsAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        return await GetJsonAsync<List<TagDto>>(baseUrl, apiKey, "/api/v1/tag", ct).ConfigureAwait(false);
    }

    /// <summary>POST /api/v1/tag — create a tag. Caller disposes the response (may be 400 / "already exists").</summary>
    public async Task<HttpResponseMessage> CreateTagAsync(string baseUrl, string apiKey, string label, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Post, baseUrl, "/api/v1/tag", apiKey);
        req.Content = JsonContent.Create(new CreateTagBody { Label = label }, options: JsonOptions);
        return await _http.SendAsync(req, ct).ConfigureAwait(false);
    }

    // -------------------------------------------------------------------------
    // Queue + Calendar + Command
    // -------------------------------------------------------------------------

    public async Task<QueueResponseDto?> GetQueueAsync(string baseUrl, string apiKey, CancellationToken ct)
    {
        // page-size=100 covers any realistic homelab queue. Servarr defaults to 10.
        return await GetJsonAsync<QueueResponseDto>(baseUrl, apiKey, "/api/v1/queue?pageSize=100", ct).ConfigureAwait(false);
    }

    public async Task<List<BookDto>?> GetCalendarAsync(string baseUrl, string apiKey, DateTime start, DateTime end, CancellationToken ct)
    {
        var path = $"/api/v1/calendar?start={start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}"
                   + $"&end={end.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}";
        return await GetJsonAsync<List<BookDto>>(baseUrl, apiKey, path, ct).ConfigureAwait(false);
    }

    /// <summary>POST /api/v1/command — trigger a Servarr command (e.g. BookSearch).</summary>
    public async Task<HttpResponseMessage> SendCommandAsync(string baseUrl, string apiKey, CommandBody body, CancellationToken ct)
    {
        using var req = BuildRequest(HttpMethod.Post, baseUrl, "/api/v1/command", apiKey);
        req.Content = JsonContent.Create(body, options: JsonOptions);
        return await _http.SendAsync(req, ct).ConfigureAwait(false);
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
                "Readarr GET {Path} returned {Status}",
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
            _logger.LogWarning(ex, "Failed to parse Readarr response from {Path}", path);
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
    /// the body is small — we cap it at 4 KB.
    /// </summary>
    public static async Task<string> ReadBodySafeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var reader = new System.IO.StreamReader(stream, Encoding.UTF8);
            var buffer = new char[4096];
            var read = await reader.ReadAsync(buffer, ct).ConfigureAwait(false);
            return new string(buffer, 0, read);
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <summary>
    /// Read a Servarr 4xx body and try to parse it as a list of validation
    /// failures. Returns an empty list on parse failure rather than throwing.
    /// </summary>
    public static async Task<List<ValidationFailureDto>> ReadValidationFailuresAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            var failures = await JsonSerializer.DeserializeAsync<List<ValidationFailureDto>>(stream, JsonOptions, ct).ConfigureAwait(false);
            return failures ?? new List<ValidationFailureDto>();
        }
        catch
        {
            return new List<ValidationFailureDto>();
        }
    }

    /// <summary>
    /// True for response codes/bodies that indicate "already exists" semantics
    /// in the Servarr family (Sonarr/Radarr/Readarr). Returns 400 with a body
    /// containing "already" in the validation failure message.
    /// </summary>
    public static bool IsAlreadyExists(HttpStatusCode status, string? body)
    {
        if (status == HttpStatusCode.Conflict)
        {
            return true;
        }

        if (status == HttpStatusCode.BadRequest && !string.IsNullOrEmpty(body))
        {
            return body.Contains("already", StringComparison.OrdinalIgnoreCase)
                   || body.Contains("exists", StringComparison.OrdinalIgnoreCase);
        }

        return false;
    }
}
