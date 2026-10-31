-- Vị Trí Studio — đếm số ký tự giọng Google theo LOẠI giọng trong tháng (31/10/2026).
-- Google Text-to-Speech cho miễn phí mỗi tháng theo từng loại: Chirp 3 HD 1 triệu, Neural2 1 triệu, WaveNet 4 triệu,
-- Standard 4 triệu ký tự; vượt thì TỰ TÍNH TIỀN. lib/tts.js đọc bảng này để chọn loại giọng còn hạn mức miễn phí.
-- Tháng tính theo giờ Thái Bình Dương (cách Google tính hoá đơn). Chỉ máy chủ gọi được (khoá cron = TELEGRAM_SECRET).
create table if not exists public.vt_tts_month (
  month date not null,
  model text not null,
  chars bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (month, model)
);
alter table public.vt_tts_month enable row level security;
revoke all on table public.vt_tts_month from public, anon, authenticated;

-- p_chars = 0: chỉ đọc. Trả {chirp3hd: n, neural2: n, …} của tháng hiện tại.
create or replace function public.vt_tts_month_add(p_key text, p_model text, p_chars int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m date := date_trunc('month', now() at time zone 'America/Los_Angeles')::date;
begin
  perform vt__cron(p_key);
  if coalesce(p_chars, 0) > 0 then
    if p_model not in ('chirp3hd', 'neural2', 'wavenet', 'standard') then perform vt__err('Loại giọng không hợp lệ', 'INPUT'); end if;
    insert into vt_tts_month (month, model, chars) values (m, p_model, least(p_chars, 100000))
    on conflict (month, model) do update set chars = vt_tts_month.chars + excluded.chars, updated_at = now();
  end if;
  return coalesce((select jsonb_object_agg(model, chars) from vt_tts_month where month = m), '{}'::jsonb);
end $$;
revoke all on function public.vt_tts_month_add(text, text, int) from public, anon, authenticated;
grant execute on function public.vt_tts_month_add(text, text, int) to anon, authenticated;

-- Xem trong trang quản trị / SQL: select * from vt_tts_month order by month desc, model;
