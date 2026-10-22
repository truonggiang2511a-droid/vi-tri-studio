// Meta Conversions API (CAPI): trình duyệt gửi sự kiện về đây, máy chủ bổ sung IP + trình duyệt,
// mã hoá SHA-256 email/số điện thoại rồi gửi thẳng cho Meta. Cùng event_id với Pixel nên Meta tự gộp, không đếm trùng.
// Cần đặt trên Cloudflare: META_PIXEL_ID (đã có) và META_CAPI_TOKEN (mã truy cập tạo trong Trình quản lý sự kiện).
// Tuỳ chọn: META_TEST_CODE (mã kiểm tra sự kiện, xoá đi khi chạy thật).
import { env, json } from './vt.js';

const ALLOWED = new Set(['CompleteRegistration', 'InitiateCheckout', 'Purchase', 'Lead', 'ViewContent']);

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Số Việt Nam 0912345678 / +84912345678 -> 84912345678 (định dạng Meta yêu cầu)
function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '84' + d.slice(1);
  return d.length >= 9 && d.length <= 15 ? d : '';
}
function pixelId() {
  const s = String(env('META_PIXEL_ID') || '');
  const m = s.match(/\d{6,20}/g) || [];
  return m.sort((a, b) => b.length - a.length)[0] || '';
}

export async function handleCapi(req) {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  const pid = pixelId(), token = env('META_CAPI_TOKEN');
  if (!pid || !token) return json({ ok: false, skip: 'chưa cấu hình' });
  let b;
  try { b = await req.json(); } catch { return json({ ok: false }, 400); }
  if (!ALLOWED.has(b.event)) return json({ ok: false }, 400);

  const ud = {
    client_ip_address: req.headers.get('cf-connecting-ip') || undefined,
    client_user_agent: req.headers.get('user-agent') || undefined,
    fbp: typeof b.fbp === 'string' ? b.fbp.slice(0, 200) : undefined,
    fbc: typeof b.fbc === 'string' ? b.fbc.slice(0, 300) : undefined,
    country: [await sha('vn')],
  };
  const login = String(b.login || '').trim().toLowerCase().slice(0, 120);
  if (login.includes('@')) ud.em = [await sha(login)];
  else { const ph = normPhone(login); if (ph) ud.ph = [await sha(ph)]; }
  if (login) ud.external_id = [await sha(login)];

  const ev = {
    event_name: b.event,
    event_time: Math.floor(Date.now() / 1000),
    event_id: String(b.event_id || '').slice(0, 64) || undefined,
    action_source: 'website',
    event_source_url: typeof b.url === 'string' ? b.url.slice(0, 500) : undefined,
    user_data: ud,
  };
  const v = Number(b.value);
  if (v > 0) ev.custom_data = { value: v, currency: 'VND', content_ids: b.id ? [String(b.id).slice(0, 40)] : undefined };

  const body = { data: [ev] };
  const test = env('META_TEST_CODE');
  if (test) body.test_event_code = test;
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pid}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) console.log('capi', JSON.stringify(j?.error || j));
    return json({ ok: r.ok, received: j.events_received || 0 });
  } catch (e) {
    return json({ ok: false, error: e.message }, 502);
  }
}
