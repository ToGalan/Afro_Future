// 3d/cloud-system.js - Enhanced 3D Cloud System with Animations

// Cloud system variables
var cloudMaterials = {};
var cloudAnimationMixers = [];
var cloudGroups = [];

// Cloud geometry creation functions
function createSunnyCloud1Geometry() {
    const group = new THREE.Group();
    
    // Main cloud body - larger center sphere
    const mainSphere = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.6, 8, 6); // Bigger spheres
    const mainMesh = new THREE.Mesh(mainSphere);
    mainMesh.position.set(0, 0, 0);
    mainMesh.scale.set(1.5, 1.0, 1.2); // Bigger scale
    group.add(mainMesh);
    
    // Side puffs
    const sideSphere1 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.45, 8, 6);
    const sideMesh1 = new THREE.Mesh(sideSphere1);
    sideMesh1.position.set(-HEX_RADIUS_3D * 0.6, 0, 0);
    sideMesh1.scale.set(1.1, 0.9, 1.0);
    group.add(sideMesh1);
    
    const sideSphere2 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.4, 8, 6);
    const sideMesh2 = new THREE.Mesh(sideSphere2);
    sideMesh2.position.set(HEX_RADIUS_3D * 0.5, 0, 0);
    sideMesh2.scale.set(1.0, 0.8, 0.9);
    group.add(sideMesh2);
    
    return group;
}

function createSunnyCloud2Geometry() {
    const group = new THREE.Group();
    
    // Different shaped sunny cloud
    const mainSphere = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.55, 8, 6);
    const mainMesh = new THREE.Mesh(mainSphere);
    mainMesh.position.set(0, 0, 0);
    mainMesh.scale.set(1.8, 0.9, 1.4); // Bigger and flatter
    group.add(mainMesh);
    
    // Multiple smaller puffs
    const puff1 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.3, 6, 4);
    const puffMesh1 = new THREE.Mesh(puff1);
    puffMesh1.position.set(-HEX_RADIUS_3D * 0.45, HEX_RADIUS_3D * 0.15, 0);
    puffMesh1.scale.set(1.0, 0.8, 1.0);
    group.add(puffMesh1);
    
    const puff2 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.28, 6, 4);
    const puffMesh2 = new THREE.Mesh(puff2);
    puffMesh2.position.set(HEX_RADIUS_3D * 0.6, HEX_RADIUS_3D * 0.08, 0);
    puffMesh2.scale.set(0.9, 0.7, 0.9);
    group.add(puffMesh2);
    
    const puff3 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.22, 6, 4);
    const puffMesh3 = new THREE.Mesh(puff3);
    puffMesh3.position.set(0, HEX_RADIUS_3D * 0.25, HEX_RADIUS_3D * 0.3);
    puffMesh3.scale.set(0.8, 0.6, 0.8);
    group.add(puffMesh3);
    
    return group;
}

function createCloudyCloudGeometry() {
    const group = new THREE.Group();
    
    // Larger, darker, more ominous cloud
    const mainSphere = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.7, 8, 6);
    const mainMesh = new THREE.Mesh(mainSphere);
    mainMesh.position.set(0, 0, 0);
    mainMesh.scale.set(1.6, 1.3, 1.5); // Bigger and more imposing
    group.add(mainMesh);
    
    // Multiple overlapping puffs for density
    for (let i = 0; i < 6; i++) { // More puffs for denser clouds
        const angle = (i / 6) * Math.PI * 2;
        const puffGeo = new THREE.SphereGeometry(HEX_RADIUS_3D * (0.35 + Math.random() * 0.15), 6, 5);
        const puffMesh = new THREE.Mesh(puffGeo);
        const radius = HEX_RADIUS_3D * 0.45;
        puffMesh.position.set(
            Math.cos(angle) * radius,
            Math.random() * HEX_RADIUS_3D * 0.2,
            Math.sin(angle) * radius
        );
        puffMesh.scale.set(
            1.0 + Math.random() * 0.4,
            0.8 + Math.random() * 0.4,
            1.0 + Math.random() * 0.4
        );
        group.add(puffMesh);
    }
    
    return group;
}

function getCloudGeometry(terrainChar, tileX, tileY) {
    // Determine cloud type based on terrain and some randomness
    if (terrainChar === 'M' || terrainChar === 'V') {
        // Mountains and volcanic areas get cloudy clouds
        return createCloudyCloudGeometry();
    } else {
        // Other terrains get sunny clouds with variety
        const hash = ((tileX * 73) + (tileY * 37)) % 100;
        if (hash < 50) {
            return createSunnyCloud1Geometry();
        } else {
            return createSunnyCloud2Geometry();
        }
    }
}

function getCloudMaterial(terrainChar) {
    if (terrainChar === 'M' || terrainChar === 'V') {
        // Cloudy/stormy clouds - darker and fully opaque
        if (!cloudMaterials.cloudy) {
            cloudMaterials.cloudy = new THREE.MeshStandardMaterial({
                color: 0x666666,
                roughness: 0.9,
                metalness: 0.0,
                transparent: false,
                opacity: 1.0
            });
        }
        return cloudMaterials.cloudy;
    } else {
        // Sunny clouds - bright white and fully opaque
        if (!cloudMaterials.sunny) {
            cloudMaterials.sunny = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.8,
                metalness: 0.0,
                transparent: false,
                opacity: 1.0
            });
        }
        return cloudMaterials.sunny;
    }
}

// Enhanced cloud positioning - higher in the sky
function addCloudToTile(tileGroup, terrainChar, tileX, tileY, actualHeight) {
    // Create cloud geometry and material
    const cloudGroup = getCloudGeometry(terrainChar, tileX, tileY);
    const cloudMaterial = getCloudMaterial(terrainChar);
    
    // Apply material to all cloud parts
    cloudGroup.children.forEach(child => {
        child.material = cloudMaterial;
        child.castShadow = false; // Clouds don't cast shadows for performance
        child.receiveShadow = false;
    });
    
    // Position cloud much higher in the sky
    const skyHeight = actualHeight + HEX_RADIUS_3D * 6.0; // Much higher
    cloudGroup.position.set(0, skyHeight - (HEX_HEIGHT_3D / 2), 0);
    
    // Add slight random rotation for variety
    const cloudRotationY = ((tileX * 73) + (tileY * 37)) % 360 * (Math.PI / 180);
    cloudGroup.rotation.y = cloudRotationY;
    
    // Store reference for animation and FOV visibility
    cloudGroup.userData = {
        terrainChar: terrainChar,
        tileX: tileX,
        tileY: tileY,
        baseRotationY: cloudRotationY,
        animationOffset: Math.random() * Math.PI * 2,
        driftSpeed: 0.1 + Math.random() * 0.2,
        isCloud: true // Flag for FOV system
    };
    
    // Add cloud to tile group
    tileGroup.add(cloudGroup);
    
    // Track for animation
    cloudGroups.push(cloudGroup);
    
    // Store cloud reference in tile group for FOV visibility control
    if (!tileGroup.userData.cloudMesh) {
        tileGroup.userData.cloudMesh = cloudGroup;
    }
    
    return cloudGroup;
}

// Animation system for clouds
function animateClouds(deltaTime = 0.016) {
    const time = Date.now() * 0.001;
    
    cloudGroups.forEach(cloudGroup => {
        if (!cloudGroup.userData) return;
        
        const { animationOffset, driftSpeed, baseRotationY } = cloudGroup.userData;
        
        // Gentle floating motion
        const floatOffset = Math.sin(time * 0.5 + animationOffset) * 0.2;
        cloudGroup.position.y += floatOffset * deltaTime * 10;
        
        // Slow rotation drift
        cloudGroup.rotation.y = baseRotationY + (time * driftSpeed * 0.1);
        
        // Subtle scale breathing
        const breathScale = 1.0 + Math.sin(time * 0.3 + animationOffset) * 0.05;
        cloudGroup.scale.set(breathScale, breathScale, breathScale);
    });
}

// Cleanup function
function disposeCloudSystem() {
    cloudGroups.forEach(cloudGroup => {
        cloudGroup.children.forEach(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    });
    
    cloudGroups.length = 0;
    
    // Dispose materials
    Object.values(cloudMaterials).forEach(material => {
        if (material.dispose) material.dispose();
    });
    cloudMaterials = {};
}

// Export functions for global access
if (typeof window !== 'undefined') {
    window.addCloudToTile = addCloudToTile;
    window.getCloudGeometry = getCloudGeometry;
    window.getCloudMaterial = getCloudMaterial;
    window.createSunnyCloud1Geometry = createSunnyCloud1Geometry;
    window.createSunnyCloud2Geometry = createSunnyCloud2Geometry;
    window.createCloudyCloudGeometry = createCloudyCloudGeometry;
    window.animateClouds = animateClouds;
    window.disposeCloudSystem = disposeCloudSystem;
}

console.log("Enhanced 3D Cloud System loaded successfully!");
