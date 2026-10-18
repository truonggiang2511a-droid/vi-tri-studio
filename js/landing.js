// Trang giới thiệu (/gioi-thieu): video mẫu chạy thật bằng chính bộ dựng của app, bảng giá lấy từ máy chủ.
import { initTracking, track, countVisit } from './track.js';
import { SB_URL, SB_KEY } from './sb.js';
import { initInstall } from './install.js';
const REF_KEY = 'vitri.ref.v1';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';

// ---------- Mã giới thiệu trên link ----------
function captureRef() {
  try {
    const u = new URL(location.href);
    const r = (u.searchParams.get('ref') || '').trim().toLowerCase();
    if (/^[a-z0-9]{4,12}$/.test(r)) localStorage.setItem(REF_KEY, JSON.stringify({ code: r, at: Date.now() }));
    if (u.searchParams.has('ref')) { u.searchParams.delete('ref'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); }
    const j = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
    return j && Date.now() - j.at < 60 * 86400000 ? j.code : null;
  } catch { return null; }
}

// ---------- Bảng giá + thông tin công khai ----------
async function loadInfo() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/vt_public_info`, {
      method: 'POST', headers: { apikey: SB_KEY, 'content-type': 'application/json' }, body: '{}',
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
async function refValid(code) {
  if (!code) return false;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/vt_ref_valid`, {
      method: 'POST', headers: { apikey: SB_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ p_code: code }),
    });
    return res.ok ? (await res.json()) === true : false;
  } catch { return false; }
}
function renderInfo(info, hasRef) {
  const trial = info?.trial_credits ?? 3;
  const bonus = info?.ref_bonus ?? 2;
  for (const el of document.querySelectorAll('.trial-n')) el.textContent = trial;
  for (const el of document.querySelectorAll('.ref-n')) el.textContent = bonus;
  if (hasRef && bonus > 0) {
    $('refNote').hidden = false;
    $('refNote').textContent = `Anh/chị được bạn bè giới thiệu: đăng ký hôm nay nhận ${trial + bonus} video miễn phí (${trial} lượt dùng thử + ${bonus} lượt thưởng).`;
  }
  const z = info?.bank?.zalo;
  for (const a of document.querySelectorAll('.zalo-link')) { if (z) { a.href = z; a.hidden = false; } }
  const box = $('pkgGrid');
  if (!info?.packages?.length) { box.innerHTML = '<p class="muted">Không tải được bảng giá, mở app để xem giá mới nhất.</p>'; return; }
  const per = p => (p.credits > 0 ? `${money(Math.round(p.price / p.credits))} / video` : 'dùng thoải mái');
  box.innerHTML = `
    <article class="pkg">
      <h3>Dùng thử</h3>
      <p class="price">0đ</p>
      <p class="pkg-sub">${trial} video đầu tiên</p>
      <ul><li>Đủ tính năng: giọng đọc, phụ đề, logo, thẻ giá</li><li>Không cần thẻ, không tự gia hạn</li></ul>
      <a class="btn btn-ghost" href="/#dangky" data-cta>Đăng ký miễn phí</a>
    </article>` + info.packages.map(p => `
    <article class="pkg${p.highlight ? ' hot' : ''}">
      ${p.highlight ? '<span class="tag">Chọn nhiều nhất</span>' : ''}
      <h3>${esc(p.name)}</h3>
      <p class="price">${money(p.price)}</p>
      <p class="pkg-sub">${p.days > 0 ? `${p.days} ngày` : `${p.credits} video`} · ${per(p)}</p>
      <ul>${p.description ? `<li>${esc(p.description)}</li>` : ''}<li>${p.days > 0 ? 'Xuất không giới hạn trong thời hạn gói' : 'Lượt không hết hạn'}</li><li>Chuyển khoản QR, cộng lượt tự động</li></ul>
      <a class="btn ${p.highlight ? 'btn-primary' : 'btn-ghost'}" href="/#mua" data-cta>Chọn gói</a>
    </article>`).join('');
}

// ---------- Video mẫu (video thật xuất từ app) ----------
function setupDemo() {
  const v = $('demo');
  if (!v) return;
  const btn = $('demoSound');
  v.muted = true; // tự phát chỉ được khi tắt tiếng
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Chỉ phát khi video nằm trong màn hình để đỡ tốn dữ liệu di động
  new IntersectionObserver(es => {
    if (es[0].isIntersecting && !still) v.play().catch(() => {});
    else v.pause();
  }, { threshold: 0.25 }).observe(v);
  const label = () => { btn.textContent = v.muted ? '🔊 Bật tiếng nghe giọng đọc' : '🔇 Tắt tiếng'; };
  btn.addEventListener('click', () => {
    v.muted = !v.muted;
    if (!v.muted) { if (v.ended || v.currentTime > v.duration - 1) v.currentTime = 0; v.play().catch(() => {}); track('view'); }
    label();
  });
  v.addEventListener('timeupdate', () => { if (v.duration) $('demoTime').style.width = (100 * v.currentTime / v.duration).toFixed(1) + '%'; });
  label();
}

// ---------- Khởi động ----------
countVisit('landing'); // trước khi bỏ ?ref= khỏi địa chỉ để còn biết nguồn
const ref = captureRef();
initTracking().then(() => track('view'));
Promise.all([loadInfo(), refValid(ref)]).then(([info, ok]) => renderInfo(info, ok));
setupDemo();
document.addEventListener('click', e => {
  if (e.target.closest('[data-cta]')) track('trial_click');
});
$('year').textContent = new Date().getFullYear();

// ---------- Cài app + thanh nút dưới cùng ----------
let toastTimer;
function toast(msg, ms = 3200) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}
// Trang giới thiệu chưa có hộp cài sẵn thì chuyển sang app (cài từ app để biểu tượng mở thẳng vào app)
initInstall({ toast, redirect: true });
const bar = $('stickyBar');
const heroCta = document.querySelector('.hero .cta-row');
const finalCta = document.querySelector('.final .cta-row');
if (bar && heroCta && 'IntersectionObserver' in window) {
  const seen = new Map();
  const io = new IntersectionObserver(es => {
    for (const e of es) seen.set(e.target, e.isIntersecting);
    const top = heroCta.getBoundingClientRect().bottom < 0;
    const show = top && !seen.get(finalCta);
    bar.classList.toggle('show', show);
    bar.setAttribute('aria-hidden', String(!show));
    for (const el of bar.querySelectorAll('a,button')) el.tabIndex = show ? 0 : -1;
    document.body.classList.toggle('bar-on', show);
  });
  io.observe(heroCta);
  if (finalCta) io.observe(finalCta);
}
