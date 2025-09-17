import React, { useEffect, useState } from 'react';

function App() {
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('Initializing...');
  const [gameInitialized, setGameInitialized] = useState(false);
  const [selectionStep, setSelectionStep] = useState('faction'); // 'faction', 'character', 'pet'
  const [selectedFaction, setSelectedFaction] = useState(null);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [selectedPet, setSelectedPet] = useState(null);
  const [factionsLoaded, setFactionsLoaded] = useState(false);

  // Listen for faction data becoming available
  useEffect(() => {
    const handleFactionsLoaded = () => {
      setFactionsLoaded(true);
    };
    
    window.addEventListener('factionsLoaded', handleFactionsLoaded);
    return () => window.removeEventListener('factionsLoaded', handleFactionsLoaded);
  }, []);

  // Render faction cards when faction step is active
  useEffect(() => {
    if (selectionStep === 'faction' && factionsLoaded && window.renderFactionCards) {
      window.renderFactionCards((faction) => {
        setSelectedFaction(faction);
        setSelectionStep('character');
      });
    }
  }, [selectionStep, factionsLoaded]);

  // Render character cards when character step is active
  useEffect(() => {
    if (selectionStep === 'character' && selectedFaction && window.renderCharacterCards) {
      window.renderCharacterCards(selectedFaction, (character) => {
        setSelectedCharacter(character);
        setSelectionStep('pet');
      });
    }
  }, [selectionStep, selectedFaction]);

  // Render pet cards when pet step is active
  useEffect(() => {
    if (selectionStep === 'pet' && selectedFaction && window.renderPetCards) {
      window.renderPetCards(selectedFaction, (pet) => {
        setSelectedPet(pet);
      });
    }
  }, [selectionStep, selectedFaction]);

  useEffect(() => {
    // Load game scripts dynamically with progress tracking
    const loadScript = (src, description) => {
      return new Promise((resolve, reject) => {
        setLoadingText(`Loading ${description}...`);
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
          console.log(`✅ Loaded: ${description}`);
          resolve();
        };
        script.onerror = () => {
          console.error(`❌ Failed to load: ${description}`);
          reject(new Error(`Failed to load ${description}`));
        };
        document.head.appendChild(script);
      });
    };

    const loadGameScripts = async () => {
      try {
        const scripts = [
          // Core Libraries
          { src: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', desc: 'Three.js 3D Engine' },
          { src: 'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js', desc: 'Animation Engine' },
          
          // Core Game Systems
          { src: '/js/core.js', desc: 'Game Core Systems' },
          { src: '/js/utils.js', desc: 'Utility Functions' },
          { src: '/js/world_gen.js', desc: 'World Generation' },
          { src: '/js/map_utils.js', desc: 'Map Utilities' },
          { src: '/js/memory.js', desc: 'Memory System' },
          { src: '/js/progress.js', desc: 'Progress Tracking' },
          { src: '/js/notifications.js', desc: 'Notification System' },
          { src: '/js/civ-hex-map.js', desc: 'Civilization Hex Map System' },
          { src: '/js/turn-based-system.js', desc: 'Turn-Based Tactical System' },
          { src: '/js/tactical-movement.js', desc: 'Enhanced Tactical Movement' },
          
          // 3D Terrain Systems (Civilization-style)
          { src: '/3d/cloud-system.js', desc: 'Cloud System' },
          { src: '/3d/tree-system.js', desc: 'Forest Terrain' },
          { src: '/3d/mountain-system.js', desc: 'Mountain Terrain' },
          { src: '/3d/water-isometric.js', desc: 'Water Terrain' },
          { src: '/3d/pasture-system.js', desc: 'Plains Terrain' },
          { src: '/3d/hills-system.js', desc: 'Hills Terrain' },
          { src: '/3d/desert-system.js', desc: 'Desert Terrain' },
          { src: '/3d/agricultural-system.js', desc: 'Agricultural Terrain' },
          { src: '/3d/oasis-system.js', desc: 'Oasis Terrain' },
          { src: '/3d/rocky-system.js', desc: 'Rocky Terrain' },
          { src: '/3d/settlement-system.js', desc: 'Settlement Terrain' },
          { src: '/3d/building-system.js', desc: 'Building Terrain' },
          { src: '/3d/integration-helper.js', desc: '3D Integration' },
          
          // Game Logic
          { src: '/js/faction-definitions.js', desc: 'Faction System' },
          { src: '/js/selection-integration.js', desc: 'Selection Integration' },
          { src: '/js/actors/characters.js', desc: 'Character System' },
          { src: '/js/pet.js', desc: 'Companion System' },
          { src: '/js/player_controller.js', desc: 'Player Controls' },
          { src: '/js/enemies.js', desc: 'Enemy AI' },
          { src: '/js/hop-movement-system.js', desc: 'Movement System' },
          { src: '/js/hop-movement-enhancements.js', desc: 'Movement Enhancements' },
          { src: '/js/movement_counter.js', desc: 'Movement Counter' },
          { src: '/js/render.js', desc: 'Rendering Engine' },
          
          // Main Game Controller
          { src: '/js/main.js', desc: 'Main Game Controller' },
          { src: '/js/civ-integration.js', desc: 'Civilization Integration' },
          { src: '/js/debug-selection.js', desc: 'Selection Debug Helper' }
        ];

        for (let i = 0; i < scripts.length; i++) {
          await loadScript(scripts[i].src, scripts[i].desc);
          setLoadingProgress(((i + 1) / scripts.length) * 100);
        }
        
        setLoadingText('Initializing game world...');
        console.log('🎮 All game scripts loaded successfully!');
        
        // Initialize the Civilization-style hex map
        setTimeout(() => {
          initializeGameWorld();
        }, 500);
        
      } catch (error) {
        console.error('Failed to load game scripts:', error);
        setLoadingText(`Error: ${error.message}`);
      }
    };

    const initializeGameWorld = () => {
      // Set up the hex-based civilization map
      if (window.THREE && window.initializeCivHexMap) {
        console.log('🗺️ Initializing Civilization-style hex map...');
        setLoadingText('Generating terrain...');
        
        // Initialize the civilization-style hex map
        window.initializeCivHexMap().then(() => {
          console.log('🔗 Initializing game integration...');
          setLoadingText('Setting up civilization...');
          
          // Make faction data available to React components
          if (window.makeFactionDataAvailable) {
            window.makeFactionDataAvailable();
          }
          
          // Initialize the integration system
          if (window.initializeCivIntegration) {
            window.initializeCivIntegration().then(() => {
              setLoadingText('Ready to explore!');
              setGameInitialized(true);
            });
          } else {
            setGameInitialized(true);
          }
        });
      } else {
        console.error('Required game systems not loaded');
        setLoadingText('Failed to initialize game world');
      }
    };

    loadGameScripts();
  }, []);

  return (
    <>
      {/* Enhanced Game Loading Screen */}
      <div
        id="loading-overlay"
        className={`${gameInitialized ? 'hidden' : 'flex'} fixed inset-0 z-[9999] bg-ink/95 text-gray-200 items-center justify-center flex-col font-[Orbitron] cursor-pointer`}
        onClick={() => {
        if (loadingProgress >= 100) {
          setGameInitialized(true);
        }
        }}
      >
        <h1 className="text-gold text-4xl md:text-5xl font-black mb-5 tracking-wider game-title">🚀 AFRO-FUTURE RISING</h1>
        <div className="text-base md:text-lg mb-8 text-center opacity-90">{loadingText}</div>
        
        {/* Progress Bar */}
        <div className="w-[80%] max-w-md h-2 rounded bg-gray-800 overflow-hidden shadow-inner mb-4">
          <div
            className="h-full bg-gradient-to-r from-gold to-yellow-300 transition-[width] duration-300"
            style={{ width: `${Math.round(loadingProgress)}%` }}
          />
        </div>
        
        {/* Progress Percentage */}
  <div className="text-sm text-gold">{Math.round(loadingProgress)}% Complete</div>
        
        {/* Civilization-style Loading Tips */}
        <div className="mt-8 text-xs md:text-sm text-gray-400 text-center max-w-lg">
          💡 <b>Tip:</b> After the Great Collapse of 2045, three core factions rose to rebuild civilization. Each offers a unique path—ancestral wisdom, quantum science, or techno-tribal fusion.
        </div>
        
        {/* Click to continue hint */}
        {loadingProgress >= 100 && (
          <div className="mt-5 text-gold text-center animate-pulse">
            ✨ Click to continue ✨
            <div className="mt-3 flex gap-3 justify-center">
              <a href="#/menu" className="px-3 py-1.5 rounded bg-gold text-black font-semibold">Main Menu</a>
              <a href="#/creator" className="px-3 py-1.5 rounded bg-emerald-500 text-black font-semibold">Character</a>
            </div>
          </div>
        )}
      </div>

      {/* Civilization-Style Game Loading Progress */}
      <div id="game-loading-progress-container" style={{
        position: 'fixed',
        bottom: '50px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        padding: '25px',
        borderRadius: '15px',
        color: '#eee',
        zIndex: 10000,
        display: 'none',
        border: '2px solid #ffd700'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '15px', color: '#ffd700', fontSize: '1.1rem' }}>
          🗺️ Generating World Map
        </div>
        <div id="game-loading-progress-text" style={{ marginBottom: '15px', textAlign: 'center', fontSize: '0.9rem' }}>
          Creating hex-based terrain...
        </div>
        <div style={{
          width: '400px',
          height: '24px',
          backgroundColor: '#333',
          borderRadius: '12px',
          overflow: 'hidden',
          border: '1px solid #555'
        }}>
          <div id="game-loading-progress-bar" style={{
            width: '0%',
            height: '100%',
            background: 'linear-gradient(90deg, #4CAF50, #81C784)',
            transition: 'width 0.3s ease'
          }}></div>
        </div>
        <div style={{ 
          marginTop: '10px', 
          fontSize: '0.8rem', 
          color: '#aaa', 
          textAlign: 'center' 
        }}>
          Terrain types: Plains • Mountains • Forests • Desert • Water
        </div>
      </div>

      {/* Enhanced Selection Screen - Step by Step Flow */}
      <div id="selectionScreen" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%)',
        color: '#eee',
        display: gameInitialized ? 'flex' : 'none',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        fontFamily: 'Orbitron, sans-serif'
      }}>
        {/* Progress Indicator */}
        <div style={{
          position: 'absolute',
          top: '30px',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: '20px',
          alignItems: 'center'
        }}>
          <div style={{
            padding: '10px 20px',
            backgroundColor: selectionStep === 'faction' ? '#ffd700' : (selectedFaction ? '#4CAF50' : '#333'),
            color: selectionStep === 'faction' ? '#000' : '#eee',
            borderRadius: '20px',
            fontSize: '0.9rem',
            fontWeight: 'bold'
          }}>
            1. Faction
          </div>
          <div style={{ color: '#666' }}>→</div>
          <div style={{
            padding: '10px 20px',
            backgroundColor: selectionStep === 'character' ? '#ffd700' : (selectedCharacter ? '#4CAF50' : '#333'),
            color: selectionStep === 'character' ? '#000' : '#eee',
            borderRadius: '20px',
            fontSize: '0.9rem',
            fontWeight: 'bold'
          }}>
            2. Leader
          </div>
          <div style={{ color: '#666' }}>→</div>
          <div style={{
            padding: '10px 20px',
            backgroundColor: selectionStep === 'pet' ? '#ffd700' : (selectedPet ? '#4CAF50' : '#333'),
            color: selectionStep === 'pet' ? '#000' : '#eee',
            borderRadius: '20px',
            fontSize: '0.9rem',
            fontWeight: 'bold'
          }}>
            3. Companion
          </div>
        </div>

        {/* Faction Selection Step */}
        {selectionStep === 'faction' && (
          <div style={{ textAlign: 'center', maxWidth: '1200px', width: '100%' }}>
            <h1 style={{ 
              color: '#ffd700', 
              fontSize: '3.5rem', 
              marginBottom: '10px',
              textShadow: '2px 2px 4px rgba(0,0,0,0.7)'
            }}>
              🌍 CHOOSE YOUR FACTION
            </h1>
            <p style={{ fontSize: '1.2rem', color: '#ccc', marginBottom: '40px' }}>
              Select your approach to rebuilding civilization in post-WWIII Africa and Europe
            </p>
            
            <div id="factionGrid" style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(2, 1fr)', 
              gap: '30px',
              marginBottom: '40px'
            }}>
              {/* Faction cards will be rendered here by JavaScript */}
            </div>
          </div>
        )}

        {/* Character Selection Step */}
        {selectionStep === 'character' && selectedFaction && (
          <div style={{ textAlign: 'center', maxWidth: '1000px', width: '100%' }}>
            <h1 style={{ 
              color: '#ffd700', 
              fontSize: '3rem', 
              marginBottom: '10px',
              textShadow: '2px 2px 4px rgba(0,0,0,0.7)'
            }}>
              👑 CHOOSE YOUR LEADER
            </h1>
            <p style={{ fontSize: '1.2rem', color: '#ccc', marginBottom: '20px' }}>
              Select your leader from the {selectedFaction.name}
            </p>
            <p style={{ fontSize: '1rem', color: selectedFaction.color, marginBottom: '40px' }}>
              {selectedFaction.symbol} {selectedFaction.philosophy}
            </p>
            
            <div id="characterGrid" style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(2, 1fr)', 
              gap: '25px',
              marginBottom: '40px'
            }}>
              {/* Character cards will be rendered here by JavaScript */}
            </div>
            
            <button onClick={() => setSelectionStep('faction')} style={{
              padding: '10px 20px',
              backgroundColor: '#666',
              color: '#eee',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}>
              ← Back to Factions
            </button>
          </div>
        )}

        {/* Pet Selection Step */}
        {selectionStep === 'pet' && selectedFaction && selectedCharacter && (
          <div style={{ textAlign: 'center', maxWidth: '1000px', width: '100%' }}>
            <h1 style={{ 
              color: '#ffd700', 
              fontSize: '3rem', 
              marginBottom: '10px',
              textShadow: '2px 2px 4px rgba(0,0,0,0.7)'
            }}>
              🐾 CHOOSE YOUR COMPANION
            </h1>
            <p style={{ fontSize: '1.2rem', color: '#ccc', marginBottom: '20px' }}>
              Select a companion for {selectedCharacter.name}
            </p>
            <p style={{ fontSize: '1rem', color: selectedFaction.color, marginBottom: '40px' }}>
              Companions provide tactical support and special abilities
            </p>
            
            <div id="petGrid" style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(3, 1fr)', 
              gap: '20px',
              marginBottom: '40px'
            }}>
              {/* Pet cards will be rendered here by JavaScript */}
            </div>
            
            <div style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}>
              <button onClick={() => setSelectionStep('character')} style={{
                padding: '10px 20px',
                backgroundColor: '#666',
                color: '#eee',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}>
                ← Back to Leaders
              </button>
              
              {selectedPet && (
                <button 
                  onClick={() => {
                    // Start the game with selected faction, character, and pet
                    const selectionScreen = document.getElementById('selectionScreen');
                    if (selectionScreen) {
                      selectionScreen.style.display = 'none';
                    }
                    
                    // Initialize game with selections
                    if (window.initializeGameWithSelections) {
                      window.initializeGameWithSelections(selectedFaction, selectedCharacter, selectedPet);
                    }
                  }}
                  style={{
                    padding: '15px 30px',
                    fontSize: '1.2rem',
                    backgroundColor: '#ffd700',
                    color: '#0a0a0f',
                    border: 'none',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontFamily: 'Orbitron, sans-serif',
                    textTransform: 'uppercase',
                    boxShadow: '0 4px 15px rgba(255, 215, 0, 0.3)',
                    transition: 'all 0.3s ease'
                  }}
                >
                  🚀 Begin Exploration
                </button>
              )}
            </div>
          </div>
        )}

        {/* Game Info */}
        <div style={{ 
          position: 'absolute',
          bottom: '30px',
          textAlign: 'center',
          fontSize: '0.8rem', 
          color: '#666',
          maxWidth: '600px',
          lineHeight: '1.6'
        }}>
          Navigate a procedurally generated hex-based world with diverse terrain types. 
          Build settlements, gather resources, and lead your civilization to prosperity 
          in post-WWIII Africa and Europe.
        </div>
      </div>

      {/* Civilization-Style Game Canvas Container */}
      <div id="gameContainer" style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#1a1a2e',
        background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 100%)'
      }}>
        {/* Hex Grid Overlay for Civilization feel */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          opacity: 0.1,
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffd700' fill-opacity='0.3'%3E%3Cpath d='M30 0l25.98 15v30L30 60 4.02 45V15z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          pointerEvents: 'none'
        }}></div>
        {/* Three.js canvas will be inserted here */}
      </div>

      {/* Civilization-Style Game UI Elements */}
      <div id="gameUI" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 100,
        fontFamily: 'Orbitron, sans-serif'
      }}>
        {/* Top HUD Bar - Civilization style */}
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          right: '10px',
          height: '60px',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          borderRadius: '10px',
          border: '2px solid #ffd700',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          pointerEvents: 'auto'
        }}>
          {/* Leader Info */}
          <div style={{ display: 'flex', alignItems: 'center', marginRight: '30px' }}>
            <div id="leaderAvatar" style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: '#ffd700',
              marginRight: '10px'
            }}></div>
            <div>
              <div id="leaderName" style={{ color: '#ffd700', fontSize: '0.9rem', fontWeight: 'bold' }}>
                Leader
              </div>
              <div style={{ display: 'flex', gap: '10px', fontSize: '0.8rem' }}>
                <span id="leaderHP" style={{ color: '#4CAF50' }}>HP: 100</span>
                <span id="leaderEP" style={{ color: '#2196F3' }}>EP: 100</span>
              </div>
            </div>
          </div>

          {/* Resources */}
          <div style={{ display: 'flex', gap: '20px', marginRight: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ color: '#FF9800' }}>🏛️</span>
              <span id="turnCounter" style={{ color: '#eee', fontSize: '0.9rem' }}>Turn: 1</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ color: '#4CAF50' }}>🗺️</span>
              <span id="explorationPercent" style={{ color: '#eee', fontSize: '0.9rem' }}>Explored: 0%</span>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button id="toggleZoomBtn" style={{
              padding: '8px 12px',
              backgroundColor: '#444',
              color: '#eee',
              border: '1px solid #666',
              borderRadius: '5px',
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}>
              🔍 Zoom
            </button>
            <button id="toggleMinimapBtn" style={{
              padding: '8px 12px',
              backgroundColor: '#444',
              color: '#eee',
              border: '1px solid #666',
              borderRadius: '5px',
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}>
              🗺️ Map
            </button>
          </div>
        </div>

        {/* Bottom Left - Companion Info */}
        <div id="companionHUD" style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          width: '250px',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          borderRadius: '10px',
          border: '2px solid #ffd700',
          padding: '15px',
          pointerEvents: 'auto'
        }}>
          <div style={{ color: '#ffd700', fontSize: '1rem', fontWeight: 'bold', marginBottom: '10px' }}>
            🐾 Companion Status
          </div>
          <div id="petInfo" style={{ color: '#eee', fontSize: '0.8rem', lineHeight: '1.4' }}>
            <div>Name: <span id="petName">-</span></div>
            <div>Health: <span id="petHP" style={{ color: '#4CAF50' }}>-</span></div>
            <div>Energy: <span id="petEP" style={{ color: '#2196F3' }}>-</span></div>
            <div>Status: <span id="petStatus">Ready</span></div>
          </div>
        </div>

        {/* Bottom Right - Terrain Info */}
        <div id="terrainHUD" style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          width: '250px',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          borderRadius: '10px',
          border: '2px solid #ffd700',
          padding: '15px',
          pointerEvents: 'auto'
        }}>
          <div style={{ color: '#ffd700', fontSize: '1rem', fontWeight: 'bold', marginBottom: '10px' }}>
            🗺️ Current Terrain
          </div>
          <div id="terrainInfo" style={{ color: '#eee', fontSize: '0.8rem', lineHeight: '1.4' }}>
            <div>Type: <span id="currentTerrain">Plains</span></div>
            <div>Coordinates: <span id="currentCoords">(0, 0)</span></div>
            <div>Resources: <span id="terrainResources">None</span></div>
            <div>Movement Cost: <span id="movementCost">1</span></div>
          </div>
        </div>

        {/* Minimap */}
        <div id="minimap" style={{
          position: 'absolute',
          top: '80px',
          right: '10px',
          width: '200px',
          height: '150px',
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          borderRadius: '10px',
          border: '2px solid #ffd700',
          padding: '10px',
          display: 'none',
          pointerEvents: 'auto'
        }}>
          <div style={{ color: '#ffd700', fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '5px' }}>
            World Map
          </div>
          <canvas id="minimapCanvas" style={{
            width: '100%',
            height: 'calc(100% - 25px)',
            border: '1px solid #444',
            borderRadius: '3px'
          }}></canvas>
        </div>

        {/* Notifications Area */}
        <div id="notifications" style={{
          position: 'absolute',
          top: '50%',
          right: '20px',
          transform: 'translateY(-50%)',
          width: '300px',
          pointerEvents: 'none'
        }}>
          {/* Notifications will be populated by the game scripts */}
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  );
}

export default App;
