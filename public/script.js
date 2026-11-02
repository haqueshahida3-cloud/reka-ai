const $ = (s) => document.querySelector(s);
let token = localStorage.getItem('reka_token'), mode = 'text-video', inputUrl = null, timer;
// If frontend is hosted on GitHub Pages, set your deployed backend URL here:
const API = window.REKA_API || '';

const api = async (path, opts = {}) => {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Error'); return d;
};

// theme
const th = localStorage.getItem('reka_theme') || 'dark';
document.documentElement.dataset.theme = th;
$('#themeBtn').onclick = () => { const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; localStorage.setItem('reka_theme', n); };

// menu & navigation
$('#menuBtn').onclick = () => $('#menu').classList.toggle('open');
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { show(b.dataset.go); $('#menu').classList.remove('open'); });
function show(id) {
  if (!token) return;
  ['create', 'history'].forEach(s => $('#' + s).classList.toggle('hide', s !== id));
  if (id === 'history') loadHistory();
}
$('#logout').onclick = () => { localStorage.removeItem('reka_token'); location.reload(); };

// Google login
async function initGoogle() {
  const { clientId } = await (await fetch(API + '/api/config')).json();
  google.accounts.id.initialize({ client_id: clientId, callback: async (res) => {
    const d = await (await fetch(API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: res.credential }) })).json();
    if (d.token) { token = d.token; localStorage.setItem('reka_token', token); boot(); } else alert(d.error);
  }});
  google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_blue', size: 'large', text: 'continue_with' });
}

async function boot() {
  if (!token) return window.addEventListener('load', initGoogle);
  try {
    const d = await api('/api/me'); setUser(d.user);
    $('#login').classList.add('hide'); $('#logout').classList.remove('hide'); show('create');
  } catch { localStorage.removeItem('reka_token'); token = null; window.addEventListener('load', initGoogle); }
}
function setUser(u) {
  $('#credits').classList.remove('hide'); $('#credits').textContent = u.credits + ' credits';
  clearInterval(timer);
  const tick = () => { const ms = u.nextRefresh - Date.now(); $('#refresh').textContent = ms > 0 ? 'Credits reset to 100 in ' + Math.floor(ms / 3600000) + 'h ' + Math.floor(ms % 3600000 / 60000) + 'm' : 'Credits refresh now – reload'; };
  tick(); timer = setInterval(tick, 30000);
}

// mode tabs
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('on')); t.classList.add('on'); mode = t.dataset.mode;
  $('#file').classList.toggle('hide', mode !== 'img-video');
});

// file upload
$('#file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  $('#status').textContent = 'Uploading...';
  const r = await fetch(API + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  const d = await r.json(); inputUrl = d.url ? location.origin + d.url : null; $('#status').textContent = d.url ? 'Image uploaded ✓' : d.error;
};

// generate
$('#gen').onclick = async () => {
  const prompt = $('#prompt').value.trim(); if (!prompt) return;
  const type = mode === 'text-image' ? 'image' : 'video';
  if (mode === 'img-video' && !inputUrl) return ($('#status').textContent = 'Please upload an image first');
  $('#gen').disabled = true; $('#status').textContent = 'Generating... video can take a few minutes';
  try {
    const d = await api('/api/generate', { method: 'POST', body: JSON.stringify({ type, prompt, ratio: $('#ratio').value, input: mode === 'img-video' ? inputUrl : null }) });
    setUser(d.user); track(d.job.id);
  } catch (e) { $('#status').textContent = e.message; $('#gen').disabled = false; }
};
function track(id) {
  const iv = setInterval(async () => {
    const d = await api('/api/job/' + id); setUser(d.user);
    if (d.job.status !== 'processing') {
      clearInterval(iv); $('#gen').disabled = false;
      $('#status').textContent = d.job.status === 'done' ? 'Done ✓' : 'Failed – credits refunded. Retry from History.';
      $('#result').prepend(card(d.job));
    }
  }, 4000);
}

// history
function card(j) {
  const el = document.createElement('div'); el.className = 'card item';
  const media = j.status === 'done' ? (j.type === 'video' ? `<video src="${j.url}" controls loop></video>` : `<img src="${j.url}">`) : `<p class="small">${j.status === 'failed' ? '❌ Failed' : '⏳ Processing...'}</p>`;
  el.innerHTML = `${media}<p class="small">${j.type} · ${j.ratio} · ${new Date(j.created).toLocaleString()}</p><p></p>`;
  el.lastChild.textContent = j.prompt;
  if (j.status === 'done') el.insertAdjacentHTML('beforeend', `<a class="btn ghost" href="${j.url}" download target="_blank">Download</a>`);
  if (j.status === 'failed') { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Retry'; b.onclick = async () => {
    try { const d = await api('/api/retry/' + j.id, { method: 'POST' }); setUser(d.user); track(j.id); b.disabled = true; b.textContent = 'Retrying...'; } catch (e) { alert(e.message); } }; el.appendChild(b); }
  return el;
}
async function loadHistory() {
  const d = await api('/api/me'); const l = $('#hlist'); l.innerHTML = '';
  if (!d.history.length) l.innerHTML = '<p class="small">No creations yet.</p>';
  d.history.forEach(j => l.appendChild(card(j)));
}
boot();
