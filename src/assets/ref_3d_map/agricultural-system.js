// 3d/agricultural-system.js
// Agricultural 3D elements for farm and agriculture terrain tiles - Isometric Low-Poly Style

/**
 * Adds agricultural elements to agriculture terrain tiles (A)
 * @param {THREE.Group} tileGroup - The tile group to add elements to
 * @param {string} terrainChar - The terrain character
 * @param {number} x - Grid X coordinate
 * @param {number} y - Grid Y coordinate
 * @param {number} actualHeight - The actual height of the tile
 */
function addAgricultureToTile(tileGroup, terrainChar, x, y, actualHeight) {
    if (terrainChar !== 'A') return;

    // Only add agricultural elements occasionally for performance
    if (Math.random() > 0.3) return;

    // Create low-poly crop field patches
    const numCrops = Math.floor(Math.random() * 3) + 1;
    
    for (let i = 0; i < numCrops; i++) {
        // Create crop rows using low-poly geometries
        const cropGeometry = new THREE.BoxGeometry(0.6, 0.08, 0.15);
        const cropMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x7CB342, // Green crop color
            roughness: 0.8,
            metalness: 0.0,
            flatShading: true // Isometric low-poly style
        });
        
        const cropRow = new THREE.Mesh(cropGeometry, cropMaterial);
        
        // Position in organized rows for agricultural feel
        const rowOffset = (i - numCrops/2) * 0.4;
        cropRow.position.x = rowOffset;
        cropRow.position.z = Math.random() * 0.3 - 0.15;
        cropRow.position.y = actualHeight / 2 + 0.04 - (HEX_HEIGHT_3D / 2);
        cropRow.rotation.y = Math.random() * 0.2 - 0.1; // Slight rotation for organic feel
        
        cropRow.castShadow = true;
        cropRow.receiveShadow = true;
        tileGroup.add(cropRow);
    }

    // Add low-poly irrigation channels
    if (Math.random() < 0.3) {
        const channelGeometry = new THREE.BoxGeometry(1.2, 0.02, 0.1);
        const channelMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x4FC3F7, // Water blue
            roughness: 0.2,
            metalness: 0.1,
            flatShading: true
        });
        
        const channel = new THREE.Mesh(channelGeometry, channelMaterial);
        channel.position.y = actualHeight / 2 + 0.01 - (HEX_HEIGHT_3D / 2);
        channel.rotation.y = Math.random() * Math.PI;
        channel.castShadow = true;
        tileGroup.add(channel);
    }

    // Occasionally add a small low-poly farm structure
    if (Math.random() < 0.12) {
        const barnGeometry = new THREE.BoxGeometry(0.3, 0.25, 0.25);
        const barnMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8D6E63, // Brown barn color
            roughness: 0.9,
            metalness: 0.0,
            flatShading: true // Low-poly style
        });
        
        const barn = new THREE.Mesh(barnGeometry, barnMaterial);
        barn.position.y = actualHeight / 2 + 0.15 - (HEX_HEIGHT_3D / 2);
        barn.position.x = (Math.random() - 0.5) * HEX_RADIUS_3D * 0.6;
        barn.position.z = (Math.random() - 0.5) * HEX_RADIUS_3D * 0.6;
        
        barn.castShadow = true;
        tileGroup.add(barn);
    }

    // Add some fence posts occasionally
    if (Math.random() < 0.3) {
        const numPosts = Math.floor(Math.random() * 2) + 1;
        for (let i = 0; i < numPosts; i++) {
            const postGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.2);
            const postMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x5D4037, // Dark brown post
                roughness: 0.9,
                metalness: 0.0
            });
            
            const post = new THREE.Mesh(postGeometry, postMaterial);
            const angle = (Math.random() * Math.PI * 2);
            const distance = Math.random() * (HEX_RADIUS_3D * 0.5);
            post.position.x = Math.cos(angle) * distance;
            post.position.z = Math.sin(angle) * distance;
            post.position.y = actualHeight / 2 + 0.1 - (HEX_HEIGHT_3D / 2);
            
            post.castShadow = true;
            tileGroup.add(post);
        }
    }
}

// Make function globally available
if (typeof window !== 'undefined') {
    window.addAgricultureToTile = addAgricultureToTile;
}

console.log("Agricultural system loaded successfully");
