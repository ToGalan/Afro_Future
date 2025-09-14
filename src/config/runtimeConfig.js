let _configPromise = null;
let _cached = null;
export function loadRuntimeConfig(force = false) {
    if (!force && _configPromise)
        return _configPromise;
    _configPromise = new Promise(async (resolve) => {
        if (_cached && !force) {
            resolve(_cached);
            return;
        }
        try {
            const res = await fetch('/config.json', { cache: 'no-store' });
            if (!res.ok) {
                _cached = {};
                resolve(_cached);
                return;
            }
            const json = await res.json();
            _cached = (json || {});
            resolve(_cached);
        }
        catch {
            _cached = {};
            resolve(_cached);
        }
    });
    return _configPromise;
}
export async function getRuntimeGoogleClientId() {
    const cfg = await loadRuntimeConfig();
    return cfg.googleClientId;
}
