"""自检：确认 pet.js → client.js 的构建产物是自洽的。

跑法：
    python rhodes-pet-plugin/tools/check_build.py

检查项：
  1. client.js 里没有残留的 'assets/' 相对路径（图片必须已内联）
  2. client.js 里没有残留的自动挂载块（那是网页版专用的）
  3. 必备片段都在：模块 id、槽位注册、引擎函数、内联图常量
  4. pet.js 里存在构建脚本依赖的那两个锚点
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
WS = os.path.dirname(PKG)

CLIENT = os.path.join(PKG, 'client.js')
ENGINE = os.path.join(WS, 'rhodes-pet', 'pet.js')

fails = []


def check(cond, msg):
    print(('  OK   ' if cond else '  FAIL ') + msg)
    if not cond:
        fails.append(msg)


with open(CLIENT, encoding='utf-8') as f:
    client = f.read()
with open(ENGINE, encoding='utf-8') as f:
    engine = f.read()

print('检查 client.js：')
check("'assets/" not in client, '没有残留的外部资源相对路径（图片已内联）')
check('__RHODES_PET_NO_AUTO' not in client, '没有残留网页版的自动挂载块')
check('data:image/png;base64,' in client, '内联图片存在')
check("window.__ModuleLoader__.load({" in client, '模块加载器外壳存在')
check("id: 'dsh-rhodes-pet'" in client, '模块 id 正确')
check("ctx.slots.inject('shell.overlay'" in client, '注册到 shell.overlay 槽位')
check('function RHODES_PET_ENGINE(' in client, '引擎函数已包含')
check('PET_IMG_INLINE' in client, '图片常量已注入并被引用')
check('return api;' in client, '引擎返回了对外手柄（插件卸载要靠它）')

print('检查 pet.js：')
check("if (typeof window !== 'undefined' && !window.__RHODES_PET_NO_AUTO)" in engine,
      '自动挂载锚点存在（构建脚本靠它切分）')
check("var PET_IMG = opts.img || 'assets/rabbit-cut.png';" in engine,
      '图片默认值锚点存在（构建脚本靠它替换）')

print()
if fails:
    raise SystemExit('自检未通过：%d 项' % len(fails))
print('自检全部通过。')
