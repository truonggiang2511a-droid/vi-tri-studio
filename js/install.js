// Cài app lên màn hình chính (PWA): dùng chung cho app và trang giới thiệu.
// - Chrome/Edge/Android có hộp cài sẵn (beforeinstallprompt) thì bấm là hiện hộp cài.
// - iPhone, Samsung, trình duyệt trong Facebook/Zalo/TikTok… không có hộp cài: hiện hướng dẫn đúng máy đang dùng.
// Mọi nút có thuộc tính data-install đều tự ẩn khi app đã được cài và đang mở từ màn hình chính.
import { rpcFire } from './sb.js';

const UA = navigator.userAgent || '';
const IOS = /iphone|ipad|ipod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ANDROID = /android/i.test(UA);
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS/i.test(UA) ? 'Facebook'
  : /Messenger/i.test(UA) ? 'Messenger'
  : /Instagram/i.test(UA) ? 'Instagram'
  : /Zalo/i.test(UA) ? 'Zalo'
  : /musical_ly|BytedanceWebview|TikTok|trill_/i.test(UA) ? 'TikTok'
  : /\bLine\//i.test(UA) ? 'Line'
  : ANDROID && /; wv\)/.test(UA) ? 'ứng dụng này' : '';
const IOS_BROWSER = IOS ? (/CriOS/.test(UA) ? 'Chrome' : /FxiOS/.test(UA) ? 'Firefox' : /EdgiOS/.test(UA) ? 'Edge' : 'Safari') : '';
const SAMSUNG = /SamsungBrowser/i.test(UA);
const DESKTOP_SAFARI = !IOS && /Macintosh/.test(UA) && /Safari\//.test(UA) && !/Chrome|Chromium|Edg\//.test(UA);
const FIREFOX = !IOS && /Firefox\//.test(UA);
const EDGE = /Edg\//.test(UA);
export const INSTALL_PARAM = 'cai-app';

let deferred = null;
let toast = m => console.log(m);
let onChange = () => {};

export function isStandalone() {
  try {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches
      || matchMedia('(display-mode: minimal-ui)').matches || navigator.standalone === true;
  } catch { return false; }
}

// Bắt sự kiện càng sớm càng tốt (Chrome có thể bắn ngay khi trang vừa tải)
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; onChange(); });
window.addEventListener('appinstalled', () => {
  deferred = null;
  rpcFire('vt_visit', { p_page: 'install', p_source: 'cai-app' });
  closeSheet();
  toast('Đã cài app. Lần sau mở Vị Trí Studio từ màn hình chính.');
  syncButtons();
});

// ---------- Hướng dẫn theo từng loại máy ----------
const ICON = {
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>',
  hdots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  monitor: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 20h6M12 16v4M12 7v5m-2.5-2.5L12 12l2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const k = (icon, text) => `<span class="ia-k">${ICON[icon] || ''}${text ? `<span>${text}</span>` : ''}</span>`;

function appUrl() {
  return `${location.origin}/?${INSTALL_PARAM}=1`;
}
function chromeIntent() {
  const u = new URL(appUrl());
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
}

function guide() {
  if (IN_APP) {
    const where = IOS ? 'Safari' : 'Chrome';
    return {
      title: `Mở bằng ${where} để cài app`,
      lead: `Anh/chị đang xem trong ${IN_APP}. Trình duyệt bên trong ${IN_APP} không cài app được, cần mở trang bằng ${where} trước.`,
      steps: IOS
        ? [`Bấm ${k('hdots')} hoặc ${k('share')} ở góc trên hoặc dưới màn hình.`, `Chọn <b>Mở trong Safari</b> (hoặc <b>Mở bằng trình duyệt</b>).`, `Trong Safari bấm <b>Cài app</b> một lần nữa để thêm vào màn hình chính.`]
        : [`Bấm nút <b>Mở bằng Chrome</b> bên dưới.`, `Nếu không mở được: bấm ${k('dots')} ở góc trên, chọn <b>Mở bằng trình duyệt</b>.`, `Trong Chrome bấm <b>Cài app</b> một lần nữa.`],
      actions: (ANDROID ? `<a class="ia-btn ia-primary" href="${chromeIntent()}">Mở bằng Chrome</a>` : '')
        + `<button type="button" class="ia-btn" data-ia="copy">Chép link app</button>`,
      arrow: IOS ? '' : 'top',
    };
  }
  if (IOS) {
    if (IOS_BROWSER === 'Safari') {
      return {
        title: 'Cài app lên iPhone',
        lead: 'Chỉ 3 chạm, không cần App Store. App mở toàn màn hình như app thật.',
        steps: [`Bấm nút Chia sẻ ${k('share')} ở thanh dưới cùng Safari (iPad: góc trên). Nếu không thấy, bấm ${k('hdots')} trước.`, `Kéo xuống, chọn ${k('add', 'Thêm vào MH chính')}`, `Bấm <b>Thêm</b> ở góc trên bên phải. Biểu tượng Vị Trí Studio sẽ nằm trên màn hình chính.`],
        actions: '',
        arrow: 'bottom',
      };
    }
    return {
      title: 'Cài app lên iPhone',
      lead: `Đang dùng ${IOS_BROWSER}. Mở trang này bằng Safari sẽ cài dễ nhất.`,
      steps: [`Bấm nút Chia sẻ ${k('share')} cạnh thanh địa chỉ (hoặc trong menu ${k('hdots')}).`, `Chọn ${k('add', 'Thêm vào MH chính')}`, `Bấm <b>Thêm</b>. Nếu không thấy mục này, chép link rồi mở bằng Safari.`],
      actions: '<button type="button" class="ia-btn" data-ia="copy">Chép link app</button>',
      arrow: 'top',
    };
  }
  if (ANDROID) {
    if (SAMSUNG) {
      return {
        title: 'Cài app lên điện thoại',
        lead: 'Không cần CH Play. App mở toàn màn hình như app thật.',
        steps: [`Bấm ${k('menu')} ở thanh dưới cùng.`, `Chọn <b>Thêm trang vào</b> → <b>Màn hình chờ</b> (Màn hình chính).`, 'Bấm <b>Thêm</b>.'],
        actions: '',
        arrow: 'bottom',
      };
    }
    return {
      title: 'Cài app lên điện thoại',
      lead: 'Không cần CH Play. App mở toàn màn hình như app thật.',
      steps: [`Bấm ${k('dots')} ở góc trên bên phải Chrome.`, 'Chọn <b>Cài đặt ứng dụng</b> hoặc <b>Thêm vào màn hình chính</b>.', 'Bấm <b>Cài đặt</b>. Nếu đã cài rồi, mở Vị Trí Studio từ màn hình chính.'],
      actions: '',
      arrow: 'top',
    };
  }
  if (DESKTOP_SAFARI) {
    return {
      title: 'Cài app lên máy Mac',
      lead: 'Mở Vị Trí Studio từ Dock như một ứng dụng riêng.',
      steps: ['Trên thanh menu, chọn <b>Tệp</b> (File).', 'Chọn <b>Thêm vào Dock</b> (Add to Dock).', 'Bấm <b>Thêm</b>.'],
      actions: '',
      arrow: '',
    };
  }
  if (FIREFOX) {
    return {
      title: 'Firefox chưa cài app được',
      lead: 'Mở trang này bằng Chrome hoặc Edge để cài Vị Trí Studio thành app trên máy tính.',
      steps: ['Chép link bên dưới.', 'Dán vào Chrome hoặc Edge.', `Bấm biểu tượng cài đặt ${k('monitor')} ở cuối thanh địa chỉ.`],
      actions: '<button type="button" class="ia-btn" data-ia="copy">Chép link app</button>',
      arrow: '',
    };
  }
  return {
    title: 'Cài app lên máy tính',
    lead: 'Mở Vị Trí Studio trong cửa sổ riêng, có biểu tượng trên màn hình và thanh tác vụ.',
    steps: [`Bấm biểu tượng cài đặt ${k('monitor')} ở cuối thanh địa chỉ.`, EDGE ? `Hoặc bấm ${k('hdots')} → <b>Ứng dụng</b> → <b>Cài đặt trang web này dưới dạng ứng dụng</b>.` : `Hoặc bấm ${k('dots')} → <b>Truyền, lưu và chia sẻ</b> → <b>Cài đặt trang dưới dạng ứng dụng</b>.`, 'Bấm <b>Cài đặt</b>.'],
    actions: '',
    arrow: '',
  };
}

// ---------- Hộp hướng dẫn ----------
const CSS = `
.ia-dlg{border:0;padding:0;background:transparent;max-width:100vw;max-height:100vh;color:#eef4f1}
.ia-dlg::backdrop{background:rgba(3,8,6,.62);backdrop-filter:blur(2px)}
.ia-card{position:fixed;left:50%;transform:translateX(-50%);bottom:max(12px,env(safe-area-inset-bottom,0px));width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 40px);overflow:auto;
  background:#111a17;border:1px solid rgba(241,178,60,.45);border-radius:20px;padding:20px 18px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5);font:15px/1.5 "Be Vietnam Pro","Segoe UI",system-ui,sans-serif}
.ia-card.lift{bottom:calc(64px + env(safe-area-inset-bottom,0px));max-height:calc(100vh - 92px)}
@media (min-width:700px){.ia-card,.ia-card.lift{bottom:auto;top:50%;transform:translate(-50%,-50%)}}
.ia-head{display:flex;gap:12px;align-items:center;margin:0 34px 10px 0}
.ia-head img{width:52px;height:52px;border-radius:13px;flex:none;box-shadow:0 4px 14px rgba(0,0,0,.4)}
.ia-head h3{margin:0;font-size:18px;line-height:1.25;color:#fff}
.ia-head p{margin:2px 0 0;font-size:13px;color:#9fb2aa}
.ia-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.08);color:#eef4f1;font-size:22px;line-height:1;cursor:pointer}
.ia-lead{margin:0 0 12px;color:#cfdcd6;font-size:14.5px}
.ia-steps{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:10px;counter-reset:ia}
.ia-steps li{position:relative;padding:10px 12px 10px 46px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;font-size:14.5px;color:#eef4f1}
.ia-steps li::before{counter-increment:ia;content:counter(ia);position:absolute;left:12px;top:10px;width:24px;height:24px;border-radius:50%;background:#f1b23c;color:#1e1504;font-weight:800;font-size:13px;display:grid;place-items:center}
.ia-steps b{color:#fff}
.ia-k{display:inline-flex;align-items:center;gap:4px;vertical-align:middle;padding:1px 7px;margin:0 1px;border-radius:7px;background:rgba(255,255,255,.1);color:#fff;font-weight:700;font-size:13.5px;white-space:nowrap}
.ia-k svg{width:17px;height:17px;color:#5eeaf5}
.ia-acts{display:flex;flex-direction:column;gap:8px}
.ia-btn{display:flex;align-items:center;justify-content:center;min-height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.22);background:transparent;color:#eef4f1;font:700 15px/1 "Be Vietnam Pro",system-ui,sans-serif;text-decoration:none;cursor:pointer}
.ia-primary{background:#f1b23c;border-color:#f1b23c;color:#1e1504}
.ia-arrow{position:fixed;left:50%;width:46px;height:46px;margin-left:-23px;color:#f1b23c;filter:drop-shadow(0 4px 10px rgba(0,0,0,.6));pointer-events:none;animation:ia-bob 1.1s ease-in-out infinite}
.ia-arrow.bottom{bottom:calc(4px + env(safe-area-inset-bottom,0px))}
.ia-arrow.top{top:6px;left:auto;right:18px;margin:0;transform:rotate(180deg)}
.ia-arrow.top{animation-name:ia-bob-up}
@keyframes ia-bob{50%{transform:translateY(8px)}}
@keyframes ia-bob-up{0%,100%{transform:rotate(180deg)}50%{transform:rotate(180deg) translateY(8px)}}
@media (prefers-reduced-motion:reduce){.ia-arrow{animation:none}}
`;
let dlg = null;
function ensureSheet() {
  if (dlg) return dlg;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  dlg = document.createElement('dialog');
  dlg.className = 'ia-dlg';
  dlg.setAttribute('aria-labelledby', 'iaTitle');
  document.body.appendChild(dlg);
  dlg.addEventListener('click', async e => {
    if (e.target === dlg || e.target.closest('.ia-x') || e.target.closest('[data-ia="close"]')) { closeSheet(); return; }
    if (e.target.closest('[data-ia="copy"]')) {
      try { await navigator.clipboard.writeText(appUrl()); toast('Đã chép link. Mở Safari/Chrome rồi dán vào thanh địa chỉ.'); }
      catch { toast('Link app: ' + appUrl(), 6000); }
    }
  });
  return dlg;
}
function closeSheet() {
  if (dlg?.open) dlg.close();
}
export function openInstallSheet() {
  const g = guide();
  const d = ensureSheet();
  d.innerHTML = `<div class="ia-card${g.arrow === 'bottom' ? ' lift' : ''}" role="document">
      <button type="button" class="ia-x" aria-label="Đóng">×</button>
      <div class="ia-head"><img src="/icons/icon-192.png" alt=""><div><h3 id="iaTitle">${g.title}</h3><p>Vị Trí Studio · miễn phí, không tốn bộ nhớ</p></div></div>
      <p class="ia-lead">${g.lead}</p>
      <ol class="ia-steps">${g.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      <div class="ia-acts">${g.actions}<button type="button" class="ia-btn" data-ia="close">Để sau</button></div>
    </div>${g.arrow ? `<svg class="ia-arrow ${g.arrow}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v16m-6-6 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}`;
  if (!d.open) d.showModal();
}

// Bấm nút Cài app
export async function install() {
  if (isStandalone()) { toast('App đã được cài, anh/chị đang mở từ màn hình chính.'); return; }
  if (deferred) {
    const e = deferred;
    deferred = null;
    try {
      await e.prompt();
      const r = await e.userChoice;
      if (r?.outcome !== 'accepted') openInstallSheet();
    } catch { openInstallSheet(); }
    return;
  }
  openInstallSheet();
}

function syncButtons() {
  const hide = isStandalone();
  for (const b of document.querySelectorAll('[data-install]')) b.hidden = hide;
}

export function initInstall(opts = {}) {
  if (opts.toast) toast = opts.toast;
  if (opts.onChange) onChange = opts.onChange;
  syncButtons();
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-install]');
    if (!b) return;
    e.preventDefault();
    if (opts.redirect && !deferred && !isStandalone() && !IN_APP) { location.href = appUrl(); return; }
    install();
  });
  try { matchMedia('(display-mode: standalone)').addEventListener('change', syncButtons); } catch { /* trình duyệt cũ */ }
  // Link /?cai-app=1 (từ trang giới thiệu, hoặc chép từ trình duyệt Zalo/Facebook): tự mở hướng dẫn
  try {
    const u = new URL(location.href);
    if (u.searchParams.has(INSTALL_PARAM)) {
      u.searchParams.delete(INSTALL_PARAM);
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      if (!isStandalone()) setTimeout(() => { if (deferred) install(); else openInstallSheet(); }, 700);
    }
  } catch { /* bỏ qua */ }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  return { isStandalone, install, canPrompt: () => !!deferred, inApp: IN_APP };
}
