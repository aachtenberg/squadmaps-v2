// Hand-curated water hazard annotations per map.
// These supplement the SDK's binary depth-map data which cannot be extracted to JSON.
// Keys match mapId values from v10_data.
window.WATER_HAZARDS = {
  "AlBasrah": {
    severity: "moderate",
    infantryPassable: "partial",
    summary: "River depth varies — some sections allow infantry wading, deeper areas drown infantry.",
    hazards: [
      "Shatt al-Arab waterway is impassable to infantry in deeper central channels",
      "Shallow canal crossings exist on the eastern edges",
      "Vehicles can ford most crossings but may stall in the deepest sections"
    ]
  },
  "BlackCoast": {
    severity: "high",
    infantryPassable: "no",
    summary: "Coastal ocean is impassable. Inland water bodies vary in depth; some are deep enough to drown infantry.",
    hazards: [
      "Open ocean and coastal waters are lethal to infantry",
      "Inland lakes and ponds have variable depth — some are passable, others are not",
      "Amphibious vehicles or helicopters are essential for coastal flanking"
    ]
  },
  "GooseBay": {
    severity: "high",
    infantryPassable: "no",
    summary: "Coastal ocean is impassable to infantry. Inland lakes are shallow enough to wade in most areas.",
    hazards: [
      "Open ocean and exposed coastline are impassable on foot",
      "Inland waterways are generally fordable by infantry",
      "Coastal objectives require boats or air transport to flank"
    ]
  },
  "Manicouagan": {
    severity: "high",
    infantryPassable: "no",
    summary: "Central river is generally impassable to infantry (too deep). Water above the dam is also impassable.",
    hazards: [
      "Manicouagan River in the centre of the map is too deep for infantry to cross",
      "Water above the dam is deep and impassable on foot",
      "Bridge crossings become critical chokepoints — control of bridges dictates flanking options",
      "Amphibious vehicles or helicopters are needed to bypass river obstacles"
    ]
  },
  "Harju": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Shallow marshland and minor waterways. Most water is passable by infantry with reduced speed.",
    hazards: [
      "Marshy ground slows infantry movement",
      "No deep water obstacles that block infantry"
    ]
  },
  "Narva": {
    severity: "moderate",
    infantryPassable: "partial",
    summary: "Narva River splits the map. Depth varies — some areas are wadeable, others require bridge crossings.",
    hazards: [
      "River crossing points are limited and become contested chokepoints",
      "Flooded variant significantly increases water coverage and depth"
    ]
  },
  "Skorpo": {
    severity: "moderate",
    infantryPassable: "partial",
    summary: "Fjord and coastal waters are deep and impassable. Inland streams are generally fordable.",
    hazards: [
      "Fjord waters between islands require boats or air transport",
      "Inland streams and ponds are wadeable by infantry"
    ]
  },
  "Fallujah": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Euphrates River borders the map but rarely affects gameplay. Canal water is shallow.",
    hazards: [
      "Canal crossings slow infantry slightly but are passable",
      "River edge is mostly out of play area"
    ]
  },
  "Sanxian": {
    severity: "moderate",
    infantryPassable: "partial",
    summary: "Island map with coastal waters and rivers. Deep water separates land masses.",
    hazards: [
      "Inter-island water is impassable to infantry",
      "Boats or helicopters needed for cross-island movement"
    ]
  },
  "Tallil": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Minimal water presence. Small water features are shallow and passable.",
    hazards: [
      "No significant water obstacles for infantry"
    ]
  },
  "Yehorivka": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Small river and ponds are shallow. Infantry can wade across most water features.",
    hazards: [
      "River crossings slow movement but do not block infantry"
    ]
  },
  "Gorodok": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Minor waterways and ponds. All are passable by infantry.",
    hazards: [
      "No significant water obstacles"
    ]
  },
  "Kokan": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Irrigation channels and shallow water. All crossings are infantry-passable.",
    hazards: [
      "Canal crossings cause minor speed reduction but are safe"
    ]
  },
  "Mutaha": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Minor irrigation canals. Shallow and passable everywhere.",
    hazards: [
      "No significant water obstacles"
    ]
  }
};
