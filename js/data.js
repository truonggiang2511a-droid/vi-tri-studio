// Dữ liệu bản đồ cho video vị trí.
// Tiện ích, trục đường lớn, ranh tỉnh/thành: vector tiles OpenFreeMap (dữ liệu OpenStreetMap,
// miễn phí, không cần key, phục vụ qua CDN nên nhanh và ổn định).
// Tên xã/phường, tỉnh/thành và đường đi thật: Vietmap qua /api/map (dự phòng Nominatim, OSRM).
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { haversineKm, project, unproject } from './geo.js';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const FALLBACK_TILES = 'https://tiles.openfreemap.org/planet/20261011_080001_pt/{z}/{x}/{y}.pbf';
// Tìm địa điểm, ranh KCN, tên xã/tỉnh, đường đi: đi qua máy chủ của app (/api/map) để nhớ đệm và có nguồn dự phòng
const PHOTON = '/api/map/search';

export const CATEGORIES = {
  truong:    { label: 'Trường học',        short: 'TRƯỜNG HỌC', icon: 'school', order: 1 },
  yte:       { label: 'Bệnh viện / Y tế',  short: 'Y TẾ',       icon: 'health', order: 2 },
  cho:       { label: 'Chợ / Siêu thị',    short: 'MUA SẮM',    icon: 'market', order: 3 },
  hanhchinh: { label: 'Hành chính',        short: 'HÀNH CHÍNH', icon: 'gov',    order: 4 },
  congvien:  { label: 'Công viên / Thể thao', short: 'CÔNG VIÊN', icon: 'park', order: 5 },
  kcn:       { label: 'Khu công nghiệp',   short: 'KHU CÔNG NGHIỆP', icon: 'factory', order: 6 },
  khudothi:  { label: 'Khu đô thị',        short: 'KHU ĐÔ THỊ', icon: 'city',   order: 7 },
  giaothong: { label: 'Sân bay / Nhà ga / Bến xe', short: 'GIAO THÔNG', icon: 'bus', order: 8 },
  congcong:  { label: 'Công cộng (biển, trạm sạc…)', short: 'CÔNG CỘNG', icon: 'pin', order: 9 },
  nganhang:  { label: 'Ngân hàng',         short: 'NGÂN HÀNG',  icon: 'bank',   order: 10 },
};
// Biểu tượng theo loại cụ thể trong nhóm (sân bay khác nhà ga, biển khác trạm sạc)
const KIND_ICON = { airport: 'plane', aerodrome: 'plane', station: 'train', halt: 'train', subway: 'train', metro: 'train',
  beach: 'beach', charging_station: 'plug', fuel: 'fuel' };
export function iconOf(p) { return KIND_ICON[p?.kind] || CATEGORIES[p?.cat]?.icon || 'pin'; }

// ---------- Tiện ích nhỏ ----------
function withTimeout(ms, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return { signal: ctrl.signal, done: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); } };
}
const tidy = s => (s || '').replace(/\s+/g, ' ').trim();

// Toạ độ phẳng cục bộ (km) quanh một điểm gốc, để đo khoảng cách nhanh
function localFrame(c) {
  const kx = 111.32 * Math.cos(c.lat * Math.PI / 180), ky = 110.57;
  return {
    xy: p => [(p[1] - c.lng) * kx, (p[0] - c.lat) * ky],
    ll: (x, y) => [c.lat + y / ky, c.lng + x / kx],
  };
}

function segNearestXY(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const x = ax + dx * t, y = ay + dy * t;
  return { d: Math.hypot(px - x, py - y), x, y, t };
}

function polyLenKm(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversineKm({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] });
  return s;
}

// Điểm gần nhất trên tập đường (mảng [lat,lng]) tính từ c
function nearestOnWays(c, ways) {
  const F = localFrame(c);
  let best = null;
  for (const w of ways) {
    for (let i = 1; i < w.length; i++) {
      const [ax, ay] = F.xy(w[i - 1]), [bx, by] = F.xy(w[i]);
      const q = segNearestXY(0, 0, ax, ay, bx, by);
      if (!best || q.d < best.d) {
        const [lat, lng] = F.ll(q.x, q.y);
        best = { d: q.d, lat, lng };
      }
    }
  }
  return best;
}

// Đơn giản hoá đường (Douglas–Peucker) trong toạ độ km
function simplify(pts, F, tolKm) {
  if (pts.length < 3) return pts;
  const xy = pts.map(F.xy);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const q = segNearestXY(xy[i][0], xy[i][1], xy[a][0], xy[a][1], xy[b][0], xy[b][1]);
      if (q.d > md) { md = q.d; mi = i; }
    }
    if (md > tolKm && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------- Vector tiles ----------
let tilesTpl = null;
async function tileTemplate(signal) {
  if (tilesTpl) return tilesTpl;
  try {
    const cached = JSON.parse(localStorage.getItem('vitri.tiles') || 'null');
    if (cached && Date.now() - cached.at < 3 * 86400e3) return (tilesTpl = cached.tpl);
  } catch { /* bỏ qua */ }
  const T = withTimeout(8000, signal);
  try {
    const j = await (await fetch(TILEJSON, { signal: T.signal })).json();
    tilesTpl = j.tiles?.[0] || FALLBACK_TILES;
    try { localStorage.setItem('vitri.tiles', JSON.stringify({ tpl: tilesTpl, at: Date.now() })); } catch { /* bỏ qua */ }
  } catch {
    tilesTpl = FALLBACK_TILES;
  } finally { T.done(); }
  return tilesTpl;
}

async function fetchTile(tpl, z, x, y, signal) {
  const url = tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  for (let attempt = 0; attempt < 3; attempt++) {
    const T = withTimeout(15000, signal);
    try {
      const res = await fetch(url, { signal: T.signal });
      if (res.status === 404 || res.status === 204) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (signal?.aborted) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    } finally { T.done(); }
  }
  throw new Error('Không tải được dữ liệu bản đồ (ô ' + z + '/' + x + '/' + y + ').');
}

// Cắt đoạn thẳng vào ô vuông [lo, hi] (Liang–Barsky)
function clipSeg(p, q, lo, hi) {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const P = [-dx, dx, -dy, dy], Q = [p.x - lo, hi - p.x, p.y - lo, hi - p.y];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return null; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [{ x: p.x + t0 * dx, y: p.y + t0 * dy }, { x: p.x + t1 * dx, y: p.y + t1 * dy }, t0 === 0, t1 === 1];
}
function clipLine(pts, lo, hi) {
  const out = [];
  let cur = [];
  for (let i = 1; i < pts.length; i++) {
    const s = clipSeg(pts[i - 1], pts[i], lo, hi);
    if (!s) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    const [a, b, aOrig, bOrig] = s;
    if (!cur.length) cur.push(a);
    else if (!aOrig) { if (cur.length > 1) out.push(cur); cur = [a]; }
    cur.push(b);
    if (!bOrig) { out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

const ROAD_CLASSES = { motorway: 3, trunk: 2, primary: 1 };

function decodeTile(buf, z, x, y) {
  const t = new VectorTile(new Pbf(buf));
  const res = { pois: [], roads: [], bounds: [] };
  const conv = (pt, ext) => {
    const ll = unproject((x + pt.x / ext) * 256, (y + pt.y / ext) * 256, z);
    return [ll.lat, ll.lng];
  };
  const poi = t.layers.poi;
  if (poi) {
    for (let i = 0; i < poi.length; i++) {
      const f = poi.feature(i);
      if (f.type !== 1) continue;
      const pr = f.properties;
      if (!pr.name) continue;
      const g = f.loadGeometry()[0]?.[0];
      if (!g || g.x < 0 || g.y < 0 || g.x >= poi.extent || g.y >= poi.extent) continue;
      const [lat, lng] = conv(g, poi.extent);
      res.pois.push({ cls: pr.class, sub: pr.subclass, name: tidy(pr['name:vi'] || pr.name), lat, lng });
    }
  }
  // Sân bay nằm ở lớp riêng; khu đô thị có tên ở lớp địa danh (place)
  const ae = t.layers.aerodrome_label;
  if (ae) {
    for (let i = 0; i < ae.length; i++) {
      const f = ae.feature(i);
      const pr = f.properties;
      if (!pr.name || f.type !== 1) continue;
      const g = f.loadGeometry()[0]?.[0];
      if (!g || g.x < 0 || g.y < 0 || g.x >= ae.extent || g.y >= ae.extent) continue;
      const [lat, lng] = conv(g, ae.extent);
      res.pois.push({ cls: 'aerodrome', sub: 'airport', name: tidy(pr['name:vi'] || pr.name), lat, lng });
    }
  }
  const pl = t.layers.place;
  if (pl) {
    for (let i = 0; i < pl.length; i++) {
      const f = pl.feature(i);
      const pr = f.properties;
      const nm = tidy(pr['name:vi'] || pr.name || '');
      if (!nm || f.type !== 1 || !/^(khu đô thị|kđt\b|vinhomes|ecopark|phú mỹ hưng)/i.test(nm)) continue;
      const g = f.loadGeometry()[0]?.[0];
      if (!g || g.x < 0 || g.y < 0 || g.x >= pl.extent || g.y >= pl.extent) continue;
      const [lat, lng] = conv(g, pl.extent);
      res.pois.push({ cls: 'place', sub: 'urban', name: nm, lat, lng });
    }
  }
  const tn = t.layers.transportation_name;
  if (tn) {
    for (let i = 0; i < tn.length; i++) {
      const f = tn.feature(i);
      const pr = f.properties;
      const level = ROAD_CLASSES[pr.class];
      if (!level || f.type !== 2) continue;
      for (const line of f.loadGeometry()) {
        for (const piece of clipLine(line, 0, tn.extent)) {
          res.roads.push({ level, name: tidy(pr['name:vi'] || pr.name), ref: tidy(pr.ref), pts: piece.map(p => conv(p, tn.extent)) });
        }
      }
    }
  }
  const bd = t.layers.boundary;
  if (bd) {
    for (let i = 0; i < bd.length; i++) {
      const f = bd.feature(i);
      const pr = f.properties;
      if (Number(pr.admin_level) !== 4 || pr.maritime === 1 || f.type !== 2) continue;
      for (const line of f.loadGeometry()) {
        for (const piece of clipLine(line, 0, bd.extent)) res.bounds.push(piece.map(p => conv(p, bd.extent)));
      }
    }
  }
  return res;
}

async function loadArea(center, radiusKm, signal, onProgress) {
  const tpl = await tileTemplate(signal);
  const z = radiusKm <= 6 ? 14 : 13;
  const dLat = radiusKm * 1.05 / 111.32, dLng = radiusKm * 1.05 / (111.32 * Math.cos(center.lat * Math.PI / 180));
  const a = project(center.lat + dLat, center.lng - dLng, z), b = project(center.lat - dLat, center.lng + dLng, z);
  const x0 = Math.floor(a.x / 256), x1 = Math.floor(b.x / 256), y0 = Math.floor(a.y / 256), y1 = Math.floor(b.y / 256);
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
  const out = { pois: [], roads: [], bounds: [] };
  let done = 0;
  const queue = jobs.slice();
  const worker = async () => {
    while (queue.length) {
      const [x, y] = queue.shift();
      const buf = await fetchTile(tpl, z, x, y, signal);
      if (buf) {
        const r = decodeTile(buf, z, x, y);
        out.pois.push(...r.pois); out.roads.push(...r.roads); out.bounds.push(...r.bounds);
      }
      onProgress?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, worker));
  return out;
}

// ---------- Tiện ích từ Overture Maps (Meta, Microsoft; giấy phép CDLA-Permissive-2.0) ----------
// Dựng sẵn bằng tools/build_poi_tiles.py, mỗi ô 0,1 độ là một file poi/<x>_<y>.json
const OVT_CAT = { t: 'truong', y: 'yte', c: 'cho', h: 'hanhchinh', p: 'congvien', k: 'kcn', g: 'giaothong', n: 'nganhang' };
const OVT_KIND = { h: 'hospital', c: 'clinic', m: 'marketplace', s: 'supermarket', l: 'mall' };
// Tiện ích từ Vietmap (máy chủ /api/map/nearby, có nhớ đệm): bù những điểm OSM/Overture còn thiếu, nhất là gần nhà
async function loadVietmap(center, radiusKm, signal) {
  // Vietmap chậm hoặc lỗi thì bỏ qua sau 12 giây, quét vẫn dùng OSM + Overture như cũ
  const T = withTimeout(12000, signal);
  try {
    const res = await fetch(`/api/map/nearby?lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}&r=${radiusKm}`, { signal: T.signal });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.items || []).filter(x => x.cat && Number.isFinite(x.lat) && Number.isFinite(x.lng))
      .map(x => ({ name: tidy(x.name), cat: x.cat, kind: x.kind || x.cat, lat: x.lat, lng: x.lng, src: 'vm', address: x.address || '' }));
  } catch (e) {
    if (signal?.aborted) throw e;
    return [];
  } finally { T.done(); }
}
async function loadOverture(center, radiusKm, signal) {
  const dLat = radiusKm * 1.05 / 110.57, dLng = radiusKm * 1.05 / (111.32 * Math.cos(center.lat * Math.PI / 180));
  const x0 = Math.floor((center.lng - dLng) * 10), x1 = Math.floor((center.lng + dLng) * 10);
  const y0 = Math.floor((center.lat - dLat) * 10), y1 = Math.floor((center.lat + dLat) * 10);
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    jobs.push((async () => {
      const T = withTimeout(10000, signal);
      try {
        const res = await fetch(`poi/${x}_${y}.json`, { signal: T.signal });
        if (!res.ok) return [];
        const j = await res.json();
        return Array.isArray(j?.p) ? j.p : [];
      } catch (e) {
        if (signal?.aborted) throw e;
        return [];
      } finally { T.done(); }
    })());
  }
  const out = [];
  for (const arr of await Promise.all(jobs)) {
    for (const [lat, lng, name, c, k] of arr) {
      const cat = OVT_CAT[c];
      if (cat) out.push({ name, cat, kind: OVT_KIND[k] || cat, lat, lng, src: 'ovt' });
    }
  }
  return out;
}
// Khoá so trùng tên: bỏ dấu, bỏ ký tự đặc biệt, viết đầy đủ các chữ tắt hay gặp
const DKEY_ABBR = [[/\bthcs\b/g, 'trung hoc co so'], [/\bthpt\b/g, 'trung hoc pho thong'], [/\bmn\b/g, 'mam non'], [/\bth\b/g, 'tieu hoc'], [/\bbv\b/g, 'benh vien'], [/\bubnd\b/g, 'uy ban nhan dan'], [/\bkcn\b/g, 'khu cong nghiep'], [/\bccn\b/g, 'cum cong nghiep']];
function dkey(s) {
  let k = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [re, v] of DKEY_ABBR) k = k.replace(re, v);
  return k;
}
const vnAccents = s => (String(s).normalize('NFD').match(/[\u0300-\u036f]/g) || []).length + (String(s).match(/[đĐ]/g) || []).length;

// ---------- Tiện ích ----------
const CHAIN_STORE = /(bách hóa xanh|bách hoá xanh|bach hoa xanh|winmart|vinmart|co\.?op ?(mart|food|xtra)|circle ?k|family ?mart|ministop|gs25|7-eleven|aeon|lotte mart|emart|go!|big ?c|mm mega|satra|kingfood|lan chi mart|bách hóa|siêu thị)/i;
const GOV_NAME = /(ủy ban|uỷ ban|ubnd|công an|kho bạc|bảo hiểm xã hội|chi cục thuế|đăng ký đất đai|trung tâm hành chính|một cửa|tòa án|toà án|viện kiểm sát|bưu điện)/i;
const KCN_NAME = /(khu công nghiệp|cụm công nghiệp|khu chế xuất|^kcn\b|^ccn\b|^kcx\b)/i;
function classifyPoi(p) {
  const c = p.cls, s = p.sub, n = p.name || '';
  if (KCN_NAME.test(n) && !['bus_stop', 'fuel', 'company', 'cafe', 'restaurant'].includes(s)) return 'kcn';
  if (['school', 'kindergarten', 'college', 'university', 'childcare'].includes(s) || c === 'college' || c === 'school') return 'truong';
  if (['hospital', 'clinic', 'doctors'].includes(s) || c === 'hospital') return 'yte';
  if (['marketplace', 'supermarket', 'mall', 'department_store', 'wholesale'].includes(s)) return 'cho';
  if (s === 'convenience' && CHAIN_STORE.test(n)) return 'cho';
  if (s === 'townhall' || s === 'courthouse' || s === 'police' || c === 'police' || s === 'post_office' || c === 'post') return 'hanhchinh';
  if (c === 'town_hall' && s !== 'community_centre') return 'hanhchinh';
  if ((c === 'office' || c === 'town_hall') && GOV_NAME.test(n)) return 'hanhchinh';
  if (['park', 'stadium', 'sports_centre', 'garden'].includes(s) || c === 'stadium') return 'congvien';
  if (s === 'community_centre' && /(văn hóa|văn hoá|thể thao|thiếu nhi)/i.test(n)) return 'congvien';
  if (s === 'bus_station' || s === 'ferry_terminal' || (c === 'railway' && ['station', 'halt'].includes(s))) return 'giaothong';
  if (c === 'aerodrome' || s === 'aerodrome' || (/^(sân bay|cảng hàng không)/i.test(n) && !['bus_stop', 'platform', 'parking', 'taxi', 'cafe', 'restaurant', 'hotel'].includes(s))) return 'giaothong';
  if (/^(khu đô thị|kđt\b|vinhomes|ecopark|phú mỹ hưng|khu dân cư)/i.test(n) && !['cafe', 'restaurant', 'convenience'].includes(s)) return 'khudothi';
  if (s === 'beach' || c === 'beach' || s === 'beach_resort' || /^(bãi biển|bãi tắm|biển )/i.test(n)) return 'congcong';
  if (s === 'charging_station' || /^(trạm sạc|vinfast.*sạc)/i.test(n)) return 'congcong';
  if (['library', 'cinema', 'theatre', 'museum'].includes(s)) return 'congcong';
  if (s === 'bank') return 'nganhang';
  return null;
}

// Loại cụ thể theo tên (để chọn biểu tượng + câu đọc): sân bay, nhà ga, biển, trạm sạc
function kindFix(name, cat, kind) {
  const n = String(name || '');
  if (cat === 'giaothong' && /^(sân bay|cảng hàng không)/i.test(n)) return 'airport';
  if (cat === 'giaothong' && /^(ga\b|nhà ga|ga metro|ga tàu)/i.test(n)) return 'station';
  if (cat === 'congcong' && /^(bãi biển|bãi tắm|biển )/i.test(n)) return 'beach';
  if (cat === 'congcong' && /^(trạm sạc|vinfast)/i.test(n)) return 'charging_station';
  return kind;
}
function buildPois(raw, center, radiusKm, extra = []) {
  const out = [];
  for (const p of extra) {
    const km = haversineKm(center, p);
    if (km > (p.kind === 'airport' ? Math.max(30, radiusKm) : radiusKm * 1.02)) continue;
    out.push({ id: (p.src === 'vm' ? 'v' : 'o') + Math.round(p.lat * 1e5) + '_' + Math.round(p.lng * 1e5), name: p.name, cat: p.cat, kind: kindFix(p.name, p.cat, p.kind), lat: p.lat, lng: p.lng, km, src: p.src || 'ovt' });
  }
  for (const p of raw) {
    const cat = classifyPoi(p);
    if (!cat) continue;
    if (/^(nhà lồng|dãy|lô|sạp|kiosk|cổng|bãi xe|nhà xe)\b/i.test(p.name)) continue;
    if (cat === 'congvien' && p.sub === 'garden' && !/công viên|vườn hoa/i.test(p.name)) continue;
    const km = haversineKm(center, p);
    // Sân bay ở xa vẫn là điểm cộng lớn: cho phép tới 30 km
    if (km > (p.sub === 'airport' ? Math.max(30, radiusKm) : radiusKm * 1.02)) continue;
    out.push({ id: 'p' + Math.round(p.lat * 1e5) + '_' + Math.round(p.lng * 1e5), name: p.name, cat, kind: kindFix(p.name, cat, p.sub), lat: p.lat, lng: p.lng, km });
  }
  out.sort((a, b) => a.km - b.km);
  // Bỏ trùng giữa hai nguồn: tên giống nhau (bỏ dấu, chứa nhau) gần nhau -> giữ một, lấy tên có dấu đầy đủ hơn
  const kept = [];
  for (const p of out) {
    const fp = dkey(p.name);
    const dup = kept.find(k => {
      if (k.id === p.id) return true;
      const fk = dkey(k.name);
      const same = fk === fp || (fk.length > 6 && fp.length > 6 && (fk.includes(fp) || fp.includes(fk)));
      // Sân bay, nhà ga là khu rộng: cùng loại trong bán kính vài trăm mét là một điểm dù tên khác
      if (k.cat === p.cat && k.kind === p.kind && ['airport', 'station'].includes(p.kind) && haversineKm(k, p) < (p.kind === 'airport' ? 2.5 : 0.4)) return true;
      return same && haversineKm(k, p) < (k.cat === p.cat ? 0.3 : 0.12);
    });
    if (dup) {
      if (vnAccents(p.name) > vnAccents(dup.name)) dup.name = p.name;
      continue;
    }
    kept.push(p);
  }
  return kept;
}

// ---------- Trục đường lớn ----------
const LINK_NAME = /^(đi |đường dẫn|dẫn vào|thoát khỏi|nhánh|cầu vượt nhánh|ra |vào |lối )/i;
const SEGMENT_NAME = /^(cầu|cống|nút giao|hầm|vòng xoay|bùng binh|kênh|ngã)\b/i;
const normRef = r => (r || '').split(';')[0].toUpperCase().replace(/[\s.\-]/g, '');
const fullRef = r => (r || '').toUpperCase().replace(/[\s.\-]/g, '');
const normName = n => tidy(n).toLowerCase().replace(/^đường\s+/, '');

export function shortProvince(name) {
  if (!name) return '';
  if (/hồ chí minh/i.test(name)) return 'TP.HCM';
  return name.replace(/^(thành phố|tỉnh)\s+/i, '').trim();
}

function prettyName(n) {
  return tidy(n)
    .replace(/^Đường cao tốc\s*/i, 'Cao tốc ')
    .replace(/^Đường\s+(?=[A-ZĐÂĂÊÔƠƯ])/u, '')
    .replace(/Thành phố Hồ Chí Minh/gi, 'TP.HCM')
    .replace(/\s*[-–]\s*/g, ' – ');
}

function roadLabelOf(level, ref, name) {
  const r = normRef(ref);
  if (/^QL\d/.test(r)) { const num = r.slice(2); return 'Quốc lộ ' + (num === '1' ? '1A' : num); }
  if (level === 3 && name) return prettyName(name);
  if (/^(ĐT|DT)\d/.test(r)) return 'Tỉnh lộ ' + r.slice(2);
  if (name) return prettyName(name);
  if (/^CT\d/.test(r)) return 'Cao tốc ' + r;
  return ref || 'Đường lớn';
}

// Nối các mảnh đường (đã cắt theo ô) thành tuyến liền mạch
function chainPieces(pieces, F, tolKm) {
  const items = pieces.map(p => ({ pts: p, xy: p.map(F.xy), used: false }));
  items.sort((a, b) => b.pts.length - a.pts.length);
  const chains = [];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (const seed of items) {
    if (seed.used) continue;
    seed.used = true;
    let pts = seed.pts.slice(), xy = seed.xy.slice();
    for (const atEnd of [true, false]) {
      for (;;) {
        const tip = atEnd ? xy[xy.length - 1] : xy[0];
        const prev = atEnd ? xy[Math.max(0, xy.length - 2)] : xy[Math.min(xy.length - 1, 1)];
        const dir = [tip[0] - prev[0], tip[1] - prev[1]];
        let best = null;
        for (const it of items) {
          if (it.used) continue;
          for (const rev of [false, true]) {
            const head = rev ? it.xy[it.xy.length - 1] : it.xy[0];
            const d = dist(tip, head);
            if (d > tolKm) continue;
            const nxt = rev ? it.xy[Math.max(0, it.xy.length - 2)] : it.xy[Math.min(it.xy.length - 1, 1)];
            const v = [nxt[0] - head[0], nxt[1] - head[1]];
            const dot = (dir[0] * v[0] + dir[1] * v[1]) / ((Math.hypot(...dir) * Math.hypot(...v)) || 1);
            const score = d / tolKm - (atEnd ? dot : -dot) * 0.5;
            if (!best || score < best.score) best = { it, rev, score };
          }
        }
        if (!best) break;
        best.it.used = true;
        let p2 = best.it.pts, x2 = best.it.xy;
        if (atEnd) {
          if (best.rev) { p2 = p2.slice().reverse(); x2 = x2.slice().reverse(); }
          pts = pts.concat(p2.slice(1)); xy = xy.concat(x2.slice(1));
        } else {
          if (!best.rev) { p2 = p2.slice().reverse(); x2 = x2.slice().reverse(); }
          pts = p2.slice(0, -1).concat(pts); xy = x2.slice(0, -1).concat(xy);
        }
      }
    }
    chains.push({ pts, xy });
  }
  return chains;
}

// Cắt bỏ phần tuyến ở quá xa căn nhà
function clipToRadius(pts, center, maxKm) {
  const out = [];
  let cur = [];
  for (const p of pts) {
    if (haversineKm(center, { lat: p[0], lng: p[1] }) <= maxKm) cur.push(p);
    else { if (cur.length > 1) out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function chainNear(chain, F) {
  let best = Infinity;
  for (let i = 1; i < chain.xy.length; i++) {
    const q = segNearestXY(0, 0, chain.xy[i - 1][0], chain.xy[i - 1][1], chain.xy[i][0], chain.xy[i][1]);
    if (q.d < best) best = q.d;
  }
  return best;
}

// Tuyến song song trùng (đường hai chiều tách làn) thì bỏ, chỉ giữ một line
function isDuplicate(chain, kept) {
  const step = Math.max(1, Math.floor(chain.xy.length / 20));
  let near = 0, n = 0;
  for (let i = 0; i < chain.xy.length; i += step) {
    n++;
    const [px, py] = chain.xy[i];
    for (const k of kept) {
      let hit = false;
      for (let j = 1; j < k.xy.length; j++) {
        if (segNearestXY(px, py, k.xy[j - 1][0], k.xy[j - 1][1], k.xy[j][0], k.xy[j][1]).d < 0.07) { hit = true; break; }
      }
      if (hit) { near++; break; }
    }
  }
  return n > 0 && near / n > 0.6;
}

// Nối các đoạn của cùng một tuyến bị hở (thiếu cầu, nút giao, đoạn chưa có tên trên OSM) để line không đứt quãng:
// hai đầu mút cách nhau dưới gapKm và hướng đi thuận nhau thì ghép thành một đường liền.
function stitchWays(ways, F, gapKm = 0.3) {
  let list = ways.map(w => ({ pts: w, xy: w.map(F.xy) }));
  const dirAt = (xy, end) => {
    const a = end ? xy[xy.length - 1] : xy[0];
    const b = end ? xy[Math.max(0, xy.length - 4)] : xy[Math.min(xy.length - 1, 3)];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return [(a[0] - b[0]) / d, (a[1] - b[1]) / d]; // hướng đi ra khỏi đầu mút
  };
  for (let guard = 0; guard < 60; guard++) {
    let best = null;
    for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      for (const ei of [true, false]) for (const ej of [true, false]) {
        const A = list[i].xy, B = list[j].xy;
        const pa = ei ? A[A.length - 1] : A[0], pb = ej ? B[B.length - 1] : B[0];
        const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        if (d > gapKm || d < 1e-6) continue;
        const da = dirAt(A, ei), db = dirAt(B, ej);
        const c = [(pb[0] - pa[0]) / d, (pb[1] - pa[1]) / d];
        // đi ra từ A về phía B, và B đi ra ngược về phía A
        const ok = d < 0.04 || (da[0] * c[0] + da[1] * c[1] > 0.55 && -(db[0] * c[0] + db[1] * c[1]) > 0.55);
        if (!ok) continue;
        if (!best || d < best.d) best = { i, j, ei, ej, d };
      }
    }
    if (!best) break;
    const A = list[best.i], B = list[best.j];
    const a = best.ei ? A.pts : A.pts.slice().reverse();
    const b = best.ej ? B.pts.slice().reverse() : B.pts;
    const merged = a.concat(b);
    list = list.filter((_, k) => k !== best.i && k !== best.j);
    list.push({ pts: merged, xy: merged.map(F.xy) });
  }
  return list.map(x => x.pts);
}

function buildRoads(raw, center, radiusKm) {
  const F = localFrame(center);
  // Tên → ref, để mảnh chỉ có tên vẫn vào đúng tuyến có số hiệu (vd. "Lê Khả Phiêu" là QL.1)
  const nameToRef = {};
  for (const r of raw) if (r.ref && r.name && !SEGMENT_NAME.test(r.name) && !LINK_NAME.test(r.name)) nameToRef[normName(r.name)] = r.level === 3 ? fullRef(r.ref) : normRef(r.ref);
  const groups = new Map();
  const loose = [];
  for (const r of raw) {
    if (r.name && LINK_NAME.test(r.name) && !r.ref) continue;
    const seg = !r.name || SEGMENT_NAME.test(r.name) || LINK_NAME.test(r.name);
    let key = null;
    // Cao tốc: nhóm theo toàn bộ số hiệu (CT.01;CT.40 khác CT.01) để cầu, cầu vượt trên tuyến vẫn vào đúng tuyến
    if (r.level === 3) key = r.ref ? 'r:' + fullRef(r.ref) : (r.name && !seg ? (nameToRef[normName(r.name)] ? 'r:' + nameToRef[normName(r.name)] : 'n:' + normName(r.name)) : null);
    else if (r.ref) key = 'r:' + normRef(r.ref);
    else if (r.name && !seg) key = nameToRef[normName(r.name)] ? 'r:' + nameToRef[normName(r.name)] : 'n:' + normName(r.name);
    if (!key) { loose.push(r); continue; }
    let g = groups.get(key);
    if (!g) { g = { key, level: r.level, refs: {}, names: {}, pieces: [] }; groups.set(key, g); }
    g.level = Math.max(g.level, r.level);
    if (r.ref) g.refs[r.ref.split(';')[0]] = (g.refs[r.ref.split(';')[0]] || 0) + 1;
    if (r.name && !seg) g.names[r.name] = (g.names[r.name] || 0) + r.pts.length;
    g.pieces.push(r.pts);
  }
  // Gắn cầu/cống/nút giao không có số hiệu vào tuyến chạm đầu mút, lấp chỗ đứt
  const ends = g => g.pieces.flatMap(p => [F.xy(p[0]), F.xy(p[p.length - 1])]);
  const endCache = new Map();
  for (let pass = 0; pass < 10 && loose.length; pass++) {
    for (let i = loose.length - 1; i >= 0; i--) {
      const r = loose[i];
      const a = F.xy(r.pts[0]), b = F.xy(r.pts[r.pts.length - 1]);
      let hitG = null;
      for (const g of groups.values()) {
        if (Math.abs(g.level - r.level) > 1) continue;
        let E = endCache.get(g);
        if (!E) { E = ends(g); endCache.set(g, E); }
        if (E.some(e => Math.hypot(e[0] - a[0], e[1] - a[1]) < 0.03 || Math.hypot(e[0] - b[0], e[1] - b[1]) < 0.03)) { hitG = g; break; }
      }
      if (hitG) { hitG.pieces.push(r.pts); endCache.delete(hitG); loose.splice(i, 1); }
    }
  }
  const list = [];
  for (const g of groups.values()) {
    const chains = chainPieces(g.pieces, F, 0.04)
      .map(c => ({ ...c, len: polyLenKm(c.pts), near: chainNear(c, F) }))
      .filter(c => c.len > 0.25)
      .sort((a, b) => a.near - b.near);
    if (!chains.length) continue;
    const kept = [];
    for (const c of chains) {
      if (c.near > radiusKm) continue;
      if (kept.length && isDuplicate(c, kept)) continue;
      kept.push(c);
      if (kept.length >= 3) break;
    }
    if (!kept.length) continue;
    const ways = [];
    for (const c of kept) {
      for (const part of clipToRadius(c.pts, center, radiusKm * 1.6)) {
        if (polyLenKm(part) > 0.2) ways.push(simplify(part, F, 0.004));
      }
    }
    if (!ways.length) continue;
    const joined = stitchWays(ways, F);
    ways.length = 0; ways.push(...joined);
    const ref = Object.entries(g.refs).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const name = Object.entries(g.names).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const label = roadLabelOf(g.level, ref, name);
    const alt = name && prettyName(name) !== label ? prettyName(name) : '';
    const near = nearestOnWays(center, ways);
    const lenKm = ways.reduce((s, w) => s + polyLenKm(w), 0);
    if (lenKm < 0.4) continue;
    list.push({
      id: 'r' + g.key.replace(/[^a-z0-9]/gi, '').slice(0, 24) + Math.round(near.d * 1000),
      key: g.key, label, alt, ref, name, level: g.level, ways, nearKm: near.d, lenKm,
      score: near.d / (1 + 0.6 * (g.level - 1)),
    });
  }
  // Cùng nhãn (vd. hai nhóm cùng là Quốc lộ 1A) thì gộp
  const byLabel = new Map();
  for (const r of list.sort((a, b) => a.score - b.score)) {
    const k = r.label.toLowerCase();
    const prev = byLabel.get(k);
    if (prev) { prev.ways = stitchWays([...prev.ways, ...r.ways], localFrame(center)); prev.lenKm += r.lenKm; continue; }
    byLabel.set(k, r);
  }
  return [...byLabel.values()].sort((a, b) => a.score - b.score).slice(0, 14);
}

// ---------- Địa phận ----------
// Trả về { province, commune } theo đơn vị hành chính mới (Vietmap), dự phòng OpenStreetMap
async function reverseGeocode(p, zoom, signal) {
  const T = withTimeout(15000, signal);
  try {
    const res = await fetch(`/api/map/reverse?lat=${p.lat.toFixed(5)}&lng=${p.lng.toFixed(5)}&zoom=${zoom}`, { signal: T.signal });
    if (!res.ok) return null;
    return (await res.json()).place || null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  } finally { T.done(); }
}
const sameProvince = (a, b) => fold(shortProvince(a)) === fold(shortProvince(b));
async function buildAdmin(rawBounds, center, radiusKm, signal) {
  const F = localFrame(center);
  const here = await reverseGeocode(center, 14, signal);
  const province = here?.province || '';
  const commune = here?.commune || '';
  let boundary = null;
  if (rawBounds.length) {
    const chains = chainPieces(rawBounds, F, 0.02).map(c => ({ ...c, near: chainNear(c, F) })).sort((a, b) => a.near - b.near);
    const main = chains[0];
    if (main && main.near <= radiusKm) {
      const P = nearestOnWays(center, [main.pts]);
      const [px, py] = F.xy([P.lat, P.lng]);
      const len = Math.hypot(px, py) || 1;
      const off = 0.45;
      const [alat, alng] = F.ll(px + px / len * off, py + py / len * off);
      const there = await reverseGeocode({ lat: alat, lng: alng }, 8, signal);
      const other = there?.province || '';
      if (!other || !sameProvince(other, province)) {
        const ways = [];
        for (const c of chains) {
          if (c.near > radiusKm * 1.5) continue;
          for (const part of clipToRadius(c.pts, center, radiusKm * 1.8)) if (part.length > 1) ways.push(simplify(part, F, 0.005));
        }
        const name = other || 'Tỉnh lân cận';
        boundary = { name, short: other ? shortProvince(other) : 'TỈNH LÂN CẬN', P: { lat: P.lat, lng: P.lng }, km: P.d, ways };
      }
    }
  }
  return { province, provinceShort: shortProvince(province), commune, boundary };
}

// ---------- Quét toàn bộ ----------
export async function scanArea(center, radiusKm, signal, onProgress) {
  const kcnJob = findIndustrial(center, radiusKm, signal).catch(e => { if (signal?.aborted) throw e; return []; });
  const ovtJob = loadOverture(center, radiusKm, signal).catch(e => { if (signal?.aborted) throw e; return []; });
  const vmJob = loadVietmap(center, radiusKm, signal).catch(e => { if (signal?.aborted) throw e; return []; });
  const raw = await loadArea(center, radiusKm, signal, (d, n) => onProgress?.(`Đang tải dữ liệu bản đồ ${d}/${n}`));
  lastRaw = raw.pois.filter(p => p.name);
  onProgress?.('Đang tìm địa phận và khu công nghiệp…');
  const admin = await buildAdmin(raw.bounds, center, radiusKm, signal);
  const extra = [...await ovtJob, ...await vmJob];
  lastExtra = extra;
  const pois = buildPois(raw.pois, center, radiusKm, extra);
  const kcn = await kcnJob;
  for (const z of kcn) {
    // bỏ điểm KCN trùng tên lấy từ ô bản đồ, giữ bản có ranh giới (đo tới mép khu)
    for (let i = pois.length - 1; i >= 0; i--) {
      if (pois[i].cat === 'kcn' && (sameName(pois[i].name, z.name) || haversineKm(pois[i], z) < 0.3)) pois.splice(i, 1);
    }
    pois.push(z);
  }
  pois.sort((a, b) => a.km - b.km);
  return { pois, roads: buildRoads(raw.roads, center, radiusKm), admin };
}

// ---------- Khu công nghiệp ----------
// Ô bản đồ chỉ có vùng đất công nghiệp không tên, nên tìm KCN theo tên qua Photon (dữ liệu OSM),
// rồi lấy ranh khu từ Nominatim để đo khoảng cách tới mép khu gần nhà nhất.
const normKey = s => tidy(s).toLowerCase().normalize('NFC').replace(/^(khu công nghiệp|kcn|cụm công nghiệp|ccn|khu chế xuất|kcx)\s*/i, '');
const kcnCore = s => dkey(String(s).split(/\s*[-–,(]\s*/)[0]).replace(/^(khu cong nghiep|cum cong nghiep|khu che xuat|kcx)\s*/, '').replace(/\s*(binh chanh|quan|huyen|tp|thanh pho).*$/, '').trim();
const sameName = (a, b) => normKey(a) === normKey(b) || (kcnCore(a) && kcnCore(a) === kcnCore(b));
function prettyKcn(n) {
  return tidy(n).replace(/^kcn\s+/i, 'Khu công nghiệp ').replace(/^ccn\s+/i, 'Cụm công nghiệp ').replace(/^kcx\s+/i, 'Khu chế xuất ')
    .replace(/^(khu|cụm) công nghiệp/i, m => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase());
}
function ringsOf(geo) {
  if (!geo) return [];
  if (geo.type === 'Polygon') return [geo.coordinates[0]];
  if (geo.type === 'MultiPolygon') return geo.coordinates.map(p => p[0]);
  return [];
}
function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
async function findIndustrial(center, radiusKm, signal) {
  const F = localFrame(center);
  const reach = radiusKm * 1.25;
  const dLat = (reach + 3) / 110.57, dLng = (reach + 3) / (111.32 * Math.cos(center.lat * Math.PI / 180));
  const bbox = [center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat].map(v => v.toFixed(5)).join(',');
  const found = new Map();
  await Promise.all(['khu công nghiệp', 'cụm công nghiệp', 'khu chế xuất'].map(async q => {
    const T = withTimeout(9000, signal);
    try {
      const url = `${PHOTON}?q=${encodeURIComponent(q)}&lat=${center.lat.toFixed(3)}&lon=${center.lng.toFixed(3)}&limit=40&bbox=${bbox}`;
      const j = await (await fetch(url, { signal: T.signal })).json();
      for (const f of j.features || []) {
        const p = f.properties || {};
        const name = tidy(p.name);
        if (!KCN_NAME.test(name)) continue;
        if (!['landuse', 'industrial', 'place', 'boundary', 'man_made'].includes(p.osm_key)) continue;
        if (p.osm_key === 'man_made' && p.osm_value !== 'works') continue;
        const id = (p.osm_type || 'X') + p.osm_id;
        if (!found.has(id)) found.set(id, { id, name: prettyKcn(name), type: p.osm_type, osmId: p.osm_id, c: f.geometry?.coordinates, extent: p.extent });
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    } finally { T.done(); }
  }));
  if (!found.size) return [];
  // Ranh khu (đa giác) để đo tới mép khu
  const list = [...found.values()].slice(0, 20);
  const geos = new Map();
  const ids = list.filter(z => z.type === 'W' || z.type === 'R').map(z => z.type + z.osmId);
  if (ids.length) {
    try {
      const T = withTimeout(15000, signal);
      try {
        const res = await fetch(`/api/map/lookup?osm_ids=${ids.join(',')}`, { signal: T.signal });
        if (res.ok) for (const r of await res.json()) geos.set(r.osm_type.charAt(0).toUpperCase() + r.osm_id, r.geojson);
      } finally { T.done(); }
    } catch (e) { if (signal?.aborted) throw e; }
  }
  const out = [];
  for (const z of list) {
    let rings = ringsOf(geos.get(z.type + z.osmId)).map(r => r.map(([lng, lat]) => F.xy([lat, lng])));
    if (!rings.length && z.extent) {
      const [w, n, e, s] = z.extent;
      rings = [[[w, n], [e, n], [e, s], [w, s], [w, n]].map(([lng, lat]) => F.xy([lat, lng]))];
    }
    let near = null, cx = 0, cy = 0, cn = 0, inside = false;
    for (const ring of rings) {
      if (insideRing(0, 0, ring)) inside = true;
      for (let i = 1; i < ring.length; i++) {
        const q = segNearestXY(0, 0, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]);
        if (!near || q.d < near.d) near = q;
        cx += ring[i][0]; cy += ring[i][1]; cn++;
      }
    }
    if (!near) {
      if (!z.c) continue;
      const [x, y] = F.xy([z.c[1], z.c[0]]);
      near = { d: Math.hypot(x, y), x, y }; cx = x; cy = y; cn = 1;
    }
    cx /= cn; cy /= cn;
    const edgeKm = inside ? 0 : near.d;
    if (edgeKm > radiusKm * 1.02) continue;
    // Ghim đặt ngay trong mép khu phía căn nhà (lùi vào ~150 m) để đường đi và nhãn nằm đúng chỗ
    let px = near.x, py = near.y, step = 0;
    if (inside) { px = cx; py = cy; }
    else {
      const vx = cx - near.x, vy = cy - near.y, L = Math.hypot(vx, vy) || 1;
      step = Math.min(0.15, L * 0.3);
      px += vx / L * step; py += vy / L * step;
    }
    const [lat, lng] = F.ll(px, py);
    out.push({
      id: 'z' + z.type + z.osmId, name: z.name, cat: 'kcn', kind: 'industrial', lat, lng,
      km: Math.max(edgeKm, 0.05), zone: true, inside, inset: step,
    });
  }
  return out;
}

// ---------- Tìm một địa điểm theo tên (thêm điểm thủ công) ----------
let lastRaw = [];
let lastExtra = [];
const fold = s => tidy(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
export async function searchPlaces(q, center, signal) {
  const words = fold(q).split(' ').filter(w => w.length > 1);
  const local = [];
  // Tìm trong cả dữ liệu đã quét (OSM + Overture + Vietmap)
  for (const p of [...lastRaw, ...lastExtra.map(x => ({ ...x, cls: null, sub: x.kind }))]) {
    const f = fold(p.name);
    if (!words.every(w => f.includes(w))) continue;
    if (local.some(o => fold(o.name) === f && haversineKm(o, p) < 0.3)) continue;
    local.push({ name: p.name, lat: p.lat, lng: p.lng, km: haversineKm(center, p), where: 'gần căn nhà', key: p.cls, value: p.sub });
  }
  local.sort((a, b) => a.km - b.km);
  // Vietmap (dữ liệu địa điểm Việt Nam đầy đủ) chạy song song với Photon (OSM)
  const vmJob = (async () => {
    const T2 = withTimeout(12000, signal);
    try {
      const r = await fetch(`/api/map/vsearch?q=${encodeURIComponent(q)}&lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}`, { signal: T2.signal });
      const j = r.ok ? await r.json() : {};
      return (j.items || []).map(x => ({ name: tidy(x.name), lat: x.lat, lng: x.lng, km: haversineKm(center, x), where: x.address || '', key: null, value: null }));
    } catch { return []; } finally { T2.done(); }
  })();
  const T = withTimeout(9000, signal);
  let remote = [];
  try {
    const url = `${PHOTON}?q=${encodeURIComponent(q)}&lat=${center.lat}&lon=${center.lng}&limit=8&location_bias_scale=0.1&zoom=14`;
    const j = await (await fetch(url, { signal: T.signal })).json();
    remote = (j.features || []).map(f => {
      const p = f.properties || {};
      const [lng, lat] = f.geometry.coordinates;
      const where = [p.street, p.district, p.city, p.county, p.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ');
      return { name: tidy(p.name || p.street || q), lat, lng, km: haversineKm(center, { lat, lng }), where, key: p.osm_key, value: p.osm_value };
    }).filter(x => x.name && !(x.key === 'highway' && /bus_stop|platform|street|residential|service/.test(x.value || '')));
  } catch (e) {
    if (signal?.aborted) throw e;
    if (!local.length && !(await vmJob).length) throw e;
  } finally { T.done(); }
  const vm = await vmJob;
  const out = local.slice(0, 5);
  for (const r of [...vm, ...remote]) if (!out.some(o => fold(o.name) === fold(r.name) && haversineKm(o, r) < 0.25)) out.push(r);
  return out;
}

// Gợi ý nhóm cho điểm tìm được
export function guessCategory(x) {
  const fake = { cls: x.key, sub: x.value, name: x.name };
  if (x.key === 'landuse' && x.value === 'industrial') return 'kcn';
  if (x.key === 'aeroway' || /^(sân bay|cảng hàng không)/i.test(x.name)) return 'giaothong';
  if (/^(khu đô thị|kđt\b|vinhomes|ecopark|khu dân cư)/i.test(x.name)) return 'khudothi';
  if (/^(bãi biển|bãi tắm|trạm sạc|cây xăng|cửa hàng xăng dầu|thư viện|rạp)/i.test(x.name) || ['beach', 'charging_station', 'fuel'].includes(x.value)) return 'congcong';
  return classifyPoi(fake) || (KCN_NAME.test(x.name) ? 'kcn' : /trường|mầm non|đại học/i.test(x.name) ? 'truong'
    : /bệnh viện|phòng khám|trạm y tế/i.test(x.name) ? 'yte' : /chợ|siêu thị|trung tâm thương mại/i.test(x.name) ? 'cho' : 'congvien');
}

// Chọn sẵn tiện ích tiêu biểu: gần nhất mỗi nhóm, ưu tiên bệnh viện hơn phòng khám
export function autoPick(pois, max = 6) {
  const picked = [];
  const byCat = {};
  for (const p of pois) (byCat[p.cat] ||= []).push(p);
  // Khu công nghiệp là điểm cộng lớn với nhà đất vùng ven (thuê trọ, công nhân): ưu tiên trước hành chính, công viên
  const order = ['truong', 'yte', 'cho', 'kcn', 'khudothi', 'hanhchinh', 'congvien'];
  for (const c of order) {
    const arr = byCat[c];
    if (!arr?.length || picked.length >= max) continue;
    if (c === 'giaothong' || c === 'nganhang' || c === 'congcong') continue;
    let best = arr[0];
    if (c === 'yte') best = arr.find(p => p.kind === 'hospital') || arr[0];
    if (c === 'cho') best = arr.find(p => p.kind === 'marketplace' && p.km <= Math.max(1.5, arr[0].km * 1.5)) || arr[0];
    picked.push(best.id);
  }
  for (const c of ['truong', 'cho', 'yte']) {
    for (const p of byCat[c] || []) {
      if (picked.length >= max) break;
      if (!picked.includes(p.id)) { picked.push(p.id); break; }
    }
  }
  return picked;
}

// Đường đi thật bằng ô tô (Vietmap, dự phòng OSRM) qua máy chủ của app. Không có đường thì trả null.
export async function routeTo(from, to, signal) {
  const T = withTimeout(20000, signal);
  try {
    const q = `flat=${from.lat.toFixed(6)}&flng=${from.lng.toFixed(6)}&tlat=${to.lat.toFixed(6)}&tlng=${to.lng.toFixed(6)}`;
    const res = await fetch('/api/map/route?' + q, { signal: T.signal });
    if (!res.ok) return null;
    const r = (await res.json()).route;
    if (!r || !r.coords?.length) return null;
    const straight = haversineKm(from, to);
    if (r.km > Math.max(2.4 * straight, straight + 0.9) && r.km - straight > 0.6) return null;
    return { km: r.km, min: r.min, coords: [[from.lat, from.lng], ...r.coords, [to.lat, to.lng]] };
  } catch {
    return null;
  } finally { T.done(); }
}
