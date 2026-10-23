// Điều khiển giao diện: nhập toạ độ → quét → chọn → xem trước → xuất video.
import { parseCoords, haversineKm, formatKm } from './geo.js';
import { CATEGORIES, scanArea, autoPick, routeTo, searchPlaces, guessCategory } from './data.js';
import { ICON_PATHS } from './icons.js';
import {
  FORMATS, TileCache, setImageryToken, buildTimeline, render, renderEdit, editTapToLatLng, lotAreaM2, formatArea, CAT_COLORS, FONT, LINE_THEMES, STYLES, BASES,
} from './render.js';
import { sfxEvents } from './sfx.js';
import { stretchBuffer } from './stretch.js';
import { decodeAudioFile, mixAudio, preloadTiles, exportMp4, exportRealtime, canEncodeMp4, unlockAudioContext } from './export.js';
import { initAccount, setAccountLocation, beginExport, requireLogin, authHeaders, handleAiError, account, openPricing, rpc, refreshAccount } from './account.js';
import { splitVoice, joinForTts, splitAt } from './voicesplit.js';
import { loadConfig, initTracking, countVisit } from './track.js';
import { initInstall } from './install.js';
import { initLeads, downloadPageQr, pageUrl, openLeads } from './leads.js';
import { SB_URL, SB_KEY } from './sb.js';
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
  price: '',         // thông tin căn nhà hiện trên video + giọng đọc
  area: '',
  beds: '',
  thoCu: '',         // diện tích đất thổ cư
  floors: '',        // số tầng (nhà)
  legal: '',
  subsOn: true,      // phụ đề chạy chữ theo giọng AI
  logoBg: true,      // nền trắng sau logo
  musicLib: '',      // nhạc nền có sẵn đang chọn
  simple: undefined, // chế độ 3 bước cho người mới
  coordSet: false,   // đã tự nhập toạ độ (không phải toạ độ ví dụ)
  cloudId: null,     // căn đang mở đã lưu theo tài khoản
  projName: '',
  scriptSeed: 0,
  fmt: 'v',
  speed: 'nhanh', // nhịp máy lia mặc định: nhanh
  speedV: 2, // 2 = nhãn nhịp đã sửa đúng (trước đó Nhanh/Chậm bị ngược)
  quality: '1080',
  musicVol: 0.8,
  fitVoice: true,
  style: 'neon',     // phong cách video
  base: 'vetinh',    // nền bản đồ
  flow: 'lanluot',   // cách hiện tiện ích: lanluot | radar
  lot: [],           // ranh lô đất khách tự vẽ [{lat,lng}]
  lotText: '',       // chữ 3D nằm trên lô
  adminArea: null,   // ranh xã/phường + tỉnh {ward, province} (KHÁC state.area = diện tích khách nhập)
  areaWard: '', areaProv: '', roadWidth: '',
  showStreets: true, // vẽ đường quanh nhà kiểu đường nhựa
  aiTone: '', // phong cách kịch bản AI — để trống, khách phải tự chọn trước khi tạo
  scriptMode: 'ai', // 'ai' = AI viết (mặc định, nổi bật) | 'mau' = kịch bản mẫu
  voSig: '', // lựa chọn (cách viết + phong cách) của lần tạo giọng gần nhất
  lotArea: '',       // diện tích hiển thị (trống = tự tính)
  stars: [],         // id tiện ích được khoanh vùng nổi bật
  pageVideo: '',     // link video đã đăng (gắn vào trang web căn nhà)
  pageDesc: '',
  roadTheme: 'auto',
  routeTheme: 'vang',
  roadLabelFace: 'trang', // chữ tên trục đường: trang (mặc định) | vang — chữ phẳng đổ bóng
  labelV: 2,
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
const media = { music: null, voice: null, musicName: '', voiceName: '', mixed: null, mixKey: '', voiceSegs: new Map(), logo: null, photos: [] };
const LOGO_STORE = 'vitri.logo.v1';
const ai = { tts: false, ttsProvider: null, script: false, gated: true, voices: null };

// ---------- Lưu dự án gần nhất ----------
function save() {
  const data = { ...state };
  try { localStorage.setItem(STORE, JSON.stringify(data)); }
  catch {
    try { localStorage.setItem(STORE, JSON.stringify({ ...data, roads: [], routes: {} })); } catch { /* bỏ qua */ }
  }
}
// Dữ liệu lưu trước 10/2026: nhãn nhịp bị ngược → đổi Chậm↔Nhanh để video giữ đúng tốc độ khách đã thấy
function fixSpeed(o) {
  if (!o || o.speedV === 2) return o;
  if (o.speed === 'cham') o.speed = 'nhanh'; else if (o.speed === 'nhanh') o.speed = 'cham';
  o.speedV = 2;
  return o;
}
function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const o = fixSpeed(JSON.parse(raw));
      // 23/10/2026: mặc định chữ trục đường đổi từ Vàng kim sang Trắng bóng
      if (o.labelV !== 2) { if (!o.roadLabelFace || o.roadLabelFace === 'vangkim') o.roadLabelFace = 'trang'; o.labelV = 2; }
      if (o.roadLabelFace === 'vangkim') o.roadLabelFace = 'vang'; // bỏ kiểu Vàng kim (23/10): còn Trắng / Vàng
      Object.assign(state, o);
    }
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
    .map(p => ({ ...p, route: state.routes[p.id] || null, star: (state.stars || []).includes(p.id) }))
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
    logo: media.logo,
    logoBg: state.logoBg,
    photos: media.photos.map(p => p.img),
    info: { price: state.price, area: state.area, thoCu: state.thoCu, beds: state.beds, legal: state.legal },
    radiusKm: state.radiusKm,
    speed: state.speed,
    pois: selectedPois(),
    roads: selectedRoads(),
    boundary: state.useBoundary && state.admin?.boundary ? { ...state.admin.boundary, route: state.routes.__ranh || null } : null,
    provinceShort: state.admin?.provinceShort || '',
    commune: state.admin?.commune || '',
    titleSub: state.sub,
    style: state.style,
    base: state.base,
    flow: state.flow,
    lot: state.lot && state.lot.length >= 3 ? state.lot : null,
    lotLabel: { text: state.lotText, area: state.lotArea },
    streets: state.streets || null,
    adminArea: state.adminArea ? {
      ward: state.adminArea.ward, province: state.adminArea.province,
      wardName: (state.areaWard || '').trim() || state.adminArea.ward?.name || state.admin?.commune || '',
      provName: (state.areaProv || '').trim() || state.adminArea.province?.name || state.admin?.province || '',
    } : null,
    roadWidth: (state.roadWidth || '').trim(),
    showStreets: state.showStreets !== false,
    roadTheme: state.roadTheme,
    routeTheme: state.routeTheme,
    roadLabelFace: state.roadLabelFace,
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
    const b = voiceBuf(sg);
    if (b) { out[sg.key] = b.duration; n++; }
  }
  return n ? out : null;
}
// Chữ của các câu đã có giọng: dùng làm phụ đề chạy theo lời đọc
function captionTexts() {
  if (!state.subsOn || !state.aiVoiceOn) return null;
  const out = {};
  for (const sg of scriptSegments()) {
    if (voiceOk(sg)) out[sg.key] = sg.text;
  }
  return out;
}
function timelineOpts() {
  const vd = voiceDurations();
  return vd ? { voice: vd, captions: captionTexts() } : { fitDuration: voiceFitDuration() };
}
function voiceSegsFor(T) {
  if (!state.aiVoiceOn) return [];
  const byKey = {};
  for (const sg of scriptSegments()) {
    const b = voiceBuf(sg);
    if (b) byKey[sg.key] = b;
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
loadConfig().then(c => c?.arcgis && setImageryToken(c.arcgis));
let tl = null;
let t = 0;
let playing = false;
let editing = false;
const poiOpen = new Set(); // nhóm tiện ích đã bấm Xem thêm
let editMode = 'pin'; // pin | lot
let lotZoom = 18.5;  // mức phóng khi vẽ lô đất (17–20.5)
let dirty = true;
let lastFrame = 0;
let audioCtx = null;
let audioSrc = null;
let exporting = false;

// Cho phép soát lỗi từ bảng điều khiển trình duyệt
window.__vitri = { get tl() { return tl; }, get t() { return t; }, state, scanArea };

function rebuild() {
  if (photoKey(state.house) !== photoHouse) { restorePhotos(); showPageResult(); }
  if (!state.house) return;
  tl = buildTimeline(buildScene(), state.fmt, timelineOpts());
  if (t > tl.duration) t = 0;
  $('durLabel').textContent = '≈ ' + Math.round(tl.duration) + ' giây';
  updateTimeUi();
  renderScript();
  dirty = true;
  scheduleMix();
  updateQuick();
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
    : Math.min(window.innerHeight * (state.fmt === 'v' ? 0.27 : 0.24), 420);
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

// Nút "Xem thử video" giữa khung: hiện khi đã quét xong, đang dừng ở đầu video
function updateBigPlay() {
  const b = $('bigPlay');
  if (b) b.hidden = !(tl && state.pois.length && !playing && !editing && !exporting && t < 0.05);
}
function updateTimeUi() {
  updateBigPlay();
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
      renderEdit(ctx, state.house, state.fmt, { cache, scale, lot: state.lot, mode: editMode, zoom: editMode === 'lot' ? lotZoom : null });
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
    // Đang dừng ở đầu video: hiện khung có tiêu đề làm ảnh bìa thay vì khung trống
    const rt = !playing && t === 0 && tl.intro ? Math.min(1.6, (tl.intro.t1 - tl.intro.t0) * 0.35) : t;
    render(ctx, tl, rt, { cache, scale, request: true });
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
  updateBigPlay();
  await startAudio();
}
function pause() {
  playing = false;
  $('playBtn').classList.remove('playing');
  $('playBtn').setAttribute('aria-label', 'Phát xem trước');
  stopAudio();
  updateBigPlay();
}

// Mỗi lần phát có một số thứ tự: lần phát cũ chưa kịp bắt đầu thì bỏ, tránh hai giọng đọc chồng lên nhau
let audioGen = 0;
const liveSources = new Set();
async function startAudio() {
  stopAudio();
  const gen = audioGen;
  const buf = await ensureMix();
  if (!buf || !playing || gen !== audioGen) return;
  audioCtx ||= new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (!playing || gen !== audioGen) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.onended = () => liveSources.delete(src);
  liveSources.add(src);
  audioSrc = src;
  src.start(0, Math.min(t, buf.duration - 0.01));
}
function stopAudio() {
  audioGen++;
  for (const s of liveSources) { try { s.stop(); } catch { /* đã dừng */ } }
  liveSources.clear();
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

function toggleEdit(on, mode = 'pin') {
  const want = on ?? !(editing && editMode === mode);
  editing = want;
  editMode = mode;
  if (editing) pause();
  $('editPinBtn').setAttribute('aria-pressed', String(editing && editMode === 'pin'));
  $('lotBtn').setAttribute('aria-pressed', String(editing && editMode === 'lot'));
  $('lotBar').hidden = !(editing && editMode === 'lot');
  updateLotMsg();
  if (!editing) scheduleRebuild();
  $('canvasWrap').classList.toggle('editing', editing);
  dirty = true;
  updateBigPlay();
}

function updateAreaPlaceholders() {
  $('areaWardInput').placeholder = state.adminArea?.ward?.name || state.admin?.commune || 'Tự lấy theo vị trí';
  $('areaProvInput').placeholder = state.adminArea?.province?.name || state.admin?.province || 'Tự lấy theo vị trí';
}
function updateLotMsg() {
  const n = state.lot.length;
  $('lotMsg').textContent = n === 0 ? 'Chạm lần lượt các góc lô đất trên ảnh.' : n < 3 ? `Đã chấm ${n} góc, chấm thêm ${3 - n} góc nữa.` : `Lô đất ${n} góc · khoảng ${formatArea(lotAreaM2(state.lot))}`;
  $('lotBtn').textContent = n >= 3 ? 'Sửa lô đất' : 'Vẽ lô đất';
  $('lotArea').placeholder = n >= 3 ? formatArea(lotAreaM2(state.lot)) : 'Tự tính';
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
      state.coordSet = true;
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
  if (!silent) state.coordSet = true;
  msg.textContent = `Đã đọc: ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`;
  msg.className = 'hint ok';
  return true;
}

function setHouse(h) {
  const prev = state.house;
  state.house = h;
  setAccountLocation(h);
  const moved = prev ? haversineKm(prev, h) : Infinity;
  // Đổi sang căn khác thì bỏ ranh lô đất cũ
  if (moved > 0.3 && state.lot?.length) state.lot = [];
  if (moved > 0.5) {
    if (state.pois.length) toast('Đã đổi vị trí. Bấm Quét tiện ích để tìm lại quanh căn nhà mới.');
    state.pois = []; state.roads = []; state.streets = null; state.adminArea = null; state.selected = []; state.selectedRoads = []; state.routes = {}; state.admin = null;
    state.cloudId = null; state.projName = '';
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
    state.streets = res.streets || null;
    state.adminArea = res.area || null;
    updateAreaPlaceholders();
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
    showStep(2);
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
    // Mỗi nhóm hiện 5 điểm (cộng các điểm đã chọn); bấm Xem thêm để hiện hết
    const expanded = poiOpen.has(c);
    const shown = expanded ? list.slice(0, 30) : list.filter((p, i) => i < 5 || state.selected.includes(p.id));
    const more = expanded || list.length <= shown.length ? '' : `<button type="button" class="btn btn-quiet poi-more" data-more="${c}">Xem thêm ${Math.min(30, list.length) - shown.length} điểm</button>`;
    const rows = shown.map(p => `
      <label class="poi-row${p.manual ? ' manual' : ''}">
        <input type="checkbox" autocomplete="off" data-poi="${esc(p.id)}" ${state.selected.includes(p.id) ? 'checked' : ''}>
        <span class="poi-name">${esc(p.name)}</span>
        <span class="poi-km" data-km="${esc(p.id)}">${kmText(p)}</span>
        <button type="button" class="poi-star" data-star="${esc(p.id)}" aria-pressed="${(state.stars || []).includes(p.id)}" title="Khoanh vùng nổi bật điểm này trong video" aria-label="Khoanh vùng nổi bật">★</button>
      </label>`).join('');
    return `<details class="cat-group" ${nSel ? 'open' : ''}>
      <summary><span class="cat-ic" style="background:${CAT_COLORS[c]}">${iconSvg(CATEGORIES[c].icon)}</span>${CATEGORIES[c].label}<span class="n">${nSel ? nSel + ' chọn · ' : ''}${list.length}</span></summary>
      ${rows}${more}
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
// Khoá khớp giọng: lời + giọng (KHÔNG gồm tốc độ đọc — đổi tốc độ thì co giãn giọng sẵn có, không phải tạo lại)
const voiceKey = text => speakable(text) + '|' + state.voiceId;
const VOICE_RATE = { '-1': 0.9, 0: 1, 1: 1.1 }; // khớp speakingRate bên máy chủ (lib/tts.js)
const voiceOk = sg => { const v = media.voiceSegs.get(sg.key); return !!(v && v.ck === voiceKey(sg.text)); };
// Giọng của một câu theo tốc độ đọc hiện tại: đúng tốc độ lúc tạo thì dùng luôn, khác thì co giãn (giữ cao độ) và nhớ lại
function voiceBuf(sg) {
  const v = media.voiceSegs.get(sg.key);
  if (!v || v.ck !== voiceKey(sg.text)) return null;
  const sp = state.voiceSpeed || 0;
  if (v.own || v.speed == null || v.speed === sp) return v.buffer;
  v.st = v.st || {};
  if (!v.st[sp]) v.st[sp] = stretchBuffer(v.buffer, (VOICE_RATE[v.speed] || 1) / (VOICE_RATE[sp] || 1));
  return v.st[sp];
}

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
const CAT_WORD = { truong: 'trường học', cho: 'chợ', yte: 'bệnh viện', kcn: 'khu công nghiệp', khudothi: 'khu đô thị', congvien: 'công viên', hanhchinh: 'cơ quan hành chính', giaothong: 'nhà ga, bến xe', congcong: 'tiện ích công cộng', nganhang: 'ngân hàng' };
const CAT_RANK = ['truong', 'cho', 'yte', 'kcn', 'khudothi', 'congvien', 'hanhchinh', 'giaothong', 'congcong', 'nganhang'];
// Câu riêng theo loại cụ thể (ưu tiên hơn câu theo nhóm)
const KIND_LINES = {
  airport: ['Cách {n} khoảng {d}, bay đi đâu cũng nhanh.', 'Ra {n} chỉ khoảng {d}, rất tiện cho người hay đi công tác.'],
  station: ['{n} chỉ cách {d}, đi tàu, metro rất tiện.'],
  beach: ['Chỉ {d} là ra {n}, sáng chiều tắm biển, hóng gió thoải mái.', 'Cách {n} chỉ {d}, sống gần biển trong lành.'],
  charging_station: ['{n} cách {d}, xe điện sạc pin tiện lợi.'],
  fuel: ['{n} chỉ cách {d}, đổ xăng tiện lợi.'],
};
const POI_LINES = {
  truong: ['Con đi học gần, chỉ {d} là tới {n}.', '{n} cách nhà chỉ {d}, đưa đón con rất tiện.', 'Chỉ {d} là tới {n}, con nhỏ đi học thoải mái.'],
  yte: ['{n} cách khoảng {d}, yên tâm khi cần khám chữa bệnh.', 'Cần khám bệnh đã có {n}, chỉ cách {d}.'],
  cho: ['Đi chợ, mua sắm ở {n} chỉ {d}.', '{n} cách {d}, mua sắm hằng ngày rất tiện.', 'Chỉ {d} là tới {n}, đi chợ không cần đi xa.'],
  hanhchinh: ['{n} cách {d}, làm giấy tờ nhanh gọn.', 'Làm giấy tờ ở {n} chỉ cách {d}.'],
  congvien: ['{n} cách {d}, cuối tuần cả nhà có chỗ vui chơi, thư giãn.', 'Chỉ {d} là tới {n}, nơi cả nhà đi dạo, thư giãn.'],
  kcn: ['{n} chỉ cách {d}, thuận tiện cho người đi làm, rất hợp đầu tư cho thuê.', 'Gần {n}, chỉ {d}, người đi làm đi lại dễ dàng.'],
  giaothong: ['{n} cách {d}, đi tỉnh, về quê đều tiện.'],
  khudothi: ['Ngay cạnh {n}, chỉ cách {d}, hạ tầng đồng bộ, giá trị tăng tốt.', 'Chỉ {d} là tới {n}, khu dân trí cao, tiện ích đầy đủ.'],
  congcong: ['{n} chỉ cách {d}, rất tiện cho sinh hoạt hằng ngày.', 'Chỉ {d} là tới {n}.'],
  nganhang: ['{n} chỉ cách {d}, giao dịch thuận tiện.'],
};
// Câu thông tin căn nhà: "Diện tích 5x20m, 3 phòng ngủ, sổ hồng riêng, giá chỉ 3,2 tỷ."
function infoSentence(pick, skipPrice = false) {
  const c = v => String(v || '').replace(/\s+/g, ' ').trim();
  const isLand = /LÔ ĐẤT/.test(state.typeLabel || '');
  const beds = c(state.beds), legal = c(state.legal), floors = c(state.floors), thoCu = c(state.thoCu), rw = c(state.roadWidth);
  const parts = [];
  if (c(state.area)) parts.push('diện tích ' + c(state.area));
  if (thoCu) parts.push(/thổ cư/i.test(thoCu) ? thoCu : thoCu + ' thổ cư');
  if (!isLand && floors) parts.push(/^\d+$/.test(floors) ? floors + ' tầng' : floors);
  if (!isLand && beds) parts.push(/^\d+$/.test(beds) ? beds + ' phòng ngủ' : beds);
  if (rw) parts.push('đường trước nhà ' + (/^\d+([.,]\d+)?$/.test(rw) ? rw + ' mét' : rw.replace(/(\d)\s*m\b/i, '$1 mét')));
  if (legal) parts.push(legal.charAt(0).toLowerCase() + legal.slice(1));
  if (c(state.price) && !skipPrice) parts.push(pick(['giá chỉ ', 'giá bán '], 5) + c(state.price));
  if (!parts.length) return '';
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}
// Tên xã/phường, tỉnh/thành để đọc (khách sửa được ở bước Nội dung); "Phường X" -> "phường X" khi nằm giữa câu
function wardName() { return (state.areaWard || '').trim() || state.adminArea?.ward?.name || state.admin?.commune || ''; }
function provName() { return (state.areaProv || '').trim() || state.adminArea?.province?.name || state.admin?.province || ''; }
const midSentence = s => nameSpeak(s).replace(/^(Xã|Phường|Thị trấn|Đặc khu|Tỉnh)(?=\s)/, m => m.toLowerCase());
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
  // Có giá: nói giá + điểm mạnh nhất ngay câu đầu (khớp cảnh mở đầu trên video), người xem biết ngay căn này có đáng xem không
  const price = String(state.price || '').replace(/\s+/g, ' ').trim();
  const near = r0 && r0.nearKm < 3 ? (r0.nearKm < 0.12 ? `, mặt tiền ${nameSpeak(r0.label)}` : `, cách ${nameSpeak(r0.label)} chỉ ${kmSpeak(r0.nearKm)}`) : '';
  const priceHooks = [
    `${tw} giá chỉ ${price}${near}. Xem ngay vị trí này nhé!`,
    `Chỉ ${price} cho ${twl}${near}! Cùng xem xung quanh có gì nhé!`,
    `${tw} ${price}${near}, giá này còn rất ít. Xem ngay nhé!`,
  ];
  // Trình tự: trung cảnh "Đây là vị trí … thuộc phường …" → cả tỉnh/thành → cận cảnh thông tin → bán kính
  const ward = wardName(), prov = provName();
  const hasProvScene = !!(state.adminArea?.province?.rings?.length && state.adminArea?.ward?.rings?.length);
  if (ward) {
    const head = price ? (generic ? `${tw} giá chỉ ${price}${near}. ` : `${nameSpeak(title)}, giá chỉ ${price}. `) : (generic ? '' : `${nameSpeak(title)}. `);
    add('intro', 'Mở đầu · xã/phường', head + pick([`Đây là vị trí ${twl} thuộc ${midSentence(ward)}.`, `Đây là vị trí ${twl}, nằm tại ${midSentence(ward)}.`], 1));
  } else {
    add('intro', 'Mở đầu', price
      ? (generic ? pick(priceHooks) : `${nameSpeak(title)}, giá chỉ ${price}${near}. Cùng xem vị trí và tiện ích xung quanh nhé!`)
      : generic ? pick(hooks) : `${nameSpeak(title)}. Cùng xem vị trí và tiện ích xung quanh nhé!`);
  }
  if (hasProvScene && prov) add('province', 'Tỉnh / thành phố', pick([`Thuộc ${midSentence(prov)}.`, `Nằm trong địa phận ${midSentence(prov)}.`], 2));
  const info = infoSentence(pick, !!price);
  add('house', 'Thông tin ' + twl, ward
    ? (info || pick([`Cùng xem kỹ vị trí ${twl} nhé.`, `Nhìn gần hơn vị trí ${twl} nhé.`], 1))
    : (loc ? pick([`${tw} nằm tại ${loc}.`, `Đây là vị trí ${twl}, thuộc ${loc}.`], 1) : `Đây là vị trí ${twl} trên bản đồ.`) + (info ? ' ' + info : ''));

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
    const pool = KIND_LINES[p.kind] || POI_LINES[p.cat] || ['{n}, cách khoảng {d}.'];
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
  if (media.photos.length) add('photos', 'Ảnh thực tế', pick([`Cùng xem hình ảnh thực tế của ${twl}.`, `Đây là hình ảnh thực tế của ${twl}.`], 5));
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
    const vb = voiceBuf(s);
    if (vb) { el.textContent = `có giọng · ${vb.duration.toFixed(1).replace('.', ',')} giây`; el.className = 'vst ok'; }
    else { el.textContent = v ? 'đã sửa, cần tạo lại giọng' : ''; el.className = 'vst'; }
  }
  updateVoCard();
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
    ? `Giọng AI sẵn sàng${prov ? ' (' + prov + ')' : ''}. Video tự giãn theo từng câu đọc.`
    : 'Giọng AI chưa bật trên máy chủ (cần khoá FPT.AI hoặc Google TTS). Kịch bản vẫn sửa và chép được để tự ghi âm.';
  $('aiScriptBtn').hidden = true; // đã gộp vào module Kịch bản & giọng đọc
  updateVoCard();
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
  state.scriptAi = false;
  media.voiceSegs.clear();
  renderScript(); scheduleRebuild(); save();
  $('ttsMsg').textContent = 'Đã đổi sang cách viết khác. Bấm nút tạo giọng để đọc kịch bản mới.';
}

async function aiRewrite() {
  const segs = scriptSegments();
  if (!ai.script) { altScript(); return false; }
  const btn = $('aiScriptBtn');
  btn.disabled = true; $('aiScriptBig').disabled = true;
  $('ttsMsg').textContent = 'AI đang viết kịch bản…';
  try {
    const facts = {
      loai_bds: TYPE_WORD[state.typeLabel] || 'Căn nhà', tieu_de: state.title, dong_phu: state.sub, thuong_hieu: state.brand,
      so_dien_thoai_lien_he: phoneDisplay(state.phone) || null,
      thong_tin_nha: { gia: state.price || null, dien_tich: state.area || null, tho_cu: state.thoCu || null, so_tang: state.floors || null,
        phong_ngu: state.beds || null, phap_ly: state.legal || null, duong_truoc_nha: state.roadWidth || null },
      ban_kinh_km: state.radiusKm, tinh_thanh: provName(), xa_phuong: wardName(),
      duong_lon: selectedRoads().map(r => ({ ten: r.label, ten_duong: r.alt || '', cach_km: +r.nearKm.toFixed(2) })),
      ranh_gioi: state.useBoundary && state.admin?.boundary ? { tinh: state.admin.boundary.short, chim_bay_km: +state.admin.boundary.km.toFixed(2), duong_di_km: state.routes.__ranh ? +state.routes.__ranh.km.toFixed(2) : null, phut_o_to: state.routes.__ranh?.min ? Math.round(state.routes.__ranh.min) : null } : null,
      tien_ich: selectedPois().map(p => ({ ten: p.name, nhom: CATEGORIES[p.cat].label, cach_km: +(p.route ? p.route.km : p.km).toFixed(2) })),
    };
    // KHÔNG gửi câu mẫu (AI sẽ chép lại y chang) — chỉ gửi hình đang hiện + dữ liệu của từng cảnh
    const SCENE = { intro: 'Mở đầu: trung cảnh ghim bất động sản, xã/phường sáng lên', province: 'Cả tỉnh/thành phố hiện lên', house: 'Cận cảnh bất động sản, máy lượn quanh',
      overview: 'Toàn cảnh vòng bán kính quanh nhà', boundary: 'Ranh giới sang tỉnh/thành bên cạnh', summary: 'Tổng kết tất cả tiện ích', photos: 'Ảnh thực tế của bất động sản', outro: 'Kết video, kêu gọi đi xem nhà' };
    const roadById = Object.fromEntries(selectedRoads().map(r => [r.id, r]));
    const poiById = Object.fromEntries(selectedPois().map(p => [p.id, p]));
    const segments = Object.fromEntries(segs.map(sg => {
      const [kind, id] = sg.key.split(':');
      if (kind === 'road' && roadById[id]) { const r = roadById[id]; return [sg.key, { canh: 'Trục đường lớn', ten: r.label, ten_khac: r.alt || '', cach: kmSpeak(r.nearKm) }]; }
      if (kind === 'poi' && poiById[id]) {
        const p = poiById[id], km = p.route ? p.route.km : p.km;
        return [sg.key, { canh: 'Tiện ích', ten: p.name, nhom: CATEGORIES[p.cat]?.label || '', cach: kmSpeak(km), phut_xe_may: Math.max(1, Math.round(p.route?.min || km * 60 / 22)) }];
      }
      return [sg.key, { canh: SCENE[kind] || sg.label }];
    }));
    if (ai.gated && !account.profile && !(await requireLogin('Đăng nhập để AI viết kịch bản.'))) { $('ttsMsg').textContent = ''; return; }
    const res = await fetch('/api/script', {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ facts, segments, tone: state.aiTone || 'ke-chuyen', lat: state.house?.lat, lng: state.house?.lng }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (await handleAiError(res.status, j)) { $('ttsMsg').textContent = j.error || ''; return; }
      throw new Error(j.error || 'HTTP ' + res.status);
    }
    state.scriptEdits = { ...j.segments };
    state.scriptAi = true;
    renderScript(); scheduleRebuild(); save();
    $('ttsMsg').textContent = 'AI đã viết xong kịch bản.';
    media.voiceSegs.clear(); // kịch bản mới thì giọng cũ không còn khớp
    return true;
  } catch (e) {
    $('ttsMsg').textContent = 'AI viết kịch bản chưa dùng được (' + e.message + '), tạm dùng kịch bản mẫu.';
  } finally { btn.disabled = false; $('aiScriptBig').disabled = false; }
  return false;
}

// ---------- Module Kịch bản & giọng đọc: một nút làm cả hai ----------
const voMode = () => (state.scriptMode === 'mau' || !ai.script ? 'mau' : 'ai');
const voChoice = () => voMode() === 'ai' ? 'ai|' + (state.aiTone || '') : 'mau';
const needTone = () => voMode() === 'ai' && !state.aiTone;
function voStatus() {
  const segs = scriptSegments().filter(s => speakable(s.text));
  let ok = 0;
  for (const sg of segs) if (voiceOk(sg)) ok++;
  if (!ok) return 'none';
  if (ok < segs.length) return 'stale'; // khách sửa lời hoặc đổi giọng/tốc độ
  return state.voSig && state.voSig !== voChoice() ? 'changed' : 'ready';
}
let voBusy = false;
// Chưa chọn phong cách: không tạo, đưa khách tới chỗ chọn và nháy sáng
function askTone() {
  setSub('sound');
  const seg = $('aiToneSeg');
  seg.scrollIntoView({ behavior: 'smooth', block: 'center' });
  seg.classList.remove('need'); void seg.offsetWidth; seg.classList.add('need');
  toast('Chọn 1 phong cách kịch bản trước (Hài hước, Kể chuyện…), rồi bấm tạo.', 3500);
}
function updateVoCard() {
  const btn = $('ttsBtn');
  if (!btn) return;
  const mode = voMode(), st = voStatus();
  setSeg('scriptSrcSeg', mode);
  $('scriptSrcSeg').querySelector('[data-v="ai"]').disabled = !ai.script;
  $('aiToneWrap').hidden = mode !== 'ai';
  $('toneNeed').hidden = !needTone();
  const pill = $('voState');
  pill.textContent = { none: 'Chưa tạo', stale: 'Cần đọc lại', changed: 'Đã đổi lựa chọn', ready: '✓ Đã có giọng' }[st];
  pill.classList.toggle('ok', st === 'ready');
  if (voBusy) return;
  btn.textContent = needTone() && st !== 'stale' ? '👆 Chọn phong cách ở trên trước'
    : st === 'none' ? (mode === 'ai' ? '🎙️ Tạo kịch bản AI & giọng đọc' : '🎙️ Tạo giọng đọc (kịch bản mẫu)')
    : st === 'stale' ? '🎙️ Đọc lại giọng cho câu đã sửa'
    : st === 'changed' ? '🎙️ Tạo lại theo lựa chọn mới'
    : (mode === 'ai' ? '🔄 Tạo lại: kịch bản AI mới + giọng' : '🔄 Tạo lại: cách viết khác + giọng');
  btn.classList.toggle('btn-primary', st !== 'ready');
  btn.classList.toggle('btn-quiet', st === 'ready');
  const only = $('voVoiceOnly');
  only.hidden = st !== 'stale';
  only.textContent = 'Hoặc viết kịch bản mới hoàn toàn';
}
// fresh = viết kịch bản mới (bỏ kịch bản cũ). Không fresh: giữ lời đã có, chỉ đọc phần còn thiếu
async function makeScriptAndVoice({ fresh } = {}) {
  if (voBusy || ttsBusy) return;
  const st = voStatus();
  if (needTone() && st !== 'stale') { askTone(); return false; }
  if (fresh == null) fresh = st === 'ready' || st === 'changed';
  const mode = voMode();
  const btn = $('ttsBtn');
  voBusy = true; btn.disabled = true;
  try {
    if (mode === 'ai') {
      if (fresh || !state.scriptAi) { btn.textContent = '✨ AI đang viết kịch bản…'; await aiRewrite(); }
    } else if (state.scriptAi) {
      state.scriptEdits = {}; state.scriptAi = false; media.voiceSegs.clear(); renderScript(); scheduleRebuild();
    } else if (fresh) altScript();
    btn.textContent = '🎙️ Đang tạo giọng đọc…';
    voBusy = false; // để generateVoices tự khoá nút trong lúc đọc
    await generateVoices();
    if (voiceDurations()) { state.voSig = voChoice(); save(); }
  } finally { voBusy = false; btn.disabled = false; updateVoCard(); }
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
  const todo = segs.filter(s => !voiceOk(s));
  const msg = $('ttsMsg');
  if (!todo.length) { msg.textContent = 'Giọng đọc đã khớp với kịch bản hiện tại.'; return; }
  // Tạo giọng ở căn mới tính 1 lượt (xuất video căn này trong thời hạn xuất lại không mất thêm)
  const p0 = account.profile;
  // Căn đã trừ lượt và còn lần tạo giọng → không hỏi; hết lần hoặc căn mới → báo sẽ trừ 1 lượt
  const R = account.redo;
  const freeHere = R && new Date(R.until) > new Date() && R.tts_left > 0;
  if (ai.gated && p0 && !p0.unlimited && !freeHere) {
    const info = account.info || {};
    if (p0.credits <= 0) { openPricing(R ? 'Căn này đã dùng hết số lần tạo giọng. Mua thêm lượt để tạo lại.' : 'Đã hết lượt. Mua thêm lượt để tạo giọng đọc và xuất video.'); return; }
    if (!confirm(`${R ? 'Căn này đã dùng hết số lần tạo giọng của lượt trước.\n' : ''}Tạo giọng đọc sẽ dùng 1 lượt cho căn này (còn ${p0.credits} lượt).\nMỗi lượt gồm ${info.redo_exports ?? 3} lần xuất video và ${info.redo_tts ?? 3} lần tạo giọng trong ${info.reexport_hours ?? 24} giờ.\n\nTiếp tục?`)) return;
  } else if (freeHere) {
    $('ttsMsg').textContent = `Lần tạo giọng này không trừ lượt (còn ${R.tts_left} lần cho căn này).`;
  }
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
      grp.forEach((s, i) => media.voiceSegs.set(s.key, { ck: voiceKey(s.text), buffer: pieces[i], speed: state.voiceSpeed || 0 }));
      made += grp.length;
      renderScript();
    }
    refreshAccount();
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

function renderStyles() {
  const el = $('styleRow');
  if (!el) return;
  if (!STYLES[state.style]) state.style = 'neon';
  const sample = { neon: '3D', sangtrong: 'Aa', tretrung: 'Hi!', toigian: 'Aa' };
  el.innerHTML = Object.entries(STYLES).map(([k, st]) => {
    const [bg, a1, a2] = st.swatch;
    const font = k === 'sangtrong' ? 'font-family:"Playfair Display",serif;' : k === 'tretrung' ? 'font-family:"Baloo 2",sans-serif;' : k === 'toigian' ? 'font-weight:300;' : '';
    return `<button type="button" role="radio" class="style-card" data-st="${k}" aria-checked="${state.style === k}">
      <span class="st-sw" style="background:${bg};color:${a1};box-shadow:inset 0 -5px 0 ${a2};${font}">${sample[k]}</span>
      <strong>${esc(st.label)}</strong><span class="st-d">${esc(st.desc)}</span></button>`;
  }).join('');
  el.onclick = e => {
    const b = e.target.closest('button[data-st]');
    if (!b || state.style === b.dataset.st) return;
    state.style = b.dataset.st;
    // Mỗi kiểu có màu line đi kèm (vẫn đổi được ở mục Màu line)
    const st = STYLES[state.style];
    state.roadTheme = st.road; state.routeTheme = st.route;
    renderSwatches('roadThemeRow', 'roadTheme', true);
    renderSwatches('routeThemeRow', 'routeTheme', false);
    for (const x of el.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
    fontsReady().then(() => { dirty = true; });
    scheduleRebuild();
  };
}
function renderBases() {
  const el = $('baseRow');
  if (!el) return;
  if (!BASES[state.base]) state.base = 'vetinh';
  const sw = { vetinh: 'linear-gradient(135deg,#4f7d45,#8fb36a 45%,#c9b98f 70%,#5b8fa8)', phim: 'linear-gradient(135deg,#1f3530,#4d6f66 55%,#9fc4be)',
    duongpho: 'linear-gradient(135deg,#f3eee4 0 40%,#ffd27a 40% 46%,#f3eee4 46% 70%,#9cc3e6 70%)', toi: 'linear-gradient(135deg,#17191c 0 45%,#3a3d42 45% 50%,#17191c 50%)',
    sang: 'linear-gradient(135deg,#ececea 0 45%,#c9c9c6 45% 50%,#ececea 50%)' };
  el.innerHTML = Object.entries(BASES).map(([k, b]) => `<button type="button" role="radio" class="style-card" data-base="${k}" aria-checked="${state.base === k}">
      <span class="st-sw" style="background:${sw[k] || '#333'}"></span>
      <strong>${esc(b.label)}</strong><span class="st-d">${esc(b.desc)}</span></button>`).join('');
  el.onclick = e => {
    const b = e.target.closest('button[data-base]');
    if (!b || state.base === b.dataset.base) return;
    state.base = b.dataset.base;
    for (const x of el.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
    dirty = true;
    scheduleRebuild();
  };
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
let exportAudioCtx = null;
async function doExport() {
  if (!state.house) { toast('Nhập toạ độ căn nhà trước.'); return; }
  if (exporting || gating) return;
  // Mở khoá âm thanh ngay trong cú bấm (iPhone), dùng khi phải quay thời gian thực
  exportAudioCtx?.close?.().catch?.(() => {});
  exportAudioCtx = unlockAudioContext();
  gating = true;
  $('exportBtn').disabled = true; $('stepNext').disabled = true;
  let gate = null;
  try { gate = await beginExport(state.house); }
  finally { gating = false; $('exportBtn').disabled = false; $('stepNext').disabled = false; }
  if (!gate) return;
  if (gate.charged) toast(`Đã trừ 1 lượt, còn ${gate.profile.credits} lượt. Căn này còn ${gate.redo?.exports_left ?? 2} lần xuất lại không trừ lượt.`, 4500);
  else if (gate.mode === 'reexport' && gate.redo) toast(`Xuất lại không trừ lượt. Căn này còn ${gate.redo.exports_left} lần xuất lại.`, 3500);
  pause();
  toggleEdit(false);
  exporting = true;
  exportCtrl = new AbortController();
  const signal = exportCtrl.signal;
  $('exportBtn').disabled = true; $('stepNext').disabled = true;
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
        if (e.code !== 'NO_AUDIO_ENCODER' && e.code !== 'NO_MUXER') throw e;
        progress(30, 'Đang quay theo thời gian thực để giữ nhạc và giọng đọc — giữ màn hình mở, đừng chuyển app…');
        blob = await exportRealtime({ tl: xtl, width, height, fps: 30, cache, audioBuffer: audio, audioCtx: exportAudioCtx, onProgress, signal });
      }
    } else {
      progress(30, 'Máy này không hỗ trợ dựng nhanh, đang quay theo thời gian thực — giữ màn hình mở, đừng chuyển app…');
      blob = await exportRealtime({ tl: xtl, width, height, fps: 30, cache, audioBuffer: audio, audioCtx: exportAudioCtx, onProgress, signal });
    }
    const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
    if (ext === 'webm') toast('Trình duyệt này chỉ xuất được WebM (iPhone có thể không phát được). Nên xuất bằng Chrome trên Android/máy tính hoặc Safari trên iPhone.', 7000);
    const name = `video-vi-tri-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.${ext}`;
    resultFile = new File([blob], name, { type: blob.type });
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    $('resultVideo').src = resultUrl;
    $('resultBox').hidden = false;
    exportedOnce = true; updateQuick();
    $('resultMeta').textContent = `${width}×${height} · ${Math.round(xtl.duration)} giây · ${(blob.size / 1048576).toFixed(1)} MB · ${ext.toUpperCase()}`;
    $('shareBtn').hidden = !(navigator.canShare && navigator.canShare({ files: [resultFile] }));
    progress(100, 'Xong');
    if (account.profile && await saveProject({ silent: true })) toast('Đã dựng xong video. Căn này đã lưu vào mục Căn đã lưu.', 3500);
    else toast('Đã dựng xong video.');
    $('resultBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    const keep = gate?.charged || gate?.mode === 'unlimited' ? ` Lượt đã trừ vẫn giữ: căn này còn ${gate.redo?.exports_left ?? 0} lần xuất lại không trừ lượt.` : '';
    if (e.name === 'AbortError') toast('Đã huỷ xuất video.' + keep, keep ? 5000 : 2600);
    else { console.error(e); toast('Xuất video lỗi: ' + (e.message || e) + keep, 7000); }
  } finally {
    exporting = false;
    dirty = true;
    updateBigPlay();
    $('exportBtn').disabled = false; $('stepNext').disabled = false;
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
      Promise.all([
        ...['300', '500', '600', '700', '800'].map(w => document.fonts.load(`${w} 20px ${FONT}`, 'Vị trí ạ')),
        document.fonts.load('900 40px "Montserrat"', 'PHƯỜNG THÀNH PHỐ Ồ'),
        ...(STYLES[state.style] && STYLES[state.style].head !== FONT
          ? ['500', '700', '800', 'italic 500'].map(w => document.fonts.load(`${w} 20px ${STYLES[state.style].head}`, 'Giá chỉ ạ'))
          : []),
      ]),
      new Promise(r => setTimeout(r, 4000)),
    ]);
  } catch { /* dùng phông dự phòng */ }
}

// ---------- Các bước làm video (1 Vị trí → 2 Tiện ích → 3 Nội dung → 4 Xuất & chia sẻ) ----------
let step = 1;
let exportedOnce = false;
function stepDone(n) {
  if (n === 1) return !!state.pois.length;
  if (n === 2) return !!state.pois.length && step > 2;
  if (n === 3) return !!voiceDurations();
  return exportedOnce;
}
function showStep(n, { scroll = true } = {}) {
  if (n === 3 && !ai.script) checkAi(); // khoá AI vừa thêm trên máy chủ thì thẻ AI tự hiện
  step = Math.max(1, Math.min(4, n));
  for (const a of document.querySelectorAll('.steps > .step')) a.classList.toggle('on', +a.dataset.step === step);
  if (scroll) {
    const panel = $('panel');
    if (window.matchMedia('(min-width: 980px)').matches) panel.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  updateQuick();
}
let curSub = 'info';
function setSub(name, { scroll = false } = {}) {
  curSub = name;
  for (const b of $('subtabs').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.sub === name));
  for (const p of document.querySelectorAll('.subpane')) p.hidden = p.dataset.pane !== name;
  if (scroll) $('subtabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (typeof updateQuick === 'function' && step === 3) updateQuick();
}
function updateQuick() {
  // Thanh bước: đánh dấu bước xong, bước hiện tại
  for (const b of document.querySelectorAll('#stepper button')) {
    const n = +b.dataset.go;
    b.classList.toggle('cur', n === step);
    b.classList.toggle('done', n !== step && stepDone(n));
    b.setAttribute('aria-current', n === step ? 'step' : 'false');
  }
  // Nút dưới cùng: việc nên làm tiếp theo của bước này
  const next = $('stepNext'), back = $('stepBack');
  if (next) {
    back.hidden = step === 1;
    let label = 'Tiếp tục →', hide = false;
    if (step === 1) { label = state.pois.length ? 'Tiếp tục →' : 'Quét tiện ích'; hide = !state.pois.length; }
    else if (step === 2) label = state.pois.length ? 'Tiếp tục: Nội dung →' : 'Về bước 1';
    else if (step === 3) label = voiceDurations() || !state.aiVoiceOn ? 'Tiếp tục: Xuất video →'
      : curSub === 'info' ? 'Tiếp: Phong cách →'
      : curSub === 'look' ? 'Tiếp: Giọng & nhạc →'
      : needTone() ? '👆 Chọn phong cách' : '🎙️ Tạo giọng đọc';
    else label = 'Xuất video MP4'; // bước 4: nút chính luôn nằm ở thanh dưới, không bị che
    next.textContent = label;
    next.hidden = hide;
    $('stepNav').hidden = step === 1 && !state.pois.length;
    $('navPlay').hidden = !state.pois.length;
  }
  // Khung xem trước đổi cỡ khi vừa quét xong (điện thoại)
  const fresh = !state.pois.length;
  if (fresh !== lastFresh) { lastFresh = fresh; layoutCanvas(); }
  updateBigPlay();
}
let lastFresh = null;
async function stepNext() {
  if (step === 4) { doExport(); return; }
  if (step === 1) { if (state.pois.length) showStep(2); else await scan(); return; }
  if (step === 2) { showStep(state.pois.length ? 3 : 1); return; }
  if (step === 3) {
    if (!voiceDurations() && state.aiVoiceOn && curSub !== 'sound') {
      // Đi lần lượt: Thông tin → Phong cách → Kịch bản & giọng
      setSub(curSub === 'info' ? 'look' : 'sound', { scroll: true });
      return;
    }
    if (!voiceDurations() && state.aiVoiceOn) {
      if (needTone()) { askTone(); return; }
      // Chỉ tạo giọng, không tự phát: khách tự bấm Xem thử để nghe
      setSub('sound');
      pause();
      // Cùng một việc với nút lớn trong module: viết kịch bản (AI hoặc mẫu theo lựa chọn) rồi đọc
      await makeScriptAndVoice({ fresh: false });
      if (voiceDurations()) {
        rebuild();
        t = 0;
        updateTimeUi();
        toast('Đã tạo giọng đọc. Bấm ▶ Xem thử để nghe, ưng rồi bấm Tiếp tục để xuất video.', 4500);
      }
      updateQuick();
      return;
    }
    showStep(4);
  }
}

// ---------- Căn nhà đã lưu theo tài khoản ----------
const PROJECT_KEYS = ['coordText', 'house', 'typeLabel', 'label', 'sub', 'radiusKm', 'title', 'brand', 'phone', 'price', 'area', 'beds', 'legal',
  'scriptSeed', 'scriptEdits', 'scriptAi', 'aiTone', 'scriptMode', 'voSig', 'thoCu', 'floors', 'fmt', 'speed', 'style', 'base', 'flow', 'lot', 'lotText', 'lotArea', 'areaWard', 'areaProv', 'roadWidth', 'showStreets', 'stars', 'pageVideo', 'pageDesc', 'roadTheme', 'routeTheme', 'roadLabelFace', 'voiceId', 'voiceSpeed', 'useBoundary', 'musicLib', 'musicVol',
  'subsOn', 'logoBg', 'sfxOn', 'sfxVol', 'scannedAt', 'speedV'];
const round5 = v => Array.isArray(v) ? v.map(round5)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round5(x)]))
  : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e5) / 1e5 : v;
function projectData() {
  const d = Object.fromEntries(PROJECT_KEYS.map(k => [k, state[k]]));
  const sel = new Set(state.selected);
  d.pois = state.pois.filter(p => sel.has(p.id) || p.manual);
  d.selected = state.selected.filter(id => d.pois.some(p => p.id === id));
  d.roads = state.roads.filter(r => state.selectedRoads.includes(r.id));
  d.selectedRoads = state.selectedRoads;
  d.routes = Object.fromEntries(Object.entries(state.routes).filter(([k]) => sel.has(k) || k === '__ranh'));
  d.admin = state.admin;
  return round5(d);
}
function defaultProjName() {
  const tw = TYPE_WORD[state.typeLabel] || 'Căn nhà';
  const title = (state.title || '').trim();
  const custom = title && !/^vị trí\s*(&|và)\s*tiện ích$/i.test(title) ? title : '';
  return (custom || [tw, state.sub || state.admin?.commune, state.price].filter(Boolean).join(' · ')).slice(0, 80);
}
async function saveProject({ silent = false, name } = {}) {
  if (!state.house) return false;
  if (!account.profile) {
    if (silent) return false;
    if (!(await requireLogin('Đăng nhập để lưu căn nhà, mở lại được trên mọi máy.'))) return false;
  }
  const nm = (name ?? state.projName ?? '').trim() || defaultProjName();
  try {
    const r = await rpc('vt_project_save', {
      p_token: account.token, p_id: state.cloudId || null, p_name: nm, p_sub: state.sub || state.admin?.commune || '',
      p_lat: state.house.lat, p_lng: state.house.lng, p_data: projectData(),
    });
    state.cloudId = r.id;
    state.projName = nm;
    save();
    if (!silent) toast(`Đã lưu "${nm}". Mở lại ở mục Căn đã lưu.`, 3200);
    return true;
  } catch (e) {
    if (!silent) toast(e.message, 4500);
    return false;
  }
}
const fmtDay = d => { const x = new Date(d); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`; };
async function loadProjects() {
  const box = $('projList');
  box.innerHTML = '<p class="hint">Đang tải…</p>';
  try {
    const list = await rpc('vt_project_list', { p_token: account.token });
    box.innerHTML = list.length ? list.map(p => `
      <div class="proj-item${p.id === state.cloudId ? ' cur' : ''}" data-id="${esc(p.id)}">
        <div class="pi-txt"><strong>${esc(p.name || 'Căn chưa đặt tên')}</strong><span>${esc(p.sub || '')}${p.sub ? ' · ' : ''}sửa ${fmtDay(p.updated_at)}</span></div>
        ${p.id === state.cloudId ? '<span class="hint small">đang mở</span>' : `<button type="button" class="btn btn-quiet" data-open="${esc(p.id)}">Mở</button>`}
        <button type="button" class="btn btn-quiet del" data-del="${esc(p.id)}">Xoá</button>
      </div>`).join('')
      : '<p class="hint">Chưa lưu căn nào. Bấm Lưu ở trên, hoặc xuất video xong app tự lưu.</p>';
  } catch (e) { box.innerHTML = `<p class="hint err">${esc(e.message)}</p>`; }
}
async function openProjects(focusName = false) {
  if (!account.profile && !(await requireLogin('Đăng nhập để lưu và mở lại các căn nhà đã làm.'))) return;
  $('projName').value = state.projName || defaultProjName();
  $('projMsg').textContent = '';
  $('projDlg').showModal();
  if (focusName) setTimeout(() => $('projName').select(), 60);
  loadProjects();
}
async function openProject(id) {
  $('projMsg').textContent = 'Đang mở…';
  $('projMsg').className = 'hint';
  try {
    const r = await rpc('vt_project_get', { p_token: account.token, p_id: id });
    const d = r.data || {};
    Object.assign(state, { pois: [], roads: [], selected: [], selectedRoads: [], routes: {}, admin: null, scriptEdits: {} }, fixSpeed(d));
    if (state.roadLabelFace === 'vangkim') state.roadLabelFace = 'vang';
    state.cloudId = r.id;
    state.projName = r.name;
    state.coordSet = true;
    save();
    location.reload();
  } catch (e) { $('projMsg').textContent = e.message; $('projMsg').className = 'hint err'; }
}
let delArmed = null;
async function projListClick(e) {
  const o = e.target.closest('[data-open]');
  if (o) { openProject(o.dataset.open); return; }
  const d = e.target.closest('[data-del]');
  if (!d) return;
  const id = d.dataset.del;
  if (delArmed !== id) {
    delArmed = id;
    d.textContent = 'Bấm lần nữa để xoá';
    setTimeout(() => { if (delArmed === id) { delArmed = null; d.textContent = 'Xoá'; } }, 3500);
    return;
  }
  delArmed = null;
  try {
    await rpc('vt_project_delete', { p_token: account.token, p_id: id });
    if (state.cloudId === id) { state.cloudId = null; save(); }
    loadProjects();
  } catch (err) { toast(err.message, 4000); }
}

// ---------- Nhạc nền có sẵn (Vị Trí Studio tự soạn, không vướng bản quyền) ----------
const MUSIC_LIB = [
  { id: 'nhe-nhang', label: 'Nhẹ nhàng · piano' },
  { id: 'tuoi-sang', label: 'Tươi sáng · vui tươi' },
  { id: 'soi-dong', label: 'Sôi động · nhịp nhanh' },
  { id: 'sang-trong', label: 'Sang trọng · trầm ấm' },
];
async function pickLibrary(id) {
  const tr = MUSIC_LIB.find(x => x.id === id);
  if (!tr) { if (state.musicLib) clearAudio('music'); return; }
  $('musicName').textContent = 'Đang tải nhạc…';
  try {
    const res = await fetch(`music/${tr.id}.m4a`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await decodeAudioFile(await res.blob());
    state.musicLib = id;
    media.music = buf;
    media.musicName = 'lib:' + id;
    $('musicName').textContent = `${tr.label} · ${fmtTime(buf.duration)} (lặp lại)`;
    $('musicClear').hidden = false;
    $('musicFile').value = '';
    media.mixKey = '';
    scheduleRebuild();
  } catch {
    state.musicLib = '';
    $('musicLib').value = '';
    $('musicName').textContent = 'Chưa có';
    toast('Không tải được nhạc có sẵn, thử lại sau.');
  }
}

// ---------- Logo ----------
function loadLogo(dataUrl) {
  return new Promise(res => {
    if (!dataUrl) { res(null); return; }
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = dataUrl;
  });
}
async function pickLogo(file) {
  if (!file) return;
  try {
    const url = URL.createObjectURL(file);
    const img = await loadLogo(url);
    URL.revokeObjectURL(url);
    if (!img) throw new Error('bad');
    // Thu nhỏ để lưu gọn trên máy, vẫn đủ nét cho video 1080p
    const k = Math.min(1, 640 / img.width, 320 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/png');
    try { localStorage.setItem(LOGO_STORE, data); } catch { /* máy đầy bộ nhớ: chỉ dùng trong phiên này */ }
    media.logo = await loadLogo(data);
    showLogo();
    scheduleRebuild();
  } catch {
    toast('Không đọc được ảnh logo. Dùng file PNG hoặc JPG.', 3500);
  }
}
function clearLogo() {
  media.logo = null;
  try { localStorage.removeItem(LOGO_STORE); } catch { /* bỏ qua */ }
  $('logoFile').value = '';
  showLogo();
  scheduleRebuild();
}
function showLogo() {
  const has = !!media.logo;
  $('logoName').textContent = has ? `Đã có logo (${media.logo.width}×${media.logo.height})` : 'Chưa có';
  $('logoClear').hidden = !has;
  $('logoPreview').hidden = !has;
  if (has) $('logoPreview').src = media.logo.src;
}

// ---------- Ảnh thực tế căn nhà ----------
// Thu nhỏ còn cạnh dài 1600px (đủ nét cho video 1080p), lưu IndexedDB theo toạ độ căn để mở lại vẫn còn.
const PHOTO_MAX = 6;
const photoKey = h => h ? `${h.lat.toFixed(5)},${h.lng.toFixed(5)}` : '';
function photoDb(mode, key, value) {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('vitri-photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('house');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('house', mode === 'get' ? 'readonly' : 'readwrite');
          const st = tx.objectStore('house');
          const r = mode === 'get' ? st.get(key) : mode === 'del' ? st.delete(key) : st.put(value, key);
          r.onsuccess = () => resolve(mode === 'get' ? r.result || null : true);
          r.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}
let photoHouse = '';
function savePhotos() {
  const k = photoKey(state.house);
  if (!k) return;
  if (media.photos.length) photoDb('put', k, media.photos.map(p => p.src));
  else photoDb('del', k);
}
async function restorePhotos() {
  const k = photoKey(state.house);
  if (k === photoHouse) return;
  photoHouse = k;
  media.photos = [];
  showPhotos();
  if (!k) return;
  const list = await photoDb('get', k);
  if (!Array.isArray(list) || photoHouse !== k) return;
  const imgs = (await Promise.all(list.map(loadLogo))).filter(Boolean);
  if (photoHouse !== k) return;
  media.photos = imgs.map(img => ({ img, src: img.src }));
  showPhotos();
  scheduleRebuild();
}
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadLogo(url);
    if (!img) return null;
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    const src = c.toDataURL('image/jpeg', 0.86);
    const out = await loadLogo(src);
    return out ? { img: out, src } : null;
  } finally { URL.revokeObjectURL(url); }
}
async function pickPhotos(files) {
  const list = Array.from(files || []).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  $('photoFile').value = '';
  if (!list.length) return;
  if (!state.house) { toast('Dán vị trí căn nhà trước rồi thêm ảnh.', 3000); return; }
  const room = PHOTO_MAX - media.photos.length;
  if (room <= 0) { toast(`Tối đa ${PHOTO_MAX} ảnh. Bỏ bớt ảnh cũ để thêm ảnh mới.`, 3000); return; }
  $('photoAdd').classList.add('busy');
  let bad = 0;
  for (const f of list.slice(0, room)) {
    const p = await shrinkPhoto(f).catch(() => null);
    if (p) media.photos.push(p); else bad++;
  }
  $('photoAdd').classList.remove('busy');
  if (list.length > room) toast(`Chỉ lấy ${room} ảnh đầu (tối đa ${PHOTO_MAX} ảnh).`, 3000);
  else if (bad) toast('Có ảnh không đọc được. Dùng ảnh JPG hoặc PNG.', 3500);
  savePhotos();
  showPhotos();
  scheduleRebuild();
}
function removePhoto(i) {
  media.photos.splice(i, 1);
  savePhotos();
  showPhotos();
  scheduleRebuild();
}
function showPhotos() {
  const row = $('photoRow');
  if (!row) return;
  for (const el of row.querySelectorAll('.photo-th')) el.remove();
  const add = $('photoAdd');
  media.photos.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'photo-th';
    d.innerHTML = `<img alt="Ảnh ${i + 1}"><span class="ord">${i + 1}</span><button type="button" aria-label="Bỏ ảnh ${i + 1}" data-rm="${i}">×</button>`;
    d.querySelector('img').src = p.src;
    row.insertBefore(d, add);
  });
  add.hidden = media.photos.length >= PHOTO_MAX;
}

// ---------- Trang web căn nhà ----------
// Mỗi toạ độ căn nhớ trang đã tạo (id, mã link, ảnh đã tải lên) để bấm lại là cập nhật, link giữ nguyên.
const PAGE_STORE = 'vitri.pages.v1';
const readPages = () => { try { return JSON.parse(localStorage.getItem(PAGE_STORE) || '{}'); } catch { return {}; } };
const writePages = m => { try { localStorage.setItem(PAGE_STORE, JSON.stringify(m)); } catch { /* bỏ qua */ } };
const pageRec = () => readPages()[photoKey(state.house)] || null;
function showPageResult() {
  const rec = pageRec();
  $('pageResult').hidden = !rec;
  $('pagePublish').textContent = rec ? 'Cập nhật trang web' : 'Tạo trang web cho căn này';
  if (!rec) return;
  const url = pageUrl(rec.slug);
  $('pageLink').value = url;
  $('pageOpen').href = url + '?xem=1';
}
async function photoBlob(src) {
  const img = await loadLogo(src);
  const k = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
}
async function uploadPhotos() {
  if (!media.photos.length) return [];
  const paths = await rpc('vt_page_upload', { p_token: account.token, p_count: media.photos.length });
  const out = [];
  for (let i = 0; i < media.photos.length; i++) {
    const blob = await photoBlob(media.photos[i].src);
    const res = await fetch(`${SB_URL}/storage/v1/object/vt-pages/${paths[i]}`, {
      method: 'POST', headers: { apikey: SB_KEY, 'content-type': 'image/jpeg' }, body: blob,
    });
    if (!res.ok) throw new Error('Tải ảnh lên chưa được, kiểm tra mạng rồi thử lại.');
    out.push(paths[i]);
  }
  return out;
}
let publishing = false;
async function publishPage() {
  if (publishing) return;
  if (!state.house) { toast('Dán vị trí căn nhà trước.'); return; }
  if (!account.profile) { const ok = await requireLogin('Đăng nhập để tạo trang web cho căn nhà.'); if (!ok) return; }
  publishing = true;
  const btn = $('pagePublish');
  btn.disabled = true;
  try {
    const key = photoKey(state.house);
    const map = readPages();
    const rec = map[key] || {};
    const sig = media.photos.map(p => p.src.length + ':' + p.src.slice(-32)).join('|');
    let photos = rec.photos || [];
    if (sig !== rec.sig) {
      btn.textContent = media.photos.length ? 'Đang tải ảnh lên…' : 'Đang lưu…';
      photos = await uploadPhotos();
    }
    btn.textContent = 'Đang lưu trang…';
    const title = (state.title || '').trim();
    const generic = !title || /^vị trí\s*(&|và)\s*tiện ích$/i.test(title);
    const address = state.sub || [state.admin?.commune, state.admin?.province].filter(Boolean).join(', ');
    const p = await rpc('vt_page_save', {
      p_token: account.token,
      p: {
        id: rec.id || null,
        title: generic ? [TYPE_WORD[state.typeLabel] || 'Căn nhà', address].filter(Boolean).join(' · ') : title,
        price: state.price, area: state.area, beds: state.beds, legal: state.legal, address,
        lat: state.house.lat, lng: state.house.lng, phone: state.phone, brand: state.brand, style: state.style,
        video_url: (state.pageVideo || '').trim(), description: state.pageDesc || '', photos,
        pois: selectedPois().slice(0, 10).map(x => ({ name: x.name, cat: x.cat, catName: CATEGORIES[x.cat]?.label || '', km: Math.round((x.route ? x.route.km : x.km) * 100) / 100 })),
        roads: selectedRoads().map(r => ({ label: r.label, km: Math.round(r.nearKm * 100) / 100 })),
      },
    }).catch(async e => {
      // Trang đã bị xoá ở máy khác: tạo trang mới
      if (rec.id && /Không tìm thấy/.test(e.message)) { delete map[key]; writePages(map); throw new Error('Trang cũ đã bị xoá. Bấm lại để tạo trang mới.'); }
      throw e;
    });
    map[key] = { id: p.id, slug: p.slug, photos, sig };
    writePages(map);
    showPageResult();
    if (state.pageVideo && !p.video_url) toast('Link video chưa đúng (chỉ nhận TikTok, YouTube, Facebook). Trang vẫn đã lưu.', 4500);
    else toast(rec.id ? 'Đã cập nhật trang web, link giữ nguyên.' : 'Đã tạo trang web cho căn này. Chép link gắn vào bài đăng nhé!', 4000);
  } catch (e) {
    toast(e.message || 'Chưa lưu được trang, thử lại giúp em.', 4000);
  } finally {
    publishing = false;
    btn.disabled = false;
    showPageResult();
  }
}
async function sharePage() {
  const rec = pageRec();
  if (!rec) return;
  const url = pageUrl(rec.slug);
  const text = [state.price, state.title].filter(Boolean).join(' · ');
  if (navigator.share) { try { await navigator.share({ title: text || 'Căn nhà', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Đã chép link trang.'); } catch { prompt('Chép link này:', url); }
}

// ---------- Âm thanh ----------
async function pickAudio(kind, file) {
  if (!file) return;
  try {
    const buf = await decodeAudioFile(file);
    if (kind === 'music') { state.musicLib = ''; $('musicLib').value = ''; }
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
  if (kind === 'music') { state.musicLib = ''; $('musicLib').value = ''; save(); }
  media[kind] = null;
  media[kind + 'Name'] = '';
  $(kind + 'Name').textContent = 'Chưa có';
  $(kind + 'Clear').hidden = true;
  $(kind + 'File').value = '';
  media.mixKey = '';
  scheduleRebuild();
}

// ---------- Tự đọc theo kịch bản ----------
// Khách đọc lời đọc từng cảnh bằng giọng của mình (thu ngay trong app hoặc tải file). App cắt thành từng câu
// (theo mốc bấm "Câu tiếp", không có mốc thì theo khoảng lặng) rồi gắn vào từng cảnh như giọng AI:
// mỗi cảnh kéo dài đúng bằng câu đọc của nó, phụ đề chạy theo, không tốn lượt.
const rec = { stream: null, mr: null, chunks: [], marks: [], t0: 0, idx: -1, segs: [], timer: 0, actx: null, an: null, blob: null, url: '' };
const recSegs = () => scriptSegments().filter(sg => speakable(sg.text));
async function applyOwnVoice(buf, marks) {
  const segs = recSegs();
  if (!segs.length) { toast('Chưa có kịch bản. Quét và chọn tiện ích trước.'); return false; }
  const parts = segs.map(sg => speakable(sg.text));
  const pieces = marks && marks.length === segs.length - 1 ? splitAt(buf, marks) : splitVoice(buf, parts);
  media.voiceSegs.clear();
  segs.forEach((sg, i) => media.voiceSegs.set(sg.key, { ck: voiceKey(sg.text), buffer: pieces[i], own: true }));
  // Bỏ file giọng liền (nếu có) để không phát chồng
  if (media.voice) { media.voice = null; media.voiceName = ''; $('voiceName').textContent = 'Chưa có'; $('voiceClear').hidden = true; }
  state.aiVoiceOn = true; $('aiVoiceOn').checked = true;
  media.mixKey = '';
  renderScript();
  scheduleRebuild();
  const total = pieces.reduce((x, b) => x + b.duration, 0);
  $('ownVoiceMsg').textContent = `Đã khớp giọng của anh/chị vào ${segs.length} cảnh (${fmtTime(total)}). Bấm phát để nghe thử; câu nào lệch thì thu lại.`;
  return true;
}
function renderRecLines() {
  const el = $('recLines');
  el.innerHTML = rec.segs.map((sg, i) => `<div class="rec-line${i === rec.idx ? ' on' : i < rec.idx ? ' done' : ''}"><small>${i + 1}/${rec.segs.length} · ${esc(sg.label || '')}</small>${esc(sg.text)}</div>`).join('');
  el.querySelector('.on')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('recNext').textContent = rec.idx >= rec.segs.length - 1 ? 'Xong ✓' : 'Câu tiếp ›';
}
function recButtons(mode) {
  $('recStart').hidden = mode !== 'idle';
  $('recNext').hidden = mode !== 'rec';
  $('recRedo').hidden = mode !== 'done';
  $('recUse').hidden = mode !== 'done';
  $('recPlay').hidden = mode !== 'done';
}
function recCleanup() {
  clearInterval(rec.timer);
  try { if (rec.mr && rec.mr.state !== 'inactive') rec.mr.stop(); } catch { /* bỏ qua */ }
  rec.stream?.getTracks().forEach(tr => tr.stop());
  rec.actx?.close().catch(() => {});
  rec.stream = null; rec.actx = null; rec.an = null;
}
function openRecorder() {
  rec.segs = recSegs();
  if (!rec.segs.length) { toast('Chưa có kịch bản. Quét và chọn tiện ích trước.'); return; }
  pause();
  rec.idx = -1; rec.marks = []; rec.blob = null;
  $('recTime').textContent = '00:00';
  renderRecLines();
  recButtons('idle');
  $('recDlg').showModal();
}
async function recStart() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('Trình duyệt này không thu âm được. Dùng Chrome hoặc Safari bản mới, hoặc tải file đã đọc.', 5000); return;
  }
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    toast('Không mở được micro. Cho phép trình duyệt dùng micro rồi thử lại.', 5000); return;
  }
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  const mimeType = types.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
  rec.mr = new MediaRecorder(rec.stream, mimeType ? { mimeType } : undefined);
  rec.chunks = [];
  rec.mr.ondataavailable = e => { if (e.data.size) rec.chunks.push(e.data); };
  // Đồng hồ + vạch âm lượng để khách biết micro đang nhận tiếng
  try {
    rec.actx = new AudioContext();
    rec.an = rec.actx.createAnalyser(); rec.an.fftSize = 512;
    rec.actx.createMediaStreamSource(rec.stream).connect(rec.an);
  } catch { rec.an = null; }
  rec.mr.start(250);
  rec.t0 = performance.now();
  rec.idx = 0; rec.marks = [];
  renderRecLines();
  recButtons('rec');
  const cv = $('recMeter'), cx = cv.getContext('2d'), buf = new Uint8Array(256);
  rec.timer = setInterval(() => {
    $('recTime').textContent = fmtTime((performance.now() - rec.t0) / 1000);
    if (!rec.an) return;
    rec.an.getByteTimeDomainData(buf);
    let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128));
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.fillStyle = m > 100 ? '#e5484d' : '#2fb67c';
    cx.fillRect(0, 6, cv.width * Math.min(1, m / 110), 16);
  }, 60);
}
function recNext() {
  if (!rec.mr || rec.mr.state !== 'recording') return;
  if (rec.idx < rec.segs.length - 1) {
    rec.marks.push((performance.now() - rec.t0) / 1000);
    rec.idx++;
    renderRecLines();
  } else recStop();
}
async function recStop() {
  const mr = rec.mr;
  const stopped = new Promise(r => { mr.onstop = r; });
  mr.stop();
  await stopped;
  recCleanup();
  rec.idx = rec.segs.length;
  renderRecLines();
  rec.blob = new Blob(rec.chunks, { type: mr.mimeType || 'audio/webm' });
  if (rec.url) URL.revokeObjectURL(rec.url);
  rec.url = URL.createObjectURL(rec.blob);
  $('recPlay').src = rec.url;
  recButtons('done');
}
async function recUse() {
  if (!rec.blob) return;
  $('recUse').disabled = true;
  try {
    const buf = await decodeAudioFile(rec.blob);
    if (await applyOwnVoice(buf, rec.marks)) { $('recDlg').close(); toast('Đã khớp giọng của anh/chị vào video.'); }
  } catch {
    toast('Không đọc được bản thu. Thử thu lại.', 4000);
  } finally { $('recUse').disabled = false; }
}
async function pickOwnVoice(file) {
  if (!file) return;
  $('ownVoiceMsg').textContent = 'Đang cắt giọng theo từng câu…';
  try {
    const buf = await decodeAudioFile(file);
    await applyOwnVoice(buf, null);
  } catch {
    $('ownVoiceMsg').textContent = 'Không đọc được file này. Thử file MP3, M4A hoặc WAV.';
  } finally { $('ownVoiceFile').value = ''; }
}

// ---------- Gắn sự kiện ----------
function init() {
  countVisit('app');
  load();
  state.simple = false;
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
  if (['cungluc', 'tiaxa'].includes(state.flow)) state.flow = 'radar';
  setSeg('flowSeg', state.flow === 'radar' ? 'radar' : 'lanluot');
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
  // Ngôi sao: khoanh vùng nổi bật tiện ích quan trọng (tự chọn luôn điểm đó)
  $('poiList').addEventListener('click', e => {
    const m = e.target.closest('.poi-more');
    if (m) { e.preventDefault(); poiOpen.add(m.dataset.more); renderLists(); return; }
    const b = e.target.closest('.poi-star');
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.star;
    const on = !(state.stars || []).includes(id);
    state.stars = on ? [...new Set([...(state.stars || []), id])] : state.stars.filter(x => x !== id);
    b.setAttribute('aria-pressed', String(on));
    if (on && !state.selected.includes(id)) {
      if (state.selected.length >= MAX_POIS) { toast(`Tối đa ${MAX_POIS} tiện ích. Bỏ chọn bớt điểm khác trước.`); state.stars = state.stars.filter(x => x !== id); b.setAttribute('aria-pressed', 'false'); return; }
      state.selected = [...state.selected, id];
      const cb = $('poiList').querySelector(`input[data-poi="${CSS.escape(id)}"]`); if (cb) cb.checked = true;
      queueRoutes(); updateRowKm(id); updateCount();
    }
    if (on) toast('Điểm này sẽ được khoanh vùng nổi bật trong video.');
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
  bindSeg('flowSeg', v => { state.flow = v; scheduleRebuild(); });
  bindSeg('qualSeg', v => { state.quality = v; save(); });
  $('titleInput').addEventListener('input', e => { state.title = e.target.value; scheduleRebuild(); });
  $('showStreets').checked = state.showStreets !== false;
  $('showStreets').addEventListener('change', e => { state.showStreets = e.target.checked; scheduleRebuild(); });
  for (const [id, key] of [['areaWardInput', 'areaWard'], ['areaProvInput', 'areaProv'], ['roadWidthInput', 'roadWidth']]) {
    $(id).value = state[key] || '';
    $(id).addEventListener('input', e => { state[key] = e.target.value; scheduleRebuild(); });
  }
  updateAreaPlaceholders();
  $('brandInput').addEventListener('input', e => { state.brand = e.target.value; scheduleRebuild(); });
  $('musicFile').addEventListener('change', e => pickAudio('music', e.target.files[0]));
  $('musicLib').innerHTML = '<option value="">— Không dùng —</option>' + MUSIC_LIB.map(x => `<option value="${x.id}">${esc(x.label)}</option>`).join('');
  $('musicLib').value = state.musicLib || '';
  $('musicLib').addEventListener('change', e => pickLibrary(e.target.value));
  if (state.musicLib) pickLibrary(state.musicLib);
  // Thông tin căn nhà
  for (const [id, key] of [['priceInput', 'price'], ['areaInput', 'area'], ['thoCuInput', 'thoCu'], ['floorsInput', 'floors'], ['bedsInput', 'beds'], ['legalInput', 'legal']]) {
    $(id).value = state[key] || '';
    $(id).addEventListener('input', e => { state[key] = e.target.value; renderScript(); scheduleRebuild(); });
  }
  // Logo + phụ đề
  $('logoBg').checked = state.logoBg !== false;
  $('logoBg').addEventListener('change', e => { state.logoBg = e.target.checked; scheduleRebuild(); });
  $('logoFile').addEventListener('change', e => pickLogo(e.target.files[0]));
  $('photoFile').addEventListener('change', e => pickPhotos(e.target.files));
  $('pageVideo').value = state.pageVideo || '';
  $('pageDesc').value = state.pageDesc || '';
  $('pageVideo').addEventListener('input', e => { state.pageVideo = e.target.value; save(); });
  $('pageDesc').addEventListener('input', e => { state.pageDesc = e.target.value; save(); });
  $('pagePublish').addEventListener('click', publishPage);
  $('pageCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('pageLink').value); toast('Đã chép link trang.'); } catch { $('pageLink').select(); } });
  $('pageShare').addEventListener('click', sharePage);
  $('pageQrBtn').addEventListener('click', () => { const r = pageRec(); if (r) downloadPageQr({ slug: r.slug, price: state.price, title: state.title }); });
  $('photoRow').addEventListener('click', e => { const b = e.target.closest('button[data-rm]'); if (b) removePhoto(Number(b.dataset.rm)); });
  $('logoClear').addEventListener('click', clearLogo);
  $('subsOn').checked = state.subsOn !== false;
  $('subsOn').addEventListener('change', e => { state.subsOn = e.target.checked; scheduleRebuild(); });
  let savedLogo = null;
  try { savedLogo = localStorage.getItem(LOGO_STORE); } catch { /* bỏ qua */ }
  if (savedLogo) loadLogo(savedLogo).then(img => { media.logo = img; showLogo(); scheduleRebuild(); });
  $('voiceFile').addEventListener('change', e => pickAudio('voice', e.target.files[0]));
  $('ownVoiceFile').addEventListener('change', e => pickOwnVoice(e.target.files[0]));
  $('recOpen').addEventListener('click', openRecorder);
  $('recStart').addEventListener('click', recStart);
  $('recNext').addEventListener('click', recNext);
  $('recRedo').addEventListener('click', () => { rec.idx = -1; rec.marks = []; renderRecLines(); recButtons('idle'); recStart(); });
  $('recUse').addEventListener('click', recUse);
  $('recDlg').addEventListener('close', recCleanup);
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && $('recDlg').open && rec.mr?.state === 'recording') { e.preventDefault(); recNext(); }
  });
  $('musicClear').addEventListener('click', () => clearAudio('music'));
  $('voiceClear').addEventListener('click', () => clearAudio('voice'));
  $('musicVol').addEventListener('input', e => { state.musicVol = parseFloat(e.target.value); media.mixKey = ''; save(); });
  $('fitVoice').addEventListener('change', e => { state.fitVoice = e.target.checked; scheduleRebuild(); });
  renderSwatches('roadThemeRow', 'roadTheme', true);
  renderSwatches('routeThemeRow', 'routeTheme', false);
  setSeg('labelFaceSeg', state.roadLabelFace || 'trang');
  bindSeg('labelFaceSeg', v => { state.roadLabelFace = v; save(); scheduleRebuild(); });
  renderStyles();
  renderBases();
  setSeg('voiceSeg', state.voiceId);
  setSeg('vspeedSeg', String(state.voiceSpeed));
  $('sfxOn').checked = state.sfxOn;
  $('sfxVol').value = state.sfxVol;
  $('aiVoiceOn').checked = state.aiVoiceOn;
  bindSeg('voiceSeg', v => { state.voiceId = v; renderScript(); save(); });
  // Đổi tốc độ đọc: giọng đã tạo tự co giãn theo (không mất giọng, không tốn lượt)
  bindSeg('vspeedSeg', async v => {
    state.voiceSpeed = Number(v);
    save();
    // co giãn từng câu, nhường máy giữa các câu để giao diện không bị đứng trên điện thoại
    const segs = scriptSegments().filter(sg => voiceOk(sg));
    if (segs.length) {
      $('ttsMsg').textContent = 'Đang chỉnh tốc độ giọng đọc…';
      for (const sg of segs) { voiceBuf(sg); await new Promise(r => setTimeout(r, 0)); }
      $('ttsMsg').textContent = 'Đã đổi tốc độ đọc, giữ nguyên giọng đã tạo (không tốn lượt).';
    }
    media.mixKey = '';
    renderScript(); scheduleRebuild();
  });
  $('sfxOn').addEventListener('change', e => { state.sfxOn = e.target.checked; media.mixKey = ''; save(); });
  $('sfxVol').addEventListener('input', e => { state.sfxVol = parseFloat(e.target.value); media.mixKey = ''; save(); });
  $('aiVoiceOn').addEventListener('change', e => { state.aiVoiceOn = e.target.checked; scheduleRebuild(); });
  $('aiScriptBtn').addEventListener('click', aiRewrite);
  if (!state.voSig) state.aiTone = ''; // căn chưa tạo giọng: khách chọn lại phong cách
  setSeg('aiToneSeg', state.aiTone || '');
  bindSeg('aiToneSeg', v => { state.aiTone = v; $('aiToneSeg').classList.remove('need'); save(); updateVoCard(); updateQuick(); });
  bindSeg('scriptSrcSeg', v => { if (v === 'ai' && !ai.script) return; state.scriptMode = v; save(); updateVoCard(); });
  $('voVoiceOnly').addEventListener('click', () => makeScriptAndVoice({ fresh: true }));
  $('altScriptBtn').addEventListener('click', altScript);
  $('phoneInput').value = state.phone || '';
  $('phoneInput').addEventListener('input', e => { state.phone = e.target.value; renderScript(); scheduleRebuild(); });
  $('ttsBtn').addEventListener('click', () => makeScriptAndVoice());
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
  $('editPinBtn').addEventListener('click', () => toggleEdit(undefined, 'pin'));
  $('lotBtn').addEventListener('click', () => toggleEdit(undefined, 'lot'));
  $('lotZoomIn').addEventListener('click', () => { lotZoom = Math.min(20.5, lotZoom + 0.5); dirty = true; });
  $('lotZoomOut').addEventListener('click', () => { lotZoom = Math.max(16.5, lotZoom - 0.5); dirty = true; });
  $('lotText').value = state.lotText || '';
  $('lotArea').value = state.lotArea || '';
  $('lotText').addEventListener('input', e => { state.lotText = e.target.value; save(); });
  $('lotArea').addEventListener('input', e => { state.lotArea = e.target.value; save(); });
  $('lotUndo').addEventListener('click', () => { state.lot.pop(); dirty = true; updateLotMsg(); save(); });
  $('lotClear').addEventListener('click', () => { state.lot = []; dirty = true; updateLotMsg(); save(); });
  $('lotDone').addEventListener('click', () => {
    if (state.lot.length && state.lot.length < 3) { toast('Lô đất cần ít nhất 3 góc.'); return; }
    toggleEdit(false);
    if (state.lot.length >= 3) toast(`Đã lưu lô đất khoảng ${formatArea(lotAreaM2(state.lot))}. Video sẽ zoom cận vào lô rồi mới ra bán kính.`, 3800);
  });
  $('bigPlay').addEventListener('click', e => { e.stopPropagation(); play(); });
  canvas.addEventListener('click', e => {
    if (!editing) { playing ? pause() : play(); return; }
    const rect = canvas.getBoundingClientRect();
    if (editMode === 'lot') {
      if (state.lot.length >= 12) { toast('Tối đa 12 góc.'); return; }
      state.lot.push(editTapToLatLng(state.house, state.fmt, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, lotZoom));
      dirty = true; updateLotMsg(); save();
      return;
    }
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
  // Các bước
  $('quickDemo').addEventListener('click', () => { state.coordSet = true; applyCoords($('coordInput').value || state.coordText); updateQuick(); scan(); });
  $('stepper').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) showStep(+b.dataset.go); });
  $('panel').addEventListener('click', e => { const b = e.target.closest('.empty-state [data-go]'); if (b) showStep(+b.dataset.go); });
  $('stepNext').addEventListener('click', stepNext);
  $('stepBack').addEventListener('click', () => showStep(step - 1));
  // ▶ Xem: cuộn lên khung xem trước rồi phát từ đầu
  $('navPlay').addEventListener('click', () => {
    document.querySelector('.stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (playing) pause();
    t = 0; updateTimeUi(); play();
  });
  $('subtabs').addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (b) setSub(b.dataset.sub); });
  for (const b of document.querySelectorAll('.pane-next')) b.addEventListener('click', () => setSub(b.dataset.next, { scroll: true }));
  document.querySelector('[data-nav="studio"]').addEventListener('click', () => showStep(step));
  // Điện thoại: khung xem trước giữ MỘT cỡ cố định (trước đây tự thu nhỏ khi cuộn làm cả trang giật lên xuống)
  // Căn đã lưu
  $('saveProjBtn').addEventListener('click', () => openProjects(true));
  $('projListBtn').addEventListener('click', () => openProjects(false));
  $('projSaveBtn').addEventListener('click', async () => {
    if (await saveProject({ name: $('projName').value })) { $('projMsg').textContent = 'Đã lưu.'; $('projMsg').className = 'hint ok'; loadProjects(); }
  });
  $('projName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('projSaveBtn').click(); } });
  $('projList').addEventListener('click', projListClick);
  $('cancelBtn').addEventListener('click', () => exportCtrl?.abort());
  $('saveBtn').addEventListener('click', saveResult);
  $('shareBtn').addEventListener('click', shareResult);

  initInstall({ toast, onChange: () => {} });
  setAccountLocation(state.house);
  initLeads({ toast });
  initAccount({ toast }).then(() => {
    // Link từ trang giới thiệu: /#dangky mở đăng ký, /#mua mở bảng giá
    const h = location.hash;
    if (h === '#dangky' || h === '#mua' || h === '#khach') history.replaceState(null, '', location.pathname + location.search);
    if (h === '#khach') openLeads('leads');
    if (h === '#dangky' && !account.profile) requireLogin('', 'register');
    else if (h === '#mua') openPricing();
  });
  initTracking();
  new ResizeObserver(() => layoutCanvas()).observe($('canvasWrap').parentElement);
  window.addEventListener('resize', layoutCanvas);
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });

  showStep(state.pois.length ? 3 : 1, { scroll: false });
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
