Squad Data Extraction Workflow
==============================

Tools for extracting game data from the Squad SDK and producing the
v2/data/v10_data.json file consumed by the SquadMaps website.

The pipeline is fully automated and runs entirely in WSL/Linux. The
Squad Editor is no longer required for normal extraction (only the SDK
content tree on disk).


Prerequisites
-------------
- Squad SDK installed at E:\epic\SquadEditor (or similar — adjust paths
  in the commands below).
- dotnet 8 SDK installed user-local at ~/.dotnet (see
  cue4parse-extractor/README.md for the one-time setup).
- Python 3 (any 3.10+).
- The CUE4Parse git submodule initialized:
    git submodule update --init --recursive scripts/extraction/cue4parse-extractor/CUE4Parse


Pipeline overview
-----------------
The full extraction is two stages:

  Stage A — Squad SDK CSV exports (must be done from inside Squad Editor,
  one time per SDK update). Produces SquadLayers.csv etc. with the
  per-layer faction / ticket / vehicle / deployable info.

  Stage B — Spatial extraction + site data build (fully automated, runs
  from WSL). Reads umap binaries via CUE4Parse for spatial data, merges
  with the CSVs, produces v10_data.json + v10_data.js.

Stage A is unfortunate but unavoidable because faction/vehicle metadata
lives in editor-only data tables that we can't read from the umap files.
You only need to re-run Stage A when the SDK is updated with new factions
or vehicle changes — typically once per Squad version.

Stage B is the part that needs to run any time you want fresh map data.
It's fast (~3-5 minutes) and fully scriptable.


Stage A: Squad SDK CSV exports (manual, infrequent)
---------------------------------------------------
1. Launch the Squad Editor (LaunchModSDK.bat).

2. Wait for the editor to fully load. Open the Python console:
   Window → Developer Tools → Output Log, switch dropdown to "Python".

3. Run:

     import sys
     sys.path.insert(0, r'E:/epic/SquadEditor/Squad/Content/Python/LevelScript')
     from ExportLayers import LayerExporter
     exporter = LayerExporter(r'E:/epic/SquadEditor/Squad/Saved/SquadMapsExport')
     exporter.ExportToCSV()

4. CSVs land in E:\epic\SquadEditor\Squad\Saved\SquadMapsExport\:
   - SquadLayers.csv        (layer config: factions, tickets, lighting, commander)
   - SquadVehicleLayers.csv (vehicle assignments per team)
   - SquadDeployables.csv   (deployable info)

5. You can now close the editor.


Stage B: Spatial extraction + site data build (automated)
---------------------------------------------------------
This stage runs entirely from WSL/Linux with no editor.

1. Build the CUE4Parse spatial extractor (first-time only):

     cd scripts/extraction/cue4parse-extractor/SquadSpatialExtractor
     dotnet build

2. Extract spatial data for every umap in the SDK content tree
   (~3 minutes for ~177 layers):

     dotnet run -- --all
     cd ../../../..

   Output: per-layer JSON files in
   E:\epic\SquadEditor\Squad\Saved\SquadMapsExport\spatial\

   Other useful invocations:
     dotnet run                                      # smoke test on Manicouagan_RAAS_v1
     dotnet run -- --layer Manicouagan_RAAS_v1       # one layer
     dotnet run -- --filter Manicouagan              # all matching substring
     dotnet run -- --out /tmp/myspatial              # alternate output dir

3. Build the site data file by merging the SDK CSV + CUE4Parse spatial
   JSON into the existing baseline:

     # Set this once for your environment
     export SQUAD_SDK_EXPORT="$YOUR_SDK_PATH/Squad/Saved/SquadMapsExport"

     python3 scripts/extraction/build_v10_site_data.py \
       --existing-data v2/data/v10_data.json \
       --layers-csv "$SQUAD_SDK_EXPORT/SquadLayers.csv" \
       --spatial-dir "$SQUAD_SDK_EXPORT/spatial" \
       --output v2/data/v10_data.json

   This writes both v10_data.json and v10_data.js (the .js sibling has
   the `window.SQUAD_DATA = ...;` wrapper that index.html loads).

   The build is idempotent and safe to re-run: --existing-data and
   --output can point at the same file. The merge logic only overwrites
   fields the CUE4Parse extractor improves on; everything else passes
   through unchanged.

4. Bump the cache-bust query in v2/index.html if you want existing
   visitors to re-fetch immediately:

     <script src="data/v10_data.js?v=N"></script>


What gets replaced vs preserved during the merge
------------------------------------------------
The build script's --spatial-dir mode does a SELECTIVE merge: it only
overwrites layer fields where the CUE4Parse extraction is strictly more
correct than the existing baseline. Everything else stays as-is.

Replaced from CUE4Parse:
- capturePoints.lanes  — fresh lane graph from
  SQRAASLaneInitializer.AAS Lanes, including the per-lane color hex.
  Fixes the Manicouagan_RAAS_v2 duplicate-Echo collapse where the
  dict-keyed laneObjects structure silently dropped one of two distinct
  Echo lanes because dict keys can't repeat.
- capturePoints.points (AAS only) — pointsOrder rebuilt from sorted actor
  labels, fixing the long-standing AAS token-mismatch problem.
- objectives — capture zone positions from the actor RootComponent
  AttachParent walk (the legacy data had wrong cluster positions for any
  cluster attached to a parent transform), FlagName from
  SQCaptureZoneComponent.FlagName FText, cluster→capture-zone hierarchy
  via real UE attachment (not name-prefix heuristics).

Preserved from the existing baseline (until CUE4Parse covers them):
- capturePoints.hexs — TC hex zones. CUE4Parse doesn't extract these yet
  (it would need to walk SQHexZoneActor or similar — follow-up work).
- capturePoints.destructionObject — Destruction phase splines + cache
  spawn regions. Same follow-up.
- assets.vehicleSpawners — the existing baseline has richer per-vehicle
  metadata (icon, size, typePriorities) that requires cross-referencing
  SquadVehicleLayers.csv. Vehicle spawner positions are stable across
  game versions so this stays correct.
- border / mapTextureCorners / minimapTexture / etc — map-level metadata
  that comes from a different extraction pipeline.


Layer images
------------
New maps need thumbnail/full-size images. These can be extracted from the
SDK's minimap textures or captured as screenshots.

Map images go in:
  v2/assets/maps/full_size/
  v2/assets/maps/thumbnails/
  v2/assets/maps/webp/


Files in this directory
-----------------------
- README.txt                       — this file
- build_v10_site_data.py           — builds v10_data.json from baseline + CSV + CUE4Parse spatial
- spatial_translator.py            — CUE4Parse JSON → site layer fragment translator
- csv_to_finished_json.py          — converts SDK CSV to the legacy v1 site's finished.json
                                      (only used by the v1 site at /index.html, not v2)
- export_from_sdk.py               — minimal wrapper for the SDK CSV export
- run_export.bat                   — Windows wrapper for the SDK CSV export
- cue4parse-extractor/             — C# spatial extractor (CUE4Parse-based)
  - SquadSpatialExtractor/         — our extractor project
  - CUE4Parse/                     — git submodule (the parser library)
  - README.md                      — dotnet setup + usage


Notes
-----
- ExportLayers.py inside the SDK uses `import unreal` and MUST run from
  the editor's Python console. The CUE4Parse extractor never needs the
  editor.
- About 55 layers in the existing baseline don't have umap files in the
  local SDK install (e.g. AlBasrah, BlackCoast, Harju have only one or
  zero gameplay layers downloaded). For those layers the baseline's
  pre-existing data is what ships — they don't get refreshed from
  CUE4Parse until you download more SDK content via the Epic Games
  Launcher.
- About 19 SDK layers (Belaya, Anvil_TC_v1, Forest_Skirmish_v1, etc.)
  are extracted by CUE4Parse but aren't yet referenced in the baseline
  v10_data.json. Adding them requires creating new layer entries with
  mapId metadata that build_v10_site_data.py doesn't yet generate from
  spatial data alone — follow-up work.
