// js/player_controller.js

function updatePlayerHUD() {
    const portraitDiv = document.querySelector(".player-portrait-placeholder");
    const portraitImgEl = document.getElementById("playerPortraitImage");
    const playerNameElement = document.getElementById("hud-player-name");
    const playerCoordsElement = document.getElementById("hud-player-coords");
    const healthFillElement = document.getElementById("hud-health-fill");
    const healthTextElement = document.getElementById("hud-health-text");
    const energyFillElement = document.getElementById("hud-energy-fill");
    const energyTextElement = document.getElementById("hud-energy-text");
    const abilitySlotsContainer = document.querySelector(".player-section-hud .simple-ability-slots");

    if (!activePlayerActor || typeof activePlayerActor.name === 'undefined' || activePlayerActor.name === "Loading...") {
        if (playerNameElement) playerNameElement.textContent = "N/A";
        if (playerCoordsElement) playerCoordsElement.textContent = "(-,-)";
        if (healthFillElement) healthFillElement.style.width = "0%";
        if (healthTextElement) healthTextElement.textContent = "0/0";
        if (energyFillElement) energyFillElement.style.width = "0%";
        if (energyTextElement) energyTextElement.textContent = "0/0";
        // When actor data is unavailable, show a default portrait image, similar to pet's behavior
        if (portraitImgEl) {
            portraitImgEl.src = "img/nia.png"; // Default placeholder, consistent with BaseActor
            portraitImgEl.alt = "Player Portrait (Unavailable)"; // Standard alt text
            portraitImgEl.style.display = 'block'; // Ensure the img tag is visible
        }
        if (portraitDiv) { // The container for the image
            portraitDiv.textContent = ''; // Clear any "N/A" text if default image is shown
            portraitDiv.style.backgroundColor = 'transparent'; // Make container background transparent
            portraitDiv.style.display = 'flex'; // Ensure container is visible and behaves as flex
        }
        if (abilitySlotsContainer) abilitySlotsContainer.innerHTML = Array(4).fill('<div class="simple-ability-slot">-</div>').join(''); // Simplified repeat
        return;
    }

    if (playerNameElement) playerNameElement.textContent = activePlayerActor.name || "Player";
    if (playerCoordsElement) playerCoordsElement.textContent = `(${activePlayerActor.x},${activePlayerActor.y})`;
    
    if (healthFillElement && healthTextElement && typeof activePlayerActor.maxHp === 'number' && activePlayerActor.maxHp > 0) {
        healthFillElement.style.width = `${Math.max(0, (activePlayerActor.hp / activePlayerActor.maxHp) * 100)}%`;
        healthTextElement.textContent = `${Math.max(0, Math.ceil(activePlayerActor.hp))}/${activePlayerActor.maxHp}`;
    }
    if (energyFillElement && energyTextElement && typeof activePlayerActor.maxEp === 'number' && activePlayerActor.maxEp > 0) {
        energyFillElement.style.width = `${Math.max(0, (activePlayerActor.ep / activePlayerActor.maxEp) * 100)}%`;
        energyTextElement.textContent = `${Math.floor(activePlayerActor.ep)}/${activePlayerActor.maxEp}`;
    }

    // Portrait Logic
    if (portraitImgEl) {
        let imgSrc = "img/nia.png"; // Default fallback
        if (activePlayerActor && activePlayerActor.portraitImg && activePlayerActor.portraitImg.trim() !== '') {
            imgSrc = activePlayerActor.portraitImg;
        }
        portraitImgEl.src = imgSrc;
        portraitImgEl.alt = `${activePlayerActor && activePlayerActor.name ? activePlayerActor.name : "Player"} Portrait`;
        portraitImgEl.style.display = 'block';
        portraitImgEl.onerror = function() {
            this.onerror = null;
            this.src = "img/nia.png";
        };
    }
    
    if (abilitySlotsContainer && activePlayerActor.abilities && Array.isArray(activePlayerActor.abilities)) {
        abilitySlotsContainer.innerHTML = ''; // Clear old slots
        for(let i=0; i < 4; i++){
            const slotDiv = document.createElement('div');
            slotDiv.classList.add('simple-ability-slot');
            const ability = activePlayerActor.abilities[i];
            if(ability && ability.icon){
                slotDiv.innerHTML = `<img src="${ability.icon}" alt="${ability.name || 'Ability'}" title="${ability.name || `Ability ${i+1}`}${ability.description ? `\n${ability.description}`: ''}\nCost: ${ability.cost || 0} EP\nCD: ${ability.cooldown || 0} turns">`;
                if (ability.currentCooldown > 0) slotDiv.style.filter = 'grayscale(80%) brightness(0.7)';
                else if (activePlayerActor.ep < (ability.cost || 0)) slotDiv.style.filter = 'opacity(0.6) brightness(0.8)';
            } else {
                slotDiv.textContent = ability ? (ability.name ? ability.name.substring(0,1) : (i+1)) : '-';
                if(ability) slotDiv.title = `${ability.name || `Ability ${i+1}`}${ability.description ? `\n${ability.description}`: ''}`;
            }
            abilitySlotsContainer.appendChild(slotDiv);
        }
    } else if (abilitySlotsContainer) { 
        abilitySlotsContainer.innerHTML = Array(4).fill('<div class="simple-ability-slot">-</div>').join('');
    }

    const petPortraitImgEl = document.getElementById("petPortraitImageElement");
    if (petPortraitImgEl) {
        let imgSrc = "img/pet_cat.png"; // Default fallback
        if (pet && pet.portraitImg && pet.portraitImg.trim() !== '') {
            imgSrc = pet.portraitImg;
        }
        petPortraitImgEl.src = imgSrc;
        petPortraitImgEl.alt = `${pet && pet.name ? pet.name : "Pet"} Portrait`;
        petPortraitImgEl.style.display = 'block';
    }
}


function moveActivePlayer(dx, dy) {
    console.log(`moveActivePlayer: Called with dx=${dx}, dy=${dy}. Player: ${activePlayerActor ? activePlayerActor.name : 'N/A'}, Defeated: ${activePlayerActor ? activePlayerActor.isDefeated : 'N/A'}, Caught: ${window.playerCaught}`);
    if (!activePlayerActor || activePlayerActor.isDefeated || window.playerCaught) {
        console.log("moveActivePlayer: Exiting - Player cannot move (defeated, caught, or null).");
        return;
    }
    if (typeof activePlayerActor.movementProgress === 'undefined') activePlayerActor.movementProgress = { targetX: -1, targetY: -1, remainingCost: 0 };
    
    const nextPotentialX = activePlayerActor.x + dx;
    const nextPotentialY = activePlayerActor.y + dy;
    console.log(`moveActivePlayer: Current pos (${activePlayerActor.x},${activePlayerActor.y}), Target potential pos (${nextPotentialX},${nextPotentialY})`);

    if (nextPotentialX < 0 || nextPotentialX >= MAP_COLS || nextPotentialY < 0 || nextPotentialY >= MAP_ROWS) {
        console.log("moveActivePlayer: Exiting - Target out of map bounds.");
        return;
    }

    const enemyAtTarget = enemies.find(e => !e.isDefeated && e.x === nextPotentialX && e.y === nextPotentialY);
    if (enemyAtTarget) { console.log("moveActivePlayer: Exiting - Enemy at target."); if (addNotification) addNotification(`${activePlayerActor.name} bumps enemy!`, 'damage'); activePlayerTakesHit(); return; }

    // UPDATED: Read .terrain from tile object
    const targetTileData = map[nextPotentialY]?.[nextPotentialX];
    if (!targetTileData || IMPASSABLE_TILES.has(targetTileData.terrain)) { // Check if tileData itself exists
        console.log(`moveActivePlayer: Exiting - Path blocked or impassable. Tile: ${targetTileData ? targetTileData.terrain : 'N/A'}`); if(addNotification) addNotification("Path blocked.", 'info'); return;
    }    const targetTerrainChar = targetTileData.terrain;

    let moveCost = Math.floor(TERRAIN_MOVEMENT_PENALTIES[targetTerrainChar] || 1);
    if (activePlayerActor.getActiveBuffs?.().some(b => b.id === 'AncestralEchoBuff' && b.duration > 0)) { // Specific buff check
        moveCost = 1;
    }

    console.log(`moveActivePlayer: Move cost to target: ${moveCost}`);

    if (activePlayerActor.movementProgress.targetX === nextPotentialX && activePlayerActor.movementProgress.targetY === nextPotentialY && activePlayerActor.movementProgress.remainingCost > 0) {
        activePlayerActor.movementProgress.remainingCost -= 1;
        console.log(`moveActivePlayer: Continuing move to (${nextPotentialX},${nextPotentialY}). Remaining cost: ${activePlayerActor.movementProgress.remainingCost}`);    } else {
        activePlayerActor.movementProgress.targetX = nextPotentialX;
        activePlayerActor.movementProgress.targetY = nextPotentialY;
        activePlayerActor.movementProgress.remainingCost = Math.floor(moveCost - 1);
        console.log(`moveActivePlayer: Starting new move to (${nextPotentialX},${nextPotentialY}). Initial remaining cost: ${activePlayerActor.movementProgress.remainingCost}`);
    }
    if (activePlayerActor.movementProgress.remainingCost <= 0) {
        console.log(`moveActivePlayer: Movement successful. Updating player position to (${nextPotentialX},${nextPotentialY}).`);
        activePlayerActor.x = nextPotentialX;
        activePlayerActor.y = nextPotentialY;

        activePlayerActor.worldX = HEX_SPACING_FACTOR_X * (activePlayerActor.x + (activePlayerActor.y % 2 === 1 ? 0.5 : 0));
        activePlayerActor.worldZ = HEX_SPACING_FACTOR_Z * activePlayerActor.y;
        
        // UPDATED: Read .terrain from tile object for height calculation
        const currentTileData = map[activePlayerActor.y]?.[activePlayerActor.x];
        const currentTerrainChar = currentTileData ? currentTileData.terrain : 'P'; // Fallback if somehow null
        const currentTileHeightFactor = TERRAIN_HEIGHT_FACTORS[currentTerrainChar] || TERRAIN_HEIGHT_FACTORS['DEFAULT'];
        const currentTileActualHeight = HEX_HEIGHT_3D * currentTileHeightFactor; 
        const playerIndicatorHeight = HEX_RADIUS_3D * 0.7; // Match player cylinder height from main.js createThreeJSActorRepresentation
        activePlayerActor.worldY = currentTileActualHeight + (playerIndicatorHeight / 2) + 0.05; // Actor slightly above tile surface        activePlayerActor.movementProgress = { targetX: -1, targetY: -1, remainingCost: 0 };        activePlayerActor.regenerateHp?.(); // Player regen after successful full move
          // Trigger walking animation during movement
        if (typeof setPlayerFacingDirection === 'function') {
            setPlayerFacingDirection(dx, dy); // dx for left/right, dy for forward/back
        }
        
        // Update global turn and date trackers
        window.currentTurn = (window.currentTurn || 0) + 1;
        // Basic date string update, can be more complex
        const year = Math.floor(window.currentTurn / (365 * 0.1)) + 1; // Arbitrary turns per year for example
        const turnInYear = window.currentTurn % Math.floor(365 * 0.1);
        window.currentDateString = `Y${year}, D${turnInYear}`; // Or T for Turn

        if (typeof updatePlayerHUD === 'function') updatePlayerHUD();
        if (typeof updateMapInfoHUD === 'function') updateMapInfoHUD(); // Update map info HUD after moving
        if (typeof updateMissionProgress === 'function') updateMissionProgress(); // Update exploration
         if (typeof triggerAttacksOfOpportunity === 'function' && !window.playerCaught) triggerAttacksOfOpportunity();
    }
    // If render() is not part of a continuous loop and immediate visual feedback is needed:
    // if (typeof render === 'function') render(); // Usually handled by main game loop
}

function activePlayerTakesHit() {
    if (!activePlayerActor || activePlayerActor.isDefeated) return;
    let baseDamage = Math.ceil(activePlayerActor.maxHp / (HITS_TO_KILL_PLAYER || 5));
    
    // Terrain Combat Modifier (Defensive Bonus)
    const playerTile = map[activePlayerActor.y]?.[activePlayerActor.x];
    let defenseMultiplier = 1.0; // No bonus by default

    if (playerTile) {
        if (playerTile.terrain === 'H') { // Hills
            defenseMultiplier = 0.75; // Takes 25% less damage
            if(addNotification) addNotification(`${activePlayerActor.name} takes cover in hills!`, "info_buff");
        } else if (playerTile.terrain === 'F' || playerTile.terrain === 'J') { // Forest or Jungle
            defenseMultiplier = 0.66; // Takes ~33% less damage
            if(addNotification) addNotification(`${activePlayerActor.name} hidden in foliage!`, "info_buff");
        }
    }
    const actualDamage = Math.max(1, Math.ceil(baseDamage * defenseMultiplier)); // Ensure at least 1 damage

    if (activePlayerActor.takeDamage) {
        activePlayerActor.takeDamage(actualDamage); // Pass calculated damage
    } else { console.error("activePlayerActor.takeDamage missing!"); }
}

function triggerAttacksOfOpportunity() {
    if (window.playerCaught || !activePlayerActor || activePlayerActor.isDefeated) return false;
    let tookDamageThisAction = false;
    enemies.forEach(enemy => { // Changed from for..of to forEach to ensure no issues if 'enemies' array is modified during loop (less likely here)
        if (window.playerCaught || enemy.isDefeated) return; // continue forEach

        let trulyAdjacent = false;
        if (typeof getHexesInRadius === 'function') {
            const neighborsOfPlayer = getHexesInRadius(activePlayerActor.x, activePlayerActor.y, 1); // Radius 1 are adjacent hexes
            trulyAdjacent = neighborsOfPlayer.some(n => n[0] === enemy.x && n[1] === enemy.y && !(n[0] === activePlayerActor.x && n[1] === activePlayerActor.y)); // Ensure it's not the player's own tile
        } else { // Fallback if getHexesInRadius not found
            const dx = Math.abs(activePlayerActor.x - enemy.x);
            const dy = Math.abs(activePlayerActor.y - enemy.y);
            // Simplified hex adjacency for fallback, may not be perfect for odd-r offsets without more logic
            trulyAdjacent = (dx <= 1 && dy <= 1 && (dx + dy > 0));
        }

        if (enemy.canAttackPlayerThisTurn && trulyAdjacent) {
            if (typeof addNotification === 'function') addNotification(`Enemy at (${enemy.x}, ${enemy.y}) attacks ${activePlayerActor.name}!`, "enemy_action"); // Clarified target
            activePlayerTakesHit();
            tookDamageThisAction = true;
            enemy.canAttackPlayerThisTurn = false; // Reset after attack
        }
    });
    return tookDamageThisAction;
}


function emergencyPetRecall() {
    if (!activePlayerActor || activePlayerActor.isDefeated) {
        if (typeof addNotification === 'function') addNotification("Cannot recall pet while player is defeated.", "warning");
        return;
    }
    if (!pet || typeof pet.isFallen === 'undefined' || !pet.typeId) { // Added !pet.typeId to check if pet is initialized
        if (typeof addNotification === 'function') addNotification("Pet is not available for recall.", "warning");
        return;
    }
    if (pet.isFallen) {
        if (typeof addNotification === 'function') addNotification("Cannot recall a fallen pet. It needs to respawn.", "warning");
        return;
    }

    // Calculate hex distance properly
    let distanceToPlayerHex = Infinity;
     if (typeof getDistanceHex === 'function') { // Assuming a getDistanceHex(x1,y1,x2,y2) utility
         distanceToPlayerHex = getDistanceHex(activePlayerActor.x, activePlayerActor.y, pet.x, pet.y);
     } else { // Fallback Manhattan (not accurate for hex)
         distanceToPlayerHex = Math.abs(pet.x - activePlayerActor.x) + Math.abs(pet.y - activePlayerActor.y);
     }


    if (distanceToPlayerHex <= PET_GUARD_PLAYER_DISTANCE) {
        if (typeof addNotification === 'function') addNotification(`${pet.name} is already very close.`, "info");
        return;
    }

    if (typeof addNotification === 'function') addNotification(`${activePlayerActor.name} initiates an emergency recall for ${pet.name}!`, "player_action");

    const playerHpDangerThreshold = activePlayerActor.maxHp * 0.5; // Example threshold
    if (activePlayerActor.hp < playerHpDangerThreshold) {
        if(addNotification) addNotification(`${activePlayerActor.name} is too weak for emergency recall.`, 'warning');
        return;
    }

    const petHpDangerThreshold = pet.maxHp * 0.5; // Example for pet
    if (pet.hp < petHpDangerThreshold) {
        if(addNotification) addNotification(`${pet.name} is too weak for emergency recall.`, 'warning');
        return;
    }

    const playerHpCost = Math.ceil(activePlayerActor.hp * 0.3);
    const playerEpCost = Math.ceil(activePlayerActor.ep * 0.4);
    const petHpCost = Math.ceil(pet.hp * 0.3);
    const petEpCost = Math.ceil(pet.ep * 0.4);

    if (typeof addNotification === 'function') {
        addNotification(`Recall Cost: You: -${playerHpCost}HP, -${playerEpCost}EP. ${pet.name}: -${petHpCost}HP, -${petEpCost}EP.`, "damage");
    }

    activePlayerActor.takeDamage(playerHpCost); // Uses the actor's takeDamage method
    activePlayerActor.ep = Math.max(0, activePlayerActor.ep - playerEpCost);
    
    pet.hp = Math.max(0, pet.hp - petHpCost); // Directly modify pet hp
    pet.ep = Math.max(0, pet.ep - petEpCost);


    if (pet.hp <= 0 && !pet.isFallen) {
        pet.isFallen = true;
        pet.respawnTimer = Math.floor((PET_RESPAWN_COOLDOWN * 1000) / 250); // Use configured game loop speed if available
        if(addNotification) addNotification(`${pet.name} fainted from recall stress! Respawning in ${PET_RESPAWN_COOLDOWN}s.`, 'critical');
    }

    if (activePlayerActor.isDefeated || pet.isFallen) {
        if (typeof updatePlayerHUD === 'function') updatePlayerHUD();
        if (typeof updatePetHUD === 'function') updatePetHUD();
        return;
    }

    let respawnX = -1, respawnY = -1;
    const pX = activePlayerActor.x; const pY = activePlayerActor.y;
    const parity = Math.abs(pY % 2);
    const neighborOffsets = (typeof ODD_R_OFFSETS !== 'undefined' && ODD_R_OFFSETS[parity]) ? ODD_R_OFFSETS[parity] : []; // Default to empty array
    let foundValidSpot = false;

    // Try to find an adjacent spot
    for (const [dx, dy] of neighborOffsets) {
        const nX = pX + dx;
        const nY = pY + dy;
        // Use canPetMoveTo to check validity (defined in utils.js, takes map object structure into account)
        if (typeof canPetMoveTo === 'function' && canPetMoveTo(nX, nY)) { 
            const enemyAtSpot = enemies.find(e => !e.isDefeated && e.x === nX && e.y === nY);
            if(!enemyAtSpot){
                respawnX = nX; respawnY = nY; foundValidSpot = true; break;
            }
        }
    }
    
    if (!foundValidSpot) { // Fallback: Player's current tile (if valid and no enemy)
        if(typeof canPetMoveTo === 'function' && canPetMoveTo(pX, pY) && !enemies.find(e => !e.isDefeated && e.x === pX && e.y === pY)) {
            respawnX = pX; respawnY = pY; foundValidSpot = true;
            if(addNotification) addNotification("No free adjacent spot, recalled to player's tile.", "info");
        } else { // Last resort: keep pet at its previous location if player's tile also bad
            respawnX = pet.x; respawnY = pet.y;
            if(addNotification) addNotification("Recall failed to find clear spot, pet remains in place.", "warning");
        }
    }
    
    const oldPetX = pet.x; const oldPetY = pet.y;
    if(foundValidSpot){ // Only update if a new spot (or player's tile) was actually determined
        pet.x = respawnX; pet.y = respawnY;
    }


    // Update pet's 3D world coordinates after position change
    pet.worldX = HEX_SPACING_FACTOR_X * (pet.x + (pet.y % 2 === 1 ? 0.5 : 0));
    pet.worldZ = HEX_SPACING_FACTOR_Z * pet.y;
    const petTileData = map[pet.y]?.[pet.x];
    const petTerrainChar = petTileData ? petTileData.terrain : 'P';
    const petTileHeightFactor = TERRAIN_HEIGHT_FACTORS[petTerrainChar] || TERRAIN_HEIGHT_FACTORS['DEFAULT'];
    const petTileActualHeight = HEX_HEIGHT_3D * petTileHeightFactor;
    const petIndicatorHeight = HEX_RADIUS_3D * 0.5;
    pet.worldY = petTileActualHeight + petIndicatorHeight + 0.05;


    if(typeof addNotification === 'function' && (pet.x !== oldPetX || pet.y !== oldPetY) && foundValidSpot) {
        addNotification(`${pet.name} recalled to (${pet.x},${pet.y}).`, "player_action");
    } else if (typeof addNotification === 'function' && pet.x === oldPetX && pet.y === oldPetY && distanceToPlayerHex > PET_GUARD_PLAYER_DISTANCE && !foundValidSpot) {
        // Notification already given by failed spot finding
    }

    petHasValidPatrolTarget = false; // Force repath
    pet.tilesMovedSinceRegen = 0;
    if (typeof pet.clearCurrentTarget === 'function') pet.clearCurrentTarget(); // Reset pet's movement state

    if (typeof updatePlayerHUD === 'function') updatePlayerHUD();
    if (typeof updatePetHUD === 'function') updatePetHUD();
}

function setPlayerFacingDirection(dx, dz) {
    if (!activePlayerActor || !activePlayerActor.chibiInstance) {
        return;
    }

    // Only update direction if we have actual movement
    if (dx !== 0 || dz !== 0) {
        const facingVector = new THREE.Vector3(dx, 0, dz).normalize();
        
        // Set direction for both Enhanced3DChibi and ChibiActor
        if (activePlayerActor.chibiInstance.direction) {
            activePlayerActor.chibiInstance.direction.copy(facingVector);
        }
        
        // Use enhanced facing direction method if available
        if (activePlayerActor.chibiInstance.setFacingDirection) {
            activePlayerActor.chibiInstance.setFacingDirection(facingVector);
        }
        
        // Trigger walking animation when moving
        if (activePlayerActor.chibiInstance.walk) {
            activePlayerActor.chibiInstance.walk(facingVector);
        }
    } else if (activePlayerActor.chibiInstance.stop) {
        // Stop animation when not moving
        activePlayerActor.chibiInstance.stop();
    }
}
