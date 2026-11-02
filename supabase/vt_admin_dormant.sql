-- 2/11/2026 (Giang duyệt): danh sách khách ĐÃ TRẢ TIỀN mà lâu không dùng app, để Giang nhắn Zalo/email nhắc dùng lượt còn lại.
-- Số liệu lúc làm: 31 khách trả tiền, 11 khách không xuất/tạo giọng ≥ 7 ngày, chỉ 1 người trong số đó kết nối Telegram
-- → nhắc bằng tay (Zalo theo SĐT đăng nhập) hiệu quả hơn bot. "Không dùng" tính theo vt_usage (xuất, giọng, kịch bản),
-- KHÔNG theo last_login (phiên đăng nhập giữ lâu nên last_login có thể cũ dù khách vẫn dùng hằng ngày).
-- Chỉ ĐỌC dữ liệu, không đổi bảng/hàm tiền.
create or replace function public.vt_admin_dormant(p_key text, p_days int default 7) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vt__admin(p_key);
  return coalesce((select jsonb_agg(x order by x->>'last_use' asc nulls first) from (
    select jsonb_build_object('id', u.id, 'login', u.login, 'name', u.name, 'credits', u.credits, 'source', u.source,
      'note', u.note, 'unlimited_until', u.unlimited_until, 'tg', u.tg_chat is not null,
      'paid_total', (select coalesce(sum(coalesce(o.paid_amount, o.amount)), 0) from vt_orders o where o.user_id = u.id and o.status = 'paid'),
      'orders', (select count(*) from vt_orders o where o.user_id = u.id and o.status = 'paid'),
      'exports', (select count(*) from vt_usage g where g.user_id = u.id and g.kind = 'export'),
      'last_use', a.last_use,
      'page_views', (select coalesce(sum(p.views), 0) from vt_pages p where p.user_id = u.id),
      'leads', (select count(*) from vt_leads l where l.user_id = u.id)) as x
    from vt_users u
    left join lateral (select max(g.created_at) as last_use from vt_usage g where g.user_id = u.id and g.kind <> 'grant') a on true
    where u.status = 'active' and coalesce(u.no_limits, false) = false
      and exists (select 1 from vt_orders o where o.user_id = u.id and o.status = 'paid')
      and coalesce(a.last_use, 'epoch'::timestamptz) < now() - make_interval(days => greatest(1, coalesce(p_days, 7)))
    limit 200) t), '[]'::jsonb);
end $$;

revoke all on function public.vt_admin_dormant(text, int) from public, anon, authenticated;
grant execute on function public.vt_admin_dormant(text, int) to anon, authenticated;
