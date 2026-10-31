// Dữ liệu bản đồ cho video vị trí.
// Tiện ích, trục đường lớn, ranh tỉnh/thành: vector tiles OpenFreeMap (dữ liệu OpenStreetMap,
// miễn phí, không cần key, phục vụ qua CDN nên nhanh và ổn định).
// Tên xã/phường, tỉnh/thành và đường đi thật: Vietmap qua /api/map (dự phòng Nominatim, OSRM).
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { haversineKm, project, unproject } from './geo.js';
import { HUBS } from './hubs.js';

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
const tidy = s => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
// Tên bị lặp bản không dấu phía sau ("Công An Tỉnh Đắk Lắk Cong An Tinh Dak Lak") → giữ bản có dấu.
// Tên viết thường chữ đầu ("lê Lợi") → viết hoa chữ đầu.
function cleanName(s) {
  let n = tidy(s);
  const w = n.split(' ');
  if (w.length >= 4 && w.length % 2 === 0) {
    const h = w.length / 2;
    const plain = x => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    if (plain(w.slice(0, h).join(' ')) === plain(w.slice(h).join(' '))) n = w.slice(0, h).join(' ');
  }
  return n.replace(/^\p{Ll}/u, c => c.toUpperCase());
}

// Toạ độ phẳng cục bộ (km) quanh một điểm gốc, để đo khoảng cách nhanh
export function localFrame(c) {
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

// Cấp đường: 3 cao tốc · 2 quốc lộ · 1 tỉnh lộ/đường chính · 0 đường dân sinh (tertiary, đường nhỏ có tên).
// Đường dân sinh chỉ vào danh sách khi gần nhà (điểm xếp hạng bị phạt), để vùng quê/ven đô vẫn có trục đường để chỉ.
const ROAD_CLASSES = { motorway: 3, trunk: 2, primary: 1, secondary: 1, tertiary: 0, minor: 0 };

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
      res.pois.push({ cls: pr.class, sub: pr.subclass, name: cleanName(pr['name:vi'] || pr.name), lat, lng });
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
      if (level == null || f.type !== 2) continue;
      if (pr.class === 'minor' && !pr.name) continue; // đường nhỏ không tên: bỏ
      for (const line of f.loadGeometry()) {
        for (const piece of clipLine(line, 0, tn.extent)) {
          res.roads.push({ level, cls: pr.class, name: cleanName(pr['name:vi'] || pr.name), ref: tidy(pr.ref), pts: piece.map(p => conv(p, tn.extent)) });
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
      .map(x => ({ name: cleanName(x.name), cat: x.cat, kind: x.kind || x.cat, lat: x.lat, lng: x.lng, src: 'vm', address: x.address || '' }));
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
      if (cat) out.push({ name: cleanName(name), cat, kind: OVT_KIND[k] || cat, lat, lng, src: 'ovt' });
    }
  }
  return out;
}
// Khoá so trùng tên: bỏ dấu, bỏ ký tự đặc biệt, viết đầy đủ các chữ tắt hay gặp
const DKEY_ABBR = [[/^truong\s+/, ''], [/\bmau giao\b/g, 'mam non'], [/\bttyt\b/g, 'trung tam y te'], [/\bthcs\b/g, 'trung hoc co so'], [/\bthpt\b/g, 'trung hoc pho thong'], [/\bmn\b/g, 'mam non'], [/\bth\b/g, 'tieu hoc'], [/\bbv\b/g, 'benh vien'], [/\bubnd\b/g, 'uy ban nhan dan'], [/\bkcn\b/g, 'khu cong nghiep'], [/\bccn\b/g, 'cum cong nghiep']];
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

// Lọc tiện ích sai (khách báo "quét sai tiện ích"): dữ liệu cộng đồng hay gắn nhầm nhóm theo tên,
// vd. "Bệnh viện máy ảnh" thành bệnh viện, "Techcombank Bưu điện" thành hành chính, cửa hàng "Siêu thị điện thoại" thành chợ.
const SHOP_JUNK = /(máy ảnh|điện thoại|đtdđ|di động|laptop|máy tính|vi tính|xe máy|ô tô|\boto\b|thú y|thú cưng|pet\b|cây cảnh|đồng hồ|điện lạnh|điện tử|\bsim\b|phụ kiện|mắt kính|kính mắt|in ấn|photo)/i;
const CHO_JUNK = /(lạc xoong|gia dụng|văn hóa phẩm|văn hoá phẩm|siêu thị văn hó|siêu thị văn ho|nội thất|thời trang|giày|dép|mỹ phẩm|sữa|mẹ và bé|thuốc|vật liệu|vật tư|đồ chơi|nhà hàng|\bquán\b|lẩu|nướng|hải sản|quần áo|tóc|nail|spa\b|điện máy|sách|xe đạp|sơn\b|gạch|sắt thép|bia|rượu|trái cây|hoa tươi|online|sỉ\b|kho\b)/i;
const YTE_OK = /(bệnh viện|phòng khám|trạm y tế|trung tâm y tế|ttyt|nha khoa|bệnh xá|đa khoa|hospital|clinic|y tế|nhi đồng|phụ sản|sản nhi|chẩn đoán|xét nghiệm|medic)/i;
const GOV_OK = /(ủy ban|uỷ ban|ubnd|công an|bưu điện|bưu cục|kho bạc|tòa án|toà án|viện kiểm sát|tỉnh ủy|tỉnh uỷ|huyện ủy|huyện uỷ|thành ủy|thành uỷ|quận ủy|đảng ủy|đảng uỷ|chi cục|cục thuế|bảo hiểm xã hội|hành chính|mặt trận|hội đồng nhân dân|văn phòng đăng ký|sở\s|phòng giáo dục|post)/i;
const BANK_NAME = /(ngân hàng|\bbank\b|bank\b|agribank|vietcombank|vietinbank|techcombank|sacombank|bidv|acb\b|mb\b|vpbank|tpbank|hdbank|shb\b|ocb\b|eximbank|seabank|vib\b|abbank|lpbank|kienlongbank|namabank|pvcombank|baovietbank|scb\b|msb\b|bac a bank|bắc á)/i;
const BANK_JUNK = /(vay vốn|vay tiền|dịch vụ ngân hàng|cầm đồ|tín dụng|đáo hạn|hỗ trợ vay|tư vấn|bảo hiểm nhân thọ)/i;
const SCHOOL_JUNK = /(^(học sinh|phụ huynh|cổng|căn tin|nhà xe|bãi xe)\b|gia sư|ngoại ngữ|luyện thi|dạy kèm|học thêm|tiếng anh|english|lái xe|tin học|năng khiếu múa|đàn|vẽ)/i;
const PARK_JUNK = /(cà phê|cafe|coffee|quán|nhà hàng|karaoke|bida|billiard)/i;
// Trả về nhóm đúng (có thể đổi nhóm), hoặc null nếu nên bỏ. osm = điểm có thẻ phân loại rõ của OpenStreetMap
function vetPoi(name, cat, osm) {
  const n = String(name || '').normalize('NFC').trim();
  // Tên chỉ là tên loại, không có tên riêng ("Công Viên", "Ủy Ban Nhân Dân", "Trạm Sạc") → không đọc được, bỏ
  if (/^(công viên|trạm sạc|trạm sạc điện|ủy ban nhân dân|uỷ ban nhân dân|ubnd|chợ|siêu thị|trường|trường học|bệnh viện|trạm y tế|ngân hàng|bưu điện|công an|nhà văn hóa|nhà văn hoá)( \d+\w?)?$/i.test(n)) return null;
  if (/^(trạm sạc|trụ sạc)|sạc (điện|xe)/i.test(n)) return 'congcong';
  if (cat !== 'nganhang' && cat !== 'kcn' && BANK_NAME.test(n) && !GOV_OK.test(n.replace(/bưu điện/i, ''))) return /atm|vay|tín dụng/i.test(n) ? null : 'nganhang';
  switch (cat) {
    case 'yte': if (SHOP_JUNK.test(n) || (!osm && !YTE_OK.test(n))) return null; break;
    case 'cho': if (CHO_JUNK.test(n) || SHOP_JUNK.test(n)) return null; break;
    case 'hanhchinh': if (!osm && !GOV_OK.test(n)) return null; break;
    case 'nganhang': if (BANK_JUNK.test(n) || (!osm && !BANK_NAME.test(n))) return null; break;
    case 'truong': if (SCHOOL_JUNK.test(n)) return null; break;
    case 'congvien': if (PARK_JUNK.test(n)) return null; break;
  }
  return cat;
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
    const cat = p.cat === 'kcn' || p.cat === 'giaothong' || p.cat === 'khudothi' ? p.cat : vetPoi(p.name, p.cat, false);
    if (!cat) continue;
    const kind = cat === p.cat ? p.kind : cat === 'congcong' ? 'charging_station' : cat;
    out.push({ id: (p.src === 'vm' ? 'v' : 'o') + Math.round(p.lat * 1e5) + '_' + Math.round(p.lng * 1e5), name: p.name, cat, kind: kindFix(p.name, cat, kind), lat: p.lat, lng: p.lng, km, src: p.src || 'ovt' });
  }
  for (const p of raw) {
    let cat = classifyPoi(p);
    if (!cat) continue;
    cat = cat === 'kcn' || cat === 'giaothong' || cat === 'khudothi' ? cat : vetPoi(p.name, cat, true);
    if (!cat) continue;
    // Khu thể thao OSM chỉ có tên riêng ("Hàng Dương", "Ngọc Lan") thường là sân nhỏ/quán: chỉ giữ khi tên nói rõ là gì
    if (cat === 'congvien' && p.sub === 'sports_centre' && !/(sân|thể thao|thể dục|tdtt|hồ bơi|bể bơi|nhà thi đấu|trung tâm|câu lạc bộ|clb|công viên|stadium|sport)/i.test(p.name)) continue;
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
      // Cùng tên y hệt, cùng nhóm cơ quan/trường/y tế: một nơi dù hai nguồn đặt lệch vị trí tới 800 m
      if (fk === fp && k.cat === p.cat && ['hanhchinh', 'truong', 'yte'].includes(p.cat) && fp.split(' ').length >= 3) return haversineKm(k, p) < 0.8;
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
        // 0,12 km: hai làn tách nhau qua dải phân cách/kênh (vd. Võ Văn Kiệt) vẫn tính là một tuyến, chỉ vẽ một line
        if (segNearestXY(px, py, k.xy[j - 1][0], k.xy[j - 1][1], k.xy[j][0], k.xy[j][1]).d < 0.12) { hit = true; break; }
      }
      if (hit) { near++; break; }
    }
  }
  return n > 0 && near / n > 0.6;
}

// Cắt bỏ phần của chuỗi nằm sát (< 0,12 km) các chuỗi đã giữ, trả các phần còn lại { pts, xy }
function trimNearKept(chain, kept) {
  const out = [];
  let cur = null;
  for (let i = 0; i < chain.xy.length; i++) {
    const [px, py] = chain.xy[i];
    let near = false;
    for (const k of kept) {
      for (let j = 1; j < k.xy.length; j++) {
        if (segNearestXY(px, py, k.xy[j - 1][0], k.xy[j - 1][1], k.xy[j][0], k.xy[j][1]).d < 0.12) { near = true; break; }
      }
      if (near) break;
    }
    if (near) { if (cur && cur.pts.length > 1) out.push(cur); cur = null; continue; }
    if (!cur) cur = { pts: [], xy: [] };
    cur.pts.push(chain.pts[i]); cur.xy.push(chain.xy[i]);
  }
  if (cur && cur.pts.length > 1) out.push(cur);
  return out;
}

// Nối các đoạn của cùng một tuyến bị hở (thiếu cầu, nút giao, đoạn chưa có tên trên OSM) để line không đứt quãng:
// hai đầu mút cách nhau dưới gapKm và hướng đi thuận nhau thì ghép thành một đường liền.
// 24/10 (Giang báo line điểm nhấn đứt đoạn): đo trên 2 căn thực tế còn hở 0,12–0,44 km chưa nối vì
// hướng đầu mút lấy theo 3 điểm cuối (hay bị cong ở nút giao) và ngưỡng 0,3 km → lấy hướng theo đoạn ~0,3 km
// cuối, nới ngưỡng 0,6 km. Xuất ra để app nối lại cả các căn đã quét/lưu trước đây (không cần quét lại).
export function stitchWays(ways, F, gapKm = 0.6) {
  if (!F) return ways;
  let list = ways.map(w => ({ pts: w, xy: w.map(F.xy) }));
  const dirAt = (xy, end) => {
    const n = xy.length;
    const a = end ? xy[n - 1] : xy[0];
    let b = end ? xy[Math.max(0, n - 2)] : xy[Math.min(n - 1, 1)];
    for (let k = 1; k < n; k++) {
      const q = end ? xy[n - 1 - k] : xy[k];
      b = q;
      if (Math.hypot(a[0] - q[0], a[1] - q[1]) >= 0.3) break; // nhìn lùi ~0,3 km, bỏ qua móc cong ở đầu mút
    }
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
        // hở ngắn (< 0,25 km) chỉ cần đi tiếp gần cùng hướng; hở dài hơn phải thẳng hàng rõ ràng
        // cao tốc (gapKm lớn): hở 0,6–3 km do dữ liệu thưa chỉ nối khi gần như thẳng hàng
        const lim = d < 0.25 ? 0.3 : d < 0.6 ? 0.6 : 0.88;
        const ok = d < 0.04 || (da[0] * c[0] + da[1] * c[1] > lim && -(db[0] * c[0] + db[1] * c[1]) > lim);
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

// 24/10 (Giang cho phép): sau khi nối thông thường, còn chỗ hở thì VẼ NỐI TIẾP bằng đoạn thẳng giữa hai đầu mút gần nhau nhất
// (≤ maxKm), chỉ nối đầu với đầu (không tạo nhánh), không nối hai đầu đang quay lưng hẳn vào nhau → một line liền, không khoảng trống.
export function bridgeWays(ways, F, maxKm = 1.5) {
  if (!F || !ways || ways.length < 2) return ways;
  let list = ways.map(w => ({ pts: w, xy: w.map(F.xy) }));
  const dirAt = (xy, end) => {
    const n = xy.length, a = end ? xy[n - 1] : xy[0];
    let b = end ? xy[Math.max(0, n - 2)] : xy[Math.min(n - 1, 1)];
    for (let k = 1; k < n; k++) { const q = end ? xy[n - 1 - k] : xy[k]; b = q; if (Math.hypot(a[0] - q[0], a[1] - q[1]) >= 1.0) break; } // nhìn lùi ~1 km: bỏ qua móc cong ở đầu mút
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return [(a[0] - b[0]) / d, (a[1] - b[1]) / d];
  };
  for (let guard = 0; guard < 40 && list.length > 1; guard++) {
    let best = null;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      for (const ei of [true, false]) for (const ej of [true, false]) {
        const A = list[i].xy, B = list[j].xy;
        const pa = ei ? A[A.length - 1] : A[0], pb = ej ? B[B.length - 1] : B[0];
        const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        if (d > maxKm) continue;
        if (d > 0.05) {
          const c = [(pb[0] - pa[0]) / d, (pb[1] - pa[1]) / d];
          const da = dirAt(A, ei), db = dirAt(B, ej);
          const lim = d < 0.5 ? -0.6 : -0.2; // hở ngắn: nối gần như mọi hướng, chỉ bỏ khi hai đầu quay lưng hẳn
          if (da[0] * c[0] + da[1] * c[1] < lim || -(db[0] * c[0] + db[1] * c[1]) < lim) continue;
        }
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
  // Đầu mút nằm sát GIỮA một đoạn khác (ngã ba chữ T, thiếu một mẩu nối ≤ 0,3 km): kéo dài tới điểm gần nhất trên đoạn đó
  for (let a = 0; a < list.length; a++) {
    for (const atEnd of [false, true]) {
      const A = list[a];
      const p = atEnd ? A.xy[A.xy.length - 1] : A.xy[0];
      let best = null;
      for (let b = 0; b < list.length; b++) {
        if (b === a) continue;
        const B = list[b].xy;
        for (let k = 1; k < B.length; k++) {
          const q = segNearestXY(p[0], p[1], B[k - 1][0], B[k - 1][1], B[k][0], B[k][1]);
          if (!best || q.d < best.d) best = q;
        }
      }
      if (!best || best.d < 0.005 || best.d > 0.3) continue;
      const ll = F.ll(best.x, best.y);
      if (atEnd) { A.pts = [...A.pts, ll]; A.xy = [...A.xy, [best.x, best.y]]; }
      else { A.pts = [ll, ...A.pts]; A.xy = [[best.x, best.y], ...A.xy]; }
    }
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
    if (!g) { g = { key, level: r.level, minor: true, refs: {}, names: {}, pieces: [] }; groups.set(key, g); }
    if (r.cls !== 'minor') g.minor = false;
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
      .filter(c => c.len > 0.06) // đoạn ngắn (cầu, nút giao) giữ lại để lấp chỗ hở, trước đây > 0,25 km nên line đứt
      .sort((a, b) => a.near - b.near);
    if (!chains.length) continue;
    // Bắt đầu từ đoạn gần nhà nhất, rồi nối dần các đoạn TIẾP NỐI (đầu mút cách phần đã giữ < 0,6 km), tối đa 10 đoạn.
    // Đoạn chạy song song sát phần đã giữ (làn thứ hai của đường tách làn) bị cắt bỏ phần song song → không vẽ 2 line.
    // Đường trùng tên ở khu khác (vd. "Đường số 1") không nối vào vì không tiếp nối.
    if (chains[0].near > radiusKm) continue;
    const kept = [chains[0]];
    const rest = chains.slice(1);
    const endsOf = c => [c.xy[0], c.xy[c.xy.length - 1]];
    const touches = c => {
      for (const e of endsOf(c)) for (const k of kept) {
        for (const q of endsOf(k)) if (Math.hypot(e[0] - q[0], e[1] - q[1]) < 0.6) return true;
        for (let j = 1; j < k.xy.length; j++) if (segNearestXY(e[0], e[1], k.xy[j - 1][0], k.xy[j - 1][1], k.xy[j][0], k.xy[j][1]).d < 0.08) return true;
      }
      return false;
    };
    for (let grew = true; grew && kept.length < 10;) {
      grew = false;
      for (let i = 0; i < rest.length && kept.length < 10; i++) {
        const c = rest[i];
        if (!touches(c)) continue;
        rest.splice(i--, 1);
        grew = true;
        if (isDuplicate(c, kept)) continue;
        for (const part of trimNearKept(c, kept)) if (polyLenKm(part.pts) > 0.06) kept.push(part);
      }
    }
    if (!kept.length) continue;
    const ways = [];
    for (const c of kept) {
      for (const part of clipToRadius(c.pts, center, radiusKm * 1.6)) {
        if (polyLenKm(part) > 0.06) ways.push(simplify(part, F, 0.004));
      }
    }
    if (!ways.length) continue;
    const joined = stitchWays(ways, F, g.level >= 3 ? 3 : 0.6);
    ways.length = 0; ways.push(...joined);
    const ref = Object.entries(g.refs).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const name = Object.entries(g.names).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const label = roadLabelOf(g.level, ref, name);
    const alt = name && prettyName(name) !== label ? prettyName(name) : '';
    const near = nearestOnWays(center, ways);
    const lenKm = ways.reduce((s, w) => s + polyLenKm(w), 0);
    if (lenKm < 0.4) continue;
    // Đường dân sinh: phải gần nhà và đủ dài mới đáng gọi là trục đường (đường nhỏ chỉ có tên: gần hơn, dài hơn)
    if (g.level === 0 && (near.d > (g.minor ? 0.5 : 1.5) || lenKm < (g.minor ? 0.8 : 0.6))) continue;
    list.push({
      id: 'r' + g.key.replace(/[^a-z0-9]/gi, '').slice(0, 24) + Math.round(near.d * 1000),
      key: g.key, label, alt, ref, name, level: g.level, ways, nearKm: near.d, lenKm,
      score: g.level === 0 ? near.d * 3 + 0.4 : near.d / (1 + 0.6 * (g.level - 1)),
    });
  }
  // Cùng nhãn (vd. hai nhóm cùng là Quốc lộ 1A) thì gộp
  const byLabel = new Map();
  for (const r of list.sort((a, b) => a.score - b.score)) {
    const k = r.label.toLowerCase();
    const prev = byLabel.get(k);
    if (prev) {
      // Hai nhóm cùng tên thường là hai làn của cùng một đường (tách bởi dải phân cách/kênh): bỏ làn song song trùng
      const Fc = localFrame(center);
      const kept = prev.ways.map(w => ({ xy: w.map(Fc.xy) }));
      const add = r.ways.filter(w => !isDuplicate({ xy: w.map(Fc.xy) }, kept));
      if (add.length) prev.ways = stitchWays([...prev.ways, ...add], Fc, r.level >= 3 ? 3 : 0.6);
      prev.lenKm += add.reduce((t, w) => t + polyLenKm(w), 0);
      continue;
    }
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
        // Ranh cả tỉnh/thành bên kia (để làm sáng cả vùng bên kia ở cảnh qua ranh). Lỗi thì bỏ qua, vẫn vẽ đường ranh như cũ
        const across = await loadAdminArea({ lat: alat, lng: alng }, signal).catch(e => { if (signal?.aborted) throw e; return null; });
        if (across?.province?.rings?.length) { boundary.rings = across.province.rings; boundary.areaName = across.province.name || name; }
      }
    }
  }
  return { province, provinceShort: shortProvince(province), commune, boundary };
}

// ---------- Đường quanh nhà (hẻm, đường nội bộ, đường nhỏ) ----------
// Lấy từ ô bản đồ chứa căn nhà, chỉ giữ đoạn trong ~350 m để vẽ kiểu đường nhựa ở cảnh giới thiệu căn nhà.
const STREET_W = { motorway: 22, trunk: 18, primary: 14, secondary: 11, tertiary: 9, minor: 6.5, service: 4.5, track: 3.5 };
export async function loadStreets(center, signal, maxKm = 0.35) {
  const tpl = await tileTemplate(signal);
  const z = 14;
  const F = localFrame(center);
  const dLat = maxKm / 111.32, dLng = maxKm / (111.32 * Math.cos(center.lat * Math.PI / 180));
  const a = project(center.lat + dLat, center.lng - dLng, z), b = project(center.lat - dLat, center.lng + dLng, z);
  const jobs = [];
  for (let x = Math.floor(a.x / 256); x <= Math.floor(b.x / 256); x++) for (let y = Math.floor(a.y / 256); y <= Math.floor(b.y / 256); y++) jobs.push([x, y]);
  const out = [];
  await Promise.all(jobs.map(async ([x, y]) => {
    const buf = await fetchTile(tpl, z, x, y, signal).catch(() => null);
    if (!buf) return;
    const t = new VectorTile(new Pbf(buf));
    const conv = (pt, ext) => { const ll = unproject((x + pt.x / ext) * 256, (y + pt.y / ext) * 256, z); return [ll.lat, ll.lng]; };
    for (const [layer, named] of [['transportation', false], ['transportation_name', true]]) {
      const L = t.layers[layer];
      if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const f = L.feature(i);
        if (f.type !== 2) continue;
        const pr = f.properties;
        const w = STREET_W[pr.class];
        if (!w || pr.brunnel === 'tunnel') continue;
        if (named && !pr.name) continue;
        for (const line of f.loadGeometry()) {
          for (const piece of clipLine(line, 0, L.extent)) {
            const pts = piece.map(q => conv(q, L.extent));
            let cur = [];
            const flush = () => { if (cur.length > 1) out.push({ cls: pr.class, w, name: named ? tidy(pr['name:vi'] || pr.name) : '', pts: cur }); cur = []; };
            for (const p of pts) {
              const q = F.xy(p);
              if (Math.hypot(q[0], q[1]) <= maxKm) cur.push(p); else flush();
            }
            flush();
          }
        }
      }
    }
  }));
  const lines = out.filter(r => !r.name).map(r => ({ cls: r.cls, w: r.w, pts: r.pts.map(p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]) }));
  const named = out.filter(r => r.name);
  // Đường có tên gần nhà nhất = đường trước nhà
  let front = null;
  for (const r of named) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const A = F.xy(r.pts[i]), B = F.xy(r.pts[i + 1]);
      const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1e-12;
      const k = Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / L2));
      const px = A[0] + dx * k, py = A[1] + dy * k, d = Math.hypot(px, py);
      if (!front || d < front.km) {
        const ll = F.ll(px, py);
        front = { name: r.name, km: d, at: { lat: ll[0], lng: ll[1] }, a: r.pts[i], b: r.pts[i + 1], cls: r.cls, w: r.w, _r: r };
      }
    }
  }
  // Đoạn đường trước nhà (trong ~160 m quanh nhà) để đánh dấu sáng trong video
  if (front) {
    const seg = [];
    for (const p of front._r.pts) {
      const q = F.xy(p);
      if (Math.hypot(q[0], q[1]) <= 0.16) seg.push([Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]);
    }
    front.pts = seg.length >= 2 ? seg : [front.a, front.b];
    delete front._r;
  }
  return { lines: lines.slice(0, 400), front: front && front.km < 0.12 ? front : null };
}

// Ranh xã/phường + tỉnh chứa căn nhà (máy chủ /api/map/area). Lỗi thì bỏ qua, video vẫn dựng như cũ.
export async function loadAdminArea(center, signal) {
  const T = withTimeout(20000, signal);
  try {
    const r = await fetch(`/api/map/area?lat=${center.lat.toFixed(5)}&lng=${center.lng.toFixed(5)}`, { signal: T.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j.ward || j.province ? j : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  } finally { T.done(); }
}

// ---------- Quét toàn bộ ----------
// Cao tốc gần nhất kể cả ngoài bán kính quét (tới 25 km): lên cao tốc là điểm cộng lớn, luôn nên có trong video
export async function findExpressway(center, signal) {
  const tpl = await tileTemplate(signal);
  const z = 11, R = 15; // quá 15 km thì không còn là điểm cộng
  const dLat = R / 111.32, dLng = R / (111.32 * Math.cos(center.lat * Math.PI / 180));
  const a = project(center.lat + dLat, center.lng - dLng, z), b = project(center.lat - dLat, center.lng + dLng, z);
  const jobs = [];
  for (let x = Math.floor(a.x / 256); x <= Math.floor(b.x / 256); x++) for (let y = Math.floor(a.y / 256); y <= Math.floor(b.y / 256); y++) jobs.push([x, y]);
  const raw = [];
  await Promise.all(jobs.map(async ([x, y]) => {
    const buf = await fetchTile(tpl, z, x, y, signal);
    if (buf) raw.push(...decodeTile(buf, z, x, y).roads.filter(r => r.level === 3));
  }));
  if (!raw.length) return null;
  const list = buildRoads(raw, center, R);
  const best = list.filter(r => r.level === 3).sort((p, q) => p.nearKm - q.nearKm)[0];
  return best ? { ...best, far: true } : null;
}

export async function scanArea(center, radiusKm, signal, onProgress) {
  const streetJob = loadStreets(center, signal).catch(e => { if (signal?.aborted) throw e; return null; });
  const areaJob = loadAdminArea(center, signal).catch(e => { if (signal?.aborted) throw e; return null; });
  const kcnJob = findIndustrial(center, radiusKm, signal).catch(e => { if (signal?.aborted) throw e; return []; });
  const ovtJob = loadOverture(center, radiusKm, signal).catch(e => { if (signal?.aborted) throw e; return []; });
  const vmJob = loadVietmap(center, radiusKm, signal).catch(e => { if (signal?.aborted) throw e; return []; });
  const ctJob = findExpressway(center, signal).catch(e => { if (signal?.aborted) throw e; return null; });
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
  const roads = buildRoads(raw.roads, center, radiusKm);
  // Trong bán kính chưa có cao tốc: tìm cao tốc gần nhất tới 25 km rồi thêm vào cuối danh sách
  if (!roads.some(r => r.level === 3)) {
    const ct = await ctJob;
    if (ct && !roads.some(r => r.label.toLowerCase() === ct.label.toLowerCase())) roads.push(ct);
  }
  return { pois, roads, admin, streets: await streetJob, area: await areaJob };
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

// Địa điểm có tên quanh 1 chỗ khách chạm trên bản đồ (thêm tiện ích app chưa quét được).
// Nguồn: ô bản đồ OSM z14 (TẤT CẢ điểm có tên — quét căn chỉ giữ các nhóm tiện ích chính) + Overture (poi/, tệp tĩnh).
// Gần như không ra gì thì hỏi thêm Vietmap (/api/map/nearby bán kính 0,5 km, có nhớ đệm) — tốn lượt gọi Vietmap nên chỉ khi cần.
// (Vietmap Reverse v3 đã thử 26/10: chỉ trả 1 địa chỉ số nhà, không có tên tiện ích → không dùng.)
export async function placesNear(ll, km = 0.3, signal) {
  const [area, ovt] = await Promise.all([
    loadArea(ll, km, signal).catch(e => { if (signal?.aborted) throw e; return { pois: [] }; }),
    loadOverture(ll, km, signal).catch(e => { if (signal?.aborted) throw e; return []; }),
  ]);
  const list = [
    ...area.pois.filter(p => p.name && p.cls !== 'place').map(p => ({ name: p.name, lat: p.lat, lng: p.lng, cat: guessCategory({ key: p.cls, value: p.sub, name: p.name }), src: 'osm' })),
    ...ovt.map(p => ({ name: p.name, lat: p.lat, lng: p.lng, cat: p.cat, src: 'ovt' })),
  ].filter(p => haversineKm(p, ll) <= km);
  // Bỏ tên đường/địa chỉ (khách cần tên tiện ích; đường đã có mục "Tự vẽ đường")
  const roadNames = new Set((area.roads || []).map(r => dkey(r.name || '')).filter(Boolean));
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i].name;
    if (/^(\d|số\s*\d|đường\b|hẻm\b|kiệt\b|ngõ\b|ngách\b|quốc lộ\b|tỉnh lộ\b|đại lộ\b)/i.test(n) || roadNames.has(dkey(n))) list.splice(i, 1);
  }
  if (list.length < 3) {
    const vm = await loadVietmap(ll, 0.5, signal).catch(e => { if (signal?.aborted) throw e; return []; });
    for (const p of vm) if (haversineKm(p, ll) <= Math.max(km, 0.5)) list.push({ name: p.name, lat: p.lat, lng: p.lng, cat: p.cat, src: 'vm', where: p.address });
  }
  const out = [];
  for (const p of list.sort((a, b) => haversineKm(a, ll) - haversineKm(b, ll))) {
    const k = dkey(p.name);
    if (!k || out.some(o => dkey(o.name) === k && haversineKm(o, p) < 0.3)) continue;
    out.push(p);
  }
  return out.slice(0, 12);
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
// Chọn sẵn trục đường cho video/kịch bản: các trục lớn gần nhà (tới 2 km), đường dân sinh sát nhà, và cao tốc gần nhất.
// Trước đây chỉ lấy 3 tuyến đầu danh sách nên trục lớn cách nhà 1–2 km hay bị bỏ khỏi kịch bản.
export function autoPickRoads(roads, max = 4) {
  const byNear = [...roads].sort((a, b) => a.nearKm - b.nearKm);
  const pick = [];
  const add = r => { if (r && !pick.includes(r) && pick.length < max) pick.push(r); };
  for (const r of byNear) if (r.level >= 1 && r.level < 3 && r.nearKm <= 2 && pick.length < 3) add(r);
  if (pick.length < 3) for (const r of byNear) if (r.level === 0 && r.nearKm <= 0.3 && pick.length < 3) add(r);
  if (pick.length < 2) for (const r of byNear) if (r.level >= 1 && pick.length < 2) add(r);
  const ct = byNear.find(r => r.level === 3);
  if (ct && !pick.includes(ct)) { if (pick.length >= max) pick.pop(); add(ct); }
  if (!pick.length) for (const r of byNear.slice(0, 2)) add(r);
  return roads.filter(r => pick.includes(r)).map(r => r.id); // giữ thứ tự danh sách gốc
}

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
    if (c === 'yte') best = arr.find(p => p.kind === 'hospital' && /bệnh viện|hospital/i.test(p.name)) || arr.find(p => /trạm y tế|trung tâm y tế|đa khoa/i.test(p.name)) || arr[0];
    if (c === 'hanhchinh') best = arr.find(p => /ủy ban|uỷ ban|ubnd|công an/i.test(p.name) && p.km <= Math.max(1.2, arr[0].km * 2)) || arr[0];
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

// ---------- Kết nối vùng: điểm mốc lớn (trung tâm, sân bay, cảng, ga) ----------
// Chọn tối đa 6 điểm mốc theo khoảng cách chim bay; thời gian/đường đi thật do app gọi routeTo sau.
export function pickHubs(center, max = 5) {
  const all = HUBS.map(([type, name, lat, lng, tier]) => ({ type, name, lat, lng, tier: tier || 0, d: haversineKm(center, { lat, lng }) }))
    // ga metro sát nhà (≥ 150 m) vẫn lấy — đó là điểm đáng khoe nhất; điểm mốc khác dưới 600 m thì bỏ (trùng chỗ căn nhà)
    .filter(h => h.d >= (h.type === 'metro' ? 0.15 : 0.6)).sort((a, b) => a.d - b.d);
  // Thứ tự ưu tiên khi quá 5 điểm: trung tâm lớn → sân bay gần nhất → ga metro (≤ 4 km) → cảng → sân bay thứ 2 (≤ 60 km)
  // → trung tâm gần khác (tỉnh ≤ 30 km, đô thị cũ ≤ 12 km) → ga tàu (≤ 25 km)
  const out = [];
  const take = h => { if (h && !out.includes(h)) out.push(h); };
  const c1 = all.find(h => h.type === 'center' && h.tier === 1 && h.d <= 90) || all.find(h => h.type === 'center' && h.tier <= 2 && h.d <= 70);
  const air = all.filter(h => h.type === 'airport' && h.d <= 85);
  take(c1);
  take(air[0]);
  take(all.find(h => h.type === 'metro' && h.d <= 4));
  take(all.find(h => h.type === 'port' && h.d <= 40));
  if (air[1] && air[1].d <= 60) take(air[1]);
  take(all.find(h => h.type === 'center' && h !== c1 && (h.tier <= 2 ? h.d <= 30 : h.d <= 12) && (!c1 || haversineKm(h, c1) > 8)));
  take(all.find(h => h.type === 'station' && h.d <= 25));
  const ORDER = { center: 0, airport: 1, port: 2, metro: 3, station: 4 };
  return out.slice(0, max).sort((a, b) => ORDER[a.type] - ORDER[b.type] || a.d - b.d)
    .map(h => ({ id: h.type + ':' + h.name, type: h.type, name: h.name, lat: h.lat, lng: h.lng, km0: Math.round(h.d * 100) / 100 }));
}

// ---------- Hạ tầng đang thi công gần nhà (cao tốc, vành đai, cầu, đường lớn) ----------
// Lấy từ ô bản đồ OpenFreeMap (OpenStreetMap): lớp transportation_name, class "*_construction" (tuyến có tên/số hiệu).
// Dữ liệu cộng đồng, không phải quy hoạch chính thức → app ghi rõ nguồn và để khách tắt từng tuyến.
const INFRA_LEVEL = { motorway: 3, trunk: 2, primary: 1, secondary: 0 };
function infraLabel(names, ref) {
  const fix = s => tidy(s)
    .replace(/^Đường cao tốc/i, 'Cao tốc').replace(/^Dự án (đường )?/i, '').replace(/^Đường (?=(vành đai|cao tốc|song hành))/i, '')
    .replace(/\s*(Thành phố Hồ Chí Minh|TP\.? ?HCM|TPHCM|TP\.? Hồ Chí Minh)/gi, ' TP.HCM').replace(/Vành Đai/g, 'Vành đai')
    .replace(/\s+[-–]\s+/g, ' – ').replace(/\s+/g, ' ').trim().replace(/^\p{Ll}/u, c => c.toUpperCase());
  // Ưu tiên tên dự án (mở rộng, giai đoạn…), rồi tên nói rõ loại tuyến (cao tốc, vành đai…), rồi tên cầu/đoạn; cùng hạng thì tên ngắn
  const rank = n => (/(mở rộng|giai đoạn|nâng cấp)/i.test(n) ? 0 : /^(cao tốc|vành đai|quốc lộ|tỉnh lộ|đường|đại lộ|trục)/i.test(n) ? 1 : 2);
  const list = names.map(fix).filter(n => n && !/^cầu cạn$/i.test(n)).sort((a, b) => rank(a) - rank(b) || a.length - b.length);
  if (list[0] && rank(list[0]) === 2 && ref) return `${list[0]} (${ref})`;
  return list[0] || (ref ? 'Tuyến ' + ref : '');
}
export async function loadInfra(center, signal) {
  const tpl = await tileTemplate(signal);
  const F = localFrame(center);
  const groups = new Map();
  const scan = async (z, R, classes, onlyNew) => {
    const dLat = R / 111.32, dLng = R / (111.32 * Math.cos(center.lat * Math.PI / 180));
    const a = project(center.lat + dLat, center.lng - dLng, z), b = project(center.lat - dLat, center.lng + dLng, z);
    const jobs = [];
    for (let x = Math.floor(a.x / 256); x <= Math.floor(b.x / 256); x++) for (let y = Math.floor(a.y / 256); y <= Math.floor(b.y / 256); y++) jobs.push([x, y]);
    const found = [];
    await Promise.all(jobs.map(async ([x, y]) => {
      const buf = await fetchTile(tpl, z, x, y, signal).catch(e => { if (signal?.aborted) throw e; return null; });
      if (!buf) return;
      const t = new VectorTile(new Pbf(buf));
      const L = t.layers.transportation_name; // tên + hình tuyến (lớp transportation không có tên ở mức zoom này)
      if (!L) return;
      const conv = (pt, ext) => { const ll = unproject((x + pt.x / ext) * 256, (y + pt.y / ext) * 256, z); return [ll.lat, ll.lng]; };
      for (let i = 0; i < L.length; i++) {
        const f = L.feature(i);
        if (f.type !== 2) continue;
        const pr = f.properties;
        const m = /^(\w+)_construction$/.exec(pr.class || '');
        if (!m || !classes.includes(m[1])) continue;
        const name = tidy(pr['name:vi'] || pr.name || ''), ref = tidy(pr.ref || '');
        if (!name && !ref) continue;
        for (const line of f.loadGeometry()) for (const piece of clipLine(line, 0, L.extent)) {
          const pts = piece.map(q => conv(q, L.extent));
          if (pts.length > 1) found.push({ level: INFRA_LEVEL[m[1]], name, ref, pts });
        }
      }
    }));
    for (const r of found) {
      const key = r.ref ? 'ref:' + r.ref.toUpperCase().replace(/\s+/g, '') : 'n:' + r.name.toLowerCase().replace(/^(đường|dự án)\s+/, '');
      if (onlyNew && groups.has(key) && !groups.get(key).z12) continue;
      const g = groups.get(key) || { key, level: r.level, names: [], ref: r.ref, ways: [], z12: onlyNew };
      g.level = Math.max(g.level, r.level);
      if (r.name && !g.names.includes(r.name)) g.names.push(r.name);
      g.ways.push(r.pts);
      groups.set(key, g);
    }
  };
  await scan(11, 25, ['motorway', 'trunk', 'primary'], false);
  await scan(12, 8, ['trunk', 'primary', 'secondary'], true).catch(e => { if (signal?.aborted) throw e; });
  const out = [];
  for (const g of groups.values()) {
    let ways = stitchWays(g.ways, F, 0.8);
    // Chỉ giữ phần trong 35 km quanh nhà (đủ cho khung máy), đơn giản hoá cho nhẹ
    const keep = [];
    for (const w of ways) {
      let cur = [];
      for (const p of w) {
        const q = F.xy(p);
        if (Math.hypot(q[0], q[1]) <= 35) cur.push(p); else { if (cur.length > 1) keep.push(cur); cur = []; }
      }
      if (cur.length > 1) keep.push(cur);
    }
    ways = keep.map(w => simplify(w, F, 0.02).map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5])).filter(w => w.length > 1);
    let len = 0, best = null;
    for (const w of ways) for (let i = 1; i < w.length; i++) {
      const A = F.xy(w[i - 1]), B = F.xy(w[i]);
      len += Math.hypot(B[0] - A[0], B[1] - A[1]);
      const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1e-12;
      const k = Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / L2));
      const px = A[0] + dx * k, py = A[1] + dy * k, d = Math.hypot(px, py);
      if (!best || d < best.d) { const ll = F.ll(px, py); best = { d, lat: ll[0], lng: ll[1] }; }
    }
    if (!best || len < 0.5) continue;
    const lim = g.level >= 2 ? 25 : g.level === 1 ? 12 : 5;
    if (best.d > lim) continue;
    const label = infraLabel(g.names, g.ref);
    if (!label) continue;
    out.push({ id: g.key, label, ref: g.ref || '', level: g.level, nearKm: Math.round(best.d * 100) / 100, P: { lat: best.lat, lng: best.lng }, ways });
  }
  // Luôn có cao tốc/vành đai đang xây gần nhất (giá trị tiềm năng lớn nhất), còn lại: gần + cấp cao trước; tối đa 3 tuyến
  out.sort((a, b) => a.nearKm / (1 + a.level) - b.nearKm / (1 + b.level));
  const top = out.filter(r => r.level === 3).sort((a, b) => a.nearKm - b.nearKm)[0];
  return (top ? [top, ...out.filter(r => r !== top)] : out).slice(0, 3);
}

// Đơn giản hoá một đường [[lat, lng], …] (dùng cho đường đi dài tới điểm mốc vùng, cho nhẹ bộ nhớ)
export function simplifyLine(pts, tolKm = 0.015) {
  if (!pts || pts.length < 3) return pts;
  const F = localFrame({ lat: pts[0][0], lng: pts[0][1] });
  return simplify(pts, F, tolKm).map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
}

// ---------- Hiệu ứng điểm mốc (30/10, Giang): ranh + đường băng sân bay, tuyến metro quanh ga ----------
// Lấy từ ô bản đồ OpenFreeMap (OpenStreetMap). Sân bay: lớp aeroway class aerodrome (đa giác) + runway (đường) ở z11
// (một ô ~20 km, đủ chứa cả sân bay). Đa giác có thể bị cắt ở mép ô → mỗi mảnh lưu khung ô `bb` (tô màu trong khung đó)
// và các cạnh nằm trên mép ô `cut` (không vẽ viền ở đó). Metro: lớp transportation class transit (subway/light_rail)
// chỉ có ở z14 → lấy các ô trong 1,6 km quanh ga, nối thành tuyến, cắt trong 1,5 km.
function tilesAround(c, z, km) {
  const dLat = km / 111.32, dLng = km / (111.32 * Math.cos(c.lat * Math.PI / 180));
  const a = project(c.lat + dLat, c.lng - dLng, z), b = project(c.lat - dLat, c.lng + dLng, z);
  const out = [];
  for (let x = Math.floor(a.x / 256); x <= Math.floor(b.x / 256); x++) for (let y = Math.floor(a.y / 256); y <= Math.floor(b.y / 256); y++) out.push([x, y]);
  return out;
}
async function airportFx(a, tpl, signal) {
  const z = 11, F = localFrame(a);
  const parts = [], runways = new Map();
  await Promise.all(tilesAround(a, z, 4).map(async ([x, y]) => {
    const buf = await fetchTile(tpl, z, x, y, signal).catch(e => { if (signal?.aborted) throw e; return null; });
    if (!buf) return;
    const L = new VectorTile(new Pbf(buf)).layers.aeroway;
    if (!L) return;
    const ext = L.extent;
    const conv = pt => { const ll = unproject((x + pt.x / ext) * 256, (y + pt.y / ext) * 256, z); return [Math.round(ll.lat * 1e6) / 1e6, Math.round(ll.lng * 1e6) / 1e6]; };
    const n = unproject(x * 256, y * 256, z), s = unproject((x + 1) * 256, (y + 1) * 256, z);
    const bb = [n.lat, s.lat, n.lng, s.lng];
    const side = p => (p.x <= 0 ? 1 : p.x >= ext ? 2 : 0) | (p.y <= 0 ? 4 : p.y >= ext ? 8 : 0);
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i), cls = f.properties.class;
      if (cls === 'aerodrome' && f.type === 3) {
        for (const ring of f.loadGeometry()) {
          if (ring.length < 4) continue;
          const pts = ring.map(conv);
          // chỉ lấy sân bay chứa điểm mốc hoặc sát nó (≤ 3 km)
          const xy = pts.map(F.xy);
          let inside = false, dmin = Infinity;
          for (let j = 0, k = xy.length - 1; j < xy.length; k = j++) {
            const [xi, yi] = xy[j], [xk, yk] = xy[k];
            if ((yi > 0) !== (yk > 0) && 0 < (xk - xi) * (0 - yi) / (yk - yi) + xi) inside = !inside;
            dmin = Math.min(dmin, Math.hypot(xi, yi));
          }
          if (!inside && dmin > 3) continue;
          const cut = [];
          for (let j = 0; j + 1 < ring.length; j++) { const s1 = side(ring[j]), s2 = side(ring[j + 1]); if (s1 & s2) cut.push(j); }
          parts.push({ bb, pts, cut });
        }
      } else if (cls === 'runway' && f.type === 2) {
        const ref = f.properties.ref || 'rw' + i;
        const r = runways.get(ref) || [];
        for (const line of f.loadGeometry()) for (const q of line) if (q.x >= 0 && q.x <= ext && q.y >= 0 && q.y <= ext) r.push(conv(q));
        runways.set(ref, r);
      }
    }
  }));
  if (!parts.length) return null;
  // Đường băng dài nhất gần sân bay: 2 đầu = cặp điểm xa nhau nhất
  let best = null;
  for (const [ref, pts] of runways) {
    let A = null, B = null, d = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const dd = haversineKm({ lat: pts[i][0], lng: pts[i][1] }, { lat: pts[j][0], lng: pts[j][1] });
      if (dd > d) { d = dd; A = pts[i]; B = pts[j]; }
    }
    if (!A || d < 0.8) continue;
    const mid = { lat: (A[0] + B[0]) / 2, lng: (A[1] + B[1]) / 2 };
    if (haversineKm(a, mid) > 4) continue;
    if (!best || d > best.km) best = { ref, a: A, b: B, km: Math.round(d * 100) / 100 };
  }
  return { kind: 'airport', parts, runway: best };
}
async function metroFx(a, tpl, signal) {
  const z = 14, F = localFrame(a);
  const pieces = [];
  await Promise.all(tilesAround(a, z, 1.6).map(async ([x, y]) => {
    const buf = await fetchTile(tpl, z, x, y, signal).catch(e => { if (signal?.aborted) throw e; return null; });
    if (!buf) return;
    const L = new VectorTile(new Pbf(buf)).layers.transportation;
    if (!L) return;
    const ext = L.extent;
    const conv = pt => { const ll = unproject((x + pt.x / ext) * 256, (y + pt.y / ext) * 256, z); return [ll.lat, ll.lng]; };
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i), pr = f.properties;
      if (f.type !== 2 || pr.class !== 'transit' || !/^(subway|light_rail|monorail)$/.test(pr.subclass || '')) continue;
      for (const line of f.loadGeometry()) for (const piece of clipLine(line, 0, ext)) {
        const pts = piece.map(conv);
        if (pts.length > 1) pieces.push(pts);
      }
    }
  }));
  if (!pieces.length) return null;
  const chains = stitchWays(pieces, F, 0.08);
  let best = null;
  for (const c of chains) for (const part of clipToRadius(c, a, 1.5)) {
    const xy = part.map(F.xy);
    let d = Infinity, len = 0;
    for (let i = 1; i < xy.length; i++) {
      d = Math.min(d, segNearestXY(0, 0, xy[i - 1][0], xy[i - 1][1], xy[i][0], xy[i][1]).d);
      len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    }
    if (d > 0.35 || len < 0.6) continue;
    if (!best || d - len * 0.05 < best.d - best.len * 0.05) best = { d, len, pts: part };
  }
  if (!best) return null;
  const track = simplify(best.pts, F, 0.004).map(p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]);
  return { kind: 'metro', track };
}
export async function loadHubFx(anchor, signal) {
  const tpl = await tileTemplate(signal);
  if (anchor.type === 'airport') return airportFx(anchor, tpl, signal);
  if (anchor.type === 'metro') return metroFx(anchor, tpl, signal);
  return null;
}

// ---------- Khoanh vùng tiện ích quan trọng + sông/kênh gần nhà (30/10 tối, Giang; ĐANG DUYỆT, chỉ nội bộ) ----------
// Ranh lấy từ ô bản đồ OpenFreeMap z14: landuse (hospital, industrial, university, college, retail, commercial, stadium),
// landcover (park, recreation_ground, garden), water (river, lake, canal) + waterway (river, canal, kênh/rạch có tên).
// Đa giác bị cắt ở mép ô (có vùng đệm ngoài ô) → mỗi mảnh giữ khung ô `bb` (tô trong khung) + cạnh nằm trên mép ô `cuts`
// (không vẽ viền ở đó). Chỉ khoanh tiện ích QUAN TRỌNG (Giang 19:55): tiện ích gắn ★ trước, rồi bệnh viện, công viên,
// khu công nghiệp, đại học, trung tâm thương mại; tối đa 3 khu mỗi video.
const ZONE_RANK = { yte: 0, congvien: 1, kcn: 2, truong: 3, cho: 4 };
const ZONE_PARK = /^(park|recreation_ground|garden)$/;
const ZONE_TEST = {
  yte: c => c.l === 'hospital',
  congvien: c => (c.lc !== undefined && ZONE_PARK.test(c.sub)) || c.l === 'stadium',
  kcn: c => c.l === 'industrial',
  truong: c => c.l === 'university' || c.l === 'college',
  cho: c => c.l === 'retail' || c.l === 'commercial',
};
const ZONE_ANY = c => (c.l && !/^(residential|quarter|suburb|neighbourhood|military|cemetery|railway|garages|dam)$/.test(c.l)) || (c.lc !== undefined && ZONE_PARK.test(c.sub));
const TTTM_RE = /aeon|vincom|lotte|go!|big ?c|mega ?market|co\.?op|e-?mart|mall|plaza|trung tâm thương mại|tttm|siêu thị|giga/i;
const shapeCache = new Map();
function tileShapes(tpl, z, x, y, signal) {
  const key = z + '/' + x + '/' + y;
  if (shapeCache.has(key)) return shapeCache.get(key);
  const pr = (async () => {
    const out = { polys: [], lines: [], names: [] };
    const buf = await fetchTile(tpl, z, x, y, signal).catch(e => { if (signal?.aborted) throw e; return null; });
    if (!buf) return out;
    const T = new VectorTile(new Pbf(buf));
    const n = unproject(x * 256, y * 256, z), s = unproject((x + 1) * 256, (y + 1) * 256, z);
    const bb = [n.lat, s.lat, n.lng, s.lng];
    for (const name of ['landuse', 'landcover', 'water', 'waterway', 'water_name']) {
      const L = T.layers[name];
      if (!L) continue;
      const ext = L.extent;
      const conv = pt => { const ll = unproject((x + pt.x / ext) * 256, (y + pt.y / ext) * 256, z); return [Math.round(ll.lat * 1e6) / 1e6, Math.round(ll.lng * 1e6) / 1e6]; };
      const side = p => (p.x <= 0 ? 1 : p.x >= ext ? 2 : 0) | (p.y <= 0 ? 4 : p.y >= ext ? 8 : 0);
      for (let i = 0; i < L.length; i++) {
        const f = L.feature(i), p = f.properties;
        if (name === 'water_name') {
          if (p.name) for (const g of f.loadGeometry()) out.names.push({ name: String(p.name).normalize('NFC'), pts: g.map(conv) });
          continue;
        }
        if (name === 'waterway') {
          if (f.type !== 2 || !/^(river|canal|stream)$/.test(p.class)) continue;
          for (const line of f.loadGeometry()) if (line.length > 1) out.lines.push({ cls: p.class, name: String(p.name || '').normalize('NFC'), pts: line.map(conv), bb });
          continue;
        }
        if (f.type !== 3) continue;
        if (name === 'water' && !/^(river|lake|canal|ocean)$/.test(p.class)) continue;   // bỏ hồ bơi, ao
        if (name === 'landcover' && !ZONE_PARK.test(p.subclass || '')) continue;
        const cls = name === 'water' ? { w: p.class } : name === 'landcover' ? { lc: p.class, sub: p.subclass || '' } : { l: p.class };
        const rings = [], cuts = [];
        for (const ring of f.loadGeometry()) {
          if (ring.length < 4) continue;
          rings.push(ring.map(conv));
          const c = [];
          for (let j = 0; j + 1 < ring.length; j++) if (side(ring[j]) & side(ring[j + 1])) c.push(j);
          cuts.push(c);
        }
        if (rings.length) out.polys.push({ cls, rings, cuts, bb, tile: key });
      }
    }
    return out;
  })();
  shapeCache.set(key, pr);
  pr.catch(() => shapeCache.delete(key));
  if (shapeCache.size > 120) shapeCache.delete(shapeCache.keys().next().value);
  return pr;
}
const inBB = (bb, lat, lng) => lat <= bb[0] && lat >= bb[1] && lng >= bb[2] && lng <= bb[3];
function inRings(rings, lat, lng) {
  let inside = false;
  for (const r of rings) for (let j = 0, k = r.length - 1; j < r.length; k = j++) {
    const yi = r[j][0], xi = r[j][1], yk = r[k][0], xk = r[k][1];
    if ((yi > lat) !== (yk > lat) && lng < (xk - xi) * (lat - yi) / (yk - yi) + xi) inside = !inside;
  }
  return inside;
}
// Khoảng cách (km) từ gốc khung F tới cạnh thật gần nhất (bỏ cạnh mép ô)
function ringNearest(rings, cuts, F) {
  let d = Infinity, P = null;
  rings.forEach((r, ri) => {
    const xy = r.map(F.xy), cut = cuts ? cuts[ri] : [];
    for (let j = 0; j + 1 < xy.length; j++) {
      if (cut.includes(j)) continue;
      const q = segNearestXY(0, 0, xy[j][0], xy[j][1], xy[j + 1][0], xy[j + 1][1]);
      if (q.d < d) { d = q.d; P = F.ll(q.x, q.y); }
    }
  });
  return { d, P };
}
function ringsAreaKm2(rings, F) {
  let s = 0;
  for (const r of rings) {
    const xy = r.map(F.xy);
    for (let j = 0, k = xy.length - 1; j < xy.length; k = j++) s += xy[k][0] * xy[j][1] - xy[j][0] * xy[k][1];
  }
  return Math.abs(s / 2);
}
// Hai mảnh ở 2 ô cạnh nhau là cùng một khu: có đỉnh của mảnh này (nằm trong vùng đệm, tức là trong ô kia) nằm trong mảnh kia
function piecesJoin(a, b) {
  for (const [p, q] of [[a, b], [b, a]]) for (const r of p.rings) for (const v of r) {
    if (!inBB(p.bb, v[0], v[1]) && inBB(q.bb, v[0], v[1]) && inRings(q.rings, v[0], v[1])) return true;
  }
  return false;
}
export async function loadZones(pois, signal) {
  const tpl = await tileTemplate(signal);
  const rank = p => (p.star ? -1 : ZONE_RANK[p.cat] ?? 9) * 100 + (p.km || 0);
  const cands = pois.filter(p => {
    if (p.star) return true;
    if (!(p.cat in ZONE_TEST)) return false;
    const nm = p.name || '';
    if (p.cat === 'yte') return /bệnh viện|hospital|trung tâm y tế/i.test(nm);
    if (p.cat === 'cho') return TTTM_RE.test(nm);
    if (p.cat === 'truong') return /đại học|cao đẳng|university|college|học viện/i.test(nm);
    return true;
  }).sort((a, b) => rank(a) - rank(b));
  const out = [], used = new Set();
  for (const p of cands) {
    if (out.length >= 3) break;
    const test = p.star ? (ZONE_TEST[p.cat] && !/^(hanhchinh|nganhang)$/.test(p.cat) ? c => ZONE_TEST[p.cat](c) || ZONE_ANY(c) : ZONE_ANY) : ZONE_TEST[p.cat];
    const big = p.cat === 'kcn' || p.cat === 'congvien';
    const tiles = await Promise.all(tilesAround(p, 14, big ? 1.4 : 0.6).map(([x, y]) => tileShapes(tpl, 14, x, y, signal)));
    const cand = tiles.flatMap(t => t.polys).filter(q => test(q.cls));
    const F = localFrame(p);
    let seed = null, best = 0.08;
    for (const q of cand) {
      if (inBB(q.bb, p.lat, p.lng) && inRings(q.rings, p.lat, p.lng)) { seed = q; break; }
      const { d } = ringNearest(q.rings, q.cuts, F);
      if (d < best) { best = d; seed = q; }
    }
    if (!seed || used.has(seed)) continue;
    // nối các mảnh cùng khu ở ô bên cạnh (tối đa 9 mảnh)
    const pieces = [seed];
    for (let k = 0; k < pieces.length && pieces.length < 9; k++) {
      for (const q of cand) {
        if (pieces.includes(q) || q.tile === pieces[k].tile) continue;
        if (JSON.stringify(q.cls) !== JSON.stringify(pieces[k].cls)) continue;
        if (piecesJoin(pieces[k], q)) pieces.push(q);
      }
    }
    pieces.forEach(q => used.add(q));
    const ha = pieces.reduce((s, q) => s + ringsAreaKm2(q.rings, F), 0) * 100;
    if (ha < (p.cat === 'cho' ? 0.5 : 0.3) || ha > 2000) continue;
    out.push({ poiId: p.id, cat: p.cat, name: p.name || '', ha: Math.round(ha * 10) / 10, pieces: pieces.map(q => ({ bb: q.bb, rings: q.rings, cuts: q.cuts })) });
  }
  return out;
}
// Sông/kênh/hồ gần nhà: chỉ khi mép nước cách nhà ≤ 500 m. Tên lấy từ đường kênh/rạch có tên gần chỗ đó nhất.
export async function loadWater(H, signal) {
  const tpl = await tileTemplate(signal);
  const tiles = await Promise.all(tilesAround(H, 14, 1.2).map(([x, y]) => tileShapes(tpl, 14, x, y, signal)));
  const F = localFrame(H);
  const polys = [], lines = [];
  let near = null;
  for (const t of tiles) {
    for (const q of t.polys) {
      if (!q.cls.w) continue;
      if (inBB(q.bb, H.lat, H.lng) && inRings(q.rings, H.lat, H.lng)) continue;
      const { d, P } = ringNearest(q.rings, q.cuts, F);
      if (d > 0.6 || !P) continue;   // chỉ đoạn sông gần nhà (không làm sáng cả mạng kênh rạch quanh vùng)
      polys.push({ bb: q.bb, rings: q.rings, cuts: q.cuts });
      if (!near || d < near.km) {
        // bề rộng ước lượng = 2 × diện tích / chu vi thật (bỏ cạnh mép ô) — phân biệt sông với rạch nhỏ
        let per = 0;
        q.rings.forEach((r, ri) => { const xy = r.map(F.xy); for (let j = 0; j + 1 < xy.length; j++) if (!q.cuts[ri].includes(j)) per += Math.hypot(xy[j + 1][0] - xy[j][0], xy[j + 1][1] - xy[j][1]); });
        const area = ringsAreaKm2(q.rings, F);
        near = { km: d, lat: P[0], lng: P[1], kind: q.cls.w, w: per > 0 ? 2 * area / per : 0, area };
      }
    }
    for (const l of t.lines) {
      const named = /^(kênh|rạch|sông|r\.)/i.test(l.name);
      if (l.cls === 'stream' && !named) continue;
      const xy = l.pts.map(F.xy);
      let d = Infinity, P = null;
      for (let j = 0; j + 1 < xy.length; j++) {
        const s = segNearestXY(0, 0, xy[j][0], xy[j][1], xy[j + 1][0], xy[j + 1][1]);
        if (s.d < d) { d = s.d; P = F.ll(s.x, s.y); }
      }
      if (d > 0.6) continue;
      lines.push({ pts: l.pts, name: l.name, cls: l.cls, bb: l.bb, d, P });
      if (!near || d < near.km - 0.02) near = { km: d, lat: P[0], lng: P[1], kind: l.cls, line: true };
    }
  }
  if (!near || near.km > 0.5) return null;
  // tên: đường kênh/rạch có tên gần chỗ mép nước gần nhà nhất (≤ 250 m)
  const G = localFrame(near);
  let name = '', nd = 0.25;
  for (const l of lines) {
    if (!l.name) continue;
    const xy = l.pts.map(G.xy);
    for (let j = 0; j + 1 < xy.length; j++) {
      const s = segNearestXY(0, 0, xy[j][0], xy[j][1], xy[j + 1][0], xy[j + 1][1]);
      if (s.d < nd) { nd = s.d; name = l.name; }
    }
  }
  if (!name) for (const t of tiles) for (const nm of t.names) for (const v of nm.pts) {
    const [x, y] = G.xy(v);
    const dd = Math.hypot(x, y);
    if (dd < Math.min(nd, 0.3)) { nd = dd; name = nm.name; }
  }
  // Không khoanh rạch nhỏ không tên (người mua dễ nghĩ tới ngập/ô nhiễm): cần có tên, hoặc lòng sông rộng ≥ 20 m, hoặc hồ ≥ 1 ha
  const real = name || (!near.line && near.kind !== 'lake' && near.w >= 0.02) || (near.kind === 'lake' && near.area >= 0.01);
  if (!real) return null;
  name = name.replace(/^R\.\s*/i, 'Rạch ').replace(/^K\.\s*/i, 'Kênh ').trim();
  const generic = near.kind === 'lake' ? 'hồ' : near.kind === 'canal' ? 'kênh' : 'sông';
  return {
    near: { lat: near.lat, lng: near.lng, km: Math.round(near.km * 1000) / 1000 },
    name, generic,
    // nét kênh chỉ vẽ cho kênh không có mặt nước (sông đã có đa giác thì bỏ đường tim, tránh thêm 1 line giữa sông)
    polys, lines: lines.filter(l => l.d <= 0.5 && (l.cls !== 'river' || !polys.length)).map(l => ({ pts: l.pts, bb: l.bb })),
  };
}
