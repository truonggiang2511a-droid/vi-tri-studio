// Trang thử /thu-3d.html (nhánh ai-dao-dien): 4 kiểu AI đạo diễn trên căn mẫu An Lạc (sample.json — tiện ích, đường đi,
// điểm mốc vùng, hạ tầng đều là dữ liệu thật app đã quét). Kịch bản tạm viết sẵn — bước sau AI viết theo dữ liệu từng căn.
import { createDirector3D, rectM, kmBetween, fmtKm } from './dd3d.js';
import { exportMp4, decodeAudioFile, mixAudio, canEncodeMp4 } from './export.js';
import { loadHubFx } from './data.js';
import { HUBS } from './hubs.js';

const $ = s => document.querySelector(s);
const ll = ([lat, lng]) => [lng, lat];
const num = x => x.toFixed(1).replace('.', ',');

let sample = null, runwayCache;
async function base() {
  sample = sample || await fetch('sample.json').then(r => r.json());
  return sample;
}
function poiOf(S, src, name) {
  const p = S.pois.find(q => q.name === src); if (!p) throw new Error('Thiếu tiện ích ' + src);
  const r = S.routes?.[p.id], route = r && r.coords ? r.coords.map(ll) : null;
  return { name: name || p.name, cat: p.cat, at: route ? route[route.length - 1] : [p.lng, p.lat], km: r ? r.km : +p.km, min: r ? r.min : null, route };
}
function anchorOf(S, type, name) {
  const a = S.region.anchors.find(x => x.type === type && (!name || x.name === name));
  return a && { name: a.name, type: a.type, at: [a.lng, a.lat], km: a.km, min: a.min, route: (a.coords || []).map(ll) };
}
// Hạ tầng quanh căn: sân bay gần nhất (đường băng thật từ OpenStreetMap), metro đang chạy gần nhất, cao tốc gần nhất
async function infraOf(S, H) {
  const out = {};
  const ap = S.region.anchors.find(x => x.type === 'airport');
  if (ap) {
    if (runwayCache === undefined) runwayCache = await loadHubFx({ type: 'airport', name: ap.name, lat: ap.lat, lng: ap.lng }).catch(() => null);
    const rw = runwayCache?.runway;
    if (rw) out.airport = { name: ap.name, a: ll(rw.a), b: ll(rw.b), km: ap.km, min: ap.min };
  }
  // metro số 1 (đang chạy): ga theo thứ tự trong hubs.js; lia đoạn trên cao Văn Thánh → Rạch Chiếc
  const m1 = HUBS.filter(h => h[0] === 'metro' && h[2] < 11 && h[2] > 10.7).map(h => [h[1].replace('Ga metro ', ''), [h[3], h[2]]]);
  if (m1.length) {
    const near = m1.reduce((b, s) => kmBetween(H, s[1]) < kmBetween(H, b[1]) ? s : b);
    const seg = m1.slice(3, 8);
    out.metro = { name: 'Metro số 1 Bến Thành – Suối Tiên', sub: `Đang chạy · ga ${near[0]} ${fmtKm(kmBetween(H, near[1]))} chim bay`,
      line: seg.map(s => s[1]), stations: seg, nearName: near[0], nearKm: kmBetween(H, near[1]) };
  }
  const road = (S.region.infra || []).find(x => /cao tốc/i.test(x.label));
  if (road) {
    const ways = road.ways.map(w => w.map(ll)).filter(w => w.length > 1).sort((a, b) => kmBetween(H, a[0]) - kmBetween(H, b[0]));
    out.road = { name: road.label.replace(/\s*\(mở rộng\)/, ''), ways, km: road.nearKm };
  }
  return out;
}

// ---- 4 kiểu AI đạo diễn -----------------------------------------------------------------------------------------------
async function storyOf(mode) {
  const S = await base(), H = [S.house.lng, S.house.lat];
  const info = { price: S.price, chips: [S.area.replace('x', '×'), S.floors, S.beds + ' phòng ngủ', S.legal].filter(Boolean) };
  const cnt = c => S.pois.filter(p => p.cat === c && +p.km <= 1).length;
  const score = [['Trường học', 'truong'], ['Chợ, siêu thị', 'cho'], ['Công viên', 'congvien'], ['Y tế', 'yte'], ['Ngân hàng', 'nganhang']]
    .map(([n, c]) => [n, cnt(c), cnt(c) >= 40]);
  const wantInfra = mode === 'ketnoi' || $('#infra').checked;
  const infra = wantInfra ? await infraOf(S, H) : null;
  const L = {};
  if (infra?.airport) L.airport = `Sân bay ${infra.airport.name.replace('Sân bay ', '')}: <b>${num(infra.airport.km)} km</b>, khoảng <b>${infra.airport.min} phút</b>, bay đi mọi miền.`;
  if (infra?.metro) L.metro = `Metro số 1 Bến Thành – Suối Tiên đã chạy, ga ${infra.metro.nearName} cách khoảng <b>${num(infra.metro.nearKm)} km</b> đường chim bay.`;
  if (infra?.road) L.road = `${infra.road.name} cách nhà <b>${num(infra.road.km)} km</b>, về miền Tây nhanh.`;
  const common = { mode, house: H, info, bird: $('#bird').checked, infra, cta: 'Nhắn tin để xem nhà' };

  if (mode === 'giadinh') return { ...common, persona: 'Gia đình có con nhỏ', score,
    pois: [poiOf(S, 'Trường Mầm Non Mặt Trời Vàng', 'Mầm non Mặt Trời Vàng'), poiOf(S, 'Chợ Kiến Đức 2'), poiOf(S, 'Công Viên Nam Hùng Vương', 'Công viên Nam Hùng Vương'),
      poiOf(S, 'Trường liên cấp quốc tế Royal School', 'Royal School liên cấp quốc tế'), poiOf(S, 'Bệnh viện Triều An')],
    lines: { ...L,
      intro: 'Tìm nhà gần trường cho con? Căn này ở <b>Phường An Lạc</b>, trường mầm non chỉ cách <b>250 m</b>.',
      house: '<b>5×20 m</b>, 1 trệt 2 lầu, <b>3 phòng ngủ</b>, sổ hồng riêng.',
      poi: ['Sáng đưa con đi học: mầm non Mặt Trời Vàng, <b>250 m</b>.', 'Đi chợ Kiến Đức 2 chưa tới <b>1 phút</b> chạy xe.',
        'Chiều cho con ra công viên Nam Hùng Vương, <b>380 m</b>.', 'Lớn lên học tiếp trường liên cấp quốc tế Royal, <b>370 m</b>.', 'Bệnh viện Triều An cách <b>1,2 km</b>.'],
      score: 'Bán kính 1 km quanh nhà: <b>hơn 40 trường học</b>, 14 chợ và siêu thị.',
      cta: 'Giá <b>3,2 tỷ</b>. Nhắn tin ngay để hẹn xem nhà.' } };

  if (mode === 'dautu') return { ...common, persona: 'Nhà đầu tư cho thuê', score,
    pois: [poiOf(S, 'Khu công nghiệp Tân Tạo', 'KCN Tân Tạo'), poiOf(S, 'Đại học Kinh tế TP.HCM'), poiOf(S, 'Bến xe Miền Tây'), poiOf(S, 'Co.opmart Bình Tân'), poiOf(S, 'Big C An Lạc')],
    lines: { ...L,
      intro: 'Mua nhà để cho thuê? Căn này cách <b>KCN Tân Tạo 8 phút</b>, sát Đại học Kinh tế.',
      house: '<b>5×20 m</b>, 1 trệt 2 lầu, <b>3 phòng</b>, sổ hồng riêng, dễ chia phòng cho thuê.',
      poi: ['Khu công nghiệp Tân Tạo: <b>4,3 km</b>, khoảng <b>8 phút</b> chạy xe.', 'Đại học Kinh tế TP.HCM cách <b>890 m</b>, sinh viên tìm phòng quanh năm.',
        'Bến xe Miền Tây cách <b>1,3 km</b>.', 'Co.opmart Bình Tân <b>560 m</b>, người thuê đi chợ tiện.', 'Big C An Lạc cách <b>1,5 km</b>.'],
      score: 'Bán kính 1 km: <b>14 chợ, siêu thị</b>, hơn 40 trường học và cao đẳng.',
      cta: 'Giá <b>3,2 tỷ</b>. Nhắn tin để xem nhà và hỏi giá thuê khu này.' } };

  if (mode === 'datnen') {
    // Lô mẫu 5×20 m quay mặt 5 m ra hẻm trước nhà (trong app: lô khách vẽ / đọc từ sổ đỏ)
    const f = S.streets.front, sb = Math.atan2((f.b[1] - f.a[1]) * Math.cos(f.a[0] * Math.PI / 180), f.b[0] - f.a[0]) * 180 / Math.PI;
    const lot = { ring: rectM(H, 5, 20, sb + 90), label: 'Lô đất 5 × 20 m', chips: ['100 m²', 'Mặt tiền 5 m', S.legal].filter(Boolean) };
    const center = anchorOf(S, 'center');
    return { ...common, persona: 'Lô đất nền', lot,
      pois: [poiOf(S, 'Chợ Kiến Đức 2'), poiOf(S, 'Trường Mầm Non Mặt Trời Vàng', 'Mầm non Mặt Trời Vàng'), poiOf(S, 'Ủy Ban Nhân Dân Phường An Lạc', 'UBND Phường An Lạc')],
      anchors: center ? [center] : [],
      cta: 'Nhắn tin để xem sổ, hẹn xem đất',
      lines: { ...L,
        intro: 'Lô đất <b>5×20 m</b> ở <b>Phường An Lạc</b>, sổ hồng riêng.',
        lot: 'Diện tích <b>100 m²</b>, mặt tiền <b>5 m</b> quay ra <b>' + f.name + '</b>.',
        poi: ['Chợ Kiến Đức 2 ngay gần, chưa tới <b>1 phút</b>.', 'Trường mầm non cách <b>250 m</b>.', 'UBND Phường An Lạc, làm giấy tờ chỉ <b>2 phút</b>.'],
        anchor: center ? [`Về trung tâm TP.HCM: <b>${num(center.km)} km</b>, khoảng <b>${center.min} phút</b>.`] : [],
        cta: 'Nhắn tin để xem sổ và hẹn xem đất.' } };
  }

  // ketnoi: kết nối khu vực — trung tâm, sân bay, ga + cảnh hạ tầng
  const anchors = [anchorOf(S, 'center'), anchorOf(S, 'airport', 'Sân bay Tân Sơn Nhất'), anchorOf(S, 'station')].filter(Boolean);
  const verb = { center: 'Về', airport: 'Ra', station: 'Ra' };
  return { ...common, persona: 'Kết nối khu vực', anchors,
    lines: { ...L,
      intro: `Từ <b>Phường An Lạc</b> đi đâu cũng gần: trung tâm <b>${anchors[0]?.min} phút</b>, sân bay <b>${anchors[1]?.min} phút</b>.`,
      house: '<b>5×20 m</b>, 1 trệt 2 lầu, <b>3 phòng ngủ</b>, sổ hồng riêng.',
      anchor: anchors.map(a => `${verb[a.type] || 'Tới'} ${a.name}: <b>${num(a.km)} km</b>, khoảng <b>${a.min} phút</b>.`),
      cta: 'Giá <b>3,2 tỷ</b>. Nhắn tin ngay để hẹn xem nhà.' } };
}

// Giọng đọc tạm: file wav đọc sẵn bằng giọng Windows vi-VN (chỉ để thử khớp thời gian) — trong app là giọng Google HD / Vbee
async function withVoice(story) {
  if (!$('#voice').checked) return story;
  const vo = async key => { try { const r = await fetch(`thu3d-voice/${story.mode}-${key}.wav`); if (!r.ok) return null; return await decodeAudioFile(await r.blob()); } catch { return null; } };
  const L = story.lines, v = {};
  for (const key of ['intro', 'house', 'lot', 'airport', 'metro', 'road', 'score', 'cta']) if (L[key]) v[key] = await vo(key);
  v.poi = await Promise.all((L.poi || []).map((_, i) => vo('poi' + i)));
  v.anchor = await Promise.all((L.anchor || []).map((_, i) => vo('anchor' + i)));
  return { ...story, voice: v };
}
// Mọi câu của 4 kiểu (để tạo giọng tạm)
async function allLines() {
  const out = [], keep = $('#infra').checked;
  $('#infra').checked = true;
  for (const m of ['giadinh', 'dautu', 'datnen', 'ketnoi']) {
    for (const [k, v] of Object.entries((await storyOf(m)).lines)) {
      if (Array.isArray(v)) v.forEach((x, i) => out.push([`${m}-${k}${i}`, x])); else out.push([`${m}-${k}`, v]);
    }
  }
  $('#infra').checked = keep;
  return out;
}

// ---- xem trước (giống hệt lúc xuất) ---------------------------------------------------------------------------------
let prev = null, raf = 0, actx = null, music = null, prevSrc = null;
const getMusic = async () => music || (music = await decodeAudioFile(await fetch('music/khoi-dau.m4a').then(r => r.blob())));
const mixFor = dir => getMusic().then(m => mixAudio({ music: m, voiceSegs: dir.voiceSegs, sfx: $('#sfx').checked ? { events: dir.sfx, vol: 0.8 } : null, duration: dir.duration, musicVol: 0.7 }));
async function preview() {
  stopPreview();
  actx = actx || new AudioContext(); actx.resume();   // tạo trong cú bấm (iPhone chặn âm thanh nếu tạo sau)
  $('#log').textContent = 'Đang chuẩn bị…';
  const story = await withVoice(await storyOf($('#mode').value));
  const cv = $('#cv'), ctx = cv.getContext('2d');
  prev = createDirector3D({ width: cv.width, height: cv.height, story });
  await prev.ready;
  const buf = await mixFor(prev);
  $('#log').textContent = '';
  prev.live(ctx);
  const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
  const a0 = actx.currentTime + 0.1; src.start(a0); prevSrc = src;
  const tick = () => {
    if (!prev) return;
    const t = Math.max(0, Math.min(actx.currentTime - a0, prev.duration));
    prev.setFrame(t);
    $('#time').textContent = `${t.toFixed(1)} / ${prev.duration.toFixed(1)} s`;
    if (t < prev.duration) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function stopPreview() { cancelAnimationFrame(raf); try { prevSrc?.stop(); } catch { /* đã dừng */ } prevSrc = null; prev?.destroy(); prev = null; }

// ---- xuất MP4 -------------------------------------------------------------------------------------------------------
async function exportVideo(h, fps = +$('#fps').value) {
  if (!canEncodeMp4()) { $('#log').textContent = 'Trình duyệt này không có WebCodecs (cần Chrome/Safari mới).'; return; }
  stopPreview();
  const w = Math.round(h * 9 / 16 / 2) * 2;
  const log = m => { $('#log').textContent = m; };
  const t0 = performance.now();
  let dir = null;
  try {
    log('Đang chuẩn bị…');
    const story = await withVoice(await storyOf($('#mode').value));
    dir = createDirector3D({ width: w, height: h, story });
    await dir.ready;
    const audio = await mixFor(dir);
    const blob = await exportMp4({
      tl: { duration: dir.duration, LW: w }, width: w, height: h, fps, audioBuffer: audio, source: dir.frameSource(),
      onProgress: (phase, a, b) => {
        const s = ((performance.now() - t0) / 1000).toFixed(0);
        log(phase === 'frames' ? `Đang dựng khung ${a}/${b} (${Math.round(a / b * 100)}%) · ${s} s` : `${phase}… · ${s} s`);
      },
    });
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    const url = URL.createObjectURL(blob);
    const out = $('#out'); out.textContent = '';
    const vid = Object.assign(document.createElement('video'), { src: url, controls: true, playsInline: true }); vid.style.cssText = 'width:100%;border-radius:12px';
    const a = Object.assign(document.createElement('a'), { href: url, download: `ai-dao-dien-${$('#mode').value}-${h}p.mp4`, textContent: `⬇ Tải file ${h}p (${(blob.size / 1048576).toFixed(1)} MB)` });
    out.append(vid, a);
    log(`Xong ${w}×${h} ${fps} hình/giây trong ${sec} s · video ${dir.duration.toFixed(1)} s · ${(blob.size / 1048576).toFixed(1)} MB`);
    window.__lastExport = { sec: +sec, size: blob.size, w, h, blob };
  } catch (e) {
    log('Lỗi: ' + (e && e.message || e));
    window.__lastExport = { error: String(e && e.stack || e) };
  } finally { dir?.destroy(); }
}

$('#play').onclick = preview;
$('#x720').onclick = () => exportVideo(1280);
$('#x1080').onclick = () => exportVideo(1920);
// Kiểm thử: chụp khung ở các thời điểm (giây), trả về Blob PNG
async function snap(mode, times, w = 540) {
  const dir = createDirector3D({ width: w, height: Math.round(w * 16 / 9), story: await withVoice(await storyOf(mode)) });
  await dir.ready;
  const src = dir.frameSource(), out = [];
  for (const t of times) { const p = src.prepare(t); if (p) await p; src.draw(null, t); out.push(await new Promise(r => src.canvas.toBlob(r, 'image/jpeg', 0.85))); }
  const scenes = dir.tl.scenes.map(s => [s.kind, +s.t0.toFixed(1), +s.t1.toFixed(1)]);
  dir.destroy();
  return { out, scenes };
}
window.__thu3d = { preview, exportVideo, storyOf, allLines, snap };
