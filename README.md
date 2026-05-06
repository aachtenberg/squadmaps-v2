# SquadMaps v2

A community fork / rewrite of [SquadMaps](https://github.com/mahtoid/SquadMaps),
the interactive map viewer for [Squad](https://joinsquad.com), with a
fully automated v10 SDK extraction pipeline (no editor required), a
[squadlanes](https://squadlanes.com)-style click-the-points RAAS
planner, an HAB placement tool, and rendering for Territory Control hex
zones, Destruction phase regions, and AAS fixed paths.

> **Status:** Live at [squadmaps.xgrunt.com](https://squadmaps.xgrunt.com), tracking **Squad 10.4** data — deployed to a k3s homelab via the [Dockerfile](Dockerfile) and [k8s manifest in homelab-infra](https://github.com/aachtenberg/homelab-infra/blob/main/k3s/base/apps/squadmaps.yml).

## Highlights

- **Squadlanes-style progressive RAAS** — click caps in order, the UX
  narrows lanes as you go. Falls back to free-mode click-anywhere when
  captures don't match any known lane prefix (handles cross-lane play
  through shared physical cluster points).
- **HAB placement tool** — drop FOB radio markers with the 150 m
  construction radius and 400 m exclusion ring; conflict detection
  reddens the outer ring when two HABs are too close.
- **Territory Control** — hex polygons colored by initial team
  ownership, with anchor highlights.
- **Destruction** — phase spawn regions as spline polygons with a phase
  selector.
- **AAS fixed-path rendering** — selecting a team paints the entire
  capture chain in their color.
- **Editor-free v10 spatial extraction** — reads SDK `.umap` binaries
  via [CUE4Parse](https://github.com/FabianFG/CUE4Parse). End-to-end
  pipeline runs in under 4 minutes from WSL/Linux.

## Repo layout

```
.
├── index.html, app.js, app.css     # frontend (Leaflet + vanilla JS)
├── data/
│   ├── v10_data.json + .js         # site data (lanes, capture points, spawners)
│   ├── translations.json + .js     # i18n
│   ├── unit_metadata.json
│   ├── mortar_maps.json, mortar_weapons.json
│   ├── strategy_guides.js, water_hazards.js
│   └── heightmaps/                 # gitignored — fetch via download_assets.sh
├── assets/
│   ├── flags/, vehicles/, units/, thumbnails/
│   └── maps/                       # gitignored — fetch via download_tiles.sh (~3 GB)
├── deploy/nginx.conf               # nginx config baked into the image
├── Dockerfile                      # CI-built image (ghcr.io/aachtenberg/squadmaps-v2)
├── .github/workflows/build.yml     # multi-arch (arm64/amd64) GHCR push on main
├── download_assets.sh              # fetch flags/icons/thumbnails
├── download_tiles.sh               # fetch the heavy map tiles
└── scripts/extraction/             # SDK → site-data pipeline (see scripts/extraction/README.txt)
```

## Local development

The site is plain HTML/CSS/JS — no build step. Serve the directory:

```bash
git clone --recursive https://github.com/aachtenberg/squadmaps-v2.git
cd squadmaps-v2
./download_assets.sh        # flags, icons, thumbnails
./download_tiles.sh         # ~3 GB map tiles, takes a while
python3 -m http.server 8888 # then open http://localhost:8888/
```

## Deployment

CI (`.github/workflows/build.yml`) builds a multi-arch nginx image on
every push to `main` and publishes it to `ghcr.io/aachtenberg/squadmaps-v2`.
The image carries the small static payload (~30 MB); the bulky tile
pyramid + heightmaps stay on the k3s node via a hostPath mount because
they're gitignored upstream and ~770 MB.

The k8s manifest lives in [homelab-infra](https://github.com/aachtenberg/homelab-infra/blob/main/k3s/base/apps/squadmaps.yml).
Rollout after a code change:

```bash
ssh <k3s-host> 'sudo kubectl rollout restart deployment/squadmaps -n apps'
```

Logs: `kubectl logs -n apps deploy/squadmaps -f`.

## Refreshing the data from a Squad SDK

`data/v10_data.json` is built from three sources merged together:

1. The previous build's output as a baseline
2. Squad SDK CSV exports (factions, vehicles, tickets — needs the editor, infrequent)
3. Per-layer spatial JSON from CUE4Parse's `.umap` reader (no editor)

Full pipeline: [`scripts/extraction/README.txt`](scripts/extraction/README.txt). Two-line summary:

```bash
# Spatial extract (no editor needed)
cd scripts/extraction/cue4parse-extractor/SquadSpatialExtractor
SQUAD_SDK_CONTENT=/path/to/Squad/Content dotnet run -- --all
cd ../../../..

# Build site data
SQUAD_SDK_EXPORT=/path/to/Squad/Saved/SquadMapsExport \
python3 scripts/extraction/build_v10_site_data.py \
  --existing-data data/v10_data.json \
  --layers-csv "$SQUAD_SDK_EXPORT/SquadLayers.csv" \
  --spatial-dir "$SQUAD_SDK_EXPORT/spatial" \
  --output data/v10_data.json
```

## Credits

Standing on shoulders:

- **Pablo Ferrer ([Napster653](https://steamcommunity.com/id/napster653/))** —
  original SquadMaps creator. The site grid, asset download scheme, and
  basic interaction model originated here.
- **Matthew Moss ([mahtoid](https://github.com/mahtoid))** — long-time
  maintainer of [SquadMaps](https://github.com/mahtoid/SquadMaps) and
  squadmaps.com (where this fork's assets are derived from).
- **[squadlanes.com](https://squadlanes.com)** — UX inspiration for the
  click-the-points progressive RAAS interaction. No code copied.
- **[FabianFG](https://github.com/FabianFG) and CUE4Parse contributors** —
  the C# library that made the editor-free spatial extraction
  possible. Explicit Squad UE 5.5 support unblocked the rewrite.
- **[Offworld Industries](https://www.joinsquad.com)** — for Squad and
  the SDK. All game assets are © OWI.
- **aachtenberg** — v2 frontend rewrite, extraction pipeline integration.
- **Claude** ([Anthropic](https://anthropic.com)) — pair-programming
  partner on the v10 extraction pipeline, the squadlanes-style RAAS
  UX, the HAB tool, the TC/Destruction/AAS rendering, the k3s deploy,
  and most of this README.

## License

[MIT](LICENSE). The codebase is MIT-licensed. Map textures, tile
assets, faction flags, and unit icons are derived from Squad's game
data (© Offworld Industries) and from squadmaps.com — they are not
redistributed in this repo and you'll need to fetch them yourself.

## Disclaimer

Fan project. Not affiliated with Offworld Industries, squadmaps.com,
or squadlanes.com.
