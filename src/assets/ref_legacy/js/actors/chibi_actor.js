// chibi_actor.js - Low-Poly Polygonal Isometric Chibi with Animations
// Requires: three.js (THREE), BaseActor class, and should be imported after both are loaded

class ChibiActor extends BaseActor {
    constructor(id, name, x, y, modelPath, texturePath, animations, scale = 0.1, yOffset = 0, modelHeight = 2.0) {
        super(id, name, x, y);
        this.modelPath = modelPath;
        this.texturePath = texturePath;
        this.animations = animations; // { idle: 'IdleAnimationName', walk: 'WalkAnimationName', ... }
        this.scale = scale;
        this.yOffset = yOffset; // Fine-tuning for vertical position
        this.modelHeight = modelHeight; // Approximate height of the model for centering calculations
        this.mesh = new THREE.Group(); // Main group for this actor
        this.mixer = null;
        this.currentAction = null;
        this.isChibiActor = true; // Flag to identify ChibiActor instances
        this.isMoving = false;        this.targetPosition = new THREE.Vector3();
        this.moveSpeed = 0.1; // Units per tick, adjust as needed (2x for 2x scale)
        this.loadModel();
    }

    loadModel() {
        // Initialize the body parts object
        this.bodyParts = {};
        
        // Create the low-poly chibi mesh and set it as this actor's mesh
        const chibiMesh = this.createLowPolyChibiMesh();
        
        // Clear the existing mesh group and add the new chibi mesh
        this.mesh.clear();        this.mesh.add(chibiMesh);
        
        // Set up animation state
        this.animationState = {
            current: 'idle',
            time: 0,
            isMoving: false,
            bobSpeed: 3,
            bobAmount: 0.02,
            walkCycleSpeed: 4
        };

        // Initialize physics properties
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.isOnGround = true;
        this.speed = 0.16;
        this.runMultiplier = 2.0;
        this.jumpStrength = 0.36;
        this.gravity = -0.008;
        this.direction = new THREE.Vector3(0, 0, 1);
    }

    createLowPolyChibiMesh() {
        const chibi = new THREE.Group();
        
        // Low-poly color palette for isometric style
        const skinColor = 0xffdbac;
        const clothingColor = 0x4a90e2;
        const darkColor = 0x2c3e50;
        const accentColor = 0xe74c3c;
          // HEAD - Low-poly geometric
        const headGeo = new THREE.OctahedronGeometry(0.4, 1); // Low-poly spherical head
        const headMat = new THREE.MeshStandardMaterial({ 
            color: skinColor, 
            roughness: 0.6, 
            metalness: 0.0,
            flatShading: true 
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.0;
        this.bodyParts.head = head;
          // BODY - Low-poly rectangular torso
        const bodyGeo = new THREE.BoxGeometry(0.6, 0.7, 0.4);
        const bodyMat = new THREE.MeshStandardMaterial({ 
            color: clothingColor, 
            roughness: 0.7, 
            metalness: 0.0,
            flatShading: true 
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.5;
        this.bodyParts.body = body;
          // LEGS - Low-poly rectangular legs
        const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
        const legMat = new THREE.MeshStandardMaterial({ 
            color: darkColor, 
            roughness: 0.8, 
            metalness: 0.0,
            flatShading: true 
        });
        
        const leftLeg = new THREE.Mesh(legGeo, legMat);
        leftLeg.position.set(-0.16, 0.1, 0);
        this.bodyParts.leftLeg = leftLeg;
        
        const rightLeg = new THREE.Mesh(legGeo, legMat);
        rightLeg.position.set(0.16, 0.1, 0);
        this.bodyParts.rightLeg = rightLeg;
          // ARMS - Low-poly rectangular arms
        const armGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12);
        const armMat = new THREE.MeshStandardMaterial({ 
            color: skinColor, 
            roughness: 0.6, 
            metalness: 0.0,
            flatShading: true 
        });
        
        const leftArm = new THREE.Mesh(armGeo, armMat);
        leftArm.position.set(-0.36, 0.6, 0);
        this.bodyParts.leftArm = leftArm;
        
        const rightArm = new THREE.Mesh(armGeo, armMat);
        rightArm.position.set(0.36, 0.6, 0);
        this.bodyParts.rightArm = rightArm;
          // EYES - Simple geometric eyes
        const eyeGeo = new THREE.SphereGeometry(0.04, 6, 4); // Very low-poly
        const eyeMat = new THREE.MeshStandardMaterial({ 
            color: darkColor, 
            roughness: 0.9, 
            metalness: 0.0,
            flatShading: true 
        });
        
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.1, 1.04, 0.36);
        
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.1, 1.04, 0.36);
          // Add accent detail (belt/accessory)
        const beltGeo = new THREE.BoxGeometry(0.64, 0.08, 0.44);
        const beltMat = new THREE.MeshStandardMaterial({ 
            color: accentColor, 
            roughness: 0.8, 
            metalness: 0.1,
            flatShading: true 
        });
        const belt = new THREE.Mesh(beltGeo, beltMat);
        belt.position.y = 0.3;
        
        // Assemble the chibi
        chibi.add(head, body, leftLeg, rightLeg, leftArm, rightArm, leftEye, rightEye, belt);
        
        // Enable shadows for all parts
        chibi.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        return chibi;
    }    createDirectionIndicator() {
        // Simple low-poly arrow indicator
        const arrowGeo = new THREE.ConeGeometry(0.1, 0.3, 4);
        const arrowMat = new THREE.MeshStandardMaterial({ 
            color: 0x00ff00, 
            transparent: true, 
            opacity: 0.7,
            flatShading: true 
        });
        
        this.directionArrow = new THREE.Mesh(arrowGeo, arrowMat);
        this.directionArrow.position.set(0, 0.04, 0);
        this.directionArrow.rotation.x = Math.PI / 2; // Point forward
        this.mesh.add(this.directionArrow);
    }

    // Animation Methods
    playIdleAnimation(deltaTime) {
        this.animationState.time += deltaTime;
          // Gentle bobbing motion
        const bobOffset = Math.sin(this.animationState.time * this.animationState.bobSpeed) * this.animationState.bobAmount;
        this.bodyParts.body.position.y = 0.5 + bobOffset;
        this.bodyParts.head.position.y = 1.0 + bobOffset;
        
        // Slight arm sway
        const armSway = Math.sin(this.animationState.time * 2) * 0.1;
        this.bodyParts.leftArm.rotation.z = Math.PI / 12 + armSway;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 12 - armSway;
    }

    playWalkAnimation(deltaTime) {
        this.animationState.time += deltaTime;
        const walkTime = this.animationState.time * this.animationState.walkCycleSpeed;
          // Head bob
        const headBob = Math.sin(walkTime * 2) * 0.03;
        this.bodyParts.head.position.y = 1.0 + headBob;
        
        // Body sway
        const bodySway = Math.sin(walkTime * 2) * 0.02;
        this.bodyParts.body.position.y = 0.5 + bodySway;
        this.bodyParts.body.rotation.z = Math.sin(walkTime) * 0.05;
        
        // Leg movement - alternating
        const legSwing = Math.sin(walkTime) * 0.3;
        this.bodyParts.leftLeg.rotation.x = legSwing;
        this.bodyParts.rightLeg.rotation.x = -legSwing;
        
        // Arm movement - opposite to legs
        const armSwing = Math.sin(walkTime) * 0.4;
        this.bodyParts.leftArm.rotation.x = -armSwing;
        this.bodyParts.rightArm.rotation.x = armSwing;
        
        // Reset arm Z rotation
        this.bodyParts.leftArm.rotation.z = Math.PI / 12;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 12;
    }

    playRunAnimation(deltaTime) {
        this.animationState.time += deltaTime;
        const runTime = this.animationState.time * (this.animationState.walkCycleSpeed * 1.5);
          // More pronounced movements for running
        const headBob = Math.sin(runTime * 2) * 0.05;
        this.bodyParts.head.position.y = 1.0 + headBob;
        
        // Body lean forward slightly
        this.bodyParts.body.rotation.x = 0.1;
        const bodySway = Math.sin(runTime * 2) * 0.03;
        this.bodyParts.body.position.y = 0.5 + bodySway;
        
        // Exaggerated leg movement
        const legSwing = Math.sin(runTime) * 0.5;
        this.bodyParts.leftLeg.rotation.x = legSwing;
        this.bodyParts.rightLeg.rotation.x = -legSwing;
        
        // Exaggerated arm movement
        const armSwing = Math.sin(runTime) * 0.6;
        this.bodyParts.leftArm.rotation.x = -armSwing;
        this.bodyParts.rightArm.rotation.x = armSwing;
    }

    playJumpAnimation(deltaTime) {
        // Simple pose for jumping
        this.bodyParts.body.rotation.x = -0.1; // Lean back slightly
        this.bodyParts.leftLeg.rotation.x = -0.2;
        this.bodyParts.rightLeg.rotation.x = -0.2;
        this.bodyParts.leftArm.rotation.x = 0.3;
        this.bodyParts.rightArm.rotation.x = 0.3;
    }

    playAbilityAnimation(deltaTime) {
        this.animationState.time += deltaTime;
        
        // Power-up pose with energy
        const pulseEffect = Math.sin(this.animationState.time * 8) * 0.1 + 1;
        this.mesh.scale.setScalar(pulseEffect);
        
        // Arms raised
        this.bodyParts.leftArm.rotation.x = -Math.PI / 3;
        this.bodyParts.rightArm.rotation.x = -Math.PI / 3;
        this.bodyParts.leftArm.rotation.z = Math.PI / 6;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 6;
        
        // Head tilt back
        this.bodyParts.head.rotation.x = -0.2;
    }

    resetPose() {
        // Reset all rotations and positions to default
        Object.values(this.bodyParts).forEach(part => {
            part.rotation.set(0, 0, 0);
        });
          this.bodyParts.head.position.set(0, 1.0, 0);
        this.bodyParts.body.position.set(0, 0.5, 0);
        this.bodyParts.leftLeg.position.set(-0.16, 0.1, 0);
        this.bodyParts.rightLeg.position.set(0.16, 0.1, 0);
        this.bodyParts.leftArm.position.set(-0.36, 0.6, 0);
        this.bodyParts.rightArm.position.set(0.36, 0.6, 0);
        
        this.mesh.scale.setScalar(1);
    }

    // Movement methods with animation
    walk(directionVec) {
        this.velocity.x = directionVec.x * this.speed;
        this.velocity.z = directionVec.z * this.speed;
        this.direction.copy(directionVec);
        this.animationState.current = 'walk';
        this.animationState.isMoving = true;
    }

    run(directionVec) {
        this.velocity.x = directionVec.x * this.speed * this.runMultiplier;
        this.velocity.z = directionVec.z * this.speed * this.runMultiplier;
        this.direction.copy(directionVec);
        this.animationState.current = 'run';
        this.animationState.isMoving = true;
    }

    jump() {
        if (this.isOnGround) {
            this.velocity.y = this.jumpStrength;
            this.isOnGround = false;
            this.animationState.current = 'jump';
        }
    }

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

    stop() {
        this.velocity.x = 0;
        this.velocity.z = 0;
        this.animationState.current = 'idle';
        this.animationState.isMoving = false;
        this.resetPose();
    }    update(deltaTime = 0.016) { // 60fps default
        // Enhanced facing direction with 4-directional movement
        if (this.direction && (Math.abs(this.direction.x) > 0.0001 || Math.abs(this.direction.z) > 0.0001)) {
            const { x, z } = this.direction;
            let targetRotationY = 0;
            
            // Determine rotation based on movement direction
            if (Math.abs(x) > Math.abs(z)) {
                // Horizontal movement (left/right)
                if (x > 0) {
                    targetRotationY = -Math.PI / 2; // Face right (east)
                } else {
                    targetRotationY = Math.PI / 2; // Face left (west)
                }
            } else {
                // Vertical movement (up/down)
                if (z < 0) {
                    targetRotationY = 0; // Face forward (north)
                } else {
                    targetRotationY = Math.PI; // Face backward (south)
                }
            }
            
            // Apply rotation
            this.mesh.rotation.y = targetRotationY;
            
            // Update direction arrow if present
            if (this.directionArrow) {
                this.directionArrow.rotation.z = targetRotationY;
            }
        }
        
        // Play appropriate animation
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
        
        // Return to idle if stopped moving and on ground
        if (!this.animationState.isMoving && this.isOnGround && 
            this.animationState.current !== 'ability' && this.animationState.current !== 'idle') {
            this.animationState.current = 'idle';
            this.resetPose();
        }
    }    // Instant movement for tile-by-tile positioning (no smooth animation)
    async moveTo(targetX, targetY, targetZ, duration = 300) {
        return new Promise((resolve) => {
            // Instant position update - no smooth animation
            this.mesh.position.set(targetX, targetY, targetZ);
            
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
    }

    // Method to set parent group for 3D scene
    setParentGroup(parentGroup) {
        this.parentGroup = parentGroup;
        if (this.mesh && parentGroup) {
            parentGroup.add(this.mesh);
        }
    }

    // Override updatePerTick to include 3D updates
    updatePerTick(deltaTime) {
        if (this.mixer) {
            this.mixer.update(deltaTime);
        }

        // Update mesh position from actor's logical world coordinates
        // These should be updated by updateActor3DPosition before this tick or before rendering
        if (typeof this.worldX === 'number' && typeof this.worldY === 'number' && typeof this.worldZ === 'number') {
            // worldY is the center of the model. The mesh's pivot is at its base.
            // So, we adjust worldY by half the modelHeight to position the base correctly.
            // yOffset is an additional fine-tuning parameter.
            // The ChibiActor's mesh (THREE.Group) has its origin at (0,0,0).
            // If the loaded GLTF model has its origin at its center, then worldY is correct.
            // If the loaded GLTF model has its origin at its base, then worldY needs to be adjusted.
            // For now, assuming GLTF origin is at its visual base, so worldY (calculated as center) needs adjustment.
            // Let's assume worldY from updateActor3DPosition is the desired *base* of the model on the tile.
            // And ChibiActor's internal yOffset is for fine-tuning that base relative to the tile surface.
            // And modelHeight is the visual height of the model.
            // The mesh's THREE.Group origin is at (0,0,0) relative to its contents.
            // If the GLB model itself is centered around its own origin, then mesh.position.y = worldY (center) is fine.
            // If GLB model's base is at its origin, then mesh.position.y = worldY (which is tile_top + model_height/2) is too high.
            // Let's simplify: assume updateActor3DPosition sets worldX, worldY (as base + modelHeight/2), worldZ.
            // The Chibi model (GLB) should be modeled with its origin at its feet.
            // Then, this.mesh.position should be set to (worldX, tile_top_y + yOffset, worldZ)
            // updateActor3DPosition calculates worldY as: tileActualHeight + (this.modelHeight / 2) + (this.yOffset || 0)
            // This means worldY is the *center* of the model.
            // If the GLB model's origin is at its feet, then setting mesh.position.y to worldY will make it float.
            // It should be: mesh.position.y = worldY - (this.modelHeight / 2)
            
            // Let's assume the GLB model is authored with its origin at its feet.
            // And updateActor3DPosition calculates worldY as the desired y for the *feet* of the model.
            // Then this.mesh.position.y = this.worldY + this.yOffset (if yOffset is relative to feet)
            // OR this.mesh.position.y = this.worldY (if worldY already includes yOffset)

            // Re-evaluating: updateActor3DPosition sets actor.worldY to be the *center* of the actor model.
            // The ChibiActor's this.mesh (THREE.Group) has its origin at (0,0,0).
            // The loaded GLTF model, when added to this.mesh, should be modeled such that its visual base is at y=0 of its local coordinates.
            // Then, this.mesh.position.set(this.worldX, this.worldY - (this.modelHeight / 2), this.worldZ) would place the base correctly.
            // However, the current updateActor3DPosition calculates worldY as: tileActualHeight + (actorData.modelHeight / 2) + (actorData.yOffset || 0.05)
            // This IS the center. So, if the GLTF model is centered around its own origin, then mesh.position = (worldX, worldY, worldZ) is correct.
            // If the GLTF model has its origin at its feet, then mesh.position.y should be worldY - modelHeight/2.
            
            // Let's stick to: worldX, worldY, worldZ are the desired CENTER coordinates of the ChibiActor's mesh.
            // The GLTF model itself should be centered around its local origin (0,0,0).
            this.mesh.position.set(this.worldX, this.worldY, this.worldZ);

        } else {
            // Fallback or initial positioning if worldX,Y,Z are not yet set by the main game logic
            // This might occur if updatePerTick is called before updateActor3DPosition for a new actor
            // console.warn(`ChibiActor ${this.id}: worldX,Y,Z not set, using grid fallback for positioning in updatePerTick.`);
            // const tile = window.map[this.y]?.[this.x];
            // const terrainChar = tile ? tile.terrain : 'P';
            // const terrainHeightFactor = TERRAIN_HEIGHT_FACTORS[terrainChar] || TERRAIN_HEIGHT_FACTORS['DEFAULT'];
            // const tileActualHeight = HEX_HEIGHT_3D * terrainHeightFactor;
            // const modelBaseY = tileActualHeight + this.yOffset;
            // this.mesh.position.set(
            //     HEX_SPACING_FACTOR_X * (this.x + (this.y % 2 === 1 ? 0.5 : 0)),            // If GLB model's base is at its origin, then mesh.position.y = worldY (which is tile_top + model_height/2) is too high.
            // Let's assume the GLB model is authored with its origin at its feet.
            // modelBaseY + (this.modelHeight / 2), // Position center of model
            // HEX_SPACING_FACTOR_Z * this.y
            // );
        }

        // Removed smooth movement lerping - actors now use instant tile-by-tile positioning
        // No more sliding/gliding animations between positions
    }
}

// Export to global scope for compatibility
window.ChibiActor = ChibiActor;

// Example usage (in your main scene setup):
// const chibi = new ChibiActor(scene, 0, 0, 0);
// In your animation loop: chibi.update(delta);
// To move: chibi.walk(new THREE.Vector3(1,0,0)); // right
// To run: chibi.run(new THREE.Vector3(0,0,1)); // forward
// To jump: chibi.jump();
// To stop: chibi.stop();
