// SquadSpatialExtractor — Phase 2: structured spatial extraction.
//
// Loads Squad SDK .umap files via CUE4Parse and writes per-layer JSON files
// matching the schema produced by the (now-superseded) editor-based Python
// extractor in scripts/extraction/export_spatial_from_sdk.py. The schema
// stays compatible so build_v10_site_data.py can consume either source.
//
// Usage:
//   dotnet run                                    -> extract Manicouagan_RAAS_v1 only (default test)
//   dotnet run -- --all                           -> extract every gameplay layer
//   dotnet run -- --layer Manicouagan_RAAS_v2     -> single layer by name
//   dotnet run -- --filter Manicouagan            -> all layers whose name contains the substring
//
// Output goes to <output-dir> (defaults to <content-root>/../Saved/SquadMapsExport/spatial)
// with one <LayerName>.json per layer plus an index.json roll-up.
//
// Squad SDK content root must be specified via:
//   --content-root <path>            (CLI flag, highest precedence)
//   SQUAD_SDK_CONTENT env var        (fallback)
// Example: export SQUAD_SDK_CONTENT=/path/to/Squad/Content

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Core.i18N;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;

namespace SquadMaps.SpatialExtractor;

// ----------------------------------------------------------------------------
// Record types — JSON-compatible with the editor extractor's output schema.
// ----------------------------------------------------------------------------

public record Vec3(double location_x, double location_y, double location_z);

public record Rot3(double rotation_pitch, double rotation_yaw, double rotation_roll);

public record Main(
    string objectName,
    string className,
    double location_x,
    double location_y,
    double location_z);

public record CaptureZoneRecord(
    string objectName,
    string className,
    string? flagName,
    double? sphereRadius,
    double location_x,
    double location_y,
    double location_z);

public record Cluster(
    string objectName,
    string className,
    double? sphereRadius,
    double location_x,
    double location_y,
    double location_z,
    List<CaptureZoneRecord> captureZones);

public record NoDeployZone(
    string name,
    string? type,
    double location_x,
    double location_y,
    double location_z);

public record ProtectionZone(
    string displayName,
    string? teamid,
    double? deployableLockDistance,
    double location_x,
    double location_y,
    double location_z);

public record StagingZone(string name, double location_x, double location_y, double location_z);

public record VehicleSpawnerRecord(
    string name,
    string type,
    string? team,
    int? maxNum,
    double location_x,
    double location_y,
    double location_z,
    double rotation_pitch,
    double rotation_yaw,
    double rotation_roll);

public record DeployableRecord(
    string name,
    string type,
    string? team,
    double location_x,
    double location_y,
    double location_z);

public record Helipad(string name, double location_x, double location_y, double location_z);

public record DestructionCacheRecord(
    string name,
    string className,
    double location_x,
    double location_y,
    double location_z);

public record TeamSpawnEntry(
    string name,
    string className,
    string? team,
    double location_x,
    double location_y,
    double location_z);

public record MapBoundaryRecord(
    string name,
    string className,
    double location_x,
    double location_y,
    double location_z);

public record LaneLink(string? nodeA, string? nodeB);

public record LaneRecord(string name, string? colorHex, List<LaneLink> links);

public record LaneGraphRecord(List<LaneRecord> lanes);

public record CountsRecord(
    int clusters,
    int orphanCaptureZones,
    int mains,
    int noDeployZones,
    int protectionZones,
    int vehicleSpawners,
    int deployables,
    int helipads,
    int destructionCaches,
    int teamSpawnGroups,
    int teamSpawnPoints,
    bool mapBoundaryFound,
    bool laneGraphFound);

public record LayerData(
    string layerName,
    string levelPath,
    List<Main> mains,
    List<Cluster> clusters,
    List<CaptureZoneRecord> orphanCaptureZones,
    List<NoDeployZone> noDeployZones,
    List<ProtectionZone> protectionZones,
    List<StagingZone> stagingZones,
    List<VehicleSpawnerRecord> vehicleSpawners,
    List<DeployableRecord> deployables,
    List<Helipad> helipads,
    List<DestructionCacheRecord> destructionCaches,
    List<TeamSpawnEntry> teamSpawnGroups,
    List<TeamSpawnEntry> teamSpawnPoints,
    MapBoundaryRecord? mapBoundary,
    LaneGraphRecord? laneGraph,
    CountsRecord counts);

// ----------------------------------------------------------------------------
// Extractor — pulls structured data out of a loaded UE package.
// ----------------------------------------------------------------------------

public static class LayerExtractor
{
    public static LayerData Extract(IPackage package, string layerName, string levelPath)
    {
        var exports = package.GetExports().ToList();

        var mains = exports
            .Where(e => ClassName(e).Contains("CaptureZoneMain", StringComparison.OrdinalIgnoreCase))
            .Select(ExtractMain)
            .ToList();

        var clusterActors = exports
            .Where(e => ClassName(e).Contains("CaptureZoneCluster", StringComparison.OrdinalIgnoreCase))
            .ToList();

        // Walk every BP_CaptureZone_C and group by parent cluster via the
        // actual UE attachment hierarchy (the capture zone's RootComponent
        // has an AttachParent pointing at the cluster's scene root, whose
        // Outer is the cluster actor).
        var allCaptureZones = exports
            .Where(e => ClassName(e).Equals("BP_CaptureZone_C", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var captureZonesByCluster = new Dictionary<string, List<UObject>>();
        var unparented = new List<UObject>();
        foreach (var cz in allCaptureZones)
        {
            var parentActor = GetAttachParentActor(cz);
            if (parentActor != null && ClassName(parentActor).Contains("CaptureZoneCluster", StringComparison.OrdinalIgnoreCase))
            {
                var key = parentActor.Name;
                if (!captureZonesByCluster.ContainsKey(key))
                    captureZonesByCluster[key] = new List<UObject>();
                captureZonesByCluster[key].Add(cz);
            }
            else
            {
                unparented.Add(cz);
            }
        }

        var clusters = new List<Cluster>();
        foreach (var clusterActor in clusterActors)
        {
            var children = captureZonesByCluster.TryGetValue(clusterActor.Name, out var zones)
                ? zones.Select(ExtractCaptureZone).ToList()
                : new List<CaptureZoneRecord>();
            clusters.Add(ExtractCluster(clusterActor, children));
        }

        // Orphans = capture zones with no cluster parent (e.g. AAS layers
        // where capture zones are top-level actors)
        var orphanCaptureZones = unparented
            .Select(ExtractCaptureZone)
            .ToList();

        var noDeployZones = exports
            .Where(e => ClassName(e).Contains("NoDeployZone", StringComparison.OrdinalIgnoreCase))
            .Select(ExtractNoDeployZone)
            .ToList();

        var protectionZones = exports
            .Where(e => ClassName(e).Contains("ProtectionZone", StringComparison.OrdinalIgnoreCase))
            .Select(ExtractProtectionZone)
            .ToList();

        var stagingZones = exports
            .Where(e => ClassName(e).Contains("StagingZone", StringComparison.OrdinalIgnoreCase))
            .Select(e => new StagingZone(GetActorLabel(e), GetLocation(e).X, GetLocation(e).Y, GetLocation(e).Z))
            .ToList();

        var vehicleSpawners = exports
            .Where(e => ClassName(e).Contains("VehicleSpawner", StringComparison.OrdinalIgnoreCase)
                     && !ClassName(e).Contains("Deployable", StringComparison.OrdinalIgnoreCase))
            .Select(ExtractVehicleSpawner)
            .ToList();

        var deployables = exports
            .Where(e => ClassName(e).Contains("DeployableSpawner", StringComparison.OrdinalIgnoreCase)
                     || ClassName(e).Contains("BP_Deployable", StringComparison.OrdinalIgnoreCase))
            .Select(ExtractDeployable)
            .ToList();

        var helipads = exports
            .Where(e => ClassName(e).Contains("Helipad", StringComparison.OrdinalIgnoreCase))
            .Select(e =>
            {
                var loc = GetLocation(e);
                return new Helipad(GetActorLabel(e), loc.X, loc.Y, loc.Z);
            })
            .ToList();

        var destructionCaches = exports
            .Where(e => ClassName(e).Contains("DestructionCache", StringComparison.OrdinalIgnoreCase))
            .Select(e =>
            {
                var loc = GetLocation(e);
                return new DestructionCacheRecord(
                    GetActorLabel(e),
                    ClassName(e),
                    loc.X, loc.Y, loc.Z);
            })
            .ToList();

        var teamSpawnGroups = exports
            .Where(e => ClassName(e).Equals("SQTeamSpawnGroup", StringComparison.OrdinalIgnoreCase))
            .Select(ExtractTeamSpawnEntry)
            .ToList();

        var teamSpawnPoints = exports
            .Where(e => ClassName(e).Equals("SQTeamSpawnPoint", StringComparison.OrdinalIgnoreCase))
            .Select(ExtractTeamSpawnEntry)
            .ToList();

        MapBoundaryRecord? mapBoundary = null;
        var mapBoundaryActor = exports
            .FirstOrDefault(e => ClassName(e).Equals("SQMapBoundary", StringComparison.OrdinalIgnoreCase));
        if (mapBoundaryActor != null)
        {
            var loc = GetLocation(mapBoundaryActor);
            mapBoundary = new MapBoundaryRecord(
                GetActorLabel(mapBoundaryActor),
                ClassName(mapBoundaryActor),
                loc.X, loc.Y, loc.Z);
        }

        LaneGraphRecord? laneGraph = null;
        var initializer = exports
            .FirstOrDefault(e => ClassName(e).Contains("RAASLaneInitializer", StringComparison.OrdinalIgnoreCase));
        if (initializer != null)
        {
            laneGraph = ExtractLaneGraph(initializer);
        }

        var counts = new CountsRecord(
            clusters.Count,
            orphanCaptureZones.Count,
            mains.Count,
            noDeployZones.Count,
            protectionZones.Count,
            vehicleSpawners.Count,
            deployables.Count,
            helipads.Count,
            destructionCaches.Count,
            teamSpawnGroups.Count,
            teamSpawnPoints.Count,
            mapBoundary != null,
            laneGraph != null);

        return new LayerData(
            layerName,
            levelPath,
            mains,
            clusters,
            orphanCaptureZones,
            noDeployZones,
            protectionZones,
            stagingZones,
            vehicleSpawners,
            deployables,
            helipads,
            destructionCaches,
            teamSpawnGroups,
            teamSpawnPoints,
            mapBoundary,
            laneGraph,
            counts);
    }

    // -- helpers --

    private static string ClassName(UObject obj) => obj.Class?.Name.Text ?? "";

    /// <summary>
    /// Get the actor's editor label, falling back to its package name when
    /// the label is missing OR empty (some auto-generated actors have an
    /// empty ActorLabel string instead of null).
    /// </summary>
    private static string GetActorLabel(UObject obj)
    {
        var label = obj.GetOrDefault<string?>("ActorLabel");
        return string.IsNullOrWhiteSpace(label) ? obj.Name : label!;
    }

    /// <summary>
    /// Get the world-space location of an actor by walking the
    /// RootComponent.RelativeLocation chain through all AttachParent links.
    /// Required because Squad's capture zones are attached to their parent
    /// cluster's scene root via AttachParent, so RelativeLocation alone is
    /// only the offset from the cluster, not the world position.
    /// </summary>
    private static FVector GetLocation(UObject obj)
    {
        var rootRef = obj.GetOrDefault<FPackageIndex?>("RootComponent");
        if (rootRef == null || rootRef.IsNull) return default;
        var root = rootRef.Load();
        if (root == null) return default;
        return AccumulateWorldLocation(root);
    }

    /// <summary>
    /// Walk a SceneComponent's AttachParent chain and sum all RelativeLocations
    /// to get the effective world location. Stops when AttachParent is null.
    /// Cycle protection: max 16 hops.
    /// </summary>
    private static FVector AccumulateWorldLocation(UObject sceneComponent)
    {
        var total = new FVector(0, 0, 0);
        var current = sceneComponent;
        for (int hop = 0; hop < 16; hop++)
        {
            if (current == null) break;
            var local = current.GetOrDefault<FVector>("RelativeLocation");
            total = new FVector(total.X + local.X, total.Y + local.Y, total.Z + local.Z);

            var parentRef = current.GetOrDefault<FPackageIndex?>("AttachParent");
            if (parentRef == null || parentRef.IsNull) break;
            current = parentRef.Load();
        }
        return total;
    }

    private static FRotator GetRotation(UObject obj)
    {
        var rootRef = obj.GetOrDefault<FPackageIndex?>("RootComponent");
        if (rootRef == null || rootRef.IsNull) return default;
        var root = rootRef.Load();
        if (root == null) return default;
        return root.GetOrDefault<FRotator>("RelativeRotation");
    }

    /// <summary>
    /// Find the parent actor of a scene component by walking AttachParent
    /// up to a SceneComponent whose Outer is a different actor than the one
    /// we started with. Used to associate capture zones with their parent
    /// cluster via the actual UE actor hierarchy.
    /// </summary>
    private static UObject? GetAttachParentActor(UObject actor)
    {
        var rootRef = actor.GetOrDefault<FPackageIndex?>("RootComponent");
        if (rootRef == null || rootRef.IsNull) return null;
        var root = rootRef.Load();
        if (root == null) return null;
        var parentRef = root.GetOrDefault<FPackageIndex?>("AttachParent");
        if (parentRef == null || parentRef.IsNull) return null;
        var parentComp = parentRef.Load();
        if (parentComp == null) return null;
        // The parent component's Outer is the parent actor (ResolvedObject -> UObject)
        return parentComp.Outer?.Load();
    }

    /// <summary>
    /// Find a child component of an actor by class-name substring. Walks both
    /// InstanceComponents and BlueprintCreatedComponents arrays.
    /// </summary>
    private static UObject? FindComponent(UObject actor, string classNameFragment)
    {
        foreach (var arrayProp in new[] { "InstanceComponents", "BlueprintCreatedComponents" })
        {
            var refs = actor.GetOrDefault<FPackageIndex[]?>(arrayProp);
            if (refs == null) continue;
            foreach (var compRef in refs)
            {
                if (compRef.IsNull) continue;
                var comp = compRef.Load();
                if (comp == null) continue;
                if (ClassName(comp).Contains(classNameFragment, StringComparison.OrdinalIgnoreCase))
                    return comp;
            }
        }
        return null;
    }

    /// <summary>
    /// Strip a UE enum-namespace prefix like "ESQTeam::Team_One" to just "Team_One".
    /// Matches the editor extractor's behavior of using enum.name.
    /// </summary>
    private static string? StripEnumNamespace(string? raw)
    {
        if (string.IsNullOrEmpty(raw)) return raw;
        var idx = raw.IndexOf("::", StringComparison.Ordinal);
        if (idx < 0) return raw;
        return raw[(idx + 2)..];
    }

    /// <summary>
    /// Read FlagName as a string. The property is FText with SourceString
    /// holding the English name like "Logging Camp".
    /// </summary>
    private static string? ReadFlagName(UObject? component)
    {
        if (component == null) return null;
        var flagText = component.GetOrDefault<FText?>("FlagName");
        if (flagText == null) return null;
        return flagText.Text;
    }

    /// <summary>
    /// Extract the lane prefix from an actor label like "A1-Logging Camp" -> "A1".
    /// Used to associate capture zones with their parent cluster.
    /// </summary>
    private static string? ExtractLanePrefix(string label)
    {
        if (string.IsNullOrEmpty(label)) return null;
        var dashIdx = label.IndexOf('-');
        if (dashIdx <= 0) return null;
        var prefix = label[..dashIdx];
        // Heuristic: prefix should look like a lane code (letter + digits, max 3 chars)
        if (prefix.Length > 3) return null;
        if (!char.IsLetter(prefix[0])) return null;
        return prefix;
    }

    private static Main ExtractMain(UObject actor)
    {
        var loc = GetLocation(actor);
        return new Main(
            GetActorLabel(actor),
            ClassName(actor),
            loc.X, loc.Y, loc.Z);
    }

    private static Cluster ExtractCluster(UObject actor, List<CaptureZoneRecord> children)
    {
        var loc = GetLocation(actor);
        // Cluster radius lives on the Sphere instance component (CapsuleComponent
        // or SphereComponent). Look for it.
        double? sphereRadius = null;
        var sphere = FindComponent(actor, "Sphere");
        if (sphere != null)
        {
            sphereRadius = sphere.GetOrDefault<float>("SphereRadius");
            if (sphereRadius == 0.0) sphereRadius = null;
        }
        return new Cluster(
            GetActorLabel(actor),
            ClassName(actor),
            sphereRadius,
            loc.X, loc.Y, loc.Z,
            children);
    }

    private static CaptureZoneRecord ExtractCaptureZone(UObject actor)
    {
        var loc = GetLocation(actor);
        var sqComp = FindComponent(actor, "SQCaptureZone");
        var flagName = ReadFlagName(sqComp);
        double? sphereRadius = null;
        var sphere = FindComponent(actor, "Sphere");
        if (sphere != null)
        {
            sphereRadius = sphere.GetOrDefault<float>("SphereRadius");
            if (sphereRadius == 0.0) sphereRadius = null;
        }
        return new CaptureZoneRecord(
            GetActorLabel(actor),
            ClassName(actor),
            flagName,
            sphereRadius,
            loc.X, loc.Y, loc.Z);
    }

    private static NoDeployZone ExtractNoDeployZone(UObject actor)
    {
        var loc = GetLocation(actor);
        var zoneType = actor.GetOrDefault<string?>("ZoneType")
                       ?? actor.GetOrDefault<FName?>("ZoneType")?.Text;
        return new NoDeployZone(
            GetActorLabel(actor),
            zoneType,
            loc.X, loc.Y, loc.Z);
    }

    private static ProtectionZone ExtractProtectionZone(UObject actor)
    {
        var loc = GetLocation(actor);
        var teamid = actor.GetOrDefault<string?>("TeamId")
                     ?? actor.GetOrDefault<FName?>("TeamId")?.Text;
        var lockDist = actor.GetOrDefault<float>("DeployableLockDistance");
        return new ProtectionZone(
            GetActorLabel(actor),
            teamid,
            lockDist == 0.0 ? null : lockDist,
            loc.X, loc.Y, loc.Z);
    }

    private static string? ReadTeamProperty(UObject obj)
    {
        // Team is usually a ByteProperty / EnumProperty serialized as
        // "ESQTeam::Team_One". CUE4Parse may surface it as FName or string.
        var raw = obj.GetOrDefault<FName?>("Team")?.Text
                  ?? obj.GetOrDefault<string?>("Team");
        return StripEnumNamespace(raw);
    }

    private static VehicleSpawnerRecord ExtractVehicleSpawner(UObject actor)
    {
        var loc = GetLocation(actor);
        var rot = GetRotation(actor);
        var maxNum = actor.GetOrDefault<int?>("MaxNumber");
        return new VehicleSpawnerRecord(
            GetActorLabel(actor),
            ClassName(actor),
            ReadTeamProperty(actor),
            maxNum,
            loc.X, loc.Y, loc.Z,
            rot.Pitch, rot.Yaw, rot.Roll);
    }

    private static DeployableRecord ExtractDeployable(UObject actor)
    {
        var loc = GetLocation(actor);
        return new DeployableRecord(
            GetActorLabel(actor),
            ClassName(actor),
            ReadTeamProperty(actor),
            loc.X, loc.Y, loc.Z);
    }

    private static TeamSpawnEntry ExtractTeamSpawnEntry(UObject actor)
    {
        var loc = GetLocation(actor);
        return new TeamSpawnEntry(
            GetActorLabel(actor),
            ClassName(actor),
            ReadTeamProperty(actor),
            loc.X, loc.Y, loc.Z);
    }

    /// <summary>
    /// Extract the lane graph from the SQRAASLaneInitializer component.
    /// The graph lives in the "AAS Lanes" array property; each element is a
    /// SQDesignAASLane struct with LaneName + AASLaneLinks fields. The link
    /// field names carry blueprint variable hash suffixes (per UE convention)
    /// so we read the array as a generic JObject and look up the fields by
    /// prefix to be hash-agnostic.
    /// </summary>
    private static LaneGraphRecord? ExtractLaneGraph(UObject initializer)
    {
        // The simplest robust way: serialize the initializer's properties
        // to JObject and walk the array. CUE4Parse's JSON serialization
        // already resolves the hash-suffixed names.
        var jsonText = JsonConvert.SerializeObject(initializer);
        var root = Newtonsoft.Json.Linq.JObject.Parse(jsonText);
        var lanesArray = root["Properties"]?["AAS Lanes"] as Newtonsoft.Json.Linq.JArray;
        if (lanesArray == null) return null;

        var lanes = new List<LaneRecord>();
        foreach (var laneTok in lanesArray)
        {
            var laneObj = laneTok as Newtonsoft.Json.Linq.JObject;
            if (laneObj == null) continue;

            string? laneName = null;
            string? colorHex = null;
            Newtonsoft.Json.Linq.JArray? linksArr = null;

            foreach (var prop in laneObj.Properties())
            {
                var n = prop.Name;
                if (n.StartsWith("LaneName", StringComparison.OrdinalIgnoreCase))
                    laneName = prop.Value?.ToString();
                else if (n.StartsWith("LaneNodesColor", StringComparison.OrdinalIgnoreCase))
                    colorHex = prop.Value?["Hex"]?.ToString();
                else if (n.StartsWith("AASLaneLinks", StringComparison.OrdinalIgnoreCase))
                    linksArr = prop.Value as Newtonsoft.Json.Linq.JArray;
            }

            if (laneName == null) continue;

            var links = new List<LaneLink>();
            if (linksArr != null)
            {
                foreach (var linkTok in linksArr)
                {
                    var linkObj = linkTok as Newtonsoft.Json.Linq.JObject;
                    if (linkObj == null) continue;
                    var nodeA = ExtractNodeRefName(linkObj["NodeA"]);
                    var nodeB = ExtractNodeRefName(linkObj["NodeB"]);
                    links.Add(new LaneLink(nodeA, nodeB));
                }
            }

            lanes.Add(new LaneRecord(laneName, colorHex, links));
        }

        return new LaneGraphRecord(lanes);
    }

    /// <summary>
    /// Pull the actor name out of an FPackageIndex JObject — strip the
    /// "Class'Path:Sub.Name'" prefix wrapper and return just the bare name.
    /// </summary>
    private static string? ExtractNodeRefName(Newtonsoft.Json.Linq.JToken? refToken)
    {
        var objName = refToken?["ObjectName"]?.ToString();
        if (string.IsNullOrEmpty(objName)) return null;
        // Format: "BP_CaptureZoneCluster_C'Manicouagan_RAAS_v1:PersistentLevel.A1-CaptureZoneCluster'"
        var dotIdx = objName.LastIndexOf('.');
        var quoteIdx = objName.LastIndexOf('\'');
        if (dotIdx > 0 && quoteIdx > dotIdx)
            return objName[(dotIdx + 1)..quoteIdx];
        return objName;
    }
}

// ----------------------------------------------------------------------------
// Program — argument parsing + extraction loop.
// ----------------------------------------------------------------------------

public static class Program
{
    private const string DefaultTestLayer = "Manicouagan_RAAS_v1";

    public static int Main(string[] args)
    {
        // Parse args
        bool extractAll = false;
        string? specificLayer = null;
        string? filter = null;
        string? squadContentRoot = null;
        string? outputDir = null;

        for (int i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if (arg == "--all") extractAll = true;
            else if (arg == "--layer" && i + 1 < args.Length) specificLayer = args[++i];
            else if (arg == "--filter" && i + 1 < args.Length) filter = args[++i];
            else if (arg == "--out" && i + 1 < args.Length) outputDir = args[++i];
            else if (arg == "--content-root" && i + 1 < args.Length) squadContentRoot = args[++i];
            else if (arg == "--help" || arg == "-h") { PrintHelp(); return 0; }
        }

        // Resolve Squad SDK content root: CLI flag > env var > error
        // No hardcoded default — installs vary across machines.
        squadContentRoot ??= Environment.GetEnvironmentVariable("SQUAD_SDK_CONTENT");
        if (string.IsNullOrEmpty(squadContentRoot))
        {
            Console.Error.WriteLine("ERROR: Squad SDK content root not set.");
            Console.Error.WriteLine("  Pass --content-root <path>");
            Console.Error.WriteLine("  Or set the SQUAD_SDK_CONTENT environment variable.");
            Console.Error.WriteLine("  Example: export SQUAD_SDK_CONTENT=$HOME/SquadEditor/Squad/Content");
            return 1;
        }

        // Resolve output dir: CLI flag > env var > <content-root>/../Saved/SquadMapsExport/spatial
        outputDir ??= Environment.GetEnvironmentVariable("SQUAD_SDK_SPATIAL_OUT");
        if (string.IsNullOrEmpty(outputDir))
        {
            // Default sibling of the content root: <root>/../Saved/SquadMapsExport/spatial
            var savedDir = Path.GetFullPath(Path.Combine(squadContentRoot, "..", "Saved", "SquadMapsExport", "spatial"));
            outputDir = savedDir;
        }

        Console.WriteLine("=== SquadSpatialExtractor ===");
        Console.WriteLine($"Squad content root: {squadContentRoot}");
        Console.WriteLine($"Output directory:   {outputDir}");

        if (!Directory.Exists(squadContentRoot))
        {
            Console.Error.WriteLine($"ERROR: Squad content root does not exist: {squadContentRoot}");
            return 1;
        }
        Directory.CreateDirectory(outputDir);

        var versions = new VersionContainer(EGame.GAME_Squad);
        var provider = new DefaultFileProvider(
            squadContentRoot,
            SearchOption.AllDirectories,
            versions: versions,
            pathComparer: StringComparer.OrdinalIgnoreCase);

        Console.WriteLine("Initializing file provider...");
        provider.Initialize();
        Console.WriteLine($"  {provider.Files.Count} files seen.");

        // Find all gameplay layer umaps
        var gameplayLayers = provider.Files
            .Where(kvp => kvp.Key.Contains("Gameplay_Layers/", StringComparison.OrdinalIgnoreCase)
                       && kvp.Key.EndsWith(".umap", StringComparison.OrdinalIgnoreCase))
            .Select(kvp => kvp.Key)
            .OrderBy(p => p)
            .ToList();

        // Filter to selected layers
        List<string> targets;
        if (specificLayer != null)
        {
            targets = gameplayLayers
                .Where(p => Path.GetFileNameWithoutExtension(p).Equals(specificLayer, StringComparison.OrdinalIgnoreCase))
                .ToList();
            Console.WriteLine($"Filter: --layer {specificLayer} → {targets.Count} match(es)");
        }
        else if (filter != null)
        {
            targets = gameplayLayers
                .Where(p => Path.GetFileNameWithoutExtension(p).Contains(filter, StringComparison.OrdinalIgnoreCase))
                .ToList();
            Console.WriteLine($"Filter: --filter '{filter}' → {targets.Count} match(es)");
        }
        else if (extractAll)
        {
            targets = gameplayLayers;
            Console.WriteLine($"--all → {targets.Count} layers");
        }
        else
        {
            targets = gameplayLayers
                .Where(p => Path.GetFileNameWithoutExtension(p).Equals(DefaultTestLayer, StringComparison.OrdinalIgnoreCase))
                .ToList();
            Console.WriteLine($"Default test layer: {DefaultTestLayer} → {targets.Count} match(es)");
        }

        if (targets.Count == 0)
        {
            Console.Error.WriteLine("No matching layers. Use --help for options.");
            return 2;
        }

        var index = new List<object>();
        int successCount = 0;
        int failCount = 0;

        foreach (var levelPath in targets)
        {
            var packagePath = levelPath[..^".umap".Length];
            var layerName = Path.GetFileNameWithoutExtension(levelPath);
            Console.Write($"  [{layerName}]... ");
            try
            {
                var package = provider.LoadPackage(packagePath);
                var data = LayerExtractor.Extract(package, layerName, packagePath);
                var jsonText = JsonConvert.SerializeObject(data, Formatting.Indented);
                var outPath = Path.Combine(outputDir, layerName + ".json");
                File.WriteAllText(outPath, jsonText);
                index.Add(new
                {
                    layerName = data.layerName,
                    levelPath = data.levelPath,
                    counts = data.counts,
                });
                Console.WriteLine($"OK ({data.counts.clusters} clusters, {data.counts.orphanCaptureZones} orphan CZs, lanes={data.laneGraph?.lanes?.Count ?? 0})");
                successCount++;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"FAIL: {ex.Message}");
                failCount++;
            }
        }

        // Write index.json
        var indexPath = Path.Combine(outputDir, "index.json");
        File.WriteAllText(indexPath, JsonConvert.SerializeObject(index, Formatting.Indented));
        Console.WriteLine();
        Console.WriteLine($"=== Done: {successCount} succeeded, {failCount} failed ===");
        Console.WriteLine($"Output: {outputDir}");
        return failCount > 0 ? 4 : 0;
    }

    private static void PrintHelp()
    {
        Console.WriteLine("Usage: dotnet run -- [options]");
        Console.WriteLine();
        Console.WriteLine("Squad SDK content root (required, set one of these):");
        Console.WriteLine("  --content-root <path>     Path to your Squad SDK Content folder");
        Console.WriteLine("  $SQUAD_SDK_CONTENT        Environment variable fallback");
        Console.WriteLine();
        Console.WriteLine("Selection:");
        Console.WriteLine("  --all                     Extract every gameplay layer in the SDK");
        Console.WriteLine("  --layer <Name>            Extract one layer by exact name (no .umap)");
        Console.WriteLine("  --filter <substring>      Extract all layers matching the substring");
        Console.WriteLine();
        Console.WriteLine("Output:");
        Console.WriteLine("  --out <dir>               Override output directory");
        Console.WriteLine("                            (default: <content-root>/../Saved/SquadMapsExport/spatial)");
        Console.WriteLine();
        Console.WriteLine("  --help                    Show this help");
        Console.WriteLine();
        Console.WriteLine("With no selection arg, extracts " + DefaultTestLayer + " as a smoke test.");
    }
}
