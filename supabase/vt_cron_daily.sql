-- Báo cáo sức khoẻ app mỗi sáng 7h (cron '0 0 * * *' trong wrangler.jsonc → lib/pages.js runCron).
-- Gửi Telegram cho các tài khoản có login nằm trong vt_config.report_logins (đã kết nối Telegram trong app).
-- Thêm trang 'svc' cho vt_visit để máy chủ đếm lỗi AI kịch bản / giọng đọc (lib/vt.js svcCount).

alter table vt_config add column if not exists report_logins text[] not null default '{}';

create or replace function public.vt_visit(p_page text, p_source text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
begin
  if p_page not in ('landing', 'app', 'install', 'map', 'svc') and p_page !~ '^f_[a-z0-9_]{1,24}$' then return; end if;
  insert into vt_visits (day, page, source, n) values (vt__day(), p_page, vt__src(p_source), 1)
  on conflict (day, page, source) do update set n = vt_visits.n + 1;
end $function$;

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
            where month = date_trunc('month', now() at time zone 'America/Los_Angeles')::date)
  ) into out;
  return out;
end $function$;

revoke all on function public.vt_cron_daily(text) from public, anon, authenticated;
grant execute on function public.vt_cron_daily(text) to anon;
