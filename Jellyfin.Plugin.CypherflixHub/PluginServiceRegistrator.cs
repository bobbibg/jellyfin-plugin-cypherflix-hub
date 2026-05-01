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

        // ---- Provider type registrations go here ----
        serviceCollection.AddSingleton<Providers.Jellyfin.JellyfinClient>();
        serviceCollection.AddSingleton<Core.IMediaProvider, Providers.Jellyfin.JellyfinProvider>();
        // serviceCollection.AddSingleton<Core.IMediaProvider, Providers.JellyseerrProvider>();
        // serviceCollection.AddSingleton<Core.IMediaProvider, Providers.ReadarrProvider>();
        // serviceCollection.AddSingleton<Core.IMediaProvider, Providers.ReadMeABookProvider>();

        // ---- Cross-cutting services ----
        serviceCollection.AddSingleton<Services.MeilisearchClient>();
        // serviceCollection.AddHostedService<Services.IndexerService>();

        // ---- Aggregators ----
        // serviceCollection.AddSingleton<Services.Aggregators.SearchAggregator>();
        // serviceCollection.AddSingleton<Services.Aggregators.RequestAggregator>();
        // serviceCollection.AddSingleton<Services.Aggregators.CalendarAggregator>();

        // ---- Script injection (web UI) ----
        // serviceCollection.AddHostedService<Services.ScriptInjector>();
    }
}
