// 3d/building-system.js
// Building 3D elements for building terrain tiles

/**
 * Adds building elements to building terrain tiles (B)
 * @param {THREE.Group} tileGroup - The tile group to add elements to
 * @param {string} terrainChar - The terrain character
 * @param {number} x - Grid X coordinate
 * @param {number} y - Grid Y coordinate
 * @param {number} actualHeight - The actual height of the tile
 */
function addBuildingToTile(tileGroup, terrainChar, x, y, actualHeight) {
    if (terrainChar !== 'B') return;

    // Always add building elements since these are special tiles
    
    // Add a larger main building in the center
    const mainBuildingWidth = 0.4 + Math.random() * 0.2;
    const mainBuildingHeight = 0.3 + Math.random() * 0.2;
    const mainBuildingDepth = 0.4 + Math.random() * 0.2;
    
    const mainGeometry = new THREE.BoxGeometry(mainBuildingWidth, mainBuildingHeight, mainBuildingDepth);
    const mainMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x757575, // Grey concrete building
        roughness: 0.7,
        metalness: 0.3
    });
    
    const mainBuilding = new THREE.Mesh(mainGeometry, mainMaterial);
    mainBuilding.position.y = actualHeight / 2 + (mainBuildingHeight / 2) - (HEX_HEIGHT_3D / 2);
    
    mainBuilding.castShadow = true;
    mainBuilding.receiveShadow = true;
    tileGroup.add(mainBuilding);
    
    // Add windows to the main building
    const numWindows = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < numWindows; i++) {
        const windowGeometry = new THREE.BoxGeometry(0.06, 0.08, 0.01);
        const windowMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x81D4FA, // Light blue glass
            roughness: 0.1,
            metalness: 0.9,
            transparent: true,
            opacity: 0.7
        });
        
        const window = new THREE.Mesh(windowGeometry, windowMaterial);
        window.position.copy(mainBuilding.position);
        
        // Position windows on the sides of the building
        const side = Math.floor(Math.random() * 4);
        switch(side) {
            case 0: // Front
                window.position.z += (mainBuildingDepth / 2) + 0.01;
                window.position.x += (Math.random() - 0.5) * mainBuildingWidth * 0.6;
                break;
            case 1: // Back
                window.position.z -= (mainBuildingDepth / 2) + 0.01;
                window.position.x += (Math.random() - 0.5) * mainBuildingWidth * 0.6;
                break;
            case 2: // Left
                window.position.x -= (mainBuildingWidth / 2) + 0.01;
                window.position.z += (Math.random() - 0.5) * mainBuildingDepth * 0.6;
                window.rotation.y = Math.PI / 2;
                break;
            case 3: // Right
                window.position.x += (mainBuildingWidth / 2) + 0.01;
                window.position.z += (Math.random() - 0.5) * mainBuildingDepth * 0.6;
                window.rotation.y = Math.PI / 2;
                break;
        }
        
        window.position.y += (Math.random() - 0.5) * mainBuildingHeight * 0.4;
        tileGroup.add(window);
    }
    
    // Add an entrance door
    const doorGeometry = new THREE.BoxGeometry(0.08, 0.12, 0.02);
    const doorMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x3E2723, // Dark brown door
        roughness: 0.8,
        metalness: 0.2
    });
    
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.position.copy(mainBuilding.position);
    door.position.z += (mainBuildingDepth / 2) + 0.01;
    door.position.y -= mainBuildingHeight * 0.3;
    
    door.castShadow = true;
    tileGroup.add(door);
    
    // Add smaller auxiliary buildings occasionally
    if (Math.random() < 0.7) {
        const numAuxBuildings = Math.floor(Math.random() * 2) + 1;
        
        for (let i = 0; i < numAuxBuildings; i++) {
            const auxWidth = 0.15 + Math.random() * 0.1;
            const auxHeight = 0.15 + Math.random() * 0.1;
            const auxDepth = 0.15 + Math.random() * 0.1;
            
            const auxGeometry = new THREE.BoxGeometry(auxWidth, auxHeight, auxDepth);
            const auxMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x8D6E63, // Brown auxiliary building
                roughness: 0.8,
                metalness: 0.1
            });
            
            const auxBuilding = new THREE.Mesh(auxGeometry, auxMaterial);
            
            // Position around the main building
            const angle = Math.random() * Math.PI * 2;
            const distance = HEX_RADIUS_3D * (0.5 + Math.random() * 0.3);
            auxBuilding.position.x = Math.cos(angle) * distance;
            auxBuilding.position.z = Math.sin(angle) * distance;
            auxBuilding.position.y = actualHeight / 2 + (auxHeight / 2) - (HEX_HEIGHT_3D / 2);
            
            auxBuilding.castShadow = true;
            auxBuilding.receiveShadow = true;
            tileGroup.add(auxBuilding);
        }
    }
    
    // Add rooftop elements
    if (Math.random() < 0.5) {
        // Antenna or chimney
        const rooftopElementGeometry = new THREE.CylinderGeometry(0.01, 0.02, 0.15);
        const rooftopElementMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x424242, // Dark grey
            roughness: 0.7,
            metalness: 0.4
        });
        
        const rooftopElement = new THREE.Mesh(rooftopElementGeometry, rooftopElementMaterial);
        rooftopElement.position.copy(mainBuilding.position);
        rooftopElement.position.y += (mainBuildingHeight / 2) + 0.075;
        rooftopElement.position.x += (Math.random() - 0.5) * mainBuildingWidth * 0.3;
        rooftopElement.position.z += (Math.random() - 0.5) * mainBuildingDepth * 0.3;
        
        rooftopElement.castShadow = true;
        tileGroup.add(rooftopElement);
    }
    
    // Add paved areas around the building
    const numPavedAreas = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < numPavedAreas; i++) {
        const pavedGeometry = new THREE.BoxGeometry(0.6, 0.01, 0.3);
        const pavedMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x90A4AE, // Light grey pavement
            roughness: 0.8,
            metalness: 0.1
        });
        
        const paved = new THREE.Mesh(pavedGeometry, pavedMaterial);
        paved.position.y = actualHeight / 2 + 0.005 - (HEX_HEIGHT_3D / 2);
        paved.rotation.y = Math.random() * Math.PI * 2;
        
        paved.receiveShadow = true;
        tileGroup.add(paved);
    }
    
    // Add some urban vegetation (small decorative plants)
    if (Math.random() < 0.4) {
        const numPlants = Math.floor(Math.random() * 3) + 1;
        
        for (let i = 0; i < numPlants; i++) {
            const plantGeometry = new THREE.SphereGeometry(0.05, 6, 4);
            const plantMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x4CAF50, // Green decorative plant
                roughness: 0.8,
                metalness: 0.0
            });
            
            const plant = new THREE.Mesh(plantGeometry, plantMaterial);
            const angle = Math.random() * Math.PI * 2;
            const distance = HEX_RADIUS_3D * (0.6 + Math.random() * 0.3);
            plant.position.x = Math.cos(angle) * distance;
            plant.position.z = Math.sin(angle) * distance;
            plant.position.y = actualHeight / 2 + 0.05 - (HEX_HEIGHT_3D / 2);
            
            plant.castShadow = true;
            tileGroup.add(plant);
        }
    }
    
    // Add lighting fixtures occasionally
    if (Math.random() < 0.3) {
        const lightPoleGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.25);
        const lightPoleMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x424242, // Dark grey pole
            roughness: 0.6,
            metalness: 0.5
        });
        
        const lightPole = new THREE.Mesh(lightPoleGeometry, lightPoleMaterial);
        const angle = Math.random() * Math.PI * 2;
        const distance = HEX_RADIUS_3D * (0.7 + Math.random() * 0.2);
        lightPole.position.x = Math.cos(angle) * distance;
        lightPole.position.z = Math.sin(angle) * distance;
        lightPole.position.y = actualHeight / 2 + 0.125 - (HEX_HEIGHT_3D / 2);
        
        lightPole.castShadow = true;
        tileGroup.add(lightPole);
        
        // Light fixture on top
        const lightGeometry = new THREE.SphereGeometry(0.03, 6, 4);
        const lightMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xFFF176, // Light yellow
            roughness: 0.3,
            metalness: 0.0,
            emissive: 0xFFF176,
            emissiveIntensity: 0.2
        });
        
        const light = new THREE.Mesh(lightGeometry, lightMaterial);
        light.position.copy(lightPole.position);
        light.position.y += 0.15;
        
        tileGroup.add(light);
    }
}

// Make function globally available
if (typeof window !== 'undefined') {
    window.addBuildingToTile = addBuildingToTile;
}

console.log("Building system loaded successfully");
