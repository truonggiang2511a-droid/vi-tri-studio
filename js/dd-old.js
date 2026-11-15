// AI đạo diễn — vòng 9 (15/11, Giang): "app cũ vẽ tiện ích quanh nhà, đường lớn kiểu sao thì bê y nguyên; chỉ khác zoom từ trái đất →
// tỉnh → xã → xuống căn nhà quay 360° cận cảnh". Nên:
//  · PHẦN MỞ ĐẦU vẽ 3D bằng MapLibre (dd3d.js, story.opening): quả địa cầu → trọn tỉnh → xã → bay xuống ghim → lượn trọn 360° sát nhà.
//    Chữ / thẻ trên đó là của app cũ (render.js drawOpening): thẻ giá mở đầu, tiêu đề, ghim + nhãn "VỊ TRÍ …", thẻ thông tin, phụ đề.
//  · TỪ CẢNH BÁN KÍNH TRỞ ĐI vẽ bằng CHÍNH bộ vẽ của app cũ (render.js buildTimeline + render) với dữ liệu Agent đã chọn: vòng bán kính,
//    kết nối vùng (máy bay cất cánh / tàu metro), hạ tầng đang thi công, từng trục đường lớn (line ★ + chữ 3D tên đường), bay tới từng
//    tiện ích (đường đi + thẻ), khoanh vùng quan trọng, bảng tổng kết, cảnh kết, ảnh thực tế, phụ đề — y như video app cũ.
//  · Chỗ nối: 1,9 s cuối vòng lượn máy 3D về đúng tư thế máy quay app cũ ở đầu cảnh bán kính (camPose: tâm, zoom, nghiêng, hướng Bắc),
//    giữ yên XF giây và hoà hình sang khung app cũ (hai khung gần như trùng nhau).
// App cũ (app.js) không gọi file này; render.js chỉ thêm 2 hàm đọc (camPose, drawOpening).
import { buildTimeline, render, TileCache, camPose, drawOpening, buildCaptions, FORMATS } from './render.js';
import { tileFeeder } from './export.js';
import { sfxEvents } from './sfx.js';
import { createDirector3D, sfxEvents3D, drawStats } from './dd3d.js';
import { localFrame, stitchWays, bridgeWays } from './data.js';

const FMT = 'v', LW = FORMATS[FMT].LW;
const XF = 0.45;      // giây hoà hình ở chỗ nối (= HOLD cuối vòng lượn trong dd3d.js)
const GAP = 0.18;     // nghỉ giữa các câu đọc liền nhau trong cùng một cảnh app cũ (kết nối vùng có nhiều điểm mốc)
const PHONE_GRADE = 'contrast(1.07) saturate(1.14) brightness(1.01)';   // như bản xuất app cũ (export.js)
const LABEL = { nhapho: 'VỊ TRÍ CĂN NHÀ', bietthu: 'VỊ TRÍ BIỆT THỰ', nhavuon: 'VỊ TRÍ NHÀ VƯỜN', canho: 'VỊ TRÍ CĂN HỘ', datnen: 'VỊ TRÍ LÔ ĐẤT' };
const plain = h => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const est = h => { const n = plain(h).split(' ').filter(Boolean).length; return n ? n / 3.1 : 0; };   // ≈ 3,1 chữ/giây (như dd3d)
const fmtN = v => String(Math.round(v * 10) / 10).replace('.', ',');

// Cảnh app cũ dựng từ dữ liệu Agent (giống buildScene của app.js với lựa chọn mặc định của khách mới: Vàng neon, ảnh vệ tinh rõ nét,
// bay tới từng tiện ích, nhịp Nhanh, 2 trục ★ gần nhà, không mẫu 1, không khoanh tỉnh kiểu cũ — phần đó đã có ở mở đầu 3D)
export function oldScene(src, story) {
  const H = src.house, L = src.listing || {}, kind = story.kind || 'nhapho';
  const byPoi = new Map((src.pois || []).map(p => [p.id, p]));
  const pois = story.pois.map(p => byPoi.get(p.id)).filter(Boolean)
    .map(p => ({ ...p, route: src.routes?.[p.id] || null, star: false })).sort((a, b) => a.km - b.km);
  const F = localFrame(H), byRoad = new Map((src.roads || []).map(r => [r.id, r]));
  const rs = story.roads.map(r => byRoad.get(r.id)).filter(Boolean);
  // ★ như app cũ (autoHiRoads): 2 trục gần nhà, ưu tiên quốc lộ / cao tốc, ≤ 2,5 km
  const rank = r => (r.level >= 2 ? 0 : r.level === 1 ? 1.5 : 3) + r.nearKm;
  const hi = rs.filter(r => !r.far && r.nearKm <= 2.5).sort((a, b) => rank(a) - rank(b)).slice(0, 2).map(r => r.id);
  const roads = rs.map(r => {
    let ways = r.ways;
    try { if (ways?.length > 1) ways = bridgeWays(stitchWays(ways, F, r.level >= 3 ? 3 : 0.6), F, r.level >= 3 ? 4 : 1.5); } catch { ways = r.ways; }
    return { ...r, ways, hi: hi.includes(r.id) };
  });
  const anchors = (story.anchors || []).map(a => (src.anchors || []).find(x => x.id === a.id)).filter(Boolean);
  const infra = (story.build || []).map(b => (src.build || []).find(x => x.id === b.id)).filter(Boolean);
  const ad = src.admin || {};
  const sub = [ad.commune || src.ward || '', ad.provinceShort || ''].filter(Boolean).join(' · ');
  return {
    keyLook: '', motion: 'denvang', motionHookOnly: true,
    house: { lat: H.lat, lng: H.lng }, label: LABEL[kind] || LABEL.nhapho, rent: false, sub,
    title: 'Vị trí & tiện ích', brand: src.brand || '', phone: '', logo: null, logoBg: null, avatar: null, avatarCut: false, wm: '',
    photos: (story.photos || []).filter(Boolean), photoLabels: (story.photos || []).map(() => ''), clips: [],
    info: { price: L.price || '', area: L.dims || (L.area ? `${fmtN(L.area)} m²` : ''), thoCu: kind === 'canho' ? '' : L.thoCu || '',
      beds: kind === 'datnen' ? '' : L.beds ? String(L.beds) : '', legal: L.legal || '', floors: kind === 'datnen' ? '' : L.floors || '', roadWidth: '' },
    radiusKm: story.oldR || 2, speed: 'nhanh',
    pois, roads, iso: null, region: anchors.length || infra.length ? { anchors, infra } : null,
    zones: (src.zones || []).filter(z => pois.some(p => p.id === z.poiId)), water: null, boundary: null,
    provinceShort: ad.provinceShort || '', commune: ad.commune || src.ward || '', titleSub: sub,
    style: 'vangneon', base: 'vetinh', flow: 'lanluot', lot: null, lotLabel: { text: '', area: '' }, plan: null,
    streets: src.streets || null, adminArea: null, roadWidth: '', showStreets: true, sweep: false, noSummary: false,
    roadTheme: 'auto', hiTheme: 'vang', lotStyle: 'phatsang', lotColor: 'auto', lotDims: 'off', routeTheme: 'vang', roadLabelFace: 'line',
  };
}

// Lời từng cảnh app cũ (khoá vkey của render.js) ← lời Agent / khách sửa. Một cảnh có thể đọc nhiều câu liền (kết nối vùng).
function oldTexts(story, scene) {
  const Ln = story.lines, out = {};
  const put = (k, arr) => { arr = arr.filter(x => plain(x)); if (arr.length) out[k] = arr; };
  put('overview', [Ln.overview]);
  if (scene.region?.anchors?.length) put('region', scene.region.anchors.map(a => Ln.anchor[story.anchors.findIndex(x => x.id === a.id)]));
  if (scene.region?.infra?.length) put('infra', [Ln.build]);
  story.roads.forEach((r, j) => put('road:' + r.id, [Ln.rd?.[j]]));
  story.pois.forEach((p, i) => put('poi:' + p.id, [Ln.poi[i]]));
  put('summary', [Ln.summary]);
  put('outro', [Ln.cta]);
  if (scene.photos.length) put('photos', [Ln.photos]);
  return out;
}

// Đạo diễn ghép: cùng giao diện với createDirector3D (ready, duration, voiceSegs, sfx, setFrame, live, prepare, draw, frameSource, destroy)
// src = dữ liệu quét thật (house, pois, routes, roads, streets, admin, anchors có fx, build, zones, listing, brand)
// voiceOf(text) → AudioBuffer đã đọc (hoặc null: nhịp ước theo số chữ, như dd3d paceByText)
export function createHybrid({ width, height, story, src, voiceOf }) {
  const sc = width / LW;
  const scene = oldScene(src, story);
  const texts = oldTexts(story, scene);
  const durOf = h => voiceOf(h)?.duration || est(h);
  const vd = {}, caps = {};
  for (const [k, arr] of Object.entries(texts)) { vd[k] = arr.reduce((s, h) => s + durOf(h), 0) + GAP * (arr.length - 1); caps[k] = arr.map(plain).join(' '); }
  const old = buildTimeline(scene, FMT, { voice: vd, captions: caps });
  const ov = old.overview, T0 = ov.t0;
  // tư thế máy app cũ ở đầu cảnh bán kính → tư thế MapLibre (thang 512 px, khung thật width px; tâm ngắm ở hàng fy nhờ padding trên)
  const P = camPose(old, T0);
  const seam = { c: [P.lng, P.lat], z: P.zoom - 1 + Math.log2(sc), p: P.pitch, b: 0, pad: Math.max(0, 2 * (P.fy * height - height / 2)) };
  const ddStory = { ...story, cover: null, zones: [], opening: { seam } };
  const dd = createDirector3D({ width, height, story: ddStory, overlay: (ctx, t, api) => overlay(ctx, t, api) });
  const A = dd.duration;
  const toOld = t => T0 + (t - A);
  const duration = A + old.duration - T0;

  // giọng: phần mở đầu (dd3d) + từng cảnh app cũ (đầu cảnh + 0,3 s như app cũ; nhiều câu thì nối nhau cách GAP)
  const voiceSegs = [...dd.voiceSegs];
  for (const ph of old.phases) {
    const arr = ph.vkey && texts[ph.vkey];
    if (!arr || ph.t0 < T0 - 1e-6) continue;
    let at = A + (ph.t0 - T0) + 0.3;
    for (const h of arr) { const b = voiceOf(h); if (b) voiceSegs.push({ t: at, buffer: b }); at += durOf(h) + GAP; }
  }
  const sfx = [...sfxEvents3D(dd.tl), ...sfxEvents(old).filter(e => e.t >= T0 - 0.05).map(e => ({ ...e, t: e.t - T0 + A }))]
    .filter(e => e.t >= 0 && e.t < duration);

  // phụ đề phần mở đầu theo đúng kiểu app cũ (cụm ngắn, nền thẻ của phong cách), giờ theo giọng của dd3d
  const ddSc = dd.tl.scenes, hs = ddSc.find(s => s.kind === 'house' || s.kind === 'lot');
  const fake = ddSc.filter(s => s.kind === 'intro' || s === hs).map(s => {
    const start = s.vo ? s.vo.t : s.t0 + 0.7;
    return { type: s.kind === 'intro' ? 'intro' : 'house', vkey: s.kind === 'intro' ? 'intro' : 'house', t0: start - (s.kind === 'intro' ? 0.5 : 0.3) };
  });
  const Lo = story.lines, hl = story.lot ? Lo.lot : Lo.house;
  const openCaps = buildCaptions(fake, { intro: plain(Lo.intro), house: plain(hl) }, { intro: durOf(Lo.intro), house: durOf(hl) }, FMT);

  const cache = new TileCache(() => { dirty = true; kick(); });
  let liveCtx = null, lastT = 0, dirty = false, exporting = false, raf = 0;
  const oc = document.createElement('canvas'); oc.width = width; oc.height = height;
  const octx = oc.getContext('2d');
  // đoạn kết (vòng 9, Giang): thẻ 3 con số lớn (số chạy) ở trên cùng suốt cảnh tổng kết, bảng tiện ích app cũ vẫn ở dưới
  const sm = old.summary, ou = old.outro, S3 = story.stats || [];
  const drawOld = (ctx, t, request) => {
    const to = Math.max(old.house.t0, toOld(t));
    render(ctx, old, to, { cache, scale: sc, request });
    if (sm && S3.length >= 2 && to > sm.t0 + 0.5 && to < ou.t0 + 0.5) {
      const a = Math.min(1, (to - sm.t0 - 0.5) / 0.4, (ou.t0 + 0.5 - to) / 0.4);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); drawStats(ctx, S3, a, to - sm.t0 - 0.5, width, height); ctx.restore();
    }
  };
  function overlay(ctx, t, api) {
    const [hx, hy] = api.proj([src.house.lng, src.house.lat]);
    const pin = t > api.pinT - 2.4 ? { x: hx / sc, y: hy / sc, s: 1, dropT: (t - (api.pinT - 0.35)) / 0.75 } : null;
    const tStart = old.hookEnd ? old.hookEnd - 0.2 : 0.3;
    const titleA = Math.max(0, Math.min(1, (t - tStart) / 0.6, (A + 0.5 - t) / 0.6));
    const labelA = hs ? Math.max(0, Math.min(1, (t - hs.t0 - 0.5) / 0.45)) : 0;
    const infoA = hs ? Math.max(0, Math.min(1, (t - hs.t0 - 0.6) / 0.45, (A + 0.3 - t) / 0.4)) : 0;
    drawOpening(ctx, old, t, { scale: sc, pin, labelA, infoA, titleA, caps: openCaps });
    // hoà hình sang khung app cũ (máy 3D đã đứng đúng tư thế app cũ)
    const w = (t - (A - XF)) / XF;
    if (w > 0) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      drawOld(octx, t, !exporting);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(1, w); ctx.drawImage(oc, 0, 0); ctx.restore();
    }
  }
  // xem trước: phần mở đầu vẽ theo nhịp bản đồ 3D (dd3d live), phần app cũ vẽ ngay; ô ảnh app cũ tải xong thì vẽ lại khung đang đứng
  function kick() {
    if (raf || !liveCtx) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!dirty || !liveCtx) return;
      dirty = false;
      if (lastT >= A) drawOld(liveCtx, lastT, true);
      else if (lastT > A - XF) dd.map.triggerRepaint();
    });
  }
  // qua chỗ nối thì tháo lớp vẽ theo nhịp bản đồ 3D (bản đồ còn tự vẽ lại khi ô ảnh về muộn → sẽ đè khung app cũ)
  let ddLive = false;
  function setFrame(t) {
    lastT = t;
    if (t < A) { if (!ddLive && liveCtx) { dd.live(liveCtx); ddLive = true; } dd.setFrame(t); }
    else { if (ddLive) { dd.live(null); ddLive = false; } if (liveCtx) drawOld(liveCtx, t, true); }
  }
  const live = ctx => { liveCtx = ctx; dd.live(ctx); ddLive = !!ctx; };
  // xuất: tải ô ảnh app cũ đúng lúc (tileFeeder, từ chỗ nối), mở đầu chờ bản đồ 3D vẽ xong khung
  function frameSource() {
    liveCtx = null; exporting = true;
    const fs = dd.frameSource(), feeder = tileFeeder(old, sc, cache, Math.max(0, T0 - XF - 0.1));
    cache.bitmap = true;
    const out = document.createElement('canvas'); out.width = width; out.height = height;
    const ctx = out.getContext('2d', { alpha: false });
    const raw = document.createElement('canvas'); raw.width = width; raw.height = height;
    const rctx = raw.getContext('2d', { alpha: false });
    let grade = false;
    try { ctx.filter = PHONE_GRADE; grade = ctx.filter === PHONE_GRADE; ctx.filter = 'none'; } catch { grade = false; }
    return {
      canvas: out,
      prepare(t) {
        const w = [];
        if (t < A) { const p = fs.prepare(t); if (p) w.push(p); }
        if (t >= A - XF - 0.05) { const p = feeder.before(toOld(t)); if (p) w.push(p); }
        return w.length ? Promise.all(w) : null;
      },
      draw(_tl, t) {
        if (t < A) fs.draw(null, t); else drawOld(rctx, t, false);
        const srcCv = t < A ? fs.canvas : raw;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (grade) ctx.filter = PHONE_GRADE;
        ctx.drawImage(srcCv, 0, 0);
        if (grade) ctx.filter = 'none';
      },
    };
  }
  // ảnh bìa / khung lẻ: prepare(t) + draw(ctx, t)
  const prepare = t => {
    if (t < A) return dd.prepare(t);
    return null;
  };
  const draw = (ctx, t) => { if (t < A) dd.draw(ctx, t); else drawOld(ctx, t, false); };
  function destroy() { liveCtx = null; cancelAnimationFrame(raf); dd.destroy(); }
  return { engine: 'old', tl: { A, T0, old, dd: dd.tl }, duration, voiceSegs, sfx, ready: dd.ready, setFrame, live, prepare, draw, frameSource, destroy, map: dd.map,
    debug: () => ({ ...(dd.debug() || {}), A, T0, seam, phases: old.phases.map(p => ({ type: p.type, vkey: p.vkey, t0: +(p.t0 - T0 + A).toFixed(2), t1: +(p.t1 - T0 + A).toFixed(2) })) }) };
}
