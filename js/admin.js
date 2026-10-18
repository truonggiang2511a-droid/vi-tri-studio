// Trang quản trị: đơn hàng, khách hàng, giao dịch ngân hàng, cài đặt và gói giá.
// Mọi thao tác đi qua hàm vt_admin_* trên Supabase, kiểm tra mã quản trị phía cơ sở dữ liệu.
import { rpc, money } from './account.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'vitri.admin.key';
let adminKey = '';
let setupMode = false;
const fmt = d => {
  if (!d) return '';
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')} ${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getFullYear()).slice(2)}`;
};
const BANKS = [
  ['970422', 'MB Bank'], ['970436', 'Vietcombank'], ['970407', 'Techcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'],
  ['970405', 'Agribank'], ['970416', 'ACB'], ['970432', 'VPBank'], ['970423', 'TPBank'], ['970403', 'Sacombank'],
  ['970441', 'VIB'], ['970437', 'HDBank'], ['970448', 'OCB'], ['970443', 'SHB'], ['970426', 'MSB'], ['970431', 'Eximbank'],
  ['970440', 'SeABank'], ['970449', 'LPBank'], ['970428', 'Nam A Bank'], ['970452', 'KienlongBank'], ['970454', 'BVBank (Timo)'],
];

let toastTimer;
function toast(msg, ms = 2800) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}
async function call(fn, args = {}) {
  try { return await rpc(fn, { p_key: adminKey, ...args }); }
  catch (e) { if (e.hint === 'ADMIN') logout(); throw e; }
}

// ---------- Đăng nhập ----------
async function showLogin() {
  $('app').hidden = true; $('logoutBtn').hidden = true; $('loginBox').hidden = false;
  try {
    const st = await rpc('vt_admin_status');
    setupMode = !st.has_key;
  } catch (e) { $('loginMsg').textContent = e.message; }
  $('loginTitle').textContent = setupMode ? 'Tạo mã quản trị' : 'Đăng nhập quản trị';
  $('loginHint').textContent = setupMode ? 'Lần đầu sử dụng: đặt mã quản trị (ít nhất 10 ký tự). Chỉ người có mã này vào được trang quản trị.' : '';
  $('key2Field').hidden = !setupMode;
  $('keyInput').autocomplete = setupMode ? 'new-password' : 'current-password';
  $('loginBtn').textContent = setupMode ? 'Tạo mã và vào trang quản trị' : 'Đăng nhập';
  $('keyInput').focus();
}
async function submitLogin(e) {
  e.preventDefault();
  const k = $('keyInput').value;
  const msg = $('loginMsg');
  msg.textContent = '';
  try {
    if (setupMode) {
      if (k.length < 10) { msg.textContent = 'Mã quản trị cần ít nhất 10 ký tự.'; return; }
      if (k !== $('key2Input').value) { msg.textContent = 'Hai lần nhập chưa khớp.'; return; }
      await rpc('vt_admin_setup', { p_new_key: k });
    }
    adminKey = k;
    await call('vt_admin_overview');
    try { sessionStorage.setItem(KEY, k); } catch { /* bỏ qua */ }
    $('keyInput').value = ''; $('key2Input').value = '';
    enter();
  } catch (err) { msg.textContent = err.message; adminKey = ''; }
}
function logout() {
  adminKey = '';
  try { sessionStorage.removeItem(KEY); } catch { /* bỏ qua */ }
  showLogin();
}
function enter() {
  $('loginBox').hidden = true; $('app').hidden = false; $('logoutBtn').hidden = false;
  loadStats(); loadOrders();
}

// ---------- Tổng quan ----------
async function loadStats() {
  try {
    const s = await call('vt_admin_overview');
    const items = [
      [s.users, 'Khách hàng', ''], [s.users_7d, 'Mới 7 ngày', ''], [s.paying_users, 'Đã từng trả tiền', ''],
      [money(s.revenue_month), 'Doanh thu tháng này', ''], [money(s.revenue_total), 'Tổng doanh thu', ''],
      [s.orders_pending, 'Đơn chờ thanh toán', s.orders_pending ? 'warn' : ''], [s.exports_today, 'Video xuất hôm nay', ''],
      [s.exports_total, 'Tổng video đã xuất', ''], [Number(s.tts_chars_month).toLocaleString('vi-VN'), 'Ký tự giọng AI tháng này', ''],
      [s.unmatched, 'Tiền vào chưa khớp đơn', s.unmatched ? 'warn' : ''], [s.webhook_ready ? 'Đã bật' : 'Chưa bật', 'Tự xác nhận SePay', s.webhook_ready ? '' : 'warn'],
    ];
    $('stats').innerHTML = items.map(([v, l, c]) => `<div class="stat ${c}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  } catch (e) { toast(e.message); }
}

// ---------- Đơn hàng ----------
const ST = { pending: 'Chờ thanh toán', paid: 'Đã thanh toán', cancelled: 'Đã huỷ' };
async function loadOrders() {
  const tb = $('orderRows');
  tb.innerHTML = '<tr><td colspan="7" class="muted">Đang tải…</td></tr>';
  try {
    const rows = await call('vt_admin_orders', { p_status: $('orderStatus').value || null, p_q: $('orderQ').value.trim() || null });
    tb.innerHTML = rows.map(o => `<tr>
      <td class="num"><strong>${esc(o.code)}</strong></td>
      <td>${esc(o.name || '—')}<span class="sub">${esc(o.login)}</span></td>
      <td>${esc(o.package_name)}</td>
      <td class="num">${money(o.amount)}${o.paid_amount && o.paid_amount !== o.amount ? `<span class="sub">nhận ${money(o.paid_amount)}</span>` : ''}</td>
      <td><span class="badge ${o.status}">${ST[o.status] || o.status}</span>${o.paid_via ? `<span class="sub">${esc(o.paid_via)}${o.paid_at ? ' · ' + fmt(o.paid_at) : ''}</span>` : ''}</td>
      <td class="num">${fmt(o.created_at)}</td>
      <td><div class="acts">${o.status !== 'paid' ? `<button class="btn btn-primary" data-paid="${esc(o.code)}" type="button">Đã nhận tiền</button>` : ''}${o.status === 'pending' ? `<button class="btn btn-quiet" data-cancel="${esc(o.code)}" type="button">Huỷ</button>` : ''}</div></td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">Không có đơn nào.</td></tr>';
  } catch (e) { tb.innerHTML = `<tr><td colspan="7" class="hint err">${esc(e.message)}</td></tr>`; }
}
let armed = null;
async function orderAction(e) {
  const b = e.target.closest('button[data-paid], button[data-cancel]');
  if (!b) return;
  const code = b.dataset.paid || b.dataset.cancel;
  const key = (b.dataset.paid ? 'paid:' : 'cancel:') + code;
  // Bấm hai lần để chắc chắn (không dùng hộp thoại của trình duyệt)
  if (armed !== key) {
    armed = key;
    b.textContent = b.dataset.paid ? 'Bấm lần nữa để xác nhận' : 'Bấm lần nữa để huỷ';
    setTimeout(() => { if (armed === key) { armed = null; loadOrders(); } }, 4000);
    return;
  }
  armed = null;
  b.disabled = true;
  try {
    if (b.dataset.paid) { await call('vt_admin_mark_paid', { p_code: code }); toast(`Đã xác nhận ${code}, lượt đã cộng cho khách.`); }
    else { await call('vt_admin_cancel_order', { p_code: code }); toast(`Đã huỷ ${code}.`); }
    loadOrders(); loadStats();
  } catch (err) { toast(err.message, 4000); b.disabled = false; }
}

// ---------- Khách hàng ----------
let users = [];
async function loadUsers() {
  const tb = $('userRows');
  tb.innerHTML = '<tr><td colspan="9" class="muted">Đang tải…</td></tr>';
  try {
    users = await call('vt_admin_users', { p_q: $('userQ').value.trim() || null });
    tb.innerHTML = users.map(u => `<tr data-row="${u.id}">
      <td>${esc(u.name || '—')}<span class="sub">${esc(u.login)}</span>${u.note ? `<span class="sub">📝 ${esc(u.note)}</span>` : ''}</td>
      <td class="num">${u.credits}</td>
      <td class="num">${u.unlimited ? fmt(u.unlimited_until) : '<span class="muted">—</span>'}</td>
      <td class="num">${u.exports}</td>
      <td class="num">${money(u.paid_total)}</td>
      <td class="num">${u.invited ? `mời ${u.invited}` : '—'}${u.invited_by ? `<span class="sub">do ${esc(u.invited_by)} mời</span>` : ''}${u.ref_code ? `<span class="sub mono">mã ${esc(u.ref_code)}</span>` : ''}</td>
      <td class="num">${fmt(u.created_at)}<span class="sub">vào lần cuối ${fmt(u.last_login) || '—'}</span></td>
      <td><span class="badge ${u.status}">${u.status === 'active' ? 'Hoạt động' : 'Đã khoá'}</span></td>
      <td><button class="btn btn-quiet" type="button" data-edit="${u.id}">Sửa</button></td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">Chưa có khách hàng.</td></tr>';
  } catch (e) { tb.innerHTML = `<tr><td colspan="9" class="hint err">${esc(e.message)}</td></tr>`; }
}
function genPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(r, x => a[x % a.length]).join('');
}
function openUserEdit(id) {
  document.querySelector('tr.edit-row')?.remove();
  const u = users.find(x => x.id === id);
  const row = document.querySelector(`tr[data-row="${id}"]`);
  if (!u || !row) return;
  row.insertAdjacentHTML('afterend', `<tr class="edit-row"><td colspan="9">
    <div class="edit-grid">
      <label class="field"><span class="field-label">Cộng/trừ lượt</span><input class="input" type="number" data-f="credits" value="0"></label>
      <label class="field"><span class="field-label">Cộng/trừ ngày không giới hạn</span><input class="input" type="number" data-f="days" value="0"></label>
      <label class="field"><span class="field-label">Lý do (khách thấy trong lịch sử)</span><input class="input" data-f="reason" placeholder="Tặng thêm, bù lỗi…"></label>
      <button class="btn btn-primary" type="button" data-do="adjust">Lưu lượt</button>
    </div>
    <div class="edit-grid" style="margin-top:10px">
      <label class="field"><span class="field-label">Ghi chú nội bộ</span><input class="input" data-f="note" value="${esc(u.note)}"></label>
      <button class="btn btn-quiet" type="button" data-do="note">Lưu ghi chú</button>
      <button class="btn btn-quiet" type="button" data-do="reset">Đặt lại mật khẩu</button>
      <button class="btn btn-quiet" type="button" data-do="${u.status === 'active' ? 'lock' : 'unlock'}">${u.status === 'active' ? 'Khoá tài khoản' : 'Mở khoá'}</button>
    </div>
    <p class="hint" data-f="msg" style="margin-top:8px"></p>
  </td></tr>`);
  const er = row.nextElementSibling;
  er.addEventListener('click', async e => {
    const b = e.target.closest('button[data-do]');
    if (!b) return;
    const f = n => er.querySelector(`[data-f="${n}"]`);
    const msg = f('msg');
    b.disabled = true;
    try {
      if (b.dataset.do === 'adjust') {
        const c = parseInt(f('credits').value, 10) || 0, d = parseInt(f('days').value, 10) || 0;
        if (!c && !d) { msg.textContent = 'Nhập số lượt hoặc số ngày.'; return; }
        const p = await call('vt_admin_adjust', { p_user: id, p_credits: c, p_days: d, p_note: f('reason').value.trim() });
        msg.textContent = `Đã lưu. Khách còn ${p.credits} lượt${p.unlimited ? ', không giới hạn tới ' + fmt(p.unlimited_until) : ''}.`;
      } else if (b.dataset.do === 'note') {
        await call('vt_admin_user_update', { p_user: id, p_note: f('note').value });
        msg.textContent = 'Đã lưu ghi chú.';
      } else if (b.dataset.do === 'reset') {
        const pw = genPassword();
        await call('vt_admin_user_update', { p_user: id, p_password: pw });
        msg.innerHTML = `Mật khẩu mới: <span class="code">${pw}</span>. Gửi cho khách và nhắc khách đổi lại trong app.`;
      } else {
        await call('vt_admin_user_update', { p_user: id, p_status: b.dataset.do === 'lock' ? 'locked' : 'active' });
        msg.textContent = b.dataset.do === 'lock' ? 'Đã khoá, khách bị đăng xuất.' : 'Đã mở khoá.';
      }
      const keep = msg.innerHTML;
      await loadUsers();
      openUserEdit(id);
      document.querySelector('tr.edit-row [data-f="msg"]').innerHTML = keep;
    } catch (err) { msg.textContent = err.message; }
    finally { b.disabled = false; }
  });
}

// ---------- Giao dịch ngân hàng ----------
async function loadPayments() {
  const tb = $('payRows');
  tb.innerHTML = '<tr><td colspan="5" class="muted">Đang tải…</td></tr>';
  try {
    const rows = await call('vt_admin_payments');
    tb.innerHTML = rows.map(p => `<tr><td class="num">${fmt(p.at)}</td><td class="num">${money(p.amount)}</td><td>${esc(p.content)}</td><td class="num">${esc(p.code || '')}</td><td><span class="badge ${esc(p.result)}">${esc(p.result || '')}</span></td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">Chưa có giao dịch nào được báo về.</td></tr>';
  } catch (e) { tb.innerHTML = `<tr><td colspan="5" class="hint err">${esc(e.message)}</td></tr>`; }
}

// ---------- Cài đặt & gói ----------
function pkgRow(p = {}) {
  const isNew = !p.id;
  return `<div class="pkg-edit" data-pkg="${esc(p.id || '')}">
    <input class="input mono" data-k="id" value="${esc(p.id || '')}" ${isNew ? 'placeholder="goi50"' : 'readonly'}>
    <input class="input" data-k="name" value="${esc(p.name || '')}" placeholder="Tên gói">
    <input class="input" data-k="description" value="${esc(p.description || '')}" placeholder="Mô tả ngắn">
    <input class="input mono" data-k="price_vnd" type="number" min="1000" step="1000" value="${p.price_vnd ?? ''}">
    <input class="input mono" data-k="credits" type="number" min="0" value="${p.credits ?? 0}">
    <input class="input mono" data-k="days" type="number" min="0" value="${p.days ?? 0}">
    <input class="input mono" data-k="sort" type="number" value="${p.sort ?? 0}">
    <div class="acts">
      <label class="check"><input type="checkbox" data-k="active" ${p.active !== false ? 'checked' : ''}> Đang bán</label>
      <label class="check"><input type="checkbox" data-k="highlight" ${p.highlight ? 'checked' : ''}> Nổi bật</label>
      <button class="btn btn-primary" type="button" data-save>Lưu</button>
    </div>
  </div>`;
}
async function loadSettings() {
  try {
    const r = await call('vt_admin_settings');
    const c = r.config;
    $('cBank').innerHTML = BANKS.map(([bin, n]) => `<option value="${bin}">${n}</option>`).join('')
      + (BANKS.some(b => b[0] === c.bank_bin) ? '' : `<option value="${esc(c.bank_bin)}">${esc(c.bank_name)} (${esc(c.bank_bin)})</option>`);
    $('cBank').value = c.bank_bin;
    $('cAcc').value = c.bank_account; $('cHolder').value = c.bank_holder; $('cZalo').value = c.zalo_url;
    $('cTrial').value = c.trial_credits; $('cReexp').value = c.reexport_hours; $('cTts').value = c.tts_daily_chars;
    $('cUnl').value = c.unlimited_daily_exports; $('cIp').value = c.signup_per_ip_day;
    $('cRef').value = c.ref_bonus ?? 2; $('cRefMax').value = c.ref_max_month ?? 30;
    $('cHook').value = ''; $('cNewKey').value = '';
    $('hookUrl').textContent = location.origin + '/api/sepay';
    $('hookState').textContent = c.webhook_ready ? 'đã đặt khoá, đang tự xác nhận' : 'chưa đặt khoá (đơn phải xác nhận tay)';
    $('pkgRows').innerHTML = r.packages.map(pkgRow).join('');
  } catch (e) { toast(e.message, 4000); }
}
async function saveConfig(e) {
  e.preventDefault();
  const sel = $('cBank');
  // Ô số để trống thì giữ nguyên giá trị cũ (không lưu thành 0)
  const num = id => { const v = $(id).value.trim(); return v === '' ? null : Math.round(Number(v)); };
  const p = {
    bank_bin: sel.value, bank_name: sel.options[sel.selectedIndex]?.text.replace(/\s*\(\d+\)$/, '') || '',
    bank_account: $('cAcc').value.trim(), bank_holder: $('cHolder').value.trim(), zalo_url: $('cZalo').value.trim(),
    trial_credits: num('cTrial'), reexport_hours: num('cReexp'), tts_daily_chars: num('cTts'),
    unlimited_daily_exports: num('cUnl'), signup_per_ip_day: num('cIp'),
    ref_bonus: num('cRef'), ref_max_month: num('cRefMax'),
  };
  const warn = [];
  if (p.tts_daily_chars !== null && p.tts_daily_chars < 3000) warn.push('Giới hạn ký tự giọng AI nên từ 3.000 trở lên (1 video cần khoảng 1.000–1.500 ký tự).');
  if (p.unlimited_daily_exports !== null && p.unlimited_daily_exports < 1) warn.push('Gói không giới hạn cần ít nhất 1 video/ngày.');
  if (p.signup_per_ip_day !== null && p.signup_per_ip_day < 1) warn.push('Số tài khoản mới mỗi mạng cần ít nhất 1.');
  if (warn.length) { $('cfgMsg').textContent = warn.join(' '); $('cfgMsg').className = 'hint err'; return; }
  const hook = $('cHook').value.trim();
  const nk = $('cNewKey').value;
  if (hook && hook.length < 8) { $('cfgMsg').textContent = 'Khoá webhook cần ít nhất 8 ký tự.'; return; }
  if (nk && nk.length < 10) { $('cfgMsg').textContent = 'Mã quản trị mới cần ít nhất 10 ký tự.'; return; }
  if (hook) p.webhook_key = hook;
  if (nk) p.new_admin_key = nk;
  try {
    await call('vt_admin_save_config', { p });
    if (nk) { adminKey = nk; try { sessionStorage.setItem(KEY, nk); } catch { /* bỏ qua */ } }
    $('cfgMsg').textContent = 'Đã lưu.';
    $('cfgMsg').className = 'hint ok';
    loadSettings(); loadStats();
  } catch (err) { $('cfgMsg').textContent = err.message; $('cfgMsg').className = 'hint err'; }
}
async function savePackage(e) {
  const b = e.target.closest('button[data-save]');
  if (!b) return;
  const row = b.closest('.pkg-edit');
  const v = k => row.querySelector(`[data-k="${k}"]`);
  const p = {
    id: v('id').value.trim().toLowerCase(), name: v('name').value.trim(), description: v('description').value.trim(),
    price_vnd: parseInt(v('price_vnd').value, 10), credits: parseInt(v('credits').value, 10) || 0, days: parseInt(v('days').value, 10) || 0,
    sort: parseInt(v('sort').value, 10) || 0, active: v('active').checked, highlight: v('highlight').checked,
  };
  if (!p.price_vnd || p.price_vnd < 1000) { $('pkgMsg').textContent = 'Nhập giá gói (đồng).'; return; }
  if (!p.credits && !p.days) { $('pkgMsg').textContent = 'Gói cần có số lượt hoặc số ngày.'; return; }
  try {
    await call('vt_admin_save_package', { p });
    $('pkgMsg').textContent = `Đã lưu gói ${p.name || p.id}.`;
    $('pkgMsg').className = 'hint ok';
    loadSettings();
  } catch (err) { $('pkgMsg').textContent = err.message; $('pkgMsg').className = 'hint err'; }
}

// ---------- Phễu & chăm sóc ----------
let funDays = 30;
const pct = (a, b) => (b > 0 ? Math.round(100 * a / b) + '%' : '—');
const SRC_NAME = { facebook: 'Facebook', tiktok: 'TikTok', google: 'Google', zalo: 'Zalo', youtube: 'YouTube', 'truc-tiep': 'Trực tiếp / không rõ', 'khong-ro': 'Trước khi đo nguồn', 'gioi-thieu-ban': 'Bạn bè giới thiệu' };
async function loadFunnel() {
  const steps = $('funSteps');
  steps.innerHTML = '<p class="hint">Đang tải…</p>';
  try {
    const f = await call('vt_admin_funnel', { p_days: funDays });
    const card = (n, label, sub, cls = '') => `<div class="fun-step ${cls}"><b>${n}</b><span>${label}</span>${sub ? `<em>${sub}</em>` : ''}</div>`;
    steps.innerHTML = [
      card(Number(f.visits_landing).toLocaleString('vi-VN'), 'Lượt vào trang giới thiệu'),
      card(Number(f.visits_app).toLocaleString('vi-VN'), 'Lượt vào app'),
      card(f.signups, 'Đăng ký mới', f.visits_landing ? `${pct(f.signups, f.visits_landing)} so với lượt vào trang giới thiệu` : ''),
      card(f.exported, 'Đã xuất video', `${pct(f.exported, f.signups)} người đăng ký`),
      card(f.paid, 'Đã mua gói', `${pct(f.paid, f.signups)} người đăng ký`),
      card(money(f.revenue), `Doanh thu ${f.days} ngày`, `${f.orders_paid} đơn đã trả`, 'money'),
      card(f.ref_signups, 'Đăng ký qua giới thiệu', f.signups ? `${pct(f.ref_signups, f.signups)} người đăng ký` : ''),
    ].join('');
    const rows = {};
    for (const v of f.visit_sources) rows[v.source] = { source: v.source, landing: v.landing, app: v.app, signups: 0, exported: 0, paid: 0 };
    for (const u of f.by_source) rows[u.source] = { landing: 0, app: 0, ...(rows[u.source] || {}), source: u.source, signups: u.signups, exported: u.exported, paid: u.paid };
    const list = Object.values(rows).sort((a, b) => b.signups - a.signups || (b.landing + b.app) - (a.landing + a.app));
    $('funSrc').innerHTML = list.map(r => `<tr><td>${esc(SRC_NAME[r.source] || r.source)}</td><td class="num">${r.landing}</td><td class="num">${r.app}</td><td class="num">${r.signups}</td><td class="num">${r.exported}</td><td class="num">${r.paid}</td><td class="num">${pct(r.paid, r.signups)}</td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">Chưa có dữ liệu.</td></tr>';
    const maxV = Math.max(1, ...f.daily.map(d => d.visits));
    $('funDaily').innerHTML = f.daily.map(d => `<tr><td class="num">${String(d.day).split('-').reverse().join('/')}</td><td class="num">${d.visits}<span class="mini-bar" style="width:${Math.round(80 * d.visits / maxV)}px"></span></td><td class="num">${d.signups}</td><td class="num">${d.exports}</td><td class="num">${d.paid}</td></tr>`).join('');
  } catch (e) { steps.innerHTML = `<p class="hint err">${esc(e.message)}</p>`; }
  loadFollowups();
}
async function loadFollowups() {
  const tb = $('funFollow');
  tb.innerHTML = '<tr><td colspan="6" class="muted">Đang tải…</td></tr>';
  try {
    const list = await call('vt_admin_followups');
    tb.innerHTML = list.map(u => {
      const phone = /^0\d{9}$/.test(u.login) ? u.login : '';
      const contact = phone ? `<a class="btn btn-quiet" href="https://zalo.me/${phone}" target="_blank" rel="noopener">Nhắn Zalo</a>`
        : `<a class="btn btn-quiet" href="mailto:${esc(u.login)}">Gửi email</a>`;
      return `<tr><td>${esc(u.name || '—')}<span class="sub">${esc(u.login)}</span>${u.note ? `<span class="sub">📝 ${esc(u.note)}</span>` : ''}</td>
        <td class="num">${u.credits}</td><td class="num">${u.exports}</td><td class="num">${fmt(u.last_export)}</td>
        <td>${esc(SRC_NAME[u.source] || u.source || '—')}</td><td><div class="acts">${contact}</div></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">Chưa có khách nào cần chăm sóc.</td></tr>';
  } catch (e) { tb.innerHTML = `<tr><td colspan="6" class="hint err">${esc(e.message)}</td></tr>`; }
}

// ---------- Gắn sự kiện ----------
function showTab(tab) {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== tab;
  ({ orders: loadOrders, funnel: loadFunnel, users: loadUsers, payments: loadPayments, settings: loadSettings })[tab]();
}
$('loginBox').addEventListener('submit', submitLogin);
$('logoutBtn').addEventListener('click', logout);
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
$('orderStatus').addEventListener('change', loadOrders);
$('funDays').addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  funDays = +b.dataset.v;
  for (const x of $('funDays').querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
  loadFunnel();
});
$('funReload').addEventListener('click', loadFunnel);
$('orderReload').addEventListener('click', () => { loadOrders(); loadStats(); });
let qt;
$('orderQ').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(loadOrders, 350); });
$('userQ').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(loadUsers, 350); });
$('userReload').addEventListener('click', loadUsers);
$('orderRows').addEventListener('click', orderAction);
$('userRows').addEventListener('click', e => { const b = e.target.closest('button[data-edit]'); if (b) openUserEdit(b.dataset.edit); });
$('cfgForm').addEventListener('submit', saveConfig);
$('pkgRows').addEventListener('click', savePackage);
$('pkgAdd').addEventListener('click', () => $('pkgRows').insertAdjacentHTML('beforeend', pkgRow()));

(async () => {
  try { adminKey = sessionStorage.getItem(KEY) || ''; } catch { adminKey = ''; }
  if (adminKey) {
    try { await call('vt_admin_overview'); enter(); return; } catch { /* nhập lại */ }
  }
  showLogin();
})();
