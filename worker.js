// Dự phòng khi dự án Cloudflare được tạo dạng "Worker" thay vì "Pages".
// Bản Pages dùng thư mục functions/ và bỏ qua file này.
import { setEnv } from './lib/vt.js';
import { handleTts } from './lib/tts.js';
import { handleScript } from './lib/script.js';
import { handleSepay } from './lib/sepay.js';
import { handleResolve } from './lib/resolve.js';
import { handleConfig } from './lib/config.js';

const ROUTES = { '/api/tts': handleTts, '/api/script': handleScript, '/api/sepay': handleSepay, '/api/resolve': handleResolve, '/api/config': handleConfig };

// Video: phần tĩnh của Cloudflare không trả từng đoạn (Range), mà Safari/iPhone bắt buộc phải có
// mới phát được MP4. Worker tự cắt đúng đoạn được hỏi từ file gốc rồi trả mã 206.
async function serveMedia(request, env) {
  const url = new URL(request.url);
  const res = await env.ASSETS.fetch(new Request(url.origin + url.pathname, { method: 'GET' }));
  if (!res.ok || !res.body) return res;
  const size = Number(res.headers.get('content-length')) || 0;
  const headers = new Headers(res.headers);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=86400');
  headers.set('x-vt-range', (request.headers.get('range') || 'none') + ';size=' + size);
  const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') || '').trim());
  if (!m || !size || (m[1] === '' && m[2] === '')) {
    if (request.method === 'HEAD') { res.body.cancel(); return new Response(null, { status: 200, headers }); }
    return new Response(res.body, { status: 200, headers });
  }
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (start >= size || start > end) {
    res.body.cancel();
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  if (request.method === 'HEAD') { res.body.cancel(); return new Response(null, { status: 206, headers }); }
  const reader = res.body.getReader();
  let pos = 0;
  const body = new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { ctrl.close(); return; }
        const a = pos;
        pos += value.byteLength;
        if (pos <= start) continue;
        const s = Math.max(0, start - a), e = Math.min(value.byteLength, end + 1 - a);
        if (s < e) ctrl.enqueue(value.subarray(s, e));
        if (pos > end) { ctrl.close(); reader.cancel(); }
        return;
      }
    },
    cancel() { reader.cancel(); },
  });
  return new Response(body, { status: 206, headers });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    const handler = ROUTES[path];
    if (handler) { setEnv(env); return handler(request); }
    if (/\.mp4$/.test(path) && (request.method === 'GET' || request.method === 'HEAD')) return serveMedia(request, env);
    return env.ASSETS.fetch(request);
  },
};
