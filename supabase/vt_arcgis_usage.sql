-- 1/11/2026: theo dõi hạn mức ArcGIS theo 30 ngày gần nhất (kỳ tính tiền ArcGIS không trùng tháng dương lịch).
-- vt__arc_usage(n): tổng n ngày gần nhất (tính cả hôm nay): vẽ đường ArcGIS, lần gọi vùng lái xe (mỗi lần = 3 vùng),
--   lần bị chặn vì hết hạn mức vùng lái xe, phiên basemap tạo mới (trình duyệt đếm qua phễu f_o_phien_tao).
-- vt_map_usage(p_key, p_days): cho máy chủ (lib/map.js) đọc để chặn cảnh vùng lái xe trước khi vượt 5.000 vùng miễn phí.
-- vt_cron_daily: thêm 'r30' cho báo cáo 7h sáng (số phiên, ước tiền nếu bật trả theo lượt).

create or replace function public.vt__arc_usage(p_days int)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public', 'extensions'
as $function$
  select jsonb_build_object(
    'route',   coalesce(sum(n) filter (where page = 'map' and source = 'arcgis-route'), 0),
    'iso',     coalesce(sum(n) filter (where page = 'map' and source = 'arcgis_iso'), 0),
    'iso_cap', coalesce(sum(n) filter (where page = 'map' and source = 'iso_cap'), 0),
    'sess',    coalesce(sum(n) filter (where page = 'f_o_phien_tao'), 0),
    'days',    greatest(1, least(p_days, 62))
  )
  from vt_visits
  where day > vt__day() - greatest(1, least(p_days, 62))
    and (page = 'f_o_phien_tao' or (page = 'map' and source in ('arcgis-route', 'arcgis_iso', 'iso_cap')));
$function$;
revoke all on function public.vt__arc_usage(int) from public, anon, authenticated;

create or replace function public.vt_map_usage(p_key text, p_days int default 30)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
begin
  perform vt__cron(p_key);
  return vt__arc_usage(p_days);
end $function$;
revoke all on function public.vt_map_usage(text, int) from public, anon, authenticated;
grant execute on function public.vt_map_usage(text, int) to anon;

create or replace function public.vt_cron_daily(p_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  d date := vt__day() - 1;              -- hôm qua theo giờ Việt Nam
  m0 date := date_trunc('month', d)::date;
  t0 timestamptz := (d::timestamp at time zone 'Asia/Ho_Chi_Minh');
  t1 timestamptz := ((d + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
  out jsonb;
begin
  perform vt__cron(p_key);
  with real_users as (
    select id from vt_users where not no_limits and login not ilike '%@vitristudio.com'
  )
  select jsonb_build_object(
    'day', d,
    'chats', (select coalesce(jsonb_agg(distinct u.tg_chat), '[]'::jsonb) from vt_users u, vt_config c
              where c.id = 1 and u.tg_chat is not null and u.login = any(c.report_logins)),
    'signups', (select count(*) from vt_users u where u.created_at >= t0 and u.created_at < t1 and u.id in (select id from real_users)),
    'exports', (select count(*) from vt_usage g where g.kind = 'export' and g.created_at >= t0 and g.created_at < t1 and g.user_id in (select id from real_users)),
    'exporters', (select count(distinct g.user_id) from vt_usage g where g.kind = 'export' and g.created_at >= t0 and g.created_at < t1 and g.user_id in (select id from real_users)),
    'orders', (select count(*) from vt_orders o where o.created_at >= t0 and o.created_at < t1 and o.user_id in (select id from real_users)),
    'paid', (select count(*) from vt_orders o where o.status = 'paid' and o.paid_at >= t0 and o.paid_at < t1 and o.user_id in (select id from real_users)),
    'revenue', (select coalesce(sum(o.paid_amount), 0) from vt_orders o where o.status = 'paid' and o.paid_at >= t0 and o.paid_at < t1 and o.user_id in (select id from real_users)),
    'pay_unmatched', (select count(*) from vt_payment_events e where e.result <> 'paid' and e.created_at >= t0 and e.created_at < t1),
    'map', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, sum(n) n from vt_visits where day = d and page = 'map' group by 1) s),
    'svc', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, sum(n) n from vt_visits where day = d and page = 'svc' group by 1) s),
    'f', (select coalesce(jsonb_object_agg(page, n), '{}'::jsonb) from (select page, sum(n) n from vt_visits where day = d and page like 'f\_%' group by 1) s),
    'month', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, sum(n) n from vt_visits
              where day >= m0 and day <= d and page = 'map' and source in ('arcgis-route', 'arcgis_iso') group by 1) s),
    'tts', (select coalesce(jsonb_object_agg(model, chars), '{}'::jsonb) from vt_tts_month
            where month = date_trunc('month', now() at time zone 'America/Los_Angeles')::date),
    'r30', vt__arc_usage(30)
  ) into out;
  return out;
end $function$;

revoke all on function public.vt_cron_daily(text) from public, anon, authenticated;
grant execute on function public.vt_cron_daily(text) to anon;
