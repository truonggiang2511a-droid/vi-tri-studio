// Máy chủ trung gian cho dịch vụ bản đồ: đường đi, tên xã/tỉnh, tìm địa điểm, ranh khu công nghiệp.
// - Nguồn chính: Vietmap (địa chỉ theo đơn vị hành chính mới, tiện ích), khoá VIETMAP_KEY (+ VIETMAP_KEY_2 dự phòng) chỉ nằm trên máy chủ.
//   Đường đi: ArcGIS Route trước (miễn phí 20.000/tháng), rồi Vietmap, rồi OSRM.
// - Nguồn dự phòng: OSRM, Nominatim, Photon (miễn phí) khi Vietmap lỗi, hết lượt hoặc chưa có khoá.
// - Nhớ sẵn kết quả (bộ nhớ đệm Cloudflare + kho R2) để quét lại căn cũ hoặc căn gần nhau không tốn thêm lượt.
// - Đếm lượt gọi theo nguồn vào vt_visits (trang 'map') để xem trong trang quản trị.
import { env, json, rpc } from './vt.js';
import { HUBS } from '../js/hubs.js';

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

// Đếm riêng số lần lấy từ bộ nhớ của từng loại tốn hạn mức (nguồn 'nho-<loại>'), để biết thật sự đỡ được bao nhiêu lượt
const KIND_COUNT = { vmnear9: 'nho-quet', vmsearch: 'nho-tim', reverse: 'nho-xa', route: 'nho-duong' };
const countKind = kind => { if (KIND_COUNT[kind]) count(KIND_COUNT[kind]); };

// ---------- Bộ nhớ đệm 2 tầng ----------
// Tầng 1: caches.default — nhanh nhưng CHỈ nằm ở trạm Cloudflare đã tạo ra nó và có thể bị xoá sớm.
// Tầng 2 (28/11): kho R2 MAP_STORE dùng chung mọi trạm → khách ở mạng khác, máy khác quét cùng căn không gọi lại
// Vietmap / ArcGIS. Chưa gắn MAP_STORE hoặc R2 lỗi thì chạy như cũ, chỉ còn tầng 1.
// Khoá nhớ đệm không chứa khoá API → đổi VIETMAP_KEY / ARCGIS_KEY vẫn dùng lại kết quả cũ.
const cacheKey = (kind, parts) => new Request(`https://map-cache.vitri/${kind}?${parts}`);
const SHORT_TTL = 3600; // kết quả thiếu (dịch vụ lỗi giữa chừng): giữ tạm 1 giờ rồi quét lại
async function storeKey(kind, parts) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
  return `${kind}/${[...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}
const l1Put = (cache, key, text, ttl) => cache && waitUntil(cache.put(key, new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${Math.max(60, Math.floor(ttl))}` } })));
async function cached(kind, parts, ttl, make) {
  const cache = globalThis.caches?.default;
  const key = cacheKey(kind, parts);
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) { count('cache'); countKind(kind); const j = await hit.json(); return { ...j, cached: true }; }
  }
  const store = env('MAP_STORE') || null;
  let sk = '';
  if (store) {
    try {
      sk = await storeKey(kind, parts);
      const obj = await store.get(sk);
      const age = obj ? (Date.now() - new Date(obj.uploaded).getTime()) / 1000 : Infinity;
      if (age < ttl) {
        const text = await obj.text();
        const j = JSON.parse(text);
        l1Put(cache, key, text, ttl - age);
        count('cache-r2');
        countKind(kind);
        return { ...j, cached: true };
      }
    } catch { /* R2 lỗi hoặc bản lưu hỏng → gọi dịch vụ như thường */ }
  }
  const data = await make();
  if (data && !data.noCache) {
    const text = JSON.stringify(data);
    // short = kết quả mượn của căn gần: chỉ giữ 1 giờ, không lưu R2 (không kéo dài tuổi dữ liệu gốc, tắt công tắc là hết)
    const brief = data.partial || data.short;
    l1Put(cache, key, text, brief ? SHORT_TTL : ttl);
    if (store && sk && !brief) waitUntil(store.put(sk, text));
  }
  return data;
}
// Trình duyệt tự nhớ kết quả TỐT (khách tải lại trang, quét lại căn không gọi máy chủ); kết quả lỗi/rỗng thì không nhớ
const keep = (good, days) => ({ 'cache-control': good ? `private, max-age=${days * DAY}` : 'no-store' });

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

// ---------- Khoá Vietmap chính + dự phòng (28/11) ----------
// Luôn dùng VIETMAP_KEY trước. Vietmap từ chối vì khoá (401 sai khoá, 423 hết hạn mức / API chưa bật, 429 gọi quá nhanh,
// hoặc thân phản hồi OVER_DAILY_LIMIT) → gọi lại ngay bằng VIETMAP_KEY_2. Khoá bị từ chối được bỏ qua một lúc, tính
// RIÊNG từng API (hết lượt Place không ảnh hưởng chỉ đường), để không gọi hỏng thêm lượt nào và không vượt giới hạn
// ~50 lần gọi ra ngoài của Worker. Hết thời gian bỏ qua thì tự thử lại khoá chính (hạn mức ngày đặt lại là tự quay về).
// Lỗi mạng / máy chủ Vietmap lỗi 5xx: không đổi khoá.
const VM_COOL = { 401: 600e3, 403: 600e3, 423: 600e3, 429: 60e3 };
const vmKeys = () => [...new Set([env('VIETMAP_KEY'), env('VIETMAP_KEY_2')].map(k => String(k).trim()).filter(Boolean))];
const vmBlocked = new Map(); // "api|khoá" -> bỏ qua tới thời điểm này (nhớ trong từng máy chủ)
let vmBackupCounted = 0;
async function vmCall(key, path, params, ms) {
  const p = new URLSearchParams(params);
  p.set('apikey', key);
  const j = await getJson(`https://maps.vietmap.vn/api/${path}?${p}`, ms);
  if (j?.code === 'OVER_DAILY_LIMIT') { const e = new Error('OVER_DAILY_LIMIT'); e.status = 423; throw e; }
  return j;
}
async function vmGet(path, params, ms = 8000) {
  const keys = vmKeys();
  const open = keys.filter(k => !(vmBlocked.get(`${path}|${k}`) > Date.now()));
  // Mọi khoá đang bị bỏ qua → thử khoá cuối một lần
  const order = open.length ? open : keys.slice(-1);
  let last = new Error('chưa có khoá Vietmap');
  for (const key of order) {
    try {
      const j = await vmCall(key, path, params, ms);
      // Đếm để báo cáo 7h sáng biết đang chạy bằng khoá dự phòng (tối đa 1 lần / 5 phút cho đỡ tốn lần gọi)
      if (key !== keys[0] && Date.now() - vmBackupCounted > 300e3) { vmBackupCounted = Date.now(); count('vietmap-khoa2'); }
      return j;
    } catch (e) {
      last = e;
      if (!VM_COOL[e.status]) throw e;
      vmBlocked.set(`${path}|${key}`, Date.now() + VM_COOL[e.status]);
    }
  }
  throw last;
}
// Kiểm tra 2 khoá còn dùng được không: mở /api/map/vmcheck. Chỉ trả có/không + mã lỗi, KHÔNG trả khoá.
// Mỗi lần kiểm tốn 1 lượt Reverse cho mỗi khoá nên nhớ kết quả 30 phút.
async function handleVmCheck() {
  const raw = [env('VIETMAP_KEY'), env('VIETMAP_KEY_2')].map(k => String(k).trim());
  const data = await cached('vmcheck', `${raw.map(k => (k ? 1 : 0)).join('')}|${raw[0] && raw[0] === raw[1] ? 1 : 0}`, 1800, async () => {
    const [chinh, duPhong] = await Promise.all(raw.map(async key => {
      if (!key) return { co_khoa: false };
      try {
        const j = await vmCall(key, 'reverse/v4', { lat: '10.7285', lng: '106.6185', display_type: '1' }, 8000);
        return { co_khoa: true, dung_duoc: Array.isArray(j) && j.length > 0 };
      } catch (e) { return { co_khoa: true, dung_duoc: false, ma_loi: e.status || 'mạng' }; }
    }));
    return { khoa_chinh: chinh, khoa_du_phong: duPhong, hai_khoa_giong_nhau: !!raw[0] && raw[0] === raw[1], luc: new Date().toISOString() };
  });
  return json(data);
}

// ---------- Đường đi ----------
async function routeVietmap(f, t) {
  if (!vmKeys().length) return null;
  const j = await vmGet('route/v3', [['point', `${f.lat},${f.lng}`], ['point', `${t.lat},${t.lng}`], ['vehicle', 'car'], ['points_encoded', 'true']], 9000);
  const p = j?.paths?.[0];
  if (!p || !p.points) return null;
  const coords = typeof p.points === 'string' ? decodePolyline(p.points) : toLatLng(p.points.coordinates || p.points);
  if (coords.length < 2) return null;
  count('vietmap-route');
  return { km: p.distance / 1000, min: p.time / 60000, coords: coords.map(([a, b]) => [r5(a), r5(b)]), src: 'vietmap' };
}
// ArcGIS Route: miễn phí 20.000 lượt/tháng (gói Location Platform, đã tắt trả theo lượt → hết thì bị chặn, không tính tiền).
// Đi trước Vietmap để tiết kiệm hạn mức Vietmap (gói Trial). Lỗi/hết lượt (HTTP 200 kèm error) → trả null, sang Vietmap.
// Khoá chỉ đường nên là khoá RIÊNG nằm trên máy chủ (ARCGIS_ROUTE_KEY): ARCGIS_KEY được gửi cho trình duyệt để tải ảnh
// vệ tinh, nếu nó có quyền Định tuyến thì người ngoài lấy được và dùng ké hạn mức. Chưa đặt thì dùng ARCGIS_KEY như cũ.
const arcRouteKey = () => env('ARCGIS_ROUTE_KEY') || env('ARCGIS_KEY');
const ARC_ROUTE = 'https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World/solve';
async function routeArcgis(f, t) {
  const key = arcRouteKey();
  if (!key || env('ARCGIS_ROUTE') === 'off') return null;
  const p = new URLSearchParams({ f: 'json', token: key, stops: `${f.lng},${f.lat};${t.lng},${t.lat}`, returnDirections: 'false', returnRoutes: 'true', outSR: '4326' });
  const j = await getJson(ARC_ROUTE + '?' + p, 9000, { referer: 'https://vitristudio.com/' });
  if (j?.error) { count('arcgis-route-loi'); return null; }
  const ft = j?.routes?.features?.[0];
  const coords = (ft?.geometry?.paths || []).flat().map(([lng, lat]) => [r5(lat), r5(lng)]);
  if (coords.length < 2) return null;
  count('arcgis-route');
  return { km: ft.attributes.Total_Kilometers, min: ft.attributes.Total_TravelTime, coords, src: 'arcgis' };
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
    try { r = await routeArcgis(f, t); } catch { count('arcgis-route-loi'); }
    if (!r) try { r = await routeVietmap(f, t); } catch { count('vietmap-loi'); }
    if (!r) r = await routeOsrm(f, t);
    return r || { none: true, noCache: true };
  });
  return json(data.none ? { route: null } : { route: data }, 200, keep(!data.none, 7));
}

// ---------- Tên xã/phường, tỉnh/thành ----------
const tidyName = s => String(s || '').replace(/\s+/g, ' ').trim()
  .replace(/^Thành Phố /, 'Thành phố ').replace(/^Thị Trấn /, 'Thị trấn ').replace(/^Đặc Khu /, 'Đặc khu ');
async function reverseVietmap(lat, lng) {
  if (!vmKeys().length) return null;
  const j = await vmGet('reverse/v4', { lat, lng, display_type: '1' });
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
  return json(data.none ? { place: null } : { place: data }, 200, keep(!data.none, 7));
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
  return json(data, 200, keep(true, 1));
}
async function handleLookup(q) {
  const ids = String(q.get('osm_ids') || '');
  if (!/^[NWR]\d{1,12}(,[NWR]\d{1,12}){0,19}$/.test(ids)) return json({ error: 'Mã không hợp lệ' }, 400);
  const data = await cached('lookup', ids, 30 * DAY, async () => {
    const j = await getJson(`https://nominatim.openstreetmap.org/lookup?osm_ids=${ids}&format=jsonv2&polygon_geojson=1&polygon_threshold=0.0003`, 12000);
    count('nominatim');
    return { items: j };
  });
  return json(data.items || [], 200, keep(!!data.items?.length, 7));
}


// ---------- Vietmap: tìm theo tên + quét tiện ích gần nhà ----------
// Dữ liệu điểm của Vietmap đầy đủ hơn OSM ở Việt Nam (trường mầm non, chợ nhỏ, trạm y tế, UBND mới…).
// Autocomplete v4 không trả toạ độ, nên lấy toạ độ qua Place v4/v3.
// Cloudflare giới hạn ~50 lần gọi ra ngoài mỗi yêu cầu: quét gần nhà dùng NEAR_Q.length lần tìm + tối đa VM_MAX lần
// lấy toạ độ, không đếm/nhớ đệm từng điểm (nhớ đệm cả kết quả).
// Lấy toạ độ 1 điểm. v4 trả được nhưng thiếu toạ độ thì thử v3; v4 LỖI HTTP (hết lượt Place trong ngày, quá tải…)
// thì KHÔNG thử v3 (tốn thêm 1 giao dịch + 1 lần gọi ra ngoài của Worker mà cũng lỗi y như vậy).
async function vmPlaceRaw(ref) {
  let netErr = null;
  for (const ver of ['v4', 'v3']) {
    let j;
    try {
      j = await vmGet(`place/${ver}`, { refid: ref });
    } catch (e) { if (e.status) { const er = new Error('place ' + e.status); er.http = true; throw er; } netErr = e; continue; }
    const o = Array.isArray(j) ? j[0] : (j?.data || j);
    const lat = num(o?.lat ?? o?.latitude ?? o?.location?.lat), lng = num(o?.lng ?? o?.lon ?? o?.longitude ?? o?.location?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: r5(lat), lng: r5(lng) };
  }
  if (netErr) throw netErr; // lỗi mạng / quá giới hạn gọi ra ngoài: báo lên để kết quả thiếu không bị nhớ 30 ngày
  return null;
}
// Nhớ toạ độ theo ref_id trong Supabase (supabase/vt_vm_place.sql, 30 ngày): mỗi lần quét chỉ thêm 2 lần gọi ra ngoài
// (1 đọc + 1 ghi) thay vì tới ~16 lần Place. Không có TELEGRAM_SECRET hoặc Supabase lỗi → bỏ qua, gọi Vietmap như cũ.
async function placeCacheGet(refs) {
  const k = env('TELEGRAM_SECRET');
  if (!k || !refs.length) return {};
  try { return (await rpc('vt_vm_place_get', { p_key: k, p_refs: refs.slice(0, 60) })) || {}; } catch { return {}; }
}
async function placeCachePut(items) {
  const k = env('TELEGRAM_SECRET');
  if (!k || !items.length) return;
  try { await rpc('vt_vm_place_put', { p_key: k, p_items: items.slice(0, 60) }); } catch { /* bỏ qua */ }
}
async function vmAuto(text, lat, lng, radiusM, layers = 'POI') {
  const p = new URLSearchParams({ text, focus: `${lat},${lng}`, display_type: '5' });
  if (layers) p.set('layers', layers);
  if (radiusM) { p.set('circle_center', `${lat},${lng}`); p.set('circle_radius', String(Math.round(radiusM))); }
  const j = await vmGet('autocomplete/v4', p);
  return (Array.isArray(j) ? j : j?.data || []).filter(x => x && x.ref_id && x.name);
}
async function withCoords(items, stat = {}) {
  const out = [];
  const cache = await placeCacheGet(items.map(x => String(x.ref_id)));
  const fresh = [];
  let httpFail = 0;
  // Từng đợt 6 điểm để không dồn quá nhiều kết nối. Có 2 khoá thì đợt đầu dừng ở điểm ĐẦU TIÊN phải hỏi Vietmap:
  // khoá chính hết lượt Place thì chỉ tốn 1 lần gọi hỏng, các đợt sau đi thẳng khoá dự phòng.
  const miss = items.findIndex(x => !cache[String(x.ref_id)]);
  let size = vmKeys().length > 1 && miss >= 0 ? Math.min(6, miss + 1) : 6;
  for (let i = 0; i < items.length; i += size, size = 6) {
    const part = await Promise.all(items.slice(i, i + size).map(async x => {
      const hit = cache[String(x.ref_id)];
      let c = Array.isArray(hit) ? { lat: hit[0], lng: hit[1] } : null;
      if (c) stat.hit = (stat.hit || 0) + 1;
      else if (httpFail < 3) {
        stat.call = (stat.call || 0) + 1;
        c = await vmPlaceRaw(x.ref_id).catch(e => { stat.err = (stat.err || 0) + 1; if (e.http) httpFail++; return null; });
        if (c) fresh.push({ ref: String(x.ref_id), lat: c.lat, lng: c.lng });
      }
      return c ? { name: String(x.name).trim(), address: x.address || x.display || '', lat: c.lat, lng: c.lng, cat: x.cat || null, kind: x.kind || null } : null;
    }));
    out.push(...part.filter(Boolean));
  }
  // Place lỗi HTTP liên tiếp (thường là hết 1.500 lượt/ngày) → thôi gọi tiếp trong lần quét này
  if (httpFail >= 3) stat.stop = true;
  await placeCachePut(fresh);
  return out;
}
async function handleVmSearch(q) {
  const text = String(q.get('q') || '').trim().slice(0, 120);
  const lat = num(q.get('lat')), lng = num(q.get('lng'));
  if (!vmKeys().length) return json({ items: [] });
  if (!text || !Number.isFinite(lat) || !Number.isFinite(lng) || !inVN(lat, lng)) return json({ error: 'Thiếu từ khoá' }, 400);
  const data = await cached('vmsearch', `${text.toLowerCase()}|${lat.toFixed(2)},${lng.toFixed(2)}`, 7 * DAY, async () => {
    const list = await vmAuto(text, lat, lng, 0);
    const items = await withCoords(list.slice(0, 6));
    count('vietmap-search');
    return items.length ? { items } : { items: [], noCache: true };
  });
  return json({ items: data.items || [] }, 200, keep(!!data.items?.length, 1));
}
// Mỗi nhóm một từ khoá; tên phải BẮT ĐẦU bằng đúng loại (loại "Mắt kính Bệnh viện…", "Trà sữa Chợ Lớn"…)
// 28/11 (Giang chốt: bớt tốn Vietmap): Vietmap CHỈ lo điểm nhỏ SÁT NHÀ mà bản đồ miễn phí hay thiếu. Vietmap tính tiền
// theo từng từ khoá nên mỗi dòng thêm vào đây là thêm 1 giao dịch cho MỌI lần quét. Bệnh viện, công viên, khu công nghiệp,
// khu đô thị, trạm sạc, điểm xa hơn VM_NEAR_KM: lấy từ OSM + Overture (trình duyệt tự tải theo bán kính khách chọn).
const NEAR_Q = [
  // [nhóm, từ khoá, tên phải khớp]
  ['truong', 'trường mầm non', /^(trường )?(mầm non|mẫu giáo|nhà trẻ)/i],
  ['truong', 'trường tiểu học', /^trường (tiểu học|th\b|thcs|thpt|trung học|phổ thông|liên cấp|quốc tế)/i],
  ['truong', 'trường trung học', /^trường (tiểu học|thcs|thpt|trung học|phổ thông|liên cấp|đại học|cao đẳng)/i],
  ['yte', 'trạm y tế', /^(trạm y tế|trung tâm y tế|phòng khám đa khoa)/i],
  ['cho', 'chợ', /^chợ\s/i],
  ['cho', 'siêu thị', /^(siêu thị|bách hóa xanh|bách hoá xanh|winmart|co\.?op ?(mart|food|xtra)|aeon|lotte mart|go!|emart|mm mega|trung tâm thương mại)/i],
  ['hanhchinh', 'ủy ban nhân dân', /^(ủy ban|uỷ ban|ubnd|công an (phường|xã)|trung tâm (hành chính|phục vụ hành chính))/i],
];
const VM_MAX = 12; // số điểm tối đa phải lấy toạ độ mỗi lần quét
const VM_NEAR_KM = 2;
// Khoá nhớ đệm của lần quét thường vẫn ghi "|5" như trước 28/11: căn đã quét bản cũ (rộng hơn) được dùng lại, không tốn thêm.
const VM_CACHE_KM = 5;
// ---------- Dùng lại lần quét của căn gần (28/11) ----------
// Mỗi lần quét ĐẦY ĐỦ được ghi thêm vào R2 theo ô ~1,1 km: vmnb1/<ô>/<toạ độ căn>. Biến VM_REUSE:
//   chưa đặt = 'do' (đo ngầm): khách vẫn được quét thật như cũ; chỉ đếm 'vm-gan-du' / 'vm-gan-sot' = nếu mượn kết quả
//              căn gần thì có thiếu điểm nào trong 500 m so với quét thật không.
//   'on'  = mượn thật, không gọi Vietmap (đếm 'vm-gan-dung').
//   'off' = tắt hẳn.
// VM_REUSE_M = khoảng cách tối đa giữa 2 căn (mét), mặc định 200, chỉ nhận 50–300.
// Kết quả mượn KHÔNG được ghi lại làm nguồn cho căn khác (tránh lan dần xa khỏi điểm quét thật).
const reuseMode = () => { const v = String(env('VM_REUSE')).trim().toLowerCase(); return v === 'on' || v === 'off' ? v : 'do'; };
const reuseKm = () => Math.min(300, Math.max(50, Number(env('VM_REUSE_M')) || 200)) / 1000;
const nbCell = (lat, lng) => `vmnb1/${lat.toFixed(2)},${lng.toFixed(2)}/`;
async function findDonor(store, lat, lng, maxAgeSec) {
  try {
    const km = reuseKm();
    const dLat = km / 110.57, dLng = km / (111.32 * Math.cos(lat * Math.PI / 180));
    const cells = new Set();
    for (const a of [lat - dLat, lat + dLat]) for (const b of [lng - dLng, lng + dLng]) cells.add(nbCell(a, b));
    const found = [];
    for (const prefix of cells) {
      const l = await store.list({ prefix, limit: 500 });
      for (const o of l.objects || []) {
        const [la, ln] = o.key.slice(prefix.length).split(',').map(Number);
        const d = kmBetween(lat, lng, la, ln);
        if (d <= km && (Date.now() - new Date(o.uploaded).getTime()) / 1000 < maxAgeSec) found.push({ key: o.key, d });
      }
    }
    if (!found.length) return null;
    found.sort((a, b) => a.d - b.d);
    const obj = await store.get(found[0].key);
    if (!obj) return null;
    const items = JSON.parse(await obj.text()).items;
    if (!Array.isArray(items)) return null;
    const near = items.filter(x => kmBetween(lat, lng, x.lat, x.lng) <= VM_NEAR_KM * 1.02);
    return near.length ? { items: near, d: found[0].d } : null;
  } catch { return null; } // R2 lỗi → quét thật như cũ
}
// Điểm trong 500 m quanh nhà mà quét thật có nhưng bản mượn không có
function missedNear(fresh, borrowed, lat, lng) {
  const nm = x => String(x.name).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return fresh.filter(x => kmBetween(lat, lng, x.lat, x.lng) <= 0.5 &&
    !borrowed.some(y => nm(y) === nm(x) && kmBetween(x.lat, x.lng, y.lat, y.lng) <= 0.15));
}

async function handleVmNearby(q) {
  const lat = num(q.get('lat')), lng = num(q.get('lng'));
  const reqKm = num(q.get('r')) || VM_CACHE_KM;
  // Chạm bản đồ thêm tiện ích (r < 1) giữ bán kính nhỏ
  const rKm = reqKm < 1 ? Math.max(0.5, reqKm) : VM_NEAR_KM;
  if (!vmKeys().length) return json({ items: [] });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inVN(lat, lng)) return json({ error: 'Toạ độ không hợp lệ' }, 400);
  const debug = q.get('debug') === '1';
  const data = await cached('vmnear9', `${lat.toFixed(3)},${lng.toFixed(3)}|${reqKm < 1 ? rKm : VM_CACHE_KM}`, 30 * DAY, async () => {
    // Chỉ áp dụng cho lần quét thường (không áp dụng khi khách chạm bản đồ thêm tiện ích, hay đang xem debug)
    const store = reqKm >= 1 && !debug && reuseMode() !== 'off' ? env('MAP_STORE') || null : null;
    const donor = store ? await findDonor(store, lat, lng, 30 * DAY) : null;
    if (donor && reuseMode() === 'on') {
      count('vm-gan-dung');
      return { items: donor.items, short: true };
    }
    const seen = new Set();
    const picks = [];
    let failed = 0; // số lượt tìm bị Vietmap từ chối (hết lượt, quá giới hạn mỗi phút, khoá sai)
    const find = ([cat, text, re]) => vmAuto(text, lat, lng, rKm * 1000)
      .then(l => l.map(x => ({ ...x, cat, kind: cat, ok: re.test(String(x.name).normalize('NFC').trim()) }))).catch(() => { failed++; return []; });
    // Có 2 khoá thì tìm từ khoá đầu TRƯỚC: khoá chính bị từ chối thì các từ khoá sau đi thẳng khoá dự phòng, không gọi
    // hỏng cả loạt (đỡ tốn lần gọi: Worker chỉ được ~50 lần gọi ra ngoài mỗi yêu cầu)
    const head = vmKeys().length > 1 ? [await find(NEAR_Q[0])] : [];
    const lists = [...head, ...await Promise.all(NEAR_Q.slice(head.length).map(find))];
    for (const list of lists) {
      for (const x of list) {
        if (!x.ok || seen.has(x.ref_id)) continue;
        // Bỏ trụ sở cũ trước sáp nhập, thú y, nhà thuốc
        if (/\bcũ\s*$|\(cũ\)|thú y|nhà thuốc/i.test(String(x.name))) continue;
        const d = num(x.distance);
        if (Number.isFinite(d) && d > rKm * 1.02) continue;
        seen.add(x.ref_id);
        picks.push(x);
      }
    }
    // Mỗi nhóm lấy tối đa 3 điểm gần nhất, tổng tối đa VM_MAX lần lấy toạ độ
    const dk = x => num(x.distance) || 99;
    picks.sort((a, b) => dk(a) - dk(b));
    // Lấy xen kẽ theo loại (mỗi vòng 1 điểm gần nhất của mỗi loại) để loại nào cũng có mặt
    const byKind = new Map();
    for (const x of picks) { if (!byKind.has(x.kind)) byKind.set(x.kind, []); byKind.get(x.kind).push(x); }
    // 31/10: bớt lượt Place (Vietmap Trial giới hạn 1.500/ngày) — mỗi loại bỏ điểm TRÙNG TÊN (cùng tên = cùng nơi,
    // vd. 2 mục cùng trường), tối đa VM_MAX điểm, điểm thứ 3 của một loại chỉ lấy khi cách nhà ≤ 1,5 km.
    const nameKey = x => String(x.name).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
    for (const [kind, arr] of byKind) {
      const seenName = new Set();
      byKind.set(kind, arr.filter(x => { const k = nameKey(x); if (seenName.has(k)) return false; seenName.add(k); return true; }));
    }
    const chosen = [];
    for (let round = 0; round < 3 && chosen.length < VM_MAX; round++) {
      for (const [kind, arr] of byKind) {
        if (chosen.length >= VM_MAX) break;
        const x = arr[round];
        if (!x) continue;
        if (round >= 2 && !(num(x.distance) <= 1.5)) continue;
        chosen.push(x);
      }
    }
    const stat = {};
    const items = await withCoords(chosen, stat);
    count('vietmap-nearby');
    const dbg = lists.map((l, i) => [NEAR_Q[i][1], l.length, l.filter(x => x.ok).length, l.slice(0, 3).map(x => x.name)]);
    if (failed || stat.stop || stat.err) count('vietmap-loi'); // để báo cáo 7h sáng cảnh báo khi Vietmap hết lượt (trước đây lỗi im lặng)
    // Thiếu một phần thì KHÔNG nhớ lâu, nếu không căn đó bị thiếu tiện ích suốt 30 ngày
    const partial = failed > 0 || !!stat.stop || !!stat.err;
    if (store && items.length && !partial) {
      // Đo ngầm: có căn gần thì so với quét thật và KHÔNG ghi căn này làm nguồn (giống hệt lúc bật thật)
      if (donor) count(missedNear(items, donor.items, lat, lng).length ? 'vm-gan-sot' : 'vm-gan-du');
      else waitUntil(Promise.resolve(store.put(`${nbCell(lat, lng)}${lat.toFixed(5)},${lng.toFixed(5)}`, JSON.stringify({ items }))));
    }
    return items.length ? { items, dbg, place: stat, ...(partial ? { partial: true } : {}) } : { items: [], noCache: true, dbg, place: stat };
  });
  // Sân bay gần nhất trong 30 km lấy từ danh sách cố định js/hubs.js (không tốn lượt Vietmap), nếu kết quả chưa có sân bay
  const items = [...(data.items || [])];
  if (rKm >= 1 && !items.some(x => x.kind === 'airport')) {
    const ap = HUBS.filter(h => h[0] === 'airport')
      .map(([, name, la, ln]) => ({ name, lat: la, lng: ln, d: kmBetween(lat, lng, la, ln) }))
      .filter(h => h.d <= 30).sort((a, b) => a.d - b.d)[0];
    if (ap) items.push({ name: ap.name, address: '', lat: ap.lat, lng: ap.lng, cat: 'giaothong', kind: 'airport' });
  }
  return json({ items, ...(debug && data.dbg ? { dbg: data.dbg, place: data.place || null } : {}) }, 200, keep(!!data.items?.length && !data.partial && !debug, 1));
}
function kmBetween(la1, ln1, la2, ln2) {
  const R = 6371, t = Math.PI / 180, dLa = (la2 - la1) * t, dLn = (ln2 - ln1) * t;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * t) * Math.cos(la2 * t) * Math.sin(dLn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- Ranh xã/phường + tỉnh/thành chứa căn nhà (để khoanh vùng ở cảnh mở đầu) ----------
// Nominatim (OSM, đã theo đơn vị hành chính mới 2025): zoom 10 = xã/phường, zoom 5 = tỉnh/thành. Ranh được làm gọn.
function ringsOfGeo(g) {
  if (!g) return [];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  // chỉ lấy vòng ngoài của mỗi mảnh, đổi [lng,lat] -> [lat,lng], làm tròn 5 chữ số
  return polys.map(p => (p[0] || []).map(([x, y]) => [r5(y), r5(x)])).filter(r => r.length >= 4);
}
async function nomArea(lat, lng, zoom, thr) {
  const j = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=${zoom}&polygon_geojson=1&polygon_threshold=${thr}&accept-language=vi`, 12000);
  count('nominatim');
  const rings = ringsOfGeo(j?.geojson);
  return rings.length ? { name: j.name || '', type: j.addresstype || '', rings } : null;
}
async function handleArea(q) {
  const lat = num(q.get('lat')), lng = num(q.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inVN(lat, lng)) return json({ error: 'Toạ độ không hợp lệ' }, 400);
  const data = await cached('area', `${lat.toFixed(4)},${lng.toFixed(4)}`, 30 * DAY, async () => {
    const ward = await nomArea(lat, lng, 10, 0.0004).catch(() => null);
    await new Promise(r => setTimeout(r, 1100)); // Nominatim: tối đa 1 lần/giây
    const province = await nomArea(lat, lng, 5, 0.004).catch(() => null);
    return ward || province ? { ward, province } : { none: true, noCache: true };
  });
  return json(data.none ? { ward: null, province: null } : data, 200, keep(!!(data.ward && data.province), 7));
}

// ---------- Vùng lái xe 5 – 10 – 15 phút (ArcGIS Service Areas) ----------
// Cần ARCGIS_KEY có quyền Routing → Service areas. Miễn phí 5.000 vùng/tháng (mỗi căn 3 vùng), nhớ đệm 30 ngày theo toạ độ.
// Chưa có quyền / lỗi: trả { none: true } và KHÔNG nhớ đệm — app tự bỏ cảnh này.
// 1/11: CHẶN trước khi vượt 5.000 vùng miễn phí (vượt là $50/1.000 vùng khi bật trả theo lượt). Đếm 30 ngày gần nhất
// (`vt_map_usage`, mỗi lần gọi = 3 vùng), chừa 200 vùng cho nhiều máy chủ gọi cùng lúc. Chạm ngưỡng → trả { none } và
// KHÔNG nhớ đệm → app tự bỏ cảnh vùng lái xe; số lượt cũ ra khỏi 30 ngày thì tự mở lại. Đổi ngưỡng: biến ISO_CAP (số vùng).
// Không đọc được số liệu (thiếu TELEGRAM_SECRET, Supabase lỗi) → cho gọi như cũ (tối đa ~vài chục lần/ngày).
const isoCap = () => Number(env('ISO_CAP')) || 4800;
let isoUse = { t: 0, n: null, add: 0 };
async function isoAreasUsed() {
  if (isoUse.n != null && Date.now() - isoUse.t < 10 * 60e3) return isoUse.n + isoUse.add;
  const k = env('TELEGRAM_SECRET');
  if (!k) return null;
  try {
    const r = await rpc('vt_map_usage', { p_key: k, p_days: 30 });
    isoUse = { t: Date.now(), n: Number(r?.iso || 0) * 3, add: 0 };
  } catch { /* giữ số cũ nếu có */ }
  return isoUse.n == null ? null : isoUse.n + isoUse.add;
}
const ISO_URL = 'https://route-api.arcgis.com/arcgis/rest/services/World/ServiceAreas/NAServer/ServiceArea_World/solveServiceArea';
async function handleIsochrone(q) {
  const lat = num(q.get('lat')), lng = num(q.get('lng'));
  if (!inVN(lat, lng)) return json({ error: 'Toạ độ ngoài Việt Nam' }, 400);
  const key = arcRouteKey();
  if (!key) return json({ none: true, reason: 'chưa cấu hình' });
  const data = await cached('iso1', `${lat.toFixed(4)},${lng.toFixed(4)}`, 30 * DAY, async () => {
    const used = await isoAreasUsed();
    if (used != null && used + 3 > isoCap()) { count('iso_cap'); return { none: true, noCache: true, reason: 'hết hạn mức vùng lái xe tháng này' }; }
    const p = new URLSearchParams({
      f: 'json', token: key, facilities: `${lng},${lat}`, defaultBreaks: '5,10,15', outSR: '4326',
      travelDirection: 'esriNATravelDirectionFromFacility', outputPolygons: 'esriNAOutputPolygonSimplified',
      splitPolygonsAtBreaks: 'false', trimOuterPolygon: 'true', trimPolygonDistance: '100', trimPolygonDistanceUnits: 'esriMeters',
      outputGeometryPrecision: '15', outputGeometryPrecisionUnits: 'esriMeters',
    });
    let r;
    try { r = await getJson(ISO_URL + '?' + p, 20000, { referer: 'https://vitristudio.com/' }); }
    catch (e) { count('iso_err'); return { none: true, noCache: true, reason: 'lỗi mạng' }; }
    if (r.error) { count('iso_err'); return { none: true, noCache: true, reason: r.error.message || 'lỗi' }; }
    const areas = (r.saPolygons?.features || []).map(f => ({
      min: Math.round(f.attributes?.ToBreak || 0),
      rings: (f.geometry?.rings || []).filter(g => g.length > 3).map(g => g.map(([x, y]) => [r5(y), r5(x)])),
    })).filter(a => a.min > 0 && a.rings.length).sort((a, b) => a.min - b.min);
    if (!areas.length) return { none: true, noCache: true, reason: 'không có vùng' };
    count('arcgis_iso');
    isoUse.add += 3;
    return { areas };
  });
  return json(data, 200, keep(!data.none, 7));
}

// Chỉ trang của app được gọi (28/11). Trước đây yêu cầu KHÔNG có Origin/Referer (curl, bot) vẫn qua, và so bằng
// startsWith nên tên miền dạng vitristudio.com.xxx.com cũng qua. Trình duyệt gọi cùng trang luôn gửi
// Sec-Fetch-Site: same-origin hoặc Referer → khách không bị ảnh hưởng.
function fromApp(request, url) {
  if (request.headers.get('sec-fetch-site') === 'same-origin') return true;
  try { return new URL(request.headers.get('origin') || request.headers.get('referer')).origin === url.origin; }
  catch { return false; }
}
// Giả được Referer nên chặn thêm theo IP (binding ratelimits trong wrangler.jsonc, tính theo từng trạm Cloudflare).
// Đặt rộng vì nhiều khách dùng 4G chung một IP. Chưa có binding hoặc binding lỗi thì cho qua.
const PAID_KINDS = new Set(['nearby', 'vsearch', 'iso']); // mỗi lần tốn nhiều lượt trả phí
async function overLimit(request, kind) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return false;
  for (const name of PAID_KINDS.has(kind) ? ['MAP_LIMIT', 'MAP_PAID_LIMIT'] : ['MAP_LIMIT']) {
    const rl = env(name);
    if (!rl) continue;
    try { if (!(await rl.limit({ key: ip })).success) return true; } catch { /* bỏ qua */ }
  }
  return false;
}

export async function handleMap(request, ctx) {
  if (ctx?.waitUntil) waitUntil = p => ctx.waitUntil(p.catch(() => {}));
  if (request.method !== 'GET') return json({ error: 'Chỉ nhận GET' }, 405);
  const url = new URL(request.url);
  const q = url.searchParams;
  const kind = url.pathname.split('/').pop();
  // Đếm lấy mẫu 1/10 (đếm hết thì kẻ spam làm tốn thêm lượt ghi cơ sở dữ liệu)
  // vmcheck mở thẳng trên trình duyệt được (chỉ trả có/không, nhớ 30 phút), vẫn chịu giới hạn theo IP
  if (kind !== 'vmcheck' && !fromApp(request, url)) { if (Math.random() < 0.1) count('chan-goi-la'); return json({ error: 'Không được phép' }, 403); }
  if (await overLimit(request, kind)) { if (Math.random() < 0.1) count('chan-qua-nhanh'); return json({ error: 'Gọi quá nhanh, chờ một phút rồi thử lại.' }, 429); }
  try {
    if (kind === 'vmcheck') return await handleVmCheck();
    if (kind === 'route') return await handleRoute(q);
    if (kind === 'reverse') return await handleReverse(q);
    if (kind === 'search') return await handlePhoton(q);
    if (kind === 'lookup') return await handleLookup(q);
    if (kind === 'vsearch') return await handleVmSearch(q);
    if (kind === 'area') return await handleArea(q);
    if (kind === 'nearby') return await handleVmNearby(q);
    if (kind === 'iso') return await handleIsochrone(q);
    return json({ error: 'Không có' }, 404);
  } catch (e) {
    return json({ error: 'Dịch vụ bản đồ đang bận, thử lại sau.' }, 502);
  }
}
