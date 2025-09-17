// js/map_utils.js

// Depends on: getCurrentZoomFactor, BASE_TILE_SIZE, canvas, ctx, MAP_COLS, MAP_ROWS,
//             map, memory, colors, activePlayerActor (all from core.js)
// Depends on: drawHex (from utils.js)
// Depends on: playerFovSet, petFovSet (passed as arguments from render.js)
// Depends on: chroma (if chroma.js is used and enabled for color manipulation from index.html)

function drawMapTiles(viewOffMapX, viewOffMapY, playerFovSet, petFovSet) {
    // This function appears to be for a 2D canvas rendering, which is superseded by the 3D rendering in main.js
    // If it's still used for something specific (like a debug view), it needs updating for the new map object structure.
    // For now, assuming it's deprecated or for a different rendering path than the main 3D view.
    // If you are still using a 2D canvas for the main map, here's how it would adapt:
    
    /*
    const mainZoomFactor = getCurrentZoomFactor();
    const currentHexVisualRadius = (BASE_TILE_SIZE / mainZoomFactor) * 0.75;

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
        // console.error("drawMapTiles: Canvas not ready or has zero dimensions.");
        return;
    }
    // ... (rest of the setup code for widths, heights, etc.) ...

    for (let screenCellY_idx = 0; screenCellY_idx < numHexesToDrawH; screenCellY_idx++) {
        for (let screenCellX_idx = 0; screenCellX_idx < numHexesToDrawW; screenCellX_idx++) {
            
            const mapX = viewOffMapX + Math.floor(screenCellX_idx * mainZoomFactor);
            const mapY = viewOffMapY + Math.floor(screenCellY_idx * mainZoomFactor);

            if (mapX >= 0 && mapY >= 0 && mapX < MAP_COLS && mapY < MAP_ROWS) {
                // ... (FoV and memory logic remains similar) ...
                
                const tileData = map[mapY]?.[mapX];
                const terrainChar = tileData ? tileData.terrain : ' '; // Get terrain from object
                // const resourceType = tileData ? tileData.resource : TILE_RESOURCES.NONE; // Get resource
                
                let colorToDraw = colors.UNSEEN; 
                // ... (Coloring logic based on FoV, terrainChar, and potentially resourceType) ...

                if (currentFrameFoVLevel >= 2) { // In direct FoV
                    const isGenericTerrain = terrainChar === 'P' || terrainChar === 'A' || terrainChar === ' ';
                    if (colors[terrainChar] && !isGenericTerrain) { // Specific color for terrain type
                        colorToDraw = colors[terrainChar];
                         if (currentFrameFoVLevel === 3 && typeof chroma !== 'undefined' && chroma.valid(colorToDraw)) { // Pet FoV boost
                            try { colorToDraw = chroma(colorToDraw).brighten(0.2).saturate(0.05).hex(); } catch(e){}
                        }
                    } else { // Generic FoV color
                         colorToDraw = (currentFrameFoVLevel === 3 && colors.PET_BOOST_FOV) ? colors.PET_BOOST_FOV : colors.REMEMBERED_IN_FOV;
                    }
                } else if (memory[mapY][mapX] >= 1) { // Remembered tile
                     colorToDraw = colors[terrainChar] || colors[' ']; 
                     // Desaturate/darken for remembered state
                     if(typeof chroma !== 'undefined' && chroma.valid(colorToDraw)){
                         try {colorToDraw = chroma(colorToDraw).darken(0.9).desaturate(0.7).hex();} catch(e){}
                     }
                } else { // Unseen
                    colorToDraw = colors.UNSEEN;
                }
                
                // ... (Actual drawing logic using drawHex or ctx.arc remains similar, using colorToDraw) ...
            }
        }
    }
    */
   // console.warn("drawMapTiles in map_utils.js may be deprecated or require updates for object map if used for 2D main canvas.");
}

function updateMapInfoHUD() {
    const tileTypeE = document.getElementById("hud-tile-type");
    const turnE = document.getElementById("hud-turn");
    const dateE = document.getElementById("hud-date");
    const resourceE = document.getElementById("hud-tile-resource"); // Assuming you add this element to index.html

    if (tileTypeE && typeof activePlayerActor !== 'undefined' && activePlayerActor && map[activePlayerActor.y] && map[activePlayerActor.y][activePlayerActor.x]) {
        const tileData = map[activePlayerActor.y][activePlayerActor.x];
        const terrainChar = tileData.terrain;
        const resourceType = tileData.resource;

        const TILE_NAMES = {'P':'Plains','F':'Forest','L':'Lake','O':'Mountain','H':'Hills','D':'Desert','M':'Marsh','V':'River','J':'Jungle','A':'Pasture','R':'Range','N':'Pond','S':'Start','B':'Beacon',' ':'Empty'};
        tileTypeE.textContent = TILE_NAMES[terrainChar] || terrainChar.toString();

        if (resourceE) { // Update resource display if element exists
            if (resourceType && resourceType !== TILE_RESOURCES.NONE) {
                resourceE.textContent = `Res: ${resourceType}`;
            } else {
                resourceE.textContent = "Res: None";
            }
        }

    } else {
        if (tileTypeE) tileTypeE.textContent = "--";
        if (resourceE) resourceE.textContent = "Res: --";
    }

    if (turnE) turnE.textContent = window.currentTurn || 1;
    if (dateE) dateE.textContent = window.currentDateString || "Year 1";
}