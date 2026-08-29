'use strict';
/* Spark Observatory — live renderer. Layout/CSS from the GLM visual bench;
   numbers come from /api/snapshot (sparkDash). Nothing is simulated. */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));

const HIST_MAX = 180;
const hist = [];
let C = {};
let lastEvents = new Set();
let replay = false;
let replayIdx = 0;
let lastSnap = null;

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function refreshPalette() {
  const hx = (h) => {
    h = h.trim().replace('#', '');
    const v = parseInt(h, 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  };
  C = {
    tx3: cssVar('--tx3'), tx2: cssVar('--tx2'),
    ok: hx(cssVar('--ok')), warn: hx(cssVar('--warn')), crit: hx(cssVar('--crit')),
    idle: hx(cssVar('--idle')),
    coding: hx(cssVar('--t-coding')), agent: hx(cssVar('--t-agent')),
    vision: hx(cssVar('--t-vision')), long: hx(cssVar('--t-long')),
    accent: hx(cssVar('--accent')),
  };
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const tempColor = (v) => (v == null ? C.idle : v < 58 ? C.idle : v < 75 ? C.ok : v < 85 ? C.warn : C.crit);

function fit(c) {
  const r = c.getBoundingClientRect(), d = devicePixelRatio || 1;
  const w = Math.max(2, Math.round(r.width * d)), h = Math.max(2, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
  return [g, r.width, r.height];
}
function slice(win, fn) {
  const out = [];
  const t1 = hist.length ? hist[hist.length - 1].t : 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const f = hist[i];
    if (f.t < t1 - win) break;
    out.unshift(fn(f));
  }
  return out;
}

const logEl = document.getElementById('log');
function fmtUTC(ms) {
  const d = new Date(ms * 1000), p = (n) => String(n).padStart(2, '0');
  return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}
function log(msg, sev, t) {
  const el = document.createElement('div');
  el.className = 'le ' + (sev || 'info');
  el.innerHTML = `<span class="t">${fmtUTC(t || Date.now() / 1000)}</span><i class="d"></i><span class="m">${msg}</span>`;
  logEl.prepend(el);
  while (logEl.children.length > 90) logEl.lastChild.remove();
}

function uptimeStr(s) {
  s = Math.max(0, Math.floor(s || 0));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nodeCard(n, i) {
  const X = n.label.replace(/^SPARK-/, '') || String.fromCharCode(65 + i);
  const id = n.id;
  return `<article class="node" id="node-${id}" data-x="${X}">
  <header class="nh"><span class="nname">${n.label}</span><i class="ndot" id="dot-${id}"></i>
    <span class="nstat" id="stat-${id}">–</span>
    <span class="nclk" id="clk-${id}">–</span></header>
  <div class="nsub">${n.hardware || 'DGX Spark'} · uptime <span id="up-${id}">–</span></div>
  <div class="nrow temp"><div class="big" id="big-${id}"><span id="v-temp-${id}">–</span><u>°C</u></div><canvas id="c-temp-${id}"></canvas></div>
  <div class="nrow"><label>MEM</label><div class="membar" id="mem-${id}"><i class="mw"></i><i class="mk"></i><i class="ma"></i></div>
    <span class="val sm" id="v-mem-${id}">–</span><span class="unit">GiB</span></div>
  <div class="nrow"><label>DEC</label><span class="val" id="v-dec-${id}">–</span><span class="unit">tok/s</span>
    <label class="l2">PRE</label><span class="val" id="v-pre-${id}">–</span><span class="unit">tok/s</span></div>
  <canvas class="thrc" id="c-thr-${id}"></canvas>
  <div class="nrow"><label>PWR</label><span class="val" id="v-pwr-${id}">–</span><span class="unit">W</span>
    <label class="l2">UTIL</label><span class="val" id="v-util-${id}">–</span><span class="unit">%</span></div>
  <div class="nrow fan"><canvas id="c-fan-${id}"></canvas><div class="links">
    <div><label>LAN</label><span class="val" id="v-lan-${id}">–</span><span class="unit">GB/s</span></div>
    <div><label>RoCE</label><span class="val" id="v-roce-${id}">–</span><span class="unit">GB/s</span></div>
    <div><label>OOM</label><span class="val" id="v-oom-${id}">–</span></div>
  </div></div></article>`;
}

const colL = document.getElementById('colL');
function ensureCards(nodes) {
  const ids = nodes.map((n) => n.id).join('|');
  if (colL.dataset.ids === ids) return;
  colL.dataset.ids = ids;
  colL.innerHTML = nodes.map(nodeCard).join('');
}

function dash(v, digits) {
  if (v == null || Number.isNaN(v)) return '–';
  return Number(v).toFixed(digits);
}

function nodeDom(n) {
  const id = n.id;
  const $ = (k) => document.getElementById(k + '-' + id);
  const temp = n.temp_c;
  const st = tempColor(temp);
  const vt = document.getElementById('v-temp-' + id);
  if (!vt) return;
  vt.textContent = temp == null ? '–' : Number(temp).toFixed(1);
  document.getElementById('big-' + id).style.color = rgba(st, 1);
  const tot = n.mem_total_gib || 128;
  const used = n.mem_used_gib || 0;
  const gpu = n.gpu_used_gib || 0;
  const cpu = n.cpu_used_gib || 0;
  document.getElementById('v-mem-' + id).textContent = used ? used.toFixed(1) : '–';
  const bar = document.getElementById('mem-' + id);
  if (bar) {
    const segs = bar.children;
    segs[0].style.width = (cpu / tot * 100) + '%';
    segs[1].style.width = (gpu / tot * 100) + '%';
    segs[2].style.width = Math.max(0, (used - gpu - cpu) / tot * 100) + '%';
    segs[1].style.background = (n.kv_frac || 0) > 0.85 ? rgba(C.crit, 0.75) : (n.kv_frac || 0) > 0.7 ? rgba(C.warn, 0.8) : rgba(C.ok, 0.7);
  }
  document.getElementById('v-dec-' + id).textContent = n.decode_tps == null ? '–' : fmtInt(n.decode_tps);
  document.getElementById('v-pre-' + id).textContent = n.prefill_tps == null ? '–' : (n.prefill_tps >= 1000 ? fmtK(n.prefill_tps) : fmtInt(n.prefill_tps));
  document.getElementById('v-pwr-' + id).textContent = n.power_w == null ? '–' : Math.round(n.power_w);
  document.getElementById('v-util-' + id).textContent = n.gpu_util == null ? '–' : Math.round(n.gpu_util);
  document.getElementById('v-lan-' + id).textContent = dash(n.lan_gbs, 3);
  document.getElementById('v-roce-' + id).textContent = dash(n.roce_gbs, 3);
  document.getElementById('v-oom-' + id).textContent = n.oom_risk || '–';
  const clk = document.getElementById('clk-' + id);
  const mhz = n.sm_clock_mhz;
  clk.textContent = n.throttled ? `${mhz || '–'} MHz · THROTTLED` : (mhz ? `${Math.round(mhz)} MHz` : '–');
  clk.classList.toggle('thr', !!n.throttled);
  const lvl = !n.online ? 2 : (n.throttled || (temp != null && temp > 86) ? 2 : (temp != null && temp > 75) || n.oom_risk === 'high' ? 1 : 0);
  document.getElementById('dot-' + id).style.background = !n.online ? rgba(C.idle, 1) : lvl === 2 ? rgba(C.crit, 1) : lvl === 1 ? rgba(C.warn, 1) : rgba(C.ok, 1);
  const stat = document.getElementById('stat-' + id);
  stat.textContent = !n.online ? 'OFFLINE' : lvl === 2 ? 'CRITICAL' : lvl === 1 ? 'HOT' : 'NOMINAL';
  stat.style.color = !n.online ? rgba(C.idle, 1) : lvl === 2 ? rgba(C.crit, 1) : lvl === 1 ? rgba(C.warn, 1) : '';
  const art = document.getElementById('node-' + id);
  art.classList.toggle('crit', lvl === 2 && n.online);
  art.classList.toggle('hot', lvl === 1);
  document.getElementById('up-' + id).textContent = n.online ? uptimeStr(n.uptime_s) : '–';
}

function drawTemp(n) {
  const c = document.getElementById('c-temp-' + n.id); if (!c) return;
  const [g, W, H] = fit(c);
  const vs = slice(60, (f) => {
    const x = f.nodes.find((q) => q.id === n.id);
    return x && x.temp_c != null ? x.temp_c : null;
  }).filter((v) => v != null);
  g.clearRect(0, 0, W, H);
  const y = (v) => H - (v - 32) / (98 - 32) * H;
  g.strokeStyle = rgba(C.warn, 0.22); g.beginPath(); g.moveTo(0, y(75)); g.lineTo(W, y(75)); g.stroke();
  g.strokeStyle = rgba(C.crit, 0.28); g.beginPath(); g.moveTo(0, y(87)); g.lineTo(W, y(87)); g.stroke();
  if (vs.length < 2) return;
  const col = tempColor(vs[vs.length - 1]);
  g.beginPath();
  for (let k = 0; k < vs.length; k++) {
    const x = W * k / (vs.length - 1);
    k ? g.lineTo(x, y(vs[k])) : g.moveTo(x, y(vs[k]));
  }
  g.lineWidth = 1.4; g.strokeStyle = rgba(col, 0.95); g.stroke();
  g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = rgba(col, 0.07); g.fill();
}

function drawThr(n) {
  const c = document.getElementById('c-thr-' + n.id); if (!c) return;
  const [g, W, H] = fit(c);
  const ds = slice(60, (f) => (f.nodes.find((q) => q.id === n.id) || {}).decode_tps || 0);
  const ps = slice(60, (f) => (f.nodes.find((q) => q.id === n.id) || {}).prefill_tps || 0);
  g.clearRect(0, 0, W, H);
  if (ds.length < 2) return;
  const mD = Math.max(20, Math.max(...ds) * 1.15);
  const mP = Math.max(20, Math.max(...ps) * 1.15);
  g.strokeStyle = rgba(C.idle, 0.25); g.beginPath(); g.moveTo(0, H * 0.5); g.lineTo(W, H * 0.5); g.stroke();
  const line = (vs, m, col, dash) => {
    g.beginPath();
    for (let k = 0; k < vs.length; k++) {
      const x = W * k / (vs.length - 1), yy = H - (vs[k] / m) * (H - 4) - 2;
      k ? g.lineTo(x, yy) : g.moveTo(x, yy);
    }
    g.lineWidth = 1.3; g.setLineDash(dash || []); g.strokeStyle = col; g.stroke(); g.setLineDash([]);
  };
  line(ps, mP, rgba(C.agent, 0.75), [3, 3]);
  line(ds, mD, rgba(C.ok, 0.95));
  g.fillStyle = rgba(C.tx3, 0.9); g.font = '8.5px IBM Plex Mono';
  g.fillText('dec', 3, 9); g.fillText('pre', 28, 9);
}

function drawFan(n) {
  const c = document.getElementById('c-fan-' + n.id); if (!c) return;
  const [g, W, H] = fit(c); g.clearRect(0, 0, W, H);
  const x = (t) => (t - 35) / 60 * W, y = (v) => H - (v / 100) * (H - 6) - 3;
  g.strokeStyle = rgba(C.idle, 0.3);
  g.beginPath(); g.moveTo(0, y(100)); g.lineTo(W, y(100)); g.moveTo(0, H - 1); g.lineTo(W, H - 1); g.stroke();
  if (n.temp_c == null || n.gpu_util == null) return;
  const col = tempColor(n.temp_c);
  g.beginPath(); g.arc(x(clamp(n.temp_c, 35, 95)), y(clamp(n.gpu_util, 0, 100)), 3, 0, 7);
  g.fillStyle = rgba(col, 1); g.fill();
  g.fillStyle = rgba(C.tx3, 0.9); g.font = '8px IBM Plex Mono';
  g.fillText('35°', 2, H - 3); g.fillText('util@temp', W / 2 - 22, 10);
}

function drawKV(snap) {
  const c = document.getElementById('c-kv'); if (!c) return;
  const [g, W, H] = fit(c); g.clearRect(0, 0, W, H);
  const L = 36, Rp = 8, T = 8, B = 15, iw = W - L - Rp, ih = H - T - B;
  const y = (v) => T + (1 - v) * ih;
  g.strokeStyle = rgba(C.idle, 0.22); g.fillStyle = rgba(C.idle, 0.85); g.font = '8.5px IBM Plex Mono';
  for (let v = 0; v <= 1; v += 0.25) {
    g.beginPath(); g.moveTo(L, y(v)); g.lineTo(W - Rp, y(v)); g.stroke();
    g.fillText(String(Math.round(v * 100)), 4, y(v) + 3);
  }
  const ss = slice(60, (f) => (f.nodes || []).map((n) => n.kv_frac || 0));
  if (ss.length < 2) { document.getElementById('kv-h').textContent = '–'; return; }
  const X = (k) => L + iw * k / (ss.length - 1);
  const nN = ss[0].length;
  const cols = [C.ok, C.agent, C.vision, C.long];
  let acc = ss.map(() => 0);
  for (let i = 0; i < nN; i++) {
    g.beginPath();
    for (let k = 0; k < ss.length; k++) {
      const top = acc[k] + (ss[k][i] || 0) / Math.max(1, nN);
      k ? g.lineTo(X(k), y(top)) : g.moveTo(X(k), y(top));
    }
    for (let k = ss.length - 1; k >= 0; k--) g.lineTo(X(k), y(acc[k]));
    g.closePath(); g.fillStyle = rgba(cols[i % cols.length], 0.35); g.fill();
    for (let k = 0; k < ss.length; k++) acc[k] += (ss[k][i] || 0) / Math.max(1, nN);
  }
  const last = snap.cluster || {};
  const frac = last.kv_frac;
  document.getElementById('kv-h').textContent = frac == null ? 'not reported' : `${(frac * 100).toFixed(1)}% KV`;
}

function drawSC(snap) {
  const c = document.getElementById('c-sc'); if (!c) return;
  const [g, W, H] = fit(c); g.clearRect(0, 0, W, H);
  const L = 40, Rp = 8, T = 8, B = 15, iw = W - L - Rp, ih = H - T - B;
  const lg = Math.log10(30) - Math.log10(0.1);
  const Y = (tt) => T + (1 - (Math.log10(clamp(tt, 0.08, 30)) - Math.log10(0.1)) / lg) * ih;
  const X = (cn) => L + iw * clamp(cn, 0, 16) / 16;
  g.font = '8.5px IBM Plex Mono';
  [[0.1, '100ms'], [1, '1s'], [10, '10s']].forEach(([v, l]) => {
    g.strokeStyle = rgba(C.idle, 0.2); g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - Rp, Y(v)); g.stroke();
    g.fillStyle = rgba(C.idle, 0.85); g.fillText(l, 4, Y(v) + 3);
  });
  for (let cn = 0; cn <= 16; cn += 4) {
    g.fillStyle = rgba(C.idle, 0.85); g.fillText(String(cn), X(cn) - 3, H - 4);
  }
  let n = 0;
  for (const f of hist) {
    const cl = f.cluster || {};
    if (cl.ttft_p95_s == null) continue;
    const age = (snap.t - f.t);
    if (age > 60) continue;
    const a = 1 - age / 60;
    g.beginPath(); g.arc(X(cl.running || 0), Y(cl.ttft_p95_s), 2.4, 0, 7);
    g.fillStyle = rgba(C.ok, 0.8 * a); g.fill(); n++;
  }
  const cur = snap.cluster || {};
  document.getElementById('sc-h').textContent =
    cur.ttft_p95_s == null ? 'no TTFT yet' : `run ${cur.running || 0} · p95 TTFT ${cur.ttft_p95_s < 1 ? Math.round(cur.ttft_p95_s * 1000) + ' ms' : cur.ttft_p95_s.toFixed(2) + ' s'}`;
}

function drawHM() {
  const c = document.getElementById('c-hm'); if (!c) return;
  const [g, W, H] = fit(c); g.clearRect(0, 0, W, H);
  g.fillStyle = rgba(C.idle, 0.9); g.font = '11px IBM Plex Mono';
  g.fillText('MoE expert load is not exported', 12, H / 2 - 6);
  g.fillStyle = rgba(C.idle, 0.7); g.font = '10px IBM Plex Mono';
  g.fillText('by vLLM / EXL3 /metrics — shown blank on purpose', 12, H / 2 + 10);
}

function renderRiver(snap) {
  const run = (snap.cluster || {}).running || 0;
  const wait = (snap.cluster || {}).waiting || 0;
  const dec = (snap.nodes || []).reduce((a, n) => a + (n.decode_tps || 0), 0);
  const pre = (snap.nodes || []).reduce((a, n) => a + (n.prefill_tps || 0), 0);
  document.getElementById('lc-run').textContent = run;
  document.getElementById('lc-wait').textContent = wait;
  document.getElementById('lc-dec').textContent = fmtInt(dec);
  document.getElementById('lc-pre').textContent = fmtInt(pre);
  const flow = document.getElementById('rv-flow');
  const want = [];
  for (let i = 0; i < run; i++) want.push({ k: 'run-' + i, lane: 0, tag: 'RUN', cls: 't-coding run' });
  for (let i = 0; i < wait; i++) want.push({ k: 'wait-' + i, lane: 1, tag: 'WAIT', cls: 't-agent' });
  const have = new Set();
  [...flow.querySelectorAll('.pill')].forEach((el) => {
    if (!want.find((w) => w.k === el.dataset.k)) el.remove();
    else have.add(el.dataset.k);
  });
  const h = flow.clientHeight || 1, w = flow.clientWidth || 1;
  want.forEach((p, idx) => {
    let el = flow.querySelector(`[data-k="${p.k}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'pill ' + p.cls;
      el.dataset.k = p.k;
      el.innerHTML = `<span class="tag">${p.tag}</span><i class="st"></i><span>${p.k}</span>`;
      el.addEventListener('click', () => openDrawer(snap, p));
      flow.appendChild(el);
    }
    const laneH = h / 4;
    const y = p.lane * laneH + laneH * 0.35;
    const x = 16 + (idx % 6) * 92;
    el.style.transform = `translate(${x}px, ${y}px)`;
  });
}

function openDrawer(snap, pill) {
  document.getElementById('scrim').classList.add('on');
  document.getElementById('drawer').classList.add('open');
  document.getElementById('d-id').textContent = pill.k;
  document.getElementById('d-type').textContent = pill.tag;
  document.getElementById('d-st').textContent = pill.tag === 'RUN' ? 'in flight' : 'queued';
  const cl = snap.cluster || {};
  document.getElementById('d-arr').textContent = fmtUTC(snap.t);
  document.getElementById('d-in').textContent = '–';
  document.getElementById('d-out').textContent = '–';
  document.getElementById('d-ttft').textContent = cl.ttft_p95_s == null ? '–' : cl.ttft_p95_s.toFixed(3) + ' s p95';
  document.getElementById('d-tpot').textContent = '–';
  document.getElementById('d-ctx').textContent = cl.ctx_len ? fmtInt(cl.ctx_len) : '–';
  document.getElementById('d-reason').textContent = 'aggregate (no request id)';
  document.getElementById('d-shard').textContent = (snap.nodes || []).map((n) => n.label).join(' + ') || '–';
  document.getElementById('d-mtp').textContent = cl.mtp_accept == null ? '–' : (cl.mtp_accept * 100).toFixed(1) + '%';
  document.getElementById('d-cap').textContent = cl.ctx_len ? fmtInt(cl.ctx_len) : '–';
  document.getElementById('d-ex').textContent =
    'vLLM does not expose per-request traces on /metrics.\nThis pill is a slot for inflight/waiting count, not a reconstructed prompt.\n\n' +
    JSON.stringify({ cluster: cl, nodes: (snap.nodes || []).map((n) => ({ id: n.id, online: n.online, decode_tps: n.decode_tps, running: n.running })) }, null, 2);
}
function closeDrawer() {
  document.getElementById('scrim').classList.remove('on');
  document.getElementById('drawer').classList.remove('open');
}
document.getElementById('d-close').onclick = closeDrawer;
document.getElementById('scrim').onclick = closeDrawer;

function applyChrome(snap) {
  document.getElementById('subtitle').textContent = '/ ' + (snap.subtitle || snap.cluster?.model_id || '—');
  const chips = document.getElementById('chips');
  chips.innerHTML = (snap.chips || []).map((c) => {
    const m = String(c).match(/^(CTX )(.+)$/i);
    if (m) return `<span class="chip">${m[1]}<b>${m[2]}</b></span>`;
    if (/^\d/.test(c)) return `<span class="chip"><b>${c.split(/[\s-]/)[0]}</b>${c.slice(c.split(/[\s-]/)[0].length)}</span>`;
    return `<span class="chip">${c}</span>`;
  }).join('');
  const h = document.getElementById('health');
  h.className = 'hpill ' + (snap.health || 'nominal');
  h.querySelector('span').textContent = (snap.health || 'nominal').toUpperCase();
  document.getElementById('clock').innerHTML = fmtUTC(snap.t) + '<small>UTC</small>';
  const flag = document.getElementById('liveflag');
  flag.innerHTML = snap.live
    ? '<i></i>LIVE — sparkDash node metrics + vLLM tok/s, KV, queue. Expert heatmap not exposed.'
    : '<i></i>NO TELEMETRY — check config.toml source.url';
  flag.style.color = snap.live ? '' : 'var(--crit)';
  document.getElementById('src-h').textContent =
    `${(snap.source || {}).kind || '?'} ${(snap.source || {}).url || ''} · poll 1 s · hist ${hist.length}`;
  document.getElementById('hm-h').textContent = snap.expert_note || 'not exposed';
  document.getElementById('hm-f').textContent = snap.expert_note || '';
}

function ingestEvents(snap) {
  for (const e of snap.events || []) {
    const k = e.sev + '|' + e.msg;
    if (lastEvents.has(k)) continue;
    lastEvents.add(k);
    log(e.msg, e.sev === 'crit' ? 'crit' : e.sev === 'warn' ? 'warn' : 'ok', e.t);
  }
  if (lastEvents.size > 200) lastEvents = new Set([...lastEvents].slice(-80));
}

function render(snap) {
  lastSnap = snap;
  ensureCards(snap.nodes || []);
  applyChrome(snap);
  ingestEvents(snap);
  (snap.nodes || []).forEach((n) => {
    nodeDom(n); drawTemp(n); drawThr(n); drawFan(n);
  });
  drawKV(snap); drawSC(snap); drawHM();
  renderRiver(snap);
}

document.getElementById('shift').onclick = (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  document.documentElement.dataset.shift = b.dataset.s;
  [...document.getElementById('shift').children].forEach((x) => x.classList.toggle('on', x === b));
  refreshPalette();
};

document.getElementById('replayBtn').onclick = () => {
  replay = !replay;
  document.body.classList.toggle('replaying', replay);
  document.getElementById('replayBtn').classList.toggle('active', replay);
  replayIdx = Math.max(0, hist.length - 60);
};

async function tick() {
  if (replay && hist.length) {
    const snap = hist[replayIdx] || hist[hist.length - 1];
    document.getElementById('rbadge').textContent = `T-${hist.length - replayIdx}`;
    render(snap);
    replayIdx = Math.min(hist.length - 1, replayIdx + 1);
    if (replayIdx >= hist.length - 1) replay = false, document.body.classList.remove('replaying');
    return;
  }
  try {
    const r = await fetch('/api/snapshot', { cache: 'no-store' });
    const snap = await r.json();
    if (snap && snap.t) {
      hist.push(snap);
      if (hist.length > HIST_MAX) hist.shift();
      render(snap);
    }
  } catch (e) {
    log('snapshot fetch failed: ' + e.message, 'crit');
  }
}

refreshPalette();
log('observatory online — waiting for sparkDash', 'ok');
tick();
setInterval(tick, 1000);
window.addEventListener('resize', () => lastSnap && render(lastSnap));
