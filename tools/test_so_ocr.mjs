// Thử /api/so-ocr bằng fetch giả (không gọi AI thật, không tốn tiền): node tools/test_so_ocr.mjs
import { setEnv } from '../lib/vt.js';
import { handleSoOcr, parseOcr, normNum } from '../lib/so-ocr.js';

let fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log('SAI', msg, '→', JSON.stringify(a), '≠', JSON.stringify(b)); } };

// 1) Chuẩn hoá số
eq(normNum('1 180 081,47'), '1180081.47', 'cách + phẩy');
eq(normNum('1.180.081,47'), '1180081.47', 'chấm nghìn + phẩy');
eq(normNum('1180081.47'), '1180081.47', 'chấm thập phân');
eq(normNum('591372,13'), '591372.13', 'phẩy thập phân');
eq(normNum('1.180.081'), '1180081', 'chấm nghìn');
eq(normNum('abc'), '', 'chữ');

// 2) Đọc JSON AI trả (có rào ```json)
const ai = '```json\n{"diem":[{"n":"1","x":"1 180 081,47","y":"591372.13"},{"n":"2","x":"1180081.47","y":"591377.13"},{"n":"3","x":"x","y":"1"}],"canh":[{"tu":"1","den":"2","m":"5,00"}],"ktt":"KTT 105°45\'","dien_tich":"100,0","khong_chac":["2"],"ghi_chu":""}\n```';
const r = parseOcr(ai);
eq(r.points.length, 2, 'bỏ điểm hỏng');
eq(r.points[0], { n: '1', x: '1180081.47', y: '591372.13' }, 'điểm 1');
eq(r.edges, [{ from: '1', to: '2', m: 5 }], 'cạnh');
eq(r.area, 100, 'diện tích');
eq(r.unsure, ['2'], 'không chắc');
eq(parseOcr('không có json'), null, 'không JSON');

// 3) Route với fetch giả
const calls = [];
globalThis.fetch = async (url, opt) => {
  calls.push(String(url));
  if (String(url).includes('/rest/v1/rpc/vt_ai_allow')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  if (String(url).includes('api.anthropic.com')) {
    const b = JSON.parse(opt.body);
    if (b.model === 'claude-sonnet-5-5') return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
    const img = b.messages[0].content[0];
    if (img.type !== 'image' || img.source.media_type !== 'image/jpeg') throw new Error('ảnh gửi sai dạng');
    if (b.thinking?.type !== 'disabled') throw new Error('chưa tắt thinking');
    return new Response(JSON.stringify({ content: [{ type: 'text', text: ai }] }), { status: 200 });
  }
  throw new Error('gọi lạ ' + url);
};
setEnv({ ANTHROPIC_API_KEY: 'k', VT_SUPABASE_URL: 'https://db.test', VT_SUPABASE_KEY: 'x' });
const req = body => new Request('https://vitristudio.com/api/so-ocr', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify(body) });
let res = await handleSoOcr(req({ image: 'data:image/jpeg;base64,' + 'A'.repeat(400), lat: 10.67, lng: 106.58 }));
let j = await res.json();
eq(res.status, 200, 'trạng thái');
eq(j.points?.length, 2, 'số điểm qua route');
eq(j.model, 'claude-haiku-5-5', 'lùi sang model kế khi model đầu lỗi');
eq(calls.filter(u => u.includes('vt_ai_allow')).length, 1, 'kiểm tra lượt đúng 1 lần');

res = await handleSoOcr(req({ image: '' }));
eq(res.status, 400, 'ảnh rỗng');
res = await handleSoOcr(new Request('https://vitristudio.com/api/so-ocr', { method: 'POST', body: JSON.stringify({ image: 'QUJD' }) }));
eq(res.status, 401, 'chưa đăng nhập');
setEnv({});
res = await handleSoOcr(new Request('https://vitristudio.com/api/so-ocr'));
eq((await res.json()).ready, false, 'GET khi chưa có khoá');

console.log(fail ? `${fail} lỗi` : 'Tất cả đạt');
process.exit(fail ? 1 : 0);
