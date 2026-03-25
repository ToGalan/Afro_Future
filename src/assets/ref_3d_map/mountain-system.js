/**
 * Enhanced Isometric Mountain System for Afro-Future Rising
 * Creates low-poly, stylized mountains with African-inspired aesthetics
 */

// Lazily resolve THREE from window/globalThis on each property access.
// A module-level capture would grab undefined at import time (before SceneBridge sets window.THREE).
const THREE = new Proxy({}, {
    get: (_, key) => {
        const t = (typeof window !== 'undefined' ? window.THREE : undefined)
               || (typeof globalThis !== 'undefined' ? globalThis.THREE : undefined);
        return t ? t[key] : undefined;
    }
});

class MountainSystem {
    constructor(scene, terrainConfig = {}) {
        // Guard: ensure THREE is available
        if (!THREE || !THREE.Group) {
            console.error('❌ MountainSystem: THREE.Group is not available. Make sure THREE is loaded before MountainSystem.');
            throw new Error('THREE is not properly initialized');
        }
        
        this.scene = scene;
        this.mountains = new Map();
        this.mountainGroup = new THREE.Group();
        this.mountainGroup.name = 'MountainGroup';
        this.scene.add(this.mountainGroup);
        
        // Mountain configuration
        this.config = {
            // Basic mountain properties
            baseScale: terrainConfig.mountainScale || 1.0,
            heightVariation: terrainConfig.mountainHeightVariation || 0.3,
            
            // Isometric styling
            lowPoly: true,
            flatShading: true,
            
            // African-inspired color palette
            colors: {
                stone: 0x8B7355,      // Sandy stone
                darkStone: 0x6B5B47,  // Darker stone
                iron: 0x7A6B5D,       // Iron-rich rock
                earth: 0x9B7B5A,      // Earthy brown
                red: 0xB85450,        // Red earth/iron oxide
                copper: 0x8B6F47      // Copper-rich stone
            },
              // Mountain types - Flat-topped (70%) and Pointy with snow caps (30%)
            types: {
                // Flat-topped mountains (Table Mountains style)
                'flat_mesa': {
                    height: 2.2,
                    color: 0x8B7355,
                    segments: 6,
                    roughness: 0.8,
                    shape: 'flat',
                    snowCap: false
                },
                'flat_plateau': {
                    height: 2.8,
                    color: 0x9B7B5A,
                    segments: 8,
                    roughness: 0.75,
                    shape: 'flat',
                    snowCap: false
                },
                'flat_butte': {
                    height: 2.0,
                    color: 0xB85450,
                    segments: 5,
                    roughness: 0.85,
                    shape: 'flat',
                    snowCap: false
                },
                'flat_table': {
                    height: 2.5,
                    color: 0x8B6F47,
                    segments: 7,
                    roughness: 0.8,
                    shape: 'flat',
                    snowCap: false
                },
                
                // Pointy mountains with snow caps
                'peak_kilimanjaro': {
                    height: 3.5,
                    color: 0x6B5B47,
                    segments: 8,
                    roughness: 0.7,
                    shape: 'pointy',
                    snowCap: true
                },
                'peak_atlas': {
                    height: 3.0,
                    color: 0x7A6B5D,
                    segments: 6,
                    roughness: 0.75,
                    shape: 'pointy',
                    snowCap: true
                },
                'peak_drakensberg': {
                    height: 2.8,
                    color: 0x8B7355,
                    segments: 7,
                    roughness: 0.8,
                    shape: 'pointy',
                    snowCap: true
                }
            },
            
            // Performance settings
            maxMountains: 50,
            cullingDistance: 100,
            lodLevels: 3
        };
        
        // Initialize mountain meshes cache
        this.mountainMeshCache = new Map();
        this.initializeMountainMeshes();
        
        console.log('MountainSystem: Initialized with African-inspired isometric styling');
    }
    
    initializeMountainMeshes() {
        // Pre-create mountain meshes for different types
        Object.keys(this.config.types).forEach(type => {
            this.createMountainMesh(type);
        });
    }    createMountainMesh(type) {
        const config = this.config.types[type];
        if (!config) {
            console.warn(`MountainSystem: Unknown mountain type: ${type}`);
            return null;
        }
        
        try {
            // Create low-poly mountain geometry
            const geometry = this.createLowPolyMountainGeometry(config);
            
            // Create African-inspired material
            const material = new THREE.MeshStandardMaterial({
                color: config.color,
                roughness: config.roughness,
                metalness: 0.1,
                flatShading: this.config.flatShading,
                transparent: false
            });
            
            // Add subtle texture variation
            this.addMaterialVariation(material, type);
              const mesh = new THREE.Mesh(geometry, material);
            mesh.userData.mountainType = type;
            mesh.userData.isometric = true;
            
            // Enable shadows
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            // Add snow cap for pointy mountains
            if (config.snowCap && config.shape === 'pointy') {
                const snowCapMesh = this.createSnowCap(config);
                if (snowCapMesh) {
                    mesh.add(snowCapMesh);
                }
            }
            
            // Cache the mesh
            this.mountainMeshCache.set(type, { geometry, material });
            
            return mesh;
        } catch (error) {
            console.error(`MountainSystem: Error creating mesh for type '${type}':`, error);
            return null;
        }
    }    createLowPolyMountainGeometry(config) {
        const segments = config.segments;
        const height = config.height * this.config.baseScale;
        let geometry;
        
        // Create geometry based on mountain shape
        if (config.shape === 'flat') {
            // Create flat-topped mountain (mesa/plateau style)
            geometry = this.createFlatToppedMountainGeometry(height, segments);
        } else {
            // Create pointy mountain (traditional cone)
            geometry = new THREE.ConeGeometry(
                1.0,           // Base radius
                height,        // Height
                segments,      // Radial segments (low-poly)
                1,             // Height segments
                false          // Open ended
            );
        }
        
        // Apply isometric deformation with error handling
        try {
            this.applyIsometricDeformation(geometry, config);
        } catch (error) {
            console.warn(`Failed to apply isometric deformation:`, error);
        }
        
        // Add surface detail with error handling
        try {
            this.addSurfaceDetail(geometry, config);
        } catch (error) {
            console.warn(`Failed to apply surface detail:`, error);
        }
        
        // Ensure proper normals for flat shading
        geometry.computeVertexNormals();
        
        return geometry;
    }
      createFlatToppedMountainGeometry(height, segments) {
        // Create a truncated cone (frustum) for flat-topped mountains
        const topRadius = 0.6;    // Flat top size
        const bottomRadius = 1.0; // Base size
        
        const geometry = new THREE.CylinderGeometry(
            topRadius,     // Top radius (creates flat top)
            bottomRadius,  // Bottom radius
            height,        // Height
            segments,      // Radial segments (low-poly)
            1,             // Height segments
            false          // Open ended
        );
        
        return geometry;
    }
    
    createSnowCap(config) {
        const height = config.height * this.config.baseScale;
        const snowCapHeight = height * 0.25; // Snow cap covers top 25% of mountain
        const snowCapRadius = 0.3; // Small radius for snow cap
        
        // Create snow cap geometry (small cone at the top)
        const snowGeometry = new THREE.ConeGeometry(
            snowCapRadius,    // Small radius
            snowCapHeight,    // Height of snow cap
            config.segments   // Match mountain segments
        );
        
        // Create snow material (white with slight blue tint)
        const snowMaterial = new THREE.MeshStandardMaterial({
            color: 0xF8F8FF,        // Snow white with slight blue
            roughness: 0.9,         // Rough snow texture
            metalness: 0.0,         // Non-metallic
            transparent: true,
            opacity: 0.95,          // Slightly transparent
            emissive: 0x111122,     // Slight blue glow
            emissiveIntensity: 0.1
        });
        
        const snowMesh = new THREE.Mesh(snowGeometry, snowMaterial);
        
        // Position snow cap at the top of the mountain
        snowMesh.position.set(0, height * 0.375, 0); // 75% up the mountain
        snowMesh.castShadow = true;
        snowMesh.receiveShadow = true;
        
        return snowMesh;
    }
    
    applyIsometricDeformation(geometry, config) {
        const positions = geometry.attributes.position;
        const vertex = new THREE.Vector3();
        
        // Apply isometric perspective and shape variation
        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            
            // Isometric scaling (slightly compressed on one axis)
            vertex.x *= 0.9;
            vertex.z *= 1.1;
            
            // Add natural mountain irregularities
            const heightFactor = (vertex.y + config.height) / (config.height * 2);
            const noise = (Math.random() - 0.5) * 0.1 * heightFactor;
            
            vertex.x += noise;
            vertex.z += noise;
            vertex.y += noise * 0.5;
            
            positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }
        
        positions.needsUpdate = true;
    }
    
    addSurfaceDetail(geometry, config) {
        // Add subtle surface variations for African mountain characteristics
        const positions = geometry.attributes.position;
        const vertex = new THREE.Vector3();
        
        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            
            // Add stratification (horizontal bands typical of African mountains)
            const stratification = Math.sin(vertex.y * 4) * 0.02;
            vertex.x += stratification;
            vertex.z += stratification;
            
            // Add weathering patterns
            const weathering = Math.cos(vertex.x * 3 + vertex.z * 3) * 0.015;
            vertex.y += weathering;
            
            positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }
        
        positions.needsUpdate = true;
    }
    
    addMaterialVariation(material, type) {
        // Add subtle color variation and African-inspired effects
        const baseColor = new THREE.Color(material.color);
        
        // Apply subtle color variation based on mountain type
        switch (type) {
            case 'kilimanjaro':
                // Volcanic rock characteristics
                material.emissive.setHex(0x1a0a0a);
                material.emissiveIntensity = 0.05;
                break;
                
            case 'atlas':
                // Limestone characteristics
                material.roughness = 0.9;
                break;
                
            case 'copper_peaks':
                // Metallic mineral deposits
                material.metalness = 0.2;
                material.emissive.setHex(0x2a1f0f);
                material.emissiveIntensity = 0.03;
                break;
                
            case 'sahara_hills':
                // Desert mountain characteristics
                material.roughness = 0.95;
                break;
        }
    }
    
    // Public API methods
    addMountain(x, y, z, type = 'atlas', options = {}) {
        const mountainConfig = this.config.types[type];
        if (!mountainConfig) {
            console.warn(`MountainSystem: Unknown mountain type: ${type}`);
            return null;
        }
        
        // Create mountain instance
        const mountain = this.createMountainMesh(type);
        if (!mountain) return null;
        
        // Apply positioning
        mountain.position.set(x, y, z);
        
        // Apply scaling variation
        const scaleVariation = 1 + (Math.random() - 0.5) * this.config.heightVariation;
        mountain.scale.setScalar(scaleVariation * (options.scale || 1.0));
        
        // Apply rotation for natural variation
        mountain.rotation.y = Math.random() * Math.PI * 2;
        
        // Slight tilt for natural appearance
        mountain.rotation.x = (Math.random() - 0.5) * 0.1;
        mountain.rotation.z = (Math.random() - 0.5) * 0.1;
        
        // Add to scene
        this.mountainGroup.add(mountain);
        
        // Store mountain data
        const mountainId = `mountain_${x}_${y}_${z}`;
        this.mountains.set(mountainId, {
            mesh: mountain,
            type: type,
            position: { x, y, z },
            options: options
        });
        
        console.log(`MountainSystem: Added ${type} mountain at (${x}, ${y}, ${z})`);
        return mountain;
    }
    
    removeMountain(x, y, z) {
        const mountainId = `mountain_${x}_${y}_${z}`;
        const mountainData = this.mountains.get(mountainId);
        
        if (mountainData) {
            this.mountainGroup.remove(mountainData.mesh);
            this.mountains.delete(mountainId);
            
            // Dispose of geometry and material if not cached
            if (mountainData.mesh.geometry) {
                mountainData.mesh.geometry.dispose();
            }
            if (mountainData.mesh.material && mountainData.mesh.material.dispose) {
                mountainData.mesh.material.dispose();
            }
            
            return true;
        }
        
        return false;
    }
    
    getMountain(x, y, z) {
        const mountainId = `mountain_${x}_${y}_${z}`;
        return this.mountains.get(mountainId);
    }
    
    addMountainRange(startX, startZ, endX, endZ, type = 'atlas', density = 0.3) {
        const mountains = [];
        const width = Math.abs(endX - startX);
        const depth = Math.abs(endZ - startZ);
        
        for (let x = Math.min(startX, endX); x <= Math.max(startX, endX); x += 2) {
            for (let z = Math.min(startZ, endZ); z <= Math.max(startZ, endZ); z += 2) {
                if (Math.random() < density) {
                    // Vary height based on position in range
                    const centerX = (startX + endX) / 2;
                    const centerZ = (startZ + endZ) / 2;
                    const distanceFromCenter = Math.sqrt(
                        Math.pow(x - centerX, 2) + Math.pow(z - centerZ, 2)
                    );
                    const maxDistance = Math.sqrt(Math.pow(width / 2, 2) + Math.pow(depth / 2, 2));
                    const heightFactor = 1 - (distanceFromCenter / maxDistance) * 0.5;
                    
                    const y = 0;
                    const mountain = this.addMountain(x, y, z, type, {
                        scale: heightFactor
                    });
                    
                    if (mountain) {
                        mountains.push(mountain);
                    }
                }
            }
        }
        
        console.log(`MountainSystem: Created mountain range with ${mountains.length} mountains`);
        return mountains;
    }
    
    // Performance optimization methods
    updateLOD(cameraPosition) {
        this.mountains.forEach((mountainData, id) => {
            const distance = cameraPosition.distanceTo(mountainData.mesh.position);
            
            // Simple LOD system
            if (distance > this.config.cullingDistance) {
                mountainData.mesh.visible = false;
            } else {
                mountainData.mesh.visible = true;
                
                // Adjust detail level based on distance
                if (distance > this.config.cullingDistance * 0.5) {
                    mountainData.mesh.material.wireframe = false;
                } else {
                    mountainData.mesh.material.wireframe = false;
                }
            }
        });
    }
    
    // Utility methods
    getMountainsByType(type) {
        const results = [];
        this.mountains.forEach((data, id) => {
            if (data.type === type) {
                results.push(data);
            }
        });
        return results;
    }
    
    getAllMountains() {
        return Array.from(this.mountains.values());
    }
    
    getMountainCount() {
        return this.mountains.size;
    }
    
    clearAllMountains() {
        this.mountains.forEach((data, id) => {
            this.mountainGroup.remove(data.mesh);
            if (data.mesh.geometry) data.mesh.geometry.dispose();
            if (data.mesh.material && data.mesh.material.dispose) {
                data.mesh.material.dispose();
            }
        });
        
        this.mountains.clear();
        console.log('MountainSystem: Cleared all mountains');
    }
    
    // Integration with terrain system
    generateMountainsForTerrain(terrainData) {
        // Generate mountains based on terrain height and type
        if (!terrainData || !terrainData.heightMap) {
            console.warn('MountainSystem: No terrain data provided');
            return;
        }
        
        const heightMap = terrainData.heightMap;
        const mountainThreshold = 0.7; // Height threshold for mountain placement
        
        for (let x = 0; x < heightMap.length; x += 3) {
            for (let z = 0; z < heightMap[0].length; z += 3) {
                const height = heightMap[x] && heightMap[x][z] ? heightMap[x][z] : 0;
                
                if (height > mountainThreshold && Math.random() < 0.4) {
                    // Choose mountain type based on height and randomness
                    let type = 'atlas';
                    if (height > 0.9) type = 'kilimanjaro';
                    else if (height > 0.8) type = 'copper_peaks';
                    else if (Math.random() < 0.3) type = 'drakensberg';
                    
                    this.addMountain(
                        x * 2 - heightMap.length,
                        height * 2,
                        z * 2 - heightMap[0].length,
                        type
                    );
                }
            }
        }
    }
    
    dispose() {
        this.clearAllMountains();
        
        // Dispose cached meshes
        this.mountainMeshCache.forEach((cache, type) => {
            if (cache.geometry) cache.geometry.dispose();
            if (cache.material && cache.material.dispose) cache.material.dispose();
        });
        this.mountainMeshCache.clear();
        
        if (this.mountainGroup.parent) {
            this.mountainGroup.parent.remove(this.mountainGroup);
        }
        
        console.log('MountainSystem: Disposed');
    }
}

// Export for use in main game
if (typeof window !== 'undefined') {
    window.MountainSystem = MountainSystem;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MountainSystem;
}
