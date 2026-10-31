-- 31/10/2026 (Giang duyệt): 2 thay đổi nhỏ, KHÔNG sửa hàm thanh toán (vt_payment_in, vt__apply_order).
--
-- 1) vt__profile trả thêm 'paid' = khách đã từng có đơn trả tiền.
--    App dùng để gắn dòng chữ "Làm bằng vitristudio.com" lên video của khách CHƯA từng trả tiền
--    (chỉ khi paid === false; thiếu trường thì coi như không gắn).
--
-- 2) Thưởng giới thiệu khi bạn được mời TRẢ TIỀN: người mời được +ref_paid_bonus lượt (mặc định 5)
--    khi người được mời có đơn trả tiền ĐẦU TIÊN. Thưởng cũ (+ref_bonus khi bạn xuất video đầu tiên) giữ nguyên.
--    Chạy bằng trigger SAU khi đơn chuyển sang 'paid'; mọi lỗi bị bắt lại (raise warning) nên
--    KHÔNG BAO GIỜ làm hỏng việc cộng lượt của đơn thanh toán. Cùng máy (device_id) thì không thưởng.
--    Giới hạn chung ref_max_month lần/30 ngày (đếm cả thưởng cũ vì cùng tiền tố 'Thưởng giới thiệu').
--    Tắt: update vt_config set ref_paid_bonus = 0;

create or replace function public.vt__profile(u vt_users) returns jsonb
language sql stable set search_path = public, extensions as $$
  select jsonb_build_object('id', u.id, 'login', u.login, 'name', u.name, 'credits', u.credits,
    'unlimited_until', u.unlimited_until, 'unlimited', coalesce(u.unlimited_until > now(), false),
    'created_at', u.created_at, 'ref_code', u.ref_code,
    'paid', exists (select 1 from vt_orders o where o.user_id = u.id and o.status = 'paid'))
$$;

alter table public.vt_config add column if not exists ref_paid_bonus int not null default 5;

create or replace function public.vt__ref_paid_reward() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare u vt_users; inv vt_users; cfg vt_config; n int;
begin
  begin
    select * into cfg from vt_config where id = 1;
    if coalesce(cfg.ref_paid_bonus, 0) <= 0 then return new; end if;
    select * into u from vt_users where id = new.user_id;
    if not found or u.referred_by is null then return new; end if;
    -- chỉ đơn trả tiền đầu tiên của người được mời
    if exists (select 1 from vt_orders where user_id = u.id and status = 'paid' and id <> new.id) then return new; end if;
    select * into inv from vt_users where id = u.referred_by and status = 'active';
    if not found then return new; end if;
    if u.device_id is not null and u.device_id = inv.device_id then return new; end if;
    select count(*) into n from vt_usage where user_id = inv.id and kind = 'grant'
      and note like 'Thưởng giới thiệu%' and created_at > now() - interval '30 days';
    if n >= cfg.ref_max_month then return new; end if;
    update vt_users set credits = credits + cfg.ref_paid_bonus where id = inv.id;
    insert into vt_usage (user_id, kind, credits, note)
    values (inv.id, 'grant', cfg.ref_paid_bonus, 'Thưởng giới thiệu (bạn mua gói): ' || u.login);
  exception when others then
    raise warning 'vt__ref_paid_reward lỗi (bỏ qua, không ảnh hưởng thanh toán): %', sqlerrm;
  end;
  return new;
end $$;

revoke all on function public.vt__ref_paid_reward() from public, anon, authenticated;

drop trigger if exists vt_orders_ref_paid on public.vt_orders;
create trigger vt_orders_ref_paid
  after update of status on public.vt_orders
  for each row when (new.status = 'paid' and old.status is distinct from 'paid')
  execute function public.vt__ref_paid_reward();
