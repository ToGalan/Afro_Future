import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { AvatarPartsLoader, BaseBody } from './AvatarPartsLoader';
import { AvatarAnimator } from './AvatarAnimator';
import * as THREE from 'three';
import { useCreatorStore } from '../store/creatorStore';
// Central token mapping: each color channel -> array of material name substrings to match
// To extend: add new channel key (e.g. "emissive") and update AvatarSceneProps.colors + tintHierarchy logic.
const MATERIAL_TOKENS = {
    skin: ['skin'],
    primary: ['primary', 'fabric', 'cloth', 'armor'],
    secondary: ['secondary', 'trim', 'detail', 'accent'],
};
// Internal debug flag (overridden by prop each render)
let TINT_DEBUG = false;
function IdlePivot({ children, speed = 0.15 }) {
    const ref = useRef();
    useFrame((_s, dt) => {
        if (ref.current)
            ref.current.rotation.y += dt * speed;
    });
    return _jsx("group", { ref: ref, children: children });
}
// Walk the hierarchy and recolor materials that contain token substrings.
// Materials are cloned once (flag userData.__tinted) to avoid mutating shared references from cached GLTFs.
function applyStoreTint(root, store, fallback) {
    const applied = [];
    const { groupColors, skinMaterial } = store;
    root.traverse(obj => {
        const mesh = obj;
        if (!mesh.material)
            return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((orig, idx) => {
            if (!orig)
                return;
            // Shared skin substitution: if name includes Skin_ we replace with central skinMaterial instance
            const lowerName = (orig.name || '').toLowerCase();
            if (lowerName.includes('skin_') || lowerName === 'skin') {
                // assign shared instance
                if (Array.isArray(mesh.material)) {
                    mesh.material[idx] = skinMaterial;
                }
                else {
                    mesh.material = skinMaterial;
                }
                applied.push({ name: orig.name || '(skin)', via: 'shared-skin' });
                return;
            }
            // Only proceed if material has a color field
            if (!orig.color)
                return;
            let m = orig;
            if (!m.userData.__tinted) {
                m = m.clone();
                m.userData.__tinted = true;
                if (Array.isArray(mesh.material)) {
                    mesh.material[idx] = m;
                }
                else {
                    mesh.material = m;
                }
            }
            // Determine group from userData tag
            const partGroup = mesh.userData?.partGroup || obj.userData?.partGroup;
            // Color priority: explicit groupColors[group] if material name contains Color_ token; else fallback heuristic tokens
            let targetColor;
            if (lowerName.includes('color_') && partGroup && groupColors[partGroup]) {
                targetColor = groupColors[partGroup];
            }
            else {
                // heuristic existing token mapping (primary/secondary)
                for (const key of Object.keys(MATERIAL_TOKENS)) {
                    if (MATERIAL_TOKENS[key].some(tok => lowerName.includes(tok))) {
                        targetColor = fallback?.[key];
                        break;
                    }
                }
            }
            if (targetColor) {
                m.color.set(targetColor);
                applied.push({ name: m.name || '(unnamed)', via: partGroup ? `group:${partGroup}` : 'fallback-token', color: targetColor });
            }
        });
    });
    if (TINT_DEBUG && applied.length) {
        // eslint-disable-next-line no-console
        console.log('[Tint] Applied', applied.length, 'updates', applied);
    }
}
function AutoFrameHelper({ rootRef, enabled, margin, deps, manualOffset }) {
    const { camera } = useThree();
    const [computed, setComputed] = useState({ scale: 1, offset: manualOffset, ready: false });
    useEffect(() => {
        if (!enabled)
            return;
        if (!rootRef.current)
            return;
        const attempt = () => {
            const root = rootRef.current;
            // Compute bounds
            const box = new THREE.Box3().setFromObject(root);
            if (box.isEmpty() || !isFinite(box.min.y) || !isFinite(box.max.y)) {
                // try again shortly (assets may still be streaming)
                requestAnimationFrame(attempt);
                return;
            }
            const size = new THREE.Vector3();
            box.getSize(size);
            const height = size.y || 1;
            // Distance from camera to origin (assumes target near origin); more robust would use provided target
            const dist = camera.position.length();
            const vFov = camera.fov * Math.PI / 180;
            const totalVisibleHeight = 2 * Math.tan(vFov / 2) * dist;
            const allowed = totalVisibleHeight * (1 - margin);
            const scale = allowed / height;
            // Center horizontally, lift so feet sit slightly above bottom (keep small positive to avoid clip)
            const minY = box.min.y;
            const maxY = box.max.y;
            const centerX = (box.min.x + box.max.x) / 2;
            const centerZ = (box.min.z + box.max.z) / 2;
            // We want feet ~ at y = - (allowed/2) + smallPadding after scale because camera looks at mid torso.
            // Simpler: shift so minY becomes -height*scale*0.02 (tiny padding) then apply manualOffset additive.
            const footPad = height * scale * 0.02;
            const yOffset = (-minY * scale) - footPad;
            const offset = [(-centerX) * scale + manualOffset[0], yOffset + manualOffset[1], (-centerZ) * scale + manualOffset[2]];
            setComputed({ scale, offset, ready: true });
        };
        // Delay one rAF to ensure suspense content present
        requestAnimationFrame(attempt);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, camera, margin, rootRef, ...deps]);
    return _jsx("group", { visible: false, userData: computed }); // marker; parent AvatarScene will read this state
}
export function AvatarScene({ parts, colors, debugTint, animPaused, animSpeed, rotateSpeed, disableControls, cameraPosition, cameraFov, target, modelOffset, modelScale, autoFrame, frameMargin }) {
    const rootRef = useRef(null);
    const groupColors = useCreatorStore(s => s.groupColors);
    const skinMaterial = useCreatorStore(s => s.skinMaterial);
    // Re-apply tint when parts mount, group colors change, or skin color changes
    useEffect(() => {
        if (rootRef.current) {
            TINT_DEBUG = !!debugTint;
            applyStoreTint(rootRef.current, { groupColors, skinMaterial }, colors);
        }
    }, [parts, groupColors, skinMaterial, colors, debugTint]);
    const camPos = cameraPosition ?? [2.1, 1.5, 2.6];
    const fov = cameraFov ?? 35;
    const tgt = target ?? [0, 0.9, 0];
    const offset = modelOffset ?? [0, 0, 0];
    const scale = modelScale ?? 1;
    const margin = frameMargin ?? 0.12;
    // We'll read auto-frame result through ref to hidden helper group to avoid extra renders
    const autoDataRef = useRef(null);
    return (_jsxs(Canvas, { shadows: true, camera: { position: camPos, fov }, dpr: [1, 1.75], children: [_jsx("color", { attach: "background", args: ["#12171f"] }), _jsx("ambientLight", { intensity: 0.4 }), _jsx("directionalLight", { position: [5, 5, 5], intensity: 1.1, castShadow: true, "shadow-mapSize-width": 1024, "shadow-mapSize-height": 1024 }), _jsxs(Suspense, { fallback: null, children: [autoFrame && (_jsx(AutoFrameHelper, { rootRef: rootRef, enabled: !!autoFrame, margin: margin, manualOffset: offset, deps: [parts] })), _jsx(IdlePivot, { speed: rotateSpeed ?? 0.15, children: _jsx("group", { ref: rootRef, 
                            // Dynamically apply auto frame data if available; fallback to manual
                            position: (autoFrame && autoDataRef.current?.ready ? autoDataRef.current.offset : offset), scale: (autoFrame && autoDataRef.current?.ready ? autoDataRef.current.scale : scale) || 1, onUpdate: grp => {
                                // pull latest auto frame data from hidden helper (stored in userData of its group)
                                if (!autoFrame)
                                    return;
                                const helper = grp.parent?.children?.find((c) => c.userData && c.userData.ready !== undefined);
                                if (helper && helper.userData.ready) {
                                    autoDataRef.current = helper.userData;
                                    // force update transform
                                    grp.scale.setScalar(helper.userData.scale);
                                    const off = helper.userData.offset;
                                    grp.position.set(off[0], off[1], off[2]);
                                }
                            }, children: _jsx(AvatarAnimator, { paused: animPaused, speed: animSpeed, children: _jsxs("group", { children: [_jsx(BaseBody, {}), _jsx(AvatarPartsLoader, { parts: parts })] }) }) }) }), _jsx(Environment, { preset: "city" })] }), !disableControls && _jsx(OrbitControls, { enablePan: false, minDistance: 2, maxDistance: 4, target: tgt })] }));
}
export default AvatarScene;
