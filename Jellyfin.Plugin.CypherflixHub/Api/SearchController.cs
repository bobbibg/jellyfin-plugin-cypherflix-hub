using System;
using System.Collections.Generic;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Core;
using Jellyfin.Plugin.CypherflixHub.Services.Aggregators;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Api;

/// <summary>
/// Public search endpoint that powers the Discover tab. Thin wrapper around
/// <see cref="SearchAggregator.SearchAsync"/>; all the real work is in SVC-003.
/// </summary>
/// <remarks>
/// Auth note: we use a bare <c>[Authorize]</c> attribute and parse the calling
/// user id from claims manually. The <c>"DefaultAuthorization"</c> policy is NOT
/// registered for plugin controllers in Jellyfin 10.10/10.11 — using it would
/// 500 every request. See <c>JELLYFIN-INTEGRATION.md §1.3</c>.
/// </remarks>
[ApiController]
[Route("CypherflixHub")]
public class SearchController : ControllerBase
{
    private readonly SearchAggregator _searchAggregator;
    private readonly ILogger<SearchController> _logger;

    public SearchController(
        SearchAggregator searchAggregator,
        ILogger<SearchController> logger)
    {
        _searchAggregator = searchAggregator;
        _logger = logger;
    }

    /// <summary>
    /// Run a unified search across all enabled, search-capable provider
    /// instances (indexed via Meilisearch + live fan-out). Decorates each hit
    /// with <c>InLibrary</c> and <c>RequestPending</c> for the calling user.
    /// </summary>
    /// <param name="q">Free-text query. Empty/whitespace returns an empty array (200, not an error).</param>
    /// <param name="types">Optional CSV of <see cref="MediaType"/> names (e.g. <c>Movie,TvShow</c>). Omit for all types.</param>
    /// <param name="limit">Page size, clamped to [1, 100]. Default 25.</param>
    /// <param name="offset">Page offset, clamped to &gt;= 0. Default 0.</param>
    /// <param name="ct">Request cancellation token.</param>
    [HttpGet("Search")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<SearchResult>>> Search(
        [FromQuery] string? q,
        [FromQuery] string? types,
        [FromQuery] int limit = 25,
        [FromQuery] int offset = 0,
        CancellationToken ct = default)
    {
        // Defensive: [Authorize] should prevent anonymous calls, but we still
        // guard in case the host strips the attribute or the user-id claim is
        // missing for some reason.
        Guid userId = GetCurrentUserId();
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        // Empty / whitespace query short-circuits with an empty array. The
        // Discover tab fires this on every keystroke; an empty box should not
        // be a 400.
        if (string.IsNullOrWhiteSpace(q))
        {
            return Ok(Array.Empty<SearchResult>());
        }

        IReadOnlySet<MediaType>? typesFilter = ParseTypes(types);

        SearchQuery query = new()
        {
            Query = q,
            UserId = userId.ToString("N"),
            TypesFilter = typesFilter,
            Limit = Math.Clamp(limit, 1, 100),
            Offset = Math.Max(offset, 0),
        };

        try
        {
            IReadOnlyList<SearchResult> results = await _searchAggregator
                .SearchAsync(query, userId.ToString("N"), ct)
                .ConfigureAwait(false);
            return Ok(results);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Client went away — let ASP.NET Core handle the cancellation.
            throw;
        }
        catch (Exception ex)
        {
            // Per the task spec: aggregator throwing → 500 with the message
            // logged. We don't catch-and-return-OK because that would mask
            // real failures from the UI; a 500 is the right signal.
            _logger.LogError(
                ex,
                "SearchAggregator.SearchAsync threw for query '{Query}' (user {UserId}); surfacing as 500.",
                q,
                userId);
            throw;
        }
    }

    /// <summary>
    /// Parse the calling Jellyfin user id from the request claims. Uses the
    /// pattern documented in <c>JELLYFIN-INTEGRATION.md §1.3</c>: prefer the
    /// Jellyfin-specific claim, fall back to <see cref="ClaimTypes.NameIdentifier"/>.
    /// Returns <see cref="Guid.Empty"/> if no usable claim is present.
    /// </summary>
    private Guid GetCurrentUserId()
    {
        // JF 10.11.x emits ClaimTypes.NameIdentifier; 10.10.x used "Jellyfin-UserId".
        // Try both for compatibility.
        string? value = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                        ?? User.FindFirst("Jellyfin-UserId")?.Value;
        return string.IsNullOrEmpty(value) || !Guid.TryParse(value, out Guid parsed)
            ? Guid.Empty
            : parsed;
    }

    /// <summary>
    /// Parse a CSV of <see cref="MediaType"/> enum names into a set. Returns
    /// <c>null</c> if the input is null/empty OR no entries parsed (which the
    /// aggregator interprets as "all types"). Unknown names are silently
    /// skipped — the Discover tab tolerates an outdated client.
    /// </summary>
    private static IReadOnlySet<MediaType>? ParseTypes(string? types)
    {
        if (string.IsNullOrWhiteSpace(types))
        {
            return null;
        }

        HashSet<MediaType> set = new();
        foreach (string raw in types.Split(','))
        {
            string trimmed = raw.Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            if (Enum.TryParse(trimmed, ignoreCase: true, out MediaType parsed))
            {
                set.Add(parsed);
            }
        }

        return set.Count == 0 ? null : set;
    }
}
