// Client-side chunk fetching & caching service
// Feature flag: only used if import.meta.env.VITE_USE_CHUNKS === 'true'

export interface ChunkTile { col: number; row: number; char: string; resource: string | null; }
export interface MapChunk { cx: number; cy: number; w: number; h: number; tiles: ChunkTile[]; seed: number; version: number; }

const chunkStore = new Map<string, MapChunk>();
const inFlight = new Map<string, Promise<MapChunk>>();

function key(cx: number, cy: number) { return `${cx}:${cy}`; }

export function getCachedChunk(cx: number, cy: number): MapChunk | undefined {
  return chunkStore.get(key(cx, cy));
}

export async function fetchChunk(cx: number, cy: number): Promise<MapChunk> {
  const k = key(cx, cy);
  const cached = chunkStore.get(k);
  if (cached) return cached;
  if (inFlight.has(k)) return inFlight.get(k)!;
  const p = (async () => {
    const url = `/api/map/chunk?cx=${cx}&cy=${cy}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`chunk_fetch_failed:${res.status}`);
    const json = await res.json();
    chunkStore.set(k, json);
    inFlight.delete(k);
    return json as MapChunk;
  })();
  inFlight.set(k, p);
  return p;
}

export function requiredChunksAround(col: number, row: number, viewRadiusTiles: number, chunkSize: number) {
  const minCol = Math.max(0, col - viewRadiusTiles);
  const maxCol = col + viewRadiusTiles;
  const minRow = Math.max(0, row - viewRadiusTiles);
  const maxRow = row + viewRadiusTiles;
  const minCx = Math.floor(minCol / chunkSize);
  const maxCx = Math.floor(maxCol / chunkSize);
  const minCy = Math.floor(minRow / chunkSize);
  const maxCy = Math.floor(maxRow / chunkSize);
  const list: Array<{ cx: number; cy: number }> = [];
  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) list.push({ cx, cy });
  }
  return list;
}

export function allLoadedTiles(): ChunkTile[] {
  const out: ChunkTile[] = [];
  for (const c of chunkStore.values()) out.push(...c.tiles);
  return out;
}
