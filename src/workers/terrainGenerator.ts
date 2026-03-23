// Web Worker for terrain generation
// Runs off-main-thread to avoid blocking UI

interface TerrainGeneratorMessage {
  type: 'generate';
  width: number;
  height: number;
  seed: number;
  id: string;
}

interface GeneratedTerrain {
  type: 'complete';
  id: string;
  tileData: string; // JSON-stringified tile array
}

// PRNG
function seededRand(seed: number) {
  let t = seed + 0x6d2b79f5;
  return () => {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function charToType(c: string): string {
  if (c === 'L' || c === 'N' || c === 'V') return 'water';
  if (c === 'F') return 'forest';
  if (c === 'J') return 'jungle';
  if (c === 'H') return 'hills';
  if (c === 'D') return 'desert';
  if (c === 'O' || c === 'R' || c === 'M') return 'mountain';
  return 'plains';
}

function axialNeighbors(q: number, r: number): Array<[number, number]> {
  return [
    [q + 1, r],
    [q - 1, r],
    [q, r + 1],
    [q, r - 1],
    [q + 1, r - 1],
    [q - 1, r + 1],
  ];
}

function key(q: number, r: number): string {
  return `${q},${r}`;
}

function generateTerrainMapRect(width: number, height: number, seed = 42): Array<{q: number; r: number; type: string; char: string; resource: null}> {
  const rng = seededRand(seed);
  
  interface Coord { q: number; r: number; }
  const coords: Coord[] = [];
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      const q = col;
      const r = row - ((col & 1) ? ((col + 1) >> 1) : (col >> 1));
      coords.push({ q, r });
    }
  }
  const total = coords.length;

  const biomeConfigs: Array<{
    key: string;
    ratio: number;
    minSeeds: number;
    maxSeeds: number;
    chars: string[];
    growthProb: number;
  }> = [
    { key: 'water',    ratio: 0.085, minSeeds: 6,  maxSeeds: 14, chars: ['L','N','V'], growthProb: 0.58 },
    { key: 'desert',   ratio: 0.105, minSeeds: 7, maxSeeds: 16, chars: ['D'],        growthProb: 0.63 },
    { key: 'forest',   ratio: 0.135, minSeeds: 8, maxSeeds: 18, chars: ['F'],        growthProb: 0.66 },
    { key: 'jungle',   ratio: 0.065, minSeeds: 5, maxSeeds: 12, chars: ['J'],        growthProb: 0.60 },
    { key: 'hills',    ratio: 0.105, minSeeds: 7, maxSeeds: 16, chars: ['H'],        growthProb: 0.60 },
    { key: 'mountain', ratio: 0.075, minSeeds: 6, maxSeeds: 14, chars: ['O','R','M'],growthProb: 0.53 },
  ];

  function shuffle<T>(arr: T[]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const assigned = new Map<string, string>();
  const claimedByBiome = new Map<string, number>();
  const targetByBiome = new Map<string, number>();
  const frontierByBiome = new Map<string, Array<{ q: number; r: number }>>();

  for (const cfg of biomeConfigs) {
    const target = Math.max(1, Math.floor(total * cfg.ratio));
    targetByBiome.set(cfg.key, target);
    claimedByBiome.set(cfg.key, 0);
    frontierByBiome.set(cfg.key, []);
    let seedCount = Math.min(cfg.maxSeeds, Math.max(cfg.minSeeds, Math.floor(Math.sqrt(target) * 0.9)));
    if (width * height > 15000) {
      seedCount = Math.max(cfg.minSeeds, Math.floor(seedCount * 0.55));
    }
    const pool = shuffle([...coords]);
    let placed = 0; let idx = 0;
    while (placed < seedCount && idx < pool.length) {
      const c = pool[idx++];
      const k = key(c.q, c.r);
      if (assigned.has(k)) continue;
      const char = cfg.chars[Math.floor(rng() * cfg.chars.length)];
      assigned.set(k, char);
      claimedByBiome.set(cfg.key, (claimedByBiome.get(cfg.key) || 0) + 1);
      frontierByBiome.get(cfg.key)!.push(c);
      placed++;
    }
  }

  const maxIterations = total * 4;
  let iterations = 0;
  const coordSet = new Set<string>(coords.map(c => key(c.q, c.r)));
  const unfinished = () => biomeConfigs.some(cfg => (claimedByBiome.get(cfg.key) || 0) < (targetByBiome.get(cfg.key) || 0));
  
  while (unfinished() && iterations < maxIterations) {
    iterations++;
    const order = shuffle([...biomeConfigs]);
    for (const cfg of order) {
      const current = claimedByBiome.get(cfg.key)!;
      const target = targetByBiome.get(cfg.key)!;
      if (current >= target) continue;
      const frontier = frontierByBiome.get(cfg.key)!;
      if (frontier.length === 0) continue;
      
      const fi = Math.floor(rng() * frontier.length);
      const cell = frontier[fi];
      const neigh = shuffle(axialNeighbors(cell.q, cell.r).map(([q, r]) => ({ q, r })));
      
      for (const n of neigh) {
        if (claimedByBiome.get(cfg.key)! >= target) break;
        const nk = key(n.q, n.r);
        if (!coordSet.has(nk)) continue;
        if (assigned.has(nk)) continue;
        
        const fillRatio = current / target;
        const prob = cfg.growthProb * (fillRatio < 0.5 ? 1 : (1 - 0.4 * (fillRatio - 0.5)));
        if (rng() < prob) {
          const char = cfg.chars[Math.floor(rng() * cfg.chars.length)];
          assigned.set(nk, char);
          claimedByBiome.set(cfg.key, (claimedByBiome.get(cfg.key) || 0) + 1);
          frontier.push(n);
        }
      }
      
      if (iterations % 25 === 0) {
        for (let i = frontier.length - 1; i >= 0; i--) {
          const c = frontier[i];
          let open = false;
          for (const [nq, nr] of axialNeighbors(c.q, c.r)) {
            const nk = key(nq, nr);
            if (coordSet.has(nk) && !assigned.has(nk)) { open = true; break; }
          }
          if (!open) frontier.splice(i, 1);
        }
      }
    }
  }

  const tiles: Array<{q: number; r: number; type: string; char: string; resource: null}> = [];
  for (const c of coords) {
    const k = key(c.q, c.r);
    const char = assigned.get(k) || 'P';
    const type = charToType(char);
    tiles.push({ q: c.q, r: c.r, char, type, resource: null });
  }

  return tiles;
}

// Handle incoming messages
self.onmessage = function(event: MessageEvent<TerrainGeneratorMessage>) {
  if (event.data.type === 'generate') {
    const { width, height, seed, id } = event.data;
    const startTime = performance.now();
    
    try {
      const tiles = generateTerrainMapRect(width, height, seed);
      const duration = performance.now() - startTime;
      
      const response: GeneratedTerrain = {
        type: 'complete',
        id,
        tileData: JSON.stringify(tiles),
      };
      
      self.postMessage(response);
    } catch (error) {
      self.postMessage({
        type: 'error',
        id,
        error: String(error),
      });
    }
  }
};
