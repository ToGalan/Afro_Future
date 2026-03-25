// chibinia.js - Low-Poly Polygonal Isometric Nia-specific Chibi
// Extends ChibiActor with Nia's specific styling

window.ChibiNia = class ChibiNia extends ChibiActor {
    constructor(parentGroup, startX = 0, startY = 0, startZ = 0) {
        super(parentGroup, startX, startY, startZ);
    }

    createLowPolyChibiMesh() {
        const chibi = new THREE.Group();
        
        // Nia's specific color palette
        const skinColor = 0xd4a574; // Darker skin tone for Nia
        const clothingColor = 0x8e44ad; // Purple/violet for Nia
        const darkColor = 0x2c3e50;
        const accentColor = 0xf39c12; // Gold accent for Nia
        const hairColor = 0x34495e; // Dark hair
          // HEAD - Low-poly geometric with Nia's styling
        const headGeo = new THREE.OctahedronGeometry(0.4, 1);
        const headMat = new THREE.MeshStandardMaterial({ 
            color: skinColor, 
            roughness: 0.6, 
            metalness: 0.0,
            flatShading: true 
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 1.0;
        this.bodyParts.head = head;
          // HAIR - Distinctive hair style for Nia
        const hairGeo = new THREE.BoxGeometry(0.5, 0.3, 0.5);
        const hairMat = new THREE.MeshStandardMaterial({ 
            color: hairColor, 
            roughness: 0.8, 
            metalness: 0.0,
            flatShading: true 
        });
        const hair = new THREE.Mesh(hairGeo, hairMat);
        hair.position.y = 1.14;
        this.bodyParts.hair = hair;
          // BODY - Nia's outfit style
        const bodyGeo = new THREE.BoxGeometry(0.6, 0.7, 0.4);
        const bodyMat = new THREE.MeshStandardMaterial({ 
            color: clothingColor, 
            roughness: 0.7, 
            metalness: 0.0,
            flatShading: true 
        });        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.5;
        this.bodyParts.body = body;
        
        // LEGS - Dark pants/boots
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
          // ARMS - Nia's skin tone
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
        const eyeGeo = new THREE.SphereGeometry(0.04, 6, 4);
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
          // ACCESSORY - Nia's belt/sash
        const beltGeo = new THREE.BoxGeometry(0.64, 0.08, 0.44);
        const beltMat = new THREE.MeshStandardMaterial({ 
            color: accentColor, 
            roughness: 0.8, 
            metalness: 0.1,
            flatShading: true 
        });
        const belt = new THREE.Mesh(beltGeo, beltMat);
        belt.position.y = 0.3;
        
        // SPECIAL - Scout emblem/badge
        const emblemGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 6);
        const emblemMat = new THREE.MeshStandardMaterial({ 
            color: accentColor, 
            roughness: 0.4, 
            metalness: 0.3,
            flatShading: true 
        });
        const emblem = new THREE.Mesh(emblemGeo, emblemMat);
        emblem.position.set(0.24, 0.7, 0.22);
        
        // Assemble Nia's chibi
        chibi.add(head, hair, body, leftLeg, rightLeg, leftArm, rightArm, leftEye, rightEye, belt, emblem);
        
        // Enable shadows for all parts
        chibi.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        return chibi;
    }    createDirectionIndicator() {
        // Nia's golden arrow indicator
        const arrowGeo = new THREE.ConeGeometry(0.1, 0.3, 4);
        const arrowMat = new THREE.MeshStandardMaterial({ 
            color: 0xffd700, // Gold for Nia
            transparent: true, 
            opacity: 0.8,
            flatShading: true 
        });
        
        this.directionArrow = new THREE.Mesh(arrowGeo, arrowMat);
        this.directionArrow.position.set(0, 0.04, 0);
        this.directionArrow.rotation.x = Math.PI / 2;
        this.mesh.add(this.directionArrow);
    }

    // Enhanced ability animation for Nia's scout abilities
    playAbilityAnimation(deltaTime) {
        this.animationState.time += deltaTime;
        
        // Scout "scanning" pose
        const pulseEffect = Math.sin(this.animationState.time * 6) * 0.05 + 1;
        this.bodyParts.head.scale.setScalar(pulseEffect);
        
        // One hand shielding eyes, looking forward
        this.bodyParts.rightArm.rotation.x = -Math.PI / 4;
        this.bodyParts.rightArm.rotation.z = -Math.PI / 6;
        this.bodyParts.leftArm.rotation.x = 0.2;
        this.bodyParts.leftArm.rotation.z = Math.PI / 8;
        
        // Slight lean forward
        this.bodyParts.body.rotation.x = 0.1;
        this.bodyParts.head.rotation.x = 0.1;
        
        // Hair animation
        if (this.bodyParts.hair) {
            this.bodyParts.hair.rotation.y = Math.sin(this.animationState.time * 4) * 0.1;
        }
    }

    resetPose() {
        super.resetPose();
        
        // Reset Nia-specific parts
        if (this.bodyParts.hair) {
            this.bodyParts.hair.rotation.set(0, 0, 0);
            this.bodyParts.hair.position.set(0, 0.57, 0);
        }
          if (this.bodyParts.head) {
            this.bodyParts.head.scale.setScalar(1);
        }
    }
}
