// Nhận ra máy đã nhận lượt dùng thử (chống tạo tài khoản liên tục trên cùng một điện thoại).
// - Mã thiết bị: số ngẫu nhiên lưu 3 nơi (localStorage, cookie, IndexedDB); xoá một nơi vẫn khôi phục từ nơi khác.
// - Dấu vân tay máy: băm cấu hình máy (màn hình, trình duyệt, cách vẽ chữ…), dùng khi khách mở ẩn danh hoặc xoá dữ liệu.
// Không đọc thông tin cá nhân nào; chỉ gửi đi chuỗi băm.
const KEY = 'vitri.dev.v1';
const COOKIE = 'vtdev';

function readCookie() {
  const m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function writeCookie(v) {
  try { document.cookie = `${COOKIE}=${encodeURIComponent(v)}; max-age=34560000; path=/; samesite=lax; secure`; } catch { /* bỏ qua */ }
}
function idb(mode, value) {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('vitri', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('kv', mode === 'get' ? 'readonly' : 'readwrite');
          const st = tx.objectStore('kv');
          const r = mode === 'get' ? st.get('dev') : st.put(value, 'dev');
          r.onsuccess = () => resolve(mode === 'get' ? r.result || null : value);
          r.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
    } catch { resolve(null); }
  });
}
const valid = v => typeof v === 'string' && /^[a-z0-9-]{16,64}$/.test(v);

let devPromise = null;
export function deviceId() {
  if (!devPromise) {
    devPromise = (async () => {
      let ls = null;
      try { ls = localStorage.getItem(KEY); } catch { /* bỏ qua */ }
      const ck = readCookie();
      const db = await Promise.race([idb('get'), new Promise(r => setTimeout(() => r(null), 800))]);
      let id = [ls, ck, db].find(valid);
      if (!id) id = (crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));
      try { localStorage.setItem(KEY, id); } catch { /* bỏ qua */ }
      writeCookie(id);
      idb('put', id);
      return id;
    })();
  }
  return devPromise;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
let fpPromise = null;
export function fingerprint() {
  if (!fpPromise) {
    fpPromise = (async () => {
      const parts = [navigator.userAgent, navigator.language, navigator.platform, navigator.hardwareConcurrency, navigator.deviceMemory,
        screen.width, screen.height, screen.colorDepth, devicePixelRatio, Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.maxTouchPoints];
      try {
        const c = document.createElement('canvas');
        c.width = 240; c.height = 60;
        const g = c.getContext('2d');
        g.textBaseline = 'top'; g.font = '16px Arial'; g.fillStyle = '#f60'; g.fillRect(100, 1, 62, 20);
        g.fillStyle = '#069'; g.fillText('Vị Trí Studio ₫ 😀', 2, 15);
        g.fillStyle = 'rgba(102,204,0,0.7)'; g.fillText('Vị Trí Studio ₫ 😀', 4, 17);
        parts.push(c.toDataURL());
      } catch { /* bỏ qua */ }
      try {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        if (ext) parts.push(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      } catch { /* bỏ qua */ }
      try { return (await sha256(parts.join('|'))).slice(0, 40); } catch { return null; }
    })();
  }
  return fpPromise;
}
