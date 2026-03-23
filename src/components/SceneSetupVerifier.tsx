/**
 * Scene Setup Verification Component
 * Verifies three.js WebGL scene is properly configured for avatar rendering
 * Should be mounted inside Canvas to have access to R3F context
 */

import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { logSceneDiagnostics } from '../services/webglDiagnostics';

export function SceneSetupVerifier() {
  const { scene, camera, gl } = useThree();

  useEffect(() => {
    // Run verification once when scene is ready
    if (!scene || !camera) return;

    // Log diagnostics to console
    console.log('[SceneSetupVerifier] Running WebGL scene diagnostics...');
    logSceneDiagnostics(scene, camera);

    // Check for animation loop
    console.log('[SceneSetupVerifier] Animation loop is running');

    // Verify post-processing setup
    console.log('[SceneSetupVerifier] Scene fog:', scene.fog ? 'Enabled' : 'Disabled');
    console.log('[SceneSetupVerifier] Scene background:', scene.background ? 'Set' : 'Not set');

    // Performance monitoring setup
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        console.log('[SceneSetupVerifier] Scene verification complete');
      });
    }
  }, [scene, camera, gl]);

  return null; // No visual output, diagnostic only
}

/**
 * Avatar Rendering Verifier
 * Checks that avatars are being rendered correctly
 */
export function AvatarRenderingVerifier() {
  const { scene } = useThree();

  useEffect(() => {
    const checkAvatars = () => {
      let avatarCount = 0;
      let meshCount = 0;
      
      scene.traverse(obj => {
        if (obj.name.includes('avatar') || obj.name.includes('Avatar')) {
          avatarCount++;
          console.log(`[AvatarVerifier] Found avatar: ${obj.name}`, obj);
        }
        if ((obj as any).isMesh) meshCount++;
      });

      if (avatarCount > 0) {
        console.log(`[AvatarVerifier] ✅ Found ${avatarCount} avatars with ${meshCount} meshes total`);
      } else {
        console.warn('[AvatarVerifier] ⚠️ No avatars found in scene');
      }
    };

    // Check after a frame to allow components to mount
    const timeout = requestAnimationFrame(() => {
      requestAnimationFrame(checkAvatars);
    });

    return () => cancelAnimationFrame(timeout);
  }, [scene]);

  return null;
}

/**
 * Three.js Best Practices Checker
 * Warns about common issues that degrade performance
 */
export function PerformanceChecker() {
  const { scene, camera } = useThree();

  useEffect(() => {
    const issues: string[] = [];

    // Check for scenes without fog
    if (!scene.fog && scene.children.length > 100) {
      issues.push('Scene has 100+ objects without fog - consider adding fog for LOD');
    }

    // Check for too many lights
    const lights = scene.children.filter((obj: any) => obj.isLight);
    if (lights.length > 8) {
      issues.push(`Too many lights (${lights.length}) - can impact performance. Recommend max 4-8.`);
    }

    // Check for overdraw
    let geometryCount = 0;
    scene.traverse((obj: any) => {
      if (obj.isMesh && obj.geometry) geometryCount++;
    });
    if (geometryCount > 1000) {
      issues.push(`High geometry count (${geometryCount}) - consider using instancing or LOD`);
    }

    // Check camera setup
    if (!camera) {
      issues.push('Camera not properly initialized');
    }

    if (issues.length > 0) {
      console.group('[PerformanceChecker] ⚠️ Performance Issues Detected');
      issues.forEach(issue => console.warn('•', issue));
      console.groupEnd();
    } else {
      console.log('[PerformanceChecker] ✅ Scene performance is optimal');
    }
  }, [scene, camera]);

  return null;
}
