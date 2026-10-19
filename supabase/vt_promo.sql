-- Vị Trí Studio — ưu đãi gói đầu: khách dùng hết lượt dùng thử mà chưa mua lần nào được giảm giá gói đầu trong N giờ.
alter table public.vt_config add column if not exists promo_percent int not null default 25;
alter table public.vt_config add column if not exists promo_hours int not null default 24;
alter table public.vt_users add column if not exists promo_until timestamptz;

-- Mở ưu đãi (một lần) khi đủ điều kiện; trả về phần trăm đang áp dụng (0 = không có)
create or replace function public.vt__promo(p_user uuid) returns jsonb
language plpgsql set search_path = public as $$
declare u vt_users; cfg vt_config;
begin
  select * into cfg from vt_config where id = 1;
  select * into u from vt_users where id = p_user;
  if cfg.promo_percent <= 0 or exists (select 1 from vt_orders where user_id = u.id and status = 'paid') then
    return jsonb_build_object('percent', 0);
  end if;
  if u.promo_until is null and u.trial_given > 0 and u.credits <= 0 and not coalesce(u.unlimited_until > now(), false) then
    update vt_users set promo_until = now() + make_interval(hours => greatest(1, cfg.promo_hours)) where id = u.id returning * into u;
  end if;
  if u.promo_until is not null and u.promo_until > now() then
    return jsonb_build_object('percent', cfg.promo_percent, 'until', u.promo_until);
  end if;
  return jsonb_build_object('percent', 0);
end $$;
revoke all on function public.vt__promo(uuid) from public, anon, authenticated;

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
    'promo', vt__promo(u.id),
    'ref', jsonb_build_object('code', u.ref_code, 'bonus', cfg.ref_bonus,
      'invited', (select count(*) from vt_users x where x.referred_by = u.id),
      'rewarded', (select count(*) from vt_users x where x.referred_by = u.id and x.ref_rewarded)));
end $$;

create or replace function public.vt_create_order(p_token text, p_package text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; p vt_packages; o vt_orders; cfg vt_config; c text; i int := 0; pr jsonb; amt int; nm text;
begin
  u := vt__user(p_token);
  select * into cfg from vt_config where id = 1;
  select * into p from vt_packages where id = p_package and active;
  if not found then perform vt__err('Gói này không còn bán, chọn gói khác', 'INPUT'); end if;
  if btrim(cfg.bank_account) = '' then perform vt__err('Chưa cài tài khoản nhận tiền, liên hệ hỗ trợ', 'CONFIG'); end if;
  pr := vt__promo(u.id);
  amt := p.price_vnd; nm := p.name;
  if (pr->>'percent')::int > 0 then
    amt := greatest(1000, (round(p.price_vnd * (100 - (pr->>'percent')::int) / 100.0 / 1000) * 1000)::int);
    nm := p.name || ' (ưu đãi -' || (pr->>'percent') || '%)';
  end if;
  select * into o from vt_orders where user_id = u.id and package_id = p.id and status = 'pending'
    and amount = amt and created_at > now() - interval '24 hours' order by created_at desc limit 1;
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
    values (c, u.id, p.id, nm, amt, p.credits, p.days) returning * into o;
  end if;
  return jsonb_build_object('order', vt__order_json(o), 'bank', vt__bank());
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
    trial_guard = coalesce((p->>'trial_guard')::boolean, trial_guard),
    promo_percent = least(90, greatest(0, coalesce((p->>'promo_percent')::int, promo_percent))),
    promo_hours = least(720, greatest(1, coalesce((p->>'promo_hours')::int, promo_hours))),
    webhook_key_hash = case when length(coalesce(p->>'webhook_key', '')) >= 8 then extensions.digest(p->>'webhook_key', 'sha256') else webhook_key_hash end,
    admin_key_hash = case when length(coalesce(p->>'new_admin_key', '')) >= 10 then extensions.digest(p->>'new_admin_key', 'sha256') else admin_key_hash end,
    updated_at = now()
  where id = 1;
  return vt_admin_settings(coalesce(case when length(coalesce(p->>'new_admin_key', '')) >= 10 then p->>'new_admin_key' end, p_key));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('vt_me', 'vt_create_order', 'vt_admin_save_config') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
