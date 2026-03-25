// Ensure THREE is available when bundled as an ES module
var THREE = (typeof THREE !== 'undefined') ? THREE : (typeof window !== 'undefined' && window.THREE) ? window.THREE : (typeof globalThis !== 'undefined' ? globalThis.THREE : undefined);
// 3d/hills-system.js
// Hills 3D elements for hilly terrain tiles - Isometric Low-Poly Style

/**
 * Adds hill elements to hilly terrain tiles (H) - looks like smaller mountains
 * @param {THREE.Group} tileGroup - The tile group to add elements to
 * @param {string} terrainChar - The terrain character
 * @param {number} x - Grid X coordinate
 * @param {number} y - Grid Y coordinate
 * @param {number} actualHeight - The actual height of the tile
 */
function addHillsToTile(tileGroup, terrainChar, x, y, actualHeight) {
    if (terrainChar !== 'H') {
        return;
    }

    // Always add hill elements to fill the area - no random skip
    
    // Create multiple smaller mountain-like hills to fill the hex area
    const numHills = Math.floor(Math.random() * 4) + 3; // 3-6 hills per tile
    
    // Use a grid-like distribution to fill the area
    const gridSize = Math.ceil(Math.sqrt(numHills));
    let hillIndex = 0;
    
    for (let gridX = 0; gridX < gridSize && hillIndex < numHills; gridX++) {
        for (let gridZ = 0; gridZ < gridSize && hillIndex < numHills; gridZ++) {
            // Create low-poly hill using cone geometry (like small mountains)
            const hillHeight = 0.3 + Math.random() * 0.5; // Varied heights
            const hillRadius = 0.2 + Math.random() * 0.3;
            
            // Low-poly cone with few segments for isometric style
            const hillGeometry = new THREE.ConeGeometry(hillRadius, hillHeight, 6, 1);
            
            // Hill colors - earthy tones similar to mountains but greener
            const hillColors = [
                0x8BC34A, // Light green
                0x7CB342, // Medium green  
                0x689F38, // Darker green
                0x827717, // Olive green
                0x9E9D24  // Yellow green
            ];
            
            const hillMaterial = new THREE.MeshStandardMaterial({ 
                color: hillColors[Math.floor(Math.random() * hillColors.length)],
                roughness: 0.8,
                metalness: 0.0,
                flatShading: true // Isometric low-poly style
            });
            
            const hill = new THREE.Mesh(hillGeometry, hillMaterial);
            
            // Position in grid pattern with some randomness
            const offsetX = (gridX - gridSize/2 + 0.5) * (HEX_RADIUS_3D * 0.8 / gridSize);
            const offsetZ = (gridZ - gridSize/2 + 0.5) * (HEX_RADIUS_3D * 0.8 / gridSize);
            
            // Add some random variation to avoid perfect grid
            hill.position.x = offsetX + (Math.random() - 0.5) * 0.2;
            hill.position.z = offsetZ + (Math.random() - 0.5) * 0.2;
            hill.position.y = actualHeight / 2 + (hillHeight / 2) - (HEX_HEIGHT_3D / 2);
            
            // Random rotation for variety
            hill.rotation.y = Math.random() * Math.PI * 2;
            
            hill.castShadow = true;
            hill.receiveShadow = true;
            tileGroup.add(hill);
            
            hillIndex++;
        }
    }

    // Add scattered rocks throughout the area to fill gaps
    const numRocks = Math.floor(Math.random() * 6) + 4; // 4-9 rocks per tile
    for (let i = 0; i < numRocks; i++) {
        const rockSize = 0.04 + Math.random() * 0.06;
        const rockGeometry = new THREE.BoxGeometry(rockSize, rockSize * 1.2, rockSize); // Simple box rocks
        const rockMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x795548, // Brown rock
            roughness: 0.9,
            metalness: 0.1,
            flatShading: true
        });
        
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        
        // Distribute rocks randomly across the hex
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (HEX_RADIUS_3D * 0.7);
        rock.position.x = Math.cos(angle) * distance;
        rock.position.z = Math.sin(angle) * distance;
        rock.position.y = actualHeight / 2 + rockSize * 0.6 + 0.02 - (HEX_HEIGHT_3D / 2);
        
        rock.rotation.x = Math.random() * 0.3;
        rock.rotation.y = Math.random() * Math.PI * 2;
        rock.rotation.z = Math.random() * 0.3;
        
        rock.castShadow = true;
        rock.receiveShadow = true;
        tileGroup.add(rock);
    }

    // Add medium-sized rocks to fill intermediate areas
    const numMediumRocks = Math.floor(Math.random() * 8) + 6; // 6-13 medium rocks
    for (let i = 0; i < numMediumRocks; i++) {
        const rockSize = 0.06 + Math.random() * 0.08; // Medium size rocks
        const rockHeight = rockSize * (1.5 + Math.random() * 0.5);
        const rockGeometry = new THREE.BoxGeometry(rockSize, rockHeight, rockSize * 0.9);
        const rockMaterial = new THREE.MeshStandardMaterial({ 
            color: [0x795548, 0x6D4C41, 0x5D4037][Math.floor(Math.random() * 3)], // Varied browns
            roughness: 0.9,
            metalness: 0.1,
            flatShading: true
        });
        
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        
        // Distribute in middle ring to fill gaps
        const angle = Math.random() * Math.PI * 2;
        const distance = (HEX_RADIUS_3D * 0.3) + Math.random() * (HEX_RADIUS_3D * 0.4); // Middle ring
        rock.position.x = Math.cos(angle) * distance;
        rock.position.z = Math.sin(angle) * distance;
        rock.position.y = actualHeight / 2 + rockHeight * 0.5 + 0.01 - (HEX_HEIGHT_3D / 2);
        
        rock.rotation.x = Math.random() * 0.4;
        rock.rotation.y = Math.random() * Math.PI * 2;
        rock.rotation.z = Math.random() * 0.4;
        
        rock.castShadow = true;
        rock.receiveShadow = true;
        tileGroup.add(rock);
    }

    // Add small bumps and mounds to fill remaining areas (increased density)
    const numBumps = Math.floor(Math.random() * 12) + 10; // 10-21 bumps per tile for better coverage
    for (let i = 0; i < numBumps; i++) {
        const bumpRadius = 0.08 + Math.random() * 0.12;
        const bumpHeight = 0.04 + Math.random() * 0.08;
        
        // Create small mounds using flattened spheres
        const bumpGeometry = new THREE.SphereGeometry(bumpRadius, 6, 4);
        bumpGeometry.scale(1, 0.3, 1); // Flatten to create mound effect
        
        const bumpMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8D6E63, // Earthy brown for mounds
            roughness: 0.9,
            metalness: 0.0,
            flatShading: true
        });
        
        const bump = new THREE.Mesh(bumpGeometry, bumpMaterial);
        
        // Distribute bumps to fill empty spaces - increased coverage
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (HEX_RADIUS_3D * 0.9); // Increased coverage area
        bump.position.x = Math.cos(angle) * distance;
        bump.position.z = Math.sin(angle) * distance;
        bump.position.y = actualHeight / 2 + (bumpHeight * 0.15) - (HEX_HEIGHT_3D / 2);
        
        bump.castShadow = true;
        bump.receiveShadow = true;
        tileGroup.add(bump);
    }
    
    // Add more scattered small rocks to completely fill the area (increased density)
    const numExtraRocks = Math.floor(Math.random() * 15) + 15; // 15-29 extra small rocks for complete coverage
    for (let i = 0; i < numExtraRocks; i++) {
        const rockSize = 0.02 + Math.random() * 0.04; // Smaller rocks
        const rockGeometry = new THREE.BoxGeometry(rockSize, rockSize * 1.5, rockSize * 0.8);
        const rockMaterial = new THREE.MeshStandardMaterial({ 
            color: Math.random() > 0.5 ? 0x795548 : 0x6D4C41, // Varied brown rocks
            roughness: 0.95,
            metalness: 0.05,
            flatShading: true
        });
        
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        
        // Fill any remaining space - increased coverage area
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (HEX_RADIUS_3D * 0.95); // Use almost full hex radius
        rock.position.x = Math.cos(angle) * distance;
        rock.position.z = Math.sin(angle) * distance;
        rock.position.y = actualHeight / 2 + rockSize * 0.75 + 0.01 - (HEX_HEIGHT_3D / 2);
        
        rock.rotation.x = Math.random() * 0.5;
        rock.rotation.y = Math.random() * Math.PI * 2;
        rock.rotation.z = Math.random() * 0.5;
        
        rock.castShadow = true;
        rock.receiveShadow = true;
        tileGroup.add(rock);
    }
}

// Make function globally available
if (typeof window !== 'undefined') {
    window.addHillsToTile = addHillsToTile;
}

console.log("Hills system loaded successfully - Full tile coverage with rocks and bumps");
