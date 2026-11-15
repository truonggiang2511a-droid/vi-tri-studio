// AI đạo diễn — "Agent": từ kết quả quét quanh căn + thông tin tin đăng + khách mua → kịch bản (story) cho js/dd3d.js.
// Chọn tiện ích theo khách mua, viết lời theo SỐ LIỆU THẬT (khoảng cách, phút, số tiện ích trong 1 km), chọn phong cách
// (nhạc, cách vẽ) theo loại bất động sản. Bản luật — bước sau thay phần viết lời bằng AI máy chủ (cùng dữ liệu, cùng luật cấm bịa).
import { KINDS, infoChips, fmtNum } from './dd-parse.js';
import { rectM, ROAD_COLORS } from './dd3d.js';
import { autoPickRoads } from './data.js';

// 15/11 (Giang): tách rõ "Đầu tư sinh lời" (khoá 'vung' giữ nguyên cho dữ liệu đã lưu — trước là "Kết nối khu vực") và "Đầu tư cho thuê"
export const BUYERS = {
  o: { label: 'Mua để ở', sub: 'Gia đình, có con nhỏ — trường, chợ, bệnh viện gần', icon: '👨‍👩‍👧' },
  vung: { label: 'Đầu tư sinh lời', sub: 'Hạ tầng đang làm, kết nối vùng, giá mỗi m²', icon: '📈' },
  thue: { label: 'Đầu tư cho thuê', sub: 'Người thuê: công nhân, sinh viên, người đi làm', icon: '🔑' },
};
// Gợi ý khách mua theo loại nhà (khách đổi được)
export const suggestBuyer = kind => kind === 'datnen' || kind === 'nhavuon' ? 'vung' : 'o';

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
  // ≥ 1 km có số phút thật: nói phút (người mua nghĩ bằng phút); gần hơn: nói mét (con số nhỏ thuyết phục hơn)
  const m = mins(p), d = p.km >= 1 && m ? `<b>${m} phút</b>` : `<b>${km(p.km)}</b>`, t = '';
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
  // Bản ngắn (mặc định, 15/11): 35–50 s cho TikTok/Reels — ít tiện ích hơn, tiện ích phụ gom 1 cảnh, 1 điểm mốc vùng.
  // Bản đầy đủ (khách tick, cho YouTube/Zalo): như trước 15/11.
  const full = !!edits.full;
  // Kiểu hiện tiện ích (15/11): 'lanluot' (mặc định) bay tới từng tiện ích, vẽ đường đi; 'vong' máy lượn 360° góc xa, tiện ích chỉ
  // bật nhãn lên (không vẽ đường đi) — line chỉ còn ở trục đường lớn và đường đi lên trung tâm / sân bay / ga / cảng
  const vong = edits.flow === 'vong';
  const max = vong ? (buyer === 'vung' ? 3 : kind === 'datnen' || kind === 'nhavuon' ? 4 : 6)
    : buyer === 'vung' ? 2 : kind === 'datnen' || kind === 'nhavuon' ? 3 : full ? 5 : 4;
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
  // 15/11 (Giang: thiếu hạ tầng gần nhà): mọi hạ tầng đủ gần đều vào video (trước chỉ lấy 1)
  let infra = buyer === 'vung' ? { ...I } : Object.fromEntries([I.metro && I.metro.nearKm <= 2 && ['metro', I.metro], I.airport && I.airport.min <= 20 && ['airport', I.airport],
    I.road && I.road.km <= 3 && ['road', I.road]].filter(Boolean));
  if (!Object.keys(infra).length) infra = null;
  for (const k of edits.infraAdd || []) if (I[k]) (infra ||= {})[k] = I[k];   // khách tự thêm (ô "Đường lớn · sân bay")
  if (infra) for (const k of edits.infraOff || []) delete infra[k];
  if (infra && !Object.keys(infra).length) infra = null;
  // cảnh sân bay: kèm đường đi thật từ nhà lên sân bay (lấy từ điểm mốc sân bay cùng tên) → khách thấy cả quãng đường, không chỉ cận cảnh
  if (infra?.airport) {
    const ap = (S.anchors || []).find(a => a.type === 'airport' && a.name === infra.airport.name);
    infra.airport = { ...infra.airport, route: ap?.coords?.length > 1 ? ap.coords.map(([la, ln]) => [ln, la]) : null };
  }
  // Kết nối vùng (đường thật + số phút ô tô): MỌI khách đều có — về trung tâm + ra sân bay (không có thì cảng biển);
  // "Kết nối khu vực" tới 3 điểm. Sân bay đã có cảnh máy bay riêng thì không lặp.
  const avail = (S.anchors || []).filter(a => a.min <= 70 && !(edits.anchorsOff || []).includes(a.id) && !(a.type === 'airport' && infra?.airport));
  const ctr = avail.find(a => a.type === 'center'), far = avail.find(a => a.type === 'airport') || avail.find(a => a.type === 'port');
  // bản ngắn: mua để ở / cho thuê chỉ 1 điểm mốc (trung tâm nếu ≤ 45 phút, không thì sân bay / cảng)
  let anc = buyer === 'vung' ? avail.slice(0, full ? 3 : 2)
    : full ? [ctr, far].filter(Boolean) : [ctr && ctr.min <= 45 ? ctr : far || ctr].filter(Boolean);
  // khách tự thêm điểm mốc (sân bay, ga, cảng, trung tâm khác) — kể cả điểm xa hơn 70 phút
  for (const id of edits.anchorsAdd || []) {
    const a = (S.anchors || []).find(x => x.id === id);
    if (a && !anc.includes(a) && !(edits.anchorsOff || []).includes(id)) anc.push(a);
  }
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
  // Ranh xã/phường + tỉnh (máy chủ /api/map/area, OSM theo đơn vị mới 2025) → mở đầu khoanh sáng tỉnh rồi xã. Không có thì bỏ.
  const ringsLL = a => (a?.rings || []).map(r => { const q = r.map(([la, ln]) => [ln, la]); if (q.length && (q[0][0] !== q.at(-1)[0] || q[0][1] !== q.at(-1)[1])) q.push(q[0]); return q; }).filter(r => r.length > 3);
  const area = S.area && (S.area.ward?.rings?.length || S.area.province?.rings?.length) ? {
    ward: S.area.ward?.rings?.length ? { name: S.area.ward.name, rings: ringsLL(S.area.ward) } : null,
    province: S.area.province?.rings?.length ? { name: S.area.province.name, rings: ringsLL(S.area.province) } : null,
  } : null;
  const prov = L.province === 'TP.HCM' ? 'Thành phố Hồ Chí Minh' : L.province || area?.province?.name || '';
  // 15/11 vòng 5 (Giang): mở đầu NÓI VỊ TRÍ TRƯỚC, đúng thứ tự hình đang khoanh sáng (tỉnh → xã), rồi mới tới câu móc giá/lợi ích
  const lead = place ? (prov && !place.includes(prov) ? `Tại <b>${prov}</b>, ${kwOf(kind)} này nằm ở <b>${place}</b>.` : `${cap(kwOf(kind))} này nằm ở <b>${place}</b>.`) : prov ? `${cap(kwOf(kind))} này nằm tại <b>${prov}</b>.` : '';
  // Trục đường lớn: Agent chọn 3 (luật app cũ autoPickRoads), khách thêm tới 5. Chỉ lấy đoạn trong 3,5 km quanh nhà cho nhẹ.
  const near = (pt) => Math.hypot((pt[1] - S.house.lng) * 111.32 * Math.cos(S.house.lat * Math.PI / 180), (pt[0] - S.house.lat) * 110.54);
  // luật app cũ có thể chỉ ra 1–2 trục → bổ sung trục lớn gần nhất (≤ 5 km), rồi đường nhỏ có tên sát nhà, cho đủ 3
  const roadIds = edits.roads || (() => {
    // chỉ trục trong vùng cắt 3,5 km (cao tốc xa 8 km bị cắt hết đoạn → mất một trục)
    const nR = full ? 3 : 2;   // bản ngắn: 2 trục gần nhất
    const all = (S.roadsAll || []).filter(r => r.nearKm <= 3.4), ids = autoPickRoads(all, nR).slice(0, nR), byNear = [...all].sort((a, b) => a.nearKm - b.nearKm);
    for (const r of byNear) if (ids.length < nR && r.level >= 1 && !ids.includes(r.id)) ids.push(r.id);
    for (const r of byNear) if (ids.length < nR && r.nearKm <= 1.2 && !ids.includes(r.id)) ids.push(r.id);
    return ids;
  })();
  const roads = roadIds.map(id => (S.roadsAll || []).find(r => r.id === id)).filter(Boolean).slice(0, 5).map((r, j) => {
    // điểm trên trục gần nhà nhất + đường đi thật từ nhà ra đó (dao-dien.js roadRoutesFor → S.roadRoutes); chưa có thì ước lượng
    let best = null;
    for (const w of r.ways) for (const pt of w) { const d = near(pt); if (!best || d < best.d) best = { d, pt }; }
    const rr = S.roadRoutes?.[r.id], dkm = rr ? rr.km : (best ? best.d * 1.3 : r.nearKm);
    return {
      id: r.id, name: r.label || r.name, km: r.nearKm, color: ROAD_COLORS[j % ROAD_COLORS.length],
      near: best ? [best.pt[1], best.pt[0]] : null, dkm, min: Math.max(1, Math.round(rr && rr.min > 0 ? Math.min(rr.min, dkm / 25 * 60) : dkm / 28 * 60)),
      route: rr?.coords?.length > 1 ? rr.coords.map(([la, ln]) => [ln, la]) : null,
      // trục xa khách tự thêm (cao tốc / quốc lộ cách 5–15 km): lấy đoạn tới cách nhà khoảng cách trục + 1,5 km
      ways: r.ways.map(w => w.filter(pt => near(pt) <= Math.max(3.5, (r.nearKm || 0) + 1.5)).map(([la, ln]) => [ln, la])).filter(w => w.length > 1),
    };
  }).filter(r => r.ways.length);
  // Vùng quan trọng: ranh khu công nghiệp / bệnh viện / đại học / công viên của tiện ích đã chọn + ranh sân bay khi có cảnh sân bay
  const ringLL = r => { const q = r.map(([la, ln]) => [ln, la]); if (q.length && (q[0][0] !== q.at(-1)[0] || q[0][1] !== q.at(-1)[1])) q.push(q[0]); return q; };
  const zones = (S.zones || []).filter(z => pois.some(p => p.id === z.poiId)).map(z => ({ id: 'z:' + z.poiId, poiId: z.poiId, cat: z.cat, name: zoneName(z.name), rings: z.pieces.flatMap(pc => pc.rings.map(ringLL)) }));
  // (sân bay: ranh đường biên sân bay — chỉ khi có cảnh sân bay)
  // Hạ tầng đang thi công (OpenStreetMap, như app cũ): tối đa 2 tuyến trong 5 km
  // hạ tầng đang thi công (đường / cao tốc OSM + metro đang xây — METRO_BUILD) trong 5 km: luôn vào video (15/11, Giang: bị thiếu)
  const build = (S.build || []).filter(b => b.nearKm <= 5 && !(edits.buildOff || []).includes(b.id)).slice(0, 2).map(b => ({
    id: b.id, name: b.label, km: b.nearKm, station: b.metro?.station || '', ways: b.ways.map(w => w.map(([la, ln]) => [ln, la])).filter(w => w.length > 1) })).filter(b => b.ways.length);
  const kwFull = { nhapho: 'căn nhà', bietthu: 'căn biệt thự', nhavuon: 'căn nhà vườn', canho: 'căn hộ', datnen: 'lô đất' }[kind];
  const kw = { nhapho: 'nhà', bietthu: 'biệt thự', nhavuon: 'nhà vườn', canho: 'căn hộ', datnen: 'lô đất' }[kind];
  const p0 = pois[0], center = anchors.find(a => a.type === 'center') || (S.anchors || []).find(a => a.type === 'center');
  const kcn = pois.find(p => p.cat === 'kcn');
  // ---- Lời Agent (chưa bấm AI viết) theo LOẠI KHÁCH × PHONG CÁCH (15/11, Giang: đánh trúng nỗi lo khách để tăng chuyển đổi) ----
  // Mua để ở: sợ con đi học xa, chật chội, giấy tờ không rõ · Đầu tư cho thuê: sợ phòng trống, xa chỗ làm của người thuê ·
  // Đầu tư sinh lời: sợ mua chỗ hạ tầng đứng yên. Lời giải = số liệu THẬT (tin đăng + quét); không hứa lời lãi / tăng giá,
  // không tả bịa nội thất / an ninh / view. Phong cách: khách chọn ở "Kiểu lời", để Tự chọn thì theo khách (ở PAS, thuê AIDA, sinh lời Chuyên gia).
  const tone = TONE_KEYS.includes(edits.tone) ? edits.tone : AUTO_TONE[buyer] || 'pas';
  const p0name = p0 && catWord(p0);
  const p0d = p0 && (p0.km >= 1 && mins(p0) ? `<b>${mins(p0)} phút</b>` : `<b>${km(p0.km)}</b>`);   // ≥ 1 km: phút trước (người mua nghĩ bằng phút)
  const P = L.price ? `<b>${L.price}</b>` : '', ppm = ppmOf(L.price, L.area), PPM = ppm ? `<b>${ppm}</b>` : '';
  const legal = L.legal ? L.legal.toLowerCase() : '', legalOk = /sổ\s*(hồng|đỏ)/i.test(L.legal || '');
  const kcnD = kcn && (mins(kcn) ? `<b>${mins(kcn)} phút</b>` : `<b>${km(kcn.km)}</b>`);
  const b0 = build[0];
  const infraHook = b0 ? `${b0.station ? `${b0.station} tuyến <b>${b0.name}</b>` : `<b>${b0.name}</b>`} đang thi công, cách <b>${km(b0.km)}</b>`
    : infra?.metro ? `ga metro ${infra.metro.nearName} chỉ cách <b>${km(infra.metro.nearKm)}</b>` : infra?.road ? `<b>${infra.road.name}</b> chỉ cách <b>${km(infra.road.km)}</b>` : '';
  const ctrHook = center ? `về trung tâm chỉ <b>${center.min} phút</b>` : '';
  const near1 = p0 ? `${p0name} chỉ ${p0d}` : '';
  const street = L.street || (f?.name ? `đường ${f.name}` : '');
  const at = street ? `ngay ${street.replace(/^Mặt tiền/, 'mặt tiền')}` : '';
  const lotKind = kind === 'datnen' || kind === 'nhavuon';
  const specs = (lotKind ? [L.dims && `<b>${L.dims}</b>`, L.area && `diện tích <b>${fmtNum(L.area)} m²</b>`, L.w && `mặt tiền <b>${fmtNum(L.w)} m</b>`, !at && f?.name && `quay ra <b>${f.name}</b>`, L.road && L.road.toLowerCase(), L.thoCu && L.thoCu.toLowerCase()]
    : [L.dims && `<b>${L.dims}</b>`, L.area && `diện tích <b>${fmtNum(L.area)} m²</b>`, L.floors, L.level, L.beds && `<b>${L.beds} phòng ngủ</b>`, L.baths && `${L.baths} nhà vệ sinh`,
      L.facing && L.facing.toLowerCase(), L.thoCu && L.thoCu.toLowerCase(), L.road && L.road.toLowerCase()]).filter(Boolean).join(', ');
  const J = (...xs) => xs.filter(Boolean).join(' ');   // nối các câu (bỏ câu thiếu dữ liệu)
  const K = cap(kwFull);
  // [câu mở đầu (móc), câu căn nhà (máy lượn 360°), câu dẫn trước lời kêu gọi]
  const TPL = {
    pas: {
      o: [p0 ? `Mua nhà sợ nhất ${p0.cat === 'truong' ? 'con đi học xa, sáng nào cũng vội' : 'việc gì cũng xa'}? ${P ? `Chỉ ${P}, ${kwFull}` : K} này có ${near1}.` : `Mua nhà sợ nhất chật chội, giấy tờ không rõ ràng?${P ? ` ${K} này chỉ ${P}.` : ''}`,
        J(at && `${K} ${at}.`, specs && `${cap(specs)}${L.beds ? ', đủ chỗ cho cả gia đình' : ''}.`, legalOk ? `${cap(legal)}, giấy tờ rõ ràng, an tâm sang tên.` : legal && `${cap(legal)}.`),
        'Căn giải quyết đúng nỗi lo như vậy không dễ tìm.'],
      thue: [`Đầu tư cho thuê sợ nhất là phòng trống.${kcn ? ` ${K} này cách <b>${kcn.name}</b> chỉ ${kcnD}, người thuê luôn cần ở gần chỗ làm.` : P ? ` ${K} này giá ${P}.` : ''}`,
        J(at && `${K} ${at}.`, specs && `${cap(specs)}.`, L.beds >= 2 && 'Có thể cho thuê nguyên căn hoặc từng phòng.', legal && `${cap(legal)}.`),
        'Đừng để vốn nằm yên.'],
      vung: [`Đầu tư sợ nhất là mua chỗ hạ tầng đứng yên.${infraHook ? ` ${K} này có ${infraHook}.` : ctrHook ? ` Từ ${kwFull} này ${ctrHook}.` : ''}`,
        J(at && `${K} ${at}.`, specs && `${cap(specs)}.`, PPM && `Đơn giá khoảng ${PPM}.`, legalOk ? `${cap(legal)}, pháp lý rõ ràng.` : legal && `${cap(legal)}.`),
        'Hạ tầng đang làm, đừng chậm một bước.'],
    },
    aida: {
      o: [`${P ? `Chỉ ${P}` : `${K} này`}${near1 ? `, ${near1}` : ''}.`,
        J(specs && `${cap(specs)}${L.beds >= 2 ? ', mỗi người một không gian riêng' : ''}.`, (at || legal) && `${cap([at, legal].filter(Boolean).join(', '))}.`), ''],
      thue: [`${kcn ? `Chỉ ${kcnD} tới <b>${kcn.name}</b>` : P ? `Chỉ ${P}` : `${K} cho thuê`}${P && kcn ? `, giá ${P}` : ''}.`,
        J(specs && `${cap(specs)}.`, L.beds >= 2 && 'Mỗi phòng có thể cho thuê riêng.', (at || legal) && `${cap([at, legal].filter(Boolean).join(', '))}.`), ''],
      vung: [`${PPM ? `Chỉ khoảng ${PPM}` : P ? `Chỉ ${P}` : 'Vị trí này'}${infraHook ? `, ${infraHook}` : ctrHook ? `, ${ctrHook}` : ''}.`,
        J(specs && `${cap(specs)}.`, (at || legal) && `${cap([at, legal].filter(Boolean).join(', '))}.`), ''],
    },
    'ke-chuyen': {
      o: [`Hình dung sáng mai ${p0?.cat === 'truong' ? `dắt con đi bộ tới ${p0name}, chỉ ${p0d}` : p0 ? `ra ${p0name} chỉ ${p0d}` : `thức dậy trong ${kwFull} của riêng mình`}.`,
        J(at && `Mở cửa là ${street.replace(/^Mặt tiền/, 'mặt tiền')}.`, specs && `${lotKind ? 'Lô đất' : 'Trong nhà'}: ${specs}.`, legalOk ? `${cap(legal)}, an tâm ở lâu dài.` : legal && `${cap(legal)}.`), 'Muốn tận mắt thấy?'],
      thue: [kcn ? `Mỗi sáng, người thuê ở đây chạy xe ${kcnD} là tới <b>${kcn.name}</b>.` : p0 ? `Mỗi sáng, người thuê ở đây ra ${p0name} chỉ ${p0d}.` : 'Cùng xem một ngày của người thuê ở đây.',
        J(specs && `${K} có ${specs}.`, L.beds >= 2 && 'Đủ phòng cho cả nhóm người đi làm ở chung.', legal && `${cap(legal)}.`), 'Muốn tận mắt thấy?'],
      vung: [b0 ? `Hình dung ngày <b>${b0.name}</b> hoàn thành, ${kwFull} này chỉ cách <b>${km(b0.km)}</b>.` : ctrHook ? `Hình dung mỗi ngày từ đây ${ctrHook}.` : `Hình dung giá trị của một vị trí đúng chỗ.`,
        J(at && `${K} ${at}.`, specs && `${cap(specs)}.`, PPM && `Đơn giá khoảng ${PPM}.`, legal && `${cap(legal)}.`), 'Muốn tận mắt thấy?'],
    },
    'chuyen-gia': {
      o: [`Nhìn bằng con số: ${[P && `giá ${P}`, PPM && `khoảng ${PPM}`, near1].filter(Boolean).join(', ') || 'phân tích nhanh vị trí này'}.`],
      thue: [`Nhìn bằng con số: ${[P && `giá ${P}`, kcn && `cách ${kcn.name} ${kcnD}`, p0 !== kcn && near1].filter(Boolean).slice(0, 3).join(', ') || 'phân tích nhanh vị trí này'}.`],
      vung: [`Nhìn bằng con số: ${[P && `giá ${P}`, PPM && `khoảng ${PPM}`, infraHook || ctrHook].filter(Boolean).join(', ') || 'phân tích nhanh vị trí này'}.`],
    },
    'chot-sale': {
      o: [`${P || K}${legal ? `, ${legal}` : ''}${near1 ? `, ${near1}` : ''}.`],
      thue: [`${P || K}${legal ? `, ${legal}` : ''}${kcn ? `, cách ${kcn.name} ${kcnD}` : near1 ? `, ${near1}` : ''}.`],
      vung: [`${P || K}${legal ? `, ${legal}` : ''}${infraHook ? `, ${infraHook}` : ctrHook ? `, ${ctrHook}` : ''}.`],
    },
  };
  const expertHouse = `Thông số: ${[specs, legal, PPM && `đơn giá khoảng ${PPM}`, at].filter(Boolean).join(', ')}.`;
  const saleHouse = J(specs && `${cap(specs)}.`, (at || legal) && `${cap([at, legal].filter(Boolean).join(', '))}.`, 'Thông tin rõ ràng, hẹn xem ngay trong tuần.');
  const tp = TPL[tone][buyer] || TPL[tone].o;
  const intro = J(lead, cap(tp[0]));
  const houseText = tone === 'chuyen-gia' ? expertHouse : tone === 'chot-sale' ? saleHouse : tp[1];
  const ctaLead = tone === 'chuyen-gia' ? 'Cần bảng thông số đầy đủ?' : tone === 'chot-sale' ? 'Xem sớm để không lỡ.' : tp[2] || '';
  const houseLine = houseText && houseText !== 'Thông số: .' ? houseText : '';
  const lotLine = houseLine;
  // Gom cụm (bản ngắn, ≥ 3 tiện ích): tiện ích đầu (mạnh nhất theo khách) có cảnh riêng, còn lại MỘT cảnh — ghim bật lần lượt
  const cluster = !vong && !full && pois.length >= 3 ? { idx: pois.map((_, i) => i).slice(1) } : null;
  // Lượn 360° góc xa: MỘT cảnh cho mọi tiện ích, nhãn bật lần lượt đúng lúc lời đọc nhắc tới (dd3d tìm chữ trong câu)
  const orbit = vong && pois.length ? { idx: pois.map((_, i) => i), words: pois.map(catWord), r: Math.max(...pois.map(p => p.km)) } : null;
  if (orbit) orbit.line = `Nhìn quanh một vòng: trong <b>${km(Math.ceil(orbit.r * 10) / 10)}</b> quanh nhà có ${[...new Set(orbit.words)].join(', ').replace(/, ([^,]*)$/, ' và $1')}.`;
  if (cluster) {
    const cp = cluster.idx.map(i => pois[i]);
    cluster.r = Math.max(...cp.map(p => p.km));
    const words = [...new Set(cp.map(catWord))];
    cluster.words = cp.map(catWord);   // dd3d tìm chữ này trong lời đọc → máy lia tới đúng tiện ích lúc nói tới nó
    cluster.line = `Trong <b>${km(Math.ceil(cluster.r * 10) / 10)}</b> quanh đây còn có ${words.join(', ').replace(/, ([^,]*)$/, ' và $1')}.`;
  }
  // Từ khoá kêu gọi (bình luận / nhắn tin): bình luận giúp video được đẩy, khách dễ làm hơn gõ số điện thoại
  const ctaKey = String(edits.ctaKey || CTA_KEY[kind] || 'XEM NHÀ').trim().toUpperCase().slice(0, 18);
  const ctaMode = edits.ctaMode === 'nhantin' ? 'nhantin' : 'binhluan';
  const ctaAsk = ctaMode === 'binhluan' ? `Bình luận “${ctaKey}”` : `Nhắn tin “${ctaKey}”`;
  // Điểm sống quanh nhà: đếm tiện ích thật trong 1 km; vùng ven ít tiện ích (cả bảng < 6) thì nới 2 km rồi 3 km,
  // bỏ dòng bằng 0, không còn dòng nào thì bỏ cảnh (không hiện bảng toàn số 0)
  const SC = [['Trường học', 'truong'], ['Chợ, siêu thị', 'cho'], ['Công viên', 'congvien'], ['Y tế', 'yte'], ['Ngân hàng', 'nganhang']];
  const cnt = (c, r) => (S.pois || []).filter(p => p.cat === c && p.km <= r).length;
  const scoreR = [1, 2, 3].find(r => SC.reduce((s, [, c]) => s + cnt(c, r), 0) >= 6) || 3;
  const score = SC.map(([a, c]) => [a, cnt(c, scoreR), false]).filter(x => x[1] > 0);
  const top2 = score.slice().sort((a, b) => b[1] - a[1]).slice(0, 2);
  // Tổng kết = 3 con số lớn (thay bảng 5 dòng chữ nhỏ): 2 nhóm nhiều tiện ích nhất trong bán kính + số phút về trung tâm
  // (không có trung tâm thì phút / khoảng cách tới tiện ích mạnh nhất). Chỉ số liệu thật.
  const UNIT_OF = { 'Trường học': 'trường học', 'Chợ, siêu thị': 'chợ & siêu thị', 'Công viên': 'công viên', 'Y tế': 'cơ sở y tế', 'Ngân hàng': 'ngân hàng' };
  // nhóm chỉ có 1 tiện ích không đủ "đắt" để làm con số lớn → thay bằng khoảng cách tới tiện ích mạnh nhất
  const stats = top2.filter(x => x[1] >= 2).map(([a, n]) => ({ n, unit: UNIT_OF[a] || a.toLowerCase(), sub: `trong ${scoreR} km` }));
  const heroStat = p0 && (p0.km >= 1 && mins(p0) ? { n: mins(p0), unit: 'phút', sub: 'tới ' + p0name }
    : { n: p0.km < 1 ? Math.round(p0.km * 1000) : fmtNum(Math.round(p0.km * 10) / 10), unit: p0.km < 1 ? 'mét' : 'km', sub: 'tới ' + p0name });
  if (stats.length < 2 && heroStat) stats.push(heroStat);
  if (center) stats.push({ n: center.min, unit: 'phút', sub: 'về trung tâm' });
  else if (heroStat && !stats.includes(heroStat)) stats.push(heroStat);
  const lines = {
    intro, house: houseLine ? cap(houseLine) : '', lot: lotLine ? cap(lotLine) : '',
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
    cta: `${L.price ? `Giá <b>${L.price}</b>. ` : ''}${ctaLead ? ctaLead + ' ' : ''}${ctaMode === 'binhluan' ? `Bình luận chữ ${ctaKey.toLowerCase()}` : `Nhắn tin chữ ${ctaKey.toLowerCase()}`} để nhận thông tin và hẹn đi xem ${kwFull}.`,
    cluster: cluster ? cluster.line : '',
    orbit: orbit ? orbit.line : '',
    // cảnh ảnh căn nhà: đọc điểm nổi bật CHÍNH môi giới viết trong tin (không có thì câu mời xem chung, không bịa)
    // cảnh ảnh (cuối video): chỉ giới thiệu đây là ảnh thực tế — khớp với mọi ảnh, không tả bịa nội dung từng ảnh
    photos: (edits.photos || []).length ? `Đây là hình ảnh thực tế của ${kwFull}, mời anh chị xem qua.` : '',
    // từ nhà ra từng trục đường lớn bao nhiêu phút (đường đi thật; trục ngay trước nhà thì nói "nằm ngay") → nhìn tổng thể vị trí
    roads: roads.length ? (() => {
      const front = roads.find(r => r.km < 0.12), others = roads.filter(r => r !== front).sort((a, b) => a.min - b.min);
      const go = others.map((r, j) => `${j ? 'ra' : (front ? 'ra' : 'Từ nhà ra')} <b>${r.name}</b> ${j ? 'khoảng' : 'chỉ khoảng'} <b>${r.min} phút</b>`).join(', ');
      return `${front ? `Nằm ngay <b>${front.name}</b>${go ? ', ' : '.'}` : ''}${go ? go + '.' : ''}`;
    })() : '',
    build: build.length ? (build[0].station ? `Tuyến <b>${build[0].name}</b> đang thi công, ${build[0].station} chỉ cách <b>${km(build[0].km)}</b>.`
      : `Hạ tầng đang thi công gần nhà: <b>${build[0].name}</b>, cách <b>${km(build[0].km)}</b>.`)
      + (build[1] ? ` Thêm <b>${build[1].name}</b> cách <b>${km(build[1].km)}</b>.` : '') + (full ? ' Khi xong, khu vực kết nối càng thuận tiện.' : '') : '',
  };
  // khách sửa câu: ghi đè theo khoá cảnh (intro, house, lot, poi:<id>, anchor:<id>, score, cta…)
  const E = edits.lines || {};
  for (const k of ['intro', 'house', 'lot', 'photos', 'roads', 'build', 'score', 'airport', 'metro', 'road', 'cta', 'cluster', 'orbit']) if (E[k] != null) lines[k] = E[k];
  pois.forEach((p, i) => { if (E['poi:' + p.id] != null) lines.poi[i] = E['poi:' + p.id]; });
  anchors.forEach((a, i) => { if (E['anchor:' + a.id] != null) lines.anchor[i] = E['anchor:' + a.id]; });

  return {
    kind, buyer, persona: `${KINDS[kind].label} · ${BUYERS[buyer].label}`,
    house: H, info: { price: L.price || KINDS[kind].label, chips: infoChips(L) }, footprint, lot,
    pois, anchors, infra, score: buyer === 'vung' || !score.length ? null : score, scoreR, stats: stats.slice(0, 3), lines,
    // bản ngắn: 3 con số hiện ngay trong cảnh kết (không có cảnh tổng kết riêng, bớt ~5 giây)
    full, cluster, orbit, flow: vong ? 'vong' : 'lanluot', statsInCta: !full, ctaKey, ctaMode, cta: ctaAsk, area,
    labelStyle: ['trang', 'kinh', 'mau'].includes(edits.labelStyle) ? edits.labelStyle : 'trang', ctaSub: `để nhận thông tin chi tiết`, ctaLong: `${ctaAsk} nhận thông tin`,
    style: styleOf(kind, buyer), bird: !!edits.bird,
    watermark: edits.watermark || '',
    // bản ngắn: tối đa 5 ảnh thực tế cuối video
    photos: (edits.photos || []).slice(0, full ? 99 : 4), roads, zones: [...zones, ...airportZone(S, infra, anchors), ...landmarkZones(S, anchors, zones)], build,
    // Ảnh bìa (mẫu Giang chọn 11/11): tên căn/dự án, phường, GIÁ BÁN to, 2 dòng phụ — chữ lấy đúng từ tin đăng; màu tự đổi theo căn
    cover: {
      // tin không có giá: ô to ghi diện tích (hoặc tỉnh/thành), không lặp loại nhà / phường đã có ở ô trên
      // tên đã có phường/xã thì bỏ phần đó (phường/xã đã có ô riêng ngay dưới)
      title: (stripPlace(L.title || KINDS[kind].label, place) || L.title || KINDS[kind].label).toUpperCase(),
      ward: (place || L.province || '').toUpperCase(),
      label: L.price ? 'GIÁ BÁN' : (L.dims || L.area) ? 'DIỆN TÍCH' : 'KHU VỰC',
      big: (L.price || L.dims || (L.area && `${fmtNum(L.area)} m²`) || (L.province && L.province !== place ? L.province : '') || KINDS[kind].label).toUpperCase(),
      // 15/11: dòng lợi ích mạnh nhất ngay khung đầu (vd "300 m tới trường mầm non", "25 phút về trung tâm") — số liệu quét thật
      hook: buyer === 'vung' && center ? `${center.min} phút về trung tâm` : buyer === 'thue' && kcn ? `${mins(kcn) ? mins(kcn) + ' phút' : km(kcn.km)} tới ${zoneName(kcn.name)}`
        : p0 ? `${p0.km >= 1 && mins(p0) ? mins(p0) + ' phút' : km(p0.km)} tới ${p0name}` : center ? `${center.min} phút về trung tâm` : '',
      lines: [L.street || L.road, [L.price ? L.dims || (L.area && `${fmtNum(L.area)}m²`) : null, L.floors || L.level, L.legal].filter(Boolean).slice(0, 2).join('  ·  ')].filter(Boolean),
      color: COVER_COLORS[((edits.palette ?? Math.abs(Math.round((S.house.lat * 1e4) + (S.house.lng * 1e4)))) % COVER_COLORS.length + COVER_COLORS.length) % COVER_COLORS.length],
    },
  };
}
// Màu nhấn ảnh bìa (tự đổi theo căn, khách bấm "Đổi màu bìa" để xoay vòng)
export const COVER_COLORS = ['#FF4FA3', '#FF7A1A', '#1E90FF', '#8B5CF6', '#10B981', '#EF4444', '#14B8A6', '#F59E0B'];
const cap = s => String(s || '').replace(/^\s*\S/, c => c.toUpperCase());
// Phong cách lời: Tự chọn = theo khách (ở → P.A.S, sinh lời → Chuyên gia, cho thuê → A.I.D.A)
export const TONE_KEYS = ['pas', 'aida', 'ke-chuyen', 'chuyen-gia', 'chot-sale'];
export const AUTO_TONE = { o: 'pas', vung: 'chuyen-gia', thue: 'aida' };
// giá mỗi m² (triệu) từ "2,5 tỷ" / "850 triệu" + diện tích; không đủ dữ liệu → rỗng
function ppmOf(price, area) {
  if (!price || !area || area < 10) return '';
  const s = String(price).replace(/\s+/g, ' ');
  let m = s.match(/([\d.,]+)\s*tỷ(?:\s*(\d{1,3}))?/i), tr = null;
  if (m) tr = parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 1000 + (m[2] ? +m[2] * (m[2].length === 1 ? 100 : m[2].length === 2 ? 10 : 1) : 0);
  else if ((m = s.match(/([\d.]+)\s*(triệu|tr)\b/i))) tr = parseFloat(m[1].replace(/\./g, ''));
  if (!tr || !Number.isFinite(tr)) return '';
  const v = tr / area;
  return `${fmtNum(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10)} triệu/m²`;
}
const kwOf = kind => ({ nhapho: 'căn nhà', bietthu: 'căn biệt thự', nhavuon: 'căn nhà vườn', canho: 'căn hộ', datnen: 'lô đất' }[kind] || 'căn nhà');
// Từ khoá kêu gọi mặc định theo loại (khách sửa được)
const CTA_KEY = { nhapho: 'XEM NHÀ', bietthu: 'XEM BIỆT THỰ', nhavuon: 'XEM NHÀ VƯỜN', canho: 'XEM CĂN HỘ', datnen: 'XEM ĐẤT' };
// tên loại ngắn để đọc gộp ("trường mầm non", "chợ", "bệnh viện") — tên riêng đầy đủ đã hiện trên nhãn bản đồ
function catWord(p) {
  const n = p.name || '';
  if (p.cat === 'truong') return RX.mamnon.test(n) ? 'trường mầm non' : RX.tieuhoc.test(n) ? 'trường tiểu học' : RX.daihoc.test(n) ? 'trường đại học' : RX.quocte.test(n) ? 'trường quốc tế' : 'trường học';
  if (p.cat === 'cho') return RX.sieuthi.test(n) ? 'siêu thị' : 'chợ';
  if (p.cat === 'yte') return RX.benhvien.test(n) ? 'bệnh viện' : 'cơ sở y tế';
  if (p.cat === 'hanhchinh') return RX.ubnd.test(n) ? 'ủy ban' : 'cơ quan hành chính';
  return { congvien: 'công viên', kcn: 'khu công nghiệp', giaothong: RX.benxe.test(n) ? 'bến xe' : 'trạm xe buýt', khudothi: 'khu đô thị', nganhang: 'ngân hàng' }[p.cat] || n;
}
// tên in trên vùng: ngắn để chữ đủ to ("KCN Vĩnh Lộc 2 - Bến Lức, Long An" → "KCN Vĩnh Lộc 2")
const zoneName = n => String(n || '').replace(/^khu công nghiệp/i, 'KCN').split(/\s+[-–]\s+|,/)[0].trim();
// "Nhà phố xã Mỹ Yên" + phường/xã "Xã Mỹ Yên" → "Nhà phố" (ảnh bìa đã có ô phường/xã riêng)
const stripPlace = (s, place) => place && s.toLowerCase().endsWith(place.toLowerCase()) ? s.slice(0, s.length - place.length).replace(/[\s,–-]+$/, '') : s;

// ranh sân bay (đa giác sân bay từ OpenStreetMap, lấy cùng lúc với đường băng) → vùng hiện trong cảnh sân bay
function airportZone(S, infra, anchors) {
  if (!S.airportParts?.length) return [];
  const rings = S.airportParts.map(p => { const q = p.pts.map(([la, ln]) => [ln, la]); q.push(q[0]); return q; });
  if (infra?.airport) return [{ id: 'z:airport', cat: 'airport', name: infra.airport.name, rings }];
  // không có cảnh máy bay: khoanh ranh sân bay trong cảnh điểm mốc "Ra sân bay"
  const a = anchors.find(x => x.type === 'airport');
  return a ? [{ id: 'z:airport', cat: 'airport', name: a.name, rings, show: ['anchor:' + a.id] }] : [];
}
// Vùng mốc lớn quanh nhà (Giang 11/11: khách phải thấy KCN, cảng, sân bay): KCN gần nhà hiện ở cảnh toàn cảnh trục đường +
// tổng kết; cảng biển hiện ở cảnh điểm mốc "cảng" của nó. Ranh lấy từ bản đồ (loadZones), không có ranh thì thôi, không vẽ đoán.
function landmarkZones(S, anchors, zones) {
  const ringLL = r => { const q = r.map(([la, ln]) => [ln, la]); if (q.length && (q[0][0] !== q.at(-1)[0] || q[0][1] !== q.at(-1)[1])) q.push(q[0]); return q; };
  return (S.landZones || []).filter(z => !zones.some(x => x.poiId === z.poiId)).map(z => {
    const anc = (S.anchors || []).find(a => a.id === z.poiId);
    if (anc && !anchors.some(a => a.id === anc.id)) return null;
    return { id: 'z:lm:' + z.poiId, cat: anc ? 'port' : z.cat, name: zoneName(z.name), rings: z.pieces.flatMap(pc => pc.rings.map(ringLL)),
      show: anc ? ['anchor:' + anc.id] : ['roads', 'score'] };
  }).filter(Boolean);
}
