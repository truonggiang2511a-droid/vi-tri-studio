// Kiểm tra js/vn2000.js: chạy `node tools/test_vn2000.mjs`
// Điểm chuẩn lấy từ PROJ 9.8 (pyproj 3.8), phép "VN-2000 to WGS 84 (2)" (coordinate frame) + tmerc k0 0,9999.
import { vn2000ToWgs84, wgs84ToVn2000, parseCoordText, checkPolygon, convertLot } from '../js/vn2000.js';
const REF = [{"lat": 13.360341643, "lng": 103.3710291349, "lon0": 102.75, "north": 1477621.8404, "east": 567071.7897}, {"lat": 22.4868120981, "lng": 105.6660981957, "lon0": 105.25, "north": 2487625.2758, "east": 542618.94}, {"lat": 22.549546751, "lng": 106.6575345671, "lon0": 106.25, "north": 2494570.6367, "east": 541719.112}, {"lat": 15.6270813455, "lng": 103.5675042002, "lon0": 103.5, "north": 1728314.524, "east": 507041.709}, {"lat": 15.2469861251, "lng": 102.4978468835, "lon0": 102.0, "north": 1686318.8038, "east": 553280.5617}, {"lat": 14.5674330704, "lng": 106.109852122, "lon0": 106.5, "north": 1611114.3959, "east": 457764.7993}, {"lat": 15.3539582679, "lng": 103.4184838728, "lon0": 103.75, "north": 1698121.9684, "east": 464212.0907}, {"lat": 9.5709402365, "lng": 107.5311971326, "lon0": 107.5, "north": 1058405.5709, "east": 503229.4214}, {"lat": 19.0814464172, "lng": 108.701122598, "lon0": 108.75, "north": 2110586.5215, "east": 494661.9572}, {"lat": 14.1399274608, "lng": 104.7012420136, "lon0": 104.25, "north": 1563827.869, "east": 548519.3257}, {"lat": 22.1998641718, "lng": 103.91018112, "lon0": 103.5, "north": 2455848.9068, "east": 542096.2404}, {"lat": 9.1975474136, "lng": 102.5474661387, "lon0": 102.0, "north": 1017153.7549, "east": 559963.8574}];
const dm = (a, b) => Math.hypot((a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 110540);
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('✗', msg); } else console.log('✓', msg); };
for (const c of REF) {
  const g = vn2000ToWgs84(c.north, c.east, c.lon0);
  const f = wgs84ToVn2000(c.lat, c.lng, c.lon0);
  ok(dm(g, c) < 0.01 && Math.hypot(f.north - c.north, f.east - c.east) < 0.01, `PROJ khớp < 1 cm tại ${c.lat.toFixed(3)}, ${c.lng.toFixed(3)} (KTT ${c.lon0})`);
}
const pin = { lat: 10.67, lng: 106.587 };
const o = wgs84ToVn2000(pin.lat, pin.lng, 105.75);
const sq = [[0, 0], [0, 5], [20, 5], [20, 0]].map(([dn, de]) => ({ x: o.north + dn, y: o.east + de }));
const txt = sq.map((p, i) => `${i + 1}  ${p.x.toFixed(2).replace('.', ',')}  ${p.y.toFixed(2)}`).join('\n');
const pr = parseCoordText(txt), chk = checkPolygon(pr.pts), r = convertLot(chk.pts, { pin });
ok(pr.pts.length === 4 && !pr.swapped, 'Đọc 4 điểm, đúng cột');
ok(Math.abs(chk.area - 100) < 0.01, 'Diện tích 100 m²');
ok(r.meridian === 105.75 && r.pinDist < 15, "Tự dò KTT 105°45' và lô sát ghim");
ok(parseCoordText(sq.map(p => `${p.y} ${p.x}`).join('\n')).swapped, 'Nhận ra nhập ngược cột Y X');
ok(Math.abs(parseCoordText('1.185.432,56  593.123,45').pts[0].x - 1185432.56) < 1e-6, 'Đọc số kiểu 1.185.432,56');
ok(checkPolygon([sq[0], sq[2], sq[1], sq[3]].map((p, i) => ({ ...p, line: i + 1 }))).issues.length > 0, 'Báo lỗi cạnh cắt nhau');
ok(checkPolygon([...sq, sq[0]].map((p, i) => ({ ...p, line: i + 1 }))).pts.length === 4, 'Bỏ điểm cuối lặp lại điểm đầu');
console.log(fail ? `\n${fail} lỗi` : '\nTất cả đạt');
process.exit(fail ? 1 : 0);
