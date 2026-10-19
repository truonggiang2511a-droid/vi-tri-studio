// Khách quan tâm (CRM mini) + Trang web của tôi + kết nối Telegram báo khách mới.
// Dữ liệu nằm ở các hàm vt_lead_* / vt_page_* / vt_tg_* trên Supabase; ở đây chỉ hiển thị và gọi.
import qrcode from 'qrcode-generator';
import { rpc, account, onAccountChange, requireLogin, refreshAccount } from './account.js';
import { loadConfig } from './track.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toast = m => console.log(m);

export const LEAD_STATUS = {
  moi: { label: 'Mới', color: '#ef4444' },
  da_lien_he: { label: 'Đã liên hệ', color: '#3b82f6' },
  hen_xem: { label: 'Hẹn xem nhà', color: '#f59e0b' },
  dam_phan: { label: 'Đang đàm phán', color: '#a855f7' },
  chot: { label: 'Đã chốt', color: '#16a34a' },
  khong_mua: { label: 'Không mua', color: '#6b7280' },
};
const ago = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return Math.floor(s / 60) + ' phút trước';
  if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export const pageUrl = slug => `${location.origin}/can/${slug}`;
const zalo = p => 'https://zalo.me/' + String(p || '').replace(/\D/g, '');

// ---------- Badge số khách mới trên thanh trên cùng ----------
function renderBadge() {
  const b = $('leadsBtn');
  if (!b) return;
  b.hidden = !account.profile;
  const n = account.leadsNew || 0;
  const badge = b.querySelector('.badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = !n;
  b.setAttribute('aria-label', n ? `Khách quan tâm, ${n} khách mới` : 'Khách quan tâm');
}

// ---------- Hộp thoại ----------
let tab = 'leads';
let filter = 'all';
let leads = [];
let pages = [];
export async function openLeads(which = 'leads') {
  if (!account.profile) { const ok = await requireLogin('Đăng nhập để xem khách quan tâm.'); if (!ok) return; }
  tab = which;
  showTab();
  if (!$('leadsDlg').open) $('leadsDlg').showModal();
  load();
}
function showTab() {
  for (const b of $('leadsTabs').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.lt === tab));
  for (const k of ['leads', 'pages', 'notify']) $('lt-' + k).hidden = k !== tab;
}
async function load() {
  if (tab === 'leads') return loadLeads();
  if (tab === 'pages') return loadPages();
  return loadNotify();
}

async function loadLeads() {
  const box = $('leadList');
  box.innerHTML = '<p class="hint">Đang tải…</p>';
  try { leads = await rpc('vt_lead_list', { p_token: account.token }); } catch (e) { box.innerHTML = `<p class="hint err">${esc(e.message)}</p>`; return; }
  renderLeads();
}
function renderLeads() {
  const counts = {};
  for (const l of leads) counts[l.status] = (counts[l.status] || 0) + 1;
  $('leadFilter').innerHTML = [['all', 'Tất cả', leads.length], ...Object.entries(LEAD_STATUS).map(([k, v]) => [k, v.label, counts[k] || 0])]
    .filter(([k, , n]) => k === 'all' || n)
    .map(([k, label, n]) => `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${esc(label)} <b>${n}</b></button>`).join('');
  const list = filter === 'all' ? leads : leads.filter(l => l.status === filter);
  const box = $('leadList');
  if (!leads.length) {
    box.innerHTML = `<div class="empty"><strong>Chưa có khách nào để lại số</strong><p class="hint">Tạo trang web cho căn nhà (mục Video › Trang web căn này), gắn link vào bài đăng Facebook, TikTok, Zalo. Khách bấm vào và để lại số sẽ hiện ở đây.</p></div>`;
    return;
  }
  box.innerHTML = list.map(l => `
    <article class="lead" data-id="${esc(l.id)}">
      <header><strong>${esc(l.name || 'Khách')}</strong><span class="hint small">${esc(ago(l.created_at))}</span></header>
      <div class="lead-phone"><a href="tel:${esc(l.phone)}" class="btn btn-primary">📞 ${esc(l.phone)}</a><a href="${esc(zalo(l.phone))}" target="_blank" rel="noopener" class="btn btn-quiet">Zalo</a></div>
      ${l.want ? `<p class="lead-want">🎯 ${esc(l.want)}</p>` : ''}
      ${l.page_title ? `<p class="hint small">🏠 <a href="${esc(pageUrl(l.page_slug))}?xem=1" target="_blank" rel="noopener">${esc(l.page_title)}</a>${l.page_price ? ' · ' + esc(l.page_price) : ''}</p>` : ''}
      <div class="lead-row">
        <select class="input" data-st aria-label="Trạng thái">${Object.entries(LEAD_STATUS).map(([k, v]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <span class="dot" style="background:${LEAD_STATUS[l.status]?.color || '#999'}"></span>
      </div>
      <input class="input" data-note placeholder="Ghi chú: hẹn ngày, nhu cầu, ngân sách…" maxlength="500" value="${esc(l.note)}">
    </article>`).join('') || '<p class="hint">Không có khách ở trạng thái này.</p>';
}
async function updateLead(id, patch) {
  const l = leads.find(x => x.id === id);
  if (!l) return;
  Object.assign(l, patch);
  try {
    await rpc('vt_lead_update', { p_token: account.token, p_id: id, p_status: l.status, p_note: l.note });
    if ('status' in patch) { renderLeads(); refreshAccount(); }
    else toast('Đã lưu ghi chú.', 1500);
  } catch (e) { toast(e.message, 3500); }
}

async function loadPages() {
  const box = $('pageList');
  box.innerHTML = '<p class="hint">Đang tải…</p>';
  try { pages = await rpc('vt_page_list', { p_token: account.token }); } catch (e) { box.innerHTML = `<p class="hint err">${esc(e.message)}</p>`; return; }
  if (!pages.length) {
    box.innerHTML = '<div class="empty"><strong>Chưa có trang web nào</strong><p class="hint">Làm video cho một căn, rồi ở mục Video › Trang web căn này bấm "Tạo trang web".</p></div>';
    return;
  }
  const tot = pages.reduce((a, p) => ({ v: a.v + p.views, c: a.c + p.calls + p.zalos, l: a.l + p.leads }), { v: 0, c: 0, l: 0 });
  box.innerHTML = `<div class="stats"><div><b>${tot.v}</b><span>lượt xem</span></div><div><b>${tot.c}</b><span>bấm Gọi/Zalo</span></div><div><b>${tot.l}</b><span>khách để lại số</span></div></div>` +
    pages.map(p => `
    <article class="pg" data-id="${esc(p.id)}">
      ${p.photos?.[0] ? `<img src="/m/${esc(p.photos[0])}" alt="" loading="lazy">` : '<span class="pg-noimg">🏠</span>'}
      <div class="pg-body">
        <strong>${esc(p.title || 'Căn nhà')}</strong>
        <span class="hint small">${esc([p.price, p.status === 'hidden' ? 'Đang ẩn' : ''].filter(Boolean).join(' · '))}</span>
        <span class="pg-stats">👁 ${p.views} · 📞 ${p.calls} · 💬 ${p.zalos} · 🙋 ${p.leads}${p.views >= 20 ? ` · tỉ lệ để lại số ${Math.round(p.leads / p.views * 1000) / 10}%` : ''}</span>
        <div class="pg-actions">
          <a class="link-btn" href="${esc(pageUrl(p.slug))}?xem=1" target="_blank" rel="noopener">Xem</a>
          <button class="link-btn" type="button" data-pa="copy">Chép link</button>
          <button class="link-btn" type="button" data-pa="qr">Mã QR</button>
          <button class="link-btn" type="button" data-pa="toggle">${p.status === 'hidden' ? 'Hiện lại' : 'Ẩn (đã bán)'}</button>
          <button class="link-btn danger" type="button" data-pa="remove">Xoá</button>
        </div>
      </div>
    </article>`).join('');
}
async function pageAction(id, act) {
  const p = pages.find(x => x.id === id);
  if (!p) return;
  if (act === 'copy') return copyLink(pageUrl(p.slug));
  if (act === 'qr') return downloadPageQr(p);
  if (act === 'remove') {
    if (!confirm(`Xoá trang "${p.title || 'căn nhà'}"? Link cũ sẽ không mở được nữa. Khách đã để lại số vẫn giữ trong danh sách.`)) return;
    try { await rpc('vt_page_remove', { p_token: account.token, p_id: id }); toast('Đã xoá trang.'); loadPages(); } catch (e) { toast(e.message, 3500); }
    return;
  }
  if (act === 'toggle') {
    try {
      await rpc('vt_page_save', { p_token: account.token, p: { ...p, status: p.status === 'hidden' ? 'live' : 'hidden' } });
      toast(p.status === 'hidden' ? 'Trang đã hiện lại.' : 'Đã ẩn trang. Khách mở link sẽ thấy "căn không còn hiển thị".', 3500);
      loadPages();
    } catch (e) { toast(e.message, 3500); }
  }
}

async function loadNotify() {
  const cfg = await loadConfig();
  const box = $('tgBox');
  if (!cfg.tg_bot) {
    box.innerHTML = '<p class="hint">Thông báo Telegram chưa được bật trên hệ thống. Trong lúc chờ, khách mới vẫn hiện ở tab Khách với chấm đỏ trên nút Khách.</p>';
    return;
  }
  const linked = account.tgLinked;
  box.innerHTML = linked
    ? `<p class="ok-line">✅ Đã kết nối Telegram. Có khách để lại số, bot sẽ nhắn ngay cho anh/chị.</p>
       <button class="btn btn-quiet" type="button" id="tgRelink">Kết nối lại với Telegram khác</button>
       <button class="link-btn danger" type="button" id="tgOff">Tắt thông báo</button>`
    : `<p class="hint">Bấm nút dưới, Telegram mở ra, bấm <b>Bắt đầu (Start)</b> là xong. Từ đó có khách mới, điện thoại báo ngay kèm số để gọi lại — gọi trong 5 phút đầu tỉ lệ chốt cao hơn nhiều.</p>
       <button class="btn btn-primary btn-block" type="button" id="tgLink">Kết nối Telegram</button>`;
}
async function linkTelegram() {
  const cfg = await loadConfig();
  const w = window.open('', '_blank');
  try {
    const r = await rpc('vt_tg_code', { p_token: account.token });
    const url = `https://t.me/${cfg.tg_bot}?start=${r.code}`;
    if (w) w.location.href = url; else location.href = url;
    toast('Bấm Bắt đầu (Start) trong Telegram để hoàn tất kết nối.', 5000);
    // Kiểm tra lại sau khi khách quay lại app
    const check = async () => { await refreshAccount(); if (tab === 'notify') loadNotify(); };
    setTimeout(check, 8000); setTimeout(check, 20000);
    window.addEventListener('focus', check, { once: true });
  } catch (e) { w?.close(); toast(e.message, 3500); }
}

async function copyLink(url) {
  try { await navigator.clipboard.writeText(url); toast('Đã chép link trang. Dán vào bài đăng hoặc tin nhắn.', 2500); }
  catch { prompt('Chép link này:', url); }
}
// Ảnh mã QR để in lên băng rôn, tờ rơi: quét là mở trang căn nhà
export async function downloadPageQr(p) {
  const url = pageUrl(p.slug);
  const qr = qrcode(0, 'M');
  qr.addData(url); qr.make();
  const n = qr.getModuleCount(), S = 3, W = 360, H = 470, cell = Math.floor((W - 60) / (n + 2));
  const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
  const g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0b1210'; g.textAlign = 'center';
  g.font = '800 20px "Be Vietnam Pro", system-ui, sans-serif';
  g.fillText('QUÉT ĐỂ XEM CĂN NHÀ', W / 2, 38);
  const size = cell * n, ox = (W - size) / 2, oy = 58;
  for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) if (qr.isDark(r, q)) g.fillRect(ox + q * cell, oy + r * cell, cell, cell);
  g.font = '800 22px "Be Vietnam Pro", system-ui, sans-serif';
  if (p.price) g.fillText(p.price, W / 2, oy + size + 40);
  g.font = '600 14px "Be Vietnam Pro", system-ui, sans-serif'; g.fillStyle = '#33423c';
  const t = String(p.title || '').slice(0, 44);
  g.fillText(t, W / 2, oy + size + (p.price ? 66 : 40));
  g.font = '500 12px "Be Vietnam Pro", system-ui, sans-serif';
  g.fillText(url.replace(/^https?:\/\//, ''), W / 2, H - 16);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], `qr-can-${p.slug}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Mã QR căn nhà' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Đã tải ảnh mã QR.', 2500);
}

export function initLeads(opts = {}) {
  if (opts.toast) toast = opts.toast;
  onAccountChange(renderBadge);
  renderBadge();
  $('leadsBtn').addEventListener('click', () => openLeads(account.leadsNew ? 'leads' : (tab || 'leads')));
  $('leadsTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-lt]');
    if (!b) return;
    tab = b.dataset.lt; showTab(); load();
  });
  $('leadFilter').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (b) { filter = b.dataset.f; renderLeads(); }
  });
  $('leadList').addEventListener('change', e => {
    const card = e.target.closest('.lead');
    if (card && e.target.matches('[data-st]')) updateLead(card.dataset.id, { status: e.target.value });
    if (card && e.target.matches('[data-note]')) updateLead(card.dataset.id, { note: e.target.value });
  });
  $('pageList').addEventListener('click', e => {
    const b = e.target.closest('[data-pa]');
    const card = e.target.closest('.pg');
    if (b && card) pageAction(card.dataset.id, b.dataset.pa);
  });
  $('tgBox').addEventListener('click', async e => {
    if (e.target.closest('#tgLink, #tgRelink')) linkTelegram();
    if (e.target.closest('#tgOff')) {
      try { await rpc('vt_tg_unlink', { p_token: account.token }); await refreshAccount(); loadNotify(); toast('Đã tắt thông báo Telegram.'); } catch (x) { toast(x.message, 3500); }
    }
  });
  // Mở app lại thì cập nhật số khách mới
  document.addEventListener('visibilitychange', () => { if (!document.hidden && account.profile) refreshAccount(); });
}
