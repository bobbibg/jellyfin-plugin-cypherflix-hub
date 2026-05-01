using System;
using System.Net.Http;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.CypherflixHub;

/// <summary>
/// Registers plugin services into Jellyfin's DI container.
/// Each new provider type implementing <see cref="Core.IMediaProvider"/> should
/// be registered here as a singleton — see ARCHITECTURE.md ("Adding a provider").
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // Core registry that holds all known provider types.
        serviceCollection.AddSingleton<Core.ProviderRegistry>();

        // ---- Shared HTTP client used by provider HTTP clients --------------
        // Jellyfin doesn't expose IHttpClientFactory to plugins, so we register
        // a single HttpClient with a generous default timeout. The clients
        // themselves are stateless and pass per-request URLs/keys explicitly.
        serviceCollection.AddSingleton<HttpClient>(_ => new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(30)
        });

        // ---- Provider type registrations go here ----
        serviceCollection.AddSingleton<Providers.Jellyfin.JellyfinClient>();
        serviceCollection.AddSingleton<Core.IMediaProvider, Providers.Jellyfin.JellyfinProvider>();
        serviceCollection.AddSingleton<Providers.Jellyseerr.JellyseerrClient>();
        serviceCollection.AddSingleton<Core.IMediaProvider, Providers.Jellyseerr.JellyseerrProvider>();
        serviceCollection.AddSingleton<Providers.Readarr.ReadarrClient>();
        serviceCollection.AddSingleton<Core.IMediaProvider, Providers.Readarr.ReadarrProvider>();
        serviceCollection.AddSingleton<Core.IMediaProvider, Providers.ReadMeABook.ReadMeABookProvider>();

        // ---- Cross-cutting services ----
        serviceCollection.AddSingleton<Services.MeilisearchClient>();
        serviceCollection.AddHostedService<Services.IndexerService>();

        // ---- Aggregators ----
        // serviceCollection.AddSingleton<Services.Aggregators.SearchAggregator>();
        // serviceCollection.AddSingleton<Services.Aggregators.RequestAggregator>();
        // serviceCollection.AddSingleton<Services.Aggregators.CalendarAggregator>();

        // ---- Script injection (web UI) ----
        // SVC-005: register our index.html transformation with the File
        // Transformation plugin. See JELLYFIN-INTEGRATION.md §2.
        serviceCollection.AddHostedService<Services.FileTransformationRegistrar>();
    }
}
