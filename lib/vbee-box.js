// Hộp nhận kết quả giọng Vbee (25/10/2026).
// Vbee kiểu async gọi về webhookUrl (POST, snake_case: request_id, status SUCCESS/FAILURE, audio_link) khi tạo xong.
// Gói Vbee của khách có thể KHÔNG cho dùng API hỏi kết quả (GET /v1/tts/requests/{id} → "This feature is not supported
// in user package") → yêu cầu tạo giọng đang chờ phải nhận kết quả qua webhook. Webhook có thể tới trạm Cloudflare khác
// trạm đang chờ, nên dùng Durable Object theo request_id làm điểm hẹn: /put ghi kết quả, /wait chờ tới khi có (hoặc hết giờ).
import { env } from './vt.js';

export function vbeeBoxStub(requestId) {
  const ns = env('VBEE_BOX');
  if (!ns || typeof ns.idFromName !== 'function' || !requestId) return null;
  return ns.get(ns.idFromName('vbee:' + requestId));
}

// Webhook: lưu kết quả vào hộp của request_id
export async function vbeeHookPut(body) {
  const id = String(body?.request_id || body?.requestId || '').trim();
  const stub = vbeeBoxStub(id);
  if (!stub) return false;
  await stub.fetch('https://box.internal/put', { method: 'POST', body: JSON.stringify(body) });
  return true;
}

// Chờ kết quả tối đa ms; trả { status, audio_link, ... } hoặc null khi hết giờ / không có hộp
export async function vbeeHookWait(requestId, ms) {
  const stub = vbeeBoxStub(requestId);
  if (!stub) return null;
  try {
    const r = await stub.fetch('https://box.internal/wait?ms=' + ms);
    if (r.status !== 200) return null;
    return await r.json();
  } catch { return null; }
}

export class VbeeBox {
  constructor(state) { this.state = state; this.waiters = []; }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/put') {
      const data = await req.json().catch(() => null);
      if (!data) return new Response('bad', { status: 400 });
      await this.state.storage.put('r', data);
      await this.state.storage.setAlarm(Date.now() + 15 * 60 * 1000); // tự xoá sau 15 phút
      for (const w of this.waiters.splice(0)) w(data);
      return new Response('ok');
    }
    if (url.pathname === '/wait') {
      const have = await this.state.storage.get('r');
      if (have) return Response.json(have);
      const ms = Math.min(90000, Math.max(1000, Number(url.searchParams.get('ms')) || 60000));
      const data = await new Promise(resolve => {
        const t = setTimeout(() => { this.waiters = this.waiters.filter(w => w !== done); resolve(null); }, ms);
        const done = d => { clearTimeout(t); resolve(d); };
        this.waiters.push(done);
      });
      return data ? Response.json(data) : new Response('timeout', { status: 204 });
    }
    return new Response('not found', { status: 404 });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}
