/**
 * Integration helper for existing main.js
 * Adds 3D system compatibility to your existing code
 */

// Ensure THREE is available when imported in module environments
const THREE = (typeof window !== 'undefined' && window.THREE) ? window.THREE : (typeof globalThis !== 'undefined' ? globalThis.THREE : undefined);

// Enhanced createThreeJSHexTile function integration
window.enhanceHexTileWithStyle = function(material, terrainType) {
    if (window.threeDSystem?.createStyledMaterial) {
        return window.threeDSystem.styleManager.applyHexTileStyle(material, terrainType);
    }
    return material;
};

// Mountain integration with terrain generation
window.addMountainToTile = function(tileGroup, terrainChar, tileX, tileY, actualHeight) {
    // Only add mountains to mountain terrain types
    if (terrainChar !== 'M' && terrainChar !== 'O' && terrainChar !== 'R') {
        return;
    }
    
    if (!window.mountainSystem) {
        // Try to initialize the mountain system if we have the scene and class
        if (window.threeScene && typeof MountainSystem === 'function') {
            window.mountainSystem = new MountainSystem(window.threeScene, {
                mountainScale: 0.8,
                mountainHeightVariation: 0.3
            });
            console.log('Mountain system initialized on-demand');
        } else {
            console.warn('Cannot initialize mountain system: threeScene or MountainSystem not available');
            return;
        }
    }
      // Determine mountain type based on terrain character and probability
    // 70% flat-topped mountains, 30% pointy mountains with snow caps
    let mountainType = 'flat_mesa'; // default
    
    const probabilityHash = ((tileX * 113) + (tileY * 131)) % 100;
    const usePointyMountain = probabilityHash < 30; // 30% chance for pointy mountains
    
    if (terrainChar === 'M') {
        // Single mountains - mix of types
        const typeHash = ((tileX * 89) + (tileY * 67)) % 100;
        if (usePointyMountain) {
            // Pointy mountains with snow caps (30%)
            if (typeHash < 40) mountainType = 'peak_kilimanjaro';
            else if (typeHash < 70) mountainType = 'peak_atlas';
            else mountainType = 'peak_drakensberg';
        } else {
            // Flat-topped mountains (70%)
            if (typeHash < 30) mountainType = 'flat_mesa';
            else if (typeHash < 55) mountainType = 'flat_plateau';
            else if (typeHash < 80) mountainType = 'flat_butte';
            else mountainType = 'flat_table';
        }
    } else if (terrainChar === 'O') {
        // Mountain peaks - prefer taller types
        const typeHash = ((tileX * 73) + (tileY * 97)) % 100;
        if (usePointyMountain) {
            // Pointy peaks with snow caps (30%)
            if (typeHash < 50) mountainType = 'peak_kilimanjaro';
            else if (typeHash < 80) mountainType = 'peak_atlas';
            else mountainType = 'peak_drakensberg';
        } else {
            // Flat-topped peaks (70%)
            if (typeHash < 40) mountainType = 'flat_plateau';
            else if (typeHash < 70) mountainType = 'flat_table';
            else mountainType = 'flat_mesa';
        }
    } else if (terrainChar === 'R') {
        // Mountain ranges - varied sizes
        const typeHash = ((tileX * 59) + (tileY * 83)) % 100;
        if (usePointyMountain) {
            // Pointy range mountains with snow caps (30%)
            if (typeHash < 50) mountainType = 'peak_drakensberg';
            else if (typeHash < 80) mountainType = 'peak_atlas';
            else mountainType = 'peak_kilimanjaro';
        } else {
            // Flat-topped range mountains (70%)
            if (typeHash < 35) mountainType = 'flat_butte';
            else if (typeHash < 70) mountainType = 'flat_mesa';
            else mountainType = 'flat_table';
        }
    }// Create the mountain mesh directly instead of using addMountain
    // This avoids conflicts with the mountain system's internal tracking
    console.log(`  Attempting to create mountain mesh of type: ${mountainType}`);
    const mountainMesh = window.mountainSystem.createMountainMesh(mountainType);
    
    if (mountainMesh) {
        console.log(`  Mountain mesh created successfully, adding to tile group...`);        // Apply positioning relative to tile
        // Position mountain on top of the tile surface
        // actualHeight is the total height of the tile, position mountain above it
        mountainMesh.position.set(0, actualHeight * 0.5, 0);        // Apply scaling variation
        const baseScale = 1.0 + Math.random() * 0.5; // Scale variation: 100% to 150%
        mountainMesh.scale.setScalar(baseScale);
        
        // Apply rotation for natural variation
        mountainMesh.rotation.y = Math.random() * Math.PI * 2;
        mountainMesh.rotation.x = (Math.random() - 0.5) * 0.1;
        mountainMesh.rotation.z = (Math.random() - 0.5) * 0.1;
        
        // Add the mountain to the tile group
        tileGroup.add(mountainMesh);
        
        console.log(`✅ Added ${mountainType} mountain to tile (${tileX}, ${tileY}) with terrain '${terrainChar}'`);
    } else {
        console.error(`❌ Failed to create mountain mesh of type: ${mountainType}`);
    }
};

// Pasture integration with terrain generation
window.addPastureToTile = function(tileGroup, terrainChar, tileX, tileY, actualHeight) {
    console.log(`🌾 addPastureToTile called with terrain '${terrainChar}' at (${tileX}, ${tileY})`);
    
    // Validate inputs
    if (!tileGroup || !(tileGroup instanceof THREE.Group)) {
        console.error('❌ Invalid tileGroup provided to addPastureToTile');
        return;
    }
    
    // Only add pasture elements to pasture and plains terrain types
    if (terrainChar !== 'A' && terrainChar !== 'P') {
        console.log(`⚠️ Skipping terrain '${terrainChar}' - not pasture (A) or plains (P)`);
        return;
    }
    
    console.log(`✅ Processing ${terrainChar === 'A' ? 'pasture' : 'plains'} tile at (${tileX}, ${tileY})`);
    
    // Initialize pasture system if needed and scene is available
    if (!window.pastureSystem) {
        console.log('🔧 Attempting to initialize pasture system...');
        
        // Check if scene is available
        if (!window.threeScene) {
            console.log('⏳ Three.js scene not yet available, deferring pasture system initialization');
            // Store the request for later processing
            if (!window.deferredPastureTiles) {
                window.deferredPastureTiles = [];
            }
            window.deferredPastureTiles.push({
                tileGroup, terrainChar, tileX, tileY, actualHeight
            });
            return;
        }
        
        // Check if PastureSystem class is available
        if (typeof PastureSystem !== 'function') {
            console.error('❌ PastureSystem class not available');
            return;
        }
        
        try {
            window.pastureSystem = new PastureSystem(window.threeScene);
            console.log('✅ Pasture system initialized on-demand');
            
            // Process any deferred tiles
            if (window.deferredPastureTiles && window.deferredPastureTiles.length > 0) {
                console.log(`🔄 Processing ${window.deferredPastureTiles.length} deferred pasture tiles`);
                const deferred = window.deferredPastureTiles.slice(); // Copy array
                window.deferredPastureTiles = []; // Clear original
                
                deferred.forEach(tile => {
                    // Recursively call this function for deferred tiles
                    if (tile.tileGroup && tile.tileGroup.parent) {
                        window.addPastureToTile(tile.tileGroup, tile.terrainChar, tile.tileX, tile.tileY, tile.actualHeight);
                    }
                });
            }
        } catch (error) {
            console.error('❌ Failed to initialize pasture system:', error);
            return;
        }
    }    
    // Add pasture elements directly to the provided tile group
    if (window.pastureSystem) {
        console.log(`🌱 Adding pasture elements to ${terrainChar} tile group...`);
        try {
            // Verify the pasture system has the required methods
            if (typeof window.pastureSystem.addPastureElementsToGroup !== 'function' ||
                typeof window.pastureSystem.addPlainsElementsToGroup !== 'function') {
                console.error('❌ Pasture system missing required methods');
                return;
            }
            
            // Use the appropriate method based on terrain type
            if (terrainChar === 'A') {
                window.pastureSystem.addPastureElementsToGroup(tileGroup);
            } else if (terrainChar === 'P') {
                window.pastureSystem.addPlainsElementsToGroup(tileGroup);
            }
            
            // Get stats if available
            if (typeof window.pastureSystem.getStats === 'function') {
                const stats = window.pastureSystem.getStats();
                console.log(`📊 Pasture system stats: ${stats.totalTiles} tiles, ${stats.totalElements} elements`);
            }
        } catch (error) {
            console.error('❌ Error adding pasture elements:', error);
        }
    } else {
        console.error('❌ Pasture system not available');
    }
    
    console.log(`✅ Completed pasture processing for ${terrainChar} tile (${tileX}, ${tileY})`);
};

// Enhanced actor creation with 3D system
window.createEnhancedActor = function(actorData, parentGroup, x, y, z, actorType) {
    if (typeof Enhanced3DChibi !== 'undefined' && actorData.id === "nia_sankara") {
        return new Enhanced3DChibi(parentGroup, x, y, z, 'nia');
    }
    // Fallback to existing chibi system
    return null;
};

// Animation helpers
window.animateHexTileClick = function(hexMesh, userData) {
    if (!window.threeDSystem?.animateObject || !hexMesh) return;
    
    const originalScale = { ...hexMesh.scale };
    
    // Scale pulse animation
    window.threeDSystem.animateObject(hexMesh, {
        type: 'scale',
        target: { x: originalScale.x * 1.2, y: originalScale.y * 1.3, z: originalScale.z * 1.2 },
        duration: 200
    }).then(() => {
        window.threeDSystem.animateObject(hexMesh, {
            type: 'scale',
            target: originalScale,
            duration: 300
        });
    });
    
    // Emissive glow effect
    if (hexMesh.material.emissive) {
        hexMesh.material.emissive.setHex(0x666666);
        hexMesh.material.needsUpdate = true;
        
        setTimeout(() => {
            hexMesh.material.emissive.setHex(0x000000);
            hexMesh.material.needsUpdate = true;
        }, 500);
    }
};

// Instant actor movement for tile-by-tile positioning (no smooth animation)
window.smoothMoveActor = function(actorData, newX, newY, newZ) {
    if (actorData.chibiInstance && actorData.chibiInstance.mesh) {
        // Direct position update for instant tile-by-tile movement
        actorData.chibiInstance.mesh.position.set(newX, newY, newZ);
        
        // Brief walking animation for visual feedback
        if (actorData.chibiInstance.animationState) {
            actorData.chibiInstance.animationState.current = 'walk';
            actorData.chibiInstance.animationState.isMoving = true;
            
            setTimeout(() => {
                actorData.chibiInstance.animationState.isMoving = false;
                if (actorData.chibiInstance.animationState.current === 'walk') {
                    actorData.chibiInstance.animationState.current = 'idle';
                }
            }, 100);
        }
    }
};

// Function to initialize all 3D systems once the scene is ready
window.initialize3DSystems = function() {
    // Idempotent guard (covers HMR + multiple callers: SceneBridge, DOMContentLoaded, manual)
    if (window.__3DSystemsInitializing) {
        return false; // another call in-flight
    }
    if (window.__3DSystemsInitialized) {
        // Already initialized – silent for perf, verbose only in dev
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
            console.log('🔁 initialize3DSystems skipped (already initialized)');
        }
        return false;
    }
    if (!window.threeScene) {
        console.warn('⚠️ Cannot initialize 3D systems: threeScene not available');
        return false;
    }
    window.__3DSystemsInitializing = true;
    console.log('🔧 Initializing all 3D systems...');

    let systemsInitialized = 0;

    // Initialize Mountain System (only once)
    if (!window.mountainSystem && typeof MountainSystem === 'function') {
        try {
            window.mountainSystem = new MountainSystem(window.threeScene, {
                mountainScale: 0.8,
                mountainHeightVariation: 0.3
            });
            console.log('✅ Mountain system initialized');
            systemsInitialized++;
        } catch (error) {
            console.error('❌ Failed to initialize mountain system:', error);
        }
    }
    // Initialize Pasture System (only once)
    if (!window.pastureSystem && typeof PastureSystem === 'function') {
        try {
            window.pastureSystem = new PastureSystem(window.threeScene);
            console.log('✅ Pasture system initialized');
            systemsInitialized++;
            // Process any deferred pasture tiles
            if (window.deferredPastureTiles && window.deferredPastureTiles.length > 0) {
                console.log(`🔄 Processing ${window.deferredPastureTiles.length} deferred pasture tiles`);
                const deferred = window.deferredPastureTiles.slice();
                window.deferredPastureTiles = [];
                deferred.forEach(tile => {
                    try { window.addPastureToTile(tile.tileGroup, tile.terrainChar, tile.tileX, tile.tileY, tile.actualHeight); } catch(e) { /* ignore individual errors */ }
                });
            }
        } catch (error) {
            console.error('❌ Failed to initialize pasture system:', error);
        }
    } else if (typeof PastureSystem === 'undefined') {
        console.warn('⚠️ PastureSystem class not available - pasture elements will not be rendered');
    }

    window.__3DSystemsInitializing = false;
    if (systemsInitialized > 0) {
        window.__3DSystemsInitialized = true;
    }
    console.log(`✅ Initialized ${systemsInitialized} 3D systems (idempotent)`);
    return systemsInitialized > 0;
};

// Initialize enhanced features when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for main game's Three.js scene to be ready
    console.log('Integration Helper: Waiting for game initialization...');
    
    let attempts = 0;
    while ((!window.threeScene || typeof MountainSystem === 'undefined') && attempts < 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    if (window.threeScene && typeof MountainSystem === 'function') {
        // Use unified initializer (idempotent)
        try { window.initialize3DSystems(); } catch(e) { console.warn('initialize3DSystems call failed in DOMContentLoaded', e); }
    } else {
        console.warn('Failed to initialize 3D systems - missing threeScene or MountainSystem');
    }
    
    // Legacy 3D system integration (for test pages)
    if (window.threeDSystem && !window.threeDSystem.initialized) {
        console.log('Waiting for 3D system initialization...');
        let threeDAttempts = 0;
        while (!window.threeDSystem.initialized && threeDAttempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            threeDAttempts++;
        }
        
        if (window.threeDSystem.initialized) {
            console.log('3D System ready - Enhanced features available');
              // Initialize mountain system if available and not already initialized
            if (typeof MountainSystem === 'function' && window.threeDSystem.scene && !window.mountainSystem) {
                window.mountainSystem = new MountainSystem(window.threeDSystem.scene, {
                    mountainScale: 0.8,
                    mountainHeightVariation: 0.3
                });
                console.log('Mountain System initialized and integrated with 3D system');
            }
            
            // Initialize pasture system if available and not already initialized
            if (typeof initializePastureSystem === 'function' && window.threeDSystem.scene && !window.pastureSystem) {
                initializePastureSystem(window.threeDSystem.scene);
                console.log('Pasture System initialized and integrated with 3D system');
            }
        } else {
            console.warn('3D System failed to initialize - Using fallback rendering');
        }
    }
});
