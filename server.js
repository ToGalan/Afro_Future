// Minimal snapshot + signaling + (placeholder) auth server
import 'dotenv/config'; // Loads .env if present
import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { OAuth2Client } from 'google-auth-library';
const gzip = promisify(zlib.gzip);

// Config precedence: explicit process.env overrides .env file.
const PORT = process.env.PORT || 8080;
const SNAP_DIR = path.join(process.cwd(), 'snapshots');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

// Lazy create snapshot dir
await fs.mkdir(SNAP_DIR, { recursive: true });

// Real Google ID token verification using google-auth-library
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
async function verifyGoogleIdToken(idToken) {
  if (!idToken || !oauthClient) return null;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    return payload?.sub || null;
  } catch (e) {
    console.warn('Token verify failed', e.message);
    return null;
  }
}

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const userId = await verifyGoogleIdToken(idToken);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    req.userId = userId;
    next();
  } catch (e) {
    console.error('Auth error', e);
    res.status(401).json({ error: 'auth_failed' });
  }
}

// Upload snapshot (binary; gzip if not already)
app.post('/snapshots/:world', requireAuth, async (req, res) => {
  try {
    const { world } = req.params;
    const now = Date.now();
    const worldDir = path.join(SNAP_DIR, world);
    await fs.mkdir(worldDir, { recursive: true });
    const filePath = path.join(worldDir, `${now}.yjs.gz`);
    const body = req.headers['content-encoding'] === 'gzip' ? req.body : await gzip(req.body);
    await fs.writeFile(filePath, body);
    await fs.writeFile(path.join(worldDir, 'latest.txt'), String(now));
    res.json({ ok: true, id: now });
  } catch (e) {
    console.error('snapshot save failed', e);
    res.status(500).json({ error: 'snapshot_save_failed' });
  }
});

// Get latest snapshot
app.get('/snapshots/:world/latest', requireAuth, async (req, res) => {
  const { world } = req.params;
  const worldDir = path.join(SNAP_DIR, world);
  let latest;
  try {
    latest = await fs.readFile(path.join(worldDir, 'latest.txt'), 'utf8');
  } catch {
    return res.status(404).json({ error: 'no_snapshot' });
  }
  try {
    const file = await fs.readFile(path.join(worldDir, `${latest}.yjs.gz`));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Encoding', 'gzip');
    res.send(file);
  } catch (e) {
    console.error('snapshot read failed', e);
    res.status(500).json({ error: 'snapshot_read_failed' });
  }
});

// ---------- WebSocket signaling ----------
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map(); // roomId -> Set(ws)

wss.on('connection', (ws) => {
  let roomId = null;
  let userId = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'join') {
      // Expect idToken for auth
      if (!msg.idToken) {
        ws.send(JSON.stringify({ type: 'error', code: 'auth_required' }));
        ws.close();
        return;
      }
      verifyGoogleIdToken(msg.idToken).then(validUser => {
        if(!validUser){
          ws.send(JSON.stringify({ type: 'error', code: 'auth_invalid' }));
          ws.close();
          return;
        }
        userId = validUser;
        roomId = msg.roomId;
        if (!rooms.has(roomId)) rooms.set(roomId, new Set());
        rooms.get(roomId).add(ws);
        ws.send(JSON.stringify({ type: 'joined', roomId, userId }));
      });
      roomId = msg.roomId;
      return;
    }
    if (roomId && ['offer','answer','ice'].includes(msg.type)) {
      for (const peer of rooms.get(roomId) || []) {
        if (peer !== ws && peer.readyState === 1) peer.send(JSON.stringify(msg));
      }
    }
  });
  ws.on('close', () => {
    if (roomId && rooms.has(roomId)) {
      rooms.get(roomId).delete(ws);
      if (!rooms.get(roomId).size) rooms.delete(roomId);
    }
  });
});

const server = app.listen(PORT, () => console.log(`HTTP listening on :${PORT}`));
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/signal') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
