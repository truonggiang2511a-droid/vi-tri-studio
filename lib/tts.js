// Giọng đọc AI tiếng Việt cho video vị trí. Khoá đặt ở biến môi trường của Cloudflare Pages, không lộ ra trình duyệt:
//   FPT_TTS_KEY    -> FPT.AI Text to Speech v5 (giọng Việt tự nhiên, có miền Nam, Bắc, Trung)
//   GOOGLE_TTS_KEY -> Google Cloud Text-to-Speech (vi-VN Chirp 3 HD / Neural2)
//   VBEE_APP_ID + VBEE_TOKEN -> Vbee (studio.vbee.vn → Tích hợp API → Tạo ứng dụng). Có thì thêm các giọng Vbee
//                    (id 'vb:<voiceCode>') vào danh sách, bên cạnh giọng FPT/Google; không có thì không đổi gì.
// Khi đã bật tài khoản (VT_*), mỗi lần tạo giọng phải có phiên đăng nhập còn lượt.
import { env, json, allowAi, accountsOn, rpc } from './vt.js';
import { vbeeHookPut, vbeeHookWait } from './vbee-box.js';

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
// Hai cách dùng: (1) khoá chung của Vị Trí Studio (VBEE_APP_ID + VBEE_TOKEN trên Cloudflare);
// (2) KHÁCH TỰ MANG KHOÁ: app gửi kèm header x-vbee-app + x-vbee-token (khoá lưu trên máy khách) → tiền giọng trừ vào
// tài khoản Vbee của khách. Máy chủ chỉ chuyển tiếp, KHÔNG lưu, KHÔNG ghi log khoá.
function vbeeCreds(req) {
  const app = String(req?.headers.get('x-vbee-app') || '').trim();
  const token = String(req?.headers.get('x-vbee-token') || '').trim().replace(/^Bearer\s+/i, '');
  if (app || token) {
    if (!/^[\w.-]{4,200}$/.test(app) || !/^[\w.-]{10,4000}$/.test(token)) return { bad: true, own: true };
    return { app, token, own: true };
  }
  if (env('VBEE_APP_ID') && env('VBEE_TOKEN')) return { app: env('VBEE_APP_ID'), token: env('VBEE_TOKEN'), own: false };
  return null;
}
const vbeeHeaders = c => ({ authorization: 'Bearer ' + c.token, 'app-id': c.app, 'content-type': 'application/json' });
// Một danh sách giọng (theo trang), lỗi xác thực thì báo lại
async function vbeeList(c, ownership, maxPages = 3, stopWhen = null) {
  const out = [];
  let cursor = '', status = 0, detail = '';
  // Giọng riêng/nhân bản (PERSONAL) có thể không gắn mã ngôn ngữ → không lọc theo ngôn ngữ
  const anyLang = ownership === 'PERSONAL';
  for (let page = 0; page < maxPages; page++) {
    const u = new URL('https://vbee.vn/api/public/v1/voices');
    // tài liệu Vbee ghi cả 2 kiểu tên tham số (language_code / languageCode) → gửi cả hai
    if (!anyLang) { u.searchParams.set('language_code', 'vi-VN'); u.searchParams.set('languageCode', 'vi-VN'); }
    if (ownership) { u.searchParams.set('voice_ownership', ownership); u.searchParams.set('voiceOwnership', ownership); }
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetch(u, { headers: vbeeHeaders(c), signal: AbortSignal.timeout(8000) }).catch(() => null);
    status = res ? res.status : 0;
    const j = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || j?.status === 0 || j?.error) { // Vbee có thể trả HTTP 200 kèm status 0 khi khoá sai
      if (res?.ok && (j?.status === 0 || j?.error)) status = 401;
      detail = String(j?.error?.code || j?.error?.message || j?.message || j?.error_message || '').slice(0, 160);
      break;
    }
    const list = j?.result?.voices || [];
    for (const v of list) {
      if (!v?.code || (!anyLang && v.language_code && v.language_code !== 'vi-VN')) continue;
      const cf = Number(v.credit_factor) || 1;
      out.push({ id: 'vb:' + v.code, label: String(v.name || v.code).trim() + (cf > 1 ? ` (×${cf} ký tự)` : ''), gender: v.gender || '', demo: v.demo || '', provider: 'vbee', own: ownership === 'PERSONAL',
        group: ownership === 'PERSONAL' ? 'rieng' : ownership === 'COMMUNITY' ? 'congdong' : 'vbee', uses: vbeeUses(v) });
    }
    cursor = j?.result?.pagination?.has_next_page ? j.result.pagination.next_cursor : '';
    if (!cursor || (stopWhen && stopWhen(out, page))) break;
  }
  return { out, status, detail };
}
// Số người dùng của giọng cộng đồng (tài liệu Vbee không ghi trường này → thử các tên hay gặp; không có thì -1)
const USE_KEYS = ['total_users', 'totalUsers', 'users', 'user_count', 'userCount', 'num_users', 'used_count', 'usedCount', 'usage_count', 'usageCount', 'total_used', 'totalUsed', 'popularity', 'total_characters', 'totalCharacters'];
function vbeeUses(v) {
  for (const k of USE_KEYS) { const n = Number(v?.[k] ?? v?.statistic?.[k] ?? v?.stats?.[k]); if (Number.isFinite(n) && n > 0) return n; }
  return -1;
}
// 25/10 Giang: giọng cộng đồng phần lớn nghe dở → chỉ giữ vài giọng NHIỀU NGƯỜI DÙNG NHẤT. Vbee có trả số người dùng thì lấy
// top theo số đó; không có thì chỉ giữ các giọng đang "Thịnh hành" trên Vbee (ảnh Giang chụp 25/10).
const COMM_TOP = 6;
// Giọng Giang chọn đưa lên ĐẦU danh sách (nhóm "Đề xuất cho video BĐS") — 25/10: Phóng viên Nam (giọng tin tức, 7,7 N người dùng)
const VBEE_PIN = ['Phóng viên Nam'];
const COMM_HOT = ['Phóng viên Nam', 'Nguyệt Nga Podcast', 'Thiện Tâm', 'Ngạn Kể Chuyện', 'Tuệ Giác'];
const normName = s => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
function pickCommunity(list) {
  if (list.some(v => v.uses > 0)) return [...list].sort((a, b) => b.uses - a.uses).slice(0, COMM_TOP);
  const hot = COMM_HOT.map(normName);
  return list.filter(v => hot.includes(normName(v.label.replace(/\s*\(×.*$/, '')))).sort((a, b) => hot.indexOf(normName(a.label)) - hot.indexOf(normName(b.label))).slice(0, COMM_TOP);
}
// Danh sách giọng tiếng Việt của Vbee (+ giọng riêng/nhân bản của khách khi dùng khoá của khách)
async function vbeeVoices(c) {
  if (!c || c.bad) return [];
  const cache = !c.own && globalThis.caches?.default; // khoá chung: nhớ đệm 6 giờ; khoá của khách: không nhớ đệm
  const key = new Request('https://vitristudio.cache/vbee-voices-v1?app=' + encodeURIComponent(c.app));
  try {
    const hit = cache && await cache.match(key);
    if (hit) return await hit.json();
  } catch { /* bỏ qua */ }
  // Hỏi riêng từng loại: mặc định, giọng của Vbee, giọng riêng/nhân bản của khách (25/10: chỉ hỏi mặc định thì ra rất ít giọng)
  // + giọng cộng đồng (tab "Giọng cộng đồng" trên Vbee): rất nhiều → chỉ lấy 2 trang đầu (200 giọng, Vbee xếp sẵn)
  const [pub, vbee, mine, comm] = await Promise.all([vbeeList(c, ''), vbeeList(c, 'VBEE'), c.own ? vbeeList(c, 'PERSONAL') : Promise.resolve({ out: [] }), vbeeList(c, 'COMMUNITY', 10, (o, page) => page >= 3 && VBEE_PIN.every(n => o.some(v => normName(v.label.replace(/\s*\(×.*$/, '')) === normName(n))))]);
  const seen = new Set();
  const out = [];
  const baseName = v => normName(v.label.replace(/\s*\(×.*$/, ''));
  const pins = [];
  for (const n of VBEE_PIN) {
    const hit = [...vbee.out, ...pub.out, ...comm.out].find(v => baseName(v) === normName(n));
    if (hit) pins.push({ ...hit, group: 'dexuat' });
  }
  const commTop = pickCommunity(comm.out.filter(v => !pins.some(p => p.id === v.id)));
  for (const v of [...pins, ...mine.out.map(v => ({ ...v, label: '⭐ ' + v.label })), ...vbee.out, ...pub.out, ...commTop]) { if (!seen.has(v.id)) { seen.add(v.id); out.push(v); } }
  out.diag = { macdinh: pub.out.length, vbee: vbee.out.length, rieng: mine.out.length, congdong: commTop.length, dexuat: pins.map(v => v.label), congdongXet: comm.out.length, congdongTheo: comm.out.some(v => v.uses > 0) ? 'so-nguoi-dung' : 'thinh-hanh', riengLoi: mine.status && mine.status !== 200 ? (mine.status + ' ' + (mine.detail || '')).trim() : '' };
  if (out.length && cache) {
    try { await cache.put(key, new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' } })); } catch { /* bỏ qua */ }
  }
  const okList = [pub, vbee].find(x => x.out.length) || pub;
  out.status = okList.status; out.detail = okList.detail;
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
async function vbeeOnce(c, text, code, speed) {
  const res = await fetch('https://api.vbee.vn/v1/tts', {
    method: 'POST',
    headers: vbeeHeaders(c),
    body: JSON.stringify({ text, voiceCode: code, outputFormat: 'mp3', bitrate: 128, speed: [0.9, 1, 1.1][speed + 1] || 1, mode: 'sync' }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok || !/audio|mpeg|octet/.test(res.headers.get('content-type') || '')) {
    const j = await res.json().catch(() => null);
    const e = new Error('Vbee: ' + (j?.error?.message || j?.message || ('HTTP ' + res.status)));
    if (res.status === 429) e.rate = true;
    if (res.status === 401) e.message = c.own
      ? 'Vbee từ chối App ID/Token của anh/chị (sai hoặc đã hết hạn). Vào studio.vbee.vn/apps tạo ứng dụng mới rồi dán lại vào app.'
      : 'Vbee từ chối token (hết hạn hoặc sai). Tạo lại ứng dụng ở studio.vbee.vn rồi cập nhật VBEE_TOKEN.';
    if (res.status === 400 && c.own && /credit|balance|số dư|ký tự|character/i.test(e.message)) e.message = 'Tài khoản Vbee của anh/chị hết ký tự/credit. Nạp thêm ở studio.vbee.vn rồi bấm lại. (' + e.message + ')';
    throw e;
  }
  return new Uint8Array(await res.arrayBuffer());
}
// Vbee kiểu async (api-docs.vbee.vn → TTS Batch API + Get request): MỌI giọng, kể cả giọng nhân bản của khách.
// Realtime (sync) chỉ hỗ trợ 5 giọng (Ngọc Huyền, Tường Vy, Mai Phương, Lan Trinh, Thảo Trinh) → dùng async trước,
// webhookUrl bắt buộc nên trỏ về /api/tts?vbee=hook (chỉ trả 200), kết quả lấy bằng cách hỏi lại GET /v1/tts/requests/{id}.
const vbeeField = (j, ...ks) => { for (const k of ks) { const v = j?.[k] ?? j?.result?.[k] ?? j?.data?.[k]; if (v != null && v !== '') return v; } return null; };
function vbeeErr(c, res, j) {
  const m = String(j?.error?.message || j?.error_message || j?.message || j?.error?.code || ('HTTP ' + (res?.status || 0)));
  const e = new Error('Vbee: ' + m);
  const st = res?.status || 0;
  if (st === 429 || /CCR_MAX|concurrent/i.test(m)) e.rate = true;
  if (st === 401 || /unauthori/i.test(m)) e.message = c.own
    ? 'Vbee từ chối App ID/Token của anh/chị (sai hoặc đã hết hạn). Vào studio.vbee.vn/apps tạo ứng dụng mới rồi dán lại vào app.'
    : 'Vbee từ chối token (hết hạn hoặc sai). Tạo lại ứng dụng ở studio.vbee.vn rồi cập nhật VBEE_TOKEN.';
  else if (c.own && /credit|balance|số dư|ký tự|character/i.test(m)) e.message = 'Tài khoản Vbee của anh/chị hết ký tự/credit. Nạp thêm ở studio.vbee.vn rồi bấm lại. (' + m + ')';
  return e;
}
async function vbeeAsync(c, text, code, speed) {
  const hook = (env('APP_URL') || 'https://vitristudio.com').replace(/\/+$/, '') + '/api/tts?vbee=hook';
  const res = await fetch('https://api.vbee.vn/v1/tts', {
    method: 'POST',
    headers: vbeeHeaders(c),
    body: JSON.stringify({ text, voiceCode: code, outputFormat: 'mp3', bitrate: 128, speed: [0.9, 1, 1.1][speed + 1] || 1, mode: 'async', webhookUrl: hook }),
    signal: AbortSignal.timeout(20000),
  });
  let j = await res.json().catch(() => null);
  if (!res.ok || j?.status === 0 || j?.error) throw vbeeErr(c, res, j);
  const id = vbeeField(j, 'requestId', 'request_id');
  if (!id) throw new Error('Vbee không trả mã yêu cầu');
  const after = e => { e.created = true; return e; }; // lỗi sau khi Vbee đã nhận yêu cầu: không gọi lại kiểu realtime
  let link = vbeeField(j, 'audioLink', 'audio_link');
  if (!link) {
    // Lấy kết quả theo 2 đường cùng lúc, đường nào có trước dùng đường đó:
    //  (a) webhook Vbee gọi về → Durable Object VbeeBox (gói Vbee nào cũng có)
    //  (b) hỏi GET /v1/tts/requests/{id} — nhiều gói Vbee KHÔNG cho ("This feature is not supported in user package") → bỏ đường này, chờ webhook
    let done = false, pollErr = null;
    const viaHook = vbeeHookWait(id, 75000).then(r => {
      if (!r) return null;
      const st = String(r.status || '').toUpperCase();
      if (/FAIL/.test(st)) return { fail: 'tạo giọng thất bại' + (r.error_message ? ' (' + r.error_message + ')' : '') };
      const l = r.audio_link || r.audioLink;
      return l ? { link: l } : null;
    });
    const viaPoll = (async () => {
      for (let n = 1; n <= 30 && !done; n++) {
        await new Promise(r => setTimeout(r, n <= 5 ? 1000 : 2500));
        if (done) return null;
        const r2 = await fetch('https://api.vbee.vn/v1/tts/requests/' + encodeURIComponent(id), { headers: vbeeHeaders(c), signal: AbortSignal.timeout(10000) }).catch(() => null);
        if (!r2) continue;
        const jj = await r2.json().catch(() => null);
        if (!r2.ok || jj?.status === 0 || (jj?.error && !jj?.result)) {
          if (r2.status === 404) continue;
          pollErr = vbeeErr(c, r2, jj); // vd. gói không hỗ trợ → thôi hỏi, chờ webhook
          return null;
        }
        const st = [jj?.status, jj?.result?.status, jj?.data?.status].map(x => String(x || '').toUpperCase());
        if (st.includes('FAILED')) return { fail: 'tạo giọng thất bại (' + (vbeeField(jj, 'error_message', 'error_code') || 'không rõ') + ')' };
        const l = vbeeField(jj, 'audioLink', 'audio_link');
        if (l) return { link: l };
      }
      return null;
    })();
    const res2 = await new Promise(resolve => {
      let left = 2;
      const take = r => { if (r && !done) { done = true; resolve(r); } else if (--left === 0) resolve(null); };
      viaHook.then(take, () => take(null));
      viaPoll.then(take, () => take(null));
    });
    done = true;
    if (!res2) throw after(pollErr && !/not supported/i.test(pollErr.message) ? pollErr : new Error('Vbee tạo giọng quá lâu hoặc chưa báo kết quả. Bấm tạo lại sau ít phút.'));
    if (res2.fail) throw after(new Error('Vbee: ' + res2.fail));
    link = res2.link;
  }
  if (!/^https:\/\//i.test(String(link))) throw after(new Error('Vbee trả link giọng không hợp lệ'));
  const a = await fetch(link, { signal: AbortSignal.timeout(20000) });
  if (!a.ok) throw after(new Error('Không tải được file giọng Vbee (HTTP ' + a.status + ')'));
  return new Response(new Uint8Array(await a.arrayBuffer()), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
}
// Dự phòng: realtime (sync) — mỗi đoạn ≤ 280 ký tự gọi lần lượt, ghép các khung MP3 nối tiếp thành một file
async function viaVbee(c, text, voiceId, speed) {
  const code = voiceId.slice(3);
  try { return await vbeeAsync(c, text, code, speed); }
  catch (e) {
    // Khoá sai / hết credit / bận: báo luôn. Lỗi khác (vd. async chưa mở cho tài khoản) → thử realtime
    if (e.rate || e.created || /từ chối|hết ký tự/.test(e.message)) throw e;
    try { return await viaVbeeSync(c, text, code, speed); }
    catch (e2) { throw /voice|giọng|voiceCode/i.test(e2.message) ? e : e2; }
  }
}
async function viaVbeeSync(c, text, code, speed) {
  const chunks = vbeeChunks(text);
  if (chunks.length > 30) throw new Error('Lời đọc quá dài cho giọng Vbee, chia nhỏ kịch bản.');
  const bufs = [];
  for (const part of chunks) bufs.push(await vbeeOnce(c, part, code, speed));
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of bufs) { out.set(b, o); o += b.length; }
  return new Response(out, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
}

export async function handleTts(req) {
  // Vbee gọi về khi tạo giọng xong (webhookUrl bắt buộc) — app lấy kết quả bằng cách hỏi lại, nên chỉ cần trả 200
  // Kiểm tra hộp nhận kết quả Vbee (Durable Object) chạy được trên web thật: ghi rồi đọc lại một mã ngẫu nhiên
  if (new URL(req.url).searchParams.get('vbee') === 'boxtest') {
    const id = 'test-' + crypto.randomUUID();
    const put = await vbeeHookPut({ request_id: id, status: 'SUCCESS', audio_link: 'https://example.invalid/x.mp3' }).catch(e => String(e));
    const got = await vbeeHookWait(id, 2000);
    return json({ ok: !!got?.audio_link, put });
  }
  if (new URL(req.url).searchParams.get('vbee') === 'hook') {
    if (req.method === 'POST') { const b = await req.json().catch(() => null); if (b) await vbeeHookPut(b).catch(() => {}); }
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
  }
  // TTS_PROVIDER=google để ưu tiên Google khi có cả hai khoá
  let fpt = env('FPT_TTS_KEY'), google = env('GOOGLE_TTS_KEY');
  if (env('TTS_PROVIDER') === 'google' && google) fpt = '';
  if (env('TTS_PROVIDER') === 'fpt' && fpt) google = '';
  const provider = fpt ? 'fpt' : google ? 'google' : null;
  if (req.method === 'GET') {
    const poll = new URL(req.url).searchParams.get('poll');
    if (poll) return pollFpt(poll);
    const list = provider === 'google' ? GOOGLE_VOICES : provider ? FPT_VOICES : [];
    const c = vbeeCreds(req);
    const vb = await vbeeVoices(c).catch(() => []);
    // Kiểm tra khoá Vbee khách vừa dán (không tạo giọng, không tốn ký tự)
    if (new URL(req.url).searchParams.get('vbee') === 'check') {
      if (!c || !c.own) return json({ ok: false, error: 'Chưa nhập App ID và Token' }, 400);
      if (c.bad) return json({ ok: false, error: 'App ID hoặc Token không đúng dạng (chép lại đủ, không thừa dấu cách)' }, 400);
      if (!vb.length) return json({ ok: false, detail: vb.detail || '', error: vb.status === 401 || vb.status === 403
        ? 'Vbee từ chối App ID/Token này (sai hoặc đã hết hạn)'
        : 'Chưa lấy được danh sách giọng từ Vbee (mã ' + (vb.status || 'mạng') + '). Thử lại sau ít phút.', detail: vb.detail || '' }, 400);
      return json({ ok: true, voices: vb.length, personal: vb.filter(v => v.own).length, diag: vb.diag || null });
    }
    return json({ ready: !!provider || vb.length > 0, provider: provider || (vb.length ? 'vbee' : null), vbee: vb.length > 0, vbeeOwn: !!c?.own && vb.length > 0, gated: accountsOn(),
      voices: [...list.map(({ id, label }) => ({ id, label })), ...vb.map(({ id, label, gender, demo, provider: pv, own, group }) => ({ id, label, gender, demo, provider: pv, own: !!own, group: group || 'vbee' }))] });
  }
  if (req.method !== 'POST') return json({ error: 'Phương thức không hỗ trợ' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Dữ liệu không hợp lệ' }, 400); }
  const text = String(body.text || '').trim();
  const voice = String(body.voice || '');
  const speed = Math.max(-1, Math.min(1, Math.round(Number(body.speed) || 0)));
  if (text.length < 3 || text.length > 5000) return json({ error: 'Lời đọc quá ngắn hoặc quá dài (tối đa 5.000 ký tự)' }, 400);
  const vc = voice.startsWith('vb:') ? vbeeCreds(req) : null;
  if (vc?.bad) return json({ error: 'App ID hoặc Token Vbee không đúng dạng — mở "Dùng tài khoản Vbee" để dán lại.' }, 400);
  if (voice.startsWith('vb:') && !vc) return json({ error: 'Giọng Vbee cần kết nối tài khoản Vbee (mục "Dùng tài khoản Vbee"), hoặc chọn giọng khác.', code: 'NO_VBEE' }, 400);
  const wantVbee = !!vc;
  if (!provider && !wantVbee) return json({ error: 'Chưa cấu hình khoá giọng đọc AI', code: 'NO_KEY' }, 501);
  if (vc?.own) {
    // Khoá Vbee của khách: khách tự trả tiền giọng → không trừ lượt tạo giọng; vẫn bắt đăng nhập (không cho dùng máy chủ làm cầu nối tự do).
    // Xuất video vẫn tính lượt như thường (vt_export_begin).
    if (accountsOn()) {
      const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (!tok) return json({ error: 'Anh/chị cần đăng nhập để dùng AI', code: 'AUTH' }, 401);
      try { await rpc('vt_me', { p_token: tok }); }
      catch (e) { return json({ error: e.message || 'Phiên đăng nhập hết hạn', code: e.hint === 'LOCKED' ? 'LOCKED' : 'AUTH' }, 401); }
    }
  } else {
    const denied = await allowAi(req, 'tts', text.length, Number(body.lat), Number(body.lng));
    if (denied) return denied;
  }
  if (wantVbee) {
    try { return await viaVbee(vc, text, voice, speed); }
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
