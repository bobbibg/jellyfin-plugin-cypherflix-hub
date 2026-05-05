using System;
using System.Net.Http;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.CypherflixHub;

/// <summary>Service registration for the Hub plugin shell.</summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // Single HttpClient for the reverse-proxy controller. Stateless, generous timeout.
        serviceCollection.AddSingleton(_ => new HttpClient { Timeout = TimeSpan.FromSeconds(60) });

        // Inject bootstrap.js into Jellyfin's index.html via the
        // jellyfin-plugin-file-transformation plugin.
        serviceCollection.AddHostedService<Services.FileTransformationRegistrar>();
    }
}
