# dsh-rhodes-boot

DSH 的**开机启动动画**插件：打开 Harness 时**先播完整段罗德岛启动序列，播完才露出界面**。
进度速度由**真实网络状况**决定，右下角那只兔子会在加载时啃胡萝卜（也可以戳）。

## 先看完动画再进 harness 是怎么做到的

只靠"挂个 overlay"做不到——那样动画会在**已经渲染好的对话界面**上播（第一版就是这样，很出戏）。
现在的做法是：**先铺一层纯黑的开机黑幕把界面盖住，动画真正开始绘制时才撤幕**。
黑幕（`#rb-boot-cover`，z-index 2147483000）从 500ms 起浮出一个**启动指示**：
一行很淡的 `PRTS BOOT SEQUENCE` + 呼吸的点 + 一条来回扫的细线 —— 慢启动时看着像"正在起来"，
而不是一行静止的字（那容易被当成卡死）。
黑幕有四条铺开路径，从早到晚互为兜底：

1. `webserver/index-inject` 的 **head 行**（最早：HTML 第一帧）
2. `webserver/index-inject` 的 **body 行**（桌面端解释器确认支持 body）
3. `webServer.tapIndex()` 直接改 index HTML（浏览器路径）
4. **客户端模块在 `apply()` 里自己铺**——这一刻应用还在 "Loading plugins…"、界面尚未渲染，
   所以这是最可靠的一层，不依赖上面三条是否生效

前三条在 Host 半边（`index.js`），第四条在 `client.js`。四条都幂等（`getElementById` 检查），
同时生效也只会有一层幕。撤幕只由客户端做：动画开播后等两帧确认已上屏，再 `release()`。

安全阀：黑幕自带看门狗（客户端层 20s、注入层 30s）无条件自撤——客户端模块就算加载失败，
也绝不会把界面永久黑住。

> 控制范围到此为止：黑幕只能从"页面开始渲染"起生效。Electron 窗口本身（标题栏、HTML
> 解析前的空白，以及页面里在我这段代码之前就渲染的东西）由主进程决定，插件改不到。
> 想让窗口都晚点出现，只能改 DSH 桌面端主进程。

### 动画期间必须**自己**铺满整屏，不能指望黑幕（踩过）

动画画布是固定的 **1920×1080**（`.rb-stage`），用 `min(w/1920, h/1080)` 等比缩放居中 ——
窗口比例不是 16:9 时，上下（宽窗口）或左右（窄窗口）必然留出空白带。

早先 `.rb-root` 是 `background:transparent`，觉得"反正有黑幕挡着"。但**黑幕在动画开始绘制时就撤了**，
那两条留空带子于是直接透出下面的 Harness 界面 —— 用户看到的就是
**"窗口一缩小，启动动画就没盖满、底部露出一截状态栏/输入框"**（窗口越接近方形，露得越多）。

修法两条（缺一不可）：

```css
.rb-root{ ... background:#000 }              /* 留空处由根节点自己刷黑 */
.rb-root.rb-fadeout{opacity:0;transition:opacity .6s ease}   /* 淡出改成淡整层 */
```

- 根节点刷黑之后，黑幕撤幕前后都是 `#000`，接得上（撤幕不会闪一下）。
- 淡出**必须淡整层**，不能只淡 `.rb-stage`：只淡舞台的话，那层黑底不跟着淡 ——
  动画淡完了、带子还黑着，最后硬切才露出界面。淡出时长 `.6s` 和三处
  `CLOCK.later(660/700)` 是配套的，别单独改。
- 这条**只在插件里需要**：`rhodes-loading` 那个独立预览页 `html,body` 本来就是黑的，不会有露底问题。

> 复核方法：`tools/_tmp_cover_host.html`（临时宿主页，带一条假状态栏）在**非 16:9** 窗口下截图 ——
> 盖住了就看不到那条假状态栏。实测（1374×807 视口，上下各留空 17px）：
> 修之前底部 20px 处命中 `fakebar`（露出来了），修之后是 `rb-stage`，退场后又能重新命中 `fakebar`。

## 它做什么

- **启动序列期间压住别的插件浮层**：动画的舞台是 `.rb-root/.rb-stage`（z-index 9），而余额鲸鱼挂件这类
  浮层是**直接挂在 `<body>` 上**的 fixed 元素、层级比动画高（`.dshwv-root` = z-index 9999），
  不处理的话整段启动动画里鲸鱼和余额泡泡都会浮在画面上。现在动画期间会给它们插一条
  `#rb-suppress-others` 样式（`visibility:hidden`，保留布局与尺寸、也不吃点击），
  **动画淡出结束后自动撤掉** —— 表现就是「启动序列播完，挂件才出现」。
  要压别的浮层就往 `SETTINGS.hideOthersWhilePlaying`（选择器数组）里加。
- **开场的"通电"起手**：黑幕撤掉的瞬间，一条白线先横向拉开、再纵向撑成一束光，紧接着 logo 砸进来
  （0.52s）。原来是"空屏上横穿一道亮带"，没有叙事作用，已删掉 —— 现在这一下读起来是终端通电。
- **只在"完全退出再打开"时播**（默认 `playMode: 'launch'`）——判定单位是**会话**（sessionStorage）：
  完全退出应用 = 渲染进程销毁 = 新会话，**必播**；同一次会话里刷新页面、**最小化再恢复都不重播**
  （`minIntervalMs` 只挡 1.5s 内的重复挂载）。界面上没有跳过/重播入口，需要手动再看一次用控制台。
  另有 `'daily'`（每天只播一次）和 `'off'`（不自动播）两种模式。
  开播后约 10.5s 自动淡出、恢复点击穿透。
- **进度跟着网络走**：开播时并测 3 次同源请求取中位 RTT，再结合浏览器的 `effectiveType`，分四档
  `fast / normal / slow / poor`（外加 `offline`）。档位决定分段耗时倍率（0.82× / 1× / 1.32× / 1.62×）、
  是否插入「网络延迟较高，正在重试…」停顿，以及右上角 `NET 4ms · 4g · GOOD` 的读数。
  **断网**时进度冻结并显示 `LINK LOST`，恢复后冲一下继续；断开超过 4s 降级继续，不会卡死。
- **兔子小剧场**：**兔兔不会自己吃** —— 只有**戳它身上任意一点**（含边角、跳起来时）才会喂它一根：
  胡萝卜从旁边飞进嘴里、一口一个橙色小圈炸开、胡萝卜渣四散、飘出「咔嚓！」「好吃！」，右上角计数跳动。
  （原来有一条"每 2.6~5.6 秒自己随机掏一根啃"的排程链，已按要求去掉，改成纯手动。）
- **这里的喂食是纯互动：不扣库存、不算等级、不进累计。**
  开场表演不该是"消耗品"；而且一旦要写供应记录，就得连等级/累计一起考虑，
  两个插件各自独立打包、只能靠同一条 localStorage 记录同步，很容易互相覆盖
  （试过一版"启动动画吃的也算经验"，复杂度立刻上去，收益只是几根胡萝卜）。
  现在的分工只有一句话：**启动动画负责好看，桌宠负责养成。**
  - 右上角 `CARROT ×N` 数的是**本次动画内**喂了几根，和桌宠面板上的累计数不是一回事
  - 终章那句报的数字仍然是**桌宠那边的真实值**，走只读的 `supplyRead()`
  - `SETTINGS` 里**没有** `supplyTake` / `supplyWrite` —— 别再往回加
- **触摸音效**：戳下去那一下先响一声**专属的"被摸到"音**（极短的绒毛摩擦 + 一声上扬的软"啾"
  + 一点高频小天使粉，三层叠加），同时飘一个青色摸词（`touchWords`）、兔子轻跳一下；
  声音按**戳的位置左右偏**（戳左边偏左、戳右边偏右）。音高每次随机 ±10%，连点不会听出是同一个采样。
  连点有 `touchCooldownMs`（默认 260ms）节流，不会连成机关枪；节流只挡"触摸音效 + 摸词"，
  喂食不受影响（`eatCarrot` 的 `S.eating` 守卫保证一次只啃一根）。
  触摸音与啃胡萝卜的 `crunch()` 是两套声音，所以"被摸到"和"在吃"听得出来是两回事
  （原来戳下去只有一声 `blip`，且和啃食音混在一起，已撤掉）。
- **音效**：WebAudio 现场合成。浏览器要求先有交互，否则静音。
- **等页面可见才开播**：Electron 可能先把页面装配好、窗口稍后才显示，不等的话动画会在你看到窗口前播完。

## 操作

**画面里没有任何跳过 / 重播入口**（既没有跳过按钮，也不响应点击跳过、空格、回车、`Esc`、`R`）。
启动动画就老老实实播完约 10.5s，然后自动进界面 —— 只有右下角那个 `♪ SOUND` 音效开关。

唯一能互动的就是兔子，而且只在"进度条还在走"的阶段有效（`phase === 'run'`）：
**戳它身上任意一点 = 摸它一下**（触摸音 + 青色摸词 + 轻跳），顺手喂她一根胡萝卜。
想听到声音需要页面已经有交互过（浏览器策略），第一次戳会顺带把 AudioContext `resume()` 起来；
`♪ 点击开启音效` 状态下戳一下也能把音效打开。

需要手动再看一次（调试用）时，控制台里还有手柄：

```js
window.__rhodesBoot.play()   // 立刻重播
window.__rhodesBoot.eat()    // 立刻喂一根胡萝卜（不走触摸反馈）
```

## 开关（不用改代码）

```js
localStorage.setItem('dsh-rhodesBoot.mode', 'daily')  // launch | daily | off（运行时覆盖）
localStorage.removeItem('dsh-rhodesBoot.mode')        // 回到代码里的默认值
localStorage.setItem('dsh-rhodesBoot.off', '1')       // 彻底关闭自动播放
localStorage.setItem('dsh-rhodesBoot.at', '1')        // 清掉"上次播放时间"，下次加载立即再播
sessionStorage.removeItem('dsh-rhodesBoot.played')    // 清掉"本次会话已播"，当前这次刷新也会播
```

## 参数

源码 `client.src.js` 顶部 `SETTINGS`：

```js
playMode, minIntervalMs, mountDelayMs,
sound, grain, hopInterval, carrot, carrotBites,
supplyKey, supplyBase, supplyCap,   // 只读：供应记录的键名 / 每日基数 / 库存上限
                                    // （要和桌宠 dsh-rhodes-pet 保持一致；这里只读不写）
touchCooldownMs,         // 连点节流：这么近的第二次触摸不出音效/词(ms)
holdEnd,                 // 结束页停留多久后淡出(ms)
hideOthersWhilePlaying,  // 动画期间要压住的其他插件浮层选择器（默认 ['.dshwv-root']）
dialogSpeedMs, dialogGapMs,
tips, logs,
dialog,                  // 终章对话，见下
touchWords,              // 触摸词池（摸到兔子时飘，青色）
biteWords, moodWords, finishWords, clickWords,   // 其余互动词池，见下
```

（`carrotInterval` 已删除——兔兔不再自己随机吃，所以那个间隔没有意义了。）

### 终章对话（每拍一个台词池）

`dialog` 是**一拍一条**的数组，每拍的 `text` 可以是三种形式：

- **字符串** —— 固定台词
- **数组** —— 候选池，每次启动随机挑一条
- **函数** —— 现算一条（也可以返回数组）。这是给**实时数字**用的，比如今日补给

三种可以**混在同一个池子里**，比如最后一拍就是 `[字符串, 字符串, 字符串, 函数]`。

> ⚠ **解析必须递归解包**：先解包到真正的字符串，**最后才挑**。
>
> 早先的写法是"先挑、后判断"：
> ```js
> const pool = typeof beat.text === 'function' ? beat.text() : beat.text;
> let text = Array.isArray(pool) ? pick(pool) : pool;   // ← 挑出来的是"函数"
> if (typeof text !== 'string') text = String(text);    // ← 被字符串化
> ```
> 第一行那个三元判断**不会触发**（`beat.text` 是数组、不是函数，走了 else），
> 于是从数组里挑到函数之后就再也没被调用过 —— **整段源码被当台词逐字打了出来**：
> 屏幕上真的显示 `() => SETTINGS.supplyFreshToday() ? ...`。
>
> 现在用 `resolveText` 递归解包（数组就挑一条再解、函数就调用再解，直到拿到值）。
> 单独测它：`node _test_resolve.mjs` —— 从 `client.js` 产物里把函数抽出来跑，
> 覆盖纯字符串 / 字符串数组 / 纯函数 / 函数返回数组 / **数组混着函数** /
> 嵌套数组 / 空数组 / null 八种形态。

```js
dialog: [
  { name: '？？？', text: ['……博士？', '唔……有人吗？', '（一小团毛球从终端里滚了出来。）'] },
  { name: 'PRTS', text: ['检测到未知生命体，可爱指数已超出量程。', '扫描完成：物种不明，威胁等级——可爱。'] },
  { name: '兔兔', text: ['（它裹紧外套，朝你眨了眨眼。）', '（它把胡萝卜往怀里塞了塞，假装什么都没发生。）'] },
  { name: 'PRTS', text: [
      '权限确认：博士 DOCTOR，欢迎回来。',
      // 函数形式：数字在"这一拍真的要显示"时才去取，不能在建配置时就定死
      () => `今日补给已到位：胡萝卜 ×${supplyLeft()}。`,
    ] },
]
```

想加台词就往对应数组里塞；想加一拍就多写一个 `{ name, text }`（会相应拉长总时长）。

### 互动词池（按情绪分色）

| 池 | 何时飘 | 颜色 |
| --- | --- | --- |
| `touchWords` | 戳下去那一刻（触摸反馈） | 青 `唔……` `（抖了抖耳朵）` `诶嘿` |
| `biteWords` | 每一口（多数） | 橙 `咔嚓！` `嚼嚼嚼` `嘎嘣脆！` |
| `moodWords` | 每口约 42% 概率 | 粉 `好吃！` `好甜……` `（耳朵抖了一下）` |
| `finishWords` | 一根吃完 | 粉 `吃完了！` `谢谢博士～` `（打了个小小的嗝）` |
| `clickWords` | 旧版的"戳"词，已不再自动飘 | 青 `！` `诶？` `（抬头看你）` `（愣了两秒）` |

> `clickWords` 与 `touchWords` 的分工：触摸音效上线后，"戳"这一下的视觉反馈统一由 `touchWords`
> 负责（青色、跟着触摸音一起出），`clickWords` 保留给老配置和手动调用，默认路径不再飘它。
> 想换回旧手感，把 `touchWords` 直接抄成 `clickWords` 的内容即可。

`moodWords` 触发时还会额外炸一把粉色碎屑，所以"情绪"和"咀嚼音"一眼能区分。

## 构建与安装

装的是**打包产物**（`file:` 依赖，node_modules 里是真实副本），所以改动要走"重新打包 + 装"：

```powershell
# 1) 改完 client.src.js 后重新生成 client.js（图片以 base64 内联）
python rhodes-boot-plugin/tools/build_client.py

# 2) 打包
cd rhodes-boot-plugin
pnpm pack --pack-destination ..            # 产出 dsh-rhodes-boot-1.18.1.tgz

# 3) 放到稳定目录（profile 依赖指向它，别随便挪）并安装
copy dsh-rhodes-boot-1.18.1.tgz %USERPROFILE%\dsh-bundles\
# 让插件管理器装：install_bundle 目标 = %USERPROFILE%\dsh-bundles\dsh-rhodes-boot-1.18.1.tgz
# 或命令行：dsh plugin --profile desktop add %USERPROFILE%\dsh-bundles\dsh-rhodes-boot-1.18.1.tgz
```

**客户端插件的改动需要重启 Harness 才会生效**（安装结果里会写 `application: restart-required`），
不是刷新页面就够。

### 自检 / 诊断（黑幕到底哪一层生效）

四条通道各自会往 localStorage 写标记，所以"哪一层铺的幕、比页面导航早/晚多少"是**可测量**的，
不用靠猜（Electron 的 GUI 有令牌鉴权，外部浏览器进不去，这条是唯一能从外部取证的路子）：

| 键 | 含义 |
| --- | --- |
| `dsh-rhodesBoot.cover` | 曾经生效过的通道，逗号分隔：`head` / `body` / `tap` / `client` |
| `dsh-rhodesBoot.coverAt` | **首次**铺幕：`通道@毫秒`（毫秒 = 相对本次页面导航，越小越早） |
| `dsh-rhodesBoot.coverEnd` | 首次撤幕时间 |
| `dsh-rhodesBoot.coverGate` | 注入脚本对"该不该盖"的判断（1/0） |
| `dsh-rhodesBoot.at` | 每次真播动画的时间戳（可看出今天播了几次） |

读取（桌面端 Electron 的 localStorage，只读副本）：

```powershell
python rhodes-boot-plugin/tools/read_diag.py
```

判读：`coverAt` 里 `head@<小数字>` 表示黑幕在页面解析 head 时就铺上了（界面还没画）；
只有 `client@` 表示 Host 三条注入通道在桌面端都没生效，黑幕是等客户端模块被 apply 时才铺的
（这时应用自己的 "Loading plugins…" 可能已经画过一帧）。

### 为什么不用 `link:` 安装

第一版用的是 `link:`（node_modules 里放 junction 指向本目录）。踩到两个坑：
pnpm 在替换/清理依赖时会**穿过 junction 删掉目标目录的内容**，把工作区源码清空两次；
另外链接目录一旦被清空，客户端模块直接加载失败，表现就是"完全没有动画"。
改成 tarball 安装后 node_modules 里是真实副本，pnpm 再怎么折腾也动不到源码。

### 万一源码丢了

`client.js` 由 `client.src.js` 把两个占位符（`'__RHODES_LOGO__'`、`'__RABBIT_CUT__'`）替换成 base64 得到，
所以从**任意一份 client.js 反向还原**出可读源码是可行的：把两个 `data:image/png;base64,...` 串
换回占位符（含外层单引号）即可，再补一个 `tools/build_client.py`（把占位符换回 base64）。

## 实现位置

- 渲染位置：Client `shell.overlay`（整帧悬浮层），注册 id `rhodes-boot`、order `100`。
  平时 `pointer-events:none` 不干扰界面，播放时接管指针以支持"点击跳过"。
- 样式全部限定在 `.rb-root` 内（类名 `rb-*`），`inject` 只有 `slots`。
  唯一的例外是**播放期间**那条 `#rb-suppress-others`：它是为了压住比动画层级更高的其他插件浮层
  （见上文），带 `!important` 但只作用在 `hideOthersWhilePlaying` 列出的选择器上，
  且动画淡出后立即移除；不写任何其他插件的数据，也不依赖它们的内部状态。
- `connection/reset` 事件用于在终端日志里补一行"终端链路已重新建立"。
- 生命周期由 React `useEffect` 的清理函数负责：清定时器/rAF、摘监听、关 AudioContext、移除根节点。
