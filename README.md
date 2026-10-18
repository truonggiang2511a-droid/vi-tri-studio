# Vị Trí Studio

Dán toạ độ → quét tiện ích xung quanh → xuất video vị trí bất động sản có giọng đọc AI.

## Cấu trúc
- `site/` — bản đã đóng gói, Cloudflare phục vụ trực tiếp (không cần lệnh build).
- `functions/api/` — phần máy chủ cho Cloudflare Pages: `/api/tts`, `/api/script`, `/api/sepay`, `/api/resolve`.
- `lib/` — mã xử lý dùng chung cho các hàm máy chủ.
- `worker.js` + `wrangler.jsonc` — chỉ dùng nếu dự án Cloudflare là dạng Worker.
- `js/`, `index.html`, `admin.html`, `styles.css` — mã nguồn giao diện.
- `poi/` — dữ liệu tiện ích (Overture Maps, giấy phép CDLA-Permissive-2.0).
- `supabase/` — SQL tạo bảng và hàm tài khoản/thanh toán, `vt_referral.sql` cho giới thiệu bạn bè.
- `gioi-thieu.html`, `chinh-sach-bao-mat.html`, `dieu-khoan.html` — trang giới thiệu chạy quảng cáo và các trang chính sách.
- `music/` + `tools/make_music.py` — nhạc nền tự soạn (chạy lại script để tạo bản mới).
- `tools/build_poi_tiles.py` — dựng lại dữ liệu tiện ích từ Overture.

## Cài đặt Cloudflare Pages
- Build command: để trống
- Build output directory: `site`
- Biến môi trường (Settings → Variables and Secrets):
  - `GOOGLE_TTS_KEY` (Secret) — khoá Google Cloud Text-to-Speech
  - `TTS_PROVIDER` = `google`
  - `ANTHROPIC_API_KEY` hoặc `GEMINI_API_KEY` (Secret, tuỳ chọn) — viết kịch bản bằng AI
  - `FPT_TTS_KEY` (Secret, tuỳ chọn)
  - `ARCGIS_KEY` (Secret) — khoá ArcGIS Location Platform cho ảnh vệ tinh thương mại
  - `META_PIXEL_ID`, `TIKTOK_PIXEL_ID` (Text, tuỳ chọn) — đo chuyển đổi quảng cáo, chỉ chạy khi khách bấm Đồng ý cookie

Không bao giờ ghi khoá API vào mã nguồn.

## Sửa giao diện
Sửa trong `js/`, `index.html`, `styles.css`, rồi chạy `bash build.sh` để tạo lại `site/` và commit cả `site/`.

## Nguồn dữ liệu
Ảnh vệ tinh: Esri, Maxar · Bản đồ: © OpenStreetMap · Tiện ích: Overture Maps Foundation.
