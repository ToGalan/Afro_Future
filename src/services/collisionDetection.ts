/**
 * Avatar-Floor Collision Detection System
 * 
 * Prevents avatars (player, pets) from falling through floor tiles
 * Uses raycasting to detect ground level and clamps position
 */

import * as THREE from 'three';

export interface CollisionConfig {
  rayDirection: THREE.Vector3;     // Direction to cast ray (default: down)
  rayLength: number;                // How far to search for floor
  floorOffset: number;              // Height above floor surface
  debugVisualize?: boolean;         // Show debug rays
}

export const DEFAULT_COLLISION_CONFIG: CollisionConfig = {
  rayDirection: new THREE.Vector3(0, -1, 0), // Cast downward
  rayLength: 10,                              // Search up to 10 units down
  floorOffset: 0.1,                           // Stay 0.1 units above floor
  debugVisualize: false,
};

/**
 * Raycaster for floor collision
 * Reused across frames to avoid allocation churn
 */
let sharedRaycaster: THREE.Raycaster | null = null;

function getRaycaster(): THREE.Raycaster {
  if (!sharedRaycaster) {
    sharedRaycaster = new THREE.Raycaster();
  }
  return sharedRaycaster;
}

/**
 * Check collision with floor mesh
 * Returns the distance to floor, or null if no collision
 */
export function raycastFloor(
  position: THREE.Vector3,
  floorMesh: THREE.Mesh | THREE.Group,
  config: CollisionConfig = DEFAULT_COLLISION_CONFIG
): number | null {
  const raycaster = getRaycaster();
  
  // Create ray from avatar position downward
  const rayOrigin = position.clone();
  const rayDirection = config.rayDirection.clone().normalize();
  
  raycaster.set(rayOrigin, rayDirection);
  
  // Get all objects to test against
  const testObjects: THREE.Object3D[] = [];
  if (floorMesh instanceof THREE.Group) {
    floorMesh.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        testObjects.push(obj);
      }
    });
  } else {
    testObjects.push(floorMesh);
  }
  
  if (testObjects.length === 0) return null;
  
  // Cast rays and find nearest intersection
  const intersections = raycaster.intersectObjects(testObjects, true);
  
  if (intersections.length > 0) {
    // Return distance to first intersection
    return intersections[0].distance;
  }
  
  return null;
}

/**
 * Calculate clamped Y position to stay on floor
 */
export function clampAvatarToFloor(
  currentPosition: THREE.Vector3,
  floorDistance: number | null,
  config: CollisionConfig = DEFAULT_COLLISION_CONFIG
): number {
  if (floorDistance === null) {
    // No floor detected, allow normal positioning
    return currentPosition.y;
  }
  
  // Position avatar so feet touch floor surface
  // Avatar is at position Y, floor is at position.y - floorDistance
  const floorY = currentPosition.y - floorDistance;
  const desiredY = floorY + config.floorOffset;
  
  return Math.max(desiredY, currentPosition.y); // Don't push avatar down if it's elevated
}

/**
 * Setup floor collider for avatar
 * Creates an invisible plane for collision testing
 */
export function createFloorCollider(size: number, position: THREE.Vector3 = new THREE.Vector3(0, 0, 0)): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(size, size);
  const material = new THREE.MeshBasicMaterial({ 
    transparent: true, 
    opacity: 0,
    side: THREE.DoubleSide 
  });
  
  const plane = new THREE.Mesh(geometry, material);
  plane.position.copy(position);
  plane.rotation.x = -Math.PI / 2; // Rotate to face up
  plane.userData.type = 'floor-collider';
  
  return plane;
}

/**
 * Debug visualization for collision rays
 */
export function visualizeCollisionRay(
  position: THREE.Vector3,
  distance: number | null,
  config: CollisionConfig = DEFAULT_COLLISION_CONFIG
): THREE.Line | null {
  if (!config.debugVisualize) return null;
  
  const targetDist = distance ?? config.rayLength;
  const rayEnd = position.clone().addScaledVector(config.rayDirection, targetDist);
  
  const geometry = new THREE.BufferGeometry().setFromPoints([position, rayEnd]);
  const material = new THREE.LineBasicMaterial({ 
    color: distance ? 0x00ff00 : 0xff0000, 
    linewidth: 2 
  });
  
  return new THREE.Line(geometry, material);
}

/**
 * Update avatar collision each frame
 * Should be called from useFrame or equivalent
 */
export function updateAvatarCollision(
  avatarWorldPos: THREE.Vector3,
  avatarGroupRef: React.MutableRefObject<THREE.Group | null>,
  floorCollider: THREE.Mesh | THREE.Group,
  config: CollisionConfig = DEFAULT_COLLISION_CONFIG
): void {
  if (!avatarGroupRef.current) return;
  
  const floorDist = raycastFloor(avatarWorldPos, floorCollider, config);
  const clampedY = clampAvatarToFloor(avatarWorldPos, floorDist, config);
  
  // Update avatar position to clamp to floor
  if (Math.abs(clampedY - avatarGroupRef.current.position.y) > 0.001) {
    avatarGroupRef.current.position.y = clampedY;
  }
}
