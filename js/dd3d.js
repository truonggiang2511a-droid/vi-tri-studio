// "AI đạo diễn" — kiểu vẽ 3D (nhánh ai-dao-dien, CHƯA dùng trong app chính).
// Chuyển động giống hệt bản thử Giang duyệt (11/11): máy quay theo đúng công thức easeTo/flyTo của MapLibre
// (cùng thời lượng, cùng đường cong), đường đi vẽ trên mặt đất bằng lớp bản đồ (nghiêng theo phối cảnh), nhãn bật nảy
// theo đúng đường cong CSS của bản thử. Khác bản thử: mọi thứ tính theo thời gian t → xem trước = xuất MP4 từng khung.
// Nền: MapLibre GL (BSD-3) + ảnh vệ tinh Esri + khối nhà OpenStreetMap (OpenFreeMap).
import maplibregl from 'maplibre-gl';
import { drawIcon } from './icons.js';

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
    const inName = nx && cap(tk.w) && (cap(nx.w) || /^\d+[,.;:]?$/.test(nx.w)) && !/[,.;:!?…]$/.test(tk.w) && cur.length < 6;
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
    const at = kind === 'intro' ? 0.7 : VO_AT;
    const say = buf ? buf.duration : story.paceByText ? est(textOf(kind, extra.i)) : 0;
    const dur = Math.max(min, say ? at + say + TAIL : 0);
    // phụ đề: cắt lời thành cụm ngắn (~3 từ có nghĩa), mỗi cụm hiện đúng lúc giọng đọc tới
    const caps = capChunks(textOf(kind, extra.i), t + at, say || Math.max(1, dur - at - TAIL));
    scenes.push({ kind, t0: t, t1: t + dur, vo: buf ? { t: t + at, buffer: buf } : null, caps, ...extra });
    t += dur;
  };
  add('intro', 5.8, v.intro);
  if (story.lot) add('lot', 6.2, v.lot); else add('house', 4.8, v.house);
  (story.pois || []).forEach((p, i) => add('poi', 3.4, v.poi?.[i], { i }));
  (story.anchors || []).forEach((a, i) => add('anchor', 4.4, v.anchor?.[i], { i }));
  const inf = story.infra || {};
  if (inf.airport) add('airport', 7.2, v.airport);
  if (inf.metro) add('metro', 7, v.metro);
  if (inf.road) add('road', 4.6, v.road);
  if (story.score) add('score', 4.8, v.score);
  add('cta', 3.8, v.cta);
  return { scenes, duration: t, voiceSegs: scenes.filter(s => s.vo).map(s => s.vo) };
}

// SFX theo nhịp hình (tổng hợp bằng js/sfx.js): whoosh khi máy lướt, lấp lánh suốt lúc line chạy, pop + ding khi nhãn
// bật, tiếng trầm khi khối nhà dựng, động cơ phản lực khi máy bay cất cánh, ray tàu khi metro chạy, tick điểm sống
export function sfxEvents3D(tl) {
  const ev = [], add = (t, kind, gain, dur) => { if (t >= 0 && t < tl.duration) ev.push({ t, kind, gain, dur }); };
  for (const s of tl.scenes) {
    const d = s.t1 - s.t0;
    if (s.kind === 'intro') { add(0.6, 'riser', 0.32, 2.8); add(3, 'whoosh', 0.5, 1.8); add(5.15, 'thud', 0.5); }
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
  const H = story.house;
  const bird = !!story.bird;
  const routePts = p => (!bird && p.route && p.route.length > 1) ? p.route : [H, p.at];
  const poiPaths = (story.pois || []).map(p => pathOf(routePts(p)));
  const ancPaths = (story.anchors || []).map(a => pathOf(routePts(a)));
  const inf = story.infra || {};
  const metroPath = inf.metro ? pathOf(inf.metro.line) : null;

  // ---- bản đồ nằm ngoài màn hình, đúng kích thước khung xuất ----------------------------------------------------
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-${width + 4000}px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(box);
  const lineSrc = coords => ({ type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
  const sources = {
    sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
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
    for (const s of tl.scenes) {
      const d = s.t1 - s.t0;
      if (s.kind === 'intro') ease(0.6, 5, { c: H, z: story.lot ? 18.6 : 17.3, p: 62, b: -25 });
      else if (s.kind === 'house') ease(s.t0, d, { c: H, z: 17.8, p: 66, b: 70 }, LIN);
      else if (s.kind === 'lot') ease(s.t0, d, f => ({ c: H, z: 19.7, p: 56, b: f.b + 110 }), EASE);   // sát lô: cạnh 5 m vẫn đủ rộng để ghi số
      else if (s.kind === 'poi') {
        const p = story.pois[s.i];
        ease(s.t0, 1.7, fitCam([H, p.at], bearingDemo(H, p.at) - 20, 58), QUAD);
        ease(s.t0 + 1.5, d - 1.5, f => ({ ...f, b: f.b + 12 }), LIN);
      } else if (s.kind === 'anchor') {
        const a = story.anchors[s.i], P = ancPaths[s.i].pts, step = Math.max(1, Math.floor(P.length / 30));
        ease(s.t0, 2.2, fitCam([H, a.at, ...P.filter((_, j) => j % step === 0)], bearingDemo(H, a.at) - 20, 50), QUAD);
        ease(s.t0 + 2.2, d - 2.2, f => ({ ...f, b: f.b + 10 }), LIN);
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
        ease(s.t0, 2.2, fitCam([H, ...all], 15, 48));
        ease(s.t0 + 2.2, d - 2.2, f => ({ ...f, b: f.b + 10 }), LIN);
      } else if (s.kind === 'score') {
        const all = [H, ...(story.pois || []).map(p => p.at), ...circleKm(H, 1).filter((_, i) => i % 24 === 0)];
        ease(s.t0, 2.4, fitCam(all, 0, 45));
        ease(s.t0 + 1.2, d - 1.2, f => ({ ...f, b: 25 }), LIN);
      } else if (s.kind === 'cta') ease(s.t0, 3.5, { c: H, z: 16.4, p: 60, b: 60 });
    }
  }
  const sceneIdx = t => { const i = tl.scenes.findIndex(s => t < s.t1); return i < 0 ? tl.scenes.length - 1 : i; };
  const sceneAt = t => tl.scenes[sceneIdx(t)];
  const houseH = t => (story.lot ? 2.2 : story.footprint ? story.footprint.height : story.kind === 'canho' ? 0 : 11) * easeOut(clamp01((t - 5.2) / 0.9));

  // tiến độ vẽ từng đường tại t (0..1)
  function routeProg(t) {
    const out = {};
    for (const s of tl.scenes) {
      if (t < s.t0) continue;
      if (s.kind === 'poi') out['r' + s.i] = clamp01((t - s.t0) / 1.5);
      if (s.kind === 'anchor') out['a' + s.i] = clamp01((t - s.t0) / 2.2);
      if (s.kind === 'road') inf.road.ways.forEach((_, j) => { out['w' + j] = clamp01((t - s.t0 - 0.1) / 2.2); });
      if (s.kind === 'metro') out.m0 = clamp01((t - s.t0 - 0.3) / 1.3);
    }
    return out;
  }
  const lastGrad = {};
  const NONE = 'rgba(0,0,0,0)';
  // line của cảnh đang nói sáng rực; line các cảnh trước mờ xuống (đỡ rối, mỗi lúc chỉ một line nổi bật)
  const curRoute = t => { const s = sceneAt(t); return s.kind === 'poi' ? 'r' + s.i : s.kind === 'anchor' ? 'a' + s.i : null; };
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  function setRoutes(t) {
    const pr = routeProg(t), cur = curRoute(t), sk = sceneAt(t).kind;
    for (const { id, color, gold } of routeIds) {
      const q = pr[id] ?? 0;
      // cảnh tổng kết / kêu gọi: mọi line sáng lại vừa phải; cảnh khác: chỉ line hiện tại sáng
      const dim = gold && q >= 1 && id !== cur && !(sk === 'score' || sk === 'cta') ? 0.32 : 1;
      const key = q.toFixed(4) + '|' + dim;
      if (lastGrad[id] === key) continue;
      lastGrad[id] = key;
      // phần đã vẽ: màu; phần chưa vẽ: trong suốt (mép cắt gọn trong 0,2% chiều dài)
      const grad = c => q <= 0 ? ['interpolate', ['linear'], ['line-progress'], 0, NONE, 1, NONE]
        : q >= 1 ? ['interpolate', ['linear'], ['line-progress'], 0, c, 1, c]
          : ['interpolate', ['linear'], ['line-progress'], 0, c, Math.max(0, q - 0.002), c, Math.min(1, q), NONE, 1, NONE];
      map.setPaintProperty(id, 'line-gradient', grad(rgba(color, dim)));
      map.setPaintProperty(id + '-g', 'line-gradient', grad(rgba(gold ? LINE.glow : color, dim)));
      if (gold) map.setPaintProperty(id + '-c', 'line-gradient', grad(rgba(LINE.core, dim)));
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
  }
  // Xuất: chờ bản đồ vẽ xong khung này với đủ ô ảnh + dữ liệu (tối đa 20 s/khung khi mạng treo)
  function prepare(t) {
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
        if ((map.isStyleLoaded() && map.areTilesLoaded()) || performance.now() - t0 > 20000) { fin = true; map.off('data', kick); res(); return; }
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
    if (!c || t > s.t1 - 0.12) return;
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
    ctx.fillStyle = GOLD; ctx.font = font(800, 13); ctx.fillText('ĐIỂM SỐNG QUANH NHÀ (bán kính 1 km)', x0, y0 + 23 * k);
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
  const PIN_DROP = 5.0;
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
    const pts = circleKm(H, 1).map(proj);
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

  // Vẽ khung ở thời điểm t vào ctx (bản đồ phải đã ở đúng máy quay của t: setFrame/prepare)
  function draw(ctx, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(map.getCanvas(), 0, 0, width, height);
    const s = sceneAt(t), L = story.lines, pr = routeProg(t);
    (story.pois || []).forEach((p, i) => head(ctx, poiPaths[i], pr['r' + i] ?? 0, GOLD));
    (story.anchors || []).forEach((a, i) => head(ctx, ancPaths[i], pr['a' + i] ?? 0, GOLD));
    // ghim nhỏ viền vàng ở các tiện ích đã tới (line tới nơi)
    (story.pois || []).forEach((p, i) => { if ((pr['r' + i] ?? 0) >= 1) poiPin(ctx, p.at, p.cat); });
    (story.anchors || []).forEach((a, i) => { if ((pr['a' + i] ?? 0) >= 1 && (s.kind === 'anchor' || s.kind === 'cta')) poiPin(ctx, a.at, a.type); });
    if (story.lot && (s.kind === 'intro' || s.kind === 'lot')) lotOverlay(ctx, s.kind === 'lot' ? 1 : clamp01((t - 5.2) / 0.6), s.kind === 'lot');
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
    // thẻ + phụ đề
    if (s.kind === 'house') infoCard(ctx, Math.min((t - s.t0) / 0.45, (s.t1 - t) / 0.35), story.info.price, story.info.chips);
    if (s.kind === 'lot') infoCard(ctx, Math.min((t - s.t0 - 0.5) / 0.45, (s.t1 - t) / 0.35), story.lot.label, story.lot.chips || []);
    if (s.kind === 'score') scoreCard(ctx, Math.min((t - s.t0 - 1.2) / 0.4, (s.t1 - t) / 0.35), (t - s.t0 - 1.25) / 1);
    if (s.kind === 'cta') cta(ctx, (t - s.t0) / 0.4);
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
