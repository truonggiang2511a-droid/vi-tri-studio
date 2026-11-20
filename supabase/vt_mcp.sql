-- Vị Trí Studio — kết nối Claude của khách (MCP) với AI đạo diễn, 20/11/2026.
-- Claude của khách (claude.ai / Desktop / điện thoại / Claude Code) đăng nhập tài khoản Vị Trí Studio bằng OAuth 2.1 + PKCE S256,
-- rồi tạo / xem / sửa video AI đạo diễn. Quét bản đồ, đọc giọng, dựng 3D, XUẤT VIDEO VÀ TRỪ LƯỢT vẫn chạy trên trang /dao-dien như cũ.
-- Bảng khoá kín (RLS bật, không policy, thu hồi quyền); chỉ gọi qua các hàm vt_mcp_* / vt_dd_* bên dưới.
-- KHÔNG sửa vt_users / vt_orders / vt_payment_in / vt__apply_order (chỉ ĐỌC vt_orders để biết khách có gói 90 ngày).
-- Công tắc: vt_mcp_config.open = 'admin' (mặc định: chỉ tài khoản @vitristudio.com + no_limits) | 'quy' (+ khách gói Không giới hạn
-- 90 ngày còn hạn) | 'off' (tắt hẳn, kể cả admin). Chạy lại nhiều lần vẫn an toàn.

-- ---------- Bảng ----------
create table if not exists public.vt_mcp_config (
  id int primary key default 1 check (id = 1),
  open text not null default 'admin' check (open in ('off', 'admin', 'quy')),
  updated_at timestamptz not null default now()
);
insert into public.vt_mcp_config (id) values (1) on conflict (id) do nothing;

-- Client OAuth do Claude tự đăng ký (Dynamic Client Registration). Chỉ nhận địa chỉ trả về của Claude.
create table if not exists public.vt_mcp_clients (
  client_id text primary key,
  name text not null default '',
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

-- Mã cấp quyền dùng 1 lần, sống 5 phút
create table if not exists public.vt_mcp_codes (
  code_hash bytea primary key,
  user_id uuid not null references public.vt_users (id) on delete cascade,
  client_id text not null,
  redirect_uri text not null,
  challenge text not null,
  scope text not null default '',
  expires_at timestamptz not null default now() + interval '5 minutes'
);

-- Mỗi dòng = 1 kết nối Claude. Làm mới token thì đổi mã trên dòng đó (xoay vòng refresh token); mã cũ còn dùng được 2 phút
-- (Claude có thể làm mới 2 lần gần nhau — không để khách bị ngắt kết nối vô cớ).
create table if not exists public.vt_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.vt_users (id) on delete cascade,
  client_id text not null,
  client_name text not null default '',
  access_hash bytea not null unique,
  refresh_hash bytea not null unique,
  prev_refresh_hash bytea,
  prev_until timestamptz,
  access_exp timestamptz not null,
  refresh_exp timestamptz not null,
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now()
);
create index if not exists vt_mcp_tokens_user_idx on public.vt_mcp_tokens (user_id, created_at desc);
create index if not exists vt_mcp_tokens_prev_idx on public.vt_mcp_tokens (prev_refresh_hash) where prev_refresh_hash is not null;

-- Đếm lượt dùng qua Claude theo ngày (giới hạn chống lạm dụng)
create table if not exists public.vt_mcp_usage (
  day date not null,
  user_id uuid not null references public.vt_users (id) on delete cascade,
  kind text not null,
  n int not null default 0,
  primary key (day, user_id, kind)
);

-- Video AI đạo diễn lưu trên máy chủ (Claude tạo, hoặc khách đủ điều kiện dựng trên web). Trang /dao-dien?p=<id> mở ra,
-- quét bản đồ + dựng video rồi gửi "ảnh chụp" (snap: cảnh, lời đọc, tiện ích, số liệu) lên để Claude đọc.
-- rev tăng mỗi lần tin đăng / chỉnh sửa đổi (Claude hoặc web); snap_rev = rev lúc dựng ảnh chụp.
create table if not exists public.vt_dd_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.vt_users (id) on delete cascade,
  title text not null default '',
  lat double precision not null,
  lng double precision not null,
  coord text not null default '',
  listing text not null default '',
  buyer text,
  edits jsonb not null default '{}'::jsonb,
  opts jsonb not null default '{}'::jsonb,
  rev int not null default 1,
  by text not null default 'claude',
  snap jsonb,
  snap_rev int not null default 0,
  snap_at timestamptz,
  seen_at timestamptz,
  source text not null default 'claude',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index if not exists vt_dd_projects_user_idx on public.vt_dd_projects (user_id, updated_at desc);

do $$
declare t text;
begin
  foreach t in array array['vt_mcp_config','vt_mcp_clients','vt_mcp_codes','vt_mcp_tokens','vt_mcp_usage','vt_dd_projects'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- Hàm nội bộ ----------
create or replace function public.vt__mcp_tok() returns text
language sql volatile set search_path = public, extensions as $$ select encode(extensions.gen_random_bytes(32), 'hex') $$;

create or replace function public.vt__mcp_mode() returns text
language sql stable set search_path = public as $$ select coalesce((select open from vt_mcp_config where id = 1), 'admin') $$;

-- Ai được dùng: admin = tài khoản nội bộ; quy = + gói Không giới hạn còn hạn VÀ đã từng trả tiền gói 'quy' (90 ngày); off = không ai
create or replace function public.vt__mcp_plan_ok(u public.vt_users) returns boolean
language sql stable set search_path = public as $$
  select case vt__mcp_mode()
    when 'off' then false
    when 'admin' then coalesce(u.no_limits, false) or coalesce(u.login ilike '%@vitristudio.com', false)
    when 'quy' then coalesce(u.no_limits, false) or coalesce(u.login ilike '%@vitristudio.com', false)
      or (coalesce(u.unlimited_until > now(), false)
        and exists (select 1 from vt_orders o where o.user_id = u.id and o.status = 'paid' and o.package_id = 'quy'))
    else false end
$$;

-- Địa chỉ trả về được phép: Claude web/desktop/điện thoại + Claude Code (localhost / 127.0.0.1 cổng bất kỳ)
create or replace function public.vt__mcp_redirect_ok(p text) returns boolean
language sql immutable as $$
  select coalesce(p ~ '^https://claude\.(ai|com)/api/mcp/auth_callback$'
    or p ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?/callback$', false)
$$;

-- So địa chỉ trả về: khớp đúng từng chữ; riêng localhost / 127.0.0.1 bỏ qua số cổng (RFC 8252)
create or replace function public.vt__mcp_redirect_match(p_given text, p_list text[]) returns boolean
language sql immutable as $$
  select coalesce(p_given = any(p_list), false) or (
    coalesce(p_given ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?/callback$', false)
    and exists (select 1 from unnest(p_list) r
      where regexp_replace(r, ':[0-9]{1,5}/', '/') = regexp_replace(p_given, ':[0-9]{1,5}/', '/')))
$$;

create or replace function public.vt__mcp_s256(p_verifier text) returns text
language sql immutable set search_path = public, extensions as $$
  select rtrim(translate(encode(extensions.digest(p_verifier, 'sha256'), 'base64'), '+/', '-_'), '=')
$$;

-- Tìm khách theo access token của Claude
create or replace function public.vt__mcp_user(p_access text) returns public.vt_users
language plpgsql set search_path = public, extensions as $$
declare t vt_mcp_tokens; u vt_users;
begin
  if p_access is null or length(p_access) < 32 then perform vt__err('Chưa kết nối tài khoản Vị Trí Studio', 'AUTH'); end if;
  select * into t from vt_mcp_tokens where access_hash = extensions.digest(p_access, 'sha256') and access_exp > now();
  if not found then perform vt__err('Phiên kết nối đã hết hạn, mời kết nối lại', 'AUTH'); end if;
  select * into u from vt_users where id = t.user_id;
  if not found then perform vt__err('Tài khoản không còn tồn tại', 'AUTH'); end if;
  if u.status <> 'active' then perform vt__err('Tài khoản đang bị khoá, liên hệ hỗ trợ', 'LOCKED'); end if;
  if t.last_used < now() - interval '5 minutes' then update vt_mcp_tokens set last_used = now() where id = t.id; end if;
  return u;
end $$;

create or replace function public.vt__mcp_need_plan(u public.vt_users) returns void
language plpgsql set search_path = public as $$
begin
  if not vt__mcp_plan_ok(u) then
    if vt__mcp_mode() = 'quy' then
      perform vt__err('Kết nối Claude dành cho gói Không giới hạn 90 ngày còn hạn. Gia hạn tại https://vitristudio.com/#mua rồi dùng tiếp.', 'PLAN');
    elsif vt__mcp_mode() = 'off' then
      perform vt__err('Kết nối Claude đang tạm tắt để bảo trì. Anh/chị vẫn làm video trực tiếp tại https://vitristudio.com/dao-dien', 'PLAN');
    else
      perform vt__err('Kết nối Claude đang chạy thử nội bộ, sắp mở cho khách gói Không giới hạn 90 ngày.', 'PLAN');
    end if;
  end if;
end $$;

-- Đếm lượt theo ngày (giờ Việt Nam), quá p_max thì báo lỗi
create or replace function public.vt__mcp_count(p_user uuid, p_kind text, p_max int) returns void
language plpgsql set search_path = public as $$
declare n int; d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  insert into vt_mcp_usage (day, user_id, kind, n) values (d, p_user, p_kind, 1)
  on conflict (day, user_id, kind) do update set n = vt_mcp_usage.n + 1
  returning vt_mcp_usage.n into n;
  if n > p_max then
    perform vt__err(format('Hôm nay đã dùng hết %s lượt %s. Mai dùng tiếp, hoặc làm trực tiếp tại https://vitristudio.com/dao-dien', p_max,
      case p_kind when 'create' then 'tạo video' when 'update' then 'sửa video' when 'read' then 'xem video' else p_kind end), 'LIMIT');
  end if;
end $$;

create or replace function public.vt__dd_json(p public.vt_dd_projects, p_snap boolean) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'title', p.title, 'lat', p.lat, 'lng', p.lng, 'coord', p.coord, 'listing', p.listing,
    'buyer', p.buyer, 'edits', p.edits, 'opts', p.opts, 'rev', p.rev, 'by', p.by, 'snap_rev', p.snap_rev, 'snap_at', p.snap_at,
    'seen_at', p.seen_at, 'source', p.source, 'created_at', p.created_at, 'updated_at', p.updated_at)
    || case when p_snap then jsonb_build_object('snap', p.snap) else '{}'::jsonb end
$$;

-- Kiểm tra dữ liệu video gửi lên (Claude hoặc web): toạ độ trong Việt Nam, kích thước có giới hạn
create or replace function public.vt__dd_check(p jsonb) returns void
language plpgsql as $$
begin
  if p is null or jsonb_typeof(p) <> 'object' then perform vt__err('Dữ liệu video không hợp lệ', 'INPUT'); end if;
  if p ? 'lat' and ((p->>'lat')::float not between 8 and 23.6 or (p->>'lng')::float not between 102 and 110) then
    perform vt__err('Toạ độ không nằm trong Việt Nam', 'INPUT');
  end if;
  if length(coalesce(p->>'listing', '')) > 8000 then perform vt__err('Tin đăng quá dài (tối đa 8.000 ký tự)', 'INPUT'); end if;
  if pg_column_size(coalesce(p->'edits', '{}'::jsonb)) > 80000 or pg_column_size(coalesce(p->'opts', '{}'::jsonb)) > 20000 then
    perform vt__err('Chỉnh sửa quá lớn', 'INPUT');
  end if;
  if p ? 'buyer' and p->>'buyer' is not null and p->>'buyer' not in ('o', 'vung', 'thue') then perform vt__err('Loại khách không hợp lệ', 'INPUT'); end if;
end $$;

-- ---------- Máy chủ OAuth (worker gọi) ----------
create or replace function public.vt_mcp_client_register(p_name text, p_redirects text[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cid text; r text; n int; nm text := left(btrim(coalesce(p_name, '')), 60);
begin
  if p_redirects is null or cardinality(p_redirects) < 1 or cardinality(p_redirects) > 5 then
    perform vt__err('redirect_uris không hợp lệ', 'invalid_redirect_uri');
  end if;
  foreach r in array p_redirects loop
    if not vt__mcp_redirect_ok(r) then perform vt__err('Chỉ nhận kết nối từ Claude (claude.ai hoặc Claude Code)', 'invalid_redirect_uri'); end if;
  end loop;
  select count(*) into n from vt_mcp_clients where created_at > now() - interval '1 hour';
  if n >= 300 then perform vt__err('Quá nhiều yêu cầu, thử lại sau', 'temporarily_unavailable'); end if;
  -- dọn client đăng ký mà không dùng (quá 2 ngày, chưa có kết nối nào)
  delete from vt_mcp_clients c where c.created_at < now() - interval '2 days'
    and not exists (select 1 from vt_mcp_tokens t where t.client_id = c.client_id);
  cid := 'vt_' || encode(extensions.gen_random_bytes(16), 'hex');
  insert into vt_mcp_clients (client_id, name, redirect_uris) values (cid, nm, p_redirects);
  return jsonb_build_object('client_id', cid, 'client_name', nm, 'redirect_uris', to_jsonb(p_redirects));
end $$;

create or replace function public.vt_mcp_client_get(p_client_id text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('client_id', client_id, 'name', name, 'redirect_uris', to_jsonb(redirect_uris))
  from vt_mcp_clients where client_id = p_client_id
$$;

-- Trang đồng ý: khách đang đăng nhập tài khoản nào, có được dùng không
create or replace function public.vt_mcp_who(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  return jsonb_build_object('login', u.login, 'name', u.name, 'ok', vt__mcp_plan_ok(u), 'mode', vt__mcp_mode());
end $$;

-- Khách bấm "Cho phép" → tạo mã cấp quyền
create or replace function public.vt_mcp_code_create(p_token text, p_client_id text, p_redirect text, p_challenge text, p_scope text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; c vt_mcp_clients; code text;
begin
  u := vt__user(p_token);
  select * into c from vt_mcp_clients where client_id = p_client_id;
  if not found then perform vt__err('Ứng dụng kết nối không hợp lệ, mời thêm lại connector', 'invalid_client'); end if;
  if not vt__mcp_redirect_match(p_redirect, c.redirect_uris) then perform vt__err('Địa chỉ trả về không khớp', 'invalid_request'); end if;
  if p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43,128}$' then perform vt__err('Thiếu PKCE S256', 'invalid_request'); end if;
  perform vt__mcp_need_plan(u);
  delete from vt_mcp_codes where expires_at < now();
  code := vt__mcp_tok();
  insert into vt_mcp_codes (code_hash, user_id, client_id, redirect_uri, challenge, scope)
  values (extensions.digest(code, 'sha256'), u.id, p_client_id, p_redirect, p_challenge, left(coalesce(p_scope, ''), 100));
  return jsonb_build_object('code', code, 'login', u.login);
end $$;

-- Đổi mã lấy token (authorization_code) hoặc làm mới (refresh_token). Lỗi mang hint = mã lỗi OAuth.
create or replace function public.vt_mcp_token(p_grant text, p_client_id text, p_code text default null, p_verifier text default null,
  p_redirect text default null, p_refresh text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cd vt_mcp_codes; t vt_mcp_tokens; u vt_users; c vt_mcp_clients; acc text := vt__mcp_tok(); ref text := vt__mcp_tok(); sc text := '';
  h bytea; grace boolean := false;
begin
  if p_grant = 'authorization_code' then
    delete from vt_mcp_codes where code_hash = extensions.digest(coalesce(p_code, ''), 'sha256') returning * into cd;
    if not found or cd.expires_at < now() then perform vt__err('Mã cấp quyền không hợp lệ hoặc đã hết hạn', 'invalid_grant'); end if;
    if cd.client_id <> coalesce(p_client_id, '') then perform vt__err('client_id không khớp', 'invalid_grant'); end if;
    if p_redirect is not null and p_redirect <> cd.redirect_uri then perform vt__err('redirect_uri không khớp', 'invalid_grant'); end if;
    if p_verifier is null or p_verifier !~ '^[A-Za-z0-9._~-]{43,128}$' or vt__mcp_s256(p_verifier) <> cd.challenge then
      perform vt__err('PKCE không khớp', 'invalid_grant');
    end if;
    select * into u from vt_users where id = cd.user_id;
    if not found or u.status <> 'active' then perform vt__err('Tài khoản không dùng được', 'invalid_grant'); end if;
    perform vt__mcp_need_plan(u);
    select * into c from vt_mcp_clients where client_id = cd.client_id;
    -- mỗi tài khoản tối đa 5 kết nối: giữ 4 kết nối mới nhất + kết nối này
    delete from vt_mcp_tokens where user_id = u.id and (refresh_exp < now() or id in (
      select id from vt_mcp_tokens where user_id = u.id order by created_at desc offset 4));
    insert into vt_mcp_tokens (user_id, client_id, client_name, access_hash, refresh_hash, access_exp, refresh_exp)
    values (u.id, cd.client_id, coalesce(nullif(c.name, ''), 'Claude'), extensions.digest(acc, 'sha256'), extensions.digest(ref, 'sha256'),
      now() + interval '1 hour', now() + interval '60 days');
    sc := cd.scope;
  elsif p_grant = 'refresh_token' then
    h := extensions.digest(coalesce(p_refresh, ''), 'sha256');
    select * into t from vt_mcp_tokens where refresh_hash = h for update;
    if not found then
      select * into t from vt_mcp_tokens where prev_refresh_hash = h and prev_until > now() for update;
      grace := found;
    end if;
    if t.id is null or t.refresh_exp < now() then perform vt__err('Phiên kết nối đã hết hạn, mời kết nối lại', 'invalid_grant'); end if;
    if t.client_id <> coalesce(p_client_id, '') then perform vt__err('client_id không khớp', 'invalid_grant'); end if;
    select * into u from vt_users where id = t.user_id;
    if not found or u.status <> 'active' then perform vt__err('Tài khoản không dùng được', 'invalid_grant'); end if;
    perform vt__mcp_need_plan(u);
    update vt_mcp_tokens set access_hash = extensions.digest(acc, 'sha256'), refresh_hash = extensions.digest(ref, 'sha256'),
      prev_refresh_hash = case when grace then prev_refresh_hash else h end,
      prev_until = case when grace then prev_until else now() + interval '2 minutes' end,
      access_exp = now() + interval '1 hour', refresh_exp = now() + interval '60 days', last_used = now()
    where id = t.id;
  else
    perform vt__err('grant_type không hỗ trợ', 'unsupported_grant_type');
  end if;
  return jsonb_build_object('access_token', acc, 'refresh_token', ref, 'token_type', 'Bearer', 'expires_in', 3600, 'scope', sc);
end $$;

-- ---------- Lệnh của Claude (worker gọi, kèm access token) ----------
create or replace function public.vt_mcp_me(p_access text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config;
begin
  u := vt__mcp_user(p_access);
  select * into cfg from vt_config where id = 1;
  return vt__profile(u) || jsonb_build_object('plan_ok', vt__mcp_plan_ok(u), 'mode', vt__mcp_mode(),
    'unlimited_daily_exports', cfg.unlimited_daily_exports,
    'videos', (select count(*) from vt_dd_projects where user_id = u.id and not deleted));
end $$;

create or replace function public.vt_mcp_dd_create(p_access text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_dd_projects; n int;
begin
  u := vt__mcp_user(p_access);
  perform vt__mcp_need_plan(u);
  perform vt__dd_check(p_data);
  if not (p_data ? 'lat') then perform vt__err('Thiếu toạ độ', 'INPUT'); end if;
  perform vt__mcp_count(u.id, 'create', 30);
  select count(*) into n from vt_dd_projects where user_id = u.id and not deleted;
  if n >= 300 then perform vt__err('Đã lưu tối đa 300 video. Xoá bớt video cũ (xoa_video) rồi tạo lại.', 'LIMIT'); end if;
  insert into vt_dd_projects (user_id, title, lat, lng, coord, listing, buyer, edits, opts, by, source)
  values (u.id, left(btrim(coalesce(p_data->>'title', '')), 80), (p_data->>'lat')::float, (p_data->>'lng')::float,
    left(coalesce(p_data->>'coord', ''), 300), coalesce(p_data->>'listing', ''), p_data->>'buyer',
    coalesce(p_data->'edits', '{}'::jsonb), coalesce(p_data->'opts', '{}'::jsonb), 'claude', 'claude')
  returning * into pr;
  return vt__dd_json(pr, false);
end $$;

create or replace function public.vt_mcp_dd_list(p_access text, p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__mcp_user(p_access);
  perform vt__mcp_need_plan(u);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'lat', lat, 'lng', lng, 'buyer', buyer,
      'rev', rev, 'snap_rev', snap_rev, 'snap_at', snap_at, 'seen_at', seen_at, 'source', source, 'updated_at', updated_at,
      'kind', snap->>'kind', 'ward', snap->>'ward', 'dur', snap->'dur') order by updated_at desc)
    from (select * from vt_dd_projects where user_id = u.id and not deleted order by updated_at desc
      limit greatest(1, least(coalesce(p_limit, 20), 50))) t), '[]'::jsonb);
end $$;

create or replace function public.vt_mcp_dd_get(p_access text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_dd_projects;
begin
  u := vt__mcp_user(p_access);
  perform vt__mcp_need_plan(u);
  perform vt__mcp_count(u.id, 'read', 3000);
  select * into pr from vt_dd_projects where id = p_id and user_id = u.id and not deleted;
  if not found then perform vt__err('Không tìm thấy video này trong tài khoản (gọi danh_sach_video để lấy id)', 'INPUT'); end if;
  return vt__dd_json(pr, true);
end $$;

-- Sửa video: p_base_rev phải bằng rev hiện tại (không thì báo CONFLICT — đọc lại rồi sửa tiếp, tránh ghi đè chỉnh sửa trên web)
create or replace function public.vt_mcp_dd_update(p_access text, p_id uuid, p_base_rev int, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_dd_projects;
begin
  u := vt__mcp_user(p_access);
  perform vt__mcp_need_plan(u);
  perform vt__dd_check(p_data);
  perform vt__mcp_count(u.id, 'update', 400);
  select * into pr from vt_dd_projects where id = p_id and user_id = u.id and not deleted for update;
  if not found then perform vt__err('Không tìm thấy video này trong tài khoản (gọi danh_sach_video để lấy id)', 'INPUT'); end if;
  if pr.rev <> coalesce(p_base_rev, -1) then perform vt__err(format('Video vừa được sửa ở nơi khác (bản %s). Đọc lại rồi sửa tiếp.', pr.rev), 'CONFLICT'); end if;
  update vt_dd_projects set
    title = case when p_data ? 'title' then left(btrim(coalesce(p_data->>'title', '')), 80) else title end,
    listing = case when p_data ? 'listing' then coalesce(p_data->>'listing', '') else listing end,
    buyer = case when p_data ? 'buyer' then p_data->>'buyer' else buyer end,
    edits = case when p_data ? 'edits' then coalesce(p_data->'edits', '{}'::jsonb) else edits end,
    opts = case when p_data ? 'opts' then coalesce(p_data->'opts', '{}'::jsonb) else opts end,
    rev = rev + 1, by = 'claude', updated_at = now()
  where id = pr.id returning * into pr;
  return vt__dd_json(pr, false);
end $$;

create or replace function public.vt_mcp_dd_delete(p_access text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__mcp_user(p_access);
  perform vt__mcp_need_plan(u);
  update vt_dd_projects set deleted = true, updated_at = now() where id = p_id and user_id = u.id and not deleted;
  if not found then perform vt__err('Không tìm thấy video này trong tài khoản', 'INPUT'); end if;
  return '{"ok":true}'::jsonb;
end $$;

-- ---------- Trang /dao-dien (trình duyệt gọi, kèm phiên đăng nhập của app) ----------
-- Khách này có đồng bộ video lên máy chủ không (= được dùng Claude). Khách thường: ok = false → trang chạy y như cũ.
create or replace function public.vt_dd_ok(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  return jsonb_build_object('ok', vt__mcp_plan_ok(u), 'login', u.login);
end $$;

-- Mở video theo id (chủ video mở được dù gói đã hết hạn — video là của khách)
create or replace function public.vt_dd_get(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_dd_projects; owner text;
begin
  u := vt__user(p_token);
  select * into pr from vt_dd_projects where id = p_id and not deleted;
  if not found then perform vt__err('Không tìm thấy video này (có thể đã bị xoá)', 'INPUT'); end if;
  if pr.user_id <> u.id then
    select login into owner from vt_users where id = pr.user_id;
    perform vt__err('Video này thuộc tài khoản khác (' || regexp_replace(coalesce(owner, ''), '^(.{2}).*(.{4})$', '\1…\2') || '). Đăng nhập đúng tài khoản rồi mở lại link.', 'OWNER');
  end if;
  update vt_dd_projects set seen_at = now() where id = pr.id;
  return vt__dd_json(pr, false);
end $$;

-- Trang đang mở hỏi 4 giây/lần: Claude có sửa gì không (rev). Ghi seen_at tối đa 1 lần / 10 giây → Claude biết trang đang mở.
create or replace function public.vt_dd_poll(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_dd_projects;
begin
  u := vt__user(p_token);
  select * into pr from vt_dd_projects where id = p_id and user_id = u.id and not deleted;
  if not found then return jsonb_build_object('gone', true); end if;
  if pr.seen_at is null or pr.seen_at < now() - interval '10 seconds' then update vt_dd_projects set seen_at = now() where id = pr.id; end if;
  return jsonb_build_object('rev', pr.rev, 'by', pr.by);
end $$;

-- Khách sửa trên web → lưu lên để Claude thấy bản mới nhất. Bản trên máy chủ mới hơn (Claude vừa sửa) → không lưu, trả conflict.
create or replace function public.vt_dd_save(p_token text, p_id uuid, p_base_rev int, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_dd_projects;
begin
  u := vt__user(p_token);
  perform vt__dd_check(p_data);
  select * into pr from vt_dd_projects where id = p_id and user_id = u.id and not deleted for update;
  if not found then perform vt__err('Không tìm thấy video này', 'INPUT'); end if;
  if pr.rev <> coalesce(p_base_rev, -1) then return jsonb_build_object('conflict', true, 'rev', pr.rev); end if;
  update vt_dd_projects set
    title = case when p_data ? 'title' then left(btrim(coalesce(p_data->>'title', '')), 80) else title end,
    listing = case when p_data ? 'listing' then coalesce(p_data->>'listing', '') else listing end,
    buyer = case when p_data ? 'buyer' then p_data->>'buyer' else buyer end,
    edits = case when p_data ? 'edits' then coalesce(p_data->'edits', '{}'::jsonb) else edits end,
    opts = case when p_data ? 'opts' then coalesce(p_data->'opts', '{}'::jsonb) else opts end,
    rev = rev + 1, by = 'web', updated_at = now(), seen_at = now()
  where id = pr.id returning * into pr;
  return jsonb_build_object('rev', pr.rev);
end $$;

-- Trang dựng xong → gửi ảnh chụp video (cảnh, lời, tiện ích, số liệu) để Claude đọc. Chỉ nhận ảnh chụp của bản mới nhất.
create or replace function public.vt_dd_snap(p_token text, p_id uuid, p_rev int, p_snap jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_dd_projects;
begin
  u := vt__user(p_token);
  if p_snap is null or jsonb_typeof(p_snap) <> 'object' or pg_column_size(p_snap) > 300000 then perform vt__err('Ảnh chụp video không hợp lệ', 'INPUT'); end if;
  select * into pr from vt_dd_projects where id = p_id and user_id = u.id and not deleted for update;
  if not found then perform vt__err('Không tìm thấy video này', 'INPUT'); end if;
  if p_rev <> pr.rev then return jsonb_build_object('stale', true, 'rev', pr.rev); end if;
  update vt_dd_projects set snap = p_snap, snap_rev = p_rev, snap_at = now(), seen_at = now(),
    title = case when title = '' then left(coalesce(p_snap->>'title', ''), 80) else title end
  where id = pr.id;
  return jsonb_build_object('ok', true, 'rev', pr.rev);
end $$;

-- Khách đủ điều kiện dựng video trên web (không qua Claude) → lưu lên máy chủ để Claude thấy. Cùng căn (≤ ~25 m) trong 60 ngày
-- thì dùng lại video cũ (không tạo trùng).
create or replace function public.vt_dd_create(p_token text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; pr vt_dd_projects; n int;
begin
  u := vt__user(p_token);
  if not vt__mcp_plan_ok(u) then return jsonb_build_object('skip', true); end if;
  perform vt__dd_check(p_data);
  if not (p_data ? 'lat') then perform vt__err('Thiếu toạ độ', 'INPUT'); end if;
  select * into pr from vt_dd_projects where user_id = u.id and not deleted and updated_at > now() - interval '60 days'
    and abs(lat - (p_data->>'lat')::float) < 0.00025 and abs(lng - (p_data->>'lng')::float) < 0.00025
    order by updated_at desc limit 1;
  if found then return vt__dd_json(pr, false) || '{"existing":true}'::jsonb; end if;
  perform vt__mcp_count(u.id, 'create_web', 60);
  select count(*) into n from vt_dd_projects where user_id = u.id and not deleted;
  if n >= 300 then return jsonb_build_object('skip', true); end if;
  insert into vt_dd_projects (user_id, title, lat, lng, coord, listing, buyer, edits, opts, by, source, seen_at)
  values (u.id, left(btrim(coalesce(p_data->>'title', '')), 80), (p_data->>'lat')::float, (p_data->>'lng')::float,
    left(coalesce(p_data->>'coord', ''), 300), coalesce(p_data->>'listing', ''), p_data->>'buyer',
    coalesce(p_data->'edits', '{}'::jsonb), coalesce(p_data->'opts', '{}'::jsonb), 'web', 'web', now())
  returning * into pr;
  return vt__dd_json(pr, false);
end $$;

-- Khách xem / ngắt các kết nối Claude của mình
create or replace function public.vt_mcp_conn_list(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  return jsonb_build_object('ok', vt__mcp_plan_ok(u), 'conns', coalesce((select jsonb_agg(jsonb_build_object('id', id,
      'name', client_name, 'created_at', created_at, 'last_used', last_used) order by created_at desc)
    from vt_mcp_tokens where user_id = u.id and refresh_exp > now()), '[]'::jsonb));
end $$;

create or replace function public.vt_mcp_conn_revoke(p_token text, p_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  delete from vt_mcp_tokens where user_id = u.id and (p_id is null or id = p_id);
  return '{"ok":true}'::jsonb;
end $$;

-- Hàm nội bộ không mở ra ngoài
revoke execute on function public.vt__mcp_tok() from public, anon, authenticated;
revoke execute on function public.vt__mcp_mode() from public, anon, authenticated;
revoke execute on function public.vt__mcp_plan_ok(public.vt_users) from public, anon, authenticated;
revoke execute on function public.vt__mcp_user(text) from public, anon, authenticated;
revoke execute on function public.vt__mcp_need_plan(public.vt_users) from public, anon, authenticated;
revoke execute on function public.vt__mcp_count(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.vt__dd_json(public.vt_dd_projects, boolean) from public, anon, authenticated;
revoke execute on function public.vt__dd_check(jsonb) from public, anon, authenticated;
