// AI đạo diễn — "Agent": từ kết quả quét quanh căn + thông tin tin đăng + khách mua → kịch bản (story) cho js/dd3d.js.
// Chọn tiện ích theo khách mua, viết lời theo SỐ LIỆU THẬT (khoảng cách, phút, số tiện ích trong 1 km), chọn phong cách
// (nhạc, cách vẽ) theo loại bất động sản. Bản luật — bước sau thay phần viết lời bằng AI máy chủ (cùng dữ liệu, cùng luật cấm bịa).
import { KINDS, infoChips, fmtNum } from './dd-parse.js';
import { rectM, ROAD_COLORS } from './dd3d.js';
import { autoPickRoads } from './data.js';

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
  // Hạ tầng: "Kết nối khu vực" có đủ (máy bay, metro, cao tốc). Mua để ở / cho thuê: AI chỉ thêm ĐÚNG 1 cảnh khi thật sự gần
  // (ga metro ≤ 2 km, sân bay ≤ 20 phút, cao tốc ≤ 3 km) — không thì thôi, video không bị dài loãng. Khách bỏ từng cảnh được.
  const I = S.infra || {};
  let infra = buyer === 'vung' ? { ...I }
    : I.metro && I.metro.nearKm <= 2 ? { metro: I.metro } : I.airport && I.airport.min <= 20 ? { airport: I.airport } : I.road && I.road.km <= 3 ? { road: I.road } : null;
  if (infra) for (const k of edits.infraOff || []) delete infra[k];
  if (infra && !Object.keys(infra).length) infra = null;
  // Kết nối vùng (đường thật + số phút ô tô): MỌI khách đều có — về trung tâm + ra sân bay (không có thì cảng biển);
  // "Kết nối khu vực" tới 3 điểm. Sân bay đã có cảnh máy bay riêng thì không lặp.
  const avail = (S.anchors || []).filter(a => a.min <= 70 && !(edits.anchorsOff || []).includes(a.id) && !(a.type === 'airport' && infra?.airport));
  let anc = buyer === 'vung' ? avail.slice(0, 3)
    : [avail.find(a => a.type === 'center'), avail.find(a => a.type === 'airport') || avail.find(a => a.type === 'port')].filter(Boolean);
  if (edits.anchorOrder) anc = anc.slice().sort((a, b) => edits.anchorOrder.indexOf(a.id) - edits.anchorOrder.indexOf(b.id));
  const anchors = anc.map(a => ({ id: a.id, name: a.name, type: a.type, at: [a.lng, a.lat], km: a.km, min: a.min, route: a.coords ? a.coords.map(ll) : null }));

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
  // Trục đường lớn: Agent chọn 3 (luật app cũ autoPickRoads), khách thêm tới 5. Chỉ lấy đoạn trong 3,5 km quanh nhà cho nhẹ.
  const near = (pt) => Math.hypot((pt[1] - S.house.lng) * 111.32 * Math.cos(S.house.lat * Math.PI / 180), (pt[0] - S.house.lat) * 110.54);
  // luật app cũ có thể chỉ ra 1–2 trục → bổ sung trục lớn gần nhất (≤ 5 km), rồi đường nhỏ có tên sát nhà, cho đủ 3
  const roadIds = edits.roads || (() => {
    // chỉ trục trong vùng cắt 3,5 km (cao tốc xa 8 km bị cắt hết đoạn → mất một trục)
    const all = (S.roadsAll || []).filter(r => r.nearKm <= 3.4), ids = autoPickRoads(all, 3), byNear = [...all].sort((a, b) => a.nearKm - b.nearKm);
    for (const r of byNear) if (ids.length < 3 && r.level >= 1 && !ids.includes(r.id)) ids.push(r.id);
    for (const r of byNear) if (ids.length < 3 && r.nearKm <= 1.2 && !ids.includes(r.id)) ids.push(r.id);
    return ids;
  })();
  const roads = roadIds.map(id => (S.roadsAll || []).find(r => r.id === id)).filter(Boolean).slice(0, 5).map((r, j) => ({
    id: r.id, name: r.label || r.name, km: r.nearKm, color: ROAD_COLORS[j % ROAD_COLORS.length],
    ways: r.ways.map(w => w.filter(pt => near(pt) <= 3.5).map(([la, ln]) => [ln, la])).filter(w => w.length > 1),
  })).filter(r => r.ways.length);
  // Vùng quan trọng: ranh khu công nghiệp / bệnh viện / đại học / công viên của tiện ích đã chọn + ranh sân bay khi có cảnh sân bay
  const ringLL = r => { const q = r.map(([la, ln]) => [ln, la]); if (q.length && (q[0][0] !== q.at(-1)[0] || q[0][1] !== q.at(-1)[1])) q.push(q[0]); return q; };
  const zones = (S.zones || []).filter(z => pois.some(p => p.id === z.poiId)).map(z => ({ id: 'z:' + z.poiId, poiId: z.poiId, cat: z.cat, name: z.name, rings: z.pieces.flatMap(pc => pc.rings.map(ringLL)) }));
  // (sân bay: ranh đường biên sân bay — chỉ khi có cảnh sân bay)
  // Hạ tầng đang thi công (OpenStreetMap, như app cũ): tối đa 2 tuyến trong 5 km
  const build = (S.build || []).filter(b => b.nearKm <= 5 && !(edits.buildOff || []).includes(b.id)).slice(0, 2).map(b => ({
    id: b.id, name: b.label, km: b.nearKm, ways: b.ways.map(w => w.map(([la, ln]) => [ln, la])).filter(w => w.length > 1) })).filter(b => b.ways.length);
  const kwFull = { nhapho: 'căn nhà', bietthu: 'căn biệt thự', nhavuon: 'căn nhà vườn', canho: 'căn hộ', datnen: 'lô đất' }[kind];
  const kw = { nhapho: 'nhà', bietthu: 'biệt thự', nhavuon: 'nhà vườn', canho: 'căn hộ', datnen: 'lô đất' }[kind];
  const p0 = pois[0], center = anchors.find(a => a.type === 'center') || (S.anchors || []).find(a => a.type === 'center');
  const kcn = pois.find(p => p.cat === 'kcn');
  // Lời Agent (chưa bấm AI viết): công thức như Marketing OS — mua để ở P.A.S (nói trúng nỗi lo rồi lấy số liệu thật làm lời giải),
  // đầu tư cho thuê A.I.D.A (điều nhà đầu tư cần nhất → bằng chứng → hành động). Chỉ số liệu thật, không hứa lời lãi / tăng giá.
  const p0name = p0 && (p0.cat === 'truong' ? (RX.mamnon.test(p0.name) ? 'trường mầm non' : 'trường học') : p0.name);
  const intro = buyer === 'thue'
    ? (kcn ? `Mua ${kw} để cho thuê, điều quan trọng nhất là gần nơi đông người đi làm. Căn này cách <b>${kcn.name}</b> chỉ ${mins(kcn) ? `<b>${mins(kcn)} phút</b>` : `<b>${km(kcn.km)}</b>`}.`
      : `Mua ${kw} để cho thuê, điều quan trọng nhất là vị trí người thuê cần. Cùng xem căn này${at} có gì quanh nhà.`)
    : buyer === 'vung'
      ? `${place ? `Từ <b>${place}</b>` : 'Từ đây'} đi đâu cũng gần${center ? `: về trung tâm chỉ <b>${center.min} phút</b>` : ''}. Xem vì sao vị trí này đáng chú ý.`
      : kind === 'datnen' ? `Tìm lô đất vị trí đẹp mà pháp lý rõ ràng? Lô đất <b>${L.dims || ''}</b>${at}${L.legal ? ', ' + L.legal.toLowerCase() : ''}.`
        : p0 ? `Mua nhà cho cả gia đình, ai cũng sợ ${p0.cat === 'truong' ? 'con đi học xa, sáng nào cũng vội' : 'đi lại bất tiện, việc gì cũng xa'}. Căn này${at ? at + ',' : ' có'} ${p0name} chỉ cách <b>${km(p0.km)}</b>.`
          : `${cap(kw)}${at}, xem quanh nhà có gì nhé.`;
  const houseLine = [L.dims && `<b>${L.dims}</b>`, L.floors, L.level, L.beds && `<b>${L.beds} phòng ngủ</b>`, L.legal && L.legal.toLowerCase(), L.road && L.road.toLowerCase()]
    .filter(Boolean).join(', ');
  const lotLine = [L.area && `Diện tích <b>${fmtNum(L.area)} m²</b>`, L.w && `mặt tiền <b>${fmtNum(L.w)} m</b>`, f?.name && `quay ra <b>${f.name}</b>`, L.thoCu && L.thoCu.toLowerCase()]
    .filter(Boolean).join(', ');
  // Điểm sống quanh nhà: đếm tiện ích thật trong 1 km; vùng ven ít tiện ích (cả bảng < 6) thì nới 2 km rồi 3 km,
  // bỏ dòng bằng 0, không còn dòng nào thì bỏ cảnh (không hiện bảng toàn số 0)
  const SC = [['Trường học', 'truong'], ['Chợ, siêu thị', 'cho'], ['Công viên', 'congvien'], ['Y tế', 'yte'], ['Ngân hàng', 'nganhang']];
  const cnt = (c, r) => (S.pois || []).filter(p => p.cat === c && p.km <= r).length;
  const scoreR = [1, 2, 3].find(r => SC.reduce((s, [, c]) => s + cnt(c, r), 0) >= 6) || 3;
  const score = SC.map(([a, c]) => [a, cnt(c, scoreR), false]).filter(x => x[1] > 0);
  const top2 = score.slice().sort((a, b) => b[1] - a[1]).slice(0, 2);
  const lines = {
    intro, house: houseLine ? cap(houseLine) + '.' : '', lot: lotLine ? cap(lotLine) + '.' : '',
    poi: pois.map((p, i) => poiLine(p, buyer, pois.slice(0, i).filter(q => q.cat === 'truong').length)),   // 'Sáng đưa con đi học' cho trường xuất hiện đầu tiên
    // kết nối vùng: số phút ô tô theo đường đi thật
    anchor: anchors.map(a => a.type === 'center' ? `Về ${a.name} chỉ khoảng <b>${a.min} phút</b> ô tô, quãng đường <b>${fmtNum(a.km)} km</b>.`
      : a.type === 'airport' ? `Ra ${a.name} khoảng <b>${a.min} phút</b>, đi công tác, về quê đều thuận tiện.`
        : `${cap(a.type === 'port' ? a.name : 'Tới ' + a.name)} cách <b>${fmtNum(a.km)} km</b>, khoảng <b>${a.min} phút</b> ô tô.`),
    score: top2.length ? `Bán kính ${scoreR} km quanh nhà: <b>${top2[0][1]} ${top2[0][0].toLowerCase()}</b>${top2[1] ? `, ${top2[1][1]} ${top2[1][0].toLowerCase()}` : ''}. ${buyer === 'thue' ? 'Người thuê ở đây sống tiện, đi đâu cũng gần.' : 'Mọi nhu cầu hằng ngày đều trong tầm tay.'}` : '',
    airport: infra?.airport && `${infra.airport.name}: <b>${fmtNum(infra.airport.km)} km</b>, khoảng <b>${infra.airport.min} phút</b>, bay đi mọi miền.`,
    metro: infra?.metro && `${infra.metro.name} đã chạy, ga ${infra.metro.nearName} cách khoảng <b>${fmtNum(Math.round(infra.metro.nearKm * 10) / 10)} km</b> đường chim bay.`,
    road: infra?.road && `${infra.road.name} cách nhà <b>${fmtNum(Math.round(infra.road.km * 10) / 10)} km</b>.`,
    // lời kêu gọi đúng loại sản phẩm: nhà → đi xem nhà, lô đất → đi xem lô đất, căn hộ / biệt thự / nhà vườn tương tự
    cta: `${L.price ? `Giá <b>${L.price}</b>. ` : ''}${buyer === 'o' ? `Vị trí đủ đầy như vậy không dễ tìm, nhắn tin ngay để hẹn đi xem ${kwFull}.` : `Nhắn tin ngay để nhận thông tin chi tiết và hẹn đi xem ${kwFull}.`}`,
    // cảnh ảnh căn nhà: đọc điểm nổi bật CHÍNH môi giới viết trong tin (không có thì câu mời xem chung, không bịa)
    // cảnh ảnh (cuối video): chỉ giới thiệu đây là ảnh thực tế — khớp với mọi ảnh, không tả bịa nội dung từng ảnh
    photos: (edits.photos || []).length ? `Đây là hình ảnh thực tế của ${kwFull}, mời anh chị xem qua.` : '',
    roads: roads.length ? `${buyer === 'o' ? 'Đi làm, đi chơi đều thuận tiện' : 'Giao thông là lợi thế'}: kết nối nhanh các trục lớn ${roads.map(r => `<b>${r.name}</b>`).join(', ').replace(/, ([^,]*)$/, ' và $1')}.` : '',
    build: build.length ? `Hạ tầng đang thi công gần nhà: <b>${build[0].name}</b>, cách <b>${km(build[0].km)}</b>. Khi xong, khu vực kết nối càng thuận tiện.` : '',
  };
  // khách sửa câu: ghi đè theo khoá cảnh (intro, house, lot, poi:<id>, anchor:<id>, score, cta…)
  const E = edits.lines || {};
  for (const k of ['intro', 'house', 'lot', 'photos', 'roads', 'build', 'score', 'airport', 'metro', 'road', 'cta']) if (E[k] != null) lines[k] = E[k];
  pois.forEach((p, i) => { if (E['poi:' + p.id] != null) lines.poi[i] = E['poi:' + p.id]; });
  anchors.forEach((a, i) => { if (E['anchor:' + a.id] != null) lines.anchor[i] = E['anchor:' + a.id]; });

  return {
    kind, buyer, persona: `${KINDS[kind].label} · ${BUYERS[buyer].label}`,
    house: H, info: { price: L.price || KINDS[kind].label, chips: infoChips(L) }, footprint, lot,
    pois, anchors, infra, score: lot || buyer === 'vung' || !score.length ? null : score, scoreR, lines,
    cta: `Nhắn tin hẹn đi xem ${kwFull}`, style: styleOf(kind, buyer), bird: !!edits.bird,
    watermark: edits.watermark || '',
    photos: edits.photos || [], roads, zones: [...zones, ...airportZone(S, infra)], build,
    // Ảnh bìa (mẫu Giang chọn 11/11): tên căn/dự án, phường, GIÁ BÁN to, 2 dòng phụ — chữ lấy đúng từ tin đăng; màu tự đổi theo căn
    cover: {
      title: (L.title || `${KINDS[kind].label}${place ? ' ' + place : ''}`).toUpperCase(),
      ward: (place || L.province || '').toUpperCase(),
      label: L.price ? 'GIÁ BÁN' : 'VỊ TRÍ',
      big: (L.price || KINDS[kind].label).toUpperCase(),
      lines: [L.street || L.road, [L.dims || (L.area && `${fmtNum(L.area)}m²`), L.floors || L.level, L.legal].filter(Boolean).slice(0, 2).join('  ·  ')].filter(Boolean),
      color: COVER_COLORS[((edits.palette ?? Math.abs(Math.round((S.house.lat * 1e4) + (S.house.lng * 1e4)))) % COVER_COLORS.length + COVER_COLORS.length) % COVER_COLORS.length],
    },
  };
}
// Màu nhấn ảnh bìa (tự đổi theo căn, khách bấm "Đổi màu bìa" để xoay vòng)
export const COVER_COLORS = ['#FF4FA3', '#FF7A1A', '#1E90FF', '#8B5CF6', '#10B981', '#EF4444', '#14B8A6', '#F59E0B'];
const cap = s => String(s || '').replace(/^\s*\S/, c => c.toUpperCase());

// ranh sân bay (đa giác sân bay từ OpenStreetMap, lấy cùng lúc với đường băng) → vùng hiện trong cảnh sân bay
function airportZone(S, infra) {
  if (!infra?.airport || !S.airportParts?.length) return [];
  const rings = S.airportParts.map(p => { const q = p.pts.map(([la, ln]) => [ln, la]); q.push(q[0]); return q; });
  return [{ id: 'z:airport', cat: 'airport', name: infra.airport.name, rings }];
}
