function RHODES_PET_ENGINE(opts) {
  'use strict';
  opts = opts || {};
  var ROOT = opts.container || document.body;
  var USE_QUERY = opts.debug !== false;   // 插件里必须关掉：宿主页面的 ?xxx 不该影响桌宠

  /* ======================= 资源 ======================= */
  // 打包成插件时这一行会被替换成 data URI（见 tools/build_plugin.py）
  var PET_IMG = opts.img || 'assets/rabbit-cut.png';

  /* ======================= 配置 ======================= */
  var DEFAULTS = {
    size: 150,          // 兔兔宽度(px)
    opacity: 1,         // 整体透明度
    sound: true,        // 音效
    volume: 0.6,        // 音量 0~1
    wander: true,       // 自己在屏幕上溜达
    follow: false,      // 跟着鼠标走（和"自己溜达"互斥：开了它就以跟鼠标为准）
    talk: true,         // 点击会说话
    autoFeed: false,    // 隔一会儿自己掏胡萝卜吃
    eatCount: 0,        // 累计吃了多少根（跨会话）。只有这一个口径 —— 不记"本次会话"
    xp: 0,              // 等级经验：每吃一根 +1（一口几顿是随机手感，所以按"根"记，不看顿数）
    affection: 0,       // 好感 0~100：摸它 / 跟它说话会涨，喂食也给一点
    x: null,            // 位置(NaN=用默认右下角)
    y: null
  };
  /* ======================= 存档键 =======================
     本插件用到的所有 localStorage 键集中在这里，好处有两个：
       · resetAll() 能一次清干净，不会漏
       · "这批数据属于谁"一眼可查
     注意：localStorage 是按操作系统用户 + 应用隔离的，
     所以每个人在自己电脑上打开，拿到的本来就是独立的一份，互不可见。 */
  var KEYS = {
    config: 'dsh-rhodesPet.config',       // 大小/音量/开关/等级/好感/累计吃了几根/位置
    supply: 'dsh-rhodesPet.supply',       // 每日签到 + 胡萝卜库存（与启动动画共用）
    migrate: 'dsh-rhodesPet.migrated'     // 一次性迁移标记，见下
  };

  /* 把本插件的存档全部清掉（面板里的"清空数据"和 RHODES_PET.reset() 都走它）。
     只清本插件的键，不碰别人的东西。 */
  function resetAll() {
    Object.keys(KEYS).forEach(function (k) {
      try { localStorage.removeItem(KEYS[k]); } catch (e) { /* noop */ }
    });
  }

  /* ======================= 一次性迁移清理 =======================
     开发阶段这台机器上攒了一堆测试数据（吃了几百根、满级、好感满）。
     发给用户前要清零，但**不能每次都自动清** —— 那会把用户自己的数据也抹掉。
     做法：用一个迁移标记。标记不存在 = 这台机器还没清过 → 清一次并写标记；
     之后（包括用户升级到更新的版本）永远不会再自动清。 */
  (function migrateOnce() {
    var MARK = KEYS.migrate + '.v1';
    try {
      if (localStorage.getItem(MARK)) return;         // 清过了，直接返回
      var had = false;
      Object.keys(KEYS).forEach(function (k) {
        if (k === 'migrate') return;
        if (localStorage.getItem(KEYS[k]) != null) had = true;
      });
      if (had) {
        resetAll();
        if (window.console && console.info) {
          console.info('[rhodes-pet] 已执行一次性清零：清掉了开发阶段的兔兔测试数据，' +
            '之后不会再自动清。');
        }
      }
      localStorage.setItem(MARK, String(Date.now()));
    } catch (e) { /* 存不了就算了，绝不能因为清理把插件弄挂 */ }
  })();

  var cfg = Object.assign({}, DEFAULTS);
  try {
    var savedRaw = localStorage.getItem(KEYS.config);
    if (savedRaw) Object.assign(cfg, JSON.parse(savedRaw));
  } catch (e) { /* 存的东西坏了就当没存 */ }
  /* localStorage 里的数字不可信（手改过、旧版本残留都可能有）：
     统一收敛成非负整数，避免进度条算出 NaN% 或者负宽度。 */
  cfg.xp = Math.max(0, Math.floor(Number(cfg.xp) || 0));
  cfg.affection = Math.max(0, Math.min(100, Math.floor(Number(cfg.affection) || 0)));
  cfg.eatCount = Math.max(0, Math.floor(Number(cfg.eatCount) || 0));
  /* "跟着鼠标"和"自己溜达"不能同时开：跟随优先，溜达会被无视。
     如果只靠开关的点击回调去互斥，从 localStorage 直接读出来的组合就漏掉了 ——
     面板会把溜达也画成"开"，但那个开关其实没有任何作用。所以在这里统一归一化。 */
  if (cfg.follow) cfg.wander = false;
  function save() {
    try { localStorage.setItem(KEYS.config, JSON.stringify(cfg)); } catch (e) { /* noop */ }
  }

  /* ======================= 每日签到 + 胡萝卜库存 =======================
     库存记录（localStorage 的 dsh-rhodesPet.supply）：
       { day: '2026-10-11', quota: 46, stock: 812, checked: true }
       · quota = 今日签到领到的 50 根里**还没吃掉的**（每天签到后重置为 50）
       · stock = 累积库存，硬上限 SUPPLY_CAP
     喂食顺序：先吃今天的 quota，吃完再吃 stock（"今天的先用掉，存粮留着"最直观）。
     签到：换天后的第一次读取即签到，quota = SUPPLY_BASE；stock += quota，
           到 SUPPLY_CAP 就截断（满仓时今日配额会小于 50）。
     启动动画那边有一份**逐字相同**的实现（两个插件各自独立打包，不共享模块），
     改这里的话两边都要改。 */
  var SUPPLY_BASE = 50;                  // 每日签到量
  var SUPPLY_CAP = 10000;                // 胡萝卜库存上限
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }
  function supplyWrite(o) {
    try { localStorage.setItem(KEYS.supply, JSON.stringify(o)); } catch (e) { /* noop */ }
    return o;
  }
  /* 把一份库存记录规范化：数字收敛、越界夹回。所有读取都经过它，脏数据不会漏出去。
     这里只管胡萝卜 —— 等级经验与累计根数是桌宠自己的数据（存在 config 里），
     不放进这条记录：供应记录是和启动动画共用的，而启动动画那边的喂食是纯互动、
     不扣库存也不算经验。两个插件的边界就靠这条划清。 */
  function supplyNorm(o, today) {
    var q = Math.floor(Number(o && o.quota));
    var s = Math.floor(Number(o && o.stock));
    var g = Math.floor(Number(o && o.gain));
    return {
      day: (o && o.day) || today,
      quota: Number.isFinite(q) ? Math.max(0, Math.min(SUPPLY_BASE, q)) : 0,
      stock: Number.isFinite(s) ? Math.max(0, Math.min(SUPPLY_CAP, s)) : 0,
      checked: !!(o && o.checked),
      /* 这次签到实际收进了多少（满仓时会小于 SUPPLY_BASE）。
         存在记录里而不是用变量传：任何一次 supplyRead() 都能读到它，
         不会被后续读取抹掉（早先用 S.lastGain 传，外部再读一次就变成 0 了）。 */
      gain: Number.isFinite(g) ? Math.max(0, g) : 0
    };
  }
  function supplyRead() {
    var today = todayKey();
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEYS.supply) || 'null'); } catch (e) { raw = null; }
    /* 旧格式兼容：早期版本只有 { day, left }，没有 quota/stock。
       把 left 当作累积库存接过来，不丢用户已经攒下的数。 */
    if (raw && raw.day && raw.stock == null && raw.left != null) {
      raw = { day: raw.day, quota: 0, stock: raw.left, checked: !!raw.checked };
    }
    var o = supplyNorm(raw, today);
    /* 换天（或第一次 / 今天还没签到）→ 签到：今日配额到位，并转入累积库存 */
    if (!raw || o.day !== today || !o.checked) {
      var room = Math.max(0, SUPPLY_CAP - o.stock);
      var paid = Math.min(SUPPLY_BASE, room);        // 满仓时少收，差额会报出来
      return supplyWrite({
        day: today, quota: paid, stock: o.stock + paid, checked: true, gain: paid
      });
    }
    return o;
  }
  function supplyQuota() { return supplyRead().quota; }
  function supplyLeft() { return supplyRead().stock; }        // 累计库存（含今日剩余）
  function supplyAvailable() {                                // 今天一共还能喂几根
    var o = supplyRead();
    return o.quota + o.stock;
  }
  function supplyTake(n) {
    var o = supplyRead();
    var k = n || 1;
    var fromQuota = Math.min(o.quota, k);          // 先吃今天的
    o.quota -= fromQuota;
    o.stock = Math.max(0, o.stock - (k - fromQuota));
    o.gain = 0;                                    // 吃过东西了，"刚签到"的提示就该收起来
    supplyWrite(o);                                // 只动胡萝卜
    return o.quota + o.stock;
  }
  /* 今天签到过了吗（启动动画用它决定终章那句怎么说） */
  function supplyCheckedToday() {
    var today = todayKey();
    try {
      var o = JSON.parse(localStorage.getItem(KEYS.supply) || 'null');
      return !!(o && o.day === today && o.checked);
    } catch (e) { return false; }
  }
  /* 当前完整状态。
     gain > 0 表示"今天这次签到刚收进来这么多"（满仓时会小于 base）——
     它是从记录里读的，不是靠变量传，所以外面多读几次也不会丢。 */
  function supplyState() {
    var o = supplyRead();
    return {
      day: o.day, quota: o.quota, stock: o.stock,
      total: o.quota + o.stock, cap: SUPPLY_CAP, base: SUPPLY_BASE,
      gain: o.gain || 0, fresh: (o.gain || 0) > 0
    };
  }

  /* ======================= URL 调试参数 =======================
     无头截图/开发时用来把状态直接摆出来，例如：
       ?panel=1        直接打开设置面板
       ?fed=3          已经吃了几根
       ?scale=1.6      整体放大（方便看细节）
       ?state=eat      定格在"正在啃"的姿态
       ?state=talk     定格在"正在说话"
     ============================================================ */
  var Q = {};
  if (USE_QUERY) {
    try { Q = Object.fromEntries(new URLSearchParams(location.search)); } catch (e) { Q = {}; }
  }
  var DEBUG = {
    panel: USE_QUERY && Q.panel === '1',
    fed: USE_QUERY ? Number(Q.fed || 0) : 0,
    scale: USE_QUERY ? Number(Q.scale || 1) : 1,
    state: (USE_QUERY && Q.state) || '',
    freeze: USE_QUERY && Q.freeze === '1',   // 停掉主动画循环（截图时避免抖动）
    notrans: USE_QUERY && Q.notrans === '1', // 关掉所有过渡（排查合成/动画类问题时用）
    img: (USE_QUERY && Q.img) || '',
    xp: USE_QUERY && Q.xp != null ? Number(Q.xp) : null,
    aff: USE_QUERY && Q.aff != null ? Number(Q.aff) : null,
    supply: USE_QUERY && Q.supply != null ? Number(Q.supply) : null,
    follow: USE_QUERY && Q.follow === '1',
    land: USE_QUERY && Q.land != null ? Number(Q.land) : null
  };
  if (DEBUG.img) PET_IMG = DEBUG.img;
  /* 调试用：把等级/好感/累计根数摆到某个值（写在收敛之后，不然会被上面那几行清掉）。
     经验与累计根数归桌宠自己（cfg），不写供应记录 —— 那条记录只管胡萝卜。 */
  if (DEBUG.fed != null && isFinite(DEBUG.fed)) cfg.eatCount = Math.max(0, Math.floor(DEBUG.fed));
  if (DEBUG.xp != null && isFinite(DEBUG.xp)) cfg.xp = Math.max(0, Math.floor(DEBUG.xp));
  if (DEBUG.aff != null && isFinite(DEBUG.aff)) cfg.affection = clamp(DEBUG.aff, 0, 100);
  /* 升级调试：把经验摆到"差一根就升"的位置，等一帧后真喂一根，走完整升级流程。
     Lv2 的门槛是 needFor(1)，所以摆到它减一。 */
  if (DEBUG.state === 'levelup') cfg.xp = needFor(1) - 1;
  /* 调试用：把库存摆成某个数（用于截图/自检）。
     必须带 checked:true —— 否则 supplyRead() 会认为"今天还没签到"，
     立刻把它重置回签到值，调试值就白设了。 */
  if (DEBUG.supply != null && isFinite(DEBUG.supply)) {
    try {
      var dv = Math.max(0, Math.min(SUPPLY_CAP, Math.floor(DEBUG.supply)));
      localStorage.setItem(KEYS.supply, JSON.stringify({
        day: todayKey(), quota: 0, stock: dv, checked: true
      }));
    } catch (e) { /* noop */ }
  }
  if (DEBUG.follow) cfg.follow = true;

  /* ======================= 工具 ======================= */
  var TAU = Math.PI * 2;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  function setVars(node, obj) {
    for (var k in obj) node.style.setProperty(k, obj[k]);
  }

  /* ======================= 台词 ======================= */
  var WORDS = {
    /* 摸它：青色 */
    touch: ['唔……', '（抖了抖耳朵）', '（舒服地眯起眼）', '诶嘿', '（往你手心里蹭了蹭）',
      '（毛茸茸的）', '（歪头）', '（小声）……博士。', '呀！', '（耳朵一动）'],
    /* 啃胡萝卜：橙色 */
    bite: ['咔嚓！', '咔嚓♪', '咔嚓咔嚓', '嚼嚼嚼', '嘎嘣脆！', '唔姆……'],
    /* 吃高兴了：粉色 */
    mood: ['好吃！', '好甜……', '喜欢这个', '再来一根！', '（耳朵抖了一下）',
      '（尾巴动了动）', '（眼睛亮了）', '腮帮子鼓鼓的', '（满足地眯起眼）'],
    /* 吃完一根：粉色 */
    finish: ['吃完了！', '谢谢博士～', '还想吃……', '满足～', '（打了个小小的嗝）'],
    /* 点它说话：白/青色，长句 */
    talk: [
      '今天也要好好工作哦，博士。',
      '（它把外套裹紧了一点。）',
      'PRTS 说我的可爱指数又超标了。',
      '博士，胡萝卜储备还够吗？',
      '（它盯着屏幕看了一会儿，然后打了个哈欠。）',
      '唔……你又偷懒了吧？',
      '（它用爪子拍了拍自己的口袋，里面传出塑料摩擦声。）',
      '要不要休息一下？眼药水在抽屉里。',
      '我在这儿看着呢，别怕。',
      '（它原地转了个身，把最圆的那一面朝向你。）',
      '凯尔希医生说过，按时吃饭。',
      '……你刚才是不是在摸鱼？'
    ],
    /* 待机时偶尔自己嘟囔 */
    idle: ['（发呆中）', '……', '（看着你敲键盘）', '（耳朵转了转）', 'zzz……',
      '（把脸埋进外套里）', '（警惕地盯着光标）'],
    /* 升级时说的话（按新等级挑） */
    levelup: ['（它把外套裹紧了一点，站得更直了。）', '唔……好像变沉了一点？',
      '（它拍了拍自己的肚子，很满意。）', '又长了一点点！', '（它转了个圈给你看。）']
  };

  /* ======================= 等级与好感 =======================
     两个维度分工不同：
       等级  = 吃出来的（xp，每根 +1），给称号 + 解锁台词 + 外观小变化
       好感  = 陪出来的（摸它 / 跟它说话 / 喂它），给亲密度称号 + 解锁更亲昵的台词
     解锁是"静默"的：不加锁、不提示，等级到了对应台词自然就混进池子里了。
     ============================================================ */
  /* ============================================================
     等级：**Lv.1 ~ Lv.120**（对齐明日方舟的等级跨度）
     每吃一根胡萝卜 +1 经验，所以"经验"就等于"吃过多少根"。

     经验曲线用**公式**算，不再手写数组 —— 手写 120 条太容易错，
     而且想调曲线时得改 120 个数字。规则（`needFor`）：
       · Lv.1 → 20：每级 +2（3,5,7,…,41），前期升级快，前 3 天就能看到好几级
       · Lv.20 → 120：41,42,43,… 每级 +1
     累计：Lv10 = 120xp，Lv20 = 440，Lv50 = 2135，Lv80 = 4730，Lv120 = 9590。
     按每天把 50 根配额吃完算，Lv120 约 6.4 个月 —— 和游戏里精英化的节奏相当。
     ============================================================ */
  var MAX_LEVEL = 120;
  /* 升到第 i 级（1-based）需要多少经验 */
  function needFor(i) {
    return i <= 20 ? (3 + 2 * (i - 1)) : (41 + (i - 20));
  }
  /* 累计经验表：CUM[i] = 到达 i+1 级所需的经验（CUM[0]=0） */
  var CUM = (function () {
    var a = [0];
    for (var i = 1; i < MAX_LEVEL; i++) a.push(a[i - 1] + needFor(i));
    return a;
  })();

  /* ============================================================
     等级档位：**每 20 级一档，正好 6 档铺满 Lv.1 → Lv.120**
       1-20 / 21-40 / 41-60 / 61-80 / 81-100 / 101-120
     每档换三样东西：称号、辉光颜色、溜达速度。
     颜色和称号**对齐**（同一档一起换）—— 只换颜色不换称号的话，玩家到了 60 级
     会觉得"名字还是那个、只是颜色深了点"，反馈不完整。
     称号用的是明日方舟的精英化说法（E0/E1/E2），读起来像罗德岛的技术文档。
     ============================================================ */
  /* 强度是实测调出来的：第一版 glowA 只有 0.10~0.62、模糊 7~20px，
     截图对比下来"最大差异只有 62"（(21,23,35)→(42,36,63)），肉眼根本看不出换档。
     现在两道辉光叠加：一道紧的做出颜色边缘，一道松的做光晕，数值也提上去了。 */
  var TIERS = [
    { from: 1,   title: '临时登记',        glow: '159,216,255', glowA: 0.22, speed: 1.00, name: '初识的浅蓝' },
    { from: 21,  title: '后勤实习生',      glow: '126,214,255', glowA: 0.42, speed: 0.95, name: '后勤的青' },
    { from: 41,  title: '正式干员 · E0',   glow: '150,190,255', glowA: 0.58, speed: 0.90, name: '制式的蓝' },
    { from: 61,  title: '资深干员 · E1',   glow: '178,150,255', glowA: 0.74, speed: 0.85, name: '精锐的紫' },
    { from: 81,  title: '行动组队长 · E1', glow: '255,150,200', glowA: 0.86, speed: 0.81, name: '队长的绯' },
    { from: 101, title: '罗德岛王牌 · E2', glow: '255,205,120', glowA: 1.00, speed: 0.77, name: '王牌的暖金' },
    /* 满级档：颜色换成琥珀，强度再提一档（1.14）。实际 α 会夹到 1.0，
       但强度值本身必须严格递增 —— 否则"越高级越亮"这件事在最高两档上就断了。 */
    { from: 120, title: '首席胡萝卜官',    glow: '255,178,60',  glowA: 1.14, speed: 0.74, name: '首席的琥珀' }
  ];
  function tierOf(lv) {
    var t = TIERS[0];
    for (var i = 0; i < TIERS.length; i++) if (lv >= TIERS[i].from) t = TIERS[i];
    return t;
  }
  /* 这一档的等级区间，用于面板显示 "Lv.21~40" */
  function tierRange(t) {
    var i = TIERS.indexOf(t);
    var next = TIERS[i + 1];
    return next ? (t.from + '~' + (next.from - 1)) : (t.from + '~' + MAX_LEVEL);
  }
  /* 等级到这些数字时解锁新台词（"到 N 级为止"的写法，所以 25 级的话在 25 级及以后都会出现）。
     解锁是静默的：不加锁、不提示，等级到了对应台词自然混进池子里。
     120 级跨度大，所以把这些点铺开一些，别让中期一直没新东西。 */
  var LOCKED_TALK = [
    { need: 2, words: ['我记得你的手感了。', '（它主动往你这边挪了挪。）'] },
    { need: 5, words: ['今天也一起加油吧，博士。', '（它把胡萝卜分了你一半，虽然你不能吃。）'] },
    { need: 12, words: ['你不用一直看着我，我会待在这儿的。', '（它开始在你打字的时候打拍子。）'] },
    { need: 25, words: ['有什么事都可以跟我说，我记性很好的。', '（它睡着了，但耳朵还朝着你的方向。）'] },
    { need: 45, words: ['（它把外套的一角搭在你的光标上，像是在牵着你。）',
      '你忙你的，我不吵你。'] },
    { need: 70, words: ['……博士，谢谢你没有把我关掉。', '（它把外套脱下来搭在你肩上，虽然够不着。）'] },
    { need: 95, words: ['（它站得很直，像模像样地敬了个礼。）', '后勤·胡萝卜消耗股，随时待命。'] },
    { need: 118, words: ['（它想了想，把最后半根胡萝卜塞进你手心里。）',
      '这个给你。反正你会再给我的，对吧？'] }
  ];
  var AFF_TIERS = [
    { min: 0, title: '刚认识' },
    { min: 15, title: '有点熟了' },
    { min: 35, title: '会跟着你' },
    { min: 60, title: '黏人' },
    { min: 85, title: '最信任你' }
  ];

  function levelOf(xp) {
    var x = Math.max(0, xp || 0);
    var n = 1;
    for (var i = 0; i < MAX_LEVEL; i++) if (x >= CUM[i]) n = i + 1;
    return n;
  }
  function levelInfo(xp) {
    var lv = levelOf(xp);
    var lo = CUM[lv - 1];
    var next = lv < MAX_LEVEL ? CUM[lv] : null;   // 下一级的累计门槛
    var span = next ? next - lo : 0;
    var prog = next ? (xp - lo) / span : 1;
    var t = tierOf(lv);
    return {
      level: lv, title: t.title, tier: t, next: next, span: span,
      into: (xp || 0) - lo, need: next ? next - (xp || 0) : 0,
      prog: Math.max(0, Math.min(1, prog))
    };
  }
  function titleOf(lv) { return tierOf(lv).title; }
  function affTier(a) {
    var t = AFF_TIERS[0];
    for (var i = 0; i < AFF_TIERS.length; i++) if (a >= AFF_TIERS[i].min) t = AFF_TIERS[i];
    return t.title;
  }
  /* 当前等级已经解锁的台词（含基础池） */
  function talkPool() {
    var lv = levelOf(cfg.xp || 0);
    var pool = WORDS.talk.slice();
    LOCKED_TALK.forEach(function (g) { if (lv >= g.need) pool = pool.concat(g.words); });
    return pool;
  }
  /* 好感越高，越容易冒出亲昵的话 —— 用重复放入池子来加权，不搞复杂权重表 */
  function weightedTalk() {
    var pool = talkPool();
    if ((cfg.affection || 0) >= 60) pool = pool.concat(WORDS.talk, ['（它靠过来蹭了蹭你的手。）']);
    if ((cfg.affection || 0) >= 85) pool = pool.concat(['（它把最圆的那一面朝向你，一动不动。）']);
    /* 补给少到一定程度时，它会念叨这件事 */
    /* 存量告急才念叨（今天的配额 + 存粮都算上） */
    if (supplyAvailable() <= 20) pool = pool.concat(['补给快没了……', '胡萝卜只剩一点了。']);
    return pool;
  }

  /* ======================= 音效（WebAudio 现场合成） ======================= */
  var Sfx = (function () {
    var ac = null, master = null, noiseBuf = null;
    function ensure() {
      if (ac) return ac;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = cfg.volume;
        master.connect(ac.destination);
        // 一段白噪声，给"咔嚓"用
        var len = (ac.sampleRate * 0.5) | 0;
        noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
      return ac;
    }
    function resume() { var a = ensure(); if (a && a.state === 'suspended') { try { a.resume(); } catch (e) { } } }
    function setVol(v) { if (master) master.gain.value = v; }
    function tone(freq, dur, gain, type, slideTo, delay) {
      if (!cfg.sound) return;
      var t0 = ac.currentTime + (delay || 0);
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(dur, gain, freq, q, delay) {
      if (!cfg.sound) return;
      var t0 = ac.currentTime + (delay || 0);
      var s = ac.createBufferSource();
      s.buffer = noiseBuf;
      var f = ac.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
      var g = ac.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t0); s.stop(t0 + dur + 0.02);
    }
    return {
      resume: resume,
      setVol: setVol,
      ready: function () { return !!ensure(); },
      close: function () { if (ac) { try { ac.close(); } catch (e) { } ac = null; master = null; } },
      /* 被摸到：一层极短的绒毛摩擦 + 一声上扬的软"啾" + 一点高频小天使粉 */
      touch: function (pan) {
        if (!cfg.sound || !ensure()) return;
        var p = (pan == null ? 0 : pan);
        try {
          var g = ac.createGain(); g.gain.value = 1 - Math.abs(p) * 0.5;
          g.connect(master);
          var dest = master;
          master = g; g.connect(dest);
          var j = rnd(0.9, 1.1);
          noise(0.05, 0.05, rnd(2400, 3600), 0.8);
          tone(760 * j, 0.1, 0.16, 'sine', 1240 * j, 0.01);
          tone(1520 * j, 0.07, 0.05, 'triangle', 1900 * j, 0.02);
          setTimeout(function () { master = dest; try { g.disconnect(); } catch (e) { } }, 220);
        } catch (e) { /* noop */ }
      },
      /* 咬一口：短促脆响 */
      crunch: function (i) {
        if (!cfg.sound || !ensure()) return;
        var j = rnd(0.88, 1.14);
        noise(0.055, 0.1, rnd(1500, 2300) * j, 1.4);
        tone(rnd(180, 240) * j, 0.07, 0.09, 'square', rnd(90, 130));
      },
      /* 吃完的高兴音 */
      happy: function () {
        if (!cfg.sound || !ensure()) return;
        var j = rnd(0.95, 1.08);
        tone(880 * j, 0.12, 0.1, 'sine', 1180 * j);
        tone(1320 * j, 0.16, 0.07, 'sine', 1760 * j, 0.08);
      },
      /* 说话前的轻"叮" */
      blip: function () {
        if (!cfg.sound || !ensure()) return;
        tone(rnd(1050, 1350), 0.06, 0.05, 'sine', rnd(1500, 1900));
      },
      pop: function () {
        if (!cfg.sound || !ensure()) return;
        tone(520, 0.09, 0.08, 'sine', 880);
      },
      /* 升级：三音上行 + 一层很轻的闪烁，听起来像"变强了"而不是"叮咚" */
      levelUp: function () {
        if (!cfg.sound || !ensure()) return;
        var j = rnd(0.98, 1.03);
        tone(660 * j, 0.12, 0.10, 'sine', 990 * j);
        tone(990 * j, 0.14, 0.09, 'sine', 1320 * j, 0.09);
        tone(1320 * j, 0.30, 0.07, 'triangle', 1980 * j, 0.18);
        noise(0.22, 0.03, 4200, 0.7, 0.02);
      }
    };
  })();

  /* ======================= 样式 ======================= */
  var CSS = [
    '.rp-layer{position:fixed;inset:0;z-index:2147482000;pointer-events:none;',
    '  font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",sans-serif;',
    '  -webkit-font-smoothing:antialiased;user-select:none}',
    '.rp-layer *{margin:0;padding:0;box-sizing:border-box}',

    /* 兔兔本体：外层管位置和大小，内层管呼吸/蹦跳，图片层管啃食挤压 */
    '.rp-pet{position:absolute;left:0;top:0;pointer-events:auto;cursor:grab;touch-action:none;',
    '  transition:opacity .3s ease;will-change:transform}',
    '.rp-pet.rp-drag{cursor:grabbing}',
    '.rp-inner{position:relative;transform-origin:50% 92%;will-change:transform}',
    '.rp-img{display:block;width:100%;height:auto;pointer-events:none;',
    '  filter:drop-shadow(0 10px 18px rgba(0,0,0,.55))}',
    '.rp-layer.rp-dim .rp-img{filter:drop-shadow(0 10px 18px rgba(0,0,0,.55)) brightness(1.06)}',
    /* 脚下阴影，落地感 */
    '.rp-shadow{position:absolute;left:16%;right:16%;bottom:-8px;height:14px;border-radius:50%;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.6),rgba(0,0,0,0) 70%);pointer-events:none}',
    /* 耳朵（表情用）：贴在头上方的两小片，平时透明，抖耳时才显形 */
    '.rp-ear{position:absolute;top:2%;width:9%;height:22%;border-radius:50% 50% 30% 30%;',
    '  background:linear-gradient(180deg,#f6e7d4,#dcc6ad);opacity:0;transform-origin:50% 100%;',
    '  transition:opacity .12s ease}',
    '.rp-ear.l{left:30%} .rp-ear.r{left:58%}',
    '.rp-ear.on{opacity:.92}',
    '.rp-ear.wig{animation:rp-earwig .38s ease-in-out 2}',
    '@keyframes rp-earwig{0%,100%{transform:rotate(0)}30%{transform:rotate(-13deg)}70%{transform:rotate(9deg)}}',

    /* 胡萝卜（SVG，越啃越短靠 scaleX）
       位置是按素材调的：兔兔侧脸朝右，嘴约在宽 70% / 高 50% 处，
       所以胡萝卜从右下方向嘴边递（右下角是嘴的位置）。 */
    '.rp-carrot{position:absolute;left:42%;top:45%;width:28%;transform-origin:100% 50%;',
    '  opacity:0;transform:translateX(30px) rotate(-14deg) scale(.6);pointer-events:none;',
    '  filter:drop-shadow(0 0 10px rgba(255,150,60,.4)) drop-shadow(0 4px 8px rgba(0,0,0,.6));',
    '  transition:transform .26s cubic-bezier(.3,1.4,.4,1),opacity .18s ease}',
    '.rp-carrot.on{opacity:1;transform:translateX(16px) rotate(-14deg) scale(1)}',
    '.rp-carrot svg{display:block;width:100%;height:auto}',

    /* 拖拽喂食用的胡萝卜：平时待在兔兔旁边当"把手"，可以按住拖走。
       **必须是 .rp-pet 的子元素** —— 显示规则用的是 `.rp-pet:hover .rp-offer`（后代选择器），
       挂在外面（比如 .rp-layer）就永远不匹配，把手会一直是 opacity:0、用户根本看不见它。
       （踩过：代码把它挂在 layer 上，注释却写着"是 .rp-pet 的子元素"，两边不一致一直没发现，
         因为测试都用 ?offer=1 强制显示，绕过了 hover 这条路径。）
       定位用**相对兔兔的局部坐标** + position:absolute（继承 .rp-carrot 的 absolute），
       这样兔兔移动时把手自动跟随，不用每帧去写 left/top。
       加了圆底 + 边框，否则一根小胡萝卜浮在深色界面上会糊成一团、看不出能拖。 */
    '.rp-offer{left:0;top:0;right:auto;width:68px;height:68px;border-radius:50%;',
    '  display:flex;align-items:center;justify-content:center;',
    '  background:rgba(12,16,22,.88);border:1px solid rgba(255,255,255,.28);',
    '  box-shadow:0 6px 18px rgba(0,0,0,.5);',
    '  opacity:0;transform:none;cursor:grab;pointer-events:auto;touch-action:none;z-index:2;',
    '  transition:opacity .2s ease,transform .22s cubic-bezier(.3,1.4,.4,1),border-color .2s ease}',
    /* 胡萝卜在 viewBox 里是细长楔形（主体只有 100x34 单位），所以"看起来"总比给它的框小。
       实测 svg 给 50px 时橙色主体只有 33x14 —— 在深色圆盘上认不出来，所以再放大一档。 */
    '.rp-offer svg{width:64px;height:auto;display:block}',
    '.rp-pet:hover .rp-offer{opacity:1}',
    '.rp-offer:hover{border-color:rgba(255,255,255,.5)}',
    /* 调试/截图用：强制显示把手（无头环境没有 hover，看不到它） */
    '.rp-offer.rp-out{opacity:1}',
    '.rp-offer.rp-grab{cursor:grabbing;transform:scale(1.12) rotate(-8deg);transition:none}',
    /* 拖动中、正在吃、以及兔兔被拖走时都不显示把手，免得两个动作撞在一起 */
    '.rp-pet.rp-drag .rp-offer,.rp-offer.rp-grab{opacity:0}',
    '.rp-pet.rp-eating .rp-offer{opacity:0}',
    /* 光标接近嘴边时兔兔亮一下：告诉用户"松手就能喂到" */
    '.rp-pet.rp-mouth .rp-img{filter:drop-shadow(0 10px 18px rgba(0,0,0,.55)) brightness(1.1)',
    '  drop-shadow(0 0 18px rgba(255,190,110,.55))}',

    /* 气泡：说话 / 飘词共用。
       min-width 是必要的：只有 max-width 时，带括号的中文短句会塌成一条又窄又高的竖排。
       bottom:100% 让它锚在兔兔头顶上方；飘词在它下方 26px 处，两者不会叠。 */
    '.rp-bubble{position:absolute;left:50%;bottom:100%;transform:translate(-50%,-16px) scale(.9);',
    '  min-width:158px;max-width:280px;padding:9px 14px;border-radius:14px;background:rgba(255,255,255,.96);',
    '  color:#1a2230;font-size:14px;line-height:1.62;letter-spacing:.02em;text-align:center;',
    '  box-shadow:0 8px 22px rgba(0,0,0,.45);opacity:0;pointer-events:none;z-index:3;',
    '  transition:opacity .18s ease,transform .22s cubic-bezier(.2,1.5,.4,1)}',
    '.rp-bubble::after{content:"";position:absolute;left:50%;margin-left:-7px;bottom:-7px;',
    '  width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;',
    '  border-top:8px solid rgba(255,255,255,.96)}',
    /* 换档（每 20 级）那一次升级气泡里的第二行：说清"新的颜色阶段"叫什么 */
    '.rp-tierup{display:inline-block;margin-top:3px;font-size:12px;letter-spacing:.06em;',
    '  color:#8a6a1e}',
    '.rp-bubble.on{opacity:1;transform:translate(-50%,-18px) scale(1)}',
    '.rp-bubble.rp-word{max-width:none;padding:5px 11px;border-radius:999px;font-size:13.5px;',
    '  letter-spacing:.06em;background:transparent;box-shadow:none;font-weight:600;',
    '  text-shadow:0 2px 10px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.9)}',
    '.rp-bubble.rp-word::after{display:none}',
    '.rp-bubble.rp-word.c-touch{color:#9fe6ff}',
    '.rp-bubble.rp-word.c-bite{color:#ffc37a}',
    '.rp-bubble.rp-word.c-mood{color:#ffb0d8}',
    '.rp-bubble.rp-word.c-idle{color:rgba(255,255,255,.6)}',

    /* 飘起来的小词（不占气泡位，往上游走） */
    /* 飘词：起点放在兔兔身体上方一点，**不是**头顶 —— 头顶是气泡的地盘。
       之前放在 bottom:100%（贴着头顶），气泡一起来就撞上，两句都读不出来。
       另外给气泡更高的层级：万一还是碰上，被压住的也是飘词而不是台词气泡。 */
    '.rp-float{position:absolute;left:50%;bottom:26%;white-space:nowrap;font-size:14px;font-weight:600;',
    '  pointer-events:none;transform:translateX(-50%);z-index:1;',
    '  text-shadow:0 2px 10px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.9);',
    '  animation:rp-floatup 1.05s ease-out forwards}',
    '@keyframes rp-floatup{0%{opacity:0;transform:translate(-50%,0) scale(.85)}',
    '  18%{opacity:1;transform:translate(-50%,-8px) scale(1)}',
    '  100%{opacity:0;transform:translate(-50%,-46px) scale(.97)}}',
    '.rp-float.c-touch{color:#9fe6ff} .rp-float.c-bite{color:#ffc37a}',
    '.rp-float.c-mood{color:#ffb0d8} .rp-float.c-idle{color:rgba(255,255,255,.6)}',

    /* 碎屑粒子 */
    '.rp-crumb{position:absolute;width:4px;height:4px;border-radius:1px;background:#ffab4d;',
    '  pointer-events:none;animation:rp-crumb .52s ease-out forwards}',
    '@keyframes rp-crumb{0%{opacity:1;transform:translate(0,0)}100%{opacity:0;transform:translate(var(--cx),var(--cy))}}',

    /* 小齿轮按钮 + 计量条 */
    '.rp-gear{position:absolute;right:-6px;top:-6px;width:26px;height:26px;border-radius:50%;',
    '  border:1px solid rgba(255,255,255,.28);background:rgba(10,14,20,.72);color:rgba(255,255,255,.8);',
    '  font-size:13px;line-height:24px;text-align:center;cursor:pointer;pointer-events:auto;',
    '  opacity:0;transition:opacity .2s ease,background .2s}',
    '.rp-pet:hover .rp-gear,.rp-gear.on{opacity:1}',
    '.rp-gear:hover{background:#fff;color:#000;border-color:#fff}',
    '.rp-count{position:absolute;left:-4px;top:-22px;font-family:Consolas,Menlo,monospace;font-size:12px;',
    '  letter-spacing:.14em;color:rgba(255,255,255,.5);white-space:nowrap;opacity:0;',
    '  pointer-events:none;text-shadow:0 2px 8px rgba(0,0,0,.9);transition:opacity .3s ease}',
    '.rp-count.on{opacity:1}',
    '.rp-count b{color:#ffb765;font-weight:400}',
    /* 计数 +1 时闪一下，否则数字变了也注意不到 */
    '.rp-count.bump{animation:rp-bump .42s cubic-bezier(.2,1.6,.4,1)}',
    '@keyframes rp-bump{0%{transform:scale(1)}38%{transform:scale(1.22)}100%{transform:scale(1)}}',

    /* 设置面板
       注意：面板必须挂在 .rp-layer 上，不能挂在 .rp-pet 里。
       .rp-pet 有 transform，会改变后代 position:fixed 的包含块，
       于是"贴着兔兔"的坐标会跟着兔兔一起偏移 —— 兔兔在屏幕底部时面板会被顶到屏幕外。 */
    '.rp-panel{position:fixed;pointer-events:auto;width:296px;padding:14px 16px 16px;',
    /* 限高 + 内部滚动：矮窗口里装不下就滚动看全（这是刻意留的滚动，
       不然面板会长到铺满整个窗口 —— 加逐项说明之后就这样了）。 */
    '  max-height:72vh;display:flex;flex-direction:column;',
    /* 滚动条槽位常驻（macOS 默认是 overlay、不用就看不见）。
       配合下面 ::-webkit-scrollbar 的宽度，滚动条会一直显示 —— 这是"能滚动"最直接的线索。 */
    '  scrollbar-gutter:stable;',
    '  border-radius:12px;border:1px solid rgba(255,255,255,.18);',
    /* 近乎不透明：面板会盖住聊天文字，半透明时背后的字会透出来、看着发花 */
    '  background:linear-gradient(180deg,rgba(11,14,20,.995),rgba(7,9,13,.995));',
    '  box-shadow:0 18px 44px rgba(0,0,0,.6);color:rgba(255,255,255,.86);font-size:13px;',
    '  opacity:0;transform:translateY(6px) scale(.98);transform-origin:100% 0;',
    '  transition:opacity .18s ease,transform .18s ease;visibility:hidden}',
    '.rp-panel.on{opacity:1;transform:none;visibility:visible}',
    '.rp-panel h4{font-size:12px;font-weight:400;letter-spacing:.26em;color:#9fd8ff;',
    '  margin-bottom:12px;text-transform:uppercase}',
    '.rp-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0 0}',
    '.rp-row label{color:rgba(255,255,255,.86);flex:none}',
    /* 每个设置项下面那句说明：比标签小一档、颜色更浅，形成"标题 / 细节"的层次。
       常驻显示（试过"悬停才显示"，但那是个看不见的功能：用户不知道要悬停就永远不悬停）。 */
    '.rp-hint-row{margin:1px 0 8px;font-size:11px;line-height:1.5;color:rgba(255,255,255,.42)}',
    /* 可滚动区：只有它滚，标题和说明浮层留着不动。
       底部用 mask 渐隐，暗示"下面还有内容"—— 否则用户只会以为东西被折叠没了
       （真的有人这么以为）。滚到底时加 .rp-atend 去掉渐隐。 */
    '.rp-panel-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;',
    '  margin:0 -4px;padding:0 4px;',
    '  -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 18px),transparent);',
    '  mask-image:linear-gradient(180deg,#000 calc(100% - 18px),transparent)}',
    '.rp-panel-scroll.rp-atend{-webkit-mask-image:none;mask-image:none}',
    /* 滚动条做得可见一点：这是"还能往下滚"最直接的线索 */
    '.rp-panel-scroll::-webkit-scrollbar{width:7px}',
    '.rp-panel-scroll::-webkit-scrollbar-track{background:transparent}',
    '.rp-panel-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.22);border-radius:4px}',
    '.rp-panel-scroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.38)}',
    /* 可折叠分组 */
    '.rp-group{margin-bottom:2px}',
    '.rp-group-hd{display:flex;align-items:center;justify-content:space-between;',
    '  padding:8px 0 6px;cursor:pointer;color:rgba(255,255,255,.8);font-size:12px;',
    '  letter-spacing:.06em;user-select:none}',
    '.rp-group-hd:hover{color:#fff}',
    '.rp-caret{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;',
    '  border-top:5px solid currentColor;opacity:.55;transition:transform .2s ease}',
    '.rp-group.rp-open .rp-caret{transform:rotate(180deg)}',
    '.rp-group-body{display:none;padding-bottom:2px}',
    '.rp-group.rp-open .rp-group-body{display:block}',
    '.rp-group-hd .rp-group-sum{font-size:11px;color:rgba(255,255,255,.34)}',
    /* 常驻状态块（等级/好感/胡萝卜）：和下面的设置区用一条分隔线隔开 */
    '.rp-stat-top{padding-bottom:10px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,.12)}',
    '.rp-tierline{margin:2px 0 0;font-size:11px;line-height:1.5;color:rgba(255,255,255,.42)}',
    '.rp-stat-hd.rp-sup{margin-top:9px}',
    '.rp-stat-hd.rp-sup i{font-style:normal;color:rgba(255,255,255,.5);font-size:11px}',
    '.rp-stat-hd.rp-sup b{color:rgba(255,255,255,.85);font-weight:500}',
    '.rp-stat-hd.rp-sup em{color:rgba(255,255,255,.5)}',
    '.rp-row input[type=range]{flex:1;min-width:0;-webkit-appearance:none;appearance:none;height:3px;',
    '  background:rgba(255,255,255,.18);border-radius:2px;outline:none}',
    '.rp-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;',
    '  border-radius:50%;background:#9fd8ff;box-shadow:0 0 8px rgba(159,216,255,.8);cursor:pointer}',
    '.rp-row .rp-val{width:42px;text-align:right;font-family:Consolas,Menlo,monospace;',
    '  font-size:12px;color:rgba(255,255,255,.5);flex:none}',
    '.rp-sw{position:relative;width:38px;height:20px;border-radius:999px;flex:none;cursor:pointer;',
    '  background:rgba(255,255,255,.14);transition:background .2s}',
    '.rp-sw i{position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;',
    '  background:rgba(255,255,255,.6);transition:transform .2s,background .2s}',
    '.rp-sw.on{background:rgba(159,216,255,.34)}',
    '.rp-sw.on i{transform:translateX(18px);background:#9fd8ff}',
    '.rp-sep{height:1px;background:rgba(255,255,255,.1);margin:10px 0}',
    '.rp-acts{display:flex;gap:8px;margin-top:12px}',
    '.rp-btn{flex:1;padding:7px 0;border-radius:7px;border:1px solid rgba(255,255,255,.2);',
    '  background:rgba(255,255,255,.05);color:rgba(255,255,255,.8);font-size:12px;',
    '  letter-spacing:.08em;cursor:pointer;font-family:inherit;transition:all .18s}',
    '.rp-btn:hover{background:#fff;color:#000;border-color:#fff}',
    '.rp-hint{margin-top:12px;font-size:11px;line-height:1.7;color:rgba(255,255,255,.42)}',
    '.rp-hint kbd{font-family:Consolas,Menlo,monospace;color:rgba(255,255,255,.55);',
    '  border:1px solid rgba(255,255,255,.2);border-radius:3px;padding:0 3px}',
    /* 等级 / 好感 */
    '.rp-stat{margin-top:2px}',
    '.rp-stat-hd{display:flex;align-items:baseline;justify-content:space-between;gap:8px;',
    '  font-size:11.5px;color:rgba(255,255,255,.5);margin-bottom:5px}',
    '.rp-stat-hd b{color:#9fd8ff;font-weight:600;font-size:13px}',
    '.rp-stat-hd i{font-style:normal;color:rgba(255,255,255,.75)}',
    '.rp-stat-hd em{font-style:normal;font-family:Consolas,Menlo,monospace;font-size:10.5px;',
    '  color:rgba(255,255,255,.36)}',
    '.rp-stat-hd.rp-aff{margin-top:9px}',
    '.rp-meter{height:4px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}',
    '.rp-meter i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#6fb6e8,#9fd8ff);',
    '  box-shadow:0 0 10px rgba(159,216,255,.6);transition:width .35s cubic-bezier(.2,.9,.3,1)}',
    '.rp-stat-hd.rp-aff + .rp-meter i{background:linear-gradient(90deg,#e08fb8,#ffb0d8);',
    '  box-shadow:0 0 10px rgba(255,176,216,.55)}',
    /* 升级时兔兔闪一下 */
    '.rp-pet.rp-levelup{animation:rp-levelpop .95s cubic-bezier(.2,1.4,.35,1)}',
    '@keyframes rp-levelpop{0%{filter:none}',
    '  22%{filter:drop-shadow(0 0 22px rgba(255,226,170,.95)) brightness(1.16)}',
    '  55%{filter:drop-shadow(0 0 14px rgba(255,226,170,.6)) brightness(1.05)}',
    '  100%{filter:none}}'
  ].join('\n');

  /* ======================= 胡萝卜 SVG ======================= */
  var CARROT_SVG = '<svg viewBox="0 0 120 100" aria-hidden="true">' +
    '<defs><linearGradient id="rpCarrot" x1="0" y1="0" x2="0.2" y2="1">' +
    '<stop offset="0" stop-color="#ffc97a"/><stop offset="0.42" stop-color="#ff9a2e"/>' +
    '<stop offset="1" stop-color="#df6416"/></linearGradient></defs>' +
    '<g class="rp-leaves">' +
    '<ellipse cx="21" cy="30" rx="5.5" ry="12.5" transform="rotate(-38 21 30)" fill="#57c76e"/>' +
    '<ellipse cx="30" cy="23" rx="5.5" ry="14" transform="rotate(-10 30 23)" fill="#77dd8c"/>' +
    '<ellipse cx="38" cy="29" rx="5" ry="12" transform="rotate(22 38 29)" fill="#45ac5d"/>' +
    '</g>' +
    '<g class="rp-body">' +
    '<path d="M24 33 L104 50 L24 67 Z" fill="url(#rpCarrot)" stroke="url(#rpCarrot)" ' +
    'stroke-width="9" stroke-linejoin="round"/>' +
    '<g stroke="rgba(255,255,255,.4)" stroke-width="2.4" stroke-linecap="round">' +
    '<line x1="43" y1="40" x2="39" y2="61"/><line x1="61" y1="43" x2="58" y2="58"/>' +
    '<line x1="79" y1="46" x2="77" y2="55"/></g></g></svg>';

  /* ======================= 建 DOM ======================= */
  var layer = el('div', 'rp-layer');
  var style = el('style', null, layer);
  style.textContent = CSS + (DEBUG.notrans
    ? '\n.rp-layer *{transition:none !important;animation:none !important}'
    : '');
  ROOT.appendChild(layer);
  var pet = el('div', 'rp-pet', layer);
  var inner = el('div', 'rp-inner', pet);
  el('div', 'rp-ear l', inner);
  el('div', 'rp-ear r', inner);
  var img = el('img', 'rp-img', inner);
  img.src = PET_IMG;
  img.alt = '';
  img.draggable = false;
  el('div', 'rp-shadow', inner);
  var carrot = el('div', 'rp-carrot', inner);
  carrot.id = 'rpCarrot';
  carrot.innerHTML = CARROT_SVG;
  var carrotBody = carrot.querySelector('.rp-body');
  var carrotLeaves = carrot.querySelector('.rp-leaves');
  /* 拖拽喂食用的那根胡萝卜（单独一个元素，不跟"正在吃"那根共用：
     一个是被拖动的，一个是贴在嘴边的，混用会在状态切换时打架）。
     注意父节点是 **pet** 而不是 layer —— 见上面 CSS 里的说明。 */
  var carrotHandle = el('div', 'rp-carrot rp-offer', pet);
  carrotHandle.title = '按住拖到兔兔嘴边喂它';
  /* 把手用**专属**的小图标，不复用嘴里那根：
     嘴里那根是"细长楔形 + 渐变 + 滤镜"，缩到 60px 级别时橙色主体几乎渲染不出来
     （实测只剩叶子和几根白纹）。这里换成更粗壮、纯色填充的造型，小尺寸下才看得清。 */
  carrotHandle.innerHTML =
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
    '<g transform="rotate(-35 24 24)">' +
    '<path d="M17 16 L31 16 L24 42 Z" fill="#ff9a2e"/>' +
    '<path d="M17 16 L24 16 L24 42 Z" fill="#ffb768"/>' +
    '<rect x="17" y="12" width="14" height="5" rx="2.4" fill="#ff8a17"/>' +
    '<path d="M24 13 C20 7 15 6 13 8 C14 12 19 14 24 13 Z" fill="#5fc978"/>' +
    '<path d="M24 13 C28 6 33 5 35 7 C34 12 29 14 24 13 Z" fill="#45ac5d"/>' +
    '<path d="M24 13 C23 6 24 3 26 2 C28 5 28 10 24 13 Z" fill="#77dd8c"/>' +
    '</g></svg>';
  var gear = el('div', 'rp-gear', pet);
  gear.textContent = '⚙';
  gear.title = '兔兔设置';
  var count = el('div', 'rp-count', pet);
  var panel = el('div', 'rp-panel', layer);
  var earL = inner.querySelector('.rp-ear.l'), earR = inner.querySelector('.rp-ear.r');

  /* ======================= 状态 ======================= */
  var S = {
    W: cfg.size, H: cfg.size * 0.92,     // 会按图片比例算
    x: 0, y: 0,
    vx: 0,                            // 溜达速度
    targetX: null,
    mouse: null,                      // 鼠标视口坐标 {x,y}；只在"跟着鼠标"开启时更新
    spot: null,                       // 当前落脚点（光标附近随机挑的）；null = 还没挑
    restUntil: 0,                     // 到这个时刻之前原地休息（跟随的"停顿"）
    retargetAt: 0,                    // 到这个时刻之后才允许再挑落脚点
    drag: null,
    eat: null,
    talking: false,
    bubbleTimer: 0,
    feedTimer: 0,
    lastTouch: 0,
    t: Math.random() * 100          // 动画相位，避免开局整齐划一
  };

  var IMG_AR = 305 / 332;   // 原图高宽比

  function layout() {
    var w = cfg.size, h = cfg.size * IMG_AR;
    S.W = w; S.H = h;
    pet.style.width = w + 'px';
    pet.style.height = h + 'px';
    /* 默认位置要**预留把手的宽度**，否则兔兔贴在右下角时把手会被视口裁掉。
       （offerSpot 里还有一次"右边放不下就翻到左侧"的兜底。） */
    if (S.x == null) {
      S.x = window.innerWidth - w - OFFER_SIZE - 24;
      S.y = window.innerHeight - h - 20;
    }
    S.x = clamp(S.x, 4, Math.max(4, window.innerWidth - w - 4));
    S.y = clamp(S.y, 4, Math.max(4, window.innerHeight - h - 4));
    layer.style.opacity = cfg.opacity;
  }

  /* ======================= 拖拽喂食 =======================
     喂食不再挂在"摸头"上随机触发，而是一个**有意为之**的动作：
     兔兔旁边挂着一根胡萝卜（把手），按住拖到它嘴边松手 = 喂它。
     判定用的是兔兔的实时外框（跟戳它喂食同一套判定），拖到身上任何位置都算。
     状态声明放在这里（place() 要用），具体逻辑在下面。 */
  var OFFER_GAP = 10;                       // 把手离兔兔外框的距离(px)
  var OFFER_SIZE = 68;                      // 把手直径，要和 CSS 里的 .rp-offer 一致
  var offerDrag = null;                     // 拖动中：{ id, x, y }
  var offerPos = { x: 0, y: 0 };            // 把手当前位置（视口坐标）

  /* 算把手相对**兔兔**的落点（局部坐标，不是视口坐标 —— 把手是兔兔的子元素）：
     默认放兔兔右侧，右边放不下就翻到左侧。
     翻边判定仍然要看视口：兔兔默认贴在右下角，右侧没有空间，
     不翻边的话把手会被视口裁掉，用户永远看不到（踩过）。 */
  function offerSpot() {
    var localX = S.W + OFFER_GAP;                     // 右侧
    var pr = pet.getBoundingClientRect();
    if (pr.right + OFFER_GAP + OFFER_SIZE > window.innerWidth - 4) {
      localX = -OFFER_GAP - OFFER_SIZE;               // 翻到左侧
    }
    return { x: localX, y: S.H * 0.55 - OFFER_SIZE / 2 };
  }

  function place() {
    pet.style.transform = 'translate3d(' + S.x.toFixed(1) + 'px,' + S.y.toFixed(1) + 'px,0) scale(' + DEBUG.scale + ')';
    /* 把手是兔兔的子元素，兔兔移动时它自动跟随 —— 这里只需要在"翻边判定可能变了"时
       更新一次落点（窗口尺寸、兔兔位置变化都会影响右侧还有没有空间）。
       拖动中不抢位置：那时候把手跟着光标走。 */
    if (carrotHandle && !offerDrag) {
      var sp = offerSpot();
      offerPos.x = sp.x; offerPos.y = sp.y;
      carrotHandle.style.left = sp.x.toFixed(1) + 'px';
      carrotHandle.style.top = sp.y.toFixed(1) + 'px';
    }
  }

  /* ======================= 气泡 / 飘词 ======================= */
  /* 气泡。默认用 textContent 写入（台词里出现 < > 也不会被当标签解析）；
     确实要换行/嵌套标记时传 html=true 走 innerHTML。 */
  function bubble(text, cls, life, html) {
    if (!text) return;
    var b = el('div', 'rp-bubble ' + (cls || ''), pet);
    if (html) b.innerHTML = text; else b.textContent = text;
    // 加进来后再触发过渡
    requestAnimationFrame(function () { b.classList.add('on'); });
    var hold = life || (cls === 'rp-word' ? 1100 : 2800);
    setTimeout(function () {
      b.classList.remove('on');
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 260);
    }, hold);
  }
  function floatWord(text, colorCls) {
    if (!text) return;
    var f = el('div', 'rp-float ' + (colorCls || ''), pet);
    f.textContent = text;
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1100);
  }
  function crumbs(n, cx, cy) {
    for (var i = 0; i < n; i++) {
      var c = el('div', 'rp-crumb', pet);
      c.style.left = cx + rnd(-10, 10) + 'px';
      c.style.top = cy + rnd(-8, 8) + 'px';
      setVars(c, { '--cx': rnd(-26, 26).toFixed(0) + 'px', '--cy': rnd(8, 30).toFixed(0) + 'px' });
      c.style.animationDelay = (Math.random() * 0.1).toFixed(2) + 's';
      (function (node) { setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 700); })(c);
    }
  }

  /* ======================= 拖拽喂食（逻辑） =======================
     状态（OFFER_GAP / offerDrag / offerPos）在上面声明，因为 place() 要用。 */

  /* 把手位置跟着 place() 一起更新（它是兔兔的子元素，用的是相对兔兔的局部坐标） */
  function positionOffer() { place(); }
  function offerRollback() {
    carrotHandle.classList.remove('rp-grab');
    var sp = offerSpot();
    offerPos.x = sp.x; offerPos.y = sp.y;
    carrotHandle.style.left = sp.x.toFixed(1) + 'px';
    carrotHandle.style.top = sp.y.toFixed(1) + 'px';
  }
  /* 松手时判定：光标是否落在兔兔身上（入参是视口坐标） */
  function hitPet(clientX, clientY) {
    var r = pet.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }
  function offerStart(ev) {
    if (S.eat) return;                      // 正在啃就不接新的
    offerDrag = { id: ev.pointerId, x: offerPos.x, y: offerPos.y };
    carrotHandle.classList.add('rp-grab');
    /* 和兔兔拖动一样：捕获失败不该影响拖动本身 */
    try { if (carrotHandle.setPointerCapture) carrotHandle.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
    Sfx.resume();
    ev.preventDefault();
    ev.stopPropagation();
  }
  function offerMove(ev) {
    if (!offerDrag || ev.pointerId !== offerDrag.id) return;
    /* 视口坐标 → 兔兔的局部坐标（把手是兔兔的子元素，left/top 相对兔兔左上角） */
    var pr = pet.getBoundingClientRect();
    var sc = DEBUG.scale || 1;
    carrotHandle.style.left = ((ev.clientX - pr.left) / sc - OFFER_SIZE / 2).toFixed(1) + 'px';
    carrotHandle.style.top = ((ev.clientY - pr.top) / sc - OFFER_SIZE / 2).toFixed(1) + 'px';
    pet.classList.toggle('rp-mouth', hitPet(ev.clientX, ev.clientY));
  }
  function offerEnd(ev) {
    if (!offerDrag || (ev && ev.pointerId !== offerDrag.id)) return;
    offerDrag = null;
    pet.classList.remove('rp-mouth');
    carrotHandle.classList.remove('rp-grab');
    var x = ev ? ev.clientX : 0, y = ev ? ev.clientY : 0;
    if (ev && hitPet(x, y) && feed()) {
      /* 喂成功：把手先按住不动，等"正在吃"那根胡萝卜飞进嘴里，它再自己飘回去。
         这样视觉上是"我把它递过去了"，而不是两根胡萝卜同时消失。 */
      clearTimeout(S.offerFlash);            // 已经喂上了，不用再"强制显示"
      carrotHandle.classList.remove('rp-out');
      setTimeout(offerRollback, 480);
    } else {
      offerRollback();
    }
  }
  /* 强制把把手显示一段时间（正常情况下它是靠 .rp-pet:hover 显示的）。
     用途：面板里的「喂一根」要引导用户去拖 —— 那时鼠标在面板按钮上、不在兔兔身上，
     不加这个的话把手根本不会出现，用户不知道该拖什么。 */
  function flashOffer(ms) {
    carrotHandle.classList.add('rp-out');
    clearTimeout(S.offerFlash);
    S.offerFlash = setTimeout(function () {
      carrotHandle.classList.remove('rp-out');
    }, ms || 4000);
  }
  carrotHandle.addEventListener('pointerdown', offerStart);
  carrotHandle.addEventListener('pointermove', offerMove);
  carrotHandle.addEventListener('pointerup', offerEnd);
  carrotHandle.addEventListener('pointercancel', offerEnd);
  carrotHandle.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  /* ======================= 动作 ======================= */
  function wiggleEars() {
    [earL, earR].forEach(function (e) {
      e.classList.add('on', 'wig');
      setTimeout(function () { e.classList.remove('wig'); }, 800);
      setTimeout(function () { e.classList.remove('on'); }, 1100);
    });
  }
  function hop() {
    inner.style.transition = 'transform .34s cubic-bezier(.34,1.3,.5,1)';
    inner.style.transform = 'translateY(-18px) scale(1.04,.96)';
    setTimeout(function () {
      inner.style.transition = 'transform .3s cubic-bezier(.5,0,.6,1)';
      inner.style.transform = 'translateY(0) scale(.98,1.03)';
      setTimeout(function () { inner.style.transform = 'translateY(0) scale(1,1)'; }, 200);
    }, 170);
  }
  function chomp() {
    img.style.transition = 'transform .12s ease';
    img.style.transform = 'translate(1px,3px) scale(1.02,.97)';
    setTimeout(function () { img.style.transform = 'none'; }, 110);
  }

  /* ======================= 等级 / 好感 ======================= */
  /* 加经验。返回值是升了几级；升级的音效/气泡统一在 levelUp() 里发。
     经验与累计根数是**桌宠自己**的数据（存在 config 里）——
     启动动画那边的喂食是纯互动，不扣库存也不算经验，两个插件的边界很干净：
       · 启动动画：只读供应记录（终章那句报一下还剩几根）
       · 桌宠：唯一负责扣减、签到、等级、累计 */
  function addXp(n) {
    var before = levelOf(cfg.xp || 0);
    cfg.xp = Math.max(0, (cfg.xp || 0) + n);
    var after = levelOf(cfg.xp);
    applyTierLook();
    syncPanel();
    save();
    if (after > before) levelUp(after, before);
    return after - before;
  }
  /* 加好感（0~100 封顶）。到阶段线时飘一句，不打断啃食。 */
  function addAffection(n) {
    var before = affTier(cfg.affection || 0);
    cfg.affection = clamp((cfg.affection || 0) + n, 0, 100);
    var after = affTier(cfg.affection);
    syncPanel();
    save();
    if (after !== before && !S.eat) {
      setTimeout(function () { floatWord(after, 'c-mood'); }, 260);
    }
    return cfg.affection;
  }
  function levelUp(level, prevLevel) {
    var title = titleOf(level);
    /* 换档（每 20 级）比普通升级更值得说一句：称号、辉光颜色、速度都变了。
       换了档就在气泡下面再补一行，否则玩家只会看到"Lv.21 · 后勤实习生"，
       不知道颜色也跟着变了。 */
    var t = tierOf(level);
    var tierUp = tierOf(prevLevel || 1) !== t;
    count.innerHTML = 'Lv.' + level + ' <b>' + title + '</b>';
    count.classList.add('on');
    count.classList.remove('bump');
    void count.offsetWidth;
    count.classList.add('bump');
    Sfx.levelUp();
    /* 升级气泡排在啃食之后 —— 正在吃的时候插一句话会把节奏打断 */
    setTimeout(function () {
      bubble(tierUp
        ? 'Lv.' + level + ' · ' + title + '<br><span class="rp-tierup">新阶段 · ' + t.name +
          ' · Lv.' + tierRange(t) + '</span>'
        : 'Lv.' + level + ' · ' + title, '', tierUp ? 3200 : 2400, tierUp);
      /* 飘词要等气泡淡出之后再出。两者都锚在头顶，同时出会叠在一起
         —— 彩虹渐变压在字上，等于两句话都读不出来（真踩过）。 */
    }, S.eat ? 1600 : 200);
    setTimeout(function () {
      floatWord(pick(WORDS.levelup), 'c-mood');
    }, (S.eat ? 1600 : 200) + (tierUp ? 3500 : 2700));
    setTimeout(function () {
      if (!S.eat) count.innerHTML = 'CARROT <b>×' + cfg.eatCount + '</b>';
    }, (tierUp ? 4200 : 3400));
    /* 升级时闪一下，让"变了"这件事被看见 */
    pet.classList.remove('rp-levelup');
    void pet.offsetWidth;
    pet.classList.add('rp-levelup');
    setTimeout(function () { pet.classList.remove('rp-levelup'); }, 1000);
    applyTierLook();          // 换档后立刻把辉光颜色换过来
    window.dispatchEvent(new CustomEvent('rhodes-pet:levelup', {
      detail: { level: level, prevLevel: prevLevel, title: title, tierUp: tierUp,
        tier: t.name, xp: cfg.xp }
    }));
  }
  /* 等级带来的外观变化：**辉光颜色随档位变**（每 20 级一档，见 TIERS）+ 溜达速度。
     辉光用 drop-shadow 画在素材外层，所以不需要动图片本身 —— 素材是一张真实兔子照片，
     直接 hue-rotate 会把毛色也染坏。
     第 1 档 glowA 只有 0.10（几乎看不出），是刻意的：让"升级换色"这件事从第 21 级
     才开始有存在感，前面留给"升级很快"的爽感。 */
  function applyTierLook() {
    var t = tierOf(levelOf(cfg.xp || 0));
    var tight = Math.round(6 + t.glowA * 6);      // 紧：贴着轮廓的一圈颜色
    var loose = Math.round(12 + t.glowA * 22);    // 松：向外散开的光晕
    var a1 = Math.min(1, t.glowA * 0.95).toFixed(2);
    var a2 = (t.glowA * 0.7).toFixed(2);
    img.style.filter = 'drop-shadow(0 10px 18px rgba(0,0,0,.55))' +
      ' drop-shadow(0 0 ' + tight + 'px rgba(' + t.glow + ',' + a1 + '))' +
      ' drop-shadow(0 0 ' + loose + 'px rgba(' + t.glow + ',' + a2 + '))';
  }

  /* ======================= 喂胡萝卜 ======================= */
  function feed(bites) {
    if (S.eat) return false;
    /* 库存见底就喂不动了 —— 这是所有喂食路径的统一闸门：
       桌宠自己、自动投喂、以及在启动动画里戳那只兔子，都从各自的库存校验走。
       先扣再喂，所以不会出现"吃了但没扣"。 */
    if (supplyAvailable() <= 0) {
      Sfx.resume();
      floatWord('补给没了……', 'c-mood');
      bubble('胡萝卜吃完了，明天签到会补 50 根。', '', 2400);
      syncPanel();
      return false;
    }
    supplyTake(1);               // 扣一根（只动胡萝卜，不碰经验/累计）
    var total = bites || (3 + ((Math.random() * 3) | 0));
    S.eat = { left: total, total: total, i: 0 };
    cfg.eatCount = Math.max(0, (cfg.eatCount || 0) + 1);
    count.innerHTML = 'CARROT <b>×' + cfg.eatCount + '</b>';
    count.classList.add('on');
    count.classList.remove('bump');
    void count.offsetWidth;       // 重排一次，让动画能连续触发
    count.classList.add('bump');
    addXp(1);             // 等级靠吃：每根 +1（吃掉整根才算，所以放在这里而不是每口）
    addAffection(1);      // 喂它也是陪它
    syncPanel();          // 面板里的数字/进度条也要跟着走
    save();
    carrot.classList.add('on');
    pet.classList.add('rp-eating');     // 进食期间藏起"拖拽喂食"的把手，两个动作不撞车
    carrotBody.style.transition = 'none';
    carrotBody.style.transform = 'scaleX(1)';
    Sfx.resume();
    Sfx.pop();
    bite();
    return true;
  }
  function bite() {
    if (!S.eat) return;
    var e = S.eat;
    if (e.left <= 0) {
      // 吃完了
      carrot.classList.remove('on');
      pet.classList.remove('rp-eating');    // 把手可以出来了
      carrotLeaves.style.transition = 'opacity .2s ease, transform .3s ease';
      carrotLeaves.style.opacity = '0';
      carrotLeaves.style.transform = 'translateX(26px) scale(.4)';
      S.eat = null;
      Sfx.happy();
      floatWord(pick(WORDS.finish), 'c-mood');
      crumbs(6, S.W * 0.55, S.H * 0.45);
      setTimeout(function () {
        carrotLeaves.style.transition = 'none';
        carrotLeaves.style.opacity = '';
        carrotLeaves.style.transform = '';
        count.classList.remove('on');
      }, 900);
      return;
    }
    e.left--; e.i++;
    Sfx.crunch(e.i);
    chomp();
    var remain = e.left / e.total;
    carrotBody.style.transform = 'scaleX(' + Math.max(0.14, remain).toFixed(3) + ')';
    crumbs(3 + ((Math.random() * 3) | 0), S.W * (0.5 + 0.16 * (1 - remain)), S.H * 0.46);
    if (Math.random() < 0.5) floatWord(pick(WORDS.bite), 'c-bite');
    if (Math.random() < 0.42) { floatWord(pick(WORDS.mood), 'c-mood'); crumbs(5, S.W * 0.5, S.H * 0.4); }
    if (!DEBUG.freeze) setTimeout(bite, rnd(220, 330));
  }

  /* 单口：给冻结截图用，只咬一口、不排下一口 */
  function biteOnce() {
    var saved = DEBUG.freeze;
    DEBUG.freeze = true;
    bite();
    DEBUG.freeze = saved;
  }

  /* ======================= 摸它 ======================= */
  /* ======================= 摸它 =======================
     刻意**只做摸头这一件事**，不带任何随机结果。
     早先这里有一句"45% 概率顺手喂一根"，后果是双击（=两次单击）会叠成约 70% 喂食，
     而且同一个手势时灵时不灵 —— 用户没法预期点了会怎样，点击就变得不可信。
     喂食现在有专属动作：把胡萝卜拖到它嘴边（见"拖拽喂食"那段）。 */
  function touch(px) {
    var now = performance.now();
    if (now - S.lastTouch < 240) return;      // 连点节流
    S.lastTouch = now;
    Sfx.resume();
    // 声音按戳的位置左右偏
    var rect = pet.getBoundingClientRect();
    var pan = rect.width ? ((px - (rect.left + rect.width / 2)) / (rect.width / 2)) : 0;
    Sfx.touch(clamp(pan, -1, 1));
    floatWord(pick(WORDS.touch), 'c-touch');
    wiggleEars();
    hop();
    addAffection(1);                          // 摸它最涨好感
  }

  /* ======================= 点它说话 ======================= */
  function talk() {
    if (!cfg.talk || S.talking) return;
    S.talking = true;
    Sfx.resume();
    Sfx.blip();
    bubble(pick(weightedTalk()), '', 3000);   // 台词池随等级/好感增长
    wiggleEars();
    addAffection(1);                          // 跟它说话也算陪它
    setTimeout(function () { S.talking = false; }, 3200);
  }

  /* ======================= 拖动 ======================= */
  pet.addEventListener('pointerdown', function (ev) {
    if (ev.target === gear || panel.contains(ev.target)) return;
    Sfx.resume();
    /* 先把拖动状态建起来，再去尝试 pointer capture。
       顺序很关键：setPointerCapture 在 pointerId 无效时会抛 DOMException
       （合成事件、或指针已经释放时都可能），如果它排在赋值前面，
       一次异常就把整个拖动废掉了 —— 表现是"按住拖不动"，而且没有任何报错提示。
       捕获本身只是"指针移出元素也能继续收到事件"的优化，失败不该影响拖动。 */
    S.drag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, ox: S.x, oy: S.y, moved: false };
    try { if (pet.setPointerCapture) pet.setPointerCapture(ev.pointerId); } catch (e) { /* 捕获失败不影响拖动 */ }
    pet.classList.add('rp-drag');
    ev.preventDefault();
  });
  pet.addEventListener('pointermove', function (ev) {
    if (!S.drag || ev.pointerId !== S.drag.id) return;
    var dx = ev.clientX - S.drag.sx, dy = ev.clientY - S.drag.sy;
    if (!S.drag.moved && Math.abs(dx) + Math.abs(dy) > 4) S.drag.moved = true;
    if (!S.drag.moved) return;
    S.x = clamp(S.drag.ox + dx, 4, window.innerWidth - S.W - 4);
    S.y = clamp(S.drag.oy + dy, 4, window.innerHeight - S.H - 4);
    place();
  });
  function endDrag(ev) {
    if (!S.drag || (ev && ev.pointerId !== S.drag.id)) return;
    var moved = S.drag.moved;
    var wasTap = !moved;
    S.drag = null;
    pet.classList.remove('rp-drag');
    if (moved) {
      save();
      S.targetX = null;
      /* 松手落地：拖动时它是"被提着"的，放手就该有一记落地的分量，
         否则只是硬停在那里，动作没有收尾。
         落差给小（26px）、时长给短 —— 摸起来是轻快的一"啪"；
         关掉淡入/落地（landMs=0 且 fadeIn=0）时也照做，因为它是一次交互反馈，
         和"出场方式"是两回事。 */
      playDrop(240, 26);
    }
    else if (wasTap) {
      // 没拖动 = 点它一下
      var r = pet.getBoundingClientRect();
      touch(ev ? ev.clientX : r.left + r.width / 2);
    }
  }
  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', endDrag);
  // 双击 = 直接说话
  pet.addEventListener('dblclick', function (ev) { ev.preventDefault(); talk(); });
  // 右键 = 打开设置
  pet.addEventListener('contextmenu', function (ev) { ev.preventDefault(); togglePanel(true); });

  /* ======================= 设置面板 =======================
     每一项都带一句说明（只写"跟着鼠标""自动吃胡萝卜"这种名字，用户没法知道点下去会怎样）。
     说明**直接写在每一项下面** —— 试过"悬停才显示"，但那是个看不见的功能：
     用户不知道要悬停就永远不会悬停，还得额外教一句用法，不如直接摊开。

     高度策略：面板限高 72vh（max-height）+ 内部滚动，内容分三组可折叠，
     默认只展开第一组。说明常驻后内容变高，装不下就滚动 —— 这是刻意的。 */
  var panelBuilt = false;
  function rowRange(id, label, hint, min, max, step, val, unit) {
    return '<div class="rp-row"><label>' + label + '</label>' +
      '<input type="range" id="rp-' + id + '" min="' + min + '" max="' + max + '" step="' + step +
      '" value="' + val + '">' +
      '<span class="rp-val" id="rp-' + id + '-v">' + val + unit + '</span></div>' +
      (hint ? '<div class="rp-hint-row">' + hint + '</div>' : '');
  }
  function rowSwitch(id, label, hint) {
    return '<div class="rp-row"><label>' + label + '</label>' +
      '<div class="rp-sw" id="rp-sw-' + id + '"><i></i></div></div>' +
      (hint ? '<div class="rp-hint-row">' + hint + '</div>' : '');
  }
  /* 一个可折叠分组：标题行点击展开/收起 */
  function group(id, title, open, body) {
    return '<div class="rp-group' + (open ? ' rp-open' : '') + '" id="rp-g-' + id + '">' +
      '<div class="rp-group-hd"><span>' + title + '</span><i class="rp-caret"></i></div>' +
      '<div class="rp-group-body">' + body + '</div></div>';
  }
  function buildPanel() {
    if (panelBuilt) return;
    panelBuilt = true;
    panel.innerHTML =
      '<h4>兔兔设置</h4>' +
      '<div class="rp-panel-scroll">' +
      /* 状态块**常驻**在标题下面，不折叠。
         早先它被放在"状态与数据"那个折叠组里，于是展开设置项之后它就被推到可视区
         外面 —— 用户会以为"等级/好感/今日补给都没了"。状态是"想随时看一眼"的东西，
         不该和设置项一起折叠。 */
      '<div class="rp-stat rp-stat-top">' +
      '<div class="rp-stat-hd"><span>Lv.<b id="rp-lv">' + levelOf(cfg.xp) + '</b> ' +
      '<i id="rp-title">' + levelInfo(cfg.xp).title + '</i></span>' +
      '<em id="rp-xp-txt">' + (levelInfo(cfg.xp).next
        ? levelInfo(cfg.xp).into + ' / ' + levelInfo(cfg.xp).span
        : 'MAX') + '</em></div>' +
      /* 颜色阶段：让"每 20 级换一档颜色"这件事在面板里看得见，
         顺便预告下一档在哪一级 —— 否则玩家不知道颜色是会变的。 */
      '<div class="rp-tierline" id="rp-tierline"></div>' +
      '<div class="rp-meter"><i id="rp-xp-bar" style="width:' +
      (levelInfo(cfg.xp).next
        ? Math.max(2, Math.ceil(levelInfo(cfg.xp).prog * 100))
        : 100) + '%"></i></div>' +
      '<div class="rp-stat-hd rp-aff"><span>好感 <i id="rp-aff-tier">' +
      affTier(cfg.affection) + '</i></span><em id="rp-aff-val">' + cfg.affection + ' / 100</em></div>' +
      '<div class="rp-meter"><i id="rp-aff-bar" style="width:' + cfg.affection + '%"></i></div>' +
      /* 胡萝卜只显示**两个不重叠**的数：
           今日 = 今天签到领到、还没吃的；共 = 今天一共还能吃多少（今日 + 存货）。
         早先这里显示的是"今日配额"和"库存（含今日剩余）"，同一个数被算了两次 ——
         吃胡萝卜时"库存"那个数纹丝不动，看着像两个互不相干的池子。
         文案要短：这一行原本写成"胡萝卜 今日 N 根 · 共 N 根（含存货 N） 已吃 N 根"，
         右侧的"已吃"被挤到换行，整块变成三行 —— 面板宽度只有 296px。 */
      '<div class="rp-stat-hd rp-sup"><span>胡萝卜 <i>今日 <b id="rp-quota">' +
      supplyQuota() + '</b> · 共 <b id="rp-total">' + supplyAvailable() +
      '</b> <span id="rp-stock-wrap"></span></i></span>' +
      '<em>已吃 <b id="rp-eat">' + cfg.eatCount + '</b></em></div>' +
      '</div>' +
      group('look', '外观', true,
        rowRange('size', '大小', '兔兔显示成多大（80~320px）', 80, 320, 2, cfg.size, '') +
        rowRange('op', '透明度', '嫌它抢眼就调低，25% 时几乎只剩个影子', 25, 100, 5,
          Math.round(cfg.opacity * 100), '%') +
        rowRange('vol', '音量', '只是音效的音量，跟系统音量无关', 0, 100, 5,
          Math.round(cfg.volume * 100), '%')) +
      group('behav', '行为', true,
        rowSwitch('sound', '音效', '关掉后摸它、啃胡萝卜都不出声，也不会占用音频通道') +
        rowSwitch('wander', '自己溜达', '隔一会儿自己横向挪一段；和"跟着鼠标"只能开一个') +
        rowSwitch('follow', '跟着鼠标', '在光标附近随机走动并停下歇会儿，不会贴着光标挡你看字') +
        rowSwitch('talk', '点击说话', '双击冒一句台词气泡；关掉后双击就没反应了') +
        rowSwitch('feed', '自动吃胡萝卜', '隔 9~22 秒自己掏一根啃，会扣今日胡萝卜')) +
      '<div class="rp-acts">' +
      '<button class="rp-btn" id="rp-act-feed">喂一根</button>' +
      '<button class="rp-btn" id="rp-act-reset">回到右下角</button>' +
      '</div>' +
      group('data', '数据', true,
        '<div class="rp-hint">清空数据会把等级、好感、吃过多少根、胡萝卜库存和位置一起归零。' +
        '（养成系桌宠只记累计值，不显示"本次会话"这类关掉就归零的数字 —— 看着像掉档。）</div>' +
        '<div class="rp-acts">' +
        '<button class="rp-btn" id="rp-act-wipe">清空数据</button>' +
        '</div>') +
      '</div>';                                   // .rp-panel-scroll

    function bindRange(id, key, fn) {
      var input = panel.querySelector('#rp-' + id);
      var out = panel.querySelector('#rp-' + id + '-v');
      input.addEventListener('input', function () {
        var v = Number(input.value);
        out.textContent = v;
        fn(v);
        save();
      });
    }
    bindRange('size', 'size', function (v) { cfg.size = v; layout(); place(); });
    bindRange('op', 'opacity', function (v) { cfg.opacity = v / 100; layout(); });
    bindRange('vol', 'volume', function (v) { cfg.volume = v / 100; Sfx.setVol(cfg.volume); });

    function bindSwitch(id, key, after) {
      var sw = panel.querySelector('#rp-sw-' + id);
      function paint() { sw.classList.toggle('on', !!cfg[key]); }
      paint();
      sw.addEventListener('click', function () {
        cfg[key] = !cfg[key];
        paint(); save();
        if (after) after();
      });
    }
    /* "跟着鼠标"和"自己溜达"是**双向互斥**的：开一个就把另一个关掉。
       为什么必须双向：之前只做了"开跟随时关溜达"，于是"溜达开着时去开跟随"
       能正确互斥，但"跟随着开着时去开溜达"会让两个都亮着 —— 而循环里跟随优先，
       那个刚点亮的溜达开关其实毫无作用，属于骗人的 UI。 */
    function exclusive(idA, keyA, idB, keyB) {
      var a = panel.querySelector('#rp-sw-' + idA);
      var b = panel.querySelector('#rp-sw-' + idB);
      function paintBoth() {
        a.classList.toggle('on', !!cfg[keyA]);
        b.classList.toggle('on', !!cfg[keyB]);
      }
      function wire(self, selfKey, otherKey) {
        /* 这一段必须排在 bindSwitch 的监听之后执行，click 监听按注册顺序触发 */
        self.addEventListener('click', function () {
          if (cfg[selfKey]) {
            cfg[otherKey] = false;
            S.mouse = null;                       // 换模式时不要用上一个残留坐标
            S.spot = null;
            S.targetX = null;
            S.restUntil = 0;
            S.retargetAt = 0;
            save();
          }
          paintBoth();
        });
      }
      wire(a, keyA, keyB);
      wire(b, keyB, keyA);
      paintBoth();
    }

    bindSwitch('sound', 'sound', function () { if (cfg.sound) { Sfx.resume(); Sfx.pop(); } });
    bindSwitch('follow', 'follow', function () { S.spot = null; S.restUntil = 0; S.mouse = null; });
    bindSwitch('wander', 'wander', function () { S.targetX = null; });
    exclusive('follow', 'follow', 'wander', 'wander');

    /* 可滚动区的三个细节：
       1) 滚到底就去掉底部渐隐（.rp-atend），明确告诉用户"到底了"；
       2) 展开/收起分组时**把当前最靠上的那个标题钉住** —— 否则展开一个很长的组
          会把上面的内容顶走，看起来像"点错了"或"下面的项不见了"；
       3) 面板刚打开时滚回顶部。 */
    var scroller = panel.querySelector('.rp-panel-scroll');
    function syncScrollEdge() {
      if (!scroller) return;
      var atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      scroller.classList.toggle('rp-atend', atEnd);
    }
    function topVisibleGroup() {
      if (!scroller) return null;
      var base = scroller.getBoundingClientRect().top, best = null;
      Array.prototype.forEach.call(panel.querySelectorAll('.rp-group'), function (g) {
        var t = g.getBoundingClientRect().top - base;
        if (t > -8 && (best === null || t < best.t)) best = { g: g, t: t };
      });
      return best;
    }
    function keepAnchor(a) {
      if (!scroller || !a) return;
      var t = a.g.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += (t - a.t);
      syncScrollEdge();
    }
    if (scroller) {
      scroller.addEventListener('scroll', syncScrollEdge);
      syncScrollEdge();
    }

    /* 折叠分组：点标题行展开/收起。默认只展开第一组（外观），
       所以矮窗口里必然要滚动才能看全 —— 这是刻意留的滚动。 */
    Array.prototype.forEach.call(panel.querySelectorAll('.rp-group-hd'), function (hd) {
      hd.addEventListener('click', function () {
        var anchor = topVisibleGroup();          // 先记下当前看着谁
        hd.parentNode.classList.toggle('rp-open');
        placePanel();                            // 高度变了，位置要重算
        keepAnchor(anchor);                      // 再把那个标题挪回原处
      });
    });

    bindSwitch('talk', 'talk');
    bindSwitch('feed', 'autoFeed', function () { scheduleAutoFeed(); });

    /* 「喂一根」：**关掉面板 + 把胡萝卜把手显示出来**，引导用户自己去拖。
       为什么不直接 feed()：面板会挡住兔兔，关掉才看得见喂食动作；
       而"把胡萝卜拖到它嘴边"本来就是这个桌宠的核心互动，值得让用户亲手做一次。
       （要"点一下立刻喂"的快捷路径，桌宠自己的自动投喂开关仍然在。） */
    panel.querySelector('#rp-act-feed').addEventListener('click', function () {
      togglePanel(false);
      flashOffer(5000);
    });
    panel.querySelector('#rp-act-reset').addEventListener('click', function () {
      S.x = window.innerWidth - S.W - 40;
      S.y = window.innerHeight - S.H - 20;
      place(); save();
    });
    /* 清空数据：等级 / 好感 / 累计吃了几根 / 位置 / 胡萝卜库存 全部回到初始。
       先确认一次 —— 这是不可撤销的，误点很烦。 */
    panel.querySelector('#rp-act-wipe').addEventListener('click', function () {
      if (!window.confirm('清空兔兔的全部数据？\n等级、好感、吃掉的数量、胡萝卜库存都会归零，且不可撤销。')) return;
      resetAll();
      location.reload();
    });
  }
  /* 把面板里的动态数字刷成当前值。
     面板 HTML 是一次性写死的（buildPanel 只跑一次），所以"已吃 N 根"这类
     会变的数字必须在每次变化时主动同步，否则它会一直停在建面板那一刻的值。
     只维护累计口径（eatCount 存在 localStorage）—— 养成系桌宠不显示"本次会话"。 */
  function syncPanel() {
    if (!panelBuilt) return;                 // 还没建过就不可能显示，不必建
    var a = panel.querySelector('#rp-eat');
    if (a && a.textContent !== String(cfg.eatCount)) a.textContent = String(cfg.eatCount);

    /* 等级 / 好感：全部按当前值重算，幂等，随便调 */
    var info = levelInfo(cfg.xp || 0);
    var set = function (id, text) {
      var n = panel.querySelector('#' + id);
      if (n && n.textContent !== text) n.textContent = text;
    };
    var width = function (id, pct) {
      var n = panel.querySelector('#' + id);
      if (n) n.style.width = pct + '%';
    };
    set('rp-lv', String(info.level));
    set('rp-title', info.title);
    set('rp-xp-txt', info.next ? info.into + ' / ' + info.span : 'MAX');
    /* 颜色阶段那一行：当前档位名 + 区间，满级前顺带预告下一档 */
    var i = TIERS.indexOf(info.tier);
    var nextTier = TIERS[i + 1];
    set('rp-tierline', '颜色阶段：Lv.' + tierRange(info.tier) + ' · ' + info.tier.name +
      (nextTier ? '（下一档 Lv.' + nextTier.from + '）' : '（已是最高档）'));
    /* 只按 prog 四舍五入的话，刚到升级线（into=0）会算成 0%，看着像"没涨"。
       上限一律算满，其余至少给 2%，让它在视觉上确实动过。 */
    width('rp-xp-bar', info.next ? Math.max(2, Math.ceil(info.prog * 100)) : 100);
    set('rp-aff-tier', affTier(cfg.affection || 0));
    set('rp-aff-val', (cfg.affection || 0) + ' / 100');
    width('rp-aff-bar', cfg.affection || 0);

    /* 胡萝卜：今日剩余 + 总共还能吃多少。吃一根两个数一起动（总数一定变小，一眼可见）。
       有存货时额外标注"存 N"，让人知道吃完今天的还有存粮。文案要短，
       否则"已吃 N 根"会被挤到换行、整块变成三行（面板宽 296px，踩过）。 */
    var st = supplyState();
    var qEl = panel.querySelector('#rp-quota');
    if (qEl && qEl.textContent !== String(st.quota)) qEl.textContent = String(st.quota);
    var tEl = panel.querySelector('#rp-total');
    if (tEl && tEl.textContent !== String(st.total)) tEl.textContent = String(st.total);
    var wEl = panel.querySelector('#rp-stock-wrap');
    if (wEl) {
      var txt = st.stock > 0 ? '· 存 ' + st.stock : '';
      if (wEl.textContent !== txt) wEl.textContent = txt;
    }
  }

  /* 把面板摆到兔兔旁边，并**夹回可视区内**（兔兔常待在右下角；面板是 position:fixed，
     所以用视口坐标）。展开/收起分组之后面板会变高，也必须重新摆一次 ——
     否则位置还是按旧高度算的，展开后下半截会跑到屏幕外（踩过）。 */
  function placePanel() {
    var pw = panel.offsetWidth || 296;
    var ph = panel.offsetHeight || 330;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = clamp(S.x + S.W - pw, 8, Math.max(8, vw - pw - 8));
    var top = S.y - ph - 12;
    if (top < 8) top = S.y + S.H + 12;                 // 上方不够就翻到下面
    top = clamp(top, 8, Math.max(8, vh - ph - 8));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.transformOrigin = (S.x + S.W / 2 > left + pw / 2 ? '100%' : '0') + ' ' +
      (S.y > top ? '100%' : '0');
  }

  function togglePanel(open) {
    buildPanel();
    var on = open == null ? !panel.classList.contains('on') : open;
    panel.classList.toggle('on', on);
    gear.classList.toggle('on', on);
    if (on) {
      syncPanel();
      placePanel();
      /* 刚打开时滚回顶部：上次关面板前滚到哪儿了不该继承过来 */
      var sc0 = panel.querySelector('.rp-panel-scroll');
      if (sc0) {
        sc0.scrollTop = 0;
        sc0.classList.remove('rp-atend');
      }
    }
  }
  gear.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
  gear.addEventListener('click', function (ev) { ev.stopPropagation(); togglePanel(); });
  panel.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
  document.addEventListener('pointerdown', onDocDown, true);   // 捕获阶段，见 onDocDown 的说明

  /* ======================= 自动喂食 ======================= */
  function scheduleAutoFeed() {
    clearTimeout(S.feedTimer);
    if (!cfg.autoFeed) return;
    S.feedTimer = setTimeout(function () {
      if (cfg.autoFeed) feed();
      scheduleAutoFeed();
    }, rnd(9000, 22000));
  }

  /* ======================= 移动：跟鼠标 / 自己溜达 =======================
     跟着鼠标 ≠ 粘着鼠标。要求是"根据光标的运动轨迹去，但路径可以随机，
     只要离光标比较近就行" —— 所以实现成**围绕光标的随机游走**：
       1) 在光标附近随机挑一个落脚点（带一段距离，不是光标本身）
       2) 平滑走过去（限速，所以是有惯性的移动而不是瞬移）
       3) 到了就停一会儿"休息"
       4) 休息完 / 光标跑远了 → 重新挑一个落脚点
     这样路径是折线、带停顿，看着像在跟着你溜达；
     如果每帧朝光标做指数平滑，它会永远悬在光标右下角黏着不放，
     你打字时它就压在同一行文字上 —— 那是另一种东西，不是这里要的。 */
  var FOLLOW = {
    distMin: 120,        // 落脚点离光标至少这么远
    distMax: 320,        // 最远这么远（再远就不像"跟着"了）
    speed: 190,          // 移动限速 px/s（有上限，所以不会瞬移）
    respawnDist: 420,    // 光标跑出这个距离，立刻换落脚点（不然像掉队）
    restMin: 500,        // 到了之后休息多久(ms)
    restMax: 1800,
    retargetMin: 1200,   // 两次挑落脚点之间的最短间隔(ms)
    retargetMax: 3000
  };

  function pickFollowSpot() {
    if (!S.mouse) return null;
    /* 随机挑一个方向与距离 —— 方向均匀、距离在 [distMin, distMax] 里随机，
       所以每次的落点都不一样，路径自然就随机了。 */
    var a = Math.random() * TAU;
    var d = rnd(FOLLOW.distMin, FOLLOW.distMax);
    var tx = clamp(S.mouse.x - S.W / 2 + Math.cos(a) * d, 4, Math.max(4, window.innerWidth - S.W - 4));
    var ty = clamp(S.mouse.y - S.H / 2 + Math.sin(a) * d, 4, Math.max(4, window.innerHeight - S.H - 4));
    return { x: tx, y: ty };
  }

  function followTick(dt) {
    if (!S.mouse) return;
    var now = performance.now();

    /* 休息中：歇够之前不动（这就是"停顿"的来源） */
    if (now < (S.restUntil || 0)) return;

    if (!S.spot) {
      if (now < (S.retargetAt || 0)) return;
      S.spot = pickFollowSpot();
      if (!S.spot) return;
    }

    var dx = S.spot.x - S.x, dy = S.spot.y - S.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 6) {                       // 到了：休息一会儿，然后再挑下一个点
      S.spot = null;
      S.restUntil = now + rnd(FOLLOW.restMin, FOLLOW.restMax);
      S.retargetAt = now + rnd(FOLLOW.retargetMin, FOLLOW.retargetMax);
      return;
    }

    /* 光标突然跑远：不追旧点，立刻重挑一个（表现成"跟上去"） */
    var mx = S.mouse.x - (S.x + S.W / 2), my = S.mouse.y - (S.y + S.H / 2);
    if (Math.sqrt(mx * mx + my * my) > FOLLOW.respawnDist) {
      S.spot = pickFollowSpot();
      S.restUntil = 0;
      if (!S.spot) return;
      dx = S.spot.x - S.x; dy = S.spot.y - S.y;
      dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 6) return;
    }

    var step = Math.min(dist, FOLLOW.speed * dt);   // 限速移动
    S.x = clamp(S.x + (dx / dist) * step, 4, Math.max(4, window.innerWidth - S.W - 4));
    S.y = clamp(S.y + (dy / dist) * step, 4, Math.max(4, window.innerHeight - S.H - 4));
    place();
  }

  function wanderTick(dt) {
    if (S.drag) return;
    /* 两个模式互斥（开关是双向互斥的，这里再守一道：
       只要 follow 开着就绝不走溜达分支，免得配置被手改后出现"两个都在动"）。 */
    if (cfg.follow) { followTick(dt); return; }
    if (!cfg.wander) return;
    if (S.targetX == null) {
      if (Math.random() < 0.004) {
        S.targetX = rnd(20, Math.max(30, window.innerWidth - S.W - 20));
        S.dir = S.targetX > S.x ? 1 : -1;
      }
      return;
    }
    var dx = S.targetX - S.x;
    if (Math.abs(dx) < 3) { S.targetX = null; save(); return; }
    /* 等级越高走得越稳（跨度小、不慌），见 TIERS.speed */
    var speed = 26 * tierOf(levelOf(cfg.xp || 0)).speed;
    var step = Math.min(Math.abs(dx), speed * dt) * (dx > 0 ? 1 : -1);
    S.x = clamp(S.x + step, 4, window.innerWidth - S.W - 4);
    place();
  }

  /* ======================= 主动画循环 ======================= */
  var last = performance.now();
  var idleAt = 0;
  function loop(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    S.t += dt;
    S.frames = (S.frames || 0) + 1;    // 自检用：跑了几帧

    /* 呼吸：轻微上下 + 横向呼吸感（挤压用 scale，不用改宽高，避免布局抖动） */
    var breathe = Math.sin(S.t * 1.55) * 0.012;
    var bob = Math.sin(S.t * 1.55 + 0.6) * 1.3;
    var baseT = 'translateY(' + bob.toFixed(2) + 'px) scale(' + (1 + breathe).toFixed(4) + ',' + (1 - breathe).toFixed(4) + ')';
    /* grounded 为假时说明落地动画还在跑，外层 transform 归它管，别去覆盖 */
    if (S.grounded !== false && !inner.dataset.busy) inner.style.transform = baseT;

    wanderTick(dt);

    /* 待机偶尔自己嘟囔一句（不打断正在吃/说话） */
    if (!S.eat && !S.talking && cfg.talk && now - idleAt > 24000 && Math.random() < 0.0016) {
      idleAt = now;
      floatWord(pick(WORDS.idle), 'c-idle');
    }
    S.raf = requestAnimationFrame(loop);
  }

  /* ======================= 关键字事件（具名，便于 dispose 摘除） ======================= */
  function onResize() {
    layout();
    S.x = clamp(S.x, 4, Math.max(4, window.innerWidth - S.W - 4));
    S.y = clamp(S.y, 4, Math.max(4, window.innerHeight - S.H - 4));
    place();
    positionOffer();
    if (panel.classList.contains('on')) togglePanel(true);
  }
  function onKey(ev) {
    if (ev.key === 'Escape' && panel.classList.contains('on')) togglePanel(false);
  }
  /* 点击面板外的**任意位置** → 关闭面板。
     用**捕获阶段**（注册时第三个参数传 true）：DSH 界面里的元素（React 组件、输入框、
     各种挂件）可能在冒泡阶段调 stopPropagation，挂在冒泡阶段就收不到事件，
     表现成"面板打开后点别处关不掉"。捕获阶段在事件往下传时就触发，
     不受子元素 stopPropagation 的影响。 */
  function onDocDown(ev) {
    if (!panel.classList.contains('on')) return;
    var t = ev.target;
    if (!t || t.nodeType !== 1) return;
    if (panel.contains(t)) return;                                  // 点面板内部：不关
    if (gear && (t === gear || gear.contains(t))) return;           // 点齿轮：它自己是开关
    togglePanel(false);
  }
  function onFirstPointer() { Sfx.resume(); window.removeEventListener('pointerdown', onFirstPointer); }
  /* 跟着鼠标：只在开启时记录坐标，循环里再做平滑跟随。
     刻意不监听 pointermove 去直接改位置 —— 那样事件频率一变就抖，交给 rAF 平滑更稳。 */
  function onMouseMove(ev) {
    if (!cfg.follow) return;
    S.mouse = { x: ev.clientX, y: ev.clientY };
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);
  window.addEventListener('mousemove', onMouseMove, { passive: true });

  /* ======================= 出场（可选的淡入） =======================
     fadeIn: 毫秒；0 = 直接出现（要"瞬间就在那儿"就传 0）。
     为什么不用 CSS 动画写 transform：兔兔的位置本身就是靠 .rp-pet 的 transform 摆的，
     动画再去写 transform 会跟 translate3d 打架。所以摆好位置后，把 transform 换成
     "位置 + 一点点向下偏移 + 略小"，再用 transition 收回去 —— 看起来是从下方轻轻浮上来。

     ⚠ 触发那一步绝不能只挂 requestAnimationFrame。
     实测（无头/节流环境下）rAF 可能完全不调度，于是回调里的 `opacity = ''` 永远不执行，
     兔兔就卡在 opacity:0 —— **整个桌宠不可见**。这不是动画不好看的问题，是功能没了。
     所以改成 rAF 与 setTimeout 双保险（谁先到用谁），并且额外挂一个"兜底"，
     到时间无论如何都要把它变成可见。 */
  function playAppear(fadeIn, onDone) {
    if (!fadeIn) { if (onDone) onDone(); return; }
    var base = 'translate3d(' + S.x.toFixed(1) + 'px,' + S.y.toFixed(1) + 'px,0) scale(' + DEBUG.scale + ')';
    pet.style.transition = 'none';
    pet.style.opacity = '0';
    pet.style.transform = 'translate3d(' + S.x.toFixed(1) + 'px,' + (S.y + 16).toFixed(1) + 'px,0) scale(' +
      (DEBUG.scale * 0.96) + ')';
    void pet.offsetWidth;                       // 强制一次重排，让下面的 transition 生效

    var started = false;
    var start = function () {
      if (started) return;
      started = true;
      pet.style.transition = 'transform ' + fadeIn + 'ms cubic-bezier(.2,.9,.25,1), opacity ' +
        Math.round(fadeIn * 0.7) + 'ms ease';
      pet.style.opacity = '';
      pet.style.transform = base;
      setTimeout(function () { pet.style.transition = ''; pet.style.transform = base; }, fadeIn + 60);
    };
    requestAnimationFrame(start);
    setTimeout(start, 32);                      // rAF 不跑时的保险
    /* 兜底：即使上面两次都没生效（极端节流），也不能让兔兔留在不可见状态 */
    setTimeout(function () {
      pet.style.transition = '';
      pet.style.opacity = '';
      pet.style.transform = base;
      if (onDone) onDone();                     // 无论如何都要报"已出场"
    }, fadeIn + 200);
  }

  /* ======================= 落地动画 =======================
     启动动画最后那只兔子是"退场"的，所以这只从**上方落下来**接住它。
     用 rAF 自己驱动而不是 CSS 动画：兔兔的位置本来就靠 transform 摆，
     CSS 动画再写 transform 会跟定位打架；而且我们要做"下落 + 落地压扁回弹"这种
     分成两段的手感，交给 rAF 更好控制。
     时长按"要短"来定：默认 360ms（下落 60% + 回弹 40%）。
       · 高度从略高一点的落下（不是从屏幕顶端，那样太慢）
       · 下落时略微拉长（squash & stretch）
       · 触地一瞬压扁，再弹回原状
     落地期间要让呼吸循环回避（S.grounded = false），否则两个 transform 会互相覆盖。
     两处调用，靠参数区分手感：
       · 出场：360ms、从上方约 22vh 落下（接住启动动画里退场的那只）
       · 拖动松手：240ms、只落 26px —— 提起放下是**轻快的一记"啪"**，
         落差给小、时长给短；沿用出场那套参数会变成慢悠悠飘下来，不像放下 */
  function playDrop(ms, fromY, onDone) {
    var dur = Math.max(120, ms || 360);
    var drop = fromY == null ? Math.min(220, Math.round(window.innerHeight * 0.22)) : fromY;
    var start = performance.now();
    var base = 'translate3d(' + S.x.toFixed(1) + 'px,' + S.y.toFixed(1) + 'px,0) scale(' + DEBUG.scale + ')';
    S.grounded = false;
    pet.style.transition = 'none';

    var draw = function () {
      var k = Math.min(1, (performance.now() - start) / dur);
      var ty, sx, sy;
      if (k < 0.6) {
        /* 下落：ease-in（越落越快），同时轻微拉长 */
        var e = Math.pow(k / 0.6, 1.7);
        ty = S.y - drop * (1 - e);
        sx = DEBUG.scale * (1 - 0.05 * e);
        sy = DEBUG.scale * (1 + 0.07 * e);
      } else {
        /* 触地：压扁后回弹。用一次阻尼振荡搞定，不用分段。 */
        var t = (k - 0.6) / 0.4;                 // 0..1
        var w = Math.exp(-5.5 * t) * Math.cos(t * Math.PI * 1.7);
        ty = S.y + 3 * (1 - t);
        sx = DEBUG.scale * (1 + 0.14 * w);
        sy = DEBUG.scale * (1 - 0.15 * w);
      }
      pet.style.transform = 'translate3d(' + S.x.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,0) scale(' +
        sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
      if (k < 1) {
        /* 刻意用 setTimeout 而不是 requestAnimationFrame：
           rAF 在无头浏览器里不会被持续调度（这个项目已经踩过两次），
           而落地动画是"加载后立刻要看到"的东西，不能依赖调度时机。
           时序本身用 performance.now() 算，所以掉帧也不会变速。 */
        S.dropTimer = setTimeout(draw, 16);
      } else {
        pet.style.transform = base;
        S.grounded = true;
        /* 落地过程中兔兔的 Y 是动画写的，place() 没被调用过，
           所以把手会停在落地**起点**的位置。这里补一次定位，让它跟着落到新位置。
           （不能指望动画循环去纠正：循环靠 rAF 驱动，无头/节流环境下不一定跑。） */
        positionOffer();
        if (onDone) onDone();          // 真正站稳了才算"已出场"
      }
    };
    draw();
  }

  /* ======================= 起手 ======================= */
  layout();
  S.x = (typeof cfg.x === 'number' && !isNaN(cfg.x)) ? cfg.x : null;
  S.y = (typeof cfg.y === 'number' && !isNaN(cfg.y)) ? cfg.y : null;
  layout();
  place();
  positionOffer();        // 把"拖拽喂食"的胡萝卜把手摆到兔兔旁边（起手时也要定位一次）
  applyTierLook();        // 按已有等级把外观摆对（辉光）
  /* 每日签到：起手读一次库存。supplyRead() 内部会在"换天/第一次"时自动签到，
     所以这里只需要判断"是不是刚签的"，是的话报一句。
     满仓时 gain 会小于 SUPPLY_BASE（因为库存到上限了），提示里要说清楚收了多少、少收多少。
     注意：这段必须在触发出场动画**之前**定义好 —— 出场可能同步回调 onAppeared()。 */
  S.supply = supplyState();
  function announceCheckIn() {
    var s = S.supply;
    if (!s || !s.fresh) return;
    var msg = '签到完成 · 今日 +' + s.gain + ' 根';
    if (s.gain < s.base) msg += '（库存已满，少收 ' + (s.base - s.gain) + '）';
    msg += ' · 共 ' + s.total + ' 根';
    bubble(msg, '', 3000);
    floatWord('签到 +' + s.gain, 'c-mood');   // 再飘一句，比只有气泡更容易被注意到
    Sfx.levelUp();
    syncPanel();
    /* 报完就把 gain 清掉：它同时是"今天是不是刚签到"的标志。
       不清的话它会整天保持非零，于是**每次加载都再弹一遍"签到完成"**，
       启动动画那边也会一直说"今日签到完成"、永远切不到"今日补给已领"。
       （胡萝卜不会因此多发，但提示是错的。） */
    var o = supplyRead();
    o.gain = 0;
    supplyWrite(o);
  }
  /* 签到提醒挂在"真正的出场时刻"上（见下）——早一分晚一分都不对 */
  opts.onAppear = announceCheckIn;

  /* 出场：优先用"落地"（给 landMs），否则退回淡入；两个都没给就是直接出现。
     `onAppear` 在**兔兔真正可见的那一刻**回调一次 —— 每日签到提醒挂在它上面。
     为什么不能用固定延时（早先就是 `setTimeout(…, 900)`）：
     插件是在"等启动动画退场"之后才创建引擎的，等多久完全不确定
     （正常几十毫秒，退场标记没等到就要等到 maxWaitMs=15s）。
     固定延时要么在兔兔还没出现时就把气泡弹完了（等得久的情况，用户什么都看不到），
     要么出现之后还要干等（等得短的情况）。 */
  var appearDone = false;
  function onAppeared() {
    if (appearDone) return;
    appearDone = true;
    if (typeof opts.onAppear === 'function') {
      try { opts.onAppear(); } catch (e) { /* 回调出错不能影响桌宠本体 */ }
    }
  }
  if (opts.landMs) playDrop(opts.landMs, opts.dropFrom, onAppeared);
  else if (DEBUG.land) playDrop(DEBUG.land, null, onAppeared);
  else if (opts.fadeIn) playAppear(opts.fadeIn, onAppeared);
  else onAppeared();                              // 直接出现：立刻算已出场
  if (USE_QUERY && Q.offer === '1') carrotHandle.classList.add('rp-out');   // 截图用：强制显示把手
  setTimeout(onAppeared, 2600);                   // 兜底：动画万一没走完也要回调一次
  scheduleAutoFeed();

  // 调试：把状态直接摆好
  if (DEBUG.panel) togglePanel(true);
  if (DEBUG.state === 'levelup') { setTimeout(function () { feed(); }, 80); }
  else if (DEBUG.state === 'eat') { feed(5); }
  else if (DEBUG.state === 'eat1') { feed(5); biteOnce(); }
  else if (DEBUG.state === 'eat2') { feed(5); biteOnce(); biteOnce(); }
  else if (DEBUG.state === 'talk') { setTimeout(talk, 60); }
  else if (DEBUG.state === 'touch') { setTimeout(function () { touch(S.x + S.W / 2); }, 60); }
  else if (DEBUG.state === 'panel') { togglePanel(true); }
  if (DEBUG.freeze) { /* 不启动循环，画面静止，便于截图 */ }
  else requestAnimationFrame(loop);

  // 首次交互时解锁音频
  window.addEventListener('pointerdown', onFirstPointer);

  /* ======================= 对外手柄 ======================= */
  var api = {
    feed: feed, talk: talk, touch: touch, biteOnce: biteOnce,
    /* 调试/试玩用：直接加经验（走 addXp，升级表现也会一起走） */
    grantXp: addXp,
    grantAffection: addAffection,
    levelInfo: function () { return levelInfo(cfg.xp || 0); },
    levelInfoAt: levelInfo,                 // 查"某个 xp 对应哪一级"（探针/调试用）
    titleOf: titleOf,
    tierOf: tierOf,                         // 查某一级属于哪个颜色档
    tiers: TIERS,
    maxLevel: MAX_LEVEL,
    /* 胡萝卜库存：启动动画那边读的是同一个 localStorage 键，
       通过这个接口对外暴露，省得两边各写一份读写逻辑。
       quota = 今日签到领到、还没吃的；stock = 累积库存；available = 今天总共还能喂几根。 */
    supply: {
      left: supplyLeft,            // 累积库存
      quota: supplyQuota,          // 今日剩余配额
      available: supplyAvailable,  // 配额 + 库存
      take: supplyTake,
      base: SUPPLY_BASE,
      cap: SUPPLY_CAP,
      checkedToday: supplyCheckedToday,
      state: supplyState
    },
    /* 还能不能喂。启动动画可以调它做校验，
       这样"能不能喂"的规则只有一份，不会两边算出不同结果。 */
    canFeed: function () { return supplyAvailable() > 0; },
    /* 手动推进一次跟随/溜达（自检用）。
       为什么需要它：跟随是"每帧按 dt 靠近一点"的积分逻辑，
       而无头浏览器不会持续调度 requestAnimationFrame —— 光靠等是验不出来的，
       所以这里给自检一个能显式喂 dt 的入口。 */
    step: function (dt) { wanderTick(dt == null ? 1 / 60 : dt); return { x: S.x, y: S.y }; },
    /* 手动触发一次落地动画（自检/调试用） */
    drop: function (ms, fromY) { playDrop(ms, fromY); },
    setFollow: function (on) {
      cfg.follow = !!on;
      S.mouse = null;
      if (cfg.follow) cfg.wander = false;
      save();
      syncPanel();
      return cfg.follow;
    },
    config: cfg,
    state: S,
    save: save,
    openPanel: function () { togglePanel(true); },
    closePanel: function () { togglePanel(false); },
    /* 清空数据：本插件的所有存档键一起清（面板里的"清空数据"走的是同一条路） */
    reset: function () { resetAll(); location.reload(); },
    resetAll: resetAll,
    /* 卸载：清定时器、摘监听、把节点从 DOM 里拿掉（插件卸载时必须调用） */
    dispose: function () {
      clearTimeout(S.feedTimer);
      clearTimeout(S.bubbleTimer);
      clearTimeout(S.dropTimer);
      if (S.raf) cancelAnimationFrame(S.raf);
      S.raf = 0;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onFirstPointer);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerdown', onDocDown);
      Sfx.close();
      if (layer.parentNode) layer.parentNode.removeChild(layer);
    }
  };
  return api;
}

/* =============================================================================
   独立预览页：直接引入本文件时自动起一只；
   作为 DSH 插件打包时，文件底部这段会被去掉（见 tools/build_plugin.py）
   ============================================================================= */
if (typeof window !== 'undefined' && !window.__RHODES_PET_NO_AUTO) {
  window.RHODES_PET = RHODES_PET_ENGINE({
    img: '../rhodes-loading/assets/rabbit-cut.png',
    container: document.body
  });
}
