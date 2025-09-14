import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useMemo, useState } from 'react';
import { useSkillStore, availablePoints } from '../store/skillStore';
import { BRANCHES, makeTree, deriveTraits } from '../store/skillData';
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
export default function SnowflakeSkillTree({ initialLevel = 1, onClose }) {
    const unlocked = useSkillStore(s => s.unlocked);
    const spent = useSkillStore(s => s.spent);
    const level = useSkillStore(s => s.level);
    const unlockGlobal = useSkillStore(s => s.unlock);
    const setLevelGlobal = useSkillStore(s => s.setLevel);
    const [scale, setScale] = useState(1.0);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [dragging, setDragging] = useState(false);
    const [lastPt, setLastPt] = useState(null);
    // initialize global level once if different
    React.useEffect(() => { if (level !== initialLevel)
        setLevelGlobal(initialLevel); }, [initialLevel, level, setLevelGlobal]);
    const nodes = useMemo(() => makeTree(), []);
    const size = 1200;
    const laid = useMemo(() => layoutSnowflake(nodes, size), [nodes]);
    function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
    function canUnlock(id) { const node = nodes.find(n => n.id === id); if (!node)
        return false; if (unlocked.includes(id))
        return false; if (!node.requires || node.requires.length === 0)
        return true; return node.requires.every(r => unlocked.includes(r)); }
    function onUnlock(id) { if (!canUnlock(id))
        return; const st = useSkillStore.getState(); const avail = availablePoints(st); if (avail <= 0)
        return; unlockGlobal(id); }
    function onWheel(e) { e.preventDefault(); setScale(s => clamp(s - e.deltaY * 0.0015, 1.0, 2.5)); }
    function onPointerDown(e) { if (scale <= 1.0)
        return; setDragging(true); setLastPt({ x: e.clientX, y: e.clientY }); try {
        e.currentTarget.setPointerCapture(e.pointerId);
    }
    catch { } }
    function onPointerMove(e) { if (!dragging || !lastPt || scale <= 1.0)
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
    const pointsLeft = availablePoints(useSkillStore.getState());
    return (_jsxs("div", { className: "w-full h-full bg-[#0f1218] text-gray-100 p-4 overflow-hidden relative", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "text-xl font-semibold", children: "Skill Snowflake" }), _jsx("div", { className: "text-sm px-2 py-1 rounded bg-white/5 border border-white/10", children: "Zoom Locked \u2265 100%" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { className: "px-2 py-1 rounded bg-white/10 border border-white/10 disabled:opacity-40", disabled: scale <= 1.0, onClick: () => setScale(s => clamp(s * 0.9, 1.0, 2.5)), children: "\u2212" }), _jsxs("div", { className: "w-16 text-center text-sm opacity-80", children: [Math.round(scale * 100), "%"] }), _jsx("button", { className: "px-2 py-1 rounded bg-white/10 border border-white/10", onClick: () => setScale(s => clamp(s * 1.1, 1.0, 2.5)), children: "+" }), _jsx("div", { className: "text-sm opacity-80 ml-2", children: "Lvl" }), _jsx("button", { className: "px-2 rounded bg-white/10 border border-white/10", onClick: () => setLevelGlobal(Math.max(1, level - 1)), children: "\u2212" }), _jsx("div", { className: "w-8 text-center text-sm opacity-80", children: level }), _jsx("button", { className: "px-2 rounded bg-white/10 border border-white/10", onClick: () => setLevelGlobal(level + 1), children: "+" }), _jsxs("div", { className: "text-sm opacity-80 ml-4", children: ["Spent: ", spent, " \u2022 Points Left: ", pointsLeft] })] })] }), _jsxs("div", { className: "grid grid-cols-12 gap-4", children: [_jsx("div", { className: "col-span-9", children: _jsx("div", { className: "relative mx-auto select-none", style: { width: size, height: size }, onWheel: onWheel, children: _jsxs("svg", { width: size, height: size, onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, style: { cursor: dragging ? 'grabbing' : scale > 1.02 ? 'grab' : 'default' }, children: [_jsx("defs", { children: _jsxs("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%", children: [_jsx("feGaussianBlur", { stdDeviation: "3", result: "colored" }), _jsxs("feMerge", { children: [_jsx("feMergeNode", { in: "colored" }), _jsx("feMergeNode", { in: "SourceGraphic" })] })] }) }), _jsxs("g", { transform: `translate(${size / 2 + pan.x},${size / 2 + pan.y}) scale(${scale}) translate(${-size / 2},${-size / 2})`, children: [links().map((l, i) => (_jsx("line", { x1: l.from.x, y1: l.from.y, x2: l.to.x, y2: l.to.y, stroke: unlocked.includes(l.to.id) ? branchColor(l.to.type) : '#6b7280', strokeWidth: 2 }, i))), laid.map(n => {
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
