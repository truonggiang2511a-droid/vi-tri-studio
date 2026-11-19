// /api/align (19/11, đang thử — app chỉ gọi khi bật ?align=1): nghe lại giọng đọc của MỘT câu bằng Whisper trên Cloudflare Workers AI
// (binding AI trong wrangler.jsonc, miễn phí 10.000 neurons/ngày ≈ 200+ phút giọng) → trả mốc thời gian từng chữ để phụ đề,
// chữ điểm nhấn, SFX khớp đúng lúc giọng nói; chữ nghe được dùng để báo câu đọc sai (giá, số, tên).
// Bắt đăng nhập (không cho dùng máy chủ làm cầu nối tự do), KHÔNG trừ lượt. Lỗi/hết lượt miễn phí → app quay về cách ước lượng cũ.
import { env, json, rpc, accountsOn, svcCount } from './vt.js';

const MAX_B64 = 2_400_000; // ~1,8 MB WAV 16 kHz mono ≈ 55 s — một câu kịch bản dài nhất ~25 s

function words(out) {
  const res = [];
  const push = (w, s, e) => {
    w = String(w || '').trim();
    const a = Number(s), b = Number(e);
    if (w && Number.isFinite(a)) res.push({ w, s: Math.round(a * 1000) / 1000, e: Number.isFinite(b) ? Math.round(b * 1000) / 1000 : a });
  };
  for (const sg of out?.segments || []) {
    if (Array.isArray(sg.words) && sg.words.length) for (const x of sg.words) push(x.word ?? x.text, x.start, x.end);
  }
  if (!res.length && Array.isArray(out?.words)) for (const x of out.words) push(x.word ?? x.text, x.start, x.end);
  if (!res.length) {
    // không có mốc từng chữ: chia đều thời lượng mỗi đoạn cho các chữ trong đoạn
    for (const sg of out?.segments || []) {
      const ws = String(sg.text || '').trim().split(/\s+/).filter(Boolean);
      const a = Number(sg.start), b = Number(sg.end);
      if (!ws.length || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      ws.forEach((w, i) => push(w, a + (b - a) * i / ws.length, a + (b - a) * (i + 1) / ws.length));
    }
  }
  return res;
}

export async function handleAlign(req) {
  if (req.method !== 'POST') return json({ error: 'Chỉ nhận POST' }, 405);
  if (accountsOn()) {
    const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!tok) return json({ error: 'Cần đăng nhập', code: 'AUTH' }, 401);
    try { await rpc('vt_me', { p_token: tok }); }
    catch (e) { return json({ error: e.message || 'Phiên đăng nhập hết hạn', code: 'AUTH' }, 401); }
  }
  const ai = env('AI');
  if (!ai || typeof ai.run !== 'function') return json({ error: 'Chưa bật Workers AI', code: 'NO_AI' }, 501);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Dữ liệu không hợp lệ' }, 400); }
  const audio = String(body.audio || '');
  if (!audio || audio.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(audio.slice(0, 200))) return json({ error: 'Âm thanh không hợp lệ' }, 400);
  const prompt = String(body.text || '').slice(0, 600);
  const t0 = Date.now();
  // Bản turbo nghe tiếng Việt tốt hơn và nhận gợi ý lời (initial_prompt) → khớp số, tên riêng; lỗi thì thử bản whisper thường
  try {
    const out = await ai.run('@cf/openai/whisper-large-v3-turbo', { audio, language: 'vi', initial_prompt: prompt || undefined });
    const ws = words(out);
    if (ws.length) return json({ words: ws, text: String(out?.text || '').trim(), model: 'turbo', ms: Date.now() - t0 });
  } catch (e) { console.log('align turbo', e.message); }
  try {
    const bin = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
    const out = await ai.run('@cf/openai/whisper', { audio: [...bin] });
    const ws = words(out);
    if (ws.length) return json({ words: ws, text: String(out?.text || '').trim(), model: 'whisper', ms: Date.now() - t0 });
    return json({ error: 'Không nghe được chữ nào', code: 'EMPTY' }, 422);
  } catch (e) {
    svcCount('align-loi');
    return json({ error: 'Whisper lỗi: ' + (e.message || e), code: 'AI_ERR' }, 502);
  }
}
