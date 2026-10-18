// Cấu hình công khai cho trình duyệt.
// - Khoá ArcGIS dùng để tải ảnh vệ tinh ngay trên trình duyệt (Esri cho phép, giới hạn bằng Referrer URLs).
// - Mã Pixel Facebook/TikTok vốn là mã công khai, chỉ nhận chữ số/chữ cái để tránh chèn mã lạ.
import { env, json } from './vt.js';

const clean = (v, re) => (re.test(v || '') ? v : null);

export async function handleConfig() {
  return json({
    arcgis: env('ARCGIS_KEY') || null,
    meta_pixel: clean(String(env('META_PIXEL_ID')).trim(), /^\d{6,20}$/),
    tiktok_pixel: clean(String(env('TIKTOK_PIXEL_ID')).trim(), /^[A-Z0-9]{8,30}$/i),
  });
}
