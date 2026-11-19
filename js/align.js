// Khớp lời kịch bản với chữ Whisper nghe được (19/11, đang thử — chỉ chạy khi bật ?align=1).
// Whisper (/api/align) trả từng chữ nghe được kèm giây bắt đầu/kết thúc. Lời hiển thị (phụ đề) và chữ Whisper viết
// có thể tách chữ khác nhau ("3,2" ↔ "3" ",2"; "TP.HCM" ↔ "TP" ".HCM") nên khớp theo TỪNG KÝ TỰ chữ/số (bỏ dấu, bỏ dấu câu)
// bằng quy hoạch động; chữ hiển thị nào khớp được thì lấy giờ của ký tự đầu, không khớp thì nội suy giữa 2 chữ khớp gần nhất.
// Chữ có số / tên riêng mà phần lớn ký tự KHÔNG khớp → nghi giọng đọc sai, báo khách xem lại.

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const keepChars = s => Array.from(fold(s)).filter(c => /[a-z0-9]/.test(c));

export const displayTokens = text => String(text || '').normalize('NFC').trim().split(/\s+/).filter(Boolean);

// words: [{w, s, e}] (giây, tính từ đầu đoạn giọng) — trả về { times: giây bắt đầu mỗi chữ hiển thị, issues: [...] }
export function alignWords(text, words, dur) {
  const toks = displayTokens(text);
  if (!toks.length || !words?.length) return null;
  // chuỗi ký tự lời hiển thị (+ chữ thứ mấy)
  const D = [], Dt = [];
  toks.forEach((w, i) => { for (const c of keepChars(w)) { D.push(c); Dt.push(i); } });
  // chuỗi ký tự Whisper (+ giờ của từng ký tự: nội suy trong chữ)
  const W = [], Ws = [], Ww = [];
  words.forEach((x, j) => {
    const cs = keepChars(x.w);
    const a = Number(x.s) || 0, b = Math.max(a, Number(x.e) || a);
    cs.forEach((c, k) => { W.push(c); Ws.push(a + (b - a) * k / Math.max(1, cs.length)); Ww.push(j); });
  });
  if (!D.length || !W.length) return null;
  // quy hoạch động khoảng cách sửa (khớp 0, thay 1, thêm/bớt 1), lưu đường đi
  const n = D.length, m = W.length;
  const cost = new Uint16Array((n + 1) * (m + 1)), mv = new Uint8Array((n + 1) * (m + 1));
  const ix = (i, j) => i * (m + 1) + j;
  for (let i = 1; i <= n; i++) { cost[ix(i, 0)] = i; mv[ix(i, 0)] = 2; }
  for (let j = 1; j <= m; j++) { cost[ix(0, j)] = j; mv[ix(0, j)] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const eq = D[i - 1] === W[j - 1];
      let best = cost[ix(i - 1, j - 1)] + (eq ? 0 : 1), how = eq ? 0 : 1;
      const del = cost[ix(i - 1, j)] + 1, ins = cost[ix(i, j - 1)] + 1;
      if (del < best) { best = del; how = 2; }
      if (ins < best) { best = ins; how = 3; }
      cost[ix(i, j)] = best; mv[ix(i, j)] = how;
    }
  }
  const at = new Array(n).fill(-1);      // ký tự hiển thị i ↔ ký tự Whisper j (-1 = không có)
  const same = new Uint8Array(n);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const h = mv[ix(i, j)];
    if (i > 0 && j > 0 && (h === 0 || h === 1)) { at[i - 1] = j - 1; same[i - 1] = h === 0 ? 1 : 0; i--; j--; }
    else if (i > 0 && (h === 2 || j === 0)) i--;
    else j--;
  }
  // giờ bắt đầu mỗi chữ hiển thị = giờ ký tự đầu tiên KHỚP ĐÚNG của chữ đó
  const T = new Array(toks.length).fill(null), good = new Array(toks.length).fill(0), cnt = new Array(toks.length).fill(0);
  for (let i = 0; i < n; i++) {
    const k = Dt[i];
    cnt[k]++;
    if (same[i]) { good[k]++; if (T[k] == null) T[k] = Ws[at[i]]; }
  }
  // nội suy chữ không khớp (theo số ký tự) giữa 2 mốc; đầu/cuối kẹp trong [0, dur]
  const total = Math.max(0.1, Number(dur) || words[words.length - 1].e || 1);
  const len = toks.map(w => Math.max(1, keepChars(w).length));
  const anchors = [[-1, 0]];
  T.forEach((t, k) => { if (t != null && good[k] / Math.max(1, cnt[k]) >= 0.5) anchors.push([k, t]); });
  anchors.push([toks.length, total]);
  const times = new Array(toks.length);
  for (let a = 0; a < anchors.length - 1; a++) {
    const [k0, t0] = anchors[a], [k1, t1] = anchors[a + 1];
    if (k0 >= 0) times[k0] = t0;
    const span = [];
    for (let k = k0 + 1; k < k1; k++) span.push(k);
    if (!span.length) continue;
    const startT = k0 >= 0 ? t0 : (k1 < toks.length ? Math.max(0, t1 - span.reduce((s, k) => s + len[k], 0) * 0.07) : 0);
    const endT = t1;
    const w0 = k0 >= 0 ? len[k0] : 0;
    const tot = w0 + span.reduce((s, k) => s + len[k], 0);
    let acc = w0;
    for (const k of span) { times[k] = startT + (endT - startT) * (k0 >= 0 ? acc / tot : (acc - w0) / Math.max(1, tot - w0)); acc += len[k]; }
  }
  for (let k = 1; k < times.length; k++) if (times[k] < times[k - 1]) times[k] = times[k - 1];
  // nghi đọc sai: chữ có số hoặc viết hoa (tên riêng), ≥ 2 ký tự, khớp đúng < 50%
  const issues = [];
  toks.forEach((w, k) => {
    const c = cnt[k];
    if (c < 2 || !/[0-9]|^\p{Lu}/u.test(w) || good[k] / c >= 0.5) return;
    // chữ Whisper nằm quanh chữ này (để khách biết máy đọc thành gì)
    const js = new Set();
    for (let i = 0; i < n; i++) if (Dt[i] === k && at[i] >= 0) js.add(Ww[at[i]]);
    const heard = [...js].sort((a, b) => a - b).map(j => words[j].w).join(' ').trim();
    const prev = issues[issues.length - 1];
    if (prev && prev.k === k - 1) { prev.text += ' ' + w; prev.k = k; if (heard && !prev.heard.includes(heard)) prev.heard += ' ' + heard; return; }
    issues.push({ k, text: w, heard });
  });
  return { times, issues: issues.map(x => ({ text: x.text.replace(/[,.;:!?…]+$/, ''), heard: x.heard.replace(/\s+([,.])/g, '$1').replace(/[,.;:!?…]+$/, '') })) };
}

// Âm thanh → WAV 16 kHz mono 16-bit, base64 (Whisper chỉ cần 16 kHz; 10 s ≈ 320 KB)
export async function bufferToWav16k(buf) {
  const sr = 16000;
  const len = Math.max(1, Math.ceil(buf.duration * sr));
  const off = new OfflineAudioContext(1, len, sr);
  const src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  const r = await off.startRendering();
  const f = r.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + f.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + f.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, f.length * 2, true);
  for (let i = 0; i < f.length; i++) { const x = Math.max(-1, Math.min(1, f[i])); out.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true); }
  const bytes = new Uint8Array(out.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
