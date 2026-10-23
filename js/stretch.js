// Co giãn thời lượng giọng đọc mà KHÔNG đổi cao độ (WSOLA), chạy ngay trên máy khách.
// Dùng khi khách đổi "Tốc độ đọc": giọng đã tạo được co/giãn lại thay vì phải gọi lại máy chủ giọng
// (không tốn lượt, không mất giọng). Chênh lệch nhỏ (±10–20%) nên giọng vẫn tự nhiên.

function makeBuffer(channels, length, sampleRate) {
  try { return new AudioBuffer({ numberOfChannels: channels, length, sampleRate }); }
  catch { return new OfflineAudioContext(channels, Math.max(1, length), sampleRate).createBuffer(channels, Math.max(1, length), sampleRate); }
}

// factor > 1: dài ra (đọc chậm hơn); factor < 1: ngắn lại (đọc nhanh hơn)
export function stretchBuffer(buf, factor) {
  if (!buf || !(factor > 0) || Math.abs(factor - 1) < 0.005) return buf;
  const sr = buf.sampleRate;
  const N = buf.length;
  const win = Math.max(256, Math.round(sr * 0.04)) & ~1; // khung 40 ms
  const Hs = win / 2;                                     // bước ghép (chồng 50%)
  const Ha = Hs / factor;                                 // bước đọc trên file gốc
  const tol = Math.round(sr * 0.012);                     // dò lệch ±12 ms cho khớp sóng
  const outLen = Math.max(1, Math.round(N * factor));
  const chans = buf.numberOfChannels;
  const src = [], dst = [];
  for (let c = 0; c < chans; c++) { src.push(buf.getChannelData(c)); dst.push(new Float32Array(outLen + win)); }
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
  const x = src[0];
  let prev = 0; // vị trí khung đã dùng ở bước trước (trên file gốc)
  for (let k = 0, outPos = 0; outPos < outLen; k++, outPos += Hs) {
    const nominal = Math.round(k * Ha);
    let best = nominal;
    if (k > 0) {
      // phần "nối tự nhiên" của khung trước: prev + Hs; tìm khung gần nominal giống nó nhất
      const ref = prev + Hs;
      let bestScore = -Infinity;
      const lo = Math.max(0, nominal - tol), hi = Math.min(N - win, nominal + tol);
      // dò thưa (bước 3 mẫu, so 1/6 số mẫu) cho nhanh trên điện thoại — đủ chính xác với giọng nói
      for (let d = lo; d <= hi; d += 3) {
        let s = 0;
        for (let i = 0; i < Hs; i += 6) {
          const a = ref + i < N ? x[ref + i] : 0;
          const b = d + i < N ? x[d + i] : 0;
          s += a * b;
        }
        if (s > bestScore) { bestScore = s; best = d; }
      }
      if (!(hi >= lo)) best = Math.min(Math.max(0, nominal), Math.max(0, N - 1));
    }
    prev = best;
    for (let c = 0; c < chans; c++) {
      const S = src[c], D = dst[c];
      for (let i = 0; i < win; i++) {
        const j = best + i;
        if (j >= N) break;
        D[outPos + i] += S[j] * hann[i];
      }
    }
  }
  // Đoạn đầu chỉ có nửa cửa sổ Hann → bù biên độ cho khỏi nhỏ tiếng ở vài ms đầu
  for (let c = 0; c < chans; c++) {
    const D = dst[c];
    for (let i = 0; i < Hs && i < outLen; i++) { const w = hann[i]; if (w > 0.05) D[i] /= w; }
  }
  const out = makeBuffer(chans, outLen, sr);
  for (let c = 0; c < chans; c++) out.copyToChannel ? out.copyToChannel(dst[c].subarray(0, outLen), c) : out.getChannelData(c).set(dst[c].subarray(0, outLen));
  return out;
}
