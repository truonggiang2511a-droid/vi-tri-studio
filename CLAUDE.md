# CLAUDE.md — Vị Trí Studio (vitristudio.com)

Đọc file này trước khi sửa bất cứ thứ gì. App đang có khách trả tiền và đang chạy quảng cáo Facebook/TikTok,
nên mọi thay đổi phải giữ nguyên luồng **đăng ký → xuất video → thanh toán** và các **sự kiện đo chuyển đổi**.

Chủ dự án: Giang (giao tiếp tiếng Việt). Giao diện, thông báo, tooltip, comment trong code hiển thị cho khách: tiếng Việt.
Tên biến/hàm: tiếng Anh. Không tuyên bố "đã chạy được/đã build xong" nếu chưa thực sự chạy lệnh và thấy kết quả.

---

## 1. Kiến trúc nhanh

| Phần | Ở đâu | Ghi chú |
|---|---|---|
| Giao diện (nguồn) | `js/`, `index.html`, `admin.html`, `styles.css`, `landing.css` | Sửa ở đây |
| Giao diện (bản chạy) | `site/` | **Được commit vào git**. Cloudflare phục vụ thẳng thư mục này, không có bước build trên Cloudflare |
| Máy chủ | `worker.js` (dạng Worker, đang dùng) + `functions/api/*.js` (dạng Pages, dự phòng) | Mọi route `/api/*` phải khai báo ở **cả hai** |
| Logic máy chủ | `lib/*.js` | `vt.js` = env + gọi Supabase RPC |
| Cơ sở dữ liệu | Supabase, hàm `vt_*` trong `supabase/*.sql` | Mọi quyền nằm trong hàm SQL (security definer) |
| Thanh toán | SePay webhook → `/api/sepay` → `vt_payment_in` | Mã đơn `VTxxxxxx` trong nội dung chuyển khoản |
| Đo quảng cáo | `js/track.js` (Pixel + TikTok) + `lib/capi.js` (Meta CAPI) | Xem mục 3 |
| Hosting | Cloudflare (Worker `vi-tri-studio`, assets = `./site`), tự deploy khi push `main` | Repo: truonggiang2511a-droid/vi-tri-studio |

Biến môi trường trên Cloudflare (Settings → Variables and Secrets). Không bao giờ ghi khoá vào mã nguồn hoặc gửi trong chat:
`GOOGLE_TTS_KEY`, `FPT_TTS_KEY`, `TTS_PROVIDER`, `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`, `ARCGIS_KEY`,
`META_PIXEL_ID` (đang có: tập dữ liệu "vitristudio"), `META_CAPI_TOKEN` (chưa có — chờ tạo), `META_TEST_CODE` (chỉ đặt khi kiểm tra, xoá ngay sau đó),
`TIKTOK_PIXEL_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME`, `APP_URL`.

---

## 2. Quy trình cập nhật an toàn (BẮT BUỘC mỗi lần sửa)

1. **Đọc trước khi sửa**: tìm mọi chỗ gọi tới phần sắp đổi (`grep`), đặc biệt `track(`, `rpc(`, các route `/api/`.
2. **Sửa nguồn** trong `js/`, `lib/`, `*.html`, `*.css`.
3. **Chạy `npm ci` rồi `bash build.sh`** → tạo lại `site/`. Quên bước này thì phần giao diện KHÔNG lên web
   (đã từng xảy ra 10/2026: sửa `js/track.js` mà không build, web vẫn chạy bản cũ).
   Khác biệt nhỏ trong `site/*.css|js` do phiên bản esbuild (khoảng trắng, đổi tên biến khi nén) là bình thường.
4. **Kiểm tra cục bộ trước khi push**:
   - Build không lỗi.
   - Route máy chủ mới: chạy thử bằng `node --input-type=module` với `fetch` giả, xem đầu ra đúng.
   - Nếu thêm route: đã có trong `worker.js` (ROUTES hoặc if) **và** `functions/api/<tên>.js`.
5. **Commit cả nguồn lẫn `site/`**, message tiếng Việt nói rõ đổi gì. Push `main` → Cloudflare tự deploy (~1–2 phút).
6. **Kiểm tra trên web thật** (sau 1–2 phút):
   - `curl https://vitristudio.com/api/config` → còn `meta_pixel`.
   - `curl https://vitristudio.com/app.js | grep <đoạn mã mới>` → bản mới đã lên.
   - Route mới trả đúng.
   - Nhờ Giang (hoặc tự thử nếu có trình duyệt): đăng ký tài khoản mới → xuất 1 video → mở bảng giá tạo đơn; xem *Thử nghiệm sự kiện* trong Trình quản lý sự kiện Meta vẫn hiện *Hoàn tất đăng ký*.
7. **Lỗi thì quay lại ngay**: Cloudflare → Deployments → bản trước → Rollback, hoặc `git revert` rồi push. Sửa xong mới đẩy lại.

Nên làm vào giờ vắng khách. Đổi một thứ một lần (không sửa app cùng lúc với sửa quảng cáo).

### Những thứ KHÔNG được đổi khi chưa hỏi Giang
- Tên miền, đường dẫn trang đích quảng cáo (`/`, `/gioi-thieu`, `/#dangky`), mã Pixel.
- Tên và thời điểm bắn sự kiện chuyển đổi (mục 3) — chiến dịch đang tối ưu theo *Hoàn tất đăng ký*.
- Route `/api/sepay`, `/api/telegram` và chuyển hướng tên miền cũ trong `worker.js` (webhook đã đăng ký theo địa chỉ cũ).
- Hàm SQL `vt_payment_in`, `vt__apply_order`, bảng `vt_orders`, `vt_users` — đụng vào là ảnh hưởng tiền của khách.
- Đổi SQL: viết file migration mới, chạy thử trên nhánh/bản sao trước, không xoá cột đang dùng.

---

## 3. Sự kiện đo chuyển đổi (không làm hỏng)

`track(name, p)` trong `js/track.js`. Pixel chỉ chạy khi khách bấm Đồng ý cookie; CAPI gửi ngay (trừ khi khách bấm Từ chối).

| track() | Meta | TikTok | Gọi ở | CAPI |
|---|---|---|---|---|
| `view` | ViewContent | ViewContent | `landing.js` | không |
| `trial_click` | Lead | ClickButton | `landing.js` (nút `[data-cta]`) | không |
| `register` | CompleteRegistration | CompleteRegistration | `account.js` sau `vt_signup2` | **có** |
| `checkout` | InitiateCheckout | InitiateCheckout | `account.js` sau `vt_create_order` | **có** |
| `purchase` | Purchase | CompletePayment | `account.js` khi poll thấy đơn `paid` | **có** |
| `export` | XuatVideo (custom) | SubmitForm | `account.js` khi xuất video có trừ lượt | không |

- Pixel và CAPI dùng chung `event_id` → Meta tự gộp, không đếm trùng. Không xoá `event_id`.
- CAPI (`/api/capi`, `lib/capi.js`) mã hoá SHA-256 email/SĐT (SĐT VN 0… → 84…), thêm IP, user agent, `_fbp`, `_fbc`.
  Không có `META_CAPI_TOKEN` thì trả `skip: 'chưa cấu hình'` và không làm gì — an toàn.
- Kiểm tra CAPI: đặt `META_TEST_CODE`, `curl -X POST https://vitristudio.com/api/capi -H 'content-type: application/json' -d '{"event":"ViewContent","event_id":"kiemtra.1"}'`, xem tab *Thử nghiệm sự kiện*; xong xoá `META_TEST_CODE`.
- KHÔNG bật "Sự kiện tự động" (AI của Meta) và không dùng "Công cụ thiết lập sự kiện" của Meta — gây đếm trùng/sai sự kiện.
- Tài khoản Facebook của Giang từng bị khoá khi đổi quyền tập dữ liệu nhiều lần liền: không hướng dẫn thao tác quyền dồn dập; mỗi thao tác nhạy cảm làm một lần, trên thiết bị quen.
- Việc còn treo: Purchase chỉ có nguồn Trình duyệt cho tới khi có `META_CAPI_TOKEN`. Purchase thực tế xảy ra ở webhook SePay — nếu sau này cần chắc chắn 100%, gửi CAPI Purchase từ `lib/sepay.js` (cần `vt_payment_in` trả thêm login của khách + lưu `_fbp/_fbc` lúc tạo đơn).

---

## 4. Cẩm nang làm app web SaaS (rút ra từ dự án này — dùng cho sản phẩm mới)

**Ý tưởng → bản chạy đầu tiên**
- Chốt 1 tính năng lõi tạo ra giá trị (ở đây: dán toạ độ → video vị trí). Làm xong lõi trước, module khác sau.
- Ngăn xếp đã chứng minh hiệu quả: HTML/JS thuần + esbuild → Cloudflare (Worker + assets) → Supabase (hàm RPC `security definer`, trình duyệt chỉ dùng khoá publishable) → SePay webhook cho chuyển khoản VietQR.
- Ghi ngay vào CLAUDE.md: cấu trúc thư mục, cách build, biến môi trường, route.

**Tài khoản & tiền**
- Tài khoản + lượt dùng thử + gói trả tiền nằm hết trong SQL; máy chủ kiểm tra lượt trước khi gọi dịch vụ AI tốn phí (`allowAi`).
- Chống lạm dụng dùng thử: device id + fingerprint, giới hạn theo ngày.
- Webhook thanh toán phải: xác thực khoá, chống trùng (unique theo nguồn+mã giao dịch), kiểm tra đủ tiền, ghi log mọi giao dịch kể cả không khớp.

**Trước khi chạy quảng cáo**
- Trang giới thiệu riêng, trang chính sách bảo mật + điều khoản, thanh đồng ý cookie.
- Gắn sự kiện bằng code ở đúng thời điểm có giá trị (đăng ký thành công, tiền đã về) — không theo cú bấm nút.
- Pixel + CAPI cùng `event_id` ngay từ đầu; ghi nguồn khách (utm/fbclid) 30 ngày để biết khách từ đâu.
- Tối ưu quảng cáo theo sự kiện có đủ ~50 lượt/tuần (thường là Đăng ký); chuyển sang Purchase khi đơn đủ nhiều.

**Kiểm thử & sửa lỗi**
- Mỗi thay đổi: build → chạy thử cục bộ → push → kiểm tra trên web thật bằng `curl` → thử luồng chính trên điện thoại.
- Tìm nguyên nhân gốc trước khi sửa: đọc code đường đi của dữ liệu (trình duyệt → API → SQL), không đoán.
- Sửa lỗi xong ghi 1 dòng bài học vào mục 5 bên dưới.

**Hoàn thiện**
- Trang quản trị: doanh thu, đơn chờ, giao dịch không khớp, người dùng mới.
- Thông báo cho chủ (Telegram) khi có khách mới/đơn mới; báo cáo tuần bằng cron.
- Theo dõi phễu: lượt vào → đăng ký → xuất video → tạo đơn → trả tiền; sửa bước rơi nhiều nhất trước.

---

## 5. Nhật ký bài học

- 2026-10: Sửa `js/` mà quên `bash build.sh` → bản web không đổi. Luôn build + commit `site/`.
- 2026-10: Git proxy trong phiên Claude chặn push nếu repo chưa được thêm vào phiên → dùng `add_repo` (quyền push) trước.
- 2026-10: Meta báo EMQ Mua hàng = 0 vì Purchase chỉ bắn từ trình duyệt → thêm CAPI (`lib/capi.js`), chờ `META_CAPI_TOKEN`.
- 2026-10: Đề xuất "Kết nối CRM" của Meta chỉ dành cho quảng cáo biểu mẫu tức thì, không áp dụng cho quảng cáo về web.
