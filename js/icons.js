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
  city: 'M3 21V9l5-3v3l4-2.5V21zm10 0V3h8v18zM5 11h1.8v1.8H5zm0 3.5h1.8v1.8H5zm4-3.5h1.8v1.8H9zm0 3.5h1.8v1.8H9zM15 5.5h1.8v1.8H15zm2.8 0h1.8v1.8h-1.8zM15 9h1.8v1.8H15zm2.8 0h1.8v1.8h-1.8zM15 12.5h1.8v1.8H15zm2.8 0h1.8v1.8h-1.8zM15 16h1.8v1.8H15zm2.8 0h1.8v1.8h-1.8z',
  plane: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z',
  train: 'M12 2c-4 0-8 .5-8 4v9.5A3.5 3.5 0 0 0 7.5 19L6 20.5v.5h2.2l2-2h3.6l2 2H18v-.5L16.5 19a3.5 3.5 0 0 0 3.5-3.5V6c0-3.5-4-4-8-4zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3.5-7H6V6h5zm2 0V6h5v4zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  plug: 'M15 2h2v5h-2zM7 2h2v5H7zM5 8h14v3a7 7 0 0 1-6 6.9V22h-2v-4.1A7 7 0 0 1 5 11zm8.2 2-3.4 4.2h2.2l-1 3 3.4-4.2h-2.2z',
  beach: 'M2 20.5c1.7 0 1.7-1 3.3-1s1.7 1 3.4 1 1.6-1 3.3-1 1.7 1 3.3 1 1.7-1 3.4-1 1.6 1 3.3 1V22c-1.7 0-1.7-1-3.3-1s-1.7 1-3.4 1-1.6-1-3.3-1-1.7 1-3.3 1-1.7-1-3.4-1-1.6 1-3.3 1zM12.7 3a9 9 0 0 1 8.3 9.3L13.6 9.6 10 18.4l-1.9-.8 3.6-8.7L4.3 6.2A9 9 0 0 1 12.7 3z',
  fuel: 'M4 3h9v18H4zm2 2v5h5V5zm9 2 1.5-1.5 3 3V17a2 2 0 0 1-4 0v-3h-1v-2h1.5a1.5 1.5 0 0 1 1.5 1.5V17h1V9.6l-1.5-1.5V10h-1.5z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z',
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
