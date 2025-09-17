// 3d/oasis-system.js
// Oasis 3D elements for oasis terrain tiles

/**
 * Adds oasis elements to oasis terrain tiles (O)
 * @param {THREE.Group} tileGroup - The tile group to add elements to
 * @param {string} terrainChar - The terrain character
 * @param {number} x - Grid X coordinate
 * @param {number} y - Grid Y coordinate
 * @param {number} actualHeight - The actual height of the tile
 */
function addOasisToTile(tileGroup, terrainChar, x, y, actualHeight) {
    if (terrainChar !== 'O') return;

    // Add palm trees around the oasis
    const numPalms = Math.floor(Math.random() * 3) + 2;
    
    for (let i = 0; i < numPalms; i++) {
        // Palm trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.08, 0.12, 0.8);
        const trunkMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8D6E63, // Brown trunk
            roughness: 0.9,
            metalness: 0.0
        });
        
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        
        // Position around the edge of the hex
        const angle = (i / numPalms) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        const distance = HEX_RADIUS_3D * (0.6 + Math.random() * 0.2);
        trunk.position.x = Math.cos(angle) * distance;
        trunk.position.z = Math.sin(angle) * distance;
        trunk.position.y = actualHeight / 2 + 0.4 - (HEX_HEIGHT_3D / 2);
        
        // Slight lean for realism
        trunk.rotation.z = (Math.random() - 0.5) * 0.2;
        trunk.rotation.x = (Math.random() - 0.5) * 0.2;
        
        trunk.castShadow = true;
        tileGroup.add(trunk);
        
        // Palm fronds (leaves)
        for (let j = 0; j < 6; j++) {
            const frondGeometry = new THREE.BoxGeometry(0.4, 0.02, 0.08);
            const frondMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x2E7D32, // Dark green
                roughness: 0.7,
                metalness: 0.0
            });
            
            const frond = new THREE.Mesh(frondGeometry, frondMaterial);
            frond.position.copy(trunk.position);
            frond.position.y += 0.4; // Top of trunk
            
            // Spread fronds around and droop them
            const frondAngle = (j / 6) * Math.PI * 2;
            frond.rotation.y = frondAngle;
            frond.rotation.z = -0.3; // Droop down
            frond.position.x += Math.cos(frondAngle) * 0.1;
            frond.position.z += Math.sin(frondAngle) * 0.1;
            
            frond.castShadow = true;
            tileGroup.add(frond);
        }
    }

    // Add small water pool in the center
    const poolGeometry = new THREE.CylinderGeometry(HEX_RADIUS_3D * 0.3, HEX_RADIUS_3D * 0.3, 0.05);
    const poolMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x2196F3, // Blue water
        roughness: 0.1,
        metalness: 0.2,
        transparent: true,
        opacity: 0.8
    });
    
    const pool = new THREE.Mesh(poolGeometry, poolMaterial);
    pool.position.y = actualHeight / 2 + 0.025 - (HEX_HEIGHT_3D / 2);
    pool.receiveShadow = true;
    tileGroup.add(pool);

    // Add some desert grass around the pool
    const numGrass = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < numGrass; i++) {
        const grassGeometry = new THREE.ConeGeometry(0.02, 0.15, 3);
        const grassMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x689F38, // Desert grass green
            roughness: 0.8,
            metalness: 0.0
        });
        
        const grass = new THREE.Mesh(grassGeometry, grassMaterial);
        const angle = Math.random() * Math.PI * 2;
        const distance = HEX_RADIUS_3D * (0.3 + Math.random() * 0.2);
        grass.position.x = Math.cos(angle) * distance;
        grass.position.z = Math.sin(angle) * distance;
        grass.position.y = actualHeight / 2 + 0.075 - (HEX_HEIGHT_3D / 2);
        
        grass.castShadow = true;
        tileGroup.add(grass);
    }
}

// Make function globally available
if (typeof window !== 'undefined') {
    window.addOasisToTile = addOasisToTile;
}

console.log("Oasis system loaded successfully");
