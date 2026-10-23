-- Đã chạy trên Supabase (migration vt_test_no_limits, 23/10/2026).
-- Cột vt_users.no_limits (mặc định false). Chỉ bật cho tài khoản test nội bộ giang.test@vitristudio.com.
-- Khi no_limits = true: bỏ qua giới hạn ký tự giọng AI / 24h (vt_ai_allow) và giới hạn số căn mỗi ngày
-- của gói không giới hạn (vt_ai_allow, vt_export_begin). Khách thường không đổi gì.
alter table vt_users add column if not exists no_limits boolean not null default false;
update vt_users set no_limits = true where login = 'giang.test@vitristudio.com' and source = 'noi-bo';
-- Thân hàm đầy đủ: xem migration vt_test_no_limits trên Supabase (chỉ thêm điều kiện `not u.no_limits and` trước 3 chỗ kiểm tra giới hạn).
