// Cắt một file giọng đọc liền mạch (cả kịch bản trong một lần gọi) thành từng câu theo cảnh.
// Cách làm: tìm các khoảng lặng, ước lượng vị trí ranh giới theo số chữ của từng câu,
// rồi chọn khoảng lặng dài nhất nằm gần vị trí ước lượng đó.

function sliceBuffer(buf, from, to) {
  const len = Math.max(1, to - from);
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: len, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(from, from + len), c);
  return out;
}

// Độ dài đọc tương đối của một câu: số đọc thành nhiều âm tiết hơn chữ thường
function weightOf(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const digits = (t.match(/\d/g) || []).length;
  const stops = (t.match(/[,.;:!?…]/g) || []).length;
  return Math.max(6, t.length + digits * 2.5 + stops * 3);
}

export function splitVoice(buf, parts) {
  if (parts.length <= 1) return [buf];
  const sr = buf.sampleRate;
  const data = buf.getChannelData(0);
  const hop = Math.max(1, Math.round(sr * 0.01)); // khung 10 ms
  const n = Math.floor(data.length / hop);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop, e = j + hop; j < e; j++) s += data[j] * data[j];
    rms[i] = Math.sqrt(s / hop);
  }
  const sorted = Array.from(rms).sort((x, y) => x - y);
  const loud = sorted[Math.floor(n * 0.9)] || 0.05;
  const thr = Math.max(0.003, loud * 0.08);
  let a = 0; while (a < n && rms[a] < thr) a++;
  let b = n - 1; while (b > a && rms[b] < thr) b--;
  if (b - a < 20) return parts.map(() => buf);

  // Các khoảng lặng ≥ 80 ms trong phần có tiếng
  const runs = [];
  for (let i = a; i <= b; i++) {
    if (rms[i] >= thr) continue;
    let j = i;
    while (j <= b && rms[j] < thr) j++;
    if (j - i >= 8) runs.push({ mid: (i + j) / 2, len: j - i });
    i = j;
  }
  const w = parts.map(weightOf);
  const total = w.reduce((x, y) => x + y, 0);
  const span = b - a;
  const cuts = [];
  let cum = 0, prev = a;
  for (let k = 0; k < parts.length - 1; k++) {
    cum += w[k];
    const expect = a + span * cum / total;
    const win = Math.max(45, span * Math.min(w[k], w[k + 1]) / total * 0.6);
    let best = null;
    for (const r of runs) {
      if (r.mid <= prev + 25) continue;
      const d = Math.abs(r.mid - expect);
      if (d > win) continue;
      const score = r.len - d * 0.3;
      if (!best || score > best.score) best = { mid: r.mid, score };
    }
    const cut = Math.max(prev + 25, best ? best.mid : expect);
    cuts.push(cut);
    prev = cut;
  }
  const edges = [a, ...cuts, b + 1];
  return parts.map((_, k) => {
    let s = Math.floor(edges[k]), e = Math.ceil(edges[k + 1]);
    while (s < e - 1 && rms[s] < thr) s++;
    while (e > s + 1 && rms[e - 1] < thr) e--;
    s = Math.max(0, s - 5);
    e = Math.min(n, e + 10);
    return sliceBuffer(buf, s * hop, Math.min(data.length, e * hop));
  });
}

// Ghép các câu thành một lời đọc liền, mỗi câu kết thúc bằng dấu chấm và xuống đoạn để có nhịp nghỉ rõ
export function joinForTts(parts) {
  return parts.map(p => {
    const t = String(p).replace(/\s+/g, ' ').trim().replace(/[\s,;:–-]+$/, '');
    return /[.!?…]$/.test(t) ? t : t + '.';
  }).join('\n\n');
}
