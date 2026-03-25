// Ensure THREE is available when bundled as an ES module
var THREE = (typeof THREE !== 'undefined') ? THREE : (typeof window !== 'undefined' && window.THREE) ? window.THREE : (typeof globalThis !== 'undefined' ? globalThis.THREE : undefined);
// 3d/desert-system.js
// Desert 3D elements for desert terrain tiles - Isometric Low-Poly Style

/**
 * Adds desert elements to desert terrain tiles (D)
 * @param {THREE.Group} tileGroup - The tile group to add elements to
 * @param {string} terrainChar - The terrain character
 * @param {number} x - Grid X coordinate
 * @param {number} y - Grid Y coordinate
 * @param {number} actualHeight - The actual height of the tile
 */
function addDesertToTile(tileGroup, terrainChar, x, y, actualHeight) {
    if (terrainChar !== 'D') return;

    // Only add desert elements occasionally for performance
    if (Math.random() > 0.25) return;

    // Add low-poly sand dunes
    const numDunes = Math.floor(Math.random() * 2) + 1;
    
    for (let i = 0; i < numDunes; i++) {
        // Create sand dunes using low-poly cone geometry
        const duneRadius = 0.2 + Math.random() * 0.3;
        const duneHeight = 0.08 + Math.random() * 0.12;
        const duneGeometry = new THREE.ConeGeometry(duneRadius, duneHeight, 6, 1);
        
        // Rotate and scale for dune shape
        duneGeometry.rotateX(Math.PI); // Flip upside down
        duneGeometry.scale(1, 0.3, 1); // Make it flatter
        
        const duneMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xF4A460, // Sandy brown
            roughness: 0.9,
            metalness: 0.0,
            flatShading: true // Low-poly isometric style
        });
        
        const dune = new THREE.Mesh(duneGeometry, duneMaterial);
        
        // Position randomly within the hex
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (HEX_RADIUS_3D * 0.4);
        dune.position.x = Math.cos(angle) * distance;
        dune.position.z = Math.sin(angle) * distance;
        dune.position.y = actualHeight / 2 + (duneHeight * 0.15) - (HEX_HEIGHT_3D / 2);
        
        dune.castShadow = true;
        dune.receiveShadow = true;
        tileGroup.add(dune);
    }

    // Add low-poly cacti occasionally
    if (Math.random() < 0.35) {
        const numCacti = Math.floor(Math.random() * 2) + 1;
        
        for (let i = 0; i < numCacti; i++) {
            // Cactus main body
            const cactusHeight = 0.2 + Math.random() * 0.3;
            const cactusGeometry = new THREE.CylinderGeometry(0.05, 0.06, cactusHeight);
            const cactusMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x2E7D32, // Dark green cactus
                roughness: 0.8,
                metalness: 0.0
            });
            
            const cactus = new THREE.Mesh(cactusGeometry, cactusMaterial);
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * (HEX_RADIUS_3D * 0.6);
            cactus.position.x = Math.cos(angle) * distance;
            cactus.position.z = Math.sin(angle) * distance;
            cactus.position.y = actualHeight / 2 + (cactusHeight / 2) - (HEX_HEIGHT_3D / 2);
            
            cactus.castShadow = true;
            tileGroup.add(cactus);
            
            // Add cactus arms occasionally
            if (Math.random() < 0.3) {
                const armHeight = cactusHeight * 0.6;
                const armGeometry = new THREE.CylinderGeometry(0.03, 0.04, armHeight);
                const arm = new THREE.Mesh(armGeometry, cactusMaterial);
                
                arm.position.copy(cactus.position);
                arm.position.y += cactusHeight * 0.2;
                arm.position.x += (Math.random() < 0.5 ? -1 : 1) * 0.08;
                arm.rotation.z = (Math.random() < 0.5 ? -1 : 1) * Math.PI * 0.3;
                
                arm.castShadow = true;
                tileGroup.add(arm);
            }
        }
    }

    // Add some desert rocks
    const numRocks = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numRocks; i++) {
        const rockSize = 0.04 + Math.random() * 0.06;
        const rockGeometry = new THREE.DodecahedronGeometry(rockSize);
        const rockMaterial = new THREE.MeshStandardMaterial({ 
            color: 0xBCAAA4, // Light desert rock
            roughness: 0.9,
            metalness: 0.1
        });
        
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (HEX_RADIUS_3D * 0.7);
        rock.position.x = Math.cos(angle) * distance;
        rock.position.z = Math.sin(angle) * distance;
        rock.position.y = actualHeight / 2 + rockSize - (HEX_HEIGHT_3D / 2);
        
        rock.rotation.x = Math.random() * Math.PI * 2;
        rock.rotation.y = Math.random() * Math.PI * 2;
        rock.rotation.z = Math.random() * Math.PI * 2;
        
        rock.castShadow = true;
        tileGroup.add(rock);
    }

    // Add sparse desert vegetation
    if (Math.random() < 0.25) {
        const numPlants = Math.floor(Math.random() * 2) + 1;
        
        for (let i = 0; i < numPlants; i++) {
            if (Math.random() < 0.7) {
                // Desert shrub
                const shrubGeometry = new THREE.SphereGeometry(0.06, 6, 4);
                const shrubMaterial = new THREE.MeshStandardMaterial({ 
                    color: 0x558B2F, // Dry green
                    roughness: 0.9,
                    metalness: 0.0
                });
                
                const shrub = new THREE.Mesh(shrubGeometry, shrubMaterial);
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * (HEX_RADIUS_3D * 0.6);
                shrub.position.x = Math.cos(angle) * distance;
                shrub.position.z = Math.sin(angle) * distance;
                shrub.position.y = actualHeight / 2 + 0.06 - (HEX_HEIGHT_3D / 2);
                
                shrub.castShadow = true;
                tileGroup.add(shrub);
            } else {
                // Dead wood/driftwood
                const woodGeometry = new THREE.CylinderGeometry(0.02, 0.03, 0.15);
                const woodMaterial = new THREE.MeshStandardMaterial({ 
                    color: 0x8D6E63, // Dead wood brown
                    roughness: 0.95,
                    metalness: 0.0
                });
                
                const wood = new THREE.Mesh(woodGeometry, woodMaterial);
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.random() * (HEX_RADIUS_3D * 0.5);
                wood.position.x = Math.cos(angle) * distance;
                wood.position.z = Math.sin(angle) * distance;
                wood.position.y = actualHeight / 2 + 0.03 - (HEX_HEIGHT_3D / 2);
                
                // Lay it down on the ground
                wood.rotation.z = Math.PI / 2;
                wood.rotation.y = Math.random() * Math.PI * 2;
                
                wood.castShadow = true;
                tileGroup.add(wood);
            }
        }
    }

    // Add some sand particles effect occasionally
    if (Math.random() < 0.1) {
        const particlesGeometry = new THREE.BufferGeometry();
        const particleCount = 20;
        const positions = new Float32Array(particleCount * 3);
        
        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * HEX_RADIUS_3D;
            positions[i * 3] = Math.cos(angle) * distance;
            positions[i * 3 + 1] = actualHeight / 2 + Math.random() * 0.1 - (HEX_HEIGHT_3D / 2);
            positions[i * 3 + 2] = Math.sin(angle) * distance;
        }
        
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const particlesMaterial = new THREE.PointsMaterial({ 
            color: 0xF4A460,
            size: 0.01,
            transparent: true,
            opacity: 0.6
        });
        
        const particles = new THREE.Points(particlesGeometry, particlesMaterial);
        tileGroup.add(particles);
    }
}

// Make function globally available
if (typeof window !== 'undefined') {
    window.addDesertToTile = addDesertToTile;
}

console.log("Desert system loaded successfully");
