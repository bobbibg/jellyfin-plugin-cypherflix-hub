using System.Collections.Generic;

namespace Jellyfin.Plugin.CypherflixHub.Core;

/// <summary>
/// The hydrated config for ONE provider instance, passed by the framework into
/// every provider method so the provider doesn't have to look up its own state.
/// Includes the user-set field values plus the instance metadata (name, enabled
/// capabilities) so providers can branch on them.
/// </summary>
public class ProviderConfig
{
    /// <summary>Stable instance identifier — survives renames.</summary>
    public required System.Guid InstanceId { get; init; }

    /// <summary>User-given name e.g. "Books Readarr", "Comics Readarr".</summary>
    public required string InstanceName { get; init; }

    /// <summary>Capabilities the admin enabled on this instance.</summary>
    public required IReadOnlySet<Capability> EnabledCapabilities { get; init; }

    /// <summary>Field values keyed by <see cref="ConfigField.Key"/>.</summary>
    public required IReadOnlyDictionary<string, string> Fields { get; init; }

    /// <summary>Convenience accessor that returns null for missing keys.</summary>
    public string? Get(string key) => Fields.TryGetValue(key, out var v) ? v : null;

    /// <summary>Convenience accessor that returns the given default for missing keys.</summary>
    public string GetOrDefault(string key, string fallback) => Get(key) ?? fallback;
}
