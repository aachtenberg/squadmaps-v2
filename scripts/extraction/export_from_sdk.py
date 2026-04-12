"""
Squad SDK Layer Exporter
========================
Run inside the Squad Editor's Python console to export layer, vehicle,
and deployable metadata as CSV files. The CSVs feed the v2 site build
pipeline (see scripts/extraction/README.txt).

Usage (inside Squad Editor):
  1. Open Squad Editor
  2. Edit > Editor Preferences > Plugins > Python > enable "Developer Mode"
  3. Window > Developer Tools > Output Log → switch dropdown to "Python"
  4. Execute (replace <SDK> with your Squad SDK install path):

     exec(open(r'<SDK>/Squad/Content/Python/LevelScript/ExportLayers.py').read())
     exporter = LayerExporter(r'<SDK>/Squad/Saved/SquadMapsExport')
     exporter.ExportToCSV()

The CSVs will be saved to <SDK>/Squad/Saved/SquadMapsExport/:
  - SquadLayers.csv
  - SquadVehicleLayers.csv
  - SquadDeployables.csv

Then build the site data from WSL/Linux:
  python3 scripts/extraction/build_v10_site_data.py \
    --existing-data v2/data/v10_data.json \
    --layers-csv "$SQUAD_SDK_EXPORT/SquadLayers.csv" \
    --spatial-dir "$SQUAD_SDK_EXPORT/spatial" \
    --output v2/data/v10_data.json
"""
print(__doc__)
