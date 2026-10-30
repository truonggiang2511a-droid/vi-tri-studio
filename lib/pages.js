// Trang web riêng cho từng căn (/can/<mã>), ảnh căn nhà (/m/...), khách để lại số (/api/lead), bot Telegram báo khách mới.
// - Ảnh nằm ở Supabase Storage (bucket vt-pages); worker phục vụ lại qua bộ nhớ đệm Cloudflare để đỡ tốn băng thông.
// - Báo khách mới qua Telegram: đặt TELEGRAM_BOT_TOKEN (+ TELEGRAM_BOT_NAME, TELEGRAM_SECRET) trong biến môi trường Cloudflare,
//   rồi mở Trang quản trị > Cài đặt > "Kết nối bot Telegram" một lần để đăng ký webhook.
import { env, json, rpc } from './vt.js';

const SB_URL = () => env('VT_SUPABASE_URL') || 'https://crzinaydjgqepffatqoo.supabase.co';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sameOrigin = req => {
  const from = req.headers.get('origin') || req.headers.get('referer') || '';
  return !from || from.startsWith(new URL(req.url).origin);
};

// ---------- Ảnh ----------
export async function handleMedia(request, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/m\//, '');
  if (!/^p\/[a-z0-9]{8,40}\/[a-f0-9]{8,40}\.jpg$/.test(path)) return new Response('Không có', { status: 404 });
  const cache = globalThis.caches?.default;
  const key = new Request(url.origin + '/m/' + path);
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }
  const res = await fetch(`${SB_URL()}/storage/v1/object/public/vt-pages/${path}`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) return new Response('Không có', { status: 404, headers: { 'cache-control': 'public, max-age=60' } });
  const out = new Response(res.body, {
    headers: { 'content-type': res.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
  });
  if (cache) ctx?.waitUntil?.(cache.put(key, out.clone()).catch(() => {}));
  return out;
}

// ---------- Khách để lại số ----------
const WANT = { xem: 'Hẹn đi xem nhà', gia: 'Hỏi giá & pháp lý', vay: 'Tư vấn vay ngân hàng' };
export async function handleLead(request, ctx) {
  if (request.method !== 'POST') return json({ error: 'Chỉ nhận POST' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Không được phép' }, 403);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Dữ liệu lỗi' }, 400); }
  if (b.hp) return json({ ok: true }); // ô bẫy chống máy tự điền
  try {
    const r = await rpc('vt_lead_submit2', {
      p_slug: String(b.slug || '').slice(0, 20), p_name: String(b.name || '').slice(0, 60), p_phone: String(b.phone || '').slice(0, 20),
      p_want: WANT[b.want] || '', p_note: String(b.note || '').slice(0, 500), p_ip: request.headers.get('cf-connecting-ip') || '',
    });
    if (r?.notify) ctx?.waitUntil?.(notifyLead(r.notify, new URL(request.url).origin).catch(() => {}));
    return json({ ok: true, dup: !!r?.dup });
  } catch (e) {
    return json({ error: e.message || 'Chưa gửi được, thử lại giúp em' }, e.hint === 'INPUT' || e.hint === 'LIMIT' ? 400 : 502);
  }
}

// ---------- Telegram ----------
async function tg(method, body) {
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  return res.json().catch(() => null);
}
async function notifyLead(n, origin) {
  const lines = [
    '🔔 <b>Khách mới để lại số</b>',
    `👤 ${esc(n.name || 'Khách')} — <b>${esc(n.phone)}</b>`,
    n.want ? `🎯 ${esc(n.want)}` : '',
    n.note ? `📝 ${esc(n.note)}` : '',
    `🏠 ${esc(n.title || 'Căn nhà')}${n.price ? ' · ' + esc(n.price) : ''}`,
    `${origin}/can/${esc(n.slug)}`,
    '',
    'Gọi lại trong 5 phút đầu để tăng khả năng chốt. Cập nhật trạng thái ở mục Khách quan tâm trong app.',
  ].filter((x, i) => x || i === 6);
  await tg('sendMessage', {
    chat_id: n.chat, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: leadButtons(n, origin),
  });
}
const ST_LABEL = { da_lien_he: 'Đã liên hệ', hen_xem: 'Hẹn xem nhà', dam_phan: 'Đang đàm phán', chot: 'Đã chốt', khong_mua: 'Không mua' };
function leadButtons(n, origin) {
  const rows = [[{ text: '📞 Gọi ' + n.phone, url: `${origin}/goi/${encodeURIComponent(n.phone)}` }]];
  if (n.id) rows.push([
    { text: '✅ Đã gọi', callback_data: `st:${n.id}:da_lien_he` },
    { text: '📅 Hẹn xem', callback_data: `st:${n.id}:hen_xem` },
    { text: '❌ Không mua', callback_data: `st:${n.id}:khong_mua` },
  ]);
  return { inline_keyboard: rows };
}
const appUrl = () => (env('APP_URL') || 'https://vitristudio.com').replace(/\/+$/, '');
const vnTime = iso => {
  const d = new Date(new Date(iso).getTime() + 7 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};

// ---------- Việc định kỳ (Cloudflare Cron) ----------
// Mỗi 30 phút: nhắc khách để lại số quá 2 giờ chưa gọi (chỉ 7h–21h giờ Việt Nam). Sáng thứ Hai 8h: báo cáo tuần.
export async function runCron(cron) {
  const key = env('TELEGRAM_SECRET');
  if (!key || !env('TELEGRAM_BOT_TOKEN')) return;
  const origin = appUrl();
  if (cron === '0 1 * * 1') {
    const list = await rpc('vt_cron_weekly', { p_key: key });
    for (const w of list || []) {
      const t = w.top;
      const lines = [
        `📊 <b>Báo cáo tuần</b> — ${esc(w.name)}`,
        '',
        `👁 ${w.views} lượt xem trang căn nhà`,
        `🙋 ${w.leads} khách mới để lại số`,
        `📅 ${w.booked} khách hẹn xem · 🏆 ${w.won} chốt`,
        w.pending ? `⏳ <b>${w.pending} khách chưa liên hệ</b> — gọi lại ngay hôm nay nhé` : '✅ Không còn khách nào chờ gọi lại',
        t && (t.views || t.leads) ? `🔥 Căn hút nhất: <b>${esc(t.title || 'Căn nhà')}</b>${t.price ? ' · ' + esc(t.price) : ''} (${t.views} xem, ${t.leads} khách)` : '',
        '',
        !w.leads ? '💡 Tuần này chưa có khách. Gắn link trang web căn nhà vào bài đăng, bình luận ghim và nhóm mua bán để khách bấm vào.' : '',
      ].filter((x, i, a) => x || (i > 0 && a[i - 1]));
      await tg('sendMessage', {
        chat_id: w.chat, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: 'Mở sổ khách', url: `${origin}/#khach` }]] },
      }).catch(() => {});
    }
    return;
  }
  const vnHour = (new Date().getUTCHours() + 7) % 24;
  if (vnHour < 7 || vnHour >= 21) return;
  const due = await rpc('vt_cron_reminders', { p_key: key });
  for (const n of due || []) {
    const lines = [
      '⏰ <b>Khách chưa được gọi lại</b>',
      `👤 ${esc(n.name || 'Khách')} — <b>${esc(n.phone)}</b>`,
      n.want ? `🎯 ${esc(n.want)}` : '',
      `🏠 ${esc(n.title || 'Căn nhà')}${n.price ? ' · ' + esc(n.price) : ''}`,
      `Để lại số lúc ${vnTime(n.created_at)}. Gọi lại sớm tỉ lệ chốt cao hơn nhiều.`,
    ].filter(Boolean);
    await tg('sendMessage', { chat_id: n.chat, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: leadButtons(n, origin) }).catch(() => {});
  }
}
export async function handleTelegram(request) {
  const url = new URL(request.url);
  // Đăng ký webhook (chủ app bấm trong Trang quản trị)
  if (url.pathname.endsWith('/setup')) {
    const key = request.headers.get('x-admin-key') || '';
    try { await rpc('vt_admin_settings', { p_key: key }); } catch { return json({ error: 'Sai mã quản trị' }, 401); }
    if (!env('TELEGRAM_BOT_TOKEN')) return json({ error: 'Chưa đặt TELEGRAM_BOT_TOKEN trên Cloudflare' }, 400);
    if (!env('TELEGRAM_SECRET')) return json({ error: 'Chưa đặt TELEGRAM_SECRET trên Cloudflare' }, 400);
    try { await rpc('vt_admin_set_cron_key', { p_key: key, p_cron: env('TELEGRAM_SECRET') }); } catch (e) { return json({ error: e.message }, 400); }
    const r = await tg('setWebhook', {
      url: url.origin + '/api/telegram', secret_token: env('TELEGRAM_SECRET') || undefined, allowed_updates: ['message', 'callback_query'],
    });
    const me = await tg('getMe', {});
    return json({ ok: !!r?.ok, bot: me?.result?.username || '', detail: r?.description || '' });
  }
  if (request.method !== 'POST') return json({ ok: true });
  const secret = env('TELEGRAM_SECRET');
  if (secret && request.headers.get('x-telegram-bot-api-secret-token') !== secret) return json({ ok: false }, 401);
  const u = await request.json().catch(() => null);
  // Môi giới bấm nút trạng thái trong tin báo khách
  const cq = u?.callback_query;
  if (cq) {
    const mm = String(cq.data || '').match(/^st:([0-9a-f-]{36}):([a-z_]+)$/);
    let note = 'Không cập nhật được';
    if (mm && cq.message?.chat?.id) {
      const r = await rpc('vt_tg_lead_status', { p_key: secret, p_chat: String(cq.message.chat.id), p_lead: mm[1], p_status: mm[2] }).catch(() => null);
      if (r?.ok) {
        note = 'Đã cập nhật: ' + (ST_LABEL[mm[2]] || mm[2]);
        const kb = (cq.message.reply_markup?.inline_keyboard || []).slice(0, 1);
        kb.push([{ text: '✔ ' + (ST_LABEL[mm[2]] || mm[2]), callback_data: 'noop' }]);
        await tg('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: kb } }).catch(() => {});
      }
    }
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: cq.data === 'noop' ? 'Đổi trạng thái khác trong app, mục Khách' : note }).catch(() => {});
    return json({ ok: true });
  }
  const m = u?.message;
  if (!m?.chat?.id) return json({ ok: true });
  const text = String(m.text || '').trim();
  const code = (text.match(/^\/start\s+([a-f0-9]{10,40})$/) || [])[1];
  if (code) {
    const r = await rpc('vt_tg_link', { p_code: code, p_chat: String(m.chat.id), p_name: m.from?.username || m.from?.first_name || '' }).catch(() => null);
    await tg('sendMessage', {
      chat_id: m.chat.id,
      text: r?.ok
        ? `✅ Đã kết nối với tài khoản ${r.name} trên Vị Trí Studio. Có khách để lại số ở trang web căn nhà, em sẽ báo ngay tại đây.`
        : 'Mã kết nối đã hết hạn. Mở app > Khách quan tâm > Kết nối Telegram để lấy mã mới.',
    });
  } else {
    await tg('sendMessage', { chat_id: m.chat.id, text: 'Em là bot báo khách của Vị Trí Studio. Kết nối trong app: Khách quan tâm > Kết nối Telegram.' });
  }
  return json({ ok: true });
}

// ---------- Trang web căn nhà ----------
const THEMES = {
  neon: { acc: '#5EEAF5', accInk: '#04161a', bg: '#0e1513', card: '#16211e', ink: '#eef4f1', mute: '#9fb3ab', font: '' },
  sangtrong: { acc: '#C9A35A', accInk: '#17120a', bg: '#12100d', card: '#1c1814', ink: '#f6efe3', mute: '#b9ab94', font: '"Playfair Display", Georgia, serif' },
  tretrung: { acc: '#FF4FA3', accInk: '#ffffff', bg: '#1a0f2e', card: '#26173f', ink: '#ffffff', mute: '#c7b6e6', font: '"Baloo 2", sans-serif' },
  toigian: { acc: '#11161b', accInk: '#ffffff', bg: '#f4f5f5', card: '#ffffff', ink: '#11161b', mute: '#5d676e', font: '' },
  doruc: { acc: '#FF4D3D', accInk: '#ffffff', bg: '#1a0b0b', card: '#2a1212', ink: '#fff2f0', mute: '#d6aea8', font: '' },
  xanhla: { acc: '#4ADE80', accInk: '#05210F', bg: '#0b1a12', card: '#12261b', ink: '#effaf3', mute: '#a3c4b0', font: '' },
};
const CAT_ICON = { truong: '🏫', yte: '🏥', cho: '🛒', hanhchinh: '🏛️', congvien: '🌳', kcn: '🏭', giaothong: '🚉', nganhang: '🏦', khudothi: '🏙️', congcong: '📍' };

function videoEmbed(u) {
  if (!u) return null;
  let m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/))([\w-]{6,20})/);
  if (m) return { src: `https://www.youtube.com/embed/${m[1]}?rel=0&playsinline=1`, tall: /shorts\//.test(u) };
  m = u.match(/tiktok\.com\/.*\/video\/(\d{8,25})/);
  if (m) return { src: `https://www.tiktok.com/embed/v2/${m[1]}`, tall: true, tiktok: true };
  if (/facebook\.com|fb\.watch/.test(u) && !/fb\.watch/.test(u)) {
    return { src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u)}&show_text=false&width=560`, tall: /\/reel\//.test(u) };
  }
  return { link: u };
}
const zaloLink = p => 'https://zalo.me/' + String(p || '').replace(/^\+?84/, '0').replace(/\D/g, '');
const fmtKm = km => km == null ? '' : km < 1 ? Math.round(km * 1000 / 10) * 10 + ' m' : (Math.round(km * 10) / 10).toString().replace('.', ',') + ' km';

function pageHtml(p, origin) {
  const T = THEMES[p.style] || THEMES.neon;
  const photos = (p.photos || []).map(x => `${origin}/m/${x}`);
  const title = p.title || 'Căn nhà đang bán';
  const head = [p.price, title].filter(Boolean).join(' · ');
  const info = [p.area, p.beds && (/^\d+$/.test(p.beds) ? p.beds + ' phòng ngủ' : p.beds), p.legal].filter(Boolean);
  const desc = [p.address, ...info].filter(Boolean).join(' · ');
  const vid = videoEmbed(p.video_url);
  const near = [
    ...(p.roads || []).map(r => ({ ic: '🛣️', name: r.label, d: r.km, sub: r.km < 0.12 ? 'Mặt tiền' : 'Trục đường lớn' })),
    ...(p.pois || []).map(x => ({ ic: CAT_ICON[x.cat] || '📍', name: x.name, d: x.km, sub: x.catName || '' })),
  ].filter(x => x.name);
  const url = `${origin}/can/${p.slug}`;
  const phone = String(p.phone || '');
  const hasLoc = Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const data = JSON.stringify({ slug: p.slug }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(head)}</title>
<meta name="description" content="${esc(desc || title)}">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(head)}"><meta property="og:description" content="${esc(desc || 'Xem vị trí, tiện ích và hình ảnh thực tế')}">
${photos[0] ? `<meta property="og:image" content="${esc(photos[0])}"><meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="${T.bg}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;700;800&family=Playfair+Display:wght@700&family=Baloo+2:wght@700;800&display=swap">
<style>
:root{--acc:${T.acc};--accInk:${T.accInk};--bg:${T.bg};--card:${T.card};--ink:${T.ink};--mute:${T.mute};--hf:${T.font || '"Be Vietnam Pro",system-ui,sans-serif'}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font:16px/1.55 "Be Vietnam Pro",system-ui,sans-serif;padding-bottom:calc(84px + env(safe-area-inset-bottom))}
a{color:inherit}.wrap{max-width:720px;margin:0 auto}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px}
.brand{font-weight:800;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.call{display:inline-flex;align-items:center;gap:6px;background:var(--acc);color:var(--accInk);font-weight:800;text-decoration:none;border-radius:99px;padding:8px 14px;font-size:14px;white-space:nowrap}
.gal{position:relative}.slides{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}.slides::-webkit-scrollbar{display:none}
.slides img{flex:0 0 100%;width:100%;aspect-ratio:4/3;object-fit:cover;scroll-snap-align:center;background:#0003}
.cnt{position:absolute;right:12px;bottom:12px;background:#000a;color:#fff;font-size:12.5px;font-weight:700;border-radius:99px;padding:3px 10px}
.box{padding:18px 16px}.price{font:800 34px/1.1 var(--hf);color:var(--acc);margin:0}
h1{font:800 22px/1.3 var(--hf);margin:6px 0 4px}.addr{color:var(--mute);margin:0 0 12px}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{background:var(--card);border:1px solid #8882;border-radius:10px;padding:7px 11px;font-size:14px;font-weight:700}
h2{font:800 18px/1.3 var(--hf);margin:0 0 10px}.card{background:var(--card);border-radius:16px;padding:16px;margin:0 16px 16px;border:1px solid #8881}
.vid{position:relative;width:100%;border-radius:12px;overflow:hidden;background:#000}.vid iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.near{list-style:none;margin:0;padding:0}.near li{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #8882}.near li:last-child{border:0}
.near .ic{font-size:20px;width:28px;text-align:center}.near .nm{flex:1;min-width:0}.near .nm b{display:block;font-size:15px;line-height:1.3}.near .nm span{font-size:12.5px;color:var(--mute)}
.near .d{font-weight:800;color:var(--acc);white-space:nowrap}
.map{width:100%;height:240px;border:0;border-radius:12px;margin-top:12px;background:#0002}
.dir{display:inline-block;margin-top:10px;font-weight:700;font-size:14px}
.desc{white-space:pre-line;margin:0}
form{display:grid;gap:10px}input,select,textarea{font:inherit;color:#11161b;background:#fff;border:1px solid #c9cfd2;border-radius:12px;padding:12px 14px;width:100%}
.btn{border:0;background:var(--acc);color:var(--accInk);font:800 16px/1 "Be Vietnam Pro",sans-serif;border-radius:12px;padding:15px;cursor:pointer}
.ok{background:#16a34a22;border:1px solid #16a34a;border-radius:12px;padding:14px;font-weight:700}
.err{color:#ef4444;font-size:14px;margin:0}.hp{position:absolute;left:-9999px}
.bar{position:fixed;left:0;right:0;bottom:0;display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--bg);border-top:1px solid #8883;z-index:5}
.bar a,.bar button{display:flex;align-items:center;justify-content:center;gap:6px;border-radius:12px;font:800 15px/1 "Be Vietnam Pro",sans-serif;padding:13px 6px;text-decoration:none;border:1px solid #8885;background:transparent;color:var(--ink);cursor:pointer}
.bar .main{background:var(--acc);color:var(--accInk);border-color:transparent}
.foot{text-align:center;color:var(--mute);font-size:13px;padding:8px 16px 20px}.foot a{font-weight:700}
@media(min-width:720px){.slides img{aspect-ratio:16/9}}
</style></head><body><div class="wrap">
<header class="top"><span class="brand">${esc(p.brand || 'Môi giới bất động sản')}</span>${phone ? `<a class="call" href="tel:${esc(phone)}" data-ev="call">📞 ${esc(phone)}</a>` : ''}</header>
${photos.length ? `<div class="gal"><div class="slides" id="slides">${photos.map((s, i) => `<img src="${esc(s)}" alt="Ảnh ${i + 1} — ${esc(title)}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}>`).join('')}</div>${photos.length > 1 ? `<span class="cnt" id="cnt">1/${photos.length}</span>` : ''}</div>` : ''}
<section class="box">
${p.price ? `<p class="price">${esc(p.price)}</p>` : ''}
<h1>${esc(title)}</h1>
${p.address ? `<p class="addr">📍 ${esc(p.address)}</p>` : ''}
${info.length ? `<div class="chips">${info.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
</section>
${vid ? `<section class="card"><h2>Video vị trí</h2>${vid.src ? `<div class="vid" style="aspect-ratio:${vid.tall ? (vid.tiktok ? '9/17' : '9/16') : '16/9'}"><iframe src="${esc(vid.src)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Video căn nhà"></iframe></div>` : `<a class="call" href="${esc(vid.link)}" target="_blank" rel="noopener">▶ Xem video căn nhà</a>`}</section>` : ''}
${near.length || hasLoc ? `<section class="card"><h2>Vị trí &amp; tiện ích xung quanh</h2>
${near.length ? `<ul class="near">${near.map(x => `<li><span class="ic">${x.ic}</span><span class="nm"><b>${esc(x.name)}</b>${x.sub ? `<span>${esc(x.sub)}</span>` : ''}</span><span class="d">${esc(fmtKm(x.d))}</span></li>`).join('')}</ul>` : ''}
${hasLoc ? `<iframe class="map" loading="lazy" title="Bản đồ" src="https://maps.google.com/maps?q=${p.lat},${p.lng}&z=15&output=embed"></iframe>
<a class="dir" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">🧭 Chỉ đường tới căn nhà</a>` : ''}
</section>` : ''}
${p.description ? `<section class="card"><h2>Mô tả</h2><p class="desc">${esc(p.description)}</p></section>` : ''}
<section class="card" id="lien-he"><h2>Để lại số, em gọi lại ngay</h2>
<form id="lead" novalidate>
<input name="name" autocomplete="name" placeholder="Tên anh/chị" maxlength="60">
<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Số điện thoại *" maxlength="15" required>
<select name="want"><option value="xem">Hẹn đi xem nhà</option><option value="gia">Hỏi giá &amp; pháp lý</option><option value="vay">Tư vấn vay ngân hàng</option></select>
<input class="hp" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
<p class="err" id="err" hidden></p>
<button class="btn" type="submit">Gửi — nhận tư vấn miễn phí</button>
</form></section>
<p class="foot">Trang tạo bằng <a href="${origin}/gioi-thieu.html?utm_source=trang-can" target="_blank" rel="noopener">Vị Trí Studio</a> — app làm video vị trí nhà đất cho môi giới</p>
</div>
<nav class="bar">${phone ? `<a href="tel:${esc(phone)}" data-ev="call">📞 Gọi</a><a href="${esc(zaloLink(phone))}" target="_blank" rel="noopener" data-ev="zalo">💬 Zalo</a>` : '<span></span><span></span>'}<button class="main" type="button" id="toForm">Để lại số</button></nav>
<script>
(function(){var D=${data};
var s=document.getElementById('slides'),c=document.getElementById('cnt');
if(s&&c)s.addEventListener('scroll',function(){c.textContent=(Math.round(s.scrollLeft/s.clientWidth)+1)+'/'+s.children.length},{passive:true});
document.getElementById('toForm').onclick=function(){document.getElementById('lien-he').scrollIntoView({behavior:'smooth'});setTimeout(function(){document.querySelector('#lead [name=phone]').focus()},400)};
document.querySelectorAll('[data-ev]').forEach(function(a){a.addEventListener('click',function(){try{navigator.sendBeacon('/api/page-event',JSON.stringify({slug:D.slug,kind:a.dataset.ev}))}catch(e){}})});
var f=document.getElementById('lead'),er=document.getElementById('err');
f.onsubmit=function(e){e.preventDefault();var b=f.querySelector('button');er.hidden=true;
var ph=f.phone.value.replace(/[^0-9+]/g,'');if(!/^(\\+?84|0)[35789][0-9]{8}$/.test(ph)){er.textContent='Số điện thoại chưa đúng, kiểm tra lại giúp em.';er.hidden=false;return}
b.disabled=true;b.textContent='Đang gửi…';
fetch('/api/lead',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:D.slug,name:f.name.value,phone:ph,want:f.want.value,hp:f.hp.value})})
.then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Lỗi');return j})})
.then(function(){f.outerHTML='<div class="ok">✅ Đã nhận thông tin. Em sẽ gọi lại cho anh/chị trong ít phút nữa!</div>';try{fbq&&fbq('track','Lead')}catch(e){}})
.catch(function(x){er.textContent=x.message||'Chưa gửi được, thử lại giúp em.';er.hidden=false;b.disabled=false;b.textContent='Gửi — nhận tư vấn miễn phí'})};
})();
</script></body></html>`;
}
function notFound(origin) {
  return new Response(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trang không còn</title>
<style>body{font:16px/1.6 system-ui,sans-serif;background:#0e1513;color:#eef4f1;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}a{color:#F1B23C;font-weight:700}</style></head>
<body><div><h1>Căn này không còn hiển thị</h1><p>Có thể căn đã bán hoặc môi giới đã ẩn trang.</p><p><a href="${origin}/gioi-thieu.html">Vị Trí Studio</a></p></div></body></html>`,
  { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
}
export async function handleCan(request) {
  const url = new URL(request.url);
  const slug = (url.pathname.match(/^\/can\/([a-z0-9]{5,12})\/?$/) || [])[1];
  if (!slug) return notFound(url.origin);
  // Môi giới xem thử từ app (?xem=1) thì không tính lượt xem
  const p = await rpc('vt_page_public', { p_slug: slug, p_count: url.searchParams.get('xem') !== '1' }).catch(() => null);
  if (!p) return notFound(url.origin);
  return new Response(pageHtml(p, url.origin), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}
export async function handlePageEvent(request) {
  if (request.method !== 'POST') return json({ ok: false }, 405);
  const b = await request.text().then(t => JSON.parse(t)).catch(() => null);
  if (!b?.slug || !['call', 'zalo'].includes(b.kind)) return json({ ok: false }, 400);
  await rpc('vt_page_event', { p_slug: String(b.slug).slice(0, 20), p_kind: b.kind }).catch(() => {});
  return json({ ok: true });
}
// Nút "Gọi" trong tin nhắn Telegram (Telegram không mở link tel: trực tiếp)
export function handleCallLink(request) {
  const n = decodeURIComponent(new URL(request.url).pathname.replace(/^\/goi\//, '')).replace(/[^0-9+]/g, '').slice(0, 15);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gọi ${n}</title>
<style>body{font:18px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}a{background:#16a34a;color:#fff;padding:16px 28px;border-radius:14px;text-decoration:none;font-weight:800}</style>
<a href="tel:${n}">📞 Gọi ${n}</a><script>location.href='tel:${n}'</script>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
