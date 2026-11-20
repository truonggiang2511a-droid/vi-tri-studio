// Trang AI đạo diễn (/dao-dien.html) — chế độ MỚI cho khách mới, tách hẳn khỏi kiểu cũ (index.html giữ nguyên).
// 3 bước: dán toạ độ → dán tin đăng + chọn khách mua → Agent dựng video → (sửa nếu cần) → xuất MP4.
// Dùng lại bộ quét (js/data.js), giọng đọc + lượt (js/dd-voice.js → /api/tts, vt_me, vt_export_begin), bộ xuất (js/export.js).
import maplibregl from 'maplibre-gl';
import { parseCoords, haversineKm } from './geo.js';
import { scanArea, routeTo, pickHubs, loadHubFx, simplifyLine, CATEGORIES, loadZones, loadInfra, metroBuildNear, placesNear, guessCategory } from './data.js';
import { HUBS } from './hubs.js';
import { parseListing, summaryChips, KINDS } from './dd-parse.js';
import { BUYERS, suggestBuyer, buildStory, MUSIC_LIB, AUTO_TONE, popText, heroIndex } from './dd-agent.js';
import { createDirector3D, CAT3D, kmBetween, fmtKm, fmtSub, shortName } from './dd3d.js';
import { rpc } from './account.js';
import { SB_URL, SB_KEY } from './sb.js';
import { exportMp4, decodeAudioFile, mixAudio, canEncodeMp4 } from './export.js';
import { createHybrid } from './dd-old.js';
import { setImageryToken, preferSession, warmSession, onTileSource } from './render.js';
import { token, voiceLines, voiceOf, prefetchVoices, canExport, chargeExport, VOICE, setVoice, initialVoice, listVoices, isVbee, vbeeKey } from './dd-voice.js';
import { MAX_PHOTOS, savePhotos, loadPhotoBlobs, shrink, toBitmap, kvGet, kvPut } from './dd-photos.js';
import { track, funnel } from './track.js';
import { xuatStart, xuatCheckCrash, devClass } from './xuatlog.js';

const $ = id => document.getElementById(id);
const S = { house: null, scan: null, scanJob: null, routes: {}, anchors: [], infra: null, listing: null, buyer: null, edits: {}, manual: [], music: 'hung-hon', photos: [] };   // photos: [{ blob, url, bmp }]
const SAVE_KEY = 'vitri.dd.v1';

// ---------- bước chung ----------
function goStep(n) {
  for (const i of [1, 2, 3]) {
    $('s' + i).hidden = i !== n;
    const li = document.querySelector(`.steps li[data-s="${i}"]`);
    li.classList.toggle('on', i === n); li.classList.toggle('done', i < n);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
// Giữ điều khách đã nhập (đi đăng ký ở trang chính rồi quay lại không phải nhập lại)
function save() {
  // + mọi chỉnh sửa (tiện ích, trục đường, lời đọc, màu bìa…) và tiện ích ghim tay: đi đăng ký / mua lượt rồi quay về vẫn còn nguyên
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ coord: $('coord').value, listing: $('listing').value, buyer: S.buyer, brand: $('brand').value, music: S.music,
    edits: S.edits, manual: S.manual, bird: $('bird').checked, tone: $('tone').value })); } catch { /* bỏ qua */ }
  cloudDirty();
}
function restore() {
  // từ kiểu cũ bấm "AI đạo diễn" khi đã dán toạ độ: /dao-dien.html?c=… → điền sẵn, sang bước 2
  const c = new URLSearchParams(location.search).get('c');
  if (c) history.replaceState(null, '', location.pathname);
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { /* bỏ qua */ }
  // tin đăng / khách mua đã nhập chỉ giữ khi cùng căn (khác toạ độ là căn mới)
  if (d && (!c || d.coord === c)) {
    $('listing').value = d.listing || '';
    if (d.buyer) { S.buyer = d.buyer; S.buyerTouched = true; }
  }
  if (d) { $('brand').value = d.brand || ''; if (d.music) S.music = d.music; }
  $('coord').value = c || d?.coord || '';
  // chỉnh sửa chỉ giữ khi cùng căn; gắn lại SAU khi nhận vị trí (setHouse làm mới chỉnh sửa khi đổi căn)
  const keep = d && d.coord === $('coord').value;
  if (keep) { $('bird').checked = !!d.bird; if (d.tone) $('tone').value = d.tone; }
  if ($('coord').value) step1(true).then(() => { if (keep && S.house) { S.edits = d.edits || {}; S.manual = d.manual || []; renderPoiPick(); save(); } });
  loadPhotoBlobs().then(async blobs => { for (const b of blobs.slice(0, MAX_PHOTOS)) S.photos.push({ blob: b, url: URL.createObjectURL(b), bmp: await toBitmap(b) }); renderPhotos(); });
}

// ---------- Bước 1: toạ độ ----------
const SHORT_LINK = /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+/i;
async function readCoord(text) {
  if (SHORT_LINK.test(text)) {
    const res = await fetch('/api/resolve?u=' + encodeURIComponent(text.match(SHORT_LINK)[0])).catch(() => null);
    const j = res && await res.json().catch(() => ({}));
    if (!res?.ok || !j.url) throw new Error('Chưa mở được link Google Maps. Thử chép toạ độ (nhấn giữ vào vị trí bất động sản trên Google Maps).');
    text = j.url;
  }
  const r = parseCoords(text);
  if (!r || r.error) throw new Error('Chưa đọc được toạ độ. Dán dạng 10.7285, 106.6185 hoặc link Google Maps.');
  return { lat: r.lat, lng: r.lng };
}
async function step1(quiet = false) {
  const msg = $('coordMsg');
  msg.className = 'msg'; msg.textContent = 'Đang đọc vị trí…';
  try {
    const h = await readCoord($('coord').value.trim());
    setHouse(h);
    msg.className = 'msg ok'; msg.textContent = `Đã nhận vị trí ${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}`;
    save(); goStep(2); onListing();
  } catch (e) { if (!quiet) { msg.className = 'msg err'; msg.textContent = e.message; } else msg.textContent = ''; }
}
function setHouse(h) {
  if (S.house && haversineKm(S.house, h) < 0.01) return;
  if (proj && !proj.opening && haversineKm({ lat: proj.lat, lng: proj.lng }, h) > 0.03) detachProject();
  S.house = h; S.scan = null; S.routes = {}; S.anchors = []; S.infra = null; S.edits = {}; S.manual = [];
  startScan();
}
// Quét ngay khi có vị trí (chạy nền trong lúc khách dán tin)
function startScan() {
  const h = S.house, st = $('scanState');
  st.className = 'scan'; st.textContent = '⏳ Đang quét tiện ích quanh nhà…';
  const t0 = performance.now();
  S.scanJob = (async () => {
    const res = await scanArea(h, 5, null, m => { if (S.house === h) st.textContent = '⏳ ' + m; });
    if (S.house !== h) return null;
    S.scan = res;
    timeBucket('dd_quet', t0, [5, 10, 20, 40]);
    for (const m of S.manual) if (!res.pois.some(p => p.id === m.id)) res.pois.push(m);   // tiện ích khách đã ghim tay (giữ qua tải lại trang)
    mergeManual(proj?.opts?.manual);   // tiện ích Claude thêm theo toạ độ (video đồng bộ với Claude)
    st.className = 'scan ok'; st.textContent = `✓ Đã quét ${res.pois.length} tiện ích quanh nhà`;
    renderPoiPick();
    loadRegion(h);
    return res;
  })().catch(e => { st.className = 'scan'; st.textContent = 'Quét chưa xong: ' + (e.message || e) + '. Bấm Agent dựng video để thử lại.'; S.scanJob = null; return null; });
}
// Điểm mốc vùng (trung tâm, sân bay, ga…) + hạ tầng (sân bay có đường băng, metro đang chạy, cao tốc)
let regionJob = null, anchorJob = null;
// điểm mốc → { km, phút, đường đi } (chưa có đường đi thật thì ước lượng ×1,35 đường chim bay)
function anchorOf(x, r) {
  const kmv = r ? r.km : x.km0 * 1.35;
  const typical = kmv / Math.max(26, Math.min(70, 24 + 0.5 * kmv)) * 60;   // như app cũ: không phụ thuộc giờ kẹt xe lúc quét
  return { id: x.id, type: x.type, name: x.name, lat: x.lat, lng: x.lng, km: Math.round(kmv * 10) / 10,
    min: Math.max(1, Math.round(r && r.min > 0 ? Math.min(r.min, typical) : typical)), coords: r ? simplifyLine(r.coords, 0.015) : null };
}
function loadRegion(h) {
  const hubs = pickHubs(h);
  // 16/11: kết nối vùng mặc định có cảng biển — pickHubs (dùng chung với app cũ, không đổi) chỉ lấy cảng ≤ 40 km chim bay;
  // AI đạo diễn tìm thêm cảng gần nhất ≤ 70 km (buildStory vẫn bỏ nếu > 90 phút ô tô)
  if (!hubs.some(x => x.type === 'port')) {
    const p = HUBS.filter(x => x[0] === 'port').map(([type, name, lat, lng]) => ({ type, name, lat, lng, d: haversineKm(h, { lat, lng }) }))
      .filter(x => x.d >= 0.6 && x.d <= 70).sort((a, b) => a.d - b.d)[0];
    if (p) hubs.push({ id: 'port:' + p.name, type: 'port', name: p.name, lat: p.lat, lng: p.lng, km0: Math.round(p.d * 100) / 100 });
  }
  // có ngay số ước lượng → Agent luôn có cảnh kết nối vùng kể cả khi mạng chậm; đường đi thật về thì thay vào
  S.anchors = hubs.map(x => anchorOf(x, null));
  anchorJob = Promise.all(hubs.map(x => routeTo(h, x).catch(() => null)))
    .then(routes => { if (S.house === h) S.anchors = hubs.map((x, i) => anchorOf(x, routes[i])); }).catch(() => {});
  regionJob = (async () => {
    await anchorJob;
    if (S.house !== h) return;
    const H = [h.lng, h.lat], infra = {};
    // ga metro (điểm mốc ≤ 4 km): đoàn tàu chạy trên tuyến thật như app cũ
    await Promise.all(S.anchors.filter(a => a.type === 'metro').map(async a => { a.fx = await loadHubFx(a).catch(() => null); }));
    const ap = S.anchors.find(a => a.type === 'airport' && a.min <= 60);
    if (ap) {
      const fx = await loadHubFx({ type: 'airport', name: ap.name, lat: ap.lat, lng: ap.lng }).catch(() => null);
      if (fx?.runway) infra.airport = { name: ap.name, a: [fx.runway.a[1], fx.runway.a[0]], b: [fx.runway.b[1], fx.runway.b[0]], km: ap.km, min: ap.min };
      ap.fx = fx || null;   // vòng 9: phần vẽ kiểu app cũ — sân bay khoanh ranh sáng + máy bay cất cánh (render.js prepHubFx)
      S.airportParts = fx?.parts || null;   // ranh sân bay để khoanh vùng
    }
    // metro đang chạy gần nhất (≤ 15 km): 3–5 ga liền nhau quanh ga gần nhất để lia máy dọc tuyến
    const ms = HUBS.filter(x => x[0] === 'metro').map(x => ({ name: x[1].replace('Ga metro ', ''), at: [x[3], x[2]] }));
    if (ms.length) {
      let bi = 0; ms.forEach((m, i) => { if (kmBetween(H, m.at) < kmBetween(H, ms[bi].at)) bi = i; });
      const near = ms[bi], d = kmBetween(H, near.at);
      if (d <= 15) {
        let a = bi, b = bi;
        while (a > 0 && kmBetween(ms[a - 1].at, ms[a].at) < 3 && bi - a < 2) a--;
        while (b < ms.length - 1 && kmBetween(ms[b + 1].at, ms[b].at) < 3 && b - a < 4) b++;
        const seg = ms.slice(a, b + 1);
        if (seg.length >= 3) infra.metro = { name: near.at[1] > 15 ? 'Metro Hà Nội' : 'Metro số 1 Bến Thành – Suối Tiên', sub: `Đang chạy · ga ${near.name} ${fmtKm(d)} chim bay`,
          line: seg.map(s => s.at), stations: seg.map(s => [s.name, s.at]), nearName: near.name, nearKm: d };
      }
    }
    const ct = (S.scan?.roads || []).find(r => r.level === 3);
    if (ct) {
      const ways = (ct.ways || []).map(w => w.map(([la, ln]) => [ln, la])).filter(w => w.length > 1)
        .sort((x, y) => kmBetween(H, x[0]) - kmBetween(H, y[0])).slice(0, 6);
      const kmv = ways.length ? Math.min(...ways.flat().map(p => kmBetween(H, p))) : 99;
      if (kmv <= 15) infra.road = { name: ct.label, ways, km: kmv };
    }
    S.infra = infra;
    // hạ tầng đang thi công gần nhà (OpenStreetMap, như app cũ)
    // hạ tầng đang thi công: metro đang xây (METRO_BUILD, ga trong 3 km) + đường / cao tốc đang thi công (OSM) — như app cũ
    S.build = [...metroBuildNear(h, 3), ...(await loadInfra(h).catch(() => [])).filter(x => !x.metro)].slice(0, 3);
  })().catch(() => { S.infra = {}; });
}

// ---------- Bước 2: tin đăng + khách mua ----------
function renderUnderstood() {
  const L = S.listing;
  $('understood').hidden = !L;
  if (!L) return;
  $('chips').textContent = '';
  summaryChips(L).forEach((c, i) => { const s = document.createElement('span'); s.textContent = c; if (!i) s.className = 'kind'; $('chips').append(s); });
}
function onListing() {
  const txt = $('listing').value;
  S.listing = txt.trim() ? { ...parseListing(txt), ...(S.listingFix || {}) } : null;
  if (S.listing?.coord && !S.house) setHouse(S.listing.coord);   // tin có toạ độ → dùng luôn
  renderUnderstood();
  if (S.listing && !S.buyerTouched) S.buyer = suggestBuyer(S.listing.kind);
  renderBuyers(); save();
}
function renderInfoForm() {
  const L = S.listing || {}, f = $('infoform');
  const sel = document.createElement('select'); sel.dataset.k = 'kind';
  for (const [k, v] of Object.entries(KINDS)) sel.append(Object.assign(document.createElement('option'), { value: k, textContent: `${v.icon} ${v.label}`, selected: L.kind === k }));
  f.textContent = '';
  const field = (label, el) => { const l = document.createElement('label'); l.append(label, el); f.append(l); };
  field('Loại', sel);
  for (const [k, label, ph] of [['title', 'Tên trên ảnh bìa', 'Dự án / tên căn'], ['price', 'Giá', '3,2 tỷ'], ['dims', 'Kích thước', '5×20 m'], ['floors', 'Kết cấu', '1 trệt 2 lầu'], ['beds', 'Phòng ngủ', '3'], ['legal', 'Pháp lý', 'Sổ hồng riêng']]) {
    const i = Object.assign(document.createElement('input'), { placeholder: ph, value: L[k] ?? '' }); i.dataset.k = k; field(label, i);
  }
  f.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', () => {
    S.listingFix = S.listingFix || {};
    let v = el.value.trim();
    if (el.dataset.k === 'dims') { const m = v.match(/([\d.,]+)\s*[x×*]\s*([\d.,]+)/); if (m) { S.listingFix.w = +m[1].replace(',', '.'); S.listingFix.l = +m[2].replace(',', '.'); v = `${m[1]}×${m[2]} m`; } }
    S.listingFix[el.dataset.k] = el.dataset.k === 'beds' ? (+v || undefined) : v || undefined;
    S.listing = { ...(S.listing || { kind: 'nhapho' }), ...S.listingFix };
    renderUnderstood();
  }));
}
function renderBuyers() {
  const rec = S.listing ? suggestBuyer(S.listing.kind) : null;
  $('buyers').textContent = '';
  for (const [k, b] of Object.entries(BUYERS)) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'buyer' + (S.buyer === k ? ' on' : '');
    const ic = Object.assign(document.createElement('span'), { className: 'ic', textContent: b.icon });
    const tx = document.createElement('span'); tx.append(Object.assign(document.createElement('b'), { textContent: b.label }), Object.assign(document.createElement('small'), { textContent: b.sub }));
    el.append(ic, tx);
    if (rec === k) el.append(Object.assign(document.createElement('span'), { className: 'rec', textContent: 'AI gợi ý' }));
    el.onclick = () => { S.buyerTouched = true; S.buyer = k; renderBuyers(); save(); };
    $('buyers').append(el);
  }
  renderPoiPick();   // tiện ích gợi ý đổi theo khách mua
  renderTones();     // phong cách gợi ý đổi theo khách mua
}

// ---------- Ảnh căn nhà (tối đa 12, chỉ lưu trên máy khách) ----------
// 16/11: chấm điểm ảnh để chọn ẢNH NỀN CẢNH KẾT cho đất nền / căn hộ (nhà phố, biệt thự, nhà vườn lấy ảnh đầu = mặt tiền):
// độ nét (phương sai Laplace) + tương phản + sáng vừa + độ tươi màu, đo trên bản thu nhỏ 128 px (chạy trên máy, không gửi đi đâu)
function photoScore(bmp) {
  try {
    const s = Math.min(1, 128 / Math.max(bmp.width, bmp.height)), w = Math.max(8, Math.round(bmp.width * s)), h = Math.max(8, Math.round(bmp.height * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, Y = new Float32Array(w * h);
    let sum = 0, sum2 = 0, sat = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const r = d[i], gg = d[i + 1], b = d[i + 2], y = (0.299 * r + 0.587 * gg + 0.114 * b) / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      Y[j] = y; sum += y; sum2 += y * y; sat += mx ? (mx - mn) / mx : 0;
    }
    const n = w * h, mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    let lap = 0, lap2 = 0, m = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, v = 4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - w] - Y[i + w]; lap += v; lap2 += v * v; m++;
    }
    const sharp = Math.min(1, Math.sqrt(Math.max(0, lap2 / m - (lap / m) ** 2)) / 0.12);
    const expo = 1 - Math.min(1, Math.abs(mean - 0.52) / 0.4), contrast = Math.min(1, std / 0.25), colorful = Math.min(1, sat / n / 0.45);
    return 0.4 * sharp + 0.22 * contrast + 0.2 * expo + 0.18 * colorful;
  } catch { return 0; }
}
const heroIdx = () => heroIndex(S.listing?.kind || 'nhapho', S.photos.length, S.edits.heroIdx, S.photos.map(p => p.q ?? (p.q = photoScore(p.bmp))));
function renderPhotos() {
  const g = $('phGrid'); g.textContent = '';
  const hi = heroIdx();
  S.photos.forEach((ph, i) => {
    const d = Object.assign(document.createElement('div'), { className: 'ph' });
    d.append(Object.assign(document.createElement('img'), { src: ph.url, alt: 'Ảnh căn ' + (i + 1) }));
    if (!i) d.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'Bìa' }));
    // ★ = ảnh nền cảnh kết (giá + nút kêu gọi); bấm ảnh khác để đổi
    const st = Object.assign(document.createElement('button'), { className: 'star' + (i === hi ? ' on' : ''), textContent: i === hi ? '★ Cuối' : '☆', type: 'button' });
    st.title = i === hi ? 'Ảnh nền cảnh cuối (giá + nút kêu gọi)' : 'Chọn làm ảnh nền cảnh cuối';
    st.onclick = () => { S.edits.heroIdx = i; save(); renderPhotos(); if (story) edited(); };
    d.append(st);
    const x = Object.assign(document.createElement('button'), { className: 'x', textContent: '✕', type: 'button' });
    x.setAttribute('aria-label', 'Bỏ ảnh này');
    x.onclick = () => {
      URL.revokeObjectURL(ph.url); ph.bmp.close?.(); S.photos.splice(i, 1);
      const h = S.edits.heroIdx; if (Number.isInteger(h)) S.edits.heroIdx = h === i ? undefined : h > i ? h - 1 : h;   // giữ đúng ảnh ★ khách đã chọn
      photosChanged();
    };
    d.append(x); g.append(d);
  });
  if (S.photos.length < MAX_PHOTOS) {
    const a = Object.assign(document.createElement('button'), { className: 'ph-add', type: 'button' });
    a.append(Object.assign(document.createElement('b'), { textContent: '＋' }), document.createTextNode(S.photos.length ? 'Thêm' : 'Thêm ảnh'));
    a.onclick = () => $('phInput').click();
    g.append(a);
  }
}
let phBusy = false;
async function addPhotos(files) {
  if (phBusy) return; phBusy = true;
  const room = MAX_PHOTOS - S.photos.length, list = files.filter(f => /^image\//.test(f.type)).slice(0, room);
  const note = Object.assign(document.createElement('div'), { className: 'ph-busy' });
  $('phGrid').append(note);
  for (let i = 0; i < list.length; i++) {
    note.textContent = `Đang thêm ảnh ${i + 1}/${list.length}…`;
    try { const b = await shrink(list[i]); S.photos.push({ blob: b, url: URL.createObjectURL(b), bmp: await toBitmap(b) }); } catch { /* ảnh lỗi: bỏ qua */ }
  }
  if (files.length > room) alert(`Tối đa ${MAX_PHOTOS} ảnh — đã lấy ${room} ảnh đầu.`);
  $('phInput').value = ''; phBusy = false;
  photosChanged();
}
function photosChanged() {
  savePhotos(S.photos.map(p => p.blob));
  kvPut('photosHouse', houseKey());   // ảnh này của căn nào (video mở từ link Claude chỉ nạp ảnh đúng căn)
  renderPhotos();
  if (story) edited();
}

// ---------- Bước 3: Agent ----------
// 16/11 (Giang: các bước Agent chạy nhanh quá, khách không kịp thấy): mỗi bước quay ~1,2–1,6 s rồi mới tick xong (việc thật lâu hơn
// thì chờ việc thật); thêm bước "Kết nối vùng" cho khách thấy Agent tính đường lên trung tâm, sân bay, cảng biển
const TASKS = ['Quét tiện ích quanh nhà', 'Tìm đường đi thật tới tiện ích', 'Kết nối vùng: trung tâm, sân bay, cảng biển', 'Chọn tiện ích hợp với khách mua', 'Viết lời đọc theo số liệu thật', 'AI đọc lời bằng giọng thật', 'Dựng cảnh 3D'];
function setTask(i, extra = '') {
  const lis = $('tasks').children;
  for (let j = 0; j < lis.length; j++) { lis[j].className = j < i ? 'done' : j === i ? 'run' : ''; lis[j].dataset.x = j === i ? extra : ''; }
  if (lis[i]) lis[i].lastChild.textContent = TASKS[i] + (extra ? ` · ${extra}` : '');
}
let taskAt = 0;
async function nextTask(i, extra) {
  const w = 1200 + 400 * Math.random() - (performance.now() - taskAt);
  if (w > 0) await tick(w);
  taskAt = performance.now(); setTask(i, extra);
}
async function runAgent() {
  if (!S.house) { goStep(1); return; }
  agentDone = false;
  const tA = performance.now();
  if (!S.listing) S.listing = { kind: 'nhapho' };
  if (!S.buyer) S.buyer = suggestBuyer(S.listing.kind);
  save(); goStep(3);
  stop(); funnel('dd_agent');
  $('agent').hidden = false; $('studio').hidden = true;
  $('tasks').textContent = '';
  for (const t of TASKS) { const li = document.createElement('li'); li.append(document.createElement('i'), document.createTextNode(t)); $('tasks').append(li); }
  taskAt = performance.now(); setTask(0);
  if (!S.scan) { if (!S.scanJob) startScan(); await S.scanJob; }
  if (!S.scan) { $('tasks').lastChild.after(Object.assign(document.createElement('li'), { textContent: 'Quét chưa được, kiểm tra mạng rồi bấm lại.' })); return; }
  await nextTask(1);
  const st0 = buildStory(storeData(), S.listing, S.buyer, S.edits), chosen = st0.pois.map(p => p.id);
  // 16/11 chiều (Giang: trên điện thoại chờ lâu): đọc giọng TRƯỚC các câu chắc chắn không đổi (mở đầu, căn nhà, kêu gọi, ảnh…)
  // song song với tìm đường đi / kết nối vùng; đường ra trục đường lớn cũng chạy song song luôn (trước chạy sau cùng)
  if (token()) { await Promise.race([voicePick, tick(3000)]); prefetchVoices(stableLines(), S.house); }   // giọng đã chọn xong mới đọc trước
  const roadJob = roadRoutesFor(st0);
  await routesFor(chosen);
  // ranh vùng quan trọng của tiện ích đã chọn + tiện ích trong vòng radar (khu công nghiệp, bệnh viện, đại học, công viên…, tối đa 3)
  const zIds = new Set([...chosen, ...(st0.radar?.pts || []).map(p => p.id)]);
  S.zones = await loadZones(S.scan.pois.filter(p => zIds.has(p.id))).catch(() => []);
  await nextTask(2);
  // đường đi thật lên trung tâm / sân bay / cảng (chưa về sau 12 s thì dùng số ước lượng đã có sẵn trong S.anchors)
  if (anchorJob) await Promise.race([anchorJob, tick(12000)]);
  // vùng mốc lớn: KCN gần nhà nhất (≤ 6 km) + cảng biển trong điểm mốc vùng — khoanh ranh, in tên trên vùng
  if (regionJob) await Promise.race([regionJob, tick(6000)]);
  const kcn = S.scan.pois.filter(p => p.cat === 'kcn' && p.km <= 6 && !chosen.includes(p.id)).sort((a, b) => a.km - b.km).slice(0, 2);
  const ports = (S.anchors || []).filter(a => a.type === 'port').slice(0, 1).map(a => ({ id: a.id, cat: 'kcn', name: a.name, lat: a.lat, lng: a.lng, km: a.km }));
  S.landZones = await loadZones([...kcn, ...ports]).catch(() => []);
  await nextTask(3);
  await nextTask(4);
  if (regionJob) await Promise.race([regionJob, tick(6000)]);
  await roadJob;
  await roadRoutesFor(currentStory());   // trục khác lúc đầu (ít gặp): chỉ gọi phần còn thiếu
  story = currentStory();
  await nextTask(5);
  await voiceAll(n => setTask(5, n));
  await nextTask(6);
  await nextTask(7);
  await tick(650);   // dấu tick cuối kịp hiện rồi mới mở bảng dựng
  $('agent').hidden = true; $('studio').hidden = false;
  timeBucket(token() ? 'dd_dung' : 'dd_dung_kg', tA, [15, 25, 40, 60]);   // kg = chưa đăng nhập (không đọc giọng)
  fillMusic();
  await rebuild();
  agentDone = true;
  afterAgent();
}
const tick = ms => new Promise(r => setTimeout(r, ms));
// 16/11: đo thời gian THẬT trên máy khách (phễu nội bộ, không gửi Meta/TikTok): dd_quet_10 = quét xong trong ≤ 10 s, _99 = lâu hơn mức cuối.
// Thời gian xuất video + lần văng đo bằng js/xuatlog.js (dxt_* / dxv_* / dxr_*). Báo cáo 7h sáng đọc các bậc này.
function timeBucket(name, t0, steps, unit = 1) {
  const sec = (performance.now() - t0) / 1000, b = steps.find(x => sec <= x);
  funnel(`${name}_${b != null ? b / unit : 99}`);
}
// Câu nào KHÔNG phụ thuộc đường đi / số phút / kết nối vùng: dựng kịch bản 2 lần — dữ liệu hiện có và dữ liệu giả lệch hẳn
// (đường đi, phút, điểm mốc, hạ tầng khác) — câu giống hệt nhau ở cả 2 bản là câu chắc chắn không đổi → đọc trước được, không phí lượt giọng
function stableLines() {
  try {
    const d = storeData(), fake = {};
    for (const p of d.pois) fake[p.id] = { km: p.km * 1.7 + 0.37, min: 23, coords: null };
    const roadFake = Object.fromEntries((d.roads || []).map(r => [r.id, { km: 7.7, min: 19, coords: null }]));
    const d2 = { ...d, routes: fake, roadRoutes: roadFake, anchors: (d.anchors || []).map(a => ({ ...a, km: a.km + 3.3, min: a.min + 7 })),
      infra: {}, build: [] };
    const e = { ...S.edits, tone: $('tone').value, bird: $('bird').checked, watermark: $('brand').value.trim(), photos: S.photos.map(p => p.bmp),
      photoQ: S.photos.map(p => p.q ?? (p.q = photoScore(p.bmp))) };
    const a = allLines(buildStory(d, S.listing, S.buyer, e)), b = new Set(allLines(buildStory(d2, S.listing, S.buyer, e)));
    return a.filter(t => b.has(t));
  } catch { return []; }
}
// 16/11 chiều (đo: có lúc máy chủ chỉ đường chậm tới 11 s ở chỗ mới quét lần đầu): chờ tối đa ROUTE_WAIT; đường nào chưa về thì dùng
// số ước lượng (như khi không tìm được đường) và BỎ kết quả về trễ — để lời đọc không đổi sau khi đã đọc giọng
const ROUTE_WAIT = 7000;
async function settle(jobs, onLate) {
  let late = false;
  await Promise.race([Promise.all(jobs.map(j => j.run().then(r => { if (!late) j.set(r); }))), tick(ROUTE_WAIT)]);
  late = true;
  for (const j of jobs) if (!j.isSet()) { j.set(null); onLate?.(); }
}
async function routesFor(ids) {
  const byId = new Map(S.scan.pois.map(p => [p.id, p]));
  await settle(ids.filter(id => !(id in S.routes) && byId.has(id)).map(id => ({
    run: () => routeTo(S.house, byId.get(id)).catch(() => null), set: r => { S.routes[id] = r; }, isSet: () => id in S.routes })));
}
// đường đi thật từ nhà ra điểm gần nhất của từng trục đường lớn (để nói "ra Quốc lộ 1A khoảng 3 phút" + vẽ line); trục ngay trước nhà thì thôi
async function roadRoutesFor(st) {
  S.roadRoutes ||= {};
  await settle((st?.roads || []).filter(r => r.near && r.km >= 0.12 && !(r.id in S.roadRoutes)).map(r => ({
    run: () => routeTo(S.house, { lat: r.near[1], lng: r.near[0] }).catch(() => null), set: x => { S.roadRoutes[r.id] = x; }, isSet: () => r.id in S.roadRoutes })));
}
function storeData() {
  const sc = S.scan || { pois: [] };
  return { house: S.house, pois: sc.pois, streets: sc.streets, roads: sc.roads, roadsAll: sc.roads, zones: S.zones, build: S.build, airportParts: S.airportParts, routes: S.routes, anchors: S.anchors, infra: S.infra, landZones: S.landZones, area: sc.area, roadRoutes: S.roadRoutes,
    ward: sc.area?.ward?.name || sc.admin?.commune || '' };
}
// mọi câu lời đọc của kịch bản hiện tại (theo thứ tự cảnh)
// bản ngắn: tiện ích trong cảnh gom cụm không đọc câu riêng (chỉ đọc 1 câu cụm) → không tốn giọng cho câu không dùng
// lượn 360°: chỉ đọc 1 câu cho cả cảnh, không đọc câu riêng từng tiện ích
// radar (mặc định từ vòng 8) / lượn 360°: không có cảnh riêng từng tiện ích → không đọc câu tiện ích lẻ (không tốn giọng)
const poiLinesUsed = st => (st.orbit || st.flow === 'radar' ? [] : st.lines.poi.filter((_, i) => !st.cluster?.idx.includes(i)));
const allLines = st => {
  const L = st.lines;
  // vòng 9: phần sau mở đầu vẽ kiểu app cũ (dd-old.js) → đọc đúng lời từng cảnh app cũ: bán kính, kết nối vùng, hạ tầng, từng trục đường,
  // từng tiện ích, tổng kết, kết, ảnh
  if (st.engine === 'old') return [L.intro, st.lot ? L.lot : L.house, L.overview, ...L.anchor, st.build?.length ? L.build : null, ...(L.rd || []), ...L.poi,
    st.pois.length ? L.summary : null, L.cta, st.photos?.length ? L.photos : null].filter(Boolean);
  return [L.intro, st.lot ? L.lot : L.house, L.roads, st.radar ? L.radar : null, L.build, L.photos, ...poiLinesUsed(st), st.cluster ? L.cluster : null, st.orbit ? L.orbit : null, ...L.anchor, L.airport, L.metro, L.road, st.score && !st.statsInCta ? L.score : null, L.cta].filter(Boolean);
};
// dữ liệu quét thật cho phần vẽ kiểu app cũ (dd-old.js)
// 15/11 22:54 (Giang: bỏ hiệu ứng máy bay cất cánh): điểm mốc sân bay không mang fx → phần vẽ kiểu app cũ chỉ vẽ đường đi + thẻ như app cũ mặc định
const hybridSrc = () => ({ house: S.house, pois: S.scan?.pois || [], routes: S.routes, roads: S.scan?.roads || [], streets: S.scan?.streets || null, admin: S.scan?.admin || null,
  ward: storeData().ward, anchors: (S.anchors || []).map(a => a.type === 'airport' ? { ...a, fx: null } : a), build: S.build || [], zones: S.zones || [], listing: S.listing || {}, brand: $('brand').value.trim() });
// đạo diễn theo kiểu đã chọn: mặc định mở đầu 3D + phần sau vẽ như app cũ; radar = toàn bộ 3D (dd3d)
const makeDirector = (width, height, st, lite = false) => st.engine === 'old'
  ? createHybrid({ width, height, story: withVoice(st), src: hybridSrc(), voiceOf, lite })
  : createDirector3D({ width, height, story: withVoice(st), lite });
// Giọng: đã đăng nhập thì AI đọc các câu CÒN THIẾU (câu cũ dùng lại); chưa đăng nhập thì để trống, báo đăng ký
let voiceErr = '';
async function voiceAll(onP) {
  voiceErr = '';
  if (!token()) return false;
  try { await voiceLines(allLines(story), S.house, (d, n) => onP?.(n ? `${d}/${n} câu` : '')); return true; }
  catch (e) { voiceErr = e.status === 401 || e.status === 403 ? 'login' : (e.message || 'Giọng đọc lỗi'); return false; }
}

// ---------- Studio: xem trước + sửa ----------
let dir = null, story = null, playing = false, raf = 0, actx = null, src = null;
const musicBuf = {};
function currentStory() {
  return buildStory(storeData(), S.listing, S.buyer, { ...S.edits, tone: $('tone').value, bird: $('bird').checked, watermark: $('brand').value.trim(), photos: S.photos.map(p => p.bmp),
    photoQ: S.photos.map(p => p.q ?? (p.q = photoScore(p.bmp))) });
}
// gắn giọng đã có vào kịch bản; câu chưa có giọng thì nhịp cảnh ước theo số chữ
function withVoice(st) {
  const L = st.lines;
  return { ...st, paceByText: true, voice: { intro: voiceOf(L.intro), house: voiceOf(L.house), lot: voiceOf(L.lot), poi: L.poi.map(voiceOf), anchor: L.anchor.map(voiceOf),
    photos: voiceOf(L.photos), roads: voiceOf(L.roads), radar: voiceOf(L.radar), build: voiceOf(L.build), airport: voiceOf(L.airport), metro: voiceOf(L.metro), road: voiceOf(L.road), score: voiceOf(L.score), cta: voiceOf(L.cta),
    cluster: voiceOf(L.cluster), orbit: voiceOf(L.orbit) } };
}
// 16/11 (Giang: video tự phát, bấm Phát nữa bị trùng nhạc): dựng xong KHÔNG tự phát — khách bấm ▶ mới phát; nhạc + giọng trộn sẵn
// ngay sau khi dựng (mixReady) nên bấm là phát liền
async function rebuild() {
  stop();
  story = currentStory();
  renderBoard();
  dir?.destroy();
  const cv = $('cv');
  // chữ in dẹt / ảnh bìa dùng Montserrat 900: chờ phông tải xong mới vẽ (không thì khung đầu ra phông dự phòng)
  await Promise.all(['900 40px Montserrat', '800 40px "Be Vietnam Pro"'].map(f => document.fonts.load(f).catch(() => {})));
  dir = makeDirector(cv.width, cv.height, story);
  await dir.ready;
  dir.live(cv.getContext('2d'));
  dir.setFrame(0.01);
  setDirty(false);
  const missing = allLines(story).some(t => !voiceOf(t));
  $('voiceNote').hidden = !(missing && (!token() || voiceErr === 'login'));
  mixReady();
  snapSoon();
}
// Khách sửa (thứ tự / thêm / bỏ / lời): cập nhật bảng ngay, video tạo lại khi bấm "Tạo lại video" (đọc lại câu đã sửa)
let dirty = false;
function setDirty(v) {
  dirty = v; $('redo').hidden = !v; $('stale').hidden = !v; $('exportBox').hidden = v;
  if (v) { stop(); $('play').classList.add('hide'); }
}
function edited() { story = currentStory(); renderBoard(); setDirty(true); save(); snapSoon(); }

// ✨ AI viết lời (máy chủ /api/script như kiểu cũ: Claude viết + máy bắt số bịa + biên tập). Công thức theo khách:
// mua để ở → P.A.S (đánh trúng nỗi đau), đầu tư cho thuê → A.I.D.A, kết nối khu vực → chuyên gia đầu tư. Lời dài hơn (long).
const TONES = [['auto', '🤖 AI tự chọn theo khách'], ['pas', 'P.A.S · đánh trúng nỗi đau'], ['aida', 'A.I.D.A · chú ý → hành động'],
  ['ke-chuyen', 'Kể chuyện · cảm xúc'], ['chuyen-gia', 'Chuyên gia đầu tư'], ['chot-sale', 'Chốt sale mạnh']];
const autoTone = b => AUTO_TONE[b] || 'pas';
// nỗi lo thật của từng loại khách (gửi AI viết lời để câu móc / đoạn quay quanh căn đánh trúng, rồi lấy số liệu thật làm lời giải)
const PAINS = {
  o: ['con đi học xa, sáng nào cũng vội', 'đi chợ, khám bệnh bất tiện', 'nhà chật, không đủ phòng', 'giấy tờ không rõ ràng'],
  vung: ['mua chỗ hạ tầng đứng yên', 'kết nối kém, xa trung tâm', 'giá mỗi mét vuông cao so với vị trí', 'pháp lý không rõ'],
  thue: ['phòng trống, không có người thuê', 'xa nơi người thuê làm việc, đi học', 'ít phòng, khó cho thuê', 'pháp lý không rõ'],
};
// gắn nhãn "· Gợi ý" vào kiểu lời hợp với khách mua đang chọn (khách vẫn tự chọn)
function syncTone() {
  const rec = autoTone(S.buyer);
  for (const o of $('tone').options) {
    const base = (TONES.find(x => x[0] === o.value) || [])[1] || o.textContent;
    o.textContent = o.value === rec ? `${base} · Gợi ý` : o.value === 'auto' ? `${base} (${(TONES.find(x => x[0] === rec) || [])[1]?.split(' · ')[0] || rec})` : base;
  }
  renderTones();
}
// Bước 2: chọn phong cách lời ngay dưới loại khách (đổi là lời Agent đổi theo; "AI viết lời" cũng theo phong cách này)
function renderTones() {
  const box = $('tones'); if (!box) return;
  const rec = autoTone(S.buyer), cur = $('tone').value;
  box.textContent = '';
  for (const [v, t] of TONES) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'rchip' + (cur === v ? ' on' : ''), textContent: (v === 'auto' ? '🤖 Tự chọn theo khách' : t.split(' · ')[0]) + (v === rec ? ' · Gợi ý' : '') });
    b.onclick = () => setTone(v);
    box.append(b);
  }
}
function setTone(v) {
  $('tone').value = v; S.edits.tone = v; save();
  if (story && !$('studio').hidden) edited(); else renderTones();
}
const BDS = { nhapho: ['Căn nhà', 'đi xem nhà'], bietthu: ['Biệt thự', 'đi xem biệt thự'], nhavuon: ['Nhà vườn', 'đi xem nhà vườn'], canho: ['Căn hộ', 'đi xem căn hộ'], datnen: ['Lô đất', 'đi xem lô đất'] };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function aiPayload(st, L) {
  const [loai, xem] = BDS[st.kind] || BDS.nhapho, mm = p => (p.min != null ? Math.max(1, Math.round(p.min)) : null);
  const facts = {
    loai_bds: loai, tieu_de: L.title || null,
    thong_tin_nha: { gia: (!st.priceEnd && L.price) || null, dien_tich: L.dims || (L.area ? `${L.area} m²` : null), loai_dat: L.thoCu || null, so_tang: (st.kind !== 'canho' && L.floors) || null,
      can_ho_o_tang: L.level || null, phong_ngu: L.beds || null, phap_ly: L.legal || null, duong_truoc_nha: L.road || null },
    diem_noi_bat: L.highlights || [], khach_muc_tieu: { o: 'o', thue: 'cho_thue', vung: 'dau_tu' }[S.buyer] || null, noi_lo_khach_hang: PAINS[S.buyer] || null,
    xa_phuong: storeData().ward || L.ward || null, tinh_thanh: L.province || null,
    duong_lon: st.roads.map(r => ({ ten: r.name, cach: fmtKm(r.km) })),
    tien_ich: st.pois.map(p => ({ ten: p.name, cach: fmtKm(p.km), phut_xe_may: mm(p) })),
    ket_noi_vung: st.anchors.map(a => ({ ten: a.name, duong_di_km: a.km, phut_o_to: a.min })),
    ha_tang_dang_thi_cong: st.build.map(b => ({ ten: b.name, cach: fmtKm(b.km) })),
  };
  const seg = {}, back = {};
  const put = (k, local, v) => { seg[k] = v; back[k] = local; };
  // 15/11 (Giang): mở đầu khoanh sáng tỉnh → xã/phường rồi bay xuống ghim; câu móc GIÁ / LỢI ÍCH trước, sau đó nói xã, tỉnh.
  // Cảnh căn nhà: máy lượn 360° quanh nhà, đọc ĐỦ thông tin rồi mới lùi ra tiện ích
  // 15/11 vòng 5 (Giang): câu đầu NÓI VỊ TRÍ trước, đúng thứ tự hình (tỉnh → xã), rồi mới tới câu móc
  // 15/11 vòng 7 (Giang): thứ tự câu chuyện = (quả địa cầu →) tỉnh → xã → căn nhà → kết nối vùng → trục đường lớn → radar + tiện ích
  // → hạ tầng đang thi công → tổng kết → kêu gọi. Phần tỉnh: nói quy mô tỉnh bằng SỐ LIỆU THẬT (dân số sau sáp nhập), không bịa dự án
  put('intro', 'intro', { canh: `Mở đầu: ${st.globe ? 'từ quả địa cầu bay xuống, ' : ''}bản đồ khoanh sáng trọn tỉnh/thành (khối nổi) rồi xã/phường, máy bay xuống ghim bất động sản. Câu 1 NÓI VỊ TRÍ TRƯỚC, đúng thứ tự hình: thuộc tỉnh/thành nào${popText(facts.tinh_thanh || st.area?.province?.name) ? ' (kèm dan_so_tinh — chỉ dùng đúng số này, không thêm số khác về tỉnh)' : ''} rồi xã/phường nào. Câu 2 là câu móc đánh trúng MỘT nỗi lo trong noi_lo_khach_hang (hoặc GIÁ / LỢI ÍCH mạnh nhất có số liệu thật)`,
    ...(popText(facts.tinh_thanh || st.area?.province?.name) ? { dan_so_tinh: `${popText(facts.tinh_thanh || st.area?.province?.name)} dân (sau sắp xếp 2025)` } : {}) });
  // 15/11 22:21 (Giang): máy lượn TRỌN 1 vòng cận cảnh (≥ 15 s) → lời đoạn này phải đủ dài (45–60 chữ), kể như đang dẫn khách đi một vòng
  put('house', st.lot ? 'lot' : 'house', { canh: (st.lot ? 'Máy quay lượn TRỌN 1 vòng 360 độ cận cảnh quanh lô đất (khoanh ranh lô)' : 'Máy quay lượn TRỌN 1 vòng 360 độ cận cảnh quanh bất động sản, khối nhà nổi lên, tên đường trước nhà in trên mặt đường')
    + '. Viết 45 tới 60 chữ (đủ cho cả vòng lượn), kể lần lượt như đang dẫn khách đi một vòng: câu mở mời nhìn cận cảnh → nằm ở đường nào (duong_truoc_nha) → kích thước, diện tích → số tầng, phòng ngủ → pháp lý → 1–2 ý trong diem_noi_bat (nếu có) → câu chuyển sang xem xung quanh. Mỗi thông số gắn với lời giải cho nỗi lo của khách (noi_lo_khach_hang), đúng PHONG CÁCH được yêu cầu. CHỈ dùng thông tin có trong dữ liệu — thiếu thì viết ngắn hơn, không bịa nội thất, view, an ninh. Chỉ nói khan hiếm nếu diem_noi_bat có ý đó' });
  st.anchors.forEach(a => put('anchor:' + a.id, 'anchor:' + a.id, { canh: 'Kết nối vùng: đường đi thật từ nhà tới điểm mốc', ten: a.name, duong_di_km: a.km, phut_o_to: a.min }));
  if (st.infra?.airport) put('airport', 'airport', { canh: 'Kết nối vùng: sân bay, máy bay cất cánh', ten: st.infra.airport.name, duong_di_km: st.infra.airport.km, phut_o_to: st.infra.airport.min });
  if (st.infra?.metro) put('metro', 'metro', { canh: 'Kết nối vùng: tuyến metro', ten: st.infra.metro.name, ga_gan_nhat: st.infra.metro.nearName, ga_cach: fmtKm(st.infra.metro.nearKm) });
  if (st.infra?.road) put('road', 'road', { canh: 'Kết nối vùng: tuyến cao tốc / đường lớn', ten: st.infra.road.name, cach: fmtKm(st.infra.road.km) });
  const OLD = st.engine === 'old';
  // vòng 9 (vẽ như app cũ): cảnh bán kính + mỗi trục đường một cảnh riêng + bảng tổng kết
  // 16/11 (Giang): kịch bản trả lời 2 câu khách hay hỏi — "Sống ở đây có tiện không?" và "Vì sao nên mua?"; giọng gần gũi, chân thành, tạo niềm tin
  if (OLD) put('overview', 'overview', { canh: `Toàn cảnh: vòng bán kính ${String(st.oldR).replace('.', ',')} km quanh nhà vẽ ra. Mở bằng ĐÚNG câu hỏi "Sống ở đây có tiện không?" rồi 1 câu trả lời ngắn: trong bán kính này có đủ những loại tiện ích nào (nói tên loại như trường học, chợ, bệnh viện), cùng mấy trục đường lớn`,
    ban_kinh_km: st.oldR, loai_tien_ich: [...new Set(st.pois.map(p => CATEGORIES[p.cat]?.label || p.cat))], so_truc_duong: st.roads.length });
  if (OLD) st.roads.forEach(r => put('rd:' + r.id, 'rd:' + r.id, { canh: 'Một trục đường lớn: line trục sáng lên, tên đường chữ 3D trên mặt đường. 1 câu ngắn, gọi đúng tên trong "ten": cach_nha dưới 120 m thì nói nằm ngay trục này, không thì nói từ nhà ra trục bao nhiêu phút (dùng đúng phut_xe)',
    ten: r.name, cach_nha: fmtKm(r.km), phut_xe: r.km < 0.12 ? null : r.min }));
  const whyCanh = 'Trả lời câu hỏi "Vì sao nên mua?": mở bằng ĐÚNG câu hỏi đó (có thể thêm tên loại bất động sản), rồi nêu ĐÚNG các lý do trong ly_do theo ĐÚNG thứ tự, lý do CUỐI là lý do lớn nhất (nói rõ là lý do lớn nhất), giữ nguyên mọi con số; KHÔNG thêm lý do khác, KHÔNG hứa tăng giá, lời lãi, rẻ hơn khu vực. Giọng gần gũi, chân thành như người môi giới có tâm đang tư vấn, tạo niềm tin. Kết bằng 1 câu ngắn mời kiểm tra số liệu trên bản đồ';
  if (OLD && st.pois.length && st.statsTitle) put('summary', 'summary', { canh: 'Tổng kết trước lời kêu gọi: thẻ "VÌ SAO NÊN MUA?" với các ô lý do hiện trên cùng. ' + whyCanh, ly_do: st.reasons });
  else if (OLD && st.pois.length) put('summary', 'summary', st.stats?.length >= 2
    ? { canh: 'Tổng kết trước lời kêu gọi: thẻ 3 con số lớn hiện trên cùng, bảng tiện ích ở dưới. 1–2 câu đọc đúng 3 con số này rồi chốt giá trị vị trí (không hứa lời lãi)', con_so: st.stats.map(x => `${x.n} ${x.unit} ${x.sub}`) }
    : { canh: `Tổng kết: bảng các tiện ích vừa giới thiệu kèm khoảng cách, vòng bán kính ${String(st.oldR).replace('.', ',')} km. 1 câu chốt ngắn: mọi tiện ích đều trong bán kính này, sống tiện, đi lại dễ (không hứa lời lãi)`, ban_kinh_km: st.oldR });
  // vòng 7: trục đường hiện TỪNG trục một đúng lúc giọng nói tên → mỗi trục MỘT câu ngắn, đúng thứ tự, gọi đúng tên trong "ten"
  if (!OLD && st.roads.length) put('roads', 'roads', { canh: 'Trên hình hiện câu hỏi "SỐNG Ở ĐÂY CÓ TIỆN KHÔNG?". Câu đầu đọc ĐÚNG câu hỏi "Sống ở đây có tiện không?". Sau đó các trục đường lớn quanh nhà hiện LẦN LƯỢT từng trục (máy bay tới trục, đường đi thật từ nhà ra trục chạy ra kèm số phút). Mỗi trục MỘT câu ngắn theo ĐÚNG thứ tự danh sách, gọi đúng tên trong "ten": trục cach_nha dưới 120 m là nằm ngay trục đó, trục khác nói từ nhà ra bao nhiêu phút (dùng đúng phut_xe)',
    duong: st.roads.map(r => ({ ten: r.name, cach_nha: fmtKm(r.km), phut_xe: r.km < 0.12 ? null : r.min })) });
  // vòng 8: radar = cả phần tiện ích; nhãn tiện ích bật đúng lúc giọng nói TÊN (dd3d tìm tên trong câu) → AI kể đúng tên ngắn, đúng thứ tự
  if (st.radar) put('radar', 'radar', { canh: `MỘT cảnh radar: máy xoay chậm, tia quét vòng bán kính ${String(st.radar.r).replace('.', ',')} km quanh nhà, tiện ích hiện lần lượt kèm tên. Đây là phần TRẢ LỜI tiếp câu hỏi "Sống ở đây có tiện không?"${st.roads.length ? '' : ' (chưa hỏi ở cảnh trước → câu đầu đọc đúng câu hỏi này)'}. Câu 1 rất ngắn: trong bán kính này có so_tien_ich tiện ích tiêu biểu. Sau đó kể LẦN LƯỢT các tiện ích trong doc_ten theo ĐÚNG thứ tự, gọi đúng tên ngắn trong "ten" (không đổi tên) kèm số phút hoặc khoảng cách, mỗi tiện ích một câu ngắn, có thể gắn với nỗi lo của khách (noi_lo_khach_hang)`,
    ban_kinh_km: st.radar.r, so_tien_ich: st.radar.n, doc_ten: st.radar.pts.map((p, i) => p.named ? { ten: st.radar.words[i], cach: p.label.split(' · ')[1] } : null).filter(Boolean) });
  const inCl = i => st.cluster?.idx.includes(i);
  if (!st.orbit && st.flow !== 'radar') st.pois.forEach((p, i) => { if (!inCl(i)) put('poi:' + p.id, 'poi:' + p.id, { canh: 'Tiện ích: đường đi thật từ nhà sáng lên', ten: p.name, cach: fmtKm(p.km), phut_xe_may: mm(p) }); });
  // vòng 6: nhãn bật đúng lúc giọng đọc nói TÊN tiện ích (dd3d tìm tên trong câu) → AI phải kể từng tiện ích bằng đúng tên ngắn, đúng thứ tự
  if (st.orbit) put('poi:vong', 'orbit', { canh: 'MỘT cảnh máy lượn 360 độ góc xa quanh nhà, các tiện ích lần lượt hiện nhãn lên (không vẽ đường đi). Mở bằng 1 câu rất ngắn, rồi kể LẦN LƯỢT TỪNG tiện ích theo đúng thứ tự danh sách, gọi đúng tên ngắn trong "ten" (không đổi tên) kèm số phút hoặc khoảng cách, mỗi tiện ích một câu ngắn',
    ban_kinh: fmtKm(st.orbit.r), tien_ich: st.orbit.idx.map(i => ({ ten: shortName(st.pois[i].name), cach: fmtKm(st.pois[i].km), phut_xe_may: mm(st.pois[i]) })) });
  if (st.cluster) put('poi:cum', 'cluster', { canh: 'MỘT cảnh gom nhiều tiện ích quanh nhà, ghim lần lượt bật lên. 1 câu ngắn: trong bán kính bao xa còn có những loại tiện ích nào (nói tên loại như chợ, trạm y tế, công viên; không cần đọc hết tên riêng)',
    ban_kinh: fmtKm(st.cluster.r), tien_ich: st.cluster.idx.map(i => ({ ten: st.pois[i].name, cach: fmtKm(st.pois[i].km) })) });
  if (st.build.length) put('infra', 'build', { canh: 'Hạ tầng đang thi công gần nhà (nét đứt cam). Không nói năm hoàn thành, không hứa tăng giá', tuyen: facts.ha_tang_dang_thi_cong });
  if (!OLD && st.score && !st.statsInCta) put('score', 'score', st.statsTitle
    ? { canh: 'Tổng kết trước lời kêu gọi: thẻ "VÌ SAO NÊN MUA?" với các ô lý do hiện trên hình. ' + whyCanh, ly_do: st.reasons }
    : { canh: 'Tổng kết trước lời kêu gọi: 3 con số lớn hiện trên hình. 1–2 câu đọc đúng 3 con số này rồi chốt giá trị vị trí (không hứa lời lãi)', con_so: st.stats.map(x => `${x.n} ${x.unit} ${x.sub}`) });
  // câu ảnh thực tế giữ đúng chữ Giang chốt 16/11 ("Đây là hình ảnh thực tế của sản phẩm, anh chị xem qua nhé.") → không gửi AI viết lại
  const key = st.ctaKey.toLowerCase();
  put('outro', 'cta', { ...(L.price ? { gia: L.price } : {}), canh: `Kết video: ${st.priceEnd ? 'LẦN ĐẦU nói giá bán (gia) trong video — đọc giá rõ ràng' : 'nhắc giá (nếu có)'} rồi kêu gọi ${st.ctaMode === 'binhluan' ? `BÌNH LUẬN chữ '${key}' hoặc nhắn tin` : `NHẮN TIN chữ '${key}'`} để nhận thông tin chi tiết về sản phẩm (đúng các chữ này) rồi DỪNG: không hẹn đi xem, không mời xem nhà/đất, không thêm câu nào sau đó. Không đọc số điện thoại.` });
  return { facts, segments: seg, back };
}
async function aiWrite() {
  const msg = $('aiMsg'), btn = $('aiWrite');
  if (!token()) { msg.textContent = 'Đăng ký miễn phí để AI viết lời.'; if (confirm('Đăng ký miễn phí để AI viết lời hay hơn. Đi đăng ký?')) goLogin(); return; }
  btn.disabled = true; msg.textContent = '✨ AI đang viết lời… (khoảng 15–30 giây)';
  try {
    const { facts, segments, back } = aiPayload(currentStory(), S.listing || {});
    const tone = $('tone').value === 'auto' ? autoTone(S.buyer) : $('tone').value;
    const res = await fetch('/api/script', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token() },
      // lời dài (Giang 15/11: giới thiệu đủ, không nhanh quá); máy quay tự giãn + đổi góc theo độ dài lời
      body: JSON.stringify({ facts, segments, tone, long: true, lat: S.house.lat, lng: S.house.lng }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'HTTP ' + res.status);
    const lines = { ...(S.edits.lines || {}) };
    let n = 0;
    // số liệu (km, m, phút, tỷ…) tô vàng như câu Agent viết
    // lời kêu gọi AI viết mà vẫn hẹn đi xem → giữ câu mẫu (Giang 16/11: kết ở "nhận thông tin chi tiết về sản phẩm")
    for (const [k, v] of Object.entries(j.segments || {})) if (back[k] && v && !(back[k] === 'cta' && /hẹn|đi xem|xem trực tiếp|tận nơi|tận mắt/i.test(v))) { lines[back[k]] = esc(v).replace(/(\d[\d.,]*\s*(km|m²|mét vuông|mét|m|phút|tỷ|triệu)?)/g, '<b>$1</b>'); n++; }
    if (!n) throw new Error('AI chưa trả lời được');
    S.edits.lines = lines;
    edited();
    msg.textContent = `✓ AI đã viết ${n} câu. Bấm "🔄 Tạo lại video" để nghe và xem.`;
  } catch (e) {
    msg.textContent = 'AI viết lời chưa được (' + e.message + '). Lời hiện tại giữ nguyên.';
  } finally { btn.disabled = false; }
}
async function redo() {
  const b = $('redo'); b.disabled = true; b.textContent = '🎙 AI đang đọc lại câu đã sửa…';
  story = currentStory();
  await routesFor(story.pois.map(p => p.id));
  await roadRoutesFor(story); story = currentStory();   // trục đường khách vừa thêm: tính đường đi + số phút
  await voiceAll(n => { if (n) b.textContent = `🎙 AI đang đọc lại… ${n}`; });
  await rebuild();
  b.disabled = false; b.textContent = '🔄 Tạo lại video';
}
async function getMusic(name) {
  if (!(name in musicBuf)) musicBuf[name] = await decodeAudioFile(await fetch(`music/${name}.m4a`).then(r => r.blob())).catch(() => null);
  return musicBuf[name];
}
const mixFor = async d => mixAudio({ music: await getMusic(S.music), voiceSegs: d.voiceSegs, sfx: { events: d.sfx, vol: 0.8 }, duration: d.duration, musicVol: 0.8 });
// ---------- Giọng đọc (20/11, Giang: khách dùng giọng Vbee làm giọng chính ở app cũ thì AI đạo diễn cũng dùng giọng đó) ----------
// CHỈ tài khoản @vitristudio.com thấy ô chọn và tự nhận giọng từ app cũ; khách thường giữ giọng mặc định (Nữ HD) như trước.
const voiceAdmin = login => /@vitristudio\.com$/i.test(String(login || ''));
let voiceList = [];
async function initVoicePick() {
  if (!token()) return;
  let login = '';
  try { login = (await rpc('vt_me', { p_token: token(), p_lat: null, p_lng: null }))?.profile?.login; } catch { return; }
  if (!voiceAdmin(login)) return;
  setVoice(initialVoice(), false);
  voiceList = await listVoices();
  fillVoices();
  $('voiceRow').hidden = false;
}
const voicePick = initVoicePick().catch(() => null);
function fillVoices() {
  const sel = $('voice'); sel.textContent = '';
  const base = voiceList.filter(v => v.provider !== 'vbee');
  // máy chủ Google: 'nu-nam' (mặc định của AI đạo diễn) = giọng Nữ HD → hiện 1 dòng, không lặp 'g-nu-hd'
  const opts = base.some(v => v.id === 'nu-nam') ? base : [{ id: 'nu-nam', label: 'Nữ (HD)' }, ...base.filter(v => v.id !== 'g-nu-hd')];
  const opt = (v, label) => Object.assign(document.createElement('option'), { value: v.id, textContent: label || v.label, selected: v.id === VOICE.id });
  const g1 = Object.assign(document.createElement('optgroup'), { label: 'Giọng của app (nhanh nhất)' });
  for (const v of opts) g1.append(opt(v, v.id === 'nu-nam' ? v.label + ' · mặc định' : v.label));
  sel.append(g1);
  const vb = voiceList.filter(v => v.provider === 'vbee');
  const groups = [['rieng', '⭐ Giọng riêng của anh/chị'], ['dexuat', '🎙️ Đề xuất cho video BĐS'], ['vbee', 'Giọng Vbee'], ['congdong', 'Giọng cộng đồng nhiều người dùng']];
  for (const [k, name] of groups) {
    const items = vb.filter(v => (v.group || (v.own ? 'rieng' : 'vbee')) === k).sort((a, b) => a.label.localeCompare(b.label, 'vi'));
    if (!items.length) continue;
    const g = Object.assign(document.createElement('optgroup'), { label: name });
    for (const v of items) g.append(opt(v));
    sel.append(g);
  }
  // giọng Vbee đang dùng mà lần này Vbee trả thiếu → vẫn giữ (đổi giọng = phải đọc lại hết)
  if (isVbee() && !vb.some(v => v.id === VOICE.id)) sel.append(opt({ id: VOICE.id }, 'Giọng Vbee đang dùng'));
  sel.value = VOICE.id;
  syncVoiceUi();
}
function syncVoiceUi(changed = false) {
  const v = voiceList.find(x => x.id === VOICE.id);
  $('voiceDemo').hidden = !v?.demo;
  const m = $('voiceMsg');
  if (!vbeeKey()) m.textContent = 'Muốn dùng giọng Vbee (kể cả giọng nhân bản của anh/chị): kết nối tài khoản Vbee ở app cũ, mục Giọng đọc, trên chính máy này.';
  else if (changed && story) m.textContent = 'Bấm "🔄 Tạo lại video" để AI đọc lại bằng giọng này.' + (isVbee() ? ' Giọng Vbee tạo chậm hơn (2 câu một lúc) và trừ ký tự trong tài khoản Vbee của anh/chị.' : '');
  else m.textContent = isVbee() ? 'Đang dùng giọng Vbee của anh/chị: tạo chậm hơn giọng của app, trừ ký tự trong tài khoản Vbee.' : '';
}
$('voice').onchange = () => { setVoice($('voice').value); syncVoiceUi(true); if (story) setDirty(true); save(); };
$('voiceDemo').onclick = () => { const v = voiceList.find(x => x.id === VOICE.id); if (v?.demo) new Audio(v.demo).play().catch(() => null); };
function fillMusic() {
  const m = $('music'); m.textContent = '';
  const sug = story?.style?.suggest;
  for (const [id, label] of MUSIC_LIB) m.append(Object.assign(document.createElement('option'), { value: id, textContent: label + (id === sug && id !== 'hung-hon' ? ' · AI gợi ý' : ''), selected: id === S.music }));
}
// bản trộn nhạc + giọng + SFX của video đang dựng (nhớ theo dir + bài nhạc): trộn 1 lần, bấm phát lại không trộn lại
let mixMemo = null;
function mixReady() {
  if (!dir) return null;
  if (mixMemo?.dir !== dir || mixMemo.music !== S.music) {
    const d = dir, m = S.music;
    mixMemo = { dir: d, music: m, p: mixFor(d).catch(() => null) };
  }
  return mixMemo.p;
}
// mỗi lần bấm Phát / Dừng tăng playGen: lần phát cũ đang chờ trộn nhạc thấy số khác thì thôi, không phát chồng lên lần mới
let playGen = 0;
async function play() {
  if (!dir || dirty) return;
  stop();
  const gen = ++playGen;
  actx = actx || new AudioContext(); actx.resume();
  playing = true; $('play').textContent = '⏳'; $('play').classList.add('busy');
  const buf = await mixReady();
  if (gen !== playGen || !playing || !dir || !buf) { if (gen === playGen) stop(); return; }
  try { src?.stop(); } catch { /* đã dừng */ }
  src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
  const a0 = actx.currentTime + 0.05; src.start(a0);
  $('play').classList.remove('busy'); $('play').classList.add('hide'); $('play').textContent = '▶';
  const loop = () => {
    if (!playing || !dir || gen !== playGen) return;
    const t = Math.max(0, actx.currentTime - a0);
    dir.setFrame(Math.min(t, dir.duration));
    $('barFill').style.width = (Math.min(1, t / dir.duration) * 100) + '%';
    if (t < dir.duration) raf = requestAnimationFrame(loop); else stop();
  };
  raf = requestAnimationFrame(loop);
}
function stop() {
  playGen++;
  playing = false; cancelAnimationFrame(raf);
  try { src?.stop(); } catch { /* đã dừng */ } src = null;
  $('play').textContent = '▶'; $('play').classList.remove('busy');
  if (!dirty) $('play').classList.remove('hide');
}

// bảng phân cảnh: thẻ cố định (mở đầu, căn nhà, tổng kết, kêu gọi) + thẻ tiện ích / điểm mốc kéo thả được
const ICON_EMO = { school: '🎓', market: '🛒', park: '🌳', health: '🏥', bus: '🚌', factory: '🏭', bank: '🏦', gov: '🏛️', city: '🏙️', plane: '✈️', ship: '⚓', train: '🚆', road: '🛣️', pin: '📍' };
function sceneCard({ key, title, sub, text, cat, drag, removable, extra }) {
  const li = document.createElement('li');
  li.className = 'sc' + (drag ? '' : ' fixed'); li.dataset.key = key;
  if (drag) li.append(Object.assign(document.createElement('div'), { className: 'h', textContent: '⋮⋮', ariaLabel: 'Kéo để đổi thứ tự' }));
  const body = document.createElement('div'), head = document.createElement('div');
  head.className = 't';
  const [ic, col] = CAT3D[cat] || [];
  if (ic) { const s = Object.assign(document.createElement('span'), { className: 'ic', textContent: ICON_EMO[ic] || '📍' }); s.style.background = col; head.append(s); }
  head.append(Object.assign(document.createElement('b'), { textContent: title }), Object.assign(document.createElement('span'), { textContent: sub || '' }));
  const ta = Object.assign(document.createElement('textarea'), { rows: 2, value: String(text || '').replace(/<\/?b>/g, '') });
  ta.setAttribute('aria-label', 'Lời đọc cảnh');
  ta.addEventListener('change', () => {
    // số liệu (có chữ số) trong câu mới tự tô vàng như câu AI viết
    const v = ta.value.trim().replace(/(\d[\d.,]*\s*(km|m²|m|phút|tỷ|triệu)?)/g, '<b>$1</b>');
    S.edits.lines = { ...(S.edits.lines || {}), [key]: v };
    edited();
  });
  body.append(head, ta); if (extra) body.append(extra); li.append(body);
  if (removable) { const rm = Object.assign(document.createElement('button'), { className: 'rm', textContent: '✕' }); rm.setAttribute('aria-label', 'Bỏ cảnh này'); rm.onclick = () => removeScene(key); li.append(rm); }
  return li;
}
// Chip gợi ý tiện ích (như chip trục đường): tiện ích Agent đã chọn ✓ + các tiện ích GẦN NHÀ NHẤT chưa chọn ＋.
// Khách bấm để thêm / bỏ ngay ở bước 2 (trước khi Agent dựng) và trong bảng sửa video.
const POI_MAX = 8;
let poiMore = false;   // gọn mặc định: chỉ 3 gợi ý gần nhất, bấm "Xem thêm" mới hiện đủ (trang không dài, thấy nút Agent dựng video)
function poiChips(onChange) {
  const box = document.createElement('div'); box.className = 'chips road-chips poi-chips';
  if (!S.scan) return box;
  const sel = buildStory(storeData(), S.listing || { kind: 'nhapho' }, S.buyer || 'o', S.edits).pois.map(p => p.id);
  const byId = new Map(S.scan.pois.map(p => [p.id, p]));
  const perCat = {};   // gần nhất trước, mỗi loại tối đa 2 gợi ý (không toàn trường học)
  const near = S.scan.pois.filter(p => !sel.includes(p.id) && p.km <= 3 && CAT3D[p.cat] && !['giaothong', 'nganhang', 'congcong'].includes(p.cat))
    .sort((a, c) => a.km - c.km).filter(p => (perCat[p.cat] = (perCat[p.cat] || 0) + 1) <= 2).slice(0, 10);
  const shown = poiMore ? near : near.slice(0, 3);
  const chip = (text, cls, fn) => { const c = Object.assign(document.createElement('button'), { type: 'button', className: 'rchip ' + cls, textContent: text }); c.onclick = fn; box.append(c); };
  for (const p of [...sel.map(id => byId.get(id)).filter(Boolean), ...shown]) {
    const on = sel.includes(p.id), nm = p.name.length > 24 ? p.name.slice(0, 23) + '…' : p.name;
    chip(`${on ? '✓' : '＋'} ${ICON_EMO[CAT3D[p.cat]?.[0]] || '📍'} ${nm} · ${fmtKm(p.km)}`, on ? 'on' : '', () => {
      if (!on && sel.length >= POI_MAX) { alert(`Tối đa ${POI_MAX} tiện ích.`); return; }
      S.edits.order = on ? sel.filter(x => x !== p.id) : [...sel, p.id];
      save(); onChange();
    });
  }
  if (near.length > 3) chip(poiMore ? '▴ Thu gọn' : `▾ Xem thêm ${near.length - 3} gợi ý`, 'more', () => { poiMore = !poiMore; story && !$('studio').hidden ? renderBoard() : renderPoiPick(); });   // chỉ mở/thu, không tính là sửa video
  chip('🔍 Tìm / ghim tiện ích khác', 'more', () => openSheet('list'));
  chip('🛣 Thêm đường lớn, sân bay, ga, cảng', 'more', () => openSheet('big'));
  return box;
}
function renderPoiPick() {
  const w = $('poiPick'); if (!w) return;
  w.hidden = !S.scan;
  $('poiChips').replaceChildren(...poiChips(renderPoiPick).childNodes);
}
function renderBoard() {
  const b = $('board'); b.textContent = '';
  const L = story.lines;
  b.append(sceneCard({ key: 'intro', title: 'Mở đầu', text: L.intro }));
  if (story.lot) b.append(sceneCard({ key: 'lot', title: story.lot.label, text: L.lot }));
  else b.append(sceneCard({ key: 'house', title: `${KINDS[story.kind].label} · ${story.info.price || ''}`, text: L.house }));
  const OLD = story.engine === 'old';
  // vòng 9 (vẽ như app cũ): thứ tự thẻ = thứ tự cảnh app cũ — bán kính → kết nối vùng → hạ tầng → từng trục đường → từng tiện ích → tổng kết → kết → ảnh
  if (OLD) b.append(sceneCard({ key: 'overview', title: `❓ Sống ở đây có tiện không? · ⭕ vòng bán kính ${String(story.oldR).replace('.', ',')} km`, text: L.overview }));
  // vòng 7: kết nối vùng ngay sau căn nhà (trung tâm, sân bay, cảng, metro, cao tốc) — đúng thứ tự trong video
  story.anchors.forEach((a, i) => b.append(sceneCard({ key: 'anchor:' + a.id, title: '🧭 ' + a.name, sub: ` · ${a.km} km · ${a.min} phút`, text: L.anchor[i], cat: a.type, drag: true, removable: true })));
  const inf = story.infra || {};
  if (inf.airport) b.append(sceneCard({ key: 'airport', title: 'Sân bay · máy bay cất cánh', text: L.airport, cat: 'airport', removable: true }));
  if (inf.metro) b.append(sceneCard({ key: 'metro', title: 'Metro · tàu chạy dọc tuyến', text: L.metro, cat: 'metro', removable: true }));
  if (inf.road) b.append(sceneCard({ key: 'road', title: 'Cao tốc', text: L.road, cat: 'road', removable: true }));
  if (OLD && story.build?.length) b.append(sceneCard({ key: 'build', title: '🚧 Hạ tầng đang thi công · ' + story.build[0].name, text: L.build, cat: 'road', removable: true }));
  // trục đường lớn: AI chọn 3, khách bấm để thêm (tối đa 5) / bỏ
  const sel = story.roads.map(r => r.id);
  // gợi ý: trục gần nhà + trục xa khách đã thêm ở ô "Đường lớn · sân bay"
  const cands = (S.scan?.roads || []).filter(r => r.level >= 1 && (r.nearKm <= 3.4 || sel.includes(r.id))).sort((a, c) => a.nearKm - c.nearKm).slice(0, 10);
  if (cands.length) {
    const ex = document.createElement('div'); ex.className = 'chips road-chips';
    for (const r of cands) {
      const on = sel.includes(r.id);
      const c = Object.assign(document.createElement('button'), { type: 'button', className: 'rchip' + (on ? ' on' : ''), textContent: `${on ? '✓ ' : '＋ '}${r.label} · ${fmtKm(r.nearKm)}` });
      c.onclick = () => {
        if (!on && sel.length >= 5) { alert('Tối đa 5 trục đường.'); return; }
        S.edits.roads = on ? sel.filter(x => x !== r.id) : [...sel, r.id];
        edited();
      };
      ex.append(c);
    }
    if (!OLD) b.append(sceneCard({ key: 'roads', title: `❓ Sống ở đây có tiện không? · 🛣 ${sel.length} trục đường lớn (tối đa 5)`, text: L.roads, extra: ex }));
    else {
      // như app cũ: mỗi trục một cảnh riêng (line sáng + chữ 3D tên đường), mỗi trục một câu
      b.append(sceneCard({ key: 'roadpick', title: `🛣 Trục đường lớn · ${sel.length} trục (tối đa 5)`, sub: ' · bấm ＋ để thêm', text: '', extra: ex }));
      b.lastChild.querySelector('textarea')?.remove();
      story.roads.forEach((r, j) => b.append(sceneCard({ key: 'rd:' + r.id, title: r.name, sub: ` · ${fmtKm(r.km)}${r.km >= 0.12 ? ` · ${r.min} phút` : ''}`, text: L.rd[j], cat: 'road', removable: true })));
    }
  }
  // vòng 8: radar = cả phần tiện ích (mỗi chấm một nhãn tên). Tiện ích khách chọn / ghim ở thẻ dưới = tiện ích được ĐỌC TÊN trong lời
  if (story.radar) {
    const ex = document.createElement('div'); ex.className = 'chips road-chips';
    for (const p of story.radar.pts) ex.append(Object.assign(document.createElement('span'), { className: 'rchip' + (p.named ? ' on' : ''), textContent: `${ICON_EMO[CAT3D[p.cat]?.[0]] || '📍'} ${p.label}` }));
    b.append(sceneCard({ key: 'radar', title: `📡 Radar quét bán kính ${String(story.radar.r).replace('.', ',')} km · ${story.radar.n} tiện ích`, sub: ' · tô vàng = có đọc tên', text: L.radar, extra: ex }));
  }
  b.append(sceneCard({ key: 'poipick', title: story.radar ? `📍 Tiện ích được đọc tên · ${Math.min(5, story.pois.length)} (tối đa 5)` : `📍 Tiện ích gần nhà · ${story.pois.length} đã chọn (tối đa ${POI_MAX})`, sub: ' · bấm ＋ để thêm', text: '', extra: poiChips(edited) }));
  b.lastChild.querySelector('textarea')?.remove();
  const sub = p => ' · ' + (p.min ? `${Math.round(p.min)} phút · ` : '') + fmtKm(p.km);
  if (!story.orbit && story.flow !== 'radar') story.pois.forEach((p, i) => { if (!story.cluster?.idx.includes(i)) b.append(sceneCard({ key: 'poi:' + p.id, title: p.name, sub: sub(p), text: L.poi[i], cat: p.cat, drag: true, removable: true })); });
  // lượn 360°: mọi tiện ích trong 1 cảnh, nhãn bật lần lượt theo lời đọc (bỏ / thêm tiện ích ở thẻ "Tiện ích gần nhà")
  if (story.orbit) {
    const ex = document.createElement('div'); ex.className = 'chips road-chips';
    for (const i of story.orbit.idx) { const p = story.pois[i]; ex.append(Object.assign(document.createElement('span'), { className: 'rchip on', textContent: `${ICON_EMO[CAT3D[p.cat]?.[0]] || '📍'} ${p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name}${sub(p)}` })); }
    b.append(sceneCard({ key: 'orbit', title: `🔄 Lượn 360° quanh nhà · ${story.orbit.idx.length} tiện ích hiện lần lượt`, sub: ' · không vẽ đường đi', text: L.orbit, extra: ex }));
  }
  // bản ngắn: các tiện ích còn lại gom 1 cảnh — bấm tên để đưa tiện ích đó lên cảnh riêng (làm tiện ích chính)
  if (story.cluster) {
    const ex = document.createElement('div'); ex.className = 'chips road-chips';
    for (const i of story.cluster.idx) {
      const p = story.pois[i], c = Object.assign(document.createElement('button'), { type: 'button', className: 'rchip on', textContent: `${ICON_EMO[CAT3D[p.cat]?.[0]] || '📍'} ${p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name}${sub(p)}` });
      c.title = 'Đưa lên cảnh riêng';
      c.onclick = () => { S.edits.order = [p.id, ...story.pois.map(q => q.id).filter(x => x !== p.id)]; edited(); };
      ex.append(c);
    }
    b.append(sceneCard({ key: 'cluster', title: `📍 Quanh nhà · gom ${story.cluster.idx.length} tiện ích vào 1 cảnh`, sub: ' · bấm tên để đưa lên cảnh riêng', text: L.cluster, extra: ex }));
  }
  if (!OLD && story.build?.length) b.append(sceneCard({ key: 'build', title: '🚧 Hạ tầng đang thi công · ' + story.build[0].name, text: L.build, cat: 'road', removable: true }));
  if (!OLD && story.score && !story.statsInCta) b.append(sceneCard({ key: 'score', title: story.statsTitle ? `❓ Vì sao nên mua? · ${story.stats.length} lý do từ số liệu thật` : '📊 Tổng kết · 3 con số lớn', text: L.score }));
  if (OLD && story.pois.length) b.append(sceneCard({ key: 'summary', title: story.statsTitle ? `❓ Vì sao nên mua? · ${story.stats.length} lý do + bảng tiện ích` : story.stats?.length >= 2 ? '📊 Tổng kết · 3 con số lớn + bảng tiện ích' : '📋 Tổng kết · bảng tiện ích + khoảng cách', text: L.summary }));
  if (OLD) b.append(sceneCard({ key: 'cta', title: `Kết · ${story.cta}`, text: L.cta }));
  if (S.photos.length) {
    const ex = document.createElement('div'); ex.className = 'thumbs';
    for (const ph of S.photos.slice(0, 8)) ex.append(Object.assign(document.createElement('img'), { src: ph.url, alt: '' }));
    const go = Object.assign(document.createElement('button'), { className: 'link2', textContent: 'Sửa ảnh' }); go.onclick = () => goStep(2); ex.append(go);
    b.append(sceneCard({ key: 'photos', title: `Ảnh thực tế · ${S.photos.length} ảnh, mỗi ảnh ~3 giây (cuối video)`, text: L.photos, extra: ex }));
  }
  if (!OLD) b.append(sceneCard({ key: 'cta', title: `Kêu gọi · ${story.cta}`, text: L.cta }));
  enableDrag(b);
  $('labelRow').hidden = OLD;   // thẻ tiện ích kiểu app cũ, không chọn mẫu thẻ 3D
  syncTone();
  $('full').checked = !!story.full;
  $('globe').checked = !!story.globe;
  $('priceEnd').checked = !!story.priceEnd;
  $('flow').value = story.flow;
  $('labelStyle').value = story.labelStyle;
  $('ctaMode').value = story.ctaMode;
  if (document.activeElement !== $('ctaKey')) $('ctaKey').value = story.ctaKey;
  fillPost();
}
function removeScene(key) {
  const [kind, id] = key.split(':');
  if (kind === 'poi') S.edits.order = story.pois.map(p => p.id).filter(x => x !== id);
  else if (kind === 'rd') S.edits.roads = story.roads.map(r => r.id).filter(x => x !== id);
  else if (kind === 'anchor') S.edits.anchorsOff = [...(S.edits.anchorsOff || []), id];
  else if (kind === 'build') S.edits.buildOff = [...(S.edits.buildOff || []), ...story.build.map(b => b.id)];
  else S.edits.infraOff = [...(S.edits.infraOff || []), kind];
  edited();
}
// Kéo thả bằng tay cầm ⋮⋮ (chuột + cảm ứng): đổi chỗ trong cùng nhóm
function enableDrag(list) {
  list.querySelectorAll('.sc .h').forEach(h => h.addEventListener('pointerdown', e => {
    const li = h.closest('.sc'), group = li.dataset.key.split(':')[0];
    e.preventDefault(); h.setPointerCapture(e.pointerId);
    li.classList.add('drag');
    const y0 = e.clientY; let moved = false, off = 0;
    const move = ev => {
      moved = true;
      li.style.transform = `translateY(${ev.clientY - y0 + off}px)`;
      const lr = li.getBoundingClientRect(), lm = lr.top + lr.height / 2;
      for (const s of [...list.querySelectorAll('.sc')].filter(x => x !== li && x.dataset.key.startsWith(group + ':'))) {
        const r = s.getBoundingClientRect(), after = !!(s.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (after ? lm < r.top + r.height / 2 : lm > r.top + r.height / 2) {
          const before = li.getBoundingClientRect().top;
          list.insertBefore(li, after ? s : s.nextSibling);
          off -= li.getBoundingClientRect().top - before;
          li.style.transform = `translateY(${ev.clientY - y0 + off}px)`;
          break;
        }
      }
    };
    const up = () => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      li.classList.remove('drag'); li.style.transform = '';
      if (!moved) return;
      const keys = [...list.querySelectorAll('.sc')].map(x => x.dataset.key);
      if (group === 'poi') S.edits.order = keys.filter(k => k.startsWith('poi:')).map(k => k.slice(4));
      if (group === 'anchor') S.edits.anchorOrder = keys.filter(k => k.startsWith('anchor:')).map(k => k.slice(7));
      edited();
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }));
}

// ---------- Thêm tiện ích: danh sách / bản đồ ----------
let pickMap = null;
function openSheet(tab = 'list') {
  if (!S.scan) { alert('Đang quét tiện ích quanh vị trí, chờ vài giây rồi bấm lại.'); return; }
  $('sheet').hidden = false; $('poiSearch').value = ''; renderPoiList(); showTab(typeof tab === 'string' ? tab : 'list');
}
// Tab "Đường lớn · sân bay · ga" (15/11, Giang): khách tự thêm / bỏ trục đường lớn (cao tốc, quốc lộ, tỉnh lộ — kể cả trục xa),
// điểm mốc vùng (trung tâm, sân bay, ga, cảng — vẽ đường đi thật + số phút) và cảnh hạ tầng (máy bay cất cánh, metro, cao tốc,
// đang thi công). Mặc định vẫn do Agent chọn như cũ; chỉ đổi khi khách bấm.
const A_ICON = { center: '🏙️', airport: '✈️', port: '⚓', station: '🚆', metro: '🚇' };
function bigChanged() { save(); if (story && !$('studio').hidden) edited(); else renderPoiPick(); renderBigList(); }
function renderBigList() {
  const box = $('bigList'); box.textContent = '';
  const st = buildStory(storeData(), S.listing || { kind: 'nhapho' }, S.buyer || 'o', S.edits);
  const grp = t => box.append(Object.assign(document.createElement('div'), { className: 'grp', textContent: t }));
  const row = (icon, name, sub, on, fn) => {
    const r = Object.assign(document.createElement('button'), { className: 'prow' + (on ? ' sel' : '') });
    r.append(Object.assign(document.createElement('span'), { textContent: icon }), Object.assign(document.createElement('span'), { textContent: name }),
      Object.assign(document.createElement('small'), { textContent: (on ? '✓ đã có · ' : '＋ ') + sub }));
    r.onclick = fn; box.append(r);
  };
  const toggle = (offKey, addKey, id, on, max, cur) => {
    const off = new Set(S.edits[offKey] || []), add = new Set(S.edits[addKey] || []);
    if (on) { off.add(id); add.delete(id); } else { if (cur >= max) { alert(`Tối đa ${max} mục.`); return; } off.delete(id); add.add(id); }
    S.edits[offKey] = [...off]; S.edits[addKey] = [...add]; bigChanged();
  };
  // trục đường lớn: cao tốc, quốc lộ, tỉnh lộ, đường chính (gần → xa)
  const roads = (S.scan?.roads || []).filter(r => r.level >= 1).sort((a, b) => a.nearKm - b.nearKm).slice(0, 14), selR = st.roads.map(r => r.id);
  grp('🛣 Trục đường lớn · cao tốc · quốc lộ — vẽ line, tên in trên đường');
  for (const r of roads) row(r.level === 3 ? '🛣' : '🚗', r.label, `${r.level === 3 ? 'cao tốc · ' : ''}cách nhà ${fmtKm(r.nearKm)}`, selR.includes(r.id), () => {
    const on = selR.includes(r.id);
    if (!on && selR.length >= 5) { alert('Tối đa 5 trục đường.'); return; }
    S.edits.roads = on ? selR.filter(x => x !== r.id) : [...selR, r.id]; bigChanged();
  });
  if (!roads.length) box.append(Object.assign(document.createElement('p'), { className: 'tip', textContent: 'Chưa thấy trục đường lớn trong bán kính quét.' }));
  // điểm mốc vùng
  grp('🧭 Kết nối vùng: trung tâm · sân bay · cảng biển (Agent chọn sẵn 3) · ga — vẽ đường đi thật + số phút');
  const selA = st.anchors.map(a => a.id), anc = (S.anchors || []).filter(a => a.min <= 150);
  for (const a of anc) row(A_ICON[a.type] || '📍', a.name, `${a.min} phút · ${fmtKm(a.km)}`, selA.includes(a.id), () => toggle('anchorsOff', 'anchorsAdd', a.id, selA.includes(a.id), 5, selA.length));
  if (!anc.length) box.append(Object.assign(document.createElement('p'), { className: 'tip', textContent: regionJob && !S.anchors?.length ? 'Đang tải điểm mốc vùng… mở lại sau vài giây.' : 'Chưa có điểm mốc vùng.' }));
  // cảnh hạ tầng
  const I = S.infra || {}, inf = st.infra || {};
  if (I.airport || I.metro || I.road || S.build?.length) grp('🚀 Cảnh hạ tầng nổi bật');
  // 15/11 22:54 (Giang): bỏ cảnh máy bay cất cánh → không cho bật lại ở đây (sân bay vẫn chọn được như điểm mốc ở trên)
  if (false && I.airport) row('✈️', `Máy bay cất cánh · ${I.airport.name}`, `${I.airport.min} phút`, !!inf.airport, () => toggle('infraOff', 'infraAdd', 'airport', !!inf.airport, 9, 0));
  if (I.metro) row('🚇', I.metro.name, I.metro.sub, !!inf.metro, () => toggle('infraOff', 'infraAdd', 'metro', !!inf.metro, 9, 0));
  if (I.road) row('🛣', `Cảnh cao tốc · ${I.road.name}`, `cách nhà ${fmtKm(I.road.km)}`, !!inf.road, () => toggle('infraOff', 'infraAdd', 'road', !!inf.road, 9, 0));
  if (S.build?.length) row('🚧', `Đang thi công · ${S.build[0].label}`, `cách nhà ${fmtKm(S.build[0].nearKm)}`, st.build.length > 0, () => {
    if (st.build.length) { S.edits.buildOn = false; S.edits.buildOff = S.build.map(b => b.id); } else { S.edits.buildOn = true; S.edits.buildOff = []; }
    bigChanged();
  });
}
function closeSheet() { $('sheet').hidden = true; }
// tiện ích đang chọn (dùng được cả ở bước 2 khi chưa dựng video)
const curSel = () => buildStory(storeData(), S.listing || { kind: 'nhapho' }, S.buyer || 'o', S.edits).pois.map(p => p.id);
const afterPoiChange = () => (story && !$('studio').hidden ? edited() : renderPoiPick());
function addPoi(id) {
  const cur = curSel();
  if (!cur.includes(id)) {
    if (cur.length >= POI_MAX) { alert(`Tối đa ${POI_MAX} tiện ích — bỏ bớt một tiện ích trước.`); return; }
    S.edits.order = [...cur, id];
  }
  closeSheet(); save(); afterPoiChange();
}
// ghim tiện ích app chưa quét được (như kiểu cũ): thêm vào danh sách quét của căn này rồi chọn luôn
function addManual(c) {
  const id = 'm' + Date.now().toString(36);
  const m = { id, name: c.name, cat: c.cat, kind: 'manual', lat: c.lat, lng: c.lng, km: haversineKm(S.house, c), manual: true };
  S.scan.pois.push(m); S.manual.push(m);
  addPoi(id);
}
function renderPoiList() {
  const q = $('poiSearch').value.trim().toLowerCase(), cur = new Set(curSel());
  const box = $('poiList'); box.textContent = '';
  const groups = {};
  for (const p of S.scan.pois) if (!q || p.name.toLowerCase().includes(q)) (groups[p.cat] ||= []).push(p);
  // không thấy trong danh sách → mời ghim trên bản đồ (tiện ích app chưa quét được)
  const miss = Object.assign(document.createElement('button'), { className: 'prow', textContent: `📌 ${q && !Object.keys(groups).length ? `Không thấy "${$('poiSearch').value.trim()}"? ` : 'Tiện ích chưa có trong danh sách? '}Ghim trên bản đồ` });
  miss.style.color = 'var(--gold)'; miss.onclick = () => showTab('map');
  box.append(miss);
  for (const [c, list] of Object.entries(groups).sort((a, b) => (CATEGORIES[a[0]]?.order || 99) - (CATEGORIES[b[0]]?.order || 99))) {
    box.append(Object.assign(document.createElement('div'), { className: 'grp', textContent: CATEGORIES[c]?.label || c }));
    for (const p of list.slice(0, 12)) {
      const r = Object.assign(document.createElement('button'), { className: 'prow' + (cur.has(p.id) ? ' in' : '') });
      r.append(Object.assign(document.createElement('span'), { textContent: ICON_EMO[CAT3D[p.cat]?.[0]] || '📍' }), Object.assign(document.createElement('span'), { textContent: p.name }),
        Object.assign(document.createElement('small'), { textContent: fmtKm(p.km) + (cur.has(p.id) ? ' · đã có' : '') }));
      r.onclick = () => addPoi(p.id);
      box.append(r);
    }
  }
}
function showTab(t) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('poiList').hidden = t !== 'list'; $('poiSearch').hidden = t !== 'list';
  $('pickMap').hidden = t !== 'map'; $('mapTip').hidden = t !== 'map';
  $('bigList').hidden = t !== 'big'; if (t === 'big') renderBigList();
  $('tapBox').hidden = true; pickTap?.remove(); pickTap = null;
  if (t === 'map') openPickMap();
}
function openPickMap() {
  const H = [S.house.lng, S.house.lat];
  const fc = { type: 'FeatureCollection', features: S.scan.pois.filter(p => p.km <= 3).map(p => ({ type: 'Feature', properties: { id: p.id, name: p.name, c: CAT3D[p.cat]?.[1] || '#f5c451' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) };
  if (pickMap) { pickMap.getSource('pois').setData(fc); pickMap.jumpTo({ center: H, zoom: 15 }); pickMap.resize(); return; }
  pickMap = new maplibregl.Map({ container: 'pickMap', center: H, zoom: 15, attributionControl: { compact: true },
    style: { version: 8, sources: {
      sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Esri, Maxar' },
      pois: { type: 'geojson', data: fc } },
    layers: [{ id: 'sat', type: 'raster', source: 'sat' },
      { id: 'p', type: 'circle', source: 'pois', paint: { 'circle-radius': 8, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#f5c451', 'circle-stroke-width': 2 } }] } });
  new maplibregl.Marker({ color: '#f5c451' }).setLngLat(H).addTo(pickMap);
  pickMap.on('click', 'p', e => {
    const f = e.features[0], el = document.createElement('div');
    const b = Object.assign(document.createElement('b'), { textContent: f.properties.name }); b.style.color = '#111';
    const btn = Object.assign(document.createElement('button'), { textContent: '＋ Thêm vào video' });
    btn.style.cssText = 'display:block;margin-top:6px;padding:7px 10px;border:0;border-radius:8px;background:#f5c451;font-weight:800;cursor:pointer';
    btn.onclick = () => addPoi(f.properties.id);
    el.append(b, btn);
    new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setDOMContent(el).addTo(pickMap);
  });
  pickMap.on('mouseenter', 'p', () => { pickMap.getCanvas().style.cursor = 'pointer'; });
  // chạm chỗ CHƯA có chấm → gợi ý tên địa điểm quanh chỗ chạm (đã quét trong 250 m + OSM/Overture 300 m), không có thì tự đặt tên
  pickMap.on('click', async e => {
    if (pickMap.queryRenderedFeatures(e.point, { layers: ['p'] }).length) return;
    const tap = { lat: e.lngLat.lat, lng: e.lngLat.lng }, el = document.createElement('div');
    el.textContent = 'Đang tìm tên địa điểm quanh đây…';
    // chỗ chạm: ghim vàng trên bản đồ, danh sách chọn ở NGAY DƯỚI bản đồ (popup trên điện thoại hay tràn mép)
    pickTap?.remove();
    pickTap = new maplibregl.Marker({ color: '#ff4fa3' }).setLngLat(e.lngLat).addTo(pickMap);
    el.style.cssText = 'margin-top:8px;padding:10px;border-radius:12px;background:#fff;color:#111;font:500 13px "Be Vietnam Pro"';
    $('tapBox').replaceChildren(el); $('tapBox').hidden = false; pickMap.resize();
    $('tapBox').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const norm = s => String(s).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
    const local = S.scan.pois.filter(p => haversineKm(p, tap) <= 0.25).sort((a, b) => haversineKm(a, tap) - haversineKm(b, tap)).slice(0, 5)
      .map(p => ({ name: p.name, lat: p.lat, lng: p.lng, cat: p.cat, poiId: p.id }));
    let remote = [];
    try { remote = await placesNear(tap, 0.3); } catch { /* bỏ qua */ }
    const have = new Set(local.map(x => norm(x.name)));
    const cands = [...local, ...remote.filter(x => !have.has(norm(x.name)) && have.add(norm(x.name)))
      .map(x => ({ name: x.name, lat: x.lat, lng: x.lng, cat: x.cat && CATEGORIES[x.cat] ? x.cat : guessCategory({ name: x.name }) }))]
      .sort((a, b) => haversineKm(a, tap) - haversineKm(b, tap)).slice(0, 6);
    el.textContent = '';
    const btnCss = 'display:block;width:100%;margin-top:5px;padding:7px 9px;border:0;border-radius:8px;background:#f5c451;font:700 12.5px "Be Vietnam Pro";text-align:left;cursor:pointer';
    el.append(Object.assign(document.createElement('b'), { textContent: cands.length ? 'Chọn tiện ích ở đây:' : 'Chưa có tên địa điểm ở đây.' }));
    const chosen = new Set(curSel());
    for (const c of cands) {
      const has = c.poiId && chosen.has(c.poiId);
      const b = Object.assign(document.createElement('button'), { textContent: has ? `✓ ${c.name} · đã có trong video` : `＋ ${c.name}${CATEGORIES[c.cat] ? ` · ${CATEGORIES[c.cat].label}` : ""}`, disabled: has });   // ghi nhóm để khách thấy; sai nhóm thì tự đặt tên + chọn nhóm bên dưới
      b.style.cssText = btnCss + (has ? ';opacity:.5;cursor:default' : '');
      b.onclick = () => (c.poiId ? addPoi(c.poiId) : addManual(c));
      el.append(b);
    }
    // tự đặt tên tại chỗ chạm
    const name = Object.assign(document.createElement('input'), { placeholder: 'Tự đặt tên (vd. Chợ đêm Bình Lợi)', maxLength: 60 });
    name.style.cssText = 'display:block;width:100%;margin-top:8px;padding:7px;border:1px solid #ccc;border-radius:8px;font:500 13px "Be Vietnam Pro"';
    const cat = document.createElement('select');
    cat.style.cssText = 'display:block;width:100%;margin-top:5px;padding:6px;border:1px solid #ccc;border-radius:8px';
    for (const [k, v] of Object.entries(CATEGORIES).sort((a, b) => a[1].order - b[1].order)) cat.append(Object.assign(document.createElement('option'), { value: k, textContent: v.label }));
    const own = Object.assign(document.createElement('button'), { textContent: '📌 Ghim với tên này' }); own.style.cssText = btnCss;
    own.onclick = () => { const n = name.value.trim(); if (!n) { name.focus(); return; } addManual({ name: n, lat: tap.lat, lng: tap.lng, cat: cat.value }); };
    el.append(name, cat, own);
  });
}
let pickTap = null;

// ---------- Đăng ký / đăng nhập: dùng hộp thoại của trang chính rồi tự quay về đây (app.js: ?dd=1) ----------
function goLogin(hash = '#dangky') { save(); location.href = '/?dd=1' + hash; }

// ---------- Xuất MP4: kiểm tra lượt trước, TRỪ LƯỢT SAU KHI XUẤT XONG ----------
// localOnly: chỉ trên máy dev (localhost) — xuất thử không qua tài khoản/lượt, để kiểm tra hình
const DEV = /^(localhost|127.0.0.1)$/.test(location.hostname);
// Nguồn khung hình lúc xuất, chịu được mất WebGL (16/11, Giang xuất 1080p trên điện thoại báo "hết bộ nhớ đồ hoạ"): iPhone thu hồi
// WebGL khi thiếu bộ nhớ đồ hoạ hoặc khi khoá màn hình / chuyển app. Mất thì chờ trang hiện lại → chờ MapLibre tự dựng lại (≤ 6 s) →
// không được thì bỏ bản đồ cũ, tạo bản đồ mới (lần 2 trở đi bản nhẹ, không MSAA) và dựng tiếp ĐÚNG khung đang dở; tối đa 3 lần.
// Mỗi khung độc lập theo thời gian t nên video không bị đứt (khung đã mã hoá giữ nguyên).
const untilVisible = () => document.visibilityState === 'visible' ? Promise.resolve() : new Promise(r => {
  const f = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', f); r(); } };
  document.addEventListener('visibilitychange', f);
});
function exportSource(w, h, st, onLost) {
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d', { alpha: false });
  let d = null, fs = null, lost = 0, wasHidden = false;
  const onVis = () => { if (document.visibilityState === 'hidden') wasHidden = true; };
  document.addEventListener('visibilitychange', onVis);
  const open = async lite => { d = makeDirector(w, h, st, lite); await d.ready; fs = d.engine === 'old' ? d.frameSource() : null; };
  const needGl = t => d.glUntil == null || t < d.glUntil;
  return {
    canvas: out, open, get dir() { return d; }, get lost() { return lost; },
    async prepare(t) {
      for (;;) {
        try {
          const p = fs ? fs.prepare(t) : d.prepare(t);
          if (p) await p;
          if (!(d.glLost?.() && needGl(t))) return;
        } catch (e) { if (!e?.glLost) throw e; }
        lost++;
        const bg = wasHidden || document.visibilityState === 'hidden';
        funnel(`dd_xgl_${devClass()}${bg ? '_bg' : ''}`, true);
        if (lost > 3) throw Object.assign(new Error('Máy hết bộ nhớ đồ hoạ khi dựng 3D. Đóng bớt ứng dụng rồi xuất lại (hoặc chọn "Nhanh 720p").'), { glLost: true });
        onLost?.(lost);
        await untilVisible();
        wasHidden = false;
        if (await d.restored?.(6000)) { funnel('dd_xgl_hoi', true); continue; }
        try { d.destroy(); } catch { /* đã gỡ */ }
        await new Promise(r => setTimeout(r, 400));   // cho trình duyệt thu dọn bộ nhớ đồ hoạ cũ
        await open(lost >= 2);
        funnel('dd_xgl_moi', true);
      }
    },
    draw(_tl, t) {
      if (fs) { fs.draw(_tl, t); ctx.drawImage(fs.canvas, 0, 0); } else d.draw(ctx, t);
    },
    destroy() { document.removeEventListener('visibilitychange', onVis); try { d?.destroy(); } catch { /* đã gỡ */ } },
  };
}
// giữ màn hình sáng trong lúc xuất (khoá máy = iPhone thu hồi WebGL); trang ẩn thì trình duyệt tự nhả → hiện lại thì xin lại
function keepAwake() {
  let lock = null, on = true;
  const get = async () => { try { if (on && document.visibilityState === 'visible' && !lock) { lock = await navigator.wakeLock?.request('screen'); lock?.addEventListener?.('release', () => { lock = null; }); } } catch { lock = null; } };
  const onVis = () => { if (document.visibilityState === 'visible') get(); };
  document.addEventListener('visibilitychange', onVis);
  get();
  return () => { on = false; document.removeEventListener('visibilitychange', onVis); try { lock?.release(); } catch { /* bỏ qua */ } lock = null; };
}
// xuất xong dựng lại khung xem trước (đã gỡ lúc xuất để trả bộ nhớ đồ hoạ cho bản xuất)
async function revivePreview() {
  if (dir || !story) return;
  const cv = $('cv');
  try {
    dir = makeDirector(cv.width, cv.height, story);
    await dir.ready;
    dir.live(cv.getContext('2d'));
    dir.setFrame(0.01);
    mixReady();
  } catch { /* xem trước lỗi: bấm Tạo lại video */ }
}

async function exportVideo(localOnly = false) {
  localOnly = localOnly === true && DEV;
  if (!canEncodeMp4()) { alert('Trình duyệt này chưa xuất được video. Mở bằng Chrome hoặc Safari mới nhất.'); return; }
  stop();
  const bar = $('xbar'), fill = $('xfill'), txt = $('xtxt'), btn = $('exportBtn');
  bar.hidden = false; btn.disabled = true; $('out').textContent = ''; fill.style.width = '0';
  const t0 = performance.now();
  let xs = null, xlog = null, unwake = null;
  if (!localOnly) funnel('dd_xuat');
  try {
    txt.textContent = 'Đang kiểm tra lượt…';
    const chk = localOnly ? { ok: true } : await canExport(S.house);
    if (!chk.ok) {
      if (chk.code === 'LOGIN') { txt.textContent = 'Cần đăng ký miễn phí để xuất video'; goLogin(); return; }
      if (chk.code === 'NO_CREDIT') { txt.textContent = 'Hết lượt xuất video — mua thêm lượt ở trang chính'; goLogin('#mua'); return; }
      throw new Error(chk.message || 'Không kiểm tra được tài khoản, thử lại.');
    }
    // đủ giọng cho mọi câu trước khi xuất
    if (!localOnly && allLines(story).some(t => !voiceOf(t))) {
      txt.textContent = 'AI đang đọc lời…';
      if (!(await voiceAll(n => { if (n) txt.textContent = `AI đang đọc lời ${n}`; }))) throw new Error(voiceErr === 'login' ? 'Phiên đăng nhập hết hạn, đăng nhập lại.' : voiceErr || 'Chưa đọc được giọng.');
      await rebuild();
    }
    const best = document.querySelector('input[name=q]:checked').value === 'best';
    // máy yếu (RAM ≤ 4 GB hoặc ≤ 4 nhân): 30 hình/giây kể cả bản đẹp — dựng 3D nhẹ một nửa, ít treo máy
    const weak = (navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4;
    const h = best ? 1920 : 1280, w = Math.round(h * 9 / 32) * 2, fps = best && !weak ? 60 : 30;
    if (!localOnly) xlog = xuatStart('d', best ? 1080 : 720);
    unwake = keepAwake();
    // gỡ bản đồ xem trước trong lúc xuất: điện thoại chỉ giữ MỘT bản đồ 3D (đỡ ~45 MB bộ nhớ đồ hoạ); xuất xong dựng lại
    const keepPreview = dir;
    dir = null; mixMemo = null; keepPreview?.destroy();
    let note = '';
    xs = exportSource(w, h, story, () => { note = ' · máy vừa thiếu bộ nhớ, đang dựng lại 3D'; txt.textContent = 'Đang dựng lại 3D (máy vừa thiếu bộ nhớ đồ hoạ)…'; });
    await xs.open(false);
    const xd = xs.dir;
    // phần vẽ kiểu app cũ: ô ảnh vệ tinh lúc xuất đi phiên bản đồ (như app cũ, không tốn hạn mức ô ảnh)
    if (xd.engine === 'old') { preferSession(true); await warmSession().catch(() => false); }
    const audio = await mixFor(xd);
    const blob = await exportMp4({ tl: { duration: xd.duration, LW: w }, width: w, height: h, fps, audioBuffer: audio, source: xs,
      onProgress: (ph, a, b) => { if (ph === 'frames') xlog?.pct(100 * a / b * 0.95); else if (ph === 'mux') xlog?.pct(96); if (ph === 'frames') { fill.style.width = (a / b * 100) + '%'; txt.textContent = `Đang dựng video ${Math.round(a / b * 100)}% · giữ màn hình mở${note}`; } } });
    // xuất xong mới trừ lượt (1 vị trí = 1 lượt; xuất lại trong 24 giờ không trừ thêm)
    txt.textContent = 'Đang lưu lượt…';
    const r = localOnly ? { ok: true } : await chargeExport(S.house);
    if (!r.ok) {
      if (r.code === 'NO_CREDIT') { txt.textContent = 'Hết lượt — mua thêm lượt để tải video'; goLogin('#mua'); return; }
      throw new Error(r.message || 'Không trừ được lượt, thử lại.');
    }
    if (r.charged || r.mode === 'unlimited') track('export');
    if (!localOnly) { funnel('dd_xuat_xong'); xlog?.done(); }
    const url = URL.createObjectURL(blob);
    fill.style.width = '100%'; txt.textContent = `✓ Xong trong ${Math.round((performance.now() - t0) / 1000)} giây`;
    const v = Object.assign(document.createElement('video'), { src: url, controls: true, playsInline: true });
    const a = Object.assign(document.createElement('a'), { href: url, download: `vi-tri-studio-ai-dao-dien-${h}p.mp4`, textContent: `⬇ Tải video về máy (${(blob.size / 1048576).toFixed(1)} MB)` });
    $('out').append(v, a);
    // ảnh bìa (khung đầu video) để đăng kèm / làm thumbnail
    try {
      const cc = document.createElement('canvas'); cc.width = w; cc.height = h;
      const cd = xs.dir, p0 = cd.prepare(1.6); if (p0) await p0; cd.draw(cc.getContext('2d'), 1.6);
      const cb = await new Promise(r => cc.toBlob(r, 'image/jpeg', 0.92));
      $('out').append(Object.assign(document.createElement('a'), { href: URL.createObjectURL(cb), download: 'anh-bia.jpg', textContent: '🖼 Tải ảnh bìa' }));
    } catch { /* không có ảnh bìa vẫn xong video */ }
    window.__lastExport = { blob, sec: (performance.now() - t0) / 1000, lost: xs.lost };
  } catch (e) {
    const best = document.querySelector('input[name=q]:checked')?.value === 'best';
    txt.textContent = 'Lỗi: ' + (e.message || e) + (best && !/720p/.test(String(e.message)) ? ' Máy yếu thì chọn "Nhanh 720p" rồi xuất lại.' : '');
    window.__lastExport = { error: String(e.stack || e), lost: xs?.lost || 0 };
    if (!localOnly) { funnel('dd_xuat_loi'); funnel(`dd_xloi_${e?.glLost ? 'gl_' : ''}${devClass()}`, true); }
  } finally { xlog?.end(); unwake?.(); if (window.__lastExport && xs) window.__lastExport.lost = xs.lost; xs?.destroy(); preferSession(false); btn.disabled = false; revivePreview(); }
}

// ---------- Bài đăng: mô tả + hashtag + bình luận ghim (chép 1 chạm), có link trang web căn để khách để lại SĐT ----------
// Chữ lấy từ tin đăng + số liệu quét thật (không bịa). Không tự chèn số điện thoại vào mô tả.
const tagOf = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/^(phuong|xa|thi tran)\s+/i, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
function postText(st, L, url) {
  const ward = storeData().ward || L.ward || '', prov = L.province || '';
  const title = L.title || KINDS[st.kind].label;
  const where = [title.toLowerCase().includes(ward.toLowerCase()) ? '' : ward, prov].filter(Boolean).join(', ');
  const info = [L.price && `💰 ${L.price}`, L.dims || (L.area && `${L.area} m²`), L.floors || L.level, L.beds && `${L.beds} phòng ngủ`, L.legal].filter(Boolean).join(' · ');
  const tags = [...new Set(['batdongsan', 'nhadat', { nhapho: 'nhapho', bietthu: 'bietthu', nhavuon: 'nhavuon', canho: 'canho', datnen: 'datnen' }[st.kind], tagOf(prov), tagOf(ward), 'muabannhadat'].filter(Boolean))];
  return [
    `🏠 ${title.toUpperCase()}${where ? ` – ${where}` : ''}`, info, '',
    ...st.pois.slice(0, 4).map(p => `📍 ${p.name}: ${fmtSub(p, st.bird)}`),
    ...st.anchors.map(a => `🚗 ${a.min} phút tới ${a.name}`),
    st.roads.length ? `🛣 Gần ${st.roads.slice(0, 3).map(r => r.name).join(', ')}` : null, '',
    `👉 ${st.ctaMode === 'binhluan' ? 'Bình luận' : 'Nhắn tin'} “${st.ctaKey}” để nhận thông tin chi tiết về sản phẩm.`,
    url ? `🌐 Xem ảnh, vị trí & để lại số điện thoại: ${url}` : null, '',
    tags.map(x => '#' + x).join(' '),
  ].filter(x => x != null && x !== false).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const commentText = (st, url) => url ? `📌 Xem ảnh thực tế, vị trí trên bản đồ, tiện ích quanh nhà và để lại số điện thoại để được gọi lại: ${url}`
  : `📌 Anh chị cần thông tin chi tiết: ${st.ctaMode === 'binhluan' ? 'bình luận' : 'nhắn tin'} “${st.ctaKey}”, em gửi ngay ạ.`;
const PAGE_KEY = 'vitri.ddpages.v1';   // toạ độ căn → trang đã tạo (bấm lại = cập nhật, link giữ nguyên)
const pageMap = () => { try { return JSON.parse(localStorage.getItem(PAGE_KEY) || '{}'); } catch { return {}; } };
const houseKey = () => (S.house ? `${S.house.lat.toFixed(5)},${S.house.lng.toFixed(5)}` : '');
const pageLink = () => { const r = pageMap()[houseKey()]; return r ? `${location.origin}/can/${r.slug}` : ''; };
function fillPost() {
  if (!story || !$('postText')) return;
  const url = pageLink();
  $('postText').value = postText(story, S.listing || {}, url);
  $('postCmt').value = commentText(story, url);
  $('pageBtn').textContent = url ? '🌐 Cập nhật trang web căn' : '🌐 Tạo trang web căn (khách để lại SĐT)';
}
async function copyTxt(ta, btn) {
  try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
  const t0 = btn.textContent; btn.textContent = '✓ Đã chép'; setTimeout(() => { btn.textContent = t0; }, 1500);
}
// Trang web căn (cùng hàm vt_page_* như kiểu cũ): ảnh thực tế tải lên kho vt-pages (tối đa 8), tiện ích + trục đường quét thật
async function makePage() {
  const btn = $('pageBtn'), msg = $('postMsg');
  if (!token()) { if (confirm('Đăng ký miễn phí để tạo trang web cho căn này. Đi đăng ký?')) goLogin(); return; }
  btn.disabled = true;
  const key = houseKey(), map = pageMap(), rec = map[key] || {};
  try {
    const st = story, L = S.listing || {};
    const sig = S.photos.map(p => p.blob?.size || 0).join('|');
    let photos = rec.photos || [];
    if (sig !== rec.sig) {
      photos = [];
      if (S.photos.length) {
        msg.textContent = 'Đang tải ảnh lên…';
        const paths = await rpc('vt_page_upload', { p_token: token(), p_count: Math.min(8, S.photos.length) });
        for (let i = 0; i < paths.length && i < S.photos.length; i++) {
          const r = await fetch(`${SB_URL}/storage/v1/object/vt-pages/${paths[i]}`, { method: 'POST', headers: { apikey: SB_KEY, 'content-type': 'image/jpeg' }, body: S.photos[i].blob });
          if (!r.ok) throw new Error('Tải ảnh lên chưa được, kiểm tra mạng rồi thử lại.');
          photos.push(paths[i]);
        }
      }
    }
    msg.textContent = 'Đang lưu trang…';
    const ward = storeData().ward || L.ward || '';
    const p = await rpc('vt_page_save', { p_token: token(), p: {
      id: rec.id || null, title: L.title || [KINDS[st.kind].label, ward].filter(Boolean).join(' · '),
      price: L.price || '', area: L.dims || (L.area ? `${L.area} m²` : ''), beds: st.kind === 'datnen' || !L.beds ? '' : String(L.beds), legal: L.legal || '',
      address: [ward, L.province].filter(Boolean).join(', '), lat: S.house.lat, lng: S.house.lng, phone: L.phones?.[0] || '', brand: $('brand').value.trim(),
      style: 'vangneon', video_url: '', description: (L.highlights || []).join('\n'), photos,
      pois: st.pois.map(x => ({ name: x.name, cat: x.cat, catName: CATEGORIES[x.cat]?.label || '', km: Math.round(x.km * 100) / 100 })),
      roads: st.roads.map(r => ({ label: r.name, km: Math.round((r.km || 0) * 100) / 100 })),
    } });
    map[key] = { id: p.id, slug: p.slug, photos, sig };
    try { localStorage.setItem(PAGE_KEY, JSON.stringify(map)); } catch { /* bỏ qua */ }
    msg.textContent = rec.id ? '✓ Đã cập nhật trang web, link giữ nguyên.' : '✓ Đã tạo trang web — link đã nằm trong mô tả và bình luận ghim.';
    fillPost();
  } catch (e) {
    // trang đã bị xoá ở máy khác: quên trang cũ, bấm lại sẽ tạo trang mới
    if (rec.id && /Không tìm thấy/.test(e.message || '')) { delete map[key]; try { localStorage.setItem(PAGE_KEY, JSON.stringify(map)); } catch { /* bỏ qua */ } }
    msg.textContent = 'Chưa tạo được trang: ' + (e.message || e);
  } finally { btn.disabled = false; }
}

// ---------- Đồng bộ với Claude của khách (MCP, 20/11/2026) ----------
// /dao-dien?p=<id>: video Claude tạo (hoặc khách đủ điều kiện dựng trên web) lưu ở vt_dd_projects. Trang tự quét + dựng, gửi "ảnh chụp"
// (cảnh, lời, tiện ích, số liệu thật) lên để Claude đọc; hỏi 4 giây/lần, Claude sửa (rev tăng) thì áp dụng, đọc lại giọng câu đã đổi,
// dựng lại. Khách sửa trên web cũng lưu lên (Claude thấy bản mới nhất). Khách KHÔNG đủ điều kiện (vt_dd_ok = false) không có ?p
// → trang chạy y như cũ. Xuất video + trừ lượt không đổi (vẫn bấm trên trang).
const P_KEY = 'vitri.dd.p', POLL_MS = 4000;
let proj = null, applying = false, agentDone = false, pollT = 0, syncChain = Promise.resolve(), syncOkJob = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function projectIdFromUrl() {
  const q = new URLSearchParams(location.search).get('p');
  if (q && /^[0-9a-f-]{36}$/i.test(q)) return q;
  // đi đăng nhập rồi quay lại (/?dd=1#dangky → /dao-dien): lấy lại id đã nhớ (≤ 30 phút)
  try { const r = JSON.parse(localStorage.getItem(P_KEY) || 'null'); if (r?.id && Date.now() - r.t < 1800000 && token()) { localStorage.removeItem(P_KEY); return r.id; } } catch { /* bỏ qua */ }
  return null;
}
function syncBadge(text, cls = '') {
  const b = $('ddSync'); if (!b) return;
  b.hidden = !text; b.className = 'note sync ' + cls; b.textContent = text || '';
}
function projNote(text, login = false) {
  const n = $('projNote'); n.hidden = !text; n.textContent = '';
  if (!text) return;
  n.append(Object.assign(document.createElement('b'), { textContent: '🤖 Video Claude tạo' }), Object.assign(document.createElement('span'), { textContent: text }));
  if (login) { const b = Object.assign(document.createElement('button'), { className: 'cta gold', type: 'button', textContent: 'Đăng nhập để mở video' }); b.onclick = () => goLogin(); n.append(b); }
}
const fixToListing = f => (f ? Object.fromEntries(Object.entries(f).filter(([, v]) => v != null && v !== '')) : null);
function mergeManual(list) {
  if (!Array.isArray(list) || !S.house) return;
  for (const m of list) {
    if (!m?.id || !Number.isFinite(m.lat)) continue;
    const poi = { id: m.id, name: m.name, cat: m.cat || 'congcong', kind: 'manual', lat: m.lat, lng: m.lng, km: haversineKm(S.house, m), manual: true };
    if (!S.manual.some(x => x.id === m.id)) S.manual.push(poi);
    if (S.scan && !S.scan.pois.some(x => x.id === m.id)) S.scan.pois.push(poi);
  }
}
// áp dữ liệu máy chủ vào trang (lần đầu mở, hoặc Claude vừa sửa)
function applyProject(p) {
  applying = true;
  try {
    const o = p.opts || {};
    proj.opts = o;
    $('listing').value = p.listing || '';
    S.listingFix = fixToListing(o.fix);
    S.buyer = p.buyer || null; S.buyerTouched = !!p.buyer;
    S.edits = structuredClone(p.edits || {});
    $('tone').value = S.edits.tone && [...$('tone').options].some(x => x.value === S.edits.tone) ? S.edits.tone : 'auto';
    if (o.music) S.music = o.music;
    if (typeof o.bird === 'boolean') $('bird').checked = o.bird;
    if (typeof o.brand === 'string') $('brand').value = o.brand;
    mergeManual(o.manual);
    if (o.voice && o.voice !== VOICE.id) voicePick.then(() => {
      if (isVbee(o.voice) && !vbeeKey()) { proj.voiceNote = 'Giọng Vbee Claude chọn cần kết nối Vbee trên máy này (app cũ › Giọng đọc) — đang dùng giọng mặc định.'; return; }
      setVoice(o.voice, false); if ($('voice').options.length) { if (![...$('voice').options].some(x => x.value === o.voice)) $('voice').append(new Option('Giọng Claude chọn', o.voice)); $('voice').value = o.voice; }
    });
    onListing();
    if (!S.listing && S.listingFix) S.listing = { kind: 'nhapho', ...S.listingFix };
    renderUnderstood(); renderBuyers(); renderTones();
    proj.rev = p.rev;
    proj.sent = JSON.stringify(cloudPayload());
  } finally { applying = false; }
}
async function openProject(id) {
  history.replaceState(null, '', location.pathname + '?p=' + id);
  if (!token()) {
    try { localStorage.setItem(P_KEY, JSON.stringify({ id, t: Date.now() })); } catch { /* bỏ qua */ }
    projNote('Đăng nhập đúng tài khoản Vị Trí Studio đã kết nối với Claude để mở video này.', true);
    return;
  }
  projNote('Đang mở video…');
  let p;
  try { p = await rpc('vt_dd_get', { p_token: token(), p_id: id }); }
  catch (e) {
    if (e.hint === 'AUTH') { try { localStorage.setItem(P_KEY, JSON.stringify({ id, t: Date.now() })); } catch { /* bỏ qua */ } projNote('Phiên đăng nhập đã hết hạn.', true); }
    else projNote(e.message || 'Chưa mở được video, thử tải lại trang.', e.hint === 'OWNER');
    history.replaceState(null, '', location.pathname); restore(); return;
  }
  proj = { id, rev: p.rev, lat: p.lat, lng: p.lng, opening: true, opts: p.opts || {} };
  projNote('');
  $('coord').value = p.coord || `${p.lat}, ${p.lng}`;
  setHouse({ lat: p.lat, lng: p.lng });
  applyProject(p);
  proj.opening = false;
  $('coordMsg').className = 'msg ok'; $('coordMsg').textContent = `Đã nhận vị trí ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  goStep(2);
  // ảnh trên máy chỉ dùng khi đúng căn này (tránh ảnh căn trước lọt vào video căn Claude vừa tạo)
  if ((await kvGet('photosHouse')) === houseKey()) loadPhotoBlobs().then(async blobs => { for (const b of blobs.slice(0, MAX_PHOTOS)) S.photos.push({ blob: b, url: URL.createObjectURL(b), bmp: await toBitmap(b) }); renderPhotos(); });
  else renderPhotos();
  startPoll();
  syncBadge('🤖 Video Claude tạo — Agent đang dựng, xong sẽ gửi kịch bản cho Claude', 'run');
  runAgent();
}
function detachProject() {
  proj = null; clearInterval(pollT); pollT = 0; syncBadge('');
  if (/[?&]p=/.test(location.search)) history.replaceState(null, '', location.pathname);
}
// video dựng trên web (không qua Claude) của khách đủ điều kiện → lưu lên máy chủ để Claude của khách thấy + sửa được
async function afterAgent() {
  if (proj) {
    // Claude sửa trong lúc Agent đang dựng lần đầu → câu mới chưa có giọng: đọc nốt rồi dựng lại
    if (token() && !voiceErr && allLines(story).some(t => !voiceOf(t))) await redo();
    snapSoon(); cloudDirty();
    syncBadge(`🤖 Đã gửi kịch bản cho Claude · bản ${proj.rev}`, 'ok'); return;
  }
  if (!token() || !S.house) return;
  syncOkJob ||= rpc('vt_dd_ok', { p_token: token() }).then(r => !!r?.ok).catch(() => false);
  if (!(await syncOkJob) || proj) return;
  try {
    const pl = cloudPayload();
    const r = await rpc('vt_dd_create', { p_token: token(), p_data: { lat: S.house.lat, lng: S.house.lng, coord: $('coord').value.trim().slice(0, 300), ...pl, title: (S.listing?.title || '').slice(0, 80) } });
    if (!r || r.skip || !r.id) return;
    proj = { id: r.id, rev: r.rev, lat: S.house.lat, lng: S.house.lng, opts: r.opts || {} };
    history.replaceState(null, '', location.pathname + '?p=' + r.id);
    proj.sent = r.existing ? '' : JSON.stringify(pl);   // video cũ cùng căn → lưu bản đang dựng lên
    startPoll(); cloudDirty(); snapSoon();
    syncBadge('🤖 Đã lưu — Claude của anh/chị đọc và sửa được video này', 'ok');
  } catch { /* lưu lên máy chủ lỗi: video trên trang vẫn dùng bình thường */ }
}
function cloudPayload() {
  const o = { ...(proj?.opts || {}), music: S.music, bird: $('bird').checked, brand: $('brand').value.trim(), voice: VOICE.id,
    manual: S.manual.filter(m => Number.isFinite(m.lat)).map(m => ({ id: m.id, name: m.name, cat: m.cat, lat: m.lat, lng: m.lng })).slice(-12) };
  if (S.listingFix && Object.keys(S.listingFix).length) o.fix = S.listingFix; else delete o.fix;
  return { listing: $('listing').value, buyer: S.buyer || null, edits: S.edits || {}, opts: o };
}
// nối việc đồng bộ thành một hàng (lưu chỉnh sửa trước, gửi ảnh chụp sau) — không gọi chồng nhau
const queue = fn => (syncChain = syncChain.then(fn, fn).catch(() => {}));
let saveT = 0, snapT = 0;
function cloudDirty() {
  if (!proj || applying || proj.opening || !token()) return;
  clearTimeout(saveT); saveT = setTimeout(() => queue(cloudSave), 1500);
}
async function cloudSave() {
  if (!proj || applying) return;
  const pl = cloudPayload(), js = JSON.stringify(pl);
  if (js === proj.sent) return;
  const r = await rpc('vt_dd_save', { p_token: token(), p_id: proj.id, p_base_rev: proj.rev, p_data: pl }).catch(() => null);
  if (!r) return;
  if (r.conflict) { await pull(); return; }   // Claude vừa sửa: bản trên máy chủ thắng (đã nhập vào trang)
  proj.rev = r.rev; proj.sent = js; proj.lastBy = '';
  snapSoon();
}
function snapSoon() {
  if (!proj || !story || !agentDone) return;
  clearTimeout(snapT); snapT = setTimeout(() => queue(sendSnap), 1200);
}
async function sendSnap() {
  if (!proj || !story) return;
  if (saveT && JSON.stringify(cloudPayload()) !== proj.sent) await cloudSave();
  const rev = proj.rev, snap = buildSnap();
  const r = await rpc('vt_dd_snap', { p_token: token(), p_id: proj.id, p_rev: rev, p_snap: snap }).catch(() => null);
  if (r?.stale) { pollOnce(); return; }
  if (r?.ok && !dirty) syncBadge(proj.lastBy ? `✨ ${proj.lastBy} đã sửa · bản ${rev} — bấm ▶ để xem` : `🤖 Đã đồng bộ với Claude · bản ${rev}`, 'ok');
}
function startPoll() {
  if (pollT) return;
  pollT = setInterval(pollOnce, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollOnce(); });
}
let polling = false, pullWaiting = false;
async function pollOnce() {
  if (!proj || polling || document.visibilityState !== 'visible' || $('exportBtn').disabled) return;
  polling = true;
  try {
    const r = await rpc('vt_dd_poll', { p_token: token(), p_id: proj.id }).catch(() => null);
    if (r?.gone) { syncBadge('Video này đã bị xoá khỏi danh sách (Claude hoặc máy khác). Video trên trang vẫn dùng được.', 'warn'); detachProject(); return; }
    if (r && r.rev > proj.rev) await queue(pull);
  } finally { polling = false; }
}
// Claude (hoặc máy khác) vừa sửa → nhập bản mới, đọc lại giọng câu đã đổi, dựng lại
async function pull() {
  if (!proj) return;
  const p = await rpc('vt_dd_get', { p_token: token(), p_id: proj.id }).catch(() => null);
  if (!p || p.rev <= proj.rev) return;
  const by = p.by === 'web' ? 'Máy khác' : 'Claude';
  applyProject(p); proj.lastBy = by;
  if (!agentDone) return;   // Agent đang dựng lần đầu: dựng xong tự dùng bản mới (đã gán S.edits)
  if (pullWaiting) return;
  pullWaiting = true;
  try {
    syncBadge(`✨ ${by} vừa sửa video — đang đọc lại giọng câu đã đổi và dựng lại…`, 'run');
    await sleep(600);
    story = currentStory(); renderBoard();
    await redo();
    syncBadge(`✨ ${by} đã sửa xong · bản ${proj.rev} — bấm ▶ để xem`, 'ok');
  } finally { pullWaiting = false; }
}
// ---------- Ảnh chụp video cho Claude ----------
const LONGW = { intro: 38, house: 62, lot: 62, roads: 50, radar: 70, overview: 36, summary: 56, rd: 22, build: 34, score: 56, cta: 34, airport: 30, metro: 30, road: 26, photos: 18, poi: 26, anchor: 30, cluster: 30, orbit: 70 };
const plainLine = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
const splitKey = key => { const i = key.indexOf(':'); return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)]; };   // id điểm mốc có dấu ':' ("center:Trung tâm…")
function lineOf(st, key) {
  const [k, id] = splitKey(key), L = st.lines;
  if (k === 'anchor') return L.anchor[st.anchors.findIndex(a => a.id === id)];
  if (k === 'poi') return L.poi[st.pois.findIndex(p => p.id === id)];
  if (k === 'rd') return L.rd?.[st.roads.findIndex(r => r.id === id)];
  return L[k];
}
function sceneTitle(st, key) {
  const [k, id] = splitKey(key);
  const nm = k === 'anchor' ? st.anchors.find(a => a.id === id)?.name : k === 'poi' ? st.pois.find(p => p.id === id)?.name : k === 'rd' ? st.roads.find(r => r.id === id)?.name : '';
  return { intro: 'Mở đầu (quả địa cầu → tỉnh → xã → ghim nhà)', house: `${KINDS[st.kind]?.label || 'Căn nhà'} · lượn 360° cận cảnh`, lot: 'Lô đất · lượn 360° cận cảnh', roads: '❓ Sống ở đây có tiện không? · trục đường lớn',
    radar: '📡 Radar tiện ích quanh nhà', overview: '❓ Sống ở đây có tiện không? · vòng bán kính', summary: '❓ Vì sao nên mua? · tổng kết', score: '❓ Vì sao nên mua?', build: '🚧 Hạ tầng đang thi công',
    cta: 'Kêu gọi (cuối video)', photos: 'Ảnh thực tế', metro: '🚇 Metro', road: '🛣 Cao tốc', airport: '✈️ Sân bay', cluster: 'Gom tiện ích', orbit: 'Lượn 360° góc xa',
    anchor: '🧭 Kết nối vùng · ' + nm, poi: '📍 ' + nm, rd: '🛣 ' + nm }[k] || key;
}
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
function buildSnap() {
  const st = story, L = S.listing || {}, { facts, segments, back } = aiPayload(st, L);
  const canh = [];
  const push = (key, seg) => {
    const text = lineOf(st, key); if (text == null && key !== 'photos') return;
    const { canh: mo, ...du } = seg || {};
    // cảnh căn nhà / mở đầu: kèm thông tin căn (Claude viết lời cần đủ số liệu ngay trong cảnh)
    if (key === 'house' || key === 'lot') Object.assign(du, { thong_tin_nha: facts.thong_tin_nha, diem_noi_bat: facts.diem_noi_bat, loai_bds: facts.loai_bds, khach_muc_tieu: facts.khach_muc_tieu });
    if (key === 'intro') Object.assign(du, { xa_phuong: facts.xa_phuong, tinh_thanh: facts.tinh_thanh, loai_bds: facts.loai_bds });
    canh.push({ key, ten: sceneTitle(st, key), mo_ta: mo || '', du_lieu: du, loi: plainLine(text), toi_da_chu: LONGW[splitKey(key)[0]] || 30,
      da_sua: !!S.edits.lines?.[key], co_giong: !!(text && voiceOf(text)) });
  };
  for (const [k, seg] of Object.entries(segments)) if (back[k] !== 'cta') push(back[k], seg);
  if (S.photos.length && st.lines.photos) push('photos', { canh: 'Ảnh thực tế cuối video, mỗi ảnh ~3 giây', so_anh: S.photos.length });
  if (segments.outro) push('cta', segments.outro);
  const chosen = new Set(st.pois.map(p => p.id)), perCat = {};
  const cands = (S.scan?.pois || []).filter(p => !chosen.has(p.id) && p.km <= 5 && CAT3D[p.cat]).sort((a, b) => a.km - b.km)
    .filter(p => (perCat[p.cat] = (perCat[p.cat] || 0) + 1) <= 15).slice(0, 150).map(p => ({ id: p.id, ten: p.name, loai: p.cat, cach_km: r2(p.km) }));
  const roadSel = new Set(st.roads.map(r => r.id));
  const lines = allLines(st), voiced = lines.filter(t => voiceOf(t)).length;
  const issues = [];
  if (!token()) issues.push('Trang chưa đăng nhập: chưa có giọng đọc.');
  else if (voiced < lines.length) issues.push(voiceErr ? 'Giọng đọc lỗi: ' + voiceErr : `Còn ${lines.length - voiced} câu chưa có giọng (trang đang đọc / sẽ đọc khi bấm Tạo lại video hoặc Xuất).`);
  if (!S.photos.length) issues.push('Chưa có ảnh thực tế: người dùng tự thêm ảnh trên trang (ảnh chỉ lưu trên máy, không gửi lên máy chủ).');
  if (proj?.voiceNote) issues.push(proj.voiceNote);
  if (dirty) issues.push('Người dùng đang sửa trên trang, chưa bấm "Tạo lại video".');
  const url = pageLink();
  return {
    v: 1, at: new Date().toISOString(),
    tieu_de: L.title || st.cover?.title || '', loai: st.kind, loai_ten: KINDS[st.kind]?.label, khach: S.buyer,
    xa: storeData().ward || L.ward || '', tinh: L.province || st.area?.province?.name || '',
    thoi_luong_giay: dir?.duration ? Math.round(dir.duration * 10) / 10 : null,
    phong_cach: TONES.some(([v]) => v !== 'auto' && v === S.edits.tone) ? S.edits.tone : autoTone(S.buyer), phong_cach_chon: $('tone').value, kieu_hien: st.flow, che_do: st.engine, nhac: S.music, giong: VOICE.id,
    tuy_chon: { ban_day_du: !!st.full, qua_dia_cau: !!st.globe, gia_cuoi: !!st.priceEnd, mau_the: st.labelStyle, cta_cach: st.ctaMode, cta_chu: st.ctaKey, duong_chim_bay: !!st.bird, thuong_hieu: $('brand').value.trim() },
    hieu_tin_dang: summaryChips(L),
    canh,
    tien_ich_da_chon: st.pois.map(p => ({ id: p.id, ten: p.name, ten_ngan: shortName(p.name), loai: p.cat, cach_km: r2(p.km), phut: p.min != null ? Math.max(1, Math.round(p.min)) : null })),
    tien_ich_goi_y: cands,
    radar: st.radar ? { ban_kinh_km: st.radar.r, so_tien_ich: st.radar.n, diem: st.radar.pts.map(p => ({ ten: p.label, loai: p.cat, doc_ten: !!p.named })) } : null,
    truc_duong: st.roads.map(r => ({ id: r.id, ten: r.name, cach_km: r2(r.km), phut: r.km < 0.12 ? null : r.min })),
    truc_duong_goi_y: (S.scan?.roads || []).filter(r => r.level >= 1 && !roadSel.has(r.id) && r.nearKm <= 12).sort((a, b) => a.nearKm - b.nearKm).slice(0, 20)
      .map(r => ({ id: r.id, ten: r.label, cach_km: r2(r.nearKm), cap: r.level })),
    diem_moc: (S.anchors || []).map(a => ({ id: a.id, loai: a.type, ten: a.name, km: a.km, phut: a.min, bat: st.anchors.some(x => x.id === a.id) })),
    ha_tang: { metro: S.infra?.metro ? { ten: S.infra.metro.name, bat: !!st.infra?.metro } : null, road: S.infra?.road ? { ten: S.infra.road.name, bat: !!st.infra?.road } : null },
    dang_thi_cong: (S.build || []).map(b => ({ id: b.id, ten: b.name, cach_km: r2(b.nearKm), bat: st.build.some(x => x.id === b.id) })),
    ly_do: st.reasons || [],
    so_lieu: facts,
    bai_dang: { mo_ta: postText(st, L, url), binh_luan_ghim: commentText(st, url), trang_web_can: url || null },
    anh: S.photos.length,
    giong_doc: { co: voiced, tong: lines.length, dang_nhap: !!token() },
    luu_y: issues,
  };
}

// ---------- gắn sự kiện ----------
$('full').onchange = () => { S.edits.full = $('full').checked; edited(); };
$('globe').onchange = () => { S.edits.globe = $('globe').checked ? undefined : false; edited(); };
$('priceEnd').onchange = () => { S.edits.priceEnd = $('priceEnd').checked ? undefined : false; edited(); };
$('flow').onchange = () => { S.edits.flow = $('flow').value === 'lanluot' ? 'lanluot' : undefined; edited(); };
// mẫu thẻ tiện ích: không đổi lời → dựng lại ngay, không cần đọc lại giọng
$('labelStyle').onchange = () => { S.edits.labelStyle = $('labelStyle').value; save(); if (dirty) edited(); else rebuild(); };
$('ctaMode').onchange = () => { S.edits.ctaMode = $('ctaMode').value; edited(); };
$('ctaKey').addEventListener('change', () => { S.edits.ctaKey = $('ctaKey').value.trim().toUpperCase().slice(0, 18) || undefined; edited(); });
$('copyPost').onclick = () => copyTxt($('postText'), $('copyPost'));
$('copyCmt').onclick = () => copyTxt($('postCmt'), $('copyCmt'));
$('pageBtn').onclick = makePage;
$('go1').onclick = () => step1();
$('coord').addEventListener('keydown', e => { if (e.key === 'Enter') step1(); });
$('listing').addEventListener('input', onListing);
$('brand').addEventListener('change', save);
$('editInfo').onclick = () => { const f = $('infoform'); f.hidden = !f.hidden; if (!f.hidden) renderInfoForm(); };
$('go2').onclick = runAgent;
$('play').onclick = play;
$('cv').onclick = () => playing ? stop() : play();
$('bird').onchange = edited;
// đổi màu ảnh bìa: không đổi lời → dựng lại ngay, không cần đọc lại giọng
$('coverColor').onclick = () => {
  const base = Math.abs(Math.round(S.house.lat * 1e4 + S.house.lng * 1e4));
  S.edits.palette = (S.edits.palette ?? base) + 1;
  if (dirty) edited(); else rebuild();
};
$('music').onchange = () => { S.music = $('music').value; save(); if (!dirty && playing) play(); else mixReady(); };
for (const [v, t] of TONES) $('tone').append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
$('tone').onchange = () => setTone($('tone').value);
$('aiWrite').onclick = aiWrite;
$('redo').onclick = redo;
$('loginBtn').onclick = () => goLogin();
$('addPoi').onclick = openSheet;
$('sheetX').onclick = closeSheet;
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.t));
$('poiSearch').addEventListener('input', renderPoiList);
$('exportBtn').onclick = () => exportVideo();
document.querySelectorAll('.steps li').forEach(li => li.addEventListener('click', () => {
  const n = +li.dataset.s; if (n === 1 || (n === 2 && S.house) || (n === 3 && story)) goStep(n);
}));
renderBuyers();
$('phInput').addEventListener('change', e => addPhotos([...e.target.files]));
{ const pid = projectIdFromUrl(); if (pid) openProject(pid); else restore(); }
renderTones();
// ô ảnh vệ tinh phần vẽ kiểu app cũ: dùng khoá ArcGIS như app cũ (xem trước), xuất video đi phiên bản đồ
fetch('/api/config').then(r => (r.ok ? r.json() : null)).then(c => setImageryToken(c?.arcgis || ''), () => setImageryToken(''));
// nguồn ô vệ tinh (phiên tạo mới / phiên lỗi / phải dùng nguồn công khai) → phễu f_o_* như app cũ → báo cáo 7h sáng đếm đủ phiên của AI đạo diễn
onTileSource(k => funnel('o_' + k));
xuatCheckCrash();   // lần xuất trước không kết thúc bình thường (văng / tắt trang) → đếm cho báo cáo 7h
funnel('dd_vao');   // phễu nội bộ AI đạo diễn: dd_nut (app cũ) → dd_vao → dd_agent → dd_xuat → dd_xuat_xong / dd_xuat_loi (không gửi Meta/TikTok)
window.__dd = { S, get story() { return story; }, get dir() { return dir; }, rebuild, exportVideo, setHouse, addPhotos, lines: () => story ? allLines(story) : [],
  sync: { get proj() { return proj; }, buildSnap: () => story && buildSnap(), pollOnce },
  ...(DEV ? { exportSource: (w, h) => exportSource(w, h, story) } : {}) };
