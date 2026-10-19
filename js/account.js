// Tài khoản khách hàng: đăng ký/đăng nhập, số lượt, mua thêm lượt bằng VietQR.
// Mọi kiểm tra lượt nằm ở các hàm vt_* trên Supabase; trình duyệt chỉ gọi và hiển thị.
import qrcode from 'qrcode-generator';
import { track, firstSource } from './track.js';
import { deviceId, fingerprint } from './device.js';

import { SB_URL, SB_KEY } from './sb.js';
export { SB_URL, SB_KEY };
const TOKEN_KEY = 'vitri.session.v1';
const REF_KEY = 'vitri.ref.v1';

// Mã giới thiệu trên link (?ref=abc123): nhớ lại để gửi kèm khi đăng ký, rồi bỏ khỏi thanh địa chỉ
export function captureRef() {
  try {
    const u = new URL(location.href);
    const r = (u.searchParams.get('ref') || '').trim().toLowerCase();
    if (/^[a-z0-9]{4,12}$/.test(r)) localStorage.setItem(REF_KEY, JSON.stringify({ code: r, at: Date.now() }));
    if (u.searchParams.has('ref')) { u.searchParams.delete('ref'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); }
  } catch { /* bỏ qua */ }
}
export function getRef() {
  try {
    const j = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
    if (j && Date.now() - j.at < 60 * 86400000) return j.code;
  } catch { /* bỏ qua */ }
  return null;
}

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const money = n => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
const fmtDate = (d, withTime = true) => {
  if (!d) return '';
  const x = new Date(d);
  const dd = `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;
  return withTime ? `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')} ${dd}` : dd + '/' + x.getFullYear();
};

const S = {
  token: null,
  profile: null,
  info: null,          // gói, ngân hàng, số lượt dùng thử
  reexportUntil: null, // còn được xuất lại miễn phí vị trí hiện tại tới lúc nào
  loc: null,
  order: null,         // đơn đang chờ thanh toán
  ref: null,           // mã giới thiệu của mình + số người đã mời
};
let toast = m => console.log(m);
const listeners = new Set();
const emit = () => { renderBadge(); for (const f of listeners) f(S); };
const hideToast = () => { const t = $('toast'); if (t) t.hidden = true; };
export const account = S;
export const onAccountChange = f => listeners.add(f);

function readToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function writeToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* bỏ qua */ } }

export async function rpc(fn, args = {}) {
  let res;
  try {
    res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    const e = new Error('Không kết nối được máy chủ tài khoản. Kiểm tra mạng rồi thử lại.');
    e.hint = 'NET';
    throw e;
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(j?.message || 'Máy chủ tài khoản lỗi ' + res.status);
    e.hint = j?.hint || '';
    throw e;
  }
  return j;
}

function setSession(token, profile) {
  S.token = token;
  S.profile = profile;
  writeToken(token);
  emit();
}
function clearSession() {
  S.token = null; S.profile = null; S.reexportUntil = null; S.order = null;
  writeToken(null);
  emit();
}

export const authHeaders = () => (S.token ? { authorization: 'Bearer ' + S.token } : {});

let devSent = false;
export async function refreshAccount() {
  if (!S.token) { emit(); return; }
  try {
    const r = await rpc('vt_me', { p_token: S.token, p_lat: S.loc?.lat ?? null, p_lng: S.loc?.lng ?? null });
    // Ghi nhận máy đang dùng tài khoản này (một lần mỗi lần mở app) để tài khoản tạo thêm trên máy này không nhận lại lượt dùng thử
    if (!devSent) {
      devSent = true;
      const tok = S.token;
      Promise.all([deviceId(), fingerprint()]).then(([d, f]) => rpc('vt_set_device', { p_token: tok, p_device: d, p_fp: f })).catch(() => {});
    }
    S.profile = r.profile;
    S.reexportUntil = r.reexport_until;
    S.ref = r.ref || null;
    if (r.pending) S.order = S.order?.code === r.pending.code ? S.order : { ...r.pending };
  } catch (e) {
    if (e.hint === 'AUTH' || e.hint === 'LOCKED') clearSession();
  }
  emit();
}

let locTimer;
export function setAccountLocation(loc) {
  S.loc = loc ? { lat: loc.lat, lng: loc.lng } : null;
  clearTimeout(locTimer);
  if (S.token) locTimer = setTimeout(refreshAccount, 700);
}

async function loadInfo() {
  if (S.info) return S.info;
  try { S.info = await rpc('vt_public_info'); } catch { /* thử lại khi mở bảng giá */ }
  if (S.info) {
    const z = S.info.bank?.zalo;
    for (const a of document.querySelectorAll('.zalo-link')) { a.href = z || '#'; a.hidden = !z; }
    for (const el of document.querySelectorAll('.zalo-alt')) el.hidden = !!z;
    for (const el of document.querySelectorAll('.trial-n')) el.textContent = S.info.trial_credits;
    const rb = S.info.ref_bonus || 0;
    const refLine = $('refLine');
    const code = getRef();
    if (refLine && code && rb > 0) {
      rpc('vt_ref_valid', { p_code: code }).then(ok => {
        refLine.hidden = ok !== true;
        refLine.textContent = `Anh/chị đăng ký qua link giới thiệu: được tặng thêm ${rb} lượt.`;
      }).catch(() => {});
    }
  }
  return S.info;
}

// ---------- Huy hiệu trên thanh trên cùng + ghi chú ở bước xuất ----------
function creditText(p) {
  if (!p) return '';
  if (p.unlimited) return 'Không giới hạn';
  return `${p.credits} lượt`;
}
function renderBadge() {
  const btn = $('acctBtn');
  if (!btn) return;
  const p = S.profile;
  if (!p) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span class="acct-label">Đăng nhập</span>`;
    btn.classList.remove('has-acct');
    btn.setAttribute('aria-label', 'Đăng nhập');
  } else {
    const init = (p.name || p.login || '?').trim().charAt(0).toUpperCase();
    btn.innerHTML = `<span class="credit-pill${!p.unlimited && p.credits <= 0 ? ' empty' : ''}">${esc(creditText(p))}</span><span class="avatar">${esc(init)}</span>`;
    btn.classList.add('has-acct');
    btn.setAttribute('aria-label', 'Tài khoản');
  }
  const low = $('lowBanner');
  if (low) {
    const soon = p?.unlimited && new Date(p.unlimited_until) - Date.now() < 3 * 86400000;
    const few = p && !p.unlimited && p.credits <= 1;
    low.hidden = !(soon || few);
    if (soon) low.innerHTML = `Gói không giới hạn hết hạn ${fmtDate(p.unlimited_until, false)}. <button type="button" class="link-btn" data-act="buy">Gia hạn</button>`;
    else if (few) low.innerHTML = `${p.credits <= 0 ? 'Anh/chị đã hết lượt.' : 'Còn <strong>1 lượt</strong> cuối.'} <button type="button" class="link-btn" data-act="buy">Mua thêm</button> hoặc <button type="button" class="link-btn" data-act="invite">mời bạn bè để được tặng lượt</button>`;
  }
  const note = $('creditNote');
  if (note) {
    const trial = S.info?.trial_credits ?? 3;
    if (!p) {
      note.innerHTML = `Đăng ký miễn phí để nhận <strong>${trial} video</strong> dùng thử. <button type="button" class="link-btn" data-act="register">Đăng ký</button>`;
    } else if (S.reexportUntil && new Date(S.reexportUntil) > new Date()) {
      note.innerHTML = `Vị trí này xuất lại <strong>miễn phí</strong> tới ${fmtDate(S.reexportUntil)}.`;
    } else if (p.unlimited) {
      note.innerHTML = `Gói không giới hạn tới ${fmtDate(p.unlimited_until, false)}.`;
    } else if (p.credits > 0) {
      note.innerHTML = `Còn <strong>${p.credits} lượt</strong>. Mỗi vị trí trừ 1 lượt, xuất lại trong 24 giờ không trừ thêm.`;
    } else {
      note.innerHTML = `Đã hết lượt. <button type="button" class="link-btn" data-act="buy">Mua thêm lượt</button>`;
    }
  }
}

// ---------- Đăng nhập / đăng ký ----------
let authResolve = null;
let authTab = 'register';
function setAuthTab(tab) {
  authTab = tab;
  for (const b of $('authTabs').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.tab === tab));
  const reg = tab === 'register';
  $('nameField').hidden = !reg;
  $('authTitle').textContent = reg ? 'Tạo tài khoản' : 'Đăng nhập';
  $('authSubmit').textContent = reg ? 'Đăng ký và nhận lượt dùng thử' : 'Đăng nhập';
  $('authPass').autocomplete = reg ? 'new-password' : 'current-password';
  $('trialLine').hidden = !reg;
  $('authMsg').textContent = '';
}

export function requireLogin(reason = '', tab) {
  if (S.profile) return Promise.resolve(true);
  loadInfo();
  return new Promise(resolve => {
    authResolve?.(false);
    authResolve = resolve;
    $('authReason').textContent = reason;
    $('authReason').hidden = !reason;
    let had = false;
    try { had = !!localStorage.getItem('vitri.hasAcct'); } catch { /* bỏ qua */ }
    setAuthTab(tab || (had ? 'login' : 'register'));
    const dlg = $('authDlg');
    hideToast();
    if (!dlg.open) dlg.showModal();
    setTimeout(() => (authTab === 'register' ? $('authName') : $('authLogin')).focus(), 60);
  });
}

async function submitAuth(e) {
  e.preventDefault();
  const login = $('authLogin').value.trim();
  const pass = $('authPass').value;
  const msg = $('authMsg');
  if (!login) { msg.textContent = 'Nhập số điện thoại hoặc email.'; return; }
  if (pass.length < 6) { msg.textContent = 'Mật khẩu cần ít nhất 6 ký tự.'; return; }
  const btn = $('authSubmit');
  btn.disabled = true;
  msg.textContent = '';
  try {
    let r;
    if (authTab === 'register') {
      const [dev, fp] = await Promise.all([deviceId().catch(() => null), fingerprint().catch(() => null)]);
      r = await rpc('vt_signup2', { p_login: login, p_password: pass, p_name: $('authName').value.trim(), p_ref: getRef(), p_device: dev, p_fp: fp });
      track('register');
      rpc('vt_set_source', { p_token: r.token, p_source: firstSource() || (getRef() ? 'gioi-thieu-ban' : 'truc-tiep') }).catch(() => {});
      try { localStorage.removeItem(REF_KEY); } catch { /* bỏ qua */ }
    } else {
      r = await rpc('vt_login', { p_login: login, p_password: pass });
      if (!r.ok) { msg.textContent = r.message; return; }
      // Ghi nhận máy này đã có tài khoản (tài khoản tạo thêm trên máy này sẽ không được tặng lượt dùng thử lần nữa)
      Promise.all([deviceId(), fingerprint()]).then(([d, f]) => rpc('vt_set_device', { p_token: r.token, p_device: d, p_fp: f })).catch(() => {});
    }
    try { localStorage.setItem('vitri.hasAcct', '1'); } catch { /* bỏ qua */ }
    setSession(r.token, r.profile);
    $('authPass').value = '';
    $('authDlg').close();
    toast(authTab !== 'register' ? `Xin chào ${r.profile.name || ''}`.trim() + '.'
      : r.trial_blocked ? 'Đã tạo tài khoản. Máy này đã nhận lượt dùng thử trước đó nên tài khoản mới không được tặng thêm. Mua gói để xuất video.'
      : `Đã tạo tài khoản. Anh/chị có ${r.profile.credits} lượt dùng thử${r.ref_bonus ? ` (đã gồm ${r.ref_bonus} lượt thưởng giới thiệu)` : ''}.`,
    r.trial_blocked ? 6500 : 3500);
    refreshAccount();
    const f = authResolve; authResolve = null; f?.(true);
  } catch (err) {
    msg.textContent = err.message;
    if (err.hint === 'EXISTS') setTimeout(() => { setAuthTab('login'); $('authMsg').textContent = err.message; }, 0);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Xuất video: trừ lượt trên máy chủ ----------
export async function beginExport(loc) {
  if (!S.profile) {
    const ok = await requireLogin(`Đăng ký miễn phí để xuất video. Tài khoản mới được tặng ${S.info?.trial_credits ?? 3} video.`);
    if (!ok) return null;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await rpc('vt_export_begin', { p_token: S.token, p_lat: loc.lat, p_lng: loc.lng });
      S.profile = r.profile;
      if (!r.ok) {
        emit();
        if (r.code === 'NO_CREDIT') openPricing(r.message);
        else toast(r.message, 5000);
        return null;
      }
      S.reexportUntil = r.until;
      emit();
      if (r.charged || r.mode === 'unlimited') track('export');
      return r;
    } catch (e) {
      if ((e.hint === 'AUTH') && attempt === 0) {
        clearSession();
        const ok = await requireLogin('Phiên đăng nhập đã hết hạn, mời đăng nhập lại.', 'login');
        if (!ok) return null;
        continue;
      }
      toast(e.message, 5000);
      return null;
    }
  }
  return null;
}

// Lỗi từ /api/tts, /api/script: mở đúng hộp thoại. Trả về true nếu đã xử lý.
export async function handleAiError(status, j) {
  if (status === 401 || j?.code === 'AUTH') {
    clearSession();
    await requireLogin('Đăng nhập để dùng giọng đọc AI.', 'login');
    return true;
  }
  if (status === 402 || j?.code === 'NO_CREDIT') { openPricing(j?.error || 'Đã hết lượt.'); return true; }
  return false;
}

// ---------- Bảng giá + VietQR ----------
function tlv(id, v) { return id + String(v.length).padStart(2, '0') + v; }
function crc16(s) {
  let crc = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
// Chuỗi VietQR (chuẩn EMVCo của NAPAS) để app ngân hàng nào cũng quét được
export function vietqrPayload({ bin, account, amount, info }) {
  const acc = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', account)) + tlv('02', 'QRIBFTTA');
  const s = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('38', acc) + tlv('53', '704')
    + (amount ? tlv('54', String(Math.round(amount))) : '') + tlv('58', 'VN')
    + (info ? tlv('62', tlv('08', info)) : '') + '6304';
  return s + crc16(s);
}
function drawQr(canvas, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const cell = Math.max(3, Math.floor(260 / (n + quiet * 2)));
  const size = cell * (n + quiet * 2);
  canvas.width = size; canvas.height = size;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, size, size);
  c.fillStyle = '#0b1210';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) c.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
}

function payView(v) {
  $('payPick').hidden = v !== 'pick';
  $('payQr').hidden = v !== 'qr';
  $('payDone').hidden = v !== 'done';
}

export async function openPricing(reason = '') {
  if (!S.profile) {
    const ok = await requireLogin('Đăng nhập để mua thêm lượt.');
    if (!ok) return;
  }
  const dlg = $('payDlg');
  $('payReason').textContent = reason;
  $('payReason').hidden = !reason;
  payView('pick');
  hideToast();
  if (!dlg.open) dlg.showModal();
  const list = $('pkgList');
  list.innerHTML = '<p class="hint">Đang tải bảng giá…</p>';
  S.info = null;
  const info = await loadInfo();
  if (!info) { list.innerHTML = '<p class="hint err">Không tải được bảng giá. Kiểm tra mạng rồi thử lại.</p>'; return; }
  list.innerHTML = info.packages.map(p => {
    const per = p.credits ? `${money(p.price / p.credits)}/video` : `${p.days} ngày`;
    return `<button type="button" class="pkg${p.highlight ? ' hot' : ''}" data-pkg="${esc(p.id)}">
      ${p.highlight ? '<span class="pkg-tag">Nhiều người chọn</span>' : ''}
      <span class="pkg-name">${esc(p.name)}</span>
      <span class="pkg-price">${money(p.price)}</span>
      <span class="pkg-per">${esc(per)}</span>
      <span class="pkg-desc">${esc(p.description)}</span>
    </button>`;
  }).join('') || '<p class="hint">Chưa có gói nào đang bán.</p>';
  if (S.order && S.order.status === 'pending') {
    list.insertAdjacentHTML('afterbegin', `<button type="button" class="pending-order" data-resume="1">Đơn <strong class="mono">${esc(S.order.code)}</strong> đang chờ thanh toán (${money(S.order.amount)}). Mở lại mã QR</button>`);
  }
}

let pollTimer = null;
function stopPoll() { clearInterval(pollTimer); pollTimer = null; }

function showOrder(order, bank) {
  S.order = { ...order, bank };
  $('payTitle').textContent = order.package_name;
  $('pBank').textContent = bank.name || '';
  $('pAcc').textContent = bank.account;
  $('pHolder').textContent = bank.holder || '—';
  $('pHolderRow').hidden = !bank.holder;
  $('pAmount').textContent = money(order.amount);
  $('pAmount').dataset.raw = String(order.amount);
  $('pCode').textContent = order.code;
  $('payHelpZalo').hidden = !bank.zalo;
  // Ảnh QR của SePay (vietqr.app) có sẵn số tiền + nội dung là mã đơn để tự cộng lượt.
  // Ảnh không tải được thì vẽ mã VietQR ngay trên máy (cùng tài khoản, cùng số tiền, cùng nội dung).
  const qs = new URLSearchParams({ acc: bank.account, bank: bank.bin, amount: String(order.amount), des: order.code, template: '', showinfo: 'true' });
  if (bank.holder) qs.set('holder', bank.holder);
  const qrUrl = 'https://vietqr.app/img?' + qs.toString();
  const img = $('qrImg'), cv = $('qrCanvas');
  const fallback = () => {
    img.hidden = true; cv.hidden = false;
    drawQr(cv, vietqrPayload({ bin: bank.bin, account: bank.account, amount: order.amount, info: order.code }));
  };
  img.onerror = fallback;
  img.onload = () => { img.hidden = false; cv.hidden = true; };
  img.src = qrUrl;
  $('qrDownload').href = qrUrl + '&download=true';
  setTimeout(() => { if (!img.complete || !img.naturalWidth) fallback(); }, 6000);
  $('payStatus').className = 'pay-status';
  $('payStatus').innerHTML = '<span class="spinner" aria-hidden="true"></span> Đang chờ ngân hàng báo về…';
  payView('qr');
  stopPoll();
  const started = Date.now();
  pollTimer = setInterval(async () => {
    if (!$('payDlg').open) { stopPoll(); return; }
    if (Date.now() - started > 30 * 60 * 1000) { stopPoll(); return; }
    try {
      const r = await rpc('vt_order_status', { p_token: S.token, p_code: order.code });
      if (r.order.status === 'paid') {
        stopPoll();
        S.profile = r.profile;
        S.order = null;
        emit();
        const p = r.profile;
        $('payDoneText').textContent = p.unlimited
          ? `Đã nhận ${money(order.amount)}. Gói không giới hạn tới ${fmtDate(p.unlimited_until, false)}.`
          : `Đã nhận ${money(order.amount)}. Tài khoản hiện có ${p.credits} lượt.`;
        payView('done');
        toast('Thanh toán thành công, đã cộng lượt.', 4000);
        track('purchase', { value: order.amount, id: order.package_id });
      }
    } catch { /* thử lại ở vòng sau */ }
  }, 4000);
}

async function pickPackage(id) {
  const list = $('pkgList');
  list.classList.add('busy');
  try {
    const r = await rpc('vt_create_order', { p_token: S.token, p_package: id });
    showOrder(r.order, r.bank);
    track('checkout', { value: r.order.amount, id });
  } catch (e) {
    if (e.hint === 'AUTH') { clearSession(); $('payDlg').close(); requireLogin('Phiên đăng nhập đã hết hạn.', 'login'); return; }
    toast(e.message, 5000);
  } finally {
    list.classList.remove('busy');
  }
}

async function copyText(text, label) {
  try { await navigator.clipboard.writeText(text); toast('Đã chép ' + label + '.'); }
  catch { toast('Không chép được, hãy chép tay: ' + text, 4000); }
}

// ---------- Bảng tài khoản ----------
async function openAccount() {
  if (!S.profile) { requireLogin(); return; }
  const p = S.profile;
  $('acName').textContent = p.name || 'Tài khoản của anh/chị';
  $('acLogin').textContent = p.login;
  $('acCredits').innerHTML = p.unlimited
    ? `<strong>Không giới hạn</strong><span>tới ${fmtDate(p.unlimited_until, false)}${p.credits ? ` · còn ${p.credits} lượt lẻ` : ''}</span>`
    : `<strong>${p.credits}</strong><span>lượt xuất video</span>`;
  renderRef();
  $('acHist').innerHTML = '';
  $('acHistBox').open = false;
  $('pwMsg').textContent = '';
  $('acctDlg').showModal();
}
// ---------- Giới thiệu bạn bè ----------
function refLink() {
  const code = S.ref?.code || S.profile?.ref_code;
  return code ? `${location.origin}/gioi-thieu?ref=${code}` : '';
}
function renderRef() {
  const box = $('acRef');
  if (!box) return;
  const link = refLink();
  const bonus = S.ref?.bonus ?? S.info?.ref_bonus ?? 2;
  box.hidden = !link || !bonus;
  if (!link) return;
  $('refLink').value = link;
  $('refDesc').textContent = `Gửi link cho bạn bè môi giới: bạn đăng ký qua link được tặng thêm ${bonus} lượt. Khi bạn xuất video đầu tiên, anh/chị được cộng ${bonus} lượt.`;
  const inv = S.ref?.invited || 0, done = S.ref?.rewarded || 0;
  $('refStats').textContent = inv ? `Đã mời ${inv} người · ${done} người đã xuất video (anh/chị đã nhận ${done * bonus} lượt)` : 'Chưa mời ai.';
  $('refShare').hidden = !navigator.share;
}
async function openInvite() {
  if (!S.profile) { requireLogin('Đăng nhập để lấy link giới thiệu của anh/chị.'); return; }
  await refreshAccount();
  openAccount();
  setTimeout(() => $('acRef')?.scrollIntoView({ block: 'center' }), 80);
}

async function loadHistory() {
  const box = $('acHist');
  box.innerHTML = '<p class="hint">Đang tải…</p>';
  try {
    const r = await rpc('vt_history', { p_token: S.token });
    const st = { pending: 'Chờ thanh toán', paid: 'Đã thanh toán', cancelled: 'Đã huỷ' };
    const orders = r.orders.map(o => `<li><span>${fmtDate(o.created_at)}</span><span>${esc(o.package_name)} · ${money(o.amount)}</span><span class="st st-${o.status}">${st[o.status] || o.status}</span></li>`).join('');
    const usage = r.usage.map(u => `<li><span>${fmtDate(u.at)}</span><span>${esc(u.note)}</span><span class="${u.kind === 'grant' ? 'plus' : 'minus'}">${u.kind === 'grant' ? (u.credits ? '+' + u.credits : '') : (u.credits ? '−' + u.credits : '0')}</span></li>`).join('');
    box.innerHTML = `<h4>Thanh toán</h4>${orders ? `<ul class="hist-list">${orders}</ul>` : '<p class="hint">Chưa có đơn nào.</p>'}
      <h4>Lượt dùng</h4>${usage ? `<ul class="hist-list">${usage}</ul>` : '<p class="hint">Chưa dùng lượt nào.</p>'}`;
  } catch (e) { box.innerHTML = `<p class="hint err">${esc(e.message)}</p>`; }
}

export async function initAccount(opts = {}) {
  if (opts.toast) toast = opts.toast;
  captureRef();
  S.token = readToken();
  $('acctBtn').addEventListener('click', () => (S.profile ? openAccount() : requireLogin()));
  $('authTabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setAuthTab(b.dataset.tab); });
  $('authForm').addEventListener('submit', submitAuth);
  $('authDlg').addEventListener('close', () => { const f = authResolve; authResolve = null; f?.(false); });
  for (const d of document.querySelectorAll('dialog.dlg')) {
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  }
  $('payDlg').addEventListener('close', stopPoll);
  $('pkgList').addEventListener('click', e => {
    if (e.target.closest('[data-resume]') && S.order?.bank) { showOrder(S.order, S.order.bank); return; }
    if (e.target.closest('[data-resume]')) { pickPackage(S.order.package_id); return; }
    const b = e.target.closest('button[data-pkg]');
    if (b) pickPackage(b.dataset.pkg);
  });
  $('payBack').addEventListener('click', () => { stopPoll(); openPricing(); });
  $('payQr').addEventListener('click', e => {
    const b = e.target.closest('button[data-copy]');
    if (!b) return;
    if (b.dataset.copy === 'amount') copyText($('pAmount').dataset.raw, 'số tiền');
    else if (b.dataset.copy === 'acc') copyText($('pAcc').textContent, 'số tài khoản');
    else copyText($('pCode').textContent, 'nội dung chuyển khoản');
  });
  $('payCancel').addEventListener('click', async () => {
    const code = S.order?.code;
    stopPoll();
    if (code) { try { await rpc('vt_cancel_order', { p_token: S.token, p_code: code }); } catch { /* bỏ qua */ } }
    S.order = null;
    openPricing();
  });
  $('payDoneBtn').addEventListener('click', () => $('payDlg').close());
  $('acBuy').addEventListener('click', () => { $('acctDlg').close(); openPricing(); });
  $('acHistBox').addEventListener('toggle', e => { if (e.target.open) loadHistory(); });
  $('refCopy').addEventListener('click', () => copyText(refLink(), 'link giới thiệu'));
  $('refShare').addEventListener('click', async () => {
    try { await navigator.share({ title: 'Vị Trí Studio', text: 'Làm video vị trí & tiện ích bất động sản tự động, có giọng đọc AI. Đăng ký qua link này được tặng thêm lượt:', url: refLink() }); }
    catch { /* người dùng huỷ */ }
  });
  $('acLogout').addEventListener('click', async () => {
    const t = S.token;
    clearSession();
    $('acctDlg').close();
    toast('Đã đăng xuất.');
    try { await rpc('vt_logout', { p_token: t }); } catch { /* bỏ qua */ }
  });
  $('pwBtn').addEventListener('click', async () => {
    const msg = $('pwMsg');
    try {
      const r = await rpc('vt_change_password', { p_token: S.token, p_old: $('pwOld').value, p_new: $('pwNew').value });
      msg.textContent = r.ok ? 'Đã đổi mật khẩu.' : r.message;
      msg.className = 'hint ' + (r.ok ? 'ok' : 'err');
      if (r.ok) { $('pwOld').value = ''; $('pwNew').value = ''; }
    } catch (e) { msg.textContent = e.message; msg.className = 'hint err'; }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'register') requireLogin('', 'register');
    else if (b.dataset.act === 'buy') openPricing();
    else if (b.dataset.act === 'invite') openInvite();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token) refreshAccount(); });
  emit();
  loadInfo().then(emit);
  if (S.token) await refreshAccount();
}
