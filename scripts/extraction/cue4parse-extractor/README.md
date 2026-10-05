# Squad spatial extractor (CUE4Parse)

WSL/Linux tool that reads Squad SDK `.umap` files directly via
[CUE4Parse](https://github.com/FabianFG/CUE4Parse) and dumps lane graphs
+ spatial data to JSON. No Squad Editor needed.

## Setup

The extractor depends on the dotnet 10 SDK (upstream CUE4Parse targets net10.0) and on the CUE4Parse git submodule.

```bash
# 1. Install dotnet 10 SDK user-local (no sudo needed)
curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
chmod +x /tmp/dotnet-install.sh
/tmp/dotnet-install.sh --channel 10.0 --install-dir "$HOME/.dotnet"

# 2. Add to your shell rc:
echo 'export DOTNET_ROOT="$HOME/.dotnet"' >> ~/.bashrc
echo 'export PATH="$HOME/.dotnet:$PATH"' >> ~/.bashrc
source ~/.bashrc

# 3. Initialize the CUE4Parse submodule (after cloning the repo)
git submodule update --init --recursive scripts/extraction/cue4parse-extractor/CUE4Parse
```

## Configure your Squad SDK location

The extractor needs to know where your Squad SDK Content folder lives.
Two ways to specify it:

```bash
# Option A: environment variable (recommended for repeated runs)
export SQUAD_SDK_CONTENT=/path/to/Squad/Content

# Option B: --content-root CLI flag (per-run override)
dotnet run -- --content-root /path/to/Squad/Content --all
```

The output directory defaults to `<content-root>/../Saved/SquadMapsExport/spatial`.
Override with `--out <dir>` if you want it elsewhere.

## Build & run

```bash
cd scripts/extraction/cue4parse-extractor/SquadSpatialExtractor
dotnet build

# Smoke test on Manicouagan_RAAS_v1
dotnet run --no-build

# Extract a specific layer
dotnet run --no-build -- --layer Manicouagan_RAAS_v2

# Extract every layer the SDK has on disk (~3 minutes)
dotnet run --no-build -- --all

# Filter by substring (extracts every Manicouagan layer, etc)
dotnet run --no-build -- --filter Manicouagan

# Diagnostics: print every export of matching .uasset files as JSON
# (e.g. projectile InitialSpeed / gravity scale for the mortar tool)
dotnet run --no-build -- --dump-asset Projectiles/BP_Mortarround4
```

Output: one `<LayerName>.json` per layer + an `index.json` roll-up.

## How it works

CUE4Parse loads `.umap` binaries directly from disk — no editor needed,
no PIE, no Nanite mesh builds. Squad's UE 5.7 build (since the 10.5 SDK) is
supported via the explicit `EGame.GAME_Squad` enum value in CUE4Parse.

The extractor walks each layer's exports for relevant actor classes:
- `BP_CaptureZoneCluster_C`, `BP_CaptureZone_C`, `BP_CaptureZoneMain_C`
- `BP_NoDeployZone_C`, `BP_VehicleSpawner_C`, `BP_SQDeployableSpawner_C`
- `SQTeamSpawnGroup`, `SQTeamSpawnPoint`, `SQMapBoundary`
- `BP_RAASLaneGraph_C` and its `SQRAASLaneInitializer_C` component

Cluster positions are walked through the actor `RootComponent.AttachParent`
chain so cluster-attached zones get their correct world position. Capture
zone `FlagName` is read from `SQCaptureZoneComponent.FlagName` (an FText).

The lane graph lives on the `SQRAASLaneInitializer_C` component as the
`AAS Lanes` array of `SQDesignAASLane` structs. Each lane has a `LaneName`,
a per-lane color, and an `AASLaneLinks` array of `{NodeA, NodeB}` references
that resolve to actual capture zone cluster actors. CUE4Parse reads all of
this from the serialized design data — no `BeginPlay` required.

### World Partition layers (Squad 10.6+)

`*_WP` layers (e.g. `Yehorivka_RAAS_v1_WP`) keep almost nothing in the
`.umap`. Each actor is its own package under the mount's
`Content/__ExternalActors__/` mirror of the level path:

```
SquadGame/Content/Maps/Yehorivka/Gameplay_Layers/Yehorivka_RAAS_v1_WP.umap
SquadGame/Content/__ExternalActors__/Maps/Yehorivka/Gameplay_Layers/Yehorivka_RAAS_v1_WP/**.uasset
```

`LayerExtractor.LoadLayerExports` loads those packages alongside the
`.umap` (the run log prints `(+N external actors)`). The actors still
reference each other as imports of the level package, which CUE4Parse
can't resolve because each target lives in another package. `LoadRef`
falls back to an index of the loaded actors keyed by their path below
`PersistentLevel`. Without it, `AttachParent` chains stop at the first
hop: capture zones come out as orphans at raw local offsets, and
everything under a lane-graph actor shifts by that actor's translation.
With it, the WP layers extract identically to their non-WP twins.

## Why this exists

The Squad SDK Editor's Python API exposes only AActor base properties for
Squad's gameplay blueprints — `Lanes`, `FlagName`, `SphereRadius`, etc are
all unreachable from a static editor load. Loading levels also triggers
Nanite mesh compiles that can OOM the editor on heavy maps. CUE4Parse
sidesteps both problems by reading the umap binary directly.
