// Xử lý ảnh mặt bằng phân lô ngay trên máy khách (không gửi ảnh lên máy chủ, không tốn tiền):
// 1) Cắt & nắn 4 góc: ảnh chụp xiên bản vẽ giấy → phép chiếu phối cảnh (homography) đưa tứ giác về hình chữ nhật.
// 2) Tự cân sáng (levels): kéo giãn độ sáng để nét vẽ đậm, giấy trắng hẳn → mặt bằng rõ hơn trên nền vệ tinh.
// 3) Làm trong phần nền trắng: điểm gần màu giấy (so với độ sáng giấy QUANH điểm đó, chịu được ảnh chụp sáng không đều)
//    và ít màu → trong suốt; lô tô màu, nét vẽ, chữ số vẫn giữ.
// 4) Khoanh vùng dự án: ngoài đa giác khách chạm → trong suốt (bỏ khung tên, chú thích, la bàn, dự án bên cạnh).

export const FULL_QUAD = [[0, 0], [1, 0], [1, 1], [0, 1]]; // TL, TR, BR, BL (tỉ lệ theo ảnh gốc)

export function isFullQuad(q) {
  return !q || q.every((p, i) => Math.abs(p[0] - FULL_QUAD[i][0]) < 1e-4 && Math.abs(p[1] - FULL_QUAD[i][1]) < 1e-4);
}

// Hình vuông đơn vị (u,v) → tứ giác p0..p3 (Heckbert): (0,0)→p0, (1,0)→p1, (1,1)→p2, (0,1)→p3
function squareToQuad(p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return {
    a: x1 - x0 + g * x1, b: x3 - x0 + h * x3, c: x0,
    d: y1 - y0 + g * y1, e: y3 - y0 + h * y3, f: y0, g, h,
  };
}

// Kích thước ra (giữ đúng tỉ lệ chiều dài các cạnh của tứ giác trên ảnh gốc)
// Tỉ lệ ngang/dọc THẬT của tờ giấy từ ảnh chụp xiên (Zhang & He 2006, ước lượng tiêu cự từ 4 góc,
// tâm quang học = giữa ảnh). Ảnh gần như chụp thẳng (không ước lượng được) → null.
function trueAspect(P, sw, sh) {
  const c = ([x, y]) => [x - sw / 2, y - sh / 2, 1];
  const [m1, m2, m4, m3] = P.map(c); // TL=(0,0) TR=(w,0) BR=(w,h) BL=(0,h)
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c14 = cross(m1, m4);
  const k2 = dot(c14, m3) / dot(cross(m2, m4), m3);
  const k3 = dot(c14, m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]), n3 = m3.map((v, i) => k3 * v - m1[i]);
  if (Math.abs(n2[2]) < 1e-6 || Math.abs(n3[2]) < 1e-6) return null;
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  if (!(f2 > 0) || !Number.isFinite(f2)) return null;
  const r = Math.sqrt((n2[0] ** 2 + n2[1] ** 2 + n2[2] ** 2 * f2) / (n3[0] ** 2 + n3[1] ** 2 + n3[2] ** 2 * f2));
  return Number.isFinite(r) && r > 0.05 && r < 20 ? r : null;
}

export function quadSize(quad, sw, sh, maxSide) {
  const P = quad.map(([u, v]) => [u * sw, v * sh]);
  const d = (a, b) => Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
  let W = Math.max(d(0, 1), d(3, 2)), H = Math.max(d(0, 3), d(1, 2));
  const r = trueAspect(P, sw, sh);
  // Chỉ tin ước lượng khi ảnh xiên rõ (cạnh đối lệch > 3%) và không quá xa tỉ lệ đo cạnh
  const skew = Math.abs(d(0, 1) - d(3, 2)) / Math.max(d(0, 1), d(3, 2)) + Math.abs(d(0, 3) - d(1, 2)) / Math.max(d(0, 3), d(1, 2));
  if (r && skew > 0.03 && r / (W / H) > 0.6 && r / (W / H) < 1.7) { const m = Math.max(W, H); W = r >= 1 ? m : m * r; H = r >= 1 ? m / r : m; }
  const k = Math.min(1, maxSide / Math.max(W, H, 1));
  return { W: Math.max(8, Math.round(W * k)), H: Math.max(8, Math.round(H * k)) };
}

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Dựng ảnh mặt bằng đã xử lý.
 * @param {HTMLImageElement|HTMLCanvasElement} raw ảnh gốc (đã thu ≤ 2400 px)
 * @param {{quad?:number[][], mask?:number[][]|null, white?:boolean, levels?:boolean}} edit
 * @param {number} maxSide cạnh dài tối đa ảnh ra
 * @returns {HTMLCanvasElement}
 */
export function processPlan(raw, edit = {}, maxSide = 2400) {
  const sw = raw.naturalWidth || raw.width, sh = raw.naturalHeight || raw.height;
  const quad = edit.quad && edit.quad.length === 4 ? edit.quad : FULL_QUAD;
  const { W, H } = quadSize(quad, sw, sh, maxSide);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const o = out.getContext('2d', { willReadFrequently: true });

  if (isFullQuad(quad)) {
    o.imageSmoothingQuality = 'high';
    o.drawImage(raw, 0, 0, W, H);
  } else {
    // Lấy điểm ảnh gốc rồi chiếu ngược từng điểm ra (nội suy song tuyến)
    const sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    const sg = sc.getContext('2d', { willReadFrequently: true });
    sg.drawImage(raw, 0, 0);
    const src = sg.getImageData(0, 0, sw, sh).data;
    const M = squareToQuad(quad.map(([u, v]) => [u * (sw - 1), v * (sh - 1)]));
    const dst = o.createImageData(W, H);
    const D = dst.data;
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const z = M.g * u + M.h * v + 1;
        let X = (M.a * u + M.b * v + M.c) / z, Y = (M.d * u + M.e * v + M.f) / z;
        if (X < 0) X = 0; else if (X > sw - 1.001) X = sw - 1.001;
        if (Y < 0) Y = 0; else if (Y > sh - 1.001) Y = sh - 1.001;
        const x0 = X | 0, y0 = Y | 0, fx = X - x0, fy = Y - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        const k = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
          const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
          D[k + c] = top + (bot - top) * fy;
        }
        D[k + 3] = 255;
      }
    }
    o.putImageData(dst, 0, 0);
  }

  const img = o.getImageData(0, 0, W, H);
  const A = img.data, N = W * H;

  // Tự cân sáng: lấy 1% tối nhất → đen, 0,5% sáng nhất → trắng (cùng hệ số cho cả 3 kênh để không lệch màu)
  if (edit.levels !== false) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < N; i += 3) { const k = i * 4; hist[lum(A[k], A[k + 1], A[k + 2]) | 0]++; }
    const tot = hist.reduce((s, x) => s + x, 0);
    let acc = 0, lo = 0, hi = 255;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= tot * 0.01) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= tot * 0.005) { hi = i; break; } }
    if (hi - lo > 40 && (lo > 4 || hi < 250)) {
      const k = 255 / (hi - lo);
      for (let i = 0; i < A.length; i += 4) {
        A[i] = (A[i] - lo) * k; A[i + 1] = (A[i + 1] - lo) * k; A[i + 2] = (A[i + 2] - lo) * k;
      }
    }
  }

  // Làm trong nền trắng: so với độ sáng GIẤY quanh điểm (lưới ô lấy điểm sáng nhất, mở rộng + làm mịn)
  if (edit.white) {
    const cs = Math.max(12, Math.round(Math.max(W, H) / 40));
    const gw = Math.ceil(W / cs), gh = Math.ceil(H / cs);
    let grid = new Float32Array(gw * gh);
    for (let y = 0; y < H; y += 2) {
      const gy = (y / cs) | 0;
      for (let x = 0; x < W; x += 2) {
        const k = (y * W + x) * 4;
        const L = lum(A[k], A[k + 1], A[k + 2]);
        const gi = gy * gw + ((x / cs) | 0);
        if (L > grid[gi]) grid[gi] = L;
      }
    }
    // Ô kín nét vẽ (không có giấy) → mượn ô sáng hơn bên cạnh; rồi làm mịn
    const pass = (fn) => { const ng = new Float32Array(grid.length); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) ng[y * gw + x] = fn(x, y); grid = ng; };
    const at = (x, y) => grid[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))];
    pass((x, y) => { let m = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) m = Math.max(m, at(x + i, y + j)); return m; });
    pass((x, y) => { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(x + i, y + j); return s / 9; });
    for (let y = 0; y < H; y++) {
      const fy = Math.min(gh - 1.001, Math.max(0, y / cs - 0.5));
      const y0 = fy | 0, ty = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(gw - 1.001, Math.max(0, x / cs - 0.5));
        const x0 = fx | 0, tx = fx - x0;
        const g00 = grid[y0 * gw + x0], g10 = grid[y0 * gw + x0 + 1] ?? g00;
        const g01 = grid[(y0 + 1) * gw + x0] ?? g00, g11 = grid[(y0 + 1) * gw + x0 + 1] ?? g01;
        const bg = Math.max(60, (g00 + (g10 - g00) * tx) * (1 - ty) + (g01 + (g11 - g01) * tx) * ty);
        const k = (y * W + x) * 4;
        const r = A[k], g = A[k + 1], b = A[k + 2];
        const L = lum(r, g, b) / bg;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const aWhite = Math.min(1, Math.max(0, (0.93 - L) / 0.1)); // L ≥ 0,93 → trong suốt, ≤ 0,83 → giữ
        const aColor = Math.min(1, Math.max(0, (sat - 22) / 22));   // có màu (lô tô màu) → giữ
        A[k + 3] = 255 * Math.max(aWhite, aColor);
      }
    }
  }
  o.putImageData(img, 0, 0);

  // Khoanh vùng dự án: chỉ giữ phần trong đa giác
  if (edit.mask && edit.mask.length >= 3) {
    o.save();
    o.globalCompositeOperation = 'destination-in';
    o.beginPath();
    edit.mask.forEach(([u, v], i) => (i ? o.lineTo(u * W, v * H) : o.moveTo(u * W, v * H)));
    o.closePath();
    o.fillStyle = '#000';
    o.fill();
    o.restore();
  }
  return out;
}

// Ảnh có phần trong suốt thì phải lưu PNG (JPEG mất kênh alpha)
export function planNeedsAlpha(edit) {
  return !!(edit && (edit.white || (edit.mask && edit.mask.length >= 3)));
}
