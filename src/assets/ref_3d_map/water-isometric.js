// Ensure THREE is available when bundled as an ES module
var THREE = (typeof THREE !== 'undefined') ? THREE : (typeof window !== 'undefined' && window.THREE) ? window.THREE : (typeof globalThis !== 'undefined' ? globalThis.THREE : undefined);
/**
 * Low-Poly Isometric Water System for Afro-Future Rising
 * Creates polygonal water tiles with geometric wave animations that match the game's aesthetic
 */

// Water system variables
var waterMaterials = {};
var waterAnimationMixers = [];
var waterGroups = [];
var waterTileInstances = new Map();

// Water geometry creation functions
function createLakeWaterGeometry() {
    const group = new THREE.Group();
    
    // Base hexagonal water surface
    const waterBase = new THREE.CylinderGeometry(HEX_RADIUS_3D, HEX_RADIUS_3D, 0.1, 6);
    waterBase.rotateY(Math.PI / 6); // Align with hex grid
    const waterBaseMesh = new THREE.Mesh(waterBase);
    waterBaseMesh.position.y = -0.05; // Slightly below ground
    group.add(waterBaseMesh);
    
    // Add gentle polygonal wave rings
    for (let i = 0; i < 3; i++) {
        const radius = HEX_RADIUS_3D * (0.3 + i * 0.2);
        const waveRing = new THREE.RingGeometry(radius, radius + 0.1, 6);
        waveRing.rotateX(-Math.PI / 2);
        const waveRingMesh = new THREE.Mesh(waveRing);
        waveRingMesh.position.y = 0.02 + i * 0.01;
        waveRingMesh.userData = { 
            animationType: 'gentle_wave',
            speed: 0.5 + i * 0.2,
            amplitude: 0.05
        };
        group.add(waveRingMesh);
    }
    
    return group;
}

function createPondWaterGeometry() {
    const group = new THREE.Group();
    
    // Smaller base water surface
    const waterBase = new THREE.CylinderGeometry(HEX_RADIUS_3D * 0.8, HEX_RADIUS_3D * 0.8, 0.08, 6);
    waterBase.rotateY(Math.PI / 6);
    const waterBaseMesh = new THREE.Mesh(waterBase);
    waterBaseMesh.position.y = -0.04;
    group.add(waterBaseMesh);
    
    // Minimal ripple effects
    const ripple = new THREE.RingGeometry(HEX_RADIUS_3D * 0.4, HEX_RADIUS_3D * 0.5, 6);
    ripple.rotateX(-Math.PI / 2);
    const rippleMesh = new THREE.Mesh(ripple);
    rippleMesh.position.y = 0.01;
    rippleMesh.userData = { 
        animationType: 'calm_ripple',
        speed: 0.3,
        amplitude: 0.02
    };
    group.add(rippleMesh);
    
    return group;
}

function createRiverWaterGeometry() {
    const group = new THREE.Group();
    
    // Flowing water base - slightly elongated
    const waterBase = new THREE.CylinderGeometry(HEX_RADIUS_3D, HEX_RADIUS_3D, 0.12, 6);
    waterBase.rotateY(Math.PI / 6);
    waterBase.scale(1.2, 1, 1); // Elongated for flow effect
    const waterBaseMesh = new THREE.Mesh(waterBase);
    waterBaseMesh.position.y = -0.06;
    group.add(waterBaseMesh);
    
    // Flowing wave segments
    for (let i = 0; i < 4; i++) {
        const flowSegment = new THREE.BoxGeometry(0.8, 0.03, 0.2);
        const flowMesh = new THREE.Mesh(flowSegment);
        flowMesh.position.set(
            (i - 1.5) * 0.4,
            0.02,
            Math.sin(i * 0.5) * 0.3
        );
        flowMesh.userData = { 
            animationType: 'flow_wave',
            speed: 1.0 + i * 0.2,
            amplitude: 0.08,
            flowOffset: i
        };
        group.add(flowMesh);
    }
    
    return group;
}

// Water type selection based on terrain character
function getWaterGeometry(terrainChar, tileX, tileY) {
    // Use position to add variety within same type
    const variant = ((tileX * 31) + (tileY * 17)) % 3;
    
    switch (terrainChar) {
        case 'L': // Lake
            return createLakeWaterGeometry();
        case 'N': // Pond
            return createPondWaterGeometry();
        case 'V': // River
            return createRiverWaterGeometry();
        default:
            return createLakeWaterGeometry();
    }
}

// Water materials with low-poly aesthetic
function getWaterTrunkMaterial(waterType = 'default') {
    const materialKey = `water_base_${waterType}`;
    
    if (!waterMaterials[materialKey]) {
        let baseColor = 0x4A90E2; // Default blue
        
        switch (waterType) {
            case 'lake':
                baseColor = 0x2E5E9E; // Deep blue
                break;
            case 'pond':
                baseColor = 0x4A90E2; // Medium blue
                break;
            case 'river':
                baseColor = 0x5BA0F2; // Flowing blue
                break;
        }
        
        waterMaterials[materialKey] = new THREE.MeshLambertMaterial({
            color: baseColor,
            transparent: true,
            opacity: 0.8,
            flatShading: true // Low-poly aesthetic
        });
    }
    
    return waterMaterials[materialKey];
}

function getWaterWaveMaterial(terrainChar, waterType = 'default') {
    const materialKey = `water_wave_${terrainChar}_${waterType}`;
    
    if (!waterMaterials[materialKey]) {
        let waveColor = 0x87CEEB; // Default wave color
        let opacity = 0.6;
        
        switch (terrainChar) {
            case 'L': // Lake
                waveColor = 0x87CEEB; // Sky blue waves
                opacity = 0.7;
                break;
            case 'N': // Pond
                waveColor = 0xADD8E6; // Light blue
                opacity = 0.5;
                break;
            case 'V': // River
                waveColor = 0x98D8E8; // Flowing blue-white
                opacity = 0.8;
                break;
        }
        
        waterMaterials[materialKey] = new THREE.MeshLambertMaterial({
            color: waveColor,
            transparent: true,
            opacity: opacity,
            flatShading: true,
            side: THREE.DoubleSide
        });
    }
    
    return waterMaterials[materialKey];
}

// Main function to add water tiles
function addWaterToTile(tileGroup, terrainChar, tileX, tileY, actualHeight) {
    // Skip if water already exists on this tile
    const tileKey = `${tileX},${tileY}`;
    if (waterTileInstances.has(tileKey)) {
        return;
    }
    
    // Get water geometry
    const waterGeometry = getWaterGeometry(terrainChar, tileX, tileY);
    
    // Apply materials to water parts
    const baseMaterial = getWaterTrunkMaterial(getWaterTypeName(terrainChar).toLowerCase());
    const waveMaterial = getWaterWaveMaterial(terrainChar);
    
    waterGeometry.children.forEach((child, index) => {
        if (index === 0) {
            // Base water surface
            child.material = baseMaterial;
        } else {
            // Wave elements
            child.material = waveMaterial;
        }
        child.castShadow = false; // Water doesn't cast shadows
        child.receiveShadow = true;
    });
    
    // Position the water on the tile
    waterGeometry.position.set(0, actualHeight - 0.1, 0);
    
    // Add slight random rotation for natural variation
    const rotationHash = ((tileX * 67) + (tileY * 83)) % 360;
    waterGeometry.rotation.y = (rotationHash * Math.PI) / 180;
    
    // Add random scale variation (95% to 105%) for subtle variety
    const scaleHash = ((tileX * 43) + (tileY * 97)) % 10;
    const scale = 0.95 + (scaleHash / 100);
    waterGeometry.scale.setScalar(scale);
    
    // Add the water to the tile group
    tileGroup.add(waterGeometry);
    
    // Store reference for animations and management
    waterGroups.push(waterGeometry);
    waterTileInstances.set(tileKey, {
        waterGroup: waterGeometry,
        terrainChar: terrainChar,
        position: { x: tileX, y: tileY }
    });
    
    // Add special features based on water type
    addWaterFeatures(tileGroup, terrainChar, tileX, tileY, actualHeight);
    
    console.log(`🌊 Water System: Added ${getWaterTypeName(terrainChar)} at (${tileX}, ${tileY})`);
}

// Add interactive features to water tiles
function addWaterFeatures(tileGroup, terrainChar, tileX, tileY, actualHeight) {
    const featureChance = ((tileX * 41) + (tileY * 79)) % 100;
    
    // Fishing spots (10% chance on lakes and ponds)
    if ((terrainChar === 'L' || terrainChar === 'N') && featureChance < 10) {
        addFishingSpot(tileGroup, tileX, tileY, actualHeight);
    }
    
    // Bridge opportunities on rivers (15% chance)
    if (terrainChar === 'V' && featureChance < 15) {
        addBridgeOpportunity(tileGroup, tileX, tileY, actualHeight);
    }
    
    // Treasure hints (5% chance)
    if (featureChance < 5) {
        addTreasureHint(tileGroup, tileX, tileY, actualHeight);
    }
}

function addFishingSpot(tileGroup, tileX, tileY, actualHeight) {
    // Create fishing spot indicator - small geometric ripples
    const fishingRipple = new THREE.RingGeometry(0.3, 0.4, 8);
    fishingRipple.rotateX(-Math.PI / 2);
    const fishingMaterial = new THREE.MeshLambertMaterial({
        color: 0xFFD700,
        transparent: true,
        opacity: 0.6,
        flatShading: true
    });
    const fishingMesh = new THREE.Mesh(fishingRipple, fishingMaterial);
    fishingMesh.position.set(0, actualHeight + 0.02, 0);
    fishingMesh.userData = { 
        type: 'fishing_spot',
        interactive: true,
        animationType: 'pulse'
    };
    
    tileGroup.add(fishingMesh);
    console.log(`🎣 Water System: Added fishing spot at (${tileX}, ${tileY})`);
}

function addBridgeOpportunity(tileGroup, tileX, tileY, actualHeight) {
    // Create bridge foundation markers
    const foundationGeometry = new THREE.BoxGeometry(0.2, 0.1, 0.2);
    const foundationMaterial = new THREE.MeshLambertMaterial({
        color: 0x8B4513,
        flatShading: true
    });
    
    // Two foundation points
    for (let i = 0; i < 2; i++) {
        const foundation = new THREE.Mesh(foundationGeometry, foundationMaterial);
        foundation.position.set(
            (i - 0.5) * 1.5,
            actualHeight + 0.05,
            0
        );
        foundation.userData = { 
            type: 'bridge_foundation',
            buildable: true
        };
        tileGroup.add(foundation);
    }
    
    console.log(`🌉 Water System: Added bridge opportunity at (${tileX}, ${tileY})`);
}

function addTreasureHint(tileGroup, tileX, tileY, actualHeight) {
    // Create subtle treasure glint
    const glintGeometry = new THREE.SphereGeometry(0.05, 6, 4);
    const glintMaterial = new THREE.MeshLambertMaterial({
        color: 0xFFD700,
        transparent: true,
        opacity: 0.7,
        flatShading: true
    });
    const glint = new THREE.Mesh(glintGeometry, glintMaterial);
    glint.position.set(
        (Math.random() - 0.5) * 1.5,
        actualHeight + 0.01,
        (Math.random() - 0.5) * 1.5
    );
    glint.userData = { 
        type: 'treasure_hint',
        searchable: true,
        animationType: 'twinkle'
    };
    
    tileGroup.add(glint);
    console.log(`💰 Water System: Added treasure hint at (${tileX}, ${tileY})`);
}

// Animation function for water tiles
function animateWaters(deltaTime) {
    const time = Date.now() * 0.001; // Current time in seconds
    
    waterGroups.forEach(waterGroup => {
        if (!waterGroup || !waterGroup.children) return;
        
        waterGroup.children.forEach(child => {
            if (!child.userData) return;
            
            const animData = child.userData;
            
            switch (animData.animationType) {
                case 'gentle_wave':
                    // Gentle oscillating motion for lake waves
                    child.position.y = child.position.y + 
                        Math.sin(time * animData.speed + animData.flowOffset || 0) * animData.amplitude;
                    child.rotation.z = Math.sin(time * animData.speed * 0.5) * 0.05;
                    break;
                    
                case 'calm_ripple':
                    // Subtle scaling for pond ripples
                    const rippleScale = 1 + Math.sin(time * animData.speed) * 0.1;
                    child.scale.set(rippleScale, 1, rippleScale);
                    break;
                    
                case 'flow_wave':
                    // Flowing motion for river waves
                    child.position.z = child.position.z + 
                        Math.sin(time * animData.speed + (animData.flowOffset || 0)) * animData.amplitude;
                    child.rotation.y = time * 0.5 + (animData.flowOffset || 0);
                    break;
                    
                case 'pulse':
                    // Pulsing for fishing spots
                    const pulseScale = 1 + Math.sin(time * 2) * 0.2;
                    child.scale.set(pulseScale, 1, pulseScale);
                    child.material.opacity = 0.4 + Math.sin(time * 3) * 0.2;
                    break;
                    
                case 'twinkle':
                    // Twinkling for treasure hints
                    child.material.opacity = 0.3 + Math.sin(time * 4 + Math.random()) * 0.4;
                    child.rotation.y += deltaTime * 2;
                    break;
            }
        });
    });
}

// Utility functions
function getWaterTypeName(terrainChar) {
    switch (terrainChar) {
        case 'L': return 'Lake';
        case 'N': return 'Pond';
        case 'V': return 'River';
        default: return 'Water';
    }
}

function clearWaters() {
    console.log('🌊 Water System: Clearing all water tiles...');
    
    waterGroups.forEach(waterGroup => {
        if (waterGroup.parent) {
            waterGroup.parent.remove(waterGroup);
        }
        
        // Dispose of geometries and materials
        waterGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => { if (m.dispose) m.dispose(); });
                } else if (child.material.dispose) {
                    child.material.dispose();
                }
            }
        });
    });
    
    waterGroups.length = 0;
    waterTileInstances.clear();
    
    console.log('🌊 Water System: All water tiles cleared');
}

function disposeWaterSystem() {
    console.log('🌊 Water System: Disposing water system...');
    
    clearWaters();
    
    // Dispose of cached materials
    Object.values(waterMaterials).forEach(material => {
        if (material.dispose) material.dispose();
    });
    waterMaterials = {};
    
    // Clear animation mixers if any
    waterAnimationMixers.forEach(mixer => {
        if (mixer.stopAllAction) mixer.stopAllAction();
    });
    waterAnimationMixers.length = 0;
    
    console.log('🌊 Water System: Disposal complete');
}

// Export functions for global access
if (typeof window !== 'undefined') {
    window.addWaterToTile = addWaterToTile;
    window.getWaterGeometry = getWaterGeometry;
    window.getWaterTrunkMaterial = getWaterTrunkMaterial;
    window.getWaterWaveMaterial = getWaterWaveMaterial;
    window.createLakeWaterGeometry = createLakeWaterGeometry;
    window.createPondWaterGeometry = createPondWaterGeometry;
    window.createRiverWaterGeometry = createRiverWaterGeometry;
    window.animateWaters = animateWaters;
    window.clearWaters = clearWaters;
    window.disposeWaterSystem = disposeWaterSystem;
    window.getWaterTypeName = getWaterTypeName;
}

console.log("🌊 Low-Poly Isometric Water System loaded successfully!");
