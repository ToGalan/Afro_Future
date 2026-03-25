// 3d/rocky-system.js
// Rocky terrain 3D elements for rocky terrain tiles

/**
 * Adds rocky elements to rocky terrain tiles (R)
 * @param {THREE.Group} tileGroup - The tile group to add elements to
 * @param {string} terrainChar - The terrain character
 * @param {number} x - Grid X coordinate
 * @param {number} y - Grid Y coordinate
 * @param {number} actualHeight - The actual height of the tile
 */
function addRockyToTile(tileGroup, terrainChar, x, y, actualHeight) {
    if (terrainChar !== 'R') return;

    // Only add rocky elements occasionally for performance
    if (Math.random() > 0.5) return;

    // Add various sized rocks and boulders
    const numRocks = Math.floor(Math.random() * 4) + 2;
    
    for (let i = 0; i < numRocks; i++) {
        // Create irregularly shaped rocks using dodecahedron geometry
        const rockSize = 0.1 + Math.random() * 0.2;
        const rockGeometry = new THREE.DodecahedronGeometry(rockSize);
        const rockMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x616161, // Grey rock
            roughness: 0.9,
            metalness: 0.1
        });
        
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        
        // Position randomly within the hex
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (HEX_RADIUS_3D * 0.6);
        rock.position.x = Math.cos(angle) * distance;
        rock.position.z = Math.sin(angle) * distance;
        rock.position.y = actualHeight / 2 + rockSize - (HEX_HEIGHT_3D / 2);
        
        // Random rotation for natural look
        rock.rotation.x = Math.random() * Math.PI * 2;
        rock.rotation.y = Math.random() * Math.PI * 2;
        rock.rotation.z = Math.random() * Math.PI * 2;
        
        rock.castShadow = true;
        rock.receiveShadow = true;
        tileGroup.add(rock);
    }

    // Add some larger boulder occasionally
    if (Math.random() < 0.3) {
        const boulderSize = 0.25 + Math.random() * 0.15;
        const boulderGeometry = new THREE.IcosahedronGeometry(boulderSize);
        const boulderMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x424242, // Darker grey boulder
            roughness: 0.95,
            metalness: 0.05
        });
        
        const boulder = new THREE.Mesh(boulderGeometry, boulderMaterial);
        boulder.position.x = (Math.random() - 0.5) * HEX_RADIUS_3D * 0.4;
        boulder.position.z = (Math.random() - 0.5) * HEX_RADIUS_3D * 0.4;
        boulder.position.y = actualHeight / 2 + boulderSize - (HEX_HEIGHT_3D / 2);
        
        // Random rotation
        boulder.rotation.x = Math.random() * Math.PI * 2;
        boulder.rotation.y = Math.random() * Math.PI * 2;
        boulder.rotation.z = Math.random() * Math.PI * 2;
        
        boulder.castShadow = true;
        boulder.receiveShadow = true;
        tileGroup.add(boulder);
    }

    // Add some small pebbles scattered around
    const numPebbles = Math.floor(Math.random() * 6) + 3;
    for (let i = 0; i < numPebbles; i++) {
        const pebbleSize = 0.02 + Math.random() * 0.04;
        const pebbleGeometry = new THREE.OctahedronGeometry(pebbleSize);
        const pebbleMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x757575, // Light grey pebbles
            roughness: 0.8,
            metalness: 0.1
        });
        
        const pebble = new THREE.Mesh(pebbleGeometry, pebbleMaterial);
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (HEX_RADIUS_3D * 0.8);
        pebble.position.x = Math.cos(angle) * distance;
        pebble.position.z = Math.sin(angle) * distance;
        pebble.position.y = actualHeight / 2 + pebbleSize - (HEX_HEIGHT_3D / 2);
        
        pebble.rotation.x = Math.random() * Math.PI * 2;
        pebble.rotation.y = Math.random() * Math.PI * 2;
        pebble.rotation.z = Math.random() * Math.PI * 2;
        
        pebble.castShadow = true;
        tileGroup.add(pebble);
    }

    // Occasionally add some hardy desert vegetation
    if (Math.random() < 0.2) {
        const shrubGeometry = new THREE.ConeGeometry(0.08, 0.12, 6);
        const shrubMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x558B2F, // Dark green hardy plant
            roughness: 0.8,
            metalness: 0.0
        });
        
        const shrub = new THREE.Mesh(shrubGeometry, shrubMaterial);
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (HEX_RADIUS_3D * 0.5);
        shrub.position.x = Math.cos(angle) * distance;
        shrub.position.z = Math.sin(angle) * distance;
        shrub.position.y = actualHeight / 2 + 0.06 - (HEX_HEIGHT_3D / 2);
        
        shrub.castShadow = true;
        tileGroup.add(shrub);
    }
}

// Make function globally available
if (typeof window !== 'undefined') {
    window.addRockyToTile = addRockyToTile;
}

console.log("Rocky terrain system loaded successfully");
