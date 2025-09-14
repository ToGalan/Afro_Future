import { jsx as _jsx } from "react/jsx-runtime";
import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { PART_VARIANTS } from '../assets/threeParts';
// Returns variant record indexed by id for quick lookup
const variantById = PART_VARIANTS.reduce((acc, v) => { acc[v.id] = v; return acc; }, {});
function PartMesh({ file, group }) {
    const publicPath = `/assets/3d/${file}`;
    const { scene } = useGLTF(publicPath);
    // Clone so tagging does not mutate cached scene
    const inst = scene.clone();
    inst.traverse((obj) => {
        if (!obj.userData)
            obj.userData = {};
        obj.userData.partGroup = group; // tag for downstream tint logic
    });
    return _jsx("primitive", { object: inst });
}
export function AvatarPartsLoader({ parts }) {
    const activeVariants = useMemo(() => {
        if (!parts)
            return [];
        return Object.values(parts).filter(Boolean);
    }, [parts]);
    return (_jsx("group", { children: _jsx(Suspense, { fallback: null, children: activeVariants.map(id => {
                const v = variantById[id];
                if (!v)
                    return null;
                return _jsx(PartMesh, { file: v.file, group: v.group }, id);
            }) }) }));
}
// Legacy direct preload kept (harmless). Centralized tiered preloads now in assets/preloadAssets.ts
useGLTF.preload('/assets/3d/NakedFullBody.glb');
export function BaseBody() {
    const { scene } = useGLTF('/assets/3d/NakedFullBody.glb');
    return _jsx("primitive", { object: scene.clone(), position: [0, -1, 0] });
}
