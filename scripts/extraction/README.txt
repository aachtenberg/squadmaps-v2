Squad Data Extraction Workflow
==============================

Tools for extracting game data from the Squad SDK and producing the
data/v10_data.json file consumed by the SquadMaps website.

The pipeline is fully automated and runs entirely in WSL/Linux. The
Squad Editor is no longer required for normal extraction — only the
SDK content tree on disk.


Prerequisites
-------------
- Squad SDK installed somewhere (e.g. E:\epic\SquadEditor on Windows
  visible from WSL — adjust paths in the commands below).
- dotnet 8 SDK installed user-local at ~/.dotnet (see
  cue4parse-extractor/README.md for the one-time setup).
- Python 3.10+.
- The CUE4Parse git submodule initialized:
    git submodule update --init --recursive scripts/extraction/cue4parse-extractor/CUE4Parse


Pipeline overview
-----------------
Two stages:

  Stage A — Squad SDK CSV exports (must run inside the Squad Editor,
  one time per SDK update). Produces SquadLayers.csv etc. with
  per-layer faction / ticket / vehicle / deployable info.

  Stage B — Spatial extraction + site data build (fully automated,
  runs from WSL). Reads umap binaries via CUE4Parse for spatial data,
  merges with the CSVs, produces v10_data.json + v10_data.js.

Stage A is unavoidable because faction/vehicle metadata lives in
editor-only data tables that aren't readable from the umap files. You
only need to re-run Stage A when the SDK is updated with new factions
or vehicles — typically once per Squad version.

Stage B runs any time you want fresh map data. ~3-5 minutes,
fully scriptable.


Stage A: Squad SDK CSV exports (run on each Squad version bump)
---------------------------------------------------------------
Drives the Squad Editor headlessly to dump SquadLayers.csv,
SquadVehicleLayers.csv, and SquadDeployables.csv.

From WSL:

     cmd.exe /d /c "pushd E:\epic\SquadEditor && \
       %CD%\scripts\extraction\run_export.bat"

(Adjust the SDK_ROOT variable inside run_export.bat if your SDK isn't at
E:\epic\SquadEditor.) Takes ~6-8 minutes — the editor cold-starts, loads
all assets, and only then fires LevelScript\run_export.py which writes
the CSVs into <SDK>\Squad\Saved\SquadMapsExport\:
   - SquadLayers.csv        — layer config (factions, tickets, lighting, commander)
   - SquadVehicleLayers.csv — vehicle assignments per team
   - SquadDeployables.csv   — deployable info

If a Squad version bump introduces "_Automation" template layers (or any
other layer with an empty TeamConfigs), ExportLayers.py needs a guard
clause to skip them — the upstream script does Teams[0]/Teams[1]
unconditionally and crashes otherwise. The guard is:

     Teams = asset.get_editor_property("TeamConfigs")
     if len(Teams) < 2:
         unreal.log_warning("Skipping layer with %d TeamConfigs: %s" % (len(Teams), name))
         continue

Done by hand — ExportLayers.py lives inside the SDK install
(E:\epic\SquadEditor\Squad\Content\Python\LevelScript\ExportLayers.py),
not in this repo, so the patch needs reapplying after each SDK update.


Stage B: Spatial extraction + site data build (automated)
---------------------------------------------------------
Runs entirely from WSL/Linux with no editor.

1. Build the extractor (first time only):

     cd scripts/extraction/cue4parse-extractor/SquadSpatialExtractor
     dotnet build

2. Extract spatial data for every umap (~3 minutes for ~177 layers):

     dotnet run -- --all
     cd ../../../..

   Output: per-layer JSON files in
   E:\epic\SquadEditor\Squad\Saved\SquadMapsExport\spatial\.

   Other invocations:
     dotnet run                                # smoke test on Manicouagan_RAAS_v1
     dotnet run -- --layer Manicouagan_RAAS_v1 # one layer
     dotnet run -- --filter Manicouagan        # all matching substring
     dotnet run -- --out /tmp/myspatial        # alternate output dir

3. Build site data by merging the SDK CSV + CUE4Parse spatial JSON
   into the existing baseline:

     export SQUAD_SDK_EXPORT="$YOUR_SDK_PATH/Squad/Saved/SquadMapsExport"

     python3 scripts/extraction/build_v10_site_data.py \
       --existing-data data/v10_data.json \
       --layers-csv "$SQUAD_SDK_EXPORT/SquadLayers.csv" \
       --spatial-dir "$SQUAD_SDK_EXPORT/spatial" \
       --output data/v10_data.json

   Writes both v10_data.json and v10_data.js (the .js sibling has the
   `window.SQUAD_DATA = ...;` wrapper that index.html loads). The
   build is idempotent — --existing-data and --output can be the same
   file.

4. Bump the cache-bust query in index.html if visitors should
   re-fetch immediately:

     <script src="data/v10_data.js?v=N"></script>


What gets replaced vs preserved during the merge
------------------------------------------------
The build script's --spatial-dir mode does a SELECTIVE merge — only
overwriting fields where the CUE4Parse extraction is strictly more
correct than the existing baseline.

Replaced from CUE4Parse:
- capturePoints.lanes — fresh lane graph from
  SQRAASLaneInitializer.AAS Lanes including per-lane color hex.
  Fixes the Manicouagan_RAAS_v2 duplicate-Echo collapse where the
  legacy dict-keyed laneObjects silently dropped one of two distinct
  Echo lanes.
- capturePoints.points (AAS only) — pointsOrder rebuilt from sorted
  actor labels, fixing the long-standing AAS token-mismatch problem.
- objectives — capture zone positions via the actor
  RootComponent.AttachParent walk (legacy data had wrong cluster
  positions for any cluster attached to a parent transform). FlagName
  from SQCaptureZoneComponent.FlagName FText. Cluster→capture-zone
  hierarchy via real UE attachment, not name-prefix heuristics.

Preserved from the existing baseline (until CUE4Parse covers them):
- capturePoints.hexs — TC hex zones.
- capturePoints.destructionObject — Destruction phase splines + cache
  spawn regions.
- assets.vehicleSpawners — richer per-vehicle metadata
  (icon, size, typePriorities) sourced from SquadVehicleLayers.csv.
- border / mapTextureCorners / minimapTexture — map-level metadata
  from a different extraction pipeline.


Files in this directory
-----------------------
- README.txt              — this file
- build_v10_site_data.py  — builds v10_data.json from baseline + CSV + spatial
- spatial_translator.py   — CUE4Parse JSON → site layer fragment translator
- export_from_sdk.py      — minimal wrapper for the SDK CSV export
- cue4parse-extractor/    — C# spatial extractor (CUE4Parse-based)


Notes
-----
- ExportLayers.py inside the SDK uses `import unreal` and MUST run
  from the editor's Python console. CUE4Parse never needs the editor.
- ~55 layers in the baseline don't have umap files in the local SDK
  install (e.g. AlBasrah, BlackCoast, Harju have only one or zero
  gameplay layers downloaded). For those, the baseline ships as-is
  until you download more SDK content via the Epic Games Launcher.
- ~19 SDK layers (Belaya, Anvil_TC_v1, Forest_Skirmish_v1, etc.) are
  extracted by CUE4Parse but aren't yet referenced in the baseline
  v10_data.json. Adding them requires creating new layer entries with
  mapId metadata that build_v10_site_data.py doesn't yet generate
  from spatial data alone — follow-up work.
