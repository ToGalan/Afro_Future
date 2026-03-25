/**
 * 3D System Entry Point
 * Initializes all 3D components and managers
 */

class ThreeDSystem {
    constructor() {
        this.styleManager = null;
        this.animationManager = null;
        this.initialized = false;
    }

    async init() {
        try {
            // Initialize style manager
            this.styleManager = new StyleManager();
            await this.styleManager.loadDefaultStyle();

            // Initialize animation manager
            this.animationManager = new AnimationManager();

            this.initialized = true;
            console.log('3D System initialized successfully');
            
            return true;
        } catch (error) {
            console.error('Failed to initialize 3D System:', error);
            return false;
        }
    }

    createIsometricScene(width, height) {
        if (!this.initialized) {
            console.warn('3D System not initialized');
            return null;
        }

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xffffff); // White background from style

        // Setup isometric camera
        const cameraSettings = this.styleManager.getIsometricCameraSettings(width, height);
        const camera = new THREE.OrthographicCamera(
            cameraSettings.left,
            cameraSettings.right,
            cameraSettings.top,
            cameraSettings.bottom,
            cameraSettings.near,
            cameraSettings.far
        );
        
        camera.position.set(
            cameraSettings.position.x,
            cameraSettings.position.y,
            cameraSettings.position.z
        );
        camera.lookAt(0, 0, 0);

        // Setup lighting
        const lights = this.styleManager.setupIsometricLighting(scene);

        return {
            scene,
            camera,
            lights,
            animationManager: this.animationManager,
            styleManager: this.styleManager
        };
    }

    // Enhanced material creation with style guide
    createStyledMaterial(color, terrainType, options = {}) {
        if (!this.styleManager) {
            console.warn('StyleManager not initialized, using basic material');
            return new THREE.MeshStandardMaterial({ color, ...options });
        }

        const material = this.styleManager.createStandardMaterial(color, options);
        return this.styleManager.applyHexTileStyle(material, terrainType);
    }

    // Animate object with enhanced effects
    animateObject(object, animation) {
        if (!this.animationManager) {
            console.warn('AnimationManager not initialized');
            return Promise.resolve();
        }

        const { type, target, duration = 1000, easing = 'easeInOutQuad' } = animation;

        switch (type) {
            case 'position':
                return this.animationManager.moveObject(object, target, duration, easing);
            case 'rotation':
                return this.animationManager.rotateObject(object, target, duration, easing);
            case 'scale':
                return this.animationManager.scaleObject(object, target, duration, easing);
            default:
                console.warn('Unknown animation type:', type);
                return Promise.resolve();
        }
    }

    dispose() {
        if (this.animationManager) {
            this.animationManager.stop();
        }
        this.initialized = false;
    }
}

// Initialize global 3D system
window.threeDSystem = new ThreeDSystem();

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof THREE !== 'undefined') {
        await window.threeDSystem.init();
    } else {
        console.warn('THREE.js not loaded, 3D system initialization delayed');
        // Try again after a short delay
        setTimeout(async () => {
            if (typeof THREE !== 'undefined') {
                await window.threeDSystem.init();
            }
        }, 1000);
    }
});
