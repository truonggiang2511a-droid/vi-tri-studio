// Dùng chung cho các function máy chủ (Cloudflare Pages Functions): đọc biến môi trường, gọi hàm vt_* trên Supabase.
// URL và khoá publishable của Supabase là thông tin công khai (trình duyệt cũng dùng);
// mọi quyền đều nằm trong các hàm vt_* phía cơ sở dữ liệu.
// Cloudflare Pages truyền biến môi trường qua context.env; gọi setEnv() ở đầu mỗi function.
let ENV = {};
export const setEnv = e => { ENV = e || {}; };
export const env = k => (ENV[k] ?? globalThis.Netlify?.env?.get?.(k) ?? globalThis.Deno?.env?.get?.(k) ?? '') || '';

const SB_URL_DEF = 'https://crzinaydjgqepffatqoo.supabase.co';
const SB_KEY_DEF = 'sb_publishable_NhyivL-3owNWC6unb8GbZA_d135dx3i';
const sbUrl = () => env('VT_SUPABASE_URL') || SB_URL_DEF;
const sbKey = () => env('VT_SUPABASE_KEY') || SB_KEY_DEF;

export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

// Đặt VT_ACCOUNTS=off trong biến môi trường nếu muốn tạm mở giọng AI cho mọi người không cần đăng nhập
export const accountsOn = () => env('VT_ACCOUNTS') !== 'off';

export async function rpc(fn, args) {
  const key = sbKey();
  const headers = { apikey: key, 'content-type': 'application/json' };
  if (key.startsWith('eyJ')) headers.authorization = 'Bearer ' + key;
  const res = await fetch(`${sbUrl()}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(j?.message || 'Máy chủ tài khoản lỗi ' + res.status);
    e.hint = j?.hint || '';
    throw e;
  }
  return j;
}

// Kiểm tra phiên đăng nhập + lượt trước khi dùng dịch vụ AI tốn phí
export async function allowAi(req, kind, chars, lat, lng) {
  if (!accountsOn()) return null;
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Anh/chị cần đăng nhập để dùng AI', code: 'AUTH' }, 401);
  try {
    const r = await rpc('vt_ai_allow', {
      p_token: token, p_kind: kind, p_chars: chars,
      p_lat: Number.isFinite(lat) ? lat : null, p_lng: Number.isFinite(lng) ? lng : null,
    });
    if (!r?.ok) return json({ error: r?.message || 'Không đủ lượt', code: r?.code || 'NO_CREDIT' }, r?.code === 'DAILY_LIMIT' ? 429 : 402);
    return null;
  } catch (e) {
    if (e.hint === 'AUTH' || e.hint === 'LOCKED') return json({ error: e.message, code: e.hint }, 401);
    return json({ error: e.message }, 502);
  }
}
