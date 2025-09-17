// Enhanced 3D Pasture and Plains System
// Adds low-poly polygonal isometric natural elements to pasture and plains tiles

// Define constants with fallbacks if not already available globally
const PASTURE_HEX_RADIUS_3D = (typeof HEX_RADIUS_3D !== 'undefined') ? HEX_RADIUS_3D : 1.0;
const PASTURE_HEX_HEIGHT_3D = (typeof HEX_HEIGHT_3D !== 'undefined') ? HEX_HEIGHT_3D : 0.4;
const PASTURE_HEX_SPACING_X = (typeof HEX_SPACING_FACTOR_X !== 'undefined') ? HEX_SPACING_FACTOR_X : 1.732; // √3 for hex spacing
const PASTURE_HEX_SPACING_Z = (typeof HEX_SPACING_FACTOR_Z !== 'undefined') ? HEX_SPACING_FACTOR_Z : 1.5;

// Ensure THREE is available
if (typeof THREE === 'undefined') {
    throw new Error('THREE.js is not loaded. Please include THREE.js before this script.');
}

class PastureSystem {
    constructor(scene) {
        this.scene = scene;
        this.pastureElements = new Map(); // Track pasture elements by tile key
        this.materials = this.initializeMaterials();
        this.geometries = this.initializeGeometries();
        
        // Selection system properties
        this.selectedElements = new Set(); // Track selected pasture elements
        this.hoveredElement = null; // Currently hovered element
        this.selectionCallbacks = new Map(); // Event callbacks for selection
        this.selectionMode = 'single'; // 'single', 'multiple', 'area'
        this.selectionBox = null; // For area selection
        this.raycaster = new THREE.Raycaster(); // For mouse picking
        this.mouse = new THREE.Vector2(); // Mouse coordinates
        
        // Selection visual indicators
        this.selectionIndicators = new Map(); // Visual selection indicators
        this.hoverIndicator = null; // Hover highlight indicator
        
        // Initialize selection system
        this.initializeSelectionSystem();
    }

    initializeMaterials() {
        return {
            // Grass materials
            grassLight: new THREE.MeshLambertMaterial({ 
                color: 0x7CB342, 
                transparent: true, 
                opacity: 0.9 
            }),
            grassMedium: new THREE.MeshLambertMaterial({ 
                color: 0x689F38, 
                transparent: true, 
                opacity: 0.85 
            }),
            grassDark: new THREE.MeshLambertMaterial({ 
                color: 0x558B2F, 
                transparent: true, 
                opacity: 0.8 
            }),
            
            // Wildflower materials
            flowerWhite: new THREE.MeshLambertMaterial({ 
                color: 0xF8BBD9, 
                transparent: true, 
                opacity: 0.9 
            }),
            flowerYellow: new THREE.MeshLambertMaterial({ 
                color: 0xFFEB3B, 
                transparent: true, 
                opacity: 0.8 
            }),
            flowerPurple: new THREE.MeshLambertMaterial({ 
                color: 0x9C27B0, 
                transparent: true, 
                opacity: 0.85 
            }),
            
            // Rock and soil materials
            rockGray: new THREE.MeshLambertMaterial({ 
                color: 0x78909C, 
                transparent: true, 
                opacity: 0.9 
            }),
            soilBrown: new THREE.MeshLambertMaterial({ 
                color: 0x8D6E63, 
                transparent: true, 
                opacity: 0.8 
            })
        };
    }

    initializeGeometries() {
        return {
            // Grass blade geometries (low-poly triangular)
            grassBlade: this.createGrassBladeGeometry(),
            grassCluster: this.createGrassClusterGeometry(),
            
            // Wildflower geometries
            flowerStem: this.createFlowerStemGeometry(),
            flowerPetal: this.createFlowerPetalGeometry(),
            
            // Natural element geometries
            smallRock: this.createSmallRockGeometry(),
            soilPatch: this.createSoilPatchGeometry(),
            
            // Grass wave effect geometry
            grassWave: this.createGrassWaveGeometry(),
            
            // Full grass tile geometry (similar to water tiles)
            grassTile: this.createGrassPlainsTileGeometry()
        };
    }

    createGrassBladeGeometry() {
        const geometry = new THREE.ConeGeometry(0.02, 0.15, 3);
        return geometry;
    }

    createGrassClusterGeometry() {
        const geometry = new THREE.ConeGeometry(0.05, 0.12, 4);
        return geometry;
    }

    createFlowerStemGeometry() {
        const geometry = new THREE.CylinderGeometry(0.005, 0.008, 0.08, 4);
        return geometry;
    }

    createFlowerPetalGeometry() {
        const geometry = new THREE.SphereGeometry(0.015, 4, 3);
        return geometry;
    }

    createSmallRockGeometry() {
        const geometry = new THREE.DodecahedronGeometry(0.03);
        return geometry;
    }

    createSoilPatchGeometry() {
        const geometry = new THREE.CylinderGeometry(0.08, 0.09, 0.02, 6);
        return geometry;
    }

    // Create grass wave effect geometry (similar to water ripples)
    createGrassWaveGeometry() {
        const group = new THREE.Group();
        
        // Base grass wave using ring geometry
        for (let i = 0; i < 3; i++) {
            const radius = PASTURE_HEX_RADIUS_3D * (0.2 + i * 0.15);
            const waveRing = new THREE.RingGeometry(radius, radius + 0.08, 8);
            waveRing.rotateX(-Math.PI / 2);
            
            // Create grass material with transparency for wave effect
            const grassWaveMaterial = new THREE.MeshStandardMaterial({
                color: i === 0 ? 0x8BC34A : i === 1 ? 0x7CB342 : 0x689F38,
                transparent: true,
                opacity: 0.6 - i * 0.1,
                side: THREE.DoubleSide,
                flatShading: true // Isometric low-poly style
            });
            
            const waveRingMesh = new THREE.Mesh(waveRing, grassWaveMaterial);
            waveRingMesh.position.y = 0.01 + i * 0.005;
            waveRingMesh.userData = { 
                animationType: 'grass_wave',
                speed: 0.8 + i * 0.3,
                amplitude: 0.03,
                waveIndex: i
            };
            group.add(waveRingMesh);
        }
        
        return group;
    }

    // Create full grass tile effect (similar to water tiles but green)
    createGrassPlainsTileGeometry() {
        const group = new THREE.Group();
        
        // Base hexagonal grass surface (like water base)
        const grassBase = new THREE.CylinderGeometry(PASTURE_HEX_RADIUS_3D, PASTURE_HEX_RADIUS_3D, 0.08, 6);
        grassBase.rotateY(Math.PI / 6); // Align with hex grid
        const grassBaseMesh = new THREE.Mesh(grassBase);
        grassBaseMesh.position.y = -0.04; // Slightly below ground
        group.add(grassBaseMesh);
        
        // Add multiple grass wave rings (like water ripples but green)
        for (let i = 0; i < 4; i++) {
            const radius = PASTURE_HEX_RADIUS_3D * (0.2 + i * 0.15);
            const grassRing = new THREE.RingGeometry(radius, radius + 0.08, 8);
            grassRing.rotateX(-Math.PI / 2);
            const grassRingMesh = new THREE.Mesh(grassRing);
            grassRingMesh.position.y = 0.01 + i * 0.005;
            grassRingMesh.userData = { 
                animationType: 'grass_wave',
                speed: 0.4 + i * 0.15,
                amplitude: 0.02,
                waveIndex: i
            };
            group.add(grassRingMesh);
        }
        
        // Add scattered grass tufts across the surface
        for (let i = 0; i < 8; i++) {
            const tuftGeometry = new THREE.ConeGeometry(0.03, 0.1, 4);
            const tuftMesh = new THREE.Mesh(tuftGeometry);
            
            const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
            const distance = 0.2 + Math.random() * (PASTURE_HEX_RADIUS_3D * 0.6);
            tuftMesh.position.x = Math.cos(angle) * distance;
            tuftMesh.position.z = Math.sin(angle) * distance;
            tuftMesh.position.y = 0.05;
            tuftMesh.rotation.y = Math.random() * Math.PI * 2;
            
            group.add(tuftMesh);
        }
        
        return group;
    }

    // Get grass materials with low-poly aesthetic
    getGrassBaseMaterial() {
        return new THREE.MeshStandardMaterial({
            color: 0x7CB342, // Base grass green
            transparent: true,
            opacity: 0.8,
            flatShading: true, // Low-poly aesthetic
            roughness: 0.8,
            metalness: 0.0
        });
    }

    getGrassWaveMaterial(waveIndex = 0) {
        const grassColors = [0x8BC34A, 0x7CB342, 0x689F38, 0x827717];
        const color = grassColors[waveIndex % grassColors.length];
        
        return new THREE.MeshStandardMaterial({
            color: color,
            transparent: true,
            opacity: 0.5 - waveIndex * 0.08, // Decreasing opacity
            flatShading: true,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });
    }

    getGrassTuftMaterial() {
        return new THREE.MeshStandardMaterial({
            color: 0x689F38, // Darker grass for tufts
            flatShading: true,
            roughness: 0.9,
            metalness: 0.0
        });
    }

    // Main function to add pasture elements to a tile
    addPastureElementsToTile(tileX, tileZ, terrainType) {
        console.log(`🌾 PastureSystem.addPastureElementsToTile called: (${tileX}, ${tileZ}) terrain='${terrainType}'`);
        
        const tileKey = `${tileX},${tileZ}`;
        
        // Clear existing elements for this tile
        this.clearTileElements(tileKey);
          // Calculate world position for this tile
        const worldX = tileX * PASTURE_HEX_SPACING_X;
        const worldZ = tileZ * PASTURE_HEX_SPACING_Z;
        
        console.log(`📍 World position: (${worldX}, 0, ${worldZ})`);
        
        // Create group for all elements on this tile
        const tileGroup = new THREE.Group();
        tileGroup.position.set(worldX, 0, worldZ);
        tileGroup.userData = { tileKey, terrainType, isPastureGroup: true };
        
        // Add different elements based on terrain type
        if (terrainType === 'A') { // Pasture
            console.log('🌾 Adding pasture elements...');
            this.addPastureElementsToGroup(tileGroup);
        } else if (terrainType === 'P') { // Plains
            console.log('🌱 Adding plains elements...');
            this.addPlainsElementsToGroup(tileGroup);
        } else {
            console.warn(`⚠️ Unknown terrain type: '${terrainType}'`);
        }
        
        console.log(`📦 Tile group has ${tileGroup.children.length} children`);
        
        // Add the group to scene and track it
        this.scene.add(tileGroup);
        this.pastureElements.set(tileKey, tileGroup);
        
        console.log(`✅ Added pasture elements for ${terrainType} tile (${tileX}, ${tileZ}). Total tiles: ${this.pastureElements.size}`);
    }

    addPastureElementsToGroup(tileGroup) {
        // Add grass patches
        this.addGrassPatches(tileGroup, 8, 12);
        
        // Add wildflowers
        this.addWildflowers(tileGroup, 2, 4);
        
        // Add small rocks occasionally
        if (Math.random() < 0.3) {
            this.addSmallRocks(tileGroup, 1, 2);
        }
        
        // Add soil patches for variety
        if (Math.random() < 0.4) {
            this.addSoilPatches(tileGroup, 1, 2);
        }
    }

    addPlainsElementsToGroup(tileGroup) {
        // Use default height if not provided
        const actualHeight = PASTURE_HEX_HEIGHT_3D || 0.4;
        
        // Plains have more sparse vegetation
        this.addGrassPatches(tileGroup, 5, 8);
        
        // Fewer flowers on plains
        if (Math.random() < 0.6) {
            this.addWildflowers(tileGroup, 1, 2);
        }
        
        // More rocks on plains
        if (Math.random() < 0.5) {
            this.addSmallRocks(tileGroup, 1, 3);
        }
        
        // Occasional soil patches
        if (Math.random() < 0.3) {
            this.addSoilPatches(tileGroup, 1, 2);
        }
        
        // Add additional low-poly elements to plains tiles
        // Add scattered wildflowers across the plains
        const numWildFlowers = Math.floor(Math.random() * 6) + 4; // 4-9 wildflowers
        for (let i = 0; i < numWildFlowers; i++) {
            const flowerGroup = new THREE.Group();
            
            // Flower stem
            const stemGeometry = new THREE.CylinderGeometry(0.004, 0.006, 0.05, 3);
            const stemMaterial = new THREE.MeshStandardMaterial({
                color: 0x558B2F,
                flatShading: true,
                roughness: 0.8,
                metalness: 0.0
            });
            const stem = new THREE.Mesh(stemGeometry, stemMaterial);
            stem.position.y = 0.025;
            flowerGroup.add(stem);
            
            // Flower petals (simple geometric approach)
            const petalColors = [0xFFE082, 0xF8BBD9, 0xE1BEE7, 0xFFCDD2, 0xC8E6C9];
            const petalGeometry = new THREE.SphereGeometry(0.008, 6, 4);
            const petalMaterial = new THREE.MeshStandardMaterial({
                color: petalColors[Math.floor(Math.random() * petalColors.length)],
                flatShading: true,
                roughness: 0.6,
                metalness: 0.0
            });
            const petal = new THREE.Mesh(petalGeometry, petalMaterial);
            petal.position.y = 0.05;
            flowerGroup.add(petal);
            
            // Position in open areas (avoid center where grass waves are)
            const angle = Math.random() * Math.PI * 2;
            const distance = HEX_RADIUS_3D * (0.4 + Math.random() * 0.4);
            flowerGroup.position.x = Math.cos(angle) * distance;
            flowerGroup.position.z = Math.sin(angle) * distance;
            flowerGroup.position.y = actualHeight / 2 - (PASTURE_HEX_HEIGHT_3D / 2);
            
            flowerGroup.children.forEach(child => {
                child.castShadow = true;
                child.receiveShadow = true;
            });
            
            tileGroup.add(flowerGroup);
        }
        
        // Add small bushes for variety
        const numBushes = Math.floor(Math.random() * 4) + 2; // 2-5 small bushes
        for (let i = 0; i < numBushes; i++) {
            const bushSize = 0.06 + Math.random() * 0.04;
            const bushGeometry = new THREE.SphereGeometry(bushSize, 8, 6);
            bushGeometry.scale(1, 0.7, 1); // Flatten slightly for natural bush shape
            
            const bushMaterial = new THREE.MeshStandardMaterial({
                color: [0x388E3C, 0x43A047, 0x4CAF50][Math.floor(Math.random() * 3)],
                flatShading: true,
                roughness: 0.8,
                metalness: 0.0
            });
            
            const bush = new THREE.Mesh(bushGeometry, bushMaterial);
            
            // Position around the edges to not interfere with grass waves
            const angle = Math.random() * Math.PI * 2;
            const distance = HEX_RADIUS_3D * (0.6 + Math.random() * 0.3);
            bush.position.x = Math.cos(angle) * distance;
            bush.position.z = Math.sin(angle) * distance;
            bush.position.y = actualHeight / 2 - (PASTURE_HEX_HEIGHT_3D / 2) + bushSize * 0.7;
            
            bush.castShadow = true;
            bush.receiveShadow = true;
            tileGroup.add(bush);
        }
        
        // Add occasional tree saplings (very small trees)
        if (Math.random() < 0.25) { // 25% chance for a sapling
            const saplingGroup = new THREE.Group();
            
            // Small trunk
            const trunkGeometry = new THREE.CylinderGeometry(0.01, 0.015, 0.1, 6);
            const trunkMaterial = new THREE.MeshStandardMaterial({
                color: 0x5D4037,
                flatShading: true,
                roughness: 0.9,
                metalness: 0.0
            });
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunk.position.y = 0.05;
            saplingGroup.add(trunk);
            
            // Small crown
            const crownGeometry = new THREE.SphereGeometry(0.04, 8, 6);
            const crownMaterial = new THREE.MeshStandardMaterial({
                color: 0x2E7D32,
                flatShading: true,
                roughness: 0.8,
                metalness: 0.0
            });
            const crown = new THREE.Mesh(crownGeometry, crownMaterial);
            crown.position.y = 0.12;
            saplingGroup.add(crown);
            
            // Position away from center
            const angle = Math.random() * Math.PI * 2;
            const distance = HEX_RADIUS_3D * (0.5 + Math.random() * 0.3);
            saplingGroup.position.x = Math.cos(angle) * distance;
            saplingGroup.position.z = Math.sin(angle) * distance;
            saplingGroup.position.y = actualHeight / 2 - (PASTURE_HEX_HEIGHT_3D / 2);
            
            saplingGroup.children.forEach(child => {
                child.castShadow = true;
                child.receiveShadow = true;
            });
            
            tileGroup.add(saplingGroup);
        }
        
        // Add small rocks for natural variation
        const numRocks = Math.floor(Math.random() * 5) + 2; // 2-6 small rocks
        for (let i = 0; i < numRocks; i++) {
            const rockSize = 0.015 + Math.random() * 0.02;
            const rockGeometry = new THREE.BoxGeometry(rockSize, rockSize * 0.9, rockSize * 1.1);
            const rockMaterial = new THREE.MeshStandardMaterial({
                color: [0x78909C, 0x90A4AE, 0xB0BEC5][Math.floor(Math.random() * 3)], // Light gray stones
                flatShading: true,
                roughness: 0.9,
                metalness: 0.1
            });
            
            const rock = new THREE.Mesh(rockGeometry, rockMaterial);
            
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * HEX_RADIUS_3D * 0.8;
            rock.position.x = Math.cos(angle) * distance;
            rock.position.z = Math.sin(angle) * distance;
            rock.position.y = actualHeight / 2 - (PASTURE_HEX_HEIGHT_3D / 2) + rockSize * 0.45;
            
            rock.rotation.x = Math.random() * 0.4;
            rock.rotation.y = Math.random() * Math.PI * 2;
            rock.rotation.z = Math.random() * 0.4;
            
            rock.castShadow = true;
            rock.receiveShadow = true;
            tileGroup.add(rock);
        }
    }    addGrassPatches(tileGroup, minCount, maxCount) {
        const count = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;
        console.log(`🌱 Adding ${count} grass patches (${minCount}-${maxCount})`);
        
        for (let i = 0; i < count; i++) {
            const grassGroup = new THREE.Group();
            
            // Random position within hex tile bounds
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.4;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            
            grassGroup.position.set(x, 0, z);
            
            // Add multiple grass blades per patch
            const bladeCount = Math.floor(Math.random() * 5) + 3;
            for (let j = 0; j < bladeCount; j++) {
                const blade = this.createGrassBlade();
                
                // Small random offset within the patch
                const offsetX = (Math.random() - 0.5) * 0.1;
                const offsetZ = (Math.random() - 0.5) * 0.1;
                blade.position.set(offsetX, 0, offsetZ);
                
                // Random rotation
                blade.rotation.y = Math.random() * Math.PI * 2;
                
                // Slight random scale variation
                const scale = 0.8 + Math.random() * 0.4;
                blade.scale.setScalar(scale);
                
                grassGroup.add(blade);            }
            
            tileGroup.add(grassGroup);
        }
        
        console.log(`✅ Added ${count} grass patches to tile group`);
    }    createGrassBlade() {
        const blade = new THREE.Mesh(
            this.geometries.grassBlade,
            this.getRandomGrassMaterial()
        );
        
        // Position at ground level
        blade.position.y = 0.075;
        
        // Mark for identification
        blade.userData.isGrass = true;
        blade.userData.isPastureElement = true;
        
        return blade;
    }

    getRandomGrassMaterial() {
        const materials = [
            this.materials.grassLight,
            this.materials.grassMedium,
            this.materials.grassDark
        ];
        return materials[Math.floor(Math.random() * materials.length)];
    }

    addWildflowers(tileGroup, minCount, maxCount) {
        const count = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;
        
        for (let i = 0; i < count; i++) {
            const flower = this.createWildflower();
            
            // Random position within hex tile bounds
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.35;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            
            flower.position.set(x, 0, z);
            tileGroup.add(flower);
        }
    }

    createWildflower() {
        const flowerGroup = new THREE.Group();
        
        // Create stem
        const stem = new THREE.Mesh(
            this.geometries.flowerStem,
            this.materials.grassDark
        );
        stem.position.y = 0.04;
        flowerGroup.add(stem);
        
        // Create flower head with petals
        const petalCount = Math.floor(Math.random() * 3) + 4;
        const flowerMaterial = this.getRandomFlowerMaterial();
        
        for (let i = 0; i < petalCount; i++) {
            const petal = new THREE.Mesh(
                this.geometries.flowerPetal,
                flowerMaterial
            );
            
            const angle = (i / petalCount) * Math.PI * 2;
            const petalRadius = 0.02;
            petal.position.set(
                Math.cos(angle) * petalRadius,
                0.08,
                Math.sin(angle) * petalRadius
            );
            
            flowerGroup.add(petal);
        }
          // Random scale
        const scale = 0.7 + Math.random() * 0.6;
        flowerGroup.scale.setScalar(scale);
        
        // Mark for identification
        flowerGroup.userData.isFlower = true;
        flowerGroup.userData.isPastureElement = true;
        
        return flowerGroup;
    }

    getRandomFlowerMaterial() {
        const materials = [
            this.materials.flowerWhite,
            this.materials.flowerYellow,
            this.materials.flowerPurple
        ];
        return materials[Math.floor(Math.random() * materials.length)];
    }

    addSmallRocks(tileGroup, minCount, maxCount) {
        const count = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;
        
        for (let i = 0; i < count; i++) {
            const rock = new THREE.Mesh(
                this.geometries.smallRock,
                this.materials.rockGray
            );
            
            // Random position within hex tile bounds
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.3;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            
            rock.position.set(x, 0.015, z);
            
            // Random rotation
            rock.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI
            );
            
            // Random scale
            const scale = 0.5 + Math.random() * 1.0;
            rock.scale.setScalar(scale);
            
            tileGroup.add(rock);
        }
    }

    addSoilPatches(tileGroup, minCount, maxCount) {
        const count = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;
        
        for (let i = 0; i < count; i++) {
            const soilPatch = new THREE.Mesh(
                this.geometries.soilPatch,
                this.materials.soilBrown
            );
            
            // Random position within hex tile bounds
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.25;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            
            soilPatch.position.set(x, 0.01, z);
            
            // Random rotation
            soilPatch.rotation.y = Math.random() * Math.PI * 2;
            
            // Random scale
            const scale = 0.6 + Math.random() * 0.8;
            soilPatch.scale.setScalar(scale);
            
            tileGroup.add(soilPatch);
        }
    }

    // Clear all elements for a specific tile
    clearTileElements(tileKey) {
        if (this.pastureElements.has(tileKey)) {
            const tileGroup = this.pastureElements.get(tileKey);
            this.scene.remove(tileGroup);
            
            // Dispose of geometries and materials to prevent memory leaks
            tileGroup.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => material.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            
            this.pastureElements.delete(tileKey);
        }
    }

    // Update visible pasture elements based on field of view
    updateVisibleElements(centerX, centerZ, radius) {
        const visibleTiles = new Set();
        
        // Calculate which tiles should have elements
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const tileX = centerX + dx;
                const tileZ = centerZ + dz;
                const distance = Math.sqrt(dx * dx + dz * dz);
                
                if (distance <= radius) {
                    const tileKey = `${tileX},${tileZ}`;
                    visibleTiles.add(tileKey);                    // Add elements if tile is pasture or plains and not already added
                    if (!this.pastureElements.has(tileKey)) {
                        // Check if this tile is pasture or plains - use safe global map access
                        if (typeof window !== 'undefined' && window.map && window.map[tileZ] && window.map[tileZ][tileX]) {
                            const tileData = window.map[tileZ][tileX];
                            const terrainType = tileData.terrain || tileData; // Handle both object and string formats
                            if (terrainType === 'A' || terrainType === 'P') {
                                this.addPastureElementsToTile(tileX, tileZ, terrainType);
                            }
                        }
                    }
                }
            }
        }
        
        // Remove elements that are no longer visible
        for (const [tileKey, tileGroup] of this.pastureElements) {
            if (!visibleTiles.has(tileKey)) {
                this.clearTileElements(tileKey);
            }
        }    }    // Update element visibility based on distance from center point (for FOV-based rendering)
    updateElementVisibility(centerX, centerZ, radius) {
        const maxDistance = radius * PASTURE_HEX_SPACING_X;
        
        for (const [tileKey, tileGroup] of this.pastureElements.entries()) {
            const [tileX, tileZ] = tileKey.split(',').map(Number);
            const distance = Math.sqrt(
                Math.pow((tileX - centerX) * PASTURE_HEX_SPACING_X, 2) + 
                Math.pow((tileZ - centerZ) * PASTURE_HEX_SPACING_Z, 2)
            );
            
            // Show/hide based on distance
            tileGroup.visible = distance <= maxDistance;
        }
    }

    // Clear all pasture elements
    clearAll() {
        for (const tileKey of this.pastureElements.keys()) {
            this.clearTileElements(tileKey);
        }
    }

    // Get statistics about current pasture elements
    getStats() {
        return {
            totalTiles: this.pastureElements.size,
            totalElements: Array.from(this.pastureElements.values())
                .reduce((sum, group) => sum + group.children.length, 0)
        };
    }

    // Initialize selection system
    initializeSelectionSystem() {
        // Create hover indicator (invisible by default)
        this.hoverIndicator = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 })
        );
        this.hoverIndicator.visible = false;
        this.scene.add(this.hoverIndicator);
        
        // Register mouse move event for selection
        window.addEventListener('mousemove', (event) => this.onMouseMove(event));
        window.addEventListener('mousedown', (event) => this.onMouseDown(event));
        window.addEventListener('mouseup', (event) => this.onMouseUp(event));
    }

    // Mouse move event handler
    onMouseMove(event) {
        // Convert mouse position to normalized device coordinates
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Update hover indicator position
        this.updateHoverIndicator();
    }

    // Update hover indicator position based on mouse
    updateHoverIndicator() {
        // Safely access the global camera
        const camera = window.camera || (window.scene && window.scene.camera) || null;
        if (!camera) {
            console.warn('⚠️ Camera not available for pasture selection');
            this.hoveredElement = null;
            this.hoverIndicator.visible = false;
            return;
        }
        
        // Raycast from camera to mouse position
        this.raycaster.setFromCamera(this.mouse, camera);
        const intersects = this.raycaster.intersectObjects(Array.from(this.pastureElements.values()).flat(), true);
        
        if (intersects.length > 0) {
            const intersected = intersects[0];
            this.hoveredElement = intersected.object;
            
            // Move hover indicator to the intersected object's position
            this.hoverIndicator.position.copy(intersected.point);
            this.hoverIndicator.visible = true;
        } else {
            this.hoveredElement = null;
            this.hoverIndicator.visible = false;
        }
    }

    // Mouse down event handler
    onMouseDown(event) {
        if (this.hoveredElement) {
            // Select or deselect element on click
            this.toggleSelectElement(this.hoveredElement);
        }
    }

    // Toggle selection of an element
    toggleSelectElement(element) {
        if (this.selectedElements.has(element)) {
            // Deselect element
            this.selectedElements.delete(element);
            element.material.opacity = 0.85; // Restore opacity
        } else {
            // Select element
            this.selectedElements.add(element);
            element.material.opacity = 1.0; // Highlight opacity
        }
        
        // Call selection change callbacks
        this.callSelectionCallbacks();
    }

    // Call registered callbacks for selection changes
    callSelectionCallbacks() {
        for (const callback of this.selectionCallbacks.values()) {
            callback(this.selectedElements);
        }
    }

    // Register a callback for selection changes
    onSelectionChange(callback) {
        const id = Symbol();
        this.selectionCallbacks.set(id, callback);
        return id;
    }

    // Unregister a callback for selection changes
    offSelectionChange(id) {
        this.selectionCallbacks.delete(id);
    }

    // Clear all selections
    clearSelection() {
        this.selectedElements.forEach(element => {
            element.material.opacity = 0.85; // Restore opacity
        });
        this.selectedElements.clear();
        this.hoveredElement = null;
        this.hoverIndicator.visible = false;
    }

}

// Create full grass tile geometry (mimics water tiles but with grass elements)
function createFullGrassTileGeometry() {
    const group = new THREE.Group();
    
    // Base hexagonal grass surface (like water base)
    const grassBase = new THREE.CylinderGeometry(HEX_RADIUS_3D, HEX_RADIUS_3D, 0.06, 6);
    grassBase.rotateY(Math.PI / 6); // Align with hex grid
    const grassBaseMesh = new THREE.Mesh(grassBase);
    grassBaseMesh.position.y = -0.03; // Slightly below ground
    grassBaseMesh.userData = { elementType: 'base' };
    group.add(grassBaseMesh);
    
    // Add multiple grass wave rings (like water ripples but green) - more like water system
    for (let i = 0; i < 4; i++) {
        const radius = HEX_RADIUS_3D * (0.25 + i * 0.18); // Similar progression to water rings
        const ringWidth = 0.08 + i * 0.02; // Increasing ring width
        const grassRing = new THREE.RingGeometry(radius, radius + ringWidth, 8);
        grassRing.rotateX(-Math.PI / 2);
        const grassRingMesh = new THREE.Mesh(grassRing);
        grassRingMesh.position.y = 0.008 + i * 0.004; // Slight height variation
        grassRingMesh.userData = { 
            animationType: 'grass_wave',
            speed: 0.4 + i * 0.15,
            amplitude: 0.015 + i * 0.005,
            waveIndex: i,
            elementType: 'wave_ring'
        };
        group.add(grassRingMesh);
    }
    
    // Add central grass tuft clusters (like lake bubbles or particles)
    for (let i = 0; i < 6; i++) {
        const clusterGroup = new THREE.Group();
        
        // Main tuft
        const tuftGeometry = new THREE.ConeGeometry(0.025, 0.08, 4);
        const tuftMesh = new THREE.Mesh(tuftGeometry);
        tuftMesh.position.y = 0.04;
        clusterGroup.add(tuftMesh);
        
        // Smaller surrounding tufts
        for (let j = 0; j < 3; j++) {
            const smallTuft = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.05, 3));
            const angle = (j / 3) * Math.PI * 2;
            smallTuft.position.x = Math.cos(angle) * 0.03;
            smallTuft.position.z = Math.sin(angle) * 0.03;
            smallTuft.position.y = 0.025;
            clusterGroup.add(smallTuft);
        }
        
        // Position cluster
        const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
        const distance = 0.15 + Math.random() * (HEX_RADIUS_3D * 0.5);
        clusterGroup.position.x = Math.cos(angle) * distance;
        clusterGroup.position.z = Math.sin(angle) * distance;
        clusterGroup.rotation.y = Math.random() * Math.PI * 2;
        clusterGroup.userData = { elementType: 'grass_cluster' };
        
        group.add(clusterGroup);
    }
    
    // Add scattered individual grass blades around the edges (like water foam)
    for (let i = 0; i < 12; i++) {
        const bladeGeometry = new THREE.ConeGeometry(0.012, 0.06, 3);
        const bladeMesh = new THREE.Mesh(bladeGeometry);
        
        const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
        const distance = HEX_RADIUS_3D * (0.7 + Math.random() * 0.25);
        bladeMesh.position.x = Math.cos(angle) * distance;
        bladeMesh.position.z = Math.sin(angle) * distance;
        bladeMesh.position.y = 0.03;
        bladeMesh.rotation.y = Math.random() * Math.PI * 2;
        bladeMesh.rotation.z = (Math.random() - 0.5) * 0.3; // Slight tilt
        bladeMesh.userData = { elementType: 'edge_blade' };
        
        group.add(bladeMesh);
    }
    
    return group;
}

// Get grass materials with low-poly aesthetic (mimics water materials)
function getGrassBaseMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0x4CAF50, // Rich grass green
        transparent: true,
        opacity: 0.9,
        flatShading: true, // Low-poly aesthetic
        roughness: 0.7,
        metalness: 0.0,
        side: THREE.DoubleSide
    });
}

function getGrassWaveMaterial(waveIndex = 0) {
    const grassColors = [
        0x7CB342, // Light grass
        0x689F38, // Medium grass
        0x558B2F, // Darker grass
        0x33691E  // Deep grass
    ];
    const color = grassColors[waveIndex % grassColors.length];
    
    return new THREE.MeshStandardMaterial({
        color: color,
        transparent: true,
        opacity: 0.6 - waveIndex * 0.1, // Decreasing opacity like water ripples
        flatShading: true,
        roughness: 0.8,
        metalness: 0.0,
        side: THREE.DoubleSide
    });
}

function getGrassTuftMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0x2E7D32, // Darker green for tufts
        flatShading: true,
        roughness: 0.9,
        metalness: 0.0,
        transparent: true,
        opacity: 0.85
    });
}

function getGrassClusterMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0x388E3C, // Medium green for clusters
        flatShading: true,
        roughness: 0.85,
        metalness: 0.0
    });
}

function getGrassBladeMaterial() {
    return new THREE.MeshStandardMaterial({
        color: 0x689F38, // Natural grass green
        flatShading: true,
        roughness: 0.9,
        metalness: 0.0,
        transparent: true,
        opacity: 0.7
    });
}

// Add comprehensive pasture elements for agriculture tiles (A)
function addPastureElements(tileGroup, x, y, actualHeight) {
    // Create base grass coverage
    addPastureGrassBase(tileGroup, actualHeight);
    
    // Add farm elements
    addFarmElements(tileGroup, x, y, actualHeight);
    
    // Add natural pasture elements
    addNaturalPastureElements(tileGroup, actualHeight);
}

// Create base grass coverage for pasture
function addPastureGrassBase(tileGroup, actualHeight) {
    // Base grass field using hexagonal pattern
    const grassBase = new THREE.CylinderGeometry(HEX_RADIUS_3D * 0.9, HEX_RADIUS_3D * 0.9, 0.04, 6);
    grassBase.rotateY(Math.PI / 6);
    const grassBaseMaterial = new THREE.MeshStandardMaterial({
        color: 0x7CB342, // Fresh pasture green
        flatShading: true,
        roughness: 0.8,
        metalness: 0.0
    });
    const grassBaseMesh = new THREE.Mesh(grassBase, grassBaseMaterial);
    grassBaseMesh.position.y = actualHeight / 2 - (HEX_HEIGHT_3D / 2) + 0.02;
    grassBaseMesh.receiveShadow = true;
    tileGroup.add(grassBaseMesh);
}

// Add farm-specific elements to pasture tiles
function addFarmElements(tileGroup, x, y, actualHeight) {
    // Add crop rows (low-poly geometric style)
    const numCropRows = Math.floor(Math.random() * 3) + 2; // 2-4 crop rows
    for (let i = 0; i < numCropRows; i++) {
        // Create crop row using box geometry
        const cropRowGeometry = new THREE.BoxGeometry(0.6, 0.08, 0.1);
        const cropRowMaterial = new THREE.MeshStandardMaterial({
            color: [0x8BC34A, 0x7CB342, 0x689F38][Math.floor(Math.random() * 3)], // Varied crop greens
            flatShading: true,
            roughness: 0.9,
            metalness: 0.0
        });
        
        const cropRow = new THREE.Mesh(cropRowGeometry, cropRowMaterial);
        
        // Position in parallel lines across the hex
        const rowOffset = (i - numCropRows/2) * 0.3;
        cropRow.position.x = rowOffset;
        cropRow.position.z = (Math.random() - 0.5) * 0.4;
        cropRow.position.y = actualHeight / 2 - (HEX_HEIGHT_3D / 2) + 0.08;
        
        // Slight random rotation for natural look
        cropRow.rotation.y = (Math.random() - 0.5) * 0.3;
        
        cropRow.castShadow = true;
        cropRow.receiveShadow = true;
        tileGroup.add(cropRow);
    }
    
    // Add farm stakes/posts (low-poly cylinders)
    const numStakes = Math.floor(Math.random() * 4) + 2; // 2-5 stakes
    for (let i = 0; i < numStakes; i++) {
        const stakeGeometry = new THREE.CylinderGeometry(0.02, 0.03, 0.15, 6);
        const stakeMaterial = new THREE.MeshStandardMaterial({
            color: 0x5D4037, // Brown wood stakes
            flatShading: true,
            roughness: 0.9,
            metalness: 0.0
        });
        
        const stake = new THREE.Mesh(stakeGeometry, stakeMaterial);
        
        // Distribute around the hex edge
        const angle = (i / numStakes) * Math.PI * 2;
        const distance = HEX_RADIUS_3D * (0.6 + Math.random() * 0.3);
        stake.position.x = Math.cos(angle) * distance;
        stake.position.z = Math.sin(angle) * distance;
        stake.position.y = actualHeight / 2 - (HEX_HEIGHT_3D / 2) + 0.075;
        
        stake.castShadow = true;
        stake.receiveShadow = true;
        tileGroup.add(stake);
    }
    
    // Add scattered farm tools/objects
    if (Math.random() < 0.3) {
        // Simple low-poly hay bale
        const hayBaleGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8);
        const hayBaleMaterial = new THREE.MeshStandardMaterial({
            color: 0xFDD835, // Golden hay color
            flatShading: true,
            roughness: 0.9,
            metalness: 0.0
        });
        
        const hayBale = new THREE.Mesh(hayBaleGeometry, hayBaleMaterial);
        hayBale.position.x = (Math.random() - 0.5) * HEX_RADIUS_3D * 0.8;
        hayBale.position.z = (Math.random() - 0.5) * HEX_RADIUS_3D * 0.8;
        hayBale.position.y = actualHeight / 2 - (HEX_HEIGHT_3D / 2) + 0.03;
        hayBale.rotation.y = Math.random() * Math.PI * 2;
        
        hayBale.castShadow = true;
        hayBale.receiveShadow = true;
        tileGroup.add(hayBale);
    }
}

// Add natural elements to pasture
function addNaturalPastureElements(tileGroup, actualHeight) {
    // Add wildflowers scattered throughout
    const numFlowers = Math.floor(Math.random() * 8) + 6; // 6-13 flowers
    for (let i = 0; i < numFlowers; i++) {
        const flowerGroup = new THREE.Group();
        
        // Flower stem (thin cylinder)
        const stemGeometry = new THREE.CylinderGeometry(0.005, 0.008, 0.06, 4);
        const stemMaterial = new THREE.MeshStandardMaterial({
            color: 0x4CAF50,
            flatShading: true,
            roughness: 0.8,
            metalness: 0.0
        });
        const stem = new THREE.Mesh(stemGeometry, stemMaterial);
        stem.position.y = 0.03;
        flowerGroup.add(stem);
        
        // Flower head (small sphere)
        const flowerGeometry = new THREE.SphereGeometry(0.012, 6, 4);
        const flowerColors = [0xFF5722, 0xE91E63, 0x9C27B0, 0xFFEB3B, 0xFFFFFF];
        const flowerMaterial = new THREE.MeshStandardMaterial({
            color: flowerColors[Math.floor(Math.random() * flowerColors.length)],
            flatShading: true,
            roughness: 0.7,
            metalness: 0.0
        });
        const flower = new THREE.Mesh(flowerGeometry, flowerMaterial);
        flower.position.y = 0.06;
        flowerGroup.add(flower);
        
        // Position flower
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * HEX_RADIUS_3D * 0.8;
        flowerGroup.position.x = Math.cos(angle) * distance;
        flowerGroup.position.z = Math.sin(angle) * distance;
        flowerGroup.position.y = actualHeight / 2 - (HEX_HEIGHT_3D / 2);
        
        flowerGroup.children.forEach(child => {
            child.castShadow = true;
            child.receiveShadow = true;
        });
        
        tileGroup.add(flowerGroup);
    }
    
    // Add grass tufts for texture variation
    const numTufts = Math.floor(Math.random() * 12) + 8; // 8-19 grass tufts
    for (let i = 0; i < numTufts; i++) {
        const tuftGeometry = new THREE.ConeGeometry(0.03, 0.1, 4);
        const tuftMaterial = new THREE.MeshStandardMaterial({
            color: [0x689F38, 0x7CB342, 0x8BC34A][Math.floor(Math.random() * 3)],
            flatShading: true,
            roughness: 0.9,
            metalness: 0.0
        });
        
        const tuft = new THREE.Mesh(tuftGeometry, tuftMaterial);
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * HEX_RADIUS_3D * 0.85;
        tuft.position.x = Math.cos(angle) * distance;
        tuft.position.z = Math.sin(angle) * distance;
        tuft.position.y = actualHeight / 2 - (HEX_HEIGHT_3D / 2) + 0.05;
        
        tuft.rotation.y = Math.random() * Math.PI * 2;
        tuft.rotation.z = (Math.random() - 0.5) * 0.2; // Slight tilt
        
        tuft.castShadow = true;
        tuft.receiveShadow = true;
        tileGroup.add(tuft);
    }
    
    // Add small rocks/stones for natural variation
    const numStones = Math.floor(Math.random() * 6) + 3; // 3-8 stones
    for (let i = 0; i < numStones; i++) {
        const stoneSize = 0.02 + Math.random() * 0.03;
        const stoneGeometry = new THREE.BoxGeometry(stoneSize, stoneSize * 0.8, stoneSize * 1.2);
        const stoneMaterial = new THREE.MeshStandardMaterial({
            color: [0x795548, 0x6D4C41, 0x8D6E63][Math.floor(Math.random() * 3)],
            flatShading: true,
            roughness: 0.9,
            metalness: 0.1
        });
        
        const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * HEX_RADIUS_3D * 0.7;
        stone.position.x = Math.cos(angle) * distance;
        stone.position.z = Math.sin(angle) * distance;
        stone.position.y = actualHeight / 2 - (HEX_HEIGHT_3D / 2) + stoneSize * 0.4;
        
        stone.rotation.x = Math.random() * 0.3;
        stone.rotation.y = Math.random() * Math.PI * 2;
        stone.rotation.z = Math.random() * 0.3;
        
        stone.castShadow = true;
        stone.receiveShadow = true;
        tileGroup.add(stone);
    }
}

// Global pasture system instance and management functions
let globalPastureSystem = null;

// Initialize the global pasture system
function initializePastureSystem(scene) {
    console.log('🌾 Initializing global pasture system...');
    if (globalPastureSystem) {
        console.log('⚠️ Pasture system already initialized, clearing first...');
        globalPastureSystem.clearAll();
    }
    
    globalPastureSystem = new PastureSystem(scene);
    console.log('✅ Global pasture system initialized');
    return globalPastureSystem;
}

// Update pasture elements for visible tiles
function updatePastureElements(centerX, centerZ, radius) {
    if (!globalPastureSystem) {
        console.warn('⚠️ Pasture system not initialized, cannot update elements');
        return;
    }
    
    globalPastureSystem.updateVisibleElements(centerX, centerZ, radius);
}

// Clear all pasture elements
function clearAllPastureElements() {
    if (!globalPastureSystem) {
        console.warn('⚠️ Pasture system not initialized, cannot clear elements');
        return;
    }
    
    globalPastureSystem.clearAll();
}

// Get pasture system statistics
function getPastureSystemStats() {
    if (!globalPastureSystem) {
        return { totalTiles: 0, totalElements: 0, systemInitialized: false };
    }
    
    const stats = globalPastureSystem.getStats();
    stats.systemInitialized = true;
    return stats;
}

// Add pasture elements to a specific tile
function addPastureToTile(tileX, tileZ, terrainType) {
    if (!globalPastureSystem) {
        console.warn('⚠️ Pasture system not initialized, cannot add pasture to tile');
        return;
    }
    
    globalPastureSystem.addPastureElementsToTile(tileX, tileZ, terrainType);
}

// Get the global pasture system instance
function getPastureSystem() {
    return globalPastureSystem;
}

// Add plains elements to a tile group (wrapper function for external use)
function addPlainsElements(tileGroup, x, y, actualHeight) {
    console.log(`🌱 Adding plains elements to tile group at (${x}, ${y})`);
    
    if (!tileGroup) {
        console.error('❌ Cannot add plains elements: tileGroup is null or undefined');
        return;
    }
    
    // Use the instance method if available, otherwise fall back to manual implementation
    if (globalPastureSystem) {
        globalPastureSystem.addPlainsElementsToGroup(tileGroup);
    } else {
        console.warn('⚠️ Global pasture system not initialized, using fallback plains elements');
        addFallbackPlainsElements(tileGroup, actualHeight);
    }
}

// Fallback plains elements function for when the system isn't initialized
function addFallbackPlainsElements(tileGroup, actualHeight = 0) {
    // Add simple grass patches
    for (let i = 0; i < 6; i++) {
        const grassGeometry = new THREE.ConeGeometry(0.02, 0.08, 4);
        const grassMaterial = new THREE.MeshStandardMaterial({
            color: [0x7CB342, 0x689F38, 0x8BC34A][Math.floor(Math.random() * 3)],
            flatShading: true
        });
        const grass = new THREE.Mesh(grassGeometry, grassMaterial);
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 0.4;
        grass.position.set(
            Math.cos(angle) * distance,
            actualHeight + 0.04,
            Math.sin(angle) * distance
        );
        
        tileGroup.add(grass);
    }
}
