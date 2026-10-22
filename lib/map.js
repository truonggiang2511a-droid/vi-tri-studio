// Máy chủ trung gian cho dịch vụ bản đồ: đường đi, tên xã/tỉnh, tìm địa điểm, ranh khu công nghiệp.
// - Nguồn chính: Vietmap (đường đi, địa chỉ theo đơn vị hành chính mới), khoá VIETMAP_KEY chỉ nằm trên máy chủ.
// - Nguồn dự phòng: OSRM, Nominatim, Photon (miễn phí) khi Vietmap lỗi, hết lượt hoặc chưa có khoá.
// - Nhớ sẵn kết quả (bộ nhớ đệm Cloudflare) để quét lại căn cũ hoặc căn gần nhau không tốn thêm lượt.
// - Đếm lượt gọi theo nguồn vào vt_visits (trang 'map') để xem trong trang quản trị.
import { env, json, rpc } from './vt.js';

const UA = 'ViTriStudio/1.0 (+https://vitristudio.com)';
const DAY = 86400;
const OSRM = ['https://router.project-osrm.org/route/v1/driving/', 'https://routing.openstreetmap.de/routed-car/route/v1/driving/'];

// Chỉ phục vụ toạ độ trong Việt Nam (chặn dùng ké hạn mức)
const inVN = (lat, lng) => lat > 7.5 && lat < 23.6 && lng > 101.8 && lng < 117.5;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const r5 = n => Math.round(n * 1e5) / 1e5;

let waitUntil = p => p.catch(() => {});
function count(src) {
  waitUntil(rpc('vt_visit', { p_page: 'map', p_source: src }).catch(() => {}));
}

// ---------- Bộ nhớ đệm ----------
const cacheKey = (kind, parts) => new Request(`https://map-cache.vitri/${kind}?${parts}`);
async function cached(kind, parts, ttl, make) {
  const cache = globalThis.caches?.default;
  const key = cacheKey(kind, parts);
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) { count('cache'); const j = await hit.json(); return { ...j, cached: true }; }
  }
  const data = await make();
  if (data && cache && !data.noCache) {
    const res = new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } });
    waitUntil(cache.put(key, res));
  }
  return data;
}

async function getJson(url, ms = 9000, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
  return res.json();
}

// Giải mã polyline (độ chính xác 5 chữ số) -> [[lat, lng], ...]
function decodePolyline(s) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let r = 0, sh = 0, b;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20 && i < s.length);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < s.length) {
    lat += next();
    lng += next();
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
// Toạ độ trả về có thể là [lng, lat] hoặc [lat, lng]: Việt Nam có vĩ độ 8–23, kinh độ 102–117 nên phân biệt được
function toLatLng(pairs) {
  return pairs.map(([a, b]) => (a > 90 || a > b ? [b, a] : [a, b]));
}

// ---------- Đường đi ----------
async function routeVietmap(f, t) {
  const key = env('VIETMAP_KEY');
  if (!key) return null;
  const u = `https://maps.vietmap.vn/api/route/v3?apikey=${encodeURIComponent(key)}&point=${f.lat},${f.lng}&point=${t.lat},${t.lng}&vehicle=car&points_encoded=true`;
  const j = await getJson(u, 9000);
  const p = j?.paths?.[0];
  if (!p || !p.points) return null;
  const coords = typeof p.points === 'string' ? decodePolyline(p.points) : toLatLng(p.points.coordinates || p.points);
  if (coords.length < 2) return null;
  count('vietmap-route');
  return { km: p.distance / 1000, min: p.time / 60000, coords: coords.map(([a, b]) => [r5(a), r5(b)]), src: 'vietmap' };
}
async function routeOsrm(f, t) {
  for (const base of OSRM) {
    try {
      const j = await getJson(`${base}${f.lng},${f.lat};${t.lng},${t.lat}?overview=full&geometries=geojson`, 9000);
      const r = j?.routes?.[0];
      if (j?.code !== 'Ok' || !r) return null;
      count('osrm');
      return { km: r.distance / 1000, min: r.duration / 60, coords: r.geometry.coordinates.map(([lng, lat]) => [r5(lat), r5(lng)]), src: 'osrm' };
    } catch (e) {
      if (e.status === 400) return null;
    }
  }
  return null;
}
async function handleRoute(q) {
  const f = { lat: num(q.get('flat')), lng: num(q.get('flng')) };
  const t = { lat: num(q.get('tlat')), lng: num(q.get('tlng')) };
  if (![f.lat, f.lng, t.lat, t.lng].every(Number.isFinite) || !inVN(f.lat, f.lng) || !inVN(t.lat, t.lng)) return json({ error: 'Toạ độ không hợp lệ' }, 400);
  // Làm tròn ~10 m để căn quét lại hoặc căn sát nhau dùng chung kết quả
  const k = [f.lat, f.lng, t.lat, t.lng].map(v => v.toFixed(4)).join(',');
  const data = await cached('route', k, 30 * DAY, async () => {
    let r = null;
    try { r = await routeVietmap(f, t); } catch { count('vietmap-loi'); }
    if (!r) r = await routeOsrm(f, t);
    return r || { none: true, noCache: true };
  });
  return json(data.none ? { route: null } : { route: data }, 200, { 'cache-control': 'private, max-age=3600' });
}

// ---------- Tên xã/phường, tỉnh/thành ----------
const tidyName = s => String(s || '').replace(/\s+/g, ' ').trim()
  .replace(/^Thành Phố /, 'Thành phố ').replace(/^Thị Trấn /, 'Thị trấn ').replace(/^Đặc Khu /, 'Đặc khu ');
async function reverseVietmap(lat, lng) {
  const key = env('VIETMAP_KEY');
  if (!key) return null;
  const j = await getJson(`https://maps.vietmap.vn/api/reverse/v4?apikey=${encodeURIComponent(key)}&lat=${lat}&lng=${lng}&display_type=1`, 8000);
  const item = Array.isArray(j) ? j[0] : null;
  if (!item) return null;
  // display_type=1 là địa chỉ mới (2 cấp). Nếu máy chủ trả kèm data_new thì ưu tiên phần đó
  const src = item.data_new && item.data_new.boundaries ? item.data_new : item;
  const b = src.boundaries || [];
  const city = b.find(x => x.type === 0);
  const ward = b.find(x => x.type === 2);
  if (!city) return null;
  count('vietmap-reverse');
  return { province: tidyName(city.full_name || city.name), commune: ward ? tidyName(ward.full_name || ward.name) : '', src: 'vietmap' };
}
async function reverseNominatim(lat, lng, zoom) {
  const j = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=${zoom}&addressdetails=1&accept-language=vi`, 9000);
  const a = j?.address;
  if (!a) return null;
  count('nominatim');
  const province = a.state || a.province || (/thành phố|tp\./i.test(a.city || '') ? a.city : '') || a.city || '';
  const cands = [a.suburb, a.quarter, a.town, a.village, a.city_district, a.municipality, a.hamlet].filter(Boolean);
  const commune = cands.find(c => /^(xã|phường|thị trấn|đặc khu)\s/i.test(c)) || '';
  return { province, commune, src: 'osm' };
}
async function handleReverse(q) {
  const lat = num(q.get('lat')), lng = num(q.get('lng'));
  const zoom = Math.min(18, Math.max(5, Math.round(num(q.get('zoom')) || 14)));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inVN(lat, lng)) return json({ error: 'Toạ độ không hợp lệ' }, 400);
  const k = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const data = await cached('reverse', k, 30 * DAY, async () => {
    let r = null;
    try { r = await reverseVietmap(lat, lng); } catch { count('vietmap-loi'); }
    if (!r) { try { r = await reverseNominatim(lat, lng, zoom); } catch { r = null; } }
    return r || { none: true, noCache: true };
  });
  return json(data.none ? { place: null } : { place: data }, 200, { 'cache-control': 'private, max-age=3600' });
}

// ---------- Tìm địa điểm theo tên, ranh khu công nghiệp (chuyển tiếp có nhớ đệm) ----------
async function handlePhoton(q) {
  const allow = ['q', 'lat', 'lon', 'limit', 'bbox', 'location_bias_scale', 'zoom', 'lang', 'osm_tag'];
  const p = new URLSearchParams();
  for (const [k, v] of q) if (allow.includes(k)) p.append(k, v);
  if (!p.get('q') || p.get('q').length > 120) return json({ error: 'Thiếu từ khoá' }, 400);
  const data = await cached('photon', p.toString(), 7 * DAY, async () => {
    const j = await getJson('https://photon.komoot.io/api?' + p.toString(), 9000);
    count('photon');
    return j;
  });
  return json(data, 200, { 'cache-control': 'private, max-age=3600' });
}
async function handleLookup(q) {
  const ids = String(q.get('osm_ids') || '');
  if (!/^[NWR]\d{1,12}(,[NWR]\d{1,12}){0,19}$/.test(ids)) return json({ error: 'Mã không hợp lệ' }, 400);
  const data = await cached('lookup', ids, 30 * DAY, async () => {
    const j = await getJson(`https://nominatim.openstreetmap.org/lookup?osm_ids=${ids}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0003`, 12000);
    count('nominatim');
    return { items: j };
  });
  return json(data.items || [], 200, { 'cache-control': 'private, max-age=3600' });
}


// ---------- Vietmap: tìm theo tên + quét tiện ích gần nhà ----------
// Dữ liệu điểm của Vietmap đầy đủ hơn OSM ở Việt Nam (trường mầm non, chợ nhỏ, trạm y tế, UBND mới…).
// Autocomplete v4 không trả toạ độ, nên lấy toạ độ qua Place (nhớ đệm 30 ngày theo ref_id).
async function vmPlace(key, ref) {
  return cached('vmplace', ref, 30 * DAY, async () => {
    for (const ver of ['v4', 'v3']) {
      try {
        const j = await getJson(`https://maps.vietmap.vn/api/place/${ver}?apikey=${encodeURIComponent(key)}&refid=${encodeURIComponent(ref)}`, 8000);
        const o = Array.isArray(j) ? j[0] : (j?.data || j);
        const lat = num(o?.lat ?? o?.latitude ?? o?.location?.lat), lng = num(o?.lng ?? o?.lon ?? o?.longitude ?? o?.location?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) { count('vietmap-place'); return { lat: r5(lat), lng: r5(lng) }; }
      } catch { /* thử bản khác */ }
    }
    return { none: true, noCache: true };
  });
}
async function vmAuto(key, text, lat, lng, radiusM) {
  const p = new URLSearchParams({ apikey: key, text, focus: `${lat},${lng}`, display_type: '5', layers: 'POI' });
  if (radiusM) { p.set('circle_center', `${lat},${lng}`); p.set('circle_radius', String(Math.round(radiusM))); }
  const j = await getJson('https://maps.vietmap.vn/api/autocomplete/v4?' + p.toString(), 8000);
  count('vietmap-search');
  return (Array.isArray(j) ? j : j?.data || []).filter(x => x && x.ref_id && x.name);
}
async function withCoords(key, items, max) {
  const out = await Promise.all(items.slice(0, max).map(async x => {
    const c = await vmPlace(key, x.ref_id).catch(() => null);
    if (!c || c.none) return null;
    return { name: String(x.name).trim(), address: x.address || x.display || '', lat: c.lat, lng: c.lng, cat: x.cat || null };
  }));
  return out.filter(Boolean);
}
async function handleVmSearch(q) {
  const key = env('VIETMAP_KEY');
  const text = String(q.get('q') || '').trim().slice(0, 120);
  const lat = num(q.get('lat')), lng = num(q.get('lng'));
  if (!key) return json({ items: [] });
  if (!text || !Number.isFinite(lat) || !Number.isFinite(lng) || !inVN(lat, lng)) return json({ error: 'Thiếu từ khoá' }, 400);
  const data = await cached('vmsearch', `${text.toLowerCase()}|${lat.toFixed(2)},${lng.toFixed(2)}`, 7 * DAY, async () => {
    const list = await vmAuto(key, text, lat, lng, 0);
    return { items: await withCoords(key, list, 6) };
  });
  return json({ items: data.items || [] }, 200, { 'cache-control': 'private, max-age=3600' });
}
// Quét theo nhóm: mỗi nhóm một từ khoá trong vòng bán kính; chỉ lấy toạ độ cho điểm nằm trong bán kính
const NEAR_Q = [
  ['truong', 'trường học', /trường|mầm non|mẫu giáo|nhà trẻ|tiểu học|thcs|thpt|đại học|cao đẳng/i],
  ['truong', 'trường mầm non', /mầm non|mẫu giáo|nhà trẻ/i],
  ['yte', 'bệnh viện', /bệnh viện|bv\b/i],
  ['yte', 'trạm y tế', /trạm y tế|phòng khám|trung tâm y tế|bệnh viện/i],
  ['cho', 'chợ', /^chợ\b|\bchợ\s/i],
  ['cho', 'siêu thị', /siêu thị|bách hóa xanh|bách hoá xanh|winmart|co\.?op|aeon|lotte|go!|emart|mega market|trung tâm thương mại/i],
  ['hanhchinh', 'ủy ban nhân dân', /ủy ban|uỷ ban|ubnd|công an|trung tâm hành chính|phục vụ hành chính/i],
  ['congvien', 'công viên', /công viên|vườn hoa|nhà văn hóa|nhà văn hoá|sân vận động|trung tâm thể thao/i],
  ['kcn', 'khu công nghiệp', /khu công nghiệp|cụm công nghiệp|khu chế xuất|^kcn|^ccn/i],
  ['giaothong', 'bến xe', /bến xe|ga |nhà ga|bến phà|metro/i],
];
async function handleVmNearby(q) {
  const key = env('VIETMAP_KEY');
  const lat = num(q.get('lat')), lng = num(q.get('lng'));
  const rKm = Math.min(10, Math.max(0.5, num(q.get('r')) || 5));
  if (!key) return json({ items: [] });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inVN(lat, lng)) return json({ error: 'Toạ độ không hợp lệ' }, 400);
  const data = await cached('vmnear', `${lat.toFixed(3)},${lng.toFixed(3)}|${rKm}`, 30 * DAY, async () => {
    const seen = new Set();
    const picks = [];
    const lists = await Promise.all(NEAR_Q.map(([cat, text, re]) => vmAuto(key, text, lat, lng, rKm * 1000)
      .then(l => l.map(x => ({ ...x, cat, ok: re.test(x.name) }))).catch(() => [])));
    for (const list of lists) {
      for (const x of list) {
        if (!x.ok || seen.has(x.ref_id)) continue;
        const d = num(x.distance);
        if (Number.isFinite(d) && d > rKm * 1.02) continue;
        seen.add(x.ref_id);
        picks.push(x);
      }
    }
    // Ưu tiên điểm gần nhà, giới hạn số lần lấy toạ độ
    picks.sort((a, b) => (num(a.distance) || 99) - (num(b.distance) || 99));
    const chosen = picks.slice(0, 45);
    const withC = await withCoords(key, chosen, chosen.length);
    return { items: withC };
  });
  return json({ items: data.items || [] }, 200, { 'cache-control': 'private, max-age=3600' });
}

export async function handleMap(request, ctx) {
  if (ctx?.waitUntil) waitUntil = p => ctx.waitUntil(p.catch(() => {}));
  if (request.method !== 'GET') return json({ error: 'Chỉ nhận GET' }, 405);
  // Chỉ phục vụ trang của app (chặn trang khác gọi ké)
  const url = new URL(request.url);
  const from = request.headers.get('origin') || request.headers.get('referer') || '';
  if (from && !from.startsWith(url.origin)) return json({ error: 'Không được phép' }, 403);
  const q = url.searchParams;
  const kind = url.pathname.split('/').pop();
  try {
    if (kind === 'route') return await handleRoute(q);
    if (kind === 'reverse') return await handleReverse(q);
    if (kind === 'search') return await handlePhoton(q);
    if (kind === 'lookup') return await handleLookup(q);
    if (kind === 'vsearch') return await handleVmSearch(q);
    if (kind === 'nearby') return await handleVmNearby(q);
    return json({ error: 'Không có' }, 404);
  } catch (e) {
    return json({ error: 'Dịch vụ bản đồ đang bận, thử lại sau.' }, 502);
  }
}
