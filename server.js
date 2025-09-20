// Minimal snapshot + signaling + (placeholder) auth server
import 'dotenv/config'; // Loads .env if present
import dotenv from 'dotenv';
import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { promisify } from 'util';
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import { initializeApp as initAdminApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const gzip = promisify(zlib.gzip);

// Config precedence: explicit process.env overrides .env file.
const PORT = process.env.PORT || 1002;
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
const INVITE_DIR = path.join(process.cwd(), 'invites');
await fs.mkdir(INVITE_DIR, { recursive: true });

// Optional Firestore for invite storage
const INVITES_STORAGE = process.env.INVITES_STORAGE || 'fs'; // 'fs' | 'firestore'
let firestore = null;
if (INVITES_STORAGE === 'firestore') {
  try {
    if(!getApps().length){
      const svcB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
      if (svcB64) {
        const json = JSON.parse(Buffer.from(svcB64, 'base64').toString('utf8'));
        initAdminApp({ credential: cert(json) });
      } else {
        initAdminApp({ credential: applicationDefault() });
      }
    }
    firestore = getFirestore();
    console.log('[invites] Firestore storage enabled');
  } catch(e){
    console.warn('[invites] Firestore init failed; falling back to fs', e?.message || e);
    firestore = null;
  }
}

// Optional push (FCM) using firebase-admin messaging (reuse app init above if present)
let messaging = null;
if (process.env.ENABLE_PUSH === 'true') {
  try {
    // Ensure an admin app exists (may have been created above or create minimal default)
    if(!getApps().length){
      const svcB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
      if (svcB64) {
        const json = JSON.parse(Buffer.from(svcB64, 'base64').toString('utf8'));
        initAdminApp({ credential: cert(json) });
      } else {
        initAdminApp({ credential: applicationDefault() });
      }
    }
    // Dynamic import to avoid cost when not enabled
    const mod = await import('firebase-admin/messaging');
    messaging = mod.getMessaging();
    console.log('[push] FCM messaging enabled');
  } catch(e){
    console.warn('[push] init failed', e?.message||e);
  }
}

async function invitesSave(invite){
  if (firestore) {
    await firestore.collection('invites').doc(invite.code).set(invite, { merge: true });
  } else {
    await fs.writeFile(path.join(INVITE_DIR, invite.code + '.json'), JSON.stringify(invite,null,2));
  }
}
async function invitesGet(code){
  if (firestore) {
    const snap = await firestore.collection('invites').doc(code).get();
    return snap.exists ? snap.data() : null;
  } else {
    const file = path.join(INVITE_DIR, code + '.json');
    const raw = await fs.readFile(file, 'utf8').catch(()=>null);
    return raw ? JSON.parse(raw) : null;
  }
}
async function invitesAccept(code, userId){
  const existing = await invitesGet(code);
  if(!existing) return { error:'not_found' };
  if(existing.acceptedAt) return { error:'already_accepted', invite: existing };
  const updated = { ...existing, acceptedAt: Date.now(), acceptedBy: userId };
  await invitesSave(updated);
  return { invite: updated };
}

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
    if(!data) {
      console.log('[profile:get] miss', { userId: req.userId });
      return res.json({ ok:true, profile:null });
    }
    console.log('[profile:get] hit', { userId: req.userId });
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
    try {
      const summary = {
        hasLoadout: Boolean(incoming && typeof incoming.loadout === 'object'),
        hasSkills: Boolean(incoming && typeof incoming.skills === 'object'),
        keys: Object.keys(incoming || {}).slice(0, 8)
      };
      console.log('[profile:put] saved', { userId: req.userId, ...summary });
    } catch {}
    res.json({ ok:true, profile: merged });
  } catch(e){
    console.error('profile_write_failed', e);
    res.status(500).json({ error:'profile_write_failed' });
  }
});

// Register push token (FCM). Body: { token }
app.post('/push/register', requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if(!token || typeof token !== 'string' || token.length < 20){
      return res.status(400).json({ ok:false, error:'invalid_token' });
    }
    const file = path.join(PROFILE_DIR, req.userId + '.json');
    const existingRaw = await fs.readFile(file, 'utf8').catch(()=>null);
    const existing = existingRaw ? JSON.parse(existingRaw) : { userId: req.userId };
    const list = Array.isArray(existing.pushTokens) ? existing.pushTokens : [];
    if(!list.includes(token)){
      list.unshift(token);
    }
    // Cap to last 10 tokens
    const trimmed = list.slice(0,10);
    const updated = { ...existing, pushTokens: trimmed, updatedAt: Date.now() };
    await fs.writeFile(file, JSON.stringify(updated, null, 2));
    res.json({ ok:true, count: trimmed.length });
  } catch(e){
    console.error('[push:register] failed', e?.message||e);
    res.status(500).json({ ok:false, error:'push_register_failed' });
  }
});

// -------- Invites --------
// POST /invites { email, message? } -> creates invite code and attempts to email friend.
// Stores invites as JSON files: invites/<code>.json { code, fromUserId, toEmail, message, createdAt }
// Environment for email (all optional; if missing we just log):
//  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE ("true"/"false"), SMTP_FROM
function createCode(){ return Math.random().toString(36).slice(2,10); }
let transporter = null;
function getTransport(){
  if(transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if(!SMTP_HOST || !SMTP_PORT){ return null; }
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(String(SMTP_PORT),10) || 587,
      secure: SMTP_SECURE === 'true',
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  } catch(e){ console.warn('[invite] transporter create failed', e?.message||e); }
  return transporter;
}

// Dedup helper: find existing pending invite from same user to same normalized email
async function findExistingPendingInvite(fromUserId, email){
  const normEmail = String(email).trim().toLowerCase();
  try {
    if (firestore) {
      const snap = await firestore.collection('invites')
        .where('fromUserId','==', fromUserId)
        .where('toEmailLower','==', normEmail)
        .limit(1)
        .get();
      const doc = snap.docs.find(d => !d.data().acceptedAt);
      return doc ? doc.data() : null;
    } else {
      const files = await fs.readdir(INVITE_DIR).catch(()=>[]);
      for (const f of files) {
        if(!f.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(path.join(INVITE_DIR, f), 'utf8');
          const inv = JSON.parse(raw);
          if(inv.fromUserId === fromUserId && !inv.acceptedAt && String(inv.toEmail).trim().toLowerCase() === normEmail){
            return inv;
          }
        } catch {}
      }
    }
  } catch(e){ console.warn('[invite:dedup] scan failed', e?.message||e); }
  return null;
}

app.post('/invites', requireAuth, async (req, res) => {
  try {
    const { email, message } = req.body || {};
    if(!email || typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
      return res.status(400).json({ ok:false, error:'invalid_email' });
    }
    const normEmail = email.trim().toLowerCase();
    const existing = await findExistingPendingInvite(req.userId, normEmail);
    if(existing){
      return res.json({ ok:true, code: existing.code, emailed: false, dedup: true });
    }
    const code = createCode();
    const invite = { code, fromUserId: req.userId, toEmail: email, toEmailLower: normEmail, message: (message||'').slice(0,500), createdAt: Date.now() };
  await invitesSave(invite);
    let sent = false; let sendError = null;
    const transport = getTransport();
    if(transport){
      try {
        const from = process.env.SMTP_FROM || 'Afro Future <no-reply@afro-future.app>';
        const shareUrl = `${req.protocol}://${req.get('host')}/?invite=${encodeURIComponent(code)}`;
        const body = `${invite.message ? invite.message + '\n\n' : ''}Join me in Afro-Future Rising! Use this link to jump in: ${shareUrl}`;
        await transport.sendMail({ from, to: email, subject: 'Afro-Future Invitation', text: body });
        sent = true;
      } catch(e){ sendError = e?.message || String(e); console.warn('[invite] send failed', sendError); }
    } else {
      console.log('[invite] email transport not configured; skipping send');
    }
    // Attempt push notification to recipient profile(s) if we can locate by email
    if(process.env.ENABLE_PUSH === 'true' && messaging && normEmail){
      try {
        // Linear scan of profile directory (acceptable for small scale; replace with Firestore query if/when profiles in Firestore)
        const profFiles = await fs.readdir(PROFILE_DIR).catch(()=>[]);
        for (const pf of profFiles){
          if(!pf.endsWith('.json')) continue;
          try {
            const raw = await fs.readFile(path.join(PROFILE_DIR, pf), 'utf8');
            const p = JSON.parse(raw);
            if(p.email && String(p.email).trim().toLowerCase() === normEmail && Array.isArray(p.pushTokens) && p.pushTokens.length){
              const tokens = p.pushTokens.slice(0,5); // limit fanout
              const body = invite.message ? invite.message : 'You have a new Afro-Future invite!';
              await messaging.sendEachForMulticast({ tokens, notification: { title: 'New Invite', body }, data: { code: invite.code, type: 'invite' } });
              console.log('[push] invite notification dispatched', { tokens: tokens.length });
              break;
            }
          } catch {}
        }
      } catch(e){ console.warn('[push] dispatch failed', e?.message||e); }
    }
    res.json({ ok:true, code, emailed: sent, sendError });
  } catch(e){
    console.error('[invite] failed', e);
    res.status(500).json({ ok:false, error:'invite_failed' });
  }
});

// Validate / fetch invite (public - no auth required, only exposes minimal data)
app.get('/invites/:code', async (req, res) => {
  try {
    const { code } = req.params;
    if(!code || !/^[a-z0-9]{4,32}$/i.test(code)) return res.status(400).json({ ok:false, error:'invalid_code' });
  const invite = await invitesGet(code);
  if(!invite) return res.status(404).json({ ok:false, error:'not_found' });
  res.json({ ok:true, code: invite.code, fromUserId: invite.fromUserId, createdAt: invite.createdAt, acceptedAt: invite.acceptedAt || null });
  } catch(e){
    console.error('[invite:get] failed', e);
    res.status(500).json({ ok:false, error:'invite_lookup_failed' });
  }
});

// Accept invite (requires auth)
app.post('/invites/:code/accept', requireAuth, async (req, res) => {
  try {
    const { code } = req.params;
    if(!code || !/^[a-z0-9]{4,32}$/i.test(code)) return res.status(400).json({ ok:false, error:'invalid_code' });
    const { error, invite } = await invitesAccept(code, req.userId);
    if(error === 'not_found') return res.status(404).json({ ok:false, error });
    if(error === 'already_accepted') return res.status(409).json({ ok:false, error, acceptedAt: invite.acceptedAt, acceptedBy: invite.acceptedBy });
    res.json({ ok:true, code: invite.code, acceptedAt: invite.acceptedAt, acceptedBy: invite.acceptedBy });
  } catch(e){
    console.error('[invite:accept] failed', e);
    res.status(500).json({ ok:false, error:'accept_failed' });
  }
});

// OG image PNG passthrough
const OG_IMG_DIR = path.join(process.cwd(), 'public', 'assets', 'img');
function isSafePng(name){ return /^[A-Za-z0-9_\-]+\.png$/.test(name); }
app.get('/og/share', async (req, res) => {
  try {
    const portrait = String(req.query.portrait || '');
    if(!portrait || !isSafePng(portrait)) return res.status(400).send('invalid');
    const file = path.join(OG_IMG_DIR, portrait);
    const data = await fs.readFile(file).catch(()=>null);
    if(!data) return res.status(404).send('not found');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public,max-age=3600,immutable');
    res.send(data);
  } catch(e){ res.status(500).send('error'); }
});

// Branded OG card composition: /og/card?portrait=<file.png>&faction=FactionName&name=Hero
// Uses sharp if available; falls back to simple portrait passthrough
app.get('/og/card', async (req, res) => {
  try {
    const portrait = String(req.query.portrait || '');
    const faction = String(req.query.faction || '');
    const heroName = String(req.query.name || 'Hero');
    if(!portrait || !isSafePng(portrait)) return res.status(400).send('invalid');
    const portraitFile = path.join(OG_IMG_DIR, portrait);
    const portraitBuf = await fs.readFile(portraitFile).catch(()=>null);
    if(!portraitBuf) return res.status(404).send('not found');
    let sharpMod = null;
    try { sharpMod = await import('sharp'); } catch {}
    if(!sharpMod){
      res.setHeader('Content-Type', 'image/png');
      return res.send(portraitBuf);
    }
    const sharp = sharpMod.default;
    // Base card 1200x630 (OG standard)
    const width = 1200; const height = 630;
    const padding = 40;
    // Resize portrait to fit square zone
    const portSize = 400;
    const portraitResized = await sharp(portraitBuf).resize(portSize, portSize, { fit:'cover' }).png().toBuffer();
    // Simple gradient background
    const bg = await sharp({ create: { width, height, channels:4, background: { r:16,g:22,b:30,alpha:1 } } })
      .composite([
        { input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#062b25"/><stop offset="100%" stop-color="#11263b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`), top:0, left:0 }
      ])
      .png().toBuffer();
    const composites = [
      { input: portraitResized, top: Math.round((height-portSize)/2), left: padding }
    ];
    // Text overlay via SVG (faction + hero name)
    const titleSvg = `<svg width="${width-portSize-padding*3}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n  <style> .title { fill: #e2f8f0; font-size:72px; font-family: 'Segoe UI', 'Arial', sans-serif; font-weight:700; } .sub { fill:#7dd3fc; font-size:36px; font-weight:500; } </style>\n  <text x="20" y="210" class="sub">${faction.replace(/</g,'&lt;')}</text>\n  <text x="20" y="300" class="title">${heroName.slice(0,28).replace(/</g,'&lt;')}</text>\n  <text x="20" y="380" class="sub">Afro‑Future Rising</text>\n</svg>`;
    composites.push({ input: Buffer.from(titleSvg), top:0, left: portSize + padding*2 });
    const final = await sharp(bg).composite(composites).png().toBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public,max-age=600');
    res.send(final);
  } catch(e){
    console.warn('[og:card] failed', e?.message||e);
    res.status(500).send('error');
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
const SF_FALLBACK_VERSIONS = [SF_API_VERSION, '2025-04', '2025-01', '2024-10'].filter((v, i, a) => v && a.indexOf(v) === i);

async function storefrontRequest({ query, variables, version }){
  const endpoint = `https://${SF_DOMAIN}/api/${version}/graphql.json`;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SF_TOKEN,
      'Accept': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });
  const text = await r.text().catch(()=> '');
  let json = null; try { json = JSON.parse(text); } catch {}
  return { r, text, json, endpoint };
}

// -------- Runtime configuration endpoint --------
// Provides non-sensitive runtime values so client builds can be domain-agnostic
app.get('/runtime-config', (req, res) => {
  res.json({
    ok: true,
    storeDomain: SF_DOMAIN || null,
    apiVersion: SF_API_VERSION,
    debug: process.env.VITE_SHOPIFY_DEBUG === 'true',
    buildHash: process.env.BUILD_HASH || null,
    time: Date.now()
  });
});

// -------- Storefront token verification (lightweight) --------
// Uses a minimal query to validate token early; excluded if not configured
app.get('/storefront/ping', async (req, res) => {
  const started = Date.now();
  try {
    if (!SF_DOMAIN || !SF_TOKEN) {
      return res.status(501).json({ ok:false, error: 'storefront_not_configured' });
    }
    if (SF_TOKEN.startsWith('shpat_')) {
      return res.status(400).json({ ok:false, error: 'invalid_token_type', message: 'Admin token provided. Use Storefront public token.' });
    }
    const query = 'query ShopName { shop { name } }';
    let lastErr = null;
    for (const ver of SF_FALLBACK_VERSIONS) {
      const { r, text, json, endpoint } = await storefrontRequest({ query, variables: undefined, version: ver });
      if (!r.ok) {
        lastErr = { status: r.status, text, endpoint, version: ver };
        if (r.status === 404) continue; // try next version
        try { const j = JSON.parse(text); if (Array.isArray(j?.errors) && j.errors.some(e=> e?.extensions?.code === 'NOT_FOUND')) continue; } catch {}
        break;
      }
      if (json?.errors) {
        return res.status(200).json({ ok:false, error: 'graphql_errors', errors: json.errors, ms: Date.now()-started, version: ver });
      }
      const name = json?.data?.shop?.name || null;
      return res.json({ ok:true, shopName: name, ms: Date.now()-started, version: ver });
    }
    return res.status(502).json({ ok:false, error: 'storefront_bad_gateway', status: lastErr?.status || 502, snippet: (lastErr?.text||'').slice(0,200), endpoint: lastErr?.endpoint, attemptedVersions: SF_FALLBACK_VERSIONS });
  } catch (e) {
    console.error('[storefront-ping] failed', e?.message || e);
    res.status(500).json({ ok:false, error: 'storefront_ping_failed' });
  }
});

app.get('/storefront/products', async (req, res) => {
  const started = Date.now();
  try {
    if (!SF_DOMAIN || !SF_TOKEN) {
      return res.status(501).json({ error: 'storefront_not_configured' });
    }
    if (SF_TOKEN.startsWith('shpat_')) {
      return res.status(400).json({ error: 'invalid_token_type', message: 'Admin token provided. Use Storefront public token.' });
    }
    const limit = Math.min(parseInt(String(req.query.limit || '12'), 10) || 12, 50);
    const query = `#graphql\nquery Products($first:Int!){\n  products(first:$first){ edges { node { id handle title description images(first:4){edges{node{url altText}}} variants(first:4){edges{node{id title price: priceV2 { amount currencyCode }}}} } } }\n}`;
    let lastErr = null;
    for (const ver of SF_FALLBACK_VERSIONS) {
      console.log('[storefront-proxy] request', { limit, version: ver, tokenPrefix: SF_TOKEN.slice(0,4)+'…' });
      const { r, text, json, endpoint } = await storefrontRequest({ query, variables: { first: limit }, version: ver });
      if (!r.ok) {
        console.warn('[storefront-proxy] upstream non-OK', { version: ver, status: r.status, statusText: r.statusText, snippet: text.slice(0,180) });
        lastErr = { status: r.status, body: text, endpoint, version: ver };
        if (r.status === 404) continue;
        try { const j = JSON.parse(text); if (Array.isArray(j?.errors) && j.errors.some(e=> e?.extensions?.code === 'NOT_FOUND')) continue; } catch {}
        break;
      }
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
      console.log('[storefront-proxy] success', { count: products.length, ms: Date.now()-started, version: ver });
      return res.json({ ok: true, products, ms: Date.now()-started, version: ver });
    }
    const out = { error: 'storefront_bad_gateway', status: lastErr?.status || 502, body: (lastErr?.body || '').slice(0,512), endpoint: lastErr?.endpoint, attemptedVersions: SF_FALLBACK_VERSIONS };
    return res.status(502).json(out);
  } catch (e) {
    console.error('[storefront-proxy] failed', { error: e?.message || e, ms: Date.now()-started });
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

// Explicitly bind to all interfaces (0.0.0.0) to avoid cases where binding only to IPv6/localhost
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP listening on :${PORT}`);
  try {
    import('os').then(os => {
      const ifaces = Object.values(os.networkInterfaces() || {}).flat().filter(Boolean);
      const addrs = ifaces.map(i=>i.address).filter(a=>!a.includes('%'));
      console.log('[listen:addrs]', addrs.slice(0,6).join(', '), addrs.length>6?`(+${addrs.length-6} more)`:'' );
    }).catch(()=>{});
  } catch {}
});
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/signal') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// Static serving for production build (after APIs and upgrade handlers are set)
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dist = path.join(__dirname, 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  console.log('[static] serving dist from', dist);
} catch (e) {
  console.warn('[static] setup failed', e?.message || e);
}
