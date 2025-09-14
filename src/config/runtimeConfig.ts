// Runtime configuration loader: fetches /config.json at runtime so we don't depend solely on build-time env.
export interface RuntimeConfig { googleClientId?: string }

let _configPromise: Promise<RuntimeConfig> | null = null;
let _cached: RuntimeConfig | null = null;

export function loadRuntimeConfig(force = false): Promise<RuntimeConfig> {
  if (!force && _configPromise) return _configPromise;
  _configPromise = new Promise(async (resolve) => {
    if (_cached && !force) { resolve(_cached); return; }
    try {
      const res = await fetch('/config.json', { cache: 'no-store' });
      if (!res.ok) { _cached = {}; resolve(_cached); return; }
      const json = await res.json();
      _cached = (json || {}) as RuntimeConfig;
      resolve(_cached);
    } catch {
      _cached = {}; resolve(_cached);
    }
  });
  return _configPromise;
}

export async function getRuntimeGoogleClientId(): Promise<string | undefined> {
  const cfg = await loadRuntimeConfig();
  return cfg.googleClientId;
}
