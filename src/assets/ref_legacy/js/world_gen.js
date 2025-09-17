// js/world_gen.js

// Depends on: ODD_R_OFFSETS (from utils.js)
// Depends on: map, MAP_COLS, MAP_ROWS, IMPASSABLE_TILES, WORLD_GEN_PARAMS, TILE_RESOURCES (from core.js)

function getValidNeighborsWG(x, y) { // For world generation pathing
    const neighbors = [];
    const parity = Math.abs(y % 2);
    const offsets = ODD_R_OFFSETS[parity];
    if (!offsets) {
        console.error(`getValidNeighborsWG: No offsets found for Y=${y}, parity ${parity}. Check ODD_R_OFFSETS in utils.js.`);
        return neighbors;
    }
    for (const [dx, dy] of offsets) {
        const nX = x + dx;
        const nY = y + dy;
        if (nX >= 0 && nX < MAP_COLS && nY >= 0 && nY < MAP_ROWS) {
            neighbors.push({ x: nX, y: nY });
        }
    }
    return neighbors;
}

// Updated to correctly set terrain on map objects
function generateBlob(startX, startY, terrainChar, paramsKey) {
    const params = WORLD_GEN_PARAMS[paramsKey] || {};
    const minSize = params.sizeMin || 5;
    const maxSize = params.sizeMax || Math.max(10, minSize + 5);
    let chanceToGrow = params.chanceToGrow;
    if (typeof chanceToGrow === 'undefined' || chanceToGrow <= 0 || chanceToGrow >= 1) {
        chanceToGrow = 0.6;
    }
    const maxGrowthSteps = params.maxGrowthSteps || maxSize * 10;

    let currentSize = 0;
    const queue = [{ x: startX, y: startY }];
    const visited = new Set();
    visited.add(`${startX},${startY}`);

    let head = 0;
    let steps = 0;

    while (head < queue.length && currentSize < maxSize && steps < maxGrowthSteps) {
        const current = queue[head++];
        steps++;

        const tileDataAtCurrent = map[current.y]?.[current.x];
        if (tileDataAtCurrent && tileDataAtCurrent.terrain !== 'S' && tileDataAtCurrent.terrain !== 'B' &&
            (tileDataAtCurrent.terrain === 'P' || tileDataAtCurrent.terrain === ' ' || tileDataAtCurrent.terrain === terrainChar || !IMPASSABLE_TILES.has(tileDataAtCurrent.terrain))) {

            if (map[current.y] && map[current.y][current.x]) {
                map[current.y][current.x].terrain = terrainChar;
                // If this blob overwrites, ensure resource is reset (unless blob itself IS a resource patch, handled separately)
                 if (terrainChar !== 'P' && terrainChar !== 'A' && terrainChar !== 'D' && terrainChar !== 'H' && terrainChar !== 'M' && terrainChar !== 'O' && terrainChar !== 'R') { // Only reset for non-resource bearing generating terrains.
                    map[current.y][current.x].resource = TILE_RESOURCES.NONE;
                 }
            }
            currentSize++;
        }

        if (currentSize >= maxSize) break;

        const neighbors = getValidNeighborsWG(current.x, current.y);
        for (const neighbor of neighbors) {
            const key = `${neighbor.x},${neighbor.y}`;
            if (!visited.has(key) && Math.random() < chanceToGrow) {
                visited.add(key);
                queue.push(neighbor);
            }
        }
    }

    if (currentSize < minSize && queue.length > head) {
        while (head < queue.length && currentSize < minSize && steps < maxGrowthSteps * 2) {
            const fillCell = queue[head++];
            steps++;
            const tileDataAtFill = map[fillCell.y]?.[fillCell.x];
             if (tileDataAtFill && tileDataAtFill.terrain !== 'S' && tileDataAtFill.terrain !== 'B' &&
                (tileDataAtFill.terrain === 'P' || tileDataAtFill.terrain === ' ' || tileDataAtFill.terrain === terrainChar || !IMPASSABLE_TILES.has(tileDataAtFill.terrain))) {
                if (map[fillCell.y] && map[fillCell.y][fillCell.x]) {
                    map[fillCell.y][fillCell.x].terrain = terrainChar;
                     if (terrainChar !== 'P' && terrainChar !== 'A' && terrainChar !== 'D' && terrainChar !== 'H' && terrainChar !== 'M' && terrainChar !== 'O' && terrainChar !== 'R') {
                        map[fillCell.y][fillCell.x].resource = TILE_RESOURCES.NONE;
                     }
                }
                currentSize++;
            }
        }
    }
}


function generateLakesAndPonds(numLakes, numPonds) {
    for (let i = 0; i < numLakes; i++) generateBlob(Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*MAP_ROWS),'L','lakes');
    for (let i = 0; i < numPonds; i++) generateBlob(Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*MAP_ROWS),'N','ponds');
}

function generateMountainRanges(count) {
    const p = WORLD_GEN_PARAMS.mountainRanges;
    for (let i = 0; i < count; i++) {
        let sX=Math.floor(Math.random()*MAP_COLS); let sY=Math.floor(Math.random()*MAP_ROWS);
        let cL=0; let cX=sX; let cY=sY; let att=(p.targetSize||16)*3;
        while(cL<(p.targetSize||16)&&att>0){
            att--;
            const tileData=map[cY]?.[cX];
            if(tileData && tileData.terrain !=='S' && tileData.terrain !=='B'){
                tileData.terrain='R'; tileData.resource = TILE_RESOURCES.NONE; cL++;
                if(Math.random()<(p.mountainBlobChance||0.3))generateBlob(cX,cY,'O','mountains'); // mountains can be blobs
            }
            const nS=getValidNeighborsWG(cX,cY);if(nS.length===0)break;
            const nMo=nS[Math.floor(Math.random()*nS.length)];cX=nMo.x;cY=nMo.y;
            if(map[cY]?.[cX]?.terrain==='R'&&Math.random()<0.7)break;
        }
    }
}

function generateMountains(count){for(let i=0;i<count;i++)generateBlob(Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*MAP_ROWS),'O','mountains');}
function generateHills(count){for(let i=0;i<count;i++)generateBlob(Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*MAP_ROWS),'H','hills');}
function generateForests(count){for(let i=0;i<count;i++)generateBlob(Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*MAP_ROWS),'F','forests');}
function generateJungles(count){for(let i=0;i<count;i++)generateBlob(Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*MAP_ROWS),'J','jungles');}
function generatePastures(count){for(let i=0;i<count;i++)generateBlob(Math.floor(Math.random()*MAP_COLS),Math.floor(Math.random()*MAP_ROWS),'A','pastures');}

function generateDeserts(count){
    const p=WORLD_GEN_PARAMS.deserts;
    const avgW=Math.floor(MAP_COLS/(p.avgWidthScaleFactor||10));
    const minH=Math.floor(MAP_ROWS/(p.heightMinScaleFactor||12));
    const maxH=Math.floor(MAP_ROWS/(p.heightMaxScaleFactor||6));
    for(let i=0;i<count;i++){
        const dH=(maxH>=minH)?Math.floor(Math.random()*(maxH-minH+1))+minH : minH;
        if (dH <=0 || avgW <= 0) continue;
        const sY=Math.floor(Math.random()*(MAP_ROWS-dH +1));
        const sX=Math.floor(Math.random()*(MAP_COLS-avgW +1));
        for(let y=sY;y<sY+dH&&y<MAP_ROWS;y++){
            for(let x=sX;x<sX+avgW&&x<MAP_COLS;x++){
                const tileData=map[y]?.[x];
                if(tileData && tileData.terrain !=='S'&&tileData.terrain !=='B'&&tileData.terrain !=='L'&&tileData.terrain !=='N'&&tileData.terrain !=='V'&&tileData.terrain !=='R'&&tileData.terrain !=='O'){
                    if(Math.random()<(p.density||0.85)) {
                        tileData.terrain='D';
                        tileData.resource = TILE_RESOURCES.NONE; // Deserts don't inherently provide special resources here
                    }
                }
            }
        }
    }
}

function generateRivers(count){
    for(let i=0;i<count;i++){
        let sN=null;const wS=[];
        for(let r=0;r<MAP_ROWS;r++)for(let c=0;c<MAP_COLS;c++)if(map[r]?.[c]?.terrain==='L'||map[r]?.[c]?.terrain==='N')wS.push({x:c,y:r});
        if(wS.length>0&&Math.random()<0.8)sN=wS[Math.floor(Math.random()*wS.length)];
        else{const onX=Math.random()<0.5;if(onX)sN={x:(Math.random()<0.5?0:MAP_COLS-1),y:Math.floor(Math.random()*MAP_ROWS)};else sN={x:Math.floor(Math.random()*MAP_COLS),y:(Math.random()<0.5?0:MAP_ROWS-1)};}
        if (!sN || typeof sN.x === 'undefined' || typeof sN.y === 'undefined') continue;
        let cX=sN.x;let cY=sN.y;let rL=0;
        const mL=Math.floor(Math.max(MAP_COLS,MAP_ROWS)/1.5);let att=mL*2;
        while(rL<mL&&att>0){
            att--;
            const tileData=map[cY]?.[cX];
            if(tileData && tileData.terrain !=='S'&&tileData.terrain !=='B'&&tileData.terrain !=='R'&&tileData.terrain !=='O'&&tileData.terrain !=='L'&&tileData.terrain !=='N'){
                tileData.terrain='V';
                tileData.resource = TILE_RESOURCES.NONE;
            }
            rL++;const nS=getValidNeighborsWG(cX,cY);if(nS.length===0)break;
            let bN=null;let bS=-Infinity;
            for(const n of nS){
                let s=Math.random()*2;if(n.y>cY)s+=6;else if(n.y<cY&&cY>MAP_ROWS*0.3)s-=3;
                const nTerrain=map[n.y]?.[n.x]?.terrain;
                if(nTerrain==='V')s-=25;if(nTerrain==='L'||nTerrain==='N')s+=150;
                if((n.y===0&&cY!==0)||(n.y===MAP_ROWS-1&&cY!==MAP_ROWS-1)||(n.x===0&&cX!==0)||(n.x===MAP_COLS-1&&cX!==MAP_COLS-1))s+=5;
                if(nTerrain==='O'||nTerrain==='R')s-=60; if(s>bS){bS=s;bN=n;}
            }
            if(bN){cX=bN.x;cY=bN.y;const nTerrain=map[cY]?.[cX]?.terrain;if(nTerrain==='L'||nTerrain==='N'||nTerrain==='V')break;}
            else break;
        }
    }
}

// initializeWorldMap from world_gen.js is typically not the main driver, main.js handles orchestration.
// Kept generateTileResources here as per your file upload, will be called from main.js
function initializeWorldMap() {
    // This is a placeholder for the original file content which now resides mostly in main.js for init.
    // The primary role here will be individual gen functions and the resource generation.
    console.log("World_gen.js: initializeWorldMap stub (actual initialization in main.js).");
}


function generateTileResources(mapInstance) { // mapInstance is the global map
    console.log("World Gen: Attempting to place resources...");
    let placedScrap = 0;
    let placedCrystals = 0;

    for (let r = 0; r < MAP_ROWS; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
            if (mapInstance[r] && mapInstance[r][c]) {
                const tile = mapInstance[r][c]; // tile is now an object {terrain: 'X', resource: Y, ...}
                // Avoid placing resources on Start/Beacon or impassable tiles by default
                if (tile.terrain === 'S' || tile.terrain === 'B' || IMPASSABLE_TILES.has(tile.terrain)) {
                    continue;
                }

                // Place Scrap Piles on Plains, Desert, or Hills
                if (tile.resource === TILE_RESOURCES.NONE && (tile.terrain === 'P' || tile.terrain === 'D' || tile.terrain === 'H')) {
                    if (Math.random() < 0.02) { // 2% chance for scrap
                        tile.resource = TILE_RESOURCES.SCRAP_PILE;
                        placedScrap++;
                    }
                }

                // Place Energy Crystals on Hills, Mountains (O, R, M), ensuring not already scrap
                if (tile.resource === TILE_RESOURCES.NONE && (tile.terrain === 'H' || tile.terrain === 'O' || tile.terrain === 'R' || tile.terrain === 'M')) {
                    if (Math.random() < 0.015) { // 1.5% chance for crystals
                        tile.resource = TILE_RESOURCES.ENERGY_CRYSTAL;
                        placedCrystals++;
                    }
                }
            }
        }
    }
    console.log(`World Gen: Placed ${placedScrap} Scrap Piles and ${placedCrystals} Energy Crystals.`);
}