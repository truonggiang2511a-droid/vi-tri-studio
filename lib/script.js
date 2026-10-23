// Viết lời đọc cho từng đoạn video bằng Claude (khoá ANTHROPIC_API_KEY hoặc GEMINI_API_KEY đặt trong biến môi trường Cloudflare).
// Chỉ dùng đúng số liệu app gửi lên, không thêm thông tin ngoài.
import { env, json, allowAi } from './vt.js';

const SYSTEM = `Bạn là người viết lời dẫn tiếng Việt cho video giới thiệu vị trí bất động sản (video bản đồ ngắn đăng TikTok, Facebook, YouTube), giọng văn của môi giới giỏi: tự nhiên, gần gũi, cuốn hút, nói như người thật.
Video chạy theo trình tự cố định, mỗi khoá là một cảnh:
- intro: trung cảnh ghim bất động sản, xã/phường sáng lên. Nếu có giá thì nói giá trước (ngắn, gây chú ý), rồi nói "Đây là vị trí [loại BĐS] thuộc [xã/phường]". Nếu không có xã/phường thì là câu móc mở đầu.
- province: cả tỉnh/thành phố hiện lên. Chỉ 1 câu rất ngắn nêu tỉnh/thành (ví dụ "Thuộc Thành phố Hồ Chí Minh.").
- house: cận cảnh bất động sản. Đọc thông tin thật: diện tích, đất thổ cư, số tầng, phòng ngủ, đường trước nhà, pháp lý — chỉ những mục có dữ liệu.
- overview, road:*, boundary, poi:*: toàn cảnh bán kính, các trục đường lớn, ranh tỉnh, từng tiện ích (nêu lợi ích cho người ở/đầu tư).
- summary, photos, outro: tổng kết, ảnh thực tế, kết.
Yêu cầu:
- Mỗi cảnh 1–2 câu ngắn, đọc to khoảng 2–5 giây (province 1–2 giây). Tránh lặp cùng một kiểu câu giữa các cảnh.
- Chỉ dùng đúng tên và số liệu được cung cấp. Không bịa giá, diện tích, thổ cư, pháp lý, quy hoạch, thời gian đi lại. Không nhắc quận/huyện (đã bỏ từ 7/2025).
- Viết khoảng cách bằng số, số thập phân dùng dấu phẩy: "450 mét", "1,2 km" (app tự đổi thành lời đọc). Viết "Thành phố Hồ Chí Minh" thay cho "TP.HCM", "quốc lộ" thay cho "QL".
- Đoạn kết: một câu tạo cảm giác khan hiếm vừa phải rồi kêu gọi đi xem nhà. Nếu dữ liệu có so_dien_thoai_lien_he thì đọc đúng số đó; nếu không có thì tuyệt đối không tự thêm số điện thoại. Nếu có thuong_hieu thì nhắc tên.
- Trả về đúng một đối tượng JSON, khoá giữ nguyên như đầu vào, giá trị là câu đọc. Không thêm chữ nào ngoài JSON.`;

// Claude (ANTHROPIC_API_KEY) hoặc Gemini (GEMINI_API_KEY, lấy ở aistudio.google.com). Có cả hai thì dùng Claude trước.
async function viaClaude(key, user) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env('ANTHROPIC_MODEL') || 'claude-haiku-5-5',
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error('Claude: ' + (j?.error?.message || res.status));
  return (j.content || []).map(c => c.text || '').join('');
}

const GEMINI_MODELS = () => [env('GEMINI_MODEL'), 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'].filter(Boolean);
async function viaGemini(key, user) {
  let last = null;
  for (const model of [...new Set(GEMINI_MODELS())]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await res.json().catch(() => null);
    if (res.ok) {
      const text = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (text) return text;
      last = new Error('Gemini không trả về nội dung');
      continue;
    }
    last = new Error('Gemini: ' + (j?.error?.message || res.status));
    // Model không có / chưa mở cho khoá này thì thử model kế tiếp
    if (res.status !== 404 && res.status !== 400) throw last;
  }
  throw last || new Error('Gemini lỗi');
}

export async function handleScript(req) {
  const claude = env('ANTHROPIC_API_KEY'), gemini = env('GEMINI_API_KEY');
  const provider = claude ? 'claude' : gemini ? 'gemini' : null;
  if (req.method === 'GET') return json({ ready: !!provider, provider }, 200);
  if (req.method !== 'POST') return json({ error: 'Phương thức không hỗ trợ' }, 405);
  if (!provider) return json({ error: 'Chưa cấu hình khoá viết kịch bản AI', code: 'NO_KEY' }, 501);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Dữ liệu không hợp lệ' }, 400); }
  const facts = body.facts || {};
  const segments = body.segments || {};
  const keys = Object.keys(segments).slice(0, 30);
  if (!keys.length) return json({ error: 'Không có đoạn nào' }, 400);
  const denied = await allowAi(req, 'script', 1500, Number(body.lat), Number(body.lng));
  if (denied) return denied;
  const user = `Dữ liệu căn nhà và khu vực:\n${JSON.stringify(facts, null, 1)}\n\nCác đoạn cần viết (khoá → nội dung hình đang hiện, kèm câu mẫu):\n${JSON.stringify(Object.fromEntries(keys.map(k => [k, segments[k]])), null, 1)}`;
  try {
    let text;
    if (claude) {
      try { text = await viaClaude(claude, user); }
      catch (e) { if (!gemini) throw e; text = await viaGemini(gemini, user); }
    } else text = await viaGemini(gemini, user);
    const m = text.match(/\{[\s\S]*\}/);
    let out = null;
    try { out = m ? JSON.parse(m[0]) : null; } catch { out = null; }
    if (!out) return json({ error: 'Kịch bản trả về không đúng dạng, bấm lại lần nữa' }, 502);
    const clean = {};
    for (const k of keys) if (typeof out[k] === 'string' && out[k].trim()) clean[k] = out[k].trim().slice(0, 400);
    return json({ segments: clean, provider }, 200);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
