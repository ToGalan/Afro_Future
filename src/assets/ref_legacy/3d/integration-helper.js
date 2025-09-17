/**
 * Integration helper for existing main.js
 * Adds 3D system compatibility to your existing code
 */

// Enhanced createThreeJSHexTile function integration
window.enhanceHexTileWithStyle = function(material, terrainType) {
    if (window.threeDSystem?.createStyledMaterial) {
        return window.threeDSystem.styleManager.applyHexTileStyle(material, terrainType);
    }
    return material;
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

// Initialize enhanced features when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for 3D system to be ready
    if (window.threeDSystem && !window.threeDSystem.initialized) {
        console.log('Waiting for 3D system initialization...');
        let attempts = 0;
        while (!window.threeDSystem.initialized && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (window.threeDSystem.initialized) {
            console.log('3D System ready - Enhanced features available');
        } else {
            console.warn('3D System failed to initialize - Using fallback rendering');
        }
    }
});
