// events.js
// Note: Removed imports as they were causing issues with current script setup.
// Assumes 'render', 'moveActivePlayer', and core game variables are globally available
// or correctly scoped by the time these event listeners are active.

document.addEventListener('keydown', (e) => {
    if (!window.gameStarted || window.playerCaught || !activePlayerActor || activePlayerActor.isDefeated) return;

    let dx = 0, dy = 0, facingDx = 0, facingDz = 0, moved = false;

    // Map key presses to both grid movement and 3D facing direction
    switch (e.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
            dy = -1;      // Move up in grid
            facingDz = -1; // Face north in 3D space
            moved = true;
            break;
        case 's':
        case 'arrowdown':
            dy = 1;      // Move down in grid
            facingDz = 1; // Face south in 3D space
            moved = true;
            break;
        case 'a':
        case 'arrowleft':
            dx = -1;      // Move left in grid
            facingDx = -1; // Face west in 3D space
            moved = true;
            break;
        case 'd':
        case 'arrowright':
            dx = 1;      // Move right in grid
            facingDx = 1; // Face east in 3D space
            moved = true;
            break;
    }

    if (moved) {
        // Set facing direction first
        if (typeof setPlayerFacingDirection === 'function') {
            setPlayerFacingDirection(facingDx, facingDz);
        }
          // Then handle grid movement with enhanced counter system
        if (typeof enhancedMoveActivePlayer === 'function') {
            enhancedMoveActivePlayer(dx, dy);
        } else if (typeof moveActivePlayer === 'function') {
            moveActivePlayer(dx, dy); // Fallback to original system
        }

        // Prevent arrow keys from scrolling the page
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
            e.preventDefault();
        }
    }
});

// Removed resetGame() call from here as it's handled by main.js
// Removed setInterval for render and spawnEnemies as they are handled by main.js