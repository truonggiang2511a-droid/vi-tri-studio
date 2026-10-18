// Trang giới thiệu (/gioi-thieu): video mẫu chạy thật bằng chính bộ dựng của app, bảng giá lấy từ máy chủ.
import { buildTimeline, render, TileCache, FORMATS, setImageryToken } from './render.js';
import { loadConfig, initTracking, track } from './track.js';

const SB_URL = 'https://crzinaydjgqepffatqoo.supabase.co';
const SB_KEY = 'sb_publishable_NhyivL-3owNWC6unb8GbZA_d135dx3i';
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

// ---------- Video mẫu ----------
const DEMO_TEXT = {
  intro: 'Nhà phố sát Quốc lộ 1A, đi đâu cũng tiện? Xem ngay vị trí này nhé!',
  house: 'Căn nhà thuộc xã Tân Nhựt, TP.HCM. Diện tích 5x20m, 3 phòng ngủ, sổ hồng riêng, giá chỉ 3,2 tỷ.',
  overview: 'Trong bán kính 5 km có đủ trường học, chợ, bệnh viện và khu công nghiệp.',
  'road:1459': 'Chỉ 0,46 km là ra Quốc lộ 1A.',
  'road:h529': 'Ra Nguyễn Văn Linh chỉ khoảng 0,53 km.',
  'road:1589': 'Lên cao tốc Trung Lương chỉ khoảng 1,6 km.',
  boundary: 'Qua ranh Tây Ninh chỉ khoảng 6 km, chừng 8 phút chạy xe.',
  'poi:658631': 'Bệnh viện Bình Chánh cách khoảng 1,2 km, yên tâm khi cần khám chữa bệnh.',
  'poi:658555': 'Công viên trung tâm chỉ cách 1 km, cuối tuần cả nhà có chỗ vui chơi.',
  'poi:658483': 'Ủy ban huyện cách 1,2 km, làm giấy tờ nhanh gọn.',
  'poi:658488': 'Chỉ 1,5 km là tới trường mầm non, đưa đón con rất tiện.',
  'poi:659554': 'Khu công nghiệp Tân Tạo cách 8,4 km, rất hợp đầu tư cho thuê.',
  summary: 'Mọi tiện ích thiết yếu đều nằm trong bán kính 5 km.',
  outro: 'Vị trí như thế này không có nhiều. Liên hệ ngay để đi xem nhà!',
};
function demoLogo() {
  const c = document.createElement('canvas');
  c.width = 260; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#0e5b45'; g.beginPath(); g.roundRect?.(0, 0, 96, 96, 18); g.fill();
  g.fillStyle = '#fff'; g.font = '800 44px "Be Vietnam Pro", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('LG', 48, 50);
  g.fillStyle = '#0e5b45'; g.textAlign = 'left'; g.font = '800 30px "Be Vietnam Pro", sans-serif';
  g.fillText('LOGO', 110, 32); g.fillText('CỦA BẠN', 110, 70);
  return c;
}
async function startDemo() {
  const canvas = $('demo');
  if (!canvas) return;
  let scene;
  try { scene = await (await fetch('/demo-scene.json')).json(); } catch { return; }
  try { await document.fonts.load('800 20px "Be Vietnam Pro"', 'Vị trí'); } catch { /* phông dự phòng */ }
  scene.logo = demoLogo();
  scene.logoBg = true;
  const voice = Object.fromEntries(Object.entries(DEMO_TEXT).map(([k, v]) => [k, Math.max(1.6, v.length / 14)]));
  const tl = buildTimeline(scene, 'v', { voice, captions: DEMO_TEXT });
  const F = FORMATS.v;
  const ctx = canvas.getContext('2d');
  let dirty = true;
  const cache = new TileCache(() => (dirty = true));
  const size = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.width * dpr * F.LH / F.LW);
    dirty = true;
  };
  size();
  new ResizeObserver(size).observe(canvas);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = still ? tl.house.t0 + 2.5 : 0, last = performance.now(), visible = false, hold = 0;
  new IntersectionObserver(es => { visible = es[0].isIntersecting; last = performance.now(); }, { threshold: 0.15 }).observe(canvas);
  const frame = now => {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) { last = now; return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!still) {
      if (hold > 0) { hold -= dt; if (hold <= 0) t = 0; }
      else { t += dt; if (t >= tl.duration) { t = tl.duration; hold = 1.4; } }
      dirty = true;
    }
    if (dirty) {
      render(ctx, tl, t, { cache, scale: canvas.width / F.LW, request: true });
      dirty = false;
      $('demoTime').style.width = (100 * t / tl.duration).toFixed(1) + '%';
    }
  };
  requestAnimationFrame(frame);
}

// ---------- Khởi động ----------
const ref = captureRef();
loadConfig().then(c => c?.arcgis && setImageryToken(c.arcgis));
initTracking().then(() => track('view'));
Promise.all([loadInfo(), refValid(ref)]).then(([info, ok]) => renderInfo(info, ok));
startDemo();
document.addEventListener('click', e => {
  if (e.target.closest('[data-cta]')) track('trial_click');
});
$('year').textContent = new Date().getFullYear();
