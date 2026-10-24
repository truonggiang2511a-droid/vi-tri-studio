# Tạo kịch bản AI (Chuyên gia) + giọng đọc cho căn mẫu bằng tài khoản test nội bộ. Cách dùng: xem CLAUDE.md mục 5 (24/10, video mẫu có giọng).
# Cần: thư mục scratch có site_t (bản dựng tạm gắn window.__xt = { media, voiceKey, scriptSegments, voiceDurations }) và tok.txt (phiên tạm của giang.test).
import os, sys, json, time, subprocess, base64, struct
from playwright.sync_api import sync_playwright
OUT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(OUT, 'site_t')
TOK = open(os.path.join(OUT, 'tok.txt')).read().strip()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8771', '--directory', SITE, '--bind', '127.0.0.1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
proxy = os.environ.get('HTTPS_PROXY', '')
logs = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', args=[f'--proxy-server={proxy}'] if proxy else [])
        pg = b.new_context(viewport={'width': 420, 'height': 900}, ignore_https_errors=True).new_page()
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        pg.on('dialog', lambda d: (logs.append('DIALOG: ' + d.message[:120]), d.accept()))
        pg.add_init_script(f"try {{ localStorage.setItem('vitri.session.v1', '{TOK}'); }} catch (e) {{}}")
        def fwd(route):
            url = route.request.url.replace('http://127.0.0.1:8771', 'https://vitristudio.com')
            try:
                r = route.fetch(url=url, headers={**route.request.headers, 'origin': 'https://vitristudio.com', 'referer': 'https://vitristudio.com/'}, timeout=120000); route.fulfill(response=r)
            except Exception as e: logs.append('ROUTEERR ' + url + ' ' + str(e)); route.abort()
        pg.route('**/api/**', fwd)
        pg.goto('http://127.0.0.1:8771/', wait_until='domcontentloaded')
        pg.wait_for_function("typeof window.__vitri === 'object' && window.__vitri.tl && window.__vitri.state.pois.length", timeout=30000)
        time.sleep(4)
        pg.evaluate("() => { const b = document.getElementById('playBtn'); if (b.classList.contains('playing')) b.click(); }")
        print('acct', pg.evaluate("() => document.querySelector('.acct-name, #acctBtn')?.textContent"), pg.evaluate("() => window.__vitri.state.voiceId"))
        pg.evaluate("() => { document.querySelector('#scriptSrcSeg [data-v=ai]')?.click(); document.querySelector('#aiToneSeg [data-v=\"chuyen-gia\"]').click(); }")
        time.sleep(0.5)
        pg.evaluate("() => document.getElementById('ttsBtn').click()")
        pg.wait_for_function("window.__vitri.state.voSig && window.__xt.media.voiceSegs.size > 3", timeout=300000)
        time.sleep(1)
        d = pg.evaluate("""() => { const s = window.__vitri.state, X = window.__xt;
          const segs = X.scriptSegments().filter(sg => X.media.voiceSegs.get(sg.key)).map(sg => { const v = X.media.voiceSegs.get(sg.key);
            const ch = v.buffer.getChannelData(0); let bin = ''; const i16 = new Int16Array(ch.length); for (let i = 0; i < ch.length; i++) i16[i] = Math.max(-32768, Math.min(32767, ch[i] * 32767));
            const u8 = new Uint8Array(i16.buffer); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            return { key: sg.key, text: sg.text, rate: v.buffer.sampleRate, speed: v.speed, pcm: btoa(bin) }; });
          return { scriptEdits: s.scriptEdits, scriptAi: s.scriptAi, voSig: s.voSig, aiTone: s.aiTone, scriptMode: s.scriptMode, voiceId: s.voiceId, voiceSpeed: s.voiceSpeed, segs, dur: window.__vitri.tl.duration }; }""")
        json.dump(d, open(os.path.join(OUT, 'voice_dump.json'), 'w'), ensure_ascii=False)
        print('segs', len(d['segs']), 'dur', d['dur'], d['voSig'], d['voiceId'])
        for sg in d['segs']: print(sg['key'], '|', sg['text'])
        b.close()
finally:
    srv.terminate()
print('\n'.join(logs[:20]))
