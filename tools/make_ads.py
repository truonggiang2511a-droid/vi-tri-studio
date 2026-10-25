# Dựng 3 mẫu quảng cáo Vị Trí Studio (1080x1920, 30fps) từ demo.mp4 + huong-dan.mp4 của repo.
import os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.environ.get('ADS_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ads-out')
os.makedirs(OUT, exist_ok=True)
W, H = 1080, 1920
F_BLACK = '/usr/share/fonts/opentype/inter/Inter-Black.otf'
F_XB = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'
F_SB = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
YEL = (251, 191, 36); WHITE = (255, 255, 255); INK = (12, 14, 20)
GRADE = 'eq=brightness=0.03:contrast=1.06:saturation=1.18'

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(' '.join(cmd)); print(r.stderr[-2500:]); sys.exit(1)

def font(path, size): return ImageFont.truetype(path, size)

def card(rows, y, bg=(10, 12, 18, 215), pad=(46, 34), radius=34, accent=None, name='x'):
    """rows: list of (text, color, fontpath, size). Card canh giữa ngang, đỉnh ở y. Trả path PNG toàn khung."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    sizes = []
    for t, c, fp, s in rows:
        f = font(fp, s); bb = d.textbbox((0, 0), t, font=f)
        sizes.append((bb[2] - bb[0], bb[3] - bb[1], bb, f))
    gap = 18
    cw = min(W - 60, max(s[0] for s in sizes) + pad[0] * 2)
    ch = sum(s[1] for s in sizes) + gap * (len(rows) - 1) + pad[1] * 2
    x0 = (W - cw) // 2
    # bóng đổ
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0, y + 14, x0 + cw, y + ch + 14), radius, fill=(0, 0, 0, 150))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((x0, y, x0 + cw, y + ch), radius, fill=bg)
    if accent:
        d.rounded_rectangle((x0, y, x0 + cw, y + ch), radius, outline=accent, width=5)
    cy = y + pad[1]
    for (t, c, fp, s), (tw, th, bb, f) in zip(rows, sizes):
        d.text(((W - tw) // 2 - bb[0], cy - bb[1]), t, font=f, fill=c)
        cy += th + gap
    p = os.path.join(OUT, f'ov_{name}.png'); img.save(p); return p

def chip(text, y, name, color=INK, bg=YEL, size=46):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    f = font(F_XB, size); bb = d.textbbox((0, 0), text, font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    cw, ch = tw + 64, th + 40; x0 = (W - cw) // 2
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0, y + 10, x0 + cw, y + ch + 10), ch // 2, fill=(0, 0, 0, 140))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(14))); d = ImageDraw.Draw(img)
    d.rounded_rectangle((x0, y, x0 + cw, y + ch), ch // 2, fill=bg)
    d.text(((W - tw) // 2 - bb[0], y + 20 - bb[1]), text, font=f, fill=color)
    p = os.path.join(OUT, f'ov_{name}.png'); img.save(p); return p

def bubbles(msgs, name):
    """msgs: list of (text, side). Vẽ khung chat kiểu Zalo, mỗi tin một dòng."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    f = font(F_SB, 58); y = 330
    for t, side in msgs:
        bb = d.textbbox((0, 0), t, font=f); tw, th = bb[2] - bb[0], bb[3] - bb[1]
        bw, bh = tw + 70, th + 52
        x0 = 70 if side == 'L' else W - 70 - bw
        fill = (255, 255, 255, 245) if side == 'L' else (0, 104, 255, 250)
        col = (20, 22, 28) if side == 'L' else WHITE
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((x0, y + 8, x0 + bw, y + bh + 8), 38, fill=(0, 0, 0, 120))
        img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(12))); d = ImageDraw.Draw(img)
        d.rounded_rectangle((x0, y, x0 + bw, y + bh), 38, fill=fill)
        d.text((x0 + 35 - bb[0], y + 26 - bb[1]), t, font=f, fill=col)
        y += bh + 34
    p = os.path.join(OUT, f'ov_{name}.png'); img.save(p); return p

def cut(src, segs, name):
    """Cắt các đoạn (start, dur) → 1080x1920, nối lại. Trả (path, tổng thời lượng)."""
    parts = []
    for i, (ss, dur) in enumerate(segs):
        p = os.path.join(OUT, f'_{name}_{i}.mp4')
        run(['ffmpeg', '-v', 'error', '-y', '-ss', str(ss), '-t', str(dur), '-i', src, '-an',
             '-vf', f'scale={W}:{H}:flags=lanczos,{GRADE},fps=30,setsar=1',
             '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', p])
        parts.append(p)
    lst = os.path.join(OUT, f'_{name}.txt')
    open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
    out = os.path.join(OUT, f'_{name}_base.mp4')
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', out])
    return out, round(sum(d for _, d in segs), 2)

def compose(base, total, overlays, music, out):
    """overlays: list of (png, start, end). Hiện mờ dần vào/ra 0,25 s."""
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', base]
    for png, a, b in overlays:
        cmd += ['-loop', '1', '-t', str(total), '-i', png]
    cmd += ['-i', music]
    fc, last = [], '0:v'
    for i, (png, a, b) in enumerate(overlays, 1):
        fin = max(0, a)
        fc.append(f'[{i}:v]format=rgba,fade=t=in:st={fin}:d=0.25:alpha=1,fade=t=out:st={max(fin, b - 0.25)}:d=0.25:alpha=1[o{i}]')
        fc.append(f"[{last}][o{i}]overlay=0:0:enable='between(t,{a},{b})'[v{i}]")
        last = f'v{i}'
    m = len(overlays) + 1
    fc.append(f'[{m}:a]atrim=0:{total},afade=t=in:d=0.15,afade=t=out:st={total - 1.2}:d=1.2,volume=0.9[a]')
    cmd += ['-filter_complex', ';'.join(fc), '-map', f'[{last}]', '-map', '[a]', '-t', str(total),
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
            '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', out]
    run(cmd)

def poster(src, t, out):
    run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', src, '-frames:v', '1', '-q:v', '3', out])

DEMO = f'{REPO}/demo.mp4'; HD = f'{REPO}/huong-dan.mp4'; MUS = f'{REPO}/music'
CTA_Y = 640

def ad_a():
    base, T = cut(DEMO, [(6.0, 3.6), (25.0, 3.0), (49.5, 4.0), (72.5, 3.0), (103.0, 3.0), (108.0, 3.2)], 'A')
    hook = card([('DÁN TOẠ ĐỘ', WHITE, F_BLACK, 84), ('2 PHÚT CÓ VIDEO VỊ TRÍ', YEL, F_BLACK, 70)], 250, accent=YEL, name='A_hook')
    t1, t2, t3 = 3.6, 6.6, 10.6
    ov = [(hook, 0, 3.6),
          (chip('✓ Tự vẽ trục đường lớn', 250, 'A_c1'), t1, t2),
          (chip('✓ Khoảng cách tới ranh tỉnh, thành', 250, 'A_c2'), t2, t3),
          (chip('✓ Trường, chợ, bệnh viện quanh nhà', 250, 'A_c3'), t3, T - 3.2),
          (card([('DÙNG THỬ MIỄN PHÍ', WHITE, F_BLACK, 76), ('1 VIDEO', YEL, F_BLACK, 96),
                 ('vitristudio.com', WHITE, F_XB, 54)], 300, accent=YEL, name='A_cta'), T - 3.2, T)]
    out = os.path.join(OUT, 'QC_A_dan-toa-do-2-phut.mp4')
    compose(base, T, ov, f'{MUS}/hung-hon.m4a', out); return out, T

def ad_b():
    segs = [(76.0, 3.0), (9.0, 4.0), (15.5, 3.0), (36.5, 3.0), (48.0, 3.0), (57.0, 2.2), (77.5, 3.5)]
    base, T = cut(HD, segs, 'B')
    hook = card([('MÔI GIỚI LÀM VIDEO VỊ TRÍ', WHITE, F_BLACK, 64), ('THẾ NÀY MỚI NHANH', YEL, F_BLACK, 80)],
                40, bg=(10, 12, 18, 240), accent=YEL, name='B_hook')
    sub = chip('Không cần biết dựng video', 1340, 'B_sub', color=WHITE, bg=(10, 12, 18, 230), size=44)
    cta = card([('THỬ MIỄN PHÍ 1 VIDEO', YEL, F_BLACK, 78), ('Dán toạ độ · Chọn kiểu · Xuất MP4', WHITE, F_SB, 44),
                ('vitristudio.com', WHITE, F_XB, 56)], 300, bg=(10, 12, 18, 235), accent=YEL, name='B_cta')
    ov = [(hook, 0, 3.0), (cta, T - 3.5, T)]
    out = os.path.join(OUT, 'QC_B_lam-the-nay-moi-nhanh.mp4')
    compose(base, T, ov, f'{MUS}/cong-nghe.m4a', out); return out, T

def ad_c():
    # Đoạn mở đầu: nền mờ tối từ khung bản đồ, các tin nhắn hiện lần lượt
    bgp = os.path.join(OUT, '_C_bg.png')
    poster(DEMO, 8.0, bgp)
    im = Image.open(bgp).convert('RGB').resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(10))
    im = Image.blend(im, Image.new('RGB', (W, H), (8, 10, 16)), 0.45); im.save(bgp)
    intro = os.path.join(OUT, '_C_intro.mp4')
    run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-t', '4.6', '-i', bgp, '-vf', 'fps=30,format=yuv420p,setsar=1',
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', intro])
    rest, Tr = cut(DEMO, [(6.0, 3.2), (72.5, 3.0), (76.5, 2.0), (25.0, 3.0), (31.5, 2.0), (108.0, 3.4)], 'C')
    base = os.path.join(OUT, '_C_full.mp4')
    run(['ffmpeg', '-v', 'error', '-y', '-i', intro, '-i', rest, '-filter_complex',
         '[0:v]fps=30,format=yuv420p,setsar=1[a];[1:v]fps=30,format=yuv420p,setsar=1[b];[a][b]concat=n=2:v=1:a=0[v]',
         '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', base])
    T = round(4.6 + Tr, 2)
    msgs = [('Nhà ở đâu vậy anh?', 'L'), ('Gần trường, chợ không?', 'L'), ('Ra quốc lộ bao xa?', 'L'),
            ('Em gửi anh video vị trí nè ▶', 'R')]
    b1, b2, b3, b4 = (bubbles(msgs[:k], f'C_b{k}') for k in range(1, 5))
    s = 4.6
    ov = [(b1, 0.2, 1.1), (b2, 1.1, 2.0), (b3, 2.0, 3.0), (b4, 3.0, 4.6),
          (chip('NHÀ Ở ĐÂU?', 250, 'C_q1'), s, s + 3.2),
          (chip('GẦN TRƯỜNG, CHỢ KHÔNG?', 250, 'C_q2'), s + 3.2, s + 8.2),
          (chip('RA QUỐC LỘ BAO XA?', 250, 'C_q3'), s + 8.2, s + 13.2),
          (card([('GỬI 1 VIDEO', WHITE, F_BLACK, 84), ('THAY 10 TIN NHẮN', YEL, F_BLACK, 74),
                 ('Thử miễn phí · vitristudio.com', WHITE, F_XB, 48)], 300, accent=YEL, name='C_cta'), T - 3.4, T)]
    out = os.path.join(OUT, 'QC_C_gui-1-video-thay-10-tin-nhan.mp4')
    compose(base, T, ov, f'{MUS}/tran-ca.m4a', out); return out, T

if __name__ == '__main__':
    which = sys.argv[1:] or ['A', 'B', 'C']
    for k in which:
        p, T = {'A': ad_a, 'B': ad_b, 'C': ad_c}[k]()
        print(k, p, T)

def cut_sp(src, segs, name):
    """Như cut() nhưng mỗi đoạn có hệ số chậm (start, dur_nguồn, chậm)."""
    parts = []
    for i, (ss, dur, slow) in enumerate(segs):
        p = os.path.join(OUT, f'_{name}_{i}.mp4')
        run(['ffmpeg', '-v', 'error', '-y', '-ss', str(ss), '-t', str(dur), '-i', src, '-an',
             '-vf', f'setpts={slow}*PTS,scale={W}:{H}:flags=lanczos,{GRADE},fps=30,setsar=1',
             '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', p])
        parts.append(p)
    return parts, round(sum(d * s for _, d, s in segs), 2)

def vdur(p):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p],
                                capture_output=True, text=True).stdout.strip())

def compose_vo(base, total, overlays, music, voices, out, tempo=1.15):
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', base]
    for png, a, b in overlays: cmd += ['-loop', '1', '-t', str(total), '-i', png]
    cmd += ['-i', music]
    for p, st in voices: cmd += ['-i', p]
    fc, last = [], '0:v'
    for i, (png, a, b) in enumerate(overlays, 1):
        fc.append(f'[{i}:v]format=rgba,fade=t=in:st={a}:d=0.2:alpha=1,fade=t=out:st={max(a, b - 0.2)}:d=0.2:alpha=1[o{i}]')
        fc.append(f"[{last}][o{i}]overlay=0:0:enable='between(t,{a},{b})'[v{i}]")
        last = f'v{i}'
    m = len(overlays) + 1
    fc.append(f'[{m}:a]atrim=0:{total},volume=0.30,afade=t=in:d=0.15,afade=t=out:st={total - 1.2}:d=1.2[mus]')
    labs = ['[mus]']
    for j, (p, st) in enumerate(voices):
        k = m + 1 + j; ms = int(st * 1000)
        fc.append(f'[{k}:a]aresample=48000,atempo={tempo},adelay={ms}|{ms},volume=1.0[vo{j}]'); labs.append(f'[vo{j}]')
    fc.append(f"{''.join(labs)}amix=inputs={len(labs)}:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=9,alimiter=limit=0.84:level=false,atrim=0:{total}[a]")
    cmd += ['-filter_complex', ';'.join(fc), '-map', f'[{last}]', '-map', '[a]', '-t', str(total),
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
            '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', out]
    run(cmd)

def ad_c_voice(vo_dir):
    tp = 1.15
    d = {k: vdur(os.path.join(vo_dir, k + '.mp3')) / tp for k in ['q1', 'q2', 'q3', 'r', 'n1', 'n2', 'n3', 'cta']}
    # Mốc tin nhắn theo giọng
    t_q1 = 0.2; t_q2 = t_q1 + d['q1'] + 0.12; t_q3 = t_q2 + d['q2'] + 0.12; t_r = t_q3 + d['q3'] + 0.15
    L0 = round(t_r + d['r'] + 0.25, 2)
    bgp = os.path.join(OUT, '_C_bg.png')
    if not os.path.exists(bgp):
        poster(DEMO, 8.0, bgp)
        im = Image.open(bgp).convert('RGB').resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(10))
        Image.blend(im, Image.new('RGB', (W, H), (8, 10, 16)), 0.45).save(bgp)
    intro = os.path.join(OUT, '_CV_intro.mp4')
    run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-t', str(L0), '-i', bgp, '-vf', 'fps=30,format=yuv420p,setsar=1',
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', intro])
    L1 = round(d['n1'] + 0.45, 2); L2 = round(d['n2'] + 0.45, 2); L3 = round(d['n3'] + 0.45, 2); L4 = round(d['cta'] + 0.9, 2)
    parts, _ = cut_sp(DEMO, [(6.0, L1, 1), (72.3, L2, 1), (24.6, L3, 1), (108.0, 3.4, round(L4 / 3.4, 3))], 'CV')
    base = os.path.join(OUT, '_CV_full.mp4')
    ins = [intro] + parts
    cmd = ['ffmpeg', '-v', 'error', '-y']
    for p in ins: cmd += ['-i', p]
    fc = ''.join(f'[{i}:v]fps=30,format=yuv420p,setsar=1[s{i}];' for i in range(len(ins)))
    fc += ''.join(f'[s{i}]' for i in range(len(ins))) + f'concat=n={len(ins)}:v=1:a=0[v]'
    run(cmd + ['-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', base])
    T = round(L0 + L1 + L2 + L3 + L4, 2)
    msgs = [('Nhà ở đâu vậy anh?', 'L'), ('Gần trường, chợ không?', 'L'), ('Ra quốc lộ bao xa?', 'L'),
            ('Em gửi anh video vị trí nè ▶', 'R')]
    bs = [bubbles(msgs[:k], f'C_b{k}') for k in range(1, 5)]
    s1 = L0; s2 = s1 + L1; s3 = s2 + L2; s4 = s3 + L3
    ov = [(bs[0], t_q1, t_q2), (bs[1], t_q2, t_q3), (bs[2], t_q3, t_r), (bs[3], t_r, L0),
          (chip('NHÀ Ở ĐÂU?', 250, 'C_q1'), s1, s2),
          (chip('GẦN TRƯỜNG, CHỢ KHÔNG?', 250, 'C_q2'), s2, s3),
          (chip('RA QUỐC LỘ BAO XA?', 250, 'C_q3'), s3, s4),
          (card([('GỬI 1 VIDEO', WHITE, F_BLACK, 84), ('THAY 10 TIN NHẮN', YEL, F_BLACK, 74),
                 ('Thử miễn phí · vitristudio.com', WHITE, F_XB, 48)], 300, accent=YEL, name='C_cta'), s4, T)]
    vo = [(os.path.join(vo_dir, 'q1.mp3'), t_q1), (os.path.join(vo_dir, 'q2.mp3'), t_q2), (os.path.join(vo_dir, 'q3.mp3'), t_q3),
          (os.path.join(vo_dir, 'r.mp3'), t_r), (os.path.join(vo_dir, 'n1.mp3'), s1 + 0.15),
          (os.path.join(vo_dir, 'n2.mp3'), s2 + 0.15), (os.path.join(vo_dir, 'n3.mp3'), s3 + 0.15),
          (os.path.join(vo_dir, 'cta.mp3'), s4 + 0.3)]
    out = os.path.join(OUT, 'QC_C2_gui-1-video-co-giong-doc.mp4')
    compose_vo(base, T, ov, f'{MUS}/tran-ca.m4a', vo, out, tp)
    return out, T
