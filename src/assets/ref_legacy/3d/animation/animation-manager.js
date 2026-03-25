/**
 * Main Animation Manager
 * Coordinates all animation systems
 */

class AnimationManager {
    constructor() {
        this.velocityAnimator = new VelocityAnimator();
        this.morphController = new MorphController();
        this.clock = new THREE.Clock();
        this.isRunning = true;
        
        this.animate = this.animate.bind(this);
        this.animate();
    }

    animate() {
        if (!this.isRunning) return;

        const deltaTime = this.clock.getDelta();
        
        // Update skeletal animations
        this.morphController.update(deltaTime);
        
        requestAnimationFrame(this.animate);
    }

    // Convenience methods
    moveObject(object, targetPosition, duration, easing) {
        return this.velocityAnimator.animatePosition(object, targetPosition, duration, easing);
    }

    rotateObject(object, targetRotation, duration, easing) {
        return this.velocityAnimator.animateRotation(object, targetRotation, duration, easing);
    }

    scaleObject(object, targetScale, duration, easing) {
        return this.velocityAnimator.animateScale(object, targetScale, duration, easing);
    }

    morphMesh(meshId, targetIndex, influence, duration) {
        return this.morphController.animateMorph(meshId, targetIndex, influence, duration);
    }

    setupMeshMorphing(mesh, morphData) {
        return this.morphController.setupMorphTargets(mesh, morphData);
    }

    setupMeshSkeleton(mesh, animations) {
        return this.morphController.setupSkeletalAnimation(mesh, animations);
    }

    playAnimation(meshId, animationName, loop, crossFadeDuration) {
        return this.morphController.playSkeletalAnimation(meshId, animationName, loop, crossFadeDuration);
    }

    stop() {
        this.isRunning = false;
        this.velocityAnimator.stopAllAnimations();
    }

    start() {
        this.isRunning = true;
        this.animate();
    }
}

window.AnimationManager = AnimationManager;
