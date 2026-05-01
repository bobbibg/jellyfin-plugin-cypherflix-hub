using System.Collections.Generic;
using System.Linq;

namespace Jellyfin.Plugin.CypherflixHub.Core;

/// <summary>
/// Singleton holding every provider TYPE registered in DI. Used by the admin UI
/// to enumerate available types when adding a new instance, and by aggregators
/// to resolve a TypeId back to its implementation.
/// </summary>
public class ProviderRegistry
{
    private readonly Dictionary<string, IMediaProvider> _byTypeId;

    public ProviderRegistry(IEnumerable<IMediaProvider> providers)
    {
        _byTypeId = providers.ToDictionary(p => p.TypeId, p => p);
    }

    public IReadOnlyCollection<IMediaProvider> All => _byTypeId.Values;

    public IMediaProvider? Get(string typeId) =>
        _byTypeId.TryGetValue(typeId, out var p) ? p : null;

    public bool Contains(string typeId) => _byTypeId.ContainsKey(typeId);
}
