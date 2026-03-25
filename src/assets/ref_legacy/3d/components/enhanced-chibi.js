/**
 * Enhanced Chibi Actor with 3D System Integration
 * Low-Poly Polygonal Isometric style with advanced animations
 */

class Enhanced3DChibi {
    constructor(parentGroup, x, y, z, actorType = 'base') {
        this.parentGroup = parentGroup;
        this.position = { x, y, z };
        this.actorType = actorType;
        this.mesh = null;
        this.bodyParts = {};        this.animationState = {
            current: 'idle',
            time: 0,
            bobAmount: 0.06, // 2x scale: 0.03 -> 0.06
            bobSpeed: 3.0,
            walkCycleSpeed: 5.0,
            isMoving: false,
            facingDirection: 0,
            morphTarget: null,
            morphTime: 0
        };
        
        this.createMesh();
    }

    createMesh() {
        // Create enhanced low-poly isometric chibi with 3D system integration
        const chibi = new THREE.Group();
        
        // Get styled colors from 3D system if available
        const getStyledColor = (baseColor, type) => {
            if (window.threeDSystem?.getIsometricColor) {
                return window.threeDSystem.getIsometricColor(baseColor, type);
            }
            return baseColor;
        };
        
        // Enhanced color palette for different actor types
        let skinColor, clothingColor, darkColor, accentColor, hairColor;
          switch (this.actorType) {
            case 'nia':
                skinColor = getStyledColor(0x8b4513, 'skin'); // Changed to brown skin tone
                clothingColor = getStyledColor(0x8e44ad, 'clothing');
                darkColor = getStyledColor(0x2c3e50, 'dark');
                accentColor = getStyledColor(0xf39c12, 'accent');
                hairColor = getStyledColor(0x34495e, 'hair');
                break;
            case 'zuberi':
                skinColor = getStyledColor(0x8b4513, 'skin'); // Consistent brown skin tone
                clothingColor = getStyledColor(0x1e3a8a, 'clothing');
                darkColor = getStyledColor(0x1f2937, 'dark');
                accentColor = getStyledColor(0xdc2626, 'accent');
                hairColor = getStyledColor(0x000000, 'hair');
                break;
            default:
                skinColor = getStyledColor(0x8b4513, 'skin'); // Default brown skin tone
                clothingColor = getStyledColor(0x4a90e2, 'clothing');
                darkColor = getStyledColor(0x2c3e50, 'dark');
                accentColor = getStyledColor(0xe74c3c, 'accent');
                hairColor = getStyledColor(0x654321, 'hair');
                break;
        }
        
        // Create enhanced low-poly geometry with better proportions
        const createStyledMaterial = (color, type = 'default') => {
            if (window.threeDSystem?.createStyledMaterial) {
                return window.threeDSystem.createStyledMaterial(color, type);
            }
            return new THREE.MeshStandardMaterial({ 
                color, 
                roughness: 0.7, 
                metalness: 0.0,
                flatShading: true 
            });
        };
          // HEAD - Enhanced octahedron with 2x chibi proportions
        const headGeo = new THREE.OctahedronGeometry(0.4, 1); // 2x scale: 0.22 -> 0.4
        const headMat = createStyledMaterial(skinColor, 'character');
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.0; // 2x scale: 0.52 -> 1.0
        this.bodyParts.head = head;        // HAIR - Character-specific hair styles with 2x scale
        if (this.actorType === 'nia') {
            const hairGeo = new THREE.SphereGeometry(0.35, 8, 6); // Changed to round sphere, slightly smaller for better proportions
            const hairMat = createStyledMaterial(hairColor, 'character');
            const hair = new THREE.Mesh(hairGeo, hairMat);
            hair.position.y = 1.25; // Raised slightly higher: 1.2->1.25
            hair.scale.set(1.0, 0.8, 1.0); // Slightly flatten for natural look
            this.bodyParts.hair = hair;
            chibi.add(hair);
        } else if (this.actorType === 'zuberi') {
            const hairGeo = new THREE.SphereGeometry(0.42, 8, 6); // 2x scale: 0.23 -> 0.42
            const hairMat = createStyledMaterial(hairColor, 'character');
            const hair = new THREE.Mesh(hairGeo, hairMat);
            hair.position.y = 1.2; // Increased slightly higher to prevent head showing through
            hair.scale.y = 0.7;
            this.bodyParts.hair = hair;
            chibi.add(hair);
        }
          // BODY - Enhanced proportions with 2x scale
        const bodyGeo = new THREE.BoxGeometry(0.6, 0.7, 0.4); // 2x scale: 0.32->0.6, 0.38->0.7, 0.22->0.4
        const bodyMat = createStyledMaterial(clothingColor, 'character');
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.5; // 2x scale: 0.26 -> 0.5
        this.bodyParts.body = body;
          // LEGS - Better proportioned with 2x scale
        const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16); // 2x scale: 0.09->0.16, 0.28->0.5
        const legMat = createStyledMaterial(darkColor, 'character');
        
        const leftLeg = new THREE.Mesh(legGeo, legMat);
        leftLeg.position.set(-0.16, 0.1, 0); // 2x scale: -0.09->-0.16, 0.06->0.1
        this.bodyParts.leftLeg = leftLeg;
        
        const rightLeg = new THREE.Mesh(legGeo, legMat);
        rightLeg.position.set(0.16, 0.1, 0); // 2x scale: 0.09->0.16, 0.06->0.1
        this.bodyParts.rightLeg = rightLeg;
          // ARMS - Enhanced proportions with 2x scale
        const armGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12); // 2x scale: 0.07->0.12, 0.22->0.4
        const armMat = createStyledMaterial(skinColor, 'character');
        
        const leftArm = new THREE.Mesh(armGeo, armMat);
        leftArm.position.set(-0.36, 0.6, 0); // 2x scale: -0.19->-0.36, 0.32->0.6
        this.bodyParts.leftArm = leftArm;
        
        const rightArm = new THREE.Mesh(armGeo, armMat);
        rightArm.position.set(0.36, 0.6, 0); // 2x scale: 0.19->0.36, 0.32->0.6
        this.bodyParts.rightArm = rightArm;
          // EYES - Enhanced detail with 2x scale
        const eyeGeo = new THREE.SphereGeometry(0.04, 8, 6); // 2x scale: 0.025 -> 0.04
        const eyeMat = createStyledMaterial(darkColor, 'character');
        
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.1, 1.04, 0.36); // 2x scale: -0.06->-0.1, 0.54->1.04, 0.19->0.36
        
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.1, 1.04, 0.36); // 2x scale: 0.06->0.1, 0.54->1.04, 0.19->0.36
          // ACCESSORIES - Character-specific with 2x scale
        const beltGeo = new THREE.BoxGeometry(0.64, 0.08, 0.44); // 2x scale: 0.34->0.64, 0.05->0.08, 0.24->0.44
        const beltMat = createStyledMaterial(accentColor, 'accessory');
        const belt = new THREE.Mesh(beltGeo, beltMat);
        belt.position.y = 0.3; // 2x scale: 0.16 -> 0.3
        
        // Assemble chibi
        chibi.add(head, body, leftLeg, rightLeg, leftArm, rightArm, leftEye, rightEye, belt);
        
        // Enable shadows and set proper rendering flags
        chibi.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                // Apply isometric rendering hints if available
                if (window.threeDSystem?.enhanceMeshForIsometric) {
                    window.threeDSystem.enhanceMeshForIsometric(child);
                }
            }
        });
        
        this.mesh = chibi;
        this.mesh.position.set(this.position.x, this.position.y, this.position.z);
        
        // Add direction indicator
        this.createDirectionIndicator();
        
        // Add to parent group
        if (this.parentGroup) {
            this.parentGroup.add(this.mesh);
        }
    }    createDirectionIndicator() {
        // Enhanced large direction arrow positioned in front of actor for navigation and item collection
        const arrowGeo = new THREE.ConeGeometry(0.25, 0.6, 6); // Large arrow for visibility and interaction
        let arrowColor = 0x00ff00;
        
        switch (this.actorType) {
            case 'nia':
                arrowColor = 0xffd700; // Gold
                break;
            case 'zuberi':
                arrowColor = 0xff4444; // Red
                break;
            default:
                arrowColor = 0x00ff00; // Green
                break;
        }
        
        const arrowMat = new THREE.MeshStandardMaterial({ 
            color: arrowColor, 
            transparent: true, 
            opacity: 0.9, // More opaque for better visibility
            flatShading: true,
            emissive: arrowColor,
            emissiveIntensity: 0.1 // Slight glow for better visibility
        });
        
        this.directionArrow = new THREE.Mesh(arrowGeo, arrowMat);
        // Position arrow in front of actor for direction indication and item collection
        this.directionArrow.position.set(0, 0.3, 0.8); // Elevated and forward position
        this.directionArrow.rotation.x = Math.PI / 2; // Point forward initially
        this.mesh.add(this.directionArrow);    }

    // Enhanced animation system with morphing capabilities
    playIdleAnimation(deltaTime) {
        this.animationState.time += deltaTime;
        
        const bobOffset = Math.sin(this.animationState.time * this.animationState.bobSpeed) * this.animationState.bobAmount;
        this.bodyParts.body.position.y = 0.5 + bobOffset; // 2x scale: 0.26 -> 0.5
        this.bodyParts.head.position.y = 1.0 + bobOffset; // 2x scale: 0.52 -> 1.0
        
        // Gentle breathing effect
        const breathScale = 1 + Math.sin(this.animationState.time * 2) * 0.02;
        this.bodyParts.body.scale.x = breathScale;
        this.bodyParts.body.scale.z = breathScale;
        
        // Subtle arm sway
        const armSway = Math.sin(this.animationState.time * 1.5) * 0.08;
        this.bodyParts.leftArm.rotation.z = Math.PI / 14 + armSway;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 14 - armSway;
    }    playWalkAnimation(deltaTime) {
        this.animationState.time += deltaTime;
        const walkTime = this.animationState.time * this.animationState.walkCycleSpeed;
        
        // Enhanced head bob
        const headBob = Math.sin(walkTime * 2) * 0.04;
        this.bodyParts.head.position.y = 1.0 + headBob; // 2x scale: 0.52 -> 1.0
        
        // Body movement with rotation
        const bodySway = Math.sin(walkTime * 2) * 0.025;
        this.bodyParts.body.position.y = 0.5 + bodySway; // 2x scale: 0.26 -> 0.5
        this.bodyParts.body.rotation.z = Math.sin(walkTime) * 0.06;
        this.bodyParts.body.rotation.y = Math.sin(walkTime * 2) * 0.03;
        
        // Enhanced leg movement
        const legSwing = Math.sin(walkTime) * 0.35;
        this.bodyParts.leftLeg.rotation.x = legSwing;
        this.bodyParts.rightLeg.rotation.x = -legSwing;
        
        // Enhanced arm movement with shoulder motion
        const armSwing = Math.sin(walkTime) * 0.45;
        this.bodyParts.leftArm.rotation.x = -armSwing;
        this.bodyParts.rightArm.rotation.x = armSwing;
        this.bodyParts.leftArm.rotation.z = Math.PI / 14 + Math.sin(walkTime) * 0.1;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 14 - Math.sin(walkTime) * 0.1;
        
        // Hair movement if present
        if (this.bodyParts.hair) {
            this.bodyParts.hair.rotation.y = Math.sin(walkTime * 0.8) * 0.05;
        }
    }

    playRunAnimation(deltaTime) {
        this.animationState.time += deltaTime;
        const runTime = this.animationState.time * (this.animationState.walkCycleSpeed * 1.8);
          // More dramatic movements
        const headBob = Math.sin(runTime * 2) * 0.06;
        this.bodyParts.head.position.y = 1.0 + headBob; // 2x scale: 0.52 -> 1.0
        
        // Forward lean and body motion
        this.bodyParts.body.rotation.x = 0.12;
        const bodySway = Math.sin(runTime * 2) * 0.04;
        this.bodyParts.body.position.y = 0.5 + bodySway; // 2x scale: 0.26 -> 0.5
        this.bodyParts.body.rotation.z = Math.sin(runTime) * 0.08;
        
        // Exaggerated leg movement
        const legSwing = Math.sin(runTime) * 0.6;
        this.bodyParts.leftLeg.rotation.x = legSwing;
        this.bodyParts.rightLeg.rotation.x = -legSwing;
        
        // Pumping arm motion
        const armSwing = Math.sin(runTime) * 0.7;
        this.bodyParts.leftArm.rotation.x = -armSwing;
        this.bodyParts.rightArm.rotation.x = armSwing;
        this.bodyParts.leftArm.rotation.z = Math.PI / 12;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 12;
        
        // Dynamic hair movement
        if (this.bodyParts.hair) {
            this.bodyParts.hair.rotation.y = Math.sin(runTime * 0.5) * 0.08;
            this.bodyParts.hair.rotation.x = -0.05;
        }
    }

    playJumpAnimation(deltaTime) {
        // Enhanced jump pose
        this.bodyParts.body.rotation.x = -0.12;
        this.bodyParts.head.rotation.x = -0.05;
        this.bodyParts.leftLeg.rotation.x = -0.25;
        this.bodyParts.rightLeg.rotation.x = -0.25;
        this.bodyParts.leftArm.rotation.x = 0.4;
        this.bodyParts.rightArm.rotation.x = 0.4;
        this.bodyParts.leftArm.rotation.z = Math.PI / 8;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 8;
    }

    playAbilityAnimation(deltaTime) {
        this.animationState.time += deltaTime;
        
        // Character-specific ability animations
        if (this.actorType === 'nia') {
            this.playNiaScoutAnimation(deltaTime);
        } else if (this.actorType === 'zuberi') {
            this.playZuberiWarriorAnimation(deltaTime);
        } else {
            this.playGenericAbilityAnimation(deltaTime);
        }
    }

    playNiaScoutAnimation(deltaTime) {
        const pulseEffect = Math.sin(this.animationState.time * 8) * 0.03 + 1;
        this.bodyParts.head.scale.setScalar(pulseEffect);
        
        // Scout scanning pose
        this.bodyParts.rightArm.rotation.x = -Math.PI / 3;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 6;
        this.bodyParts.leftArm.rotation.x = 0.3;
        this.bodyParts.leftArm.rotation.z = Math.PI / 6;
        
        this.bodyParts.body.rotation.x = 0.1;
        this.bodyParts.head.rotation.x = 0.1;
        
        if (this.bodyParts.hair) {
            this.bodyParts.hair.rotation.y = Math.sin(this.animationState.time * 5) * 0.1;
        }
    }

    playZuberiWarriorAnimation(deltaTime) {
        const powerPulse = Math.sin(this.animationState.time * 10) * 0.05 + 1;
        this.mesh.scale.setScalar(powerPulse);
        
        // Warrior power stance
        this.bodyParts.leftArm.rotation.x = -Math.PI / 2;
        this.bodyParts.rightArm.rotation.x = -Math.PI / 2;
        this.bodyParts.leftArm.rotation.z = Math.PI / 4;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 4;
        
        this.bodyParts.body.rotation.x = -0.1;
        this.bodyParts.leftLeg.rotation.x = 0.1;
        this.bodyParts.rightLeg.rotation.x = 0.1;
    }

    playGenericAbilityAnimation(deltaTime) {
        const pulseEffect = Math.sin(this.animationState.time * 8) * 0.08 + 1;
        this.mesh.scale.setScalar(pulseEffect);
        
        this.bodyParts.leftArm.rotation.x = -Math.PI / 3;
        this.bodyParts.rightArm.rotation.x = -Math.PI / 3;
        this.bodyParts.leftArm.rotation.z = Math.PI / 6;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 6;
        this.bodyParts.head.rotation.x = -0.2;
    }

    resetPose() {
        // Reset all body parts to neutral positions
        Object.values(this.bodyParts).forEach(part => {
            part.rotation.set(0, 0, 0);
            part.scale.setScalar(1);
        });
          // Reset specific positions with 2x scale
        this.bodyParts.head.position.set(0, 1.0, 0); // 2x scale: 0.52 -> 1.0
        this.bodyParts.body.position.set(0, 0.5, 0); // 2x scale: 0.26 -> 0.5
        this.bodyParts.leftLeg.position.set(-0.16, 0.1, 0); // 2x scale: -0.09->-0.16, 0.06->0.1
        this.bodyParts.rightLeg.position.set(0.16, 0.1, 0); // 2x scale: 0.09->0.16, 0.06->0.1
        this.bodyParts.leftArm.position.set(-0.36, 0.6, 0); // 2x scale: -0.19->-0.36, 0.32->0.6        this.bodyParts.rightArm.position.set(0.36, 0.6, 0); // 2x scale: 0.19->0.36, 0.32->0.6
          if (this.bodyParts.hair) {
            if (this.actorType === 'zuberi') {
                this.bodyParts.hair.position.set(0, 1.2, 0); // Updated to match createMesh position
                this.bodyParts.hair.scale.set(1, 0.7, 1); // Reset Zuberi's hair scaling
            } else if (this.actorType === 'nia') {
                this.bodyParts.hair.position.set(0, 1.25, 0); // Updated to match new higher position
                this.bodyParts.hair.scale.set(1.0, 0.8, 1.0); // Reset Nia's hair scaling
            } else {
                this.bodyParts.hair.position.set(0, 1.1, 0); // Default position for other actors
            }
        }
        
        this.mesh.scale.setScalar(1);
    }    // Enhanced movement with instant tile-by-tile positioning (no smooth animation)
    moveTo(targetX, targetY, targetZ, duration = 300) {
        return new Promise((resolve) => {
            if (!this.mesh) {
                console.warn('Enhanced3DChibi: Cannot move - mesh not available');
                resolve();
                return;
            }
            
            // Instant position update - no smooth animation
            this.mesh.position.set(targetX, targetY, targetZ);
            this.position.x = targetX;
            this.position.y = targetY;
            this.position.z = targetZ;
            
            // Set walking animation briefly, then return to idle
            this.animationState.current = 'walk';
            this.animationState.isMoving = true;
            
            // Brief walking pose, then return to idle for tile-by-tile movement
            setTimeout(() => {
                this.animationState.isMoving = false;
                if (this.animationState.current === 'walk') {
                    this.animationState.current = 'idle';
                }
            }, 100); // Very brief walking animation
            
            resolve();
        });
    }// Enhanced walk method with direction handling
    walk(directionVec) {
        if (!directionVec || !this.mesh) return;
        
        this.direction = directionVec.clone().normalize();
        this.animationState.current = 'walk';
        this.animationState.isMoving = true;
        
        // Enhanced facing direction with proper rotation for grid-based movement
        this.setFacingDirection(this.direction);
    }

    // Enhanced rotation handling for 4-directional movement
    setFacingDirection(directionVector) {
        if (!this.mesh || !directionVector) return;
        
        const { x, z } = directionVector;
        let targetRotationY = 0;
          // Determine rotation based on movement direction (inverted for correct facing)
        if (Math.abs(x) > Math.abs(z)) {
            // Horizontal movement (left/right)
            if (x > 0) {
                targetRotationY = Math.PI / 2; // Face right (east)
                this.animationState.facingDirection = 1; // Right
            } else {
                targetRotationY = -Math.PI / 2; // Face left (west)
                this.animationState.facingDirection = 3; // Left
            }
        } else {
            // Vertical movement (up/down)
            if (z < 0) {
                targetRotationY = Math.PI; // Face forward (north)
                this.animationState.facingDirection = 0; // Up
            } else {
                targetRotationY = 0; // Face backward (south)
                this.animationState.facingDirection = 2; // Down
            }
        }
          // Apply rotation
        this.mesh.rotation.y = targetRotationY;
        
        // Update direction arrow if present - arrow should rotate on Y axis to match character facing
        if (this.directionArrow) {
            this.directionArrow.rotation.y = targetRotationY;
        }
    }

    // Enhanced stop method
    stop() {
        this.animationState.current = 'idle';
        this.animationState.isMoving = false;
        this.resetPose();
    }

    // Ability animation method
    useAbility() {
        this.animationState.current = 'ability';
        this.animationState.time = 0;
        
        // Auto-return to idle after ability animation
        setTimeout(() => {
            if (this.animationState.current === 'ability') {
                this.animationState.current = 'idle';
                this.resetPose();
            }
        }, 1000);
    }

    // Update method for main loop integration
    update(deltaTime = 0.016) {
        if (!this.mesh) return;
        
        // Update animation time
        this.animationState.time += deltaTime;
        
        // Play current animation
        switch (this.animationState.current) {
            case 'walk':
                this.playWalkAnimation(deltaTime);
                break;
            case 'run':
                this.playRunAnimation(deltaTime);
                break;
            case 'jump':
                this.playJumpAnimation(deltaTime);
                break;
            case 'ability':
                this.playAbilityAnimation(deltaTime);
                break;
            default:
                this.playIdleAnimation(deltaTime);
                break;
        }
        
        // Update position tracking
        this.position.x = this.mesh.position.x;
        this.position.y = this.mesh.position.y;
        this.position.z = this.mesh.position.z;
    }

    // Compatibility method for main game loop
    updatePerTick(deltaTime) {
        this.update(deltaTime);
    }
}

window.Enhanced3DChibi = Enhanced3DChibi;
