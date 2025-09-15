// Minimal snapshot + signaling + (placeholder) auth server
import 'dotenv/config'; // Loads .env if present
import dotenv from 'dotenv';
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
const PROFILE_DIR = path.join(process.cwd(), 'profiles');

// Also load .env.local if present to pick up VITE_* vars used by client
try { dotenv.config({ path: path.join(process.cwd(), '.env.local') }); } catch {}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

// Lazy create snapshot dir
await fs.mkdir(SNAP_DIR, { recursive: true });
await fs.mkdir(PROFILE_DIR, { recursive: true });

// Real Google ID token verification using google-auth-library (single source: VITE_GOOGLE_CLIENT_ID)
const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID || '';
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

// -------- Profile (basic JSON persistence) --------
// Shape: { userId, name?, email?, picture?, loadout? }
app.get('/profile', requireAuth, async (req, res) => {
  try {
    const file = path.join(PROFILE_DIR, req.userId + '.json');
    const data = await fs.readFile(file, 'utf8').catch(()=>null);
    if(!data) return res.json({ ok:true, profile:null });
    res.json({ ok:true, profile: JSON.parse(data) });
  } catch(e){
    res.status(500).json({ error:'profile_read_failed' });
  }
});

app.put('/profile', requireAuth, async (req, res) => {
  try {
    const incoming = req.body || {};
    const file = path.join(PROFILE_DIR, req.userId + '.json');
    const existingRaw = await fs.readFile(file, 'utf8').catch(()=>null);
    const existing = existingRaw ? JSON.parse(existingRaw) : { userId: req.userId };
    const merged = { ...existing, ...incoming, userId: req.userId, updatedAt: Date.now() };
    await fs.writeFile(file, JSON.stringify(merged, null, 2));
    res.json({ ok:true, profile: merged });
  } catch(e){
    console.error('profile_write_failed', e);
    res.status(500).json({ error:'profile_write_failed' });
  }
});

// -------- Shopify Admin REST proxy (server-side only) --------
// Env: SHOPIFY_ADMIN_STORE_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN, optional SHOPIFY_API_VERSION
const SHOP_DOMAIN = process.env.SHOPIFY_ADMIN_STORE_DOMAIN || process.env.VITE_SHOPIFY_STORE_DOMAIN || '';
const SHOP_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const SHOP_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

app.get('/admin/products', requireAuth, async (req, res) => {
  try {
    if (!SHOP_DOMAIN || !SHOP_TOKEN) {
      return res.status(501).json({ error: 'shopify_admin_not_configured' });
    }
    const limit = Math.min(parseInt(String(req.query.limit || '12'), 10) || 12, 50);
    const endpoint = `https://${SHOP_DOMAIN}/admin/api/${SHOP_API_VERSION}/products.json?limit=${limit}`;
    const r = await fetch(endpoint, { headers: { 'X-Shopify-Access-Token': SHOP_TOKEN } });
    if (!r.ok) {
      const text = await r.text().catch(()=> '');
      return res.status(502).json({ error: 'shopify_admin_bad_gateway', status: r.status, body: text.slice(0, 512) });
    }
    const json = await r.json();
    const products = (json.products || []).map(p => ({
      id: String(p.id),
      handle: p.handle,
      title: p.title,
      description: p.body_html || '',
      images: (p.images || []).slice(0,4).map(img => ({ url: img.src, altText: img.alt })) ,
      variants: (p.variants || []).slice(0,4).map(v => ({ id: String(v.id), title: v.title, price: { amount: String(v.price ?? ''), currencyCode: undefined } })),
    }));
    res.json({ ok: true, products });
  } catch (e) {
    console.error('shopify_admin_proxy_failed', e);
    res.status(500).json({ error: 'shopify_admin_proxy_failed' });
  }
});

// -------- Shopify Storefront proxy (bypass browser CORS) --------
// Env: VITE_SHOPIFY_STORE_DOMAIN, VITE_SHOPIFY_STOREFRONT_TOKEN, VITE_SHOPIFY_STOREFRONT_API_VERSION
const SF_DOMAIN = process.env.VITE_SHOPIFY_STORE_DOMAIN || '';
const SF_TOKEN = process.env.VITE_SHOPIFY_STOREFRONT_TOKEN || '';
const SF_API_VERSION = process.env.VITE_SHOPIFY_STOREFRONT_API_VERSION || '2025-07';

app.get('/storefront/products', async (req, res) => {
  try {
    if (!SF_DOMAIN || !SF_TOKEN) {
      return res.status(501).json({ error: 'storefront_not_configured' });
    }
    if (SF_TOKEN.startsWith('shpat_')) {
      return res.status(400).json({ error: 'invalid_token_type', message: 'Admin token provided. Use Storefront public token.' });
    }
    const limit = Math.min(parseInt(String(req.query.limit || '12'), 10) || 12, 50);
    const endpoint = `https://${SF_DOMAIN}/api/${SF_API_VERSION}/graphql.json`;
    const query = `#graphql\nquery Products($first:Int!){\n  products(first:$first){ edges { node { id handle title description images(first:4){edges{node{url altText}}} variants(first:4){edges{node{id title price: priceV2 { amount currencyCode }}}} } } }\n}`;
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': SF_TOKEN,
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query, variables: { first: limit } })
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return res.status(502).json({ error: 'storefront_bad_gateway', status: r.status, body: body.slice(0, 512) });
    }
    const json = await r.json();
    const edges = Array.isArray(json?.data?.products?.edges) ? json.data.products.edges : [];
    const products = edges.map((e) => {
      const node = e?.node || {};
      const imageEdges = Array.isArray(node?.images?.edges) ? node.images.edges : [];
      const variantEdges = Array.isArray(node?.variants?.edges) ? node.variants.edges : [];
      const images = imageEdges.map((ie) => ({ url: ie?.node?.url || '', altText: ie?.node?.altText })).filter(i => i.url);
      const variants = variantEdges.map((ve) => ({
        id: String(ve?.node?.id || ''),
        title: ve?.node?.title || '',
        price: {
          amount: String(ve?.node?.price?.amount || ''),
          currencyCode: ve?.node?.price?.currencyCode || ''
        }
      })).filter(v => v.id);
      return {
        id: String(node?.id || ''),
        handle: node?.handle || '',
        title: node?.title || '',
        description: node?.description || '',
        images,
        variants
      };
    }).filter(p => p.id);
    res.json({ ok: true, products });
  } catch (e) {
    console.error('storefront_proxy_failed', e);
    res.status(500).json({ error: 'storefront_proxy_failed' });
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
