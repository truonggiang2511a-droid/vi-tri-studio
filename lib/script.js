// Viết lời đọc cho từng đoạn video bằng Claude (khoá ANTHROPIC_API_KEY hoặc GEMINI_API_KEY đặt trong biến môi trường Cloudflare).
// Chỉ dùng đúng số liệu app gửi lên, không thêm thông tin ngoài.
import { env, json, allowAi } from './vt.js';
import { aiFetch } from './ai-relay.js';

const SYSTEM = `Bạn là biên kịch lời dẫn tiếng Việt cho video bản đồ giới thiệu bất động sản (TikTok, Facebook Reels, YouTube Shorts). Bạn viết như một môi giới có duyên, có cá tính, nói chuyện như người thật — KHÔNG viết kiểu văn mẫu.
Video chạy theo trình tự cố định, mỗi khoá là một cảnh:
- intro: trung cảnh ghim bất động sản, xã/phường sáng lên. Câu móc thật mạnh trong 2 giây đầu (giá sốc, câu hỏi, tình huống, câu đùa…), rồi cho biết bất động sản thuộc xã/phường nào.
- province: cả tỉnh/thành phố hiện lên. 1 câu rất ngắn có nêu tên tỉnh/thành.
- house: cận cảnh bất động sản. Đọc thông tin thật có trong dữ liệu (diện tích, thổ cư, số tầng, phòng ngủ, đường trước nhà, pháp lý) theo cách hấp dẫn.
- overview, road:*, boundary, poi:*: toàn cảnh bán kính, từng trục đường lớn, ranh tỉnh, từng tiện ích — nói LỢI ÍCH cụ thể cho người ở/đầu tư, mỗi cảnh một kiểu câu khác nhau.
- region: máy lùi ra cấp vùng, đường đi thật từ nhà tới các điểm mốc lớn (trung tâm, sân bay, cảng, ga) lần lượt sáng lên kèm số phút lái xe. 1 câu về KẾT NỐI VÙNG, nêu các điểm mốc kèm đúng số phút được cung cấp (có thể bỏ bớt điểm cho gọn, không đổi số).
- infra: tuyến cao tốc/vành đai/cầu/đường lớn ĐANG THI CÔNG gần nhà (theo bản đồ) hiện lên nét đứt. 1 câu về tiềm năng hạ tầng: nêu tên tuyến và khoảng cách được cung cấp, nói là đang thi công/đang xây dựng. KHÔNG nêu năm hoàn thành, KHÔNG khẳng định tăng giá.
- iso: vùng lái xe 5, 10, 15 phút quanh nhà sáng lên trên bản đồ. 1 câu về khả năng đi lại nhanh, chỉ dùng các mốc phút được cung cấp, không nêu tên nơi chốn không có trong dữ liệu.
- reel (nếu có): bản đồ đã xong, chuyển sang video/ảnh thực tế của căn nhà. 1 câu mời người xem, kiểu 'Và sau đây, xin mời quý vị cùng xem video thực tế của căn nhà'.
- summary, photos, outro: tổng kết, ảnh thực tế, kết + kêu gọi hành động.
Quy tắc bắt buộc:
- Viết theo PHONG CÁCH được yêu cầu trong tin nhắn. Mỗi lần viết phải khác hẳn các lần trước (đổi câu móc, đổi cách so sánh, đổi nhịp câu). Không mở đầu nhiều câu giống nhau, không lặp "chỉ … là tới …" quá 2 lần trong cả kịch bản.
- ĐỘ DÀI (bắt buộc, đếm chữ): intro tối đa 22 chữ; province tối đa 10 chữ; house tối đa 28 chữ; region tối đa 30 chữ; infra tối đa 24 chữ; outro tối đa 26 chữ; mọi cảnh khác tối đa 18 chữ. Ngắn, gọn, đắt — video ngắn nên mỗi chữ phải có giá trị.
- Chỉ dùng đúng tên và số liệu được cung cấp. Không bịa giá, diện tích, thổ cư, pháp lý, quy hoạch, thời gian đi lại, tên tiện ích. Không nhắc quận/huyện (đã bỏ từ 7/2025).
- Không tự suy ra đặc điểm không có trong dữ liệu (ví dụ "hẻm xe hơi", "xe hơi quay đầu", "mặt tiền", "view đẹp", "an ninh", "dân trí cao", "sắp tăng giá") — đùa cho vui cũng không được biến thành thông tin.
- duong_truoc_nha là BỀ RỘNG CON ĐƯỜNG trước nhà, KHÔNG phải mặt tiền hay chiều ngang lô đất. Nói "đường trước nhà rộng 8 mét".
- Diện tích đọc đủ đơn vị "mét vuông".
- Hài hước thì duyên, lịch sự, không chê bai địa phương, không phân biệt vùng miền, không đùa về tai nạn, bệnh tật, tâm linh.
- Viết khoảng cách bằng số, số thập phân dùng dấu phẩy: "450 mét", "1,2 km". Viết "Thành phố Hồ Chí Minh" thay cho "TP.HCM", "quốc lộ" thay cho "QL". Không dùng emoji, không dùng ký hiệu lạ (máy sẽ đọc to).
- DIEM_NOI_BAT (nếu có) là điểm mạnh do chính môi giới ghi — thông tin THẬT, quan trọng nhất: đưa điểm mạnh nhất vào câu móc intro, nhắc các điểm còn lại ở house hoặc outro. Được diễn đạt lại cho hay nhưng không phóng đại, không thêm chi tiết.
- KHACH_MUC_TIEU (nếu có): 'o' mua để ở → nói về cuộc sống hằng ngày, tiện lợi cho gia đình; 'dau_tu' → kết nối, hạ tầng, giá mỗi mét vuông; 'cho_thue' → gần nơi có nhiều người cần thuê (trường, khu công nghiệp, chợ…), dễ cho thuê. KHÔNG hứa lợi nhuận, không hứa tăng giá.
- gia_moi_m2 (nếu có) là giá chia diện tích, có thể dùng làm con số móc câu ("chỉ khoảng 32 triệu một mét vuông").
- Đoạn kết: tạo cảm giác khan hiếm vừa phải rồi kêu gọi đi xem nhà. Có số điện thoại liên hệ thì đọc đúng số đó; KHÔNG có thì không nhắc gì tới số điện thoại (không được đọc tên trường dữ liệu, không bịa số). Có thương hiệu thì nhắc tên. Không bao giờ đọc tên khoá/biến dữ liệu.
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

// Biên tập viên: đọc bản nháp, sửa câu yếu/lặp/quá dài/sai số liệu, trả JSON cùng khoá
const EDITOR = `Bạn là biên tập viên kịch bản video bất động sản ngắn (TikTok/Reels), tiếng Việt. Bạn nhận: dữ liệu thật, các cảnh, bản nháp lời đọc (JSON) và danh sách lỗi máy đã phát hiện.
Nhiệm vụ: trả lại bản hoàn chỉnh, hay hơn, cùng các khoá.
- Sửa HẾT lỗi trong danh sách (số liệu không có trong dữ liệu → bỏ hoặc thay bằng số đúng; quá dài → cắt gọn; chi tiết bịa → bỏ).
- Câu móc intro phải thật mạnh trong 2 giây đầu; nếu có diem_noi_bat thì dùng điểm mạnh nhất.
- Bỏ câu sáo rỗng, câu chung chung không có thông tin; mỗi cảnh một kiểu câu, không mở đầu lặp lại; giữ đúng phong cách được yêu cầu.
- Câu đã tốt thì giữ nguyên. Giữ nguyên mọi quy tắc độ dài, cách viết số, cấm suy diễn của bản gốc (đính kèm).
- Trả về đúng một đối tượng JSON, khoá giữ nguyên, không dấu ngoặc kép trong câu, không chữ nào ngoài JSON.`;

const LIMITS = { intro: 22, province: 10, house: 28, region: 30, infra: 24, outro: 26 };
const limitOf = k => LIMITS[k.split(':')[0]] || 18;
const NUM_RE = /\d+(?:[.,]\d+)*/g;
const toNum = x => {
  const t = String(x);
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return parseFloat(t.replace(/\./g, ''));
  return parseFloat(t.replace(/\./g, '').replace(',', '.'));
};
// Số trong lời đọc phải có trong dữ liệu (cho phép đổi km↔mét, làm tròn ~6%); bắt cả chi tiết hay bị bịa
function checkScript(out, facts, segments) {
  const src = JSON.stringify({ facts, segments });
  const base = [];
  for (const m of src.match(NUM_RE) || []) { const n = toNum(m); if (Number.isFinite(n)) base.push(n, n * 1000, n / 1000); }
  const okNum = x => x <= 1 || base.some(a => Math.abs(x - a) <= Math.max(0.06, a * 0.06));
  const low = src.toLowerCase();
  const BANNED = ['mặt tiền', 'hẻm xe hơi', 'xe hơi', 'ô tô đậu', 'dân trí', 'an ninh', 'view ', 'sắp tăng giá', 'chắc chắn tăng', 'lợi nhuận'];
  const issues = {};
  for (const [k, v] of Object.entries(out)) {
    const list = [];
    const words = String(v).trim().split(/\s+/).length;
    if (words > limitOf(k) + 3) list.push(`quá dài (${words} chữ, tối đa ${limitOf(k)})`);
    const phoneDigits = String(facts?.so_dien_thoai_lien_he || '').replace(/\D/g, '');
    for (const m of String(v).match(NUM_RE) || []) {
      if (phoneDigits && phoneDigits.includes(m.replace(/\D/g, ''))) continue;
      const n = toNum(m);
      if (Number.isFinite(n) && !okNum(n)) list.push(`số ${m} không có trong dữ liệu`);
    }
    for (const w of BANNED) if (String(v).toLowerCase().includes(w) && !low.includes(w.trim())) list.push(`chi tiết không có trong dữ liệu: ${w.trim()}`);
    if (list.length) issues[k] = list;
  }
  return issues;
}

// Claude (ANTHROPIC_API_KEY) hoặc Gemini (GEMINI_API_KEY, lấy ở aistudio.google.com). Có cả hai thì dùng Claude trước.
// 25/10 Giang: Sonnet 5.5 viết chính (hay hơn), Haiku 5.5 dự phòng. SCRIPT_MODEL / ANTHROPIC_MODEL ghi đè.
const MAIN_MODEL = () => env('SCRIPT_MODEL') || 'claude-sonnet-5-5';
const BACKUP_MODEL = () => { const m = env('ANTHROPIC_MODEL') || 'claude-haiku-5-5'; return m === MAIN_MODEL() ? 'claude-haiku-5-5' : m; };
async function viaClaude(key, user, model = MAIN_MODEL(), system = SYSTEM) {
  // Model 5.5 mặc định tự "suy nghĩ" trước khi trả lời, dễ dùng hết max_tokens → phần trả lời rỗng → tắt đi.
  // Model nào không nhận thinking/temperature (Sonnet 5.5 báo "temperature is deprecated") thì gửi lại không có tham số đó.
  let noThinking = true, temp = /haiku/i.test(model);
  const call = async () => {
    const res = await aiFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 6000,
        ...(temp ? { temperature: 1 } : {}),
        ...(noThinking ? { thinking: { type: 'disabled' } } : {}),
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await res.json().catch(() => null);
    return { res, j };
  };
  let { res, j } = await call();
  for (let i = 0; i < 2 && res.status === 400; i++) {
    const m = j?.error?.message || '';
    if (/thinking/i.test(m) && noThinking) noThinking = false;
    else if (/temperature/i.test(m) && temp) temp = false;
    else break;
    ({ res, j } = await call());
  }
  if (!res.ok) throw new Error('Claude: ' + (j?.error?.message || res.status));
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
  if (!text.trim()) throw new Error(`Claude trả rỗng (stop_reason=${j?.stop_reason}, loại=${(j?.content || []).map(c => c.type).join(',')})`);
  return text;
}

const GEMINI_MODELS = () => [env('GEMINI_MODEL'), 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'].filter(Boolean);
async function viaGemini(key, user, system = SYSTEM) {
  let last = null;
  for (const model of [...new Set(GEMINI_MODELS())]) {
    const res = await aiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
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
  const scenes = Object.fromEntries(keys.map(k => [k, segments[k]]));
  const user = `PHONG CÁCH: ${tone}\nGóc mở đầu lần này: ${angle} (phiên bản số ${Math.floor(Math.random() * 100000)} — viết mới hoàn toàn, không lặp lại cách viết thông thường.)\n\nDữ liệu căn nhà và khu vực:\n${JSON.stringify(facts, null, 1)}\n\nCác cảnh cần viết (khoá → hình đang hiện trên video và dữ liệu của cảnh đó):\n${JSON.stringify(scenes, null, 1)}`;
  const force = body.model === 'haiku' ? BACKUP_MODEL() : body.model === 'sonnet' ? 'claude-sonnet-5-5' : null; // chỉ để so sánh/kiểm thử
  const t0 = Date.now();
  // Một lượt viết: Claude chính → Claude dự phòng → Gemini
  const write = async (u, system) => {
    const errs = [];
    if (claude) {
      for (const m of force ? [force] : [MAIN_MODEL(), BACKUP_MODEL()]) {
        try { return { text: await viaClaude(claude, u, m, system), used: m, errs }; }
        catch (e) { errs.push(m + ': ' + String(e.message || e).slice(0, 160)); }
      }
    }
    if (gemini && !force) {
      try { return { text: await viaGemini(gemini, u, system), used: 'gemini', errs }; }
      catch (e) { errs.push('gemini: ' + String(e.message || e).slice(0, 160)); }
    }
    throw new Error(errs.join(' | ') || 'Không gọi được AI');
  };
  try {
    const first = await write(user, SYSTEM);
    const draft = parseLoose(first.text, keys);
    if (!draft) {
      console.log('script-bad', first.used, String(first.text).slice(0, 500));
      return json({ error: 'Kịch bản trả về không đúng dạng, bấm lại lần nữa', used: first.used, raw: String(first.text).slice(0, 300) }, 502);
    }
    const tidy = o => Object.fromEntries(keys.filter(k => typeof o?.[k] === 'string' && o[k].trim()).map(k => [k, o[k].trim().slice(0, 400)]));
    const d = tidy(draft);
    const issues0 = checkScript(d, facts, scenes);
    // Biên tập viên (cùng model đã viết): sửa lỗi máy phát hiện + làm câu hay hơn. Lỗi thì giữ bản nháp.
    let ed = null, edUsed = null, edErr = '';
    if (body.edit !== false) {
      try {
        const eu = `PHONG CÁCH: ${tone}\n\nQUY TẮC GỐC:\n${SYSTEM}\n\nDữ liệu thật:\n${JSON.stringify(facts, null, 1)}\n\nCác cảnh:\n${JSON.stringify(scenes, null, 1)}\n\nBản nháp:\n${JSON.stringify(d, null, 1)}\n\nLỗi máy phát hiện (phải sửa hết):\n${Object.keys(issues0).length ? JSON.stringify(issues0, null, 1) : 'không có — chỉ cần làm câu hay hơn nếu được'}`;
        const r = await (async () => {
          if (claude && first.used.startsWith('claude')) return { text: await viaClaude(claude, eu, first.used, EDITOR), used: first.used };
          return write(eu, EDITOR);
        })();
        edUsed = r.used;
        ed = tidy(parseLoose(r.text, keys) || {});
      } catch (e) { edErr = String(e.message || e).slice(0, 200); }
    }
    // Ghép: mỗi câu lấy bản biên tập nếu đạt, không thì bản nháp nếu đạt; cả hai còn lỗi số liệu → bỏ câu (app dùng câu mẫu)
    const issues1 = ed ? checkScript(ed, facts, scenes) : {};
    const badNum = l => (l || []).some(x => /^số |không có trong dữ liệu/.test(x));
    const clean = {}, dropped = [];
    for (const k of keys) {
      if (ed?.[k] && !badNum(issues1[k])) clean[k] = ed[k];
      else if (d[k] && !badNum(issues0[k])) clean[k] = d[k];
      else if (ed?.[k] || d[k]) dropped.push(k);
    }
    const meta = { model: first.used, editor: edUsed, edited: !!ed, issues: Object.keys(issues0).length, dropped, ms: Date.now() - t0, ...(first.errs.length ? { fallback: first.errs } : {}), ...(edErr ? { editor_error: edErr } : {}) };
    console.log('script-ok', JSON.stringify(meta));
    return json({ segments: clean, provider: first.used.startsWith('claude') ? 'claude' : first.used, meta, ...(body.debug ? { draft: d, draft_issues: issues0, edited_issues: issues1 } : {}) }, 200);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
