// Auto-generated mapping for 3D configurator parts based on files in assets/3d
// Each group lists logical variant identifiers and a display label.
// Filenames like Hair.001.glb -> id hair_001

export type PartGroup = 'Head' | 'Face' | 'Eyes' | 'Eyebrows' | 'Nose' | 'Hair' | 'Hat' | 'Glasses' | 'Facial Hair' | 'Earrings' | 'Top' | 'Outfit' | 'Bottom' | 'Shoes' | 'Accessory';

export interface PartVariant { id: string; file: string; label: string; group: PartGroup; }

// Helper to build variant entries
function v(group: PartGroup, file: string, label?: string): PartVariant {
  const base = file.replace(/\.glb$/,'');
  const norm = base.toLowerCase().replace(/\./g,'_');
  const id = `${group.replace(/\s+/g,'').toLowerCase()}_${norm}`;
  // store just filename; runtime loader will map to actual path
  return { id, file, label: label ?? base, group };
}

export const PART_VARIANTS: PartVariant[] = [
  // Heads (if distinct from face morph targets)
  v('Head','Head.001.glb','Head A'),
  v('Head','Head.002.glb','Head B'),
  v('Head','Head.003.glb','Head C'),
  v('Head','Head.004.glb','Head D'),
  // Faces (expressions / geometry variants)
  v('Face','Face.001.glb','Face A'),
  v('Face','Face.002.glb','Face B'),
  v('Face','Face.003.glb','Face C'),
  v('Face','Face.004.glb','Face D'),
  v('Face','Face.005.glb','Face E'),
  v('Face','Face.006.glb','Face F'),
  v('Face','Face.007.glb','Face G'),
  // Eyes
  v('Eyes','Eyes.001.glb','Eyes 1'),
  v('Eyes','Eyes.002.glb','Eyes 2'),
  v('Eyes','Eyes.003.glb','Eyes 3'),
  v('Eyes','Eyes.004.glb','Eyes 4'),
  v('Eyes','Eyes.005.glb','Eyes 5'),
  v('Eyes','Eyes.006.glb','Eyes 6'),
  v('Eyes','Eyes.007.glb','Eyes 7'),
  v('Eyes','Eyes.008.glb','Eyes 8'),
  v('Eyes','Eyes.009.glb','Eyes 9'),
  v('Eyes','Eyes.010.glb','Eyes 10'),
  v('Eyes','Eyes.011.glb','Eyes 11'),
  v('Eyes','Eyes.012.glb','Eyes 12'),
  // Eyebrows
  v('Eyebrows','EyeBrow.001.glb','Brow 1'),
  v('Eyebrows','EyeBrow.002.glb','Brow 2'),
  v('Eyebrows','EyeBrow.003.glb','Brow 3'),
  v('Eyebrows','EyeBrow.004.glb','Brow 4'),
  v('Eyebrows','EyeBrow.005.glb','Brow 5'),
  v('Eyebrows','EyeBrow.006.glb','Brow 6'),
  v('Eyebrows','EyeBrow.007.glb','Brow 7'),
  v('Eyebrows','EyeBrow.008.glb','Brow 8'),
  v('Eyebrows','EyeBrow.009.glb','Brow 9'),
  v('Eyebrows','EyeBrow.010.glb','Brow 10'),
  // Noses (if separate geometry)
  v('Nose','Nose.001.glb','Nose 1'),
  v('Nose','Nose.002.glb','Nose 2'),
  v('Nose','Nose.003.glb','Nose 3'),
  v('Nose','Nose.004.glb','Nose 4'),
  // Hair
  v('Hair','Hair.001.glb','Hair 1'),
  v('Hair','Hair.002.glb','Hair 2'),
  v('Hair','Hair.003.glb','Hair 3'),
  v('Hair','Hair.004.glb','Hair 4'),
  v('Hair','Hair.005.glb','Hair 5'),
  v('Hair','Hair.006.glb','Hair 6'),
  v('Hair','Hair.007.glb','Hair 7'),
  v('Hair','Hair.008.glb','Hair 8'),
  v('Hair','Hair.009.glb','Hair 9'),
  v('Hair','Hair.010.glb','Hair 10'),
  v('Hair','Hair.011.glb','Hair 11'),
  // Hats / Headgear
  v('Hat','Hat.001.glb','Hat 1'),
  v('Hat','Hat.002.glb','Hat 2'),
  v('Hat','Hat.003.glb','Hat 3'),
  v('Hat','Hat.004.glb','Hat 4'),
  v('Hat','Hat.005.glb','Hat 5'),
  v('Hat','Hat.006.glb','Hat 6'),
  v('Hat','Hat.007.glb','Hat 7'),
  v('Hat','Hat.007.glb','Pumpkin Head'), // placeholder if PumpkinHead should be separate
  // Glasses
  v('Glasses','Glasses.001.glb','Glasses 1'),
  v('Glasses','Glasses.002.glb','Glasses 2'),
  v('Glasses','Glasses.003.glb','Glasses 3'),
  v('Glasses','Glasses.004.glb','Glasses 4'),
  // Facial Hair
  v('Facial Hair','FacialHair.001.glb','Facial Hair 1'),
  v('Facial Hair','FacialHair.002.glb','Facial Hair 2'),
  v('Facial Hair','FacialHair.003.glb','Facial Hair 3'),
  v('Facial Hair','FacialHair.004.glb','Facial Hair 4'),
  v('Facial Hair','FacialHair.005.glb','Facial Hair 5'),
  v('Facial Hair','FacialHair.006.glb','Facial Hair 6'),
  v('Facial Hair','FacialHair.007.glb','Facial Hair 7'),
  // Earrings
  v('Earrings','Earring.001.glb','Earring 1'),
  v('Earrings','Earring.002.glb','Earring 2'),
  v('Earrings','Earring.003.glb','Earring 3'),
  v('Earrings','Earring.004.glb','Earring 4'),
  v('Earrings','Earring.005.glb','Earring 5'),
  v('Earrings','Earring.006.glb','Earring 6'),
  // Tops
  v('Top','Top.001.glb','Top 1'),
  v('Top','Top.002.glb','Top 2'),
  v('Top','Top.003.glb','Top 3'),
  // Outfits (full body?)
  v('Outfit','Outfit.001.glb','Outfit 1'),
  v('Outfit','Outfit.002.glb','Outfit 2'),
  v('Outfit','Outfit.003.glb','Outfit 3'),
  v('Outfit','Outfit.004.glb','Outfit 4'),
  v('Outfit','WawaDress.glb','Wawa Dress'),
  // Bottoms
  v('Bottom','Bottom.001.glb','Bottom 1'),
  v('Bottom','Bottom.002.glb','Bottom 2'),
  v('Bottom','Bottom.003.glb','Bottom 3'),
  // Shoes
  v('Shoes','Shoes.001.glb','Shoes 1'),
  v('Shoes','Shoes.002.glb','Shoes 2'),
  v('Shoes','Shoes.003.glb','Shoes 3'),
  // Accessory (bow?)
  v('Accessory','Bow.001.glb','Bow 1'),
  v('Accessory','Bow.002.glb','Bow 2'),
];

export const GROUP_ORDER: PartGroup[] = [
  'Head','Face','Eyes','Eyebrows','Nose','Hair','Hat','Glasses','Facial Hair','Earrings','Top','Outfit','Bottom','Shoes','Accessory'
];

export function getVariantsByGroup(group: PartGroup) {
  return PART_VARIANTS.filter(v => v.group === group);
}

export function findVariant(id: string) {
  return PART_VARIANTS.find(v => v.id === id);
}
