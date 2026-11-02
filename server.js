require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SECRET = process.env.JWT_SECRET || 'dev-secret';
const BASE = process.env.PROVIDER_BASE_URL;
const KEY = process.env.PROVIDER_API_KEY;
const MAX_CREDITS = 100, REFRESH_MS = 4 * 60 * 60 * 1000;
const COST = { image: 5, video: 20 };

const DB_FILE = path.join(__dirname, 'data', 'db.json');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE)) : { users: {} };
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db));

const upload = multer({ dest: path.join(__dirname, 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });
const gClient = new OAuth2Client(CLIENT_ID);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---- tiny signed token ----
const sign = (p) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const verify = (t) => { const [b, s] = (t || '').split('.'); if (!b || !s) return null; const ok = crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); if (s !== ok) return null; return JSON.parse(Buffer.from(b, 'base64url').toString()); };

function auth(req, res, next) {
  const p = verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!p || !db.users[p.sub]) return res.status(401).json({ error: 'Please login' });
  req.user = db.users[p.sub]; refresh(req.user); next();
}
function refresh(u) {
  if (Date.now() - u.lastRefresh >= REFRESH_MS) { u.credits = MAX_CREDITS; u.lastRefresh = Date.now(); save(); }
}
const pub = (u) => ({ name: u.name, email: u.email, picture: u.picture, credits: u.credits, nextRefresh: u.lastRefresh + REFRESH_MS });

app.get('/api/config', (_, res) => res.json({ clientId: CLIENT_ID }));

app.post('/api/login', async (req, res) => {
  try {
    const t = await gClient.verifyIdToken({ idToken: req.body.credential, audience: CLIENT_ID });
    const g = t.getPayload();
    if (!db.users[g.sub]) db.users[g.sub] = { id: g.sub, credits: MAX_CREDITS, lastRefresh: Date.now(), history: [] };
    Object.assign(db.users[g.sub], { name: g.name, email: g.email, picture: g.picture });
    save();
    res.json({ token: sign({ sub: g.sub }), user: pub(db.users[g.sub]) });
  } catch (e) { res.status(401).json({ error: 'Google login failed' }); }
});

app.get('/api/me', auth, (req, res) => res.json({ user: pub(req.user), history: req.user.history }));

app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ---- Provider adapter: edit this part to match your API's docs ----
async function callProvider(job) {
  const r = await fetch(`${BASE}/${job.type === 'video' ? 'video/generations' : 'images/generations'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: job.type === 'video' ? process.env.VIDEO_MODEL : process.env.IMAGE_MODEL,
      prompt: job.prompt, aspect_ratio: job.ratio, image_url: job.input || undefined
    })
  });
  if (!r.ok) throw new Error('Provider error ' + r.status);
  return r.json(); // expected: { id } for async video or { url } for image
}
async function pollProvider(id) {
  const r = await fetch(`${BASE}/video/generations/${id}`, { headers: { Authorization: `Bearer ${KEY}` } });
  return r.json(); // expected: { status: 'processing|completed|failed', url }
}

async function run(user, job) {
  try {
    const out = await callProvider(job);
    if (job.type === 'image') { job.status = 'done'; job.url = out.url || (out.data && out.data[0].url); }
    else {
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const s = await pollProvider(out.id);
        if (s.status === 'completed') { job.status = 'done'; job.url = s.url; break; }
        if (s.status === 'failed') throw new Error('failed');
      }
      if (job.status !== 'done') throw new Error('timeout');
    }
  } catch (e) {
    job.status = 'failed';
    user.credits += COST[job.type]; // refund on failure
  }
  save();
}

app.post('/api/generate', auth, (req, res) => {
  const { type, prompt, ratio, input } = req.body;
  if (!['image', 'video'].includes(type) || !prompt) return res.status(400).json({ error: 'Invalid request' });
  const cost = COST[type];
  if (req.user.credits < cost) return res.status(402).json({ error: 'Not enough credits. Wait for refresh.' });
  req.user.credits -= cost;
  const job = { id: crypto.randomUUID(), type, prompt, ratio: ratio || '16:9', input: input || null, status: 'processing', created: Date.now() };
  req.user.history.unshift(job); req.user.history = req.user.history.slice(0, 100);
  save(); run(req.user, job);
  res.json({ job, user: pub(req.user) });
});

app.post('/api/retry/:id', auth, (req, res) => {
  const job = req.user.history.find(j => j.id === req.params.id);
  if (!job || job.status !== 'failed') return res.status(400).json({ error: 'Cannot retry' });
  if (req.user.credits < COST[job.type]) return res.status(402).json({ error: 'Not enough credits' });
  req.user.credits -= COST[job.type]; job.status = 'processing'; save(); run(req.user, job);
  res.json({ job, user: pub(req.user) });
});

app.get('/api/job/:id', auth, (req, res) => {
  const job = req.user.history.find(j => j.id === req.params.id);
  res.json({ job, user: pub(req.user) });
});

app.listen(PORT, () => console.log('Reka AI running on http://localhost:' + PORT));
