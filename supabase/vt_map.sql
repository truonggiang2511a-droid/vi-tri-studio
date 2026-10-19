-- Vị Trí Studio — đếm lượt gọi dịch vụ bản đồ (Vietmap, dự phòng, bộ nhớ đệm) để theo dõi hạn mức.
create or replace function public.vt_visit(p_page text, p_source text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_page not in ('landing', 'app', 'install', 'map') then return; end if;
  insert into vt_visits (day, page, source, n) values (vt__day(), p_page, vt__src(p_source), 1)
  on conflict (day, page, source) do update set n = vt_visits.n + 1;
end $$;

create or replace function public.vt_admin_map_usage(p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m date := date_trunc('month', vt__day())::date;
begin
  perform vt__admin(p_key);
  return coalesce((select jsonb_agg(jsonb_build_object('source', source, 'today', t, 'month', mo) order by mo desc) from (
    select source, coalesce(sum(n) filter (where day = vt__day()), 0) t, sum(n) mo
    from vt_visits where page = 'map' and day >= m group by source) x), '[]'::jsonb);
end $$;
revoke all on function public.vt_visit(text, text) from public, anon, authenticated;
grant execute on function public.vt_visit(text, text) to anon, authenticated;
revoke all on function public.vt_admin_map_usage(text) from public, anon, authenticated;
grant execute on function public.vt_admin_map_usage(text) to anon, authenticated;
