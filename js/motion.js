// Chữ động (kinetic text) cho video — thay cho Remotion: spring(), interpolate() chỉ là công thức toán,
// tính theo thời gian t của khung hình nên xem trước = video xuất, chạy được trên máy cũ, không phí giấy phép.
// Mỗi "gói chuyển động" (MOTION) vẽ thẻ mở đầu (giá) + tiêu đề cảnh theo một kiểu chữ/màu riêng.
// App tự chọn gói theo căn nhà (khách không cần chọn) — cùng căn luôn ra cùng kiểu.

const clamp01 = v => Math.max(0, Math.min(1, v));

// Lò xo tắt dần (như spring() của Remotion), trả 0 → 1 (có thể vượt 1 một chút rồi về)
export function spring(t, { stiffness = 200, damping = 20, mass = 1 } = {}) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}
// Nội suy tuyến tính theo nhiều mốc, mặc định kẹp 2 đầu
export function interpolate(v, inR, outR, clamp = true) {
  if (clamp) v = Math.min(Math.max(v, inR[0]), inR[inR.length - 1]);
  let i = 1;
  while (i < inR.length - 1 && v > inR[i]) i++;
  const a = inR[i - 1], b = inR[i];
  const k = b === a ? 0 : (v - a) / (b - a);
  return outR[i - 1] + (outR[i] - outR[i - 1]) * k;
}
export const ease = {
  out: x => 1 - Math.pow(1 - clamp01(x), 3),
  inOut: x => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; },
  expo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(x))),
  back: x => { x = clamp01(x); const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
};

// Số chạy từ 0 lên giá thật, giữ đúng cách viết ("3,5 tỷ", "1.250 triệu", "16 triệu/m²")
export function countUp(text, p) {
  const s = String(text || '');
  const m = s.match(/\d+(?:[.,]\d+)*/);
  if (!m || p >= 1) return s;
  const tok = m[0];
  let val, fmt;
  if (/,\d{1,2}$/.test(tok) && !/,\d{3}/.test(tok)) {
    const dec = tok.split(',').pop().length;
    val = parseFloat(tok.replace(/\./g, '').replace(',', '.'));
    fmt = v => v.toFixed(dec).replace('.', ',');
  } else if (/\.\d{1,2}$/.test(tok) && !/\.\d{3}/.test(tok)) {
    const dec = tok.split('.').pop().length;
    val = parseFloat(tok);
    fmt = v => v.toFixed(dec);
  } else {
    const sep = tok.includes('.') ? '.' : tok.includes(',') ? ',' : '';
    val = parseInt(tok.replace(/[.,]/g, ''), 10);
    fmt = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }
  if (!isFinite(val)) return s;
  return s.slice(0, m.index) + fmt(val * ease.expo(p)) + s.slice(m.index + tok.length);
}

// Chọn gói theo toạ độ căn (ổn định: xem trước, xuất lại, lưu căn đều ra cùng kiểu)
export function pickMotion(house, keys = MOTION_KEYS) {
  if (!house) return keys[0];
  const s = `${(+house.lat).toFixed(4)},${(+house.lng).toFixed(4)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return keys[(h >>> 0) % keys.length];
}

// ---------- Công cụ vẽ ----------
const HEAD = '"Montserrat", "Be Vietnam Pro", system-ui, sans-serif';
const BODY = '"Be Vietnam Pro", "Segoe UI", system-ui, sans-serif';
const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';

// Bảng màu nhũ của gói đen – vàng; gói đen – xanh lá (phong cách Xanh sinh thái, 30/10) dùng chung bố cục, chỉ đổi bảng màu
const PAL_GOLD = { g: ['#FBEBC4', '#E6C27E', '#C8964F', '#E7C88D'], line: '#D9B26F', line2: '#C9974E', glow: 'rgba(201,151,78,0.16)', ink: '#F4EFE6' };
const PAL_GREEN = { g: ['#E3FFD9', '#86EFAC', '#22C55E', '#A7F3C0'], line: '#6EE7A0', line2: '#22C55E', glow: 'rgba(34,197,94,0.16)', ink: '#F0FDF4' };
let PAL = PAL_GOLD;
function goldGrad(ctx, y, size) {
  const g = ctx.createLinearGradient(0, y - size * 0.62, 0, y + size * 0.42);
  g.addColorStop(0, PAL.g[0]); g.addColorStop(0.42, PAL.g[1]); g.addColorStop(0.78, PAL.g[2]); g.addColorStop(1, PAL.g[3]);
  return g;
}
function charsOf(ctx, text, sp) {
  const cs = Array.from(text);
  const ws = cs.map(c => ctx.measureText(c).width + sp);
  return { cs, ws, total: ws.reduce((a, b) => a + b, 0) - sp };
}
// Cỡ chữ vừa bề ngang cho phép
function fitSize(ctx, text, font, size, sp, maxW) {
  ctx.font = font(size);
  const w = charsOf(ctx, text, size * sp).total;
  return w > maxW ? Math.max(12, size * maxW / w) : size;
}
// Từng ký tự trồi lên theo lò xo, lần lượt (stagger) — tâm dòng tại x
function kinetic(ctx, text, x, y, size, o) {
  const sp = size * (o.sp || 0);
  ctx.font = o.font(size);
  const { cs, ws, total } = charsOf(ctx, text, sp);
  let cx = x - total / 2;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let i = 0; i < cs.length; i++) {
    const lt = o.lt - (o.delay || 0) - i * (o.stagger ?? 0.018);
    const s = spring(lt, o.spring || { stiffness: 230, damping: 21 });
    const a = clamp01(lt / 0.16);
    if (a > 0 && cs[i] !== ' ') {
      ctx.globalAlpha = o.A * a;
      const dy = (1 - s) * size * (o.rise ?? 0.6);
      ctx.fillStyle = o.fill === 'gold' ? goldGrad(ctx, y + dy, size) : o.fill;
      ctx.fillText(cs[i], cx, y + dy);
    }
    cx += ws[i];
  }
  ctx.globalAlpha = o.A;
  return total;
}
// Vệt sáng lướt qua chữ đúng 1 lần (chỉ tô trên nét chữ)
function sheen(ctx, text, x, y, size, font, sp, p, A) {
  if (p <= 0 || p >= 1) return;
  ctx.save();
  ctx.font = font(size);
  const { cs, ws, total } = charsOf(ctx, text, size * sp);
  const x0 = x - total / 2, bx = x0 - size + (total + size * 2) * p;
  const g = ctx.createLinearGradient(bx - size * 0.7, 0, bx + size * 0.7, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.globalAlpha = A * 0.9; ctx.shadowColor = 'transparent';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let cx = x0;
  for (let i = 0; i < cs.length; i++) { ctx.fillText(cs[i], cx, y); cx += ws[i]; }
  ctx.restore();
}
// Vạch mảnh tự vẽ từ giữa ra 2 bên, mờ dần ở đầu (như ảnh mẫu đen – vàng)
function hairline(ctx, cx, y, half, p, color, A, gap = 0) {
  if (p <= 0) return;
  const h = half * ease.out(p);
  for (const s of [-1, 1]) {
    const a = cx + s * gap, b = cx + s * (gap + h);
    const g = ctx.createLinearGradient(a, 0, b, 0);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = A; ctx.fillStyle = g;
    ctx.fillRect(Math.min(a, b), y - 0.9, Math.abs(b - a), 1.8);
  }
}
// Khung viền vàng tự vẽ quanh hình chữ nhật (chạy vòng)
function traceRect(ctx, x, y, w, h, p, color, lw, A) {
  if (p <= 0) return;
  const per = 2 * (w + h);
  ctx.save();
  ctx.globalAlpha = A; ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.setLineDash([per * ease.inOut(p), per]);
  ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y); ctx.closePath(); ctx.stroke();
  ctx.restore();
}
// 27/10 (khách báo "Cách Cao tốc Khánh Hòa – Buôn Ma…" mất chữ "Thuột" và mất luôn số km): chữ dài hơn khung thì
// THU NHỎ cho vừa (đổi luôn ctx.font, còn tối thiểu 66%); dài quá nữa mới cắt "…" ở ranh giới từ.
const fontPx = ctx => { const m = /([\d.]+)px/.exec(ctx.font); return m ? +m[1] : 0; };
const setPx = (ctx, px) => { ctx.font = ctx.font.replace(/[\d.]+px/, px.toFixed(2) + 'px'); };
function fitText(ctx, text, maxW, minF = 0.66) {
  const w = ctx.measureText(text).width;
  if (w <= maxW) return text;
  const px = fontPx(ctx);
  if (px) {
    setPx(ctx, px * Math.max(minF, (maxW / w) * 0.99));
    if (ctx.measureText(text).width <= maxW) return text;
  }
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  const sp = s.lastIndexOf(' ');
  if (sp > s.length * 0.6) s = s.slice(0, sp);
  return s.trimEnd() + '…';
}
// Dòng phụ thẻ mở đầu: vừa thì 1 dòng (thu nhỏ tối đa còn 82%), dài hơn thì xuống 2 dòng ở chỗ cách gần giữa nhất
function fitLines(ctx, text, maxW) {
  const px = fontPx(ctx), w = ctx.measureText(text).width;
  if (w <= maxW) return [text];
  if (px && maxW / w >= 0.82) { setPx(ctx, px * (maxW / w) * 0.99); return [text]; }
  const words = text.split(' ');
  if (words.length < 2) return [fitText(ctx, text, maxW)];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const m = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (!best || m < best.m) best = { a, b, m };
  }
  if (px && best.m > maxW) setPx(ctx, px * Math.max(0.7, (maxW / best.m) * 0.99));
  return [fitText(ctx, best.a, maxW, 1), fitText(ctx, best.b, maxW, 1)];
}
function dim(ctx, LW, LH, A, k, glow) {
  ctx.save();
  ctx.globalAlpha = A * k; ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, LW, LH);
  if (glow) {
    const g = ctx.createRadialGradient(LW / 2, LH * 0.42, 10, LW / 2, LH * 0.42, Math.max(LW, LH) * 0.62);
    g.addColorStop(0, glow); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = A; ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);
  }
  ctx.restore();
}

// Dữ liệu thẻ mở đầu → các dòng: dòng trắng (loại BĐS), dòng màu (xã/phường), giá to, 2 dòng phụ
function hookLines(H) {
  const kick = String(H.kicker || '').split(' · ');
  return {
    l1: (kick[0] || '').toUpperCase(),
    l2: (kick.slice(1).join(' · ') || '').toUpperCase(),
    label: H.isPrice ? (H.rent ? 'Giá thuê' : 'Giá bán') : 'Vị trí nổi bật',
    rent: !!H.rent,
    big: H.isPrice ? String(H.big).toUpperCase() : String(H.fact || H.big).toUpperCase(),
    subs: [H.isPrice ? H.fact : '', H.det].filter(Boolean),
    isPrice: H.isPrice,
  };
}

// ---------- Các gói chuyển động ----------
// env: { ctx, LW, LH, safe, fmt, lt (giây từ lúc thẻ hiện), A (độ hiện chung), k (tỉ lệ cỡ), H }
export const MOTION = {
  // Đen – vàng (theo ảnh mẫu Giang gửi): Montserrat đậm, trắng + vàng nhũ, vạch vàng mảnh, khung viền vàng
  denvang: {
    label: 'Đen vàng sang trọng',
    hook(ctx, e) {
      const { LW, LH, safe, lt, A, k } = e;
      const L = hookLines(e.H);
      dim(ctx, LW, LH, A, 0.74, PAL.glow);
      const maxW = LW - safe.x * 2 - 24;
      const cx = LW / 2;
      let y = LH * (e.fmt === 'h' ? 0.24 : 0.3);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 10;
      const f1 = s => `800 ${s}px ${HEAD}`;
      if (L.l1) {
        const s1 = fitSize(ctx, L.l1, f1, 56 * k, 0.01, maxW);
        kinetic(ctx, L.l1, cx, y, s1, { font: f1, sp: 0.01, fill: '#FFFFFF', lt, A });
        y += s1 * 1.12;
      }
      if (L.l2) {
        const s2 = fitSize(ctx, L.l2, f1, 56 * k, 0.01, maxW);
        kinetic(ctx, L.l2, cx, y, s2, { font: f1, sp: 0.01, fill: 'gold', lt, A, delay: 0.12 });
        y += s2 * 0.9;
      }
      // vạch vàng + nhãn nhỏ ở giữa
      y += 26 * k;
      const fl = s => `500 ${s}px ${BODY}`;
      ctx.font = fl(23 * k);
      const lw = ctx.measureText(L.label).width;
      const pl = clamp01((lt - 0.28) / 0.5);
      hairline(ctx, cx, y, Math.min(maxW / 2, lw / 2 + 170 * k) - lw / 2 - 16 * k, pl, PAL.line, A, lw / 2 + 16 * k);
      ctx.globalAlpha = A * clamp01((lt - 0.3) / 0.3); ctx.fillStyle = PAL.ink;
      ctx.font = fl(23 * k); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(L.label, cx, y);
      // giá to: số chạy + vệt sáng
      y += 80 * k;
      const fb = s => `900 ${s}px ${HEAD}`;
      const bigTxt = L.isPrice ? countUp(L.big, clamp01((lt - 0.35) / 0.75)) : L.big;
      const sb = fitSize(ctx, L.big, fb, (L.isPrice ? 104 : 52) * k, 0.01, maxW);
      const ps = spring(lt - 0.35, { stiffness: 160, damping: 14 });
      ctx.save();
      ctx.translate(cx, y); ctx.scale(0.86 + 0.14 * ps, 0.86 + 0.14 * ps);
      ctx.globalAlpha = A * clamp01((lt - 0.35) / 0.2);
      ctx.font = fb(sb); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = goldGrad(ctx, 0, sb);
      ctx.fillText(bigTxt, 0, 0);
      ctx.restore();
      sheen(ctx, L.big, cx, y, sb, fb, 0, (lt - 1.15) / 0.7, A);
      y += sb * 0.58 + 10 * k;
      hairline(ctx, cx, y, maxW * 0.42, clamp01((lt - 0.7) / 0.6), PAL.line2, A * 0.9);
      // dòng phụ
      ctx.shadowBlur = 6;
      y += 36 * k;
      L.subs.forEach((s, i) => {
        const a = clamp01((lt - 0.8 - i * 0.14) / 0.3);
        if (a <= 0) return;
        ctx.globalAlpha = A * a; ctx.fillStyle = PAL.ink;
        ctx.font = `600 ${25 * k}px ${BODY}`; ctx.textAlign = 'center';
        const ls = fitLines(ctx, s, maxW), lh = fontPx(ctx) * 1.25;
        ls.forEach((ln, j) => ctx.fillText(ln, cx, y + j * lh + (1 - ease.out(a)) * 10));
        y += 38 * k + (ls.length - 1) * lh;
      });
      ctx.restore();
    },
    title(ctx, e) {
      const { LW, safe, lt, A, k, text, sub } = e;
      const maxW = LW - safe.x * 2 - 20;
      const f = s => `800 ${s}px ${HEAD}`;
      const s = fitSize(ctx, text, f, 34 * k, 0.02, maxW);
      const y = e.top + s * 0.62;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 12;
      kinetic(ctx, text, LW / 2, y, s, { font: f, sp: 0.02, fill: 'gold', lt, A, stagger: 0.022 });
      sheen(ctx, text, LW / 2, y, s, f, 0.02, (lt - 0.9) / 0.8, A);
      ctx.font = f(s);
      hairline(ctx, LW / 2, y + s * 0.78, Math.min(maxW / 2, charsOf(ctx, text, s * 0.02).total * 0.55), clamp01((lt - 0.3) / 0.6), PAL.line, A);
      if (sub) {
        ctx.globalAlpha = A * clamp01((lt - 0.5) / 0.4); ctx.fillStyle = PAL.ink;
        ctx.font = `500 ${15 * k}px ${BODY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fitText(ctx, sub, maxW), LW / 2, y + s * 0.78 + 22 * k);
      }
      ctx.restore();
    },
  },

  // Đen – xanh lá (phong cách Xanh sinh thái): bố cục y như đen – vàng, nhũ xanh lá
  denxanh: {
    label: 'Đen xanh lá',
    hook(ctx, e) { PAL = PAL_GREEN; try { MOTION.denvang.hook(ctx, e); } finally { PAL = PAL_GOLD; } },
    title(ctx, e) { PAL = PAL_GREEN; try { MOTION.denvang.title(ctx, e); } finally { PAL = PAL_GOLD; } },
  },
  // Khối chữ đậm (kiểu tin nhanh): từng dòng nằm trong khối màu quét ra, giá trong khối vàng nảy lên
  khoi: {
    label: 'Khối chữ tin nhanh',
    hook(ctx, e) {
      const { LW, LH, safe, lt, A, k } = e;
      const L = hookLines(e.H);
      dim(ctx, LW, LH, A, 0.38);
      const maxW = LW - safe.x * 2 - 30;
      const left = safe.x + 14 * k;
      let y = LH * (e.fmt === 'h' ? 0.26 : 0.32);
      const block = (txt, size, bg, ink, delay, font = `900 ${size}px ${HEAD}`, rot = 0) => {
        ctx.save();
        ctx.font = font;
        const t2 = fitText(ctx, txt, maxW - 28 * k);
        const w = ctx.measureText(t2).width + 28 * k, h = size * 1.32;
        const p = ease.expo(clamp01((lt - delay) / 0.38));
        if (p <= 0) { ctx.restore(); return h; }
        ctx.globalAlpha = A;
        ctx.translate(left, y); ctx.rotate(rot);
        ctx.fillStyle = bg;
        ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
        ctx.fillRect(0, -h / 2, w * p, h);
        ctx.shadowColor = 'transparent';
        ctx.beginPath(); ctx.rect(0, -h / 2, w * p, h); ctx.clip();
        ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(t2, 14 * k - (1 - p) * 30, size * 0.04);
        ctx.restore();
        return h;
      };
      if (L.l1) y += block(L.l1, 40 * k, '#FFFFFF', '#101010', 0) * 0.5 + 6 * k;
      if (L.l2) { y += 16 * k; y += block(L.l2, 40 * k, '#E53935', '#FFFFFF', 0.12) * 0.5 + 6 * k; }
      y += 24 * k;
      y += block(L.label.toUpperCase(), 20 * k, '#101010', '#FFD400', 0.3, `800 ${20 * k}px ${BODY}`) * 0.5;
      y += 58 * k;
      // giá: khối vàng nảy (lò xo) + số chạy
      const sb = 80 * k;
      ctx.save();
      ctx.font = `900 ${sb}px ${HEAD}`;
      const big = L.isPrice ? countUp(L.big, clamp01((lt - 0.4) / 0.7)) : L.big;
      const bw = Math.min(maxW, ctx.measureText(L.big).width + 34 * k);
      const ps = spring(lt - 0.4, { stiffness: 240, damping: 13 });
      if (lt > 0.4) {
        ctx.globalAlpha = A;
        ctx.translate(left + bw / 2, y); ctx.rotate(-0.03); ctx.scale(ps, ps);
        ctx.fillStyle = '#FFD400'; ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 5;
        ctx.fillRect(-bw / 2, -sb * 0.7, bw, sb * 1.4);
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#101010'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.min(sb, sb * (bw - 30 * k) / Math.max(1, ctx.measureText(L.big).width))}px ${HEAD}`;
        ctx.fillText(big, 0, sb * 0.05);
      }
      ctx.restore();
      y += sb * 0.7 + 34 * k;
      L.subs.forEach((s, i) => { y += block(s, 23 * k, 'rgba(16,16,16,0.82)', '#FFFFFF', 0.75 + i * 0.12, `700 ${23 * k}px ${BODY}`) * 0.5 + 22 * k; });
    },
    title(ctx, e) {
      const { LW, safe, lt, A, k, text, sub } = e;
      const maxW = LW - safe.x * 2 - 20;
      ctx.save();
      ctx.font = `900 ${30 * k}px ${HEAD}`;
      const t2 = fitText(ctx, text, maxW - 28 * k);
      const w = ctx.measureText(t2).width + 28 * k, h = 30 * k * 1.34;
      const p = ease.expo(clamp01(lt / 0.4));
      const x = (LW - w) / 2, y = e.top;
      ctx.globalAlpha = A;
      ctx.fillStyle = '#FFD400'; ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12;
      ctx.fillRect(x, y, w * p, h);
      ctx.shadowColor = 'transparent';
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w * p, h); ctx.clip();
      ctx.fillStyle = '#101010'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t2, LW / 2, y + h / 2 + 1);
      ctx.restore();
      if (sub) {
        const a = clamp01((lt - 0.3) / 0.35);
        ctx.font = `700 ${15 * k}px ${BODY}`;
        const s2 = fitText(ctx, sub, maxW - 20 * k);
        const sw = ctx.measureText(s2).width + 20 * k;
        ctx.globalAlpha = A * a; ctx.fillStyle = '#101010';
        ctx.fillRect((LW - sw) / 2, y + h + 6 * k, sw, 28 * k);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s2, LW / 2, y + h + 20 * k);
      }
      ctx.restore();
    },
  },

  // Tạp chí cao cấp: chữ có chân Playfair, khung viền vàng tự vẽ, nghiêng nhẹ dòng phụ
  tapchi: {
    label: 'Tạp chí cao cấp',
    hook(ctx, e) {
      const { LW, LH, safe, lt, A, k } = e;
      const L = hookLines(e.H);
      dim(ctx, LW, LH, A, 0.62);
      const fw = LW - safe.x * 2 - 10 * k, fh = Math.min(LH * 0.5, 470 * k);
      const fx = (LW - fw) / 2, fy = LH * (e.fmt === 'h' ? 0.14 : 0.24);
      traceRect(ctx, fx, fy, fw, fh, clamp01(lt / 0.9), '#D9B26F', 1.6, A);
      traceRect(ctx, fx + 7 * k, fy + 7 * k, fw - 14 * k, fh - 14 * k, clamp01((lt - 0.15) / 0.9), 'rgba(217,178,111,0.45)', 1, A);
      const maxW = fw - 50 * k, cx = LW / 2;
      let y = fy + 58 * k;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8;
      const fk = s => `500 ${s}px ${BODY}`;
      if (L.l2 || L.l1) {
        const kick = [L.l1, L.l2].filter(Boolean).join(' · ');
        const s0 = fitSize(ctx, kick, fk, 18 * k, 0.28, maxW);
        kinetic(ctx, kick, cx, y, s0, { font: fk, sp: 0.28, fill: '#E6C27E', lt, A, stagger: 0.008, rise: 0.4 });
      }
      y += 54 * k;
      const fi = s => `italic 500 ${s}px ${SERIF}`;
      ctx.globalAlpha = A * clamp01((lt - 0.25) / 0.4);
      ctx.font = fi(32 * k); ctx.fillStyle = '#F7F1E6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(L.isPrice ? (L.rent ? 'Giá thuê' : 'Giá chỉ') : L.label, cx, y);
      y += 74 * k;
      const fb = s => `700 ${s}px ${SERIF}`;
      const sb = fitSize(ctx, L.big, fb, (L.isPrice ? 96 : 50) * k, 0.02, maxW);
      const big = L.isPrice ? countUp(L.big, clamp01((lt - 0.4) / 0.8)) : L.big;
      ctx.globalAlpha = A * clamp01((lt - 0.4) / 0.3);
      ctx.font = fb(sb); ctx.fillStyle = goldGrad(ctx, y, sb);
      ctx.fillText(big, cx, y + (1 - ease.out(clamp01((lt - 0.4) / 0.5))) * 16 * k);
      sheen(ctx, L.big, cx, y, sb, fb, 0, (lt - 1.2) / 0.7, A);
      y += sb * 0.62 + 18 * k;
      // hình thoi + 2 vạch
      const pd = clamp01((lt - 0.6) / 0.5);
      hairline(ctx, cx, y, maxW * 0.38, pd, '#D9B26F', A, 12 * k);
      ctx.globalAlpha = A * pd; ctx.fillStyle = '#D9B26F';
      ctx.beginPath(); ctx.moveTo(cx, y - 5 * k); ctx.lineTo(cx + 5 * k, y); ctx.lineTo(cx, y + 5 * k); ctx.lineTo(cx - 5 * k, y); ctx.closePath(); ctx.fill();
      y += 40 * k;
      L.subs.forEach((s, i) => {
        const a = clamp01((lt - 0.85 - i * 0.15) / 0.35);
        if (a <= 0) return;
        ctx.globalAlpha = A * a; ctx.fillStyle = '#F7F1E6';
        ctx.font = `${i ? 'italic ' : ''}500 ${(i ? 23 : 24) * k}px ${i ? SERIF : BODY}`; ctx.textAlign = 'center';
        const ls = fitLines(ctx, s, maxW), lh = fontPx(ctx) * 1.25;
        ls.forEach((ln, j) => ctx.fillText(ln, cx, y + j * lh));
        y += 36 * k + (ls.length - 1) * lh;
      });
      ctx.restore();
    },
    title(ctx, e) {
      const { LW, safe, lt, A, k, text, sub } = e;
      const maxW = LW - safe.x * 2 - 30;
      const f = s => `700 ${s}px ${SERIF}`;
      const s = fitSize(ctx, text, f, 34 * k, 0.04, maxW);
      const y = e.top + s * 0.62;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 12;
      kinetic(ctx, text, LW / 2, y, s, { font: f, sp: 0.04, fill: '#F7F1E6', lt, A, stagger: 0.02, rise: 0.5 });
      const pd = clamp01((lt - 0.35) / 0.5);
      const ry = y + s * 0.8;
      hairline(ctx, LW / 2, ry, Math.min(maxW / 2, 150 * k), pd, '#D9B26F', A, 11 * k);
      ctx.globalAlpha = A * pd; ctx.fillStyle = '#D9B26F';
      ctx.beginPath(); ctx.moveTo(LW / 2, ry - 5 * k); ctx.lineTo(LW / 2 + 5 * k, ry); ctx.lineTo(LW / 2, ry + 5 * k); ctx.lineTo(LW / 2 - 5 * k, ry); ctx.closePath(); ctx.fill();
      if (sub) {
        ctx.globalAlpha = A * clamp01((lt - 0.55) / 0.4); ctx.fillStyle = '#F7F1E6';
        ctx.font = `italic 500 ${16 * k}px ${SERIF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fitText(ctx, sub, maxW), LW / 2, ry + 22 * k);
      }
      ctx.restore();
    },
  },

  // Trắng hiện đại: chữ trắng đậm trồi lên từ sau vạch (mặt nạ), thanh màu chạy dưới giá
  hiendai: {
    label: 'Trắng hiện đại',
    hook(ctx, e) {
      const { LW, LH, safe, lt, A, k } = e;
      const L = hookLines(e.H);
      dim(ctx, LW, LH, A, 0.5);
      const g = ctx.createLinearGradient(0, LH * 0.15, 0, LH * 0.85);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.globalAlpha = A; ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH); ctx.restore();
      const left = safe.x + 18 * k, maxW = LW - safe.x * 2 - 36 * k;
      let y = LH * (e.fmt === 'h' ? 0.26 : 0.32);
      // dòng trồi lên sau mặt nạ (như chữ chui ra từ khe)
      const rise = (txt, size, font, color, delay) => {
        ctx.save();
        ctx.font = font;
        const t2 = fitText(ctx, txt, maxW);
        const s = spring(lt - delay, { stiffness: 210, damping: 22 });
        ctx.beginPath(); ctx.rect(0, y - size * 0.75, LW, size * 1.45); ctx.clip();
        ctx.globalAlpha = A * clamp01((lt - delay) / 0.12);
        ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8;
        ctx.fillText(t2, left, y + (1 - s) * size * 1.3);
        ctx.restore();
        y += size * 1.18;
      };
      ctx.save();
      const ac = '#3EE8B5';
      // vạch màu nhấn dọc bên trái
      const pv = ease.out(clamp01(lt / 0.5));
      ctx.globalAlpha = A; ctx.fillStyle = ac;
      ctx.fillRect(safe.x + 2 * k, y - 30 * k, 5 * k, 300 * k * pv);
      ctx.restore();
      if (L.l1) rise(L.l1, 54 * k, `800 ${54 * k}px ${BODY}`, '#FFFFFF', 0);
      if (L.l2) rise(L.l2, 28 * k, `600 ${28 * k}px ${BODY}`, 'rgba(255,255,255,0.85)', 0.1);
      y += 24 * k;
      rise(L.label.toUpperCase(), 18 * k, `700 ${18 * k}px ${BODY}`, ac, 0.28);
      y += 6 * k;
      const sb = 96 * k;
      ctx.save();
      ctx.font = `800 ${sb}px ${BODY}`;
      const scale = Math.min(1, maxW / Math.max(1, ctx.measureText(L.big).width));
      ctx.restore();
      y += sb * scale * 0.42; // chừa nửa trên của chữ giá, không đè dòng "GIÁ BÁN"
      const yBig = y;
      rise(L.isPrice ? countUp(L.big, clamp01((lt - 0.38) / 0.7)) : L.big, sb * scale, `800 ${sb * scale}px ${BODY}`, '#FFFFFF', 0.38);
      // thanh màu chạy dưới giá
      ctx.save();
      ctx.font = `800 ${sb * scale}px ${BODY}`;
      const bw = ctx.measureText(L.big).width;
      ctx.globalAlpha = A; ctx.fillStyle = ac;
      ctx.fillRect(left, yBig + sb * scale * 0.5, bw * ease.expo(clamp01((lt - 0.7) / 0.5)), 6 * k);
      ctx.restore();
      y += 26 * k;
      L.subs.forEach((s, i) => rise(s, 24 * k, `600 ${24 * k}px ${BODY}`, '#FFFFFF', 0.8 + i * 0.12));
    },
    title(ctx, e) {
      const { LW, safe, lt, A, k, text, sub } = e;
      const maxW = LW - safe.x * 2 - 30;
      ctx.save();
      ctx.font = `800 ${32 * k}px ${BODY}`;
      const t2 = fitText(ctx, text, maxW);
      const y = e.top + 22 * k, size = 32 * k;
      const s = spring(lt, { stiffness: 210, damping: 22 });
      ctx.save();
      ctx.beginPath(); ctx.rect(0, y - size * 0.75, LW, size * 1.45); ctx.clip();
      ctx.globalAlpha = A; ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10;
      ctx.fillText(t2, LW / 2, y + (1 - s) * size * 1.3);
      ctx.restore();
      const w = ctx.measureText(t2).width;
      ctx.globalAlpha = A; ctx.fillStyle = '#3EE8B5';
      ctx.fillRect(LW / 2 - (w / 2) * ease.expo(clamp01((lt - 0.3) / 0.5)), y + size * 0.62, w * ease.expo(clamp01((lt - 0.3) / 0.5)), 4 * k);
      if (sub) {
        ctx.globalAlpha = A * clamp01((lt - 0.45) / 0.35); ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `600 ${15 * k}px ${BODY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6;
        ctx.fillText(fitText(ctx, sub, maxW), LW / 2, y + size * 0.62 + 24 * k);
      }
      ctx.restore();
    },
  },
};
export const MOTION_KEYS = Object.keys(MOTION);

// Vẽ thẻ mở đầu / tiêu đề theo gói (render.js gọi)
export function motionHook(ctx, key, env) {
  const m = MOTION[key];
  if (!m) return false;
  ctx.save(); m.hook(ctx, env); ctx.restore();
  return true;
}
export function motionTitle(ctx, key, env) {
  const m = MOTION[key];
  if (!m || !env.text) return false;
  ctx.save(); m.title(ctx, env); ctx.restore();
  return true;
}

// ---------- Từ khoá bật lên theo giọng đọc (giá, cách nhà bao nhiêu mét, số phút…) ----------
// e: { x, y (tâm), lt (giây từ lúc bật), dur (giây hiện), A, k, text, kicker, kind }
const POP_FONT = {
  denvang: s => `900 ${s}px ${HEAD}`, khoi: s => `900 ${s}px ${HEAD}`,
  tapchi: s => `700 ${s}px ${SERIF}`, hiendai: s => `800 ${s}px ${BODY}`,
};
function popSizes(ctx, key, e, maxW) {
  const f = POP_FONT[key] || POP_FONT.denvang;
  const big = fitSize(ctx, e.text, f, (e.kind === 'price' ? 64 : 54) * e.k, 0.02, maxW - 40 * e.k);
  const kick = e.kicker ? 17 * e.k : 0;
  ctx.font = f(big);
  const tw = charsOf(ctx, e.text, big * 0.02).total;
  return { f, big, kick, tw, w: tw + 44 * e.k, h: big * 1.18 + (kick ? kick * 1.9 : 0) + 18 * e.k };
}
export function keyPopBox(ctx, key, e, maxW) {
  const s = popSizes(ctx, key, e, maxW);
  return { w: s.w, h: s.h };
}
export function keyPop(ctx, key, e, maxW) {
  if (!MOTION[key]) return;
  const { x, y, lt, dur, k } = e;
  const out = clamp01((lt - (dur - 0.28)) / 0.28);           // rút ra cuối
  const A = e.A * clamp01(lt / 0.08) * (1 - out);
  if (A <= 0.01) return;
  const S = popSizes(ctx, key, e, maxW);
  const sp = spring(lt, { stiffness: 260, damping: 15 });      // nảy vào
  const sc = (0.55 + 0.45 * sp) * (1 - 0.12 * out);
  const by = y + (S.kick ? S.kick * 0.95 : 0);                  // tâm chữ to
  const ky = y - S.h / 2 + S.kick * 0.7 + 4 * k;                // dòng nhỏ phía trên
  ctx.save();
  ctx.translate(x, y); ctx.scale(sc, sc); ctx.translate(-x, -y);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (key === 'khoi') {
    const p = ease.expo(clamp01(lt / 0.3));
    ctx.save(); ctx.translate(x, by); ctx.rotate(-0.035);
    ctx.globalAlpha = A; ctx.fillStyle = '#FFD400';
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    ctx.fillRect(-S.w / 2, -S.big * 0.62, S.w * p, S.big * 1.24);
    ctx.shadowColor = 'transparent';
    ctx.font = S.f(S.big); ctx.fillStyle = '#101010';
    ctx.fillText(e.text, 0, S.big * 0.05);
    ctx.restore();
    if (S.kick) {
      ctx.font = `800 ${S.kick}px ${BODY}`;
      const kw = ctx.measureText(e.kicker).width + 18 * k;
      ctx.globalAlpha = A; ctx.fillStyle = '#101010';
      ctx.fillRect(x - S.w / 2, ky - S.kick * 0.75, kw, S.kick * 1.5);
      ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left';
      ctx.fillText(e.kicker, x - S.w / 2 + 9 * k, ky);
    }
  } else {
    // nền mờ tối phía sau để chữ luôn đọc rõ trên ảnh vệ tinh
    const g = ctx.createRadialGradient(x, y, 4, x, y, Math.max(S.w, S.h) * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0.62)'); g.addColorStop(0.6, 'rgba(0,0,0,0.36)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = A; ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, S.w * 0.62, S.h * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 10;
    if (S.kick) {
      ctx.font = key === 'tapchi' ? `italic 500 ${S.kick * 1.15}px ${SERIF}` : `700 ${S.kick}px ${BODY}`;
      ctx.globalAlpha = A * clamp01((lt - 0.05) / 0.2);
      ctx.fillStyle = key === 'hiendai' ? '#3EE8B5' : key === 'tapchi' ? '#F7F1E6' : '#F4EFE6';
      const kk = key === 'tapchi' ? e.kicker : e.kicker.toUpperCase();
      if (key === 'tapchi') ctx.fillText(kk, x, ky);
      else {
        ctx.font = `700 ${S.kick}px ${BODY}`;
        const { cs, ws, total } = charsOf(ctx, kk, S.kick * 0.18);
        let cx = x - total / 2; ctx.textAlign = 'left';
        for (let i = 0; i < cs.length; i++) { ctx.fillText(cs[i], cx, ky); cx += ws[i]; }
        ctx.textAlign = 'center';
      }
    }
    ctx.globalAlpha = A;
    ctx.font = S.f(S.big);
    // viền tối mảnh dưới chữ để chữ vàng/trắng không chìm vào nền ảnh vệ tinh sáng
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, S.big * 0.07); ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(e.text, x, by);
    ctx.fillStyle = key === 'hiendai' ? '#FFFFFF' : key === 'tapchi' ? goldGrad(ctx, by, S.big) : goldGrad(ctx, by, S.big);
    ctx.fillText(e.text, x, by);
    ctx.shadowColor = 'transparent';
    if (key !== 'hiendai') sheen(ctx, e.text, x, by, S.big, S.f, 0, (lt - 0.25) / 0.55, A);
    const ly = by + S.big * 0.6;
    if (key === 'hiendai') {
      ctx.globalAlpha = A; ctx.fillStyle = '#3EE8B5';
      const bw = S.tw * ease.expo(clamp01((lt - 0.12) / 0.4));
      ctx.fillRect(x - bw / 2, ly, bw, 4 * k);
    } else hairline(ctx, x, ly, S.tw * 0.55, clamp01((lt - 0.1) / 0.45), '#D9B26F', A, key === 'tapchi' ? 9 * k : 0);
  }
  ctx.restore();
}

// Tìm từ khoá ngắn quan trọng trong câu đọc → [{ i (vị trí ký tự), len, text, kicker, kind, rank }]
const KEY_RULES = [
  { kind: 'price', rank: 0, re: /(\d+(?:[.,]\d+)?)\s*(tỷ|tỉ)(?:\s*(\d{1,3})(?!\s*(?:m(?![\p{L}\d])|mét|km|phút))(\s*triệu)?)?/giu,
    fmt: m => (m[1] + ' TỶ' + (m[3] ? ' ' + m[3] + (m[4] ? ' TRIỆU' : '') : '')), kick: 'Giá chỉ' },
  { kind: 'price', rank: 0, re: /(\d+(?:[.,]\d+)?)\s*triệu(\s*\/\s*m(?:²|2))?/giu, fmt: m => m[1] + ' TRIỆU' + (m[2] ? '/M²' : ''), kick: 'Giá chỉ' },
  { kind: 'size', rank: 2, re: /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(?:m(?![\p{L}\d])|mét)?/giu, fmt: m => `${m[1]}×${m[2]} M`, kick: 'Diện tích' },
  { kind: 'area', rank: 2, re: /(\d+(?:[.,]\d+)?)\s*(?:m²|m2(?![\p{L}\d])|mét vuông)/giu, fmt: m => m[1] + ' M²', kick: 'Diện tích' },
  { kind: 'time', rank: 1, re: /(\d+)\s*phút/giu, fmt: m => m[1] + ' PHÚT', kick: 'Chỉ' },
  { kind: 'dist', rank: 1, re: /(\d+(?:[.,]\d+)?)\s*(km|ki-lô-mét|cây số|mét|m)(?![²\p{L}\d])/giu,
    fmt: m => m[1] + (/^m|mét$/i.test(m[2]) ? ' M' : ' KM'), kick: 'Cách nhà' },
  { kind: 'legal', rank: 3, re: /sổ hồng riêng|sổ đỏ riêng|sổ hồng|sổ đỏ|full thổ cư|thổ cư 100\s*%/gi, fmt: m => m[0].toUpperCase(), kick: 'Pháp lý' },
  { kind: 'beds', rank: 4, re: /(\d+)\s*phòng ngủ/gi, fmt: m => m[1] + ' PHÒNG NGỦ', kick: '' },
  { kind: 'furn', rank: 4, re: /full nội thất|đầy đủ nội thất|nội thất (?:đầy đủ|cao cấp|hiện đại|gỗ|xịn)|nội thất/giu, fmt: m => m[0].toUpperCase(), kick: '' },
  { kind: 'floors', rank: 4, re: /1\s*trệt\s*(\d+)\s*(lầu|tầng)/gi, fmt: m => `1 TRỆT ${m[1]} ${m[2].toUpperCase()}`, kick: '' },
];
export function findKeywords(text) {
  const s = String(text || '').normalize('NFC');
  const out = [];
  for (const r of KEY_RULES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(s))) {
      if (out.some(o => m.index < o.i + o.len && o.i < m.index + m[0].length)) continue; // đã có từ khoá chồng lên
      let kick = r.kick;
      const before = s.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
      if (r.kind === 'dist' && /bán kính\s*$/.test(before)) kick = 'Bán kính';
      if (r.kind === 'dist' && /chỉ\s*(cách\s*)?$/.test(before)) kick = 'Chỉ cách';
      if (r.kind === 'time' && !/chỉ|khoảng|mất/.test(before)) kick = '';
      if (r.kind === 'price') kick = /chỉ\s*$/.test(before) ? 'Giá chỉ' : 'Giá bán';
      out.push({ i: m.index, len: m[0].length, text: r.fmt(m), kicker: kick, kind: r.kind, rank: r.rank });
    }
  }
  return out.sort((a, b) => a.i - b.i);
}
