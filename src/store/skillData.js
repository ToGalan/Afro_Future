export const BRANCHES = [
    { id: 0, name: 'Combat', type: 'stat' },
    { id: 1, name: 'Support', type: 'buff' },
    { id: 2, name: 'Pet Bond', type: 'ability' },
    { id: 3, name: 'Weapons', type: 'weapon' },
    { id: 4, name: 'Spellcraft', type: 'spell' },
    { id: 5, name: 'Defense', type: 'buff' },
    { id: 6, name: 'Mobility', type: 'ability' },
    { id: 7, name: 'Leadership', type: 'zone' },
    { id: 8, name: 'Terraform', type: 'ability' },
    { id: 9, name: 'Technologist', type: 'ability' },
    { id: 10, name: 'Merchant', type: 'trade' },
    { id: 11, name: 'Looting', type: 'ability' },
];
export function makeTree() {
    const nodes = [];
    nodes.push({ id: 'root', label: 'Origin', description: 'Common root', type: 'root', tier: 0, branch: -1 });
    BRANCHES.forEach(b => {
        const baseId = b.name.toLowerCase().replace(/\s+/g, '');
        nodes.push({ id: `${baseId}_core`, label: `${b.name} Core`, description: `${b.name} fundamentals`, type: b.type, tier: 1, branch: b.id, requires: ['root'] });
        for (let i = 0; i < 8; i++) {
            const t = 2 + Math.floor(i / 3);
            const id = `${baseId}_${i + 1}`;
            const req = i < 3 ? [`${baseId}_core`] : [`${baseId}_${i - 2}`];
            const label = `${b.name} Skill ${i + 1}`;
            nodes.push({
                id,
                label,
                description: `${b.name} skill ${i + 1}`,
                type: b.type,
                tier: t,
                branch: b.id,
                requires: req,
                faction: b.id % 3 === 0 ? 'PAA' : b.id % 3 === 1 ? 'ASF' : 'WC',
                counters: i % 2 === 0 ? ['combat_core'] : ['support_core']
            });
        }
    });
    return nodes;
}
export function deriveTraits(unlocked, nodes) {
    const byBranch = {};
    const byType = {};
    unlocked.forEach(id => { const n = nodes.find(x => x.id === id); if (!n)
        return; const b = BRANCHES.find(br => br.id === n.branch)?.name || 'root'; byBranch[b] = (byBranch[b] || 0) + 1; byType[n.type] = (byType[n.type] || 0) + 1; });
    const topBranch = Object.entries(byBranch).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]?.[0];
    const tags = [];
    if ((byBranch['Leadership'] || 0) >= 4)
        tags.push('Commander');
    if ((byBranch['Terraform'] || 0) >= 4)
        tags.push('Terraformer');
    if ((byBranch['Technologist'] || 0) >= 4)
        tags.push('Technocrat');
    if ((byBranch['Merchant'] || 0) >= 4)
        tags.push('Trader');
    if ((byBranch['Looting'] || 0) >= 4)
        tags.push('Raider');
    if ((byBranch['Combat'] || 0) >= 4)
        tags.push('Aggressor');
    if ((byBranch['Support'] || 0) >= 4)
        tags.push('Support Specialist');
    if ((byBranch['Mobility'] || 0) >= 4)
        tags.push('Skirmisher');
    return { topBranch, topType, tags };
}
