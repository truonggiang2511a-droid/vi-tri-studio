#!/usr/bin/env python3
"""Soạn các bản nhạc nền lặp liền mạch cho Vị Trí Studio (tự tổng hợp từ đầu, không dùng mẫu của ai).

Chạy:  python3 tools/make_music.py music
Ra:    music/<tên>.wav  (sau đó build.sh / lệnh ffmpeg đổi sang .m4a)
"""
import os
import sys
import numpy as np
from scipy.signal import fftconvolve, lfilter, butter, sosfilt

SR = 44100
RNG = np.random.default_rng(7)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env_adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    e = np.full(n, s, dtype=np.float64)
    if a:
        e[:min(a, n)] = np.linspace(0, 1, a)[:min(a, n)]
    if d and a < n:
        seg = np.linspace(1, s, d)
        e[a:a + d] = seg[:max(0, min(d, n - a))]
    if r:
        tail = min(r, n)
        e[n - tail:] *= np.linspace(1, 0, tail)
    return e


def lowpass(x, fc, order=2):
    sos = butter(order, min(fc, SR * 0.45) / (SR / 2), btype='low', output='sos')
    return sosfilt(sos, x)


def highpass(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), btype='high', output='sos')
    return sosfilt(sos, x)


def bandpass(x, lo, hi, order=2):
    sos = butter(order, [lo / (SR / 2), hi / (SR / 2)], btype='band', output='sos')
    return sosfilt(sos, x)


# ---------- Nhạc cụ ----------
def piano(f, dur, vel=0.8):
    n = int((dur + 1.2) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h in range(1, 9):
        fh = f * h * (1 + 0.0004 * h * h)
        if fh > SR * 0.45:
            break
        amp = 1 / h ** 1.4
        dec = 1.2 + h * 0.85 + f / 900
        out += amp * np.sin(2 * np.pi * fh * t + RNG.random() * 0.2) * np.exp(-t * dec)
    att = np.minimum(1, t / 0.004)
    rel = np.ones(n)
    k = int(dur * SR)
    if k < n:
        rel[k:] = np.exp(-(t[k:] - dur) * 9)
    return out * att * rel * vel * 0.32


def epiano(f, dur, vel=0.8):
    n = int((dur + 1.0) * SR)
    t = np.arange(n) / SR
    idx = 0.4 + 2.2 * np.exp(-t * 3.5)
    mod = np.sin(2 * np.pi * f * t)
    car = np.sin(2 * np.pi * f * t + idx * mod)
    bell = 0.12 * np.sin(2 * np.pi * f * 14 * t) * np.exp(-t * 18)
    e = np.exp(-t * 1.1) * np.minimum(1, t / 0.003)
    k = int(dur * SR)
    if k < n:
        e[k:] *= np.exp(-(t[k:] - dur) * 7)
    return (car + bell) * e * vel * 0.3


def pluck(f, dur, vel=0.8, bright=1.0):
    n = int((dur + 0.6) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for h in range(1, 14):
        fh = f * h
        if fh > SR * 0.45:
            break
        out += (1 / h) * np.sin(2 * np.pi * fh * t) * np.exp(-t * (4 + h * 2.6 / bright))
    out *= np.minimum(1, t / 0.002)
    k = int(dur * SR)
    if k < n:
        out[k:] *= np.exp(-(t[k:] - dur) * 14)
    return out * vel * 0.28


def saw_stack(f, n, detune=(-0.09, 0, 0.11)):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for dc in detune:
        fd = f * 2 ** (dc / 12)
        ph = RNG.random() * 2 * np.pi
        for h in range(1, 24):
            if fd * h > 9000:
                break
            out += ((-1) ** (h + 1)) / h * np.sin(2 * np.pi * fd * h * t + ph * h)
    return out / len(detune)


def pad(freqs, dur, vel=0.5, cutoff=1800, attack=0.5, release=0.9):
    n = int((dur + release) * SR)
    out = np.zeros(n)
    for f in freqs:
        out += saw_stack(f, n)
    out = lowpass(out, cutoff, 2)
    out *= env_adsr(n, attack, 0.3, 0.85, release)
    return out * vel * 0.06


def bass(f, dur, vel=0.8):
    n = int((dur + 0.15) * SR)
    t = np.arange(n) / SR
    out = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    e = env_adsr(n, 0.006, 0.12, 0.7, 0.12)
    return out * e * vel * 0.32


def kick(vel=1.0):
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    f = 46 + 95 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    out = np.sin(ph) * np.exp(-t * 7.5)
    out += 0.25 * RNG.standard_normal(n) * np.exp(-t * 180)
    return np.tanh(out * 1.6) * vel * 0.55


def clap(vel=1.0):
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    noise = bandpass(RNG.standard_normal(n), 900, 4200)
    e = np.zeros(n)
    for off in (0, 0.011, 0.022):
        k = int(off * SR)
        e[k:] += np.exp(-(t[k:] - off) * (60 if off < 0.02 else 16))
    return noise * e * vel * 0.22


def snare(vel=1.0):
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    noise = highpass(RNG.standard_normal(n), 1500) * np.exp(-t * 22)
    return (0.5 * tone + noise * 0.6) * vel * 0.25


def hat(vel=1.0, open_=False):
    n = int((0.28 if open_ else 0.07) * SR)
    t = np.arange(n) / SR
    noise = highpass(RNG.standard_normal(n), 7000, 3)
    return noise * np.exp(-t * (16 if open_ else 70)) * vel * (0.05 if open_ else 0.065)


def shaker(vel=1.0):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    noise = bandpass(RNG.standard_normal(n), 4500, 11000)
    e = np.minimum(1, t / 0.02) * np.exp(-t * 40)
    return noise * e * vel * 0.07


# ---------- Dựng bài ----------
class Track:
    def __init__(self, bpm, bars, tail=3.5):
        self.bpm = bpm
        self.beat = 60 / bpm
        self.bars = bars
        self.L = int(round(bars * 4 * self.beat * SR))
        self.n = self.L + int(tail * SR)
        self.bus = {k: np.zeros((self.n, 2)) for k in ('music', 'drums', 'side')}
        self.kicks = []

    def put(self, sig, beat_pos, bus='music', pan=0.0, gain=1.0):
        i = int(round(beat_pos * self.beat * SR))
        if i >= self.n:
            return
        j = min(self.n, i + len(sig))
        l = np.cos((pan + 1) * np.pi / 4) * gain
        r = np.sin((pan + 1) * np.pi / 4) * gain
        self.bus[bus][i:j, 0] += sig[:j - i] * l * 1.414
        self.bus[bus][i:j, 1] += sig[:j - i] * r * 1.414

    def kick(self, beat_pos, vel=1.0):
        self.kicks.append(beat_pos)
        self.put(kick(vel), beat_pos, 'drums')

    def render(self, reverb=0.25, side_depth=0.55):
        # Sidechain: nhạc nền "thở" theo nhịp trống
        side = np.ones(self.n)
        for kb in self.kicks:
            i = int(round(kb * self.beat * SR))
            m = int(0.28 * SR)
            if i < self.n:
                seg = 1 - side_depth * np.exp(-np.arange(min(m, self.n - i)) / SR * 11)
                side[i:i + len(seg)] = np.minimum(side[i:i + len(seg)], seg)
        mix = self.bus['music'] + self.bus['side'] * side[:, None] + self.bus['drums']
        # Hồi âm (vang) bằng tích chập với đáp ứng xung tự tạo
        if reverb > 0:
            ir_n = int(2.4 * SR)
            t = np.arange(ir_n) / SR
            ir = RNG.standard_normal((ir_n, 2)) * np.exp(-t * 2.6)[:, None]
            ir[:, 0] = lowpass(ir[:, 0], 6000)
            ir[:, 1] = lowpass(ir[:, 1], 6000)
            ir /= np.sqrt((ir ** 2).sum(axis=0))
            wet_src = self.bus['music'] + self.bus['side'] * side[:, None] + 0.25 * self.bus['drums']
            wet = np.stack([fftconvolve(wet_src[:, c], ir[:, c])[:self.n] for c in range(2)], axis=1)
            mix = mix + wet * reverb
        # Lặp liền mạch: phần đuôi tràn qua cuối bài được cộng vào đầu bài
        out = mix[:self.L].copy()
        tail = mix[self.L:]
        k = min(len(tail), self.L)
        out[:k] += tail[:k]
        # Cắt bớt dải siêu cao cho đỡ chói khi nằm dưới giọng đọc
        out = np.stack([lowpass(out[:, c], 12500, 2) for c in range(2)], axis=1)
        # Chuẩn hoá + nén mềm
        rms = np.sqrt(np.mean(out ** 2))
        out *= 0.16 / max(rms, 1e-6)
        out = np.tanh(out * 1.1) / np.tanh(1.1)
        peak = np.max(np.abs(out))
        if peak > 0.95:
            out *= 0.95 / peak
        return out


def chord_notes(root, kind):
    iv = {'maj': (0, 4, 7), 'min': (0, 3, 7), 'maj7': (0, 4, 7, 11), 'min7': (0, 3, 7, 10),
          '7sus': (0, 5, 7, 10), 'add9': (0, 4, 7, 14), 'madd9': (0, 3, 7, 14)}[kind]
    return [root + i for i in iv]


def nhe_nhang():
    T = Track(78, 16)
    prog = [(60, 'add9'), (55, 'maj'), (57, 'min7'), (53, 'maj7')]  # C G Am F
    arp = [0, 1, 2, 3, 2, 1, 2, 3]
    for bar in range(T.bars):
        root, kind = prog[bar % 4]
        notes = chord_notes(root, kind)
        b0 = bar * 4
        T.put(pad([mtof(x - 12) for x in notes[:3]], 4 * T.beat, 0.55, 1300, 0.8, 1.2), b0, 'music', 0, 0.8)
        T.put(piano(mtof(root - 24), 3.6 * T.beat, 0.55), b0, 'music', -0.1)
        for i, a in enumerate(arp):
            nn = notes[a % len(notes)] + (12 if a >= 3 else 0)
            T.put(piano(mtof(nn), 0.5 * T.beat, 0.42 + 0.08 * (i % 2 == 0)), b0 + i * 0.5, 'music', 0.25 * np.sin(i))
        if bar >= 8:  # câu nhạc thứ hai thêm giai điệu
            mel = [notes[2] + 12, notes[1] + 12, notes[0] + 12, notes[1] + 12]
            for i, m in enumerate(mel):
                T.put(piano(mtof(m), 0.9 * T.beat, 0.5), b0 + i, 'music', 0.15)
        for i in range(8):
            T.put(shaker(0.6 + 0.4 * (i % 2)), b0 + i * 0.5, 'drums', 0.35)
    return T.render(reverb=0.38, side_depth=0)


def tuoi_sang():
    T = Track(108, 24)
    prog = [(67, 'maj'), (64, 'min'), (60, 'maj'), (62, 'maj')]  # G Em C D
    hook = [0, 2, 4, 2, 7, 4, 2, 4]
    scale = [0, 2, 4, 7, 9, 12, 14, 16]
    for bar in range(T.bars):
        root, kind = prog[bar % 4]
        notes = chord_notes(root, kind)
        b0 = bar * 4
        sec = (bar // 8) % 3
        T.put(pad([mtof(x - 12) for x in notes], 4 * T.beat, 0.45, 2200, 0.2, 0.6), b0, 'side', 0, 0.7)
        for i in range(8):
            nn = notes[(i * 2) % 3] + (12 if i % 4 == 3 else 0)
            T.put(pluck(mtof(nn), 0.45 * T.beat, 0.55, 1.2), b0 + i * 0.5, 'side', -0.3 if i % 2 else 0.3)
        for q in range(4):
            T.put(bass(mtof(root - 24), 0.45 * T.beat, 0.7), b0 + q + 0.5 * (q % 2 == 1), 'side')
            T.kick(b0 + q, 0.85)
            T.put(hat(0.6), b0 + q + 0.5, 'drums', 0.2)
        T.put(clap(0.8), b0 + 1, 'drums', -0.05)
        T.put(clap(0.8), b0 + 3, 'drums', 0.05)
        if sec == 1:
            for i, h in enumerate(hook):
                m = 67 + scale[h % len(scale)] + (0 if bar % 2 == 0 else -2)
                T.put(pluck(mtof(m + 12), 0.4 * T.beat, 0.5, 2.0), b0 + i * 0.5, 'music', 0.1)
    return T.render(reverb=0.22, side_depth=0.45)


def soi_dong():
    T = Track(124, 32)
    prog = [(57, 'min'), (53, 'maj'), (60, 'maj'), (55, 'maj')]  # Am F C G
    lead = [12, 12, 10, 7, 12, 15, 14, 12]
    for bar in range(T.bars):
        root, kind = prog[bar % 4]
        notes = chord_notes(root, kind)
        b0 = bar * 4
        sec = (bar // 8) % 4
        T.put(pad([mtof(x) for x in notes], 4 * T.beat, 0.5, 2600 if sec != 0 else 1500, 0.05, 0.4), b0, 'side', 0, 0.9)
        for q in range(4):
            T.kick(b0 + q, 1.0)
            T.put(bass(mtof(root - 24), 0.4 * T.beat, 0.8), b0 + q + 0.5, 'side')
            T.put(hat(0.7, open_=True), b0 + q + 0.5, 'drums', 0.15)
            T.put(hat(0.35), b0 + q + 0.25, 'drums', -0.2)
            T.put(hat(0.35), b0 + q + 0.75, 'drums', -0.2)
        T.put(clap(1.0), b0 + 1, 'drums')
        T.put(clap(1.0), b0 + 3, 'drums')
        if sec in (1, 3):
            for i, d in enumerate(lead):
                m = notes[0] + d + (0 if bar % 2 == 0 else -3)
                T.put(pluck(mtof(m), 0.42 * T.beat, 0.55, 2.4), b0 + i * 0.5, 'music', 0.2 if i % 2 else -0.2)
        if bar % 8 == 7:  # dồn trống cuối mỗi đoạn
            for i in range(4):
                T.put(snare(0.5 + i * 0.15), b0 + 3 + i * 0.25, 'drums')
    return T.render(reverb=0.18, side_depth=0.6)


def sang_trong():
    T = Track(72, 16)
    prog = [(62, 'maj7'), (59, 'min7'), (55, 'maj7'), (57, '7sus')]  # Dmaj7 Bm7 Gmaj7 A7sus
    for bar in range(T.bars):
        root, kind = prog[bar % 4]
        notes = chord_notes(root, kind)
        b0 = bar * 4
        T.put(pad([mtof(x - 12) for x in notes], 4 * T.beat, 0.6, 1100, 1.0, 1.4), b0, 'music', 0, 0.9)
        T.put(bass(mtof(root - 24), 3.2 * T.beat, 0.55), b0, 'music')
        T.put(bass(mtof(root - 24 + 7), 0.8 * T.beat, 0.4), b0 + 3, 'music')
        for i, p in enumerate((0, 1.5, 2.5)):
            T.put(epiano(mtof(notes[i % len(notes)] if i else notes[-1]), 1.2 * T.beat, 0.5), b0 + p, 'music', -0.25 + 0.25 * i)
        for x in notes[1:]:
            T.put(epiano(mtof(x), 1.8 * T.beat, 0.3), b0, 'music', 0.1)
        if bar >= 8:
            mel = [notes[-1] + 12, notes[2] + 12, notes[1] + 12]
            for i, m in enumerate(mel):
                T.put(epiano(mtof(m), 1.1 * T.beat, 0.42), b0 + 0.5 + i * 1.25, 'music', 0.3)
        for q in range(4):
            T.put(hat(0.25), b0 + q + 0.5, 'drums', 0.3)
            T.put(shaker(0.5), b0 + q, 'drums', -0.3)
        T.kick(b0, 0.45)
        T.put(snare(0.25), b0 + 2, 'drums')
    return T.render(reverb=0.42, side_depth=0.15)


# ---------- Nhạc cụ điện ảnh (thêm 10/2026 theo góp ý khách: cần nhạc hùng hồn, hợp kiểu video vẽ vị trí) ----------
def taiko(vel=1.0, f0=62, dec=9.0):
    """Trống lớn kiểu taiko: thân trầm hạ cao độ + tiếng da mặt trống."""
    n = int(1.1 * SR)
    t = np.arange(n) / SR
    f = f0 + f0 * 1.4 * np.exp(-t * 26)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * dec)
    body += 0.45 * np.sin(2 * np.pi * np.cumsum(f * 1.52) / SR) * np.exp(-t * dec * 1.6)
    skin = lowpass(RNG.standard_normal(n), 1800) * np.exp(-t * 38) * 0.5
    return np.tanh((body + skin) * 1.8) * vel * 0.62


def tom(f0, vel=1.0):
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = f0 * (1 + 0.6 * np.exp(-t * 30))
    out = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)
    out += lowpass(RNG.standard_normal(n), 2500) * np.exp(-t * 45) * 0.35
    return np.tanh(out * 1.4) * vel * 0.42


def boom(vel=1.0):
    """Tiếng 'bùm' trầm mở đầu đoạn (sub drop)."""
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    f = 34 + 70 * np.exp(-t * 6)
    out = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    out += lowpass(RNG.standard_normal(n), 700) * np.exp(-t * 9) * 0.6
    return np.tanh(out * 1.5) * vel * 0.7


def swell(dur, vel=1.0):
    """Cymbal/khí cuộn lên (đảo ngược) dẫn vào đoạn mới."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = highpass(RNG.standard_normal(n), 3000, 2)
    e = (t / dur) ** 2.6
    return noise * e * vel * 0.12


def riser(dur, vel=1.0, f0=200, f1=2400):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    tone = saw_stack_var(f, n)
    noise = highpass(RNG.standard_normal(n), 2000) * 0.5
    e = (t / dur) ** 2
    return lowpass(tone * 0.5 + noise, 7000) * e * vel * 0.1


def saw_stack_var(f, n):
    """Sóng răng cưa với tần số thay đổi theo thời gian (mảng f)."""
    ph = 2 * np.pi * np.cumsum(f) / SR
    out = np.zeros(n)
    for h in range(1, 16):
        out += ((-1) ** (h + 1)) / h * np.sin(ph * h)
    return out


def brass(freqs, dur, vel=0.7, swell_t=0.35, bright=2600):
    """Kèn đồng giả lập: chồng răng cưa lệch nhẹ, bộ lọc mở dần (hai bản lọc trộn theo đường bao)."""
    n = int((dur + 0.5) * SR)
    raw = np.zeros(n)
    for f in freqs:
        raw += saw_stack(f, n, (-0.07, 0, 0.08))
    dark = lowpass(raw, 500, 2)
    br = lowpass(raw, bright, 2)
    t = np.arange(n) / SR
    k = np.clip(t / max(swell_t, 0.01), 0, 1) ** 1.5
    out = dark * (1 - k) + br * k
    out *= env_adsr(n, min(0.08, swell_t), 0.2, 0.9, 0.45)
    return np.tanh(out * 1.3) * vel * 0.08


def strings_stac(f, dur, vel=0.7):
    """Dây ngắt âm (ostinato) — linh hồn của nhạc trailer."""
    n = int((dur + 0.15) * SR)
    raw = saw_stack(f, n, (-0.11, 0.0, 0.1)) + 0.5 * saw_stack(f * 2, n, (-0.06, 0.07))
    out = lowpass(raw, 3200, 2) * env_adsr(n, 0.008, 0.08, 0.55, 0.12)
    return out * vel * 0.11


def strings_long(freqs, dur, vel=0.6):
    n = int((dur + 1.2) * SR)
    out = np.zeros(n)
    t = np.arange(n) / SR
    for f in freqs:
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t + RNG.random() * 6)
        out += saw_stack_var(f * vib, n)
    out = lowpass(out, 2400, 2) * env_adsr(n, 0.7, 0.3, 0.9, 1.1)
    return out * vel * 0.045


def braam(f, dur, vel=1.0):
    """Tiếng 'braam' trầm dày của trailer điện ảnh."""
    n = int((dur + 0.8) * SR)
    raw = saw_stack(f, n, (-0.15, -0.05, 0.05, 0.15)) + saw_stack(f * 1.5, n, (-0.1, 0.1)) * 0.6
    t = np.arange(n) / SR
    k = np.clip(t / 0.6, 0, 1)
    out = lowpass(raw, 300, 2) * (1 - k) + lowpass(raw, 1600, 2) * k
    out = np.tanh(out * 2.2) * env_adsr(n, 0.05, 0.4, 0.8, 0.8)
    return out * vel * 0.16


def tick(vel=1.0):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    out = bandpass(RNG.standard_normal(n), 2500, 7000) * np.exp(-t * 120)
    return out * vel * 0.12


def synth_arp(f, dur, vel=0.7, bright=3500):
    n = int((dur + 0.2) * SR)
    raw = saw_stack(f, n, (-0.05, 0.06))
    t = np.arange(n) / SR
    cut = lowpass(raw, bright, 2) * np.exp(-t * 6) + lowpass(raw, 700, 2) * (1 - np.exp(-t * 6))
    return cut * env_adsr(n, 0.004, 0.1, 0.5, 0.1) * vel * 0.12


def hung_hon():
    """Hùng hồn · điện ảnh: Rê thứ, 92 BPM, dây ngắt âm, kèn đồng, taiko, cymbal cuộn."""
    T = Track(92, 24)
    prog = [(50, 'min'), (46, 'maj'), (53, 'maj'), (48, 'maj')]  # Dm Bb F C
    for bar in range(T.bars):
        root, kind = prog[bar % 4]
        notes = chord_notes(root, kind)
        b0 = bar * 4
        sec = 0 if bar < 4 else (1 if bar < 16 else 2)  # 0: dựng ngắn ~10 s, 1: bùng, 2: cao trào
        # Dây ngắt âm 1/8 (từ đoạn 2 thành 1/16)
        step = 0.5 if sec == 0 else 0.25
        pat = [0, 0, 2, 0, 1, 0, 2, 1] if step == 0.5 else [0, 0, 2, 0, 0, 1, 2, 0, 0, 0, 2, 0, 1, 2, 1, 0]
        for i, a in enumerate(pat):
            T.put(strings_stac(mtof(notes[a] + 12), step * T.beat * 0.8, 0.55 + 0.15 * (i % 4 == 0)), b0 + i * step, 'side', -0.35 if i % 2 else 0.35)
        T.put(strings_long([mtof(x) for x in notes], 4 * T.beat, 0.6 + 0.2 * sec), b0, 'music', 0, 0.9)
        T.put(bass(mtof(root - 12), 3.8 * T.beat, 0.75), b0, 'side')
        if sec >= 1:
            T.put(brass([mtof(x) for x in notes], 1.8 * T.beat, 0.75), b0, 'music', 0, 1.0)
            T.put(brass([mtof(x + 12) for x in notes[:2]], 1.6 * T.beat, 0.55, 0.15), b0 + 2.5, 'music', 0.2)
        if sec == 2:  # giai điệu kèn cao trào
            mel = [notes[0] + 24, notes[2] + 12, notes[1] + 24, notes[0] + 24]
            for i, m in enumerate(mel):
                T.put(brass([mtof(m)], 0.9 * T.beat, 0.5, 0.1, 3400), b0 + i, 'music', -0.15)
        # Trống
        T.put(taiko(1.0), b0, 'drums', 0)
        T.kicks.append(b0)
        if sec >= 1:
            T.put(taiko(0.8, 74), b0 + 1.5, 'drums', -0.2)
            T.put(taiko(0.9), b0 + 2, 'drums', 0.1)
            T.kicks.append(b0 + 2)
            T.put(snare(0.7), b0 + 1, 'drums'); T.put(snare(0.7), b0 + 3, 'drums')
        else:
            T.put(taiko(0.6, 70), b0 + 2.5, 'drums', 0.2)
        if bar % 4 == 0:
            T.put(boom(0.9 if sec else 0.6), b0, 'drums')
        if bar % 4 == 3:
            T.put(swell(2 * T.beat, 0.9), b0 + 2, 'drums', 0)
            for i in range(4):
                T.put(tom(110 - i * 12, 0.6 + i * 0.12), b0 + 3 + i * 0.25, 'drums', -0.3 + i * 0.2)
    return T.render(reverb=0.34, side_depth=0.3)


def tran_ca():
    """Trống trận · mạnh mẽ: Mi thứ, 100 BPM, dàn taiko + kèn đồng nhấn."""
    T = Track(100, 24)
    prog = [(52, 'min'), (52, 'min'), (48, 'maj'), (50, 'maj')]  # Em Em C D
    groove = [(0, 1.0, 58), (0.75, 0.55, 74), (1.5, 0.8, 66), (2, 1.0, 58), (2.5, 0.6, 82), (3, 0.85, 66), (3.5, 0.65, 74)]
    for bar in range(T.bars):
        root, kind = prog[bar % 4]
        notes = chord_notes(root, kind)
        b0 = bar * 4
        sec = 0 if bar < 4 else (1 if bar < 16 else 2)
        T.put(strings_long([mtof(root - 12), mtof(root - 5)], 4 * T.beat, 0.7), b0, 'music', 0, 1.0)
        for pos, v, f0 in groove:
            if sec == 0 and pos not in (0, 2, 3):
                continue
            T.put(taiko(v, f0), b0 + pos, 'drums', (f0 - 66) / 40)
            if pos in (0, 2):
                T.kicks.append(b0 + pos)
        if sec >= 1:
            T.put(brass([mtof(x) for x in notes], 0.7 * T.beat, 0.8, 0.05, 3000), b0, 'music', 0)
            T.put(brass([mtof(x) for x in notes], 0.5 * T.beat, 0.6, 0.05, 3000), b0 + 1.5, 'music', 0)
            for i in range(8):
                T.put(strings_stac(mtof(notes[0] + 12 + (7 if i % 4 == 3 else 0)), 0.4 * T.beat, 0.5), b0 + i * 0.5, 'side', 0.3 if i % 2 else -0.3)
        if sec == 2:
            mel = [notes[0] + 24, notes[0] + 26, notes[1] + 24, notes[2] + 24]
            for i, m in enumerate(mel):
                T.put(brass([mtof(m)], 0.8 * T.beat, 0.5, 0.08, 3400), b0 + i, 'music', 0.15)
        T.put(bass(mtof(root - 24), 3.6 * T.beat, 0.7), b0, 'side')
        if bar % 4 == 0:
            T.put(boom(0.8), b0, 'drums')
        if bar % 8 == 7:
            T.put(swell(2 * T.beat, 1.0), b0 + 2, 'drums')
            for i in range(8):
                T.put(taiko(0.5 + i * 0.07, 70 + (i % 2) * 10), b0 + 2 + i * 0.25, 'drums', 0.2 if i % 2 else -0.2)
    return T.render(reverb=0.3, side_depth=0.25)


def cong_nghe():
    """Công nghệ · hiện đại: La thứ, 118 BPM, arp synth 1/16, bass sâu — hợp nền bản đồ tối/line neon."""
    T = Track(118, 32)
    prog = [(57, 'min7'), (53, 'maj7'), (55, 'maj'), (52, 'min')]  # Am7 Fmaj7 G Em
    for bar in range(T.bars):
        root, kind = prog[bar % 4]
        notes = chord_notes(root, kind)
        b0 = bar * 4
        sec = 0 if bar < 4 else 1 + ((bar - 4) // 8) % 3
        bright = 1800 + 600 * (bar % 8)  # bộ lọc mở dần trong mỗi đoạn
        for i in range(16):
            nn = notes[(i * 3) % len(notes)] + (12 if i % 8 >= 4 else 0)
            T.put(synth_arp(mtof(nn), 0.22 * T.beat, 0.5 + 0.2 * (i % 4 == 0), bright), b0 + i * 0.25, 'side', 0.4 * np.sin(i * 0.8))
        T.put(pad([mtof(x - 12) for x in notes], 4 * T.beat, 0.5, 1600, 0.3, 0.6), b0, 'side', 0, 0.8)
        for q in range(4):
            T.put(bass(mtof(root - 24), 0.22 * T.beat, 0.8), b0 + q + 0.5, 'side')
            T.put(bass(mtof(root - 24), 0.22 * T.beat, 0.6), b0 + q + 0.75, 'side')
            if sec != 0:
                T.kick(b0 + q, 1.0)
            T.put(hat(0.45), b0 + q + 0.5, 'drums', 0.2)
            T.put(tick(0.6), b0 + q + 0.25, 'drums', -0.4)
        if sec == 0:
            T.kick(b0, 0.9)
        else:
            T.put(clap(0.9), b0 + 1, 'drums'); T.put(clap(0.9), b0 + 3, 'drums')
        if bar % 8 == 6:
            T.put(riser(2 * 4 * T.beat, 1.0), b0, 'music')
        if bar % 8 == 0 and bar:
            T.put(boom(0.7), b0, 'drums')
    return T.render(reverb=0.2, side_depth=0.55)


def khoi_dau():
    """Khởi đầu · truyền cảm hứng: Đô trưởng, 96 BPM, piano + dây + trống dồn dần."""
    T = Track(96, 24)
    prog = [(60, 'maj'), (55, 'maj'), (57, 'min'), (53, 'maj')]  # C G Am F
    mel = [(0, 76), (1, 74), (1.5, 72), (2, 74), (3, 79)]
    for bar in range(T.bars):
        root, kind = prog[bar % 4]
        notes = chord_notes(root, kind)
        b0 = bar * 4
        sec = 0 if bar < 4 else (1 if bar < 16 else 2)
        for i in range(8):
            nn = notes[[0, 1, 2, 1, 0, 2, 1, 2][i]] + 12
            T.put(piano(mtof(nn), 0.5 * T.beat, 0.4 + 0.1 * (i % 4 == 0)), b0 + i * 0.5, 'side', 0.2 * np.sin(i))
        T.put(piano(mtof(root - 12), 3.5 * T.beat, 0.6), b0, 'music', -0.1)
        T.put(strings_long([mtof(x) for x in notes], 4 * T.beat, 0.5 + 0.25 * sec), b0, 'music', 0, 0.9)
        if sec >= 1:
            T.kick(b0, 0.9); T.kick(b0 + 2, 0.8)
            T.put(snare(0.6), b0 + 1, 'drums'); T.put(snare(0.6), b0 + 3, 'drums')
            for q in range(4):
                T.put(hat(0.4), b0 + q + 0.5, 'drums', 0.25)
            T.put(bass(mtof(root - 24), 1.8 * T.beat, 0.7), b0, 'side'); T.put(bass(mtof(root - 24), 1.8 * T.beat, 0.6), b0 + 2, 'side')
        if sec == 2:
            for pos, m in mel:
                T.put(brass([mtof(m - 12)], 0.9 * T.beat, 0.45, 0.12, 3200), b0 + pos, 'music', 0.15)
                T.put(piano(mtof(m), 0.8 * T.beat, 0.5), b0 + pos, 'music', 0.2)
        if bar % 8 == 7:
            T.put(swell(2 * T.beat, 0.8), b0 + 2, 'drums')
            for i in range(4):
                T.put(tom(140 - i * 15, 0.5 + i * 0.1), b0 + 3 + i * 0.25, 'drums')
    return T.render(reverb=0.36, side_depth=0.3)


def dang_cap():
    """Đẳng cấp · trailer: Đô thăng thứ, 80 BPM, braam, nhịp tim, tiếng đồng hồ, nổ nhấn."""
    T = Track(80, 16)
    prog = [49, 45, 52, 47]  # C#m A E B (gốc)
    for bar in range(T.bars):
        root = prog[bar % 4]
        b0 = bar * 4
        sec = bar // 8
        if bar % 2 == 0:
            T.put(braam(mtof(root - 12), 3.6 * T.beat, 0.9 + 0.2 * sec), b0, 'music', 0)
            T.put(boom(0.9), b0, 'drums')
            T.put(taiko(0.9, 56), b0, 'drums')
            T.kicks.append(b0)
        T.put(strings_long([mtof(root), mtof(root + 7), mtof(root + 12)], 4 * T.beat, 0.55), b0, 'music', 0, 0.9)
        for i in range(8):
            T.put(tick(0.7 if i % 2 == 0 else 0.4), b0 + i * 0.5, 'drums', 0.5 if i % 2 else -0.5)
        # nhịp tim trầm
        T.put(kick(0.5), b0 + 1, 'drums'); T.put(kick(0.4), b0 + 1.35, 'drums')
        T.put(kick(0.5), b0 + 3, 'drums'); T.put(kick(0.4), b0 + 3.35, 'drums')
        if sec == 1:
            for i in range(8):
                T.put(strings_stac(mtof(root + 12 + (3 if i % 4 == 2 else 0)), 0.4 * T.beat, 0.5), b0 + i * 0.5, 'side', 0.3 if i % 2 else -0.3)
            T.put(brass([mtof(root), mtof(root + 3), mtof(root + 7)], 2.5 * T.beat, 0.6, 0.6), b0 + 1, 'music')
        if bar % 4 == 3:
            T.put(riser(4 * T.beat, 0.9, 150, 3000), b0, 'music')
    return T.render(reverb=0.45, side_depth=0.2)


def write_wav(path, x):
    import wave
    y = np.clip(x, -1, 1)
    y = (y * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(y.tobytes())


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'music'
    os.makedirs(out, exist_ok=True)
    ALL = (('nhe-nhang', nhe_nhang), ('tuoi-sang', tuoi_sang), ('soi-dong', soi_dong), ('sang-trong', sang_trong),
           ('hung-hon', hung_hon), ('tran-ca', tran_ca), ('cong-nghe', cong_nghe), ('khoi-dau', khoi_dau), ('dang-cap', dang_cap))
    only = sys.argv[2:]  # vd: python3 tools/make_music.py music hung-hon cong-nghe
    for name, fn in ALL:
        if only and name not in only:
            continue
        x = fn()
        write_wav(os.path.join(out, name + '.wav'), x)
        print(name, f'{len(x) / SR:.1f}s')
