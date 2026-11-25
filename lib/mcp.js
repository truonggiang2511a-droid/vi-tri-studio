// Máy chủ MCP "Vị Trí Studio" cho Claude của khách — 20/11/2026 (Streamable HTTP, chỉ JSON, không SSE).
// Claude tạo / xem / sửa video AI đạo diễn. Phần nặng (quét bản đồ, chọn tiện ích, đọc giọng, dựng 3D, xuất MP4, trừ lượt) vẫn chạy
// trên trang /dao-dien?p=<id> trong trình duyệt của khách như cũ — Worker gói miễn phí không đủ CPU / số lần gọi ra ngoài để quét.
// Trang dựng xong gửi "ảnh chụp" (snap: cảnh, lời, tiện ích, số liệu thật) lên vt_dd_projects; Claude đọc qua xem_video,
// sửa qua sua_video (rev tăng) → trang đang mở hỏi 4 giây/lần, thấy bản mới thì áp dụng, đọc lại giọng câu đã đổi, dựng lại.
// Lời Claude viết được máy kiểm tra như lib/script.js: số / chi tiết không có trong dữ liệu → từ chối câu đó (khách dễ tin, không bịa).
// Danh mục (khách mua, phong cách, nhạc, mẫu thẻ…) chép từ js/dd-agent.js + js/dao-dien.js — đổi bên đó thì đổi ở đây.
import { json, rpc, env } from './vt.js';
import { base, prmUrl } from './oauth.js';
import { handleResolve } from './resolve.js';
import { parseListing, summaryChips, KINDS } from '../js/dd-parse.js';
import { parseCoords, haversineKm } from '../js/geo.js';

const VERSION = '1.0.0';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': 'www-authenticate, mcp-session-id' };
const link = id => `${base()}/dao-dien?p=${id}`;

// ---------- Danh mục tài nguyên của Vị Trí Studio ----------
const BUYERS = { o: 'Mua để ở (gia đình, có con nhỏ — trường, chợ, bệnh viện gần)', vung: 'Đầu tư sinh lời (hạ tầng đang làm, kết nối vùng, giá mỗi m²)',
  thue: 'Đầu tư cho thuê (người thuê: công nhân, sinh viên, người đi làm)' };
const TONES = {
  auto: 'Tự chọn theo khách mua (để ở → P.A.S, sinh lời → Chuyên gia, cho thuê → A.I.D.A)',
  pas: 'P.A.S — đánh trúng nỗi đau (con đi học xa, phòng trống…) rồi dùng số liệu thật làm lời giải',
  aida: 'A.I.D.A — chú ý mạnh 2 giây đầu → quan tâm → mong muốn → hành động',
  'ke-chuyen': 'Kể chuyện — vẽ ra một ngày sống ở đây, ấm áp, gần gũi',
  'chuyen-gia': 'Chuyên gia đầu tư — điềm tĩnh, hạ tầng, kết nối, giá mỗi m² (không hứa tăng giá)',
  'chot-sale': 'Chốt sale mạnh — thẳng vào lợi ích + giá, khan hiếm vừa phải, kêu gọi dứt khoát',
};
const MUSIC = { 'hung-hon': 'Hùng hồn · điện ảnh (mặc định)', 'tran-ca': 'Trống trận · mạnh mẽ', 'dang-cap': 'Đẳng cấp · trailer', 'cong-nghe': 'Công nghệ · hiện đại',
  'khoi-dau': 'Khởi đầu · truyền cảm hứng', 'soi-dong': 'Sôi động · nhịp nhanh', 'tuoi-sang': 'Tươi sáng · vui tươi', 'sang-trong': 'Sang trọng · trầm ấm', 'nhe-nhang': 'Nhẹ nhàng · piano' };
const FLOWS = { radar: 'Radar quét quanh nhà — mỗi tiện ích một nhãn tên (mặc định, tối đa 5 tiện ích được đọc tên)', lanluot: 'Bay tới từng tiện ích — vẽ đường đi thật, mỗi tiện ích một cảnh (vẽ như app cũ)' };
const LABELS = { trang: 'Thẻ trắng (kiểu bản đồ, mặc định)', kinh: 'Thẻ kính tối', mau: 'Thẻ màu theo loại tiện ích' };
const CATS = { truong: 'Trường học', yte: 'Bệnh viện / Y tế', cho: 'Chợ / Siêu thị', hanhchinh: 'Hành chính', congvien: 'Công viên / Thể thao', kcn: 'Khu công nghiệp',
  khudothi: 'Khu đô thị', giaothong: 'Sân bay / Nhà ga / Bến xe', congcong: 'Công cộng', nganhang: 'Ngân hàng' };
const CTA_KEY = { phong: 'XEM PHÒNG', matbang: 'XEM MẶT BẰNG', duan: 'XEM DỰ ÁN', nhapho: 'XEM NHÀ', bietthu: 'XEM BIỆT THỰ', nhavuon: 'XEM NHÀ VƯỜN', canho: 'XEM CĂN HỘ', datnen: 'XEM ĐẤT' };
const voices = () => env('TTS_PROVIDER') === 'google' || !env('TTS_PROVIDER')
  ? { 'nu-nam': 'Nữ HD (mặc định)', 'g-nam-hd': 'Nam HD', 'g-nu': 'Nữ', 'g-nam': 'Nam' }
  : { 'nu-nam': 'Nữ miền Nam (mặc định)', 'nam-nam': 'Nam miền Nam', 'nu-bac': 'Nữ miền Bắc', 'nam-bac': 'Nam miền Bắc', 'nu-trung': 'Nữ miền Trung', 'nam-trung': 'Nam miền Trung' };
// cảnh → mô tả + số chữ tối đa (khớp LONG trong lib/script.js, AI đạo diễn)
const SCENES = {
  intro: ['Mở đầu: quả địa cầu bay xuống tỉnh/thành → xã/phường → ghim nhà. Nói vị trí (tỉnh, xã) trước rồi câu móc mạnh', 38],
  house: ['Cận cảnh căn nhà, máy lượn TRỌN 1 vòng 360°: kể như dẫn khách đi một vòng (đường, kích thước, kết cấu, pháp lý, điểm nổi bật)', 62],
  lot: ['Cận cảnh lô đất (khoanh ranh), máy lượn 1 vòng: kích thước, diện tích, loại đất, pháp lý, điểm nổi bật', 62],
  roads: ['Câu hỏi "Sống ở đây có tiện không?" + các trục đường lớn hiện lần lượt (mỗi trục 1 câu ngắn, đúng tên, đúng số phút)', 50],
  radar: ['Radar quét bán kính quanh nhà, tiện ích hiện lần lượt kèm tên — kể đúng tên ngắn, đúng thứ tự', 70],
  overview: ['(kiểu bay tới từng tiện ích) Toàn cảnh bán kính: mở bằng "Sống ở đây có tiện không?"', 36],
  rd: ['(kiểu bay tới từng tiện ích) Một trục đường lớn: 1 câu ngắn', 22],
  poi: ['(kiểu bay tới từng tiện ích) Một tiện ích: đường đi thật sáng lên', 26],
  anchor: ['Kết nối vùng: đường đi thật tới trung tâm / sân bay / cảng', 30],
  metro: ['Tuyến metro', 30], road: ['Cảnh cao tốc / đường lớn', 26],
  build: ['Hạ tầng đang thi công gần nhà (không nêu năm hoàn thành, không hứa tăng giá)', 34],
  score: ['"Vì sao nên mua?" — nêu đúng các lý do theo thứ tự, lý do cuối là lý do lớn nhất', 56],
  summary: ['(kiểu bay tới từng tiện ích) Tổng kết "Vì sao nên mua?"', 56],
  cta: ['Kêu gọi: nói giá (nếu để giá cuối) rồi mời bình luận / nhắn tin từ khoá để nhận thông tin chi tiết', 34],
  photos: ['Ảnh thực tế cuối video (câu mặc định: "Đây là hình ảnh thực tế của sản phẩm, anh chị xem qua nhé.")', 18],
  cluster: ['Gom nhiều tiện ích vào 1 cảnh', 30], orbit: ['Lượn 360° góc xa quanh nhà, tiện ích hiện lần lượt', 70],
};
const sceneMax = k => SCENES[k.split(':')[0]]?.[1] || 30;
const PRE_KEYS = ['intro', 'house', 'lot', 'cta', 'photos'];   // viết được ngay khi chưa dựng (không phụ thuộc quét bản đồ)

const INSTRUCTIONS = `Vị Trí Studio (vitristudio.com) làm video bản đồ vị trí bất động sản khổ dọc 9:16 cho TikTok, Reels, Shorts (chế độ "AI đạo diễn"): bay từ quả địa cầu xuống tỉnh → xã → căn nhà, lượn 360° quanh căn, radar tiện ích THẬT quanh nhà, trục đường lớn, kết nối vùng (trung tâm, sân bay, cảng), hạ tầng đang thi công, thẻ "Vì sao nên mua?", lời đọc giọng AI, nhạc nền, phụ đề, ảnh bìa.

Cách làm:
1. tao_video: vi_tri (toạ độ "10.7285, 106.6185" hoặc link Google Maps) + tin_dang (dán nguyên tin môi giới) + khach (o | vung | thue). Nhận link /dao-dien?p=…
2. Gửi link cho người dùng mở trên trình duyệt đã đăng nhập vitristudio.com (điện thoại hoặc máy tính) và GIỮ TRANG MỞ. Trang tự quét bản đồ, chọn tiện ích, viết lời, đọc giọng, dựng 3D (khoảng 30–90 giây). Bạn không tự quét bản đồ hay dựng video được.
3. xem_video: đọc từng cảnh (key, mô tả, dữ liệu thật, lời hiện tại, số chữ tối đa), tiện ích đã chọn + gợi ý (id), trục đường, kết nối vùng, lý do nên mua, bài đăng gợi ý. trang_thai "cho_dung" hoặc "dang_cap_nhat" → đợi khoảng 20 giây rồi gọi lại.
4. sua_video: viết lại lời (loi: {key: "câu"}), thêm/bỏ tiện ích theo id, đổi trục đường, phong cách, nhạc, giọng, kiểu hiện tiện ích, từ khoá kêu gọi… Trang đang mở tự cập nhật sau vài giây và chỉ đọc lại giọng câu đã đổi. Nhiều thay đổi thì gộp trong MỘT lần gọi.
3b. DUYỆT TRƯỚC KHI DỰNG (khi người dùng chỉ gửi vị trí + thông tin và muốn bạn tự sáng tạo): sau xem_video, KHÔNG sửa ngay. Soạn KỊCH BẢN ĐỀ XUẤT thu hút nhất theo đúng thứ tự các cảnh (mỗi cảnh: ý chính + lời + tiện ích / đường / hạ tầng sẽ nhấn), trình cho người dùng trong chat, hỏi muốn thêm / bớt / sửa gì. Chỉ khi họ đồng ý mới gọi sua_video áp dụng.
3c. Điểm xa bất kỳ trong Việt Nam (vd. "đi cao tốc ra Hà Nội"): dùng sua_video.diem_den. Nếu AI của bạn đã có dữ liệu bản đồ (tìm kiếm, kết nối bản đồ) thì đưa km, phut, duong để bên mình khỏi tốn dịch vụ; số liệu phải thật, không có thì để trống (video ghi "ước chừng"). Quãng đường dài ghi bằng giờ ("khoảng 28 giờ"), đừng ghi hàng nghìn phút.
5. Người dùng xem lại rồi bấm "Xuất video" trên trang (trừ lượt như bình thường). Bạn có thể viết caption, hashtag, bình luận ghim từ bai_dang + số liệu.

Luật viết lời (máy từ chối câu sai, kèm lý do):
- Chỉ dùng số liệu và chi tiết có trong dữ liệu của xem_video hoặc trong tin đăng. Không tự thêm: mặt tiền, hẻm xe hơi, an ninh, view, dân trí, yên tĩnh, tăng giá, sinh lời, lợi nhuận… Người dùng kể thêm điều thật về căn (nội thất, hẻm xe hơi, hướng…) thì cập nhật tin đăng trước (sua_video.tin_dang_them) rồi mới đưa vào lời.
- Không đọc số điện thoại. Viết đầy đủ "Thành phố Hồ Chí Minh", "quốc lộ"; số thập phân dùng dấu phẩy ("1,2 km"); khoảng cách viết bằng số; không emoji, không dấu ngoặc kép.
- Gọi tiện ích, trục đường đúng tên ngắn như trong dữ liệu: nhãn trên video bật lên đúng lúc giọng đọc nói tên.
- Cảnh căn nhà (house/lot) viết 45–60 chữ vì máy lượn trọn 1 vòng; cảnh khác ngắn, gọn, không vượt toi_da_chu.
- Trả lời 2 câu người mua hay hỏi: "Sống ở đây có tiện không?" (cảnh roads/radar) và "Vì sao nên mua?" (cảnh score). Không hứa tăng giá, lời lãi.
- Lời kết (cta): kêu gọi bình luận hoặc nhắn tin từ khoá để nhận thông tin chi tiết về sản phẩm, rồi dừng.
- Giọng gần gũi, chân thành như môi giới có tâm, đúng phong cách người dùng chọn.`;

// ---------- Kiểm tra lời Claude viết (như checkScript của lib/script.js) ----------
const NUM_RE = /\d+(?:[.,]\d+)*/g;
const toNum = x => { const t = String(x); if (/^\d{1,3}(\.\d{3})+$/.test(t)) return parseFloat(t.replace(/\./g, '')); return parseFloat(t.replace(/\./g, '').replace(',', '.')); };
const BANNED = ['mặt tiền', 'hẻm xe hơi', 'xe hơi', 'ô tô đậu', 'dân trí', 'an ninh', 'view ', 'sắp tăng giá', 'chắc chắn tăng', 'tăng giá', 'lợi nhuận', 'sinh lời',
  'đông đúc', 'nhà đẹp', 'quỹ căn', 'không còn nhiều', 'sạch sẽ', 'giữ giá', 'yên tĩnh', 'thoáng mát', 'cơ hội vàng', 'hiếm có', 'lời ngay', 'x2', 'nhân đôi'];
const ABBR = [[/\bTP\.?\s?HCM\b|\bTPHCM\b|\bHCMC\b/gi, 'Thành phố Hồ Chí Minh'], [/\bQL\.?\s?(\d)/g, 'quốc lộ $1'], [/\bTL\.?\s?(\d)/g, 'tỉnh lộ $1'],
  [/\bKCN\b/g, 'khu công nghiệp', 1], [/\bUBND\b/g, 'Ủy ban nhân dân', 1], [/(\d)\s*(m2|m²)(?![\p{L}\d])/gu, '$1 mét vuông', 1], [/\bBV\b/g, 'bệnh viện', 1]];
// số / chữ được phép = CHỈ giá trị dữ liệu thật (tin đăng, số liệu quét, lời Agent chưa sửa) — không lấy tên khoá JSON
// ("overview" chứa "view") hay số kỹ thuật (thời lượng video, số bản…). Số có đơn vị so đúng loại: "N phút" chỉ so với số phút
// trong dữ liệu, "N km / N mét" chỉ so với khoảng cách (đổi km↔mét) — tránh "99 phút" lọt vì có tiện ích cách 99 m.
const MIN_KEY = /^(phut|phut_o_to|phut_xe_may|phut_xe|min)$/, KM_KEY = /^(cach_km|km|ban_kinh_km|duong_di_km|nearKm)$/;
const UNIT_RE = /(\d+(?:[.,]\d+)*)\s*(phút|km|ki lô mét|cây số|mét vuông|m²|m2|mét|m)(?![\p{L}\d²])/giu;
function factBase(snap, listing, fix) {
  const vals = [], mins = [], kms = [];
  const walk = (x, k = '') => {
    if (x == null) return;
    if (typeof x === 'object') { for (const [kk, v] of Object.entries(x)) walk(v, Array.isArray(x) ? k : kk); return; }
    vals.push(String(x));
    if (typeof x === 'number') { if (MIN_KEY.test(k)) mins.push(x); if (KM_KEY.test(k)) kms.push(x); }
  };
  walk({ listing, fix: fix || {}, parsed: parseListing(listing || '') });
  if (snap) walk({ so_lieu: snap.so_lieu, canh: (snap.canh || []).map(c => ({ du: c.du_lieu, loi: c.da_sua ? '' : c.loi })), radar: snap.radar, ly_do: snap.ly_do,
    tien_ich: snap.tien_ich_da_chon, goi_y: (snap.tien_ich_goi_y || []).map(x => ({ ten: x.ten, cach_km: x.cach_km })), truc: snap.truc_duong,
    truc_goi_y: (snap.truc_duong_goi_y || []).map(x => ({ ten: x.ten, cach_km: x.cach_km })), moc: snap.diem_moc, ha_tang: snap.ha_tang, thi_cong: snap.dang_thi_cong,
    xa: snap.xa, tinh: snap.tinh, hieu: snap.hieu_tin_dang });
  const src = vals.join(' \n ');
  for (const m of src.matchAll(UNIT_RE)) {
    const n = toNum(m[1]), u = m[2].toLowerCase();
    if (!Number.isFinite(n)) continue;
    if (u === 'phút') mins.push(n); else if (/^(km|ki lô mét|cây số)$/.test(u)) kms.push(n); else if (u === 'mét' || u === 'm') kms.push(n / 1000);
  }
  const nums = [];
  for (const m of src.match(NUM_RE) || []) { const n = toNum(m); if (Number.isFinite(n)) nums.push(n, n * 1000, n / 1000); }
  return { nums, mins, kms, low: src.toLowerCase() };
}
// một số trong lời Claude viết có trong dữ liệu không (theo đơn vị đi kèm)
function numOk(n, unit, fb) {
  if (n <= 1 || n === 360) return true;
  const near = (list, x, abs, rel) => list.some(a => Math.abs(x - a) <= Math.max(abs, a * rel));
  const u = (unit || '').toLowerCase();
  if (u === 'phút') return near(fb.mins, n, 1, 0.1);
  if (/^(km|ki lô mét|cây số)$/.test(u)) return near(fb.kms, n, 0.06, 0.06);
  if (u === 'mét' || u === 'm') return near(fb.kms, n / 1000, 0.015, 0.06) || near(fb.nums, n, 0.06, 0.06);   // "8 mét" bề rộng đường, "5 mét" ngang nhà
  return near(fb.nums, n, 0.06, 0.06);
}
function checkLine(key, text, fb) {
  const bad = [], warn = [];
  let v = String(text ?? '').normalize('NFC').replace(/["“”]/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
  for (const [re, to, quiet] of ABBR) if (re.test(v)) { v = v.replace(re, to); if (!quiet) warn.push(`đã đổi chữ viết tắt thành "${to.replace(' $1', '')}" cho giọng đọc`); }
  if (v.length > 700) bad.push('câu quá dài (tối đa 700 ký tự)');
  if (/(?:\+?84|0)(?:[\s.-]?\d){8,10}/.test(v)) bad.push('có số điện thoại — video không đọc số điện thoại (khách liên hệ qua bình luận / nhắn tin)');
  const seen = new Set();
  for (const m of v.matchAll(UNIT_RE)) {
    const n = toNum(m[1]); seen.add(m.index);
    if (Number.isFinite(n) && !numOk(n, m[2], fb)) bad.push(`"${m[0]}" không khớp dữ liệu`);
  }
  for (const m of v.matchAll(NUM_RE)) {
    if (seen.has(m.index)) continue;
    const n = toNum(m[0]);
    if (Number.isFinite(n) && !numOk(n, '', fb)) bad.push(`số "${m[0]}" không có trong dữ liệu`);
  }
  const lv = v.toLowerCase();
  for (const w of BANNED) if (lv.includes(w) && !fb.low.includes(w.trim())) bad.push(`"${w.trim()}" không có trong dữ liệu / tin đăng`);
  const words = v.split(/\s+/).filter(Boolean).length, max = sceneMax(key);
  if (words > max + 8) warn.push(`dài ${words} chữ (nên ≤ ${max}) — video sẽ kéo dài cảnh này`);
  if (key === 'cta' && /hẹn|đi xem|tận nơi|tận mắt/i.test(v)) warn.push('lời kết mặc định dừng ở kêu gọi bình luận / nhắn tin, không hẹn đi xem (giữ nếu người dùng muốn)');
  return { v, bad, warn };
}
const escH = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bold = v => escH(v).replace(/(\d[\d.,]*\s*(km|m²|mét vuông|mét|m|phút|tỷ|triệu)?)/g, '<b>$1</b>');
const plain = s => String(s || '').replace(/<\/?b>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---------- Vị trí: toạ độ, link Google Maps (cả link rút gọn) ----------
async function readCoord(text) {
  let t = String(text || '').trim();
  const short = t.match(/https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+/i);
  if (short) {
    const r = await handleResolve(new Request(base() + '/api/resolve?u=' + encodeURIComponent(short[0])));
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) throw new Error('Chưa mở được link Google Maps rút gọn. Nhờ người dùng nhấn giữ vào căn nhà trên Google Maps rồi chép toạ độ (dạng 10.7285, 106.6185).');
    t = j.url;
  }
  const c = parseCoords(t);
  if (!c || c.error) throw new Error('Chưa đọc được vị trí. Dùng toạ độ dạng "10.7285, 106.6185" hoặc link Google Maps có toạ độ.');
  if (c.lat < 8 || c.lat > 23.6 || c.lng < 102 || c.lng > 110) throw new Error('Toạ độ không nằm trong Việt Nam.');
  return { lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 };
}

// ---------- Trạng thái video ----------
function status(p) {
  const seen = p.seen_at ? (Date.now() - Date.parse(p.seen_at)) / 1000 : Infinity, open = seen < 25;
  if (!p.snap) return { trang_thai: 'cho_dung', trang_mo: open, giai_thich: open ? 'Trang đang mở và đang dựng video — đợi khoảng 20–60 giây rồi gọi lại xem_video.'
    : `Chưa dựng: người dùng cần mở link ${link(p.id)} trên trình duyệt đã đăng nhập vitristudio.com và giữ trang mở. Trang tự quét bản đồ và dựng video.` };
  if (p.snap_rev < p.rev) return { trang_thai: 'dang_cap_nhat', trang_mo: open, giai_thich: open ? 'Trang đang mở, đang áp dụng chỉnh sửa mới nhất (đọc lại giọng câu đã đổi, dựng lại) — gọi lại xem_video sau khoảng 15–30 giây. Dữ liệu bên dưới là bản trước đó.'
    : `Đã lưu chỉnh sửa nhưng trang đang đóng: người dùng mở lại link ${link(p.id)} để áp dụng. Dữ liệu bên dưới là bản dựng trước đó.` };
  return { trang_thai: 'san_sang', trang_mo: open, giai_thich: open ? 'Video đã dựng theo bản mới nhất, trang đang mở — người dùng xem lại và bấm "Xuất video" trên trang.'
    : `Video đã dựng theo bản mới nhất. Người dùng mở ${link(p.id)} để xem và bấm "Xuất video".` };
}
const cut = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);

// ---------- Các lệnh ----------
async function taiNguyen(tok) {
  const me = await rpc('vt_mcp_me', { p_access: tok });
  return {
    tai_khoan: { dang_nhap: me.login, ten: me.name || '', luot_con: me.credits, khong_gioi_han_den: me.unlimited_until, khong_gioi_han: !!me.unlimited,
      duoc_dung_claude: !!me.plan_ok, so_video_da_luu: me.videos,
      ghi_chu: me.plan_ok ? 'Xuất video vẫn bấm trên trang (gói Không giới hạn: tối đa ' + (me.unlimited_daily_exports || 10) + ' căn mới mỗi ngày).' : 'Tài khoản này chưa dùng được kết nối Claude.' },
    quy_trinh: INSTRUCTIONS.split('\n\n')[1],
    loai_bds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])),
    khach_mua: BUYERS,
    phong_cach_loi: TONES,
    kieu_hien_tien_ich: FLOWS,
    mau_the_tien_ich: LABELS,
    nhac_nen: MUSIC,
    giong_doc: { ...voices(), 'vb:<mã giọng>': 'Giọng Vbee (kể cả giọng nhân bản) — chỉ dùng được khi người dùng đã kết nối Vbee trong app trên chính máy mở trang; không có thì trang tự dùng giọng mặc định' },
    keu_goi: { cach: { binhluan: 'Bình luận từ khoá (mặc định)', nhantin: 'Nhắn tin từ khoá' }, tu_khoa_mac_dinh: CTA_KEY, toi_da: '18 ký tự' },
    tuy_chon: { qua_dia_cau: 'Mở đầu từ quả địa cầu (mặc định bật, thêm ~4 giây)', gia_cuoi: 'Giá để cuối video (mặc định bật — khách tò mò xem hết)',
      ban_day_du: 'Bản đầy đủ cho YouTube/Zalo (nhiều tiện ích hơn, dài hơn; mặc định tắt)', duong_chim_bay: 'Vẽ đường chim bay thay đường đi', thuong_hieu: 'Chữ thương hiệu mờ trên video (≤ 40 ký tự)',
      doi_mau_bia: 'Đổi màu ảnh bìa' },
    nhom_tien_ich: CATS,
    canh: Object.fromEntries(Object.entries(SCENES).map(([k, [d, n]]) => [k.match(/^(rd|poi|anchor)$/) ? k + ':<id>' : k, `${d} · tối đa ${n} chữ`])),
    gioi_han: 'Tạo 30 video / ngày, sửa 400 lần / ngày qua Claude. Tối đa 8 tiện ích, 5 trục đường, 5 điểm mốc mỗi video.',
  };
}


// 25/11 điểm đến tự do (vd. "đi ô tô ra Hà Nội"): Claude của khách đưa tên + vị trí (+ km / phút / đường đi nếu AI của khách đã có dữ liệu bản đồ
// → bên mình không gọi lại dịch vụ). Dữ liệu ngoài chưa kiểm chứng nên chỉ nhận khi hợp lý; thiếu thì trang tự lấy 1 lần hoặc ước lượng "ước chừng".
const inVN = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= 8 && lat <= 23.6 && lng >= 102 && lng <= 110;
const DEST_MAX = 3;
async function applyDest(a, opts, house, report) {
  if (a.diem_den == null) return false;
  if (!Array.isArray(a.diem_den)) { report.tu_choi.push({ muc: 'diem_den', ly_do: 'phải là danh sách (rỗng = bỏ hết điểm đến tự do)' }); return false; }
  const out = [];
  for (const d of a.diem_den.slice(0, DEST_MAX)) {
    try {
      const ten = String(d?.ten || '').trim().slice(0, 50);
      if (!ten) { report.tu_choi.push({ muc: 'diem_den', ly_do: 'thiếu tên điểm đến' }); continue; }
      const pos = Number.isFinite(d.lat) && Number.isFinite(d.lng) ? { lat: d.lat, lng: d.lng } : await readCoord(d.vi_tri);
      if (!inVN(pos.lat, pos.lng)) { report.tu_choi.push({ muc: 'diem_den', ly_do: `"${ten}": toạ độ ngoài Việt Nam` }); continue; }
      const bird = haversineKm(house, pos);
      if (bird < 0.6) { report.tu_choi.push({ muc: 'diem_den', ly_do: `"${ten}" trùng chỗ căn nhà` }); continue; }
      const e = { id: 'x' + ten.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '').slice(0, 10) + Math.round(pos.lat * 100), ten, lat: pos.lat, lng: pos.lng };
      if (['center', 'airport', 'port', 'station', 'metro'].includes(d.loai)) e.loai = d.loai;
      // số liệu AI của khách đưa: km phải ≥ chim bay (trừ 5%) và ≤ 2,5 lần; tốc độ trung bình 18–110 km/h → mới nhận
      if (Number.isFinite(d.km) && d.km >= bird * 0.95 && d.km <= bird * 2.5 + 2) {
        e.km = Math.round(d.km * 10) / 10;
        if (Number.isFinite(d.phut) && d.phut > 0 && e.km / d.phut * 60 >= 18 && e.km / d.phut * 60 <= 110) e.phut = Math.round(d.phut);
        else if (d.phut != null) report.canh_bao.push({ muc: 'diem_den', ghi_chu: `"${ten}": số phút không hợp lý với ${e.km} km — bỏ, trang sẽ ước lượng` });
      } else if (d.km != null) report.canh_bao.push({ muc: 'diem_den', ghi_chu: `"${ten}": km không hợp lý (chim bay ${bird.toFixed(0)} km) — bỏ, trang sẽ tự lấy đường đi` });
      if (Array.isArray(d.duong) && d.duong.length >= 2 && d.duong.length <= 400 && d.duong.every(q => Array.isArray(q) && inVN(+q[0], +q[1]))) e.duong = d.duong.map(q => [+(+q[0]).toFixed(4), +(+q[1]).toFixed(4)]);
      e.nguon = e.km ? 'ai_khach' : 'uoc_luong';
      out.push(e);
    } catch (err) { report.tu_choi.push({ muc: 'diem_den', ly_do: `"${d?.ten || ''}": ${err.message}` }); }
  }
  if (!out.length && report.tu_choi.some(x => x.muc === 'diem_den') && a.diem_den.length) return false;   // toàn bộ bị từ chối → giữ nguyên điểm đến cũ
  opts.diem_den = out;
  report.da_sua.push('điểm đến tự do: ' + (out.map(x => x.ten + (x.km ? ` (${x.km} km${x.phut ? ', ' + x.phut + ' phút' : ''}, theo AI của khách)` : ' (số liệu sẽ ước lượng)')).join('; ') || '(bỏ hết)'));
  return true;
}
async function taoVideo(a, tok) {
  const listing = String(a.tin_dang || '').trim();
  let pos = null;
  if (a.vi_tri) pos = await readCoord(a.vi_tri);
  else {
    const L0 = parseListing(listing);
    if (L0.coord) pos = L0.coord;
    else if (L0.mapLink) pos = await readCoord(L0.mapLink);
  }
  if (!pos) throw new Error('Cần vi_tri: toạ độ (vd "10.7285, 106.6185") hoặc link Google Maps của bất động sản.');
  const L = parseListing(listing);
  const edits = {}, opts = {}, report = applyOptions(a, edits, opts, L);
  await applyDest(a, opts, pos, report);
  const fix = sanitizeFix(a.sua_thong_tin, a.tieu_de);
  if (fix) opts.fix = fix;
  // lời viết sẵn trước khi dựng: chỉ các cảnh không phụ thuộc quét bản đồ
  if (a.loi && typeof a.loi === 'object') {
    const fb = factBase(null, listing, fix);
    for (const [k, t] of Object.entries(a.loi)) {
      if (!PRE_KEYS.includes(k)) { report.tu_choi.push({ canh: k, ly_do: 'chưa dựng video nên chưa có cảnh này — đợi trang dựng xong, gọi xem_video rồi sua_video' }); continue; }
      const c = checkLine(k, t, fb);
      if (c.bad.length) { report.tu_choi.push({ canh: k, ly_do: c.bad.join('; ') }); continue; }
      if (c.v) { (edits.lines ||= {})[k] = bold(c.v); report.da_sua.push(`lời cảnh ${k}`); }
      if (c.warn.length) report.canh_bao.push({ canh: k, ghi_chu: c.warn.join('; ') });
    }
  }
  const buyer = ['o', 'vung', 'thue'].includes(a.khach) ? a.khach : (L.kind === 'datnen' || L.kind === 'nhavuon' ? 'vung' : 'o');
  const p = await rpc('vt_mcp_dd_create', { p_access: tok, p_data: { lat: pos.lat, lng: pos.lng, coord: `${pos.lat}, ${pos.lng}`, listing, buyer,
    title: fix?.title || L.title || '', edits, opts } });
  const warn = [];
  if (!listing) warn.push('Chưa có tin đăng: video chỉ có vị trí + tiện ích. Nên thêm giá, diện tích, kết cấu, pháp lý (sua_video.tin_dang).');
  else for (const [k, t] of [['price', 'giá'], ['dims', 'kích thước'], ['legal', 'pháp lý']]) if (!L[k] && !fix?.[k]) warn.push(`Tin đăng chưa thấy ${t} — có thì thêm vào để lời đọc đầy đủ hơn.`);
  if (L.phones?.length) warn.push('Tin có số điện thoại: video KHÔNG đọc / hiện số này (khách liên hệ qua bình luận / nhắn tin).');
  return {
    id: p.id, link: link(p.id), ban: p.rev,
    vi_tri: `${pos.lat}, ${pos.lng}`, khach_mua: buyer + ' — ' + BUYERS[buyer],
    hieu_tin_dang: summaryChips({ ...L, ...(fix || {}) }),
    ...report, luu_y: warn,
    buoc_tiep: `Gửi link ${link(p.id)} cho người dùng mở trên trình duyệt đã đăng nhập vitristudio.com và giữ trang mở. Trang tự quét bản đồ, viết lời, đọc giọng, dựng video (30–90 giây). Sau đó gọi xem_video (id ${p.id}) để đọc kịch bản và viết lại cho hay hơn.`,
  };
}

async function danhSach(a, tok) {
  const list = await rpc('vt_mcp_dd_list', { p_access: tok, p_limit: Math.min(50, Math.max(1, +a.so_luong || 20)) });
  return { so_video: list.length, video: list.map(p => ({ id: p.id, ten: p.title || '(chưa đặt tên)', loai: p.kind ? KINDS[p.kind]?.label : null, xa: p.ward || null,
    thoi_luong_giay: p.dur ?? null, cap_nhat: p.updated_at, nguon: p.source === 'web' ? 'dựng trên web' : 'Claude tạo', link: link(p.id),
    trang_thai: !p.snap_at ? 'cho_dung' : p.snap_rev < p.rev ? 'dang_cap_nhat' : 'san_sang' })) };
}

async function xemVideo(a, tok) {
  const p = await rpc('vt_mcp_dd_get', { p_access: tok, p_id: a.id });
  const s = p.snap, full = a.chi_tiet === 'day_du';
  const out = { id: p.id, link: link(p.id), ...status(p), ban: p.rev, ban_da_dung: p.snap_rev, cap_nhat: p.updated_at, sua_lan_cuoi: p.by === 'web' ? 'người dùng trên web' : 'Claude',
    tin_dang: p.listing, khach_mua: p.buyer ? p.buyer + ' — ' + BUYERS[p.buyer] : null, sua_thong_tin: p.opts?.fix || null };
  if (!s) {
    const L = parseListing(p.listing);
    return { ...out, hieu_tin_dang: summaryChips({ ...L, ...(p.opts?.fix || {}) }), loi_viet_san: Object.fromEntries(Object.entries(p.edits?.lines || {}).map(([k, v]) => [k, plain(v)])),
      canh_viet_duoc_truoc: PRE_KEYS };
  }
  return {
    ...out,
    video: { tieu_de: s.tieu_de, loai: s.loai_ten, xa: s.xa, tinh: s.tinh, thoi_luong_giay: s.thoi_luong_giay, phong_cach: s.phong_cach, phong_cach_chon: s.phong_cach_chon,
      kieu_hien: s.kieu_hien, nhac: s.nhac, giong: s.giong, tuy_chon: s.tuy_chon, giong_doc: s.giong_doc, anh_thuc_te: s.anh },
    hieu_tin_dang: s.hieu_tin_dang,
    canh: (s.canh || []).map(c => ({ key: c.key, ten: c.ten, mo_ta: c.mo_ta, du_lieu: c.du_lieu, loi: c.loi, toi_da_chu: c.toi_da_chu, da_sua: !!c.da_sua, co_giong: c.co_giong })),
    tien_ich_da_chon: s.tien_ich_da_chon,
    tien_ich_goi_y: cut(s.tien_ich_goi_y, full ? 150 : 40),
    radar: s.radar,
    truc_duong: s.truc_duong, truc_duong_goi_y: cut(s.truc_duong_goi_y, full ? 20 : 10),
    diem_moc: s.diem_moc, ha_tang: s.ha_tang, dang_thi_cong: s.dang_thi_cong,
    ly_do_nen_mua: s.ly_do,
    so_lieu: s.so_lieu,
    bai_dang: s.bai_dang,
    luu_y: s.luu_y,
    goi_y: 'Đọc mo_ta + du_lieu từng cảnh rồi viết lại loi cho hay hơn bằng sua_video.loi (giữ đúng số liệu, đúng tên, không vượt toi_da_chu). chi_tiet: "day_du" để xem thêm tiện ích gợi ý và toàn bộ số liệu.',
  };
}

function sanitizeFix(f, title) {
  const map = { tieu_de: 'title', gia: 'price', kich_thuoc: 'dims', ket_cau: 'floors', phong_ngu: 'beds', phap_ly: 'legal', loai: 'kind', loai_dat: 'thoCu', duong_truoc_nha: 'road' };
  const out = {};
  if (title) out.title = String(title).trim().slice(0, 60);
  for (const [k, v] of Object.entries(f && typeof f === 'object' ? f : {})) {
    const key = map[k]; if (!key) continue;
    let val = String(v ?? '').trim().slice(0, 60);
    if (key === 'kind' && val && !KINDS[val]) continue;
    if (key === 'beds') val = val ? (parseInt(val, 10) || '') : '';
    if (key === 'dims' && val) { const m = val.match(/([\d.,]+)\s*[x×*]\s*([\d.,]+)/); if (m) { out.w = +m[1].replace(',', '.'); out.l = +m[2].replace(',', '.'); val = `${m[1]}×${m[2]} m`; } }
    out[key] = val === '' ? null : val;
  }
  return Object.keys(out).length ? out : null;
}

// tuỳ chọn chung của tao_video / sua_video → edits (buildStory) + opts (trang đọc riêng)
function applyOptions(a, edits, opts, L) {
  const r = { da_sua: [], tu_choi: [], canh_bao: [] };
  const set = (cond, fn, label) => { if (cond) { fn(); r.da_sua.push(label); } };
  if (a.phong_cach != null) { if (TONES[a.phong_cach]) set(true, () => { if (a.phong_cach === 'auto') delete edits.tone; else edits.tone = a.phong_cach; }, 'phong cách lời: ' + a.phong_cach); else r.tu_choi.push({ muc: 'phong_cach', ly_do: 'không có — chọn: ' + Object.keys(TONES).join(', ') }); }
  if (a.kieu_hien != null) { if (FLOWS[a.kieu_hien]) set(true, () => { if (a.kieu_hien === 'lanluot') edits.flow = 'lanluot'; else delete edits.flow; }, 'kiểu hiện tiện ích: ' + a.kieu_hien); else r.tu_choi.push({ muc: 'kieu_hien', ly_do: 'chọn radar hoặc lanluot' }); }
  if (a.mau_the != null) { if (LABELS[a.mau_the]) set(true, () => { edits.labelStyle = a.mau_the; }, 'mẫu thẻ: ' + a.mau_the); else r.tu_choi.push({ muc: 'mau_the', ly_do: 'chọn trang, kinh hoặc mau' }); }
  if (a.cta_cach != null) { if (['binhluan', 'nhantin'].includes(a.cta_cach)) set(true, () => { edits.ctaMode = a.cta_cach; }, 'cách kêu gọi: ' + a.cta_cach); else r.tu_choi.push({ muc: 'cta_cach', ly_do: 'chọn binhluan hoặc nhantin' }); }
  if (a.cta_chu != null) set(true, () => { const k = String(a.cta_chu).trim().toUpperCase().slice(0, 18); if (k) edits.ctaKey = k; else delete edits.ctaKey; }, 'từ khoá kêu gọi');
  if (typeof a.gia_cuoi === 'boolean') set(true, () => { if (a.gia_cuoi) delete edits.priceEnd; else edits.priceEnd = false; }, 'giá để cuối: ' + (a.gia_cuoi ? 'bật' : 'tắt'));
  if (typeof a.qua_dia_cau === 'boolean') set(true, () => { if (a.qua_dia_cau) delete edits.globe; else edits.globe = false; }, 'mở đầu quả địa cầu: ' + (a.qua_dia_cau ? 'bật' : 'tắt'));
  if (typeof a.ban_day_du === 'boolean') set(true, () => { if (a.ban_day_du) edits.full = true; else delete edits.full; }, 'bản đầy đủ: ' + (a.ban_day_du ? 'bật' : 'tắt'));
  if (a.doi_mau_bia) set(true, () => { edits.palette = (Number.isFinite(edits.palette) ? edits.palette : Math.floor(Math.random() * 8)) + 1; }, 'đổi màu ảnh bìa');
  if (a.nhac != null) { if (MUSIC[a.nhac]) set(true, () => { opts.music = a.nhac; }, 'nhạc: ' + a.nhac); else r.tu_choi.push({ muc: 'nhac', ly_do: 'chọn: ' + Object.keys(MUSIC).join(', ') }); }
  if (a.giong != null) { const g = String(a.giong); if (voices()[g] || /^vb:[\w.-]{2,80}$/.test(g)) set(true, () => { opts.voice = g; }, 'giọng: ' + g); else r.tu_choi.push({ muc: 'giong', ly_do: 'chọn: ' + Object.keys(voices()).join(', ') + ' hoặc vb:<mã giọng Vbee>' }); }
  if (typeof a.duong_chim_bay === 'boolean') set(true, () => { opts.bird = a.duong_chim_bay; }, 'đường chim bay: ' + (a.duong_chim_bay ? 'bật' : 'tắt'));
  if (a.thuong_hieu != null) set(true, () => { opts.brand = String(a.thuong_hieu).trim().slice(0, 40); }, 'chữ thương hiệu');
  if (!edits.ctaKey && L?.kind && a.cta_chu == null) { /* để trang tự đặt từ khoá theo loại */ }
  return r;
}

const uniq = a => [...new Set(a)];
async function suaVideo(a, tok) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = await rpc('vt_mcp_dd_get', { p_access: tok, p_id: a.id });
    const { data, report } = await buildPatch(p, a);
    if (!Object.keys(data).length) {
      return { _err: report.tu_choi.length > 0, id: p.id, ban: p.rev, khong_co_gi_doi: true, ...report, link: link(p.id) };
    }
    try {
      const r = await rpc('vt_mcp_dd_update', { p_access: tok, p_id: p.id, p_base_rev: p.rev, p_data: data });
      const st = status({ ...r, snap: p.snap });
      return { id: r.id, ban: r.rev, link: link(r.id), ...report, trang_mo: st.trang_mo,
        buoc_tiep: st.trang_mo ? 'Trang đang mở sẽ tự áp dụng trong vài giây (đọc lại giọng câu đã đổi rồi dựng lại). Gọi xem_video sau khoảng 20 giây để đọc bản mới.'
          : `Đã lưu. Trang đang đóng: người dùng mở ${link(r.id)} (đã đăng nhập) để áp dụng và dựng lại.` };
    } catch (e) { if (e.hint === 'CONFLICT' && attempt === 0) continue; throw e; }
  }
}
async function buildPatch(p, a) {
  const s = p.snap, edits = structuredClone(p.edits || {}), opts = structuredClone(p.opts || {});
  let listing = p.listing || '', changed = new Set();
  const report = applyOptions(a, edits, opts, null);
  if (await applyDest(a, opts, { lat: p.lat, lng: p.lng }, report)) { changed.add('opts'); }
  if (report.da_sua.length) { changed.add('edits'); changed.add('opts'); }
  if (typeof a.tin_dang === 'string') { listing = a.tin_dang.trim(); changed.add('listing'); report.da_sua.push('tin đăng (thay mới)'); }
  if (typeof a.tin_dang_them === 'string' && a.tin_dang_them.trim()) { listing = (listing + '\n' + a.tin_dang_them.trim()).trim(); changed.add('listing'); report.da_sua.push('tin đăng (thêm ý)'); }
  if (a.sua_thong_tin || a.tieu_de) {
    const f = sanitizeFix(a.sua_thong_tin, a.tieu_de);
    if (f) { opts.fix = { ...(opts.fix || {}), ...f }; for (const k of Object.keys(opts.fix)) if (opts.fix[k] == null) delete opts.fix[k]; changed.add('opts'); report.da_sua.push('thông tin căn: ' + Object.keys(f).join(', ')); }
  }
  let buyer = p.buyer;
  if (a.khach != null) { if (BUYERS[a.khach]) { buyer = a.khach; changed.add('buyer'); report.da_sua.push('khách mua: ' + a.khach); } else report.tu_choi.push({ muc: 'khach', ly_do: 'chọn o, vung hoặc thue' }); }

  // tiện ích / trục đường / điểm mốc / hạ tầng: cần bản dựng (id lấy từ xem_video)
  const needSnap = ['tien_ich', 'them_tien_ich', 'bo_tien_ich', 'truc_duong', 'diem_moc_tat', 'diem_moc_bat', 'thu_tu_diem_moc', 'ha_tang_tat', 'ha_tang_bat'].filter(k => a[k] != null);
  if (needSnap.length && !s) report.tu_choi.push({ muc: needSnap.join(', '), ly_do: 'video chưa dựng nên chưa có danh sách tiện ích — người dùng mở link, đợi dựng xong, gọi xem_video rồi sửa' });
  if (s) {
    const manual = opts.manual || [];
    const known = new Map([...(s.tien_ich_da_chon || []), ...(s.tien_ich_goi_y || [])].map(x => [x.id, x.ten]));
    for (const m of manual) known.set(m.id, m.name);
    let order = edits.order ? edits.order.slice() : (s.tien_ich_da_chon || []).map(x => x.id);
    const before = JSON.stringify(order);
    const okIds = (list, muc) => list.map(String).filter(id => known.has(id) || (report.tu_choi.push({ muc, ly_do: `không có tiện ích id "${id}" (lấy id từ xem_video: tien_ich_da_chon / tien_ich_goi_y)` }), false));
    if (Array.isArray(a.tien_ich)) order = uniq(okIds(a.tien_ich, 'tien_ich'));
    if (Array.isArray(a.bo_tien_ich)) { const rm = new Set(a.bo_tien_ich.map(String)); order = order.filter(id => !rm.has(id)); }
    if (Array.isArray(a.them_tien_ich)) order = uniq([...order, ...okIds(a.them_tien_ich, 'them_tien_ich')]);
    if (Array.isArray(a.tien_ich_moi)) {
      for (const n of a.tien_ich_moi.slice(0, 3)) {
        try {
          const pos = await readCoord(n.vi_tri);
          const km = haversineKm({ lat: p.lat, lng: p.lng }, pos);
          if (km > 15) { report.tu_choi.push({ muc: 'tien_ich_moi', ly_do: `"${n.ten}" cách nhà ${km.toFixed(1)} km (tối đa 15 km)` }); continue; }
          const name = String(n.ten || '').trim().slice(0, 60);
          if (!name) { report.tu_choi.push({ muc: 'tien_ich_moi', ly_do: 'thiếu tên' }); continue; }
          const cat = CATS[n.loai] ? n.loai : 'congcong';
          const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          manual.push({ id, name, cat, lat: pos.lat, lng: pos.lng });
          order.push(id); report.da_sua.push(`thêm tiện ích mới "${name}" (${km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1).replace('.', ',') + ' km'})`);
        } catch (e) { report.tu_choi.push({ muc: 'tien_ich_moi', ly_do: `"${n?.ten || ''}": ${e.message}` }); }
      }
      opts.manual = manual.slice(-12); changed.add('opts');
    }
    if (order.length > 8) { report.canh_bao.push({ muc: 'tien_ich', ghi_chu: `tối đa 8 tiện ích — giữ 8 tiện ích đầu (${order.slice(8).map(id => known.get(id)).join(', ')} bị bỏ)` }); order = order.slice(0, 8); }
    if (JSON.stringify(order) !== before) {
      edits.order = order; delete edits.added; delete edits.removed; changed.add('edits');
      report.da_sua.push('tiện ích: ' + order.map(id => known.get(id) || id).join(', '));
      if (s.kieu_hien === 'radar' && order.length > 5) report.canh_bao.push({ muc: 'tien_ich', ghi_chu: 'kiểu radar chỉ đọc tên 5 tiện ích đầu (các tiện ích khác vẫn hiện nhãn trên radar)' });
    }
    if (Array.isArray(a.truc_duong)) {
      const rk = new Map([...(s.truc_duong || []), ...(s.truc_duong_goi_y || [])].map(x => [x.id, x.ten]));
      const ids = uniq(a.truc_duong.map(String).filter(id => rk.has(id) || (report.tu_choi.push({ muc: 'truc_duong', ly_do: `không có trục đường id "${id}"` }), false))).slice(0, 5);
      edits.roads = ids; changed.add('edits'); report.da_sua.push('trục đường: ' + (ids.map(id => rk.get(id)).join(', ') || '(không)'));
    }
    const ak = new Map((s.diem_moc || []).map(x => [x.id, x.ten]));
    const aIds = (list, muc) => list.map(String).filter(id => ak.has(id) || (report.tu_choi.push({ muc, ly_do: `không có điểm mốc id "${id}"` }), false));
    if (Array.isArray(a.diem_moc_tat)) { const ids = aIds(a.diem_moc_tat, 'diem_moc_tat'); edits.anchorsOff = uniq([...(edits.anchorsOff || []), ...ids]); edits.anchorsAdd = (edits.anchorsAdd || []).filter(x => !ids.includes(x)); changed.add('edits'); if (ids.length) report.da_sua.push('tắt điểm mốc: ' + ids.map(i => ak.get(i)).join(', ')); }
    if (Array.isArray(a.diem_moc_bat)) { const ids = aIds(a.diem_moc_bat, 'diem_moc_bat'); edits.anchorsOff = (edits.anchorsOff || []).filter(x => !ids.includes(x)); edits.anchorsAdd = uniq([...(edits.anchorsAdd || []), ...ids]).slice(0, 5); changed.add('edits'); if (ids.length) report.da_sua.push('bật điểm mốc: ' + ids.map(i => ak.get(i)).join(', ')); }
    if (Array.isArray(a.thu_tu_diem_moc)) { edits.anchorOrder = aIds(a.thu_tu_diem_moc, 'thu_tu_diem_moc'); changed.add('edits'); report.da_sua.push('thứ tự điểm mốc'); }
    const infra = (list, on) => {
      for (const k of list.map(String)) {
        if (k === 'build') { if (on) { edits.buildOff = []; edits.buildOn = true; } else { edits.buildOff = (s.dang_thi_cong || []).map(b => b.id); edits.buildOn = false; } }
        else if (k === 'metro' || k === 'road') {
          edits.infraOff = on ? (edits.infraOff || []).filter(x => x !== k) : uniq([...(edits.infraOff || []), k]);
          edits.infraAdd = on ? uniq([...(edits.infraAdd || []), k]) : (edits.infraAdd || []).filter(x => x !== k);
        } else { report.tu_choi.push({ muc: on ? 'ha_tang_bat' : 'ha_tang_tat', ly_do: `"${k}" — chọn metro, road hoặc build` }); continue; }
        changed.add('edits'); report.da_sua.push(`${on ? 'bật' : 'tắt'} cảnh ${k === 'build' ? 'hạ tầng đang thi công' : k === 'metro' ? 'metro' : 'cao tốc'}`);
      }
    };
    if (Array.isArray(a.ha_tang_tat)) infra(a.ha_tang_tat, false);
    if (Array.isArray(a.ha_tang_bat)) infra(a.ha_tang_bat, true);
  }

  // lời đọc
  if (a.loi && typeof a.loi === 'object') {
    const valid = new Set([...PRE_KEYS, ...((s?.canh || []).map(c => c.key))]);
    const fb = factBase(s, listing, opts.fix);
    for (const [k, t] of Object.entries(a.loi)) {
      if (!valid.has(k)) { report.tu_choi.push({ canh: k, ly_do: s ? `không có cảnh này trong video — các cảnh: ${[...valid].join(', ')}` : 'video chưa dựng — chỉ viết trước được: ' + PRE_KEYS.join(', ') }); continue; }
      if (t == null || String(t).trim() === '') {
        if (edits.lines?.[k]) { delete edits.lines[k]; changed.add('edits'); report.da_sua.push(`cảnh ${k}: trả về lời Agent viết`); }
        continue;
      }
      const c = checkLine(k, t, fb);
      if (c.bad.length) { report.tu_choi.push({ canh: k, ly_do: c.bad.join('; '), goi_y: 'sửa lại cho đúng số liệu trong xem_video; điều người dùng kể thêm thì đưa vào tin_dang_them trước' }); continue; }
      edits.lines = { ...(edits.lines || {}), [k]: bold(c.v) }; changed.add('edits');
      report.da_sua.push(`lời cảnh ${k}`);
      if (c.warn.length) report.canh_bao.push({ canh: k, ghi_chu: c.warn.join('; ') });
    }
  }
  const data = {};
  if (changed.has('edits')) data.edits = edits;
  if (changed.has('opts')) data.opts = opts;
  if (changed.has('listing')) data.listing = listing;
  if (changed.has('buyer')) data.buyer = buyer;
  if (opts.fix?.title && changed.has('opts')) data.title = opts.fix.title;
  return { data, report };
}

async function xoaVideo(a, tok) {
  if (a.xac_nhan !== true) throw new Error('Cần xac_nhan: true (hỏi người dùng trước khi xoá).');
  await rpc('vt_mcp_dd_delete', { p_access: tok, p_id: a.id });
  return { da_xoa: a.id };
}

// ---------- Khai báo lệnh cho Claude ----------
const ID = { type: 'string', description: 'id video (từ tao_video hoặc danh_sach_video)' };
const OPT_PROPS = {
  phong_cach: { type: 'string', enum: Object.keys(TONES), description: 'Phong cách lời Agent viết: ' + Object.entries(TONES).map(([k, v]) => `${k} = ${v}`).join('; ') },
  kieu_hien: { type: 'string', enum: Object.keys(FLOWS), description: 'radar (mặc định) hoặc lanluot (bay tới từng tiện ích, vẽ đường đi)' },
  nhac: { type: 'string', enum: Object.keys(MUSIC), description: 'Nhạc nền: ' + Object.entries(MUSIC).map(([k, v]) => `${k} = ${v}`).join('; ') },
  giong: { type: 'string', description: 'Giọng đọc: nu-nam (Nữ HD, mặc định), g-nam-hd (Nam HD), g-nu, g-nam, hoặc vb:<mã> (giọng Vbee người dùng đã kết nối trong app)' },
  mau_the: { type: 'string', enum: Object.keys(LABELS), description: 'Mẫu thẻ tiện ích: trang (mặc định), kinh, mau' },
  cta_cach: { type: 'string', enum: ['binhluan', 'nhantin'], description: 'Kêu gọi bình luận (mặc định) hay nhắn tin từ khoá' },
  cta_chu: { type: 'string', description: 'Từ khoá kêu gọi ≤ 18 ký tự (mặc định XEM NHÀ / XEM ĐẤT / XEM CĂN HỘ… theo loại)' },
  gia_cuoi: { type: 'boolean', description: 'Giá để cuối video (mặc định true)' },
  diem_den: { type: 'array', maxItems: 3, description: 'Điểm đến tự do ở BẤT KỲ đâu trong Việt Nam (vd. "đi cao tốc ra Hà Nội", cảng, khu công nghiệp xa): video bay tới, vẽ đường đi, hiện km + thời gian. Mỗi mục: ten, vi_tri (toạ độ / link Google Maps) HOẶC lat+lng; nếu AI của bạn đã có dữ liệu bản đồ thì đưa luôn km, phut (ô tô), duong ([[lat,lng],…] ≤ 400 điểm) để bên mình đỡ tốn dịch vụ — máy chỉ nhận khi hợp lý. Không có thì trang tự lấy / ước lượng và ghi "ước chừng". Mảng rỗng = bỏ hết.',
    items: { type: 'object', required: ['ten'], properties: { ten: { type: 'string' }, vi_tri: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' },
      loai: { type: 'string', enum: ['center', 'airport', 'port', 'station', 'metro'] }, km: { type: 'number' }, phut: { type: 'number' }, duong: { type: 'array', items: { type: 'array', items: { type: 'number' } } } } } },
  qua_dia_cau: { type: 'boolean', description: 'Mở đầu từ quả địa cầu (mặc định true)' },
  ban_day_du: { type: 'boolean', description: 'Bản đầy đủ cho YouTube/Zalo (mặc định false = bản ngắn TikTok/Reels)' },
  duong_chim_bay: { type: 'boolean', description: 'Vẽ đường chim bay thay đường đi thật' },
  thuong_hieu: { type: 'string', description: 'Chữ thương hiệu mờ trên video (≤ 40 ký tự, "" = bỏ)' },
  doi_mau_bia: { type: 'boolean', description: 'true = đổi sang màu ảnh bìa khác' },
  sua_thong_tin: { type: 'object', description: 'Sửa thông tin căn mà máy đọc tin đăng chưa đúng (trống = bỏ sửa): tieu_de, gia, kich_thuoc ("5x20"), ket_cau ("1 trệt 2 lầu"), phong_ngu, phap_ly, loai_dat, duong_truoc_nha, loai (' + Object.keys(KINDS).join('|') + ')',
    properties: { tieu_de: { type: 'string' }, gia: { type: 'string' }, kich_thuoc: { type: 'string' }, ket_cau: { type: 'string' }, phong_ngu: { type: 'string' }, phap_ly: { type: 'string' }, loai_dat: { type: 'string' }, duong_truoc_nha: { type: 'string' }, loai: { type: 'string', enum: Object.keys(KINDS) } } },
};
const TOOLS = [
  { name: 'tai_nguyen', title: 'Tài nguyên Vị Trí Studio',
    description: 'Xem tài khoản (lượt, gói, quyền dùng Claude) và TOÀN BỘ tài nguyên làm video: loại bất động sản, loại khách mua, phong cách lời, kiểu hiện tiện ích, nhạc nền, giọng đọc, mẫu thẻ, kêu gọi, tuỳ chọn, các cảnh + số chữ tối đa, quy trình. Gọi trước khi làm video lần đầu.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'tao_video', title: 'Tạo video vị trí (AI đạo diễn)',
    description: 'Tạo video bản đồ vị trí từ toạ độ / link Google Maps + tin đăng. Trả link /dao-dien?p=… để người dùng mở (đã đăng nhập) — trang tự quét bản đồ, viết lời, đọc giọng, dựng video. Có thể viết sẵn lời cảnh intro / house / lot / cta (các cảnh khác đợi dựng xong rồi dùng sua_video).',
    inputSchema: { type: 'object', required: ['vi_tri'], properties: {
      vi_tri: { type: 'string', description: 'Toạ độ "10.7285, 106.6185" hoặc link Google Maps (kể cả maps.app.goo.gl) của bất động sản' },
      tin_dang: { type: 'string', description: 'Dán NGUYÊN tin đăng của môi giới (loại, giá, kích thước, kết cấu, pháp lý, điểm nổi bật…). Số điện thoại trong tin không đưa lên video.' },
      khach: { type: 'string', enum: ['o', 'vung', 'thue'], description: 'Khách mua nhắm tới: o = mua để ở, vung = đầu tư sinh lời, thue = đầu tư cho thuê (bỏ trống = tự chọn theo loại nhà)' },
      tieu_de: { type: 'string', description: 'Tên trên ảnh bìa (bỏ trống = lấy từ tin đăng)' },
      loi: { type: 'object', additionalProperties: { type: 'string' }, description: 'Lời viết sẵn (tuỳ chọn) cho cảnh intro, house (hoặc lot nếu là lô đất), cta' },
      ...OPT_PROPS,
    } }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: 'danh_sach_video', title: 'Danh sách video',
    description: 'Các video AI đạo diễn đã lưu (Claude tạo hoặc người dùng dựng trên web), mới nhất trước, kèm trạng thái và link.',
    inputSchema: { type: 'object', properties: { so_luong: { type: 'integer', minimum: 1, maximum: 50, description: 'Số video (mặc định 20)' } } },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'xem_video', title: 'Xem kịch bản + dữ liệu video',
    description: 'Đọc video: trạng thái, từng cảnh (key, mô tả, dữ liệu thật, lời hiện tại, số chữ tối đa), tiện ích đã chọn + tiện ích gợi ý (id), trục đường, điểm mốc kết nối vùng, hạ tầng, lý do nên mua, bài đăng gợi ý. Dùng dữ liệu này để viết lại lời bằng sua_video.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: ID, chi_tiet: { type: 'string', enum: ['gon', 'day_du'], description: 'day_du = thêm nhiều tiện ích gợi ý + toàn bộ số liệu' } } },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'sua_video', title: 'Sửa video',
    description: 'Sửa video (gộp nhiều thay đổi trong 1 lần gọi): lời từng cảnh, tiện ích, trục đường, điểm mốc, hạ tầng, tin đăng, khách mua, phong cách, nhạc, giọng, tuỳ chọn. Lời có số / chi tiết không có trong dữ liệu bị từ chối kèm lý do. Trang đang mở tự cập nhật, chỉ đọc lại giọng câu đã đổi.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: ID,
      loi: { type: 'object', additionalProperties: { type: 'string' }, description: 'Lời mới theo key cảnh (từ xem_video.canh[].key, vd "intro", "house", "radar", "anchor:<id>", "score", "cta"). Chuỗi rỗng = trả về lời Agent viết.' },
      tien_ich: { type: 'array', items: { type: 'string' }, description: 'Danh sách id tiện ích (thay toàn bộ, đúng thứ tự, tối đa 8; kiểu radar đọc tên 5 tiện ích đầu)' },
      them_tien_ich: { type: 'array', items: { type: 'string' }, description: 'id tiện ích thêm vào cuối (từ tien_ich_goi_y)' },
      bo_tien_ich: { type: 'array', items: { type: 'string' }, description: 'id tiện ích bỏ ra' },
      tien_ich_moi: { type: 'array', maxItems: 3, description: 'Tiện ích bản đồ chưa có (người dùng biết vị trí): tên + loại + toạ độ / link Google Maps, trong 15 km',
        items: { type: 'object', required: ['ten', 'vi_tri'], properties: { ten: { type: 'string' }, loai: { type: 'string', enum: Object.keys(CATS) }, vi_tri: { type: 'string' } } } },
      truc_duong: { type: 'array', items: { type: 'string' }, description: 'id trục đường lớn (thay toàn bộ, tối đa 5) từ truc_duong / truc_duong_goi_y' },
      diem_moc_tat: { type: 'array', items: { type: 'string' }, description: 'id điểm mốc kết nối vùng cần tắt' },
      diem_moc_bat: { type: 'array', items: { type: 'string' }, description: 'id điểm mốc cần bật (từ diem_moc)' },
      thu_tu_diem_moc: { type: 'array', items: { type: 'string' }, description: 'Thứ tự điểm mốc (id)' },
      ha_tang_tat: { type: 'array', items: { type: 'string', enum: ['metro', 'road', 'build'] }, description: 'Tắt cảnh: metro, road (cao tốc), build (hạ tầng đang thi công)' },
      ha_tang_bat: { type: 'array', items: { type: 'string', enum: ['metro', 'road', 'build'] }, description: 'Bật lại cảnh hạ tầng' },
      tin_dang: { type: 'string', description: 'Thay toàn bộ tin đăng' },
      tin_dang_them: { type: 'string', description: 'Thêm ý thật người dùng vừa kể về căn (vd "Hẻm xe hơi 6m, full nội thất") vào cuối tin đăng — làm việc này TRƯỚC khi đưa ý đó vào lời' },
      khach: { type: 'string', enum: ['o', 'vung', 'thue'], description: 'Đổi khách mua nhắm tới' },
      tieu_de: { type: 'string', description: 'Tên trên ảnh bìa' },
      ...OPT_PROPS,
    } }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: 'xoa_video', title: 'Xoá video',
    description: 'Xoá một video khỏi danh sách (hỏi người dùng trước). Không ảnh hưởng video MP4 đã xuất.',
    inputSchema: { type: 'object', required: ['id', 'xac_nhan'], properties: { id: ID, xac_nhan: { type: 'boolean', description: 'true khi người dùng đã đồng ý xoá' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
];
const RUN = { tai_nguyen: (a, t) => taiNguyen(t), tao_video: taoVideo, danh_sach_video: danhSach, xem_video: xemVideo, sua_video: suaVideo, xoa_video: xoaVideo };

const PROMPTS = [
  { name: 'lam_video_vi_tri', title: 'Làm video vị trí bất động sản', description: 'Từ toạ độ / link Google Maps + tin đăng → video bản đồ vị trí có lời đọc hay, đúng số liệu thật',
    arguments: [{ name: 'vi_tri', description: 'Toạ độ hoặc link Google Maps', required: true }, { name: 'tin_dang', description: 'Tin đăng của môi giới', required: false },
      { name: 'phong_cach', description: 'Phong cách lời mong muốn (vd hài hước, chân thành, chuyên gia)', required: false }] },
  { name: 'viet_lai_kich_ban', title: 'Viết lại kịch bản video', description: 'Đọc video đã dựng rồi viết lại lời từng cảnh cho thu hút hơn',
    arguments: [{ name: 'id', description: 'id video', required: true }, { name: 'yeu_cau', description: 'Muốn đổi gì (giọng văn, nhấn mạnh điều gì…)', required: false }] },
];
function getPrompt(name, args = {}) {
  if (name === 'lam_video_vi_tri') return { description: PROMPTS[0].description, messages: [{ role: 'user', content: { type: 'text', text:
    `Làm video vị trí bất động sản bằng Vị Trí Studio.\nVị trí: ${args.vi_tri || '(hỏi tôi)'}\nTin đăng:\n${args.tin_dang || '(hỏi tôi nếu cần)'}\n${args.phong_cach ? `Phong cách lời: ${args.phong_cach}\n` : ''}
Các bước: gọi tao_video → đưa tôi link để mở (tôi giữ trang mở) → đợi khoảng 30–60 giây rồi gọi xem_video (trạng thái chưa xong thì đợi thêm) → viết lại lời từng cảnh cho thu hút, đúng số liệu thật, đúng số chữ tối đa, trả lời "Sống ở đây có tiện không?" và "Vì sao nên mua?" → gọi sua_video một lần với toàn bộ lời mới → tóm tắt cho tôi những gì đã sửa và gợi ý caption + hashtag để đăng.` } }] };
  if (name === 'viet_lai_kich_ban') return { description: PROMPTS[1].description, messages: [{ role: 'user', content: { type: 'text', text:
    `Gọi xem_video với id ${args.id || '(hỏi tôi)'}, đọc kỹ mô tả + dữ liệu từng cảnh rồi viết lại lời cho hay hơn${args.yeu_cau ? ` theo yêu cầu: ${args.yeu_cau}` : ''}. Giữ đúng số liệu và tên tiện ích, không vượt số chữ tối đa, không bịa chi tiết. Gọi sua_video một lần với toàn bộ lời mới, rồi tóm tắt thay đổi.` } }] };
  return null;
}

// ---------- JSON-RPC ----------
const UNAUTH = Symbol('unauth');
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const er = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const textResult = (obj, isError = false) => {
  const { _err, ...o } = obj || {};
  return { content: [{ type: 'text', text: JSON.stringify(o) }], ...(isError || _err ? { isError: true } : {}) };
};
async function handleMsg(m, tok) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return er(m?.id, -32600, 'Invalid Request');
  const isNote = m.id === undefined || m.id === null;
  const P = m.params || {};
  switch (m.method) {
    case 'initialize': {
      try { await rpc('vt_mcp_me', { p_access: tok }); } catch (e) { if (e.hint === 'AUTH' || e.hint === 'LOCKED') return UNAUTH; }
      const v = PROTOCOLS.includes(P.protocolVersion) ? P.protocolVersion : '2025-06-18';
      return ok(m.id, { protocolVersion: v, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: 'vitristudio', title: 'Vị Trí Studio', version: VERSION, websiteUrl: base() }, instructions: INSTRUCTIONS });
    }
    case 'ping': return isNote ? null : ok(m.id, {});
    case 'tools/list': return ok(m.id, { tools: TOOLS });
    case 'prompts/list': return ok(m.id, { prompts: PROMPTS });
    case 'prompts/get': { const g = getPrompt(P.name, P.arguments); return g ? ok(m.id, g) : er(m.id, -32602, 'Không có prompt này'); }
    case 'resources/list': return ok(m.id, { resources: [] });
    case 'resources/templates/list': return ok(m.id, { resourceTemplates: [] });
    case 'tools/call': {
      const fn = RUN[P.name];
      if (!fn) return er(m.id, -32602, 'Không có lệnh ' + P.name);
      try { return ok(m.id, textResult(await fn(P.arguments || {}, tok))); }
      catch (e) {
        if (e.hint === 'AUTH') return UNAUTH;
        return ok(m.id, textResult({ loi: e.message || String(e), ...(e.hint === 'PLAN' ? { goi_y: 'Báo người dùng: ' + e.message } : {}), ...(e.hint === 'LIMIT' ? { goi_y: 'Đợi sang ngày mai hoặc làm trực tiếp trên web.' } : {}) }, true));
      }
    }
    default:
      if (isNote) return null;   // notifications/initialized, notifications/cancelled…
      return er(m.id, -32601, 'Method not found: ' + m.method);
  }
}
function unauthorized(invalid) {
  return new Response(JSON.stringify({ error: invalid ? 'invalid_token' : 'unauthorized', error_description: 'Cần kết nối tài khoản Vị Trí Studio' }), { status: 401, headers: {
    ...CORS, 'content-type': 'application/json',
    'www-authenticate': `Bearer resource_metadata="${prmUrl()}", scope="video"${invalid ? ', error="invalid_token"' : ''}` } });
}
export async function handleMcp(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } });
  const tok = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (!tok) return unauthorized(false);
  let body;
  try { body = await req.json(); } catch { return json(er(null, -32700, 'Parse error'), 400, CORS); }
  const batch = Array.isArray(body), msgs = batch ? body : [body], out = [];
  for (const m of msgs.slice(0, 20)) {
    const r = await handleMsg(m, tok);
    if (r === UNAUTH) return unauthorized(true);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? out : out[0], 200, CORS);
}
