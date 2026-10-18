// Webhook SePay: ngân hàng báo có tiền vào -> tìm mã đơn (VTxxxxxx) trong nội dung -> tự cộng lượt.
// Trong SePay: Tích hợp Webhooks -> URL https://<tên-miền>/api/sepay, chứng thực "API Key",
// nhập cùng khoá đó ở Trang quản trị > Cài đặt > Khoá webhook. Khoá chỉ được so khớp trong cơ sở dữ liệu.
import { json, rpc } from './vt.js';

export async function handleSepay(req) {
  if (req.method === 'GET') return json({ ok: true, hint: 'Gửi POST từ SePay' });
  if (req.method !== 'POST') return json({ success: false }, 405);
  const auth = req.headers.get('authorization') || '';
  const key = auth.replace(/^(Apikey|Bearer)\s+/i, '').trim();
  if (!key) return json({ success: false, error: 'Thiếu khoá' }, 401);
  let b;
  try { b = await req.json(); } catch { return json({ success: false, error: 'JSON lỗi' }, 400); }
  if (String(b.transferType || 'in').toLowerCase() !== 'in') return json({ success: true, ignored: 'out' });
  try {
    const r = await rpc('vt_payment_in', {
      p_key: key,
      p_source: 'sepay',
      p_ref: String(b.id ?? b.referenceCode ?? ''),
      p_amount: Math.round(Number(b.transferAmount) || 0),
      p_content: [b.code, b.content, b.description].filter(Boolean).join(' '),
      p_raw: b,
    });
    return json({ success: true, ...r });
  } catch (e) {
    if (e.hint === 'WEBHOOK') return json({ success: false, error: e.message }, 401);
    return json({ success: false, error: e.message }, 500);
  }
}
