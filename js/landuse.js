// Ô "Loại đất" (state.thoCu — giữ tên khoá cũ để căn đã lưu không mất dữ liệu).
// 4/11/2026 (khách phàn nàn): trước đây app LUÔN gắn thêm chữ "thổ cư" vào chữ khách gõ → gõ "SKC" thì video hiện
// "Thổ cư SKC" và đọc "SKC thổ cư" (sai pháp lý). Nay hiện ĐÚNG chữ khách gõ; chỉ khi khách gõ một con số diện tích
// (cách nhập cũ: "100m²" = 100 m² thổ cư) thì mới thêm chữ "thổ cư" như trước.
// Dùng chung cho thẻ trên video (render.js), câu đọc mẫu và dữ liệu gửi AI (app.js).

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const AREA_ONLY = /^[\d.,\s]+(m2|m²|m|mét vuông|met vuong)?$/i;

export const landUseRaw = v => clean(v);
export const landUseIsArea = v => !!clean(v) && AREA_ONLY.test(clean(v));

// Chữ hiện trên thẻ. before = true: "Thổ cư 100m²" (thẻ thông tin), false: "100m² thổ cư" (dòng chi tiết)
export function landUseText(v, before = false) {
  const s = clean(v);
  if (!s) return '';
  if (AREA_ONLY.test(s)) return before ? 'Thổ cư ' + s : s + ' thổ cư';
  return s.replace(CODE_ANY, (m, p, c) => p + c.toUpperCase()); // "đất tmdv" → "đất TMDV"
}

// Ký hiệu loại đất hay ghi trên sổ → tên đọc to (giọng đọc không đọc được chữ viết tắt)
const CODES = [
  ['SKC', 'đất sản xuất kinh doanh'],
  ['TMDV', 'đất thương mại dịch vụ'],
  ['TMD', 'đất thương mại dịch vụ'],
  ['CLN', 'đất trồng cây lâu năm'],
  ['ODT', 'đất ở đô thị'],
  ['ONT', 'đất ở nông thôn'],
  ['LUC', 'đất trồng lúa'],
  ['LUK', 'đất trồng lúa'],
  ['LUA', 'đất trồng lúa'],
  ['HNK', 'đất trồng cây hàng năm'],
  ['BHK', 'đất trồng cây hàng năm'],
  ['NTS', 'đất nuôi trồng thủy sản'],
  ['SKK', 'đất khu công nghiệp'],
  ['SKN', 'đất cụm công nghiệp'],
];
const CODE_ANY = new RegExp(`(^|[^A-Za-z])(${CODES.map(c => c[0]).join('|')})(?![A-Za-z])`, 'gi');
// Không dùng lookbehind (iPhone cũ < iOS 16.4 lỗi cú pháp cả app)
const CODE_RES = CODES.map(([c, w]) => [new RegExp(`(^|[^A-Za-z])(?:đất\\s+)?${c}(?![A-Za-z])`, 'gi'), w]);

// Câu đọc to: mở rộng ký hiệu, "+" → "và"
export function landUseSpeak(v) {
  let s = landUseText(v, false);
  if (!s) return '';
  s = s.replace(new RegExp(`\\s*\\((${CODES.map(c => c[0]).join('|')})\\)`, 'gi'), ''); // "Đất ở đô thị (ODT)" → bỏ ký hiệu trong ngoặc
  for (const [re, w] of CODE_RES) s = s.replace(re, (m, p) => p + w);
  return s.replace(/\s*\+\s*/g, ' và ').replace(/\s*\/\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

// Có phải đất ở (thổ cư) không — để AI biết có được nói "về ở" hay không
export function landUseHasResidential(v) {
  const s = landUseSpeak(v).toLowerCase();
  return !s || /thổ cư|đất ở/.test(s);
}
