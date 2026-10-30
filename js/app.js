// Điều khiển giao diện: nhập toạ độ → quét → chọn → xem trước → xuất video.
import { parseCoords, haversineKm, formatKm } from './geo.js';
import { CATEGORIES, scanArea, autoPick, autoPickRoads, routeTo, searchPlaces, placesNear, guessCategory, stitchWays, bridgeWays, localFrame, pickHubs, loadInfra, simplifyLine } from './data.js';
import { ICON_PATHS } from './icons.js';
import {
  FORMATS, TileCache, setImageryToken, buildTimeline, render, renderEdit, editTapToLatLng, lotAreaM2, formatArea, CAT_COLORS, FONT, LINE_THEMES, HI_THEMES, LOT_STYLES, LOT_COLORS, STYLES, BASES,
  CLIP_MAX, clipTime, camAt,
} from './render.js';
import { sfxEvents, setSfxSample, hasSfxSample } from './sfx.js';
import { loadMau1Fonts } from './mau1.js';
import { stretchBuffer } from './stretch.js';
import { parseCoordText, checkPolygon, convertLot, MERIDIANS, fmtMeridian } from './vn2000.js';
import { decodeAudioFile, mixAudio, preloadTiles, exportMp4, exportRealtime, canEncodeMp4, unlockAudioContext } from './export.js';
import { MOTION } from './motion.js';
import { processPlan, FULL_QUAD, planNeedsAlpha } from './planimg.js';
import { onAccountChange, initAccount, setAccountLocation, beginExport, requireLogin, authHeaders, handleAiError, account, openPricing, rpc, refreshAccount } from './account.js';
import { splitVoice, joinForTts, splitAt } from './voicesplit.js';
import { loadConfig, initTracking, countVisit, funnel } from './track.js';
import { initInstall } from './install.js';
import { initLeads, downloadPageQr, pageUrl, openLeads } from './leads.js';
import { SB_URL, SB_KEY } from './sb.js';
import { speakNumbers, speakPhones } from './vinum.js';

const $ = id => document.getElementById(id);
const STORE = 'vitri.project.v1';
const MAX_POIS = 10;
const ROAD_DOT = { 3: '#FF7A1A', 2: '#FFB627', 1: '#E9C46A', 0: '#8ECAE6' };

const DEFAULT_TITLE = 'Vị trí & tiện ích';
const state = {
  coordText: '10.6900, 106.5900',
  house: { lat: 10.69, lng: 106.59 },
  typeLabel: 'VỊ TRÍ CĂN NHÀ',
  label: 'VỊ TRÍ CĂN NHÀ',
  sub: '',
  radiusKm: 5,
  title: DEFAULT_TITLE,
  showTitle: true,   // 27/10: khách tắt được dải tiêu đề trên đầu video (giữ chữ đã gõ)
  brand: '',
  phone: '',
  price: '',         // thông tin căn nhà hiện trên video + giọng đọc
  area: '',
  beds: '',
  thoCu: '',         // diện tích đất thổ cư
  floors: '',        // số tầng (nhà)
  legal: '',
  highlights: '', // điểm nổi bật môi giới tự ghi (mỗi dòng 1 ý) → kịch bản AI
  buyer: '',      // khách nhắm tới: o | dau_tu | cho_thue
  subsOn: true,      // phụ đề chạy chữ theo giọng AI
  logoBg: true,      // nền trắng sau logo
  musicLib: 'hung-hon', // nhạc nền có sẵn đang chọn (khách mới mặc định nhạc hùng hồn; ai đã chọn/bỏ nhạc thì giữ lựa chọn cũ)
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
  planOn: true,      // khách tắt được mặt bằng mà không xoá
  plan: null,        // mặt bằng phân lô đã khớp lên bản đồ { w, h, lat, lng (tâm ảnh), mpp (m/điểm ảnh), rot (rad), op, pins }
  myRoads: [],       // đường khách tự vẽ (hẻm, đường dân sinh app chưa quét được): [{ id, label, pts: [[lat,lng]…] }]
  lotText: '',       // chữ 3D nằm trên lô
  adminArea: null,   // ranh xã/phường + tỉnh {ward, province} (KHÁC state.area = diện tích khách nhập)
  areaWard: '', areaProv: '', roadWidth: '',
  showStreets: true, // vẽ đường quanh nhà kiểu đường nhựa
  showAdminArea: true, // cảnh khoanh vùng xã/phường + cả tỉnh/thành (28/10 Giang: MẶC ĐỊNH BẬT lại, khách bỏ tick để tắt)
  showSweep: true,   // tia radar quét ở cảnh bán kính + tổng kết (28/10 Giang: MẶC ĐỊNH BẬT lại; SFX radar vẫn tắt vì chói tai)
  fxV: 2,            // 28/10: phiên bản mặc định 2 hiệu ứng trên (2 = bật)
  rentPick: '', // loại cho thuê chọn gần nhất (nút "Cho thuê" mở lại đúng loại đó)
  aiTone: '', // phong cách kịch bản AI — để trống, khách phải tự chọn trước khi tạo
  keyLook: '',      // 30/10 'mau1' = chữ điểm nhấn + icon mẫu 1 (Hook Kit) lúc giọng đọc nói giá/mét/phút… — chỉ admin bật (mau1On())
  scriptMode: 'ai', // 'ai' = AI viết (mặc định, nổi bật) | 'mau' = kịch bản mẫu | 'tu' = tự viết/dán
  scriptOwn: false, // lời đang có do khách tự gõ/sửa → hỏi trước khi AI/mẫu thay
  voSig: '', // lựa chọn (cách viết + phong cách) của lần tạo giọng gần nhất
  lotArea: '',       // diện tích hiển thị (trống = tự tính)
  stars: [],         // id tiện ích được khoanh vùng nổi bật
  roadFills: {},     // id tuyến → các đoạn đường thật (lấy bằng chỉ đường) lấp chỗ hở dữ liệu
  roadStars: [],     // id trục đường "điểm nhấn" (line nổi có xung sáng), tối đa 2
  iso: null,         // vùng lái xe 5–10–15 phút từ nhà {areas:[{min, rings}]} (ArcGIS), theo từng căn
  isoFor: '',        // toạ độ căn đã lấy vùng (làm tròn) — đổi căn thì lấy lại
  showIso: true,     // khách tắt/bật cảnh vùng lái xe
  region: null,      // kết nối vùng {anchors:[điểm mốc + đường đi + phút], infra:[tuyến đang thi công]}, theo từng căn
  regionFor: '',     // toạ độ căn đã tính kết nối vùng (làm tròn)
  showRegion: true,  // cảnh Kết nối vùng (thời gian tới trung tâm, sân bay, cảng…)
  showInfra: true,   // cảnh Hạ tầng đang thi công gần nhà
  regionOff: [],     // id điểm mốc / tuyến hạ tầng khách tắt
  hiTheme: 'dien',   // màu line trục đường điểm nhấn (HI_THEMES)
  lotStyle: 'phatsang', // kiểu viền làm nổi lô đất (LOT_STYLES) — mặc định = kiểu gốc
  lotSrc: '',        // lô lấy từ đâu: 'so' (toạ độ sổ đỏ, chính xác) | 'tay' (chạm vẽ, ước lượng)
  lotDims: 'auto',   // ghi kích thước lô: auto = bật khi lô lấy từ sổ | on | off
  lotColor: 'auto',  // màu viền lô: auto = theo phong cách video (LOT_COLORS)
  pageVideo: '',     // link video đã đăng (gắn vào trang web căn nhà)
  pageDesc: '',
  roadTheme: 'auto',
  routeTheme: 'vang',
  roadLabelFace: 'line', // chữ tên trục đường 3D: line (mặc định, mặt chữ theo màu line) | trang | vang
  labelV: 3,
  musicV: 2,         // 24/10: phiên bản mặc định nhạc nền (2 = có nhạc hùng hồn)
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
const media = { music: null, voice: null, musicName: '', voiceName: '', mixed: null, mixKey: '', voiceSegs: new Map(), voiceCache: new Map(), logo: null, photos: [], clips: [], planImg: null, planRaw: null };
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
      if (o.labelV !== 3) { o.roadLabelFace = 'line'; o.labelV = 3; } // 23/10 tối: mặc định về kiểu gốc theo màu line
      if (o.roadLabelFace === 'vangkim') o.roadLabelFace = 'vang'; // bỏ kiểu Vàng kim (23/10): còn Trắng / Vàng
      // 24/10: trước đây mặc định không có nhạc (đa số khách chưa từng chọn) → bật nhạc hùng hồn một lần; khách đổi lại được
      if (o.musicV !== 2) { if (!o.musicLib) o.musicLib = 'hung-hon'; o.musicV = 2; }
      // 28/10: bật lại khoanh xã/phường → tỉnh/thành + tia radar (24/10 tối đặt mặc định tắt) một lần.
      // Căn đang có giọng đọc thì KHÔNG đổi ngay (thêm cảnh tỉnh sẽ thiếu giọng 1 câu) — bật khi khách sang căn mới.
      if (o.fxV !== 2) { o.fxV = 2; if (!o.voSig) { o.showAdminArea = true; o.showSweep = true; } else o.fxPending = true; }
      Object.assign(state, o);
    }
  } catch { /* bỏ qua */ }
}

// ---------- Tiện ích giao diện ----------
let toastTimer;
// ---------- Hỗ trợ: mục "Hỗ trợ" (Zalo Giang) ----------
// Bấm mục Hỗ trợ: mở Zalo của Giang và tự chép sẵn thông tin căn + lỗi gần nhất để khách dán vào tin nhắn (Giang hỗ trợ nhanh, khỏi hỏi lại)
let lastIssue = '';
function supportText() {
  const p = account.profile;
  const h = state.house;
  return [
    'Chào Giang, mình cần hỗ trợ Vị Trí Studio.',
    p?.login ? 'Tài khoản: ' + p.login : '',
    h ? `Toạ độ căn: ${h.lat.toFixed(6)}, ${h.lng.toFixed(6)}` : '',
    lastIssue ? 'Lỗi gặp: ' + lastIssue : '',
    'Máy: ' + (navigator.userAgent.match(/iPhone|iPad|Android[^;)]*|Windows NT [\d.]+|Mac OS X [\d_]+/)?.[0] || 'khác'),
    'Nội dung: ',
  ].filter(Boolean).join('\n');
}
function pulseSupport() {
  for (const f of document.querySelectorAll('#zaloFab')) {
    if (f.hidden || !f.offsetParent) continue;
    f.classList.remove('pulse'); void f.offsetWidth; f.classList.add('pulse');
  }
}
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
// Nối lại chỗ hở giữa các đoạn của cùng tuyến (cả căn đã quét/lưu trước bản sửa 24/10), nhớ kết quả theo tuyến
const stitchCache = new Map();
function stitchedWays(r) {
  const H = state.house;
  const fills = (state.roadFills || {})[r.id] || [];
  const src = fills.length ? [...r.ways, ...fills] : r.ways;
  if (!H || !src || src.length < 2) return src;
  const key = 'b3:' + r.id + ':' + src.length + ':' + src.reduce((s, w) => s + w.length, 0) + ':' + H.lat.toFixed(4) + ',' + H.lng.toFixed(4);
  let w = stitchCache.get(key);
  if (!w) {
    try { const F = localFrame(H); w = bridgeWays(stitchWays(src, F, r.level >= 3 ? 3 : 0.6), F, r.level >= 3 ? 4 : 1.5); } catch { w = src; }
    if (stitchCache.size > 60) stitchCache.clear();
    stitchCache.set(key, w);
  }
  return w;
}
// 24/10: chỗ hở trên trục đường lớn (dữ liệu bản đồ thiếu đoạn) được lấp bằng ĐƯỜNG ĐI THẬT giữa hai đầu mút,
// lấy từ cùng dịch vụ chỉ đường vẽ đường tới tiện ích (/api/map/route: Vietmap, dự phòng OSRM) — nên line liền và bám đúng mặt đường.
// Chỉ nhận đường đi gần thẳng (≤ 1,6× khoảng cách + 0,3 km) để không vẽ vòng sang đường khác. Tối đa 8 lần gọi mỗi lần quét.
async function rawRoute(f, t) {
  try {
    const res = await fetch(`/api/map/route?flat=${f.lat.toFixed(6)}&flng=${f.lng.toFixed(6)}&tlat=${t.lat.toFixed(6)}&tlng=${t.lng.toFixed(6)}`);
    if (!res.ok) return null;
    const r = (await res.json()).route;
    return r && r.coords?.length ? r : null;
  } catch { return null; }
}
const fillPending = new Set();
async function fillRoadGaps(onlyIds = null) {
  const H = state.house;
  if (!H) return;
  const hk = H.lat.toFixed(5) + ',' + H.lng.toFixed(5);
  const F = localFrame(H);
  let calls = 0, added = 0;
  state.roadFills ||= {};
  const roads = state.roads.filter(r => state.selectedRoads.includes(r.id) && (!onlyIds || onlyIds.includes(r.id)) && !state.roadFills[r.id] && !fillPending.has(hk + r.id));
  for (const r of roads) {
    fillPending.add(hk + r.id);
    const list = [];
    try {
      const ways = stitchWays(r.ways, F, r.level >= 3 ? 3 : 0.6);
      if (ways.length >= 2) {
        const ends = [];
        ways.forEach((w, i) => {
          ends.push({ i, k: i + ':0', p: w[0], nb: w[Math.min(w.length - 1, 3)] });
          ends.push({ i, k: i + ':1', p: w[w.length - 1], nb: w[Math.max(0, w.length - 4)] });
        });
        const xy = p => F.xy(p);
        const pairs = [];
        for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
          const A = ends[a], B = ends[b];
          if (A.i === B.i) continue;
          const pa = xy(A.p), pb = xy(B.p), d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
          if (d < 0.05 || d > 3) continue;
          // hai đầu không được quay lưng hẳn vào nhau (tránh nối sang nhánh rẽ ngược chiều)
          const da = [pa[0] - xy(A.nb)[0], pa[1] - xy(A.nb)[1]], db = [pb[0] - xy(B.nb)[0], pb[1] - xy(B.nb)[1]];
          const c = [(pb[0] - pa[0]) / d, (pb[1] - pa[1]) / d];
          const na = Math.hypot(...da) || 1, nb = Math.hypot(...db) || 1;
          if ((da[0] * c[0] + da[1] * c[1]) / na < -0.3 || -(db[0] * c[0] + db[1] * c[1]) / nb < -0.3) continue;
          pairs.push({ A, B, d });
        }
        pairs.sort((x, y) => x.d - y.d);
        const used = new Set();
        for (const pr of pairs) {
          if (calls >= 10) break;
          if (used.has(pr.A.k) || used.has(pr.B.k)) continue;
          used.add(pr.A.k); used.add(pr.B.k);
          calls++;
          // Thử cả hai chiều (đường một chiều/tách làn làm một chiều phải đi vòng), lấy chiều ngắn hơn
          const A = { lat: pr.A.p[0], lng: pr.A.p[1] }, B = { lat: pr.B.p[0], lng: pr.B.p[1] };
          const [r1, r2] = await Promise.all([rawRoute(A, B), rawRoute(B, A)]);
          const rt = [r1, r2].filter(Boolean).sort((x, y) => x.km - y.km)[0];
          if (rt && rt.coords?.length > 1 && rt.km <= pr.d * 1.8 + 0.4) list.push([[A.lat, A.lng], ...rt.coords, [B.lat, B.lng]]);
        }
      }
    } finally { fillPending.delete(hk + r.id); }
    // căn đã đổi trong lúc chờ thì bỏ kết quả
    if (!state.house || state.house.lat.toFixed(5) + ',' + state.house.lng.toFixed(5) !== hk) return;
    state.roadFills = { ...(state.roadFills || {}), [r.id]: list };
    if (list.length) { added += list.length; stitchCache.clear(); scheduleRebuild(); }
  }
  if (roads.length) save();
}
function selectedRoads() {
  const hi = state.roadStars || [];
  const mine = (state.myRoads || []).filter(m => m.pts?.length > 1 && state.selectedRoads.includes(m.id)).map(m => ({ ...myRoadObj(m), hi: hi.includes(m.id) }));
  return [...state.roads.filter(r => state.selectedRoads.includes(r.id)).map(r => ({ ...r, ways: stitchedWays(r), hi: hi.includes(r.id) })), ...mine];
}
// Chữ động (gói MOTION trong js/motion.js) — đang thử: chỉ bật khi mở ?motion=1 (nhớ trên máy, ?motion=0 để tắt)
// hoặc đăng nhập tài khoản nội bộ @vitristudio.com. Kiểu chữ tự chọn theo toạ độ căn, khách không phải chọn.
function motionOn() {
  try {
    const q = new URLSearchParams(location.search).get('motion');
    if (q === '1' || q === '0') localStorage.setItem('vitri.motion', q);
    const v = localStorage.getItem('vitri.motion');
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* bỏ qua */ }
  return /@vitristudio\.com$/i.test(String(account.profile?.login || ''));
}
// Thẻ giá mở đầu theo phong cách — mỗi phong cách một kiểu chữ động riêng, cho MỌI khách (chỉ thẻ mở đầu,
// tiêu đề cảnh giữ kiểu cũ: motionHookOnly). 25/10 22:12: Neon = đen – vàng. 26/10 Giang: Sang trọng/Trẻ trung/Tối giản
// trước đây cùng một thẻ cũ giống hệt nhau → tách riêng. Tài khoản nội bộ/?motion=1 thêm tiêu đề động; ?motionKey=… ép 1 gói.
const STYLE_MOTION = { neon: 'denneon', sangtrong: 'tapchi', tretrung: 'khoi', toigian: 'hiendai', xanhla: 'denxanh', doruc: 'dendo' };
// 30/10 14:20 Giang: chọn phong cách thì line trục đường ★ cũng đổi theo màu phong cách (khách vẫn đổi lại được)
const STYLE_HI = { neon: 'dien', sangtrong: 'vang', tretrung: 'hong', toigian: 'trang', xanhla: 'la', doruc: 'do' };
function sceneMotion() {
  if (!state.house) return null;
  if (motionOn()) {
    const forced = (() => { try { return new URLSearchParams(location.search).get('motionKey'); } catch { return null; } })();
    if (forced && MOTION[forced]) return forced;
  }
  return STYLE_MOTION[state.style] || null;
}
// Mẫu 1: chỉ tài khoản admin (@vitristudio.com) bật được; khách thường luôn tắt
function mau1On() { return state.keyLook === 'mau1' && /@vitristudio\.com$/i.test(String(account.profile?.login || '')); }
let mau1Ready = false;
async function prepMau1() {
  if (!mau1On() || mau1Ready) return;
  await loadMau1Fonts();
  try {
    const ac = new OfflineAudioContext(1, 44100, 44100);
    for (const n of ['lk_a', 'lk_b', 'key1', 'key2', 'key3', 'key4', 'key5', 'key6']) if (!hasSfxSample(n)) {
      const r = await fetch(`music/sfx_${n}${n.startsWith('key') ? '.wav' : '2.m4a'}`); // lk_*2.m4a: bản dài hơn 30/10
      if (r.ok) setSfxSample(n, await ac.decodeAudioData(await r.arrayBuffer()));
    }
  } catch { /* không có tiếng gốc thì dùng pop tổng hợp */ }
  mau1Ready = true;
  media.mixKey = ''; dirty = true; rebuild();
}
function syncMau1Row() {
  const row = $('mau1Row');
  if (row) row.hidden = !/@vitristudio\.com$/i.test(String(account.profile?.login || ''));
  const cb = $('mau1On'); if (cb) cb.checked = state.keyLook === 'mau1';
  if (mau1On()) prepMau1();
}
function buildScene() {
  return {
    keyLook: mau1On() ? 'mau1' : '',
    motion: sceneMotion(),
    motionHookOnly: !motionOn(),
    house: state.house,
    label: (state.label || 'VỊ TRÍ').toUpperCase(),
    rent: isRentType(),
    sub: state.sub,
    title: state.showTitle === false ? '' : state.title,
    brand: state.brand,
    phone: phoneDisplay(state.phone),
    logo: media.logo,
    logoBg: state.logoBg,
    photos: media.photos.map(p => p.img),
    photoLabels: media.photos.map(p => roomLabel(p.room)),
    clips: media.clips.map(c => ({ el: c.el, dur: c.dur, room: c.room || '', label: roomLabel(c.room) })),
    info: { price: state.price, area: state.area, thoCu: isRentType() ? '' : state.thoCu, beds: isLandType() || isRoomType() ? '' : state.beds,
      legal: isRentType() ? '' : state.legal, floors: isLandType() || isRoomType() ? '' : state.floors, roadWidth: state.roadWidth },
    radiusKm: state.radiusKm,
    speed: state.speed,
    pois: selectedPois(),
    roads: selectedRoads(),
    iso: state.showIso && state.iso && state.iso.areas?.length ? state.iso : null,
    region: regionScene(),
    boundary: state.useBoundary && state.admin?.boundary ? { ...state.admin.boundary, route: state.routes.__ranh || null } : null,
    provinceShort: state.admin?.provinceShort || '',
    commune: state.admin?.commune || '',
    titleSub: state.showTitle === false ? '' : state.sub,
    style: state.style,
    base: state.base,
    flow: state.flow,
    lot: state.lot && state.lot.length >= 3 ? state.lot : null,
    lotLabel: { text: state.lotText, area: state.lotArea },
    plan: planScene(),
    streets: state.streets || null,
    // 24/10 tối (Giang): cảnh xã/phường sáng lên + lùi ra cả tỉnh/thành MẶC ĐỊNH TẮT (như bản đầu), khách tick mới vẽ
    adminArea: state.showAdminArea && state.adminArea ? {
      ward: state.adminArea.ward, province: state.adminArea.province,
      wardName: (state.areaWard || '').trim() || state.adminArea.ward?.name || state.admin?.commune || '',
      provName: (state.areaProv || '').trim() || state.adminArea.province?.name || state.admin?.province || '',
    } : null,
    roadWidth: (state.roadWidth || '').trim(),
    showStreets: state.showStreets !== false,
    sweep: !!state.showSweep,
    roadTheme: state.roadTheme,
    hiTheme: state.hiTheme,
    lotStyle: state.lotStyle, lotColor: state.lotColor, lotDims: lotDimsOn(),
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
// Lời từng cảnh đã có giọng (cho từ khoá bật lên theo giọng — cần cả khi khách tắt phụ đề)
function voicedTexts() {
  if (!state.aiVoiceOn) return null;
  const out = {};
  for (const sg of scriptSegments()) if (voiceOk(sg)) out[sg.key] = sg.text;
  return out;
}
function timelineOpts() {
  const vd = voiceDurations();
  return vd ? { voice: vd, captions: captionTexts(), keyTexts: sceneMotion() ? voicedTexts() : null } : { fitDuration: voiceFitDuration() };
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
let lotZoom = 18.5;  // mức phóng khi vẽ lô đất (16.5–21.5; trên 19 là phóng to ảnh z19 — mờ dần nhưng chấm chính xác hơn)
let roadZoom = 18;   // mức phóng khi tự vẽ đường (15–21.5)
let editCenter = null; // tâm khung khi vẽ lô/đường (khách kéo để di chuyển); null = căn nhà
let roadDraft = null;  // đường đang vẽ { id|null, label, pts }
const LOT_ZMIN = 16.5, LOT_ZMAX = 21.5, ROAD_ZMIN = 15, ROAD_ZMAX = 21.5;
let poiZoom = 17.5;    // mức phóng khi chạm thêm tiện ích (14–21)
let poiTap = null;     // chỗ khách vừa chạm {lat,lng}
let poiCands = [];     // gợi ý quanh chỗ chạm [{name, lat, lng, km, cat, poiId?, src}]
let poiReq = 0;
let planZoom = 17.5;   // mức phóng khi căn mặt bằng phân lô
let planPick = null;   // đang ghim 2 điểm: { step: 'img1'|'map1'|'img2'|'map2', pts: [{x,y,lat,lng}] }
let planHouse = '';
let voiceHouse = '';
let dirty = true;
let lastFrame = 0;
let audioCtx = null;
let audioSrc = null;
let exporting = false;

// Cho phép soát lỗi từ bảng điều khiển trình duyệt
window.__vitri = { get tl() { return tl; }, camAt: x => camAt(tl, x), get editCenter() { return editCenter; }, get planZoom() { return planZoom; }, get t() { return t; }, state, scanArea, SAMPLE_KEYS: () => SAMPLE_KEYS, pause: () => pause(), aiRewrite: () => aiRewrite() };

function rebuild() {
  if (photoKey(state.house) !== photoHouse) { restorePhotos(); showPageResult(); }
  if (photoKey(state.house) !== planHouse) restorePlan();
  if (photoKey(state.house) !== voiceHouse) restoreVoices();
  if (photoKey(state.house) !== clipHouse) restoreClips();
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
  if (fsOn) { layoutFull(F, wrap); return; }
  const desktop = window.matchMedia('(min-width: 980px)').matches;
  const availW = inner.clientWidth;
  const transportH = 52;
  // Máy tính: chừa chỗ cho thanh vẽ lô / đường / tiện ích / mặt bằng đang mở (không thì khung bị bóp méo hình)
  const bars = desktop ? [...inner.querySelectorAll('.lot-bar')].filter(b => !b.hidden).reduce((s, b) => s + b.offsetHeight + 10, 0) : 0;
  const availH = desktop
    ? Math.max(240, inner.clientHeight - transportH - 10 - bars)
    : editing && editMode !== 'pin'
      ? Math.min(window.innerHeight * 0.66, 680) // điện thoại: đang vẽ lô/đường/mặt bằng → khung to hơn để chạm cho chính xác
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

// ---------- Xem toàn màn hình (28/10) ----------
// Điện thoại: khung xem trước chỉ rộng ~160 px → nút ⤢ phủ kín màn hình. iPhone không cho Fullscreen API với canvas
// nên dùng lớp phủ CSS (.stage.fs, position fixed); máy hỗ trợ (Android, máy tính) thì xin thêm toàn màn hình thật để ẩn
// thanh trình duyệt. Khổ Ngang: Android tự xoay ngang; iPhone khách tự xoay máy, khung tự vừa theo màn hình.
let fsOn = false;
function layoutFull(F, wrap) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const ratio = F.LW / F.LH;
  const availH = Math.max(160, vh - 64); // chừa thanh Phát/tua ở đáy
  let w = Math.min(vw, availH * ratio);
  const h = w / ratio;
  wrap.style.width = Math.round(w) + 'px';
  wrap.style.height = Math.round(h) + 'px';
  // Giữ mượt trên máy yếu: tối đa ~1,6 triệu điểm ảnh (gần 1080p dọc)
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  dpr = Math.min(dpr, Math.sqrt(1.6e6 / (w * h)));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  dirty = true;
}
function setFull(on) {
  on = !!on && !editing && !exporting;
  if (on === fsOn) return;
  fsOn = on;
  const stage = document.querySelector('.stage');
  stage.classList.toggle('fs', on);
  document.documentElement.classList.toggle('fs-lock', on);
  const b = $('fsBtn');
  b.setAttribute('aria-label', on ? 'Thu nhỏ' : 'Xem toàn màn hình');
  b.classList.toggle('on', on);
  if (on) {
    funnel(state.sample ? 'full_mau' : 'full');
    try {
      const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
      const pr = req && req.call(stage, { navigationUI: 'hide' });
      // Khổ ngang: xin xoay ngang (chỉ Android/Chrome cho phép, lỗi thì thôi)
      Promise.resolve(pr).then(() => { if (state.fmt === 'h') return screen.orientation?.lock?.('landscape'); }).catch(() => {});
    } catch { /* iPhone: chỉ dùng lớp phủ */ }
    if (!playing && tl) play();
  } else {
    try { screen.orientation?.unlock?.(); } catch { /* bỏ qua */ }
    const fe = document.fullscreenElement || document.webkitFullscreenElement;
    if (fe) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch { /* bỏ qua */ } }
  }
  layoutCanvas();
}
function initFull() {
  $('fsBtn').addEventListener('click', e => { e.stopPropagation(); setFull(!fsOn); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && fsOn) setFull(false); });
  // Thoát toàn màn hình thật bằng nút Back/Esc của máy → tắt luôn lớp phủ
  const sync = () => { if (fsOn && !(document.fullscreenElement || document.webkitFullscreenElement)) setFull(false); };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('orientationchange', () => setTimeout(layoutCanvas, 250));
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
      renderEdit(ctx, state.house, state.fmt, {
        cache, scale, lot: editMode === 'road' ? null : state.lot, mode: editMode,
        zoom: editMode === 'lot' ? lotZoom : editMode === 'road' ? roadZoom : editMode === 'poi' ? poiZoom : editMode === 'plan' ? planZoom : null,
        center: editMode === 'pin' ? null : editCenter,
        marks: editMode === 'poi' ? poiMarks() : editMode === 'plan' ? planMarks() : null,
        plan: editMode === 'plan' ? planScene(planEditOp(), true, !planPick) : editMode === 'lot' ? planScene(0.45) : null,
        roads: editMode === 'road' ? [...(state.myRoads || []).filter(m => !roadDraft || m.id !== roadDraft.id), ...(roadDraft ? [{ ...roadDraft, active: true }] : [])] : null,
      });
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
    maybeNudge();
  }
  lastFrame = now;
  if (playing || dirty) {
    // Đang dừng ở đầu video: hiện khung có tiêu đề làm ảnh bìa thay vì khung trống
    const rt = !playing && t === 0 && tl.intro ? Math.min(1.6, (tl.intro.t1 - tl.intro.t0) * 0.35) : t;
    if (!exporting) syncClips(tl, rt, playing);
    render(ctx, tl, rt, { cache, scale, request: true });
    dirty = false;
  }
}

// ---------- Mở khoá âm thanh trên iPhone ----------
// Safari chỉ cho Web Audio chạy khi resume() được gọi NGAY trong lúc khách chạm (không qua await), và Web Audio
// bị tắt tiếng khi gạt nút im lặng. Nên: gọi primeAudio() đồng bộ trong mọi thao tác chạm/bấm phát, đặt phiên âm thanh
// kiểu "playback" (iOS 16.4+) và phát kèm một file <audio> im lặng lặp lại để iPhone bật loa cả khi đang để im lặng.
let silentEl = null;
function silentWavUrl() {
  const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function primeAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* trình duyệt cũ */ }
  try {
    audioCtx ||= new AudioContext();
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
    const b = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const s = audioCtx.createBufferSource();
    s.buffer = b; s.connect(audioCtx.destination); s.start(0);
  } catch { /* bỏ qua */ }
  try {
    if (!silentEl) { silentEl = new Audio(silentWavUrl()); silentEl.loop = true; silentEl.setAttribute('playsinline', ''); }
    if (silentEl.paused) silentEl.play().catch(() => {});
  } catch { /* bỏ qua */ }
}

async function play() {
  if (!tl) return;
  primeAudio(); // phải chạy trước mọi await để còn trong lúc khách chạm
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
  try { silentEl?.pause(); } catch { /* bỏ qua */ }
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
  // Chưa được mở khoá (chưa chạm vào trang): đừng chờ mãi — để im, lần chạm sau primeAudio() mở rồi phát lại đúng chỗ
  if (audioCtx.state !== 'running') await Promise.race([audioCtx.resume().catch(() => {}), new Promise(r => setTimeout(r, 400))]);
  if (audioCtx.state !== 'running') return;
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
  if (want && fsOn) setFull(false);
  editing = want;
  editMode = mode;
  if (editing) { pause(); editCenter = state.house ? { ...state.house } : null; }
  if (!editing || editMode !== 'road') roadDraft = null;
  $('editPinBtn').setAttribute('aria-pressed', String(editing && editMode === 'pin'));
  $('lotBtn').setAttribute('aria-pressed', String(editing && editMode === 'lot'));
  $('lotBar').hidden = !(editing && editMode === 'lot');
  $('roadBar').hidden = !(editing && editMode === 'road');
  $('poiBar').hidden = !(editing && editMode === 'poi');
  $('planBar').hidden = !(editing && editMode === 'plan');
  if (!editing || editMode !== 'plan') planPick = null;
  updatePlanMsg();
  if (!editing || editMode !== 'poi') { poiTap = null; poiCands = []; renderPoiCands(); }
  updateRoadMsg();
  updateLotMsg();
  if (!editing) scheduleRebuild();
  $('canvasWrap').classList.toggle('editing', editing);
  layoutCanvas();
  dirty = true;
  updateBigPlay();
}

function updateAreaPlaceholders() {
  $('areaWardInput').placeholder = state.adminArea?.ward?.name || state.admin?.commune || 'Tự nhận diện khi quét';
  $('areaProvInput').placeholder = state.adminArea?.province?.name || state.admin?.province || 'Tự nhận diện khi quét';
}
function updateLotMsg() {
  const n = state.lot.length;
  $('lotMsg').textContent = n === 0 ? 'Chạm lần lượt các góc lô đất trên ảnh.' : n < 3 ? `Đã chấm ${n} góc, chấm thêm ${3 - n} góc nữa.` : `Lô đất ${n} góc · khoảng ${formatArea(lotAreaM2(state.lot))}`;
  $('lotBtn').textContent = n >= 3 ? 'Sửa lô đất' : 'Vẽ lô đất';
  $('lotArea').placeholder = n >= 3 ? formatArea(lotAreaM2(state.lot)) : 'Tự tính';
  renderLotStyles();
}

// ---------- Đường khách tự vẽ (hẻm, đường dân sinh app chưa quét được) ----------
// Mỗi lần chạm là một điểm ghim; chỗ cua chạm dày hơn. Vẽ xong đường đi vào danh sách trục đường như đường app quét:
// có cảnh riêng, chữ tên 3D, câu trong kịch bản (mẫu + AI). Gắn với từng căn (xoá khi làm căn mới).
const ROAD_MAX_PTS = 80;
function myRoadObj(m) {
  const H = state.house;
  let near = 99, len = 0;
  if (H && m.pts.length > 1) {
    const F = localFrame(H);
    for (let i = 1; i < m.pts.length; i++) {
      const A = F.xy(m.pts[i - 1]), B = F.xy(m.pts[i]);
      const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1e-12;
      len += Math.sqrt(L2);
      const k = Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / L2));
      near = Math.min(near, Math.hypot(A[0] + dx * k, A[1] + dy * k));
    }
  }
  return { id: m.id, label: m.label, alt: '', ref: '', name: m.label, level: 1, ways: [m.pts], nearKm: Math.round(near * 1000) / 1000, lenKm: len, manual: true };
}
function updateRoadMsg() {
  const el = $('roadMsg');
  if (!el) return;
  const n = roadDraft ? roadDraft.pts.length : 0;
  let len = 0;
  if (n > 1) for (let i = 1; i < n; i++) len += haversineKm({ lat: roadDraft.pts[i - 1][0], lng: roadDraft.pts[i - 1][1] }, { lat: roadDraft.pts[i][0], lng: roadDraft.pts[i][1] });
  el.textContent = n === 0 ? 'Chạm vào đầu con đường, rồi chạm dọc theo đường tới cuối. Chỗ cua chạm dày hơn.'
    : n === 1 ? 'Chạm tiếp điểm thứ 2 dọc theo đường.'
    : `${n} điểm · dài khoảng ${formatKm(len)}. Chạm tiếp để vẽ thêm, xong thì đặt tên đường.`;
}
function startRoadDraw(id = null) {
  if (!state.house) { toast('Dán toạ độ căn nhà trước.'); return; }
  const m = id && (state.myRoads || []).find(x => x.id === id);
  toggleEdit(true, 'road');
  roadDraft = m ? { id: m.id, label: m.label, pts: m.pts.map(p => [...p]) } : { id: null, label: '', pts: [] };
  $('roadName').value = roadDraft.label;
  if (m) { // mở đúng chỗ con đường đang sửa
    const mid = m.pts[Math.floor(m.pts.length / 2)];
    editCenter = { lat: mid[0], lng: mid[1] };
  }
  updateRoadMsg();
  dirty = true;
  document.querySelector('.stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function finishRoadDraw() {
  if (!roadDraft) { toggleEdit(false); return; }
  if (roadDraft.pts.length < 2) { toast('Chạm ít nhất 2 điểm dọc theo con đường.'); return; }
  const label = $('roadName').value.trim().replace(/\s+/g, ' ');
  if (!label) { toast('Đặt tên cho con đường (vd. Hẻm 12 Đoàn Nguyễn Tuấn).'); $('roadName').focus(); return; }
  const list = [...(state.myRoads || [])];
  const id = roadDraft.id || 'my' + Date.now().toString(36);
  const item = { id, label: label.slice(0, 40), pts: roadDraft.pts };
  const i = list.findIndex(x => x.id === id);
  if (i >= 0) list[i] = item; else list.push(item);
  state.myRoads = list;
  if (!state.selectedRoads.includes(id)) state.selectedRoads = [...state.selectedRoads, id];
  roadDraft = null;
  toggleEdit(false);
  renderLists();
  scheduleRebuild();
  save();
  toast(`Đã thêm đường "${item.label}" vào video và kịch bản.`, 3000);
}
function removeMyRoad(id) {
  state.myRoads = (state.myRoads || []).filter(x => x.id !== id);
  state.selectedRoads = state.selectedRoads.filter(x => x !== id);
  state.roadStars = (state.roadStars || []).filter(x => x !== id);
  renderLists();
  scheduleRebuild();
  save();
}

// ---------- Thêm tiện ích bằng cách chạm trên bản đồ (app chưa quét được) ----------
// Khách chạm vào chỗ có tiện ích trên ảnh vệ tinh → app gợi ý tên các địa điểm quanh chỗ chạm: điểm app đã quét nhưng chưa chọn
// (trong 250 m) + mọi địa điểm có tên trong 300 m từ ô bản đồ OSM + Overture (placesNear, data.js; ít quá thì hỏi thêm Vietmap).
// Khách tick → thêm vào video + kịch bản như tiện ích quét được.
// Không có tên nào đúng thì tự đặt tên tại chỗ chạm. Tiện ích thêm tay là `manual` (gắn với căn, xoá khi làm căn mới).
function poiMarks() {
  const sel = new Set(state.selected);
  const out = state.pois.filter(p => sel.has(p.id)).map(p => ({ lat: p.lat, lng: p.lng, label: p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name, sel: true }));
  for (const c of poiCands) if (!(c.poiId && sel.has(c.poiId))) out.push({ lat: c.lat, lng: c.lng });
  if (poiTap) out.push({ ...poiTap, tap: true });
  return out;
}
function startPoiPick() {
  if (!state.house) { toast('Dán toạ độ căn nhà trước.'); return; }
  toggleEdit(true, 'poi');
  updatePoiMsg('Chạm vào chỗ có tiện ích trên ảnh vệ tinh (kéo để di chuyển, −/+ để phóng). App sẽ gợi ý tên quanh chỗ chạm.');
  dirty = true;
  document.querySelector('.stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function updatePoiMsg(t, cls = 'hint') { const el = $('poiMsg'); if (el) { el.textContent = t; el.className = cls; } }
async function findPoisAt(ll) {
  poiTap = { lat: ll.lat, lng: ll.lng };
  dirty = true;
  const my = ++poiReq;
  const near = (p, km) => haversineKm(p, poiTap) <= km;
  const sel = new Set(state.selected);
  // 1) điểm app đã quét quanh chỗ chạm (chưa chọn trước, đã chọn sau)
  const local = state.pois.filter(p => near(p, 0.25)).sort((a, b) => haversineKm(a, poiTap) - haversineKm(b, poiTap)).slice(0, 6)
    .map(p => ({ name: p.name, lat: p.lat, lng: p.lng, km: p.km ?? haversineKm(state.house, p), cat: p.cat, poiId: p.id, src: 'app', on: sel.has(p.id) }));
  poiCands = local;
  renderPoiCands();
  updatePoiMsg('Đang tìm tên địa điểm quanh chỗ chạm…');
  let remote = [];
  try { remote = await placesNear(poiTap, 0.3); } catch { /* bỏ qua */ }
  if (my !== poiReq) return; // khách đã chạm chỗ khác
  const norm = s => String(s).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const have = new Set(local.map(x => norm(x.name)));
  for (const x of remote) {
    if (have.has(norm(x.name))) continue;
    have.add(norm(x.name));
    poiCands.push({ name: x.name, lat: x.lat, lng: x.lng, km: haversineKm(state.house, x), cat: x.cat && CATEGORIES[x.cat] ? x.cat : guessCategory({ name: x.name }), src: x.src, where: x.where || '' });
  }
  poiCands.sort((a, b) => haversineKm(a, poiTap) - haversineKm(b, poiTap));
  poiCands = poiCands.slice(0, 10);
  renderPoiCands();
  updatePoiMsg(poiCands.length ? 'Tick tiện ích muốn đưa vào video rồi bấm "Thêm vào video". Không có tên đúng thì tự đặt tên ở dòng cuối.'
    : 'Không tìm thấy tên địa điểm ở đây. Tự đặt tên cho chỗ vừa chạm ở ô bên dưới, hoặc chạm chỗ khác.');
  dirty = true;
}
const catOptions = cur => Object.entries(CATEGORIES).sort((a, b) => a[1].order - b[1].order).map(([k, c]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
function renderPoiCands() {
  const box = $('poiPickList');
  if (!box) return;
  if (!poiTap) { box.innerHTML = ''; return; }
  box.innerHTML = poiCands.map((c, i) => `
    <label class="pick-row${c.on ? ' on' : ''}">
      <input type="checkbox" data-pick="${i}" ${c.on ? 'checked disabled' : ''}>
      <span class="pick-name">${esc(c.name)}${c.on ? ' <small>· đã có trong video</small>' : ''}${c.where ? `<small class="pick-where">${esc(c.where)}</small>` : ''}</span>
      <span class="pick-km">${formatKm(c.km, true)}</span>
      <select class="input pick-cat" data-pick-cat="${i}" aria-label="Nhóm tiện ích"${c.on ? ' disabled' : ''}>${catOptions(c.cat)}</select>
    </label>`).join('') + `
    <div class="pick-row pick-own">
      <input type="checkbox" id="poiOwnOn" aria-label="Tự đặt tên tại chỗ vừa chạm">
      <input id="poiOwnName" class="input" type="text" maxlength="60" placeholder="Tự đặt tên tại chỗ vừa chạm (vd. Chợ đêm Bình Lợi)" autocomplete="off">
      <select class="input pick-cat" id="poiOwnCat" aria-label="Nhóm tiện ích">${catOptions('congcong' in CATEGORIES ? 'congcong' : Object.keys(CATEGORIES)[0])}</select>
    </div>`;
}
function addPickedPois() {
  if (!poiTap) { toast('Chạm vào chỗ có tiện ích trên bản đồ trước.'); return; }
  const box = $('poiPickList');
  const picks = [...box.querySelectorAll('input[data-pick]:checked:not(:disabled)')].map(el => {
    const c = poiCands[+el.dataset.pick];
    return { ...c, cat: box.querySelector(`[data-pick-cat="${el.dataset.pick}"]`)?.value || c.cat };
  });
  const ownName = $('poiOwnName')?.value.trim();
  if (ownName && ($('poiOwnOn')?.checked || !picks.length)) picks.push({ name: ownName, lat: poiTap.lat, lng: poiTap.lng, km: haversineKm(state.house, poiTap), cat: $('poiOwnCat').value, src: 'own' });
  if (!picks.length) { toast('Tick ít nhất 1 tiện ích, hoặc tự đặt tên cho chỗ vừa chạm.'); return; }
  let added = 0, full = false;
  for (const c of picks) {
    if (state.selected.length >= MAX_POIS) { full = true; break; }
    let id = c.poiId;
    if (id) { const p = state.pois.find(x => x.id === id); if (p) p.cat = c.cat; }
    else {
      id = 'm' + Date.now().toString(36) + added;
      state.pois.push({ id, name: c.name, cat: c.cat, kind: 'manual', lat: c.lat, lng: c.lng, km: haversineKm(state.house, c), manual: true });
    }
    if (!state.selected.includes(id)) state.selected.push(id);
    added++;
  }
  renderLists();
  queueRoutes();
  scheduleRebuild();
  save();
  poiCands = poiCands.map(c => ({ ...c, on: c.on || picks.some(p => p.name === c.name) }));
  renderPoiCands();
  dirty = true;
  if (full) toast(`Video tối đa ${MAX_POIS} tiện ích. Bỏ chọn bớt tiện ích khác ở danh sách để thêm.`, 3500);
  else toast(`Đã thêm ${added} tiện ích vào video và kịch bản. Chạm chỗ khác để thêm tiếp, hoặc bấm Xong.`, 3000);
}

// ---------- Mặt bằng phân lô (đất nền) dán dẹt lên bản đồ ----------
// Khách tải ảnh mặt bằng (JPG/PNG/chụp màn hình) → hộp "Chỉnh ảnh mặt bằng" (cắt & nắn 4 góc, khoanh vùng dự án,
// làm trong phần nền trắng — js/planimg.js, xử lý trên máy) → app đặt tạm quanh lô/căn nhà → khách KÉO ảnh để dời,
// kéo chấm góc để xoay/phóng (điện thoại: 2 ngón), hoặc khớp bằng 2 điểm ghim cho chính xác.
// Ảnh lưu trên máy khách (IndexedDB 'vitri-photos': 'planraw:' = ảnh gốc đã thu nhỏ, 'plan:' = ảnh đã xử lý), không tải lên máy chủ.
// Video: dán dẹt xuống mặt đất CHỈ trong cảnh bay sát lô (render.js, Giang chốt 26/10), ranh lô đang bán sáng nổi phía trên.
const PLAN_MAX = 2400;
const planKey = () => (photoKey(state.house) ? 'plan:' + photoKey(state.house) : '');
const planRawKey = () => (photoKey(state.house) ? 'planraw:' + photoKey(state.house) : '');
function planFrame() { return state.plan ? localFrame({ lat: state.plan.lat, lng: state.plan.lng }) : null; }
function planToLL(x, y) { // điểm ảnh (x sang phải, y xuống dưới) → [lat, lng]
  const P = state.plan, F = planFrame();
  const mx = (x - P.w / 2) * P.mpp, my = -(y - P.h / 2) * P.mpp;
  const c = Math.cos(P.rot), s = Math.sin(P.rot);
  return F.ll((mx * c - my * s) / 1000, (mx * s + my * c) / 1000);
}
function llToPlan(ll) { // [lat,lng]/{lat,lng} → điểm ảnh {x, y}
  const P = state.plan, F = planFrame();
  const q = Array.isArray(ll) ? ll : [ll.lat, ll.lng];
  const [e, n] = F.xy(q).map(v => v * 1000);
  const c = Math.cos(-P.rot), s = Math.sin(-P.rot);
  const mx = e * c - n * s, my = e * s + n * c;
  return { x: mx / P.mpp + P.w / 2, y: -my / P.mpp + P.h / 2 };
}
function planScene(op = null, force = false, handles = false) {
  const P = state.plan, img = media.planImg;
  if (!P || !img || (state.planOn === false && !force)) return null;
  return { img, tl: planToLL(0, 0), tr: planToLL(P.w, 0), bl: planToLL(0, P.h), op: op ?? P.op ?? 1, handles };
}
const planEditOp = () => Math.max(0.5, (state.plan?.op ?? 1) * 0.85);
function planMarks() {
  const out = [];
  if (planPick) for (const [i, p] of planPick.pts.entries()) if (p.lat != null) out.push({ lat: p.lat, lng: p.lng, label: String(i + 1), tap: true });
  for (const p of (state.lot || [])) out.push({ lat: p.lat, lng: p.lng });
  return out;
}
function updatePlanMsg(t) {
  const el = $('planMsg');
  if (!el) return;
  if (t) { el.textContent = t; return; }
  const step = planPick?.step;
  el.textContent = step === 'map1' ? 'Chạm ĐÚNG chỗ của điểm ① trên bản đồ (gần góc lô sẽ tự bắt vào góc lô).'
    : step === 'map2' ? 'Chạm ĐÚNG chỗ của điểm ② trên bản đồ.'
    : state.plan ? 'Kéo trong ảnh để dời mặt bằng · kéo chấm vàng ở góc để xoay & phóng (điện thoại: dùng 2 ngón) · kéo ngoài ảnh để di chuyển bản đồ. Cần khớp thật chính xác thì bấm "📌 Khớp bằng 2 điểm".'
    : 'Chưa có ảnh mặt bằng.';
}
async function restorePlan() {
  const k = planKey();
  planHouse = photoKey(state.house);
  media.planImg = null; media.planRaw = null;
  if (k && state.plan) {
    const src = await photoDb('get', k);
    if (planHouse !== photoKey(state.house)) return;
    if (src) media.planImg = await loadLogo(src);
  }
  showPlanUi();
  scheduleRebuild();
}
function showPlanUi() {
  const has = !!(state.plan && media.planImg);
  $('planThumbWrap').hidden = !has;
  $('planAddLabel').textContent = has ? 'Đổi ảnh mặt bằng' : '＋ Tải ảnh mặt bằng phân lô';
  if (has) $('planThumb').src = media.planImg.src;
  $('planOn').checked = state.planOn !== false;
  $('lotPlanBtn').textContent = has ? '🗺️ Sửa / xoá mặt bằng phân lô' : '🗺️ Thêm mặt bằng phân lô';
}
async function pickPlanFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast('Chọn ảnh JPG/PNG (PDF thì chụp màn hình trang mặt bằng rồi tải ảnh lên).', 3500); return; }
  if (!state.house) { toast('Dán toạ độ căn nhà trước.'); return; }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadLogo(url);
    if (!img) { toast('Không đọc được ảnh này.'); return; }
    const k = Math.min(1, PLAN_MAX / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // ảnh PNG nền trong suốt → nền trắng
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    const raw = await loadLogo(c.toDataURL('image/jpeg', 0.92));
    if (!raw) return;
    openPlanEditor({ raw, isNew: true });
  } finally { URL.revokeObjectURL(url); }
}
const metersPerPixelAt = (lat, z) => 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
function startPlanEdit() {
  if (!state.plan || !media.planImg) { $('planFile').click(); return; }
  toggleEdit(true, 'plan');
  editCenter = { lat: state.plan.lat, lng: state.plan.lng };
  $('planOp').value = String(Math.round((state.plan.op ?? 1) * 100));
  updatePlanMsg();
  dirty = true;
  document.querySelector('.stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ----- Hộp "Chỉnh ảnh mặt bằng": ✂️ cắt & nắn 4 góc · ✏️ khoanh vùng dự án · làm trong nền trắng -----
let pe = null; // { raw, isNew, tab, quad, mask, white, prev, prevKey, drag, applied, view }
async function ensurePlanRaw() {
  if (media.planRaw) return media.planRaw;
  const src = await photoDb('get', planRawKey());
  media.planRaw = src ? await loadLogo(src) : null;
  return media.planRaw || media.planImg; // mặt bằng tải trước bản này chỉ có ảnh đã xử lý → dùng làm ảnh gốc
}
async function openPlanEditor({ raw = null, isNew = false } = {}) {
  raw = raw || await ensurePlanRaw();
  if (!raw) { $('planFile').click(); return; }
  const ed = (!isNew && state.plan?.edit) || {};
  pe = { raw, isNew, tab: 'crop', quad: (ed.quad || FULL_QUAD).map(p => [...p]), mask: ed.mask ? ed.mask.map(p => [...p]) : [], white: ed.white ?? true, prev: null, prevKey: '', drag: null, applied: false };
  $('planWhite').checked = pe.white;
  if (!$('planEditDlg').open) $('planEditDlg').showModal();
  setPeTab('crop');
}
function setPeTab(tab) {
  pe.tab = tab;
  document.querySelectorAll('#planEditTabs [data-pe]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pe === tab)));
  $('planMaskTools').hidden = tab !== 'mask';
  $('planCropReset').hidden = tab !== 'crop';
  $('planEditHint').textContent = tab === 'crop'
    ? 'Kéo 4 chấm vàng về đúng 4 góc khu dự án trên ảnh. Phần ngoài khung bị cắt bỏ; ảnh chụp xiên sẽ được nắn thẳng lại.'
    : 'Ảnh sau khi cắt (ô caro = phần trong suốt, sẽ thấy ảnh vệ tinh). Muốn bỏ khung tên, chú thích, dự án bên cạnh: chạm lần lượt quanh ranh dự án (kéo chấm để sửa). Không chạm gì = giữ cả ảnh.';
  if (tab === 'mask') refreshPePreview();
  drawPe();
}
function refreshPePreview() {
  const key = JSON.stringify([pe.quad, pe.white]);
  if (pe.prev && pe.prevKey === key) return;
  pe.prev = processPlan(pe.raw, { quad: pe.quad, white: pe.white }, 1100);
  pe.prevKey = key;
}
function peView() {
  const cv = $('planEditCv'), box = cv.parentElement;
  const img = pe.tab === 'crop' ? pe.raw : pe.prev;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const pad = 16;
  const availW = Math.max(200, box.clientWidth - pad * 2), availH = Math.max(200, Math.min(window.innerHeight * 0.56, 680) - pad * 2);
  const sc = Math.min(availW / iw, availH / ih);
  const w = Math.round(iw * sc), h = Math.round(ih * sc);
  return { img, iw, ih, sc, pad, w, h, W: w + pad * 2, H: h + pad * 2 };
}
const CHECK = (() => { // nền ô caro để thấy phần trong suốt
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d'); g.fillStyle = '#d9dde3'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  return c;
})();
function drawPe() {
  if (!pe) return;
  const cv = $('planEditCv'), V = peView();
  pe.view = V;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(V.W * dpr) || cv.height !== Math.round(V.H * dpr)) { cv.width = Math.round(V.W * dpr); cv.height = Math.round(V.H * dpr); }
  cv.style.width = V.W + 'px'; cv.style.height = V.H + 'px';
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#11151b'; g.fillRect(0, 0, V.W, V.H);
  const P = (u, v) => [V.pad + u * V.w, V.pad + v * V.h];
  if (pe.tab === 'mask') { g.fillStyle = g.createPattern(CHECK, 'repeat'); g.fillRect(V.pad, V.pad, V.w, V.h); }
  g.imageSmoothingQuality = 'high';
  g.drawImage(V.img, V.pad, V.pad, V.w, V.h);
  const pts = pe.tab === 'crop' ? pe.quad : pe.mask;
  if (pts.length >= 3) { // làm tối phần bị bỏ
    g.save(); g.beginPath(); g.rect(0, 0, V.W, V.H);
    pts.forEach(([u, v], i) => { const [x, y] = P(u, v); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.fillStyle = 'rgba(0,0,0,0.58)'; g.fill('evenodd'); g.restore();
  }
  if (pts.length) {
    g.save();
    g.beginPath(); pts.forEach(([u, v], i) => { const [x, y] = P(u, v); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    if (pts.length >= 3) g.closePath();
    g.lineWidth = 2.5; g.strokeStyle = pe.tab === 'crop' ? '#FFB400' : '#22D3EE'; g.stroke();
    pts.forEach(([u, v], i) => {
      const [x, y] = P(u, v);
      g.beginPath(); g.arc(x, y, pe.tab === 'crop' ? 12 : 8, 0, Math.PI * 2);
      g.fillStyle = pe.tab === 'crop' ? '#FFB400' : '#22D3EE'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#111'; g.stroke();
      if (pe.tab === 'crop') { g.fillStyle = '#111'; g.font = '800 12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 0.5); }
    });
    g.restore();
  }
  // Kính lúp khi đang kéo (ngón tay che mất góc trên điện thoại)
  if (pe.drag && pe.drag.moved) {
    const [u, v] = pts[pe.drag.i];
    const [x, y] = P(u, v);
    const R = 56, Z = 3, lx = x < V.W / 2 ? V.W - R - 8 : R + 8, ly = R + 8;
    g.save();
    g.beginPath(); g.arc(lx, ly, R, 0, Math.PI * 2); g.closePath();
    g.fillStyle = '#000'; g.fill(); g.clip();
    const sx = (u * V.iw) - R / (Z * V.sc), sy = (v * V.ih) - R / (Z * V.sc);
    g.drawImage(V.img, sx, sy, (2 * R) / (Z * V.sc), (2 * R) / (Z * V.sc), lx - R, ly - R, 2 * R, 2 * R);
    g.strokeStyle = '#FF3B30'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(lx - 14, ly); g.lineTo(lx + 14, ly); g.moveTo(lx, ly - 14); g.lineTo(lx, ly + 14); g.stroke();
    g.restore();
    g.beginPath(); g.arc(lx, ly, R, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  }
}
function peEventUV(e) {
  const r = $('planEditCv').getBoundingClientRect(), V = pe.view;
  return [Math.min(1, Math.max(0, (e.clientX - r.left - V.pad) / V.w)), Math.min(1, Math.max(0, (e.clientY - r.top - V.pad) / V.h))];
}
function peHit(e) {
  const r = $('planEditCv').getBoundingClientRect(), V = pe.view;
  const pts = pe.tab === 'crop' ? pe.quad : pe.mask;
  let best = -1, bd = 26;
  pts.forEach(([u, v], i) => { const d = Math.hypot(e.clientX - r.left - (V.pad + u * V.w), e.clientY - r.top - (V.pad + v * V.h)); if (d < bd) { bd = d; best = i; } });
  return best;
}
async function applyPlanEdit() {
  if (!pe) return;
  const btn = $('planEditOk');
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Đang xử lý ảnh…';
  await new Promise(r => setTimeout(r, 30));
  try {
    const edit = { quad: pe.quad.map(p => p.map(v => Math.round(v * 1e4) / 1e4)), mask: pe.mask.length >= 3 ? pe.mask.map(p => p.map(v => Math.round(v * 1e4) / 1e4)) : null, white: pe.white };
    const cv = processPlan(pe.raw, edit, PLAN_MAX);
    const src = planNeedsAlpha(edit) ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.92);
    const out = await loadLogo(src);
    if (!out) throw new Error('img');
    if (pe.isNew || !media.planRaw) await photoDb('put', planRawKey(), pe.raw.src);
    media.planRaw = pe.raw;
    await photoDb('put', planKey(), src);
    const old = pe.isNew ? null : state.plan;
    const W = cv.width, H = cv.height;
    if (!old) {
      // Đặt tạm: tâm ở giữa lô (hoặc căn nhà), hướng Bắc lên trên, rộng ~70% khung đang xem
      const lot = state.lot?.length >= 3 ? state.lot : null;
      const ctr = lot ? { lat: lot.reduce((a, p) => a + p.lat, 0) / lot.length, lng: lot.reduce((a, p) => a + p.lng, 0) / lot.length } : state.house;
      const viewM = FORMATS[state.fmt].LW * metersPerPixelAt(ctr.lat, planZoom);
      state.plan = { w: W, h: H, lat: ctr.lat, lng: ctr.lng, mpp: (viewM * 0.7) / W, rot: 0, op: 1, pins: [], edit };
    } else {
      const geo = JSON.stringify(old.edit?.quad || FULL_QUAD) !== JSON.stringify(edit.quad) || old.w !== W || old.h !== H;
      // Đổi khung cắt: giữ tâm, hướng và bề ngang thật (m) → khách chỉ cần kéo/khớp lại nhẹ
      state.plan = { ...old, w: W, h: H, mpp: geo ? (old.w * old.mpp) / W : old.mpp, pins: geo ? [] : old.pins, edit };
      if (geo) toast('Đã cắt/nắn lại ảnh. Kéo ảnh hoặc "Khớp bằng 2 điểm" lại cho khớp bản đồ.', 4200);
    }
    state.planOn = true;
    media.planImg = out;
    planHouse = photoKey(state.house);
    pe.applied = true;
    $('planEditDlg').close();
    save(); showPlanUi(); scheduleRebuild();
    if (!old) {
      startPlanEdit();
      toast('Đã đặt tạm mặt bằng. Kéo ảnh tới đúng chỗ, kéo chấm góc để xoay/phóng, hoặc "📌 Khớp bằng 2 điểm".', 4500);
    } else { dirty = true; updatePlanMsg(); }
  } catch {
    toast('Ảnh quá lớn hoặc máy không xử lý được. Thử ảnh nhỏ hơn hoặc chụp màn hình rõ hơn.', 4000);
  } finally { btn.disabled = false; btn.textContent = label; }
}
function initPlanEditor() {
  const cv = $('planEditCv');
  document.querySelectorAll('#planEditTabs [data-pe]').forEach(b => b.addEventListener('click', () => setPeTab(b.dataset.pe)));
  $('planWhite').addEventListener('change', e => { pe.white = e.target.checked; if (pe.tab === 'mask') refreshPePreview(); drawPe(); });
  $('planCropReset').addEventListener('click', () => { pe.quad = FULL_QUAD.map(p => [...p]); drawPe(); });
  $('planMaskUndo').addEventListener('click', () => { pe.mask.pop(); drawPe(); });
  $('planMaskClear').addEventListener('click', () => { pe.mask = []; drawPe(); });
  $('planEditCancel').addEventListener('click', () => $('planEditDlg').close());
  $('planEditOk').addEventListener('click', applyPlanEdit);
  $('planEditDlg').addEventListener('close', () => { pe = null; });
  window.addEventListener('resize', () => { if (pe) drawPe(); });
  cv.addEventListener('pointerdown', e => {
    if (!pe) return;
    e.preventDefault();
    const i = peHit(e);
    pe.drag = { i, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    try { cv.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
  });
  cv.addEventListener('pointermove', e => {
    const d = pe?.drag;
    if (!d || d.id !== e.pointerId || d.i < 0) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
    d.moved = true;
    (pe.tab === 'crop' ? pe.quad : pe.mask)[d.i] = peEventUV(e);
    drawPe();
  });
  const end = e => {
    const d = pe?.drag;
    if (!d || d.id !== e.pointerId) return;
    pe.drag = null;
    if (pe.tab === 'mask' && d.i < 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) {
      if (pe.mask.length >= 40) { toast('Tối đa 40 điểm.'); return; }
      pe.mask.push(peEventUV(e));
    }
    drawPe();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}
// Bước chọn điểm trên ẢNH: hộp thoại hiện ảnh mặt bằng, khách chạm 1 điểm
function openPlanDlg() {
  const dlg = $('planDlg');
  const n = planPick.step === 'img1' ? 1 : 2;
  $('planDlgTitle').textContent = `Chạm điểm ${n === 1 ? '①' : '②'} trên ảnh mặt bằng`;
  if ($('planDlgImg').getAttribute('src') !== media.planImg.src) $('planDlgImg').src = media.planImg.src;
  drawPlanDlgMarks();
  if (!dlg.open) dlg.showModal();
}
function drawPlanDlgMarks() {
  const box = $('planDlgMarks');
  box.innerHTML = (planPick?.pts || []).map((p, i) => `<span class="plan-mk" style="left:${(p.x / state.plan.w) * 100}%;top:${(p.y / state.plan.h) * 100}%">${i + 1}</span>`).join('');
}
function planImgTap(e) {
  if (!planPick || !/^img/.test(planPick.step)) return;
  const r = $('planDlgImg').getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * state.plan.w, y = ((e.clientY - r.top) / r.height) * state.plan.h;
  if (x < 0 || y < 0 || x > state.plan.w || y > state.plan.h) return;
  planPick.pts.push({ x, y });
  drawPlanDlgMarks();
  planPick.step = planPick.step === 'img1' ? 'map1' : 'map2';
  setTimeout(() => {
    $('planDlg').close();
    if (!planPick) return;
    // Đưa khung bản đồ về chỗ dự đoán theo vị trí ảnh hiện tại để khách dễ tìm
    const g = planToLL(x, y); editCenter = { lat: g[0], lng: g[1] };
    updatePlanMsg(); dirty = true;
  }, 250);
}
function planMapTap(ll) {
  // Gần góc lô (≤ 18 điểm ảnh trên khung) → bắt vào đúng góc lô
  const snapM = 18 * metersPerPixelAt(ll.lat, planZoom);
  let best = null;
  for (const p of (state.lot || [])) { const d = haversineKm(p, ll) * 1000; if (d <= snapM && (!best || d < best.d)) best = { d, p }; }
  const at = best ? best.p : ll;
  const cur = planPick.pts[planPick.pts.length - 1];
  cur.lat = at.lat; cur.lng = at.lng;
  if (planPick.step === 'map1') { planPick.step = 'img2'; dirty = true; openPlanDlg(); return; }
  // Đủ 2 cặp điểm → tính phép đồng dạng: w = s·z + t (số phức), z = điểm ảnh (x, −y), w = mét (Đông, Bắc)
  const [A, B] = planPick.pts;
  const F = localFrame({ lat: A.lat, lng: A.lng });
  const wA = F.xy([A.lat, A.lng]).map(v => v * 1000), wB = F.xy([B.lat, B.lng]).map(v => v * 1000);
  const zA = [A.x, -A.y], zB = [B.x, -B.y];
  const dz = [zB[0] - zA[0], zB[1] - zA[1]], dw = [wB[0] - wA[0], wB[1] - wA[1]];
  const dz2 = dz[0] * dz[0] + dz[1] * dz[1];
  if (Math.sqrt(dz2) < 15 || Math.hypot(dw[0], dw[1]) < 2) { toast('2 điểm quá gần nhau. Chọn 2 điểm cách xa nhau (vd. 2 góc đối diện của lô hoặc 2 đầu dự án).', 4000); planPick = { step: 'img1', pts: [] }; openPlanDlg(); return; }
  const sr = (dw[0] * dz[0] + dw[1] * dz[1]) / dz2, si = (dw[1] * dz[0] - dw[0] * dz[1]) / dz2; // s = dw / dz
  const P = state.plan;
  const zc = [P.w / 2, -P.h / 2];
  const wc = [wA[0] + sr * (zc[0] - zA[0]) - si * (zc[1] - zA[1]), wA[1] + si * (zc[0] - zA[0]) + sr * (zc[1] - zA[1])];
  const c = F.ll(wc[0] / 1000, wc[1] / 1000);
  state.plan = { ...P, lat: c[0], lng: c[1], mpp: Math.hypot(sr, si), rot: Math.atan2(si, sr), pins: planPick.pts.map(p => ({ ...p })) };
  planPick = null;
  save(); scheduleRebuild(); dirty = true;
  updatePlanMsg('Đã khớp mặt bằng theo 2 điểm. Kiểm tra trên bản đồ; lệch thì kéo/xoay nhẹ hoặc ghim lại, xong bấm "Xong".');
}
function nudgePlan(dRot, dScale) {
  if (!state.plan) return;
  state.plan = { ...state.plan, rot: state.plan.rot + dRot, mpp: state.plan.mpp * dScale };
  save(); scheduleRebuild(); dirty = true;
}
// Kéo trực tiếp trên bản đồ (chế độ căn mặt bằng): dời / xoay + phóng quanh tâm / 2 ngón
function planGestureStart(kind, pts) {
  const P = state.plan;
  return { kind, P0: { ...P }, F0: localFrame({ lat: P.lat, lng: P.lng }), pts0: pts.map(p => ({ ...p })) };
}
function planGestureMove(G, pts) {
  const { P0, F0 } = G;
  const m = ll => F0.xy([ll.lat, ll.lng]).map(v => v * 1000); // mét quanh tâm cũ
  if (G.kind === 'move') {
    const a = m(G.pts0[0]), b = m(pts[0]);
    const c = F0.ll((b[0] - a[0]) / 1000, (b[1] - a[1]) / 1000);
    state.plan = { ...P0, lat: c[0], lng: c[1], pins: [] };
  } else if (G.kind === 'rot') {
    const a = m(G.pts0[0]), b = m(pts[0]);
    const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
    if (la < 0.5 || lb < 0.5) return;
    state.plan = { ...P0, mpp: P0.mpp * (lb / la), rot: P0.rot + Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]), pins: [] };
  } else if (G.kind === 'pinch') {
    // Phép đồng dạng đưa 2 ngón cũ (A,B) → 2 ngón mới (A',B'), áp vào tâm mặt bằng (đang ở gốc toạ độ)
    const A = m(G.pts0[0]), B = m(G.pts0[1]), A2 = m(pts[0]), B2 = m(pts[1]);
    const dz = [B[0] - A[0], B[1] - A[1]], dw = [B2[0] - A2[0], B2[1] - A2[1]];
    const d2 = dz[0] * dz[0] + dz[1] * dz[1];
    if (d2 < 1) return;
    const sr = (dw[0] * dz[0] + dw[1] * dz[1]) / d2, si = (dw[1] * dz[0] - dw[0] * dz[1]) / d2;
    const cx = A2[0] + sr * (0 - A[0]) - si * (0 - A[1]), cy = A2[1] + si * (0 - A[0]) + sr * (0 - A[1]);
    const c = F0.ll(cx / 1000, cy / 1000);
    state.plan = { ...P0, lat: c[0], lng: c[1], mpp: P0.mpp * Math.hypot(sr, si), rot: P0.rot + Math.atan2(si, sr), pins: [] };
  }
  dirty = true;
}
function planHitAt(ll, rect) {
  // Chấm góc (xoay/phóng) trong 24 px màn hình, hoặc bên trong ảnh (dời)
  const P = state.plan;
  if (!P || !media.planImg) return null;
  const pxM = metersPerPixelAt(ll.lat, planZoom) * FORMATS[state.fmt].LW / rect.width; // mét / px CSS
  const F = localFrame(ll);
  for (const [x, y] of [[0, 0], [P.w, 0], [P.w, P.h], [0, P.h]]) {
    const c = planToLL(x, y);
    const d = F.xy(c).map(v => v * 1000);
    if (Math.hypot(d[0], d[1]) / pxM < 24) return 'rot';
  }
  const q = llToPlan(ll);
  return q.x >= 0 && q.y >= 0 && q.x <= P.w && q.y <= P.h ? 'move' : null;
}
function removePlan() {
  photoDb('del', planKey());
  photoDb('del', planRawKey());
  state.plan = null; media.planImg = null; media.planRaw = null;
  toggleEdit(false);
  save(); showPlanUi(); scheduleRebuild();
}

// ---------- Toạ độ sổ đỏ (VN-2000) → lô đất ----------
// Mở cho mọi khách từ 27/10. Dán toạ độ tính ngay trên máy (không gửi lên máy chủ); chụp ảnh → /api/so-ocr (phải đăng nhập).
let vnRes = null;
let vnOcr = null; // kết quả AI đọc ảnh: { labels, edges, area, unsure }
function vnEnabled() {
  try {
    const q = new URLSearchParams(location.search).get('vn2000');
    if (q === '1') localStorage.setItem('vitri.vn2000', '1');
    if (q === '0') localStorage.removeItem('vitri.vn2000');
    return localStorage.getItem('vitri.vn2000') === '1';
  } catch { return false; }
}
const fmtM = m => (m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m) + ' m');
function vnShow(html, bad) {
  const box = $('vnResult');
  box.hidden = false;
  box.classList.toggle('bad', !!bad);
  box.innerHTML = html;
}
function vnRead() {
  vnRes = null;
  $('vnApply').disabled = true;
  $('vnPin').hidden = true;
  const pr = parseCoordText($('vnText').value);
  if (pr.pts.length < 3) {
    vnShow('Chưa đọc được đủ 3 điểm góc. Mỗi dòng cần có 2 số X và Y (vd. <b>1180081,47&nbsp;&nbsp;591372,13</b>).', true);
    return;
  }
  const chk = checkPolygon(pr.pts);
  const k = $('vnKtt').value;
  if (k === '' && !state.house) { vnShow('Chưa có vị trí căn nhà để tự dò kinh tuyến trục. Chọn <b>kinh tuyến trục</b> ở ô bên dưới (in trên sổ, hoặc theo tỉnh có lô đất), app sẽ đặt căn nhà đúng chỗ lô đất.', true); vnKttHint(); return; }
  const r = convertLot(chk.pts, { lon0: k === '' ? null : Number(k), pin: state.house });
  const lines = [], warn = [];
  let block = chk.issues.length > 0;
  lines.push(`Đọc được <b>${chk.pts.length}</b> điểm góc${pr.swapped ? ' (đã tự đổi lại cột X/Y)' : ''}.`);
  lines.push(`Diện tích tính từ toạ độ: <b>${formatArea(chk.area)}</b>.`);
  const given = areaFromText(state.area);
  if (given > 0 && Math.abs(given - chk.area) / given > 0.05) warn.push(`Khác diện tích anh/chị nhập (${esc(state.area)}) hơn 5% — kiểm tra lại các điểm.`);
  lines.push(`Kinh tuyến trục: <b>${fmtMeridian(r.meridian)}</b>${r.guessed ? ' (tự dò theo ghim)' : ''}${r.k0 === 0.9996 ? ' · bản đồ múi 6°' : ''}.`);
  let move = false; // đặt lại căn nhà tại lô (lô ở chỗ khác ghim hiện tại / chưa có ghim)
  if (r.pinDist == null) {
    move = true;
    lines.push(`Lô đất nằm tại <b>${r.centroid.lat.toFixed(5)}, ${r.centroid.lng.toFixed(5)}</b> — app sẽ đặt căn nhà ở đây.`);
  } else {
    lines.push(`Giữa lô cách ghim căn nhà <b>${fmtM(r.pinDist)}</b>.`);
    if (r.pinDist > 1000) {
      if (r.guessed) {
        block = true;
        warn.push('Lô đất cách ghim hiện tại quá xa nên app không tự dò được kinh tuyến trục. Chọn <b>kinh tuyến trục</b> ở ô bên dưới (in trên sổ, hoặc theo tỉnh có lô đất) — app sẽ đặt căn nhà đúng chỗ lô đất.');
        vnKttHint();
      } else {
        move = true;
        warn.push(`Lô đất cách ghim hiện tại ${fmtM(r.pinDist)} — đây là căn khác: bấm nút bên dưới để <b>đặt căn nhà tại lô này</b> (thông tin căn cũ sẽ để trống).`);
      }
    } else if (r.pinDist > 300) warn.push('Lô đất khá xa ghim: kiểm tra lại ghim căn nhà ở bước 1.');
    else if (r.pinDist > 20) $('vnPin').hidden = false;
  }
  // Ảnh do AI đọc: so với diện tích + độ dài cạnh in trên sổ để bắt chữ số đọc nhầm
  let ocrBad = false;
  if (vnOcr) {
    if (vnOcr.area > 0) {
      const d = Math.abs(vnOcr.area - chk.area) / vnOcr.area;
      if (d <= 0.02) lines.push(`Khớp diện tích in trên sổ (${formatArea(vnOcr.area)}) ✓`);
      else ocrBad = !!warn.push(`<b>Sổ ghi ${formatArea(vnOcr.area)}</b> nhưng toạ độ cho ${formatArea(chk.area)} — có thể AI đọc nhầm một chữ số, so từng dòng với sổ.`);
    }
    if (vnOcr.labels.length === pr.pts.length && vnOcr.edges.length) {
      let okN = 0;
      for (const e of vnOcr.edges) {
        const i = vnOcr.labels.indexOf(e.from), j = vnOcr.labels.indexOf(e.to);
        if (i < 0 || j < 0) continue;
        const dm = Math.hypot(pr.pts[i].x - pr.pts[j].x, pr.pts[i].y - pr.pts[j].y);
        if (Math.abs(dm - e.m) > Math.max(0.2, e.m * 0.01)) ocrBad = !!warn.push(`Cạnh ${esc(e.from)}–${esc(e.to)}: sổ ghi ${e.m.toLocaleString('vi-VN')} m, toạ độ cho ${dm.toFixed(2).replace('.', ',')} m — kiểm tra điểm ${esc(e.from)} hoặc ${esc(e.to)}.`);
        else okN++;
      }
      if (okN) lines.push(`Khớp ${okN} cạnh in trên sổ ✓`);
    }
    if (vnOcr.unsure.length) warn.push(`AI không chắc điểm ${vnOcr.unsure.map(esc).join(', ')} — so kỹ với sổ.`);
  }
  for (const m of chk.issues) warn.push(esc(m));
  if (pr.bad.length) warn.push(`Bỏ qua dòng ${pr.bad.join(', ')} (không thấy toạ độ).`);
  if (pr.odd.length) warn.push(`Dòng ${pr.odd.join(', ')} có số không giống toạ độ VN-2000 — kiểm tra lại.`);
  vnShow(lines.join('<br>') + (warn.length ? `<ul>${warn.map(w => `<li>${w}</li>`).join('')}</ul>` : ''), block || ocrBad);
  $('vnApply').textContent = move ? '📍 Đặt căn nhà tại lô này + dùng làm lô đất' : 'Dùng làm lô đất';
  if (!block) { vnRes = { ...r, area: chk.area, move }; $('vnApply').disabled = false; }
}
// Diện tích khách nhập: "100m2", "1.200 m²", "120,5", "5x20m" → m²
// Điểm nổi bật: mỗi dòng 1 ý, tối đa 5 ý
function highlightLines() {
  const l = String(state.highlights || '').split(/\n|;/).map(x => x.replace(/^[\s•\-–*+]+/, '').trim()).filter(Boolean).slice(0, 5);
  return l.length ? l : null;
}
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
// Giá (đồng) từ chữ khách nhập: "3,2 tỷ", "3 tỷ 200", "1.250 triệu", "850tr", "3.2 ty"
function priceVnd(v) {
  const t = String(v || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ');
  const num = x => parseFloat(String(x).replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  let m = t.match(/(\d+(?:[.,]\d+)?)\s*(tỷ|tỉ|ty)\s*(\d{1,3})?/);
  if (m) return num(m[1]) * 1e9 + (m[3] ? +m[3] * (m[3].length === 1 ? 1e8 : m[3].length === 2 ? 1e7 : 1e6) : 0);
  m = t.match(/(\d+(?:[.,]\d+)*)\s*(triệu|trieu|tr)\b/);
  if (m) return num(m[1]) * 1e6;
  return 0;
}
function pricePerM2() {
  if (isRentType()) return null; // giá thuê theo tháng: chia diện tích không có nghĩa
  const p = priceVnd(state.price), a = areaFromText(state.area);
  if (!p || !(a >= 10 && a <= 100000)) return null;
  const tr = p / a / 1e6;
  if (tr < 0.1 || tr > 2000) return null;
  return 'khoảng ' + (tr >= 10 ? Math.round(tr) : Math.round(tr * 10) / 10).toString().replace('.', ',') + ' triệu một mét vuông';
}
function areaFromText(v) {
  const t = String(v || '').toLowerCase().replace(/\s/g, '');
  const num = x => parseFloat(x.replace(',', '.'));
  const m = t.match(/(\d+(?:[.,]\d+)?)[x×*](\d+(?:[.,]\d+)?)/);
  if (m) return num(m[1]) * num(m[2]);
  const n = t.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/);
  if (!n) return 0;
  return num(/^\d{1,3}(\.\d{3})+/.test(n[0]) ? n[0].replace(/\./g, '') : n[0]);
}
function vnFitZoom(lot) {
  const h = state.house; if (!h || !lot.length) return lotZoom;
  const ext = Math.max(...lot.map(p => haversineKm(h, p) * 1000), 8);
  const { LW, LH } = FORMATS[state.fmt];
  const mpp = (2 * ext) / (0.75 * Math.min(LW, LH));
  const z = Math.log2(156543.03 * Math.cos(h.lat * Math.PI / 180) / mpp);
  return Math.max(16.5, Math.min(20.5, Math.floor(z * 2) / 2));
}
// Kinh tuyến trục bản đồ địa chính theo tỉnh (Thông tư 973/2001/TT-TCĐC, Bảng 4 — tên tỉnh TRƯỚC sáp nhập 2025, sổ cũ in theo tỉnh cũ)
const KTT_PROV = {
  104.5: 'Kiên Giang',
  104.75: 'An Giang, Nghệ An',
  105: 'Hà Nội, Cần Thơ, Thanh Hoá',
  105.5: 'Tây Ninh, Vĩnh Long, Bắc Ninh, Hưng Yên, Hải Dương',
  105.75: 'TP.HCM, Bình Dương, Long An, Tiền Giang, Bến Tre, Hải Phòng',
  106.25: 'Bình Phước',
  107: 'Thừa Thiên Huế',
  107.75: 'Đồng Nai, Bà Rịa–Vũng Tàu, Đà Nẵng, Lâm Đồng, Quảng Ninh',
  108.25: 'Khánh Hoà',
  108.5: 'Đắk Lắk, Bình Thuận',
};
// Gợi ý chọn kinh tuyến trục: cuộn tới + nháy sáng ô chọn
function vnKttHint() {
  const sel = $('vnKtt');
  sel.classList.remove('flash'); void sel.offsetWidth; sel.classList.add('flash');
}
function vnPlaceHouse(c) {
  const text = `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`;
  $('coordInput').value = text;
  state.coordText = text;
  setHouse({ lat: +c.lat.toFixed(7), lng: +c.lng.toFixed(7) }, { fresh: true });
}
function vnApply() {
  if (!vnRes) return;
  if (vnRes.move) {
    vnPlaceHouse(vnRes.centroid);
  }
  state.lot = vnRes.lot.map(p => ({ lat: +p.lat.toFixed(7), lng: +p.lng.toFixed(7) }));
  state.lotSrc = 'so';
  lotZoom = vnFitZoom(state.lot);
  dirty = true;
  updateLotMsg();
  save();
  scheduleRebuild();
  $('vnDlg').close();
  toast(vnRes.move
    ? `Đã đặt căn nhà + lô đất ${state.lot.length} góc · ${formatArea(vnRes.area)} theo toạ độ sổ. Bấm "Quét tiện ích" để tìm tiện ích quanh căn này.`
    : `Đã dùng lô đất ${state.lot.length} góc · ${formatArea(vnRes.area)} từ toạ độ sổ đỏ.`, 5000);
}
// "KTT 105°45'" / "105 độ 45 phút" → 105.75 (chỉ nhận nếu có trong danh sách)
function kttFromText(t) {
  const m = String(t || '').match(/(1[01]\d)\s*(?:°|º|độ|o)\s*(?:(\d{1,2})\s*(?:'|′|’|phút))?/i);
  if (!m) return null;
  const v = Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  return MERIDIANS.find(x => Math.abs(x - v) < 1e-6) ?? null;
}
// Ảnh chụp → JPEG cạnh dài tối đa 2000 px (đủ nét cho chữ số, gửi nhanh)
async function shrinkScan(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadLogo(url);
    if (!img) return null;
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } finally { URL.revokeObjectURL(url); }
}
async function vnSnap(file) {
  const msg = $('vnSnapMsg'), btn = $('vnSnap');
  const say = t => { msg.textContent = t; };
  if (!account.profile && !(await requireLogin('Đăng nhập để AI đọc ảnh sơ đồ thửa.'))) return;
  btn.disabled = true;
  try {
    say('Đang chuẩn bị ảnh…');
    const image = await shrinkScan(file);
    if (!image) { say('Không mở được ảnh này, thử chụp lại hoặc chọn ảnh JPG/PNG.'); return; }
    say('AI đang đọc bảng toạ độ… (khoảng 10–30 giây)');
    const res = await fetch('/api/so-ocr', {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ image, lat: state.house?.lat, lng: state.house?.lng }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (await handleAiError(res.status, j)) { say(j.error || ''); return; }
      throw new Error(j.error || 'HTTP ' + res.status);
    }
    if (!j.points?.length) {
      say('Không thấy bảng toạ độ trong ảnh' + (j.note ? ` (${j.note})` : '') + '. Chụp thẳng, rõ, sát bảng toạ độ rồi thử lại — hoặc chép tay bên dưới.');
      return;
    }
    // Bảng sổ thường in lặp điểm đầu ở dòng cuối → bỏ cho gọn
    const P0 = j.points[0], PN = j.points[j.points.length - 1];
    if (j.points.length > 3 && P0.x === PN.x && P0.y === PN.y) j.points.pop();
    const vn = s => String(s).replace('.', ',');
    $('vnText').value = j.points.map(p => `${p.n}   ${vn(p.x)}   ${vn(p.y)}`).join('\n');
    const k = kttFromText(j.ktt);
    if (k != null) $('vnKtt').value = String(k);
    vnOcr = { labels: j.points.map(p => p.n), edges: j.edges || [], area: j.area || 0, unsure: j.unsure || [] };
    say(`AI đã điền ${j.points.length} điểm${k != null ? ' + kinh tuyến trục' : ''}. So lại từng số với sổ rồi bấm "Dùng làm lô đất".`);
    vnRead();
  } catch (e) {
    say('AI chưa đọc được ảnh (' + e.message + '). Thử lại, hoặc chép tay bảng toạ độ bên dưới.');
  } finally { btn.disabled = false; }
}
// 27/10 (Giang): mở cho MỌI khách. ?vn2000=0 ẩn trên 1 máy (khi cần thử giao diện không có mục này)
const vnVisible = () => { try { if (new URLSearchParams(location.search).get('vn2000') === '0') return false; } catch { /* bỏ qua */ } return true; };
function syncVnEntry() {
  const on = vnVisible();
  $('vnOpen').hidden = !on;
  // 28/10: khách MỚI (chưa đăng nhập, chưa quét căn của mình) chỉ thấy ô toạ độ + nút Quét — ô sổ đỏ chen giữa làm nút
  // Quét bị đẩy xuống trên điện thoại. Vẫn vào được sổ đỏ từ thanh Vẽ lô đất (#vnOpen).
  const own = !!(state.scannedAt && !state.sample);
  $('vnEntry').hidden = !on || !(own || account.profile);
}
let lastMotion = null;
function initVn2000() {
  syncVnEntry();
  onAccountChange(syncVnEntry);
  // tài khoản nội bộ đăng nhập xong → dựng lại để thấy chữ động
  onAccountChange(() => { const m = sceneMotion(); if (m !== lastMotion) { lastMotion = m; if (tl) rebuild(); } });
  $('vnEntry').addEventListener('click', () => $('vnDlg').showModal());
  $('vnSnap').addEventListener('click', () => $('vnPhoto').click());
  $('vnPhoto').addEventListener('change', e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) vnSnap(f); });
  const sel = $('vnKtt');
  for (const m of MERIDIANS) sel.insertAdjacentHTML('beforeend', `<option value="${m}">${fmtMeridian(m)}${KTT_PROV[m] ? ' — ' + KTT_PROV[m] : ''}</option>`);
  $('vnOpen').addEventListener('click', () => $('vnDlg').showModal());
  $('vnRead').addEventListener('click', vnRead);
  $('vnText').addEventListener('input', () => { vnRes = null; $('vnApply').disabled = true; $('vnPin').hidden = true; });
  $('vnKtt').addEventListener('change', () => { if ($('vnText').value.trim()) vnRead(); });
  $('vnApply').addEventListener('click', vnApply);
  $('vnPin').addEventListener('click', () => {
    if (!vnRes) return;
    setHouse({ lat: vnRes.centroid.lat, lng: vnRes.centroid.lng });
    $('vnPin').hidden = true;
    toast('Đã đưa ghim căn nhà về giữa lô đất.');
    vnRead();
  });
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
      setHouse({ lat: r.lat, lng: r.lng }, { fresh: true });
      state.coordText = t;
      state.coordSet = true;
      $('coordInput').value = t;
      funnel('toado');
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
  setHouse({ lat: r.lat, lng: r.lng }, { fresh: !silent });
  state.coordText = text;
  if (!silent) { state.coordSet = true; funnel('toado'); }
  msg.textContent = `Đã đọc: ${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`;
  msg.className = 'hint ok';
  return true;
}

function resetHouseScoped() {
  if (state.fxPending) { // xem load(): căn cũ có giọng thì bật hiệu ứng mặc định mới khi sang căn mới
    state.fxPending = false; state.showAdminArea = true; state.showSweep = true;
    { const a = $('adminAreaOn'), b = $('sweepOn'); if (a) a.checked = true; if (b) b.checked = true; }
  }
  Object.assign(state, { areaWard: '', areaProv: '', areaFor: '', roadWidth: '', sub: '', lotText: '', lotArea: '',
    scriptEdits: {}, scriptAi: false, scriptOwn: false, voSig: '', adminArea: null, admin: null, roadStars: [], roadFills: {}, iso: null, isoFor: '', region: null, regionFor: '', regionOff: [] });
  media.voiceSegs.clear();
  media.voiceCache.clear();
  media.mixKey = '';
  for (const [id, v] of [['areaWardInput', ''], ['areaProvInput', ''], ['roadWidthInput', ''], ['subInput', ''], ['lotText', ''], ['lotArea', '']]) { const el = $(id); if (el) el.value = v; }
  updateAreaPlaceholders();
  renderScript();
  save();
}
// Thông tin GẮN VỚI TỪNG BẤT ĐỘNG SẢN (khách nhập): làm căn mới thì để trống hết cho khách tự nhập lại.
// Giữ lại thông tin của môi giới (tên, SĐT, logo), loại BĐS đang chọn và các lựa chọn phong cách/nhạc/giọng.
const HOUSE_INFO = [['price', 'priceInput'], ['area', 'areaInput'], ['thoCu', 'thoCuInput'], ['floors', 'floorsInput'], ['beds', 'bedsInput'],
  ['legal', 'legalInput'], ['roadWidth', 'roadWidthInput'], ['sub', 'subInput'], ['lotText', 'lotText'], ['lotArea', 'lotArea'],
  ['pageVideo', 'pageVideo'], ['pageDesc', 'pageDesc'], ['areaWard', 'areaWardInput'], ['areaProv', 'areaProvInput'],
  ['highlights', 'highlightsInput'], ['buyer', 'buyerInput']];
// Nhớ thông tin căn vừa bị để trống: khách lỡ sửa toạ độ rồi dán lại đúng căn cũ (lệch < 30 m) thì tự điền lại
const houseMemo = [];
function resetHouseInfo(prev) {
  const has = HOUSE_INFO.some(([k]) => state[k]) || state.lot?.length || state.stars?.length || state.myRoads?.length;
  if (has && prev) {
    houseMemo.unshift({ house: prev, lot: state.lot || [], lotSrc: state.lotSrc || '', stars: state.stars || [], myRoads: state.myRoads || [], plan: state.plan || null, areaFor: state.areaFor || '', title: state.title, info: Object.fromEntries(HOUSE_INFO.map(([k]) => [k, state[k] || ''])) });
    houseMemo.length = Math.min(houseMemo.length, 5);
  }
  for (const [k, id] of HOUSE_INFO) { state[k] = ''; const el = $(id); if (el) el.value = ''; }
  // 27/10 (khách: lô đất mà tiêu đề vẫn "Nhà 4 tầng…" của căn trước): tiêu đề gõ tay gắn với từng căn → căn mới về mặc định
  state.title = DEFAULT_TITLE; if ($('titleInput')) $('titleInput').value = DEFAULT_TITLE;
  state.lot = [];
  state.lotSrc = '';
  state.stars = [];
  state.myRoads = [];
  state.plan = null;
  state.pois = state.pois.filter(p => !p.manual);
  state.selected = state.selected.filter(id => state.pois.some(p => p.id === id));
  updateAreaPlaceholders();
  return has;
}
function restoreHouseInfo(h) {
  const i = houseMemo.findIndex(x => haversineKm(x.house, h) <= 0.03);
  if (i < 0 || HOUSE_INFO.some(([k]) => state[k])) return false;
  const [m] = houseMemo.splice(i, 1);
  for (const [k, id] of HOUSE_INFO) { state[k] = m.info[k] || ''; const el = $(id); if (el) el.value = state[k]; }
  state.lot = m.lot; state.lotSrc = m.lotSrc || ''; state.stars = m.stars; state.areaFor = m.areaFor;
  if (m.title != null) { state.title = m.title; if ($('titleInput')) $('titleInput').value = m.title; }
  state.myRoads = m.myRoads || [];
  state.plan = m.plan || null;
  if (state.myRoads.length) state.selectedRoads = [...new Set([...state.selectedRoads, ...state.myRoads.map(x => x.id)])];
  updateAreaPlaceholders();
  toast('Đã điền lại thông tin của căn này.', 2500);
  return true;
}
// Nút "Làm căn mới": để trống mọi thông tin của căn đang làm, xoá ô toạ độ, đưa khách về bước 1 để dán toạ độ căn mới.
// (Danh sách tiện ích cũ vẫn để đó tới khi khách dán toạ độ căn mới — lúc ấy app tự xoá và quét lại.)
function startNewHouse() {
  leaveSample();
  resetHouseInfo(state.house);
  resetHouseScoped();
  state.cloudId = null; state.projName = '';
  state.coordSet = false;
  $('coordInput').value = '';
  $('coordMsg').textContent = 'Dán toạ độ hoặc link Google Maps của căn mới. Xã/phường, tỉnh/thành sẽ tự điền khi quét.';
  $('coordMsg').className = 'hint';
  $('resultBox').hidden = true;
  { const lp = $('lookPick'); if (lp) lp.hidden = true; }
  renderLists();
  scheduleRebuild();
  save();
  showStep(1);
  setTimeout(() => $('coordInput').focus(), 350);
  toast('Đã để trống thông tin. Dán toạ độ căn mới để bắt đầu.', 3500);
}
function updateNewHouseBtn() {
  const b = $('newHouseBtn');
  if (b) b.hidden = !(state.scannedAt && state.coordSet && !state.sample);
}
// fresh = khách dán/nhập toạ độ hoặc link mới (không phải dời ghim để chỉnh lại vị trí)
function setHouse(h, { fresh = false } = {}) {
  const prev = state.house;
  state.house = h;
  setAccountLocation(h);
  const moved = prev ? haversineKm(prev, h) : Infinity;
  // Căn MỚI: dán toạ độ khác căn cũ (> 30 m), hoặc dời ghim xa hơn 300 m → xoá mọi thứ thuộc về căn cũ:
  // giá, diện tích, thổ cư, số tầng, phòng ngủ, pháp lý, lô đất, chữ trên lô, bề rộng đường, dòng phụ, tên xã/tỉnh,
  // kịch bản và giọng đã tạo. Xã/tỉnh của căn mới tự nhận diện và điền vào ô khi quét (ranh hành chính theo toạ độ).
  const newHouse = prev && (moved > 0.3 || (fresh && moved > 0.03));
  if (newHouse) {
    leaveSample();
    const had = resetHouseInfo(prev); // trước resetHouseScoped để còn nhớ tên xã/tỉnh khách đã sửa
    resetHouseScoped();
    state.cloudId = null; state.projName = ''; // căn mới lưu thành căn riêng, không ghi đè căn đã lưu trước
    if (!restoreHouseInfo(h) && had) toast('Căn mới: đã để trống thông tin căn cũ (giá, diện tích, lô đất…). Anh/chị nhập lại cho căn này nhé.', 4500);
  } else if (fresh && prev && moved <= 0.03) restoreHouseInfo(h);
  if (moved > 0.5) {
    if (state.pois.length) toast('Đã đổi vị trí. Bấm Quét tiện ích để tìm lại quanh căn nhà mới.');
    state.pois = []; state.roads = []; state.streets = null; state.adminArea = null; state.selected = []; state.selectedRoads = []; state.routes = {}; state.admin = null;
    state.cloudId = null; state.projName = '';
    { const lp = $('lookPick'); if (lp) lp.hidden = true; }
    renderLists();
  } else if (moved > 0.001) {
    for (const p of state.pois) p.km = p.zone ? Math.max(0.05, haversineKm(h, p) - (p.inset || 0)) : haversineKm(h, p);
    state.routes = {};
    renderLists();
    queueRoutes();
  }
  scheduleRebuild();
}

// ---------- Thử ngay với căn mẫu (khách mới) ----------
// Chọn tối đa 2 tuyến điểm nhấn trong các tuyến đã chọn: ưu tiên quốc lộ/tỉnh lộ/đường lớn (cấp ≥ 2) gần nhà, không lấy tuyến ở xa
function autoHiRoads() {
  const sel = state.roads.filter(r => state.selectedRoads.includes(r.id) && !r.far && r.nearKm <= 2.5);
  const rank = r => (r.level >= 2 ? 0 : r.level === 1 ? 1.5 : 3) + r.nearKm;
  return sel.slice().sort((a, b) => rank(a) - rank(b)).slice(0, 2).map(r => r.id);
}
const SAMPLE = { coord: '10.7285, 106.6185', price: '3,2 tỷ', area: '5x20m', beds: '3', legal: 'Sổ hồng riêng', floors: '1 trệt 2 lầu' };
// Dữ liệu căn mẫu đã quét sẵn (sample.json, dựng 1 lần bằng tools/make_sample.py): mở ra là phát ngay, không phải quét,
// không tốn lượt gọi Vietmap/chỉ đường cho mỗi khách mới. Chỉ các mục thuộc CĂN NHÀ — giữ nguyên logo/SĐT/thương hiệu của khách.
const SAMPLE_KEYS = ['coordText', 'house', 'typeLabel', 'label', 'sub', 'radiusKm', 'price', 'area', 'beds', 'legal', 'floors', 'thoCu',
  'pois', 'roads', 'streets', 'adminArea', 'admin', 'areaWard', 'areaProv', 'areaFor', 'selected', 'selectedRoads', 'routes',
  'roadStars', 'roadFills', 'scannedAt', 'useBoundary', 'region', 'regionFor', 'regionOff',
  // Kịch bản AI (phong cách Chuyên gia) + giọng đọc tạo sẵn 1 lần cho căn mẫu (sample-voice.m4a), có phụ đề
  'scriptEdits', 'scriptAi', 'voSig', 'aiTone', 'scriptMode', 'voiceId', 'voiceSpeed'];
const SAMPLE_PLAY = 'vitri.samplePlay';
async function fetchSample(ms = 4000) {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch('/sample.json', { signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(tm); }
}
// Ghi căn mẫu vào bộ nhớ máy (ngoài state) để lần mở trang kế tiếp dựng UI từ đầu như một căn bình thường
function writeSampleStore(d, base = {}) {
  const o = { ...base };
  for (const k of SAMPLE_KEYS) if (k in d) o[k] = d[k];
  Object.assign(o, { sample: true, coordSet: true, cloudId: null, projName: '', musicLib: 'hung-hon', musicV: 2, labelV: 3, speedV: 2,
    showAdminArea: true, showSweep: true, fxV: 2, // video mẫu: khoanh xã/phường → tỉnh/thành + tia radar (giọng câu "Thuộc …" đã có trong file)
    lot: [], sampleVoice: d.voice || null, aiVoiceOn: true, subsOn: true });
  if (!d.voice) Object.assign(o, { scriptEdits: {}, scriptAi: false, voSig: '' });
  localStorage.setItem(STORE, JSON.stringify(o));
}
// Khách MỚI (máy chưa từng mở app): nạp căn mẫu TRƯỚC khi dựng giao diện → vào là thấy video mẫu tự phát.
// Chạy trước init(); quá 2,5 s chưa tải được thì bỏ qua (app mở như cũ, vẫn có nút "Thử ngay").
async function bootSample() {
  try {
    if (sessionStorage.getItem(SAMPLE_PLAY)) return true; // vừa bấm "Thử ngay" (đã ghi căn mẫu rồi tải lại trang)
    if (localStorage.getItem(STORE) || localStorage.getItem('vitri.sampleSeen')) return false;
    localStorage.setItem('vitri.sampleSeen', '1');
  } catch { return false; }
  const d = await fetchSample(2500);
  if (!d || !d.pois?.length) return false;
  try { writeSampleStore(d); return true; } catch { return false; }
}
// Khách đổi sang căn của mình: bỏ thông tin mẫu (giá, diện tích…) để không lọt vào video căn thật
// Giọng đọc của căn mẫu: một file m4a, mỗi câu một đoạn (mốc trong sample.json) → cắt ra gắn vào từng cảnh như giọng AI thật
let sampleVoiceJob = null;
function loadSampleVoice() {
  const V = state.sampleVoice;
  if (!state.sample || !V || !V.segs?.length) return Promise.resolve(false);
  if (sampleVoiceJob) return sampleVoiceJob;
  sampleVoiceJob = (async () => {
    try {
      const ab = await (await fetch('/' + V.file)).arrayBuffer();
      const whole = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(ab);
      if (!state.sample) return false;
      const sr = whole.sampleRate, src = whole.getChannelData(0);
      const byKey = Object.fromEntries(scriptSegments().map(sg => [sg.key, sg]));
      for (const g of V.segs) {
        const sg = byKey[g.key];
        if (!sg) continue;
        const a = Math.max(0, Math.round(g.start * sr)), n = Math.min(src.length - a, Math.round(g.dur * sr));
        if (n <= 0) continue;
        const buf = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: sr });
        buf.copyToChannel(src.subarray(a, a + n), 0);
        media.voiceSegs.set(g.key, { ck: voiceKey(sg.text), buffer: buf, speed: g.speed ?? 0 });
      }
      state.aiVoiceOn = true;
      media.mixKey = '';
      rebuild();
      renderScript();
      updateVoCard();
      return true;
    } catch { return false; }
  })();
  return sampleVoiceJob;
}
function leaveSample() {
  if (!state.sample) return;
  state.sample = false;
  state.sampleVoice = null;
  state.aiTone = ''; // căn thật: khách tự chọn phong cách kịch bản (không chọn sẵn)
  for (const [k, id] of [['price', 'priceInput'], ['area', 'areaInput'], ['beds', 'bedsInput'], ['legal', 'legalInput'], ['floors', 'floorsInput']]) {
    if (state[k] === SAMPLE[k]) { state[k] = ''; const el = $(id); if (el) el.value = ''; }
  }
  const tg = $('sampleTag'); if (tg) tg.hidden = true;
}
// Phát video mẫu. Trình duyệt chặn tiếng khi khách chưa chạm vào trang → phát hình trước, nút "Bật tiếng" nháy;
// chạm bất kỳ đâu là có nhạc ngay đúng chỗ đang phát.
function autoPlaySample() {
  funnel('mau');
  const tg = $('sampleTag');
  if (tg) tg.hidden = false;
  const snd = $('sampleSound');
  const active = navigator.userActivation ? navigator.userActivation.hasBeenActive : false;
  if (snd) snd.hidden = active;
  // iPhone chỉ tính là "chạm" ở touchend/click (touchstart, kéo cuộn không mở được âm thanh) → nghe nhiều sự kiện,
  // mở khoá đồng bộ ngay trong sự kiện, chỉ gỡ lắng nghe khi âm thanh đã thật sự chạy.
  const EVS = ['touchend', 'pointerup', 'click', 'keydown'];
  let started = false;
  const unlock = () => {
    primeAudio();
    if (playing && !started) { started = true; startAudio(); } // đang phát: bật tiếng đúng chỗ đang chạy
    setTimeout(() => {
      if (!audioCtx || audioCtx.state !== 'running') { started = false; return; }
      if (snd && !snd.hidden) funnel('mau_tieng'); // phễu: khách đã bật được tiếng video mẫu
      if (snd) snd.hidden = true;
      for (const ev of EVS) document.removeEventListener(ev, unlock, true);
    }, 450);
  };
  if (snd) snd.onclick = () => { if (!playing) play(); };
  if (!active) for (const ev of EVS) document.addEventListener(ev, unlock, true);
  t = 0; updateTimeUi();
  setTimeout(() => { if (!playing && !editing && state.sample) play(); }, 350);
  toast('Video mẫu đang phát. Dán toạ độ căn của anh/chị để làm video thật.', 5000);
  // 28/10: trên điện thoại (một cột) khung "Chọn kiểu video" cao ~260 px đẩy ô dán toạ độ xuống dưới màn hình →
  // chỉ hiện ở máy tính (2 cột); điện thoại vẫn thấy khung này sau khi quét căn của mình.
  if (matchMedia('(min-width: 980px)').matches) setTimeout(showLooks, 2500);
}
async function trySample() {
  funnel('thu');
  // Có dữ liệu mẫu quét sẵn: ghi vào máy rồi mở lại trang → phát ngay (nhanh hơn quét thật ~20 s)
  const d = await fetchSample();
  if (d && d.pois?.length) {
    try {
      writeSampleStore(d, JSON.parse(localStorage.getItem(STORE) || '{}'));
      sessionStorage.setItem(SAMPLE_PLAY, '1');
      location.reload();
      return;
    } catch { /* hết chỗ lưu → quét thật như cũ */ }
  }
  $('coordInput').value = SAMPLE.coord;
  if (!applyCoords(SAMPLE.coord)) return;
  for (const [k, id] of [['price', 'priceInput'], ['area', 'areaInput'], ['beds', 'bedsInput'], ['legal', 'legalInput'], ['floors', 'floorsInput']]) {
    if (!state[k]) { state[k] = SAMPLE[k]; const el = $(id); if (el) el.value = SAMPLE[k]; }
  }
  // Căn mẫu luôn có nhạc hùng hồn để khách thấy video hoàn chỉnh
  if (!state.musicLib || !media.music) { $('musicLib').value = 'hung-hon'; await pickLibrary('hung-hon'); }
  save();
  await scan();
  if (state.pois.length) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    rebuild(); t = 0; updateTimeUi();
    setTimeout(() => play(), 600);
    toast('Đây là video của căn mẫu. Dán toạ độ căn của anh/chị để làm video thật.', 4500);
  }
}

// ---------- Mời mua đúng lúc: xem thử tới khoảng 60% video thì hiện lời mời (không chặn xem) ----------
let nudgeDone = false;
function maybeNudge() {
  if (tl && t >= tl.duration * 0.6) funnel(state.sample ? 'mau60' : 'xem60');
  // 28/10 (Giang): khách CHƯA đăng nhập thấy lời mời đăng ký sớm — video mẫu sau ~12 s (vừa qua thẻ giá + cảnh tỉnh/thành),
  // video căn của khách sau ~15 s. Trước đây đợi 60% video (~70 s) → 27/10 chỉ 13/62 khách xem tới đó. Hết lượt: vẫn 60%.
  const at = !account.profile ? Math.min(state.sample ? 12 : 15, (tl?.duration || 0) * 0.6) : (tl?.duration || 0) * 0.6;
  if (nudgeDone || !tl || t < at) return;
  nudgeDone = true;
  try { if (sessionStorage.getItem('vitri.nudge')) return; sessionStorage.setItem('vitri.nudge', '1'); } catch { /* bỏ qua */ }
  const p = account.profile, info = account.info || {};
  const box = $('buyNudge');
  if (!box) return;
  const pk = (info.packages || []).filter(x => x.credits > 0);
  const promo = account.promo && new Date(account.promo.until) > Date.now() ? account.promo.percent : 0;
  const per = pk.length ? Math.min(...pk.map(x => x.price * (100 - promo) / 100 / x.credits)) : 0;
  const perTxt = per ? Math.round(per / 100) * 100 : 0;
  if (!p) {
    box.innerHTML = `<strong>${state.sample ? 'Muốn video như thế này cho căn của anh/chị?' : 'Video này ổn chứ? Lưu và xuất cho căn của anh/chị nhé'}</strong>
      <span>Đăng ký miễn phí 30 giây, nhận <b>${info.trial_credits ?? 1} video</b> dùng thử, không cần thẻ.</span>
      <div class="row"><button type="button" class="btn btn-primary" data-act="register" data-reason="Nhận video miễn phí cho căn của anh/chị — đăng ký 30 giây, không cần thẻ.">Đăng ký nhận video miễn phí</button><button type="button" class="link-btn x" data-nx="1">Để sau</button></div>`;
  } else if (!p.unlimited && p.credits <= 0) {
    box.innerHTML = `<strong>Xuất video này chỉ từ ${perTxt ? perTxt.toLocaleString('vi-VN') + 'đ' : 'vài nghìn đồng'}/video</strong>
      <span>Bản nét 1080p, có giọng đọc và nhạc, đăng ngay TikTok, Zalo, Facebook.${promo ? ` <b>Đang giảm ${promo}% lần mua đầu.</b>` : ''}</span>
      <div class="row"><button type="button" class="btn btn-primary" data-act="buy">Xem bảng giá</button><button type="button" class="link-btn x" data-nx="1">Để sau</button></div>`;
  } else return;
  box.hidden = false;
  box.onclick = e => { if (e.target.closest('[data-nx], [data-act]')) box.hidden = true; };
}

// ---------- Quét ----------
let scanCtrl = null;
// Vùng lái xe 5 – 10 – 15 phút từ nhà (máy chủ gọi ArcGIS Service Areas, nhớ đệm 30 ngày). Lỗi / chưa bật quyền thì bỏ qua.
let isoJob = '';
async function loadIso(force = false) {
  const h = state.house;
  if (!h || state.sample) return;
  const k = `${h.lat.toFixed(4)},${h.lng.toFixed(4)}`;
  if (!force && (state.isoFor === k || isoJob === k)) return;
  isoJob = k;
  try {
    const r = await fetch(`/api/map/iso?lat=${h.lat}&lng=${h.lng}`);
    const j = r.ok ? await r.json() : null;
    if (!state.house || `${state.house.lat.toFixed(4)},${state.house.lng.toFixed(4)}` !== k) return;
    state.isoFor = k;
    state.iso = j && j.areas?.length ? { areas: j.areas } : null;
    syncIsoUi();
    save();
    scheduleRebuild();
  } catch { /* để lần sau */ } finally { if (isoJob === k) isoJob = ''; }
}
// Kết nối vùng (24/10, Giang: "liên kết vùng" cho khách thấy vị trí đắc địa): thời gian lái xe thật tới trung tâm,
// sân bay, cảng, ga gần nhất (Vietmap qua /api/map/route, nhớ đệm 30 ngày) + tuyến cao tốc/vành đai/cầu ĐANG THI CÔNG
// gần nhà (OpenStreetMap). Điểm mốc quá xa (> 70 phút) mặc định tắt, khách bật lại được.
let regionJob = '';
async function loadRegion(force = false) {
  const h = state.house;
  if (!h) return;
  const k = `${h.lat.toFixed(4)},${h.lng.toFixed(4)}`;
  if (!force && (state.regionFor === k || regionJob === k)) return;
  regionJob = k;
  renderRegion();
  try {
    const hubs = pickHubs(h);
    const [infra, routes] = await Promise.all([
      loadInfra(h).catch(() => []),
      Promise.all(hubs.map(x => routeTo(h, x).catch(() => null))),
    ]);
    if (!state.house || `${state.house.lat.toFixed(4)},${state.house.lng.toFixed(4)}` !== k) return;
    const anchors = hubs.map((x, i) => {
      const r = routes[i];
      const km = r ? r.km : x.km0 * 1.35;
      // Thời gian của Vietmap có tính kẹt xe lúc gọi (giờ cao điểm 20 km có thể ra 48 phút) → chặn trên theo tốc độ
      // trung bình thường ngày (26 km/h cho quãng ngắn, tăng dần tới 70 km/h cho quãng dài), để số phút ổn định, không phụ thuộc giờ quét
      const typical = km / Math.max(26, Math.min(70, 24 + 0.5 * km)) * 60;
      const min = r && r.min > 0 ? Math.min(r.min, typical) : typical;
      return { id: x.id, type: x.type, name: x.name, lat: x.lat, lng: x.lng, km: Math.round(km * 10) / 10,
        min: Math.max(1, Math.round(min)), approx: !r, coords: r ? simplifyLine(r.coords, 0.015) : null };
    });
    state.region = { anchors, infra: infra || [] };
    state.regionFor = k;
    state.regionOff = anchors.filter(a => a.min > 70).map(a => a.id);
    renderRegion();
    save();
    scheduleRebuild();
  } catch { /* để lần sau */ } finally { if (regionJob === k) { regionJob = ''; renderRegion(); } }
}
function regionScene() {
  const R = state.region;
  if (!R) return null;
  const off = new Set(state.regionOff || []);
  const anchors = state.showRegion !== false ? (R.anchors || []).filter(a => !off.has(a.id)) : [];
  const infra = state.showInfra !== false ? (R.infra || []).filter(a => !off.has(a.id)) : [];
  return anchors.length || infra.length ? { anchors, infra } : null;
}
const HUB_ICON = { center: '🏙️', airport: '✈️', port: '⚓', station: '🚆', metro: '🚇' };
function renderRegion() {
  const box = $('regionBox');
  if (!box) return;
  const R = state.region;
  const head = $('regionHead');
  if (!R) {
    box.innerHTML = regionJob ? '<p class="hint">Đang tính thời gian tới trung tâm, sân bay, cảng… gần nhất</p>' : '';
    box.hidden = !regionJob; if (head) head.hidden = !regionJob;
    return;
  }
  box.hidden = false; if (head) head.hidden = false;
  const off = new Set(state.regionOff || []);
  const chip = (id, text, meta, on) => `<label class="road-chip"><input type="checkbox" autocomplete="off" data-region="${esc(id)}" ${on ? 'checked' : ''}><span>${text}</span><span class="km">${meta}</span></label>`;
  const A = R.anchors || [], I = R.infra || [];
  box.innerHTML = (A.length ? `
    <label class="check-row"><input autocomplete="off" type="checkbox" id="regionOn" ${state.showRegion !== false ? 'checked' : ''}><span><strong>Cảnh Kết nối vùng</strong> tới các điểm mốc lớn</span></label>
    <div class="road-list region-list">${A.map(a => chip(a.id, `${HUB_ICON[a.type] || '📍'} ${esc(a.name)}`, `${a.approx ? '≈ ' : ''}${a.min} phút`, !off.has(a.id))).join('')}</div>` : '') +
    (I.length ? `
    <label class="check-row"><input autocomplete="off" type="checkbox" id="infraOn" ${state.showInfra !== false ? 'checked' : ''}><span><strong>Hạ tầng đang thi công</strong> gần nhà</span></label>
    <div class="road-list region-list">${I.map(r => chip(r.id, `🚧 ${esc(r.label)}`, formatKm(r.nearKm, true), !off.has(r.id))).join('')}</div>
    <p class="hint small">Theo OpenStreetMap — tuyến nào đã xong hoặc sai thì bỏ tick.</p>` : '') +
    (!A.length && !I.length ? '<p class="hint">Không có điểm mốc lớn hay tuyến đang thi công gần căn này.</p>' : '');
}
function syncIsoUi() {
  const row = $('isoRow');
  if (row) row.hidden = !(state.iso && state.iso.areas?.length);
  const cb = $('isoOn');
  if (cb) cb.checked = state.showIso !== false;
}
async function scan() {
  if (state.sample && !$('coordInput').value.trim()) { askCoords(); return; }
  if (!state.house) { applyCoords($('coordInput').value); if (!state.house) return; }
  scanCtrl?.abort();
  scanCtrl = new AbortController();
  const btn = $('scanBtn');
  btn.disabled = true;
  $('scanLabel').textContent = 'Đang quét…';
  setStatus('Đang tìm tiện ích và đường lớn quanh căn nhà…');
  try {
    const res = await scanArea(state.house, state.radiusKm, scanCtrl.signal, msg => setStatus(msg));
    // Quét cho một căn KHÁC căn đã điền tên xã/tỉnh trước đó (khoá theo toạ độ ~100 m): xoá dữ liệu căn cũ
    // (phòng khi đổi vị trí theo đường nào đó mà setHouse không bắt được, hoặc trình duyệt còn dữ liệu cũ)
    const houseKey = `${state.house.lat.toFixed(3)},${state.house.lng.toFixed(3)}`;
    const newHouse = state.areaFor !== houseKey;
    if (newHouse) resetHouseScoped();
    state.roadFills = {};
    const manual = state.pois.filter(p => p.manual);
    state.pois = [...res.pois, ...manual];
    state.roads = res.roads;
    if (!state.sample && res.pois.length) funnel('quet');
    state.streets = res.streets || null;
    state.adminArea = res.area || null;
    updateAreaPlaceholders();
    state.selected = [...autoPick(res.pois), ...manual.map(p => p.id)].slice(0, MAX_POIS);
    state.selectedRoads = [...autoPickRoads(state.roads), ...(state.myRoads || []).map(m => m.id)];
    // 24/10: mặc định gắn ★ điểm nhấn cho 2 trục đường lớn gần nhà nhất để video đầu tiên đã đẹp (khách bỏ ★ được)
    const keepStars = (state.roadStars || []).filter(id => state.selectedRoads.includes(id));
    state.roadStars = !newHouse && keepStars.length ? keepStars : autoHiRoads();
    state.routes = {};
    state.admin = res.admin;
    // Tự điền tên xã/phường, tỉnh/thành nhận diện theo vị trí vào ô (khách sửa được); căn mới thì luôn điền lại
    const autoWard = res.area?.ward?.name || res.admin?.commune || '';
    const autoProv = res.area?.province?.name || res.admin?.province || '';
    if (newHouse || !state.areaWard) { state.areaWard = autoWard; $('areaWardInput').value = autoWard; }
    if (newHouse || !state.areaProv) { state.areaProv = autoProv; $('areaProvInput').value = autoProv; }
    state.areaFor = houseKey;
    if (!state.sub && res.admin?.commune) {
      state.sub = res.admin.commune + (res.admin.provinceShort ? ' · ' + res.admin.provinceShort : '');
      $('subInput').value = state.sub;
    }
    state.scannedAt = Date.now();
    renderLists();
    queueRoutes();
    scheduleRebuild();
    fillRoadGaps();
    loadIso(true);
    loadRegion(true);
    const b = res.admin?.boundary;
    toast(`Tìm thấy ${res.pois.length} tiện ích, ${res.roads.length} tuyến đường lớn` + (b ? `, ranh ${b.short} cách ${formatKm(b.km)}` : '') + `. Đã chọn sẵn ${state.selected.length} điểm.`, 4000);
    showStep(2);
    setTimeout(showLooks, 700);
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
  renderRegion();
  const has = state.pois.length || state.roads.length;
  // Khách mới chưa quét căn nào: mời thử ngay với căn mẫu (36% tài khoản chưa xuất video nào)
  const sb = $('sampleBox'); if (sb) sb.hidden = !!has;
  updateNewHouseBtn();
  syncVnEntry();
  $('results').hidden = !has;
  $('resultsEmpty').hidden = !!has;
  updateCount();
  const rl = $('roadList');
  rl.innerHTML = state.roads.length
    ? state.roads.map(r => `
      <label class="road-chip${(state.roadStars || []).includes(r.id) ? ' hi' : ''}">
        <input type="checkbox" autocomplete="off" data-road="${esc(r.id)}" ${state.selectedRoads.includes(r.id) ? 'checked' : ''}>
        <span class="dot" style="background:${ROAD_DOT[r.level]}"></span>
        <span>${esc(r.label)}${r.alt ? `<small class="alt"> · ${esc(r.alt)}</small>` : ''}</span>
        <span class="km">${formatKm(r.nearKm, true)}</span>
        <button type="button" class="road-star" data-road-star="${esc(r.id)}" aria-pressed="${(state.roadStars || []).includes(r.id)}" title="Chọn làm tuyến điểm nhấn: vẽ nổi như ranh TP.HCM" aria-label="Tuyến điểm nhấn">★</button>
      </label>`).join('')
    : (state.myRoads || []).length ? '' : '<p class="hint">Không có quốc lộ, cao tốc hay đường chính trong bán kính này. Có thể tự vẽ đường bên dưới.</p>';
  // Đường khách tự vẽ: chọn/bỏ, ★ điểm nhấn, sửa lại nét vẽ, xoá
  rl.innerHTML += (state.myRoads || []).map(m => {
    const r = myRoadObj(m);
    return `
      <label class="road-chip mine${(state.roadStars || []).includes(m.id) ? ' hi' : ''}">
        <input type="checkbox" autocomplete="off" data-road="${esc(m.id)}" ${state.selectedRoads.includes(m.id) ? 'checked' : ''}>
        <span class="dot" style="background:${ROAD_DOT[0]}"></span>
        <span>${esc(m.label)}<small class="alt"> · tự vẽ</small></span>
        <span class="km">${formatKm(r.nearKm, true)}</span>
        <button type="button" class="road-edit" data-myroad-edit="${esc(m.id)}" title="Sửa nét vẽ, đổi tên" aria-label="Sửa đường">✏️</button>
        <button type="button" class="road-del" data-myroad-del="${esc(m.id)}" title="Xoá đường này" aria-label="Xoá đường">×</button>
        <button type="button" class="road-star" data-road-star="${esc(m.id)}" aria-pressed="${(state.roadStars || []).includes(m.id)}" title="Chọn làm tuyến điểm nhấn" aria-label="Tuyến điểm nhấn">★</button>
      </label>`;
  }).join('');

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
// 30/10: nút "Biệt thự · Villa" giữ khoá cũ 'VỊ TRÍ CĂN VILLA' (căn đã lưu không đổi), chữ trong video/kịch bản là "biệt thự"
const TYPE_WORD = { 'VỊ TRÍ CĂN NHÀ': 'Căn nhà', 'VỊ TRÍ CĂN VILLA': 'Căn biệt thự', 'VỊ TRÍ LÔ ĐẤT': 'Lô đất', 'VỊ TRÍ DỰ ÁN': 'Dự án',
  'VỊ TRÍ NHÀ CHO THUÊ': 'Nhà cho thuê', 'VỊ TRÍ PHÒNG CHO THUÊ': 'Phòng cho thuê', 'VỊ TRÍ MẶT TIỀN CHO THUÊ': 'Mặt tiền cho thuê' };
// Khoảng cách trong kịch bản: viết số kiểu Việt Nam (1,8 km); lúc gửi giọng đọc sẽ đổi thành chữ
function kmSpeak(km) {
  if (km < 0.95) return Math.max(50, Math.round(km * 1000 / 50) * 50) + ' mét';
  return String(km < 10 ? km.toFixed(1) : Math.round(km)).replace('.', ',').replace(/,0$/, '') + ' km';
}
// Tên điểm mốc / tuyến hạ tầng đọc trong câu: chữ đầu viết thường ("trung tâm …", "sân bay …"), bỏ ngoặc, bỏ số hiệu tuyến
const lowerFirst = s => s.replace(/^\p{Lu}/u, c => c.toLowerCase());
function hubSpeak(name) { return lowerFirst(nameSpeak(name)); }
function infraSpeak(label) {
  return lowerFirst(nameSpeak(String(label || '').replace(/\s*\((?:[A-ZĐ]{2,3}\.?\s?\d+\w*)\)/g, '').replace(/\s*\(([^)]*)\)/g, ' $1').replace(/\s+[–-]\s+/g, ' – ')));
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
// Giọng đã tạo được nhớ theo LỜI + GIỌNG (media.voiceCache, lưu cả vào máy — IndexedDB 'vitri-voices' theo căn):
// sửa/thêm vài câu thì chỉ đọc câu mới; đổi lại lời cũ, AI viết rồi quay lại, tải lại trang… đều dùng lại giọng đã có, không tốn thêm.
function voiceEntry(sg) {
  const ck = voiceKey(sg.text);
  const v = media.voiceSegs.get(sg.key);
  if (v && v.ck === ck) return v;
  const c = media.voiceCache.get(ck);
  if (!c) return null;
  const e = { ck, buffer: c.buffer, speed: c.speed, own: c.own };
  media.voiceSegs.set(sg.key, e);
  return e;
}
const voiceOk = sg => !!voiceEntry(sg);
// Giọng của một câu theo tốc độ đọc hiện tại: đúng tốc độ lúc tạo thì dùng luôn, khác thì co giãn (giữ cao độ) và nhớ lại
function voiceBuf(sg) {
  const v = voiceEntry(sg);
  if (!v) return null;
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
  const isLand = /LÔ ĐẤT/.test(state.typeLabel || ''), rent = isRentType(), noRooms = isLand || isRoomType();
  const beds = noRooms ? '' : c(state.beds), legal = rent ? '' : c(state.legal), floors = noRooms ? '' : c(state.floors), thoCu = rent ? '' : c(state.thoCu), rw = c(state.roadWidth);
  const parts = [];
  if (c(state.area)) parts.push('diện tích ' + c(state.area));
  if (thoCu) parts.push(/thổ cư/i.test(thoCu) ? thoCu : thoCu + ' thổ cư');
  if (!isLand && floors) parts.push(/^\d+$/.test(floors) ? floors + ' tầng' : floors);
  if (!isLand && beds) parts.push(/^\d+$/.test(beds) ? beds + ' phòng ngủ' : beds);
  if (rw) parts.push((isLand ? 'đường trước lô ' : 'đường trước nhà ') + (/^\d+([.,]\d+)?$/.test(rw) ? rw + ' mét' : rw.replace(/(\d)\s*m\b/i, '$1 mét')));
  if (legal) parts.push(legal.charAt(0).toLowerCase() + legal.slice(1));
  if (c(state.price) && !skipPrice) parts.push((isRentType() ? 'giá thuê ' : pick(['giá chỉ ', 'giá bán '], 5)) + c(state.price));
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
  const rent = isRentType(), giaChi = rent ? 'chỉ' : 'giá chỉ'; // "Phòng cho thuê chỉ 3,5 triệu/tháng" (tránh lặp "cho thuê giá thuê")
  const priceHooks = rent ? [
    `${tw} chỉ ${price}${near}. Xem ngay vị trí này nhé!`,
    `Chỉ ${price} để thuê ${twl.replace(/ cho thuê$/, '')}${near}! Cùng xem xung quanh có gì nhé!`,
    `${tw} ${price}${near}, vị trí này rất dễ kín người thuê. Xem ngay nhé!`,
  ] : [
    `${tw} giá chỉ ${price}${near}. Xem ngay vị trí này nhé!`,
    `Chỉ ${price} cho ${twl}${near}! Cùng xem xung quanh có gì nhé!`,
    `${tw} ${price}${near}, giá này còn rất ít. Xem ngay nhé!`,
  ];
  // Trình tự: trung cảnh "Đây là vị trí … thuộc phường …" → cả tỉnh/thành → cận cảnh thông tin → bán kính
  const ward = wardName(), prov = provName();
  const hasProvScene = !!(state.showAdminArea && state.adminArea?.province?.rings?.length && state.adminArea?.ward?.rings?.length);
  if (ward) {
    const head = price ? (generic ? `${tw} ${giaChi} ${price}${near}. ` : `${nameSpeak(title)}, ${giaChi} ${price}. `) : (generic ? '' : `${nameSpeak(title)}. `);
    add('intro', 'Mở đầu · xã/phường', head + pick([`Đây là vị trí ${twl} thuộc ${midSentence(ward)}.`, `Đây là vị trí ${twl}, nằm tại ${midSentence(ward)}.`], 1));
  } else {
    add('intro', 'Mở đầu', price
      ? (generic ? pick(priceHooks) : `${nameSpeak(title)}, ${giaChi} ${price}${near}. Cùng xem vị trí và tiện ích xung quanh nhé!`)
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
  // Kết nối vùng: thời gian lái xe tới điểm mốc lớn + hạ tầng đang thi công
  const RG = regionScene();
  if (RG && RG.anchors.length) {
    const list = RG.anchors.slice(0, 4).map(a => `${a.min} phút tới ${hubSpeak(a.name)}`);
    const joined = list.length > 1 ? list.slice(0, -1).join(', ') + ' và ' + list[list.length - 1] : list[0];
    add('region', 'Kết nối vùng', pick([`Kết nối vùng rất thuận tiện: chỉ khoảng ${joined}.`, `Từ ${twl}, lái xe khoảng ${joined}.`,
      `Đi đâu cũng nhanh: khoảng ${joined}.`], 4));
  }
  if (RG && RG.infra.length) {
    const [a, b] = RG.infra;
    add('infra', 'Hạ tầng đang thi công', pick([
      `Đặc biệt, ${infraSpeak(a.label)} đang thi công, cách nhà khoảng ${kmSpeak(a.nearKm)}${b ? `, cùng ${infraSpeak(b.label)}` : ''}, kết nối khu vực sẽ còn mạnh hơn.`,
      `Điểm cộng lớn: ${infraSpeak(a.label)} đang được xây dựng, chỉ cách khoảng ${kmSpeak(a.nearKm)}${b ? `, thêm ${infraSpeak(b.label)}` : ''}.`], 5));
  }
  if (state.showIso && state.iso?.areas?.length) {
    const mins = state.iso.areas.map(a => a.min).join(', ').replace(/, (\d+)$/, ' rồi $1');
    add('iso', 'Vùng lái xe', pick([`Từ ${twl}, lái xe ${mins} phút, anh chị đi được tới đâu, nhìn bản đồ là thấy ngay.`,
      `Đây là vùng lái xe ${mins} phút tính từ ${twl}, kết nối rất nhanh đi khắp khu vực.`], 3));
  }

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
    let pool = KIND_LINES[p.kind] || POI_LINES[p.cat] || ['{n}, cách khoảng {d}.'];
    // cho thuê: bỏ câu kiểu bán/đầu tư ("giá trị tăng tốt", "hợp đầu tư cho thuê")
    if (isRentType()) { const ok = pool.filter(l => !/đầu tư|giá trị|tăng|sở hữu|dân trí/i.test(l)); pool = ok.length ? ok : ['{n} chỉ cách {d}.']; }
    add('poi:' + p.id, p.name, fill(pool[(seed + k + 1) % pool.length], { n: nameSpeak(p.name), d: kmSpeak(p.route ? p.route.km : p.km) }));
  }
  if (pois.length || b) add('summary', 'Tổng kết', pick(isRentType()
    ? [`Tất cả chỉ trong bán kính ${R} km, ${/MẶT TIỀN/.test(state.typeLabel) ? 'thuận tiện cho kinh doanh' : 'ở tiện, đi làm đi học đều gần'}.`, `Mọi tiện ích thiết yếu đều nằm trong bán kính ${R} km.`]
    : [`Tất cả chỉ trong bán kính ${R} km quanh nhà, sống tiện, đi lại dễ.`, `Mọi tiện ích thiết yếu đều nằm trong bán kính ${R} km.`], 3));

  // Kết: tạo cảm giác khan hiếm + kêu gọi xem nhà (đọc số điện thoại nếu khách nhập)
  const rentT = isRentType(), shop = /MẶT TIỀN CHO THUÊ/.test(state.typeLabel || '');
  const scarce = rentT
    ? pick(shop ? ['Mặt tiền vị trí này thường có người thuê rất nhanh.', 'Vị trí kinh doanh thế này không dễ tìm đâu.', 'Ai đến xem trước sẽ được ưu tiên trước nhé.']
      : ['Vị trí như thế này thường kín người thuê rất nhanh.', 'Giá thuê này ở khu vực này không dễ tìm đâu.', 'Ai đến xem trước sẽ được ưu tiên trước nhé.'], 4)
    : pick(['Vị trí như thế này không có nhiều.', 'Vị trí đẹp thế này không dễ tìm đâu.', 'Cơ hội sở hữu vị trí này không còn nhiều.'], 4);
  const phone = phoneDisplay(state.phone);
  const brand = (state.brand || '').trim() ? nameSpeak(state.brand.trim()) : '';
  const xem = isLandType() ? 'xem đất' : isRoomType() ? 'xem phòng' : shop ? 'xem mặt bằng' : 'xem nhà';
  const cta = phone && brand ? `Gọi ngay ${brand}, số ${phone}, để đi ${xem} trực tiếp!`
    : phone ? `Gọi ngay số ${phone} để đi ${xem} trực tiếp!`
    : brand ? `Liên hệ ${brand} để đi ${xem} ngay hôm nay!`
    : `Liên hệ ngay để đi ${xem} trực tiếp nhé!`;
  // 24/10 tối (Giang): cảnh kết kêu gọi xem nhà đứng trước; video/ảnh thực tế nằm CUỐI CÙNG, chiếu liền nhau → câu mời xem
  add('outro', 'Kết', `${scarce} ${cta}`);
  const endClips = Math.max(0, media.clips.length - (hasFrontClip() ? 1 : 0));
  if (endClips) add('reel', 'Mời xem video thực tế', `Và sau đây, xin mời quý vị cùng xem video${media.photos.length ? ' và hình ảnh' : ''} thực tế của ${twl}.`);
  if (media.photos.length) add('photos', 'Ảnh thực tế', endClips
    ? pick([`Thêm vài hình ảnh thực tế của ${twl}.`, `Và đây là hình ảnh thực tế của ${twl}.`], 5)
    : `Và sau đây, xin mời quý vị cùng xem hình ảnh thực tế của ${twl}.`);
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

// ---------- Giọng Vbee bằng tài khoản của khách (khách tự mang khoá) ----------
// Khoá lưu trên máy (localStorage), gửi kèm header x-vbee-app/x-vbee-token; máy chủ chỉ chuyển tiếp sang Vbee.
const VBEE_KEY = 'vitri.vbeeKey';
function vbeeKey() {
  try { const k = JSON.parse(localStorage.getItem(VBEE_KEY) || 'null'); return k && k.app && k.token ? k : null; } catch { return null; }
}
const vbeeKeyHeaders = (k = vbeeKey()) => (k ? { 'x-vbee-app': k.app, 'x-vbee-token': k.token } : {});
// 25/10 tối (Giang): mở cho mọi khách. Vẫn tắt được trên 1 máy bằng ?vbee=0 (khi máy đó chưa lưu khoá)
function vbeeOwnVisible() {
  try {
    const q = new URLSearchParams(location.search).get('vbee');
    if (q === '1' || q === '0') localStorage.setItem('vitri.vbeeOn', q);
    if (localStorage.getItem('vitri.vbeeOn') === '0') return !!vbeeKey();
  } catch { /* bỏ qua */ }
  return true;
}
function syncVbeeOwn(info) {
  const box = $('vbeeOwn');
  if (!box) return;
  box.hidden = !vbeeOwnVisible();
  const k = vbeeKey();
  $('vbeeForget').hidden = !k;
  $('vbeeConnect').textContent = k ? 'Kết nối lại' : 'Kết nối';
  const st = $('vbeeOwnState');
  st.textContent = k ? (info?.vbeeOwn === false ? '· khoá chưa dùng được' : '· đã kết nối') : '';
  st.classList.toggle('ok', !!k && info?.vbeeOwn !== false);
  if (k && !$('vbeeApp').value) $('vbeeApp').value = k.app;
}
async function vbeeConnect() {
  const app = $('vbeeApp').value.trim(), token = $('vbeeTok').value.trim().replace(/^Bearer\s+/i, '') || vbeeKey()?.token || '';
  const msg = $('vbeeOwnMsg');
  if (!app || !token) { msg.textContent = 'Dán đủ App ID và Token rồi bấm Kết nối.'; return; }
  const btn = $('vbeeConnect');
  btn.disabled = true; msg.textContent = 'Đang kiểm tra với Vbee…';
  try {
    const r = await fetch('/api/tts?vbee=check', { headers: vbeeKeyHeaders({ app, token }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { msg.textContent = '❌ ' + (j.error || 'Không kết nối được, thử lại.'); return; }
    try { localStorage.setItem(VBEE_KEY, JSON.stringify({ app, token })); } catch { msg.textContent = 'Máy không cho lưu khoá (chế độ ẩn danh?).'; return; }
    $('vbeeTok').value = '';
    const d = j.diag;
    msg.textContent = `✅ Đã kết nối · ${j.voices} giọng${j.personal ? `, trong đó ${j.personal} giọng riêng ⭐ (giọng nhân bản của anh/chị)` : ' · chưa thấy giọng riêng/nhân bản nào trong ứng dụng này'}. Chọn giọng ở ô "Hoặc chọn giọng Vbee" phía trên.`
      + (d ? ` (Vbee trả: ${d.vbee} giọng Vbee · ${d.rieng} giọng riêng · ${d.congdong ?? 0} giọng cộng đồng${d.riengLoi ? ' · lỗi ' + d.riengLoi : ''})` : '');
    await checkAi();
    const mine = (ai.voices || []).find(v => v.provider === 'vbee' && v.own);
    if (mine) { state.voiceId = mine.id; syncVoiceUi(); renderScript(); save(); }
  } catch { msg.textContent = '❌ Lỗi mạng, thử lại.'; }
  finally { btn.disabled = false; }
}
function vbeeForget() {
  try { localStorage.removeItem(VBEE_KEY); } catch { /* bỏ qua */ }
  $('vbeeApp').value = ''; $('vbeeTok').value = '';
  $('vbeeOwnMsg').textContent = 'Đã ngắt kết nối. Khoá đã xoá khỏi máy này.';
  checkAi();
}

async function checkAi() {
  let a = null;
  try {
    let b;
    [a, b] = await Promise.all([
      fetch('/api/tts', { headers: vbeeKeyHeaders() }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/script').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    ai.tts = !!a?.ready; ai.ttsProvider = a?.provider || null; ai.script = !!b?.ready;
    ai.gated = a?.gated !== false;
    if (a?.voices?.length) renderVoices(a.voices);
  } catch { /* để mặc định */ }
  syncVbeeOwn(a);
  const prov = { fpt: 'FPT.AI', google: 'Google', vbee: 'Vbee' }[ai.ttsProvider] || '';
  $('aiStatus').textContent = ai.tts
    ? `Giọng AI sẵn sàng${prov ? ' (' + prov + ')' : ''}. Video tự giãn theo từng câu đọc.`
    : 'Giọng AI chưa bật trên máy chủ (cần khoá FPT.AI hoặc Google TTS). Kịch bản vẫn sửa và chép được để tự ghi âm.';
  $('aiScriptBtn').hidden = true; // đã gộp vào module Kịch bản & giọng đọc
  updateVoCard();
}

// Giọng FPT/Google: nút bấm như cũ. Giọng Vbee (id 'vb:…', khi máy chủ có VBEE_APP_ID + VBEE_TOKEN): ô chọn riêng + nghe thử.
function renderVoices(list) {
  ai.voices = list;
  const base = list.filter(v => v.provider !== 'vbee');
  const vb = list.filter(v => v.provider === 'vbee').sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  const seg = $('voiceSeg');
  seg.innerHTML = base.map(v => `<button type="button" role="radio" data-v="${esc(v.id)}">${esc(v.label)}</button>`).join('');
  seg.hidden = !base.length;
  const row = $('vbeeRow'), sel = $('vbeeVoice');
  if (row && sel) {
    row.hidden = !vb.length;
    const g = { female: 'nữ', male: 'nam' };
    const opt = v => `<option value="${esc(v.id)}">${esc(v.label)}${g[v.gender] ? ' · ' + g[v.gender] : ''}</option>`;
    // Nhóm như trên Vbee: giọng riêng/nhân bản ⭐ → giọng Vbee → giọng cộng đồng
    const groups = [['rieng', '⭐ Giọng riêng của anh/chị'], ['dexuat', '🎙️ Đề xuất cho video BĐS'], ['vbee', 'Giọng Vbee'], ['congdong', 'Giọng cộng đồng nhiều người dùng']];
    sel.innerHTML = '<option value="">— Chọn giọng Vbee —</option>' + groups.map(([k, name]) => {
      const items = vb.filter(v => (v.group || (v.own ? 'rieng' : 'vbee')) === k);
      return items.length ? `<optgroup label="${esc(name)} (${items.length})">${items.map(opt).join('')}</optgroup>` : '';
    }).join('');
  }
  // Giọng Vbee đã chọn mà danh sách lần này thiếu (Vbee trả chậm/thiếu trang khi tải lại) → GIỮ nguyên, đừng đổi giọng:
  // đổi giọng làm toàn bộ giọng đã tạo không còn khớp (26/10 Giang: tải lại web là mất giọng)
  const keepVb = String(state.voiceId || '').startsWith('vb:') && !!vbeeKey();
  if (!keepVb && !list.some(v => v.id === state.voiceId)) {
    const male = /^(g-)?nam/.test(state.voiceId);
    const pool = base.length ? base : vb;
    state.voiceId = (pool.find(v => /^(g-)?nam/.test(v.id) === male) || pool[0]).id;
  }
  syncVoiceUi();
}
function syncVoiceUi() {
  setSeg('voiceSeg', state.voiceId);
  const sel = $('vbeeVoice'), row = $('vbeeRow');
  if (!sel) return;
  const isVb = String(state.voiceId || '').startsWith('vb:');
  sel.value = isVb ? state.voiceId : '';
  row.classList.toggle('on', isVb);
  const v = (ai.voices || []).find(x => x.id === state.voiceId);
  $('vbeeDemo').hidden = !(isVb && v?.demo);
}

function altScript() {
  state.scriptSeed = (state.scriptSeed || 0) + 1;
  state.scriptEdits = {};
  state.scriptAi = false;
  renderScript(); scheduleRebuild(); save();
  $('scrMsg').textContent = 'Đã đổi sang cách viết khác. Sửa câu nào chưa ưng ngay trong danh sách, rồi bấm "Tạo giọng đọc" ở Bước 2.';
}

async function aiRewrite() {
  const segs = scriptSegments();
  if (!ai.script) { altScript(); return false; }
  const btn = $('aiScriptBtn');
  btn.disabled = true; $('aiScriptBig').disabled = true;
  $('scrMsg').textContent = 'AI đang viết kịch bản… (khoảng 15–25 giây)';
  try {
    const facts = {
      loai_bds: TYPE_WORD[state.typeLabel] || 'Căn nhà', tieu_de: state.title, dong_phu: state.sub, thuong_hieu: state.brand,
      so_dien_thoai_lien_he: phoneDisplay(state.phone) || null,
      thong_tin_nha: { gia: state.price || null, dien_tich: state.area || null, tho_cu: state.thoCu || null, so_tang: (!isLandType() && state.floors) || null,
        phong_ngu: (!isLandType() && state.beds) || null, phap_ly: state.legal || null, duong_truoc_nha: state.roadWidth || null, gia_moi_m2: pricePerM2(), dien_tich_m2: areaFromText(state.area) || null },
      diem_noi_bat: highlightLines(), khach_muc_tieu: state.buyer || null,
      ban_kinh_km: state.radiusKm, tinh_thanh: provName(), xa_phuong: wardName(),
      duong_lon: selectedRoads().map(r => ({ ten: r.label, ten_duong: r.alt || '', cach_km: +r.nearKm.toFixed(2) })),
      ranh_gioi: state.useBoundary && state.admin?.boundary ? { tinh: state.admin.boundary.short, chim_bay_km: +state.admin.boundary.km.toFixed(2), duong_di_km: state.routes.__ranh ? +state.routes.__ranh.km.toFixed(2) : null, phut_o_to: state.routes.__ranh?.min ? Math.round(state.routes.__ranh.min) : null } : null,
      tien_ich: selectedPois().map(p => ({ ten: p.name, nhom: CATEGORIES[p.cat].label, cach_km: +(p.route ? p.route.km : p.km).toFixed(2) })),
      ket_noi_vung: (regionScene()?.anchors || []).map(a => ({ ten: a.name, duong_di_km: a.km, phut_o_to: a.min })),
      ha_tang_dang_thi_cong: (regionScene()?.infra || []).map(r => ({ ten: r.label, cach_km: r.nearKm })),
    };
    // KHÔNG gửi câu mẫu (AI sẽ chép lại y chang) — chỉ gửi hình đang hiện + dữ liệu của từng cảnh
    const SCENE = { intro: 'Mở đầu: trung cảnh ghim bất động sản, xã/phường sáng lên', province: 'Cả tỉnh/thành phố hiện lên', house: 'Cận cảnh bất động sản, máy lượn quanh',
      reel: `Bản đồ đã xong, chuyển sang video thực tế ${realWord()}: 1 câu mời người xem cùng xem video (và hình ảnh) thực tế`, overview: 'Toàn cảnh vòng bán kính quanh nhà', region: 'Kết nối vùng: đường đi + số phút lái xe tới trung tâm, sân bay, cảng, ga', infra: 'Hạ tầng đang thi công gần nhà (nét đứt)', iso: 'Vùng lái xe 5, 10, 15 phút quanh nhà sáng lên lần lượt', boundary: 'Ranh giới sang tỉnh/thành bên cạnh', summary: 'Tổng kết tất cả tiện ích', photos: 'Ảnh thực tế của bất động sản', outro: `Kết video, kêu gọi đi ${isLandType() ? 'xem đất' : 'xem nhà'}` };
    if (hasFrontClip()) SCENE.intro = `Mở đầu: video thực tế mặt tiền ${realWord()} chiếu toàn khung (chưa vào bản đồ). Câu móc + giới thiệu ${realWord()}`;
    if (media.photos.length) SCENE.photos = media.clips.length > (hasFrontClip() ? 1 : 0) ? `Thêm ảnh thực tế của ${realWord()}` : 'Bản đồ đã xong, chuyển sang ảnh thực tế: 1 câu mời người xem cùng xem hình ảnh thực tế';
    const roadById = Object.fromEntries(selectedRoads().map(r => [r.id, r]));
    const poiById = Object.fromEntries(selectedPois().map(p => [p.id, p]));
    const segments = Object.fromEntries(segs.map(sg => {
      const [kind, id] = sg.key.split(':');
      if (kind === 'road' && roadById[id]) { const r = roadById[id]; return [sg.key, { canh: r.manual ? 'Đường nhỏ quanh nhà (môi giới tự vẽ trên bản đồ)' : 'Trục đường lớn', ten: r.label, ten_khac: r.alt || '', cach: kmSpeak(r.nearKm) }]; }
      if (kind === 'poi' && poiById[id]) {
        const p = poiById[id], km = p.route ? p.route.km : p.km;
        return [sg.key, { canh: 'Tiện ích', ten: p.name, nhom: CATEGORIES[p.cat]?.label || '', cach: kmSpeak(km), phut_xe_may: Math.max(1, Math.round(p.route?.min || km * 60 / 22)) }];
      }
      if (kind === 'region') return [sg.key, { canh: SCENE.region, diem_moc: (regionScene()?.anchors || []).slice(0, 4).map(a => ({ ten: a.name, phut_o_to: a.min, duong_di: kmSpeak(a.km) })) }];
      if (kind === 'infra') return [sg.key, { canh: SCENE.infra, tuyen: (regionScene()?.infra || []).slice(0, 2).map(r => ({ ten: r.label, cach: kmSpeak(r.nearKm) })) }];
      return [sg.key, { canh: SCENE[kind] || sg.label }];
    }));
    if (ai.gated && !account.profile && !(await requireLogin('Đăng nhập để AI viết kịch bản.'))) { $('ttsMsg').textContent = ''; return; }
    const res = await fetch('/api/script', {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ facts, segments, tone: state.aiTone || 'ke-chuyen', lat: state.house?.lat, lng: state.house?.lng }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (await handleAiError(res.status, j)) { $('scrMsg').textContent = j.error || ''; return; }
      throw new Error(j.error || 'HTTP ' + res.status);
    }
    state.scriptEdits = { ...j.segments };
    state.scriptAi = true;
    renderScript(); scheduleRebuild(); save();
    $('scrMsg').textContent = 'AI đã viết xong kịch bản.';
    // Không xoá giọng cũ: câu nào lời giữ nguyên thì dùng lại, đổi lời thì voiceOk tự báo thiếu
    return true;
  } catch (e) {
    $('scrMsg').textContent = 'AI viết kịch bản chưa dùng được (' + e.message + '), lời hiện tại giữ nguyên.';
  } finally { btn.disabled = false; $('aiScriptBig').disabled = false; }
  return false;
}

// ---------- Kịch bản & giọng đọc: TÁCH 2 BƯỚC (26/10, Giang thấy rối + bị thay kịch bản tự viết) ----------
// Bước 1 · Kịch bản: chọn cách có lời (✨ AI viết | 📝 mẫu | ✍️ tự viết/dán) — chỉ nút viết của từng cách mới đổi lời,
//   lời khách đã sửa (state.scriptOwn) phải xác nhận trước khi bị thay.
// Bước 2 · Giọng đọc: nút #ttsBtn CHỈ đọc đúng lời ở Bước 1 (generateVoices), không bao giờ tự viết lại kịch bản.
const voMode = () => (state.scriptMode === 'tu' ? 'tu' : state.scriptMode === 'mau' || !ai.script ? 'mau' : 'ai');
// Giữ cho tương thích: voSig khác rỗng = căn này đã tạo giọng (lúc mở app không xoá phong cách đã chọn)
const voChoice = () => voMode() === 'ai' ? 'ai|' + (state.aiTone || '') : voMode();
const needTone = () => voMode() === 'ai' && !state.aiTone;
const TONE_LABEL = { 'hai-huoc': 'Hài hước', 'ke-chuyen': 'Kể chuyện', 'chuyen-gia': 'Chuyên gia', 'tre-trung': 'Trẻ trung', 'sang-trong': 'Sang trọng', 'chot-sale': 'Chốt sale',
  'hoi-dap': 'Hỏi – đáp người thuê', 'dan-xem': 'Dẫn đi xem' };
const RENT_TONES = ['hoi-dap', 'dan-xem'];
function voStatus() {
  const segs = scriptSegments().filter(s => speakable(s.text));
  let ok = 0;
  for (const sg of segs) if (voiceOk(sg)) ok++;
  if (!ok) return 'none';
  return ok < segs.length ? 'stale' : 'ready'; // stale = khách sửa lời hoặc đổi giọng sau khi đã tạo
}
let voBusy = false;
// Chưa chọn phong cách: không viết, đưa khách tới chỗ chọn và nháy sáng
function askTone() {
  setSub('sound');
  const seg = $('aiToneSeg');
  seg.scrollIntoView({ behavior: 'smooth', block: 'center' });
  seg.classList.remove('need'); void seg.offsetWidth; seg.classList.add('need');
  toast('Chọn 1 phong cách kịch bản trước (Hài hước, Kể chuyện…), rồi bấm "AI viết kịch bản".', 3500);
}
// Lời hiện tại có phần khách tự gõ/sửa → hỏi trước khi thay
function confirmReplace(what) {
  if (!state.scriptOwn) return true;
  return confirm(`Kịch bản hiện tại có lời anh/chị đã tự viết/sửa.\n${what} sẽ THAY toàn bộ lời đó.\n\nTiếp tục?`);
}
function nudgeVoice() {
  const b = $('ttsBtn');
  b.scrollIntoView({ behavior: 'smooth', block: 'center' });
  b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
}
function updateVoCard() {
  const btn = $('ttsBtn');
  if (!btn) return;
  const mode = voMode(), st = voStatus();
  setSeg('scriptSrcSeg', mode);
  $('scriptSrcSeg').querySelector('[data-v="ai"]').disabled = !ai.script;
  $('aiToneWrap').hidden = mode !== 'ai';
  $('mauWrap').hidden = mode !== 'mau';
  $('tuWrap').hidden = mode !== 'tu';
  $('toneNeed').hidden = !needTone();
  // Bước 1: lời đang dùng đến từ đâu
  const src = $('scrState');
  src.textContent = state.scriptAi ? (state.scriptOwn ? '✨ AI viết · đã sửa' : `✨ AI viết · ${TONE_LABEL[state.aiTone] || ''}`.replace(/ · $/, ''))
    : state.scriptOwn ? '✍️ Lời tự viết' : '📝 Kịch bản mẫu';
  const w = $('aiWriteBtn');
  if (!voBusy) w.textContent = needTone() ? '👆 Chọn phong cách ở trên trước' : state.scriptAi ? '✨ AI viết lại kiểu khác' : '✨ AI viết kịch bản';
  w.classList.toggle('btn-primary', !state.scriptAi);
  w.classList.toggle('btn-quiet', !!state.scriptAi);
  $('mauApply').textContent = state.scriptAi || state.scriptOwn ? '📝 Dùng kịch bản mẫu (thay lời hiện tại)' : '🔄 Đổi sang cách viết khác';
  // Bước 2: giọng đọc
  const pill = $('voState');
  const segs = scriptSegments().filter(s => speakable(s.text));
  const miss = segs.filter(s => !voiceOk(s)).length;
  pill.textContent = { none: 'Chưa tạo', stale: 'Cần đọc lại', ready: '✓ Đã có giọng' }[st];
  pill.classList.toggle('ok', st === 'ready');
  if (ttsBusy) return;
  btn.textContent = st === 'none' ? '🎙️ Tạo giọng đọc theo kịch bản ở Bước 1'
    : st === 'stale' ? `🎙️ Đọc lại giọng cho ${miss} câu đã sửa`
    : '✓ Giọng đã khớp kịch bản';
  btn.classList.toggle('btn-primary', st !== 'ready');
  btn.classList.toggle('btn-quiet', st === 'ready');
  // Tuỳ chọn: bỏ giọng đọc, video chỉ có nhạc nền + SFX (nhiều khách không cần giọng). Ẩn khi đã có giọng.
  const skip = $('noVoiceBtn');
  if (skip) skip.hidden = !!voiceDurations();
  $('voVoiceOnly').hidden = true;
}
// Khách chọn không dùng giọng đọc: tắt giọng (video chỉ nhạc nền + SFX, thời lượng theo nhịp) rồi sang bước xuất video.
// Bấm "Tạo giọng đọc" sau đó thì giọng tự bật lại (generateVoices đặt aiVoiceOn = true).
let voiceAskedFor = '';
const houseKeyOf = h => h ? `${h.lat.toFixed(4)},${h.lng.toFixed(4)}` : '';
function skipVoice() {
  state.aiVoiceOn = false;
  $('aiVoiceOn').checked = false;
  media.mixKey = '';
  rebuild();
  save();
  showStep(4);
  toast('Video sẽ chỉ có nhạc nền và SFX. Muốn thêm giọng đọc thì quay lại bước 3.', 4000);
}
// Bước 1 · ✨ AI viết (chỉ viết lời, KHÔNG tạo giọng)
async function aiWrite({ ask = true } = {}) {
  if (voBusy || ttsBusy) return false;
  if (needTone()) { askTone(); return false; }
  if (ask && !confirmReplace('AI viết kịch bản mới')) return false;
  const w = $('aiWriteBtn');
  voBusy = true; w.disabled = true; w.textContent = '✨ AI đang viết kịch bản… (15–25 giây)';
  try {
    const ok = await aiRewrite();
    if (ok) {
      state.scriptOwn = false; save();
      if (ask) { $('scrMsg').textContent = 'AI đã viết xong. Đọc lại, sửa câu nào chưa ưng ngay trong danh sách, rồi bấm "Tạo giọng đọc" ở Bước 2.'; nudgeVoice(); }
    }
    return ok;
  } finally { voBusy = false; w.disabled = false; updateVoCard(); }
}
// Bước 1 · 📝 kịch bản mẫu
function useSample() {
  if (state.scriptAi || state.scriptOwn) {
    if (!confirmReplace('Dùng kịch bản mẫu')) return;
    state.scriptEdits = {}; state.scriptAi = false; state.scriptOwn = false;
    renderScript(); scheduleRebuild(); save();
    $('scrMsg').textContent = 'Đã dùng kịch bản mẫu. Sửa câu nào chưa ưng ngay trong danh sách, rồi bấm "Tạo giọng đọc" ở Bước 2.';
  } else altScript();
  state.scriptOwn = false;
  updateVoCard();
}
// Bước 1 · ✍️ dán cả bài: mỗi đoạn → 1 cảnh theo thứ tự; thiếu đoạn thì cảnh còn lại để trống (không đọc)
function pasteScriptApply() {
  const raw = $('pasteScript').value.replace(/\r/g, '').trim();
  if (!raw) { $('scrMsg').textContent = 'Dán kịch bản vào ô trên trước.'; return; }
  let parts = /\n\s*\n/.test(raw) ? raw.split(/\n\s*\n/) : raw.split('\n');
  parts = parts.map(x => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  const segs = scriptSegments();
  if (!confirmReplace('Chia bài vừa dán vào từng cảnh')) return;
  const ed = {};
  segs.forEach((sg, i) => { ed[sg.key] = i < segs.length - 1 ? (parts[i] || '') : parts.slice(i).join(' '); });
  state.scriptEdits = ed; state.scriptAi = false; state.scriptOwn = true;
  renderScript(); scheduleRebuild(); save();
  $('scrMsg').textContent = parts.length === segs.length
    ? `Đã chia ${parts.length} đoạn vào ${segs.length} cảnh. Kiểm tra từng cảnh bên dưới rồi bấm "Tạo giọng đọc" ở Bước 2.`
    : parts.length < segs.length
      ? `Bài có ${parts.length} đoạn, video có ${segs.length} cảnh: ${segs.length - parts.length} cảnh cuối để trống (không đọc). Kiểm tra bên dưới rồi bấm "Tạo giọng đọc".`
      : `Bài có ${parts.length} đoạn, video có ${segs.length} cảnh: các đoạn dư đã gộp vào cảnh cuối. Kiểm tra bên dưới rồi bấm "Tạo giọng đọc".`;
  updateVoCard();
  nudgeVoice();
}
// Bước 2 · 🎙️ tạo giọng: chỉ đọc lời đang có
async function voiceOnly() {
  if (voBusy || ttsBusy) return;
  await generateVoices();
  if (voiceDurations()) { state.voSig = voChoice(); save(); }
  updateVoCard();
}
// Nút "Tiếp tục" dưới cùng (khách đi nhanh, chưa đụng vào Bước 1): AI chưa viết + khách chưa tự sửa → AI viết rồi đọc;
// còn lại (đã có lời AI / lời tự viết / kịch bản mẫu) → chỉ đọc đúng lời đang có
async function makeScriptAndVoice() {
  if (voBusy || ttsBusy) return false;
  if (voMode() === 'ai' && !state.scriptAi && !state.scriptOwn) {
    if (needTone()) { askTone(); return false; }
    const ok = await aiWrite({ ask: false });
    if (!ok && voMode() === 'ai') { /* AI lỗi: aiRewrite đã báo, đọc kịch bản mẫu */ }
  }
  await voiceOnly();
}

let ttsBusy = false;
// Gọi /api/tts một lần; FPT chưa tạo xong thì hỏi lại link cho tới khi có file
async function ttsRequest(text, onWait, attempt = 0) {
  const res = await fetch('/api/tts', {
    method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders(), ...(String(state.voiceId || '').startsWith('vb:') ? vbeeKeyHeaders() : {}) },
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
  if (!state.sample) funnel('giong');
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
      rememberVoices(); // lưu ngay từng phần: lỗi giữa chừng/tải lại trang không mất phần đã tạo
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
  const sample = { neon: '3D', sangtrong: 'Aa', tretrung: 'Hi!', toigian: 'Aa', xanhla: '3D', doruc: '3D' };
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
    if (STYLE_HI[state.style]) { state.hiTheme = STYLE_HI[state.style]; renderSwatches('hiThemeRow', 'hiTheme', false, HI_THEMES); }
    renderSwatches('roadThemeRow', 'roadTheme', true);
    renderSwatches('routeThemeRow', 'routeTheme', false);
    for (const x of el.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
    fontsReady().then(() => { dirty = true; });
    scheduleRebuild();
  };
}
// ---------- 3 kiểu video xem trước (sau khi quét) ----------
// Mỗi kiểu = phong cách chữ + nền bản đồ + màu line trục đường ★. Ảnh xem trước vẽ bằng chính bộ dựng video,
// tại cảnh trục đường điểm nhấn của căn đang làm. Bấm một kiểu: áp dụng + phát lại từ đầu.
const LOOKS = [
  { id: 'neon', label: 'Xanh neon', style: 'neon', base: 'phim', hiTheme: 'dien' },
  { id: 'sang', label: 'Vàng sang trọng', style: 'sangtrong', base: 'vetinh', hiTheme: 'vang' },
  { id: 'gian', label: 'Trắng tối giản', style: 'toigian', base: 'duongpho', hiTheme: 'trang' },
];
const isLook = L => state.style === L.style && state.base === L.base && state.hiTheme === L.hiTheme;
function lookState(L) {
  const st = STYLES[L.style];
  return { style: L.style, base: L.base, hiTheme: L.hiTheme, roadTheme: st.road, routeTheme: st.route };
}
let lookTimer = null;
function showLooks() {
  const box = $('lookPick'), row = $('lookRow');
  if (!box || !row || !state.house || !state.pois.length) return;
  const F = FORMATS[state.fmt];
  row.innerHTML = LOOKS.map(L => `<button type="button" role="radio" class="look-card" data-look="${L.id}" aria-checked="${isLook(L)}">
    <canvas aria-hidden="true"></canvas><strong>${esc(L.label)}</strong></button>`).join('');
  box.hidden = false;
  const cvs = row.querySelectorAll('canvas');
  const items = LOOKS.map((L, i) => {
    const keep = Object.fromEntries(Object.keys(lookState(L)).map(k => [k, state[k]]));
    Object.assign(state, lookState(L));
    const ltl = buildTimeline(buildScene(), state.fmt, timelineOpts());
    Object.assign(state, keep);
    // Cảnh tổng kết: thấy cùng lúc chữ/khung thông tin của phong cách, nền bản đồ, line ★ và các tiện ích
    const ph = ltl.summary || ltl.roadPhases.find(p => ltl.roads[p.road]?.hi) || ltl.house;
    const cv = cvs[i];
    cv.width = 240; cv.height = Math.round(240 * F.LH / F.LW);
    return { cv, ltl, at: ph ? ph.t0 + (ph.t1 - ph.t0) * 0.7 : ltl.duration * 0.4 };
  });
  // Ô ảnh bản đồ tải dần: vẽ lại vài lần cho tới khi đủ ảnh
  let n = 0;
  clearInterval(lookTimer);
  const draw = () => {
    if (box.hidden) { clearInterval(lookTimer); return; }
    for (const it of items) render(it.cv.getContext('2d'), it.ltl, it.at, { cache, scale: it.cv.width / F.LW, request: true });
    if (++n >= 10) clearInterval(lookTimer);
  };
  fontsReady().then(draw);
  lookTimer = setInterval(draw, 800);
}
function pickLook(id) {
  const L = LOOKS.find(x => x.id === id);
  if (!L) return;
  Object.assign(state, lookState(L));
  renderStyles();
  renderBases();
  renderSwatches('roadThemeRow', 'roadTheme', true);
  renderSwatches('routeThemeRow', 'routeTheme', false);
  renderSwatches('hiThemeRow', 'hiTheme', false, HI_THEMES);
  for (const b of $('lookRow').querySelectorAll('[data-look]')) b.setAttribute('aria-checked', String(b.dataset.look === id));
  fontsReady().then(() => { dirty = true; });
  rebuild();
  save();
  t = 0; updateTimeUi();
  play();
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
// Kiểu + màu viền lô đất: đổi xong tua khung xem tới đúng lúc lô hiện rõ để khách thấy ngay
function showLotMoment() {
  rebuild();
  save();
  const hasLot = state.lot && state.lot.length >= 3;
  if (hasLot && tl?.house && !playing) {
    t = tl.house.t0 + 0.72 * (tl.house.t1 - tl.house.t0);
    updateTimeUi();
    dirty = true;
  }
}
// Ghi kích thước lô: tự bật khi lô lấy từ toạ độ sổ đỏ; lô vẽ tay chỉ bật khi khách chọn (số đo ước lượng)
function lotDimsOn() {
  if (state.lotDims === 'on') return true;
  if (state.lotDims === 'off') return false;
  return state.lotSrc === 'so';
}
function renderLotStyles() {
  const row = $('lotStyleRow');
  if (!row) return;
  const cur = LOT_STYLES[state.lotStyle] ? state.lotStyle : 'phatsang';
  row.innerHTML = Object.entries(LOT_STYLES).map(([k, s]) =>
    `<button type="button" role="radio" class="swatch lot-style" data-v="${k}" aria-checked="${k === cur}"><span class="lot-ico lot-ico-${k}" aria-hidden="true"></span>${esc(s.label)}</button>`).join('');
  const hasLot = state.lot && state.lot.length >= 3;
  $('lotStyleHint').textContent = hasLot ? '' : 'Áp dụng khi có vẽ lô đất (nút "Vẽ lô đất" dưới khung xem).';
  row.onclick = e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    state.lotStyle = b.dataset.v;
    renderLotStyles();
    showLotMoment();
  };
  const dim = $('lotDimsOn');
  if (dim) {
    dim.checked = lotDimsOn();
    const fs = state.streets && state.streets.front;
    const roadNote = fs ? (String(state.roadWidth || '').trim()
      ? ' Đường trước nhà (' + fs.name + ') được tô sáng, kèm vạch đo ' + String(state.roadWidth).trim() + '.'
      : ' Nhập "Bề rộng đường trước nhà" (mục Thông tin) để hiện số mét.') : '';
    $('lotDimsHint').textContent = hasLot ? (state.lotSrc === 'so' ? 'Số đo tính từ toạ độ sổ đỏ.' : 'Lô vẽ tay: số đo có thể lệch 1–2 m.') + roadNote : '';
    dim.onchange = () => { state.lotDims = dim.checked ? 'on' : 'off'; renderLotStyles(); showLotMoment(); };
  }
  renderSwatches('lotColorRow', 'lotColor', true, LOT_COLORS);
  $('lotColorRow').onclick = e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    state.lotColor = b.dataset.v;
    for (const x of $('lotColorRow').querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
    showLotMoment();
  };
}
function renderSwatches(id, key, withAuto, themes = LINE_THEMES) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = Object.entries(themes).filter(([k]) => withAuto || k !== 'auto').map(([k, th]) => {
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
  funnel(state.sample ? 'xuat_mau' : 'xuat');
  if (exporting || gating) return;
  // 28/10: giọng đọc là đường chính. Khách chưa tạo giọng và CHƯA chủ động bấm "Bỏ qua giọng đọc" → hỏi 1 lần mỗi căn
  // TRƯỚC khi trừ lượt (25–28/10 chỉ ~45% khách mới có giọng, trước đó ~70%; video có giọng bán tốt hơn).
  if (!state.sample && state.aiVoiceOn && !voiceDurations() && voiceAskedFor !== houseKeyOf(state.house)) {
    voiceAskedFor = houseKeyOf(state.house);
    if (confirm('Video chưa có giọng đọc AI giới thiệu căn nhà.\nVideo có giọng đọc thu hút khách xem hơn hẳn, tạo mất khoảng 30 giây.\n\nOK = tạo giọng đọc trước\nHuỷ = xuất luôn, chỉ có nhạc nền')) {
      showStep(3); setSub('sound', { scroll: true }); nudgeVoice();
      return;
    }
  }
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
  setFull(false);
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
        blob = await exportMp4({ tl: xtl, width, height, fps: 30, cache, audioBuffer: audio, onProgress, signal, prepFrame: tt => seekClipsExact(xtl, tt) });
      } catch (e) {
        if (e.code !== 'NO_AUDIO_ENCODER' && e.code !== 'NO_MUXER') throw e;
        progress(30, 'Đang quay theo thời gian thực để giữ nhạc và giọng đọc — giữ màn hình mở, đừng chuyển app…');
        blob = await exportRealtime({ tl: xtl, width, height, fps: 30, cache, audioBuffer: audio, audioCtx: exportAudioCtx, onProgress, signal, onTick: tt => syncClips(xtl, tt, true) });
      }
    } else {
      progress(30, 'Máy này không hỗ trợ dựng nhanh, đang quay theo thời gian thực — giữ màn hình mở, đừng chuyển app…');
      blob = await exportRealtime({ tl: xtl, width, height, fps: 30, cache, audioBuffer: audio, audioCtx: exportAudioCtx, onProgress, signal, onTick: tt => syncClips(xtl, tt, true) });
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
    else { console.error(e); lastIssue = 'Xuất video lỗi: ' + (e.message || e); toast('Xuất video lỗi: ' + (e.message || e) + keep + ' Bấm Hỗ trợ (Zalo) để nhắn Giang.', 8000); pulseSupport(); }
  } finally {
    exporting = false;
    for (const c of media.clips) { try { c.el.pause(); } catch { /* bỏ qua */ } }
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
        // chữ động: Montserrat 800 + Playfair (gói "Tạp chí")
        ...(sceneMotion() ? [document.fonts.load('800 40px "Montserrat"', 'GIÁ BÁN Ồ'), document.fonts.load('700 40px "Playfair Display"', 'Giá chỉ'), document.fonts.load('italic 500 20px "Playfair Display"', 'Giá chỉ')] : []),
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
  if (scroll && step >= 3 && !state.sample) funnel('buoc' + step); // chỉ tính khi khách tự chuyển bước (lúc mở app không tính)
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
    if (step === 1) {
      const own = state.pois.length && !state.sample; // căn mẫu: nút dưới là Quét căn của khách, không đi tiếp với căn mẫu
      label = own ? 'Tiếp tục →' : 'Quét tiện ích'; hide = !own;
    }
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
// Khách đang ở căn mẫu bấm Quét/Tiếp tục mà chưa dán toạ độ: đưa tới ô toạ độ, nháy sáng
function askCoords() {
  showStep(1);
  const inp = $('coordInput');
  inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inp.classList.remove('coord-hot'); void inp.offsetWidth; inp.classList.add('coord-hot');
  $('coordMsg').textContent = 'Dán toạ độ hoặc link Google Maps căn của anh/chị vào ô này, rồi bấm Quét tiện ích.';
  $('coordMsg').className = 'hint coord-cta';
}
async function stepNext() {
  if (step === 4) { doExport(); return; }
  if (step === 1) { if (state.pois.length && !state.sample) showStep(2); else await scan(); return; }
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
      await makeScriptAndVoice();
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
const PROJECT_KEYS = ['coordText', 'house', 'typeLabel', 'label', 'sub', 'radiusKm', 'title', 'showTitle', 'brand', 'phone', 'price', 'area', 'beds', 'legal', 'highlights', 'buyer',
  'scriptSeed', 'scriptEdits', 'scriptAi', 'scriptOwn', 'aiTone', 'scriptMode', 'voSig', 'thoCu', 'floors', 'fmt', 'speed', 'style', 'base', 'flow', 'lot', 'myRoads', 'plan', 'planOn', 'lotText', 'lotArea', 'areaWard', 'areaProv', 'areaFor', 'roadWidth', 'showStreets', 'showSweep', 'showAdminArea', 'keyLook', 'stars', 'roadStars', 'roadFills', 'iso', 'isoFor', 'showIso', 'region', 'regionFor', 'showRegion', 'showInfra', 'regionOff', 'pageVideo', 'pageDesc', 'roadTheme', 'hiTheme', 'lotStyle', 'lotColor', 'lotSrc', 'lotDims', 'routeTheme', 'roadLabelFace', 'voiceId', 'voiceSpeed', 'useBoundary', 'musicLib', 'musicVol',
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
    Object.assign(state, { pois: [], roads: [], selected: [], selectedRoads: [], routes: {}, admin: null, scriptEdits: {}, roadFills: {}, sample: false }, fixSpeed(d));
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
// 24/10: khách góp ý ít nhạc → thêm 5 bài hùng hồn/điện ảnh hợp kiểu video vẽ vị trí (tools/make_music.py)
const MUSIC_LIB = [
  { id: 'hung-hon', label: '🔥 Hùng hồn · điện ảnh' },
  { id: 'tran-ca', label: '🥁 Trống trận · mạnh mẽ' },
  { id: 'dang-cap', label: '🎬 Đẳng cấp · trailer' },
  { id: 'cong-nghe', label: '⚡ Công nghệ · hợp line neon' },
  { id: 'khoi-dau', label: '🌅 Khởi đầu · truyền cảm hứng' },
  { id: 'soi-dong', label: 'Sôi động · nhịp nhanh' },
  { id: 'tuoi-sang', label: 'Tươi sáng · vui tươi' },
  { id: 'sang-trong', label: 'Sang trọng · trầm ấm' },
  { id: 'nhe-nhang', label: 'Nhẹ nhàng · piano' },
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
// ---------- Lưu giọng đã tạo trên máy (IndexedDB 'vitri-voices', theo căn) ----------
// Mỗi câu: lời+giọng (ck), tốc độ lúc tạo, PCM 16-bit. Tối đa VOICE_KEEP câu mỗi căn, VOICE_HOUSES căn gần nhất.
const VOICE_KEEP = 160, VOICE_HOUSES = 8;
function voiceDb(mode, key, value) {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('vitri-voices', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('house');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction('house', mode === 'get' || mode === 'list' ? 'readonly' : 'readwrite');
          const st = tx.objectStore('house');
          if (mode === 'list') { // [khoá, thời điểm] để bỏ căn cũ
            const out = []; const cur = st.openCursor();
            cur.onsuccess = () => { const c = cur.result; if (c) { out.push([c.key, c.value?.t || 0]); c.continue(); } else resolve(out); };
            cur.onerror = () => resolve([]);
            return;
          }
          const r = mode === 'get' ? st.get(key) : mode === 'del' ? st.delete(key) : st.put(value, key);
          r.onsuccess = () => resolve(mode === 'get' ? r.result || null : true);
          r.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}
let voiceSaveTimer = 0;
function rememberVoices() {
  const now = Date.now();
  for (const v of media.voiceSegs.values()) {
    if (!v?.ck || !v.buffer) continue;
    const c = media.voiceCache.get(v.ck);
    if (c && c.buffer === v.buffer) { c.t = now; continue; }
    media.voiceCache.set(v.ck, { buffer: v.buffer, speed: v.speed, own: !!v.own, t: now });
  }
  if (!photoKey(state.house)) return;
  clearTimeout(voiceSaveTimer);
  const hk = photoKey(state.house);
  voiceSaveTimer = setTimeout(() => saveVoices(hk), 600);
}
async function saveVoices(hk) {
  if (hk !== photoKey(state.house)) return;
  const items = [...media.voiceCache.entries()].sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, VOICE_KEEP).map(([ck, c]) => {
    const f = c.buffer.getChannelData(0), pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) { const x = Math.max(-1, Math.min(1, f[i])); pcm[i] = x < 0 ? x * 32768 : x * 32767; }
    return { ck, speed: c.speed ?? null, own: c.own, t: c.t || 0, sr: c.buffer.sampleRate, pcm: pcm.buffer };
  });
  await voiceDb('put', hk, { t: Date.now(), voiceId: state.voiceId, items });
  const all = await voiceDb('list');
  if (all && all.length > VOICE_HOUSES) for (const [k] of all.sort((a, b) => b[1] - a[1]).slice(VOICE_HOUSES)) await voiceDb('del', k);
}
async function restoreVoices() {
  const hk = photoKey(state.house);
  voiceHouse = hk;
  if (!hk) return;
  const rec = await voiceDb('get', hk);
  if (voiceHouse !== photoKey(state.house) || !rec?.items?.length) return;
  for (const it of rec.items) {
    if (media.voiceCache.has(it.ck)) continue;
    try {
      const pcm = new Int16Array(it.pcm), f = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
      const buf = new AudioBuffer({ length: Math.max(1, f.length), numberOfChannels: 1, sampleRate: it.sr || 48000 });
      buf.copyToChannel(f, 0);
      media.voiceCache.set(it.ck, { buffer: buf, speed: it.speed, own: it.own, t: it.t });
    } catch { /* bỏ câu hỏng */ }
  }
  // Giọng đang chọn khác giọng lúc tạo (vd. danh sách giọng tải lại bị đổi mặc định) mà không câu nào khớp
  // → trả lại giọng đã tạo để không mất giọng
  if (rec.voiceId && rec.voiceId !== state.voiceId) {
    const segs = scriptSegments().filter(sg => speakable(sg.text));
    const hit = id => segs.filter(sg => media.voiceCache.has(speakable(sg.text) + '|' + id)).length;
    if (!hit(state.voiceId) && hit(rec.voiceId)) { state.voiceId = rec.voiceId; syncVoiceUi(); save(); }
  }
  media.mixKey = '';
  renderScript();
  scheduleRebuild();
}
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
// 24/10 tối (Giang): ảnh/video thực tế xếp theo phòng: mặt tiền → phòng khách → bếp → phòng ngủ → toilet → khác.
// Mỗi ảnh/video có nhãn phòng (khách chọn dưới ô ảnh). Mặc định gán theo thứ tự tải lên đúng thứ tự gợi ý trên.
const ROOMS = [['mattien', 'Mặt tiền'], ['khach', 'Phòng khách'], ['bep', 'Bếp'], ['ngu', 'Phòng ngủ'], ['wc', 'Toilet'], ['khac', 'Khác']];
// Lô đất: dùng lại đúng các khoá trên (thứ tự xếp, 'mattien' mở đầu video, dữ liệu đã lưu không đổi), chỉ đổi chữ hiện ra
// [khoá, chữ hiện trên video, chữ ngắn trong ô chọn 74 px]
const LAND_ROOMS = [['mattien', 'Mặt tiền lô đất', 'Mặt tiền'], ['khach', 'Toàn cảnh lô đất', 'Toàn cảnh'], ['bep', 'Đường trước lô', 'Đường trước'],
  ['ngu', 'Hiện trạng lô đất', 'Hiện trạng'], ['wc', 'Khu xung quanh', 'Xung quanh'], ['khac', 'Khác', 'Khác']];
const isLandType = () => /LÔ ĐẤT/.test(state.typeLabel || '');
// 30/10: nhà / mặt tiền CHO THUÊ — giá là giá thuê (mỗi tháng): chữ "Giá thuê" thay "Giá bán", không tính giá mỗi m²
const isRentType = () => /CHO THUÊ/.test(state.typeLabel || '');
const isRoomType = () => /PHÒNG CHO THUÊ/.test(state.typeLabel || '');
const roomList = () => (isLandType() ? LAND_ROOMS : ROOMS);
const realWord = () => (TYPE_WORD[state.typeLabel] || 'Căn nhà').toLowerCase();
// Đoạn video đầu chỉ mở đầu video khi là mặt tiền (khớp render.js: frontClip)
const hasFrontClip = () => !!(media.clips[0] && (!media.clips[0].room || media.clips[0].room === 'mattien'));
const ROOM_IDX = Object.fromEntries(ROOMS.map(([k], i) => [k, i]));
function roomLabel(r) { return r && r !== 'khac' ? (roomList().find(x => x[0] === r) || [])[1] || '' : ''; }
function guessRoom(name, list) {
  const n = String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  if (/mat.?tien|facade|front|ngoai/.test(n)) return 'mattien';
  if (isLandType()) {
    if (/toan.?canh|flycam|drone|tren.?cao/.test(n)) return 'khach';
    if (/duong|hem|road|street/.test(n)) return 'bep';
    if (/hien.?trang|thuc.?te|cay|vuon/.test(n)) return 'ngu';
    if (/xung.?quanh|hang.?xom|lan.?can|around/.test(n)) return 'wc';
  }
  if (/khach|living/.test(n)) return 'khach';
  if (/bep|kitchen/.test(n)) return 'bep';
  if (/ngu|bed/.test(n)) return 'ngu';
  if (/wc|toilet|ve.?sinh|tam|bath/.test(n)) return 'wc';
  // Theo thứ tự gợi ý: phòng chưa có ai dùng đầu tiên trong danh sách
  const used = new Set(list.map(x => x.room));
  return (ROOMS.find(([k]) => k !== 'khac' && !used.has(k)) || ['khac'])[0];
}
const sortRooms = list => list.map((x, i) => [x, i]).sort((a, b) => (ROOM_IDX[a[0].room] ?? 5) - (ROOM_IDX[b[0].room] ?? 5) || a[1] - b[1]).map(p => p[0]);
const roomSelect = (cur, i, kind) => `<select class="room-sel" data-room-${kind}="${i}" aria-label="Nhãn ảnh/video">${roomList().map(([k, l, sh]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${sh || l}</option>`).join('')}</select>`;
// Tiêu đề + hướng dẫn mục ảnh/video đổi theo loại bất động sản
const set2 = (el, t) => { if (el.textContent !== t) el.textContent = t; };
// Hàng nút loại BĐS + hàng phụ "Cho thuê" + phong cách kịch bản riêng cho thuê
function syncTypeUi() {
  const rent = isRentType();
  setSeg('typeSeg', rent ? 'RENT' : state.typeLabel);
  const rs = $('rentSeg'); if (rs) { rs.hidden = !rent; setSeg('rentSeg', state.typeLabel); }
  const seg = $('aiToneSeg');
  if (seg) {
    for (const b of seg.querySelectorAll('.rent-only')) b.hidden = !rent;
    const lab = { 'chuyen-gia': rent ? '📈 Tư vấn thuê' : '📈 Chuyên gia', 'chot-sale': rent ? '🔥 Chốt khách thuê' : '🔥 Chốt sale' };
    for (const [v, t] of Object.entries(lab)) { const b = seg.querySelector(`[data-v="${v}"]`); if (b) set2(b, t); }
    // đổi sang loại bán mà đang chọn phong cách riêng cho thuê → bỏ chọn, khách chọn lại
    if (!rent && RENT_TONES.includes(state.aiTone)) { state.aiTone = ''; setSeg('aiToneSeg', ''); }
  }
  const hl = $('highlightsInput');
  if (hl) hl.placeholder = rent
    ? (/MẶT TIỀN/.test(state.typeLabel) ? 'Mỗi dòng 1 ý, VD:\nNgang 5m, trống suốt\nHợp mở cửa hàng, văn phòng\nCọc 2 tháng, ký hợp đồng 1 năm'
      : 'Mỗi dòng 1 ý, VD:\nFull nội thất, có máy lạnh\nWC riêng, giờ giấc tự do\nCó chỗ để xe, camera an ninh')
    : 'Mỗi dòng 1 ý, VD:\nNhà mới xây 2025\nHẻm thông 6m, xe hơi vào tận nhà\nChủ cần bán gấp, giảm 200 triệu';
}
function syncRoomUi() {
  const land = isLandType(), w = realWord();
  const order = land ? 'mặt tiền → toàn cảnh → đường trước lô → hiện trạng → xung quanh' : 'mặt tiền → phòng khách → bếp → phòng ngủ → toilet';
  const set = (id, t) => { const el = $(id); if (el && el.textContent !== t) el.textContent = t; };
  set('clipTitle', `Video thực tế ${w}`);
  for (const id of ['floorsInput', 'bedsInput']) { const f = $(id)?.closest('.field'); if (f) f.hidden = land || isRoomType(); } // lô đất, phòng cho thuê: không có số tầng/phòng ngủ
  for (const id of ['thoCuInput', 'legalInput']) { const f = $(id)?.closest('.field'); if (f) f.hidden = isRentType(); } // cho thuê: thổ cư, pháp lý không cần
  // Cho thuê: ô giá thành "Giá thuê" (mỗi tháng)
  const pf = $('priceInput'), pl = pf?.closest('.field')?.querySelector('.field-label');
  if (pl) set2(pl, isRentType() ? 'Giá thuê / tháng' : 'Giá bán');
  if (pf) pf.placeholder = isRentType() ? '15 triệu/tháng' : '3,2 tỷ';
  set('photoHint', `Chọn nhãn dưới mỗi ảnh, app tự xếp: ${order}.`);
  set('clipHint', `Mỗi đoạn 5–15 giây, quay chậm. Chọn nhãn, app tự xếp: ${order}.`);
}
let photoHouse = '';
function savePhotos() {
  const k = photoKey(state.house);
  if (!k) return;
  if (media.photos.length) photoDb('put', k, media.photos.map(p => ({ src: p.src, room: p.room || 'khac' })));
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
  // Bản cũ lưu chuỗi src, bản mới lưu {src, room}
  const items = list.map(x => (typeof x === 'string' ? { src: x, room: '' } : x)).filter(x => x && x.src);
  const imgs = await Promise.all(items.map(x => loadLogo(x.src)));
  if (photoHouse !== k) return;
  media.photos = [];
  imgs.forEach((img, i) => { if (img) media.photos.push({ img, src: img.src, room: items[i].room || guessRoom('', media.photos) }); });
  media.photos = sortRooms(media.photos);
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
    if (p) { p.room = guessRoom(f.name, media.photos); media.photos.push(p); } else bad++;
  }
  media.photos = sortRooms(media.photos);
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
  syncRoomUi();
  const row = $('photoRow');
  if (!row) return;
  for (const el of row.querySelectorAll('.photo-th')) el.remove();
  const add = $('photoAdd');
  media.photos.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'photo-th';
    d.innerHTML = `<img alt="Ảnh ${i + 1}"><span class="ord">${i + 1}</span><button type="button" aria-label="Bỏ ảnh ${i + 1}" data-rm="${i}">×</button>${roomSelect(p.room || 'khac', i, 'photo')}`;
    d.querySelector('img').src = p.src;
    row.insertBefore(d, add);
  });
  add.hidden = media.photos.length >= PHOTO_MAX;
}

// ---------- Video thực tế căn nhà (khách tự quay, không MC) ----------
// Mỗi đoạn là một <video> ẩn (tắt tiếng); bộ dựng vẽ khung hình của nó ở các cảnh "VIDEO THỰC TẾ" lồng giữa bản đồ.
// Lưu file gốc trong IndexedDB theo toạ độ căn (như ảnh) để mở lại vẫn còn. Không tải lên máy chủ.
const CLIP_MB = 400;
let clipHouse = '';
function clipDb(mode, key, value) {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('vitri-clips', 1);
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
// Thẻ <video> nằm ngay sau khung xem trước (bị canvas che): Chrome tự dừng video tắt tiếng nằm ngoài màn hình
function clipHolder() {
  let h = document.getElementById('clipHolder');
  if (!h) {
    h = document.createElement('div');
    h.id = 'clipHolder';
    h.setAttribute('aria-hidden', 'true');
    h.style.cssText = 'position:absolute;inset:0;overflow:hidden;z-index:-1;pointer-events:none';
    ($('canvasWrap') || document.body).prepend(h);
  }
  return h;
}
// Mở một file video thành phần tử phát được; trả null nếu trình duyệt không đọc được (vd. HEVC trên máy không hỗ trợ)
function openClip(blob, name = '') {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement('video');
    el.muted = true; el.defaultMuted = true; el.playsInline = true; el.setAttribute('playsinline', ''); el.setAttribute('muted', '');
    el.preload = 'auto';
    let done = false;
    const fail = () => { if (done) return; done = true; URL.revokeObjectURL(url); el.remove(); resolve(null); };
    const tm = setTimeout(fail, 20000);
    el.addEventListener('error', fail, { once: true });
    el.addEventListener('loadeddata', () => {
      if (done) return;
      if (!el.videoWidth || !isFinite(el.duration) || el.duration <= 0.3) { clearTimeout(tm); fail(); return; }
      // Ảnh đại diện: khung hình ở giây ~0,5
      const snap = () => {
        if (done) return;
        done = true; clearTimeout(tm);
        let thumb = '';
        try {
          const c = document.createElement('canvas');
          const k = 160 / Math.max(el.videoWidth, el.videoHeight);
          c.width = Math.round(el.videoWidth * k); c.height = Math.round(el.videoHeight * k);
          c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
          thumb = c.toDataURL('image/jpeg', 0.7);
        } catch { /* bỏ qua */ }
        resolve({ el, url, blob, name, dur: el.duration, w: el.videoWidth, h: el.videoHeight, thumb });
      };
      el.addEventListener('seeked', snap, { once: true });
      setTimeout(snap, 2500);
      el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
      el.currentTime = Math.min(0.5, el.duration / 2);
    }, { once: true });
    clipHolder().appendChild(el);
    el.src = url;
    el.load();
  });
}
function dropClip(c) {
  try { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); c.el.remove(); URL.revokeObjectURL(c.url); } catch { /* bỏ qua */ }
}
function saveClips() {
  const k = photoKey(state.house);
  if (!k) return;
  if (media.clips.length) clipDb('put', k, media.clips.map(c => ({ blob: c.blob, name: c.name, room: c.room || 'khac' })));
  else clipDb('del', k);
}
async function restoreClips() {
  const k = photoKey(state.house);
  if (k === clipHouse) return;
  clipHouse = k;
  media.clips.forEach(dropClip);
  media.clips = [];
  showClips();
  if (!k) return;
  const list = await clipDb('get', k);
  if (!Array.isArray(list) || clipHouse !== k) return;
  const out = [];
  for (const it of list) { const c = it && it.blob ? await openClip(it.blob, it.name) : null; if (c) { c.room = it.room || guessRoom(it.name, out); out.push(c); } }
  if (clipHouse !== k) { out.forEach(dropClip); return; }
  media.clips = sortRooms(out);
  for (const c of out) c.el.addEventListener('seeked', () => { dirty = true; });
  showClips();
  scheduleRebuild();
}
async function pickClips(files) {
  const list = Array.from(files || []).filter(f => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name));
  $('clipFile').value = '';
  if (!list.length) return;
  if (!state.house) { toast('Dán vị trí căn nhà trước rồi thêm video.', 3000); return; }
  const room = CLIP_MAX - media.clips.length;
  if (room <= 0) { toast(`Tối đa ${CLIP_MAX} đoạn video. Bỏ bớt đoạn cũ để thêm đoạn mới.`, 3000); return; }
  $('clipAdd').classList.add('busy');
  let bad = 0, big = 0;
  for (const f of list.slice(0, room)) {
    if (f.size > CLIP_MB * 1048576) { big++; continue; }
    const c = await openClip(f, f.name).catch(() => null);
    if (c) { c.el.addEventListener('seeked', () => { dirty = true; }); c.room = guessRoom(f.name, media.clips); media.clips.push(c); } else bad++;
  }
  media.clips = sortRooms(media.clips);
  $('clipAdd').classList.remove('busy');
  if (list.length > room) toast(`Chỉ lấy ${room} đoạn đầu (tối đa ${CLIP_MAX} đoạn).`, 3000);
  else if (big) toast(`Video quá lớn (trên ${CLIP_MB} MB). Quay ngắn 5–15 giây mỗi đoạn là đẹp nhất.`, 4500);
  else if (bad) { lastIssue = 'Không đọc được video thực tế tải lên'; toast('Máy này không đọc được video đó. Trên iPhone chọn Cài đặt › Camera › Định dạng › "Tương thích nhất" rồi quay lại, hoặc dùng file MP4.', 7000); }
  saveClips();
  showClips();
  scheduleRebuild();
  if (media.clips.length && !bad && !big) toast('Đã lồng video thực tế vào video. Bấm ▶ Xem để xem thử.', 3500);
}
function removeClip(i) {
  const [c] = media.clips.splice(i, 1);
  if (c) dropClip(c);
  saveClips();
  showClips();
  scheduleRebuild();
}
function showClips() {
  const row = $('clipRow');
  if (!row) return;
  for (const el of row.querySelectorAll('.photo-th')) el.remove();
  const add = $('clipAdd');
  media.clips.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'photo-th clip-th';
    d.innerHTML = `<img alt="Video ${i + 1}"><span class="ord">▶ ${Math.round(c.dur)}s</span><button type="button" aria-label="Bỏ video ${i + 1}" data-rm="${i}">×</button>${roomSelect(c.room || 'khac', i, 'clip')}`;
    if (c.thumb) d.querySelector('img').src = c.thumb;
    row.insertBefore(d, add);
  });
  add.hidden = media.clips.length >= CLIP_MAX;
}
// Xem trước: đang phát thì cho video chạy theo thời gian thực (lệch > 0,25 s mới tua lại); đang dừng/tua thì tua tới đúng khung
function syncClips(T, tt, live) {
  if (!T || !T.clipWins || !T.clipWins.length) return;
  const active = new Set();
  for (const w of T.clipWins) {
    if (tt < w.t0 - 0.05 || tt >= w.t1) continue;
    const c = T.clips[w.clip];
    if (!c || !c.el) continue;
    const el = c.el;
    active.add(el);
    const { time, rate } = clipTime(c, w, tt);
    if (live && (el._noLive || 0) < 2) {
      if (el.playbackRate !== rate) el.playbackRate = rate;
      if (el.paused && !el._starting) {
        if (Math.abs(el.currentTime - time) > 0.05) el.currentTime = time;
        el._starting = true;
        el.play().then(() => { el._noLive = 0; }, () => { el._noLive = (el._noLive || 0) + 1; }).finally(() => { el._starting = false; });
      } else if (!el.paused && Math.abs(el.currentTime - time) > 0.25) el.currentTime = time;
    } else if (live) {
      // Trình duyệt không cho phát: tua theo từng khung (giật hơn nhưng vẫn thấy video)
      if (!el.seeking && Math.abs(el.currentTime - time) > 0.06) el.currentTime = time;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - time) > 0.04) el.currentTime = time;
    }
  }
  for (const c of T.clips) if (c.el && !active.has(c.el) && !c.el.paused) c.el.pause();
  // Tua sẵn tới khung đầu của đoạn sắp chiếu (0,8 s trước) để vào cảnh không bị khựng chờ tải
  for (const w of T.clipWins) {
    if (tt < w.t0 - 0.8 || tt >= w.t0 - 0.05) continue;
    const c = T.clips[w.clip];
    if (!c || !c.el || active.has(c.el) || c.el.seeking) continue;
    const { time } = clipTime(c, w, w.t0);
    if (Math.abs(c.el.currentTime - time) > 0.05) c.el.currentTime = time;
  }
}
// Xuất video từng khung: tua video tới đúng thời điểm rồi mới vẽ khung đó
function seekClipsExact(T, tt) {
  if (!T || !T.clipWins || !T.clipWins.length) return null;
  const w = T.clipWins.find(x => tt >= x.t0 && tt < x.t1);
  if (!w) return null;
  const c = T.clips[w.clip];
  if (!c || !c.el) return null;
  const el = c.el;
  const { time } = clipTime(c, w, tt);
  if (!el.paused) el.pause();
  if (Math.abs(el.currentTime - time) < 0.002 && el.readyState >= 2) return null;
  return new Promise(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; el.removeEventListener('seeked', fin); res(); };
    el.addEventListener('seeked', fin);
    setTimeout(fin, 4000);
    el.currentTime = time;
  });
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
        price: state.price, area: state.area, beds: isLandType() ? '' : state.beds, legal: state.legal, address,
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
  rememberVoices();
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
  $('showTitle').checked = state.showTitle !== false;
  $('titleInput').disabled = state.showTitle === false;
  $('brandInput').value = state.brand;
  $('musicVol').value = state.musicVol;
  $('fitVoice').checked = state.fitVoice;
  syncTypeUi(); syncRoomUi();
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
    e.target.classList.remove('coord-hot');
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
  // Loại BĐS: 4 loại bán + 1 nút "Cho thuê" gộp 3 loại (nhà / phòng / mặt tiền) ở hàng phụ #rentSeg (30/10 Giang: gộp cho gọn)
  const pickType = v => {
    // nhãn trên ghim: biệt thự (khách vẫn sửa được ở "Nhãn trên ghim", vd. VỊ TRÍ CĂN VILLA)
    const lab = v === 'VỊ TRÍ CĂN VILLA' ? 'VỊ TRÍ BIỆT THỰ' : v;
    state.typeLabel = v; state.label = lab; $('labelInput').value = lab;
    if (/CHO THUÊ/.test(v)) state.rentPick = v;
    syncTypeUi(); syncRoomUi(); showPhotos(); showClips(); scheduleRebuild();
  };
  bindSeg('typeSeg', v => pickType(v === 'RENT' ? (state.rentPick || 'VỊ TRÍ NHÀ CHO THUÊ') : v));
  bindSeg('rentSeg', v => pickType(v));
  $('labelInput').addEventListener('input', e => { state.label = e.target.value; scheduleRebuild(); });
  $('subInput').addEventListener('input', e => { state.sub = e.target.value.trim(); scheduleRebuild(); });
  syncIsoUi();
  $('isoOn').addEventListener('change', e => { state.showIso = e.target.checked; save(); scheduleRebuild(); });
  if (state.scannedAt && state.house && !state.sample) setTimeout(() => loadIso(), 2000);
  renderRegion();
  if (state.scannedAt && state.house && !state.region) setTimeout(() => loadRegion(), 2600);
  $('regionBox').addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'regionOn') state.showRegion = el.checked;
    else if (el.id === 'infraOn') state.showInfra = el.checked;
    else if (el.dataset.region) {
      const off = new Set(state.regionOff || []);
      if (el.checked) off.delete(el.dataset.region); else off.add(el.dataset.region);
      state.regionOff = [...off];
    } else return;
    save(); scheduleRebuild();
  });
  $('radiusInput').addEventListener('input', e => {
    state.radiusKm = parseFloat(e.target.value);
    updateScanLabel();
    scheduleRebuild();
  });
  $('scanBtn').addEventListener('click', scan);
  $('sampleBtn').addEventListener('click', trySample);
  $('nextPage').addEventListener('click', () => {
    const c = document.querySelector('.page-card');
    c?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('pageVideo')?.focus({ preventScroll: true }), 500);
  });

  $('adminBox').addEventListener('change', e => {
    if (e.target.id !== 'useBoundary') return;
    state.useBoundary = e.target.checked;
    scheduleRebuild();
  });
  $('roadList').addEventListener('change', e => {
    const id = e.target.dataset.road;
    if (!id) return;
    state.selectedRoads = e.target.checked ? [...new Set([...state.selectedRoads, id])] : state.selectedRoads.filter(x => x !== id);
    if (e.target.checked) fillRoadGaps([id]);
    // Bỏ chọn tuyến thì bỏ luôn điểm nhấn của tuyến đó
    if (!e.target.checked && (state.roadStars || []).includes(id)) { state.roadStars = state.roadStars.filter(x => x !== id); renderLists(); }
    scheduleRebuild();
  });
  // ★ Tuyến điểm nhấn: khách tự ghim tuyến quan trọng, video vẽ nổi kiểu ranh TP.HCM (tự chọn luôn tuyến đó)
  $('roadList').addEventListener('click', e => {
    const ed = e.target.closest('[data-myroad-edit]');
    if (ed) { e.preventDefault(); startRoadDraw(ed.dataset.myroadEdit); return; }
    const dl = e.target.closest('[data-myroad-del]');
    if (dl) {
      e.preventDefault();
      const m = (state.myRoads || []).find(x => x.id === dl.dataset.myroadDel);
      if (m && confirm(`Xoá đường "${m.label}" khỏi video?`)) removeMyRoad(m.id);
      return;
    }
    const b = e.target.closest('.road-star');
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.roadStar;
    const cur = state.roadStars || [];
    const on = !cur.includes(id);
    if (on && cur.length >= 2) { toast('Tối đa 2 tuyến điểm nhấn để video không bị rối. Bỏ ★ tuyến khác trước.'); return; }
    state.roadStars = on ? [...cur, id] : cur.filter(x => x !== id);
    if (on && !state.selectedRoads.includes(id)) state.selectedRoads = [...state.selectedRoads, id];
    renderLists();
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
  // Ô xác nhận (tên + nhóm + Thêm vào video) chỉ hiện khi đã có 1 điểm cụ thể (chọn kết quả tìm, dán link hoặc toạ độ)
  const showAddPick = (name, lat, lng, cat) => {
    $('addName').value = name || '';
    $('addCoord').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    $('addCat').value = cat || guessCategory({ name: name || '' });
    $('addCat').dataset.touched = '';
    $('addPick').hidden = false;
    (name ? $('addBtn') : $('addName')).focus();
  };
  const runAddSearch = async () => {
    const q = $('addSearch').value.trim();
    const box = $('addResults');
    const msg = $('addMsg');
    if (!q) { $('addSearch').focus(); return; }
    msg.textContent = ''; msg.className = 'hint';
    $('addPick').hidden = true;
    // Dán thẳng toạ độ "10.75, 106.62"
    if (/^\s*-?\d{1,2}\.\d+\s*[,;\s]\s*-?\d{2,3}\.\d+\s*$/.test(q)) {
      const c = parseCoords(q);
      if (c.error) { msg.textContent = c.error; msg.className = 'hint err'; return; }
      box.innerHTML = '';
      showAddPick('', c.lat, c.lng);
      msg.textContent = `Toạ độ cách căn nhà ${formatKm(haversineKm(state.house, c), true)}. Đặt tên rồi bấm Thêm vào video.`;
      msg.className = 'hint ok';
      return;
    }
    if (SHORT_LINK.test(q) || /google\.[a-z.]+\/maps|@-?\d+\.\d+,/.test(q)) {
      box.innerHTML = '<p class="hint">Đang đọc link…</p>';
      try {
        const r = (await resolveMapsLink(q)) || (() => { const c = parseCoords(q); if (c.error) throw new Error(c.error); const nm = q.match(/\/maps\/place\/([^/@?]+)/); return { ...c, name: nm ? decodeURIComponent(nm[1].replace(/\+/g, ' ')) : '' }; })();
        box.innerHTML = '';
        showAddPick(r.name || '', r.lat, r.lng);
        msg.textContent = r.name ? 'Đã đọc link. Kiểm tra nhóm rồi bấm Thêm vào video.' : 'Đã đọc toạ độ từ link. Đặt tên rồi bấm Thêm vào video.';
        msg.className = 'hint ok';
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
        : '<p class="hint">Không tìm thấy. Thử "📍 Chạm trên bản đồ", hoặc mở Google Maps → Chia sẻ địa điểm → dán link vào ô trên.</p>';
    } catch { box.innerHTML = '<p class="hint err">Tìm kiếm đang lỗi, thử lại sau hoặc dán link Google Maps.</p>'; }
  };
  $('addSearchBtn').addEventListener('click', runAddSearch);
  // Khách gõ tên (vd. sau khi dán toạ độ) thì đoán lại nhóm, trừ khi khách đã tự chọn nhóm
  $('addName').addEventListener('input', e => { if (!$('addCat').dataset.touched) $('addCat').value = guessCategory({ name: e.target.value }); });
  $('addCat').addEventListener('change', () => { $('addCat').dataset.touched = '1'; });
  $('addSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runAddSearch(); } });
  $('addResults').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const x = window.__addResults?.[+b.dataset.i];
    if (!x) return;
    $('addResults').innerHTML = '';
    showAddPick(x.name, x.lat, x.lng, guessCategory(x));
    $('addMsg').textContent = 'Đã chọn. Kiểm tra nhóm rồi bấm Thêm vào video.';
    $('addMsg').className = 'hint ok';
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
    $('addName').value = ''; $('addCoord').value = ''; $('addSearch').value = ''; $('addPick').hidden = true;
    msg.textContent = `Đã thêm "${name}", cách căn nhà ${formatKm(km, true)}.`;
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
  $('showTitle').addEventListener('change', e => { state.showTitle = e.target.checked; $('titleInput').disabled = !e.target.checked; save(); scheduleRebuild(); });
  $('showStreets').checked = state.showStreets !== false;
  $('showStreets').addEventListener('change', e => { state.showStreets = e.target.checked; scheduleRebuild(); });
  $('sweepOn').checked = !!state.showSweep;
  $('adminAreaOn').checked = !!state.showAdminArea;
  $('adminAreaOn').addEventListener('change', e => { state.showAdminArea = e.target.checked; save(); renderScript(); scheduleRebuild(); });
  $('sweepOn').addEventListener('change', e => { state.showSweep = e.target.checked; save(); scheduleRebuild(); });
  $('mau1On').addEventListener('change', e => {
    state.keyLook = e.target.checked ? 'mau1' : ''; save(); media.mixKey = ''; scheduleRebuild(); prepMau1();
    if (e.target.checked && !voiceDurations()) toast('Chữ điểm nhấn hiện theo giọng đọc — tạo giọng ở mục ③ để thấy.', 3500);
  });
  onAccountChange(() => { syncMau1Row(); scheduleRebuild(); });
  syncMau1Row();
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
  for (const [id, key] of [['priceInput', 'price'], ['areaInput', 'area'], ['thoCuInput', 'thoCu'], ['floorsInput', 'floors'], ['bedsInput', 'beds'], ['legalInput', 'legal'], ['highlightsInput', 'highlights'], ['buyerInput', 'buyer']]) {
    $(id).value = state[key] || '';
    $(id).addEventListener('input', e => { state[key] = e.target.value; renderScript(); scheduleRebuild(); });
  }
  // Logo + phụ đề
  $('logoBg').checked = state.logoBg !== false;
  $('logoBg').addEventListener('change', e => { state.logoBg = e.target.checked; scheduleRebuild(); });
  $('logoFile').addEventListener('change', e => pickLogo(e.target.files[0]));
  $('photoFile').addEventListener('change', e => pickPhotos(e.target.files));
  $('clipFile').addEventListener('change', e => pickClips(e.target.files));
  $('newHouseBtn').addEventListener('click', startNewHouse);
  document.addEventListener('click', e => { if (e.target.closest('[data-act="newhouse"]')) startNewHouse(); });
  $('clipRow').addEventListener('click', e => { const b = e.target.closest('button[data-rm]'); if (b) removeClip(Number(b.dataset.rm)); });
  // Đổi nhãn phòng → xếp lại mặt tiền → phòng khách → bếp → phòng ngủ → toilet
  $('clipRow').addEventListener('change', e => {
    const sel = e.target.closest('select[data-room-clip]');
    const c = sel && media.clips[Number(sel.dataset.roomClip)];
    if (!c) return;
    c.room = sel.value; media.clips = sortRooms(media.clips); saveClips(); showClips(); scheduleRebuild();
  });
  $('photoRow').addEventListener('change', e => {
    const sel = e.target.closest('select[data-room-photo]');
    const p = sel && media.photos[Number(sel.dataset.roomPhoto)];
    if (!p) return;
    p.room = sel.value; media.photos = sortRooms(media.photos); savePhotos(); showPhotos(); scheduleRebuild();
  });
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
  // Video hướng dẫn: chỉ tải khi khách bấm xem, đóng hộp thì dừng phát
  $('guideBtn').addEventListener('click', () => {
    const v = $('guideVideo');
    if (!v.src) v.src = 'huong-dan.mp4';
    $('guideDlg').showModal();
    v.play().catch(() => {});
  });
  $('guideDlg').addEventListener('close', () => $('guideVideo').pause());
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && $('recDlg').open && rec.mr?.state === 'recording') { e.preventDefault(); recNext(); }
  });
  $('musicClear').addEventListener('click', () => clearAudio('music'));
  $('voiceClear').addEventListener('click', () => clearAudio('voice'));
  $('musicVol').addEventListener('input', e => { state.musicVol = parseFloat(e.target.value); media.mixKey = ''; save(); });
  $('fitVoice').addEventListener('change', e => { state.fitVoice = e.target.checked; scheduleRebuild(); });
  renderSwatches('roadThemeRow', 'roadTheme', true);
  renderSwatches('routeThemeRow', 'routeTheme', false);
  renderSwatches('hiThemeRow', 'hiTheme', false, HI_THEMES);
  renderLotStyles();
  $('lookRow').addEventListener('click', e => { const b = e.target.closest('[data-look]'); if (b) pickLook(b.dataset.look); });
  $('lookClose').addEventListener('click', () => { $('lookPick').hidden = true; clearInterval(lookTimer); });
  setSeg('labelFaceSeg', state.roadLabelFace || 'line');
  bindSeg('labelFaceSeg', v => { state.roadLabelFace = v; save(); scheduleRebuild(); });
  renderStyles();
  renderBases();
  setSeg('voiceSeg', state.voiceId);
  setSeg('vspeedSeg', String(state.voiceSpeed));
  $('sfxOn').checked = state.sfxOn;
  $('sfxVol').value = state.sfxVol;
  $('aiVoiceOn').checked = state.aiVoiceOn;
  for (const el of document.querySelectorAll('#zaloFab')) el.addEventListener('click', () => {
    try { navigator.clipboard?.writeText(supportText()).then(() => toast('Đã chép sẵn thông tin căn. Dán vào Zalo rồi gửi Giang nhé.', 4000)).catch(() => {}); } catch { /* bỏ qua */ }
  });
  bindSeg('voiceSeg', v => { state.voiceId = v; syncVoiceUi(); renderScript(); save(); });
  $('vbeeVoice').addEventListener('change', e => {
    const v = e.target.value;
    if (!v) return;
    state.voiceId = v; syncVoiceUi(); renderScript(); save();
  });
  $('vbeeConnect').addEventListener('click', vbeeConnect);
  $('vbeeForget').addEventListener('click', vbeeForget);
  syncVbeeOwn();
  onAccountChange(() => syncVbeeOwn());
  let demoAudio = null;
  $('vbeeDemo').addEventListener('click', () => {
    const v = (ai.voices || []).find(x => x.id === state.voiceId);
    if (!v?.demo) return;
    try { demoAudio?.pause(); demoAudio = new Audio(v.demo); demoAudio.play().catch(() => toast('Không phát được giọng mẫu.')); } catch { /* bỏ qua */ }
  });
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
  $('noVoiceBtn').addEventListener('click', skipVoice);
  $('aiScriptBtn').addEventListener('click', aiRewrite);
  if (!state.voSig) state.aiTone = ''; // căn chưa tạo giọng: khách chọn lại phong cách
  setSeg('aiToneSeg', state.aiTone || '');
  bindSeg('aiToneSeg', v => { state.aiTone = v; $('aiToneSeg').classList.remove('need'); save(); updateVoCard(); updateQuick(); });
  bindSeg('scriptSrcSeg', v => {
    if (v === 'ai' && !ai.script) return;
    state.scriptMode = v; save(); updateVoCard();
    if (v === 'tu') { $('scrMsg').textContent = ''; $('scriptList').querySelector('textarea')?.focus({ preventScroll: true }); }
  });
  $('aiWriteBtn').addEventListener('click', () => aiWrite());
  $('mauApply').addEventListener('click', useSample);
  $('pasteApply').addEventListener('click', pasteScriptApply);
  $('phoneInput').value = state.phone || '';
  $('phoneInput').addEventListener('input', e => { state.phone = e.target.value; renderScript(); scheduleRebuild(); });
  $('ttsBtn').addEventListener('click', voiceOnly);
  $('scriptList').addEventListener('input', e => {
    const k = e.target.dataset.seg;
    if (!k) return;
    state.scriptEdits[k] = e.target.value;
    state.scriptOwn = true; // lời khách tự sửa: không bị thay khi chưa hỏi
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
  initFull();
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
  $('lotZoomIn').addEventListener('click', () => { lotZoom = Math.min(LOT_ZMAX, lotZoom + 0.5); dirty = true; });
  $('lotZoomOut').addEventListener('click', () => { lotZoom = Math.max(LOT_ZMIN, lotZoom - 0.5); dirty = true; });
  $('lotHome').addEventListener('click', () => { editCenter = { ...state.house }; dirty = true; });
  // Tự vẽ đường
  $('myRoadAdd').addEventListener('click', () => startRoadDraw());
  // Mặt bằng phân lô
  $('planFile').addEventListener('change', e => { pickPlanFile(e.target.files[0]); e.target.value = ''; });
  $('planEditBtn').addEventListener('click', startPlanEdit);
  initPlanEditor();
  $('planImgEdit').addEventListener('click', () => openPlanEditor());
  $('planImgEdit2').addEventListener('click', () => openPlanEditor());
  $('planOn').addEventListener('change', e => { state.planOn = e.target.checked; save(); scheduleRebuild(); });
  const askRemovePlan = () => { if (confirm('Xoá ảnh mặt bằng phân lô khỏi căn này? Video sẽ không còn mặt bằng.')) { removePlan(); toast('Đã xoá mặt bằng phân lô.'); } };
  $('planDelBtn').addEventListener('click', askRemovePlan);
  $('planDel2').addEventListener('click', askRemovePlan);
  $('planChange').addEventListener('click', () => $('planFile').click());
  $('planZoomIn').addEventListener('click', () => { planZoom = Math.min(21, planZoom + 0.5); dirty = true; });
  $('planZoomOut').addEventListener('click', () => { planZoom = Math.max(13, planZoom - 0.5); dirty = true; });
  $('planHome').addEventListener('click', () => { editCenter = { ...state.house }; dirty = true; });
  $('planPin').addEventListener('click', () => { planPick = { step: 'img1', pts: [] }; openPlanDlg(); });
  $('planRotL').addEventListener('click', () => nudgePlan(Math.PI / 180, 1));
  $('planRotR').addEventListener('click', () => nudgePlan(-Math.PI / 180, 1));
  $('planBig').addEventListener('click', () => nudgePlan(0, 1.03));
  $('planSmall').addEventListener('click', () => nudgePlan(0, 1 / 1.03));
  $('planOp').addEventListener('input', e => { if (state.plan) { state.plan.op = +e.target.value / 100; save(); scheduleRebuild(); dirty = true; } });
  $('planDone').addEventListener('click', () => { planPick = null; toggleEdit(false); toast('Đã lưu mặt bằng phân lô. Video sẽ dán mặt bằng xuống đất ở cảnh bay sát lô.', 3200); });
  $('planDlgImg').addEventListener('click', planImgTap);
  $('planDlgCancel').addEventListener('click', () => $('planDlg').close());
  $('planDlg').addEventListener('close', () => { if (planPick && /^img/.test(planPick.step)) { planPick = null; updatePlanMsg(); dirty = true; } });
  $('lotPlanBtn').addEventListener('click', () => { if (state.plan && media.planImg) startPlanEdit(); else $('planFile').click(); });
  // Thêm tiện ích bằng cách chạm trên bản đồ
  $('poiTapAdd').addEventListener('click', startPoiPick);
  $('poiZoomIn').addEventListener('click', () => { poiZoom = Math.min(21, poiZoom + 0.5); dirty = true; });
  $('poiZoomOut').addEventListener('click', () => { poiZoom = Math.max(14, poiZoom - 0.5); dirty = true; });
  $('poiHome').addEventListener('click', () => { editCenter = { ...state.house }; dirty = true; });
  $('poiAddBtn').addEventListener('click', addPickedPois);
  $('poiDone').addEventListener('click', () => toggleEdit(false));
  $('poiPickList').addEventListener('input', e => { if (e.target.id === 'poiOwnName') $('poiOwnOn').checked = !!e.target.value.trim(); });
  $('roadZoomIn').addEventListener('click', () => { roadZoom = Math.min(ROAD_ZMAX, roadZoom + 0.5); dirty = true; });
  $('roadZoomOut').addEventListener('click', () => { roadZoom = Math.max(ROAD_ZMIN, roadZoom - 0.5); dirty = true; });
  $('roadHome').addEventListener('click', () => { editCenter = { ...state.house }; dirty = true; });
  $('roadUndo').addEventListener('click', () => { if (roadDraft) { roadDraft.pts.pop(); updateRoadMsg(); dirty = true; } });
  $('roadClear').addEventListener('click', () => { if (roadDraft) { roadDraft.pts = []; updateRoadMsg(); dirty = true; } });
  $('roadDone').addEventListener('click', finishRoadDraw);
  $('roadCancel').addEventListener('click', () => { roadDraft = null; toggleEdit(false); });
  // Kéo để di chuyển khung khi vẽ lô/đường (chạm nhẹ vẫn là chấm điểm)
  let pan = null, panMoved = false, planG = null;
  const touches = new Map(); // ngón đang chạm (chế độ căn mặt bằng: 2 ngón = xoay + phóng)
  const editZoom = () => (editMode === 'lot' ? lotZoom : editMode === 'poi' ? poiZoom : editMode === 'plan' ? planZoom : roadZoom);
  const evLL = e => {
    const rect = canvas.getBoundingClientRect();
    return editTapToLatLng(editCenter, state.fmt, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, editZoom());
  };
  canvas.addEventListener('pointerdown', e => {
    if (!editing || editMode === 'pin' || !editCenter) return;
    panMoved = false;
    if (editMode === 'plan' && state.plan && !planPick) {
      touches.set(e.pointerId, evLL(e));
      if (touches.size === 2) { // ngón thứ 2 → xoay + phóng bằng 2 ngón
        pan = null;
        planG = planGestureStart('pinch', [...touches.values()]);
        planG.ids = [...touches.keys()];
        try { canvas.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
        return;
      }
      const kind = planHitAt(touches.get(e.pointerId), canvas.getBoundingClientRect());
      if (kind) {
        planG = planGestureStart(kind, [touches.get(e.pointerId)]);
        planG.ids = [e.pointerId]; planG.x = e.clientX; planG.y = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ }
        return;
      }
    }
    pan = { x: e.clientX, y: e.clientY, c: { ...editCenter }, id: e.pointerId };
  });
  canvas.addEventListener('pointermove', e => {
    if (planG && planG.ids.includes(e.pointerId)) {
      touches.set(e.pointerId, evLL(e));
      if (planG.kind !== 'pinch' && !panMoved && Math.hypot(e.clientX - planG.x, e.clientY - planG.y) < 4) return;
      panMoved = true;
      planGestureMove(planG, planG.ids.map(id => touches.get(id)));
      return;
    }
    if (!pan || e.pointerId !== pan.id) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!panMoved && Math.hypot(dx, dy) < 8) return;
    if (!panMoved) { panMoved = true; try { canvas.setPointerCapture(e.pointerId); } catch { /* bỏ qua */ } }
    const rect = canvas.getBoundingClientRect();
    const k = FORMATS[state.fmt].LW / rect.width;
    // Kéo bản đồ theo ngón tay: tâm mới = điểm nằm ngược hướng kéo
    const ll = editTapToLatLng(pan.c, state.fmt, 0.5 - dx * k / FORMATS[state.fmt].LW, 0.5 - dy * k / FORMATS[state.fmt].LH, editZoom());
    editCenter = ll;
    dirty = true;
  });
  const endPan = e => {
    touches.delete(e.pointerId);
    if (planG && planG.ids.includes(e.pointerId)) {
      planG = null;
      if (panMoved) { save(); scheduleRebuild(); updatePlanMsg(); }
    }
    if (pan && e.pointerId === pan.id) pan = null;
  };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  // Lăn chuột = phóng to/thu nhỏ bản đồ khi đang vẽ lô / đường / tiện ích / mặt bằng
  canvas.addEventListener('wheel', e => {
    if (!editing || editMode === 'pin') return;
    e.preventDefault();
    const d = e.deltaY < 0 ? 0.25 : -0.25;
    if (editMode === 'lot') lotZoom = Math.min(LOT_ZMAX, Math.max(LOT_ZMIN, lotZoom + d));
    else if (editMode === 'road') roadZoom = Math.min(ROAD_ZMAX, Math.max(ROAD_ZMIN, roadZoom + d));
    else if (editMode === 'poi') poiZoom = Math.min(21, Math.max(14, poiZoom + d));
    else if (editMode === 'plan') planZoom = Math.min(21, Math.max(13, planZoom + d));
    dirty = true;
  }, { passive: false });
  $('lotText').value = state.lotText || '';
  $('lotArea').value = state.lotArea || '';
  $('lotText').addEventListener('input', e => { state.lotText = e.target.value; save(); });
  $('lotArea').addEventListener('input', e => { state.lotArea = e.target.value; save(); });
  $('lotUndo').addEventListener('click', () => { state.lot.pop(); state.lotSrc = state.lot.length ? 'tay' : ''; dirty = true; updateLotMsg(); save(); });
  $('lotClear').addEventListener('click', () => { state.lot = []; state.lotSrc = ''; dirty = true; updateLotMsg(); save(); });
  $('lotDone').addEventListener('click', () => {
    if (state.lot.length && state.lot.length < 3) { toast('Lô đất cần ít nhất 3 góc.'); return; }
    toggleEdit(false);
    if (state.lot.length >= 3) toast(`Đã lưu lô đất khoảng ${formatArea(lotAreaM2(state.lot))}. Video sẽ zoom cận vào lô rồi mới ra bán kính.`, 3800);
  });
  initVn2000();
  $('bigPlay').addEventListener('click', e => { e.stopPropagation(); play(); });
  canvas.addEventListener('click', e => {
    if (!editing) { playing ? pause() : play(); return; }
    if (panMoved) { panMoved = false; return; } // vừa kéo bản đồ, không chấm điểm
    const rect = canvas.getBoundingClientRect();
    if (editMode === 'lot') {
      if (state.lot.length >= 12) { toast('Tối đa 12 góc.'); return; }
      state.lotSrc = 'tay';
      state.lot.push(editTapToLatLng(editCenter || state.house, state.fmt, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, lotZoom));
      dirty = true; updateLotMsg(); save();
      return;
    }
    if (editMode === 'plan') {
      if (!planPick || !/^map/.test(planPick.step)) { updatePlanMsg(); return; }
      const ll = editTapToLatLng(editCenter || state.house, state.fmt, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, planZoom);
      planMapTap(ll);
      return;
    }
    if (editMode === 'poi') {
      const ll = editTapToLatLng(editCenter || state.house, state.fmt, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, poiZoom);
      findPoisAt(ll);
      return;
    }
    if (editMode === 'road') {
      if (!roadDraft) return;
      if (roadDraft.pts.length >= ROAD_MAX_PTS) { toast(`Tối đa ${ROAD_MAX_PTS} điểm cho một con đường.`); return; }
      const ll = editTapToLatLng(editCenter || state.house, state.fmt, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, roadZoom);
      roadDraft.pts.push([Math.round(ll.lat * 1e6) / 1e6, Math.round(ll.lng * 1e6) / 1e6]);
      dirty = true; updateRoadMsg();
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
  // Link cũ "Thử với căn ví dụ" đã thay bằng khung "Thử ngay" (#sampleBox, trySample)
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
    // Link từ trang giới thiệu: /#thu vào thử app (xem video mẫu, dán toạ độ — đăng ký khi xuất video),
    // /#dangky mở đăng ký (giữ cho link quảng cáo/link cũ), /#mua mở bảng giá
    const h = location.hash;
    if (h === '#thu' || h === '#dangky' || h === '#mua' || h === '#khach') history.replaceState(null, '', location.pathname + location.search);
    if (h === '#khach') openLeads('leads');
    if (h === '#dangky' && !account.profile) requireLogin('', 'register');
    else if (h === '#mua') openPricing();
  });
  initTracking();
  const ro = new ResizeObserver(() => layoutCanvas());
  ro.observe($('canvasWrap').parentElement);
  document.querySelectorAll('.stage .lot-bar').forEach(b => ro.observe(b));
  window.addEventListener('resize', layoutCanvas);
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });

  // 28/10: khách đang xem video MẪU vào thẳng bước 1 (chỗ dán toạ độ căn của mình). Từ 24/10 tới 28/10 khách mới
  // bị đưa vào bước 3 (Nội dung) của căn mẫu → rất ít người dán toạ độ (27/10: 62 người xem mẫu, 9 người dán toạ độ).
  showStep(state.pois.length && !state.sample ? 3 : 1, { scroll: false });
  layoutCanvas();
  renderLists();
  if (state.sample) {
    // Ô toạ độ để TRỐNG cho khách dán thẳng (không phải xoá toạ độ căn mẫu trước)
    $('coordInput').value = '';
    $('coordMsg').textContent = 'Video phía trên là video MẪU. Dán toạ độ hoặc link Google Maps căn của anh/chị vào ô này để làm video thật — miễn phí.';
    $('coordMsg').className = 'hint coord-cta';
    $('coordInput').classList.add('coord-hot');
  } else if (!state.scannedAt) {
    $('coordMsg').textContent = 'Toạ độ ví dụ. Dán toạ độ căn nhà của anh/chị để bắt đầu.';
    $('coordMsg').className = 'hint';
  }
  fontsReady().then(() => { dirty = true; });
  rebuild();
  // Căn quét/lưu trước bản 24/10 chưa có đoạn lấp chỗ hở: lấy bổ sung một lần (tuyến đã thử sẽ không gọi lại)
  if (state.roads.length && state.selectedRoads.length) setTimeout(() => fillRoadGaps(), 1500);
  requestAnimationFrame(frame);
  queueRoutes();
  if (state.sample) {
    let fresh = false;
    try { fresh = !!sessionStorage.getItem(SAMPLE_PLAY) || bootFresh; sessionStorage.removeItem(SAMPLE_PLAY); } catch { /* bỏ qua */ }
    // Chờ giọng đọc mẫu (tối đa 4 s) rồi mới phát, để video có lời + phụ đề ngay từ đầu
    const voiceReady = Promise.race([loadSampleVoice(), new Promise(r => setTimeout(r, 4000))]);
    if (fresh && state.pois.length) voiceReady.then(() => autoPlaySample());
    else { const tg = $('sampleTag'); if (tg) tg.hidden = false; }
  }
}

let bootFresh = false;
bootSample().then(ok => { bootFresh = !!ok; }).finally(init);
