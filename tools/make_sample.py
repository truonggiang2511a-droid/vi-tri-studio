# Dựng sample.json: căn mẫu đã quét sẵn (tiện ích, trục đường, đường đi, ranh xã/tỉnh) để khách mới vào app là video mẫu phát ngay.
# Chạy: bash build.sh && python3 tools/make_sample.py   (cần Playwright + Chrome; /api chuyển sang web thật vitristudio.com)
# Xong chạy lại bash build.sh để chép sample.json vào site/.
import os, sys, json, time, subprocess
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
PORT = 8799
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--directory', SITE, '--bind', '127.0.0.1'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
proxy = os.environ.get('HTTPS_PROXY', '')
try:
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', args=[f'--proxy-server={proxy}'] if proxy else [])
        pg = b.new_context(viewport={'width': 420, 'height': 900}, ignore_https_errors=True).new_page()
        base = f'http://127.0.0.1:{PORT}'

        def fwd(route):
            url = route.request.url.replace(base, 'https://vitristudio.com')
            try:
                r = route.fetch(url=url, headers={**route.request.headers, 'origin': 'https://vitristudio.com', 'referer': 'https://vitristudio.com/'})
                route.fulfill(response=r)
            except Exception:
                route.abort()
        pg.route('**/api/**', fwd)
        pg.route('**/sample.json', lambda r: r.fulfill(status=404, body=''))  # buộc quét thật
        pg.goto(base + '/', wait_until='domcontentloaded')
        pg.wait_for_function("typeof window.__vitri === 'object'", timeout=30000)
        pg.evaluate("() => document.getElementById('sampleBtn').click()")
        pg.wait_for_function("window.__vitri.state.roads.length > 0 && window.__vitri.state.pois.length > 0", timeout=180000)
        # Chờ đường đi tới từng tiện ích + đoạn lấp chỗ hở trục đường
        for _ in range(90):
            done = pg.evaluate("""() => { const s = window.__vitri.state;
              return s.selected.every(id => id in s.routes) && s.selectedRoads.every(id => id in (s.roadFills || {})); }""")
            if done: break
            time.sleep(2)
        time.sleep(3)
        d = pg.evaluate("""() => { const s = window.__vitri.state, keys = window.__vitri.SAMPLE_KEYS();
          const o = {}; for (const k of keys) o[k] = s[k];
          const sel = new Set(s.selected);
          o.routes = Object.fromEntries(Object.entries(s.routes).filter(([k]) => sel.has(k) || k === '__ranh'));
          o.roads = s.roads.filter(r => s.selectedRoads.includes(r.id));
          return o; }""")
        b.close()
finally:
    srv.terminate()


def r5(v):
    if isinstance(v, float): return round(v, 5)
    if isinstance(v, list): return [r5(x) for x in v]
    if isinstance(v, dict): return {k: r5(x) for k, x in v.items()}
    return v


# Gọn file: mỗi nhóm giữ 40 tiện ích gần nhất (+ các điểm đang chọn) — đủ cho danh sách "Xem thêm"
sel = set(d['selected'])
groups = {}
for poi in d['pois']: groups.setdefault(poi.get('cat'), []).append(poi)
d['pois'] = [x for L in groups.values() for i, x in enumerate(sorted(L, key=lambda q: q.get('km', 9))) if i < 40 or x['id'] in sel]
out = os.path.join(ROOT, 'sample.json')
json.dump(r5(d), open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(out, os.path.getsize(out), 'bytes;', len(d['pois']), 'tiện ích,', len(d['roads']), 'trục đường, ★', d.get('roadStars'))
