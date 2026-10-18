// Cấu hình công khai cho trình duyệt. Khoá ArcGIS dùng để tải ảnh vệ tinh ngay trên trình duyệt
// (Esri cho phép dùng khoá ở phía khách, giới hạn bằng Referrer URLs), nên được trả về ở đây.
import { env, json } from './vt.js';

export async function handleConfig() {
  return json({ arcgis: env('ARCGIS_KEY') || null });
}
