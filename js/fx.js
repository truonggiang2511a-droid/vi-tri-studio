// Lớp hiệu ứng động theo kịch bản (chế độ "Dựng theo kịch bản", 30/10/2026 — đang thử, chỉ tài khoản admin):
// chữ điểm nhấn + icon động, icon động riêng, biểu đồ giá động, hình tăng trưởng (không số).
// Mọi thứ tính theo thời gian t của khung hình (xem trước = video xuất). Chỗ đặt: trong VÙNG AN TOÀN (né giao diện
// TikTok/Reels: nút cột phải, caption đáy), KHÔNG đè thẻ/ghim/tên đường/phụ đề (OCC của render.js) và không đè nhau —
// nhất là biểu đồ: chữ khác không bao giờ nằm lên biểu đồ. Bị thứ khác che thì tự lướt sang chỗ trống.
import { spring, ease, countUp, keyPop, keyPopBox } from './motion.js';

// Nét icon (Lucide, ISC) nằm ở /fx-icons.json — chỉ tải khi video có hiệu ứng (loadFxIcons), không làm nặng app.js
let FX_ICONS = null, iconsJob = null;
export function loadFxIcons(url = 'fx-icons.json') {
  if (FX_ICONS) return Promise.resolve(true);
  iconsJob ||= fetch(url).then(r => (r.ok ? r.json() : null)).then(j => { if (j?.icons) FX_ICONS = j.icons; return !!FX_ICONS; }).catch(() => { iconsJob = null; return false; });
  return iconsJob;
}
export const fxIconsReady = () => !!FX_ICONS;

const clamp01 = v => Math.max(0, Math.min(1, v));
const HEAD = '"Montserrat", "Be Vietnam Pro", system-ui, sans-serif';
const BODY = '"Be Vietnam Pro", "Segoe UI", system-ui, sans-serif';
// Màu nhấn theo gói chữ động của phong cách (js/motion.js)
const ACC = { denvang: '#E6C27E', khoi: '#FFD400', tapchi: '#D9B26F', hiendai: '#3EE8B5' };
const ACC_INK = { denvang: '#1A1405', khoi: '#101010', tapchi: '#1A1405', hiendai: '#04241B' };
export const FX_DUR = { text: 2.1, icon: 1.9, chart: 4.2, growth: 2.8 };
const ENTERS = ['pop', 'left', 'right', 'drop'];

const pathCache = new Map();
function iconParts(id) {
  if (!FX_ICONS) return [];
  if (!pathCache.has(id)) pathCache.set(id, (FX_ICONS[id] || FX_ICONS.sao || []).map(([d, len]) => ({ p: new Path2D(d), len })));
  return pathCache.get(id);
}

// Icon tròn: nền nảy lò xo + sóng lan + nét icon tự vẽ ra, lơ lửng nhẹ; rút: thu nhỏ + mờ
export function drawIconBadge(ctx, id, x, y, r, lt, dur, key, A0 = 1) {
  const out = clamp01((lt - (dur - 0.3)) / 0.3);
  const A = A0 * clamp01(lt / 0.06) * (1 - out);
  if (A <= 0.01) return;
  const acc = ACC[key] || ACC.denvang, ink = ACC_INK[key] || '#111';
  const sc = spring(lt, { stiffness: 230, damping: 13 }) * (1 - 0.35 * out);
  const bob = Math.sin(lt * 2.6) * r * 0.05 * clamp01((lt - 0.6) / 0.4);
  ctx.save();
  ctx.globalAlpha = A;
  // sóng lan khi vào
  const w = clamp01(lt / 0.75);
  if (w < 1) {
    ctx.strokeStyle = acc; ctx.lineWidth = Math.max(1.2, r * 0.08) * (1 - w);
    ctx.globalAlpha = A * (1 - w) * 0.9;
    ctx.beginPath(); ctx.arc(x, y + bob, r * (1 + 0.9 * ease.out(w)), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = A;
  }
  ctx.translate(x, y + bob); ctx.scale(Math.max(0.001, sc), Math.max(0.001, sc));
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = r * 0.5; ctx.shadowOffsetY = r * 0.12;
  ctx.fillStyle = acc;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2); ctx.stroke();
  // nét icon tự vẽ ra (0,12 → 0,75 s), lần lượt từng nét
  const parts = iconParts(id);
  const s = (r * 1.15) / 24;
  ctx.save();
  ctx.translate(-12 * s, -12 * s); ctx.scale(s, s);
  ctx.strokeStyle = ink; ctx.lineWidth = 2.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const tot = parts.reduce((a, b) => a + b.len, 0) || 1;
  const drawn = tot * ease.inOut(clamp01((lt - 0.12) / 0.63));
  let acc0 = 0;
  for (const pt of parts) {
    const show = Math.max(0, Math.min(pt.len, drawn - acc0));
    acc0 += pt.len;
    if (show <= 0) continue;
    if (show < pt.len) { ctx.setLineDash([show, pt.len + 1]); ctx.lineDashOffset = 0; } else ctx.setLineDash([]);
    ctx.stroke(pt.p);
  }
  ctx.restore();
  ctx.restore();
}

// Kích thước (đơn vị khung logic) để chọn chỗ đặt
export function fxBox(ctx, f, env) {
  const { k, key, maxW } = env;
  if (f.type === 'icon') return { w: 90 * k, h: 90 * k };
  if (f.type === 'chart') return { w: Math.min(maxW, 330 * k), h: 206 * k };
  if (f.type === 'growth') return { w: Math.min(maxW, 290 * k), h: (f.text ? 150 : 118) * k };
  const b = keyPopBox(ctx, key, { k, text: f.text, kicker: f.kicker, kind: f.kind || '' }, maxW - (f.icon ? 70 * k : 0));
  return { w: b.w + (f.icon ? 66 * k : 0), h: Math.max(b.h, f.icon ? 70 * k : 0) };
}

function enterOffset(f, lt, k) {
  const p = ease.back(clamp01(lt / 0.42));
  if (f.enter === 'left') return [-(1 - p) * 90 * k, 0];
  if (f.enter === 'right') return [(1 - p) * 90 * k, 0];
  if (f.enter === 'drop') return [0, -(1 - p) * 60 * k];
  return [0, 0];
}

function card(ctx, x, y, w, h, r, acc, A) {
  ctx.save();
  ctx.globalAlpha = A;
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  ctx.fillStyle = 'rgba(9,13,22,0.82)'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5; ctx.strokeStyle = acc; ctx.globalAlpha = A * 0.85; ctx.stroke();
  ctx.restore();
}

const fmtVal = v => {
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return String(r).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

// Biểu đồ giá động: cột mọc lên lần lượt (số chạy), đường nối đỉnh tự vẽ khi ≥ 3 mốc, nhãn % tăng (tính từ chính số trong kịch bản)
function drawChart(ctx, f, x, y, w, h, lt, dur, key, k) {
  const out = clamp01((lt - (dur - 0.35)) / 0.35);
  const A = clamp01(lt / 0.25) * (1 - out);
  if (A <= 0.01) return;
  const acc = ACC[key] || ACC.denvang;
  const rise = (1 - ease.out(clamp01(lt / 0.4))) * 26 * k;
  ctx.save();
  ctx.translate(0, rise);
  const sc = 1 - 0.06 * out;
  ctx.translate(x + w / 2, y + h / 2); ctx.scale(sc, sc); ctx.translate(-(x + w / 2), -(y + h / 2));
  card(ctx, x, y, w, h, 14 * k, acc, A);
  ctx.globalAlpha = A;
  const pad = 16 * k;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = acc; ctx.font = `800 ${13 * k}px ${BODY}`;
  const title = (f.title || 'Giá').toUpperCase() + (f.unit ? ` · ${f.unit}` : '');
  ctx.fillText(title, x + pad, y + pad + 10 * k, w - pad * 2 - 74 * k);
  const pts = f.points || [];
  const vals = pts.map(p => p.value);
  const vmax = Math.max(...vals, 1e-6), vmin = Math.min(...vals);
  // nhãn % tăng
  // cột thứ i mọc lên đúng lúc giọng đọc nói tới con số đó (f.stag, giây tính từ lúc biểu đồ hiện); không có giọng thì cách 0,32 s
  const bt = i => 0.35 + (f.stag && Number.isFinite(f.stag[i]) ? Math.max(i * 0.25, f.stag[i]) : i * 0.32);
  if (pts.length >= 2 && vals[0] > 0 && vals[vals.length - 1] > vals[0]) {
    const pct = Math.round((vals[vals.length - 1] / vals[0] - 1) * 100);
    const tb = bt(pts.length - 1) + 0.15;
    const ba = clamp01((lt - tb) / 0.3);
    if (ba > 0 && pct > 0) {
      const txt = `▲ +${pct}%`;
      ctx.font = `900 ${14 * k}px ${HEAD}`;
      const tw = ctx.measureText(txt).width + 14 * k;
      const s2 = 0.6 + 0.4 * spring(lt - tb, { stiffness: 260, damping: 14 });
      ctx.save();
      ctx.translate(x + w - pad - tw / 2, y + pad + 5 * k); ctx.scale(s2, s2);
      ctx.globalAlpha = A * ba; ctx.fillStyle = '#2FD27A';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-tw / 2, -12 * k, tw, 22 * k, 11 * k) : ctx.rect(-tw / 2, -12 * k, tw, 22 * k); ctx.fill();
      ctx.fillStyle = '#05210F'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
  }
  // vùng cột
  const top = y + pad + 30 * k, bot = y + h - pad - 20 * k, left = x + pad, right = x + w - pad;
  const n = pts.length, gap = (right - left) / n, bw = Math.min(46 * k, gap * 0.52);
  const base = vmin > 0 && vmin / vmax > 0.6 ? vmin * 0.75 : 0; // các cột gần bằng nhau thì không bắt đầu từ 0 để thấy chênh lệch
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, bot + 0.5); ctx.lineTo(right, bot + 0.5); ctx.stroke();
  const tops = [];
  pts.forEach((p, i) => {
    const t0 = bt(i), g = spring(lt - t0, { stiffness: 140, damping: 16 });
    const cx = left + gap * (i + 0.5);
    const hFull = (bot - top - 26 * k) * ((p.value - base) / Math.max(1e-6, vmax - base));
    const hh = Math.max(0, hFull * Math.min(1.08, g));
    const last = i === n - 1;
    const grd = ctx.createLinearGradient(0, bot - hh, 0, bot);
    grd.addColorStop(0, last ? acc : 'rgba(255,255,255,0.85)'); grd.addColorStop(1, last ? 'rgba(230,194,126,0.35)' : 'rgba(255,255,255,0.25)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - bw / 2, bot - hh, bw, hh, [6 * k, 6 * k, 0, 0]) : ctx.rect(cx - bw / 2, bot - hh, bw, hh); ctx.fill();
    tops.push([cx, bot - hFull]);
    const la = clamp01((lt - t0) / 0.25);
    ctx.globalAlpha = A * la;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `900 ${(last ? 17 : 14) * k}px ${HEAD}`; ctx.fillStyle = last ? acc : '#FFFFFF';
    ctx.fillText(countUp(fmtVal(p.value), clamp01((lt - t0) / 0.7)), cx, bot - hh - 7 * k);
    ctx.font = `600 ${11.5 * k}px ${BODY}`; ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(String(p.label || ''), cx, bot + 15 * k, gap - 4 * k);
    ctx.globalAlpha = A;
  });
  // đường nối đỉnh tự vẽ (≥ 3 mốc)
  if (n >= 3) {
    const lp = clamp01((lt - (bt(n - 1) + 0.2)) / 0.6);
    if (lp > 0) {
      ctx.save();
      ctx.strokeStyle = acc; ctx.lineWidth = 2.4 * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = acc; ctx.shadowBlur = 8;
      let L = 0; for (let i = 1; i < tops.length; i++) L += Math.hypot(tops[i][0] - tops[i - 1][0], tops[i][1] - tops[i - 1][1]);
      ctx.setLineDash([L * lp, L + 1]);
      ctx.beginPath(); tops.forEach(([px, py], i) => (i ? ctx.lineTo(px, py - 22 * k) : ctx.moveTo(px, py - 22 * k))); ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

// Hình tăng trưởng KHÔNG có số (câu nói về tăng trưởng mà không có số liệu): 3 cột trừu tượng + mũi tên đi lên, chữ lấy từ câu
function drawGrowth(ctx, f, x, y, w, h, lt, dur, key, k) {
  const out = clamp01((lt - (dur - 0.3)) / 0.3);
  const A = clamp01(lt / 0.2) * (1 - out);
  if (A <= 0.01) return;
  const acc = ACC[key] || ACC.denvang;
  const sc = (0.7 + 0.3 * spring(lt, { stiffness: 220, damping: 15 })) * (1 - 0.1 * out);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2); ctx.scale(sc, sc); ctx.translate(-(x + w / 2), -(y + h / 2));
  card(ctx, x, y, w, h, 14 * k, acc, A);
  ctx.globalAlpha = A;
  const gx = x + w / 2 - 70 * k, gy = y + 92 * k;
  [0.35, 0.6, 0.95].forEach((v, i) => {
    const g = spring(lt - 0.15 - i * 0.14, { stiffness: 170, damping: 15 });
    const bh = 64 * k * v * Math.min(1.06, g);
    ctx.fillStyle = i === 2 ? acc : 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(gx + i * 50 * k, gy - bh, 34 * k, bh, [5 * k, 5 * k, 0, 0]) : ctx.rect(gx + i * 50 * k, gy - bh, 34 * k, bh); ctx.fill();
  });
  // mũi tên chéo đi lên tự vẽ
  const ap = ease.inOut(clamp01((lt - 0.45) / 0.55));
  if (ap > 0) {
    const ax0 = gx - 6 * k, ay0 = gy - 18 * k, ax1 = gx + 150 * k, ay1 = gy - 82 * k;
    const ex = ax0 + (ax1 - ax0) * ap, ey = ay0 + (ay1 - ay0) * ap;
    ctx.strokeStyle = '#2FD27A'; ctx.lineWidth = 4.5 * k; ctx.lineCap = 'round';
    ctx.shadowColor = '#2FD27A'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(ex, ey); ctx.stroke();
    const ang = Math.atan2(ay1 - ay0, ax1 - ax0);
    ctx.fillStyle = '#2FD27A';
    ctx.beginPath(); ctx.moveTo(ex + Math.cos(ang) * 10 * k, ey + Math.sin(ang) * 10 * k);
    ctx.lineTo(ex + Math.cos(ang + 2.5) * 13 * k, ey + Math.sin(ang + 2.5) * 13 * k);
    ctx.lineTo(ex + Math.cos(ang - 2.5) * 13 * k, ey + Math.sin(ang - 2.5) * 13 * k); ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  if (f.text) {
    const ta = clamp01((lt - 0.55) / 0.3);
    ctx.globalAlpha = A * ta;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = `900 ${20 * k}px ${HEAD}`; ctx.fillStyle = '#FFFFFF';
    ctx.fillText(f.text.toUpperCase(), x + w / 2, y + h - 22 * k, w - 24 * k);
  }
  ctx.restore();
}

// Vẽ 1 hiệu ứng tại khung chữ nhật đã chọn (x, y = góc trên trái)
function drawOne(ctx, f, box, lt, env) {
  const { k, key, maxW } = env;
  const [ox, oy] = f.type === 'chart' || f.type === 'growth' ? [0, 0] : enterOffset(f, lt, k);
  const x = box.x + ox, y = box.y + oy;
  if (f.type === 'chart') return drawChart(ctx, f, x, y, box.w, box.h, lt, f.dur, key, k);
  if (f.type === 'growth') return drawGrowth(ctx, f, x, y, box.w, box.h, lt, f.dur, key, k);
  if (f.type === 'icon') return drawIconBadge(ctx, f.icon, x + box.w / 2, y + box.h / 2, 36 * k, lt, f.dur, key);
  // chữ điểm nhấn (gói chữ của phong cách) + icon tròn bên trái
  const iw = f.icon ? 66 * k : 0;
  if (f.icon) drawIconBadge(ctx, f.icon, x + 30 * k, y + box.h / 2, 26 * k, lt + 0.08, f.dur + 0.08, key);
  keyPop(ctx, key, { x: x + iw + (box.w - iw) / 2, y: y + box.h / 2, lt: Math.max(0, lt - 0.06), dur: f.dur - 0.06, A: 1, k, text: f.text, kicker: f.kicker || '', kind: f.kind || '' }, maxW - iw);
}

// Vùng được phép đặt hiệu ứng (khung logic), tránh mép + giao diện mạng xã hội
export function fxZone(tl) {
  const { LW, LH, safe, fmt } = tl;
  const right = fmt === 'v' ? 64 : fmt === 's' ? 30 : 40; // cột nút thả tim/bình luận của TikTok/Reels bên phải
  return { x0: safe.x + 8, x1: LW - Math.max(safe.x + 8, right), y0: safe.top + 56, y1: LH - safe.bottom - 12 };
}
const XS = [0.5, 0.28, 0.72];
const YS = [0.22, 0.36, 0.1, 0.5, 0.64, 0.78];

// Gọi trong render() SAU khi mọi thẻ/ghim/chữ đã ghi chỗ chiếm vào OCC (toạ độ điểm ảnh thật)
export function drawFx(ctx, tl, t, OCC) {
  const list = tl.fx;
  if (!list || !list.length) return;
  const key = tl.scene.motion || 'denvang';
  const k = (Math.min(tl.LW, tl.LH) / 540) * (tl.fmt === 'v' ? 1 : 0.82);
  const Z = fxZone(tl);
  const maxW = Z.x1 - Z.x0;
  const env = { k, key, maxW };
  const m = ctx.getTransform();
  const toDev = b => ({ x0: m.a * b.x + m.e, y0: m.d * b.y + m.f, x1: m.a * (b.x + b.w) + m.e, y1: m.d * (b.y + b.h) + m.f });
  const over = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  tl._fxPos ||= new Map();
  const live = list.filter(f => t >= f.t && t <= f.t + f.dur);
  // biểu đồ đặt trước (ưu tiên chỗ trống nhất), các hiệu ứng khác né biểu đồ
  live.sort((a, b) => (b.type === 'chart') - (a.type === 'chart') || a.t - b.t);
  const placed = [];
  for (const f of live) {
    const lt = t - f.t;
    const sz = fxBox(ctx, f, env);
    const cands = [];
    for (let yi = 0; yi < YS.length; yi++) for (let xi = 0; xi < XS.length; xi++) {
      const cx = Z.x0 + (Z.x1 - Z.x0) * XS[xi], cy = Z.y0 + (Z.y1 - Z.y0) * YS[yi];
      const x = Math.max(Z.x0, Math.min(Z.x1 - sz.w, cx - sz.w / 2)), y = Math.max(Z.y0, Math.min(Z.y1 - sz.h, cy - sz.h / 2));
      cands.push({ x, y, w: sz.w, h: sz.h, pen: (yi * 3 + xi) * 0.004 });
    }
    // điểm phạt = phần bị che của TỪNG thứ đang hiện (che hết một nhãn nhỏ = 1, như che 1 thẻ lớn) — chữ nhỏ cũng không bị đè
    const score = c => {
      const d = toDev(c);
      let s = 0;
      for (const o of OCC || []) { const ov = over(d, o); if (ov > 0) s += Math.min(1, ov / Math.max(1, (o.x1 - o.x0) * (o.y1 - o.y0))); }
      for (const p of placed) { const q = toDev(p), ov = over(d, q); if (ov > 0) s += Math.min(1, ov / Math.max(1, (q.x1 - q.x0) * (q.y1 - q.y0))) * (p.chart || f.type === 'chart' ? 40 : 6); }
      return s;
    };
    let st = tl._fxPos.get(f.id);
    if (!st || lt < 0.04 || t < st.tm - 0.001) {
      // hiệu ứng trước vừa đứng ở đâu thì hiệu ứng này tránh chỗ đó (đổi vị trí liên tục, mắt người xem phải dõi theo)
      const prev = tl._fxLast && tl._fxLast.id !== f.id ? tl._fxLast : null;
      let best = null;
      for (const c of cands) {
        const near = prev && Math.hypot(c.x - prev.x, c.y - prev.y) < 40 * k ? 0.15 : 0;
        const sc = score(c) + c.pen + near;
        if (!best || sc < best.sc) best = { ...c, sc };
      }
      st = { x: best.x, y: best.y, fx: best.x, fy: best.y, tm: t };
      tl._fxPos.set(f.id, st);
      tl._fxLast = { id: f.id, x: best.x, y: best.y };
    } else if (lt > 0.5 && t - st.tm > (f.type === 'chart' ? 0.9 : 0.6)) {
      // máy lia làm thẻ/ghim/chữ khác chạy vào chỗ đang đứng → lướt êm sang chỗ trống hơn (biểu đồ cũng vậy: không gì nằm dưới nó)
      const cur = { x: st.x, y: st.y, w: sz.w, h: sz.h };
      const now = score(cur);
      if (now > 0.3) {
        let best = null;
        for (const c of cands) { const sc = score(c) + c.pen; if (!best || sc < best.sc) best = { ...c, sc }; }
        if (best.sc < now - 0.25) { st.fx = st.x; st.fy = st.y; st.x = best.x; st.y = best.y; st.tm = t; }
      }
    }
    const g = ease.inOut(clamp01((t - st.tm) / 0.35));
    const box = { x: st.fx + (st.x - st.fx) * g, y: st.fy + (st.y - st.fy) * g, w: sz.w, h: sz.h };
    placed.push({ ...box, chart: f.type === 'chart' });
    drawOne(ctx, f, box, lt, env);
  }
}

// Chuẩn bị danh sách hiệu ứng cho timeline: thời điểm tuyệt đối, thời lượng, kiểu vào; giãn cách để không dồn dập
export function buildFx(phases, items, voice, notBefore = 0) {
  const byKey = new Map(phases.filter(p => p.vkey).map(p => [p.vkey, p]));
  const raw = [];
  for (const it of items || []) {
    const ph = byKey.get(it.vkey);
    if (!ph || ph.type === 'clip' || ph.type === 'photos' || ph.type === 'front') continue;
    const vd = voice && voice[it.vkey];
    const lead = ph.type === 'intro' ? 0.5 : 0.3;
    const t = vd && Number.isFinite(it.at) ? ph.t0 + lead + Math.max(0, Math.min(vd, it.at)) - 0.15
      : ph.t0 + (ph.t1 - ph.t0) * Math.max(0.08, Math.min(0.8, it.frac ?? 0.4));
    raw.push({ ...it, t: Math.max(ph.t0 + 0.15, t), ph });
  }
  raw.sort((a, b) => a.t - b.t);
  const out = [];
  let lastT = -9, lastChartEnd = -9;
  for (const f of raw) {
    if (f.t < notBefore) f.t = notBefore;
    if (f.t > f.ph.t1 + 0.6) continue;
    const isChart = f.type === 'chart';
    if (!isChart && f.t - lastT < 1.3) continue;           // không dồn dập: cách nhau ≥ 1,3 s
    if (isChart && f.t < lastChartEnd + 0.3) continue;     // một biểu đồ một lúc
    const lastStag = isChart && Array.isArray(f.stag) && f.stag.length ? Math.max(...f.stag.filter(Number.isFinite), 0) : 0;
    // biểu đồ: giữ tới hết câu (≥ 1,6 s sau cột cuối) nhưng không lấn quá 0,3 s sang cảnh sau
    const dur = isChart ? Math.max(lastStag + 1.9, Math.min(Math.max(FX_DUR.chart, lastStag + 2.6), f.ph.t1 + 0.3 - f.t)) : FX_DUR[f.type] || 2;
    const o = { id: out.length, t: f.t, dur, type: f.type, stag: isChart && Array.isArray(f.stag) ? f.stag : null, text: f.text || '', kicker: f.kicker || '', icon: f.icon || '', kind: f.kind || '',
      points: f.points || null, unit: f.unit || '', title: f.title || '', enter: ENTERS[out.length % ENTERS.length] };
    out.push(o);
    lastT = f.t;
    if (isChart) lastChartEnd = f.t + dur;
  }
  return out;
}
