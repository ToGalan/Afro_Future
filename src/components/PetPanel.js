import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { usePlayerProfile } from '../hooks/usePlayerProfile';
/** Simple pet management panel: shows pet name, level, and allows incrementing level. */
export const PetPanel = () => {
    const { profile, saveProgress } = usePlayerProfile();
    const pet = profile?.progress?.pet;
    if (!pet)
        return null;
    const increment = () => {
        const newLevel = (pet.level || 1) + 1;
        saveProgress({ pet: { ...pet, level: newLevel } });
    };
    return (_jsxs("div", { style: { position: 'absolute', top: 8, right: 8, background: 'rgba(20,20,30,0.85)', color: '#fff', padding: '8px 12px', borderRadius: 8, fontFamily: 'sans-serif', width: 200 }, children: [_jsx("div", { style: { fontSize: 14, fontWeight: 600, marginBottom: 4 }, children: "Pet" }), _jsx("div", { style: { fontSize: 12, opacity: 0.8, marginBottom: 6 }, children: pet.type || 'Pet' }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }, children: [_jsxs("span", { style: { fontSize: 12 }, children: ["Level: ", pet.level ?? 1] }), _jsx("button", { onClick: increment, style: { background: '#3b82f6', color: '#fff', border: 'none', fontSize: 12, padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }, children: "+1" })] })] }));
};
export default PetPanel;
