// Địa chỉ và khoá công khai của Supabase (khoá publishable, an toàn để nằm trên trình duyệt)
export const SB_URL = 'https://crzinaydjgqepffatqoo.supabase.co';
export const SB_KEY = 'sb_publishable_NhyivL-3owNWC6unb8GbZA_d135dx3i';

// Gọi hàm vt_* không cần đăng nhập, không chờ kết quả (đếm lượt vào trang…)
export function rpcFire(fn, args = {}) {
  try {
    fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST', keepalive: true,
      headers: { apikey: SB_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    }).catch(() => {});
  } catch { /* bỏ qua */ }
}
