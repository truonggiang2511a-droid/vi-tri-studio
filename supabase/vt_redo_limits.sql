-- Giới hạn làm lại cho mỗi căn (10/2026)
-- Trước: trong 24 giờ sau khi trừ lượt, xuất lại + tạo giọng AI ở cùng vị trí KHÔNG giới hạn → tốn chi phí giọng đọc.
-- Nay: mỗi lượt = 1 căn, trong reexport_hours được tối đa redo_exports lần xuất (tính cả lần đầu)
--      và redo_tts lần tạo giọng AI. Dùng hết thì lần sau trừ thêm 1 lượt và mở gói mới.
-- Không đụng tới thanh toán (vt_payment_in, vt__apply_order) và bảng tiền.

alter table public.vt_config
  add column if not exists redo_exports int not null default 3,
  add column if not exists redo_tts int not null default 3;

-- Còn bao nhiêu lần xuất / tạo giọng miễn phí cho vị trí này (tính từ lần trừ lượt gần nhất)
-- Một lần bấm "Tạo giọng" có thể gọi máy chủ 2–3 lần (kịch bản dài chia nhóm) → gộp theo khung 2 phút.
create or replace function public.vt__redo_left(p_user uuid, p_lat double precision, p_lng double precision,
  out last timestamptz, out exports_left int, out tts_left int)
language plpgsql stable set search_path = public, extensions as $$
declare cfg vt_config; ne int; nt int;
begin
  select * into cfg from vt_config where id = 1;
  last := vt__recent_export(p_user, p_lat, p_lng);
  if last is null then exports_left := 0; tts_left := 0; return; end if;
  select count(*) filter (where kind = 'export' and note in ('Xuất lại miễn phí', 'Xuất video', 'Gói không giới hạn')),
         count(distinct floor(extract(epoch from created_at) / 120)) filter (where kind = 'tts')
    into ne, nt
  from vt_usage
  where user_id = p_user and created_at >= last and lat is not null
    and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3;
  exports_left := greatest(0, cfg.redo_exports - ne);
  tts_left := greatest(0, cfg.redo_tts - nt);
end $$;

create or replace function public.vt__redo_json(p_user uuid, p_lat double precision, p_lng double precision) returns jsonb
language sql stable set search_path = public, extensions as $$
  select case when r.last is null then null else jsonb_build_object('exports_left', r.exports_left, 'tts_left', r.tts_left,
    'until', r.last + make_interval(hours => (select reexport_hours from vt_config where id = 1))) end
  from vt__redo_left(p_user, p_lat, p_lng) r
$$;

create or replace function public.vt_export_begin(p_token text, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; r record; n int;
begin
  u := vt__user(p_token, true);
  select * into cfg from vt_config where id = 1;
  select * into r from vt__redo_left(u.id, p_lat, p_lng);
  if r.last is not null and r.exports_left > 0 then
    insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 0, false, p_lat, p_lng, 'Xuất lại miễn phí');
    return jsonb_build_object('ok', true, 'charged', false, 'mode', 'reexport',
      'until', r.last + make_interval(hours => cfg.reexport_hours), 'profile', vt__profile(u), 'redo', vt__redo_json(u.id, p_lat, p_lng));
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
      'until', now() + make_interval(hours => cfg.reexport_hours), 'profile', vt__profile(u), 'redo', vt__redo_json(u.id, p_lat, p_lng));
  end if;
  if u.credits <= 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_CREDIT', 'profile', vt__profile(u),
      'message', case when r.last is not null
        then 'Căn này đã dùng hết ' || cfg.redo_exports || ' lần xuất của lượt trước. Mua thêm lượt để xuất tiếp.'
        else 'Anh/chị đã dùng hết lượt. Mua thêm lượt để xuất tiếp.' end);
  end if;
  update vt_users set credits = credits - 1 where id = u.id returning * into u;
  insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 1, true, p_lat, p_lng, 'Xuất video');
  perform vt__ref_reward(u.id);
  return jsonb_build_object('ok', true, 'charged', true, 'mode', 'credit',
    'until', now() + make_interval(hours => cfg.reexport_hours), 'profile', vt__profile(u), 'redo', vt__redo_json(u.id, p_lat, p_lng));
end $$;

create or replace function public.vt_ai_allow(p_token text, p_kind text, p_chars integer, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; n int; k text := case when p_kind = 'script' then 'script' else 'tts' end; v_charged boolean := false; r record;
begin
  u := vt__user(p_token, true);
  select * into cfg from vt_config where id = 1;
  select coalesce(sum(chars), 0) into n from vt_usage where user_id = u.id and kind = k and created_at > now() - interval '1 day';
  if n + greatest(coalesce(p_chars, 0), 0) > cfg.tts_daily_chars then
    return jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT', 'message', 'Đã dùng hết hạn mức AI trong 24 giờ qua. Thử lại sau nhé.');
  end if;
  if k = 'tts' then
    if p_lat is null or p_lng is null then
      return jsonb_build_object('ok', false, 'code', 'NO_LOCATION', 'message', 'Thiếu vị trí căn nhà, tải lại trang rồi thử lại.');
    end if;
    select * into r from vt__redo_left(u.id, p_lat, p_lng);
    -- Lần gọi này thuộc cùng một lần bấm (trong 2 phút) thì không tính thêm
    if r.last is not null and r.tts_left <= 0 and exists (select 1 from vt_usage where user_id = u.id and kind = 'tts'
         and floor(extract(epoch from created_at) / 120) = floor(extract(epoch from now()) / 120)
         and created_at >= r.last and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3) then
      r.tts_left := 1;
    end if;
    if r.last is null or r.tts_left <= 0 then
      if coalesce(u.unlimited_until > now(), false) then
        select count(*) into n from vt_usage where user_id = u.id and kind = 'export' and vt_usage.charged and created_at >= vt__today_start();
        if n >= cfg.unlimited_daily_exports then
          return jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT', 'message', 'Gói không giới hạn cho tối đa ' || cfg.unlimited_daily_exports || ' căn mỗi ngày. Mai dùng tiếp nhé.');
        end if;
        insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 0, true, p_lat, p_lng, 'Tạo giọng đọc (gói không giới hạn)');
      else
        if u.credits <= 0 then
          return jsonb_build_object('ok', false, 'code', 'NO_CREDIT', 'message', case when r.last is not null
            then 'Căn này đã tạo giọng ' || cfg.redo_tts || ' lần của lượt trước. Mua thêm lượt để tạo lại giọng.'
            else 'Anh/chị đã hết lượt. Mua thêm lượt để tạo giọng đọc AI.' end);
        end if;
        update vt_users set credits = credits - 1 where id = u.id;
        insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 1, true, p_lat, p_lng, 'Tạo giọng đọc (tính 1 lượt cho căn này)');
        v_charged := true;
      end if;
    end if;
  elsif not (coalesce(u.unlimited_until > now(), false) or u.credits > 0 or vt__recent_export(u.id, p_lat, p_lng) is not null) then
    return jsonb_build_object('ok', false, 'code', 'NO_CREDIT', 'message', 'Anh/chị đã hết lượt. Mua thêm lượt để dùng AI.');
  end if;
  insert into vt_usage (user_id, kind, chars, lat, lng) values (u.id, k, greatest(coalesce(p_chars, 0), 0), p_lat, p_lng);
  return jsonb_build_object('ok', true, 'charged', v_charged);
end $$;

-- vt_me trả thêm số lần còn lại ở vị trí đang mở
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
    'redo', vt__redo_json(u.id, p_lat, p_lng),
    'pending', case when o.id is null then null else vt__order_json(o) end,
    'promo', vt__promo(u.id),
    'leads_new', (select count(*) from vt_leads l where l.user_id = u.id and l.status = 'moi'),
    'tg_linked', u.tg_chat is not null,
    'ref', jsonb_build_object('code', u.ref_code, 'bonus', cfg.ref_bonus,
      'invited', (select count(*) from vt_users x where x.referred_by = u.id),
      'rewarded', (select count(*) from vt_users x where x.referred_by = u.id and x.ref_rewarded)));
end $$;

create or replace function public.vt_public_info() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'trial_credits', (select trial_credits from vt_config where id = 1),
    'reexport_hours', (select reexport_hours from vt_config where id = 1),
    'redo_exports', (select redo_exports from vt_config where id = 1),
    'redo_tts', (select redo_tts from vt_config where id = 1),
    'ref_bonus', (select ref_bonus from vt_config where id = 1),
    'bank', vt__bank(),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description,
        'price', price_vnd, 'credits', credits, 'days', days, 'highlight', highlight) order by sort, price_vnd)
      from vt_packages where active), '[]'::jsonb))
$$;

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
    redo_exports = least(20, greatest(1, coalesce((p->>'redo_exports')::int, redo_exports))),
    redo_tts = least(20, greatest(1, coalesce((p->>'redo_tts')::int, redo_tts))),
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

-- Hàm nội bộ: không cho gọi trực tiếp từ trình duyệt
revoke all on function public.vt__redo_left(uuid, double precision, double precision) from public, anon, authenticated;
revoke all on function public.vt__redo_json(uuid, double precision, double precision) from public, anon, authenticated;
