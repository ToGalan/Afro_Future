// js/memory.js

function initializeVisibility() {
  // CRITICAL: Ensure activePlayerActor is defined and has x, y properties
  // This function is called from resetGame in main.js AFTER selectAndInitializePlayer
  // sets up activePlayerActor.
  if (!activePlayerActor) {
    console.error("initializeVisibility: activePlayerActor is not defined! Cannot set initial visibility.");
    return;
  }

  // Use activePlayerActor's coordinates for centering initial visibility
  const initialFovRadius = 5; // The Manhattan distance for initial player visibility
  for (let r = Math.max(0, activePlayerActor.y - initialFovRadius); r <= Math.min(MAP_ROWS - 1, activePlayerActor.y + initialFovRadius); r++) {
    for (let c = Math.max(0, activePlayerActor.x - initialFovRadius); c <= Math.min(MAP_COLS - 1, activePlayerActor.x + initialFovRadius); c++) {
      // Standard Manhattan distance check for the initial square/diamond shape
      if (Math.abs(activePlayerActor.x - c) + Math.abs(activePlayerActor.y - r) <= initialFovRadius) {
        if (map[r]?.[c]) { // Check if the map tile exists
             memory[r][c] = 2; // Mark as "player directly seen"
        }
      }
    }
  }
  // console.log("Initial visibility set around player at:", activePlayerActor.x, activePlayerActor.y);
}