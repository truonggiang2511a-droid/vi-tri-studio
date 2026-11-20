// Máy chủ OAuth 2.1 cho kết nối Claude (MCP) — 20/11/2026.
// Claude (claude.ai / Desktop / điện thoại / Claude Code) tìm máy chủ qua /.well-known/*, tự đăng ký (DCR, /oauth/register),
// đưa khách tới /oauth/authorize (trang đồng ý của Vị Trí Studio, dùng chính phiên đăng nhập của app trong trình duyệt),
// rồi đổi mã lấy token ở /oauth/token (PKCE S256, xoay vòng refresh token). Mọi quyền + kiểm tra nằm trong hàm SQL vt_mcp_*
// (supabase/vt_mcp.sql). Không đụng quảng cáo, thanh toán, Pixel.
import { json, rpc, env } from './vt.js';

export const base = () => (env('APP_URL') || 'https://vitristudio.com').replace(/\/+$/, '');
export const resourceUrl = () => base() + '/mcp';
export const prmUrl = () => base() + '/.well-known/oauth-protected-resource/mcp';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': 'www-authenticate, mcp-session-id' };
const cjson = (o, s = 200) => json(o, s, CORS);
const oerr = (error, desc, s = 400) => cjson({ error, error_description: desc }, s);

export function handleWellKnown(req) {
  const p = new URL(req.url).pathname.replace(/\/+$/, '');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp') {
    return cjson({ resource: resourceUrl(), authorization_servers: [base()], scopes_supported: ['video'], bearer_methods_supported: ['header'],
      resource_name: 'Vị Trí Studio', resource_documentation: base() + '/gioi-thieu' });
  }
  if (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/oauth-authorization-server/mcp' || p === '/.well-known/openid-configuration') {
    return cjson({
      issuer: base(),
      authorization_endpoint: base() + '/oauth/authorize',
      token_endpoint: base() + '/oauth/token',
      registration_endpoint: base() + '/oauth/register',
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['video', 'offline_access'],
      authorization_response_iss_parameter_supported: true,
      service_documentation: base() + '/gioi-thieu',
    });
  }
  return new Response('Not found', { status: 404 });
}

// ---------- Dynamic Client Registration (RFC 7591) ----------
async function register(req) {
  let b;
  try { b = await req.json(); } catch { return oerr('invalid_client_metadata', 'Thân yêu cầu phải là JSON'); }
  const uris = Array.isArray(b?.redirect_uris) ? b.redirect_uris.map(String) : [];
  try {
    const r = await rpc('vt_mcp_client_register', { p_name: String(b?.client_name || 'Claude'), p_redirects: uris });
    return json({ client_id: r.client_id, client_name: r.client_name, redirect_uris: r.redirect_uris, client_id_issued_at: Math.floor(Date.now() / 1000),
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'video offline_access' }, 201, CORS);
  } catch (e) {
    return oerr(e.hint === 'temporarily_unavailable' ? 'temporarily_unavailable' : 'invalid_redirect_uri', e.message, e.hint === 'temporarily_unavailable' ? 503 : 400);
  }
}

// ---------- Token endpoint ----------
async function token(req) {
  const ct = req.headers.get('content-type') || '';
  let f;
  try { f = /json/i.test(ct) ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text())); } catch { return oerr('invalid_request', 'Không đọc được yêu cầu'); }
  // client_id có thể nằm trong header Basic (client công khai, mật khẩu rỗng)
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!f.client_id && basic) { try { f.client_id = decodeURIComponent(atob(basic[1]).split(':')[0]); } catch { /* bỏ qua */ } }
  if (f.resource && !okResource(f.resource)) return oerr('invalid_target', 'resource không đúng máy chủ này');
  try {
    const r = await rpc('vt_mcp_token', { p_grant: f.grant_type || '', p_client_id: f.client_id || '', p_code: f.code || null, p_verifier: f.code_verifier || null,
      p_redirect: f.redirect_uri || null, p_refresh: f.refresh_token || null });
    return json(r, 200, { ...CORS, pragma: 'no-cache' });
  } catch (e) {
    const code = ['invalid_grant', 'invalid_client', 'invalid_request', 'unsupported_grant_type'].includes(e.hint) ? e.hint : e.hint === 'PLAN' ? 'invalid_grant' : 'invalid_request';
    return oerr(code, e.message);
  }
}
const okResource = r => { const x = String(r).replace(/\/+$/, ''); return x === resourceUrl() || x === base(); };

// ---------- Trang đồng ý ----------
function redirectWith(uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  return u.href;
}
async function authorize(req) {
  const q = Object.fromEntries(new URL(req.url).searchParams);
  let client = null;
  try { client = q.client_id ? await rpc('vt_mcp_client_get', { p_client_id: q.client_id }) : null; } catch { /* lỗi DB → báo lỗi dưới */ }
  if (!client) return page({ fatal: 'Ứng dụng kết nối không hợp lệ hoặc đã hết hạn. Trong Claude, xoá connector Vị Trí Studio rồi thêm lại.' });
  const uris = client.redirect_uris || [];
  const loop = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/callback$/;
  const okUri = uris.includes(q.redirect_uri) || (loop.test(q.redirect_uri || '') && uris.some(u => u.replace(/:\d+\//, '/') === q.redirect_uri.replace(/:\d+\//, '/')));
  if (!q.redirect_uri || !okUri) return page({ fatal: 'Địa chỉ trả về không khớp với ứng dụng đã đăng ký. Xoá connector rồi thêm lại trong Claude.' });
  const back = (error, desc) => Response.redirect(redirectWith(q.redirect_uri, { error, error_description: desc, state: q.state, iss: base() }), 302);
  if (q.response_type !== 'code') return back('unsupported_response_type', 'Chỉ hỗ trợ response_type=code');
  if (!q.code_challenge || q.code_challenge_method !== 'S256') return back('invalid_request', 'Cần PKCE S256');
  if (q.resource && !okResource(q.resource)) return back('invalid_target', 'resource không đúng máy chủ này');
  return page({ req: { client_id: q.client_id, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge, state: q.state || '', scope: q.scope || '' },
    client: client.name || 'Claude', host: new URL(q.redirect_uri).host });
}
async function approve(req) {
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Yêu cầu không hợp lệ' }, 400); }
  if (b.deny) { try { return json({ redirect: redirectWith(b.redirect_uri, { error: 'access_denied', error_description: 'Khách không cho phép', state: b.state, iss: base() }) }); } catch { return json({ error: 'redirect_uri không hợp lệ' }, 400); } }
  try {
    const r = await rpc('vt_mcp_code_create', { p_token: b.token || '', p_client_id: b.client_id || '', p_redirect: b.redirect_uri || '', p_challenge: b.code_challenge || '', p_scope: b.scope || '' });
    return json({ redirect: redirectWith(b.redirect_uri, { code: r.code, state: b.state, iss: base() }), login: r.login });
  } catch (e) { return json({ error: e.message, hint: e.hint || '' }, e.hint === 'AUTH' ? 401 : 400); }
}
async function who(req) {
  try { const b = await req.json(); return json(await rpc('vt_mcp_who', { p_token: b.token || '' })); }
  catch (e) { return json({ error: e.message, hint: e.hint || '' }, e.hint === 'AUTH' ? 401 : 400); }
}
async function login(req) {
  try {
    const b = await req.json();
    const r = await rpc('vt_login', { p_login: String(b.login || '').trim(), p_password: String(b.password || '') });
    if (!r.ok) return json({ error: r.message || 'Sai tài khoản hoặc mật khẩu' }, 400);
    return json({ token: r.token, profile: r.profile });
  } catch (e) { return json({ error: e.message || 'Đăng nhập chưa được' }, 400); }
}

export async function handleOauth(req) {
  const p = new URL(req.url).pathname.replace(/\/+$/, '');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (p === '/oauth/register' && req.method === 'POST') return register(req);
  if (p === '/oauth/token' && req.method === 'POST') return token(req);
  if (p === '/oauth/authorize' && req.method === 'GET') return authorize(req);
  if (p === '/oauth/approve' && req.method === 'POST') return approve(req);
  if (p === '/oauth/who' && req.method === 'POST') return who(req);
  if (p === '/oauth/login' && req.method === 'POST') return login(req);
  return json({ error: 'not_found' }, 404);
}

// ---------- HTML trang đồng ý (tiếng Việt, tự chứa, chạy cả điện thoại) ----------
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page({ fatal, req, client, host }) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const data = JSON.stringify(req || null).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kết nối Claude · Vị Trí Studio</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0b1020;color:#e8ecf5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:18px}
.card{width:100%;max-width:440px;background:#141a2e;border:1px solid #263052;border-radius:18px;padding:22px 20px;box-shadow:0 20px 60px #0008}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:15px;color:#ffd166;letter-spacing:.3px}.brand i{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#ffd166,#f59e0b);display:inline-block;position:relative}.brand i:after{content:"📍";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:16px}
h1{font-size:21px;margin:14px 0 4px;line-height:1.3}.sub{color:#9aa6c7;font-size:14px;margin:0 0 14px}.sub b{color:#e8ecf5}
ul{list-style:none;padding:0;margin:0 0 16px;display:grid;gap:8px}li{display:flex;gap:10px;font-size:14.5px;background:#0f1528;border:1px solid #20294a;border-radius:11px;padding:9px 11px}li span{flex:none}
.acct{background:#0f1528;border:1px solid #20294a;border-radius:11px;padding:10px 12px;font-size:14px;margin-bottom:14px}.acct b{word-break:break-all}
button{font:inherit;border:0;border-radius:12px;padding:13px 16px;font-weight:800;cursor:pointer;width:100%}
.go{background:linear-gradient(135deg,#ffd166,#f5a524);color:#1a1300}.go:disabled{opacity:.55}.no{background:transparent;color:#9aa6c7;margin-top:8px;font-weight:600}
input{font:inherit;font-size:16px;width:100%;padding:12px;border-radius:11px;border:1px solid #2b365d;background:#0b1124;color:#e8ecf5;margin-bottom:10px}
label{font-size:13px;color:#9aa6c7}.msg{font-size:14px;min-height:20px;margin:8px 0 0;color:#ffb4b4}.ok{color:#a6f4c5}
.link{background:none;color:#7fb2ff;padding:6px 0;width:auto;font-weight:600;font-size:13.5px}.foot{color:#6f7aa0;font-size:12.5px;margin-top:14px;text-align:center}
.hide{display:none}
</style></head><body><main class="card">
<div class="brand"><i></i> VỊ TRÍ STUDIO</div>
${fatal ? `<h1>Chưa kết nối được</h1><p class="sub">${escH(fatal)}</p>` : `
<h1>Kết nối ${escH(client)} với Vị Trí Studio</h1>
<p class="sub">Yêu cầu từ <b>${escH(host)}</b>. Sau khi cho phép, Claude của anh/chị làm được:</p>
<ul>
<li><span>🎬</span><div>Tạo video vị trí (AI đạo diễn) từ toạ độ / link Google Maps + tin đăng</div></li>
<li><span>📊</span><div>Đọc kịch bản, tiện ích, đường đi, số liệu bản đồ thật của từng video</div></li>
<li><span>✍️</span><div>Viết lại lời đọc, đổi tiện ích, phong cách, nhạc — trang đang mở tự cập nhật</div></li>
<li><span>🔒</span><div>Không xuất video, không trừ lượt, không thanh toán, không thấy mật khẩu</div></li>
</ul>
<div id="who" class="acct hide"></div>
<form id="lf" class="hide"><label for="lg">Email hoặc số điện thoại</label><input id="lg" autocomplete="username" required>
<label for="pw">Mật khẩu</label><input id="pw" type="password" autocomplete="current-password" required>
<button class="go" type="submit">Đăng nhập</button></form>
<div id="act" class="hide"><button class="go" id="yes" type="button">Cho phép kết nối</button><button class="no" id="nope" type="button">Từ chối</button></div>
<p class="msg" id="msg" role="status"></p>
<p class="foot">Ngắt kết nối bất cứ lúc nào: Claude › Cài đặt › Connectors.</p>`}
</main>
${fatal ? '' : `<script nonce="${nonce}">
(()=>{const R=${data},K='vitri.session.v1',$=i=>document.getElementById(i),msg=(t,ok)=>{$('msg').textContent=t||'';$('msg').className='msg'+(ok?' ok':'')};
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(async r=>({s:r.status,j:await r.json().catch(()=>({}))}));
let tok=null;try{tok=localStorage.getItem(K)}catch(e){}
function showLogin(){$('lf').classList.remove('hide');$('act').classList.add('hide');$('who').classList.add('hide');}
async function check(){if(!tok)return showLogin();msg('Đang kiểm tra tài khoản…',1);const {s,j}=await post('/oauth/who',{token:tok});
if(s===401){try{localStorage.removeItem(K)}catch(e){};tok=null;msg('');return showLogin();}
if(j.error){msg(j.error);return}
const w=$('who');w.classList.remove('hide');w.innerHTML='';w.append('Tài khoản: ');const b=document.createElement('b');b.textContent=j.name?j.name+' · '+j.login:j.login;w.append(b);
const sw=document.createElement('button');sw.className='link';sw.type='button';sw.textContent='Dùng tài khoản khác';sw.onclick=()=>{try{localStorage.removeItem(K)}catch(e){};tok=null;msg('');showLogin()};w.append(document.createElement('br'),sw);
$('lf').classList.add('hide');
if(!j.ok){msg(j.mode==='quy'?'Kết nối Claude dành cho gói Không giới hạn 90 ngày còn hạn. Gia hạn tại vitristudio.com rồi kết nối lại.':j.mode==='off'?'Kết nối Claude đang tạm tắt để bảo trì.':'Kết nối Claude đang chạy thử nội bộ, sắp mở cho khách gói Không giới hạn 90 ngày.');$('act').classList.add('hide');return}
msg('');$('act').classList.remove('hide');}
$('lf').onsubmit=async e=>{e.preventDefault();msg('Đang đăng nhập…',1);const {j}=await post('/oauth/login',{login:$('lg').value,password:$('pw').value});
if(!j.token){msg(j.error||'Sai tài khoản hoặc mật khẩu');return}tok=j.token;try{localStorage.setItem(K,tok)}catch(e){};$('pw').value='';check();};
$('yes').onclick=async()=>{$('yes').disabled=true;msg('Đang kết nối…',1);const {s,j}=await post('/oauth/approve',{...R,token:tok});
if(j.redirect){msg('✓ Đã cho phép. Đang quay lại Claude…',1);location.href=j.redirect;return}
$('yes').disabled=false;if(s===401){tok=null;showLogin()}msg(j.error||'Chưa kết nối được, thử lại');};
$('nope').onclick=async()=>{const {j}=await post('/oauth/approve',{...R,deny:true});if(j.redirect)location.href=j.redirect;};
check();})();
</script>`}
</body></html>`;
  return new Response(html, { status: fatal ? 400 : 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  } });
}
