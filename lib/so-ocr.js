// Đọc bảng toạ độ góc thửa từ ảnh chụp sơ đồ thửa đất (sổ đỏ) bằng AI nhìn ảnh.
// Ảnh chỉ đi qua máy chủ để gửi cho AI, KHÔNG lưu, KHÔNG ghi log nội dung ảnh hay kết quả.
// Chỉ trả về số hiệu điểm, X, Y, độ dài cạnh, kinh tuyến trục, diện tích — không đọc tên chủ, số sổ, địa chỉ.
import { env, json, allowAi } from './vt.js';

const MAX_B64 = 6_000_000; // ~4,5 MB ảnh

const SYSTEM = `Bạn đọc ảnh chụp "sơ đồ thửa đất" trên giấy chứng nhận quyền sử dụng đất Việt Nam (sổ đỏ/sổ hồng) và chép lại CHÍNH XÁC bảng toạ độ các điểm góc thửa (hệ VN-2000).
Quy tắc:
- Chỉ chép những gì in trong ảnh, từng chữ số. Không đoán, không làm tròn, không tự tính. Số nào mờ/không chắc thì vẫn chép theo cách đọc tốt nhất và ghi số hiệu điểm đó vào "khong_chac".
- X là cột X (thường 7 chữ số trước dấu phẩy, khoảng 900000–2700000), Y là cột Y (6 chữ số, khoảng 150000–850000). Giữ đúng cột như in trên sổ, kể cả khi bạn thấy lạ.
- Viết số dạng chuỗi, dấu thập phân là dấu chấm, bỏ dấu cách/dấu chấm phân cách hàng nghìn. Ví dụ "1 180 081,47" → "1180081.47".
- Giữ đúng thứ tự các dòng trong bảng. Không lặp lại điểm đầu ở cuối nếu bảng không in lặp.
- "canh": độ dài các cạnh nếu sổ có in (cột "Cạnh", "Chiều dài", hoặc số ghi dọc các cạnh trên hình), mỗi cạnh ghi điểm đầu, điểm cuối và số mét. Không có thì để [].
- "ktt": dòng kinh tuyến trục nếu có in (vd. "KTT 105°45'", "múi chiếu 3°"), chép nguyên văn; không có thì null.
- "dien_tich": diện tích thửa in trên sổ (số mét vuông, dạng chuỗi), không có thì null.
- Ảnh có nhiều thửa thì chỉ lấy thửa chính (thửa được tô/đánh dấu hoặc có bảng toạ độ).
- KHÔNG chép tên người, số sổ, số vào sổ, địa chỉ hay bất kỳ thông tin cá nhân nào.
- Ảnh không phải sơ đồ thửa hoặc không có bảng toạ độ: trả "diem": [] và giải thích ngắn trong "ghi_chu".
Trả về đúng một đối tượng JSON, không thêm chữ nào khác:
{"diem":[{"n":"1","x":"1180081.47","y":"591372.13"}],"canh":[{"tu":"1","den":"2","m":"5.00"}],"ktt":null,"dien_tich":null,"khong_chac":[],"ghi_chu":""}`;

const USER = 'Chép bảng toạ độ góc thửa trong ảnh này theo đúng quy tắc.';

async function viaClaude(key, mediaType, data) {
  const models = [...new Set([env('OCR_MODEL'), 'claude-sonnet-5-5', env('ANTHROPIC_MODEL'), 'claude-haiku-5-5'].filter(Boolean))];
  let lastErr = '';
  for (const model of models) {
    const call = async withThinkingOff => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          // Không gửi temperature: model 5.5 báo lỗi 'temperature is deprecated' với giá trị khác mặc định (thử thật 25/10)
          model, max_tokens: 3000,
          ...(withThinkingOff ? { thinking: { type: 'disabled' } } : {}),
          system: SYSTEM,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: USER },
          ] }],
        }),
        signal: AbortSignal.timeout(50000),
      });
      return { res, j: await res.json().catch(() => null) };
    };
    let { res, j } = await call(true);
    if (res.status === 400 && /thinking/i.test(j?.error?.message || '')) ({ res, j } = await call(false));
    if (res.ok) {
      const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
      if (text.trim()) return { text, model };
      lastErr = 'trả rỗng';
      continue;
    }
    lastErr = j?.error?.message || String(res.status);
    // Sai tên model / không có quyền model đó → thử model kế; lỗi khác (quá tải, khoá sai) cũng thử tiếp cho chắc
  }
  throw new Error('Claude: ' + lastErr);
}

async function viaGemini(key, mediaType, data) {
  const models = [...new Set([env('GEMINI_MODEL'), 'gemini-2.5-flash', 'gemini-3.1-flash-lite'].filter(Boolean))];
  let lastErr = '';
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mediaType, data } }, { text: USER }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(50000),
    });
    const j = await res.json().catch(() => null);
    const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (res.ok && text.trim()) return { text, model };
    lastErr = j?.error?.message || String(res.status);
  }
  throw new Error('Gemini: ' + lastErr);
}

// Chuẩn hoá một số toạ độ AI trả về ("1 180 081,47", "1.180.081,47", "1180081.47") → "1180081.47"
export function normNum(v) {
  let s = String(v ?? '').trim().replace(/[\s ]/g, '');
  if (!s) return '';
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  if (commas === 1 && dots >= 1) s = s.replace(/\./g, '').replace(',', '.');       // 1.180.081,47
  else if (dots >= 2 && !commas) s = s.replace(/\.(?=\d{3}(\.|$))/g, '');           // 1.180.081
  else if (commas === 1 && !dots) s = s.replace(',', '.');                          // 1180081,47
  else if (commas >= 2) s = s.replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? s : '';
}

// Đọc JSON AI trả về (có thể kèm ```json …```) → dạng gọn, đã lọc
export function parseOcr(text) {
  const t = String(text || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o;
  try { o = JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  const lab = v => String(v ?? '').trim().slice(0, 8);
  const points = (Array.isArray(o.diem) ? o.diem : []).slice(0, 60)
    .map((p, i) => ({ n: lab(p?.n) || String(i + 1), x: normNum(p?.x), y: normNum(p?.y) }))
    .filter(p => p.x && p.y);
  const edges = (Array.isArray(o.canh) ? o.canh : []).slice(0, 60)
    .map(e => ({ from: lab(e?.tu), to: lab(e?.den), m: Number(normNum(e?.m)) }))
    .filter(e => e.from && e.to && e.m > 0 && e.m < 5000);
  const area = Number(normNum(o.dien_tich)) || null;
  const unsure = (Array.isArray(o.khong_chac) ? o.khong_chac : []).map(lab).filter(Boolean).slice(0, 60);
  return {
    points, edges, area,
    ktt: o.ktt ? String(o.ktt).slice(0, 80) : null,
    unsure,
    note: o.ghi_chu ? String(o.ghi_chu).slice(0, 300) : '',
  };
}

export async function handleSoOcr(req) {
  const claude = env('ANTHROPIC_API_KEY'), gemini = env('GEMINI_API_KEY');
  if (req.method === 'GET') return json({ ready: !!(claude || gemini) }, 200);
  if (req.method !== 'POST') return json({ error: 'Phương thức không hỗ trợ' }, 405);
  if (!claude && !gemini) return json({ error: 'Chưa cấu hình AI đọc ảnh', code: 'NO_KEY' }, 501);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Dữ liệu không hợp lệ' }, 400); }
  let img = String(body.image || '');
  const m = img.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
  const mediaType = m ? m[1] : 'image/jpeg';
  if (m) img = img.slice(m[0].length);
  if (!img || img.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(img.slice(0, 200))) return json({ error: 'Ảnh không hợp lệ hoặc quá lớn' }, 400);
  const denied = await allowAi(req, 'script', 500, Number(body.lat), Number(body.lng));
  if (denied) return denied;
  try {
    let out, err = '';
    if (claude) {
      try { out = await viaClaude(claude, mediaType, img); } catch (e) { err = String(e.message || e).slice(0, 200); if (!gemini) throw e; }
    }
    if (!out) out = await viaGemini(gemini, mediaType, img);
    const r = parseOcr(out.text);
    if (!r) return json({ error: 'AI trả về không đúng dạng, chụp lại rõ hơn rồi thử lại', model: out.model }, 502);
    return json({ ...r, model: out.model, ...(err ? { claude_error: err } : {}) }, 200);
  } catch (e) {
    return json({ error: String(e.message || e).slice(0, 300) }, 502);
  }
}
