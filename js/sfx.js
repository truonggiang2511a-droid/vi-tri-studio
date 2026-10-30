// Hiệu ứng âm thanh tổng hợp ngay trong trình duyệt (không cần file): whoosh khi lia máy,
// lấp lánh khi vẽ line, "pop" khi hiện thẻ, "ding" khi ghim tiện ích, tiếng chạm khi thả ghim nhà.

// Danh sách sự kiện âm thanh theo kịch bản dựng
export function sfxEvents(tl) {
  const ev = [];
  const add = (t, kind, gain, dur) => { if (t >= 0 && t < tl.duration) ev.push({ t, kind, gain, dur }); };
  const ph = tl.phases;
  for (let i = 0; i < ph.length; i++) {
    const p = ph[i], d = p.t1 - p.t0;
    switch (p.type) {
      case 'intro': {
        const i0 = p.t0 + (p.hold || 0);
        // Mở màn có lực (24/10): tiếng nổ trầm ngay giây đầu cùng lúc thẻ giá bật lên, rồi whoosh bay vào bản đồ
        if (p.hookLen) { add(p.t0 + 0.02, 'impact', 0.95); add(p.t0 + 0.05, 'pop', 0.45); }
        add(p.t0 + (p.hookLen ? 0.12 : 0.25), 'whoosh', 0.7, 1.6);
        if (p.hookLen) add(p.t0 + p.hookLen - 0.3, 'whoosh', 0.5, 1.2); // thẻ giá rút đi
        // Ghim bất động sản rơi xuống (cùng thời điểm với hình trong render.js): tiếng rơi + chạm đất + "pop"
        if (tl.provPh || tl.scene.adminArea) {
          const drop = i0 + (p.t1 - i0) * 0.72; // khớp dropAt trong render.js
          add(drop, 'fall', 0.5);
          add(drop + 0.27, 'thud', 1);
          add(drop + 0.3, 'pop', 0.5);
        }
        break;
      }
      case 'province':
        add(p.t0, 'whoosh', 0.75, 1.7); // lùi ra xa thấy cả tỉnh
        break;
      case 'house':
        add(p.t0, 'whoosh', 0.7, 1.5); // bay vào cận cảnh căn nhà
        if (!(tl.provPh || tl.scene.adminArea)) { add(p.t0, 'fall', 0.5); add(p.t0 + 0.27, 'thud', 1); add(p.t0 + 0.3, 'pop', 0.5); }
        break;
      case 'overview':
        add(p.t0, 'whoosh', 0.7, 1.5);
        break;
      case 'road':
        add(p.t0, 'whoosh', p.road === 0 ? 0.42 : 0.32, 1.1); // mỗi trục một cú máy riêng (24/10 tối)
        add(p.t0 + 0.12 * d, 'shimmer', 0.42, 0.68 * d);
        add(p.t0 + 0.5 * d, 'pop', 0.5);
        break;
      case 'radar':
        add(p.t0, 'whoosh', 0.65, 1.4);
        break;
      case 'photos':
        add(p.t0, 'whoosh', 0.6, 1.2);
        break;
      case 'iso': // 3 vùng lái xe lan ra lần lượt (khớp isoReveal trong render.js: 0,14 + 0,2 × thứ tự)
        add(p.t0, 'whoosh', 0.6, 1.3);
        for (let k = 0; k < 3; k++) { add(p.t0 + d * (0.14 + 0.2 * k), 'shimmer', 0.3, 0.9); add(p.t0 + d * (0.14 + 0.2 * k) + 0.5, 'pop', 0.35); }
        break;
      case 'region': { // mỗi điểm mốc một cú máy: whoosh bay tới, lấp lánh khi line chạy, pop khi tới (khớp hubReveal/camShots)
        for (const sh of p.shots || []) {
          const s0 = p.t0 + d * sh.s, sw = d * (sh.e - sh.s);
          add(s0 + 0.02, 'whoosh', sh.recap ? 0.6 : 0.5, sh.recap ? 1.4 : 1.1);
          if (sh.anchor !== undefined) {
            add(s0 + 0.04 * sw, 'shimmer', 0.26, (sh.move - 0.04) * sw);
            add(s0 + sh.move * sw, 'pop', 0.42);
          }
        }
        break;
      }
      case 'infra': { // đáp cận tuyến (whoosh), lia dọc tuyến (lấp lánh), thẻ hiện thì "ding"; cuối lùi ra toàn cảnh
        for (const sh of p.shots || []) {
          const s0 = p.t0 + d * sh.s, sw = d * (sh.e - sh.s);
          if (sh.part === 'a') { add(s0 + 0.02, 'whoosh', 0.5, 1.1); add(s0 + 0.25 * sw, 'shimmer', 0.3, sw * 1.2); add(s0 + 0.55 * sw, 'ding', 0.4); }
          if (sh.recap) add(s0 + 0.02, 'whoosh', 0.55, 1.3);
        }
        break;
      }
      case 'front': // video mặt tiền mở đầu: nổ trầm + pop khi thẻ giá bật, whoosh khi chuyển vào bản đồ
        if (p.hookLen) { add(p.t0 + 0.02, 'impact', 0.95); add(p.t0 + 0.05, 'pop', 0.45); add(p.t0 + p.hookLen - 0.3, 'whoosh', 0.5, 1.2); }
        add(p.t1 - 0.35, 'whoosh', 0.6, 1.3);
        break;
      case 'clip': // video thực tế lồng vào giữa: lướt vào, lướt ra (khớp drawClips trong render.js)
        add(p.t0, 'whoosh', 0.55, 1.1);
        add(p.t1 - 0.25, 'whoosh', 0.35, 0.9);
        break;
      case 'boundary':
        add(p.t0, 'whoosh', 0.65, 1.4);
        add(p.t0 + 0.16 * d, 'shimmer', 0.42, 0.44 * d);
        add(p.t0 + 0.48 * d, 'thud', 0.55);
        add(p.t0 + 0.56 * d, 'shimmer', 0.25, 0.24 * d);
        add(p.t0 + 0.62 * d, 'pop', 0.4);
        add(p.t0 + 0.74 * d, 'ding', 0.5);
        break;
      case 'poi':
        add(p.t0, 'whoosh', 0.36, 1.1);
        add(p.t0 + 0.14 * d, 'shimmer', 0.26, 0.46 * d);
        add(p.t0 + 0.55 * d, 'ding', 0.5);
        add(p.t0 + 0.6 * d, 'pop', 0.3);
        break;
      case 'summary': {
        add(p.t0, 'whoosh', 0.65, 1.4);
        const rows = Math.min(6, tl.pois.length + (tl.boundary ? 1 : 0));
        for (let r = 0; r < rows; r++) add(p.t0 + 0.3 * d + 0.9 * (r * 0.12) / 2.2 + 0.25, 'tick', 0.22);
        break;
      }
      case 'outro':
        add(p.t0, 'whoosh', 0.65, 1.3);
        if (tl.scene.brand) add(p.t0 + 0.8, 'ding', 0.45);
        break;
    }
  }
  // Từ khoá bật lên theo giọng đọc (chữ động): "pop" khi bật, giá thêm tiếng "ding" sáng (khớp tl.keyPops trong render.js)
  // Mẫu 1 (Hook Kit, kit/docs/mau1.md "SFX" — thưa, tự nhiên): mỗi cụm CHỈ 1 tiếng lúc từ khoá chạm (0,1 + 0,2 s sau khi bật),
  // đổi lk_a ↔ lk_b; icon không tiếng; phụ đề CHỈ gõ phím ở đầu dòng, cách nhau ≥ 2,5 s, nhường 0,6 s quanh tiếng cụm chữ.
  // 30/10 Giang: nhỏ lại một chút (cụm chữ 0,85 → 0,6; gõ phím 0,8 → 0,5)
  const m1 = tl.scene?.keyLook === 'mau1';
  const lkAt = [];
  (tl.keyPops || []).forEach((k, i) => {
    // 30/10 11:30 Giang: tiếng dài hơn (thêm đuôi vang), bắt đầu ngay lúc cụm hiện ra để cả lúc rơi xuống + chạm đều có tiếng
    if (m1) { add(k.t + 0.1, i % 2 ? 'lk_b' : 'lk_a', 0.6); lkAt.push(k.t + 0.3); return; }
    add(k.t + 0.02, 'pop', k.kind === 'price' ? 0.6 : 0.42);
    if (k.kind === 'price') add(k.t + 0.12, 'ding', 0.4);
  });
  if (m1) {
    let lastKey = -9, n = 0;
    for (const c of tl.captions || []) {
      if (!c.m1) continue;
      const t = c.words?.[0]?.t ?? c.t0;
      if (t - lastKey < 2.5 || lkAt.some(x => Math.abs(x - t) < 0.6)) continue;
      // phụ đề đang ẩn vì cụm chữ đứng ở chỗ phụ đề (render.js m1CapHide) → không gõ phím
      if ((tl.keyPops || []).some(k => t > k.t - 0.1 && t < k.t + k.dur)) continue;
      add(t, 'key' + (n++ % 6 + 1), 0.5);
      lastKey = t;
    }
  }
  // Radar quét bán kính: tiếng "ping" sonar mỗi vòng quét + tiếng ù radar quay vòng.
  // Thời điểm khớp với tia quét trong render.js (bắt đầu ở hướng 12 giờ, 1,25 giây một vòng)
  const ov = ph.find(x => x.type === 'overview'), rp = ph.find(x => x.type === 'radar'), sm = ph.find(x => x.type === 'summary');
  const sweeps = [];
  if (ov) sweeps.push([ov.t0 + 0.3 * (ov.t1 - ov.t0), ov.t1 + 0.3]);
  if (rp) sweeps.push([rp.t0, rp.t1 + 0.6]);
  if (sm) sweeps.push([sm.t0 + 0.2, Math.min(sm.t1, sm.t0 + 3.2)]);
  // 23/10: Giang thấy tiếng radar (ping sonar + ù) chói tai → bỏ, không phát gì khi radar quét. Giữ hàm âm để dùng lại nếu cần.
  void sweeps;
  return ev.sort((a, b) => a.t - b.t);
}

let noiseCache = new WeakMap();
function noise(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = seed / 0x3fffffff - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}

function noiseSrc(ctx, t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur + 0.05);
  return s;
}

function env(ctx, t, peak, a, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

function panner(ctx, from, to, t, dur) {
  if (!ctx.createStereoPanner) return ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.setValueAtTime(from, t);
  p.pan.linearRampToValueAtTime(to, t + dur);
  return p;
}

const SYNTH = {
  whoosh(ctx, out, t, g, dur = 1) {
    const s = noiseSrc(ctx, t, dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.5);
    f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const e = env(ctx, t, g, dur * 0.45, dur);
    const p = panner(ctx, -0.5, 0.5, t, dur);
    s.connect(f).connect(e).connect(p).connect(out);
    // lớp gió trầm (thân tiếng gió lùa) cho dày tiếng, nghe rõ cả khi có nhạc nền
    const s2 = noiseSrc(ctx, t, dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(1100, t + dur * 0.5);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    s2.connect(lp).connect(env(ctx, t, g * 0.9, dur * 0.5, dur)).connect(panner(ctx, 0.4, -0.4, t, dur)).connect(out);
  },
  // "ping" sonar: tiếng chuông kim loại trong + vang lặp lại nhỏ dần (như màn hình radar)
  sonar(ctx, out, t, g) {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.23;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    delay.connect(lp).connect(fb).connect(delay);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    lp.connect(wet).connect(out);
    [[1046.5, 1, 1.1], [2093, 0.22, 0.5], [1568, 0.12, 0.7]].forEach(([f, a, dec]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.02, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      const e = env(ctx, t, g * a * 0.55, 0.004, dec);
      o.connect(e); e.connect(out); e.connect(delay);
      o.start(t); o.stop(t + dec + 0.05);
    });
  },
  // tiếng ù radar: nền trầm có nhịp đập theo vòng quét, kêu "vù" lướt từ trái sang phải
  radarHum(ctx, out, t, g, dur = 3) {
    dur = Math.max(0.5, Math.min(12, dur));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 4;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.8; // 1 vòng quét = 1,25 s
    const lfoG = ctx.createGain(); lfoG.gain.value = 380;
    lfo.connect(lfoG).connect(lp.frequency);
    const mix = ctx.createGain();
    mix.gain.setValueAtTime(0.0001, t);
    mix.gain.exponentialRampToValueAtTime(g * 0.22, t + 0.35);
    mix.gain.setValueAtTime(g * 0.22, t + Math.max(0.36, dur - 0.4));
    mix.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [f, type, a] of [[55, 'sawtooth', 0.6], [110.5, 'triangle', 0.4]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = a;
      o.connect(og).connect(lp);
      o.start(t); o.stop(t + dur + 0.05);
    }
    // tiếng gió quét theo tia radar
    const s = noiseSrc(ctx, t, dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3; bp.frequency.value = 1800;
    const nG = ctx.createGain(); nG.gain.value = 0.35;
    const lfo2 = ctx.createGain(); lfo2.gain.value = 0.3;
    lfo.connect(lfo2).connect(nG.gain);
    s.connect(bp).connect(nG).connect(lp);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) { const pl = ctx.createGain(); pl.gain.value = 0.7; lfo.connect(pl).connect(pan.pan); }
    lp.connect(mix).connect(pan).connect(out);
    lfo.start(t); lfo.stop(t + dur + 0.05);
  },
  // ghim rơi xuống: tiếng huýt trượt từ cao xuống thấp
  fall(ctx, out, t, g) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(320, t + 0.27);
    o.connect(env(ctx, t, g * 0.4, 0.03, 0.3)).connect(out);
    o.start(t); o.stop(t + 0.32);
  },
  riser(ctx, out, t, g, dur = 1.8) {
    const s = noiseSrc(ctx, t, dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(4200, t + dur);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(g, t + dur * 0.95);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    s.connect(f).connect(e).connect(out);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(440, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(g * 0.12, t + dur * 0.9);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    o.connect(lp).connect(og).connect(out);
    o.start(t); o.stop(t + dur + 0.1);
  },
  thud(ctx, out, t, g) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.25);
    const e = env(ctx, t, g, 0.006, 0.42);
    o.connect(e).connect(out);
    o.start(t); o.stop(t + 0.5);
    const s = noiseSrc(ctx, t, 0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    s.connect(lp).connect(env(ctx, t, g * 0.5, 0.004, 0.12)).connect(out);
  },
  // Tiếng nổ trầm mở màn kiểu trailer: sub hạ cao độ + tiếng nổ lọc thấp có đuôi vang
  impact(ctx, out, t, g) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.9);
    o.connect(env(ctx, t, g, 0.008, 1.4)).connect(out);
    o.start(t); o.stop(t + 1.5);
    const s = noiseSrc(ctx, t, 1.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 1.0);
    s.connect(lp).connect(env(ctx, t, g * 0.55, 0.004, 1.0)).connect(out);
  },
  pop(ctx, out, t, g) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1150, t);
    o.frequency.exponentialRampToValueAtTime(380, t + 0.09);
    o.connect(env(ctx, t, g, 0.004, 0.14)).connect(out);
    o.start(t); o.stop(t + 0.18);
    const s = noiseSrc(ctx, t, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    s.connect(hp).connect(env(ctx, t, g * 0.25, 0.002, 0.03)).connect(out);
  },
  ding(ctx, out, t, g) {
    const base = 1318.5;
    [[1, 1, 1.2], [2.4, 0.32, 0.7], [3.9, 0.16, 0.45]].forEach(([m, a, dec]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * m;
      o.connect(env(ctx, t, g * a * 0.6, 0.004, dec)).connect(out);
      o.start(t); o.stop(t + dec + 0.05);
    });
  },
  shimmer(ctx, out, t, g, dur = 1.2) {
    dur = Math.max(0.4, Math.min(3, dur));
    const s = noiseSrc(ctx, t, dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3800;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(g * 0.5, t + dur * 0.35);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(hp).connect(e).connect(panner(ctx, -0.3, 0.3, t, dur)).connect(out);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(700, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(g * 0.06, t + dur * 0.4);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  },
  tick(ctx, out, t, g) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2100;
    o.connect(env(ctx, t, g, 0.002, 0.05)).connect(out);
    o.start(t); o.stop(t + 0.07);
  },
};

// Lên lịch toàn bộ SFX vào một AudioContext (thường là OfflineAudioContext để trộn)
export function scheduleSfx(ctx, events, vol = 0.7) {
  if (!events?.length || vol <= 0) return;
  const master = ctx.createGain();
  master.gain.value = vol;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  for (const e of events) {
    if (SYNTH[e.kind]) SYNTH[e.kind](ctx, master, e.t, e.gain, e.dur);
    else if (SAMPLES[e.kind]) {
      const src = ctx.createBufferSource(); src.buffer = SAMPLES[e.kind];
      const g = ctx.createGain(); g.gain.value = e.gain;
      src.connect(g).connect(master); src.start(Math.max(0, e.t));
    } else if (/^lk_/.test(e.kind)) SYNTH.pop(ctx, master, e.t, e.gain * 0.6); // chưa tải được tiếng gốc → pop tổng hợp
    else if (/^key\d$/.test(e.kind) && SYNTH.tick) SYNTH.tick(ctx, master, e.t, e.gain * 0.5);
  }
}
// Tiếng thu sẵn (AudioBuffer dùng chung mọi AudioContext): lk_a, lk_b, key1..key6 của mẫu 1 — app tải khi bật mẫu 1 (setSfxSample)
const SAMPLES = {};
export function setSfxSample(name, buf) { if (buf) SAMPLES[name] = buf; }
export const hasSfxSample = name => !!SAMPLES[name];
