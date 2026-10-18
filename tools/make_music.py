#!/usr/bin/env python3
"""Soạn 4 bản nhạc nền lặp liền mạch cho Vị Trí Studio (tự tổng hợp từ đầu, không dùng mẫu của ai).

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
    for name, fn in (('nhe-nhang', nhe_nhang), ('tuoi-sang', tuoi_sang), ('soi-dong', soi_dong), ('sang-trong', sang_trong)):
        x = fn()
        write_wav(os.path.join(out, name + '.wav'), x)
        print(name, f'{len(x) / SR:.1f}s')
