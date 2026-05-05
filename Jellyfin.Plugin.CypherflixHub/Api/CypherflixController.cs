using System;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Api;

/// <summary>
/// Reverse-proxy: forwards /Cypherflix/api/{**path} to {BackendUrl}/api/v1/{path}
/// with the X-Cypherflix-Token header injected. Authenticated Jellyfin user only.
/// </summary>
[ApiController]
[Authorize]
[Route("Cypherflix/api")]
public class CypherflixController : ControllerBase
{
    private readonly HttpClient _http;
    private readonly ILogger<CypherflixController> _logger;

    public CypherflixController(HttpClient http, ILogger<CypherflixController> logger)
    {
        _http = http;
        _logger = logger;
    }

    [Route("{**path}")]
    [HttpGet]
    [HttpPost]
    [HttpPatch]
    [HttpDelete]
    [HttpPut]
    public async Task<IActionResult> Proxy(string path, CancellationToken ct)
    {
        var config = Plugin.Instance?.Configuration;
        if (config is null || string.IsNullOrWhiteSpace(config.BackendUrl))
        {
            return StatusCode(502, new { error = "BackendUrl not configured in plugin settings" });
        }

        var backend = config.BackendUrl.TrimEnd('/');
        var query = Request.QueryString.HasValue ? Request.QueryString.Value : string.Empty;
        var url = $"{backend}/api/v1/{path}{query}";

        using var req = new HttpRequestMessage(new HttpMethod(Request.Method), url);
        if (HttpMethods.IsPost(Request.Method) || HttpMethods.IsPatch(Request.Method) || HttpMethods.IsPut(Request.Method))
        {
            using var ms = new MemoryStream();
            await Request.Body.CopyToAsync(ms, ct).ConfigureAwait(false);
            ms.Position = 0;
            req.Content = new ByteArrayContent(ms.ToArray());
            if (!string.IsNullOrWhiteSpace(Request.ContentType))
            {
                req.Content.Headers.TryAddWithoutValidation("Content-Type", Request.ContentType);
            }
        }
        if (!string.IsNullOrWhiteSpace(config.ApiToken))
        {
            req.Headers.TryAddWithoutValidation("X-Cypherflix-Token", config.ApiToken);
        }
        req.Headers.TryAddWithoutValidation("User-Agent", "cypherflix-hub-proxy/1.0");

        try
        {
            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            var bytes = await resp.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
            var contentType = resp.Content.Headers.ContentType?.ToString() ?? "application/octet-stream";
            Response.StatusCode = (int)resp.StatusCode;
            return new FileContentResult(bytes, contentType);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "Cypherflix proxy failed: {Url}", url);
            return StatusCode(502, new { error = "Backend unreachable" });
        }
        catch (TaskCanceledException)
        {
            return StatusCode(504, new { error = "Backend timed out" });
        }
    }
}
