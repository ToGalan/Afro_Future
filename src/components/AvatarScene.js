import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
function SpinningPlaceholder() {
    const ref = useRef();
    useFrame((_s, dt) => {
        if (ref.current)
            ref.current.rotation.y += dt * 0.6;
    });
    return (_jsxs("mesh", { ref: ref, castShadow: true, receiveShadow: true, children: [_jsx("icosahedronGeometry", { args: [0.9, 1] }), _jsx("meshStandardMaterial", { metalness: 0.2, roughness: 0.3, color: "#10b981", emissive: "#064e3b", emissiveIntensity: 0.4 })] }));
}
export function AvatarScene() {
    return (_jsxs(Canvas, { shadows: true, camera: { position: [2.1, 1.5, 2.6], fov: 35 }, dpr: [1, 1.75], children: [_jsx("color", { attach: "background", args: ["#12171f"] }), _jsx("ambientLight", { intensity: 0.4 }), _jsx("directionalLight", { position: [5, 5, 5], intensity: 1.1, castShadow: true, "shadow-mapSize-width": 1024, "shadow-mapSize-height": 1024 }), _jsxs(Suspense, { fallback: null, children: [_jsx("group", { position: [0, 0, 0], children: _jsx(SpinningPlaceholder, {}) }), _jsx(Environment, { preset: "city" })] }), _jsx(OrbitControls, { enablePan: false, minDistance: 2, maxDistance: 4, target: [0, 0.9, 0] })] }));
}
export default AvatarScene;
