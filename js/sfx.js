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
      case 'intro':
        add(0.25, 'whoosh', 0.45, 1.6);
        add(Math.max(0.5, p.t1 - 1.8), 'riser', 0.32, 1.8);
        break;
      case 'house':
        add(p.t0 + 0.27, 'thud', 0.9);
        add(p.t0 + 0.5, 'pop', 0.45);
        break;
      case 'overview':
        add(p.t0, 'whoosh', 0.5, 1.4);
        add(p.t0 + 0.3 * d, 'shimmer', 0.3, 0.6 * d);
        break;
      case 'road':
        if (p.road === 0) add(p.t0, 'whoosh', 0.42, 1.2);
        add(p.t0 + 0.12 * d, 'shimmer', 0.42, 0.68 * d);
        add(p.t0 + 0.5 * d, 'pop', 0.5);
        break;
      case 'boundary':
        add(p.t0, 'whoosh', 0.5, 1.4);
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
        add(p.t0, 'whoosh', 0.42, 1.2);
        const rows = Math.min(6, tl.pois.length + (tl.boundary ? 1 : 0));
        for (let r = 0; r < rows; r++) add(p.t0 + 0.3 * d + 0.9 * (r * 0.12) / 2.2 + 0.25, 'tick', 0.22);
        break;
      }
      case 'outro':
        add(p.t0, 'whoosh', 0.42, 1.2);
        if (tl.scene.brand) add(p.t0 + 0.8, 'ding', 0.45);
        break;
    }
  }
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
  for (const e of events) SYNTH[e.kind]?.(ctx, master, e.t, e.gain, e.dur);
}
