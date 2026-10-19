-- Vị Trí Studio — chặn lấy lượt dùng thử nhiều lần trên cùng một máy.
-- Mỗi máy có mã thiết bị (lưu trong trình duyệt) + dấu vân tay máy (cấu hình máy, không phải thông tin cá nhân).
-- Đăng ký mới trên máy đã từng nhận lượt dùng thử: vẫn tạo được tài khoản nhưng không được tặng lượt (phải mua gói).
-- Chạy lại nhiều lần vẫn an toàn.

alter table public.vt_config add column if not exists trial_guard boolean not null default true;
alter table public.vt_users add column if not exists device_id text;
alter table public.vt_users add column if not exists fp text;
alter table public.vt_users add column if not exists trial_given int not null default 0;
create index if not exists vt_users_device_idx on public.vt_users (device_id);
create index if not exists vt_users_fp_idx on public.vt_users (fp, signup_ip);

-- Tài khoản cũ coi như đã nhận lượt dùng thử
update public.vt_users u set trial_given = 1
where trial_given = 0 and exists (select 1 from public.vt_usage g where g.user_id = u.id and g.note = 'Tặng lượt dùng thử');

create or replace function public.vt_signup2(p_login text, p_password text, p_name text default '', p_ref text default null,
  p_device text default null, p_fp text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare cfg vt_config; lg text; ip text := vt__ip(); u vt_users; n int; inviter uuid; bonus int := 0; trial int; blocked boolean := false;
  dev text := left(nullif(btrim(coalesce(p_device, '')), ''), 64); f text := left(nullif(btrim(coalesce(p_fp, '')), ''), 64);
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
  -- Máy này đã nhận lượt dùng thử chưa: cùng mã thiết bị, hoặc cùng cấu hình máy + cùng mạng trong 30 ngày
  if cfg.trial_guard then
    blocked := (dev is not null and exists (select 1 from vt_users where device_id = dev and trial_given > 0))
      or (f is not null and ip is not null and exists (select 1 from vt_users where fp = f and signup_ip = ip
            and trial_given > 0 and created_at > now() - interval '30 days'));
  end if;
  trial := case when blocked then 0 else cfg.trial_credits end;
  if not blocked and nullif(btrim(coalesce(p_ref, '')), '') is not null and cfg.ref_bonus > 0 then
    select id into inviter from vt_users where ref_code = lower(btrim(p_ref)) and status = 'active';
    if inviter is not null then bonus := cfg.ref_bonus; end if;
  end if;
  begin
    insert into vt_users (login, name, pass_hash, credits, signup_ip, ref_code, referred_by, device_id, fp, trial_given)
    values (lg, left(btrim(coalesce(p_name, '')), 60), crypt(p_password, gen_salt('bf', 10)), trial + bonus, ip,
      vt__ref_code(), inviter, dev, f, case when trial > 0 then 1 else 0 end)
    returning * into u;
  exception when unique_violation then
    perform vt__err('Số điện thoại hoặc email này đã có tài khoản, mời đăng nhập', 'EXISTS');
  end;
  if trial > 0 then
    insert into vt_usage (user_id, kind, credits, note) values (u.id, 'grant', trial, 'Tặng lượt dùng thử');
  end if;
  if bonus > 0 then
    insert into vt_usage (user_id, kind, credits, note) values (u.id, 'grant', bonus, 'Thưởng đăng ký qua link giới thiệu');
  end if;
  return jsonb_build_object('token', vt__new_session(u.id), 'profile', vt__profile(u), 'ref_bonus', bonus, 'trial_blocked', blocked);
end $$;

-- Ghi mã thiết bị cho tài khoản đăng nhập (để máy đã dùng thử bằng tài khoản cũ cũng được nhận ra)
create or replace function public.vt_set_device(p_token text, p_device text, p_fp text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  update vt_users set device_id = coalesce(device_id, left(nullif(btrim(coalesce(p_device, '')), ''), 64)),
    fp = coalesce(fp, left(nullif(btrim(coalesce(p_fp, '')), ''), 64))
  where id = u.id;
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
    webhook_key_hash = case when length(coalesce(p->>'webhook_key', '')) >= 8 then extensions.digest(p->>'webhook_key', 'sha256') else webhook_key_hash end,
    admin_key_hash = case when length(coalesce(p->>'new_admin_key', '')) >= 10 then extensions.digest(p->>'new_admin_key', 'sha256') else admin_key_hash end,
    updated_at = now()
  where id = 1;
  return vt_admin_settings(coalesce(case when length(coalesce(p->>'new_admin_key', '')) >= 10 then p->>'new_admin_key' end, p_key));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('vt_signup2', 'vt_set_device', 'vt_admin_save_config') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;

-- Hàm đăng ký cũ không kiểm tra thiết bị: đóng lại để không ai gọi thẳng vượt rào
revoke execute on function public.vt_register(text, text, text) from anon, authenticated;
revoke execute on function public.vt_signup(text, text, text, text) from anon, authenticated;
