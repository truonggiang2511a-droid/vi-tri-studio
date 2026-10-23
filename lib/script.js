// Viết lời đọc cho từng đoạn video bằng Claude (khoá ANTHROPIC_API_KEY hoặc GEMINI_API_KEY đặt trong biến môi trường Cloudflare).
// Chỉ dùng đúng số liệu app gửi lên, không thêm thông tin ngoài.
import { env, json, allowAi } from './vt.js';

const SYSTEM = `Bạn là biên kịch lời dẫn tiếng Việt cho video bản đồ giới thiệu bất động sản (TikTok, Facebook Reels, YouTube Shorts). Bạn viết như một môi giới có duyên, có cá tính, nói chuyện như người thật — KHÔNG viết kiểu văn mẫu.
Video chạy theo trình tự cố định, mỗi khoá là một cảnh:
- intro: trung cảnh ghim bất động sản, xã/phường sáng lên. Câu móc thật mạnh trong 2 giây đầu (giá sốc, câu hỏi, tình huống, câu đùa…), rồi cho biết bất động sản thuộc xã/phường nào.
- province: cả tỉnh/thành phố hiện lên. 1 câu rất ngắn có nêu tên tỉnh/thành.
- house: cận cảnh bất động sản. Đọc thông tin thật có trong dữ liệu (diện tích, thổ cư, số tầng, phòng ngủ, đường trước nhà, pháp lý) theo cách hấp dẫn.
- overview, road:*, boundary, poi:*: toàn cảnh bán kính, từng trục đường lớn, ranh tỉnh, từng tiện ích — nói LỢI ÍCH cụ thể cho người ở/đầu tư, mỗi cảnh một kiểu câu khác nhau.
- summary, photos, outro: tổng kết, ảnh thực tế, kết + kêu gọi hành động.
Quy tắc bắt buộc:
- Viết theo PHONG CÁCH được yêu cầu trong tin nhắn. Mỗi lần viết phải khác hẳn các lần trước (đổi câu móc, đổi cách so sánh, đổi nhịp câu). Không mở đầu nhiều câu giống nhau, không lặp "chỉ … là tới …" quá 2 lần trong cả kịch bản.
- ĐỘ DÀI (bắt buộc, đếm chữ): intro tối đa 22 chữ; province tối đa 10 chữ; house tối đa 28 chữ; outro tối đa 26 chữ; mọi cảnh khác tối đa 18 chữ. Ngắn, gọn, đắt — video ngắn nên mỗi chữ phải có giá trị.
- Chỉ dùng đúng tên và số liệu được cung cấp. Không bịa giá, diện tích, thổ cư, pháp lý, quy hoạch, thời gian đi lại, tên tiện ích. Không nhắc quận/huyện (đã bỏ từ 7/2025).
- Hài hước thì duyên, lịch sự, không chê bai địa phương, không phân biệt vùng miền, không đùa về tai nạn, bệnh tật, tâm linh.
- Viết khoảng cách bằng số, số thập phân dùng dấu phẩy: "450 mét", "1,2 km". Viết "Thành phố Hồ Chí Minh" thay cho "TP.HCM", "quốc lộ" thay cho "QL". Không dùng emoji, không dùng ký hiệu lạ (máy sẽ đọc to).
- Đoạn kết: tạo cảm giác khan hiếm vừa phải rồi kêu gọi đi xem nhà. Nếu dữ liệu có so_dien_thoai_lien_he thì đọc đúng số đó; nếu không có thì tuyệt đối không tự thêm số điện thoại. Nếu có thuong_hieu thì nhắc tên.
- Trả về đúng một đối tượng JSON hợp lệ, khoá giữ nguyên như đầu vào, giá trị là câu đọc. Trong câu KHÔNG dùng dấu ngoặc kép " (muốn trích thì dùng dấu ngoặc đơn hoặc bỏ đi). Không thêm chữ nào ngoài JSON.`;

// Phong cách khách chọn (mỗi lần bấm "Tạo lại" cũng đổi góc viết)
const TONES = {
  'hai-huoc': 'HÀI HƯỚC, DUYÊN DÁNG: chơi chữ nhẹ, so sánh vui đời thường (ví dụ: "gần chợ tới mức nghe được tiếng trả giá", "đi học gần, con khỏi lấy cớ trễ giờ"), giọng tếu nhưng vẫn đáng tin.',
  'ke-chuyen': 'KỂ CHUYỆN, CẢM XÚC: vẽ ra một ngày sống ở đây (sáng đưa con đi học, chiều đi chợ, tối cả nhà ra công viên), ấm áp, gần gũi.',
  'chuyen-gia': 'CHUYÊN GIA ĐẦU TƯ: điềm tĩnh, sắc bén, nhấn vào hạ tầng, kết nối, tiềm năng tăng giá và cho thuê — chỉ dựa trên dữ liệu có thật.',
  'tre-trung': 'TRẺ TRUNG, BẮT TREND TIKTOK: câu ngắn, nhịp nhanh, năng lượng cao, từ ngữ trẻ ("chân ái", "quá đã", "xịn xò") nhưng không lố.',
  'sang-trong': 'SANG TRỌNG, TINH TẾ: chậm rãi, chọn lọc từ ngữ, nhấn vào sự riêng tư, đẳng cấp, chất lượng sống.',
  'chot-sale': 'CHỐT SALE MẠNH: thẳng vào lợi ích và giá, tạo khan hiếm rõ ràng, kêu gọi hành động dứt khoát.',
};
const ANGLES = ['Bắt đầu bằng một câu hỏi tu từ.', 'Bắt đầu bằng con số ấn tượng nhất trong dữ liệu.', 'Bắt đầu bằng một tình huống đời thường.', 'Bắt đầu bằng một lời khẳng định táo bạo.', 'Bắt đầu bằng một lời "thú nhận" vui.'];

// Claude (ANTHROPIC_API_KEY) hoặc Gemini (GEMINI_API_KEY, lấy ở aistudio.google.com). Có cả hai thì dùng Claude trước.
async function viaClaude(key, user) {
  // Haiku 5.5 mặc định tự "suy nghĩ" trước khi trả lời, dễ dùng hết max_tokens → phần trả lời rỗng.
  // Viết kịch bản không cần suy nghĩ: tắt đi (rẻ + nhanh); máy chủ không nhận tham số này thì gửi lại không có nó.
  const call = async withThinkingOff => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env('ANTHROPIC_MODEL') || 'claude-haiku-5-5',
        max_tokens: 6000,
        temperature: 1,
        ...(withThinkingOff ? { thinking: { type: 'disabled' } } : {}),
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const j = await res.json().catch(() => null);
    return { res, j };
  };
  let { res, j } = await call(true);
  if (res.status === 400 && /thinking/i.test(j?.error?.message || '')) ({ res, j } = await call(false));
  if (!res.ok) throw new Error('Claude: ' + (j?.error?.message || res.status));
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
  if (!text.trim()) throw new Error(`Claude trả rỗng (stop_reason=${j?.stop_reason}, loại=${(j?.content || []).map(c => c.type).join(',')})`);
  return text;
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
        generationConfig: { temperature: 1.0, maxOutputTokens: 4096, responseMimeType: 'application/json' },
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

// Đọc JSON từ AI kể cả khi AI chèn dấu ngoặc kép giữa câu hoặc bọc trong ```json: thử JSON chuẩn trước,
// không được thì cắt theo từng khoá đã biết (giá trị kéo tới ngay trước khoá kế tiếp)
function parseLoose(text, keys) {
  const t = String(text || '').replace(/```(?:json)?/gi, '');
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* sửa bên dưới */ } }
  const body = m ? m[0] : t;
  const esc = k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pos = keys.map(k => {
    const r = new RegExp('"' + esc(k) + '"\\s*:\\s*"').exec(body);
    return r ? { k, start: r.index, from: r.index + r[0].length } : null;
  }).filter(Boolean).sort((a, b) => a.start - b.start);
  if (!pos.length) return null;
  const out = {};
  pos.forEach((p, i) => {
    const end = i + 1 < pos.length ? pos[i + 1].start : body.lastIndexOf('}');
    let v = body.slice(p.from, end > p.from ? end : undefined).trim();
    v = v.replace(/"\s*,?\s*$/, '').replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
    if (v) out[p.k] = v;
  });
  return Object.keys(out).length ? out : null;
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
  const tone = TONES[body.tone] || TONES['hai-huoc'];
  const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
  const user = `PHONG CÁCH: ${tone}\nGóc mở đầu lần này: ${angle} (phiên bản số ${Math.floor(Math.random() * 100000)} — viết mới hoàn toàn, không lặp lại cách viết thông thường.)\n\nDữ liệu căn nhà và khu vực:\n${JSON.stringify(facts, null, 1)}\n\nCác cảnh cần viết (khoá → hình đang hiện trên video và dữ liệu của cảnh đó):\n${JSON.stringify(Object.fromEntries(keys.map(k => [k, segments[k]])), null, 1)}`;
  try {
    let text, used = provider, claudeErr = '';
    if (claude) {
      try { text = await viaClaude(claude, user); }
      catch (e) { claudeErr = String(e.message || e).slice(0, 200); if (!gemini) throw e; used = 'gemini'; text = await viaGemini(gemini, user); }
    } else text = await viaGemini(gemini, user);
    const out = parseLoose(text, keys);
    if (!out) {
      console.log('script-bad', used, claudeErr, String(text).slice(0, 500));
      return json({ error: 'Kịch bản trả về không đúng dạng, bấm lại lần nữa', used, claude_error: claudeErr, raw: String(text).slice(0, 300) }, 502);
    }
    const clean = {};
    for (const k of keys) if (typeof out[k] === 'string' && out[k].trim()) clean[k] = out[k].trim().slice(0, 400);
    return json({ segments: clean, provider: used, ...(claudeErr ? { claude_error: claudeErr } : {}) }, 200);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
