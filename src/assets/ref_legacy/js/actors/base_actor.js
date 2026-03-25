// js/actors/base_actor.js

class BaseActor {
    constructor(id, name, x, y, maxHp, maxEp, portraitImg) {
        this.id = id;
        this.name = name || "Actor";
        this.x = x;
        this.y = y;
        
        // Initialize 3D world coordinates based on grid coordinates
        this.worldX = HEX_SPACING_FACTOR_X * (this.x + (this.y % 2 === 1 ? 0.5 : 0));
        this.worldZ = HEX_SPACING_FACTOR_Z * this.y;
        this.worldY = HEX_HEIGHT_3D / 2 + 0.1; // Default height offset for actors

        this.maxHp = maxHp || 100;
        this.hp = this.maxHp;
        this.maxEp = maxEp || PLAYER_DEFAULT_MAX_EP;
        this.ep = this.maxEp;
        
        this.level = 1;
        this.xp = 0;
        this.xpToNextLevel = XP_PER_LEVEL_BASE;

        this.isDefeated = false;
        this.abilities = []; // Should be populated by derived classes
        this.activeBuffs = []; // To store active buffs/debuffs
        this.movementProgress = { targetX: -1, targetY: -1, remainingCost: 0 };
        
        this.tilesMovedSinceRegen = 0;
        this.tilesMovedSinceSpawnZonePause = 0;
        this.portraitImg = portraitImg && portraitImg.trim() !== "" ? portraitImg : "img/nia.png"; // Always default to nia.png if not provided

        // Color for map representation (if any still used, or for debug)
        this.color = '#FFFF00'; // Default bright yellow for player types
    }

    takeDamage(amount) {
        if (this.isDefeated) return;

        // Check for damage reduction buffs (e.g., Kinetic Barrier)
        let damageToTake = amount;
        const barrierBuff = this.activeBuffs.find(b => b.type === 'absorb_damage' && b.value > 0);
        if (barrierBuff) {
            if (barrierBuff.value >= damageToTake) {
                barrierBuff.value -= damageToTake;
                if(typeof addNotification === 'function') addNotification(`${this.name}'s barrier absorbed ${damageToTake} damage! Remaining: ${barrierBuff.value}`, 'heal');
                damageToTake = 0;
                if (barrierBuff.value <= 0) {
                    this.removeBuff(barrierBuff.id || 'Kinetic Barrier'); // Remove buff if depleted
                }
            } else {
                if(typeof addNotification === 'function') addNotification(`${this.name}'s barrier absorbed ${barrierBuff.value} damage and broke!`, 'damage');
                damageToTake -= barrierBuff.value;
                this.removeBuff(barrierBuff.id || 'Kinetic Barrier'); // Remove buff
            }
        }

        this.hp = Math.max(0, this.hp - damageToTake);
        if(typeof addNotification === 'function' && damageToTake > 0) {
            addNotification(`${this.name} takes ${damageToTake} damage. HP: ${this.hp}/${this.maxHp}`, 'damage');
        }

        if (this.hp <= 0) {
            this.isDefeated = true;
            window.playerCaught = true; // Global flag
            if(typeof addNotification === 'function') addNotification(`${this.name} has been defeated!`, 'critical');
        }
        if (typeof updatePlayerHUD === 'function' && this === activePlayerActor) updatePlayerHUD();
    }

    heal(amount) {
        this.hp = Math.min(this.maxHp, this.hp + amount);
        if(typeof addNotification === 'function') addNotification(`${this.name} healed for ${amount}. HP: ${this.hp}/${this.maxHp}`, 'heal');
        if (typeof updatePlayerHUD === 'function' && this === activePlayerActor) updatePlayerHUD();
    }

    regenerateHp() {
        if (this.isDefeated || this.hp >= this.maxHp) return;
        this.tilesMovedSinceRegen++;
        if (this.tilesMovedSinceRegen >= PLAYER_REGEN_TILES_MOVED) {
            const regenAmount = Math.max(1, Math.floor(this.maxHp * PLAYER_REGEN_HP_PERCENT));
            this.heal(regenAmount);
            this.tilesMovedSinceRegen = 0;
        }
    }

    regenerateEp() {
        if (this.isDefeated || this.ep >= this.maxEp) return;
        this.ep = Math.min(this.maxEp, this.ep + PLAYER_EP_REGEN_PER_TICK);
        // No notification for EP regen to avoid spam
        if (typeof updatePlayerHUD === 'function' && this === activePlayerActor) updatePlayerHUD();
    }
    
    hasEnoughEp(cost) {
        return this.ep >= cost;
    }

    consumeEp(cost) {
        if (this.hasEnoughEp(cost)) {
            this.ep -= cost;
            if (typeof updatePlayerHUD === 'function' && this === activePlayerActor) updatePlayerHUD();
            return true;
        }
        if(typeof addNotification === 'function') addNotification(`Not enough EP for ${this.name}! Needs ${cost}, has ${Math.floor(this.ep)}.`, 'warning');
        return false;
    }
    
    updateAbilityCooldowns() {
        this.abilities.forEach(ability => {
            if (ability.currentCooldown && ability.currentCooldown > 0) {
                ability.currentCooldown -= 1; // Cooldowns are per tick/turn for simplicity
            }
        });
    }

    gainXp(amount) {
        if (this.level >= PLAYER_MAX_LEVEL) return;
        this.xp += amount;
        if(typeof addNotification === 'function') addNotification(`${this.name} gained ${amount} XP!`, 'info');
        while (this.xp >= this.xpToNextLevel && this.level < PLAYER_MAX_LEVEL) {
            this.levelUp();
        }
        if (typeof updatePlayerHUD === 'function' && this === activePlayerActor) updatePlayerHUD();
    }

    levelUp() {
        this.level++;
        this.xp -= this.xpToNextLevel; // Carry over excess XP
        this.xpToNextLevel = Math.floor(XP_PER_LEVEL_BASE * Math.pow(XP_PER_LEVEL_INCREASE_FACTOR, this.level - 1));
        
        // Basic stat increases on level up
        this.maxHp += Math.floor(this.maxHp * 0.1);
        this.hp = this.maxHp; // Full heal on level up
        this.maxEp += Math.floor(this.maxEp * 0.05);
        this.ep = this.maxEp;
        
        if(typeof addNotification === 'function') addNotification(`${this.name} reached Level ${this.level}! Stats increased!`, 'player');
        // TODO: Offer ability upgrades or new abilities here.
    }

    addBuff(buff) { // buff = {id, type, value, duration, onEnd: function(){}}
        const existingBuffIndex = this.activeBuffs.findIndex(b => b.id === buff.id);
        if (existingBuffIndex !== -1) { // Refresh existing buff
            this.activeBuffs[existingBuffIndex] = buff;
        } else {
            this.activeBuffs.push(buff);
        }
        if(typeof addNotification === 'function' && buff.description) addNotification(`${this.name} ${buff.description}`, 'buff');
    }

    removeBuff(buffId) {
        const buffIndex = this.activeBuffs.findIndex(b => b.id === buffId);
        if (buffIndex !== -1) {
            const buffToEnd = this.activeBuffs[buffIndex];
            if (typeof buffToEnd.onEnd === 'function') {
                buffToEnd.onEnd.call(this); // Execute onEnd callback
            }
            this.activeBuffs.splice(buffIndex, 1);
             if(typeof addNotification === 'function' && buffToEnd.id) addNotification(`${buffToEnd.id} wore off for ${this.name}.`, 'info');
        }
    }
    
    updateBuffs() {
        for (let i = this.activeBuffs.length - 1; i >= 0; i--) {
            const buff = this.activeBuffs[i];
            if (buff.duration !== Infinity) { // Check for Infinity duration
                buff.duration--;
                if (buff.duration <= 0) {
                    this.removeBuff(buff.id);
                }
            }
        }
    }

    getActiveBuffs() {
        return this.activeBuffs;
    }

    updatePerTick() {
        // Called each game tick (e.g., every 1/30th of a second or on player action)        this.regenerateEp();
        this.updateAbilityCooldowns();
        this.updateBuffs();
        // Other per-tick logic...
    }
    
    // To be implemented by derived classes for specific ability logic
    // useAbility(abilityIndex, target = null) {
    //     console.warn(`useAbility not implemented for ${this.name}`);
    // }
}

// Export to global scope for compatibility
window.BaseActor = BaseActor;