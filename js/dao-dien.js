// Trang AI đạo diễn (/dao-dien.html) — chế độ MỚI cho khách mới, tách hẳn khỏi kiểu cũ (index.html giữ nguyên).
// 3 bước: dán toạ độ → dán tin đăng + chọn khách mua → Agent dựng video → (sửa nếu cần) → xuất MP4.
// Dùng lại bộ quét (js/data.js), giọng đọc + lượt (js/dd-voice.js → /api/tts, vt_me, vt_export_begin), bộ xuất (js/export.js).
import maplibregl from 'maplibre-gl';
import { parseCoords, haversineKm } from './geo.js';
import { scanArea, routeTo, pickHubs, loadHubFx, simplifyLine, CATEGORIES, loadZones, loadInfra, placesNear, guessCategory } from './data.js';
import { HUBS } from './hubs.js';
import { parseListing, summaryChips, KINDS } from './dd-parse.js';
import { BUYERS, suggestBuyer, buildStory, MUSIC_LIB } from './dd-agent.js';
import { createDirector3D, CAT3D, kmBetween, fmtKm } from './dd3d.js';
import { exportMp4, decodeAudioFile, mixAudio, canEncodeMp4 } from './export.js';
import { token, voiceLines, voiceOf, canExport, chargeExport } from './dd-voice.js';
import { MAX_PHOTOS, savePhotos, loadPhotoBlobs, shrink, toBitmap } from './dd-photos.js';
import { track } from './track.js';

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
  S.house = h; S.scan = null; S.routes = {}; S.anchors = []; S.infra = null; S.edits = {}; S.manual = [];
  startScan();
}
// Quét ngay khi có vị trí (chạy nền trong lúc khách dán tin)
function startScan() {
  const h = S.house, st = $('scanState');
  st.className = 'scan'; st.textContent = '⏳ Đang quét tiện ích quanh nhà…';
  S.scanJob = (async () => {
    const res = await scanArea(h, 5, null, m => { if (S.house === h) st.textContent = '⏳ ' + m; });
    if (S.house !== h) return null;
    S.scan = res;
    for (const m of S.manual) if (!res.pois.some(p => p.id === m.id)) res.pois.push(m);   // tiện ích khách đã ghim tay (giữ qua tải lại trang)
    st.className = 'scan ok'; st.textContent = `✓ Đã quét ${res.pois.length} tiện ích quanh nhà`;
    renderPoiPick();
    loadRegion(h);
    return res;
  })().catch(e => { st.className = 'scan'; st.textContent = 'Quét chưa xong: ' + (e.message || e) + '. Bấm Agent dựng video để thử lại.'; S.scanJob = null; return null; });
}
// Điểm mốc vùng (trung tâm, sân bay, ga…) + hạ tầng (sân bay có đường băng, metro đang chạy, cao tốc)
let regionJob = null;
function loadRegion(h) {
  regionJob = (async () => {
    const hubs = pickHubs(h);
    const routes = await Promise.all(hubs.map(x => routeTo(h, x).catch(() => null)));
    S.anchors = hubs.map((x, i) => {
      const r = routes[i], kmv = r ? r.km : x.km0 * 1.35;
      const typical = kmv / Math.max(26, Math.min(70, 24 + 0.5 * kmv)) * 60;   // như app cũ: không phụ thuộc giờ kẹt xe lúc quét
      return { id: x.id, type: x.type, name: x.name, lat: x.lat, lng: x.lng, km: Math.round(kmv * 10) / 10,
        min: Math.max(1, Math.round(r && r.min > 0 ? Math.min(r.min, typical) : typical)), coords: r ? simplifyLine(r.coords, 0.015) : null };
    });
    const H = [h.lng, h.lat], infra = {};
    const ap = S.anchors.find(a => a.type === 'airport' && a.min <= 60);
    if (ap) {
      const fx = await loadHubFx({ type: 'airport', name: ap.name, lat: ap.lat, lng: ap.lng }).catch(() => null);
      if (fx?.runway) infra.airport = { name: ap.name, a: [fx.runway.a[1], fx.runway.a[0]], b: [fx.runway.b[1], fx.runway.b[0]], km: ap.km, min: ap.min };
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
    S.build = await loadInfra(h).catch(() => []);
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
}

// ---------- Ảnh căn nhà (tối đa 12, chỉ lưu trên máy khách) ----------
function renderPhotos() {
  const g = $('phGrid'); g.textContent = '';
  S.photos.forEach((ph, i) => {
    const d = Object.assign(document.createElement('div'), { className: 'ph' });
    d.append(Object.assign(document.createElement('img'), { src: ph.url, alt: 'Ảnh căn ' + (i + 1) }));
    if (!i) d.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'Bìa' }));
    const x = Object.assign(document.createElement('button'), { className: 'x', textContent: '✕', type: 'button' });
    x.setAttribute('aria-label', 'Bỏ ảnh này');
    x.onclick = () => { URL.revokeObjectURL(ph.url); ph.bmp.close?.(); S.photos.splice(i, 1); photosChanged(); };
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
  renderPhotos();
  if (story) edited();
}

// ---------- Bước 3: Agent ----------
const TASKS = ['Quét tiện ích quanh nhà', 'Tìm đường đi thật tới tiện ích', 'Chọn tiện ích hợp với khách mua', 'Viết lời đọc theo số liệu thật', 'AI đọc lời bằng giọng thật', 'Dựng cảnh 3D'];
function setTask(i, extra = '') {
  const lis = $('tasks').children;
  for (let j = 0; j < lis.length; j++) { lis[j].className = j < i ? 'done' : j === i ? 'run' : ''; lis[j].dataset.x = j === i ? extra : ''; }
  if (lis[i]) lis[i].lastChild.textContent = TASKS[i] + (extra ? ` · ${extra}` : '');
}
async function runAgent() {
  if (!S.house) { goStep(1); return; }
  if (!S.listing) S.listing = { kind: 'nhapho' };
  if (!S.buyer) S.buyer = suggestBuyer(S.listing.kind);
  save(); goStep(3);
  $('agent').hidden = false; $('studio').hidden = true;
  $('tasks').textContent = '';
  for (const t of TASKS) { const li = document.createElement('li'); li.append(document.createElement('i'), document.createTextNode(t)); $('tasks').append(li); }
  setTask(0);
  if (!S.scan) { if (!S.scanJob) startScan(); await S.scanJob; }
  if (!S.scan) { $('tasks').lastChild.after(Object.assign(document.createElement('li'), { textContent: 'Quét chưa được, kiểm tra mạng rồi bấm lại.' })); return; }
  setTask(1);
  const chosen = buildStory(storeData(), S.listing, S.buyer, S.edits).pois.map(p => p.id);
  await routesFor(chosen);
  // ranh vùng quan trọng của tiện ích đã chọn (khu công nghiệp, bệnh viện, đại học, công viên…)
  S.zones = await loadZones(S.scan.pois.filter(p => chosen.includes(p.id))).catch(() => []);
  setTask(2); await tick(300);
  setTask(3); if (regionJob) await Promise.race([regionJob, tick(6000)]);
  story = currentStory();
  setTask(4);
  await voiceAll(n => setTask(4, n));
  setTask(5); await tick(250);
  setTask(6);
  $('agent').hidden = true; $('studio').hidden = false;
  fillMusic();
  await rebuild(true);
}
const tick = ms => new Promise(r => setTimeout(r, ms));
async function routesFor(ids) {
  const byId = new Map(S.scan.pois.map(p => [p.id, p]));
  await Promise.all(ids.filter(id => !(id in S.routes)).map(async id => {
    const p = byId.get(id); if (!p) return;
    S.routes[id] = await routeTo(S.house, p).catch(() => null);
  }));
}
function storeData() {
  const sc = S.scan || { pois: [] };
  return { house: S.house, pois: sc.pois, streets: sc.streets, roads: sc.roads, roadsAll: sc.roads, zones: S.zones, build: S.build, airportParts: S.airportParts, routes: S.routes, anchors: S.anchors, infra: S.infra,
    ward: sc.area?.ward?.name || sc.admin?.commune || '' };
}
// mọi câu lời đọc của kịch bản hiện tại (theo thứ tự cảnh)
const allLines = st => { const L = st.lines; return [L.intro, st.lot ? L.lot : L.house, L.roads, L.build, L.photos, ...L.poi, ...L.anchor, L.airport, L.metro, L.road, st.score ? L.score : null, L.cta].filter(Boolean); };
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
  return buildStory(storeData(), S.listing, S.buyer, { ...S.edits, bird: $('bird').checked, watermark: $('brand').value.trim(), photos: S.photos.map(p => p.bmp) });
}
// gắn giọng đã có vào kịch bản; câu chưa có giọng thì nhịp cảnh ước theo số chữ
function withVoice(st) {
  const L = st.lines;
  return { ...st, paceByText: true, voice: { intro: voiceOf(L.intro), house: voiceOf(L.house), lot: voiceOf(L.lot), poi: L.poi.map(voiceOf), anchor: L.anchor.map(voiceOf),
    photos: voiceOf(L.photos), roads: voiceOf(L.roads), build: voiceOf(L.build), airport: voiceOf(L.airport), metro: voiceOf(L.metro), road: voiceOf(L.road), score: voiceOf(L.score), cta: voiceOf(L.cta) } };
}
async function rebuild(autoplay = false) {
  stop();
  story = currentStory();
  renderBoard();
  dir?.destroy();
  const cv = $('cv');
  // chữ in dẹt / ảnh bìa dùng Montserrat 900: chờ phông tải xong mới vẽ (không thì khung đầu ra phông dự phòng)
  await Promise.all(['900 40px Montserrat', '800 40px "Be Vietnam Pro"'].map(f => document.fonts.load(f).catch(() => {})));
  dir = createDirector3D({ width: cv.width, height: cv.height, story: withVoice(story) });
  await dir.ready;
  dir.live(cv.getContext('2d'));
  dir.setFrame(0.01);
  setDirty(false);
  const missing = allLines(story).some(t => !voiceOf(t));
  $('voiceNote').hidden = !(missing && (!token() || voiceErr === 'login'));
  if (autoplay) play();
}
// Khách sửa (thứ tự / thêm / bỏ / lời): cập nhật bảng ngay, video tạo lại khi bấm "Tạo lại video" (đọc lại câu đã sửa)
let dirty = false;
function setDirty(v) {
  dirty = v; $('redo').hidden = !v; $('stale').hidden = !v; $('exportBox').hidden = v;
  if (v) { stop(); $('play').classList.add('hide'); }
}
function edited() { story = currentStory(); renderBoard(); setDirty(true); save(); }

// ✨ AI viết lời (máy chủ /api/script như kiểu cũ: Claude viết + máy bắt số bịa + biên tập). Công thức theo khách:
// mua để ở → P.A.S (đánh trúng nỗi đau), đầu tư cho thuê → A.I.D.A, kết nối khu vực → chuyên gia đầu tư. Lời dài hơn (long).
const TONES = [['auto', '🤖 AI tự chọn theo khách'], ['pas', 'P.A.S · đánh trúng nỗi đau'], ['aida', 'A.I.D.A · chú ý → hành động'],
  ['ke-chuyen', 'Kể chuyện · cảm xúc'], ['chuyen-gia', 'Chuyên gia đầu tư'], ['chot-sale', 'Chốt sale mạnh']];
const autoTone = b => (b === 'o' ? 'pas' : b === 'thue' ? 'aida' : 'chuyen-gia');
const BDS = { nhapho: ['Căn nhà', 'đi xem nhà'], bietthu: ['Biệt thự', 'đi xem biệt thự'], nhavuon: ['Nhà vườn', 'đi xem nhà vườn'], canho: ['Căn hộ', 'đi xem căn hộ'], datnen: ['Lô đất', 'đi xem lô đất'] };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function aiPayload(st, L) {
  const [loai, xem] = BDS[st.kind] || BDS.nhapho, mm = p => (p.min != null ? Math.max(1, Math.round(p.min)) : null);
  const facts = {
    loai_bds: loai, tieu_de: L.title || null,
    thong_tin_nha: { gia: L.price || null, dien_tich: L.dims || (L.area ? `${L.area} m²` : null), loai_dat: L.thoCu || null, so_tang: (st.kind !== 'canho' && L.floors) || null,
      can_ho_o_tang: L.level || null, phong_ngu: L.beds || null, phap_ly: L.legal || null, duong_truoc_nha: L.road || null },
    diem_noi_bat: L.highlights || [], khach_muc_tieu: { o: 'o', thue: 'cho_thue', vung: 'dau_tu' }[S.buyer] || null,
    xa_phuong: storeData().ward || L.ward || null, tinh_thanh: L.province || null,
    duong_lon: st.roads.map(r => ({ ten: r.name, cach: fmtKm(r.km) })),
    tien_ich: st.pois.map(p => ({ ten: p.name, cach: fmtKm(p.km), phut_xe_may: mm(p) })),
    ket_noi_vung: st.anchors.map(a => ({ ten: a.name, duong_di_km: a.km, phut_o_to: a.min })),
    ha_tang_dang_thi_cong: st.build.map(b => ({ ten: b.name, cach: fmtKm(b.km) })),
  };
  const seg = {}, back = {};
  const put = (k, local, v) => { seg[k] = v; back[k] = local; };
  put('intro', 'intro', { canh: 'Mở đầu: máy bay xuống ghim bất động sản. Câu móc thật mạnh 2 giây đầu' });
  put('house', st.lot ? 'lot' : 'house', { canh: st.lot ? 'Cận cảnh lô đất (khoanh ranh lô)' : 'Cận cảnh bất động sản, khối nhà nổi lên' });
  if (st.roads.length) put('roads', 'roads', { canh: 'Các trục đường lớn quanh nhà lần lượt sáng lên, tên đường in trên mặt đất', duong: facts.duong_lon });
  st.pois.forEach(p => put('poi:' + p.id, 'poi:' + p.id, { canh: 'Tiện ích: đường đi thật từ nhà sáng lên', ten: p.name, cach: fmtKm(p.km), phut_xe_may: mm(p) }));
  st.anchors.forEach(a => put('anchor:' + a.id, 'anchor:' + a.id, { canh: 'Điểm mốc vùng: đường đi thật', ten: a.name, duong_di_km: a.km, phut_o_to: a.min }));
  if (st.infra?.airport) put('airport', 'airport', { canh: 'Sân bay, máy bay cất cánh', ten: st.infra.airport.name, duong_di_km: st.infra.airport.km, phut_o_to: st.infra.airport.min });
  if (st.infra?.metro) put('metro', 'metro', { canh: 'Tuyến metro', ten: st.infra.metro.name, ga_gan_nhat: st.infra.metro.nearName, ga_cach: fmtKm(st.infra.metro.nearKm) });
  if (st.infra?.road) put('road', 'road', { canh: 'Tuyến cao tốc / đường lớn', ten: st.infra.road.name, cach: fmtKm(st.infra.road.km) });
  if (st.build.length) put('infra', 'build', { canh: 'Hạ tầng đang thi công gần nhà (nét đứt cam)', tuyen: facts.ha_tang_dang_thi_cong });
  if (st.score) put('score', 'score', { canh: `Tổng kết: số tiện ích trong bán kính ${st.scoreR || 1} km quanh nhà`, so_lieu: Object.fromEntries(st.score.filter(x => x[1]).map(x => [x[0], x[1]])) });
  if (st.photos.length) put('photos', 'photos', { canh: 'Bản đồ đã xong, chuyển sang ảnh thực tế: 1 câu mời người xem cùng xem hình ảnh thực tế' });
  put('outro', 'cta', { canh: `Kết video: nhắc giá (nếu có) và kêu gọi NHẮN TIN hẹn ${xem} (đúng chữ này). Không đọc số điện thoại.` });
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
      body: JSON.stringify({ facts, segments, tone, long: true, lat: S.house.lat, lng: S.house.lng }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'HTTP ' + res.status);
    const lines = { ...(S.edits.lines || {}) };
    let n = 0;
    // số liệu (km, m, phút, tỷ…) tô vàng như câu Agent viết
    for (const [k, v] of Object.entries(j.segments || {})) if (back[k] && v) { lines[back[k]] = esc(v).replace(/(\d[\d.,]*\s*(km|m²|mét vuông|mét|m|phút|tỷ|triệu)?)/g, '<b>$1</b>'); n++; }
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
  await voiceAll(n => { if (n) b.textContent = `🎙 AI đang đọc lại… ${n}`; });
  await rebuild(true);
  b.disabled = false; b.textContent = '🔄 Tạo lại video';
}
async function getMusic(name) {
  if (!(name in musicBuf)) musicBuf[name] = await decodeAudioFile(await fetch(`music/${name}.m4a`).then(r => r.blob())).catch(() => null);
  return musicBuf[name];
}
const mixFor = async d => mixAudio({ music: await getMusic(S.music), voiceSegs: d.voiceSegs, sfx: { events: d.sfx, vol: 0.8 }, duration: d.duration, musicVol: 0.8 });
function fillMusic() {
  const m = $('music'); m.textContent = '';
  const sug = story?.style?.suggest;
  for (const [id, label] of MUSIC_LIB) m.append(Object.assign(document.createElement('option'), { value: id, textContent: label + (id === sug && id !== 'hung-hon' ? ' · AI gợi ý' : ''), selected: id === S.music }));
}
async function play() {
  if (!dir || dirty) return;
  stop();
  actx = actx || new AudioContext(); actx.resume();
  playing = true; $('play').classList.add('hide');
  const buf = await mixFor(dir);
  if (!playing) return;
  src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
  const a0 = actx.currentTime + 0.05; src.start(a0);
  const loop = () => {
    if (!playing || !dir) return;
    const t = Math.max(0, actx.currentTime - a0);
    dir.setFrame(Math.min(t, dir.duration));
    $('barFill').style.width = (Math.min(1, t / dir.duration) * 100) + '%';
    if (t < dir.duration) raf = requestAnimationFrame(loop); else stop();
  };
  raf = requestAnimationFrame(loop);
}
function stop() {
  playing = false; cancelAnimationFrame(raf);
  try { src?.stop(); } catch { /* đã dừng */ } src = null;
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
  chip('🔍 Tìm / ghim tiện ích khác', 'more', openSheet);
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
  // trục đường lớn: AI chọn 3, khách bấm để thêm (tối đa 5) / bỏ
  const cands = (S.scan?.roads || []).filter(r => r.level >= 1 && r.nearKm <= 3.4).sort((a, c) => a.nearKm - c.nearKm).slice(0, 8);
  if (cands.length) {
    const sel = story.roads.map(r => r.id), ex = document.createElement('div'); ex.className = 'chips road-chips';
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
    b.append(sceneCard({ key: 'roads', title: `🛣 Trục đường lớn · ${sel.length} trục (tối đa 5)`, text: L.roads, extra: ex }));
  }
  b.append(sceneCard({ key: 'poipick', title: `📍 Tiện ích gần nhà · ${story.pois.length} đã chọn (tối đa ${POI_MAX})`, sub: ' · bấm ＋ để thêm', text: '', extra: poiChips(edited) }));
  b.lastChild.querySelector('textarea')?.remove();
  story.pois.forEach((p, i) => b.append(sceneCard({ key: 'poi:' + p.id, title: p.name, sub: ' · ' + fmtKm(p.km) + (p.min ? ` · ${Math.round(p.min)} phút` : ''), text: L.poi[i], cat: p.cat, drag: true, removable: true })));
  story.anchors.forEach((a, i) => b.append(sceneCard({ key: 'anchor:' + a.id, title: a.name, sub: ` · ${a.km} km · ${a.min} phút`, text: L.anchor[i], cat: a.type, drag: true, removable: true })));
  const inf = story.infra || {};
  if (story.build?.length) b.append(sceneCard({ key: 'build', title: '🚧 Hạ tầng đang thi công · ' + story.build[0].name, text: L.build, cat: 'road', removable: true }));
  if (inf.airport) b.append(sceneCard({ key: 'airport', title: 'Sân bay · máy bay cất cánh', text: L.airport, cat: 'airport', removable: true }));
  if (inf.metro) b.append(sceneCard({ key: 'metro', title: 'Metro · tàu chạy dọc tuyến', text: L.metro, cat: 'metro', removable: true }));
  if (inf.road) b.append(sceneCard({ key: 'road', title: 'Cao tốc', text: L.road, cat: 'road', removable: true }));
  if (story.score) b.append(sceneCard({ key: 'score', title: 'Điểm sống quanh nhà', text: L.score }));
  if (S.photos.length) {
    const ex = document.createElement('div'); ex.className = 'thumbs';
    for (const ph of S.photos.slice(0, 8)) ex.append(Object.assign(document.createElement('img'), { src: ph.url, alt: '' }));
    const go = Object.assign(document.createElement('button'), { className: 'link2', textContent: 'Sửa ảnh' }); go.onclick = () => goStep(2); ex.append(go);
    b.append(sceneCard({ key: 'photos', title: `Ảnh thực tế · ${S.photos.length} ảnh, mỗi ảnh ~3 giây (cuối video)`, text: L.photos, extra: ex }));
  }
  b.append(sceneCard({ key: 'cta', title: 'Kêu gọi nhắn tin', text: L.cta }));
  enableDrag(b);
}
function removeScene(key) {
  const [kind, id] = key.split(':');
  if (kind === 'poi') S.edits.order = story.pois.map(p => p.id).filter(x => x !== id);
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
function openSheet() {
  if (!S.scan) { alert('Đang quét tiện ích quanh vị trí, chờ vài giây rồi bấm lại.'); return; }
  $('sheet').hidden = false; $('poiSearch').value = ''; renderPoiList(); showTab('list');
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
async function exportVideo(localOnly = false) {
  localOnly = localOnly === true && DEV;
  if (!canEncodeMp4()) { alert('Trình duyệt này chưa xuất được video. Mở bằng Chrome hoặc Safari mới nhất.'); return; }
  stop();
  const bar = $('xbar'), fill = $('xfill'), txt = $('xtxt'), btn = $('exportBtn');
  bar.hidden = false; btn.disabled = true; $('out').textContent = ''; fill.style.width = '0';
  const t0 = performance.now();
  let xd = null;
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
    xd = createDirector3D({ width: w, height: h, story: withVoice(story) });
    await xd.ready;
    const audio = await mixFor(xd);
    const blob = await exportMp4({ tl: { duration: xd.duration, LW: w }, width: w, height: h, fps, audioBuffer: audio, source: xd.frameSource(),
      onProgress: (ph, a, b) => { if (ph === 'frames') { fill.style.width = (a / b * 100) + '%'; txt.textContent = `Đang dựng video ${Math.round(a / b * 100)}%`; } } });
    // xuất xong mới trừ lượt (1 vị trí = 1 lượt; xuất lại trong 24 giờ không trừ thêm)
    txt.textContent = 'Đang lưu lượt…';
    const r = localOnly ? { ok: true } : await chargeExport(S.house);
    if (!r.ok) {
      if (r.code === 'NO_CREDIT') { txt.textContent = 'Hết lượt — mua thêm lượt để tải video'; goLogin('#mua'); return; }
      throw new Error(r.message || 'Không trừ được lượt, thử lại.');
    }
    if (r.charged || r.mode === 'unlimited') track('export');
    const url = URL.createObjectURL(blob);
    fill.style.width = '100%'; txt.textContent = `✓ Xong trong ${Math.round((performance.now() - t0) / 1000)} giây`;
    const v = Object.assign(document.createElement('video'), { src: url, controls: true, playsInline: true });
    const a = Object.assign(document.createElement('a'), { href: url, download: `vi-tri-studio-ai-dao-dien-${h}p.mp4`, textContent: `⬇ Tải video về máy (${(blob.size / 1048576).toFixed(1)} MB)` });
    $('out').append(v, a);
    // ảnh bìa (khung đầu video) để đăng kèm / làm thumbnail
    try {
      const cc = document.createElement('canvas'); cc.width = w; cc.height = h;
      const p0 = xd.prepare(1.6); if (p0) await p0; xd.draw(cc.getContext('2d'), 1.6);
      const cb = await new Promise(r => cc.toBlob(r, 'image/jpeg', 0.92));
      $('out').append(Object.assign(document.createElement('a'), { href: URL.createObjectURL(cb), download: 'anh-bia.jpg', textContent: '🖼 Tải ảnh bìa' }));
    } catch { /* không có ảnh bìa vẫn xong video */ }
    window.__lastExport = { blob, sec: (performance.now() - t0) / 1000 };
  } catch (e) {
    const best = document.querySelector('input[name=q]:checked')?.value === 'best';
    txt.textContent = 'Lỗi: ' + (e.message || e) + (best && !/720p/.test(String(e.message)) ? ' Máy yếu thì chọn "Nhanh 720p" rồi xuất lại.' : '');
    window.__lastExport = { error: String(e.stack || e) };
  } finally { xd?.destroy(); btn.disabled = false; }
}

// ---------- gắn sự kiện ----------
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
  if (dirty) edited(); else rebuild(true);
};
$('music').onchange = () => { S.music = $('music').value; save(); if (!dirty) play(); };
for (const [v, t] of TONES) $('tone').append(Object.assign(document.createElement('option'), { value: v, textContent: t }));
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
restore();
window.__dd = { S, get story() { return story; }, get dir() { return dir; }, rebuild, exportVideo, setHouse, addPhotos };
