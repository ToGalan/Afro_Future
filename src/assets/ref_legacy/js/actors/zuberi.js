// js/actors/zuberi.js
// Low-poly polygonal isometric Zuberi actor
// Depends on ChibiActor

class ZuberiActor extends ChibiActor {
    constructor(x, y) {
        const definition = CHARACTER_DEFINITIONS["zuberi_adebayo"];
        super(definition.id, definition.name, x, y, 120, definition.maxEp || (PLAYER_DEFAULT_MAX_EP + 20), definition.portraitImg);
        this.initializeAbilities();
        this.initializeCharacterStyling();
    }

    initializeCharacterStyling() {
        // Zuberi-specific color palette - Tech specialist with vibrant colors
        this.colorPalette = {
            skin: 0x4a3c28,        // Rich brown skin
            clothing: 0x1a472a,    // Deep green tech suit
            accent: 0x059669,      // Bright green accents
            hair: 0x1f2937,        // Dark hair
            eyes: 0x10b981,        // Bright green eyes
            metallic: 0x6b7280,    // Metallic tech elements
            glow: 0x34d399         // Tech glow color
        };
        
        // Update mesh with Zuberi-specific styling
        this.updateMeshStyling();
        
        // Update direction arrow to character color
        if (this.directionArrow && this.directionArrow.material) {
            this.directionArrow.material.color.set(this.colorPalette.accent);
        }
    }

    updateMeshStyling() {
        if (!this.bodyParts) return;
        
        // Apply Zuberi-specific materials
        Object.keys(this.bodyParts).forEach(partName => {
            const part = this.bodyParts[partName];
            if (!part) return;
            
            let color;
            switch(partName) {
                case 'head':
                    color = this.colorPalette.skin;
                    break;
                case 'body':
                    color = this.colorPalette.clothing;
                    break;
                case 'leftArm':
                case 'rightArm':
                    color = this.colorPalette.clothing;
                    break;
                case 'leftLeg':
                case 'rightLeg':
                    color = this.colorPalette.clothing;
                    break;
                case 'hair':
                    color = this.colorPalette.hair;
                    break;
                default:
                    color = this.colorPalette.accent;
            }
            
            part.material = new THREE.MeshLambertMaterial({ 
                color: color
            });
        });
        
        // Add tech elements
        this.addTechElements();
    }

    addTechElements() {
        if (!this.bodyParts.body) return;
          // Add chest tech panel
        const panelGeometry = new THREE.BoxGeometry(0.3, 0.16, 0.04);
        const panelMaterial = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.metallic
        });
        const chestPanel = new THREE.Mesh(panelGeometry, panelMaterial);
        chestPanel.position.set(0, 0.2, 0.26);
        this.bodyParts.body.add(chestPanel);
        
        // Add shoulder tech details
        const shoulderGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
        const shoulderMaterial = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.accent
        });
        
        if (this.bodyParts.leftArm) {
            const leftShoulder = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
            leftShoulder.position.set(0, 0.3, 0);
            this.bodyParts.leftArm.add(leftShoulder);
        }
        
        if (this.bodyParts.rightArm) {
            const rightShoulder = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
            rightShoulder.position.set(0, 0.3, 0);
            this.bodyParts.rightArm.add(rightShoulder);
        }
    }

    // Override ability animation for tech-themed effects
    playAbilityAnimation() {
        if (!this.bodyParts) return;
        
        // Tech barrier animation - arms spread wide, body glows
        if (this.bodyParts.leftArm) {
            this.bodyParts.leftArm.rotation.z = Math.PI / 3;
        }
        if (this.bodyParts.rightArm) {
            this.bodyParts.rightArm.rotation.z = -Math.PI / 3;
        }
        if (this.bodyParts.body) {
            this.bodyParts.body.material.emissive.setHex(0x065f46);
        }
        
        // Reset after animation
        setTimeout(() => {
            if (this.bodyParts.leftArm) this.bodyParts.leftArm.rotation.z = 0;
            if (this.bodyParts.rightArm) this.bodyParts.rightArm.rotation.z = 0;
            if (this.bodyParts.body) this.bodyParts.body.material.emissive.setHex(0x000000);
        }, 800);
    }

    initializeAbilities() {
        this.abilities = [
            {
                name: "Kinetic Barrier", hotkey: '1', cost: 25, cooldown: 12, currentCooldown: 0,
                description: "Absorbs the next 2 incoming hits or lasts 5 turns.",
                icon: "img/spells/ability5.png",
                action: () => {
                    if (this.consumeEp(this.abilities[0].cost)) {
                        this.abilities[0].currentCooldown = this.abilities[0].cooldown;
                        this.addBuff({
                            id: "Kinetic Barrier", type: "absorb_damage", value: 50, // Absorb up to 50 damage
                            duration: 5 * 30, // 5 turns approx.
                            description: "activated Kinetic Barrier!"
                        });
                    }
                }
            },
            {
                name: "Overload Blast", hotkey: '2', cost: 35, cooldown: 8, currentCooldown: 0,
                description: "Damages enemies in a cone in front of Zuberi.",
                icon: "img/spells/ability6.png",
                action: (target) => { // Target could be direction or first enemy
                    if (this.consumeEp(this.abilities[1].cost)) {
                         this.abilities[1].currentCooldown = this.abilities[1].cooldown;
                        console.log(`${this.name} uses Overload Blast!`);
                        if(typeof addNotification === 'function') addNotification(`${this.name} unleashed an Overload Blast!`, 'player_action');
                        // TODO: Implement cone targeting and damage to multiple enemies.
                    }
                }
            },
            {
                name: "Tactical Reposition", hotkey: '3', cost: 15, cooldown: 5, currentCooldown: 0,
                description: "Performs a short dash (2 tiles) in a chosen direction, ignoring terrain.",
                icon: "img/spells/ability7.png",
                action: (/* A way to choose direction would be needed, e.g. via mouse click or subsequent key */) => {
                    if (this.consumeEp(this.abilities[2].cost)) {
                        this.abilities[2].currentCooldown = this.abilities[2].cooldown;
                        if(typeof addNotification === 'function') addNotification(`${this.name} dashes tactically!`, 'player_action');
                        // TODO: Implement dash movement. Needs direction input.
                        // Example: Could open a short-lived "dash mode"
                    }
                }
            },
            {
                name: "System Override", hotkey: '4', cost: 50, cooldown: 20, currentCooldown: 0,
                description: "All abilities have no cooldowns and Pet becomes invulnerable for 3 turns.",
                icon: "img/spells/ability8.png",
                action: () => {
                    if (this.consumeEp(this.abilities[3].cost)) {
                        this.abilities[3].currentCooldown = this.abilities[3].cooldown;
                        this.addBuff({
                            id: "SystemOverrideSelf", type: "no_cooldowns", value: true, duration: 3 * 30,
                            description: "system override engaged (no CDs)!"
                        });
                        if (pet && !pet.isFallen) {
                             pet.addBuff({ // Assuming pet also has addBuff/removeBuff methods if it can have buffs
                                id: "SystemOverridePet", type: "invulnerable", value: true, duration: 3 * 30,
                                description: "system override engaged (invulnerable)!"
                            });
                        }
                    }
                }
            }
        ];
    }
    
    useAbility(abilityIndex, target = null) {
        if (this.abilities[abilityIndex]) {
            const ability = this.abilities[abilityIndex];
            let isOverridden = false;
            if(this.activeBuffs.some(b => b.type === 'no_cooldowns' && b.duration > 0)) {
                isOverridden = true;
            }            if (!isOverridden && ability.currentCooldown > 0) {
                if(typeof addNotification === 'function') addNotification(`${ability.name} is on cooldown for ${ability.currentCooldown} more ticks.`, 'warning');
                return;
            }
            if (typeof ability.action === 'function') {
                ability.action(target);
                if (typeof updatePlayerHUD === 'function') updatePlayerHUD();
            }
        }
    }
}

// Export to global scope for compatibility
window.ZuberiActor = ZuberiActor;