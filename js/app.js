// Điều khiển giao diện: nhập toạ độ → quét → chọn → xem trước → xuất video.
import { parseCoords, haversineKm, formatKm } from './geo.js';
import { CATEGORIES, scanArea, autoPick, routeTo, searchPlaces, guessCategory } from './data.js';
import { ICON_PATHS } from './icons.js';
import {
  FORMATS, TileCache, setImageryToken, buildTimeline, render, renderEdit, editTapToLatLng, CAT_COLORS, FONT, LINE_THEMES,
} from './render.js';
import { sfxEvents } from './sfx.js';
import { decodeAudioFile, mixAudio, preloadTiles, exportMp4, exportRealtime, canEncodeMp4 } from './export.js';
import { initAccount, setAccountLocation, beginExport, requireLogin, authHeaders, handleAiError, account } from './account.js';
import { splitVoice, joinForTts } from './voicesplit.js';
import { speakNumbers, speakPhones } from './vinum.js';

const $ = id => document.getElementById(id);
const STORE = 'vitri.project.v1';
const MAX_POIS = 10;
const ROAD_DOT = { 3: '#FF7A1A', 2: '#FFB627', 1: '#E9C46A' };

const state = {
  coordText: '10.6900, 106.5900',
  house: { lat: 10.69, lng: 106.59 },
  typeLabel: 'VỊ TRÍ CĂN NHÀ',
  label: 'VỊ TRÍ CĂN NHÀ',
  sub: '',
  radiusKm: 5,
  title: 'Vị trí & tiện ích',
  brand: '',
  phone: '',
  scriptSeed: 0,
  fmt: 'v',
  speed: 'cham',
  quality: '1080',
  musicVol: 0.8,
  fitVoice: true,
  roadTheme: 'auto',
  routeTheme: 'vang',
  sfxOn: true,
  sfxVol: 0.7,
  voiceId: 'nu-nam',
  voiceSpeed: 0,
  aiVoiceOn: true,
  scriptEdits: {},   // lời đọc anh/chị đã sửa theo từng cảnh
  pois: [],          // tất cả tiện ích đã quét + tự thêm
  roads: [],         // các tuyến đường lớn
  selected: [],      // id tiện ích được chọn
  selectedRoads: [], // id đường được chọn
  routes: {},        // id -> {km, coords} | null
  admin: null,       // xã/tỉnh chứa căn nhà + ranh tỉnh/thành gần nhất
  useBoundary: true,
  scannedAt: null,
};
const media = { music: null, voice: null, musicName: '', voiceName: '', mixed: null, mixKey: '', voiceSegs: new Map() };
const ai = { tts: false, ttsProvider: null, script: false, gated: true, voices: null };

// ---------- Lưu dự án gần nhất ----------
function save() {
  const data = { ...state };
  try { localStorage.setItem(STORE, JSON.stringify(data)); }
  catch {
    try { localStorage.setItem(STORE, JSON.stringify({ ...data, roads: [], routes: {} })); } catch { /* bỏ qua */ }
  }
}
function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch { /* bỏ qua */ }
}

// ---------- Tiện ích giao diện ----------
let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('toast');
  // Hộp thoại mở dạng modal nằm trên cùng: đưa thông báo vào trong hộp thoại để vẫn thấy
  const host = document.querySelector('dialog[open]') || document.body;
  if (el.parentElement !== host) host.appendChild(el);
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}
function setStatus(msg) {
  const el = $('stageStatus');
  el.textContent = msg || '';
  el.hidden = !msg;
}
function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}" fill="currentColor"/></svg>`;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function setSeg(id, value) {
  for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === value));
}
function bindSeg(id, onPick) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    setSeg(id, b.dataset.v);
    onPick(b.dataset.v);
  });
}

// ---------- Cảnh dựng ----------
function selectedPois() {
  return state.selected
    .map(id => state.pois.find(p => p.id === id))
    .filter(Boolean)
    .map(p => ({ ...p, route: state.routes[p.id] || null }))
    .sort((a, b) => a.km - b.km);
}
function selectedRoads() {
  return state.roads.filter(r => state.selectedRoads.includes(r.id));
}
function buildScene() {
  return {
    house: state.house,
    label: (state.label || 'VỊ TRÍ').toUpperCase(),
    sub: state.sub,
    title: state.title,
    brand: state.brand,
    phone: phoneDisplay(state.phone),
    radiusKm: state.radiusKm,
    speed: state.speed,
    pois: selectedPois(),
    roads: selectedRoads(),
    boundary: state.useBoundary && state.admin?.boundary ? { ...state.admin.boundary, route: state.routes.__ranh || null } : null,
    provinceShort: state.admin?.provinceShort || '',
    commune: state.admin?.commune || '',
    titleSub: state.sub,
    roadTheme: state.roadTheme,
    routeTheme: state.routeTheme,
  };
}
function voiceFitDuration() {
  return media.voice && state.fitVoice ? media.voice.duration + 2.2 : 0;
}
// Thời lượng giọng AI đã tạo cho từng cảnh (chỉ tính câu chưa bị sửa sau khi tạo)
function voiceDurations() {
  if (!state.aiVoiceOn) return null;
  const out = {};
  let n = 0;
  for (const sg of scriptSegments()) {
    const v = media.voiceSegs.get(sg.key);
    if (v && v.ck === voiceKey(sg.text)) { out[sg.key] = v.buffer.duration; n++; }
  }
  return n ? out : null;
}
function timelineOpts() {
  const vd = voiceDurations();
  return vd ? { voice: vd } : { fitDuration: voiceFitDuration() };
}
function voiceSegsFor(T) {
  if (!state.aiVoiceOn) return [];
  const byKey = {};
  for (const sg of scriptSegments()) {
    const v = media.voiceSegs.get(sg.key);
    if (v && v.ck === voiceKey(sg.text)) byKey[sg.key] = v.buffer;
  }
  const out = [];
  for (const ph of T.phases) {
    const b = ph.vkey && byKey[ph.vkey];
    if (b) out.push({ t: ph.t0 + (ph.type === 'intro' ? 0.5 : 0.3), buffer: b });
  }
  return out;
}

// ---------- Xem trước ----------
const canvas = $('preview');
const ctx = canvas.getContext('2d');
const cache = new TileCache(() => (dirty = true));
// Khoá ảnh vệ tinh thương mại (nếu đã đặt ARCGIS_KEY trên máy chủ)
fetch('/api/config', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(c => c?.arcgis && setImageryToken(c.arcgis)).catch(() => {});
let tl = null;
let t = 0;
let playing = false;
let editing = false;
let dirty = true;
let lastFrame = 0;
let audioCtx = null;
let audioSrc = null;
let exporting = false;

// Cho phép soát lỗi từ bảng điều khiển trình duyệt
window.__vitri = { get tl() { return tl; }, get t() { return t; }, state, scanArea };

function rebuild() {
  if (!state.house) return;
  tl = buildTimeline(buildScene(), state.fmt, timelineOpts());
  if (t > tl.duration) t = 0;
  $('durLabel').textContent = '≈ ' + Math.round(tl.duration) + ' giây';
  updateTimeUi();
  renderScript();
  dirty = true;
  scheduleMix();
}
let rebuildTimer;
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { rebuild(); save(); }, 120);
}

function layoutCanvas() {
  const F = FORMATS[state.fmt];
  const wrap = $('canvasWrap');
  const inner = wrap.parentElement;
  const desktop = window.matchMedia('(min-width: 980px)').matches;
  const availW = inner.clientWidth;
  const transportH = 52;
  const availH = desktop
    ? inner.clientHeight - transportH - 10
    : Math.min(window.innerHeight * (state.fmt === 'v' ? 0.62 : 0.5), 760);
  const ratio = F.LW / F.LH;
  let w = Math.min(availW, availH * ratio);
  w = Math.max(160, w);
  const h = w / ratio;
  wrap.style.width = Math.round(w) + 'px';
  wrap.style.height = Math.round(h) + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  dirty = true;
}

function updateTimeUi() {
  if (!tl) return;
  $('scrub').value = String(Math.round(t / tl.duration * 1000));
  $('timeLabel').textContent = fmtTime(t) + ' / ' + fmtTime(tl.duration);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (exporting) return;
  const scale = canvas.width / FORMATS[state.fmt].LW;
  if (editing) {
    if (now - lastFrame > 33 || dirty) {
      renderEdit(ctx, state.house, state.fmt, { cache, scale });
      lastFrame = now;
      dirty = false;
    }
    return;
  }
  if (!tl) return;
  if (playing) {
    const dt = (now - lastFrame) / 1000;
    t += Math.min(dt, 0.1);
    if (t >= tl.duration) { t = tl.duration; pause(); }
    updateTimeUi();
  }
  lastFrame = now;
  if (playing || dirty) {
    render(ctx, tl, t, { cache, scale, request: true });
    dirty = false;
  }
}

async function play() {
  if (!tl) return;
  if (editing) toggleEdit(false);
  if (t >= tl.duration - 0.05) t = 0;
  playing = true;
  lastFrame = performance.now();
  $('playBtn').classList.add('playing');
  $('playBtn').setAttribute('aria-label', 'Tạm dừng');
  await startAudio();
}
function pause() {
  playing = false;
  $('playBtn').classList.remove('playing');
  $('playBtn').setAttribute('aria-label', 'Phát xem trước');
  stopAudio();
}

async function startAudio() {
  stopAudio();
  const buf = await ensureMix();
  if (!buf || !playing) return;
  audioCtx ||= new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  audioSrc = audioCtx.createBufferSource();
  audioSrc.buffer = buf;
  audioSrc.connect(audioCtx.destination);
  audioSrc.start(0, Math.min(t, buf.duration - 0.01));
}
function stopAudio() {
  try { audioSrc?.stop(); } catch { /* đã dừng */ }
  audioSrc = null;
}

let mixTimer;
function scheduleMix() {
  clearTimeout(mixTimer);
  mixTimer = setTimeout(() => { ensureMix(); }, 400);
}
function audioPlan(T) {
  const segs = voiceSegsFor(T);
  const sfx = state.sfxOn && state.sfxVol > 0 ? { events: sfxEvents(T), vol: state.sfxVol } : null;
  return { segs, sfx, voice: segs.length ? null : media.voice };
}
async function ensureMix() {
  if (!tl) return null;
  const A = audioPlan(tl);
  if (!media.music && !A.voice && !A.segs.length && !A.sfx) { media.mixed = null; return null; }
  const key = [tl.duration.toFixed(2), media.musicName, A.voice ? media.voiceName : '', state.musicVol, A.sfx ? state.sfxVol : 0,
    A.segs.map(x => x.t.toFixed(2) + ':' + x.buffer.length).join(',')].join('|');
  if (media.mixed && media.mixKey === key) return media.mixed;
  media.mixed = await mixAudio({ music: media.music, voice: A.voice, voiceSegs: A.segs, sfx: A.sfx, duration: tl.duration, musicVol: state.musicVol });
  media.mixKey = key;
  return media.mixed;
}

function toggleEdit(on) {
  editing = on ?? !editing;
  if (editing) pause();
  $('editPinBtn').setAttribute('aria-pressed', String(editing));
  $('canvasWrap').classList.toggle('editing', editing);
  dirty = true;
}

// ---------- Toạ độ ----------
// Link rút gọn Google Maps (maps.app.goo.gl) -> link đầy đủ có toạ độ + tên địa điểm
const SHORT_LINK = /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+/i;
async function resolveMapsLink(text) {
  const m = String(text || '').match(SHORT_LINK);
  if (!m) return null;
  const res = await fetch('/api/resolve?u=' + encodeURIComponent(m[0]));
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.url) throw new Error(j.error || 'Không mở được link Google Maps');
  const r = parseCoords(j.url);
  if (r.error) throw new Error('Link Google Maps này không có toạ độ. Mở link, nhấn giữ vào điểm cần lấy để hiện toạ độ rồi chép.');
  const nm = j.url.match(/\/maps\/place\/([^/@?]+)/);
  let name = '';
  if (nm) { try { name = decodeURIComponent(nm[1].replace(/\+/g, ' ')).trim(); } catch { /* bỏ qua */ } }
  if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(name) || /^\d+°/.test(name)) name = '';
  return { lat: r.lat, lng: r.lng, name, url: j.url };
}

function applyCoords(text, { silent = false } = {}) {
  if (SHORT_LINK.test(text || '')) {
    const msg = $('coordMsg');
    msg.textContent = 'Đang mở link Google Maps…'; msg.className = 'hint';
    resolveMapsLink(text).then(r => {
      const t = `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`;
      setHouse({ lat: r.lat, lng: r.lng });
      state.coordText = t;
      $('coordInput').value = t;
      msg.textContent = `Đã đọc từ link${r.name ? ' (' + r.name + ')' : ''}: ${t}`;
      msg.className = 'hint ok';
    }).catch(e => { msg.textContent = e.message; msg.className = 'hint err'; });
    return true;
  }
  const r = parseCoords(text);
  const msg = $('coordMsg');
  if (r.error) {
    if (!silent) { msg.textContent = r.error; msg.className = 'hint err'; }
    return false;
  }
  setHouse({ lat: r.lat, lng: r.lng });
  state.coordText = text;
  msg.textContent = `Đã đọc: ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`;
  msg.className = 'hint ok';
  return true;
}

function setHouse(h) {
  const prev = state.house;
  state.house = h;
  setAccountLocation(h);
  const moved = prev ? haversineKm(prev, h) : Infinity;
  if (moved > 0.5) {
    if (state.pois.length) toast('Đã đổi vị trí. Bấm Quét tiện ích để tìm lại quanh căn nhà mới.');
    state.pois = []; state.roads = []; state.selected = []; state.selectedRoads = []; state.routes = {}; state.admin = null;
    renderLists();
  } else if (moved > 0.001) {
    for (const p of state.pois) p.km = p.zone ? Math.max(0.05, haversineKm(h, p) - (p.inset || 0)) : haversineKm(h, p);
    state.routes = {};
    renderLists();
    queueRoutes();
  }
  scheduleRebuild();
}

// ---------- Quét ----------
let scanCtrl = null;
async function scan() {
  if (!state.house) { applyCoords($('coordInput').value); if (!state.house) return; }
  scanCtrl?.abort();
  scanCtrl = new AbortController();
  const btn = $('scanBtn');
  btn.disabled = true;
  $('scanLabel').textContent = 'Đang quét…';
  setStatus('Đang tìm tiện ích và đường lớn quanh căn nhà…');
  try {
    const res = await scanArea(state.house, state.radiusKm, scanCtrl.signal, msg => setStatus(msg));
    const manual = state.pois.filter(p => p.manual);
    state.pois = [...res.pois, ...manual];
    state.roads = res.roads;
    state.selected = [...autoPick(res.pois), ...manual.map(p => p.id)].slice(0, MAX_POIS);
    state.selectedRoads = state.roads.slice(0, 3).map(x => x.id);
    state.routes = {};
    state.admin = res.admin;
    if (!state.sub && res.admin?.commune) {
      state.sub = res.admin.commune + (res.admin.provinceShort ? ' · ' + res.admin.provinceShort : '');
      $('subInput').value = state.sub;
    }
    state.scannedAt = Date.now();
    renderLists();
    queueRoutes();
    scheduleRebuild();
    const b = res.admin?.boundary;
    toast(`Tìm thấy ${res.pois.length} tiện ích, ${res.roads.length} tuyến đường lớn` + (b ? `, ranh ${b.short} cách ${formatKm(b.km)}` : '') + `. Đã chọn sẵn ${state.selected.length} điểm.`, 4000);
    if (window.matchMedia('(max-width: 979px)').matches) $('step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message || 'Không quét được. Kiểm tra mạng rồi thử lại.', 5000);
  } finally {
    btn.disabled = false;
    updateScanLabel();
    setStatus('');
  }
}
function updateScanLabel() {
  $('scanLabel').textContent = `Quét tiện ích trong ${String(state.radiusKm).replace('.', ',')} km`;
  $('radiusOut').textContent = String(state.radiusKm).replace('.', ',') + ' km';
}

// Đường đi thật: lần lượt từng điểm (máy chủ công cộng giới hạn tốc độ)
let routeBusy = false;
async function queueRoutes() {
  if (routeBusy) return;
  routeBusy = true;
  try {
    for (;;) {
      const next = state.selected.find(id => !(id in state.routes));
      if (!next) {
        const b = state.admin?.boundary;
        if (b && !('__ranh' in state.routes)) {
          const origin = state.house;
          const r = await routeTo(origin, b.P);
          if (origin !== state.house) continue;
          state.routes.__ranh = r;
          renderAdmin();
          scheduleRebuild();
          continue;
        }
        break;
      }
      const p = state.pois.find(x => x.id === next);
      if (!p) { state.routes[next] = null; continue; }
      const origin = state.house;
      const r = await routeTo(origin, p);
      if (origin !== state.house) continue;
      state.routes[next] = r;
      updateRowKm(next);
      scheduleRebuild();
      await new Promise(res => setTimeout(res, 250));
    }
  } finally { routeBusy = false; }
}

// ---------- Danh sách ----------
function kmText(p) {
  if (p.id in state.routes) {
    const r = state.routes[p.id];
    return r ? formatKm(r.km) : formatKm(p.km, true);
  }
  return state.selected.includes(p.id) ? '…' : formatKm(p.km, true);
}
function updateRowKm(id) {
  const el = document.querySelector(`[data-km="${CSS.escape(id)}"]`);
  const p = state.pois.find(x => x.id === id);
  if (el && p) el.textContent = kmText(p);
}
function updateCount() {
  $('pickCount').textContent = state.pois.length ? `Đã chọn ${state.selected.length}/${MAX_POIS}` : '';
}

function renderAdmin() {
  const box = $('adminBox');
  const a = state.admin;
  if (!a) { box.innerHTML = '<p class="hint">Quét để biết căn nhà thuộc xã/phường, tỉnh/thành nào và cách ranh giới bao xa.</p>'; return; }
  const where = [a.commune, a.province].filter(Boolean).join(' · ') || 'Chưa rõ trên dữ liệu bản đồ';
  let html = `<p class="admin-where"><span>Căn nhà thuộc</span><strong>${esc(where)}</strong></p>`;
  const b = a.boundary;
  if (b) {
    const r = state.routes.__ranh;
    const road = r ? `${formatKm(r.km)} đường đi${r.min ? ` (~${Math.max(1, Math.round(r.min))} phút ô tô)` : ''}` : ('__ranh' in state.routes ? 'chưa tìm được đường đi' : 'đang tính đường đi…');
    html += `<label class="admin-ranh"><input type="checkbox" autocomplete="off" id="useBoundary" ${state.useBoundary ? 'checked' : ''}>
      <span><strong>Ranh ${esc(b.short)}</strong> cách ${formatKm(b.km)} chim bay · ${road}</span></label>`;
  } else {
    html += `<p class="hint">Không có ranh giới tỉnh/thành trong bán kính ${String(state.radiusKm).replace('.', ',')} km.</p>`;
  }
  box.innerHTML = html;
}

function renderLists() {
  renderAdmin();
  const has = state.pois.length || state.roads.length;
  $('results').hidden = !has;
  $('resultsEmpty').hidden = !!has;
  updateCount();
  const rl = $('roadList');
  rl.innerHTML = state.roads.length
    ? state.roads.map(r => `
      <label class="road-chip">
        <input type="checkbox" autocomplete="off" data-road="${esc(r.id)}" ${state.selectedRoads.includes(r.id) ? 'checked' : ''}>
        <span class="dot" style="background:${ROAD_DOT[r.level]}"></span>
        <span>${esc(r.label)}${r.alt ? `<small class="alt"> · ${esc(r.alt)}</small>` : ''}</span>
        <span class="km">${formatKm(r.nearKm, true)}</span>
      </label>`).join('')
    : '<p class="hint">Không có quốc lộ, cao tốc hay đường chính trong bán kính này.</p>';

  const groups = {};
  for (const p of state.pois) (groups[p.cat] ||= []).push(p);
  const cats = Object.keys(CATEGORIES).filter(c => groups[c]).sort((a, b) => CATEGORIES[a].order - CATEGORIES[b].order);
  $('poiList').innerHTML = cats.map(c => {
    const list = groups[c].sort((a, b) => a.km - b.km);
    const nSel = list.filter(p => state.selected.includes(p.id)).length;
    const rows = list.slice(0, 30).map(p => `
      <label class="poi-row${p.manual ? ' manual' : ''}">
        <input type="checkbox" autocomplete="off" data-poi="${esc(p.id)}" ${state.selected.includes(p.id) ? 'checked' : ''}>
        <span class="poi-name">${esc(p.name)}</span>
        <span class="poi-km" data-km="${esc(p.id)}">${kmText(p)}</span>
      </label>`).join('');
    return `<details class="cat-group" ${nSel ? 'open' : ''}>
      <summary><span class="cat-ic" style="background:${CAT_COLORS[c]}">${iconSvg(CATEGORIES[c].icon)}</span>${CATEGORIES[c].label}<span class="n">${nSel ? nSel + ' chọn · ' : ''}${list.length}</span></summary>
      ${rows}
    </details>`;
  }).join('') || '<p class="hint">Không tìm thấy tiện ích có tên trong bán kính này. Thêm điểm thủ công bên dưới.</p>';
}

// ---------- Kịch bản lời đọc theo từng cảnh ----------
const TYPE_WORD = { 'VỊ TRÍ CĂN NHÀ': 'Căn nhà', 'VỊ TRÍ CĂN VILLA': 'Căn villa', 'VỊ TRÍ LÔ ĐẤT': 'Lô đất', 'VỊ TRÍ DỰ ÁN': 'Dự án' };
// Khoảng cách trong kịch bản: viết số kiểu Việt Nam (1,8 km); lúc gửi giọng đọc sẽ đổi thành chữ
function kmSpeak(km) {
  if (km < 0.95) return Math.max(50, Math.round(km * 1000 / 50) * 50) + ' mét';
  return String(km < 10 ? km.toFixed(1) : Math.round(km)).replace('.', ',').replace(/,0$/, '') + ' km';
}
function nameSpeak(s) {
  return String(s || '')
    .replace(/TP\.?\s?HCM/gi, 'Thành phố Hồ Chí Minh')
    .replace(/\bQL\.?\s?(?=\d)/g, 'quốc lộ ')
    .replace(/\bCT\s/g, 'cao tốc ')
    .replace(/\bKCN\b/g, 'khu công nghiệp')
    .replace(/\bUBND\b/gi, 'Ủy ban nhân dân')
    .replace(/\bTHCS\b/g, 'trung học cơ sở')
    .replace(/\bTHPT\b/g, 'trung học phổ thông')
    .replace(/\s*·\s*/g, ', ');
}
function speakable(text) {
  return speakNumbers(speakPhones(nameSpeak(text).replace(/[≈~]\s?/g, 'khoảng ')))
    .replace(/&/g, ' và ')
    .replace(/\s+/g, ' ')
    .trim();
}
const voiceKey = text => speakable(text) + '|' + state.voiceId + '|' + state.voiceSpeed;

// Kịch bản mẫu miễn phí: viết sẵn theo dữ liệu đã quét, không bịa thông tin.
// Mỗi căn có cách viết riêng (theo toạ độ), bấm "Đổi cách viết" để ra phiên bản khác.
function phoneDisplay(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('84') && d.length >= 11) d = '0' + d.slice(2);
  if (d.length < 9 || d.length > 11) return '';
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : d;
}
function scriptSeedBase() {
  const h = state.house ? Math.round(Math.abs(state.house.lat * 1e4) + Math.abs(state.house.lng * 1e4)) : 7;
  return h + (state.scriptSeed || 0) * 7;
}
const CAT_WORD = { truong: 'trường học', cho: 'chợ', yte: 'bệnh viện', kcn: 'khu công nghiệp', congvien: 'công viên', hanhchinh: 'cơ quan hành chính', giaothong: 'bến xe', nganhang: 'ngân hàng' };
const CAT_RANK = ['truong', 'cho', 'yte', 'kcn', 'congvien', 'hanhchinh', 'giaothong', 'nganhang'];
const POI_LINES = {
  truong: ['Con đi học gần, chỉ {d} là tới {n}.', '{n} cách nhà chỉ {d}, đưa đón con rất tiện.', 'Chỉ {d} là tới {n}, con nhỏ đi học thoải mái.'],
  yte: ['{n} cách khoảng {d}, yên tâm khi cần khám chữa bệnh.', 'Cần khám bệnh đã có {n}, chỉ cách {d}.'],
  cho: ['Đi chợ, mua sắm ở {n} chỉ {d}.', '{n} cách {d}, mua sắm hằng ngày rất tiện.', 'Chỉ {d} là tới {n}, đi chợ không cần đi xa.'],
  hanhchinh: ['{n} cách {d}, làm giấy tờ nhanh gọn.', 'Làm giấy tờ ở {n} chỉ cách {d}.'],
  congvien: ['{n} cách {d}, cuối tuần cả nhà có chỗ vui chơi, thư giãn.', 'Chỉ {d} là tới {n}, nơi cả nhà đi dạo, thư giãn.'],
  kcn: ['{n} chỉ cách {d}, thuận tiện cho người đi làm, rất hợp đầu tư cho thuê.', 'Gần {n}, chỉ {d}, người đi làm đi lại dễ dàng.'],
  giaothong: ['{n} cách {d}, đi tỉnh, về quê đều tiện.'],
  nganhang: ['{n} chỉ cách {d}, giao dịch thuận tiện.'],
};
function scriptSegments() {
  const tw = TYPE_WORD[state.typeLabel] || 'Căn nhà';
  const twl = tw.toLowerCase();
  const R = String(state.radiusKm).replace('.', ',');
  const seed = scriptSeedBase();
  const pick = (pool, i = 0) => pool[(seed + i) % pool.length];
  const fill = (tpl, o) => tpl.replace(/\{(\w)\}/g, (_, k) => o[k] ?? '');
  const segs = [];
  const add = (key, label, def) => segs.push({ key, label, def, text: state.scriptEdits[key] ?? def });
  const pois = selectedPois();
  const roads = selectedRoads().slice().sort((a, b) => a.nearKm - b.nearKm);
  // Đường dùng cho câu mở đầu: ưu tiên quốc lộ/cao tốc trong 3 km, không có thì lấy đường gần nhất
  const r0 = roads.filter(r => r.level >= 2 && r.nearKm < 3).sort((a, b) => b.level - a.level || a.nearKm - b.nearKm)[0] || roads[0];
  const title = (state.title || '').trim();
  const generic = !title || /^vị trí\s*(&|và)\s*tiện ích$/i.test(title);
  const loc = (state.sub ? nameSpeak(state.sub)
    : [state.admin?.commune, state.admin?.province].filter(Boolean).map(nameSpeak).join(', '))
    .replace(/^(Xã|Phường|Thị trấn|Đặc khu|Huyện|Quận)(?=\s)/, m => m.toLowerCase());

  // Mở đầu: câu móc kéo người xem ở lại
  const hooks = [
    r0 ? `Đang tìm ${twl} gần ${nameSpeak(r0.label)}, đi đâu cũng tiện? Xem ngay vị trí này nhé!` : `Đang tìm ${twl} đi đâu cũng tiện? Xem ngay vị trí này nhé!`,
    `${tw} này nằm ở đâu, xung quanh có những gì? Cùng xem ngay nhé!`,
    r0 && r0.nearKm < 3 ? `Chỉ ${kmSpeak(r0.nearKm)} là ra ${nameSpeak(r0.label)}, vị trí ${twl} này cực kỳ thuận tiện!` : `Vị trí ${twl} này có gì đặc biệt? Xem ngay nhé!`,
  ];
  add('intro', 'Mở đầu', generic ? pick(hooks) : `${nameSpeak(title)}. Cùng xem vị trí và tiện ích xung quanh nhé!`);
  add('house', 'Căn nhà', loc ? pick([`${tw} nằm tại ${loc}.`, `Đây là vị trí ${twl}, thuộc ${loc}.`], 1) : `Đây là vị trí ${twl} trên bản đồ.`);

  // Kể tối đa 4 nhóm quan trọng nhất cho gọn tai
  const cats = CAT_RANK.filter(c => pois.some(p => p.cat === c)).slice(0, 4).map(c => CAT_WORD[c]);
  const list = cats.length > 1 ? cats.slice(0, -1).join(', ') + ' và ' + cats[cats.length - 1] : cats[0];
  add('overview', 'Toàn cảnh', list
    ? `Trong bán kính ${R} km có đủ ${list}${roads.length ? `, cùng ${roads.length} trục đường lớn` : ''}.`
    : roads.length ? `Cùng xem ${roads.length} trục đường lớn quanh ${twl}.` : `Cùng xem xung quanh ${twl} có gì nhé.`);

  const roadLines = [
    'Chỉ {d} là ra {n}.', 'Ra {n} chỉ khoảng {d}.', '{n} cũng chỉ cách {d}.', 'Từ nhà tới {n} chỉ khoảng {d}.',
  ];
  selectedRoads().forEach((r, i) => {
    const alt = r.alt ? `, đoạn ${nameSpeak(r.alt)}` : '';
    const n = nameSpeak(r.label) + alt;
    const line = r.nearKm < 0.2 ? `${tw} nằm sát ${n}.`
      : r.level === 3 ? `Lên ${nameSpeak(r.label)} chỉ khoảng ${kmSpeak(r.nearKm)}.`
      : fill(roadLines[(seed + i) % roadLines.length], { n, d: kmSpeak(r.nearKm) });
    add('road:' + r.id, nameSpeak(r.label), line);
  });

  const b = state.useBoundary && state.admin?.boundary;
  if (b) {
    const r = state.routes.__ranh;
    const where = b.short === 'TP.HCM' ? 'Thành phố Hồ Chí Minh' : b.short;
    const min = r && r.min ? `, chừng ${Math.max(1, Math.round(r.min))} phút chạy xe` : '';
    add('boundary', 'Ranh ' + b.short, pick([`Qua ranh ${where} chỉ khoảng ${kmSpeak(r ? r.km : b.km)}${min}.`, `Chỉ khoảng ${kmSpeak(r ? r.km : b.km)}${min} là qua ranh ${where}.`], 2));
  }

  const seen = {};
  for (const p of pois) {
    const k = seen[p.cat] = (seen[p.cat] || 0) + 1;
    const pool = POI_LINES[p.cat] || ['{n}, cách khoảng {d}.'];
    add('poi:' + p.id, p.name, fill(pool[(seed + k + 1) % pool.length], { n: nameSpeak(p.name), d: kmSpeak(p.route ? p.route.km : p.km) }));
  }
  if (pois.length || b) add('summary', 'Tổng kết', pick([`Tất cả chỉ trong bán kính ${R} km quanh nhà, sống tiện, đi lại dễ.`, `Mọi tiện ích thiết yếu đều nằm trong bán kính ${R} km.`], 3));

  // Kết: tạo cảm giác khan hiếm + kêu gọi xem nhà (đọc số điện thoại nếu khách nhập)
  const scarce = pick(['Vị trí như thế này không có nhiều.', 'Vị trí đẹp thế này không dễ tìm đâu.', 'Cơ hội sở hữu vị trí này không còn nhiều.'], 4);
  const phone = phoneDisplay(state.phone);
  const brand = (state.brand || '').trim() ? nameSpeak(state.brand.trim()) : '';
  const cta = phone && brand ? `Gọi ngay ${brand}, số ${phone}, để đi xem nhà trực tiếp!`
    : phone ? `Gọi ngay số ${phone} để đi xem nhà trực tiếp!`
    : brand ? `Liên hệ ${brand} để đi xem nhà ngay hôm nay!`
    : 'Liên hệ ngay để đi xem nhà trực tiếp nhé!';
  add('outro', 'Kết', `${scarce} ${cta}`);
  return segs;
}

function renderScript() {
  const box = $('scriptList');
  const segs = scriptSegments();
  const sig = segs.map(s => s.key).join('|');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.innerHTML = segs.map(s => `
      <label class="seg-line">
        <span class="seg-name"><span>${esc(s.label)}</span><span class="vst" data-vst="${esc(s.key)}"></span></span>
        <textarea class="input" rows="2" autocomplete="off" data-seg="${esc(s.key)}">${esc(s.text)}</textarea>
        <span class="seg-say" data-say="${esc(s.key)}"></span>
      </label>`).join('');
  } else {
    for (const s of segs) {
      const ta = box.querySelector(`textarea[data-seg="${CSS.escape(s.key)}"]`);
      if (ta && document.activeElement !== ta && ta.value !== s.text) ta.value = s.text;
    }
  }
  for (const s of segs) {
    const say = box.querySelector(`[data-say="${CSS.escape(s.key)}"]`);
    if (say) { const t = speakable(s.text); say.textContent = t !== s.text.replace(/\s+/g, ' ').trim() ? 'Máy đọc: ' + t : ''; }
    const el = box.querySelector(`[data-vst="${CSS.escape(s.key)}"]`);
    const v = media.voiceSegs.get(s.key);
    if (!el) continue;
    if (v && v.ck === voiceKey(s.text)) { el.textContent = `có giọng · ${v.buffer.duration.toFixed(1).replace('.', ',')} giây`; el.className = 'vst ok'; }
    else { el.textContent = v ? 'đã sửa, cần tạo lại giọng' : ''; el.className = 'vst'; }
  }
}

async function checkAi() {
  try {
    const [a, b] = await Promise.all([
      fetch('/api/tts').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/script').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    ai.tts = !!a?.ready; ai.ttsProvider = a?.provider || null; ai.script = !!b?.ready;
    ai.gated = a?.gated !== false;
    if (a?.voices?.length) renderVoices(a.voices);
  } catch { /* để mặc định */ }
  const prov = { fpt: 'FPT.AI', google: 'Google' }[ai.ttsProvider] || '';
  $('aiStatus').textContent = ai.tts
    ? `Giọng AI đã sẵn sàng${prov ? ' (' + prov + ')' : ''}. Bấm Tạo giọng đọc AI, video tự giãn theo từng câu.`
    : 'Giọng AI chưa bật trên máy chủ (cần khoá FPT.AI hoặc Google TTS). Kịch bản vẫn sửa và chép được để tự ghi âm.';
  $('aiScriptBtn').hidden = !ai.script;
}

function renderVoices(list) {
  ai.voices = list;
  const seg = $('voiceSeg');
  seg.innerHTML = list.map(v => `<button type="button" role="radio" data-v="${esc(v.id)}">${esc(v.label)}</button>`).join('');
  if (!list.some(v => v.id === state.voiceId)) {
    const male = /^(g-)?nam/.test(state.voiceId);
    state.voiceId = (list.find(v => /^(g-)?nam/.test(v.id) === male) || list[0]).id;
  }
  setSeg('voiceSeg', state.voiceId);
}

function altScript() {
  state.scriptSeed = (state.scriptSeed || 0) + 1;
  state.scriptEdits = {};
  media.voiceSegs.clear();
  renderScript(); scheduleRebuild(); save();
  $('ttsMsg').textContent = 'Đã đổi sang cách viết khác. Bấm Tạo giọng đọc AI để đọc kịch bản mới.';
}

async function aiRewrite() {
  const segs = scriptSegments();
  if (!ai.script) { altScript(); return; }
  const btn = $('aiScriptBtn');
  btn.disabled = true;
  $('ttsMsg').textContent = 'AI đang viết kịch bản…';
  try {
    const facts = {
      loai_bds: TYPE_WORD[state.typeLabel] || 'Căn nhà', tieu_de: state.title, dong_phu: state.sub, thuong_hieu: state.brand,
      so_dien_thoai_lien_he: phoneDisplay(state.phone) || null,
      ban_kinh_km: state.radiusKm, tinh_thanh: state.admin?.province || '', xa_phuong: state.admin?.commune || '',
      duong_lon: selectedRoads().map(r => ({ ten: r.label, ten_duong: r.alt || '', cach_km: +r.nearKm.toFixed(2) })),
      ranh_gioi: state.useBoundary && state.admin?.boundary ? { tinh: state.admin.boundary.short, chim_bay_km: +state.admin.boundary.km.toFixed(2), duong_di_km: state.routes.__ranh ? +state.routes.__ranh.km.toFixed(2) : null, phut_o_to: state.routes.__ranh?.min ? Math.round(state.routes.__ranh.min) : null } : null,
      tien_ich: selectedPois().map(p => ({ ten: p.name, nhom: CATEGORIES[p.cat].label, cach_km: +(p.route ? p.route.km : p.km).toFixed(2) })),
    };
    const segments = Object.fromEntries(segs.map(s => [s.key, `${s.label} — mẫu: ${s.def}`]));
    if (ai.gated && !account.profile && !(await requireLogin('Đăng nhập để AI viết kịch bản.'))) { $('ttsMsg').textContent = ''; return; }
    const res = await fetch('/api/script', {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ facts, segments, lat: state.house?.lat, lng: state.house?.lng }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (await handleAiError(res.status, j)) { $('ttsMsg').textContent = j.error || ''; return; }
      throw new Error(j.error || 'HTTP ' + res.status);
    }
    state.scriptEdits = { ...j.segments };
    renderScript(); scheduleRebuild(); save();
    $('ttsMsg').textContent = 'AI đã viết xong. Sửa câu nào chưa ưng rồi bấm Tạo giọng đọc AI.';
  } catch (e) {
    $('ttsMsg').textContent = 'AI viết kịch bản chưa dùng được (' + e.message + '). Kịch bản mẫu miễn phí vẫn dùng bình thường, bấm "Đổi cách viết" để ra phiên bản khác.';
  } finally { btn.disabled = false; }
}

let ttsBusy = false;
// Gọi /api/tts một lần; FPT chưa tạo xong thì hỏi lại link cho tới khi có file
async function ttsRequest(text, onWait, attempt = 0) {
  const res = await fetch('/api/tts', {
    method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ text, voice: state.voiceId, speed: state.voiceSpeed, lat: state.house?.lat, lng: state.house?.lng }),
  });
  // Nhiều khách tạo giọng cùng lúc: máy chủ báo đông thì tự xếp hàng thử lại vài lần
  if (res.status === 429 && attempt < 3) {
    const j = await res.clone().json().catch(() => ({}));
    if (j.code === 'RATE_LIMIT' && j.provider !== 'fpt') {
      const wait = 3000 * (attempt + 1) + Math.random() * 1500;
      onWait?.(-1);
      await new Promise(r => setTimeout(r, wait));
      return ttsRequest(text, onWait, attempt + 1);
    }
  }
  if (res.status === 202) {
    let { pending } = await res.json();
    const t0 = Date.now();
    while (pending && Date.now() - t0 < 180000) {
      onWait?.(Math.round((Date.now() - t0) / 1000));
      await new Promise(r => setTimeout(r, 2500));
      const p = await fetch('/api/tts?poll=' + encodeURIComponent(pending));
      if (p.status === 202) continue;
      if (!p.ok) throw new Error('Không lấy được file giọng đọc, thử lại.');
      return await p.arrayBuffer();
    }
    throw new Error('FPT tạo giọng quá lâu, bấm lại sau ít phút.');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const e = new Error(j.error || 'HTTP ' + res.status);
    e.status = res.status; e.body = j;
    throw e;
  }
  return await res.arrayBuffer();
}

async function generateVoices() {
  if (ttsBusy) return;
  if (!ai.tts) { await checkAi(); if (!ai.tts) { toast('Giọng AI chưa bật trên máy chủ.', 3500); return; } }
  if (ai.gated && !account.profile && !(await requireLogin('Đăng nhập để tạo giọng đọc AI. Tài khoản mới có lượt dùng thử miễn phí.'))) return;
  const segs = scriptSegments().filter(s => speakable(s.text));
  const todo = segs.filter(s => { const cur = media.voiceSegs.get(s.key); return !(cur && cur.ck === voiceKey(s.text)); });
  const msg = $('ttsMsg');
  if (!todo.length) { msg.textContent = 'Giọng đọc đã khớp với kịch bản hiện tại.'; return; }
  ttsBusy = true;
  const btn = $('ttsBtn');
  btn.disabled = true;
  try {
    // Gộp nhiều câu vào một lần gọi để không chạm giới hạn tốc độ. Google nhận tối đa 5.000 byte mỗi lần
    // (chữ có dấu tốn 2–3 byte), nên tính theo byte và chừa dư
    const bytes = t => new TextEncoder().encode(t).length;
    const groups = [];
    let cur = [];
    for (const s of todo) {
      const len = bytes(joinForTts([...cur, s].map(x => speakable(x.text))));
      if (cur.length && len > 4300) { groups.push(cur); cur = []; }
      cur.push(s);
    }
    if (cur.length) groups.push(cur);
    let made = 0;
    for (let g = 0; g < groups.length; g++) {
      const grp = groups[g];
      const parts = grp.map(s => speakable(s.text));
      const label = groups.length > 1 ? ` (phần ${g + 1}/${groups.length})` : '';
      msg.textContent = `Đang tạo giọng cho ${grp.length} câu${label}…`;
      const ab = await ttsRequest(joinForTts(parts), sec => {
        msg.textContent = sec < 0 ? `Máy chủ giọng đọc đang đông, đang xếp hàng${label}…` : `Đang đọc ${grp.length} câu${label}… ${sec} giây`;
      });
      const whole = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(ab);
      const pieces = splitVoice(whole, parts);
      grp.forEach((s, i) => media.voiceSegs.set(s.key, { ck: voiceKey(s.text), buffer: pieces[i] }));
      made += grp.length;
      renderScript();
    }
    state.aiVoiceOn = true; $('aiVoiceOn').checked = true;
    msg.textContent = `Đã tạo giọng cho ${made} câu. Video đã giãn theo lời đọc, bấm phát để nghe.`;
    media.mixKey = '';
    scheduleRebuild();
  } catch (e) {
    if (e.status && await handleAiError(e.status, e.body)) msg.textContent = e.body?.error || 'Cần đăng nhập hoặc thêm lượt để tạo giọng.';
    else msg.textContent = 'Tạo giọng lỗi: ' + e.message;
  } finally {
    ttsBusy = false;
    btn.disabled = false;
  }
}

function renderSwatches(id, key, withAuto) {
  const el = $(id);
  el.innerHTML = Object.entries(LINE_THEMES).filter(([k]) => withAuto || k !== 'auto').map(([k, th]) => {
    const bg = th.core || 'conic-gradient(#FF8A1F 0 33%, #FFC93C 0 66%, #FFE59A 0)';
    return `<button type="button" role="radio" class="swatch" data-v="${k}" aria-checked="${state[key] === k}"><span class="sw" style="background:${bg};--glow:${th.glow || 'transparent'}"></span>${esc(th.label)}</button>`;
  }).join('');
  el.onclick = e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    state[key] = b.dataset.v;
    for (const x of el.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
    scheduleRebuild();
  };
}

// ---------- Xuất video ----------
let exportCtrl = null;
let resultUrl = null;
let resultFile = null;
function progress(pct, text) {
  $('progBar').style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
  $('progText').textContent = text;
}
let gating = false;
async function doExport() {
  if (!state.house) { toast('Nhập toạ độ căn nhà trước.'); return; }
  if (exporting || gating) return;
  gating = true;
  $('exportBtn').disabled = true;
  let gate = null;
  try { gate = await beginExport(state.house); }
  finally { gating = false; $('exportBtn').disabled = false; }
  if (!gate) return;
  if (gate.charged) toast(`Đã trừ 1 lượt, còn ${gate.profile.credits} lượt. Xuất lại vị trí này trong 24 giờ không trừ thêm.`, 4200);
  pause();
  toggleEdit(false);
  exporting = true;
  exportCtrl = new AbortController();
  const signal = exportCtrl.signal;
  $('exportBtn').disabled = true;
  $('exportBox').hidden = false;
  $('resultBox').hidden = true;
  let wake = null;
  try { wake = await navigator.wakeLock?.request('screen'); } catch { /* không bắt buộc */ }
  try {
    const xtl = buildTimeline(buildScene(), state.fmt, timelineOpts());
    const q = state.quality === '720' ? 720 : 1080;
    const F = FORMATS[state.fmt];
    const width = state.fmt === 'h' ? Math.round(q * 16 / 9) : q;
    const height = Math.round(width * F.LH / F.LW);
    const scale = width / F.LW;
    progress(1, 'Đang tải ảnh vệ tinh…');
    await preloadTiles(xtl, scale, cache, (d, n) => progress(2 + 26 * d / Math.max(1, n), `Đang tải ảnh vệ tinh ${d}/${n}`), signal);
    if (signal.aborted) throw new DOMException('Đã huỷ', 'AbortError');
    await fontsReady();
    let audio = null;
    const A = audioPlan(xtl);
    if (media.music || A.voice || A.segs.length || A.sfx) {
      progress(29, 'Đang trộn âm thanh…');
      audio = await mixAudio({ music: media.music, voice: A.voice, voiceSegs: A.segs, sfx: A.sfx, duration: xtl.duration, musicVol: state.musicVol });
    }
    let blob;
    const onProgress = (stage, d, n) => {
      if (stage === 'frames') progress(30 + 66 * d / n, `Đang dựng video ${Math.round(100 * d / n)}%`);
      else if (stage === 'audio') progress(97, 'Đang ghép âm thanh…');
    };
    if (canEncodeMp4()) {
      try {
        blob = await exportMp4({ tl: xtl, width, height, fps: 30, cache, audioBuffer: audio, onProgress, signal });
      } catch (e) {
        if (e.code !== 'NO_AUDIO_ENCODER') throw e;
        progress(30, 'Đang quay theo thời gian thực để giữ âm thanh…');
        blob = await exportRealtime({ tl: xtl, width, height, fps: 30, cache, audioBuffer: audio, onProgress, signal });
      }
    } else {
      progress(30, 'Máy này không hỗ trợ dựng nhanh, đang quay theo thời gian thực…');
      blob = await exportRealtime({ tl: xtl, width, height, fps: 30, cache, audioBuffer: audio, onProgress, signal });
    }
    const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
    const name = `video-vi-tri-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.${ext}`;
    resultFile = new File([blob], name, { type: blob.type });
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    $('resultVideo').src = resultUrl;
    $('resultBox').hidden = false;
    $('resultMeta').textContent = `${width}×${height} · ${Math.round(xtl.duration)} giây · ${(blob.size / 1048576).toFixed(1)} MB · ${ext.toUpperCase()}`;
    $('shareBtn').hidden = !(navigator.canShare && navigator.canShare({ files: [resultFile] }));
    progress(100, 'Xong');
    toast('Đã dựng xong video.');
    $('resultBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    const keep = gate?.charged || gate?.mode === 'unlimited' ? ' Lượt đã trừ vẫn giữ: xuất lại vị trí này trong 24 giờ không mất thêm lượt.' : '';
    if (e.name === 'AbortError') toast('Đã huỷ xuất video.' + keep, keep ? 5000 : 2600);
    else { console.error(e); toast('Xuất video lỗi: ' + (e.message || e) + keep, 7000); }
  } finally {
    exporting = false;
    dirty = true;
    $('exportBtn').disabled = false;
    $('exportBox').hidden = true;
    try { await wake?.release(); } catch { /* bỏ qua */ }
  }
}
function saveResult() {
  if (!resultUrl) return;
  const a = document.createElement('a');
  a.href = resultUrl;
  a.download = resultFile.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function shareResult() {
  try { await navigator.share({ files: [resultFile], title: 'Video vị trí' }); }
  catch (e) { if (e.name !== 'AbortError') toast('Không chia sẻ được: ' + e.message); }
}

async function fontsReady() {
  try {
    await Promise.race([
      Promise.all(['500', '700', '800'].map(w => document.fonts.load(`${w} 20px ${FONT}`, 'Vị trí ạ'))),
      new Promise(r => setTimeout(r, 4000)),
    ]);
  } catch { /* dùng phông dự phòng */ }
}

// ---------- Âm thanh ----------
async function pickAudio(kind, file) {
  if (!file) return;
  try {
    const buf = await decodeAudioFile(file);
    media[kind] = buf;
    media[kind + 'Name'] = file.name;
    $(kind + 'Name').textContent = `${file.name} · ${fmtTime(buf.duration)}`;
    $(kind + 'Clear').hidden = false;
    media.mixKey = '';
    scheduleRebuild();
  } catch {
    toast('Không đọc được file âm thanh này. Thử file MP3, M4A hoặc WAV.', 4000);
  }
}
function clearAudio(kind) {
  media[kind] = null;
  media[kind + 'Name'] = '';
  $(kind + 'Name').textContent = 'Chưa có';
  $(kind + 'Clear').hidden = true;
  $(kind + 'File').value = '';
  media.mixKey = '';
  scheduleRebuild();
}

// ---------- Cài app ----------
let deferredPrompt = null;
function setupInstall() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('installBtn').hidden = false;
  });
  window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; toast('Đã cài app lên máy.'); });
  if (isIos && !standalone) $('installBtn').hidden = false;
  $('installBtn').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('installBtn').hidden = true;
    } else if (isIos) {
      $('iosTip').hidden = false;
    } else {
      toast('Mở menu trình duyệt, chọn "Cài đặt ứng dụng" hoặc "Thêm vào màn hình chính".', 4000);
    }
  });
  $('iosTipClose').addEventListener('click', () => ($('iosTip').hidden = true));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- Gắn sự kiện ----------
function init() {
  load();
  const sel = new Set(state.selected);
  state.selected = [...sel];

  $('coordInput').value = state.coordText;
  $('labelInput').value = state.label;
  $('subInput').value = state.sub;
  $('radiusInput').value = state.radiusKm;
  $('titleInput').value = state.title;
  $('brandInput').value = state.brand;
  $('musicVol').value = state.musicVol;
  $('fitVoice').checked = state.fitVoice;
  setSeg('typeSeg', state.typeLabel);
  setSeg('fmtSeg', state.fmt);
  setSeg('speedSeg', state.speed);
  setSeg('qualSeg', state.quality);
  $('canvasWrap').dataset.fmt = state.fmt;
  updateScanLabel();
  $('addCat').innerHTML = Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  let coordTimer;
  $('coordInput').addEventListener('input', e => {
    clearTimeout(coordTimer);
    coordTimer = setTimeout(() => applyCoords(e.target.value), 450);
  });
  $('coordInput').addEventListener('change', e => applyCoords(e.target.value));
  $('pasteBtn').addEventListener('click', async () => {
    try {
      const txt = await navigator.clipboard.readText();
      $('coordInput').value = txt;
      applyCoords(txt);
    } catch {
      $('coordInput').focus();
      toast('Nhấn giữ vào ô toạ độ rồi chọn Dán.');
    }
  });
  bindSeg('typeSeg', v => {
    state.typeLabel = v; state.label = v; $('labelInput').value = v; scheduleRebuild();
  });
  $('labelInput').addEventListener('input', e => { state.label = e.target.value; scheduleRebuild(); });
  $('subInput').addEventListener('input', e => { state.sub = e.target.value.trim(); scheduleRebuild(); });
  $('radiusInput').addEventListener('input', e => {
    state.radiusKm = parseFloat(e.target.value);
    updateScanLabel();
    scheduleRebuild();
  });
  $('scanBtn').addEventListener('click', scan);

  $('adminBox').addEventListener('change', e => {
    if (e.target.id !== 'useBoundary') return;
    state.useBoundary = e.target.checked;
    scheduleRebuild();
  });
  $('roadList').addEventListener('change', e => {
    const id = e.target.dataset.road;
    if (!id) return;
    state.selectedRoads = e.target.checked ? [...new Set([...state.selectedRoads, id])] : state.selectedRoads.filter(x => x !== id);
    scheduleRebuild();
  });
  $('poiList').addEventListener('change', e => {
    const id = e.target.dataset.poi;
    if (!id) return;
    if (e.target.checked) {
      if (state.selected.length >= MAX_POIS) {
        e.target.checked = false;
        toast(`Tối đa ${MAX_POIS} tiện ích để video không quá dài.`);
        return;
      }
      state.selected = [...state.selected, id];
      queueRoutes();
    } else state.selected = state.selected.filter(x => x !== id);
    updateRowKm(id);
    updateCount();
    scheduleRebuild();
  });
  const runAddSearch = async () => {
    const q = $('addSearch').value.trim();
    const box = $('addResults');
    const msg = $('addMsg');
    if (!q) { $('addSearch').focus(); return; }
    msg.textContent = ''; msg.className = 'hint';
    if (SHORT_LINK.test(q) || /google\.[a-z.]+\/maps|@-?\d+\.\d+,/.test(q)) {
      box.innerHTML = '<p class="hint">Đang đọc link…</p>';
      try {
        const r = (await resolveMapsLink(q)) || (() => { const c = parseCoords(q); if (c.error) throw new Error(c.error); const nm = q.match(/\/maps\/place\/([^/@?]+)/); return { ...c, name: nm ? decodeURIComponent(nm[1].replace(/\+/g, ' ')) : '' }; })();
        box.innerHTML = '';
        $('addCoord').value = `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`;
        if (r.name) { $('addName').value = r.name; $('addCat').value = guessCategory({ name: r.name }); }
        msg.textContent = r.name ? 'Đã điền tên và toạ độ từ link. Kiểm tra nhóm rồi bấm Thêm vào video.' : 'Đã điền toạ độ từ link. Nhập tên điểm rồi bấm Thêm vào video.';
        msg.className = 'hint ok';
        (r.name ? $('addBtn') : $('addName')).focus();
      } catch (e) { box.innerHTML = ''; msg.textContent = e.message; msg.className = 'hint err'; }
      return;
    }
    box.innerHTML = '<p class="hint">Đang tìm…</p>';
    try {
      const list = (await searchPlaces(q, state.house)).filter(x => x.km <= Math.max(25, state.radiusKm * 3)).slice(0, 8);
      window.__addResults = list;
      box.innerHTML = list.length ? list.map((x, i) => `<button type="button" class="add-hit" data-i="${i}">
          <span class="add-hit-name">${esc(x.name)}</span><span class="add-hit-km">${formatKm(x.km, true)}</span>
          <span class="add-hit-where">${esc(x.where || '')}</span></button>`).join('')
        : '<p class="hint">Không tìm thấy trên bản đồ mở. Mở Google Maps, bấm Chia sẻ địa điểm đó rồi dán link vào ô trên.</p>';
    } catch { box.innerHTML = '<p class="hint err">Tìm kiếm đang lỗi, thử lại sau hoặc dán link Google Maps.</p>'; }
  };
  $('addSearchBtn').addEventListener('click', runAddSearch);
  $('addSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runAddSearch(); } });
  $('addResults').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const x = window.__addResults?.[+b.dataset.i];
    if (!x) return;
    $('addName').value = x.name;
    $('addCoord').value = `${x.lat.toFixed(6)}, ${x.lng.toFixed(6)}`;
    $('addCat').value = guessCategory(x);
    $('addResults').innerHTML = '';
    $('addMsg').textContent = 'Đã chọn. Kiểm tra nhóm rồi bấm Thêm vào video.';
    $('addMsg').className = 'hint ok';
    $('addBtn').focus();
  });
  $('addBtn').addEventListener('click', async () => {
    const msg = $('addMsg');
    let r;
    if (SHORT_LINK.test($('addCoord').value)) {
      try {
        const x = await resolveMapsLink($('addCoord').value);
        r = { lat: x.lat, lng: x.lng };
        $('addCoord').value = `${x.lat.toFixed(6)}, ${x.lng.toFixed(6)}`;
        if (!$('addName').value.trim() && x.name) $('addName').value = x.name;
      } catch (e) { msg.textContent = e.message; msg.className = 'hint err'; return; }
    } else r = parseCoords($('addCoord').value);
    const name = $('addName').value.trim();
    if (!name) { msg.textContent = 'Nhập tên điểm.'; msg.className = 'hint err'; return; }
    if (r.error) { msg.textContent = r.error; msg.className = 'hint err'; return; }
    const km = haversineKm(state.house, r);
    const p = { id: 'm' + Date.now(), name, cat: $('addCat').value, kind: 'manual', lat: r.lat, lng: r.lng, km, manual: true };
    state.pois.push(p);
    if (state.selected.length < MAX_POIS) state.selected.push(p.id);
    $('addName').value = ''; $('addCoord').value = '';
    msg.textContent = `Đã thêm, cách căn nhà ${formatKm(km, true)}.`;
    msg.className = 'hint ok';
    renderLists();
    queueRoutes();
    scheduleRebuild();
  });

  bindSeg('fmtSeg', v => { state.fmt = v; $('canvasWrap').dataset.fmt = v; layoutCanvas(); scheduleRebuild(); });
  bindSeg('speedSeg', v => { state.speed = v; scheduleRebuild(); });
  bindSeg('qualSeg', v => { state.quality = v; save(); });
  $('titleInput').addEventListener('input', e => { state.title = e.target.value; scheduleRebuild(); });
  $('brandInput').addEventListener('input', e => { state.brand = e.target.value; scheduleRebuild(); });
  $('musicFile').addEventListener('change', e => pickAudio('music', e.target.files[0]));
  $('voiceFile').addEventListener('change', e => pickAudio('voice', e.target.files[0]));
  $('musicClear').addEventListener('click', () => clearAudio('music'));
  $('voiceClear').addEventListener('click', () => clearAudio('voice'));
  $('musicVol').addEventListener('input', e => { state.musicVol = parseFloat(e.target.value); media.mixKey = ''; save(); });
  $('fitVoice').addEventListener('change', e => { state.fitVoice = e.target.checked; scheduleRebuild(); });
  renderSwatches('roadThemeRow', 'roadTheme', true);
  renderSwatches('routeThemeRow', 'routeTheme', false);
  setSeg('voiceSeg', state.voiceId);
  setSeg('vspeedSeg', String(state.voiceSpeed));
  $('sfxOn').checked = state.sfxOn;
  $('sfxVol').value = state.sfxVol;
  $('aiVoiceOn').checked = state.aiVoiceOn;
  bindSeg('voiceSeg', v => { state.voiceId = v; renderScript(); save(); });
  bindSeg('vspeedSeg', v => { state.voiceSpeed = Number(v); renderScript(); save(); });
  $('sfxOn').addEventListener('change', e => { state.sfxOn = e.target.checked; media.mixKey = ''; save(); });
  $('sfxVol').addEventListener('input', e => { state.sfxVol = parseFloat(e.target.value); media.mixKey = ''; save(); });
  $('aiVoiceOn').addEventListener('change', e => { state.aiVoiceOn = e.target.checked; scheduleRebuild(); });
  $('aiScriptBtn').addEventListener('click', aiRewrite);
  $('altScriptBtn').addEventListener('click', altScript);
  $('phoneInput').value = state.phone || '';
  $('phoneInput').addEventListener('input', e => { state.phone = e.target.value; renderScript(); scheduleRebuild(); });
  $('ttsBtn').addEventListener('click', generateVoices);
  $('scriptList').addEventListener('input', e => {
    const k = e.target.dataset.seg;
    if (!k) return;
    state.scriptEdits[k] = e.target.value;
    renderScript();
    clearTimeout(window.__segTimer);
    window.__segTimer = setTimeout(() => { scheduleRebuild(); save(); }, 500);
  });
  checkAi();
  $('copyScript').addEventListener('click', async () => {
    const all = scriptSegments().map(x => x.text).join('\n');
    try { await navigator.clipboard.writeText(all); toast('Đã chép toàn bộ lời đọc.'); }
    catch { toast('Trình duyệt chặn chép, hãy chép từng ô lời đọc.'); }
  });

  $('playBtn').addEventListener('click', () => (playing ? pause() : play()));
  $('scrub').addEventListener('input', e => {
    if (!tl) return;
    if (editing) toggleEdit(false);
    t = parseInt(e.target.value, 10) / 1000 * tl.duration;
    if (playing) startAudio();
    updateTimeUi();
    dirty = true;
  });
  $('editPinBtn').addEventListener('click', () => toggleEdit());
  canvas.addEventListener('click', e => {
    if (!editing) { playing ? pause() : play(); return; }
    const rect = canvas.getBoundingClientRect();
    const ll = editTapToLatLng(state.house, state.fmt, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    const text = `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
    $('coordInput').value = text;
    state.coordText = text;
    setHouse(ll);
    $('coordMsg').textContent = 'Đã dời ghim tới ' + text;
    $('coordMsg').className = 'hint ok';
    dirty = true;
  });

  $('exportBtn').addEventListener('click', doExport);
  $('cancelBtn').addEventListener('click', () => exportCtrl?.abort());
  $('saveBtn').addEventListener('click', saveResult);
  $('shareBtn').addEventListener('click', shareResult);

  setupInstall();
  setAccountLocation(state.house);
  initAccount({ toast });
  new ResizeObserver(() => layoutCanvas()).observe($('canvasWrap').parentElement);
  window.addEventListener('resize', layoutCanvas);
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });

  layoutCanvas();
  renderLists();
  if (!state.scannedAt) {
    $('coordMsg').textContent = 'Toạ độ ví dụ. Dán toạ độ căn nhà của anh/chị để bắt đầu.';
    $('coordMsg').className = 'hint';
  }
  fontsReady().then(() => { dirty = true; });
  rebuild();
  requestAnimationFrame(frame);
  queueRoutes();
}

init();
