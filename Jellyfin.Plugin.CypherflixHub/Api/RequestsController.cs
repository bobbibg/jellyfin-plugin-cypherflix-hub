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
/// Endpoints powering the Requests tab. <c>GET</c> lists the calling user's
/// outstanding requests fanned out across every request-status-capable
/// provider; <c>POST</c> submits a new request to a single provider instance.
/// All real work lives in <see cref="RequestAggregator"/> — this controller is
/// auth + payload shaping.
/// </summary>
/// <remarks>
/// Auth note: we use a bare <c>[Authorize]</c> attribute and parse the calling
/// user id from claims manually. The <c>"DefaultAuthorization"</c> policy is NOT
/// registered for plugin controllers in Jellyfin 10.10/10.11 — using it would
/// 500 every request. See <c>JELLYFIN-INTEGRATION.md §1.3</c>.
/// </remarks>
[ApiController]
[Route("CypherflixHub")]
public class RequestsController : ControllerBase
{
    private readonly RequestAggregator _requestAggregator;
    private readonly ILogger<RequestsController> _logger;

    public RequestsController(
        RequestAggregator requestAggregator,
        ILogger<RequestsController> logger)
    {
        _requestAggregator = requestAggregator;
        _logger = logger;
    }

    /// <summary>
    /// Returns every <see cref="RequestStatus"/> the calling user has across
    /// all enabled, request-status-capable provider instances. Sorted by
    /// <see cref="RequestStatus.CreatedAt"/> descending. A provider erroring
    /// out drops its contribution rather than failing the whole call — see
    /// <see cref="RequestAggregator.GetForUserAsync"/>.
    /// </summary>
    [HttpGet("Requests")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<RequestStatus>>> GetMyRequests(
        CancellationToken ct)
    {
        Guid userId = GetCurrentUserId();
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        IReadOnlyList<RequestStatus> results = await _requestAggregator
            .GetForUserAsync(userId.ToString("N"), ct)
            .ConfigureAwait(false);

        return Ok(results);
    }

    /// <summary>
    /// Submit a new request to a single provider instance. The
    /// <c>UserId</c> on the resulting <see cref="RequestPayload"/> is sourced
    /// from the calling user's claims, never from the request body — clients
    /// cannot impersonate other users.
    /// </summary>
    /// <remarks>
    /// HTTP status mapping:
    /// <list type="bullet">
    ///   <item><description><c>200 OK</c> when
    ///     <see cref="RequestSubmissionResult.Ok"/> is <c>true</c>.</description></item>
    ///   <item><description><c>400 Bad Request</c> when
    ///     <see cref="RequestSubmissionResult.Ok"/> is <c>false</c>; the body
    ///     carries the same <see cref="RequestSubmissionResult"/> shape so the
    ///     UI can show <see cref="RequestSubmissionResult.Message"/>.</description></item>
    /// </list>
    /// </remarks>
    [HttpPost("Requests")]
    [Authorize]
    public async Task<ActionResult<RequestSubmissionResult>> Submit(
        [FromBody] SubmitBody body,
        CancellationToken ct)
    {
        Guid userId = GetCurrentUserId();
        if (userId == Guid.Empty)
        {
            return Unauthorized();
        }

        RequestPayload payload = new()
        {
            ProviderInstanceId = body.ProviderInstanceId,
            ExternalId = body.ExternalId,
            MediaType = body.MediaType,
            UserId = userId.ToString("N"),
            Extras = body.Extras,
        };

        RequestSubmissionResult result = await _requestAggregator
            .SubmitAsync(body.ProviderInstanceId, payload, ct)
            .ConfigureAwait(false);

        if (!result.Ok)
        {
            _logger.LogInformation(
                "Request submission rejected for user {UserId} on provider instance {InstanceId}: {Message}",
                userId,
                body.ProviderInstanceId,
                result.Message);
            return BadRequest(result);
        }

        return Ok(result);
    }

    /// <summary>
    /// Wire-format payload for <see cref="Submit"/>. The calling user is
    /// derived from claims and is intentionally NOT a member of this record.
    /// </summary>
    public record SubmitBody(
        Guid ProviderInstanceId,
        string ExternalId,
        MediaType MediaType,
        IReadOnlyDictionary<string, string>? Extras);

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
}
