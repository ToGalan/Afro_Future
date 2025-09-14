import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
const PreviewContext = createContext(null);
export const useSharedPreview = () => {
    const ctx = useContext(PreviewContext);
    if (!ctx)
        throw new Error('useSharedPreview must be used within <SharedVariantPreviewProvider>');
    return ctx;
};
export function SharedVariantPreviewProvider({ children }) {
    const containerRef = useRef(null);
    const [target, setTarget] = useState(null);
    const keyRef = useRef(0);
    const setCardPreview = useCallback((file, el, persistent = false) => {
        if (!el)
            return;
        const rect = el.getBoundingClientRect();
        keyRef.current += 1;
        setTarget({ file, rect, persistent, key: keyRef.current });
    }, []);
    const clearIfTransient = useCallback((file) => {
        setTarget(cur => {
            if (cur && cur.file === file && !cur.persistent)
                return null;
            return cur;
        });
    }, []);
    // Recompute rect on resize/scroll
    useEffect(() => {
        if (!target)
            return;
        const handle = () => {
            const cards = document.querySelectorAll('[data-variant-card]');
            cards.forEach(el => {
                if (el.getAttribute('data-file') === target.file) {
                    const r = el.getBoundingClientRect();
                    setTarget(t => t ? { ...t, rect: r } : t);
                }
            });
        };
        window.addEventListener('scroll', handle, true);
        window.addEventListener('resize', handle);
        return () => {
            window.removeEventListener('scroll', handle, true);
            window.removeEventListener('resize', handle);
        };
    }, [target]);
    return (_jsx("div", { ref: containerRef, className: "relative", children: _jsxs(PreviewContext.Provider, { value: { setCardPreview, clearIfTransient }, children: [children, target && (_jsx(OverlayCanvas, { target: target, container: containerRef }))] }) }));
}
function OverlayCanvas({ target, container }) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const t = setTimeout(() => setReady(true), 15); // small delay to avoid thrash
        return () => clearTimeout(t);
    }, [target.key]);
    if (!ready)
        return null;
    const cRect = container.current?.getBoundingClientRect();
    if (!cRect)
        return null;
    const left = target.rect.left - cRect.left;
    const top = target.rect.top - cRect.top;
    const style = {
        position: 'absolute',
        left, top,
        width: target.rect.width,
        height: target.rect.height,
        pointerEvents: 'none',
        zIndex: 30,
    };
    return (_jsx("div", { style: style, children: _jsxs(Canvas, { dpr: 0.9, camera: { position: [0.9, 0.9, 0.9], fov: 34 }, children: [_jsx("ambientLight", { intensity: 0.85 }), _jsx("directionalLight", { position: [1.2, 2, 2], intensity: 0.65 }), _jsx(SingleRotator, { file: target.file })] }) }));
}
function SingleRotator({ file }) {
    const ref = useRef(null);
    useFrame((_s, dt) => { if (ref.current)
        ref.current.rotation.y += dt * 0.4; });
    return (_jsx("group", { ref: ref, children: _jsx(FitModel, { url: `/assets/3d/${file}` }) }));
}
function FitModel({ url }) {
    const group = useRef(null);
    const { scene } = useGLTF(url);
    const clone = React.useMemo(() => scene.clone(true), [scene]);
    const { invalidate } = useThree();
    useEffect(() => {
        if (!group.current)
            return;
        const bbox = new THREE.Box3().setFromObject(group.current);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        group.current.position.sub(center);
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = maxDim > 0 ? 1.35 / maxDim : 1;
        group.current.scale.setScalar(scale);
        invalidate();
    }, [clone, invalidate]);
    return _jsx("group", { ref: group, children: _jsx("primitive", { object: clone }) });
}
useGLTF.preload('/assets/3d/Hair.001.glb');
