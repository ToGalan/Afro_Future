// js/movement_counter.js - Movement counter and progress bubble system

// Global variables for movement counter
let movementCounterBubble = null;
let currentMovementTarget = null;
let movementPressCount = 0;

// Create movement counter bubble
function createMovementCounterBubble() {
    if (movementCounterBubble) {
        return movementCounterBubble;
    }

    movementCounterBubble = document.createElement('div');
    movementCounterBubble.id = 'movement-counter-bubble';
    movementCounterBubble.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 12px;
        border-radius: 20px;
        font-family: monospace;
        font-size: 14px;
        font-weight: bold;
        border: 2px solid #ffd700;
        z-index: 1000;
        pointer-events: none;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        text-align: center;
        min-width: 60px;
        display: none;
    `;
    
    document.body.appendChild(movementCounterBubble);
    return movementCounterBubble;
}

// Update movement counter display
function updateMovementCounter(pressesRemaining, totalPresses) {
    const bubble = createMovementCounterBubble();
    
    if (pressesRemaining <= 0) {
        hideMovementCounter();
        return;
    }
      bubble.innerHTML = `
        <div style="color: #ffd700; font-size: 12px; margin-bottom: 2px;">MOVE</div>
        <div style="font-size: 16px;">${Math.floor(pressesRemaining)}/${Math.floor(totalPresses)}</div>
    `;
    
    // Update bubble color based on progress
    const progress = (totalPresses - pressesRemaining) / totalPresses;
    if (progress < 0.3) {
        bubble.style.borderColor = '#ff4444';
        bubble.style.background = 'rgba(40, 0, 0, 0.9)';
    } else if (progress < 0.7) {
        bubble.style.borderColor = '#ffaa00';
        bubble.style.background = 'rgba(40, 20, 0, 0.9)';
    } else {
        bubble.style.borderColor = '#44ff44';
        bubble.style.background = 'rgba(0, 40, 0, 0.9)';
    }
    
    bubble.style.display = 'block';
    updateBubblePosition();
}

// Hide movement counter bubble
function hideMovementCounter() {
    if (movementCounterBubble) {
        movementCounterBubble.style.display = 'none';
    }
    currentMovementTarget = null;
    movementPressCount = 0;
}

// Update bubble position to follow player
function updateBubblePosition() {
    if (!movementCounterBubble || !activePlayerActor || movementCounterBubble.style.display === 'none') {
        return;
    }
    
    // Get canvas position
    const canvas = document.getElementById('gameCanvas');
    if (!canvas || !threeCamera || !threeRenderer) {
        return;
    }
    
    // Calculate 3D position
    const playerWorldPos = new THREE.Vector3();
    if (activePlayerActor.worldX !== undefined) {
        playerWorldPos.set(activePlayerActor.worldX, activePlayerActor.worldY + 2, activePlayerActor.worldZ);
    } else {
        // Fallback calculation
        playerWorldPos.set(
            HEX_SPACING_FACTOR_X * (activePlayerActor.x + (activePlayerActor.y % 2 === 1 ? 0.5 : 0)),
            5,
            HEX_SPACING_FACTOR_Z * activePlayerActor.y
        );
    }
    
    // Project to screen coordinates
    const screenPos = playerWorldPos.clone().project(threeCamera);
    const canvasRect = canvas.getBoundingClientRect();
    
    const screenX = (screenPos.x * 0.5 + 0.5) * canvasRect.width + canvasRect.left;
    const screenY = (-screenPos.y * 0.5 + 0.5) * canvasRect.height + canvasRect.top;
    
    // Position bubble above player
    movementCounterBubble.style.left = `${screenX - 30}px`;
    movementCounterBubble.style.top = `${screenY - 80}px`;
}

// Enhanced movement function with counter
function enhancedMoveActivePlayer(dx, dy) {
    console.log(`enhancedMoveActivePlayer: Called with dx=${dx}, dy=${dy}`);
    
    if (!activePlayerActor || activePlayerActor.isDefeated || window.playerCaught) {
        hideMovementCounter();
        return;
    }

    if (typeof activePlayerActor.movementProgress === 'undefined') {
        activePlayerActor.movementProgress = { targetX: -1, targetY: -1, remainingCost: 0 };
    }
    
    const nextPotentialX = activePlayerActor.x + dx;
    const nextPotentialY = activePlayerActor.y + dy;
    
    // Bounds checking
    if (nextPotentialX < 0 || nextPotentialX >= MAP_COLS || nextPotentialY < 0 || nextPotentialY >= MAP_ROWS) {
        console.log("enhancedMoveActivePlayer: Target out of bounds");
        if (typeof addNotification === 'function') {
            addNotification("Cannot move outside the map!", 'info');
        }
        return;
    }
    
    // Enemy collision check
    const enemyAtTarget = enemies.find(e => !e.isDefeated && e.x === nextPotentialX && e.y === nextPotentialY);
    if (enemyAtTarget) {
        console.log("enhancedMoveActivePlayer: Enemy at target");
        if (typeof addNotification === 'function') {
            addNotification(`${activePlayerActor.name} bumps into an enemy!`, 'damage');
        }
        if (typeof activePlayerTakesHit === 'function') {
            activePlayerTakesHit();
        }
        hideMovementCounter();
        return;
    }
    
    // Terrain checking
    const targetTileData = map[nextPotentialY]?.[nextPotentialX];
    if (!targetTileData || IMPASSABLE_TILES.has(targetTileData.terrain)) {
        console.log(`enhancedMoveActivePlayer: Path blocked. Terrain: ${targetTileData ? targetTileData.terrain : 'N/A'}`);
        if (typeof addNotification === 'function') {
            addNotification("Path blocked!", 'info');
        }
        hideMovementCounter();
        return;
    }
      const targetTerrainChar = targetTileData.terrain;
    let moveCost = Math.floor(TERRAIN_MOVEMENT_PENALTIES[targetTerrainChar] || 1);
    
    // Check for movement buffs
    if (activePlayerActor.getActiveBuffs?.().some(b => b.id === 'AncestralEchoBuff' && b.duration > 0)) {
        moveCost = 1;
    }
      // Initialize or continue movement progress
    if (currentMovementTarget?.x !== nextPotentialX || currentMovementTarget?.y !== nextPotentialY) {
        // New target
        currentMovementTarget = { x: nextPotentialX, y: nextPotentialY };
        activePlayerActor.movementProgress.targetX = nextPotentialX;
        activePlayerActor.movementProgress.targetY = nextPotentialY;
        activePlayerActor.movementProgress.remainingCost = Math.floor(moveCost);
        movementPressCount = 0;
        console.log(`enhancedMoveActivePlayer: New target (${nextPotentialX}, ${nextPotentialY}), cost: ${moveCost}`);
    }
    
    // Increment press count and decrease remaining cost
    movementPressCount++;
    activePlayerActor.movementProgress.remainingCost = Math.max(0, activePlayerActor.movementProgress.remainingCost - 1);
    
    console.log(`enhancedMoveActivePlayer: Press ${movementPressCount}, remaining cost: ${activePlayerActor.movementProgress.remainingCost}`);
    
    // Update counter display
    updateMovementCounter(activePlayerActor.movementProgress.remainingCost, moveCost);
    
    // Check if movement is complete
    if (activePlayerActor.movementProgress.remainingCost <= 0) {
        console.log(`enhancedMoveActivePlayer: Movement complete! Moving to (${nextPotentialX}, ${nextPotentialY})`);
        
        // Actually move the player
        activePlayerActor.x = nextPotentialX;
        activePlayerActor.y = nextPotentialY;
        
        // Update 3D position
        activePlayerActor.worldX = HEX_SPACING_FACTOR_X * (activePlayerActor.x + (activePlayerActor.y % 2 === 1 ? 0.5 : 0));
        activePlayerActor.worldZ = HEX_SPACING_FACTOR_Z * activePlayerActor.y;
        
        const currentTileData = map[activePlayerActor.y]?.[activePlayerActor.x];
        const currentTerrainChar = currentTileData ? currentTileData.terrain : 'P';
        const currentTileHeightFactor = TERRAIN_HEIGHT_FACTORS[currentTerrainChar] || TERRAIN_HEIGHT_FACTORS['DEFAULT'];
        const currentTileActualHeight = HEX_HEIGHT_3D * currentTileHeightFactor;
        const playerIndicatorHeight = HEX_RADIUS_3D * 0.7;
        activePlayerActor.worldY = currentTileActualHeight + (playerIndicatorHeight / 2) + 0.05;
          // Reset movement progress
        activePlayerActor.movementProgress = { targetX: -1, targetY: -1, remainingCost: 0 };
        
        // Hide counter bubble
        hideMovementCounter();
        
        // Set facing direction for actor rotation
        if (typeof setPlayerFacingDirection === 'function') {
            const facingDx = nextPotentialX - activePlayerActor.x;
            const facingDy = nextPotentialY - activePlayerActor.y;
            setPlayerFacingDirection(facingDx, facingDy);
        }
        
        // Trigger regeneration and other effects
        if (activePlayerActor.regenerateHp) {
            activePlayerActor.regenerateHp();
        }
        
        // Update turn and date
        window.currentTurn = (window.currentTurn || 0) + 1;
        const year = Math.floor(window.currentTurn / (365 * 0.1)) + 1;
        const turnInYear = window.currentTurn % Math.floor(365 * 0.1);
        window.currentDateString = `Y${year}, D${turnInYear}`;
        
        // Update HUDs
        if (typeof updatePlayerHUD === 'function') updatePlayerHUD();
        if (typeof updateMapInfoHUD === 'function') updateMapInfoHUD();
        if (typeof updateMissionProgress === 'function') updateMissionProgress();
          // Trigger attacks of opportunity
        if (typeof triggerAttacksOfOpportunity === 'function' && !window.playerCaught) {
            triggerAttacksOfOpportunity();
        }
        
        // Movement notifications removed - counter provides visual feedback
    } else {
        // Movement in progress - counter provides visual feedback
    }
}

// Update bubble position on window resize or camera changes
if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateBubblePosition);
    
    // Update position periodically to follow camera movement
    setInterval(() => {
        if (movementCounterBubble && movementCounterBubble.style.display !== 'none') {
            updateBubblePosition();
        }
    }, 100);
}

// Export functions for global access
if (typeof window !== 'undefined') {
    window.enhancedMoveActivePlayer = enhancedMoveActivePlayer;
    window.updateMovementCounter = updateMovementCounter;
    window.hideMovementCounter = hideMovementCounter;
    window.updateBubblePosition = updateBubblePosition;
}

console.log("Movement counter system loaded successfully!");
