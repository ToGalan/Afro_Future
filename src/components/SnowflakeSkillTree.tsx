import React, { useMemo, useState } from 'react';

// Skill system types
export type SkillType = 'spell' | 'buff' | 'stat' | 'ability' | 'weapon' | 'trade' | 'zone' | 'root';

interface SkillNode {
  id: string; label: string; description: string; type: SkillType; tier: number; branch: number; requires?: string[]; counters?: string[]; faction?: 'PAA' | 'ASF' | 'WC';
}
interface PositionedNode extends SkillNode { x: number; y: number; }

const BRANCHES = [
  { id: 0, name: 'Combat', type: 'stat' as SkillType },
  { id: 1, name: 'Support', type: 'buff' as SkillType },
  { id: 2, name: 'Pet Bond', type: 'ability' as SkillType },
  { id: 3, name: 'Weapons', type: 'weapon' as SkillType },
  { id: 4, name: 'Spellcraft', type: 'spell' as SkillType },
  { id: 5, name: 'Defense', type: 'buff' as SkillType },
  { id: 6, name: 'Mobility', type: 'ability' as SkillType },
  { id: 7, name: 'Leadership', type: 'zone' as SkillType },
  { id: 8, name: 'Terraform', type: 'ability' as SkillType },
  { id: 9, name: 'Technologist', type: 'ability' as SkillType },
  { id: 10, name: 'Merchant', type: 'trade' as SkillType },
  { id: 11, name: 'Looting', type: 'ability' as SkillType },
];

function branchColor(t: SkillType) {
  if (t === 'spell') return '#60a5fa';
  if (t === 'buff') return '#34d399';
  if (t === 'stat') return '#f472b6';
  if (t === 'ability') return '#fbbf24';
  if (t === 'weapon') return '#a78bfa';
  if (t === 'trade') return '#fb923c';
  if (t === 'zone') return '#f87171';
  return '#9ca3af';
}

function makeTree(): SkillNode[] {
  const nodes: SkillNode[] = [];
  nodes.push({ id: 'root', label: 'Origin', description: 'Common root', type: 'root', tier: 0, branch: -1 });
  BRANCHES.forEach(b => {
    const baseId = b.name.toLowerCase().replace(/\s+/g,'');
    nodes.push({ id: `${baseId}_core`, label: `${b.name} Core`, description: `${b.name} fundamentals`, type: b.type, tier: 1, branch: b.id, requires: ['root'] });
    for (let i=0;i<8;i++) {
      const t = 2 + Math.floor(i / 3);
      const id = `${baseId}_${i+1}`;
      const req = i < 3 ? [`${baseId}_core`] : [`${baseId}_${i-2}`];
      const label = `${b.name} Skill ${i+1}`;
      nodes.push({
        id,
        label,
        description: `${b.name} skill ${i+1}`,
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

function layoutSnowflake(nodes: SkillNode[], size: number): PositionedNode[] {
  const cx = size/2; const cy = size/2;
  const maxTier = Math.max(...nodes.map(n=>n.tier));
  const perBranchAngle = (2*Math.PI)/BRANCHES.length;
  const radiusStep = (size*0.5)/Math.max(1,maxTier);
  return nodes.map(n => {
    if (n.id === 'root') return { ...n, x: cx, y: cy };
    const branchAngle = n.branch >= 0 ? n.branch * perBranchAngle : 0;
    const jitter = n.id.includes('_core') ? 0 : ((parseInt(n.id.replace(/\D/g,'')) % 7) - 3) * (Math.PI/180) * 5;
    const angle = branchAngle + jitter;
    const r = radiusStep * n.tier + (n.id.includes('_core') ? 0 : 20);
    return { ...n, x: cx + Math.cos(angle)*r, y: cy + Math.sin(angle)*r };
  });
}

function deriveTraits(unlocked: string[], nodes: SkillNode[]) {
  const byBranch: Record<string, number> = {}; const byType: Record<string, number> = {};
  unlocked.forEach(id => { const n = nodes.find(x=>x.id===id); if (!n) return; const b = BRANCHES.find(br=>br.id===n.branch)?.name || 'root'; byBranch[b]=(byBranch[b]||0)+1; byType[n.type]=(byType[n.type]||0)+1; });
  const topBranch = Object.entries(byBranch).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const topType = Object.entries(byType).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const tags: string[] = [];
  if ((byBranch['Leadership']||0) >= 4) tags.push('Commander');
  if ((byBranch['Terraform']||0) >= 4) tags.push('Terraformer');
  if ((byBranch['Technologist']||0) >= 4) tags.push('Technocrat');
  if ((byBranch['Merchant']||0) >= 4) tags.push('Trader');
  if ((byBranch['Looting']||0) >= 4) tags.push('Raider');
  if ((byBranch['Combat']||0) >= 4) tags.push('Aggressor');
  if ((byBranch['Support']||0) >= 4) tags.push('Support Specialist');
  if ((byBranch['Mobility']||0) >= 4) tags.push('Skirmisher');
  return { topBranch, topType, tags };
}

export interface SnowflakeSkillTreeProps { initialLevel?: number; onClose?: () => void; }

export default function SnowflakeSkillTree({ initialLevel = 1, onClose }: SnowflakeSkillTreeProps) {
  const [unlocked, setUnlocked] = useState<string[]>(['root']);
  const [spent, setSpent] = useState(0);
  const [scale, setScale] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [lastPt, setLastPt] = useState<{ x: number; y: number } | null>(null);
  const [level, setLevel] = useState(initialLevel);
  const nodes = useMemo(()=>makeTree(),[]);
  const size = 1200;
  const laid = useMemo(()=>layoutSnowflake(nodes,size),[nodes]);

  function clamp(v:number,a:number,b:number){ return Math.min(b, Math.max(a,v)); }
  function canUnlock(id:string){ const node = nodes.find(n=>n.id===id); if(!node) return false; if(unlocked.includes(id)) return false; if(!node.requires||node.requires.length===0) return true; return node.requires.every(r=>unlocked.includes(r)); }
  function onUnlock(id:string){ if(!canUnlock(id)) return; const basePoints=12; const bonusPoints=Math.floor((Math.max(1,level)-1)/5)*3; const available=basePoints+bonusPoints-spent; if(available<=0) return; setUnlocked(u=>[...u,id]); setSpent(s=>s+1); }
  function onWheel(e:React.WheelEvent){ e.preventDefault(); setScale(s=>clamp(s - e.deltaY*0.0015,0.6,2.5)); }
  function onPointerDown(e:React.PointerEvent<SVGSVGElement>){ if(scale<=1.02) return; setDragging(true); setLastPt({ x:e.clientX, y:e.clientY }); try{ (e.currentTarget as any).setPointerCapture(e.pointerId);}catch{} }
  function onPointerMove(e:React.PointerEvent<SVGSVGElement>){ if(!dragging || !lastPt || scale<=1.02) return; const dx=e.clientX-lastPt.x; const dy=e.clientY-lastPt.y; setPan(p=>({x:p.x+dx,y:p.y+dy})); setLastPt({x:e.clientX,y:e.clientY}); }
  function onPointerUp(e:React.PointerEvent<SVGSVGElement>){ setDragging(false); setLastPt(null); try{ (e.currentTarget as any).releasePointerCapture(e.pointerId);}catch{} }
  function links(){ const arr:{from:PositionedNode;to:PositionedNode; faction?:string; counters?:string[]}[]=[]; laid.forEach(n=>{ if(!n.requires) return; n.requires.forEach(r=>{ const from = laid.find(x=>x.id===r); if(from) arr.push({from,to:n,faction:n.faction,counters:n.counters}); }); }); return arr; }

  const traits = deriveTraits(unlocked, nodes);
  const showDetail = scale >= 1.05;
  const basePoints=12; const bonusPoints=Math.floor((Math.max(1,level)-1)/5)*3; const pointsLeft=basePoints+bonusPoints-spent;

  return (
    <div className="w-full h-full bg-[#0f1218] text-gray-100 p-4 overflow-hidden relative">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xl font-semibold">Skill Snowflake</div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1 rounded bg-white/10 border border-white/10 text-sm" onClick={onClose}>Back</button>
          <button className="px-2 py-1 rounded bg-white/10 border border-white/10" onClick={()=>setScale(s=>clamp(s*0.9,0.6,2.5))}>−</button>
          <div className="w-16 text-center text-sm opacity-80">{Math.round(scale*100)}%</div>
          <button className="px-2 py-1 rounded bg-white/10 border border-white/10" onClick={()=>setScale(s=>clamp(s*1.1,0.6,2.5))}>+</button>
          <div className="text-sm opacity-80 ml-2">Lvl</div>
          <button className="px-2 rounded bg-white/10 border border-white/10" onClick={()=>setLevel(l=>Math.max(1,l-1))}>−</button>
            <div className="w-8 text-center text-sm opacity-80">{level}</div>
          <button className="px-2 rounded bg-white/10 border border-white/10" onClick={()=>setLevel(l=>l+1)}>+</button>
          <div className="text-sm opacity-80 ml-4">Spent: {spent} • Points Left: {pointsLeft}</div>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-9">
          <div className="relative mx-auto select-none" style={{ width: size, height: size }} onWheel={onWheel}>
            <svg width={size} height={size} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{ cursor: dragging ? 'grabbing' : scale > 1.02 ? 'grab' : 'default' }}>
              <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="colored" />
                  <feMerge>
                    <feMergeNode in="colored" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <g transform={`translate(${size/2 + pan.x},${size/2 + pan.y}) scale(${scale}) translate(${-size/2},${-size/2})`}>
                {links().map((l,i)=>(
                  <line key={i} x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} stroke={unlocked.includes(l.to.id) ? branchColor(l.to.type) : '#6b7280'} strokeWidth={2} />
                ))}
                {laid.map(n=>{
                  const color = branchColor(n.type); const isUnlocked = unlocked.includes(n.id); const r = n.id==='root'?22: n.tier===1?14:11;
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                      <circle r={r+5} fill="#0b1220" stroke="#1f2937" strokeWidth={2} />
                      <circle r={r} fill={isUnlocked?color:'#111827'} stroke={isUnlocked?color:'#374151'} strokeWidth={isUnlocked?3:2} filter={isUnlocked? 'url(#glow)': undefined} onClick={()=>onUnlock(n.id)} style={{ cursor: canUnlock(n.id)?'pointer':'not-allowed' }} />
                      {showDetail ? (
                        <>
                          <text y={-r-8} textAnchor="middle" fontSize={11} fill="#e5e7eb">{n.label}</text>
                          {n.faction && <text y={r+12} textAnchor="middle" fontSize={9} fill="#9ca3af">{n.faction}</text>}
                        </>
                      ) : (<text y={4} textAnchor="middle" fontSize={8} fill="#cbd5e1">{n.tier}</text>)}
                    </g>
                  );
                })}
                {BRANCHES.map((b,i)=>{ const angle = (2*Math.PI*i)/BRANCHES.length; const x = size/2 + Math.cos(angle)*(size*0.46); const y = size/2 + Math.sin(angle)*(size*0.46); return (
                  <g key={b.id} transform={`translate(${x},${y})`}>
                    <text textAnchor="middle" fontSize={showDetail?12:14} fill="#9ca3af">{b.name}</text>
                  </g>
                );})}
              </g>
            </svg>
          </div>
        </div>
        <div className="col-span-3">
          <div className="rounded-2xl p-4 bg-white/5 border border-white/10">
            <div className="text-lg font-semibold">Traits</div>
            <div className="mt-2 text-sm">Primary Path: <span className="opacity-80">{traits.topBranch ?? '—'}</span></div>
            <div className="text-sm">Primary Type: <span className="opacity-80">{traits.topType ?? '—'}</span></div>
            <div className="mt-2 flex flex-wrap gap-2">
              {traits.tags.length ? traits.tags.map(t => (
                <span key={t} className="px-2 py-1 rounded bg-white/10 border border-white/10 text-xs">{t}</span>
              )) : <span className="opacity-70 text-xs">Unlock nodes to reveal traits</span>}
            </div>
            <div className="mt-4 text-xs opacity-70">Choosing different branches creates unique player traits. Zoom out for snowflake view; zoom in to drag and inspect details.</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <LegendItem color={branchColor('spell')} label="Spell" />
            <LegendItem color={branchColor('buff')} label="Buff" />
            <LegendItem color={branchColor('stat')} label="Stat" />
            <LegendItem color={branchColor('ability')} label="Ability" />
            <LegendItem color={branchColor('weapon')} label="Weapon" />
            <LegendItem color={branchColor('trade')} label="Trade" />
            <LegendItem color={branchColor('zone')} label="Zone Control" />
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}
