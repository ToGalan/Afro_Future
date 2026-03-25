# Afro-Future 3D System

This enhanced 3D system provides professional-grade low-poly isometric rendering and animation capabilities for the Afro-Future Rising game.

## Features

### 🎨 **Style Management**
- **Isometric Design Guidelines**: Follows the premium, clean aesthetic specified in the style guide
- **Material Enhancement**: Semi-matte finishes with naturalistic colors and slight saturation boost
- **Consistent Lighting**: Soft ambient lighting with subtle top-right directional light
- **Professional Quality**: High-resolution rendering with crisp edge definition

### 🎬 **Advanced Animation System**
- **Velocity.js Integration**: Smooth, eased animations with fallback support
- **Morphing & Skinning**: Advanced mesh deformation capabilities
- **Skeletal Animation**: Full support for rigged character models
- **Position/Rotation/Scale**: Comprehensive transform animations

### 🎭 **Enhanced Character System**
- **Enhanced3DChibi**: Advanced chibi actors with smooth movement
- **Animation States**: Idle, movement, and action animations
- **Smooth Transitions**: Automatic facing direction and movement interpolation
- **Effect System**: Bounce, pulse, and other visual effects

## File Structure

```
3d/
├── config/
│   └── default-style.json          # Isometric style configuration
├── utils/
│   └── style-manager.js            # Material and lighting management
├── animation/
│   ├── velocity-animator.js        # Velocity.js integration
│   ├── morph-controller.js         # Mesh morphing and skinning
│   └── animation-manager.js        # Main animation coordinator
├── components/
│   └── enhanced-chibi.js           # Advanced chibi actor system
├── integration-helper.js           # Compatibility helpers
└── index.js                       # Main 3D system entry point
```

## Usage

### Basic Integration

The 3D system automatically initializes when the page loads. Use these helper functions in your existing code:

```javascript
// Enhanced material creation
if (window.threeDSystem?.createStyledMaterial) {
    material = window.threeDSystem.createStyledMaterial(colorHex, terrainType, options);
}

// Smooth actor movement
window.smoothMoveActor(actorData, newX, newY, newZ);

// Animated tile effects
window.animateHexTileClick(hexMesh, userData);
```

### Advanced Character Creation

```javascript
// Create enhanced chibi actor
if (typeof Enhanced3DChibi !== 'undefined') {
    actorData.chibiInstance = new Enhanced3DChibi(
        parentGroup, x, y, z, 'nia'
    );
}

// Smooth movement with animation
actorData.chibiInstance.moveTo(newX, newY, newZ, 800);

// Visual effects
actorData.chibiInstance.playBounceEffect();
actorData.chibiInstance.playPulseEffect();
```

### Animation System

```javascript
// Object animations
await window.threeDSystem.animateObject(mesh, {
    type: 'position',
    target: { x: 10, y: 5, z: 0 },
    duration: 1000,
    easing: 'easeInOutQuad'
});

// Morph target animation
await window.threeDSystem.morphMesh(meshId, targetIndex, influence, duration);

// Skeletal animation
window.threeDSystem.playAnimation(meshId, 'walk', true, 0.3);
```

## Style Guide Implementation

The system automatically applies the following style principles:

- **Perspective**: True isometric view with orthographic camera
- **Lighting**: Soft ambient (40%) + subtle directional (60%) from top-right
- **Materials**: Semi-matte finish (roughness: 0.6, metalness: 0.1)
- **Colors**: Naturalistic tones with 20% saturation boost
- **Shadows**: Gentle drop shadows with PCF soft shadow mapping
- **Background**: Pure white (#FFFFFF) for icon-style rendering

## Testing

Open `test-3d-system.html` in your browser to verify the 3D system is working correctly:

1. **Basic Scene Test**: Verifies THREE.js and basic rendering
2. **Isometric View Test**: Tests the style guide implementation
3. **Animation Test**: Validates smooth animation capabilities
4. **Style Test**: Confirms material enhancement system

## Dependencies

- **THREE.js** (v0.158.0+): Core 3D rendering engine
- **Velocity.js** (optional): Enhanced animation easing
- **Anime.js** (fallback): Alternative animation library
- **Chroma.js** (optional): Color manipulation for style enhancement

## Performance

The system is optimized for:
- **Material Caching**: Reuses materials across similar objects
- **Geometry Instancing**: Shared geometries for hex tiles
- **Animation Pooling**: Efficient animation state management
- **Shadow Optimization**: Smart shadow camera sizing
- **LOD Support**: Ready for level-of-detail implementation

## Browser Compatibility

- **WebGL 1.0**: Minimum requirement
- **WebGL 2.0**: Enhanced features and performance
- **Hardware Acceleration**: Required for optimal performance
- **Modern Browsers**: Chrome 80+, Firefox 75+, Safari 13+, Edge 80+

## Troubleshooting

### Common Issues

1. **3D System Not Initializing**
   - Check browser WebGL support
   - Verify all script files are loaded
   - Check console for specific error messages

2. **Animation Not Working**
   - Ensure Velocity.js or anime.js is available
   - Check that objects have valid transform properties
   - Verify animation manager is running

3. **Materials Look Wrong**
   - Confirm style-manager.js loaded successfully
   - Check that chroma.js is available for color enhancement
   - Verify lighting setup in your scene

### Debug Mode

Enable debug logging by setting:
```javascript
window.threeDSystemDebug = true;
```

This will provide detailed console output for troubleshooting.

## Future Enhancements

- **Particle Systems**: Environmental effects (dust, sparkles, etc.)
- **Post-Processing**: Bloom, SSAO, and other visual effects
- **LOD System**: Automatic level-of-detail for large maps
- **Audio Integration**: 3D positional audio system
- **VR Support**: WebXR compatibility for immersive gameplay

---

**Created for Afro-Future Rising v1.2**  
*Professional 3D rendering system with isometric design principles*
