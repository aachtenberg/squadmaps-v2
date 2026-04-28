/* ====================================================================
   SquadMaps v10 – Main Application
   ==================================================================== */
(function () {
  'use strict';

  // ---- State ----
  let allLayers = [];
  let mapGroups = {};        // mapId -> [layers]
  let translations = {};
  let currentLang = 'en';
  let leafletMap = null;
  let tileLayer = null;
  let markerGroup = null;
  let mapResizeObserver = null;
  let userInteractedWithMap = false;
  let currentMapId = null;
  let currentLayerIndex = 0;
  let selectedFactionIds = { team1: null, team2: null };
  let activeLane = null;       // e.g. 'Alpha', 'Bravo' – null means infer from captureSequence
  let captureSequence = [];    // array of normalized tokens captured so far, in order
  let activeTeam = null;       // 'team1' or 'team2' – which team's perspective
  let capturedSubPoints = {};  // token -> {x, y, name} – which sub-point was picked for each captured obj
  let stagingFocus = null;     // { tokens, x, y, name } – pre-cap intent picked on the map
  let activeDestructionPhase = null; // null = show all phases, 0/1/2 = specific phase
  let animatedLaneLines = [];
  let laneAnimationFrameId = null;
  let lastLaneAnimationTs = 0;
  let strategyDrawerOpen = false;
  let matchInfoCollapsed = false;
  let leftSidebarOpen = false;

  // HAB placement (triggered via right-click context menu — no dedicated tool state).
  let placedHabs = [];              // [{ueX, ueY, team, marker, buildCircle, exclusionCircle}]
  let habLayerGroup = null;
  const HAB_BUILD_RADIUS = 15000;     // 150m in UE units (construction radius)
  const HAB_EXCLUSION_RADIUS = 40000; // 400m in UE units (enemy/friendly FOB exclusion)

  // Indirect-fire tool.
  // Always-on: double-click the map to place. First dblclick = weapon (shows
  // range circle); each subsequent dblclick adds an independent target. All
  // markers are draggable. Dragging the weapon keeps every target where it
  // is — the firing solutions just recompute from the new position.
  let mortarPosition = null;         // {ueX, ueY} — world UE units
  let targetPositions = [];          // array of {ueX, ueY}, added in order
  let mortarLayerGroup = null;
  // Persistent references to the Leaflet objects so drag updates can move
  // them in place without a full re-render (which would destroy the marker
  // mid-drag and break the interaction). `targets` is a parallel array to
  // targetPositions with per-target marker + line handles.
  const mortarRefs = { marker: null, rangeCircle: null, targets: [] };
  // Right-click context-menu state. ctxMenuLatLng is the map coord captured at
  // the moment the user opened the menu — actions read it when an item fires.
  let ctxMenuLatLng = null;
  let ctxMenuJustClosed = false;
  const heightmapCache = {};
  let activeWeaponId = 'mortar';
  let activeShellIdx = 0;
  // Our mapId -> squadcalc heightmap file mapping.
  // Same json shape everywhere: 500x500 float array of meters above sea level.
  const HEIGHTMAP_FILES = {
    AlBasrah: 'albasrah', Anvil: 'anvil', BlackCoast: 'blackcoast',
    Chora: 'chora', Fallujah: 'fallujah', FoolsRoad: 'foolsroad',
    GooseBay: 'goosebay', Gorodok: 'gorodok', Harju: 'harju',
    Kamdesh: 'kamdesh', Kohat: 'kohat', Kokan: 'kokan',
    Lashkar: 'lashkar', Logar: 'logar', Manicouagan: 'manicouagan',
    Mestia: 'mestia', Mutaha: 'mutaha', Narva: 'narva',
    PacificProvingGrounds: 'pacific', Sanxian_Islands: 'sanxian',
    Skorpo: 'skorpo', Sumari: 'sumari', Tallil: 'tallil',
    Yehorivka: 'yehorivka',
  };
  const GRAVITY = 9.78;
  const WEAPON_IDS = [
    'mortar',
    'technical-mortar',
    'hellcannon',
    'ub-32',
    'technical-ub-32',
    'bm-21-grad',
    'mk19',
    'btr4-ags',
    'm1064m121',
    'mo120rtf1',
    'm109',
    'm777',
    't62-dump-truck',
    'himars',
    'tos-1a',
    'ural-hellcannon',
    'mtlb-fab500',
  ];
  const WEAPONS = {
    mortar: {
      displayName: 'Standard Mortar',
      category: 'base',
      source: 'Vanilla Squad',
      gravityScale: 1,
      heightOffset: 1,
      angleOffset: 0,
      minElevation: [45, 88.875],
      unit: 'mil',
      angleType: 'high',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 110, moa: 50, minDistance: 51, explosionRadius: [0, 40] }],
    },
    'technical-mortar': {
      displayName: 'Technical Mortar',
      category: 'base',
      source: 'Vanilla Squad',
      gravityScale: 1,
      heightOffset: 2.5,
      angleOffset: 5,
      minElevation: [-45, 135],
      unit: 'deg',
      angleType: 'high',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 110, moa: 50, minDistance: 51, explosionRadius: [0, 40] }],
    },
    hellcannon: {
      displayName: 'HellCannon',
      category: 'base',
      source: 'Vanilla Squad',
      gravityScale: 1,
      heightOffset: 1.5,
      angleOffset: 0,
      minElevation: [10, 90],
      unit: 'deg',
      angleType: 'high',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 95, moa: 100, minDistance: 0, explosionRadius: [1, 50] }],
    },
    'ub-32': {
      displayName: 'UB-32',
      category: 'base',
      source: 'Vanilla Squad',
      gravityScale: 2,
      heightOffset: 1,
      angleOffset: 0,
      minElevation: [-25, 35],
      unit: 'deg',
      angleType: 'low',
      deceleration: 50,
      decelerationTime: 2,
      projectileLifespan: 20,
      shells: [{ name: 'default', velocity: 300, moa: 300, minDistance: 0, explosionRadius: [5, 18] }],
    },
    'technical-ub-32': {
      displayName: 'Tech.UB-32',
      category: 'base',
      source: 'Vanilla Squad',
      gravityScale: 2,
      heightOffset: 2.5,
      angleOffset: 0,
      minElevation: [-45, 135],
      unit: 'deg',
      angleType: 'low',
      deceleration: 50,
      decelerationTime: 2,
      projectileLifespan: 20,
      shells: [{ name: 'default', velocity: 300, moa: 300, minDistance: 0, explosionRadius: [5, 18] }],
    },
    'bm-21-grad': {
      displayName: 'BM-21 Grad',
      category: 'base',
      source: 'Vanilla Squad',
      gravityScale: 2,
      heightOffset: 3,
      angleOffset: 0,
      minElevation: [-45, 135],
      unit: 'deg',
      angleType: 'low',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 200, moa: 200, minDistance: 0, explosionRadius: [1, 35] }],
    },
    mk19: {
      displayName: 'Mk19',
      category: 'base',
      source: 'Vanilla Squad',
      gravityScale: 1,
      heightOffset: 4,
      angleOffset: 0.984,
      minElevation: [-45, 85.3],
      unit: 'deg',
      angleType: 'low',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 20,
      shells: [{ name: 'default', velocity: 230, moa: 50, minDistance: 10, explosionRadius: [1, 15] }],
    },
    'btr4-ags': {
      displayName: 'BTR4-AGS',
      category: 'base',
      source: 'Vanilla Squad',
      gravityScale: 1,
      heightOffset: 3.4,
      angleOffset: 0.73459689,
      minElevation: [-45, 135],
      unit: 'degMin',
      angleType: 'low',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 20,
      shells: [{ name: 'default', velocity: 190, moa: 15, minDistance: 0, explosionRadius: [1, 15] }],
    },
    m1064m121: {
      displayName: 'M1064M121',
      category: 'base',
      source: 'Vanilla Squad',
      gravityScale: 1,
      heightOffset: 3,
      angleOffset: 0,
      minElevation: [-45, 85.3],
      unit: 'deg',
      angleType: 'high',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [
        { name: 'impact', velocity: 142, moa: 40, minDistance: 340, explosionRadius: [0, 40] },
        { name: 'nearSurface', velocity: 142, moa: 50, minDistance: 340, explosionRadius: [10, 60] },
      ],
    },
    mo120rtf1: {
      displayName: 'MO120RTF1',
      category: 'modded',
      source: 'SuperMod',
      gravityScale: 1,
      heightOffset: 3,
      angleOffset: 0,
      minElevation: [45, 85.3],
      unit: 'mil',
      angleType: 'high',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [
        { name: 'MO-SHORT', velocity: 110, moa: 50, minDistance: 0, explosionRadius: [2, 60] },
        { name: 'MO-MEDIUM', velocity: 143.5, moa: 50, minDistance: 0, explosionRadius: [2, 60] },
        { name: 'MO-LONG', velocity: 171.5, moa: 50, minDistance: 0, explosionRadius: [2, 60] },
      ],
    },
    m109: {
      displayName: 'M109',
      category: 'modded',
      source: 'Steel Division',
      gravityScale: 2,
      heightOffset: 3,
      angleOffset: 0,
      minElevation: [-45, 135],
      unit: 'deg',
      angleType: 'low',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 225, moa: 1.5, minDistance: 0, explosionRadius: [40, 75] }],
    },
    m777: {
      displayName: 'M777',
      category: 'modded',
      source: 'Steel Division',
      gravityScale: 2,
      heightOffset: 4,
      angleOffset: 0,
      minElevation: [15, 80],
      unit: 'deg',
      angleType: 'low',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 200, moa: 1.5, minDistance: 700, explosionRadius: [40, 75] }],
    },
    't62-dump-truck': {
      displayName: 'T62 Dump Truck',
      category: 'modded',
      source: 'Steel Division',
      gravityScale: 2,
      heightOffset: 3,
      angleOffset: 0,
      minElevation: [-45, 135],
      unit: 'deg',
      angleType: 'low',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 210, moa: 100, minDistance: 0, explosionRadius: [20, 40] }],
    },
    himars: {
      displayName: 'HIMARS',
      category: 'modded',
      source: 'Steel Division',
      gravityScale: 2,
      heightOffset: 3,
      angleOffset: 0,
      minElevation: [-3, 84.7],
      unit: 'deg',
      angleType: 'low',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 250, moa: 15, minDistance: 0, explosionRadius: [1.5, 50] }],
    },
    'tos-1a': {
      displayName: 'TOS-1A',
      category: 'modded',
      source: 'Steel Division',
      gravityScale: 1,
      heightOffset: 3,
      angleOffset: 0,
      minElevation: [0, 80],
      unit: 'deg',
      angleType: 'low',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 100, moa: 200, minDistance: 0, explosionRadius: [15, 25] }],
    },
    'ural-hellcannon': {
      displayName: 'Ural-HellCannon',
      category: 'modded',
      source: 'Steel Division',
      gravityScale: 2,
      heightOffset: 3,
      angleOffset: 0,
      minElevation: [10, 85],
      unit: 'deg',
      angleType: 'high',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 180, moa: 300, minDistance: 0, explosionRadius: [1, 75] }],
    },
    'mtlb-fab500': {
      displayName: 'MTLB FAB500',
      category: 'modded',
      source: 'Squad AdminTools',
      gravityScale: 1,
      heightOffset: 3,
      angleOffset: 0,
      minElevation: [-45, 85.3],
      unit: 'deg',
      angleType: 'low',
      deceleration: 0,
      decelerationTime: 0,
      projectileLifespan: 100,
      shells: [{ name: 'default', velocity: 95, moa: 150, minDistance: 75, explosionRadius: [0.1, 50] }],
    },
  };

  (function initializeWeaponDerivedData() {
    for (const weaponId of WEAPON_IDS) {
      const weapon = WEAPONS[weaponId];
      weapon._shellDerived = weapon.shells.map((shell) => {
        const finalVelocity = shell.velocity - weapon.deceleration * weapon.decelerationTime;
        const decelerationDistance = shell.velocity * weapon.decelerationTime -
          0.5 * weapon.deceleration * weapon.decelerationTime * weapon.decelerationTime;
        const maxDistanceM = decelerationDistance === 0
          ? (shell.velocity * shell.velocity) / (GRAVITY * weapon.gravityScale)
          : ((shell.velocity - finalVelocity) * weapon.decelerationTime) +
            ((finalVelocity * finalVelocity) / (GRAVITY * weapon.gravityScale));
        return { decelerationDistance, maxDistanceM };
      });
    }
  }());

  const STRATEGY_GUIDES = Array.isArray(window.STRATEGY_GUIDES) ? window.STRATEGY_GUIDES : [];

  // Faction display names & flag lookup
  const FACTION_NAMES = {
    ADF: 'Australian Defence Force', AFU: 'Armed Forces of Ukraine',
    BAF: 'British Armed Forces', CAF: 'Canadian Armed Forces',
    CRF: 'Canadian Resistance Forces', GFI: 'Ground Force of Iran',
    IMF: 'Insurgent Militia Forces', MEI: 'Middle Eastern Insurgents',
    PLA: "People's Liberation Army", PLAAGF: 'PLA Airborne',
    PLANMC: 'PLA Naval Marines', RGF: 'Russian Ground Forces',
    TLF: 'Turkish Land Forces', USA: 'US Army',
    USMC: 'US Marine Corps', VDV: 'Russian VDV', WPMC: 'Wagner PMC'
  };

  // Pretty gamemode names
  const GAMEMODE_LABELS = {
    AAS: 'AAS', RAAS: 'RAAS', Invasion: 'Invasion',
    Destruction: 'Destruction', Insurgency: 'Insurgency',
    Skirmish: 'Skirmish', Seed: 'Seed', 'Territory Control': 'TC',
    Fireteam: 'Fireteam', Training: 'Training'
  };

  const GAMEMODE_COLORS = {
    AAS: '#6b8e23', RAAS: '#8b7355', Invasion: '#cd853f',
    Destruction: '#a0522d', Insurgency: '#8b8b3e',
    Skirmish: '#556b2f', Seed: '#808070', 'Territory Control': '#d2aa50',
    Fireteam: '#9b7653', Training: '#a0a090'
  };

  const DOCTRINE_KEYS = ['AirAssault', 'Motorized', 'CombinedArms', 'Armored', 'Mechanized', 'LightInfantry', 'Support'];

  // Heatmap colors for capture-step badges (1-indexed). Matches the v9 RAAS
  // overlay: captured = green, then cyan→blue→red→orange→purple→pink as the
  // step number grows. Anything past step 7 falls back to grey.
  const STEP_COLORS = [
    null,         // 0 unused
    '#5cb85c',    // 1 captured / first
    '#3cc8c8',    // 2 cyan
    '#3b87d8',    // 3 blue
    '#d8483b',    // 4 red
    '#e08025',    // 5 orange
    '#a050c8',    // 6 purple
    '#d850a8',    // 7 pink
    '#9aa0a6'     // 8+ grey fallback
  ];

  function getStepColor(step) {
    if (!Number.isFinite(step) || step < 1) return STEP_COLORS[STEP_COLORS.length - 1];
    return STEP_COLORS[Math.min(step, STEP_COLORS.length - 1)];
  }

  const ARCHETYPE_LABELS = {
    AirAssault: 'Air Assault',
    Motorized: 'Motorized',
    CombinedArms: 'Combined Arms',
    Armored: 'Armored',
    Mechanized: 'Mechanized',
    LightInfantry: 'Light Infantry',
    Support: 'Support'
  };

  const MAP_TRAIT_HINTS = {
    desert: new Set(['AlBasrah', 'Chora', 'Fallujah', 'Kamdesh', 'Kohat', 'Kokan', 'Lashkar', 'Logar', 'Mutaha', 'Sumari', 'Tallil']),
    forest: new Set(['Belaya', 'BlackCoast', 'FoolsRoad', 'GooseBay', 'Gorodok', 'Harju', 'Manicouagan', 'Mestia', 'Narva', 'Sanxian', 'Skorpo', 'Yehorivka']),
    urban: new Set(['AlBasrah', 'Chora', 'Fallujah', 'Kokan', 'Logar', 'Mutaha', 'Narva', 'Sumari']),
    mountain: new Set(['Anvil', 'Belaya', 'BlackCoast', 'FoolsRoad', 'GooseBay', 'Kamdesh', 'Kohat', 'Mestia', 'Skorpo']),
    snow: new Set(['Belaya', 'GooseBay', 'Manicouagan']),
    wetland: new Set(['BlackCoast', 'GooseBay', 'Harju', 'Manicouagan', 'Sanxian']),
    open: new Set(['Anvil', 'GooseBay', 'Gorodok', 'Kohat', 'Lashkar', 'Tallil', 'Yehorivka'])
  };

  // ---- Bootstrap ----
  async function init() {
    // Data is loaded via <script> tags as window.SQUAD_DATA and window.SQUAD_TRANSLATIONS
    // This works on both file:// and http:// protocols
    if (!window.SQUAD_DATA || !window.SQUAD_DATA.W) {
      document.getElementById('map-grid').innerHTML =
        '<div style="padding:40px;color:#fc8181;font-size:16px">Error: Failed to load map data. ' +
        'Make sure data/v10_data.js exists.</div>';
      return;
    }
    const data = window.SQUAD_DATA;
    translations = window.SQUAD_TRANSLATIONS || {};
    allLayers = data.W;

    // Group layers by mapId
    mapGroups = {};
    for (const l of allLayers) {
      (mapGroups[l.mapId] = mapGroups[l.mapId] || []).push(l);
    }
    // Sort layers within each map by gamemode then version
    for (const id of Object.keys(mapGroups)) {
      mapGroups[id].sort((a, b) => a.Name.localeCompare(b.Name));
    }

    renderGrid();
    bindEvents();
    handleHash();
  }

  // ---- Translation helper ----
  function t(key) {
    const lang = translations[currentLang] || translations.en || {};
    return lang[key] || key;
  }

  // ---- Grid View ----
  function renderGrid(filter) {
    const grid = document.getElementById('map-grid');
    grid.innerHTML = '';

    const mapIds = Object.keys(mapGroups).sort();
    for (const mapId of mapIds) {
      const layers = mapGroups[mapId];
      const first = layers[0];

      // Apply search filter
      if (filter) {
        const q = filter.toLowerCase();
        const match = first.mapName.toLowerCase().includes(q) ||
          mapId.toLowerCase().includes(q) ||
          layers.some(l => l.Name.toLowerCase().includes(q));
        if (!match) continue;
      }

      const card = document.createElement('div');
      card.className = 'map-card';
      card.dataset.mapId = mapId;

      const thumbSrc = `assets/thumbnails/${first.minimapTexture}.webp`;

      // Count gamemodes
      const modes = [...new Set(layers.map(l => l.gamemode))];

      card.innerHTML = `
        <img class="map-card-img" src="${thumbSrc}" alt="${first.mapName}" loading="lazy"
             onerror="this.src='assets/maps/single/${first.minimapTexture}.webp'">
        <div class="map-card-body">
          <div class="map-card-title">${escapeHtml(first.mapName)}</div>
          <div class="map-card-meta">
            <span>${layers.length} layers</span>
            <span>${modes.map(m => GAMEMODE_LABELS[m] || m).join(', ')}</span>
          </div>
        </div>`;

      card.addEventListener('click', () => openMap(mapId));
      grid.appendChild(card);
    }
  }

  // ---- Open Map ----
  function openMap(mapId, layerRaw) {
    const layers = mapGroups[mapId];
    if (!layers || !layers.length) return;
    const mv = document.getElementById('map-view');
    // "Fresh entry" = arriving at this map for the first time (from grid,
    // deep link, or switching maps). Within-map navigation (e.g. picking a
    // layer, which writes to the hash and re-enters openMap) must NOT
    // reopen the sidebar — the click handler closes it intentionally.
    const isFreshEntry = currentMapId !== mapId || mv.classList.contains('hidden');
    currentMapId = mapId;

    // Find layer by raw name or use first
    let idx = 0;
    if (layerRaw) {
      const found = layers.findIndex(l => l.rawName === layerRaw);
      if (found >= 0) idx = found;
    }

    document.getElementById('map-grid').classList.add('hidden');
    mv.classList.remove('hidden');
    if (isFreshEntry) setLeftSidebarOpen(true);

    renderLayerList(layers, idx);
    selectLayer(layers, idx);

    window.location.hash = `#/${mapId}/${layers[idx].rawName}`;
  }

  // ---- Layer List (left sidebar) ----
  function renderLayerList(layers, activeIdx) {
    const list = document.getElementById('layer-list');
    list.innerHTML = '';
    layers.forEach((l, i) => {
      const item = document.createElement('div');
      item.className = 'layer-item' + (i === activeIdx ? ' active' : '');
      const gm = GAMEMODE_LABELS[l.gamemode] || l.gamemode;
      const clColor = GAMEMODE_COLORS[l.gamemode] || '#a0aec0';
      item.innerHTML = `
        <span>${escapeHtml(l.Name)}</span>
        <span class="gamemode-tag" style="background:${clColor}22;color:${clColor}">${gm}</span>`;
      item.addEventListener('click', () => {
        selectLayer(layers, i);
        window.location.hash = `#/${currentMapId}/${l.rawName}`;
        setLeftSidebarOpen(false);
        // Update active class
        list.querySelectorAll('.layer-item').forEach((el, j) => {
          el.classList.toggle('active', j === i);
        });
      });
      list.appendChild(item);
    });
  }

  // ---- Select Layer ----
  function selectLayer(layers, idx) {
    currentLayerIndex = idx;
    const layer = layers[idx];
    activeLane = null;
    captureSequence = [];
    activeTeam = null;
    activeDestructionPhase = null;
    capturedSubPoints = {};
    stagingFocus = null;
    initializeTeamSelections(layer);

    // Update header info
    document.getElementById('layer-name').textContent = layer.Name;
    const meta = document.getElementById('layer-meta');
    const gm = GAMEMODE_LABELS[layer.gamemode] || layer.gamemode;
    meta.innerHTML = `
      <span class="meta-tag">${gm}</span>
      <span class="meta-tag">${layer.mapSize || ''}</span>`;

    // Top panel: team info
    renderTopPanel(layer);

    // Map
    renderMap(layer);

    // Layer details
    renderDetails(layer);
  }

  // ---- Top Panel ----
  function renderTopPanel(layer) {
    const tc = layer.teamConfigs || {};
    const t1 = tc.team1 || {};
    const t2 = tc.team2 || {};

    const team1Option = getSelectedTeamOption(layer, 'team1');
    const team2Option = getSelectedTeamOption(layer, 'team2');
    const team1FactionId = team1Option?.factionID || extractFactionId(t1.defaultFactionUnit);
    const team2FactionId = team2Option?.factionID || extractFactionId(t2.defaultFactionUnit);
    const team1Options = getTeamOptions(layer, 'team1');
    const team2Options = getTeamOptions(layer, 'team2');

    document.getElementById('team1-panel').innerHTML = `
      <div class="team-header">
        <img class="team-flag" src="assets/flags/flag_${team1FactionId}.png" alt="${team1FactionId}"
             onerror="this.style.display='none'">
        <div class="team-panel-body">
          ${renderTeamSelector('team1', team1FactionId, team1Options)}
          <div class="team-subtitle">${formatUnitTypes(team1Option?.types || [])}</div>
        </div>
      </div>
      <div class="team-tickets">${t1.tickets || '?'} tickets</div>`;

    document.getElementById('team2-panel').innerHTML = `
      <div class="team-header">
        <img class="team-flag" src="assets/flags/flag_${team2FactionId}.png" alt="${team2FactionId}"
             onerror="this.style.display='none'">
        <div class="team-panel-body">
          ${renderTeamSelector('team2', team2FactionId, team2Options)}
          <div class="team-subtitle">${formatUnitTypes(team2Option?.types || [])}</div>
        </div>
      </div>
      <div class="team-tickets">${t2.tickets || '?'} tickets</div>`;

    const gm = GAMEMODE_LABELS[layer.gamemode] || layer.gamemode;
    const laneNames = getLaneNames(layer);
    let laneHtml = '';
    if (laneNames.length > 0) {
      const captureSteps = getCaptureSteps();
      const captureCount = captureSteps.length;
      let remainingLaneNames = laneNames;
      let isFreeMode = false;
      if (activeTeam) {
        const visibleLanes = getVisibleProgressionLanes(layer, activeTeam);
        if (visibleLanes) {
          remainingLaneNames = laneNames.filter((name) => name in visibleLanes);
          if (captureCount > 0 && remainingLaneNames.length === 0) {
            isFreeMode = true;
          }
        }
      }
      const remainingSet = new Set(remainingLaneNames);

      const showReset = activeTeam && (captureSequence.length > 0 || activeLane || stagingFocus);
      laneHtml = `<div class="lane-controls">
        <div class="lane-buttons">
          <button class="lane-btn${!activeLane ? ' active' : ''}" data-lane="">All</button>
          ${laneNames.map(name => {
            const isPossible = !activeTeam || isFreeMode || remainingSet.has(name) || activeLane === name;
            const cls = activeLane === name ? ' active' : (isPossible ? '' : ' disabled');
            return `<button class="lane-btn${cls}" data-lane="${name}"${isPossible ? '' : ' disabled'}>${name}</button>`;
          }).join('')}
          ${showReset ? `<button class="lane-btn lane-reset" id="capture-reset-btn" title="Reset captures">&#x21bb;</button>` : ''}
        </div>
        ${activeTeam ? `<div class="lane-status${isFreeMode ? ' free-mode' : ''}">
          ${activeLane
            ? `Lane: <strong>${activeLane}</strong>`
            : (captureCount === 0
                ? (stagingFocus
                  ? `Staging on <strong>${escapeHtml(getStagingFocusLabel(layer))}</strong> · ${remainingLaneNames.length} lane${remainingLaneNames.length === 1 ? '' : 's'} consistent`
                    : `<em>Click a likely objective to stage intent, then click it again when the live first cap confirms</em>`)
                : isFreeMode
                  ? `<strong>Free mode</strong> · ${captureCount} captured · path doesn't match known lanes`
                  : `${captureCount} captured · ${remainingLaneNames.length} lane${remainingLaneNames.length === 1 ? '' : 's'} possible`)}
        </div>` : ''}
      </div>`;
    }

    // Destruction phase controls
    let phaseHtml = '';
    const cp = layer.capturePoints || {};
    if (cp.type === 'Destruction') {
      const dest = cp.destructionObject || {};
      const phases = dest.phases || [];
      if (phases.length > 0) {
        phaseHtml = `<div class="lane-controls">
          <div class="lane-buttons">
            <button class="phase-btn${activeDestructionPhase === null ? ' active' : ''}" data-phase="">All</button>
            ${phases.map(p => `<button class="phase-btn${activeDestructionPhase === p.PhaseNumber ? ' active' : ''}" data-phase="${p.PhaseNumber}">Phase ${p.PhaseNumber + 1}</button>`).join('')}
          </div>
          <div class="destruction-info">
            <span class="destruction-detail">${dest.attackingTeam === 'Team One' ? 'T1' : 'T2'} attacks</span>
            <span class="destruction-detail">${(dest.roundTimerIncrease / 60).toFixed(0)}min/phase</span>
            <span class="destruction-detail">${(dest.delayBetweenPhases / 60).toFixed(0)}min delay</span>
          </div>
        </div>`;
      }
    }

    // TC hex info — match by gamemode rather than cp.type so we tolerate
    // the older "TC Hex Zone" extraction string and the newer "TerritoryControl".
    let tcHtml = '';
    if (layer.gamemode === 'Territory Control') {
      const hexsData = cp.hexs || {};
      const hexList = hexsData.hexs || [];
      const t1Hexs = hexList.filter(h => h.initialTeam === '1').length;
      const t2Hexs = hexList.filter(h => h.initialTeam === '2').length;
      const neutral = hexList.length - t1Hexs - t2Hexs;
      tcHtml = `<div class="tc-info">
        <span class="tc-detail tc-t1">${t1Hexs}</span>
        <span class="tc-detail tc-neutral">${neutral}</span>
        <span class="tc-detail tc-t2">${t2Hexs}</span>
        <span class="tc-detail">${hexList.length} hexs</span>
      </div>`;
    }

    // Team toggle for perspective
    const t1Active = activeTeam === 'team1' ? ' team-active' : '';
    const t2Active = activeTeam === 'team2' ? ' team-active' : '';
    const t1Panel = document.getElementById('team1-panel');
    const t2Panel = document.getElementById('team2-panel');
    t1Panel.classList.toggle('team-active', activeTeam === 'team1');
    t2Panel.classList.toggle('team-active', activeTeam === 'team2');

    const miEl = document.getElementById('match-info');
    const hasLanes = laneHtml.length > 0;
    const toggleHtml = hasLanes
      ? `<button class="match-info-toggle" id="match-info-toggle" title="Collapse / expand" aria-label="Toggle lane panel">&#9662;</button>`
      : '';
    miEl.innerHTML = `
      ${toggleHtml}
      <div class="gamemode-label">${gm}</div>
      <div class="map-size">${layer.mapSize || ''}</div>
      ${laneHtml}${phaseHtml}${tcHtml}`;
    miEl.classList.toggle('collapsed', hasLanes && matchInfoCollapsed);
    if (hasLanes) {
      const toggleBtn = document.getElementById('match-info-toggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          matchInfoCollapsed = !matchInfoCollapsed;
          miEl.classList.toggle('collapsed', matchInfoCollapsed);
        });
      }
    }

    bindTeamPanelEvents(layer);
    bindLaneEvents(layer);
    bindPhaseEvents(layer);
    renderStrategyDrawer(layer);
  }

  function extractFactionId(unitName) {
    if (!unitName) return '';
    // e.g. "USMC_LO_CombinedArms" -> "USMC"
    // Handle multi-segment faction IDs like PLAAGF, PLANMC
    const knownIds = ['PLAAGF', 'PLANMC', 'USMC', 'WPMC', 'ADF', 'AFU', 'BAF', 'CAF', 'CRF', 'GFI', 'IMF', 'MEI', 'PLA', 'RGF', 'TLF', 'USA', 'VDV'];
    for (const id of knownIds) {
      if (unitName.startsWith(id + '_')) return id;
    }
    return unitName.split('_')[0];
  }

  function getTeamOptions(layer, teamKey) {
    const factions = (layer.teamConfigs || {}).factions || {};
    return Array.isArray(factions[`${teamKey}Units`]) ? factions[`${teamKey}Units`] : [];
  }

  function initializeTeamSelections(layer) {
    ['team1', 'team2'].forEach((teamKey) => {
      const options = getTeamOptions(layer, teamKey);
      const defaultFactionId = extractFactionId(((layer.teamConfigs || {})[teamKey] || {}).defaultFactionUnit);
      const preferred = options.find((option) => option.factionID === defaultFactionId) || options[0] || null;
      selectedFactionIds[teamKey] = preferred ? preferred.factionID : defaultFactionId;
    });
  }

  function getSelectedTeamOption(layer, teamKey) {
    const options = getTeamOptions(layer, teamKey);
    return options.find((option) => option.factionID === selectedFactionIds[teamKey]) || options[0] || null;
  }

  function renderTeamSelector(teamKey, factionId, options) {
    if (!options.length) {
      return `<div class="team-name">${FACTION_NAMES[factionId] || factionId}</div>`;
    }

    const optionMarkup = options.map((option) => {
      const selected = option.factionID === factionId ? ' selected' : '';
      return `<option value="${option.factionID}"${selected}>${escapeHtml(FACTION_NAMES[option.factionID] || option.factionID)}</option>`;
    }).join('');

    return `<select class="team-select" data-team="${teamKey}" aria-label="${teamKey} faction selector">${optionMarkup}</select>`;
  }

  function bindTeamPanelEvents(layer) {
    // Faction dropdown: changes the team's faction only. Does NOT activate
    // the team perspective — that happens exclusively via clicking the Main
    // capture point on the map.
    document.querySelectorAll('.team-select').forEach((select) => {
      select.onchange = (event) => {
        const teamKey = event.target.dataset.team;
        selectedFactionIds[teamKey] = event.target.value;
        renderTopPanel(layer);
        renderDetails(layer);
        redrawMarkers(layer);
      };
    });
  }

  function setActiveTeam(teamKey, layer, options = {}) {
    const { allowToggleOff = false, renderDetailsToo = false } = options;
    const nextTeam = allowToggleOff && activeTeam === teamKey ? null : teamKey;
    const changedTeam = activeTeam !== nextTeam;

    activeTeam = nextTeam;
    if (changedTeam) {
      captureSequence = [];
      capturedSubPoints = {};
      activeLane = null;
      stagingFocus = null;
    }

    renderTopPanel(layer);
    if (renderDetailsToo) {
      renderDetails(layer);
    }
    redrawMarkers(layer);
  }

  function bindLaneEvents(layer) {
    document.querySelectorAll('.lane-btn').forEach((btn) => {
      if (btn.disabled || btn.id === 'capture-reset-btn') return;
      btn.addEventListener('click', () => {
        const lane = btn.dataset.lane;
        activeLane = lane || null;
        // Auto-select team1 when choosing a lane if no team is active
        if (activeLane && !activeTeam) {
          activeTeam = 'team1';
        }
        renderTopPanel(layer);
        redrawMarkers(layer);
      });
    });

    const resetBtn = document.getElementById('capture-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        captureSequence = [];
        capturedSubPoints = {};
        activeLane = null;
        stagingFocus = null;
        renderTopPanel(layer);
        redrawMarkers(layer);
      });
    }
  }

  function bindPhaseEvents(layer) {
    document.querySelectorAll('.phase-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.phase;
        activeDestructionPhase = val === '' ? null : parseInt(val, 10);
        renderTopPanel(layer);
        redrawMarkers(layer);
      });
    });
  }

  function redrawMarkers(layer) {
    if (!markerGroup) return;
    resetLaneLineAnimations();
    markerGroup.clearLayers();
    drawBorder(layer);
    drawTCHexZones(layer);
    drawDestructionPhases(layer);
    drawInsurgencyCaches(layer);
    drawObjectives(layer);
  }

  function formatUnitTypes(types) {
    if (!types.length) return 'No unit types listed';
    return types.map((type) => formatUnitType(type.unitType)).join(', ');
  }

  function formatUnitType(unitType) {
    return String(unitType || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .trim();
  }

  function getDoctrineSet(selectedOption) {
    const doctrines = new Set();
    const addDoctrine = (value) => {
      const source = String(value || '');
      for (const key of DOCTRINE_KEYS) {
        if (source.includes(key)) doctrines.add(key);
      }
    };

    addDoctrine(selectedOption?.defaultUnit);
    (selectedOption?.types || []).forEach((type) => addDoctrine(type.unitType || type.unit));
    return doctrines;
  }

  function getObjectiveOrderNames(layer) {
    const capturePoints = layer.capturePoints || {};
    if (Array.isArray(capturePoints.points?.pointsOrder)) return capturePoints.points.pointsOrder;
    if (Array.isArray(capturePoints.clusters?.pointsOrder)) return capturePoints.clusters.pointsOrder;
    return Object.keys(layer.objectives || {});
  }

  function normalizeObjectiveToken(value) {
    const raw = String(value || '').toLowerCase();
    // Mains: detect by name regardless of leading index, collapse to a
    // canonical token. Handles "00-Team1Main", "100-Team2 Main",
    // "Z-Team2 Main", "Team2Main_1", etc.
    if (/team\s*1[^a-z0-9]*main/.test(raw)) return 'team1main';
    if (/team\s*2[^a-z0-9]*main/.test(raw) || /^z[-\s_]*team\s*2/.test(raw)) return 'team2main';
    // Some maps name mains by faction instead of by team number. Mestia
    // RAAS v1 ships "00-USAMain" / "100-MILMain" — the leading 00- and 100-
    // index prefixes are reserved for the two main bases, so trust them.
    if (/^0+-[a-z0-9]*main\b/.test(raw)) return 'team1main';
    if (/^100+-[a-z0-9]*main\b/.test(raw)) return 'team2main';
    // Clusters: strip BP_ prefix and the CaptureZoneCluster suffix, then
    // collapse to alnum. KEEP the leading index — `01-CaptureZoneCluster`
    // and `02-CaptureZoneCluster` must produce distinct tokens (used to
    // both collapse to "" which broke Invasion lane parsing).
    let s = raw
      .replace(/bp_/g, '')
      .replace(/capturezonecluster/g, '')
      .replace(/[^a-z0-9]/g, '');
    return s;
  }

  function isGridObjectiveLabel(value) {
    return /^[A-Z]\d{1,2}$/i.test(String(value || '').trim());
  }

  function getObjectiveDisplayName(key, objective, orderName) {
    // Check for human-readable names in the points array (RAAS capture zone clusters)
    const points = Array.isArray(objective.points) ? objective.points : [];
    const pointNames = points
      .map(p => p.name)
      .filter(n => n && !/capturezonecluster/i.test(n));

    const cleanObjectiveLabel = (value) => String(value || '')
      .replace(/^\d+-/, '')
      .replace(/-?(BP_)?CaptureZoneCluster$/i, '')
      .replace(/_/g, ' ')
      .trim();

    const normalizedKey = normalizeObjectiveToken(key);
    if (normalizedKey === 'team1main') return 'Team 1 Main';
    if (normalizedKey === 'team2main') return 'Team 2 Main';

    // Use first unique point name as display (short label for map markers)
    if (pointNames.length > 0) {
      const unique = [...new Set(pointNames)];
      return unique[0];
    }

    const candidates = [objective.name, objective.objectDisplayName, orderName, key]
      .map(cleanObjectiveLabel)
      .filter(Boolean);
    const cleaned = candidates.find(label => !isGridObjectiveLabel(label)) || candidates[0] || 'Objective';

    if (/team\s*1\s*main|team1main/i.test(cleaned)) return 'Team 1 Main';
    if (/team\s*2\s*main|team2main|z-team2\s*main/i.test(cleaned)) return 'Team 2 Main';
    return cleaned || 'Objective';
  }

  // Returns all unique point names for popup detail
  function getObjectiveAllNames(objective) {
    const points = Array.isArray(objective.points) ? objective.points : [];
    const names = points
      .map(p => p.name)
      .filter(n => n && !/capturezonecluster/i.test(n));
    return [...new Set(names)];
  }

  function shouldShowPermanentObjectiveLabel(label) {
    return Boolean(label) && !isGridObjectiveLabel(label);
  }

  function getObjectivePosition(objective) {
    if (Number.isFinite(objective.location_x) && Number.isFinite(objective.location_y)) {
      return { x: objective.location_x, y: objective.location_y };
    }

    // RAAS clusters store position in avgLocation
    const avg = objective.avgLocation;
    if (avg && Number.isFinite(avg.location_x) && Number.isFinite(avg.location_y)) {
      return { x: avg.location_x, y: avg.location_y };
    }

    // Check objects array (AAS-style objectives)
    const objects = Array.isArray(objective.objects) ? objective.objects : [];
    let positioned = objects.filter((obj) => Number.isFinite(obj.location_x) && Number.isFinite(obj.location_y));

    // Check points array (RAAS-style capture zone clusters)
    if (!positioned.length) {
      const points = Array.isArray(objective.points) ? objective.points : [];
      positioned = points.filter((pt) => Number.isFinite(pt.location_x) && Number.isFinite(pt.location_y));
    }

    if (!positioned.length) return null;

    const total = positioned.reduce((acc, obj) => {
      acc.x += obj.location_x;
      acc.y += obj.location_y;
      return acc;
    }, { x: 0, y: 0 });

    return {
      x: total.x / positioned.length,
      y: total.y / positioned.length
    };
  }

  // ---- RAAS Lane Helpers ----
  function getLanes(layer) {
    const cp = layer.capturePoints || {};
    const explicit = (cp.lanes || {}).laneObjects || {};
    if (Object.keys(explicit).length > 0) return explicit;
    if (layer.gamemode === 'Invasion') return getInvasionLanes(layer);
    return {};
  }

  function getLaneNames(layer) {
    const cp = layer.capturePoints || {};
    const explicit = (cp.lanes || {}).listOfLanes || [];
    if (explicit.length > 0) return explicit;
    if (layer.gamemode === 'Invasion') return Object.keys(getInvasionLanes(layer));
    return [];
  }

  // Invasion's legacy baseline encodes its lane structure as a flat
  // clusters.pointsOrder: [team1main, A1..A5, team1main, B1..B5, ..., team2main].
  // Repeated team1main entries delimit lanes; team2main appears once at the
  // end (every lane shares it). Single-lane Invasions (Anvil etc.) have just
  // one team1main, no letter-prefix on the clusters. Returns a lanes map in
  // the same shape as RAAS getLanes() so the existing renderer handles it.
  function getInvasionLanes(layer) {
    if (layer.gamemode !== 'Invasion') return {};
    const cp = layer.capturePoints || {};
    const flat = (cp.clusters || {}).pointsOrder
              || (cp.points || {}).pointsOrder
              || [];
    if (!Array.isArray(flat) || flat.length === 0) return {};

    const isTeam1 = (n) => /team\s*1.*main/i.test(n);
    const isTeam2 = (n) => /team\s*2.*main|^z-?team2/i.test(n);

    const segments = [];
    let current = null;
    let team2Token = null;
    for (const item of flat) {
      if (isTeam2(item)) {
        team2Token = item;
        if (current && current.length > 0) {
          segments.push(current);
          current = null;
        }
        continue;
      }
      if (isTeam1(item)) {
        if (current && current.length > 0) segments.push(current);
        current = [item];
        continue;
      }
      if (current) current.push(item);
    }
    if (current && current.length > 0) segments.push(current);

    if (segments.length === 0) return {};

    const lanes = {};
    const usedNames = new Set();
    segments.forEach((seg, idx) => {
      const firstCluster = seg.find((s) => !isTeam1(s));
      const letterMatch = firstCluster && firstCluster.match(/^([A-Z])\d/i);
      let name = letterMatch ? letterMatch[1].toUpperCase() : `Lane ${idx + 1}`;
      // Disambiguate if two segments collide on the same letter
      let suffix = 2;
      const base = name;
      while (usedNames.has(name)) name = `${base}_${suffix++}`;
      usedNames.add(name);

      const pointsOrder = [...seg];
      if (team2Token) pointsOrder.push(team2Token);

      lanes[name] = {
        name,
        pointsOrder,
        numberOfPoints: pointsOrder.length,
        listOfMains: [seg[0], team2Token].filter(Boolean),
      };
    });

    return lanes;
  }

  function getLaneObjectiveKeys(lane) {
    // lane.pointsOrder has names like '00-Team1 Main', 'A1-CaptureZoneCluster'
    // We need to match these to objective keys by normalizing
    return (lane.pointsOrder || []).map(name => normalizeObjectiveToken(name));
  }

  // Get a lane's capture-order tokens for a given team's perspective.
  // team1 captures forwards (start → end); team2 captures backwards (end → start).
  // Returned array excludes main bases — only the contestable points.
  function getLaneCaptureOrder(lane, team) {
    const order = (lane.pointsOrder || []).map(n => normalizeObjectiveToken(n));
    const directional = team === 'team2' ? [...order].reverse() : order;
    return directional.filter(t => !/team[12]main/.test(t));
  }

  function getCaptureStepKey(token) {
    const selected = capturedSubPoints[token];
    if (selected && Number.isFinite(selected.x) && Number.isFinite(selected.y)) {
      return `pos:${Math.round(selected.x / 50)}:${Math.round(selected.y / 50)}`;
    }
    return `token:${token}`;
  }

  function getCaptureSteps(sequence = captureSequence) {
    const steps = [];
    for (const token of sequence) {
      const key = getCaptureStepKey(token);
      const last = steps[steps.length - 1];
      if (last && last.key === key) {
        last.tokens.push(token);
        last.tokenSet.add(token);
      } else {
        steps.push({ key, tokens: [token], tokenSet: new Set([token]) });
      }
    }
    return steps;
  }

  // Filter lanes to those whose capture order starts with the given sequence.
  // sequence is an array of normalized tokens already captured (in order).
  function getRemainingLanes(layer, sequence, team) {
    const lanes = getLanes(layer);
    const steps = getCaptureSteps(sequence);
    const remaining = {};
    for (const [name, lane] of Object.entries(lanes)) {
      const order = getLaneCaptureOrder(lane, team);
      if (order.length < steps.length) continue;
      let matches = true;
      for (let i = 0; i < steps.length; i++) {
        if (!steps[i].tokenSet.has(order[i])) { matches = false; break; }
      }
      if (matches) remaining[name] = lane;
    }
    return remaining;
  }

  function getLanePointsUnionFromSet(lanes, team) {
    const union = new Set();
    for (const lane of Object.values(lanes)) {
      for (const token of getLaneCaptureOrder(lane, team)) {
        union.add(token);
      }
    }
    return union;
  }

  function getNextCaptureOptionsFromSet(lanes, sequence, team) {
    const steps = getCaptureSteps(sequence);
    const options = new Set();
    for (const lane of Object.values(lanes)) {
      const order = getLaneCaptureOrder(lane, team);
      const next = order[steps.length];
      if (next) options.add(next);
    }
    return options;
  }

  function getLookaheadStepsFromSet(lanes, sequence, team) {
    const stepByToken = new Map();
    const steps = getCaptureSteps(sequence);
    steps.forEach((step, i) => {
      for (const token of step.tokens) stepByToken.set(token, i + 1);
    });
    for (const lane of Object.values(lanes)) {
      const order = getLaneCaptureOrder(lane, team);
      for (let i = steps.length; i < order.length; i++) {
        const tok = order[i];
        const step = i + 1;
        const existing = stepByToken.get(tok);
        if (existing == null || step < existing) stepByToken.set(tok, step);
      }
    }
    return stepByToken;
  }

  // Compute the next set of capturable point tokens across all remaining lanes.
  // Returns a Set of normalized tokens.
  function getNextCaptureOptions(layer, sequence, team) {
    const remaining = getRemainingLanes(layer, sequence, team);
    return getNextCaptureOptionsFromSet(remaining, sequence, team);
  }

  // Find all cluster tokens that have a sub-point at the given coordinates.
  // Used to alias shared physical points across multiple cluster IDs (e.g.
  // C2 and D2 both have "Cannabis Farm" at the same position).
  function findClustersAtPosition(layer, x, y, tolerance = 300) {
    const objectives = layer.objectives || {};
    const tol2 = tolerance * tolerance;
    const tokens = new Set();
    for (const [key, obj] of Object.entries(objectives)) {
      const t = normalizeObjectiveToken(key);
      if (/team[12]main/.test(t)) continue;
      const points = Array.isArray(obj.points) ? obj.points : [];
      for (const p of points) {
        if (!Number.isFinite(p.location_x) || !Number.isFinite(p.location_y)) continue;
        const dx = p.location_x - x;
        const dy = p.location_y - y;
        if (dx * dx + dy * dy <= tol2) {
          tokens.add(t);
          break;
        }
      }
      // Also fall back to cluster centroid match
      if (Number.isFinite(obj.location_x) && Number.isFinite(obj.location_y)) {
        const dx = obj.location_x - x;
        const dy = obj.location_y - y;
        if (dx * dx + dy * dy <= tol2) tokens.add(t);
      }
    }
    return tokens;
  }

  // Collect every unique sub-point name across all clusters whose sub-point
  // shares this physical position. Squad's data sometimes labels the same
  // physical capture point differently in different clusters (e.g. Al Basrah
  // RAAS_v1: A6/B5 call (-6659, 87366) "Abul Khasib West" while C6 calls it
  // "Abul Khasib"). Marker dedup picks the first one and the others vanish
  // from the map; this helper gives the renderer all the names so the
  // surviving marker can show them combined.
  function getSubPointNamesAtPosition(layer, x, y, tolerance = 300) {
    const objectives = layer.objectives || {};
    const tol2 = tolerance * tolerance;
    const names = [];
    const seen = new Set();
    for (const [key, obj] of Object.entries(objectives)) {
      if (/team[12]main/.test(normalizeObjectiveToken(key))) continue;
      const points = Array.isArray(obj.points) ? obj.points : [];
      for (const p of points) {
        if (!Number.isFinite(p.location_x) || !Number.isFinite(p.location_y)) continue;
        const dx = p.location_x - x;
        const dy = p.location_y - y;
        if (dx * dx + dy * dy > tol2) continue;
        const nm = p.name;
        if (!nm || seen.has(nm)) continue;
        seen.add(nm);
        names.push(nm);
      }
    }
    return names;
  }

  // Union of all point tokens that appear in any remaining lane (for filtering display)
  function getRemainingLanePointsUnion(layer, sequence, team) {
    const remaining = getRemainingLanes(layer, sequence, team);
    return getLanePointsUnionFromSet(remaining, team);
  }

  // For every cluster token in the remaining-lane union, compute its
  // earliest team-perspective step number (1-indexed). Captured tokens get
  // their position in the sequence; future tokens get the smallest step
  // they hold across any remaining lane (matches v9's "min position" rule
  // when a flag appears in multiple lanes at different positions).
  function getLookaheadSteps(layer, sequence, team) {
    const remaining = getRemainingLanes(layer, sequence, team);
    return getLookaheadStepsFromSet(remaining, sequence, team);
  }

  function isObjectiveInLane(objKey, lane) {
    const normalized = normalizeObjectiveToken(objKey);
    return getLaneObjectiveKeys(lane).includes(normalized);
  }

  function getObjectiveLaneIndex(objKey, lane) {
    const normalized = normalizeObjectiveToken(objKey);
    return getLaneObjectiveKeys(lane).indexOf(normalized);
  }

  function buildOrderedObjectives(layer) {
    const objectives = layer.objectives || {};
    const entries = Object.entries(objectives).map(([key, objective]) => ({ key, objective }));
    const usedKeys = new Set();
    const ordered = [];

    const findMatch = (orderName) => {
      const normalized = normalizeObjectiveToken(orderName);
      const remaining = entries.filter((entry) => !usedKeys.has(entry.key));

      return remaining.find((entry) => normalizeObjectiveToken(entry.objective.objectDisplayName) === normalized)
        || remaining.find((entry) => normalizeObjectiveToken(entry.objective.name) === normalized)
        || remaining.find((entry) => normalizeObjectiveToken(entry.key) === normalized)
        || (normalized.includes('team1main') ? remaining.find((entry) => /team1main/i.test(entry.key)) : null)
        || ((normalized.includes('team2main') || normalized.includes('zteam2main'))
          ? remaining.find((entry) => /team2main/i.test(entry.key) || /main_1$/i.test(entry.key))
          : null);
    };

    getObjectiveOrderNames(layer).forEach((orderName) => {
      const match = findMatch(orderName);
      if (!match) return;
      usedKeys.add(match.key);
      ordered.push({
        key: match.key,
        objective: match.objective,
        orderName,
        label: getObjectiveDisplayName(match.key, match.objective, orderName),
        position: getObjectivePosition(match.objective)
      });
    });

    entries.forEach((entry) => {
      if (usedKeys.has(entry.key)) return;
      ordered.push({
        key: entry.key,
        objective: entry.objective,
        orderName: entry.key,
        label: getObjectiveDisplayName(entry.key, entry.objective, entry.key),
        position: getObjectivePosition(entry.objective)
      });
    });

    return ordered;
  }

  function getObjectiveLabelByToken(layer, token) {
    const normalized = normalizeObjectiveToken(token);
    const match = buildOrderedObjectives(layer).find((entry) => normalizeObjectiveToken(entry.key) === normalized);
    return match?.label || token;
  }

  function getTokenDisplayLabel(layer, token) {
    const normalized = normalizeObjectiveToken(token);
    if (hasStagingFocusToken(normalized) && stagingFocus?.name) return stagingFocus.name;
    if (capturedSubPoints[normalized]?.name) return capturedSubPoints[normalized].name;
    return getObjectiveLabelByToken(layer, normalized);
  }

  function getTokenDisplayCandidates(layer, token) {
    const normalized = normalizeObjectiveToken(token);
    if (hasStagingFocusToken(normalized) && stagingFocus?.name) return [stagingFocus.name];
    if (capturedSubPoints[normalized]?.name) return [capturedSubPoints[normalized].name];

    const objectives = layer.objectives || {};
    const objectiveEntry = Object.entries(objectives)
      .find(([key]) => normalizeObjectiveToken(key) === normalized);
    if (!objectiveEntry) return [getObjectiveLabelByToken(layer, normalized)];

    const [, objective] = objectiveEntry;
    const allNames = getObjectiveAllNames(objective);
    return allNames.length > 0 ? allNames : [getObjectiveLabelByToken(layer, normalized)];
  }

  function getStagingFocusTokens() {
    if (!stagingFocus) return [];
    if (Array.isArray(stagingFocus.tokens)) return stagingFocus.tokens;
    return stagingFocus.token ? [stagingFocus.token] : [];
  }

  function hasStagingFocusToken(token) {
    if (!stagingFocus) return false;
    const normalized = normalizeObjectiveToken(token);
    return getStagingFocusTokens().includes(normalized);
  }

  function getStagingFocusLabel(layer) {
    if (!stagingFocus) return '';
    if (stagingFocus.name) return stagingFocus.name;
    const primaryToken = getStagingFocusTokens()[0];
    return primaryToken ? getObjectiveLabelByToken(layer, primaryToken) : '';
  }

  function isStagingFocusSelection(token, position) {
    if (!stagingFocus) return false;
    if (!hasStagingFocusToken(token)) return false;
    if (!Number.isFinite(stagingFocus.x) || !Number.isFinite(stagingFocus.y)) return true;
    return Math.abs((position?.x ?? NaN) - stagingFocus.x) < 1 && Math.abs((position?.y ?? NaN) - stagingFocus.y) < 1;
  }

  function getStagingFocusLanes(layer, team) {
    const lanes = getLanes(layer);
    if (!stagingFocus || !team) return lanes;
    const filtered = {};
    for (const [name, lane] of Object.entries(lanes)) {
      if (getLaneCaptureOrder(lane, team).some((token) => hasStagingFocusToken(token))) {
        filtered[name] = lane;
      }
    }
    return Object.keys(filtered).length ? filtered : lanes;
  }

  function getVisibleProgressionLanes(layer, team) {
    if (!team) return null;
    let visible = null;
    if (captureSequence.length > 0) {
      const remaining = getRemainingLanes(layer, captureSequence, team);
      visible = Object.keys(remaining).length ? remaining : null;
    } else {
      visible = getStagingFocusLanes(layer, team);
    }
    if (!visible) return null;
    if (activeLane) {
      return visible[activeLane] ? { [activeLane]: visible[activeLane] } : null;
    }
    return visible;
  }

  function uniqueLabelsFromTokens(layer, tokens) {
    const labels = [];
    for (const token of (tokens || [])) {
      labels.push(...getTokenDisplayCandidates(layer, token));
    }
    return [...new Set(labels.filter(Boolean))];
  }

  function getLiveObjectiveState(layer) {
    if (!activeTeam) return null;

    const fixedPath = getAASPath(layer);
    if (fixedPath) {
      const order = getLaneCaptureOrder(fixedPath, activeTeam);
      const currentTokens = captureSequence.length ? (getCaptureSteps(captureSequence).at(-1)?.tokens || []) : [];
      const nextToken = order[getCaptureSteps(captureSequence).length] || null;
      return {
        phase: captureSequence.length ? 'live' : 'staging',
        laneCount: 1,
        focusLabel: '',
        currentLabels: uniqueLabelsFromTokens(layer, currentTokens),
        firstLabels: uniqueLabelsFromTokens(layer, order[0] ? [order[0]] : []),
        nextLabels: uniqueLabelsFromTokens(layer, nextToken ? [nextToken] : [])
      };
    }

    const visibleLanes = getVisibleProgressionLanes(layer, activeTeam);
    if (!visibleLanes) return null;
    const laneCount = Object.keys(visibleLanes).length;
    const steps = getCaptureSteps(captureSequence);
    if (!steps.length) {
      const firstTokens = Array.from(getNextCaptureOptionsFromSet(visibleLanes, [], activeTeam));
      const thinkAhead = [];
      for (const lane of Object.values(visibleLanes)) {
        const order = getLaneCaptureOrder(lane, activeTeam);
        if (order[1]) thinkAhead.push(order[1]);
      }
      return {
        phase: stagingFocus ? 'staging-focus' : 'staging',
        laneCount,
        focusLabel: getStagingFocusLabel(layer),
        currentLabels: [],
        firstLabels: uniqueLabelsFromTokens(layer, firstTokens),
        nextLabels: uniqueLabelsFromTokens(layer, thinkAhead)
      };
    }

    const currentTokens = steps.at(-1)?.tokens || [];
    const nextTokens = Array.from(getNextCaptureOptionsFromSet(visibleLanes, captureSequence, activeTeam));
    return {
      phase: 'live',
      laneCount,
      focusLabel: '',
      currentLabels: uniqueLabelsFromTokens(layer, currentTokens),
      firstLabels: [],
      nextLabels: uniqueLabelsFromTokens(layer, nextTokens)
    };
  }

  function buildLiveObjectiveSummaryHtml(state) {
    const buildRow = (label, values, rowClass = '') => {
      if (!values || !values.length) return '';
      return `<div class="live-objective-row${rowClass ? ` ${rowClass}` : ''}">
        <span class="live-objective-label">${label}</span>
        <span class="live-objective-value">${escapeHtml(values.join(' / '))}</span>
      </div>`;
    };

    const title = state.phase === 'live'
      ? `Live objective read · ${state.laneCount} lane${state.laneCount === 1 ? '' : 's'}`
      : state.phase === 'staging-focus'
        ? `Staging focus · ${state.laneCount} lane${state.laneCount === 1 ? '' : 's'}`
        : `Opening read · ${state.laneCount} lane${state.laneCount === 1 ? '' : 's'}`;

    return `<div class="live-objective-summary">
      <div class="live-objective-title">${escapeHtml(title)}</div>
      ${state.focusLabel ? `<div class="live-objective-row focus"><span class="live-objective-label">Focus</span><span class="live-objective-value">${escapeHtml(state.focusLabel)}</span></div>` : ''}
      ${buildRow(state.phase === 'live' ? 'Current' : 'Likely first', state.phase === 'live' ? state.currentLabels : state.firstLabels, state.phase === 'live' ? 'current' : 'first')}
      ${buildRow('Think ahead', state.nextLabels, 'next')}
    </div>`;
  }

  // ---- Leaflet Map ----
  function renderMap(layer) {
    const container = document.getElementById('leaflet-map');

    // Clean up previous map
    resetLaneLineAnimations();
    if (mapResizeObserver) {
      mapResizeObserver.disconnect();
      mapResizeObserver = null;
    }
    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }
    userInteractedWithMap = false;

    // Map texture corners define the UE world coordinate bounds of the texture
    const corners = layer.mapTextureCorners || [];
    if (corners.length < 2) return;

    // Determine min/max from both corners (order-agnostic)
    const minX = Math.min(corners[0].location_x, corners[1].location_x);
    const minY = Math.min(corners[0].location_y, corners[1].location_y);
    const maxX = Math.max(corners[0].location_x, corners[1].location_x);
    const maxY = Math.max(corners[0].location_y, corners[1].location_y);

    const mapHeight = Math.abs(maxY - minY);
    // Tile pyramid tops out at z=5 (32x32 = 1024 tiles, ~8192px square),
    // upscaled from the SDK-native 4096x4096 source via Real-ESRGAN x4plus.
    // See scripts/upscale_tiles_to_z5.py for the rebuild pipeline.
    const tileSize = 256;
    const maxNativeZoom = 5;

    // Uniform scale factor (matches the working v1 site)
    // Transformation: x' = a*lng + b, y' = c*lat + d
    const scale = tileSize / mapHeight;
    const a = scale;
    const b = -minX * scale;
    const c_val = scale;
    const d = -minY * scale;

    const transformation = new L.Transformation(a, b, c_val, d);

    const SquadCRS = L.extend({}, L.CRS.Simple, {
      transformation: transformation
    });

    leafletMap = L.map(container, {
      crs: SquadCRS,
      minZoom: 0,
      maxZoom: 7,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      doubleClickZoom: false,
      attributionControl: false,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(leafletMap);

    // Add tile layer
    const texName = layer.minimapTexture;
    const mapBounds = L.latLngBounds(
      L.latLng(minY, minX),
      L.latLng(maxY, maxX)
    );
    tileLayer = L.tileLayer(`assets/maps/tiles/${texName}/{z}/{x}/{y}.webp`, {
      tileSize: tileSize,
      maxNativeZoom: maxNativeZoom,
      minZoom: 0,
      maxZoom: 7,
      noWrap: true,
      bounds: mapBounds,
      errorTileUrl: ''
    }).addTo(leafletMap);

    // Fit map to bounds so it fills the container with no dead space
    leafletMap.fitBounds(mapBounds);
    leafletMap.setMaxBounds(mapBounds.pad(0.05));

    // Track user interaction so container resizes don't stomp the user's view.
    // mousedown/wheel/touchstart fire only for user input, unlike movestart/zoomstart
    // which also fire for programmatic fitBounds calls.
    const markInteracted = () => { userInteractedWithMap = true; };
    container.addEventListener('mousedown', markInteracted, { once: true });
    container.addEventListener('wheel', markInteracted, { once: true, passive: true });
    container.addEventListener('touchstart', markInteracted, { once: true, passive: true });

    // Re-measure and re-fit on container resize (sidebar toggle, window resize,
    // strategy drawer, etc.). Fixes the initial-render race where the sidebar
    // width transition leaves the map fit to a stale container width.
    if (typeof ResizeObserver !== 'undefined') {
      mapResizeObserver = new ResizeObserver(() => {
        if (!leafletMap) return;
        leafletMap.invalidateSize({ animate: false });
        if (!userInteractedWithMap) {
          leafletMap.fitBounds(mapBounds, { animate: false });
        }
      });
      mapResizeObserver.observe(container);
    }

    // Add markers
    if (markerGroup) {
      markerGroup.clearLayers();
    }
    markerGroup = L.layerGroup().addTo(leafletMap);

    drawBorder(layer);
    drawTCHexZones(layer);
    drawDestructionPhases(layer);
    drawInsurgencyCaches(layer);
    drawObjectives(layer);

    // HAB tool layer (persists across redraws, sits on top)
    initHabLayer();
    initMortarLayer();
    leafletMap.on('dblclick', handleMapDblClick);
    leafletMap.on('contextmenu', openMapContextMenu);
    leafletMap.on('movestart zoomstart', closeMapContextMenu);
  }

  // ---- Fixed Path Helpers ----
  // AAS and Skirmish expose a single fixed pointsOrder (no lane graph) — a
  // numbered chain from team1 main through ~5-7 contestable points to team2
  // main. Build a synthetic path object so they can share the marker/line
  // renderer. Invasion looks similar in the data but is actually multi-lane —
  // see getInvasionLanes — and flows through the RAAS-progressive renderer.
  const FIXED_PATH_GAMEMODES = new Set(['AAS', 'Skirmish']);
  function getFixedPath(layer) {
    if (!FIXED_PATH_GAMEMODES.has(layer.gamemode)) return null;
    const cp = layer.capturePoints || {};
    const order = (cp.points || {}).pointsOrder || (cp.clusters || {}).pointsOrder;
    if (!Array.isArray(order) || !order.length) return null;
    return { pointsOrder: order, mode: layer.gamemode };
  }

  function getAASPath(layer) {
    return getFixedPath(layer);
  }

  // ---- Draw Objectives ----
  function drawObjectives(layer) {
    const orderedObjectives = buildOrderedObjectives(layer);
    const lanes = getLanes(layer);
    const aasPath = getAASPath(layer);
    const hasRaasLanes = Object.keys(lanes).length > 0;
    const isAAS = !!aasPath;

    // RAAS (and Invasion via getInvasionLanes) renders from the current
    // capture progression. An explicit lane selection narrows the visible
    // graph instead of replacing it.
    const selectedRaasLane = activeLane ? lanes[activeLane] : null;
    const lane = aasPath && activeTeam ? aasPath : null;
    const isRaasProgressive = hasRaasLanes && activeTeam;
    let progressionLanes = null;

    // Build a set of "active" objective keys for the current lane
    let activeObjKeys = null; // null = show all
    let capturedKeys = new Set();
    let nextOptionTokens = new Set(); // tokens that are clickable next-capture options
    let lastCapturedTokens = new Set();

    if (isAAS && activeTeam) {
      // AAS: all objectives are captured
      for (const entry of orderedObjectives) {
        capturedKeys.add(normalizeObjectiveToken(entry.key));
      }
    } else if (isRaasProgressive) {
      // Progressive RAAS: walk captureSequence, then expose the remaining lane
      // union or a selected lane filtered by the same progression. If the
      // sequence doesn't match any lane prefix, fall back to free mode.
      progressionLanes = getVisibleProgressionLanes(layer, activeTeam);

      // Always include mains as captured
      for (const entry of orderedObjectives) {
        const t = normalizeObjectiveToken(entry.key);
        if (/team[12]main/.test(t)) capturedKeys.add(t);
      }
      // Mark sequence as captured
      for (const tok of captureSequence) {
        capturedKeys.add(tok);
      }
      const captureSteps = getCaptureSteps(captureSequence);
      const lastStep = captureSteps[captureSteps.length - 1];
      if (lastStep) {
        lastCapturedTokens = new Set(lastStep.tokens);
      }

      if (progressionLanes) {
        // Strict mode: filter to the visible lane set, with next options still
        // derived from the active capture prefix.
        activeObjKeys = getLanePointsUnionFromSet(progressionLanes, activeTeam);
        for (const entry of orderedObjectives) {
          const t = normalizeObjectiveToken(entry.key);
          if (/team[12]main/.test(t)) activeObjKeys.add(t);
        }
        nextOptionTokens = getNextCaptureOptionsFromSet(progressionLanes, captureSequence, activeTeam);
      } else {
        // Free mode: show all clusters; uncaptured ones become next options
        activeObjKeys = null;
        for (const entry of orderedObjectives) {
          const t = normalizeObjectiveToken(entry.key);
          if (/team[12]main/.test(t)) continue;
          if (!capturedKeys.has(t)) nextOptionTokens.add(t);
        }
      }
    } else if (selectedRaasLane) {
      activeObjKeys = new Set(getLaneObjectiveKeys(selectedRaasLane));
    } else if (lane) {
      // Lane selected but no team — just highlight lane objectives
      activeObjKeys = new Set(getLaneObjectiveKeys(lane));
    }

    let pointIndex = 1;
    let laneBadgeNumbers = null;
    if (lane || isRaasProgressive || selectedRaasLane) {
      laneBadgeNumbers = new Map();
      if (isRaasProgressive) {
        // Step-numbered union: every cluster in any remaining lane gets its
        // earliest team-perspective step. Captured points hold their sequence
        // index. Matches the v9 RAAS overlay behavior.
        const stepMap = progressionLanes
          ? getLookaheadStepsFromSet(progressionLanes, captureSequence, activeTeam)
          : new Map();
        for (const [tok, step] of stepMap) laneBadgeNumbers.set(tok, step);
      } else {
        let badgeIndex = 1;
        const badgeLane = selectedRaasLane || lane;
        const badgeOrder = activeTeam === 'team2'
          ? [...(badgeLane.pointsOrder || [])].reverse()
          : [...(badgeLane.pointsOrder || [])];
        for (const name of badgeOrder) {
          const token = normalizeObjectiveToken(name);
          if (/team[12]main/.test(token) || laneBadgeNumbers.has(token)) continue;
          laneBadgeNumbers.set(token, badgeIndex++);
        }
      }
    }

    // Collect positions in lane order for drawing connecting lines
    const lanePositions = [];
    // Track rendered marker positions to dedupe overlapping markers
    // (e.g. A1 and B1 both render Naval Refueling on Goose Bay, or B1's
    // Train Yard at (-84322,-102468) vs C1's Train Yard2 at (-84222,-102368)
    // which are 1.41m apart — extraction artifacts for the same physical
    // flag). Use an array + Euclidean check because a grid hash can't
    // reliably merge near-duplicates — any two points straddling a cell
    // boundary will hash to different cells no matter the cell size.
    const renderedPositions = [];
    const DEDUPE_TOL_UE = 300; // 3m; genuinely distinct capture points are
                               // separated by thousands of UE on every map.
    const DEDUPE_TOL_SQ = DEDUPE_TOL_UE * DEDUPE_TOL_UE;
    const positionAlreadyRendered = (x, y, list = renderedPositions) => {
      for (const p of list) {
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy <= DEDUPE_TOL_SQ) return true;
      }
      return false;
    };

    // Precompute positions of captured points so uncaptured markers at the
    // same position get suppressed (captured always wins the marker slot).
    const capturedPositions = [];
    for (const entry of orderedObjectives) {
      const t = normalizeObjectiveToken(entry.key);
      if (!capturedKeys.has(t) || /team[12]main/.test(t)) continue;
      const sel = capturedSubPoints[t];
      const x = sel?.x ?? entry.position?.x;
      const y = sel?.y ?? entry.position?.y;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        capturedPositions.push({ x, y });
      }
    }

    // Render lower-badge clusters first so their dedup claim wins. Squad's
    // SDK assigns the same physical sub-point (e.g. Black Coast's "Paseka"
    // at -44772/106216) to multiple clusters across different lanes — A2 in
    // Alpha (step 2) and B1/F1/G1 in Bravo/Foxtrot/Golf (step 1). Without
    // sorting, dict-insertion order lets A2 stake the position with badge 2
    // and the badge-1 attempts get deduped silently. Mains stay where they
    // are; non-mains sort by badge ascending.
    const renderEntries = [...orderedObjectives].sort((a, b) => {
      const aMain = /team[12]main/.test(normalizeObjectiveToken(a.key));
      const bMain = /team[12]main/.test(normalizeObjectiveToken(b.key));
      if (aMain !== bMain) return aMain ? -1 : 1;
      if (aMain) return 0;
      const ba = laneBadgeNumbers?.get(normalizeObjectiveToken(a.key));
      const bb = laneBadgeNumbers?.get(normalizeObjectiveToken(b.key));
      return (ba ?? Infinity) - (bb ?? Infinity);
    });

    for (const entry of renderEntries) {
      if (!entry.position) continue;

      const entryToken = normalizeObjectiveToken(entry.key);
      const isMain = /team[12]main/.test(entryToken);

      // Determine if this objective is in the active lane / remaining lane union
      // Mains are always in every lane
      const inLane = !activeObjKeys || activeObjKeys.has(entryToken) || isMain;
      const isCaptured = capturedKeys.has(entryToken);
      const isNextOption = nextOptionTokens.has(entryToken);

      // If filtering active and this obj is NOT in it, skip entirely
      if (activeObjKeys && !inLane) {
        continue;
      }

      // Determine team ownership from the normalized token so faction-named
      // mains like Mestia's "00-USAMain" / "100-MILMain" still color
      // correctly as blufor / redfor.
      let team = 'neutral';
      if (entryToken === 'team1main') team = 'blufor';
      else if (entryToken === 'team2main') team = 'redfor';

      // Compute marker styling for this objective
      let markerClass = team;
      let extraClass = '';
      const isOwnMain = activeTeam && isMain && (
        (activeTeam === 'team1' && team === 'blufor') ||
        (activeTeam === 'team2' && team === 'redfor')
      );

      if (isOwnMain) {
        extraClass = ' active-main';
      }

      const styleAsLane = (lane && activeTeam) || isRaasProgressive;
      if (styleAsLane) {
        if (!isMain && isCaptured) {
          markerClass = activeTeam === 'team1' ? 'blufor' : 'redfor';
          extraClass = (!isAAS && lastCapturedTokens.has(entryToken)) ? ' captured last-captured' : ' captured';
        } else if (!isMain && isNextOption) {
          markerClass = activeTeam === 'team1' ? 'blufor' : 'redfor';
          extraClass = ' next-capture';
        } else if (!isMain) {
          // Future cluster still in some remaining lane — render as look-ahead.
          markerClass = 'neutral';
          extraClass = ' uncaptured';
        }
      }

      const isLookahead = extraClass.includes('uncaptured');
      const badgeNum = isMain
        ? null
        : (laneBadgeNumbers?.get(entryToken) ?? pointIndex++);
      // In progressive RAAS, color look-ahead and next markers by their step
      // (heatmap). Captured points use the captured-step color too so the
      // visual chain reads as 1→2→3 instead of all-team-color.
      const stepColorOverride = (isRaasProgressive && !isMain && Number.isFinite(badgeNum))
        ? getStepColor(badgeNum)
        : null;
      const colorStyleSuffix = stepColorOverride
        ? `;background:${stepColorOverride};border-color:${stepColorOverride};color:#1a1a14`
        : '';
      const subPoints = getSubPoints(entry.objective);

      // Render every sub-point separately for lane-based modes so the path
      // structure is visible (each physical flag position is its own marker).
      // Invasion enters this branch via getInvasionLanes() exposing fake lanes,
      // which sets hasRaasLanes for layouts whose data lacks an explicit graph.
      if (subPoints.length > 1 && !isMain && hasRaasLanes) {
        // For captured objectives, only show the sub-point the user selected
        const selectedSp = capturedSubPoints[entryToken];
        const pointsToRender = (isCaptured && selectedSp)
          ? subPoints.filter(sp => sp.x === selectedSp.x && sp.y === selectedSp.y)
          : subPoints;

        // Track which sub-points actually made it onto the map so the lane
        // line terminates at a visible marker rather than at avgLocation
        // (which, when one of the cluster's sub-points got deduped by
        // another lane's alias, falls in dead space). Goose Bay Bravo B1
        // is the canonical example: Naval Refueling Station is shared with
        // A1, leaving only Train Yard as B1's rendered marker.
        const renderedSubPoints = [];

        for (const sp of pointsToRender) {
          // Dedupe markers that share a physical position. Captured clusters
          // get priority — uncaptured ones at a captured position are hidden.
          if (positionAlreadyRendered(sp.x, sp.y)) continue;
          if (!isCaptured && positionAlreadyRendered(sp.x, sp.y, capturedPositions)) continue;
          renderedPositions.push({ x: sp.x, y: sp.y });
          renderedSubPoints.push(sp);

          const size = isLookahead ? 32 : 36;
          const icon = L.divIcon({
            className: '',
            html: `<div class="obj-marker ${markerClass}${extraClass}${isStagingFocusSelection(entryToken, sp) ? ' staging-focus' : ''}" style="width:${size}px;height:${size}px${colorStyleSuffix}">${badgeNum ?? ''}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
          });

          const marker = L.marker([sp.y, sp.x], { icon: icon });

          // When several clusters label the same physical point differently
          // (e.g. Al Basrah RAAS_v1 (-6659, 87366) is "Abul Khasib West" in
          // A6/B5 and "Abul Khasib" in C6), surface every unique alias so the
          // surviving marker doesn't hide the lane-relevant name.
          const aliasNames = getSubPointNamesAtPosition(layer, sp.x, sp.y);
          const labelText = aliasNames.length > 1 ? aliasNames.join(' / ') : sp.name;

          if (shouldShowPermanentObjectiveLabel(labelText)) {
            marker.bindTooltip(labelText, {
              permanent: true,
              direction: 'top',
              offset: [0, -size / 2 - 2],
              className: 'obj-label'
            });
          }

          if (isNextOption && styleAsLane) {
            // Next-capture: click to advance the capture sequence. The helper
            // walks any aliased clusters at this physical position and writes
            // their sub-point records too.
            marker.on('click', () => {
              stagingFocus = null;
              advanceCaptureSequence(layer, entryToken, { x: sp.x, y: sp.y, name: sp.name });
            });
          } else if (isCaptured && lastCapturedTokens.has(entryToken) && styleAsLane && !isAAS) {
            // Last captured: click to uncapture
            marker.on('click', () => {
              delete capturedSubPoints[entryToken];
              retreatCaptureSequence(layer);
            });
          } else if (!isLookahead) {
            marker.bindPopup(`<b>${escapeHtml(labelText)}</b>`);
          }

          marker.addTo(markerGroup);
        }
        // linePos: anchor the lane line to a visible marker rather than
        // avgLocation. Priority:
        //   1. Captured selection (user explicitly picked one sub-point).
        //   2. Exactly one sub-point rendered (the rest deduped by aliases) —
        //      use that one so the line terminates where the user sees it.
        //   3. Multiple sub-points rendered — avgLocation is the sensible
        //      centroid.
        //   4. Nothing rendered (all sub-points collided with earlier
        //      aliases) — fall back to the first sub-point's position so
        //      the line lands on a visible marker from the colliding cluster.
        let linePos;
        if (isCaptured && selectedSp) {
          linePos = { x: selectedSp.x, y: selectedSp.y };
        } else if (renderedSubPoints.length === 1) {
          linePos = { x: renderedSubPoints[0].x, y: renderedSubPoints[0].y };
        } else if (renderedSubPoints.length > 1) {
          linePos = entry.position;
        } else if (pointsToRender.length > 0) {
          linePos = { x: pointsToRender[0].x, y: pointsToRender[0].y };
        } else {
          linePos = entry.position;
        }
        if (styleAsLane) {
          lanePositions.push({ pos: linePos, token: entryToken, isCaptured, isNext: isNextOption, step: badgeNum });
        }
      } else {
        // Single-point objective or main base. Dedupe by physical position so
        // two clusters sharing a point (e.g. A1 and D1 both at Trudove
        // Outskirts) only render one marker — but ALWAYS push to lanePositions
        // so drawLaneLines can still find the token when walking pointsOrder,
        // otherwise the line jumps over the deduped cluster entirely.
        let skipMarker = false;
        if (!isMain) {
          const px = entry.position.x;
          const py = entry.position.y;
          if (positionAlreadyRendered(px, py)) {
            skipMarker = true;
          } else if (!isCaptured && positionAlreadyRendered(px, py, capturedPositions)) {
            skipMarker = true;
          } else {
            renderedPositions.push({ x: px, y: py });
          }
        }

        if (!skipMarker) {
          const isActiveMain = isMain && extraClass.includes('active-main');
          const size = isMain ? (isActiveMain ? 48 : 40) : (isLookahead ? 34 : 38);
          const badgeText = isMain ? 'M' : String(badgeNum);

          const icon = L.divIcon({
            className: '',
            html: `<div class="obj-marker ${markerClass}${extraClass}${isStagingFocusSelection(entryToken, entry.position) ? ' staging-focus' : ''}" style="width:${size}px;height:${size}px${colorStyleSuffix}">${badgeText}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
          });

          const marker = L.marker(
            [entry.position.y, entry.position.x],
            { icon: icon }
          );

          if (shouldShowPermanentObjectiveLabel(entry.label)) {
            marker.bindTooltip(entry.label, {
              permanent: true,
              direction: 'top',
              offset: [0, -size / 2 - 2],
              className: 'obj-label'
            });
          }

          if (isNextOption && styleAsLane) {
            // Next-capture: click to advance the capture sequence
            marker.on('click', () => {
              stagingFocus = null;
              advanceCaptureSequence(layer, entryToken, entry.position);
            });
          } else if (isCaptured && lastCapturedTokens.has(entryToken) && styleAsLane && !isAAS) {
            // Last captured: click to uncapture
            marker.on('click', () => {
              retreatCaptureSequence(layer);
            });
          } else if (isMain) {
            marker.on('click', () => {
              const nextTeam = entryToken === 'team1main' ? 'team1' : 'team2';
              setActiveTeam(nextTeam, layer, { allowToggleOff: true });
            });
          } else if (!isLookahead) {
            marker.bindPopup(`<b>${escapeHtml(entry.label)}</b>`);
          }

          marker.addTo(markerGroup);
        }

        if (styleAsLane) {
          lanePositions.push({ pos: entry.position, token: entryToken, isCaptured, isNext: isNextOption, step: badgeNum });
        }
      }
    }

    // Draw connecting lines along the lane (or AAS path)
    if (lane && lanePositions.length > 1) {
      if (isAAS) {
        drawAASLines(lanePositions);
      } else {
        drawLaneLines(lane, lanePositions);
      }
    } else if (selectedRaasLane && !activeTeam && lanePositions.length > 1) {
      drawLaneLines(selectedRaasLane, lanePositions);
    } else if (isRaasProgressive && lanePositions.length > 1) {
      // Draw lines for each visible lane (union or explicit lane filter).
      for (const rlane of Object.values(progressionLanes || {})) {
        drawLaneLines(rlane, lanePositions, { stepColored: true });
      }
    }
  }

  // Advance the capture sequence. If a position is given, all clusters that
  // have a sub-point at that position are captured together (handles shared
  // physical flags across cluster IDs, e.g. Manicouagan Cannabis Farm).
  // The clicked token leads, with aliases following so retreat removes them all.
  // `position` may carry a `name` to seed the sub-point label for fresh aliases.
  function advanceCaptureSequence(layer, token, position) {
    stagingFocus = null;
    let aliases = [token];
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      const found = findClustersAtPosition(layer, position.x, position.y);
      found.delete(token);
      aliases = [token, ...found];
    }
    // Filter out any aliases already captured
    const captured = new Set(captureSequence);
    const fresh = aliases.filter(t => !captured.has(t));
    if (fresh.length === 0) return;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      const seedName = position.name || '';
      for (const alias of fresh) {
        capturedSubPoints[alias] = {
          x: position.x,
          y: position.y,
          name: capturedSubPoints[alias]?.name || seedName
        };
      }
    }
    captureSequence = [...captureSequence, ...fresh];
    renderTopPanel(layer);
    redrawMarkers(layer);
  }

  function retreatCaptureSequence(layer) {
    if (captureSequence.length === 0) return;
    const steps = getCaptureSteps(captureSequence);
    const lastStep = steps[steps.length - 1];
    if (!lastStep) return;
    captureSequence = captureSequence.slice(0, -lastStep.tokens.length);
    for (const token of lastStep.tokens) {
      delete capturedSubPoints[token];
    }
    renderTopPanel(layer);
    redrawMarkers(layer);
  }

  function resetLaneLineAnimations() {
    animatedLaneLines = [];
    lastLaneAnimationTs = 0;
    if (laneAnimationFrameId !== null) {
      cancelAnimationFrame(laneAnimationFrameId);
      laneAnimationFrameId = null;
    }
  }

  function stepLaneLineAnimations(timestamp) {
    if (!animatedLaneLines.length) {
      laneAnimationFrameId = null;
      lastLaneAnimationTs = 0;
      return;
    }

    if (!lastLaneAnimationTs) {
      lastLaneAnimationTs = timestamp;
    }
    const delta = timestamp - lastLaneAnimationTs;
    lastLaneAnimationTs = timestamp;

    animatedLaneLines = animatedLaneLines.filter((entry) => {
      if (!entry.path || !entry.path.isConnected) return false;
      entry.offset -= delta * entry.speed;
      entry.path.style.strokeDashoffset = `${entry.offset}`;
      return true;
    });

    laneAnimationFrameId = requestAnimationFrame(stepLaneLineAnimations);
  }

  function applyLaneLineAnimation(polyline, options = {}) {
    const { dashArray = null, isNext = false } = options;
    if (!dashArray) return;

    const registerPath = (attempt = 0) => {
      const path = polyline.getElement();
      if (!path) {
        if (attempt < 4) {
          requestAnimationFrame(() => registerPath(attempt + 1));
        }
        return;
      }

      path.style.strokeDasharray = dashArray;
      path.style.strokeDashoffset = '0';
      path.style.animation = 'none';
      animatedLaneLines.push({
        path,
        offset: 0,
        speed: isNext ? 0.045 : 0.024
      });
      if (laneAnimationFrameId === null) {
        laneAnimationFrameId = requestAnimationFrame(stepLaneLineAnimations);
      }
    };

    registerPath();
  }

  // Draw lines connecting objectives along the lane in order
  function drawLaneLines(lane, lanePositions, options = {}) {
    const { stepColored = false } = options;
    const order = (activeTeam === 'team2')
      ? [...(lane.pointsOrder || [])].reverse()
      : (lane.pointsOrder || []);
    const posByToken = {};
    for (const lp of lanePositions) {
      posByToken[lp.token] = lp;
    }

    const orderedPos = [];
    for (const name of order) {
      const token = normalizeObjectiveToken(name);
      if (posByToken[token]) {
        orderedPos.push(posByToken[token]);
      }
    }

    // Draw lines between objectives
    for (let i = 0; i < orderedPos.length - 1; i++) {
      const from = orderedPos[i];
      const to = orderedPos[i + 1];

      const fromLL = [from.pos.y, from.pos.x];
      const toLL = [to.pos.y, to.pos.x];

      let color = '#ccc';
      let weight = 3;
      let opacity = 0.85;
      let dashArray = null;
      let className = 'lane-line';

      if (stepColored) {
        // Progressive RAAS look-ahead: color each segment by the destination
        // step in the team's progression. Captured→captured stays solid;
        // any segment touching look-ahead points fades + dashes.
        const destStep = to.step;
        color = getStepColor(destStep);
        if (from.isCaptured && to.isCaptured) {
          weight = 3.6;
          opacity = 0.92;
          className += ' lane-line-captured';
        } else if (to.isNext || from.isNext) {
          weight = 3.2;
          opacity = 0.88;
          dashArray = '10 8';
          className += ' lane-line-ants lane-line-next';
        } else {
          weight = 2.8;
          opacity = 0.62;
          dashArray = '6 8';
          className += ' lane-line-ants lane-line-future';
        }
      } else if (activeTeam) {
        const teamHex = activeTeam === 'team1' ? '#4a7a3a' : '#8b4513';
        if (from.isCaptured && to.isCaptured) {
          color = teamHex;
          weight = 3.4;
          className += ' lane-line-captured';
        } else if ((from.isCaptured && to.isNext) || (from.isNext && to.isCaptured)) {
          color = '#d2aa50';
          dashArray = '10 8';
          opacity = 0.78;
          weight = 3;
          className += ' lane-line-ants lane-line-next';
        } else {
          color = '#8b2e1e';
          weight = 2.6;
          opacity = 0.52;
          dashArray = '6 8';
          className += ' lane-line-ants lane-line-future';
        }
      }

      const lineOpts = { color, weight, opacity, className };
      if (dashArray) lineOpts.dashArray = dashArray;

      const polyline = L.polyline([fromLL, toLL], lineOpts).addTo(markerGroup);
      applyLaneLineAnimation(polyline, {
        dashArray,
        isNext: className.includes('lane-line-next')
      });
    }
  }

  // Draw solid lines connecting AAS objectives in order
  function drawAASLines(lanePositions) {
    const teamColor = activeTeam === 'team1' ? '#4a7a3a' : '#8b4513';
    for (let i = 0; i < lanePositions.length - 1; i++) {
      const from = lanePositions[i];
      const to = lanePositions[i + 1];
      L.polyline(
        [[from.pos.y, from.pos.x], [to.pos.y, to.pos.x]],
        { color: teamColor, weight: 3, opacity: 0.8 }
      ).addTo(markerGroup);
    }
  }

  // Get individual sub-points from an objective's points array
  function getSubPoints(objective) {
    const points = Array.isArray(objective.points) ? objective.points : [];
    return points
      .filter(p => Number.isFinite(p.location_x) && Number.isFinite(p.location_y))
      .map(p => ({
        x: p.location_x,
        y: p.location_y,
        name: p.name || 'Objective'
      }));
  }

  // ---- Draw Border ----
  function drawBorder(layer) {
    const border = layer.border || [];
    if (border.length < 3) return;

    // Some maps (Sanxian_AAS_v1-v3) have border polygons whose extent exceeds
    // the mapTextureCorners because the minimap texture file is narrower than
    // the playable area. Clip the polygon to the texture rect so dashed lines
    // don't float off into the black beyond the map image.
    const corners = layer.mapTextureCorners || [];
    let clip = null;
    if (corners.length >= 2) {
      const xs = corners.map(c => c.location_x);
      const ys = corners.map(c => c.location_y);
      clip = {
        xmin: Math.min(...xs), xmax: Math.max(...xs),
        ymin: Math.min(...ys), ymax: Math.max(...ys),
      };
    }

    // Sutherland–Hodgman polygon clipping against the (axis-aligned) texture rect.
    const clipBorder = (poly, rect) => {
      if (!rect || poly.length < 3) return poly;
      const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const clipEdge = (input, edge) => {
        const out = [];
        for (let i = 0; i < input.length; i++) {
          const curr = input[i];
          const prev = input[(i + input.length - 1) % input.length];
          const currIn = edge.inside(curr);
          const prevIn = edge.inside(prev);
          if (currIn) {
            if (!prevIn) out.push(edge.intersect(prev, curr));
            out.push(curr);
          } else if (prevIn) {
            out.push(edge.intersect(prev, curr));
          }
        }
        return out;
      };
      const edges = [
        { inside: p => p.x >= rect.xmin, intersect: (a, b) => lerp(a, b, (rect.xmin - a.x) / (b.x - a.x)) },
        { inside: p => p.x <= rect.xmax, intersect: (a, b) => lerp(a, b, (rect.xmax - a.x) / (b.x - a.x)) },
        { inside: p => p.y >= rect.ymin, intersect: (a, b) => lerp(a, b, (rect.ymin - a.y) / (b.y - a.y)) },
        { inside: p => p.y <= rect.ymax, intersect: (a, b) => lerp(a, b, (rect.ymax - a.y) / (b.y - a.y)) },
      ];
      let out = poly.map(p => ({ x: p.location_x, y: p.location_y }));
      for (const edge of edges) {
        out = clipEdge(out, edge);
        if (out.length === 0) return [];
      }
      return out.map(p => ({ location_x: p.x, location_y: p.y }));
    };

    const clipped = clipBorder(border, clip);
    if (clipped.length < 3) return;

    const latlngs = clipped.map(p => [p.location_y, p.location_x]);
    latlngs.push(latlngs[0]);

    L.polyline(latlngs, {
      color: '#f6ad55',
      weight: 2,
      opacity: 0.6,
      dashArray: '8 4'
    }).addTo(markerGroup);
  }

  // ---- Draw TC Hex Zones ----
  function drawTCHexZones(layer) {
    if (layer.gamemode !== 'Territory Control') return;
    const cp = layer.capturePoints || {};
    const hexsData = cp.hexs || {};
    const hexList = hexsData.hexs || [];
    if (!hexList.length) return;

    const anchorsT1 = new Set((hexsData.team1Anchors || []).map(Number));
    const anchorsT2 = new Set((hexsData.team2Anchors || []).map(Number));

    for (const hex of hexList) {
      if (!Number.isFinite(hex.location_x) || !Number.isFinite(hex.location_y)) continue;

      const team = hex.initialTeam;
      const isAnchor = anchorsT1.has(hex.hexNum) || anchorsT2.has(hex.hexNum);

      let fillColor, borderColor;
      if (team === '1') {
        fillColor = 'rgba(74, 122, 58, 0.35)';
        borderColor = '#4a7a3a';
      } else if (team === '2') {
        fillColor = 'rgba(139, 69, 19, 0.35)';
        borderColor = '#8b4513';
      } else {
        fillColor = 'rgba(128, 128, 112, 0.2)';
        borderColor = '#808070';
      }

      // Draw hex as a regular hexagon using boxExtent for sizing
      const ext = hex.boxExtent || {};
      const rx = ext.location_x || hex.sphereRadius * 0.62;
      const ry = ext.location_y || hex.sphereRadius * 0.54;
      const cx = hex.location_x;
      const cy = hex.location_y;

      // Flat-top hexagon vertices
      const hexPoints = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        hexPoints.push([
          cy + ry * Math.sin(angle),
          cx + rx * Math.cos(angle)
        ]);
      }

      const polygon = L.polygon(hexPoints, {
        color: borderColor,
        weight: isAnchor ? 2.5 : 1.5,
        opacity: isAnchor ? 0.9 : 0.6,
        fillColor: fillColor,
        fillOpacity: 1,
        dashArray: isAnchor ? null : '4 2',
        className: 'tc-hex'
      });

      const teamLabel = team === '1' ? 'Team 1' : team === '2' ? 'Team 2' : 'Neutral';
      let tooltip = `<b>${hex.flagName}</b><br>${teamLabel}`;
      if (isAnchor) tooltip += '<br><em>Anchor</em>';
      polygon.bindTooltip(tooltip, { sticky: true, className: 'hex-tooltip' });

      polygon.addTo(markerGroup);

      // Permanent hex-number label centered on the hex (matches v9).
      if (Number.isFinite(hex.hexNum)) {
        const label = L.divIcon({
          className: '',
          html: `<div class="tc-hex-label">${hex.hexNum}</div>`,
          iconSize: [22, 14],
          iconAnchor: [11, 7],
        });
        L.marker([cy, cx], { icon: label, interactive: false }).addTo(markerGroup);
      }
    }

    // Draw main base markers from points.objectives
    const points = cp.points || {};
    const objectives = points.objectives || [];
    for (const obj of objectives) {
      if (!Number.isFinite(obj.location_x) || !Number.isFinite(obj.location_y)) continue;

      const isTeam1 = /team1/i.test(obj.objectName) || /team1/i.test(obj.objectDisplayName);
      const team = isTeam1 ? 'blufor' : 'redfor';
      const size = 28;
      const icon = L.divIcon({
        className: '',
        html: `<div class="obj-marker ${team}" style="width:${size}px;height:${size}px">M</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });

      const marker = L.marker([obj.location_y, obj.location_x], { icon });
      marker.bindTooltip(obj.objectDisplayName || obj.name || 'Main', {
        permanent: true,
        direction: 'top',
        offset: [0, -size / 2 - 2],
        className: 'obj-label'
      });
      marker.addTo(markerGroup);
    }
  }

  // ---- Draw Insurgency Caches ----
  // Insurgency layers list every possible cache spawn position in
  // capturePoints.objectiveSpawnLocations (BP_DestroyableObjective actors).
  // The game randomly picks ~5 of these per match; the map shows all of them
  // so the player knows where caches *can* be.
  function drawInsurgencyCaches(layer) {
    if (layer.gamemode !== 'Insurgency') return;
    const cp = layer.capturePoints || {};
    const spawns = cp.objectiveSpawnLocations || [];
    if (!spawns.length) return;

    for (const spawn of spawns) {
      if (!Number.isFinite(spawn.location_x) || !Number.isFinite(spawn.location_y)) continue;
      const icon = L.divIcon({
        className: '',
        html: `<div class="cache-marker"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/></svg></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      L.marker([spawn.location_y, spawn.location_x], { icon, interactive: false })
        .addTo(markerGroup);
    }
  }

  // ---- Draw Destruction Phases ----
  function drawDestructionPhases(layer) {
    const cp = layer.capturePoints || {};
    if (cp.type !== 'Destruction') return;

    const dest = cp.destructionObject || {};
    const phases = dest.phases || [];
    if (!phases.length) return;

    const phaseColors = [
      { fill: 'rgba(210, 170, 80, 0.25)', border: '#d2aa50' },
      { fill: 'rgba(205, 133, 63, 0.25)', border: '#cd853f' },
      { fill: 'rgba(160, 82, 45, 0.25)', border: '#a0522d' }
    ];

    for (const phase of phases) {
      const phaseNum = phase.PhaseNumber;
      if (activeDestructionPhase !== null && activeDestructionPhase !== phaseNum) continue;

      const colors = phaseColors[phaseNum % phaseColors.length];
      const objs = phase.phaseObjectives || [];

      for (let oi = 0; oi < objs.length; oi++) {
        const obj = objs[oi];
        const spline = obj.splinePoints || [];
        if (spline.length < 3) continue;

        const latlngs = spline.map(p => [p.location_y, p.location_x]);
        // Close the polygon
        latlngs.push(latlngs[0]);

        const polygon = L.polygon(latlngs, {
          color: colors.border,
          weight: 2,
          opacity: 0.8,
          fillColor: colors.fill,
          fillOpacity: 1,
          dashArray: activeDestructionPhase === phaseNum ? null : '6 3',
          className: 'destruction-zone'
        });

        const tooltip = `<b>Phase ${phaseNum + 1} — Zone ${String.fromCharCode(65 + oi)}</b>`
          + `<br>${obj.numberOfSpots} possible positions`
          + `<br>${obj.numberOfCaches} cache${obj.numberOfCaches > 1 ? 's' : ''}`
          + `<br>Min spacing: ${(obj.minDistanceBetweenSpots / 100).toFixed(0)}m`;
        polygon.bindTooltip(tooltip, { sticky: true, className: 'hex-tooltip' });
        polygon.addTo(markerGroup);

        // Draw a label at the centroid
        const cx = spline.reduce((s, p) => s + p.location_x, 0) / spline.length;
        const cy = spline.reduce((s, p) => s + p.location_y, 0) / spline.length;
        const labelSize = 22;
        const labelIcon = L.divIcon({
          className: '',
          html: `<div class="phase-label phase-${phaseNum}">${phaseNum + 1}${String.fromCharCode(65 + oi)}</div>`,
          iconSize: [labelSize, labelSize],
          iconAnchor: [labelSize / 2, labelSize / 2]
        });
        L.marker([cy, cx], { icon: labelIcon, interactive: false }).addTo(markerGroup);
      }
    }

    // Draw no-deploy zones
    const noDeployZones = dest.noDeployZones || [];
    for (const ndz of noDeployZones) {
      if (!Number.isFinite(ndz.location_x) || !Number.isFinite(ndz.location_y)) continue;

      const ndzObjects = ndz.objects || [];
      // If zone has sub-objects with geometry, use the first one for position
      const size = 14;
      const icon = L.divIcon({
        className: '',
        html: `<div class="ndz-marker" style="width:${size}px;height:${size}px"></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });

      const marker = L.marker([ndz.location_y, ndz.location_x], { icon });
      marker.bindTooltip(`<b>No-Deploy Zone</b><br>${ndz.type || ''}`, {
        sticky: true,
        className: 'hex-tooltip'
      });
      marker.addTo(markerGroup);
    }

    // Draw main base markers from points.objectives
    const points = cp.points || {};
    const objectives = points.objectives || [];
    for (const obj of objectives) {
      if (!Number.isFinite(obj.location_x) || !Number.isFinite(obj.location_y)) continue;

      const isTeam1 = /team1/i.test(obj.objectName) || /team1/i.test(obj.objectDisplayName);
      const team = isTeam1 ? 'blufor' : 'redfor';
      const size = 28;
      const icon = L.divIcon({
        className: '',
        html: `<div class="obj-marker ${team}" style="width:${size}px;height:${size}px">M</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });

      const marker = L.marker([obj.location_y, obj.location_x], { icon });
      marker.bindTooltip(obj.objectDisplayName || obj.name || 'Main', {
        permanent: true,
        direction: 'top',
        offset: [0, -size / 2 - 2],
        className: 'obj-label'
      });
      marker.addTo(markerGroup);
    }
  }

  // ---- Draw Vehicle Spawners ----
  function drawVehicleSpawners(layer) {
    const assets = layer.assets || {};
    const spawners = assets.vehicleSpawners || [];

    for (const sp of spawners) {
      if (!Number.isFinite(sp.location_x) || !Number.isFinite(sp.location_y)) continue;

      // Determine team from spawner type
      const isTeam1 = /team\s*one/i.test(sp.type);
      const isTeam2 = /team\s*two/i.test(sp.type);
      const color = isTeam1 ? '#6b8e23' : isTeam2 ? '#a0522d' : '#808070';

      const iconSize = 10;
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:${iconSize}px;height:${iconSize}px;background:${color};border:1px solid rgba(255,255,255,0.6);border-radius:50%;opacity:0.7"></div>`,
        iconSize: [iconSize, iconSize],
        iconAnchor: [iconSize / 2, iconSize / 2]
      });

      const marker = L.marker(
        [sp.location_y, sp.location_x],
        { icon: icon }
      );

      let popupHtml = `<b>${escapeHtml(sp.name || sp.type || 'Spawner')}</b>`;
      if (sp.maxNum) popupHtml += `<br>Slots: ${sp.maxNum}`;
      marker.bindPopup(popupHtml);
      marker.addTo(markerGroup);
    }
  }

  function addArchetypeScores(target, entries) {
    for (const [key, value] of Object.entries(entries)) {
      target[key] = (target[key] || 0) + value;
    }
  }

  function getLayerExtentPoints(layer) {
    const points = [];

    (Array.isArray(layer.border) ? layer.border : []).forEach((point) => {
      if (Number.isFinite(point.location_x) && Number.isFinite(point.location_y)) {
        points.push({ x: point.location_x, y: point.location_y });
      }
    });

    Object.values(layer.objectives || {}).forEach((objective) => {
      const position = getObjectivePosition(objective);
      if (position) points.push(position);
    });

    ((layer.assets || {}).spawnGroups || []).forEach((spawn) => {
      if (Number.isFinite(spawn.location_x) && Number.isFinite(spawn.location_y)) {
        points.push({ x: spawn.location_x, y: spawn.location_y });
      }
    });

    return points;
  }

  function getLayerBoundsKm(layer) {
    const points = getLayerExtentPoints(layer);
    if (!points.length) {
      return { widthKm: 0, heightKm: 0, diagonalKm: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach((point) => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });

    const widthKm = (maxX - minX) / 100000;
    const heightKm = (maxY - minY) / 100000;
    return {
      widthKm,
      heightKm,
      diagonalKm: Math.hypot(widthKm, heightKm)
    };
  }

  function hasMapTraitHint(layer, tag) {
    const hintSet = MAP_TRAIT_HINTS[tag];
    return Boolean(hintSet && hintSet.has(layer.mapId));
  }

  function buildMapSuitability(layer) {
    const bounds = getLayerBoundsKm(layer);
    const sizeTier = bounds.diagonalKm >= 5 ? 'large' : bounds.diagonalKm >= 3.2 ? 'medium' : 'small';
    const sizeLabel = sizeTier === 'large' ? 'Large map' : sizeTier === 'medium' ? 'Medium map' : 'Compact map';
    const hasWater = (layer.depthMapTexture && layer.depthMapTexture !== 'NULL') || layer.boatsAvailable;

    const traitSet = new Set([sizeTier]);
    if (hasWater) traitSet.add('water');
    Object.keys(MAP_TRAIT_HINTS).forEach((tag) => {
      if (hasMapTraitHint(layer, tag)) traitSet.add(tag);
    });

    const offense = Object.fromEntries(DOCTRINE_KEYS.map((key) => [key, 0]));
    const defense = Object.fromEntries(DOCTRINE_KEYS.map((key) => [key, 0]));
    const watchouts = new Set();

    const waterHazard = (window.WATER_HAZARDS || {})[layer.mapId] || null;
    if (waterHazard) {
      watchouts.add(waterHazard.summary);
    }

    if (sizeTier === 'large') {
      addArchetypeScores(offense, { AirAssault: 26, Motorized: 20, CombinedArms: 16, Mechanized: 10, Armored: 6, Support: 4 });
      addArchetypeScores(defense, { CombinedArms: 16, LightInfantry: 14, Support: 12, Motorized: 10, Mechanized: 8, AirAssault: 6, Armored: 4 });
      watchouts.add('Heavy armor stalls on long rotations.');
    } else if (sizeTier === 'medium') {
      addArchetypeScores(offense, { CombinedArms: 14, Motorized: 12, Mechanized: 10, LightInfantry: 8, AirAssault: 8, Armored: 8, Support: 6 });
      addArchetypeScores(defense, { CombinedArms: 14, LightInfantry: 12, Support: 10, Mechanized: 8, Armored: 8, Motorized: 6, AirAssault: 4 });
    } else {
      addArchetypeScores(offense, { LightInfantry: 18, Support: 12, Mechanized: 10, CombinedArms: 8, Motorized: 6, Armored: 4 });
      addArchetypeScores(defense, { LightInfantry: 20, Support: 14, Mechanized: 10, CombinedArms: 8, Armored: 4, Motorized: 4 });
      watchouts.add('Compact layer — sustainment beats top speed.');
    }

    if (traitSet.has('water')) {
      const severity = waterHazard ? waterHazard.severity : 'moderate';
      if (severity === 'high') {
        addArchetypeScores(offense, { AirAssault: 12, Motorized: 4, CombinedArms: 6, LightInfantry: 2 });
        addArchetypeScores(defense, { LightInfantry: 4, Support: 6, CombinedArms: 5, Mechanized: 5 });
      } else if (severity === 'moderate') {
        addArchetypeScores(offense, { AirAssault: 8, Motorized: 6, CombinedArms: 5, LightInfantry: 4 });
        addArchetypeScores(defense, { LightInfantry: 6, Support: 6, CombinedArms: 4, Mechanized: 4 });
      } else {
        addArchetypeScores(offense, { AirAssault: 4, Motorized: 4, CombinedArms: 3, LightInfantry: 3 });
        addArchetypeScores(defense, { LightInfantry: 4, Support: 4, CombinedArms: 3, Mechanized: 3 });
      }
      if (!waterHazard) {
        watchouts.add('No air/boats = stuck on bridges.');
      }
    }
    if (traitSet.has('forest')) {
      addArchetypeScores(offense, { LightInfantry: 14, Mechanized: 10, Support: 8, Motorized: 4, CombinedArms: 4, Armored: -4 });
      addArchetypeScores(defense, { LightInfantry: 16, Support: 10, Mechanized: 8, CombinedArms: 6, Armored: -2 });
      watchouts.add('Short sightlines — infantry support matters more than gun size.');
    }
    if (traitSet.has('desert') || traitSet.has('open')) {
      addArchetypeScores(offense, { CombinedArms: 12, Armored: 10, Motorized: 8, AirAssault: 6, Mechanized: 6 });
      addArchetypeScores(defense, { CombinedArms: 10, Armored: 8, Support: 6, Mechanized: 6, LightInfantry: 4 });
      watchouts.add('Open ground — logis die fast, tempo swings hurt.');
    }
    if (traitSet.has('urban')) {
      addArchetypeScores(offense, { LightInfantry: 16, Support: 12, CombinedArms: 6, Mechanized: 4, Armored: -4 });
      addArchetypeScores(defense, { LightInfantry: 18, Support: 14, Mechanized: 6, CombinedArms: 6, Armored: -6 });
      watchouts.add('Dense compounds — armor needs infantry support.');
    }
    if (traitSet.has('mountain')) {
      addArchetypeScores(offense, { AirAssault: 16, LightInfantry: 12, Motorized: 8, CombinedArms: 4, Armored: -6 });
      addArchetypeScores(defense, { LightInfantry: 16, Support: 10, Mechanized: 6, AirAssault: 6, Armored: -4 });
      watchouts.add('Vertical terrain — air mobility wins, slow armor loses.');
    }
    if (traitSet.has('snow') || traitSet.has('wetland')) {
      addArchetypeScores(offense, { Mechanized: 8, Support: 6, CombinedArms: 6, LightInfantry: 4, Motorized: 2 });
      addArchetypeScores(defense, { Mechanized: 10, Support: 8, LightInfantry: 6, CombinedArms: 6 });
      watchouts.add('Soft ground — route flexibility beats raw speed.');
    }

    const offenseRanked = Object.entries(offense)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => ARCHETYPE_LABELS[key] || formatUnitType(key));
    const defenseRanked = Object.entries(defense)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => ARCHETYPE_LABELS[key] || formatUnitType(key));

    const traits = [sizeLabel];
    if (traitSet.has('water')) traits.push('Water');
    if (traitSet.has('forest')) traits.push('Forest');
    if (traitSet.has('desert')) traits.push('Desert');
    if (traitSet.has('urban')) traits.push('Urban');
    if (traitSet.has('mountain')) traits.push('Mountain');
    if (traitSet.has('snow')) traits.push('Snow');
    if (traitSet.has('wetland')) traits.push('Wet Ground');
    if (traitSet.has('open')) traits.push('Open Routes');

    return {
      diagonalKm: bounds.diagonalKm,
      sizeTier,
      traits,
      offenseKeys: offenseRanked.map((name) => Object.keys(ARCHETYPE_LABELS).find((key) => ARCHETYPE_LABELS[key] === name)).filter(Boolean),
      defenseKeys: defenseRanked.map((name) => Object.keys(ARCHETYPE_LABELS).find((key) => ARCHETYPE_LABELS[key] === name)).filter(Boolean),
      offense: offenseRanked,
      defense: defenseRanked,
      watchouts: Array.from(watchouts).slice(0, 4),
      traitSet,
      waterHazard
    };
  }

  function getCapabilityCounts(layer, teamKey) {
    return Object.fromEntries(getTeamVehicleCapabilities(layer, teamKey));
  }

  function getTeamFitTier(score) {
    if (score >= 69) return { label: 'Strong fit', tone: 'strong' };
    if (score >= 57) return { label: 'Good fit', tone: 'good' };
    if (score >= 45) return { label: 'Situational fit', tone: 'situational' };
    return { label: 'Poor fit', tone: 'poor' };
  }

  function evaluateTeamMapFit(layer, teamKey, selectedOption, mapSuitability) {
    const doctrines = getDoctrineSet(selectedOption);
    const capabilities = getCapabilityCounts(layer, teamKey);
    const helicopters = capabilities.Helicopters || 0;
    const heavyArmor = (capabilities['Heavy Armor'] || 0) + (capabilities.Armor || 0);
    const boats = capabilities.Boats || 0;
    const logistics = capabilities.Logistics || 0;
    const transport = capabilities.Transport || 0;
    const lightVehicles = capabilities['Light Vehicles'] || 0;
    const scoutMobility = capabilities['Scout Mobility'] || 0;
    const mobilityCount = logistics + transport + lightVehicles + scoutMobility;

    let score = 38;
    const strengths = [];
    const risks = [];

    if (mapSuitability.sizeTier === 'large') {
      if (helicopters > 0 || doctrines.has('AirAssault')) {
        score += 9;
        strengths.push('Air mobility');
      }
      if (mobilityCount >= 3 || doctrines.has('Motorized')) {
        score += 8;
        strengths.push('Mobile enough for large map');
      }
      if (helicopters === 0 && heavyArmor >= 3 && mobilityCount <= 1) {
        score -= 18;
        risks.push('Heavy and slow to rotate');
      }
    } else if (mapSuitability.sizeTier === 'small') {
      if (heavyArmor >= 3 && !doctrines.has('CombinedArms') && !doctrines.has('Mechanized')) {
        score -= 8;
        risks.push('Too much armor for compact layer');
      }
      if (doctrines.has('LightInfantry') || doctrines.has('Support')) {
        score += 6;
        strengths.push('Built for close fights');
      }
    }

    if (mapSuitability.traitSet.has('water')) {
      const wh = mapSuitability.waterHazard;
      const severity = wh ? wh.severity : 'moderate';
      if (boats > 0) {
        const bonus = severity === 'high' ? 10 : severity === 'moderate' ? 7 : 3;
        score += bonus;
        strengths.push('Boats bypass bridges');
      } else if (helicopters > 0) {
        if (severity === 'high') {
          score += 5;
          strengths.push('Air bypasses water');
        }
      } else {
        const penalty = severity === 'high' ? -14 : severity === 'moderate' ? -8 : -4;
        score += penalty;
        if (severity === 'high') {
          risks.push('No water bypass — forced to bridges');
        } else {
          risks.push('Limited water flanks');
        }
      }
    }

    if (mapSuitability.traitSet.has('forest')) {
      if (doctrines.has('LightInfantry') || doctrines.has('Support')) {
        score += 7;
        strengths.push('Fits short-sightline infantry');
      }
      if (heavyArmor >= 3 && !doctrines.has('LightInfantry')) {
        score -= 8;
        risks.push('Armor-heavy for forest');
      }
    }

    if (mapSuitability.traitSet.has('desert') || mapSuitability.traitSet.has('open')) {
      if (heavyArmor >= 2 || doctrines.has('CombinedArms') || doctrines.has('Armored')) {
        score += 8;
        strengths.push('Exploits open sightlines');
      }
      if (mobilityCount <= 1 && helicopters === 0) {
        score -= 10;
        risks.push('Slow to recover on open ground');
      }
    }

    if (mapSuitability.traitSet.has('urban')) {
      if (doctrines.has('LightInfantry') || doctrines.has('Support')) {
        score += 8;
        strengths.push('Infantry bias for compounds');
      }
      if (heavyArmor >= 3 && !doctrines.has('CombinedArms') && !doctrines.has('Mechanized')) {
        score -= 10;
        risks.push('Armor-heavy for urban');
      }
    }

    if (mapSuitability.traitSet.has('mountain')) {
      if (helicopters > 0 || doctrines.has('AirAssault') || doctrines.has('LightInfantry')) {
        score += 8;
        strengths.push('Handles vertical terrain');
      }
      if (heavyArmor >= 3 && helicopters === 0) {
        score -= 12;
        risks.push('Poor mountain mobility');
      }
    }

    if (mapSuitability.traitSet.has('snow') || mapSuitability.traitSet.has('wetland')) {
      if (logistics >= 1 || doctrines.has('Mechanized') || doctrines.has('Support')) {
        score += 5;
        strengths.push('Sustainment fits soft ground');
      } else {
        score -= 6;
        risks.push('May bog down on soft ground');
      }
    }

    const offenseMatches = mapSuitability.offenseKeys.filter((key) => doctrines.has(key)).length;
    const defenseMatches = mapSuitability.defenseKeys.filter((key) => doctrines.has(key)).length;
    score += offenseMatches * 4;
    score += defenseMatches * 3;
    if ((offenseMatches + defenseMatches) >= 3) {
      strengths.push('Matches preferred doctrines');
    } else if ((offenseMatches + defenseMatches) === 0) {
      score -= 8;
      risks.push('Poor doctrine match');
    }

    if (doctrines.size === 0) {
      score -= 4;
      risks.push('Unclear doctrine tagging');
    }

    const normalizedScore = Math.max(18, Math.min(92, Math.round(score)));
    const fitTier = getTeamFitTier(normalizedScore);

    return {
      score: normalizedScore,
      label: fitTier.label,
      tone: fitTier.tone,
      strengths: strengths.slice(0, 2),
      risks: risks.slice(0, 2)
    };
  }

  function getStrategyLaneSummary(layer) {
    const laneNames = getLaneNames(layer);
    if (!laneNames.length) return 'No lane graph on this layer';
    if (activeLane) return `Locked to ${activeLane}`;
    if (!activeTeam || captureSequence.length === 0) {
      if (activeTeam && stagingFocus) {
        const visibleLanes = getVisibleProgressionLanes(layer, activeTeam);
        const laneCount = visibleLanes ? Object.keys(visibleLanes).length : laneNames.length;
        return `Staging on ${getStagingFocusLabel(layer)} · ${laneCount} lane${laneCount === 1 ? '' : 's'} still fit`;
      }
      return `${laneNames.length} possible lanes before first cap`;
    }
    const remaining = getRemainingLanes(layer, captureSequence, activeTeam);
    const remainingCount = Object.keys(remaining).length;
    if (remainingCount === 0) return 'Free mode after capture sequence diverged';
    return `${remainingCount} likely lane${remainingCount === 1 ? '' : 's'} after ${captureSequence.length} capture${captureSequence.length === 1 ? '' : 's'}`;
  }

  function buildStrategyPriorities(layer, mapSuitability, teamFits) {
    const bullets = [];
    if (getLaneNames(layer).length && captureSequence.length === 0) {
      bullets.push(stagingFocus
        ? `Stage around ${getStagingFocusLabel(layer)}, stay flexible.`
        : 'Wait for first cap before committing heavy assets.');
    }
    if (mapSuitability.sizeTier === 'large') {
      bullets.push('Pre-stage logis and transport — long resets hurt.');
    }
    if (mapSuitability.traitSet.has('water')) {
      bullets.push("Keep a bypass route — don't rely on one bridge.");
    }
    if (mapSuitability.traitSet.has('urban')) {
      bullets.push('Infantry first on compounds, armor holds angles.');
    }
    if (mapSuitability.traitSet.has('forest')) {
      bullets.push('Short sightlines — overwatch beats gun size.');
    }
    if (mapSuitability.traitSet.has('desert') || mapSuitability.traitSet.has('open')) {
      bullets.push('Protect logis from long-range picks on open ground.');
    }
    const delta = teamFits.team1.score - teamFits.team2.score;
    if (Math.abs(delta) >= 10) {
      bullets.push(delta > 0
        ? 'Team 2 must disrupt tempo, not trade straight up.'
        : 'Team 1 must disrupt tempo, not trade straight up.');
    }
    if (!bullets.length) {
      bullets.push('Flexible opener, keep one reserve central.');
    }
    return bullets.slice(0, 4);
  }

  function getStrategyGuideGamemode(layer) {
    const value = String(layer.Gamemode || layer.GameMode || '').toUpperCase();
    if (value.includes('RAAS')) return 'RAAS';
    if (value.includes('AAS')) return 'AAS';
    if (value.includes('INVASION')) return 'INVASION';
    if (value.includes('TC')) return 'TC';
    if (value.includes('INSURGENCY')) return 'INSURGENCY';
    return value || 'UNKNOWN';
  }

  function buildStrategyGuideContext(layer, mapSuitability, teamFits) {
    const situations = new Set(['spawnNetwork']);
    const laneNames = getLaneNames(layer);
    const matchupDelta = teamFits.team1.score - teamFits.team2.score;

    if (laneNames.length) situations.add('lanePlay');
    if (laneNames.length && captureSequence.length === 0) situations.add('laneUncertainty');
    if (mapSuitability.sizeTier === 'large' || mapSuitability.traitSet.has('water') || mapSuitability.traitSet.has('open')) {
      situations.add('mobilityReset');
    }
    if (mapSuitability.traitSet.has('urban')) situations.add('compoundAssault');
    if (mapSuitability.traitSet.has('urban') || mapSuitability.traitSet.has('forest') || mapSuitability.traitSet.has('open')) {
      situations.add('supportByFire');
    }
    if (Math.abs(matchupDelta) >= 10) situations.add('disruption');

    return {
      gamemode: getStrategyGuideGamemode(layer),
      sizeTier: mapSuitability.sizeTier,
      traits: new Set(Array.from(mapSuitability.traitSet)),
      situations,
    };
  }

  function formatStrategyGuideReason(reason) {
    const labels = {
      small: 'Small map',
      medium: 'Medium map',
      large: 'Large map',
      urban: 'Urban',
      forest: 'Forest',
      open: 'Open ground',
      desert: 'Desert',
      wetland: 'Wetland',
      water: 'Water crossing',
      mountain: 'Mountain',
      snow: 'Snow',
      laneUncertainty: 'Lane uncertainty',
      mobilityReset: 'Long reset risk',
      spawnNetwork: 'Spawn network',
      compoundAssault: 'Compound assault',
      supportByFire: 'Support-by-fire',
      disruption: 'Disruption window',
      RAAS: 'RAAS',
      AAS: 'AAS',
      INVASION: 'Invasion',
      TC: 'TC',
      INSURGENCY: 'Insurgency'
    };
    return labels[reason] || reason;
  }

  function getStrategyGuideMatches(layer, mapSuitability, teamFits) {
    const context = buildStrategyGuideContext(layer, mapSuitability, teamFits);
    return STRATEGY_GUIDES.map((guide) => {
      let score = 0;
      const reasons = [];

      if ((guide.sizeTiers || []).includes(context.sizeTier)) {
        score += 2;
        reasons.push(context.sizeTier);
      }

      if ((guide.gamemodes || []).includes(context.gamemode)) {
        score += 1;
        reasons.push(context.gamemode);
      }

      for (const trait of (guide.traits || [])) {
        if (context.traits.has(trait)) {
          score += 2;
          reasons.push(trait);
        }
      }

      for (const situation of (guide.situations || [])) {
        if (context.situations.has(situation)) {
          score += 3;
          reasons.push(situation);
        }
      }

      return {
        guide,
        score,
        reasons: Array.from(new Set(reasons)).slice(0, 4)
      };
    })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
  }

  function buildStrategyGuideSection(layer, mapSuitability, teamFits) {
    const matches = getStrategyGuideMatches(layer, mapSuitability, teamFits);
    if (!matches.length) return '';

    return `<section class="strategy-section">
      <div class="strategy-section-title">Guide Signals</div>
      <div class="strategy-guide-grid">${matches.map(({ guide, reasons }) => `<article class="strategy-guide-card">
        <div class="strategy-guide-header">
          <div>
            <div class="strategy-guide-title">${escapeHtml(guide.title)}</div>
            <div class="strategy-guide-source">${escapeHtml(guide.channel)}</div>
          </div>
          <a class="strategy-guide-link" href="${guide.url}" target="_blank" rel="noreferrer">Source</a>
        </div>
        <ul class="strategy-list strategy-guide-list">${guide.heuristics.slice(0, 2).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <div class="strategy-chip-row">${reasons.map((reason) => `<span class="strategy-chip strategy-chip-guide">${escapeHtml(formatStrategyGuideReason(reason))}</span>`).join('')}</div>
      </article>`).join('')}</div>
    </section>`;
  }

  function buildStrategyLiveObjectiveSection(layer) {
    const liveState = getLiveObjectiveState(layer);
    if (!liveState) return '';
    return `<section class="strategy-section">
      <div class="strategy-section-title">Live Match</div>
      <div class="strategy-card">${buildLiveObjectiveSummaryHtml(liveState)}</div>
    </section>`;
  }

  function buildStrategyDrawerHtml(layer) {
    const tc = layer.teamConfigs || {};
    const mapSuitability = buildMapSuitability(layer);
    const team1Option = getSelectedTeamOption(layer, 'team1');
    const team2Option = getSelectedTeamOption(layer, 'team2');
    const team1Config = tc.team1 || {};
    const team2Config = tc.team2 || {};
    const teamFits = {
      team1: evaluateTeamMapFit(layer, 'team1', team1Option, mapSuitability),
      team2: evaluateTeamMapFit(layer, 'team2', team2Option, mapSuitability),
    };
    const liveObjectiveSection = buildStrategyLiveObjectiveSection(layer);
    const priorities = buildStrategyPriorities(layer, mapSuitability, teamFits);
    const guideSection = buildStrategyGuideSection(layer, mapSuitability, teamFits);
    const matchupDelta = teamFits.team1.score - teamFits.team2.score;
    const matchupLine = Math.abs(matchupDelta) < 6
      ? 'Matchup is even on paper — execution decides.'
      : matchupDelta > 0
        ? 'Team 1 fits this map better on paper.'
        : 'Team 2 fits this map better on paper.';

    const buildTeamCard = (label, option, config, fit) => {
      const factionId = option?.factionID || extractFactionId(config.defaultFactionUnit);
      const factionName = FACTION_NAMES[factionId] || factionId || label;
      const detailPoints = fit.strengths.length ? fit.strengths : fit.risks;
      const detailTone = fit.strengths.length ? 'positive' : 'warning';
      return `<div class="strategy-team-card">
        <div class="strategy-team-header">
          <div class="strategy-team-name">${escapeHtml(label)} · ${escapeHtml(factionName)}</div>
          <span class="fit-badge ${fit.tone}">${fit.label}</span>
        </div>
        <div class="strategy-team-subtitle">Score ${fit.score}/100 · ${escapeHtml(option?.defaultUnit || config.defaultFactionUnit || 'No default unit listed')}</div>
        ${detailPoints.length ? `<div class="team-fit-points">${detailPoints.map((point) => `<div class="team-fit-point ${detailTone}">${escapeHtml(point)}</div>`).join('')}</div>` : ''}
      </div>`;
    };

    const watchoutsHtml = mapSuitability.watchouts.length
      ? `<ul class="strategy-watchouts">${mapSuitability.watchouts.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
      : '';

    return `
      ${liveObjectiveSection}
      <section class="strategy-section">
        <div class="strategy-section-title">Situation</div>
        <div class="strategy-card">
          <div class="strategy-context-grid">
            <div class="strategy-kv">
              <span class="strategy-kv-label">Layer</span>
              <span class="strategy-kv-value">${escapeHtml(layer.Name)}</span>
            </div>
            <div class="strategy-kv">
              <span class="strategy-kv-label">Lane State</span>
              <span class="strategy-kv-value">${escapeHtml(getStrategyLaneSummary(layer))}</span>
            </div>
          </div>
          <div class="strategy-chip-row" style="margin-top:10px;">${mapSuitability.traits.map((trait) => `<span class="strategy-chip">${escapeHtml(trait)}</span>`).join('')}</div>
          <div class="strategy-lead" style="margin-top:10px;">${escapeHtml(matchupLine)}</div>
          ${watchoutsHtml}
        </div>
      </section>
      <section class="strategy-section">
        <div class="strategy-section-title">Opening Priorities</div>
        <div class="strategy-card">
          <ul class="strategy-list">${priorities.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>
      </section>
      ${guideSection}
      <section class="strategy-section">
        <div class="strategy-section-title">Team Read</div>
        <div class="strategy-team-grid">
          ${buildTeamCard('Team 1', team1Option, team1Config, teamFits.team1)}
          ${buildTeamCard('Team 2', team2Option, team2Config, teamFits.team2)}
        </div>
      </section>`;
  }

  function setStrategyDrawerOpen(isOpen) {
    strategyDrawerOpen = !!isOpen;
    const drawer = document.getElementById('strategy-drawer');
    const scrim = document.getElementById('strategy-drawer-scrim');
    const toggle = document.getElementById('strategy-drawer-toggle');
    if (drawer) {
      drawer.classList.toggle('open', strategyDrawerOpen);
      drawer.setAttribute('aria-hidden', strategyDrawerOpen ? 'false' : 'true');
    }
    if (scrim) scrim.classList.toggle('hidden', !strategyDrawerOpen);
    if (toggle) toggle.setAttribute('aria-expanded', strategyDrawerOpen ? 'true' : 'false');
  }

  function renderStrategyDrawer(layer) {
    const content = document.getElementById('strategy-drawer-content');
    if (!content || !layer) return;
    content.innerHTML = buildStrategyDrawerHtml(layer);
  }

  function buildMapInfoSection(layer) {
    const fit = buildMapSuitability(layer);
    const gm = GAMEMODE_LABELS[layer.gamemode] || layer.gamemode;
    const metaParts = [];
    if (layer.mapSize) metaParts.push(escapeHtml(layer.mapSize));
    if (gm) metaParts.push(escapeHtml(gm));
    if (fit.diagonalKm) metaParts.push(`${fit.diagonalKm.toFixed(1)} km diagonal`);
    if (layer.commanderDisabled) metaParts.push('Commander off');

    return `<div class="detail-section">
      <h4>Map</h4>
      <div class="map-fit-meta">${metaParts.join(' · ')}</div>
    </div>`;
  }

  // ---- Layer Details ----
  function renderDetails(layer) {
    const content = document.getElementById('detail-content');
    const tc = layer.teamConfigs || {};
    const assets = layer.assets || {};

    let html = '';

    html += buildMapInfoSection(layer);

    // Team 1 info
    const t1 = tc.team1 || {};
    const team1Option = getSelectedTeamOption(layer, 'team1');
    html += buildTeamDetail('Team 1', team1Option, t1, layer);

    // Team 2 info
    const t2 = tc.team2 || {};
    const team2Option = getSelectedTeamOption(layer, 'team2');
    html += buildTeamDetail('Team 2', team2Option, t2, layer);

    // Deployables
    const deployables = assets.deployables || [];
    if (deployables.length > 0) {
      html += `<div class="detail-section"><h4>Deployables (${deployables.length})</h4>`;
      const byType = {};
      for (const d of deployables) {
        const key = d.type || 'Unknown';
        byType[key] = (byType[key] || 0) + 1;
      }
      html += '<div class="vehicle-list">';
      for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
        html += `<div class="vehicle-item">
          <span class="veh-count">${count}x</span>
          <span class="veh-name">${escapeHtml(type)}</span>
        </div>`;
      }
      html += '</div></div>';
    }

    content.innerHTML = html;
  }

  function getSpawnerTeamKey(spawner) {
    const team = String(spawner.team || '').toLowerCase();
    if (team.includes('one')) return 'team1';
    if (team.includes('two')) return 'team2';

    const name = String(spawner.name || '').toLowerCase();
    if (name.startsWith('team1')) return 'team1';
    if (name.startsWith('team2')) return 'team2';
    return null;
  }

  function categorizeVehicleSpawner(spawner) {
    const source = `${spawner.name || ''} ${spawner.type || ''}`.toLowerCase();
    if (/(helicopter|heli|\buh\b|\bmi\b)/.test(source)) return 'Helicopters';
    if (/(boat|rhib|aav)/.test(source)) return 'Boats';
    if (/(mbt|sprutsdm|ztd)/.test(source)) return 'Heavy Armor';
    if (/(apc|bmp|bmd|btr|lav|zbl|zbd|zsd|zsl|mtlb|brdm)/.test(source)) return 'Armor';
    if (/(lightarmor|matv|cskqj|tigr|carsize|groundany|forwardany)/.test(source)) return 'Light Vehicles';
    if (/(logi|logistics|ctm|kamazlogi)/.test(source)) return 'Logistics';
    if (/(transport|car|kamaztransport)/.test(source)) return 'Transport';
    if (/(bike|quad)/.test(source)) return 'Scout Mobility';
    return 'Support Vehicles';
  }

  function getTeamVehicleCapabilities(layer, teamKey) {
    const spawners = (layer.assets || {}).vehicleSpawners || [];
    const counts = {};
    for (const spawner of spawners) {
      if (getSpawnerTeamKey(spawner) !== teamKey) continue;
      const category = categorizeVehicleSpawner(spawner);
      counts[category] = (counts[category] || 0) + 1;
    }

    const order = [
      'Helicopters',
      'Heavy Armor',
      'Armor',
      'Light Vehicles',
      'Logistics',
      'Transport',
      'Scout Mobility',
      'Boats',
      'Support Vehicles'
    ];

    return Object.entries(counts)
      .sort((a, b) => {
        const aIndex = order.indexOf(a[0]);
        const bIndex = order.indexOf(b[0]);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex) || b[1] - a[1];
      });
  }

  function getUnitVehicleList(layer, selectedOption, teamConfig) {
    const byUnit = layer.vehiclesByUnit || {};
    const unitKey = selectedOption?.defaultUnit || teamConfig?.defaultFactionUnit || '';
    return byUnit[unitKey] || [];
  }

  function formatRespawnTime(min) {
    if (!Number.isFinite(min) || min <= 0) return '';
    if (min >= 1) return `${Number.isInteger(min) ? min : min.toFixed(1)} min`;
    return `${Math.round(min * 60)}s`;
  }

  function buildTeamDetail(label, selectedOption, teamConfig, layer) {
    const factionId = selectedOption?.factionID || extractFactionId(teamConfig.defaultFactionUnit);
    const vehicles = getUnitVehicleList(layer, selectedOption, teamConfig);
    const tickets = teamConfig.tickets || '?';

    let html = `<div class="detail-section"><h4>${label} – ${FACTION_NAMES[factionId] || factionId}</h4>
      <div class="team-detail-header">
        <span class="team-detail-tickets">${tickets} tickets</span>
      </div>`;
    if (vehicles.length) {
      const totalCount = vehicles.reduce((sum, v) => sum + (v.count || 0), 0);
      html += `<div class="vehicle-capability-label">Vehicles (${totalCount})</div>
      <div class="vehicle-list">${vehicles.map((v) => {
        const resp = formatRespawnTime(v.respawnMin);
        const delay = Number.isFinite(v.initialDelayMin) && v.initialDelayMin > 0
          ? ` <span class="veh-delay">· +${v.initialDelayMin}m start</span>` : '';
        return `<div class="vehicle-item">
          <span class="veh-count">${v.count}x</span>
          <span class="veh-name">${escapeHtml(v.name)}</span>
          ${resp ? `<span class="veh-respawn">${escapeHtml(resp)}</span>` : ''}${delay}
        </div>`;
      }).join('')}</div>`;
    }
    html += '</div>';
    return html;
  }

  // ---- Go Back ----
  function goBack() {
    clearAllHabs();
    // Reset mortar tool state
    clearMortar();
    closeMapContextMenu();
    setStrategyDrawerOpen(false);

    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }
    setLeftSidebarOpen(false);
    document.getElementById('map-view').classList.add('hidden');
    document.getElementById('map-grid').classList.remove('hidden');
    currentMapId = null;
    window.location.hash = '';
  }

  function setLeftSidebarOpen(open) {
    leftSidebarOpen = !!open;
    const mapViewBody = document.querySelector('.map-view-body');
    const sidebar = document.getElementById('left-sidebar');
    const tab = document.getElementById('left-sidebar-tab');
    if (mapViewBody) {
      mapViewBody.classList.toggle('sidebar-open', leftSidebarOpen);
      mapViewBody.classList.toggle('sidebar-collapsed', !leftSidebarOpen);
    }
    if (sidebar) {
      sidebar.classList.toggle('sidebar-open', leftSidebarOpen);
      sidebar.classList.toggle('sidebar-collapsed', !leftSidebarOpen);
    }
    if (tab) {
      tab.setAttribute('aria-expanded', leftSidebarOpen ? 'true' : 'false');
      tab.title = leftSidebarOpen ? 'Hide layers panel' : 'Show layers panel';
    }
  }

  // ---- Hash Routing ----
  function handleHash() {
    const hash = window.location.hash;
    if (!hash || hash === '#') return;

    // Format: #/MapId/layerRawName
    const parts = hash.replace('#/', '').split('/');
    if (parts.length >= 1 && parts[0]) {
      const mapId = parts[0];
      const layerRaw = parts[1] || null;
      if (mapGroups[mapId]) {
        openMap(mapId, layerRaw);
      }
    }
  }

  // ---- Events ----
  function initHabLayer() {
    if (habLayerGroup) {
      habLayerGroup.clearLayers();
    }
    habLayerGroup = L.layerGroup().addTo(leafletMap);
    placedHabs = [];
  }

  function handleMapDblClick(e) {
    // Double-click anywhere: mortar placement. First dblclick = mortar,
    // next = target, further = move target. FOB tool is independent and
    // still uses single click.
    const latlng = e.latlng;
    const ueX = latlng.lng;
    const ueY = latlng.lat;
    handleMortarDblClick(ueX, ueY);
  }

  // ---------------------------------------------------------------------
  // Indirect-fire tool
  // ---------------------------------------------------------------------

  async function loadHeightmap(layer) {
    const key = HEIGHTMAP_FILES[layer.mapId];
    if (!key) return null;
    if (heightmapCache[key]) return heightmapCache[key];
    try {
      const res = await fetch(`data/heightmaps/${key}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      heightmapCache[key] = data;
      return data;
    } catch (err) {
      console.warn('heightmap load failed', key, err);
      return null;
    }
  }

  function getHeightmapBounds(layer) {
    const corners = layer.mapTextureCorners || [];
    if (corners.length < 2) return null;
    const xs = corners.map(c => c.location_x);
    const ys = corners.map(c => c.location_y);
    return {
      xmin: Math.min(...xs), xmax: Math.max(...xs),
      ymin: Math.min(...ys), ymax: Math.max(...ys),
    };
  }

  // Heightmap row/col lookup with bilinear interpolation.
  // `data` is 500x500 float meters. `worldX`/`worldY` are UE units.
  function sampleHeight(data, layer, worldX, worldY) {
    if (!data || !data.length) return 0;
    const b = getHeightmapBounds(layer);
    if (!b) return 0;
    const rows = data.length;
    const cols = data[0].length;
    const col = ((worldX - b.xmin) / (b.xmax - b.xmin)) * (cols - 1);
    // Row 0 is at ymax (north) — UE +Y is north in our Leaflet setup.
    const row = ((b.ymax - worldY) / (b.ymax - b.ymin)) * (rows - 1);
    if (col < 0 || col > cols - 1 || row < 0 || row > rows - 1) return 0;
    const r0 = Math.floor(row), r1 = Math.min(rows - 1, r0 + 1);
    const c0 = Math.floor(col), c1 = Math.min(cols - 1, c0 + 1);
    const fr = row - r0, fc = col - c0;
    const h00 = data[r0][c0], h01 = data[r0][c1];
    const h10 = data[r1][c0], h11 = data[r1][c1];
    return (1 - fr) * ((1 - fc) * h00 + fc * h01) +
                fr  * ((1 - fc) * h10 + fc * h11);
  }

  function getActiveWeapon() {
    return WEAPONS[activeWeaponId];
  }

  function getActiveShell() {
    return getActiveWeapon().shells[activeShellIdx];
  }

  function getActiveShellDerived() {
    return getActiveWeapon()._shellDerived[activeShellIdx];
  }

  function getWeaponVelocity(weapon, shellIdx, distanceM) {
    const shell = weapon.shells[shellIdx];
    const derived = weapon._shellDerived[shellIdx];
    if (!derived || derived.decelerationDistance === 0) return shell.velocity;
    if (distanceM <= derived.decelerationDistance) {
      const discriminant = Math.sqrt((shell.velocity * shell.velocity) + (2 * weapon.deceleration * distanceM));
      const t = (-shell.velocity + discriminant) / weapon.deceleration;
      return shell.velocity - weapon.deceleration * t;
    }
    const finalVelocity = shell.velocity - weapon.deceleration * weapon.decelerationTime;
    const distanceAfterDeceleration = distanceM - derived.decelerationDistance;
    const timeAfterDeceleration = distanceAfterDeceleration / finalVelocity;
    const totalTime = weapon.decelerationTime + timeAfterDeceleration;
    return distanceM / totalTime;
  }

  function getWeaponMaxRangeM() {
    return getActiveShellDerived().maxDistanceM;
  }

  function getTimeOfFlight(rad, velocity, gravity, heightDiff) {
    if (!Number.isFinite(rad)) return NaN;
    let t = velocity * Math.sin(rad) + Math.sqrt(
      (velocity * velocity * Math.sin(rad) * Math.sin(rad)) + (2 * gravity * -heightDiff)
    );
    if (Number.isNaN(t)) {
      t = velocity * Math.sin(rad) + Math.sqrt(velocity * velocity * Math.sin(rad) * Math.sin(rad));
    }
    return t / gravity;
  }

  function formatElevation(rad, unit) {
    if (!Number.isFinite(rad)) return '';
    if (unit === 'mil') return `${(rad * 3200 / Math.PI).toFixed(0)} mil`;
    if (unit === 'deg') return `${(rad * 180 / Math.PI).toFixed(1)}°`;
    const totalMinutes = Math.round((rad * 180 / Math.PI) * 60);
    const sign = totalMinutes < 0 ? '-' : '';
    const absMinutes = Math.abs(totalMinutes);
    const degrees = Math.floor(absMinutes / 60);
    const minutes = absMinutes % 60;
    return `${sign}${degrees}°${minutes}'`;
  }

  function getDisplayBranch(sol) {
    if (!sol || !sol.inRange || !sol.primary) return null;
    if (sol.primary.valid) return sol.primary;
    if (sol.primary === sol.high && sol.low && sol.low.valid && sol.high && sol.high.valid) {
      return sol.low;
    }
    return null;
  }

  function getUnitLabel(unit) {
    if (unit === 'mil') return 'Mils';
    if (unit === 'degMin') return 'Deg/Min';
    return 'Degrees';
  }

  function formatShellLabel(name, index) {
    const fallback = name || `Shell ${index + 1}`;
    return fallback
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function updateMortarSummary() {
    const el = document.getElementById('mortar-summary');
    if (!el) return;
    if (!mortarPosition) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    const weapon = getActiveWeapon();
    const shell = getActiveShell();
    const shellLabel = weapon.shells.length > 1 ? formatShellLabel(shell.name, activeShellIdx) : 'Default';
    el.classList.remove('hidden');
    el.innerHTML = [
      ['Source', weapon.source || 'Unknown'],
      ['Ammo', shellLabel],
      ['Unit', getUnitLabel(weapon.unit)],
      ['Range', `${Math.round(getWeaponMaxRangeM())}m max`],
      ['Blast', `${shell.explosionRadius[1]}m`],
    ].map(([label, value]) => `
      <span class="mortar-chip">
        <span class="mortar-chip-label">${label}</span>
        <span class="mortar-chip-value">${value}</span>
      </span>
    `).join('');
  }

  function computeFiringSolution(weapon, shellIdx, mortar, target, hMortar, hTarget) {
    // UE units to meters
    const dxM = (target.ueX - mortar.ueX) / 100;
    const dyM = (target.ueY - mortar.ueY) / 100;
    const dist = Math.hypot(dxM, dyM);
    // Bearing: 0deg = North (+Y), 90deg = East (+X), clockwise
    let bearing = Math.atan2(dxM, dyM) * 180 / Math.PI;
    if (bearing < 0) bearing += 360;

    const shell = weapon.shells[shellIdx];
    const v = getWeaponVelocity(weapon, shellIdx, dist);
    const g = GRAVITY * weapon.gravityScale;
    const hDiff = hTarget - (hMortar + (weapon.heightOffset || 0));
    const v2 = v * v;
    const v4 = v2 * v2;
    const inner = v4 - g * (g * dist * dist + 2 * hDiff * v2);

    const result = {
      dist,
      bearing,
      hDiff,
      hMortar,
      hTarget,
      unit: weapon.unit,
      minDistanceM: shell.minDistance,
      belowMin: dist < shell.minDistance,
      inRange: false,
      low: null,
      high: null,
      primary: null,
    };
    if (inner < 0 || dist <= 0) return result;

    const P = Math.sqrt(inner);
    const angleOffsetRad = (weapon.angleOffset || 0) * Math.PI / 180;
    const lowRad = Math.atan((v2 - P) / (g * dist)) - angleOffsetRad;
    const highRad = Math.atan((v2 + P) / (g * dist)) - angleOffsetRad;
    const toDeg = (r) => r * 180 / Math.PI;
    const buildBranch = (rad) => {
      const deg = toDeg(rad);
      const tof = getTimeOfFlight(rad, v, g, hDiff);
      const valid = Number.isFinite(rad) &&
        deg >= weapon.minElevation[0] &&
        deg <= weapon.minElevation[1] &&
        Number.isFinite(tof) &&
        tof <= weapon.projectileLifespan;
      return {
        valid,
        rad,
        deg,
        mil: rad * 3200 / Math.PI,
        tof,
      };
    };

    result.low = buildBranch(lowRad);
    result.high = buildBranch(highRad);
    result.primary = weapon.angleType === 'low' ? result.low : result.high;
    result.inRange = !!((result.low && result.low.valid) || (result.high && result.high.valid));
    return result;
  }

  function initMortarLayer() {
    if (mortarLayerGroup) mortarLayerGroup.clearLayers();
    mortarLayerGroup = L.layerGroup().addTo(leafletMap);
    mortarPosition = null;
    targetPositions = [];
  }

  async function handleMortarDblClick(ueX, ueY) {
    const layer = currentLayer();
    if (!layer) return;
    const hm = await loadHeightmap(layer);
    if (!hm) return;  // silent; some maps we don't have heightmaps for
    // First dblclick = mortar. Each subsequent dblclick adds a new target.
    if (!mortarPosition) {
      mortarPosition = { ueX, ueY };
      targetPositions = [];
    } else {
      targetPositions.push({ ueX, ueY });
    }
    renderMortarOverlay(hm, layer);
  }

  function clearMortar() {
    if (mortarLayerGroup) mortarLayerGroup.clearLayers();
    mortarPosition = null;
    targetPositions = [];
    mortarRefs.marker = null;
    mortarRefs.rangeCircle = null;
    mortarRefs.targets = [];
    const panel = document.getElementById('mortar-panel');
    if (panel) panel.classList.add('hidden');
  }

  // ---------------------------------------------------------------------
  // Right-click context menu (GIS-style tool picker)
  // ---------------------------------------------------------------------

  function openMapContextMenu(e) {
    if (e.originalEvent) e.originalEvent.preventDefault();
    const menu = document.getElementById('map-context-menu');
    if (!menu) return;
    ctxMenuLatLng = e.latlng;

    // Update enabled state based on current tool state.
    const hasMortar = !!mortarPosition;
    const hasHabs = placedHabs.length > 0;
    const hasMortarAny = !!mortarPosition || targetPositions.length > 0;
    menu.querySelector('[data-action="mortar-target"]').disabled = !hasMortar;
    menu.querySelector('[data-action="clear-habs"]').disabled = !hasHabs;
    menu.querySelector('[data-action="clear-mortar"]').disabled = !hasMortarAny;

    // Unhide first so we can measure, then clamp to the map container.
    menu.classList.remove('hidden');
    const container = leafletMap.getContainer();
    const rect = container.getBoundingClientRect();
    const rawX = e.originalEvent.clientX - rect.left;
    const rawY = e.originalEvent.clientY - rect.top;
    const menuRect = menu.getBoundingClientRect();
    let x = rawX;
    let y = rawY;
    if (x + menuRect.width > rect.width) x = rect.width - menuRect.width - 4;
    if (y + menuRect.height > rect.height) y = rect.height - menuRect.height - 4;
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;
  }

  function closeMapContextMenu() {
    const menu = document.getElementById('map-context-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    menu.classList.add('hidden');
    ctxMenuLatLng = null;
    // Swallow the follow-up Leaflet click so dismissing the menu by clicking
    // empty map doesn't also place a FOB (when the legacy FOB tool is active).
    ctxMenuJustClosed = true;
    setTimeout(() => { ctxMenuJustClosed = false; }, 50);
  }

  async function handleMapContextAction(action) {
    if (!ctxMenuLatLng) return;
    const latlng = ctxMenuLatLng;
    closeMapContextMenu();
    const ueX = latlng.lng;
    const ueY = latlng.lat;
    switch (action) {
      case 'hab':
        placeHab(ueX, ueY, 'team1');
        break;
      case 'mortar-place': {
        const layer = currentLayer();
        if (!layer) return;
        const hm = await loadHeightmap(layer);
        if (!hm) return;
        clearMortar();
        mortarPosition = { ueX, ueY };
        targetPositions = [];
        renderMortarOverlay(hm, layer);
        break;
      }
      case 'mortar-target': {
        const layer = currentLayer();
        if (!layer || !mortarPosition) return;
        const hm = await loadHeightmap(layer);
        if (!hm) return;
        targetPositions.push({ ueX, ueY });
        renderMortarOverlay(hm, layer);
        break;
      }
      case 'clear-habs':
        clearAllHabs();
        break;
      case 'clear-mortar':
        clearMortar();
        break;
    }
  }

  // Gold reticle centered exactly on the weapon position. Anchor is the
  // geometric centre so firing solutions, range circle and heightmap sample
  // all reference the same point the user sees.
  function mortarIcon() {
    const weapon = getActiveWeapon();
    return L.divIcon({
      className: '',
      html: `<div class="mortar-marker" title="${weapon.displayName}">
        <svg viewBox="0 0 26 26" width="26" height="26">
          <circle class="reticle-ring" cx="13" cy="13" r="10"/>
          <line class="reticle-tick" x1="13" y1="1" x2="13" y2="6"/>
          <line class="reticle-tick" x1="13" y1="20" x2="13" y2="25"/>
          <line class="reticle-tick" x1="1" y1="13" x2="6" y2="13"/>
          <line class="reticle-tick" x1="20" y1="13" x2="25" y2="13"/>
          <circle class="reticle-dot" cx="13" cy="13" r="1.5"/>
        </svg>
      </div>`,
      iconSize: [26, 26], iconAnchor: [13, 13],
    });
  }

  function targetIcon(inRange) {
    // Centered red dot — the anchor IS the target. Damage radius ring lives
    // separately in renderMortarOverlay so it stays fixed on the same point.
    return L.divIcon({
      className: '',
      html: `<div class="target-pin ${inRange ? '' : 'oor'}">
        <svg viewBox="0 0 14 14" width="14" height="14">
          <circle class="target-dot" cx="7" cy="7" r="5"/>
          <circle class="target-pip" cx="7" cy="7" r="1.2"/>
        </svg>
      </div>`,
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
  }

  function targetTooltipHtml(sol) {
    const dist = `${Math.round(sol.dist)}m`;
    const bear = `${sol.bearing.toFixed(0)}°`;
    const branch = getDisplayBranch(sol);
    let elev = '<span class="mortar-oor-tt">OOR</span>';
    if (sol.belowMin) elev = '<span class="mortar-oor-tt">MIN</span>';
    else if (branch) elev = formatElevation(branch.rad, sol.unit);
    return `${dist}<br>${bear}<br>${elev}`;
  }

  function rebuildWeaponSelect() {
    const select = document.getElementById('weapon-select');
    if (!select) return;
    const groups = new Map();
    select.innerHTML = '';
    for (const weaponId of WEAPON_IDS) {
      const weapon = WEAPONS[weaponId];
      const groupLabel = weapon.source || (weapon.category === 'base' ? 'Vanilla Squad' : 'Game Mods');
      if (!groups.has(groupLabel)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = groupLabel;
        groups.set(groupLabel, optgroup);
      }
      const option = document.createElement('option');
      option.value = weaponId;
      option.textContent = weapon.displayName;
      groups.get(groupLabel).appendChild(option);
    }
    for (const optgroup of groups.values()) {
      select.appendChild(optgroup);
    }
    select.value = activeWeaponId;
  }

  function rebuildShellSelect() {
    const row = document.querySelector('.mortar-shell-row');
    const select = document.getElementById('mortar-shell-select');
    const weapon = getActiveWeapon();
    if (!row || !select || !weapon) return;
    if (activeShellIdx >= weapon.shells.length) activeShellIdx = 0;
    select.innerHTML = '';
    if (weapon.shells.length <= 1) {
      row.classList.add('hidden');
      return;
    }
    row.classList.remove('hidden');
    weapon.shells.forEach((shell, idx) => {
      const option = document.createElement('option');
      option.value = String(idx);
      option.textContent = formatShellLabel(shell.name, idx);
      select.appendChild(option);
    });
    select.value = String(activeShellIdx);
  }

  // Compute solutions for every target from the current mortar + heightmap,
  // returning a parallel array aligned with targetPositions.
  function computeAllSolutions(hm, layer) {
    if (!mortarPosition || !hm) return [];
    const weapon = getActiveWeapon();
    const hMortar = sampleHeight(hm, layer, mortarPosition.ueX, mortarPosition.ueY);
    return targetPositions.map((t) => {
      const hTarget = sampleHeight(hm, layer, t.ueX, t.ueY);
      return computeFiringSolution(weapon, activeShellIdx, mortarPosition, t, hMortar, hTarget);
    });
  }

  // Recompute solutions and update every dependent visual (range circle
  // center, lines, target tooltips, result panel) in place — no full
  // re-render so drag state survives.
  function refreshMortarVisuals(hm, layer) {
    if (!mortarLayerGroup || !mortarPosition) return;
    const shell = getActiveShell();
    updateMortarSummary();
    if (mortarRefs.rangeCircle) {
      mortarRefs.rangeCircle.setLatLng([mortarPosition.ueY, mortarPosition.ueX]);
      mortarRefs.rangeCircle.setRadius(getWeaponMaxRangeM() * 100);
    }
    if (mortarRefs.marker) {
      const markerEl = mortarRefs.marker.getElement();
      if (markerEl) {
        const icon = markerEl.querySelector('.mortar-marker');
        if (icon) icon.setAttribute('title', getActiveWeapon().displayName);
      }
    }
    const sols = computeAllSolutions(hm, layer);
    for (let i = 0; i < mortarRefs.targets.length; i++) {
      const ref = mortarRefs.targets[i];
      const sol = sols[i];
      const t = targetPositions[i];
      if (!ref || !sol || !t) continue;
      if (ref.line) {
        ref.line.setLatLngs([
          [mortarPosition.ueY, mortarPosition.ueX],
          [t.ueY, t.ueX],
        ]);
      }
      if (ref.damageCircle) {
        ref.damageCircle.setLatLng([t.ueY, t.ueX]);
        ref.damageCircle.setRadius(shell.explosionRadius[1] * 100);
      }
      if (ref.marker) {
        ref.marker.setTooltipContent(targetTooltipHtml(sol));
        const el = ref.marker.getElement();
        if (el) {
          const pin = el.querySelector('.target-pin');
          if (pin) pin.classList.toggle('oor', !sol.inRange);
        }
      }
    }
    updateMortarResultPanel(sols);
  }

  function renderMortarOverlay(hm, layer) {
    if (mortarLayerGroup) mortarLayerGroup.clearLayers();
    if (!mortarLayerGroup) mortarLayerGroup = L.layerGroup().addTo(leafletMap);
    mortarRefs.marker = null;
    mortarRefs.rangeCircle = null;
    mortarRefs.targets = [];

    if (!mortarPosition) {
      updateMortarSummary();
      updateMortarResultPanel([]);
      return;
    }

    rebuildWeaponSelect();
    rebuildShellSelect();
    updateMortarSummary();

    const m = mortarPosition;

    // Max-range circle (meters -> UE units x100).
    const maxRangeUE = getWeaponMaxRangeM() * 100;
    mortarRefs.rangeCircle = L.circle([m.ueY, m.ueX], {
      radius: maxRangeUE,
      color: '#6fc3df',
      weight: 1.5,
      opacity: 0.65,
      fillColor: '#6fc3df',
      fillOpacity: 0.05,
      interactive: false,
      className: 'mortar-range-circle',
    }).addTo(mortarLayerGroup);

    // Draggable mortar pin
    mortarRefs.marker = L.marker([m.ueY, m.ueX], {
      icon: mortarIcon(),
      draggable: true,
      autoPan: true,
    }).addTo(mortarLayerGroup);

    mortarRefs.marker.on('drag', (e) => {
      const ll = e.target.getLatLng();
      mortarPosition = { ueX: ll.lng, ueY: ll.lat };
      refreshMortarVisuals(hm, layer);
    });

    // Click the mortar pin to clear the whole session (matches HAB UX).
    mortarRefs.marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      clearMortar();
    });

    mortarRefs.marker.bindTooltip('Click to remove', {
      direction: 'top',
      offset: [0, -14],
      className: 'obj-label',
    });

    // Right-click the pin to toggle the max-range circle on/off.
    mortarRefs.marker.on('contextmenu', (e) => {
      L.DomEvent.stopPropagation(e);
      L.DomEvent.preventDefault(e);
      if (!mortarRefs.rangeCircle) return;
      const el = mortarRefs.rangeCircle.getElement();
      if (el) el.classList.toggle('hidden');
    });

    // Targets: each independent, each draggable, each with own line + tooltip
    // + damage-radius circle.
    const damageRadiusUE = getActiveShell().explosionRadius[1] * 100;
    const sols = computeAllSolutions(hm, layer);
    for (let i = 0; i < targetPositions.length; i++) {
      const t = targetPositions[i];
      const sol = sols[i];

      const line = L.polyline(
        [[mortarPosition.ueY, mortarPosition.ueX], [t.ueY, t.ueX]],
        { color: '#e35b4a', weight: 2, opacity: 0.85, dashArray: '8 5', interactive: false }
      ).addTo(mortarLayerGroup);

      // Damage radius (40m kill zone) — red dashed ring with faint fill.
      const damageCircle = L.circle([t.ueY, t.ueX], {
        radius: damageRadiusUE,
        color: '#e35b4a',
        weight: 1.5,
        opacity: 0.75,
        fillColor: '#e35b4a',
        fillOpacity: 0.18,
        dashArray: '4 3',
        interactive: false,
        className: 'mortar-damage-circle',
      }).addTo(mortarLayerGroup);

      const marker = L.marker([t.ueY, t.ueX], {
        icon: targetIcon(sol.inRange),
        draggable: true,
        autoPan: true,
      }).addTo(mortarLayerGroup);
      marker.bindTooltip(targetTooltipHtml(sol), {
        permanent: true,
        direction: 'top',
        offset: [0, -8],
        className: 'target-pin-tooltip',
      });

      // Capture a stable index so drag updates the right target — we can't
      // use `i` directly because targetPositions can be re-ordered on clear.
      const idx = i;
      marker.on('drag', (e) => {
        const ll = e.target.getLatLng();
        targetPositions[idx] = { ueX: ll.lng, ueY: ll.lat };
        refreshMortarVisuals(hm, layer);
      });

      mortarRefs.targets.push({ marker, line, damageCircle });
    }
    updateMortarResultPanel(sols);
  }

  function updateMortarResultPanel(sols) {
    const panel = document.getElementById('mortar-panel');
    const el = document.getElementById('mortar-result');
    if (!panel || !el) return;
    if (!mortarPosition) {
      panel.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    panel.classList.remove('hidden');
    if (!sols || sols.length === 0) {
      el.innerHTML = '<div class="mortar-result-head"><span>ID</span><span>Range</span><span>Bearing</span><span>Elevation</span></div><div class="mortar-empty-state">Add a target to generate a firing solution.</div>';
      return;
    }

    const head = '<div class="mortar-result-head"><span>ID</span><span>Range</span><span>Bearing</span><span>Elevation</span></div>';
    const rows = sols.map((sol, i) => {
      const num = i + 1;
      const distStr = `${sol.dist.toFixed(0)}m`;
      const bearStr = `${sol.bearing.toFixed(0)}°`;
      const branch = getDisplayBranch(sol);
      let elevStr = '<span class="mortar-oor">OOR</span>';
      if (sol.belowMin) elevStr = '<span class="mortar-oor">MIN</span>';
      else if (branch) elevStr = `<strong>${formatElevation(branch.rad, sol.unit)}</strong>`;
      return `<div class="mortar-target-row">
        <span class="mortar-target-num">T${num}</span>
        <span class="mortar-target-dist">${distStr}</span>
        <span class="mortar-target-bear">${bearStr}</span>
        <span class="mortar-target-elev">${elevStr}</span>
      </div>`;
    }).join('');

    el.innerHTML = head + rows;
  }

  function currentLayer() {
    const group = mapGroups[currentMapId];
    return group ? group[currentLayerIndex] : null;
  }

  function placeHab(ueX, ueY, team) {
    const teamClass = team === 'team1' ? 'hab-blufor' : 'hab-redfor';

    // Outer exclusion radius (400m) — gold dashed, marching-ants
    const exclusionCircle = L.circle([ueY, ueX], {
      radius: HAB_EXCLUSION_RADIUS,
      color: '#f0c870',
      weight: 3,
      opacity: 0.85,
      fillColor: '#d2aa50',
      fillOpacity: 0.04,
      dashArray: '10 6',
      interactive: false,
      className: 'hab-exclusion-circle'
    }).addTo(habLayerGroup);

    // Inner construction radius (150m) — gold dashed, marching-ants
    const buildCircle = L.circle([ueY, ueX], {
      radius: HAB_BUILD_RADIUS,
      color: '#ffd770',
      weight: 3,
      opacity: 0.95,
      fillColor: '#d2aa50',
      fillOpacity: 0.1,
      dashArray: '10 6',
      interactive: false,
      className: 'hab-build-circle'
    }).addTo(habLayerGroup);

    // Draw HAB marker (gold crown)
    const size = 26;
    const icon = L.divIcon({
      className: '',
      html: `<div class="hab-marker ${teamClass}" style="width:${size}px;height:${size}px">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M5 16L3 7l5.5 4L12 5l3.5 6L21 7l-2 9H5zm0 2h14v2H5v-2z"/>
        </svg>
      </div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });

    const marker = L.marker([ueY, ueX], {
      icon,
      draggable: true,
      autoPan: true,
    }).addTo(habLayerGroup);

    const hab = { ueX, ueY, team, marker, buildCircle, exclusionCircle };
    placedHabs.push(hab);

    // Click marker to remove. Leaflet fires `click` on drag-release only when
    // the pointer actually went down and up in place, so drag ≠ click.
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      removeHab(hab);
    });

    // Drag: move the two radius circles in lockstep and refresh conflicts.
    marker.on('drag', (e) => {
      const ll = e.target.getLatLng();
      hab.ueX = ll.lng;
      hab.ueY = ll.lat;
      hab.buildCircle.setLatLng(ll);
      hab.exclusionCircle.setLatLng(ll);
      updateHabConflicts();
    });

    marker.bindTooltip('Drag to move · click to remove', {
      direction: 'top',
      offset: [0, -size / 2],
      className: 'obj-label'
    });

    updateHabConflicts();
  }

  function removeHab(hab) {
    habLayerGroup.removeLayer(hab.marker);
    habLayerGroup.removeLayer(hab.buildCircle);
    habLayerGroup.removeLayer(hab.exclusionCircle);
    placedHabs = placedHabs.filter(h => h !== hab);
    updateHabConflicts();
  }

  function clearAllHabs() {
    if (habLayerGroup) habLayerGroup.clearLayers();
    placedHabs = [];
  }

  function updateHabConflicts() {
    // Two HABs conflict if their exclusion zones overlap (centers within 400m)
    // — applies to both same-team and enemy HABs in real Squad
    for (const hab of placedHabs) {
      let conflict = false;
      for (const other of placedHabs) {
        if (hab === other) continue;
        const dx = hab.ueX - other.ueX;
        const dy = hab.ueY - other.ueY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < HAB_EXCLUSION_RADIUS) {
          conflict = true;
          break;
        }
      }
      hab.exclusionCircle.setStyle({
        color: conflict ? '#ff5050' : '#f0c870',
        weight: 3,
        fillColor: conflict ? '#cc3333' : '#d2aa50',
        fillOpacity: conflict ? 0.08 : 0.04
      });
    }
  }

  function bindEvents() {
    document.getElementById('back-btn').addEventListener('click', goBack);
    document.getElementById('home-link').addEventListener('click', (e) => {
      e.preventDefault();
      goBack();
    });

    // Search
    const searchInput = document.getElementById('search-input');
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        renderGrid(searchInput.value.trim());
      }, 200);
    });

    // Language selector
    document.getElementById('lang-select').addEventListener('change', (e) => {
      currentLang = e.target.value;
    });

    // Hash change
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash;
      if (!hash || hash === '#' || hash === '#/') {
        goBack();
      } else {
        handleHash();
      }
    });

    // Indirect-fire tool — no tool button. Double-click places, panel close button clears.
    const mortarCloseBtn = document.getElementById('mortar-close-btn');
    if (mortarCloseBtn) mortarCloseBtn.addEventListener('click', clearMortar);
    const weaponSelect = document.getElementById('weapon-select');
    if (weaponSelect) {
      weaponSelect.addEventListener('change', async (e) => {
        activeWeaponId = e.target.value;
        activeShellIdx = 0;
        rebuildShellSelect();
        const layer = currentLayer();
        if (!layer || !mortarPosition) return;
        const hm = await loadHeightmap(layer);
        if (!hm) return;
        refreshMortarVisuals(hm, layer);
      });
    }
    const shellSelect = document.getElementById('mortar-shell-select');
    if (shellSelect) {
      shellSelect.addEventListener('change', async (e) => {
        activeShellIdx = parseInt(e.target.value, 10) || 0;
        const layer = currentLayer();
        if (!layer || !mortarPosition) return;
        const hm = await loadHeightmap(layer);
        if (!hm) return;
        refreshMortarVisuals(hm, layer);
      });
    }

    // Right-click context menu: delegate item clicks, close on outside click.
    const ctxMenu = document.getElementById('map-context-menu');
    if (ctxMenu) {
      ctxMenu.addEventListener('click', (e) => {
        const btn = e.target.closest('.mcm-item');
        if (!btn || btn.disabled) return;
        handleMapContextAction(btn.dataset.action);
      });
      // Suppress the browser's native menu on our custom menu.
      ctxMenu.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    document.addEventListener('mousedown', (e) => {
      const menu = document.getElementById('map-context-menu');
      if (!menu || menu.classList.contains('hidden')) return;
      if (menu.contains(e.target)) return;
      closeMapContextMenu();
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const menu = document.getElementById('map-context-menu');
        if (menu && !menu.classList.contains('hidden')) {
          closeMapContextMenu();
        } else if (strategyDrawerOpen) {
          setStrategyDrawerOpen(false);
        } else if (leftSidebarOpen) {
          setLeftSidebarOpen(false);
        } else if (mortarPosition || targetPositions.length > 0) {
          clearMortar();
        } else if (currentMapId) {
          goBack();
        }
      }
    });

    const strategyToggle = document.getElementById('strategy-drawer-toggle');
    if (strategyToggle) {
      strategyToggle.addEventListener('click', () => {
        if (currentLayer()) renderStrategyDrawer(currentLayer());
        setStrategyDrawerOpen(!strategyDrawerOpen);
      });
    }
    const sidebarTab = document.getElementById('left-sidebar-tab');
    if (sidebarTab) {
      sidebarTab.addEventListener('click', () => setLeftSidebarOpen(!leftSidebarOpen));
    }
    const strategyClose = document.getElementById('strategy-drawer-close');
    if (strategyClose) strategyClose.addEventListener('click', () => setStrategyDrawerOpen(false));
    const strategyScrim = document.getElementById('strategy-drawer-scrim');
    if (strategyScrim) strategyScrim.addEventListener('click', () => setStrategyDrawerOpen(false));

    // Sidebar tabs
    document.querySelectorAll('.sidebar-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.sidebar-tab-pane').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      });
    });
  }

  // ---- Util ----
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Go ----
  document.addEventListener('DOMContentLoaded', init);
})();
