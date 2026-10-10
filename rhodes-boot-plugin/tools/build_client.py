"""把 rhodes-boot-plugin/client.src.js 里的图片占位符替换成 base64，生成 client.js。

用法：
    python rhodes-boot-plugin/tools/build_client.py [图片目录]
默认图片目录：<工作区>/rhodes-loading/assets
"""
import base64
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
WS = os.path.dirname(PKG)
ASSETS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WS, 'rhodes-loading', 'assets')

SRC = os.path.join(PKG, 'client.src.js')
OUT = os.path.join(PKG, 'client.js')

SOURCES = {
    '__RHODES_LOGO__': ('rhodes.png', 'image/png'),
    '__RABBIT_CUT__': ('rabbit-cut.png', 'image/png'),
}


def data_uri(filename, mime):
    path = os.path.join(ASSETS, filename)
    with open(path, 'rb') as f:
        return 'data:%s;base64,%s' % (mime, base64.b64encode(f.read()).decode('ascii'))


with open(SRC, encoding='utf-8') as f:
    code = f.read()

for token, (filename, mime) in SOURCES.items():
    if token not in code:
        raise SystemExit('占位符缺失: %s' % token)
    code = code.replace("'%s'" % token, "'%s'" % data_uri(filename, mime))

if '__RHODES' in code or '__RABBIT' in code:
    raise SystemExit('还有没替换的占位符')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(code)
print('written %s (%.0f KB)' % (OUT, os.path.getsize(OUT) / 1024))
