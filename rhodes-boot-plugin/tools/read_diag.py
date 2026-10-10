"""读桌面端 Electron 的 localStorage，看插件的自证标记：
     dsh-rhodesBoot.cover      哪几条通道铺了幕（head/body/tap/client）
     dsh-rhodesBoot.coverAt    第一次铺幕的通道 @ 相对导航开始的毫秒
     dsh-rhodesBoot.coverEnd   撤幕时间
     dsh-rhodesBoot.at / .date 动画是否真的播过
用法: python tools/read_diag.py
"""
import os
import re
import shutil
import tempfile

APP = os.path.join(os.environ['APPDATA'], '@deepseek-ai', 'dsh-desktop')
LS = os.path.join(APP, 'Local Storage', 'leveldb')
KEYS = [b'coverAt', b'coverGate', b'coverEnd', b'rhodesBoot.cover', b'rhodesBoot.at', b'rhodesBoot.date', b'rhodesBoot.mode', b'rhodesBoot.off']

if not os.path.isdir(LS):
    raise SystemExit('找不到 localStorage: %s' % LS)

tmp = tempfile.mkdtemp(prefix='dsh-ls-')
files = []
for name in os.listdir(LS):
    src = os.path.join(LS, name)
    if not os.path.isfile(src):
        continue
    dst = os.path.join(tmp, name)
    try:
        shutil.copy2(src, dst)
        files.append(dst)
    except Exception:
        files.append(src)

blob = b''
for p in files:
    try:
        with open(p, 'rb') as f:
            blob += f.read()
    except Exception as e:
        print('  (读不到 %s: %s)' % (os.path.basename(p), e))

print('leveldb bytes:', len(blob))
for key in KEYS:
    # leveldb 会保留同一键的多个历史值：全部取出来，最后一个是最近的
    vals = []
    # 精确匹配：键后面不能紧跟字母，否则 rhodesBoot.cover 会误配到 rhodesBoot.coverAt
    for m in re.finditer(re.escape(key) + rb'(?![A-Za-z])', blob):
        seg = blob[m.end():m.end() + 80]
        runs = re.findall(rb'[\x20-\x7e]{1,60}', seg)
        if runs:
            v = runs[0].decode('ascii', 'replace')
            if v not in vals:
                vals.append(v)
    if not vals:
        print('  %-22s = (missing)' % key.decode())
    else:
        print('  %-22s = %s%s' % (key.decode(), vals[-1],
                                  ('   [历史: %s]' % ', '.join(vals[:-1])) if len(vals) > 1 else ''))
