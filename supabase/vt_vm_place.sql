-- Vị Trí Studio — nhớ toạ độ điểm Vietmap theo ref_id (31/10/2026).
-- Mỗi lần quét tiện ích gần nhà, máy chủ gọi Vietmap Place tới ~16 lần để lấy toạ độ; tài khoản Vietmap giới hạn
-- Place 1.500 lần/ngày + tổng hạn mức giao dịch. Nhiều căn gần nhau (cùng khu) gặp lại đúng các điểm này → nhớ toạ độ
-- 30 ngày để khỏi hỏi lại. Chỉ máy chủ gọi được (khoá cron = TELEGRAM_SECRET), trình duyệt không đọc được bảng.
create table if not exists public.vt_vm_place (
  ref text primary key,
  lat double precision not null,
  lng double precision not null,
  at timestamptz not null default now()
);
alter table public.vt_vm_place enable row level security;
revoke all on table public.vt_vm_place from public, anon, authenticated;

-- Đọc: trả {ref: [lat, lng]} cho các ref còn trong hạn 30 ngày (tối đa 60 ref mỗi lần)
create or replace function public.vt_vm_place_get(p_key text, p_refs text[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__cron(p_key);
  return coalesce((select jsonb_object_agg(ref, jsonb_build_array(lat, lng)) from vt_vm_place
    where ref = any(p_refs[1:60]) and at > now() - interval '30 days'), '{}'::jsonb);
end $$;

-- Ghi: p_items = [{ref, lat, lng}] (tối đa 60), chỉ nhận toạ độ trong Việt Nam
create or replace function public.vt_vm_place_put(p_key text, p_items jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  perform vt__cron(p_key);
  insert into vt_vm_place (ref, lat, lng, at)
  select x->>'ref', (x->>'lat')::float8, (x->>'lng')::float8, now()
  from (select x from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x limit 60) s
  where length(coalesce(x->>'ref', '')) between 1 and 200
    and (x->>'lat')::float8 between 7.5 and 23.6 and (x->>'lng')::float8 between 101.8 and 117.5
  on conflict (ref) do update set lat = excluded.lat, lng = excluded.lng, at = now();
  get diagnostics n = row_count;
  -- Dọn bản quá hạn thỉnh thoảng (rẻ: có khoá chính, bảng nhỏ)
  if random() < 0.02 then delete from vt_vm_place where at < now() - interval '45 days'; end if;
  return n;
end $$;
revoke all on function public.vt_vm_place_get(text, text[]) from public, anon, authenticated;
grant execute on function public.vt_vm_place_get(text, text[]) to anon, authenticated;
revoke all on function public.vt_vm_place_put(text, jsonb) from public, anon, authenticated;
grant execute on function public.vt_vm_place_put(text, jsonb) to anon, authenticated;
