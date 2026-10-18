-- Vị Trí Studio — giới thiệu bạn bè.
-- Người được mời đăng ký qua link ?ref=MÃ: được cộng ngay ref_bonus lượt.
-- Người mời: được cộng ref_bonus lượt khi bạn mình xuất video đầu tiên (tối đa ref_max_month lần mỗi 30 ngày).
-- Chạy lại nhiều lần vẫn an toàn.

alter table public.vt_config add column if not exists ref_bonus int not null default 2;
alter table public.vt_config add column if not exists ref_max_month int not null default 30;
alter table public.vt_users add column if not exists ref_code text;
alter table public.vt_users add column if not exists referred_by uuid references public.vt_users (id) on delete set null;
alter table public.vt_users add column if not exists ref_rewarded boolean not null default false;
create unique index if not exists vt_users_ref_code_idx on public.vt_users (ref_code);
create index if not exists vt_users_referred_idx on public.vt_users (referred_by);

-- Mã 6 ký tự dễ đọc (bỏ 0/o/1/l/i)
create or replace function public.vt__ref_code() returns text
language plpgsql as $$
declare abc text := 'abcdefghjkmnpqrstuvwxyz23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from vt_users where ref_code = c);
  end loop;
  return c;
end $$;

update public.vt_users set ref_code = public.vt__ref_code() where ref_code is null;

create or replace function public.vt__profile(u public.vt_users) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', u.id, 'login', u.login, 'name', u.name, 'credits', u.credits,
    'unlimited_until', u.unlimited_until, 'unlimited', coalesce(u.unlimited_until > now(), false),
    'created_at', u.created_at, 'ref_code', u.ref_code)
$$;

create or replace function public.vt_public_info() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'trial_credits', (select trial_credits from vt_config where id = 1),
    'reexport_hours', (select reexport_hours from vt_config where id = 1),
    'ref_bonus', (select ref_bonus from vt_config where id = 1),
    'bank', vt__bank(),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description,
        'price', price_vnd, 'credits', credits, 'days', days, 'highlight', highlight) order by sort, price_vnd)
      from vt_packages where active), '[]'::jsonb))
$$;

-- Đăng ký kèm mã giới thiệu (giữ nguyên vt_register cũ cho bản app cũ còn trong bộ nhớ đệm)
create or replace function public.vt_signup(p_login text, p_password text, p_name text default '', p_ref text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cfg vt_config; lg text; ip text := vt__ip(); u vt_users; n int; inviter uuid; bonus int := 0;
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
  if nullif(btrim(coalesce(p_ref, '')), '') is not null and cfg.ref_bonus > 0 then
    select id into inviter from vt_users where ref_code = lower(btrim(p_ref)) and status = 'active';
    if inviter is not null then bonus := cfg.ref_bonus; end if;
  end if;
  begin
    insert into vt_users (login, name, pass_hash, credits, signup_ip, ref_code, referred_by)
    values (lg, left(btrim(coalesce(p_name, '')), 60), crypt(p_password, gen_salt('bf', 10)), cfg.trial_credits + bonus, ip,
      vt__ref_code(), inviter)
    returning * into u;
  exception when unique_violation then
    perform vt__err('Số điện thoại hoặc email này đã có tài khoản, mời đăng nhập', 'EXISTS');
  end;
  if cfg.trial_credits > 0 then
    insert into vt_usage (user_id, kind, credits, note) values (u.id, 'grant', cfg.trial_credits, 'Tặng lượt dùng thử');
  end if;
  if bonus > 0 then
    insert into vt_usage (user_id, kind, credits, note) values (u.id, 'grant', bonus, 'Thưởng đăng ký qua link giới thiệu');
  end if;
  return jsonb_build_object('token', vt__new_session(u.id), 'profile', vt__profile(u), 'ref_bonus', bonus);
end $$;

-- Thưởng cho người mời khi người được mời xuất video đầu tiên
create or replace function public.vt__ref_reward(p_user uuid) returns void
language plpgsql as $$
declare u vt_users; cfg vt_config; n int;
begin
  select * into u from vt_users where id = p_user for update;
  if not found or u.referred_by is null or u.ref_rewarded then return; end if;
  update vt_users set ref_rewarded = true where id = u.id;
  select * into cfg from vt_config where id = 1;
  if cfg.ref_bonus <= 0 then return; end if;
  select count(*) into n from vt_usage where user_id = u.referred_by and kind = 'grant'
    and note like 'Thưởng giới thiệu%' and created_at > now() - interval '30 days';
  if n >= cfg.ref_max_month then return; end if;
  update vt_users set credits = credits + cfg.ref_bonus where id = u.referred_by and status = 'active';
  if found then
    insert into vt_usage (user_id, kind, credits, note)
    values (u.referred_by, 'grant', cfg.ref_bonus, 'Thưởng giới thiệu: ' || u.login);
  end if;
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
    perform vt__ref_reward(u.id);
    return jsonb_build_object('ok', true, 'charged', false, 'mode', 'unlimited',
      'until', now() + make_interval(hours => cfg.reexport_hours), 'profile', vt__profile(u));
  end if;
  if u.credits <= 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_CREDIT', 'profile', vt__profile(u),
      'message', 'Anh/chị đã dùng hết lượt. Mua thêm lượt để xuất tiếp.');
  end if;
  update vt_users set credits = credits - 1 where id = u.id returning * into u;
  insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 1, true, p_lat, p_lng, 'Xuất video');
  perform vt__ref_reward(u.id);
  return jsonb_build_object('ok', true, 'charged', true, 'mode', 'credit',
    'until', now() + make_interval(hours => cfg.reexport_hours), 'profile', vt__profile(u));
end $$;

create or replace function public.vt_me(p_token text, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; last timestamptz; cfg vt_config; o vt_orders;
begin
  u := vt__user(p_token);
  if u.ref_code is null then
    update vt_users set ref_code = vt__ref_code() where id = u.id returning * into u;
  end if;
  select * into cfg from vt_config where id = 1;
  last := vt__recent_export(u.id, p_lat, p_lng);
  select * into o from vt_orders where user_id = u.id and status = 'pending' and created_at > now() - interval '24 hours'
  order by created_at desc limit 1;
  return jsonb_build_object('profile', vt__profile(u),
    'reexport_until', case when last is null then null else last + make_interval(hours => cfg.reexport_hours) end,
    'pending', case when o.id is null then null else vt__order_json(o) end,
    'ref', jsonb_build_object('code', u.ref_code, 'bonus', cfg.ref_bonus,
      'invited', (select count(*) from vt_users x where x.referred_by = u.id),
      'rewarded', (select count(*) from vt_users x where x.referred_by = u.id and x.ref_rewarded)));
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
    ref_bonus = greatest(0, coalesce((p->>'ref_bonus')::int, ref_bonus)),
    ref_max_month = greatest(0, coalesce((p->>'ref_max_month')::int, ref_max_month)),
    webhook_key_hash = case when length(coalesce(p->>'webhook_key', '')) >= 8 then extensions.digest(p->>'webhook_key', 'sha256') else webhook_key_hash end,
    admin_key_hash = case when length(coalesce(p->>'new_admin_key', '')) >= 10 then extensions.digest(p->>'new_admin_key', 'sha256') else admin_key_hash end,
    updated_at = now()
  where id = 1;
  return vt_admin_settings(coalesce(case when length(coalesce(p->>'new_admin_key', '')) >= 10 then p->>'new_admin_key' end, p_key));
end $$;

-- Danh sách khách trong quản trị: thêm người mời và số người đã mời
create or replace function public.vt_admin_users(p_key text, p_q text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select vt__profile(u) || jsonb_build_object('status', u.status, 'note', u.note, 'last_login', u.last_login,
      'exports', (select count(*) from vt_usage g where g.user_id = u.id and g.kind = 'export'),
      'paid_total', (select coalesce(sum(coalesce(paid_amount, amount)), 0) from vt_orders o where o.user_id = u.id and o.status = 'paid'),
      'invited_by', (select r.login from vt_users r where r.id = u.referred_by),
      'invited', (select count(*) from vt_users r where r.referred_by = u.id)) as x
    from vt_users u
    where p_q is null or p_q = '' or u.login ilike '%' || p_q || '%' or u.name ilike '%' || p_q || '%' or u.ref_code = lower(p_q)
    order by u.created_at desc limit 200) t), '[]'::jsonb);
end $$;

-- Quyền gọi hàm: hàm vt_* mở cho trình duyệt, hàm nội bộ vt__* đóng
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
