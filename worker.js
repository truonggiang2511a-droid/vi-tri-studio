// Dự phòng khi dự án Cloudflare được tạo dạng "Worker" thay vì "Pages".
// Bản Pages dùng thư mục functions/ và bỏ qua file này.
import { setEnv } from './lib/vt.js';
import { handleTts } from './lib/tts.js';
import { handleScript } from './lib/script.js';
import { handleSepay } from './lib/sepay.js';
import { handleResolve } from './lib/resolve.js';
import { handleConfig } from './lib/config.js';
import { MEDIA_SIZES } from './lib/media-sizes.js';
import { handleMap } from './lib/map.js';
import { handleMedia, handleLead, handleTelegram, handleCan, handlePageEvent, handleCallLink, runCron } from './lib/pages.js';

const ROUTES = { '/api/tts': handleTts, '/api/script': handleScript, '/api/sepay': handleSepay, '/api/resolve': handleResolve, '/api/config': handleConfig };

// Video: phần tĩnh của Cloudflare không trả từng đoạn (Range), mà Safari/iPhone bắt buộc phải có
// mới phát được MP4. Worker tự cắt đúng đoạn được hỏi từ file gốc rồi trả mã 206.
async function serveMedia(request, env) {
  const url = new URL(request.url);
  const res = await env.ASSETS.fetch(new Request(url.origin + url.pathname, { method: 'GET' }));
  if (!res.ok || !res.body) return res;
  // Phần tĩnh không gửi kèm độ dài file, nên lấy độ dài ghi sẵn lúc đóng gói (build.sh)
  const size = Number(res.headers.get('content-length')) || MEDIA_SIZES[url.pathname] || 0;
  const headers = new Headers(res.headers);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=86400');
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Tên miền chính: địa chỉ cũ (…workers.dev) và www chuyển hẳn về vitristudio.com.
    // Riêng /api/* giữ nguyên để webhook SePay, Telegram đã đăng ký theo địa chỉ cũ vẫn chạy.
    const canon = (env.APP_URL || 'https://vitristudio.com').replace(/\/+$/, '');
    const canonHost = new URL(canon).hostname;
    if ((url.hostname === 'vi-tri-studio.truonggiang2511a.workers.dev' || url.hostname === 'www.' + canonHost)
        && (request.method === 'GET' || request.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
      return Response.redirect(canon + url.pathname + url.search, 301);
    }
    const path = url.pathname.replace(/\/+$/, '');
    if (path.startsWith('/api/map/')) { setEnv(env); return handleMap(request, ctx); }
    if (path.startsWith('/can/')) { setEnv(env); return handleCan(request); }
    if (path.startsWith('/m/')) { setEnv(env); return handleMedia(request, ctx); }
    if (path.startsWith('/goi/')) return handleCallLink(request);
    if (path === '/api/lead') { setEnv(env); return handleLead(request, ctx); }
    if (path === '/api/page-event') { setEnv(env); return handlePageEvent(request); }
    if (path === '/api/telegram' || path === '/api/telegram/setup') { setEnv(env); return handleTelegram(request); }
    const handler = ROUTES[path];
    if (handler) { setEnv(env); return handler(request); }
    if (/\.mp4$/.test(path) && (request.method === 'GET' || request.method === 'HEAD')) return serveMedia(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) {
    setEnv(env);
    ctx.waitUntil(runCron(event.cron).catch(e => console.log('cron', e.message)));
  },
};
