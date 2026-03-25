// js/progress.js
function updateMissionProgress() {
  let explored = 0;
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (memory[r]?.[c] > 0) explored++;
    }
  }
  const total = MAP_COLS * MAP_ROWS;
  let percentFloat = (total > 0) ? (explored / total) * 100 : 0;
  const percentDisplay = percentFloat.toFixed(2);

  // Update the HTML element IN THE BOTTOM RIGHT HUD
  const exploredElement = document.getElementById('mapExploredPercentageHUD');
  if (exploredElement) {
    exploredElement.textContent = `Map Explored: ${percentDisplay}%`;
  }

  const percentForMission = Math.floor(percentFloat);
  if (percentForMission >= 80 && !window._exploreComplete) {
    window._exploreComplete = true;
    alert("🟡 MISSION COMPLETE: You explored over 80% of the map.");
  }
}