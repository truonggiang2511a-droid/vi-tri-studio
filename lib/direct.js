// "Dựng theo kịch bản" (30/10/2026, đang thử — CHỈ tài khoản admin @vitristudio.com): khách dán cả bài, AI (Haiku)
// xếp TỪNG CÂU vào đúng cảnh video (câu nói tiện ích nào → cảnh tiện ích đó, nói tỉnh/thành → cảnh khoanh tỉnh…)
// và gợi ý hiệu ứng: chữ điểm nhấn, icon động, biểu đồ giá, hình tăng trưởng.
// AI KHÔNG viết lại lời: chỉ trả số thứ tự câu → khoá cảnh, nên lời đọc giữ nguyên 100% bài của khách.
// Máy chủ kiểm lại mọi hiệu ứng: chữ chỉ được dùng từ/số có trong câu, số trên biểu đồ phải có trong kịch bản, icon trong danh sách.
import { env, json, rpc, accountsOn } from './vt.js';
import { viaClaude, viaGemini, parseLoose } from './script.js';
import { FX_ICON_DESC } from '../js/fx-icons.js';

const ADMIN_RE = /@vitristudio\.com$/i;
const KICKERS = ['Giá bán', 'Giá chỉ', 'Diện tích', 'Cách nhà', 'Chỉ cách', 'Pháp lý', 'Kết nối', 'Chỉ', 'Tiện ích', 'Hạ tầng', 'Thời gian', 'Tăng trưởng'];
const UNITS_OK = new Set(['m', 'm²', 'm2', 'km', 'tỷ', 'tỉ', 'triệu', 'phút', 'mét', 'ha', 'x', '%', 'giây', 'giờ', 'tr']);
const GROWTH_RE = /tăng|lên giá|gấp\s*(đôi|\d)|đi lên|tăng trưởng|x\s?\d/i;
// Icon cũng không được "nói" điều câu không nói (vd. icon sông cho câu không nhắc sông nước): phải có ít nhất một từ (≥ 3 chữ cái)
// trong mô tả icon xuất hiện trong câu hoặc trong tên/nhóm của cảnh câu đó thuộc về. Vài icon chung chung luôn được dùng.
const ICON_ANY = new Set(['nha', 'ghim', 'bando', 'sao', 'lapanh', 'chiakhoa', 'hoptac', 'lotrinh']);
const STOP = new Set(['nhà', 'khu', 'cho', 'các', 'đang', 'của', 'tới', 'mới', 'đẹp', 'tốt']);
function okIcon(id, context) {
  if (!FX_ICON_DESC[id]) return false;
  if (ICON_ANY.has(id)) return true;
  const ctx = new Set(words(context));
  return words(FX_ICON_DESC[id]).some(w => w.length >= 3 && !STOP.has(w) && ctx.has(w));
}

const SYSTEM = `Bạn là đạo diễn dựng video bản đồ giới thiệu bất động sản (TikTok/Reels). Môi giới đã viết sẵn lời đọc; app đã đánh số từng câu.
Video có sẵn các CẢNH (khoá → mô tả hình trên video). Nhiệm vụ:
1) Xếp MỖI câu vào đúng MỘT khoá cảnh mà câu đó đang nói tới, để camera lia tới đúng chỗ khi giọng đọc nói tới:
- câu nêu tên một tiện ích cụ thể (trường, chợ, bệnh viện, siêu thị, ngân hàng, công viên, khu công nghiệp…) → khoá poi:… có tên khớp (cho phép viết khác hoa thường, thiếu/thừa chữ "Trường", "Chợ"…); nêu tên một con đường/quốc lộ/cao tốc → khoá road:… khớp tên;
- câu nêu tên tỉnh/thành phố (không phải câu mở đầu) → province nếu có; câu mở đầu, câu móc, giới thiệu chung, xã/phường → intro;
- diện tích, kích thước, pháp lý, số tầng, phòng ngủ, đường trước nhà, mô tả căn → house; câu nói chung về tiện ích quanh nhà, bán kính → overview;
- số phút lái xe tới trung tâm/sân bay/cảng/ga → region; công trình hạ tầng đang thi công → infra; vùng lái xe 5-10-15 phút → iso; ranh giới sang tỉnh khác → boundary;
- câu tổng kết → summary; kêu gọi liên hệ, xem nhà, số điện thoại → outro; mời xem video/ảnh thực tế → reel hoặc photos nếu có.
- Câu nêu một nơi KHÔNG có trong danh sách cảnh: đưa vào "thieu" (số câu + tên nơi đó) và xếp câu vào overview.
- Câu nối tiếp ý câu trước (không nêu nơi mới) → cùng khoá với câu trước.
2) Gợi ý hiệu ứng động cho câu đáng nhấn (tối đa 1 hiệu ứng mỗi câu, khoảng 1 hiệu ứng cho mỗi 1–2 câu, ưu tiên câu có số liệu):
- "chu": chữ điểm nhấn rất ngắn (tối đa 4 chữ) CHỈ dùng đúng từ và số có trong câu đó, ví dụ "500 MÉT", "3,2 TỶ", "SỔ HỒNG RIÊNG", "5 PHÚT". Có thể thêm "nhan" (một trong: ${KICKERS.join(', ')}) và "icon".
- "icon": chỉ icon (câu nhắc loại tiện ích/hạ tầng mà không có số).
- "bieu_do": CHỈ khi câu (hoặc kịch bản) có từ 2 con số giá/giá trị cụ thể để so sánh theo thời gian hoặc giữa các mốc: "diem" = [{"nhan": mốc lấy đúng chữ trong câu như "2022", "Hiện tại", "gia_tri": số}], "don_vi" (triệu/m², tỷ, %), "tieu_de" tối đa 3 chữ lấy từ câu.
- "tang_truong": câu nói giá trị/khu vực tăng trưởng, tăng giá nhưng KHÔNG có số cụ thể.
- "neo": đúng chữ trong câu, tại đó hiệu ứng xuất hiện (chép nguyên văn, vd "500 mét").
- "icon" chọn trong danh sách: ${Object.entries(FX_ICON_DESC).map(([k, v]) => `${k} (${v})`).join('; ')}.
- KHÔNG bịa số, KHÔNG thêm chữ không có trong câu, KHÔNG làm biểu đồ khi không có số.
Trả về đúng MỘT đối tượng JSON, không chữ nào khác:
{"canh":[[số câu,"khoá"],…],"hieu_ung":[{"cau":số câu,"loai":"chu|icon|bieu_do|tang_truong","chu":"…","nhan":"…","icon":"…","neo":"…","diem":[…],"don_vi":"…","tieu_de":"…"}],"thieu":[{"cau":số câu,"ten":"…"}]}`;

const NUM_RE = /\d+(?:[.,]\d+)*/g;
const toNum = x => {
  const t = String(x);
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return parseFloat(t.replace(/\./g, ''));
  return parseFloat(t.replace(/\./g, '').replace(',', '.'));
};
const nums = s => (String(s).match(NUM_RE) || []).map(toNum).filter(Number.isFinite);
const low = s => String(s || '').normalize('NFC').toLowerCase();
const words = s => low(s).split(/[^\p{L}\d%²,.]+/u).map(w => w.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean);

// Chữ hiệu ứng chỉ được dùng từ/số có trong câu (đơn vị đo được phép), tối đa 4 chữ / 24 ký tự
function okText(text, sent) {
  const t = String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 24) return '';
  const ws = t.split(' ');
  if (ws.length > 4) return '';
  const sw = new Set(words(sent));
  const sn = nums(sent);
  for (const tok of words(t)) {
    // "5x20m" → các số 5, 20 + chữ "x", "m"
    const parts = tok.split(/(\d+(?:[.,]\d+)*)/).filter(Boolean);
    for (const p of parts) {
      if (/^\d/.test(p)) { const n = toNum(p); if (!sn.some(a => Math.abs(a - n) < 1e-9)) return ''; }
      else if (!sw.has(p) && !UNITS_OK.has(p)) return '';
    }
  }
  return t;
}

export async function handleDirect(req) {
  const claude = env('ANTHROPIC_API_KEY'), gemini = env('GEMINI_API_KEY');
  if (req.method === 'GET') return json({ ready: !!(claude || gemini) }, 200);
  if (req.method !== 'POST') return json({ error: 'Phương thức không hỗ trợ' }, 405);
  if (!claude && !gemini) return json({ error: 'Chưa cấu hình khoá AI', code: 'NO_KEY' }, 501);
  // Chỉ admin: kiểm tra phiên đăng nhập + tài khoản nội bộ @vitristudio.com (khách gọi thẳng cũng bị chặn)
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!tok) return json({ error: 'Cần đăng nhập tài khoản admin', code: 'AUTH' }, 401);
  if (accountsOn()) {
    let me;
    try { me = await rpc('vt_me', { p_token: tok }); } catch (e) { return json({ error: e.message || 'Phiên đăng nhập hết hạn', code: 'AUTH' }, 401); }
    if (!ADMIN_RE.test(String(me?.profile?.login || ''))) return json({ error: 'Tính năng đang thử, chỉ tài khoản admin dùng được', code: 'ADMIN_ONLY' }, 403);
  }
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Dữ liệu không hợp lệ' }, 400); }
  const sents = (Array.isArray(body.sents) ? body.sents : []).slice(0, 80).map(s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 500));
  if (!sents.length || sents.every(s => !s)) return json({ error: 'Chưa có câu nào' }, 400);
  const scenes = (Array.isArray(body.scenes) ? body.scenes : []).slice(0, 140).filter(x => x && typeof x.khoa === 'string');
  const keys = new Set(scenes.map(x => x.khoa));
  const sceneBy = new Map(scenes.map(x => [x.khoa, x]));
  if (!keys.size) return json({ error: 'Chưa có cảnh nào' }, 400);
  const facts = body.facts || {};
  const user = `Dữ liệu căn (thông tin thật):\n${JSON.stringify(facts)}\n\nCác cảnh có trong video:\n${scenes.map(x => JSON.stringify(x)).join('\n')}\n\nKịch bản (số câu: lời):\n${sents.map((s, i) => `${i}: ${s}`).join('\n')}`;
  const t0 = Date.now();
  let text = '', used = '';
  const errs = [];
  const model = env('DIRECT_MODEL') || 'claude-haiku-5-5';
  if (claude) {
    try { text = await viaClaude(claude, user, model, SYSTEM, 45000, 0.2); used = model; }
    catch (e) { errs.push(String(e.message || e).slice(0, 160)); }
  }
  if (!text && gemini) {
    try { text = await viaGemini(gemini, user, SYSTEM); used = 'gemini'; }
    catch (e) { errs.push(String(e.message || e).slice(0, 160)); }
  }
  if (!text) return json({ error: 'AI chưa dựng được: ' + errs.join(' | ') }, 502);
  let j = null;
  try { j = JSON.parse(String(text).replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/)?.[0] || ''); } catch { j = parseLoose(text, ['canh', 'hieu_ung', 'thieu']); }
  if (!j || !Array.isArray(j.canh)) return json({ error: 'AI trả về không đúng dạng, bấm lại lần nữa', raw: String(text).slice(0, 300) }, 502);

  // 1) Câu → cảnh (khoá phải có trong danh sách, câu nào thiếu thì để trống để app tự gán theo câu trước)
  const assign = sents.map(() => null);
  for (const it of j.canh) {
    const i = Array.isArray(it) ? +it[0] : +it?.cau, k = Array.isArray(it) ? it[1] : it?.khoa;
    if (Number.isInteger(i) && i >= 0 && i < sents.length && keys.has(k) && assign[i] == null) assign[i] = k;
  }
  // 2) Hiệu ứng — kiểm từng cái, sai thì bỏ (hoặc hạ xuống kiểu an toàn hơn)
  const allNums = nums(sents.join(' '));
  const fx = [], used1 = new Set(), dropped = [];
  for (const h of Array.isArray(j.hieu_ung) ? j.hieu_ung.slice(0, 60) : []) {
    const i = +h?.cau;
    if (!Number.isInteger(i) || i < 0 || i >= sents.length || used1.has(i)) continue;
    const s = sents[i];
    let type = { chu: 'text', icon: 'icon', bieu_do: 'chart', tang_truong: 'growth' }[h.loai];
    if (!type) continue;
    const sc = sceneBy.get(assign[i]) || {};
    const icon = okIcon(h.icon, [s, sc.ten, sc.nhom, sc.mo_ta].filter(Boolean).join(' ')) ? h.icon : '';
    const neo = h.neo && low(s).includes(low(h.neo)) ? String(h.neo).normalize('NFC') : '';
    const kicker = KICKERS.includes(h.nhan) && (h.nhan !== 'Tăng trưởng' || GROWTH_RE.test(s)) ? h.nhan : '';
    const o = { cau: i, neo, icon };
    if (type === 'chart') {
      const near = nums([sents[i - 1], s, sents[i + 1]].filter(Boolean).join(' '));
      const pts = (Array.isArray(h.diem) ? h.diem : []).slice(0, 5).map(p => ({ label: String(p?.nhan ?? '').normalize('NFC').trim().slice(0, 14), value: +String(p?.gia_tri ?? '').replace(',', '.') }));
      const ctxLow = low([sents[i - 1], s, sents[i + 1]].filter(Boolean).join(' '));
      const okPts = pts.length >= 2 && pts.every(p => Number.isFinite(p.value) && p.value > 0 && near.some(a => Math.abs(a - p.value) < 1e-9)
        && p.label && (ctxLow.includes(low(p.label)) || (/^(hiện tại|nay|bây giờ)$/i.test(p.label) && /hiện tại|hiện nay|bây giờ|nay/.test(ctxLow))));
      const unit = ['triệu/m²', 'triệu/m2', 'tỷ', 'triệu', '%'].includes(h.don_vi) && ctxLow.includes(low(h.don_vi).replace(/\/m[²2]$/, '')) ? String(h.don_vi).replace('m2', 'm²') : '';
      if (okPts) { Object.assign(o, { type, points: pts, unit, title: okText(h.tieu_de, s) }); }
      else if (GROWTH_RE.test(s)) { Object.assign(o, { type: 'growth', text: okText(h.chu || h.tieu_de, s) }); dropped.push({ cau: i, ly_do: 'biểu đồ thiếu số thật → hình tăng trưởng' }); }
      else { dropped.push({ cau: i, ly_do: 'biểu đồ không có số trong câu' }); continue; }
    } else if (type === 'growth') {
      if (!GROWTH_RE.test(s)) { dropped.push({ cau: i, ly_do: 'câu không nói tăng trưởng' }); continue; }
      Object.assign(o, { type, text: okText(h.chu, s) });
    } else if (type === 'text') {
      const tx = okText(h.chu, s);
      if (!tx) {
        if (icon) Object.assign(o, { type: 'icon' });
        else { dropped.push({ cau: i, ly_do: 'chữ không có trong câu: ' + String(h.chu || '').slice(0, 30) }); continue; }
      } else Object.assign(o, { type, text: tx, kicker });
    } else {
      if (!icon) continue;
      Object.assign(o, { type });
    }
    used1.add(i);
    fx.push(o);
  }
  const missing = (Array.isArray(j.thieu) ? j.thieu : []).slice(0, 20)
    .map(m => ({ cau: +m?.cau, ten: String(m?.ten || '').normalize('NFC').trim().slice(0, 60) }))
    .filter(m => Number.isInteger(m.cau) && m.cau >= 0 && m.cau < sents.length && m.ten);
  const meta = { model: used, ms: Date.now() - t0, nums: allNums.length, dropped, ...(errs.length ? { fallback: errs } : {}) };
  console.log('direct-ok', JSON.stringify({ n: sents.length, fx: fx.length, miss: missing.length, model: used, ms: meta.ms }));
  return json({ assign, fx, missing, meta }, 200);
}
