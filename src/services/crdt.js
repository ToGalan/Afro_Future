import * as Y from 'yjs';
import { loadSnapshot, saveSnapshot } from './realtimeClient';
// Basic CRDT manager: initializes a Y.Doc, applies snapshot, wires datachannel updates, and periodic saving.
// Future enhancements: indexedDB persistence, granular topic separation, auth-based filtering.
let doc = null;
let worldId = null;
let idTokenRef = null;
let pendingSinceLastSave = false;
let saveIntervalHandle = null;
let attached = false;
export async function initCRDT(opts) {
    if (doc)
        return doc; // single instance for now
    worldId = opts.world || 'global';
    idTokenRef = opts.idToken;
    doc = new Y.Doc();
    // Try to load snapshot (server returns gzip'd raw Yjs update or full state update)
    try {
        const snap = await loadSnapshot(worldId, idTokenRef);
        if (snap) {
            try {
                // Assuming server stored the raw Yjs update (already binary). If gzip-compressed, you'd gunzip here.
                Y.applyUpdate(doc, snap);
                console.log('[crdt] snapshot applied bytes', snap.byteLength);
            }
            catch (e) {
                console.warn('[crdt] failed to apply snapshot', e);
            }
        }
        else {
            console.log('[crdt] no snapshot found for world', worldId);
        }
    }
    catch (e) {
        console.warn('[crdt] snapshot load error', e);
    }
    // Mark changes so we know to save
    doc.on('update', () => { pendingSinceLastSave = true; });
    // Periodic save of full state
    const interval = opts.autoSaveMs ?? 60000;
    saveIntervalHandle = setInterval(async () => {
        if (!doc || !pendingSinceLastSave || !worldId || !idTokenRef)
            return;
        try {
            const full = Y.encodeStateAsUpdate(doc);
            await saveSnapshot(worldId, full, idTokenRef);
            pendingSinceLastSave = false;
            console.log('[crdt] snapshot saved', full.byteLength);
        }
        catch (e) {
            console.warn('[crdt] snapshot save error', e);
        }
    }, interval);
    return doc;
}
export function getCRDTDoc() { return doc; }
export function attachCRDTChannel({ dc }) {
    if (!doc)
        throw new Error('CRDT doc not initialized');
    if (attached)
        return; // Only attach once
    attached = true;
    // Outbound: send every update as it happens
    doc.on('update', (u) => {
        if (dc.readyState === 'open') {
            try {
                const copy = new Uint8Array(u); // ensure standard ArrayBuffer
                dc.send(copy);
            }
            catch { }
        }
    });
    // Inbound: apply incoming updates
    dc.onmessage = async (e) => {
        try {
            if (e.data instanceof ArrayBuffer) {
                Y.applyUpdate(doc, new Uint8Array(e.data));
            }
            else if (e.data instanceof Blob) {
                const ab = await e.data.arrayBuffer();
                Y.applyUpdate(doc, new Uint8Array(ab));
            }
            else if (typeof e.data === 'string') {
                // Ignore string messages for now or handle control types later
            }
        }
        catch (err) {
            console.warn('[crdt] failed to apply incoming update', err);
        }
    };
    dc.onopen = () => console.log('[crdt] datachannel attached');
}
export function disposeCRDT() {
    if (saveIntervalHandle)
        clearInterval(saveIntervalHandle);
    saveIntervalHandle = null;
    doc?.destroy();
    doc = null;
    worldId = null;
    idTokenRef = null;
    attached = false;
}
