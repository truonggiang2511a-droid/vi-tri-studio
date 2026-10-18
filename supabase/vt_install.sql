-- Vị Trí Studio — đếm lượt cài app (Android/máy tính báo được) và lượt mở từ app đã cài.
-- Chạy lại nhiều lần vẫn an toàn.

create or replace function public.vt_visit(p_page text, p_source text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_page not in ('landing', 'app', 'install') then return; end if;
  insert into vt_visits (day, page, source, n) values (vt__day(), p_page, vt__src(p_source), 1)
  on conflict (day, page, source) do update set n = vt_visits.n + 1;
end $$;

create or replace function public.vt_admin_funnel(p_key text, p_days int default 30) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d int := greatest(1, least(coalesce(p_days, 30), 365)); since timestamptz; since_day date;
begin
  perform vt__admin(p_key);
  since_day := vt__day() - (d - 1);
  since := since_day::timestamp at time zone 'Asia/Ho_Chi_Minh';
  return jsonb_build_object(
    'days', d,
    'visits_landing', (select coalesce(sum(n), 0) from vt_visits where page = 'landing' and day >= since_day),
    'visits_app', (select coalesce(sum(n), 0) from vt_visits where page = 'app' and day >= since_day),
    'installs', (select coalesce(sum(n), 0) from vt_visits where page = 'install' and day >= since_day),
    'opens_installed', (select coalesce(sum(n), 0) from vt_visits where page = 'app' and source = 'app-da-cai' and day >= since_day),
    'visit_sources', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'landing', l, 'app', a) order by l + a desc) from (
        select source, coalesce(sum(n) filter (where page = 'landing'), 0) as l, coalesce(sum(n) filter (where page = 'app'), 0) as a
        from vt_visits where day >= since_day and page in ('landing', 'app') group by source having sum(n) > 0) v), '[]'::jsonb),
    'signups', (select count(*) from vt_users where created_at >= since),
    'exported', (select count(*) from vt_users u where u.created_at >= since
      and exists (select 1 from vt_usage g where g.user_id = u.id and g.kind = 'export')),
    'paid', (select count(*) from vt_users u where u.created_at >= since
      and exists (select 1 from vt_orders o where o.user_id = u.id and o.status = 'paid')),
    'ref_signups', (select count(*) from vt_users where created_at >= since and referred_by is not null),
    'orders_paid', (select count(*) from vt_orders where status = 'paid' and paid_at >= since),
    'revenue', (select coalesce(sum(coalesce(paid_amount, amount)), 0) from vt_orders where status = 'paid' and paid_at >= since),
    'by_source', coalesce((select jsonb_agg(x order by (x->>'signups')::int desc) from (
        select jsonb_build_object('source', coalesce(u.source, 'khong-ro'), 'signups', count(*),
          'exported', count(*) filter (where exists (select 1 from vt_usage g where g.user_id = u.id and g.kind = 'export')),
          'paid', count(*) filter (where exists (select 1 from vt_orders o where o.user_id = u.id and o.status = 'paid'))) as x
        from vt_users u where u.created_at >= since group by coalesce(u.source, 'khong-ro')) t), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', g.day,
        'visits', (select coalesce(sum(n), 0) from vt_visits v where v.day = g.day and v.page in ('landing', 'app')),
        'installs', (select coalesce(sum(n), 0) from vt_visits v where v.day = g.day and v.page = 'install'),
        'signups', (select count(*) from vt_users u where (u.created_at at time zone 'Asia/Ho_Chi_Minh')::date = g.day),
        'exports', (select count(*) from vt_usage x where x.kind = 'export' and (x.created_at at time zone 'Asia/Ho_Chi_Minh')::date = g.day),
        'paid', (select count(*) from vt_orders o where o.status = 'paid' and (o.paid_at at time zone 'Asia/Ho_Chi_Minh')::date = g.day)
      ) order by g.day desc)
      from (select generate_series(since_day, vt__day(), interval '1 day')::date as day) g), '[]'::jsonb));
end $$;


revoke all on function public.vt_visit(text, text) from public, anon, authenticated;
grant execute on function public.vt_visit(text, text) to anon, authenticated;
revoke all on function public.vt_admin_funnel(text, int) from public, anon, authenticated;
grant execute on function public.vt_admin_funnel(text, int) to anon, authenticated;
