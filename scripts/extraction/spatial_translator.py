"""
Translate CUE4Parse spatial JSON to site layer fragments.

The CUE4Parse extractor (scripts/extraction/cue4parse-extractor) produces
per-layer JSON with lane graphs, capture zones, mains, vehicle spawners,
etc. This module converts that to the dict shapes that build_v10_site_data.py
merges into v10_data.json:

    {
      'capturePoints': { type, lanes, points, clusters, hexs, ... },
      'objectives': { '<key>': {...}, ... },
      'mapAssets':  { protectionZones, stagingZones, spawnGroups },
      'assets':     { vehicleSpawners, deployables, helipads },
    }

The output schema matches what the frontend's rendering code already
consumes — no frontend changes required.

Improvements over the legacy data extraction this replaces:
- Duplicate lane names are disambiguated (Echo, Echo_2) instead of being
  silently dropped — fixes the Manicouagan_RAAS_v2 bug where two distinct
  Echo lanes collapsed into one because the dict-keyed laneObjects
  structure couldn't hold both.
- Cluster names are normalized to strip UE's "_N" disambiguation suffixes
  (e.g. "A2-CaptureZoneCluster_3" -> "A2-CaptureZoneCluster").
- Capture zone positions follow the actor RootComponent.AttachParent walk
  so cluster-attached zones get their correct world position.
- FlagName is read from SQCaptureZoneComponent.FlagName FText (the
  legacy editor extraction couldn't reach this property).

Usage (standalone, for testing):

    python3 spatial_translator.py path/to/spatial/Manicouagan_RAAS_v1.json RAAS
"""

import argparse
import json
import re
import sys
from typing import Any, Optional


# UE adds "_N" suffixes when there are multiple instances of an actor with
# the same base name. Strip them for cluster names so "A2-CaptureZoneCluster_3"
# matches "A2-CaptureZoneCluster" in the legacy data.
_UE_DISAMBIG_SUFFIX = re.compile(r'_\d+$')


_CORRUPTED_NAME_REPAIRS: dict[str, str] = {
    # Harju — Squad's SDK FText SourceString for these Finnish placenames was
    # written with a non-UTF-8 codepage and the diacritics collapsed to '?'.
    # CUE4Parse just reads back the corrupted string, so we patch at translate.
    'N?kym?': 'Näkymä',
    'J?rvikyl?': 'Järvikylä',
    'M?ntyharju': 'Mäntyharju',
    'K?py': 'Käpy',
    'Mets?kyl?': 'Metsäkylä',
    'Mets?kyl? Apartments': 'Metsäkylä Apartments',
    'Mets?kyl? North': 'Metsäkylä North',
    'Mets?kyl? South': 'Metsäkylä South',
    'Mets?kyl?North': 'Metsäkylä North',
    'Mets?kyl?South': 'Metsäkylä South',
}

_PREFIXED_NAME_RE = re.compile(r'^([A-Z]?\d{1,2}-)(.+)$')


def _repair_name(value: Optional[str]) -> Optional[str]:
    """Repair known corrupted names (Squad-shipped `?` placeholders).

    Handles both bare names ("J?rvikyl?") and lane/order-prefixed variants
    ("B3-J?rvikyl?", "02-J?rvikyl?") by peeling the prefix and looking up
    the tail in the repair table.
    """
    if not value or '?' not in value:
        return value
    if value in _CORRUPTED_NAME_REPAIRS:
        return _CORRUPTED_NAME_REPAIRS[value]
    m = _PREFIXED_NAME_RE.match(value)
    if m and m.group(2) in _CORRUPTED_NAME_REPAIRS:
        return m.group(1) + _CORRUPTED_NAME_REPAIRS[m.group(2)]
    return value


_NAME_KEYS = {'name', 'flagName', 'objectName', 'objectDisplayName',
              'displayName', 'Name', 'nodeA', 'nodeB'}
_NAME_ARRAY_KEYS = {'pointsOrder'}


def _repair_names_in_place(obj: Any) -> None:
    """Walk a parsed CUE4Parse spatial dict and repair corrupted name strings.

    Only touches keys that carry human-readable labels or node references so
    we don't accidentally rewrite asset paths.
    """
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in _NAME_KEYS and isinstance(v, str):
                obj[k] = _repair_name(v)
            elif k in _NAME_ARRAY_KEYS and isinstance(v, list):
                obj[k] = [_repair_name(s) if isinstance(s, str) else s for s in v]
            else:
                _repair_names_in_place(v)
    elif isinstance(obj, list):
        for item in obj:
            _repair_names_in_place(item)


def _strip_ue_suffix(name: str) -> str:
    """Strip UE's auto-generated _N suffix from an actor name."""
    return _UE_DISAMBIG_SUFFIX.sub('', name or '')


def _strip_lane_prefix(label: str) -> Optional[str]:
    """
    Extract the lane prefix from a label like "A1-Logging Camp" -> "A1".
    Returns None if the label doesn't fit the pattern.
    """
    if not label:
        return None
    m = re.match(r'^([A-Z]\d{1,2})-', label)
    return m.group(1) if m else None


def _strip_index_prefix(label: str) -> tuple[Optional[int], str]:
    """
    Extract the numeric ordering prefix from an AAS-style label like
    "01-Logging Camp" -> (1, "Logging Camp"). Returns (None, label) if no
    prefix matches.
    """
    if not label:
        return None, label or ''
    m = re.match(r'^(\d+)-(.+)$', label)
    if not m:
        return None, label
    return int(m.group(1)), m.group(2)


def _build_sphere_object(loc: dict, radius: Optional[float] = None) -> dict:
    """Build a site-format 'objects' entry (sphere collision shape)."""
    r = float(radius) if radius is not None else 5000.0
    return {
        'objectName': 'Sphere',
        'location_x': loc.get('location_x', 0.0),
        'location_y': loc.get('location_y', 0.0),
        'location_z': loc.get('location_z', 0.0),
        'isSphere': True,
        'sphereRadius': str(r),
        'isBox': False,
        'boxExtent': {
            'extent_x': r,
            'extent_y': r,
            'extent_z': r,
            'rotation_x': 0,
            'rotation_y': 0,
            'rotation_z': 0,
        },
        'isCapsule': False,
    }


def _normalize_main_key(label: str) -> str:
    """
    Convert a main actor label like "00-Team1 Main" to the site dict-key
    form "00-Team1Main" (no space).
    """
    return (label or '').replace(' ', '')


def _normalize_cluster_key(label: str) -> str:
    """
    Normalize a cluster actor label for use as an objectives dict key.
    Strips UE _N suffixes so "A2-CaptureZoneCluster_3" -> "A2-CaptureZoneCluster".
    """
    return _strip_ue_suffix(label or '')


def _build_lane_pointsorder(links: list[dict], resolve=None) -> list[str]:
    """
    Walk a lane's links to produce an ordered list of node names.
    Each link has nodeA -> nodeB; assumes a linear chain so the result
    is [main, c1, c2, ..., main]. Cluster names are resolved via
    `resolve` (actor-name → ActorLabel mapping) or fall back to
    _normalize_cluster_key when no resolver is supplied.
    """
    if not links:
        return []
    resolve = resolve or _normalize_cluster_key
    order: list[str] = []
    for link in links:
        a = link.get('nodeA')
        b = link.get('nodeB')
        if not order and a:
            order.append(resolve(a))
        if b:
            order.append(resolve(b))
    return order


def _build_actor_to_label_map(clusters: list[dict], mains: list[dict] | None = None) -> dict[str, str]:
    """
    Build a mapping from a UE actor name to its dict-key form (ActorLabel,
    minus spaces for mains).

    For most layers Squad's level designers used the same string for
    actor.Name and ActorLabel, so this map is identity for those entries.
    For Al Basrah RAAS v3 (and similar) the actors are named
    "01W-..".."05W-..._1" while the ActorLabels are "A1-..".."A7-..", AND
    the team-2 main is ActorLabel="Z-Team2 Main" / Name="100-Team2 Main".
    The SQRAASLaneInitializer's FPackageIndex refs carry the actor name,
    so without this map the lane node refs don't match the cluster /
    main dict keys.
    """
    m: dict[str, str] = {}
    for c in clusters or []:
        an = c.get('actorName')
        ol = c.get('objectName')
        if an and ol:
            m[an] = ol
    for main in mains or []:
        an = main.get('actorName')
        ol = main.get('objectName')
        if an and ol:
            # Mains use _normalize_main_key (space-stripping) as their dict key,
            # so map both sides through it.
            m[(an or '').replace(' ', '')] = (ol or '').replace(' ', '')
    return m


def _build_lane_objects(lane_graph: dict, actor_to_label: dict[str, str] | None = None) -> dict:
    """
    Convert a CUE4Parse laneGraph dict into the site capturePoints.lanes shape:
        { links: [...], listOfLanes: [...], laneObjects: {name: {...}} }

    Disambiguates duplicate lane names by appending _2, _3, etc. (this fixes
    the Manicouagan_RAAS_v2 bug where the dict-keyed structure collapsed two Echo lanes into one).

    actor_to_label resolves lane node refs (which carry UE actor names) to
    the cluster dict keys (which carry ActorLabels) — without that mapping,
    Al-Basrah-style layers where the two diverge produce lanes whose
    pointsOrder references entities that aren't in the objectives dict.
    """
    if not lane_graph:
        return {}
    cue_lanes = lane_graph.get('lanes') or []
    if not cue_lanes:
        return {}
    actor_to_label = actor_to_label or {}

    def _resolve_node(raw: str) -> str:
        """actor-name → ActorLabel if mapped, else strip UE _N suffix."""
        if not raw:
            return ''
        # Mains pass through unchanged (they have their own naming).
        if raw in actor_to_label:
            return actor_to_label[raw]
        return _normalize_cluster_key(raw)

    list_of_lanes: list[str] = []
    lane_objects: dict[str, dict] = {}
    all_links: list[dict] = []

    seen_names: dict[str, int] = {}
    for cue_lane in cue_lanes:
        original = cue_lane.get('name') or 'UnnamedLane'
        # Disambiguate duplicates
        if original in seen_names:
            seen_names[original] += 1
            unique_name = f"{original}_{seen_names[original]}"
        else:
            seen_names[original] = 1
            unique_name = original

        cue_links = cue_lane.get('links') or []
        points_order = _build_lane_pointsorder(cue_links, _resolve_node)

        # Identify mains in the lane
        mains_in_lane = [p for p in points_order if 'Main' in p]

        lane_objects[unique_name] = {
            'name': unique_name,
            'laneLinks': [
                {
                    'name': f'Link_{unique_name}_{i}',
                    'nodeA': _resolve_node(link.get('nodeA') or ''),
                    'nodeB': _resolve_node(link.get('nodeB') or ''),
                }
                for i, link in enumerate(cue_links)
            ],
            'pointsOrder': points_order,
            'numberOfPoints': len(points_order),
            'listOfMains': mains_in_lane,
            # Preserve the lane color (CUE4Parse-only addition)
            'colorHex': cue_lane.get('colorHex'),
        }
        list_of_lanes.append(unique_name)

        # Mirror into flat link list (matches the site capturePoints.lanes.links shape)
        for i, link in enumerate(cue_links):
            all_links.append({
                'name': f'Link_{unique_name}_{i}',
                'nodeA': _resolve_node(link.get('nodeA') or ''),
                'nodeB': _resolve_node(link.get('nodeB') or ''),
            })

    return {
        'links': all_links,
        'listOfLanes': list_of_lanes,
        'laneObjects': lane_objects,
    }


def _build_aas_pointsorder(spatial: dict) -> dict:
    """
    Build capturePoints.points for AAS-style layers (no lane graph).
    Sorts orphan capture zones by their numeric prefix and stitches them
    between the two mains.
    """
    mains = spatial.get('mains') or []
    orphans = spatial.get('orphanCaptureZones') or []

    # Sort orphans by their numeric label prefix
    indexed = []
    for cz in orphans:
        idx, _ = _strip_index_prefix(cz.get('objectName') or '')
        if idx is not None:
            indexed.append((idx, cz))
    indexed.sort(key=lambda x: x[0])

    # Find Team1 and Team2 mains by name pattern
    team1_main = next((m for m in mains if 'team1' in (m.get('objectName') or '').lower()), None)
    team2_main = next((m for m in mains if 'team2' in (m.get('objectName') or '').lower()), None)

    points_order: list[str] = []
    if team1_main:
        points_order.append(_normalize_main_key(team1_main['objectName']))
    for _, cz in indexed:
        points_order.append(_normalize_cluster_key(cz['objectName']))
    if team2_main:
        points_order.append(_normalize_main_key(team2_main['objectName']))

    return {
        'pointsOrder': points_order,
        'numberOfPoints': len(points_order),
        'listOfMains': [_normalize_main_key(team1_main['objectName'])] if team1_main else []
                       + ([_normalize_main_key(team2_main['objectName'])] if team2_main else []),
        'objectives': [],  # Legacy field — we put per-objective data in the top-level 'objectives' dict instead
    }


def _build_objectives(spatial: dict) -> dict:
    """
    Build the top-level 'objectives' dict that the frontend reads to
    render markers. Includes:
      - Mains (one entry each, with sphere collision)
      - Clusters (one entry each, with sub-point alternatives in 'points')
      - Orphan capture zones (one entry each, AAS-style)
    """
    objectives: dict[str, dict] = {}

    # Mains
    for main in spatial.get('mains') or []:
        key = _normalize_main_key(main.get('objectName') or '')
        if not key:
            continue
        objectives[key] = {
            'name': 'Main',
            'objectName': key,
            'objectDisplayName': main.get('objectName') or key,
            'location_x': main.get('location_x', 0.0),
            'location_y': main.get('location_y', 0.0),
            'location_z': main.get('location_z', 0.0),
            'objects': [_build_sphere_object(main)],
        }

    # Clusters with sub-points (RAAS / Invasion)
    for cluster in spatial.get('clusters') or []:
        key = _normalize_cluster_key(cluster.get('objectName') or '')
        if not key:
            continue
        cluster_radius = cluster.get('sphereRadius')

        sub_points = []
        for cz in cluster.get('captureZones') or []:
            sub_points.append({
                'name': cz.get('flagName') or cz.get('objectName') or 'Objective',
                'objectName': (cz.get('objectName') or '').replace(' ', ''),
                'objectDisplayName': cz.get('objectName') or '',
                'location_x': cz.get('location_x', 0.0),
                'location_y': cz.get('location_y', 0.0),
                'location_z': cz.get('location_z', 0.0),
                'objects': [_build_sphere_object(cz, cz.get('sphereRadius') or cluster_radius)],
            })

        if sub_points:
            avg_x = sum(p['location_x'] for p in sub_points) / len(sub_points)
            avg_y = sum(p['location_y'] for p in sub_points) / len(sub_points)
            avg_z = sum(p['location_z'] for p in sub_points) / len(sub_points)
        else:
            avg_x = cluster.get('location_x', 0.0)
            avg_y = cluster.get('location_y', 0.0)
            avg_z = cluster.get('location_z', 0.0)

        objectives[key] = {
            'name': key,
            'pointPosition': 0,  # filled in by lane assignment if needed
            'avgLocation': {
                'location_x': avg_x,
                'location_y': avg_y,
                'location_z': avg_z,
            },
            'points': sub_points,
        }

    # Orphan capture zones (AAS style — no parent cluster)
    for cz in spatial.get('orphanCaptureZones') or []:
        # Strip the UE _N suffix and use the result as both key and display
        raw_name = cz.get('objectName') or ''
        key = _normalize_cluster_key(raw_name).replace(' ', '')
        if not key:
            continue
        objectives[key] = {
            'name': cz.get('flagName') or raw_name,
            'objectName': key,
            'objectDisplayName': raw_name,
            'location_x': cz.get('location_x', 0.0),
            'location_y': cz.get('location_y', 0.0),
            'location_z': cz.get('location_z', 0.0),
            'objects': [_build_sphere_object(cz, cz.get('sphereRadius'))],
        }

    return objectives


def _build_capture_points(spatial: dict, gamemode: str) -> dict:
    """Build the capturePoints sub-object."""
    cp_type = _gamemode_to_cp_type(gamemode)

    # Lanes (RAAS / Invasion). Pass the actor-name → ActorLabel mapping so
    # layers like Al Basrah RAAS v3 — where the SDK names the lane node
    # actors differently from their editor labels — resolve correctly.
    actor_to_label = _build_actor_to_label_map(
        spatial.get('clusters') or [],
        spatial.get('mains') or [],
    )
    lanes = _build_lane_objects(spatial.get('laneGraph') or {}, actor_to_label)

    # Points order (AAS — no lane graph)
    if not lanes and (spatial.get('orphanCaptureZones') or []):
        points = _build_aas_pointsorder(spatial)
    else:
        points = {}

    return {
        'type': cp_type,
        'lanes': lanes,
        'points': points,
        'clusters': {},
        'hexs': {},
        'objectiveSpawnLocations': {},
        'destructionObject': {},  # TODO: Phase 2.5 destruction extraction
    }


def _gamemode_to_cp_type(gamemode: str) -> str:
    """Map a gamemode string to the site capturePoints.type value."""
    mapping = {
        'AAS': 'AAS Graph',
        'RAAS': 'RAASLane Graph',
        'Invasion': 'Invasion',
        'Destruction': 'Destruction',
        'TC': 'TC Hex Zone',
        'Territory Control': 'TC Hex Zone',
        'Insurgency': 'Insurgency',
        'Skirmish': 'Skirmish',
        'Seed': 'Seed',
        'Training': 'Training',
        'Fireteam': 'Fireteam',
    }
    return mapping.get(gamemode, gamemode)


def _build_map_assets(spatial: dict) -> dict:
    """Convert protectionZones / stagingZones to site mapAssets shape."""
    return {
        'protectionZones': [
            {
                'displayName': pz.get('displayName') or pz.get('name') or '',
                'teamid': pz.get('teamid') or '',
                'deployableLockDistance': pz.get('deployableLockDistance') or 0,
                'objects': [_build_sphere_object(pz)],
            }
            for pz in (spatial.get('protectionZones') or [])
        ],
        'stagingZones': [
            {
                'name': sz.get('name') or '',
                'objects': [_build_sphere_object(sz)],
            }
            for sz in (spatial.get('stagingZones') or [])
        ],
        'spawnGroups': [
            {
                'name': sg.get('name') or '',
                'team': sg.get('team') or '',
                'location_x': sg.get('location_x', 0.0),
                'location_y': sg.get('location_y', 0.0),
                'location_z': sg.get('location_z', 0.0),
            }
            for sg in (spatial.get('teamSpawnGroups') or [])
        ],
    }


def _normalize_team_field(team: Optional[str]) -> str:
    """
    Convert CUE4Parse's team enum value (e.g. "Team_One") to the site's
    spawner type field ("Team One").
    """
    if not team:
        return ''
    if team in ('Team_One', 'TEAM_ONE'):
        return 'Team One'
    if team in ('Team_Two', 'TEAM_TWO'):
        return 'Team Two'
    return team.replace('_', ' ')


def _build_assets(spatial: dict) -> dict:
    """Convert vehicle spawners / deployables / helipads to site assets shape."""
    return {
        'vehicleSpawners': [
            {
                'icon': 'questionmark',  # legacy data had per-vehicle icons we don't yet recover
                'name': vs.get('name') or '',
                'type': _normalize_team_field(vs.get('team')),
                'size': '',  # legacy data had vehicle size; needs cross-ref against SquadVehicleLayers.csv
                'maxNum': vs.get('maxNum') or 0,
                'location_x': vs.get('location_x', 0.0),
                'location_y': vs.get('location_y', 0.0),
                'location_z': vs.get('location_z', 0.0),
                'rotation_x': 0,
                'rotation_y': 0,
                'rotation_z': vs.get('rotation_yaw', 0.0),
                'typePriorities': [],
                'tagPriorities': [],
            }
            for vs in (spatial.get('vehicleSpawners') or [])
        ],
        'deployables': [
            {
                'name': dp.get('name') or '',
                'type': _normalize_team_field(dp.get('team')),
                'location_x': dp.get('location_x', 0.0),
                'location_y': dp.get('location_y', 0.0),
                'location_z': dp.get('location_z', 0.0),
            }
            for dp in (spatial.get('deployables') or [])
        ],
        'helipads': [
            {
                'name': hp.get('name') or '',
                'location_x': hp.get('location_x', 0.0),
                'location_y': hp.get('location_y', 0.0),
                'location_z': hp.get('location_z', 0.0),
            }
            for hp in (spatial.get('helipads') or [])
        ],
    }


def _build_border(spatial: dict) -> list[dict]:
    """
    Build a border spline from the SQMapBoundary actor. CUE4Parse currently
    only gives us the boundary actor's location (one point). The boundary's
    actual extent lives on a child component we don't yet extract — until we
    do, return an empty list and let the build script fall back to the existing baseline border data.
    """
    return []


def translate(spatial: dict, gamemode: str) -> dict[str, Any]:
    """
    Convert a single CUE4Parse spatial JSON dict to site
    layer fragments. Returns a dict with capturePoints, objectives,
    mapAssets, and assets keys ready to be merged into a layer.
    """
    _repair_names_in_place(spatial)
    return {
        'capturePoints': _build_capture_points(spatial, gamemode),
        'objectives': _build_objectives(spatial),
        'mapAssets': _build_map_assets(spatial),
        'assets': _build_assets(spatial),
    }


def translate_file(spatial_path: str, gamemode: str) -> dict[str, Any]:
    """Load a spatial JSON file from disk and translate it."""
    with open(spatial_path) as f:
        spatial = json.load(f)
    return translate(spatial, gamemode)


def main():
    parser = argparse.ArgumentParser(description='Translate CUE4Parse spatial JSON to site layer format')
    parser.add_argument('spatial_json', help='Path to spatial/<LayerName>.json')
    parser.add_argument('gamemode', help='Gamemode string (RAAS, AAS, etc.)')
    parser.add_argument('--out', help='Optional output path; otherwise prints to stdout')
    parser.add_argument('--summary', action='store_true', help='Print only a summary instead of the full JSON')
    args = parser.parse_args()

    result = translate_file(args.spatial_json, args.gamemode)

    if args.summary:
        cp = result['capturePoints']
        lanes = cp.get('lanes') or {}
        print(f"Translated {args.spatial_json} as {args.gamemode}")
        print(f"  capturePoints.type: {cp.get('type')}")
        print(f"  lanes: {len(lanes.get('listOfLanes', []))}")
        for ln in lanes.get('listOfLanes', []):
            lo = lanes['laneObjects'][ln]
            print(f"    {ln} ({lo.get('colorHex')}): {lo.get('numberOfPoints')} points")
        print(f"  objectives: {len(result['objectives'])}")
        print(f"  vehicleSpawners: {len(result['assets']['vehicleSpawners'])}")
        print(f"  protectionZones: {len(result['mapAssets']['protectionZones'])}")
        return

    out_text = json.dumps(result, indent=2)
    if args.out:
        with open(args.out, 'w') as f:
            f.write(out_text)
        print(f"Wrote {args.out}")
    else:
        print(out_text)


if __name__ == '__main__':
    main()
