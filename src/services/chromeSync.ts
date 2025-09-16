function uid() { return 'm' + Math.random().toString(36).slice(2, 10); }

function hasExtensionBridge(): boolean {
  // We can't access chrome.storage from the page, so feature-detect via a ping
  // Here we assume that if our content script is active, it will respond to a get within timeout
  return true;
}

export async function chromeSyncGet(): Promise<any | null> {
  if (!hasExtensionBridge()) return null;
  return new Promise((resolve) => {
    const id = uid();
    function onMessage(ev: MessageEvent) {
      const data: any = ev.data;
      if (!data || data.__AF_SYNC_RESP !== true || data.id !== id) return;
      window.removeEventListener('message', onMessage as any);
      resolve(data.ok ? (data.data || null) : null);
    }
    window.addEventListener('message', onMessage as any);
    window.postMessage({ __AF_SYNC: true, type: 'sync:get', id }, '*');
    setTimeout(() => { try { window.removeEventListener('message', onMessage as any); } catch {} resolve(null); }, 1200);
  });
}

export async function chromeSyncSet(payload: Record<string, any>): Promise<boolean> {
  if (!hasExtensionBridge()) return false;
  return new Promise((resolve) => {
    const id = uid();
    function onMessage(ev: MessageEvent) {
      const data: any = ev.data;
      if (!data || data.__AF_SYNC_RESP !== true || data.id !== id) return;
      window.removeEventListener('message', onMessage as any);
      resolve(!!data.ok);
    }
    window.addEventListener('message', onMessage as any);
    window.postMessage({ __AF_SYNC: true, type: 'sync:set', id, payload }, '*');
    setTimeout(() => { try { window.removeEventListener('message', onMessage as any); } catch {} resolve(false); }, 1200);
  });
}

export async function chromeSyncClear(): Promise<boolean> {
  if (!hasExtensionBridge()) return false;
  return new Promise((resolve) => {
    const id = uid();
    function onMessage(ev: MessageEvent) {
      const data: any = ev.data;
      if (!data || data.__AF_SYNC_RESP !== true || data.id !== id) return;
      window.removeEventListener('message', onMessage as any);
      resolve(!!data.ok);
    }
    window.addEventListener('message', onMessage as any);
    window.postMessage({ __AF_SYNC: true, type: 'sync:clear', id }, '*');
    setTimeout(() => { try { window.removeEventListener('message', onMessage as any); } catch {} resolve(false); }, 1200);
  });
}
