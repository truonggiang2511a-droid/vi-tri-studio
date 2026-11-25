// AI đạo diễn — "Agent": từ kết quả quét quanh căn + thông tin tin đăng + khách mua → kịch bản (story) cho js/dd3d.js.
// Chọn tiện ích theo khách mua, viết lời theo SỐ LIỆU THẬT (khoảng cách, phút, số tiện ích trong 1 km), chọn phong cách
// (nhạc, cách vẽ) theo loại bất động sản. Bản luật — bước sau thay phần viết lời bằng AI máy chủ (cùng dữ liệu, cùng luật cấm bịa).
import { KINDS, infoChips, fmtNum } from './dd-parse.js';
import { rectM, ROAD_COLORS, shortName } from './dd3d.js';
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

// Dân số tỉnh/thành sau sắp xếp (Nghị quyết 202/2025/QH15, Điều 1 khoản 1–23, số liệu Quốc hội thông qua 12/6/2025).
// 11 tỉnh/thành giữ nguyên (Hà Nội, Huế, Lai Châu, Điện Biên, Sơn La, Lạng Sơn, Quảng Ninh, Thanh Hóa, Nghệ An, Hà Tĩnh, Cao Bằng)
// không có số trong nghị quyết → chưa đưa (không đọc số đoán). Chỉ đọc dân số — KHÔNG hứa tăng giá / đầu tư bịa.
const PROV_POP = { 'tuyên quang': 1865270, 'lào cai': 1778785, 'thái nguyên': 1799489, 'phú thọ': 4022638, 'bắc ninh': 3619433, 'hưng yên': 3567943,
  'hải phòng': 4664124, 'ninh bình': 4412264, 'quảng trị': 1870845, 'đà nẵng': 3065628, 'quảng ngãi': 2161755, 'gia lai': 3583693,
  'khánh hòa': 2243554, 'lâm đồng': 3872999, 'đắk lắk': 3346853, 'hồ chí minh': 14002598, 'đồng nai': 4491408, 'tây ninh': 3254170,
  'cần thơ': 4199824, 'vĩnh long': 4257581, 'đồng tháp': 4370046, 'cà mau': 2606672, 'an giang': 4952238 };
const provKey = n => String(n || '').normalize('NFC').toLowerCase().replace(/^(thành phố|tỉnh|tp\.?)\s*/, '').replace('khánh hoà', 'khánh hòa').trim();
// 14.002.598 → "hơn 14 triệu", 4.491.408 → "gần 4,5 triệu"
export function popText(prov) {
  const n = PROV_POP[provKey(prov)];
  if (!n) return '';
  const m = n / 1e6, r = Math.round(m * 10) / 10;
  return `${r > m ? 'gần' : 'hơn'} ${fmtNum(r)} triệu`;
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
  // Bản ngắn (mặc định, 15/11): 35–50 s cho TikTok/Reels — ít tiện ích hơn, 1 điểm mốc vùng (gom cụm tắt từ vòng 6, xem GOM_CUM).
  // Bản đầy đủ (khách tick, cho YouTube/Zalo): như trước 15/11.
  const full = !!edits.full;
  // Kiểu hiện tiện ích (15/11): 'lanluot' (mặc định) bay tới từng tiện ích, vẽ đường đi; 'vong' máy lượn 360° góc xa, tiện ích chỉ
  // bật nhãn lên (không vẽ đường đi) — line chỉ còn ở trục đường lớn và đường đi lên trung tâm / sân bay / ga / cảng
  // 15/11 vòng 8 (Giang): mặc định RADAR — một cảnh máy xoay chậm quanh nhà, tia quét tới đâu tiện ích ở đó hiện chấm + tên (≥ 10 điểm
  // nếu khu có), thay cho các cảnh bay tới từng tiện ích phía sau (Giang thấy thừa). "Bay tới từng tiện ích" (vẽ đường đi) còn là lựa
  // chọn (edits.flow = 'lanluot'). Kiểu "Lượn 360° góc xa" cũ ('vong') gộp vào radar.
  // 15/11 vòng 9 (Giang: "app cũ vẽ tiện ích, đường lớn kiểu sao thì bê y nguyên"): MẶC ĐỊNH = mở đầu 3D (quả địa cầu → tỉnh → xã → lượn
  // 360° sát nhà) + từ cảnh bán kính trở đi vẽ BẰNG BỘ VẼ APP CŨ (js/dd-old.js, engine 'old'): bay tới từng tiện ích, từng trục đường lớn…
  // Radar vòng 8 còn là lựa chọn (edits.flow = 'radar', vẽ toàn bộ bằng dd3d).
  // 15/11 22:11 Giang: RADAR là MẶC ĐỊNH ("chế độ này ok ổn"); "Bay tới từng tiện ích — vẽ như app cũ" = edits.flow 'lanluot' (js/dd-old.js)
  const flowPick = edits.flow === 'lanluot' ? 'lanluot' : 'radar';
  const OLD = flowPick !== 'radar';
  const vong = false;
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
  if (!Object.keys(infra).length || OLD) infra = null;
  if (!OLD) for (const k of edits.infraAdd || []) if (I[k]) (infra ||= {})[k] = I[k];   // khách tự thêm (ô "Đường lớn · sân bay")
  if (infra) for (const k of edits.infraOff || []) delete infra[k];
  // 15/11 22:54 (Giang: sân bay bị vẽ 2 lần, bỏ hiệu ứng máy bay cất cánh): KHÔNG còn cảnh sân bay riêng — sân bay chỉ là 1 điểm mốc
  // trong kết nối vùng (đường đi thật + số phút) như app cũ
  if (infra) delete infra.airport;
  if (infra && !Object.keys(infra).length) infra = null;
  // cảnh sân bay: kèm đường đi thật từ nhà lên sân bay (lấy từ điểm mốc sân bay cùng tên) → khách thấy cả quãng đường, không chỉ cận cảnh
  if (infra?.airport) {
    const ap = (S.anchors || []).find(a => a.type === 'airport' && a.name === infra.airport.name);
    infra.airport = { ...infra.airport, route: ap?.coords?.length > 1 ? ap.coords.map(([la, ln]) => [ln, la]) : null };
  }
  // Kết nối vùng (đường thật + số phút ô tô): MỌI khách đều có — về trung tâm + ra sân bay (không có thì cảng biển);
  // "Kết nối khu vực" tới 3 điểm. Sân bay đã có cảnh máy bay riêng thì không lặp.
  // 16/11 (Giang: AI đạo diễn thiếu cảnh kết nối vùng): MẶC ĐỊNH 3 điểm mốc cho MỌI khách — trung tâm thành phố, sân bay gần nhất,
  // cảng biển gần nhất (mỗi điểm ≤ ANC_MAX phút ô tô; xa hơn đọc lên video thành điểm trừ nên Agent bỏ, khách tick thêm được).
  // Khách bỏ tick / thêm điểm khác (ga, trung tâm khác…) ở ô "Đường lớn · sân bay". dd3d có thêm cảnh tổng lùi ra thấy cả các đường đi.
  const ANC_MAX = 90;
  const avail = (S.anchors || []).filter(a => a.min <= ANC_MAX && !(edits.anchorsOff || []).includes(a.id) && !(a.type === 'airport' && infra?.airport));
  const ctr = avail.find(a => a.type === 'center'), ap = avail.find(a => a.type === 'airport'), port = avail.find(a => a.type === 'port');
  let anc = [ctr, ap, port].filter(Boolean);
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
  } else if (kind !== 'canho' && kind !== 'duan') {
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
  // 15/11 vòng 7 (Giang: phần tỉnh nói về quy mô / tương lai của tỉnh): kèm dân số tỉnh/thành sau sắp xếp (số liệu Nghị quyết 202, có thì đọc)
  const pop = popText(prov), popT = pop ? `, nơi có <b>${pop} dân</b>,` : ',';
  const lead = place ? (prov && !place.includes(prov) ? `Tại <b>${prov}</b>${popT} ${kwOf(kind)} này nằm ở <b>${place}</b>.` : `${cap(kwOf(kind))} này nằm ở <b>${place}</b>.`) : prov ? `${cap(kwOf(kind))} này nằm tại <b>${prov}</b>${pop ? `, nơi có <b>${pop} dân</b>` : ''}.` : '';
  // Trục đường lớn: Agent chọn 3 (luật app cũ autoPickRoads), khách thêm tới 5. Chỉ lấy đoạn trong 3,5 km quanh nhà cho nhẹ.
  const near = (pt) => Math.hypot((pt[1] - S.house.lng) * 111.32 * Math.cos(S.house.lat * Math.PI / 180), (pt[0] - S.house.lat) * 110.54);
  // luật app cũ có thể chỉ ra 1–2 trục → bổ sung trục lớn gần nhất (≤ 5 km), rồi đường nhỏ có tên sát nhà, cho đủ 3
  const roadIds = edits.roads || (() => {
    // chỉ trục trong vùng cắt 3,5 km (cao tốc xa 8 km bị cắt hết đoạn → mất một trục)
    // 15/11 vòng 7 (Giang): ÍT NHẤT 3 trục đường lớn GẦN NHÀ NHẤT (cả bản ngắn), ưu tiên trục gần trước; khách thêm tới 5
    const nR = 3;
    const all = (S.roadsAll || []).filter(r => r.nearKm <= 3.4), byNear = [...all].sort((a, b) => a.nearKm - b.nearKm), ids = [];
    for (const r of byNear) if (ids.length < nR && r.level >= 1) ids.push(r.id);
    for (const id of autoPickRoads(all, nR)) if (ids.length < nR && !ids.includes(id)) ids.push(id);
    for (const r of byNear) if (ids.length < nR && r.nearKm <= 1.2 && !ids.includes(r.id)) ids.push(r.id);
    return ids;
  })();
  const roads0 = roadIds.map(id => (S.roadsAll || []).find(r => r.id === id)).filter(Boolean).slice(0, 5).map(r => {
    // điểm trên trục gần nhà nhất + đường đi thật từ nhà ra đó (dao-dien.js roadRoutesFor → S.roadRoutes); chưa có thì ước lượng
    let best = null;
    for (const w of r.ways) for (const pt of w) { const d = near(pt); if (!best || d < best.d) best = { d, pt }; }
    const rr = S.roadRoutes?.[r.id], dkm = rr ? rr.km : (best ? best.d * 1.3 : r.nearKm);
    return {
      id: r.id, name: r.label || r.name, km: r.nearKm,
      near: best ? [best.pt[1], best.pt[0]] : null, dkm, min: Math.max(1, Math.round(rr && rr.min > 0 ? Math.min(rr.min, dkm / 25 * 60) : dkm / 28 * 60)),
      route: rr?.coords?.length > 1 ? rr.coords.map(([la, ln]) => [ln, la]) : null,
      // trục xa khách tự thêm (cao tốc / quốc lộ cách 5–15 km): lấy đoạn tới cách nhà khoảng cách trục + 1,5 km
      ways: r.ways.map(w => w.filter(pt => near(pt) <= Math.max(3.5, (r.nearKm || 0) + 1.5)).map(([la, ln]) => [ln, la])).filter(w => w.length > 1),
    };
  }).filter(r => r.ways.length);
  // thứ tự hiện = thứ tự lời đọc: trục ngay trước nhà (< 120 m) trước, rồi trục gần nhất (ít phút nhất) → màu gán sau khi xếp
  const roadFront = roads0.find(r => r.km < 0.12);
  const roads = [...(roadFront ? [roadFront] : []), ...roads0.filter(r => r !== roadFront).sort((a, b) => a.min - b.min || a.km - b.km)]
    .map((r, j) => ({ ...r, color: ROAD_COLORS[j % ROAD_COLORS.length] }));
  // tên đường trước nhà (không phải trục lớn) cũng in dẹt trên mặt đường lúc máy lượn 360° quanh căn
  const frontStreet = f?.name && f.pts?.length > 1 && !roads.some(r => r.name.toLowerCase().includes(String(f.name).toLowerCase()))
    ? { name: String(f.name), pts: f.pts.map(([la, ln]) => [ln, la]) } : null;
  // Vùng quan trọng: ranh khu công nghiệp / bệnh viện / đại học / công viên của tiện ích đã chọn + ranh sân bay khi có cảnh sân bay
  const ringLL = r => { const q = r.map(([la, ln]) => [ln, la]); if (q.length && (q[0][0] !== q.at(-1)[0] || q[0][1] !== q.at(-1)[1])) q.push(q[0]); return q; };
  const zones = (S.zones || []).filter(z => pois.some(p => p.id === z.poiId) || (flowPick === 'radar' && (S.pois || []).some(p => p.id === z.poiId && p.km <= 5))).map(z => ({ id: 'z:' + z.poiId, poiId: z.poiId, cat: z.cat, name: zoneName(z.name), rings: z.pieces.flatMap(pc => pc.rings.map(ringLL)) }));
  // (sân bay: ranh đường biên sân bay — chỉ khi có cảnh sân bay)
  // Hạ tầng đang thi công (OpenStreetMap, như app cũ): tối đa 2 tuyến trong 5 km
  // hạ tầng đang thi công (đường / cao tốc OSM + metro đang xây — METRO_BUILD) trong 5 km: luôn vào video (15/11, Giang: bị thiếu)
  const build = (S.build || []).filter(b => b.nearKm <= 5 && !(edits.buildOff || []).includes(b.id)).slice(0, 2).map(b => ({
    id: b.id, name: b.label, km: b.nearKm, station: b.metro?.station || '', ways: b.ways.map(w => w.map(([la, ln]) => [ln, la])).filter(w => w.length > 1) })).filter(b => b.ways.length);
  const kwFull = { duan: 'dự án', nhapho: 'căn nhà', bietthu: 'căn biệt thự', nhavuon: 'căn nhà vườn', canho: 'căn hộ', datnen: 'lô đất' }[kind];
  const kw = { duan: 'dự án', nhapho: 'nhà', bietthu: 'biệt thự', nhavuon: 'nhà vườn', canho: 'căn hộ', datnen: 'lô đất' }[kind];
  const p0 = pois[0], center = anchors.find(a => a.type === 'center') || (S.anchors || []).find(a => a.type === 'center');
  const kcn = pois.find(p => p.cat === 'kcn');
  // ---- Lời Agent (chưa bấm AI viết) theo LOẠI KHÁCH × PHONG CÁCH (15/11, Giang: đánh trúng nỗi lo khách để tăng chuyển đổi) ----
  // Mua để ở: sợ con đi học xa, chật chội, giấy tờ không rõ · Đầu tư cho thuê: sợ phòng trống, xa chỗ làm của người thuê ·
  // Đầu tư sinh lời: sợ mua chỗ hạ tầng đứng yên. Lời giải = số liệu THẬT (tin đăng + quét); không hứa lời lãi / tăng giá,
  // không tả bịa nội thất / an ninh / view. Phong cách: khách chọn ở "Kiểu lời", để Tự chọn thì theo khách (ở PAS, thuê AIDA, sinh lời Chuyên gia).
  const tone = TONE_KEYS.includes(edits.tone) ? edits.tone : AUTO_TONE[buyer] || 'pas';
  const p0name = p0 && catWord(p0);
  const p0d = p0 && (p0.km >= 1 && mins(p0) ? `<b>${mins(p0)} phút</b>` : `<b>${km(p0.km)}</b>`);   // ≥ 1 km: phút trước (người mua nghĩ bằng phút)
  // 16/11 (Giang): "cho giá xuống cuối CTA để khách tò mò xem hết video" — mặc định KHÔNG nói giá / đơn giá ở mở đầu và đoạn căn nhà
  // (công tắc "Giá để cuối video" trong Sửa video, edits.priceEnd = false để nói giá sớm như trước); giá chỉ có ở cảnh kêu gọi cuối
  const priceEnd = edits.priceEnd !== false;
  // 25/11 (Giang): chữ loại sản phẩm tự điền (vd "NHÀ PHỐ") và phụ đề là TUỲ CHỌN của khách (hỏi trước khi Agent dựng)
  const showKind = edits.showKind !== false, captions = edits.captions !== false;
  const kindTxt = showKind ? KINDS[kind].label : '';
  // SĐT cuối video: mặc định KHÔNG hiện (nền tảng hay giảm lượt hiển thị video có số); khách bật thì lấy số trong tin đăng, sửa được
  const phoneDigits = String(edits.phone ?? L.phones?.[0] ?? '').replace(/\D/g, '');
  const phone = edits.showPhone === true && phoneDigits.length >= 8 && phoneDigits.length <= 11
    ? phoneDigits.length === 10 ? `${phoneDigits.slice(0, 4)} ${phoneDigits.slice(4, 7)} ${phoneDigits.slice(7)}` : phoneDigits : '';
  const P = L.price && !priceEnd ? `<b>${L.price}</b>` : '', ppm = priceEnd ? '' : ppmOf(L.price, L.area), PPM = ppm ? `<b>${ppm}</b>` : '';
  const legal = L.legal ? L.legal.toLowerCase() : '', legalOk = /sổ\s*(hồng|đỏ)/i.test(L.legal || '');
  const kcnD = kcn && (mins(kcn) ? `<b>${mins(kcn)} phút</b>` : `<b>${km(kcn.km)}</b>`);
  const b0 = build[0];
  const infraHook = b0 ? `${b0.station ? `${b0.station} tuyến <b>${b0.name}</b>` : `<b>${b0.name}</b>`} đang thi công, cách <b>${km(b0.km)}</b>`
    : infra?.metro ? `ga metro ${infra.metro.nearName} chỉ cách <b>${km(infra.metro.nearKm)}</b>` : infra?.road ? `<b>${infra.road.name}</b> chỉ cách <b>${km(infra.road.km)}</b>` : '';
  const ctrHook = center ? `về trung tâm chỉ <b>${center.min} phút</b>` : '';
  const near1 = p0 ? `${p0name} chỉ ${p0d}` : '';
  // tin chỉ ghi bề rộng ("đường 8m", "hẻm 6m") thì KHÔNG phải tên đường → không nói "nằm ngay Đường 8m"; bề rộng đọc riêng ở đoạn căn nhà
  const genericSt = /^(đường|hẻm|ngõ|kiệt)\s*(xe\s*hơi\s*)?\d+([.,]\d+)?\s*m\b/i.test(L.street || '');
  const street = (!genericSt && L.street) || (f?.name ? `đường ${f.name}` : '');
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
        J(at && `Mở cửa là ${street.replace(/^Mặt tiền/, 'mặt tiền')}.`, specs && `${lotKind ? 'Lô đất' : 'Trong nhà'}: ${specs}.`, legalOk ? `${cap(legal)}, an tâm ở lâu dài.` : legal && `${cap(legal)}.`), 'Muốn biết thêm?'],
      thue: [kcn ? `Mỗi sáng, người thuê ở đây chạy xe ${kcnD} là tới <b>${kcn.name}</b>.` : p0 ? `Mỗi sáng, người thuê ở đây ra ${p0name} chỉ ${p0d}.` : 'Cùng xem một ngày của người thuê ở đây.',
        J(specs && `${K} có ${specs}.`, L.beds >= 2 && 'Đủ phòng cho cả nhóm người đi làm ở chung.', legal && `${cap(legal)}.`), 'Muốn biết thêm?'],
      vung: [b0 ? `Hình dung ngày <b>${b0.name}</b> hoàn thành, ${kwFull} này chỉ cách <b>${km(b0.km)}</b>.` : ctrHook ? `Hình dung mỗi ngày từ đây ${ctrHook}.` : `Hình dung giá trị của một vị trí đúng chỗ.`,
        J(at && `${K} ${at}.`, specs && `${cap(specs)}.`, PPM && `Đơn giá khoảng ${PPM}.`, legal && `${cap(legal)}.`), 'Muốn biết thêm?'],
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
  const tp = TPL[tone][buyer] || TPL[tone].o;
  const intro = J(lead, cap(tp[0]));
  // ---- Lời đoạn máy lượn TRỌN 360° cận cảnh căn nhà (15/11 22:21, Giang: lời quá ít, máy chưa lượn hết vòng đã hết lời) ----
  // Kể lần lượt như đang dẫn khách đi một vòng: mở → nằm ở đường nào → kích thước, diện tích → kết cấu, phòng → pháp lý → điểm cộng
  // trong tin đăng → (nhà đầu tư) đơn giá → câu chuyển sang xung quanh. ~45–60 chữ ≈ 15–19 s = đủ 1 vòng.
  // CHỈ thông tin thật (tin đăng + tên đường trước nhà quét được): tin đăng ít thông tin thì lời ngắn hơn, KHÔNG bịa thêm.
  const houseText = (() => {
    const rw0 = L.road || (genericSt ? L.street : ''), roadW = rw0 && !(street || '').toLowerCase().includes(rw0.toLowerCase()) ? rw0.toLowerCase() : '';
    const sz = [L.dims && `kích thước <b>${L.dims}</b>`, L.area && `diện tích <b>${fmtNum(L.area)} m²</b>`, lotKind && L.w && `mặt tiền <b>${fmtNum(L.w)} m</b>`,
      lotKind && L.thoCu && L.thoCu.toLowerCase(), lotKind && L.facing && L.facing.toLowerCase()].filter(Boolean);
    const st = lotKind ? [] : [L.floors && `kết cấu ${L.floors}`, L.level && `căn ở ${L.level.toLowerCase()}`, L.beds && `<b>${L.beds} phòng ngủ</b>`,
      L.baths && `${L.baths} nhà vệ sinh`, L.facing && L.facing.toLowerCase(), !lotKind && L.thoCu && L.thoCu.toLowerCase()];
    const stx = st.filter(Boolean);
    const fit = !lotKind && L.beds >= 2 ? (buyer === 'thue' ? ', cho thuê nguyên căn hoặc từng phòng đều được' : buyer === 'o' ? ', đủ chỗ cho cả gia đình' : '') : '';
    // điểm cộng chính môi giới viết trong tin (bỏ dòng trùng thông số đã đọc), tối đa 2
    const hl = (L.highlights || []).map(h => String(h).replace(/\p{Extended_Pictographic}/gu, '').replace(/[.!;:,\s]+$/u, '').trim())
      .filter(h => h.length >= 8 && !/(trệt|lầu|tầng|phòng\s*ngủ|\bpn\b|\bwc\b|toilet|hướng|\d+\s*x\s*\d+)/i.test(h)).slice(0, 2);
    const open = { pas: `Cùng nhìn cận cảnh một vòng quanh ${kwFull} này.`, aida: `Nhìn cận cảnh một vòng quanh ${kwFull}.`,
      'ke-chuyen': `Giờ cùng dạo một vòng quanh ${kwFull}.`, 'chuyen-gia': `Cận cảnh ${kwFull} và các thông số chính.`, 'chot-sale': `Cận cảnh ${kwFull} ngay bây giờ.` }[tone] || '';
    // tin chỉ ghi "hẻm xe hơi" (không tên) mà quét được đường có tên sát nhà (< 120 m) → "nằm trong hẻm xe hơi, sát đường X"
    const sideName = f?.name || roadFront?.name;   // đường có tên sát nhà (< 120 m): đường quanh nhà quét được, không có thì trục lớn ngay trước nhà
    const alley = /^hẻm/i.test(L.street || '') && sideName && !/\d|đường|\bđ\./i.test(L.street) ? `${K} nằm trong ${L.street.toLowerCase()}, sát đường <b>${sideName}</b>.` : '';
    // tin chỉ ghi bề rộng ("đường 8m") + đường có tên quét được sát nhà: 2 câu riêng (không khẳng định đường 8m chính là đường đó)
    const sideW = genericSt && f?.name && roadW ? `${K} nằm sát đường <b>${f.name}</b>. ${cap(roadW)} ngay trước ${kw}.` : '';
    const where = alley || sideW || (at ? (tone === 'ke-chuyen' ? `Mở cửa là ${street.replace(/^Mặt tiền/, 'mặt tiền')}${roadW ? `, ${roadW}` : ''}.` : `${K} nằm ${at}${roadW ? `, ${roadW}` : ''}.`)
      : roadW ? `${cap(roadW)} ngay trước ${kw}.` : '');
    const size = sz.length ? (tone === 'chuyen-gia' ? `Thông số: ${sz.join(', ')}.` : `${K} có ${sz.join(', ')}.`) : '';
    const struct = stx.length ? `${cap(stx.join(', '))}${fit}.` : '';
    const leg = legalOk ? `${cap(legal)}, giấy tờ rõ ràng, an tâm sang tên.` : legal ? `Pháp lý: ${legal}.` : '';
    const plus = hl.length ? `${tone === 'ke-chuyen' ? 'Thêm nữa' : 'Điểm cộng'}: ${hl.join('; ')}.` : '';
    const ppmS = PPM && (buyer === 'vung' || tone === 'chuyen-gia') ? `Tính ra đơn giá khoảng ${PPM}.` : '';
    const next = tone === 'chot-sale' ? 'Thông tin rõ ràng, hẹn xem ngay trong tuần.' : `Giờ cùng xem xung quanh ${kw} có gì.`;
    let parts = [open, where, size, struct, leg, plus, ppmS, next];
    const words = xs => xs.filter(Boolean).join(' ').replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
    // quá dài (> 72 chữ ≈ 19 s giọng thật ~3,7 chữ/giây) thì bớt dần: đơn giá → điểm cộng thứ 2 → câu chuyển → câu mở ngắn lại → đuôi câu pháp lý → đuôi câu phòng
    const MAXW = 72;
    if (words(parts) > MAXW) parts[6] = '';
    if (words(parts) > MAXW && hl.length > 1) parts[5] = `${tone === 'ke-chuyen' ? 'Thêm nữa' : 'Điểm cộng'}: ${hl[0]}.`;
    if (words(parts) > MAXW) parts[7] = '';
    if (words(parts) > MAXW) parts[0] = `Cận cảnh một vòng quanh ${kwFull}.`;
    if (words(parts) > MAXW && legalOk) parts[4] = `${cap(legal)}, giấy tờ rõ ràng.`;
    if (words(parts) > MAXW && fit) parts[3] = `${cap(stx.join(', '))}.`;
    // không có thông tin gì về căn ngoài câu mở + câu chuyển → để trống (máy vẫn lượn, nghe nhạc)
    return parts.slice(1, 7).some(Boolean) ? J(...parts) : '';
  })();
  const ctaLead = tone === 'chuyen-gia' ? 'Cần bảng thông số đầy đủ?' : tone === 'chot-sale' ? 'Xem sớm để không lỡ.' : tp[2] || '';
  const houseLine = houseText || '';
  const lotLine = houseLine;
  // Gom cụm (bản ngắn, ≥ 3 tiện ích): tiện ích đầu (mạnh nhất theo khách) có cảnh riêng, còn lại MỘT cảnh — ghim bật lần lượt.
  // 15/11 vòng 6 (Giang: chỗ tiện ích vẽ nhanh quá, muốn nhịp + cách hiện thẻ như app cũ): TẮT gom cụm — mỗi tiện ích một cảnh
  // riêng, có câu đọc riêng (như kiểu cũ). Lý do: cảnh gom cụm đọc 3 tiện ích trong 1 câu ~4 s nên hình phải nhảy 2,6 s/điểm và
  // chữ lệch lời. Bật lại: GOM_CUM = true (dd3d vẫn dựng được cảnh cluster).
  const GOM_CUM = false;
  const cluster = GOM_CUM && !vong && !full && pois.length >= 3 ? { idx: pois.map((_, i) => i).slice(1) } : null;
  // Lượn 360° góc xa: MỘT cảnh cho mọi tiện ích, nhãn bật lần lượt đúng lúc lời đọc nhắc tới (dd3d tìm chữ trong câu)
  // vòng 6: lời đọc kể TỪNG tiện ích (tên gọn như trên nhãn) kèm số phút / mét, mỗi tiện ích một câu ngắn → nhãn bật đúng lúc giọng
  // nhắc tới, nhịp ~2 s/điểm (trước: chỉ kể tên loại trong ~3 s → nhãn bật dồn dập hoặc trễ hẳn so với lời)
  const orbit = vong && pois.length ? { idx: pois.map((_, i) => i), words: pois.map(p => shortName(p.name)), r: Math.max(...pois.map(p => p.km)) } : null;
  if (orbit) orbit.line = `Nhìn quanh một vòng. ${pois.map(p => `${shortName(p.name)}, <b>${p.km >= 1 && mins(p) ? `${mins(p)} phút` : km(p.km)}</b>.`).join(' ')}`;
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
  // Radar (15/11 vòng 7, Giang: thêm radar quét cho thu hút): cảnh quét bán kính scoreR trước phần tiện ích — tia quét đi qua tới đâu,
  // tiện ích thật (đã quét) ở đó sáng lên; đếm đúng số điểm trên hình
  // bán kính: nhỏ nhất trong 1 / 1,5 / 2 / 3 km có ≥ 10 tiện ích (khu ít tiện ích thì quét ít điểm — cảnh ngắn lại), nới thêm cho 2 tiện ích
  // mạnh nhất lọt vòng (tối đa 5 km); tối đa RADAR_MAX điểm, xen kẽ theo nhóm (không 10 điểm cùng là trường), tên trùng chỉ lấy 1
  const RADAR_CAT = ['truong', 'cho', 'yte', 'congvien', 'nganhang', 'hanhchinh', 'khudothi', 'kcn'], RADAR_MAX = 12;
  const elig = (S.pois || []).filter(p => RADAR_CAT.includes(p.cat));
  let rR = [1, 1.5, 2, 3].find(r => elig.filter(p => p.km <= r).length >= 10) || 3;
  rR = Math.max(rR, Math.min(5, Math.ceil(Math.max(0, ...pois.slice(0, 2).map(p => p.km)) * 2) / 2));
  const nameKey = p => shortName(p.name).toLowerCase().normalize('NFC');
  const named = pois.filter(p => p.km <= rR).slice(0, 5), seen = new Set(named.map(nameKey)), picked = [];
  const byCat = Object.fromEntries(RADAR_CAT.map(c => [c, elig.filter(p => p.cat === c && p.km <= rR && !named.some(q => q.id === p.id)).sort((a, b) => a.km - b.km)]));
  for (let more = true; more && named.length + picked.length < RADAR_MAX;) {
    more = false;
    for (const c of RADAR_CAT) {
      while (byCat[c].length && seen.has(nameKey(byCat[c][0]))) byCat[c].shift();
      const p = byCat[c].shift();
      if (!p) continue;
      more = true; seen.add(nameKey(p)); picked.push(p);
      if (named.length + picked.length >= RADAR_MAX) break;
    }
  }
  const angOf = p => (Math.atan2((p.lng - S.house.lng) * Math.cos(S.house.lat * Math.PI / 180), p.lat - S.house.lat) * 180 / Math.PI + 360) % 360;
  const rdist = p => p.km >= 1 && mins(p) ? `${mins(p)} phút` : km(p.km);
  // tên trên nhãn radar (vòng 8b, Giang: nhãn dài quá): biểu tượng đã cho biết loại → tên gọn ≤ 18 ký tự. Ưu tiên chữ đầy đủ dễ đọc
  // (khán giả lớn tuổi): "Mầm non Hoa Hồng"; còn dài thì viết tắt kiểu bản đồ (TH, THCS, ĐH, BV, NH…); vẫn dài thì bỏ bớt từ cuối
  const TAG_MAX = 18;
  const tag = n => {
    const base = shortName(n).replace(/\s+(chi\s+nhánh|CN|phòng\s+giao\s+dịch|PGD)(\s.*)?$/i, '').replace(/\s+/g, ' ').trim();
    const soft = base.replace(/^Trường\s+(Mầm\s*non|Mẫu\s*giáo|Tiểu\s*học)\s+/i, (_, x) => cap(x.toLowerCase()) + ' ')
      .replace(/^(Ủy|Uỷ)\s*ban\s+nhân\s+dân/i, 'UBND').replace(/Y\s*học\s*cổ\s*truyền/i, 'YHCT').replace(/^Khu\s+dân\s+cư\s+/i, 'KDC ')
      .replace(/^Khu\s+công\s+nghiệp\s+/i, 'KCN ').replace(/^Trường\s+(Trung\s+học\s+cơ\s+sở)\s+/i, 'THCS ').replace(/^Trường\s+(Trung\s+học\s+phổ\s+thông)\s+/i, 'THPT ')
      .replace(/^Trường\s+(THCS|THPT)\s+/i, '$1 ').replace(/\s+/g, ' ').trim();
    if (soft.length <= TAG_MAX) return soft;
    const hard = soft.replace(/^Mầm non\s+/i, 'MN ').replace(/^Tiểu học\s+/i, 'TH ').replace(/^Trường\s+Đại\s+học\s+/i, 'ĐH ').replace(/^Trường\s+Cao\s+đẳng\s+/i, 'CĐ ')
      .replace(/^Bệnh\s+viện\s+/i, 'BV ').replace(/^Ngân\s+hàng\s+/i, 'NH ').replace(/^Phòng\s+khám\s+/i, 'PK ').replace(/^Phòng\s+chẩn\s+trị\s+/i, 'PK ')
      .replace(/^Bưu\s+điện\s+văn\s+hóa\s+xã/i, 'Bưu điện VHX').replace(/^Siêu\s+thị\s+/i, 'ST ').replace(/^Trung\s+tâm\s+/i, 'TT ');
    if (hard.length <= TAG_MAX) return hard;
    const ws = hard.split(' '); let c = 1;
    while (c < ws.length && ws.slice(0, c + 1).join(' ').length <= TAG_MAX) c++;
    // không để sót 1 chữ của tên riêng bị cắt ("Bưu điện VHX Tân" → "Bưu điện VHX", "VietinBank Bình" → "VietinBank")
    const upper = w => /^\p{Lu}/u.test(w);
    if (c < ws.length && c >= 2 && upper(ws[c]) && upper(ws[c - 1]) && !/^[\p{Lu}\d]{2,}$/u.test(ws[c - 1])) c--;   // bỏ 1 từ mồ côi của tên dở dang
    return ws.slice(0, c).join(' ');
  };
  // chữ in hoa cả từ trong dữ liệu ("Chợ CÁ BIỂN") → viết hoa chữ đầu, trừ chữ viết tắt (UBND, THCS, KDC…)
  const ABBR = /^(UBND|THCS|THPT|KDC|KCN|VHX|YHCT|MN|TH|NH|BV|PK|ĐH|CĐ|CB|TT|ST|TP|HCM|ATM|BIDV|ACB|VPBANK|TPBANK|MB|SHB|OCB|VIB|HDBANK|SCB|MSB|ABBANK|SEABANK|LPBANK)$/i;
  // (cả chữ hoa lẫn lộn kiểu "BiỂN": quá nửa số chữ sau chữ đầu là chữ hoa thì coi là chữ in hoa)
  const tidy = s => String(s || '').normalize('NFC').split(' ').map(w => {
    if (w.length < 2 || ABBR.test(w) || (w.length === 2 && !/[^\x00-\x7F]/.test(w))) return w;
    const rest = [...w.slice(1)], up = rest.filter(c => c !== c.toLowerCase()).length;
    return up && up >= Math.ceil(rest.length / 2) ? w[0] + w.slice(1).toLowerCase() : w;
  }).join(' ');
  const rPts = [...named.map(p => ({ ...p, named: true })), ...picked.map(p => ({ id: p.id, name: p.name, cat: p.cat, km: p.km, min: null, at: [p.lng, p.lat] }))]
    .map(p => ({ ...p, ang: angOf({ lat: p.at[1], lng: p.at[0] }) })).sort((a, b) => a.ang - b.ang);
  const radar = flowPick === 'radar' && rPts.length >= 3 ? {
    r: rR, n: rPts.length,
    pts: rPts.map(p => ({ id: p.id, at: p.at, cat: p.cat, ang: p.ang, named: !!p.named, label: `${tag(tidy(p.name))} · ${rdist(p)}` })),
    words: rPts.map(p => p.named ? shortName(p.name) : null),
  } : null;
  // lời radar: 1 câu tổng + kể các tiện ích mạnh nhất theo ĐÚNG thứ tự tia quét đi qua (nhãn bật đúng lúc giọng nói tên)
  // 15/11 22:21 (Giang: lời ít, chưa hay): sau tên + khoảng cách thêm 1 vế ích lợi NGẮN theo loại (lần đầu mỗi loại, không lặp) — tên vẫn
  // đứng đầu câu nên nhãn radar vẫn bật đúng lúc giọng nói tên (dd3d tìm tên trong câu)
  const whyUsed = new Set();
  const poiWhy = p => {
    const c = p.cat === 'truong' && RX.daihoc.test(p.name) ? 'daihoc' : p.cat;
    if (whyUsed.has(c)) return '';
    const near = p.km <= 1.5;
    const w = { truong: buyer === 'o' && near ? 'đưa đón con nhẹ nhàng' : '', daihoc: '', cho: near ? 'đi chợ mỗi ngày tiện' : 'mua sắm thuận tiện',
      yte: near ? 'khám bệnh ngay gần nhà' : 'khám chữa bệnh thuận tiện', congvien: 'cuối tuần đi dạo',
      nganhang: 'giao dịch thuận tiện', hanhchinh: 'làm giấy tờ gần', kcn: 'đi làm gần' }[c] || '';
    if (w) whyUsed.add(c);
    return w ? `, ${w}` : '';
  };
  // 16/11: radar là phần trả lời câu hỏi "Sống ở đây có tiện không?" (câu hỏi đã hỏi ở đầu phần trục đường; không có trục đường thì hỏi ở đây)
  const radarLine = radar ? `${roads.length ? '' : 'Sống ở đây có tiện không? '}Trong bán kính <b>${fmtNum(rR)} km</b> quanh ${kw} có <b>${radar.n} tiện ích</b> tiêu biểu.`
    + rPts.filter(p => p.named).map(p => ` ${cap(shortName(p.name))}, <b>${rdist(p)}</b>${poiWhy(p)}.`).join('') : '';
  // Tổng kết (vòng 7: cảnh riêng trước lời kêu gọi, mọi bản): đọc đúng 3 con số lớn đang hiện trên hình
  const st3 = stats.slice(0, 3), inR = st3.filter(x => x.sub === `trong ${scoreR} km`), unitV = x => x.unit.replace(' & ', ' và ');
  const sumLine = st3.length >= 2 ? `Tóm lại: ${[inR.length ? `trong ${scoreR} km có ${inR.map(x => `<b>${x.n} ${unitV(x)}</b>`).join(', ')}` : '',
    ...st3.filter(x => !inR.includes(x)).map(x => `<b>${x.n} ${unitV(x)}</b> ${x.sub}`)].filter(Boolean).join('; ')}.`
    + (buyer === 'thue' ? ' Người thuê ở đây sống tiện, đi đâu cũng gần.' : buyer === 'vung' ? ' Một vị trí kết nối đủ đầy.' : ' Mọi nhu cầu hằng ngày đều trong tầm tay.') : '';
  // app cũ (vòng 9): bán kính vòng tròn = nhỏ nhất trong 1 / 2 / 3 / 5 km ôm hết tiện ích đã chọn
  const oldR = [1, 2, 3, 5].find(r => pois.every(p => p.km <= r * 1.05)) || 5;
  // ---- 16/11 (Giang): kịch bản trả lời 2 câu khách hay hỏi — "Sống ở đây có tiện không?" (trục đường + tiện ích) và "Vì sao nên mua?"
  // (tổng kết = 3 lý do). Lý do CHỈ từ số liệu thật (tin đăng + quét + đường đi), xếp theo loại khách; lý do mạnh nhất đọc CUỐI, pháp lý
  // rõ ràng (nếu có) đứng đầu để tạo niềm tin. KHÔNG hứa tăng giá / lời lãi / rẻ hơn khu vực (app không có dữ liệu giá khu vực) —
  // tiềm năng nói bằng sự việc kiểm chứng được (hạ tầng đang thi công cách bao xa, bao nhiêu phút về trung tâm).
  const nearestOf = (test, maxKm) => {
    const a = pois.filter(test).sort((x, y) => x.km - y.km)[0], b = (S.pois || []).filter(test).sort((x, y) => x.km - y.km)[0];
    const p = a && (!b || a.km <= b.km * 1.3) ? a : b ? { name: b.name, cat: b.cat, km: b.km, min: null } : null;   // tiện ích đã chọn có phút theo đường đi thật
    return p && p.km <= maxKm ? p : null;
  };
  const dist = p => p.km >= 1 && mins(p) ? { n: mins(p), unit: 'phút' } : p.km < 1 ? { n: Math.max(10, Math.round(p.km * 100) * 10), unit: 'mét' }
    : { n: fmtNum(Math.round(p.km * 10) / 10), unit: 'km' };
  const dSay = d => `<b>${d.n} ${d.unit}</b>`;
  const school = nearestOf(p => p.cat === 'truong' && !RX.daihoc.test(p.name), 1.5), uni = nearestOf(p => p.cat === 'truong' && RX.daihoc.test(p.name), 3);
  const market = nearestOf(p => p.cat === 'cho', 1.5), hosp = nearestOf(p => p.cat === 'yte' && RX.benhvien.test(p.name), 3), kcnN = nearestOf(p => p.cat === 'kcn', 6);
  const bigRoad = roads.filter(r => ((S.roadsAll || []).find(x => x.id === r.id)?.level || 0) >= 2).sort((a, b) => a.min - b.min)[0];
  const apA = anchors.find(a => a.type === 'airport'), portA = anchors.find(a => a.type === 'port');
  const nCnt = radar ? radar.n : elig.filter(p => p.km <= oldR).length, rCnt = radar ? rR : oldR;
  const legalTile = String(L.legal || '').replace(/\s+/g, ' ').trim();
  const RS = {};
  if (school) { const d = dist(school), w = catWord(school); RS.truong = { ...d, sub: 'tới ' + w, say: `${w} chỉ cách ${dSay(d)}${buyer === 'o' ? ', con đi học gần, ba mẹ đỡ vất vả' : ''}` }; }
  if (market) { const d = dist(market), w = catWord(market); RS.cho = { ...d, sub: 'tới ' + w, say: `${w} cách ${dSay(d)}, đi chợ mỗi ngày tiện` }; }
  if (hosp) { const d = dist(hosp); RS.yte = { ...d, sub: 'tới bệnh viện', say: `bệnh viện cách ${dSay(d)}, có việc gấp yên tâm` }; }
  if (center && center.min <= 60) RS.center = { n: center.min, unit: 'phút', sub: 'về trung tâm', say: `về <b>${center.name}</b> chỉ <b>${center.min} phút</b>` };
  if (nCnt >= 6) RS.count = { n: nCnt, unit: 'tiện ích', sub: `trong ${fmtNum(rCnt)} km`, say: `<b>${nCnt} tiện ích</b> thiết yếu trong bán kính <b>${fmtNum(rCnt)} km</b>` };
  if (bigRoad) RS.road = bigRoad.km < 0.12 ? { n: '✓', unit: shortName(bigRoad.name), sub: 'nằm ngay trục đường', say: `nằm ngay <b>${bigRoad.name}</b>, ra vào thuận tiện` }
    : { n: bigRoad.min, unit: 'phút', sub: 'ra ' + shortName(bigRoad.name), say: `ra <b>${bigRoad.name}</b> chỉ khoảng <b>${bigRoad.min} phút</b>` };
  if (kcnN) { const d = dist(kcnN), z = zoneName(kcnN.name); RS.kcn = { ...d, sub: 'tới ' + z, say: buyer === 'thue' ? `cách <b>${z}</b> chỉ ${dSay(d)}, người đi làm luôn cần chỗ ở gần` : buyer === 'vung' ? `gần <b>${z}</b>, chỉ ${dSay(d)}` : `đi làm ở <b>${z}</b> chỉ ${dSay(d)}` }; }
  if (uni && buyer === 'thue') { const d = dist(uni); RS.uni = { ...d, sub: 'tới trường ĐH', say: `<b>${shortName(uni.name)}</b> cách ${dSay(d)}, sinh viên luôn cần thuê chỗ ở` }; }
  if (b0) { const d = dist({ km: b0.km, min: null }); RS.build = { ...d, sub: 'tới tuyến đang thi công', say: b0.station ? `${b0.station} tuyến <b>${b0.name}</b> đang thi công, chỉ cách ${dSay(d)}` : `<b>${b0.name}</b> đang thi công, chỉ cách ${dSay(d)}` }; }
  if (apA && apA.min <= 45) RS.airport = { n: apA.min, unit: 'phút', sub: 'ra sân bay', say: `ra <b>${apA.name}</b> chỉ <b>${apA.min} phút</b>` };
  if (portA && portA.min <= 45) RS.port = { n: portA.min, unit: 'phút', sub: 'ra cảng biển', say: `ra <b>${portA.name}</b> chỉ <b>${portA.min} phút</b>` };
  // thứ tự mạnh → yếu theo khách (phần tử đầu = lý do lớn nhất)
  const PRI = { o: ['truong', 'cho', 'center', 'count', 'yte', 'road', 'kcn'], thue: ['kcn', 'uni', 'center', 'cho', 'road', 'count'],
    vung: ['build', 'center', 'road', 'airport', 'port', 'kcn', 'count'] }[buyer] || [];
  const locR = PRI.filter(k2 => RS[k2]).map(k2 => RS[k2]);
  const legalR = (legalOk || /sổ\s*riêng/i.test(legalTile)) && legalTile.length <= 22 ? { n: '✓', unit: cap(legalTile), sub: 'pháp lý rõ ràng', say: `<b>${legal}</b>, giấy tờ rõ ràng, an tâm xuống tiền` } : null;
  // đọc theo thứ tự: pháp lý (nền tảng niềm tin) → lý do thứ 2 → lý do LỚN NHẤT cuối cùng
  const reasons = legalR && locR.length >= 1 ? [legalR, ...locR.slice(1, 2), locR[0]] : locR.length >= 2 ? [locR[1], locR[2], locR[0]].filter(Boolean) : [];
  const RW = ['Thứ nhất', 'Thứ hai'];
  const whyQ = { 'chuyen-gia': `${reasons.length} lý do nên chọn ${kwFull} này.`, 'chot-sale': `Vì sao nên xuống tiền ${kwFull} này?`,
    'ke-chuyen': `Vậy vì sao nên chọn nơi này?` }[tone] || `Vậy vì sao nên chọn ${kwFull} này?`;
  const reasonLine = reasons.length >= 2 ? `${whyQ} ${reasons.slice(0, -1).map((r, i) => `${RW[i]}, ${r.say}.`).join(' ')} Và lý do lớn nhất: ${reasons.at(-1).say}.`
    + ' Số liệu từ bản đồ thực tế, anh chị kiểm tra được.' : '';
  const reasonTiles = reasons.map(r => ({ n: r.n, unit: r.unit, sub: r.sub }));
  // câu hỏi 1 mở đầu phần trục đường (kiểu Radar) / cảnh bán kính (kiểu app cũ); radar nối tiếp phần trả lời
  const askQ1 = 'Sống ở đây có tiện không?';
  const OCAT = ['truong', 'cho', 'yte', 'kcn', 'khudothi', 'congvien', 'hanhchinh', 'giaothong', 'nganhang'];
  const OWORD = { truong: 'trường học', cho: 'chợ', yte: 'bệnh viện', kcn: 'khu công nghiệp', khudothi: 'khu đô thị', congvien: 'công viên', hanhchinh: 'cơ quan hành chính', giaothong: 'bến xe', nganhang: 'ngân hàng' };
  const ocats = OCAT.filter(c => pois.some(p => p.cat === c)).slice(0, 4).map(c => OWORD[c]);
  const olist = ocats.length > 1 ? ocats.slice(0, -1).join(', ') + ' và ' + ocats.at(-1) : ocats[0];
  const overviewLine = olist ? `${askQ1} Trong bán kính <b>${fmtNum(oldR)} km</b> có đủ ${olist}${roads.length ? `, cùng <b>${roads.length} trục đường lớn</b>` : ''}.`
    : roads.length ? `Cùng xem <b>${roads.length} trục đường lớn</b> quanh ${kw}.` : `Cùng xem xung quanh ${kw} có gì nhé.`;
  // 15/11 22:21: thêm vế cho biết trục đó là gì (theo TÊN trục — cao tốc / quốc lộ / tỉnh lộ / đại lộ), không đoán gì thêm
  const roadWhy = r => /cao\s*tốc/i.test(r.name) ? ', lên cao tốc đi các tỉnh thuận tiện' : /quốc\s*lộ|^ql\s?\d/i.test(r.name) ? ', trục quốc lộ nối các tỉnh'
    : /tỉnh\s*lộ|^đt\s?\d|^tl\s?\d/i.test(r.name) ? ', trục tỉnh lộ của khu vực' : /đại\s*lộ|xa\s*lộ/i.test(r.name) ? ', trục giao thông lớn của thành phố' : '';
  const rdLines = roads.map((r, j) => r.id === roadFront?.id ? `Nằm ngay <b>${r.name}</b>${roadWhy(r)}.`
    : `${j === (roadFront ? 1 : 0) ? 'Từ nhà ra' : 'Ra'} <b>${r.name}</b> ${j === (roadFront ? 1 : 0) ? 'chỉ khoảng' : 'khoảng'} <b>${r.min} phút</b>${roadWhy(r)}.`);
  // tổng kết (vòng 9, Giang: đoạn kết có thẻ 3 con số lớn): đọc đúng 3 con số trên thẻ; không đủ số liệu thì câu kiểu app cũ
  const summaryLine = reasonLine ? reasonLine : sumLine ? sumLine : buyer === 'thue' ? `Tất cả chỉ trong bán kính <b>${fmtNum(oldR)} km</b>, ở tiện, đi làm đi học đều gần.`
    : `Tất cả chỉ trong bán kính <b>${fmtNum(oldR)} km</b> quanh ${kind === 'canho' ? 'căn hộ' : kind === 'duan' ? 'dự án' : 'nhà'}, sống tiện, đi lại dễ.`;
  const lines = {
    intro, overview: overviewLine, rd: rdLines, summary: summaryLine,
    radar: radarLine, house: houseLine ? cap(houseLine) : '', lot: lotLine ? cap(lotLine) : '',
    poi: pois.map((p, i) => poiLine(p, buyer, pois.slice(0, i).filter(q => q.cat === 'truong').length)),   // 'Sáng đưa con đi học' cho trường xuất hiện đầu tiên
    // kết nối vùng: số phút ô tô theo đường đi thật
    anchor: anchors.map((a, i) => a.type === 'center' ? `Về ${a.name} chỉ khoảng <b>${a.min} phút</b> ô tô, quãng đường <b>${fmtNum(a.km)} km</b>${a.min <= 60 && anchors.findIndex(x => x.type === 'center') === i ? (buyer === 'thue' ? ', người thuê đi làm trung tâm thuận tiện' : buyer === 'vung' ? ', kết nối về lõi đô thị thuận tiện' : ', đi làm, mua sắm, giải trí đều thuận tiện') : ''}.`
      : a.type === 'airport' ? `Ra ${a.name} khoảng <b>${a.min} phút</b>, bay đi công tác, về quê nhanh gọn.`
        : a.type === 'port' ? `Ra ${a.name} khoảng <b>${a.min} phút</b>, quãng đường <b>${fmtNum(a.km)} km</b>${buyer === 'vung' ? ', thuận lợi kho bãi, vận chuyển hàng hoá' : ''}.`
          : `${cap('Tới ' + a.name)} cách <b>${fmtNum(a.km)} km</b>, khoảng <b>${a.min} phút</b> ô tô.`),
    score: reasonLine || sumLine,
    airport: infra?.airport && `${infra.airport.name}: <b>${fmtNum(infra.airport.km)} km</b>, khoảng <b>${infra.airport.min} phút</b>, bay đi mọi miền.`,
    metro: infra?.metro && `${infra.metro.name} đã chạy, ga ${infra.metro.nearName} cách khoảng <b>${fmtNum(Math.round(infra.metro.nearKm * 10) / 10)} km</b> đường chim bay.`,
    road: infra?.road && `${infra.road.name} cách nhà <b>${fmtNum(Math.round(infra.road.km * 10) / 10)} km</b>.`,
    // 16/11 (Giang): lời kêu gọi DỪNG ở "để nhận thông tin chi tiết về sản phẩm" — không hẹn đi xem
    cta: `${ctaLead ? ctaLead + ' ' : ''}${L.price ? `Giá bán <b>${L.price}</b>. ` : ''}${ctaMode === 'binhluan' ? `Bình luận chữ ${ctaKey.toLowerCase()}` : `Nhắn tin chữ ${ctaKey.toLowerCase()}`} để nhận thông tin chi tiết về sản phẩm.`,
    cluster: cluster ? cluster.line : '',
    orbit: orbit ? orbit.line : '',
    // cảnh ảnh căn nhà: đọc điểm nổi bật CHÍNH môi giới viết trong tin (không có thì câu mời xem chung, không bịa)
    // cảnh ảnh (cuối video): chỉ giới thiệu đây là ảnh thực tế — khớp với mọi ảnh, không tả bịa nội dung từng ảnh
    photos: (edits.photos || []).length ? 'Đây là hình ảnh thực tế của sản phẩm, anh chị xem qua nhé.' : '',
    // từ nhà ra từng trục đường lớn bao nhiêu phút (đường đi thật; trục ngay trước nhà thì nói "nằm ngay") → nhìn tổng thể vị trí
    // 15/11 vòng 7: MỖI trục một câu, đúng thứ tự hiện (trục trước nhà → trục gần nhất) → máy bay tới từng trục đúng lúc giọng nói tên
    roads: rdLines.length ? `${askQ1} ${rdLines.join(' ')}` : '',
    build: build.length ? (build[0].station ? `Tuyến <b>${build[0].name}</b> đang thi công, ${build[0].station} chỉ cách <b>${km(build[0].km)}</b>.`
      : `Hạ tầng đang thi công gần nhà: <b>${build[0].name}</b>, cách <b>${km(build[0].km)}</b>.`)
      + (build[1] ? ` Thêm <b>${build[1].name}</b> cách <b>${km(build[1].km)}</b>.` : '') + (full ? ' Khi xong, khu vực kết nối càng thuận tiện.' : '') : '',
  };
  // khách sửa câu: ghi đè theo khoá cảnh (intro, house, lot, poi:<id>, anchor:<id>, score, cta…)
  const E = edits.lines || {};
  for (const k of ['intro', 'house', 'lot', 'photos', 'roads', 'radar', 'build', 'score', 'airport', 'metro', 'road', 'cta', 'cluster', 'orbit', 'overview', 'summary']) if (E[k] != null) lines[k] = E[k];
  roads.forEach((r, j) => { if (E['rd:' + r.id] != null) lines.rd[j] = E['rd:' + r.id]; });
  pois.forEach((p, i) => { if (E['poi:' + p.id] != null) lines.poi[i] = E['poi:' + p.id]; });
  anchors.forEach((a, i) => { if (E['anchor:' + a.id] != null) lines.anchor[i] = E['anchor:' + a.id]; });

  return {
    kind, buyer, persona: `${KINDS[kind].label} · ${BUYERS[buyer].label}`,
    house: H, info: { price: (!priceEnd && L.price) || kindTxt || L.dims || (L.area ? `${fmtNum(L.area)} m²` : ''), chips: infoChips(L) }, footprint, lot,
    // 16/11: cảnh kết = ảnh đẹp nhất của căn làm nền (nhà phố / biệt thự / nhà vườn: ảnh đầu = mặt tiền; đất, căn hộ: ảnh máy chấm điểm cao nhất;
    // khách bấm ★ để chọn) + thẻ tổng kết + GIÁ (số chạy) + nút kêu gọi
    priceEnd, price: L.price || '', hero: heroOf(kind, edits),
    pois, anchors, infra, score: reasonLine || sumLine ? score : null, scoreR, lines, radar, frontStreet,
    // 16/11: thẻ tổng kết = "VÌ SAO NÊN MUA?" + 3 lý do (ô cuối = lý do lớn nhất, viền sáng); thiếu số liệu thì 3 con số lớn như trước
    stats: reasons.length >= 2 ? reasonTiles : stats.slice(0, 3), statsTitle: reasons.length >= 2 ? 'VÌ SAO NÊN MUA?' : '', statsHi: reasons.length >= 2 ? reasons.length - 1 : -1,
    reasons: reasons.map(r => r.say.replace(/<[^>]+>/g, '')),
    ask1: OLD ? '' : 'SỐNG Ở ĐÂY CÓ TIỆN KHÔNG?',   // viên chữ câu hỏi 1 trên hình (kiểu Radar); kiểu app cũ chỉ hỏi bằng lời
    // vòng 7 (Giang): tổng kết là cảnh riêng ngay trước lời kêu gọi (mọi bản) — không gộp 3 con số vào cảnh kết nữa
    full, cluster, orbit, flow: radar ? 'radar' : 'lanluot', engine: OLD ? 'old' : '3d', oldR, statsInCta: false, ctaKey, ctaMode, cta: ctaAsk, area,
    // mở đầu từ quả địa cầu bay xuống tỉnh (mặc định bật, khách tắt ở "Sửa video")
    globe: edits.globe !== false,
    labelStyle: ['trang', 'kinh', 'mau'].includes(edits.labelStyle) ? edits.labelStyle : 'trang', ctaSub: `để nhận thông tin chi tiết về sản phẩm`, ctaLong: `${ctaAsk} nhận thông tin`,
    style: styleOf(kind, buyer), bird: !!edits.bird,
    watermark: edits.watermark || '', showKind, captions, phone,
    // bản ngắn: tối đa 5 ảnh thực tế cuối video
    photos: (edits.photos || []).slice(0, full ? 99 : 4), roads, zones: [...zones, ...airportZone(S, infra, anchors), ...landmarkZones(S, anchors, zones)], build,
    // Ảnh bìa (mẫu Giang chọn 11/11): tên căn/dự án, phường, GIÁ BÁN to, 2 dòng phụ — chữ lấy đúng từ tin đăng; màu tự đổi theo căn
    cover: {
      // tin không có giá: ô to ghi diện tích (hoặc tỉnh/thành), không lặp loại nhà / phường đã có ở ô trên
      // tên đã có phường/xã thì bỏ phần đó (phường/xã đã có ô riêng ngay dưới)
      title: (stripPlace(L.title || kindTxt, place) || L.title || kindTxt).toUpperCase(),
      ward: (place || L.province || '').toUpperCase(),
      label: L.price ? 'GIÁ BÁN' : (L.dims || L.area) ? 'DIỆN TÍCH' : 'KHU VỰC',
      // giá để cuối video: ô to ghi "XEM CUỐI VIDEO" (khách tò mò xem hết)
      big: (L.price && priceEnd ? 'XEM CUỐI VIDEO' : L.price || L.dims || (L.area && `${fmtNum(L.area)} m²`) || (L.province && L.province !== place ? L.province : '') || kindTxt).toUpperCase(),
      // 15/11: dòng lợi ích mạnh nhất ngay khung đầu (vd "300 m tới trường mầm non", "25 phút về trung tâm") — số liệu quét thật
      hook: buyer === 'vung' && center ? `${center.min} phút về trung tâm` : buyer === 'thue' && kcn ? `${mins(kcn) ? mins(kcn) + ' phút' : km(kcn.km)} tới ${zoneName(kcn.name)}`
        : p0 ? `${p0.km >= 1 && mins(p0) ? mins(p0) + ' phút' : km(p0.km)} tới ${p0name}` : center ? `${center.min} phút về trung tâm` : '',
      lines: [L.street || L.road, [L.price ? L.dims || (L.area && `${fmtNum(L.area)}m²`) : null, L.floors || L.level, L.legal].filter(Boolean).slice(0, 2).join('  ·  ')].filter(Boolean),
      color: COVER_COLORS[((edits.palette ?? Math.abs(Math.round((S.house.lat * 1e4) + (S.house.lng * 1e4)))) % COVER_COLORS.length + COVER_COLORS.length) % COVER_COLORS.length],
    },
  };
}
// Ảnh nền cảnh kết: khách bấm ★ (edits.heroIdx) → ảnh đó; nhà phố / biệt thự / nhà vườn → ảnh đầu (môi giới hay chụp mặt tiền trước);
// đất nền, căn hộ → ảnh điểm cao nhất (edits.photoQ: độ nét + tương phản + sáng vừa + màu, chấm ở dao-dien.js photoScore)
const FACADE_KINDS = ['nhapho', 'bietthu', 'nhavuon'];
export function heroIndex(kind, n, heroIdx, q = []) {
  if (!n) return -1;
  if (Number.isInteger(heroIdx) && heroIdx >= 0 && heroIdx < n) return heroIdx;
  let b = 0; for (let i = 1; i < n; i++) if ((q[i] ?? -1) > (q[b] ?? -1)) b = i;
  // nhà: ảnh đầu (mặt tiền) — trừ khi ảnh đầu tối / mờ hẳn (điểm < 0,35 và kém ảnh tốt nhất ≥ 0,3) thì lấy ảnh tốt nhất
  if (FACADE_KINDS.includes(kind) || !q.length) return q.length && (q[0] ?? 1) < 0.35 && (q[b] ?? 0) - (q[0] ?? 0) >= 0.3 ? b : 0;
  return b;
}
function heroOf(kind, edits) {
  const ph = edits.photos || [], i = heroIndex(kind, ph.length, edits.heroIdx, edits.photoQ);
  return i >= 0 ? ph[i] : null;
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
const kwOf = kind => ({ duan: 'dự án', nhapho: 'căn nhà', bietthu: 'căn biệt thự', nhavuon: 'căn nhà vườn', canho: 'căn hộ', datnen: 'lô đất' }[kind] || 'căn nhà');
// Từ khoá kêu gọi mặc định theo loại (khách sửa được)
export const ctaKeyOf = kind => CTA_KEY[kind] || 'XEM NHÀ';
const CTA_KEY = { duan: 'XEM DỰ ÁN', nhapho: 'XEM NHÀ', bietthu: 'XEM BIỆT THỰ', nhavuon: 'XEM NHÀ VƯỜN', canho: 'XEM CĂN HỘ', datnen: 'XEM ĐẤT' };
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
      // 15/11 vòng 7 (Giang: cảnh trục đường rối): KCN không còn hiện trong cảnh trục đường — chỉ ở cảnh quét radar + tổng kết
      show: anc ? ['anchor:' + anc.id] : ['radar', 'score'] };
  }).filter(Boolean);
}
