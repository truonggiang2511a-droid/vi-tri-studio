// "AI đạo diễn" — kiểu vẽ 3D (nhánh ai-dao-dien, CHƯA dùng trong app chính).
// Chuyển động giống hệt bản thử Giang duyệt (11/11): máy quay theo đúng công thức easeTo/flyTo của MapLibre
// (cùng thời lượng, cùng đường cong), đường đi vẽ trên mặt đất bằng lớp bản đồ (nghiêng theo phối cảnh), nhãn bật nảy
// theo đúng đường cong CSS của bản thử. Khác bản thử: mọi thứ tính theo thời gian t → xem trước = xuất MP4 từng khung.
// Nền: MapLibre GL (BSD-3) + ảnh vệ tinh Esri + khối nhà OpenStreetMap (OpenFreeMap).
import maplibregl from 'maplibre-gl';
import { drawIcon } from './icons.js';

// Ảnh vệ tinh Esri: vùng chưa có ảnh ở mức zoom sát (nông thôn, ven đô) máy chủ trả ô xám "Map data not yet available"
// → nhận ra ô xám (cách app cũ render.js isPlaceholder) và lấy ô cha zoom thấp hơn, cắt đúng phần, phóng to.
const ESRI_SAT = (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
let phCv = null;
function isPlaceholder(bm) {
  const N = 64;
  phCv ||= Object.assign(document.createElement('canvas'), { width: N, height: N });
  const g = phCv.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, N, N); g.drawImage(bm, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  let neutral = 0, gray = 0, s = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2], l = 0.299 * r + 0.587 * gg + 0.114 * b;
    s += l;
    if (Math.max(r, gg, b) - Math.min(r, gg, b) <= 10) neutral++;
    if (l >= 185 && l <= 225) gray++;
  }
  const n = N * N, m = s / n;
  return m > 180 && m < 235 && neutral / n > 0.9 && gray / n > 0.8;
}
// giải mã bằng thẻ ảnh thường (như app cũ) — ImageBitmap cắt ô trên Safari iPhone hay ra ảnh sọc/kéo dãn
const loadImg = blob => new Promise((res, rej) => {
  const u = URL.createObjectURL(blob), im = new Image();
  im.onload = () => { URL.revokeObjectURL(u); res(im); };
  im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('ảnh ô lỗi')); };
  im.src = u;
});
const parentBlobs = new Map();   // ô cha vừa dùng (4 ô con cùng cần 1 ô cha) — giữ 48 ô gần nhất
async function satTile(z, y, x, signal) {
  const key = z + '/' + y + '/' + x;
  if (parentBlobs.has(key)) return parentBlobs.get(key);
  const r = await fetch(ESRI_SAT(z, y, x), { signal });
  if (!r.ok) throw new Error('tile ' + r.status);
  const blob = await r.blob();
  if (z <= 12 || !isPlaceholder(await loadImg(blob))) return blob;
  const pb = await satTile(z - 1, y >> 1, x >> 1, signal);
  parentBlobs.set((z - 1) + '/' + (y >> 1) + '/' + (x >> 1), pb);
  if (parentBlobs.size > 48) parentBlobs.delete(parentBlobs.keys().next().value);
  const im = await loadImg(pb), hw = im.naturalWidth / 2, hh = im.naturalHeight / 2;
  const c = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  c.getContext('2d').drawImage(im, (x & 1) * hw, (y & 1) * hh, hw, hh, 0, 0, 256, 256);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
}
let satProto = false;
function useSatProtocol() {
  if (satProto) return;
  satProto = true;
  maplibregl.addProtocol('vtsat', async (params, ac) => {
    const [z, y, x] = params.url.slice('vtsat://'.length).split('/').map(Number);
    return { data: await (await satTile(z, y, x, ac.signal)).arrayBuffer() };
  });
}

const W0 = 405;
// Vùng an toàn khổ dọc TikTok / Reels / Facebook (giống app cũ: FORMATS.v.safe = top 96, bottom 196, x 22, r 84 trên 540×960):
// trên 10% là tab + tên kênh, dưới 20% là tên tài khoản + mô tả, mép phải 15,5% là cột nút Thích/Bình luận (từ 42% chiều cao trở xuống)
const SAFE = { top: 0.1, bottom: 0.204, x: 0.041, r: 0.156, rY: 0.42 };
const CAP_Y = 0.72;   // tâm phụ đề (app cũ M1_CAP_Y)                       // khung thiết kế 405×720 (9:16) như bản thử, nhân k = width / 405
const GOLD = '#f5c451';
export const CAT3D = {
  truong: ['school', '#4cc9f0'], cho: ['market', '#f77f00'], congvien: ['park', '#52b788'], yte: ['health', '#ef476f'],
  giaothong: ['bus', '#9b5de5'], kcn: ['factory', '#c9ced6'], nganhang: ['bank', '#ffd166'], hanhchinh: ['gov', '#90e0ef'],
  khudothi: ['city', '#f4a261'], congcong: ['gov', '#90e0ef'],
  center: ['city', '#ffd166'], airport: ['plane', '#7bdff2'], port: ['ship', '#4cc9f0'], station: ['train', '#c77dff'],
  metro: ['train', '#ff5d8f'], road: ['road', '#ffb703'],
};
const FONT = '"Be Vietnam Pro", system-ui, sans-serif';

// dưới 1 km làm tròn 10 m — khớp lời đọc (dd-agent km(): thẻ "735 m" mà giọng đọc "730 m" trông như sai số)
export const fmtKm = km => km < 0.995 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`;
// Có đường đi thật thì dùng phút thật; không có thì ước tính 22 km/h như app (dấu ~); chim bay thì chỉ ghi khoảng cách
// 15/11: phút trước, km sau (người mua nghĩ bằng phút)
export const fmtSub = (p, bird) => bird || p.bird ? `${fmtKm(p.km)} · đường chim bay`
  : `${p.min != null ? Math.max(1, Math.round(p.min)) : '≈' + Math.max(1, Math.round(p.km / 22 * 60))} phút · ${fmtKm(p.km)}`;   // "≈" (dấu "~" đứng đầu dễ đọc thành dấu trừ)

// tên gọn của tiện ích (bỏ phần "huyện …", sau "-" / ",", trong ngoặc) — nhãn ghim + lời đọc cảnh lượn 360°
export const shortName = n => { const s0 = String(n || ''); const s = s0.replace(/\s*[([].*$/, '').split(/\s+[-–]\s+|,/)[0].replace(/\s+(huyện|quận|thị xã|thành phố|tp\.?|tỉnh|phường|xã)\s+\S.*$/i, '').trim(); return s || s0; };

// ---- toán ------------------------------------------------------------------------------------------------------
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
// cubic-bezier như CSS / MapLibre (UnitBezier): giải x(t)=u bằng Newton rồi trả y(t)
function bezier(p1x, p1y, p2x, p2y) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx, cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t, Y = t => ((ay * t + by) * t + cy) * t, dX = t => (3 * ax * t + 2 * bx) * t + cx;
  return u => {
    if (u <= 0) return 0; if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 8; i++) { const e = X(t) - u; if (Math.abs(e) < 1e-6) break; const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    return Y(clamp01(t));
  };
}
const EASE = bezier(0.25, 0.1, 0.25, 1);      // easing mặc định của MapLibre easeTo/flyTo (bản thử dùng)
const QUAD = t => t * (2 - t);                // bản thử: cú lướt tới tiện ích
const LIN = t => t;
const POP = bezier(0.2, 1.6, 0.4, 1);         // bản thử: nhãn bật nảy (CSS .45s)
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeBounce = t => { const n = 7.5625, d = 2.75;
  return t < 1 / d ? n * t * t : t < 2 / d ? n * (t -= 1.5 / d) * t + 0.75 : t < 2.5 / d ? n * (t -= 2.25 / d) * t + 0.9375 : n * (t -= 2.625 / d) * t + 0.984375; };
const mercX = lng => (lng + 180) / 360;
const mercY = lat => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const unX = x => x * 360 - 180;
const unY = y => 360 / Math.PI * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => { const d = ((b - a + 540) % 360) - 180; return a + d * k; };
// quãng đã đi (0..1) của chuyển động tăng tốc đều r giây → chạy đều → giảm tốc đều r giây, xong ở D giây (vòng lượn 360° êm hai đầu)
function rotProg(u, D, r) {
  r = Math.min(r, D / 2);
  const v = 1 / (D - r);
  if (u <= 0) return 0;
  if (u >= D) return 1;
  if (u < r) return 0.5 * v * u * u / r;
  if (u > D - r) return 1 - 0.5 * v * (D - u) * (D - u) / r;
  return 0.5 * v * r + v * (u - r);
}
const bearingDemo = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;   // giống bản thử
const bearingGeo = (a, b) => Math.atan2((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI;
export const kmBetween = (a, b) => Math.hypot((b[0] - a[0]) * 111.32 * Math.cos(a[1] * Math.PI / 180), (b[1] - a[1]) * 110.54);
export function circleKm(c, km, n = 96) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * 2 * Math.PI;
    pts.push([c[0] + km / (111.32 * Math.cos(c[1] * Math.PI / 180)) * Math.cos(a), c[1] + km / 111.32 * Math.sin(a)]);
  }
  return pts;
}
// hình chữ nhật w×h mét quanh tâm c, xoay rotDeg độ (theo chiều kim đồng hồ từ hướng Bắc)
export function rectM(c, wM, hM, rotDeg = 0) {
  const r = rotDeg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  const mx = 111320 * Math.cos(c[1] * Math.PI / 180), my = 110540;
  return [[-wM / 2, -hM / 2], [wM / 2, -hM / 2], [wM / 2, hM / 2], [-wM / 2, hM / 2], [-wM / 2, -hM / 2]]
    .map(([x, y]) => [c[0] + (x * cs + y * sn) / mx, c[1] + (-x * sn + y * cs) / my]);
}
// đường gấp khúc đo theo mét → vị trí theo tỉ lệ quãng đường (đầu line chạy đều)
function pathOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    cum.push(cum[i - 1] + Math.hypot((b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (b[1] - a[1]) * 110540));
  }
  return { pts, cum, len: cum[cum.length - 1] || 1 };
}
function pointAt(path, prog) {
  const d = clamp01(prog) * path.len, { pts, cum } = path;
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const r = clamp01((d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]));
  const a = pts[i - 1], b = pts[i];
  return { pt: [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r], i };
}

// ---- kịch bản → các cảnh ------------------------------------------------------------------------------------------
// story = {
//   mode, persona (chữ trên góc), house:[lng,lat], info:{price, chips[]}, bird (true = đường chim bay thay đường đi thật),
//   pois:[{name,cat,at,km,min?,route?}], anchors:[{name,type,at,km,min,route?}] (kết nối khu vực),
//   lot?: { ring:[[lng,lat]...], label, chips[] } (lô đất nền),
//   infra?: { airport?: {name, a:[lng,lat], b:[lng,lat], km, min}, metro?: {name, sub, line:[[lng,lat]...], stations:[[tên,[lng,lat]]]},
//             road?: {name, ways:[[[lng,lat]...]], km} },
//   score?: [[nhãn, số, cộng?]], lines: { intro, house, lot, poi[], anchor[], airport, metro, road, score, cta }, cta,
//   voice?: cùng khoá như lines, giá trị là AudioBuffer
// }
const VO_AT = 0.3, TAIL = 0.45;
// 15/11 22:54 (Giang): hết vòng cận cảnh căn nhà thì như app cũ — lùi ra trung cảnh, lia nhẹ về hướng Bắc (không lời) rồi mới bay ra kết nối vùng
const HOUSE_MID = 4.2;
// Ảnh bìa đứng đầu video COVER_T giây; cú bay xuống + giọng mở đầu lùi lại SH giây
export const COVER_T = 2.8;
const shiftOf = story => story.cover ? COVER_T - 0.8 : 0;
const photoT = story => story.full === false ? 2.3 : 3.0;   // mỗi ảnh căn nhà ~3 giây (bản ngắn 2,3 giây) → tl.photoT
// Cảnh gom cụm tiện ích (bản ngắn): mỗi tiện ích: máy lia tới (CL_FLY), line chạy (CL_DRAW), nhãn bật (CL_LBL) — tính từ beat của nó
const CL_FLY = 2.0, CL_DRAW = 1.4, CL_LBL = 1.3;   // 15/11 vòng 4 (Giang: camera lia chậm lại)
// Nhịp cảnh tiện ích / điểm mốc / cao tốc KIỂU APP CŨ (15/11 vòng 6, Giang: "chỗ tiện ích vẽ nhanh quá, muốn tốc độ + cách hiện
// như app cũ" — render.js lanluot): máy bay tới trong ~nửa cảnh (êm hai đầu); line đường đi bắt đầu ở ~14% cảnh, chạy mượt hai đầu
// trong 46% cảnh (1,9–3,2 s; trước: 1,5 s cố định, xong khi máy còn đang bay); thẻ hiện KHI line tới nơi, mờ đi trước khi hết cảnh
// → mỗi lúc chỉ MỘT thẻ, cỡ cố định.
const POI_MIN = 5.0;
const lineWin = s => { const d = s.t1 - s.t0, a = Math.min(0.14 * d, 0.8), ld = Math.max(1.9, Math.min(3.2, 0.46 * d)); return { a: s.t0 + a, d: ld, card: s.t0 + a + ld }; };
const smooth = x => x * x * (3 - 2 * x);
const lineQ = (t, s) => { const w = lineWin(s); return smooth(clamp01((t - w.a) / w.d)); };
const flyD = d => Math.max(2.6, Math.min(3.6, 0.5 * d));   // thời gian máy bay tới tiện ích / điểm mốc
const cardA = (t, s, at) => Math.min(clamp01((t - at) / 0.4), clamp01((s.t1 - t) / 0.3));   // thẻ: hiện 0,4 s · mờ đi 0,3 s cuối cảnh
const ROAD_STEP = 1.3; // mỗi trục đường sáng lên cách nhau (15/11: chậm lại, kèm đường đi từ nhà ra trục)
// 15/11 vòng 7 (Giang: cảnh trục đường rối): từng trục một như app cũ — máy bay tới trục (nhà + đoạn trục + đường đi từ nhà ra),
// đường đi chạy ra, trục sáng lên, thẻ "N phút · X km" của RIÊNG trục đó; hết các trục thì lùi ra toàn cảnh ROAD_OVR giây có đủ tên
const ROAD_SHOT = 3.0, ROAD_OVR = 2.8;
// Radar quét bán kính (vòng 7): mỗi vòng quét RADAR_SWEEP giây; tiện ích thật sáng lên khi tia quét đi qua
const RADAR_SWEEP = 2.6, RADAR_MIN = 6.0, RADAR_AT = 1.2, RADAR_GAP = 0.75, RADAR_MINGAP = 0.5, RADAR_TAIL = 2.2;
// Mở đầu từ quả địa cầu (vòng 7): GLOBE_T giây bay từ trái đất xuống trọn tỉnh/thành
const GLOBE_T = 3.6;
const REGION_OV = 4.2;   // 16/11: cảnh tổng kết nối vùng — hết các điểm mốc thì lùi ra thấy nhà + cả các đường đi (không lời)
const AP_OFF = 3.6;    // cảnh sân bay: AP_OFF giây đầu đường đi từ nhà lên sân bay chạy ra (máy ôm nhà + sân bay), rồi mới bay vào đường băng
// màu line từng trục đường (neon, như app cũ) — tên đường in dẹt màu vàng
export const ROAD_COLORS = ['#5EEAF5', '#FF4FA3', '#5BF08A', '#FF8A1F', '#B48CFF'];
// màu vùng theo loại (khu công nghiệp, sân bay, cảng, bệnh viện, đại học, công viên…)
const ZONE_COL = { kcn: '#FF9F1C', airport: '#7BDFF2', port: '#4CC9F0', yte: '#EF476F', truong: '#4CC9F0', congvien: '#52B788', cho: '#F77F00' };
// Phụ đề kiểu app cũ (mẫu 1): cụm ≤ 3 từ (số + đơn vị dính liền, từ khoá vàng không bị tách), ngắt ở dấu câu.
// Thời điểm mỗi cụm chia theo số ký tự trên quãng giọng đọc (giọng đọc đều → khớp lời).
const UNIT = /^(m|km|m²|phút|tỷ|triệu|tầng|lầu|giây|%)[,.;:!?…]?$/i;
export function capChunks(html, start, dur) {
  if (!html) return [];
  const toks = [];
  String(html).split(/(<b>.*?<\/b>)/).forEach(seg => {
    if (!seg) return;
    const g = seg.startsWith('<b>'), txt = g ? seg.slice(3, -4) : seg;
    const ws = txt.split(/\s+/).filter(Boolean);
    ws.forEach((w, i) => toks.push({ w, g, grp: g ? toks.length - i : null }));   // grp: cùng một cụm vàng
  });
  for (let i = toks.length - 1; i > 0; i--) {
    // dấu câu đứng riêng (sau từ khoá vàng: "</b>,") → dính vào từ trước
    if (/^[,.;:!?…]+$/.test(toks[i].w)) { toks[i - 1].w += toks[i].w; toks.splice(i, 1); continue; }
    // "130 m", "3,2 tỷ" thành một từ
    if (UNIT.test(toks[i].w) && /\d$/.test(toks[i - 1].w)) { toks[i - 1].w += ' ' + toks[i].w; toks[i - 1].g = toks[i - 1].g || toks[i].g; toks.splice(i, 1); }
  }
  const chunks = [];
  let cur = [];
  const push = () => { if (cur.length) chunks.push(cur); cur = []; };
  const cap = w => /^\p{Lu}/u.test(w);
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i], nx = toks[i + 1];
    // cụm vàng (≤ 4 từ) không tách: nếu cụm hiện tại không đủ chỗ thì sang cụm mới
    if (tk.g && tk.grp !== toks[i - 1]?.grp) {
      const n = toks.filter(x => x.grp === tk.grp).length;
      if (n <= 4 && cur.length && cur.length + n > 4) push();
    }
    cur.push(tk);
    const inGold = tk.g && nx?.grp === tk.grp;
    // tên riêng viết hoa liền nhau ("Sân bay Tân Sơn Nhất") không cắt giữa chừng (tối đa 5 từ)
    // (kể cả số đứng sau tên: "Chợ Kiến Đức 2", "Phường 7")
    // ("Đường 3 Tháng 2": số kẹp giữa hai chữ hoa cũng thuộc tên)
    const inName = nx && (cap(tk.w) || (/^\d+$/.test(tk.w) && cap(toks[i - 1]?.w || '') && cap(nx.w))) && (cap(nx.w) || /^\d+[,.;:]?$/.test(nx.w)) && !/[,.;:!?…]$/.test(tk.w) && cur.length < 6;
    if (/[,.;:!?…]$/.test(tk.w) || (!inGold && !inName && cur.length >= 3)) push();
  }
  push();
  // một từ lẻ cuối câu ("… xem | nhà.") gộp về cụm trước cho tròn ý
  for (let i = chunks.length - 1; i > 0; i--) {
    if (chunks[i].length === 1 && chunks[i - 1].length <= 3 && !/[.?!…]$/.test(chunks[i - 1].at(-1).w)) { chunks[i - 1].push(...chunks[i]); chunks.splice(i, 1); }
  }
  const len = c => c.reduce((s, x) => s + x.w.length + 1, 0);
  const tot = chunks.reduce((s, c) => s + len(c), 0) || 1;
  let acc = 0;
  return chunks.map(c => { const t0 = start + dur * acc / tot; acc += len(c); return { t0, t1: start + dur * acc / tot,
    words: c.map(x => ({ w: x.w.replace(/[,;:.]+$/, ''), g: x.g })) }; });
}
export function buildTimeline(story) {
  const v = story.voice || {}, scenes = [];
  let t = 0;
  // chưa có giọng: ước thời gian đọc theo số chữ (≈ 3,1 chữ/giây giọng Google 1×) → nhịp máy vẫn giãn theo lời
  const L = story.lines || {};
  const textOf = (kind, i) => kind === 'poi' ? L.poi?.[i] : kind === 'anchor' ? L.anchor?.[i] : L[kind];
  const est = s => s ? String(s).replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length / 3.1 : 0;
  const add = (kind, min, buf, extra = {}) => {
    const at = kind === 'intro' ? 0.7 + shiftOf(story) : VO_AT;
    const say = buf ? buf.duration : story.paceByText ? est(textOf(kind, extra.i)) : 0;
    const dur = Math.max(min, say ? at + say + TAIL : 0);
    // phụ đề: cắt lời thành cụm ngắn (~3 từ có nghĩa), mỗi cụm hiện đúng lúc giọng đọc tới
    const caps = capChunks(textOf(kind, extra.i), t + at, say || Math.max(1, dur - at - TAIL));
    scenes.push({ kind, t0: t, t1: t + dur, vo: buf ? { t: t + at, buffer: buf } : null, caps, ...extra });
    t += dur;
  };
  const PT = photoT(story), SH = shiftOf(story), AREA = hasArea(story), G = story.globe ? GLOBE_T : 0, AO = SH + G;
  // mở đầu có ranh xã/tỉnh: (quả địa cầu →) tỉnh sáng → bay vào xã → bay xuống căn → ghim rơi (pinT); không có ranh: bay thẳng xuống như trước
  const pinT = AREA ? AO + A_PIN : AO + 5.0;
  add('intro', AREA ? pinT + 1.0 : 5.8 + AO, v.intro);
  // căn nhà / lô: máy lượn trọn 360° quanh căn (tối thiểu 8,5 s), lời dài thì lượn chậm lại theo lời
  // 15/11 vòng 9 (AI đạo diễn = mở đầu 3D + phần còn lại y như app cũ, js/dd-old.js): lượn TRỌN 360° quanh căn (≥ 15 s) rồi dừng
  if (story.opening) {
    if (story.lot) add('lot', 15, v.lot); else add('house', 15, v.house);
    return { scenes, duration: t, shift: SH, aOff: AO, globe: G > 0, area: AREA, pinT, photoT: PT, ctaMid: null, barFrom: Infinity, voiceSegs: scenes.filter(s => s.vo).map(s => s.vo) };
  }
  // 15/11 22:21 (Giang): máy lượn TRỌN 1 vòng 360° CẬN CẢNH căn nhà, không lùi ra sớm → tối thiểu 15 s (≤ 24°/giây), lời dài thì lượn chậm lại
  if (story.lot) add('lot', 15, v.lot); else add('house', 15, v.house);
  { const hs = scenes[scenes.length - 1]; hs.mid = HOUSE_MID; hs.t1 += HOUSE_MID; t += HOUSE_MID; }   // đoạn lùi ra trung cảnh (không lời)
  // 15/11 vòng 7 (Giang): thứ tự câu chuyện = căn nhà → KẾT NỐI VÙNG (trung tâm, sân bay, cảng, metro, cao tốc) → trục đường lớn
  // quanh nhà → radar + tiện ích quanh nhà → hạ tầng đang thi công → tổng kết → kêu gọi
  (story.anchors || []).forEach((a, i) => add('anchor', 5.2, v.anchor?.[i], { i }));
  // 16/11 (Giang: thiếu cảnh kết nối vùng): ≥ 2 điểm mốc thì thêm cảnh tổng — máy lùi ra thấy nhà + các đường lên trung tâm, sân bay, cảng
  if ((story.anchors || []).length >= 2) add('region', REGION_OV, null, { n: story.anchors.length });
  const inf = story.infra || {};
  if (inf.airport) add('airport', 7.2 + AP_OFF, v.airport);
  if (inf.metro) add('metro', 7, v.metro);
  if (inf.road) add('road', POI_MIN, v.road);
  // bản ngắn: tiện ích mạnh nhất có cảnh riêng, các tiện ích còn lại gom MỘT cảnh (story.cluster.idx) — trong cảnh đó
  // máy lia tới TỪNG tiện ích đúng lúc lời đọc nhắc tới nó (s.beats), mỗi tiện ích ≥ 2,4 s
  // thời điểm nói tới từng tiện ích của cảnh s (theo vị trí chữ loại tiện ích trong câu × thời lượng giọng); không thấy chữ → chia đều.
  // first: lúc tiện ích đầu hiện (tính từ đầu cảnh), gap: tối thiểu giữa 2 tiện ích, tail: tiện ích cuối còn ít nhất bấy nhiêu giây
  const beatsFor = (s, words = [], html, first, gap, tail) => {
    const n = s.idx.length, d = s.t1 - s.t0, plain = String(html || '').replace(/<[^>]+>/g, '').toLowerCase(), say = s.vo ? s.vo.buffer.duration : est(html);
    // tìm lần lượt từ chỗ vừa thấy (2 tiện ích cùng loại "trường học" không bị tính trùng một chỗ)
    let from = 0;
    let beats = s.idx.map((_, j) => {
      const at = words[j] ? plain.indexOf(words[j].toLowerCase(), from) : -1;
      if (at >= 0) from = at + words[j].length;
      return at >= 0 && say ? s.t0 + VO_AT + say * at / Math.max(1, plain.length) - 0.4 : null;
    });
    if (beats.every(b => b == null)) beats = s.idx.map((_, j) => s.t0 + first + j * (d - first - tail) / Math.max(1, n - 1 || 1));
    else if (beats.some(b => b == null)) {   // vài tên không thấy trong lời (khách / AI đổi chữ): nội suy giữa 2 tên thấy được, không bỏ hết
      beats = beats.map((b, j) => {
        if (b != null) return b;
        let pj = j - 1; while (pj >= 0 && beats[pj] == null) pj--;
        let nj = j + 1; while (nj < n && beats[nj] == null) nj++;
        if (pj >= 0 && nj < n) return beats[pj] + (beats[nj] - beats[pj]) * (j - pj) / (nj - pj);
        return pj >= 0 ? beats[pj] + gap * (j - pj) : s.t0 + first + gap * j;
      });
    }
    beats[0] = s.t0 + first;
    for (let j = 1; j < n; j++) beats[j] = Math.max(beats[j], beats[j - 1] + gap);
    const over = beats[n - 1] - (s.t1 - tail);
    if (over > 0) beats = beats.map((b, j) => Math.max(s.t0 + first + j * 0.2, b - over));
    return beats;
  };
  // trục đường lớn: TỪNG trục một (máy bay tới đúng lúc giọng nói tên trục), cuối cùng lùi ra toàn cảnh
  if (story.roads?.length) {
    const n = story.roads.length;
    add('roads', 0.6 + ROAD_SHOT * n + ROAD_OVR, v.roads);
    const s = scenes.at(-1);
    s.idx = story.roads.map((_, j) => j);
    s.beats = beatsFor(s, story.roads.map(r => r.name), L.roads, 0.2, ROAD_SHOT, ROAD_SHOT + ROAD_OVR);
    s.ovT = Math.max(s.beats[n - 1] + ROAD_SHOT, s.t1 - ROAD_OVR);
  }
  // 15/11 vòng 8 (Giang): RADAR = cả phần tiện ích — máy xoay chậm, tia quét lần lượt qua từng tiện ích (xếp theo hướng), mỗi
  // 0,5–1 s một điểm hiện chấm + tên gọn; tiện ích lời đọc nhắc tên thì hiện đúng lúc giọng nói (beatsFor), điểm khác xen giữa
  if (story.flow === 'radar' && story.radar) {
    const P = story.radar.pts, n = P.length;
    add('radar', Math.max(RADAR_MIN, RADAR_AT + 0.4 + RADAR_GAP * (n - 1) + RADAR_TAIL), v.radar);
    const s = scenes.at(-1);
    s.idx = P.map((_, i) => i);
    s.named = P.map(p => !!p.named);
    // mốc: điểm lời đọc nhắc tên = lúc giọng nói tên; điểm khác nội suy giữa 2 mốc (điểm trước tên đầu tiên trải từ lúc tia bắt đầu
    // quét, điểm sau tên cuối cách nhau RADAR_GAP); cách nhau ≥ RADAR_MINGAP; hết chỗ thì cảnh dài thêm (không dồn điểm)
    const plain = String(L.radar || '').replace(/<[^>]+>/g, '').toLowerCase(), say = s.vo ? s.vo.buffer.duration : est(L.radar);
    const T0 = s.t0 + RADAR_AT + 0.4, anc = [[-1, T0 - RADAR_GAP]];
    let from = 0;
    story.radar.words.forEach((w0, j) => {
      if (!w0 || !say) return;
      // tìm tên đầy đủ (lời Agent), không thấy thì tên gọn trên nhãn (lời AI / khách viết gọn)
      const w = [w0, P[j].label.split(' · ')[0]].find(x => plain.indexOf(x.toLowerCase(), from) >= 0);
      if (!w) return;
      const at = plain.indexOf(w.toLowerCase(), from);
      from = at + w.length;
      const b = s.t0 + VO_AT + say * at / Math.max(1, plain.length) - 0.3, [pj, pt] = anc.at(-1);
      if (b >= pt + RADAR_MINGAP * (j - pj)) anc.push([j, b]);
    });
    const beats = P.map((_, j) => {
      const q = anc.findIndex(a => a[0] >= j);
      if (q < 0) { const [lj, lt] = anc.at(-1); return lt + RADAR_GAP * (j - lj); }
      const [aj, at] = anc[q - 1], [bj, bt] = anc[q];
      return at + (bt - at) * (j - aj) / (bj - aj);
    });
    for (let j = 1; j < n; j++) beats[j] = Math.max(beats[j], beats[j - 1] + RADAR_MINGAP);
    beats[0] = Math.max(beats[0], T0);
    const over = beats[n - 1] + RADAR_TAIL - s.t1;
    if (over > 0) { s.t1 += over; t += over; }
    s.beats = s.hits = beats;
  } else if (story.orbit) {
    // Lượn 360° góc xa: một cảnh, máy lượn trọn vòng quanh nhà (≥ 10 s), tiện ích bật nhãn lần lượt, không vẽ đường đi
    // vòng 6: lời kể từng tiện ích (~2–2,5 s/điểm) → nhãn bật đúng lúc giọng nói tên, cách nhau ≥ 2 s (trước 1,8 s mà lời chỉ ~3 s → dồn dập)
    add('orbit', Math.max(13, 3.0 + 2.2 * story.orbit.idx.length), v.orbit, { idx: story.orbit.idx });
    const s = scenes.at(-1);
    s.beats = beatsFor(s, story.orbit.words, L.orbit, 2.0, 2.0, 2.4);
  } else {
    const inCl = new Set(story.cluster?.idx || []);
    (story.pois || []).forEach((p, i) => { if (!inCl.has(i)) add('poi', POI_MIN, v.poi?.[i], { i }); });
    if (inCl.size) {
      add('cluster', 0.8 + CL_SHOT * inCl.size, v.cluster, { idx: [...inCl] });
      const s = scenes.at(-1);
      s.beats = beatsFor(s, story.cluster.words, L.cluster, 0.2, 2.6, 2.6);   // tiện ích đầu: lia tới ngay khi vào cảnh
    }
  }
  if (story.build?.length) add('build', 5.2, v.build);
  if (story.score && !story.statsInCta) add('score', 5.6, v.score);
  // ảnh thực tế của căn: dồn xuống cuối, ngay trước lời kêu gọi (lời đọc chỉ giới thiệu "hình ảnh thực tế", không tả bịa từng ảnh)
  if (story.photos?.length) add('photos', PT * story.photos.length + 0.3, v.photos);
  add('cta', 3.8, v.cta);
  // Kêu gọi giữa video: ngay sau tiện ích mạnh nhất (đầu cảnh gom cụm / hết cảnh tiện ích đầu), thanh kêu gọi nở to 2,8 s
  const first = scenes.find(s => s.kind === 'poi'), cl = scenes.find(s => s.kind === 'cluster'), orb = scenes.find(s => s.kind === 'orbit'), rad = scenes.find(s => s.kind === 'radar');
  const ctaMid = cl ? cl.t0 + 0.2 : orb ? orb.t1 - 2.9 : first ? first.t1 : rad ? rad.t1 : null;
  // thanh kêu gọi nhỏ hiện từ giây 8 (sau cảnh mở đầu) tới cảnh kêu gọi cuối
  const intro = scenes[0];
  return { scenes, duration: t, shift: SH, aOff: AO, globe: G > 0, area: AREA, pinT, photoT: PT, ctaMid, barFrom: Math.max(8, intro.t1), voiceSegs: scenes.filter(s => s.vo).map(s => s.vo) };
}
const hasArea = story => !!(story.area && (story.area.ward?.rings?.length || story.area.province?.rings?.length));
// mốc mở đầu có ranh (giây, tính từ lúc ảnh bìa bắt đầu tắt SH): tỉnh sáng · bay vào xã · xã sáng · bay xuống căn · ghim rơi
// 15/11 vòng 7 (Giang: thấy trọn ranh tỉnh nổi lên, lia nhẹ rồi mới vào xã): tỉnh giữ 3 s (trước 1,8 s)
const A_PROV = 0.6, A_TOWARD = 3.6, A_WARD = 4.2, A_DOWN = 6.6, A_PIN = 9.2;
const CL_SHOT = 3.3;   // mỗi tiện ích trong cảnh gom cụm

// SFX theo nhịp hình (tổng hợp bằng js/sfx.js): whoosh khi máy lướt, lấp lánh suốt lúc line chạy, pop + ding khi nhãn
// bật, tiếng trầm khi khối nhà dựng, động cơ phản lực khi máy bay cất cánh, ray tàu khi metro chạy, tick điểm sống
export function sfxEvents3D(tl) {
  const ev = [], add = (t, kind, gain, dur) => { if (t >= 0 && t < tl.duration) ev.push({ t, kind, gain, dur }); };
  for (const s of tl.scenes) {
    const d = s.t1 - s.t0;
    if (s.kind === 'intro') {
      const sh = tl.shift || 0;
      if (sh) { add(0.1, 'pop', 0.18); add(0.42, 'ding', 0.3); }   // ảnh bìa: 1 tiếng bật nhẹ + 1 ding (Giang 11/11: pop dày quá)
      const ao = tl.aOff ?? sh;
      if (tl.globe) { add(sh + 0.2, 'riser', 0.32, GLOBE_T); add(sh + 0.6, 'whoosh', 0.45, 2.4); }   // từ quả địa cầu lao xuống
      if (tl.area) {   // tỉnh sáng · bay vào xã · xã sáng · bay xuống · ghim chạm đất
        add(ao + A_PROV, 'shimmer', 0.3, 1.6); add(ao + A_TOWARD, 'whoosh', 0.45, 1.6); add(ao + A_WARD + 0.3, 'ding', 0.32);
        add(ao + A_DOWN - 1.2, 'riser', 0.3, 2.6); add(ao + A_DOWN + 0.4, 'whoosh', 0.5, 1.8); add(tl.pinT + 0.15, 'thud', 0.5);
      } else { add(0.6 + ao, 'riser', 0.32, 2.8); add(3 + ao, 'whoosh', 0.5, 1.8); add(tl.pinT + 0.15, 'thud', 0.5); }
    }
    if (s.kind === 'photos') for (let t2 = s.t0; t2 < s.t1 - 1; t2 += tl.photoT) add(t2, 'whoosh', 0.22, 1.0);
    // gom cụm: 1 whoosh, lấp lánh lúc các đường chạy, mỗi nhãn bật 1 tiếng ding nhẹ theo nhịp
    // gom cụm: mỗi tiện ích 1 cú lia (whoosh) + line chạy (lấp lánh) + nhãn bật (ding nhẹ)
    if (s.kind === 'cluster') s.beats.forEach(b => { add(b, 'whoosh', 0.35, 1.0); add(b + 0.1, 'shimmer', 0.22, 1.1); add(b + CL_LBL, 'ding', 0.22); });
    // lượn 360°: 1 whoosh lúc máy lùi ra góc xa, mỗi tiện ích bật nhãn 1 tiếng ding nhẹ
    if (s.kind === 'orbit') { add(s.t0, 'whoosh', 0.45, 1.6); s.beats.forEach(b => add(b, 'ding', 0.2)); }
    // trục đường: mỗi trục 1 cú bay (whoosh) + đường đi chạy (lấp lánh) + thẻ hiện (ding); cuối lùi ra toàn cảnh (whoosh nhẹ)
    if (s.kind === 'roads') { s.beats.forEach(b => { add(b, 'whoosh', 0.38, 1.2); add(b + 0.5, 'shimmer', 0.24, 1.3); add(b + 1.8, 'ding', 0.26); }); add(s.ovT, 'whoosh', 0.3, 1.4); }
    // radar: 1 whoosh lùi ra, lấp lánh nhẹ lúc bắt đầu quét, mỗi tiện ích hiện 1 tiếng tick nhẹ (điểm lời đọc nhắc tên: ding nhẹ)
    if (s.kind === 'radar') { add(s.t0, 'whoosh', 0.45, 1.4); add(s.t0 + 0.6, 'shimmer', 0.2, Math.min(3, d - 1)); s.hits.forEach((h, j) => add(h, s.named?.[j] ? 'ding' : 'tick', s.named?.[j] ? 0.16 : 0.1)); }
    if (s.kind === 'region') { add(s.t0, 'whoosh', 0.45, 1.6); for (let i = 0; i < s.n; i++) add(s.t0 + 1.5 + 0.35 * i, 'tick', 0.16); }
    if (s.kind === 'build') { add(s.t0, 'whoosh', 0.45, 1.4); add(s.t0 + 0.6, 'shimmer', 0.3, 1.8); add(s.t0 + 2.4, 'ding', 0.4); }
    if (s.kind === 'house' || s.kind === 'lot') { add(s.t0 + 0.05, 'whoosh', 0.25, 1.4); if (s.mid) add(s.t1 - s.mid + 0.1, 'whoosh', 0.16, 1.2); }
    if (s.kind === 'lot') { add(s.t0 + 0.4, 'shimmer', 0.3, 1.6); add(s.t0 + 1.1, 'ding', 0.4); }
    if (s.kind === 'poi' || s.kind === 'anchor' || s.kind === 'road') {
      const w = lineWin(s);   // cùng công thức với line + thẻ (routeProg / draw)
      add(s.t0, 'whoosh', 0.4, 1.0);
      add(w.a, 'shimmer', 0.32, w.d);
      add(w.card, 'ding', 0.3);   // nhãn hiện: chỉ 1 tiếng ding nhẹ (bỏ pop)
    }
    if (s.kind === 'airport') { add(s.t0, 'whoosh', 0.45, 1.4); add(s.t0 + 0.2, 'shimmer', 0.3, 2.4); add(s.t0 + 2.7, 'ding', 0.3); add(s.t0 + AP_OFF, 'whoosh', 0.5, 1.6); add(s.t0 + AP_OFF + 1.9, 'jet', 0.75, Math.min(5.5, d - AP_OFF - 1.9)); }
    if (s.kind === 'metro') { add(s.t0, 'whoosh', 0.45, 1.4); add(s.t0 + 1.2, 'rail', 0.5, d - 1.6); add(s.t1 - 1.2, 'ding', 0.25); }
    if (s.kind === 'score') { add(s.t0, 'whoosh', 0.55, 1.4); for (let r = 0; r < 5; r++) add(s.t0 + 1.3 + r * 0.14, 'tick', 0.14); }
    if (s.kind === 'cta') { add(s.t0, 'whoosh', 0.5, 1.2); add(s.t0 + 0.45, 'ding', 0.45); }
  }
  if (tl.ctaMid != null) add(tl.ctaMid + 0.05, 'ding', 0.32);   // thanh kêu gọi nở to giữa video
  return ev;
}

// Máy bay cất cánh dọc đường băng: lăn bánh tăng tốc, rời đất ở 55% đường băng, leo dốc; trả vị trí, hướng, độ cao (m)
const TAKEOFF = 5.2;
function planeAt(rw, u) {
  const lift = 0.55, s = clamp01(u / TAKEOFF);
  const f = s < 0.62 ? lift * (s / 0.62) ** 2 : lift + (s - 0.62) / 0.38 * (1.25 - lift);
  const alt = f <= lift ? 0 : Math.pow((f - lift) / (1.25 - lift), 1.6) * 320;
  return { pt: [rw.a[0] + (rw.b[0] - rw.a[0]) * f, rw.a[1] + (rw.b[1] - rw.a[1]) * f], alt, dir: bearingGeo(rw.a, rw.b) };
}

// Phụ đề AI đạo diễn (cụm ~3 từ bật vào, chữ trắng bóng đậm, số liệu vàng) — dùng chung cho dd3d và đoạn vẽ kiểu app cũ (dd-old.js,
// vòng 9: Giang "phụ đề giữ nguyên như lúc nãy"). c = một cụm của capChunks; maxBase: đáy chữ không thấp hơn (né thẻ ở đáy khung)
const CAP_GOLD = '#FFD54A';
export function drawCap3D(ctx, c, t, width, height, maxBase = Infinity) {
  const k = width / W0;
  const band = { x0: SAFE.x * width, x1: width - SAFE.r * width };
  let size = 0.075 * width;
  ctx.save();
  ctx.font = `800 ${size}px ${FONT}`;
  const sp = () => ctx.measureText(' ').width;
  let tw = c.words.reduce((s2, w) => s2 + ctx.measureText(w.w).width, 0) + sp() * (c.words.length - 1);
  const maxW = band.x1 - band.x0 - 8 * k;
  if (tw > maxW) { size *= maxW / tw; ctx.font = `800 ${size}px ${FONT}`; tw = c.words.reduce((s2, w) => s2 + ctx.measureText(w.w).width, 0) + sp() * (c.words.length - 1); }
  const base = Math.min(height * CAP_Y + size * 0.35, maxBase);
  let x = (band.x0 + band.x1) / 2 - tw / 2;
  ctx.textBaseline = 'alphabetic';
  c.words.forEach((w, i) => {
    const wd = ctx.measureText(w.w).width, lt = t - c.t0 - i * 0.07;
    if (lt >= 0) {
      const q = clamp01(lt / 0.2), c1 = 1.70158, c3 = c1 + 1;
      const sc = 0.62 + 0.38 * (1 + c3 * Math.pow(q - 1, 3) + c1 * Math.pow(q - 1, 2));
      const dy = (1 - easeOut(q)) * size * 0.14, cx = x + wd / 2, cy = base - size * 0.35;
      ctx.save();
      ctx.globalAlpha = clamp01(lt / 0.06);
      ctx.translate(cx, cy + dy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
      // bóng đậm: 2 lớp bóng (lan rộng + sát chữ) như phụ đề app cũ, thêm viền tối mảnh cho chữ nổi trên ảnh vệ tinh
      ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.1; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = size * 0.22; ctx.shadowOffsetY = size * 0.06;
      ctx.strokeText(w.w, x, base);
      ctx.fillStyle = w.g ? CAP_GOLD : '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.62)'; ctx.shadowBlur = size * 0.1; ctx.shadowOffsetY = size * 0.055;
      ctx.fillText(w.w, x, base);
      ctx.restore();
    }
    x += wd + sp();
  });
  ctx.restore();
}
// Ghim vàng giọt nước (nhãn vị trí bất động sản của AI đạo diễn) — dùng chung cho dd3d và đoạn vẽ kiểu app cũ (dd-old.js)
export function drawGoldPin(ctx, x, y, s, icon) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-6, -12, -20, -19, -20, -33); ctx.arc(0, -33, 20, Math.PI, 0, false); ctx.bezierCurveTo(20, -19, 6, -12, 0, 0); ctx.closePath();
  const g = ctx.createLinearGradient(-20, -53, 20, 0);
  g.addColorStop(0, '#FFF1B8'); g.addColorStop(0.35, '#F5C451'); g.addColorStop(0.7, '#D49A1E'); g.addColorStop(1, '#8A5A0B');
  ctx.shadowColor = 'rgba(245,196,81,.75)'; ctx.shadowBlur = 22;
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(255,248,220,.95)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -33, 12.5, 0, 7); ctx.fillStyle = '#141c2e'; ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(245,196,81,.9)'; ctx.stroke();
  drawIcon(ctx, icon || 'house', 0, -33, 15, '#F5C451');
  ctx.restore();
}
// vòng sóng vàng quanh chân ghim nằm trên mặt đất (squash = độ dẹt theo góc nghiêng)
export function goldRings(ctx, x, y, t, k, squash) {
  for (const off of [0, 0.5]) {
    const q = ((t / 1.8) + off) % 1;
    ctx.beginPath(); ctx.ellipse(x, y, (8 + q * 42) * k, (8 + q * 42) * squash * k, 0, 0, 7);
    ctx.strokeStyle = `rgba(245,196,81,${0.8 * (1 - q)})`; ctx.lineWidth = 2.4 * k; ctx.stroke();
  }
  ctx.beginPath(); ctx.ellipse(x, y + 1 * k, 11 * k, 4 * k, 0, 0, 7); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
}

// Thẻ tổng kết 3 con số lớn (số chạy từ 0): dùng chung cho cảnh tổng kết 3D và đoạn kết vẽ kiểu app cũ (dd-old.js, vòng 9 — Giang:
// "đoạn kết phải có thẻ như thế này"). y = mép trên thẻ (mặc định dưới vùng an toàn phía trên), khung width × height px.
export function drawStats(ctx, S3, a, grow, width, height, y = null) {
  if (a <= 0 || !S3?.length) return;
  const k = width / W0, f = (w, px) => `${w} ${px * k}px ${FONT}`;
  const fit = (txt, maxW) => { if (ctx.measureText(txt).width <= maxW) return txt; let s2 = txt; while (s2.length > 2 && ctx.measureText(s2 + '…').width > maxW) s2 = s2.slice(0, -1); return s2.trimEnd() + '…'; };
  const y0 = y ?? SAFE.top * height + 8 * k, x0 = SAFE.x * width, x1 = width - SAFE.x * width, h = 112 * k, gap = 8 * k;
  const tw = (x1 - x0 - gap * (S3.length - 1)) / S3.length;
  ctx.save(); ctx.globalAlpha = clamp01(a);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  S3.forEach((s3, j) => {
    const e = clamp01((grow - j * 0.15) / 0.5), tx = x0 + j * (tw + gap), cx = tx + tw / 2;
    if (e <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp01(a) * clamp01(e * 2);
    ctx.translate(cx, y0 + h / 2); const sc = 0.7 + 0.3 * POP(e); ctx.scale(sc, sc); ctx.translate(-cx, -(y0 + h / 2));
    const g = ctx.createLinearGradient(tx, y0, tx, y0 + h); g.addColorStop(0, 'rgba(11,18,32,.94)'); g.addColorStop(1, 'rgba(26,36,64,.94)');
    ctx.beginPath(); ctx.roundRect(tx, y0, tw, h, 14 * k); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1.2 * k; ctx.strokeStyle = 'rgba(245,196,81,.55)'; ctx.stroke();
    // số: chạy từ 0 tới giá trị thật (số thập phân dạng "1,2" giữ nguyên chữ)
    const num = typeof s3.n === 'number' ? String(Math.round(s3.n * EASE(clamp01((grow - j * 0.15) / 1.1)))) : String(s3.n);
    ctx.font = `900 ${42 * k}px Montserrat, ${FONT}`; ctx.fillStyle = GOLD;
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 10 * k; ctx.fillText(num, cx, y0 + 52 * k); ctx.shadowColor = 'transparent';
    ctx.font = f(800, 13.5); ctx.fillStyle = '#fff'; ctx.fillText(fit(s3.unit, tw - 10 * k), cx, y0 + 76 * k);
    ctx.font = f(600, 11); ctx.fillStyle = '#cfe0ff'; ctx.fillText(fit(s3.sub, tw - 8 * k), cx, y0 + 96 * k);
    ctx.restore();
  });
  ctx.restore();
}

export function createDirector3D({ width, height, story, overlay = null }) {
  const k = width / W0;
  const OPEN = !!story.opening;   // vòng 9: chỉ dựng phần mở đầu (js/dd-old.js vẽ phần còn lại kiểu app cũ)
  const tl = buildTimeline(story);
  const H = story.house, SH = tl.shift, AO = tl.aOff ?? SH;
  const bird = !!story.bird;
  const routePts = p => (!bird && p.route && p.route.length > 1) ? p.route : [H, p.at];
  const poiPaths = (story.pois || []).map(p => pathOf(routePts(p)));
  const ancPaths = (story.anchors || []).map(a => pathOf(routePts(a)));
  const inf = story.infra || {};
  const metroPath = inf.metro ? pathOf(inf.metro.line) : null;
  // đường đi từ nhà lên sân bay (cảnh sân bay) + từ nhà ra điểm gần nhất của từng trục đường lớn (cảnh trục đường)
  const apMid = inf.airport ? [(inf.airport.a[0] + inf.airport.b[0]) / 2, (inf.airport.a[1] + inf.airport.b[1]) / 2] : null;
  const apPath = inf.airport ? pathOf(!bird && inf.airport.route?.length > 1 ? inf.airport.route : [H, apMid]) : null;
  const rcPaths = (story.roads || []).map(r => r.near && r.km >= 0.12 ? pathOf(!bird && r.route?.length > 1 ? r.route : [H, r.near]) : null);

  // ---- bản đồ nằm ngoài màn hình, đúng kích thước khung xuất ----------------------------------------------------
  useSatProtocol();
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-${width + 4000}px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(box);
  const lineSrc = coords => ({ type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
  const sources = {
    sat: { type: 'raster', tiles: ['vtsat://{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
    omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    // khối căn nhà (theo kích thước trong tin) / lô đất; căn hộ không vẽ khối (ghim + vòng sáng)
    house: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
      coordinates: [story.lot ? story.lot.ring : story.footprint ? story.footprint.ring : story.kind === 'canho' ? rectM(H, 0.1, 0.1) : rectM(H, 5, 20)] } } },
    train: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  };
  const layers = [
    // vòng 9: phần mở đầu màu ảnh vệ tinh gần với nền "Vệ tinh rõ nét" của app cũ (tươi, rõ) để hoà hình sang phần sau không lệch màu
    { id: 'sat', type: 'raster', source: 'sat', paint: OPEN ? { 'raster-fade-duration': 0, 'raster-saturation': 0.26, 'raster-contrast': 0.1 }
      : { 'raster-fade-duration': 0, 'raster-brightness-max': 0.78, 'raster-saturation': 0.15, 'raster-contrast': 0.08 } },
    { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'trunk', 'motorway']]],
      paint: { 'line-color': '#ffd27a', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 17, 5], 'line-opacity': 0.55, 'line-blur': 1 } },
    { id: 'aero', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['==', ['get', 'class'], 'runway'],
      paint: { 'line-color': '#e9f5ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 15, 18], 'line-opacity': 0.3 } },
  ];
  // mỗi đường (tiện ích / điểm mốc / cao tốc / metro) một nguồn đủ dài; phần đã vẽ cắt bằng line-gradient theo line-progress
  const routeIds = [];
  // Line sáng kiểu app cũ (tông Vàng kim): quầng rộng mờ + thân vàng + lõi trắng ấm → rực như neon mà vẫn nằm trên mặt đất
  const LINE = { core: '#FFF4D0', mid: '#FFC93C', glow: '#FFA200' };
  const ZERO = ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'];
  const addRoute = (id, coords, color, width = 5, glow = 16, gold = false) => {
    sources[id] = lineSrc(coords);
    const lay = { 'line-cap': 'round', 'line-join': 'round' };
    layers.push({ id: id + '-g', type: 'line', source: id, layout: lay, paint: { 'line-width': glow, 'line-blur': 8, 'line-opacity': gold ? 0.55 : 0.28, 'line-gradient': ZERO } });
    layers.push({ id, type: 'line', source: id, layout: lay, paint: { 'line-width': width, 'line-gradient': ZERO } });
    if (gold) layers.push({ id: id + '-c', type: 'line', source: id, layout: lay, paint: { 'line-width': Math.max(1.5, width * 0.32), 'line-gradient': ZERO } });
    routeIds.push({ id, color, gold });
  };
  // kiểu lượn 360° / radar: tiện ích KHÔNG vẽ đường đi (chỉ chấm + nhãn), line chỉ còn ở trục đường lớn + điểm mốc vùng
  if (story.flow !== 'vong' && story.flow !== 'radar') (story.pois || []).forEach((p, i) => addRoute('r' + i, poiPaths[i].pts, LINE.mid, 5.5, 18, true));
  (story.anchors || []).forEach((a, i) => addRoute('a' + i, ancPaths[i].pts, LINE.mid, 5.5, 20, true));
  if (inf.road) inf.road.ways.forEach((w, j) => addRoute('w' + j, w, CAT3D.road[1], 9, 26));
  if (metroPath) addRoute('m0', metroPath.pts, CAT3D.metro[1], 6, 18);
  if (apPath) addRoute('ap', apPath.pts, LINE.mid, 5.5, 20, true);
  rcPaths.forEach((p, j) => { if (p) addRoute('rc' + j, p.pts, LINE.mid, 4.5, 15, true); });
  // trục đường lớn: mỗi trục một màu neon (quầng + thân + lõi trắng), sáng dần dọc tuyến
  const multi = ways => ({ type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: ways } } });
  (story.roads || []).forEach((r, j) => {
    const id = 'rd' + j, lay = { 'line-cap': 'round', 'line-join': 'round' };
    sources[id] = multi(r.ways);
    layers.push({ id: id + '-g', type: 'line', source: id, layout: lay, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 26], 'line-blur': 10, 'line-opacity': 0.55, 'line-gradient': ZERO } });
    layers.push({ id, type: 'line', source: id, layout: lay, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 8], 'line-gradient': ZERO } });
    layers.push({ id: id + '-c', type: 'line', source: id, layout: lay, paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.6], 'line-gradient': ZERO } });
    routeIds.push({ id, color: r.color, road: true });
  });
  // hạ tầng đang thi công: nét đứt cam (như app cũ), hiện dần
  (story.build || []).forEach((b, j) => {
    const id = 'bd' + j;
    sources[id] = { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: b.ways } } };
    layers.push({ id: id + '-g', type: 'line', source: id, paint: { 'line-color': '#FFB703', 'line-width': 22, 'line-blur': 10, 'line-opacity': 0 } });
    layers.push({ id, type: 'line', source: id, layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#FFB703', 'line-width': 10, 'line-dasharray': [1.6, 1.1], 'line-opacity': 0 } });
  });
  layers.push(
    // 15/11 22:54 (Giang: khối 3D nhảy lung tung, lúc to quá — thể hiện như app cũ): TẮT mọi khối nổi (nhà OSM, đoàn tàu,
    // khối tỉnh / xã / vùng quan trọng) — chỉ còn phủ màu phẳng + viền phát sáng + ghim vàng như app cũ. Lớp vẫn giữ (ẩn) để code cập nhật không lỗi.
    // 16/11 vòng 13 (Giang): BẬT LẠI riêng khối căn nhà (theo kích thước + số tầng trong tin) / tấm lô đất — chỉ từ lúc ghim rơi tới hết
    // cảnh căn nhà (houseVis), các cảnh sau không còn khối
    { id: 'bld', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14, layout: { visibility: 'none' }, 
      paint: {
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.2, ['max', ['coalesce', ['get', 'render_height'], 0], 7]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0], 0, '#e6ebf3', 20, '#b9c9e6', 60, '#7f9ed6', 150, '#5a7fd0'],
        'fill-extrusion-opacity': 0.88, 'fill-extrusion-vertical-gradient': true,
      } },
    { id: 'house', type: 'fill-extrusion', source: 'house',
      paint: { 'fill-extrusion-color': story.lot?.green ? '#7fd18b' : GOLD, 'fill-extrusion-height': 0, 'fill-extrusion-opacity': story.lot ? 0.55 : 0.92,
        'fill-extrusion-vertical-gradient': true } },
    { id: 'train', type: 'fill-extrusion', source: 'train', layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': 14, 'fill-extrusion-base': 3, 'fill-extrusion-opacity': 0.95 } },
  );
  // Mở đầu (15/11, Giang): khoanh sáng tỉnh/thành (viền đứt + phủ xanh nhạt, ngoài tỉnh tối đi) rồi xã/phường (phủ vàng nổi lên,
  // viền sáng, ngoài xã tối đi) theo ranh thật OSM; độ sáng từng lớp đổi theo t (setArea)
  const AR = story.area || {};
  const polyOf = rs => ({ type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: rs.map(r => [r]) } } });
  const maskOf = rs => { const [x, y] = H, R = 6; return { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
    coordinates: [[[x - R, y - R], [x + R, y - R], [x + R, y + R], [x - R, y + R], [x - R, y - R]], ...rs] } } }; };
  const provH = (() => {   // độ cao khối tỉnh nổi: ~7% bề ngang tỉnh (trong 260 km quanh căn), 2,5–14 km — đủ thấy nổi ở cỡ cả tỉnh
    const pts = (AR.province?.rings || []).flat().filter(p => kmBetween(H, p) <= 260);
    if (!pts.length) return 1500;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const span = Math.max((Math.max(...xs) - Math.min(...xs)) * 111.32 * Math.cos(H[1] * Math.PI / 180), (Math.max(...ys) - Math.min(...ys)) * 110.54);
    return Math.max(2500, Math.min(14000, span * 70));
  })();
  if (AR.province) {
    sources.prov = polyOf(AR.province.rings); sources.provMask = maskOf(AR.province.rings);
    layers.push({ id: 'prov-mask', type: 'fill', source: 'provMask', paint: { 'fill-color': '#040913', 'fill-opacity': 0 } },
      { id: 'prov-fill', type: 'fill', source: 'prov', paint: { 'fill-color': '#4CC9F0', 'fill-opacity': 0 } },
      // vòng 7: cả tỉnh nổi lên thành khối sáng (cao ~2,5% bề ngang tỉnh, 0,8–5 km) → "vùng nổi" Giang muốn
      { id: 'prov-x', type: 'fill-extrusion', source: 'prov', layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': '#4CC9F0', 'fill-extrusion-height': provH, 'fill-extrusion-opacity': 0 } },
      { id: 'prov-g', type: 'line', source: 'prov', paint: { 'line-color': '#4CC9F0', 'line-width': 16, 'line-blur': 9, 'line-opacity': 0 } },
      { id: 'prov-l', type: 'line', source: 'prov', paint: { 'line-color': '#FFFFFF', 'line-width': 3.6, 'line-dasharray': [2, 1.4], 'line-opacity': 0 } });
  }
  if (AR.ward) {
    sources.ward = polyOf(AR.ward.rings); sources.wardMask = maskOf(AR.ward.rings);
    layers.push({ id: 'ward-mask', type: 'fill', source: 'wardMask', paint: { 'fill-color': '#040913', 'fill-opacity': 0 } },
      { id: 'ward-fill', type: 'fill', source: 'ward', paint: { 'fill-color': '#FFC93C', 'fill-opacity': 0 } },
      { id: 'ward-x', type: 'fill-extrusion', source: 'ward', layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': '#FFC93C', 'fill-extrusion-height': 260, 'fill-extrusion-opacity': 0 } },
      { id: 'ward-g', type: 'line', source: 'ward', paint: { 'line-color': '#FFA200', 'line-width': 22, 'line-blur': 10, 'line-opacity': 0 } },
      { id: 'ward-l', type: 'line', source: 'ward', paint: { 'line-color': '#FFF4D0', 'line-width': 3.5, 'line-opacity': 0 } });
  }
  // Vùng quan trọng (khu công nghiệp, sân bay, cảng, bệnh viện…): khoanh theo ranh thật, tô màu + nổi lên + viền sáng
  // (15/11: màu trong vùng đậm hơn, nổi cao hơn); chỉ hiện khi tới cảnh của nó (lọc theo zid, cập nhật trong setFrame)
  const zones = story.zones || [];
  sources.zones = { type: 'geojson', data: { type: 'FeatureCollection', features: zones.flatMap(z => z.rings.map(r => ({
    type: 'Feature', properties: { zid: z.id, col: ZONE_COL[z.cat] || GOLD }, geometry: { type: 'Polygon', coordinates: [r] } }))) } };
  layers.push(
    { id: 'zones-f', type: 'fill', source: 'zones', filter: ['in', ['get', 'zid'], ['literal', []]], paint: { 'fill-color': ['get', 'col'], 'fill-opacity': 0.38 } },
    { id: 'zones-x', type: 'fill-extrusion', source: 'zones', layout: { visibility: 'none' }, filter: ['in', ['get', 'zid'], ['literal', []]],
      paint: { 'fill-extrusion-color': ['get', 'col'], 'fill-extrusion-height': 90, 'fill-extrusion-opacity': 0.62 } },
    { id: 'zones-g', type: 'line', source: 'zones', filter: ['in', ['get', 'zid'], ['literal', []]], paint: { 'line-color': ['get', 'col'], 'line-width': 28, 'line-blur': 10, 'line-opacity': 0.9 } },
    { id: 'zones-l', type: 'line', source: 'zones', filter: ['in', ['get', 'zid'], ['literal', []]], paint: { 'line-color': '#FFFFFF', 'line-width': 4, 'line-opacity': 1 } },
  );
  const map = new maplibregl.Map({
    container: box, center: H, zoom: 12.6, pitch: 0, bearing: 0, maxPitch: 75, pixelRatio: 1, interactive: false,
    attributionControl: false, fadeDuration: 0, preserveDrawingBuffer: true, antialias: true,
    // MapLibre 5: thuộc tính WebGL nằm ở canvasContextAttributes (giữ khung để chép sang canvas xuất video)
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    style: {
      version: 8, sources, layers,
      // vòng 7: mở đầu từ quả địa cầu → chiếu "globe" (MapLibre tự chuyển dần sang phẳng khi zoom ≥ 12, các cảnh sau như cũ)
      ...(tl.globe ? { projection: { type: 'globe' } } : {}),
      sky: { 'sky-color': '#0d1d3d', 'horizon-color': '#f2b56b', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-color': '#c9d6ee', 'fog-ground-blend': 0.2,
        ...(tl.globe ? { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] } : {}) },
    },
  });
  const ready = new Promise((res, rej) => {
    let done = false;
    const fin = () => {
      if (done) return; done = true;
      try { map.setLight({ anchor: 'map', color: '#fff2d9', intensity: 0.45, position: [1.4, 215, 35] }); } catch { /* máy cũ */ }
      res();
    };
    map.on('error', e => { if (!done && !map.isStyleLoaded()) { done = true; rej(e.error || e); } });
    map.once('load', fin);
    // trang bị ẩn (khách chuyển app lúc bấm xuất): trình duyệt ngừng vẽ nên 'load' không đến → tự hỏi kiểu bản đồ đã nạp chưa
    const poll = () => { if (done) return; if (map.isStyleLoaded()) fin(); else setTimeout(poll, 150); };
    setTimeout(poll, 150);
  });

  // ---- máy quay: chuỗi "cú máy" như easeTo của bản thử. Cú sau bắt đầu từ đúng chỗ máy đang ở (ngắt cú trước) ----------
  // 15/11 (Giang: máy quá xa): khung ôm sát hơn (lề nhỏ hơn, trần zoom 18,2) → điểm gần thì cận, điểm xa thì tự lùi ra
  const fitCam = (pts, bearing, pitch, pad = { top: 0.2 * height, bottom: 0.3 * height, left: 0.1 * width, right: 0.16 * width }) => {
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    const c = map.cameraForBounds(b, { padding: pad, bearing });
    return { c: [c.center.lng, c.center.lat], z: Math.min(c.zoom, 18.2), b: bearing, p: pitch };
  };
  const mixCam = (a, b, e) => ({ c: [unX(lerp(mercX(a.c[0]), mercX(b.c[0]), e)), unY(lerp(mercY(a.c[1]), mercY(b.c[1]), e))],
    z: lerp(a.z, b.z, e), p: lerp(a.p, b.p, e), b: lerpAngle(a.b, b.b, e), pad: lerp(a.pad || 0, b.pad || 0, e) });
  const mixLL = (a, b, e) => [lerp(a[0], b[0], e), lerp(a[1], b[1], e)];
  const thin = (rs, n = 160) => { const all = rs.flat(), st = Math.max(1, Math.floor(all.length / n)); return all.filter((_, j) => j % st === 0); };
  // khung tỉnh/xã chỉ ôm mảnh chứa căn nhà (TP.HCM sau sáp nhập có cả Côn Đảo → ôm cả thì máy lùi ra tận biển)
  const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const homeRings = rs => { if (!rs?.length) return []; const own = rs.filter(r => inRing(H, r)); return own.length ? own : [rs.reduce((a, b) => (b.length > a.length ? b : a))]; };
  // tỉnh: 15/11 vòng 7 (Giang: thấy TOÀN BỘ ranh tỉnh) — trọn mảnh ranh chứa căn nhà (đảo xa như Côn Đảo là mảnh riêng → đã bỏ);
  // điểm quá xa (> 260 km, ranh OSM lẫn vùng biển) bỏ cho khỏi lùi máy ra tận biển
  // ranh tỉnh ven biển (TP.HCM, Khánh Hòa…) có đoạn ranh trên biển là các cạnh thẳng rất dài → đỉnh nằm trên cạnh > 6 km không dùng
  // để ôm khung (không thì máy lùi ra thấy cả tam giác biển), chỉ ôm phần ranh trên đất liền
  const landPts = rs => rs.flatMap(r => r.filter((p, i) => { const a = r[(i - 1 + r.length) % r.length], b = r[(i + 1) % r.length]; return kmBetween(a, p) < 6 && kmBetween(p, b) < 6; }));
  const PROV_PTS = thin([landPts(homeRings(AR.province?.rings))], 600).filter(p => kmBetween(H, p) <= 260);
  let moves = null;
  let INIT = { c: H, z: 12.6, p: 0, b: 0 };
  const PIN_T = tl.pinT;
  function camAt(t) {
    let m = null;
    for (const x of moves) { if (x.t > t) break; m = x; }
    if (!m) return INIT;
    if (m.follow) return m.follow(t);
    return mixCam(m.from, m.to, m.ease(clamp01((t - m.t) / m.d)));
  }
  function planCamera() {
    moves = [];
    const ease = (t, d, to, e = EASE) => {
      const m = { t, d, ease: e };
      m.from = camAt(t);
      m.to = typeof to === 'function' ? to(m.from) : to;   // "lia thêm" tính từ chỗ máy đang ở lúc bắt đầu
      moves.push(m);
    };
    const follow = (t, d, fn) => { const m = { t, d }; m.from = camAt(t); m.follow = tt => fn(tt, m.from); moves.push(m); };
    // lời dài (khách dán / AI viết dài) → máy bay tới chậm hơn rồi từ từ đẩy vào khu vực đang nói, không lướt vội
    const fly = (base, d) => Math.min(base * 1.9, Math.max(base, d * 0.32));
    // Lời dài (khách dán / AI viết dài): sau khi tới nơi, máy đổi nhiều góc cho tới hết lời — lượn vòng + đẩy vào, cận vào
    // điểm đang nói, lùi ra thấy cả nhà lẫn điểm đó — mỗi góc ~3,4 s; lời ngắn: chỉ xoay chậm + đẩy nhẹ
    const angles = (t0, t1, base, focus) => {
      const D = t1 - t0;
      if (D <= 0.05) return;
      if (D < 5.6) { ease(t0, D, f => ({ ...f, b: f.b + 8, z: Math.min(18.6, f.z + 0.12) }), LIN); return; }
      const n = Math.max(2, Math.round(D / 4.6)), sd = D / n;
      for (let j = 0; j < n; j++) {
        const kd = j % 3;
        ease(t0 + j * sd, sd, f => kd === 0 ? { ...f, b: f.b + 24, z: Math.min(18.6, f.z + 0.3), p: Math.min(66, f.p + 3) }
          : kd === 1 ? { c: mixLL(base.c, focus, 0.55), z: Math.min(18.6, base.z + 0.7), p: 62, b: f.b + 16 }
            : { ...base, z: base.z - 0.4, p: 46, b: f.b - 34 }, EASE);
      }
    };
    // 16/11 vòng 12 (Giang: lia máy như cũ): hướng nhìn đầu tiên của từng cảnh (đúng công thức các khối bên dưới) — đoạn lùi ra trung cảnh
    // cuối cảnh căn nhà xoay sẵn về hướng này → cảnh sau bay ra không phải quay vòng gắt từ cận cảnh
    const firstBear = x => {
      if (!x) return null;
      if (x.kind === 'anchor') return bearingDemo(H, story.anchors[x.i].at) - 20;
      if (x.kind === 'airport' && apMid) return bearingDemo(H, apMid) - 20;
      if (x.kind === 'metro') { const P = metroPath.pts; return bearingGeo(P[0], P[P.length - 1]) - 30; }
      if (x.kind === 'road') return 15;
      if (x.kind === 'roads') return bearingDemo(H, story.roads[0]?.near || H) - 30;
      if (x.kind === 'radar') return -6;
      if (x.kind === 'poi') return bearingDemo(H, story.pois[x.i].at) - 20;
      if (x.kind === 'cluster') return bearingDemo(H, story.pois[x.idx[0]].at) - 32;
      if (x.kind === 'build') return 10;
      if (x.kind === 'orbit' || x.kind === 'score') return 0;
      if (x.kind === 'cta') return 60;
      return null;
    };
    // cảnh ngay sau căn nhà: lùi ra (zoom) trước rồi mới lướt tâm khung tới nơi → căn nhà không trôi khỏi khung giữa chặng bay
    const zoomFirst = (t0, fd, base) => follow(t0, fd, (t, from) => {
      const u = clamp01((t - t0) / fd), ez = EASE(clamp01(u / 0.75)), ec = EASE(clamp01((u - 0.2) / 0.8));
      return { c: mixLL(from.c, base.c, ec), z: lerp(from.z, base.z, ez), p: lerp(from.p, base.p, ez), b: lerpAngle(from.b, base.b, ez) };
    });
    let prevKind = '';
    for (const s of tl.scenes) {
      const d = s.t1 - s.t0, afterHouse = prevKind === 'house' || prevKind === 'lot';
      prevKind = s.kind;
      if (s.kind === 'intro') {
        // 15/11 vòng 7: (quả địa cầu →) TRỌN tỉnh/thành nổi lên, máy lia nhẹ → bay vào xã/phường (nghiêng nhẹ) → bay xuống căn nhà
        const GLB = { c: [lerp(H[0], 106.2, 0.6), lerp(H[1], 15.8, 0.6)], z: 2.35, p: 0, b: 0 };   // trái đất, Việt Nam ở giữa
        if (tl.area) {
          const PADW = { top: 0.24 * height, bottom: 0.3 * height, left: 0.06 * width, right: 0.06 * width };
          const pr = PROV_PTS.length >= 8 ? fitCam([H, ...PROV_PTS], -8, 34, PADW) : null, wd = AR.ward ? fitCam(thin(homeRings(AR.ward.rings)), -12, 36, PADW) : null;
          const first = pr || wd;
          if (tl.globe && first) { INIT = GLB; ease(SH + 0.15, AO - SH + 0.45, first, EASE); } else INIT = first || INIT;
          if (first) ease(AO + 0.6, A_TOWARD - 0.6, f => ({ ...f, b: f.b + 10, z: f.z + 0.12, p: Math.min(44, f.p + 6) }), LIN);   // lia nhẹ trên toàn tỉnh
          if (wd && pr) ease(AO + A_TOWARD, 2.6, wd);
          ease(AO + A_DOWN, A_PIN - A_DOWN - 0.2, { c: H, z: story.lot ? 18.6 : 17.6, p: 62, b: OPEN ? 0 : -25 });
        } else if (tl.globe) { INIT = GLB; ease(SH + 0.15, AO - SH + 4.6, { c: H, z: story.lot ? 18.6 : 17.3, p: 62, b: OPEN ? 0 : -25 }); }
        else ease(0.6 + SH, 5, { c: H, z: story.lot ? 18.6 : 17.3, p: 62, b: OPEN ? 0 : -25 });
      } else if (s.kind === 'house' || s.kind === 'lot') {
        // máy lượn TRỌN 360° quanh căn trong cảnh (lời dài → lượn chậm hơn), nhịp zoom nhẹ cho khỏi đơ
        const lot = s.kind === 'lot', z0 = lot ? 19.2 : 17.9, p0 = lot ? 56 : 63;
        if (OPEN) {
          // vòng 9: cận sát nhà, lượn ĐỦ 360° (tăng/giảm tốc êm hai đầu), 1,9 s cuối máy về ĐÚNG tư thế đầu cảnh bán kính của app cũ
          // (story.opening.seam, hướng Bắc lên) rồi giữ yên 0,45 s để hoà hình sang phần vẽ kiểu app cũ
          const seam = story.opening.seam, HOLD = 0.45, BL = 1.9, D = Math.max(2, d - HOLD);
          follow(s.t0, d, (t, from) => {
            const u = t - s.t0, rot = 360 * rotProg(u, D, 1.6);
            const tgt = { c: H, z: z0 + 0.22 * Math.sin(Math.PI * Math.min(1, u / D)), p: p0, b: from.b + rot, pad: 0 };
            const e = EASE(clamp01(u / 1.4)), cur = e >= 1 ? tgt : mixCam(from, tgt, e);
            const w = seam ? EASE(clamp01((u - (D - BL)) / BL)) : 0;
            return w <= 0 ? cur : mixCam(cur, { ...seam, b: from.b + 360 }, w);
          });
          continue;
        }
        // 15/11 22:21 (Giang: "phải bay hết vòng căn nhà, đủ 1 vòng cận cảnh, chưa lùi ra sớm"): lượn ĐÚNG 360° trong cả cảnh (tăng/giảm tốc
        // êm hai đầu như vòng 9), giữ cận suốt vòng — bỏ kiểu lùi ra từ 22% cảnh của vòng 7; cảnh sau tự bay ra từ tư thế cuối vòng.
        // Nhịp zoom thở nhẹ ±0,22 cho khỏi đơ. Tên đường trước nhà vẫn in trên mặt đường (groundLabels) vì máy đang cận.
        // 15/11 22:54 (Giang): hết vòng cận cảnh → s.mid giây cuối lùi ra TRUNG CẢNH + lia nhẹ (như app cũ), không bay quay vòng từ cận cảnh
        // ra thẳng kết nối vùng (chóng mặt, ô bản đồ tải không kịp). 16/11 vòng 12: lia nhẹ về đúng hướng nhìn của cảnh sau (firstBear;
        // đường ngắn nhất, tối đa ±100° — phần còn lại xoay trong lúc bay sang cảnh sau), các cảnh sau lia đổi góc như trước vòng 11
        const MID = s.mid || 0, D = Math.max(4, d - MID), zMid = lot ? 17.0 : 15.7, pMid = 48;
        const nb = firstBear(tl.scenes[tl.scenes.indexOf(s) + 1]);
        follow(s.t0, d, (t, from) => {
          const u = t - s.t0, rot = 360 * rotProg(Math.min(u, D), D, Math.min(2.2, D / 4));
          if (u <= D) {
            const tgt = { c: H, z: z0 + 0.22 * Math.sin(Math.PI * u / D), p: p0, b: from.b + rot };
            const e = EASE(clamp01(u / 1.4));
            return e >= 1 ? tgt : mixCam(from, tgt, e);
          }
          const b0 = from.b + 360, w = EASE(clamp01((u - D) / MID));
          const db = nb == null ? 0 : Math.max(-100, Math.min(100, ((nb - b0) % 360 + 540) % 360 - 180));
          return { c: H, z: lerp(z0, zMid, w), p: lerp(p0, pMid, w), b: b0 + db * w };
        });
      } else if (s.kind === 'poi') {
        // vòng 6 (như app cũ): khung ôm nhà + tiện ích + cả đường đi (line không chạy ra ngoài khung), bay êm hai đầu ~nửa cảnh
        const p = story.pois[s.i], P = poiPaths[s.i].pts, step = Math.max(1, Math.floor(P.length / 24));
        const fd = flyD(d), base = fitCam([H, p.at, ...P.filter((_, j) => j % step === 0)], bearingDemo(H, p.at) - 20, 58);
        ease(s.t0, fd, base, EASE);
        angles(s.t0 + fd - 0.2, s.t1, base, p.at);
      } else if (s.kind === 'cluster') {
        // máy lia tới TỪNG tiện ích đúng lúc lời đọc nhắc tới (điểm gần → cận, điểm xa → lùi ra), ở lại tới khi nói sang điểm sau
        s.idx.forEach((i, j) => {
          const p = story.pois[i], b0 = s.beats[j], b1 = j + 1 < s.idx.length ? s.beats[j + 1] : s.t1;
          const base = fitCam([H, p.at], bearingDemo(H, p.at) - 20 + (j % 2 ? 22 : -12), 57);
          ease(b0, Math.min(CL_FLY, b1 - b0), base, QUAD);
          angles(b0 + Math.min(CL_FLY, b1 - b0), b1, base, p.at);
        });
      } else if (s.kind === 'orbit') {
        // góc xa ôm vòng tròn bán kính = tiện ích xa nhất, tối đa 2,4 km (xa hơn thì máy lùi tới tận biển — Giang 15/11); lượn chậm ≤ 15°/giây
        const R = Math.max(0.5, Math.min(2.4, story.orbit.r) * 1.08), base = fitCam(circleKm(H, R, 24), 0, 50, { top: 0.2 * height, bottom: 0.28 * height, left: 0.06 * width, right: 0.1 * width });
        const T = Math.max(24, d);   // lượn chậm: ≤ 15°/giây
        follow(s.t0, d, (t, from) => {
          const u = t - s.t0, tgt = { c: H, z: base.z + 0.15 * Math.sin(2 * Math.PI * u / T), p: 52, b: from.b + 360 * u / T };
          const e = EASE(clamp01(u / 1.6));
          return e >= 1 ? tgt : mixCam(from, tgt, e);
        });
      } else if (s.kind === 'anchor') {
        const a = story.anchors[s.i], P = ancPaths[s.i].pts, step = Math.max(1, Math.floor(P.length / 30));
        const fd = Math.max(afterHouse ? 3.4 : 2.8, flyD(d)), base = fitCam([H, a.at, ...P.filter((_, j) => j % step === 0)], bearingDemo(H, a.at) - 20, 50);
        if (afterHouse) zoomFirst(s.t0, fd, base); else ease(s.t0, fd, base, EASE);
        angles(s.t0 + fd, s.t1, base, a.at);
      } else if (s.kind === 'region') {
        // lùi ra thấy nhà + mọi đường đi tới điểm mốc; hướng nhìn giữ như cảnh trước (không xoay vòng), rồi đẩy vào thật chậm;
        // lề trên rộng (thẻ KẾT NỐI VÙNG + nhãn đứng trên điểm mốc không bị ép vào mép trên đè nhau)
        const pts = [H];
        story.anchors.forEach((a, i) => { const P = ancPaths[i].pts, st = Math.max(1, Math.floor(P.length / 20)); pts.push(a.at, ...P.filter((_, j) => j % st === 0)); });
        const fd = Math.min(2.6, 0.6 * d), base = fitCam(pts, camAt(s.t0).b, 40, { top: 0.34 * height, bottom: 0.3 * height, left: 0.16 * width, right: 0.2 * width });
        ease(s.t0, fd, base, EASE);
        ease(s.t0 + fd, d - fd, f => ({ ...f, z: f.z + 0.12, b: f.b + 4 }), LIN);
      } else if (s.kind === 'airport') {
        const rw = inf.airport, mid = apMid, side = bearingGeo(rw.a, rw.b) - 55, T0 = s.t0 + AP_OFF;
        // 15/11 vòng 5 (Giang): trước hết lùi ra thấy CẢ quãng đường từ nhà lên sân bay (đường đi thật chạy ra + số phút), rồi mới bay vào đường băng
        const step = Math.max(1, Math.floor(apPath.pts.length / 30));
        ease(s.t0, 2.4, fitCam([H, mid, ...apPath.pts.filter((_, j) => j % step === 0)], bearingDemo(H, mid) - 20, 48), QUAD);
        ease(s.t0 + 2.4, AP_OFF - 2.4, f => ({ ...f, b: f.b + 6, z: f.z + 0.1 }), LIN);
        ease(T0, 2.2, { c: mid, z: 14.7, p: 62, b: side });
        // máy quay bám nhẹ theo máy bay sau khi lăn bánh, lùi ra dần cho thấy máy bay lên cao
        follow(T0 + 2.2, d - AP_OFF - 2.2, (t, from) => {
          const u = clamp01((t - T0 - 2.2) / (d - AP_OFF - 2.2)), pl = planeAt(rw, t - T0 - 1.9);
          const tgt = { c: [lerp(mid[0], pl.pt[0], 0.85), lerp(mid[1], pl.pt[1], 0.85)], z: 14.7 - 1.1 * u, p: 62, b: side + 14 * u };
          return mixCam(from, tgt, EASE(clamp01((t - T0 - 2.2) / 2.5)));
        });
      } else if (s.kind === 'metro') {
        // lướt tới đầu đoạn tuyến rồi lia dọc theo tuyến (hướng nhìn cố định theo chiều tuyến → không xoay giật)
        const P = metroPath.pts, dir = bearingGeo(P[0], P[P.length - 1]);
        ease(s.t0, 1.6, { c: pointAt(metroPath, 0.05).pt, z: 15.2, p: 62, b: dir - 30 });
        follow(s.t0 + 1.6, d - 1.6, (t, from) => {
          const u = clamp01((t - s.t0 - 1.6) / (d - 1.6));
          return mixCam(from, { c: pointAt(metroPath, 0.05 + 0.8 * u).pt, z: 15.2 - 0.25 * u, p: 62, b: dir - 30 + 8 * u }, EASE(clamp01((t - s.t0 - 1.6) / 1.2)));
        });
      } else if (s.kind === 'road') {
        // đoạn tuyến gần nhà (≤ khoảng cách tuyến + 1,5 km), không lấy cả tuyến dài vài chục km → máy không lùi quá xa
        const all = inf.road.ways.flat().filter((p, j) => j % 3 === 0 && kmBetween(H, p) <= (inf.road.km || 0) + 1.5);
        const fd = Math.max(afterHouse ? 3.4 : 2.8, flyD(d)), base = fitCam([H, ...all.length ? all : inf.road.ways.flat()], 15, 50);
        if (afterHouse) zoomFirst(s.t0, fd, base); else ease(s.t0, fd, base);
        angles(s.t0 + fd, s.t1, base, all[Math.floor(all.length / 2)] || H);
      } else if (s.kind === 'roads') {
        // 15/11 vòng 7 (Giang): TỪNG trục một như app cũ — mỗi trục một cú máy ôm nhà + đoạn trục gần nhà + đường đi từ nhà ra trục,
        // bay êm đúng lúc giọng nói tên trục; hết các trục thì lùi ra toàn cảnh thấy đủ các trục + tên
        const seg = (r, extra) => r.ways.flat().filter(p => kmBetween(H, p) <= Math.min(12, Math.max(extra, (r.km || 0) + extra)));
        story.roads.forEach((r, j) => {
          const b0 = s.beats[j], b1 = j + 1 < story.roads.length ? s.beats[j + 1] : s.ovT;
          const pts = [H, ...seg(r, 0.9).filter((_, q) => q % 2 === 0), ...(rcPaths[j]?.pts || [])];
          // 16/11 vòng 12: góc nhìn như trước (trục nằm phía trên nhà), nhưng mỗi cú chỉ xoay tối đa ±60° so với góc đang có
          // (cú 1,8 s mà xoay 140° = quay vút ~150°/giây, chóng mặt)
          const want = bearingDemo(H, r.near || H) - 20 + (j % 2 ? 16 : -10), fb = camAt(b0).b;
          const base = fitCam(pts, fb + Math.max(-60, Math.min(60, ((want - fb) % 360 + 540) % 360 - 180)), 54);
          const fd = Math.min(1.8, b1 - b0);
          ease(b0, fd, base, EASE);
          if (b1 - b0 - fd > 0.05) ease(b0 + fd, b1 - b0 - fd, f => ({ ...f, b: f.b + 5, z: Math.min(18.2, f.z + 0.06) }), LIN);
        });
        const near = story.roads.flatMap(r => seg(r, 1.2)).filter((_, j) => j % 2 === 0);
        for (const p of rcPaths) if (p) near.push(...p.pts);   // đường đi từ nhà ra các trục cũng lọt khung
        ease(s.ovT, 2.0, fitCam([H, ...near.length ? near : [H]], -10, 50), EASE);
        if (s.t1 - s.ovT > 2.05) ease(s.ovT + 2.0, s.t1 - s.ovT - 2.0, f => ({ ...f, b: f.b + 6 }), LIN);
      } else if (s.kind === 'radar') {
        // radar: lùi lên thấy trọn vòng bán kính, nghiêng nhẹ, xoay chậm suốt lúc quét
        // vòng 8: nhìn gần thẳng xuống (nghiêng 24°) → vòng tròn to, tròn, các tiện ích cách xa nhau hơn → đủ chỗ cho nhãn tên từng điểm
        const base = fitCam(circleKm(H, story.radar.r * 1.02, 24), -6, 24, { top: 0.19 * height, bottom: 0.27 * height, left: 0.03 * width, right: 0.03 * width });
        ease(s.t0, 1.8, base, EASE);
        // vòng 8 (Giang: xoay chậm lại để thấy hết tiện ích): ~1,5°/giây, khung luôn ôm trọn vòng bán kính
        ease(s.t0 + 1.8, d - 1.8, f => ({ ...f, b: f.b + 1.5 * (d - 1.8) }), LIN);
      } else if (s.kind === 'build') {
        const pts = story.build.flatMap(b => b.ways.flat()).filter(p => kmBetween(H, p) <= story.build[0].km + 2.5).filter((_, j) => j % 2 === 0);
        const fd = fly(2.8, d), base = fitCam([H, ...pts], 10, 50);
        ease(s.t0, fd, base);
        angles(s.t0 + fd, s.t1, base, pts[Math.floor(pts.length / 2)] || H);
      } else if (s.kind === 'score') {
        const all = [H, ...(story.pois || []).map(p => p.at), ...circleKm(H, story.scoreR || 1).filter((_, i) => i % 24 === 0)];
        ease(s.t0, 2.4, fitCam(all, 0, 45));
        ease(s.t0 + 1.2, d - 1.2, f => ({ ...f, b: 25 }), LIN);
      } else if (s.kind === 'cta') ease(s.t0, 3.5, { c: H, z: 16.4, p: 60, b: 60 });
    }
  }
  const sceneIdx = t => { const i = tl.scenes.findIndex(s => t < s.t1); return i < 0 ? tl.scenes.length - 1 : i; };
  const sceneAt = t => tl.scenes[sceneIdx(t)];
  const houseH = t => (story.lot ? 2.2 : story.footprint ? story.footprint.height : story.kind === 'canho' ? 0 : 11) * easeOut(clamp01((t - PIN_T - 0.2) / 0.9));
  // 16/11 vòng 13: khối căn nhà / tấm lô chỉ hiện tới hết cảnh căn nhà (kể cả đoạn lùi ra trung cảnh), sang cảnh sau mờ dần 1 s;
  // kiểu ghép app cũ (OPEN): mờ hẳn trước chỗ nối vì phần vẽ kiểu app cũ không có khối
  const HS = tl.scenes.find(s => s.kind === 'house' || s.kind === 'lot');
  const houseVis = t => !HS ? 0 : OPEN ? 1 - clamp01((t - (HS.t1 - 2.4)) / 1.6) : 1 - clamp01((t - HS.t1) / 1.0);
  const HOUSE_OP = story.lot ? 0.55 : 0.92;
  let houseOpSet = -1;

  // tiến độ vẽ từng đường tại t (0..1)
  function routeProg(t) {
    const out = {};
    for (const s of tl.scenes) {
      if (t < s.t0) continue;
      // vòng 6: line chạy mượt theo nhịp app cũ (lineWin), không còn 1,5 s cố định
      if (s.kind === 'poi') out['r' + s.i] = lineQ(t, s);
      if (s.kind === 'cluster') s.idx.forEach((i, j) => { out['r' + i] = clamp01((t - s.beats[j] - 0.1) / CL_DRAW); });
      if (s.kind === 'anchor') out['a' + s.i] = lineQ(t, s);
      if (s.kind === 'road') inf.road.ways.forEach((_, j) => { out['w' + j] = lineQ(t, s); });
      if (s.kind === 'metro') out.m0 = clamp01((t - s.t0 - 0.3) / 1.3);
      // trục j: đường đi từ nhà ra trục chạy từ beat + 0,5 s (1,3 s), trục sáng lên từ beat + 0,7 s (1,2 s)
      // lượn 360° quanh căn: lúc máy lùi ra, các trục lớn sáng nhẹ (thấy rõ trục nào quanh nhà) — cảnh trục đường vẽ lại từng trục
      if ((s.kind === 'house') && story.roads?.length) story.roads.forEach((_, j) => { out['rd' + j] = clamp01((t - s.t0 - 0.4 * (s.t1 - s.t0)) / 1.6); });
      if (s.kind === 'roads') story.roads.forEach((_, j) => { out['rd' + j] = clamp01((t - s.beats[j] - 0.7) / 1.2); out['rc' + j] = clamp01((t - s.beats[j] - 0.5) / 1.3); });
      if (s.kind === 'airport') out.ap = clamp01((t - s.t0 - 0.2) / 2.4);
    }
    return out;
  }
  // thời điểm từng trục đường bắt đầu sáng (để tên đường hiện theo)
  const roadsScene = tl.scenes.find(s => s.kind === 'roads');
  const roadOn = (j, t) => roadsScene ? clamp01((t - roadsScene.beats[j] - 1.2) / 0.6) : 0;
  // trục đang nói trong cảnh trục đường (−1: đang lùi ra toàn cảnh)
  const roadCur = t => { const s = roadsScene; if (!s || t >= s.ovT) return -1; let j = 0; while (j + 1 < s.beats.length && t >= s.beats[j + 1]) j++; return j; };
  // vùng quan trọng đang hiện: vùng gắn tiện ích (từ cảnh của tiện ích đó trở đi), sân bay (cảnh sân bay)
  let zoneKey = '';
  // vùng mốc (KCN gần nhà, cảng, sân bay) không gắn tiện ích: hiện trong cảnh toàn cảnh trục đường / tổng kết / cảnh điểm mốc của nó
  const showNow = (z, s) => !!z.show && (z.show.includes(s.kind) || (s.kind === 'anchor' && z.show.includes('anchor:' + story.anchors[s.i]?.id))
    || (s.kind === 'region' && z.show.some(x => x.startsWith('anchor:'))));
  // cảnh có tiện ích id: cảnh riêng của nó hoặc cảnh gom cụm chứa nó
  const poiScene = id => tl.scenes.find(x => (x.kind === 'poi' && story.pois[x.i]?.id === id) || ((x.kind === 'cluster' || x.kind === 'orbit') && x.idx.some(i => story.pois[i]?.id === id)));
  // lúc bắt đầu nói tới tiện ích id (cảnh riêng: đầu cảnh; gom cụm: beat của nó)
  const poiStart = id => { const sc = poiScene(id); if (!sc) return null; if (sc.kind === 'poi') return sc.t0; const j = sc.idx.findIndex(i => story.pois[i]?.id === id); return sc.beats[j]; };
  // tiện ích đang nói trong cảnh gom cụm tại t (chỉ số trong s.idx)
  const clusterCur = (s, t) => { let j = 0; while (j + 1 < s.idx.length && t >= s.beats[j + 1]) j++; return j; };
  // kiểu lượn 360°: tiện ích i đã bật lên chưa (từ beat của nó tới hết video, trừ cảnh ảnh) → còn chấm ghim
  const orbSc = tl.scenes.find(s => s.kind === 'orbit');
  const orbShown = (i, t) => { if (!orbSc) return false; const j = orbSc.idx.indexOf(i); return j >= 0 && t >= orbSc.beats[j] + 0.3 && sceneAt(t).kind !== 'photos'; };
  // vòng 8 (Giang): vùng quan trọng (KCN, bệnh viện, công viên… gần nhà) NỔI RANH lên ngay khi vào radar, kèm tên, giữ tới hết video
  const radSc = tl.scenes.find(s => s.kind === 'radar');
  const zRise = t => radSc ? easeOut(clamp01((t - radSc.t0 - 0.6) / 1.2)) : 1;
  let zH = -1;
  function setZones(t) {
    const s = sceneAt(t), on = [];
    const h = Math.round(90 * zRise(t) / 3) * 3;
    if (h !== zH && map.getLayer('zones-x')) { zH = h; map.setPaintProperty('zones-x', 'fill-extrusion-height', h); }
    for (const z of zones) {
      if (radSc && t >= radSc.t0 + 0.6 && s.kind !== 'photos' && z.cat !== 'airport') { on.push(z.id); continue; }
      if (showNow(z, s) && t >= s.t0 + 0.8) on.push(z.id);
      if (z.poiId) { const t0 = poiStart(z.poiId); if (t0 != null && t >= t0 + 0.6 && s.kind !== 'photos') on.push(z.id); }
      if (z.cat === 'airport' && s.kind === 'airport' && t >= s.t0 + 1.2) on.push(z.id);
    }
    const key = on.join('|');
    if (key === zoneKey) return;
    zoneKey = key;
    const f = ['in', ['get', 'zid'], ['literal', on]];
    for (const id of ['zones-f', 'zones-x', 'zones-g', 'zones-l']) map.setFilter(id, f);
  }
  function setBuild(t) {
    const s = tl.scenes.find(x => x.kind === 'build');
    if (!s) return;
    const a = t < s.t0 + 0.5 ? 0 : t < s.t1 ? clamp01((t - s.t0 - 0.5) / 0.8) : 0.35;
    (story.build || []).forEach((_, j) => {
      if (map.__bd?.[j] === a) return;
      (map.__bd ||= [])[j] = a;
      map.setPaintProperty('bd' + j, 'line-opacity', a);
      map.setPaintProperty('bd' + j + '-g', 'line-opacity', a * 0.8);
    });
  }
  const lastGrad = {};
  const NONE = 'rgba(0,0,0,0)';
  // line của cảnh đang nói sáng rực; line các cảnh trước mờ xuống (đỡ rối, mỗi lúc chỉ một line nổi bật)
  const curRoute = t => { const s = sceneAt(t); return s.kind === 'airport' ? ['ap'] : s.kind === 'roads' ? (roadCur(t) >= 0 ? ['rc' + roadCur(t)] : []) : s.kind === 'poi' ? ['r' + s.i] : s.kind === 'cluster' ? ['r' + s.idx[clusterCur(s, t)]] : s.kind === 'anchor' ? ['a' + s.i] : s.kind === 'region' ? story.anchors.map((_, i) => 'a' + i) : []; };
  // Mở đầu: độ sáng lớp tỉnh / xã theo t (chỉ đặt lại khi đổi giá trị)
  const aK = {};
  const setP = (id, prop, v) => { const r = Math.round(clamp01(v) * 50) / 50, key = id + prop; if (aK[key] === r || !map.getLayer(id)) return; aK[key] = r; map.setPaintProperty(id, prop, r); };
  const houseSc = tl.scenes.find(s => s.kind === 'house' || s.kind === 'lot');
  function setArea(t) {
    if (!tl.area) return;
    const T = t - AO;
    const provOn = clamp01((T - A_PROV) / 0.8) * (1 - 0.7 * clamp01((T - A_WARD) / 0.8)) * (1 - clamp01((t - PIN_T + 1.6) / 1.0));
    const wardIn = clamp01((T - A_WARD) / 0.8), wardOut = clamp01((t - PIN_T + 2.0) / 1.5);   // xuống sát căn: phủ vàng tắt (không phủ kín màn hình)
    const wardOn = wardIn * (1 - wardOut), wardLine = wardIn * (1 - 0.7 * wardOut) * (1 - clamp01((t - (houseSc?.t1 ?? PIN_T + 9)) / 0.6));
    setP('prov-mask', 'fill-opacity', 0.5 * provOn * (1 - clamp01((T - A_WARD) / 0.6)));
    setP('prov-fill', 'fill-opacity', 0.24 * provOn); setP('prov-x', 'fill-extrusion-opacity', 0.42 * provOn * (1 - clamp01((T - A_TOWARD - 0.4) / 0.8))); setP('prov-g', 'line-opacity', 0.85 * provOn); setP('prov-l', 'line-opacity', provOn);
    setP('ward-mask', 'fill-opacity', 0.45 * wardOn); setP('ward-fill', 'fill-opacity', 0.32 * wardOn); setP('ward-x', 'fill-extrusion-opacity', 0.5 * wardOn * (1 - clamp01((T - A_DOWN) / 0.7)));
    setP('ward-g', 'line-opacity', 0.9 * wardLine); setP('ward-l', 'line-opacity', wardLine);
  }
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  function setRoutes(t) {
    const pr = routeProg(t), cur = curRoute(t), sk = sceneAt(t).kind;
    for (const { id, color, gold, road } of routeIds) {
      const q = pr[id] ?? 0;
      // cảnh tổng kết / kêu gọi: mọi line sáng lại vừa phải; cảnh khác: chỉ line hiện tại sáng; trục đường mờ sau cảnh của nó
      // trục đường: trong cảnh trục đường trục đang nói sáng rực, trục đã nói mờ 0,45, lúc lùi toàn cảnh sáng hết; radar / tổng kết 0,5
      const rj = road ? +id.slice(2) : -1, rc = road && sk === 'roads' ? roadCur(t) : -1;
      // tuyến cao tốc / metro (cảnh kết nối vùng, nay đứng trước trục đường + tiện ích): sáng trong cảnh của nó, qua cảnh khác mờ 0,3
      const own = id[0] === 'w' ? sk === 'road' : id === 'm0' ? sk === 'metro' : true;
      const dim = road ? (sk === 'roads' ? (rc < 0 || rj === rc ? 1 : 0.45) : sk === 'house' ? 0.7 : sk === 'orbit' ? 0.85 : sk === 'radar' || sk === 'score' ? 0.5 : 0.12) :
        !gold && !own ? (sk === 'score' || sk === 'cta' ? 0.45 : 0.3) : gold && q >= 1 && !cur.includes(id) && !(sk === 'score' || sk === 'cta') ? 0.32 : 1;
      const key = q.toFixed(4) + '|' + dim;
      if (lastGrad[id] === key) continue;
      lastGrad[id] = key;
      // phần đã vẽ: màu; phần chưa vẽ: trong suốt (mép cắt gọn trong 0,2% chiều dài)
      const grad = c => q <= 0 ? ['interpolate', ['linear'], ['line-progress'], 0, NONE, 1, NONE]
        : q >= 1 ? ['interpolate', ['linear'], ['line-progress'], 0, c, 1, c]
          : ['interpolate', ['linear'], ['line-progress'], 0, c, Math.max(0, q - 0.002), c, Math.min(1, q), NONE, 1, NONE];
      map.setPaintProperty(id, 'line-gradient', grad(rgba(color, dim)));
      map.setPaintProperty(id + '-g', 'line-gradient', grad(rgba(gold ? LINE.glow : color, dim)));
      if (gold || road) map.setPaintProperty(id + '-c', 'line-gradient', grad(rgba(gold ? LINE.core : '#FFFFFF', dim)));
    }
  }
  // tàu metro: 3 toa nổi khối chạy dọc tuyến
  let trainKey = '';
  function setTrain(t) {
    const s = tl.scenes.find(x => x.kind === 'metro');
    if (!s) return;
    const on = t >= s.t0 + 1.4 && t < s.t1 + 0.5, feats = [];
    if (on) {
      const u = clamp01((t - s.t0 - 1.4) / Math.max(1, s.t1 - s.t0 - 1.4)), carM = 70, gap = 5, L = metroPath.len;   // toa phóng to để thấy ở cỡ cảnh quận
      for (let c = 0; c < 3; c++) {
        const d0 = 0.1 + 0.85 * u - (c * (carM + gap)) / L;
        const a = pointAt(metroPath, d0), b = pointAt(metroPath, d0 - carM / L);
        const mid = [(a.pt[0] + b.pt[0]) / 2, (a.pt[1] + b.pt[1]) / 2];
        feats.push({ type: 'Feature', properties: { c: c === 0 ? '#ffffff' : '#ffd6e2' }, geometry: { type: 'Polygon', coordinates: [rectM(mid, 11, carM, bearingGeo(b.pt, a.pt))] } });
      }
    }
    const key = on ? feats.map(f => f.geometry.coordinates[0][0].map(x => x.toFixed(6)).join()).join('|') : 'off';
    if (trainKey === key) return;
    trainKey = key;
    map.getSource('train')?.setData({ type: 'FeatureCollection', features: feats });
  }

  // Đặt máy quay + lớp bản đồ cho thời điểm t (đồng bộ)
  let lastT = 0;
  function setFrame(t) {
    if (!moves) planCamera();
    lastT = t;
    const c = camAt(t);
    map.jumpTo({ center: c.c, zoom: c.z, pitch: c.p, bearing: c.b, ...(OPEN ? { padding: { top: c.pad || 0, bottom: 0, left: 0, right: 0 } } : {}) });
    const hv = houseVis(t), hop = Math.round(HOUSE_OP * hv * 50) / 50;
    map.setPaintProperty('house', 'fill-extrusion-height', hv > 0 ? houseH(t) : 0);
    if (hop !== houseOpSet) { houseOpSet = hop; map.setPaintProperty('house', 'fill-extrusion-opacity', hop); }
    setRoutes(t);
    setZones(t);
    setBuild(t);
    setArea(t);
  }
  // Xuất: chờ bản đồ vẽ xong khung này với đủ ô ảnh + dữ liệu (tối đa 20 s/khung khi mạng treo)
  // điện thoại hết bộ nhớ đồ hoạ (WebGL bị mất) → báo lỗi rõ ngay, không treo chờ từng khung
  let glLost = false;
  map.getCanvas().addEventListener('webglcontextlost', () => { glLost = true; });
  function prepare(t) {
    if (glLost) return Promise.reject(new Error('Máy hết bộ nhớ đồ hoạ khi dựng 3D. Đóng bớt ứng dụng, chọn "Nhanh 720p" rồi xuất lại.'));
    setFrame(t);
    // vẽ ngay (đồng bộ) — đủ ô ảnh + dữ liệu thì xong luôn, khỏi chờ nhịp vẽ của trình duyệt
    map.redraw();
    if (map.isStyleLoaded() && map.areTilesLoaded()) return null;
    // còn thiếu ô: hỏi lại sau mỗi lần có dữ liệu mới (hoặc 40 ms), vẽ lại đồng bộ khi đủ
    return new Promise(res => {
      const t0 = performance.now();
      let fin = false;
      const step = () => {
        if (fin) return;
        map.redraw();
        if (glLost || (map.isStyleLoaded() && map.areTilesLoaded()) || performance.now() - t0 > 20000) { fin = true; map.off('data', kick); res(); return; }
        timer = setTimeout(step, 40);
      };
      let timer = setTimeout(step, 40);
      const kick = () => { clearTimeout(timer); timer = setTimeout(step, 0); };
      map.on('data', kick);
    });
  }

  // ---- lớp 2D: ghim nhà, nhãn, phụ đề, thẻ (giống bản thử) ----------------------------------------------------------
  const proj = ll => { const p = map.project(ll); return [p.x, p.y]; };
  const font = (w, px) => `${w} ${px * k}px ${FONT}`;
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  // Nhãn ghim (15/11, Giang: thẻ dài che gần hết màn hình, còn đè chữ; người lớn tuổi cần chữ to): tên gọn (bỏ phần
  // "huyện …", sau "-" / ","), tối đa 2 dòng trong ~60% bề ngang, chữ 17 / 14,5 px (khung 405); mũi ghim chỉ đúng điểm.
  // Chỗ đặt: thử trên / trên-trái / trên-phải / dưới / trái / phải, lấy chỗ ít đè nhất với ghim nhà, thẻ, nhãn khác; nhớ chỗ đã
  // chọn (chỉ đổi khi bị che) cho khỏi nhảy; nhãn bị đẩy xa điểm thì nét dẫn dài ra. Ô nhãn giữ chỗ → chữ in trên mặt đất né đi.
  // 15/11 vòng 4 (Giang: thẻ nhỏ lại 1 tí, bám đúng chấm đỏ, đường chỉ thẳng xuống không xoay qua lại)
  const LB = { name: 16.5, sub: 13.5, icon: 32, glyph: 21, maxW: 0.62, line: 20 };
  // tối đa 2 dòng, chia ở chỗ 2 dòng dài gần bằng nhau (không để 1 chữ lẻ xuống dòng)
  function wrap2(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return [text];
    const ws = text.split(/\s+/);
    let best = null;
    for (let i = 1; i < ws.length; i++) {
      const a = ws.slice(0, i).join(' '), b = ws.slice(i).join(' '), m = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (!best || m < best.m) best = { a, b, m };
    }
    return best ? [fitEllipsis(ctx, best.a, maxW), fitEllipsis(ctx, best.b, maxW)] : [fitEllipsis(ctx, text, maxW)];
  }
  // compact: nhãn gọn (biểu tượng + tên ngắn 1 dòng) cho tiện ích đã nhắc trong cảnh lượn 360°
  function measureLabel(ctx, it) {
    if (it.rad) {   // vòng 8b: nhãn radar kiểu bản đồ vệ tinh — chữ trắng viền tối đặt sát biểu tượng tròn (không thẻ nền, không đường dẫn):
      // dòng 1 tên gọn (≤ 18 ký tự, agent đã rút gọn), dòng 2 khoảng cách nhỏ màu vàng
      const [nm, ds] = String(it.name).split(' · ');
      ctx.font = font(800, 13.5); const name0 = fitEllipsis(ctx, nm, 0.42 * width), wn = ctx.measureText(name0).width;
      ctx.font = font(700, 11.5); const wd = ds ? ctx.measureText(ds).width : 0;
      return { ...it, name0, dist: ds || '', w: Math.max(wn, wd) + 4 * k, h: (ds ? 31 : 18) * k };
    }
    if (it.orb) {   // nhãn cảnh lượn 360°: một cỡ cho mọi tiện ích (tên 1 dòng + phút · km)
      const isz = 26 * k; ctx.font = font(800, 14.5);
      const lines = [fitEllipsis(ctx, shortName(it.name), 0.46 * width)];
      const w1 = ctx.measureText(lines[0]).width; ctx.font = font(800, 12.5); const w2 = it.sub ? ctx.measureText(it.sub).width : 0;
      return { ...it, lines, isz, fs: 14.5, subFs: 12.5, glyph: 17, ty0: 19, lh: 17, subDy: 16, w: 6 * k + isz + 7 * k + Math.max(w1, w2) + 10 * k, h: 44 * k };
    }
    if (it.compact) {
      const isz = 24 * k; ctx.font = font(800, 13.5);
      const lines = [fitEllipsis(ctx, it.full ? it.name : shortName(it.name), 0.42 * width)];
      return { ...it, lines, isz, fs: 13.5, glyph: 16, w: 5 * k + isz + 7 * k + ctx.measureText(lines[0]).width + 10 * k, h: isz + 8 * k };
    }
    const isz = LB.icon * k;
    ctx.font = font(800, LB.name);
    const lines = wrap2(ctx, it.full ? it.name : shortName(it.name), LB.maxW * width - isz - 26 * k);
    const w1 = Math.max(...lines.map(l => ctx.measureText(l).width));
    ctx.font = font(700, LB.sub); const w2 = it.sub ? ctx.measureText(it.sub).width : 0;
    const w = 6 * k + isz + 8 * k + Math.max(w1, w2) + 11 * k;
    const h = Math.max(isz + 11 * k, (22 + LB.line * (lines.length - 1) + (it.sub ? 18 : 0) + 10) * k);
    return { ...it, lines, w, h, isz, fs: LB.name, glyph: LB.glyph };
  }
  const labMem = {}, labFade = {};
  const ovl = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  // Thẻ LUÔN đứng thẳng ngay TRÊN chấm vị trí (sát mép trên thì đứng dưới), đường chỉ thẳng đứng xuống chấm — bám theo chấm khi máy
  // lia, không đổi phía qua lại. Chạm thẻ khác thì nâng lên 1–2 tầng (vẫn thẳng đứng), giữ tầng đó tới khi bị chạm lại.
  // optional (nhãn gọn): chỉ 1 tầng, chật thì mờ dần thay vì đè, có chỗ lại hiện dần (không nháy)
  function placeLabels(ctx, items, reserved, t = 0) {
    const out = [], P = reserved.slice();
    const top = SAFE.top * height + 6 * k, bot = height * CAP_Y - 34 * k, gap = 24 * k;
    const hitOf = b => P.reduce((s2, o) => s2 + ovl(b, o), 0);
    placeRadar(ctx, items.filter(i => i.rad && i.a > 0), P, out, t, top, bot, hitOf);
    for (const it0 of items) {
      if (it0.a <= 0 || it0.rad) continue;
      const it = measureLabel(ctx, it0), [px, py] = proj(it.at), { w, h } = it;
      if (px < -width * 0.3 || px > width * 1.3 || py < -height * 0.3 || py > height * 1.3) continue;
      const below = py - gap - h < top;
      const boxAt = lv => {
        const y0 = below ? py + gap + lv * (h + 6 * k) : py - gap - h - lv * (h + 6 * k), y = Math.max(top, Math.min(bot - h, y0));
        const right = width - (y + h > SAFE.rY * height ? SAFE.r : SAFE.x) * width, x = Math.max(SAFE.x * width, Math.min(right - w, px - w / 2));
        return [x, y, x + w, y + h];
      };
      const levels = it.optional ? [0] : [0, 1, 2];
      let lv = levels.includes(labMem[it.key]) ? labMem[it.key] : 0;
      if (hitOf(boxAt(lv)) > 0) { let best = null; for (const l of levels) { const hh = hitOf(boxAt(l)); if (!best || hh < best.hh) best = { l, hh }; if (!hh) break; } lv = best.l; }
      labMem[it.key] = lv;
      const box = boxAt(lv), hit = hitOf(box);
      let v = 1;
      if (it.optional) {
        const g = labFade[it.key], target = hit > 0.05 * w * h ? 0 : 1;
        v = !g || Math.abs(t - g.t) > 0.5 ? target : g.v + Math.sign(target - g.v) * Math.min(Math.abs(target - g.v), Math.abs(t - g.t) / 0.25);
        labFade[it.key] = { v, t };
        if (target === 0 && v <= 0.01) continue;
        if (target === 0) { out.push({ ...it, px, py, box, a: it.a * v }); continue; }   // đang mờ đi: không giữ chỗ
      }
      P.push(box);
      out.push({ ...it, px, py, box, a: it.a * v });
    }
    return out;
  }
  // Nhãn radar (vòng 8b, Giang: nhãn dài, muốn gọn + chuyên nghiệp): chữ đặt SÁT biểu tượng tròn của tiện ích ở 1 trong 8 phía
  // (ưu tiên phía ra xa nhà → chữ tản ra ngoài, giữa vòng thoáng), canh lề theo phía (bên phải canh trái, bên trái canh phải, trên/dưới canh
  // giữa). Ổn định: nhãn đã hiện GIỮ NGUYÊN phía (đặt trước), nhãn mới nhất tìm chỗ trống; hết chỗ hẳn mới chiếm chỗ nhãn cũ → nhãn cũ đó
  // tìm phía khác (mờ đi rồi hiện lại, không trượt), không còn chỗ thì mờ hẳn — biểu tượng vẫn còn trên bản đồ
  const RB = () => 10.5 * k;   // bán kính biểu tượng tròn của tiện ích trên radar
  function placeRadar(ctx, list, P, out, t, top, bot, hitOf) {
    if (!list.length) return;
    const [hx0, hy0] = proj(H), rb = RB();
    const L = list.map(it0 => { const it = measureLabel(ctx, it0), [px, py] = proj(it.at); return { it, px, py }; })
      .filter(o => o.px > -width * 0.3 && o.px < width * 1.3 && o.py > -height * 0.3 && o.py < height * 1.3);
    const bubs = L.map(o => [o.px - rb - 2 * k, o.py - rb - 2 * k, o.px + rb + 2 * k, o.py + rb + 2 * k]);
    const boxOf = (o, [ax, ay]) => { const { w, h } = o.it, ex = ay ? rb * 0.45 : rb + 5 * k, ey = ax ? rb * 0.55 : rb + 3 * k;
      const x = ax > 0 ? o.px + ex : ax < 0 ? o.px - ex - w : o.px - w / 2, y = ay < 0 ? o.py - ey - h : ay > 0 ? o.py + ey : o.py - h / 2;
      return [x, y, x + w, y + h]; };
    const inside = b => b[0] >= SAFE.x * width && b[2] <= width - SAFE.x * width && b[1] >= top && b[3] <= bot;
    const dirsOf = o => { const dx = o.px - hx0, dy = o.py - hy0, dl = Math.hypot(dx, dy) || 1;
      return [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]]
        .sort((a, b) => (b[0] * dx + b[1] * dy) / (dl * Math.hypot(...b)) - (a[0] * dx + a[1] * dy) / (dl * Math.hypot(...a))); };
    const lim = o => 0.03 * o.it.w * o.it.h;
    // va chạm = nhãn khác / thẻ trên cùng / ghim nhà + biểu tượng các tiện ích khác; lòi khỏi khung an toàn = hết chỗ
    const hitAt = (o, b, i) => inside(b) ? hitOf(b) + bubs.reduce((s2, d, j) => s2 + (j === i ? 0 : ovl(b, d)), 0) : 1e9;
    const best = (o, i) => { let r = null; for (const d of dirsOf(o)) { const b = boxOf(o, d), hit = hitAt(o, b, i); if (!r || hit < r.hit - 1) r = { d, b, hit }; if (!hit) break; } return r; };
    const keep = (o, i) => { const m = labMem[o.it.key]; if (!m) return null; const b = boxOf(o, m); return hitAt(o, b, i) <= lim(o) ? { d: m, b, hit: 0 } : null; };
    const pos = new Map();
    // 1) nhãn cũ đang hiện: giữ phía cũ nếu còn trống
    L.forEach((o, i) => { if (!o.it.optional || !(labFade[o.it.key]?.v > 0.3)) return; const r = keep(o, i); if (r) { pos.set(i, r); P.push(r.b); } });
    // 2) nhãn mới nhất: phía trống tốt nhất; hết chỗ thì vẫn hiện, nhãn cũ bị chiếm chỗ phải tìm phía khác
    L.forEach((o, i) => { if (o.it.optional) return;
      const r = keep(o, i) || best(o, i);
      for (const [j, q] of [...pos]) if (ovl(q.b, r.b) > lim(L[j])) { pos.delete(j); P.splice(P.indexOf(q.b), 1); }
      pos.set(i, r); P.push(r.b); });
    // 3) nhãn còn lại: tìm phía trống, không có thì mờ đi
    L.forEach((o, i) => { if (pos.has(i)) return; const r = keep(o, i) || best(o, i); if (r.hit <= lim(o)) { pos.set(i, r); P.push(r.b); } });
    L.forEach((o, i) => {
      const { it } = o, q = pos.get(i), m = labMem[it.key], f = labFade[it.key];
      if (!it.optional) { labMem[it.key] = q.d; labFade[it.key] = { v: 1, t }; out.push({ ...it, px: o.px, py: o.py, box: q.b, side: q.d, a: it.a }); return; }
      const moved = q && m && (q.d[0] !== m[0] || q.d[1] !== m[1]);
      let v0 = !f || Math.abs(t - f.t) > 0.5 ? (q ? 1 : 0) : f.v;
      if (moved) v0 = 0;   // đổi phía: tắt ở chỗ cũ, hiện dần ở chỗ mới
      const target = q ? 1 : 0, v = v0 + Math.sign(target - v0) * Math.min(Math.abs(target - v0), (f ? Math.min(0.5, Math.abs(t - f.t)) : 0.5) / 0.25);
      labFade[it.key] = { v, t };
      if (q) { labMem[it.key] = q.d; out.push({ ...it, px: o.px, py: o.py, box: q.b, side: q.d, a: it.a * v }); }
      else if (v > 0.01 && m) out.push({ ...it, px: o.px, py: o.py, box: boxOf(o, m), side: m, a: it.a * v });   // mờ đi tại chỗ cũ
    });
  }
  // 3 mẫu thẻ (15/11 vòng 5, Giang: thẻ chưa đẹp, còn nhảy to nhỏ) — khách chọn ở "Mẫu thẻ tiện ích" (story.labelStyle):
  // trang = thẻ trắng kiểu bản đồ (chữ đậm xanh than, phút đỏ) · kinh = kính tối (chữ trắng, phút vàng) · mau = nền màu theo loại tiện ích.
  // Thẻ KHÔNG phóng to / thu nhỏ: hiện bằng mờ dần + trượt nhẹ lên → cỡ thẻ luôn cố định; đuôi tam giác + đường chỉ thẳng xuống chấm đỏ.
  const tint = (hex, f) => { const n = parseInt(hex.slice(1), 16), m = c => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f); return `rgb(${m(n >> 16 & 255)},${m(n >> 8 & 255)},${m(n & 255)})`; };
  function drawLabel(ctx, L) {
    const [ic, col] = CAT3D[L.cat] || ['pin', GOLD];
    const e = clamp01(L.a);
    if (e <= 0) return;
    const sty = story.labelStyle || 'trang';
    if (L.rad) { radLabel(ctx, L); return; }
    const [bx0, by0, bx1, by1] = L.box, up = L.py >= by1;   // up: thẻ nằm trên chấm
    const dy = (1 - easeOut(clamp01(e / 0.6))) * 10 * k * (up ? 1 : -1);
    const x0 = bx0, x1 = bx1, y0 = by0 + dy, y1 = by1 + dy, w = x1 - x0, h = y1 - y0, cy = (y0 + y1) / 2;
    const T = { trang: { bg: 'rgba(255,255,255,0.97)', ink: '#0F172A', sub: '#D62828', edge: null },
      kinh: { bg: 'rgba(10,16,30,0.86)', ink: '#FFFFFF', sub: '#FFD54A', edge: 'rgba(255,255,255,0.22)' },
      mau: { bg: col, ink: '#0B1220', sub: tint(col, -0.62), edge: 'rgba(255,255,255,0.6)' } }[sty] || {};
    ctx.save();
    ctx.globalAlpha = clamp01(e / 0.5);
    // đường chỉ thẳng đứng xuống chấm đỏ (thẻ bị kẹp ở mép khung thì chân đường chỉ trượt trong thẻ, chấm vẫn đúng chỗ)
    const sx = Math.max(x0 + 14 * k, Math.min(x1 - 14 * k, L.px)), tl2 = (L.compact ? 5 : 7) * k, sy = up ? y1 + tl2 : y0 - tl2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 4 * k;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(L.px, L.py); ctx.lineWidth = (L.compact ? 1.6 : 2.2) * k; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.stroke();
    ctx.shadowColor = 'rgba(255,59,48,.8)'; ctx.shadowBlur = 10 * k;
    ctx.beginPath(); ctx.arc(L.px, L.py, (L.compact ? 5 : 6.5) * k, 0, 7); ctx.fillStyle = '#FF3B30'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 2 * k; ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
    ctx.restore();
    // thân thẻ + đuôi tam giác liền khối
    const r = (L.compact ? 9 : 12) * k;
    ctx.beginPath(); ctx.roundRect(x0, y0, w, h, r);
    if (up) { ctx.moveTo(sx - tl2, y1 - 0.5); ctx.lineTo(sx, y1 + tl2); ctx.lineTo(sx + tl2, y1 - 0.5); } else { ctx.moveTo(sx - tl2, y0 + 0.5); ctx.lineTo(sx, y0 - tl2); ctx.lineTo(sx + tl2, y0 + 0.5); }
    ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,.42)'; ctx.shadowBlur = 16 * k; ctx.shadowOffsetY = 5 * k;
    if (sty === 'mau') { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, tint(col, 0.28)); g.addColorStop(1, col); ctx.fillStyle = g; } else ctx.fillStyle = T.bg;
    ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowOffsetY = 0;
    if (T.edge) { ctx.lineWidth = 1.2 * k; ctx.strokeStyle = T.edge; ctx.stroke(); }
    if (sty === 'trang') { ctx.beginPath(); ctx.roundRect(x0, y0, 4 * k, h, [r, 0, 0, r]); ctx.fillStyle = col; ctx.fill(); }   // gờ màu loại tiện ích bên trái
    // biểu tượng tròn
    const isz = L.isz, ix = x0 + (L.compact ? 5 : 8) * k, icx = ix + isz / 2;
    ctx.beginPath(); ctx.arc(icx, cy, isz / 2, 0, 7); ctx.fillStyle = sty === 'mau' ? '#FFFFFF' : col; ctx.fill();
    drawIcon(ctx, ic, icx, cy, L.glyph * k, sty === 'mau' ? tint(col, -0.55) : '#0b1220');
    const tx = ix + isz + (L.compact ? 6 : 8) * k;
    const lh = (L.lh ?? LB.line) * k;
    let ty = L.compact ? cy + L.fs * 0.36 * k : y0 + (L.ty0 ?? 22) * k;
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = T.ink; ctx.font = font(800, L.fs);
    for (const ln of L.lines) { ctx.fillText(ln, tx, ty); ty += lh; }
    if (L.sub) { ctx.fillStyle = T.sub; ctx.font = font(800, L.subFs ?? LB.sub); ctx.fillText(L.sub, tx, ty - lh + (L.subDy ?? 18) * k); }
    ctx.restore();
  }
  // nhãn radar: chữ trắng Be Vietnam 800 viền tối + bóng (đọc rõ trên ảnh vệ tinh), khoảng cách vàng nhỏ ở dòng dưới; canh theo phía
  function radLabel(ctx, L) {
    const [x0, y0, x1, y1] = L.box, ax = L.side?.[0] || 0, x = ax > 0 ? x0 + 2 * k : ax < 0 ? x1 - 2 * k : (x0 + x1) / 2;
    ctx.save();
    ctx.globalAlpha = clamp01(L.a / 0.5);
    ctx.textAlign = ax > 0 ? 'left' : ax < 0 ? 'right' : 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const line = (txt, y, f, col, lw) => {
      ctx.font = f; ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 6 * k; ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,12,22,.9)';
      ctx.strokeText(txt, x, y); ctx.shadowColor = 'transparent'; ctx.fillStyle = col; ctx.fillText(txt, x, y);
    };
    line(L.name0, y0 + 9 * k, font(800, 13.5), '#FFFFFF', 3.6 * k);
    if (L.dist) line(L.dist, y0 + 23.5 * k, font(700, 11.5), '#FFD54A', 3.2 * k);
    ctx.restore();
  }
  function head(ctx, path, q, col) {   // chấm sáng ở đầu đường đang chạy
    if (q <= 0 || q >= 1) return;
    const [x, y] = proj(pointAt(path, q).pt);
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 20 * k;
    ctx.beginPath(); ctx.arc(x, y, 6.5 * k, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 3.8 * k, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.restore();
  }
  // Phụ đề kiểu app cũ: mỗi lúc một cụm ngắn ở giữa vùng an toàn (≈ 72% chiều cao), chữ 800 trắng / từ khoá vàng,
  // bóng đậm; từng từ bật ra (phóng 0,62 → vượt nhẹ → 1, nhích lên) nối nhau 0,07 s
  function caption(ctx, s, t, maxBase = Infinity) {
    const caps = s.caps || [];
    let c = null;
    for (const x of caps) if (t >= x.t0 - 0.02) c = x;
    // cụm cuối không treo mãi khi cảnh dài hơn lời (cảnh ảnh 12 ảnh × 3 s): tắt sau khi đọc xong 1,2 s
    if (!c || t > s.t1 - 0.12 || (c === caps[caps.length - 1] && t > c.t1 + 1.2)) return;
    drawCap3D(ctx, c, t, width, height, maxBase);
  }
  // thẻ trên cùng: nằm dưới vùng che phía trên (tên tài khoản / tab của nền tảng)
  const PANEL_Y = () => SAFE.top * height + 8 * k;
  function panel(ctx, a, y, h) {
    ctx.globalAlpha = clamp01(a);
    const x0 = SAFE.x * width, x1 = width - SAFE.x * width;
    const g = ctx.createLinearGradient(x0, y, x1, y + h); g.addColorStop(0, 'rgba(11,18,32,.93)'); g.addColorStop(1, 'rgba(26,36,64,.93)');
    rrect(ctx, x0, y, x1 - x0, h, 14 * k); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1 * k; ctx.strokeStyle = 'rgba(245,196,81,.35)'; ctx.stroke();
  }
  function infoCard(ctx, a, title, chips) {
    if (a <= 0) return;
    const y0 = PANEL_Y(), x0 = SAFE.x * width + 14 * k;
    ctx.save(); ctx.translate(0, (1 - easeOut(clamp01(a))) * -12 * k);
    panel(ctx, a, y0, 86 * k);
    ctx.fillStyle = GOLD; ctx.font = font(900, 27); ctx.fillText(fitEllipsis(ctx, title || '', width - 2 * SAFE.x * width - 28 * k), x0, y0 + 34 * k);
    let x = x0; ctx.font = font(700, 14.5);
    for (const c of chips) {
      const w = ctx.measureText(c).width + 18 * k;
      if (x + w > width - SAFE.x * width - 10 * k) break;
      rrect(ctx, x, y0 + 48 * k, w, 27 * k, 9 * k); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(c, x + 9 * k, y0 + 66.5 * k); x += w + 6 * k;
    }
    ctx.restore();
  }
  // 16/11 (Giang: thiếu cảnh kết nối vùng): thẻ "KẾT NỐI VÙNG" trên cùng suốt các cảnh điểm mốc + cảnh tổng; dòng dưới kể các điểm
  // (Trung tâm · Sân bay · Cảng biển), điểm đang nói chữ trắng, điểm chưa tới mờ
  const A_WORD = { center: 'Trung tâm', airport: 'Sân bay', port: 'Cảng biển', metro: 'Ga metro', station: 'Ga tàu' };
  const ancScenes = tl.scenes.filter(x => x.kind === 'anchor' || x.kind === 'region');
  function regionChip(ctx, t, s) {
    if (!ancScenes.length) return;
    const a = clamp01(Math.min((t - ancScenes[0].t0) / 0.4, (ancScenes[ancScenes.length - 1].t1 - t) / 0.3));
    if (a <= 0) return;
    const names = story.anchors.map(x => A_WORD[x.type] || 'Điểm mốc'), cur = s.kind === 'anchor' ? s.i : -1;
    const title = 'KẾT NỐI VÙNG', sep = '  ·  ';
    ctx.save();
    ctx.font = font(900, 16); const wt = ctx.measureText(title).width;
    ctx.font = font(700, 13); const ws = names.map(n => ctx.measureText(n).width), wsep = ctx.measureText(sep).width;
    const w2 = ws.reduce((p, q) => p + q, 0) + wsep * Math.max(0, names.length - 1);
    const W = Math.max(wt, w2) + 40 * k, Hh = 52 * k, x0 = (width - W) / 2, y0 = PANEL_Y();
    ctx.globalAlpha = a; ctx.translate(0, (1 - easeOut(a)) * -10 * k);
    ctx.fillStyle = 'rgba(6,14,28,.84)'; ctx.beginPath(); ctx.roundRect(x0, y0, W, Hh, 16 * k); ctx.fill();
    ctx.lineWidth = 1.4 * k; ctx.strokeStyle = 'rgba(245,196,81,.75)'; ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = font(900, 16); ctx.fillStyle = GOLD; ctx.fillText(title, width / 2, y0 + 17 * k);
    ctx.textAlign = 'left'; ctx.font = font(700, 13);
    let x = width / 2 - w2 / 2;
    names.forEach((n, i) => {
      ctx.fillStyle = cur < 0 || i === cur ? '#FFFFFF' : i < cur ? 'rgba(255,255,255,.72)' : 'rgba(255,255,255,.4)';
      ctx.fillText(n, x, y0 + 37 * k); x += ws[i];
      if (i < names.length - 1) { ctx.fillStyle = 'rgba(245,196,81,.6)'; ctx.fillText(sep, x, y0 + 37 * k); x += wsep; }
    });
    ctx.restore();
  }
  // Tổng kết = 3 con số lớn (15/11, thay bảng 5 dòng chữ nhỏ): số chạy từ 0, mỗi ô bật lần lượt
  function statsCard(ctx, a, grow) { drawStats(ctx, story.stats || [], a, grow, width, height); }
  // nút kêu gọi cuối: trên phụ đề, trong dải an toàn (né cột nút bên phải của nền tảng); 2 dòng: từ khoá + "để nhận …"
  function cta(ctx, a) {
    if (a <= 0) return;
    const x0 = SAFE.x * width, x1 = width - SAFE.r * width, h = 62 * k, y = height * CAP_Y - h - 34 * k;
    ctx.save(); ctx.globalAlpha = clamp01(a);
    ctx.translate((x0 + x1) / 2, y + h / 2); const sc = (0.85 + 0.15 * POP(clamp01(a))) * (1 + 0.025 * Math.sin(lastT * 5)); ctx.scale(sc, sc);
    const g = ctx.createLinearGradient(-(x1 - x0) / 2, 0, (x1 - x0) / 2, 0); g.addColorStop(0, '#FFE9A3'); g.addColorStop(0.5, GOLD); g.addColorStop(1, '#D49A1E');
    ctx.shadowColor = 'rgba(245,196,81,.55)'; ctx.shadowBlur = 20 * k;
    rrect(ctx, -(x1 - x0) / 2, -h / 2, x1 - x0, h, 16 * k); ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#1a1205'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(900, 18); ctx.fillText(fitEllipsis(ctx, '💬 ' + story.cta, x1 - x0 - 16 * k), 0, -9 * k);
    ctx.font = font(700, 13); ctx.fillText(story.ctaSub || '', 0, 15 * k);
    ctx.restore();
  }
  // Thanh kêu gọi nhỏ suốt video (từ giây 8 tới cảnh kêu gọi cuối), ngay dưới phụ đề; giữa video nở to thành cả câu 2,8 s
  function ctaBar(ctx, t, s) {
    if (!story.cta || t < tl.barFrom || s.kind === 'cta') return;
    const a = clamp01((t - tl.barFrom) / 0.4);
    const m = tl.ctaMid != null ? t - tl.ctaMid : -1, big = m >= 0 && m < 2.8 ? Math.min(clamp01(m / 0.3), clamp01((2.8 - m) / 0.3)) : 0;
    // đáy thanh = mép trên dải che phía dưới (tên tài khoản / mô tả) → không đè phụ đề ở 72% chiều cao
    const x0 = SAFE.x * width, x1 = width - SAFE.r * width, yb = height * (1 - SAFE.bottom) - 2 * k;
    const txt = big > 0.5 ? '💬 ' + story.ctaLong : '💬 ' + story.cta;
    const fs = 12.5 + 1 * big, h = (27 + 4 * big) * k;
    ctx.save(); ctx.globalAlpha = a;
    ctx.font = font(800, fs);
    const w = Math.min(x1 - x0, ctx.measureText(txt).width + 26 * k), cx = (x0 + x1) / 2;
    const pulse = 1 + 0.04 * Math.max(0, Math.sin((t - tl.barFrom) * 1.6)) ** 8;   // nhún nhẹ ~4 s một lần
    ctx.translate(cx, yb - h / 2); ctx.scale(pulse, pulse);
    rrect(ctx, -w / 2, -h / 2, w, h, h / 2);
    if (big > 0) { const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0); g.addColorStop(0, '#FFE9A3'); g.addColorStop(0.5, GOLD); g.addColorStop(1, '#D49A1E'); ctx.fillStyle = g; ctx.globalAlpha = a * big; ctx.fill(); ctx.globalAlpha = a; }
    if (big < 1) { ctx.fillStyle = `rgba(11,18,32,${0.82 * (1 - big)})`; ctx.fill(); ctx.lineWidth = 1.4 * k; ctx.strokeStyle = 'rgba(245,196,81,.9)'; ctx.stroke(); }
    ctx.fillStyle = big > 0.5 ? '#1a1205' : '#FFE08A'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fitEllipsis(ctx, txt, w - 18 * k), 0, 1 * k);
    ctx.restore();
  }
  // Ghim vị trí căn nhà: giọt nước vàng kim (chuyển sắc), viền sáng, ô tròn tối có biểu tượng nhà vàng; rơi xuống nảy nhẹ
  // lúc khối nhà dựng (5,2 s) + 2 vòng sóng vàng nằm nghiêng trên mặt đất
  const PIN_DROP = PIN_T;
  const goldPin = drawGoldPin;
  function pin(ctx, t) {
    const [x, y] = proj(H);
    const u = t - PIN_DROP;
    // vòng sóng vàng nằm trên mặt đất (elip theo góc nghiêng)
    const squash = Math.max(0.35, Math.cos(map.getPitch() * Math.PI / 180));
    if (u > 0) for (const off of [0, 0.5]) {
      const q = ((t / 1.8) + off) % 1;
      ctx.beginPath(); ctx.ellipse(x, y, (8 + q * 42) * k, (8 + q * 42) * squash * k, 0, 0, 7);
      ctx.strokeStyle = `rgba(245,196,81,${0.8 * (1 - q)})`; ctx.lineWidth = 2.4 * k; ctx.stroke();
    }
    // rơi + nảy (trước lúc rơi: ghim đứng sẵn, nhỏ hơn — nhìn rõ vị trí trong cú bay xuống)
    const e = u <= 0 ? 1 : easeBounce(clamp01(u / 0.7));
    // vòng 13: ghim đứng trên MÁI khối căn nhà (chiều cao khối × điểm ảnh/mét theo phương ngang màn hình × sin góc nghiêng)
    let roof = 0;
    if (!story.lot && story.kind !== 'canho') {
      const hh = houseH(t) * houseVis(t);
      if (hh > 0.05) { const q = proj(offM(H, 20, map.getBearing() + 90)); roof = hh * Math.hypot(q[0] - x, q[1] - y) / 20 * Math.sin(map.getPitch() * Math.PI / 180); }
    }
    const lift = (u <= 0 ? 0 : (1 - e) * 90 * k) + roof;
    // bóng dưới chân ghim (trên mái khi có khối nhà)
    ctx.beginPath(); ctx.ellipse(x, y - roof + 1 * k, 11 * k, 4 * k, 0, 0, 7); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    goldPin(ctx, x, y - lift, (u <= 0 ? 0.8 : 1) * k, story.kind === 'datnen' || story.kind === 'nhavuon' ? 'pin' : story.kind === 'canho' ? 'city' : 'house');
  }
  // Ghim nhỏ dưới chân nhãn tiện ích: chấm màu nhóm, viền vàng
  function poiPin(ctx, at, cat) {
    const [x, y] = proj(at), col = CAT3D[cat]?.[1] || GOLD;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 6 * k, 0, 7); ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 2.2 * k; ctx.strokeStyle = GOLD; ctx.shadowColor = 'rgba(245,196,81,.8)'; ctx.shadowBlur = 10 * k; ctx.stroke();
    ctx.restore();
  }
  // Chữ thương hiệu mờ suốt video — giống kiểu cũ (render.js drawWatermark): chữ in hoa nghiêng, đổi 4 chỗ mỗi 6 s
  const WM_SPOTS = [[0.30, 0.34], [0.68, 0.56], [0.32, 0.66], [0.66, 0.28]], WM_PERIOD = 6;
  function watermark(ctx, t) {
    const text = String(story.watermark || '').trim().toUpperCase();
    if (!text) return;
    const t0 = 0.6, t1 = tl.duration - 0.2;
    if (t < t0 || t > t1) return;
    const u = t - t0, i = Math.floor(u / WM_PERIOD), lu = u - i * WM_PERIOD;
    const a = Math.min(1, lu / 0.5, (WM_PERIOD - lu) / 0.5, (t1 - t) / 0.5);
    if (a <= 0.01) return;
    const sp = WM_SPOTS[i % WM_SPOTS.length];
    let size = Math.round(Math.min(width, height) * 0.042);
    ctx.save();
    ctx.font = `900 ${size}px Montserrat, ${FONT}`;
    let tw = ctx.measureText(text).width;
    if (tw > width * 0.66) { size = Math.max(11, size * width * 0.66 / tw); ctx.font = `900 ${size}px Montserrat, ${FONT}`; tw = ctx.measureText(text).width; }
    ctx.translate(Math.max(tw / 2 + 8, Math.min(width - tw / 2 - 8, width * sp[0])), height * sp[1]);
    ctx.rotate(-0.16); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = a * 0.32; ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(text, 0, 0);
    ctx.globalAlpha = a * 0.46; ctx.fillStyle = '#fff'; ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  function ring(ctx, a) {
    if (a <= 0) return;
    const pts = circleKm(H, story.scoreR || 1).map(proj);
    ctx.save(); ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.fillStyle = `rgba(76,201,240,${0.1 * a})`; ctx.fill();
    ctx.setLineDash([4 * k, 4 * k]); ctx.lineWidth = 2 * k; ctx.strokeStyle = `rgba(76,201,240,${0.9 * a})`; ctx.stroke();
    ctx.restore();
  }
  // Radar quét bán kính (15/11 vòng 7): 3 vòng tròn đồng tâm in trên mặt đất, tia quét quay theo chiều kim đồng hồ (dải sáng mờ dần
  // phía sau), tiện ích thật sáng lên đúng lúc tia đi qua (s.hits, cùng công thức với tiếng tick), thẻ đếm số tiện ích tăng dần
  const geoAt = (b, dKm) => [H[0] + dKm * Math.sin(b * Math.PI / 180) / (111.32 * Math.cos(H[1] * Math.PI / 180)), H[1] + dKm * Math.cos(b * Math.PI / 180) / 110.54];
  // vòng 8: tia quét đi TỪNG điểm một — tới đúng hướng tiện ích j đúng lúc nhãn j bật (s.beats), giữa 2 điểm quay đều (hơi êm 2 đầu);
  // hết điểm cuối thì quay nốt vòng; trước điểm đầu: từ hướng Bắc lúc bắt đầu quét
  function beamAt(s, t) {
    const B = s.beats, A = story.radar.pts.map(p => p.ang), tS = s.t0 + RADAR_AT, n = B.length;
    const seg = (t0, a0, t1, a1) => { const u = clamp01((t - t0) / Math.max(1e-3, t1 - t0)); return a0 + (a1 - a0) * (0.7 * u + 0.3 * u * u * (3 - 2 * u)); };
    if (t <= B[0]) return seg(tS, 0, B[0], A[0]);
    for (let j = 1; j < n; j++) if (t <= B[j]) return seg(B[j - 1], A[j - 1], B[j], A[j]);
    const rate = Math.max(40, (360 - A[n - 1]) / Math.max(0.6, s.t1 - 0.4 - B[n - 1]));
    return A[n - 1] + rate * (t - B[n - 1]);
  }
  function radarFx(ctx, t, s, full = true) {
    const R = full ? story.radar.r : story.scoreR || 1, u = t - s.t0, a = Math.min(clamp01(u / 0.8), clamp01((s.t1 - t) / 0.5)) * (full ? 1 : 0.7);
    if (a <= 0) return;
    const [hx, hy] = proj(H);
    ctx.save();
    for (const f of [1 / 3, 2 / 3, 1]) {
      const P = circleKm(H, R * f, 96).map(proj);
      ctx.beginPath(); P.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
      if (f === 1) { ctx.fillStyle = `rgba(76,201,240,${0.07 * a})`; ctx.fill(); }
      ctx.lineWidth = (f === 1 ? 2.6 : 1.3) * k; ctx.strokeStyle = `rgba(120,225,255,${(f === 1 ? 0.95 : 0.4) * a})`;
      ctx.shadowColor = 'rgba(76,201,240,.9)'; ctx.shadowBlur = f === 1 ? 10 * k : 0; ctx.stroke(); ctx.shadowBlur = 0;
    }
    if (u >= RADAR_AT) {
      const th = full ? beamAt(s, t) : 360 * (u - RADAR_AT) / RADAR_SWEEP, N = 16, span = 75;
      for (let i = 0; i < N; i++) {   // dải sáng phía sau tia: các lát mỏng, càng xa tia càng mờ
        const b0 = th - span * (i + 1) / N, b1 = th - span * i / N, al = 0.34 * (1 - i / N) ** 1.6 * a;
        ctx.beginPath(); ctx.moveTo(hx, hy);
        for (let q = 0; q <= 4; q++) { const [x, y] = proj(geoAt(b0 + (b1 - b0) * q / 4, R)); ctx.lineTo(x, y); }
        ctx.closePath(); ctx.fillStyle = `rgba(94,234,245,${al})`; ctx.fill();
      }
      const [ex, ey] = proj(geoAt(th, R));
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.lineWidth = 2.4 * k; ctx.strokeStyle = `rgba(220,255,255,${0.95 * a})`;
      ctx.shadowColor = 'rgba(94,234,245,1)'; ctx.shadowBlur = 12 * k; ctx.stroke(); ctx.shadowBlur = 0;
    }
    // cảnh tổng kết: vòng + tia quét + các chấm tiện ích đã quét (mờ, không nhãn) — 3 con số lớn đã ở trên
    const rs = tl.scenes.find(x => x.kind === 'radar');
    if (!full) {
      if (rs) story.radar.pts.forEach(p => { if (kmBetween(H, p.at) > R * 1.02) return; const [x, y] = proj(p.at), col = CAT3D[p.cat]?.[1] || GOLD;
        ctx.globalAlpha = a * 0.85; ctx.beginPath(); ctx.arc(x, y, 3.6 * k, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1 * k; ctx.strokeStyle = '#fff'; ctx.stroke(); });
      ctx.restore(); return;
    }
    let n = 0;
    story.radar.pts.forEach((p, i) => {
      const h = s.hits[i];
      if (t < h) return;
      n++;
      const [x, y] = proj(p.at), age = t - h, [ic, col] = CAT3D[p.cat] || ['pin', GOLD], rb = RB() * (age < 0.3 ? easeOut(age / 0.3) : 1);
      // vòng 8b: mỗi tiện ích là MỘT biểu tượng tròn màu theo loại (trường, chợ, y tế…), gợn sóng lúc tia quét chạm
      if (age < 0.8) { ctx.beginPath(); ctx.arc(x, y, RB() + 18 * k * age / 0.8, 0, 7); ctx.lineWidth = 2 * k; ctx.strokeStyle = col; ctx.globalAlpha = a * (1 - age / 0.8); ctx.stroke(); }
      if (rb <= 0.5) return;
      ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x, y, rb, 0, 7);
      ctx.fillStyle = col; ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 6 * k; ctx.fill(); ctx.shadowBlur = 0;
      ctx.lineWidth = 1.8 * k; ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
      drawIcon(ctx, ic, x, y, 13 * k * rb / RB(), '#0b1220');
    });
    ctx.globalAlpha = 1;
    // thẻ đếm trên cùng: "BÁN KÍNH 2 KM" + số tiện ích đã sáng (tăng dần theo tia quét)
    const txt = `${n}`, sub = `tiện ích trong bán kính ${String(R).replace(".", ",")} km`, y0 = PANEL_Y();
    ctx.font = font(900, 34); const w1 = ctx.measureText(txt).width; ctx.font = font(700, 13); const w2 = ctx.measureText(sub).width;
    const W = w1 + w2 + 34 * k, x0 = (width - W) / 2;
    ctx.globalAlpha = clamp01(a * Math.min(1, (t - s.hits[0]) / 0.3));   // thẻ đếm hiện khi tiện ích đầu tiên sáng (không đứng "0" mấy giây)
    ctx.fillStyle = 'rgba(6,14,28,.82)'; ctx.beginPath(); ctx.roundRect(x0, y0, W, 50 * k, 25 * k); ctx.fill();
    ctx.lineWidth = 1.4 * k; ctx.strokeStyle = 'rgba(94,234,245,.8)'; ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = font(900, 34); ctx.fillStyle = '#5EEAF5'; ctx.fillText(txt, x0 + 14 * k, y0 + 26 * k);
    ctx.font = font(700, 13); ctx.fillStyle = '#fff'; ctx.fillText(sub, x0 + 20 * k + w1, y0 + 26 * k);
    ctx.restore();
  }
  // lô đất nền: viền sáng + số mét từng cạnh
  function lotOverlay(ctx, a, labels = true) {
    if (!story.lot || a <= 0) return;
    const R = story.lot.ring, P = R.map(proj);
    ctx.save(); ctx.globalAlpha = clamp01(a);
    ctx.beginPath(); P.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    ctx.shadowColor = GOLD; ctx.shadowBlur = 18 * k; ctx.lineWidth = 3 * k; ctx.strokeStyle = GOLD; ctx.stroke();
    ctx.shadowColor = 'transparent';
    if (!labels) { ctx.restore(); return; }
    const cx = P.slice(0, -1).reduce((s2, q) => s2 + q[0], 0) / (P.length - 1), cy = P.slice(0, -1).reduce((s2, q) => s2 + q[1], 0) / (P.length - 1);
    ctx.font = font(800, 14); ctx.textAlign = 'center';
    for (let i = 0; i + 1 < R.length; i++) {
      const m = kmBetween(R[i], R[i + 1]) * 1000;
      if (m < 1) continue;
      // số mét đặt ra phía ngoài cạnh (theo hướng từ tâm lô ra giữa cạnh)
      const [mx, my] = proj([(R[i][0] + R[i + 1][0]) / 2, (R[i][1] + R[i + 1][1]) / 2]);
      const dl = Math.hypot(mx - cx, my - cy) || 1, x = mx + (mx - cx) / dl * 22 * k, y = my + (my - cy) / dl * 16 * k;
      const txt = `${m.toFixed(1).replace('.', ',')} m`, w = ctx.measureText(txt).width + 14 * k;
      rrect(ctx, x - w / 2, y - 13 * k, w, 23 * k, 9 * k); ctx.fillStyle = 'rgba(11,18,32,.85)'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(txt, x, y + 4.5 * k);
    }
    ctx.restore();
  }
  // máy bay cất cánh (nhìn từ trên, hướng/tỉ lệ theo phép chiếu tại chỗ) + bóng + vệt khói
  const PLANE = new Path2D('M50 0C50 4.5 44 5.5 36 5.5L-38 4.5L-50 2L-50 -2L-38 -4.5L36 -5.5C44 -5.5 50 -4.5 50 0Z M12 5L-16 50L-25 50L-10 5Z M12 -5L-16 -50L-25 -50L-10 -5Z M-36 4L-47 19L-52 19L-46 3.5Z M-36 -4L-47 -19L-52 -19L-46 -3.5Z');
  const offM = (pt, m, deg) => { const r = deg * Math.PI / 180; return [pt[0] + m * Math.sin(r) / (111320 * Math.cos(pt[1] * Math.PI / 180)), pt[1] + m * Math.cos(r) / 110540]; };
  function plane(ctx, t, s) {
    const rw = inf.airport, u = t - s.t0 - AP_OFF - 1.9;
    if (u < 0) return;
    const P = planeAt(rw, u);
    const g0 = proj(P.pt), g1 = proj(offM(P.pt, 40, P.dir)), g2 = proj(offM(P.pt, 40, P.dir + 90));
    const fx = (g1[0] - g0[0]) / 40, fy = (g1[1] - g0[1]) / 40, rx = (g2[0] - g0[0]) / 40, ry = (g2[1] - g0[1]) / 40;   // px trên 1 m
    const ppm = Math.hypot(rx, ry), sinP = Math.sin(map.getPitch() * Math.PI / 180);
    const up = P.alt * ppm * sinP;
    // máy bay vẽ phóng to so với bản đồ (như app cũ): dài ~70 px khung thiết kế, lên cao to thêm → góc rộng vẫn thấy rõ
    const sizeM = (70 + 34 * clamp01(P.alt / 320)) * k / Math.max(1e-6, Math.hypot(fx, fy));
    const body = (dx, dy, fill, alpha) => {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.setTransform(fx * sizeM / 100, fy * sizeM / 100, rx * sizeM / 100, ry * sizeM / 100, g0[0] + dx, g0[1] + dy);
      ctx.fillStyle = fill; ctx.fill(PLANE); ctx.restore();
    };
    ctx.save();
    for (let j = 1; j <= 16; j++) {   // vệt khói sau máy bay
      const Q = planeAt(rw, u - j * 0.11); if (Q.alt <= 0) break;
      const q = proj(Q.pt);
      ctx.beginPath(); ctx.arc(q[0], q[1] - Q.alt * ppm * sinP, (2.4 + j * 0.3) * k, 0, 7); ctx.fillStyle = `rgba(255,255,255,${0.34 * (1 - j / 17)})`; ctx.fill();
    }
    body(0, 0, 'rgba(0,0,0,.38)', clamp01(1 - P.alt / 260));   // bóng dưới đất
    body(0, -up, '#f5f8ff', 1);
    ctx.restore();
  }
  // tàu metro: 3 toa dạng khối (mặt bên tối + mặt trên sáng) chạy dọc tuyến; toa phóng to để thấy ở cỡ cảnh quận
  function train(ctx, t, s) {
    const u0 = (t - s.t0 - 1.4) / Math.max(1, s.t1 - s.t0 - 1.4);
    if (u0 < 0) return;
    const u = clamp01(u0), carM = 150, gap = 12, L = metroPath.len, sinP = Math.sin(map.getPitch() * Math.PI / 180);
    const cars = [];
    for (let c = 0; c < 3; c++) {
      const d0 = 0.1 + 0.85 * u - (c * (carM + gap)) / L;
      const a = pointAt(metroPath, d0), b = pointAt(metroPath, d0 - carM / L);
      const mid = [(a.pt[0] + b.pt[0]) / 2, (a.pt[1] + b.pt[1]) / 2];
      const base = rectM(mid, 42, carM, bearingGeo(b.pt, a.pt)).slice(0, 4).map(proj);   // to hơn thật (~4 lần) để rõ hơn đường line
      const r = proj(offM(mid, 10, 90)), m0 = proj(mid), ppm = Math.hypot(r[0] - m0[0], r[1] - m0[1]) / 10;
      const up = 38 * ppm * sinP;
      cars.push({ base, top: base.map(([x, y]) => [x, y - up]), y: m0[1], head: c === 0 });
    }
    cars.sort((a, b) => a.y - b.y);   // toa xa vẽ trước
    ctx.save();
    for (const car of cars) {
      const B = car.base, T = car.top;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        ctx.beginPath(); ctx.moveTo(...B[i]); ctx.lineTo(...B[j]); ctx.lineTo(...T[j]); ctx.lineTo(...T[i]); ctx.closePath();
        ctx.fillStyle = i % 2 ? '#c9d3df' : '#8e9aab'; ctx.fill();
      }
      ctx.beginPath(); T.forEach((q, i) => i ? ctx.lineTo(...q) : ctx.moveTo(...q)); ctx.closePath();
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 1.2 * k; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
      // sọc hồng giữa nóc toa (màu tuyến)
      const mA = [(T[0][0] + T[1][0]) / 2, (T[0][1] + T[1][1]) / 2], mB = [(T[2][0] + T[3][0]) / 2, (T[2][1] + T[3][1]) / 2];
      ctx.beginPath(); ctx.moveTo(...mA); ctx.lineTo(...mB); ctx.lineWidth = 2.4 * k; ctx.strokeStyle = CAT3D.metro[1]; ctx.stroke();
    }
    ctx.restore();
  }
  function metroStations(ctx) {
    for (const [name, at] of inf.metro.stations) {
      const [x, y] = proj(at);
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, 6 * k, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 3 * k; ctx.strokeStyle = CAT3D.metro[1]; ctx.stroke();
      ctx.font = font(700, 12.5); ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 6 * k; ctx.fillText(name, x + 9 * k, y + 4 * k);
      ctx.restore();
    }
  }
  function chip(ctx, x, y, txt) {
    ctx.save(); ctx.font = font(700, 13); const w = ctx.measureText(txt).width + 22 * k;
    rrect(ctx, x, y, w, 28 * k, 14 * k); ctx.fillStyle = 'rgba(11,18,32,.82)'; ctx.fill();
    ctx.lineWidth = 1 * k; ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.stroke();
    ctx.fillStyle = '#e8edf7'; ctx.fillText(txt, x + 11 * k, y + 19 * k); ctx.restore();
  }

  // ---- ảnh căn nhà: phủ kín khung, lia/zoom chậm (Ken Burns), mỗi ảnh PHOTO_T giây, mờ dần sang ảnh sau ----
  // ảnh nằm trong "khung nguồn" (cover-fit) rồi thu nhỏ khung theo tỉ lệ zoom + dịch theo hướng lia
  function photoFrame(ctx, img, u, motion, alpha) {
    if (!img || alpha <= 0) return;
    const iw = img.width, ih = img.height, ar = width / height;
    let sw = iw, sh = iw / ar; if (sh > ih) { sh = ih; sw = ih * ar; }
    const e = EASE(clamp01(u));
    const z = [1 + 0.12 * e, 1.12 - 0.12 * e, 1.1, 1.1][motion];            // zoom vào / ra / lia ngang / lia dọc
    const w2 = sw / z, h2 = sh / z;
    const fx = motion === 2 ? lerp(0.15, 0.85, e) : 0.5, fy = motion === 3 ? lerp(0.85, 0.2, e) : 0.5;
    const sx = (iw - w2) * fx, sy = (ih - h2) * fy;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, sy, w2, h2, 0, 0, width, height);
    ctx.restore();
  }
  function photos(ctx, t, s) {
    const P = story.photos, lt = t - s.t0, PT = tl.photoT;
    const A = Math.min(clamp01(lt / 0.45), clamp01((s.t1 - t) / 0.45));   // vào/ra cảnh: mờ từ bản đồ sang ảnh
    const i = Math.min(P.length - 1, Math.floor(lt / PT)), u = (lt - i * PT) / PT;
    photoFrame(ctx, P[i], u, i % 4, A);
    const next = P[i + 1], fade = clamp01((lt - (i + 1) * PT + 0.5) / 0.5);   // 0,5 s cuối: ảnh sau hiện dần lên
    if (next && fade > 0) photoFrame(ctx, next, fade * 0.5 / PT, (i + 1) % 4, A * fade);
    // làm tối nhẹ mép dưới cho phụ đề luôn đọc rõ
    const g = ctx.createLinearGradient(0, height * 0.55, 0, height); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.save(); ctx.globalAlpha = A; ctx.fillStyle = g; ctx.fillRect(0, height * 0.55, width, height * 0.45); ctx.restore();
    // nhãn nhỏ cho người xem biết đây là ảnh thật của căn (khớp lời đọc "Đây là hình ảnh thực tế…")
    ctx.save(); ctx.globalAlpha = A; chip(ctx, SAFE.x * width, SAFE.top * height + 8 * k, `📷 Ảnh thực tế · ${i + 1}/${P.length}`); ctx.restore();
  }

  // ---- ảnh bìa (mẫu Giang chọn 11/11): các hộp chữ xếp chồng — tên căn (trắng), phường (màu nhấn), "GIÁ BÁN" (vàng trên đen),
  // giá rất to (màu nhấn, nghiêng nhẹ), 2 dòng phụ (nền tối). Nền: ảnh đầu tiên của căn, không có ảnh thì bản đồ tối đi.
  // Màu nhấn tự đổi theo căn (story.cover.color). Hiện ngay từ khung đầu → khung đầu MP4 = ảnh bìa trên TikTok/Facebook.
  const COVER_FONT = `Montserrat, ${FONT}`;
  function fitEllipsis(ctx, txt, maxW) {
    if (ctx.measureText(txt).width <= maxW) return txt;
    let s2 = txt; while (s2.length > 2 && ctx.measureText(s2 + '…').width > maxW) s2 = s2.slice(0, -1);
    return s2.trimEnd() + '…';
  }
  function cover(ctx, t) {
    const C = story.cover;
    if (!C || t > COVER_T + 0.5) return;
    const A = t < COVER_T - 0.2 ? 1 : clamp01((COVER_T + 0.4 - t) / 0.6);
    if (story.photos?.length) photoFrame(ctx, story.photos[0], t / (COVER_T + 2), 0, A);
    ctx.save(); ctx.globalAlpha = A * (story.photos?.length ? 0.32 : 0.42); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); ctx.restore();
    const band0 = SAFE.x * width + 8 * k, band1 = width - SAFE.r * width - 8 * k, maxW = band1 - band0;
    const boxes = [
      { txt: C.title, size: 21, bg: '#FFFFFF', ink: '#111111', w: 900 },
      C.ward && { txt: C.ward, size: 21, bg: C.color, ink: '#FFFFFF', w: 900 },
      { txt: C.label, size: 14, bg: 'rgba(12,12,12,.88)', ink: '#FFD54A', w: 900, gapTop: 10 },
      { txt: C.big, size: 56, bg: C.color, ink: '#FFFFFF', w: 900, big: true },
      // lợi ích mạnh nhất (số liệu quét thật) — khung vàng chữ đen, nổi ngay dưới giá
      C.hook && { txt: '📍 ' + C.hook.toUpperCase(), size: 19, bg: '#FFD54A', ink: '#111111', w: 900, gapTop: 10 },
      ...C.lines.slice(0, C.hook ? 1 : 2).map((l, j) => ({ txt: l, size: 16, bg: 'rgba(12,12,12,.72)', ink: '#FFFFFF', w: 700, body: true, gapTop: j ? 4 : 10 })),
    ].filter(Boolean);
    ctx.save(); ctx.textBaseline = 'middle';
    // đo + co chữ cho vừa dải an toàn
    for (const b of boxes) {
      let sz = b.size * k;
      ctx.font = `${b.w} ${sz}px ${b.body ? FONT : COVER_FONT}`;
      const padX = (b.big ? 16 : 11) * k;
      // chữ dài: co cỡ chữ cho vừa (ô giá co tới hết, ô khác co tới 65%), chừa 3% cho sai số làm tròn — không cắt chữ thành "…"
      const tw = ctx.measureText(b.txt).width, room = (maxW - padX * 2) * 0.97;
      if (tw > room) { sz *= Math.max(b.big ? 0 : 0.65, room / tw); ctx.font = `${b.w} ${sz}px ${b.body ? FONT : COVER_FONT}`; }
      b.txt2 = fitEllipsis(ctx, b.txt, maxW - padX * 2);
      b.sz = sz; b.padX = padX; b.h = sz * (b.big ? 1.32 : 1.55); b.bw = ctx.measureText(b.txt2).width + padX * 2; b.font = ctx.font;
    }
    const blockW = Math.max(...boxes.map(b => b.bw)), blockH = boxes.reduce((s2, b) => s2 + b.h + (b.gapTop || 0) * k, 0);
    const x0 = Math.max(band0, (band0 + band1) / 2 - blockW / 2);
    let y = height * 0.47 - blockH / 2;
    boxes.forEach((b, j) => {
      y += (b.gapTop || 0) * k;
      // 15/11: khung ĐẦU TIÊN đã thấy đủ chữ (TikTok/Facebook lấy khung đầu làm ảnh xem trước): các hộp hiện sẵn,
      // chỉ còn nhích nhẹ vào trong 0,25 s đầu
      const lt = t + 0.4 - j * 0.04, e = clamp01(lt / 0.32);
      if (e > 0) {
        ctx.save();
        ctx.globalAlpha = A * clamp01(e * 1.8);
        const cx = x0 + b.bw / 2, cy = y + b.h / 2;
        ctx.translate(cx + (1 - easeOut(e)) * -26 * k, cy);
        if (b.big) { const sc = 0.6 + 0.4 * POP(e); ctx.scale(sc, sc); ctx.rotate(-0.026); }
        ctx.fillStyle = b.bg; ctx.fillRect(-b.bw / 2, -b.h / 2, b.bw, b.h);
        ctx.font = b.font; ctx.fillStyle = b.ink; ctx.textAlign = 'left';
        ctx.fillText(b.txt2, -b.bw / 2 + b.padX, b.big ? b.sz * 0.04 : 1 * k);
        ctx.restore();
      }
      y += b.h;
    });
    ctx.restore();
  }

  // ---- chữ in dẹt trên mặt đất (tên trục đường dọc tuyến, tên vùng phủ lên vùng) ----------------------------------
  // 15/11 vòng 8 (Giang: "in dẹt 3D mặc định một kiểu chữ 3D dẹt khối, bỏ kiểu kia luôn"): MỌI chữ trên mặt đất (tên trục đường,
  // đường trước nhà, tên vùng, hạ tầng đang thi công) là chữ 3D dẹt khối kiểu cũ (layout3D / draw3D); bỏ kiểu chữ phẳng từng ký tự.
  const offLL = (pt, east, north) => [pt[0] + east / (111320 * Math.cos(pt[1] * Math.PI / 180)), pt[1] + north / 110540];
  function basis(pt, deg) {
    const r = deg * Math.PI / 180, ux = Math.sin(r), uy = Math.cos(r);   // hướng dọc tuyến (đông, bắc) trên 1 m
    const P = proj(pt), A = proj(offLL(pt, ux, uy)), B = proj(offLL(pt, -uy, ux));   // B: bên trái tuyến
    return { P, a: [A[0] - P[0], A[1] - P[1]], b: [B[0] - P[0], B[1] - P[1]] };
  }
  const lenM = path => path.len;
  const atM = (path, m) => pointAt(path, m / path.len).pt;
  const dirAt = (path, m, span) => bearingGeo(atM(path, Math.max(0, m - span)), atM(path, Math.min(path.len, m + span)));
  // Đặt chữ in dẹt dọc path: trả về vị trí từng ký tự + khung màn hình của chúng (để xét chữ đè nhau), chưa vẽ
  // độ rộng ký tự Montserrat 900 ở cỡ 100 px, đo một lần (đặt chữ thử nhiều chỗ mỗi khung → không đo lại)
  const W100 = new Map();
  const cw = (ctx, ch) => { let w = W100.get(ch); if (w == null) { ctx.save(); ctx.font = `900 100px Montserrat, ${FONT}`; w = ctx.measureText(ch).width; ctx.restore(); W100.set(ch, w); } return w; };
  // Tên trục đường kiểu cũ (render.js text3D, Giang chốt 23/10): chữ thẳng nằm trên mặt đất theo hướng tuyến,
  // mặt chữ trắng → màu line của trục, thân khối màu line tối dâng lên, bóng đậm
  const spW = (ctx, T, sp) => { let w = 0; for (const ch of T) w += ctx.measureText(ch).width + sp; return w - sp; };
  const spDo = (ctx, T, sp, fn) => { let x = -spW(ctx, T, sp) / 2; for (const ch of T) { ctx[fn](ch, x, 0); x += ctx.measureText(ch).width + sp; } };
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); return `rgb(${Math.round((n >> 16 & 255) * f)},${Math.round((n >> 8 & 255) * f)},${Math.round((n & 255) * f)})`; };
  function layout3D(ctx, path, mid, text, pxH, fix, stMax = 1.7) {
    if (!text || path.len < 5) return null;
    const T = String(text).toUpperCase(), pt = atM(path, mid);
    let bs = basis(pt, dirAt(path, mid, 20));
    if (bs.P[0] < -width || bs.P[0] > 2 * width || bs.P[1] < -height || bs.P[1] > 2 * height) return null;
    const bl = Math.hypot(...bs.b);
    if (bl < 1e-4) return null;
    // fix (vòng 6, Giang: chữ "lỗi to nhỏ"): giữ cỡ (mét), độ kéo dãn, chiều đọc của chữ đã có chỗ → không nhảy cỡ / lật chữ khi máy lượn
    let Hm = fix?.Hm != null ? fix.Hm : Math.min(900, pxH / bl);
    const st = fix ? fix.st : Math.max(1, Math.min(stMax, bl / Math.max(1e-6, Math.hypot(...bs.a))));
    let sp = Hm * 0.07, tw = [...T].reduce((x, ch) => x + cw(ctx, ch) * Hm / 100 + sp, -sp);
    if (path.maxM && fix?.Hm == null && tw * st > path.maxM) { const q = path.maxM / (tw * st); Hm *= q; sp *= q; tw *= q; }   // chữ tên vùng nằm gọn trong vùng
    const deg = dirAt(path, mid, Math.max(20, tw * st * 0.4));
    bs = basis(pt, deg);
    const al = Math.hypot(...bs.a), flip = fix ? fix.flip : bs.a[0] < 0;
    const inv = flip ? bs.a[0] > 0.25 * al : bs.a[0] < -0.25 * al;
    if (flip) bs = basis(pt, deg + 180);   // chữ đọc trái → phải
    const dpx = Hm * bl * 0.3, hw = tw * st / 2, hh = Hm * 0.5, boxes = [], nb = Math.max(6, [...T].length);
    for (let i = 0; i < nb; i++) {   // khung theo từng đoạn ~1 ký tự dọc chữ (chữ chéo không chiếm cả hình chữ nhật lớn)
      const xs = [], ys = [];
      for (const u of [-1 + 2 * i / nb, -1 + 2 * (i + 1) / nb]) for (const v of [-1, 1]) {
        xs.push(bs.P[0] + bs.a[0] * u * hw - bs.b[0] * v * hh); ys.push(bs.P[1] + bs.a[1] * u * hw - bs.b[1] * v * hh);
      }
      boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys) + dpx]);
    }
    return { T, Hm, st, sp, bs, bl, dpx, boxes, inv, pxNow: Hm * bl, fix: { Hm, st, flip } };
  }
  function draw3D(ctx, L, color, alpha, rise) {
    if (alpha <= 0) return;
    const { T, Hm, st, sp, bs, bl, dpx } = L, at = dy => ctx.setTransform(bs.a[0] * st, bs.a[1] * st, -bs.b[0], -bs.b[1], bs.P[0], bs.P[1] + dy);
    const depth = dpx * clamp01(rise), steps = Math.max(2, Math.round(depth / (1.2 * k)));
    ctx.save();
    ctx.globalAlpha = clamp01(alpha);
    ctx.font = `900 ${Hm}px Montserrat, ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    at(depth + 3 * k); ctx.fillStyle = 'rgba(0,0,0,0.5)'; spDo(ctx, T, sp, 'fillText');      // bóng dưới khối
    ctx.fillStyle = shade(color, 0.38);                                                     // thân khối
    for (let i = steps; i >= 1; i--) { at(i / steps * depth); spDo(ctx, T, sp, 'fillText'); }
    at(0);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = Hm * bl * 0.55; ctx.fillStyle = color; spDo(ctx, T, sp, 'fillText'); ctx.restore();
    const gr = ctx.createLinearGradient(0, -Hm * 0.5, 0, Hm * 0.5); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(1, color);
    ctx.fillStyle = gr; spDo(ctx, T, sp, 'fillText');
    ctx.lineWidth = Math.max(0.8 / bl, Hm * 0.035); ctx.strokeStyle = 'rgba(40,20,0,0.7)'; spDo(ctx, T, sp, 'strokeText');
    ctx.restore();
  }
  // chữ phải nằm trọn trong vùng an toàn (không lòi ra mép, không xuống dải dưới)
  const inView = boxes => boxes.every(b => b[0] >= SAFE.x * width && b[2] <= width - SAFE.x * width && b[1] >= SAFE.top * height && b[3] <= height * (1 - SAFE.bottom));
  const overlaps = (boxes, placed) => boxes.some(a => placed.some(b => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]));
  // đường để in tên: đoạn tuyến gần nhà nhất của trục; tên vùng: đường thẳng qua tâm vùng theo chiều dài của vùng
  // mỗi trục: mọi đoạn (way) đều là chỗ có thể in tên, đoạn gần nhà thử trước (đoạn gần bị chữ khác chiếm thì sang đoạn khác)
  // bỏ nhánh rẽ / cầu dẫn lệch hướng chính của trục (hướng của đoạn dài nhất) quá 35° → tên không nằm vuông góc tuyến
  const roadText = (story.roads || []).map(r => {
    const ps = r.ways.map(w => pathOf(w)).filter(p => p.len > 0);
    const out = ps.map(p => {
      let best = null;
      p.pts.forEach((pt, i) => { const d = kmBetween(H, pt); if (!best || d < best.d) best = { d, path: p, mid: p.cum[i] }; });
      return best;
    }).filter(Boolean).sort((a, b) => a.d - b.d);
    // hướng chính = hướng tuyến ngay chỗ gần nhà nhất (đoạn khách thấy nhà nằm cạnh)
    if (out[0]) { const mb = dirAt(out[0].path, out[0].mid, 250); out.forEach(o => { o.mb = mb; }); }
    return out;
  });
  // đường trước nhà (tên in dẹt lúc lượn 360° quanh căn): đoạn ~160 m quanh nhà, chữ đặt ở điểm gần nhà nhất
  const frontText = story.frontStreet ? (() => { const p = pathOf(story.frontStreet.pts); if (p.len < 30) return [];
    let best = 0, bd = 1e9; p.pts.forEach((pt, i) => { const d = kmBetween(H, pt); if (d < bd) { bd = d; best = p.cum[i]; } }); return [{ path: p, mid: best }]; })() : [];
  const zoneText = zones.map(z => {
    const pts = z.rings.flat();
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), cy = (y0 + y1) / 2;
    const wM = kmBetween([x0, cy], [x1, cy]) * 1000, hM = kmBetween([x0, y0], [x0, y1]) * 1000;
    // vòng 9 (Giang: tên "KCN Cầu Tràm" to quá, tràn ra ngoài vùng): chữ nằm TRONG vùng — đường chữ = bề ngang / dọc của vùng, chữ dài
    // tối đa 80% bề đó (path.maxM, layout3D tự thu nhỏ); vùng nhỏ quá trên màn hình (chữ < 10 px) thì không in tên (không tràn ra ngoài)
    const cx = (x0 + x1) / 2;
    const hz = pathOf([[x0, cy], [x1, cy]]), vt = pathOf([[cx, y0], [cx, y1]]);
    hz.maxM = wM * 0.8; vt.maxM = hM * 0.8;
    return (wM >= hM ? [hz, vt] : [vt, hz]).map(path => ({ path, mid: path.len / 2 }));   // nằm ngang hoặc dọc theo vùng
  });
  const buildText = (story.build || []).map(b => {
    let best = null;
    for (const w of b.ways) { const p = pathOf(w); p.pts.forEach((pt, i) => { const d = kmBetween(H, pt); if (!best || d < best.d) best = { d, path: p, mid: p.cum[i] }; }); }
    return best;
  });
  // hai tuyến cùng hành lang (vd. mở rộng QL1 + cầu trên QL1): tên sau dời 1,8 km dọc tuyến cho khỏi chồng chữ
  buildText.forEach((bt, j) => {
    if (!bt || !buildText.slice(0, j).some(o => o && kmBetween(atM(o.path, o.mid), atM(bt.path, bt.mid)) < 1.5)) return;
    bt.mid = bt.mid + 1800 <= bt.path.len ? bt.mid + 1800 : Math.max(0, bt.mid - 1800);
  });
  // Chữ in dẹt: trắng / vàng luân phiên; cảnh của nó thì rõ, qua cảnh khác mờ xuống (không tắt); chữ không đè nhau:
  // chữ của cảnh đang nói đặt trước, chữ mờ đè lên chữ khác / ghim nhà / nhãn đang hiện / dải phụ đề thì ẩn dần.
  const WHITE = '#FFFFFF', YEL = '#FFD54A', DIM = 0.4;
  // tên dài ("Cao tốc TP.HCM – Trung Lương") co cỡ cho chữ dài tối đa ~75% bề ngang khung, không thì không còn chỗ đặt
  const fitPx = (txt, base) => Math.min(base * k, width * 0.75 / Math.max(1, String(txt).length * 0.72));
  const fadeTo = (t, t1) => DIM + (1 - DIM) * clamp01(1 - (t - t1) / 0.6);   // sau cảnh của nó: 1 → DIM trong 0,6 s
  const gVis = {};   // độ hiện do va chạm (mượt theo thời gian khi xuất tuần tự)
  // điểm tuyến cao tốc gần nhà nhất (nhãn ghim đặt ở đây, không ở giữa tuyến dài vài chục km)
  const roadNear = inf.road ? inf.road.ways.flat().reduce((b, p) => (!b || kmBetween(H, p) < kmBetween(H, b) ? p : b), null) : null;
  // tâm + khoảng cách tới nhà của từng vùng quan trọng (nhãn ghim vùng mốc)
  const zoneInfo = Object.fromEntries(zones.map(z => {
    const pts = z.rings.flat(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return [z.id, { c: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], km: Math.min(...pts.map(p => kmBetween(H, p))) }];
  }));
  // Tên tỉnh / xã lúc mở đầu: chữ phẳng Montserrat 900 to (tỉnh xanh nhạt, xã vàng), viền tối, ở giữa vùng, trong dải an toàn
  const areaMid = r => { const pts = r.flat(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
  const AC = { prov: PROV_PTS.length ? areaMid([PROV_PTS]) : null, ward: AR.ward && areaMid(homeRings(AR.ward.rings)) };
  function areaName(ctx, t) {
    if (!tl.area) return;
    const T = t - AO;
    const show = (name, at, a, size, col) => {
      if (!name || !at || a <= 0) return;
      let [x, y] = proj(at), px = size * k;
      ctx.save(); ctx.globalAlpha = clamp01(a);
      const txt = name.toUpperCase(), maxW = width * (1 - SAFE.x * 2) - 16 * k;
      ctx.font = `900 ${px}px Montserrat, ${FONT}`;
      let tw = ctx.measureText(txt).width;
      if (tw > maxW) { px *= maxW / tw; ctx.font = `900 ${px}px Montserrat, ${FONT}`; tw = maxW; }
      x = Math.max(SAFE.x * width + tw / 2 + 8 * k, Math.min(width - SAFE.x * width - tw / 2 - 8 * k, x));
      y = Math.max(SAFE.top * height + px, Math.min(height * CAP_Y - 70 * k, y));
      const sc = 0.94 + 0.06 * easeOut(clamp01(a));   // không nảy quá cỡ
      ctx.translate(x, y); ctx.scale(sc, sc);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = px * 0.17; ctx.strokeStyle = 'rgba(0,0,0,.82)'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = px * 0.4; ctx.strokeText(txt, 0, 0);
      ctx.shadowColor = 'transparent'; ctx.fillStyle = col; ctx.fillText(txt, 0, 0);
      ctx.restore();
    };
    show(AR.province?.name, AC.prov, Math.min(clamp01((T - A_PROV - 0.3) / 0.5), clamp01((A_WARD + 0.5 - T) / 0.4)), 30, '#9BE7FF');
    show(AR.ward?.name, AC.ward, Math.min(clamp01((T - A_WARD - 0.3) / 0.5), clamp01((A_DOWN + 1.4 - T) / 0.5)), 30, '#FFD54A');
  }
  function groundLabels(ctx, t, s, reserve = []) {
    if (s.kind === 'photos') return;
    const items = [];
    // máy đang cận / lùi nhanh (> 0,35 mức zoom mỗi giây): chữ mới chưa đặt (đặt xong sẽ phải mờ đi đổi cỡ ngay)
    const zMoving = Math.abs(camAt(t).z - camAt(Math.max(0, t - 0.2)).z) / 0.2 > 0.35;
    // vòng 7 (Giang: lùi xa tên to ra, lại gần vừa mắt): cỡ chữ theo MÀN HÌNH, tính lại mỗi khung từ độ cao máy (mượt vì máy bay mượt);
    // chỗ đặt, chiều đọc, độ kéo dãn vẫn giữ nguyên (lock) nên chữ không nhảy chỗ
    const zb = 1 + 0.45 * clamp01((16.6 - camAt(t).z) / 3.6);
    const rs = roadsScene;
    // 15/11 vòng 7 (Giang): lúc máy lượn 360° quanh căn, trục đường lớn (và đường trước nhà) thấy trong khung đều in tên dẹt trên mặt đường
    if (s.kind === 'house' || s.kind === 'lot') {
      const ha = Math.min(clamp01((t - s.t0 - 0.4 * (s.t1 - s.t0) - 0.6) / 0.6), clamp01((s.t1 - t) / 0.4));
      // vòng 8 (Giang): MỘT kiểu chữ duy nhất — chữ 3D dẹt khối (như tên trục đường kiểu cũ), cỡ vừa để không dài quá khung khi máy lượn
      roadText.forEach((rts, j) => { if (rts.length) items.push({ key: 'hrd' + j, rts, text: story.roads[j].name, px: fitPx(story.roads[j].name, 19), stMax: 1.2, color: story.roads[j].color, a: ha, pri: 1 }); });
      if (frontText.length) items.push({ key: 'hfs', rts: frontText, text: story.frontStreet.name, px: fitPx(story.frontStreet.name, 18), stMax: 1.2, color: WHITE, a: ha, pri: 1 });
    }
    if (rs && t >= rs.t0) roadText.forEach((rts, j) => {
      if (!rts.length) return;
      const cur = t < rs.t1, rc = roadCur(t);
      // trong cảnh trục đường: trục đang nói hiện dần, trục đã nói 0,6, trục chưa tới chưa hiện; lùi toàn cảnh: đủ tên
      const a = cur ? (rc < 0 ? 1 : j === rc ? roadOn(j, t) : j < rc ? 0.6 : 0) : s.kind === 'orbit' ? 0.85 : s.kind === 'radar' ? 0.35 : fadeTo(t, rs.t1);
      items.push({ key: 'rd' + j, rts, text: story.roads[j].name, px: fitPx(story.roads[j].name, 26), color: story.roads[j].color, rise: cur && j === rc ? easeOut(roadOn(j, t)) : 1, a, pri: cur && (j === rc || rc < 0) ? 2 : s.kind === 'orbit' ? 1 : 0 });
    });
    const on = zoneKey.split('|');
    zones.forEach((z, j) => {
      if (!on.includes(z.id)) return;
      // vòng 8: từ radar trở đi tên vùng in 3D dẹt trên vùng, dâng lên cùng lúc ranh nổi, giữ tới hết video
      if (radSc && t >= radSc.t0) {
        const u = clamp01((t - radSc.t0 - 1.0) / 0.7);
        items.push({ key: z.id, rts: zoneText[j], text: z.name, px: fitPx(z.name, 40), color: j % 2 ? YEL : WHITE, a: u, rise: easeOut(u), pri: s.kind === 'radar' ? 2 : 1 });
        return;
      }
      const sc = (showNow(z, s) ? s : null) || (z.poiId && poiScene(z.poiId)) || (z.cat === 'airport' && s.kind === 'airport' ? s : null);
      const cur = sc && t < sc.t1;
      if (cur) return;   // đang nói tới vùng: nhãn ghim (tiện ích / vùng mốc) đã ghi tên to → không in lặp tên trên mặt đất
      items.push({ key: z.id, rts: zoneText[j], text: z.name, px: fitPx(z.name, 48), color: (story.roads.length + j) % 2 ? YEL : WHITE, a: cur ? 1 : sc ? fadeTo(t, sc.t1) : DIM, pri: cur ? 2 : 0 });
    });
    // 16/11 vòng 14 (Giang): tuyến hạ tầng đang thi công KHÔNG in tên chữ 3D dẹt trên mặt đất nữa — chỉ nhãn dán bám điểm (thẻ ghim ở cảnh build)
    // vùng giữ chỗ: ghim nhà, nhãn tiện ích đang nói, dải phụ đề
    const [hx, hy] = proj(H), cy = CAP_Y * height;
    const placed = [[hx - 17 * k, hy - 58 * k, hx + 17 * k, hy - 4 * k], [0, cy - 30 * k, width, cy + 30 * k]];
    placed.push(...reserve);   // ô các nhãn ghim đang hiện (đặt trước) → chữ trên mặt đất né đi hoặc mờ đi
    items.sort((a, b) => b.pri - a.pri);
    const base = placed.slice();
    // đặt lần lượt; chữ nào hết chỗ thì đưa lên đặt trước và xếp lại một lần (lấy cách xếp ít chữ bị ẩn hơn)
    const place = order => {
      const pl = base.slice(), res = [];
      for (const it of order) {
        if (it.a <= 0) continue;
        const g = gVis[it.key], lf = layout3D;
        // đã có chỗ: GIỮ NGUYÊN chỗ đó trên mặt đất (không nhảy theo từng khung); cỡ chữ vẫn theo màn hình cho dễ đọc.
        // bị che / ra khỏi khung thì chỉ mờ đi
        // vòng 6: chữ giữ cỡ theo mét (lock.fix) → máy cận / lùi xa quá (cỡ trên màn hình < 0,5 hay > 2 lần cỡ chuẩn) hoặc xoay làm
        // chữ lộn ngược thì chữ MỜ ĐI, mờ hẳn mới đặt lại ở cỡ mới (không nhảy cỡ ngay trước mắt)
        if (g?.lock && !(g.hidT != null && t - g.hidT > 2.0) && !(g.bad && g.v === 0)) {   // bị che quá 2 s (15/11: trước 1,2 s → đổi chỗ / đổi cỡ liên tục) → tìm chỗ khác (mờ đi rồi hiện lại, không nhảy)
          const { pi, m, sz, fix } = g.lock, rt = it.rts[pi], L2 = rt && lf(ctx, rt.path, m, it.text, it.px * sz * zb, { st: fix.st, flip: fix.flip }, it.stMax);
          if (!L2) continue;
          const ratio = L2.pxNow / Math.max(1, it.px * sz * zb), bad = !!fix && (L2.inv || (rt.path.maxM ? L2.pxNow < 9 * k : ratio < 0.5) || ratio > 2.0);
          const bx = L2.boxes, hit = bad || !(inView(bx) && !overlaps(bx, pl));
          if (!hit) pl.push(...bx);
          res.push({ it, lay: L2, off: g.off, hit, lock: g.lock, bad });
          continue;
        }
        // chữ đang ẩn vì hết chỗ: 0,25 s mới dò lại một lần (dò mọi chỗ mỗi khung làm xuất video chậm gấp đôi)
        if (g && g.v === 0 && g.tried != null && t >= g.tried && t - g.tried < 0.25) continue;
        // máy đang cận / lùi nhanh (đang bay): chưa đặt chữ (đặt rồi sẽ phải đổi cỡ ngay) — chờ máy chậm lại
        if (zMoving && !(g?.v > 0)) continue;
        // đè chữ / lòi mép → thử dời dọc tuyến, sang đoạn khác của tuyến, rồi thu nhỏ (giữ chỗ đã chọn ở khung trước cho khỏi nhảy)
        const cands = [];
        // vòng 7: chỗ trên tuyến ĐANG NẰM TRONG KHUNG (lấy mẫu dọc tuyến ~ mỗi 1/60 chiều dài, gần giữa khung thử trước) — máy lượn quanh
        // nhà / lùi xa thì điểm gần nhà nhất của trục hay ở ngoài khung, dời theo bước cố định dễ nhảy qua đoạn đang thấy
        const vis = [];
        it.rts.forEach((rt, pi) => { const n = Math.min(80, Math.max(12, Math.round(rt.path.len / 60)));
          for (let q = 1; q < n; q++) { const m = rt.path.len * q / n, [x, y] = proj(atM(rt.path, m));
            if (x > width * 0.1 && x < width * 0.9 && y > height * 0.15 && y < height * 0.74) vis.push({ pi, m, d: Math.hypot(x - width / 2, y - height * 0.45) }); } });
        vis.sort((a, b) => a.d - b.d);
        for (const sz of [1, 0.82, 0.66, 0.52]) vis.slice(0, 10).forEach(v => cands.push(v.pi + '|@' + v.m.toFixed(1) + '|' + sz));
        for (const sz of [1, 0.82, 0.66, 0.52]) it.rts.forEach((_, pi) => { for (const o of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 4, -4, 5, -5, 6, -6]) cands.push(pi + '|' + o + '|' + sz); });
        const steps = {};
        let lay = null, off = '0|0|1', hit = true, lock = null;
        const why = { nul: 0, dir: 0, out: 0, ov: 0 };
        for (const c of [...new Set([g?.off ?? '0|0|1', ...cands])]) {
          const cp = c.split('|'), at = cp[1][0] === '@' ? +cp[1].slice(1) : null, pi = +cp[0], o = at != null ? 0 : +cp[1], sz = +cp[2], rt = it.rts[pi];
          if (!rt) continue;
          const { path, mid } = rt;
          if (o && !steps[pi]) { const L0 = lf(ctx, path, mid, it.text, it.px * zb, undefined, it.stMax); steps[pi] = L0 ? L0.Hm * Math.max(5, 0.4 * it.text.length) : -1; }
          if (o && steps[pi] < 0) continue;
          const m = at != null ? at : o ? Math.max(0, Math.min(path.len, mid + o * steps[pi])) : mid;
          if (rt.mb != null) { const dd = Math.abs(((dirAt(path, m, 60) - rt.mb) % 180 + 180) % 180); if (Math.min(dd, 180 - dd) > 35) { why.dir++; continue; } }   // chỗ lệch hướng trục (nhánh rẽ, khúc cua)
          const L2 = lf(ctx, path, m, it.text, it.px * sz * zb, undefined, it.stMax);
          if (!L2) { why.nul++; continue; }
          if (!lay) { lay = L2; off = c; }
          if (L2.pxNow < (path.maxM ? 10 * k : 0.55 * it.px * sz * zb)) { why.nul++; continue; }   // đoạn tuyến quá ngắn → chữ bị ép bé tí: thử đoạn khác
          const bx = L2.boxes;
          if (inView(bx) && !overlaps(bx, pl)) { lay = L2; off = c; hit = false; lock = { pi, m, sz, fix: L2.fix }; break; }
          if (!inView(bx)) why.out++; else why.ov++;
        }
        if (dbg && hit) (dbg.why ||= []).push({ key: it.key, ...why });
        if (!lay) continue;
        if (!hit) pl.push(...(lay.boxes));
        res.push({ it, lay, off, hit, lock, bad: false });
      }
      return res;
    };
    let res = place(items);
    const bad = res.filter(r => r.hit && r.it.pri === 2).map(r => r.it);
    if (bad.length) {
      const alt = place([...bad, ...items.filter(it => !bad.includes(it))]);
      if (alt.filter(r => !r.hit).length > res.filter(r => !r.hit).length) res = alt;
    }
    for (const { it, lay, off, hit, lock, bad } of res) {
      // không chỗ nào trống (đã thử dời + thu nhỏ + xếp lại): ẩn dần — luật chữ không đè nhau, không lòi ra mép
      const g = gVis[it.key], target = hit ? 0 : 1;
      const v = !g || Math.abs(t - g.t) > 0.5 ? target : g.v + Math.sign(target - g.v) * Math.min(Math.abs(target - g.v), Math.abs(t - g.t) / 0.3);
      gVis[it.key] = { v, t, off, tried: hit ? t : null, lock: hit && !lock ? g?.lock : lock, hidT: hit ? (g?.hidT ?? t) : null, bad };
      draw3D(ctx, lay, it.color, it.a * v, it.rise ?? 1);
      if (dbg) dbg.ground.push({ key: it.key, a: it.a * v, px: lay.pxNow, boxes: lay.boxes });
    }
  }

  // Vẽ khung ở thời điểm t vào ctx (bản đồ phải đã ở đúng máy quay của t: setFrame/prepare)
  let dbg = null;
  function draw(ctx, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(map.getCanvas(), 0, 0, width, height);
    const s = sceneAt(t), pr = routeProg(t);
    // Nhãn ghim của khung này — CHỈ điểm đang nói (điểm cũ còn chấm ghim, không còn thẻ biểu tượng chồng lên nhau);
    // đặt chỗ TRƯỚC để chữ in trên mặt đất né ô nhãn
    const items = [], sub = p => fmtSub(p, bird);
    // vòng 6 (như app cũ): thẻ hiện khi line tới nơi, mờ đi 0,3 s trước khi hết cảnh — cảnh sau chưa có thẻ cho tới khi line của nó tới
    if (s.kind === 'poi') { const p = story.pois[s.i], c = lineWin(s).card; if (t >= c) items.push({ key: 'p' + s.i, at: p.at, cat: p.cat, name: p.name, sub: sub(p), a: cardA(t, s, c) }); }
    if (s.kind === 'cluster') {
      const j = clusterCur(s, t), i = s.idx[j], p = story.pois[i], t1 = s.beats[j] + CL_LBL;
      if (t >= t1) items.push({ key: 'p' + i, at: p.at, cat: p.cat, name: p.name, sub: sub(p), a: (t - t1) / 0.45 });
    }
    // lượn 360°: vòng 6 (Giang: thẻ đè nhau, lỗi to nhỏ) — MỌI nhãn cùng MỘT cỡ (tên 1 dòng + phút · km), không còn đổi thẻ to → gọn;
    // nhãn đang nói đặt trước, nhãn đã nhắc (mới nhắc trước) chật thì mờ dần nhường chỗ, có chỗ lại hiện dần (không nháy, không nhảy cỡ)
    if (s.kind === 'orbit') {
      const j = clusterCur(s, t);
      for (let jj = j; jj >= 0; jj--) {
        if (t < s.beats[jj]) continue;
        const i = s.idx[jj], p = story.pois[i];
        items.push({ key: 'o' + i, orb: true, optional: jj !== j, at: p.at, cat: p.cat, name: p.name, sub: sub(p), a: Math.min((t - s.beats[jj]) / 0.4, (s.t1 - t) / 0.3) });
      }
    }
    // vòng 8: radar — mọi tiện ích đã quét có nhãn gọn; nhãn mới nhất đặt trước (luôn hiện), nhãn cũ chật thì mờ, chấm vẫn còn
    if (s.kind === 'radar') {
      const P = story.radar.pts;
      let cur = -1; s.hits.forEach((h, i) => { if (t >= h) cur = i; });
      // thứ tự đặt chỗ: nhãn mới nhất → tiện ích được đọc tên → các nhãn khác (mới trước cũ sau)
      const ord = []; for (let i = cur; i >= 0; i--) ord.push(i);
      ord.sort((a, b) => (b === cur) - (a === cur) || P[b].named - P[a].named || b - a);
      for (const i of ord) items.push({ key: 'q' + i, rad: true, optional: i !== cur, at: P[i].at, cat: P[i].cat, name: P[i].label, a: Math.min((t - s.hits[i]) / 0.35, (s.t1 - t) / 0.35) });
    }
    // trục đường lớn: thẻ nhỏ "N phút · X km" ở chỗ đường đi từ nhà chạm vào trục (đúng lúc đường đi tới nơi)
    // vòng 7: CHỈ thẻ của trục đang nói (trục trước rút đi), lúc lùi toàn cảnh không còn thẻ — chỉ tên in trên trục
    if (s.kind === 'roads') { const j = roadCur(t), r = story.roads[j];
      if (r && rcPaths[j] && r.km >= 0.12) {
        const t1 = s.beats[j] + 1.8, tEnd = j + 1 < story.roads.length ? s.beats[j + 1] : s.ovT;
        if (t >= t1) items.push({ key: 'rc' + j, compact: true, full: true, at: r.near, cat: 'road', name: `${r.min} phút · ${fmtKm(r.dkm)}`, a: Math.min((t - t1) / 0.4, (tEnd - t) / 0.3) });
      } }
    if (s.kind === 'anchor') { const a = story.anchors[s.i], c = lineWin(s).card; if (t >= c) items.push({ key: 'a' + s.i, at: a.at, cat: a.type, name: a.name, sub: sub(a), a: cardA(t, s, c) }); }
    // cảnh tổng kết nối vùng: mỗi điểm mốc một nhãn gọn (tên + phút · km), bật lần lượt khi máy đã lùi ra
    if (s.kind === 'region') story.anchors.forEach((a, i) => { const c = s.t0 + 1.5 + 0.35 * i; if (t >= c) items.push({ key: 'g' + i, orb: true, at: a.at, cat: a.type, name: a.name, sub: sub(a), a: Math.min((t - c) / 0.4, (s.t1 - t) / 0.3) }); });
    // sân bay: thẻ hiện khi đường đi từ nhà chạy tới nơi (phút · km theo đường thật), giữ suốt lúc máy bay cất cánh
    if (s.kind === 'airport' && t >= s.t0 + 2.6) { const rw = inf.airport; items.push({ key: 'air', full: true, at: apMid, cat: 'airport', name: rw.name, sub: fmtSub(rw, false), a: (t - s.t0 - 2.6) / 0.45 }); }
    if (s.kind === 'metro') items.push({ key: 'metro', full: true, at: inf.metro.stations[Math.min(2, inf.metro.stations.length - 1)][1], cat: 'metro', name: inf.metro.name, sub: inf.metro.sub, a: (t - s.t0 - 1.6) / 0.45 });
    if (s.kind === 'road') { const c = lineWin(s).card; if (t >= c) items.push({ key: 'road', full: true, at: roadNear, cat: 'road', name: inf.road.name, sub: `cách nhà ${fmtKm(inf.road.km)}`, a: cardA(t, s, c) }); }
    // hạ tầng đang thi công: mỗi tuyến 1 nhãn dán (chú thích ghim bám đúng điểm trên tuyến gần nhà nhất, máy lia thì nhãn chạy theo),
    // tuyến sau hiện trễ 1,2 s; không có chữ in trên mặt đất (vòng 14)
    if (s.kind === 'build') buildText.forEach((bt, j) => {
      const b = story.build[j];
      if (!bt || !b) return;
      items.push({ key: 'build' + j, full: true, at: atM(bt.path, bt.mid), cat: 'road', name: b.name, sub: b.station ? `🚧 Đang thi công · ${b.station} cách ${fmtKm(b.km)}` : `🚧 Đang thi công · cách nhà ${fmtKm(b.km)}`, a: Math.min((t - s.t0 - 2.0 - 1.2 * j) / 0.45, (s.t1 - t) / 0.3) });
    });
    // vùng mốc (KCN, cảng…) không gắn tiện ích / điểm mốc: nhãn ghim tên to ở giữa vùng trong cảnh của nó
    if (s.kind !== 'airport' && !(radSc && t >= radSc.t0)) for (const z of zones) {
      if (z.poiId || !showNow(z, s) || z.show.some(x => x.startsWith('anchor:')) || !zoneKey.split('|').includes(z.id)) continue;
      items.push({ key: z.id, at: zoneInfo[z.id].c, cat: CAT3D[z.cat] ? z.cat : 'kcn', name: z.name, sub: `cách nhà ${fmtKm(zoneInfo[z.id].km)}`, a: (t - s.t0 - 1.0) / 0.45 });
    }
    // chỗ đã có: ghim nhà, thẻ trên cùng (thông tin căn / 3 con số), nút kêu gọi cuối
    const [hx, hy] = proj(H);
    const reserved = [[hx - 22 * k, hy - 64 * k, hx + 22 * k, hy + 6 * k]];
    if (s.kind === 'house' || s.kind === 'lot') reserved.push([0, PANEL_Y(), width, PANEL_Y() + 90 * k]);
    if (s.kind === 'score' || s.kind === 'cta') reserved.push([0, PANEL_Y(), width, PANEL_Y() + 116 * k]);
    if (s.kind === 'radar' || ((s.kind === 'anchor' || s.kind === 'region') && !overlay)) reserved.push([0, PANEL_Y(), width, PANEL_Y() + 56 * k]);
    if (s.kind === 'cta') reserved.push([0, height * CAP_Y - 100 * k, width, height]);
    const labs = placeLabels(ctx, items, reserved, t);
    // bộ thử (tools / Playwright): nhãn + chữ mặt đất của khung vừa vẽ, để đo đè nhau / đổi cỡ
    dbg = { t, labs: labs.map(l => ({ key: l.key, box: l.box, a: clamp01(l.a), w: l.w, h: l.h })), ground: [] };
    // chữ in mặt đất né cả thẻ trên cùng (thông tin căn / 3 con số / thẻ đếm radar) + nút kêu gọi — trước chỉ né nhãn ghim
    groundLabels(ctx, t, s, [...labs.map(l => l.box), ...reserved.slice(1)]);
    (story.pois || []).forEach((p, i) => head(ctx, poiPaths[i], pr['r' + i] ?? 0, GOLD));
    (story.anchors || []).forEach((a, i) => head(ctx, ancPaths[i], pr['a' + i] ?? 0, GOLD));
    if (apPath) head(ctx, apPath, pr.ap ?? 0, GOLD);
    rcPaths.forEach((p, j) => { if (p) head(ctx, p, pr['rc' + j] ?? 0, GOLD); });
    // ghim nhỏ viền vàng ở các tiện ích đã tới (line tới nơi)
    (story.pois || []).forEach((p, i) => { if ((pr['r' + i] ?? 0) >= 1 || orbShown(i, t)) poiPin(ctx, p.at, p.cat); });
    (story.anchors || []).forEach((a, i) => { if ((pr['a' + i] ?? 0) >= 1 && (s.kind === 'anchor' || s.kind === 'region' || s.kind === 'cta')) poiPin(ctx, a.at, a.type); });
    if (story.lot && (s.kind === 'intro' || s.kind === 'lot')) lotOverlay(ctx, s.kind === 'lot' ? 1 : clamp01((t - PIN_T - 0.2) / 0.6), s.kind === 'lot');
    if (!(story.lot && s.kind === 'lot')) pin(ctx, t);
    ring(ctx, s.kind === 'score' && !story.radar ? clamp01((t - s.t0) / 1.2) : s.kind === 'cta' && story.score ? 1 - clamp01((t - s.t0) / 0.8) : 0);
    if (s.kind === 'radar') radarFx(ctx, t, s);
    if (s.kind === 'score' && story.radar) radarFx(ctx, t, s, false);
    if (s.kind === 'airport') plane(ctx, t, s);
    if (s.kind === 'metro') { metroStations(ctx); train(ctx, t, s); }
    for (const l of labs) drawLabel(ctx, l);
    if (s.kind === 'intro') areaName(ctx, t);
    // vòng 9: chữ / thẻ / ghim / phụ đề kiểu app cũ do dd-old.js vẽ (render.js drawOpening)
    if (overlay) { const o = overlay(ctx, t, { proj, kind: s.kind, scene: s, pinT: PIN_T }); caption(ctx, s, t, o?.capBase ?? Infinity); o?.after?.(); return; }
    // thẻ + phụ đề
    if (s.kind === 'house') infoCard(ctx, Math.min((t - s.t0) / 0.45, (s.t1 - t) / 0.35), story.info.price, story.info.chips);
    if (s.kind === 'lot') infoCard(ctx, Math.min((t - s.t0 - 0.5) / 0.45, (s.t1 - t) / 0.35), story.lot.label, story.lot.chips || []);
    if (s.kind === 'anchor' || s.kind === 'region') regionChip(ctx, t, s);
    if (s.kind === 'score') statsCard(ctx, Math.min((t - s.t0 - 1.0) / 0.4, (s.t1 - t) / 0.35), t - s.t0 - 1.0);
    if (s.kind === 'cta') { if (story.statsInCta) statsCard(ctx, (t - s.t0 - 0.3) / 0.4, t - s.t0 - 0.3); cta(ctx, (t - s.t0) / 0.4); }
    if (s.kind === 'photos') photos(ctx, t, s);
    ctaBar(ctx, t, s);
    cover(ctx, t);
    caption(ctx, s, t);
    watermark(ctx, t);
    ctx.font = font(500, 8); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.textAlign = 'right';
    ctx.fillText('Ảnh vệ tinh: Esri, Maxar · Bản đồ: © OpenStreetMap, OpenFreeMap', width - 10 * k, height - 6 * k);
    ctx.textAlign = 'left';
  }

  // Xem trước: vẽ lớp 2D ngay sau khi bản đồ vẽ xong khung (khớp từng khung, không lệch 1 nhịp)
  let liveCtx = null;
  map.on('render', () => { if (liveCtx) draw(liveCtx, lastT); });
  const live = ctx => { liveCtx = ctx; };

  // Bộ nguồn khung cho exportMp4 (js/export.js): canvas + prepare(t) + draw(tl, t)
  function frameSource() {
    liveCtx = null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    return { canvas, prepare, draw: (_tl, t) => draw(ctx, t) };
  }
  function destroy() { liveCtx = null; try { map.remove(); } catch { /* đã gỡ */ } box.remove(); }

  return { map, tl, duration: tl.duration, voiceSegs: tl.voiceSegs, sfx: sfxEvents3D(tl), ready, setFrame, prepare, draw, live, frameSource, destroy, debug: () => dbg };
}
