# SquadMaps v2

A community fork / rewrite of the [SquadMaps](https://github.com/mahtoid/SquadMaps)
interactive map viewer for [Squad](https://joinsquad.com), with a fully
automated v10 SDK extraction pipeline (no editor required), a
[squadlanes](https://squadlanes.com)-style click-the-points RAAS planner,
a HAB placement tool, and rendering for Territory Control hex zones,
Destruction phase regions, and AAS fixed paths.

> **Status:** WIP, not yet deployed publicly. Some UI polish still to do.

## Highlights

- **Squadlanes-style progressive RAAS** — pick the first cap on the map,
  the UX narrows the possible lanes as you click subsequent caps. Falls
  back to free-mode click-anywhere when the captures don't match any
  known lane prefix (handles cross-lane play through shared physical
  cluster points like Manicouagan's Cannabis Farm).
- **HAB placement tool** — click to drop FOB radio markers with the
  150 m construction radius and 400 m exclusion radius drawn as
  marching-ants gold circles. Conflict detection turns the outer ring
  red when two HABs are too close.
- **Territory Control** — hex zones rendered as polygons colored by
  initial team ownership, with anchor highlights.
- **Destruction** — phase spawn regions rendered as spline polygons
  per phase, with a phase selector.
- **AAS fixed-path rendering** — selecting a team paints the entire
  capture chain in their color, since AAS paths are deterministic.
- **Fully automated v10 spatial extraction pipeline** — reads Squad SDK
  `.umap` binaries directly via [CUE4Parse](https://github.com/FabianFG/CUE4Parse).
  No Squad Editor required for spatial data extraction. The full
  pipeline runs end-to-end in under 4 minutes from WSL/Linux.

## Repo layout

```
.
├── index.html                       # the v2 site
├── app.js, app.css                  # frontend (Leaflet + vanilla JS)
├── data/
│   ├── v10_data.json + .js          # site data file (lanes, capture points, spawners)
│   ├── translations.json + .js      # i18n
│   ├── unit_metadata.json
│   ├── mortar_maps.json, mortar_weapons.json
│   └── water_hazards.js
├── assets/
│   ├── flags/                       # faction flags
│   ├── thumbnails/                  # map card thumbnails
│   ├── units/                       # unit icons
│   ├── vehicles/                    # vehicle icons
│   ├── heightmaps/                  # heightmap previews
│   └── maps/                        # (gitignored — fetch via download_tiles.sh)
│       ├── single/                  # full-size minimap webps
│       └── tiles/                   # Leaflet tile pyramid (~3 GB)
├── download_assets.sh               # fetch flags / icons / thumbnails
├── download_tiles.sh                # fetch the heavy map tiles
└── scripts/
    └── extraction/
        ├── README.txt               # extraction pipeline docs
        ├── build_v10_site_data.py   # merges baseline + SDK CSV + spatial JSON
        ├── spatial_translator.py    # CUE4Parse JSON → site layer fragments
        ├── export_from_sdk.py       # in-editor CSV exporter wrapper
        └── cue4parse-extractor/     # C# spatial extractor
            ├── README.md            # dotnet setup + usage
            ├── SquadSpatialExtractor/
            └── CUE4Parse/           # git submodule
```

## Local development

The site is plain HTML/CSS/JS — no build step. Just serve the directory:

```bash
git clone --recursive https://github.com/aachtenberg/squadmaps-v2.git
cd squadmaps-v2

# Fetch the heavy map assets (faction flags, minimap tiles, etc)
# These come from the upstream squadmaps.com hosting and are © OWI / mahtoid
./download_assets.sh
./download_tiles.sh   # ~3 GB, takes a while

# Serve with any static HTTP server
python3 -m http.server 8000
# Then open http://localhost:8000/
```

## Refreshing the data from a Squad SDK

The site's `data/v10_data.json` is built from a combination of:

1. The previous build's output as a baseline
2. The Squad SDK's CSV exports (factions, vehicles, tickets, etc — needs the editor)
3. Per-layer spatial JSON extracted from the SDK's `.umap` binaries via CUE4Parse (no editor)

See [`scripts/extraction/README.txt`](scripts/extraction/README.txt) for the full pipeline. The two-line summary:

```bash
# Extract spatial data from the SDK (no editor needed)
cd scripts/extraction/cue4parse-extractor/SquadSpatialExtractor
SQUAD_SDK_CONTENT=/path/to/Squad/Content dotnet run -- --all
cd ../../../..

# Build the site data
SQUAD_SDK_EXPORT=/path/to/Squad/Saved/SquadMapsExport \
python3 scripts/extraction/build_v10_site_data.py \
  --existing-data data/v10_data.json \
  --layers-csv "$SQUAD_SDK_EXPORT/SquadLayers.csv" \
  --spatial-dir "$SQUAD_SDK_EXPORT/spatial" \
  --output data/v10_data.json
```

## Credits

This is a community fork. Standing on shoulders:

- **Pablo Ferrer ([Napster653](https://steamcommunity.com/id/napster653/))** —
  original creator of SquadMaps. The site grid, the asset download
  scheme, and the basic interaction model all originated here.
- **Matthew Moss ([mahtoid](https://github.com/mahtoid))** — long-time
  maintainer of [SquadMaps](https://github.com/mahtoid/SquadMaps) and
  the live site at squadmaps.com that this fork's assets are derived
  from. This rewrite happened because I wanted to build on what he made.
- **[squadlanes.com](https://squadlanes.com)** — the click-the-points
  progressive RAAS UX is inspired by their interaction model. No code
  was copied; only the user-facing pattern.
- **[FabianFG](https://github.com/FabianFG) and CUE4Parse contributors** —
  the C# library that makes the editor-free spatial extraction possible.
  CUE4Parse has explicit Squad UE 5.5 support which removed every wall
  the Squad Editor's Python API was throwing at us.
- **[Offworld Industries](https://www.joinsquad.com)** — for making
  Squad and shipping a usable SDK. All game assets are © OWI.
- **aachtenberg** — v2 frontend rewrite, extraction pipeline integration
- **Claude** ([Anthropic](https://anthropic.com)) — pair-programming
  partner on the v10 extraction pipeline rewrite, the squadlanes-style
  RAAS UX, the HAB placement tool, the TC/Destruction/AAS rendering,
  and most of this README

## License

[MIT](LICENSE). The codebase itself is MIT-licensed. Map textures, tile
assets, faction flags, and unit icons fetched via the download scripts
are derived from Squad's game data (© Offworld Industries) and from
mahtoid's hosting at squadmaps.com — they are not redistributed in this
repo and you'll need to fetch them yourself.

## Disclaimer

This is a fan project. Not affiliated with Offworld Industries, not
affiliated with squadmaps.com, not affiliated with squadlanes.com. Use
it for whatever you want under the MIT terms.
