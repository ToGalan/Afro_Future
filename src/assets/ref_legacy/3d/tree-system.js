// 3d/tree-system.js - Low Poly Polygonal Isometric Tree System

// Tree system variables
var treeMaterials = {};
var treeAnimationMixers = [];
var treeGroups = [];

// Tree geometry creation functions
function createOakTreeGeometry() {
    const group = new THREE.Group();
    
    // Oak tree trunk - cylindrical with slight taper (2x bigger)
    const trunkGeometry = new THREE.CylinderGeometry(
        HEX_RADIUS_3D * 0.16,  // top radius (original 0.08, now 2x = 0.16)
        HEX_RADIUS_3D * 0.24,  // bottom radius (original 0.12, now 2x = 0.24)
        HEX_RADIUS_3D * 1.2,   // height (original 0.6, now 2x = 1.2)
        8                      // radial segments for low poly look
    );
    const trunkMesh = new THREE.Mesh(trunkGeometry);
    trunkMesh.position.y = HEX_RADIUS_3D * 0.6; // Position trunk base at ground (original 0.3, now 2x = 0.6)
    group.add(trunkMesh);
    
    // Oak canopy - multiple sphere clusters for full, rounded look (2x bigger)
    const canopyMain = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.7, 8, 6); // Low poly sphere (original 0.35, now 2x = 0.7)
    const canopyMainMesh = new THREE.Mesh(canopyMain);
    canopyMainMesh.position.set(0, HEX_RADIUS_3D * 1.4, 0); // (original 0.7, now 2x = 1.4)
    canopyMainMesh.scale.set(1.2, 1.0, 1.2);
    group.add(canopyMainMesh);
    
    // Additional canopy clusters (2x bigger)
    const canopyCluster1 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.5, 6, 5); // (original 0.25, now 2x = 0.5)
    const canopyMesh1 = new THREE.Mesh(canopyCluster1);
    canopyMesh1.position.set(-HEX_RADIUS_3D * 0.3, HEX_RADIUS_3D * 1.6, HEX_RADIUS_3D * 0.2); // (original -0.15, 0.8, 0.1, now 2x = -0.3, 1.6, 0.2)
    group.add(canopyMesh1);
    
    const canopyCluster2 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.4, 6, 5); // (original 0.2, now 2x = 0.4)
    const canopyMesh2 = new THREE.Mesh(canopyCluster2);
    canopyMesh2.position.set(HEX_RADIUS_3D * 0.4, HEX_RADIUS_3D * 1.5, -HEX_RADIUS_3D * 0.1); // (original 0.2, 0.75, -0.05, now 2x = 0.4, 1.5, -0.1)
    group.add(canopyMesh2);
    
    return group;
}

function createPineTreeGeometry() {
    const group = new THREE.Group();
    
    // Pine tree trunk - taller and thinner (bigger than oak, now 2.5x scale)
    const trunkGeometry = new THREE.CylinderGeometry(
        HEX_RADIUS_3D * 0.15,  // top radius - thinner (increased from 0.12 to 0.15)
        HEX_RADIUS_3D * 0.25,  // bottom radius (increased from 0.2 to 0.25)
        HEX_RADIUS_3D * 2.0,   // height - much taller (increased from 1.6 to 2.0)
        6                      // fewer segments for angular look
    );
    const trunkMesh = new THREE.Mesh(trunkGeometry);
    trunkMesh.position.y = HEX_RADIUS_3D * 1.0; // (increased from 0.8 to 1.0)
    group.add(trunkMesh);
    
    // Pine canopy - layered cone sections for classic pine shape (bigger than oak)
    const coneBottom = new THREE.ConeGeometry(HEX_RADIUS_3D * 0.85, HEX_RADIUS_3D * 1.0, 8); // (increased from 0.7, 0.8)
    const coneBottomMesh = new THREE.Mesh(coneBottom);
    coneBottomMesh.position.set(0, HEX_RADIUS_3D * 1.5, 0); // (increased from 1.2)
    group.add(coneBottomMesh);
    
    const coneMiddle = new THREE.ConeGeometry(HEX_RADIUS_3D * 0.68, HEX_RADIUS_3D * 0.85, 8); // (increased from 0.56, 0.7)
    const coneMiddleMesh = new THREE.Mesh(coneMiddle);
    coneMiddleMesh.position.set(0, HEX_RADIUS_3D * 2.0, 0); // (increased from 1.6)
    group.add(coneMiddleMesh);
    
    const coneTop = new THREE.ConeGeometry(HEX_RADIUS_3D * 0.5, HEX_RADIUS_3D * 0.75, 8); // (increased from 0.4, 0.6)
    const coneTopMesh = new THREE.Mesh(coneTop);
    coneTopMesh.position.set(0, HEX_RADIUS_3D * 2.5, 0); // (increased from 2.0)
    group.add(coneTopMesh);
    
    return group;
}

function createBaobabTreeGeometry() {
    const group = new THREE.Group();
    
    // Baobab trunk - iconic massive bottle-shaped trunk (enhanced Pokemon style)
    const trunkGeometry = new THREE.CylinderGeometry(
        HEX_RADIUS_3D * 0.3,   // top radius - narrower top for bottle shape
        HEX_RADIUS_3D * 0.8,   // bottom radius - much wider base (was 0.6, now 0.8)
        HEX_RADIUS_3D * 1.6,   // height - taller (was 1.4, now 1.6)
        6                      // fewer segments for more angular, distinctive look
    );
    const trunkMesh = new THREE.Mesh(trunkGeometry);
    trunkMesh.position.y = HEX_RADIUS_3D * 0.8; // (was 0.7, now 0.8)
    trunkMesh.scale.set(1.2, 1.0, 1.0); // Wider and more prominent
    group.add(trunkMesh);
    
    // Baobab canopy - iconic sparse, flat-topped crown with multiple small clusters
    const canopyMain = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.3, 6, 4); // Smaller main canopy
    const canopyMainMesh = new THREE.Mesh(canopyMain);
    canopyMainMesh.position.set(0, HEX_RADIUS_3D * 1.8, 0); // Higher position
    canopyMainMesh.scale.set(1.5, 0.4, 1.3); // Very flat and spread out
    group.add(canopyMainMesh);
    
    // Multiple sparse branch clusters - authentic baobab look
    const branch1 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.15, 4, 3);
    const branchMesh1 = new THREE.Mesh(branch1);
    branchMesh1.position.set(-HEX_RADIUS_3D * 0.6, HEX_RADIUS_3D * 1.7, HEX_RADIUS_3D * 0.2);
    branchMesh1.scale.set(1.0, 0.6, 1.0);
    group.add(branchMesh1);
    
    const branch2 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.12, 4, 3);
    const branchMesh2 = new THREE.Mesh(branch2);
    branchMesh2.position.set(HEX_RADIUS_3D * 0.5, HEX_RADIUS_3D * 1.6, -HEX_RADIUS_3D * 0.3);
    branchMesh2.scale.set(0.8, 0.5, 0.9);
    group.add(branchMesh2);
    
    const branch3 = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.1, 4, 3);
    const branchMesh3 = new THREE.Mesh(branch3);
    branchMesh3.position.set(HEX_RADIUS_3D * 0.2, HEX_RADIUS_3D * 1.9, HEX_RADIUS_3D * 0.4);
    branchMesh3.scale.set(0.7, 0.4, 0.8);
    group.add(branchMesh3);
    
    return group;
}

// Tree selection based on terrain and position
function getTreeGeometry(terrainChar, tileX, tileY) {
    // Use pseudo-random selection based on tile coordinates
    const hash = ((tileX * 73) + (tileY * 37)) % 100;
      if (terrainChar === 'F') {
        // Forest - pine trees are primary (biggest), with some oak for variety
        if (hash < 60) {
            return createPineTreeGeometry();  // 60% pine (primary forest tree)
        } else if (hash < 85) {
            return createOakTreeGeometry();   // 25% oak
        } else {
            return createPineTreeGeometry();  // 15% more pine for dominance
        }
    } else if (terrainChar === 'J') {
        // Jungle - mix of oak and baobab, with some pine
        if (hash < 25) {
            return createBaobabTreeGeometry(); // 25% baobab (more prominent in jungle)
        } else if (hash < 65) {
            return createOakTreeGeometry();    // 40% oak (dense jungle)
        } else {
            return createPineTreeGeometry();   // 35% pine (tall canopy)
        }
    }
    
    // Default fallback
    return createOakTreeGeometry();
}

// Tree materials
function getTreeTrunkMaterial(treeType = 'default') {
    if (treeType === 'baobab') {
        // Baobab-specific trunk material - lighter, more weathered bark
        if (!treeMaterials.baobabTrunk) {
            treeMaterials.baobabTrunk = new THREE.MeshStandardMaterial({
                color: 0xA0522D,        // Sienna - lighter brown for baobab
                roughness: 0.95,
                metalness: 0.0,
                transparent: false,
                opacity: 1.0
            });
        }
        return treeMaterials.baobabTrunk;
    }
    
    if (!treeMaterials.trunk) {
        treeMaterials.trunk = new THREE.MeshStandardMaterial({
            color: 0x8B4513,        // Saddle brown
            roughness: 0.9,
            metalness: 0.0,
            transparent: false,
            opacity: 1.0
        });
    }
    return treeMaterials.trunk;
}

function getTreeCanopyMaterial(terrainChar, treeType = 'default') {
    if (treeType === 'baobab') {
        // Baobab-specific canopy material - sparse, dry-season look
        if (!treeMaterials.baobabCanopy) {
            treeMaterials.baobabCanopy = new THREE.MeshStandardMaterial({
                color: 0x8FBC8F,    // Dark sea green - muted, sparse foliage
                roughness: 0.85,
                metalness: 0.0,
                transparent: false,
                opacity: 1.0
            });
        }
        return treeMaterials.baobabCanopy;
    }
    
    if (terrainChar === 'F') {
        // Forest - darker, temperate green
        if (!treeMaterials.forestCanopy) {
            treeMaterials.forestCanopy = new THREE.MeshStandardMaterial({
                color: 0x228B22,    // Forest green
                roughness: 0.8,
                metalness: 0.0,
                transparent: false,
                opacity: 1.0
            });
        }
        return treeMaterials.forestCanopy;
    } else if (terrainChar === 'J') {
        // Jungle - brighter, tropical green
        if (!treeMaterials.jungleCanopy) {
            treeMaterials.jungleCanopy = new THREE.MeshStandardMaterial({
                color: 0x32CD32,    // Lime green
                roughness: 0.7,
                metalness: 0.0,
                transparent: false,
                opacity: 1.0
            });
        }
        return treeMaterials.jungleCanopy;
    }
    
    // Default forest green
    return getTreeCanopyMaterial('F');
}

// Main function to add trees to tiles
function addTreeToTile(tileGroup, terrainChar, tileX, tileY, actualHeight) {
    // Only add trees to forest and jungle tiles
    if (terrainChar !== 'F' && terrainChar !== 'J') {
        return;
    }
    
    // Create tree geometry and determine tree type
    const treeGroup = getTreeGeometry(terrainChar, tileX, tileY);
    
    // Detect tree type based on geometry characteristics
    let treeType = 'default';
    const firstChild = treeGroup.children[0];
    if (firstChild && firstChild.geometry.type === 'CylinderGeometry') {
        // Check trunk dimensions to identify baobab (wider trunk)
        const trunkGeo = firstChild.geometry;
        if (trunkGeo.parameters.radiusBottom > HEX_RADIUS_3D * 0.7) {
            treeType = 'baobab';
        }
    }
    
    // Get appropriate materials for this tree type
    const trunkMaterial = getTreeTrunkMaterial(treeType);
    const canopyMaterial = getTreeCanopyMaterial(terrainChar, treeType);
    
    // Apply materials to tree parts
    treeGroup.children.forEach(child => {
        if (child.geometry.type === 'CylinderGeometry') {
            // This is a trunk
            child.material = trunkMaterial;
        } else {
            // This is canopy (sphere or cone)
            child.material = canopyMaterial;
        }
    });
    
    // Position the tree on the tile
    treeGroup.position.set(0, actualHeight, 0);
    
    // Add slight random rotation for natural variation
    const rotationHash = ((tileX * 91) + (tileY * 47)) % 360;
    treeGroup.rotation.y = (rotationHash * Math.PI) / 180;
    
    // Add random scale variation (90% to 110%)
    const scaleHash = ((tileX * 67) + (tileY * 83)) % 20;
    const scale = 0.9 + (scaleHash / 100); // 0.9 to 1.1
    treeGroup.scale.setScalar(scale);
    
    // Add the tree to the tile group
    tileGroup.add(treeGroup);
    
    // Store reference for potential animations
    treeGroups.push(treeGroup);
}

// Animation function for trees (gentle swaying)
function animateTrees(deltaTime) {
    const time = Date.now() * 0.001; // Convert to seconds
    
    treeGroups.forEach((treeGroup, index) => {
        // Create slight swaying motion
        const swaySpeed = 0.5 + (index % 3) * 0.1; // Vary speed slightly
        const swayAmount = 0.02; // Very subtle sway
        
        treeGroup.rotation.z = Math.sin(time * swaySpeed + index) * swayAmount;
        treeGroup.rotation.x = Math.cos(time * swaySpeed * 0.7 + index) * swayAmount * 0.5;
    });
}

// Cleanup function
function clearTrees() {
    treeGroups.length = 0;
    // Materials will be reused, so no need to dispose unless completely cleaning up
}

// Export to global scope for integration
if (typeof window !== 'undefined') {
    window.addTreeToTile = addTreeToTile;
    window.animateTrees = animateTrees;
    window.clearTrees = clearTrees;
}
