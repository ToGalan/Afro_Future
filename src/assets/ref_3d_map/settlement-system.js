// 3d/settlement-system.js
// Settlement 3D elements for settlement terrain tiles - Isometric Low-Poly Style

/**
 * Adds settlement elements to settlement terrain tiles (S)
 * @param {THREE.Group} tileGroup - The tile group to add elements to
 * @param {string} terrainChar - The terrain character
 * @param {number} x - Grid X coordinate
 * @param {number} y - Grid Y coordinate
 * @param {number} actualHeight - The actual height of the tile
 */
function addSettlementToTile(tileGroup, terrainChar, x, y, actualHeight) {
    if (terrainChar !== 'S') return;

    // Always add settlement elements since these are special tiles
    
    // Add small low-poly houses/huts
    const numBuildings = Math.floor(Math.random() * 2) + 2;
    
    for (let i = 0; i < numBuildings; i++) {
        // House base - low-poly style
        const houseWidth = 0.18 + Math.random() * 0.12;
        const houseHeight = 0.12 + Math.random() * 0.08;
        const houseDepth = 0.18 + Math.random() * 0.12;
        
        const houseGeometry = new THREE.BoxGeometry(houseWidth, houseHeight, houseDepth);
        const houseMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x8D6E63, // Brown house
            roughness: 0.8,
            metalness: 0.0,
            flatShading: true // Low-poly isometric style
        });
        
        const house = new THREE.Mesh(houseGeometry, houseMaterial);
        
        // Position houses around the hex in organized manner
        const angle = (i / numBuildings) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        const distance = HEX_RADIUS_3D * (0.25 + Math.random() * 0.25);
        house.position.x = Math.cos(angle) * distance;
        house.position.z = Math.sin(angle) * distance;
        house.position.y = actualHeight / 2 + (houseHeight / 2) - (HEX_HEIGHT_3D / 2);
        
        house.castShadow = true;
        house.receiveShadow = true;
        tileGroup.add(house);
        
        // Add low-poly pyramid roof
        const roofGeometry = new THREE.ConeGeometry(Math.max(houseWidth, houseDepth) * 0.8, houseHeight * 0.6, 4);
        const roofMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x5D4037, // Dark brown roof
            roughness: 0.9,
            metalness: 0.0,
            flatShading: true // Low-poly style
        });
        
        const roof = new THREE.Mesh(roofGeometry, roofMaterial);
        roof.position.copy(house.position);
        roof.position.y += houseHeight * 0.8;
        roof.rotation.y = Math.PI / 4; // Diamond-shaped roof
        
        roof.castShadow = true;
        tileGroup.add(roof);
        
        // Add door occasionally
        if (Math.random() < 0.6) {
            const doorGeometry = new THREE.BoxGeometry(0.04, 0.08, 0.01);
            const doorMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x3E2723, // Dark brown door
                roughness: 0.9,
                metalness: 0.0
            });
            
            const door = new THREE.Mesh(doorGeometry, doorMaterial);
            door.position.copy(house.position);
            door.position.y -= houseHeight * 0.2;
            
            // Position door on one side of the house
            const doorSide = Math.random() * Math.PI * 2;
            door.position.x += Math.cos(doorSide) * (houseWidth / 2 + 0.01);
            door.position.z += Math.sin(doorSide) * (houseDepth / 2 + 0.01);
            
            door.castShadow = true;
            tileGroup.add(door);
        }
    }

    // Add a small well or fountain in the center
    if (Math.random() < 0.6) {
        const wellGeometry = new THREE.CylinderGeometry(0.08, 0.1, 0.15);
        const wellMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x616161, // Grey stone well
            roughness: 0.9,
            metalness: 0.1
        });
        
        const well = new THREE.Mesh(wellGeometry, wellMaterial);
        well.position.y = actualHeight / 2 + 0.075 - (HEX_HEIGHT_3D / 2);
        well.position.x = (Math.random() - 0.5) * HEX_RADIUS_3D * 0.2;
        well.position.z = (Math.random() - 0.5) * HEX_RADIUS_3D * 0.2;
        
        well.castShadow = true;
        well.receiveShadow = true;
        tileGroup.add(well);
    }

    // Add some paths between buildings
    const numPaths = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < numPaths; i++) {
        const pathGeometry = new THREE.BoxGeometry(0.8, 0.01, 0.1);
        const pathMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xA1887F, // Light brown path
            roughness: 0.9,
            metalness: 0.0
        });
        
        const path = new THREE.Mesh(pathGeometry, pathMaterial);
        path.position.y = actualHeight / 2 + 0.005 - (HEX_HEIGHT_3D / 2);
        path.rotation.y = Math.random() * Math.PI * 2;
        
        path.receiveShadow = true;
        tileGroup.add(path);
    }

    // Add some vegetation around the settlement
    const numTrees = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < numTrees; i++) {
        // Small settlement tree
        const trunkGeometry = new THREE.CylinderGeometry(0.03, 0.04, 0.2);
        const trunkMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x5D4037, // Brown trunk
            roughness: 0.9,
            metalness: 0.0
        });
        
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        const angle = Math.random() * Math.PI * 2;
        const distance = HEX_RADIUS_3D * (0.7 + Math.random() * 0.2);
        trunk.position.x = Math.cos(angle) * distance;
        trunk.position.z = Math.sin(angle) * distance;
        trunk.position.y = actualHeight / 2 + 0.1 - (HEX_HEIGHT_3D / 2);
        
        trunk.castShadow = true;
        tileGroup.add(trunk);
        
        // Tree crown
        const crownGeometry = new THREE.SphereGeometry(0.12, 6, 4);
        const crownMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x4CAF50, // Green crown
            roughness: 0.8,
            metalness: 0.0
        });
        
        const crown = new THREE.Mesh(crownGeometry, crownMaterial);
        crown.position.copy(trunk.position);
        crown.position.y += 0.15;
        
        crown.castShadow = true;
        tileGroup.add(crown);
    }

    // Add some farming plots occasionally
    if (Math.random() < 0.4) {
        const plotGeometry = new THREE.BoxGeometry(0.3, 0.02, 0.3);
        const plotMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x6D4C41, // Brown soil
            roughness: 0.9,
            metalness: 0.0
        });
        
        const plot = new THREE.Mesh(plotGeometry, plotMaterial);
        const angle = Math.random() * Math.PI * 2;
        const distance = HEX_RADIUS_3D * (0.5 + Math.random() * 0.3);
        plot.position.x = Math.cos(angle) * distance;
        plot.position.z = Math.sin(angle) * distance;
        plot.position.y = actualHeight / 2 + 0.01 - (HEX_HEIGHT_3D / 2);
        
        plot.receiveShadow = true;
        tileGroup.add(plot);
        
        // Add some crops in the plot
        const numCrops = Math.floor(Math.random() * 4) + 2;
        for (let j = 0; j < numCrops; j++) {
            const cropGeometry = new THREE.ConeGeometry(0.01, 0.06, 4);
            const cropMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x8BC34A, // Green crops
                roughness: 0.8,
                metalness: 0.0
            });
            
            const crop = new THREE.Mesh(cropGeometry, cropMaterial);
            crop.position.copy(plot.position);
            crop.position.x += (Math.random() - 0.5) * 0.25;
            crop.position.z += (Math.random() - 0.5) * 0.25;
            crop.position.y += 0.04;
            
            crop.castShadow = true;
            tileGroup.add(crop);
        }
    }
}

// Make function globally available
if (typeof window !== 'undefined') {
    window.addSettlementToTile = addSettlementToTile;
}

console.log("Settlement system loaded successfully");
