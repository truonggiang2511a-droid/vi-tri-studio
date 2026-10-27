-- 27/10/2026: đo phễu nội bộ — khách bỏ ở bước nào trước khi đăng ký.
-- vt_visit nhận thêm tên trang 'f_<bước>' (chữ thường, số, gạch dưới; ≤ 24 ký tự). Không lưu thông tin cá nhân,
-- không đụng bảng tiền/đơn/người dùng. Danh sách bước: xem js/track.js funnel() và CLAUDE.md nhật ký 27/10.
create or replace function public.vt_visit(p_page text, p_source text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_page not in ('landing', 'app', 'install', 'map') and p_page !~ '^f_[a-z0-9_]{1,24}$' then return; end if;
  insert into vt_visits (day, page, source, n) values (vt__day(), p_page, vt__src(p_source), 1)
  on conflict (day, page, source) do update set n = vt_visits.n + 1;
end $$;
