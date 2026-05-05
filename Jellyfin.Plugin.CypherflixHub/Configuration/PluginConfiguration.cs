using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.CypherflixHub.Configuration;

/// <summary>
/// Plugin settings — only the backend URL + API token.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    public PluginConfiguration()
    {
        BackendUrl = "http://192.168.1.165:7960";
        ApiToken = string.Empty;
    }

    /// <summary>
    /// Base URL of cypherflix-grabber V2. No trailing slash. Defaults to the
    /// LAN-side IP. Reachable from the Jellyfin container at runtime.
    /// </summary>
    public string BackendUrl { get; set; }

    /// <summary>
    /// Shared secret matching the backend's CYPHERFLIX_API_TOKEN env var. Forwarded
    /// as the X-Cypherflix-Token header on every proxied request. Leave blank in
    /// development.
    /// </summary>
    public string ApiToken { get; set; }
}
