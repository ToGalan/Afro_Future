/**
 * Velocity.js Integration for Three.js Animation
 * Provides smooth animations for 3D objects
 */

class VelocityAnimator {
    constructor() {
        this.activeAnimations = new Map();
        this.animationId = 0;
    }

    // Animate object position
    animatePosition(object, targetPosition, duration = 1000, easing = 'easeInOutQuad') {
        const animId = ++this.animationId;
        const startPosition = { 
            x: object.position.x, 
            y: object.position.y, 
            z: object.position.z 
        };
        
        return new Promise((resolve) => {
            if (typeof Velocity !== 'undefined') {
                Velocity.animate(
                    startPosition,
                    {
                        x: targetPosition.x,
                        y: targetPosition.y,
                        z: targetPosition.z
                    },
                    {
                        duration: duration,
                        easing: easing,
                        progress: (elements, percentComplete) => {
                            object.position.set(
                                startPosition.x,
                                startPosition.y,
                                startPosition.z
                            );
                        },
                        complete: () => {
                            this.activeAnimations.delete(animId);
                            resolve();
                        }
                    }
                );
                this.activeAnimations.set(animId, { object, type: 'position' });
            } else {
                // Fallback using anime.js or manual animation
                this.fallbackAnimate(object, 'position', targetPosition, duration, resolve);
            }
        });
    }

    // Animate object rotation
    animateRotation(object, targetRotation, duration = 1000, easing = 'easeInOutQuad') {
        const animId = ++this.animationId;
        const startRotation = { 
            x: object.rotation.x, 
            y: object.rotation.y, 
            z: object.rotation.z 
        };
        
        return new Promise((resolve) => {
            if (typeof Velocity !== 'undefined') {
                Velocity.animate(
                    startRotation,
                    {
                        x: targetRotation.x,
                        y: targetRotation.y,
                        z: targetRotation.z
                    },
                    {
                        duration: duration,
                        easing: easing,
                        progress: (elements, percentComplete) => {
                            object.rotation.set(
                                startRotation.x,
                                startRotation.y,
                                startRotation.z
                            );
                        },
                        complete: () => {
                            this.activeAnimations.delete(animId);
                            resolve();
                        }
                    }
                );
                this.activeAnimations.set(animId, { object, type: 'rotation' });
            } else {
                this.fallbackAnimate(object, 'rotation', targetRotation, duration, resolve);
            }
        });
    }

    // Animate object scale
    animateScale(object, targetScale, duration = 1000, easing = 'easeInOutQuad') {
        const animId = ++this.animationId;
        const startScale = { 
            x: object.scale.x, 
            y: object.scale.y, 
            z: object.scale.z 
        };
        
        return new Promise((resolve) => {
            if (typeof Velocity !== 'undefined') {
                const scaleTarget = typeof targetScale === 'number' ? 
                    { x: targetScale, y: targetScale, z: targetScale } : targetScale;
                
                Velocity.animate(
                    startScale,
                    scaleTarget,
                    {
                        duration: duration,
                        easing: easing,
                        progress: (elements, percentComplete) => {
                            object.scale.set(
                                startScale.x,
                                startScale.y,
                                startScale.z
                            );
                        },
                        complete: () => {
                            this.activeAnimations.delete(animId);
                            resolve();
                        }
                    }
                );
                this.activeAnimations.set(animId, { object, type: 'scale' });
            } else {
                this.fallbackAnimate(object, 'scale', targetScale, duration, resolve);
            }
        });
    }

    fallbackAnimate(object, property, target, duration, resolve) {
        if (typeof anime !== 'undefined') {
            const targetObj = typeof target === 'object' ? target : { x: target, y: target, z: target };
            anime({
                targets: object[property],
                x: targetObj.x,
                y: targetObj.y,
                z: targetObj.z,
                duration: duration,
                easing: 'easeInOutQuad',
                complete: resolve
            });
        } else {
            // Simple linear interpolation fallback
            const start = Date.now();
            const initialPos = { 
                x: object[property].x, 
                y: object[property].y, 
                z: object[property].z 
            };
            const targetObj = typeof target === 'object' ? target : { x: target, y: target, z: target };
            
            const animate = () => {
                const elapsed = Date.now() - start;
                const progress = Math.min(elapsed / duration, 1);
                
                object[property].x = initialPos.x + (targetObj.x - initialPos.x) * progress;
                object[property].y = initialPos.y + (targetObj.y - initialPos.y) * progress;
                object[property].z = initialPos.z + (targetObj.z - initialPos.z) * progress;
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };
            animate();
        }
    }

    stopAnimation(animationId) {
        if (this.activeAnimations.has(animationId)) {
            this.activeAnimations.delete(animationId);
        }
    }

    stopAllAnimations() {
        this.activeAnimations.clear();
    }
}

window.VelocityAnimator = VelocityAnimator;
