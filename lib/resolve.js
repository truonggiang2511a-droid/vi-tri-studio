// Mở link rút gọn Google Maps (maps.app.goo.gl/…) để lấy link đầy đủ có toạ độ và tên địa điểm.
// Chỉ đi theo chuyển hướng trong các tên miền của Google, không làm proxy cho trang khác.
import { json } from './vt.js';

const START = /^(maps\.app\.goo\.gl|goo\.gl)$/i;
const ALLOWED = /(^|\.)(goo\.gl|google\.com|google\.com\.vn|app\.goo\.gl)$/i;

export async function handleResolve(req) {
  const u = new URL(req.url).searchParams.get('u') || '';
  let cur;
  try { cur = new URL(u.trim()); } catch { return json({ error: 'Link không hợp lệ' }, 400); }
  if (cur.protocol !== 'https:' || !START.test(cur.hostname) || (cur.hostname === 'goo.gl' && !cur.pathname.startsWith('/maps'))) {
    return json({ error: 'Chỉ nhận link rút gọn Google Maps' }, 400);
  }
  try {
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetch(cur.href, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', 'accept-language': 'vi' }, signal: AbortSignal.timeout(8000) });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        const next = new URL(loc, cur);
        if (!ALLOWED.test(next.hostname)) return json({ url: next.href });
        cur = next;
        if (/[@!]3d|@-?\d|[?&](q|ll)=-?\d/.test(cur.href)) return json({ url: cur.href });
        continue;
      }
      // Một số link trả trang HTML có sẵn toạ độ trong nội dung
      if (res.ok) {
        const html = (await res.text()).slice(0, 400000);
        const m = html.match(/https:\/\/www\.google\.[a-z.]+\/maps\/place\/[^"'\\\s]+/) || html.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (m) return json({ url: m[0].startsWith('http') ? m[0] : cur.href + m[0] });
      }
      return json({ url: cur.href });
    }
    return json({ url: cur.href });
  } catch (e) {
    return json({ error: 'Không mở được link: ' + (e.message || e) }, 502);
  }
}
