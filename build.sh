#!/usr/bin/env bash
# Đóng gói bản chạy vào site/. Cloudflare Pages phục vụ thư mục site/, còn functions/ là phần máy chủ (/api/*).
set -euo pipefail
cd "$(dirname "$0")"
ESBUILD="${ESBUILD:-npx esbuild}"
rm -rf site && mkdir -p site/icons
$ESBUILD js/app.js --bundle --format=esm --minify --target=es2020 --charset=utf8 --line-limit=400 --outfile=site/app.js --log-level=warning
$ESBUILD js/admin.js --bundle --format=esm --minify --target=es2020 --charset=utf8 --line-limit=400 --outfile=site/admin.js --log-level=warning
$ESBUILD styles.css --minify --outfile=site/styles.css --log-level=warning
sed -e 's#<script type="module" src="js/app.js"></script>#<script type="module" src="app.js"></script>#' index.html > site/index.html
sed -e 's#<script type="module" src="js/admin.js"></script>#<script type="module" src="admin.js"></script>#' admin.html > site/admin.html
python3 - <<'PY'
import re, os, shutil
s = open('sw.js').read()
s = re.sub(r"const SHELL = \[.*?\];", """const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon-32.png',
];""", s, flags=re.S)
open('site/sw.js', 'w').write(s)
try:
    from PIL import Image
    for f in os.listdir('icons'):
        Image.open('icons/' + f).convert('RGBA').quantize(colors=48, method=Image.Quantize.FASTOCTREE).save('site/icons/' + f, optimize=True)
except ImportError:
    for f in os.listdir('icons'): shutil.copy('icons/' + f, 'site/icons/' + f)
PY
cp manifest.webmanifest _headers 404.html site/
cp -r poi site/poi
cp -r music site/music
echo "Đã đóng gói vào site/: $(find site -type f | wc -l) file"
