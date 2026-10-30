// Dựng bộ icon động js/fx-icons.js từ Lucide (giấy phép ISC — dùng thương mại được, phải giữ dòng bản quyền).
// Mỗi icon = danh sách nét [d (đường SVG 24×24), độ dài nét] → render vẽ nét "tự chạy ra" bằng setLineDash.
// Chạy (chỉ cần khi thêm/bớt icon):
//   mkdir -p /tmp/iconsrc && cd /tmp/iconsrc && npm init -y && npm i lucide-static@1.64.0
//   node tools/build_fx_icons.mjs /tmp/iconsrc/node_modules
// Độ dài nét đo bằng chính Chromium (SVGPathElement.getTotalLength) qua Playwright có sẵn trong máy thử.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const NM = process.argv[2] || '/tmp/iconsrc/node_modules';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const nodes = JSON.parse(fs.readFileSync(path.join(NM, 'lucide-static/icon-nodes.json'), 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(NM, 'lucide-static/package.json'), 'utf8')).version;

// id dùng trong app (AI chọn theo id + mô tả) → tên Lucide
export const ICONS = {
  nha: ['house', 'nhà, căn nhà, nhà phố'],
  chungcu: ['building', 'chung cư, căn hộ, tòa nhà cao tầng'],
  khachsan: ['hotel', 'khách sạn, căn hộ dịch vụ, cho thuê'],
  datnen: ['land-plot', 'đất nền, lô đất, phân lô'],
  lo: ['square-dashed', 'ranh lô, thửa đất'],
  duan: ['construction', 'dự án đang xây, công trình'],
  thicong: ['traffic-cone', 'đang thi công, hạ tầng đang làm'],
  chiakhoa: ['key-round', 'nhận nhà, bàn giao, sở hữu'],
  so: ['scroll-text', 'sổ hồng, sổ đỏ, giấy tờ'],
  phaply: ['shield-check', 'pháp lý an toàn, đã kiểm tra'],
  canbang: ['scale', 'pháp lý, công chứng, hợp đồng'],
  gia: ['badge-dollar-sign', 'giá bán, giá tốt'],
  nhangia: ['tag', 'giá, ưu đãi, nhãn giá'],
  tien: ['banknote', 'tiền, thanh toán, trả trước'],
  tietkiem: ['piggy-bank', 'tiết kiệm, trả góp'],
  dautu: ['hand-coins', 'đầu tư, dòng tiền, cho thuê'],
  vi: ['wallet', 'chi phí, ví tiền'],
  nganhang: ['landmark', 'ngân hàng, hỗ trợ vay, cơ quan'],
  tang: ['trending-up', 'tăng trưởng, tăng giá trị'],
  bieudo: ['chart-column-increasing', 'biểu đồ tăng'],
  phantram: ['percent', 'phần trăm, chiết khấu, lãi suất'],
  dientich: ['ruler-dimension-line', 'diện tích, kích thước, ngang dài'],
  thuoc: ['ruler', 'đo đạc, mét'],
  phongngu: ['bed-double', 'phòng ngủ'],
  tam: ['bath', 'phòng tắm, toilet'],
  sofa: ['sofa', 'phòng khách, nội thất'],
  truong: ['school', 'trường học'],
  daihoc: ['graduation-cap', 'đại học, học hành'],
  benhvien: ['hospital', 'bệnh viện'],
  yte: ['stethoscope', 'trạm y tế, phòng khám'],
  capcuu: ['ambulance', 'cấp cứu'],
  cho: ['store', 'chợ, cửa hàng'],
  sieuthi: ['shopping-cart', 'siêu thị'],
  muasam: ['shopping-bag', 'trung tâm thương mại, mua sắm'],
  anuong: ['utensils', 'ăn uống, nhà hàng'],
  cafe: ['coffee', 'cà phê'],
  congvien: ['trees', 'công viên, cây xanh'],
  caythong: ['tree-pine', 'thiên nhiên, mảng xanh'],
  gym: ['dumbbell', 'thể thao, gym'],
  song: ['waves-horizontal', 'sông, kênh, hồ bơi'],
  nuoc: ['droplets', 'nước sạch'],
  nang: ['sun', 'nắng, thoáng'],
  nui: ['mountain', 'đồi núi'],
  kcn: ['factory', 'khu công nghiệp, nhà máy'],
  kho: ['warehouse', 'kho bãi, logistics'],
  xebuyt: ['bus', 'xe buýt'],
  tau: ['train-front', 'ga tàu, đường sắt'],
  metro: ['tram-front', 'metro, tàu điện'],
  maybay: ['plane', 'sân bay'],
  cang: ['ship', 'cảng, tàu biển'],
  neo: ['anchor', 'bến cảng'],
  cau: ['bridge', 'cầu'],
  duonglon: ['road', 'đường lớn, cao tốc, quốc lộ'],
  lotrinh: ['route', 'lộ trình, đường đi, kết nối'],
  bienchi: ['signpost', 'hướng đi, ngã tư'],
  cotmoc: ['milestone', 'cột mốc, km'],
  ghim: ['map-pin', 'vị trí'],
  bando: ['map', 'bản đồ, khu vực'],
  gio: ['clock', 'thời gian, phút'],
  oto: ['car', 'ô tô, lái xe'],
  xedap: ['bike', 'xe đạp, đi bộ'],
  baixe: ['parking-meter', 'bãi đậu xe'],
  xang: ['fuel', 'cây xăng'],
  dien: ['zap', 'điện, trạm sạc'],
  giadinh: ['users', 'gia đình, cộng đồng, dân cư'],
  treem: ['baby', 'trẻ em, mầm non'],
  hoptac: ['handshake', 'giao dịch, hợp tác, chốt'],
  lich: ['calendar', 'lịch, thời hạn'],
  sao: ['star', 'nổi bật'],
  hot: ['flame', 'hot, đang sốt'],
  cup: ['trophy', 'số 1, hàng đầu'],
  kimcuong: ['gem', 'cao cấp, đẳng cấp'],
  vuongmien: ['crown', 'sang trọng, vip'],
  lapanh: ['sparkles', 'mới, đẹp, nổi bật'],
  rao: ['fence', 'khu riêng, an ninh có rào'],
};

const num = v => +v;
const r6 = v => Math.round(v * 1000) / 1000;
function toD(tag, a) {
  switch (tag) {
    case 'path': return a.d;
    case 'circle': { const cx = num(a.cx), cy = num(a.cy), r = num(a.r); return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`; }
    case 'ellipse': { const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry); return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`; }
    case 'line': return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
    case 'polyline': case 'polygon': {
      const p = String(a.points).trim().split(/[\s,]+/).map(Number);
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
    case 'rect': {
      const x = num(a.x || 0), y = num(a.y || 0), w = num(a.width), h = num(a.height);
      const rx = Math.min(num(a.rx || a.ry || 0), w / 2, h / 2);
      if (!rx) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${rx} 0 0 1 ${rx} ${rx}v${h - 2 * rx}a${rx} ${rx} 0 0 1 ${-rx} ${rx}h${-(w - 2 * rx)}a${rx} ${rx} 0 0 1 ${-rx} ${-rx}v${-(h - 2 * rx)}a${rx} ${rx} 0 0 1 ${rx} ${-rx}Z`;
    }
    default: throw new Error('Không hỗ trợ thẻ ' + tag);
  }
}

const ds = {};
const miss = [];
for (const [id, [name]] of Object.entries(ICONS)) {
  const n = nodes[name];
  if (!n) { miss.push(name); continue; }
  ds[id] = n.map(([tag, attrs]) => toD(tag, attrs));
}
if (miss.length) { console.error('Thiếu icon Lucide:', miss.join(', ')); process.exit(1); }
const browser = await chromium.launch();
const page = await browser.newPage();
const lens = await page.evaluate(all => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  document.body.appendChild(svg);
  const out = {};
  for (const [id, list] of Object.entries(all)) out[id] = list.map(d => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); return p.getTotalLength(); });
  return out;
}, ds);
await browser.close();
const out = Object.fromEntries(Object.entries(ds).map(([id, list]) => [id, list.map((d, i) => [d, r6(lens[id][i])])]));
const desc = Object.fromEntries(Object.entries(ICONS).map(([id, [, d]]) => [id, d]));
const NOTE = `Icon gốc: Lucide v${version} (https://lucide.dev) — ISC License, Copyright (c) 2026 Lucide Icons and Contributors. Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.`;
// Nét icon: file JSON riêng (fx-icons.json ở gốc repo, build.sh chép vào site/) — app chỉ tải khi có hiệu ứng, không làm nặng app.js
fs.writeFileSync(new URL('../fx-icons.json', import.meta.url), JSON.stringify({ license: NOTE, icons: out }));
// Danh sách id + mô tả (máy chủ /api/direct gửi cho AI chọn, và kiểm tra id hợp lệ)
const file = `// TỰ SINH bằng tools/build_fx_icons.mjs — đừng sửa tay. Thêm/bớt icon: sửa ICONS trong tool rồi chạy lại.
// ${NOTE}
// Nét vẽ nằm ở fx-icons.json (tải khi cần). Đây chỉ là id → mô tả để AI chọn icon hợp câu đọc.
export const FX_ICON_DESC = ${JSON.stringify(desc, null, 0)};
`;
fs.writeFileSync(new URL('../js/fx-icons.js', import.meta.url), file);
console.log('Đã ghi fx-icons.json + js/fx-icons.js:', Object.keys(out).length, 'icon');
