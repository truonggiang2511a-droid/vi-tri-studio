// AI đạo diễn — ảnh căn nhà khách tải lên (tối đa 12). Ảnh chỉ nằm trên máy khách (không gửi máy chủ):
// thu nhỏ cạnh dài 1280 px (đủ nét cho video 1080p, nhẹ RAM điện thoại) và lưu IndexedDB để đi đăng ký rồi quay lại vẫn còn.
export const MAX_PHOTOS = 12;
const MAX_SIDE = 1280;
const DB = 'vitri-dd', STORE = 'kv';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kv(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode), st = tx.objectStore(STORE), q = fn(st);
    tx.oncomplete = () => res(q?.result); tx.onerror = () => rej(tx.error);
  });
}
export const kvGet = k => kv('readonly', st => st.get(k)).catch(() => undefined);
export const kvPut = (k, v) => kv('readwrite', st => st.put(v, k)).catch(() => {});
export const savePhotos = blobs => kv('readwrite', st => st.put(blobs, 'photos')).catch(() => {});
export const loadPhotoBlobs = () => kv('readonly', st => st.get('photos')).then(x => x || []).catch(() => []);

// File ảnh → Blob JPEG đã thu nhỏ (ảnh điện thoại 12 MP ~ 4 MB → ~250 KB)
export async function shrink(file) {
  const bm = await createImageBitmap(file);
  const s = Math.min(1, MAX_SIDE / Math.max(bm.width, bm.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
  c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
  bm.close?.();
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
}
export const toBitmap = blob => createImageBitmap(blob);
