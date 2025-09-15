// Centralized asset path mappings. Public assets are served from /assets/*.
// Keeping as constants ensures refactors are localized here.
// Base image path: use Vite's BASE_URL so assets resolve under subpaths (and can be swapped to CDN later)
const BASE_URL = import.meta?.env?.BASE_URL ? String(import.meta.env.BASE_URL) : '/';
// Helper to prefix path while avoiding double slashes
function p(rel) {
    const cleaned = rel.startsWith('/') ? rel : '/' + rel.replace(/^\.\//, '');
    const base = BASE_URL.replace(/\/$/, '');
    return `${base}${cleaned}`;
}
// Updated to use higher fidelity PNG faction icons bundled locally
export const FactionIcon = {
    PAA: p('/assets/img/PAA_Icon.png'),
    ASF: p('/assets/img/ASF_Icon.png'),
    WC: p('/assets/img/WC_icon.png'),
};
export const CharacterPortrait = {
    MALE: p('/assets/characters/male_default.svg'),
    FEMALE: p('/assets/characters/female_default.svg'),
};
export const PetIcon = {
    CYBER_DOG: p('/assets/img/Dog_Pet.png'),
    CYBER_CAT: p('/assets/img/Cat_Pet.png'),
};
export const fallbackPortrait = p('/assets/characters/male_default.svg');
// Raw PNG image assets are now served from the public folder: public/assets/img/* so they are reachable at
//   /assets/img/<FileName>.png
// This avoids the need to import them so they are not hashed and can be CDN cached aggressively by path.
// If you later want cache‑busting, switch to importing (Option B) instead of public static hosting.
// Naming convention: <Name>_<Gender?>_<Faction?>.png etc.
export const ImageAssets = {
    faction: {
        PAA: p('/assets/img/PAA_Icon.png'),
        ASF: p('/assets/img/ASF_Icon.png'),
        WC: p('/assets/img/WC_icon.png'),
    },
    characters: {
        // Faction-specific exemplars
        PAA: {
            MALE: p('/assets/img/Kwame_Male_PAA.png'),
            FEMALE: p('/assets/img/Makena_Female_PAA.png'),
        },
        ASF: {
            MALE: p('/assets/img/Zuberi_Male_ASF.png'),
            FEMALE: p('/assets/img/Nia_Female_ASF.png'),
        },
        WC: {
            MALE: p('/assets/img/Jonathan_Male_WC.png'),
            FEMALE: p('/assets/img/Emily_Female_WC.png'),
        },
    },
    pets: {
        CYBER_DOG: p('/assets/img/Dog_Pet.png'),
        CYBER_CAT: p('/assets/img/Cat_Pet.png'),
    },
};
export function getCharacterPortrait(faction, archetype) {
    return ImageAssets.characters[faction][archetype];
}
