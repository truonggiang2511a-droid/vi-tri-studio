// Tách nền ảnh chân dung của sale ngay trên máy khách (5/11/2026, khách góp ý: ảnh sale không nền + SĐT cuối video).
// Gói riêng site/tachnen.js — CHỈ tải khi khách chọn ảnh sale (không làm nặng app). Không gửi ảnh lên máy chủ nào.
// MediaPipe Tasks Vision (Apache-2.0): WASM tự host ở /mp/, mô hình chân dung tự host ở /mp/ (xem build.sh).
import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';

// selfie_segmenter float16 (~250 KB): đo 5/11 nhanh gấp ~20 lần bản nhiều lớp (16 MB) mà viền tóc/áo tương đương
export const MODEL_URL = '/mp/selfie_segmenter.tflite';
let segP = null;

async function make(delegate) {
  const files = await FilesetResolver.forVisionTasks('/mp');
  return ImageSegmenter.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'IMAGE',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
}
function getSeg() {
  if (!segP) segP = make('GPU').catch(() => make('CPU'));
  segP.catch(() => { segP = null; });   // lỗi mạng: lần sau thử lại
  return segP;
}

// Ảnh đã có nền trong suốt sẵn (PNG tách nền) → không cần tách nữa
export function hasAlpha(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = cv;
  const d = g.getImageData(0, 0, w, h).data;
  let edge = 0, clear = 0;
  const look = (x, y) => { edge++; if (d[(y * w + x) * 4 + 3] < 128) clear++; };
  for (let x = 0; x < w; x += 2) { look(x, 0); look(x, h - 1); }
  for (let y = 0; y < h; y += 2) { look(0, y); look(w - 1, y); }
  return clear / Math.max(1, edge) > 0.3;
}

// Khối liền lớn nhất (theo ô mặt nạ, độ chắc người > 0,5), nới thêm 2 ô để không gọt mất viền mềm
function mainBlob(bg, mw, mh) {
  const lab = new Int32Array(mw * mh), sizes = [0];
  let best = 0;
  for (let i = 0; i < mw * mh; i++) {
    if (lab[i] || bg[i] >= 0.5) continue;
    const id = sizes.length; let n = 0;
    const st = [i]; lab[i] = id;
    while (st.length) {
      const j = st.pop(); n++;
      const x = j % mw, y = (j / mw) | 0;
      for (const k of [x > 0 ? j - 1 : -1, x < mw - 1 ? j + 1 : -1, y > 0 ? j - mw : -1, y < mh - 1 ? j + mw : -1]) {
        if (k >= 0 && !lab[k] && bg[k] < 0.5) { lab[k] = id; st.push(k); }
      }
    }
    sizes.push(n);
    if (n > sizes[best] || !best) best = id;
  }
  const keep = new Uint8Array(mw * mh);
  if (!best) return keep;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (lab[y * mw + x] !== best) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < mw && yy < mh) keep[yy * mw + xx] = 1;
    }
  }
  return keep;
}

// cv: canvas ảnh gốc (đã thu nhỏ). Trả về canvas mới có nền trong suốt, cắt sát người (chừa lề).
export async function cutPortrait(cv) {
  const seg = await getSeg();
  const w = cv.width, h = cv.height;
  const res = seg.segment(cv);
  const masks = res.confidenceMasks || [];
  if (!masks.length) throw new Error('Không nhận ra người trong ảnh');
  // 1 mặt nạ = độ chắc là NGƯỜI; nhiều mặt nạ (mô hình nhiều lớp) = lớp 0 là nền
  const raw = masks[0].getAsFloat32Array();
  const mw = masks[0].width, mh = masks[0].height;
  const bg = masks.length > 1 ? raw : raw.map(v => 1 - v);
  // Chỉ giữ khối người lớn nhất (bỏ đốm lẻ nhận nhầm ở nền: cờ, tranh treo tường…)
  const keep = mainBlob(bg, mw, mh);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d', { willReadFrequently: true });
  g.drawImage(cv, 0, 0);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, solid = 0;
  // Lấy mẫu song tuyến (mặt nạ 256 px phóng lên mà viền không bậc thang)
  const at = (fx, fy) => {
    const xa = Math.max(0, Math.min(mw - 1, fx)), ya = Math.max(0, Math.min(mh - 1, fy));
    const xi = Math.floor(xa), yi = Math.floor(ya), xb = Math.min(mw - 1, xi + 1), yb = Math.min(mh - 1, yi + 1);
    const tx = xa - xi, ty = ya - yi;
    const top = bg[yi * mw + xi] * (1 - tx) + bg[yi * mw + xb] * tx;
    const bot = bg[yb * mw + xi] * (1 - tx) + bg[yb * mw + xb] * tx;
    return top * (1 - ty) + bot * ty;
  };
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * mh / h - 0.5;
    for (let x = 0; x < w; x++) {
      const cx = Math.min(mw - 1, Math.floor(x * mw / w)), cy = Math.min(mh - 1, Math.floor(y * mh / h));
      const p = keep[cy * mw + cx] ? 1 - at((x + 0.5) * mw / w - 0.5, fy) : 0;
      // viền mềm: 0,3 → 0,7 chuyển dần (không răng cưa, không quầng nền)
      const a = p <= 0.3 ? 0 : p >= 0.7 ? 1 : (p - 0.3) / 0.4;
      const i = (y * w + x) * 4;
      d[i + 3] = Math.round(d[i + 3] * a);
      if (a > 0.5) { solid++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  masks.forEach(m => m.close && m.close());
  if (solid < w * h * 0.03) throw new Error('Không nhận ra người trong ảnh');
  g.putImageData(img, 0, 0);
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  const cx0 = Math.max(0, x0 - m), cy0 = Math.max(0, y0 - m), cx1 = Math.min(w, x1 + m + 1), cy1 = Math.min(h, y1 + 1);
  const crop = document.createElement('canvas');
  crop.width = cx1 - cx0; crop.height = cy1 - cy0;
  crop.getContext('2d').drawImage(out, cx0, cy0, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return crop;
}
