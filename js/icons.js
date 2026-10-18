// Biểu tượng vẽ trên video (khung 24x24), dùng Path2D để vẽ sắc nét ở mọi độ phân giải.
const PATHS = {
  house: 'M12 3.2 2.5 11.6h2.9V20h5.1v-5.6h3V20h5.1v-8.4h2.9z',
  school: 'M12 3 1 8.5 12 14l9-4.5V16h2V8.5zM5 12.3v3.9C5 18 8.1 19.5 12 19.5s7-1.5 7-3.3v-3.9l-7 3.5z',
  health: 'M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5z',
  market: 'M3 4h2.6l2.2 10.2h10.4L20.6 7H7.4L7 5h15.6l-3.2 11H6.2L3.4 6H3zM8.5 18a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zm8.5 0a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z',
  gov: 'M12 2 2.5 7v2h19V7zM4.5 10.5h3V18h-3zm6 0h3V18h-3zm6 0h3V18h-3zM2.5 19.5h19V22h-19z',
  park: 'M12 2 6.5 9.5H9L5 15h6v7h2v-7h6l-4-5.5h2.5z',
  factory: 'M2 21V10l6 3.6V10l6 3.6V3h4v18zM5.5 17.5h2.2v-2.2H5.5zm5 0h2.2v-2.2h-2.2zm5 0h2.2v-2.2h-2.2z',
  bus: 'M5 3h14a2 2 0 0 1 2 2v12a2 2 0 0 1-1 1.7V21h-3v-2H7v2H4v-2.3A2 2 0 0 1 3 17V5a2 2 0 0 1 2-2zm0 3v6h14V6zm2 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  bank: 'M12 2 2.5 7v2h19V7zM12 4.6l4.6 2.4H7.4zM4.5 10.5h3V18h-3zm6 0h3V18h-3zm6 0h3V18h-3zM2.5 19.5h19V22h-19z',
  road: 'M9 2h2l-1.5 20h-5zm6 0h-2l1.5 20h5zM11.2 5h1.6v3h-1.6zm0 5.5h1.6v3h-1.6zm0 5.5h1.6v3h-1.6z',
};

export const ICON_PATHS = PATHS;
const cache = {};
export function icon(name) {
  if (!cache[name]) cache[name] = new Path2D(PATHS[name] || PATHS.house);
  return cache[name];
}

// Vẽ biểu tượng tâm (x, y), cạnh size
export function drawIcon(ctx, name, x, y, size, color) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(icon(name));
  ctx.restore();
}
