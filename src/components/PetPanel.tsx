import React from 'react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';

/** Simple pet management panel: shows pet name, level, and allows incrementing level. */
export const PetPanel: React.FC = () => {
  const { profile, saveProgress } = usePlayerProfile();
  const pet = profile?.progress?.pet;
  if (!pet) return null;

  const increment = () => {
    const newLevel = (pet.level || 1) + 1;
    saveProgress({ pet: { ...pet, level: newLevel }});
  };

  return (
    <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(20,20,30,0.85)', color: '#fff', padding: '8px 12px', borderRadius: 8, fontFamily: 'sans-serif', width: 200 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Pet</div>
  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>{pet.type || 'Pet'}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12 }}>Level: {pet.level ?? 1}</span>
        <button onClick={increment} style={{ background: '#3b82f6', color: '#fff', border: 'none', fontSize: 12, padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>+1</button>
      </div>
    </div>
  );
};

export default PetPanel;
