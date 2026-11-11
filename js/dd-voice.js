// AI đạo diễn — giọng đọc + tài khoản (không phụ thuộc hộp thoại của trang chính index.html).
// Giọng: /api/tts của app (giọng Google HD / Vbee như kiểu cũ, cùng giới hạn lượt giọng mỗi căn). Có bộ nhớ theo câu:
// khách sửa / đổi thứ tự → chỉ câu mới phải đọc lại. Lượt: kiểm tra trước (vt_me), TRỪ SAU khi xuất xong (vt_export_begin).
import { rpc } from './account.js';
import { speakNumbers, speakPhones } from './vinum.js';
import { decodeAudioFile } from './export.js';
import { kvGet, kvPut } from './dd-photos.js';

const TOKEN_KEY = 'vitri.session.v1';
export const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const VOICE = { id: 'nu-nam', speed: 0 };   // giọng mặc định của app cũ

// Chữ hiển thị → chữ để đọc (giống speakable() của app cũ)
export function speakable(html) {
  const s = String(html || '').replace(/<[^>]+>/g, '')
    .replace(/TP\.?\s?HCM/gi, 'Thành phố Hồ Chí Minh').replace(/\bQL\.?\s?(?=\d)/g, 'quốc lộ ').replace(/\bKCN\b/g, 'khu công nghiệp')
    .replace(/\bUBND\b/gi, 'Ủy ban nhân dân').replace(/\bTHCS\b/g, 'trung học cơ sở').replace(/\bTHPT\b/g, 'trung học phổ thông')
    .replace(/(\d)\s*×\s*(\d)/g, '$1 nhân $2').replace(/m²/g, ' mét vuông').replace(/\s+[–-]\s+/g, ', ').replace(/[≈~]\s?/g, 'khoảng ');
  return speakNumbers(speakPhones(s)).replace(/&/g, ' và ').replace(/\s+/g, ' ').trim();
}

const cache = new Map();   // khoá: giọng|tốc độ|câu đọc → AudioBuffer (cả phiên)
const keyOf = text => `${VOICE.id}|${VOICE.speed}|${speakable(text)}`;
export const hasVoice = text => cache.has(keyOf(text));

async function ttsOnce(text, loc, attempt = 0) {
  const res = await fetch('/api/tts', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token() },
    body: JSON.stringify({ text, voice: VOICE.id, speed: VOICE.speed, lat: loc?.lat, lng: loc?.lng }),
  });
  if (res.status === 429 && attempt < 3) {   // máy chủ đông: xếp hàng thử lại như app cũ
    await new Promise(r => setTimeout(r, 3000 * (attempt + 1) + Math.random() * 1500));
    return ttsOnce(text, loc, attempt + 1);
  }
  if (res.status === 202) {   // FPT tạo chậm: hỏi lại tới khi có file
    let { pending } = await res.json(); const t0 = Date.now();
    while (pending && Date.now() - t0 < 180000) {
      await new Promise(r => setTimeout(r, 2500));
      const p = await fetch('/api/tts?poll=' + encodeURIComponent(pending));
      if (p.status === 202) continue;
      if (!p.ok) throw new Error('Không lấy được giọng đọc, thử lại.');
      return p.arrayBuffer();
    }
    throw new Error('Tạo giọng quá lâu, bấm lại sau ít phút.');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw Object.assign(new Error(j.error || 'Giọng đọc lỗi ' + res.status), { status: res.status, code: j.code });
  }
  return res.arrayBuffer();
}
// Đọc các câu còn thiếu (tối đa 3 câu cùng lúc), báo tiến độ; trả về Map câu → AudioBuffer.
// Giọng đã đọc lưu trên máy khách (IndexedDB, khoá = giọng|tốc độ|câu): tải lại trang, đi đăng nhập rồi quay lại,
// bấm dựng lại, đổi thứ tự… đều KHÔNG gọi máy chủ đọc lại — chỉ câu mới / câu đã sửa mới tốn lượt giọng.
export async function voiceLines(texts, loc, onProgress) {
  let need = [...new Set(texts.filter(Boolean))].filter(t => !cache.has(keyOf(t)));
  await Promise.all(need.map(async t => {
    const mp3 = await kvGet('voice|' + keyOf(t));
    if (mp3) { try { cache.set(keyOf(t), await decodeAudioFile(new Blob([mp3]))); } catch { /* hỏng thì đọc lại */ } }
  }));
  need = need.filter(t => !cache.has(keyOf(t)));
  let done = 0;
  onProgress?.(0, need.length);
  const queue = need.slice();
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      const buf = await ttsOnce(speakable(t), loc);
      cache.set(keyOf(t), await decodeAudioFile(new Blob([buf.slice(0)])));
      kvPut('voice|' + keyOf(t), buf);
      onProgress?.(++done, need.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return t => cache.get(keyOf(t)) || null;
}
export const voiceOf = t => cache.get(keyOf(t)) || null;

// ---- tài khoản / lượt ----
// Kiểm tra (không trừ): còn lượt, còn hạn không giới hạn, hoặc vị trí này đã xuất trong 24 giờ (xuất lại miễn phí)
export async function canExport(loc) {
  const t = token();
  if (!t) return { ok: false, code: 'LOGIN' };
  try {
    const r = await rpc('vt_me', { p_token: t, p_lat: loc.lat, p_lng: loc.lng });
    const p = r.profile || {};
    const free = r.reexport_until && new Date(r.reexport_until) > new Date();
    const unl = p.unlimited_until && new Date(p.unlimited_until) > new Date();
    if (free || unl || p.no_limits || (p.credits || 0) > 0) return { ok: true, profile: p };
    return { ok: false, code: 'NO_CREDIT', profile: p };
  } catch (e) {
    return { ok: false, code: e.hint === 'AUTH' ? 'LOGIN' : 'NET', message: e.message };
  }
}
// Trừ lượt SAU khi video đã xuất xong (1 vị trí = 1 lượt; xuất lại cùng vị trí trong 24 giờ không trừ thêm — luật SQL sẵn có)
export async function chargeExport(loc) {
  const r = await rpc('vt_export_begin', { p_token: token(), p_lat: loc.lat, p_lng: loc.lng });
  return r;   // { ok, code, message, charged, mode, until, redo, profile }
}
