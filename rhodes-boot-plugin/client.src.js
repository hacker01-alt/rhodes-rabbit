/* =============================================================================
   dsh-rhodes-boot · Client half
   -----------------------------------------------------------------------------
   每日首次打开 DSH Web 时播放的「罗德岛启动序列」：
     · 明日方舟风格加载界面（故障错位 / 扫描线 / 终端日志 / 分段进度条）
     · 进度速度由**真实网络状况**决定（RTT 实测 + 浏览器网络信息 + 在线/离线事件）
     · 兔子随机啃胡萝卜，也可以戳它喂一根
     · 基线约 10s，网络差会变慢并显示重试，断网会冻结进度
   渲染位置：shell.overlay（整帧悬浮层），播完自动淡出，不干扰界面。
   本文件由 tools/build_client.py 从 client.src.js 生成（注入两张图的 base64）。
   ============================================================================= */
window.__ModuleLoader__.load({
  id: 'dsh-rhodes-boot',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /* ======================= 可调参数 ======================= */
    const SETTINGS = {
      /* 播放时机：
         'launch' 每次打开/重进都播（默认，符合"退出再进来也要看到"）
         'daily'  每天只播一次
         'off'    不自动播                                                    */
      playMode: 'launch',
      /* launch 模式以「会话」为单位：完全退出应用再打开 = 新会话 = 必播；
         同一次会话里刷新页面、最小化再恢复都不重播。
         minIntervalMs 只用来挡住"同一次会话里的重复挂载"这种几秒内的情况。 */
      minIntervalMs: 1500,
      storeKey: 'dsh-rhodesBoot.date',   // 上次播放日期
      atKey: 'dsh-rhodesBoot.at',        // 上次播放时间戳
      sessionKey: 'dsh-rhodesBoot.played', // 本次会话是否已播（sessionStorage：退出应用即清空）
      modeKey: 'dsh-rhodesBoot.mode',    // 运行时覆盖：localStorage 里设 launch/daily/off
      offKey: 'dsh-rhodesBoot.off',      // '1' = 彻底关闭
      mountDelayMs: 350,                 // 页面可见后延迟多久开播（先让应用画出来）
      sound: true,                       // 若页面已交互过则带音效
      grain: 0.06,
      hopInterval: [1150, 1900],
      carrot: true,
      carrotBites: [3, 5],
      holdEnd: 2600,                     // 结束页停留多久后自动淡出(ms)
      touchCooldownMs: 260,              // 连点节流：这么近的第二次触摸不再出音效/词（喂食不受影响）
      touchWords: ['唔……', '（抖了抖耳朵）', '（舒服地眯起眼）', '诶嘿', '（往你手心里蹭了蹭）',
        '（毛茸茸的）', '（歪头）', '（小声）……博士。'],
      tips: [
        '提示：右下角那只兔子——戳她既是摸头，也会喂她一根胡萝卜（会扣今日补给）。',
        '提示：PRTS 正在同步干员档案，请保持终端连接。',
        '提示：不要在源石浓度过高的区域停留过久。',
        '提示：本次连接质量已计入启动进度。',
      ],
      logs: [
        ['检查终端硬件…', 'OK'],
        ['挂载 PRTS 内核 v3.14…', 'OK'],
        ['校验源石加密签名…', 'OK'],
        ['载入干员档案 (247)…', 'OK'],
        ['同步罗德岛数据库…', 'OK'],
        ['建立神经链路…', 'OK'],
        ['权限确认：博士 DOCTOR', 'GRANTED'],
        ['启动完成。', 'READY'],
      ],
      /* 终章对话：每一拍可以给一句（字符串）或一组候选（数组，随机挑一句），
         所以每次启动的对话都不一样。 */
      dialog: [
        { name: '？？？', text: [
          '……博士？',
          '唔……有人吗？',
          '（外套里传来窸窸窣窣的动静。）',
          '（一小团毛球从终端里滚了出来。）',
        ] },
        { name: 'PRTS', text: [
          '检测到未知生命体，可爱指数已超出量程。',
          '扫描完成：物种不明，威胁等级——可爱。',
          '警告：目标呈球状，疑似长期摄入过量胡萝卜。',
          '生物体征异常：心率随胡萝卜出现而上升。',
        ] },
        { name: '兔兔', text: [
          '（它裹紧外套，朝你眨了眨眼。）',
          '（它把胡萝卜往怀里塞了塞，假装什么都没发生。）',
          '（它原地转了个身，把最圆的那一面朝向你。）',
          '（它用爪子拍了拍外套口袋，里面传出塑料摩擦声。）',
        ] },
        { name: 'PRTS', text: [
          '权限确认：博士 DOCTOR，欢迎回来。',
          '已登记临时干员「兔兔」，编制：后勤·胡萝卜消耗股。',
          '罗德岛终端已就绪，欢迎回来，博士。',
          /* 这一条的数字是**实时**的：读的是桌宠维护的那份胡萝卜数据。
             只报"今天一共还能吃几根"（今日配额 + 存货），不把两个数分开报 ——
             分开报会出现"库存含今日"这种重复计数，看着像两个互不相干的池子。 */
          () => SETTINGS.supplyFreshToday()
            ? `今日签到完成：补给 +${SETTINGS.supplyQuota()} 根，共可喂 ${SETTINGS.supplyAvailable()} 根。`
            : `今日补给已领：还可喂 ${SETTINGS.supplyAvailable()} 根。`,
        ] },
      ],
      dialogSpeedMs: 24,                 // 逐字打字速度
      dialogGapMs: 240,                  // 两句之间的停顿
      /* ============================================================
         胡萝卜：**只读，绝不写**。
         这里曾经会扣库存（`supplyTake`），但那样启动动画的互动就变成了"消耗品"，
         而它其实只是开场表演 —— 而且一旦要写，就得连经验/累计根数一起考虑，
         两个插件各自独立打包、只能靠同一条 localStorage 记录同步，很容易互相覆盖。
         现在的分工很干净：
           · 启动动画：**只看**还剩几根（终章那句报的数是桌宠那边的真实数字）
           · 桌宠：唯一负责扣减、签到、等级、累计
         所以这个块里没有 supplyTake / supplyWrite —— 别再往回加。
         ============================================================ */
      supplyKey: 'dsh-rhodesPet.supply',
      supplyBase: 50,                       // 每日签到量（要和桌宠那边保持一致）
      supplyCap: 10000,                     // 库存上限（要和桌宠那边保持一致）
      /* 把一份记录规范化：数字收敛、越界夹回。这里只管胡萝卜（启动动画不碰经验/累计）。 */
      supplyNorm(o, today) {
        const q = Math.floor(Number(o && o.quota));
        const s = Math.floor(Number(o && o.stock));
        const g = Math.floor(Number(o && o.gain));
        return {
          day: (o && o.day) || today,
          quota: Number.isFinite(q) ? Math.max(0, Math.min(this.supplyBase, q)) : 0,
          stock: Number.isFinite(s) ? Math.max(0, Math.min(this.supplyCap, s)) : 0,
          checked: !!(o && o.checked),
          gain: Number.isFinite(g) ? Math.max(0, g) : 0      // 这次签到实际收进多少
        };
      },
      /* 只读：**不签到、不写入**。签到是桌宠的事，启动动画不抢这个动作 ——
         否则启动动画一跑就把今天的补给"领"了，桌宠那边反而看不到签到提示。 */
      supplyRead() {
        const today = (() => {
          const d = new Date();
          return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
            ('0' + d.getDate()).slice(-2);
        })();
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(this.supplyKey) || 'null'); } catch (e) { raw = null; }
        /* 旧格式兼容：早期只有 { day, left }。把 left 当累积库存读。 */
        if (raw && raw.day && raw.stock == null && raw.left != null) {
          raw = { day: raw.day, quota: 0, stock: raw.left, checked: !!raw.checked };
        }
        return this.supplyNorm(raw, today);
      },
      supplyQuota() { return this.supplyRead().quota; },
      supplyLeft() { return this.supplyRead().stock; },          // 累积库存
      supplyAvailable() {                                        // 今天一共还能喂几根
        const o = this.supplyRead();
        return o.quota + o.stock;
      },
      /* 今天是不是"刚签的"——终章那句按它决定说"签到完成"还是"已领"。
         看记录里的 gain（这次签到实收多少）。 */
      supplyFreshToday() { return (this.supplyRead().gain || 0) > 0; },
      /* 咬胡萝卜时飘的词（按情绪分池，颜色也不同） */
      biteWords: ['咔嚓！', '咔嚓♪', '咔嚓咔嚓', '嚼嚼嚼', '嘎嘣脆！', '唔姆……'],
      moodWords: ['好吃！', '好甜……', '喜欢这个', '再来一根！', '（耳朵抖了一下）',
        '（尾巴动了动）', '（眼睛亮了）', '腮帮子鼓鼓的', '（满足地眯起眼）'],
      finishWords: ['吃完了！', '谢谢博士～', '还想吃……', '满足～', '（打了个小小的嗝）'],
      clickWords: ['！', '诶？', '呀！', '唔？', '（抬头看你）', '谁呀……', '（耳朵一动）',
        '（把外套裹得更紧了）', '（愣了两秒）'],
      /* 启动序列播放期间要压住的**其它插件 UI**（选择器数组，动画淡出后自动恢复）。
         为什么要压：动画的舞台是 .rb-root/.rb-stage（z-index 9），而这类挂件是直接挂在
         <body> 上的 fixed 浮层、层级比动画高（余额鲸鱼挂件 = z-index 9999），
         不压住就会整段动画都浮在启动画面上（用户反馈：鲸鱼和余额泡泡跟启动动画一起出现）。
         默认只压鲸鱼挂件；以后再有别的浮层挡在前面，往这个数组里加选择器即可。      */
      hideOthersWhilePlaying: ['.dshwv-root'],
    };

    /* ======================= 内嵌资源 ======================= */
    const LOGO_URI = '__RHODES_LOGO__';
    const RABBIT_URI = '__RABBIT_CUT__';

    /* ======================= 样式（全部限定在 .rb-root 内） ======================= */
    const CSS = `
.rb-root{position:fixed;inset:0;z-index:9;pointer-events:none;background:transparent}
.rb-root.rb-active{pointer-events:auto;cursor:crosshair}
.rb-stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;
  transform:translate(-50%,-50%) scale(var(--rb-fit,1));transform-origin:center center;
  background:#000;overflow:hidden;font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;
  color:#fff;-webkit-font-smoothing:antialiased;user-select:none;
  --rb-mono:"Consolas","SFMono-Regular","Menlo","DejaVu Sans Mono",monospace;
  --rb-tech:#9fd8ff;--rb-dim:rgba(255,255,255,.45);--rb-dim2:rgba(255,255,255,.22)}
.rb-stage *{margin:0;padding:0;box-sizing:border-box}
.rb-layer{position:absolute;inset:0;pointer-events:none}
.rb-grid{background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
  linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:80px 80px;
  mask-image:radial-gradient(ellipse 62% 58% at 50% 46%,#000 20%,transparent 78%);
  -webkit-mask-image:radial-gradient(ellipse 62% 58% at 50% 46%,#000 20%,transparent 78%);
  opacity:0;transition:opacity 1.4s ease .2s}
.rb-stage.rb-run .rb-grid{opacity:1}
.rb-grain{width:100%;height:100%;mix-blend-mode:screen;opacity:.75}
.rb-scanlines{background:repeating-linear-gradient(to bottom,rgba(255,255,255,.055) 0 1px,rgba(0,0,0,0) 1px 3px);
  mix-blend-mode:overlay;opacity:.55}
.rb-vignette{background:radial-gradient(ellipse 74% 66% at 50% 46%,rgba(0,0,0,0) 38%,rgba(0,0,0,.72) 100%),
  linear-gradient(to bottom,rgba(0,0,0,.55),rgba(0,0,0,0) 22%,rgba(0,0,0,0) 74%,rgba(0,0,0,.72))}
/* 起手的"通电"：一条白线先横向拉开，再纵向撑成一束光，然后 logo 砸进来。
   代替了原来那道在空屏上横穿的亮带（那个没有任何叙事作用）。 */
.rb-power{position:absolute;left:50%;top:44%;width:560px;height:2px;margin-left:-280px;background:#fff;
  box-shadow:0 0 26px 2px rgba(255,255,255,.85);pointer-events:none;opacity:0;transform:scaleX(.02);
  animation:rb-power .52s cubic-bezier(.2,.85,.25,1) forwards}
@keyframes rb-power{
  0%{opacity:0;transform:scaleX(.02) scaleY(1)}
  16%{opacity:1;transform:scaleX(1) scaleY(1)}
  52%{opacity:.9;transform:scaleX(1) scaleY(9)}
  100%{opacity:0;transform:scaleX(1) scaleY(52)}}

.rb-hud{position:absolute;font-family:var(--rb-mono);font-size:15px;line-height:1.65;letter-spacing:.09em;
  color:var(--rb-dim);opacity:0;transform:translateY(8px);transition:opacity .5s ease,transform .5s ease}
.rb-hud.rb-show{opacity:1;transform:none}
.rb-tl{left:88px;top:74px}.rb-tr{right:88px;top:74px;text-align:right}
.rb-bl{left:88px;bottom:78px;width:620px}
.rb-br{right:88px;bottom:74px;font-size:13px;color:var(--rb-dim2);letter-spacing:.16em}
.rb-hud-title{font-family:"Times New Roman",Georgia,serif;font-size:26px;letter-spacing:.34em;color:#fff;
  text-shadow:0 0 18px rgba(255,255,255,.35)}
.rb-hud-sub{font-size:13px;letter-spacing:.3em;color:var(--rb-dim);margin-bottom:12px}
.rb-hl{color:var(--rb-tech);text-shadow:0 0 12px rgba(120,200,255,.55)}
.rb-hud-bar{width:230px;height:3px;margin-top:12px;background:rgba(255,255,255,.14);overflow:hidden}
.rb-hud-bar i{display:block;height:100%;width:34%;background:var(--rb-tech);box-shadow:0 0 10px rgba(120,200,255,.9);
  animation:rb-hudslide 2.6s cubic-bezier(.65,0,.35,1) infinite}
@keyframes rb-hudslide{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}
.rb-sig{color:var(--rb-tech);animation:rb-blink2 1.5s steps(1,end) infinite}
@keyframes rb-blink2{0%,70%{opacity:1}71%,100%{opacity:.45}}
.rb-caret{display:inline-block;width:8px;height:15px;margin-left:8px;background:#fff;vertical-align:-2px;
  animation:rb-blink 1.05s steps(1,end) infinite}
@keyframes rb-blink{0%,49%{opacity:1}50%,100%{opacity:0}}
.rb-log{font-size:13.5px;line-height:1.9;letter-spacing:.06em;color:rgba(255,255,255,.34)}
.rb-log div{opacity:0;transform:translateY(5px);transition:opacity .3s ease,transform .3s ease;white-space:nowrap}
.rb-log div.rb-on{opacity:1;transform:none}
.rb-log .rb-t{color:rgba(255,255,255,.22);margin-right:10px}
.rb-log .rb-ok{color:var(--rb-tech);margin-left:10px}

.rb-hero{position:absolute;left:0;right:0;top:124px;text-align:center;
  transition:transform 1.1s cubic-bezier(.2,.8,.2,1),opacity .9s ease}
.rb-hero.rb-shift{transform:translateY(-42px) scale(.84)}
.rb-hero.rb-dim{opacity:.16}
.rb-logo-wrap{position:relative;display:inline-block;opacity:0;will-change:transform,opacity,filter}
.rb-logo{width:418px;height:auto;filter:drop-shadow(0 0 26px rgba(255,255,255,.22))}
.rb-logo-scan{position:absolute;left:-6%;right:-6%;top:0;height:6px;pointer-events:none;opacity:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.95),transparent);mix-blend-mode:screen;filter:blur(1px)}
@keyframes rb-slam{0%{opacity:0;transform:scale(1.10);filter:drop-shadow(0 0 40px rgba(255,255,255,.95)) drop-shadow(9px 0 0 rgba(255,0,60,.85)) drop-shadow(-9px 0 0 rgba(0,225,255,.85))}
 10%{opacity:1;transform:translate(-8px,3px) scale(1.05);filter:drop-shadow(0 0 34px rgba(255,255,255,.9)) drop-shadow(-11px 0 0 rgba(255,0,60,.75)) drop-shadow(11px 0 0 rgba(0,225,255,.75))}
 20%{opacity:.35;transform:translate(9px,-4px) scale(1.03);filter:drop-shadow(0 0 26px rgba(255,255,255,.8)) drop-shadow(7px 0 0 rgba(255,0,60,.7)) drop-shadow(-7px 0 0 rgba(0,225,255,.7))}
 32%{opacity:1;transform:translate(-4px,2px) scale(1.015);filter:drop-shadow(0 0 30px rgba(255,255,255,.9)) drop-shadow(-4px 0 0 rgba(255,0,60,.6)) drop-shadow(4px 0 0 rgba(0,225,255,.6))}
 44%{opacity:.7;transform:translate(3px,0) scale(1.006)}100%{opacity:1;transform:none;filter:drop-shadow(0 0 26px rgba(255,255,255,.28))}}
.rb-logo-wrap.rb-slam{animation:rb-slam .68s steps(1,end) both}
@keyframes rb-scanrun{0%{opacity:0;transform:translateY(0)}6%{opacity:1}94%{opacity:1}100%{opacity:0;transform:translateY(330px)}}
.rb-logo-wrap.rb-scan .rb-logo-scan{animation:rb-scanrun .95s cubic-bezier(.3,0,.7,1) both}
@keyframes rb-breathe{0%,100%{filter:drop-shadow(0 0 22px rgba(255,255,255,.26))}50%{filter:drop-shadow(0 0 34px rgba(255,255,255,.46))}}
.rb-logo-wrap.rb-settle{opacity:1;animation:rb-breathe 5.6s ease-in-out infinite}
.rb-logo-wrap.rb-glitch{animation:rb-glitch .34s steps(2,end) 2}
@keyframes rb-glitch{0%{transform:translate(-5px,2px);filter:drop-shadow(-9px 0 0 rgba(255,0,60,.9)) drop-shadow(9px 0 0 rgba(0,225,255,.9))}
 50%{transform:translate(5px,-2px);filter:drop-shadow(8px 0 0 rgba(255,0,60,.9)) drop-shadow(-8px 0 0 rgba(0,225,255,.9))}
 100%{transform:none;filter:none}}
.rb-rule{display:flex;align-items:center;justify-content:center;gap:14px;margin:26px auto 0;width:760px;opacity:0;
  transform:scaleX(.2);transition:opacity .5s ease,transform .7s cubic-bezier(.2,.8,.2,1)}
.rb-rule.rb-on{opacity:1;transform:none}
.rb-rule i{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.75),transparent)}
.rb-rule b{width:8px;height:8px;border:1px solid rgba(255,255,255,.85);transform:rotate(45deg);box-shadow:0 0 14px rgba(255,255,255,.7)}
.rb-subtitle{font-size:19px;letter-spacing:.34em;color:rgba(255,255,255,.82);margin-top:20px;opacity:0;
  transform:translateY(6px);transition:opacity .7s ease .1s,transform .7s ease .1s}
.rb-subtitle.rb-on{opacity:1;transform:none}
.rb-chip{display:inline-block;margin-top:16px;padding:5px 16px;font-family:var(--rb-mono);font-size:12.5px;
  letter-spacing:.22em;color:var(--rb-tech);border:1px solid rgba(159,216,255,.32);background:rgba(159,216,255,.05);
  opacity:0;transition:opacity .6s ease .25s}
.rb-chip.rb-on{opacity:1}

.rb-progress{position:absolute;left:50%;top:716px;width:820px;margin-left:-410px;opacity:0;transform:translateY(10px);
  transition:opacity .6s ease,transform .6s ease}
.rb-progress.rb-on{opacity:1;transform:none}
.rb-progress.rb-dim{opacity:.16}
.rb-progress-head{display:flex;align-items:flex-end;justify-content:space-between}
.rb-plabel{font-family:var(--rb-mono);font-size:14px;letter-spacing:.34em;color:var(--rb-dim)}
.rb-pct{font-family:var(--rb-mono);font-size:52px;font-weight:700;line-height:.86;font-variant-numeric:tabular-nums;
  text-shadow:0 0 26px rgba(255,255,255,.35)}
.rb-pct i{font-size:22px;font-style:normal;color:var(--rb-dim);margin-left:4px}
.rb-bar{position:relative;height:7px;margin-top:16px;background:rgba(255,255,255,.12);overflow:hidden}
.rb-bar::after{content:"";position:absolute;inset:0;border-top:1px solid rgba(255,255,255,.18);border-bottom:1px solid rgba(255,255,255,.18)}
.rb-fill{position:relative;height:100%;width:0;background:#fff;box-shadow:0 0 22px rgba(255,255,255,.75);transition:width .1s linear}
.rb-fill .rb-edge{position:absolute;right:0;top:-4px;bottom:-4px;width:3px;background:#fff;box-shadow:0 0 26px 4px rgba(255,255,255,.95)}
.rb-ticks{position:absolute;inset:0;background-image:repeating-linear-gradient(90deg,rgba(0,0,0,.85) 0 1px,transparent 1px 41px);mix-blend-mode:multiply}
.rb-foot{display:flex;justify-content:space-between;margin-top:14px;font-family:var(--rb-mono);font-size:14px;letter-spacing:.1em;color:var(--rb-dim)}
.rb-status .rb-arrow{color:var(--rb-tech);margin-right:10px;font-size:10px;vertical-align:1px;animation:rb-blink 1.05s steps(1,end) infinite}
.rb-net{color:rgba(255,255,255,.28)}
.rb-net b{color:var(--rb-tech);font-weight:400}
.rb-net.rb-warn b{color:#ffcf7a}
.rb-net.rb-bad b{color:#ff8f8f}
.rb-tip{position:absolute;left:50%;top:946px;width:1200px;margin-left:-600px;text-align:center;font-size:16px;
  letter-spacing:.16em;color:rgba(255,255,255,.44);opacity:0;transition:opacity .8s ease}
.rb-tip.rb-on{opacity:1}.rb-tip.rb-dim{opacity:.16}.rb-tip.rb-hide{opacity:0}

.rb-rabbit{position:absolute;left:1240px;top:790px;width:236px;opacity:0;
  transform:translate(var(--rb-dx,240px),var(--rb-dy,0px)) scale(var(--rb-s,1));
  transition:transform .85s cubic-bezier(.22,1.35,.3,1),opacity .5s ease}
.rb-rabbit.rb-on{--rb-dx:0px;--rb-dy:0px;opacity:1}
.rb-rabbit.rb-center{--rb-dx:-398px;--rb-dy:-298px;--rb-s:1.6;opacity:1}
.rb-rabbit.rb-scare{--rb-dx:-398px;--rb-dy:-358px;--rb-s:3.8;opacity:1;transition:transform .3s cubic-bezier(.2,1.15,.3,1),opacity .2s ease}
.rb-rabbit.rb-off{--rb-dx:1200px;opacity:0;transition:transform .9s cubic-bezier(.5,0,.9,.4),opacity .9s ease .3s}
.rb-stage.rb-run .rb-rabbit{cursor:pointer}
.rb-hop{position:relative;transform-origin:50% 100%}
@keyframes rb-hop{0%{transform:translateY(0) scale(1,1)}12%{transform:translateY(0) scale(1.09,.91)}
 42%{transform:translateY(-46px) scale(.955,1.05)}62%{transform:translateY(-30px) scale(.99,1.01)}
 84%{transform:translateY(0) scale(1.04,.96)}100%{transform:translateY(0) scale(1,1)}}
.rb-hop.rb-doing{animation:rb-hop 1.05s cubic-bezier(.34,.06,.36,.98)}
@keyframes rb-wobble{0%,100%{rotate:0deg}30%{rotate:-3.4deg}70%{rotate:3.4deg}}
.rb-hop.rb-big{animation:rb-hop 1.05s cubic-bezier(.34,.06,.36,.98),rb-wobble 1.05s ease-in-out}
.rb-rabbit-img{width:100%;height:auto;filter:drop-shadow(0 14px 30px rgba(0,0,0,.9));
  transition:filter .25s ease,transform .25s ease}
/* 悬停：整只亮起来 + 描边泛蓝，明确"可以戳" */
.rb-stage.rb-run .rb-rabbit:hover .rb-rabbit-img{transform:scale(1.045);
  filter:brightness(1.12) drop-shadow(0 0 26px rgba(159,216,255,.7)) drop-shadow(0 14px 30px rgba(0,0,0,.9))}
.rb-shadow{position:absolute;left:14%;right:14%;bottom:-10px;height:18px;border-radius:50%;
  background:radial-gradient(ellipse at center,rgba(0,0,0,.95),rgba(0,0,0,0) 72%);animation:rb-spulse 1.05s cubic-bezier(.34,.06,.36,.98) infinite}
@keyframes rb-spulse{0%,100%{transform:scale(1);opacity:.85}42%{transform:scale(.72);opacity:.45}}
.rb-ring{position:absolute;left:50%;top:52%;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;
  border:3px solid rgba(255,255,255,.9);opacity:0;pointer-events:none}
.rb-ring.rb-burst{animation:rb-ring .75s cubic-bezier(.15,.7,.3,1) forwards}
@keyframes rb-ring{0%{opacity:.95;transform:scale(.25)}100%{opacity:0;transform:scale(7.5)}}
/* 咬一口时嘴边炸开的小圈：让"在啃"这件事一眼可见 */
.rb-bite-ring{position:absolute;left:55%;top:30%;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;
  border:3px solid #ffc072;opacity:0;pointer-events:none;
  box-shadow:0 0 18px rgba(255,170,80,.9),inset 0 0 12px rgba(255,170,80,.55)}
.rb-bite-ring.rb-bite{animation:rb-bite .45s cubic-bezier(.2,.8,.3,1) forwards}
@keyframes rb-bite{0%{opacity:1;transform:scale(.35)}100%{opacity:0;transform:scale(3.4)}}
.rb-carrot{position:absolute;left:8%;top:7%;width:54%;transform-origin:100% 50%;opacity:0;pointer-events:none;
  transform:rotate(-12deg) scale(.6);
  filter:drop-shadow(0 0 18px rgba(255,160,60,.75)) drop-shadow(0 0 4px rgba(255,255,255,.5)) drop-shadow(0 6px 12px rgba(0,0,0,.75));
  transition:transform .26s cubic-bezier(.3,1.4,.4,1),opacity .18s ease}
.rb-carrot.rb-show{opacity:1}
.rb-carrot svg{display:block;width:100%;height:auto}
@keyframes rb-chomp{0%{transform:none}16%{transform:translate(3px,8px) scale(1.06,.9) rotate(-2.4deg)}
 44%{transform:translate(-2px,2px) scale(.985,1.02) rotate(1.8deg)}72%{transform:translate(2px,5px) scale(1.03,.96) rotate(-1.2deg)}100%{transform:none}}
.rb-rabbit-img.rb-chomp{animation:rb-chomp .38s ease-out}
.rb-word{position:absolute;font-family:var(--rb-mono);font-size:20px;font-weight:700;letter-spacing:.12em;color:#ffe3b0;
  text-shadow:0 0 20px rgba(255,170,80,.95),0 2px 0 rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.9);
  pointer-events:none;white-space:nowrap;z-index:5;animation:rb-word 1.05s ease-out forwards}
.rb-word.rb-mood{color:#ffd0e6;font-size:21px;text-shadow:0 0 22px rgba(255,130,190,.95),0 2px 0 rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.9)}
.rb-word.rb-click{color:#bff0ff;font-size:24px;text-shadow:0 0 22px rgba(120,210,255,.95),0 2px 0 rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.9)}
@keyframes rb-word{0%{opacity:0;transform:translate(-50%,0) scale(.7)}14%{opacity:1;transform:translate(-50%,-12px) scale(1.12)}
 30%{transform:translate(-50%,-20px) scale(1)}100%{opacity:0;transform:translate(-50%,-58px) scale(.98)}}
.rb-count{position:absolute;left:-8px;top:-26px;font-family:var(--rb-mono);font-size:13px;letter-spacing:.18em;
  color:rgba(255,255,255,.5);white-space:nowrap;opacity:0;transform:translateY(4px);
  transition:opacity .45s ease,transform .45s ease;pointer-events:none}
.rb-count.rb-on{opacity:1;transform:none}
.rb-count b{color:#ffb765;font-weight:400;text-shadow:0 0 14px rgba(255,170,80,.8)}
/* "今日剩 N"那截：跟着计数一起显示，所以两个数一起动 */
.rb-count i{font-style:normal;margin-left:9px;color:rgba(255,255,255,.34);font-size:11px;letter-spacing:.1em}
.rb-count.rb-pop{animation:rb-pop .42s cubic-bezier(.2,1.5,.4,1)}
@keyframes rb-pop{0%{transform:scale(1)}35%{transform:scale(1.5)}100%{transform:scale(1)}}

.rb-dialog{position:absolute;left:50%;top:800px;width:1080px;margin-left:-540px;padding:20px 30px 24px;
  border:1px solid rgba(255,255,255,.22);background:linear-gradient(180deg,rgba(8,12,16,.82),rgba(0,0,0,.72));
  opacity:0;transform:translateY(14px);transition:opacity .45s ease,transform .45s ease}
.rb-dialog.rb-on{opacity:1;transform:none}
.rb-dialog::before{content:"";position:absolute;left:-1px;top:-1px;width:16px;height:16px;border-left:2px solid #fff;border-top:2px solid #fff}
.rb-dialog::after{content:"";position:absolute;right:-1px;bottom:-1px;width:16px;height:16px;border-right:2px solid #fff;border-bottom:2px solid #fff}
.rb-dname{position:absolute;left:24px;top:-15px;padding:3px 14px;background:#000;border:1px solid rgba(255,255,255,.3);
  font-family:var(--rb-mono);font-size:13px;letter-spacing:.24em;color:var(--rb-tech)}
.rb-dtext{font-size:24px;line-height:1.55;letter-spacing:.08em;color:#fff;min-height:38px;text-shadow:0 0 18px rgba(255,255,255,.22)}
.rb-dtext .rb-cur{display:inline-block;width:10px;height:22px;background:#fff;margin-left:6px;vertical-align:-3px;animation:rb-blink 1s steps(1,end) infinite}
.rb-endcard{position:absolute;left:50%;top:934px;width:900px;margin-left:-450px;text-align:center;opacity:0;
  transform:translateY(10px);transition:opacity .8s ease,transform .8s ease;pointer-events:none}
.rb-endcard.rb-on{opacity:1;transform:none}
.rb-end-main{font-family:var(--rb-mono);font-size:26px;letter-spacing:.5em;color:#fff;text-shadow:0 0 26px rgba(255,255,255,.5)}
.rb-end-main b{color:var(--rb-tech);font-weight:400}
.rb-end-sub{margin-top:12px;font-size:14px;letter-spacing:.24em;color:var(--rb-dim);animation:rb-soft 2.4s ease-in-out infinite}
@keyframes rb-soft{0%,100%{opacity:.5}50%{opacity:1}}
.rb-btn{position:absolute;font-family:var(--rb-mono);font-size:14px;letter-spacing:.2em;color:var(--rb-dim);
  background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.24);padding:9px 18px;cursor:pointer;opacity:0;
  transition:color .25s,border-color .25s,background .25s,opacity .4s}
.rb-btn.rb-show{opacity:1}
.rb-btn:hover{color:#000;background:#fff;border-color:#fff}
.rb-btn-sound{right:88px;bottom:118px}
.rb-btn-sound.rb-off{color:rgba(255,255,255,.25)}
.rb-frame i{position:absolute;width:34px;height:34px;opacity:0;transition:opacity .8s ease .4s}
.rb-frame i::before,.rb-frame i::after{content:"";position:absolute;background:rgba(255,255,255,.55)}
.rb-frame i::before{width:100%;height:1px}.rb-frame i::after{width:1px;height:100%}
.rb-frame i:nth-child(1){left:44px;top:44px}
.rb-frame i:nth-child(2){right:44px;top:44px;transform:rotate(90deg)}
.rb-frame i:nth-child(3){right:44px;bottom:44px;transform:rotate(180deg)}
.rb-frame i:nth-child(4){left:44px;bottom:44px;transform:rotate(270deg)}
.rb-stage.rb-run .rb-frame i{opacity:1}
.rb-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}
.rb-flash.rb-fire{animation:rb-flashhit .28s ease-out}
@keyframes rb-flashhit{0%{opacity:var(--rb-f,.6)}100%{opacity:0}}
.rb-tear{position:absolute;inset:0;pointer-events:none;opacity:0;mix-blend-mode:screen;
  background:repeating-linear-gradient(to bottom,rgba(255,255,255,.9) 0 2px,transparent 2px 7px,rgba(255,255,255,.5) 7px 8px,transparent 8px 23px)}
.rb-tear.rb-fire{animation:rb-tearhit .3s steps(3,end)}
@keyframes rb-tearhit{0%{opacity:0;transform:translateX(0)}20%{opacity:.5;transform:translateX(-22px)}
 50%{opacity:.32;transform:translateX(17px)}80%{opacity:.2;transform:translateX(-8px)}100%{opacity:0;transform:none}}
.rb-stage.rb-shake{animation:rb-shake .4s cubic-bezier(.36,.07,.19,.97)}
@keyframes rb-shake{0%,100%{transform:translate(-50%,-50%) scale(var(--rb-fit,1)) translate(0,0)}
 20%{transform:translate(-50%,-50%) scale(var(--rb-fit,1)) translate(-9px,4px)}
 40%{transform:translate(-50%,-50%) scale(var(--rb-fit,1)) translate(7px,-6px)}
 60%{transform:translate(-50%,-50%) scale(var(--rb-fit,1)) translate(-5px,3px)}
 80%{transform:translate(-50%,-50%) scale(var(--rb-fit,1)) translate(3px,-2px)}}
.rb-root.rb-fadeout .rb-stage{opacity:0;transition:opacity .6s ease}
`;

    /* ======================= 标记 ======================= */
    const HTML = `
<div class="rb-stage">
  <div class="rb-layer rb-grid"></div>
  <canvas class="rb-layer rb-grain" width="960" height="540"></canvas>
  <div class="rb-layer rb-scanlines"></div>
  <div class="rb-layer rb-vignette"></div>
  <div class="rb-power"></div>

  <div class="rb-hud rb-tl">
    <div class="rb-hud-title">RHODES ISLAND</div>
    <div class="rb-hud-sub">TERMINAL BOOT SEQUENCE</div>
    <div>PRTS <span class="rb-hl">v3.14</span> · NODE <span class="rb-hl" data-rb="node">----</span></div>
    <div>OPERATOR <span class="rb-hl">DOCTOR</span><span class="rb-caret"></span></div>
    <div class="rb-hud-bar"><i></i></div>
  </div>

  <div class="rb-hud rb-tr">
    <div>LINK <span class="rb-hl" data-rb="link">STANDBY</span></div>
    <div>SIGNAL <span class="rb-sig" data-rb="signal">▮▮▯▯▯</span></div>
    <div data-rb="clock">--:--:--</div>
  </div>

  <div class="rb-hud rb-bl"><div class="rb-log" data-rb="log"></div></div>
  <div class="rb-hud rb-br">© RHODES ISLAND PHARMACEUTICAL INC.</div>

  <div class="rb-hero" data-rb="hero">
    <div class="rb-logo-wrap" data-rb="logoWrap">
      <img class="rb-logo" data-rb="logo" src="${LOGO_URI}" alt="RHODES ISLAND">
      <span class="rb-logo-scan"></span>
    </div>
    <div class="rb-rule" data-rb="rule"><i></i><b></b><i></i></div>
    <div class="rb-subtitle" data-rb="subtitle">罗德岛制药 · RHODES ISLAND PHARMACEUTICAL INC.</div>
    <div class="rb-chip" data-rb="chip">PRTS KERNEL / BUILD 3.14.0921</div>
  </div>

  <div class="rb-progress" data-rb="progress">
    <div class="rb-progress-head">
      <span class="rb-plabel">LOADING</span>
      <span class="rb-pct" data-rb="pct">000<i>%</i></span>
    </div>
    <div class="rb-bar"><div class="rb-fill" data-rb="fill"><span class="rb-edge"></span></div><div class="rb-ticks"></div></div>
    <div class="rb-foot">
      <span class="rb-status"><span class="rb-arrow">▶</span><span data-rb="status">正在初始化…</span><span class="rb-caret"></span></span>
      <span class="rb-net" data-rb="net">NET <b>探测中…</b></span>
    </div>
  </div>

  <div class="rb-tip" data-rb="tip"></div>

  <div class="rb-rabbit" data-rb="rabbit">
    <div class="rb-count" data-rb="count">CARROT <b>×0</b></div>
    <div class="rb-hop" data-rb="hop">
      <div class="rb-shadow"></div>
      <img class="rb-rabbit-img" data-rb="rabbitImg" src="${RABBIT_URI}" alt="">
      <div class="rb-carrot" data-rb="carrot">
        <svg viewBox="0 0 120 100" aria-hidden="true">
          <defs><linearGradient id="rbCarrotGrad" x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0" stop-color="#ffd08a"/><stop offset="0.42" stop-color="#ff9a2e"/><stop offset="1" stop-color="#e0651a"/>
          </linearGradient></defs>
          <g>
            <ellipse cx="21" cy="30" rx="5.5" ry="12.5" transform="rotate(-38 21 30)" fill="#57c76e"/>
            <ellipse cx="30" cy="23" rx="5.5" ry="14" transform="rotate(-10 30 23)" fill="#77dd8c"/>
            <ellipse cx="38" cy="29" rx="5" ry="12" transform="rotate(22 38 29)" fill="#45ac5d"/>
          </g>
          <path d="M24 33 L104 50 L24 67 Z" fill="url(#rbCarrotGrad)" stroke="url(#rbCarrotGrad)" stroke-width="9" stroke-linejoin="round"/>
          <g stroke="rgba(255,255,255,.55)" stroke-width="2.6" stroke-linecap="round">
            <line x1="43" y1="40" x2="39" y2="61"/><line x1="61" y1="43" x2="58" y2="58"/><line x1="79" y1="46" x2="77" y2="55"/>
          </g>
        </svg>
      </div>
      <div class="rb-bite-ring" data-rb="bite"></div>
      <div class="rb-ring" data-rb="ring"></div>
    </div>
  </div>

  <div class="rb-dialog" data-rb="dialog">
    <div class="rb-dname" data-rb="dname">？？？</div>
    <div class="rb-dtext" data-rb="dtext"></div>
  </div>

  <div class="rb-endcard" data-rb="endcard">
    <div class="rb-end-main">SYSTEM <b>ONLINE</b></div>
    <div class="rb-end-sub">RHODES ISLAND · PRTS 就绪</div>
  </div>

  <button class="rb-btn rb-btn-sound" data-rb="sound" type="button">♪ SOUND</button>

  <div class="rb-frame"><i></i><i></i><i></i><i></i></div>
  <div class="rb-flash" data-rb="flash"></div>
  <div class="rb-tear" data-rb="tear"></div>
</div>`;

    /* ======================= 小工具 ======================= */
    const pad = (n, l) => String(n).padStart(l || 3, '0');
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const rnd = (a, b) => a + Math.random() * (b - a);
    const randHex = (n) => Array.from({ length: n }, () => '0123456789ABCDEF'[(Math.random() * 16) | 0]).join('');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    /* ======================= 网络探测 ======================= */
    const NET = { quality: 'unknown', rtt: 0, kbps: 0, effective: '', mult: 1, online: true, ready: false };

    function netInfo() {
      const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      return c || null;
    }
    async function probeOnce(timeout) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      const url = location.origin + location.pathname + (location.pathname.indexOf('?') < 0 ? '?_rb=' : '&_rb=') + Date.now();
      const t0 = performance.now();
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ac.signal, headers: { 'x-rhodes-boot': '1' } });
        const buf = await res.arrayBuffer();
        return { ok: true, ms: performance.now() - t0, bytes: buf.byteLength };
      } catch (e) {
        return { ok: false, ms: performance.now() - t0, bytes: 0 };
      } finally { clearTimeout(timer); }
    }
    async function measureNetwork() {
      NET.online = navigator.onLine !== false;
      const c = netInfo();
      NET.effective = c && c.effectiveType ? String(c.effectiveType) : '';
      if (!NET.online) { NET.quality = 'offline'; NET.mult = 1; NET.ready = true; return NET; }
      const ms = []; let bytes = 0;
      for (let i = 0; i < 3; i++) {
        const r = await probeOnce(2200);
        if (r.ok) { ms.push(r.ms); bytes += r.bytes; }
        else if (r.ms >= 2100) break;
        if (i < 2) await sleep(50);
      }
      if (!ms.length) {
        NET.quality = navigator.onLine === false ? 'offline' : 'poor';
      } else {
        ms.sort((a, b) => a - b);
        const med = ms[Math.floor(ms.length / 2)];
        NET.rtt = med;
        NET.kbps = bytes / Math.max(1, ms.reduce((a, b) => a + b, 0));
        NET.quality = med <= 120 ? 'fast' : med <= 380 ? 'normal' : med <= 900 ? 'slow' : 'poor';
        // 浏览器给的网络类型只用于下调，不上调
        if (NET.effective === 'slow-2g' || NET.effective === '2g') NET.quality = 'poor';
        else if (NET.effective === '3g' && (NET.quality === 'fast' || NET.quality === 'normal')) NET.quality = 'slow';
      }
      NET.mult = { fast: 0.82, normal: 1, slow: 1.32, poor: 1.62, offline: 1 }[NET.quality] || 1;
      NET.ready = true;
      return NET;
    }

    /* ======================= 引擎 ======================= */
    function createEngine(host) {
      const root = document.createElement('div');
      root.className = 'rb-root';
      root.innerHTML = '<style>' + CSS + '</style>' + HTML;
      host.appendChild(root);

      const q = (k) => root.querySelector('[data-rb="' + k + '"]');
      const el = {
        stage: root.querySelector('.rb-stage'), hero: q('hero'), logoWrap: q('logoWrap'), logo: q('logo'),
        rule: q('rule'), subtitle: q('subtitle'), chip: q('chip'), progress: q('progress'),
        fill: q('fill'), pct: q('pct'), status: q('status'), net: q('net'), tip: q('tip'), log: q('log'),
        rabbit: q('rabbit'), hop: q('hop'), rabbitImg: q('rabbitImg'), ring: q('ring'), bite: q('bite'),
        carrot: q('carrot'),
        count: q('count'), dialog: q('dialog'), dname: q('dname'), dtext: q('dtext'), endcard: q('endcard'),
        flash: q('flash'), tear: q('tear'), skip: q('skip'), sound: q('sound'),
        link: q('link'), signal: q('signal'), clock: q('clock'), node: q('node'),
        huds: [...root.querySelectorAll('.rb-hud')],
        btns: [q('sound')],
        cv: root.querySelector('.rb-grain'),
      };

      const S = { phase: 'idle', running: false, raf: 0, timers: [], eating: false, carrots: 0,
                  paused: false, pausedSince: 0, faded: false, lastTouch: 0 };
      const CLOCK = {
        later(ms, fn) { const id = setTimeout(() => { if (S.running) fn(); }, ms); S.timers.push(id); return id; },
        raf(fn) { S.raf = requestAnimationFrame(fn); return S.raf; },
        clear() { S.timers.forEach(clearTimeout); S.timers.length = 0; cancelAnimationFrame(S.raf); S.raf = 0; },
      };

      /* ---------- 音效 ---------- */
      const Sfx = (() => {
        let ac = null, master = null, on = SETTINGS.sound, drone = null, noiseBuf = null, pending = false;
        function ensure() {
          if (ac) return ac;
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          try {
            ac = new AC(); master = ac.createGain(); master.gain.value = on ? 0.9 : 0; master.connect(ac.destination);
          } catch (e) { ac = null; }
          return ac;
        }
        function silent() { return !ac || ac.state !== 'running' || !on; }
        function resume() {
          if (!ensure()) return;
          const go = () => { if (pending && !drone) { pending = false; startDrone(); } };
          if (ac.state === 'suspended') { const p = ac.resume(); if (p && p.then) p.then(go); else go(); } else go();
        }
        /* pan：-1 左 / 0 中 / 1 右。用在触摸音上——声音跟着戳的位置走，戳左边就偏左。
           浏览器没有 StereoPannerNode 时自动退回居中（不影响其它音效）。 */
        function panned(pan) {
          if (!pan) return master;
          try {
            if (ac.createStereoPanner) {
              const p = ac.createStereoPanner();
              p.pan.value = Math.max(-1, Math.min(1, pan));
              p.connect(master);
              return p;
            }
            if (ac.createPanner) {
              const p = ac.createPanner();
              p.panningModel = 'equalpower';
              p.setPosition(Math.max(-1, Math.min(1, pan)), 0, 1 - Math.abs(pan) * 0.5);
              p.connect(master);
              return p;
            }
          } catch (e) { /* noop */ }
          return master;
        }
        function tone(o) {
          if (silent()) return;
          const dst = panned(o.pan);
          const t0 = ac.currentTime + (o.delay || 0);
          const osc = ac.createOscillator(), g = ac.createGain();
          osc.type = o.type || 'sine';
          osc.frequency.setValueAtTime(o.freq, t0);
          if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(24, o.to), t0 + o.dur);
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.linearRampToValueAtTime(o.gain == null ? 0.12 : o.gain, t0 + (o.attack || 0.006));
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
          osc.connect(g).connect(dst);
          osc.start(t0); osc.stop(t0 + o.dur + 0.06);
        }
        function noise(o) {
          if (silent()) return;
          const dst = panned(o.pan);
          if (!noiseBuf) {
            noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 1.2), ac.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          }
          const t0 = ac.currentTime + (o.delay || 0);
          const src = ac.createBufferSource(); src.buffer = noiseBuf;
          const f = ac.createBiquadFilter(); f.type = o.type || 'lowpass';
          f.frequency.setValueAtTime(o.freq || 900, t0);
          if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + o.dur);
          const g = ac.createGain();
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.linearRampToValueAtTime(o.gain == null ? 0.15 : o.gain, t0 + (o.attack || 0.005));
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
          src.connect(f).connect(g).connect(dst);
          src.start(t0); src.stop(t0 + o.dur + 0.05);
        }
        function startDrone() {
          if (!ensure() || silent() || drone) return;
          const g = ac.createGain(); g.gain.value = 0.0001;
          g.gain.linearRampToValueAtTime(0.07, ac.currentTime + 2.0); g.connect(master);
          const a = ac.createOscillator(), b = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain();
          a.type = 'sine'; a.frequency.value = 55;
          b.type = 'triangle'; b.frequency.value = 82.5;
          lfo.frequency.value = 0.11; lg.gain.value = 0.03;
          lfo.connect(lg).connect(g.gain); a.connect(g); b.connect(g);
          a.start(); b.start(); lfo.start();
          drone = { a, b, lfo, g };
        }
        return {
          resume,
          get on() { return on; },
          set on(v) { on = v; if (master) master.gain.value = v ? 0.9 : 0; },
          get live() { return !!ac && ac.state === 'running'; },
          startDrone() { if (!ensure()) return; if (silent()) { pending = true; return; } startDrone(); },
          stopDrone() {
            pending = false;
            if (!drone) return;
            const d = drone; drone = null;
            try {
              d.g.gain.cancelScheduledValues(ac.currentTime);
              d.g.gain.setValueAtTime(d.g.gain.value, ac.currentTime);
              d.g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.6);
              [d.a, d.b, d.lfo].forEach((o) => o.stop(ac.currentTime + 0.7));
            } catch (e) { /* noop */ }
          },
          close() { try { if (ac && ac.close) ac.close(); } catch (e) { /* noop */ } ac = null; },
          blip(f, g) { tone({ freq: f || 1500, dur: 0.045, type: 'square', gain: g == null ? 0.045 : g }); },
          tick() { tone({ freq: 2400, dur: 0.03, type: 'triangle', gain: 0.03 }); },
          thud() { tone({ freq: 130, to: 42, dur: 0.5, type: 'sine', gain: 0.4 }); noise({ freq: 1800, to: 200, dur: 0.35, gain: 0.16 }); },
          charge() { tone({ freq: 220, to: 1500, dur: 0.9, type: 'sawtooth', gain: 0.1 }); noise({ freq: 300, to: 4200, dur: 0.95, gain: 0.1 }); },
          impact() { tone({ freq: 180, to: 30, dur: 0.7, type: 'sine', gain: 0.45 }); noise({ freq: 2600, to: 120, dur: 0.5, gain: 0.24 }); },
          boing() { tone({ freq: 300, to: 900, dur: 0.18, type: 'sine', gain: 0.16 }); tone({ freq: 900, to: 420, dur: 0.22, type: 'sine', gain: 0.12, delay: 0.16 }); },
          chord() { [261.6, 329.6, 392.0, 523.3].forEach((f, i) => tone({ freq: f, dur: 2.4, type: 'sine', gain: 0.07, delay: i * 0.09, attack: 0.35 })); },
          crunch() {
            noise({ freq: rnd(1800, 3000), to: rnd(500, 900), dur: 0.085, gain: 0.15, type: 'bandpass' });
            tone({ freq: rnd(150, 240), dur: 0.07, type: 'triangle', gain: 0.05 });
            tone({ freq: rnd(900, 1400), dur: 0.04, type: 'square', gain: 0.018, delay: 0.04 });
          },
          gulp() { tone({ freq: 320, to: 90, dur: 0.26, type: 'sine', gain: 0.09 }); },
          /* 专属「触摸」音：不是啃胡萝卜那种脆响，而是"被摸到"的软反应。
             三层：极短的绒毛摩擦 → 一声上扬的软"啾" → 一点高频小天使粉。
             freq 每次随机 ±10%，连点不会听出是同一个采样。pan 跟着戳的位置走。 */
          touch(pan) {
            noise({ freq: rnd(1000, 1900), to: rnd(320, 620), dur: 0.06, gain: 0.055, type: 'bandpass', pan });
            tone({ freq: rnd(700, 830), to: rnd(1240, 1460), dur: 0.13, type: 'sine', gain: 0.125, attack: 0.012, pan });
            tone({ freq: rnd(2300, 2700), to: rnd(3100, 3500), dur: 0.07, type: 'triangle', gain: 0.028, delay: 0.03, pan });
          },
          warn() { tone({ freq: 600, to: 400, dur: 0.18, type: 'square', gain: 0.05 }); },
        };
      })();

      /* ---------- 粒子 / 噪点 ---------- */
      const Fx = (() => {
        const ctx = el.cv.getContext('2d');
        const W = el.cv.width, H = el.cv.height;
        const tile = document.createElement('canvas'); tile.width = tile.height = 128;
        const tctx = tile.getContext('2d');
        const img = tctx.createImageData(128, 128);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = (Math.random() * 255) | 0;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
        }
        tctx.putImageData(img, 0, 0);
        const pattern = ctx.createPattern(tile, 'repeat');
        let parts = [], running = false;
        function frame() {
          if (!running) return;
          ctx.clearRect(0, 0, W, H);
          ctx.save();
          ctx.globalAlpha = SETTINGS.grain * (0.7 + Math.random() * 0.6);
          ctx.translate(-((Math.random() * 128) | 0), -((Math.random() * 128) | 0));
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, W + 128, H + 128);
          ctx.restore();
          if (parts.length) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let i = parts.length - 1; i >= 0; i--) {
              const p = parts[i];
              p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.965; p.vy *= 0.965;
              p.life -= p.decay;
              if (p.life <= 0) { parts.splice(i, 1); continue; }
              ctx.globalAlpha = Math.max(0, p.life);
              ctx.fillStyle = p.color;
              ctx.fillRect(p.x, p.y, p.s, p.s);
            }
            ctx.restore();
          }
          S.raf = requestAnimationFrame(frame);
        }
        return {
          start() { if (!running) { running = true; S.raf = requestAnimationFrame(frame); } },
          stop() { running = false; cancelAnimationFrame(S.raf); S.raf = 0; },
          clear() { parts = []; ctx.clearRect(0, 0, W, H); },
          burst(x, y, n, color) {
            for (let i = 0; i < (n || 30); i++) {
              const a = Math.random() * Math.PI * 2, sp = rnd(0.6, 4.6);
              parts.push({ x: x / 2, y: y / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8, g: 0.14,
                s: rnd(1, 3), life: 1, decay: rnd(0.02, 0.055), color: Math.random() < 0.35 ? '#9fd8ff' : (color || '#ffffff') });
            }
          },
        };
      })();

      /* ---------- 通用小动作 ---------- */
      function flash(power) {
        el.flash.style.setProperty('--rb-f', power == null ? 0.6 : power);
        el.flash.classList.remove('rb-fire'); void el.flash.offsetWidth; el.flash.classList.add('rb-fire');
      }
      function tear() { el.tear.classList.remove('rb-fire'); void el.tear.offsetWidth; el.tear.classList.add('rb-fire'); }
      function shake() {
        el.stage.classList.remove('rb-shake'); void el.stage.offsetWidth; el.stage.classList.add('rb-shake');
        setTimeout(() => el.stage.classList.remove('rb-shake'), 460);
      }
      /* 起手通电：重放一次 rb-power 动画（元素在模板里，用重排强制重启动画） */
      function powerOn() {
        const p = root.querySelector('.rb-power');
        if (!p) return;
        p.style.animation = 'none';
        void p.offsetWidth;
        p.style.animation = '';
      }
      function setPct(v) {
        const n = Math.max(0, Math.min(100, v));
        el.fill.style.width = n + '%';
        el.pct.innerHTML = pad(Math.floor(n)) + '<i>%</i>';
        const bars = Math.max(1, Math.min(5, Math.ceil(n / 20)));
        el.signal.textContent = '▮'.repeat(bars) + '▯'.repeat(5 - bars);
      }
      function setStatus(t) { el.status.textContent = t; }
      function setLink(t) { el.link.textContent = t; }
      function netLabel() {
        const tag = { fast: 'GOOD', normal: 'FAIR', slow: 'SLOW', poor: 'POOR', offline: 'LOST', unknown: 'PROBING' }[NET.quality] || '—';
        const cls = NET.quality === 'fast' || NET.quality === 'normal' ? '' : (NET.quality === 'slow' ? ' rb-warn' : ' rb-bad');
        const rtt = NET.rtt ? Math.round(NET.rtt) + 'ms' : '—';
        const eff = NET.effective ? ' · ' + NET.effective : '';
        el.net.className = 'rb-net' + cls;
        el.net.innerHTML = 'NET <b>' + rtt + eff + ' · ' + tag + '</b>';
      }
      function pushLog(msg, tag) {
        const d = new Date();
        const t = pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
        const row = document.createElement('div');
        row.innerHTML = '<span class="rb-t">[' + t + ']</span>' + esc(msg) + (tag ? '<span class="rb-ok">' + esc(tag) + '</span>' : '');
        el.log.appendChild(row);
        requestAnimationFrame(() => row.classList.add('rb-on'));
        while (el.log.children.length > 7) el.log.removeChild(el.log.firstChild);
      }

      /* ---------- 兔子 / 胡萝卜 ---------- */
      function hop(big) {
        if (S.phase === 'end') return;
        el.hop.classList.remove('rb-doing', 'rb-big');
        void el.hop.offsetWidth;
        el.hop.classList.add(big ? 'rb-big' : 'rb-doing');
        if (big) { Sfx.thud(); Fx.burst(1416, 1030, 12); } else Sfx.blip(rnd(700, 950), 0.03);
      }
      function hopLoop() {
        if (!S.running || S.phase !== 'run' || S.eating) { CLOCK.later(600, hopLoop); return; }
        hop(Math.random() < 0.22);
        CLOCK.later(rnd(SETTINGS.hopInterval[0], SETTINGS.hopInterval[1]), hopLoop);
      }
      function rabbitIn() { el.rabbit.classList.add('rb-on'); hop(true); CLOCK.later(700, () => hop(false)); }
      function ringBurst() { el.ring.classList.remove('rb-burst'); void el.ring.offsetWidth; el.ring.classList.add('rb-burst'); }
      function mouthPoint() {
        const r = el.rabbitImg.getBoundingClientRect();
        const st = el.stage.getBoundingClientRect();
        const k = 1920 / (st.width || 1920);
        return { x: (r.left - st.left + r.width * 0.55) * k, y: (r.top - st.top + r.height * 0.30) * k };
      }
      const pick = (arr) => arr[(Math.random() * arr.length) | 0];
      /* kind: '' 咀嚼音（橙） / 'mood' 情绪（粉） / 'click' 被戳（青） */
      function floatWord(text, kind) {
        const p = mouthPoint();
        const w = document.createElement('div');
        w.className = 'rb-word' + (kind === 'click' ? ' rb-click' : kind === 'mood' ? ' rb-mood' : '');
        w.textContent = text;
        w.style.left = (p.x + 52) + 'px';
        w.style.top = (p.y - 44) + 'px';
        el.stage.appendChild(w);
        setTimeout(() => w.remove(), 1200);
      }
      /* 咬一口：兔子明显缩一下 + 嘴边橙色小圈炸开 + 一把胡萝卜渣飞出来 */
      function chomp() {
        el.rabbitImg.classList.remove('rb-chomp'); void el.rabbitImg.offsetWidth; el.rabbitImg.classList.add('rb-chomp');
        Sfx.crunch();
        const p = mouthPoint();
        el.bite.classList.remove('rb-bite'); void el.bite.offsetWidth; el.bite.classList.add('rb-bite');
        Fx.burst(p.x + 12, p.y + 8, 16, '#ffb765');
        Fx.burst(p.x + 6, p.y + 2, 6, '#ffffff');
      }
      /* 兔子身上任意一点都算命中：用实时外框判定，连透明边角、跳跃中、放大后都有效 */
      function hitRabbit(x, y) {
        try {
          const r = el.rabbitImg.getBoundingClientRect();
          const pad = 6;
          return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
        } catch (e) { return false; }
      }
      function carrotReset() { el.carrot.classList.remove('rb-show'); el.carrot.style.transform = ''; S.eating = false; }
      function eatCarrot(byClick) {
        if (!SETTINGS.carrot || S.eating || S.phase !== 'run') return false;
        /* 启动动画里的喂食**纯互动**：不扣库存、不算等级、不进累计。
           这里原本会调 supplyTake(1) 并校验 supplyAvailable()，但那样开场表演
           就成了消耗品 —— 而且一旦要写供应记录，就得连经验/累计一起考虑，
           两个插件只能靠同一条 localStorage 记录同步，很容易互相覆盖。
           现在胡萝卜与进度只由桌宠（dsh-rhodes-pet）维护，这边只负责好看。
           （终章那句报的数字仍然是桌宠那边的真实值，走只读的 supplyRead。） */
        S.eating = true;
        /* CARROT ×N 是**本次动画内**的计数：启动动画只跑一次，所以尾数不会很大。
           它和桌宠面板上的累计数不是一回事，两边不该互相对齐（一个是表演，一个是养成）。 */
        S.carrots++;
        el.count.innerHTML = 'CARROT <b>×' + S.carrots + '</b>';
        el.count.classList.add('rb-on');
        el.count.classList.remove('rb-pop'); void el.count.offsetWidth; el.count.classList.add('rb-pop');
        if (byClick) {
          /* 戳出来的：胡萝卜从左边飞过来，反馈更明确 */
          el.carrot.style.transition = 'none';
          el.carrot.style.transform = 'translateX(-120px) rotate(-52deg) scale(.45)';
          void el.carrot.offsetWidth;
          el.carrot.style.transition = '';
          /* （原来这里是一声 blip + 一个 clickWords 词当作"开始喂"的提示——
             现在触摸本身就是一次独立反馈：音效由 Sfx.touch 出，词由 touchRabbit 飘。
             这里再飘一个会和摸词叠在一起，所以撤掉；clickWords 保留给老配置/手动调用。） */
          const p0 = mouthPoint();
          Fx.burst(p0.x + 4, p0.y - 6, 18, '#9fd8ff');
        }
        el.carrot.classList.add('rb-show');
        requestAnimationFrame(() => { el.carrot.style.transform = 'rotate(-9deg) scale(1)'; });
        const bites = Math.round(rnd(SETTINGS.carrotBites[0], SETTINGS.carrotBites[1]));
        let i = 0;
        const bite = () => {
          if (!S.running) return;
          i++;
          const k = Math.max(0.02, 1 - i / (bites + 0.5));
          el.carrot.style.transform = 'rotate(' + rnd(-16, 1).toFixed(1) + 'deg) scale(' + k.toFixed(3) + ')';
          chomp();
          if (i === bites) {
            floatWord(pick(SETTINGS.finishWords), 'mood');
          } else if (Math.random() < 0.42) {
            /* 情绪词：粉色，另配一把粉色碎屑 */
            floatWord(pick(SETTINGS.moodWords), 'mood');
            const pm = mouthPoint();
            Fx.burst(pm.x + 14, pm.y - 4, 10, '#ffb6d5');
          } else {
            floatWord(pick(SETTINGS.biteWords));
          }
          if (i < bites) CLOCK.later(320 + Math.random() * 170, bite);
          else CLOCK.later(320, () => {
            const p = mouthPoint();
            Fx.burst(p.x + 8, p.y + 4, 22, '#ffb765');
            Sfx.gulp();
            carrotReset();
          });
        };
        CLOCK.later(440, bite);
        return true;
      }
      /* 这里原来有一条"兔兔自己随机掏胡萝卜啃"的排程链（scheduleCarrot）。
         已按要求去掉：启动动画里兔兔**不再自动吃**，只有你戳她才会喂一根。
         所以那个函数整个删了，不再有定时器。 */

      /* ---------- 日志 / 提示 ---------- */
      function logsStart() {
        let i = 0;
        const push = () => {
          if (i < SETTINGS.logs.length) {
            pushLog(SETTINGS.logs[i][0], SETTINGS.logs[i][1]);
            Sfx.blip(rnd(1200, 1700), 0.028);
            i++;
            CLOCK.later(rnd(420, 700), push);
          }
        };
        push();
      }
      function tipsStart() {
        el.tip.classList.add('rb-on');
        let i = 0;
        const next = () => {
          el.tip.style.opacity = 0;
          CLOCK.later(360, () => { el.tip.textContent = SETTINGS.tips[i++ % SETTINGS.tips.length]; el.tip.style.opacity = ''; });
          CLOCK.later(2600, next);
        };
        next();
      }

      /* ---------- 进度（受网络影响） ---------- */
      function buildSegments() {
        const list = [
          { to: 24, dur: 620, msg: '正在校验本地资源…', link: 'SYNCING' },
          { to: 24, dur: 420, stall: true },
          { to: 48, dur: 760, msg: '载入干员档案 (247)…', link: 'LOADING' },
          { to: 48, dur: 520, stall: true },
          { to: 70, dur: 680, msg: '同步 PRTS 数据库…', link: 'SYNCING' },
          { to: 70, dur: 500, stall: true },
          { to: 88, dur: 600, msg: '建立神经链路…', link: 'LINKING' },
          { to: 88, dur: 520, stall: true },
          { to: 100, dur: 580, msg: '连接完成，等待确认…', link: 'STABLE' },
        ];
        if (NET.quality === 'slow' || NET.quality === 'poor') {
          list.splice(6, 0, { to: 70, dur: NET.quality === 'poor' ? 900 : 560, stall: true,
            msg: '网络延迟较高，正在重试…', link: 'RETRY' });
        }
        return list;
      }
      function progressRun() {
        const list = buildSegments();
        let i = 0, val = 0;
        const ease = (k) => 1 - Math.pow(1 - k, 2.4);
        const step = () => {
          if (!S.running) return;
          const seg = list[i++];
          if (!seg) { setPct(100); finale(); return; }
          if (seg.msg) setStatus(seg.msg);
          if (seg.link) setLink(seg.link);
          const from = val, to = seg.to;
          const dur = seg.stall ? seg.dur : seg.dur * (NET.mult || 1);
          const t0 = performance.now();
          const tween = (now) => {
            if (!S.running) return;
            if (S.paused) {                                    // 断网：冻结进度
              if (now - S.pausedSince > 4000) {                // 断开太久就继续，别卡死
                S.paused = false;
                setStatus('以离线模式继续启动…');
                setLink('OFFLINE');
              } else { CLOCK.raf(tween); return; }
            }
            const k = Math.min(1, (now - t0) / dur);
            if (seg.stall) {
              val = from + Math.sin(now / 130) * 0.35;
              setPct(val);
              if (k < 1) { CLOCK.raf(tween); return; }
              val = to; setPct(val); next(); return;
            }
            const prev = Math.floor(val);
            val = from + (to - from) * ease(k);
            setPct(val);
            if (Math.floor(val) !== prev && Math.floor(val) % 10 === 0) Sfx.tick();
            if (k < 1) { CLOCK.raf(tween); return; }
            val = to; setPct(val); next();
          };
          const next = () => {
            // 网络不好时，段与段之间多插一次「重试」停顿
            const chance = { fast: 0, normal: 0.16, slow: 0.5, poor: 0.8 }[NET.quality] || 0;
            if (i < list.length && Math.random() < chance) {
              list.splice(i, 0, { to: val, dur: 280 + Math.random() * 420, stall: true,
                msg: '网络不稳定，重试中…', link: 'RETRY' });
            }
            step();
          };
          CLOCK.raf(tween);
        };
        step();
      }

      /* ---------- 收尾 ---------- */
      function finale() {
        S.phase = 'finale';
        carrotReset();
        el.count.classList.remove('rb-on');
        CLOCK.clear(); S.running = true;
        Fx.stop();
        setPct(100);
        setStatus(NET.quality === 'poor' || NET.quality === 'offline' ? '链路质量较差，已降级启动 · LINK DEGRADED' : '连接完成 · LINK ESTABLISHED');
        Sfx.charge(); flash(0.85); tear(); shake();
        CLOCK.later(140, () => { el.logoWrap.classList.add('rb-glitch'); tear(); Sfx.impact(); Fx.burst(960, 340, 26); Fx.start(); });
        CLOCK.later(520, () => el.logoWrap.classList.remove('rb-glitch'));
        CLOCK.later(300, () => {
          el.progress.classList.add('rb-dim'); el.tip.classList.add('rb-dim');
          el.hero.classList.add('rb-shift', 'rb-dim');
          el.hop.classList.remove('rb-doing', 'rb-big');
          el.rabbit.classList.add('rb-center');
          CLOCK.later(340, () => { ringBurst(); Fx.burst(960, 600, 60); Sfx.boing(); flash(0.5); tear(); shake(); });
          CLOCK.later(1250, () => hop(false));
        });
        CLOCK.later(1150, () => { el.dialog.classList.add('rb-on'); typeDialog(); });
      }
      function typeDialog() {
        const beats = SETTINGS.dialog;
        let li = 0;
        const nextLine = () => {
          if (!S.running) return;
          if (li >= beats.length) { CLOCK.later(420, endSequence); return; }
          const beat = beats[li++];
          /* 台词池的每一项可以是：字符串 / 字符串数组（随机挑一条）/ 函数（现算一条）。
             函数形式是给"今日补给 +N 根"这种实时数字用的 —— 数字要在这一拍真的要显示时
             才去取，不能在建配置的时候就定死。

             注意这里**必须递归解包**：台词池里可能出现"数组里混着函数"
             （比如最后那一拍就是 [字符串, 字符串, 函数]）。早先的写法是
             `typeof beat.text === 'function' ? beat.text() : beat.text` 然后
             `pick()`，于是从数组里挑到函数之后就再也没被调用过，
             函数被 String() 一串 —— **整段源码被当成台词逐字打了出来**（踩过）。
             所以顺序是：先解包，直到拿到真正的字符串，最后才挑。 */
          const resolveText = (v) => {
            if (Array.isArray(v)) return resolveText(pick(v));
            if (typeof v === 'function') return resolveText(v());
            return v;
          };
          let text = resolveText(beat.text);
          if (typeof text !== 'string') text = String(text == null ? '' : text);
          el.dname.textContent = beat.name;
          el.dtext.innerHTML = '<span class="rb-cur"></span>';
          let i = 0;
          const tick = () => {
            if (!S.running) return;
            i++;
            el.dtext.innerHTML = esc(text.slice(0, i)) + '<span class="rb-cur"></span>';
            if (i % 2 === 0) Sfx.blip(rnd(1050, 1450), 0.03);
            if (i < text.length) CLOCK.later(SETTINGS.dialogSpeedMs, tick);
            else CLOCK.later(SETTINGS.dialogGapMs, nextLine);
          };
          tick();
        };
        nextLine();
      }
      function endSequence() {
        S.phase = 'end';
        setLink('STABLE');
        setStatus('系统就绪 · SYSTEM ONLINE');
        pushLog('系统就绪，等待指令。', 'READY');
        el.rabbit.classList.remove('rb-center');
        el.rabbit.classList.add('rb-off');
        CLOCK.later(500, () => el.dialog.classList.remove('rb-on'));
        CLOCK.later(700, () => {
          el.hero.classList.remove('rb-shift', 'rb-dim');
          el.progress.classList.remove('rb-dim'); el.tip.classList.remove('rb-dim');
          el.tip.classList.add('rb-hide');
          el.endcard.classList.add('rb-on');
          Sfx.chord(); flash(0.35);
        });
        Sfx.stopDrone();
        CLOCK.later(SETTINGS.holdEnd, dismiss);
      }
      function dismiss() {
        if (S.faded) return;
        S.faded = true;
        S.phase = 'done';
        root.classList.remove('rb-active');
        root.classList.add('rb-fadeout');
        CLOCK.later(700, () => { Fx.stop(); Sfx.stopDrone(); });
        /* 等淡出（.6s）真的走完再放行被压住的挂件 —— 不然它会从正在淡出的启动画面上冒出来。
           S.phase 守卫：这中间要是又 play() 了一次（控制台），这次放行就作废。 */
        CLOCK.later(660, () => { if (S.phase === 'done') suppressOthers(false); });
      }

      /* ---------- 启动 / （控制台用的）收尾 ---------- */
      function reset() {
        CLOCK.clear();
        S.running = true; S.phase = 'run'; S.faded = false; S.paused = false;
        S.carrots = 0;      // CARROT ×N 只数本次动画里喂的，不吃桌宠的累计数
        root.classList.add('rb-active'); root.classList.remove('rb-fadeout');
        el.stage.classList.add('rb-run'); el.stage.classList.remove('rb-shake');
        root.querySelectorAll('.rb-power').forEach((n) => { n.style.animation = 'none'; });
        el.huds.forEach((x) => x.classList.remove('rb-show'));
        el.btns.forEach((x) => x.classList.remove('rb-show'));
        el.logoWrap.classList.remove('rb-slam', 'rb-scan', 'rb-settle', 'rb-glitch');
        [el.rule, el.subtitle, el.chip, el.progress, el.tip, el.endcard, el.dialog, el.hero]
          .forEach((x) => x.classList.remove('rb-on', 'rb-dim', 'rb-hide', 'rb-shift'));
        el.rabbit.classList.remove('rb-on', 'rb-center', 'rb-off');
        el.hop.classList.remove('rb-doing', 'rb-big');
        el.ring.classList.remove('rb-burst');
        el.rabbitImg.classList.remove('rb-chomp');
        carrotReset();
        el.count.innerHTML = 'CARROT <b>×0</b>';
        el.count.classList.remove('rb-on');
        root.querySelectorAll('.rb-word').forEach((n) => n.remove());
        setPct(0); setStatus('正在初始化…'); setLink('STANDBY');
        el.log.innerHTML = ''; el.tip.textContent = ''; el.tip.style.opacity = '';
        el.dtext.innerHTML = ''; el.dname.textContent = '？？？';
        Fx.clear();
      }
      function play() {
        reset();
        suppressOthers(true);              // 每次真播都重新压住挂件（含控制台重播）
        el.node.textContent = randHex(4);
        netLabel();
        Sfx.startDrone();
        Fx.start();
        /* 起手：CRT 通电（一条白线先横向拉开、再纵向撑成一束光）—— 不再是"什么都没有时扫过一道光" */
        powerOn();
        el.huds.forEach((x, i) => CLOCK.later(60 + i * 90, () => x.classList.add('rb-show')));
        el.btns.forEach((x, i) => CLOCK.later(1400 + i * 120, () => x.classList.add('rb-show')));
        CLOCK.later(240, () => {
          el.logoWrap.classList.add('rb-slam');
          flash(0.6); tear(); shake(); Sfx.thud();
          CLOCK.later(420, () => el.logoWrap.classList.add('rb-scan'));
          CLOCK.later(720, () => { el.logoWrap.classList.remove('rb-slam'); el.logoWrap.classList.add('rb-settle'); });
        });
        CLOCK.later(760, () => {
          el.rule.classList.add('rb-on');
          CLOCK.later(150, () => { el.subtitle.classList.add('rb-on'); Sfx.blip(880, 0.04); });
          CLOCK.later(330, () => { el.chip.classList.add('rb-on'); Sfx.blip(1180, 0.04); });
        });
        CLOCK.later(1180, () => el.progress.classList.add('rb-on'));
        CLOCK.later(1260, () => {
          logsStart();
          if (NET.ready) netLabel();
          progressRun();
        });
        CLOCK.later(1300, rabbitIn);
        CLOCK.later(1560, hopLoop);
        CLOCK.later(1760, tipsStart);
        /* 原来这里会排一次"随机自动啃胡萝卜"（CLOCK.later(2060, scheduleCarrot)）。
           已去掉：兔兔不再自己吃，只有戳她才会喂。 */
        // 网络探测：动画照常在跑，结果到了就自适应（后续分段立刻变快/变慢）
        measureNetwork().then(() => {
          netLabel();
          if (!S.running || S.phase !== 'run') return;
          if (NET.quality === 'slow' || NET.quality === 'poor') {
            Sfx.warn(); tear();
            setStatus(NET.quality === 'poor' ? '网络状况较差，正在降速重试…' : '网络延迟偏高，正在重试…');
            setLink('RETRY');
          } else if (NET.quality === 'offline') {
            setStatus('网络已断开 · LINK LOST'); setLink('OFFLINE');
          }
        });
      }

      /* ---------- 交互 ---------- */
      function skip() {
        if (S.phase === 'run' || S.phase === 'finale') { flash(0.5); applyEnd(); }
        else if (S.phase === 'end') play();
      }
      function applyEnd() {
        CLOCK.clear(); S.running = true; S.phase = 'end';
        el.huds.forEach((x) => x.classList.add('rb-show'));
        el.btns.forEach((x) => x.classList.add('rb-show'));
        el.logoWrap.classList.remove('rb-slam', 'rb-scan', 'rb-glitch'); el.logoWrap.classList.add('rb-settle');
        [el.rule, el.subtitle, el.chip, el.progress, el.tip, el.endcard].forEach((x) => x.classList.add('rb-on'));
        el.progress.classList.remove('rb-dim'); el.tip.classList.remove('rb-dim'); el.tip.classList.add('rb-hide');
        el.hero.classList.remove('rb-shift', 'rb-dim');
        el.dialog.classList.remove('rb-on');
        el.rabbit.classList.remove('rb-on', 'rb-center'); el.rabbit.classList.add('rb-off');
        carrotReset();
        setPct(100); setStatus('系统就绪 · SYSTEM ONLINE'); setLink('STABLE');
        if (!el.log.children.length) SETTINGS.logs.slice(0, 5).forEach((l) => pushLog(l[0], l[1]));
        pushLog('已直接进入就绪状态。', 'READY');
        Fx.stop(); Fx.clear(); Sfx.stopDrone();
        CLOCK.later(SETTINGS.holdEnd, dismiss);
      }
      /* 交互：不提供跳过 / 重播 —— 只保留"戳兔子"。
         命中判定用兔子的实时外框，身上任意一点（含透明边角、跳起来时）都算。 */
      /* 触摸（摸头/摸身）：专属音效 + 一声轻跳 + 青色摸词，声音按戳的位置左右偏。
         连点节流：SETTINGS.touchCooldownMs 内的第二次触摸整体忽略（连点不会连成机关枪）；
         喂食不受节流影响——eatCarrot 自己有 S.eating 守卫，啃得正欢时不会再塞一根。 */
      function touchRabbit(clientX) {
        const now = performance.now();
        if (now - S.lastTouch < SETTINGS.touchCooldownMs) return false;
        S.lastTouch = now;
        let pan = 0;
        try {
          const r = el.rabbitImg.getBoundingClientRect();
          if (r.width) pan = Math.max(-1, Math.min(1, ((clientX - r.left) / r.width) * 2 - 1)) * 0.65;
        } catch (e) { /* 拿不到外框就居中 */ }
        Sfx.touch(pan);
        hop(false);
        floatWord(pick(SETTINGS.touchWords), 'click');
        return true;
      }
      const onPointer = (e) => {
        if (e.target.closest('button')) return;                 // 音效按钮照旧
        if (S.phase !== 'run') return;
        if (!hitRabbit(e.clientX, e.clientY)) return;
        Sfx.resume();
        touchRabbit(e.clientX);
        eatCarrot(true);
      };
      function soundBtnClick() {
        Sfx.on = !Sfx.on; Sfx.resume();
        el.sound.classList.toggle('rb-off', !Sfx.on);
        updateButtons();
      }
      function updateButtons() {
        const live = Sfx.live;
        el.sound.textContent = !Sfx.on ? '♪ MUTED' : (live ? '♪ SOUND' : '♪ 点击开启音效');
        el.sound.classList.toggle('rb-off', !Sfx.on);
      }
      /* 断网/恢复：冻结或冲一下进度 */
      const onOffline = () => {
        NET.online = false; NET.quality = 'offline'; NET.ready = true;
        netLabel();
        if (S.phase !== 'run') return;
        S.paused = true; S.pausedSince = performance.now();
        setStatus('网络已断开 · LINK LOST'); setLink('OFFLINE');
        Sfx.warn(); tear();
        pushLog('网络已断开，等待重连…', 'LOST');
      };
      const onOnline = () => {
        NET.online = true;
        if (S.phase === 'run' && S.paused) {
          S.paused = false;
          setStatus('链路已恢复，继续加载…'); setLink('RECONNECT');
          flash(0.4); tear(); pushLog('链路已恢复。', 'OK');
        }
        measureNetwork().then(netLabel);
      };
      const onConnectionReset = () => pushLog('终端链路已重新建立。', 'OK');

      /* 只挂在 root 上：兔子任意一点由 hitRabbit 判定，避免重复绑定 */
      root.addEventListener('pointerdown', onPointer);
      el.sound.addEventListener('click', (e) => { e.stopPropagation(); Sfx.resume(); soundBtnClick(); });
      window.addEventListener('offline', onOffline);
      window.addEventListener('online', onOnline);
      const onResize = () => fit();
      window.addEventListener('resize', onResize);
      const clockTimer = setInterval(() => {
        const d = new Date();
        el.clock.textContent = pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
        updateButtons();
      }, 400);
      function fit() {
        const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
        root.style.setProperty('--rb-fit', s.toFixed(4));
      }
      fit();
      updateButtons();

      return {
        play,
        skip,                              // 只留给控制台手柄，界面上没有任何跳过/重播入口
        eat: () => eatCarrot(true),
        onConnectionReset,
        dispose() {
          S.running = false; S.phase = 'disposed';
          CLOCK.clear();
          clearInterval(clockTimer);
          root.removeEventListener('pointerdown', onPointer);
          window.removeEventListener('offline', onOffline);
          window.removeEventListener('online', onOnline);
          window.removeEventListener('resize', onResize);
          Fx.stop(); Sfx.stopDrone(); Sfx.close();
          suppressOthers(false);           // 组件被卸载：压住的东西必须放行
          root.remove();
        },
      };
    }

    /* ======================= 播放时机判定 ======================= */
    function today() {
      const d = new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
    }
    function mode() {
      try {
        const m = localStorage.getItem(SETTINGS.modeKey);
        if (m === 'launch' || m === 'daily' || m === 'off') return m;
      } catch (e) { /* noop */ }
      return SETTINGS.playMode;
    }
    /* 只在"完全退出再打开"（新会话）时播；同一次会话里刷新、最小化恢复都不重播。
       allowReplay 仅供显式调用（控制台 .play()），默认路径不传。 */
    function shouldAutoPlay(allowReplay) {
      try {
        if (localStorage.getItem(SETTINGS.offKey) === '1') return false;
        const m = mode();
        if (m === 'off') return false;
        if (m === 'daily') return localStorage.getItem(SETTINGS.storeKey) !== today();
        /* launch：以「会话」为单位 —— 退出应用再进来是全新会话，必播；
           同一次会话里刷新页面不重播（防 F5 刷屏）。 */
        if (!allowReplay && sessionStorage.getItem(SETTINGS.sessionKey) === '1') return false;
        const at = Number(localStorage.getItem(SETTINGS.atKey) || 0);
        return !at || Date.now() - at > SETTINGS.minIntervalMs;
      } catch (e) { return true; }
    }
    function markPlayed() {
      try {
        localStorage.setItem(SETTINGS.storeKey, today());
        localStorage.setItem(SETTINGS.atKey, String(Date.now()));
        sessionStorage.setItem(SETTINGS.sessionKey, '1');
      } catch (e) { /* noop */ }
    }
    /* 等页面真的可见再开播：Electron 可能先把页面装配好、窗口稍后才显示，
       否则 10 秒动画会在你看到窗口之前就播完了。返回取消函数。 */
    function whenVisible(delay, cb) {
      let done = false, timer = 0;
      const run = () => {
        if (done) return;
        done = true;
        document.removeEventListener('visibilitychange', onVis);
        clearTimeout(timer);
        timer = setTimeout(cb, delay || 0);
      };
      const onVis = () => { if (document.visibilityState === 'visible') run(); };
      if (document.visibilityState === 'visible') run();
      else {
        document.addEventListener('visibilitychange', onVis);
        timer = setTimeout(run, 25000);          // 兜底：一直不可见也先挂上
      }
      return () => { done = true; document.removeEventListener('visibilitychange', onVis); clearTimeout(timer); };
    }

    /* ======================= 播放期间压住其它插件 UI =======================
       启动序列只占 .rb-root/.rb-stage 这一层（z-index 9），而别的插件浮层是直接挂在
       <body> 上的 fixed 元素、层级比它高（余额鲸鱼挂件 = z-index 9999），于是整段动画里
       那只鲸鱼和它的余额泡泡都浮在启动画面上。这里在动画期间插一条 CSS 把它们压住，
       动画淡出结束后再撤掉 —— 看到的效果就是「启动序列播完，挂件才出现」。

       用 visibility:hidden 而不是 display:none：保留布局与盒子尺寸，挂件自己那套
       尺寸测量/吸附计算不受影响；顺带也让它收不到点击（动画期间整帧归动画）。
       整条逻辑是幂等的（按 id 查），多路径重复调用也只会有一条 style。            */
    const SUPPRESS_ID = 'rb-suppress-others';
    function suppressOthers(on) {
      try {
        const head = document.head || document.documentElement;
        if (!head) return;
        const old = document.getElementById(SUPPRESS_ID);
        if (!on) {
          if (old && old.parentNode) old.parentNode.removeChild(old);
          return;
        }
        if (old) return;                       // 已经有了，别叠第二条
        const list = (SETTINGS.hideOthersWhilePlaying || []).filter(Boolean);
        if (!list.length) return;
        const style = document.createElement('style');
        style.id = SUPPRESS_ID;
        style.textContent = list.join(',') +
          '{visibility:hidden !important;opacity:0 !important;pointer-events:none !important}';
        head.appendChild(style);
      } catch (e) { /* 压不住也不能影响动画本身 */ }
    }

    /* ======================= 开机黑幕 =======================
       目标：从「应用还在 Loading plugins…」这一刻起就由启动动画占屏，而不是等对话界面
       渲染出来之后才在它上面播。客户端模块是在插件加载阶段被 apply 的，那时界面还没画，
       所以在这里铺幕是最可靠的一层（不依赖 Host 的 index 注入是否生效）。            */
    const COVER_ID = 'rb-boot-cover';

    function coverElement() {
      try { return document.getElementById(COVER_ID); } catch (e) { return null; }
    }
    function releaseCover() {
      try {
        if (window.__rhodesCover && typeof window.__rhodesCover.release === 'function') window.__rhodesCover.release();
      } catch (e) { /* noop */ }
      const el = coverElement();
      if (el && el.parentNode) el.parentNode.removeChild(el);   // 兜底：万一不是我们那套
      try { window.__rhodesCover = null; } catch (e) { /* noop */ }
      try {
        if (!localStorage.getItem('dsh-rhodesBoot.coverEnd')) {
          localStorage.setItem('dsh-rhodesBoot.coverEnd', 'released@' + Math.round(performance.now()));
        }
      } catch (e) { /* noop */ }
    }
    function releaseCoverSoon() {
      if (typeof requestAnimationFrame !== 'function') { releaseCover(); return; }
      requestAnimationFrame(() => requestAnimationFrame(releaseCover));
    }
    /* 自证标记：事后能从磁盘上的 localStorage 读出到底哪一层铺的幕、什么时候铺的 */
    function markCover(channel) {
      try {
        const k = 'dsh-rhodesBoot.cover';
        const v = localStorage.getItem(k) || '';
        if (v.indexOf(channel) < 0) localStorage.setItem(k, v ? v + ',' + channel : channel);
        if (!localStorage.getItem('dsh-rhodesBoot.coverAt')) {
          localStorage.setItem('dsh-rhodesBoot.coverAt', channel + '@' + Math.round(performance.now()));
        }
      } catch (e) { /* noop */ }
    }
    function raiseCover() {
      try {
        if (coverElement()) return;            // 已经有了（多半是 Host 注入的那层）
        markCover('client');
        if (!shouldAutoPlay()) return;         // 这次不播就别挡着
        const cover = document.createElement('div');
        cover.id = COVER_ID;
        cover.setAttribute('aria-hidden', 'true');
        cover.setAttribute('style',
          'position:fixed;left:0;top:0;right:0;bottom:0;width:100%;height:100%;background:#000;z-index:2147483000;');
        /* 启动指示：一行小字 + 呼吸的点 + 来回扫的细线（和 Host 那层长得一样） */
        const box = document.createElement('div');
        box.setAttribute('style',
          'position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);text-align:center;' +
          'opacity:0;transition:opacity .45s ease;');
        const line = document.createElement('div');
        line.setAttribute('style',
          'color:#9fd8ff;font:12px/1.6 Consolas,Menlo,monospace;letter-spacing:.34em;white-space:nowrap;');
        line.textContent = 'PRTS BOOT SEQUENCE';
        const dots = document.createElement('b');
        dots.setAttribute('style', 'font-weight:400');
        line.appendChild(dots);
        const track = document.createElement('div');
        track.setAttribute('style',
          'position:relative;width:230px;height:1px;margin:12px auto 0;background:rgba(159,216,255,.16);overflow:hidden;');
        const spark = document.createElement('i');
        spark.setAttribute('style',
          'position:absolute;top:0;left:0;width:56px;height:1px;background:#9fd8ff;box-shadow:0 0 10px rgba(159,216,255,.9);');
        track.appendChild(spark);
        box.appendChild(line); box.appendChild(track);
        cover.appendChild(box);
        let dotTimer = 0, barTimer = 0, pos = -56, n = 0;
        setTimeout(() => {
          box.style.opacity = '0.65';
          dotTimer = setInterval(() => { n = (n + 1) % 4; dots.textContent = n ? ' ' + new Array(n + 1).join('·') : ''; }, 340);
          barTimer = setInterval(() => { pos += 7; if (pos > 230) pos = -56; spark.style.transform = `translateX(${pos}px)`; }, 40);
        }, 500);
        (document.body || document.documentElement).appendChild(cover);
        let released = false;
        window.__rhodesCover = {
          release() {
            if (released) return;
            released = true;
            clearInterval(dotTimer); clearInterval(barTimer);
            if (cover.parentNode) cover.parentNode.removeChild(cover);
            window.__rhodesCover = null;
          },
        };
        setTimeout(() => { if (window.__rhodesCover) window.__rhodesCover.release(); }, 20000);   // 看门狗
      } catch (e) { /* 黑幕不能把页面搞坏 */ }
    }

    /* ======================= React 组件 ======================= */
    let live = null;   // 当前活着的引擎（connection/reset 之类的事件要找它）

    function RhodesBoot() {
      const ref = React.useRef(null);
      React.useEffect(() => {
        if (!ref.current) return undefined;

        let api = null;
        let cancelPending = null;
        const ensureEngine = () => { if (!api) { api = createEngine(ref.current); live = api; } return api; };
        const startPlay = () => { markPlayed(); ensureEngine().play(); releaseCoverSoon(); };

        raiseCover();                 // 保险：万一 apply 那会儿条件还不满足
        if (shouldAutoPlay()) {
          suppressOthers(true);       // 这次要播：全程压住鲸鱼挂件这类浮层，播完才放出来
          cancelPending = whenVisible(SETTINGS.mountDelayMs, startPlay);
        } else {
          suppressOthers(false);      // 这次不播：黑幕和压制都立刻撤掉，别挡着界面
          releaseCover();
        }

        /* 只认"完全退出再打开"（= 新会话）。最小化/切后台再回来不算：
           这里刻意不监听 visibilitychange 做补播；界面上也没有跳过/重播入口，
           需要手动再看一次就用控制台 window.__rhodesBoot.play()。 */

        // 控制台小手柄：window.__rhodesBoot.play() / .skip() / .eat()
        if (api || shouldAutoPlay()) {
          window.__rhodesBoot = {
            play: () => { markPlayed(); ensureEngine().play(); releaseCoverSoon(); },
            skip: () => { if (api) api.skip(); },
            eat: () => { if (api) api.eat(); },
            onConnectionReset: () => { if (api) api.onConnectionReset(); },
          };
        }

        return () => {
          if (cancelPending) cancelPending();
          releaseCover();
          suppressOthers(false);
          if (live === api) { live = null; try { delete window.__rhodesBoot; } catch (e) { /* noop */ } }
          if (api) api.dispose();
        };
      }, []);
      return h('div', { ref, style: { display: 'contents' } });
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 最早的一刻：应用还在 "Loading plugins…"、界面尚未渲染 —— 先把开机黑幕铺上
        raiseCover();
        // 终端链路重建时，在动画的终端日志里补一行
        ctx.on('connection/reset', () => { if (live) live.onConnectionReset(); });
        ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'rhodes-boot', order: 100, label: 'RHODES ISLAND 启动动画' },
          RhodesBoot,
        ));
      },
    };
  },
});
