// Xuất MP4 ngay trên máy: dựng từng khung bằng canvas, mã hoá H.264 (WebCodecs), ghép tiếng AAC.
// Trình duyệt không có WebCodecs thì quay thời gian thực bằng MediaRecorder.
// Gói xuất (site/xuat.js, dựng từ js/xuat-entry.js): Mediabunny + bộ mã hoá AAC WebAssembly, chỉ tải khi xuất
const XUAT_URL = new URL('xuat.js', document.baseURI).href;
let xuatMod = null;
async function loadXuat() {
  if (!xuatMod) {
    xuatMod = await import(/* @vite-ignore */ XUAT_URL);
    // Luôn dùng AAC WebAssembly: giống nhau trên mọi máy, không phụ thuộc trình duyệt điện thoại
    xuatMod.registerAacEncoder();
  }
  return xuatMod;
}
import { render, collectTiles } from './render.js';
import { scheduleSfx } from './sfx.js';

const SR = 48000;

export async function decodeAudioFile(file) {
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(2, SR, SR);
  return await ctx.decodeAudioData(buf);
}

// Trộn nhạc nền + giọng đọc (file ghi âm hoặc giọng AI từng đoạn) + SFX thành một dải tiếng dài đúng bằng video
export async function mixAudio({ music, voice, voiceSegs = [], sfx = null, duration, musicVol = 0.8, voiceDelay = 0.8 }) {
  const hasVoice = !!voice || voiceSegs.length > 0;
  if (!music && !hasVoice && !(sfx && sfx.events?.length && sfx.vol > 0)) return null;
  const len = Math.ceil(duration * SR);
  const ctx = new OfflineAudioContext(2, len, SR);
  if (music) {
    const src = ctx.createBufferSource();
    src.buffer = music;
    src.loop = true;
    const g = ctx.createGain();
    const full = musicVol, duck = musicVol * 0.26;
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(voice ? duck : full, 0.6);
    // Giọng AI từng đoạn: nhạc nhỏ xuống khi đang đọc, to lên ở khoảng nghỉ
    for (const v of voiceSegs) {
      const a = Math.max(0.6, v.t - 0.25), b = v.t + v.buffer.duration + 0.15;
      g.gain.setTargetAtTime(duck, a, 0.08);
      g.gain.setTargetAtTime(full, b, 0.25);
    }
    g.gain.setTargetAtTime(0, Math.max(0.7, duration - 1.6), 0.35);
    src.connect(g).connect(ctx.destination);
    src.start(0);
  }
  if (voice) {
    const src = ctx.createBufferSource();
    src.buffer = voice;
    src.connect(ctx.destination);
    src.start(voiceDelay);
  }
  for (const v of voiceSegs) {
    const src = ctx.createBufferSource();
    src.buffer = v.buffer;
    const g = ctx.createGain();
    g.gain.value = 1.05;
    src.connect(g).connect(ctx.destination);
    src.start(Math.max(0, v.t));
  }
  if (sfx && sfx.events?.length && sfx.vol > 0) scheduleSfx(ctx, sfx.events, sfx.vol * (hasVoice ? 0.75 : 1));
  return await ctx.startRendering();
}

export async function preloadTiles(tl, scale, cache, onProgress, signal) {
  const list = collectTiles(tl, scale);
  let done = 0;
  onProgress?.(0, list.length);
  await Promise.all(list.map(([z, x, y]) => cache.request(z, x, y).then(() => {
    done++;
    if (!signal?.aborted) onProgress?.(done, list.length);
  })));
  return list.length;
}

// Bitrate cao: ảnh vệ tinh + máy lia liên tục rất nhiều chi tiết; 0,1 bit/điểm ảnh (~6 Mbps ở 1080p) làm video nhoè,
// lên Zalo/Facebook bị nén thêm lần nữa càng mờ. 0,23 bit/điểm ảnh ≈ 14 Mbps ở 1080p (khách góp ý 24/10).
const BPP = 0.23;
async function pickVideoCodec(w, h, fps) {
  const bitrate = Math.round(w * h * fps * BPP);
  const tries = [['avc', 'avc1.640028'], ['avc', 'avc1.4d0028'], ['avc', 'avc1.42e028'], ['avc', 'avc1.640032'], ['avc', 'avc1.42e032'],
    // Máy tính không có H.264 (Linux): dùng VP9 trong MP4 (điện thoại luôn có H.264)
    ['vp9', 'vp09.00.40.08']];
  for (const [kind, codec] of tries) {
    const base = { codec, width: w, height: h, bitrate, framerate: fps, ...(kind === 'avc' ? { avc: { format: 'avc' } } : {}) };
    // Ưu tiên chế độ chất lượng (mã hoá kỹ hơn, không ép thời gian thực); máy không nhận thì bỏ dần tuỳ chọn
    for (const cfg of [{ ...base, latencyMode: 'quality', bitrateMode: 'variable' }, { ...base, latencyMode: 'quality' }, base]) {
      try {
        const s = await VideoEncoder.isConfigSupported(cfg);
        if (s.supported) return { cfg, kind };
      } catch { /* thử cấu hình khác */ }
    }
  }
  return null;
}

// AudioContext phải được tạo/mở khoá ngay trong cú bấm của khách (iPhone chặn âm thanh nếu tạo sau đó).
// Gọi hàm này đồng bộ ở đầu nút Xuất video, truyền kết quả vào exportRealtime.
export function unlockAudioContext() {
  try {
    const ctx = new AudioContext({ sampleRate: SR });
    ctx.resume().catch(() => {});
    // Phát một mẫu im lặng để iOS chắc chắn mở khoá
    const b = ctx.createBuffer(1, 1, SR);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
    return ctx;
  } catch { return null; }
}

// Chỉnh màu lúc xuất: video H.264 phát trên iPhone/Zalo/Facebook thường bạc màu, thiếu tương phản so với xem trên máy.
// Dựng khung vào canvas phụ rồi vẽ sang canvas mã hoá qua bộ lọc nhẹ để bù (xem trước trong app không đổi).
const PHONE_GRADE = 'contrast(1.07) saturate(1.14) brightness(1.01)';
function gradedRenderer(width, height) {
  const out = document.createElement('canvas');
  out.width = width; out.height = height;
  const octx = out.getContext('2d', { alpha: false });
  let src = null, sctx = null, ok = false;
  try { octx.filter = PHONE_GRADE; ok = octx.filter === PHONE_GRADE; octx.filter = 'none'; } catch { ok = false; }
  if (ok) {
    src = document.createElement('canvas');
    src.width = width; src.height = height;
    sctx = src.getContext('2d', { alpha: false });
  }
  return {
    canvas: out,
    draw(tl, t, opts) {
      if (!ok) { render(octx, tl, t, opts); return; }
      render(sctx, tl, t, opts);
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.filter = PHONE_GRADE;
      octx.drawImage(src, 0, 0);
      octx.filter = 'none';
    },
  };
}

export function canEncodeMp4() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function exportMp4({ tl, width, height, fps = 30, cache, audioBuffer, onProgress, signal, prepFrame = null }) {
  const scale = width / tl.LW;
  const pv = await pickVideoCodec(width, height, fps);
  if (!pv) throw new Error('Máy này không mã hoá được video ở độ phân giải ' + width + 'x' + height + '. Thử chất lượng 720p.');
  let MB;
  try { MB = await loadXuat(); }
  catch { throw Object.assign(new Error('Không tải được bộ xuất video, kiểm tra mạng rồi thử lại.'), { code: 'NO_MUXER' }); }

  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
  const vsrc = new MB.EncodedVideoPacketSource(pv.kind);
  output.addVideoTrack(vsrc, { frameRate: fps });
  let asrc = null;
  if (audioBuffer) {
    asrc = new MB.AudioBufferSource({ codec: 'aac', bitrate: 160000 });
    output.addAudioTrack(asrc);
  }
  await output.start();

  // Gói video phải đưa vào theo đúng thứ tự: xếp hàng bằng một chuỗi promise
  let chain = Promise.resolve();
  let encErr = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      // Ghi rõ hệ màu BT.709 vào file để điện thoại không đoán sai (đoán sai → màu lệch/bạc)
      if (meta?.decoderConfig && !meta.decoderConfig.colorSpace?.matrix) {
        meta = { ...meta, decoderConfig: { ...meta.decoderConfig, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } } };
      }
      chain = chain.then(() => vsrc.add(MB.EncodedPacket.fromEncodedChunk(chunk), meta)).catch(e => { encErr = encErr || e; });
    },
    error: e => { encErr = e; },
  });
  venc.configure(pv.cfg);

  const gr = gradedRenderer(width, height);
  const canvas = gr.canvas;
  const frames = Math.round(tl.duration * fps);
  const us = 1e6 / fps;
  try {
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new DOMException('Đã huỷ', 'AbortError');
      if (encErr) throw encErr;
      // Video thực tế: tua đúng khung hình trong file trước khi vẽ (chỉ ở các cảnh có video)
      const pf = prepFrame && prepFrame(i / fps);
      if (pf) await pf;
      gr.draw(tl, i / fps, { cache, scale, request: false });
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      if (venc.encodeQueueSize > 6) {
        await new Promise(r => {
          const check = () => (venc.encodeQueueSize <= 3 ? r() : setTimeout(check, 4));
          check();
        });
      }
      if (i % 3 === 0) {
        onProgress?.('frames', i + 1, frames);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    await venc.flush();
  } catch (e) {
    try { venc.close(); } catch { /* đã đóng */ }
    try { await output.cancel(); } catch { /* bỏ qua */ }
    throw e;
  }
  venc.close();
  await chain;
  if (encErr) throw encErr;
  vsrc.close();

  if (asrc) {
    onProgress?.('audio', 0, 1);
    // Cắt đúng bằng thời lượng video rồi mã hoá AAC (WebAssembly)
    const total = Math.min(audioBuffer.length, Math.round(tl.duration * SR));
    let buf = audioBuffer;
    if (total < audioBuffer.length || audioBuffer.numberOfChannels !== 2) {
      buf = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: audioBuffer.sampleRate });
      const L = audioBuffer.getChannelData(0), R = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : L;
      buf.copyToChannel(L.subarray(0, total), 0);
      buf.copyToChannel(R.subarray(0, total), 1);
    }
    await asrc.add(buf);
    asrc.close();
  }

  await output.finalize();
  onProgress?.('done', 1, 1);
  const out = output.target.buffer;
  // Tự kiểm tra: có tiếng mà file không có luồng âm thanh thì báo lỗi thay vì đưa file câm cho khách
  if (audioBuffer && !hasAudioTrack(new Uint8Array(out))) {
    throw Object.assign(new Error('File xuất bị thiếu âm thanh'), { code: 'NO_AUDIO_ENCODER' });
  }
  return new Blob([out], { type: 'video/mp4' });
}

// Tìm hộp 'mp4a' (âm thanh AAC) trong file MP4
function hasAudioTrack(b) {
  for (let i = 0; i + 4 < b.length; i++) {
    if (b[i] === 0x6d && b[i + 1] === 0x70 && b[i + 2] === 0x34 && b[i + 3] === 0x61) return true;
  }
  return false;
}

// Dự phòng: phát thời gian thực và ghi lại canvas
export async function exportRealtime({ tl, width, height, fps = 30, cache, audioBuffer, audioCtx = null, onProgress, signal, onTick = null }) {
  const scale = width / tl.LW;
  const gr = gradedRenderer(width, height);
  const canvas = gr.canvas;
  gr.draw(tl, 0, { cache, scale });
  const stream = canvas.captureStream(fps);
  let actx = null, src = null, ownCtx = false;
  if (audioBuffer) {
    actx = audioCtx && audioCtx.state !== 'closed' ? audioCtx : (ownCtx = true, new AudioContext({ sampleRate: SR }));
    try { await actx.resume(); } catch { /* xử lý bên dưới */ }
    if (actx.state !== 'running') {
      throw Object.assign(new Error('Trình duyệt đang chặn âm thanh. Bấm Xuất video lại một lần nữa (không bị trừ thêm lượt).'), { code: 'AUDIO_BLOCKED' });
    }
    const dest = actx.createMediaStreamDestination();
    src = actx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(dest);
    dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
  }
  // Ưu tiên MP4 có AAC (phát được trên iPhone, Zalo, Facebook); WebM chỉ là đường cuối
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 160_000 });
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => (rec.onstop = r));
  rec.start(500);
  // Hình và tiếng bắt đầu cùng lúc với lúc ghi
  src?.start();
  const t0 = performance.now();
  try {
    await new Promise((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted) { reject(new DOMException('Đã huỷ', 'AbortError')); return; }
        const t = (performance.now() - t0) / 1000;
        onTick?.(Math.min(t, tl.duration));
        gr.draw(tl, Math.min(t, tl.duration), { cache, scale });
        onProgress?.('frames', Math.min(t, tl.duration), tl.duration);
        if (t >= tl.duration) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    try { src?.stop(); } catch { /* đã dừng */ }
  }
  await stopped;
  if (ownCtx) actx?.close();
  const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
  return new Blob(chunks, { type });
}
