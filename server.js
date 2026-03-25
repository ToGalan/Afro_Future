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
const PORT = process.env.PORT || 1003;
const SNAP_DIR = path.join(process.cwd(), 'snapshots');
const PROFILE_DIR = path.join(process.cwd(), 'profiles');

// Also load .env.local if present to pick up VITE_* vars used by client
try { dotenv.config({ path: path.join(process.cwd(), '.env.local') }); } catch {}

const app = express();
// ---- CORS tightening ----
// Allowed origins can be provided as comma-separated list in ALLOWED_ORIGINS, otherwise default to localhost dev origins.
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:1002',
  'http://127.0.0.1:1002'
];
const allowedOriginEnv = process.env.ALLOWED_ORIGINS || '';
const ALLOWED_ORIGINS = allowedOriginEnv
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
const ORIGIN_ALLOW_LIST = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_ORIGINS;
app.use(cors({
  origin: function(origin, cb){
    if(!origin) return cb(null, true); // non-browser or same-origin
    if(ORIGIN_ALLOW_LIST.includes(origin)) return cb(null, true);
    return cb(new Error('CORS_NOT_ALLOWED:'+origin));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' }));

// Lazy create snapshot dir
await fs.mkdir(SNAP_DIR, { recursive: true });
await fs.mkdir(PROFILE_DIR, { recursive: true });
const INVITE_DIR = path.join(process.cwd(), 'invites');
await fs.mkdir(INVITE_DIR, { recursive: true });

// Storage modes & shard reward config
const INVITES_STORAGE = process.env.INVITES_STORAGE || 'fs'; // 'fs' | 'firestore'
const PROFILE_STORAGE = process.env.PROFILE_STORAGE || 'fs'; // 'fs' | 'firestore'
const SHARDS_INVITE_REWARD = parseInt(process.env.SHARDS_INVITE_REWARD || '50',10);
const SHARDS_ACCEPT_REWARD = parseInt(process.env.SHARDS_ACCEPT_REWARD || '25',10);
// Map / Chunk config (deterministic generation placeholder)
const WORLD_WIDTH = parseInt(process.env.WORLD_WIDTH || '240', 10); // tiles (cols)
const WORLD_HEIGHT = parseInt(process.env.WORLD_HEIGHT || '240', 10); // tiles (rows)
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '32', 10);
const WORLD_SEED = parseInt(process.env.WORLD_SEED || '42', 10);
// Simple biome char set for stub (align loosely with existing chars)
const BIOME_CHARS = ['P','F','J','H','D','O','M','L'];
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}};
function tileCharFor(col,row){ // deterministic pseudo noise based on seed+coords
  const h = (WORLD_SEED ^ (col*73856093) ^ (row*19349663)) >>> 0;
  const rand = mulberry32(h)();
  // Weighted selection (plains more common)
  if (rand < 0.55) return 'P';
  if (rand < 0.66) return 'F';
  if (rand < 0.72) return 'J';
  if (rand < 0.81) return 'H';
  if (rand < 0.88) return 'D';
  if (rand < 0.93) return 'O';
  if (rand < 0.97) return 'M';
  return 'L';
}
const chunkCache = new Map(); // key -> { cx, cy, w, h, tiles, seed, version }
let firestore = null;
if (INVITES_STORAGE === 'firestore' || PROFILE_STORAGE === 'firestore' || process.env.ENABLE_PUSH === 'true') {
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
    console.log('[firestore] initialized');
  } catch(e){
    console.warn('[firestore] init failed; falling back to fs', e?.message || e);
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
async function profileGet(userId){
  if (PROFILE_STORAGE === 'firestore' && firestore){
    const snap = await firestore.collection('profiles').doc(userId).get();
    return snap.exists ? snap.data() : null;
  }
  const file = path.join(PROFILE_DIR, userId + '.json');
  const raw = await fs.readFile(file,'utf8').catch(()=>null);
  return raw ? JSON.parse(raw) : null;
}
async function profileSave(profile){
  const out = { ...profile, userId: profile.userId, updatedAt: Date.now() };
  if (out.email) out.emailLower = String(out.email).trim().toLowerCase();
  if (typeof out.shards !== 'number') out.shards = 0;
  if (PROFILE_STORAGE === 'firestore' && firestore){
    await firestore.collection('profiles').doc(out.userId).set(out, { merge: true });
  } else {
    const file = path.join(PROFILE_DIR, out.userId + '.json');
    await fs.writeFile(file, JSON.stringify(out,null,2));
  }
  return out;
}

async function invitesAccept(code, userId){
  const existing = await invitesGet(code);
  if(!existing) return { error:'not_found' };
  if(existing.acceptedAt) return { error:'already_accepted', invite: existing };
  const updated = { ...existing, acceptedAt: Date.now(), acceptedBy: userId };
  await invitesSave(updated);
  let inviterProfile=null, acceptorProfile=null;
  try {
    inviterProfile = await profileGet(existing.fromUserId) || { userId: existing.fromUserId, shards:0 };
    acceptorProfile = await profileGet(userId) || { userId, shards:0 };
    inviterProfile.shards = (inviterProfile.shards||0) + SHARDS_INVITE_REWARD;
    acceptorProfile.shards = (acceptorProfile.shards||0) + SHARDS_ACCEPT_REWARD;
    await profileSave(inviterProfile);
    await profileSave(acceptorProfile);
  } catch(e){ console.warn('[invite:reward] failed', e?.message||e); }
  return { invite: updated, inviterProfile, acceptorProfile };
}

// ---- Multi-strategy token verification ----
// 1) Firebase ID Token via firebase-admin/auth
// 2) Google OAuth ID token via google-auth-library (for direct Google One Tap if ever used)
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID || '';
const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

async function ensureAdminInitialized(){
  if(!getApps().length){
    const svcB64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
    try {
      if (svcB64) {
        const json = JSON.parse(Buffer.from(svcB64,'base64').toString('utf8'));
        initAdminApp({ credential: cert(json) });
      } else {
        initAdminApp({ credential: applicationDefault() });
      }
      console.log('[admin] initialized for token verification');
    } catch(e){
      console.warn('[admin] init failed - Firebase token verification unavailable', e?.message||e);
    }
  }
}

async function verifyFirebaseIdToken(idToken){
  try {
    await ensureAdminInitialized();
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(idToken, true); // throws if invalid/expired
    return decoded.uid || decoded.sub || null;
  } catch(e){
    if(process.env.DEBUG_AUTH === 'true') console.warn('[auth] firebase verify failed', e?.message||e);
    return null;
  }
}

async function verifyGoogleIdToken(idToken){
  if(!idToken || !oauthClient) return null;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    return payload?.sub || null;
  } catch(e){
    if(process.env.DEBUG_AUTH === 'true') console.warn('[auth] google verify failed', e?.message||e);
    return null;
  }
}

async function verifyAnyIdToken(idToken){
  if(!idToken) return null;
  // Strategy order: Firebase first (covers anonymous + providers), then Google fallback
  const firebaseUid = await verifyFirebaseIdToken(idToken);
  if(firebaseUid) return firebaseUid;
  return await verifyGoogleIdToken(idToken);
}

async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const userId = await verifyAnyIdToken(idToken);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    req.userId = userId;
    next();
  } catch (e) {
    console.error('Auth error', e?.message||e);
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

// (Legacy profile endpoints replaced above by abstraction; push register moved earlier if needed.)
// -------- Profile Endpoints (Firestore or FS via abstraction) --------
// GET /profile -> returns profile (creates minimal placeholder in memory if missing)
app.get('/profile', requireAuth, async (req, res) => {
  try {
    let profile = await profileGet(req.userId);
    if(!profile){
      profile = await profileSave({ userId: req.userId, shards:0 });
    }
    res.json({ ok:true, profile });
  } catch(e){
    console.error('[profile:get] failed', e?.message||e);
    res.status(500).json({ ok:false, error:'profile_get_failed' });
  }
});

// PUT /profile { name?, email?, faction?, portrait? }
app.put('/profile', requireAuth, async (req, res) => {
  try {
    const allowed = ['name','email','faction','portrait'];
    const incoming = req.body || {};
    let profile = await profileGet(req.userId) || { userId: req.userId, shards:0 };
    for (const k of allowed){
      if(Object.prototype.hasOwnProperty.call(incoming,k)){
        const val = incoming[k];
        if(val === null) continue;
        profile[k] = typeof val === 'string' ? val.slice(0,200) : val; // mild bound
      }
    }
    // Normalize emailLower if email changed
    if(profile.email) profile.emailLower = String(profile.email).trim().toLowerCase();
    profile = await profileSave(profile);
    res.json({ ok:true, profile });
  } catch(e){
    console.error('[profile:put] failed', e?.message||e);
    res.status(500).json({ ok:false, error:'profile_save_failed' });
  }
});

// Register push token (idempotent add to profile.pushTokens array)
app.post('/push/register', requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if(!token || typeof token !== 'string' || token.length < 10){
      return res.status(400).json({ ok:false, error:'invalid_token' });
    }
    let profile = await profileGet(req.userId) || { userId: req.userId, shards:0 };
    const tokens = Array.isArray(profile.pushTokens) ? profile.pushTokens.slice() : [];
    if(!tokens.includes(token)) tokens.push(token);
    profile.pushTokens = tokens.slice(0,25); // cap
    profile = await profileSave(profile);
    res.json({ ok:true, count: profile.pushTokens.length });
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
        // Attempt to fetch branded OG card (fallback to portrait image or skip if fails)
        let ogImageBuffer = null; let ogFilename = 'invite.png';
        try {
          const portrait = 'hero1.png'; // simple default; could be dynamic from inviter profile later
          const ogUrl = `${req.protocol}://${req.get('host')}/og/card?portrait=${encodeURIComponent(portrait)}&faction=${encodeURIComponent('Vanguard')}&name=${encodeURIComponent('Ally')}`;
          const r = await fetch(ogUrl).catch(()=>null);
          if(r && r.ok){
            const arr = await r.arrayBuffer();
            ogImageBuffer = Buffer.from(arr);
          }
        } catch {}
        const plainText = `${invite.message ? invite.message + '\n\n' : ''}Join me in Afro-Future Rising! Use this link to accept: ${shareUrl}`;
        const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#0f1720;color:#e2f8f0;padding:16px;">
  <h2 style="margin-top:0;">Afro‑Future Rising Invitation</h2>
  ${invite.message ? `<p style="white-space:pre-line;">${invite.message.replace(/</g,'&lt;')}</p>`:''}
  <p><strong>Click to join:</strong> <a style="color:#7dd3fc;" href="${shareUrl}">Accept Invite</a></p>
  ${ogImageBuffer ? '<p><img src="cid:ogcard" alt="Invitation" style="max-width:100%;border:1px solid #1e2938;border-radius:8px;" /></p>' : ''}
  <p style="font-size:12px;color:#94a3b8;">If the button doesn\'t work copy this code: ${invite.code}</p>
</body></html>`;
        const mail = { from, to: email, subject: 'Afro-Future Invitation', text: plainText, html };
        if(ogImageBuffer){
          mail.attachments = [{ filename: ogFilename, content: ogImageBuffer, cid: 'ogcard' }];
        }
        await transport.sendMail(mail);
        sent = true;
      } catch(e){ sendError = e?.message || String(e); console.warn('[invite] send failed', sendError); }
    } else {
      console.log('[invite] email transport not configured; skipping send');
    }
    // Attempt push notification to recipient profile(s) if we can locate by email
    if(process.env.ENABLE_PUSH === 'true' && messaging && normEmail){
      try {
        if(PROFILE_STORAGE === 'firestore' && firestore){
          const snap = await firestore.collection('profiles').where('emailLower','==', normEmail).limit(3).get();
          for (const doc of snap.docs){
            const p = doc.data();
            if(Array.isArray(p.pushTokens) && p.pushTokens.length){
              const tokens = p.pushTokens.slice(0,5);
              const body = invite.message ? invite.message : 'You have a new Afro-Future invite!';
              await messaging.sendEachForMulticast({ tokens, notification: { title: 'New Invite', body }, data: { code: invite.code, type: 'invite' } });
              console.log('[push] invite notification dispatched', { tokens: tokens.length, firestore:true });
              break;
            }
          }
        } else {
          // Filesystem fallback
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
                console.log('[push] invite notification dispatched', { tokens: tokens.length, firestore:false });
                break;
              }
            } catch {}
          }
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
    const { error, invite, inviterProfile, acceptorProfile } = await invitesAccept(code, req.userId);
    if(error === 'not_found') return res.status(404).json({ ok:false, error });
    if(error === 'already_accepted') return res.status(409).json({ ok:false, error, acceptedAt: invite.acceptedAt, acceptedBy: invite.acceptedBy });
    res.json({
      ok:true,
      code: invite.code,
      acceptedAt: invite.acceptedAt,
      acceptedBy: invite.acceptedBy,
      rewardInviter: SHARDS_INVITE_REWARD,
      rewardAcceptor: SHARDS_ACCEPT_REWARD,
      inviter: inviterProfile ? { userId: inviterProfile.userId, shards: inviterProfile.shards } : null,
      acceptor: acceptorProfile ? { userId: acceptorProfile.userId, shards: acceptorProfile.shards } : null
    });
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

// -------- Dynamic OG meta page for character / invite sharing --------
// Usage: /share-meta?name=<HeroName>&faction=<Faction>&portrait=<pngFile>&invite=<code>
// Returns a minimal HTML document with Open Graph + Twitter card tags.
// Social platforms will scrape this URL. Front-end can redirect users to application after load.
app.get('/share-meta', async (req, res) => {
  try {
    const rawName = String(req.query.name || 'Hero').slice(0,50);
    const name = rawName.replace(/</g,'&lt;');
    const rawFaction = String(req.query.faction || 'Faction').slice(0,40);
    const faction = rawFaction.replace(/</g,'&lt;');
    const invite = String(req.query.invite || '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,48);
    const portraitParam = String(req.query.portrait || '').replace(/[^A-Za-z0-9_\-.]/g,'');
    const safePortrait = /^[A-Za-z0-9_\-]+\.png$/.test(portraitParam) ? portraitParam : '';
    const origin = `${req.protocol}://${req.get('host')}`;
    const cardImage = safePortrait ? `${origin}/assets/img/${safePortrait}` : `${origin}/assets/img/default.png`;
    const appUrlParams = new URLSearchParams();
    if(invite) appUrlParams.set('invite', invite);
    if(safePortrait) appUrlParams.set('portrait', safePortrait);
    appUrlParams.set('faction', rawFaction);
    appUrlParams.set('name', rawName);
    const appUrl = `${origin}/?share=${encodeURIComponent(appUrlParams.toString())}`;
    const title = `Afro-Future Hero: ${rawName}`;
    const description = `Join ${rawName} of faction ${rawFaction} in Afro‑Future Rising. Forge your legend.`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8" />
<title>${title.replace(/</g,'&lt;')}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="description" content="${description.replace(/"/g,'&quot;')}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Afro-Future Rising" />
<meta property="og:title" content="${title.replace(/"/g,'&quot;')}" />
<meta property="og:description" content="${description.replace(/"/g,'&quot;')}" />
<meta property="og:image" content="${cardImage}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:alt" content="Portrait of hero ${name}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title.replace(/"/g,'&quot;')}" />
<meta name="twitter:description" content="${description.replace(/"/g,'&quot;')}" />
<meta name="twitter:image" content="${cardImage}" />
<link rel="canonical" href="${appUrl}" />
<meta http-equiv="refresh" content="0;url=${appUrl}" />
<style>body{background:#0f1720;color:#e2f8f0;font-family:system-ui,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;}a{color:#7dd3fc}</style>
</head><body>
<div>
  <h1 style="margin:0 0 12px;font-size:28px;">${name}</h1>
  <p style="margin:0 0 16px;font-size:14px;opacity:.85;">${faction}</p>
  <p>Redirecting to experience… If it doesn't, <a href="${appUrl}">click here</a>.</p>
</div>
</body></html>`);
  } catch(e){
    console.warn('[share-meta] failed', e?.message||e);
    res.status(500).send('error');
  }
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

// -------- Map Chunk API (deterministic stub) --------
app.get('/api/map/chunk', async (req, res) => {
  try {
    const cx = parseInt(String(req.query.cx||'0'),10);
    const cy = parseInt(String(req.query.cy||'0'),10);
    if (Number.isNaN(cx) || Number.isNaN(cy)) return res.status(400).json({ error:'bad_params' });
    const maxCx = Math.ceil(WORLD_WIDTH / CHUNK_SIZE) - 1;
    const maxCy = Math.ceil(WORLD_HEIGHT / CHUNK_SIZE) - 1;
    if (cx < 0 || cy < 0 || cx > maxCx || cy > maxCy) return res.status(400).json({ error:'out_of_bounds', cx, cy, maxCx, maxCy });
    const key = cx+':'+cy;
    if (chunkCache.has(key)) {
      return res.json(chunkCache.get(key));
    }
    const startCol = cx * CHUNK_SIZE;
    const startRow = cy * CHUNK_SIZE;
    const w = Math.min(CHUNK_SIZE, WORLD_WIDTH - startCol);
    const h = Math.min(CHUNK_SIZE, WORLD_HEIGHT - startRow);
    const tiles = [];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const col = startCol + c;
        const row = startRow + r;
        const char = tileCharFor(col, row);
        // Resource stub (rare energy crystal on some plains) – placeholder
        let resource = null;
        if (char === 'P') {
          const h = (WORLD_SEED ^ (col*92837111) ^ (row*689287499)) >>> 0;
            if ((h & 0xFFF) === 0xABC) resource = 'energy';
        }
        tiles.push({ col, row, char, resource });
      }
    }
    const payload = { cx, cy, w, h, tiles, seed: WORLD_SEED, version:1 };
    chunkCache.set(key, payload);
    // Basic cache control (world static for this stub)
    res.setHeader('Cache-Control','public, max-age=300, immutable');
    return res.json(payload);
  } catch (e) {
    console.error('[chunk] error', e?.message||e);
    return res.status(500).json({ error:'chunk_internal' });
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
