-- 28/11/2026 21:10 (Giang chốt cách B): mỗi vị trí được 2 LẦN tạo giọng trong 24 giờ; mỗi lần: đọc trong 2 phút đầu (đọc cả bài),
-- sau đó thêm tối đa 500 ký tự để sửa câu (2 lần = 1.000). Xuất video xong thì lần đang có khép lại (lần sửa sau tính sang lần 2).
-- Đọc quá phần sửa còn lại → tự tính sang lần 2 nếu còn. Lỗi giọng → máy chủ gọi vt_tts_refund (khoá cron) để không tính.
-- Chạy SAU vt_tts_limit.sql. Chỉ THÊM / thay hàm. Công tắc vẫn là vt_config.tts_limit_mode ('off' | 'test' | 'on').
-- Tắt khẩn cấp:  update vt_config set tts_limit_mode = 'off' where id = 1;
-- Mở lại cho 1 khách:  delete from vt_tts_burst where user_id = '<id>';

alter table public.vt_tts_burst add column if not exists fix_used integer not null default 0;

create table if not exists public.vt_tts_call (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.vt_users(id) on delete cascade,
  burst_id bigint references public.vt_tts_burst(id) on delete set null,
  usage_id bigint,
  fix_chars integer not null default 0,
  refunded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists vt_tts_call_burst_idx on public.vt_tts_call (burst_id);
alter table public.vt_tts_call enable row level security;
revoke all on table public.vt_tts_call from public, anon, authenticated;

update public.vt_config set tts_limits = tts_limits || '{"moi_can":2,"sua_ky_tu":500}'::jsonb where id = 1;

-- Quyết định cho 1 lượt gọi giọng: {"msg": ...} = chặn · {"burst": id, "fix": n} = thuộc lần đang có · {"burst": null} = mở lần mới
create or replace function public.vt__tts_plan(p_user public.vt_users, p_cfg public.vt_config, p_chars integer, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare grp text; ten text; max_lan int; max_kt int; max_can int; max_sua int; n int; need int := greatest(coalesce(p_chars, 0), 0);
  cur vt_tts_burst; closed boolean := false; con int := 0; mo_lai timestamptz;
begin
  if coalesce(p_user.unlimited_until > now(), false) then grp := 'khong_gioi_han'; ten := 'Gói không giới hạn';
  elsif exists (select 1 from vt_orders where user_id = p_user.id and status = 'paid') then grp := 'goi'; ten := 'Gói của anh/chị';
  else grp := 'thu'; ten := 'Bản dùng thử'; end if;
  max_lan := coalesce((p_cfg.tts_limits -> grp ->> 'lan')::int, 0);
  max_kt := coalesce((p_cfg.tts_limits -> grp ->> 'ky_tu')::int, 0);
  max_can := coalesce((p_cfg.tts_limits ->> 'moi_can')::int, 0);
  max_sua := coalesce((p_cfg.tts_limits ->> 'sua_ky_tu')::int, 0);

  if max_kt > 0 then
    select coalesce(sum(chars), 0) into n from vt_usage where user_id = p_user.id and kind = 'tts' and created_at > now() - interval '1 day';
    if n + need > max_kt then
      return jsonb_build_object('msg', ten || ' tạo giọng tối đa ' || replace(to_char(max_kt, 'FM999,999'), ',', '.') || ' ký tự trong 24 giờ. Giọng đã tạo vẫn dùng được, câu mới anh/chị thử lại sau nhé.');
    end if;
  end if;

  select * into cur from vt_tts_burst
    where user_id = p_user.id and created_at > now() - interval '1 day'
      and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3
    order by created_at desc, id desc limit 1;
  if cur.id is not null then
    closed := exists (select 1 from vt_usage where user_id = p_user.id and kind = 'export'
      and note in ('Xuất video', 'Xuất lại miễn phí', 'Gói không giới hạn') and created_at > cur.created_at and lat is not null
      and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3);
    if not closed then
      if cur.created_at > now() - interval '120 seconds' then
        return jsonb_build_object('burst', cur.id, 'fix', 0);
      end if;
      con := greatest(0, max_sua - cur.fix_used);
      if need <= con then
        return jsonb_build_object('burst', cur.id, 'fix', need);
      end if;
    end if;
  end if;

  -- từ đây là mở lần mới
  if max_can > 0 then
    select count(*), min(created_at) + interval '1 day' into n, mo_lai from vt_tts_burst
      where user_id = p_user.id and created_at > now() - interval '1 day'
        and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3;
    if n >= max_can then
      return jsonb_build_object('msg', 'Căn này đã dùng ' || max_can || ' lần tạo giọng trong 24 giờ. '
        || case when con > 0 then 'Anh/chị còn ' || con || ' ký tự để sửa câu, đoạn vừa gửi dài ' || need || ' ký tự: sửa ít câu hơn rồi bấm lại. ' else '' end
        || 'Giọng đã tạo vẫn dùng được; tạo lần mới được từ ' || to_char(mo_lai at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM') || '.');
    end if;
  end if;
  if max_lan > 0 then
    select count(*) into n from vt_tts_burst where user_id = p_user.id and created_at > now() - interval '1 day';
    if n >= max_lan then
      return jsonb_build_object('msg', ten || ' tạo giọng tối đa ' || max_lan || ' lần trong 24 giờ. Giọng đã tạo vẫn dùng được, anh/chị thử tạo thêm sau nhé.');
    end if;
  end if;
  return jsonb_build_object('burst', null);
end $$;
revoke all on function public.vt__tts_plan(public.vt_users, public.vt_config, integer, double precision, double precision) from public, anon, authenticated;

-- Máy chủ báo lỗi giọng: không tính lượt gọi đó (cần khoá máy chủ, khách không tự gọi được)
create or replace function public.vt_tts_refund(p_key text, p_call bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c vt_tts_call;
begin
  perform vt__cron(p_key);
  select * into c from vt_tts_call where id = p_call;
  if not found then return jsonb_build_object('ok', false); end if;
  perform 1 from vt_users where id = c.user_id for update;
  update vt_tts_call set refunded = true where id = p_call and not refunded;
  if not found then return jsonb_build_object('ok', true, 'already', true); end if;
  update vt_usage set chars = 0, note = 'Lỗi giọng, không tính' where id = c.usage_id;
  if c.burst_id is not null then
    if c.fix_chars > 0 then
      update vt_tts_burst set fix_used = greatest(0, fix_used - c.fix_chars) where id = c.burst_id;
    end if;
    -- cả lần đó không có câu nào đọc được → bỏ luôn lần đó
    delete from vt_tts_burst b where b.id = c.burst_id and not exists (select 1 from vt_tts_call where burst_id = b.id and not refunded);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.vt_tts_refund(text, bigint) from public, anon, authenticated;
grant execute on function public.vt_tts_refund(text, bigint) to anon, authenticated;

-- App đọc để hiện đúng câu chữ; chỉ có khi đã bật cho mọi khách
create or replace function public.vt_public_info() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'trial_credits', (select trial_credits from vt_config where id = 1),
    'reexport_hours', (select reexport_hours from vt_config where id = 1),
    'redo_exports', (select redo_exports from vt_config where id = 1),
    'redo_tts', (select redo_tts from vt_config where id = 1),
    'voice_limit', (select case when tts_limit_mode = 'on' then jsonb_build_object('moi_can', (tts_limits ->> 'moi_can')::int, 'sua_ky_tu', (tts_limits ->> 'sua_ky_tu')::int) end from vt_config where id = 1),
    'ref_bonus', (select ref_bonus from vt_config where id = 1),
    'bank', vt__bank(),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description,
        'price', price_vnd, 'credits', credits, 'days', days, 'highlight', highlight) order by sort, price_vnd)
      from vt_packages where active), '[]'::jsonb))
$$;

-- vt_ai_allow: bản vt_tts_limit.sql, đổi phần giới hạn sang vt__tts_plan + ghi vt_tts_call
create or replace function public.vt_ai_allow(p_token text, p_kind text, p_chars integer, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; n int; n2 int; k text := case when p_kind = 'script' then 'script' else 'tts' end; v_charged boolean := false; r record; v_lim boolean := false; v_plan jsonb; v_burst bigint; v_fix int; v_usage bigint; v_call bigint;
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
    -- giới hạn số lần / ký tự tạo giọng 24 giờ (công tắc tts_limit_mode). Kiểm TRƯỚC mọi chỗ trừ lượt.
    v_lim := (cfg.tts_limit_mode = 'on' and not coalesce(u.no_limits, false))
          or (cfg.tts_limit_mode = 'test' and coalesce(u.no_limits, false));
    if v_lim then
      v_plan := vt__tts_plan(u, cfg, p_chars, p_lat, p_lng);
      if v_plan ? 'msg' then
        return jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT', 'message', v_plan ->> 'msg');
      end if;
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
  insert into vt_usage (user_id, kind, chars, lat, lng) values (u.id, k, greatest(coalesce(p_chars, 0), 0), p_lat, p_lng) returning id into v_usage;
  if v_lim then
    -- ghi theo kế hoạch: mở lần mới, hoặc cộng vào phần sửa câu của lần đang có (các câu gọi cùng lúc được khoá dòng vt_users xếp hàng)
    v_burst := (v_plan ->> 'burst')::bigint;
    v_fix := coalesce((v_plan ->> 'fix')::int, 0);
    if v_burst is null then
      insert into vt_tts_burst (user_id, lat, lng) values (u.id, p_lat, p_lng) returning id into v_burst;
    elsif v_fix > 0 then
      update vt_tts_burst set fix_used = fix_used + v_fix where id = v_burst;
    end if;
    insert into vt_tts_call (user_id, burst_id, usage_id, fix_chars) values (u.id, v_burst, v_usage, v_fix) returning id into v_call;
  end if;
  return jsonb_build_object('ok', true, 'charged', v_charged, 'tts_call', v_call);
end $$;

-- bản cũ không còn dùng
drop function if exists public.vt__tts_limit_msg(public.vt_users, public.vt_config, integer, double precision, double precision);
