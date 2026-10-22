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

// Cắt theo mốc thời gian khách bấm "Câu tiếp" lúc thu âm: mỗi mốc dời về chỗ lặng nhất trong ±0,6 giây
// (người đọc thường bấm hơi sớm hoặc hơi trễ), rồi bỏ khoảng lặng thừa ở hai đầu mỗi câu.
export function splitAt(buf, marks) {
  const sr = buf.sampleRate;
  const data = buf.getChannelData(0);
  const hop = Math.max(1, Math.round(sr * 0.01));
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
  const cuts = [];
  let prev = 0;
  for (const m of marks) {
    const c = Math.round(m * 100);
    let best = Math.min(n - 1, Math.max(prev + 10, c)), bestV = Infinity;
    for (let i = Math.max(prev + 10, c - 60); i <= Math.min(n - 1, c + 60); i++) {
      // ưu tiên chỗ lặng, gần mốc bấm
      let v = 0;
      for (let k = -3; k <= 3; k++) v += rms[Math.max(0, Math.min(n - 1, i + k))];
      v += Math.abs(i - c) * loud * 0.004;
      if (v < bestV) { bestV = v; best = i; }
    }
    cuts.push(best);
    prev = best;
  }
  const edges = [0, ...cuts, n];
  const out = [];
  for (let k = 0; k < edges.length - 1; k++) {
    let a = edges[k], b = edges[k + 1];
    while (a < b - 1 && rms[a] < thr) a++;
    while (b > a + 1 && rms[b - 1] < thr) b--;
    a = Math.max(0, a - 6);
    b = Math.min(n, b + 12);
    out.push(sliceBuffer(buf, a * hop, Math.min(data.length, b * hop)));
  }
  return out;
}

// Ghép các câu thành một lời đọc liền, mỗi câu kết thúc bằng dấu chấm và xuống đoạn để có nhịp nghỉ rõ
export function joinForTts(parts) {
  return parts.map(p => {
    const t = String(p).replace(/\s+/g, ' ').trim().replace(/[\s,;:–-]+$/, '');
    return /[.!?…]$/.test(t) ? t : t + '.';
  }).join('\n\n');
}
