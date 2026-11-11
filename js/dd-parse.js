// AI đạo diễn — đọc tin đăng môi giới dán vào (một ô) → thông tin căn. Bản này dùng luật (chạy ngay trên máy, không tốn
// lượt AI); tin viết lạ quá thì bước sau gọi AI máy chủ đọc lại. Chỉ lấy điều tin CÓ GHI, không đoán.
import { parseCoords } from './geo.js';

const num = s => parseFloat(String(s).replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
const fmt = n => (Math.round(n * 100) / 100).toString().replace('.', ',');

// Loại bất động sản → cách vẽ (kind) + chữ hiển thị. Thứ tự: loại cụ thể trước, "nhà" chung sau cùng.
export const KINDS = {
  bietthu: { label: 'Biệt thự', icon: '🏰' },
  nhavuon: { label: 'Nhà vườn', icon: '🌳' },
  canho: { label: 'Căn hộ', icon: '🏢' },
  datnen: { label: 'Lô đất', icon: '📐' },
  nhapho: { label: 'Nhà phố', icon: '🏠' },
};
function kindOf(t) {
  if (/biệt\s*thự|villa/i.test(t)) return 'bietthu';
  if (/nhà\s*vườn|đất\s*vườn\s*có\s*nhà|homestay|farmstay/i.test(t)) return 'nhavuon';
  if (/căn\s*hộ|chung\s*cư|apartment|condotel|officetel|penthouse/i.test(t)) return 'canho';
  // "đất" đứng đầu tin hoặc "lô đất / đất nền / đất thổ cư" mà không có số tầng, phòng ngủ → lô đất
  const land = /(lô\s*đất|đất\s*nền|nền\s*đất|đất\s*thổ\s*cư|bán\s*đất|đất\s*ở|đất\s*vườn|đất\s*nông\s*nghiệp)/i.test(t);
  const built = /(\d\s*(tầng|lầu)|trệt|phòng\s*ngủ|\bpn\b|wc|toilet|nhà\s*(phố|mặt\s*tiền|hẻm|cấp))/i.test(t);
  if (land && !built) return 'datnen';
  return 'nhapho';
}

export function parseListing(text) {
  const raw = String(text || '');
  const t = raw.normalize('NFC');
  const out = { kind: kindOf(t) };
  // Toạ độ / link Google Maps trong tin
  const c = parseCoords(t);
  if (c && !c.error) out.coord = { lat: c.lat, lng: c.lng };
  const link = t.match(/https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps)\S*/i);
  if (link) out.mapLink = link[0];
  // Giá: "3,2 tỷ", "3 tỷ 200", "850 triệu", "giá 12.5 tỷ"
  let m = t.match(/(\d+(?:[.,]\d+)?)\s*tỷ\s*(\d{1,3})?(?!\s*\/)/i);
  if (m) {
    let v = num(m[1]); if (m[2]) v += num(m[2]) / (m[2].length === 1 ? 10 : 1000);
    out.price = `${fmt(v)} tỷ`;
  } else if ((m = t.match(/(\d{2,4})\s*(triệu|tr)\b(?!\s*\/\s*(m|tháng))/i))) out.price = `${m[1]} triệu`;
  // Kích thước: "5x20", "5 x 20m", "ngang 5m dài 20m"
  m = t.match(/(\d+(?:[.,]\d+)?)\s*m?\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*m?\b/i) || t.match(/ngang\s*(\d+(?:[.,]\d+)?)\s*m?.{0,12}?dài\s*(\d+(?:[.,]\d+)?)/i);
  if (m) { out.w = num(m[1]); out.l = num(m[2]); out.dims = `${fmt(out.w)}×${fmt(out.l)} m`; }
  // Diện tích: "100m2", "DT 100 m²", "diện tích: 1.200m2"
  m = t.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(m2|m²|mét vuông)/i);
  if (m) out.area = num(m[1]);
  else if (out.w && out.l) out.area = Math.round(out.w * out.l * 10) / 10;
  m = t.match(/(?:thổ\s*cư|tc)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(m2|m²)?/i);
  if (m) out.thoCu = `${fmt(num(m[1]))} m² thổ cư`;
  else if (/full\s*thổ\s*cư|100\s*%\s*thổ\s*cư/i.test(t)) out.thoCu = 'Full thổ cư';
  // Kết cấu: "1 trệt 2 lầu", "3 tầng", "trệt lửng 2 lầu sân thượng"
  m = t.match(/(\d+\s*)?trệt[^.\n]{0,25}?(\d+)\s*lầu/i);
  if (m) out.floors = `1 trệt ${m[2]} lầu`;
  else if ((m = t.match(/(?<![\w²])(\d+)\s*tầng/i))) out.floors = `${m[1]} tầng`;
  if (out.kind === 'canho') {   // căn hộ: "tầng 12" là tầng đặt căn, không phải số tầng của nhà
    const lv = t.match(/tầng\s*(\d{1,2})\b/i); if (lv) out.level = `Tầng ${lv[1]}`;
    if (out.floors && !/trệt/.test(out.floors)) delete out.floors;
  }
  if (out.floors && /lửng/i.test(t)) out.floors = out.floors.replace('1 trệt', '1 trệt, lửng');
  m = t.match(/(\d+)\s*(pn|phòng\s*ngủ)/i); if (m) out.beds = +m[1];
  m = t.match(/(\d+)\s*(wc|toilet|nhà\s*vệ\s*sinh)/i); if (m) out.baths = +m[1];
  // Pháp lý
  if (/sổ\s*hồng\s*riêng|shr\b/i.test(t)) out.legal = 'Sổ hồng riêng';
  else if (/sổ\s*đỏ/i.test(t)) out.legal = 'Sổ đỏ';
  else if (/sổ\s*hồng/i.test(t)) out.legal = 'Sổ hồng';
  else if (/sổ\s*chung/i.test(t)) out.legal = 'Sổ chung';
  else if (/vi\s*bằng/i.test(t)) out.legal = 'Vi bằng';
  else if (/giấy\s*tay/i.test(t)) out.legal = 'Giấy tay';
  // Đường trước nhà
  m = t.match(/(hẻm|hxh|đường)\s*(xe\s*hơi|ô\s*tô|oto|\d+(?:[.,]\d+)?\s*m)/i);
  if (m) out.road = (/hxh/i.test(m[1]) ? 'Hẻm xe hơi' : m[0].replace(/\s+/g, ' ').toLowerCase().replace(/^./, s => s.toUpperCase()));
  else if (/mặt\s*tiền/i.test(t)) out.road = 'Mặt tiền';
  m = t.match(/hướng\s*(đông\s*nam|đông\s*bắc|tây\s*nam|tây\s*bắc|đông|tây|nam|bắc)/i);
  if (m) out.facing = 'Hướng ' + m[1].toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase());
  // Địa chỉ: phường/xã + tỉnh/thành (lấy câu ngắn có từ khoá)
  m = t.match(/(phường|xã|thị trấn)\s+([^\n,.;]{2,30})/i); if (m) out.ward = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2].trim()}`;
  m = t.match(/(tp\.?\s*hcm|hồ chí minh|sài gòn|hà nội|đà nẵng|hải phòng|cần thơ|bình dương|đồng nai|long an|bà rịa|vũng tàu|khánh hòa|lâm đồng|bắc ninh|quảng ninh)/i);
  if (m) out.province = /hcm|hồ chí minh|sài gòn/i.test(m[1]) ? 'TP.HCM' : m[1].replace(/(^|\s)\S/g, s => s.toUpperCase());
  // Số điện thoại: chỉ ghi nhận để KHÔNG đưa lên video (khách tự bật ở trang căn)
  const ph = t.match(/(?:\+?84|0)(?:[\s.-]?\d){9,10}/g);
  if (ph) out.phones = ph.map(x => x.replace(/\D/g, ''));
  // Điểm nổi bật: các dòng ngắn bắt đầu bằng gạch/dấu tích không phải thông số đã lấy
  out.highlights = t.split(/\n+/).map(l => l.replace(/^[\s\-–•*✅✔️☑️🔥⭐️👉+]+/u, '').trim())
    .filter(l => l.length > 8 && l.length < 90 && !/\d\s*(tỷ|triệu|m2|m²)|sổ|https?:|^(lh|liên hệ|hotline|zalo)\b/i.test(l)
      && !/\d{9,}/.test(l.replace(/[\s.-]/g, ''))).slice(0, 4);
  return out;
}

// Thẻ "AI hiểu căn này là…": danh sách mục hiển thị (bỏ mục trống)
export function summaryChips(p) {
  return [KINDS[p.kind]?.icon + ' ' + KINDS[p.kind]?.label, p.price, p.dims || (p.area && `${fmt(p.area)} m²`), p.floors,
    p.level, p.beds && `${p.beds} phòng ngủ`, p.legal, p.thoCu, p.road, p.facing, p.ward, p.province].filter(Boolean);
}
// Thẻ thông tin trong video (giá + vài thông số chính)
export function infoChips(p) {
  return [p.dims || (p.area && `${fmt(p.area)} m²`), p.floors, p.beds && `${p.beds} phòng ngủ`, p.legal].filter(Boolean).slice(0, 4);
}
export { fmt as fmtNum };
