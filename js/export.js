// Xuất MP4 ngay trên máy: dựng từng khung bằng canvas, mã hoá H.264 (WebCodecs), ghép tiếng AAC.
// Trình duyệt không có WebCodecs thì quay thời gian thực bằng MediaRecorder.
const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs';
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

async function pickVideoCodec(w, h, fps) {
  const bitrate = Math.round(w * h * fps * 0.1);
  const tries = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032', 'avc1.42e032'];
  for (const codec of tries) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' } };
    try {
      const s = await VideoEncoder.isConfigSupported(cfg);
      if (s.supported) return cfg;
    } catch { /* thử mã khác */ }
  }
  return null;
}

// Chỉ dùng AAC cho file MP4. Opus đóng trong MP4 phát được trên Chrome nhưng iPhone (Ảnh), Zalo, Facebook,
// CapCut… thường phát MẤT TIẾNG — đây là lỗi khách gặp: xem trước có nhạc/giọng, file xuất ra không có.
// Máy không mã hoá được AAC thì báo NO_AUDIO_ENCODER để chuyển sang quay thời gian thực (giữ được tiếng).
async function pickAudioCodec() {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  const cfg = { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 160000 };
  try {
    const s = await AudioEncoder.isConfigSupported(cfg);
    if (s.supported) return { cfg, mux: 'aac' };
  } catch { /* không hỗ trợ */ }
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

export function canEncodeMp4() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function exportMp4({ tl, width, height, fps = 30, cache, audioBuffer, onProgress, signal }) {
  const scale = width / tl.LW;
  const vcfg = await pickVideoCodec(width, height, fps);
  if (!vcfg) throw new Error('Máy này không mã hoá được H.264 ở độ phân giải ' + width + 'x' + height + '. Thử chất lượng 720p.');
  const acodec = audioBuffer ? await pickAudioCodec() : null;
  if (audioBuffer && !acodec) throw Object.assign(new Error('Máy không mã hoá được âm thanh'), { code: 'NO_AUDIO_ENCODER' });

  const { Muxer, ArrayBufferTarget } = await import(/* @vite-ignore */ MUXER_URL);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: acodec ? { codec: acodec.mux, numberOfChannels: 2, sampleRate: SR } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encErr = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { encErr = e; },
  });
  venc.configure(vcfg);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  const frames = Math.round(tl.duration * fps);
  const us = 1e6 / fps;
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) { venc.close(); throw new DOMException('Đã huỷ', 'AbortError'); }
    if (encErr) throw encErr;
    render(ctx, tl, i / fps, { cache, scale, request: false });
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
  venc.close();
  if (encErr) throw encErr;

  if (acodec && audioBuffer) {
    onProgress?.('audio', 0, 1);
    let aErr = null;
    let aChunks = 0;
    const aenc = new AudioEncoder({
      output: (chunk, meta) => { aChunks++; muxer.addAudioChunk(chunk, meta); },
      error: e => { aErr = e; },
    });
    aenc.configure(acodec.cfg);
    const total = Math.min(audioBuffer.length, Math.round(tl.duration * SR));
    const L = audioBuffer.getChannelData(0);
    const R = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : L;
    const CH = 4096;
    for (let off = 0; off < total; off += CH) {
      const n = Math.min(CH, total - off);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / SR * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
    if (aErr) throw aErr;
    // Bộ mã hoá báo hỗ trợ nhưng không ra dữ liệu (gặp trên vài máy Android): không trả file câm, chuyển sang quay thời gian thực
    if (!aChunks) throw Object.assign(new Error('Không ghép được âm thanh'), { code: 'NO_AUDIO_ENCODER' });
  }

  muxer.finalize();
  onProgress?.('done', 1, 1);
  return new Blob([target.buffer], { type: 'video/mp4' });
}

// Dự phòng: phát thời gian thực và ghi lại canvas
export async function exportRealtime({ tl, width, height, fps = 30, cache, audioBuffer, audioCtx = null, onProgress, signal }) {
  const scale = width / tl.LW;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  render(ctx, tl, 0, { cache, scale });
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
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
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
        render(ctx, tl, Math.min(t, tl.duration), { cache, scale });
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
