-- Sửa lỗi "column reference charged is ambiguous" khi tạo giọng bằng gói không giới hạn:
-- biến charged trùng tên cột vt_usage.charged -> đổi tên biến thành v_charged (đã chạy trên Supabase).
do $$
declare src text; args text;
begin
  select pg_get_function_arguments(p.oid), p.prosrc into args, src from pg_proc p where p.proname = 'vt_ai_allow';
  src := replace(src, 'charged boolean := false;', 'v_charged boolean := false;');
  src := replace(src, 'charged := true;', 'v_charged := true;');
  src := replace(src, '''charged'', charged)', '''charged'', v_charged)');
  src := replace(src, 'and charged and', 'and vt_usage.charged and');
  execute format('create or replace function public.vt_ai_allow(%s) returns jsonb language plpgsql security definer set search_path = public, extensions as %L', args, src);
end $$;
