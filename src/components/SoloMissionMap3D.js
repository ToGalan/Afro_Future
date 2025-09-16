import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text, Sky, Edges, ContactShadows } from '@react-three/drei';
// Hex helpers
function axialDistance(a, b) {
    const aq = a.q, ar = a.r, as = -aq - ar;
    const bq = b.q, br = b.r, bs = -bq - br;
    return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
}
function axialToWorld(a, size) {
    const x = size * (Math.sqrt(3) * a.q + (Math.sqrt(3) / 2) * a.r);
    const z = size * (1.5 * a.r);
    return { x, z };
}
// PRNG
function seededRand(seed) {
    let t = seed + 0x6d2b79f5;
    return () => {
        t |= 0;
        t = (t + 0x6d2b79f5) | 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}
function generateMap(radius, seed = 42) {
    const rnd = seededRand(seed);
    const tiles = [];
    for (let q = -radius; q <= radius; q++) {
        const r1 = Math.max(-radius, -q - radius);
        const r2 = Math.min(radius, -q + radius);
        for (let r = r1; r <= r2; r++) {
            const roll = rnd();
            const type = roll < 0.1 ? 'water' : roll < 0.24 ? 'desert' : roll < 0.55 ? 'plains' : roll < 0.78 ? 'forest' : 'hills';
            const resRoll = rnd();
            const resource = resRoll < 0.08 ? 'ore' : resRoll < 0.14 ? 'energy' : resRoll < 0.2 ? 'bio' : null;
            tiles.push({ q, r, type, resource });
        }
    }
    return tiles;
}
function tileColor(t) {
    if (t.type === 'water')
        return '#87d5ff';
    if (t.type === 'desert')
        return '#f7d08a';
    if (t.type === 'plains')
        return '#a7e39b';
    if (t.type === 'forest')
        return '#67c07a';
    return '#c9c6c0';
}
function heightFor(t) {
    if (t.type === 'hills')
        return 2.2;
    if (t.type === 'forest')
        return 1.1;
    if (t.type === 'desert')
        return 0.6;
    if (t.type === 'plains')
        return 0.8;
    return 0.25; // water
}
function ResourceIcon({ t, size }) {
    const { x, z } = axialToWorld(t, size);
    const label = t.resource === 'ore' ? '⬢' : t.resource === 'energy' ? '⚡' : t.resource === 'bio' ? '🍃' : '';
    if (!label)
        return null;
    return (_jsx(Text, { position: [x, heightFor(t) + 2.2, z], fontSize: 1.2, color: "#374151", anchorX: "center", anchorY: "middle", children: label }));
}
function ForestDeco({ size }) {
    return (_jsxs("group", { children: [_jsxs("mesh", { position: [0, 0.95, 0], castShadow: true, children: [_jsx("coneGeometry", { args: [size * 0.5, 1.6, 6] }), _jsx("meshToonMaterial", { color: "#59b169" })] }), _jsxs("mesh", { position: [0, 0.3, 0], castShadow: true, children: [_jsx("cylinderGeometry", { args: [size * 0.12, size * 0.12, 0.6, 6] }), _jsx("meshToonMaterial", { color: "#8b5a3c" })] })] }));
}
function HillDeco({ size }) {
    return (_jsxs("mesh", { position: [0, 0.7, 0], castShadow: true, children: [_jsx("icosahedronGeometry", { args: [size * 0.35, 0] }), _jsx("meshToonMaterial", { color: "#bfbcb6" })] }));
}
function WaterRipple({ radius }) {
    const ref = React.useRef(null);
    React.useEffect(() => {
        let raf;
        const loop = () => {
            if (ref.current)
                ref.current.position.y = 0.05 * Math.sin(performance.now() / 600);
            raf = requestAnimationFrame(loop);
        };
        loop();
        return () => cancelAnimationFrame(raf);
    }, []);
    return (_jsxs("mesh", { ref: ref, rotation: [-Math.PI / 2, 0, 0], position: [0, heightFor({ q: 0, r: 0, type: 'water', resource: null }) + 0.06, 0], children: [_jsx("ringGeometry", { args: [radius * 0.5, radius * 0.92, 32] }), _jsx("meshBasicMaterial", { color: "#bcecff", transparent: true, opacity: 0.7 })] }));
}
function HexTile({ t, size, discovered, selectable, onClick }) {
    const { x, z } = axialToWorld(t, size);
    const h = heightFor(t);
    const color = tileColor(t);
    return (_jsxs("group", { position: [x, h / 2, z], children: [_jsxs("mesh", { onClick: () => selectable && onClick(t), castShadow: true, receiveShadow: true, children: [_jsx("cylinderGeometry", { args: [size * 0.98, size * 0.98, h, 6] }), _jsx("meshToonMaterial", { color: color }), _jsx(Edges, { threshold: 15, color: "#ffffff" })] }), t.type === 'water' && _jsx(WaterRipple, { radius: size }), t.type === 'forest' && _jsx(ForestDeco, { size: size }), t.type === 'hills' && _jsx(HillDeco, { size: size }), selectable && (_jsxs("mesh", { position: [0, h + 0.05, 0], rotation: [-Math.PI / 2, 0, 0], children: [_jsx("ringGeometry", { args: [size * 0.78, size * 0.92, 32] }), _jsx("meshBasicMaterial", { color: "#3fb3ff", transparent: true, opacity: 0.85 })] })), _jsx(ResourceIcon, { t: t, size: size }), !discovered && (_jsxs("mesh", { position: [0, h / 2 + 0.01, 0], children: [_jsx("cylinderGeometry", { args: [size * 0.98, size * 0.98, h + 0.02, 6] }), _jsx("meshStandardMaterial", { color: "#0b0f14", transparent: true, opacity: 0.5 })] }))] }));
}
export default function SoloMissionMap3D() {
    const worldRadius = 9;
    const hexSize = 2.3;
    const [turn, setTurn] = useState(1);
    const [unit, setUnit] = useState({ id: 'scout', pos: { q: 0, r: 0 }, moves: 3, vision: 2 });
    const [objectives, setObjectives] = useState({ scouted: false, secured: false, outpost: false });
    const tiles = useMemo(() => generateMap(worldRadius, 1337), []);
    const discovered = useMemo(() => new Set(tiles.filter(t => axialDistance(t, unit.pos) <= unit.vision + 2 || (Math.abs(t.q) <= 1 && Math.abs(t.r) <= 1)).map(t => `${t.q},${t.r}`)), [tiles, unit.pos, unit.vision]);
    function tileKey(t) { return `${t.q},${t.r}`; }
    function canMove(to) { return unit.moves > 0 && axialDistance(unit.pos, to) === 1; }
    function moveUnit(to) { if (!canMove(to))
        return; setUnit(u => ({ ...u, pos: to, moves: u.moves - 1 })); }
    function endTurn() {
        setUnit(u => ({ ...u, moves: 3 }));
        setTurn(t => t + 1);
        const sawOre = tiles.some(t => t.resource === 'ore' && axialDistance(t, unit.pos) <= unit.vision + 1);
        const sawEnergy = tiles.some(t => t.resource === 'energy' && axialDistance(t, unit.pos) <= unit.vision + 1);
        setObjectives(o => ({ scouted: true, secured: o.secured || sawOre || sawEnergy, outpost: o.outpost }));
    }
    return (_jsxs("div", { className: "w-full h-full bg-[#c9efff] text-gray-900 p-4 overflow-hidden", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsxs("div", { className: "text-xl font-semibold", children: ["Solo Mission \u2014 Turn ", turn] }), _jsx("div", { className: "flex items-center gap-2", children: _jsx("button", { className: "ml-4 px-3 py-1 rounded bg-emerald-500/20 border border-emerald-500/30", onClick: endTurn, children: "End Turn" }) })] }), _jsxs("div", { className: "grid grid-cols-12 gap-4", children: [_jsx("div", { className: "col-span-9", children: _jsx("div", { className: "relative mx-auto select-none rounded-xl overflow-hidden shadow-2xl ring-1 ring-black/5", style: { width: 1100, height: 1100 }, children: _jsxs(Canvas, { shadows: true, camera: { position: [28, 26, 28], fov: 45 }, children: [_jsx(Sky, { inclination: 0.6, azimuth: 0.25, sunPosition: [50, 50, 10], turbidity: 2, rayleigh: 0.7, mieCoefficient: 0.005, mieDirectionalG: 0.8 }), _jsx("hemisphereLight", { args: ["#bde0fe", "#e6f3ff", 0.8] }), _jsx("directionalLight", { position: [30, 40, 15], intensity: 0.7, castShadow: true, "shadow-mapSize-width": 2048, "shadow-mapSize-height": 2048 }), _jsxs("group", { position: [0, 0, 0], children: [tiles.map((t) => {
                                                const { x, z } = axialToWorld(t, hexSize);
                                                const selectable = axialDistance(unit.pos, t) === 1;
                                                const discoveredNow = discovered.has(tileKey(t));
                                                return (_jsx("group", { position: [x, 0, z], children: _jsx(HexTile, { t: t, size: hexSize, discovered: discoveredNow, selectable: selectable, onClick: (tt) => moveUnit({ q: tt.q, r: tt.r }) }) }, tileKey(t)));
                                            }), (() => {
                                                const { x, z } = axialToWorld(unit.pos, hexSize);
                                                return (_jsxs("group", { position: [x, 3, z], children: [_jsxs("mesh", { castShadow: true, children: [_jsx("sphereGeometry", { args: [1.1, 20, 20] }), _jsx("meshToonMaterial", { color: "#ff88b7" })] }), _jsxs(Text, { position: [0, 2.2, 0], fontSize: 0.9, color: "#374151", anchorX: "center", anchorY: "bottom", children: ["Moves ", unit.moves] })] }));
                                            })()] }), _jsxs("mesh", { rotation: [-Math.PI / 2, 0, 0], position: [0, -0.01, 0], receiveShadow: true, children: [_jsx("planeGeometry", { args: [220, 220] }), _jsx("meshStandardMaterial", { color: "#bff0ff" })] }), _jsx(ContactShadows, { position: [0, 0, 0], opacity: 0.3, blur: 2.5, far: 30 }), _jsx(OrbitControls, { target: [0, 0, 0], minPolarAngle: Math.PI / 3, maxPolarAngle: Math.PI / 3, enableRotate: false, enablePan: true, enableDamping: true, dampingFactor: 0.08, screenSpacePanning: true, maxDistance: 75, minDistance: 15 })] }) }) }), _jsxs("div", { className: "col-span-3", children: [_jsxs("div", { className: "rounded-2xl p-4 bg-white/70 border border-white text-gray-800 backdrop-blur", children: [_jsx("div", { className: "text-lg font-semibold", children: "Mission Objectives" }), _jsxs("ul", { className: "mt-2 space-y-1 text-sm", children: [_jsxs("li", { className: "flex items-center gap-2", children: [_jsx("span", { className: `w-2 h-2 rounded-full ${objectives.scouted ? 'bg-emerald-600' : 'bg-slate-400'}` }), " Scout surroundings"] }), _jsxs("li", { className: "flex items-center gap-2", children: [_jsx("span", { className: `w-2 h-2 rounded-full ${objectives.secured ? 'bg-emerald-600' : 'bg-slate-400'}` }), " Secure a resource"] }), _jsxs("li", { className: "flex items-center gap-2", children: [_jsx("span", { className: `w-2 h-2 rounded-full ${objectives.outpost ? 'bg-emerald-600' : 'bg-slate-400'}` }), " Establish an outpost"] })] }), _jsx("div", { className: "mt-4 text-xs opacity-70", children: "Drag to pan, scroll to zoom. Fixed tilt. Click highlighted adjacent hexes to move." })] }), _jsxs("div", { className: "mt-3 rounded-2xl p-4 bg-white/70 border border-white text-gray-800 backdrop-blur", children: [_jsx("div", { className: "text-lg font-semibold", children: "Unit" }), _jsxs("div", { className: "text-sm mt-1", children: ["Scout \u2022 Vision ", unit.vision] }), _jsxs("div", { className: "text-sm", children: ["Position ", unit.pos.q, ",", unit.pos.r] })] })] })] })] }));
}
