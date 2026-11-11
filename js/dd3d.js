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
async function satTile(z, y, x, signal) {
  const r = await fetch(ESRI_SAT(z, y, x), { signal });
  if (!r.ok) throw new Error('tile ' + r.status);
  const blob = await r.blob();
  if (z <= 12) return blob;
  const bm = await createImageBitmap(blob);
  const ph = isPlaceholder(bm); bm.close?.();
  if (!ph) return blob;
  const pb = await createImageBitmap(await satTile(z - 1, y >> 1, x >> 1, signal));
  const c = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  c.getContext('2d').drawImage(pb, (x & 1) * pb.width / 2, (y & 1) * pb.height / 2, pb.width / 2, pb.height / 2, 0, 0, 256, 256);
  pb.close?.();
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

export const fmtKm = km => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;
// Có đường đi thật thì dùng phút thật; không có thì ước tính 22 km/h như app (dấu ~); chim bay thì chỉ ghi khoảng cách
export const fmtSub = (p, bird) => bird || p.bird ? `${fmtKm(p.km)} · đường chim bay`
  : `${fmtKm(p.km)} · ${p.min != null ? Math.max(1, Math.round(p.min)) : '~' + Math.max(1, Math.round(p.km / 22 * 60))} phút`;

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
// Ảnh bìa đứng đầu video COVER_T giây; cú bay xuống + giọng mở đầu lùi lại SH giây
export const COVER_T = 2.8;
const shiftOf = story => story.cover ? COVER_T - 0.8 : 0;
const PHOTO_T = 3.0;   // mỗi ảnh căn nhà ~3 giây
const ROAD_STEP = 0.9; // mỗi trục đường sáng lên cách nhau
// màu line từng trục đường (neon, như app cũ) — tên đường in dẹt màu vàng
export const ROAD_COLORS = ['#5EEAF5', '#FF4FA3', '#5BF08A', '#FF8A1F', '#B48CFF'];
// màu vùng theo loại (khu công nghiệp, sân bay, cảng, bệnh viện, đại học, công viên…)
const ZONE_COL = { kcn: '#C9CED6', airport: '#7BDFF2', port: '#4CC9F0', yte: '#EF476F', truong: '#4CC9F0', congvien: '#52B788', cho: '#F77F00' };
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
  add('intro', 5.8 + shiftOf(story), v.intro);
  if (story.lot) add('lot', 6.2, v.lot); else add('house', 4.8, v.house);
  // trục đường lớn: lần lượt sáng lên, tên in dẹt dọc tuyến
  if (story.roads?.length) add('roads', 1.6 + ROAD_STEP * story.roads.length + 1.2, v.roads);
  (story.pois || []).forEach((p, i) => add('poi', 3.4, v.poi?.[i], { i }));
  (story.anchors || []).forEach((a, i) => add('anchor', 4.4, v.anchor?.[i], { i }));
  const inf = story.infra || {};
  if (inf.airport) add('airport', 7.2, v.airport);
  if (inf.metro) add('metro', 7, v.metro);
  if (inf.road) add('road', 4.6, v.road);
  if (story.build?.length) add('build', 5.2, v.build);
  if (story.score) add('score', 4.8, v.score);
  // ảnh thực tế của căn: dồn xuống cuối, ngay trước lời kêu gọi (lời đọc chỉ giới thiệu "hình ảnh thực tế", không tả bịa từng ảnh)
  if (story.photos?.length) add('photos', PHOTO_T * story.photos.length + 0.3, v.photos);
  add('cta', 3.8, v.cta);
  return { scenes, duration: t, shift: shiftOf(story), voiceSegs: scenes.filter(s => s.vo).map(s => s.vo) };
}

// SFX theo nhịp hình (tổng hợp bằng js/sfx.js): whoosh khi máy lướt, lấp lánh suốt lúc line chạy, pop + ding khi nhãn
// bật, tiếng trầm khi khối nhà dựng, động cơ phản lực khi máy bay cất cánh, ray tàu khi metro chạy, tick điểm sống
export function sfxEvents3D(tl) {
  const ev = [], add = (t, kind, gain, dur) => { if (t >= 0 && t < tl.duration) ev.push({ t, kind, gain, dur }); };
  for (const s of tl.scenes) {
    const d = s.t1 - s.t0;
    if (s.kind === 'intro') {
      const sh = tl.shift || 0;
      if (sh) { for (let j = 0; j < 5; j++) add(0.08 + j * 0.12, 'pop', 0.3); add(0.5, 'ding', 0.42); }   // ảnh bìa: từng hộp chữ bật
      add(0.6 + sh, 'riser', 0.32, 2.8); add(3 + sh, 'whoosh', 0.5, 1.8); add(5.15 + sh, 'thud', 0.5);
    }
    if (s.kind === 'photos') for (let t2 = s.t0; t2 < s.t1 - 1; t2 += PHOTO_T) add(t2, 'whoosh', 0.22, 1.0);
    if (s.kind === 'roads') { add(s.t0, 'whoosh', 0.45, 1.4); for (let j = 0; j * ROAD_STEP + 1.6 < d - 1; j++) { add(s.t0 + 1.4 + j * ROAD_STEP, 'shimmer', 0.26, 1.0); add(s.t0 + 2.2 + j * ROAD_STEP, 'pop', 0.3); } }
    if (s.kind === 'build') { add(s.t0, 'whoosh', 0.45, 1.4); add(s.t0 + 0.6, 'shimmer', 0.3, 1.8); add(s.t0 + 2.4, 'ding', 0.4); }
    if (s.kind === 'house' || s.kind === 'lot') add(s.t0 + 0.05, 'whoosh', 0.25, 1.4);
    if (s.kind === 'lot') { add(s.t0 + 0.4, 'shimmer', 0.3, 1.6); add(s.t0 + 1.1, 'ding', 0.4); }
    if (s.kind === 'poi' || s.kind === 'anchor' || s.kind === 'road') {
      const draw = s.kind === 'poi' ? 1.5 : 2.2;
      add(s.t0, 'whoosh', 0.4, 1.0);
      add(s.t0 + 0.05, 'shimmer', 0.32, draw);
      add(s.t0 + draw, 'pop', 0.42); add(s.t0 + draw + 0.05, 'ding', 0.38);
    }
    if (s.kind === 'airport') { add(s.t0, 'whoosh', 0.5, 1.6); add(s.t0 + 1.9, 'jet', 0.75, Math.min(5.5, d - 1.9)); add(s.t0 + 2.2, 'pop', 0.35); }
    if (s.kind === 'metro') { add(s.t0, 'whoosh', 0.45, 1.4); add(s.t0 + 1.2, 'rail', 0.5, d - 1.6); add(s.t0 + 1.6, 'pop', 0.35); add(s.t1 - 1.2, 'ding', 0.3); }
    if (s.kind === 'score') { add(s.t0, 'whoosh', 0.55, 1.4); for (let r = 0; r < 5; r++) add(s.t0 + 1.3 + r * 0.14, 'tick', 0.25); }
    if (s.kind === 'cta') { add(s.t0, 'whoosh', 0.5, 1.2); add(s.t0 + 0.45, 'ding', 0.45); }
  }
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

export function createDirector3D({ width, height, story }) {
  const k = width / W0;
  const tl = buildTimeline(story);
  const H = story.house, SH = tl.shift;
  const bird = !!story.bird;
  const routePts = p => (!bird && p.route && p.route.length > 1) ? p.route : [H, p.at];
  const poiPaths = (story.pois || []).map(p => pathOf(routePts(p)));
  const ancPaths = (story.anchors || []).map(a => pathOf(routePts(a)));
  const inf = story.infra || {};
  const metroPath = inf.metro ? pathOf(inf.metro.line) : null;

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
    { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 0, 'raster-brightness-max': 0.78, 'raster-saturation': 0.15, 'raster-contrast': 0.08 } },
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
  (story.pois || []).forEach((p, i) => addRoute('r' + i, poiPaths[i].pts, LINE.mid, 5.5, 18, true));
  (story.anchors || []).forEach((a, i) => addRoute('a' + i, ancPaths[i].pts, LINE.mid, 5.5, 20, true));
  if (inf.road) inf.road.ways.forEach((w, j) => addRoute('w' + j, w, CAT3D.road[1], 9, 26));
  if (metroPath) addRoute('m0', metroPath.pts, CAT3D.metro[1], 6, 18);
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
    { id: 'bld', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14,
      paint: {
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.2, ['max', ['coalesce', ['get', 'render_height'], 0], 7]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0], 0, '#e6ebf3', 20, '#b9c9e6', 60, '#7f9ed6', 150, '#5a7fd0'],
        'fill-extrusion-opacity': 0.88, 'fill-extrusion-vertical-gradient': true,
      } },
    { id: 'house', type: 'fill-extrusion', source: 'house',
      paint: { 'fill-extrusion-color': story.lot?.green ? '#7fd18b' : GOLD, 'fill-extrusion-height': 0, 'fill-extrusion-opacity': story.lot ? 0.55 : 0.92,
        'fill-extrusion-vertical-gradient': true } },
    { id: 'train', type: 'fill-extrusion', source: 'train', paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': 14, 'fill-extrusion-base': 3, 'fill-extrusion-opacity': 0.95 } },
  );
  // Vùng quan trọng (khu công nghiệp, sân bay, cảng, bệnh viện…): khoanh theo ranh thật, nổi lên một lớp mỏng + viền sáng;
  // chỉ hiện khi tới cảnh của nó (lọc theo zid, cập nhật trong setFrame)
  const zones = story.zones || [];
  sources.zones = { type: 'geojson', data: { type: 'FeatureCollection', features: zones.flatMap(z => z.rings.map(r => ({
    type: 'Feature', properties: { zid: z.id, col: ZONE_COL[z.cat] || GOLD }, geometry: { type: 'Polygon', coordinates: [r] } }))) } };
  layers.push(
    { id: 'zones-x', type: 'fill-extrusion', source: 'zones', filter: ['in', ['get', 'zid'], ['literal', []]],
      paint: { 'fill-extrusion-color': ['get', 'col'], 'fill-extrusion-height': 22, 'fill-extrusion-opacity': 0.42 } },
    { id: 'zones-g', type: 'line', source: 'zones', filter: ['in', ['get', 'zid'], ['literal', []]], paint: { 'line-color': ['get', 'col'], 'line-width': 20, 'line-blur': 9, 'line-opacity': 0.75 } },
    { id: 'zones-l', type: 'line', source: 'zones', filter: ['in', ['get', 'zid'], ['literal', []]], paint: { 'line-color': '#FFFFFF', 'line-width': 3.2, 'line-opacity': 0.95 } },
  );
  const map = new maplibregl.Map({
    container: box, center: H, zoom: 12.6, pitch: 0, bearing: 0, maxPitch: 75, pixelRatio: 1, interactive: false,
    attributionControl: false, fadeDuration: 0, preserveDrawingBuffer: true, antialias: true,
    style: {
      version: 8, sources, layers,
      sky: { 'sky-color': '#0d1d3d', 'horizon-color': '#f2b56b', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-color': '#c9d6ee', 'fog-ground-blend': 0.2 },
    },
  });
  const ready = new Promise((res, rej) => {
    map.on('error', e => { if (!map.loaded()) rej(e.error || e); });
    map.once('load', () => {
      try { map.setLight({ anchor: 'map', color: '#fff2d9', intensity: 0.45, position: [1.4, 215, 35] }); } catch { /* máy cũ */ }
      res();
    });
  });

  // ---- máy quay: chuỗi "cú máy" như easeTo của bản thử. Cú sau bắt đầu từ đúng chỗ máy đang ở (ngắt cú trước) ----------
  const fitCam = (pts, bearing, pitch, pad = { top: 0.24 * height, bottom: 0.34 * height, left: 0.08 * width, right: 0.2 * width }) => {
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    const c = map.cameraForBounds(b, { padding: pad, bearing });
    return { c: [c.center.lng, c.center.lat], z: Math.min(c.zoom, 17.6), b: bearing, p: pitch };
  };
  const mixCam = (a, b, e) => ({ c: [unX(lerp(mercX(a.c[0]), mercX(b.c[0]), e)), unY(lerp(mercY(a.c[1]), mercY(b.c[1]), e))],
    z: lerp(a.z, b.z, e), p: lerp(a.p, b.p, e), b: lerpAngle(a.b, b.b, e) });
  let moves = null;
  const INIT = { c: H, z: 12.6, p: 0, b: 0 };
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
    const dwell = (d, b = 12) => f => ({ ...f, b: f.b + b + Math.max(0, d - 5) * 1.5, z: f.z + Math.min(0.7, Math.max(0, d - 5) * 0.09) });
    for (const s of tl.scenes) {
      const d = s.t1 - s.t0;
      if (s.kind === 'intro') ease(0.6 + SH, 5, { c: H, z: story.lot ? 18.6 : 17.3, p: 62, b: -25 });
      else if (s.kind === 'house') ease(s.t0, d, { c: H, z: 17.8, p: 66, b: 70 }, LIN);
      else if (s.kind === 'lot') ease(s.t0, d, f => ({ c: H, z: 19.7, p: 56, b: f.b + 110 }), EASE);   // sát lô: cạnh 5 m vẫn đủ rộng để ghi số
      else if (s.kind === 'poi') {
        const p = story.pois[s.i];
        const fd = fly(1.7, d);
        ease(s.t0, fd, fitCam([H, p.at], bearingDemo(H, p.at) - 20, 58), QUAD);
        ease(s.t0 + fd - 0.2, d - fd + 0.2, dwell(d), LIN);
      } else if (s.kind === 'anchor') {
        const a = story.anchors[s.i], P = ancPaths[s.i].pts, step = Math.max(1, Math.floor(P.length / 30));
        const fd = fly(2.2, d);
        ease(s.t0, fd, fitCam([H, a.at, ...P.filter((_, j) => j % step === 0)], bearingDemo(H, a.at) - 20, 50), QUAD);
        ease(s.t0 + fd, d - fd, dwell(d, 10), LIN);
      } else if (s.kind === 'airport') {
        const rw = inf.airport, mid = [(rw.a[0] + rw.b[0]) / 2, (rw.a[1] + rw.b[1]) / 2], side = bearingGeo(rw.a, rw.b) - 55;
        ease(s.t0, 2.2, { c: mid, z: 14.7, p: 62, b: side });
        // máy quay bám nhẹ theo máy bay sau khi lăn bánh, lùi ra dần cho thấy máy bay lên cao
        follow(s.t0 + 2.2, d - 2.2, (t, from) => {
          const u = clamp01((t - s.t0 - 2.2) / (d - 2.2)), pl = planeAt(rw, t - s.t0 - 1.9);
          const tgt = { c: [lerp(mid[0], pl.pt[0], 0.85), lerp(mid[1], pl.pt[1], 0.85)], z: 14.7 - 1.1 * u, p: 62, b: side + 14 * u };
          return mixCam(from, tgt, EASE(clamp01((t - s.t0 - 2.2) / 2.5)));
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
        const all = inf.road.ways.flat().filter((_, j) => j % 3 === 0);
        const fd = fly(2.2, d);
        ease(s.t0, fd, fitCam([H, ...all], 15, 48));
        ease(s.t0 + fd, d - fd, dwell(d, 10), LIN);
      } else if (s.kind === 'roads') {
        // lùi lên cao thấy nhà + đoạn các trục gần nhà (trong 1,6 km), xoay chậm
        const near = story.roads.flatMap(r => r.ways.flat()).filter(p => kmBetween(H, p) <= 1.6).filter((_, j) => j % 2 === 0);
        ease(s.t0, 1.8, fitCam([H, ...near.length ? near : [H]], -10, 52));
        ease(s.t0 + 1.8, d - 1.8, f => ({ ...f, b: f.b + 12 + Math.max(0, d - 6) * 1.5 }), LIN);   // giữ cỡ cảnh để tên trục không trôi khỏi khung
      } else if (s.kind === 'build') {
        const pts = story.build.flatMap(b => b.ways.flat()).filter(p => kmBetween(H, p) <= story.build[0].km + 2.5).filter((_, j) => j % 2 === 0);
        const fd = fly(2.0, d);
        ease(s.t0, fd, fitCam([H, ...pts], 10, 50));
        ease(s.t0 + fd, d - fd, dwell(d, 10), LIN);
      } else if (s.kind === 'score') {
        const all = [H, ...(story.pois || []).map(p => p.at), ...circleKm(H, story.scoreR || 1).filter((_, i) => i % 24 === 0)];
        ease(s.t0, 2.4, fitCam(all, 0, 45));
        ease(s.t0 + 1.2, d - 1.2, f => ({ ...f, b: 25 }), LIN);
      } else if (s.kind === 'cta') ease(s.t0, 3.5, { c: H, z: 16.4, p: 60, b: 60 });
    }
  }
  const sceneIdx = t => { const i = tl.scenes.findIndex(s => t < s.t1); return i < 0 ? tl.scenes.length - 1 : i; };
  const sceneAt = t => tl.scenes[sceneIdx(t)];
  const houseH = t => (story.lot ? 2.2 : story.footprint ? story.footprint.height : story.kind === 'canho' ? 0 : 11) * easeOut(clamp01((t - 5.2 - SH) / 0.9));

  // tiến độ vẽ từng đường tại t (0..1)
  function routeProg(t) {
    const out = {};
    for (const s of tl.scenes) {
      if (t < s.t0) continue;
      if (s.kind === 'poi') out['r' + s.i] = clamp01((t - s.t0) / 1.5);
      if (s.kind === 'anchor') out['a' + s.i] = clamp01((t - s.t0) / 2.2);
      if (s.kind === 'road') inf.road.ways.forEach((_, j) => { out['w' + j] = clamp01((t - s.t0 - 0.1) / 2.2); });
      if (s.kind === 'metro') out.m0 = clamp01((t - s.t0 - 0.3) / 1.3);
      if (s.kind === 'roads') story.roads.forEach((_, j) => { out['rd' + j] = clamp01((t - s.t0 - 1.4 - j * ROAD_STEP) / 1.2); });
    }
    return out;
  }
  // thời điểm từng trục đường bắt đầu sáng (để tên đường hiện theo)
  const roadsScene = tl.scenes.find(s => s.kind === 'roads');
  const roadOn = (j, t) => roadsScene ? clamp01((t - roadsScene.t0 - 1.9 - j * ROAD_STEP) / 0.6) : 0;
  // vùng quan trọng đang hiện: vùng gắn tiện ích (từ cảnh của tiện ích đó trở đi), sân bay (cảnh sân bay)
  let zoneKey = '';
  function setZones(t) {
    const s = sceneAt(t), on = [];
    for (const z of zones) {
      if (z.poiId) { const sc = tl.scenes.find(x => x.kind === 'poi' && story.pois[x.i]?.id === z.poiId); if (sc && t >= sc.t0 + 0.6 && s.kind !== 'photos') on.push(z.id); }
      if (z.cat === 'airport' && s.kind === 'airport' && t >= s.t0 + 1.2) on.push(z.id);
    }
    const key = on.join('|');
    if (key === zoneKey) return;
    zoneKey = key;
    const f = ['in', ['get', 'zid'], ['literal', on]];
    for (const id of ['zones-x', 'zones-g', 'zones-l']) map.setFilter(id, f);
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
  const curRoute = t => { const s = sceneAt(t); return s.kind === 'poi' ? 'r' + s.i : s.kind === 'anchor' ? 'a' + s.i : null; };
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  function setRoutes(t) {
    const pr = routeProg(t), cur = curRoute(t), sk = sceneAt(t).kind;
    for (const { id, color, gold, road } of routeIds) {
      const q = pr[id] ?? 0;
      // cảnh tổng kết / kêu gọi: mọi line sáng lại vừa phải; cảnh khác: chỉ line hiện tại sáng; trục đường mờ sau cảnh của nó
      const dim = road ? (sk === 'roads' ? 1 : 0.12) : gold && q >= 1 && id !== cur && !(sk === 'score' || sk === 'cta') ? 0.32 : 1;
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
    map.jumpTo({ center: c.c, zoom: c.z, pitch: c.p, bearing: c.b });
    map.setPaintProperty('house', 'fill-extrusion-height', houseH(t));
    setRoutes(t);
    setZones(t);
    setBuild(t);
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
  // nhãn kiểu bản thử: nền tối, viền màu, ô biểu tượng màu; mới bật thì nảy (POP .45 s), cũ thì thu về biểu tượng
  function label(ctx, at, cat, name, sub, a, small, lift = 0) {
    const [ic, col] = CAT3D[cat] || ['pin', GOLD];
    let [x, y0] = proj(at);
    // giữ nhãn trong vùng an toàn: không lên dải trên, không xuống dải phụ đề/dưới, né cột nút bên phải
    y0 = Math.max(SAFE.top * height + 50 * k + lift, Math.min(height * CAP_Y - 40 * k, y0));
    if (!small) {
      ctx.font = font(700, 12); const ww = Math.max(ctx.measureText(name).width, (ctx.font = font(600, 11), ctx.measureText(sub).width)) + 47 * k;
      const right = width - (y0 > SAFE.rY * height ? SAFE.r : SAFE.x) * width;
      x = Math.max(SAFE.x * width + ww / 2, Math.min(right - ww / 2, x));
    }
    const e = clamp01(a), sc = small ? 1 : 0.2 + 0.8 * POP(e);
    const y = y0 - 6 * k - lift + (small ? 0 : (1 - clamp01(POP(e))) * 10 * k);
    ctx.save();
    ctx.globalAlpha = small ? 1 : clamp01(e / 0.4);
    ctx.translate(x, y); ctx.scale(sc, sc);
    const isz = 26 * k;
    if (small) {
      rrect(ctx, -isz / 2 - 3 * k, -isz - 6 * k, isz + 6 * k, isz + 6 * k, 10 * k);
      ctx.fillStyle = 'rgba(11,18,32,.9)'; ctx.fill(); ctx.lineWidth = 1.5 * k; ctx.strokeStyle = col; ctx.stroke();
      rrect(ctx, -isz / 2, -isz - 3 * k, isz, isz, 8 * k); ctx.fillStyle = col; ctx.fill();
      drawIcon(ctx, ic, 0, -isz / 2 - 3 * k, 17 * k, '#0b1220');
      ctx.restore(); return;
    }
    ctx.font = font(700, 12); const w1 = ctx.measureText(name).width; ctx.font = font(600, 11); const w2 = ctx.measureText(sub).width;
    const w = 5 * k + isz + 7 * k + Math.max(w1, w2) + 9 * k, h = isz + 10 * k;
    rrect(ctx, -w / 2, -h, w, h, 12 * k);
    ctx.shadowColor = 'rgba(0,0,0,.56)'; ctx.shadowBlur = 18 * k; ctx.shadowOffsetY = 6 * k;
    ctx.fillStyle = 'rgba(11,18,32,.9)'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 1.5 * k; ctx.strokeStyle = col; ctx.stroke();
    const ix = -w / 2 + 5 * k, iy = -h + 5 * k;
    rrect(ctx, ix, iy, isz, isz, 8 * k); ctx.fillStyle = col; ctx.fill();
    drawIcon(ctx, ic, ix + isz / 2, iy + isz / 2, 17 * k, '#0b1220');
    const tx = ix + isz + 7 * k;
    ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff'; ctx.font = font(700, 12); ctx.fillText(name, tx, -h / 2 - 1 * k);
    ctx.fillStyle = '#cfe0ff'; ctx.font = font(600, 11); ctx.fillText(sub, tx, -h / 2 + 13 * k);
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
  const CAP_GOLD = '#FFD54A';
  function caption(ctx, s, t) {
    const caps = s.caps || [];
    let c = null;
    for (const x of caps) if (t >= x.t0 - 0.02) c = x;
    // cụm cuối không treo mãi khi cảnh dài hơn lời (cảnh ảnh 12 ảnh × 3 s): tắt sau khi đọc xong 1,2 s
    if (!c || t > s.t1 - 0.12 || (c === caps[caps.length - 1] && t > c.t1 + 1.2)) return;
    const band = { x0: SAFE.x * width, x1: width - SAFE.r * width };
    let size = 0.075 * width;
    ctx.save();
    ctx.font = `800 ${size}px ${FONT}`;
    const sp = () => ctx.measureText(' ').width;
    let tw = c.words.reduce((s2, w) => s2 + ctx.measureText(w.w).width, 0) + sp() * (c.words.length - 1);
    const maxW = band.x1 - band.x0 - 8 * k;
    if (tw > maxW) { size *= maxW / tw; ctx.font = `800 ${size}px ${FONT}`; tw = c.words.reduce((s2, w) => s2 + ctx.measureText(w.w).width, 0) + sp() * (c.words.length - 1); }
    const base = height * CAP_Y + size * 0.35;
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
    panel(ctx, a, y0, 72 * k);
    ctx.fillStyle = GOLD; ctx.font = font(900, 22); ctx.fillText(title || '', x0, y0 + 28 * k);
    let x = x0; ctx.font = font(600, 12);
    for (const c of chips) {
      const w = ctx.measureText(c).width + 16 * k;
      if (x + w > width - SAFE.x * width - 10 * k) break;
      rrect(ctx, x, y0 + 40 * k, w, 22 * k, 8 * k); ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
      ctx.fillStyle = '#e8edf7'; ctx.fillText(c, x + 8 * k, y0 + 55.5 * k); x += w + 6 * k;
    }
    ctx.restore();
  }
  function scoreCard(ctx, a, grow) {
    if (a <= 0) return;
    const rows = story.score, h = 40 * k + rows.length * 21 * k, y0 = PANEL_Y(), x0 = SAFE.x * width + 14 * k;
    ctx.save(); panel(ctx, a, y0, h);
    ctx.fillStyle = GOLD; ctx.font = font(800, 13); ctx.fillText(`ĐIỂM SỐNG QUANH NHÀ (bán kính ${story.scoreR || 1} km)`, x0, y0 + 23 * k);
    const max = Math.max(...rows.map(r => r[1]), 1);
    rows.forEach(([n, c, plus], i) => {
      const y = y0 + 42 * k + i * 21 * k;
      ctx.fillStyle = '#e8edf7'; ctx.font = font(600, 12); ctx.fillText(n, x0, y + 4 * k);
      const bx = x0 + 86 * k, bw = width - SAFE.x * width - bx - 52 * k;
      rrect(ctx, bx, y - 4 * k, bw, 8 * k, 6 * k); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fill();
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#4cc9f0'); g.addColorStop(1, GOLD);
      rrect(ctx, bx, y - 4 * k, Math.max(1, bw * (c / max) * EASE(clamp01(grow))), 8 * k, 6 * k); ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = font(800, 12); ctx.fillText(`${c}${plus ? '+' : ''}`, bx + bw + 9 * k, y + 4 * k);
    });
    ctx.restore();
  }
  // nút kêu gọi: trên phụ đề, trong dải an toàn (né cột nút bên phải của nền tảng)
  function cta(ctx, a) {
    if (a <= 0) return;
    const x0 = SAFE.x * width, x1 = width - SAFE.r * width, h = 46 * k, y = height * CAP_Y - h - 34 * k;
    ctx.save(); ctx.globalAlpha = clamp01(a);
    ctx.translate((x0 + x1) / 2, y + h / 2); const sc = 0.85 + 0.15 * POP(clamp01(a)); ctx.scale(sc, sc);
    const g = ctx.createLinearGradient(-(x1 - x0) / 2, 0, (x1 - x0) / 2, 0); g.addColorStop(0, '#FFE9A3'); g.addColorStop(0.5, GOLD); g.addColorStop(1, '#D49A1E');
    ctx.shadowColor = 'rgba(245,196,81,.55)'; ctx.shadowBlur = 20 * k;
    rrect(ctx, -(x1 - x0) / 2, -h / 2, x1 - x0, h, 14 * k); ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#1a1205'; ctx.font = font(900, 16); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💬 ' + story.cta, 0, 1 * k);
    ctx.restore();
  }
  // Ghim vị trí căn nhà: giọt nước vàng kim (chuyển sắc), viền sáng, ô tròn tối có biểu tượng nhà vàng; rơi xuống nảy nhẹ
  // lúc khối nhà dựng (5,2 s) + 2 vòng sóng vàng nằm nghiêng trên mặt đất
  const PIN_DROP = 5.0 + SH;
  function goldPin(ctx, x, y, s, icon) {
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
    // bóng dưới chân ghim
    ctx.beginPath(); ctx.ellipse(x, y + 1 * k, 11 * k, 4 * k, 0, 0, 7); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    // rơi + nảy (trước lúc rơi: ghim đứng sẵn, nhỏ hơn — nhìn rõ vị trí trong cú bay xuống)
    const e = u <= 0 ? 1 : easeBounce(clamp01(u / 0.7));
    const lift = u <= 0 ? 0 : (1 - e) * 90 * k;
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
    ctx.font = font(800, 12); ctx.textAlign = 'center';
    for (let i = 0; i + 1 < R.length; i++) {
      const m = kmBetween(R[i], R[i + 1]) * 1000;
      if (m < 1) continue;
      // số mét đặt ra phía ngoài cạnh (theo hướng từ tâm lô ra giữa cạnh)
      const [mx, my] = proj([(R[i][0] + R[i + 1][0]) / 2, (R[i][1] + R[i + 1][1]) / 2]);
      const dl = Math.hypot(mx - cx, my - cy) || 1, x = mx + (mx - cx) / dl * 22 * k, y = my + (my - cy) / dl * 16 * k;
      const txt = `${m.toFixed(1).replace('.', ',')} m`, w = ctx.measureText(txt).width + 12 * k;
      rrect(ctx, x - w / 2, y - 11 * k, w, 20 * k, 8 * k); ctx.fillStyle = 'rgba(11,18,32,.85)'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(txt, x, y + 4 * k);
    }
    ctx.restore();
  }
  // máy bay cất cánh (nhìn từ trên, hướng/tỉ lệ theo phép chiếu tại chỗ) + bóng + vệt khói
  const PLANE = new Path2D('M50 0C50 4.5 44 5.5 36 5.5L-38 4.5L-50 2L-50 -2L-38 -4.5L36 -5.5C44 -5.5 50 -4.5 50 0Z M12 5L-16 50L-25 50L-10 5Z M12 -5L-16 -50L-25 -50L-10 -5Z M-36 4L-47 19L-52 19L-46 3.5Z M-36 -4L-47 -19L-52 -19L-46 -3.5Z');
  const offM = (pt, m, deg) => { const r = deg * Math.PI / 180; return [pt[0] + m * Math.sin(r) / (111320 * Math.cos(pt[1] * Math.PI / 180)), pt[1] + m * Math.cos(r) / 110540]; };
  function plane(ctx, t, s) {
    const rw = inf.airport, u = t - s.t0 - 1.9;
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
      ctx.font = font(700, 10.5); ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 6 * k; ctx.fillText(name, x + 9 * k, y + 4 * k);
      ctx.restore();
    }
  }
  function chip(ctx, x, y, txt) {
    ctx.save(); ctx.font = font(600, 11); const w = ctx.measureText(txt).width + 20 * k;
    rrect(ctx, x, y, w, 24 * k, 12 * k); ctx.fillStyle = 'rgba(11,18,32,.8)'; ctx.fill();
    ctx.lineWidth = 1 * k; ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.stroke();
    ctx.fillStyle = '#e8edf7'; ctx.fillText(txt, x + 10 * k, y + 16 * k); ctx.restore();
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
    const P = story.photos, lt = t - s.t0;
    const A = Math.min(clamp01(lt / 0.45), clamp01((s.t1 - t) / 0.45));   // vào/ra cảnh: mờ từ bản đồ sang ảnh
    const i = Math.min(P.length - 1, Math.floor(lt / PHOTO_T)), u = (lt - i * PHOTO_T) / PHOTO_T;
    photoFrame(ctx, P[i], u, i % 4, A);
    const next = P[i + 1], fade = clamp01((lt - (i + 1) * PHOTO_T + 0.5) / 0.5);   // 0,5 s cuối: ảnh sau hiện dần lên
    if (next && fade > 0) photoFrame(ctx, next, fade * 0.5 / PHOTO_T, (i + 1) % 4, A * fade);
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
      ...C.lines.map((l, j) => ({ txt: l, size: 16, bg: 'rgba(12,12,12,.72)', ink: '#FFFFFF', w: 700, body: true, gapTop: j ? 4 : 12 })),
    ].filter(Boolean);
    ctx.save(); ctx.textBaseline = 'middle';
    // đo + co chữ cho vừa dải an toàn
    for (const b of boxes) {
      let sz = b.size * k;
      ctx.font = `${b.w} ${sz}px ${b.body ? FONT : COVER_FONT}`;
      const padX = (b.big ? 16 : 11) * k;
      if (b.big && ctx.measureText(b.txt).width + padX * 2 > maxW) { sz *= (maxW - padX * 2) / ctx.measureText(b.txt).width; ctx.font = `${b.w} ${sz}px ${COVER_FONT}`; }
      b.txt2 = fitEllipsis(ctx, b.txt, maxW - padX * 2);
      b.sz = sz; b.padX = padX; b.h = sz * (b.big ? 1.32 : 1.55); b.bw = ctx.measureText(b.txt2).width + padX * 2; b.font = ctx.font;
    }
    const blockW = Math.max(...boxes.map(b => b.bw)), blockH = boxes.reduce((s2, b) => s2 + b.h + (b.gapTop || 0) * k, 0);
    const x0 = Math.max(band0, (band0 + band1) / 2 - blockW / 2);
    let y = height * 0.47 - blockH / 2;
    boxes.forEach((b, j) => {
      y += (b.gapTop || 0) * k;
      const lt = t - j * 0.09, e = clamp01(lt / 0.32);
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
  // Từng chữ đặt theo hướng tuyến tại chỗ của nó, biến hình theo phép chiếu tại chỗ (dọc tuyến × vuông góc tuyến trên mặt
  // đất) → chữ nằm dẹt, nghiêng theo góc máy. Montserrat 900 in hoa, giãn chữ, bóng đậm; KHÔNG làm khối (Giang 11/11).
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
  function layoutGround(ctx, path, mid, text, pxH) {
    if (!text || path.len < 5) return null;
    const c0 = basis(atM(path, mid), dirAt(path, mid, 20));
    if (c0.P[0] < -width || c0.P[0] > 2 * width || c0.P[1] < -height || c0.P[1] > 2 * height) return null;
    const bl = Math.hypot(...c0.b);
    if (bl < 1e-4) return null;
    let Hm = Math.min(900, pxH / bl);               // cỡ chữ (mét) để cao ~pxH điểm ảnh ở giữa chữ
    const flip = c0.a[0] < 0;                        // chữ luôn đọc trái → phải trên màn hình
    const chars = [...String(text).toUpperCase()];
    // tuyến chạy sâu vào màn hình bị phối cảnh ép dẹp → kéo dài chữ theo chiều tuyến (như chữ sơn trên mặt đường thật)
    const st = Math.max(1, Math.min(3.2, bl / Math.max(1e-6, Math.hypot(...c0.a))));
    let ws = chars.map(ch => cw(ctx, ch) * Hm / 100 * st), track = Hm * 0.14 * st;
    let total = ws.reduce((x, y) => x + y, 0) + track * (ws.length - 1);
    if (total > path.len * 0.92) { const f = path.len * 0.92 / total; Hm *= f; track *= f; ws = ws.map(w => w * f); total *= f; }
    let m = Math.max(total / 2, Math.min(path.len - total / 2, mid)) - total / 2;
    const order = flip ? chars.map((_, i) => chars.length - 1 - i) : chars.map((_, i) => i);
    // đi dọc tuyến theo chiều của path; nếu cần đảo chữ (flip) thì đặt ký tự cuối ở đầu path và xoay 180°
    const glyphs = [];
    for (const i of order) {
      const w = ws[i], cm = m + w / 2;
      const bs = basis(atM(path, cm), dirAt(path, cm, Math.max(8, Hm * 1.2)) + (flip ? 180 : 0));
      const r = 0.55 * Math.max(w * Math.hypot(...bs.a), Hm * Math.hypot(...bs.b));
      glyphs.push({ ch: chars[i], w, bs, box: [bs.P[0] - r, bs.P[1] - r, bs.P[0] + r, bs.P[1] + r] });
      m += w + track;
    }
    return { Hm, st, glyphs };
  }
  function drawGround(ctx, lay, color, alpha) {
    if (alpha <= 0) return;
    const { Hm, st, glyphs } = lay;
    ctx.save();
    ctx.font = `900 ${Hm}px Montserrat, ${FONT}`;
    ctx.globalAlpha = clamp01(alpha);
    ctx.lineJoin = 'round';
    for (const g of glyphs) {
      const { bs, ch } = g, w = g.w / st;   // vẽ chữ cỡ thường, trục dọc tuyến nhân st
      ctx.setTransform(bs.a[0] * st, bs.a[1] * st, -bs.b[0], -bs.b[1], bs.P[0], bs.P[1]);
      ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 10 * k; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 4 * k;
      ctx.lineWidth = Hm * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(ch, -w / 2, Hm * 0.36);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = color; ctx.fillText(ch, -w / 2, Hm * 0.36);
    }
    ctx.restore();
  }
  // Tên trục đường kiểu cũ (render.js text3D, Giang chốt 23/10): chữ thẳng nằm trên mặt đất theo hướng tuyến,
  // mặt chữ trắng → màu line của trục, thân khối màu line tối dâng lên, bóng đậm
  const spW = (ctx, T, sp) => { let w = 0; for (const ch of T) w += ctx.measureText(ch).width + sp; return w - sp; };
  const spDo = (ctx, T, sp, fn) => { let x = -spW(ctx, T, sp) / 2; for (const ch of T) { ctx[fn](ch, x, 0); x += ctx.measureText(ch).width + sp; } };
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); return `rgb(${Math.round((n >> 16 & 255) * f)},${Math.round((n >> 8 & 255) * f)},${Math.round((n & 255) * f)})`; };
  function layout3D(ctx, path, mid, text, pxH) {
    if (!text || path.len < 5) return null;
    const T = String(text).toUpperCase(), pt = atM(path, mid);
    let bs = basis(pt, dirAt(path, mid, 20));
    if (bs.P[0] < -width || bs.P[0] > 2 * width || bs.P[1] < -height || bs.P[1] > 2 * height) return null;
    const bl = Math.hypot(...bs.b);
    if (bl < 1e-4) return null;
    const Hm = Math.min(900, pxH / bl), st = Math.max(1, Math.min(2.6, bl / Math.max(1e-6, Math.hypot(...bs.a))));
    const sp = Hm * 0.07, tw = [...T].reduce((x, ch) => x + cw(ctx, ch) * Hm / 100 + sp, -sp);
    const deg = dirAt(path, mid, Math.max(20, tw * st * 0.4));
    bs = basis(pt, deg); if (bs.a[0] < 0) bs = basis(pt, deg + 180);   // chữ đọc trái → phải
    const dpx = Hm * bl * 0.3, hw = tw * st / 2, hh = Hm * 0.5, boxes = [], nb = Math.max(6, [...T].length);
    for (let i = 0; i < nb; i++) {   // khung theo từng đoạn ~1 ký tự dọc chữ (chữ chéo không chiếm cả hình chữ nhật lớn)
      const xs = [], ys = [];
      for (const u of [-1 + 2 * i / nb, -1 + 2 * (i + 1) / nb]) for (const v of [-1, 1]) {
        xs.push(bs.P[0] + bs.a[0] * u * hw - bs.b[0] * v * hh); ys.push(bs.P[1] + bs.a[1] * u * hw - bs.b[1] * v * hh);
      }
      boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys) + dpx]);
    }
    return { T, Hm, st, sp, bs, bl, dpx, boxes };
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
  const zoneText = zones.map(z => {
    const pts = z.rings.flat();
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), cy = (y0 + y1) / 2;
    const wM = kmBetween([x0, cy], [x1, cy]) * 1000, hM = kmBetween([x0, y0], [x0, y1]) * 1000;
    // vùng nhỏ (bệnh viện ~150 m) → kéo dài đường chữ tới 2,4 km cho tên to, dễ đọc, phủ ngang qua vùng
    const cx = (x0 + x1) / 2, ex = Math.max(1, 2400 / Math.max(1, Math.max(wM, hM)));
    const hz = pathOf([[cx - (cx - x0) * ex, cy], [cx + (x1 - cx) * ex, cy]]), vt = pathOf([[cx, cy - (cy - y0) * ex], [cx, cy + (y1 - cy) * ex]]);
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
  const fadeTo = (t, t1) => DIM + (1 - DIM) * clamp01(1 - (t - t1) / 0.6);   // sau cảnh của nó: 1 → DIM trong 0,6 s
  const gVis = {};   // độ hiện do va chạm (mượt theo thời gian khi xuất tuần tự)
  function groundLabels(ctx, t, s) {
    if (s.kind === 'photos') return;
    const items = [];
    const rs = roadsScene;
    if (rs && t >= rs.t0) roadText.forEach((rts, j) => {
      if (!rts.length) return;
      const cur = t < rs.t1;
      items.push({ key: 'rd' + j, rts, text: story.roads[j].name, px: 26 * k, color: story.roads[j].color, d3: true, rise: cur ? easeOut(roadOn(j, t)) : 1, a: cur ? roadOn(j, t) : fadeTo(t, rs.t1), pri: cur ? 2 : 0 });
    });
    const on = zoneKey.split('|');
    zones.forEach((z, j) => {
      if (!on.includes(z.id)) return;
      const sc = tl.scenes.find(x => x.kind === 'poi' && story.pois[x.i]?.id === z.poiId) || (z.cat === 'airport' && s.kind === 'airport' ? s : null);
      const cur = sc && t < sc.t1;
      items.push({ key: z.id, rts: zoneText[j], text: z.name, px: 30 * k, color: (story.roads.length + j) % 2 ? YEL : WHITE, a: cur ? 1 : sc ? fadeTo(t, sc.t1) : DIM, pri: cur ? 2 : 0 });
    });
    const bsn = tl.scenes.find(x => x.kind === 'build');
    if (bsn && t >= bsn.t0) buildText.forEach((bt, j) => {
      if (!bt) return;
      const cur = t < bsn.t1;
      items.push({ key: 'bd' + j, rts: [bt], text: story.build[j].name, px: 26 * k, color: '#FFB703', a: cur ? clamp01((t - bsn.t0 - 1.0) / 0.6) : fadeTo(t, bsn.t1), pri: cur ? 2 : 0 });
    });
    // vùng giữ chỗ: ghim nhà, nhãn tiện ích đang nói, dải phụ đề
    const [hx, hy] = proj(H), cy = CAP_Y * height;
    const placed = [[hx - 30 * k, hy - 70 * k, hx + 30 * k, hy + 10 * k], [0, cy - 30 * k, width, cy + 30 * k]];
    if (s.kind === 'poi' || s.kind === 'anchor') {
      const [x, y] = proj((s.kind === 'poi' ? story.pois : story.anchors)[s.i].at);
      placed.push([x - 110 * k, y - 75 * k, x + 110 * k, y + 10 * k]);
    }
    items.sort((a, b) => b.pri - a.pri);
    const base = placed.slice();
    // đặt lần lượt; chữ nào hết chỗ thì đưa lên đặt trước và xếp lại một lần (lấy cách xếp ít chữ bị ẩn hơn)
    const place = order => {
      const pl = base.slice(), res = [];
      for (const it of order) {
        if (it.a <= 0) continue;
        const g = gVis[it.key], lf = it.d3 ? layout3D : layoutGround;
        // chữ đang ẩn vì hết chỗ: 0,25 s mới dò lại một lần (dò mọi chỗ mỗi khung làm xuất video chậm gấp đôi)
        if (g && g.v === 0 && g.tried != null && t >= g.tried && t - g.tried < 0.25) continue;
        // đè chữ / lòi mép → thử dời dọc tuyến, sang đoạn khác của tuyến, rồi thu nhỏ (giữ chỗ đã chọn ở khung trước cho khỏi nhảy)
        const cands = [];
        for (const sz of [1, 0.75, 0.55, 0.42]) it.rts.forEach((_, pi) => { for (const o of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 4, -4, 5, -5, 6, -6]) cands.push(pi + '|' + o + '|' + sz); });
        const steps = {};
        let lay = null, off = '0|0|1', hit = true;
        for (const c of [...new Set([g?.off ?? '0|0|1', ...cands])]) {
          const [pi, o, sz] = c.split('|').map(Number), rt = it.rts[pi];
          if (!rt) continue;
          const { path, mid } = rt;
          if (o && !steps[pi]) { const L0 = lf(ctx, path, mid, it.text, it.px); steps[pi] = L0 ? L0.Hm * Math.max(5, 0.4 * it.text.length) : -1; }
          if (o && steps[pi] < 0) continue;
          const m = o ? Math.max(0, Math.min(path.len, mid + o * steps[pi])) : mid;
          if (rt.mb != null) { const dd = Math.abs(((dirAt(path, m, 60) - rt.mb) % 180 + 180) % 180); if (Math.min(dd, 180 - dd) > 35) continue; }   // chỗ lệch hướng trục (nhánh rẽ, khúc cua)
          const L2 = lf(ctx, path, m, it.text, it.px * sz);
          if (!L2) continue;
          if (!lay) { lay = L2; off = c; }
          const bx = L2.boxes || L2.glyphs.map(q => q.box);
          if (inView(bx) && !overlaps(bx, pl)) { lay = L2; off = c; hit = false; break; }
        }
        if (!lay) continue;
        if (!hit) pl.push(...(lay.boxes || lay.glyphs.map(q => q.box)));
        res.push({ it, lay, off, hit });
      }
      return res;
    };
    let res = place(items);
    const bad = res.filter(r => r.hit && r.it.pri === 2).map(r => r.it);
    if (bad.length) {
      const alt = place([...bad, ...items.filter(it => !bad.includes(it))]);
      if (alt.filter(r => !r.hit).length > res.filter(r => !r.hit).length) res = alt;
    }
    for (const { it, lay, off, hit } of res) {
      // không chỗ nào trống (đã thử dời + thu nhỏ + xếp lại): ẩn dần — luật chữ không đè nhau, không lòi ra mép
      const g = gVis[it.key], target = hit ? 0 : 1;
      const v = !g || Math.abs(t - g.t) > 0.5 ? target : g.v + Math.sign(target - g.v) * Math.min(Math.abs(target - g.v), Math.abs(t - g.t) / 0.3);
      gVis[it.key] = { v, t, off, tried: hit ? t : null };
      if (it.d3) draw3D(ctx, lay, it.color, it.a * v, it.rise); else drawGround(ctx, lay, it.color, it.a * v);
    }
  }

  // Vẽ khung ở thời điểm t vào ctx (bản đồ phải đã ở đúng máy quay của t: setFrame/prepare)
  function draw(ctx, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(map.getCanvas(), 0, 0, width, height);
    const s = sceneAt(t), L = story.lines, pr = routeProg(t);
    groundLabels(ctx, t, s);
    (story.pois || []).forEach((p, i) => head(ctx, poiPaths[i], pr['r' + i] ?? 0, GOLD));
    (story.anchors || []).forEach((a, i) => head(ctx, ancPaths[i], pr['a' + i] ?? 0, GOLD));
    // ghim nhỏ viền vàng ở các tiện ích đã tới (line tới nơi)
    (story.pois || []).forEach((p, i) => { if ((pr['r' + i] ?? 0) >= 1) poiPin(ctx, p.at, p.cat); });
    (story.anchors || []).forEach((a, i) => { if ((pr['a' + i] ?? 0) >= 1 && (s.kind === 'anchor' || s.kind === 'cta')) poiPin(ctx, a.at, a.type); });
    if (story.lot && (s.kind === 'intro' || s.kind === 'lot')) lotOverlay(ctx, s.kind === 'lot' ? 1 : clamp01((t - 5.2 - SH) / 0.6), s.kind === 'lot');
    if (!(story.lot && s.kind === 'lot')) pin(ctx, t);
    ring(ctx, s.kind === 'score' ? clamp01((t - s.t0) / 1.2) : s.kind === 'cta' && story.score ? 1 - clamp01((t - s.t0) / 0.8) : 0);
    // nhãn: tiện ích / điểm mốc đã tới (cái đang nói thì đầy đủ, cái cũ thu về biểu tượng)
    for (const sc of tl.scenes) {
      if (sc.kind === 'poi' && t >= sc.t0 + 1.5) {
        const p = story.pois[sc.i], cur = t < sc.t1;
        label(ctx, p.at, p.cat, p.name, fmtSub(p, bird), cur ? (t - sc.t0 - 1.5) / 0.45 : 1, !cur, 10 * k);
      }
      if (sc.kind === 'anchor' && t >= sc.t0 + 2.2 && (s.kind === 'anchor' || s.kind === 'cta')) {
        const a = story.anchors[sc.i], cur = t < sc.t1;
        label(ctx, a.at, a.type, a.name, fmtSub(a, bird), cur ? (t - sc.t0 - 2.2) / 0.45 : 1, !cur, 10 * k);
      }
    }
    if (s.kind === 'airport') {
      plane(ctx, t, s);
      const rw = inf.airport;
      label(ctx, [(rw.a[0] + rw.b[0]) / 2, (rw.a[1] + rw.b[1]) / 2], 'airport', rw.name, fmtSub(rw, false), (t - s.t0 - 2.2) / 0.45, false, 34 * k);
    }
    if (s.kind === 'metro') {
      metroStations(ctx);
      train(ctx, t, s);
      label(ctx, inf.metro.stations[Math.min(2, inf.metro.stations.length - 1)][1], 'metro', inf.metro.name, inf.metro.sub, (t - s.t0 - 1.6) / 0.45, false, 26 * k);
    }
    if (s.kind === 'road' && t >= s.t0 + 2.2) {
      const r = inf.road, w = r.ways[0];
      label(ctx, w[Math.floor(w.length / 2)], 'road', r.name, `cách nhà ${fmtKm(r.km)}`, (t - s.t0 - 2.2) / 0.45, false);
    }
    // hạ tầng đang thi công: MỘT thẻ (vẽ sau ghim tiện ích để không bị che), tên từng tuyến đã in dẹt trên tuyến
    if (s.kind === 'build' && buildText[0]) {
      const b0 = story.build[0], more = story.build.length > 1 ? ` +${story.build.length - 1} tuyến` : '';
      label(ctx, atM(buildText[0].path, buildText[0].mid), 'road', '🚧 Đang thi công', `${b0.name} · cách nhà ${fmtKm(b0.km)}${more}`, (t - s.t0 - 2.0) / 0.45, false, 30 * k);
    }
    // thẻ + phụ đề
    if (s.kind === 'house') infoCard(ctx, Math.min((t - s.t0) / 0.45, (s.t1 - t) / 0.35), story.info.price, story.info.chips);
    if (s.kind === 'lot') infoCard(ctx, Math.min((t - s.t0 - 0.5) / 0.45, (s.t1 - t) / 0.35), story.lot.label, story.lot.chips || []);
    if (s.kind === 'score') scoreCard(ctx, Math.min((t - s.t0 - 1.2) / 0.4, (s.t1 - t) / 0.35), (t - s.t0 - 1.25) / 1);
    if (s.kind === 'cta') cta(ctx, (t - s.t0) / 0.4);
    if (s.kind === 'photos') photos(ctx, t, s);
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

  return { map, tl, duration: tl.duration, voiceSegs: tl.voiceSegs, sfx: sfxEvents3D(tl), ready, setFrame, prepare, draw, live, frameSource, destroy };
}
