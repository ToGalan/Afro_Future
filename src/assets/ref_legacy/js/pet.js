// pet.js - Initialization & Utility functions

let petTooFarNotificationShown = false;
let petPatrolHistory = []; // Track recently visited patrol locations
const MAX_PATROL_HISTORY = 5; // Remember last 5 patrol spots
let lastPlayerPosition = { x: -1, y: -1 }; // Track player movement for patrol adaptation

function canPetMoveToLocal(x, y) {
    if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return false;
    const tileData = map[y]?.[x];
    if (!tileData) return false;
    return !IMPASSABLE_TILES.has(tileData.terrain);
}

function initializePetFromSelection(startX, startY) {
    const petTypeToLoad = selectedPetType && PET_TEMPLATES[selectedPetType] ? selectedPetType : Object.keys(PET_TEMPLATES)[0];
    const template = PET_TEMPLATES[petTypeToLoad];

    Object.assign(pet, {
        typeId: template.typeId,
        name: template.name,
        color: template.baseColor,
        maxHp: template.maxHp,
        hp: template.maxHp,
        maxEp: template.maxEp,
        ep: template.maxEp,
        abilities: template.abilities.map(ab => ({ ...ab, currentCooldown: 0, cost: ab.cost || 0 })),
        x: startX,
        y: startY,
        portraitImg: template.portraitImg,
        inventory: Array(MAX_PET_INVENTORY_SLOTS).fill(null), // Now MAX_PET_INVENTORY_SLOTS should be defined
        isFallen: false,
        respawnTimer: 0,
        fovRadius: template.fovRadius || PET_DEFAULT_FOV_RADIUS,
        movementProgress: { targetX: -1, targetY: -1, remainingCost: 0 },
        tilesMovedSinceRegen: 0,
        hitsToKillFactor: template.hitsToKillFactor || 1,
        baseColor: template.baseColor || '#DA70D6',
        activeBuffs: []
    });

    pet.ep = pet.maxEp;
    
    if (typeof pet.worldX === 'undefined' && typeof HEX_SPACING_FACTOR_X !== 'undefined') {
        pet.worldX = HEX_SPACING_FACTOR_X * (pet.x + (pet.y % 2 === 1 ? 0.5 : 0));
        pet.worldZ = HEX_SPACING_FACTOR_Z * pet.y;
        const petTileData = map[pet.y]?.[pet.x];
        const petTerrainChar = petTileData ? petTileData.terrain : 'P';
        const petTileHeightFactor = TERRAIN_HEIGHT_FACTORS[petTerrainChar] || TERRAIN_HEIGHT_FACTORS['DEFAULT'];
        const petTileActualHeight = HEX_HEIGHT_3D * petTileHeightFactor;
        const petIndicatorHeight = HEX_RADIUS_3D * 0.5;
        pet.worldY = petTileActualHeight + petIndicatorHeight + 0.05 - (HEX_HEIGHT_3D/2);
    }

    pet.addBuff = function(buff) {
        const existingBuffIndex = this.activeBuffs.findIndex(b => b.id === buff.id);
        if (existingBuffIndex !== -1) this.activeBuffs[existingBuffIndex] = buff;
        else this.activeBuffs.push(buff);
        if(typeof addNotification === 'function' && buff.description) addNotification(`${this.name} ${buff.description}`, 'buff');
    };

    pet.removeBuff = function(buffId) {
        const buffIndex = this.activeBuffs.findIndex(b => b.id === buffId);
        if (buffIndex !== -1) {
            const buffToEnd = this.activeBuffs[buffIndex];
            if (typeof buffToEnd.onEnd === 'function') buffToEnd.onEnd.call(this);
            this.activeBuffs.splice(buffIndex, 1);
             if(typeof addNotification === 'function' && buffToEnd.id) addNotification(`${buffToEnd.id} wore off for ${this.name}.`, 'info');
        }
    };

    pet.updateBuffs = function() {
        for (let i = this.activeBuffs.length - 1; i >= 0; i--) {
            const buff = this.activeBuffs[i];
            if (buff.duration !== Infinity) {
                buff.duration--;
                if (buff.duration <= 0) this.removeBuff(buff.id);
            }
        }
    };
}

function updatePetHUD() {
    const elements = {
        name: document.getElementById("hud-pet-name"), coords: document.getElementById("hud-pet-coords"),
        healthFill: document.getElementById("hud-pet-health-fill"), healthText: document.getElementById("hud-pet-health-text"),
        portrait: document.getElementById("petPortraitImage"), energyFill: document.getElementById("hud-pet-energy-fill"),
        energyText: document.getElementById("hud-pet-energy-text"),
    };

    if (!pet || typeof pet.name === 'undefined' || !pet.typeId) {
        if(elements.name) elements.name.textContent = "Pet N/A";
        if(elements.coords) elements.coords.textContent = "(-,-)";
        if(elements.healthFill) elements.healthFill.style.width = "0%";
        if(elements.healthText) elements.healthText.textContent = "0/0";
        if(elements.energyFill) elements.energyFill.style.width = "0%";
        if(elements.energyText) elements.energyText.textContent = "0/0";
        if (elements.portrait) {
            elements.portrait.src = "img/pet_1.png"; // Default placeholder image
            elements.portrait.alt = "Pet Portrait";
            elements.portrait.style.display = 'block'; // Ensure placeholder is visible
        }
        for (let i = 0; i < MAX_PET_INVENTORY_SLOTS; i++) { // MAX_PET_INVENTORY_SLOTS from core.js
            const slot = document.getElementById(`pet-item-slot-${i}`); if(slot) { slot.innerHTML='-'; slot.title='Unavailable';}
        }
        return;
    }

    if(elements.name) elements.name.textContent = pet.name;
    if(elements.coords) elements.coords.textContent = pet.isFallen ? "(Fallen)" : `(${pet.x},${pet.y})`;
    if(elements.healthFill && pet.maxHp > 0) elements.healthFill.style.width = `${Math.max(0, Math.min(100, (pet.hp / pet.maxHp) * 100))}%`; else if (elements.healthFill) elements.healthFill.style.width = "0%";
    if(elements.healthText) elements.healthText.textContent = `${Math.max(0, Math.ceil(pet.hp))}/${pet.maxHp}`;
    if(elements.energyFill && pet.maxEp > 0) elements.energyFill.style.width = `${Math.max(0, Math.min(100, (pet.ep / pet.maxEp) * 100))}%`; else if (elements.energyFill) elements.energyFill.style.width = "0%";
    if(elements.energyText) elements.energyText.textContent = `${Math.floor(pet.ep)}/${pet.maxEp}`;
    if (elements.portrait) {
        if (pet.portraitImg && typeof pet.portraitImg === 'string' && pet.portraitImg.trim() !== '') {
            // Pet has a specific, valid portrait image
            if (elements.portrait.getAttribute('src') !== pet.portraitImg) {
                elements.portrait.src = pet.portraitImg;
            }
            elements.portrait.alt = `${pet.name} Portrait`;
            elements.portrait.style.display = 'block'; // Show the specific image
        } else {
            // Pet is valid, but pet.portraitImg is missing/empty. Hide the image element.
            elements.portrait.style.display = 'none';
            elements.portrait.alt = `${pet.name || 'Pet'} (Portrait Unavailable)`;
        }
    }
    
    for (let i = 0; i < MAX_PET_INVENTORY_SLOTS; i++) {
        const itemSlotDiv = document.getElementById(`pet-item-slot-${i}`);
        if(itemSlotDiv){
            const item = pet.inventory[i];
            itemSlotDiv.innerHTML = item && item.icon ? `<img src="${item.icon}" alt="${item.name}" title="${item.name}">` : '-';
            if (!item) itemSlotDiv.title = 'Empty Slot';
        }
    }
}

function findNewPetPatrolTarget() {
    petHasValidPatrolTarget = false;
    const radius = (PLAYER_FOV_RADIUS || 5) - 1;
    if (!activePlayerActor || typeof getHexesInRadius !== 'function') return;
    
    const fovTilesAroundPlayer = getHexesInRadius(activePlayerActor.x, activePlayerActor.y, radius);
    const eligiblePatrolTiles = fovTilesAroundPlayer.filter(tile => 
        (tile[0] !== pet.x || tile[1] !== pet.y) && 
        canPetMoveToLocal(tile[0], tile[1]) &&
        getDistanceHex(tile[0], tile[1], activePlayerActor.x, activePlayerActor.y) >= 2 && // Not too close to player
        getDistanceHex(tile[0], tile[1], activePlayerActor.x, activePlayerActor.y) <= 4 &&  // Not too far from player
        !petPatrolHistory.some(histTile => histTile.x === tile[0] && histTile.y === tile[1]) // Avoid recently visited
    );
    
    if (eligiblePatrolTiles.length > 0) {
        // Enhanced strategic scoring system
        const playerX = activePlayerActor.x;
        const playerY = activePlayerActor.y;
        const petX = pet.x;
        const petY = pet.y;
        
        // Calculate current direction from player to pet for coverage
        const currentDirection = Math.atan2(petY - playerY, petX - playerX);
        
        // Get nearby enemies for threat assessment
        const nearbyEnemies = enemies.filter(e => !e.isDefeated && 
            getDistanceHex(e.x, e.y, playerX, playerY) <= 8);
        
        // Score tiles based on multiple strategic factors
        const scoredTiles = eligiblePatrolTiles.map(tile => {
            const [tileX, tileY] = tile;
            const distanceFromPlayer = getDistanceHex(tileX, tileY, playerX, playerY);
            const tileDirection = Math.atan2(tileY - playerY, tileX - playerX);
            
            let score = 100 - (distanceFromPlayer * 8); // Base distance scoring
            
            // Coverage bonus - prefer different directions for better area coverage
            const directionDiff = Math.abs(tileDirection - currentDirection);
            const normalizedDiff = Math.min(directionDiff, 2 * Math.PI - directionDiff);
            if (normalizedDiff > Math.PI / 3) { // 60 degrees or more different
                score += 35; // Strong bonus for different direction
            } else if (normalizedDiff > Math.PI / 6) { // 30-60 degrees different
                score += 20; // Moderate bonus
            }
            
            // Terrain strategic value
            const tileData = map[tileY]?.[tileX];
            if (tileData) {
                const terrain = tileData.terrain;
                if (terrain === 'H') score += 25; // Hills provide excellent vantage
                if (terrain === 'F' || terrain === 'J') score += 18; // Forest/jungle provide cover
                if (terrain === 'P') score += 10; // Plains allow good mobility
                if (terrain === 'W' || terrain === 'M') score -= 60; // Avoid water/mountains
                if (terrain === 'D') score -= 20; // Desert is less ideal
            }
            
            // Enemy threat assessment bonus
            const enemyThreats = nearbyEnemies.filter(e => 
                getDistanceHex(e.x, e.y, tileX, tileY) <= (pet.fovRadius + 1));
            
            if (enemyThreats.length > 0) {
                // Position allows pet to watch for enemies
                score += enemyThreats.length * 15;
                
                // Extra bonus if enemies are between tile and player (intercept position)
                enemyThreats.forEach(enemy => {
                    const enemyToPlayer = getDistanceHex(enemy.x, enemy.y, playerX, playerY);
                    const enemyToTile = getDistanceHex(enemy.x, enemy.y, tileX, tileY);
                    const tileToPlayer = getDistanceHex(tileX, tileY, playerX, playerY);
                    
                    // Bonus for intercept positions
                    if (enemyToTile < enemyToPlayer && tileToPlayer < enemyToPlayer) {
                        score += 30; // Great intercept position
                    }
                });
            }
            
            // Avoid clustering too close to recent patrol history
            const historyPenalty = petPatrolHistory.reduce((penalty, histTile) => {
                const histDist = getDistanceHex(tileX, tileY, histTile.x, histTile.y);
                if (histDist <= 2) penalty += 25; // Strong penalty for being too close to recent spots
                return penalty;
            }, 0);
            score -= historyPenalty;
            
            // Bonus for maintaining good formation with player
            const idealDistance = 3;
            const distanceDiff = Math.abs(distanceFromPlayer - idealDistance);
            if (distanceDiff <= 1) score += 20; // Perfect distance range
            
            return { tile, score };
        });
        
        // Sort by score and pick from top candidates with strategic randomness
        scoredTiles.sort((a, b) => b.score - a.score);
        const topCandidates = scoredTiles.slice(0, Math.min(4, scoredTiles.length));
        const chosenTile = topCandidates[Math.floor(Math.random() * topCandidates.length)];
        
        if (chosenTile) {
            const [chosenX, chosenY] = chosenTile.tile;
            petCurrentPatrolTargetX = chosenX; 
            petCurrentPatrolTargetY = chosenY; 
            petHasValidPatrolTarget = true;
            
            // Add to patrol history with timestamp
            petPatrolHistory.push({ x: chosenX, y: chosenY, timestamp: Date.now() });
            if (petPatrolHistory.length > MAX_PATROL_HISTORY) {
                petPatrolHistory.shift(); // Remove oldest entry
            }
            
            // Debug notification for strategic patrol
            if (typeof addNotification === 'function' && Math.random() < 0.05) {
                addNotification(`${pet.name} selected strategic patrol position (${chosenX}, ${chosenY}).`, 'pet');
            }
        }
    } else if (petPatrolHistory.length > 0) {
        // If no new spots available, clear some history and try again
        petPatrolHistory.splice(0, Math.ceil(petPatrolHistory.length / 2));
        findNewPetPatrolTarget(); // Recursive call with reduced history
    }
}

function regeneratePetEp() {
    if (pet.ep < pet.maxEp && !pet.isFallen) pet.ep = Math.min(pet.maxEp, pet.ep + PET_EP_REGEN_PER_TICK);
}

function updatePetAbilityCooldowns() {
    if (!pet.abilities) return;
    pet.abilities.forEach(ab => { if (ab.currentCooldown > 0) ab.currentCooldown--; });
}

function usePetAbilityIfAble(targetEnemy = null) {
    if (!pet || pet.isFallen || !pet.abilities || pet.abilities.length === 0) return false;
    for (const ability of pet.abilities) {
        if (ability.currentCooldown <= 0 && pet.ep >= (ability.cost || 0)) {
            let canUse = false;
            let useRange = (PET_ATTACK_ENEMY_EFFECTIVE_RANGE || 1) + (ability.rangeBonus || 0);

            if (ability.type && ability.type.includes("enemy") && !targetEnemy) continue;

            switch (ability.type) {
                case "buff_player_defense": canUse = activePlayerActor?.hp > 0 && activePlayerActor.hp < activePlayerActor.maxHp * 0.75; break;
                case "debuff_enemy_immobilize": canUse = targetEnemy && getDistanceHex(pet.x, pet.y, targetEnemy.x, targetEnemy.y) <= useRange; break;
                case "fov_boost_self": canUse = true; break;
                case "debuff_enemy_defense_player_bonus": canUse = targetEnemy && getDistanceHex(pet.x, pet.y, targetEnemy.x, targetEnemy.y) <= useRange; break;
                case "direct_damage_enemy": canUse = targetEnemy && getDistanceHex(pet.x, pet.y, targetEnemy.x, targetEnemy.y) <= useRange; break;
                default: canUse = true; break;
            }
            if (canUse) {
                pet.ep -= (ability.cost || 0); ability.currentCooldown = ability.cooldown;
                if(addNotification) addNotification(`${pet.name} uses ${ability.name}!`, 'pet');
                switch (ability.type) {
                    case "buff_player_defense": if(activePlayerActor?.addBuff) activePlayerActor.addBuff({id: "PetDefenseBuff", type:"defense_boost", value: 0.2, duration: 5*30, description:`defense boosted by ${pet.name}!`}); break;
                    case "debuff_enemy_immobilize": if(targetEnemy)targetEnemy.immobilizedTurns=(targetEnemy.immobilizedTurns||0)+3; break;
                    case "fov_boost_self": if(pet.addBuff){ pet.addBuff({id: "PetSensorSweep", type: "fov_boost", value: 2, duration: 5 * 30, description: "FoV increased!", onEnd: () => { if(addNotification) addNotification(`${pet.name}'s Sensor Sweep ended.`, 'info'); if(updateTileVisibility) updateTileVisibility(); }}); if(updateTileVisibility) updateTileVisibility();} break;
                    case "debuff_enemy_defense_player_bonus": 
                        if(targetEnemy) targetEnemy.defenseDebuffTurns=(targetEnemy.defenseDebuffTurns||0)+3; 
                        break;                    case "direct_damage_enemy": 
                        if(targetEnemy){ 
                            if(addNotification) addNotification(`${pet.name}'s ${ability.name} hits ${targetEnemy.name || 'an enemy'}!`, 'pet_attack');
                            targetEnemy.hitsTakenByPet = (targetEnemy.hitsTakenByPet || 0) + Math.floor(ability.damageFactor || 1); // Use integer damage
                            const hitsNeeded = Math.floor(BASE_PET_HITS_TO_KILL_ENEMY * (pet.hitsToKillFactor || 1)); // Ensure integer
                            if (targetEnemy.hitsTakenByPet >= hitsNeeded && !targetEnemy.isDefeated) { 
                                targetEnemy.isDefeated = true; 
                                if(addNotification) addNotification(`${pet.name} defeated ${targetEnemy.name || 'an enemy'} with ${ability.name}!`, 'pet'); 
                                const lootItem = { name: 'Scrap Component', icon: 'img/spells/item.png' }; 
                                let addedLoot = false; 
                                for (let i = 0; i < pet.inventory.length; i++) if (!pet.inventory[i]) { pet.inventory[i] = lootItem; addedLoot = true; break; } 
                                if (!addedLoot && addNotification) addNotification(`${pet.name}'s inventory full. Loot lost.`, 'warning');
                            }
                        }
                        break;
                }
                if (updatePetHUD) updatePetHUD();
                if (updatePlayerHUD && ability.type === "buff_player_defense") updatePlayerHUD();
                return true;
            }
        }
    }
    return false;
}

function movePetToward(targetX, targetY) {
    if (!pet || pet.isFallen || (pet.x === targetX && pet.y === targetY)) return;
    
    const dx = targetX - pet.x; const dy = targetY - pet.y;
    let nextX = pet.x; let nextY = pet.y; let moved = false;
    if (Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && dx !== 0) ) {
        const potX = pet.x + Math.sign(dx); if (canPetMoveToLocal(potX, pet.y)) { nextX = potX; moved = true; }
        else if (dy !== 0) { const potY = pet.y + Math.sign(dy); if (canPetMoveToLocal(pet.x, potY)) { nextY = potY; moved = true; } }
    } else if (dy !== 0) {
        const potY = pet.y + Math.sign(dy); if (canPetMoveToLocal(pet.x, potY)) { nextY = potY; moved = true; }
        else if (dx !== 0) { const potX = pet.x + Math.sign(dx); if (canPetMoveToLocal(potX, pet.y)) { nextX = potX; moved = true; } }
    }
    if (moved) {
        pet.x = nextX; pet.y = nextY; pet.tilesMovedSinceRegen = (pet.tilesMovedSinceRegen || 0) + 1;
        if (typeof HEX_SPACING_FACTOR_X !== 'undefined') { pet.worldX = HEX_SPACING_FACTOR_X * (pet.x+(pet.y%2===1?0.5:0)); pet.worldZ = HEX_SPACING_FACTOR_Z*pet.y; const tD=map[pet.y]?.[pet.x]; const tC=tD?tD.terrain:'P'; const tHF=TERRAIN_HEIGHT_FACTORS[tC]||TERRAIN_HEIGHT_FACTORS['DEFAULT']; const tAH=HEX_HEIGHT_3D*tHF; const pIH=HEX_RADIUS_3D*0.5; pet.worldY=tAH+pIH+0.05-(HEX_HEIGHT_3D/2); }
        
        // Enhanced pet rotation and animation
        if (pet.chibiInstance) {
            const movementDx = nextX - (pet.x - Math.sign(dx));
            const movementDy = nextY - (pet.y - Math.sign(dy));
            const facingVector = new THREE.Vector3(movementDx, 0, movementDy).normalize();
            
            // Set facing direction for pet
            if (pet.chibiInstance.setFacingDirection) {
                pet.chibiInstance.setFacingDirection(facingVector);
            } else if (pet.chibiInstance.direction) {
                pet.chibiInstance.direction.copy(facingVector);
            }
            
            // Trigger walking animation for pet
            if (pet.chibiInstance.walk) {
                pet.chibiInstance.walk(facingVector);
            }
        }
    } else if (pet.chibiInstance && pet.chibiInstance.stop) {
        // Stop animation if pet can't move
        pet.chibiInstance.stop();
    }
}

function petAttackEnemy(enemy) {
    if (!enemy || enemy.isDefeated || !pet || pet.isFallen) return;
    let takesRecoil = !pet.activeBuffs?.some(b => b.id === "SystemOverridePet" && b.type === "invulnerable" && b.duration > 0);
    if (!takesRecoil && addNotification) addNotification(`${pet.name} is invulnerable, no recoil!`, 'heal');
    if (takesRecoil) pet.hp = Math.max(0, pet.hp - PET_HP_LOSS_PER_HIT_ENEMY); // Now uses integer value directly
    enemy.hitsTakenByPet = (enemy.hitsTakenByPet || 0) + 1;
    const hitsNeeded = Math.floor(BASE_PET_HITS_TO_KILL_ENEMY * (pet.hitsToKillFactor || 1)); // Ensure integer
    if(addNotification) addNotification(`${pet.name} attacks enemy (${Math.floor(enemy.hitsTakenByPet)}/${hitsNeeded}). HP: ${Math.floor(pet.hp)}/${pet.maxHp}`, 'pet_attack');
    if (enemy.hitsTakenByPet >= hitsNeeded && !enemy.isDefeated) {
        enemy.isDefeated = true; if(addNotification) addNotification(`${pet.name} defeated an enemy!`, 'pet');
        const loot = { name: 'Scrap', icon: 'img/spells/item.png' }; let added = false;
        for(let i=0; i<pet.inventory.length; i++) if(!pet.inventory[i]){ pet.inventory[i]=loot; added=true; break;}
        if(!added && addNotification) addNotification(`${pet.name}'s inventory full.`, 'warning'); if(updatePetHUD) updatePetHUD();
    }
    if (pet.hp <= 0 && !pet.isFallen) { pet.isFallen = true; pet.respawnTimer = Math.floor((PET_RESPAWN_COOLDOWN*1000)/(GAME_LOOP_SPEED||250)); if(addNotification) addNotification(`${pet.name} has fallen! Respawn in ${PET_RESPAWN_COOLDOWN}s.`, 'critical'); }
    if(updatePetHUD) updatePetHUD();
}

function updatePetBehavior() {
    if (!pet || !pet.typeId || typeof pet.isFallen === 'undefined') return;
    if (pet.isFallen) {
        if (--pet.respawnTimer <= 0) {
            pet.isFallen = false; pet.hp = pet.maxHp; pet.ep = pet.maxEp; pet.activeBuffs = []; let rx=-1,ry=-1;
            if (activePlayerActor) { const px=activePlayerActor.x,py=activePlayerActor.y; const offs=ODD_R_OFFSETS?.[Math.abs(py%2)]; let fS=false; if(offs){for(const[dx,dy]of offs){const nx=px+dx,ny=py+dy;if(nx>=0&&nx<MAP_COLS&&ny>=0&&ny<MAP_ROWS&&canPetMoveToLocal(nx,ny)){rx=nx;ry=ny;fS=true;break;}}} if(!fS){rx=px;ry=py;if(!canPetMoveToLocal(rx,ry)){rx=Math.floor(MAP_COLS/2);ry=Math.floor(MAP_ROWS/2);}}}else{rx=Math.floor(MAP_COLS/2);ry=Math.floor(MAP_ROWS/2);}
            pet.x=rx; pet.y=ry; petHasValidPatrolTarget=false; pet.tilesMovedSinceRegen=0;
            if (HEX_SPACING_FACTOR_X) { pet.worldX=HEX_SPACING_FACTOR_X*(pet.x+(pet.y%2===1?0.5:0)); pet.worldZ=HEX_SPACING_FACTOR_Z*pet.y; const tD=map[pet.y]?.[pet.x],tC=tD?tD.terrain:'P',tHF=TERRAIN_HEIGHT_FACTORS[tC]||TERRAIN_HEIGHT_FACTORS['DEFAULT'],tAH=HEX_HEIGHT_3D*tHF,pIH=HEX_RADIUS_3D*0.5; pet.worldY=tAH+pIH+0.05-(HEX_HEIGHT_3D/2);}
            if(addNotification) addNotification(`${pet.name} has respawned!`, 'heal'); if(updateTileVisibility) updateTileVisibility();
            // Clear patrol history on respawn
            petPatrolHistory = [];
            lastPlayerPosition = { x: activePlayerActor.x, y: activePlayerActor.y };
        }
        if(updatePetHUD) updatePetHUD(); return;
    }
    
    // Check if player has moved significantly and adapt patrol accordingly
    if (activePlayerActor && (lastPlayerPosition.x !== activePlayerActor.x || lastPlayerPosition.y !== activePlayerActor.y)) {
        const playerMoveDist = getDistanceHex ? getDistanceHex(lastPlayerPosition.x, lastPlayerPosition.y, activePlayerActor.x, activePlayerActor.y) : 999;
        if (playerMoveDist > 2) {
            // Player moved significantly, clear patrol history to adapt to new area
            petPatrolHistory = [];
            petHasValidPatrolTarget = false;
        }
        lastPlayerPosition = { x: activePlayerActor.x, y: activePlayerActor.y };
    }
    
    if(pet.updateBuffs) pet.updateBuffs(); regeneratePetEp(); updatePetAbilityCooldowns();const distToPlayer = activePlayerActor && getDistanceHex ? getDistanceHex(pet.x,pet.y,activePlayerActor.x,activePlayerActor.y) : PET_TOO_FAR_THRESHOLD+1;
    
    if (distToPlayer > PET_TOO_FAR_THRESHOLD && !petTooFarNotificationShown) { if(addNotification) addNotification(`${pet.name} is far from ${activePlayerActor?.name||'leader'}!`, 'pet'); petTooFarNotificationShown = true; }
    else if (distToPlayer <= PET_TOO_FAR_THRESHOLD) petTooFarNotificationShown = false;    // Enhanced pet FOV and aggressive enemy targeting
    const petTrueFov = pet.activeBuffs?.find(b=>b.id==="PetSensorSweep"&&b.duration>0) ? (pet.fovRadius + pet.activeBuffs.find(b=>b.id==="PetSensorSweep").value) : pet.fovRadius;
    
    // Get all enemies within pet's FOV range
    const enemiesInRange = getDistanceHex ? enemies.filter(e=>!e.isDefeated && getDistanceHex(e.x,e.y,pet.x,pet.y) <= (petTrueFov||PET_DEFAULT_FOV_RADIUS)) : [];
    
    // Prioritize enemies by threat level and distance
    const prioritizedEnemies = enemiesInRange.map(enemy => {
        const distToEnemy = getDistanceHex(enemy.x, enemy.y, pet.x, pet.y);
        const distToPlayer = getDistanceHex(enemy.x, enemy.y, activePlayerActor.x, activePlayerActor.y);
        
        let priority = 100; // Base priority
        
        // Higher priority for enemies closer to player
        if (distToPlayer <= 2) priority += 50; // Very close to player
        else if (distToPlayer <= 4) priority += 30; // Moderately close to player
        
        // Higher priority for enemies targeting pet
        if (enemy.isTargetingPet) priority += 25;
        
        // Slightly higher priority for closer enemies to pet (for easier engagement)
        priority += Math.max(0, 10 - distToEnemy);
        
        // Bonus for enemies that can attack player this turn
        if (enemy.canAttackPlayerThisTurn) priority += 40;
        
        return { enemy, priority, distance: distToEnemy };
    }).sort((a, b) => b.priority - a.priority);
    
    const closestEnemy = prioritizedEnemies.length > 0 ? prioritizedEnemies[0].enemy : null;
    
    if (closestEnemy) { 
        petHasValidPatrolTarget = false; // Cancel patrol to engage enemy
        
        // Try to use abilities first, with priority for high-threat enemies
        if (!usePetAbilityIfAble(closestEnemy)) { 
            const dist = getDistanceHex(closestEnemy.x, closestEnemy.y, pet.x, pet.y); 
            if (dist <= (PET_ATTACK_ENEMY_EFFECTIVE_RANGE || 1)) {
                petAttackEnemy(closestEnemy);
                if (typeof addNotification === 'function') {
                    addNotification(`${pet.name} aggressively engages enemy at (${closestEnemy.x}, ${closestEnemy.y})!`, 'pet_attack');
                }
            } else {
                // Move toward enemy with enhanced pathfinding
                movePetToward(closestEnemy.x, closestEnemy.y);
                if (typeof addNotification === 'function' && Math.random() < 0.1) {
                    addNotification(`${pet.name} pursues enemy target!`, 'pet');
                }
            }
        }
    }    else if (activePlayerActor) { 
        // Enhanced dynamic pet behavior with tactical patrol patterns
        const playerFovTiles = getHexesInRadius ? getHexesInRadius(activePlayerActor.x, activePlayerActor.y, PLAYER_FOV_RADIUS) : [];
        const petInPlayerFov = playerFovTiles.some(tile => tile[0] === pet.x && tile[1] === pet.y);
        
        // Get combined FOV area (player + pet) for better coverage
        const petFovTiles = getHexesInRadius ? getHexesInRadius(pet.x, pet.y, petTrueFov) : [];
        const combinedFovTiles = [...new Set([...playerFovTiles, ...petFovTiles].map(t => `${t[0]},${t[1]}`))].map(s => s.split(',').map(Number));
        
        if (distToPlayer > 4) {
            // Pet is too far, move directly toward player with urgency
            petHasValidPatrolTarget = false;
            movePetToward(activePlayerActor.x, activePlayerActor.y);
            if (typeof addNotification === 'function' && Math.random() < 0.05) {
                addNotification(`${pet.name} is returning to your side.`, 'pet');
            }
        } else if (distToPlayer <= 1) {
            // Pet is very close, find a strategic patrol target for area coverage
            if (!petHasValidPatrolTarget || (pet.x === petCurrentPatrolTargetX && pet.y === petCurrentPatrolTargetY)) { 
                if (petHasValidPatrolTarget) petHasValidPatrolTarget = false; 
                findNewPetPatrolTarget(); 
            } 
            if (petHasValidPatrolTarget) { 
                if (pet.x !== petCurrentPatrolTargetX || pet.y !== petCurrentPatrolTargetY) {
                    movePetToward(petCurrentPatrolTargetX, petCurrentPatrolTargetY);
                } else {
                    petHasValidPatrolTarget = false; 
                }
            }
        } else if (distToPlayer <= 4) {
            // Optimal patrol distance - enhanced tactical behavior
            if (!petInPlayerFov) {
                // Pet is outside player FOV, prioritize staying within combined FOV coverage
                const closestFovTile = playerFovTiles
                    .filter(tile => canPetMoveToLocal(tile[0], tile[1]))
                    .sort((a, b) => getDistanceHex(pet.x, pet.y, a[0], a[1]) - getDistanceHex(pet.x, pet.y, b[0], b[1]))[0];
                if (closestFovTile) {
                    movePetToward(closestFovTile[0], closestFovTile[1]);
                }
            } else {
                // Pet is within FOV - intelligent tactical patrol
                const needNewTarget = !petHasValidPatrolTarget || 
                    (pet.x === petCurrentPatrolTargetX && pet.y === petCurrentPatrolTargetY) ||
                    Math.random() < 0.08; // 8% chance to find new target for dynamic behavior
                
                if (needNewTarget) {
                    if (petHasValidPatrolTarget) petHasValidPatrolTarget = false; 
                    findNewPetPatrolTarget(); 
                } 
                
                if (petHasValidPatrolTarget) { 
                    if (pet.x !== petCurrentPatrolTargetX || pet.y !== petCurrentPatrolTargetY) {
                        movePetToward(petCurrentPatrolTargetX, petCurrentPatrolTargetY);
                    } else {
                        petHasValidPatrolTarget = false; 
                    }
                } else {
                    // Enhanced fallback behavior - look for tactical positions
                    const tacticalPositions = playerFovTiles.filter(tile => {
                        if (!canPetMoveToLocal(tile[0], tile[1])) return false;
                        if (tile[0] === pet.x && tile[1] === pet.y) return false;
                        
                        const distFromPlayer = getDistanceHex(tile[0], tile[1], activePlayerActor.x, activePlayerActor.y);
                        const distFromPet = getDistanceHex(tile[0], tile[1], pet.x, pet.y);
                        
                        // Prefer positions that maintain good distance from player and are within 2 tiles of pet
                        return distFromPlayer >= 2 && distFromPlayer <= 4 && distFromPet <= 2;
                    });
                    
                    if (tacticalPositions.length > 0 && Math.random() < 0.4) {
                        // 40% chance to make a tactical move
                        const chosenPosition = tacticalPositions[Math.floor(Math.random() * tacticalPositions.length)];
                        movePetToward(chosenPosition[0], chosenPosition[1]);
                    }
                }
            }
        }
    }
    if (pet.tilesMovedSinceRegen >= PET_REGEN_TILES_MOVED && pet.hp < pet.maxHp && !pet.isFallen) { const regen = Math.ceil(pet.maxHp*PET_REGEN_HP_PERCENT); if(Math.min(regen, pet.maxHp-pet.hp)>0)pet.hp+=Math.min(regen,pet.maxHp-pet.hp); pet.tilesMovedSinceRegen=0;}
    if(updatePetHUD) updatePetHUD();
}