import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useMemo, useState, useEffect, useRef } from 'react';
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
    const attackStat = useSkillStore(s => s.attack);
    const defenseStat = useSkillStore(s => s.defense);
    const utilityStat = useSkillStore(s => s.utility);
    const traitTags = useSkillStore(s => s.traitTags);
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
    function unlockReason(id) { const node = nodes.find(n => n.id === id); if (!node)
        return 'Missing node'; if (unlocked.includes(id))
        return 'Already unlocked'; if (node.requires && node.requires.some(r => !unlocked.includes(r)))
        return 'Missing prereq'; const st = useSkillStore.getState(); const avail = availablePoints(st); if (avail <= 0)
        return 'No points'; return 'Unlockable'; }
    function onWheel(e) { e.preventDefault(); setScale(s => clamp(s - e.deltaY * 0.0015, 1.0, 2.5)); }
    // Track if movement exceeded a small threshold to differentiate drag vs click
    const dragThreshold = 5;
    function onPointerDown(e) { if (scale <= 1.0)
        return; setDragging(true); setLastPt({ x: e.clientX, y: e.clientY }); try {
        e.currentTarget.setPointerCapture(e.pointerId);
    }
    catch { } }
    function onPointerMove(e) { if (!dragging || !lastPt || scale <= 1.0)
        return; const dx = e.clientX - lastPt.x; const dy = e.clientY - lastPt.y; if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    } setLastPt({ x: e.clientX, y: e.clientY }); }
    function onPointerUp(e) { setDragging(false); setLastPt(null); try {
        e.currentTarget.releasePointerCapture(e.pointerId);
    }
    catch { } }
    function links() { const arr = []; laid.forEach(n => { if (!n.requires)
        return; n.requires.forEach(r => { const from = laid.find(x => x.id === r); if (from)
        arr.push({ from, to: n, faction: n.faction, counters: n.counters }); }); }); return arr; }
    const traits = deriveTraits(unlocked, nodes);
    const [hoverId, setHoverId] = useState(null);
    const [lastUnlocked, setLastUnlocked] = useState(null);
    function onUnlock(id) {
        const reason = unlockReason(id);
        const st = useSkillStore.getState();
        const avail = availablePoints(st);
        const nodeName = nodes.find(n => n.id === id)?.label || id;
        console.log('[UNLOCK ATTEMPT]', {
            nodeId: id,
            nodeName,
            reason,
            availablePoints: avail,
            currentSpent: st.spent,
            currentUnlocked: st.unlocked.length
        });
        if (reason !== 'Unlockable') {
            console.warn('[UNLOCK FAILED]', { nodeId: id, reason });
            return;
        }
        // Execute unlock
        unlockGlobal(id);
        setLastUnlocked(id);
        // Echo success with updated state
        const updatedState = useSkillStore.getState();
        console.log('[UNLOCK SUCCESS]', {
            nodeId: id,
            nodeName,
            tokenSpent: true,
            newSpentCount: updatedState.spent,
            newAvailablePoints: availablePoints(updatedState),
            totalUnlocked: updatedState.unlocked.length,
            newTraits: updatedState.traitTags
        });
    }
    // Hold-to-unlock state
    const HOLD_DURATION = 4000; // ms
    const [holdTarget, setHoldTarget] = useState(null);
    const [holdProgress, setHoldProgress] = useState(0); // 0..1
    const holdingRef = useRef(false);
    const rafRef = useRef(null);
    const holdStartRef = useRef(null);
    // Determine which branch cores are next unlockable (tier1 core nodes that are locked but requirements satisfied)
    const nextCores = useMemo(() => {
        return laid.filter(n => n.id.endsWith('_core') && !unlocked.includes(n.id) && canUnlock(n.id)).map(n => n.id);
    }, [laid, unlocked]);
    // Compute projected stats / traits when hovering an unlockable node
    const hoverProjection = useMemo(() => {
        if (!hoverId)
            return null;
        if (!canUnlock(hoverId))
            return null;
        const st = useSkillStore.getState();
        const nextUnlocked = [...st.unlocked, hoverId];
        // derive stats like in store
        let attack = 0, defense = 0, utility = 0;
        nextUnlocked.forEach(id => { if (id.includes('combat') || id.includes('weapon'))
            attack += 2; if (id.includes('defense') || id.includes('shield'))
            defense += 2; if (id.includes('support') || id.includes('leadership') || id.includes('mobility'))
            utility += 2; if (id.includes('terraform') || id.includes('technologist'))
            utility += 1; });
        const traitProj = deriveTraits(nextUnlocked, nodes);
        return { attack, defense, utility, traitProj };
    }, [hoverId, nodes, canUnlock]);
    const showDetail = scale >= 1.05;
    // reactive points left
    const basePoints = useSkillStore(s => s.basePoints);
    const lvl = useSkillStore(s => s.level);
    const ptsLeft = useMemo(() => availablePoints(useSkillStore.getState()), [unlocked, basePoints, lvl, spent]);
    // Reset hold if conditions change
    useEffect(() => {
        if (!hoverId || (holdTarget && hoverId !== holdTarget)) {
            // if moved away from target
            holdingRef.current = false;
            holdStartRef.current = null;
            setHoldTarget(null);
            setHoldProgress(0);
            if (rafRef.current)
                cancelAnimationFrame(rafRef.current);
        }
        if (hoverId && !unlocked.includes(hoverId) && unlockReason(hoverId) !== 'Unlockable') {
            holdingRef.current = false;
            holdStartRef.current = null;
            setHoldTarget(null);
            setHoldProgress(0);
            if (rafRef.current)
                cancelAnimationFrame(rafRef.current);
        }
    }, [hoverId, holdTarget]); // Removed unlocked and ptsLeft to prevent premature resets
    // Key handling for hold-to-unlock
    useEffect(() => {
        function step() {
            if (!holdingRef.current || !holdStartRef.current || !holdTarget) {
                return;
            }
            const elapsed = performance.now() - holdStartRef.current;
            const prog = Math.min(1, elapsed / HOLD_DURATION);
            setHoldProgress(prog);
            console.log('[HOLD PROGRESS]', {
                elapsed: elapsed.toFixed(0),
                progress: (prog * 100).toFixed(1) + '%',
                target: holdTarget
            });
            if (prog >= 1) {
                console.log('[HOLD COMPLETE] Triggering unlock for', holdTarget);
                // Reset hold state first to prevent interference
                holdingRef.current = false;
                holdStartRef.current = null;
                setHoldProgress(0);
                const targetToUnlock = holdTarget;
                setHoldTarget(null);
                // Then trigger unlock
                onUnlock(targetToUnlock);
                return;
            }
            rafRef.current = requestAnimationFrame(step);
        }
        function keyDown(e) {
            if (e.key.toLowerCase() === 'u') {
                console.log('[KEY DOWN] U pressed, hoverId:', hoverId);
                if (!hoverId) {
                    console.log('[KEY DOWN] No hover target');
                    return;
                }
                const reason = unlockReason(hoverId);
                console.log('[KEY DOWN] Unlock reason:', reason);
                if (reason !== 'Unlockable') {
                    console.log('[KEY DOWN] Cannot unlock:', reason);
                    return;
                }
                if (!holdingRef.current) {
                    console.log('[KEY DOWN] Starting hold for', hoverId);
                    holdingRef.current = true;
                    holdStartRef.current = performance.now();
                    setHoldTarget(hoverId);
                    setHoldProgress(0);
                    rafRef.current = requestAnimationFrame(step);
                }
            }
        }
        function keyUp(e) {
            if (e.key.toLowerCase() === 'u') {
                console.log('[KEY UP] U released, resetting hold');
                holdingRef.current = false;
                holdStartRef.current = null;
                setHoldTarget(null);
                setHoldProgress(0);
                if (rafRef.current)
                    cancelAnimationFrame(rafRef.current);
            }
        }
        window.addEventListener('keydown', keyDown);
        window.addEventListener('keyup', keyUp);
        return () => {
            window.removeEventListener('keydown', keyDown);
            window.removeEventListener('keyup', keyUp);
            if (rafRef.current)
                cancelAnimationFrame(rafRef.current);
        };
    }, [hoverId]);
    return (_jsxs("div", { className: "w-full h-full bg-[#0f1218] text-gray-100 p-4 overflow-hidden relative", children: [_jsxs("div", { className: "absolute top-2 right-2 bg-black/70 border border-emerald-500/30 rounded-lg px-3 py-2 text-[10px] leading-tight space-y-1 pointer-events-none z-40 backdrop-blur-sm", children: [_jsx("div", { className: "font-semibold text-emerald-300", children: "Token Tracker" }), _jsxs("div", { className: "text-emerald-200", children: ["Last Unlocked: ", _jsx("span", { className: "font-mono", children: lastUnlocked ?? '—' })] }), _jsxs("div", { className: "text-yellow-300", children: ["Tokens Spent: ", _jsx("span", { className: "font-mono font-bold", children: spent })] }), _jsxs("div", { className: "text-blue-300", children: ["Available: ", _jsx("span", { className: "font-mono font-bold", children: availablePoints(useSkillStore.getState()) })] }), _jsxs("div", { className: "text-gray-300", children: ["Total Unlocked: ", _jsx("span", { className: "font-mono", children: unlocked.length })] }), _jsxs("div", { className: "text-purple-300", children: ["Stats: ", attackStat, "/", defenseStat, "/", utilityStat] }), _jsx("div", { className: "flex flex-wrap gap-1 max-w-[160px]", children: traitTags.slice(0, 4).map(t => _jsx("span", { className: "px-1 py-0.5 bg-emerald-600/20 border border-emerald-500/40 rounded text-emerald-200", children: t }, t)) }), holdTarget && (_jsxs("div", { className: "text-amber-300", children: ["Unlocking: ", laid.find(n => n.id === holdTarget)?.label] }))] }), _jsx("div", { className: "flex items-center justify-between mb-3", children: _jsx("div", { className: "text-xl font-semibold", children: "Skill Snowflake" }) }), _jsxs("div", { className: "grid grid-cols-12 gap-4", children: [_jsx("div", { className: "col-span-9", children: _jsxs("div", { className: "relative mx-auto select-none", style: { width: size, height: size }, onWheel: onWheel, children: [_jsxs("svg", { width: size, height: size, onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp, style: { cursor: dragging ? 'grabbing' : scale > 1.02 ? 'grab' : 'default' }, children: [_jsx("defs", { children: _jsxs("filter", { id: "glow", x: "-50%", y: "-50%", width: "200%", height: "200%", children: [_jsx("feGaussianBlur", { stdDeviation: "3", result: "colored" }), _jsxs("feMerge", { children: [_jsx("feMergeNode", { in: "colored" }), _jsx("feMergeNode", { in: "SourceGraphic" })] })] }) }), _jsxs("g", { transform: `translate(${size / 2 + pan.x},${size / 2 + pan.y}) scale(${scale}) translate(${-size / 2},${-size / 2})`, children: [links().map((l, i) => (_jsx("line", { x1: l.from.x, y1: l.from.y, x2: l.to.x, y2: l.to.y, stroke: unlocked.includes(l.to.id) ? branchColor(l.to.type) : '#6b7280', strokeWidth: 2 }, i))), laid.map(n => {
                                                    const color = branchColor(n.type);
                                                    const isUnlocked = unlocked.includes(n.id);
                                                    const r = n.id === 'root' ? 22 : n.tier === 1 ? 14 : 11;
                                                    const isCoreHighlight = nextCores.includes(n.id);
                                                    const isHoldingThis = holdTarget === n.id && holdingRef.current;
                                                    const isHovered = hoverId === n.id;
                                                    return (_jsxs("g", { "data-id": n.id, transform: `translate(${n.x},${n.y})`, onMouseEnter: () => setHoverId(n.id), onMouseLeave: () => setHoverId(h => h === n.id ? null : h), style: { pointerEvents: 'all' }, children: [_jsx("circle", { r: r + 5, fill: "#0b1220", stroke: "#1f2937", strokeWidth: 2 }), _jsx("circle", { r: r, fill: isUnlocked ? color : '#111827', stroke: isUnlocked ? color : '#374151', strokeWidth: isUnlocked ? 3 : 2, filter: isUnlocked ? 'url(#glow)' : undefined, style: { cursor: canUnlock(n.id) ? 'pointer' : 'not-allowed' } }), (!isUnlocked && isHoldingThis && holdProgress > 0) && (() => {
                                                                const pr = holdProgress;
                                                                const rr = r + 6;
                                                                const circ = 2 * Math.PI * rr;
                                                                return (_jsx("circle", { r: rr, fill: "none", stroke: "#10b981", strokeWidth: 4, strokeLinecap: "round", strokeDasharray: circ, strokeDashoffset: circ - circ * pr, style: { transition: 'stroke-dashoffset 0.1s linear' } }));
                                                            })(), _jsx("circle", { r: r + 10, fill: "transparent", stroke: "none", style: { cursor: canUnlock(n.id) ? 'pointer' : 'not-allowed' } }), isCoreHighlight && !isUnlocked && (_jsx("circle", { r: r + 6, fill: "none", stroke: "rgba(16,185,129,0.55)", strokeWidth: 2, strokeDasharray: "4 4" })), showDetail ? (_jsxs(_Fragment, { children: [_jsx("text", { y: -r - 8, textAnchor: "middle", fontSize: 11, fill: "#e5e7eb", children: n.label }), n.faction && _jsx("text", { y: r + 12, textAnchor: "middle", fontSize: 9, fill: "#9ca3af", children: n.faction })] })) : (_jsx("text", { y: 4, textAnchor: "middle", fontSize: 8, fill: "#cbd5e1", children: n.tier }))] }, n.id));
                                                }), BRANCHES.map((b, i) => {
                                                    const angle = (2 * Math.PI * i) / BRANCHES.length;
                                                    const x = size / 2 + Math.cos(angle) * (size * 0.46);
                                                    const y = size / 2 + Math.sin(angle) * (size * 0.46);
                                                    return (_jsx("g", { transform: `translate(${x},${y})`, children: _jsx("text", { textAnchor: "middle", fontSize: showDetail ? 12 : 14, fill: "#9ca3af", children: b.name }) }, b.id));
                                                })] })] }), hoverProjection && hoverId && (_jsxs("div", { className: "absolute top-2 left-2 w-64 rounded-xl border border-emerald-400/30 bg-[#0f1218]/95 backdrop-blur p-3 text-xs shadow-xl pointer-events-auto", children: [_jsxs("div", { className: "font-semibold text-emerald-300 mb-1 truncate", children: ["Preview: ", laid.find(n => n.id === hoverId)?.label] }), _jsxs("div", { className: "grid grid-cols-3 gap-2 mb-2", children: [_jsxs("div", { className: "flex flex-col items-start", children: [_jsx("span", { className: "opacity-60", children: "Atk" }), _jsx("span", { className: "font-semibold text-emerald-200", children: hoverProjection.attack })] }), _jsxs("div", { className: "flex flex-col items-start", children: [_jsx("span", { className: "opacity-60", children: "Def" }), _jsx("span", { className: "font-semibold text-emerald-200", children: hoverProjection.defense })] }), _jsxs("div", { className: "flex flex-col items-start", children: [_jsx("span", { className: "opacity-60", children: "Util" }), _jsx("span", { className: "font-semibold text-emerald-200", children: hoverProjection.utility })] })] }), _jsx("div", { className: "flex flex-wrap gap-1 mb-2", children: hoverProjection.traitProj.tags.length ? hoverProjection.traitProj.tags.map(t => _jsx("span", { className: "px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-[10px]", children: t }, t)) : _jsx("span", { className: "opacity-50", children: "No new trait" }) }), _jsx("div", { className: "opacity-60 leading-snug line-clamp-3 mb-2", children: laid.find(n => n.id === hoverId)?.description }), unlockReason(hoverId) === 'Unlockable' && !unlocked.includes(hoverId) && (_jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "text-emerald-300 font-semibold", children: "Hold key 'U' to Unlock" }), _jsx("span", { className: "opacity-70", children: holdTarget === hoverId ? `${((HOLD_DURATION / 1000) * (1 - holdProgress)).toFixed(1)}s remaining` : `${(HOLD_DURATION / 1000).toFixed(1)}s required` }), _jsx("div", { className: "h-2 w-full bg-white/10 rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-emerald-500 transition-all duration-100 ease-linear", style: {
                                                                    width: `${(holdProgress * 100).toFixed(1)}%`,
                                                                    backgroundColor: holdProgress > 0.8 ? '#22c55e' : '#10b981'
                                                                } }) }), _jsxs("span", { className: "opacity-60 text-[10px]", children: ["Points after unlock: ", ptsLeft - 1 >= 0 ? ptsLeft - 1 : 0] })] }), _jsxs("div", { className: "relative w-12 h-12 flex items-center justify-center", children: [_jsx("svg", { width: 48, height: 48, className: "block", children: (() => {
                                                                const r = 18;
                                                                const c = 2 * Math.PI * r;
                                                                const isActive = holdTarget === hoverId && holdProgress > 0;
                                                                return (_jsxs("g", { transform: "translate(24,24)", children: [_jsx("circle", { r: r, fill: "#111827", stroke: "#374151", strokeWidth: 3 }), _jsx("circle", { r: r, fill: "none", stroke: isActive ? "#10b981" : "#374151", strokeWidth: 3, strokeLinecap: "round", strokeDasharray: c, strokeDashoffset: c - c * holdProgress, style: {
                                                                                transition: isActive ? 'stroke-dashoffset 0.1s linear, stroke 0.2s ease' : 'stroke-dashoffset 0.25s ease, stroke 0.2s ease',
                                                                                transform: 'rotate(-90deg)',
                                                                                transformOrigin: 'center'
                                                                            } }), isActive && (_jsx("circle", { r: r + 2, fill: "none", stroke: "#10b981", strokeWidth: 1, opacity: 0.5 }))] }));
                                                            })() }), _jsx("span", { className: `absolute text-sm font-bold tracking-wide transition-colors duration-200 ${holdTarget === hoverId && holdProgress > 0 ? 'text-emerald-300' : 'text-gray-300'}`, children: "U" })] })] })), unlockReason(hoverId) !== 'Unlockable' && (_jsx("div", { className: "opacity-60", children: unlockReason(hoverId) }))] }))] }) }), _jsxs("div", { className: "col-span-3", children: [_jsxs("div", { className: "rounded-2xl p-4 bg-white/5 border border-white/10", children: [_jsx("div", { className: "text-lg font-semibold", children: "Traits" }), _jsxs("div", { className: "mt-2 text-sm", children: ["Primary Path: ", _jsx("span", { className: "opacity-80", children: traits.topBranch ?? '—' })] }), _jsxs("div", { className: "text-sm", children: ["Primary Type: ", _jsx("span", { className: "opacity-80", children: traits.topType ?? '—' })] }), _jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: traits.tags.length ? traits.tags.map(t => (_jsx("span", { className: "px-2 py-1 rounded bg-white/10 border border-white/10 text-xs", children: t }, t))) : _jsx("span", { className: "opacity-70 text-xs", children: "Unlock nodes to reveal traits" }) }), _jsx("div", { className: "mt-4 text-xs opacity-70", children: "Choosing different branches creates unique player traits. Zoom out for snowflake view; zoom in to drag and inspect details." })] }), _jsxs("div", { className: "mt-3 grid grid-cols-2 gap-2 text-xs", children: [_jsx(LegendItem, { color: branchColor('spell'), label: "Spell" }), _jsx(LegendItem, { color: branchColor('buff'), label: "Buff" }), _jsx(LegendItem, { color: branchColor('stat'), label: "Stat" }), _jsx(LegendItem, { color: branchColor('ability'), label: "Ability" }), _jsx(LegendItem, { color: branchColor('weapon'), label: "Weapon" }), _jsx(LegendItem, { color: branchColor('trade'), label: "Trade" }), _jsx(LegendItem, { color: branchColor('zone'), label: "Zone Control" })] })] })] })] }));
}
function LegendItem({ color, label }) {
    return (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "inline-block w-3 h-3 rounded-full", style: { backgroundColor: color } }), _jsx("span", { children: label })] }));
}
