// Snapshot + signaling + WebRTC helper functions
export async function loadSnapshot(world: string, idToken?: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`/snapshots/${world}/latest`, {
      headers: idToken ? { Authorization: `Bearer ${idToken}` } : undefined,
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    console.warn('[snapshot] load failed', e);
    return null;
  }
}

export async function saveSnapshot(world: string, update: Uint8Array, idToken?: string, alreadyGzip = false) {
  try {
    // Ensure we construct a plain ArrayBuffer (not SharedArrayBuffer) for Blob
    const plain = new Uint8Array(update.byteLength);
    plain.set(update);
    await fetch(`/snapshots/${world}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(alreadyGzip ? { 'Content-Encoding': 'gzip' } : {}),
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: new Blob([plain.buffer]),
    });
  } catch (e) {
    console.warn('[snapshot] save failed', e);
  }
}

export interface JoinRoomResult {
  ws: WebSocket;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
}

export function joinRoom(roomId: string, handlers: { onMessage?: (data: any) => void } = {}, idToken?: string): JoinRoomResult {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const dc = pc.createDataChannel('state');
  dc.onopen = () => console.log('[dc] open');
  dc.onmessage = (e) => {
    let payload = e.data;
    if (payload instanceof Blob) {
      payload.arrayBuffer().then(ab => handlers.onMessage?.(new Uint8Array(ab)));
    } else {
      handlers.onMessage?.(payload);
    }
  };
  pc.onicecandidate = (e) => e.candidate && ws.readyState === 1 && ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate }));

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', roomId, idToken }));
    (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
    })();
  };
  ws.onmessage = async (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'offer') {
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription(msg.sdp);
    } else if (msg.type === 'ice') {
      try { await pc.addIceCandidate(msg.candidate); } catch {}
    }
  };

  return { ws, pc, dc };
}

export function getStoredIdToken(): string | null {
  return localStorage.getItem('afrofuture.idToken');
}

export function setStoredIdToken(token: string | null) {
  if (token) localStorage.setItem('afrofuture.idToken', token); else localStorage.removeItem('afrofuture.idToken');
}
