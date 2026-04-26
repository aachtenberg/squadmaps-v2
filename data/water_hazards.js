// Hand-curated water hazard annotations per map.
// These supplement the SDK's binary depth-map data which cannot be extracted to JSON.
// Keys match mapId values from v10_data.
window.WATER_HAZARDS = {
  "AlBasrah": {
    severity: "moderate",
    infantryPassable: "partial",
    summary: "River depth varies — some sections drown infantry.",
    hazards: [
      "Shatt al-Arab waterway is impassable to infantry in deeper central channels",
      "Shallow canal crossings exist on the eastern edges",
      "Vehicles can ford most crossings but may stall in the deepest sections"
    ]
  },
  "BlackCoast": {
    severity: "high",
    infantryPassable: "no",
    summary: "Coastal ocean impassable — inland water varies.",
    hazards: [
      "Open ocean and coastal waters are lethal to infantry",
      "Inland lakes and ponds have variable depth — some are passable, others are not",
      "Amphibious vehicles or helicopters are essential for coastal flanking"
    ]
  },
  "GooseBay": {
    severity: "high",
    infantryPassable: "no",
    summary: "Ocean impassable on foot — inland lakes usually wadeable.",
    hazards: [
      "Open ocean and exposed coastline are impassable on foot",
      "Inland waterways are generally fordable by infantry",
      "Coastal objectives require boats or air transport to flank"
    ]
  },
  "Manicouagan": {
    severity: "high",
    infantryPassable: "no",
    summary: "Central river impassable on foot — bridges are chokepoints.",
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
    summary: "Marshland slows infantry but doesn't block them.",
    hazards: [
      "Marshy ground slows infantry movement",
      "No deep water obstacles that block infantry"
    ]
  },
  "Narva": {
    severity: "moderate",
    infantryPassable: "partial",
    summary: "River splits the map — some crossings need bridges.",
    hazards: [
      "River crossing points are limited and become contested chokepoints",
      "Flooded variant significantly increases water coverage and depth"
    ]
  },
  "Skorpo": {
    severity: "moderate",
    infantryPassable: "partial",
    summary: "Fjords impassable — inland streams are fordable.",
    hazards: [
      "Fjord waters between islands require boats or air transport",
      "Inland streams and ponds are wadeable by infantry"
    ]
  },
  "Fallujah": {
    severity: "low",
    infantryPassable: "yes",
    summary: "River borders the map — rarely affects play.",
    hazards: [
      "Canal crossings slow infantry slightly but are passable",
      "River edge is mostly out of play area"
    ]
  },
  "Sanxian": {
    severity: "moderate",
    infantryPassable: "partial",
    summary: "Deep water separates islands — boats or air required.",
    hazards: [
      "Inter-island water is impassable to infantry",
      "Boats or helicopters needed for cross-island movement"
    ]
  },
  "Tallil": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Minimal water — all passable.",
    hazards: [
      "No significant water obstacles for infantry"
    ]
  },
  "Yehorivka": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Shallow — infantry can wade across.",
    hazards: [
      "River crossings slow movement but do not block infantry"
    ]
  },
  "Gorodok": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Minor waterways — all passable.",
    hazards: [
      "No significant water obstacles"
    ]
  },
  "Kokan": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Shallow canals — all passable.",
    hazards: [
      "Canal crossings cause minor speed reduction but are safe"
    ]
  },
  "Mutaha": {
    severity: "low",
    infantryPassable: "yes",
    summary: "Shallow canals — no obstacles.",
    hazards: [
      "No significant water obstacles"
    ]
  }
};
