// Centralized asset path mappings. Public assets are served from /assets/*.
// Keeping as constants ensures refactors are localized here.
// Updated to use higher fidelity PNG faction icons bundled locally
export const FactionIcon = {
    PAA: new URL('./img/PAA_Icon.png', import.meta.url).href,
    ASF: new URL('./img/ASF_Icon.png', import.meta.url).href,
    WC: new URL('./img/WC_icon.png', import.meta.url).href,
};
export const CharacterPortrait = {
    MALE: '/assets/characters/male_default.svg',
    FEMALE: '/assets/characters/female_default.svg',
};
export const PetIcon = {
    CYBER_DOG: new URL('./img/Dog_Pet.png', import.meta.url).href,
    CYBER_CAT: new URL('./img/Cat_Pet.png', import.meta.url).href,
};
export const fallbackPortrait = '/assets/characters/male_default.svg';
// Raw image assets (PNG) placed under src/assets/img (bundled by Vite). Using import.meta.url style absolute paths not needed;
// we reference via relative path from src since Vite handles them. Centralizing for consistency.
// Naming: <Name>_<Gender?>_<Faction?>.png etc.
export const ImageAssets = {
    faction: {
        PAA: new URL('./img/PAA_Icon.png', import.meta.url).href,
        ASF: new URL('./img/ASF_Icon.png', import.meta.url).href,
        WC: new URL('./img/WC_icon.png', import.meta.url).href,
    },
    characters: {
        // Faction-specific exemplars
        PAA: {
            MALE: new URL('./img/Kwame_Male_PAA.png', import.meta.url).href,
            FEMALE: new URL('./img/Makena_Female_PAA.png', import.meta.url).href,
        },
        ASF: {
            MALE: new URL('./img/Zuberi_Male_ASF.png', import.meta.url).href,
            FEMALE: new URL('./img/Nia_Female_ASF.png', import.meta.url).href,
        },
        WC: {
            MALE: new URL('./img/Jonathan_Male_WC.png', import.meta.url).href,
            FEMALE: new URL('./img/Emily_Female_WC.png', import.meta.url).href,
        },
    },
    pets: {
        CYBER_DOG: new URL('./img/Dog_Pet.png', import.meta.url).href,
        CYBER_CAT: new URL('./img/Cat_Pet.png', import.meta.url).href,
    },
};
export function getCharacterPortrait(faction, archetype) {
    return ImageAssets.characters[faction][archetype];
}
