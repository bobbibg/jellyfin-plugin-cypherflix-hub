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
/// Calendar endpoint that powers the Calendar tab. Thin wrapper around
/// <see cref="CalendarAggregator.GetAsync"/>; all the real work — fan-out,
/// per-provider timeouts, sorting, and type filtering — lives in SVC-004.
/// </summary>
/// <remarks>
/// Auth note: we use a bare <c>[Authorize]</c> attribute and parse the calling
/// user id from claims manually. The <c>"DefaultAuthorization"</c> policy is NOT
/// registered for plugin controllers in Jellyfin 10.10/10.11 — using it would
/// 500 every request. See <c>JELLYFIN-INTEGRATION.md §1.3</c>.
/// </remarks>
[ApiController]
[Route("CypherflixHub")]
public class CalendarController : ControllerBase
{
    private readonly CalendarAggregator _calendarAggregator;
    private readonly ILogger<CalendarController> _logger;

    public CalendarController(
        CalendarAggregator calendarAggregator,
        ILogger<CalendarController> logger)
    {
        _calendarAggregator = calendarAggregator;
        _logger = logger;
    }

    /// <summary>
    /// Get upcoming releases in a date window from every enabled,
    /// calendar-capable provider instance. Results are merged across providers,
    /// filtered by media type, and sorted by ascending release date — all
    /// handled inside <see cref="CalendarAggregator.GetAsync"/>.
    /// </summary>
    /// <param name="start">Inclusive window start (UTC). Defaults to today (UTC midnight) if omitted.</param>
    /// <param name="end">Exclusive window end (UTC). Defaults to <paramref name="start"/> + 30 days if omitted.</param>
    /// <param name="types">Optional CSV of <see cref="MediaType"/> names (e.g. <c>Movie,Book</c>). Omit for all types.</param>
    /// <param name="ct">Request cancellation token.</param>
    [HttpGet("Calendar")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<CalendarEntry>>> Get(
        [FromQuery] DateTime? start,
        [FromQuery] DateTime? end,
        [FromQuery] string? types,
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

        DateTime windowStart = start ?? DateTime.UtcNow.Date;
        DateTime windowEnd = end ?? windowStart + TimeSpan.FromDays(30);

        IReadOnlySet<MediaType>? typesFilter = ParseTypes(types);

        CalendarQuery query = new()
        {
            Start = windowStart,
            End = windowEnd,
            TypesFilter = typesFilter,
            UserId = userId.ToString("N"),
        };

        IReadOnlyList<CalendarEntry> results = await _calendarAggregator
            .GetAsync(query, ct)
            .ConfigureAwait(false);

        return Ok(results);
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
    /// skipped — the Calendar tab tolerates an outdated client.
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
