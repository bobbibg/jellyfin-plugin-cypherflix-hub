using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.CypherflixHub.Configuration;
using Jellyfin.Plugin.CypherflixHub.Core;
using Jellyfin.Plugin.CypherflixHub.Services.Aggregators;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.CypherflixHub.Api;

/// <summary>
/// Admin-facing API powering the Cypherflix Hub settings page.
/// <list type="bullet">
///   <item><description><c>GET    /CypherflixHub/Providers/Types</c> — metadata for every registered provider type.</description></item>
///   <item><description><c>GET    /CypherflixHub/Providers</c>       — configured instances (secrets masked).</description></item>
///   <item><description><c>POST   /CypherflixHub/Providers</c>       — create-or-update an instance.</description></item>
///   <item><description><c>DELETE /CypherflixHub/Providers/{id}</c>  — remove an instance.</description></item>
///   <item><description><c>POST   /CypherflixHub/Providers/Test</c>  — test a connection without saving.</description></item>
/// </list>
/// All endpoints use bare <c>[Authorize]</c> + manual claim parsing
/// (see <c>JELLYFIN-INTEGRATION.md</c> §1.3 — <c>[Authorize(Policy="DefaultAuthorization")]</c>
/// 500s on JF 10.10/10.11). Admin-only actions check
/// <c>Jellyfin-IsAdministrator</c> manually and return <see cref="ForbidResult"/>
/// when absent.
/// </summary>
[ApiController]
[Route("CypherflixHub")]
public class ProvidersController : ControllerBase
{
    /// <summary>Sentinel returned in place of stored secrets on <c>GET /Providers</c>.</summary>
    private const string SecretMask = "***";

    private readonly ProviderRegistry _registry;
    private readonly ILogger<ProvidersController> _logger;

    public ProvidersController(ProviderRegistry registry, ILogger<ProvidersController> logger)
    {
        _registry = registry;
        _logger = logger;
    }

    // ---------------------------------------------------------------------
    // GET /CypherflixHub/Providers/Types
    // ---------------------------------------------------------------------

    /// <summary>Metadata for every registered provider type. Admin-only.</summary>
    [HttpGet("Providers/Types")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<IReadOnlyList<ProviderTypeDto>> GetTypes()
    {
        if (!IsAdmin())
        {
            return Forbid();
        }

        List<ProviderTypeDto> dtos = _registry.All
            .Select(p => new ProviderTypeDto
            {
                TypeId = p.TypeId,
                DisplayName = p.DisplayName,
                Description = p.Description,
                IconUrl = p.IconUrl,
                SupportedMediaTypes = p.SupportedMediaTypes.Select(m => m.ToString()).ToArray(),
                SupportedCapabilities = p.SupportedCapabilities.Select(c => c.ToString()).ToArray(),
                ConfigSchema = p.ConfigSchema
            })
            .ToList();

        return Ok(dtos);
    }

    // ---------------------------------------------------------------------
    // GET /CypherflixHub/Providers
    // ---------------------------------------------------------------------

    /// <summary>
    /// Configured instances from <see cref="PluginConfiguration.Providers"/>,
    /// with any field whose schema <see cref="ConfigField.Type"/> is
    /// <see cref="ConfigFieldType.Password"/> or <see cref="ConfigFieldType.ApiKey"/>
    /// masked to <c>"***"</c>. Admin-only.
    /// </summary>
    [HttpGet("Providers")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<IReadOnlyList<ProviderInstance>> GetInstances()
    {
        if (!IsAdmin())
        {
            return Forbid();
        }

        ProviderInstance[] stored = Plugin.Instance!.Configuration.Providers ?? Array.Empty<ProviderInstance>();
        List<ProviderInstance> masked = stored.Select(MaskSecrets).ToList();
        return Ok(masked);
    }

    // ---------------------------------------------------------------------
    // POST /CypherflixHub/Providers
    // ---------------------------------------------------------------------

    /// <summary>
    /// Create-or-update an instance. If <see cref="ProviderInstance.Id"/> matches
    /// an existing instance, the stored row is replaced; otherwise the row is
    /// appended. Field values equal to <c>"***"</c> are interpreted as
    /// "keep the previously stored value" so the masked GET round-trips safely.
    /// Admin-only.
    /// </summary>
    [HttpPost("Providers")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<ProviderInstance> SaveInstance([FromBody] ProviderInstance body)
    {
        if (!IsAdmin())
        {
            return Forbid();
        }

        if (body is null)
        {
            return BadRequest(new { Error = "Body is required." });
        }

        if (string.IsNullOrWhiteSpace(body.TypeId))
        {
            return BadRequest(new { Error = "TypeId is required." });
        }

        IMediaProvider? provider = _registry.Get(body.TypeId);
        if (provider is null)
        {
            return BadRequest(new { Error = $"Unknown TypeId '{body.TypeId}'." });
        }

        // Locate any existing instance so we can keep masked secrets.
        ProviderInstance[] existing = Plugin.Instance!.Configuration.Providers ?? Array.Empty<ProviderInstance>();
        ProviderInstance? prior = body.Id != Guid.Empty
            ? existing.FirstOrDefault(p => p.Id == body.Id)
            : null;

        // Build the merged row that will actually be persisted (with real secrets).
        ProviderInstance merged = new()
        {
            Id = body.Id != Guid.Empty ? body.Id : Guid.NewGuid(),
            TypeId = body.TypeId,
            Name = body.Name ?? string.Empty,
            Enabled = body.Enabled,
            EnabledCapabilities = body.EnabledCapabilities ?? Array.Empty<string>(),
            Config = MergeConfig(provider.ConfigSchema, body.Config ?? Array.Empty<ConfigEntry>(), prior?.Config)
        };

        // Required-field validation runs against the post-merge values so that
        // a masked "***" in the payload (which we just resolved to the prior
        // stored value) is treated as present.
        Dictionary<string, string> mergedFields = ToDictionary(merged.Config);
        foreach (ConfigField field in provider.ConfigSchema)
        {
            if (!field.Required)
            {
                continue;
            }

            if (!mergedFields.TryGetValue(field.Key, out string? value) || string.IsNullOrWhiteSpace(value))
            {
                return BadRequest(new { Error = $"Required field '{field.Key}' is missing." });
            }
        }

        // Append or replace, then persist.
        List<ProviderInstance> updated = existing.ToList();
        int idx = updated.FindIndex(p => p.Id == merged.Id);
        if (idx >= 0)
        {
            updated[idx] = merged;
        }
        else
        {
            updated.Add(merged);
        }

        Plugin.Instance!.Configuration.Providers = updated.ToArray();
        Plugin.Instance!.SaveConfiguration();

        _logger.LogInformation(
            "Provider instance '{Name}' ({Id}, type {TypeId}) saved.",
            merged.Name,
            merged.Id,
            merged.TypeId);

        // Return the saved row with secrets masked so the UI never sees them.
        return Ok(MaskSecrets(merged));
    }

    // ---------------------------------------------------------------------
    // DELETE /CypherflixHub/Providers/{id}
    // ---------------------------------------------------------------------

    /// <summary>Remove the instance with that id and persist. Admin-only.</summary>
    [HttpDelete("Providers/{id}")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult DeleteInstance([FromRoute] Guid id)
    {
        if (!IsAdmin())
        {
            return Forbid();
        }

        ProviderInstance[] existing = Plugin.Instance!.Configuration.Providers ?? Array.Empty<ProviderInstance>();
        ProviderInstance[] remaining = existing.Where(p => p.Id != id).ToArray();
        if (remaining.Length == existing.Length)
        {
            return NotFound();
        }

        Plugin.Instance!.Configuration.Providers = remaining;
        Plugin.Instance!.SaveConfiguration();

        _logger.LogInformation("Provider instance {Id} deleted.", id);

        return NoContent();
    }

    // ---------------------------------------------------------------------
    // POST /CypherflixHub/Providers/Test
    // ---------------------------------------------------------------------

    /// <summary>
    /// Resolve the provider, hydrate a <see cref="ProviderConfig"/> from the
    /// posted body, and call <see cref="IMediaProvider.TestConnectionAsync"/>.
    /// Admin-only.
    /// </summary>
    [HttpPost("Providers/Test")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<ActionResult<TestResult>> TestInstance(
        [FromBody] ProviderInstance body,
        CancellationToken ct)
    {
        if (!IsAdmin())
        {
            return Forbid();
        }

        if (body is null)
        {
            return BadRequest(new { Error = "Body is required." });
        }

        if (string.IsNullOrWhiteSpace(body.TypeId))
        {
            return BadRequest(new { Error = "TypeId is required." });
        }

        IMediaProvider? provider = _registry.Get(body.TypeId);
        if (provider is null)
        {
            return BadRequest(new { Error = $"Unknown TypeId '{body.TypeId}'." });
        }

        // Test runs against the posted values exactly. If the caller sends
        // "***" for a secret, we resolve it against the stored row (if any)
        // so that re-testing an existing instance from the UI works without
        // forcing the admin to retype the secret.
        ProviderInstance[] existing = Plugin.Instance!.Configuration.Providers ?? Array.Empty<ProviderInstance>();
        ProviderInstance? prior = body.Id != Guid.Empty
            ? existing.FirstOrDefault(p => p.Id == body.Id)
            : null;

        ConfigEntry[] mergedConfig = MergeConfig(
            provider.ConfigSchema,
            body.Config ?? Array.Empty<ConfigEntry>(),
            prior?.Config);

        ProviderInstance forHydration = new()
        {
            Id = body.Id != Guid.Empty ? body.Id : Guid.NewGuid(),
            TypeId = body.TypeId,
            Name = string.IsNullOrEmpty(body.Name) ? "(test)" : body.Name,
            Enabled = body.Enabled,
            EnabledCapabilities = body.EnabledCapabilities ?? Array.Empty<string>(),
            Config = mergedConfig
        };

        HashSet<Capability> capabilities = AggregatorHelpers.ParseCapabilities(forHydration.EnabledCapabilities);
        ProviderConfig cfg = AggregatorHelpers.HydrateConfig(forHydration, capabilities);

        try
        {
            TestResult result = await provider.TestConnectionAsync(cfg, ct).ConfigureAwait(false);
            return Ok(result);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "TestConnectionAsync threw for provider type '{TypeId}'.",
                body.TypeId);
            return Ok(new TestResult
            {
                Ok = false,
                Message = "Test failed.",
                Detail = ex.Message
            });
        }
    }

    // ---------------------------------------------------------------------
    // Auth helpers (verbatim from JELLYFIN-INTEGRATION.md §1.3)
    // ---------------------------------------------------------------------

    private Guid GetCurrentUserId()
    {
        string? v = User.FindFirst("Jellyfin-UserId")?.Value
                    ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return string.IsNullOrEmpty(v) ? Guid.Empty : Guid.Parse(v);
    }

    private bool IsAdmin() =>
        string.Equals(
            User.FindFirst("Jellyfin-IsAdministrator")?.Value,
            "true",
            StringComparison.OrdinalIgnoreCase);

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /// <summary>
    /// Returns a deep-ish copy of <paramref name="instance"/> with any
    /// secret-typed field value replaced by <see cref="SecretMask"/>. The
    /// stored array is never mutated.
    /// </summary>
    private ProviderInstance MaskSecrets(ProviderInstance instance)
    {
        IMediaProvider? provider = _registry.Get(instance.TypeId);
        HashSet<string> secretKeys = provider is null
            ? new HashSet<string>(StringComparer.Ordinal)
            : new HashSet<string>(
                provider.ConfigSchema
                    .Where(f => IsSecretField(f.Type))
                    .Select(f => f.Key),
                StringComparer.Ordinal);

        ConfigEntry[] storedConfig = instance.Config ?? Array.Empty<ConfigEntry>();
        ConfigEntry[] maskedConfig = storedConfig
            .Select(e => new ConfigEntry
            {
                Key = e.Key,
                Value = secretKeys.Contains(e.Key) && !string.IsNullOrEmpty(e.Value) ? SecretMask : e.Value
            })
            .ToArray();

        return new ProviderInstance
        {
            Id = instance.Id,
            TypeId = instance.TypeId,
            Name = instance.Name,
            Enabled = instance.Enabled,
            EnabledCapabilities = instance.EnabledCapabilities ?? Array.Empty<string>(),
            Config = maskedConfig
        };
    }

    /// <summary>
    /// Builds the persisted <see cref="ConfigEntry"/> array for an instance,
    /// applying the masked-merge rule: when the inbound value is
    /// <see cref="SecretMask"/> for a secret-typed field, the previously stored
    /// value is kept instead of overwriting the secret with the literal mask.
    /// </summary>
    private static ConfigEntry[] MergeConfig(
        IReadOnlyList<ConfigField> schema,
        IReadOnlyList<ConfigEntry> incoming,
        IReadOnlyList<ConfigEntry>? prior)
    {
        Dictionary<string, ConfigFieldType> typeByKey = schema.ToDictionary(
            f => f.Key,
            f => f.Type,
            StringComparer.Ordinal);

        Dictionary<string, string> priorByKey = ToDictionary(prior ?? Array.Empty<ConfigEntry>());

        // last-wins on duplicate keys, matching AggregatorHelpers.HydrateConfig.
        Dictionary<string, string> merged = new(StringComparer.Ordinal);
        foreach (ConfigEntry entry in incoming)
        {
            if (string.IsNullOrEmpty(entry.Key))
            {
                continue;
            }

            string value = entry.Value ?? string.Empty;

            bool isSecret = typeByKey.TryGetValue(entry.Key, out ConfigFieldType type)
                            && IsSecretField(type);
            if (isSecret && string.Equals(value, SecretMask, StringComparison.Ordinal))
            {
                // Keep the previously stored secret instead of clobbering it with "***".
                if (priorByKey.TryGetValue(entry.Key, out string? old))
                {
                    value = old;
                }
                else
                {
                    // No prior value to fall back to — drop the literal mask so a later
                    // required-field check fails cleanly rather than silently saving "***".
                    value = string.Empty;
                }
            }

            merged[entry.Key] = value;
        }

        return merged
            .Select(kv => new ConfigEntry { Key = kv.Key, Value = kv.Value })
            .ToArray();
    }

    private static Dictionary<string, string> ToDictionary(IReadOnlyList<ConfigEntry> entries)
    {
        Dictionary<string, string> dict = new(StringComparer.Ordinal);
        foreach (ConfigEntry entry in entries)
        {
            if (string.IsNullOrEmpty(entry.Key))
            {
                continue;
            }

            dict[entry.Key] = entry.Value ?? string.Empty;
        }

        return dict;
    }

    private static bool IsSecretField(ConfigFieldType type) =>
        type == ConfigFieldType.Password || type == ConfigFieldType.ApiKey;

    /// <summary>
    /// DTO for <c>GET /Providers/Types</c>. The enums are flattened to strings
    /// so the JSON the admin UI consumes is stable across enum reorderings.
    /// </summary>
    public class ProviderTypeDto
    {
        public required string TypeId { get; init; }
        public required string DisplayName { get; init; }
        public required string Description { get; init; }
        public string? IconUrl { get; init; }
        public required IReadOnlyList<string> SupportedMediaTypes { get; init; }
        public required IReadOnlyList<string> SupportedCapabilities { get; init; }
        public required IReadOnlyList<ConfigField> ConfigSchema { get; init; }
    }
}
