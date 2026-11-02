// Hướng dẫn khoanh sáng cho khách MỚI (2/11/2026, Giang duyệt): mỗi lần chỉ khoanh sáng ĐÚNG MỘT chỗ khách cần bấm tiếp,
// khách làm xong là tự tắt, tới bước sau mới khoanh chỗ tiếp theo. Không có nút "Tiếp theo" (khách từ quảng cáo hay bỏ qua tour dài).
// - Chỉ chạy trên máy được bật bằng enableCoach() (máy mới vào lần đầu, lúc video mẫu tự phát) → khách cũ không thấy.
// - Lớp tối KHÔNG chặn bấm (pointer-events: none): khách bấm đâu cũng được; chạm ra ngoài chỗ khoanh = tắt mẹo đó.
// - Mỗi mẹo hiện 1 lần/máy (localStorage); "Bỏ qua hướng dẫn" tắt hết.
// - Chỉ ghi phễu nội bộ (vt_visits f_hd_*), KHÔNG gửi Meta/TikTok.

const KEY = 'vitri.coach';
let cur = null; // { key, el, box, tip, raf, onDown, onDone }

function load() {
  try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
function store(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* bỏ qua */ } }

export function enableCoach() { if (!load()) store({ on: 1, done: [] }); }
export function coachActive() { const s = load(); return !!(s && s.on); }
export function coachOpen() { return !!cur; }
function isDone(key) { const s = load(); return !s || !s.on || (s.done || []).includes(key); }

export function coachDone(key) {
  const s = load();
  if (s && s.on && !(s.done || []).includes(key)) { s.done = [...(s.done || []), key]; store(s); }
  if (cur && cur.key === key) close();
}
function stopAll() { const s = load() || {}; s.on = 0; store(s); close(); }

function close() {
  if (!cur) return;
  cancelAnimationFrame(cur.raf);
  document.removeEventListener('pointerdown', cur.onDown, true);
  cur.box.remove(); cur.tip.remove();
  cur = null;
}

function visible(el) {
  if (!el || !el.isConnected || el.hidden) return false;
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden';
}
function blocked() {
  // Đang có hộp thoại, đang xem toàn màn hình hoặc đang vẽ lô/đường: không chen vào
  return !!document.querySelector('dialog[open]') || !!document.querySelector('.stage.fs') || !!document.querySelector('.canvas-wrap.editing');
}

/**
 * Khoanh sáng el + lời nhắc. Trả true nếu đã hiện.
 * opts: { key, step: '1/5', title, text, small, scroll = true, onShow }
 */
export function coach(el, opts) {
  const { key } = opts;
  if (isDone(key) || blocked() || !visible(el)) return false;
  if (cur && cur.key === key) return true;
  close();
  // Chỉ cuộn khi chỗ khoanh nằm ngoài màn hình (đang xem video mẫu ở trên thì không kéo trang đi)
  const r0 = el.getBoundingClientRect();
  if (opts.scroll !== false && (r0.top < 8 || r0.bottom > innerHeight - 8) && !el.closest('.step-nav')) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const box = document.createElement('div');
  box.className = 'coach-hole';
  const tip = document.createElement('div');
  tip.className = 'coach-tip';
  tip.setAttribute('role', 'note');
  tip.innerHTML = `<div class="coach-step">${opts.step || ''}</div><strong>${opts.title}</strong><p>${opts.text}</p>`
    + (opts.small ? `<small>${opts.small}</small>` : '')
    + '<button type="button" class="coach-skip">Bỏ qua hướng dẫn</button>';
  document.body.append(box, tip);
  tip.querySelector('.coach-skip').addEventListener('click', e => { e.stopPropagation(); stopAll(); });

  const onDown = e => {
    if (tip.contains(e.target)) return;
    // Bấm đúng chỗ khoanh: để thao tác chạy bình thường, mẹo tắt (bước sau sẽ khoanh chỗ khác)
    coachDone(key);
  };
  document.addEventListener('pointerdown', onDown, true);
  cur = { key, el, box, tip, onDown, raf: 0 };

  const place = () => {
    if (!cur || cur.key !== key) return;
    if (!visible(el) || blocked()) { close(); return; } // chỗ khoanh biến mất (đổi bước…): tắt, chưa tính là xong
    const r = el.getBoundingClientRect();
    const pad = 6, vw = innerWidth, vh = innerHeight;
    Object.assign(box.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const tw = Math.min(330, vw - 24);
    tip.style.width = `${tw}px`;
    const th = tip.offsetHeight;
    const below = r.bottom + pad + 12;
    const above = r.top - pad - 12 - th;
    // Chỗ khoanh ở nửa dưới màn hình (vd. thanh nút dưới cùng) → lời nhắc nằm trên
    const top = (r.top + r.height / 2 > vh * 0.55 && above > 8) || below + th > vh - 8 ? Math.max(8, above) : below;
    const left = Math.max(12, Math.min(vw - tw - 12, r.left + r.width / 2 - tw / 2));
    Object.assign(tip.style, { left: `${left}px`, top: `${top}px` });
    tip.classList.toggle('up', top < r.top);
    cur.raf = requestAnimationFrame(place);
  };
  place();
  if (opts.onShow) opts.onShow();
  return true;
}
