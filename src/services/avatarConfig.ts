// Helper utilities for avatar part selection persistence & normalization
// Maps verbose group names (e.g. 'Facial Hair') to compact camel keys ('facialHair')

export function groupKey(group: string): string {
  return group
    .replace(/[^A-Za-z0-9 ]/g,'')
    .split(/\s+/)
    .map((w,i)=> i===0 ? w.toLowerCase() : (w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()))
    .join('');
}

export interface PartsSummary { [compactGroup: string]: string; }

export function summarizeParts(parts: Record<string,string|undefined>|undefined): PartsSummary {
  const out: PartsSummary = {};
  if(!parts) return out;
  for(const [group,id] of Object.entries(parts)){
    if(!id) continue;
    out[groupKey(group)] = id;
  }
  return out;
}

export interface AvatarColors { primary:string; secondary:string; skin:string; }

export interface AvatarConfigPayload {
  parts: Record<string,string|undefined>;
  colors: AvatarColors;
  summary: PartsSummary;
  updatedAt: number;
}

export function buildAvatarConfig(parts: Record<string,string|undefined>, colors: AvatarColors): AvatarConfigPayload {
  return { parts: { ...parts }, colors: { ...colors }, summary: summarizeParts(parts), updatedAt: Date.now() };
}
