// js/actors/nia.js
// Low-poly polygonal isometric Nia actor
// Depends on ChibiActor

class NiaActor extends ChibiActor {
    constructor(x, y) {
        const definition = CHARACTER_DEFINITIONS["nia_sankara"];
        super(definition.id, definition.name, x, y, 100, definition.maxEp || PLAYER_DEFAULT_MAX_EP, definition.portraitImg);
        this.initializeAbilities();
        this.initializeCharacterStyling();
    }

    initializeCharacterStyling() {
        // Nia-specific color palette - Scout with earthy tones
        this.colorPalette = {
            skin: 0x3c2a1e,        // Darker brown skin
            clothing: 0x6b21a8,    // Purple clothing
            accent: 0xfbbf24,      // Gold accents
            hair: 0x1f1f1f,        // Very dark hair
            eyes: 0x92400e,        // Brown eyes
            leather: 0x451a03,     // Dark brown leather
            metal: 0x78716c        // Weathered metal
        };
        
        // Update mesh with Nia-specific styling
        this.updateMeshStyling();
        
        // Update direction arrow to character color
        if (this.directionArrow && this.directionArrow.material) {
            this.directionArrow.material.color.set(this.colorPalette.accent);
        }
    }

    updateMeshStyling() {
        if (!this.bodyParts) return;
        
        // Apply Nia-specific materials
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
        
        // Add scout equipment
        this.addScoutEquipment();
    }

    addScoutEquipment() {
        if (!this.bodyParts.body) return;
          // Add scout belt
        const beltGeometry = new THREE.BoxGeometry(0.36, 0.08, 0.32);
        const beltMaterial = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.leather
        });
        const belt = new THREE.Mesh(beltGeometry, beltMaterial);
        belt.position.set(0, -0.1, 0);
        this.bodyParts.body.add(belt);
        
        // Add shoulder straps
        const strapGeometry = new THREE.BoxGeometry(0.06, 0.3, 0.06);
        const strapMaterial = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.leather
        });
        
        const leftStrap = new THREE.Mesh(strapGeometry, strapMaterial);
        leftStrap.position.set(-0.12, 0.1, 0.1);
        this.bodyParts.body.add(leftStrap);
        
        const rightStrap = new THREE.Mesh(strapGeometry, strapMaterial);
        rightStrap.position.set(0.12, 0.1, 0.1);
        this.bodyParts.body.add(rightStrap);
        
        // Add scout emblem on chest
        const emblemGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 6);
        const emblemMaterial = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.accent
        });
        const emblem = new THREE.Mesh(emblemGeometry, emblemMaterial);
        emblem.position.set(0, 0.16, 0.26);
        this.bodyParts.body.add(emblem);
    }

    // Override ability animation for scout-themed effects
    playAbilityAnimation() {
        if (!this.bodyParts) return;
        
        // Scout scanning animation - hand to forehead, slight lean forward
        if (this.bodyParts.rightArm) {
            this.bodyParts.rightArm.rotation.x = -Math.PI / 4;
            this.bodyParts.rightArm.rotation.z = -Math.PI / 6;
        }
        if (this.bodyParts.body) {
            this.bodyParts.body.rotation.x = Math.PI / 12;
        }
        if (this.bodyParts.head) {
            this.bodyParts.head.rotation.x = -Math.PI / 8;
        }
        
        // Reset after animation
        setTimeout(() => {
            if (this.bodyParts.rightArm) {
                this.bodyParts.rightArm.rotation.x = 0;
                this.bodyParts.rightArm.rotation.z = 0;
            }
            if (this.bodyParts.body) this.bodyParts.body.rotation.x = 0;
            if (this.bodyParts.head) this.bodyParts.head.rotation.x = 0;
        }, 1000);
    }

    initializeAbilities() {
        this.abilities = [
            {
                name: "Power Strike", hotkey: '1', cost: 20, cooldown: 3, currentCooldown: 0,
                description: "A focused melee attack dealing 150% damage.",
                icon: "img/spells/ability1.png", // Placeholder icon
                action: (target) => {
                    if (this.consumeEp(this.abilities[0].cost)) {
                        this.abilities[0].currentCooldown = this.abilities[0].cooldown;
                        console.log(`${this.name} uses Power Strike!`);
                        // TODO: Implement actual targeting and damage dealing
                        if(typeof addNotification === 'function') addNotification(`${this.name} used Power Strike!`, 'player_action');
                        // Example: find adjacent enemy and deal damage
                        // For now, just a log
                    }
                }
            },
            {
                name: "Rapid Scout", hotkey: '2', cost: 15, cooldown: 10, currentCooldown: 0,
                description: "Temporarily increases FoV by 2 for 5 turns.",
                icon: "img/spells/ability2.png", // Placeholder icon
                action: () => {
                     if (this.consumeEp(this.abilities[1].cost)) {
                        this.abilities[1].currentCooldown = this.abilities[1].cooldown;
                        this.addBuff({
                            id: "RapidScoutBuff", type: "fov_boost", value: 2, duration: 5 * 30, // 5 turns, assuming 30 ticks/turn approx
                            description: "FoV increased!",
                            onEnd: () => { if(typeof addNotification === 'function') addNotification("Rapid Scout FoV boost ended.", 'info'); }
                        });
                        // Actual FoV increase needs to be handled in rendering logic by checking for this buff
                    }
                }
            },
            {
                name: "Heal Pet", hotkey: '3', cost: 30, cooldown: 8, currentCooldown: 0,
                description: "Restores 40% of Pet's max HP.",
                icon: "img/spells/ability3.png",
                action: () => {
                    if (this.consumeEp(this.abilities[2].cost)) {
                        if (pet && !pet.isFallen) {
                            const healAmount = Math.floor(pet.maxHp * 0.40);
                            pet.hp = Math.min(pet.maxHp, pet.hp + healAmount);
                            this.abilities[2].currentCooldown = this.abilities[2].cooldown;
                            if(typeof addNotification === 'function') addNotification(`${this.name} healed ${pet.name} for ${healAmount} HP.`, 'player_action');
                            if(typeof updatePetHUD === 'function') updatePetHUD();
                        } else {
                            if(typeof addNotification === 'function') addNotification(`Pet is not available or fallen.`, 'warning');
                            this.ep += this.abilities[2].cost; // Refund EP
                        }
                    }
                }
            },
            {
                name: "Ancestral Echo", hotkey: '4', cost: 25, cooldown: 15, currentCooldown: 0,
                description: "For 10 turns, all terrain movement costs become 1.",
                icon: "img/spells/ability4.png",
                action: () => {
                    if (this.consumeEp(this.abilities[3].cost)) {
                        this.abilities[3].currentCooldown = this.abilities[3].cooldown;
                         this.addBuff({
                            id: "AncestralEchoBuff", type: "ignore_terrain_cost", value: 1, duration: 10 * 30, // 10 turns
                            description: "movement cost is now 1!",
                        });
                    }
                }
            }
        ];
    }

    useAbility(abilityIndex, target = null) {
        if (this.abilities[abilityIndex]) {
            const ability = this.abilities[abilityIndex];
            if (ability.currentCooldown > 0) {
                if(typeof addNotification === 'function') addNotification(`${ability.name} is on cooldown for ${ability.currentCooldown} more ticks.`, 'warning');
                return;
            }            if (typeof ability.action === 'function') {
                ability.action(target); // Target might be used by some abilities
                if (typeof updatePlayerHUD === 'function') updatePlayerHUD();
            }
        }
    }
}

// Export to global scope for compatibility
window.NiaActor = NiaActor;