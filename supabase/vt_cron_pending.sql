-- Báo Telegram cho chủ app khi khách tạo đơn mà chưa chuyển khoản (21/11/2026).
-- Cron '*/30 * * * *' (lib/pages.js runCron → notifyPendingOrders) gọi hàm này với khung thời gian [p_from, p_to):
-- mỗi lần chạy hỏi đơn tạo trong 30 phút, kết thúc 15 phút trước lúc chạy → mỗi đơn chỉ báo 1 lần, không cần lưu cờ "đã báo".
-- Chỉ ĐỌC vt_orders / vt_users, không đổi gì liên quan tới tiền. Người nhận = vt_config.report_logins đã kết nối Telegram.

create or replace function public.vt_cron_pending(p_key text, p_from timestamptz, p_to timestamptz)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  f timestamptz := greatest(p_from, p_to - interval '12 hours');  -- tối đa 12 giờ (đợt 7h sáng gom đơn ban đêm)
  out jsonb;
begin
  perform vt__cron(p_key);
  select jsonb_build_object(
    'chats', (select coalesce(jsonb_agg(distinct u.tg_chat), '[]'::jsonb) from vt_users u, vt_config c
              where c.id = 1 and u.tg_chat is not null and u.login = any(c.report_logins)),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', o.code, 'amount', o.amount, 'package', o.package_name, 'created_at', o.created_at,
               'login', u.login, 'name', u.name) order by o.created_at)
      from vt_orders o join vt_users u on u.id = o.user_id
      where o.status = 'pending' and o.created_at >= f and o.created_at < p_to
        and not u.no_limits and u.login not ilike '%@vitristudio.com'
        -- khách đã trả một đơn khác sau đơn này thì thôi
        and not exists (select 1 from vt_orders p where p.user_id = o.user_id and p.status = 'paid' and p.paid_at > o.created_at)
    ), '[]'::jsonb)
  ) into out;
  return out;
end $function$;

revoke all on function public.vt_cron_pending(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.vt_cron_pending(text, timestamptz, timestamptz) to anon;
