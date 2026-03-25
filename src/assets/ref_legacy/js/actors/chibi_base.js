// chibi_base.js
// Low-poly polygonal isometric base class for Chibi actors

class ChibiBase {
    constructor(parentGroup, startX = 0, startY = 0, startZ = 0) {
        this.parentGroup = parentGroup;
        this.position = new THREE.Vector3(startX, startY, startZ);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.direction = new THREE.Vector3(0, 0, 1); // Initial facing direction        this.isOnGround = true;
        this.speed = 0.16;
        this.runMultiplier = 2.0;
        this.jumpStrength = 0.36;
        this.gravity = -0.008;

        // Animation properties
        this.animationState = 'idle';
        this.animationTime = 0;
        this.animationSpeed = 0.1;
        
        // Body parts for individual animation
        this.bodyParts = {};
        
        // Default color palette (override in child classes)
        this.colorPalette = {
            skin: 0xfdbcb4,
            clothing: 0x3b82f6,
            accent: 0xfbbf24,
            hair: 0x8b5cf6,
            eyes: 0x1f2937
        };

        // Create and add mesh
        this.mesh = this.createLowPolyChibiMesh();
        this.mesh.position.copy(this.position);
        if (this.parentGroup) {
            this.parentGroup.add(this.mesh);
        }        // Add direction arrow
        const arrowOrigin = new THREE.Vector3(0, 0.02, 0); // Slightly above ground
        const arrowLength = 0.5;
        const arrowColor = this.colorPalette.accent;
        this.directionArrow = new THREE.ArrowHelper(
            this.direction,
            arrowOrigin,
            arrowLength,
            arrowColor,
            0.20,
            0.16
        );
        this.mesh.add(this.directionArrow);
    }

    createLowPolyChibiMesh() {
        const group = new THREE.Group();
        
        // Create body parts with low-poly geometry
        this.bodyParts.head = this.createHead();
        this.bodyParts.body = this.createBody();
        this.bodyParts.leftArm = this.createArm();
        this.bodyParts.rightArm = this.createArm();
        this.bodyParts.leftLeg = this.createLeg();
        this.bodyParts.rightLeg = this.createLeg();
        this.bodyParts.hair = this.createHair();
          // Position body parts
        this.bodyParts.head.position.set(0, 0.5, 0);
        this.bodyParts.body.position.set(0, 0, 0);
        this.bodyParts.leftArm.position.set(-0.24, 0.16, 0);
        this.bodyParts.rightArm.position.set(0.24, 0.16, 0);
        this.bodyParts.leftLeg.position.set(-0.1, -0.24, 0);
        this.bodyParts.rightLeg.position.set(0.1, -0.24, 0);
        this.bodyParts.hair.position.set(0, 0.56, 0);
        
        // Add all parts to group
        Object.values(this.bodyParts).forEach(part => {
            if (part) {
                group.add(part);
            }
        });
        
        return group;
    }    createHead() {
        const geometry = new THREE.OctahedronGeometry(0.16, 1);
        const material = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.skin,
            flatShading: true
        });
        const head = new THREE.Mesh(geometry, material);
        head.castShadow = true;
        head.receiveShadow = true;
        
        // Add eyes
        const eyeGeometry = new THREE.SphereGeometry(0.03, 6, 4);
        const eyeMaterial = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.eyes,
            flatShading: true
        });
          const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        leftEye.position.set(-0.04, 0.04, 0.14);
        head.add(leftEye);
        
        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(0.04, 0.04, 0.14);
        head.add(rightEye);
        
        return head;
    }    createBody() {
        const geometry = new THREE.BoxGeometry(0.24, 0.32, 0.16);
        const material = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.clothing,
            flatShading: true
        });
        const body = new THREE.Mesh(geometry, material);
        body.castShadow = true;
        body.receiveShadow = true;
        return body;
    }    createArm() {
        const geometry = new THREE.BoxGeometry(0.08, 0.24, 0.08);
        const material = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.clothing,
            flatShading: true
        });
        const arm = new THREE.Mesh(geometry, material);
        arm.castShadow = true;
        arm.receiveShadow = true;
        return arm;
    }    createLeg() {
        const geometry = new THREE.BoxGeometry(0.08, 0.24, 0.08);
        const material = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.clothing,
            flatShading: true
        });
        const leg = new THREE.Mesh(geometry, material);
        leg.castShadow = true;
        leg.receiveShadow = true;
        return leg;
    }    createHair() {
        const geometry = new THREE.ConeGeometry(0.12, 0.16, 6);
        const material = new THREE.MeshLambertMaterial({ 
            color: this.colorPalette.hair,
            flatShading: true
        });
        const hair = new THREE.Mesh(geometry, material);
        hair.castShadow = true;
        hair.receiveShadow = true;
        return hair;
    }

    // Legacy method - kept for compatibility
    createChibiMesh() {
        return this.createLowPolyChibiMesh();
    }

    walk(directionVec) {
        if (directionVec) {
            this.velocity.x = directionVec.x * this.speed;
            this.velocity.z = directionVec.z * this.speed;
            this.direction.copy(directionVec);
            this.animationState = 'walk';
        }
    }

    run(directionVec) {
        if (directionVec) {
            this.velocity.x = directionVec.x * this.speed * this.runMultiplier;
            this.velocity.z = directionVec.z * this.speed * this.runMultiplier;
            this.direction.copy(directionVec);
            this.animationState = 'run';
        }
    }

    jump() {
        if (this.isOnGround) {
            this.velocity.y = this.jumpStrength;
            this.isOnGround = false;
            this.animationState = 'jump';
        }
    }

    stop() {
        this.velocity.x = 0;
        this.velocity.z = 0;
        this.animationState = 'idle';
    }

    update() {
        // Update animation time
        this.animationTime += this.animationSpeed;
        
        // Apply gravity
        if (!this.isOnGround) {
            this.velocity.y += this.gravity;
        }
        
        // Update position
        this.position.add(this.velocity);
        
        // Ground collision (simple)
        if (this.position.y <= 0) {
            this.position.y = 0;
            this.velocity.y = 0;
            this.isOnGround = true;
            if (this.animationState === 'jump') {
                this.animationState = 'idle';
            }
        }
        
        // Update mesh position
        if (this.mesh) {
            this.mesh.position.copy(this.position);
        }
        
        // Update direction arrow
        if (this.directionArrow) {
            this.directionArrow.setDirection(this.direction);
        }
        
        // Apply animations
        this.applyAnimations();
    }

    applyAnimations() {
        if (!this.bodyParts) return;
        
        switch (this.animationState) {
            case 'idle':
                this.applyIdleAnimation();
                break;
            case 'walk':
                this.applyWalkAnimation();
                break;
            case 'run':
                this.applyRunAnimation();
                break;
            case 'jump':
                this.applyJumpAnimation();
                break;
        }
    }

    applyIdleAnimation() {
        // Gentle breathing/bobbing animation
        const breathe = Math.sin(this.animationTime * 2) * 0.02;
        if (this.bodyParts.body) {
            this.bodyParts.body.position.y = breathe;
        }        if (this.bodyParts.head) {
            this.bodyParts.head.position.y = 0.5 + breathe;
        }
        
        // Slight hair movement
        if (this.bodyParts.hair) {
            this.bodyParts.hair.rotation.z = Math.sin(this.animationTime * 1.5) * 0.05;
        }
    }

    applyWalkAnimation() {
        const walkCycle = Math.sin(this.animationTime * 6);
        const walkOffset = Math.abs(walkCycle) * 0.03;
        
        // Leg movement
        if (this.bodyParts.leftLeg) {
            this.bodyParts.leftLeg.rotation.x = walkCycle * 0.5;
        }
        if (this.bodyParts.rightLeg) {
            this.bodyParts.rightLeg.rotation.x = -walkCycle * 0.5;
        }
        
        // Arm movement (opposite to legs)
        if (this.bodyParts.leftArm) {
            this.bodyParts.leftArm.rotation.x = -walkCycle * 0.3;
        }
        if (this.bodyParts.rightArm) {
            this.bodyParts.rightArm.rotation.x = walkCycle * 0.3;
        }
        
        // Body bobbing
        if (this.bodyParts.body) {
            this.bodyParts.body.position.y = walkOffset;
        }        if (this.bodyParts.head) {
            this.bodyParts.head.position.y = 0.5 + walkOffset;
        }
    }

    applyRunAnimation() {
        const runCycle = Math.sin(this.animationTime * 8);
        const runOffset = Math.abs(runCycle) * 0.05;
        
        // Exaggerated leg movement
        if (this.bodyParts.leftLeg) {
            this.bodyParts.leftLeg.rotation.x = runCycle * 0.8;
        }
        if (this.bodyParts.rightLeg) {
            this.bodyParts.rightLeg.rotation.x = -runCycle * 0.8;
        }
        
        // Exaggerated arm movement
        if (this.bodyParts.leftArm) {
            this.bodyParts.leftArm.rotation.x = -runCycle * 0.6;
        }
        if (this.bodyParts.rightArm) {
            this.bodyParts.rightArm.rotation.x = runCycle * 0.6;
        }
        
        // More pronounced body bobbing
        if (this.bodyParts.body) {
            this.bodyParts.body.position.y = runOffset;
            this.bodyParts.body.rotation.z = runCycle * 0.1;
        }        if (this.bodyParts.head) {
            this.bodyParts.head.position.y = 0.5 + runOffset;
        }
    }

    applyJumpAnimation() {
        // Arms up, legs tucked
        if (this.bodyParts.leftArm) {
            this.bodyParts.leftArm.rotation.x = -Math.PI / 3;
        }
        if (this.bodyParts.rightArm) {
            this.bodyParts.rightArm.rotation.x = -Math.PI / 3;
        }
        if (this.bodyParts.leftLeg) {
            this.bodyParts.leftLeg.rotation.x = Math.PI / 4;
        }
        if (this.bodyParts.rightLeg) {
            this.bodyParts.rightLeg.rotation.x = Math.PI / 4;
        }
    }    // Instant movement for tile-by-tile positioning (no smooth animation)
    moveTo(targetX, targetZ, duration = 1000) {
        // Instant position update - no smooth animation
        this.position.x = targetX;
        this.position.z = targetZ;
        
        if (this.mesh) {
            this.mesh.position.copy(this.position);
        }
    }

    dispose() {
        if (this.mesh && this.parentGroup) {
            this.parentGroup.remove(this.mesh);
        }
        
        // Dispose of materials and geometries
        Object.values(this.bodyParts).forEach(part => {
            if (part && part.material) {
                part.material.dispose();
            }
            if (part && part.geometry) {
                part.geometry.dispose();
            }
        });
    }
}
