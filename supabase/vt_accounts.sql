-- Vị Trí Studio — tài khoản khách hàng, lượt dùng thử, gói trả phí, thanh toán VietQR.
-- Mọi bảng khoá kín (RLS bật, không policy, thu hồi quyền); trình duyệt và edge function
-- chỉ gọi được các hàm vt_* bên dưới. Hàm nội bộ có tên vt__* không mở ra ngoài.
create extension if not exists pgcrypto with schema extensions;

-- ---------- Bảng ----------
create table if not exists public.vt_config (
  id int primary key default 1 check (id = 1),
  trial_credits int not null default 3,
  bank_bin text not null default '970422',
  bank_name text not null default 'MB Bank',
  bank_account text not null default '',
  bank_holder text not null default '',
  zalo_url text not null default '',
  support_note text not null default '',
  order_prefix text not null default 'VT',
  tts_daily_chars int not null default 30000,
  unlimited_daily_exports int not null default 30,
  reexport_hours int not null default 24,
  signup_per_ip_day int not null default 3,
  admin_key_hash bytea,
  webhook_key_hash bytea,
  updated_at timestamptz not null default now()
);
insert into public.vt_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.vt_users (
  id uuid primary key default gen_random_uuid(),
  login text not null unique,
  name text not null default '',
  pass_hash text not null,
  credits int not null default 0 check (credits >= 0),
  unlimited_until timestamptz,
  status text not null default 'active' check (status in ('active', 'locked')),
  signup_ip text,
  note text not null default '',
  created_at timestamptz not null default now(),
  last_login timestamptz
);
create index if not exists vt_users_ip_idx on public.vt_users (signup_ip, created_at);

create table if not exists public.vt_sessions (
  token_hash bytea primary key,
  user_id uuid not null references public.vt_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days',
  last_seen timestamptz not null default now()
);
create index if not exists vt_sessions_user_idx on public.vt_sessions (user_id);

create table if not exists public.vt_login_fails (
  id bigserial primary key,
  login text not null,
  at timestamptz not null default now()
);
create index if not exists vt_login_fails_idx on public.vt_login_fails (login, at);

create table if not exists public.vt_packages (
  id text primary key,
  name text not null,
  description text not null default '',
  price_vnd int not null check (price_vnd > 0),
  credits int not null default 0 check (credits >= 0),
  days int not null default 0 check (days >= 0),
  active boolean not null default true,
  highlight boolean not null default false,
  sort int not null default 0
);

create table if not exists public.vt_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references public.vt_users (id) on delete cascade,
  package_id text not null references public.vt_packages (id),
  package_name text not null,
  amount int not null,
  credits int not null default 0,
  days int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  paid_amount int,
  paid_ref text,
  paid_via text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists vt_orders_user_idx on public.vt_orders (user_id, created_at desc);
create index if not exists vt_orders_status_idx on public.vt_orders (status, created_at desc);

create table if not exists public.vt_usage (
  id bigserial primary key,
  user_id uuid not null references public.vt_users (id) on delete cascade,
  kind text not null check (kind in ('export', 'tts', 'script', 'grant')),
  credits int not null default 0,
  charged boolean not null default false,
  chars int not null default 0,
  lat double precision,
  lng double precision,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists vt_usage_user_idx on public.vt_usage (user_id, kind, created_at desc);

create table if not exists public.vt_payment_events (
  id bigserial primary key,
  source text not null,
  ref text,
  amount int,
  content text,
  matched_code text,
  result text,
  raw jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists vt_payment_events_ref_idx on public.vt_payment_events (source, ref) where ref is not null;

do $$
declare t text;
begin
  foreach t in array array['vt_config','vt_users','vt_sessions','vt_login_fails','vt_packages','vt_orders','vt_usage','vt_payment_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.vt_login_fails_id_seq, public.vt_usage_id_seq, public.vt_payment_events_id_seq from anon, authenticated;

-- ---------- Hàm nội bộ ----------
create or replace function public.vt__err(p_msg text, p_hint text) returns void
language plpgsql as $$ begin raise exception using message = p_msg, hint = p_hint; end $$;

create or replace function public.vt__ip() returns text
language plpgsql stable as $$
declare h json;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then return null; end;
  if h is null then return null; end if;
  return nullif(btrim(coalesce(h ->> 'cf-connecting-ip', split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1), h ->> 'x-real-ip', '')), '');
end $$;

create or replace function public.vt__norm_login(p text) returns text
language plpgsql immutable as $$
declare s text := lower(btrim(coalesce(p, ''))); d text;
begin
  if s ~ '^[+0-9 .()-]+$' then
    d := regexp_replace(s, '[^0-9]', '', 'g');
    if d like '84%' and length(d) = 11 then d := '0' || substr(d, 3); end if;
    if d ~ '^0[0-9]{9}$' then return d; end if;
    perform vt__err('Số điện thoại chưa đúng (10 số, ví dụ 0912345678)', 'INPUT');
  end if;
  if s ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' and length(s) <= 120 then return s; end if;
  perform vt__err('Nhập số điện thoại hoặc email', 'INPUT');
  return null;
end $$;

create or replace function public.vt__new_session(p_user uuid) returns text
language plpgsql as $$
declare tok text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into vt_sessions (token_hash, user_id) values (extensions.digest(tok, 'sha256'), p_user);
  delete from vt_sessions where user_id = p_user and token_hash in (
    select token_hash from vt_sessions where user_id = p_user order by created_at desc offset 10);
  return tok;
end $$;

create or replace function public.vt__user(p_token text, p_lock boolean default false) returns public.vt_users
language plpgsql as $$
declare u vt_users; s vt_sessions;
begin
  if p_token is null or length(p_token) < 32 then perform vt__err('Anh/chị cần đăng nhập', 'AUTH'); end if;
  select * into s from vt_sessions where token_hash = extensions.digest(p_token, 'sha256') and expires_at > now();
  if not found then perform vt__err('Phiên đăng nhập đã hết hạn, mời đăng nhập lại', 'AUTH'); end if;
  if p_lock then select * into u from vt_users where id = s.user_id for update;
  else select * into u from vt_users where id = s.user_id; end if;
  if not found then perform vt__err('Tài khoản không còn tồn tại', 'AUTH'); end if;
  if u.status <> 'active' then perform vt__err('Tài khoản đang bị khoá, liên hệ hỗ trợ', 'LOCKED'); end if;
  if s.last_seen < now() - interval '1 hour' then
    update vt_sessions set last_seen = now(), expires_at = greatest(expires_at, now() + interval '60 days')
    where token_hash = s.token_hash;
  end if;
  return u;
end $$;

create or replace function public.vt__profile(u public.vt_users) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', u.id, 'login', u.login, 'name', u.name, 'credits', u.credits,
    'unlimited_until', u.unlimited_until, 'unlimited', coalesce(u.unlimited_until > now(), false),
    'created_at', u.created_at)
$$;

create or replace function public.vt__order_json(o public.vt_orders) returns jsonb
language sql stable as $$
  select jsonb_build_object('code', o.code, 'package_id', o.package_id, 'package_name', o.package_name,
    'amount', o.amount, 'credits', o.credits, 'days', o.days, 'status', o.status,
    'created_at', o.created_at, 'paid_at', o.paid_at)
$$;

create or replace function public.vt__bank() returns jsonb
language sql stable as $$
  select jsonb_build_object('bin', bank_bin, 'name', bank_name, 'account', bank_account, 'holder', bank_holder,
    'zalo', zalo_url, 'note', support_note)
  from vt_config where id = 1
$$;

-- Lần xuất có tính lượt gần nhất quanh vị trí này (300 m) còn trong hạn xuất lại miễn phí
create or replace function public.vt__recent_export(p_user uuid, p_lat double precision, p_lng double precision) returns timestamptz
language sql stable as $$
  select max(created_at) from vt_usage
  where user_id = p_user and kind = 'export' and charged and lat is not null and p_lat is not null and p_lng is not null
    and created_at > now() - make_interval(hours => (select reexport_hours from vt_config where id = 1))
    and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3
$$;

create or replace function public.vt__today_start() returns timestamptz
language sql stable as $$ select (date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh')) at time zone 'Asia/Ho_Chi_Minh' $$;

create or replace function public.vt__apply_order(p_order uuid, p_via text, p_ref text, p_amount int) returns boolean
language plpgsql as $$
declare o vt_orders;
begin
  update vt_orders set status = 'paid', paid_at = now(), paid_via = p_via, paid_ref = p_ref, paid_amount = coalesce(p_amount, amount)
  where id = p_order and status <> 'paid' returning * into o;
  if not found then return false; end if;
  update vt_users set credits = credits + o.credits,
    unlimited_until = case when o.days > 0
      then greatest(now(), coalesce(unlimited_until, now())) + make_interval(days => o.days) else unlimited_until end
  where id = o.user_id;
  insert into vt_usage (user_id, kind, credits, note)
  values (o.user_id, 'grant', o.credits, 'Thanh toán đơn ' || o.code || case when o.days > 0 then ' (+' || o.days || ' ngày)' else '' end);
  return true;
end $$;

create or replace function public.vt__admin(p_key text) returns void
language plpgsql stable as $$
declare h bytea;
begin
  select admin_key_hash into h from vt_config where id = 1;
  if h is null or p_key is null or extensions.digest(p_key, 'sha256') <> h then
    perform vt__err('Sai mã quản trị', 'ADMIN');
  end if;
end $$;

-- ---------- Hàm cho khách (trình duyệt) ----------
create or replace function public.vt_public_info() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'trial_credits', (select trial_credits from vt_config where id = 1),
    'reexport_hours', (select reexport_hours from vt_config where id = 1),
    'bank', vt__bank(),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description,
        'price', price_vnd, 'credits', credits, 'days', days, 'highlight', highlight) order by sort, price_vnd)
      from vt_packages where active), '[]'::jsonb))
$$;

create or replace function public.vt_register(p_login text, p_password text, p_name text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cfg vt_config; lg text; ip text := vt__ip(); u vt_users; n int;
begin
  select * into cfg from vt_config where id = 1;
  lg := vt__norm_login(p_login);
  if length(coalesce(p_password, '')) < 6 then perform vt__err('Mật khẩu cần ít nhất 6 ký tự', 'INPUT'); end if;
  if length(p_password) > 72 then perform vt__err('Mật khẩu quá dài', 'INPUT'); end if;
  if ip is not null then
    select count(*) into n from vt_users where signup_ip = ip and created_at > now() - interval '1 day';
    if n >= cfg.signup_per_ip_day then
      perform vt__err('Mạng này đã tạo nhiều tài khoản trong hôm nay. Thử lại sau hoặc nhắn hỗ trợ.', 'LIMIT');
    end if;
  end if;
  begin
    insert into vt_users (login, name, pass_hash, credits, signup_ip)
    values (lg, left(btrim(coalesce(p_name, '')), 60), crypt(p_password, gen_salt('bf', 10)), cfg.trial_credits, ip)
    returning * into u;
  exception when unique_violation then
    perform vt__err('Số điện thoại hoặc email này đã có tài khoản, mời đăng nhập', 'EXISTS');
  end;
  if cfg.trial_credits > 0 then
    insert into vt_usage (user_id, kind, credits, note) values (u.id, 'grant', cfg.trial_credits, 'Tặng lượt dùng thử');
  end if;
  return jsonb_build_object('token', vt__new_session(u.id), 'profile', vt__profile(u));
end $$;

-- Sai mật khẩu trả về ok=false (không raise) để còn ghi lại số lần sai
create or replace function public.vt_login(p_login text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare lg text; u vt_users; n int; good boolean;
begin
  lg := vt__norm_login(p_login);
  delete from vt_login_fails where at < now() - interval '1 day';
  select count(*) into n from vt_login_fails where login = lg and at > now() - interval '15 minutes';
  if n >= 8 then
    return jsonb_build_object('ok', false, 'hint', 'LIMIT', 'message', 'Nhập sai nhiều lần, thử lại sau 15 phút');
  end if;
  select * into u from vt_users where login = lg;
  if found then good := u.pass_hash = crypt(coalesce(p_password, ''), u.pass_hash);
  else good := false; perform crypt('x', gen_salt('bf', 10)); end if;
  if not good then
    insert into vt_login_fails (login) values (lg);
    return jsonb_build_object('ok', false, 'hint', 'BAD', 'message', 'Sai số điện thoại/email hoặc mật khẩu');
  end if;
  if u.status <> 'active' then
    return jsonb_build_object('ok', false, 'hint', 'LOCKED', 'message', 'Tài khoản đang bị khoá, liên hệ hỗ trợ');
  end if;
  delete from vt_login_fails where login = lg;
  delete from vt_sessions where expires_at < now();
  update vt_users set last_login = now() where id = u.id;
  return jsonb_build_object('ok', true, 'token', vt__new_session(u.id), 'profile', vt__profile(u));
end $$;

create or replace function public.vt_logout(p_token text) returns jsonb
language sql security definer set search_path = public, extensions as $$
  delete from vt_sessions where token_hash = extensions.digest(coalesce(p_token, ''), 'sha256');
  select '{"ok":true}'::jsonb
$$;

create or replace function public.vt_me(p_token text, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; last timestamptz; hrs int; o vt_orders;
begin
  u := vt__user(p_token);
  select reexport_hours into hrs from vt_config where id = 1;
  last := vt__recent_export(u.id, p_lat, p_lng);
  select * into o from vt_orders where user_id = u.id and status = 'pending' and created_at > now() - interval '24 hours'
  order by created_at desc limit 1;
  return jsonb_build_object('profile', vt__profile(u),
    'reexport_until', case when last is null then null else last + make_interval(hours => hrs) end,
    'pending', case when o.id is null then null else vt__order_json(o) end);
end $$;

create or replace function public.vt_export_begin(p_token text, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; last timestamptz; n int;
begin
  u := vt__user(p_token, true);
  select * into cfg from vt_config where id = 1;
  last := vt__recent_export(u.id, p_lat, p_lng);
  if last is not null then
    insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 0, false, p_lat, p_lng, 'Xuất lại miễn phí');
    return jsonb_build_object('ok', true, 'charged', false, 'mode', 'reexport',
      'until', last + make_interval(hours => cfg.reexport_hours), 'profile', vt__profile(u));
  end if;
  if u.unlimited_until > now() then
    select count(*) into n from vt_usage where user_id = u.id and kind = 'export' and charged and created_at >= vt__today_start();
    if n >= cfg.unlimited_daily_exports then
      return jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT', 'profile', vt__profile(u),
        'message', 'Gói không giới hạn cho tối đa ' || cfg.unlimited_daily_exports || ' video mỗi ngày. Mai dùng tiếp nhé.');
    end if;
    insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 0, true, p_lat, p_lng, 'Gói không giới hạn');
    return jsonb_build_object('ok', true, 'charged', false, 'mode', 'unlimited',
      'until', now() + make_interval(hours => cfg.reexport_hours), 'profile', vt__profile(u));
  end if;
  if u.credits <= 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_CREDIT', 'profile', vt__profile(u),
      'message', 'Anh/chị đã dùng hết lượt. Mua thêm lượt để xuất tiếp.');
  end if;
  update vt_users set credits = credits - 1 where id = u.id returning * into u;
  insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 1, true, p_lat, p_lng, 'Xuất video');
  return jsonb_build_object('ok', true, 'charged', true, 'mode', 'credit',
    'until', now() + make_interval(hours => cfg.reexport_hours), 'profile', vt__profile(u));
end $$;

-- Gọi từ edge function trước khi dùng dịch vụ AI tốn phí (giọng đọc, viết kịch bản).
-- Chỉ ghi nhận hạn mức của chính người dùng, không cộng gì nên không cần khoá máy chủ.
create or replace function public.vt_ai_allow(p_token text, p_kind text, p_chars int, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; n int; k text := case when p_kind = 'script' then 'script' else 'tts' end;
begin
  u := vt__user(p_token);
  select * into cfg from vt_config where id = 1;
  if not (coalesce(u.unlimited_until > now(), false) or u.credits > 0 or vt__recent_export(u.id, p_lat, p_lng) is not null) then
    return jsonb_build_object('ok', false, 'code', 'NO_CREDIT', 'message', 'Anh/chị đã hết lượt. Mua thêm lượt để dùng giọng đọc AI.');
  end if;
  select coalesce(sum(chars), 0) into n from vt_usage where user_id = u.id and kind = k and created_at > now() - interval '1 day';
  if n + greatest(coalesce(p_chars, 0), 0) > cfg.tts_daily_chars then
    return jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT', 'message', 'Đã dùng hết hạn mức AI trong 24 giờ qua. Thử lại sau nhé.');
  end if;
  insert into vt_usage (user_id, kind, chars, lat, lng) values (u.id, k, greatest(coalesce(p_chars, 0), 0), p_lat, p_lng);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.vt_create_order(p_token text, p_package text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; p vt_packages; o vt_orders; cfg vt_config; c text; i int := 0;
begin
  u := vt__user(p_token);
  select * into cfg from vt_config where id = 1;
  select * into p from vt_packages where id = p_package and active;
  if not found then perform vt__err('Gói này không còn bán, chọn gói khác', 'INPUT'); end if;
  if btrim(cfg.bank_account) = '' then perform vt__err('Chưa cài tài khoản nhận tiền, liên hệ hỗ trợ', 'CONFIG'); end if;
  select * into o from vt_orders where user_id = u.id and package_id = p.id and status = 'pending'
    and amount = p.price_vnd and created_at > now() - interval '24 hours' order by created_at desc limit 1;
  if not found then
    if (select count(*) from vt_orders where user_id = u.id and created_at > now() - interval '1 hour') >= 10 then
      perform vt__err('Tạo quá nhiều đơn, thử lại sau ít phút', 'LIMIT');
    end if;
    loop
      c := upper(cfg.order_prefix) || lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from vt_orders where code = c);
      i := i + 1;
      if i > 30 then perform vt__err('Không tạo được mã đơn, thử lại', 'RETRY'); end if;
    end loop;
    insert into vt_orders (code, user_id, package_id, package_name, amount, credits, days)
    values (c, u.id, p.id, p.name, p.price_vnd, p.credits, p.days) returning * into o;
  end if;
  return jsonb_build_object('order', vt__order_json(o), 'bank', vt__bank());
end $$;

create or replace function public.vt_order_status(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; o vt_orders;
begin
  u := vt__user(p_token);
  select * into o from vt_orders where code = upper(btrim(p_code)) and user_id = u.id;
  if not found then perform vt__err('Không thấy đơn này', 'INPUT'); end if;
  return jsonb_build_object('order', vt__order_json(o), 'profile', vt__profile(u));
end $$;

create or replace function public.vt_cancel_order(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  update vt_orders set status = 'cancelled' where code = upper(btrim(p_code)) and user_id = u.id and status = 'pending';
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.vt_history(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  return jsonb_build_object('profile', vt__profile(u),
    'orders', coalesce((select jsonb_agg(vt__order_json(o) order by o.created_at desc) from vt_orders o
      where o.id in (select id from vt_orders where user_id = u.id order by created_at desc limit 20)), '[]'::jsonb),
    'usage', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'credits', credits, 'charged', charged, 'note', note, 'at', created_at) order by created_at desc)
      from (select * from vt_usage where user_id = u.id and kind in ('export', 'grant') order by created_at desc limit 30) x), '[]'::jsonb));
end $$;

create or replace function public.vt_change_password(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  if u.pass_hash <> crypt(coalesce(p_old, ''), u.pass_hash) then
    return jsonb_build_object('ok', false, 'message', 'Mật khẩu hiện tại chưa đúng');
  end if;
  if length(coalesce(p_new, '')) < 6 or length(p_new) > 72 then
    return jsonb_build_object('ok', false, 'message', 'Mật khẩu mới cần 6 đến 72 ký tự');
  end if;
  update vt_users set pass_hash = crypt(p_new, gen_salt('bf', 10)) where id = u.id;
  delete from vt_sessions where user_id = u.id and token_hash <> extensions.digest(p_token, 'sha256');
  return '{"ok":true}'::jsonb;
end $$;

-- ---------- Webhook ngân hàng (SePay) ----------
-- p_key là khoá webhook anh/chị đặt trong SePay; so với bản băm lưu trong vt_config (đặt ở trang quản trị).
create or replace function public.vt_payment_in(p_key text, p_source text, p_ref text, p_amount int, p_content text, p_raw jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cfg vt_config; ev bigint; clean text; m text; o vt_orders;
begin
  select * into cfg from vt_config where id = 1;
  if cfg.webhook_key_hash is null or p_key is null or extensions.digest(p_key, 'sha256') <> cfg.webhook_key_hash then
    perform vt__err('Sai khoá webhook', 'WEBHOOK');
  end if;
  insert into vt_payment_events (source, ref, amount, content, raw)
  values (left(coalesce(p_source, 'bank'), 20), nullif(left(coalesce(p_ref, ''), 80), ''), p_amount, left(coalesce(p_content, ''), 500), p_raw)
  on conflict (source, ref) where ref is not null do nothing
  returning id into ev;
  if ev is null then return jsonb_build_object('result', 'duplicate'); end if;
  clean := upper(regexp_replace(coalesce(p_content, ''), '[^A-Za-z0-9]', '', 'g'));
  m := substring(clean from upper(cfg.order_prefix) || '[0-9]{6}');
  if m is null then
    update vt_payment_events set result = 'no_code' where id = ev;
    return jsonb_build_object('result', 'no_code');
  end if;
  select * into o from vt_orders where code = m for update;
  if not found then
    update vt_payment_events set result = 'unknown_code', matched_code = m where id = ev;
    return jsonb_build_object('result', 'unknown_code', 'code', m);
  end if;
  if o.status = 'paid' then
    update vt_payment_events set result = 'already_paid', matched_code = m where id = ev;
    return jsonb_build_object('result', 'already_paid', 'code', m);
  end if;
  if coalesce(p_amount, 0) < o.amount then
    update vt_payment_events set result = 'amount_low', matched_code = m where id = ev;
    return jsonb_build_object('result', 'amount_low', 'code', m);
  end if;
  perform vt__apply_order(o.id, left(coalesce(p_source, 'bank'), 20), p_ref, p_amount);
  update vt_payment_events set result = 'paid', matched_code = m where id = ev;
  return jsonb_build_object('result', 'paid', 'code', m);
end $$;

-- ---------- Quản trị ----------
-- Lần đầu chưa có mã quản trị: ai mở trang quản trị trước sẽ đặt mã (chỉ một lần).
create or replace function public.vt_admin_setup(p_new_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_new_key, '')) < 10 then perform vt__err('Mã quản trị cần ít nhất 10 ký tự', 'INPUT'); end if;
  update vt_config set admin_key_hash = extensions.digest(p_new_key, 'sha256'), updated_at = now()
  where id = 1 and admin_key_hash is null;
  if not found then perform vt__err('Đã có mã quản trị. Đăng nhập bằng mã đó.', 'ADMIN'); end if;
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.vt_admin_status() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('has_key', admin_key_hash is not null) from vt_config where id = 1
$$;

create or replace function public.vt_admin_overview(p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare month_start timestamptz := (date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')) at time zone 'Asia/Ho_Chi_Minh';
begin
  perform vt__admin(p_key);
  return jsonb_build_object(
    'users', (select count(*) from vt_users),
    'users_7d', (select count(*) from vt_users where created_at > now() - interval '7 days'),
    'paying_users', (select count(distinct user_id) from vt_orders where status = 'paid'),
    'revenue_month', (select coalesce(sum(coalesce(paid_amount, amount)), 0) from vt_orders where status = 'paid' and paid_at >= month_start),
    'revenue_total', (select coalesce(sum(coalesce(paid_amount, amount)), 0) from vt_orders where status = 'paid'),
    'orders_pending', (select count(*) from vt_orders where status = 'pending' and created_at > now() - interval '3 days'),
    'exports_today', (select count(*) from vt_usage where kind = 'export' and created_at >= vt__today_start()),
    'exports_total', (select count(*) from vt_usage where kind = 'export'),
    'tts_chars_month', (select coalesce(sum(chars), 0) from vt_usage where kind = 'tts' and created_at >= month_start),
    'unmatched', (select count(*) from vt_payment_events where result in ('no_code', 'unknown_code', 'amount_low') and created_at > now() - interval '30 days'),
    'webhook_ready', (select webhook_key_hash is not null from vt_config where id = 1));
end $$;

create or replace function public.vt_admin_orders(p_key text, p_status text default null, p_q text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select vt__order_json(o) || jsonb_build_object('user_id', u.id, 'login', u.login, 'name', u.name,
      'paid_amount', o.paid_amount, 'paid_via', o.paid_via, 'paid_ref', o.paid_ref) as x
    from vt_orders o join vt_users u on u.id = o.user_id
    where (p_status is null or p_status = '' or o.status = p_status)
      and (p_q is null or p_q = '' or o.code ilike '%' || p_q || '%' or u.login ilike '%' || p_q || '%' or u.name ilike '%' || p_q || '%')
    order by o.created_at desc limit 200) t), '[]'::jsonb);
end $$;

create or replace function public.vt_admin_payments(p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'source', source, 'ref', ref, 'amount', amount,
      'content', content, 'code', matched_code, 'result', result, 'at', created_at) order by created_at desc)
    from (select * from vt_payment_events order by created_at desc limit 100) e), '[]'::jsonb);
end $$;

create or replace function public.vt_admin_mark_paid(p_key text, p_code text, p_amount int default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare o vt_orders;
begin
  perform vt__admin(p_key);
  select * into o from vt_orders where code = upper(btrim(p_code)) for update;
  if not found then perform vt__err('Không thấy đơn ' || p_code, 'INPUT'); end if;
  if not vt__apply_order(o.id, 'admin', 'thu-cong', coalesce(p_amount, o.amount)) then
    perform vt__err('Đơn này đã được xác nhận trước đó', 'INPUT');
  end if;
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.vt_admin_cancel_order(p_key text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  update vt_orders set status = 'cancelled' where code = upper(btrim(p_code)) and status = 'pending';
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.vt_admin_users(p_key text, p_q text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select vt__profile(u) || jsonb_build_object('status', u.status, 'note', u.note, 'last_login', u.last_login,
      'exports', (select count(*) from vt_usage g where g.user_id = u.id and g.kind = 'export'),
      'paid_total', (select coalesce(sum(coalesce(paid_amount, amount)), 0) from vt_orders o where o.user_id = u.id and o.status = 'paid')) as x
    from vt_users u
    where p_q is null or p_q = '' or u.login ilike '%' || p_q || '%' or u.name ilike '%' || p_q || '%'
    order by u.created_at desc limit 200) t), '[]'::jsonb);
end $$;

create or replace function public.vt_admin_adjust(p_key text, p_user uuid, p_credits int, p_days int, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  perform vt__admin(p_key);
  update vt_users set credits = greatest(0, credits + coalesce(p_credits, 0)),
    unlimited_until = case
      when coalesce(p_days, 0) > 0 then greatest(now(), coalesce(unlimited_until, now())) + make_interval(days => p_days)
      when coalesce(p_days, 0) < 0 and unlimited_until is not null then unlimited_until + make_interval(days => p_days)
      else unlimited_until end
  where id = p_user returning * into u;
  if not found then perform vt__err('Không thấy khách hàng', 'INPUT'); end if;
  insert into vt_usage (user_id, kind, credits, note)
  values (u.id, 'grant', coalesce(p_credits, 0), coalesce(nullif(btrim(p_note), ''), 'Quản trị điều chỉnh')
    || case when coalesce(p_days, 0) <> 0 then ' (' || p_days || ' ngày)' else '' end);
  return vt__profile(u);
end $$;

create or replace function public.vt_admin_user_update(p_key text, p_user uuid, p_status text default null, p_note text default null, p_password text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  if p_password is not null and (length(p_password) < 6 or length(p_password) > 72) then
    perform vt__err('Mật khẩu mới cần 6 đến 72 ký tự', 'INPUT');
  end if;
  update vt_users set
    status = case when p_status in ('active', 'locked') then p_status else status end,
    note = coalesce(p_note, note),
    pass_hash = case when p_password is not null then crypt(p_password, gen_salt('bf', 10)) else pass_hash end
  where id = p_user;
  if not found then perform vt__err('Không thấy khách hàng', 'INPUT'); end if;
  if p_status = 'locked' or p_password is not null then delete from vt_sessions where user_id = p_user; end if;
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.vt_admin_settings(p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  return jsonb_build_object(
    'config', (select to_jsonb(c) - 'admin_key_hash' - 'webhook_key_hash' || jsonb_build_object('webhook_ready', c.webhook_key_hash is not null) from vt_config c where id = 1),
    'packages', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort, p.price_vnd) from vt_packages p), '[]'::jsonb));
end $$;

create or replace function public.vt_admin_save_config(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  update vt_config set
    trial_credits = coalesce((p->>'trial_credits')::int, trial_credits),
    bank_bin = coalesce(nullif(btrim(p->>'bank_bin'), ''), bank_bin),
    bank_name = coalesce(p->>'bank_name', bank_name),
    bank_account = coalesce(regexp_replace(p->>'bank_account', '\s', '', 'g'), bank_account),
    bank_holder = coalesce(upper(btrim(p->>'bank_holder')), bank_holder),
    zalo_url = coalesce(btrim(p->>'zalo_url'), zalo_url),
    support_note = coalesce(p->>'support_note', support_note),
    tts_daily_chars = coalesce((p->>'tts_daily_chars')::int, tts_daily_chars),
    unlimited_daily_exports = coalesce((p->>'unlimited_daily_exports')::int, unlimited_daily_exports),
    reexport_hours = coalesce((p->>'reexport_hours')::int, reexport_hours),
    signup_per_ip_day = coalesce((p->>'signup_per_ip_day')::int, signup_per_ip_day),
    webhook_key_hash = case when length(coalesce(p->>'webhook_key', '')) >= 8 then extensions.digest(p->>'webhook_key', 'sha256') else webhook_key_hash end,
    admin_key_hash = case when length(coalesce(p->>'new_admin_key', '')) >= 10 then extensions.digest(p->>'new_admin_key', 'sha256') else admin_key_hash end,
    updated_at = now()
  where id = 1;
  return vt_admin_settings(coalesce(case when length(coalesce(p->>'new_admin_key', '')) >= 10 then p->>'new_admin_key' end, p_key));
end $$;

create or replace function public.vt_admin_save_package(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  if coalesce(p->>'id', '') !~ '^[a-z0-9_-]{2,30}$' then perform vt__err('Mã gói chỉ gồm chữ thường, số, gạch (2-30 ký tự)', 'INPUT'); end if;
  insert into vt_packages (id, name, description, price_vnd, credits, days, active, highlight, sort)
  values (p->>'id', coalesce(p->>'name', p->>'id'), coalesce(p->>'description', ''), (p->>'price_vnd')::int,
    coalesce((p->>'credits')::int, 0), coalesce((p->>'days')::int, 0), coalesce((p->>'active')::boolean, true),
    coalesce((p->>'highlight')::boolean, false), coalesce((p->>'sort')::int, 0))
  on conflict (id) do update set name = excluded.name, description = excluded.description, price_vnd = excluded.price_vnd,
    credits = excluded.credits, days = excluded.days, active = excluded.active, highlight = excluded.highlight, sort = excluded.sort;
  return vt_admin_settings(p_key);
end $$;

-- ---------- Quyền gọi hàm ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'vt\_%' loop
    execute format('alter function %s set search_path = public, extensions', f.sig);
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not like 'vt\_\_%' then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    end if;
  end loop;
end $$;

-- ---------- Gói mặc định (sửa ở trang quản trị) ----------
insert into public.vt_packages (id, name, description, price_vnd, credits, days, highlight, sort) values
  ('goi10', 'Gói 10 video', '10 lượt xuất video, không hết hạn', 99000, 10, 0, false, 1),
  ('goi30', 'Gói 30 video', '30 lượt, rẻ hơn 16% so với gói 10', 249000, 30, 0, true, 2),
  ('thang', 'Không giới hạn 30 ngày', 'Xuất thoải mái trong 30 ngày, tối đa 30 video mỗi ngày', 499000, 0, 30, false, 3)
on conflict (id) do nothing;
