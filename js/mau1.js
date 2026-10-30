// Chữ điểm nhấn + icon "mẫu 1" (30/10/2026, Giang: lấy mẫu chữ và icon của skill batdongsan-editor / Hook Kit đưa lên video map
// lúc giọng đọc nói giá, khoảng cách, phút, diện tích, pháp lý). Đang thử: CHỈ tài khoản admin bật (ô #mau1On), khách thường không đổi.
// Dùng lại đúng đường đi của "từ khoá bật lên" (findKeywords → buildKeyPops → OCC né thẻ/ghim/chữ), chỉ thay phần hình:
//   cụm chữ 3 tầng như Hook Kit (kit/hook_type.py "mau1" / "mau1_3d"): dòng dẫn nhỏ trắng canh trái · từ khoá RẤT TO · chữ ký tay
//   canh phải đè lên đáy từ khoá; MỘT font Montserrat (Giang chốt 30/10), chữ PHẲNG bóng đổ vừa (không khối 3D, không vệt sáng,
//   không quầng), mỗi phong cách video MỘT màu nhấn (M1_ACCENT); giá số chạy.
//   icon tròn chuyển sắc (kit/hook_mg.py Icon + disc_sprite): nảy vào, vòng lan, tia lấp lánh, vòng sáng quay, lơ lửng — bộ 63 icon y hệt.
import { spring, ease, countUp } from './motion.js';
import { MAU1_ICONS } from './mau1-icons.js';

const clamp01 = v => Math.max(0, Math.min(1, v));
const F_3D = '"Montserrat", "Be Vietnam Pro", sans-serif';
const F_THIN = '"Be Vietnam Pro", "Segoe UI", system-ui, sans-serif';
const F_SIGN = '"Dancing Script", "Be Vietnam Pro", cursive';
// Bảng màu y Hook Kit (mặt chữ: trên → dưới)
const PAL_ANTON = { cam: ['#FFF7F0', '#FF5A36'], tim: ['#F3E6FF', '#9338FF'], vang: ['#FFF8C2', '#FFC414'], do: ['#FF7466', '#C90F0B'],
  xanh: ['#EAF4FF', '#1E88FF'], la: ['#EFFFF2', '#22C55E'], hong: ['#FFF0F7', '#FF4FA3'] };
const PAL_3D = { tim: ['#E9D6FF', '#8A2BEA'], vang: ['#FFF6B0', '#F0A800'], cam: ['#FFE9DC', '#FF5A2A'], do: ['#FF8A7A', '#C90F0B'],
  xanh: ['#D6ECFF', '#1F6FEB'], la: ['#DCFCE7', '#16A34A'], hong: ['#FFE0F0', '#EC4899'] };
// 30/10 Giang: mỗi phong cách MỘT màu nhấn cho từ khoá + icon (khoá = scene.style). Mặt chữ: trên → dưới (chuyển nhẹ)
//   Neon đêm = xanh neon · Sang trọng = vàng kim · Trẻ trung = hồng · Tối giản = đỏ
// 30/10 11:30 Giang: kiểu vàng kim là MẶC ĐỊNH (Neon đêm = phong cách mặc định), Sang trọng = vàng tươi bóng đậm vừa
// 30/10 12:10 Giang: Neon = VÀNG GOLD KIM đậm (3 điểm màu: sáng trên → vàng kim giữa → vàng đồng đáy), bóng đậm vừa
export const M1_ACCENT = { neon: ['#FFF1BE', '#F0BC45', '#A8700F'], sangtrong: ['#FFF4A0', '#FFC800'], tretrung: ['#FFD6EA', '#FF4FA3'], toigian: ['#FF9C8F', '#EF3B2D'] };
const M1_BADGE = { neon: ['#FBE29A', '#B07818'], sangtrong: ['#FFE680', '#E0A800'], tretrung: ['#FFC6E2', '#EC4899'], toigian: ['#FF9C8F', '#D92D20'] };
// Huy hiệu icon cùng màu với cụm chữ (mau1.md: xanh/lá/hồng + màu gốc cam)
const BADGE = { ...M1_BADGE, cam: ['#FFB38F', '#FF5A36'], xanh: ['#BFE0FF', '#1E88FF'], la: ['#BBF7D0', '#16A34A'], hong: ['#FFC6E2', '#EC4899'],
  vang: ['#FFF3A6', '#F2A900'], tim: ['#E3C6FF', '#9338FF'], do: ['#FF8A7A', '#C90F0B'] };

// Phông Dancing Script (chữ ký tay) chỉ tải khi bật mẫu 1 (không làm chậm app của khách)
let fontJob = null;
export function loadMau1Fonts() {
  if (fontJob) return fontJob;
  fontJob = (async () => {
    try {
      if (!document.getElementById('mau1Fonts')) {
        const l = document.createElement('link');
        l.id = 'mau1Fonts'; l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap';
        document.head.appendChild(l);
        await new Promise(r => { l.onload = r; l.onerror = r; setTimeout(r, 4000); });
      }
      await Promise.race([Promise.all([
        document.fonts.load('600 30px "Dancing Script"', 'Phường An Lạc ạ'),
        document.fonts.load('900 60px "Montserrat"', '500 M Ồ'),
        document.fonts.load('500 20px "Be Vietnam Pro"', 'Chỉ cách ạ'),
      ]), new Promise(r => setTimeout(r, 4000))]);
    } catch { /* dùng phông dự phòng */ }
    return true;
  })();
  return fontJob;
}

// ---------- icon (lưới 100×100, nét trắng) ----------
function iconStrokes(ctx, name, size) {
  const ops = MAU1_ICONS[name] || MAU1_ICONS.pin;
  const s = size / 100;
  ctx.save();
  ctx.translate(-size / 2, -size / 2);
  ctx.scale(s, s);
  ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#FFFFFF'; ctx.fillStyle = '#FFFFFF';
  for (const [k, v] of ops) {
    ctx.beginPath();
    if (k === 'L') { ctx.moveTo(v[0], v[1]); for (let i = 2; i < v.length; i += 2) ctx.lineTo(v[i], v[i + 1]); if (v.length === 4 && v[0] === v[2] && v[1] === v[3]) ctx.lineTo(v[0] + 0.01, v[1]); ctx.stroke(); }
    else if (k === 'A') { const [x0, y0, x1, y1, a0, a1] = v; ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, a0 * Math.PI / 180, a1 * Math.PI / 180); ctx.stroke(); }
    else if (k === 'R') { const [x0, y0, x1, y1, r] = v; if (ctx.roundRect) ctx.roundRect(x0, y0, x1 - x0, y1 - y0, r); else ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.stroke(); }
    else if (k === 'C') { ctx.arc(v[0], v[1], v[2], 0, Math.PI * 2); if (v[3]) ctx.fill(); else ctx.stroke(); }
  }
  ctx.restore();
}
// Huy hiệu tròn (kit/hook_mg.py class Icon): nảy vào (out_back 0,34 s), vòng lan 0,08–0,75 s, 5 tia lấp lánh, vòng sáng quay 120°/s, lơ lửng
export function drawBadge(ctx, name, cx, cy, r, lt, dur, colKey, A0 = 1) {
  const out = 1 - clamp01((lt - (dur - 0.28)) / 0.28);
  const A = A0 * out;
  if (A <= 0.01 || lt < 0) return;
  const [c1, c2] = BADGE[colKey] || BADGE.cam;
  const s = lt < 0.42 ? 0.55 + 0.45 * ease.out(lt / 0.42) : 1;   // 30/10 12:45: hiện êm, không bật nảy mạnh
  const fl = lt > 0.34 ? Math.sin(lt * 2.6) * r * 0.07 : 0;
  const y = cy + fl;
  ctx.save();
  if (lt > 0.08 && lt < 0.75) {
    const q = (lt - 0.08) / 0.67, rr = r * (1 + 0.9 * q);
    ctx.globalAlpha = (1 - q) * 0.8 * A; ctx.strokeStyle = c1; ctx.lineWidth = Math.max(1, r * 0.06 * (1 - q));
    ctx.beginPath(); ctx.arc(cx, y, rr, 0, Math.PI * 2); ctx.stroke();
  }
  const q2 = (lt - 0.12) / 0.5;
  if (q2 > 0 && q2 < 1) {
    ctx.globalAlpha = (1 - q2) * A; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1, r * 0.05); ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const a = (k * 72 - 70) * Math.PI / 180, d0 = r * (1.15 + 0.55 * q2), d1 = d0 + r * 0.25 * (1 - q2);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * d0, y + Math.sin(a) * d0); ctx.lineTo(cx + Math.cos(a) * d1, y + Math.sin(a) * d1); ctx.stroke();
    }
  }
  if (s > 0.02) {
    ctx.translate(cx, y); ctx.scale(s, s);
    // đĩa: bóng mềm dưới + chuyển sắc trên → dưới + vệt bóng kính
    ctx.globalAlpha = clamp01(lt / 0.08) * A;
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = r * 0.25; ctx.shadowOffsetY = r * 0.08;
    const g = ctx.createLinearGradient(0, -r, 0, r); g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.235)'; ctx.beginPath(); ctx.ellipse(0, -r * 0.41, r * 0.8, r * 0.51, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // vòng sáng quay quanh huy hiệu
    const sw = ((lt * 120) % 360) * Math.PI / 180, R = r * 1.12;
    ctx.lineWidth = Math.max(1, r * 0.055); ctx.lineCap = 'round';
    ctx.globalAlpha = 0.85 * A; ctx.strokeStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(0, 0, R, sw, sw + 110 * Math.PI / 180); ctx.stroke();
    ctx.globalAlpha = 0.6 * A; ctx.strokeStyle = c1; ctx.beginPath(); ctx.arc(0, 0, R, sw + Math.PI, sw + 250 * Math.PI / 180); ctx.stroke();
    // icon: lắc nhẹ lúc hiện rồi đứng yên
    const wob = (1 - clamp01((lt - 0.1) / 0.5)) * Math.sin(lt * 11) * 6 * Math.PI / 180;
    ctx.globalAlpha = clamp01((lt - 0.06) / 0.1) * A;
    ctx.rotate(wob);
    iconStrokes(ctx, name, r * 1.08);
  }
  ctx.restore();
}

// ---------- cụm chữ ----------
const off = { c: null };
function scratch(w, h) {
  if (!off.c) off.c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
  const c = off.c;
  if (c.width < w || c.height < h) { c.width = Math.max(c.width, Math.ceil(w)); c.height = Math.max(c.height, Math.ceil(h)); }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
  return { c, g };
}
const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); return `rgb(${Math.round((n >> 16) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`; };

// Kích thước cụm (đơn vị khung logic) — dùng cho cả chọn chỗ đặt
export function mau1Layout(ctx, p, k, maxW) {
  const d3 = p.look === '3d';
  const font = s => `800 ${s}px ${F_3D}`; // 30/10 Giang chốt một font: Montserrat, chữ thường nhẹ nhàng (800, không khối)
  let big = 68 * k * (p.kind === 'price' ? 1.06 : 1); // 30/10 12:20 Giang: to hơn chút để nhấn mạnh (11:30 là 60; ban đầu 70)
  ctx.font = font(big);
  const iw = p.icon ? 74 * k : 0;
  let bw = ctx.measureText(p.text).width;
  const room = maxW - iw - 16 * k;
  if (bw > room) { big *= room / bw; ctx.font = font(big); bw = ctx.measureText(p.text).width; }
  const m = ctx.measureText(p.text);
  const asc = m.actualBoundingBoxAscent || big * 0.75, desc = m.actualBoundingBoxDescent || big * 0.05;
  const thin = 21.5 * k, sign = 31.5 * k;
  ctx.font = `500 ${thin}px ${F_THIN}`;
  const tw = p.kicker ? ctx.measureText(p.kicker).width : 0;
  ctx.font = `600 ${sign}px ${F_SIGN}`;
  const sgw = p.sign ? Math.min(ctx.measureText(p.sign).width, maxW - iw) : 0;
  const thinH = p.kicker ? thin * 1.25 : 0;
  const depth = d3 ? big * 0.095 : 0;
  const signOver = p.sign ? sign * 0.95 : 0; // gồm cả phần chữ ký tay thò xuống (dấu, nét g/y) để chỗ đặt tính đủ
  const w = iw + Math.max(bw + depth, tw + big * 0.08, sgw + bw * 0.25);
  const h = thinH + asc + desc + depth + signOver + 6 * k;
  return { d3, font, big, bw, asc, desc, thin, sign, tw, sgw, thinH, depth, iw, w, h };
}

// Vẽ từ khoá vào canvas phụ (độ phân giải thật S), trả về [canvas, x, y, w, h] (đơn vị logic, gốc = góc trái baseline từ khoá)
function keywordSprite(text, L, col, outline, S, shine) {
  const pad = L.big * 0.3, W = L.bw + L.depth + pad * 2, H = L.asc + L.desc + L.depth + pad * 2;
  const { c, g } = scratch(W * S, H * S);
  g.scale(S, S);
  const x = pad, y = pad + L.asc;
  g.font = L.font(L.big); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const face = g.createLinearGradient(0, y - L.asc, 0, y + L.desc);
  face.addColorStop(0, col[0]);
  if (col.length > 2) { face.addColorStop(0.5, col[1]); face.addColorStop(1, col[2]); } else face.addColorStop(1, col[1]);
  if (L.d3) {
    // khối đùn xuống dưới (hơi sang phải), tối dần
    const steps = Math.max(2, Math.round(L.depth * S));
    for (let i = steps; i >= 1; i--) {
      const dy = L.depth * i / steps;
      g.fillStyle = shade(col[1], 0.62 - 0.22 * (i / steps));
      g.fillText(text, x + dy * 0.18, y + dy);
    }
    // mép trên mỗi nét sáng (vát cạnh): chữ trắng rồi phủ mặt chữ lệch xuống
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillText(text, x, y);
    g.save(); g.beginPath(); g.rect(0, y - L.asc + L.big * 0.022, W, H); g.clip();
    g.fillStyle = face; g.fillText(text, x, y);
    g.restore();
  } else {
    if (outline) { g.lineJoin = 'round'; g.lineWidth = L.big * 0.06; g.strokeStyle = '#FFFFFF'; g.strokeText(text, x, y); }
    g.fillStyle = face; g.fillText(text, x, y);
  }
  if (shine != null && shine >= 0 && shine <= 1) {
    // vệt sáng chéo lướt qua mặt chữ (chỉ trên chữ)
    g.globalCompositeOperation = 'source-atop';
    const bx = -L.big + (L.bw + 2 * L.big) * shine;
    const sg = g.createLinearGradient(bx - L.big * 0.5, 0, bx + L.big * 0.5, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.62)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(bx, y); g.transform(1, 0, -0.35, 1, 0, 0); g.translate(-bx, -y);
    g.fillStyle = sg; g.fillRect(bx - L.big, y - L.asc - pad, L.big * 2, H + pad);
    g.restore();
    g.globalCompositeOperation = 'source-over';
  }
  return [c, -x, -y, W, H];
}

// p: { text, kicker, sign, icon, color, look: 'anton'|'3d', kind, count }; (x, y) = góc trên trái cụm; lt = giây từ lúc cụm bật
export function drawMau1(ctx, p, x, y, lt, dur, k, maxW) {
  if (lt < 0 || lt > dur) return;
  const L = mau1Layout(ctx, p, k, maxW);
  const out = clamp01((lt - (dur - 0.3)) / 0.3);
  const A = 1 - out;
  if (A <= 0.01) return;
  const S = Math.max(1, ctx.getTransform().a);
  const col = M1_ACCENT[p.color] || (L.d3 ? PAL_3D : PAL_ANTON)[p.color] || M1_ACCENT.neon;
  const kx = x + L.iw, base = y + L.thinH + L.asc;
  ctx.save();
  // thu nhỏ nhẹ lúc rút
  if (out > 0) { const cx = x + L.w / 2, cy = y + L.h / 2; ctx.translate(cx, cy); ctx.scale(1 - 0.06 * out, 1 - 0.06 * out); ctx.translate(-cx, -cy); }
  // icon tròn bên trái, ngang từ khoá (hiện trước chữ 0,08 s)
  if (p.icon) drawBadge(ctx, p.icon, x + 33 * k, base - L.asc * 0.45, 29 * k, lt + 0.08, dur + 0.08, p.color, A);
  // dòng dẫn nhỏ: mờ dần vào + trồi lên
  if (p.kicker) {
    const a = clamp01(lt / 0.2) * A;
    ctx.globalAlpha = a;
    ctx.font = `500 ${L.thin}px ${F_THIN}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = L.thin * 0.25; ctx.shadowOffsetY = L.thin * 0.08;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(p.kicker, kx + L.big * 0.08, y + L.thin * 1.0 + (1 - ease.out(clamp01(lt / 0.25))) * 6 * k);
    ctx.shadowColor = 'transparent';
  }
  // từ khoá: rơi từ trên xuống có vệt nhoè dọc, chạm thì nảy nhẹ; giá: số chạy từ 0 lên
  const q = lt - 0.1;
  if (q > 0) {
    const text = p.count ? countUp(p.text, clamp01(q / 1.0)) : p.text;
    const [c, ox, oy, W, H] = keywordSprite(text, L, col, false, S, -1);   // 30/10: chữ phẳng, không viền, không vệt sáng
    // 30/10 12:45 Giang: lúc vào hơi giật → vào ÊM: trượt xuống ngắn (0,45 × cỡ chữ) trong 0,38 s, mờ dần vào,
    // KHÔNG vệt nhoè, KHÔNG rung nhanh; chạm xong chỉ phồng nhẹ một lần
    const u = clamp01(q / 0.38);
    const draw = (dy, alpha, sc = 1) => {
      ctx.globalAlpha = alpha;
      const cx = kx + L.bw / 2, cy = base - L.asc / 2 + dy;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
      ctx.drawImage(c, 0, 0, W * S, H * S, kx + ox, base + oy + dy, W, H);
      ctx.restore();
    };
    // bóng đổ đậm vừa, gọn (không quầng)
    // Sang trọng (vàng tươi) bóng đậm hơn một chút cho nổi trên ảnh vệ tinh sáng
    ctx.shadowColor = p.color === 'sangtrong' || p.color === 'neon' ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.62)'; ctx.shadowBlur = L.big * 0.07; ctx.shadowOffsetY = L.big * 0.065;
    if (u < 1) {
      const e = 1 - Math.pow(1 - u, 3);
      draw(-(1 - e) * L.big * 0.45, clamp01(q / 0.25) * A);
    } else {
      const sc = 1 + 0.025 * Math.sin(Math.PI * clamp01((q - 0.38) / 0.4));   // phồng nhẹ 1 lần, êm
      draw(0, A, sc);
    }
    ctx.shadowColor = 'transparent';
  }
  // chữ ký tay: viết dần từ trái sang phải, canh phải, đè lên đáy từ khoá
  if (p.sign) {
    const sq = (lt - 0.45) / 0.5;
    if (sq > 0) {
      ctx.font = `600 ${L.sign}px ${F_SIGN}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const sx = Math.max(kx, kx + L.bw + L.big * 0.08 - L.sgw), sy = base + L.desc + L.depth + L.sign * 0.5;
      ctx.save();
      ctx.beginPath(); ctx.rect(sx - 4, sy - L.sign * 1.4, (L.sgw + 8) * ease.out(clamp01(sq)), L.sign * 2.2); ctx.clip();
      ctx.globalAlpha = A;
      ctx.shadowColor = 'rgba(0,0,0,0.72)'; ctx.shadowBlur = L.sign * 0.12; ctx.shadowOffsetY = L.sign * 0.06;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(p.sign, sx, sy, L.sgw + 1);
      ctx.restore();
    }
  }
  ctx.restore();
}
