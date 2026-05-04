#!/usr/bin/env python3
"""
Build site data
===============
Produces v2/data/v10_data.json (and the .js companion the frontend
loads) by merging:

  1. The existing site data file (the previous build's output, kept as
     a baseline so layers we can't currently extract still ship)
  2. The Squad SDK's CSV exports (faction / ticket / vehicle / commander
     metadata that lives in editor data tables — see SquadLayers.csv
     produced by ExportLayers.py inside the editor)
  3. CUE4Parse spatial JSON (the cue4parse-extractor's per-layer dump
     with fresh lane graphs, capture zone positions, mains, etc — see
     scripts/extraction/cue4parse-extractor/)

Inputs:
  --existing-data  Existing site data JSON to use as the baseline
                   (previous v10_data.json — required)
  --layers-csv     SquadLayers.csv from the SDK CSV export
  --vehicles-csv   SquadVehicleLayers.csv (optional, currently unused)
  --spatial-dir    Directory of CUE4Parse spatial JSONs (optional but
                   strongly recommended — without it the script just
                   refreshes teamConfigs from the CSV and leaves
                   spatial data alone)
  --output         Output JSON file path (also writes a .js companion)

Usage:
  python3 build_v10_site_data.py \
    --existing-data v2/data/v10_data.json \
    --layers-csv "$SQUAD_SDK_EXPORT/SquadLayers.csv" \
    --spatial-dir "$SQUAD_SDK_EXPORT/spatial" \
    --output v2/data/v10_data.json

  Where $SQUAD_SDK_EXPORT is your Squad editor's CSV/spatial export
  directory, typically <SDK>/Saved/SquadMapsExport/.
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from copy import deepcopy
from pathlib import Path

# Make sibling modules importable regardless of cwd.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

# CUE4Parse spatial JSON → site layer fragment translator
from spatial_translator import translate as translate_spatial


# ---------------------------------------------------------------------------
# Parse the v10 SquadLayers.csv into structured layer records
# ---------------------------------------------------------------------------

def parse_layers_csv(csv_path):
    """Parse SquadLayers.csv, forward-filling sparse rows into per-layer records.
    
    Returns dict keyed by layer rawName, each with:
      - level, layer_name, cp_type, lighting, tickets_t1, tickets_t2, commander
      - default_t1: {faction_id, unit_name, asset_name}
      - default_t2: {faction_id, unit_name, asset_name}
      - factions: list of {faction_id, type, unit_name, asset_name, usable}
    """
    layers = {}
    
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        content = f.read().replace('\r\n', '\n').replace('\r', '\n')
    
    reader = csv.reader(content.splitlines())
    header = next(reader)
    
    current_layer = None
    current_level = None
    
    for row in reader:
        if len(row) < 15:
            continue
        
        # Columns: ,Level,ID,Layer Name,CP Type,Lighting,Tickets,CO,,Faction,Unit,Asset Name,Usable,Tanks,Heli,,Changes,Notes
        _, level, layer_id, layer_name, cp_type, lighting, tickets, co, _, faction, unit, asset_name, usable, tanks, heli = row[:15]
        
        level = level.strip()
        layer_name = layer_name.strip()
        
        # New layer starts when layer_name is non-empty
        if layer_name:
            current_level = level if level else current_level
            
            # Parse tickets "250 v 250"
            t1, t2 = 0, 0
            ticket_match = re.match(r'(\d+)\s*v\s*(\d+)', tickets.strip())
            if ticket_match:
                t1, t2 = int(ticket_match.group(1)), int(ticket_match.group(2))
            
            commander_enabled = (co.strip().lower() != 'no')
            
            current_layer = {
                'level': current_level,
                'layer_name': layer_name,
                'cp_type': cp_type.strip(),
                'lighting': lighting.strip(),
                'tickets_t1': t1,
                'tickets_t2': t2,
                'commander': commander_enabled,
                'default_t1': None,
                'default_t2': None,
                'factions': [],
                'separated': False,
            }
            layers[layer_name] = current_layer
        
        if not current_layer:
            continue
        
        faction_id = faction.strip()
        if not faction_id:
            continue
        
        usable_str = usable.strip()
        asset = asset_name.strip()
        unit_name = unit.strip()
        
        # Determine if this is a default team entry or a selectable faction
        if usable_str == 'Team1 Default':
            current_layer['default_t1'] = {
                'faction_id': faction_id,
                'unit_name': unit_name,
                'asset_name': asset,
            }
        elif usable_str == 'Team2 Default':
            current_layer['default_t2'] = {
                'faction_id': faction_id,
                'unit_name': unit_name,
                'asset_name': asset,
            }
        else:
            # Parse faction+type entries like "BAF+AirAssault"
            if '+' in faction_id:
                base_faction, unit_type = faction_id.split('+', 1)
            else:
                base_faction = faction_id
                unit_type = None
            
            # Determine team availability
            if usable_str == 'Team1':
                current_layer['separated'] = True
            elif usable_str == 'Team2':
                current_layer['separated'] = True
            
            current_layer['factions'].append({
                'faction_id': base_faction,
                'type': unit_type,
                'unit_name': unit_name,
                'asset_name': asset,
                'usable': usable_str,
            })
    
    return layers


# ---------------------------------------------------------------------------
# Parse the v10 SquadVehicleLayers.csv into structured vehicle records
# ---------------------------------------------------------------------------

def parse_vehicles_csv(csv_path):
    """Parse SquadVehicleLayers.csv into {layer_raw_name: {unit_id: [vehicles]}}.

    CSV columns: '', 'Layer Name', 'Team Name', 'Team ID', 'Icon', 'Vehicle Name',
                 'Vehicle Count', 'Initial Delay', 'Respawn Time'

    The Layer Name / Team Name / Team ID columns fill forward across rows; only
    the first row in a group has them populated.

    Team ID values (e.g. 'USMC_LO_CombinedArms') match the layer's faction-unit
    asset names, so the returned dict keys the vehicle lists by the same string
    the frontend sees as `selectedOption.defaultUnit` / `teamConfigs.teamN.defaultFactionUnit`.
    """
    out = {}

    with open(csv_path, 'r', encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f)
        next(reader, None)  # header

        cur_layer = cur_team_id = None
        for row in reader:
            if len(row) < 9:
                continue
            new_layer = row[1].strip() if row[1] else None
            new_team_id = row[3].strip() if row[3] else None
            if new_layer:
                cur_layer = new_layer
            if new_team_id:
                cur_team_id = new_team_id
                # New Team ID header — start a fresh list. Some layers list the
                # same faction twice (once as Team1/Team2 Default, again in the
                # general faction list); resetting on each header keeps the
                # last copy rather than concatenating them.
                if cur_layer:
                    out.setdefault(cur_layer, {})[cur_team_id] = []

            name = row[5].strip()
            if not (cur_layer and cur_team_id and name):
                continue

            try:
                count = int(row[6].strip())
            except (ValueError, TypeError):
                count = 0
            try:
                initial_delay = float(row[7].strip())
            except (ValueError, TypeError):
                initial_delay = 0.0
            try:
                respawn = float(row[8].strip())
            except (ValueError, TypeError):
                respawn = 0.0

            out[cur_layer][cur_team_id].append({
                'name': name,
                'count': count,
                'initialDelayMin': initial_delay,
                'respawnMin': respawn,
            })

    return out


# ---------------------------------------------------------------------------
# Build teamConfigs in the format the React app expects
# ---------------------------------------------------------------------------

def build_team_configs(layer_data):
    """Convert our parsed CSV layer data into the live site's teamConfigs format."""
    
    t1_default = layer_data.get('default_t1', {}) or {}
    t2_default = layer_data.get('default_t2', {}) or {}
    
    # Standard alliance lists (used consistently across all layers)
    all_alliances = ["BLUFOR", "PAC", "INDEPENDENT", "REDFOR"]
    all_unit_types = [
        "Combined Arms", "Mechanized", "Infantry (Air Mobile)",
        "Armored", "Support", "Motorized", "Light Infantry"
    ]
    
    team1 = {
        "index": 1,
        "defaultFactionUnit": t1_default.get('asset_name', ''),
        "tickets": layer_data['tickets_t1'],
        "disabledVeh": True,
        "playerPercent": 50,
        "allowedAlliances": all_alliances[:],
        "allowedFactionUnitTypes": all_unit_types[:],
        "requiredTags": [],
    }
    
    team2 = {
        "index": 2,
        "defaultFactionUnit": t2_default.get('asset_name', ''),
        "tickets": layer_data['tickets_t2'],
        "disabledVeh": True,
        "playerPercent": 50,
        "allowedAlliances": all_alliances[:],
        "allowedFactionUnitTypes": all_unit_types[:],
        "requiredTags": [],
    }
    
    # Build faction unit lists from CSV data
    # Group factions by base faction_id
    separated = layer_data.get('separated', False)
    
    # Collect all faction entries by base ID and team
    team1_factions = defaultdict(lambda: {'default': None, 'types': []})
    team2_factions = defaultdict(lambda: {'default': None, 'types': []})
    both_factions = defaultdict(lambda: {'default': None, 'types': []})
    
    for fe in layer_data['factions']:
        fid = fe['faction_id']
        usable = fe['usable']
        
        if usable == 'Team1':
            target = team1_factions
        elif usable == 'Team2':
            target = team2_factions
        else:
            target = both_factions
        
        if fe['type'] is None:
            # This is the default/combined arms entry for this faction
            target[fid]['default'] = fe['asset_name']
        else:
            target[fid]['types'].append({
                'unitType': fe['type'],
                'unit': fe['asset_name'],
            })
    
    def build_unit_list(faction_dict):
        units = []
        for fid in sorted(faction_dict.keys()):
            entry = faction_dict[fid]
            unit = {
                'factionID': fid,
                'defaultUnit': entry['default'] or '',
                'types': sorted(entry['types'], key=lambda t: t['unitType']),
            }
            units.append(unit)
        return units
    
    if separated:
        # Separated teams: team1 gets both_factions + team1_factions,
        # team2 gets both_factions + team2_factions
        t1_all = defaultdict(lambda: {'default': None, 'types': []})
        t2_all = defaultdict(lambda: {'default': None, 'types': []})
        
        for fid, data in {**both_factions, **team1_factions}.items():
            if data['default']:
                t1_all[fid]['default'] = data['default']
            t1_all[fid]['types'].extend(data['types'])
        
        for fid, data in {**both_factions, **team2_factions}.items():
            if data['default']:
                t2_all[fid]['default'] = data['default']
            t2_all[fid]['types'].extend(data['types'])
        
        team1_units = build_unit_list(t1_all)
        team2_units = build_unit_list(t2_all)
    else:
        # Non-separated: all factions available to both teams
        team1_units = build_unit_list(both_factions)
        team2_units = build_unit_list(both_factions)
    
    return {
        "team1": team1,
        "team2": team2,
        "factions": {
            "separatedFactionsList": separated,
            "team1Units": team1_units,
            "team2Units": team2_units,
        }
    }


# ---------------------------------------------------------------------------
# Map-level spatial data that can be inherited across layers
# ---------------------------------------------------------------------------

MAP_LEVEL_KEYS = [
    'border', 'borderType', 'mapSize', 'mapSizeType',
    'mapTextureCorners', 'minimapTexture', 'depthMapTexture',
    'heliAltThreshold', 'seaLevel',
]


def build_map_spatial_index(existing_layers):
    """
    Index per-map spatial data (border, mapTextureCorners, minimapTexture,
    etc) from the existing site data layers. Used so new layers added by
    the SDK CSV can inherit map-level metadata from a same-map sibling
    until the CUE4Parse extractor covers it directly.
    """
    map_data = {}
    for layer in existing_layers:
        mid = layer['mapId']
        if mid not in map_data:
            map_data[mid] = {k: layer.get(k) for k in MAP_LEVEL_KEYS}
    return map_data


# ---------------------------------------------------------------------------
# Create a new layer entry for layers that aren't in the existing baseline yet
# ---------------------------------------------------------------------------

def create_new_layer(layer_csv, map_spatial, mapid_override=None):
    """Create a complete layer entry for a new v10 layer."""
    raw_name = layer_csv['layer_name']
    parts = raw_name.split('_')
    
    # Determine mapId
    if mapid_override:
        mapid = mapid_override
    else:
        mapid = parts[0]
    
    # Map display names
    MAP_DISPLAY = {
        'AlBasrah': ('Al Basrah', 'AlBasrah'),
        'Anvil': ('Anvil', 'Anvil'),
        'BlackCoast': ('Black Coast', 'BlackCoast'),
        'Chora': ('Chora', 'Chora'),
        'Fallujah': ('Fallujah', 'Fallujah'),
        'FoolsRoad': ("Fool's Road", 'FoolsRoad'),
        'GooseBay': ('Goose Bay', 'GooseBay'),
        'Gorodok': ('Gorodok', 'Gorodok'),
        'Harju': ('Harju', 'Harju'),
        'Kamdesh': ('Kamdesh', 'Kamdesh'),
        'Kohat': ('Kohat Toi', 'Kohat'),
        'Kokan': ('Kokan', 'Kokan'),
        'Lashkar': ('Lashkar Valley', 'Lashkar'),
        'Logar': ('Logar Valley', 'Logar'),
        'Manicouagan': ('Manicouagan', 'Manicouagan'),
        'Mestia': ('Mestia', 'Mestia'),
        'Mutaha': ('Mutaha', 'Mutaha'),
        'Narva': ('Narva', 'Narva'),
        'PacificProvingGrounds': ('Pacific Proving Grounds', 'PacificProvingGrounds'),
        'Sanxian': ('Sanxian Islands', 'Sanxian_Islands'),
        'Skorpo': ('Skorpo', 'Skorpo'),
        'Sumari': ('Sumari Bala', 'Sumari'),
        'Tallil': ('Tallil Outskirts', 'Tallil'),
        'Yehorivka': ('Yehorivka', 'Yehorivka'),
    }
    
    map_key = parts[0]
    map_name, map_id_for_display = MAP_DISPLAY.get(map_key, (map_key, map_key))
    
    # Parse gamemode and version from rawName
    gamemode = layer_csv['cp_type']
    # Extract version like 'v3' from 'AlBasrah_AAS_v3_CL'
    version_match = re.search(r'(v\d+)', raw_name)
    version = version_match.group(1) if version_match else 'v1'
    
    # Build display name
    display_name = f"{map_name} {gamemode} {version}"
    if '_CL' in raw_name:
        display_name += " CL"
    
    # Get map spatial data
    spatial = map_spatial.get(mapid, map_spatial.get(map_id_for_display, {}))
    
    # Determine computed flags from defaults
    t1_default = layer_csv.get('default_t1', {}) or {}
    t2_default = layer_csv.get('default_t2', {}) or {}
    
    tc = build_team_configs(layer_csv)
    
    entry = {
        "Name": display_name,
        "rawName": raw_name,
        "levelName": raw_name,
        "mapId": mapid,
        "mapName": map_name,
        "gamemode": gamemode,
        "layerVersion": version,
        "minimapTexture": spatial.get('minimapTexture', f"{map_key}_Minimap"),
        "heliAltThreshold": spatial.get('heliAltThreshold', 300),
        "seaLevel": spatial.get('seaLevel', 0),
        "depthMapTexture": spatial.get('depthMapTexture', ''),
        "borderType": spatial.get('borderType', 'spline'),
        "mapSizeType": spatial.get('mapSizeType', 'spline'),
        "border": spatial.get('border', []),
        "mapSize": spatial.get('mapSize', ''),
        "mapTextureCorners": spatial.get('mapTextureCorners', []),
        "assets": {
            "vehicleSpawners": [],  # Need Blueprint extraction
            "deployables": [],
            "helipads": [],
        },
        "capturePoints": {
            "type": gamemode,
            "points": {},
            "lanes": {},
            "clusters": {},
            "hexs": {},
            "objectiveSpawnLocations": {},
            "destructionObject": {},
        },
        "objectives": {},
        "mapAssets": spatial.get('mapAssets', {
            "protectionZones": [],
            "stagingZones": [],
        }) if 'mapAssets' in spatial else {
            "protectionZones": [],
            "stagingZones": [],
        },
        "teamConfigs": tc,
        "commanderDisabled": not layer_csv['commander'],
        "helicoptersAvailable": False,  # Conservative default
        "tanksAvailable": False,
        "boatsAvailable": False,
    }
    
    return entry


# ---------------------------------------------------------------------------
# Main transform
# ---------------------------------------------------------------------------

def load_spatial_index(spatial_dir):
    """
    Index every CUE4Parse-extracted spatial JSON by layer name. Returns
    a dict {rawName: parsed_dict}. Returns an empty dict if spatial_dir
    is None or doesn't exist.
    """
    if not spatial_dir:
        return {}
    p = Path(spatial_dir)
    if not p.is_dir():
        print(f"  WARNING: --spatial-dir does not exist: {spatial_dir}")
        return {}
    index = {}
    for jf in sorted(p.glob('*.json')):
        if jf.name == 'index.json':
            continue
        try:
            with open(jf) as f:
                index[jf.stem] = json.load(f)
        except Exception as e:
            print(f"  WARNING: failed to read {jf}: {e}")
    return index


def merge_spatial_into_layer(layer, spatial_data, gamemode):
    """
    Selectively merge CUE4Parse-extracted spatial data into a layer.

    Strategy: only replace fields where CUE4Parse is strictly more correct
    than the existing baseline. Preserve everything else so we don't lose
    fidelity in areas the CUE4Parse extractor doesn't yet cover.

    Replaced (CUE4Parse wins):
      - capturePoints.lanes  (fixes the Manicouagan_RAAS_v2 duplicate-Echo
        collapse, restores per-lane colors)
      - capturePoints.points (fixes AAS pointsOrder name mismatch)
      - objectives           (fixes capture zone positions via AttachParent
        walk; fixes FlagName via SQCaptureZoneComponent.FlagName FText;
        fixes the AAS token-mismatch problem)

    Preserved from the existing baseline (until CUE4Parse covers them):
      - capturePoints.hexs               (TC hex zones)
      - capturePoints.destructionObject  (Destruction phase splines)
      - capturePoints.clusters / objectiveSpawnLocations  (rarely used)
      - assets.vehicleSpawners           (richer per-vehicle metadata
        from the legacy extraction — icons, sizes, typePriorities — that
        CUE4Parse can't fully reproduce yet)
      - assets.deployables / helipads
      - mapAssets                        (only fill in CUE4Parse-extracted
        categories where the baseline was empty)
    """
    fragments = translate_spatial(spatial_data, gamemode)

    # capturePoints: surgical merge of lanes + points + type only
    cp_old = layer.get('capturePoints', {}) or {}
    cp_new = fragments['capturePoints']
    merged_cp = dict(cp_old)  # shallow copy keeps hexs/destructionObject/etc
    merged_cp['type'] = cp_new['type']
    if cp_new.get('lanes'):
        merged_cp['lanes'] = cp_new['lanes']
    if cp_new.get('points'):
        merged_cp['points'] = cp_new['points']
    layer['capturePoints'] = merged_cp

    # objectives: full replace — CUE4Parse positions/flag names are strictly better
    layer['objectives'] = fragments['objectives']

    # mapAssets: only fill in categories that CUE4Parse populated
    new_map_assets = dict(layer.get('mapAssets', {}) or {})
    new_ma_fragment = fragments['mapAssets']
    for k in ('protectionZones', 'stagingZones', 'spawnGroups'):
        if new_ma_fragment.get(k):
            new_map_assets[k] = new_ma_fragment[k]
    layer['mapAssets'] = new_map_assets

    # assets: leave the existing baseline intact (richer metadata than
    # CUE4Parse currently provides)
    return layer


def main():
    parser = argparse.ArgumentParser(description='Build site data from CUE4Parse spatial JSON + Squad SDK CSV exports')
    parser.add_argument('--existing-data', '--live-data',
                        dest='existing_data',
                        required=True,
                        help='Existing site data JSON to use as the baseline (typically v2/data/v10_data.json)')
    parser.add_argument('--layers-csv', required=True, help='SquadLayers.csv from the SDK CSV export')
    parser.add_argument('--vehicles-csv', help='SquadVehicleLayers.csv (optional — if provided, adds per-unit vehicle lists with respawn times)')
    parser.add_argument('--spatial-dir', help='CUE4Parse spatial JSON directory (optional but strongly recommended)')
    parser.add_argument('--output', required=True, help='Output JSON path')
    args = parser.parse_args()

    # Load existing baseline
    print("Loading existing site data baseline...")
    with open(args.existing_data) as f:
        baseline = json.load(f)
    existing_layers = baseline['W']
    existing_by_name = {l['rawName']: l for l in existing_layers}

    print(f"  baseline layers: {len(existing_layers)}")

    # Load CUE4Parse spatial extraction
    spatial_index = load_spatial_index(args.spatial_dir)
    if spatial_index:
        print(f"  CUE4Parse spatial layers: {len(spatial_index)}")

    # Parse SDK CSV
    print("Parsing SDK CSV data...")
    csv_layers = parse_layers_csv(args.layers_csv)
    print(f"  SDK CSV layers (raw): {len(csv_layers)}")

    # Parse vehicle CSV (optional)
    vehicles_by_layer = {}
    if args.vehicles_csv:
        print("Parsing SDK vehicle CSV...")
        vehicles_by_layer = parse_vehicles_csv(args.vehicles_csv)
        total_records = sum(sum(len(v) for v in u.values()) for u in vehicles_by_layer.values())
        print(f"  Vehicle CSV: {len(vehicles_by_layer)} layers, {total_records} vehicle records")

    # Filter out non-playable layers (CoopTemplate, JensensRange, JensensLobby, Training, Tutorial)
    SKIP_PATTERNS = ['CoopTemplate', 'JensensRange', 'JensensLobby',
                     'Tutorial_', 'Training_']
    csv_layers = {k: v for k, v in csv_layers.items()
                  if not any(pat in k for pat in SKIP_PATTERNS)}
    print(f"  SDK CSV layers (filtered): {len(csv_layers)}")

    # Index map-level spatial data so new layers can inherit from same-map siblings
    map_spatial = build_map_spatial_index(existing_layers)
    map_assets_index = {}
    for layer in existing_layers:
        mid = layer['mapId']
        if mid not in map_assets_index:
            map_assets_index[mid] = layer.get('mapAssets', {})

    # MapId remapping: layer-name prefixes that differ from the canonical mapIds
    # the existing data uses internally
    MAPID_REMAP = {
        'Sanxian': 'Sanxian_Islands',
        'PPG': 'PacificProvingGrounds',
    }

    # Determine layer sets: which layers exist in baseline vs CSV
    baseline_names = set(existing_by_name.keys())
    csv_names = set(csv_layers.keys())

    common = baseline_names & csv_names
    only_in_baseline = baseline_names - csv_names
    only_in_csv = csv_names - baseline_names

    print(f"\n  Common layers (in both baseline and CSV): {len(common)}")
    print(f"  Only in baseline (no CSV record): {len(only_in_baseline)}")
    print(f"  Only in CSV (new since baseline): {len(only_in_csv)}")

    # Build output layer list
    output_layers = []
    stats = {'updated': 0, 'inherited': 0, 'new_created': 0, 'dropped': 0,
             'spatial_replaced': 0}

    # 1. Process common layers: refresh teamConfigs from CSV, replace spatial
    #    from CUE4Parse if available
    print("\nProcessing common layers...")
    for name in sorted(common):
        layer = deepcopy(existing_by_name[name])
        csv_row = csv_layers[name]

        # Refresh teamConfigs from CSV
        layer['teamConfigs'] = build_team_configs(csv_row)

        # Refresh commander + tickets
        layer['commanderDisabled'] = not csv_row['commander']
        layer['teamConfigs']['team1']['tickets'] = csv_row['tickets_t1']
        layer['teamConfigs']['team2']['tickets'] = csv_row['tickets_t2']

        # Attach per-unit vehicle lists (faction asset_name -> [vehicles])
        if vehicles_by_layer:
            layer['vehiclesByUnit'] = vehicles_by_layer.get(name, {})

        # Refresh spatial from CUE4Parse if we have it
        if name in spatial_index:
            merge_spatial_into_layer(layer, spatial_index[name], csv_row['cp_type'])
            stats['spatial_replaced'] += 1

        output_layers.append(layer)
        stats['updated'] += 1

    # 2. Process layers that are new since the baseline was last built
    print("Creating new layers from CSV...")
    for name in sorted(only_in_csv):
        csv_row = csv_layers[name]

        map_key = name.split('_')[0]
        mapid = MAPID_REMAP.get(map_key, map_key)

        new_layer = create_new_layer(csv_row, map_spatial, mapid_override=mapid)

        # Try to inherit mapAssets from a same-map sibling in the baseline
        if mapid in map_assets_index:
            new_layer['mapAssets'] = deepcopy(map_assets_index[mapid])

        # Try to inherit other assets (vehicle spawners etc.) from a
        # same-gamemode sibling, falling back to any same-map sibling
        best_sibling = None
        for sibling_name, sibling_layer in existing_by_name.items():
            if sibling_layer['mapId'] == mapid and sibling_layer.get('gamemode', '') == csv_row['cp_type']:
                best_sibling = sibling_layer
                break
        if not best_sibling:
            for sibling_name, sibling_layer in existing_by_name.items():
                if sibling_layer['mapId'] == mapid:
                    best_sibling = sibling_layer
                    break

        if best_sibling:
            new_layer['assets'] = deepcopy(best_sibling.get('assets', {}))
            new_layer['capturePoints'] = deepcopy(best_sibling.get('capturePoints', {}))
            new_layer['objectives'] = deepcopy(best_sibling.get('objectives', {}))
            stats['inherited'] += 1
            print(f"  {name}: inherited from {best_sibling['rawName']}")
        else:
            stats['new_created'] += 1
            print(f"  {name}: no sibling found, created with empty spatial data")

        # Attach per-unit vehicle lists (faction asset_name -> [vehicles])
        if vehicles_by_layer:
            new_layer['vehiclesByUnit'] = vehicles_by_layer.get(name, {})

        # CUE4Parse wins over inherited spatial if both are available
        if name in spatial_index:
            merge_spatial_into_layer(new_layer, spatial_index[name], csv_row['cp_type'])
            stats['spatial_replaced'] += 1

        output_layers.append(new_layer)

    # 3. Layers in baseline but no longer in the CSV
    stats['dropped'] = len(only_in_baseline)
    if only_in_baseline:
        print(f"\nDropped {len(only_in_baseline)} layers no longer in the SDK CSV:")
        for name in sorted(only_in_baseline):
            print(f"  - {name}")
    
    # Sort output by Name for consistent ordering
    output_layers.sort(key=lambda l: l['rawName'])
    
    # Build final output
    output = {
        "W": output_layers,
    }
    
    # Write output
    print(f"\nWriting {len(output_layers)} layers to {args.output}...")
    with open(args.output, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    output_size = Path(args.output).stat().st_size
    print(f"  Output size: {output_size:,} bytes ({output_size/1024/1024:.1f} MB)")

    # Also write the .js variant the frontend loads via <script> tag, IF
    # the output path ends in .json. Replaces .json with .js next to it.
    output_path = Path(args.output)
    if output_path.suffix == '.json':
        js_path = output_path.with_suffix('.js')
        with open(js_path, 'w') as f:
            f.write('window.SQUAD_DATA = ')
            json.dump(output, f, separators=(',', ':'))
            f.write(';\n')
        print(f"  Also wrote {js_path} ({js_path.stat().st_size:,} bytes)")
    
    # Summary
    print(f"\n{'='*60}")
    print(f"  Site Data Build Complete")
    print(f"{'='*60}")
    print(f"  Total layers: {len(output_layers)}")
    print(f"  Refreshed from baseline: {stats['updated']}")
    print(f"  New (inherited spatial): {stats['inherited']}")
    print(f"  New (empty spatial): {stats['new_created']}")
    print(f"  Dropped (no longer in CSV): {stats['dropped']}")
    print(f"  Spatial replaced from CUE4Parse: {stats['spatial_replaced']}")
    
    # Unique maps
    map_ids = sorted(set(l['mapId'] for l in output_layers))
    print(f"  Unique maps: {len(map_ids)}")
    
    # Unique factions
    factions = set()
    for l in output_layers:
        tc = l.get('teamConfigs', {})
        for units in [tc.get('factions', {}).get('team1Units', []),
                      tc.get('factions', {}).get('team2Units', [])]:
            for u in units:
                factions.add(u['factionID'])
    print(f"  Unique factions: {len(factions)} - {sorted(factions)}")


if __name__ == '__main__':
    main()
