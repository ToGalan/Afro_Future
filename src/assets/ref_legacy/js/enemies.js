// js/enemies.js
// Depends on: core.js variables (MAP_COLS, MAP_ROWS, IMPASSABLE_TILES, activePlayerActor, pet, enemies, BASE_PET_HITS_TO_KILL_ENEMY, TERRAIN_MOVEMENT_PENALTIES)
// Depends on: addNotification (from notifications.js)

function spawnEnemies() {
    if (enemies.length >= MAX_ENEMIES) return;
    let activeSpawnZones = enemySpawnZones.filter(zone => zone.isActive);

    if(activeSpawnZones.length === 0 && enemySpawnZones.length > 0) { 
        return; 
    } else if (enemySpawnZones.length === 0) {
        const numRnd = Math.min(3, MAX_ENEMIES - enemies.length);
        for(let i=0; i<numRnd; i++){ 
            let ex,ey,att=0; 
            do {
                ex=Math.floor(Math.random()*MAP_COLS);
                ey=Math.floor(Math.random()*MAP_ROWS);
                att++;
            } while(
                (
                    (map[ey]?.[ex] && IMPASSABLE_TILES.has(map[ey][ex])) ||
                    (map[ey]?.[ex]==='V' && Math.random()<0.6) ||
                    (activePlayerActor && Math.abs(activePlayerActor.x-ex)+Math.abs(activePlayerActor.y-ey)<20) ||
                    (pet && !pet.isFallen && pet.hp>0 && pet.x===ex && pet.y===ey) || 
                    enemies.some(en=>en.x===ex && en.y===ey)
                ) && att<50
            ); 
            if(att<50) enemies.push({x:ex,y:ey,hitsTakenByPet:0,canAttackPlayerThisTurn:false, isTargetingPet: false}); // Added isTargetingPet
        }
        return;
    }

    const numToSpawn = Math.min(5, MAX_ENEMIES - enemies.length); 
    for(let i=0; i<numToSpawn; i++){
        if(activeSpawnZones.length === 0) break;
        const zone = activeSpawnZones[Math.floor(Math.random()*activeSpawnZones.length)];
        let ex,ey,att=0; 
        do { 
            const oR=4;
            ex=zone.x+Math.floor(Math.random()*(oR*2+1))-oR;
            ey=zone.y+Math.floor(Math.random()*(oR*2+1))-oR;
            ex=Math.max(0,Math.min(MAP_COLS-1,ex));
            ey=Math.max(0,Math.min(MAP_ROWS-1,ey));
            att++;
        } while(
            (
                (map[ey]?.[ex] && IMPASSABLE_TILES.has(map[ey][ex])) ||
                (map[ey]?.[ex]==='V' && Math.random()<0.6) ||
                (activePlayerActor && Math.abs(activePlayerActor.x-ex)+Math.abs(activePlayerActor.y-ey)<20) ||
                (pet && !pet.isFallen && pet.hp>0 && pet.x===ex && pet.y===ey) ||
                enemies.some(en=>en.x===ex && en.y===ey)
            ) && att<20
        );
        if(att<20) enemies.push({x:ex,y:ey,hitsTakenByPet:0,canAttackPlayerThisTurn:false, isTargetingPet: false}); // Added isTargetingPet
    }
}

function updateEnemySpawnZones() {
    if(!activePlayerActor)return;
    let playerTilesMovedSincePause = activePlayerActor.tilesMovedSinceSpawnZonePause || 0;
    let rechargeOccurred = false;
    enemySpawnZones.forEach(z=>{
        if(!z.isActive){
            if(playerTilesMovedSincePause >= ENEMY_SPAWN_ZONE_RECHARGE_MOVES){
                z.isActive=true;
                if(typeof addNotification === 'function') addNotification(`Enemy spawn zone at (${z.x},${z.y}) reactivated!`, 'enemy');
                rechargeOccurred = true;
            }
        }
    });
    if(rechargeOccurred) activePlayerActor.tilesMovedSinceSpawnZonePause = 0;
}


function moveEnemies() {
    let survivingEnemies = [];
    if (window.playerCaught || !activePlayerActor || activePlayerActor.isDefeated) {
        enemies.forEach(e => survivingEnemies.push(e));
        enemies = survivingEnemies;
        return;
    }

    for (const e of enemies) {
        let currentEnemy = { ...e };
        const hitsNeededForPetToKill = (typeof pet !== 'undefined' && pet.hitsToKillFactor) ? 
                                     (BASE_PET_HITS_TO_KILL_ENEMY * pet.hitsToKillFactor) : 
                                     BASE_PET_HITS_TO_KILL_ENEMY;        if (currentEnemy.hitsTakenByPet >= hitsNeededForPetToKill) {
            if (!currentEnemy.isDefeated) {
                currentEnemy.isDefeated = true;
                if(typeof addNotification === 'function') addNotification("Enemy defeated by pet!", 'pet');
            }
            continue; 
        }

        let targetX = activePlayerActor.x;
        let targetY = activePlayerActor.y;
        let isTargetingPetThisTurn = false; // Renamed to avoid conflict with persisted property

        if (pet && !pet.isFallen && pet.hp > 0) { // Check if pet object exists
            const distToPlayer = Math.abs(activePlayerActor.x - currentEnemy.x) + Math.abs(activePlayerActor.y - currentEnemy.y);
            const distToPet = Math.abs(pet.x - currentEnemy.x) + Math.abs(pet.y - currentEnemy.y);
            
            const enemyCount = enemies.filter(en => !en.isDefeated).length; // Consider only non-defeated enemies for count

            const considerPetTarget = (distToPet < distToPlayer - 2 && distToPlayer > 1) || 
                                     (enemyCount > 1 && distToPet <= 10 && Math.random() < 0.3); 

            if (considerPetTarget) {
                targetX = pet.x;
                targetY = pet.y;
                isTargetingPetThisTurn = true; 
            }
        } // <<<< CORRECTED: Properly closed the if block here.

        const dxTarget = targetX - currentEnemy.x;
        const dyTarget = targetY - currentEnemy.y;
        let nextEx = currentEnemy.x;
        let nextEy = currentEnemy.y;
        let enemyDecidedToMoveThisTick = false;
        const distToTarget = Math.abs(dxTarget) + Math.abs(dyTarget);

        currentEnemy.canAttackPlayerThisTurn = false;

        if (distToTarget === 1) { 
            if (!isTargetingPetThisTurn && activePlayerActor.hp > 0) { 
                currentEnemy.canAttackPlayerThisTurn = true; 
            }
            enemyDecidedToMoveThisTick = false; 
        } else if (distToTarget <= 20 && distToTarget > 1) { 
            enemyDecidedToMoveThisTick = true;
            if (Math.abs(dxTarget) > Math.abs(dyTarget)) {
                nextEx = currentEnemy.x + Math.sign(dxTarget);
            } else if (dyTarget !== 0) {
                nextEy = currentEnemy.y + Math.sign(dyTarget);
            } else if (dxTarget !== 0) { 
                nextEx = currentEnemy.x + Math.sign(dxTarget);
            }
        }

        if (enemyDecidedToMoveThisTick) {
            let blockedByPlayer = (nextEx === activePlayerActor.x && nextEy === activePlayerActor.y);
            let blockedByPet = (pet && !pet.isFallen && pet.hp > 0 && nextEx === pet.x && nextEy === pet.y);

            if (blockedByPlayer) {
                 if (!isTargetingPetThisTurn) currentEnemy.canAttackPlayerThisTurn = true;
            } else if (blockedByPet) {
                // Enemy blocked by pet
            } else {                const targetTileChar = map[nextEy]?.[nextEx];
                if (targetTileChar && !IMPASSABLE_TILES.has(targetTileChar)) {
                    const moveCost = Math.floor(TERRAIN_MOVEMENT_PENALTIES[targetTileChar] || 1);
                    if (Math.random() * moveCost < 1.0) {
                        currentEnemy.x = nextEx;
                        currentEnemy.y = nextEy;
                        if (!isTargetingPetThisTurn && Math.abs(activePlayerActor.x - currentEnemy.x) + Math.abs(activePlayerActor.y - currentEnemy.y) === 1) {
                            currentEnemy.canAttackPlayerThisTurn = true;
                        }
                    }
                }
            }
        }
        
        if (!isTargetingPetThisTurn && Math.abs(activePlayerActor.x - currentEnemy.x) + Math.abs(activePlayerActor.y - currentEnemy.y) === 1 && activePlayerActor.hp > 0) {
            currentEnemy.canAttackPlayerThisTurn = true;
        }
        currentEnemy.isTargetingPet = isTargetingPetThisTurn; // Update the persistent property

        survivingEnemies.push(currentEnemy);
    }
    enemies = survivingEnemies;
}