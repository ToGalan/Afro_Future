import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useSkillStore, availablePoints } from '../store/skillStore';
import { BRANCHES, makeTree, deriveTraits } from '../store/skillData';

// Skill system types
export type SkillType = 'spell' | 'buff' | 'stat' | 'ability' | 'weapon' | 'trade' | 'zone' | 'root';

interface SkillNode {
  id: string; label: string; description: string; type: SkillType; tier: number; branch: number; requires?: string[]; counters?: string[]; faction?: 'PAA' | 'ASF' | 'WC';
}
interface PositionedNode extends SkillNode { x: number; y: number; }


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


export interface SnowflakeSkillTreeProps { initialLevel?: number; onClose?: () => void; }

export default function SnowflakeSkillTree({ initialLevel = 1, onClose }: SnowflakeSkillTreeProps) {
  const unlocked = useSkillStore(s=>s.unlocked);
  const spent = useSkillStore(s=>s.spent);
  const level = useSkillStore(s=>s.level);
  const unlockGlobal = useSkillStore(s=>s.unlock);
  const setLevelGlobal = useSkillStore(s=>s.setLevel);
  const attackStat = useSkillStore(s=>s.attack);
  const defenseStat = useSkillStore(s=>s.defense);
  const utilityStat = useSkillStore(s=>s.utility);
  const traitTags = useSkillStore(s=>s.traitTags);
  const [scale, setScale] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [lastPt, setLastPt] = useState<{ x: number; y: number } | null>(null);
  // initialize global level once if different
  React.useEffect(()=>{ if (level !== initialLevel) setLevelGlobal(initialLevel);},[initialLevel, level, setLevelGlobal]);
  const nodes = useMemo(()=>makeTree(),[]);
  const size = 1200;
  const laid = useMemo(()=>layoutSnowflake(nodes,size),[nodes]);

  function clamp(v:number,a:number,b:number){ return Math.min(b, Math.max(a,v)); }
  function canUnlock(id:string){ const node = nodes.find(n=>n.id===id); if(!node) return false; if(unlocked.includes(id)) return false; if(!node.requires||node.requires.length===0) return true; return node.requires.every(r=>unlocked.includes(r)); }
  function unlockReason(id:string){ const node = nodes.find(n=>n.id===id); if(!node) return 'Missing node'; if(unlocked.includes(id)) return 'Already unlocked'; if(node.requires && node.requires.some(r=>!unlocked.includes(r))) return 'Missing prereq'; const st = useSkillStore.getState(); const avail = availablePoints(st); if(avail<=0) return 'No points'; return 'Unlockable'; }
  function onWheel(e:React.WheelEvent){ e.preventDefault(); setScale(s=>clamp(s - e.deltaY*0.0015,1.0,2.5)); }
  // Track if movement exceeded a small threshold to differentiate drag vs click
  const dragThreshold = 5;
  function onPointerDown(e:React.PointerEvent<SVGSVGElement>){
    // Do not start dragging if not zoomed in or when user is holding unlock key
    if(scale<=1.0 || holdingRef.current) return;
    setDragging(true);
    setLastPt({ x:e.clientX, y:e.clientY });
    // Clear hover to prevent tooltip from interfering while dragging
    setHoverId(null);
    try{ (e.currentTarget as any).setPointerCapture(e.pointerId);}catch{}
  }
  function onPointerMove(e:React.PointerEvent<SVGSVGElement>){ if(!dragging || !lastPt || scale<=1.0) return; const dx=e.clientX-lastPt.x; const dy=e.clientY-lastPt.y; if(Math.abs(dx)>0 || Math.abs(dy)>0){ setPan(p=>({x:p.x+dx,y:p.y+dy})); } setLastPt({x:e.clientX,y:e.clientY}); }
  function onPointerUp(e:React.PointerEvent<SVGSVGElement>){
    setDragging(false);
    setLastPt(null);
    try{ (e.currentTarget as any).releasePointerCapture(e.pointerId);}catch{}
  }
  function links(){ const arr:{from:PositionedNode;to:PositionedNode; faction?:string; counters?:string[]}[]=[]; laid.forEach(n=>{ if(!n.requires) return; n.requires.forEach(r=>{ const from = laid.find(x=>x.id===r); if(from) arr.push({from,to:n,faction:n.faction,counters:n.counters}); }); }); return arr; }

  const traits = deriveTraits(unlocked, nodes);
  const traitsTopBranch = traits.topBranch && traits.topBranch.toLowerCase() === 'root' ? undefined : traits.topBranch;
  const traitsTopType = traits.topType && traits.topType.toLowerCase() === 'root' ? undefined : traits.topType;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [lastUnlocked, setLastUnlocked] = useState<string | null>(null);
  function onUnlock(id:string){ const reason = unlockReason(id); const st = useSkillStore.getState(); const avail = availablePoints(st); console.debug('[SnowflakeSkillTree.onUnlock] attempt', { id, reason, avail, unlockedCount: st.unlocked.length }); if(reason!=='Unlockable') return; unlockGlobal(id); setLastUnlocked(id); }
  // Hold-to-unlock state
  const HOLD_DURATION = 4000; // ms
  const [holdTarget, setHoldTarget] = useState<string | null>(null);
  const holdTargetRef = useRef<string | null>(null);
  const [holdProgress, setHoldProgress] = useState(0); // 0..1
  const holdingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const holdStartRef = useRef<number | null>(null);
  // Determine which branch cores are next unlockable (tier1 core nodes that are locked but requirements satisfied)
  const nextCores = useMemo(()=>{
    return laid.filter(n=> n.id.endsWith('_core') && !unlocked.includes(n.id) && canUnlock(n.id)).map(n=>n.id);
  },[laid, unlocked]);
  // Compute projected stats / traits when hovering an unlockable node
  const hoverProjection = useMemo(()=>{
    if(!hoverId) return null; if(!canUnlock(hoverId)) return null; const st = useSkillStore.getState(); const nextUnlocked = [...st.unlocked, hoverId];
    // derive stats like in store
    let attack=0, defense=0, utility=0;
    nextUnlocked.forEach(id=>{ if (id.includes('combat') || id.includes('weapon')) attack += 2; if (id.includes('defense') || id.includes('shield')) defense += 2; if (id.includes('support') || id.includes('leadership') || id.includes('mobility')) utility += 2; if (id.includes('terraform') || id.includes('technologist')) utility += 1; });
    const traitProj = deriveTraits(nextUnlocked, nodes);
    return { attack, defense, utility, traitProj };
  },[hoverId, nodes, canUnlock]);
  const showDetail = scale >= 1.05;
  // reactive points left
  const basePoints = useSkillStore(s=>s.basePoints);
  const lvl = useSkillStore(s=>s.level);
  const ptsLeft = useMemo(()=> availablePoints(useSkillStore.getState()), [unlocked, basePoints, lvl, spent]);

  // Reset hold if conditions change
  useEffect(()=>{
    if(!hoverId || holdTarget && hoverId !== holdTarget){
      // if moved away from target
      holdingRef.current = false; holdStartRef.current = null; setHoldTarget(null); holdTargetRef.current = null; setHoldProgress(0);
      if(rafRef.current) cancelAnimationFrame(rafRef.current);
    }
    if(hoverId && unlockReason(hoverId) !== 'Unlockable'){
      holdingRef.current = false; holdStartRef.current = null; setHoldTarget(null); holdTargetRef.current = null; setHoldProgress(0);
      if(rafRef.current) cancelAnimationFrame(rafRef.current);
    }
  },[hoverId, unlocked, ptsLeft]);

  // Key handling for hold-to-unlock
  useEffect(()=>{
    function step(){
      if(!holdingRef.current || !holdStartRef.current || !holdTargetRef.current){ return; }
      const elapsed = performance.now() - holdStartRef.current;
      const prog = Math.min(1, elapsed / HOLD_DURATION);
      setHoldProgress(prog);
      if(prog >= 1){
        if(holdTargetRef.current) onUnlock(holdTargetRef.current);
        holdingRef.current = false; holdStartRef.current = null; setHoldTarget(null); holdTargetRef.current = null; setHoldProgress(0);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    }
    function keyDown(e:KeyboardEvent){
      if(e.key.toLowerCase() === 'u'){
        if(!hoverId) return;
        if(unlockReason(hoverId) !== 'Unlockable') return;
        if(!holdingRef.current){
          holdingRef.current = true;
          holdStartRef.current = performance.now();
          setHoldTarget(hoverId);
          holdTargetRef.current = hoverId;
          setHoldProgress(0);
          rafRef.current = requestAnimationFrame(step);
        }
      }
    }
    function keyUp(e:KeyboardEvent){
      if(e.key.toLowerCase() === 'u'){
  holdingRef.current = false; holdStartRef.current = null; setHoldTarget(null); holdTargetRef.current = null; setHoldProgress(0);
        if(rafRef.current) cancelAnimationFrame(rafRef.current);
      }
    }
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    return ()=>{ window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); if(rafRef.current) cancelAnimationFrame(rafRef.current); };
  },[hoverId]);

  return (
    <div className="w-full h-full bg-[#0f1218] text-gray-100 p-4 overflow-hidden relative">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xl font-semibold">Skills & Traits Map</div>
  <div className="text-sm opacity-80">Spent: {spent} • Points Left: {ptsLeft}</div>
      </div>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-9">
          <div className="relative mx-auto select-none w-full aspect-square max-w-[min(100%,760px)]" onWheel={onWheel}>
            <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{ cursor: dragging ? 'grabbing' : scale > 1.02 ? 'grab' : 'default' }}>
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
                  const isCoreHighlight = nextCores.includes(n.id);
                  const isHoldingThis = holdTarget === n.id && holdingRef.current;
                  return (
                    <g
                      key={n.id}
                      data-id={n.id}
                      transform={`translate(${n.x},${n.y})`}
                      onMouseEnter={()=>setHoverId(n.id)}
                      onMouseLeave={()=>{ if(!dragging) setHoverId(h=> h===n.id? null : h); }}
                      style={{ pointerEvents:'all' }}
                    >
                      <circle r={r+5} fill="#0b1220" stroke="#1f2937" strokeWidth={2} />
                      <circle r={r} fill={isUnlocked?color:'#111827'} stroke={isUnlocked?color:'#374151'} strokeWidth={isUnlocked?3:2} filter={isUnlocked? 'url(#glow)': undefined} style={{ cursor: canUnlock(n.id)?'pointer':'not-allowed', boxShadow: isCoreHighlight? '0 0 0 4px rgba(16,185,129,0.6)': undefined }} />
                      {(!isUnlocked && isHoldingThis) && (()=>{ const pr = holdProgress; const rr = r + 6; const circ = 2*Math.PI*rr; return (
                        <circle r={rr} fill="none" stroke="#10b981" strokeWidth={4} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ - circ*pr} />
                      )})()}
                      {/* Invisible larger hit area to make clicks easier */}
                      <circle r={r+10} fill="transparent" stroke="none" style={{ cursor: canUnlock(n.id)?'pointer':'not-allowed' }} />
                      {isCoreHighlight && !isUnlocked && (
                        <circle r={r+6} fill="none" stroke="rgba(16,185,129,0.55)" strokeWidth={2} strokeDasharray="4 4" />
                      )}
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
            {hoverProjection && hoverId && (
              <div className="absolute top-2 left-2 w-64 rounded-xl border border-emerald-400/30 bg-[#0f1218]/95 backdrop-blur p-3 text-xs shadow-xl pointer-events-none">
                <div className="font-semibold text-emerald-300 mb-1 truncate">Preview: {laid.find(n=>n.id===hoverId)?.label}</div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="flex flex-col items-start"><span className="opacity-60">Atk</span><span className="font-semibold text-emerald-200">{hoverProjection.attack}</span></div>
                  <div className="flex flex-col items-start"><span className="opacity-60">Def</span><span className="font-semibold text-emerald-200">{hoverProjection.defense}</span></div>
                  <div className="flex flex-col items-start"><span className="opacity-60">Util</span><span className="font-semibold text-emerald-200">{hoverProjection.utility}</span></div>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {hoverProjection.traitProj.tags.length ? hoverProjection.traitProj.tags.map(t=> <span key={t} className="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-[10px]">{t}</span>) : <span className="opacity-50">No new trait</span>}
                </div>
                <div className="opacity-60 leading-snug line-clamp-3 mb-2">{laid.find(n=>n.id===hoverId)?.description}</div>
                {unlockReason(hoverId)==='Unlockable' && !unlocked.includes(hoverId) && (
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-emerald-300 font-semibold">Hold key 'U' to Unlock</span>
                      <span className="opacity-70">{holdTarget === hoverId ? `${((HOLD_DURATION/1000) * (1-holdProgress)).toFixed(1)}s remaining` : `${(HOLD_DURATION/1000).toFixed(1)}s required`}</span>
                      <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 transition-all duration-100 ease-linear" 
                          style={{ 
                            width: `${(holdProgress*100).toFixed(1)}%`,
                            backgroundColor: holdProgress > 0.8 ? '#22c55e' : '#10b981'
                          }} 
                        />
                      </div>
                      <span className="opacity-60 text-[10px]">Points after unlock: {ptsLeft-1 >= 0 ? ptsLeft-1 : 0}</span>
                    </div>
                    <div className="relative w-12 h-12 flex items-center justify-center">
                      <svg width={48} height={48} className="block">
                        {(()=>{ 
                          const r=18; 
                          const c=2*Math.PI*r; 
                          const isActive = holdTarget === hoverId && holdProgress > 0;
                          return (
                            <g transform="translate(24,24)">
                              {/* Background circle */}
                              <circle r={r} fill="#111827" stroke="#374151" strokeWidth={3} />
                              {/* Progress circle */}
                              <circle 
                                r={r} 
                                fill="none" 
                                stroke={isActive ? "#10b981" : "#374151"} 
                                strokeWidth={3} 
                                strokeLinecap="round" 
                                strokeDasharray={c} 
                                strokeDashoffset={c - c*holdProgress} 
                                style={{ 
                                  transition: isActive ? 'stroke-dashoffset 0.1s linear, stroke 0.2s ease' : 'stroke-dashoffset 0.25s ease, stroke 0.2s ease',
                                  transform: 'rotate(-90deg)',
                                  transformOrigin: 'center'
                                }} 
                              />
                              {/* Glow effect when active */}
                              {isActive && (
                                <circle 
                                  r={r+2} 
                                  fill="none" 
                                  stroke="#10b981" 
                                  strokeWidth={1} 
                                  opacity={0.5}
                                />
                              )}
                            </g>
                          );
                        })()}
                      </svg>
                      <span className={`absolute text-sm font-bold tracking-wide transition-colors duration-200 ${holdTarget === hoverId && holdProgress > 0 ? 'text-emerald-300' : 'text-gray-300'}`}>U</span>
                    </div>
                  </div>
                )}
                {unlockReason(hoverId)!=='Unlockable' && (
                  <div className="opacity-60">{unlockReason(hoverId)}</div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="col-span-3">
          <div className="rounded-2xl p-4 bg-white/5 border border-white/10">
            <div className="text-lg font-semibold">Traits</div>
            <div className="mt-2 text-sm">Primary Path: <span className="opacity-80">{traitsTopBranch ?? '—'}</span></div>
            <div className="text-sm">Primary Type: <span className="opacity-80">{traitsTopType ?? '—'}</span></div>
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
