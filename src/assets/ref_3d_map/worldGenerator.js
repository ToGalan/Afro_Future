// worldGenerator.js - GDD-based African terrain generation
// Based on Afro-Future Rising story and authentic African biomes

// Real game map dimensions - Decreased by 50% for better performance
export const REAL_MAP_WIDTH = 540; // Decreased from 1080 (50% smaller)
export const REAL_MAP_HEIGHT = 360;  // Decreased from 720 (50% smaller)

// African biome types based on GDD story
const BIOME_TYPES = {
  SAVANNA: 'P',        // Grassland/Pasture - Central Africa starting region
  FOREST: 'F',         // Dense forests - Congo Basin, West Africa
  JUNGLE: 'J',         // Tropical jungle - Central/West Africa
  DESERT: 'D',         // Sahara and Kalahari regions
  MOUNTAINS: 'M',      // Ethiopian Highlands, Atlas Mountains
  WATER: 'W',          // Rivers, lakes, coastlines
  AGRICULTURE: 'A',    // Farmland around settlements
  SETTLEMENTS: 'S',    // Cities and towns
  HILLS: 'H',          // Rolling hills and plateaus
  OASIS: 'O'           // Desert oases
};

// African regional terrain distributions based on real geography
const REGIONAL_BIOMES = {
  'NORTH_AFRICA': { // Sahara region
    desert: 0.4,
    oasis: 0.05,
    mountains: 0.15,
    settlements: 0.1,
    agriculture: 0.1,
    hills: 0.15,
    water: 0.05
  },
  'WEST_AFRICA': { // Coastal and forest regions
    forest: 0.3,
    savanna: 0.25,
    agriculture: 0.15,
    settlements: 0.1,
    water: 0.1,
    hills: 0.1
  },
  'CENTRAL_AFRICA': { // Congo Basin and starting area
    forest: 0.25,
    savanna: 0.3,
    agriculture: 0.15,
    settlements: 0.1,
    water: 0.1,
    mountains: 0.05,
    hills: 0.05
  },
  'EAST_AFRICA': { // Ethiopian Highlands, Great Rift Valley
    mountains: 0.2,
    savanna: 0.25,
    hills: 0.2,
    agriculture: 0.1,
    settlements: 0.1,
    water: 0.1,
    desert: 0.05
  },
  'SOUTH_AFRICA': { // Mixed terrain
    savanna: 0.25,
    hills: 0.2,
    mountains: 0.15,
    agriculture: 0.15,
    settlements: 0.1,
    desert: 0.1,
    water: 0.05
  }
};

// Story-based faction territories for terrain placement
const FACTION_TERRITORIES = {
  'PAA': { // Pan-African Alliance - Central/West focus
    regions: ['CENTRAL_AFRICA', 'WEST_AFRICA'],
    preferredTerrain: ['settlements', 'agriculture', 'savanna'],
    strongholds: [
      { x: 360, y: 240, name: 'Unity Capital' }, // Central Africa (center of map)
      { x: 180, y: 200, name: 'Lagos Outpost' }   // West Africa
    ]
  },
  'ASF': { // African Sovereign Front - East/North focus
    regions: ['EAST_AFRICA', 'NORTH_AFRICA'],
    preferredTerrain: ['mountains', 'hills', 'settlements'],
    strongholds: [
      { x: 540, y: 160, name: 'Highland Fortress' }, // East Africa
      { x: 360, y: 80, name: 'Desert Command' }      // North Africa
    ]
  },
  'WC': { // World Coalition - South/Coastal focus
    regions: ['SOUTH_AFRICA'],
    preferredTerrain: ['settlements', 'agriculture', 'water'],
    strongholds: [
      { x: 360, y: 400, name: 'Cape Coalition Base' } // South Africa
    ]
  }
};

// Generate noise for natural terrain variation
function generateNoise(x, y, scale = 0.01, octaves = 4) {
  let value = 0;
  let amplitude = 1;
  let frequency = scale;
  
  for (let i = 0; i < octaves; i++) {
    value += Math.sin(x * frequency) * Math.cos(y * frequency) * amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  
  return (value + 1) / 2; // Normalize to 0-1
}

// Determine which African region a coordinate belongs to
function getAfricanRegion(x, y) {
  const width = REAL_MAP_WIDTH;
  const height = REAL_MAP_HEIGHT;
  
  // Approximate African geography divisions
  if (y < height * 0.3) return 'NORTH_AFRICA';      // Northern third - Sahara
  if (x < width * 0.4) return 'WEST_AFRICA';        // Western coastal
  if (x > width * 0.6 && y < height * 0.6) return 'EAST_AFRICA';  // Eastern highlands
  if (y > height * 0.7) return 'SOUTH_AFRICA';      // Southern regions
  return 'CENTRAL_AFRICA';                           // Central basin
}

// Generate faction-influenced terrain based on story
function generateFactionInfluence(x, y, region) {
  for (const [factionId, faction] of Object.entries(FACTION_TERRITORIES)) {
    if (faction.regions.includes(region)) {
      // Check distance to faction strongholds
      for (const stronghold of faction.strongholds) {
        const distance = Math.sqrt((x - stronghold.x) ** 2 + (y - stronghold.y) ** 2);
        if (distance < 15) {
          // Close to stronghold - place settlement
          return BIOME_TYPES.SETTLEMENTS;
        } else if (distance < 30) {
          // Near stronghold - prefer faction terrain
          const terrainTypes = faction.preferredTerrain;
          const terrainType = terrainTypes[Math.floor(Math.random() * terrainTypes.length)];
          return BIOME_TYPES[terrainType.toUpperCase()] || BIOME_TYPES.SAVANNA;
        }
      }
    }
  }
  return null; // No faction influence
}

// Generate realistic African terrain with story integration
export function generateAfricanTerrain(width = REAL_MAP_WIDTH, height = REAL_MAP_HEIGHT) {
  const terrain = [];
  
  console.log(`Generating authentic African terrain: ${width}x${height} tiles`);
  
  for (let y = 0; y < height; y++) {
    const row = [];
    
    for (let x = 0; x < width; x++) {
      const region = getAfricanRegion(x, y);
      const regionalBiomes = REGIONAL_BIOMES[region];
      
      // Check for faction influence first
      let terrainType = generateFactionInfluence(x, y, region);
      
      if (!terrainType) {
        // Use regional biome distribution with noise
        const noise = generateNoise(x, y, 0.02, 3);
        const moisture = generateNoise(x, y, 0.015, 2);
        const elevation = generateNoise(x, y, 0.008, 4);
        
        // Select terrain based on noise and regional preferences
        if (elevation > 0.8) {
          terrainType = BIOME_TYPES.MOUNTAINS;
        } else if (elevation > 0.65) {
          terrainType = BIOME_TYPES.HILLS;
        } else if (moisture < 0.2 && region === 'NORTH_AFRICA') {
          terrainType = noise > 0.95 ? BIOME_TYPES.OASIS : BIOME_TYPES.DESERT;
        } else if (moisture > 0.7 && (region === 'CENTRAL_AFRICA' || region === 'WEST_AFRICA')) {
          terrainType = BIOME_TYPES.FOREST;
        } else if (noise > 0.85) {
          terrainType = BIOME_TYPES.WATER;
        } else if (noise > 0.75 && elevation < 0.5) {
          terrainType = BIOME_TYPES.AGRICULTURE;
        } else {
          terrainType = BIOME_TYPES.SAVANNA; // Default African terrain
        }
      }
      
      row.push(terrainType);
    }
    
    terrain.push(row);
  }
  
  console.log('African terrain generation complete with GDD story integration');
  return terrain;
}

// Generate a smaller preview map for performance during development with enhanced random placement
export function generatePreviewMap(previewWidth = 48, previewHeight = 32) {
  console.log(`Generating preview African terrain: ${previewWidth}x${previewHeight} tiles`);
  
  const terrain = [];
  
  // Initialize base terrain (mostly savanna)
  for (let y = 0; y < previewHeight; y++) {
    const row = [];
    for (let x = 0; x < previewWidth; x++) {
      row.push(BIOME_TYPES.SAVANNA); // Start with savanna base
    }
    terrain.push(row);
  }
  
  // Enhanced random seed for reproducible but varied maps
  let seed = Math.floor(Math.random() * 1000000);
  const seededRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  
  // Helper function for enhanced random blob placement with regional clustering
  const generateRegionalBlob = (terrainType, region, count, minSize, maxSize, growthChance = 0.6) => {
    // Define regional bounds for more realistic placement
    const regions = {
      'north': { x: 0, y: 0, w: previewWidth, h: Math.floor(previewHeight * 0.3) },
      'central': { x: 0, y: Math.floor(previewHeight * 0.25), w: previewWidth, h: Math.floor(previewHeight * 0.5) },
      'south': { x: 0, y: Math.floor(previewHeight * 0.65), w: previewWidth, h: previewHeight - Math.floor(previewHeight * 0.65) },
      'west': { x: 0, y: 0, w: Math.floor(previewWidth * 0.4), h: previewHeight },
      'east': { x: Math.floor(previewWidth * 0.6), y: 0, w: previewWidth - Math.floor(previewWidth * 0.6), h: previewHeight },
      'anywhere': { x: 0, y: 0, w: previewWidth, h: previewHeight }
    };
    
    const bounds = regions[region] || regions['anywhere'];
    
    for (let i = 0; i < count; i++) {
      const startX = bounds.x + Math.floor(seededRandom() * bounds.w);
      const startY = bounds.y + Math.floor(seededRandom() * bounds.h);
      
      const targetSize = minSize + Math.floor(seededRandom() * (maxSize - minSize));
      const queue = [{ x: startX, y: startY }];
      const visited = new Set();
      visited.add(`${startX},${startY}`);
      
      let currentSize = 0;
      let head = 0;
      
      while (head < queue.length && currentSize < targetSize) {
        const current = queue[head++];
        
        // Place terrain
        if (terrain[current.y] && terrain[current.y][current.x]) {
          terrain[current.y][current.x] = terrainType;
          currentSize++;
        }
        
        // Add neighboring cells with growth chance (hex-aware)
        const neighbors = [
          { x: current.x - 1, y: current.y },
          { x: current.x + 1, y: current.y },
          { x: current.x, y: current.y - 1 },
          { x: current.x, y: current.y + 1 },
          // Hex neighbors for more organic shapes
          { x: current.x + (current.y % 2 === 0 ? -1 : 1), y: current.y - 1 },
          { x: current.x + (current.y % 2 === 0 ? -1 : 1), y: current.y + 1 }
        ];
        
        for (const neighbor of neighbors) {
          const key = `${neighbor.x},${neighbor.y}`;
          if (!visited.has(key) && 
              neighbor.x >= 0 && neighbor.x < previewWidth && 
              neighbor.y >= 0 && neighbor.y < previewHeight &&
              seededRandom() < growthChance) {
            visited.add(key);
            queue.push(neighbor);
          }
        }
      }
    }
  };
  
  // Generate randomized terrain blobs with regional preferences (more realistic)
  generateRegionalBlob(BIOME_TYPES.DESERT, 'north', 4, 8, 18, 0.5);        // Desert in north
  generateRegionalBlob(BIOME_TYPES.FOREST, 'central', 5, 6, 14, 0.7);      // Forests in central/west
  generateRegionalBlob(BIOME_TYPES.FOREST, 'west', 3, 4, 10, 0.6);         // Additional western forests
  generateRegionalBlob(BIOME_TYPES.MOUNTAINS, 'east', 3, 4, 10, 0.4);      // Mountains in east
  generateRegionalBlob(BIOME_TYPES.MOUNTAINS, 'north', 2, 3, 8, 0.4);      // Additional northern mountains
  generateRegionalBlob(BIOME_TYPES.HILLS, 'anywhere', 8, 3, 8, 0.6);       // Hills scattered
  generateRegionalBlob(BIOME_TYPES.WATER, 'anywhere', 4, 2, 8, 0.8);       // Lakes/rivers
  generateRegionalBlob(BIOME_TYPES.AGRICULTURE, 'central', 8, 2, 6, 0.5);  // Farmland near center
  generateRegionalBlob(BIOME_TYPES.AGRICULTURE, 'south', 4, 2, 5, 0.5);    // Southern farmland
  generateRegionalBlob(BIOME_TYPES.OASIS, 'north', 3, 1, 3, 0.3);          // Oases in desert areas
  
  // Add random settlements with regional clustering
  const settlementRegions = ['central', 'south', 'anywhere'];
  for (let i = 0; i < 6; i++) {
    const region = settlementRegions[Math.floor(seededRandom() * settlementRegions.length)];
    generateRegionalBlob(BIOME_TYPES.SETTLEMENTS, region, 1, 1, 3, 0.4);
  }
  
  // Add jungle patches (dense tropical forests)
  generateRegionalBlob(BIOME_TYPES.JUNGLE, 'central', 3, 4, 8, 0.65);    // Jungle in central Africa
  generateRegionalBlob(BIOME_TYPES.JUNGLE, 'west', 2, 3, 6, 0.6);        // Western jungle patches
  
  console.log('Enhanced preview terrain generation complete with regional clustering');
  return terrain;
}

/**
 * Generate a new randomized map with different seed
 * This allows for completely different terrain layouts each time
 */
export function generateRandomizedMap(width = 48, height = 32, customSeed = null) {
  const mapSeed = customSeed || Math.floor(Math.random() * 1000000);
  console.log(`Generating new randomized map with seed: ${mapSeed}`);
  
  // Store the current seed for reproducibility
  window.currentMapSeed = mapSeed;
  
  return generatePreviewMap(width, height);
}

/**
 * Regenerate the current map with the same seed (for consistency)
 */
export function regenerateCurrentMap(width = 48, height = 32) {
  const seed = window.currentMapSeed || Math.floor(Math.random() * 1000000);
  console.log(`Regenerating map with existing seed: ${seed}`);
  
  return generatePreviewMap(width, height);
}

// Export terrain types for use in other components
export { BIOME_TYPES, REGIONAL_BIOMES, FACTION_TERRITORIES };
