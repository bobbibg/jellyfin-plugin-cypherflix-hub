using System.Collections.Generic;

namespace Jellyfin.Plugin.CypherflixHub.Core;

/// <summary>
/// Describes one configurable field on a provider type. Returned by
/// <see cref="IMediaProvider.ConfigSchema"/> so the admin UI can render a
/// matching form when adding/editing an instance.
/// </summary>
public class ConfigField
{
    /// <summary>Internal key. Stored in <see cref="ProviderInstance.Config"/>.</summary>
    public string Key { get; init; } = "";

    /// <summary>Label shown in the admin UI.</summary>
    public string Label { get; init; } = "";

    /// <summary>Hint shown under the field.</summary>
    public string? Description { get; init; }

    /// <summary>Field type — drives the input element rendered.</summary>
    public ConfigFieldType Type { get; init; } = ConfigFieldType.Text;

    /// <summary>Field is required for the provider to function.</summary>
    public bool Required { get; init; }

    /// <summary>Default value pre-filled when adding a new instance.</summary>
    public string? Default { get; init; }

    /// <summary>For <see cref="ConfigFieldType.Select"/>: the options.</summary>
    public IReadOnlyList<ConfigOption>? Options { get; init; }

    /// <summary>For <see cref="ConfigFieldType.Url"/>: the placeholder URL.</summary>
    public string? Placeholder { get; init; }
}

public enum ConfigFieldType
{
    Text,
    Url,
    Password,
    ApiKey,
    Number,
    Boolean,
    Select,
    Multiline
}

public class ConfigOption
{
    public string Value { get; init; } = "";
    public string Label { get; init; } = "";
}
