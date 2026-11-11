// AI đạo diễn — "Agent": từ kết quả quét quanh căn + thông tin tin đăng + khách mua → kịch bản (story) cho js/dd3d.js.
// Chọn tiện ích theo khách mua, viết lời theo SỐ LIỆU THẬT (khoảng cách, phút, số tiện ích trong 1 km), chọn phong cách
// (nhạc, cách vẽ) theo loại bất động sản. Bản luật — bước sau thay phần viết lời bằng AI máy chủ (cùng dữ liệu, cùng luật cấm bịa).
import { KINDS, infoChips, fmtNum } from './dd-parse.js';
import { rectM } from './dd3d.js';

export const BUYERS = {
  o: { label: 'Mua để ở', sub: 'Gia đình, có con nhỏ', icon: '👨‍👩‍👧' },
  thue: { label: 'Đầu tư cho thuê', sub: 'Công nhân, sinh viên thuê', icon: '💼' },
  vung: { label: 'Kết nối khu vực', sub: 'Trung tâm, sân bay, hạ tầng', icon: '🛫' },
};
// Gợi ý khách mua theo loại nhà (khách đổi được)
export const suggestBuyer = kind => kind === 'datnen' ? 'thue' : kind === 'nhavuon' ? 'vung' : 'o';

// Phong cách AI tự chọn theo loại nhà / khách mua: nhạc (music/*.m4a có sẵn của app)
// Nhạc nền mặc định "Hùng hồn" như app cũ; AI chỉ GỢI Ý bài hợp loại nhà (khách tự đổi)
export const MUSIC_LIB = [
  ['hung-hon', '🔥 Hùng hồn · điện ảnh'], ['tran-ca', '🥁 Trống trận · mạnh mẽ'], ['dang-cap', '🎬 Đẳng cấp · trailer'],
  ['cong-nghe', '⚡ Công nghệ · hiện đại'], ['khoi-dau', '🌅 Khởi đầu · truyền cảm hứng'], ['soi-dong', 'Sôi động · nhịp nhanh'],
  ['tuoi-sang', 'Tươi sáng · vui tươi'], ['sang-trong', 'Sang trọng · trầm ấm'], ['nhe-nhang', 'Nhẹ nhàng · piano'],
];
export function styleOf(kind, buyer) {
  const suggest = kind === 'bietthu' ? 'sang-trong' : kind === 'nhavuon' ? 'nhe-nhang' : kind === 'canho' ? 'cong-nghe'
    : kind === 'datnen' ? 'khoi-dau' : buyer === 'vung' ? 'dang-cap' : 'hung-hon';
  return { music: 'hung-hon', suggest };
}

const km = x => x < 1 ? `${Math.round(x * 1000 / 10) * 10} m` : `${fmtNum(Math.round(x * 10) / 10)} km`;
const mins = p => p.min != null ? Math.max(1, Math.round(p.min)) : null;
const RX = {
  mamnon: /mầm\s*non|mẫu\s*giáo|kindergarten|preschool|nhà\s*trẻ/i,
  tieuhoc: /tiểu\s*học|primary/i,
  quocte: /quốc\s*tế|international|liên\s*cấp/i,
  daihoc: /đại\s*học|cao\s*đẳng|university|college|học\s*viện/i,
  benhvien: /bệnh\s*viện(?!.*(mắt|răng|thẩm\s*mỹ|thú\s*y))|hospital/i,
  congvien: /công\s*viên|park|vườn\s*hoa/i,
  benxe: /bến\s*xe|ga\b|nhà\s*ga|station/i,
  sieuthi: /siêu\s*thị|co\.?op|winmart|big\s*c|go!|aeon|lotte|emart|bách\s*hóa|mall|trung\s*tâm\s*thương\s*mại/i,
  cho: /^chợ|\bchợ\b/i,
  ubnd: /ủy\s*ban|uỷ\s*ban|ubnd/i,
};

// Chọn tiện ích theo khách mua: mỗi luật = [nhóm, bộ lọc ưu tiên, …]; lấy điểm gần nhất khớp luật, không trùng
function pickPois(pois, buyer, kind, max) {
  const out = [], used = new Set();
  const take = (cat, prefer, maxKm = 3) => {
    const list = pois.filter(p => p.cat === cat && !used.has(p.id) && p.km <= maxKm);
    const p = (prefer && list.find(x => prefer.test(x.name))) || (!prefer || prefer.soft ? list[0] : null);
    if (p && out.length < max) { out.push(p); used.add(p.id); }
  };
  const soft = r => Object.assign(new RegExp(r.source, r.flags), { soft: true });
  const lux = kind === 'bietthu';
  if (buyer === 'thue') {
    take('kcn', null, 12); take('truong', RX.daihoc, 4); take('giaothong', RX.benxe, 5); take('cho', soft(RX.sieuthi));
    take('yte', soft(RX.benhvien)); take('khudothi');
  } else if (buyer === 'vung') {
    take('cho', soft(RX.cho)); take('truong', soft(lux ? RX.quocte : RX.mamnon)); take('yte', soft(RX.benhvien));
  } else {
    take('truong', soft(lux ? RX.quocte : RX.mamnon)); take('cho', soft(lux ? RX.sieuthi : RX.cho)); take('congvien', soft(RX.congvien));
    take('truong', soft(lux ? RX.quocte : RX.tieuhoc)); take('yte', soft(RX.benhvien), 5); take('hanhchinh', soft(RX.ubnd));
  }
  // còn thiếu: bổ sung điểm gần nhất các nhóm chính
  for (const c of ['truong', 'cho', 'yte', 'congvien', 'hanhchinh']) if (out.length < max) take(c, null, 2);
  return out;
}

// Lời đọc từng cảnh (có <b>…</b> để tô vàng). Chỉ dùng số liệu có thật; thiếu thì câu ngắn lại, không đoán.
function poiLine(p, buyer, i) {
  const d = `<b>${km(p.km)}</b>`, m = mins(p), t = m ? `, khoảng <b>${m} phút</b>` : '';
  const n = p.name;
  if (p.cat === 'truong' && buyer === 'o') return i === 0 ? `Sáng đưa con đi học: ${n}, chỉ ${d}.` : `Lớn lên học tiếp ${n}, ${d}.`;
  if (p.cat === 'truong' && RX.daihoc.test(n)) return `${n} cách ${d}, sinh viên tìm phòng quanh năm.`;
  if (p.cat === 'cho') return buyer === 'thue' ? `${n} ${d}, người thuê đi chợ tiện.`
    : RX.cho.test(n) ? `Đi ${n.replace(/^chợ/i, 'chợ')} chỉ ${d}${t}.` : `Mua sắm ở ${n} chỉ ${d}${t}.`;
  if (p.cat === 'congvien') return `Cuối tuần ra ${n} cách ${d}.`;
  if (p.cat === 'yte') return `${n} cách ${d}${t}.`;
  if (p.cat === 'kcn') return `${n}: ${d}${t} chạy xe.`;
  if (p.cat === 'hanhchinh') return `${n} cách ${d}${t}.`;
  return `${n} cách ${d}${t}.`;
}

// story cho dd3d từ dữ liệu thật
// S = { house:{lat,lng}, pois, streets, admin/area, roads, routes: {id: route}, anchors: [...], infra: {...}, ward, province }
// L = thông tin tin đăng (parseListing), buyer, edits = { order: [id…], removed: [id…], added: [id…], lines: {key: text} }
export function buildStory(S, L, buyer, edits = {}) {
  const kind = L.kind || 'nhapho';
  const H = [S.house.lng, S.house.lat];
  const max = buyer === 'vung' ? 2 : kind === 'datnen' || kind === 'nhavuon' ? 3 : 5;
  // tiện ích: Agent chọn → khách bỏ / thêm / đổi thứ tự
  let chosen = pickPois(S.pois, buyer, kind, max).map(p => p.id);
  if (edits.order) chosen = edits.order.slice();
  else if (edits.added) chosen = [...chosen, ...edits.added.filter(id => !chosen.includes(id))];
  if (edits.removed) chosen = chosen.filter(id => !edits.removed.includes(id));
  const byId = new Map(S.pois.map(p => [p.id, p]));
  const ll = ([lat, lng]) => [lng, lat];
  const pois = chosen.map(id => byId.get(id)).filter(Boolean).map(p => {
    const r = S.routes?.[p.id];
    return { id: p.id, name: p.name, cat: p.cat, kind: p.kind, at: [p.lng, p.lat], km: r ? r.km : p.km, min: r ? r.min : null,
      route: r && r.coords ? r.coords.map(ll) : null };
  });
  // điểm mốc vùng (đường thật nếu có)
  let anc = (buyer === 'vung' || kind === 'datnen' || kind === 'nhavuon')
    ? (S.anchors || []).filter(a => a.min <= 70 && !(edits.anchorsOff || []).includes(a.id)).slice(0, buyer === 'vung' ? 3 : 1) : [];
  if (edits.anchorOrder) anc = anc.slice().sort((a, b) => edits.anchorOrder.indexOf(a.id) - edits.anchorOrder.indexOf(b.id));
  const anchors = anc.map(a => ({ id: a.id, name: a.name, type: a.type, at: [a.lng, a.lat], km: a.km, min: a.min, route: a.coords ? a.coords.map(ll) : null }));
  // Hạ tầng: "Kết nối khu vực" có đủ (máy bay, metro, cao tốc). Mua để ở / cho thuê: AI chỉ thêm ĐÚNG 1 cảnh khi thật sự gần
  // (ga metro ≤ 2 km, sân bay ≤ 20 phút, cao tốc ≤ 3 km) — không thì thôi, video không bị dài loãng. Khách bỏ từng cảnh được.
  const I = S.infra || {};
  let infra = buyer === 'vung' ? { ...I }
    : I.metro && I.metro.nearKm <= 2 ? { metro: I.metro } : I.airport && I.airport.min <= 20 ? { airport: I.airport } : I.road && I.road.km <= 3 ? { road: I.road } : null;
  if (infra) for (const k of edits.infraOff || []) delete infra[k];
  if (infra && !Object.keys(infra).length) infra = null;

  // Hình căn nhà / lô đất: theo kích thước trong tin, quay mặt ra đường trước nhà
  const f = S.streets?.front;
  const front = f ? Math.atan2((f.b[1] - f.a[1]) * Math.cos(f.a[0] * Math.PI / 180), f.b[0] - f.a[0]) * 180 / Math.PI + 90 : 0;
  const w = L.w || (L.area ? Math.sqrt(L.area / 4) : 5), l = L.l || (L.area ? L.area / w : 20);
  const floorsN = (() => { const m = String(L.floors || '').match(/(\d+)\s*(lầu|tầng)/); return m ? +m[1] + (/trệt/.test(L.floors) ? 1 : 0) : 2; })();
  let footprint = null, lot = null;
  if (kind === 'datnen' || kind === 'nhavuon') {
    lot = { ring: rectM(H, w, l, front), label: `${KINDS[kind].label} ${L.dims || (L.area ? fmtNum(L.area) + ' m²' : '')}`.trim(),
      chips: [L.area && `${fmtNum(L.area)} m²`, L.w && `Mặt tiền ${fmtNum(L.w)} m`, L.thoCu, L.legal].filter(Boolean).slice(0, 3), green: kind === 'nhavuon' };
  } else if (kind !== 'canho') {
    footprint = { ring: rectM(H, w, l, front), height: Math.min(30, 3.6 * floorsN + 1) };
  }

  const place = L.ward || S.ward || '';
  const at = place ? ` ở <b>${place}</b>` : '';   // chưa biết phường/xã thì không nói, không đoán
  const kw = { nhapho: 'nhà', bietthu: 'biệt thự', nhavuon: 'nhà vườn', canho: 'căn hộ', datnen: 'lô đất' }[kind];
  const p0 = pois[0], center = anchors.find(a => a.type === 'center') || (S.anchors || []).find(a => a.type === 'center');
  const kcn = pois.find(p => p.cat === 'kcn');
  const intro = buyer === 'thue'
    ? (kcn ? `Mua để cho thuê? Căn này cách <b>${kcn.name}</b> ${mins(kcn) ? `<b>${mins(kcn)} phút</b>` : `<b>${km(kcn.km)}</b>`}.` : `Mua để cho thuê? Căn này${at}, quanh nhà đông người thuê.`)
    : buyer === 'vung'
      ? `${place ? `Từ <b>${place}</b>` : 'Từ đây'} đi đâu cũng gần${center ? `: về trung tâm <b>${center.min} phút</b>` : ''}.`
      : kind === 'datnen' ? `Lô đất <b>${L.dims || ''}</b>${at}${L.legal ? ', ' + L.legal.toLowerCase() : ''}.`
        : p0 ? `Tìm ${kw} gần trường cho con? Căn này${at ? at + ',' : ' có'} ${p0.cat === 'truong' ? (RX.mamnon.test(p0.name) ? 'trường mầm non' : 'trường') : p0.name} chỉ cách <b>${km(p0.km)}</b>.`
          : `${cap(kw)}${at}.`;
  const houseLine = [L.dims && `<b>${L.dims}</b>`, L.floors, L.level, L.beds && `<b>${L.beds} phòng ngủ</b>`, L.legal && L.legal.toLowerCase(), L.road && L.road.toLowerCase()]
    .filter(Boolean).join(', ');
  const lotLine = [L.area && `Diện tích <b>${fmtNum(L.area)} m²</b>`, L.w && `mặt tiền <b>${fmtNum(L.w)} m</b>`, f?.name && `quay ra <b>${f.name}</b>`, L.thoCu && L.thoCu.toLowerCase()]
    .filter(Boolean).join(', ');
  const n1 = c => S.pois.filter(p => p.cat === c && p.km <= 1).length;
  const score = [['Trường học', n1('truong')], ['Chợ, siêu thị', n1('cho')], ['Công viên', n1('congvien')], ['Y tế', n1('yte')], ['Ngân hàng', n1('nganhang')]]
    .map(([a, b]) => [a, b, false]);
  const top2 = score.slice().sort((a, b) => b[1] - a[1]).slice(0, 2);
  const lines = {
    intro, house: houseLine ? cap(houseLine) + '.' : '', lot: lotLine ? cap(lotLine) + '.' : '',
    poi: pois.map((p, i) => poiLine(p, buyer, pois.slice(0, i).filter(q => q.cat === 'truong').length)),   // 'Sáng đưa con đi học' cho trường xuất hiện đầu tiên
    anchor: anchors.map(a => `${a.type === 'center' ? 'Về' : 'Ra'} ${a.name}: <b>${fmtNum(a.km)} km</b>, khoảng <b>${a.min} phút</b>.`),
    score: top2[0][1] ? `Bán kính 1 km quanh nhà: <b>${top2[0][1]}${top2[0][2] ? '+' : ''} ${top2[0][0].toLowerCase()}</b>, ${top2[1][1]} ${top2[1][0].toLowerCase()}.` : '',
    airport: infra?.airport && `${infra.airport.name}: <b>${fmtNum(infra.airport.km)} km</b>, khoảng <b>${infra.airport.min} phút</b>, bay đi mọi miền.`,
    metro: infra?.metro && `${infra.metro.name} đã chạy, ga ${infra.metro.nearName} cách khoảng <b>${fmtNum(Math.round(infra.metro.nearKm * 10) / 10)} km</b> đường chim bay.`,
    road: infra?.road && `${infra.road.name} cách nhà <b>${fmtNum(Math.round(infra.road.km * 10) / 10)} km</b>.`,
    cta: L.price ? `Giá <b>${L.price}</b>. Nhắn tin ngay để hẹn xem ${kw}.` : `Nhắn tin ngay để hẹn xem ${kw}.`,
  };
  // khách sửa câu: ghi đè theo khoá cảnh (intro, house, lot, poi:<id>, anchor:<id>, score, cta…)
  const E = edits.lines || {};
  for (const k of ['intro', 'house', 'lot', 'score', 'airport', 'metro', 'road', 'cta']) if (E[k] != null) lines[k] = E[k];
  pois.forEach((p, i) => { if (E['poi:' + p.id] != null) lines.poi[i] = E['poi:' + p.id]; });
  anchors.forEach((a, i) => { if (E['anchor:' + a.id] != null) lines.anchor[i] = E['anchor:' + a.id]; });

  return {
    kind, buyer, persona: `${KINDS[kind].label} · ${BUYERS[buyer].label}`,
    house: H, info: { price: L.price || KINDS[kind].label, chips: infoChips(L) }, footprint, lot,
    pois, anchors, infra, score: lot || buyer === 'vung' ? null : score, lines,
    cta: L.price ? 'Nhắn tin để xem ' + kw : 'Nhắn tin để xem ' + kw, style: styleOf(kind, buyer), bird: !!edits.bird,
    watermark: edits.watermark || '',
  };
}
const cap = s => String(s || '').replace(/^\s*\S/, c => c.toUpperCase());
