// Dựng khung hình phối cảnh nghiêng: ảnh vệ tinh + đường vẽ trên "mặt đất" (canvas phụ), sau đó
// bẻ phối cảnh bằng các dải ngang; ghim, thẻ chữ, chữ 3D đứng vẽ sau cùng lên màn hình.
// Mọi thứ phụ thuộc thời gian t nên cùng một hàm dùng cho xem trước và xuất video từng khung.
import { project, unproject, haversineKm, metersPerPixel, formatKm, fitZoom } from './geo.js';
import { drawIcon } from './icons.js';
import { CATEGORIES, iconOf } from './data.js';

export const BASE_FONT = '"Be Vietnam Pro", "Segoe UI", system-ui, sans-serif';
// Chữ tên xã/phường, tỉnh/thành: Montserrat đậm, to rộng
const NAME_FONT = '"Montserrat", "Be Vietnam Pro", system-ui, sans-serif';
export let FONT = BASE_FONT;
export const MAXZ = 18;
export const FORMATS = {
  v: { LW: 540, LH: 960, label: 'Dọc 9:16', safe: { top: 96, bottom: 176, x: 22 } },
  h: { LW: 960, LH: 540, label: 'Ngang 16:9', safe: { top: 54, bottom: 58, x: 40 } },
  s: { LW: 540, LH: 540, label: 'Vuông 1:1', safe: { top: 60, bottom: 60, x: 24 } },
};
// Hệ số nhịp: số càng LỚN video càng NHANH (thời lượng mỗi cảnh chia cho hệ số).
// 10/2026: trước đây nhãn bị ngược (nhanh = 0.66 lại chậm nhất). Nhanh giờ nhanh hơn mức mặc định cũ một chút.
export const SPEEDS = { nhanh: 1.25, vua: 0.95, cham: 0.75 }; // 23/10: Giang muốn Nhanh nhanh hơn nữa (gần nhịp bản đầu)
export const CAT_COLORS = {
  truong: '#3D8BFF', yte: '#FF4D5E', cho: '#FF9F1C', hanhchinh: '#A78BFA',
  congvien: '#2FBF71', kcn: '#8FA3B8', giaothong: '#1FB8CC', nganhang: '#E9B949',
  khudothi: '#F472B6', congcong: '#14B8A6',
};
const HOUSE = '#FF3B30';
let GOLD = '#FFD166';
// ---------- Phong cách video ----------
// Mỗi kiểu đổi màu nhấn, nền thẻ, font tiêu đề, kiểu chữ tiêu đề, tông bản đồ, cảnh mở đầu và cảnh kết.
export const STYLES = {
  neon: {
    label: 'Neon đêm', desc: 'Chữ 3D, line phát sáng, nổi bật trên TikTok',
    head: BASE_FONT, headW: 800, acc: '#FFD166', accInk: '#1b1405', acc2: '#5EEAF5',
    card: 'rgba(12,16,24,0.9)', ink: '#ffffff', soft: 'rgba(255,255,255,0.82)', mute: 'rgba(255,255,255,0.6)',
    tint: '#9fc4be', dark: 0.12, title: '3d', capBg: 'rgba(0,0,0,0.62)', capInk: '#ffffff',
    road: 'auto', route: 'vang', swatch: ['#0c1513', '#FFD166', '#5EEAF5'],
  },
  sangtrong: {
    label: 'Sang trọng', desc: 'Vàng đồng, chữ có chân, khung điện ảnh — hợp nhà phố, biệt thự',
    head: '"Playfair Display", Georgia, "Times New Roman", serif', headW: 700, acc: '#D8B26A', accInk: '#17120a', acc2: '#F1DFB6',
    card: 'rgba(16,13,10,0.9)', ink: '#F7F1E6', soft: 'rgba(247,241,230,0.8)', mute: 'rgba(247,241,230,0.58)',
    tint: '#c2b8a4', dark: 0.24, title: 'serif', bars: true, outline: true, capBg: 'rgba(16,13,10,0.7)', capInk: '#F7F1E6',
    road: 'vang', route: 'trang', swatch: ['#16120d', '#D8B26A', '#F1DFB6'],
  },
  tretrung: {
    label: 'Trẻ trung', desc: 'Màu hồng – xanh tươi, chữ tròn, hiệu ứng nảy — hợp căn hộ, đất nền',
    head: '"Baloo 2", ' + BASE_FONT, headW: 800, acc: '#FF4FA3', accInk: '#ffffff', acc2: '#FFE14D',
    card: 'rgba(30,14,52,0.9)', ink: '#ffffff', soft: 'rgba(255,255,255,0.85)', mute: 'rgba(255,255,255,0.62)',
    tint: '#b4c8f0', dark: 0.06, title: 'sticker', pop: true, capBg: '#FFE14D', capInk: '#1d1030',
    road: 'xanh', route: 'hong', swatch: ['#1e0e34', '#FF4FA3', '#FFE14D'],
  },
  toigian: {
    label: 'Tối giản', desc: 'Thẻ trắng, chữ mảnh, gọn gàng — hợp khách cao cấp, văn phòng',
    head: BASE_FONT, headW: 300, acc: '#ffffff', accInk: '#11161b', acc2: '#ffffff', light: true, cardAcc: '#11161b', cardAccInk: '#ffffff',
    card: 'rgba(255,255,255,0.95)', ink: '#11161b', soft: 'rgba(17,22,27,0.72)', mute: 'rgba(17,22,27,0.5)',
    tint: '#c4c9c9', dark: 0.2, title: 'thin', capBg: 'rgba(255,255,255,0.92)', capInk: '#11161b',
    road: 'trang', route: 'trang', swatch: ['#f2f3f3', '#11161b', '#9aa3a8'],
  },
};
let ST = STYLES.neon;
let HFONT = BASE_FONT;
const CA = () => ST.cardAcc || GOLD;       // màu nhấn bên trong thẻ
const CAI = () => ST.cardAccInk || ST.accInk;
function useStyle(key) {
  ST = STYLES[key] || STYLES.neon;
  HFONT = ST.head;
  GOLD = ST.acc;
}
const PINK = '#FF2E7E';
const CYAN = '#5EEAF5';
const ROAD = {
  3: { core: '#FF8A1F', glow: '#FF6A00', w: 4.1 }, // 24/10: mảnh hơn ~15% (Giang)
  2: { core: '#FFC93C', glow: '#FFA200', w: 3.6 },
  1: { core: '#FFE59A', glow: '#FFC94D', w: 2.9 },
};
export const LINE_THEMES = {
  auto:  { label: 'Theo cấp đường' },
  vang:  { label: 'Vàng kim',  core: '#FFC93C', glow: '#FFA200' },
  cam:   { label: 'Cam neon',  core: '#FF8A1F', glow: '#FF5A00' },
  xanh:  { label: 'Xanh neon', core: '#5EEAF5', glow: '#00B8FF' },
  hong:  { label: 'Hồng neon', core: '#FF4FA3', glow: '#FF1F7A' },
  la:    { label: 'Xanh lá',   core: '#5BF08A', glow: '#10C255' },
  trang: { label: 'Trắng bạc', core: '#F4F7FA', glow: '#9EC9FF' },
  do:    { label: 'Đỏ',        core: '#FF5A4E', glow: '#FF1E1E' },
  tim:   { label: 'Tím',       core: '#B48CFF', glow: '#7C4DFF' },
};
function mixHex(hex, other, f) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(other.slice(1), 16);
  const ch = (x, y) => Math.round(x + (y - x) * f);
  const r = ch((a >> 16) & 255, (b >> 16) & 255), g = ch((a >> 8) & 255, (b >> 8) & 255), bl = ch(a & 255, b & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}
function roadStyle(scene, level) {
  const base = ROAD[level] || ROAD[1];
  const th = LINE_THEMES[scene.roadTheme];
  if (!th || !th.core) return base;
  return { core: level === 1 ? mixHex(th.core, '#FFFFFF', 0.25) : th.core, glow: th.glow, w: base.w };
}
// Trục đường "điểm nhấn" (khách bấm ★): nổi như ranh TP.HCM nhưng KHÁC MÀU/KIỂU để phân biệt (Giang 24/10):
// xanh điện phát sáng, xung sáng trắng chạy dọc line liên tục (như line neon hôm 23/10), tường sáng xanh dựng đứng.
// 24/10 (Giang báo "có 2 đường line"): KHÔNG còn vẽ line dưới đất + thanh mép tường riêng. Chỉ còn MỘT line sáng
// nâng nổi lên khỏi mặt đất (vẽ trên màn hình), dưới đất chỉ có bóng tối mờ + quầng màu nhạt. Khách chọn màu (`scene.hiTheme`).
export const HI_THEMES = {
  dien:  { label: 'Xanh điện', core: '#6CCBFF', glow: '#1E7BFF' },
  vang:  { label: 'Vàng kim',  core: '#FFD54A', glow: '#FFA200' },
  cam:   { label: 'Cam neon',  core: '#FF9A3D', glow: '#FF5A00' },
  la:    { label: 'Xanh lá',   core: '#6BFF9E', glow: '#10C255' },
  tim:   { label: 'Tím',       core: '#C9A2FF', glow: '#7C4DFF' },
  do:    { label: 'Đỏ',        core: '#FF6A5E', glow: '#FF1E1E' },
  trang: { label: 'Trắng bạc', core: '#FFFFFF', glow: '#9EC9FF' },
  ngoc:  { label: 'Xanh ngọc', core: '#5EF5E0', glow: '#00C2B0' },
};
let HI_ROAD = { ...HI_THEMES.dien, w: 5.4 };
function useHiTheme(key) { HI_ROAD = { ...(HI_THEMES[key] || HI_THEMES.dien), w: 5.4 }; }
function roadStyleOf(scene, r) {
  return r && r.hi ? HI_ROAD : roadStyle(scene, r ? r.level : 1);
}
function routeStyle(scene) {
  const th = LINE_THEMES[scene.routeTheme] || LINE_THEMES.vang;
  const core = th.core || GOLD;
  return { core, glow: th.glow || '#FFB800', done: mixHex(core, '#FFFFFF', 0.45) };
}
export const ATTRIBUTION = 'Bản đồ: Esri, Maxar, HERE, Garmin · Dữ liệu: © OpenStreetMap, Overture Maps';
const NOTE = 'Ranh giới hành chính và đường đi theo OpenStreetMap (tham khảo) · thời gian ô tô ước tính';
const PMAX = 40;
const PITCH = { hub: 18, region: 0, houseTop: 0, house: 30, overview: 40, roads: 40, boundary: 38, poi: 34, summary: 28, outro: 32 };

// Cho phép môi trường thử nghiệm (Node) thay cách tạo canvas phụ
let makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export function setCanvasFactory(fn) { makeCanvas = fn; }

// ---------- Ảnh vệ tinh ----------
// Có khoá ArcGIS Location Platform (biến ARCGIS_KEY trên Cloudflare) thì lấy ảnh qua tài khoản thương mại,
// khoá lỗi hoặc hết hạn thì tự quay về máy chủ ảnh công khai để video không bị trống.
let IMG_TOKEN = '';
let keyedOk = 0, keyedFail = 0;
export function setImageryToken(t) { IMG_TOKEN = String(t || '').trim(); keyedOk = keyedFail = 0; }
const PUBLIC_TILE = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const ESRI = svc => (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/${z}/${y}/${x}`;

// ---------- Nền bản đồ ----------
// src: nguồn ô ảnh; maxz: mức phóng to cao nhất nguồn có; tint/tintA/dark: phủ màu; fx: lọc màu cho rõ nét
export const BASES = {
  // Ảnh vệ tinh Esri có z19 ở hầu hết đô thị VN (ảnh chụp riêng, nét hơn hẳn z18 phóng to); nơi chưa có z19 thì
  // máy chủ trả ô "Map data not yet available" → TileCache nhận ra và lấy ô z18 thay (isPlaceholder)
  vetinh: { label: 'Vệ tinh rõ nét', desc: 'Ảnh thật, màu tươi, sắc nét — mặc định', src: 'img', maxz: 19,
    tint: '#ffffff', tintA: 0, dark: 0, fx: 'saturate(1.28) contrast(1.12) brightness(1.04)', bg: '#3c5a3a' },
  phim: { label: 'Vệ tinh tông phim', desc: 'Tông xanh trầm điện ảnh, chữ và line nổi bật', src: 'img', maxz: 19,
    tint: null, tintA: 0.75, dark: null, fx: 'saturate(1.1) contrast(1.1)', bg: '#22332e' },
  duongpho: { label: 'Bản đồ đường phố', desc: 'Có tên đường, dễ nhìn hướng đi', src: 'street', maxz: 18,
    tint: '#ffffff', tintA: 0, dark: 0, fx: 'saturate(1.1) contrast(1.05)', bg: '#efe9df' },
  toi: { label: 'Bản đồ tối', desc: 'Nền đen sang trọng, line phát sáng rõ nhất', src: 'dark', maxz: 16,
    tint: '#ffffff', tintA: 0, dark: 0, fx: 'none', bg: '#1d1f22' },
  sang: { label: 'Bản đồ sáng', desc: 'Nền xám nhạt tối giản', src: 'light', maxz: 16,
    tint: '#ffffff', tintA: 0, dark: 0, fx: 'none', bg: '#e8e8e6' },
};
const SRC_URL = {
  street: ESRI('World_Street_Map'),
  dark: ESRI('Canvas/World_Dark_Gray_Base'),
  light: ESRI('Canvas/World_Light_Gray_Base'),
};
let BASE = BASES.vetinh;
export function useBase(key) { BASE = BASES[key] || BASES.vetinh; }
const KEYED_TILE = (z, x, y) =>
  `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${encodeURIComponent(IMG_TOKEN)}`;

// Ô "Map data not yet available" của Esri: gần như một màu xám sáng (đo: trung bình ~205, lệch chuẩn ~3 ở 16×16)
let phCanvas = null;
function isPlaceholder(img) {
  try {
    phCanvas ||= Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
    const g = phCanvas.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, 16, 16);
    g.drawImage(img, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let s = 0, s2 = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; s += l; s2 += l * l; }
    const m = s / 256, sd = Math.sqrt(Math.max(0, s2 / 256 - m * m));
    return m > 180 && sd < 7;
  } catch { return false; }
}
export class TileCache {
  constructor(onLoad) {
    this.map = new Map();
    this.queue = [];
    this.active = 0;
    this.max = 12;
    this.onLoad = onLoad;
  }
  key(z, x, y) { return BASE.src + '/' + z + '/' + x + '/' + y; }
  ready(z, x, y) {
    const e = this.map.get(this.key(z, x, y));
    return e && e.ok ? e.img : null;
  }
  request(z, x, y, urgent = false) {
    const k = this.key(z, x, y);
    let e = this.map.get(k);
    if (e) return e.promise;
    e = { ok: false, failed: false, tries: 0 };
    e.promise = new Promise(res => (e.resolve = res));
    this.map.set(k, e);
    const job = { z, x, y, e, src: BASE.src };
    if (urgent) this.queue.push(job); else this.queue.unshift(job);
    this.pump();
    return e.promise;
  }
  pump() {
    while (this.active < this.max && this.queue.length) {
      const job = this.queue.pop();
      this.active++;
      this.load(job).finally(() => { this.active--; this.pump(); });
    }
  }
  load(job) {
    const { z, x, y, e, src } = job;
    return new Promise(done => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      const keyed = src === 'img' && !!IMG_TOKEN && !e.publicOnly;
      img.onload = () => {
        if (keyed) keyedOk++;
        // Ô ảnh vệ tinh z ≥ 19 nơi chưa có ảnh: dùng ô cha (z thấp hơn) — chờ ô cha tải xong mới báo xong
        if (src === 'img' && z >= 19 && isPlaceholder(img)) {
          e.failed = true; e.missing = true;
          this.request(z - 1, x >> 1, y >> 1, true).then(() => e.resolve(false));
          done();
          return;
        }
        e.img = img; e.ok = true; e.resolve(true); this.onLoad?.(); done();
      };
      img.onerror = () => {
        if (keyed) {
          e.publicOnly = true;
          if (++keyedFail >= 6 && !keyedOk) IMG_TOKEN = '';
        }
        e.tries++;
        if (e.tries < 3) setTimeout(() => { this.queue.push(job); this.pump(); }, 400 * e.tries);
        else { e.failed = true; e.resolve(false); }
        done();
      };
      img.src = src !== 'img' ? SRC_URL[src](z, x, y) : keyed ? KEYED_TILE(z, x, y) : PUBLIC_TILE(z, x, y);
    });
  }
}

// ---------- Phối cảnh ----------
// Mặt đất: gốc ở tâm ngắm, x sang phải, y xuống (về phía người xem). Màn hình: LW x LH.
function proj(pitch, LW, LH) {
  const p = Math.max(0, Math.min(PMAX, pitch || 0));
  const th = p * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th), D = 1.7 * LH;
  const Fy = LH * (0.5 + 0.07 * p / PMAX);
  const Ytop = Fy / (c - Fy * s / D);
  const Ybot = (Fy - LH) / (c + (LH - Fy) * s / D);
  return { pitch: p, c, s, D, Fy, Ytop, Ybot, wTop: 1 + Ytop * s / D, LW, LH };
}
function g2s(P, gx, gy) {
  const Y = -gy;
  const w = 1 + Y * P.s / P.D;
  return { x: P.LW / 2 + gx / w, y: P.Fy - Y * P.c / w, w };
}
function s2g(P, sx, sy) {
  const yu = P.Fy - sy;
  const Y = yu / (P.c - yu * P.s / P.D);
  const w = 1 + Y * P.s / P.D;
  return { x: (sx - P.LW / 2) * w, y: -Y, w };
}
function viewOf(cam) {
  const k = Math.pow(2, cam.zoom);
  const c = project(cam.lat, cam.lng, 0);
  return { k, cx: c.x * k, cy: c.y * k, zoom: cam.zoom };
}
const gOf = (v, x0, y0) => ({ x: x0 * v.k - v.cx, y: y0 * v.k - v.cy });
function gLL(v, lat, lng) { const p = project(lat, lng, 0); return gOf(v, p.x, p.y); }

function groundDims(LW, LH) {
  const A = proj(PMAX, LW, LH), B = proj(0, LW, LH);
  const GW = Math.ceil(LW * A.wTop) + 16;
  const top = Math.ceil(Math.max(A.Ytop, B.Ytop)) + 8;
  const bot = Math.ceil(Math.max(-A.Ybot, -B.Ybot)) + 8;
  return { GW, GH: top + bot, GOX: GW / 2, GOY: top };
}
const groundCache = new Map();
function groundCanvas(tl, gs) {
  const key = tl.fmt + ':' + gs.toFixed(3);
  let c = groundCache.get(key);
  if (!c) {
    if (groundCache.size > 3) groundCache.clear();
    c = makeCanvas(Math.ceil(tl.G.GW * gs), Math.ceil(tl.G.GH * gs));
    groundCache.set(key, c);
  }
  return c;
}

// ---------- Ô ảnh ----------
// Xuất video (gs ≥ 1,5 — 1080p): lấy ô ảnh mức cao hơn sớm hơn (+0,4) rồi thu nhỏ khi vẽ → ảnh nét hơn hẳn phóng to
// ô mức thấp (đo 24/10: cảnh tiện ích gần nhà độ sắc nét +70% khi dùng z19 thay z18). Xem trước giữ +0,1 cho nhẹ máy.
function tileZoomFor(zoom, gs) {
  return Math.max(1, Math.min(BASE.maxz || MAXZ, Math.round(zoom + Math.log2(gs) + (gs >= 1.5 ? 0.4 : 0.1))));
}
function tileSpan(cam, rect, gs) {
  const tz = tileZoomFor(cam.zoom, gs);
  const kt = Math.pow(2, cam.zoom - tz);
  const c = project(cam.lat, cam.lng, tz);
  const n = Math.pow(2, tz);
  return {
    tz, kt, c, n,
    x0: Math.floor((c.x + rect.x0 / kt) / 256), x1: Math.floor((c.x + rect.x1 / kt) / 256),
    y0: Math.max(0, Math.floor((c.y + rect.y0 / kt) / 256)), y1: Math.min(n - 1, Math.floor((c.y + rect.y1 / kt) / 256)),
  };
}
function drawTiles(g, cache, cam, rect, gs, request) {
  g.fillStyle = BASE.bg || '#17221e';
  g.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
  const T = tileSpan(cam, rect, gs);
  // Ô ảnh thường bị thu nhỏ khi vẽ (zoom lẻ): làm mượt chất lượng cao để chi tiết không bị nhoè/răng cưa
  g.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
  // Lọc màu cho ảnh tươi, rõ (trình duyệt không hỗ trợ thì bỏ qua)
  const fx = BASE.fx && BASE.fx !== 'none' ? BASE.fx : '';
  if (fx) try { g.filter = fx; } catch { /* bỏ qua */ }
  const ds = 256 * T.kt;
  for (let ty = T.y0; ty <= T.y1; ty++) {
    for (let tx = T.x0; tx <= T.x1; tx++) {
      const wx = ((tx % T.n) + T.n) % T.n;
      const dx = (tx * 256 - T.c.x) * T.kt, dy = (ty * 256 - T.c.y) * T.kt;
      const img = cache.ready(T.tz, wx, ty);
      if (img) { g.drawImage(img, dx, dy, ds + 0.6, ds + 0.6); continue; }
      if (request) cache.request(T.tz, wx, ty, true);
      for (let d = 1; d <= 6; d++) {
        const pz = T.tz - d;
        if (pz < 0) break;
        const px = wx >> d, py = ty >> d;
        const pimg = cache.ready(pz, px, py);
        if (pimg) {
          const sub = 256 / Math.pow(2, d);
          g.drawImage(pimg, (wx - (px << d)) * sub, (ty - (py << d)) * sub, sub, sub, dx, dy, ds + 0.6, ds + 0.6);
          break;
        }
      }
    }
  }
  if (fx) try { g.filter = 'none'; } catch { /* bỏ qua */ }
}

function groundRect(P) {
  return { x0: -P.LW * P.wTop / 2 - 6, x1: P.LW * P.wTop / 2 + 6, y0: -P.Ytop - 6, y1: -P.Ybot + 6 };
}

// Bẻ phối cảnh: mỗi dải ngang trên màn hình lấy một dải mặt đất có độ rộng tương ứng
function warp(ctx, G, P, gs, Gd, scale) {
  const { LW, LH } = P;
  if (P.pitch < 0.25) {
    ctx.drawImage(G, (Gd.GOX - LW / 2) * gs, (Gd.GOY - P.Fy) * gs, LW * gs, LH * gs, 0, 0, LW, LH);
    return;
  }
  const band = Math.max(1, 2.6 / scale);
  for (let sy = 0; sy < LH; sy += band) {
    const sy1 = Math.min(LH, sy + band);
    const a = s2g(P, LW / 2, sy), b = s2g(P, LW / 2, sy1);
    const wm = (a.w + b.w) / 2;
    ctx.drawImage(G,
      (Gd.GOX - LW / 2 * wm) * gs, (Gd.GOY + a.y) * gs, LW * wm * gs, Math.max(0.5, (b.y - a.y) * gs),
      0, sy, LW, sy1 - sy + 0.6);
  }
}

// ---------- Nội suy ----------
const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = t => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
function easeOutBounce(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}
function fadeWin(t, a, b, fin = 0.4, fout = 0.4) {
  if (t < a || t > b) return 0;
  return Math.min(clamp01((t - a) / fin), clamp01((b - t) / fout));
}
function lerpCam(a, b, e) {
  const pa = project(a.lat, a.lng, 0), pb = project(b.lat, b.lng, 0);
  const z = a.zoom + (b.zoom - a.zoom) * e;
  let w = e;
  if (Math.abs(b.zoom - a.zoom) > 0.5) {
    const sa = Math.pow(2, -a.zoom), sb = Math.pow(2, -b.zoom), s = Math.pow(2, -z);
    w = (sa - s) / (sa - sb);
    if (!Number.isFinite(w)) w = e;
  }
  const c = unproject(pa.x + (pb.x - pa.x) * w, pa.y + (pb.y - pa.y) * w, 0);
  return { lat: c.lat, lng: c.lng, zoom: z, pitch: (a.pitch || 0) + ((b.pitch || 0) - (a.pitch || 0)) * e };
}

// ---------- Camera ----------
function anchorCam(lat, lng, zoom, pitch, LW, LH, fx, fy) {
  const P = proj(pitch, LW, LH);
  const g = s2g(P, fx * LW, fy * LH);
  const k = Math.pow(2, zoom);
  const h = project(lat, lng, 0);
  const c = unproject(h.x - g.x / k, h.y - g.y / k, 0);
  return { lat: c.lat, lng: c.lng, zoom, pitch };
}
function fitCam(points, LW, LH, pad, pitch, minZ, maxZ) {
  const flat = fitZoom(points, LW, LH, pad, minZ, maxZ);
  if (!flat) return null;
  let cam = { ...flat, pitch };
  for (let it = 0; it < 5; it++) {
    const P = proj(pitch, LW, LH);
    const v = viewOf(cam);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) {
      const g = gLL(v, p.lat, p.lng);
      const s = g2s(P, g.x, g.y);
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
    }
    const aw = LW - pad.left - pad.right, ah = LH - pad.top - pad.bottom;
    const f = Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0));
    const gm = s2g(P, (x0 + x1) / 2, (y0 + y1) / 2);
    const gt = s2g(P, pad.left + aw / 2, pad.top + ah / 2);
    const c0 = project(cam.lat, cam.lng, 0);
    const c = unproject(c0.x + (gm.x - gt.x) / v.k, c0.y + (gm.y - gt.y) / v.k, 0);
    cam = { lat: c.lat, lng: c.lng, zoom: Math.max(minZ, Math.min(maxZ, cam.zoom + Math.log2(f) * 0.85)), pitch };
  }
  return cam;
}

function prepLine(coords) {
  const n = coords.length;
  const xs = new Float64Array(n), ys = new Float64Array(n), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = project(coords[i][0], coords[i][1], 0);
    xs[i] = p.x; ys[i] = p.y;
    if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  }
  return { xs, ys, cum, len: cum[n - 1] || 0, coords };
}
function nearestOn(c, ways) {
  const kx = 111.32 * Math.cos(c.lat * Math.PI / 180), ky = 110.57;
  let best = null;
  for (const w of ways) {
    for (let i = 1; i < w.length; i++) {
      const ax = (w[i - 1][1] - c.lng) * kx, ay = (w[i - 1][0] - c.lat) * ky;
      const bx = (w[i][1] - c.lng) * kx, by = (w[i][0] - c.lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(px, py);
      if (!best || d < best.d) best = { d, lat: c.lat + py / ky, lng: c.lng + px / kx };
    }
  }
  return best;
}
// Lấy mẫu dọc đường: mỗi điểm có toạ độ, khoảng cách tới điểm gốc và hướng đoạn
function sampleLines(lines, stepKm) {
  const out = [];
  for (const l of lines) {
    const c = l.coords;
    for (let i = 1; i < c.length; i++) {
      const segKm = haversineKm({ lat: c[i - 1][0], lng: c[i - 1][1] }, { lat: c[i][0], lng: c[i][1] });
      const n = Math.max(1, Math.ceil(segKm / stepKm));
      for (let j = 0; j < n; j++) {
        const f = j / n;
        out.push({
          lat: c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f,
          lng: c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f,
          dist: l.dist[i - 1] + (l.dist[i] - l.dist[i - 1]) * f,
          a: c[i - 1], b: c[i],
        });
      }
    }
  }
  return out;
}

// Khoảng cách hiện dần đo DỌC THEO tuyến, tính từ điểm gần `from` nhất trên tuyến đó
// (cộng thêm quãng từ `from` tới điểm ấy), để line chạy ra hai phía liền mạch, không nhảy cóc
function prepReveal(ways, from) {
  const kx = 111.32 * Math.cos(from.lat * Math.PI / 180), ky = 110.57;
  return ways.map(w => {
    const l = prepLine(w);
    const n = w.length;
    const ckm = new Float64Array(n);
    for (let i = 1; i < n; i++) ckm[i] = ckm[i - 1] + haversineKm({ lat: w[i - 1][0], lng: w[i - 1][1] }, { lat: w[i][0], lng: w[i][1] });
    let best = { d: Infinity, s: 0 };
    for (let i = 1; i < n; i++) {
      const ax = (w[i - 1][1] - from.lng) * kx, ay = (w[i - 1][0] - from.lat) * ky;
      const bx = (w[i][1] - from.lng) * kx, by = (w[i][0] - from.lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const d = Math.hypot(ax + dx * t, ay + dy * t);
      if (d < best.d) best = { d, s: ckm[i - 1] + (ckm[i] - ckm[i - 1]) * t };
    }
    if (n === 1) best = { d: haversineKm(from, { lat: w[0][0], lng: w[0][1] }), s: 0 };
    l.dist = Array.from(ckm, c => best.d + Math.abs(c - best.s));
    return l;
  });
}

// ---------- Kịch bản dựng ----------
export function buildTimeline(scene, fmtKey, opts = {}) {
  const F = FORMATS[fmtKey];
  const { LW, LH, safe } = F;
  const H = scene.house;
  const R = scene.radiusKm;
  const sp = SPEEDS[scene.speed] || 1;

  const pois = scene.pois.map(p => {
    const line = p.route ? prepLine(p.route.coords) : prepLine([[H.lat, H.lng], [p.lat, p.lng]]);
    return { ...p, line, approx: !p.route, distKm: p.route ? p.route.km : p.km };
  });
  const roads = scene.roads.map(g => {
    const P = nearestOn(H, g.ways) || { lat: H.lat, lng: H.lng, d: g.nearKm };
    const lines = prepReveal(g.ways, P);
    const maxD = Math.max(0.5, ...lines.map(l => Math.max(...l.dist)));
    const samples = sampleLines(lines, 0.06);
    // Vẽ HẾT tuyến đã có dữ liệu (trước đây dừng ở bán kính ×1,4 + 1 km nên tuyến dài bị cụt)
    return { ...g, P, nearKm: P.d ?? g.nearKm, lines, samples, rrMax: maxD };
  });
  let boundary = null;
  if (scene.boundary && scene.boundary.ways?.length) {
    const b = scene.boundary;
    const lines = prepReveal(b.ways, b.P);
    const maxD = Math.max(0.5, ...lines.map(l => Math.max(...l.dist)));
    const kx = 111.32 * Math.cos(H.lat * Math.PI / 180), ky = 110.57;
    let nx = (b.P.lng - H.lng) * kx, ny = (b.P.lat - H.lat) * ky;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const off = Math.max(0.5, Math.min(1.6, nl * 0.8));
    const across = { lat: b.P.lat + ny * off / ky, lng: b.P.lng + nx * off / kx };
    const own = { lat: H.lat - ny * Math.max(0.3, off * 0.7) / ky, lng: H.lng - nx * Math.max(0.3, off * 0.7) / kx };
    const routeLine = b.route ? prepLine(b.route.coords) : prepLine([[H.lat, H.lng], [b.P.lat, b.P.lng]]);
    boundary = { ...b, lines, rrMax: Math.min(maxD, 6), across, own, routeLine, approx: !b.route };
  }

  // Camera từng đoạn
  const camHouseTop = anchorCam(H.lat, H.lng, 16.1, 0, LW, LH, 0.5, 0.56);
  const camRegion = { lat: H.lat, lng: H.lng, zoom: 11.2, pitch: 0 };
  const lot = Array.isArray(scene.lot) && scene.lot.length >= 3 ? scene.lot : null;
  // Có ranh lô đất: cảnh căn nhà bay sát vào lô (khung ôm lô, chừa chỗ chữ), rồi mới lùi ra bán kính
  const camHouse = lot
    ? fitCam(lot, LW, LH, { left: safe.x + 46, right: safe.x + 46, top: safe.top + 130, bottom: safe.bottom + 150 }, PITCH.house, 16.2, 19.8)
    : anchorCam(H.lat, H.lng, 17.3, PITCH.house, LW, LH, 0.5, fmtKey === 'v' ? 0.58 : 0.6); // không có lô: vẫn sát căn nhà
  const dLat = R / 111.32, dLng = R / (111.32 * Math.cos(H.lat * Math.PI / 180));
  const ringPts = [
    { lat: H.lat + dLat, lng: H.lng }, { lat: H.lat - dLat, lng: H.lng },
    { lat: H.lat, lng: H.lng + dLng }, { lat: H.lat, lng: H.lng - dLng },
  ];
  const padStd = { left: safe.x + 16, right: safe.x + 16, top: safe.top + 40, bottom: safe.bottom + 20 };
  const camOverview = fitCam(ringPts, LW, LH, padStd, PITCH.overview, 8.5, 15.5);
  const roadPts = [H];
  // Trục đường xa (cao tốc tìm thêm ngoài bán kính, hoặc cách nhà > 2,5 km) có khung máy riêng,
  // để các trục gần nhà vẫn được quay gần, không bị lùi xa theo cao tốc
  const isFar = r => r.far || r.nearKm > Math.max(2.5, R * 0.8);
  for (const r of roads) {
    if (isFar(r)) continue;
    roadPts.push(r.P);
    const near = r.samples.filter(q => q.dist <= 1.3);
    const stepN = Math.max(1, Math.floor(near.length / 10));
    for (let i = 0; i < near.length; i += stepN) roadPts.push(near[i]);
  }
  const roadPad = { left: safe.x + 30, right: safe.x + 30, top: safe.top + 90, bottom: safe.bottom + 40 };
  const camRoads = roads.length
    ? fitCam(roadPts, LW, LH, roadPad, PITCH.roads, Math.max(11.5, camOverview.zoom), 14.8)
    : null;
  for (const r of roads) {
    if (!isFar(r)) continue;
    const near = r.samples.filter(q => q.dist <= 1.5);
    const pts = [H, r.P];
    for (let i = 0; i < near.length; i += Math.max(1, Math.floor(near.length / 10))) pts.push(near[i]);
    r.cam = fitCam(pts, LW, LH, roadPad, PITCH.roads, 8, 14.8);
  }
  // 24/10 tối (Giang: tiết tấu cảnh cũ còn chậm): trục gần nhà cũng có khung máy riêng (trước đây mọi trục gần dùng chung
  // 1 khung camRoads nên máy gần như đứng yên ~10 s). Khung = nhà + đoạn trục gần nhà, cận hơn, góc nghiêng xen kẽ.
  roads.forEach((r, i) => {
    if (r.cam) return;
    const near = r.samples.filter(q => q.dist <= r.nearKm + 1.1);
    const pts = [H, r.P];
    for (let j = 0; j < near.length; j += Math.max(1, Math.floor(near.length / 12))) pts.push(near[j]);
    r.cam = fitCam(pts, LW, LH, roadPad, i % 2 ? 48 : 38, 11.5, 15.4);
  });
  const cardH = 104;
  const camBoundary = boundary
    ? fitCam([H, boundary.P, boundary.across, boundary.own], LW, LH,
      fmtKey === 'h'
        ? { left: safe.x + 30, right: safe.x + 30, top: safe.top + 70, bottom: safe.bottom + cardH + 20 }
        : { left: safe.x + 40, right: safe.x + 40, top: safe.top + 90, bottom: safe.bottom + cardH + 40 },
      PITCH.boundary, 11, 15.8)
    : null;
  const summaryRows = Math.min(6, pois.length + (boundary ? 1 : 0));
  const panelH = 58 + summaryRows * 34;
  const sumPad = fmtKey === 'h'
    ? { left: safe.x + 40, right: 384 + safe.x + 30, top: safe.top + 40, bottom: safe.bottom + 30 }
    : { left: safe.x + 34, right: safe.x + 34, top: safe.top + 60, bottom: safe.bottom + panelH + 30 };
  const camSummary = (pois.length || boundary)
    ? fitCam([H, ...pois, ...(boundary ? [boundary.P] : [])], LW, LH, sumPad, PITCH.summary, 9, 15.4)
    : camOverview;
  const camEnd = anchorCam(H.lat, H.lng, 15.6, PITCH.outro, LW, LH, 0.5, fmtKey === 'v' ? 0.56 : 0.58);

  // Cảnh mở đầu "móc" người xem: giá + điểm mạnh nhất của vị trí (ảnh nhà làm nền nếu có), rồi mới bay vào bản đồ
  const hook = makeHook(scene, roads, pois);
  // 24/10 (khách góp ý mở đầu chậm, xem 1–2 s đã chán): thẻ giá KHÔNG còn đứng yên 2,7 s trước khi bay.
  // Máy bay vào ngay từ giây 0 (vẫn trọn 5 s êm như Giang chốt 23/10), thẻ giá hiện đè lên đường bay trong HOOK_LEN giây.
  const HOOK_LEN = hook ? 2.2 : 0;
  const raw = [];
  // Trình tự mở đầu (yêu cầu của Giang, 10/2026):
  // 1) intro: trung cảnh ghim bất động sản ("Đây là vị trí … thuộc phường …"), giữ 0,5–1 s, xã/phường sáng lên
  // 2) province: lùi ra vẽ nổi cả tỉnh/thành phố, đọc tên, ghim bất động sản vẫn hiện
  // 3) house: bay về cận cảnh, máy lượn vòng quanh bất động sản, đọc thông tin (diện tích, thổ cư, đường trước nhà…)
  // 4) overview…: ra bán kính như cũ. Không có ranh hành chính thì bỏ qua bước 2.
  const AREA = scene.adminArea && scene.adminArea.ward && scene.adminArea.ward.rings && scene.adminArea.ward.rings.length ? scene.adminArea : null;
  const ringPtsOf = (rings, n = 80) => {
    const pts = [];
    for (const r of rings) for (let i = 0; i < r.length; i += Math.max(1, Math.floor(r.length / n))) pts.push({ lat: r[i][0], lng: r[i][1] });
    return pts;
  };
  // Trung cảnh: thấy căn nhà và một phần xã/phường xung quanh
  const camMid = anchorCam(H.lat, H.lng, 15.2, 24, LW, LH, 0.5, fmtKey === 'v' ? 0.56 : 0.58);
  let camProv = null;
  if (AREA && AREA.province && AREA.province.rings && AREA.province.rings.length) {
    camProv = fitCam([...ringPtsOf(AREA.province.rings), H], LW, LH,
      { left: safe.x + 20, right: safe.x + 20, top: safe.top + 120, bottom: safe.bottom + 110 }, 14, 6, 12.5);
  }
  // Bay vào ÊM như bản cũ (Giang chốt 23/10 tối): hạ từ trên cao xuống trọn 5 giây, không nảy;
  // xong mới giữ ~1 s cho xã/phường sáng lên. (Bản trước bay chỉ ~2,8 s nên trông giật.)
  const INTRO_FLY = 5.0, INTRO_REST = AREA ? 1.0 : 0.4;
  raw.push({ type: 'intro', d: INTRO_FLY + INTRO_REST, hold: 0, hookLen: HOOK_LEN, to: camMid, move: INTRO_FLY / (INTRO_FLY + INTRO_REST), drift: 0.02, vkey: 'intro' });
  if (camProv) raw.push({ type: 'province', d: 4.4, to: camProv, move: 0.75, drift: 0.015, vkey: 'province' });
  // Có lô đất / đường quanh nhà: giữ cảnh cận lâu hơn cho khách nhìn kỹ rồi mới lùi ra bán kính
  const hasStreets = !!(scene.streets && scene.streets.lines && scene.streets.lines.length);
  raw.push({ type: 'house', d: lot ? 7.4 : 6.0, to: camHouse, move: camProv ? 0.5 : 0.6, drift: 0.02, orbit: true, vkey: 'house' });
  // Video thực tế căn nhà (khách quay, không MC): mỗi đoạn một cảnh ~2,8 s lồng vào giữa các cảnh bản đồ.
  // Thứ tự chèn theo số đoạn: sau cảnh căn nhà → giữa các tiện ích → trước cảnh tổng kết → trước cảnh kết.
  const clips = (scene.clips || []).filter(c => c && c.el && c.dur > 0.3).slice(0, CLIP_MAX);
  const CLIP_SLOTS = [[], ['house'], ['house', 'sum'], ['house', 'mid', 'sum'], ['house', 'house', 'mid', 'sum'], ['house', 'house', 'mid', 'sum', 'end']][clips.length];
  let clipNext = 0;
  const pushClips = slot => {
    while (clipNext < clips.length && CLIP_SLOTS[clipNext] === slot) {
      raw.push({ type: 'clip', d: CLIP_D, clip: clipNext, to: raw[raw.length - 1].to, move: 1, vkey: 'clip' + clipNext });
      clipNext++;
    }
  };
  pushClips('house');
  raw.push({ type: 'overview', d: lot ? 3.9 : 3.3, to: camOverview, move: lot ? 0.75 : 0.65, push: 0.22, side: 1, vkey: 'overview' });
  // Kết nối vùng (24/10): máy lùi ra cấp vùng, đường đi thật tới từng điểm mốc lớn (trung tâm, sân bay, cảng, ga) lần lượt
  // chạy ra kèm thẻ "km · phút"; rồi cảnh hạ tầng đang thi công gần nhà (nét đứt vàng cam, chạy ra từ điểm gần nhà nhất).
  const RG = scene.region || null;
  const anchors = (RG?.anchors || []).map(a => ({ ...a, line: prepLine(a.coords && a.coords.length > 1 ? a.coords : [[H.lat, H.lng], [a.lat, a.lng]]) }));
  if (anchors.length) {
    const pts = [H];
    for (const a of anchors) {
      pts.push(a);
      const L = a.line;
      for (let j = 0; j < L.xs.length; j += Math.max(1, Math.floor(L.xs.length / 16))) pts.push(unproject(L.xs[j], L.ys[j], 0));
    }
    const camHub = fitCam(pts, LW, LH, { left: safe.x + 64, right: safe.x + 64, top: safe.top + 120, bottom: safe.bottom + 96 }, PITCH.hub, 6, 13.4);
    // 24/10 tối (Giang: góc máy xa, đứng yên lâu): mỗi điểm mốc một cú máy riêng — bay vòng cung từ khung trước, bám theo
    // đầu line đang chạy, hạ góc nghiêng 44° và đáp CẬN điểm mốc, rồi trôi/lia nhẹ; cuối cùng lùi ra toàn cảnh vùng.
    if (camHub) {
      const shots = [], W_HUB = 1, W_REC = 1.15, tw = anchors.length * W_HUB + W_REC;
      anchors.forEach((a, i) => {
        const L = a.line, near = [a];
        for (let j = 0; j < L.xs.length; j++) if (L.cum[j] >= 0.7 * L.len) near.push(unproject(L.xs[j], L.ys[j], 0));
        const cam = fitCam(near, LW, LH, { left: safe.x + 80, right: safe.x + 80, top: safe.top + 170, bottom: safe.bottom + 150 }, 44, 9.5, 14.6) || camHub;
        shots.push({ s: (i * W_HUB) / tw, e: ((i + 1) * W_HUB) / tw, cam, move: 0.62, anchor: i, line: L, side: i % 2 ? 1 : -1 });
      });
      shots.push({ s: (anchors.length * W_HUB) / tw, e: 1, cam: { ...camHub, pitch: 26 }, move: 0.55, recap: true, side: 1 });
      raw.push({ type: 'region', d: 2.3 * anchors.length + 2.6, to: shots[shots.length - 1].cam, shots, vkey: 'region', n: anchors.length });
    }
  }
  const infra = (RG?.infra || []).map(r => {
    const lines = prepReveal(r.ways, r.P);
    return { ...r, lines, rrMax: Math.max(0.5, ...lines.map(l => Math.max(...l.dist))), samples: sampleLines(lines, 0.2) };
  });
  if (infra.length) {
    const pts = [H];
    for (const r of infra) {
      pts.push(r.P);
      const near = r.samples.filter(q => q.dist <= r.nearKm + 3);
      for (let i = 0; i < near.length; i += Math.max(1, Math.floor(near.length / 12))) pts.push(near[i]);
    }
    const camInfra = fitCam(pts, LW, LH, { left: safe.x + 50, right: safe.x + 50, top: safe.top + 130, bottom: safe.bottom + 120 }, PITCH.roads, 8, 14.6);
    // Mỗi tuyến: đáp cận điểm gần nhà nhất (nghiêng 46°), rồi LIA DỌC TUYẾN ~2 km theo hướng line đang chạy; cuối: toàn cảnh
    if (camInfra) {
      const shots = [], W_A = 0.55, W_B = 0.6, W_REC = 0.9, tw = infra.length * (W_A + W_B) + W_REC;
      let acc = 0;
      infra.forEach((r, i) => {
        const near = r.samples.filter(q => q.dist <= r.nearKm + 0.9);
        const camA = fitCam([r.P, ...near.filter((_, j) => j % 3 === 0)], LW, LH, { left: safe.x + 70, right: safe.x + 70, top: safe.top + 170, bottom: safe.bottom + 150 }, 46, 11, 14.8) || camInfra;
        const tgt = r.nearKm + Math.min(2.4, Math.max(0.6, (r.rrMax - r.nearKm) * 0.5));
        let Q = r.P, best = Infinity;
        for (const q of r.samples) { const dd = Math.abs(q.dist - tgt); if (dd < best) { best = dd; Q = q; } }
        const camB = anchorCam(Q.lat, Q.lng, Math.min(15, camA.zoom + 0.2), 50, LW, LH, 0.5, 0.56);
        r.rB = Math.min(r.rrMax, tgt + 0.8);
        shots.push({ s: acc / tw, e: (acc + W_A) / tw, cam: camA, move: 0.75, infra: i, part: 'a', side: i % 2 ? 1 : -1 });
        acc += W_A;
        shots.push({ s: acc / tw, e: (acc + W_B) / tw, cam: camB, move: 1, infra: i, part: 'b', slide: true, side: 0 });
        acc += W_B;
      });
      shots.push({ s: acc / tw, e: 1, cam: camInfra, move: 0.6, recap: true, side: 1 });
      raw.push({ type: 'infra', d: 2.6 * infra.length + 2.2, to: camInfra, shots, vkey: 'infra', n: infra.length });
    }
  }
  // Vùng lái xe 5 – 10 – 15 phút (ArcGIS): sau cảnh bán kính, máy ôm trọn vùng 15 phút, 3 vùng lần lượt lan ra từ nhà
  const ISO = scene.iso && scene.iso.areas && scene.iso.areas.length ? scene.iso : null;
  if (ISO) {
    const big = ISO.areas[ISO.areas.length - 1];
    const camIso = fitCam([H, ...ringPtsOf(big.rings, 140)], LW, LH,
      { left: safe.x + 24, right: safe.x + 24, top: safe.top + 96, bottom: safe.bottom + 70 }, PITCH.boundary, 9, 16);
    if (camIso) raw.push({ type: 'iso', d: 5.0, to: camIso, move: 0.5, push: 0.22, side: 1, vkey: 'iso' });
  }
  roads.forEach((r, i) => raw.push({ type: 'road', d: 3.2 + (r.hi ? 0.9 : 0), to: r.cam || camRoads, move: 0.55, push: 0.3, side: i % 2 ? 1 : -1, arc: 1.4, road: i, vkey: 'road:' + r.id }));
  if (boundary) raw.push({ type: 'boundary', d: 7.0, to: camBoundary, move: 0.42, push: 0.3, side: -1, arc: 1.6, vkey: 'boundary' });
  // Chế độ "Quét vòng tròn": một khung cố định thấy cả vòng bán kính và mọi tiện ích, line lần lượt chạy ra rồi giữ lại
  // 2 kiểu hiện tiện ích:
  // - lanluot: bay tới từng tiện ích, line đường đi chạy ra (mặc định)
  // - radar:   quét vòng tròn, KHÔNG line; máy quay đi vòng quanh nhà theo hướng các tiện ích, zoom gần,
  //            mỗi tiện ích một nhãn chú thích (tên + km + phút) hiện lần lượt
  // (kiểu cũ 'cungluc', 'tiaxa' tự chuyển sang 'radar')
  const flow = ['cungluc', 'tiaxa'].includes(scene.flow) ? 'radar' : scene.flow;
  const radar = flow === 'radar' && pois.length > 0;
  const spokes = false;
  if (radar) {
    const brg = p => (Math.atan2((p.lng - H.lng) * Math.cos(H.lat * Math.PI / 180), p.lat - H.lat) + Math.PI * 2) % (Math.PI * 2);
    pois.sort((a, b) => brg(a) - brg(b));
    // Nhãn đặt hướng ra ngoài so với căn nhà, cố định suốt video (không lật qua lại)
    for (const p of pois) p.labDir = { x: p.lng >= H.lng ? 1 : -1, y: p.lat >= H.lat ? -1 : 1 };
  }
  const farKm = radar ? Math.max(0.35, ...pois.map(p => haversineKm(H, p))) * 1.12 : 0;
  const fLat = farKm / 111.32, fLng = farKm / (111.32 * Math.cos(H.lat * Math.PI / 180));
  const camAll = radar
    ? fitCam([H, ...pois, { lat: H.lat + fLat, lng: H.lng }, { lat: H.lat - fLat, lng: H.lng }, { lat: H.lat, lng: H.lng + fLng }, { lat: H.lat, lng: H.lng - fLng }], LW, LH,
      { left: safe.x + 40, right: safe.x + 40, top: safe.top + 80, bottom: safe.bottom + 70 }, PITCH.summary, 9, 16)
    : null;
  if (radar) {
    raw.push({ type: 'radar', d: 3.2, to: camAll, move: 0.9, drift: 0.01, vkey: 'radar' });
    // Mỗi tiện ích: khung ôm sát nhà + tiện ích (zoom gần), di chuyển êm suốt cả cảnh, lần lượt vòng quanh nhà
    pois.forEach((p, i) => {
      const cam = fitCam([H, p], LW, LH,
        { left: safe.x + 70, right: safe.x + 70, top: safe.top + 120, bottom: safe.bottom + 110 }, PITCH.poi, 12, 17.6);
      raw.push({ type: 'poi', d: 3.4, to: cam, move: 1, drift: 0.02, poi: i, vkey: 'poi:' + p.id, radar: true });
      if (i === Math.ceil(pois.length / 2) - 1 && pois.length >= 2) pushClips('mid');
    });
  }
  if (!radar && !spokes) pois.forEach((p, i) => {
    const pts = [H, p];
    const L = p.line;
    for (let j = 0; j < L.xs.length; j += Math.max(1, Math.floor(L.xs.length / 24))) pts.push(unproject(L.xs[j], L.ys[j], 0));
    // 24/10 (Giang): tiện ích cách nhà vài trăm mét thì máy phải zoom SÁT lại (trước đây trần zoom 16 nên điểm gần
    // trông nhỏ xíu giữa khung rộng ~1 km). Nay khung ôm sát nhà + tiện ích + đường đi; xa bao nhiêu thì lùi ra bấy nhiêu.
    const cam = fitCam(pts, LW, LH,
      { left: safe.x + 56, right: safe.x + 56, top: safe.top + 110, bottom: safe.bottom + 60 }, PITCH.poi, 11, 17.6);
    raw.push({ type: 'poi', d: 3.2, to: cam, move: 0.55, push: 0.28, side: i % 2 ? 1 : -1, arc: 1.6, poi: i, vkey: 'poi:' + p.id });
    if (i === Math.ceil(pois.length / 2) - 1 && pois.length >= 2) pushClips('mid');
  });
  // Không đủ tiện ích để chèn giữa: dời đoạn "giữa" xuống trước cảnh tổng kết
  while (clipNext < clips.length && CLIP_SLOTS[clipNext] === 'mid') CLIP_SLOTS[clipNext] = 'sum';
  pushClips('sum');
  if (pois.length || boundary) raw.push({ type: 'summary', d: 5.0, to: camSummary, move: 0.45, push: 0.2, side: 1, arc: 1.2, vkey: 'summary' });
  // Ảnh thực tế căn nhà: phủ kín khung, camera bản đồ phía dưới bay dần về căn nhà để nối vào cảnh kết
  const photos = (scene.photos || []).filter(im => im && im.width && im.height).slice(0, 6);
  if (photos.length) raw.push({ type: 'photos', d: Math.max(3.2, photos.length * 2.4 + 0.6), to: camEnd, move: 1, vkey: 'photos' });
  for (let i = clipNext; i < clips.length; i++) CLIP_SLOTS[i] = 'end';
  pushClips('end');
  raw.push({ type: 'outro', d: 3.4, to: camEnd, move: 0.6, push: 0.3, side: -1, arc: 1.2, vkey: 'outro' });

  let total = raw.reduce((s, p) => s + p.d, 0) / sp;
  let k = 1 / sp;
  // Có giọng AI theo từng đoạn: mỗi đoạn kéo dài đủ cho câu đọc của nó
  const vd = opts.voice || null;
  if (vd) {
    for (const p of raw) {
      const dur = vd[p.vkey];
      if (!dur) continue;
      const lead = p.type === 'intro' ? 0.5 : 0.3;
      // Khoảng nghỉ sau mỗi câu theo nhịp: Nhanh nối câu sát hơn (trước đây cố định 0,45 s nên chọn Nhanh vẫn thấy chậm)
      const gap = sp >= 1.1 ? 0.15 : sp >= 0.9 ? 0.3 : 0.45;
      p.d = Math.max(p.d, (dur + lead + gap) * sp);
    }
    total = raw.reduce((s, p) => s + p.d, 0) / sp;
  }
  if (!vd && opts.fitDuration && opts.fitDuration > 0) {
    const f = Math.max(0.55, Math.min(3, opts.fitDuration / total));
    k *= f;
    total *= f;
  }
  let t = 0;
  let prev = camRegion;
  const phases = raw.map(p => {
    const ph = { ...p, t0: t, t1: t + p.d * k, from: prev, hold: (p.hold || 0) * k, hookLen: (p.hookLen || 0) * k };
    t = ph.t1;
    prev = camAtPhase(ph, ph.t1);
    return ph;
  });
  const captions = opts.captions && vd ? buildCaptions(phases, opts.captions, vd, fmtKey) : [];
  const first = type => phases.find(p => p.type === type);
  const tl = {
    fmt: fmtKey, LW, LH, safe, duration: t, phases, scene, panelH,
    G: groundDims(LW, LH),
    intro: first('intro'), house: first('house'), overview: first('overview'), boundaryPh: first('boundary'),
    summary: first('summary'), outro: first('outro'), photosPh: first('photos'), isoPh: first('iso'), regionPh: first('region'), infraPh: first('infra'), anchors, infra, photos, radarPh: first('radar'), provPh: first('province'), flow: radar ? 'radar' : 'lanluot',
    roadPhases: phases.filter(p => p.type === 'road'), poiPhases: phases.filter(p => p.type === 'poi'),
    clips, clipWins: phases.filter(p => p.type === 'clip').map(p => ({ clip: p.clip, t0: p.t0, t1: p.t1 })),
    pois, roads, boundary, captions, hook, lot, lotArea: lot ? lotAreaM2(lot) : 0,
  };
  tl.hookEnd = hook ? tl.intro.t0 + tl.intro.hookLen : 0;
  // Có video thực tế: đoạn đầu làm nền chuyển động cho thẻ giá mở đầu (ưu tiên hơn ảnh tĩnh)
  if (clips.length && hook) tl.clipWins.unshift({ clip: 0, t0: tl.intro.t0, t1: tl.hookEnd + 0.4, hook: true });
  tl.roadsEnd = tl.roadPhases.length ? tl.roadPhases[tl.roadPhases.length - 1].t1 : tl.overview.t1;
  tl.roadLabels = camRoads ? placeRoadLabels(tl, camRoads, gi => !tl.roads[gi].cam) : [];
  tl.roads.forEach((r, gi) => { if (r.cam) tl.roadLabels.push(...placeRoadLabels(tl, r.cam, g => g === gi)); });
  // Tuyến điểm nhấn ★: thêm một chữ đặt theo khung cảnh tổng kết, để cảnh tổng kết vẫn thấy tên tuyến
  if (tl.summary && tl.roads.some(r => r.hi)) tl.roadLabels.push(...placeRoadLabels(tl, tl.summary.to, g => !!tl.roads[g].hi, { x: 0, y: LH * 0.5, w: LW, h: LH * 0.5 }).map(L => ({ ...L, sum: true })));
  return tl;
}

function makeHook(scene, roads, pois) {
  const info = infoData(scene);
  const byNear = roads.slice().sort((a, b) => a.nearKm - b.nearKm);
  const major = byNear.find(r => r.level >= 2 && r.nearKm <= 3) || byNear[0];
  let fact = '';
  if (major && major.nearKm <= 5) fact = major.nearKm < 0.12 ? `Mặt tiền ${major.label}` : `Cách ${major.label} ${formatKm(major.nearKm)}`;
  else if (pois.length) {
    const p = pois.slice().sort((a, b) => a.distKm - b.distKm)[0];
    fact = `Gần ${p.name} · ${formatKm(p.distKm, p.approx, '≈ ')}`;
  }
  const big = info?.price || '';
  if (!big && !fact) return null;
  return {
    kicker: [scene.label, scene.commune || scene.provinceShort].filter(Boolean).join(' · '),
    big: big || scene.label || 'VỊ TRÍ ĐẸP', isPrice: !!big,
    fact, det: info ? info.det.slice(0, 2).join('  ·  ') : '',
  };
}

// ---------- Phụ đề ----------
// Chia lời đọc của từng cảnh thành cụm ngắn, chia thời gian theo độ dài đọc của từng cụm.
const CAP_CHARS = { v: 32, s: 30, h: 56 };
function splitCaption(text, max) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out = [];
  let cur = [];
  const len = a => a.join(' ').length;
  for (const w of words) {
    if (cur.length && len([...cur, w]) > max) { out.push(cur.join(' ')); cur = []; }
    cur.push(w);
    // Ngắt ở dấu câu khi cụm đã đủ dài để đọc thoải mái
    if (/[.!?;:]$/.test(w) || (/,$/.test(w) && len(cur) >= max * 0.45)) { out.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) out.push(cur.join(' '));
  // Cụm quá ngắn (vd "TP.HCM.") thì ghép vào cụm bên cạnh cho đỡ nháy chữ
  for (let i = 0; i < out.length; i++) {
    if (out.length < 2 || out[i].length >= 12) continue;
    if (i > 0 && out[i - 1].length + out[i].length < max * 1.2) { out[i - 1] += ' ' + out[i]; out.splice(i, 1); i--; }
    else if (i + 1 < out.length && out[i].length + out[i + 1].length < max * 1.2) { out[i + 1] = out[i] + ' ' + out[i + 1]; out.splice(i, 1); i--; }
  }
  return out;
}
function capWeight(s) {
  const digits = (s.match(/\d/g) || []).length;
  const stop = /[.!?…]$/.test(s) ? 5 : /[,;:]$/.test(s) ? 3 : 0;
  return Math.max(4, s.length + digits * 2.5 + stop);
}
export function buildCaptions(phases, texts, voice, fmtKey) {
  const out = [];
  const max = CAP_CHARS[fmtKey] || 40;
  for (const ph of phases) {
    const text = ph.vkey && texts[ph.vkey];
    const dur = ph.vkey && voice[ph.vkey];
    if (!text || !dur) continue;
    const start = ph.t0 + (ph.type === 'intro' ? 0.5 : 0.3);
    const parts = splitCaption(text, max);
    const w = parts.map(capWeight);
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    let c = start;
    parts.forEach((txt, i) => {
      const d = dur * w[i] / tot;
      out.push({ t0: c, t1: i === parts.length - 1 ? c + d + 0.25 : c + d, text: txt });
      c += d;
    });
  }
  return out;
}

// Điểm trên đường (toạ độ thế giới zoom 0) tại quãng s tính từ đầu
function pointAtLen(L, sLen) {
  const n = L.xs.length;
  if (n < 2 || sLen <= 0) return { x: L.xs[0], y: L.ys[0] };
  if (sLen >= L.len) return { x: L.xs[n - 1], y: L.ys[n - 1] };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.cum[m] < sLen) lo = m; else hi = m; }
  const f = (sLen - L.cum[lo]) / Math.max(1e-12, L.cum[hi] - L.cum[lo]);
  return { x: L.xs[lo] + (L.xs[hi] - L.xs[lo]) * f, y: L.ys[lo] + (L.ys[hi] - L.ys[lo]) * f };
}
// Cảnh nhiều cú máy (kết nối vùng, hạ tầng): mỗi cú bay từ khung trước tới khung mới. Hai khung xa nhau thì bay vòng cung
// (lùi ra giữa chặng rồi hạ xuống), giữa chặng bám theo đầu line đang chạy; tới nơi thì đẩy máy vào chậm + lia ngang nhẹ.
// Khung máy lúc kết thúc một cú (đã cộng phần đẩy vào + lia ngang) — điểm bắt đầu của cú sau, để không giật khi đổi cú
function shotEnd(sh) {
  if (sh._end) return sh._end;
  const c = { ...sh.cam };
  if (!sh.slide) {
    c.zoom += 0.32;
    if (sh.side) c.lng += sh.side * 42 * metersPerPixel(c.lat, c.zoom) / (111320 * Math.cos(c.lat * Math.PI / 180));
  }
  return (sh._end = c);
}
function camShots(ph, t) {
  const d = ph.t1 - ph.t0;
  const f = clamp01((t - ph.t0) / d);
  let i = ph.shots.findIndex(sh => f < sh.e);
  if (i < 0) i = ph.shots.length - 1;
  const sh = ph.shots[i];
  const prev = i ? shotEnd(ph.shots[i - 1]) : ph.from;
  const w = clamp01((f - sh.s) / Math.max(1e-6, sh.e - sh.s));
  const e = sh.slide ? smooth(w) : smooth(clamp01(w / sh.move));
  const cam = lerpCam(prev, sh.cam, e);
  if (sh._arc === undefined) {
    const a = project(prev.lat, prev.lng, 0), b = project(sh.cam.lat, sh.cam.lng, 0);
    const dpx = Math.hypot(b.x - a.x, b.y - a.y) * Math.pow(2, Math.min(prev.zoom, sh.cam.zoom));
    sh._arc = sh.slide ? 0 : Math.max(0, Math.min(2.6, Math.log2(dpx / 420)));
  }
  cam.zoom -= sh._arc * Math.sin(Math.PI * e);
  if (sh.line && e > 0 && e < 1) {
    // bám đầu line (cùng nhịp với hubReveal)
    const k = clamp01((w - 0.04) / (sh.move - 0.04));
    const hp = pointAtLen(sh.line, sh.line.len * smooth(k));
    const c = project(cam.lat, cam.lng, 0);
    const bl = 0.5 * Math.sin(Math.PI * e);
    const ll = unproject(c.x + (hp.x - c.x) * bl, c.y + (hp.y - c.y) * bl, 0);
    cam.lat = ll.lat; cam.lng = ll.lng;
  }
  if (!sh.slide) {
    // tới nơi: đẩy máy vào chậm và lia ngang (đổi chiều mỗi cú máy) để khung không đứng yên
    const hold = clamp01((w - sh.move) / Math.max(1e-6, 1 - sh.move));
    const hs = smooth(hold);
    cam.zoom += 0.32 * hs;
    if (sh.side) {
      const mpp = metersPerPixel(cam.lat, cam.zoom);
      cam.lng += sh.side * 42 * hs * mpp / (111320 * Math.cos(cam.lat * Math.PI / 180));
    }
  }
  return cam;
}
function camAtPhase(ph, t) {
  if (ph.shots) return camShots(ph, t);
  const d = ph.t1 - ph.t0;
  const hold = ph.hold || 0;
  const e = smooth(clamp01((t - ph.t0 - hold) / ((d - hold) * (ph.move || 1))));
  const cam = lerpCam(ph.from, ph.to, e);
  if (ph.drift) cam.zoom += ph.drift * Math.max(0, t - ph.t0);
  // Bay vòng cung khi 2 khung xa nhau (lùi lên giữa chặng rồi hạ xuống), giới hạn theo ph.arc
  if (ph.arc) {
    if (ph._arc === undefined) {
      const a = project(ph.from.lat, ph.from.lng, 0), b = project(ph.to.lat, ph.to.lng, 0);
      const dpx = Math.hypot(b.x - a.x, b.y - a.y) * Math.pow(2, Math.min(ph.from.zoom, ph.to.zoom));
      ph._arc = Math.max(0, Math.min(ph.arc, Math.log2(dpx / 520)));
    }
    cam.zoom -= ph._arc * Math.sin(Math.PI * e);
  }
  // Tới nơi: đẩy máy vào chậm + lia ngang nhẹ (đổi chiều theo cảnh) để khung không đứng yên
  if (ph.push) {
    const mv = (d - hold) * (ph.move || 1);
    const hs = smooth(clamp01((t - ph.t0 - hold - mv) / Math.max(1e-6, d - hold - mv)));
    cam.zoom += ph.push * hs;
    if (ph.side) cam.lng += ph.side * 34 * hs * metersPerPixel(cam.lat, cam.zoom) / (111320 * Math.cos(cam.lat * Math.PI / 180));
  }
  // Máy lượn quanh bất động sản: tâm khung đi theo vòng cung nhỏ quanh điểm đích sau khi đã bay tới
  if (ph.orbit) {
    const k = smooth(clamp01((t - ph.t0) / (ph.t1 - ph.t0)));
    const arr = clamp01((t - ph.t0 - (ph.t1 - ph.t0) * (ph.move || 1) * 0.6) / 0.8);
    const ang = -0.9 + k * 1.8;
    const mpp = metersPerPixel(cam.lat, cam.zoom);
    const r = 34 * arr; // px trên màn hình
    cam.lng += Math.sin(ang) * r * mpp / (111320 * Math.cos(cam.lat * Math.PI / 180));
    cam.lat += (Math.cos(ang) - 1) * r * 0.5 * mpp / 110540;
  }
  return cam;
}
export function camAt(tl, t) {
  let ph = tl.phases[tl.phases.length - 1];
  for (const p of tl.phases) if (t < p.t1) { ph = p; break; }
  return breathe(tl, camAtPhase(ph, Math.min(t, ph.t1)), t);
}
// Máy quay không bao giờ đứng yên: chồng lên đường bay chính một nhịp zoom vào/ra và lia trái/phải, lên/xuống
// chậm, liên tục theo thời gian (không giật khi đổi cảnh). Biên độ nhỏ để căn nhà và tiện ích vẫn trong khung.
function breathe(tl, cam, t) {
  const fade = clamp01(t / 1.2) * clamp01((tl.duration - t) / 0.8 + 0.25);
  const z = 0.13 * Math.sin(t * 2 * Math.PI / 9.5) * fade;
  const px = tl.LW * 0.055 * Math.sin(t * 2 * Math.PI / 13 + 0.6) * fade;
  const py = tl.LH * 0.022 * Math.sin(t * 2 * Math.PI / 11 + 1.7) * fade;
  const mpp = metersPerPixel(cam.lat, cam.zoom);
  return {
    ...cam,
    zoom: cam.zoom + z,
    lng: cam.lng + px * mpp / (111320 * Math.cos(cam.lat * Math.PI / 180)),
    lat: cam.lat - py * mpp / 110540,
  };
}

function labelText(g) {
  return (g.label || '').toUpperCase();
}
function roadFontSize(text) {
  return text.length > 24 ? 22 : text.length > 16 ? 27 : 33;
}

// Chọn chỗ đặt chữ 3D cho từng trục đường: trên đường, trong khung, không đè nhau, không đè căn nhà.
// Khung chữ tính theo góc xoay thật; không tìm được chỗ đẹp thì nới dần điều kiện để tuyến nào cũng có tên.
function placeRoadLabels(tl, cam, only = () => true, block = null) {
  const { LW, LH, safe } = tl;
  const P = proj(cam.pitch, LW, LH);
  const v = viewOf(cam);
  const H = tl.scene.house;
  const hg = gLL(v, H.lat, H.lng);
  const hs = g2s(P, hg.x, hg.y);
  const house = { x: hs.x - 34, y: hs.y - 72, w: 68, h: 84 };
  const placed = [house, ...(block ? [block] : [])];
  for (const r of tl.roads) {
    const pg = gLL(v, r.P.lat, r.P.lng), ps = g2s(P, pg.x, pg.y);
    placed.push({ x: (hs.x + ps.x) / 2 - 48, y: (hs.y + ps.y) / 2 - 14, w: 96, h: 28 });
  }
  const hit = (r, list) => list.some(p => r.x < p.x + p.w + 6 && r.x + r.w + 6 > p.x && r.y < p.y + p.h + 6 && r.y + r.h + 6 > p.y);
  const out = [];
  // Tuyến điểm nhấn ★ được chọn chỗ đặt chữ TRƯỚC để chắc chắn có chữ 3D tên đường (Giang 24/10)
  const order = tl.roads.map((g, gi) => gi).sort((a, b) => (tl.roads[b].hi ? 1 : 0) - (tl.roads[a].hi ? 1 : 0));
  order.forEach(gi => {
    const g = tl.roads[gi];
    if (!only(gi)) return;
    let text = labelText(g);
    if (text.length > 22 && text.startsWith('CAO TỐC ')) text = 'CT ' + text.slice(8);
    const target = 0.5 + 0.45 * gi;
    const base = roadFontSize(text);
    const cands = [];
    for (const q of g.samples) {
      if (q.dist > g.rrMax * 0.9 || q.dist < 0.08) continue;
      const gp = gLL(v, q.lat, q.lng);
      const sc = g2s(P, gp.x, gp.y);
      if (sc.x < 0 || sc.x > LW || sc.y < 0 || sc.y > LH) continue;
      const ga = gLL(v, q.a[0], q.a[1]), gb = gLL(v, q.b[0], q.b[1]);
      const sa = g2s(P, ga.x, ga.y), sb = g2s(P, gb.x, gb.y);
      let ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
      cands.push({ q, s: sc, ang, steep: Math.abs(Math.sin(ang)), score: Math.abs(q.dist - target) + Math.abs(Math.sin(ang)) * 0.8 });
    }
    // Chỗ line bị hở (dữ liệu bản đồ thiếu đoạn): ưu tiên đặt chữ tên đường ĐÚNG chỗ hở để che đi (Giang 24/10)
    const ends = [];
    for (const l of g.lines) {
      const n = l.coords.length;
      if (n < 2) continue;
      ends.push({ p: l.coords[0], d: l.dist[0], nb: l.coords[Math.min(n - 1, 1)] });
      ends.push({ p: l.coords[n - 1], d: l.dist[n - 1], nb: l.coords[Math.max(0, n - 2)] });
    }
    const ll = p => ({ lat: p[0], lng: p[1] });
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      const A = ends[i], B = ends[j];
      if (Math.floor(i / 2) === Math.floor(j / 2)) continue; // hai đầu của cùng một đoạn
      const gap = haversineKm(ll(A.p), ll(B.p));
      if (gap < 0.03 || gap > 1.0) continue;
      const d = (A.d + B.d) / 2;
      if (d > g.rrMax * 0.9) continue;
      const mid = { lat: (A.p[0] + B.p[0]) / 2, lng: (A.p[1] + B.p[1]) / 2 };
      const gp = gLL(v, mid.lat, mid.lng);
      const sc = g2s(P, gp.x, gp.y);
      if (sc.x < 0 || sc.x > LW || sc.y < 0 || sc.y > LH) continue;
      const ga = gLL(v, A.p[0], A.p[1]), gb = gLL(v, B.p[0], B.p[1]);
      const sa = g2s(P, ga.x, ga.y), sb = g2s(P, gb.x, gb.y);
      const ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
      // khoảng hở trên màn hình phải đủ ngắn để chữ che được
      if (Math.hypot(sb.x - sa.x, sb.y - sa.y) > base * text.length * 0.9) continue;
      cands.push({ q: { lat: mid.lat, lng: mid.lng, dist: d, a: A.p, b: B.p }, s: sc, ang, steep: Math.abs(Math.sin(ang)), score: -2 + gap, gap: true });
    }
    cands.sort((a, b) => a.score - b.score);
    const rectOf = (c, size) => {
      const pk = 1 / Math.max(0.4, c.s.w || 1); // gần đáy khung, phối cảnh làm chữ to ra trên màn hình
      const w = (text.length * size * 0.68 + 18) * pk, h = size * 1.7 * pk;
      const cs = Math.abs(Math.cos(c.ang)), sn = Math.abs(Math.sin(c.ang));
      const bw = w * cs + h * sn, bh = w * sn + h * cs;
      return { x: c.s.x - bw / 2, y: c.s.y - bh / 2, w: bw, h: bh };
    };
    const inSafe = (r, m) => r.x >= safe.x - m && r.x + r.w <= LW - safe.x + m && r.y >= safe.top + 40 - m && r.y + r.h <= LH - safe.bottom + m;
    let pick = null;
    // Lượt 1: đúng cỡ chữ, trong vùng an toàn, không đè gì. Lượt 2: chữ nhỏ dần. Lượt 3: cho phép đè nhãn khác. Lượt 4: chỉ cần trong khung.
    const passes = [
      { sizes: [base], margin: 0, avoid: placed },
      { sizes: [base * 0.85, base * 0.72], margin: 0, avoid: placed },
      { sizes: [base * 0.72, base * 0.62], margin: 8, avoid: block ? [house, block] : [house] },
      ...(block ? [{ sizes: [base * 0.55, base * 0.48], margin: 30, avoid: [house, block] }] : [{ sizes: [base * 0.62], margin: 40, avoid: [] }]),
      ...(g.hi && !block ? [{ sizes: [base * 0.55], margin: 120, avoid: [] }] : []),
    ];
    // Che chỗ hở trước: thà chữ nhỏ hơn một chút mà nằm đúng chỗ line bị đứt
    const gapC = cands.filter(c => c.gap);
    for (const size of gapC.length ? [base, base * 0.85, base * 0.72, base * 0.62] : []) {
      for (const c of gapC) {
        const r = rectOf(c, size);
        if (!inSafe(r, 10) || hit(r, placed)) continue;
        pick = { c, size, r };
        break;
      }
      if (pick) break;
    }
    for (const ps of pick ? [] : passes) {
      for (const size of ps.sizes) {
        for (const c of cands) {
          const r = rectOf(c, size);
          if (!inSafe(r, ps.margin) || hit(r, ps.avoid)) continue;
          pick = { c, size, r };
          break;
        }
        if (pick) break;
      }
      if (pick) break;
    }
    if (!pick && g.hi && !block && cands.length) pick = { c: cands[0], size: base * 0.55, r: rectOf(cands[0], base * 0.55) };
    if (!pick) return;
    placed.push(pick.r);
    const q = pick.c.q;
    out.push({ road: gi, at: { lat: q.lat, lng: q.lng }, a: q.a, b: q.b, dist: q.dist, text, size: Math.round(pick.size) });
  });
  return out;
}

// Danh sách ô ảnh cần cho cả video (tải trước khi xuất)
export function collectTiles(tl, scale, step = 1 / 10) {
  useBase(tl.scene.base);
  const gs = scale;
  const set = new Map();
  for (let t = 0; t <= tl.duration + 1e-6; t += step) {
    const cam = camAt(tl, t);
    const P = proj(cam.pitch, tl.LW, tl.LH);
    const T = tileSpan(cam, groundRect(P), gs);
    for (let ty = T.y0; ty <= T.y1; ty++) {
      for (let tx = T.x0; tx <= T.x1; tx++) {
        const wx = ((tx % T.n) + T.n) % T.n;
        set.set(T.tz + '/' + wx + '/' + ty, [T.tz, wx, ty]);
      }
    }
  }
  return [...set.values()];
}

// ---------- Vẽ trên mặt đất ----------
function linePath(v, line, upto) {
  const path = new Path2D();
  let head = null;
  if (upto <= 0 || line.xs.length < 2) return { path, head };
  let p = gOf(v, line.xs[0], line.ys[0]);
  path.moveTo(p.x, p.y);
  for (let i = 1; i < line.xs.length; i++) {
    if (line.cum[i] <= upto) {
      p = gOf(v, line.xs[i], line.ys[i]);
      path.lineTo(p.x, p.y);
      head = p;
    } else {
      const seg = line.cum[i] - line.cum[i - 1];
      const f = seg > 0 ? (upto - line.cum[i - 1]) / seg : 0;
      head = gOf(v, line.xs[i - 1] + (line.xs[i] - line.xs[i - 1]) * f, line.ys[i - 1] + (line.ys[i] - line.ys[i - 1]) * f);
      path.lineTo(head.x, head.y);
      break;
    }
  }
  return { path, head };
}

// Đường hiện dần tính từ một điểm gốc (khoảng cách dist[] tới điểm gốc), trả về các đầu đang chạy
function revealPath(v, line, rr, heads) {
  const path = new Path2D();
  const n = line.xs.length;
  let on = false;
  const at = (i, j) => {
    const f = (rr - line.dist[i]) / (line.dist[j] - line.dist[i]);
    return gOf(v, line.xs[i] + (line.xs[j] - line.xs[i]) * f, line.ys[i] + (line.ys[j] - line.ys[i]) * f);
  };
  for (let i = 0; i < n; i++) {
    const inside = line.dist[i] <= rr;
    const p = gOf(v, line.xs[i], line.ys[i]);
    if (inside) {
      if (!on) {
        if (i > 0) { const q = at(i, i - 1); path.moveTo(q.x, q.y); heads.push(q); path.lineTo(p.x, p.y); }
        else path.moveTo(p.x, p.y);
        on = true;
      } else path.lineTo(p.x, p.y);
    } else if (on) {
      const q = at(i - 1, i);
      path.lineTo(q.x, q.y);
      heads.push(q);
      on = false;
    }
  }
  return path;
}

function glowStroke(g, path, core, glow, w, alpha) {
  if (alpha <= 0.01) return;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = glow;
  g.globalAlpha = alpha * 0.1; g.lineWidth = w * 5.2; g.stroke(path);
  g.globalAlpha = alpha * 0.26; g.lineWidth = w * 2.6; g.stroke(path);
  g.strokeStyle = core;
  g.globalAlpha = alpha; g.lineWidth = w; g.stroke(path);
  g.strokeStyle = '#ffffff';
  g.globalAlpha = alpha * 0.7; g.lineWidth = Math.max(0.8, w * 0.3); g.stroke(path);
  g.globalAlpha = 1;
}

function headGlow(g, p, color, r = 15) {
  const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.25, color);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
}

function spacedWidth(ctx, text, sp) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + sp;
  return w - sp;
}
function fillSpaced(ctx, text, x, y, sp) {
  let cx = x - spacedWidth(ctx, text, sp) / 2;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
}
function strokeSpaced(ctx, text, x, y, sp) {
  let cx = x - spacedWidth(ctx, text, sp) / 2;
  for (const ch of text) { ctx.strokeText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
}

// Khối chữ 3D: các lớp đùn theo vector (ex, ey), mặt trên tô chuyển màu, viền mảnh
function text3D(ctx, text, size, opt) {
  const { faceTop, faceBot, side, depth, ex, ey, sp = size * 0.08, glow = null, stroke = 'rgba(0,0,0,0.55)', outline = null } = opt;
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const steps = Math.max(2, Math.round(depth / 0.9));
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  fillSpaced(ctx, text, ex * (depth + 3), ey * (depth + 3), sp);
  ctx.fillStyle = side;
  for (let i = steps; i >= 1; i--) {
    const f = i / steps * depth;
    fillSpaced(ctx, text, ex * f, ey * f, sp);
  }
  if (glow) {
    ctx.save();
    ctx.shadowColor = glow; ctx.shadowBlur = size * 0.55;
    ctx.fillStyle = faceBot;
    fillSpaced(ctx, text, 0, 0, sp);
    ctx.restore();
  }
  // Viền tối dày quanh mặt chữ: tách chữ khỏi line đường cùng màu, đọc rõ trên mọi nền
  if (outline) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size * 0.17);
    ctx.strokeStyle = outline;
    strokeSpaced(ctx, text, 0, 0, sp);
    ctx.restore();
  }
  const gr = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
  gr.addColorStop(0, faceTop);
  gr.addColorStop(1, faceBot);
  ctx.fillStyle = gr;
  fillSpaced(ctx, text, 0, 0, sp);
  ctx.lineWidth = Math.max(0.8, size * 0.035);
  ctx.strokeStyle = stroke;
  strokeSpaced(ctx, text, 0, 0, sp);
}

// ---------- Chữ tên trục đường bóng: vàng kim / trắng bóng / vàng bóng, không viền, vệt sáng lướt qua ----------
// Màu chữ phẳng: trắng hoặc vàng, gần như đặc màu cho rõ (chỉ chuyển nhẹ trên → dưới)
const LABEL_FACES = {
  trang: { stops: [[0, '#FFFFFF'], [1, '#EEF2F6']], side: '#2B323A', edge: 0.95 }, // chữ trắng: viền vệt kính đậm hơn mới thấy
  vang:  { stops: [[0, '#FFE45C'], [1, '#FFC400']], side: '#5A3F00' },
};
LABEL_FACES.vangkim = LABEL_FACES.vang; // dữ liệu cũ đã chọn "Vàng kim" → vàng
let labelCanvas = null, labelFace = null;
// Vẽ khối chữ 3D lên canvas phụ rồi dán ra, để vệt sáng chỉ lướt trên mặt chữ (không loang ra bản đồ)
function glossyText(ctx, text, size, faceKey, depth, ex, ey, sweep, k = 1) {
  const F = LABEL_FACES[faceKey] || LABEL_FACES.vangkim;
  const sp = size * 0.06;
  if (!labelCanvas) labelCanvas = makeCanvas(16, 16);
  const c = labelCanvas;
  let x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.font = `900 ${size}px ${NAME_FONT}`;
  const tw = spacedWidth(x, text, sp);
  const pad = size * 0.9 + depth * 1.5;
  const W = Math.ceil((tw + pad * 2) * k), Hh = Math.ceil((size + pad * 2) * k);
  if (c.width < W || c.height < Hh) { c.width = Math.max(c.width, W); c.height = Math.max(c.height, Hh); x = c.getContext('2d'); }
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, W, Hh);
  x.setTransform(k, 0, 0, k, (tw / 2 + pad) * k, (size / 2 + pad) * k);
  x.font = `900 ${size}px ${NAME_FONT}`;
  x.textAlign = 'left'; x.textBaseline = 'middle';
  // Chữ phẳng (KHÔNG in khối — Giang chốt 23/10): chỉ bóng đổ đậm cho rõ, dễ nhìn trên mọi nền bản đồ.
  // Bóng đổ = 1 lớp tối sát chữ lệch xuống + 1 quầng mờ rộng (fillSpaced tự canh giữa tại x = 0)
  const off = size * 0.07;
  x.save();
  x.shadowColor = 'rgba(0,0,0,0.75)'; x.shadowBlur = size * 0.45;
  x.fillStyle = 'rgba(0,0,0,0.55)';
  fillSpaced(x, text, ex * off, ey * off, sp);
  x.restore();
  x.fillStyle = 'rgba(0,0,0,0.85)';
  fillSpaced(x, text, ex * off, ey * off, sp);
  if (depth > 0) { /* giữ tham số cũ, không còn vẽ khối */ }
  // mặt chữ bóng kiểu kim loại, không viền
  const gr = x.createLinearGradient(0, -size * 0.55, 0, size * 0.5);
  for (const [o, col] of F.stops) gr.addColorStop(o, col);
  if (!(sweep > 0 && sweep < 1)) {
    x.fillStyle = gr;
    fillSpaced(x, text, 0, 0, sp);
  } else {
    // Vệt bóng kính chỉ nằm trên MẶT chữ: vẽ mặt chữ + vệt lên canvas riêng rồi dán đè lên khối
    if (!labelFace) labelFace = makeCanvas(16, 16);
    const fc = labelFace;
    if (fc.width < W || fc.height < Hh) { fc.width = Math.max(fc.width, W); fc.height = Math.max(fc.height, Hh); }
    const f = fc.getContext('2d');
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, W, Hh);
    f.setTransform(k, 0, 0, k, (tw / 2 + pad) * k, (size / 2 + pad) * k);
    f.font = `900 ${size}px ${NAME_FONT}`;
    f.textAlign = 'left'; f.textBaseline = 'middle';
    const fg = f.createLinearGradient(0, -size * 0.55, 0, size * 0.5);
    for (const [o, col] of F.stops) fg.addColorStop(o, col);
    f.fillStyle = fg;
    fillSpaced(f, text, 0, 0, sp);
    f.globalCompositeOperation = 'source-atop';
    // Vệt bóng kính: viền mảnh xanh xám (khúc xạ) + dải sáng sắc + dải mảnh song song, nghiêng chéo
    const sx = -tw / 2 - size * 1.2 + sweep * (tw + size * 2.4);
    const sg = f.createLinearGradient(sx - size * 0.6, -size * 0.35, sx + size * 0.6, size * 0.35);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.2, 'rgba(255,255,255,0)');
    sg.addColorStop(0.24, 'rgba(255,255,255,0.85)'); // dải mảnh
    sg.addColorStop(0.28, 'rgba(255,255,255,0)');
    sg.addColorStop(0.35, 'rgba(120,150,175,0)');
    sg.addColorStop(0.38, `rgba(100,130,160,${F.edge || 0.6})`); // viền khúc xạ (làm vệt nổi cả trên chữ trắng)
    sg.addColorStop(0.41, 'rgba(255,255,255,1)');    // dải chính sắc nét
    sg.addColorStop(0.61, 'rgba(255,255,255,1)');
    sg.addColorStop(0.64, `rgba(100,130,160,${(F.edge || 0.6) * 0.9})`);
    sg.addColorStop(0.67, 'rgba(120,150,175,0)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    f.fillStyle = sg;
    f.fillRect(sx - size * 1.2, -size, size * 2.4, size * 2);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(fc, 0, 0, W, Hh, 0, 0, W, Hh);
  }
  ctx.drawImage(c, 0, 0, W, Hh, -(tw / 2 + pad), -(size / 2 + pad), W / k, Hh / k);
}

// Chữ in nằm trên mặt đất theo hướng trục đường (sau khi bẻ phối cảnh sẽ nằm nghiêng theo mặt đất)
// opt.face: kiểu chữ bóng; opt.scale: hiệu ứng vào/ra; opt.sweep: vệt sáng 0..1; opt.k: độ phân giải canvas đất
function groundText(g, v, L, color, alpha, rise, opt = null) {
  if (alpha <= 0.01) return;
  const p = gLL(v, L.at.lat, L.at.lng);
  const a = gLL(v, L.a[0], L.a[1]), b = gLL(v, L.b[0], L.b[1]);
  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (ang > Math.PI / 2) ang -= Math.PI;
  if (ang < -Math.PI / 2) ang += Math.PI;
  g.save();
  g.globalAlpha = alpha;
  if (!opt?.local) g.translate(p.x, p.y); // local: đã đặt sẵn gốc toạ độ tại chữ (vẽ trên màn hình)
  g.rotate(ang);
  const s = opt?.scale ?? (0.9 + 0.1 * rise);
  g.scale(s, s);
  const ex = Math.sin(ang), ey = Math.cos(ang);
  if (opt?.face) { glossyText(g, L.text, L.size, opt.face, L.size * 0.3 * rise, ex, ey, opt.sweep || 0, (opt.k || 1) * s); g.restore(); return; }
  // Kiểu gốc (Giang thích, 23/10 tối): mặt chữ chuyển trắng → màu line của chính trục đường, thân 3D màu line tối
  if (opt?.lineColor) {
    text3D(g, L.text, L.size, {
      faceTop: '#FFFFFF', faceBot: color, side: shade(color, 0.38),
      depth: L.size * 0.3 * rise, ex, ey, sp: L.size * 0.07, glow: 'rgba(0,0,0,0.55)', stroke: 'rgba(40,20,0,0.7)',
    });
    g.restore(); return;
  }
  // Mặt chữ trắng (hoặc vàng), thân 3D màu đường tối, viền đen dày
  text3D(g, L.text, L.size, {
    faceTop: opt?.yellow ? '#FFF3A6' : '#FFFFFF', faceBot: opt?.yellow ? '#FFCF1F' : '#EDEFF2', side: shade(color, 0.42),
    depth: L.size * 0.32 * rise, ex, ey, sp: L.size * 0.07, glow: 'rgba(0,0,0,0.75)', stroke: 'rgba(0,0,0,0.35)', outline: 'rgba(8,10,14,0.92)',
  });
  g.restore();
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), gg = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${gg},${b})`;
}

// ---------- Vẽ trên màn hình ----------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, maxW, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxW && last.length > 1) last = last.slice(0, -1);
    keep[maxLines - 1] = last.trimEnd() + '…';
    return keep;
  }
  return lines;
}
function fitOneLine(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}
function spacedCaps(ctx, text, x, y, sp) {
  let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
  return cx;
}

function drawPoiPin(ctx, x, y, cat, s, alpha, ic = null) {
  if (s <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 3, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -15, 15, 0, Math.PI * 2);
  ctx.fillStyle = CAT_COLORS[cat] || '#888';
  ctx.fill();
  ctx.lineWidth = 2.6; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5, -2.5); ctx.lineTo(0, 3); ctx.lineTo(5, -2.5); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill();
  drawIcon(ctx, ic || CATEGORIES[cat]?.icon || 'house', 0, -15, 16, '#fff');
  ctx.restore();
}

function drawFlagPin(ctx, x, y, s) {
  if (s <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 2, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.bezierCurveTo(-5, -10, -15, -15, -15, -26);
  ctx.arc(0, -26, 15, Math.PI, 0, false);
  ctx.bezierCurveTo(15, -15, 5, -10, 0, 0); ctx.closePath();
  ctx.fillStyle = PINK; ctx.fill();
  ctx.lineWidth = 2.4; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(-5, -34, 2, 16);
  ctx.beginPath(); ctx.moveTo(-3, -34); ctx.lineTo(7, -31); ctx.lineTo(-3, -26); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawHousePin(ctx, x, y, dropT, t, s = 1) {
  const pulse = (t % 1.8) / 1.8;
  for (const off of [0, 0.5]) {
    const q = (pulse + off) % 1;
    ctx.beginPath();
    ctx.ellipse(x, y, (8 + q * 40) * s, (8 + q * 40) * 0.42 * s, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,80,70,${0.75 * (1 - q)})`;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }
  if (dropT <= 0) return;
  const e = easeOutBounce(clamp01(dropT));
  const yy = y - (1 - e) * 140;
  ctx.save();
  ctx.globalAlpha = clamp01(dropT * 3);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(x, y + 2, 12 * (0.5 + e * 0.5) * s, 4.5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(x, yy);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-6, -12, -21, -20, -21, -34);
  ctx.arc(0, -34, 21, Math.PI, 0, false);
  ctx.bezierCurveTo(21, -20, 6, -12, 0, 0);
  ctx.closePath();
  ctx.fillStyle = HOUSE;
  ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  drawIcon(ctx, 'house', 0, -35, 22, '#fff');
  ctx.restore();
}

function labelCard(ctx, cx, bottomY, title, sub, alpha, LW, safe) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.font = `800 18px ${FONT}`;
  const tw = ctx.measureText(title).width;
  ctx.font = `500 12.5px ${FONT}`;
  const sw = sub ? Math.min(ctx.measureText(sub).width, 300) : 0;
  const w = Math.max(tw, sw) + 30, h = sub ? 56 : 38;
  let x = Math.max(safe.x, Math.min(LW - safe.x - w, cx - w / 2));
  const y = bottomY - h - 8 + (1 - easeOut(alpha)) * 10;
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
  roundRect(ctx, x, y, w, h, 11);
  ctx.fillStyle = ST.card; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  const px = Math.max(x + 14, Math.min(x + w - 14, cx));
  ctx.moveTo(px - 7, y + h); ctx.lineTo(px, y + h + 8); ctx.lineTo(px + 7, y + h); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = ST.ink;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `800 18px ${FONT}`;
  ctx.fillText(title, x + w / 2, y + 27);
  if (sub) {
    ctx.font = `500 12.5px ${FONT}`;
    ctx.fillStyle = ST.soft;
    ctx.fillText(fitOneLine(ctx, sub, 300), x + w / 2, y + 46);
  }
  ctx.restore();
}

function poiCard(ctx, poi, px, py, alpha, tl, avoid) {
  if (alpha <= 0.01) return;
  const { LW, LH, safe } = tl;
  ctx.save();
  ctx.font = `800 15.5px ${FONT}`;
  const lines = wrapText(ctx, poi.name, 232, 2);
  const nameW = Math.max(...lines.map(l => ctx.measureText(l).width));
  ctx.font = `700 10.5px ${FONT}`;
  const catText = CATEGORIES[poi.cat].short;
  const catW = ctx.measureText(catText).width + catText.length * 1.2;
  const dist = formatKm(poi.distKm, poi.approx, '≈ ');
  ctx.font = `800 13px ${FONT}`;
  const chipW = ctx.measureText(dist).width + 18;
  const w = Math.max(nameW, catW, chipW) + 26;
  const h = 32 + lines.length * 19 + 40;
  const cands = [
    { x: px - w / 2, y: py - 42 - h },
    { x: px - w / 2, y: py + 12 },
    { x: px + 22, y: py - h / 2 - 14 },
    { x: px - 22 - w, y: py - h / 2 - 14 },
  ];
  let best = null;
  for (const c of cands) {
    c.x = Math.max(safe.x, Math.min(LW - safe.x - w, c.x));
    const inY = c.y >= safe.top + 6 && c.y + h <= LH - safe.bottom;
    const hit = avoid.some(a => c.x < a.x + a.w && c.x + w > a.x && c.y < a.y + a.h && c.y + h > a.y);
    if (inY && !hit) { best = c; break; }
    if (!best && inY) best = c;
  }
  if (!best) best = { x: cands[0].x, y: Math.max(safe.top + 6, Math.min(LH - safe.bottom - h, cands[0].y)) };
  const y = best.y + (1 - easeOut(alpha)) * 10;
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
  roundRect(ctx, best.x, y, w, h, 11);
  ctx.fillStyle = ST.card; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `700 10.5px ${FONT}`;
  ctx.fillStyle = CAT_COLORS[poi.cat];
  spacedCaps(ctx, catText, best.x + 13, y + 22, 1.2);
  ctx.fillStyle = ST.ink;
  ctx.font = `800 15.5px ${FONT}`;
  lines.forEach((l, i) => ctx.fillText(l, best.x + 13, y + 42 + i * 19));
  const cy = y + 42 + (lines.length - 1) * 19 + 12;
  roundRect(ctx, best.x + 13, cy, chipW, 22, 6);
  ctx.fillStyle = CA(); ctx.fill();
  ctx.fillStyle = CAI();
  ctx.font = `800 13px ${FONT}`;
  ctx.fillText(dist, best.x + 22, cy + 15.5);
  ctx.restore();
}

function chip(ctx, x, y, text, alpha, color = GOLD) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 13px ${FONT}`;
  const w = ctx.measureText(text).width + 20, h = 24;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 12);
  ctx.fillStyle = ST.card; ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = color; ctx.stroke();
  ctx.fillStyle = ST.light ? ST.ink : color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

function crossingChip(ctx, x, y, short, dist, alpha, tl) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `800 13.5px ${FONT}`;
  const t1 = `QUA RANH ${short.toUpperCase()}`;
  const w1 = ctx.measureText(t1).width;
  ctx.font = `600 12px ${FONT}`;
  const w2 = ctx.measureText(dist).width;
  const w = Math.max(w1, w2) + 24, h = 44;
  let bx = Math.max(tl.safe.x, Math.min(tl.LW - tl.safe.x - w, x - w / 2));
  const by = y - h - 8 + (1 - easeOut(alpha)) * 8;
  roundRect(ctx, bx, by, w, h, 9);
  ctx.fillStyle = ST.card; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = PINK; ctx.stroke();
  ctx.fillStyle = ST.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `800 13.5px ${FONT}`;
  ctx.fillText(t1, bx + w / 2, by + 19);
  ctx.fillStyle = '#FFB3D0';
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText(dist, bx + w / 2, by + 35);
  ctx.restore();
}

function boundaryCard(ctx, tl, b, alpha) {
  if (alpha <= 0.01) return;
  const { LW, LH, safe } = tl;
  const horiz = tl.fmt === 'h';
  const w = horiz ? 400 : LW - safe.x * 2 - 12, h = 104;
  const x = horiz ? safe.x : (LW - w) / 2;
  const y = LH - safe.bottom - h - (horiz ? 0 : 14) + (1 - easeOut(alpha)) * 14;
  const road = b.route ? formatKm(b.route.km) : formatKm(b.km, true, '≈ ');
  const mins = b.route && b.route.min ? `~${Math.max(1, Math.round(b.route.min))} phút ô tô` : 'đường chim bay';
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = ST.card; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.6; ctx.strokeStyle = PINK; ctx.stroke();
  roundRect(ctx, x + 14, y + 26, 46, 46, 10);
  ctx.fillStyle = PINK; ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 30, y + 36, 3, 26);
  ctx.beginPath(); ctx.moveTo(x + 33, y + 36); ctx.lineTo(x + 47, y + 41); ctx.lineTo(x + 33, y + 47); ctx.closePath(); ctx.fill();
  const tx = x + 74;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `700 10.5px ${FONT}`;
  ctx.fillStyle = ST.mute;
  spacedCaps(ctx, 'TỪ CĂN NHÀ ĐẾN', tx, y + 22, 1.4);
  ctx.font = `800 18px ${FONT}`;
  ctx.fillStyle = ST.ink;
  ctx.fillText('RANH GIỚI ', tx, y + 44);
  const rw = ctx.measureText('RANH GIỚI ').width;
  ctx.fillStyle = ST.light ? '#0E7C88' : CYAN;
  ctx.fillText(fitOneLine(ctx, b.short.toUpperCase(), w - (tx - x) - rw - 14), tx + rw, y + 44);
  ctx.font = `800 25px ${FONT}`;
  ctx.fillStyle = CA();
  ctx.fillText(road, tx, y + 74);
  const dw = ctx.measureText(road).width;
  ctx.font = `600 12.5px ${FONT}`;
  ctx.fillStyle = ST.ink;
  ctx.fillText(mins, tx + dw + 10, y + 72);
  ctx.fillStyle = ST.mute;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText(`Chim bay khoảng ${formatKm(b.km)}`, tx, y + 93);
  ctx.restore();
}

function drawSummary(ctx, tl, p) {
  if (p <= 0.01) return;
  const { LW, LH, safe } = tl;
  const rows = [];
  if (tl.boundary) {
    const b = tl.boundary;
    rows.push({ flag: true, name: `Ranh ${b.short}`, dist: b.route ? formatKm(b.route.km) : formatKm(b.km, true, '≈ ') });
  }
  for (const r of [...tl.pois].sort((a, b) => a.distKm - b.distKm)) {
    if (rows.length >= 6) break;
    rows.push({ cat: r.cat, name: r.name, dist: formatKm(r.distKm, r.approx, '≈ ') });
  }
  const horiz = tl.fmt === 'h';
  const w = horiz ? 384 : LW - safe.x * 2;
  const h = tl.panelH;
  const x = horiz ? LW - safe.x - w : safe.x;
  const y = horiz ? (LH - h) / 2 : LH - safe.bottom - h;
  ctx.save();
  ctx.globalAlpha = clamp01(p * 2);
  ctx.translate(0, (1 - easeOut(clamp01(p * 1.6))) * 16);
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = ST.card; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.4; ctx.strokeStyle = ST.light ? 'rgba(17,22,27,0.18)' : GOLD; ctx.stroke();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CA();
  ctx.font = `700 11px ${FONT}`;
  spacedCaps(ctx, `TỪ CĂN NHÀ · BÁN KÍNH ${String(tl.scene.radiusKm).replace('.', ',')} KM`, x + 16, y + 27, 1.1);
  rows.forEach((r, i) => {
    const rp = clamp01(p * 2.2 - i * 0.12);
    if (rp <= 0) return;
    const ry = y + 46 + i * 34;
    ctx.globalAlpha = rp;
    roundRect(ctx, x + 17, ry + 1, 22, 22, 6);
    ctx.fillStyle = r.flag ? PINK : CAT_COLORS[r.cat]; ctx.fill();
    if (r.flag) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 24, ry + 6, 2, 13);
      ctx.beginPath(); ctx.moveTo(x + 26, ry + 6); ctx.lineTo(x + 34, ry + 9); ctx.lineTo(x + 26, ry + 12); ctx.closePath(); ctx.fill();
    } else drawIcon(ctx, iconOf(r), x + 28, ry + 12, 13, '#fff');
    ctx.font = `800 14px ${FONT}`;
    const dw = ctx.measureText(r.dist).width;
    ctx.fillStyle = CA();
    ctx.textAlign = 'right';
    ctx.fillText(r.dist, x + w - 16, ry + 17);
    ctx.textAlign = 'left';
    ctx.fillStyle = ST.ink;
    ctx.font = `700 14px ${FONT}`;
    ctx.fillText(fitOneLine(ctx, r.name, w - 64 - dw - 26), x + 50, ry + 17);
  });
  ctx.restore();
}

// Chữ phẳng theo phong cách (không đùn 3D): sang trọng = có chân, nhũ vàng; tối giản = mảnh, giãn chữ
function styledLine(ctx, text, size, color, kind) {
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  if (kind === 'serif') {
    ctx.font = `${ST.headW} ${size}px ${HFONT}`;
    const sp = size * 0.06;
    const w = spacedWidth(ctx, text, sp);
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 2;
    const gr = ctx.createLinearGradient(0, -size * 0.55, 0, size * 0.55);
    gr.addColorStop(0, '#FFF6DE'); gr.addColorStop(0.55, color); gr.addColorStop(1, '#A9813E');
    ctx.fillStyle = gr;
    fillSpaced(ctx, text, 0, 0, sp);
    ctx.restore();
    return w;
  }
  if (kind === 'sticker') {
    ctx.font = `${ST.headW} ${size}px ${HFONT}`;
    const w = ctx.measureText(text).width;
    ctx.rotate(-0.035);
    roundRect(ctx, -w / 2 - 14, -size * 0.62, w + 28, size * 1.2, 10);
    ctx.fillStyle = color; ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = color === ST.acc2 ? '#1d1030' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(text, 0, size * 0.06);
    ctx.restore();
    return w + 28;
  }
  // thin
  ctx.font = `${ST.headW} ${size}px ${HFONT}`;
  const sp = size * 0.16;
  const w = spacedWidth(ctx, text, sp);
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  fillSpaced(ctx, text, 0, 0, sp);
  ctx.restore();
  return w;
}
function drawTitle(ctx, tl, text, sub, alpha, topY = 0) {
  if (alpha <= 0.01 || !text) return;
  const { LW, safe } = tl;
  const kind = ST.title;
  ctx.save();
  ctx.globalAlpha = alpha;
  const size = (tl.fmt === 'h' ? 30 : 34) * (kind === 'thin' ? 0.9 : kind === 'serif' ? 1.02 : 1);
  ctx.font = kind === '3d' ? `800 ${size}px ${FONT}` : `${ST.headW} ${size}px ${HFONT}`;
  const extra = kind === 'thin' ? size * 0.16 * 14 : kind === 'serif' ? size * 0.06 * 14 : kind === 'sticker' ? 40 : 20;
  const lines = wrapText(ctx, text.toUpperCase(), LW - safe.x * 2 - extra, 2);
  // Có logo góc trên thì tiêu đề xuống dưới logo
  const pop = ST.pop ? easeOutBack(clamp01(alpha)) : 1;
  let y = Math.max(tl.fmt === 'v' ? safe.top + 8 : safe.top - 6, topY ? topY + size * 0.55 : 0) + (1 - easeOut(alpha)) * -10;
  ctx.translate(LW / 2, 0);
  let maxW = 0;
  lines.forEach((l, i) => {
    ctx.save();
    ctx.translate(0, y + i * (size + (kind === 'sticker' ? 14 : 8)));
    if (pop !== 1) ctx.scale(pop, pop);
    const last = i === lines.length - 1 && lines.length > 1;
    if (kind === '3d') text3DCentered(ctx, l, size, last ? CYAN : '#FFFFFF');
    else {
      ctx.font = `${ST.headW} ${size}px ${HFONT}`;
      const sp = kind === 'thin' ? size * 0.16 : kind === 'serif' ? size * 0.06 : 0;
      const w = kind === 'sticker' ? ctx.measureText(l).width : spacedWidth(ctx, l, sp);
      maxW = Math.max(maxW, w);
      if (kind === 'sticker') styledLine(ctx, l, size, last ? ST.acc2 : ST.acc, kind);
      else styledLine(ctx, l, size, kind === 'serif' ? ST.acc : '#ffffff', kind);
    }
    ctx.restore();
  });
  const lastY = y + (lines.length - 1) * (size + (kind === 'sticker' ? 14 : 8));
  // Đường kẻ trang trí: sang trọng = 2 vạch vàng + hình thoi, tối giản = 1 vạch mảnh
  if (kind === 'serif' || kind === 'thin') {
    const ry = lastY + size * 0.72;
    const half = Math.min(LW / 2 - safe.x, Math.max(60, maxW / 2) * (kind === 'thin' ? 0.35 : 0.8)) * easeOut(clamp01(alpha));
    ctx.save();
    ctx.strokeStyle = kind === 'serif' ? ST.acc : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = kind === 'serif' ? 1.4 : 1;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4;
    if (kind === 'serif') {
      ctx.beginPath(); ctx.moveTo(-half, ry); ctx.lineTo(-9, ry); ctx.moveTo(9, ry); ctx.lineTo(half, ry); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, ry - 5); ctx.lineTo(5, ry); ctx.lineTo(0, ry + 5); ctx.lineTo(-5, ry); ctx.closePath();
      ctx.fillStyle = ST.acc; ctx.fill();
    } else { ctx.beginPath(); ctx.moveTo(-half, ry); ctx.lineTo(half, ry); ctx.stroke(); }
    ctx.restore();
  }
  if (sub) {
    const sy = lastY + size * (kind === 'serif' || kind === 'thin' ? 1.35 : 0.95) + (kind === 'sticker' ? 8 : 0);
    ctx.font = kind === 'serif' ? `italic 500 14px ${HFONT}` : `600 13px ${FONT}`;
    const w = ctx.measureText(sub).width + 22;
    if (kind === 'serif') {
      ctx.fillStyle = ST.ink; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
    } else {
      roundRect(ctx, -w / 2, sy - 12, w, 24, kind === 'sticker' ? 12 : 6);
      ctx.fillStyle = ST.card; ctx.fill();
      ctx.fillStyle = ST.ink;
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(sub, 0, sy + 0.5);
  }
  ctx.restore();
}

// Chữ 3D đứng (bảng hiệu): đùn xuống dưới, tâm tại gốc toạ độ hiện tại
function text3DCentered(ctx, text, size, color, rise = 1, glow = null) {
  const isCyan = color === CYAN;
  text3D(ctx, text, size, {
    faceTop: '#FFFFFF', faceBot: color, side: isCyan ? '#0E6E79' : '#5B6670',
    depth: size * 0.16 * rise, ex: 0, ey: 1, sp: size * 0.07, glow,
  });
}

function drawBrand(ctx, tl, text, phone, alpha) {
  if ((!text && !phone) || alpha <= 0.01) return;
  const { LW, LH, safe } = tl;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const rise = (1 - easeOut(alpha)) * 12;
  const bottom = LH - safe.bottom + (tl.fmt === 'v' ? -6 : 0) + rise;
  if (phone) {
    // Thẻ liên hệ: số điện thoại to, tên thương hiệu nhỏ phía trên
    ctx.font = `800 22px ${FONT}`;
    const ph = 'Gọi xem nhà  ' + phone;
    const pw = Math.min(LW - safe.x * 2 - 20, ctx.measureText(ph).width + 40), h = 46;
    const y = bottom - h;
    if (text) {
      ctx.font = `700 13px ${FONT}`;
      const t = fitOneLine(ctx, text, LW - safe.x * 2 - 40);
      const tw = ctx.measureText(t).width + 26;
      roundRect(ctx, (LW - tw) / 2, y - 34, tw, 26, 13);
      ctx.fillStyle = ST.card; ctx.fill();
      ctx.fillStyle = ST.ink;
      ctx.fillText(t, LW / 2, y - 21);
    }
    const pop = ST.pop ? easeOutBack(clamp01(alpha)) : 1;
    ctx.save();
    ctx.translate(LW / 2, y + h / 2); ctx.scale(pop, pop); ctx.translate(-LW / 2, -(y + h / 2));
    roundRect(ctx, (LW - pw) / 2, y, pw, h, ST.outline ? 4 : 23);
    if (ST.outline) { ctx.fillStyle = ST.card; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.fillStyle = GOLD; }
    else { ctx.fillStyle = GOLD; ctx.fill(); ctx.fillStyle = ST.accInk; }
    ctx.font = ST.outline ? `700 21px ${HFONT}` : `800 22px ${FONT}`;
    ctx.fillText(fitOneLine(ctx, ph, pw - 24), LW / 2, y + h / 2 + 1);
    ctx.restore();
  } else {
    ctx.font = `800 16px ${FONT}`;
    const t = fitOneLine(ctx, text, LW - safe.x * 2 - 40);
    const w = ctx.measureText(t).width + 34, h = 38;
    const y = bottom - h;
    roundRect(ctx, (LW - w) / 2, y, w, h, ST.outline ? 4 : 19);
    if (ST.outline) { ctx.fillStyle = ST.card; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.fillStyle = GOLD; }
    else { ctx.fillStyle = GOLD; ctx.fill(); ctx.fillStyle = ST.accInk; }
    ctx.fillText(t, LW / 2, y + h / 2 + 1);
  }
  ctx.restore();
}

// ---------- Logo, thông tin căn nhà, phụ đề ----------
const LOGO_H = { v: 58, h: 50, s: 48 };
function logoBox(tl) {
  const img = tl.scene.logo;
  if (!img || !img.width || !img.height) return null;
  const { LW, safe } = tl;
  const pad = tl.scene.logoBg === false ? 0 : 7;
  const mh = LOGO_H[tl.fmt] || 52;
  const k = Math.min(mh / img.height, (mh * 2.8) / img.width);
  const w = img.width * k, h = img.height * k;
  return { x: LW - safe.x - w - pad * 2, y: safe.top + 6, w: w + pad * 2, h: h + pad * 2, iw: w, ih: h, pad };
}
function drawLogo(ctx, tl, box) {
  if (!box) return;
  ctx.save();
  if (box.pad) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
    roundRect(ctx, box.x, box.y, box.w, box.h, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fill();
    ctx.shadowColor = 'transparent';
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 6;
  }
  ctx.drawImage(tl.scene.logo, box.x + box.pad, box.y + box.pad, box.iw, box.ih);
  ctx.restore();
}

function infoData(scene) {
  const i = scene.info || {};
  const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const beds = clean(i.beds);
  const tc = clean(i.thoCu);
  const det = [clean(i.area), tc ? (/thổ cư/i.test(tc) ? tc : tc + ' thổ cư') : '', beds ? (/^\d+$/.test(beds) ? beds + ' phòng ngủ' : beds) : '', clean(i.legal)].filter(Boolean);
  const price = clean(i.price);
  return price || det.length ? { price, det } : null;
}
// Vị trí thẻ thông tin: lúc giới thiệu căn nhà nằm dưới cùng (ngang: góc phải dưới), lúc kết nằm trên cùng
function infoBox(tl, where, logo) {
  const d = infoData(tl.scene);
  if (!d) return null;
  const { LW, LH, safe } = tl;
  const h = d.price ? (d.det.length ? 92 : 66) : 46;
  if (tl.fmt === 'h') {
    const w = 384;
    return where === 'top'
      ? { x: safe.x, y: safe.top + 6, w, h, d }
      : { x: LW - safe.x - w, y: LH - safe.bottom - h, w, h, d };
  }
  if (where === 'top') return { x: safe.x, y: logo ? logo.y + logo.h + 8 : safe.top + 6, w: LW - safe.x * 2, h, d };
  return { x: safe.x, y: LH - safe.bottom - h - (tl.fmt === 'v' ? 6 : 0), w: LW - safe.x * 2, h, d };
}
function drawInfo(ctx, box, alpha) {
  if (!box || alpha <= 0.01) return;
  const { x, w, h, d } = box;
  const y = box.y + (1 - easeOut(clamp01(alpha * 1.4))) * 12;
  ctx.save();
  ctx.globalAlpha = clamp01(alpha * 1.6);
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = ST.card; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.4; ctx.strokeStyle = ST.light ? 'rgba(17,22,27,0.18)' : GOLD; ctx.stroke();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const detText = d.det.join('  ·  ');
  if (d.price) {
    ctx.fillStyle = CA();
    ctx.font = `700 11px ${FONT}`;
    const lx = spacedCaps(ctx, 'GIÁ BÁN', x + 16, y + 24, 1.2);
    ctx.font = `${ST.headW >= 700 ? ST.headW : 600} 30px ${HFONT}`;
    ctx.fillText(fitOneLine(ctx, d.price, w - (lx - x) - 24), x + 16, y + 56);
    if (detText) {
      ctx.fillStyle = ST.ink;
      ctx.font = `700 14.5px ${FONT}`;
      ctx.fillText(fitOneLine(ctx, detText, w - 32), x + 16, y + 80);
    }
  } else {
    ctx.fillStyle = ST.ink;
    ctx.font = `800 16px ${FONT}`;
    ctx.fillText(fitOneLine(ctx, detText, w - 32), x + 16, y + 29);
  }
  ctx.restore();
}

const CAP_SIZE = { v: 24, h: 24, s: 22 };
function captionAt(tl, t) {
  const c = tl.captions;
  if (!c || !c.length) return null;
  for (const x of c) if (t >= x.t0 && t < x.t1) return x;
  return null;
}
// Đặt phụ đề phía trên các thẻ đang hiện ở đáy khung (thẻ ranh, bảng tổng kết, thẻ liên hệ, thẻ giá)
function captionLayout(ctx, tl, cap, occ) {
  const { LW, LH, safe } = tl;
  const size = CAP_SIZE[tl.fmt] || 24;
  let left = safe.x + 10, right = LW - safe.x - 10;
  if (occ.rightPanel) right = occ.rightPanel - 16;
  const maxW = right - left - 28;
  ctx.save();
  ctx.font = `800 ${size}px ${FONT}`;
  const lines = wrapText(ctx, cap.text, maxW, 2);
  const lw = Math.max(...lines.map(l => ctx.measureText(l).width));
  ctx.restore();
  const lh = size * 1.3;
  const h = lines.length * lh + 14;
  const w = lw + 28;
  const bottom = Math.min(LH - safe.bottom - (tl.fmt === 'v' ? 10 : 6), occ.top - 10);
  const cx = (left + right) / 2;
  return { x: cx - w / 2, y: bottom - h, w, h, lines, size, lh };
}
function drawCaption(ctx, L, alpha) {
  if (!L || alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRect(ctx, L.x, L.y, L.w, L.h, 10);
  ctx.fillStyle = ST.capBg; ctx.fill();
  ctx.font = `800 ${L.size}px ${ST.pop ? HFONT : FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  L.lines.forEach((ln, i) => {
    const y = L.y + 7 + L.lh * (i + 0.5) + 1;
    if (ST.capInk === '#ffffff' || ST.capInk === '#F7F1E6') { ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(ln, L.x + L.w / 2, y); }
    ctx.fillStyle = ST.capInk;
    ctx.fillText(ln, L.x + L.w / 2, y);
  });
  ctx.restore();
}
// ---------- Vùng lái xe 5 – 10 – 15 phút ----------
const ISO_COL = { 5: '#4BE38A', 10: '#2FD3E6', 15: '#A585FF' };
const isoColor = m => ISO_COL[m] || '#A585FF';
// Mỗi vùng lan ra từ nhà lần lượt (vùng nhỏ trước): trả về hệ số lan 0..1
function isoReveal(tl, idx, t) {
  const ph = tl.isoPh;
  if (!ph) return 0;
  const st = ph.t0 + (ph.t1 - ph.t0) * (0.14 + 0.2 * idx);
  return smooth(clamp01((t - st) / 0.9));
}
function isoAlpha(tl, t) {
  const ph = tl.isoPh;
  return ph ? fadeWin(t, ph.t0, ph.t1 + 0.3, 0.4, 0.7) : 0;
}

// ---------- Video thực tế căn nhà ----------
export const CLIP_MAX = 5;
// ---------- Kết nối vùng + hạ tầng đang thi công ----------
const HUB_COL = { center: '#FFD54A', airport: '#5BC0FF', port: '#2EE6C5', station: '#FF9F43', metro: '#E77CFF' };
const HUB_ICON = { center: 'city', airport: 'plane', port: 'ship', station: 'train', metro: 'train' };
const INFRA_COL = '#FFC233';
// Đường tới điểm mốc thứ i chạy ra trong cú máy của nó, cùng nhịp với máy bay tới (camShots, sfx.js dùng cùng công thức)
function shotW(ph, sh, t) { return clamp01(((t - ph.t0) / (ph.t1 - ph.t0) - sh.s) / Math.max(1e-6, sh.e - sh.s)); }
function hubReveal(tl, i, t) {
  const ph = tl.regionPh;
  if (!ph || t < ph.t0) return 0;
  const sh = ph.shots.find(x => x.anchor === i);
  if (!sh) return 1;
  return clamp01((shotW(ph, sh, t) - 0.04) / (sh.move - 0.04));
}
function hubAlpha(tl, t) { const ph = tl.regionPh; return ph ? fadeWin(t, ph.t0 + 0.15, ph.t1 + 0.45, 0.4, 0.5) : 0; }
// Tuyến đang thi công thứ i: chạy ra trong 2 cú máy của nó (đáp cận + lia dọc tuyến), tới cảnh toàn thì chạy hết tuyến
function infraReveal(tl, i, t) {
  const ph = tl.infraPh;
  if (!ph || t < ph.t0) return 0;
  const A = ph.shots.find(x => x.infra === i && x.part === 'a'), B = ph.shots.find(x => x.infra === i && x.part === 'b');
  if (!A || !B) return 1;
  const f = (t - ph.t0) / (ph.t1 - ph.t0);
  const s0 = A.s + 0.25 * (A.e - A.s), s1 = B.s + 0.85 * (B.e - B.s);
  return clamp01((f - s0) / (s1 - s0));
}
function infraRR(tl, i, t) {
  const ph = tl.infraPh, r = tl.infra[i];
  if (!ph || t < ph.t0) return 0;
  if (t >= ph.t1) return r.rrMax;
  const rec = ph.shots[ph.shots.length - 1];
  const rB = r.rB ?? r.rrMax;
  const f = (t - ph.t0) / (ph.t1 - ph.t0);
  if (f < rec.s) return smooth(infraReveal(tl, i, t)) * rB;
  return rB + (r.rrMax - rB) * smooth(clamp01((f - rec.s) / ((1 - rec.s) * 0.7)));
}
// Rõ trong cảnh của mình, sau đó mờ còn 0,42 suốt các cảnh trục đường rồi tắt
function infraAlpha(tl, t) {
  const ph = tl.infraPh;
  if (!ph || t < ph.t0) return 0;
  if (t < ph.t1) return clamp01((t - ph.t0 - 0.15) / 0.4);
  const end = Math.max(tl.roadsEnd || 0, ph.t1);
  if (t < end) return Math.max(0.42, 1 - (t - ph.t1) / 0.7);
  return Math.max(0, 0.42 - (t - end) / 0.6);
}
function hubPin(ctx, x, y, type, s, alpha) {
  if (s <= 0.01 || alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(s, s);
  const col = HUB_COL[type] || GOLD;
  ctx.shadowColor = col; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2.4; ctx.strokeStyle = '#fff'; ctx.stroke();
  drawIcon(ctx, HUB_ICON[type] || 'pin', 0, 0, 16, '#0d1218');
  ctx.restore();
}
const hitAny = (r, list) => list.some(a => r.x < a.x + a.w && r.x + r.w > a.x && r.y < a.y + a.h && r.y + r.h > a.y);
const overlapArea = (r, list) => list.reduce((s, a) => s + Math.max(0, Math.min(r.x + r.w, a.x + a.w) - Math.max(r.x, a.x)) * Math.max(0, Math.min(r.y + r.h, a.y + a.h) - Math.max(r.y, a.y)), 0);
// Chọn chỗ đặt thẻ quanh ghim (12 hướng × 4 khoảng cách), ít đè nhất, ưu tiên gần ghim và hướng ra xa căn nhà.
// Chỗ đã chọn được nhớ theo `key` (không nhảy qua lại giữa các khung hình), chỉ đổi khi chỗ cũ bị đè nhiều.
function placeCard(tl, key, w, h, px, py, hx, hy, avoid) {
  const { LW, LH, safe } = tl;
  const slots = tl._cardSlots || (tl._cardSlots = {});
  const out = Math.atan2(py - hy, px - hx);
  const evalAt = (ang, rad) => {
    const cx = px + Math.cos(ang) * (rad + w * 0.5 * Math.abs(Math.cos(ang)));
    const cy = py + Math.sin(ang) * (rad + h * 0.5 * Math.abs(Math.sin(ang)));
    const x = Math.max(safe.x, Math.min(LW - safe.x - w, cx - w / 2));
    const y = Math.max(safe.top + 6, Math.min(LH - safe.bottom - h, cy - h / 2));
    const r = { x, y, w, h };
    const score = overlapArea(r, avoid) / (w * h) * 30 + Math.hypot(x + w / 2 - px, y + h / 2 - py) / 90 + (1 - Math.cos(ang - out)) * 0.35;
    return { r, score, ang, rad };
  };
  const prev = slots[key];
  if (prev) {
    const e = evalAt(prev.ang, prev.rad);
    if (e.score < prev.score + 2.5) { slots[key] = { ...prev, score: Math.min(prev.score, e.score) }; return e.r; }
  }
  let best = null;
  for (const rad of [14, 46, 86, 130]) for (let k = 0; k < 12; k++) {
    const e = evalAt(-Math.PI / 2 + k * Math.PI / 6, rad);
    if (!best || e.score < best.score) best = e;
  }
  slots[key] = { ang: best.ang, rad: best.rad, score: best.score };
  return best.r;
}
// Nét dẫn mảnh từ ghim tới thẻ khi thẻ đặt xa ghim
function leader(ctx, px, py, r, col, alpha) {
  const qx = Math.max(r.x, Math.min(r.x + r.w, px)), qy = Math.max(r.y, Math.min(r.y + r.h, py));
  if (Math.hypot(qx - px, qy - py) < 22) return;
  ctx.save();
  ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = col; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke();
  ctx.restore();
}
// Thẻ gọn cho điểm mốc: tên + "km · phút". Chọn chỗ quanh ghim không đè ghim nhà, thẻ khác, logo, phụ đề.
function hubCard(ctx, tl, a, px, py, alpha, avoid, key, hx, hy) {
  ctx.save();
  ctx.font = `800 13.5px ${FONT}`;
  const name = fitOneLine(ctx, a.name, 210);
  const nameW = ctx.measureText(name).width;
  const sub = `${formatKm(a.km)} · ${a.approx ? '≈ ' : ''}${a.min} phút`;
  ctx.font = `800 12.5px ${FONT}`;
  const subW = ctx.measureText(sub).width;
  const w = Math.max(nameW, subW) + 28, h = 44;
  const best = placeCard(tl, key, w, h, px, py, hx, hy, avoid);
  const y = best.y + (1 - easeOut(alpha)) * 8;
  const col = HUB_COL[a.type] || GOLD;
  leader(ctx, px, py, { ...best, y }, col, alpha);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  roundRect(ctx, best.x, y, w, h, 10);
  ctx.fillStyle = ST.card; ctx.fill();
  ctx.shadowColor = 'transparent';
  roundRect(ctx, best.x, y, 5, h, 3);
  ctx.fillStyle = col; ctx.fill();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ST.ink; ctx.font = `800 13.5px ${FONT}`;
  ctx.fillText(name, best.x + 15, y + 19);
  ctx.fillStyle = ST.light ? shade(col, 0.55) : col; ctx.font = `800 12.5px ${FONT}`;
  ctx.fillText(sub, best.x + 15, y + 36);
  ctx.restore();
  avoid.push(best);
}
// Thẻ tuyến đang thi công: "ĐANG THI CÔNG" + tên tuyến + "cách nhà … km"
function infraCard(ctx, tl, r, px, py, alpha, avoid, key, hx, hy) {
  ctx.save();
  ctx.font = `800 14.5px ${FONT}`;
  const lines = wrapText(ctx, r.label, 236, 2);
  const nameW = Math.max(...lines.map(l => ctx.measureText(l).width));
  const kick = 'ĐANG THI CÔNG';
  ctx.font = `800 10.5px ${FONT}`;
  const kickW = ctx.measureText(kick).width + kick.length * 1.2 + 22;
  const dist = `cách nhà ${formatKm(r.nearKm)}`;
  ctx.font = `800 12.5px ${FONT}`;
  const chipW = ctx.measureText(dist).width + 18;
  const w = Math.max(nameW, kickW, chipW) + 26, h = 30 + lines.length * 18 + 34;
  const best = placeCard(tl, key, w, h, px, py, hx, hy, avoid);
  const y = best.y + (1 - easeOut(alpha)) * 8;
  leader(ctx, px, py, { ...best, y }, INFRA_COL, alpha);
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
  roundRect(ctx, best.x, y, w, h, 11);
  ctx.fillStyle = ST.card; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.4; ctx.strokeStyle = INFRA_COL; ctx.stroke();
  drawIcon(ctx, 'cone', best.x + 21, y + 17, 14, ST.light ? '#E07B00' : INFRA_COL);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `800 10.5px ${FONT}`;
  ctx.fillStyle = ST.light ? '#C26A00' : INFRA_COL;
  spacedCaps(ctx, kick, best.x + 33, y + 21, 1.2);
  ctx.fillStyle = ST.ink; ctx.font = `800 14.5px ${FONT}`;
  lines.forEach((l, i) => ctx.fillText(l, best.x + 13, y + 40 + i * 18));
  const cy = y + 40 + (lines.length - 1) * 18 + 10;
  roundRect(ctx, best.x + 13, cy, chipW, 21, 6);
  ctx.fillStyle = INFRA_COL; ctx.fill();
  ctx.fillStyle = '#1a1206'; ctx.font = `800 12.5px ${FONT}`;
  ctx.fillText(dist, best.x + 22, cy + 15);
  ctx.restore();
  avoid.push(best);
}

const CLIP_D = 2.8;
// Thời điểm trong file video ứng với giây t của cửa sổ chiếu w. Lấy đoạn giữa file (bỏ lúc bắt đầu/kết thúc quay hay rung),
// file ngắn hơn cảnh thì chiếu chậm lại (≥ 0,5×) cho đủ thời lượng. Cửa sổ nền thẻ giá lấy đoạn sau (~62%) để không trùng.
export function clipTime(c, w, t) {
  const D = Math.max(0.1, w.t1 - w.t0), lt = Math.max(0, t - w.t0);
  let start, rate = 1;
  if (c.dur >= D + 0.6) {
    start = w.hook ? Math.min(c.dur - D - 0.3, c.dur * 0.62) : Math.min(c.dur - D - 0.2, Math.max(0.4, (c.dur - D) * 0.45));
    start = Math.max(0, start);
  } else { start = 0; rate = Math.max(0.5, Math.min(1, (c.dur - 0.1) / D)); }
  return { time: Math.max(0, Math.min(c.dur - 0.05, start + lt * rate)), rate };
}
const clipReady = el => el && (el.readyState === undefined || el.readyState >= 2) && (el.videoWidth || el.width);
function drawClips(ctx, tl, t, logo) {
  if (!tl.clipWins || !tl.clipWins.length) return;
  const w = tl.clipWins.find(x => !x.hook && t >= x.t0 && t < x.t1);
  if (!w) return;
  const el = tl.clips[w.clip] && tl.clips[w.clip].el;
  if (!clipReady(el)) return;
  const { LW, LH, safe } = tl;
  const D = w.t1 - w.t0, lt = t - w.t0;
  const fade = Math.min(0.35, D * 0.18);
  const A = Math.min(clamp01(lt / fade), clamp01((w.t1 - t) / fade));
  if (A <= 0) return;
  ctx.save();
  ctx.globalAlpha = A;
  ctx.fillStyle = '#0c1513';
  ctx.fillRect(0, 0, LW, LH);
  ctx.restore();
  photoLayer(ctx, tl, el, safe.x, safe.top + 46, LW - safe.x * 2, LH - safe.top - safe.bottom - 70, clamp01(lt / D), w.clip % 2 ? -1 : 1, A);
  // Lớp tối trên/dưới + nhãn "VIDEO THỰC TẾ" (1,8 s đầu mỗi đoạn)
  ctx.save();
  ctx.globalAlpha = A;
  const tg = ctx.createLinearGradient(0, 0, 0, safe.top + 110);
  tg.addColorStop(0, 'rgba(0,0,0,0.55)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tg; ctx.fillRect(0, 0, LW, safe.top + 110);
  const bg = ctx.createLinearGradient(0, LH - safe.bottom - 120, 0, LH);
  bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = bg; ctx.fillRect(0, LH - safe.bottom - 120, LW, safe.bottom + 120);
  const la = Math.min(A, clamp01((1.8 - lt) / 0.35 + 1) * clamp01(lt / 0.25));
  if (la > 0.01) {
    ctx.globalAlpha = la;
    const label = 'VIDEO THỰC TẾ';
    ctx.font = `800 13px ${FONT}`;
    const lw = spacedWidth(ctx, label, 1.2) + 40;
    const top = safe.top + 6, lx = safe.x;
    roundRect(ctx, lx, top, lw, 30, 15);
    ctx.fillStyle = GOLD; ctx.fill();
    ctx.fillStyle = '#e8322b';
    ctx.beginPath(); ctx.arc(lx + 15, top + 15, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10161d'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    fillSpaced(ctx, label, lx + 7 + lw / 2, top + 15.5, 1.2);
  }
  ctx.restore();
}

// ---------- Ảnh thực tế căn nhà ----------
// Mỗi ảnh chạy chậm (phóng/trượt nhẹ), chuyển ảnh mờ dần. Ảnh lệch khung nhiều thì đặt trên nền chính ảnh đó làm mờ.
function photoLayer(ctx, tl, img, x, y, w, h, k, dir, alpha) {
  const { LW, LH } = tl;
  // Ảnh hoặc khung video (video dùng videoWidth/videoHeight)
  if (img.videoWidth) img = { src: img, width: img.videoWidth, height: img.videoHeight };
  else img = { src: img, width: img.width, height: img.height };
  const ar = img.width / img.height, fr = LW / LH;
  const close = Math.max(ar, fr) / Math.min(ar, fr) < 1.3;
  ctx.save();
  ctx.globalAlpha = alpha;
  const cover = Math.max(LW / img.width, LH / img.height);
  if (!close) {
    // Nền: ảnh phủ kín, làm mờ + tối
    const cw = img.width * cover * 1.08, ch = img.height * cover * 1.08;
    try { ctx.filter = 'blur(18px) brightness(0.55)'; } catch { /* trình duyệt không hỗ trợ */ }
    ctx.drawImage(img.src, (LW - cw) / 2, (LH - ch) / 2, cw, ch);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(6,12,14,0.35)';
    ctx.fillRect(0, 0, LW, LH);
    const fit = Math.min(w / img.width, h / img.height) * (1 + 0.06 * k);
    const iw = img.width * fit, ih = img.height * fit;
    const ix = x + (w - iw) / 2 + dir * 8 * (k - 0.5), iy = y + (h - ih) / 2;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
    roundRect(ctx, ix, iy, iw, ih, 14);
    ctx.save(); ctx.clip(); ctx.shadowColor = 'transparent';
    ctx.drawImage(img.src, ix, iy, iw, ih);
    ctx.restore();
  } else {
    const z = cover * (1.04 + 0.1 * k);
    const iw = img.width * z, ih = img.height * z;
    const ox = (iw - LW) / 2, oy = (ih - LH) / 2;
    ctx.drawImage(img.src, -ox + dir * ox * (k - 0.5), -oy - oy * 0.4 * (k - 0.5), iw, ih);
  }
  ctx.restore();
}
function drawPhotos(ctx, tl, t, logo) {
  const ph = tl.photosPh;
  if (!ph || t < ph.t0 || t >= ph.t1) return 0;
  const { LW, LH, safe } = tl;
  const n = tl.photos.length;
  const D = ph.t1 - ph.t0;
  const fade = 0.55;
  const A = Math.min(clamp01((t - ph.t0) / fade), clamp01((ph.t1 - t) / fade));
  if (A <= 0) return 0;
  const slot = (D - 0.4) / n;
  const lt = t - ph.t0;
  const i = Math.min(n - 1, Math.floor(lt / slot));
  const x = safe.x, w = LW - safe.x * 2;
  const y = safe.top + 46, h = LH - safe.top - safe.bottom - 70;
  ctx.save();
  ctx.globalAlpha = A;
  ctx.fillStyle = '#0c1513';
  ctx.fillRect(0, 0, LW, LH);
  ctx.restore();
  const kOf = j => clamp01((lt - j * slot) / (slot + 0.5));
  photoLayer(ctx, tl, tl.photos[i], x, y, w, h, kOf(i), i % 2 ? -1 : 1, A);
  // Chuyển sang ảnh sau: mờ dần trong 0,5 giây cuối của ảnh hiện tại
  const xf = 0.5;
  const into = lt - (i + 1) * slot + xf;
  if (i + 1 < n && into > 0) photoLayer(ctx, tl, tl.photos[i + 1], x, y, w, h, kOf(i + 1), (i + 1) % 2 ? -1 : 1, A * smooth(clamp01(into / xf)));
  // Lớp tối trên/dưới cho chữ dễ đọc
  ctx.save();
  ctx.globalAlpha = A;
  const tg = ctx.createLinearGradient(0, 0, 0, safe.top + 110);
  tg.addColorStop(0, 'rgba(0,0,0,0.6)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tg; ctx.fillRect(0, 0, LW, safe.top + 110);
  const bg = ctx.createLinearGradient(0, LH - safe.bottom - 120, 0, LH);
  bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = bg; ctx.fillRect(0, LH - safe.bottom - 120, LW, safe.bottom + 120);
  // Nhãn "Hình ảnh thực tế" + số thứ tự ảnh
  const top = safe.top + 6;
  const label = 'HÌNH ẢNH THỰC TẾ';
  ctx.font = `800 13px ${FONT}`;
  const lw = spacedWidth(ctx, label, 1.2) + 26;
  const maxX = logo ? logo.x - 10 : LW - safe.x;
  const lx = safe.x;
  roundRect(ctx, lx, top, lw, 30, 15);
  ctx.fillStyle = GOLD; ctx.fill();
  ctx.fillStyle = '#10161d'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  fillSpaced(ctx, label, lx + lw / 2, top + 15.5, 1.2);
  if (n > 1 && lx + lw + 64 < maxX) {
    const cnt = `${Math.min(n, i + (into > xf / 2 ? 2 : 1))}/${n}`;
    ctx.font = `700 13px ${FONT}`;
    const cw = ctx.measureText(cnt).width + 20;
    roundRect(ctx, lx + lw + 8, top, cw, 30, 15);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.fillText(cnt, lx + lw + 8 + cw / 2, top + 15.5);
  }
  ctx.restore();
  return A;
}

function drawHook(ctx, tl, t) {
  const H = tl.hook;
  if (!H || t >= tl.hookEnd + 0.4) return;
  const { LW, LH, safe } = tl;
  const t0 = tl.intro.t0;
  const lt = t - t0;
  const A = t < tl.hookEnd - 0.45 ? clamp01(lt / 0.25 + 0.6) : clamp01((tl.hookEnd + 0.4 - t) / 0.85);
  if (A <= 0) return;
  // Nền: ảnh đẹp nhất của căn (ảnh đầu tiên), không có ảnh thì làm tối bản đồ
  const hw = tl.clipWins && tl.clipWins.find(x => x.hook);
  const hookClip = hw && tl.clips[hw.clip] && clipReady(tl.clips[hw.clip].el) ? tl.clips[hw.clip].el : null;
  if (hookClip || (tl.photos && tl.photos.length)) {
    photoLayer(ctx, tl, hookClip || tl.photos[0], 0, 0, LW, LH, clamp01(lt / (tl.hookEnd - t0 + 0.4)), 1, A);
    ctx.save(); ctx.globalAlpha = A * 0.42; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, LW, LH); ctx.restore();
  } else {
    // Làm tối vừa đủ để chữ nổi nhưng vẫn thấy bản đồ đang bay vào phía sau
    ctx.save(); ctx.globalAlpha = A * 0.36; ctx.fillStyle = '#05090a'; ctx.fillRect(0, 0, LW, LH); ctx.restore();
  }
  // Chữ hiện gần như ngay lập tức (giá ở 0,05 s) để 1 giây đầu đã có thông tin "móc" người xem
  const step = (d0, dur = 0.35) => clamp01((lt - d0) / dur);
  const cy = tl.fmt === 'h' ? LH * 0.45 : LH * 0.43;
  const big = H.isPrice ? H.big.toUpperCase() : H.big.toUpperCase();
  let size = tl.fmt === 'h' ? 58 : 62;
  ctx.save();
  ctx.font = `${ST.title === '3d' ? 800 : ST.headW} ${size}px ${ST.title === '3d' ? FONT : HFONT}`;
  const room = LW - safe.x * 2 - 30;
  const w0 = ctx.measureText(big).width * (ST.title === 'thin' ? 1.4 : 1.12);
  if (w0 > room) size = Math.max(30, size * room / w0);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = A;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Dòng nhỏ phía trên: loại nhà · xã/phường
  const a1 = step(0);
  if (H.kicker && a1 > 0) {
    ctx.save();
    ctx.globalAlpha = A * a1;
    ctx.font = `700 13.5px ${FONT}`;
    ctx.fillStyle = ST.light ? '#ffffff' : ST.acc2;
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
    fillSpaced(ctx, fitOneLine(ctx, H.kicker.toUpperCase(), LW - safe.x * 2 - 40), LW / 2, cy - size * 0.95 - (H.isPrice ? 26 : 0) + (1 - a1) * 8, 1.6);
    if (H.isPrice) {
      ctx.font = `600 13px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      fillSpaced(ctx, 'GIÁ CHỈ', LW / 2, cy - size * 0.95 + (1 - a1) * 8, 3);
    }
    ctx.restore();
  }
  // Giá (hoặc loại nhà) cỡ lớn
  const a2 = step(0.05, ST.pop ? 0.45 : 0.4);
  if (a2 > 0) {
    ctx.save();
    ctx.globalAlpha = A * clamp01(a2 * 1.6);
    ctx.translate(LW / 2, cy + (ST.pop ? 0 : (1 - easeOut(a2)) * 14));
    const sc = ST.pop ? easeOutBack(a2) : 0.92 + 0.08 * easeOut(a2);
    ctx.scale(sc, sc);
    if (ST.title === '3d') text3DCentered(ctx, big, size, GOLD, 1, 'rgba(255,209,102,0.45)');
    else if (ST.title === 'sticker') styledLine(ctx, big, size, ST.acc, 'sticker');
    else {
      ctx.font = `${ST.headW} ${size}px ${HFONT}`;
      const sp = ST.title === 'thin' ? size * 0.12 : size * 0.04;
      if (ST.title === 'thin') { ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12; ctx.textAlign = 'left'; fillSpaced(ctx, big, 0, 0, sp); }
      else styledLine(ctx, big, size, ST.acc, 'serif');
    }
    ctx.restore();
  }
  // Điểm mạnh vị trí: thẻ nổi bật
  const a3 = step(0.45);
  let below = cy + size * 0.85;
  if (H.fact && a3 > 0) {
    ctx.save();
    ctx.globalAlpha = A * a3;
    ctx.font = `800 17px ${FONT}`;
    const txt = fitOneLine(ctx, H.fact, LW - safe.x * 2 - 50);
    const w = ctx.measureText(txt).width + 34, h = 40;
    const y = below + (1 - easeOut(a3)) * 10;
    ctx.translate(LW / 2, y + h / 2);
    if (ST.pop) { const k = easeOutBack(a3); ctx.scale(k, k); ctx.rotate(0.02); }
    roundRect(ctx, -w / 2, -h / 2, w, h, ST.outline ? 4 : ST.light ? 6 : 20);
    if (ST.outline) { ctx.fillStyle = 'rgba(16,13,10,0.75)'; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = GOLD; ctx.stroke(); ctx.fillStyle = ST.acc2; }
    else if (ST.light) { ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill(); ctx.fillStyle = ST.ink; }
    else { ctx.fillStyle = ST.pop ? ST.acc2 : GOLD; ctx.fill(); ctx.fillStyle = ST.pop ? '#1d1030' : ST.accInk; }
    ctx.fillText(txt, 0, 1);
    ctx.restore();
    below += h + 14;
  }
  const a4 = step(0.65);
  if (H.det && a4 > 0) {
    ctx.save();
    ctx.globalAlpha = A * a4;
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 6;
    ctx.fillText(fitOneLine(ctx, H.det, LW - safe.x * 2 - 30), LW / 2, below + 12);
    ctx.restore();
  }
  ctx.restore();
}
// Khung điện ảnh (phong cách sang trọng): 2 dải đen trên/dưới lúc mở đầu và lúc kết
function drawBars(ctx, tl, t) {
  if (!ST.bars) return;
  const { LW, LH } = tl;
  const T = tl.duration;
  const endA = tl.hookEnd || tl.intro.t0 + 1.2;
  const a = Math.max(t < endA ? 1 : clamp01(1 - (t - endA) / 0.8), clamp01((t - tl.outro.t0 - 0.2) / 0.8) * (t < T ? 1 : 0));
  if (a <= 0) return;
  const h = Math.round(LH * (tl.fmt === 'h' ? 0.085 : 0.06) * easeOut(a));
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, LW, h);
  ctx.fillRect(0, LH - h, LW, h);
  ctx.fillStyle = GOLD; ctx.globalAlpha = 0.65 * a;
  ctx.fillRect(0, h - 1, LW, 1); ctx.fillRect(0, LH - h, LW, 1);
  ctx.restore();
}

function brandTop(tl) {
  const { LH, safe, scene } = tl;
  if (!scene.brand && !scene.phone) return Infinity;
  const bottom = LH - safe.bottom + (tl.fmt === 'v' ? -6 : 0);
  return scene.phone ? bottom - 46 - (scene.brand ? 34 : 0) : bottom - 38;
}

// ---------- Khung hình ----------
// Vẽ tường sáng trên màn hình: chân tường bám mặt đường, đỉnh nâng lên theo phối cảnh (gần to, xa nhỏ),
// mặt tường mờ dần lên trên, mép trên là thanh sáng. Chỉ phần đường đã chạy tới (dist ≤ rr) mới có tường.
function drawHiWall(ctx, P, v, W, t, LW, LH) {
  const H0 = 11 * W.k; // độ nâng line (px màn hình ở độ sâu chuẩn); kẹp tối đa 18 px để line không tách xa con đường
  if (H0 < 0.5 || W.a < 0.02) return;
  const runs = [];
  for (const l of W.r.lines) {
    let cur = null;
    const n = l.xs.length;
    const pt = (x, y) => { const q = gOf(v, x, y); const b = g2s(P, q.x, q.y); return b.w > 0.05 ? { x: b.x, y: b.y, h: Math.min(18 * W.k, H0 / b.w) } : null; };
    for (let i = 0; i < n; i++) {
      if (l.dist[i] > W.rr) {
        if (cur && i > 0) {
          const f = (W.rr - l.dist[i - 1]) / (l.dist[i] - l.dist[i - 1]);
          const q = pt(l.xs[i - 1] + (l.xs[i] - l.xs[i - 1]) * f, l.ys[i - 1] + (l.ys[i] - l.ys[i - 1]) * f);
          if (q) cur.push(q);
        }
        if (cur && cur.length > 1) runs.push(cur);
        cur = null;
        continue;
      }
      if (!cur) {
        cur = [];
        if (i > 0) {
          const f = (W.rr - l.dist[i]) / (l.dist[i - 1] - l.dist[i]);
          const q = pt(l.xs[i] + (l.xs[i - 1] - l.xs[i]) * f, l.ys[i] + (l.ys[i - 1] - l.ys[i]) * f);
          if (q) cur.push(q);
        }
      }
      // Chia nhỏ đoạn dài để đỉnh tường cong đúng phối cảnh
      if (i > 0 && cur.length && l.dist[i - 1] <= W.rr) {
        for (let k = 1; k < 4; k++) {
          const f = k / 4;
          const q = pt(l.xs[i - 1] + (l.xs[i] - l.xs[i - 1]) * f, l.ys[i - 1] + (l.ys[i] - l.ys[i - 1]) * f);
          if (q) cur.push(q);
        }
      }
      const q = pt(l.xs[i], l.ys[i]);
      if (q) cur.push(q);
    }
    if (cur && cur.length > 1) runs.push(cur);
  }
  if (!runs.length) return;
  const C = HI_ROAD;
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; };
  const gl = rgb(C.glow);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const run of runs) {
    // Màn sáng mờ nối mặt đất lên line (rất nhạt, không có mép riêng) để line trông như đang nổi
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i];
      if (Math.max(a.x, b.x) < -40 || Math.min(a.x, b.x) > LW + 40 || Math.max(a.y, b.y) < -60 || Math.min(a.y, b.y) - Math.max(a.h, b.h) > LH + 40) continue;
      const hm = (a.h + b.h) / 2, ym = (a.y + b.y) / 2;
      const gr = ctx.createLinearGradient(0, ym, 0, ym - hm);
      gr.addColorStop(0, `rgba(${gl},0)`);
      gr.addColorStop(1, `rgba(${gl},${0.32 * W.a})`);
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y - b.h); ctx.lineTo(a.x, a.y - a.h); ctx.closePath();
      ctx.fill();
    }
    // MỘT line sáng duy nhất, nâng lên khỏi mặt đất
    const top = new Path2D();
    run.forEach((q, i) => (i ? top.lineTo(q.x, q.y - q.h) : top.moveTo(q.x, q.y - q.h)));
    ctx.globalAlpha = W.a * 0.18; ctx.strokeStyle = C.glow; ctx.lineWidth = 17; ctx.stroke(top);
    ctx.globalAlpha = W.a * 0.5; ctx.strokeStyle = C.glow; ctx.lineWidth = 7.6; ctx.stroke(top);
    ctx.globalAlpha = W.a; ctx.strokeStyle = C.core; ctx.lineWidth = 3.7;
    ctx.shadowColor = C.glow; ctx.shadowBlur = 12; ctx.stroke(top);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = W.a * 0.9; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4; ctx.stroke(top);
    // Xung sáng trắng chạy dọc line (cộng sáng)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.setLineDash([16, 74]); ctx.lineDashOffset = -t * 95;
    ctx.globalAlpha = W.a * 0.55; ctx.strokeStyle = C.core; ctx.lineWidth = 9.4; ctx.stroke(top);
    ctx.globalAlpha = W.a; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.4; ctx.stroke(top);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

export function render(ctx, tl, t, { cache, scale = 1, request = false }) {
  useStyle(tl.scene.style);
  useHiTheme(tl.scene.hiTheme);
  useBase(tl.scene.base);
  const { LW, LH, safe, scene } = tl;
  const T = tl.duration;
  const cam = camAt(tl, t);
  const P = proj(cam.pitch, LW, LH);
  const gs = scale;
  const G = groundCanvas(tl, gs);
  const g = G.getContext('2d');
  g.setTransform(gs, 0, 0, gs, tl.G.GOX * gs, tl.G.GOY * gs);
  const rect = groundRect(P);
  drawTiles(g, cache, cam, rect, gs, request);

  // Tông màu như video mẫu: xanh lục tối, giảm chói
  // Phủ màu theo nền bản đồ: "Vệ tinh rõ nét" giữ màu thật; "tông phim" dùng màu của phong cách
  const tintA = BASE.tintA ?? 0;
  if (tintA > 0) {
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = tintA;
    g.fillStyle = BASE.tint || ST.tint;
    g.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  const dark = BASE.dark ?? ST.dark;
  if (dark > 0) {
    g.fillStyle = `rgba(6,14,18,${dark})`;
    g.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
  }

  const v = viewOf(cam);
  const H = scene.house;
  const hg = gLL(v, H.lat, H.lng);
  const ov = tl.overview, ho = tl.house, sm = tl.summary, ou = tl.outro, bp = tl.boundaryPh;
  const roadsEnd = tl.roadsEnd;
  const firstPoi = tl.poiPhases[0];
  const inRoads = t >= ov.t0 && t < roadsEnd;

  // Vòng bán kính
  let ringA = 0, ringP = 0;
  if (t >= ov.t0) {
    const d = ov.t1 - ov.t0;
    ringP = clamp01((t - ov.t0 - 0.3 * d) / (0.6 * d));
    ringA = t < roadsEnd ? 1 : Math.max(0, 1 - (t - roadsEnd) / 0.6);
    if (tl.radarPh && t >= tl.radarPh.t0 && (!sm || t < sm.t0)) ringA = Math.max(ringA, clamp01((t - tl.radarPh.t0) / 0.5));
    if (sm && t >= sm.t0) ringA = Math.min(0.7, clamp01((t - sm.t0) / 0.8));
    if (t >= ou.t0) ringA = Math.max(0, 0.7 - (t - ou.t0) / 0.8);
    // Cảnh kết nối vùng / hạ tầng: ẩn vòng bán kính và nhãn của nó cho đỡ rối
    const rgS = tl.regionPh || tl.infraPh, rgE = tl.infraPh || tl.regionPh;
    if (rgS) ringA *= 1 - fadeWin(t, rgS.t0, rgE.t1 + 0.6, 0.5, 0.6);
  }
  const rpx = scene.radiusKm * 1000 / metersPerPixel(H.lat, cam.zoom);
  if (ringP > 0 && ringA > 0.01) {
    g.save();
    g.globalAlpha = ringA;
    g.beginPath();
    g.arc(hg.x, hg.y, rpx, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ringP);
    g.setLineDash([10, 8]);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 2.2;
    g.stroke();
    g.setLineDash([]);
    if (ringP >= 1) {
      g.fillStyle = 'rgba(94,234,245,0.05)';
      g.beginPath(); g.arc(hg.x, hg.y, rpx, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // Trục đường lớn: vẽ dần từng tuyến từ điểm gần nhà nhất toả ra hai phía
  let roadAlpha = 0;
  if (tl.roadPhases.length && t >= tl.roadPhases[0].t0) {
    roadAlpha = t < roadsEnd ? 1 : Math.max(0.26, 1 - (t - roadsEnd) / 0.7);
    if (sm && t >= sm.t0) roadAlpha = 0.26 + 0.34 * clamp01((t - sm.t0) / 0.8);
    if (t >= ou.t0) roadAlpha = Math.max(0.3, 0.6 - (t - ou.t0) / 0.8);
  }
  const roadHeads = [];
  const hiWalls = [];
  tl.roadPhases.forEach(ph => {
    if (t < ph.t0) return;
    const r = tl.roads[ph.road];
    const d = ph.t1 - ph.t0;
    const p = t >= ph.t1 ? 1 : clamp01((t - ph.t0 - 0.12 * d) / (0.68 * d));
    const rr = smooth(p) * r.rrMax;
    const st = roadStyleOf(scene, r);
    const heads = [];
    const paths = r.lines.map(l => revealPath(v, l, rr, heads));
    if (r.hi) {
      // Điểm nhấn: giữ sáng rõ hơn các tuyến khác cả ở cảnh tổng kết
      const a = Math.max(roadAlpha, t >= roadsEnd && t < ou.t0 ? 0.62 : 0);
      g.lineCap = 'round'; g.lineJoin = 'round';
      // Dưới đất chỉ có bóng đổ + quầng màu nhạt (line sáng thật vẽ nổi lên trên màn hình ở drawHiWall)
      for (const path of paths) {
        g.globalAlpha = a * 0.4; g.strokeStyle = '#000000'; g.lineWidth = 7.6; g.stroke(path);
        g.globalAlpha = a * 0.22; g.strokeStyle = HI_ROAD.glow; g.lineWidth = 19; g.stroke(path);
      }
      g.globalAlpha = 1;
      hiWalls.push({ r, rr, a, k: easeOut(clamp01((t - ph.t0 - 0.12 * d) / 0.9)) });
    } else for (const path of paths) glowStroke(g, path, st.core, st.glow, st.w, roadAlpha);
    if (p > 0 && p < 1) for (const hd of heads) roadHeads.push({ p: hd, c: st.core });
    // Đường nối nhà → trục đường (chỉ trong đoạn của tuyến này)
    const ca = fadeWin(t, ph.t0 + 0.05 * d, ph.t1 + 0.1, 0.4, 0.35);
    if (ca > 0) {
      const pg = gLL(v, r.P.lat, r.P.lng);
      g.save();
      g.globalAlpha = ca;
      g.setLineDash([3, 6]);
      g.lineCap = 'round';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(hg.x, hg.y); g.lineTo(pg.x, pg.y); g.stroke();
      g.setLineDash([]);
      g.beginPath(); g.arc(pg.x, pg.y, 5, 0, Math.PI * 2);
      g.fillStyle = st.core; g.fill();
      g.lineWidth = 2; g.stroke();
      g.restore();
    }
  });
  for (const hd of roadHeads) headGlow(g, hd.p, hd.c, 16);

  const roadLabelA = t < roadsEnd ? 1 : Math.max(0, 1 - (t - roadsEnd) / 0.5);

  // Ranh giới tỉnh/thành: chỉ hiện trong đoạn riêng, sau đó ẩn cho đỡ rối
  const B = tl.boundary;
  let bA = 0, bRR = 0;
  if (B && bp && t >= bp.t0) {
    const d = bp.t1 - bp.t0;
    bRR = smooth(clamp01((t - bp.t0 - 0.16 * d) / (0.44 * d))) * B.rrMax;
    bA = t < bp.t1 ? 1 : Math.max(0, 1 - (t - bp.t1) / 0.6);
    if (sm && t >= sm.t0) { bA = 0.45 * clamp01((t - sm.t0) / 0.8); bRR = B.rrMax; }
    if (t >= ou.t0) bA = Math.max(0, 0.45 - (t - ou.t0) / 0.6);
  }
  // Làm sáng CẢ VÙNG tỉnh/thành bên kia ranh (vd. qua ranh là TP.HCM thì TP.HCM sáng lên), cùng màu chữ tên tỉnh bên kia
  if (B && bp && B.rings && B.rings.length && t >= bp.t0) {
    const d = bp.t1 - bp.t0;
    let aA = fadeWin(t, bp.t0 + 0.3 * d, bp.t1 + 0.4, 0.9, 0.6);
    if (sm && t >= sm.t0 && t < ou.t0) aA = Math.max(aA, 0.35 * clamp01((t - sm.t0) / 0.8));
    if (aA > 0.01) {
      const pth = new Path2D();
      for (const r of B.rings) r.forEach((p, i) => { const q = gLL(v, p[0], p[1]); i ? pth.lineTo(q.x, q.y) : pth.moveTo(q.x, q.y); });
      const pulse = 0.85 + 0.15 * Math.sin(t * 3);
      g.save();
      g.lineJoin = 'round';
      g.globalAlpha = aA * 0.24 * pulse; g.fillStyle = CYAN; g.fill(pth, 'evenodd');
      g.globalAlpha = aA * 0.35; g.strokeStyle = CYAN; g.lineWidth = 12; g.stroke(pth);
      g.globalAlpha = aA; g.strokeStyle = '#E6FDFF'; g.lineWidth = 2.6; g.shadowColor = CYAN; g.shadowBlur = 14; g.stroke(pth);
      g.restore();
    }
  }
  if (bA > 0.01 && bRR > 0) {
    const heads = [];
    const paths = B.lines.map(l => revealPath(v, l, bRR, heads));
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const path of paths) {
      g.globalAlpha = bA * 0.16; g.strokeStyle = CYAN; g.lineWidth = 20; g.stroke(path);
      g.globalAlpha = bA * 0.45; g.strokeStyle = PINK; g.lineWidth = 10; g.stroke(path);
      g.globalAlpha = bA; g.lineWidth = 4.6; g.stroke(path);
      g.save();
      g.globalAlpha = bA * 0.95; g.strokeStyle = '#ffffff'; g.lineWidth = 2.4;
      g.setLineDash([0.1, 9]); g.lineDashOffset = -t * 16;
      g.stroke(path);
      g.restore();
    }
    g.globalAlpha = 1;
    if (t < bp.t1) for (const hd of heads) headGlow(g, hd, PINK, 18);
    // Đường từ nhà tới chỗ qua ranh
    if (t < bp.t1 + 0.6 && t >= bp.t0) {
      const d = bp.t1 - bp.t0;
      const rp = clamp01((t - bp.t0 - 0.56 * d) / (0.24 * d));
      if (rp > 0) {
        const L = B.routeLine;
        const { path, head } = linePath(v, L, L.len * smooth(rp));
        if (B.approx) g.setLineDash([8, 7]);
        const rs = routeStyle(scene);
        glowStroke(g, path, rs.core, rs.glow, 3.6, Math.min(1, bA * 1.2));
        g.setLineDash([]);
        if (head && rp < 1) headGlow(g, head, rs.core, 13);
      }
    }
  }

  // Vùng lái xe 5 – 10 – 15 phút: phủ màu nhạt + viền sáng, mỗi vùng lan ra từ căn nhà (thu phóng quanh nhà)
  if (tl.isoPh && scene.iso && scene.iso.areas) {
    const aIso = isoAlpha(tl, t);
    if (aIso > 0.01) {
      const areas = scene.iso.areas;
      g.save();
      g.lineJoin = 'round';
      for (let idx = areas.length - 1; idx >= 0; idx--) {
        const ar = areas[idx];
        const k = isoReveal(tl, idx, t);
        if (k <= 0.001) continue;
        const pth = new Path2D();
        for (const r of ar.rings) r.forEach((p, i) => {
          const q = gLL(v, p[0], p[1]);
          const x = hg.x + (q.x - hg.x) * k, y = hg.y + (q.y - hg.y) * k;
          i ? pth.lineTo(x, y) : pth.moveTo(x, y);
        });
        const col = isoColor(ar.min);
        g.globalAlpha = aIso * k * 0.16; g.fillStyle = col; g.fill(pth, 'evenodd');
        g.globalAlpha = aIso * k * 0.45; g.strokeStyle = col; g.lineWidth = 9; g.stroke(pth);
        g.globalAlpha = aIso * k; g.strokeStyle = '#ffffff'; g.lineWidth = 2.4; g.shadowColor = col; g.shadowBlur = 12; g.stroke(pth);
        g.shadowBlur = 0;
      }
      g.restore();
    }
  }

  // Kết nối vùng: đường đi thật tới từng điểm mốc lớn, mỗi loại một màu, lần lượt chạy ra
  if (tl.regionPh && tl.anchors.length) {
    const aH = hubAlpha(tl, t);
    if (aH > 0.01) tl.anchors.forEach((a, i) => {
      const k = hubReveal(tl, i, t);
      if (k <= 0) return;
      const col = HUB_COL[a.type] || GOLD;
      const { path, head } = linePath(v, a.line, a.line.len * smooth(k));
      if (a.approx) g.setLineDash([8, 7]);
      glowStroke(g, path, col, col, 3.4, aH);
      g.setLineDash([]);
      if (head && k < 1) headGlow(g, head, col, 13);
    });
  }
  // Hạ tầng đang thi công: nét đứt vàng/đen kiểu rào công trường, chạy ra hai phía từ điểm gần nhà nhất
  if (tl.infraPh && tl.infra.length) {
    const aI = infraAlpha(tl, t);
    const ph = tl.infraPh;
    if (aI > 0.01) tl.infra.forEach((r, i) => {
      const k = infraReveal(tl, i, t);
      if (k <= 0) return;
      const heads = [];
      const paths = r.lines.map(l => revealPath(v, l, infraRR(tl, i, t), heads));
      g.save();
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const path of paths) {
        g.globalAlpha = aI * 0.28; g.strokeStyle = '#FF8A00'; g.lineWidth = 18; g.stroke(path);
        g.globalAlpha = aI * 0.85; g.strokeStyle = '#17110a'; g.lineWidth = 7.4; g.stroke(path);
        g.lineCap = 'butt';
        g.globalAlpha = aI; g.strokeStyle = INFRA_COL; g.lineWidth = 5; g.setLineDash([12, 9]); g.lineDashOffset = -t * 22; g.stroke(path);
        g.setLineDash([]); g.lineCap = 'round';
      }
      g.restore();
      if (t < ph.t1 && infraRR(tl, i, t) < r.rrMax) for (const hd of heads) headGlow(g, hd, INFRA_COL, 15);
      // Nét chấm trắng từ nhà tới điểm gần nhất của tuyến (chỉ trong cảnh hạ tầng)
      const ca = Math.min(fadeWin(t, ph.t0 + 0.2 * (ph.t1 - ph.t0), ph.t1 + 0.1, 0.4, 0.35), clamp01(k * 3));
      if (ca > 0.01) {
        const pg = gLL(v, r.P.lat, r.P.lng);
        g.save();
        g.globalAlpha = ca; g.setLineDash([3, 6]); g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(hg.x, hg.y); g.lineTo(pg.x, pg.y); g.stroke();
        g.setLineDash([]);
        g.beginPath(); g.arc(pg.x, pg.y, 5.5, 0, Math.PI * 2); g.fillStyle = INFRA_COL; g.fill(); g.lineWidth = 2; g.stroke();
        g.restore();
      }
    });
  }

  // Khoanh vùng hành chính ở cảnh mở đầu: xã/phường sáng lên ở trung cảnh, rồi lùi ra vẽ nổi cả tỉnh/thành phố.
  // Ngoài vùng tối lại; ghim bất động sản luôn hiện.
  const AR = scene.adminArea, PV = tl.provPh;
  if (AR && AR.ward && AR.ward.rings && AR.ward.rings.length) {
    const it = tl.intro;
    const i0 = it.t0 + (it.hold || 0);
    const iEnd = it.t1;
    const pvEnd = PV ? PV.t1 : iEnd;
    // xã/phường: sáng từ giữa cảnh trung, giữ suốt cảnh tỉnh (mờ bớt), tắt khi bay về cận cảnh
    const wardA = fadeWin(t, i0 + 0.68 * (iEnd - i0), ho.t0 + 0.4 * (ho.t1 - ho.t0), 0.8, 1.0);
    const provA = PV ? fadeWin(t, PV.t0 + 0.1, ho.t0 + 0.5, 0.9, 1.0) : 0;
    const ringPath = rings => {
      const pth = new Path2D();
      for (const r of rings) r.forEach((p, i) => { const q = gLL(v, p[0], p[1]); i ? pth.lineTo(q.x, q.y) : pth.moveTo(q.x, q.y); });
      return pth;
    };
    const R0 = rect;
    const dim = (pth, a) => {
      const m = new Path2D();
      m.rect(R0.x0 - 50, R0.y0 - 50, R0.x1 - R0.x0 + 100, R0.y1 - R0.y0 + 100);
      m.addPath(pth);
      g.fillStyle = `rgba(4,8,12,${0.6 * a})`;
      g.fill(m, 'evenodd');
    };
    g.save();
    g.lineJoin = 'round';
    if (provA > 0.01 && AR.province?.rings?.length) {
      const pp = ringPath(AR.province.rings);
      dim(pp, provA);
      const draw = clamp01((t - PV.t0 - 0.2) / 1.8);
      g.globalAlpha = provA * 0.16; g.fillStyle = '#FFD54A'; g.fill(pp, 'evenodd');
      g.globalAlpha = provA * 0.5; g.strokeStyle = '#FFB800'; g.lineWidth = 9; g.stroke(pp);
      g.globalAlpha = provA * (0.4 + 0.6 * draw); g.strokeStyle = '#FFF4C2'; g.lineWidth = 2.6; g.shadowColor = '#FFB800'; g.shadowBlur = 12; g.stroke(pp);
      g.shadowBlur = 0;
    }
    if (wardA > 0.01) {
      const wp = ringPath(AR.ward.rings);
      g.globalAlpha = 1;
      if (provA < 0.5) dim(wp, wardA * (1 - provA));
      g.globalAlpha = wardA * (provA > 0.3 ? 0.3 : 0.2); g.fillStyle = '#FFD54A'; g.fill(wp, 'evenodd');
      g.globalAlpha = wardA * 0.5; g.strokeStyle = '#FFB800'; g.lineWidth = 11; g.stroke(wp);
      g.globalAlpha = wardA; g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.shadowColor = '#FFB800'; g.shadowBlur = 14; g.stroke(wp);
      g.shadowBlur = 0;
    }
    g.restore();

    // Tên xã/phường và tỉnh/thành: chữ phẳng Montserrat in dẹt trên bản đồ, vàng, đổ bóng đậm, gần ghim nhà, không tràn khung
    const flatName = (text, alpha, dy, maxSize) => {
      if (!text || alpha <= 0.01) return;
      g.save();
      g.globalAlpha = alpha;
      g.font = `900 100px ${NAME_FONT}`;
      const w100 = g.measureText(text).width / 100;
      const y = hg.y + dy;
      // Chữ nằm trên mặt đất: ra màn hình bị thu theo phối cảnh (w). Tính cỡ và vị trí để TOÀN BỘ chữ nằm trong khung,
      // ghim sát mép thì chữ tự dịch vào trong (không canh giữa cứng tại ghim)
      const sp = g2s(P, hg.x, y);
      const minX = safe.x + 10, maxX = LW - safe.x - 10;
      let size = Math.max(14, Math.min(maxSize, ((maxX - minX) * 0.96 * sp.w) / Math.max(w100, 0.1)));
      const halfS = (w100 * size * 1.08) / 2 / sp.w; // nửa bề rộng trên màn hình (cộng phần bóng đổ)
      const sx = Math.max(minX + halfS, Math.min(maxX - halfS, sp.x));
      const x = (sx - LW / 2) * sp.w;
      g.font = `900 ${size}px ${NAME_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      // bóng đậm: nhiều lớp lệch xuống dưới-phải + viền tối
      g.fillStyle = 'rgba(0,0,0,0.85)';
      for (let k = 1; k <= 5; k++) g.fillText(text, x + k * size * 0.018, y + k * size * 0.03);
      g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = size * 0.35; g.shadowOffsetY = size * 0.06;
      g.lineJoin = 'round'; g.lineWidth = Math.max(2, size * 0.1); g.strokeStyle = 'rgba(20,12,0,0.95)';
      g.strokeText(text, x, y);
      g.shadowBlur = 0; g.shadowOffsetY = 0;
      const gr = g.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
      gr.addColorStop(0, '#FFE680'); gr.addColorStop(1, '#FFC107');
      g.fillStyle = gr;
      g.fillText(text, x, y);
      g.restore();
    };
    const wName = String(AR.wardName || '').toUpperCase(), pName = String(AR.provName || '').toUpperCase();
    const wNameA = Math.min(wardA, fadeWin(t, i0 + 0.4 * (iEnd - i0), PV ? PV.t0 + 1.0 : ho.t0 + 0.4, 0.5, 0.6));
    const pNameA = PV ? fadeWin(t, PV.t0 + 0.6, ho.t0 + 0.4, 0.6, 0.7) : 0;
    flatName(wName, wNameA, 64, 44);
    flatName(pName, pNameA, 64, 48);
  }

  // Đường quanh nhà kiểu đường nhựa (viền sáng, mặt nhựa, vạch giữa) ở cảnh giới thiệu căn nhà
  const STR = scene.showStreets === false ? null : scene.streets;
  if (STR && STR.lines && STR.lines.length) {
    const hd0 = ho.t1 - ho.t0;
    const sA = fadeWin(t, ho.t0 + 0.12 * hd0, ov.t0 + 1.4, 0.7, 0.9);
    if (sA > 0.01) {
      // Line mảnh (khoảng 45% bề rộng thật, tối đa 9 px) để không lấn vào nhà và lô đất
      const pxPerM = 1 / metersPerPixel(H.lat, cam.zoom);
      const paths = STR.lines.map(r => {
        const pth = new Path2D();
        r.pts.forEach((p, i) => { const q = gLL(v, p[0], p[1]); i ? pth.lineTo(q.x, q.y) : pth.moveTo(q.x, q.y); });
        return { pth, wpx: Math.min(9, Math.max(1.4, r.w * 0.45 * pxPerM)) };
      });
      g.save();
      g.lineCap = 'round'; g.lineJoin = 'round';
      // Không vẽ đè lên lô đất: cắt bỏ vùng lô (mở rộng thêm một chút) khỏi lớp đường
      if (tl.lot) {
        const m = new Path2D();
        m.rect(rect.x0 - 50, rect.y0 - 50, rect.x1 - rect.x0 + 100, rect.y1 - rect.y0 + 100);
        const lxy = tl.lot.map(p => gLL(v, p.lat, p.lng));
        const lc = lxy.reduce((o, q) => ({ x: o.x + q.x / lxy.length, y: o.y + q.y / lxy.length }), { x: 0, y: 0 });
        lxy.forEach((q, i) => { const x = lc.x + (q.x - lc.x) * 1.12, y = lc.y + (q.y - lc.y) * 1.12; i ? m.lineTo(x, y) : m.moveTo(x, y); });
        m.closePath();
        g.clip(m, 'evenodd');
      }
      g.globalAlpha = sA * 0.92;
      for (const { pth, wpx } of paths) { g.strokeStyle = 'rgba(245,245,240,0.9)'; g.lineWidth = wpx + Math.max(1.2, wpx * 0.18); g.stroke(pth); }
      for (const { pth, wpx } of paths) { g.strokeStyle = '#34373c'; g.lineWidth = wpx; g.stroke(pth); }
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      for (const { pth, wpx } of paths) {
        if (wpx < 6) continue;
        g.lineWidth = Math.max(0.8, wpx * 0.07); g.setLineDash([wpx * 0.9, wpx * 0.9]); g.stroke(pth);
      }
      g.setLineDash([]);
      g.restore();
      // Tên đường trước nhà in nằm trên mặt đường
      const fr = STR.front;
      if (fr) {
        const nm = String(fr.name || '');
        const rw = String(scene.roadWidth || '').trim().replace(/^(\d+(?:[.,]\d+)?)\s*$/, '$1M');
        const text = (/^(đường|hẻm|ngõ|kiệt|quốc lộ|tỉnh lộ|đại lộ)\b/i.test(nm) ? nm : 'Đường ' + nm).toUpperCase() + (rw ? ' · ' + rw.toUpperCase() : '');
        const rise = clamp01((t - ho.t0 - 0.3 * hd0) / 0.8);
        groundText(g, v, { text, size: Math.min(30, Math.max(16, 360 / Math.max(8, text.length))), at: fr.at, a: fr.a, b: fr.b }, '#FFD166', sA * clamp01(rise * 1.5), easeOut(rise));
      }
    }
  }

  // Ranh lô đất: viền chạy vòng quanh lô + nền sáng nhấp nháy + sóng lan ra khi giới thiệu căn nhà; sau đó giữ viền mảnh
  const LOT = tl.lot;
  let lotShape = null;
  if (LOT) {
    const xy = LOT.map(p => gLL(v, p.lat, p.lng));
    const path = new Path2D();
    xy.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
    path.closePath();
    let per = 0;
    for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length]; per += Math.hypot(b.x - a.x, b.y - a.y); }
    const c = xy.reduce((o, q) => ({ x: o.x + q.x / xy.length, y: o.y + q.y / xy.length }), { x: 0, y: 0 });
    const r = Math.max(...xy.map(q => Math.hypot(q.x - c.x, q.y - c.y)));
    lotShape = { c, r };
    const hd = ho.t1 - ho.t0;
    const draw = clamp01((t - ho.t0 - 0.25 * hd) / (0.4 * hd));       // viền chạy quanh lô
    const focus = fadeWin(t, ho.t0 + 0.25 * hd, ov.t0 + 0.8, 0.4, 0.8);  // lúc đang giới thiệu lô
    const keepA = t >= ou.t0 ? 0.85 : 0.65;
    if (draw > 0) {
      g.save();
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      g.globalAlpha = focus * (0.22 + 0.16 * pulse) + (1 - focus) * 0.12;
      g.fillStyle = GOLD; g.fill(path);
      // viền phát sáng, chạy dần cho đủ một vòng
      g.setLineDash([per * draw, per]);
      g.lineJoin = 'round';
      g.globalAlpha = Math.max(focus, keepA) * 0.45; g.strokeStyle = GOLD; g.lineWidth = 18; g.stroke(path);
      g.globalAlpha = Math.max(focus, keepA); g.lineWidth = 6; g.strokeStyle = GOLD; g.stroke(path);
      g.lineWidth = 2.6; g.strokeStyle = '#ffffff'; g.shadowColor = GOLD; g.shadowBlur = 12; g.stroke(path);
      g.setLineDash([]);
      // sóng khoanh vùng lan ra từ lô
      if (focus > 0.05) {
        g.shadowBlur = 0; g.lineWidth = 2.4; g.strokeStyle = GOLD;
        for (let k = 0; k < 3; k++) {
          const q = ((t - ho.t0) / 1.6 + k / 3) % 1;
          g.globalAlpha = focus * (1 - q) * 0.8;
          g.beginPath(); g.arc(c.x, c.y, r * (1.15 + q * 2.2), 0, Math.PI * 2); g.stroke();
        }
      }
      g.restore();
    }
    // Chữ 3D nằm dẹt trên lô: nội dung + diện tích khách tự nhập
    const lbl = scene.lotLabel || {};
    const line1 = String(lbl.text || 'LÔ ĐẤT').trim().toUpperCase();
    const line2 = String(lbl.area || '').trim() || formatArea(tl.lotArea);
    const txtA = Math.max(fadeWin(t, ho.t0 + 0.5 * hd, ov.t0 + 0.7, 0.5, 0.6), fadeWin(t, ou.t0 + 0.3, T + 10, 0.5, 0.4) * 0.9);
    if (txtA > 0.01) {
      const rise = easeOut(clamp01((t - ho.t0 - 0.5 * hd) / 0.8));
      // Chữ luôn nằm TRONG ranh lô: cỡ chữ theo khoảng trống bên trong lô, cắt theo ranh cho chắc chắn
      const xs = xy.map(q => q.x), ys = xy.map(q => q.y);
      const lotW = Math.max(...xs) - Math.min(...xs), lotH = Math.max(...ys) - Math.min(...ys);
      g.save();
      g.globalAlpha = txtA;
      g.font = `800 100px ${FONT}`;
      const w1 = (g.measureText(line1).width + 7 * line1.length) / 100, w2 = (g.measureText(line2).width + 7 * line2.length) / 100 * 0.86;
      const size = Math.max(4, Math.min(64, (lotW * 0.72) / Math.max(w1, w2, 0.1), (lotH * 0.6) / 2.05));
      // tâm khối chữ: trọng tâm lô, lệch xuống nếu ghim nhà ở gần tâm (vẫn trong lô)
      const pinNear = Math.abs(hg.x - c.x) < lotW * 0.3 && Math.abs(hg.y - c.y) < lotH * 0.3;
      const cy = c.y + (pinNear ? Math.min(lotH * 0.16, lotH * 0.5 - size * 1.1) : 0);
      g.clip(path);
      const draw3d = (text, sz, y, col) => {
        g.save();
        g.translate(c.x, y); // text3D tự canh giữa
        text3D(g, text, sz, { faceTop: '#FFFFFF', faceBot: col, side: shade(GOLD.startsWith('#') ? GOLD : '#FFD166', 0.45), depth: sz * 0.22 * rise, ex: 0, ey: 1,
          sp: sz * 0.07, glow: 'rgba(0,0,0,0.7)', stroke: 'rgba(0,0,0,0.35)', outline: 'rgba(8,10,14,0.9)' });
        g.restore();
      };
      draw3d(line1, size, cy - size * 0.52, '#FFF3D0');
      draw3d(line2, size * 0.86, cy + size * 0.6, '#FFE08A');
      g.restore();
    }
  }

  // Tia quét radar quay quanh căn nhà: lúc giới thiệu bán kính, pha quét (chế độ vòng tròn) và cảnh tổng kết
  const sweeps = [[ov.t0 + 0.3 * (ov.t1 - ov.t0), ov.t1 + 0.3]];
  if (tl.radarPh) sweeps.push([tl.radarPh.t0, tl.radarPh.t1 + 0.6]);
  if (sm) sweeps.push([sm.t0 + 0.2, Math.min(sm.t1, sm.t0 + 3.2)]);
  for (const [s0, s1] of sweeps) {
    if (t < s0 || t >= s1 || rpx < 8) continue;
    const sa = Math.min(clamp01((t - s0) / 0.4), clamp01((s1 - t) / 0.6));
    const ang = -Math.PI / 2 + ((t - s0) / 1.25) * Math.PI * 2;
    const wedge = 0.9;
    g.save();
    for (let k = 0; k < 14; k++) {
      const a0 = ang - wedge * (k + 1) / 14, a1 = ang - wedge * k / 14;
      g.beginPath(); g.moveTo(hg.x, hg.y); g.arc(hg.x, hg.y, rpx, a0, a1); g.closePath();
      g.fillStyle = ST.acc2; g.globalAlpha = sa * 0.3 * (1 - k / 14); g.fill();
    }
    g.globalAlpha = sa;
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.2; g.shadowColor = ST.acc2; g.shadowBlur = 14;
    g.beginPath(); g.moveTo(hg.x, hg.y); g.lineTo(hg.x + Math.cos(ang) * rpx, hg.y + Math.sin(ang) * rpx); g.stroke();
    // Gợn sóng lan từ nhà ra vòng
    g.shadowBlur = 0; g.lineWidth = 2; g.strokeStyle = ST.acc2;
    for (let k = 0; k < 2; k++) {
      const q = ((t - s0) / 1.3 + k / 2) % 1;
      g.globalAlpha = sa * (1 - q) * 0.7;
      g.beginPath(); g.arc(hg.x, hg.y, rpx * q, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }

  // Đường đi tới tiện ích (giữ như cũ, anh đã duyệt)
  const curIdx = tl.poiPhases.findIndex(ph => t >= ph.t0 && t < ph.t1);
  const afterAll = tl.poiPhases.length && t >= tl.poiPhases[tl.poiPhases.length - 1].t1;
  const SP = null;
  const spokeP = () => 0;
  if (tl.flow === 'lanluot') tl.poiPhases.forEach((ph, i) => {
    if (t < ph.t0) return;
    const poi = tl.pois[i];
    const L = poi.line;
    const d = ph.t1 - ph.t0;
    const p = clamp01((t - ph.t0 - 0.14 * d) / (0.46 * d));
    const done = t >= ph.t1;
    let a = done ? (afterAll ? 0.6 : 0.4) : 1;
    if (t >= ou.t0) a = Math.max(0.25, 0.6 - (t - ou.t0) / 0.8);
    if (poi.approx) g.setLineDash([7, 6]);
    const { path, head } = linePath(v, L, L.len * (done ? 1 : smooth(p)));
    const rs = routeStyle(scene);
    glowStroke(g, path, done ? rs.done : rs.core, rs.glow, done ? 2.4 : 3.4, a);
    g.setLineDash([]);
    if (!done && head && p > 0 && p < 1) headGlow(g, head, rs.core, 13);
  });

  // Khoanh vùng nổi bật các tiện ích được đánh sao: vùng sáng màu nhóm + sóng lan, giữ tới hết video
  tl.poiPhases.forEach((ph, i) => {
    const poi = tl.pois[i];
    if (!poi.star) return;
    const show = SP ? clamp01((spokeP(i) - 0.9) / 0.1) : clamp01((t - ph.t0 - 0.55 * (ph.t1 - ph.t0)) / 0.5);
    if (show <= 0) return;
    const q = gLL(v, poi.lat, poi.lng);
    const R = Math.max(26, 160 / metersPerPixel(poi.lat, cam.zoom));
    const col = CAT_COLORS[poi.cat] || GOLD;
    const focus = Math.max(t >= ph.t0 && t < ph.t1 + 0.4 ? 1 : 0, sm && t >= sm.t0 && t < ou.t0 ? 1 : 0);
    const A = show * (0.55 + 0.45 * focus);
    g.save();
    const gr = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, R);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = A * (0.35 + 0.15 * Math.sin(t * 4 + i));
    g.fillStyle = gr;
    g.beginPath(); g.arc(q.x, q.y, R, 0, Math.PI * 2); g.fill();
    g.globalAlpha = A; g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.shadowColor = col; g.shadowBlur = 14;
    g.setLineDash([10, 7]); g.lineDashOffset = -t * 30;
    g.beginPath(); g.arc(q.x, q.y, R * 0.92, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]); g.shadowBlur = 0; g.strokeStyle = col; g.lineWidth = 2.2;
    for (let k = 0; k < 2; k++) {
      const w = ((t * 0.7 + k / 2 + i * 0.13) % 1);
      g.globalAlpha = A * (1 - w) * 0.75;
      g.beginPath(); g.arc(q.x, q.y, R * (0.9 + w * 0.9), 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  });

  // ---- Bẻ phối cảnh lên màn hình ----
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0c1513';
  ctx.fillRect(0, 0, LW, LH);
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  warp(ctx, G, P, gs, tl.G, scale);

  // Sương xa + viền tối
  if (P.pitch > 1) {
    const fog = ctx.createLinearGradient(0, 0, 0, LH * 0.34);
    fog.addColorStop(0, `rgba(16,34,38,${0.62 * P.pitch / PMAX})`);
    fog.addColorStop(1, 'rgba(16,34,38,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, LW, LH * 0.34);
  }
  const vg = ctx.createRadialGradient(LW / 2, LH * 0.55, Math.min(LW, LH) * 0.35, LW / 2, LH * 0.55, Math.max(LW, LH) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, LW, LH);
  const tg = ctx.createLinearGradient(0, 0, 0, safe.top + 90);
  tg.addColorStop(0, 'rgba(0,0,0,0.55)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tg; ctx.fillRect(0, 0, LW, safe.top + 90);

  const S = (lat, lng) => { const q = gLL(v, lat, lng); return g2s(P, q.x, q.y); };
  const hs = g2s(P, hg.x, hg.y);
  const depthScale = w => Math.max(0.82, Math.min(1.2, 1 / w));

  // Tường sáng dựng đứng trên trục đường điểm nhấn (line "nổi" như ranh TP.HCM trong video mẫu)
  for (const W of hiWalls) drawHiWall(ctx, P, v, W, t, LW, LH);

  // Chữ 3D tên trục đường lớn: vẽ TRÊN MÀN HÌNH (không vẽ vào canvas mặt đất nữa — chữ ra ngoài vùng canvas
  // mặt đất lúc máy lia sẽ bị cắt cụt). Dùng phép biến đổi phối cảnh cục bộ tại vị trí chữ nên vẫn trông in dẹt trên đường.
  // Chữ tuyến điểm nhấn ★ ở lại suốt các cảnh sau (như line của nó), chỉ mờ đi ở cảnh kết
  const hiLabelA = t < roadsEnd ? 1 : t < ou.t0 ? 0.9 : Math.max(0, 0.9 - (t - ou.t0) / 0.6);
  if (roadLabelA > 0 || hiLabelA > 0) {
    // 24/10 (Giang báo chữ đè nhau): tính chỗ chiếm trên màn hình của từng chữ, chữ ưu tiên thấp hơn đè lên chữ khác thì
    // mờ đi (chuyển êm theo thời gian, không nháy). Ưu tiên: tuyến đang được giới thiệu > chữ cảnh tổng kết > tuyến ★ > còn lại.
    const curRoad = tl.roadPhases.findIndex(ph => t >= ph.t0 && t < ph.t1);
    const inSum = sm && t >= sm.t0 - 0.3 && t < ou.t0 + 0.3;
    const items = [];
    tl.roadLabels.forEach((L, li) => {
      const isHi = !!tl.roads[L.road]?.hi;
      // chữ đặt cho cảnh tổng kết chỉ hiện trong cảnh tổng kết; chữ gốc của tuyến ★ nhường chỗ lúc đó
      const labA = L.sum ? (sm ? fadeWin(t, sm.t0 + 0.4, ou.t0 + 0.2, 0.6, 0.5) : 0) : isHi ? (inSum ? Math.max(0, hiLabelA * (1 - clamp01((t - sm.t0 + 0.3) / 0.5))) : hiLabelA) : roadLabelA;
      if (labA <= 0) return;
      const ph = tl.roadPhases[L.road];
      if (!ph || t < ph.t0) return;
      const d = ph.t1 - ph.t0;
      const rise = clamp01((t - ph.t0 - 0.5 * d) / 0.7);
      if (rise <= 0) return;
      const q = gLL(v, L.at.lat, L.at.lng);
      const s0 = g2s(P, q.x, q.y);
      if (s0.w <= 0.05) return;
      // các điểm dọc thân chữ (toạ độ mặt đất) → màn hình, mỗi điểm một bán kính theo phối cảnh
      const a = gLL(v, L.a[0], L.a[1]), b = gLL(v, L.b[0], L.b[1]);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const half = L.text.length * L.size * 0.36, rad = L.size * 0.62;
      const pts = [];
      for (let k = -4; k <= 4; k++) {
        const u = half * k / 4;
        const sp = g2s(P, q.x + Math.cos(ang) * u, q.y + Math.sin(ang) * u);
        if (sp.w > 0.05) pts.push({ x: sp.x, y: sp.y, r: rad / sp.w });
      }
      const prio = L.road === curRoad && !L.sum ? 0 : L.sum && inSum ? 0.5 : isHi ? 1 : 2 + L.road;
      items.push({ L, li, labA, rise, q, s0, pts, prio });
    });
    const hitPts = (A, B) => A.pts.some(p => B.pts.some(q => Math.hypot(p.x - q.x, p.y - q.y) < (p.r + q.r) * 0.92));
    const shown = [];
    for (const it of items.slice().sort((x, y) => x.prio - y.prio)) {
      it.ok = !shown.some(o => hitPts(it, o));
      if (it.ok) shown.push(it);
    }
    tl._labVis ||= new Map();
    for (const it of items) {
      const target = it.ok ? 1 : 0;
      const prev = tl._labVis.get(it.li);
      let k = target;
      if (prev && t >= prev.t && t - prev.t < 0.3) k = prev.k + Math.max(-1, Math.min(1, target - prev.k)) * Math.min(1, (t - prev.t) * 5);
      tl._labVis.set(it.li, { k, t });
      it.vis = k;
    }
    for (const it of items) {
      if (it.vis <= 0.02) continue;
      const { L, q, s0 } = it;
      const st = roadStyleOf(scene, tl.roads[L.road]);
      // Kiểu cũ (Giang chốt 23/10): chữ 3D in đậm, mặt trắng hoặc vàng, thân khối tối, viền đen dày; dâng khối khi hiện
      const sx = g2s(P, q.x + 1, q.y), sy = g2s(P, q.x, q.y + 1);
      ctx.save();
      ctx.transform(sx.x - s0.x, sx.y - s0.y, sy.x - s0.x, sy.y - s0.y, s0.x, s0.y);
      groundText(ctx, v, L, st.core, Math.min(it.labA, clamp01(it.rise * 1.5)) * it.vis, easeOut(it.rise),
        { local: true, yellow: scene.roadLabelFace === 'vang' || scene.roadLabelFace === 'vangkim', lineColor: !scene.roadLabelFace || scene.roadLabelFace === 'line' });
      ctx.restore();
    }
  }

  // Nhãn vòng bán kính
  if (ringP > 0.05 && ringA > 0.05) {
    const top = g2s(P, hg.x, hg.y - rpx);
    if (top.y > safe.top + 14 && top.y < LH - safe.bottom) {
      const txt = `BÁN KÍNH ${String(scene.radiusKm).replace('.', ',')} KM`;
      ctx.save();
      ctx.globalAlpha = ringA;
      ctx.font = `800 11.5px ${FONT}`;
      const w = ctx.measureText(txt).width + 22;
      roundRect(ctx, top.x - w / 2, top.y - 12, w, 24, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
      ctx.fillStyle = '#10161d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, top.x, top.y + 0.5);
      ctx.restore();
    }
  }

  // Khoảng cách tới từng trục đường
  tl.roadPhases.forEach(ph => {
    const r = tl.roads[ph.road];
    const d = ph.t1 - ph.t0;
    const a = fadeWin(t, ph.t0 + 0.2 * d, ph.t1 + 0.1, 0.4, 0.35);
    if (a <= 0) return;
    const ps = S(r.P.lat, r.P.lng);
    const far = Math.hypot(ps.x - hs.x, ps.y - hs.y) > 110;
    const cx = far ? (hs.x + ps.x) / 2 : ps.x + (ps.x >= hs.x ? 58 : -58);
    const cy = far ? (hs.y + ps.y) / 2 : ps.y + 4;
    chip(ctx, Math.max(safe.x + 50, Math.min(LW - safe.x - 50, cx)), cy, `cách ${formatKm(r.nearKm, true, '≈ ')}`, a, roadStyleOf(scene, r).core);
  });

  // Ghim tiện ích
  tl.poiPhases.forEach((ph, i) => {
    if (t < (SP ? SP.t0 : ph.t0)) return;
    const poi = tl.pois[i];
    const d = ph.t1 - ph.t0;
    const s = S(poi.lat, poi.lng);
    const pop = SP ? clamp01((spokeP(i) - 0.85) / 0.15) : clamp01((t - ph.t0 - (ph.radar ? 0.3 : 0.55) * d) / 0.5);
    const sc = i === curIdx && !SP ? easeOutBack(pop) : (t >= ph.t1 ? (tl.flow !== 'lanluot' ? 0.95 : 0.8) : easeOutBack(pop));
    drawPoiPin(ctx, s.x, s.y, poi.cat, sc * depthScale(s.w), 1, iconOf(poi));
  });

  // Ranh giới: cờ qua ranh, chữ địa phận 3D, thẻ khoảng cách
  if (B && bp) {
    const d = bp.t1 - bp.t0;
    const la = fadeWin(t, bp.t0 + 0.48 * d, bp.t1 + 0.3, 0.6, 0.5);
    if (la > 0) {
      const rise = easeOut(clamp01((t - bp.t0 - 0.48 * d) / 0.8));
      const own = S(B.own.lat, B.own.lng), acr = S(B.across.lat, B.across.lng);
      const cardTop = LH - safe.bottom - 104 - (tl.fmt === 'h' ? 0 : 14);
      own.y = Math.min(own.y, cardTop - 46);
      // Không cho chữ địa phận đè lên ghim căn nhà: thử đặt dưới, trên, rồi hai bên ghim
      const ownW = Math.max(120, (scene.provinceShort || '').length * 30), ownH = 70;
      const hitHouse = (x, y) => Math.abs(x - hs.x) < ownW / 2 + 26 && y + ownH / 2 > hs.y - 62 && y - ownH / 2 < hs.y + 12;
      if (hitHouse(own.x, own.y)) {
        const tries = [[hs.x, hs.y + 70], [hs.x, hs.y - 110], [hs.x + ownW / 2 + 60, hs.y - 20], [hs.x - ownW / 2 - 60, hs.y - 20]];
        for (const [x, y] of tries) {
          if (y > safe.top + 30 && y < cardTop - 46 && x > safe.x + ownW / 2 && x < LW - safe.x - ownW / 2) { own.x = x; own.y = y; break; }
        }
      }
      own.x = Math.max(safe.x + ownW / 2, Math.min(LW - safe.x - ownW / 2, own.x));
      acr.x = Math.max(safe.x + 90, Math.min(LW - safe.x - 90, acr.x));
      const lg = logoBox(tl);
      acr.y = Math.max(lg && acr.x + 90 > lg.x ? lg.y + lg.h + 34 : safe.top + 34, Math.min(cardTop - 40, acr.y));
      tl._acr = acr;
      const ownName = (scene.provinceShort || '').toUpperCase();
      ctx.save();
      ctx.globalAlpha = la;
      if (ownName) {
        ctx.save();
        ctx.translate(own.x, own.y);
        text3DCentered(ctx, ownName, tl.fmt === 'h' ? 34 : 38, '#FFFFFF', rise);
        if (scene.commune) {
          ctx.font = `700 12.5px ${FONT}`;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
          ctx.fillText(scene.commune.toUpperCase(), 0, 30);
        }
        ctx.restore();
      }
      ctx.save();
      ctx.translate(acr.x, acr.y);
      text3DCentered(ctx, B.short.toUpperCase(), tl.fmt === 'h' ? 38 : 44, CYAN, rise, 'rgba(94,234,245,0.55)');
      ctx.restore();
      ctx.restore();
    }
    if (t >= bp.t0 && t < bp.t1 + 0.4) {
      const ps = S(B.P.lat, B.P.lng);
      const pop = clamp01((t - bp.t0 - 0.74 * d) / 0.5);
      const fa = t < bp.t1 ? 1 : Math.max(0, 1 - (t - bp.t1) / 0.4);
      ctx.save(); ctx.globalAlpha = fa;
      drawFlagPin(ctx, ps.x, ps.y, easeOutBack(pop) * depthScale(ps.w));
      ctx.restore();
      const dist = (B.route ? formatKm(B.route.km) : formatKm(B.km, true, '≈ ')) + (B.route && B.route.min ? ` · ~${Math.max(1, Math.round(B.route.min))} phút` : '');
      const acr = tl._acr;
      const above = !acr || Math.abs(acr.x - ps.x) > 150 || acr.y > ps.y || ps.y - 40 - 52 > acr.y + 34;
      crossingChip(ctx, ps.x, above ? ps.y - 40 : ps.y + 62, B.short, dist, fadeWin(t, bp.t0 + 0.78 * d, bp.t1 + 0.3, 0.4, 0.3), tl);
    }
    boundaryCard(ctx, tl, B, fadeWin(t, bp.t0 + 0.62 * d, bp.t1 + 0.3, 0.6, 0.4));
  }

  // Ghim căn nhà
  // Ghim thả xuống ngay ở trung cảnh (khi xã/phường sáng lên) và giữ suốt cảnh tỉnh/thành
  const it0 = tl.intro, dropAt = tl.provPh || scene.adminArea ? it0.t0 + it0.hold + (it0.t1 - it0.t0 - it0.hold) * 0.72 : ho.t0; // ghim rơi lúc máy gần tới nơi (bay êm trước)
  const dropT = t >= dropAt ? (t - dropAt) / 0.75 : 0;
  // Ở cảnh tỉnh/thành (rất xa) ghim to hơn một chút để vẫn thấy rõ vị trí bất động sản
  const pv = tl.provPh, pinBoost = pv ? 1 + 0.35 * fadeWin(t, pv.t0, ho.t0 + 0.6, 0.6, 0.8) : 1;
  if (t > it0.t0 + it0.hold + (it0.t1 - it0.t0 - it0.hold) * 0.6 || dropT > 0) drawHousePin(ctx, hs.x, hs.y, dropT, t, depthScale(hs.w) * pinBoost);

  // Tiêu đề + thẻ căn nhà
  const logo = logoBox(tl);
  drawTitle(ctx, tl, scene.title, scene.titleSub, fadeWin(t, tl.hookEnd ? tl.hookEnd - 0.2 : 0.3, ov.t0 + 0.5, 0.6, 0.6), logo && tl.fmt !== 'h' ? logo.y + logo.h + 8 : 0);
  const houseCardA = Math.max(fadeWin(t, ho.t0 + 0.5, ov.t0 + 0.4, 0.45, 0.4), fadeWin(t, ou.t0 + 0.5, T + 10, 0.45, 0.4));
  labelCard(ctx, hs.x, hs.y - 60 * depthScale(hs.w), scene.label, scene.sub, houseCardA, LW, safe);

  // Thẻ giá & thông tin căn nhà: lúc giới thiệu căn nhà và lúc kết
  // Bay từ cảnh tỉnh về: chờ máy tới gần bất động sản rồi mới hiện thẻ thông tin
  const infoHouseA = fadeWin(t, ho.t0 + (tl.provPh ? 0.45 * (ho.t1 - ho.t0) : 0.6), ov.t0 + 0.3, 0.45, 0.4);
  const infoEndA = fadeWin(t, ou.t0 + 0.6, T + 10, 0.45, 0.4);
  const infoBottom = infoHouseA > 0 ? infoBox(tl, 'bottom', logo) : null;
  const infoTop = infoEndA > 0 ? infoBox(tl, 'top', logo) : null;

  // Những thẻ đang chiếm đáy khung -> phụ đề nằm phía trên
  const sumEnd = tl.photosPh ? tl.photosPh.t0 + 0.6 : ou.t0 + 0.4;
  const sumP = sm ? (t < sm.t0 ? 0 : (t < sumEnd ? clamp01((t - sm.t0 - 0.3 * (sm.t1 - sm.t0)) / 0.9) : Math.max(0, 1 - (t - sumEnd) / 0.4))) : 0;
  const brandA = fadeWin(t, ou.t0 + 0.8, T + 10, 0.5, 0.4);
  const occ = { top: Infinity, rightPanel: 0 };
  if (tl.fmt === 'h') {
    if (sumP > 0.05) occ.rightPanel = LW - safe.x - 384;
    if (infoBottom && infoHouseA > 0.05) occ.rightPanel = infoBottom.x;
  } else {
    if (sumP > 0.05) occ.top = Math.min(occ.top, LH - safe.bottom - tl.panelH);
    if (infoBottom && infoHouseA > 0.05) occ.top = Math.min(occ.top, infoBottom.y);
  }
  if (B && bp && t >= bp.t0 + 0.5 * (bp.t1 - bp.t0) && t < bp.t1 + 0.6) occ.top = Math.min(occ.top, LH - safe.bottom - 104 - (tl.fmt === 'h' ? 0 : 14));
  if (brandA > 0.05) occ.top = Math.min(occ.top, brandTop(tl));
  const cap = captionAt(tl, t);
  const capL = cap ? captionLayout(ctx, tl, cap, occ) : null;
  const capA = cap ? Math.min(clamp01((t - cap.t0) / 0.12), clamp01((cap.t1 - t) / 0.12)) : 0;

  // Nhãn "5 phút / 10 phút / 15 phút lái xe" ở mép trên mỗi vùng (vị trí trên màn hình, kẹp trong khung an toàn)
  if (tl.isoPh && scene.iso && scene.iso.areas) {
    const aIso = isoAlpha(tl, t);
    if (aIso > 0.01) {
      const areas = scene.iso.areas;
      const used = [];
      areas.forEach((ar, idx) => {
        const k = isoReveal(tl, idx, t);
        if (k < 0.6) return;
        // Điểm cao nhất của vùng trên màn hình (sau khi lan xong)
        let best = null;
        for (const r of ar.rings) for (let i = 0; i < r.length; i += Math.max(1, Math.floor(r.length / 60))) {
          const sp = S(r[i][0], r[i][1]);
          if (sp.x < safe.x + 40 || sp.x > LW - safe.x - 40 || sp.y < safe.top + 40 || sp.y > LH - safe.bottom - 30) continue;
          if (!best || sp.y < best.y) best = sp;
        }
        if (!best) return;
        const text = `${ar.min} phút lái xe`;
        ctx.save();
        ctx.globalAlpha = aIso * clamp01((k - 0.6) / 0.4);
        ctx.font = `800 13px ${FONT}`;
        const w = ctx.measureText(text).width + 22, h = 26;
        let x = Math.max(safe.x + 4, Math.min(LW - safe.x - 4 - w, best.x - w / 2)), y = best.y - h - 6;
        for (const u of used) if (Math.abs(u.y - y) < h + 4 && x < u.x + u.w && x + w > u.x) y = u.y - h - 6;
        used.push({ x, y, w });
        roundRect(ctx, x, y, w, h, 13);
        ctx.fillStyle = 'rgba(8,12,18,0.78)'; ctx.fill();
        ctx.strokeStyle = isoColor(ar.min); ctx.lineWidth = 1.6; ctx.stroke();
        ctx.fillStyle = isoColor(ar.min);
        ctx.beginPath(); ctx.arc(x + 12, y + h / 2, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(text, x + 21, y + h / 2 + 0.5);
        ctx.restore();
      });
    }
  }

  // Kết nối vùng / hạ tầng: chữ đầu cảnh, ghim + thẻ điểm mốc, thẻ tuyến đang thi công
  {
    const bannerY = logo && tl.fmt !== 'h' ? logo.y + logo.h + 20 : safe.top + 24;
    const used = [{ x: hs.x - 26, y: hs.y - 64, w: 52, h: 68 }];
    if (logo) used.push(logo);
    if (capL) used.push(capL);
    // Thẻ của điểm đang ở ngoài khung (máy đang quay cận điểm khác) thì ẩn dần, không dồn ra mép khung
    const onScr = sp => clamp01((Math.min(sp.x, LW - sp.x, sp.y - safe.top, LH - safe.bottom - sp.y) + 6) / 46);
    const rp = tl.regionPh;
    if (rp && tl.anchors.length) {
      const aH = hubAlpha(tl, t);
      if (aH > 0.01) {
        chip(ctx, LW / 2, bannerY, 'KẾT NỐI VÙNG', Math.min(aH, fadeWin(t, rp.t0 + 0.3, rp.t1, 0.4, 0.4)), GOLD);
        used.push({ x: LW / 2 - 80, y: bannerY - 14, w: 160, h: 28 });
        const items = tl.anchors.map((a, i) => ({ a, i, k: hubReveal(tl, i, t), s: S(a.lat, a.lng) }));
        // Mọi ghim (kể cả ghim chưa hiện) đều được né, để thẻ đã đặt không phải dời chỗ khi ghim sau hiện ra
        for (const it of items) used.push({ x: it.s.x - 17, y: it.s.y - 17, w: 34, h: 34 });
        for (const it of items) {
          const ca = aH * clamp01((it.k - 0.92) / 0.08) * onScr(it.s);
          if (ca > 0.01) hubCard(ctx, tl, it.a, it.s.x, it.s.y, ca, used, 'hub' + it.i, hs.x, hs.y);
        }
        for (const it of items) if (it.k > 0) hubPin(ctx, it.s.x, it.s.y, it.a.type, 0.6 + 0.4 * easeOutBack(clamp01(it.k * 1.4)), aH * clamp01(it.k * 4));
      }
    }
    const ip = tl.infraPh;
    if (ip && tl.infra.length && t >= ip.t0 && t < ip.t1 + 0.5) {
      const aI = fadeWin(t, ip.t0 + 0.2, ip.t1 + 0.1, 0.4, 0.4);
      chip(ctx, LW / 2, bannerY, 'HẠ TẦNG ĐANG THI CÔNG', aI, INFRA_COL);
      ctx.save();
      ctx.globalAlpha = aI * 0.85; ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
      ctx.fillText('Theo dữ liệu bản đồ OpenStreetMap · tham khảo', LW / 2, bannerY + 24);
      ctx.restore();
      used.push({ x: LW / 2 - 130, y: bannerY - 14, w: 260, h: 48 });
      for (const r of tl.infra) { const q = S(r.P.lat, r.P.lng); used.push({ x: q.x - 12, y: q.y - 12, w: 24, h: 24 }); }
      tl.infra.forEach((r, i) => {
        const k = infraReveal(tl, i, t);
        const ca = aI * clamp01((k - 0.08) / 0.15);
        if (ca <= 0.01) return;
        const sp = S(r.P.lat, r.P.lng);
        if (ca * onScr(sp) <= 0.01) return;
        infraCard(ctx, tl, r, sp.x, sp.y, ca * onScr(sp), used, 'inf' + i, hs.x, hs.y);
      });
    }
  }

  // Thẻ tiện ích (tránh ghim nhà, logo, phụ đề)
  const avoid = [{ x: hs.x - 26, y: hs.y - 64, w: 52, h: 68 }];
  if (logo) avoid.push(logo);
  if (capL) avoid.push(capL);
  if (tl.flow === 'lanluot') tl.poiPhases.forEach((ph, i) => {
    const d = ph.t1 - ph.t0;
    const a = fadeWin(t, ph.t0 + 0.6 * d, ph.t1 + 0.2, 0.4, 0.3);
    if (a <= 0) return;
    const poi = tl.pois[i];
    const s = S(poi.lat, poi.lng);
    poiCard(ctx, poi, s.x, s.y, a, tl, avoid);
  });

  // Quét vòng tròn / mũi tên: nhãn dán cạnh ghim (tên + khoảng cách), tự tránh đè nhau, đè chữ, đè nhà
  if (tl.flow !== 'lanluot') {
    const endA = t >= ou.t0 ? Math.max(0, 1 - (t - ou.t0) / 0.5) : 1;
    const placed = avoid.slice();
    placed.push({ x: hs.x - 30, y: hs.y - 70, w: 60, h: 76 });
    if (sumP > 0.05) placed.push(tl.fmt === 'h' ? { x: LW - safe.x - 384, y: 0, w: 400, h: LH } : { x: 0, y: LH - safe.bottom - tl.panelH, w: LW, h: tl.panelH + safe.bottom });
    const bounds = { x0: safe.x + 6, x1: LW - safe.x - 6, y0: safe.top + 8, y1: LH - safe.bottom - 8 };
    const items = [];
    tl.poiPhases.forEach((ph, i) => {
      const poi = tl.pois[i];
      const shown = SP ? spokeP(i) >= 1 : t >= ph.t0 + 0.35 * (ph.t1 - ph.t0);
      if (!shown) return;
      const cur = t >= ph.t0 && t < ph.t1;
      const a = Math.min(endA, SP ? clamp01((t - SP.t0 - 0.45 - i * 0.45 - 0.6) / 0.3) : clamp01((t - ph.t0 - 0.35 * (ph.t1 - ph.t0)) / 0.3));
      items.push({ poi, i, cur, a });
    });
    // Nhãn đang nói tới đặt trước để luôn có chỗ đẹp nhất
    items.sort((x, y) => (y.cur - x.cur) || (x.poi.km - y.poi.km));
    for (const it of items) {
      const { poi, cur } = it;
      let { a } = it;
      if (a <= 0.01) continue;
      const s = S(poi.lat, poi.lng);
      const col = CAT_COLORS[poi.cat] || ST.acc;
      const nm = String(poi.name || '');
      const short = nm.length > 24 ? nm.slice(0, 23) + '…' : nm;
      // km + phút di chuyển (theo đường đi nếu có, không thì ước lượng xe máy ~22 km/h trong phố)
      const km = poi.route ? poi.route.km : poi.km;
      const mins = Math.max(1, Math.round(poi.route && poi.route.min ? poi.route.min : km * 60 / 22));
      const info = `${formatKm(km, !poi.route, '≈ ')} · ${mins} phút`;
      ctx.save();
      // Cùng một cỡ cho mọi nhãn (nhãn đang nói tới chỉ đổi viền) để nhãn không co giãn, nhảy chỗ
      const f1 = 12.5, f2 = 11.5;
      ctx.font = `700 ${f1}px ${FONT}`;
      const w1 = ctx.measureText(short).width;
      ctx.font = `800 ${f2}px ${FONT}`;
      const w2 = ctx.measureText(info).width;
      const pad = 10, iconW = 20;
      const w = Math.ceil(Math.max(w1, w2) + pad * 2 + iconW + 4), h = 42;
      const pinTop = s.y - 34 * depthScale(s.w);
      // Vị trí nhãn CỐ ĐỊNH theo hướng tiện ích so với nhà (ra phía ngoài), không dò chỗ mỗi khung hình
      const dir = poi.labDir || { x: 1, y: -1 };
      const x0 = dir.x > 0 ? s.x + 26 : s.x - 26 - w;
      const y0 = dir.y < 0 ? pinTop - h - 10 : s.y + 12;
      const r = { x: Math.max(bounds.x0, Math.min(bounds.x1 - w, x0)), y: Math.max(bounds.y0, Math.min(bounds.y1 - h, y0)), w, h };
      const hit = placed.some(o => r.x < o.x + o.w + 5 && r.x + r.w + 5 > o.x && r.y < o.y + o.h + 5 && r.y + r.h + 5 > o.y);
      // Bị che thì mờ dần (không nhảy sang chỗ khác); nhãn đang nói tới luôn hiện
      tl._labA = tl._labA || {};
      const target = hit && !cur ? 0 : 1;
      const prev = tl._labA[poi.id] ?? target;
      const la = Math.abs(t - (tl._labT ?? t)) > 0.2 ? target : prev + (target - prev) * 0.2;
      tl._labA[poi.id] = la;
      if (la < 0.03) { ctx.restore(); continue; }
      a = a * la;
      placed.push(r);
      ctx.globalAlpha = a;
      // Vòng định vị (tracking) quanh ghim đang được giới thiệu
      if (cur) {
        const q = ((t * 0.9) % 1);
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.globalAlpha = a * (1 - q);
        ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, 14 + q * 26, (14 + q * 26) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = a;
        ctx.setLineDash([4, 4]); ctx.lineDashOffset = -t * 12;
        ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, 18, 8, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      // Đường dẫn gấp khúc: từ ghim lên chéo rồi ngang vào mép nhãn
      const ax = s.x, ay = pinTop + 4;
      const ex = r.x + r.w / 2 < s.x ? r.x + r.w : r.x, ey = r.y + r.h / 2;
      const kx = ex + (ex > ax ? -12 : 12);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.4; ctx.globalAlpha = a * 0.55;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(kx, ey); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.globalAlpha = a;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(kx, ey); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ax, ay, 2.6, 0, Math.PI * 2); ctx.fill();
      // Thẻ nhãn dán: nền tối, sọc màu nhóm, biểu tượng nhóm, tên + km · phút
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
      roundRect(ctx, r.x, r.y, r.w, r.h, 9);
      ctx.fillStyle = ST.card; ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.lineWidth = cur ? 1.8 : 1; ctx.strokeStyle = cur ? col : 'rgba(255,255,255,0.25)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(r.x + pad + iconW / 2, r.y + r.h / 2, iconW / 2, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      drawIcon(ctx, iconOf(poi), r.x + pad + iconW / 2, r.y + r.h / 2, iconW * 0.62, '#fff');
      const tx = r.x + pad + iconW + 6;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = `700 ${f1}px ${FONT}`; ctx.fillStyle = ST.ink; ctx.fillText(short, tx, r.y + (cur ? 19 : 16));
      ctx.font = `800 ${f2}px ${FONT}`; ctx.fillStyle = ST.light ? ST.ink : GOLD; ctx.fillText(info, tx, r.y + (cur ? 37 : 31));
      ctx.restore();
    }
    tl._labT = t;
  }
  if (sm) drawSummary(ctx, tl, sumP);
  drawBrand(ctx, tl, scene.brand, scene.phone, brandA);
  drawInfo(ctx, infoBottom, infoHouseA);
  drawInfo(ctx, infoTop, infoEndA);
  drawPhotos(ctx, tl, t, logo);
  drawClips(ctx, tl, t, logo);
  drawHook(ctx, tl, t);
  drawBars(ctx, tl, t);
  drawLogo(ctx, tl, logo);
  drawCaption(ctx, capL, capA);

  // Nguồn dữ liệu (bắt buộc giữ)
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `500 8px ${FONT}`;
  if (B) ctx.fillText(NOTE, LW / 2, LH - 17);
  ctx.font = `500 8.5px ${FONT}`;
  ctx.fillText(ATTRIBUTION, LW / 2, LH - 6);
  ctx.restore();
}

// Khung tĩnh để dời ghim: nhìn thẳng từ trên xuống, có hướng dẫn
// Diện tích đa giác (m²) theo toạ độ — đủ chính xác cho một lô đất
export function lotAreaM2(pts) {
  if (!pts || pts.length < 3) return 0;
  const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += (p.lng * kx) * (q.lat * ky) - (q.lng * kx) * (p.lat * ky);
  }
  return Math.abs(a / 2);
}
export const formatArea = m2 => (m2 >= 10000 ? (m2 / 10000).toFixed(2).replace('.', ',') + ' ha' : Math.round(m2).toLocaleString('vi-VN') + ' m²');

export function renderEdit(ctx, house, fmtKey, { cache, scale = 1, lot = null, mode = 'pin', zoom: zIn = null }, zoom = zIn ?? (mode === 'lot' ? 18.5 : 17)) {
  const { LW, LH } = FORMATS[fmtKey];
  const cam = { lat: house.lat, lng: house.lng, zoom };
  ctx.setTransform(scale, 0, 0, scale, LW / 2 * scale, LH / 2 * scale);
  drawTiles(ctx, cache, cam, { x0: -LW / 2, x1: LW / 2, y0: -LH / 2, y1: LH / 2 }, scale, true);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = 'rgba(8,12,18,0.12)';
  ctx.fillRect(0, 0, LW, LH);
  // Ranh lô đất đang vẽ
  if (lot && lot.length) {
    const c = project(house.lat, house.lng, zoom);
    const xy = lot.map(p => { const q = project(p.lat, p.lng, zoom); return [LW / 2 + q.x - c.x, LH / 2 + q.y - c.y]; });
    ctx.save();
    ctx.beginPath();
    xy.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (xy.length >= 3) { ctx.closePath(); ctx.fillStyle = 'rgba(255,209,102,0.28)'; ctx.fill(); }
    ctx.strokeStyle = '#FFD166'; ctx.lineWidth = 3; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4; ctx.stroke();
    ctx.shadowBlur = 0;
    for (const [x, y] of xy) { ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#E8590C'; ctx.stroke(); }
    if (lot.length >= 3) {
      const cx = xy.reduce((a, p) => a + p[0], 0) / xy.length, cy = xy.reduce((a, p) => a + p[1], 0) / xy.length;
      chip(ctx, cx, cy, formatArea(lotAreaM2(lot)), 1, '#FFD166');
    }
    ctx.restore();
  }
  // Ghim căn nhà luôn hiện (cả khi vẽ lô) để khách biết đang ở đúng chỗ
  drawHousePin(ctx, LW / 2, LH / 2, 1, (typeof performance !== 'undefined' ? performance.now() : 0) / 1000, mode === 'lot' ? 0.8 : 1);
  ctx.save();
  ctx.font = `700 14px ${FONT}`;
  const txt = mode === 'lot' ? 'Chạm lần lượt từng góc lô đất' : 'Chạm vào đúng căn nhà để dời ghim';
  const w = ctx.measureText(txt).width + 28;
  roundRect(ctx, (LW - w) / 2, 18, w, 34, 17);
  ctx.fillStyle = 'rgba(14,18,24,0.88)'; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, LW / 2, 35.5);
  ctx.font = `500 8.5px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(ATTRIBUTION, LW / 2, LH - 7);
  ctx.restore();
  return cam;
}

export function editTapToLatLng(house, fmtKey, fx, fy, zoom = 17) { // dùng 18.5 khi vẽ lô đất
  const { LW, LH } = FORMATS[fmtKey];
  const c = project(house.lat, house.lng, zoom);
  return unproject(c.x + (fx * LW - LW / 2), c.y + (fy * LH - LH / 2), zoom);
}
