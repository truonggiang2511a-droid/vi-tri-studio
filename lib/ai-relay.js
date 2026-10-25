// Gọi AI (Anthropic/Gemini) qua một trạm chuyển tiếp CỐ ĐỊNH ở Mỹ.
// Lý do (25/10/2026): Worker chạy ở trạm Cloudflare gần người dùng; mạng Việt Nam hay đi qua trạm Hồng Kông,
// mà Anthropic/Gemini chặn yêu cầu từ Hồng Kông → lỗi 403 "Request not allowed" (thử từ iPhone của Giang).
// Durable Object được tạo với locationHint 'enam' (miền đông Mỹ) và ở đó mãi, nên mọi lời gọi AI đi ra từ Mỹ.
// Không có binding AI_RELAY (vd. bản Pages dự phòng) hoặc trạm lỗi → gọi thẳng như trước.
import { env } from './vt.js';

const ALLOW = /^https:\/\/(api\.anthropic\.com\/v1\/|generativelanguage\.googleapis\.com\/v1beta\/|www\.cloudflare\.com\/cdn-cgi\/trace$)/;
const RELAY_NAME = 'ai-relay-us-1';

export async function aiFetch(url, init = {}) {
  const ns = env('AI_RELAY');
  if (ns && typeof ns.idFromName === 'function') {
    try {
      const stub = ns.get(ns.idFromName(RELAY_NAME), { locationHint: 'enam' });
      const headers = new Headers(init.headers || {});
      headers.set('x-relay-url', url);
      headers.set('x-relay-method', init.method || 'GET');
      const res = await stub.fetch('https://relay.internal/', { method: 'POST', headers, body: init.body ?? '', signal: init.signal });
      if (res.headers.get('x-relay') === '1') return res;
      console.log('ai-relay: trạm trả lời lạ', res.status);
    } catch (e) {
      console.log('ai-relay lỗi, gọi thẳng:', String(e?.message || e).slice(0, 200));
    }
  }
  return fetch(url, init);
}

// Durable Object: chỉ chuyển tiếp tới danh sách địa chỉ AI cho phép, không lưu gì.
export class AiRelay {
  constructor(state, envObj) { this.state = state; }
  async fetch(req) {
    const url = req.headers.get('x-relay-url') || '';
    const method = (req.headers.get('x-relay-method') || 'POST').toUpperCase();
    if (!ALLOW.test(url) || !['GET', 'POST'].includes(method)) return new Response('Không cho phép', { status: 400 });
    const headers = new Headers();
    for (const [k, v] of req.headers) {
      if (/^(x-relay-|cf-|x-forwarded|host$|content-length$)/i.test(k)) continue;
      headers.set(k, v);
    }
    const res = await fetch(url, { method, headers, body: method === 'GET' ? undefined : await req.arrayBuffer() });
    const out = new Headers(res.headers);
    out.set('x-relay', '1');
    return new Response(res.body, { status: res.status, headers: out });
  }
}

// Kiểm tra trạm đang ở đâu: trả về colo của trạm chuyển tiếp (vd. IAD) + colo của yêu cầu hiện tại
export async function relayDiag(req) {
  let relay = null;
  try {
    const r = await aiFetch('https://www.cloudflare.com/cdn-cgi/trace', { method: 'GET' });
    const t = await r.text();
    relay = { via: r.headers.get('x-relay') === '1' ? 'relay' : 'direct', colo: (t.match(/colo=(\w+)/) || [])[1], loc: (t.match(/loc=(\w+)/) || [])[1] };
  } catch (e) { relay = { error: String(e?.message || e) }; }
  return { edge: req.cf?.colo || null, relay };
}
