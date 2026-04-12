#!/bin/bash
set -e

BASE="https://squadmaps.com"
OUT="$(cd "$(dirname "$0")" && pwd)"
CURL="curl -s -f --retry 2 --max-time 30"

echo "=== Downloading SquadMaps assets ==="

# ---------------------------------------------------------------------------
# 1. HTML, CSS, JS, favicons
# ---------------------------------------------------------------------------
echo "[1/8] Static files..."
$CURL "$BASE/" -o "$OUT/index_original.html"
$CURL "$BASE/static/css/main.c3572fbd.css" -o "$OUT/static/css/main.c3572fbd.css"
# Bundle already saved
cp /tmp/squadmaps_bundle.js "$OUT/static/js/main.79b77dfe.js"

for icon in squadmaps-32.png squadmaps-128.png squadmaps-180.png squadmaps-192.png; do
  $CURL "$BASE/$icon" -o "$OUT/$icon" || echo "  SKIP $icon"
done

# ---------------------------------------------------------------------------
# 2. Faction flags
# ---------------------------------------------------------------------------
echo "[2/8] Faction flags..."
for fid in ADF AFU BAF CAF CRF GFI IMF MEI PLA PLAAGF PLANMC RGF TLF USA USMC VDV WPMC; do
  $CURL "$BASE/assets/flags/flag_${fid}.png" -o "$OUT/assets/flags/flag_${fid}.png" || echo "  SKIP flag_${fid}"
done

# ---------------------------------------------------------------------------
# 3. Vehicle icons
# ---------------------------------------------------------------------------
echo "[3/8] Vehicle icons..."
for vid in 0 4 6 8 10; do
  $CURL "$BASE/assets/vehicles/${vid}.png" -o "$OUT/assets/vehicles/${vid}.png" || echo "  SKIP vehicle ${vid}"
done

# ---------------------------------------------------------------------------
# 4. Thumbnails
# ---------------------------------------------------------------------------
echo "[4/8] Thumbnails..."
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
for t in "${THUMBNAILS[@]}"; do
  $CURL "$BASE/assets/thumbnails/${t}.webp" -o "$OUT/assets/thumbnails/${t}.webp" || echo "  SKIP thumb $t"
done

# ---------------------------------------------------------------------------
# 5. Single map images (full-size webp for Leaflet ImageOverlay fallback)
# ---------------------------------------------------------------------------
echo "[5/8] Single map images..."
for t in "${THUMBNAILS[@]}"; do
  $CURL "$BASE/assets/maps/single/${t}.webp" -o "$OUT/assets/maps/single/${t}.webp" || echo "  SKIP single $t"
done

# ---------------------------------------------------------------------------
# 6. Map tiles (256x256 PNGs, zoom levels 1-4)
# ---------------------------------------------------------------------------
echo "[6/8] Map tiles..."
for t in "${THUMBNAILS[@]}"; do
  for z in 1 2 3 4; do
    max_xy=$(( (1 << z) - 1 ))
    for x in $(seq 0 $max_xy); do
      for y in $(seq 0 $max_xy); do
        dir="$OUT/assets/maps/tiles/${t}/${z}"
        mkdir -p "$dir"
        $CURL "$BASE/assets/maps/tiles/${t}/${z}/${x}/${y}.png" \
          -o "$dir/${x}_${y}.png" 2>/dev/null || true
      done
    done
  done
  echo "  tiles: $t done"
done

# ---------------------------------------------------------------------------
# 7. Unit badges
# ---------------------------------------------------------------------------
echo "[7/8] Unit badges..."
UNITS=(
  T_ADF_1RAR_Mechanized T_ADF_3RAR_AirAssault T_ADF_3rd_Brigade_CombinedArms
  T_BAF_1_YORKS_Mechanized T_BAF_2_BPR_AirAssault T_BAF_3DIV_CombinedArms
  T_BAF_QRH_Armored T_BAF_ROYALLOGI_Support
  T_CAF_12e_Regiment_Motorized T_CAF_1_CMBG_CombinedArms T_CAF_3_RCR_AirAssault
  T_CAF_CCSB_Support T_CAF_LdSH_Armored T_CAF_TheWesties_ T_CAF_VanDoos_Mechanized
  T_GFI_16thAD_Armored T_GFI_21stD_CombinedArms T_GFI_55thAB_AirAssault
  T_GFI_64thID_LightInfantry T_GFI_75thLB_Support T_GFI_77thID_Mechanized
  T_IMF_Armor T_IMF_BattleGroup T_IMF_FireSupGroup T_IMF_LightInf T_IMF_MechInf T_IMF_MotorInf
  T_MEI_Armored T_MEI_BattleGrp_CombinedArms T_MEI_LightInfantry T_MEI_Mechanized T_MEI_Motorized T_MEI_Support
  T_PLAAGF_14th_Brigade_CombinedArms T_PLAAGF_4th_Medium_Battalion_Mechanized T_PLAAGF_9th_Heavy_Battalion_Armored
  T_PLANMC_17th_MarineBattalion_Support T_PLANMC_3rd_Heavy_Battalion_Armored
  T_PLANMC_4th_SpecialCombatBattalion_LightInfantry T_PLANMC_5th_MarineBrigade_CombinedArms
  T_PLANMC_7th_Medium_Battalion_Motorized
  T_PLA_112th_Brigade_Motorized T_PLA_118th_Brigade_CombinedArms T_PLA_149th_Brigade_LightInfantry
  T_PLA_161st_Brigade_AirAssault T_PLA_195th_Brigade_Armored T_PLA_80th_Brigade_Support
  T_RGF_1398th_Recon_LightInfantry T_RGF_205th_OMSBr_Mechanized T_RGF_336th_GNIBr_AmphibiousAssault
  T_RGF_3rd_Mtr_Div_Motorized T_RGF_49th_OA_CombinedArms T_RGF_6th_OTBr_Armored T_RGF_78th_OBrMTO_Support
  T_TLF_1st_Army_CombinedArms T_TLF_1st_Cmdo_Brigade_AirAssault T_TLF_4th_ArmoredBrigade_Armored
  T_TLF_51st_MotorInf_Brigade_Motorized T_TLF_66th_MechInfBrigade_Mechanized T_TLF_LandForcesLogiCmd_Support
  T_USA_10th_MTN_LightInfantry T_USA_1st_Cav_Mechanized T_USA_1st_INFDIV_CombinedArms
  T_USA_2nd_CAV_Motorized T_USA_37th_ArmorRegiment_Armored T_USA_497th_CSSB_Support T_USA_504th_PIR_AirAssault
  T_USMC_1-1stMarines_LightInfantry T_USMC_1st_TNK_BN_Armored T_USMC_2nd_MLG_Support
  T_USMC_31st_MEU_CombinedArms T_USMC_3rd_LAR_BN_Motorized T_USMC_4th_MARG_AmphibiousAssault
  T_Unit_CRF T_Unit_PLANMC
  T_VDV_104th_Tank_Battalion_Armored T_VDV_108th_Guards_AirAssault T_VDV_150th_Batallion_Support
  T_VDV_173rd_Guards_LightInfantry T_VDV_217th_Guards_AirAssaut T_VDV_7th_Guards_CombinedArms
  T_WPMC_ManticoreSecurityTaskForce_CombinedArms T_WPMC_MurkWaterAirWing_AirAssault
  T_WPMC_Overwatch6PatrolGroup_LightInfantry
  T_vdv_flag_large Unit_PLA Unit_RGF Unit_USArmy Unit_USMC
)
for u in "${UNITS[@]}"; do
  $CURL "$BASE/assets/units/${u}.webp" -o "$OUT/assets/units/${u}.webp" || echo "  SKIP unit $u"
done

# ---------------------------------------------------------------------------
# 8. Heightmaps
# ---------------------------------------------------------------------------
echo "[8/8] Heightmaps..."
HEIGHTMAPS=(
  "al basrah" "anvil" "belaya" "black coast" "chora" "fallujah" "fool's road"
  "goose bay" "gorodok" "harju" "kamdesh" "kohat" "kokan" "lashkar" "logar"
  "manicouagan" "mestia" "mutaha" "narva" "sanxian" "skorpo" "sumari" "tallil" "yehorivka"
)
for h in "${HEIGHTMAPS[@]}"; do
  encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$h'))")
  $CURL "$BASE/assets/heightmaps/${encoded}.webp" -o "$OUT/assets/heightmaps/${h}.webp" || echo "  SKIP heightmap $h"
done

# ---------------------------------------------------------------------------
# Copy v10 data
# ---------------------------------------------------------------------------
echo "Copying v10 data..."
cp /tmp/squadmaps_v10_data.json "$OUT/data/v10_data.json"

echo ""
echo "=== Download complete ==="
du -sh "$OUT/assets/"*/ | sort -rh
echo ""
du -sh "$OUT"
