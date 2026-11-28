-- 28/11/2026 (Giang duyệt "làm giới hạn"): giới hạn tạo giọng trong 24 giờ. Chỉ THÊM; không sửa dữ liệu cũ, không xoá cột.
-- "1 lần" = các lượt gọi giọng cho cùng 1 căn trong 2 phút kể từ lượt gọi đầu (bảng vt_tts_burst).
-- Công tắc vt_config.tts_limit_mode: 'off' = y như cũ (mặc định) · 'test' = chỉ tài khoản no_limits (để thử) · 'on' = mọi khách (trừ no_limits).
-- Tắt khẩn cấp:  update vt_config set tts_limit_mode = 'off' where id = 1;
-- Đổi số:        sửa vt_config.tts_limits (moi_can = 0 là bỏ giới hạn theo căn).
-- Mở lại cho 1 khách bị chặn:  delete from vt_tts_burst where user_id = '<id>';  (giới hạn ký tự tính theo vt_usage, không bị xoá)
-- Khoá Vbee riêng của khách không đi qua vt_ai_allow nên không bị tính.
-- Không đụng: vt_payment_in, vt__apply_order, vt_orders (chỉ đọc), bảng/hàm của bot EA.

alter table public.vt_config add column if not exists tts_limit_mode text not null default 'off';
alter table public.vt_config add column if not exists tts_limits jsonb not null default
  '{"thu":{"lan":6,"ky_tu":8000},"goi":{"lan":20,"ky_tu":20000},"khong_gioi_han":{"lan":30,"ky_tu":20000},"moi_can":6}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vt_config_tts_limit_mode_chk') then
    alter table public.vt_config add constraint vt_config_tts_limit_mode_chk check (tts_limit_mode in ('off', 'test', 'on'));
  end if;
end $$;

create table if not exists public.vt_tts_burst (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.vt_users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists vt_tts_burst_user_idx on public.vt_tts_burst (user_id, created_at desc);
alter table public.vt_tts_burst enable row level security;
revoke all on table public.vt_tts_burst from public, anon, authenticated;

-- Trả câu báo nếu vượt giới hạn, null = được tạo
create or replace function public.vt__tts_limit_msg(p_user public.vt_users, p_cfg public.vt_config, p_chars integer, p_lat double precision, p_lng double precision) returns text
language plpgsql stable set search_path = public, extensions as $$
declare grp text; ten text; max_lan int; max_kt int; max_can int; n int; last_export timestamptz;
begin
  if coalesce(p_user.unlimited_until > now(), false) then grp := 'khong_gioi_han'; ten := 'Gói không giới hạn';
  elsif exists (select 1 from vt_orders where user_id = p_user.id and status = 'paid') then grp := 'goi'; ten := 'Gói của anh/chị';
  else grp := 'thu'; ten := 'Bản dùng thử'; end if;
  max_lan := coalesce((p_cfg.tts_limits -> grp ->> 'lan')::int, 0);
  max_kt := coalesce((p_cfg.tts_limits -> grp ->> 'ky_tu')::int, 0);
  max_can := coalesce((p_cfg.tts_limits ->> 'moi_can')::int, 0);

  if max_kt > 0 then
    select coalesce(sum(chars), 0) into n from vt_usage where user_id = p_user.id and kind = 'tts' and created_at > now() - interval '1 day';
    if n + greatest(coalesce(p_chars, 0), 0) > max_kt then
      return ten || ' tạo giọng tối đa ' || replace(to_char(max_kt, 'FM999,999'), ',', '.') || ' ký tự trong 24 giờ. Giọng đã tạo vẫn dùng được, câu mới anh/chị thử lại sau nhé.';
    end if;
  end if;

  -- đang ở giữa 1 lần của căn này thì không đếm thêm (không cắt ngang bài đang đọc)
  if exists (select 1 from vt_tts_burst where user_id = p_user.id and created_at > now() - interval '120 seconds'
       and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3) then
    return null;
  end if;

  if max_lan > 0 then
    select count(*) into n from vt_tts_burst where user_id = p_user.id and created_at > now() - interval '1 day';
    if n >= max_lan then
      return ten || ' tạo giọng tối đa ' || max_lan || ' lần trong 24 giờ. Giọng đã tạo vẫn dùng được, anh/chị thử tạo thêm sau nhé.';
    end if;
  end if;

  if max_can > 0 then
    -- đếm lại từ đầu sau mỗi lần căn này xuất video
    select max(created_at) into last_export from vt_usage
      where user_id = p_user.id and kind = 'export' and note in ('Xuất video', 'Xuất lại miễn phí', 'Gói không giới hạn')
        and created_at > now() - interval '1 day' and lat is not null
        and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3;
    select count(*) into n from vt_tts_burst
      where user_id = p_user.id and created_at > now() - interval '1 day' and (last_export is null or created_at > last_export)
        and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3;
    if n >= max_can then
      return 'Căn này đã tạo giọng ' || max_can || ' lần mà chưa xuất video. Anh/chị xuất video căn này rồi tạo tiếp, hoặc thử lại sau 24 giờ.';
    end if;
  end if;
  return null;
end $$;
revoke all on function public.vt__tts_limit_msg(public.vt_users, public.vt_config, integer, double precision, double precision) from public, anon, authenticated;

-- vt_ai_allow: y bản 25/11 (vt_export_commit.sql), CHỈ thêm 2 đoạn giới hạn (v_lim)
create or replace function public.vt_ai_allow(p_token text, p_kind text, p_chars integer, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; n int; n2 int; k text := case when p_kind = 'script' then 'script' else 'tts' end; v_charged boolean := false; r record; v_lim boolean := false; v_msg text;
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
      v_msg := vt__tts_limit_msg(u, cfg, p_chars, p_lat, p_lng);
      if v_msg is not null then
        return jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT', 'message', v_msg);
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
  insert into vt_usage (user_id, kind, chars, lat, lng) values (u.id, k, greatest(coalesce(p_chars, 0), 0), p_lat, p_lng);
  -- mở "1 lần" mới nếu căn này chưa có lần nào bắt đầu trong 2 phút qua (các câu gọi cùng lúc được khoá dòng vt_users xếp hàng)
  if v_lim and not exists (select 1 from vt_tts_burst where user_id = u.id and created_at > now() - interval '120 seconds'
       and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3) then
    insert into vt_tts_burst (user_id, lat, lng) values (u.id, p_lat, p_lng);
  end if;
  return jsonb_build_object('ok', true, 'charged', v_charged);
end $$;
