// Content script bridge: listen for window.postMessage from the page and proxy to chrome.storage.sync
(function bridge() {
  const ORIGINS = ['http://localhost:1002', 'http://127.0.0.1:1002'];
  // Accept any https prod domains we declared in manifest
  function isAllowedOrigin(origin) {
    if (ORIGINS.includes(origin)) return true;
    if (origin.startsWith('https://')) return true; // relaxed for declared hosts
    return false;
  }
  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window) return;
      if (!isAllowedOrigin(event.origin)) return;
      const data = event.data || {};
      if (!data || data.__AF_SYNC !== true) return;
      const id = data.id;
      if (data.type === 'sync:get') {
        chrome.storage.sync.get(['afrofuture.profile', 'afrofuture.loadout', 'afrofuture.skills'], (items) => {
          window.postMessage({ __AF_SYNC_RESP: true, id, ok: true, data: items }, '*');
        });
      } else if (data.type === 'sync:set') {
        const payload = data.payload || {};
        chrome.storage.sync.set(payload, () => {
          const err = chrome.runtime.lastError?.message;
          window.postMessage({ __AF_SYNC_RESP: true, id, ok: !err, error: err || null }, '*');
        });
      } else if (data.type === 'sync:clear') {
        chrome.storage.sync.remove(['afrofuture.profile', 'afrofuture.loadout', 'afrofuture.skills'], () => {
          const err = chrome.runtime.lastError?.message;
          window.postMessage({ __AF_SYNC_RESP: true, id, ok: !err, error: err || null }, '*');
        });
      }
    } catch (e) {
      try { window.postMessage({ __AF_SYNC_RESP: true, id: event?.data?.id, ok: false, error: String(e?.message || e) }, '*'); } catch {}
    }
  });
})();
