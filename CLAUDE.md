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

### Các phần dễ hỏng (đọc trước khi sửa)
- **Xuất video** (`js/export.js`): video H.264 bằng `VideoEncoder` (máy không có H.264 thì VP9), ghép MP4 + âm thanh bằng **Mediabunny** với bộ mã hoá **AAC WebAssembly** (`@mediabunny/aac-encoder`) — dùng trên MỌI máy, KHÔNG dùng `AudioEncoder` của trình duyệt (iPhone/Android thiếu AAC hoặc thiếu thông tin giải mã → file mất tiếng; lỗi khách báo nhiều lần 10/2026). Gói này tách riêng `site/xuat.js` (≈1,1 MB, dựng từ `js/xuat-entry.js`, chỉ tải khi bấm Xuất). Sau khi ghép tự kiểm tra có hộp `mp4a`, thiếu thì quay thời gian thực (`exportRealtime`). Kiểm thử: Chrome ở máy thử KHÔNG có AAC gốc = đúng trường hợp iPhone; `ffprobe` phải thấy `aac LC 48000 2ch` và `volumedetect` có tiếng.
- **Nền bản đồ** (`BASES` trong `js/render.js`): `vetinh` (mặc định, ảnh thật tươi rõ), `phim`, `duongpho`, `toi`, `sang`. Mỗi nền có `src` (nguồn ô ảnh Esri), `maxz`, lọc màu `fx`. Khoá bộ nhớ ô ảnh gồm cả nguồn. `render()` và `collectTiles()` phải gọi `useBase(tl.scene.base)`.
- **Cách hiện tiện ích** (`scene.flow`, `tl.flow`): CHỈ 2 kiểu theo yêu cầu của Giang: `lanluot` (bay tới từng điểm, line đường đi + thẻ lớn) và `radar` (KHÔNG line: tiện ích sắp theo hướng quanh nhà, mỗi pha `poi` 3,4 s, camera ôm sát nhà + điểm, `move: 1` để lia êm suốt cảnh → máy quay đi vòng quanh nhà; nhãn chú thích có biểu tượng, tên, `km · phút` (phút theo đường đi, không có thì ước lượng 22 km/h), đường dẫn gấp khúc tới ghim, vòng định vị quanh ghim đang nói tới; bộ đặt nhãn tránh đè). Kiểu cũ `cungluc`/`tiaxa` tự chuyển thành `radar` — Giang đã bỏ 2 kiểu này, đừng thêm lại.
- **Radar quét**: vẽ trong mảng `sweeps` (cảnh bán kính, pha radar khi không `together`, cảnh tổng kết).
- **Máy quay luôn chuyển động**: `breathe()` cộng nhịp zoom/lia vào `camAt()` (KHÔNG cộng vào `camAtPhase`, vì pha sau lấy điểm cuối pha trước làm điểm đầu).
- **Giao diện điện thoại**: khung xem trước KHÔNG dính trên đầu và KHÔNG đổi cỡ khi cuộn (trước đây thu nhỏ khi cuộn → trang giật lên xuống). Xem thử bằng nút `#navPlay` (▶ Xem) ở thanh dưới. Bước 4 nút dưới = "Xuất video MP4". Mỗi bước có dòng `.step-guide`. Danh sách tiện ích mỗi nhóm hiện 5 điểm + "Xem thêm" (`poiOpen`).
- **Nhãn chế độ quét vòng tròn**: vị trí cố định theo `poi.labDir` (hướng ra ngoài so với nhà, tính 1 lần ở timeline), cùng một cỡ; bị che thì mờ dần (`tl._labA`), KHÔNG dò chỗ mới mỗi khung (gây lật qua lại).
- **Đường nhựa**: line mảnh (~45% bề rộng thật, ≤9 px), cắt bỏ vùng lô đất, khách tắt được (`showStreets`). Không có lô: cảnh căn nhà zoom 17,3.
- **Lô đất** (`state.lot`, `scene.lot`, ≥3 góc): chế độ sửa `editMode='lot'`, nút −/+ đổi `lotZoom` (16,5–20,5), ghim nhà luôn hiện. Video bay sát lô trong cảnh `house`, viền + sóng khoanh vùng, chữ 3D nằm dẹt trên mặt đất dưới ghim (`scene.lotLabel` = chữ + diện tích khách nhập; trống thì tự tính `lotAreaM2`). `text3D`/`fillSpaced` đã tự canh giữa — đừng dịch thêm.
- **Đường quanh nhà** (`loadStreets` trong `js/data.js` → `state.streets`/`scene.streets`): đoạn đường trong 350 m từ ô z14 (lớp `transportation` để vẽ, `transportation_name` để lấy tên); `front` = đường có tên gần nhà nhất (<120 m). Vẽ kiểu đường nhựa (viền sáng, mặt `#34373c`, vạch giữa khi đủ rộng) ở cảnh `house`, bề rộng theo mét thật (`STREET_W`). Cảnh `house` dài hơn khi có lô (7,2 s) hoặc có đường (5,2 s).
- **Trình tự mở đầu (chốt với Giang 10/2026)**: `intro` trung cảnh ghim (camMid z15,2) "Đây là vị trí … thuộc phường …", ghim thả xuống ở 30% cảnh, xã/phường sáng lên → `province` lùi ra vẽ nổi cả tỉnh/thành (ghim to hơn) "Thuộc …" → `house` bay về cận cảnh, `orbit: true` máy lượn vòng cung quanh bất động sản, đọc thông tin (diện tích, thổ cư, số tầng, phòng ngủ, đường trước nhà, pháp lý) → bán kính như cũ. KHÔNG nhắc quận/huyện. Tên xã/tỉnh: chữ phẳng Montserrat 900 vàng, đổ bóng đậm (`flatName`, `NAME_FONT`), không 3D.
- **Kịch bản AI** (`lib/script.js`): Claude Haiku 5.5 (`ANTHROPIC_API_KEY`, mặc định `claude-haiku-5-5`), lỗi/rỗng thì dự phòng Gemini (`GEMINI_API_KEY`). PHẢI tắt thinking (`thinking: {type:'disabled'}`) — Haiku 5.5 mặc định suy nghĩ, ăn hết `max_tokens` → trả rỗng. KHÔNG gửi câu mẫu cho AI (nó chép y chang) — chỉ gửi mô tả cảnh + dữ liệu cảnh. 6 phong cách `tone` (hai-huoc, ke-chuyen, chuyen-gia, tre-trung, sang-trong, chot-sale) + góc mở đầu ngẫu nhiên, temperature 1. Giới hạn số chữ từng cảnh. Cấm suy diễn (mặt tiền, xe hơi…); `duong_truoc_nha` là bề rộng đường. Đọc kết quả bằng `parseLoose` (AI hay chèn dấu " giữa câu). Thử thật: tạo phiên tạm cho tài khoản `giang.test@vitristudio.com` trong `vt_sessions` (15 phút), gọi `/api/script`, xong xoá phiên.
- **SFX radar quét bán kính** (js/sfx.js): `sonar` (ping kim loại + vang lặp) mỗi vòng quét 1,25 s và `radarHum` (ù trầm có nhịp, gió quét lướt trái↔phải) suốt lúc quét. Cửa sổ quét lấy y như `sweeps` trong render.js (overview, radar, summary) — đổi một bên phải đổi bên kia.
- **Chữ tên trục đường lớn** (`state.roadLabelFace` = `vangkim` | `trang` | `vang`, mục ② Phong cách `#labelFaceSeg`): in dẹt dọc trục đường bằng `glossyText()` (vẽ lên canvas phụ rồi dán, để vệt sáng `source-atop` chỉ lướt trên mặt chữ, không loang ra bản đồ). Hiệu ứng vào: bật phóng to + khối nổi dâng + vệt sáng; ra: thu nhỏ, mờ. `fillSpaced` TỰ canh giữa tại x — đừng trừ thêm nửa bề rộng. Ô chữ khi chọn chỗ đặt nhân `1 / s.w` (phối cảnh làm chữ gần đáy to ra).
- Đã làm thử (chưa đưa vào app, Giang chưa cần): mây mở đầu, cột sáng, số giá mạ vàng, line neon nhiều màu có xung sáng, chữ dựng đứng. Bản code thử không có trong repo; nếu cần làm lại, viết theo ý trên.
- **Bước 3 đi lần lượt 3 mục** `① Thông tin` → `② Phong cách` → `③ Giọng, nhạc` (`curSub`, `setSub(name,{scroll})`). Nút dưới (`stepNext`) và nút `.pane-next` cuối mỗi mục chuyển sang mục kế; chỉ ở mục ③ mới tạo giọng. Mục Phong cách có `.pane-guide` + `.pane-tip` giải thích khung hình, phong cách chữ, cách hiện tiện ích, nền bản đồ.
- **Phong cách kịch bản không chọn sẵn**: `state.aiTone` mặc định rỗng (căn chưa có `voSig` thì khi mở app cũng xoá về rỗng). `needTone()` true thì nút không tạo mà gọi `askTone()` (cuộn tới + nháy sáng `#aiToneSeg`).
- **Module Kịch bản & giọng đọc** (`#voCard`, mục Giọng & nhạc): ① chọn cách viết `#scriptSrcSeg` (`state.scriptMode` = `ai` mặc định, nổi bật | `mau` kịch bản mẫu; AI chưa sẵn sàng thì nút AI bị khoá và dùng mẫu) + phong cách `#aiToneSeg` ② giọng `#voiceSeg` → MỘT nút `#ttsBtn` gọi `makeScriptAndVoice()` (AI viết → đọc; AI lỗi thì đọc kịch bản mẫu). Nút dưới bước 3 (`stepNext`) gọi cùng hàm. Trạng thái `voStatus()`: none / stale (khách sửa câu hoặc đổi giọng → chỉ đọc lại câu thiếu, link phụ `#voVoiceOnly` = viết mới hoàn toàn) / changed (đổi cách viết/phong cách so với `state.voSig`) / ready (nút thành "Tạo lại", kiểu phụ). `#aiCard`, `#aiScriptBig` chỉ còn là phần tử ẩn để giữ id; `#aiVoiceOn` nằm trong mục "✏️ Xem & sửa từng câu".
- **Khoanh vùng hành chính** (`/api/map/area` → `loadAdminArea` → `state.adminArea` → `scene.adminArea`): Nominatim zoom 10 = xã/phường, zoom 5 = tỉnh/thành (OSM đã theo đơn vị mới 2025). Có ranh thì timeline: `intro` bay tới khung xã/phường → pha `area` (tỉnh viền đứt rồi xã/phường sáng, ngoài vùng tối bằng `fill(evenodd)`, tên 3D) → `house`. Tên hiển thị khách sửa được (`areaWard`, `areaProv`).
- **Giới hạn làm lại mỗi căn** (`supabase/vt_redo_limits.sql`, đã áp dụng 10/2026): 1 lượt = 1 căn, trong `reexport_hours` được `redo_exports` lần xuất (tính cả lần đầu) + `redo_tts` lần tạo giọng (các lần gọi trong cùng khung 2 phút tính là 1 lần bấm). Hết thì trừ thêm lượt. `vt__redo_left`/`vt__redo_json` là hàm nội bộ (đã revoke). `vt_me` và `vt_export_begin` trả `redo` → client `account.redo`. Sửa hàm tiền/lượt: chạy thử trong `do $do$ ... raise exception $do$` (tự huỷ) trước khi `apply_migration`.
- **CẢNH BÁO tên biến**: `state.area` / `scene.info.area` là **diện tích khách nhập**. Đừng dùng tên `area` cho thứ khác (từng làm hiện "[object Object]" và có thể ghi đè diện tích của khách).
- **Bề rộng đường**: vị trí/hướng đường là dữ liệu thật, bề rộng vẽ là ước lượng theo loại đường. Số mét chỉ hiện khi khách nhập (`roadWidth`), app không tự ghi số đoán.
- **Chữ trên lô** phải nằm TRONG lô: cỡ chữ theo bề rộng/cao lô, `g.clip(path)` theo ranh lô.
- **Tiện ích gắn sao** (`state.stars` → `poi.star`): khoanh vùng phát sáng trên mặt đất.
- **Nhóm tiện ích** (`CATEGORIES` trong `js/data.js`): thêm nhóm mới phải sửa đủ: `CATEGORIES`, `classifyPoi`, `guessCategory`, `CAT_COLORS` (render.js), `CAT_WORD`/`CAT_RANK`/`POI_LINES` (app.js), `CAT_ICON` (lib/pages.js), `NEAR_Q` (lib/map.js), biểu tượng (`js/icons.js`). Biểu tượng/câu đọc theo loại cụ thể qua `kind` (`iconOf`, `KIND_LINES`, `kindFix`): airport, station, beach, charging_station.
- **Vietmap `NEAR_Q`**: mỗi dòng `[nhóm, từ khoá, regex tên, kind, bán kính riêng, lớp]`. Khu đô thị phải tìm ở lớp `VILLAGE`. Bãi biển Vietmap không có → dựa OSM. Tên phải `normalize('NFC')` trước khi so regex. Chọn điểm xen kẽ theo loại (không chỉ theo khoảng cách) để loại xa vẫn có mặt.
- **Đường lớn**: `stitchWays()` trong `js/data.js` nối các đoạn cùng tuyến hở < 300 m, cùng hướng.
- **Giọng đọc**: giọng AI và giọng khách tự đọc đều nằm trong `media.voiceSegs` (mỗi cảnh một đoạn, khoá `voiceKey(text)`). Tự đọc: `applyOwnVoice()` — thu trong app thì cắt theo mốc bấm "Câu tiếp" (`splitAt`), tải file thì cắt theo khoảng lặng (`splitVoice`).
- **Dữ liệu tiện ích** (`js/data.js`): OSM (OpenFreeMap) + Overture (`poi/`) + **Vietmap** (`/api/map/nearby`, đầy đủ nhất ở VN). Tìm theo tên: dữ liệu đã quét + Vietmap (`/api/map/vsearch`) + Photon.
- **Vietmap / Cloudflare**: mỗi yêu cầu Worker chỉ được ~50 lần gọi ra ngoài. `nearby` = 10 lần tìm + tối đa 24 lần lấy toạ độ, không nhớ đệm từng điểm. Kết quả rỗng thì KHÔNG nhớ đệm (`noCache`). Thêm `&debug=1` để xem số kết quả từng từ khoá. Đổi logic thì đổi tên khoá nhớ đệm (`vmnear3`→`vmnear4`) để bỏ kết quả cũ.

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
- Bộ thử trong phiên Claude: Playwright + `channel="chrome"`, chạy `site/` bằng `python3 -m http.server`, mở ở `127.0.0.1`.
  Mạng ra ngoài: thêm cờ `--proxy-server=$HTTPS_PROXY` (KHÔNG dùng `proxy=` của Playwright và KHÔNG thêm `<-loopback>`, sẽ chặn trang cục bộ).
  `wait_for_function("window.fn")` sẽ GỌI hàm đó — dùng `"typeof window.fn==='function'"`.
  Chrome trong máy thử không có H.264/AAC: kiểm tra đường dự phòng ở đây, còn mã hoá thật kiểm trên máy khách.
  Micro giả: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=file.wav`.
  Xem file xuất có tiếng: `ffprobe` (có luồng audio) + `ffmpeg -af volumedetect` (mean_volume không phải -91 dB).
  Chụp khung xem trước: đặt `localStorage['vitri.project.v1']`, bấm `#scanBtn`, tua `#scrub`, chụp `#preview`; `window.__vitri.tl` xem các pha.
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
- 2026-10: Video xuất mất nhạc/giọng trên iPhone/Zalo do Opus trong MP4 → chỉ dùng AAC, không có thì quay thời gian thực.
- 2026-10: Bản đồ "mờ" do phủ màu nhân + lớp tối + ô ảnh tối đa z17 → nền "Vệ tinh rõ nét" + z18 + lọc tăng tương phản.
- 2026-10: Quét sót tiện ích gần nhà (OSM ở VN thiếu) → thêm Vietmap; lần đầu trả rỗng vì vượt giới hạn 50 lần gọi của Worker.
- 2026-10: `build.sh` xoá và tạo lại `site/` → máy chủ thử chạy *trong* `site/` bị chết; chạy `python3 -m http.server --directory site`. Đừng `pkill -f` theo mẫu có trong chính lệnh đang chạy (tự giết shell).
- 2026-10: Tên từ Vietmap có thể ở dạng Unicode tổ hợp (NFD) → regex không khớp ("Bến Xe Buýt" lọt lưới) → chuẩn hoá NFC.
- 2026-10: Sửa mất tiếng lần 1 (chỉ AAC gốc, không thì quay thời gian thực) CHƯA đủ trên điện thoại → lần 2 dùng AAC WebAssembly cho mọi máy. Bài học: đừng phụ thuộc bộ mã hoá âm thanh của trình duyệt; kiểm thử trên môi trường thiếu bộ mã hoá.
- 2026-10: Tên tỉnh canh giữa cứng tại ghim → ghim sát mép thì mất chữ ("TỈNH TÂY…"). Chữ trên mặt đất phải tính bề rộng TRÊN MÀN HÌNH (chia cho `w` phối cảnh) và kẹp trong khung an toàn.
- 2026-10: Sửa code bằng chèn chuỗi vào sau dấu `{` đầu hàm đã phá tham số dạng `{ scroll = true } = {}` → chỉ chèn sau `) {` của thân hàm, và xem lại dòng vừa sửa.
- 2026-10: Line trục đường đứt quãng do OSM thiếu cầu/nút giao giữa các đoạn → nối đầu mút cùng hướng.
- 2026-10: Đề xuất "Kết nối CRM" của Meta chỉ dành cho quảng cáo biểu mẫu tức thì, không áp dụng cho quảng cáo về web.
- 2026-10: Khách phải bấm 2 nút (AI viết rồi mới tạo giọng) dễ quên/rối → gộp thành một module một nút, kịch bản mẫu là lựa chọn phụ. Kiểm thử luồng bằng Playwright, giả /api/script và /api/tts bằng `pg.route` (không tốn lượt thật).
- 2026-10: Thẻ `.vo-card` dạng grid bị chữ dài đẩy rộng hơn màn hình (trang lệch ngang trên điện thoại) → cột grid phải là `minmax(0,1fr)`. Kiểm tra `document.documentElement.scrollWidth` bằng bề rộng màn hình sau mỗi thay đổi giao diện.
- 2026-10: Dựng video thử bằng Playwright trên máy 2 lõi rất chậm (~25 phút cho 1 phút 1080p) và bị ngắt giữa chừng → thử bằng 720p, ít tiện ích, hoặc chụp khung bằng thanh tua (`#scrub`, giá trị 0–1000 theo tỉ lệ thời lượng).
- 2026-10: Chữ tên trục đường vẽ vào canvas mặt đất bị CẮT CỤT khi nằm ngoài vùng canvas đất (máy lia/lùi xa). Sửa: vẽ trên màn hình, dùng biến đổi phối cảnh cục bộ (ma trận từ `g2s` tại điểm chữ) nên vẫn trông in dẹt. Chữ/hình có thể ra gần mép khung thì đừng vẽ vào canvas mặt đất.
- 2026-10: Đổi trình tự mở đầu (ghim rơi ở cảnh trung, thêm cảnh tỉnh) nhưng QUÊN sửa `sfxEvents` trong js/sfx.js → tiếng chạm đất lệch chỗ, cảnh lùi ra/bay vào không có whoosh. Mỗi lần đổi cảnh/thời điểm trong render.js phải sửa sfx.js theo (cùng công thức thời điểm). Kiểm tra SFX bằng OfflineAudioContext + đo đỉnh từng 0,5 s.
