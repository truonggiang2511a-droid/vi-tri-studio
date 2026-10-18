// Dự phòng khi dự án Cloudflare được tạo dạng "Worker" thay vì "Pages".
// Bản Pages dùng thư mục functions/ và bỏ qua file này.
import { setEnv } from './lib/vt.js';
import { handleTts } from './lib/tts.js';
import { handleScript } from './lib/script.js';
import { handleSepay } from './lib/sepay.js';
import { handleResolve } from './lib/resolve.js';

const ROUTES = { '/api/tts': handleTts, '/api/script': handleScript, '/api/sepay': handleSepay, '/api/resolve': handleResolve };

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    const handler = ROUTES[path];
    if (handler) { setEnv(env); return handler(request); }
    return env.ASSETS.fetch(request);
  },
};
