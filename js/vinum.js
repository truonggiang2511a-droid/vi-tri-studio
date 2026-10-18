// Đổi số và đơn vị trong lời đọc thành chữ tiếng Việt để giọng AI đọc đúng:
//   "1.5km" / "1,5 km"  -> "một phẩy năm ki lô mét"
//   "1.200 m"           -> "1200 mét"            (dấu chấm + 3 số là phân cách hàng nghìn)
//   "3,25 tỷ"           -> "ba phẩy hai mươi lăm tỷ"
const DIG = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function read3(n, full) {
  const h = Math.floor(n / 100), t = Math.floor(n / 10) % 10, u = n % 10;
  const out = [];
  if (h || full) out.push(DIG[h] + ' trăm');
  if (t === 0) {
    if (u && (h || full)) out.push('lẻ');
    if (u) out.push(DIG[u]);
  } else if (t === 1) {
    out.push('mười');
    if (u === 5) out.push('lăm'); else if (u) out.push(DIG[u]);
  } else {
    out.push(DIG[t] + ' mươi');
    if (u === 1) out.push('mốt'); else if (u === 4) out.push('tư'); else if (u === 5) out.push('lăm'); else if (u) out.push(DIG[u]);
  }
  return out.join(' ');
}

export function numToVi(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'không';
  const unit = ['', 'nghìn', 'triệu', 'tỷ'];
  const groups = [];
  while (n > 0 && groups.length < 4) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    parts.push(read3(groups[i], i < groups.length - 1) + (unit[i] ? ' ' + unit[i] : ''));
  }
  return parts.join(' ');
}

// Phần sau dấu phẩy: "5" -> "năm", "25" -> "hai mươi lăm", "05" -> "không năm"
function fracToVi(f) {
  const s = f.replace(/0+$/, '');
  if (!s) return '';
  const lead = s.match(/^0*/)[0].length;
  const rest = s.slice(lead);
  return [...Array(lead).fill('không'), rest ? numToVi(+rest) : ''].filter(Boolean).join(' ');
}

// Đọc một con số viết theo kiểu Việt Nam hoặc kiểu quốc tế
export function speakNumber(raw) {
  const s = String(raw);
  let intPart, frac = '';
  if (s.includes(',')) {
    // Kiểu Việt Nam: 1.234,5 ; 1,5
    const k = s.lastIndexOf(',');
    intPart = s.slice(0, k).replace(/[.,]/g, '');
    frac = s.slice(k + 1).replace(/\D/g, '');
  } else if (s.includes('.')) {
    const groups = s.split('.');
    if (groups.slice(1).every(g => g.length === 3)) intPart = groups.join('');       // 1.200 ; 12.500.000
    else { intPart = groups.slice(0, -1).join(''); frac = groups[groups.length - 1]; } // 1.5 ; 1.25
  } else intPart = s;
  const f = fracToVi(frac);
  if (!f) return frac || /[.,]/.test(s) ? numToVi(+intPart) : intPart.replace(/^0+(?=\d)/, '');
  return numToVi(+intPart) + ' phẩy ' + f;
}

const UNIT = { km: 'ki lô mét', m: 'mét', m2: 'mét vuông', 'm²': 'mét vuông', ha: 'héc ta', '%': 'phần trăm' };

export function speakNumbers(text) {
  return String(text || '')
    // kích thước đất: 5x20m, 4,5 x 18 m -> "năm nhân hai mươi mét"
    .replace(/(\d+(?:[.,]\d+)?)\s?[x×]\s?(\d+(?:[.,]\d+)?)\s?(m)?(?![\p{L}\d²])/giu, (_, a, b, m) => `${speakNumber(a)} nhân ${speakNumber(b)}${m ? ' mét' : ''}`)
    // số kèm đơn vị: 1.5km, 1,5 km, 450m, 120 m2, 2 ha, 30%
    .replace(/(\d+(?:[.,]\d+)*)\s?(km|m²|m2|ha|m|%)(?![\p{L}\d])/giu, (_, num, u) => speakNumber(num) + ' ' + UNIT[u.toLowerCase()])
    // số thập phân hoặc có dấu phân cách còn lại
    .replace(/\d+(?:[.,]\d+)+/g, m => speakNumber(m));
}

// Số điện thoại đọc từng chữ số theo nhóm: "0912 345 678" -> "không chín một hai, ba bốn năm, sáu bảy tám"
export function speakPhones(text) {
  return String(text || '').replace(/(?<![\d.,])(?:\+?84|0)(?:[\s.\-]?\d){8,10}(?![\d])/g, m => {
    let d = m.replace(/\D/g, '');
    if (d.startsWith('84')) d = '0' + d.slice(2);
    if (d.length < 9 || d.length > 11) return m;
    const groups = d.length === 9 ? [d.slice(0, 3), d.slice(3, 6), d.slice(6)] : [d.slice(0, 4), d.slice(4, 7), d.slice(7)];
    return groups.map(g => [...g].map(c => DIG[+c]).join(' ')).join(', ');
  });
}
