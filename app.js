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
  let currentMapId = null;
  let currentLayerIndex = 0;
  let selectedFactionIds = { team1: null, team2: null };
  let activeLane = null;       // e.g. 'Alpha', 'Bravo' – null means infer from captureSequence
  let captureSequence = [];    // array of normalized tokens captured so far, in order
  let activeTeam = null;       // 'team1' or 'team2' – which team's perspective
  let capturedSubPoints = {};  // token -> {x, y, name} – which sub-point was picked for each captured obj
  let activeDestructionPhase = null; // null = show all phases, 0/1/2 = specific phase
  let animatedLaneLines = [];
  let laneAnimationFrameId = null;
  let lastLaneAnimationTs = 0;

  // HAB placement (triggered via right-click context menu — no dedicated tool state).
  let placedHabs = [];              // [{ueX, ueY, team, marker, buildCircle, exclusionCircle}]
  let habLayerGroup = null;
  const HAB_BUILD_RADIUS = 15000;     // 150m in UE units (construction radius)
  const HAB_EXCLUSION_RADIUS = 40000; // 400m in UE units (enemy/friendly FOB exclusion)

  // Indirect-fire tool (standard mortar for POC).
  // Always-on: double-click the map to place. First dblclick = mortar (shows
  // range circle as a dagger pin where the tip is the weapon position);
  // each subsequent dblclick adds an independent target. All markers are
  // draggable. Dragging the mortar keeps every target where it is — the
  // firing solutions just recompute from the new mortar position.
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
  // Standard Squad mortar. Values match SquadCalc's weapons.js (SDK-sourced):
  // v=110 m/s, g=9.81 * 1.0, high-angle only between 45° and 88.875°, tube
  // sits ~1m above the ground so the mortar height gets +1. The shell has
  // an outer kill radius of 40m (explosionRadius[1] in SquadCalc's data).
  const MORTAR = {
    name: 'Standard Mortar',
    velocity: 110,
    gravity: 9.81,
    heightOffset: 1,
    minElevationDeg: 45,
    maxElevationDeg: 88.875,
    damageRadiusM: 40,
  };

  // Faction display names & flag lookup
  const FACTION_NAMES = {
    ADF: 'Australian Defence Force', AFU: 'Armed Forces of Ukraine',
    BAF: 'British Armed Forces', CAF: 'Canadian Armed Forces',
    CRF: 'Chinese Rapid Forces', GFI: 'Ground Force of Iran',
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
    currentMapId = mapId;
    const layers = mapGroups[mapId];
    if (!layers || !layers.length) return;

    // Find layer by raw name or use first
    let idx = 0;
    if (layerRaw) {
      const found = layers.findIndex(l => l.rawName === layerRaw);
      if (found >= 0) idx = found;
    }

    document.getElementById('map-grid').classList.add('hidden');
    const mv = document.getElementById('map-view');
    mv.classList.remove('hidden');

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
      // Compute which lanes are still possible given the current capture sequence
      let remainingLaneNames = laneNames;
      let isFreeMode = false;
      if (activeTeam && captureCount > 0) {
        const remaining = getRemainingLanes(layer, captureSequence, activeTeam);
        remainingLaneNames = laneNames.filter(n => n in remaining);
        if (remainingLaneNames.length === 0) {
          isFreeMode = true;
        }
      }
      const remainingSet = new Set(remainingLaneNames);

      const showReset = activeTeam && (captureSequence.length > 0 || activeLane);
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
                ? `<em>Click first capture point to narrow lanes</em>`
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

    document.getElementById('match-info').innerHTML = `
      <div class="gamemode-label">${gm}</div>
      <div class="map-size">${layer.mapSize || ''}</div>
      ${laneHtml}${phaseHtml}${tcHtml}`;

    bindTeamPanelEvents(layer);
    bindLaneEvents(layer);
    bindPhaseEvents(layer);
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

    if (/team\s*1\s*main|team1main/i.test(key)) return 'Team 1 Main';
    if (/team\s*2\s*main|team2main/i.test(key) || /main_1$/i.test(key)) return 'Team 2 Main';

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
  function findClustersAtPosition(layer, x, y, tolerance = 100) {
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

  // ---- Leaflet Map ----
  function renderMap(layer) {
    const container = document.getElementById('leaflet-map');

    // Clean up previous map
    resetLaneLineAnimations();
    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }

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
      const remainingLanes = getRemainingLanes(layer, captureSequence, activeTeam);
      const hasMatchingLanes = Object.keys(remainingLanes).length > 0;
      progressionLanes = activeLane
        ? (remainingLanes[activeLane] ? { [activeLane]: remainingLanes[activeLane] } : null)
        : (hasMatchingLanes ? remainingLanes : null);

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
    // (e.g. C2 and D2 both render Cannabis Farm at the same coords)
    const renderedPositionKeys = new Set();
    const positionKey = (x, y) => `${Math.round(x / 50)}:${Math.round(y / 50)}`;

    // Precompute positions of captured points so uncaptured markers at the
    // same position get suppressed (captured always wins the marker slot).
    const capturedPositionKeys = new Set();
    for (const entry of orderedObjectives) {
      const t = normalizeObjectiveToken(entry.key);
      if (!capturedKeys.has(t) || /team[12]main/.test(t)) continue;
      const sel = capturedSubPoints[t];
      const x = sel?.x ?? entry.position?.x;
      const y = sel?.y ?? entry.position?.y;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        capturedPositionKeys.add(positionKey(x, y));
      }
    }

    for (const entry of orderedObjectives) {
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

      // Determine team ownership from key name
      let team = 'neutral';
      if (/team1main/i.test(entry.key)) team = 'blufor';
      else if (/team2main/i.test(entry.key) || /main_1$/i.test(entry.key)) team = 'redfor';

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

        for (const sp of pointsToRender) {
          // Dedupe markers that share a physical position. Captured clusters
          // get priority — uncaptured ones at a captured position are hidden.
          const pkey = positionKey(sp.x, sp.y);
          if (renderedPositionKeys.has(pkey)) continue;
          if (!isCaptured && capturedPositionKeys.has(pkey)) continue;
          renderedPositionKeys.add(pkey);

          const size = isLookahead ? 32 : 36;
          const icon = L.divIcon({
            className: '',
            html: `<div class="obj-marker ${markerClass}${extraClass}" style="width:${size}px;height:${size}px${colorStyleSuffix}">${badgeNum ?? ''}</div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
          });

          const marker = L.marker([sp.y, sp.x], { icon: icon });

          if (shouldShowPermanentObjectiveLabel(sp.name)) {
            marker.bindTooltip(sp.name, {
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
              advanceCaptureSequence(layer, entryToken, { x: sp.x, y: sp.y, name: sp.name });
            });
          } else if (isCaptured && lastCapturedTokens.has(entryToken) && styleAsLane && !isAAS) {
            // Last captured: click to uncapture
            marker.on('click', () => {
              delete capturedSubPoints[entryToken];
              retreatCaptureSequence(layer);
            });
          } else if (!isLookahead) {
            marker.bindPopup(`<b>${escapeHtml(sp.name)}</b>`);
          }

          marker.addTo(markerGroup);
        }
        // Use selected sub-point position for line if captured, otherwise avg position
        const linePos = (isCaptured && selectedSp)
          ? { x: selectedSp.x, y: selectedSp.y }
          : entry.position;
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
          const pkey = positionKey(entry.position.x, entry.position.y);
          if (renderedPositionKeys.has(pkey)) {
            skipMarker = true;
          } else if (!isCaptured && capturedPositionKeys.has(pkey)) {
            skipMarker = true;
          } else {
            renderedPositionKeys.add(pkey);
          }
        }

        if (!skipMarker) {
          const isActiveMain = isMain && extraClass.includes('active-main');
          const size = isMain ? (isActiveMain ? 48 : 40) : (isLookahead ? 34 : 38);
          const badgeText = isMain ? 'M' : String(badgeNum);

          const icon = L.divIcon({
            className: '',
            html: `<div class="obj-marker ${markerClass}${extraClass}" style="width:${size}px;height:${size}px${colorStyleSuffix}">${badgeText}</div>`,
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
    let aliases = [token];
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      const found = findClustersAtPosition(layer, position.x, position.y);
      found.delete(token);
      aliases = [token, ...found];
      const seedName = position.name || '';
      for (const alias of aliases) {
        capturedSubPoints[alias] = {
          x: position.x,
          y: position.y,
          name: capturedSubPoints[alias]?.name || seedName
        };
      }
    }
    // Filter out any aliases already captured
    const captured = new Set(captureSequence);
    const fresh = aliases.filter(t => !captured.has(t));
    if (fresh.length === 0) return;
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

    if (sizeTier === 'large') {
      addArchetypeScores(offense, { AirAssault: 26, Motorized: 20, CombinedArms: 16, Mechanized: 10, Armored: 6, Support: 4 });
      addArchetypeScores(defense, { CombinedArms: 16, LightInfantry: 14, Support: 12, Motorized: 10, Mechanized: 8, AirAssault: 6, Armored: 4 });
      watchouts.add('Slow tracked-heavy packages can stall badly on long cross-map rotations.');
    } else if (sizeTier === 'medium') {
      addArchetypeScores(offense, { CombinedArms: 14, Motorized: 12, Mechanized: 10, LightInfantry: 8, AirAssault: 8, Armored: 8, Support: 6 });
      addArchetypeScores(defense, { CombinedArms: 14, LightInfantry: 12, Support: 10, Mechanized: 8, Armored: 8, Motorized: 6, AirAssault: 4 });
    } else {
      addArchetypeScores(offense, { LightInfantry: 18, Support: 12, Mechanized: 10, CombinedArms: 8, Motorized: 6, Armored: 4 });
      addArchetypeScores(defense, { LightInfantry: 20, Support: 14, Mechanized: 10, CombinedArms: 8, Armored: 4, Motorized: 4 });
      watchouts.add('Compact layers reward point-fight sustainment more than raw top speed.');
    }

    const waterHazard = (window.WATER_HAZARDS || {})[layer.mapId] || null;

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
      if (waterHazard) {
        watchouts.add(waterHazard.summary);
      } else {
        watchouts.add('Water crossings and shoreline flanks punish teams with no air or boat options.');
      }
    }
    if (traitSet.has('forest')) {
      addArchetypeScores(offense, { LightInfantry: 14, Mechanized: 10, Support: 8, Motorized: 4, CombinedArms: 4, Armored: -4 });
      addArchetypeScores(defense, { LightInfantry: 16, Support: 10, Mechanized: 8, CombinedArms: 6, Armored: -2 });
      watchouts.add('Forested terrain cuts sightlines and makes infantry support matter more than gun size.');
    }
    if (traitSet.has('desert') || traitSet.has('open')) {
      addArchetypeScores(offense, { CombinedArms: 12, Armored: 10, Motorized: 8, AirAssault: 6, Mechanized: 6 });
      addArchetypeScores(defense, { CombinedArms: 10, Armored: 8, Support: 6, Mechanized: 6, LightInfantry: 4 });
      watchouts.add('Open ground punishes weak logistics and slow recovery after losing tempo.');
    }
    if (traitSet.has('urban')) {
      addArchetypeScores(offense, { LightInfantry: 16, Support: 12, CombinedArms: 6, Mechanized: 4, Armored: -4 });
      addArchetypeScores(defense, { LightInfantry: 18, Support: 14, Mechanized: 6, CombinedArms: 6, Armored: -6 });
      watchouts.add('Dense compounds reduce the value of pure armor packages unless they have strong infantry support.');
    }
    if (traitSet.has('mountain')) {
      addArchetypeScores(offense, { AirAssault: 16, LightInfantry: 12, Motorized: 8, CombinedArms: 4, Armored: -6 });
      addArchetypeScores(defense, { LightInfantry: 16, Support: 10, Mechanized: 6, AirAssault: 6, Armored: -4 });
      watchouts.add('Vertical terrain rewards air mobility and punishes armor that cannot reposition quickly.');
    }
    if (traitSet.has('snow') || traitSet.has('wetland')) {
      addArchetypeScores(offense, { Mechanized: 8, Support: 6, CombinedArms: 6, LightInfantry: 4, Motorized: 2 });
      addArchetypeScores(defense, { Mechanized: 10, Support: 8, LightInfantry: 6, CombinedArms: 6 });
      watchouts.add('Soft ground and chokepoints make sustainment and route flexibility more important than raw acceleration.');
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
      offense: offenseRanked,
      defense: defenseRanked,
      watchouts: Array.from(watchouts).slice(0, 3),
      traitSet,
      waterHazard
    };
  }

  function getCapabilityCounts(layer, teamKey) {
    return Object.fromEntries(getTeamVehicleCapabilities(layer, teamKey));
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

    let score = 50;
    const strengths = [];
    const risks = [];

    if (mapSuitability.sizeTier === 'large') {
      if (helicopters > 0 || doctrines.has('AirAssault')) {
        score += 12;
        strengths.push('has air mobility for long-route tempo swings');
      }
      if (mobilityCount >= 3 || doctrines.has('Motorized')) {
        score += 10;
        strengths.push('has enough transport and logistics to keep pace on a large layer');
      }
      if (helicopters === 0 && heavyArmor >= 3 && mobilityCount <= 1) {
        score -= 16;
        risks.push('is vulnerable to getting stuck mid-map because it is heavy and slow to rotate');
      }
    }

    if (mapSuitability.traitSet.has('water')) {
      const wh = mapSuitability.waterHazard;
      const severity = wh ? wh.severity : 'moderate';
      if (boats > 0) {
        const bonus = severity === 'high' ? 12 : severity === 'moderate' ? 8 : 4;
        score += bonus;
        strengths.push('can use water or shoreline routes instead of fighting every bridge');
      } else if (helicopters > 0) {
        if (severity === 'high') {
          score += 6;
          strengths.push('air mobility bypasses impassable water barriers');
        }
      } else {
        const penalty = severity === 'high' ? -12 : severity === 'moderate' ? -7 : -3;
        score += penalty;
        if (severity === 'high') {
          risks.push('has no way to bypass impassable water — forced into bridge chokepoints');
        } else {
          risks.push('has limited flank options around water obstacles');
        }
      }
    }

    if (mapSuitability.traitSet.has('forest')) {
      if (doctrines.has('LightInfantry') || doctrines.has('Support')) {
        score += 9;
        strengths.push('fits short-sightline infantry fights well');
      }
      if (heavyArmor >= 3 && !doctrines.has('LightInfantry')) {
        score -= 6;
        risks.push('leans too hard on armor for a cover-heavy forested lane');
      }
    }

    if (mapSuitability.traitSet.has('desert') || mapSuitability.traitSet.has('open')) {
      if (heavyArmor >= 2 || doctrines.has('CombinedArms') || doctrines.has('Armored')) {
        score += 10;
        strengths.push('can exploit open sightlines and longer vehicle routes');
      }
      if (mobilityCount <= 1 && helicopters === 0) {
        score -= 8;
        risks.push('may struggle to recover when the line stretches across open ground');
      }
    }

    if (mapSuitability.traitSet.has('urban')) {
      if (doctrines.has('LightInfantry') || doctrines.has('Support')) {
        score += 10;
        strengths.push('has the infantry bias needed for compound-heavy objectives');
      }
      if (heavyArmor >= 3 && !doctrines.has('CombinedArms') && !doctrines.has('Mechanized')) {
        score -= 8;
        risks.push('is armor-heavy for tight urban pushes and defense resets');
      }
    }

    if (mapSuitability.traitSet.has('mountain')) {
      if (helicopters > 0 || doctrines.has('AirAssault') || doctrines.has('LightInfantry')) {
        score += 10;
        strengths.push('can handle vertical terrain and awkward approach angles');
      }
      if (heavyArmor >= 3 && helicopters === 0) {
        score -= 10;
        risks.push('has poor repositioning tools for mountain terrain');
      }
    }

    if (mapSuitability.traitSet.has('snow') || mapSuitability.traitSet.has('wetland')) {
      if (logistics >= 1 || doctrines.has('Mechanized') || doctrines.has('Support')) {
        score += 6;
        strengths.push('has the sustainment to survive slower route conditions');
      }
    }

    mapSuitability.offense.forEach((archetype) => {
      const doctrineKey = Object.keys(ARCHETYPE_LABELS).find((key) => ARCHETYPE_LABELS[key] === archetype);
      if (doctrineKey && doctrines.has(doctrineKey)) score += 3;
    });

    return {
      label: score >= 70 ? 'Strong fit' : score >= 58 ? 'Good fit' : score >= 46 ? 'Situational fit' : 'Poor fit',
      tone: score >= 70 ? 'strong' : score >= 58 ? 'good' : score >= 46 ? 'situational' : 'poor',
      strengths: strengths.slice(0, 2),
      risks: risks.slice(0, 2)
    };
  }

  function buildMapSuitabilitySection(layer) {
    const fit = buildMapSuitability(layer);
    let html = `<div class="detail-section">
      <h4>Map Fit</h4>
      <div class="map-fit-meta">${fit.diagonalKm ? `${fit.diagonalKm.toFixed(1)} km playable diagonal` : 'Map footprint unavailable'}</div>
      <div class="map-trait-list">${fit.traits.map((trait) => `<span class="map-trait-chip">${escapeHtml(trait)}</span>`).join('')}</div>
      <div class="map-fit-grid">
        <div class="map-fit-card">
          <div class="map-fit-card-title">Offense Favors</div>
          <div class="map-fit-chip-row">${fit.offense.map((value) => `<span class="map-fit-chip offense">${escapeHtml(value)}</span>`).join('')}</div>
        </div>
        <div class="map-fit-card">
          <div class="map-fit-card-title">Defense Favors</div>
          <div class="map-fit-chip-row">${fit.defense.map((value) => `<span class="map-fit-chip defense">${escapeHtml(value)}</span>`).join('')}</div>
        </div>
      </div>`;
    if (fit.watchouts.length) {
      html += `<div class="map-fit-warning-list">${fit.watchouts.map((warning) => `<div class="map-fit-warning">${escapeHtml(warning)}</div>`).join('')}</div>`;
    }
    if (fit.waterHazard) {
      const wh = fit.waterHazard;
      const severityLabel = wh.severity === 'high' ? 'High' : wh.severity === 'moderate' ? 'Moderate' : 'Low';
      const passableLabel = wh.infantryPassable === 'yes' ? 'Yes' : wh.infantryPassable === 'partial' ? 'Partial' : 'No';
      html += `<div class="water-hazard-section">
        <div class="water-hazard-header">
          <span class="water-hazard-icon">🌊</span>
          <span class="water-hazard-title">Water Hazards</span>
          <span class="water-severity-badge severity-${wh.severity}">${severityLabel}</span>
        </div>
        <div class="water-hazard-meta">Infantry passable: <strong>${passableLabel}</strong></div>
        <ul class="water-hazard-list">${wh.hazards.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
      </div>`;
    }
    html += '</div>';
    return { html, fit };
  }

  // ---- Layer Details ----
  function renderDetails(layer) {
    const content = document.getElementById('detail-content');
    const tc = layer.teamConfigs || {};
    const assets = layer.assets || {};

    let html = '';

    // Layer info
    html += `<div class="detail-section">
      <h4>Layer Info</h4>
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.8">
        <div><b>Gamemode:</b> ${GAMEMODE_LABELS[layer.gamemode] || layer.gamemode}</div>
        <div><b>Map Size:</b> ${layer.mapSize || 'N/A'}</div>
        <div><b>Helicopters:</b> ${layer.helicoptersAvailable ? 'Yes' : 'No'}</div>
        <div><b>Tanks:</b> ${layer.tanksAvailable ? 'Yes' : 'No'}</div>
        <div><b>Boats:</b> ${layer.boatsAvailable ? 'Yes' : 'No'}</div>
        <div><b>Commander:</b> ${layer.commanderDisabled ? 'Disabled' : 'Enabled'}</div>
      </div>
    </div>`;

    const mapSuitability = buildMapSuitabilitySection(layer);
    html += mapSuitability.html;

    // Team 1 info
    const t1 = tc.team1 || {};
    const team1Option = getSelectedTeamOption(layer, 'team1');
    html += buildTeamDetail('Team 1', 'team1', team1Option, t1, layer, mapSuitability.fit);

    // Team 2 info
    const t2 = tc.team2 || {};
    const team2Option = getSelectedTeamOption(layer, 'team2');
    html += buildTeamDetail('Team 2', 'team2', team2Option, t2, layer, mapSuitability.fit);

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

  function buildTeamDetail(label, teamKey, selectedOption, teamConfig, layer, mapSuitability) {
    const factionId = selectedOption?.factionID || extractFactionId(teamConfig.defaultFactionUnit);
    const vehicleCapabilities = getTeamVehicleCapabilities(layer, teamKey);
    const teamFit = evaluateTeamMapFit(layer, teamKey, selectedOption, mapSuitability);
    let html = `<div class="detail-section"><h4>${label} – ${FACTION_NAMES[factionId] || factionId}</h4>`;
    html += `<div style="font-size:12px;color:var(--text-secondary);line-height:1.6">`;
    html += `<div><b>Tickets:</b> ${teamConfig.tickets || '?'}</div>`;
    html += `<div><b>Default Unit:</b> ${selectedOption?.defaultUnit || teamConfig.defaultFactionUnit || 'N/A'}</div>`;
    html += `<div class="team-fit-summary">
      <div class="team-fit-header">
        <span><b>Layer Fit:</b></span>
        <span class="fit-badge ${teamFit.tone}">${teamFit.label}</span>
      </div>
      ${teamFit.strengths.length ? `<div class="team-fit-points">${teamFit.strengths.map((point) => `<div class="team-fit-point positive">${escapeHtml(point)}</div>`).join('')}</div>` : ''}
      ${teamFit.risks.length ? `<div class="team-fit-points">${teamFit.risks.map((point) => `<div class="team-fit-point warning">${escapeHtml(point)}</div>`).join('')}</div>` : ''}
    </div>`;
    if (selectedOption?.types?.length) {
      html += `<div style="margin-top:6px"><b>Unit Types:</b></div>`;
      html += `<div class="unit-type-list">${selectedOption.types.map((type) => `<span class="unit-type-chip">${escapeHtml(formatUnitType(type.unitType))}</span>`).join('')}</div>`;
    }
    if (vehicleCapabilities.length) {
      html += `<div style="margin-top:8px"><b>Vehicle Capabilities:</b></div>`;
      html += `<div class="vehicle-capability-list">${vehicleCapabilities.map(([name, count]) => `
        <span class="vehicle-capability-chip">
          <span class="vehicle-capability-name">${escapeHtml(name)}</span>
          <span class="vehicle-capability-count">${count}</span>
        </span>`).join('')}</div>`;
    }
    html += '</div></div>';
    return html;
  }

  // ---- Go Back ----
  function goBack() {
    clearAllHabs();
    // Reset mortar tool state
    clearMortar();
    closeMapContextMenu();

    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }
    document.getElementById('map-view').classList.add('hidden');
    document.getElementById('map-grid').classList.remove('hidden');
    currentMapId = null;
    window.location.hash = '';
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

  function computeFiringSolution(mortar, target, hMortar, hTarget) {
    // UE units to meters
    const dxM = (target.ueX - mortar.ueX) / 100;
    const dyM = (target.ueY - mortar.ueY) / 100;
    const dist = Math.hypot(dxM, dyM);
    // Bearing: 0deg = North (+Y), 90deg = East (+X), clockwise
    let bearing = Math.atan2(dxM, dyM) * 180 / Math.PI;
    if (bearing < 0) bearing += 360;

    const v = MORTAR.velocity;
    const g = MORTAR.gravity;
    // Mortar tube sits ~1m off the ground — apply heightOffset to the mortar side.
    const hDiff = hTarget - (hMortar + (MORTAR.heightOffset || 0));
    const v2 = v * v;
    const v4 = v2 * v2;
    const inner = v4 - g * (g * dist * dist + 2 * hDiff * v2);

    const result = { dist, bearing, hDiff, hMortar, hTarget, inRange: false };
    if (inner < 0 || dist <= 0) return result;

    const P = Math.sqrt(inner);
    const lowRad = Math.atan((v2 - P) / (g * dist));
    const highRad = Math.atan((v2 + P) / (g * dist));
    const toDeg = (r) => r * 180 / Math.PI;
    const toMil = (r) => r * 3200 / Math.PI; // NATO mil (6400 mils = 360deg)

    const lowDeg = toDeg(lowRad);
    const highDeg = toDeg(highRad);
    const inBand = (d) => d >= MORTAR.minElevationDeg && d <= MORTAR.maxElevationDeg;

    result.inRange = true;
    result.low = inBand(lowDeg) ? { deg: lowDeg, mil: toMil(lowRad) } : null;
    result.high = inBand(highDeg) ? { deg: highDeg, mil: toMil(highRad) } : null;
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

  // Flat-ground max range for the current mortar, in meters.
  // v^2/g is the theoretical max at 45° elevation on flat ground.
  function mortarMaxRangeFlatM() {
    return (MORTAR.velocity * MORTAR.velocity) / MORTAR.gravity;
  }

  // Gold reticle centered exactly on the weapon position. Anchor is the
  // geometric centre so firing solutions, range circle and heightmap sample
  // all reference the same point the user sees.
  function mortarIcon() {
    return L.divIcon({
      className: '',
      html: `<div class="mortar-marker" title="${MORTAR.name}">
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
    // Three-line tooltip: distance, bearing, firing elevation in mils.
    const dist = `${Math.round(sol.dist)}m`;
    const bear = `${sol.bearing.toFixed(0)}&deg;`;
    let elev;
    if (!sol.inRange) elev = '<span class="mortar-oor-tt">OOR</span>';
    else if (sol.high) elev = `${sol.high.mil.toFixed(0)} mil`;
    else if (sol.low) elev = `${sol.low.mil.toFixed(0)} mil`;
    else elev = '<span class="mortar-oor-tt">OOR</span>';
    return `${dist}<br>${bear}<br>${elev}`;
  }

  // Compute solutions for every target from the current mortar + heightmap,
  // returning a parallel array aligned with targetPositions.
  function computeAllSolutions(hm, layer) {
    if (!mortarPosition || !hm) return [];
    const hMortar = sampleHeight(hm, layer, mortarPosition.ueX, mortarPosition.ueY);
    return targetPositions.map((t) => {
      const hTarget = sampleHeight(hm, layer, t.ueX, t.ueY);
      return computeFiringSolution(mortarPosition, t, hMortar, hTarget);
    });
  }

  // Recompute solutions and update every dependent visual (range circle
  // center, lines, target tooltips, result panel) in place — no full
  // re-render so drag state survives.
  function refreshMortarVisuals(hm, layer) {
    if (!mortarLayerGroup || !mortarPosition) return;
    if (mortarRefs.rangeCircle) {
      mortarRefs.rangeCircle.setLatLng([mortarPosition.ueY, mortarPosition.ueX]);
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
      updateMortarResultPanel([]);
      return;
    }

    const m = mortarPosition;

    // Max-range circle (flat-ground, meters -> UE units x100).
    const maxRangeUE = mortarMaxRangeFlatM() * 100;
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
    const damageRadiusUE = MORTAR.damageRadiusM * 100;
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
    if (!sols || sols.length === 0) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    const rows = sols.map((sol, i) => {
      const num = i + 1;
      const distStr = `${sol.dist.toFixed(0)}m`;
      const bearStr = `${sol.bearing.toFixed(0)}&deg;`;
      let elevStr;
      if (!sol.inRange) {
        elevStr = '<span class="mortar-oor">OOR</span>';
      } else if (sol.high) {
        elevStr = `<strong>${sol.high.mil.toFixed(0)}</strong> mil`;
      } else if (sol.low) {
        elevStr = `<strong>${sol.low.mil.toFixed(0)}</strong> mil`;
      } else {
        elevStr = '<span class="mortar-oor">OOR</span>';
      }
      return `<div class="mortar-target-row">
        <span class="mortar-target-num">T${num}</span>
        <span class="mortar-target-dist">${distStr}</span>
        <span class="mortar-target-bear">${bearStr}</span>
        <span class="mortar-target-elev">${elevStr}</span>
      </div>`;
    }).join('');

    el.innerHTML = rows;
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

    // Mortar tool — no tool button. Double-click places, panel close button clears.
    const mortarCloseBtn = document.getElementById('mortar-close-btn');
    if (mortarCloseBtn) mortarCloseBtn.addEventListener('click', clearMortar);

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
        } else if (mortarPosition || targetPositions.length > 0) {
          clearMortar();
        } else if (currentMapId) {
          goBack();
        }
      }
    });

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
