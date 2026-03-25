/**
 * Morphing and Skinning Controller for Three.js
 * Handles mesh morphing and skeletal animation
 */

class MorphController {
    constructor() {
        this.morphTargets = new Map();
        this.skeletalAnimations = new Map();
        this.mixers = new Map();
    }

    // Setup morph targets for a mesh
    setupMorphTargets(mesh, morphData) {
        if (!mesh.geometry.morphAttributes.position) {
            console.warn('Mesh does not have morph targets');
            return false;
        }

        const morphTargetInfluences = mesh.morphTargetInfluences;
        this.morphTargets.set(mesh.uuid, {
            mesh: mesh,
            influences: morphTargetInfluences,
            targets: morphData
        });

        return true;
    }

    // Animate morph target
    animateMorph(meshId, targetIndex, influence, duration = 1000) {
        const morphData = this.morphTargets.get(meshId);
        if (!morphData) {
            console.warn('Morph target not found for mesh:', meshId);
            return;
        }

        const mesh = morphData.mesh;
        const startInfluence = mesh.morphTargetInfluences[targetIndex] || 0;

        return new Promise((resolve) => {
            if (typeof anime !== 'undefined') {
                anime({
                    targets: { value: startInfluence },
                    value: influence,
                    duration: duration,
                    easing: 'easeInOutQuad',
                    update: (anim) => {
                        mesh.morphTargetInfluences[targetIndex] = anim.animations[0].currentValue;
                    },
                    complete: resolve
                });
            } else {
                // Fallback
                const start = Date.now();
                const animate = () => {
                    const elapsed = Date.now() - start;
                    const progress = Math.min(elapsed / duration, 1);
                    const currentInfluence = startInfluence + (influence - startInfluence) * progress;
                    
                    mesh.morphTargetInfluences[targetIndex] = currentInfluence;
                    
                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        resolve();
                    }
                };
                animate();
            }
        });
    }

    // Setup skeletal animation
    setupSkeletalAnimation(mesh, animations) {
        if (!mesh.skeleton) {
            console.warn('Mesh does not have skeleton for animation');
            return false;
        }

        const mixer = new THREE.AnimationMixer(mesh);
        const actions = {};

        animations.forEach((clip, index) => {
            const action = mixer.clipAction(clip);
            actions[clip.name || `animation_${index}`] = action;
        });

        this.mixers.set(mesh.uuid, mixer);
        this.skeletalAnimations.set(mesh.uuid, {
            mixer: mixer,
            actions: actions,
            mesh: mesh
        });

        return true;
    }

    // Play skeletal animation
    playSkeletalAnimation(meshId, animationName, loop = false, crossFadeDuration = 0.3) {
        const animData = this.skeletalAnimations.get(meshId);
        if (!animData) {
            console.warn('Skeletal animation not found for mesh:', meshId);
            return;
        }

        const action = animData.actions[animationName];
        if (!action) {
            console.warn('Animation not found:', animationName);
            return;
        }

        // Stop current animations if cross-fading
        if (crossFadeDuration > 0) {
            Object.values(animData.actions).forEach(otherAction => {
                if (otherAction !== action && otherAction.isRunning()) {
                    otherAction.crossFadeTo(action, crossFadeDuration, true);
                }
            });
        }

        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);
        action.reset();
        action.play();

        return action;
    }

    // Update all mixers (call in animation loop)
    update(deltaTime) {
        this.mixers.forEach(mixer => {
            mixer.update(deltaTime);
        });
    }

    // Dispose of animations for a mesh
    dispose(meshId) {
        if (this.mixers.has(meshId)) {
            this.mixers.get(meshId).uncacheRoot();
            this.mixers.delete(meshId);
        }
        
        this.morphTargets.delete(meshId);
        this.skeletalAnimations.delete(meshId);
    }
}

window.MorphController = MorphController;
