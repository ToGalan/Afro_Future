import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
/** Lightweight 3D thumbnail preview for a single variant GLB.
 * Performance considerations:
 * - frameloop='demand' so it only renders on load.
 * - Low DPR (0.8) to keep it cheap.
 * - No shadows / post effects.
 * - Single ambient + directional for subtle depth.
 */
export function VariantPreview({ file }) {
    const path = `/assets/3d/${file}`;
    const [hover, setHover] = useState(false);
    return (_jsx("div", { className: "absolute inset-0", onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false), children: _jsxs(Canvas, { shadows: false, dpr: 0.9, camera: { position: [0.9, 0.9, 0.9], fov: 34 }, children: [_jsx("ambientLight", { intensity: 0.85 }), _jsx("directionalLight", { position: [1.2, 2, 2], intensity: 0.65 }), _jsx(Suspense, { fallback: null, children: _jsx(Rotator, { speedBase: 0.25, speedHover: 0.9, hover: hover, children: _jsx(FitModel, { url: path }) }) })] }) }));
}
function Rotator({ children, speedBase, speedHover, hover }) {
    const ref = useRef(null);
    useFrame((_s, dt) => {
        if (ref.current) {
            const target = hover ? speedHover : speedBase;
            ref.current.rotation.y += dt * target;
        }
    });
    return _jsx("group", { ref: ref, children: children });
}
function FitModel({ url }) {
    const group = useRef(null);
    const { scene } = useGLTF(url);
    const clone = useMemo(() => scene.clone(true), [scene]);
    const { invalidate } = useThree();
    // Fit & center once
    useEffect(() => {
        if (!group.current)
            return;
        // Compute bounding box
        const bbox = new THREE.Box3().setFromObject(group.current);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        group.current.position.sub(center); // center it
        const maxDim = Math.max(size.x, size.y, size.z);
        // Slightly larger divisor to provide margin inside thumbnail
        const scale = maxDim > 0 ? 1.35 / maxDim : 1;
        group.current.scale.setScalar(scale);
        invalidate(); // initial frame
    }, [clone, invalidate]);
    return _jsx("group", { ref: group, children: _jsx("primitive", { object: clone }) });
}
// Legacy single preview preload (now largely superseded by tiered scheduler)
useGLTF.preload('/assets/3d/Hair.001.glb');
export default VariantPreview;
