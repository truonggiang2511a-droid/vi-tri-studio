// Service worker: giữ khung app để mở được nhanh và cài lên màn hình chính.
// Ảnh vệ tinh, dữ liệu tiện ích và đường đi luôn lấy mới từ mạng.
const VERSION = 'vitri-v23';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'vitri-fonts').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open('vitri-fonts').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Trang web căn nhà, ảnh căn nhà, API: luôn lấy từ mạng
  if (/^\/(can|m|goi|api)\//.test(url.pathname)) return;
  // Video phát theo từng đoạn (Range): để trình duyệt tự tải, không lưu vào bộ nhớ đệm
  if (req.headers.has('range') || /\.(mp4|webm|m4a)$/.test(url.pathname)) return;

  // Mạng trước, mất mạng thì dùng bản đã lưu
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
