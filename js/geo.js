// Toán bản đồ: chiếu Web Mercator, khoảng cách, đọc toạ độ từ chuỗi người dùng dán vào.
export const TILE = 256;

export function project(lat, lng, z) {
  const s = TILE * Math.pow(2, z);
  const sin = Math.min(Math.max(Math.sin(lat * Math.PI / 180), -0.9999), 0.9999);
  return {
    x: (lng + 180) / 360 * s,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s,
  };
}

export function unproject(x, y, z) {
  const s = TILE * Math.pow(2, z);
  const lng = x / s * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / s;
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

export function haversineKm(a, b) {
  const R = 6371.0088;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Mét trên mỗi điểm ảnh ở mức zoom z tại vĩ độ lat
export function metersPerPixel(lat, z) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
}

export function formatKm(km, approx = false, mark = '~') {
  let v;
  if (km < 0.95) v = Math.max(50, Math.round(km * 1000 / 50) * 50) + ' m';
  else v = (km < 10 ? km.toFixed(1) : Math.round(km).toString()).replace('.', ',') + ' km';
  return (approx ? mark : '') + v;
}

function dmsToDec(d, m, s, hemi) {
  let v = Math.abs(parseFloat(d)) + (parseFloat(m || 0) / 60) + (parseFloat(s || 0) / 3600);
  if (/[SWsw]/.test(hemi || '') || parseFloat(d) < 0) v = -v;
  return v;
}

function valid(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// Trả về { lat, lng } hoặc { error } để hiển thị cho người dùng
export function parseCoords(input) {
  const s = (input || '').trim();
  if (!s) return { error: 'Chưa nhập toạ độ.' };
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(s)) {
    return { error: 'Link rút gọn của Google Maps chưa đọc được trực tiếp. Mở link, nhấn giữ vào căn nhà để hiện toạ độ (dạng 10.69, 106.59), chép rồi dán vào đây.' };
  }
  const patterns = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&](?:q|query|ll|center|destination|daddr)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/i,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (valid(lat, lng)) return { lat, lng };
    }
  }
  // Độ phút giây: 10°41'28.3"N 106°34'12.1"E
  const dms = s.match(/(\d{1,3})°\s*(\d{1,2})?['′]?\s*(\d{1,2}(?:[.,]\d+)?)?["″]?\s*([NSns])[\s,]+(\d{1,3})°\s*(\d{1,2})?['′]?\s*(\d{1,2}(?:[.,]\d+)?)?["″]?\s*([EWew])/);
  if (dms) {
    const lat = dmsToDec(dms[1], dms[2], (dms[3] || '0').replace(',', '.'), dms[4]);
    const lng = dmsToDec(dms[5], dms[6], (dms[7] || '0').replace(',', '.'), dms[8]);
    if (valid(lat, lng)) return { lat, lng };
  }
  // Hai số thập phân: "10.6900, 106.5900" hoặc "10.69 106.59"
  const plain = s.match(/(?<![\d.])(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
  if (plain) {
    let lat = parseFloat(plain[1]), lng = parseFloat(plain[2]);
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
    if (valid(lat, lng)) return { lat, lng };
  }
  return { error: 'Không đọc được toạ độ. Dán dạng "10.6900, 106.5900" hoặc link Google Maps đầy đủ (có dấu @).' };
}

// Camera để khung LW x LH (điểm ảnh logic) chứa đủ các điểm, chừa lề {left,right,top,bottom}
export function fitZoom(points, LW, LH, pad, minZ = 9, maxZ = 16.6) {
  if (!points.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    const q = project(p.lat, p.lng, 0);
    x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
  }
  const dx = Math.max(x1 - x0, 1e-9), dy = Math.max(y1 - y0, 1e-9);
  const availW = Math.max(40, LW - pad.left - pad.right), availH = Math.max(40, LH - pad.top - pad.bottom);
  const z = Math.max(minZ, Math.min(maxZ, Math.log2(Math.min(availW / dx, availH / dy))));
  const k = Math.pow(2, z);
  // Tâm khung khả dụng nằm lệch so với tâm màn hình khi lề không đều
  const midX = (x0 + x1) / 2 * k, midY = (y0 + y1) / 2 * k;
  const offX = (pad.left - pad.right) / 2, offY = (pad.top - pad.bottom) / 2;
  const c = unproject(midX - offX, midY - offY, z);
  return { zoom: z, lat: c.lat, lng: c.lng };
}

// Dời camera để điểm (lat,lng) hiện ở vị trí (fx*LW, fy*LH) trên màn hình
export function camWithAnchor(lat, lng, zoom, LW, LH, fx = 0.5, fy = 0.5) {
  const p = project(lat, lng, zoom);
  const c = unproject(p.x - (fx - 0.5) * LW, p.y - (fy - 0.5) * LH, zoom);
  return { lat: c.lat, lng: c.lng, zoom };
}
