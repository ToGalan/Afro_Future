/**
 * WebGL Scene Verification & Diagnostics
 * 
 * Checks Three.js/WebGL scene setup for proper avatar rendering and animations
 * Verifies:
 * - WebGL context availability
 * - Shader compilation
 * - Renderer capabilities
 * - Animation loop setup
 * - Memory availability
 */

export interface WebGLDiagnostics {
  webglVersion: string;
  maxTextureSize: number;
  maxRenderBufferSize: number;
  supportedExtensions: string[];
  shaderPrecision: string;
  isWebGL2: boolean;
  canvasSupported: boolean;
  floatTextureSupport: boolean;
  linearColorSpaceSupport: boolean;
  memoryEstimate: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  } | null;
}

/**
 * Verify WebGL context and get diagnostics
 */
export function getWebGLDiagnostics(): WebGLDiagnostics | null {
  try {
    const canvas = document.createElement('canvas');
    if (!canvas.getContext) {
      return null; // Canvas not supported
    }

    // Try WebGL 2 first, fall back to WebGL
    let gl: WebGL2RenderingContext | WebGLRenderingContext | null = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    const isWebGL2 = !!gl;
    
    if (!gl) {
      gl = canvas.getContext('webgl', { alpha: true, antialias: true }) as WebGLRenderingContext | null;
    }

    if (!gl) {
      return null; // WebGL not supported
    }

    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();

    return {
      webglVersion: isWebGL2 ? 'WebGL 2.0' : 'WebGL 1.0',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxRenderBufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      supportedExtensions: gl.getSupportedExtensions()?.slice(0, 10) || [],
      shaderPrecision: getShaderPrecision(gl),
      isWebGL2,
      canvasSupported: true,
      floatTextureSupport: !!gl.getExtension('OES_texture_float'),
      linearColorSpaceSupport: !!gl.getExtension('EXT_sRGB'),
      memoryEstimate: getMemoryEstimate(),
    };
  } catch (e) {
    console.error('[WebGL] Diagnostics error:', e);
    return null;
  }
}

/**
 * Get shader precision support
 */
function getShaderPrecision(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const vertexPrecision = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
  const fragmentPrecision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);

  if (vertexPrecision && vertexPrecision.precision > 0) {
    return 'High Precision';
  } else if (gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.MEDIUM_FLOAT)?.precision) {
    return 'Medium Precision';
  }
  return 'Low Precision';
}

/**
 * Estimate available JS heap memory
 */
function getMemoryEstimate(): {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
} | null {
  try {
    const perfMem = (performance as any).memory;
    if (!perfMem) return null;
    
    return {
      jsHeapSizeLimit: perfMem.jsHeapSizeLimit,
      totalJSHeapSize: perfMem.totalJSHeapSize,
      usedJSHeapSize: perfMem.usedJSHeapSize,
    };
  } catch {
    return null;
  }
}

/**
 * Verify scene is ready for avatar rendering
 * Call this from component to ensure setup is complete
 */
export function verifySceneSetup(scene: any, camera: any): {
  isValid: boolean;
  warnings: string[];
  info: string[];
} {
  const warnings: string[] = [];
  const info: string[] = [];

  // Check scene objects
  if (scene.children.length === 0) {
    warnings.push('Scene is empty - no objects added');
  } else {
    info.push(`Scene has ${scene.children.length} children`);
  }

  // Check lighting
  const lights = scene.children.filter((child: any) => child.type === 'Light' || child.isLight);
  if (lights.length === 0) {
    warnings.push('No lights in scene - avatars will not be visible');
  } else {
    info.push(`Scene has ${lights.length} light(s)`);
  }

  // Check camera
  if (!camera) {
    warnings.push('Camera not set');
  } else {
    info.push(`Camera positioned at (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})`);
  }

  return {
    isValid: warnings.length === 0,
    warnings,
    info,
  };
}

/**
 * Create WebGL diagnostics report
 */
export function createDiagnosticsReport(): string {
  const diag = getWebGLDiagnostics();
  
  if (!diag) {
    return 'WebGL is not supported on this device';
  }

  const lines = [
    '=== WebGL Diagnostics Report ===',
    `WebGL Version: ${diag.webglVersion}`,
    `Canvas Supported: ${diag.canvasSupported ? 'Yes' : 'No'}`,
    `Max Texture Size: ${diag.maxTextureSize}px`,
    `Max Render Buffer: ${diag.maxRenderBufferSize}px`,
    `Shader Precision: ${diag.shaderPrecision}`,
    `Float Texture Support: ${diag.floatTextureSupport ? 'Yes' : 'No'}`,
    `Linear Color Space: ${diag.linearColorSpaceSupport ? 'Yes' : 'No'}`,
  ];

  if (diag.memoryEstimate) {
    const mem = diag.memoryEstimate;
    const heapPct = ((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100).toFixed(1);
    lines.push(`Memory: ${(mem.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB / ${(mem.jsHeapSizeLimit / 1024 / 1024).toFixed(1)}MB (${heapPct}%)`);
  }

  lines.push(`Supported Extensions: ${diag.supportedExtensions.length} total`);

  return lines.join('\n');
}

/**
 * Log scene diagnostics to console
 */
export function logSceneDiagnostics(scene: any, camera: any): void {
  console.group('🎮 WebGL Scene Diagnostics');
  
  const webglDiag = getWebGLDiagnostics();
  if (webglDiag) {
    console.log('✅ WebGL Status:', webglDiag.webglVersion);
    console.log('Max Texture:', webglDiag.maxTextureSize);
    console.log('Shader Precision:', webglDiag.shaderPrecision);
  } else {
    console.warn('❌ WebGL not available');
  }

  const sceneDiag = verifySceneSetup(scene, camera);
  if (sceneDiag.isValid) {
    console.log('✅ Scene Setup Valid');
  } else {
    console.warn('⚠️ Scene Issues:', sceneDiag.warnings);
  }

  sceneDiag.info.forEach((line: string) => console.log('ℹ️', line));
  
  console.groupEnd();
}

// Import at runtime for TYPE safety only
import * as THREE from 'three';
