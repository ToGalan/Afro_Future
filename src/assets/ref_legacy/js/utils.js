// js/utils.js
// Depends on: core.js (MAP_COLS, MAP_ROWS, map, IMPASSABLE_TILES)

function drawHex(context, centerX, centerY, radius, fill) {
  context.beginPath();
  for (let i = 0; i < 6; i++) {
    const originalAngle = (Math.PI / 3) * i;
    const px = centerX + radius * Math.cos(originalAngle);
    const py = centerY + radius * Math.sin(originalAngle);
    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.fillStyle = fill;
  context.fill();
}

// Updated to read .terrain from tile object
function canPetMoveTo(x, y) {
    if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) {
        return false;
    }
    const tileData = map[y]?.[x]; // tileData is now an object {terrain: 'X', resource: Y}
    if (!tileData) { // Check if tileData itself is undefined (out of bounds after ?.)
        return false;
    }
    return !IMPASSABLE_TILES.has(tileData.terrain); // Check terrain property for impassability
}

const ODD_R_OFFSETS = {
    0: [ [1,0], [0,-1], [-1,-1], [-1,0], [-1,1], [0,1] ], // Even rows
    1: [ [1,0], [1,-1], [0,-1],  [-1,0], [0,1],  [1,1] ]  // Odd rows
};

// Calculates axial distance (number of hexes) between two hex coordinates
// Often useful for AI range checks or ability targeting
function getDistanceHex(x1, y1, x2, y2) {
    // Convert odd-r to cube coordinates for distance calculation
    const q1 = x1 - (y1 - (y1 & 1)) / 2;
    const r_1 = y1; // Renamed to avoid conflict in scope if this were inside another func
    const s1 = -q1 - r_1;

    const q2 = x2 - (y2 - (y2 & 1)) / 2;
    const r_2 = y2;
    const s2 = -q2 - r_2;

    return (Math.abs(q1 - q2) + Math.abs(r_1 - r_2) + Math.abs(s1 - s2)) / 2;
}


function getHexesInRadius(centerX, centerY, radius) {
    if (radius < 0) return [];
    const results = [];
    const queue = [[centerX, centerY, 0]]; // x, y, distance
    const visited = new Set();
    visited.add(`${centerX},${centerY}`);
    results.push([centerX, centerY]); // Add center tile
    let head = 0;
    while (head < queue.length) {
        const [currentX, currentY, dist] = queue[head++];
        if (dist >= radius) continue;
        const parity = Math.abs(currentY % 2);
        const neighborOffsets = ODD_R_OFFSETS[parity];
        if (!neighborOffsets) { console.error(`getHexesInRadius: No offsets for Y=${currentY}, parity ${parity}.`); continue; }
        for (const [dx, dy] of neighborOffsets) {
            const nextX = currentX + dx;
            const nextY = currentY + dy;
            const key = `${nextX},${nextY}`;
            if (nextX >= 0 && nextX < MAP_COLS && nextY >= 0 && nextY < MAP_ROWS) {
                if (!visited.has(key)) {
                    visited.add(key);
                    results.push([nextX, nextY]);
                    // if (dist + 1 < radius) { // This condition was too restrictive, only add to queue if we CAN explore further
                    queue.push([nextX, nextY, dist + 1]); // Always add valid neighbor to queue if within general reach for next step. Outer 'if dist>=radius' controls expansion
                    // }
                }
            }
        }
    }
    return results;
}


function drawHexEdge(ctx, centerX, centerY, radius, edgeIndex, strokeStyle, lineWidth) {
    if (!ctx) return;
    ctx.beginPath();
    const startAngle = (Math.PI / 3) * edgeIndex;
    const endAngle   = (Math.PI / 3) * (edgeIndex + 1);
    const x1 = centerX + radius * Math.cos(startAngle);
    const y1 = centerY + radius * Math.sin(startAngle);
    const x2 = centerX + radius * Math.cos(endAngle);
    const y2 = centerY + radius * Math.sin(endAngle);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
}

function drawHexOutline(ctx, centerX, centerY, radius, strokeStyle, lineWidth) {
    if (!ctx) return;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const originalAngle = (Math.PI / 3) * i;
        const px = centerX + radius * Math.cos(originalAngle);
        const py = centerY + radius * Math.sin(originalAngle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
}
