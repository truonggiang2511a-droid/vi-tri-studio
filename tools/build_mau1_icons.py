# Chuyển bộ icon "mẫu 1" của bộ dựng video (Hook Kit, kit/hook_mg.py hàm icon(): lưới 100×100, nét L/A/R/C)
# sang js/mau1-icons.js để render.js vẽ đúng y hình bằng canvas. Chạy lại khi bộ icon trong Hook Kit đổi:
#   python3 tools/build_mau1_icons.py /đường/dẫn/kit/hook_mg.py
import json, math, re, sys
src = open(sys.argv[1], encoding='utf-8').read()
names = json.loads(re.search(r'^ICONS = (\[.*?\])', src, re.S | re.M).group(1).replace("'", '"'))
a = src.index('        if name == "floors":')
b = src.index('        else:\n            C(50, 50, 30)', a)
chain = src[a:b]
import textwrap; body = textwrap.dedent(chain)
r1 = lambda v: round(float(v), 1)
def record(name):
    ops = []
    def L(*pts): ops.append(['L', [r1(c) for p in pts for c in p]])
    def A(box, a0, a1): ops.append(['A', [r1(v) for v in box] + [r1(a0), r1(a1)]])
    def R(box, rad): ops.append(['R', [r1(v) for v in box] + [r1(rad)]])
    def C(cx, cy, r, fill=False): ops.append(['C', [r1(cx), r1(cy), r1(r), 1 if fill else 0]])
    exec(body, {'math': math, 'name': name, 'L': L, 'A': A, 'R': R, 'C': C})
    return ops
out = {n: record(n) for n in names}
empty = [n for n, v in out.items() if not v]
if empty: sys.exit('Icon không có nét: ' + ', '.join(empty))
js = ('// TỰ SINH bằng tools/build_mau1_icons.py từ Hook Kit (kit/hook_mg.py, bộ icon "mẫu 1" của Giang) — đừng sửa tay.\n'
      '// Mỗi icon: lưới 100×100; L = đường gấp khúc [x,y,…], A = cung [x0,y0,x1,y1,độ đầu,độ cuối] (chiều kim đồng hồ),\n'
      '// R = khung bo góc [x0,y0,x1,y1,bán kính], C = vòng tròn [cx,cy,r,tô kín].\n'
      'export const MAU1_ICONS = ' + json.dumps(out, separators=(',', ':')) + ';\n')
open('js/mau1-icons.js', 'w', encoding='utf-8').write(js)
print(len(out), 'icon,', len(js), 'byte')
