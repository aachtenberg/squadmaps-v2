#!/bin/bash
# Download map tiles in parallel using xargs
# Generates a URL list then downloads 20 at a time
set -e

BASE="https://squadmaps.com"
OUT="$(cd "$(dirname "$0")" && pwd)/assets/maps/tiles"
URLFILE="/tmp/tile_urls.txt"

THUMBNAILS=(
  Anvil_Minimap Black_Coast_Minimap Chora_Minimap Chora_Minimap_Skirmish_v1
  Fallujah_Minimap_Skirmish Fools_Road_Minimap GooseBay_Minimap GooseBay_Minimap_Seed_v1
  Gorodok_Minimap_Skirmish_v1 Harju_Minimap Kamdesh_Minimap Logar_Valley_Minimap
  Mutaha_Minimap Mutaha_Minimap_Seed_v1 Mutaha_Minimap_Skirmish_v1 Narva_Minimap
  Skorpo_Minimap_RAAS_v3 Skorpo_Minimap_Skirmish_v1 Sumari_Minimap
  T_AlBasrah_Minimap T_AlBasrah_Minimap_Seed_v1 T_AlBasrah_Minimap_Seed_v2
  T_AlBasrah_Minimap_Skirmish_v1 T_AlBasrah_Minimap_Skirmish_v2
  T_BlackCoast_Seed_v1 T_Fallujah_Minimap T_Kokan_Minimap T_Lashkar_Minimap
  T_Manicouagan_Minimap T_Manicouagan_Seed_v1_Minimap T_Mestia_Minimap
  T_PacificProvingGrounds_V1_Minimap T_Sanxian_Minimap_Large
  Tallil_Outskirts_Minimap Tallil_Outskirts_Minimap_Skirmish_v1
  Tallil_Outskirts_Minimap_Skirmish_v2 Yehorivka_Minimap gorodok_minimap kohat_minimap
)

# Generate URL list
echo "Generating tile URL list..."
> "$URLFILE"
for t in "${THUMBNAILS[@]}"; do
  for z in 1 2 3 4; do
    max_xy=$(( (1 << z) - 1 ))
    for x in $(seq 0 $max_xy); do
      for y in $(seq 0 $max_xy); do
        dir="$OUT/${t}/${z}/${x}"
        echo "${BASE}/assets/maps/tiles/${t}/${z}/${x}/${y}.png ${dir}/${y}.png" >> "$URLFILE"
      done
    done
  done
done

TOTAL=$(wc -l < "$URLFILE")
echo "Total tiles to download: $TOTAL"

# Create all directories first
echo "Creating directories..."
awk '{print $2}' "$URLFILE" | xargs -I{} dirname {} | sort -u | xargs mkdir -p

# Download in parallel (20 concurrent)
echo "Downloading tiles (20 parallel)..."
DONE=0
cat "$URLFILE" | while IFS=' ' read -r url outpath; do
  echo "url = \"$url\"\noutput = \"$outpath\"\n"
done | xargs -P 20 -I{} sh -c 'echo "{}" | curl -s -f --retry 1 --max-time 15 -K - 2>/dev/null || true' &

# Actually, use a simpler parallel approach
# Kill the above attempt
kill %1 2>/dev/null || true

# Use xargs with curl properly
awk '{print $1 " " $2}' "$URLFILE" | xargs -P 20 -n 2 sh -c 'curl -s -f --retry 1 --max-time 15 "$0" -o "$1" 2>/dev/null || true'

echo ""
echo "=== Tile download complete ==="
find "$OUT" -name "*.png" | wc -l
echo "tiles downloaded"
du -sh "$OUT"
