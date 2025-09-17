// js/core.js

// Game State & Core Variables
var map = [];
var memory = [];
var enemies = [];
var enemySpawnZones = [];
var activePlayerActor = null;
var allPlayerActors = [];
var pet = {};

// These are intended to be global and will be set by the selection screen in main.js, or default.
var selectedCharacterId = null;
var selectedPetType = null;

// Global state flags
var gameStarted = false;
var playerCaught = false;
var currentTurn = 1;
var currentDateString = "Y1, D1";
var _exploreComplete = false;

// Map Dimensions
const MAP_COLS = 320;
const MAP_ROWS = 240;

// Player Constants
const PLAYER_MAX_LEVEL = 20;
const XP_PER_LEVEL_BASE = 100;
const XP_PER_LEVEL_INCREASE_FACTOR = 1.3;
const PLAYER_DEFAULT_MAX_EP = 100;
const PLAYER_EP_REGEN_PER_TICK = 0.5;
const PLAYER_REGEN_TILES_MOVED = 5;
const PLAYER_REGEN_HP_PERCENT = 0.05;
const HITS_TO_KILL_PLAYER = 10;
const PLAYER_FOV_RADIUS = 5;

// Pet Constants
const MAX_PET_INVENTORY_SLOTS = 6;
const PET_DEFAULT_FOV_RADIUS = 4;
const PET_RESPAWN_COOLDOWN = 20;
const PET_TOO_FAR_THRESHOLD = 15;
const PET_ATTACK_ENEMY_EFFECTIVE_RANGE = 1;
const PET_HP_LOSS_PER_HIT_ENEMY = 5; // Changed from 0.05 to 5 (5 HP loss per hit instead of 5%)
const PET_EP_REGEN_PER_TICK = 0.25;
const PET_REGEN_TILES_MOVED = 8;
const PET_REGEN_HP_PERCENT = 0.03;
const PET_PATROL_IDEAL_DISTANCE = 3;
const PET_GUARD_PLAYER_DISTANCE = 2;
const BASE_PET_HITS_TO_KILL_ENEMY = 3;
const GAME_LOOP_SPEED = 250;


// Enemy Constants
const MAX_ENEMIES = 30;
const ENEMY_SPAWN_INTERVAL = 10000;
const ENEMY_SPAWN_ZONE_RECHARGE_MOVES = 50;

// Terrain Constants
const TILE_RESOURCES = {
    NONE: 'NONE',
    SCRAP_PILE: 'Scrap Pile',
    ENERGY_CRYSTAL: 'Energy Crystal'
};

const IMPASSABLE_TILES = new Set(['O', 'L', 'N', 'V', 'R']);

const TERRAIN_MOVEMENT_PENALTIES = {
    'P': 2, 'A': 2, 'S': 2, 'B': 2, ' ': 2, 'H': 2,
    'F': 3, 'J': 3, 'D': 2, 'M': 5, 'V': 2,
};

// For 3D Rendering
const HEX_RADIUS_3D = 1.0;
const HEX_HEIGHT_3D = 0.4;
// Civilization-style flat-topped hexes (no gap, perfect tiling)
const HEX_SPACING_FACTOR_X = HEX_RADIUS_3D * Math.sqrt(3); // Horizontal distance between centers
const HEX_SPACING_FACTOR_Z = HEX_RADIUS_3D * 1.5; // Vertical distance between centers
// In Three.js, use NO rotation (or rotateY(0)) for flat-topped hexes

const TERRAIN_HEIGHT_FACTORS = {
    'DEFAULT': 1.0, 'P': 1.0, 'A': 1.0, 'S': 1.0, 'B': 1.0, ' ': 1.0,
    'H': 1.0, 'F': 1.0, 'J': 1.0, 'D': 1.0, 'M': 1.0, 'V': 1.0,
    'O': 1.0, 'R': 1.0, 'L': 1.0, 'N': 1.0
};

// Colors
const colors = {
    'MAT_P': 0x90EE90, 'MAT_A': 0x9ACD32, 'MAT_F': 0x228B22, 'MAT_J': 0x006400,
    'MAT_L': 0x4682B4, 'MAT_N': 0x5F9EA0, 'MAT_O': 0x8B4513, 'MAT_R': 0xA0522D,
    'MAT_H': 0xBDB76B, 'MAT_D': 0xF4A460, 'MAT_M': 0x556B2F, 'MAT_V': 0x1E90FF,
    'MAT_S': 0xFFD700, 'MAT_B': 0x00FFFF, 'MAT_ ': 0x333333, 'MAT_DEFAULT': 0x777777,
    'MAT_REMEMBERED': 0x505048, 'UNSEEN': '#101010',
    'PLAYER_MINIMAP': 'yellow', 'PET_MINIMAP': 'magenta', 'ENEMY_MINIMAP': 'red'
};

// Global Three.js variables
var threeScene, threeCamera, threeRenderer, threeAmbientLight, threeDirectionalLight;
var allMapTileMeshes = [];

// FoV sets
var playerFovSet = new Set();
var petFovSet = new Set();

// Character and Pet Definitions
const CHARACTER_DEFINITIONS = {
    "nia_sankara": {
        id: "nia_sankara", name: "Nia Sankara",
        description: "A versatile pathfinder with a strong connection to the land and her companion. Balanced in exploration and support.",
        selectionImage: "img/nia.png",
        portraitImg: "img/nia.png",
        maxEp: 100,
        abilitiesSummary: [
            { name: "Power Strike", desc: "Focused melee attack." }, { name: "Rapid Scout", desc: "Temporarily boosts FoV." },
            { name: "Heal Pet", desc: "Restores pet's health." }, { name: "Ancestral Echo", desc: "Reduces terrain movement costs." }
        ]
    },
    "zuberi_adebayo": {
        id: "zuberi_adebayo", name: "Zuberi Adebayo",
        description: "A combat engineer focused on defense and area control. Excels at protecting himself and his pet.",
        selectionImage: "img/zuberi.png",
        portraitImg: "img/zuberi.png",
        maxEp: 120,
        abilitiesSummary: [
            { name: "Kinetic Barrier", desc: "Absorbs incoming damage." }, { name: "Overload Blast", desc: "Damages enemies in a cone." },
            { name: "Tactical Reposition", desc: "Short-range dash." }, { name: "System Override", desc: "Removes ability cooldowns and makes pet invulnerable." }
        ]
    }
};

const PET_TEMPLATES = {
    "cyber_mastiff": {
        typeId: "cyber_mastiff", name: "Pug Mastiff",
        description: "A sturdy and loyal combat pet, good at direct engagement and protecting its leader.",
        selectionImage: "img/pet_1.png",
        portraitImg: "img/pet_dog.png",
        baseColor: "#DA70D6", maxHp: 150, maxEp: 60, fovRadius: 3, hitsToKillFactor: 0.9,
        abilitySummary: "Offensive Tank. Strong direct combatant, can take hits.",
        abilities: [
            { name: "Charge Attack", type: "direct_damage_enemy", cost: 15, cooldown: 4, description: "A powerful charge towards an enemy." , damageFactor: 1.0, rangeBonus: 1},
            { name: "Defensive Bark", type: "buff_player_defense", cost: 20, cooldown: 8, description: "Temporarily boosts player's defense."}
        ]
    },
    "recon_kitty": {
        typeId: "recon_kitty", name: "Recon Kitty",
        description: "An agile scouting pet, excelling at reconnaissance and disrupting enemies.",
        selectionImage: "img/pet_2.png",
        portraitImg: "img/pet_cat.png",
        baseColor: "#7FFFD4", maxHp: 100, maxEp: 80, fovRadius: 8, hitsToKillFactor: 1.2,
        abilitySummary: "Scout & Debuffer. Increases visibility and can hinder foes.",
        abilities: [
            { name: "Sensor Sweep", type: "fov_boost_self", cost: 10, cooldown: 10, description: "Temporarily increases its own FoV." },
            { name: "Laser Pointer", type: "debuff_enemy_defense_player_bonus", cost: 25, cooldown: 6, description: "Highlights an enemy, making it easier for the player to hit."}
        ]
    }
};

// UI State variables
var currentZoomIndex3D = 0; // Start at 1.5x zoom (default)
const FOV_MULTIPLIERS = [1.5, 3, 6, 12];
const ZOOM_LEVEL_TEXTS = [
    "Zoom (1.5x)",
    "Zoom (3x)",
    "Zoom (6x)",
    "Zoom (12x)"
];

// Helper to calculate camera FOV angle (in degrees) for a given visible world height at a given camera distance
function calculateFOVForVisibleHeight(visibleHeight, cameraDistance) {
    // FOV = 2 * atan((visibleHeight/2) / cameraDistance) in radians, then convert to degrees
    return 2 * Math.atan((visibleHeight / 2) / cameraDistance) * (180 / Math.PI);
}

// Set up zoom levels so that the visible area matches the actor's FOV radius times the multiplier
// Use the already-declared PLAYER_FOV_RADIUS and HEX_SPACING_FACTOR_Z
const CAMERA_BASE_DISTANCE = 35; // Should match the camera height in main.js (camHeightFactor)

// Calculate the FOVs for each multiplier
const ZOOM_LEVELS_3D_FOV = FOV_MULTIPLIERS.map(multiplier => {
    const visibleGridRadius = PLAYER_FOV_RADIUS * multiplier;
    const visibleWorldHeight = (2 * visibleGridRadius) * HEX_SPACING_FACTOR_Z;
    return calculateFOVForVisibleHeight(visibleWorldHeight, CAMERA_BASE_DISTANCE);
});

function getCurrent3DFOV() { return ZOOM_LEVELS_3D_FOV[currentZoomIndex3D]; }
function getCurrent3DFOVText() {
    if (currentZoomIndex3D < 0 || currentZoomIndex3D >= ZOOM_LEVEL_TEXTS.length) return "Zoom (Unknown)";
    return ZOOM_LEVEL_TEXTS[currentZoomIndex3D];
}


var currentMinimapZoomMultiplierIndex = 0;
const MINIMAP_ZOOM_LEVEL_MULTIPLIERS = [8, 6, 4, 2];
function getCurrentMinimapEffectiveFactor() { return MINIMAP_ZOOM_LEVEL_MULTIPLIERS[currentMinimapZoomMultiplierIndex]; }

// Pet patrol state
var petCurrentPatrolTargetX = -1;
var petCurrentPatrolTargetY = -1;
var petHasValidPatrolTarget = false;

// WORLD_GEN_PARAMS
var WORLD_GEN_PARAMS = {
    lakes: { minCount: 1, countScaleFactor: 5000, sizeMin: 40, sizeMax: 80, chanceToGrow: 0.55 },
    ponds: { minCount: 2, countScaleFactor: 3000, sizeMin: 18, sizeMax: 30, chanceToGrow: 0.65 },
    rivers: { minCount: 1, countScaleFactor: 25 },
    mountainRanges: { minCount: 1, countScaleFactor: 30, targetSize: 16, mountainBlobChance: 0.3 },
    mountains: { minCount: 3, countScaleFactor: 800, sizeMin: 5, sizeMax: 30, chanceToGrow: 0.5 },
    hills: { minCount: 5, countScaleFactor: 600, sizeMin: 10, sizeMax: 40, chanceToGrow: 0.6 },
    forests: { minCount: 5, countScaleFactor: 500, sizeMin: 15, sizeMax: 60, chanceToGrow: 0.7 },
    jungles: { minCount: 2, countScaleFactor: 1000, sizeMin: 20, sizeMax: 70, chanceToGrow: 0.65 },
    deserts: { count: 1, avgWidthScaleFactor: 8, heightMinScaleFactor:10, heightMaxScaleFactor:5, density:0.8 },
    pastures: { minCount:3, countScaleFactor: 700, sizeMin:10, sizeMax:50, chanceToGrow:0.7 }
};

// NOTE: When zooming, only update threeCamera.fov and call threeCamera.updateProjectionMatrix().
// Do NOT change threeCamera.position or lookAt when cycling zoom levels. This keeps the camera angle fixed.