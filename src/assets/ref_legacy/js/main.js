// main.js
// js/main.js
// Removed: var threeScene, threeCamera, threeRenderer, threeLights; 
// These are now expected to be globally available from core.js

// import ChibiNia from './actors/chibinia.js';
// import ChibiActor from './actors/chibi_actor.js';

var threeHexGroup, threeActorGroup; // Specific to main.js scene composition
var isInitialGameStart = true;
var cachedMaterials = {}; // Specific to main.js tile creation logic

// Camera following constants
const CAMERA_DIRECTION_OFFSET = new THREE.Vector3(-0.35, 0.75, 0.55).normalize(); 
const TARGET_PLAYER_FOV_MULTIPLIER = 1.2; // How much of the player's FOV radius (in world units) the camera should try to keep in view.

var preComputedHexGeo; // Removed preComputedLineGeo as it wasn't used

// Use only GLTFLoader for .glb files
// REMOVE all GLTFLoader/playerActorGLBModel code:
//// let niaGLBModel = null;
//// let zuberiGLBModel = null;
//// let playerActorGLBModel = null; // Single model for player characters
//// const GLTFLoader = window.GLTFLoader || (THREE.GLTFLoader ? THREE.GLTFLoader : null);
//// const DRACOLoader = window.DRACOLoader || (THREE.DRACOLoader ? THREE.DRACOLoader : null);
//
// if (GLTFLoader) {
//     const loader = new GLTFLoader();
//
//     if (DRACOLoader) {
//         const dracoLoader = new DRACOLoader();
//         // Adjust this path if your Draco decoder files are located elsewhere.
//         // For the CDN, this path points to the directory containing draco_decoder.wasm, etc.
//         dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/libs/draco/');
//         loader.setDRACOLoader(dracoLoader);
//     } else {
//         console.warn("DRACOLoader not found. Draco-compressed GLTF models may not load correctly.");
//     }
//
//     loader.load('assets/base_actor.glb', (gltf) => {
//         playerActorGLBModel = gltf.scene; // Load into the shared variable
//         playerActorGLBModel.traverse(child => {
//             if (child.isMesh) {
//                 child.castShadow = true;
//                 child.receiveShadow = true;
//             }
//         });
//     }, undefined, (err) => {
//         console.error("Failed to load player actor GLB model (base_actor.glb):", err);
//     });
// } else {
//     console.warn("GLTFLoader not found. 3D character models will not be used.");
// }


// Global variables for main.js
var gameLoopIntervalId = null;
var enemySpawnIntervalId = null;

// Global functions (implemented inside DOMContentLoaded for scope access)
window.updateThreeJSEntities = null;
window.resetGame = null;

document.addEventListener('DOMContentLoaded', () => {

    const toggleZoomBtn = document.getElementById('toggleZoomBtn');
    const toggleMinimapZoomBtn = document.getElementById('toggleMinimapZoomBtn');
    const selectionScreen = document.getElementById('selectionScreen');
    const characterChoicesDiv = document.getElementById('characterChoices');
    const petChoicesDiv = document.getElementById('petChoices');
    const startGameBtn = document.getElementById('startGameBtn');
    const loadingOverlay = document.getElementById('loading-overlay');

    // Elements for the new game loading progress bar
    let gameLoadingProgressBarContainer = null;
    let gameLoadingProgressBar = null;
    let gameLoadingProgressText = null;

    var localSelectedCharacterId = null;
    var localSelectedPetType = null;

    let currentSelectedCharacterCard = null;
    let currentSelectedPetCard = null;
    let activeCardAnimations = new Map();

    function updateGameLoadingProgress(percentage, text) {
        if (gameLoadingProgressBar && gameLoadingProgressText && gameLoadingProgressBarContainer) {
            const cleanPercentage = Math.max(0, Math.min(100, percentage));
            gameLoadingProgressBar.style.width = `${cleanPercentage}%`;
            gameLoadingProgressText.textContent = text || "Loading the Game...";

            if (gameLoadingProgressBarContainer.style.display === 'none' && cleanPercentage < 100) {
                 gameLoadingProgressBarContainer.style.display = 'flex';
            }

            if (cleanPercentage >= 100) {
                // Optional: slight delay before hiding to show 100%
                setTimeout(() => {
                    if (gameLoadingProgressBarContainer) gameLoadingProgressBarContainer.style.display = 'none';
                }, 500); // Increased delay to see "Game Ready!"
            }
        } else {
            console.warn("Progress bar elements not found, cannot update progress.");
        }
    }

    function selectAndInitializePlayer(characterId) {
        console.log(`Main.js: selectAndInitializePlayer for ID: ${characterId}`);
        let newPlayerInstance = null;
        const startX = Math.floor(MAP_COLS / 2);
        const startY = Math.floor(MAP_ROWS / 2);
        let charDef = CHARACTER_DEFINITIONS[characterId];

        if (!charDef) {
            console.warn(`Main.js: Char def for ID "${characterId}" not found. Defaulting.`);
            characterId = Object.keys(CHARACTER_DEFINITIONS)[0] || "nia_sankara";
            charDef = CHARACTER_DEFINITIONS[characterId];
            if (!charDef) {
                console.error("Main.js CRITICAL: NO character definitions found!");
                activePlayerActor = {id: "ULTRA_EMERGENCY_PLAYER", name: "NO CHARS PLAYER", x: startX, y: startY, color:'fuchsia', hp:1,maxHp:1,ep:0,maxEp:0,isDefeated:true, abilities:[],takeDamage:function(){}};
                allPlayerActors=[activePlayerActor];
                return;
            }
        }
        
        if (typeof NiaActor === 'function' && characterId === "nia_sankara") {
            newPlayerInstance = new NiaActor(startX, startY);
        } else if (typeof ZuberiActor === 'function' && characterId === "zuberi_adebayo") {
            newPlayerInstance = new ZuberiActor(startX, startY);
        } else {
            console.warn(`Main.js: Specific Actor class for ${characterId} (e.g., ${characterId.split("_")[0].charAt(0).toUpperCase() + characterId.split("_")[0].slice(1)}Actor) not found or not a function. Attempting generic BaseActor fallback.`);
             if (typeof BaseActor === 'function') { 
                 newPlayerInstance = new BaseActor(charDef.id, charDef.name, startX, startY, (characterId === "zuberi_adebayo" ? 120: 100), charDef.maxEp || PLAYER_DEFAULT_MAX_EP, charDef.portraitImg);
                 console.warn(`Main.js: Instantiated ${characterId} using generic BaseActor as a fallback. Ensure specific actor class is loaded.`);
            } else {
                console.error(`Main.js CRITICAL: BaseActor class is also MISSING! Cannot create any player instance for ${characterId}.`);
                newPlayerInstance = {id: `FAIL_${characterId}`, name: `ERROR ${charDef.name}`, x:startX, y:startY, hp:1,maxHp:1,ep:1,maxEp:1,isDefeated:true,portraitImg:"img/nia.png", abilities:[],takeDamage:()=>{},hasEnoughEp:()=>false,consumeEp:()=>{}};
            }
        }

        if (newPlayerInstance) {
            activePlayerActor = newPlayerInstance;

            // Ensure portraitImg from definition is used. Prioritize charDef.portraitImg.
            if (charDef.portraitImg) {
                activePlayerActor.portraitImg = charDef.portraitImg;
            } else if (!activePlayerActor.portraitImg) {
                // If charDef doesn't have one AND actor instance doesn't have one from constructor, set a generic fallback.
                // This ensures activePlayerActor.portraitImg always has *some* value if possible.
                activePlayerActor.portraitImg = ""; // Set to empty or a specific "img/default_actor.png" if you have one
                console.warn(`Main.js: No portrait for ${activePlayerActor.name} (ID: ${charDef.id}) from definition or constructor. Portrait will be N/A or fallback.`);
            }

            if (charDef.maxEp && (!activePlayerActor.maxEp || activePlayerActor.maxEp === PLAYER_DEFAULT_MAX_EP)) activePlayerActor.maxEp = charDef.maxEp;
            if(!activePlayerActor.ep || activePlayerActor.ep === PLAYER_DEFAULT_MAX_EP || activePlayerActor.ep > activePlayerActor.maxEp) activePlayerActor.ep = activePlayerActor.maxEp;
            
            // Ensure 'id' from definition is used if constructor didn't set a unique one or used a placeholder
            if (!activePlayerActor.id || activePlayerActor.id === "placeholder_id" || (activePlayerActor.id !== charDef.id && (activePlayerActor.id === "nia_sankara" || activePlayerActor.id === "zuberi_adebayo"))) {
                activePlayerActor.id = charDef.id;
            }
            activePlayerActor.isDefeated = false;
        } else {
            console.error(`Main.js: Player instance creation FAILED critically for ${characterId}. Setting absolute minimal placeholder.`);
            activePlayerActor = {
                id: "EMERGENCY_PLAYER_INSTANCE_FAIL", name: "Lost Soul III", x: startX, y: startY,
                color: 'darkgrey', hp: 1, maxHp: 1, ep: 1, maxEp: 1, isDefeated: false, portraitImg: "img/nia.png", abilities:[],
                takeDamage:function(){ this.hp=0; this.isDefeated=true; window.playerCaught=true; if(typeof addNotification==='function') addNotification("Fallback player CRUSHED!",'critical');},
                hasEnoughEp: function(){return false;},
                consumeEp: function(){return false;}
            };
        }
        allPlayerActors = [activePlayerActor]; 
        console.log("Main.js: Active player init complete:", activePlayerActor.name, `(ID: ${activePlayerActor.id}, HP: ${activePlayerActor.hp}/${activePlayerActor.maxHp}, EP: ${activePlayerActor.ep}/${activePlayerActor.maxEp})`);
    }

    function initializeWorldMap() { 
        if (!activePlayerActor || typeof activePlayerActor.x !== 'number') {
            console.error("initializeWorldMap: Active player invalid/not ready. Re-attempting init.");
            selectAndInitializePlayer(selectedCharacterId || Object.keys(CHARACTER_DEFINITIONS)[0]);
            if (!activePlayerActor || typeof activePlayerActor.x !== 'number') {
                console.error("initializeWorldMap CRITICAL: Player re-init FAILED. Aborting map data gen.");
                return;
            }
        }
        console.log("Main.js: Initializing logical map array...");

        map = Array(MAP_ROWS).fill(null).map(() => Array(MAP_COLS).fill(null).map(() => ({ terrain: 'P', resource: TILE_RESOURCES.NONE })) );
        memory = Array(MAP_ROWS).fill(null).map(() => Array(MAP_COLS).fill(0));


        const mA=MAP_COLS*MAP_ROWS; const mSA=Math.sqrt(mA); const WGP=WORLD_GEN_PARAMS || {}; // Ensure WGP exists
         const wgFuncs=[
            {n:"Lakes/Ponds",f:generateLakesAndPonds,a:[Math.max((WGP.lakes||{}).minCount||1,Math.floor(mA/((WGP.lakes||{}).countScaleFactor||5000))),Math.max((WGP.ponds||{}).minCount||2,Math.floor(mA/((WGP.ponds||{}).countScaleFactor||3000)))]},
            {n:"Rivers",f:generateRivers,a:[Math.max((WGP.rivers||{}).minCount||1,Math.floor(mSA/((WGP.rivers||{}).countScaleFactor||25)))]},
            {n:"MtnRanges",f:generateMountainRanges,a:[Math.max((WGP.mountainRanges||{}).minCount||1,Math.floor(mSA/((WGP.mountainRanges||{}).countScaleFactor||30)))]},
            {n:"Mtns",f:generateMountains,a:[Math.max((WGP.mountains||{}).minCount||3,Math.floor(mA/((WGP.mountains||{}).countScaleFactor||800)))]},
            {n:"Hills",f:generateHills,a:[Math.max((WGP.hills||{}).minCount||5,Math.floor(mA/((WGP.hills||{}).countScaleFactor||600)))]},
            {n:"Forests",f:generateForests,a:[Math.max((WGP.forests||{}).minCount||5,Math.floor(mA/((WGP.forests||{}).countScaleFactor||500)))]},
            {n:"Jungles",f:generateJungles,a:[Math.max((WGP.jungles||{}).minCount||2,Math.floor(mA/((WGP.jungles||{}).countScaleFactor||1000)))]},
            {n:"Deserts",f:generateDeserts,a:[(WGP.deserts||{}).count||1]},
            {n:"Pastures",f:generatePastures,a:[Math.max((WGP.pastures||{}).minCount||3,Math.floor(mA/((WGP.pastures||{}).countScaleFactor||700)))]}
        ];

        console.log("Main.js: Generating terrain features...");

        wgFuncs.forEach(g => {
            if(typeof g.f==='function'){
                try{ g.f(...g.a); } 
                catch(err){ console.error(`WorldGen Error during ${g.n}:`,err); }
            } else {
                console.error(`WorldGen Func MISSING for terrain type: ${g.n}`);
            }
        });

        const startTileX = Math.floor(MAP_COLS / 2);
        const startTileY = Math.floor(MAP_ROWS / 2);

        if (map[startTileY] && map[startTileY][startTileX]) { map[startTileY][startTileX].terrain = 'S'; map[startTileY][startTileX].resource = TILE_RESOURCES.NONE; }
        else { console.warn(`Could not place Start tile at map center (${startTileX}, ${startTileY}). Check map dimensions.`); }
        
        const centralX = Math.floor(MAP_COLS / 2); // Keep beacon relative to map center column, but at opposite end
        if (map[MAP_ROWS-2] && map[MAP_ROWS-2][centralX]) { map[MAP_ROWS-2][centralX].terrain = 'B'; map[MAP_ROWS-2][centralX].resource = TILE_RESOURCES.NONE;}
        else { console.warn("Map too small for Beacon tile y=MAP_ROWS-2 default. Trying last row."); if(map[MAP_ROWS-1]&&map[MAP_ROWS-1][centralX]){map[MAP_ROWS-1][centralX].terrain='B';map[MAP_ROWS-1][centralX].resource = TILE_RESOURCES.NONE;}}
        
        if (typeof generateTileResources === 'function') {
            console.log("Main.js: Generating tile resources...");
            generateTileResources(map); 
        } else {
            console.error("Main.js - initializeWorldMap: generateTileResources function not found from world_gen.js!");
        }
        
        console.log("Main.js: Creating enemy spawn zones...");

        enemySpawnZones=[]; 
        const numSpawnZones = Math.floor((mA)/27000) + Math.min(4,Math.floor(MAP_COLS/110)) + 1; // ensure at least one
        for(let i=0; i<numSpawnZones; i++){
            let zx,zy,att=0;
            do {
                zx=Math.floor(Math.random()*MAP_COLS);
                zy=Math.floor(Math.random()*MAP_ROWS);
                att++;
            } while(
                (
                    (map[zy]?.[zx] && (IMPASSABLE_TILES.has(map[zy][zx].terrain) || map[zy][zx].terrain==='S' || map[zy][zx].terrain==='B')) ||
                    (map[zy]?.[zx]?.terrain==='V' && Math.random()<0.88) 
                ) && att<160
            );
            if(att<160 && map[zy] && map[zy][zx]) { 
                 enemySpawnZones.push({x:zx,y:zy,isActive:true,rechargeProgress:0});
            }
        }
        console.log(`Main.js: World map & initial resources generated. ${enemySpawnZones.length} Enemy Spawn Zones created.`);
    }

    function updateStartButtonState() {
        if(startGameBtn){
            // Use the local variables from main.js scope for UI logic
            const canStart = localSelectedCharacterId && localSelectedPetType;
            const newDisabledState = !canStart;
            if(startGameBtn.disabled !== newDisabledState){
                startGameBtn.disabled = newDisabledState;
                if(typeof anime !== 'undefined') {
                    anime({ targets:startGameBtn, scale: canStart ? [0.95,1] : [1,0.95], opacity: canStart ? [0.8,1] : [1,0.8], duration:250, easing:'easeInOutQuad' });
                }
            }
        }
    }

    function createChoiceCard(item, type) {
        const card = document.createElement('div');
        card.classList.add('choice-card');
        card.dataset.id = item.id || item.typeId; 
        card.dataset.type = type;

        const img = document.createElement('img');
        img.classList.add('selector-image');
        let defaultImgPath = (type === 'character') ? "img/nia.png" : "img/pet_1.png"; // More specific defaults
        img.src = item.selectionImage || defaultImgPath;
        img.alt = item.name;
        img.onerror = () => { console.warn(`CardImgErr: ${item.name} (${item.selectionImage || 'No img path'}). Defaulting.`); img.src = defaultImgPath; img.onerror = null; };
        card.appendChild(img);

        const detailsDiv = document.createElement('div');
        detailsDiv.classList.add('choice-details');
        const nameHeader = document.createElement('h4');
        nameHeader.textContent = item.name;
        detailsDiv.appendChild(nameHeader);
        const descriptionP = document.createElement('p');
        descriptionP.classList.add('description');
        descriptionP.textContent = item.description || "No description available.";
        detailsDiv.appendChild(descriptionP);

        const abilitiesSummarySource = (type === 'character' && item.abilitiesSummary) ? item.abilitiesSummary : (type === 'pet' && item.abilitySummary ? [{name: "Role", desc: item.abilitySummary}] : ( (item.abilities && type === 'pet') ? item.abilities.map(ab => ({name: ab.name, desc:ab.description})) : [] ) );
        if(abilitiesSummarySource.length > 0){
            const abilitiesDiv = document.createElement('div'); abilitiesDiv.classList.add('abilities-summary');
            abilitiesDiv.innerHTML = `<strong>${(type === 'pet' && item.abilitySummary) ? '' : 'Abilities:'}</strong>`; // Simpler for pets with just one summary line
            const abilitiesUl = document.createElement('ul');
            abilitiesSummarySource.forEach(ab => {
                const listItem = document.createElement('li');
                listItem.innerHTML = `<strong>${ab.name || (type === 'pet' && item.abilitySummary ? item.abilitySummary : '?')}</strong>${ab.desc ? (': '+ ab.desc) : ''}`;
                abilitiesUl.appendChild(listItem);
            });
            abilitiesDiv.appendChild(abilitiesUl);
            detailsDiv.appendChild(abilitiesDiv);
        }
        card.appendChild(detailsDiv);

        if (typeof anime !== 'undefined') {
            card.addEventListener('mouseenter', () => {
                if (activeCardAnimations.has(card) && activeCardAnimations.get(card).playing) activeCardAnimations.get(card).pause();
                const isSelected = card.classList.contains('selected-by-js');
                activeCardAnimations.set(card, anime({ targets: card, translateY: isSelected ? -2 : -5, scale: isSelected ? 1.01 : 1.04, boxShadow: isSelected ? '0 0 20px rgba(255,215,0,0.6)' : '0 8px 18px rgba(255,215,0,0.35)', borderColor: '#FFD700', duration: 200, easing: 'easeOutQuad' }));
            });
            card.addEventListener('mouseleave', () => {
                if (activeCardAnimations.has(card) && activeCardAnimations.get(card).playing) activeCardAnimations.get(card).pause();
                const isSelected = card.classList.contains('selected-by-js');
                activeCardAnimations.set(card, anime({ targets: card, translateY: isSelected ? -2 : 0, scale: isSelected ? 1.01 : 1, boxShadow: isSelected ? '0 0 20px rgba(255,215,0,0.6)' : '0 3px 6px rgba(0,0,0,0.4)', borderColor: isSelected ? '#FFD700' : '#444', duration: 250, easing: 'easeOutQuad' }));
            });
        }

        card.addEventListener('click', () => {
            let previouslySelectedCard = null;
            const targetListClass = 'selected-by-js';
            const thisCardIsSelected = card.classList.contains(targetListClass);
            console.log(`Card clicked - Type: ${type}, ID: ${card.dataset.id}`); // Debug Log

            if (type === 'character') {
                previouslySelectedCard = currentSelectedCharacterCard;
                if (currentSelectedCharacterCard && currentSelectedCharacterCard !== card) {
                    currentSelectedCharacterCard.classList.remove(targetListClass);
                }
                if (thisCardIsSelected) {
                    card.classList.remove(targetListClass);
                    currentSelectedCharacterCard = null;
                    localSelectedCharacterId = null; // Update local var
                } else {
                    card.classList.add(targetListClass);
                    currentSelectedCharacterCard = card;
                    localSelectedCharacterId = card.dataset.id; // Update local var
                }
            } else if (type === 'pet') {
                previouslySelectedCard = currentSelectedPetCard;
                if (currentSelectedPetCard && currentSelectedPetCard !== card) {
                    currentSelectedPetCard.classList.remove(targetListClass);
                }
                if (thisCardIsSelected) {
                    card.classList.remove(targetListClass);
                    currentSelectedPetCard = null;
                    localSelectedPetType = null; // Update local var
                } else {
                    card.classList.add(targetListClass);
                    currentSelectedPetCard = card;
                    localSelectedPetType = card.dataset.id; // Update local var
                }
            }

            console.log(`After click - localSelectedCharacterId: ${localSelectedCharacterId}, localSelectedPetType: ${localSelectedPetType}`); // Debug Log

            if (typeof anime !== 'undefined') {
                if (previouslySelectedCard && previouslySelectedCard !== card) {
                    if(activeCardAnimations.has(previouslySelectedCard) && activeCardAnimations.get(previouslySelectedCard).playing) activeCardAnimations.get(previouslySelectedCard).pause();
                    activeCardAnimations.set(previouslySelectedCard, anime({ targets: previouslySelectedCard, translateY: 0, scale: 1, backgroundColor: '#1e1e24', borderColor: '#444', boxShadow: '0 3px 6px rgba(0,0,0,0.4)', duration: 200, easing: 'easeOutQuad' }));
                }
                const isNowSel = card.classList.contains(targetListClass);
                 activeCardAnimations.set(card, anime({ targets: card, translateY: isNowSel ? -2 : (card.matches(':hover') ? -5 : 0), scale: isNowSel ? 1.01 : (card.matches(':hover') ? 1.04 : 1), backgroundColor: isNowSel ? '#2a2a33' : '#1e1e24', borderColor: isNowSel ? '#FFD700' : (card.matches(':hover') ? '#FFD700' : '#444'), boxShadow: isNowSel ? '0 0 20px rgba(255,215,0,0.6)' : (card.matches(':hover') ? '0 8px 18px rgba(255,215,0,0.35)' : '0 3px 6px rgba(0,0,0,0.4)'), duration: 150, easing: 'easeInOutQuad' }));
            }
            updateStartButtonState();
        });
        return card;
    }

    function populateSelectionOptions() {
        if (characterChoicesDiv && typeof CHARACTER_DEFINITIONS === 'object' && Object.keys(CHARACTER_DEFINITIONS).length > 0) {
            characterChoicesDiv.innerHTML = ''; 
            Object.values(CHARACTER_DEFINITIONS).forEach(cD => characterChoicesDiv.appendChild(createChoiceCard(cD, 'character')));
        } else console.warn("Main.js populate: Character choices div or CHARACTER_DEFINITIONS error.");

        if (petChoicesDiv && typeof PET_TEMPLATES === 'object' && Object.keys(PET_TEMPLATES).length > 0) {
            petChoicesDiv.innerHTML = ''; 
            Object.values(PET_TEMPLATES).forEach(pD => petChoicesDiv.appendChild(createChoiceCard(pD, 'pet')));
        } else console.warn("Main.js populate: Pet choices div or PET_TEMPLATES error.");
        updateStartButtonState();
    }

    function startGameWithSelections() {
        // Use local variables from UI for validation
        if (!localSelectedCharacterId || !localSelectedPetType) {
            if (typeof addNotification === 'function') addNotification("Leader & Companion selection required!", "critical", 5000);
            else alert("Select Leader & Pet!");
            return;
        }
        // Crucially, transfer local selections to the global (core.js) variables
        // These global variables will be used by resetGame and other game logic.
        selectedCharacterId = localSelectedCharacterId;
        selectedPetType = localSelectedPetType;

        console.log("Main.js startGameWithSelections - Global IDs set - Char:", selectedCharacterId, "Pet:", selectedPetType, "- Preparing to show loading screen.");

        // Show loading progress screen FIRST, before selection screen fades or resetGame starts.
        // This makes it the "splash screen" for world generation.
        if (gameLoadingProgressBarContainer) {
            updateGameLoadingProgress(0, "Game Loading..."); // This will set display:flex
        } else {
            console.warn("Progress bar container not found at start of startGameWithSelections. Loading screen will not show.");
        }

        // Use the selectionScreen variable from the DOMContentLoaded scope
        if (selectionScreen) {
            selectionScreen.style.opacity = '0';
            setTimeout(() => {
                if (selectionScreen) selectionScreen.style.display = 'none';
                
                // Game setup starts AFTER selection screen is hidden and progress bar is (hopefully) shown
                isInitialGameStart = true;
                gameStarted = true;
                if (typeof resetGame === 'function') {
                    resetGame(); // resetGame will continue updating the progress
                } else {
                    console.error("CRIT ERR: resetGame() function is missing or not defined!");
                    if (gameLoadingProgressBarContainer) gameLoadingProgressBarContainer.style.display = 'none'; // Hide if resetGame fails
                }
            }, 500); 
        } else {
            console.warn("Selection screen UI element (#selectionScreen) missing. Proceeding with default start logic.");
            // If selectionScreen is missing, selectedCharacterId and selectedPetType should already be set by localSelected...
            // or have defaults from core.js if this function was called programmatically without UI interaction.
            // Progress bar should have been shown by the block above.

            // Ensure global IDs are set if they weren't from local selections (e.g. if UI was skipped)
            if (!selectedCharacterId) selectedCharacterId = Object.keys(CHARACTER_DEFINITIONS)[0] || "nia_sankara";
            if (!selectedPetType) selectedPetType = Object.keys(PET_TEMPLATES)[0] || "cyber_mastiff";

        // Also set main.js local variables for consistency if any UI depended on them here, though not typical for default path.
        localSelectedCharacterId = selectedCharacterId;
        localSelectedPetType = selectedPetType;

        console.log("Main.js Default Start - Global IDs set - Char:", selectedCharacterId, "Pet:", selectedPetType); // Confirm global IDs are set

        isInitialGameStart = true;
        gameStarted = true; // Global from core.js
        if (typeof resetGame === 'function') {
            resetGame(); // resetGame will continue updating the progress
        } else {
            console.error("CRIT ERR: resetGame() function is missing or not defined for default start path!");
            if (gameLoadingProgressBarContainer) gameLoadingProgressBarContainer.style.display = 'none'; // Hide if resetGame fails
        }
     }
    }
    
    // Implementation of resetGame function
    window.resetGame = function() {
        console.log("Main.js: resetGame started - initializing game world...");
        
        try {
            // Update progress: Player setup
            updateGameLoadingProgress(10, "Setting up leader...");
            
            // Initialize player first
            if (!selectedCharacterId) { selectedCharacterId = "nia_sankara"; console.warn("Main.js: No character selected, defaulting to Nia Sankara."); }
            selectAndInitializePlayer(selectedCharacterId);
            
            if (!activePlayerActor) { console.error("Main.js: Player actor not initialized after selection!"); return; }
            
            // Update progress: Pet setup
            updateGameLoadingProgress(25, "Preparing companion...");
            
            // Initialize pet
            if (!selectedPetType) { selectedPetType = "PET_CAT"; console.warn("Main.js: No pet type selected, defaulting to Cat."); }
            
            const petStartX = activePlayerActor.x + 1;
            const petStartY = activePlayerActor.y;
            
            if (typeof initializePetFromSelection === 'function') { initializePetFromSelection(petStartX, petStartY); } else { console.error("Main.js: initializePetFromSelection function not found!"); }
            
            // Update progress: World generation
            updateGameLoadingProgress(40, "Generating world...");
            
            // Initialize world map
            initializeWorldMap();
            
            // Update progress: Memory initialization
            updateGameLoadingProgress(60, "Setting up visibility...");
            
            // Initialize memory/visibility system
            if (typeof initializeVisibility === 'function') { initializeVisibility(activePlayerActor); } else { console.warn("Main.js: initializeVisibility function not found."); }
            
            // Update progress: 3D setup
            updateGameLoadingProgress(75, "Setting up 3D world...");
            
            // Initialize Three.js if not already done
            if (!threeScene || !threeCamera || !threeRenderer) {
                if (!initializeThreeJS()) {
                    console.error("Main.js: Three.js initialization failed. Aborting resetGame.");
                    updateGameLoadingProgress(100, "3D Setup Failed!");
                    if (typeof addNotification === 'function') addNotification("3D World setup failed. Game cannot start.", "critical", 0);
                    return; // Critical failure
                }
            }

            // Ensure actor 3D positions are calculated before creating representations
            if (activePlayerActor) updateActor3DPosition(activePlayerActor);
            if (pet) updateActor3DPosition(pet);

            // Create 3D representation for player
            if (activePlayerActor && threeActorGroup) {
                console.log("Main.js: Attempting to create 3D representation for player:", activePlayerActor.id);
                const playerMesh = createThreeJSActorRepresentation(activePlayerActor);
                if (playerMesh) {
                    threeActorGroup.add(playerMesh);
                    console.log("Main.js: Player 3D representation added to threeActorGroup.");
                } else {
                    console.error("Main.js: Failed to create 3D representation for player.");
                }
            }

            // Create 3D representation for pet
            if (pet && threeActorGroup) {
                console.log("Main.js: Attempting to create 3D representation for pet:", pet.id || pet.typeId);
                const petMesh = createThreeJSActorRepresentation(pet);
                if (petMesh) {
                    threeActorGroup.add(petMesh);
                     // Store mesh on pet object if it's a primitive and doesn't have one.
                    if (!pet.mesh) { // ChibiActor types would have .mesh
                        pet.threeMesh = petMesh;
                    }
                    console.log("Main.js: Pet 3D representation added to threeActorGroup.");
                } else {
                    console.error("Main.js: Failed to create 3D representation for pet.");
                }
            }
            
            // Populate 3D map
            populateThreeJSMap();
            
            // Update progress: Final setup
            updateGameLoadingProgress(90, "Final preparations...");
            
            // Clear any existing game loops
            if (gameLoopIntervalId) {
                clearInterval(gameLoopIntervalId);
                gameLoopIntervalId = null;
            }
            if (enemySpawnIntervalId) {
                clearInterval(enemySpawnIntervalId);
                enemySpawnIntervalId = null;
            }              // Start main game loop
            gameLoopIntervalId = setInterval(() => {                // Check for player death and restart game
                if (activePlayerActor && (activePlayerActor.isDefeated || window.playerCaught)) {
                    console.log("Main.js: Player defeated detected - isDefeated:", activePlayerActor.isDefeated, "playerCaught:", window.playerCaught);
                    if (typeof addNotification === 'function') {
                        addNotification("You have been defeated! Restarting game...", 'critical');
                    }
                    setTimeout(() => {
                        console.log("Main.js: Executing game restart...");
                        resetGame();
                    }, 2000); // 2 second delay to show death message
                    return; // Stop current game loop execution
                }
                
                // Clean up defeated enemies from the array periodically
                if (enemies && enemies.length > 0) {
                    const initialCount = enemies.length;
                    enemies = enemies.filter(enemy => !enemy.isDefeated);
                    const cleanedCount = initialCount - enemies.length;
                    if (cleanedCount > 0) {
                        console.log(`Main.js: Cleaned up ${cleanedCount} defeated enemies from array.`);
                    }
                }
                
                if (typeof moveEnemies === 'function') moveEnemies();
                if (typeof updateEnemySpawnZones === 'function') updateEnemySpawnZones();
                if (typeof updatePetBehavior === 'function') updatePetBehavior();
                if (typeof render === 'function') render();
                updateActorPositions();
                updateChibiActors();
                updateCameraFollow();
            }, GAME_LOOP_SPEED || 250);
            
            // Start enemy spawn loop
            enemySpawnIntervalId = setInterval(() => {
                if (typeof spawnEnemies === 'function') spawnEnemies();
            }, ENEMY_SPAWN_INTERVAL || 10000);
            
            // Update progress: Complete
            updateGameLoadingProgress(100, "Game Ready!");
            
            // Set window functions for external access
            window.updateThreeJSEntities = updateActorPositions;
            
            console.log("Main.js: resetGame completed successfully!");
            
            // Initial render
            if (typeof render === 'function') render();
            
        } catch (error) {
            console.error("Main.js: resetGame failed:", error);
            updateGameLoadingProgress(100, "Game initialization failed");
            if (typeof addNotification === 'function') {
                addNotification("Game initialization failed. Please refresh the page.", "critical", 0);
            }
        }
    };
    
    const HEX_WIDTH_3D = HEX_SPACING_FACTOR_X;
    const HEX_VERT_SPACING_3D = HEX_SPACING_FACTOR_Z;

   function initializeThreeJS() {
        const canvas3D = document.getElementById('gameCanvas');
        if (!canvas3D) { console.error("3JS Init: #gameCanvas NOT FOUND!"); if(typeof addNotification === 'function') addNotification("Error: Game canvas missing!", "critical", 0); return false; }
        // Check for valid canvas dimensions BEFORE attempting to use them for the renderer
        if (canvas3D.clientWidth === 0 || canvas3D.clientHeight === 0) {
            console.error(`3JS Init: #gameCanvas has zero width or height! Width: ${canvas3D.clientWidth}, Height: ${canvas3D.clientHeight}. CSS for canvas might not be applied or effective.`);
            if(typeof addNotification === 'function') addNotification("Error: Game canvas has invalid dimensions!", "critical", 0);
            const fbCtx = canvas3D.getContext('2d'); // Attempt to draw error on 2D context
            if (fbCtx) {
                // Use canvas attributes for fallback drawing dimensions if clientWidth/Height are 0
                const drawWidth = canvas3D.width || 300;
                const drawHeight = canvas3D.height || 150;
                fbCtx.fillStyle = '#111'; fbCtx.fillRect(0, 0, drawWidth, drawHeight);
                fbCtx.font = "bold 14px Monospace"; fbCtx.fillStyle = "orange"; fbCtx.textAlign = "center";
                fbCtx.fillText("CANVAS SIZE ERROR", drawWidth / 2, drawHeight / 2 - 10);
                fbCtx.fillText(`Dimensions: ${canvas3D.clientWidth}x${canvas3D.clientHeight}. Check CSS.`, drawWidth / 2, drawHeight / 2 + 10);
            }
            return false;
        }
        if (typeof THREE === 'undefined') { console.error("3JS Init: THREE.js lib NOT LOADED!"); if(typeof addNotification === 'function') addNotification("Error: 3D library missing!", "critical", 0); return false; }
        
        preComputedHexGeo = new THREE.CylinderGeometry(HEX_RADIUS_3D, HEX_RADIUS_3D, HEX_HEIGHT_3D, 6);
        // No rotation needed for flat-topped hexes (Civilization style)

        try {
            threeRenderer = new THREE.WebGLRenderer({ canvas: canvas3D, antialias: true, powerPreference: "high-performance" });
            threeRenderer.setSize(canvas3D.clientWidth, canvas3D.clientHeight); // Use clientWidth/Height
            threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
            threeRenderer.shadowMap.enabled = true;
            threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
            threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
            threeRenderer.toneMappingExposure = 0.9;

            threeScene = new THREE.Scene();
            threeScene.background = new THREE.Color(0xA08963);
            threeScene.fog = new THREE.FogExp2(0xB09973, 0.0025); // Changed fog color

            const aspect = canvas3D.clientWidth / canvas3D.clientHeight; // Use clientWidth/Height
            const initialFOV = getCurrent3DFOV() || 75;
            threeCamera = new THREE.PerspectiveCamera(initialFOV, aspect, 0.2, MAP_COLS * HEX_WIDTH_3D * 1.8); // Increased far plane
            
            const camDistFactor = 0.32; // Slightly further out
            const camHeightFactor = 35; // Slightly higher
            const camLookAtYOffset = 0; // Looking a bit further down
            const mapCenterX3D = (MAP_COLS * HEX_WIDTH_3D) / 2;
            const mapCenterZ3D = (MAP_ROWS * HEX_VERT_SPACING_3D) / 2;

            threeCamera.position.set(
                mapCenterX3D - (MAP_COLS * HEX_WIDTH_3D * camDistFactor * 0.25), // Adjusted X pos
                camHeightFactor,
                mapCenterZ3D + (MAP_ROWS * HEX_VERT_SPACING_3D * camDistFactor * 0.9) // Adjusted Z pos for angle
            );
            threeCamera.lookAt(mapCenterX3D, camLookAtYOffset, mapCenterZ3D);
            window.targetFOV = threeCamera.fov;
            // Ensure initial camera angle matches follow/zoom logic
            if (typeof updateCameraFollow === 'function') updateCameraFollow();
            threeAmbientLight = new THREE.AmbientLight(0x808095, 1.1); 
            threeScene.add(threeAmbientLight);
            threeDirectionalLight = new THREE.DirectionalLight(0xfff5e1, 1.25); 
            threeDirectionalLight.position.set(MAP_COLS * 0.2, 95, MAP_ROWS * 0.25);
            threeDirectionalLight.castShadow = true;
            threeDirectionalLight.shadow.mapSize.width = 2048 * 2; threeDirectionalLight.shadow.mapSize.height = 2048 * 2;
            threeDirectionalLight.shadow.camera.near = 15; threeDirectionalLight.shadow.camera.far = 250;
            const shCS = Math.max(MAP_COLS * HEX_WIDTH_3D, MAP_ROWS * HEX_VERT_SPACING_3D) * 0.5; // Adjusted shadow camera size
            threeDirectionalLight.shadow.camera.left = -shCS; threeDirectionalLight.shadow.camera.right = shCS;
            threeDirectionalLight.shadow.camera.top = shCS; threeDirectionalLight.shadow.camera.bottom = -shCS;
            threeScene.add(threeDirectionalLight);
            // const helper = new THREE.CameraHelper( threeDirectionalLight.shadow.camera ); // DEBUG: Shadow cam
            // threeScene.add( helper );

            threeHexGroup = new THREE.Group(); 
            threeScene.add(threeHexGroup);

            threeActorGroup = new THREE.Group(); 
            threeScene.add(threeActorGroup);
            
            // Handle window resize
            window.addEventListener('resize', () => {
                if (threeCamera && threeRenderer && canvas3D) {
                    const newWidth = canvas3D.clientWidth;
                    const newHeight = canvas3D.clientHeight;
                    threeCamera.aspect = newWidth / newHeight;
                    threeCamera.updateProjectionMatrix();
                    threeRenderer.setSize(newWidth, newHeight);
                }
            });

            console.log("Main.js: Three.js setup successful.");
            return true;
        } catch (err) { 
            console.error("Main.js initializeThreeJS: CRITICAL ERROR during setup!", err);
            if (err.message && err.message.toLowerCase().includes("error creating webgl context")) {
                const msg = "WebGL Context Error: 3D rendering disabled. Check browser settings (enable WebGL & Hardware Acceleration) and update graphics drivers. Try restarting browser.";
                if (typeof addNotification === 'function') addNotification(msg, "critical", 0); else alert(msg);
                const fbCan = document.getElementById('gameCanvas');
                if (fbCan) {
                    const fbCtx = fbCan.getContext('2d');
                    if (fbCtx) {
                        fbCtx.fillStyle = '#000'; fbCtx.fillRect(0, 0, fbCan.width, fbCan.height);
                        fbCtx.font = "14px Monospace"; fbCtx.fillStyle = "red"; fbCtx.textAlign = "center";
                        fbCtx.fillText("WEBGL ERROR - 3D VIEW FAILED", fbCan.width / 2, fbCan.height / 2 - 10);
                        fbCtx.fillText("Check console & browser settings.", fbCan.width / 2, fbCan.height / 2 + 10);
                    }
                }
            }
            threeRenderer = null; 
            return false;
        }
    }
      function createThreeJSHexTile(c, r, tileObject, localMaterialsCache, baseHexGeo) {
        if (!tileObject) { console.warn(`createThreeJSHexTile: tileObject is undefined for ${c},${r}`); return null;}
        const terrainChar = tileObject.terrain;
        const resourceType = tileObject.resource;

        const heightFactor = TERRAIN_HEIGHT_FACTORS[terrainChar] || TERRAIN_HEIGHT_FACTORS['DEFAULT'];
        const actualHeight = HEX_HEIGHT_3D * heightFactor;

        const materialKeyBase = `MAT_${terrainChar.toUpperCase()}`;
        let tileMaterial = localMaterialsCache[materialKeyBase];

        if (!tileMaterial) {
            const colorHex = colors[materialKeyBase] || colors['MAT_DEFAULT'];
            let roughness = 0.8; let metalness = 0.05;
            if (['L', 'N', 'V'].includes(terrainChar)) { roughness = 0.3; metalness = 0.0; } 
            else if (['O', 'R', 'M'].includes(terrainChar)) { roughness = 0.9; metalness = 0.1; } 
            else if (['F', 'J'].includes(terrainChar)) { roughness = 0.85; metalness = 0.0; } 
            else if (terrainChar === 'D') { roughness = 0.85; metalness = 0.0; }
            
            // Use 3D system for enhanced materials if available
            if (window.threeDSystem?.createStyledMaterial) {
                tileMaterial = window.threeDSystem.createStyledMaterial(colorHex, terrainChar, { roughness, metalness });
            } else {
                tileMaterial = new THREE.MeshStandardMaterial({ color: colorHex, roughness: roughness, metalness: metalness });
            }
            localMaterialsCache[materialKeyBase] = tileMaterial;
        }
        
        const hexMesh = new THREE.Mesh(baseHexGeo, tileMaterial);
        hexMesh.position.set(0, (actualHeight - HEX_HEIGHT_3D) / 2, 0); 
        hexMesh.scale.set(1, heightFactor, 1); 
        hexMesh.castShadow = true; hexMesh.receiveShadow = true;
        hexMesh.userData = { mapX: c, mapY: r, tileChar: terrainChar, resource: resourceType, originalMaterial: tileMaterial, gridX: c, gridY: r };
        
        let rememberedMaterialKey = `REM_${materialKeyBase}`;
        let rememberedMaterial = localMaterialsCache[rememberedMaterialKey];
        if(!rememberedMaterial && tileMaterial.isMeshStandardMaterial && typeof chroma !== 'undefined' && tileMaterial.color){
            try {
                const remColorHexString = chroma(tileMaterial.color.getHex()).darken(1.1).desaturate(0.7).hex();
                const remColorInteger = parseInt(remColorHexString.substring(1), 16);
                rememberedMaterial = new THREE.MeshStandardMaterial({ color: remColorInteger, roughness: Math.min(1, tileMaterial.roughness + 0.1), metalness: Math.max(0, tileMaterial.metalness - 0.05) });
                localMaterialsCache[rememberedMaterialKey] = rememberedMaterial;
            } catch(e) {
                rememberedMaterial = localMaterialsCache['MAT_REMEMBERED_FALLBACK_CHROMA_ERR'] || (localMaterialsCache['MAT_REMEMBERED_FALLBACK_CHROMA_ERR'] = new THREE.MeshStandardMaterial({ color: colors['MAT_REMEMBERED'] || 0x505048, roughness: 0.9, metalness: 0.05 }));
            }
        } else if (!rememberedMaterial) {
             rememberedMaterial = localMaterialsCache['MAT_REMEMBERED_FALLBACK_NO_CHROMA'] || (localMaterialsCache['MAT_REMEMBERED_FALLBACK_NO_CHROMA'] = new THREE.MeshStandardMaterial({ color: colors['MAT_REMEMBERED'] || 0x505048, roughness: 0.9, metalness: 0.05 }));
        }
        hexMesh.userData.rememberedMaterial = rememberedMaterial;
        allMapTileMeshes.push(hexMesh);

        const tileAndResourceGroup = new THREE.Group();
        tileAndResourceGroup.add(hexMesh);

        if (tileMaterial.color) { // Ensure color exists before trying to get hex
            const edgeBaseColorHex = tileMaterial.color.getHex();
            const edgeColorHex = (typeof chroma !== 'undefined' && chroma.valid(edgeBaseColorHex)) ? chroma(edgeBaseColorHex).darken(1.5).hex() : 0x333333;
            const edgesGeo = new THREE.EdgesGeometry(hexMesh.geometry); 
            const edgeMaterial = new THREE.LineBasicMaterial({ color: parseInt(edgeColorHex.substring(1),16), linewidth: 1.5 }); 
            const hexEdges = new THREE.LineSegments(edgesGeo, edgeMaterial);
            hexEdges.scale.copy(hexMesh.scale); hexEdges.position.copy(hexMesh.position); 
            tileAndResourceGroup.add(hexEdges);
            hexMesh.userData.edgeMesh = hexEdges;
        }

        if (resourceType && resourceType !== TILE_RESOURCES.NONE) {
            let resourceMesh; let resourceGeo;
            let resourceColor = 0xffdcba; let resourceRoughness = 0.6; let resourceMetalness = 0.2;
            if (resourceType === TILE_RESOURCES.SCRAP_PILE) {
                resourceGeo = new THREE.BoxGeometry(HEX_RADIUS_3D * 0.4, HEX_RADIUS_3D * 0.3, HEX_RADIUS_3D * 0.4);
                resourceColor = 0x8B4513; resourceRoughness = 0.8; resourceMetalness = 0.1;
            } else if (resourceType === TILE_RESOURCES.ENERGY_CRYSTAL) {
                resourceGeo = new THREE.ConeGeometry(HEX_RADIUS_3D * 0.2, HEX_RADIUS_3D * 0.5, 5); 
                resourceGeo.translate(0, (HEX_RADIUS_3D * 0.5) / 2, 0); 
                resourceColor = 0x00BCD4; resourceRoughness = 0.3; resourceMetalness = 0.3;
            } else { resourceGeo = new THREE.SphereGeometry(HEX_RADIUS_3D * 0.22, 7, 5); }
            
            if (resourceGeo) {
                const resourceMatKey = `RES_MAT_${resourceType.replace(/\s+/g, '_').toUpperCase()}`;
                let resourceMat = localMaterialsCache[resourceMatKey] || (localMaterialsCache[resourceMatKey] = new THREE.MeshStandardMaterial({ color: resourceColor, roughness: resourceRoughness, metalness: resourceMetalness }));
                resourceMesh = new THREE.Mesh(resourceGeo, resourceMat);
                const resourceBaseOffset = (resourceType === TILE_RESOURCES.ENERGY_CRYSTAL) ? (HEX_RADIUS_3D * 0.5)/2 : (HEX_RADIUS_3D * 0.3)/2;
                resourceMesh.position.set(0, (actualHeight / 2) + resourceBaseOffset + 0.05 - (HEX_HEIGHT_3D / 2), 0); 
                resourceMesh.castShadow = true;
                hexMesh.userData.resourceMesh = resourceMesh;
                tileAndResourceGroup.add(resourceMesh);            }
        }
          // Add cloud above this tile using the cloud system
        if (typeof addCloudToTile === 'function') {
            addCloudToTile(tileAndResourceGroup, terrainChar, c, r, actualHeight);
        }
        
        // Add trees to forest and jungle tiles using the tree system
        if (typeof addTreeToTile === 'function') {
            addTreeToTile(tileAndResourceGroup, terrainChar, c, r, actualHeight);
        }
        
        tileAndResourceGroup.position.set(
            HEX_SPACING_FACTOR_X * (c + 0.5 * (r % 2)), // Flat-topped hex offset
            HEX_HEIGHT_3D/2,
            HEX_SPACING_FACTOR_Z * r
        );
        return tileAndResourceGroup;
    }function populateThreeJSMap() {
        if (!threeScene || !map || !threeHexGroup || !map.length) { console.error("populateThreeJSMap: Pre-requisites missing."); return; }
        console.log("Main.js: Populating 3D hex map scene using new structure...");
        
        allMapTileMeshes = []; 
        while(threeHexGroup.children.length > 0){
            const childGroup = threeHexGroup.children[0];
            childGroup.traverse(object => { // Dispose all nested meshes and materials
                 if (object.geometry) object.geometry.dispose();
                 if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(m => { if (m.dispose) m.dispose(); });
                    } else if (object.material.dispose) {
                        object.material.dispose();
                    }
                }
            });
            threeHexGroup.remove(childGroup); 
        } 
        cachedMaterials = {}; 

        for (let r = 0; r < MAP_ROWS; r++) {
            for (let c = 0; c < MAP_COLS; c++) {
                if (map[r] && map[r][c]) {
                    const tileGroup = createThreeJSHexTile(c, r, map[r][c], cachedMaterials, preComputedHexGeo);
                    if (tileGroup) threeHexGroup.add(tileGroup);
                }
            }
        }
        console.log("Main.js: Three.js hex map populated. Meshes in allMapTileMeshes:", allMapTileMeshes.length);
    }    // Helper to calculate and set worldX, worldY, worldZ for an actor
    function updateActor3DPosition(actor) {
        if (!actor || typeof actor.x !== 'number' || typeof actor.y !== 'number') return;
        console.log(`Main.js: Updating 3D position for actor: ${actor.id || actor.name}`); // Added log

        actor.worldX = HEX_SPACING_FACTOR_X * (actor.x + 0.5 * (actor.y % 2)); // Flat-topped hex offset
        actor.worldZ = HEX_SPACING_FACTOR_Z * actor.y;

        const tileData = map[actor.y]?.[actor.x];
        const terrainChar = tileData ? tileData.terrain : 'P';
        const tileHeightFactor = TERRAIN_HEIGHT_FACTORS[terrainChar] || TERRAIN_HEIGHT_FACTORS['DEFAULT'];
        const tileActualHeight = HEX_HEIGHT_3D * tileHeightFactor;

        let modelHeight = HEX_RADIUS_3D * 0.7; // Default model height (e.g., player cylinder)
        if (actor === pet) {
            modelHeight = HEX_RADIUS_3D * 0.28 * 2; // Diameter of pet sphere
        } else if (actor !== activePlayerActor && actor !== pet) { // Enemy
            modelHeight = HEX_RADIUS_3D * 0.55; // Height of enemy cone
        }
        
        // worldY should be the center of the model
        actor.worldY = tileActualHeight + (modelHeight / 2) + 0.05; // Actor model center slightly above tile surface

        // Update the actual 3D mesh positions
        if (actor.chibiInstance && actor.chibiInstance.mesh) {
            // For ChibiActor instances, update their mesh position
            const chibiBaseY = tileActualHeight + 0.05; // Base of chibi should be on ground
            if (actor.chibiInstance.moveTo && typeof actor.chibiInstance.moveTo === 'function') {
                // Use smooth movement if available
                actor.chibiInstance.moveTo(actor.worldX, chibiBaseY, actor.worldZ, 300);
            } else {
                // Direct position update
                actor.chibiInstance.mesh.position.set(actor.worldX, chibiBaseY, actor.worldZ);
            }
        } else if (actor.threeMesh) {
            // For primitive mesh representations (cylinders, spheres, cones)
            let meshY = actor.worldY;
            if (actor === pet) {
                // Pet sphere center should be at worldY
                meshY = tileActualHeight + 0.05 + (HEX_RADIUS_3D * 0.28); // Base + radius
            } else if (actor === activePlayerActor) {
                // Player cylinder base should be on ground
                meshY = tileActualHeight + 0.05;
            } else {
                // Enemy cone base should be on ground
                meshY = tileActualHeight + 0.05;
            }
            actor.threeMesh.position.set(actor.worldX, meshY, actor.worldZ);
        }
    }function updateCameraFollow() {
        if (!threeCamera || !activePlayerActor || typeof activePlayerActor.worldX !== 'number') {
            console.log('Camera follow skipped:', {
                hasCamera: !!threeCamera,
                hasPlayer: !!activePlayerActor,
                hasWorldX: typeof activePlayerActor?.worldX === 'number'
            });
            return;
        }

        const playerPos = new THREE.Vector3(activePlayerActor.worldX, activePlayerActor.worldY, activePlayerActor.worldZ);

        const targetVisibleGridRadius = PLAYER_FOV_RADIUS * TARGET_PLAYER_FOV_MULTIPLIER;
        // Approximate world height to keep visible (diameter of player's effective FOV in world units)
        const targetVisibleWorldHeight = (2 * targetVisibleGridRadius) * HEX_SPACING_FACTOR_Z; // Using Z spacing for vertical extent

        // IMPORTANT: Do NOT set threeCamera.fov here! Only use the current value.
        const currentAngularFOV_rad = threeCamera.fov * (Math.PI / 180);
        const distanceToMaintainView = (targetVisibleWorldHeight / 2) / Math.tan(currentAngularFOV_rad / 2);

        const cameraOffset = CAMERA_DIRECTION_OFFSET.clone().multiplyScalar(Math.max(10, distanceToMaintainView)); // Ensure min distance

        threeCamera.position.copy(playerPos).add(cameraOffset);
        threeCamera.lookAt(playerPos);
        
        // Debug log (remove after testing)
        // console.log('Camera updated:', { playerPos, cameraPos: threeCamera.position });
    }
    // Placeholder for the function that creates 3D actor representations

      function createThreeJSActorRepresentation(actorData) {
        // Calculate tileActualHeight based on actorData's position
        const tileData = map[actorData.y]?.[actorData.x];
        const terrainChar = tileData ? tileData.terrain : 'P'; // Default to 'P' (Plains) if no tileData
        const tileHeightFactor = TERRAIN_HEIGHT_FACTORS[terrainChar] || TERRAIN_HEIGHT_FACTORS['DEFAULT'];
        const tileActualHeight = HEX_HEIGHT_3D * tileHeightFactor;

        // Fix chibi actor system - ensure consistent usage
    if (actorData === activePlayerActor && actorData.id === "nia_sankara") {
        const actorBaseY = tileActualHeight + 0.05;        if (!actorData.chibiInstance) {
            // Prioritize Enhanced3DChibi for better performance and features
            if (typeof Enhanced3DChibi !== 'undefined') {
                actorData.chibiInstance = new Enhanced3DChibi(
                    threeActorGroup,
                    HEX_SPACING_FACTOR_X * (actorData.x + (actorData.y % 2 === 1 ? 0.5 : 0)),
                    actorBaseY,
                    HEX_SPACING_FACTOR_Z * actorData.y,
                    'nia'
                );
                console.log("Created Enhanced3DChibi for Nia");
            } else if (typeof window.ChibiNia !== 'undefined') {
                actorData.chibiInstance = new window.ChibiNia(
                    threeActorGroup,
                    HEX_SPACING_FACTOR_X * (actorData.x + (actorData.y % 2 === 1 ? 0.5 : 0)),
                    actorBaseY,
                    HEX_SPACING_FACTOR_Z * actorData.y
                );
                console.log("Created ChibiNia fallback");            } else {
                console.warn("No Nia chibi class available, using ChibiActor fallback");
                actorData.chibiInstance = new window.ChibiActor(
                    "nia_chibi", "Nia", actorData.x, actorData.y,
                    null, null, null, 1.0, 0.05, 2.0
                );
                // Set mesh position manually for ChibiActor
                if (actorData.chibiInstance.mesh) {
                    actorData.chibiInstance.mesh.position.set(
                        HEX_SPACING_FACTOR_X * (actorData.x + (actorData.y % 2 === 1 ? 0.5 : 0)),
                        actorBaseY,
                        HEX_SPACING_FACTOR_Z * actorData.y
                    );
                    threeActorGroup.add(actorData.chibiInstance.mesh);
                }
            }
        }
        
        // Update position with proper movement
        const newX = HEX_SPACING_FACTOR_X * (actorData.x + (actorData.y % 2 === 1 ? 0.5 : 0));
        const newZ = HEX_SPACING_FACTOR_Z * actorData.y;
        
        if (actorData.chibiInstance.moveTo && typeof actorData.chibiInstance.moveTo === 'function') {
            actorData.chibiInstance.moveTo(newX, actorBaseY, newZ, 300);
        } else {
            actorData.chibiInstance.mesh.position.set(newX, actorBaseY, newZ);
        }
        return actorData.chibiInstance.mesh;
    }

    if (actorData === activePlayerActor && actorData.id === "zuberi_adebayo") {
        const actorBaseY = tileActualHeight + 0.05;        if (!actorData.chibiInstance) {
            // Prioritize Enhanced3DChibi for Zuberi too
            if (typeof Enhanced3DChibi !== 'undefined') {
                actorData.chibiInstance = new Enhanced3DChibi(
                    threeActorGroup,
                    HEX_SPACING_FACTOR_X * (actorData.x + (actorData.y % 2 === 1 ? 0.5 : 0)),
                    actorBaseY,
                    HEX_SPACING_FACTOR_Z * actorData.y,
                    'zuberi'
                );
                console.log("Created Enhanced3DChibi for Zuberi");            } else {
                actorData.chibiInstance = new window.ChibiActor(
                    "zuberi_chibi", "Zuberi", actorData.x, actorData.y,
                    null, null, null, 1.0, 0.05, 2.0
                );
                // Set mesh position manually for ChibiActor
                if (actorData.chibiInstance.mesh) {
                    actorData.chibiInstance.mesh.position.set(
                        HEX_SPACING_FACTOR_X * (actorData.x + (actorData.y % 2 === 1 ? 0.5 : 0)),
                        actorBaseY,
                        HEX_SPACING_FACTOR_Z * actorData.y
                    );
                    threeActorGroup.add(actorData.chibiInstance.mesh);
                }
                console.log("Created generic ChibiActor for Zuberi");
            }
        }
        
        // Update position
        actorData.chibiInstance.mesh.position.set(
            HEX_SPACING_FACTOR_X * (actorData.x + (actorData.y % 2 === 1 ? 0.5 : 0)),
            actorBaseY,
            HEX_SPACING_FACTOR_Z * actorData.y
        );
        return actorData.chibiInstance.mesh;
    }

    // ...existing code for pet and enemies...
    // The fallback for player (if GLB model isn't used/found or ID doesn't match) is handled by the subsequent 'if (actorData === activePlayerActor)' block
    
    const primitiveActorBaseY = tileActualHeight + 0.05; 
    let finalMeshY;
    let geometry;
    let color;
    let material;
    let mesh;

    if (actorData === activePlayerActor) {
        const modelHeight = HEX_RADIUS_3D * 0.7;
        geometry = new THREE.CylinderGeometry(HEX_RADIUS_3D * 0.20, HEX_RADIUS_3D * 0.20, modelHeight, 8);
        geometry.translate(0, modelHeight / 2, 0); // Origin at base
        color = actorData.color || 0xFFFF00;
        finalMeshY = primitiveActorBaseY;
    } else if (actorData === pet) {
        const modelRadius = HEX_RADIUS_3D * 0.28;
        geometry = new THREE.SphereGeometry(modelRadius, 10, 8); // Origin at center
        color = pet.baseColor ? parseInt(pet.baseColor.substring(1), 16) : 0xFF00FF;
        finalMeshY = primitiveActorBaseY + modelRadius; // Center sphere on its radius above base
    } else { // Enemy
        const modelHeight = HEX_RADIUS_3D * 0.55;
        geometry = new THREE.ConeGeometry(HEX_RADIUS_3D * 0.22, modelHeight, 5);
        geometry.translate(0, modelHeight / 2, 0); // Origin at base
        color = 0xFF0000;
        finalMeshY = primitiveActorBaseY;
    }
    material = new THREE.MeshStandardMaterial({
        color: color,
        roughness: (actorData === pet) ? 0.6 : 0.4,
        metalness: (actorData === pet) ? 0.1 : 0.2
    });    mesh = new THREE.Mesh(geometry, material);    mesh.position.set(
        HEX_SPACING_FACTOR_X * (actorData.x + (actorData.y % 2 === 1 ? 0.5 : 0)),
        finalMeshY,
        HEX_SPACING_FACTOR_Z * actorData.y
    );    mesh.castShadow = true;
    mesh.userData.id = actorData.id || actorData.typeId;
    actorData.threeMesh = mesh; // Store the primitive mesh on the actor data object
    return mesh;
}
    
    const gameCanvasForRaycasting = document.getElementById('gameCanvas');
    if(gameCanvasForRaycasting && typeof THREE !== 'undefined'){
        // Mouse Wheel Zoom Implementation REMOVED for main canvas
        // console.log("Main.js: Mouse wheel zoom for main canvas has been disabled. Use the zoom button.");

        const raycaster=new THREE.Raycaster();const mouseNDC=new THREE.Vector2();
        
        gameCanvasForRaycasting.addEventListener('mousemove',(event)=>{
            if(!window.gameStarted||!threeCamera||!threeHexGroup||!threeHexGroup.children.length||!threeRenderer)return;
            const rect=gameCanvasForRaycasting.getBoundingClientRect();
            mouseNDC.x=((event.clientX-rect.left)/rect.width)*2-1; mouseNDC.y=-((event.clientY-rect.top)/rect.height)*2+1;
            raycaster.setFromCamera(mouseNDC,threeCamera); 
            const intersects=raycaster.intersectObjects(threeHexGroup.children, true); // Intersect with groups
            
            const hoverInfoDiv=document.getElementById('hover-tile-info');
            if(intersects.length>0){
                let mainHexUserData = null;
                let intersectedMesh = intersects[0].object;
                
                // Traverse up to find the mesh with gridX/gridY, typically the hexMesh itself or the direct child of the group
                let parentGroup = intersectedMesh.parent;
                if(intersectedMesh.userData && typeof intersectedMesh.userData.gridX !== 'undefined') { //Direct hit on hex or edge that has full data
                    mainHexUserData = intersectedMesh.userData;
                } else if (parentGroup && parentGroup !== threeHexGroup && parentGroup.children[0] && parentGroup.children[0].userData && typeof parentGroup.children[0].userData.gridX !== 'undefined') { // Hit resource/edge, get data from hexMesh (child 0)
                    mainHexUserData = parentGroup.children[0].userData;
                } else if (intersectedMesh.parent && intersectedMesh.parent.userData && typeof intersectedMesh.parent.userData.gridX !== 'undefined') { // Less common: if hex itself was hit but its parent is the group added to threeHexGroup
                     mainHexUserData = intersectedMesh.parent.userData;
                }


                if (mainHexUserData && typeof mainHexUserData.mapX !== 'undefined') { // Ensure valid user data found
                    const {mapX, mapY, tileChar, resource} = mainHexUserData;
                     if(memory && memory[mapY] && memory[mapY][mapX] > 0){
                        const T_NAMES={'P':'Plains','F':'Forest','L':'Lake','O':'Mountain','H':'Hills','D':'Desert','M':'Marsh','V':'River','J':'Jungle','A':'Pasture','R':'Range','N':'Pond','S':'Start Zone','B':'Beacon Point',' ':'Void Sector'};
                        let resourceText = "";
                        if (resource && resource !== TILE_RESOURCES.NONE) {
                            resourceText = ` (${resource})`;
                        }
                        hoverInfoDiv.textContent=`Tile: ${T_NAMES[tileChar] || `Type ${tileChar}`}${resourceText} (${mapX},${mapY})`;
                    } else { hoverInfoDiv.textContent="Hover Tile: (Unexplored)";}
                } else { hoverInfoDiv.textContent="Hover Tile: --- (No UserData)";}
            } else { hoverInfoDiv.textContent="Hover Tile: ---";}
        });
        
         gameCanvasForRaycasting.addEventListener('click', (event) => {
            if (!window.gameStarted || !threeCamera || !threeHexGroup || !threeHexGroup.children.length || !threeRenderer || !activePlayerActor || activePlayerActor.isDefeated) return;
            const rect = gameCanvasForRaycasting.getBoundingClientRect();
            mouseNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; // Added semicolon for robustness
            mouseNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouseNDC, threeCamera);
            const intersects = raycaster.intersectObjects(threeHexGroup.children, true);
            if (intersects.length > 0) {
                 let clickedHexMesh; 
                 let mainHexUserData;
                 const intersectedObject = intersects[0].object;

                let searchTarget = intersectedObject;
                while(searchTarget && !(searchTarget.userData && typeof searchTarget.userData.mapX !== 'undefined' && searchTarget.userData.originalMaterial)) { 
                    if (searchTarget.parent === threeHexGroup && searchTarget.children && searchTarget.children[0] && searchTarget.children[0].userData && typeof searchTarget.children[0].userData.mapX !== 'undefined') {
                         searchTarget = searchTarget.children[0]; // This is likely the group, get its first child (hex)
                         break;
                    } else if (searchTarget.parent === threeHexGroup || !searchTarget.parent){ // if top group, or no parent, break
                        searchTarget = null; // No valid hex mesh found in this path
                        break;
                    }
                    searchTarget = searchTarget.parent;
                    if (searchTarget && searchTarget.children && searchTarget.children[0] && searchTarget.children[0].userData && typeof searchTarget.children[0].userData.mapX !== 'undefined' && searchTarget.children[0].userData.originalMaterial ) {
                        searchTarget = searchTarget.children[0]; // The hex tile is usually the first child of the group that was added
                        break;
                    }
                }
                clickedHexMesh = searchTarget; // This should be the hexMesh itself
                
                if(clickedHexMesh && clickedHexMesh.userData && typeof clickedHexMesh.userData.mapX !== 'undefined') {
                    mainHexUserData = clickedHexMesh.userData;
                    const { mapX, mapY, tileChar, resource } = mainHexUserData;
                    let activeAnimation = mainHexUserData.activeAnimation; 

                    if (typeof addNotification === 'function') {
                        let msg = `Clicked on ${tileChar} at (${mapX}, ${mapY})`;
                        if (resource && resource !== TILE_RESOURCES.NONE) msg += ` with ${resource}.`;
                        // addNotification(msg, 'info'); // Click notification can be spammy
                    }

                    let isAdjacentOrOnTile = false;
                    if (typeof getDistanceHex === 'function') {
                         isAdjacentOrOnTile = getDistanceHex(activePlayerActor.x, activePlayerActor.y, mapX, mapY) <= 1;
                    } else { 
                        isAdjacentOrOnTile = Math.abs(activePlayerActor.x - mapX) <=1 && Math.abs(activePlayerActor.y - mapY) <=1 && 
                                             (Math.abs(activePlayerActor.x - mapX) + Math.abs(activePlayerActor.y - mapY)) <=1; // Simplified for non-hex dist
                    }

                    if (resource && resource !== TILE_RESOURCES.NONE && isAdjacentOrOnTile && memory[mapY]?.[mapX] === 2 ) { // Can only collect if in current FoV
                        let collected = false;
                        if (resource === TILE_RESOURCES.SCRAP_PILE) {
                            if(addNotification) addNotification(`Collected ${TILE_RESOURCES.SCRAP_PILE}!`, 'player_action');
                            // TODO: Add scrap to player inventory/resources
                           
                            collected = true;
                        } else if (resource === TILE_RESOURCES.ENERGY_CRYSTAL) {
                            activePlayerActor.ep = Math.min(activePlayerActor.maxEp, activePlayerActor.ep + 25);
                            if(addNotification) addNotification(`Absorbed ${TILE_RESOURCES.ENERGY_CRYSTAL}! +25 EP.`, 'player_action');
                            if(typeof updatePlayerHUD === 'function') updatePlayerHUD();
                            collected = true;
                        }

                        if (collected) {
                            map[mapY][mapX].resource = TILE_RESOURCES.NONE; 
                            if (mainHexUserData.resourceMesh) { 
                                const resourceActualMesh = mainHexUserData.resourceMesh;
                                if (resourceActualMesh.parent) resourceActualMesh.parent.remove(resourceActualMesh);
                                if(resourceActualMesh.geometry) resourceActualMesh.geometry.dispose();
                                if(resourceActualMesh.material) resourceActualMesh.material.dispose();
                                mainHexUserData.resourceMesh = null; // Remove from userData so it doesn't reappear on FoV change
                            }
                             // If using minimap, trigger a redraw as resource state changed
                            if(typeof drawMinimap === 'function') drawMinimap();
                        }
                    }

                    if (typeof anime !== 'undefined' && mainHexUserData.originalMaterial && clickedHexMesh.material) {
                        if (activeAnimation && typeof anime.running !== 'undefined' && anime.running.includes(activeAnimation)) {
                            activeAnimation.pause(); 
                        }
                        const originalScaleY = clickedHexMesh.scale.y;
                        // Ensure originalMaterial color is available
                        const originalColor = mainHexUserData.originalMaterial.color ? mainHexUserData.originalMaterial.color.getHex() : 0xffffff;

                        const clickAnimation = anime({
                            targets: clickedHexMesh.scale,
                            y: [originalScaleY * 1.3, originalScaleY], duration: 400, easing: 'easeOutElastic(1, .6)',
                            begin: () => { 
                                if (clickedHexMesh.material.emissive) { // Check if material is standard and has emissive
                                    clickedHexMesh.material.emissive.setHex(0x666666); 
                                    clickedHexMesh.material.needsUpdate = true;
                                }
                            },
                            complete: () => { 
                                if (clickedHexMesh.material.emissive) {



                                     clickedHexMesh.material.emissive.setHex(0x000000); 
                                     clickedHexMesh.material.needsUpdate = true;
                                }
                                mainHexUserData.activeAnimation = null;
                            }
                        });
                        mainHexUserData.activeAnimation = clickAnimation;
                    }
                }
            }
        });
        
    } else { console.warn("Main.js: No #gameCanvas for 3D hover/click raycasting or THREE.js not ready."); }    document.addEventListener('keydown',(e)=>{
        if(!window.gameStarted||window.playerCaught||!activePlayerActor||activePlayerActor.isDefeated)return;

        let actionTaken=false;const key=e.key.toLowerCase();

        // Skip movement keys - they are handled by events.js
        if (['w', 's', 'a', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
            return; // Let events.js handle movement
        }

        // This section is for abilities and other actions.
        
        if(key===' ' && typeof emergencyPetRecall === 'function'){ // Space for Pet Recall
            emergencyPetRecall();
            actionTaken=true; 
        }else if(activePlayerActor.abilities && (key >='1' && key <= '4')){ // Abilities 1-4
            const abIdx=parseInt(key)-1;
            if (abIdx >= 0 && abIdx < activePlayerActor.abilities.length) {
                if(activePlayerActor.useAbility) { // Use the actor's own useAbility method
                    const abilityUsedSuccessfully = activePlayerActor.useAbility(abIdx); // Pass index, target can be handled by specific ability if needed
                    if (abilityUsedSuccessfully) { // useAbility should return true if successful
                        actionTaken = true;
                        if (!window.playerCaught && typeof triggerAttacksOfOpportunity === 'function' && 
                            (activePlayerActor.abilities[abIdx].provokesAoO !== false) ) { // Check if ability provokes
                                triggerAttacksOfOpportunity();
                        }
                    }
                } else {
                    // Fallback direct call if useAbility itself is missing (should not happen if BaseActor is prototype)
                    console.warn(`${activePlayerActor.name} is missing useAbility method. Attempting direct action.`);
                    const ab = activePlayerActor.abilities[abIdx];
                    if(ab && typeof ab.action === 'function'){
                         if(ab.currentCooldown > 0){if(typeof addNotification==='function')addNotification(`${ab.name} on CD: ${ab.currentCooldown} turns.`, 'info');}
                         else if(!activePlayerActor.hasEnoughEp(ab.cost)){if(typeof addNotification==='function')addNotification(`Not enough EP for ${ab.name}! (Needs ${ab.cost})`, 'warning');}
                         else {
                             const result = ab.action.call(activePlayerActor, null); // Call with null target, ability needs to handle target acquisition if needed
                             if (result !== false) { // Assuming action returns false on failure/cancellation
                                 actionTaken=true;
                                 if (typeof activePlayerActor.consumeEp === 'function' && ab.cost > 0) activePlayerActor.consumeEp(ab.cost);
                                 if (typeof ab.cooldown === 'number' && ab.cooldown > 0) ab.currentCooldown = ab.cooldown;

                                 if (!window.playerCaught && typeof triggerAttacksOfOpportunity === 'function' && (ab.provokesAoO !== false)) triggerAttacksOfOpportunity();
                                 if(typeof updatePlayerHUD === 'function') updatePlayerHUD();
                             }
                         }
                    }
                }
            }
 }
        // Render is handled by the main game loop, usually not needed after every key press unless for very specific immediate feedback
        // if (actionTaken && typeof render === 'function') render(); 
    });

    // Hide loading overlay when everything is ready
    if(loadingOverlay) {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
        }, 500); // Match CSS transition duration
    }

    // Get progress bar elements after DOM is loaded
    gameLoadingProgressBarContainer = document.getElementById('game-loading-progress-container');
    gameLoadingProgressBar = document.getElementById('game-loading-progress-bar');
    gameLoadingProgressText = document.getElementById('game-loading-progress-text');    // Attach event listener for the start game button
    if (startGameBtn) {
        startGameBtn.addEventListener('click', startGameWithSelections);
    } else {
        console.warn("Main.js: Start Game Button (#startGameBtn) not found in DOM.");
    }
    
    // Setup minimap zoom button
    if(toggleMinimapZoomBtn){
        toggleMinimapZoomBtn.addEventListener('click', ()=>{
            currentMinimapZoomMultiplierIndex=(currentMinimapZoomMultiplierIndex+1)%MINIMAP_ZOOM_LEVEL_MULTIPLIERS.length; 
            const cMF=MINIMAP_ZOOM_LEVEL_MULTIPLIERS[currentMinimapZoomMultiplierIndex]; 
            toggleMinimapZoomBtn.textContent=`Minimap (${cMF}x)`; 
            if(typeof render === 'function') render(); 
        });
    }
    
    // Populate character and pet selection options
    populateSelectionOptions();    console.log("Main.js: DOMContentLoaded handler completed. All initial setup and event listeners attached.");

let skipCameraFollowThisFrame = false;

function updateActorPositions() {
    // Updates 3D positions for all actors based on their grid coordinates
    if (!threeActorGroup) return;
    
    // Update active player position
    if (activePlayerActor) {
        updateActor3DPosition(activePlayerActor);
    }
    
    // Update pet position
    if (pet) {
        updateActor3DPosition(pet);
    }
      // Update enemy positions and create 3D representations for new enemies
    if (enemies && enemies.length > 0) {
        enemies.forEach(enemy => {
            if (!enemy.isDefeated) {                // Create 3D representation for enemy if it doesn't exist
                if (!enemy.threeMesh && !enemy.chibiInstance) {
                    console.log(`Main.js: Creating 3D representation for new enemy at (${enemy.x}, ${enemy.y})`);
                    const enemyMesh = createThreeJSActorRepresentation(enemy);
                    if (enemyMesh && threeActorGroup) {
                        threeActorGroup.add(enemyMesh);
                        console.log("Main.js: Enemy 3D representation added to threeActorGroup.");
                    } else {
                        console.error("Main.js: Failed to create 3D representation for enemy.", enemy);
                    }
                }
                
                updateActor3DPosition(enemy);
            } else {
                // Clean up 3D representation for defeated enemies
                if (enemy.threeMesh && threeActorGroup) {
                    threeActorGroup.remove(enemy.threeMesh);
                    enemy.threeMesh = null;
                    console.log("Main.js: Removed defeated enemy's 3D representation.");
                }
                if (enemy.chibiInstance && enemy.chibiInstance.mesh && threeActorGroup) {
                    threeActorGroup.remove(enemy.chibiInstance.mesh);
                    enemy.chibiInstance = null;
                    console.log("Main.js: Removed defeated enemy's chibi representation.");
                }
            }
        });
    }
}

function updateChibiActors(deltaTime = 0.016) {
    // Update all ChibiActor instances for animations and 3D positioning
    
    // Update active player's chibi instance
    if (activePlayerActor && activePlayerActor.chibiInstance) {
        // Enhanced3DChibi update
        if (activePlayerActor.chibiInstance.update && typeof activePlayerActor.chibiInstance.update === 'function') {
            activePlayerActor.chibiInstance.update(deltaTime);
        }
        
        // ChibiActor update
        if (activePlayerActor.chibiInstance.updatePerTick && typeof activePlayerActor.chibiInstance.updatePerTick === 'function') {
            activePlayerActor.chibiInstance.updatePerTick(deltaTime);
        }
          // Ensure proper positioning with instant updates (no smooth movement)
        if (activePlayerActor.worldX !== undefined && activePlayerActor.worldY !== undefined && activePlayerActor.worldZ !== undefined) {
            if (activePlayerActor.chibiInstance.mesh) {
                const targetPos = new THREE.Vector3(activePlayerActor.worldX, activePlayerActor.worldY, activePlayerActor.worldZ);
                
                // Direct position update for tile-by-tile movement (no smooth sliding)
                activePlayerActor.chibiInstance.mesh.position.copy(targetPos);
            }
        }
    }
    
    // Update pet's chibi instance if it exists
    if (pet && pet.chibiInstance) {
        if (pet.chibiInstance.updatePerTick && typeof pet.chibiInstance.updatePerTick === 'function') {
            pet.chibiInstance.updatePerTick(deltaTime);
        }
        
        if (pet.chibiInstance.update && typeof pet.chibiInstance.update === 'function') {
            pet.chibiInstance.update(deltaTime);
        }
    }
    
    // Update enemy chibi instances
    if (enemies && enemies.length > 0) {
        enemies.forEach(enemy => {
            if (enemy.chibiInstance) {
                if (enemy.chibiInstance.updatePerTick && typeof enemy.chibiInstance.updatePerTick === 'function') {
                    enemy.chibiInstance.updatePerTick(deltaTime);
                }
                
                if (enemy.chibiInstance.update && typeof enemy.chibiInstance.update === 'function') {
                    enemy.chibiInstance.update(deltaTime);
                }
            }
        });
    }
}
});