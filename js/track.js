// Cấu hình công khai từ máy chủ (/api/config) + đo chuyển đổi quảng cáo (Meta Pixel, TikTok Pixel).
// Pixel chỉ chạy khi chủ app đã đặt mã trên Cloudflare (META_PIXEL_ID, TIKTOK_PIXEL_ID)
// và người xem bấm Đồng ý ở thanh thông báo cookie.
import { rpcFire } from './sb.js';

const CONSENT = 'vitri.consent.v1';
const SRC_KEY = 'vitri.src.v1';
const SRC_DAYS = 30;

// ---------- Nguồn khách (không cần cookie quảng cáo, không lưu thông tin cá nhân) ----------
function readSrc() {
  try {
    const p = JSON.parse(localStorage.getItem(SRC_KEY) || 'null');
    return p && Date.now() - p.at < SRC_DAYS * 86400000 ? p.s : null;
  } catch { return null; }
}
// Nguồn của lượt vào hiện tại: utm_source, mã nhấp quảng cáo hoặc trang dẫn tới
export function detectSource() {
  let s = '';
  try {
    const q = new URL(location.href).searchParams;
    s = q.get('utm_source') || (q.has('fbclid') ? 'facebook' : q.has('ttclid') ? 'tiktok' : q.has('gclid') ? 'google'
      : q.has('zarsrc') ? 'zalo' : q.has('ref') ? 'gioi-thieu-ban' : '');
    if (!s && document.referrer) {
      const h = new URL(document.referrer).hostname.replace(/^www\./, '');
      if (h && h !== location.hostname) {
        s = /facebook|fb\.|messenger/.test(h) ? 'facebook' : /tiktok/.test(h) ? 'tiktok' : /google/.test(h) ? 'google'
          : /zalo/.test(h) ? 'zalo' : /youtube|youtu\.be/.test(h) ? 'youtube' : h;
      }
    }
    s = s.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24);
    // Giữ nguồn đầu tiên trong 30 ngày để biết khách đăng ký đến từ đâu
    if (s && !readSrc()) localStorage.setItem(SRC_KEY, JSON.stringify({ s, at: Date.now() }));
  } catch { /* bỏ qua */ }
  return s;
}
export function firstSource() { return readSrc(); }

// Đếm một lượt vào trang (mỗi phiên trình duyệt một lần cho mỗi trang)
export function countVisit(page) {
  let installed = false;
  try { installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { /* bỏ qua */ }
  // Mở từ biểu tượng app đã cài: đếm riêng, không ghi đè nguồn khách ban đầu
  const s = installed ? 'app-da-cai' : (detectSource() || readSrc() || 'truc-tiep');
  try {
    const k = 'vitri.visit.' + page;
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, '1');
  } catch { /* bỏ qua */ }
  rpcFire('vt_visit', { p_page: page, p_source: s });
}
let cfgPromise = null;
let loaded = false;
let loaded_pixel = '';
const queue = [];

export function loadConfig() {
  if (!cfgPromise) {
    cfgPromise = fetch('/api/config', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return cfgPromise;
}

function getConsent() { try { return localStorage.getItem(CONSENT); } catch { return null; } }
function setConsent(v) { try { localStorage.setItem(CONSENT, v); } catch { /* bỏ qua */ } }

function loadMeta(id) {
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', id);
  window.fbq('track', 'PageView');
}

function loadTikTok(id) {
  /* eslint-disable */
  !function (w, d, t) {
    w.TiktokAnalyticsObject = t; const ttq = w[t] = w[t] || [];
    ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
    ttq.setAndDefer = function (o, e) { o[e] = function () { o.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
    for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (e) { const n = ttq._i[e] || []; for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(n, ttq.methods[i]); return n; };
    ttq.load = function (e, n) {
      const r = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = r; ttq._t = ttq._t || {}; ttq._t[e] = +new Date(); ttq._o = ttq._o || {}; ttq._o[e] = n || {};
      const s = d.createElement('script'); s.type = 'text/javascript'; s.async = !0; s.src = r + '?sdkid=' + e + '&lib=' + t;
      const a = d.getElementsByTagName('script')[0]; a.parentNode.insertBefore(s, a);
    };
    ttq.load(id); ttq.page();
  }(window, document, 'ttq');
  /* eslint-enable */
}

function startPixels(c) {
  if (loaded) return;
  loaded = true;
  if (c.meta_pixel) { loaded_pixel = c.meta_pixel; loadMeta(c.meta_pixel); }
  if (c.tiktok_pixel) loadTikTok(c.tiktok_pixel);
  for (const [n, p] of queue.splice(0)) track(n, p);
}

function consentBar(c) {
  if (document.getElementById('consentBar')) return;
  const bar = document.createElement('div');
  bar.id = 'consentBar';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'Cookie');
  bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:560px;margin:0 auto;background:#111a17;color:#e6eeea;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 14px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;flex-wrap:wrap';
  bar.innerHTML = '<span style="flex:1 1 240px">Trang dùng cookie để đo hiệu quả quảng cáo và cải thiện dịch vụ. <a href="/chinh-sach-bao-mat" style="color:#f1b23c">Chi tiết</a></span>'
    + '<button type="button" data-c="no" style="background:transparent;color:#e6eeea;border:1px solid rgba(255,255,255,.25);border-radius:10px;padding:8px 12px;font:inherit;cursor:pointer">Từ chối</button>'
    + '<button type="button" data-c="yes" style="background:#f1b23c;color:#1b1405;border:0;border-radius:10px;padding:8px 14px;font:inherit;font-weight:700;cursor:pointer">Đồng ý</button>';
  bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-c]');
    if (!b) return;
    setConsent(b.dataset.c);
    bar.remove();
    if (b.dataset.c === 'yes') startPixels(c);
  });
  document.body.appendChild(bar);
}

export async function initTracking() {
  const c = await loadConfig();
  if (!c.meta_pixel && !c.tiktok_pixel) return;
  const v = getConsent();
  if (v === 'yes') startPixels(c);
  else if (v !== 'no') consentBar(c);
}

// ---------- Gửi kèm về máy chủ (Conversions API) ----------
function cookie(n) { try { return (document.cookie.match('(?:^|; )' + n + '=([^;]*)') || [])[1] || ''; } catch { return ''; } }
function fbcValue() {
  const c = cookie('_fbc');
  if (c) return c;
  try { const id = new URL(location.href).searchParams.get('fbclid'); if (id) return 'fb.1.' + Date.now() + '.' + id; } catch { /* bỏ qua */ }
  return '';
}
function capi(event, eventId, p) {
  if (getConsent() === 'no') return;
  const body = JSON.stringify({ event, event_id: eventId, value: p.value || 0, id: p.id || '', login: p.login || '',
    fbp: cookie('_fbp'), fbc: fbcValue(), url: location.href });
  try {
    if (!navigator.sendBeacon?.('/api/capi', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/capi', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* bỏ qua */ }
}
const newId = n => n + '.' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2, 8);
// Tên sự kiện Meta tương ứng; sự kiện quan trọng gửi cả Pixel lẫn CAPI với cùng event_id để Meta gộp
const META = { register: 'CompleteRegistration', checkout: 'InitiateCheckout', purchase: 'Purchase', trial_click: 'Lead', view: 'ViewContent' };
const SERVER = new Set(['register', 'checkout', 'purchase']);

// Sự kiện: register | checkout | purchase | export | trial_click | view
// p: { value, id, login } — login (email/SĐT) chỉ được mã hoá phía máy chủ trước khi gửi Meta
export function track(name, p = {}) {
  const eid = p.event_id || newId(name);
  // Sự kiện chuyển đổi gửi máy chủ ngay, kể cả khi Pixel bị chặn (trình chặn quảng cáo, iOS)
  if (SERVER.has(name) && !p._queued) capi(META[name], eid, p);
  if (!loaded) { if (queue.length < 20) queue.push([name, { ...p, event_id: eid, _queued: true }]); return; }
  const fbq = window.fbq, ttq = window.ttq;
  const money = p.value ? { value: p.value, currency: 'VND' } : {};
  const opt = { eventID: eid };
  try {
    if (p.login && fbq && !p._am) {
      const l = String(p.login).trim().toLowerCase();
      const am = l.includes('@') ? { em: l } : { ph: l.replace(/\D/g, '').replace(/^0/, '84') };
      fbq('init', loaded_pixel, am);
    }
    if (name === 'register') { fbq?.('track', 'CompleteRegistration', {}, opt); ttq?.track('CompleteRegistration'); }
    else if (name === 'checkout') { fbq?.('track', 'InitiateCheckout', { ...money, content_ids: [p.id || ''] }, opt); ttq?.track('InitiateCheckout', { ...money, content_id: p.id || '' }); }
    else if (name === 'purchase') { fbq?.('track', 'Purchase', { ...money, content_ids: [p.id || ''] }, opt); ttq?.track('CompletePayment', { ...money, content_id: p.id || '' }); }
    else if (name === 'export') { fbq?.('trackCustom', 'XuatVideo'); ttq?.track('SubmitForm'); }
    else if (name === 'trial_click') { fbq?.('track', 'Lead', {}, opt); ttq?.track('ClickButton'); }
    else if (name === 'view') { fbq?.('track', 'ViewContent', {}, opt); ttq?.track('ViewContent'); }
  } catch { /* đo lường không được làm hỏng app */ }
}
