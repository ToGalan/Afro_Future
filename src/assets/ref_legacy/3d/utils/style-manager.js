/**
 * Style Manager for 3D Low-Poly Isometric Elements
 * Manages default styling and applies it to Three.js objects
 */

class StyleManager {
    constructor() {
        this.defaultStyle = null;
        this.loadDefaultStyle();
    }

    async loadDefaultStyle() {
        try {
            const response = await fetch('./3d/config/default-style.json');
            this.defaultStyle = await response.json();
        } catch (error) {
            console.warn('Could not load default style, using fallback');
            this.defaultStyle = this.getFallbackStyle();
        }
    }

    getFallbackStyle() {
        return {
            icon_style: {
                perspective: "isometric",
                lighting: {
                    type: "soft ambient light",
                    light_source: "subtle top-right or front-top direction"
                },
                textures: {
                    material_finish: "semi-matte to satin surfaces"
                },
                color_palette: {
                    tone: "naturalistic with slight saturation boost"
                }
            }
        };
    }

    createStandardMaterial(color = 0xffffff, options = {}) {
        const style = this.defaultStyle?.icon_style || this.getFallbackStyle().icon_style;
        
        return new THREE.MeshStandardMaterial({
            color: color,
            roughness: options.roughness || 0.6, // Semi-matte finish
            metalness: options.metalness || 0.1,
            flatShading: false,
            ...options
        });
    }

    setupIsometricLighting(scene) {
        const style = this.defaultStyle?.icon_style?.lighting;
        
        // Soft ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);

        // Top-right directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
        directionalLight.position.set(1, 1, 1);
        directionalLight.castShadow = true;
        
        // Soft shadows
        directionalLight.shadow.mapSize.width = 1024;
        directionalLight.shadow.mapSize.height = 1024;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 50;
        
        scene.add(directionalLight);

        return { ambientLight, directionalLight };
    }

    getIsometricCameraSettings(width, height) {
        const aspect = width / height;
        const frustumSize = 10;
        
        return {
            left: frustumSize * aspect / -2,
            right: frustumSize * aspect / 2,
            top: frustumSize / 2,
            bottom: frustumSize / -2,
            near: 0.1,
            far: 100,
            position: { x: 10, y: 10, z: 10 }
        };
    }

    // Apply style to existing hex tile materials
    applyHexTileStyle(material, terrainType) {
        const style = this.defaultStyle?.icon_style || this.getFallbackStyle().icon_style;
        
        // Apply semi-matte finish
        material.roughness = material.roughness || 0.6;
        material.metalness = material.metalness || 0.1;
        
        // Enhance colors with slight saturation boost
        if (material.color && typeof chroma !== 'undefined') {
            try {
                const enhancedColor = chroma(material.color.getHex()).saturate(0.2);
                material.color.setHex(parseInt(enhancedColor.hex().substring(1), 16));
            } catch (e) {
                // Fallback if chroma is not available
                console.warn('Chroma.js not available for color enhancement');
            }
        }
        
        return material;
    }
}

window.StyleManager = StyleManager;
