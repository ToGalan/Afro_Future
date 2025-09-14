import { create } from 'zustand';
import * as THREE from 'three';
import { getVariantsByGroup, PART_VARIANTS } from '../assets/threeParts';
// Basic palette & removable metadata (extend as needed)
export const GROUP_META = [
    { group: 'Head', palette: ['#c58b66', '#d7a07b', '#b97752'], starting: undefined },
    { group: 'Face', palette: ['#c58b66', '#d7a07b', '#b97752'] },
    { group: 'Eyes', palette: ['#4aa3ff', '#00c2b8', '#8b5cf6', '#ffd54a'] },
    { group: 'Hair', palette: ['#1f130b', '#3b2a1a', '#6d4c2f', '#c8a26a', '#ffffff'] },
    { group: 'Hat', removable: true },
    { group: 'Glasses', removable: true, palette: ['#ffffff', '#ffd54a', '#ff6b6b', '#4aa3ff'] },
    { group: 'Facial Hair', removable: true, palette: ['#1f130b', '#3b2a1a', '#6d4c2f', '#c8a26a'] },
    { group: 'Earrings', removable: true, palette: ['#ffd54a', '#ffffff', '#ff6b6b'] },
    { group: 'Top', palette: ['#0ea5e9', '#6366f1', '#dc2626', '#16a34a', '#fbbf24'] },
    { group: 'Outfit', removable: true, palette: ['#6366f1', '#16a34a', '#dc2626', '#f97316'] },
    { group: 'Bottom', palette: ['#0ea5e9', '#6366f1', '#16a34a', '#f97316'] },
    { group: 'Shoes', palette: ['#ffffff', '#0ea5e9', '#6366f1', '#16a34a', '#dc2626'] },
    { group: 'Accessory', removable: true, palette: ['#ffd54a', '#ff6b6b', '#4aa3ff'] },
];
function randomOf(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export const useCreatorStore = create((set, get) => ({
    parts: {},
    groupColors: {},
    skinColor: '#c58b66',
    skinMaterial: new THREE.MeshStandardMaterial({ color: '#c58b66', roughness: 1 }),
    selectPart: (group, variantId) => set(state => {
        const g = group;
        const next = { ...state.parts, [g]: state.parts[g] === variantId ? undefined : variantId };
        // Mutual exclusion Outfit vs Top/Bottom
        if (g === 'Outfit' && !(state.parts[g] === variantId)) {
            next.Top = undefined;
            next.Bottom = undefined;
        }
        if ((g === 'Top' || g === 'Bottom') && !(state.parts[g] === variantId)) {
            next.Outfit = undefined;
        }
        return { parts: next };
    }),
    clearPart: (group) => set(state => ({ parts: { ...state.parts, [group]: undefined } })),
    setGroupColor: (group, color) => set(state => ({ groupColors: { ...state.groupColors, [group]: color } })),
    setSkinColor: (color) => set(state => {
        state.skinMaterial.color.set(color);
        return { skinColor: color };
    }),
    randomize: () => {
        const parts = {};
        const groupColors = {};
        GROUP_META.forEach(meta => {
            const variants = getVariantsByGroup(meta.group);
            if (variants.length) {
                // 25% chance to leave removable empty
                if (meta.removable && Math.random() < 0.25) {
                    parts[meta.group] = undefined;
                    return;
                }
                parts[meta.group] = randomOf(variants)?.id;
            }
            if (meta.palette?.length)
                groupColors[meta.group] = randomOf(meta.palette);
        });
        // Enforce outfit mutual exclusion after randomization
        if (parts.Outfit) {
            parts.Top = undefined;
            parts.Bottom = undefined;
        }
        set({ parts, groupColors });
    }
}));
// Helper to fetch variant file by id
export function findVariantFile(id) {
    if (!id)
        return undefined;
    return PART_VARIANTS.find(v => v.id === id)?.file;
}
