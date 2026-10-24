// Giọng đọc AI tiếng Việt cho video vị trí. Khoá đặt ở biến môi trường của Cloudflare Pages, không lộ ra trình duyệt:
//   FPT_TTS_KEY    -> FPT.AI Text to Speech v5 (giọng Việt tự nhiên, có miền Nam, Bắc, Trung)
//   GOOGLE_TTS_KEY -> Google Cloud Text-to-Speech (vi-VN Chirp 3 HD / Neural2)
//   VBEE_APP_ID + VBEE_TOKEN -> Vbee (studio.vbee.vn → Tích hợp API → Tạo ứng dụng). Có thì thêm các giọng Vbee
//                    (id 'vb:<voiceCode>') vào danh sách, bên cạnh giọng FPT/Google; không có thì không đổi gì.
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

// ---------- Vbee ----------
const vbeeOn = () => !!(env('VBEE_APP_ID') && env('VBEE_TOKEN'));
const vbeeHeaders = () => ({ authorization: 'Bearer ' + env('VBEE_TOKEN'), 'app-id': env('VBEE_APP_ID'), 'content-type': 'application/json' });
// Danh sách giọng tiếng Việt của Vbee, nhớ đệm 6 giờ ở Cloudflare (đỡ gọi lại mỗi lần khách mở app)
async function vbeeVoices() {
  if (!vbeeOn()) return [];
  const cache = globalThis.caches?.default;
  const key = new Request('https://vitristudio.cache/vbee-voices-v1?app=' + encodeURIComponent(env('VBEE_APP_ID')));
  try {
    const hit = cache && await cache.match(key);
    if (hit) return await hit.json();
  } catch { /* bỏ qua */ }
  const out = [];
  let cursor = '';
  for (let page = 0; page < 3; page++) {
    const u = new URL('https://vbee.vn/api/public/v1/voices');
    u.searchParams.set('language_code', 'vi-VN');
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetch(u, { headers: vbeeHeaders(), signal: AbortSignal.timeout(8000) }).catch(() => null);
    const j = res && res.ok ? await res.json().catch(() => null) : null;
    const list = j?.result?.voices || [];
    for (const v of list) {
      if (!v?.code || (v.language_code && v.language_code !== 'vi-VN')) continue;
      out.push({ id: 'vb:' + v.code, label: String(v.name || v.code).trim(), gender: v.gender || '', demo: v.demo || '', provider: 'vbee' });
    }
    cursor = j?.result?.pagination?.has_next_page ? j.result.pagination.next_cursor : '';
    if (!cursor) break;
  }
  if (out.length && cache) {
    try { await cache.put(key, new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' } })); } catch { /* bỏ qua */ }
  }
  return out;
}
// Cắt lời đọc thành các đoạn ≤ 280 ký tự (Vbee realtime nhận tối đa 300), ưu tiên cắt ở dấu câu
function vbeeChunks(text) {
  const out = [];
  for (const para of String(text).split(/\n{2,}/)) {
    let rest = para.replace(/\s+/g, ' ').trim();
    while (rest.length > 280) {
      let cut = -1;
      for (const re of [/[.!?…]\s/g, /[,;:]\s/g, /\s/g]) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(rest)) && m.index < 280) cut = m.index + 1;
        if (cut > 80) break;
      }
      if (cut <= 0) cut = 280;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out.filter(x => x.length > 0);
}
async function vbeeOnce(text, code, speed) {
  const res = await fetch('https://api.vbee.vn/v1/tts', {
    method: 'POST',
    headers: vbeeHeaders(),
    body: JSON.stringify({ text, voiceCode: code, outputFormat: 'mp3', bitrate: 128, speed: [0.9, 1, 1.1][speed + 1] || 1, mode: 'sync' }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok || !/audio|mpeg|octet/.test(res.headers.get('content-type') || '')) {
    const j = await res.json().catch(() => null);
    const e = new Error('Vbee: ' + (j?.error?.message || j?.message || ('HTTP ' + res.status)));
    if (res.status === 429) e.rate = true;
    if (res.status === 401) e.message = 'Vbee từ chối token (hết hạn hoặc sai). Tạo lại ứng dụng ở studio.vbee.vn rồi cập nhật VBEE_TOKEN.';
    throw e;
  }
  return new Uint8Array(await res.arrayBuffer());
}
// Mỗi đoạn gọi một lần (lần lượt, Vbee giới hạn số yêu cầu đồng thời), ghép các khung MP3 nối tiếp thành một file
async function viaVbee(text, voiceId, speed) {
  const code = voiceId.slice(3);
  const chunks = vbeeChunks(text);
  if (chunks.length > 30) throw new Error('Lời đọc quá dài cho giọng Vbee, chia nhỏ kịch bản.');
  const bufs = [];
  for (const c of chunks) bufs.push(await vbeeOnce(c, code, speed));
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of bufs) { out.set(b, o); o += b.length; }
  return new Response(out, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
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
    const list = provider === 'google' ? GOOGLE_VOICES : provider ? FPT_VOICES : [];
    const vb = await vbeeVoices().catch(() => []);
    return json({ ready: !!provider || vb.length > 0, provider: provider || (vb.length ? 'vbee' : null), vbee: vb.length > 0, gated: accountsOn(),
      voices: [...list.map(({ id, label }) => ({ id, label })), ...vb.map(({ id, label, gender, demo, provider: pv }) => ({ id, label, gender, demo, provider: pv }))] });
  }
  if (req.method !== 'POST') return json({ error: 'Phương thức không hỗ trợ' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Dữ liệu không hợp lệ' }, 400); }
  const text = String(body.text || '').trim();
  const voice = String(body.voice || '');
  const speed = Math.max(-1, Math.min(1, Math.round(Number(body.speed) || 0)));
  if (text.length < 3 || text.length > 5000) return json({ error: 'Lời đọc quá ngắn hoặc quá dài (tối đa 5.000 ký tự)' }, 400);
  const wantVbee = voice.startsWith('vb:') && vbeeOn();
  if (!provider && !wantVbee) return json({ error: 'Chưa cấu hình khoá giọng đọc AI', code: 'NO_KEY' }, 501);
  const denied = await allowAi(req, 'tts', text.length, Number(body.lat), Number(body.lng));
  if (denied) return denied;
  if (wantVbee) {
    try { return await viaVbee(text, voice, speed); }
    catch (e) {
      if (e.rate) return json({ code: 'RATE_LIMIT', provider: 'vbee', error: 'Vbee đang giới hạn số yêu cầu cùng lúc, đợi vài giây rồi bấm lại.' }, 429);
      return json({ error: String(e.message || e) }, 502);
    }
  }
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
