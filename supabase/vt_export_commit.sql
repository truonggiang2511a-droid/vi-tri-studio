-- 25/11/2026 (Giang duyệt): CHỈ trừ 1 lượt khi video xuất XONG (giọng đọc đã nằm trong lượt đó).
-- Cách làm: giữ chỗ lúc bấm xuất (vt_export_start), app báo "xong" (vt_export_done) mới trừ; lỗi / huỷ báo vt_export_abort.
-- KHÔNG sửa dữ liệu cũ, KHÔNG xoá cột. Công tắc vt_config.charge_mode: 'off' = y như cũ (mặc định) · 'test' = chỉ tài khoản no_limits · 'on' = mọi khách.
-- Hàm cũ vt_export_begin KHÔNG đổi (tab cũ khách còn mở vẫn chạy). vt_ai_allow chỉ thêm nhánh kiểu mới (không trừ lượt lúc tạo giọng).
-- Tắt khẩn cấp:  update vt_config set charge_mode = 'off' where id = 1;
-- Không đụng: vt_payment_in, vt__apply_order, vt_orders, bảng/hàm của bot EA.

alter table public.vt_config add column if not exists charge_mode text not null default 'off';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vt_config_charge_mode_chk') then
    alter table public.vt_config add constraint vt_config_charge_mode_chk check (charge_mode in ('off', 'test', 'on'));
  end if;
end $$;

create table if not exists public.vt_export_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.vt_users(id) on delete cascade,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  aborted_at timestamptz,
  result text
);
create index if not exists vt_export_pending_user_idx on public.vt_export_pending (user_id, created_at desc);
alter table public.vt_export_pending enable row level security;
revoke all on table public.vt_export_pending from public, anon, authenticated;

-- Kiểu trừ mới có áp cho tài khoản này không
create or replace function public.vt__charge_new(p_user public.vt_users, p_cfg public.vt_config) returns boolean
language sql stable set search_path = public, extensions as $$
  select p_cfg.charge_mode = 'on' or (p_cfg.charge_mode = 'test' and coalesce(p_user.no_limits, false))
$$;

-- Bắt đầu xuất: chỉ KIỂM TRA + giữ chỗ, chưa trừ lượt. Công tắc tắt → chạy đúng hàm cũ.
create or replace function public.vt_export_start(p_token text, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; r record; n int; pid uuid; v_mode text;
begin
  u := vt__user(p_token, true);
  select * into cfg from vt_config where id = 1;
  if not vt__charge_new(u, cfg) then
    return vt_export_begin(p_token, p_lat, p_lng) || jsonb_build_object('legacy', true);
  end if;
  if p_lat is null or p_lng is null then
    return jsonb_build_object('ok', false, 'code', 'NO_LOCATION', 'profile', vt__profile(u), 'message', 'Thiếu vị trí căn nhà, tải lại trang rồi thử lại.');
  end if;
  -- chống né báo "xong": tối đa 3 lượt giữ chỗ chưa xong / chưa huỷ trong 2 giờ
  select count(*) into n from vt_export_pending
    where user_id = u.id and done_at is null and aborted_at is null and created_at > now() - interval '2 hours';
  if n >= 3 and not coalesce(u.no_limits, false) then
    return jsonb_build_object('ok', false, 'code', 'PENDING_LIMIT', 'profile', vt__profile(u),
      'message', 'Có 3 lượt xuất chưa hoàn tất trong 2 giờ qua. Đợi vài phút rồi thử lại, hoặc bấm Hỗ trợ để được giúp.');
  end if;
  select * into r from vt__redo_left(u.id, p_lat, p_lng);
  if r.last is not null and r.exports_left > 0 then
    v_mode := 'reexport';
  elsif u.unlimited_until > now() then
    select count(*) into n from vt_usage where user_id = u.id and kind = 'export' and charged and created_at >= vt__today_start();
    if not coalesce(u.no_limits, false) and n >= cfg.unlimited_daily_exports then
      return jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT', 'profile', vt__profile(u),
        'message', 'Gói không giới hạn cho tối đa ' || cfg.unlimited_daily_exports || ' video mỗi ngày. Mai dùng tiếp nhé.');
    end if;
    v_mode := 'unlimited';
  elsif u.credits <= 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_CREDIT', 'profile', vt__profile(u),
      'message', case when r.last is not null
        then 'Căn này đã dùng hết ' || cfg.redo_exports || ' lần xuất của lượt trước. Mua thêm lượt để xuất tiếp.'
        else 'Anh/chị đã dùng hết lượt. Mua thêm lượt để xuất tiếp.' end);
  else
    v_mode := 'credit';
  end if;
  insert into vt_export_pending (user_id, lat, lng) values (u.id, p_lat, p_lng) returning id into pid;
  return jsonb_build_object('ok', true, 'charged', false, 'pending', true, 'export_id', pid, 'mode', v_mode,
    'would_charge', v_mode in ('credit', 'unlimited'),
    'until', coalesce(r.last, now()) + make_interval(hours => cfg.reexport_hours),
    'profile', vt__profile(u), 'redo', vt__redo_json(u.id, p_lat, p_lng));
end $$;

-- Xuất XONG: tính lượt thật (gọi lại nhiều lần vẫn chỉ tính 1 lần)
create or replace function public.vt_export_done(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; p vt_export_pending; r record; v_mode text; v_charged boolean := false;
begin
  u := vt__user(p_token, true);
  select * into p from vt_export_pending where id = p_id and user_id = u.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'profile', vt__profile(u), 'message', 'Không tìm thấy lượt xuất này.');
  end if;
  select * into cfg from vt_config where id = 1;
  if p.done_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'charged', false, 'mode', p.result, 'profile', vt__profile(u),
      'redo', vt__redo_json(u.id, p.lat, p.lng));
  end if;
  -- quyết định tính lượt THEO LÚC XONG (2 tab cùng xuất 1 căn thì tab sau là xuất lại, không trừ 2 lần)
  select * into r from vt__redo_left(u.id, p.lat, p.lng);
  if r.last is not null and r.exports_left > 0 then
    insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 0, false, p.lat, p.lng, 'Xuất lại miễn phí');
    v_mode := 'reexport';
  elsif u.unlimited_until > now() then
    insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 0, true, p.lat, p.lng, 'Gói không giới hạn');
    perform vt__ref_reward(u.id);
    v_mode := 'unlimited';
  elsif u.credits > 0 then
    update vt_users set credits = credits - 1 where id = u.id returning * into u;
    insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 1, true, p.lat, p.lng, 'Xuất video');
    perform vt__ref_reward(u.id);
    v_mode := 'credit'; v_charged := true;
  else
    -- hết lượt giữa chừng (vd. hai tab): khách đã có file, không để lượt âm
    insert into vt_usage (user_id, kind, credits, charged, lat, lng, note) values (u.id, 'export', 0, false, p.lat, p.lng, 'Xuất video (hết lượt, không trừ)');
    v_mode := 'free';
  end if;
  update vt_export_pending set done_at = now(), aborted_at = null, result = v_mode where id = p.id;
  return jsonb_build_object('ok', true, 'charged', v_charged, 'mode', v_mode, 'profile', vt__profile(u),
    'until', now() + make_interval(hours => cfg.reexport_hours), 'redo', vt__redo_json(u.id, p.lat, p.lng));
end $$;

-- Xuất lỗi / khách huỷ / văng trang: bỏ giữ chỗ, không tính lượt
create or replace function public.vt_export_abort(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users;
begin
  u := vt__user(p_token);
  update vt_export_pending set aborted_at = now(), result = 'abort'
    where id = p_id and user_id = u.id and done_at is null and aborted_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- Tạo giọng: kiểu mới KHÔNG trừ lượt (lượt tính khi xuất xong). Kiểu cũ giữ nguyên từng chữ.
create or replace function public.vt_ai_allow(p_token text, p_kind text, p_chars integer, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; n int; n2 int; k text := case when p_kind = 'script' then 'script' else 'tts' end; v_charged boolean := false; r record;
begin
  u := vt__user(p_token, true);
  select * into cfg from vt_config where id = 1;
  select coalesce(sum(chars), 0) into n from vt_usage where user_id = u.id and kind = k and created_at > now() - interval '1 day';
  if not u.no_limits and n + greatest(coalesce(p_chars, 0), 0) > cfg.tts_daily_chars then
    return jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT', 'message', 'Đã dùng hết hạn mức AI trong 24 giờ qua. Thử lại sau nhé.');
  end if;
  if k = 'tts' then
    if p_lat is null or p_lng is null then
      return jsonb_build_object('ok', false, 'code', 'NO_LOCATION', 'message', 'Thiếu vị trí căn nhà, tải lại trang rồi thử lại.');
    end if;
    if vt__charge_new(u, cfg) then
      if not (coalesce(u.unlimited_until > now(), false) or u.credits > 0 or vt__recent_export(u.id, p_lat, p_lng) is not null) then
        return jsonb_build_object('ok', false, 'code', 'NO_CREDIT', 'message', 'Anh/chị đã hết lượt. Mua thêm lượt để tạo giọng đọc AI.');
      end if;
      -- chống tạo giọng hàng loạt nhiều căn mà không xuất: tối đa 4 căn khác nhau chưa xuất xong trong 24 giờ
      if not coalesce(u.no_limits, false) and not exists (select 1 from vt_usage where user_id = u.id and kind = 'tts' and lat is not null
           and created_at > now() - interval '1 day' and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3) then
        select count(distinct round(lat::numeric, 3)::text || ',' || round(lng::numeric, 3)::text) into n from vt_usage
          where user_id = u.id and kind = 'tts' and lat is not null and created_at > now() - interval '1 day';
        select count(distinct round(lat::numeric, 3)::text || ',' || round(lng::numeric, 3)::text) into n2 from vt_usage
          where user_id = u.id and kind = 'export' and charged and lat is not null and created_at > now() - interval '1 day';
        if n - n2 >= 4 then
          return jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT', 'message', 'Hôm nay đã tạo giọng cho nhiều căn chưa xuất video. Hãy xuất video các căn đang làm trước nhé.');
        end if;
      end if;
    else
      select * into r from vt__redo_left(u.id, p_lat, p_lng);
      if r.last is not null and r.tts_left <= 0 and exists (select 1 from vt_usage where user_id = u.id and kind = 'tts'
           and floor(extract(epoch from created_at) / 120) = floor(extract(epoch from now()) / 120)
           and created_at >= r.last and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3) then
        r.tts_left := 1;
      end if;
      if r.last is null or r.tts_left <= 0 then
        if coalesce(u.unlimited_until > now(), false) then
          select count(*) into n from vt_usage where user_id = u.id and kind = 'export' and vt_usage.charged and created_at >= vt__today_start();
          if not u.no_limits and n >= cfg.unlimited_daily_exports then
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
    end if;
  elsif not (coalesce(u.unlimited_until > now(), false) or u.credits > 0 or vt__recent_export(u.id, p_lat, p_lng) is not null) then
    return jsonb_build_object('ok', false, 'code', 'NO_CREDIT', 'message', 'Anh/chị đã hết lượt. Mua thêm lượt để dùng AI.');
  end if;
  insert into vt_usage (user_id, kind, chars, lat, lng) values (u.id, k, greatest(coalesce(p_chars, 0), 0), p_lat, p_lng);
  return jsonb_build_object('ok', true, 'charged', v_charged);
end $$;

revoke all on function public.vt__charge_new(public.vt_users, public.vt_config) from public, anon, authenticated;
revoke all on function public.vt_export_start(text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.vt_export_start(text, double precision, double precision) to anon, authenticated;
revoke all on function public.vt_export_done(text, uuid) from public, anon, authenticated;
grant execute on function public.vt_export_done(text, uuid) to anon, authenticated;
revoke all on function public.vt_export_abort(text, uuid) from public, anon, authenticated;
grant execute on function public.vt_export_abort(text, uuid) to anon, authenticated;
