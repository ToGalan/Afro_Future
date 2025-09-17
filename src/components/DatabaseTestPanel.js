import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { db, rtdb } from '../services/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { ref, set, get, onValue } from 'firebase/database';
import { ensureAnonAuth } from '../services/firebase';
/** Simple developer-only database smoke test for Firestore + RTDB */
export const DatabaseTestPanel = () => {
    const [fsLatency, setFsLatency] = useState(null);
    const [rtLatency, setRtLatency] = useState(null);
    const [fsValue, setFsValue] = useState('');
    const [rtValue, setRtValue] = useState('');
    const [listening, setListening] = useState(false);
    async function testFirestore() {
        try {
            const user = await ensureAnonAuth();
            const id = `test_${user.uid}`;
            const refDoc = doc(db, 'dev_tests', id);
            const payload = { ping: Math.random().toString(36).slice(2), at: Date.now(), ts: serverTimestamp() };
            const start = performance.now();
            await setDoc(refDoc, payload, { merge: true });
            const snap = await getDoc(refDoc);
            if (snap.exists())
                setFsValue(JSON.stringify(snap.data()));
            setFsLatency(performance.now() - start);
        }
        catch (e) {
            console.warn('[db-test] firestore error', e);
        }
    }
    async function testRTDB() {
        try {
            const user = await ensureAnonAuth();
            const id = `test_${user.uid}`;
            const r = ref(rtdb, `dev_tests/${id}`);
            const payload = { ping: Math.random().toString(36).slice(2), at: Date.now() };
            const start = performance.now();
            await set(r, payload);
            const snap = await get(r);
            if (snap.exists())
                setRtValue(JSON.stringify(snap.val()));
            setRtLatency(performance.now() - start);
        }
        catch (e) {
            console.warn('[db-test] rtdb error', e);
        }
    }
    useEffect(() => {
        if (listening)
            return; // avoid duplicate
        (async () => {
            try {
                const user = await ensureAnonAuth();
                const id = `test_${user.uid}`;
                const r = ref(rtdb, `dev_tests/${id}`);
                onValue(r, snap => {
                    if (snap.exists())
                        setRtValue(JSON.stringify(snap.val()));
                });
                setListening(true);
            }
            catch { }
        })();
    }, [listening]);
    return (_jsxs("div", { style: { position: 'absolute', bottom: 12, left: 12, background: 'rgba(15,18,24,0.9)', color: '#fff', padding: '10px 14px', borderRadius: 12, width: 300, fontFamily: 'system-ui, sans-serif', fontSize: 12, lineHeight: 1.4, zIndex: 40 }, children: [_jsx("div", { style: { fontWeight: 600, marginBottom: 6 }, children: "Database Test" }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }, children: [_jsx("button", { onClick: testFirestore, style: btnStyle, children: "Firestore Ping" }), _jsx("button", { onClick: testRTDB, style: btnStyle, children: "RTDB Ping" })] }), _jsxs("div", { children: ["FS Latency: ", fsLatency ? fsLatency.toFixed(1) + 'ms' : '—'] }), _jsxs("div", { children: ["RT Latency: ", rtLatency ? rtLatency.toFixed(1) + 'ms' : '—'] }), _jsxs("div", { style: { marginTop: 6, maxHeight: 90, overflow: 'auto', background: '#000/20', padding: 4, fontFamily: 'monospace', fontSize: 11 }, children: [_jsxs("div", { children: [_jsx("strong", { children: "FS:" }), " ", fsValue || '—'] }), _jsxs("div", { children: [_jsx("strong", { children: "RT:" }), " ", rtValue || '—'] })] })] }));
};
const btnStyle = { background: '#3b82f6', border: 'none', color: '#fff', padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500 };
export default DatabaseTestPanel;
