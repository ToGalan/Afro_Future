// js/render.js

window.playerFovSet = new Set();
window.petFovSet = new Set();

function updateTileVisibility() {
    if (!activePlayerActor || !allMapTileMeshes || allMapTileMeshes.length === 0) {
        return;
    }

    playerFovSet.clear();
    petFovSet.clear();

    let effectivePlayerFovRadius = PLAYER_FOV_RADIUS;
    // Check for Nia's "Rapid Scout" FoV buff
    if (activePlayerActor.activeBuffs && activePlayerActor.activeBuffs.some(b => b.id === "RapidScoutBuff" && b.duration > 0)) {
        const fovBuff = activePlayerActor.activeBuffs.find(b => b.id === "RapidScoutBuff");
        if (fovBuff && typeof fovBuff.value === 'number') {
            effectivePlayerFovRadius += fovBuff.value;
             // console.log("Rapid Scout Active! New FOV Radius: ", effectivePlayerFovRadius); // For Debug
        }
    }

    if (typeof getHexesInRadius === 'function') {
        getHexesInRadius(activePlayerActor.x, activePlayerActor.y, effectivePlayerFovRadius) // Use effective radius
            .forEach(p => playerFovSet.add(`${p[0]},${p[1]}`));
        
        if (pet && pet.typeId && !pet.isFallen && pet.hp > 0 && typeof pet.fovRadius === 'number' && pet.fovRadius > 0) { 
            getHexesInRadius(pet.x, pet.y, pet.fovRadius)
                .forEach(p => petFovSet.add(`${p[0]},${p[1]}`));
        }
    } else {
        console.error("getHexesInRadius function is missing! Cannot calculate FoV.");
        return;
    }
    
    allMapTileMeshes.forEach(hexMesh => {
        if (!hexMesh.userData || typeof hexMesh.userData.gridX === 'undefined') return; 

        const tileKey = `${hexMesh.userData.gridX},${hexMesh.userData.gridY}`;
        const isInPlayerFoV = playerFovSet.has(tileKey);
        const isInPetFoV = petFovSet.has(tileKey);
        const isInCurrentFoV = isInPlayerFoV || isInPetFoV;

        const tileGroup = hexMesh.parent; 
        const edgeMesh = hexMesh.userData.edgeMesh; 
        
        if (isInCurrentFoV) {
            if(tileGroup) tileGroup.visible = true; else hexMesh.visible = true;
            hexMesh.material = hexMesh.userData.originalMaterial;
            if (hexMesh.userData.resourceMesh) hexMesh.userData.resourceMesh.visible = true;
            
            // Hide clouds when tile is in FOV
            if (tileGroup && tileGroup.userData.cloudMesh) {
                tileGroup.userData.cloudMesh.visible = false;
            }
            
            if (edgeMesh && hexMesh.userData.originalMaterial.color) edgeMesh.material.color.set(chroma.valid(hexMesh.userData.originalMaterial.color.getHex()) ? chroma(hexMesh.userData.originalMaterial.color.getHex()).darken(1.5).hex() : 0x333333 );

            if (map[hexMesh.userData.gridY] && map[hexMesh.userData.gridY][hexMesh.userData.gridX]) { // Ensure map coords are valid
                memory[hexMesh.userData.gridY][hexMesh.userData.gridX] = 2;
            }
        } else {
            const memoryStatus = memory[hexMesh.userData.gridY]?.[hexMesh.userData.gridX];
            if (memoryStatus === 1 || memoryStatus === 2) { 
                if(tileGroup) tileGroup.visible = true; else hexMesh.visible = true;
                hexMesh.material = hexMesh.userData.rememberedMaterial;
                
                // Show clouds when tile is not in current FOV but is remembered
                if (tileGroup && tileGroup.userData.cloudMesh) {
                    tileGroup.userData.cloudMesh.visible = true;
                }
                
                if (hexMesh.userData.resourceMesh && map[hexMesh.userData.gridY] && map[hexMesh.userData.gridY][hexMesh.userData.gridX]) {
                     hexMesh.userData.resourceMesh.visible = map[hexMesh.userData.gridY][hexMesh.userData.gridX].resource !== TILE_RESOURCES.NONE;
                }
                if (edgeMesh && hexMesh.userData.rememberedMaterial.color) edgeMesh.material.color.set(chroma.valid(hexMesh.userData.rememberedMaterial.color.getHex()) ? chroma(hexMesh.userData.rememberedMaterial.color.getHex()).darken(0.5).hex() : 0x222222 );
                
                if (map[hexMesh.userData.gridY] && map[hexMesh.userData.gridY][hexMesh.userData.gridX] && memoryStatus === 2) {
                     memory[hexMesh.userData.gridY][hexMesh.userData.gridX] = 1; 
                }
            } else { 
                if(tileGroup) tileGroup.visible = false; else hexMesh.visible = false;
                if (hexMesh.userData.resourceMesh) hexMesh.userData.resourceMesh.visible = false; 
                
                // Hide clouds for unseen tiles
                if (tileGroup && tileGroup.userData.cloudMesh) {
                    tileGroup.userData.cloudMesh.visible = false;
                }
            }
        }
    });
}

function drawMinimap() {
    const miniCanvas = document.getElementById('minimap'); // Get canvas element
    if (!miniCanvas) return;
    const miniCtx = miniCanvas.getContext('2d');
    if (!miniCtx) { return; }

    miniCtx.fillStyle = '#101015';
    miniCtx.fillRect(0, 0, miniCanvas.width, miniCanvas.height);

    if (!activePlayerActor || typeof activePlayerActor.x === 'undefined') return;

    const minimapEffectiveFactor = getCurrentMinimapEffectiveFactor();
    const mapColsOnMinimap = (minimapEffectiveFactor > 0) ? MAP_COLS / minimapEffectiveFactor : MAP_COLS;
    let minimapHexDrawRadius = (mapColsOnMinimap > 0 && miniCanvas.width > 0) ? (miniCanvas.width / mapColsOnMinimap) / Math.sqrt(3) : 0.05;
    if (minimapHexDrawRadius < 0.1) minimapHexDrawRadius = 0.1; // Prevent it from becoming too small to draw anything

    const minimapHexVisualWidth = Math.sqrt(3) * minimapHexDrawRadius;
    const minimapHexVisualHeight = 2 * minimapHexDrawRadius;
    const minimapVertSpacingVisual = minimapHexVisualHeight * 0.75;
    const mapRowsActuallyDisplayedOnMinimap = (minimapVertSpacingVisual > 0) ? (miniCanvas.height / minimapVertSpacingVisual) : MAP_ROWS;

    let minimapViewOffMapX = Math.floor(activePlayerActor.x - mapColsOnMinimap / 2);
    let minimapViewOffMapY = Math.floor(activePlayerActor.y - mapRowsActuallyDisplayedOnMinimap / 2);
    minimapViewOffMapX = Math.max(0, Math.min(minimapViewOffMapX, MAP_COLS - Math.ceil(mapColsOnMinimap)));
    minimapViewOffMapY = Math.max(0, Math.min(minimapViewOffMapY, MAP_ROWS - Math.ceil(mapRowsActuallyDisplayedOnMinimap)));
    if (mapColsOnMinimap >= MAP_COLS) minimapViewOffMapX = 0;
    if (mapRowsActuallyDisplayedOnMinimap >= MAP_ROWS) minimapViewOffMapY = 0;

    const screenCellsToDrawW = (minimapHexVisualWidth > 0) ? Math.ceil(miniCanvas.width / minimapHexVisualWidth) + 2 : MAP_COLS;
    const screenCellsToDrawH = (minimapVertSpacingVisual > 0) ? Math.ceil(miniCanvas.height / minimapVertSpacingVisual) + 2 : MAP_ROWS;

    for (let y_idx = 0; y_idx < screenCellsToDrawH; y_idx++) {
        for (let x_idx = 0; x_idx < screenCellsToDrawW; x_idx++) {
            const mapC = Math.floor(minimapViewOffMapX + x_idx);
            const mapR = Math.floor(minimapViewOffMapY + y_idx);
            if (mapR < 0 || mapR >= MAP_ROWS || mapC < 0 || mapC >= MAP_COLS) continue;
            
            const memoryStatus = memory[mapR]?.[mapC];
            if (!memoryStatus || memoryStatus === 0) continue; // Skip unseen

            const tileKey = `${mapC},${mapR}`;
            const isInCurrentFoV = playerFovSet.has(tileKey) || (petFovSet && petFovSet.has(tileKey));
            const miniScreenX = x_idx * minimapHexVisualWidth + ((mapR % 2 !== 0) * minimapHexVisualWidth / 2);
            const miniScreenY = y_idx * minimapVertSpacingVisual;
            
            let color; 
            const tileData = map[mapR]?.[mapC]; 
            const terrainChar = tileData ? tileData.terrain : ' '; 

            if (mapC === activePlayerActor.x && mapR === activePlayerActor.y) color = colors['PLAYER_MINIMAP'] || 'yellow';
            else if (pet && pet.typeId && !pet.isFallen && pet.hp > 0 && mapC === pet.x && mapR === pet.y) color = pet.baseColor || colors['PET_MINIMAP'] || 'magenta';
            else if (enemies.some(e => !e.isDefeated && e.x === mapC && e.y === mapR && isInCurrentFoV)) color = colors['ENEMY_MINIMAP'] || 'red';
            else {
                 const matColorKey = `MAT_${terrainChar.toUpperCase()}`;
                 let baseColorNum = colors[matColorKey] || colors['MAT_DEFAULT'] || 0x777777;
                 let baseColorHex = `#${(baseColorNum & 0xFFFFFF).toString(16).padStart(6, '0')}`; // Ensure it's a hex string
                 
                 color = baseColorHex;
                 if (!isInCurrentFoV && (memoryStatus === 1 || memoryStatus === 2)) { // Remembered tile
                    if (typeof chroma !== 'undefined' && chroma.valid(color)) {
                        try{ color = chroma(color).darken(1.2).desaturate(0.8).hex(); } catch(e){}
                    } else {
                        color = chroma(colors['MAT_REMEMBERED'] || '#505048').darken(0.5).hex(); // Fallback remembered styling
                    }
                 } else if (!isInCurrentFoV) { // This should ideally not be hit if memoryStatus > 0
                     color = colors['UNSEEN'] || '#101010';
                 }
            }
            if (color && color !== (colors['UNSEEN'] || '#101010')) {
                if (typeof drawHex === 'function' && minimapHexDrawRadius >= 0.3) {
                    drawHex(miniCtx, miniScreenX + minimapHexVisualWidth / 2, miniScreenY + minimapHexVisualHeight / 2, minimapHexDrawRadius, color);
                } else if (minimapHexDrawRadius >= 0.1) { 
                    miniCtx.fillStyle = color; 
                    miniCtx.fillRect(Math.floor(miniScreenX + minimapHexVisualWidth/2 - minimapHexDrawRadius*0.5), Math.floor(miniScreenY + minimapHexVisualHeight/2 - minimapHexDrawRadius*0.5), Math.max(1, minimapHexDrawRadius), Math.max(1, minimapHexDrawRadius)); 
                }
            }
        }
    }
    const playerMiniX = (activePlayerActor.x - minimapViewOffMapX) * minimapHexVisualWidth + ((activePlayerActor.y % 2 !== 0) * minimapHexVisualWidth/2) + minimapHexVisualWidth/2;
    const playerMiniY = (activePlayerActor.y - minimapViewOffMapY) * minimapVertSpacingVisual + minimapHexVisualHeight/2;
    
    // Get effective player FoV radius for minimap display, considering buffs
    let effectiveMinimapFovDisplayRadius = PLAYER_FOV_RADIUS;
     if (activePlayerActor.activeBuffs && activePlayerActor.activeBuffs.some(b => b.id === "RapidScoutBuff" && b.duration > 0)) {
        const fovBuff = activePlayerActor.activeBuffs.find(b => b.id === "RapidScoutBuff");
        if (fovBuff && typeof fovBuff.value === 'number') effectiveMinimapFovDisplayRadius += fovBuff.value;
    }
    // Approximated radius in pixels for the minimap FoV circle
    const fovRadiusMinimapPixels = effectiveMinimapFovDisplayRadius * minimapHexVisualWidth * 0.7; 

    if (fovRadiusMinimapPixels > 0) {
        miniCtx.beginPath();
        miniCtx.arc(playerMiniX, playerMiniY, fovRadiusMinimapPixels, 0, Math.PI * 2);
        miniCtx.strokeStyle = 'rgba(255, 255, 100, 0.25)';
        miniCtx.lineWidth = Math.max(1, minimapHexDrawRadius*0.4);
        miniCtx.stroke();
    }
}


function render() {
    if(typeof updatePlayerHUD === 'function') updatePlayerHUD();
    if(typeof updatePetHUD === 'function' && pet && pet.typeId) updatePetHUD();
    if(typeof updateMapInfoHUD === 'function') updateMapInfoHUD();
    if(typeof updateMissionProgress === 'function') updateMissionProgress();
    
    if (typeof updateTileVisibility === 'function') updateTileVisibility();
    else console.warn("updateTileVisibility function not found; FoV updates will not occur.");
      // Animate clouds if the cloud system is available
    if (typeof animateClouds === 'function') {
        animateClouds();
    }
    
    // Animate trees if the tree system is available
    if (typeof animateTrees === 'function') {
        animateTrees();
    }
    
    if (window.threeRenderer && window.threeScene && window.threeCamera) {
        window.threeRenderer.render(window.threeScene, window.threeCamera);
    }
    
    if(typeof drawMinimap === 'function') drawMinimap();
}