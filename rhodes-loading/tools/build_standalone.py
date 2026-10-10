"""把 rhodes-loading/ 打包成一个自包含的 HTML（CSS / JS / 图片全部内联）。

用法：
    python rhodes-loading/tools/build_standalone.py
输出：
    rhodes-loading-standalone.html   （与 rhodes-loading/ 同级）
"""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
WS = os.path.dirname(SRC)
OUT = os.path.join(WS, 'rhodes-loading-standalone.html')

with open(os.path.join(SRC, 'index.html'), encoding='utf-8') as f:
    html = f.read()
with open(os.path.join(SRC, 'style.css'), encoding='utf-8') as f:
    css = f.read()
with open(os.path.join(SRC, 'app.js'), encoding='utf-8') as f:
    js = f.read()


def data_uri(rel):
    p = os.path.join(SRC, rel.replace('/', os.sep))
    mime = 'image/png' if rel.lower().endswith('.png') else 'image/jpeg'
    with open(p, 'rb') as fh:
        return 'data:%s;base64,' % mime + base64.b64encode(fh.read()).decode('ascii')


for rel in ('assets/rhodes.png', 'assets/rabbit-cut.png', 'assets/rabbit.jpg'):
    uri = data_uri(rel)
    html, css, js = (s.replace(rel, uri) for s in (html, css, js))

html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<script src="app.js"></script>', '<script>\n' + js + '\n</script>')

assert 'assets/' not in html, '还有没内联的资源'
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)
print('written %s (%.0f KB)' % (OUT, os.path.getsize(OUT) / 1024))
