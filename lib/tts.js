// Giọng đọc AI tiếng Việt cho video vị trí. Khoá đặt ở biến môi trường của Cloudflare Pages, không lộ ra trình duyệt:
//   FPT_TTS_KEY    -> FPT.AI Text to Speech v5 (giọng Việt tự nhiên, có miền Nam, Bắc, Trung)
//   GOOGLE_TTS_KEY -> Google Cloud Text-to-Speech (vi-VN Chirp 3 HD / Neural2)
// Khi đã bật tài khoản (VT_*), mỗi lần tạo giọng phải có phiên đăng nhập còn lượt.
import { env, json, allowAi, accountsOn } from './vt.js';

const FPT_VOICES = [
  { id: 'nu-nam', label: 'Nữ miền Nam', v: 'linhsan' },
  { id: 'nu-nam-2', label: 'Nữ miền Nam 2', v: 'lannhi' },
  { id: 'nam-nam', label: 'Nam miền Nam', v: 'minhquang', alt: 'giahuy' },
  { id: 'nu-bac', label: 'Nữ miền Bắc', v: 'banmai' },
  { id: 'nu-bac-2', label: 'Nữ miền Bắc 2', v: 'thuminh' },
  { id: 'nam-bac', label: 'Nam miền Bắc', v: 'leminh' },
  { id: 'nu-trung', label: 'Nữ miền Trung', v: 'myan' },
  { id: 'nam-trung', label: 'Nam miền Trung', v: 'giahuy' },
];
const GOOGLE_VOICES = [
  { id: 'g-nu-hd', label: 'Nữ (HD)', v: 'vi-VN-Chirp3-HD-Aoede', alt: 'vi-VN-Neural2-A' },
  { id: 'g-nam-hd', label: 'Nam (HD)', v: 'vi-VN-Chirp3-HD-Charon', alt: 'vi-VN-Neural2-D' },
  { id: 'g-nu', label: 'Nữ', v: 'vi-VN-Neural2-A' },
  { id: 'g-nam', label: 'Nam', v: 'vi-VN-Neural2-D' },
];
const isMale = id => /^(g-)?nam/.test(id);
const pickVoice = (list, id) => list.find(x => x.id === id) || list.find(x => isMale(x.id) === isMale(id)) || list[0];

async function fptOnce(key, text, voice, speed) {
  const res = await fetch('https://api.fpt.ai/hmi/tts/v5', {
    method: 'POST',
    headers: { 'api-key': key, api_key: key, voice, speed: String(speed), format: 'mp3', 'cache-control': 'no-cache' },
    body: text,
    signal: AbortSignal.timeout(15000),
  });
  const raw = await res.text();
  let j = null;
  try { j = JSON.parse(raw); } catch { /* không phải JSON */ }
  if (!res.ok || !j || j.error !== 0 || !j.async) {
    const msg = j?.message || raw.slice(0, 160) || ('HTTP ' + res.status);
    const e = new Error(msg);
    e.status = res.status;
    if (res.status === 429 || /rate limit|quota|too many/i.test(msg)) e.rate = true;
    throw e;
  }
  // File âm thanh được tạo không đồng bộ: chờ một lúc, chưa xong thì trả link để trình duyệt hỏi tiếp
  const deadline = Date.now() + 22000;
  let wait = 700;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, wait));
    wait = Math.min(1500, wait + 200);
    const a = await fetch(j.async, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (a && a.ok && /audio|mpeg|octet/.test(a.headers.get('content-type') || '')) {
      return new Response(a.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
    }
  }
  return json({ pending: j.async }, 202);
}

// Hỏi lại file FPT đang tạo (chỉ nhận link kho lưu trữ của FPT.AI)
const POLL_HOST = /(^|\.)(amazonaws\.com|fpt\.ai|fptcloud\.com|fpt\.vn)$/i;
async function pollFpt(u) {
  let url;
  try { url = new URL(u); } catch { return json({ error: 'Link không hợp lệ' }, 400); }
  if (url.protocol !== 'https:' || !POLL_HOST.test(url.hostname)) return json({ error: 'Link không hợp lệ' }, 400);
  const a = await fetch(url.href, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (a && a.ok && /audio|mpeg|octet/.test(a.headers.get('content-type') || '')) {
    return new Response(a.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
  }
  return json({ pending: url.href }, 202);
}

async function viaFpt(key, text, voiceId, speed) {
  const pv = pickVoice(FPT_VOICES, voiceId);
  try {
    return await fptOnce(key, text, pv.v, speed);
  } catch (e) {
    if (e.rate) throw e;
    if (e.status === 401 || e.status === 403 || /key|unauthor|invalid/i.test(e.message)) {
      throw new Error('FPT.AI từ chối khoá API (' + e.message + '). Kiểm tra khoá lấy ở console.fpt.ai, mục Text to Speech.');
    }
    if (pv.alt) return await fptOnce(key, text, pv.alt, speed);
    throw new Error('FPT.AI: ' + e.message);
  }
}

async function googleOnce(key, text, name, speed) {
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'vi-VN', name },
      audioConfig: { audioEncoding: 'MP3', speakingRate: [0.9, 1, 1.1][speed + 1] || 1 },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.audioContent) {
    const e = new Error('Google TTS: ' + (j?.error?.message || res.status));
    if (res.status === 429) e.rate = true;
    throw e;
  }
  // Giải mã base64 bằng vòng lặp đơn giản để tốn ít CPU (Cloudflare gói miễn phí giới hạn CPU mỗi lượt)
  const raw = atob(j.audioContent);
  const bin = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  return new Response(bin, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
}
async function viaGoogle(key, text, voiceId, speed) {
  const pv = pickVoice(GOOGLE_VOICES, voiceId);
  try { return await googleOnce(key, text, pv.v, speed); }
  catch (e) { if (pv.alt) return await googleOnce(key, text, pv.alt, speed); throw e; }
}

export async function handleTts(req) {
  // TTS_PROVIDER=google để ưu tiên Google khi có cả hai khoá
  let fpt = env('FPT_TTS_KEY'), google = env('GOOGLE_TTS_KEY');
  if (env('TTS_PROVIDER') === 'google' && google) fpt = '';
  if (env('TTS_PROVIDER') === 'fpt' && fpt) google = '';
  const provider = fpt ? 'fpt' : google ? 'google' : null;
  if (req.method === 'GET') {
    const poll = new URL(req.url).searchParams.get('poll');
    if (poll) return pollFpt(poll);
    const list = provider === 'google' ? GOOGLE_VOICES : FPT_VOICES;
    return json({ ready: !!provider, provider, gated: accountsOn(), voices: list.map(({ id, label }) => ({ id, label })) });
  }
  if (req.method !== 'POST') return json({ error: 'Phương thức không hỗ trợ' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Dữ liệu không hợp lệ' }, 400); }
  const text = String(body.text || '').trim();
  const voice = String(body.voice || '');
  const speed = Math.max(-1, Math.min(1, Math.round(Number(body.speed) || 0)));
  if (text.length < 3 || text.length > 5000) return json({ error: 'Lời đọc quá ngắn hoặc quá dài (tối đa 5.000 ký tự)' }, 400);
  if (!provider) return json({ error: 'Chưa cấu hình khoá giọng đọc AI', code: 'NO_KEY' }, 501);
  const denied = await allowAi(req, 'tts', text.length, Number(body.lat), Number(body.lng));
  if (denied) return denied;
  try {
    if (fpt) {
      try { return await viaFpt(fpt, text, voice, speed); }
      catch (e) { if (!google) throw e; }
    }
    return await viaGoogle(google, text, voice, speed);
  } catch (e) {
    if (e.rate) {
      return json({ code: 'RATE_LIMIT', provider, error: provider === 'fpt'
        ? 'FPT.AI đang giới hạn tốc độ của khoá (gói miễn phí chỉ cho tạo rất ít lần). Đợi vài phút rồi bấm lại, hoặc nâng gói FPT.AI để hết giới hạn.'
        : 'Máy chủ giọng đọc đang đông, đợi vài giây rồi bấm lại.' }, 429);
    }
    return json({ error: String(e.message || e) }, 502);
  }
}
