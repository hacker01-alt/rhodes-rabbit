"""把 rhodes-pet/pet.js 打包成 DSH 客户端插件 rhodes-pet-plugin/client.js。

做的事：
  1. 读 rhodes-pet/pet.js（同一份引擎，网页版和插件版共用一个源）
  2. 把底部"独立预览页自动挂载"那段去掉 —— 插件里由 client 自己决定何时创建
  3. 图片：在 factory 作用域里生成一个 base64 常量 PET_IMG_INLINE，
     并把引擎里的默认图片路径改写成引用它（插件不依赖任何外部文件）
  4. 套上 __ModuleLoader__.load(...) 外壳，注册到 shell.overlay 槽位

用法：
    python rhodes-pet-plugin/tools/build_plugin.py
输出：
    rhodes-pet-plugin/client.js
"""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
WS = os.path.dirname(PKG)

ENGINE = os.path.join(WS, 'rhodes-pet', 'pet.js')
IMG = os.path.join(WS, 'rhodes-loading', 'assets', 'rabbit-cut.png')
OUT = os.path.join(PKG, 'client.js')

# 独立预览页的自动挂载块：从这里到文件结束都要去掉
AUTO_MARKER = "if (typeof window !== 'undefined' && !window.__RHODES_PET_NO_AUTO)"

DEFAULT_IMG = "'assets/rabbit-cut.png'"


def data_uri(path, mime):
    with open(path, 'rb') as fh:
        return 'data:%s;base64,%s' % (mime, base64.b64encode(fh.read()).decode('ascii'))


with open(ENGINE, encoding='utf-8') as f:
    code = f.read()

# 1) 去掉独立预览页的自动挂载
idx = code.find(AUTO_MARKER)
if idx < 0:
    raise SystemExit('没找到独立预览页的自动挂载块，pet.js 结构变了？')
code = code[:idx].rstrip() + '\n'

# 2) 图片默认值改成引用内联常量（常量在 factory 里注入）
if DEFAULT_IMG not in code:
    raise SystemExit('pet.js 里的图片默认路径变了，检查一下')
code = code.replace(DEFAULT_IMG, 'PET_IMG_INLINE')

# 3) 缩进一层，塞进 factory 里
body = '\n'.join(('    ' + ln) if ln.strip() else ln for ln in code.split('\n'))

HEADER = '''/* =============================================================================
   dsh-rhodes-pet · Client half
   -----------------------------------------------------------------------------
   罗德岛兔兔桌宠：一只浮在 Harness 界面上的兔兔。
     · 拖动换位置（位置会记住）· 单击是摸它 · 双击让它说话 · 右键开设置
     · 摸它：合成触摸音 + 飘词 + 抖耳朵；喂胡萝卜：越啃越短 + 碎屑 + 计数
     · 齿轮按钮打开设置面板：大小 / 透明度 / 音量 / 音效 / 溜达 / 说话 / 自动投喂
   渲染位置：shell.overlay（整帧悬浮层）。
   除兔兔本体、胡萝卜、气泡、面板外全部 pointer-events:none —— 不挡界面。

   本文件由 tools/build_plugin.py 从 rhodes-pet/pet.js 生成（内联图片、去掉自动挂载）。
   不要直接改这个文件：改 rhodes-pet/pet.js，然后重新跑构建。
   ============================================================================= */
window.__ModuleLoader__.load({
  id: 'dsh-rhodes-pet',
  factory(require) {
    const React = require('react');

    /* ======================= 可调参数 ======================= */
    const SETTINGS = {
      /* 是否等启动动画播完再让兔兔出来。
         判定用的是**启动动画"正在播"的标记**（.rb-root.rb-active / #rb-boot-cover），
         而不是"那个节点还在不在" —— 这点是关键：启动动画退场时只给 .rb-root 加上
         rb-fadeout、摘掉 rb-active，**节点本身一直留在 DOM 里**（要等 React 卸载才移除）。
         第一版正是按"节点消失"判断的，于是条件几乎永远不成立，
         兔兔实际是被下面的 maxWaitMs 兜底放出来的 —— 表现就是"打开后要等一分钟"。 */
      waitForBoot: true,
      bootBusySelectors: ['.rb-root.rb-active', '#rb-boot-cover'],
      startDelayMs: 0,        // 启动动画一退场就出场，不再额外等待
      maxWaitMs: 15000,       // 兜底：等不到也出场，但绝不至于卡到一分钟
      /* 出场方式二选一：landMs > 0 走"落地"，否则走 fadeInMs 的淡入。
         这里刻意**不用落地**了：落地动画只保留给"拖动松手"（抓取-落地是一组动作），
         出场再用一次就重复了。改成很快的淡入 —— 140ms 淡入 + 从下往上 16px 的轻微上浮，
         既给"出现"这件事一个交代，又不会和抓取-落地撞车。
         （落地的实现还在 pet.js 里，`?land=` 与 RHODES_PET.drop() 仍可用于调试。） */
      landMs: 0,              // 0 = 出场不用落地（落地只留给拖动松手）
      dropFrom: 0,            // 0 = 按窗口高度自动取（约 22vh，最多 220px）
      fadeInMs: 140,          // 出场淡入时长（landMs 为 0 时生效）
    };

    /* 兔兔贴图：内联，插件不依赖外部文件 */
    const PET_IMG_INLINE = '%(uri)s';

'''

FOOTER = '''

    /* ======================= React 挂载 ======================= */
    function RhodesPet() {
      const hostRef = React.useRef(null);

      React.useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        let pet = null;
        let timer = 0;
        let cancelled = false;
        const started = Date.now();

        /* 启动动画还在播吗？（看"正在播"的标记，不看节点是否存在 —— 见 SETTINGS 说明） */
        function bootBusy() {
          return SETTINGS.bootBusySelectors.some((sel) => document.querySelector(sel));
        }
        function spawn() {
          if (cancelled || pet) return;
          pet = RHODES_PET_ENGINE({
            container: host,
            debug: false,          // 宿主页面的 ?xxx 不该影响桌宠
            img: PET_IMG_INLINE,
            /* 出场只走淡入；落地留给"拖动松手"（见 SETTINGS 里的说明）。
               landMs 仍是引擎支持的参数，这里传 0 表示不用。 */
            landMs: SETTINGS.landMs,
            dropFrom: SETTINGS.dropFrom,
            fadeIn: SETTINGS.fadeInMs,
          });
          window.__rhodesPet = pet;   // 控制台手柄：__rhodesPet.feed() / .talk() / .openPanel()
        }
        /* 60ms 一次的短轮询：动画一淡出，最多晚 60ms 就出场。
           刻意不用 requestAnimationFrame —— 它在这里的调度时机不可靠（实测过：
           rAF 循环跑不起来，兔兔就永远不出来），setTimeout 才是稳的。 */
        function watch() {
          if (cancelled || pet) return;
          if (!bootBusy() || Date.now() - started > SETTINGS.maxWaitMs) { spawn(); return; }
          timer = window.setTimeout(watch, 60);
        }

        if (!SETTINGS.waitForBoot) {
          timer = window.setTimeout(spawn, SETTINGS.startDelayMs);
        } else if (SETTINGS.startDelayMs > 0) {
          timer = window.setTimeout(watch, SETTINGS.startDelayMs);
        } else {
          watch();
        }

        return () => {
          cancelled = true;
          window.clearTimeout(timer);
          if (pet) {
            pet.dispose();
            if (window.__rhodesPet === pet) { try { delete window.__rhodesPet; } catch (e) { } }
            pet = null;
          }
        };
      }, []);

      return React.createElement('div', { ref: hostRef, style: { display: 'contents' } });
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'rhodes-pet', order: 90, label: 'RHODES 兔兔桌宠' },
          RhodesPet,
        ));
      },
    };
  },
});
'''

client = (HEADER % {'uri': data_uri(IMG, 'image/png')}) + body + FOOTER

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(client)
print('written %s (%.0f KB)' % (OUT, os.path.getsize(OUT) / 1024))
