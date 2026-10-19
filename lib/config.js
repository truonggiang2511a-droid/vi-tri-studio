// Cấu hình công khai cho trình duyệt.
// - Khoá ArcGIS dùng để tải ảnh vệ tinh ngay trên trình duyệt (Esri cho phép, giới hạn bằng Referrer URLs).
// - Mã Pixel Facebook/TikTok vốn là mã công khai, chỉ nhận chữ số/chữ cái để tránh chèn mã lạ.
import { env, json } from './vt.js';

const clean = (v, re) => (re.test(v || '') ? v : null);
// Nhận cả khi dán nguyên đoạn mã Pixel của Meta: lấy số trong fbq('init', '...'), không thì lấy dãy số dài nhất
function pixelId(v) {
  const s = String(v || '');
  const m = s.match(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{6,20})['"]/) || s.match(/[?&]id=(\d{6,20})/);
  if (m) return m[1];
  const nums = s.match(/\d{6,20}/g) || [];
  return nums.sort((a, b) => b.length - a.length)[0] || '';
}

export async function handleConfig() {
  return json({
    arcgis: env('ARCGIS_KEY') || null,
    meta_pixel: clean(pixelId(env('META_PIXEL_ID')), /^\d{6,20}$/),
    tiktok_pixel: clean(String(env('TIKTOK_PIXEL_ID')).trim(), /^[A-Z0-9]{8,30}$/i),
    tg_bot: env('TELEGRAM_BOT_TOKEN') ? clean(String(env('TELEGRAM_BOT_NAME')).trim().replace(/^@/, ''), /^[A-Za-z0-9_]{5,40}$/) : null,
  });
}
