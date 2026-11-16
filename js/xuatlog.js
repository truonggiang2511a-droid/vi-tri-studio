// Đo xuất video trên máy khách THẬT (16/11, Giang: không biết khách tải về từ điện thoại có nhanh không, còn văng ra như đợt trước không).
// Phễu nội bộ vt_visits — KHÔNG gửi Meta/TikTok, không đổi chất lượng video, khách không thấy gì khác.
//  f_<app>xt_<máy>_<khổ>_<phút>  xuất xong: ≤1 / 2 / 4 / 8 phút, 99 = lâu hơn 8 phút
//  f_<app>xv_<máy>_<khổ>_<%>     dừng giữa chừng mà trang KHÔNG đóng bình thường (văng vì hết RAM, hoặc máy tự đóng tab khi chuyển app);
//                                 % = đang ở tiến độ < 25 / 50 / 75 / 95 / 100 (≥ 95 = đang ghép file + ảnh bìa)
//  f_<app>xv_bg_<máy>            trong số trên: có chuyển sang app khác lúc đang xuất
//  f_<app>xr_<máy>_<khổ>         khách tự tắt / rời trang lúc đang xuất
// <app>: '' = app cũ, 'd' = AI đạo diễn; <máy>: ip (iPhone/iPad), an (Android), any (Android RAM ≤ 4 GB), pc (máy tính); <khổ>: 1080 | 720.
// Cách bắt văng: lúc bắt đầu xuất ghi dấu vào localStorage (+ nhịp 5 s); xong / lỗi / huỷ thì xoá; lần mở app sau còn dấu → đếm 1 lần.
import { funnel } from './track.js';

const KEY = 'vitri.xuatDang';
const put = r => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* bỏ qua */ } };
const drop = () => { try { localStorage.removeItem(KEY); } catch { /* bỏ qua */ } };

export function devClass() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ip';
  if (/Android/i.test(ua)) return navigator.deviceMemory && navigator.deviceMemory <= 4 ? 'any' : 'an';
  return 'pc';
}

export function xuatStart(app, res) {
  const rec = { app, dev: devClass(), res: res >= 1000 ? 1080 : 720, t: Date.now(), beat: Date.now(), pct: 0, bg: false, hide: false };
  put(rec);
  let last = 0, ended = false;
  const beat = setInterval(() => { rec.beat = Date.now(); put(rec); }, 5000);
  const onVis = () => { if (document.visibilityState === 'hidden') { rec.bg = true; put(rec); } };
  const onHide = () => { rec.hide = true; put(rec); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
  const end = () => {
    if (ended) return;
    ended = true;
    clearInterval(beat);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pagehide', onHide);
    drop();
  };
  return {
    pct(p) { if (!ended && p - last >= 5) { last = p; rec.pct = Math.round(p); put(rec); } },
    done() {
      if (ended) return;
      const min = (Date.now() - rec.t) / 60000, b = [1, 2, 4, 8].find(x => min <= x) ?? 99;
      funnel(`${app}xt_${rec.dev}_${rec.res}_${b}`, true);
      end();
    },
    end,   // lỗi đã báo / khách bấm huỷ / đi đăng nhập: chỉ xoá dấu, không tính là văng
  };
}

// Gọi lúc mở app: dấu còn lại từ lần trước = lần xuất đó không kết thúc bình thường
export function xuatCheckCrash() {
  let r = null;
  try { r = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* bỏ qua */ }
  if (!r || !r.t) return;
  if (Date.now() - (r.beat || r.t) < 15000) return;   // tab khác đang xuất (nhịp còn mới) → để yên
  drop();
  if (Date.now() - r.t > 2 * 86400000) return;   // dấu quá cũ: bỏ
  const app = r.app || '';
  if (r.hide) { funnel(`${app}xr_${r.dev}_${r.res}`, true); return; }
  const b = [25, 50, 75, 95].find(x => (r.pct || 0) < x) ?? 100;
  funnel(`${app}xv_${r.dev}_${r.res}_${b}`, true);
  if (r.bg) funnel(`${app}xv_bg_${r.dev}`, true);
}
