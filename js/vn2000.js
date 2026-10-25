// Đổi toạ độ sổ đỏ / sổ hồng (hệ VN-2000, lưới chiếu UTM múi 3°) sang toạ độ GPS (WGS-84) cho lô đất.
// - Phép chiếu: Transverse Mercator trên elipxoit WGS-84, k0 = 0,9999 (múi 3°), cộng 500 km phía Đông, gốc ở xích đạo.
// - Chuyển hệ: 7 tham số theo EPSG "VN-2000 to WGS 84 (2)" (QĐ 05/2007/QĐ-BTNMT), quy ước coordinate frame.
// - Quy ước sổ đỏ: X = hướng Bắc (~1.0–2.6 triệu m), Y = hướng Đông (~330–670 nghìn m). Nhập ngược thì tự nhận ra theo độ lớn.
// - Kinh tuyến trục: in trên sơ đồ thửa (vd. "KTT 105°45'"); không có thì dò theo vị trí ghim căn nhà.
// Sai số ~1 m: đủ để vẽ lô trong video, KHÔNG dùng làm căn cứ pháp lý.

const A = 6378137, F = 1 / 298.257223563;
const E2 = F * (2 - F), E = Math.sqrt(E2);
const N_ = F / (2 - F);
const RAD = Math.PI / 180;

// Hệ số chuỗi Krüger bậc 6 (sai số dưới mm trong múi 3°)
const n = N_, n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
const AA = A / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const ALPHA = [
  n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
  13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
  61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
  49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
  34729 * n5 / 80640 - 3418889 * n6 / 1995840,
  212378941 * n6 / 319334400,
];
const BETA = [
  n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
  n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
  17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
  4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
  4583 * n5 / 161280 - 108847 * n6 / 3991680,
  20648693 * n6 / 638668800,
];

// tan(vĩ độ) <-> tan(vĩ độ bảo giác) (Karney 2011)
const taupOf = tau => {
  const s = Math.sinh(E * Math.atanh(E * tau / Math.hypot(1, tau)));
  return tau * Math.hypot(1, s) - s * Math.hypot(1, tau);
};
function tauOf(taup) {
  let tau = taup / (1 - E2);
  for (let i = 0; i < 6; i++) {
    const tp = taupOf(tau);
    const d = (taup - tp) / ((1 - E2) * Math.hypot(1, tp) * Math.hypot(1, tau)) * (1 + (1 - E2) * tau * tau);
    tau += d;
    if (Math.abs(d) < 1e-14) break;
  }
  return tau;
}

// Lưới chiếu -> (vĩ độ, kinh độ) trên elipxoit VN-2000 (dùng kích thước WGS-84)
export function tmInverse(north, east, lon0, k0 = 0.9999, fe = 500000) {
  const xi1 = north / (k0 * AA), eta1 = (east - fe) / (k0 * AA);
  let xi = xi1, eta = eta1;
  for (let j = 1; j <= 6; j++) {
    xi -= BETA[j - 1] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
    eta -= BETA[j - 1] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
  }
  const taup = Math.sin(xi) / Math.hypot(Math.sinh(eta), Math.cos(xi));
  const lat = Math.atan(tauOf(taup)) / RAD;
  const lng = lon0 + Math.atan2(Math.sinh(eta), Math.cos(xi)) / RAD;
  return { lat, lng };
}
export function tmForward(lat, lng, lon0, k0 = 0.9999, fe = 500000) {
  const lam = (lng - lon0) * RAD;
  const taup = taupOf(Math.tan(lat * RAD));
  const xi1 = Math.atan2(taup, Math.cos(lam));
  const eta1 = Math.asinh(Math.sin(lam) / Math.hypot(taup, Math.cos(lam)));
  let xi = xi1, eta = eta1;
  for (let j = 1; j <= 6; j++) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
  }
  return { north: k0 * AA * xi, east: fe + k0 * AA * eta };
}

// 7 tham số VN-2000 -> WGS-84 (EPSG, coordinate frame): dịch (m), xoay (giây), tỉ lệ (ppm)
const TX = -191.90441429, TY = -39.30318279, TZ = -111.45032835;
const SEC = RAD / 3600;
const RX = -0.00928836 * SEC, RY = 0.01975479 * SEC, RZ = -0.00427372 * SEC, S = 1 + 0.252906278e-6;

function toEcef(lat, lng, h = 0) {
  const p = lat * RAD, l = lng * RAD, sp = Math.sin(p);
  const Nn = A / Math.sqrt(1 - E2 * sp * sp);
  return [(Nn + h) * Math.cos(p) * Math.cos(l), (Nn + h) * Math.cos(p) * Math.sin(l), (Nn * (1 - E2) + h) * sp];
}
function fromEcef([x, y, z]) {
  const lng = Math.atan2(y, x), pr = Math.hypot(x, y);
  let lat = Math.atan2(z, pr * (1 - E2));
  for (let i = 0; i < 8; i++) {
    const sp = Math.sin(lat), Nn = A / Math.sqrt(1 - E2 * sp * sp);
    const h = pr / Math.cos(lat) - Nn;
    const nl = Math.atan2(z, pr * (1 - E2 * Nn / (Nn + h)));
    if (Math.abs(nl - lat) < 1e-13) { lat = nl; break; }
    lat = nl;
  }
  return { lat: lat / RAD, lng: lng / RAD };
}
// Coordinate frame: X' = T + S·[[1, rz, −ry], [−rz, 1, rx], [ry, −rx, 1]]·X
function helmert([x, y, z], inv = false) {
  if (!inv) {
    return [TX + S * (x + RZ * y - RY * z), TY + S * (-RZ * x + y + RX * z), TZ + S * (RY * x - RX * y + z)];
  }
  // Ngược: bỏ dịch, chia tỉ lệ, nhân ma trận chuyển vị (góc rất nhỏ)
  const u = (x - TX) / S, v = (y - TY) / S, w = (z - TZ) / S;
  return [u - RZ * v + RY * w, RZ * u + v - RX * w, -RY * u + RX * v + w];
}

export function vn2000ToWgs84(north, east, lon0, k0 = 0.9999) {
  const g = tmInverse(north, east, lon0, k0);
  return fromEcef(helmert(toEcef(g.lat, g.lng)));
}
export function wgs84ToVn2000(lat, lng, lon0, k0 = 0.9999) {
  const g = fromEcef(helmert(toEcef(lat, lng), true));
  return tmForward(g.lat, g.lng, lon0, k0);
}

// ---------- Đọc chữ khách dán vào ----------
// Nhận cả "1185432.56", "1185432,56", "1.185.432,56", "1 185 432.56"; bỏ số thứ tự điểm và số nhỏ.
function toNum(tok) {
  let t = tok.replace(/\s/g, '');
  const lastDot = t.lastIndexOf('.'), lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    t = t.split(dec === '.' ? ',' : '.').join('');
    t = t.replace(dec, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = t.split(sep);
    // nhiều dấu giống nhau = phân cách hàng nghìn ("1.185.432"). Một dấu: phần nguyên ≥ 4 chữ số thì là dấu thập phân
    // ("1185432,56", "591372.1328"); phần nguyên ≤ 3 chữ số + đúng 3 số sau thì là hàng nghìn ("593.123")
    if (parts.length > 2) t = parts.join('');
    else t = parts[0].length >= 4 || parts[1].length !== 3 ? parts[0] + '.' + parts[1] : parts.join('');
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

export function parseCoordText(text) {
  const rows = [], bad = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const raw = line.trim();
    if (!raw) return;
    const toks = raw.match(/\d{1,3}(?: \d{3})+(?:[.,]\d+)?(?!\d)|\d[\d.,]*/g) || [];
    const nums = toks.map(toNum).filter(v => v >= 100000 && v <= 3000000);
    if (nums.length >= 2) {
      const [a, b] = nums.slice(-2);
      rows.push({ line: i + 1, a, b });
    } else if (/\d/.test(raw)) bad.push(i + 1);
  });
  // Xác định cột nào là X (Bắc): giá trị ~0,9–2,7 triệu; Y (Đông): ~0,15–0,85 triệu
  let swapped = false;
  const looksXY = r => r.a >= 900000 && r.b <= 900000;
  const looksYX = r => r.b >= 900000 && r.a <= 900000;
  const nXY = rows.filter(looksXY).length, nYX = rows.filter(looksYX).length;
  if (nYX > nXY) swapped = true;
  const pts = rows.map(r => swapped ? { line: r.line, x: r.b, y: r.a } : { line: r.line, x: r.a, y: r.b });
  const odd = pts.filter(p => !(p.x >= 900000 && p.x <= 2700000 && p.y >= 150000 && p.y <= 850000)).map(p => p.line);
  return { pts, swapped, bad, odd };
}

// ---------- Kiểm tra đa giác ----------
const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function segsCross(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function checkPolygon(pts) {
  const issues = [];
  // điểm cuối trùng điểm đầu (nhiều sổ ghi lặp điểm 1 ở cuối) → bỏ, không báo lỗi
  let P = pts.slice();
  if (P.length > 3 && Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y) < 0.01) P = P.slice(0, -1);
  if (P.length < 3) issues.push('Cần ít nhất 3 điểm góc.');
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    if (Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y) < 0.05) issues.push(`Điểm dòng ${P[i].line} và dòng ${P[j].line} trùng nhau.`);
  }
  const m = P.length;
  for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) {
    if (i === 0 && j === m - 1) continue;
    if (segsCross(P[i], P[(i + 1) % m], P[j], P[(j + 1) % m])) { issues.push('Các cạnh cắt nhau — kiểm tra lại thứ tự điểm (đi vòng quanh lô).'); i = m; break; }
  }
  // Diện tích trên mặt phẳng chiếu (cách tính của bản đồ địa chính), m²
  let s = 0;
  for (let i = 0; i < m; i++) { const p = P[i], q = P[(i + 1) % m]; s += p.y * q.x - q.y * p.x; }
  return { pts: P, area: Math.abs(s) / 2, issues };
}

// ---------- Dò kinh tuyến trục theo ghim căn nhà ----------
// Các KTT ở VN đều là bội số 15' (102°00' … 109°30'). Hai KTT liền nhau lệch ~27 km nên dò rất chắc.
export const MERIDIANS = Array.from({ length: 31 }, (_, i) => 102 + i * 0.25);
export const fmtMeridian = m => `${Math.floor(m)}°${String(Math.round((m % 1) * 60)).padStart(2, '0')}'`;

const distM = (a, b) => {
  const k = 111320, dx = (a.lng - b.lng) * k * Math.cos(((a.lat + b.lat) / 2) * RAD), dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
};

export function convertLot(pts, { lon0 = null, pin = null } = {}) {
  const P = pts.length ? pts : [];
  const cx = P.reduce((s, p) => s + p.x, 0) / (P.length || 1), cy = P.reduce((s, p) => s + p.y, 0) / (P.length || 1);
  let best = null;
  const tries = lon0 != null ? [{ m: lon0, k: 0.9999 }] : [
    ...MERIDIANS.map(m => ({ m, k: 0.9999 })),
    { m: 105, k: 0.9996 }, { m: 111, k: 0.9996 }, // bản đồ cũ múi 6° (UTM 48/49)
  ];
  for (const t of tries) {
    const c = vn2000ToWgs84(cx, cy, t.m, t.k);
    const d = pin ? distM(c, pin) : 0;
    if (!best || d < best.d) best = { ...t, c, d };
  }
  const lot = P.map(p => vn2000ToWgs84(p.x, p.y, best.m, best.k));
  return { lot, meridian: best.m, k0: best.k, centroid: best.c, pinDist: pin ? best.d : null, guessed: lon0 == null };
}
