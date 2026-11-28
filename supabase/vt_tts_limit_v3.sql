-- 28/11/2026 21:21 (Giang): mỗi vị trí trong 24 giờ có 2 LẦN ĐỌC CẢ BÀI (không giới hạn riêng số chữ của kịch bản);
-- hết 2 lần mới tới 1.000 ký tự SỬA CÂU (chung cho căn đó, sửa nhiều đợt). App hiện số còn lại qua vt_voice_status.
-- Xuất video xong thì lần đang mở được chốt ngay. Mức theo gói/ngày và công tắc tts_limit_mode giữ nguyên.
-- Chạy SAU vt_tts_limit_v2.sql. vt_ai_allow, vt_tts_refund KHÔNG đổi.

-- mốc câu đọc gần nhất của "lần" đang đọc: bài dài / mạng chậm vẫn đọc trọn trong 1 lần (nghỉ quá 2 phút hoặc quá 10 phút thì khép)
alter table public.vt_tts_burst add column if not exists last_at timestamptz not null default now();

create or replace function public.vt__tts_touch() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.fix_chars = 0 and new.burst_id is not null then   -- câu sửa KHÔNG được mở lại thời gian đọc cả bài
    update vt_tts_burst set last_at = now() where id = new.burst_id;
  end if;
  return new;
end $$;
revoke all on function public.vt__tts_touch() from public, anon, authenticated;
drop trigger if exists vt_tts_call_touch on public.vt_tts_call;
create trigger vt_tts_call_touch after insert on public.vt_tts_call for each row execute function public.vt__tts_touch();

update public.vt_config set tts_limits = tts_limits || '{"moi_can":2,"sua_ky_tu":1000}'::jsonb where id = 1;

-- tình trạng giọng của 1 căn trong 24 giờ
create or replace function public.vt__tts_house(p_user uuid, p_lat double precision, p_lng double precision,
  out so_lan integer, out da_sua integer, out mo_lai timestamptz, out cur_id bigint, out dang_doc boolean)
language plpgsql stable set search_path = public, extensions as $$
declare cur vt_tts_burst;
begin
  select count(*), coalesce(sum(fix_used), 0), min(created_at) + interval '1 day' into so_lan, da_sua, mo_lai from vt_tts_burst
    where user_id = p_user and created_at > now() - interval '1 day'
      and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3;
  select * into cur from vt_tts_burst
    where user_id = p_user and created_at > now() - interval '1 day'
      and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3
    order by created_at desc, id desc limit 1;
  cur_id := cur.id;
  dang_doc := cur.id is not null and cur.last_at > now() - interval '120 seconds' and cur.created_at > now() - interval '10 minutes'
    and not exists (select 1 from vt_usage where user_id = p_user and kind = 'export'
      and note in ('Xuất video', 'Xuất lại miễn phí', 'Gói không giới hạn') and created_at > cur.created_at and lat is not null
      and 111.32 * sqrt(power(lat - p_lat, 2) + power((lng - p_lng) * cos(radians(p_lat)), 2)) < 0.3);
end $$;
revoke all on function public.vt__tts_house(uuid, double precision, double precision) from public, anon, authenticated;

create or replace function public.vt__tts_plan(p_user public.vt_users, p_cfg public.vt_config, p_chars integer, p_lat double precision, p_lng double precision) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare grp text; ten text; max_lan int; max_kt int; max_can int; max_sua int; n int; need int := greatest(coalesce(p_chars, 0), 0);
  h record; con int;
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

  select * into h from vt__tts_house(p_user.id, p_lat, p_lng);
  if h.dang_doc then
    return jsonb_build_object('burst', h.cur_id, 'fix', 0);        -- đang đọc dở cả bài
  end if;

  if max_can <= 0 or h.so_lan < max_can then                       -- còn lần đọc cả bài
    if max_lan > 0 then
      select count(*) into n from vt_tts_burst where user_id = p_user.id and created_at > now() - interval '1 day';
      if n >= max_lan then
        return jsonb_build_object('msg', ten || ' tạo giọng tối đa ' || max_lan || ' lần trong 24 giờ. Giọng đã tạo vẫn dùng được, anh/chị thử tạo thêm sau nhé.');
      end if;
    end if;
    return jsonb_build_object('burst', null);
  end if;

  con := greatest(0, max_sua - h.da_sua);                          -- hết lần đọc cả bài → phần sửa câu
  if need <= con then
    return jsonb_build_object('burst', h.cur_id, 'fix', need);
  end if;
  return jsonb_build_object('msg', 'Căn này đã dùng đủ ' || max_can || ' lần đọc cả bài trong 24 giờ. '
    || case when con > 0 then 'Còn ' || replace(to_char(con, 'FM999,999'), ',', '.') || ' ký tự để sửa câu, đoạn cần đọc dài ' || replace(to_char(need, 'FM999,999'), ',', '.') || ' ký tự: sửa ít câu hơn rồi bấm lại. '
            else 'Đã dùng hết ' || replace(to_char(max_sua, 'FM999,999'), ',', '.') || ' ký tự sửa câu. ' end
    || 'Giọng đã tạo vẫn dùng được; đọc cả bài lại được từ ' || to_char(h.mo_lai at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM') || '.');
end $$;
revoke all on function public.vt__tts_plan(public.vt_users, public.vt_config, integer, double precision, double precision) from public, anon, authenticated;

-- App hỏi số còn lại. Trả null khi giới hạn không áp cho tài khoản này (app giữ giao diện cũ).
create or replace function public.vt_voice_status(p_token text, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; cfg vt_config; max_can int; max_sua int; h record;
begin
  u := vt__user(p_token);
  select * into cfg from vt_config where id = 1;
  if not ((cfg.tts_limit_mode = 'on' and not coalesce(u.no_limits, false))
       or (cfg.tts_limit_mode = 'test' and coalesce(u.no_limits, false))) then
    return null;
  end if;
  max_can := coalesce((cfg.tts_limits ->> 'moi_can')::int, 0);
  max_sua := coalesce((cfg.tts_limits ->> 'sua_ky_tu')::int, 0);
  if p_lat is null or p_lng is null then
    return jsonb_build_object('lan_max', max_can, 'sua_max', max_sua);
  end if;
  select * into h from vt__tts_house(u.id, p_lat, p_lng);
  return jsonb_build_object('lan_max', max_can, 'sua_max', max_sua,
    'lan_con', greatest(0, max_can - h.so_lan), 'sua_con', greatest(0, max_sua - h.da_sua),
    'mo_lai', case when h.so_lan >= max_can then h.mo_lai end);
end $$;
revoke all on function public.vt_voice_status(text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.vt_voice_status(text, double precision, double precision) to anon, authenticated;
