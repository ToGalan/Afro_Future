import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
const BRANCHES = [
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
function branchColor(t) {
    if (t === 'spell')
        return '#60a5fa';
    if (t === 'buff')
        return '#34d399';
    if (t === 'stat')
        return '#f472b6';
    if (t === 'ability')
        return '#fbbf24';
    if (t === 'weapon')
        return '#a78bfa';
    if (t === 'trade')
        return '#fb923c';
    if (t === 'zone')
        return '#f87171';
    return '#9ca3af';
}
function makeTree() {
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
function layoutSnowflake(nodes, size) {
    const cx = size / 2;
    const cy = size / 2;
    const maxTier = Math.max(...nodes.map(n => n.tier));
    const perBranchAngle = (2 * Math.PI) / BRANCHES.length;
    const radiusStep = (size * 0.5) / Math.max(1, maxTier);
    return nodes.map(n => {
        if (n.id === 'root')
            return { ...n, x: cx, y: cy };
        const branchAngle = n.branch >= 0 ? n.branch * perBranchAngle : 0;
        const jitter = n.id.includes('_core') ? 0 : ((parseInt(n.id.replace(/\D/g, '')) % 7) - 3) * (Math.PI / 180) * 5;
        const angle = branchAngle + jitter;
        const r = radiusStep * n.tier + (n.id.includes('_core') ? 0 : 20);
        return { ...n, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });
}
function deriveTraits(unlocked, nodes) {
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
export default function SnowflakeSkillTree({ initialLevel = 1, onClose }) {
    const [unlocked, setUnlocked] = useState(['root']);
    const [spent, setSpent] = useState(0);
    const [scale, setScale] = useState(0.9);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const [lastPt, setLastPt] = useState(null);
    const [level, setLevel] = useState(initialLevel);
    const nodes = useMemo(() => makeTree(), []);
    const size = 1200;
    const laid = useMemo(() => layoutSnowflake(nodes, size), [nodes]);
    function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
    function canUnlock(id) { const node = nodes.find(n => n.id === id); if (!node)
        return false; if (unlocked.includes(id))
        return false; if (!node.requires || node.requires.length === 0)
        return true; return node.requires.every(r => unlocked.includes(r)); }
    function onUnlock(id) { if (!canUnlock(id))
        return; const basePoints = 12; const bonusPoints = Math.floor((Math.max(1, level) - 1) / 5) * 3; const available = basePoints + bonusPoints - spent; if (available <= 0)
        return; setUnlocked(u => [...u, id]); setSpent(s => s + 1); }
    function onWheel(e) { e.preventDefault(); setScale(s => clamp(s - e.deltaY * 0.0015, 0.6, 2.5)); }
    function onPointerDown(e) { if (scale <= 1.02)
        return; setDragging(true); setLastPt({ x: e.clientX, y: e.clientY }); try {
        e.currentTarget.setPointerCapture(e.pointerId);
    }
    catch { } }
    function onPointerMove(e) { if (!dragging || !lastPt || scale <= 1.02)
        return; const dx = e.clientX - lastPt.x; const dy = e.clientY - lastPt.y; setPan(p => ({ x: p.x + dx, y: p.y + dy })); setLastPt({ x: e.clientX, y: e.clientY }); }
    function onPointerUp(e) { setDragging(false); setLastPt(null); try {
        e.currentTarget.releasePointerCapture(e.pointerId);
    }
    catch { } }
    function links() { const arr = []; laid.forEach(n => { if (!n.requires)
        return; n.requires.forEach(r => { const from = laid.find(x => x.id === r); if (from)
        arr.push({ from, to: n, faction: n.faction, counters: n.counters }); }); }); return arr; }
    const traits = deriveTraits(unlocked, nodes);
    const showDetail = scale >= 1.05;
    const basePoints = 12;
    const bonusPoints = Math.floor((Math.max(1, level) - 1) / 5) * 3;
    const pointsLeft = basePoints + bonusPoints - spent;
    return (_jsxs("div", { className: "w-full h-full bg-[#0f1218] text-gray-100 p-4 overflow-hidden relative", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsx("div", { className: "text-xl font-semibold", children: "Skill Snowflake" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { className: "px-3 py-1 rounded bg-white/10 border border-white/10 text-sm", onClick: onClose, children: "Back" }), _jsx("button", { className: "px-2 py-1 rounded bg-white/10 border border-white/10", onClick: () => setScale(s => clamp(s * 0.9, 0.6, 2.5)), children: "\u2212" }), _jsxs("div", { className: "w-16 text-center text-sm opacity-80", children: [Math.round(scale * 100), "%"] }), _jsx("button", { className: "px-2 py-1 rounded bg-white/10 border border-white/10", onClick: () => setScale(s => clamp(s * 1.1, 0.6, 2.5)), children: "+" }), _jsx("div", { className: "text-sm opacity-80 ml-2", children: "Lvl" }), _jsx("button", { className: "px-2 rounded bg-white/10 border border-white/10", onClick: () => setLevel(l => Math.max(1, l - 1)), children: "\u2212" }), _jsx("div", { className: "w-8 text-center text-sm opacity-80", children: level }), _jsx("button", { className: "px-2 rounded bg-white/10 border border-white/10", onClick: () => setLevel(l => l + 1), children: "+" }), _jsxs("div", { className: "text-sm opacity-80 ml-4", children: ["Spent: ", spent, " \u2022 Points Left: ", pointsLeft] })] })] }), _jsxs("div", { className: "grid grid-cols-12 gap-4", children: [_jsx("div", { className: "col-span-9", children: _jsx("div", { className: "relative mx-auto select-none", style: { width: size, height: size }, onWheel: onWheel, children: _jsxs("svg", { width: size, height: size, onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, style: { cursor: dragging ? 'grabbing' : scale > 1.02 ? 'grab' : 'default' }, children: [_jsx("defs", { children: _jsxs("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%", children: [_jsx("feGaussianBlur", { stdDeviation: "3", result: "colored" }), _jsxs("feMerge", { children: [_jsx("feMergeNode", { in: "colored" }), _jsx("feMergeNode", { in: "SourceGraphic" })] })] }) }), _jsxs("g", { transform: `translate(${size / 2 + pan.x},${size / 2 + pan.y}) scale(${scale}) translate(${-size / 2},${-size / 2})`, children: [links().map((l, i) => (_jsx("line", { x1: l.from.x, y1: l.from.y, x2: l.to.x, y2: l.to.y, stroke: unlocked.includes(l.to.id) ? branchColor(l.to.type) : '#6b7280', strokeWidth: 2 }, i))), laid.map(n => {
                                                const color = branchColor(n.type);
                                                const isUnlocked = unlocked.includes(n.id);
                                                const r = n.id === 'root' ? 22 : n.tier === 1 ? 14 : 11;
                                                return (_jsxs("g", { transform: `translate(${n.x},${n.y})`, children: [_jsx("circle", { r: r + 5, fill: "#0b1220", stroke: "#1f2937", strokeWidth: 2 }), _jsx("circle", { r: r, fill: isUnlocked ? color : '#111827', stroke: isUnlocked ? color : '#374151', strokeWidth: isUnlocked ? 3 : 2, filter: isUnlocked ? 'url(#glow)' : undefined, onClick: () => onUnlock(n.id), style: { cursor: canUnlock(n.id) ? 'pointer' : 'not-allowed' } }), showDetail ? (_jsxs(_Fragment, { children: [_jsx("text", { y: -r - 8, textAnchor: "middle", fontSize: 11, fill: "#e5e7eb", children: n.label }), n.faction && _jsx("text", { y: r + 12, textAnchor: "middle", fontSize: 9, fill: "#9ca3af", children: n.faction })] })) : (_jsx("text", { y: 4, textAnchor: "middle", fontSize: 8, fill: "#cbd5e1", children: n.tier }))] }, n.id));
                                            }), BRANCHES.map((b, i) => {
                                                const angle = (2 * Math.PI * i) / BRANCHES.length;
                                                const x = size / 2 + Math.cos(angle) * (size * 0.46);
                                                const y = size / 2 + Math.sin(angle) * (size * 0.46);
                                                return (_jsx("g", { transform: `translate(${x},${y})`, children: _jsx("text", { textAnchor: "middle", fontSize: showDetail ? 12 : 14, fill: "#9ca3af", children: b.name }) }, b.id));
                                            })] })] }) }) }), _jsxs("div", { className: "col-span-3", children: [_jsxs("div", { className: "rounded-2xl p-4 bg-white/5 border border-white/10", children: [_jsx("div", { className: "text-lg font-semibold", children: "Traits" }), _jsxs("div", { className: "mt-2 text-sm", children: ["Primary Path: ", _jsx("span", { className: "opacity-80", children: traits.topBranch ?? '—' })] }), _jsxs("div", { className: "text-sm", children: ["Primary Type: ", _jsx("span", { className: "opacity-80", children: traits.topType ?? '—' })] }), _jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: traits.tags.length ? traits.tags.map(t => (_jsx("span", { className: "px-2 py-1 rounded bg-white/10 border border-white/10 text-xs", children: t }, t))) : _jsx("span", { className: "opacity-70 text-xs", children: "Unlock nodes to reveal traits" }) }), _jsx("div", { className: "mt-4 text-xs opacity-70", children: "Choosing different branches creates unique player traits. Zoom out for snowflake view; zoom in to drag and inspect details." })] }), _jsxs("div", { className: "mt-3 grid grid-cols-2 gap-2 text-xs", children: [_jsx(LegendItem, { color: branchColor('spell'), label: "Spell" }), _jsx(LegendItem, { color: branchColor('buff'), label: "Buff" }), _jsx(LegendItem, { color: branchColor('stat'), label: "Stat" }), _jsx(LegendItem, { color: branchColor('ability'), label: "Ability" }), _jsx(LegendItem, { color: branchColor('weapon'), label: "Weapon" }), _jsx(LegendItem, { color: branchColor('trade'), label: "Trade" }), _jsx(LegendItem, { color: branchColor('zone'), label: "Zone Control" })] })] })] })] }));
}
function LegendItem({ color, label }) {
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block w-3 h-3 rounded-full", style: { backgroundColor: color } }), _jsx("span", { children: label })] }));
}
