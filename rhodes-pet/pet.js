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
    name: '',           // 自定义名称：起名后会显示在兔兔头顶（空 = 不显示）
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
    y: null,
    /* 设置面板的位置。null = 自动摆在兔兔旁边（默认行为）；
       用户拖过面板之后就记下坐标，下次打开还放在他放的地方 ——
       "把它挪到这儿"本身就是个意图，不该每次都被自动摆位覆盖掉。
       双击标题栏可以清空这两项、回到自动跟位。 */
    panelX: null,
    panelY: null
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
    /* ⚠ 这里必须是 null，不能是 0。
       下面有一句 `if (DEBUG.fed != null && isFinite(...)) cfg.eatCount = ...`，
       而 0 != null 是**成立**的 —— 于是插件模式（debug:false）下每次启动都会执行
       那句赋值，把"累计吃了几根"清成 0。
       xp / aff / supply 用的都是 null 所以没事，只有 fed 当初写成了 0。
       症状：重启后等级、好感、胡萝卜库存都在，唯独"已吃"归零。 */
    fed: USE_QUERY && Q.fed != null ? Number(Q.fed) : null,
    scale: USE_QUERY ? Number(Q.scale || 1) : 1,
    state: (USE_QUERY && Q.state) || '',
    freeze: USE_QUERY && Q.freeze === '1',   // 停掉主动画循环（截图时避免抖动）
    notrans: USE_QUERY && Q.notrans === '1', // 关掉所有过渡（排查合成/动画类问题时用）
    img: (USE_QUERY && Q.img) || '',
    xp: USE_QUERY && Q.xp != null ? Number(Q.xp) : null,
    aff: USE_QUERY && Q.aff != null ? Number(Q.aff) : null,
    supply: USE_QUERY && Q.supply != null ? Number(Q.supply) : null,
    follow: USE_QUERY && Q.follow === '1',
    land: USE_QUERY && Q.land != null ? Number(Q.land) : null,
    /* 截图/自检用：强制摆出"流口水"和"腮红"两个状态
       （正常靠拖胡萝卜 / 吃完触发，headless 里不好制造） */
    blush: USE_QUERY && Q.blush === '1',
    drool: USE_QUERY && Q.drool === '1',
    /* 生气/哭：?mad=1 直接摆出生气那一刻（眼泪 + 飞机耳 + 撇嘴 + 抖），
       ?mad=2 摆成"躲在屏幕边上抽泣"。用 mstat 是因为 `state` 已经被上面用掉了。 */
    mad: USE_QUERY && Q.mad != null ? Number(Q.mad) : null,
    mstat: (USE_QUERY && Q.mstat) || '',
    /* ?pose=hide 拍照用：直接摆成"躲在屏幕边抽泣"的静止姿态（不跑挪过去的动画）
       ⚠ 这个键必须在 DEBUG 里声明：严格模式下给未声明的属性赋值会直接抛 ReferenceError，
         而且报出来是"Script error."（跨域报错的标准模样），极难定位 —— 踩过一次。 */
    pose: (USE_QUERY && Q.pose) || '',
    /* 生气计时压缩（自检用）：把"生气 1 秒 / 躲起来 3.8 秒 / 委屈 3.2 秒"按比例缩短，
       否则一个探针要等 8 秒以上。真实运行永远是 1。 */
    angerMs: USE_QUERY && Q.angerMs != null ? Number(Q.angerMs) : 1,
    /* 截图用：把兔兔摆到指定的 x（比如 ?x=60 看它在左半边镜像后的样子） */
    x: USE_QUERY && Q.x != null ? Number(Q.x) : null
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
  /* 生气：?mad=1 直接摆出生气那一刻（眼泪）、?mad=2 摆成躲在屏幕边上抽泣。
     用 setTimeout(…,80) 而不是同步执行 —— 这几个动作都靠 class + 过渡/动画表现，
     得等元素先进入文档、浏览器认下来，否则第一帧的过渡会被吞掉（腮红/口水同此理）。
     截图时配合 ?freeze=1 停住主动画循环。 */
  if (DEBUG.mad === 1 || DEBUG.state === 'mad' || DEBUG.mstat === 'mad') {
    setTimeout(function () {
      S.anger.n = ANGER_N;
      enterAnger();
    }, 80);
  } else if (DEBUG.mad === 2 || DEBUG.state === 'hide' || DEBUG.mstat === 'hide') {
    setTimeout(function () {
      enterAnger();
      goHide();
    }, 80);
  }
  /* 计时压缩只在调试页生效（0/NaN 都当 1，不能让它把阶段时长算成 0 或负数） */
  if (!(DEBUG.angerMs > 0)) DEBUG.angerMs = 1;

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
      '（它拍了拍自己的肚子，很满意。）', '又长了一点点！', '（它转了个圈给你看。）'],
    /* 被戳烦了：紫红色，最后一句会说清"再戳就要生气了" */
    angry: ['别戳了！', '唔……！', '（耳朵往后压）', '博士！', '（把脸转开）',
      '再戳我要生气了', '（尾巴炸了一下）'],
    /* 躲在屏幕边上哭：淡蓝，带省略号，读起来是抽抽搭搭的 */
    cry: ['呜……', '呜呜……', '（抽了抽鼻子）', '……博士真坏',
      '（把脸埋进外套里）', '呜……不讲道理', '（缩到屏幕边上去了）'],
    /* 委屈（哭完之后那几秒）：摸它会说这些 */
    sad: ['（吸了吸鼻子）', '……哼。', '（耳朵还压着）', '你别戳我了。',
      '（偷偷看了你一眼）']
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
      /* 抓起兔兔："啵"地一下被提起来 —— 上扬的软音 + 一点绒毛摩擦。
         只在**真的开始拖**时才响（见 pointermove 里的 moved 判定），
         单击摸头不响这个，否则"点一下"和"提起来"听起来一样。 */
      grab: function () {
        if (!cfg.sound || !ensure()) return;
        var j = rnd(0.94, 1.06);
        noise(0.05, 0.04, rnd(2200, 3000), 0.9);            // 绒毛摩擦
        tone(640 * j, 0.085, 0.10, 'sine', 1180 * j);       // 上扬（被提起）
        tone(1600 * j, 0.05, 0.035, 'triangle', 2000 * j, 0.025);
      },
      /* 放下兔兔：软软地落下去 —— 下滑音 + 一记低音 + 极轻的触地声。
         和 playDrop 的落地动画同时播，听感上"落"和"响"是一件事。 */
      put: function () {
        if (!cfg.sound || !ensure()) return;
        var j = rnd(0.94, 1.06);
        tone(760 * j, 0.11, 0.09, 'sine', 360 * j);         // 下滑（落下去）
        tone(240 * j, 0.09, 0.055, 'sine', 165 * j, 0.015); // 低频"咚"
        noise(0.045, 0.035, 820, 1.2, 0.03);                // 触地
      },
      /* 升级：三音上行 + 一层很轻的闪烁，听起来像"变强了"而不是"叮咚" */
      levelUp: function () {
        if (!cfg.sound || !ensure()) return;
        var j = rnd(0.98, 1.03);
        tone(660 * j, 0.12, 0.10, 'sine', 990 * j);
        tone(990 * j, 0.14, 0.09, 'sine', 1320 * j, 0.09);
        tone(1320 * j, 0.30, 0.07, 'triangle', 1980 * j, 0.18);
        noise(0.22, 0.03, 4200, 0.7, 0.02);
      },
      /* ============ 被戳烦了 / 哭 ============
         三个音刻意都往下走 —— 这只好脾气的兔子所有开心的音（touch / happy / levelUp）
         都是上扬的，往下走就成了"它不高兴"最直接的听觉线索。 */
      /* 被戳烦了：短促的下滑"呜"
         （520 这个基频是特意选的：它不和任何已有音效重合 ——
           抓取 640/1600、放下 760/240、摸头 760/1520 —— 所以 probe=sound 能认出它来） */
      yip: function () {
        if (!cfg.sound || !ensure()) return;
        var j = rnd(0.93, 1.09);
        tone(520 * j, 0.13, 0.10, 'triangle', 330 * j);
        tone(780 * j, 0.06, 0.035, 'sine', 560 * j, 0.02);
        noise(0.05, 0.035, rnd(1500, 2100), 0.9);
      },
      /* 抽泣一声：两段下滑，像压着嗓子在哭 */
      sob: function (big) {
        if (!cfg.sound || !ensure()) return;
        var j = rnd(0.88, 1.12);
        var g = big ? 0.115 : 0.075;
        tone(470 * j, big ? 0.26 : 0.19, g, 'triangle', 250 * j);
        tone(360 * j, 0.17, g * 0.75, 'sine', 208 * j, 0.15);
        if (big) tone(210 * j, 0.22, 0.045, 'sine', 160 * j, 0.05);
      },
      /* 吸鼻子：一小段带通噪声先"吸"上来，再一记很轻的下滑
         （880 也不和已有音效重合，probe 同样认得出） */
      sniff: function () {
        if (!cfg.sound || !ensure()) return;
        var j = rnd(0.9, 1.12);
        noise(0.11, 0.05, 880 * j, 2.2);
        tone(310 * j, 0.09, 0.05, 'sine', 215 * j, 0.09);
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
    /* 翻转包装层：镜像挂在这里，而不是 .rp-inner 上。
       原因有两条：
         1. 镜像要连腮红 / 口水 / 胡萝卜一起翻 —— 它们都挂在 .rp-inner 里；
         2. 翻转要走一条 **200ms** 的过渡（用户要求"转身要快一些，200ms"），
            而 .rp-inner 的 transform **每帧都被呼吸/蹦跳重写**，
            过渡挂在它上面会被一帧一帧重置 —— 看起来跟没动画一样。
            这一层没别人碰，正好挂过渡。
       它是普通块级元素、宽度撑满兔兔，transform-origin 默认 50% 50%，
       所以镜像是绕自身竖直中轴翻，**不产生位移**。
       ⚠ 不要给 .rp-pet 加子选择器 `>` 去选 .rp-inner：中间隔着这一层。 */
    '.rp-flip{position:relative;width:100%;transform-origin:50% 50%;will-change:transform;',
    '  transition:transform .2s ease}',
    /* 图片上的滤镜一律从 `--rp-glow` 拼出来。
       ⚠ 这里踩过一个"静默失效"：等级辉光是 JS 按档位算颜色，以前直接写
         `img.style.filter = …` —— **内联样式优先级最高**，于是下面三条 class 规则
         （rp-dim 面板变暗、rp-angry 生气脸红、rp-mouth 拖到嘴边亮一下）全被压掉，
         一条都没生效，而且代码看着完全正常。
       现在 JS 只写一个自定义属性（`img.style.setProperty('--rp-glow', …)`），
       基础滤镜和"叠加效果"都在 CSS 里拼 —— 谁也不会再压掉谁。
       兜底值给的是那条默认投影（不能写 `none`：`none` 不能出现在滤镜函数列表里，
       整条声明会被丢掉，等于又把叠加效果弄没了）。 */
    '.rp-img{display:block;width:100%;height:auto;pointer-events:none;',
    '  filter:var(--rp-glow,drop-shadow(0 10px 18px rgba(0,0,0,.55)))}',
    '.rp-layer.rp-dim .rp-img{',
    '  filter:var(--rp-glow,drop-shadow(0 10px 18px rgba(0,0,0,.55))) brightness(1.06)}',

    /* 腮红：吃完胡萝卜后在脸颊上泛一下。
       位置从素材量出来：眼睛中心约 (51%,20%)、鼻子约 (44%,30%)。
       宽 14% / 高 12%、左上角落在 (44%,21%) —— 中心 (51%,27%)，
       正好压在眼睛正下方的脸颊肉上，左边不越到鼻子（44%）上去。
       径向渐变 + 透明收边，看起来是"透出来的红"，不是贴了一块色块。 */
    '.rp-blush{position:absolute;left:44%;top:21%;width:14%;height:12%;border-radius:50%;',
    '  background:radial-gradient(closest-side,rgba(255,108,140,.62),',
    '    rgba(255,108,140,.30) 62%,rgba(255,108,140,0));',
    '  opacity:0;pointer-events:none;filter:blur(.5px);transition:opacity .3s ease}',
    '.rp-pet.rp-blush-on .rp-blush{opacity:1}',
    /* 口水：拖胡萝卜时从嘴角（约 45%,32%）往下挂一滴，轻微"滴一下"。
       只用 transform 动（不改 top），这样不会触发重排。 */
    '.rp-drool{position:absolute;left:42.5%;top:31%;width:5%;',
    '  opacity:0;pointer-events:none;transform-origin:50% 0;transition:opacity .16s ease}',
    '.rp-drool svg{display:block;width:100%;height:auto;',
    '  filter:drop-shadow(0 1px 2px rgba(0,0,0,.28))}',
    '.rp-pet.rp-drool-on .rp-drool{opacity:1;animation:rp-drip 1.1s ease-in-out infinite}',
    '@keyframes rp-drip{0%,100%{transform:translateY(0) scaleY(1)}',
    '  45%{transform:translateY(6%) scaleY(1.22)}80%{transform:translateY(2%) scaleY(1.06)}}',
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
    /* 飞机耳：生气/委屈时耳朵向后压。
       ⚠ 必须带上 `.rp-ear.on`（0,2,0）压过上面的 `.rp-ear.on`（0,2,0 同级、
         靠"后写的赢"）—— 只写 `.rp-ear.rp-down`（0,2,0）会被 .rp-ear.on 的 opacity 抢掉。
         加了 .on 之后不透明度是 1，所以尾巴还得给出 `opacity:1` 把 .on 的 .92 盖过去。 */
    '.rp-ear.rp-down{opacity:1;transform:rotate(38deg) scaleY(.7)}',
    '.rp-ear.rp-down.l{transform:rotate(-38deg) scaleY(.7)}',
    '.rp-ear.on.rp-down{opacity:1}',
    /* 撇嘴：嘴角往下一撇（素材是张真实照片，改不了脸，所以用一小段弧线画在嘴上）
       位置是按素材**量出来的**：兔子的嘴是鼻头下面那个"Y"字（鼻头 + 人中），
       交点约 (35.5%, 27%)、人中竖线一直拉到 33.5% —— 弧线就压在这个 Y 下面，
       所以 left/top 取 (34.2%, 28.2%)、宽 6%、高 3%。
       ⚠ 旧值是 (41.5%, 33%)：那是**脸颊**，不是嘴（和眼泪一样来自那次量错的坐标）。
       线宽不写死 px 而是读 --rp-mouth-bw（layout() 按兔兔宽度算）——
       否则 80px 的小兔兔会顶着一根 3px 的粗弧线、320px 的大兔兔又细得看不见。 */
    '.rp-mouthdown{position:absolute;left:34.2%;top:28.2%;width:6%;height:3%;opacity:0;',
    '  pointer-events:none;transition:opacity .18s ease}',
    '.rp-mouthdown span{display:block;width:100%;height:100%;',
    '  border-bottom:var(--rp-mouth-bw,3px) solid #93496a;',
    '  border-radius:0 0 50% 50%;filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))}',
    /* ⚠ 类名只有 **rp-angry**：引擎里 `pet.classList.add('rp-angry')`。
       这里曾经写成 `rp-anger`（少一个 y），于是下面三条规则**全是死的** ——
       撇嘴、脸红暖光、发抖一个都没生效；眼泪那条因为同时列了 `.rp-anger` 和
       `.rp-angry` 才侥幸活着（所以"看得见眼泪、看不见表情"这种现象很容易骗过自检）。
       教训：动画/表情按 class 走的时候，class 名要在**同一处**定义，别靠记性。 */
    '.rp-pet.rp-angry .rp-mouthdown{opacity:.9}',
    /* ============ 生气 / 哭（眼泪是画出来的，不是贴图） ============
       坐标是**把素材打上网格量出来的**（332×305 的原图 + 瞳孔质心）：
         可见的那只眼睛中心 ≈ **(50%, 21%)**（瞳孔横跨 48%~52%、竖跨 19%~24%），
         鼻头 / 嘴（那个"Y"的交点）≈ (36%, 27%)。
       ⚠ 曾经写成 (46%, 27%) —— 那是**鼻子**的位置，不是眼睛：于是眼泪既低了
         12 个百分点、又偏了 4 个百分点，挂在嘴角和脸颊上（用户直接圈着眼睛说不准）。
         真实照片素材上"眼睛"和"鼻子"只差几个百分点，光看代码根本发现不了，必须量。
       **只画一条**，正对眼睛：上端从下眼睑 (23%) 开始往下淌，
       泪珠本身约 5.5% 宽 × 4.4% 高，正好是一只眼睛的大小。
       加一点 blur 就是一条泪痕；泪痕上端不透明、往下慢慢化开（渐变在 SVG 里）。 */
    '.rp-tear{position:absolute;left:37%;top:18.5%;width:26%;height:42%;opacity:0;pointer-events:none;',
    '  filter:blur(.4px) drop-shadow(0 1px 2px rgba(20,40,60,.45));transition:opacity .22s ease}',
    /* left 的算法：泪珠固定在元素水平中点，所以 **元素中心 = left + 13%**（宽 26% 的一半）。
       left=37% → 中心 50%，正好落在眼睛 (50%, 21%) 上。
       ⚠ 早先是两条（34% / 40%，各夹着眼睛一侧），现在按用户要求只留一条、
         直接对准眼睛 —— 想让泪痕稍微偏到内眼角/外眼角，只改这一个数即可。 */
    '.rp-tear svg{display:block;width:100%;height:100%;overflow:visible;',
    '  filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}',
    /* 眼泪的"扫过"：整条泪痕往下挪一点点、同时微微明暗 ——
       看起来是"一滴从眼睛里滑下去"，而不是整条同时闪。
       ⚠ 两点都是踩过的坑：
         · 动画**不能带 fill-mode:both/forwards** —— 帧里的 opacity 会一直压着
           "收起眼泪"那条过渡，眼泪就再也淡不掉了；
         · 透明度**不能淡到 0** —— 那样每次循环都会有一段"眼泪不见了"的空档，
           截图/肉眼都可能正好撞上（第一版就是淡到 0，结果截出来几乎是空的）。 */
    /* 出现：**过渡 + 一条不带 fill 的入场动画，两个一起给**。
       ⚠ 只给 `transition` 的话，class 是在页面早就画完、元素已经被解析成 opacity:0
         之后才加的（真实的戳→生气就是这条路径），浏览器有时就是不起这条过渡：
       表现是"class 有、眼泪死活不出来"（探针 0c 项就是盯这个的：opacity 必须是 1）。
       入场动画兜住这种情况 —— 它不跑也没关系，class 上那条 `opacity:1` 会立刻生效
       （最坏情况只是没有 0.22s 的淡入，而不是看不见）。
       ⚠ 动画**绝不能带 fill-mode:both/forwards**：帧里的 opacity 会一直压着
         "收起眼泪"那条过渡，眼泪就再也淡不掉了。 */
    '.rp-pet.rp-angry .rp-tear{opacity:1;animation:rp-tearin .22s ease}',
    '@keyframes rp-tearin{from{opacity:0}to{opacity:1}}',
    '.rp-pet.rp-angry .rp-tear svg{',
    '  animation:rp-tearsweep 1.5s linear infinite}',
    '@keyframes rp-tearsweep{0%{opacity:.5;transform:translateY(-12%)}',
    '  40%{opacity:1;transform:translateY(0)}',
    '  78%{opacity:1;transform:translateY(5%)}',
    '  100%{opacity:.5;transform:translateY(10%)}}',
    /* 躲起来抽泣时眼泪只留一半（肩线以下已经躲到屏幕边外了），慢慢明暗，像还在哭 */
    '.rp-pet.rp-hide .rp-tear{opacity:.8}',
    '.rp-pet.rp-hide .rp-tear svg{animation:rp-tearsad 2.4s ease-in-out infinite}',
    '@keyframes rp-tearsad{0%,100%{opacity:.5;transform:translateY(-5%)}',
    '  50%{opacity:1;transform:translateY(5%)}}',
    /* 生气那 1 秒：脸憋红一点（素材是照片，不能改脸型，只能给点暖色 + 压暗一圈）。
       滤镜从 --rp-glow 拼（见 .rp-img 那段说明：不能直接写内联 style.filter） */
    '.rp-pet.rp-angry .rp-img{',
    '  filter:var(--rp-glow,drop-shadow(0 10px 18px rgba(0,0,0,.55))) saturate(1.22)',
    '  drop-shadow(0 0 16px rgba(255,96,120,.5))}',
    /* 躲到屏幕边上的那几秒：不能接点击 —— 挡住"继续戳"，
       而且这时兔兔本来就是"藏起来了"，点不到才对。 */
    '.rp-pet.rp-hide{pointer-events:none}',
    /* 生气时整只轻轻抖。
       ⚠ 抖动必须写在内层**图片**上、不能写 .rp-inner：内层的 transform 是呼吸/蹦跳
         （setInner 每帧写）在用的，CSS 动画一挂上去两边就互相覆盖。图片层没别人碰。 */
    '.rp-pet.rp-angry .rp-img{animation:rp-shiver .28s linear infinite}',
    '@keyframes rp-shiver{0%,100%{transform:translateX(-1px)}50%{transform:translateX(1px)}}',

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
    /* 光标接近嘴边时兔兔亮一下：告诉用户"松手就能喂到"。同样从 --rp-glow 拼 */
    '.rp-pet.rp-mouth .rp-img{',
    '  filter:var(--rp-glow,drop-shadow(0 10px 18px rgba(0,0,0,.55))) brightness(1.1)',
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
    /* 生气=紫红、哭/委屈=淡蓝：和 WORDS 里那三个池对应（少了这两个规则的话
       floatWord 传进来的 c-mad / c-cry 会落回继承色 —— 等于颜色白写了） */
    '.rp-bubble.rp-word.c-mad{color:#ff9ec0}',
    '.rp-bubble.rp-word.c-cry{color:#bcd9ff}',

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
    '.rp-float.c-mad{color:#ff9ec0} .rp-float.c-cry{color:#bcd9ff}',

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

    /* ============ 自定义名称：挂在兔兔头顶的小牌子 ============
       ⚠ 必须是 **.rp-pet 的子元素**、不能放进 .rp-inner / .rp-flip：
         那两层会跟着朝向镜像（`scaleX(-1)`），名字会反过来写。
       pointer-events:none 也是必须的：牌子探出兔兔的盒子之外，
       要是接住点击就等于在界面上凭空多了一块挡板。
       字号跟着兔兔宽度走（layout() 写 `--rp-name-fs`），80~320px 都有合适的大小。 */
    '.rp-name{position:absolute;left:50%;bottom:100%;transform:translate(-50%,-6px);',
    '  padding:2px 9px;border-radius:999px;font-size:var(--rp-name-fs,11px);line-height:1.5;',
    '  letter-spacing:.04em;color:#fff;white-space:nowrap;max-width:190px;overflow:hidden;',
    '  text-overflow:ellipsis;background:rgba(10,14,20,.62);border:1px solid rgba(255,255,255,.16);',
    '  box-shadow:0 3px 10px rgba(0,0,0,.45);text-shadow:0 1px 3px rgba(0,0,0,.7);',
    '  pointer-events:none;opacity:0;transition:opacity .22s ease;z-index:2}',
    '.rp-pet.rp-hasname .rp-name{opacity:1}',
    /* 有名字时，头顶那两样（台词气泡 / "胡萝卜 ×N"）整体上移，
       否则会压在名字牌上 —— 名字是常驻的，气泡和计数是临时的，让临时的让路。 */
    '.rp-pet.rp-hasname .rp-bubble{bottom:calc(100% + 22px)}',
    '.rp-pet.rp-hasname .rp-count{top:-40px}',
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
    '  margin-bottom:12px;text-transform:uppercase;',
    '  margin-left:-6px;margin-right:-6px;padding:2px 6px;border-radius:6px;',
    '  transition:background .16s ease}',
    /* **整块面板**都能拖：给 grab 光标；控件再把光标覆盖回自己的，
       这样"能拖的地方"和"能点的地方"一眼能分出来。
       标题栏另外留个悬停高亮 —— 它是视觉上的把手，给个可拖的暗示。 */
    '.rp-panel{cursor:grab;touch-action:none}',
    '.rp-panel input{cursor:auto}',
    '.rp-panel button,.rp-panel .rp-sw,.rp-panel .rp-group-hd{cursor:pointer}',
    '.rp-panel h4:hover{background:rgba(120,190,255,.10)}',
    /* 拖动中：所有地方都变抓握、标题栏高亮、整体提起来一点 */
    '.rp-panel.rp-paneling,.rp-panel.rp-paneling *{cursor:grabbing}',
    '.rp-panel.rp-paneling h4{background:rgba(120,190,255,.14)}',
    '.rp-panel.rp-paneling{box-shadow:0 18px 46px rgba(0,0,0,.62)}',
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
    /* 文本框（自定义名称）。跟滑块的深色风格对齐；:focus 时给一圈淡蓝，
       否则深色面板里看不出光标在哪个框里。 */
    '.rp-input{flex:1;min-width:0;padding:6px 9px;border-radius:7px;font-size:12px;',
    '  border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);',
    '  color:rgba(255,255,255,.92);font-family:inherit;outline:none;',
    '  transition:border-color .18s,background .18s}',
    '.rp-input::placeholder{color:rgba(255,255,255,.3)}',
    '.rp-input:focus{border-color:rgba(159,216,255,.65);background:rgba(255,255,255,.1)}',
    /* 行里的按钮不要跟着 .rp-btn 的 flex:1 撑满整行 */
    '.rp-row .rp-btn{flex:none;padding:6px 12px}',
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
  /* .rp-flip 只是"翻转用的包装层"，见 CSS 里那段说明：
     镜像挂在它身上才能走过渡动画（.rp-inner 的 transform 每帧都被呼吸/蹦跳重写）。 */
  var flipEl = el('div', 'rp-flip', pet);
  var inner = el('div', 'rp-inner', flipEl);
  el('div', 'rp-ear l', inner);
  el('div', 'rp-ear r', inner);
  var img = el('img', 'rp-img', inner);
  img.src = PET_IMG;
  img.alt = '';
  img.draggable = false;
  /* 腮红：吃完胡萝卜后在脸颊上泛一下。
     位置是按素材量出来的（放大素材打 10% 网格读的坐标）：
     眼睛中心约 (51%, 20%)、鼻子约 (44%, 30%)，
     所以腮红压在**眼睛正下方的脸颊肉**上，别糊到鼻子上。 */
  el('div', 'rp-blush', inner);
  /* 口水：拖胡萝卜的时候从**嘴角**（约 45%, 32%）往下挂一滴。
     用 SVG 画水滴形 + 一点高光，比 border-radius 拼出来的干净。 */
  var drool = el('div', 'rp-drool', inner);
  drool.innerHTML =
    '<svg viewBox="0 0 18 28" aria-hidden="true">' +
    '<defs><linearGradient id="rpDg" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#eafcff"/><stop offset="1" stop-color="#8ed2f0"/>' +
    '</linearGradient></defs>' +
    '<path d="M9 1 C9 9 17 12 17 18.5 A8 8 0 0 1 1 18.5 C1 12 9 9 9 1 Z" ' +
    'fill="url(#rpDg)" stroke="rgba(255,255,255,.7)" stroke-width="1.1"/>' +
    '<ellipse cx="6.1" cy="18.2" rx="2.1" ry="2.7" fill="rgba(255,255,255,.72)"/>' +
    '</svg>';
  /* 眼泪：**画出来的**（两串泪痕，各挂在一只眼睛的内角上往下淌）。
     用 SVG 画而不是贴图片：素材是张真实照片，贴图会连同背景一起贴上去；
     而且泪痕要能拉长/淡出/循环，画出来的才好控制。
     每串的形状是"上面窄、下面慢慢晕开的一条" —— 只用 circle 圆点会像贴了两颗珠子。 */
  var TEAR_SVG =
    '<svg viewBox="0 0 60 160" aria-hidden="true">' +
    '<defs><linearGradient id="rpTear" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#eafaff" stop-opacity="1"/>' +
    '<stop offset=".5" stop-color="#b6e6ff" stop-opacity=".92"/>' +
    '<stop offset=".78" stop-color="#8ccdf0" stop-opacity=".5"/>' +
    '<stop offset="1" stop-color="#7cc8f0" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    '<path d="M30 4 C36 26 40 32 40 44 C40 60 30 68 30 84 C30 100 39 112 36 128' +
    ' C34 142 28 150 30 158" fill="none" stroke="url(#rpTear)" stroke-width="8" ' +
    'stroke-linecap="round"/>' +
    '<ellipse cx="30" cy="17" rx="6.4" ry="8.4" fill="#eafaff" opacity=".96"/>' +
    '<circle cx="27.4" cy="14.6" r="2.3" fill="#fff"/>' +
    '</svg>';
  /* 眼泪只有**一条**（用户明确要求：一条、对准眼睛即可）。
     位置全在 CSS 的 .rp-tear 里（left:37% 的元素中心正好是眼睛的 50%）。 */
  var tearEl = el('div', 'rp-tear', inner);
  tearEl.innerHTML = TEAR_SVG;
  /* 撇嘴：生气/委屈时嘴角往下 */
  var mouthDown = el('div', 'rp-mouthdown', inner);
  mouthDown.innerHTML = '<span></span>';
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
  /* 自定义名称的牌子：挂在 pet 上（**不能放进 inner/flip**，否则镜像时字会反着写），
     由 applyName() 按 cfg.name 控制显示。 */
  var nameEl = el('div', 'rp-name', pet);
  var panel = el('div', 'rp-panel', layer);
  var earL = inner.querySelector('.rp-ear.l'), earR = inner.querySelector('.rp-ear.r');

  /* 把 cfg.name 写到头顶。空名字 = 收起牌子（同时把气泡/计数挪回头顶原位） */
  function applyName() {
    var n = String(cfg.name == null ? '' : cfg.name).trim();
    nameEl.textContent = n;
    pet.classList.toggle('rp-hasname', !!n);
  }

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
    anchorY: null,                    // 溜达的竖向锚点：用户最后一次把它放开的那一带（见 WANDER.bandY）
    eat: null,
    talking: false,
    bubbleTimer: 0,
    feedTimer: 0,
    lastTouch: 0,
    /* 生气：戳多了会恼。state 见下面的 ANGER 段。放在 S 里是为了让探针/控制台能直接读 */
    anger: { n: 0, state: 'calm', t: 0, sobAt: 0, sniffAt: 0, reset: false, home: null },
    t: Math.random() * 100          // 动画相位，避免开局整齐划一
  };

  var IMG_AR = 305 / 332;   // 原图高宽比

  function layout() {
    var w = cfg.size, h = cfg.size * IMG_AR;
    S.W = w; S.H = h;
    pet.style.width = w + 'px';
    pet.style.height = h + 'px';
    /* 撇嘴那条弧线的线宽跟着兔兔宽度走（默认 150px 时正好 3px，和旧值一致；
       缩到 80px 或放到 320px 时也不会变成"一根粗线"或"看不见"）。
       下限 1.4px：再细就渲染不出来了。 */
    pet.style.setProperty('--rp-mouth-bw', Math.max(1.4, w * 0.02).toFixed(2) + 'px');
    /* 头顶名字牌的字号也跟着宽度走（默认 150px → 11px；80px → 9px、320px → 20px 封顶） */
    pet.style.setProperty('--rp-name-fs',
      Math.max(9, Math.min(20, Math.round(w * 0.075))) + 'px');
    /* 默认位置要**预留把手的宽度**，否则兔兔贴在右下角时把手会被视口裁掉。
       （offerSpot 里还有一次"右边放不下就翻到左侧"的兜底。）
       x 和 y **分开判断** —— 早先 y 的默认值被绑在 `if (S.x == null)` 里，
       于是"只设了 x、没设 y"时（例如调试参数 ?x=180）y 还是 null，
       下一行 clamp(null, 4, …) 直接把它变成 4：兔兔跑到屏幕最顶端去了。 */
    if (S.x == null) S.x = window.innerWidth - w - OFFER_SIZE - 24;
    if (S.y == null) S.y = window.innerHeight - h - 20;
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

  /* ======================= 朝向：跑到左半边就镜像 =======================
     素材本身是**朝左**的（鼻子约在 44%、眼睛在 51%，鼻子在眼睛左边）。
     让它永远朝一个方向会很尬，所以放到屏幕左半边时整体水平镜像，总是面向屏幕中间。
     镜像挂在 **.rp-flip**（inner 的包装层）上、**不是** .rp-img：腮红 / 口水 / 胡萝卜
     都挂在 inner 里，一起镜像后它们相对脸的位置才对得上（只翻图片的话，脸镜像了、
     腮红却留在原地）；而"多一层包装"是为了让翻转能走 200ms 过渡（见 CSS 里那段说明）。

     ⚠ **判据只看"兔兔自己的中心"和屏幕中线**（用户明确要求）。
       早先留了 24px 迟滞防抖，但慢速溜达（约 26px/s）走完那 24px 要将近 1 秒 ——
       表现出来是"都走进左半边了还朝着左边、过一会儿才猛地翻过来"。
       现在一过中线就翻；翻转本身走 200ms 过渡，所以看着是"立刻开始转、0.2 秒转完"。
       防抖靠"只在它自己在走的时候判"：停着不动时没人调 updateFacing()。

     ⚠ **什么时候才允许转向**（用户明确要求）：
       拖着的时候**绝不转** —— 必须"抓取 → 放下"这两个动作都做完、落地站稳之后才转向。
       早先是每次 place() 都判一次，于是把兔兔往左/右拖、刚越过中线那一刻它就翻了，
       人还捏着它呢，看着像被谁掰了一下。
       所以现在：
         · place() 里**不再**判断朝向（它每帧都在跑）；
         · 只有三处会调 updateFacing()：
             1. 拖动松手 → 放进 playDrop 的 onDone（落地动画结束的那一刻）
             2. 自己溜达 / 跟着鼠标（那是它自己在走，不是被拖）
             3. 起手摆好位置、以及窗口 resize 之后
         · updateFacing() 自己再守一道 `if (S.drag) return` —— 规则写在函数里，
           以后谁多调一次也不会出现"拖着就翻"。 */
  var FLIP = 'scaleX(-1)';
  function setFlip() {
    flipEl.style.transform = S.faceLeft ? FLIP : 'none';
  }
  /* 所有对 inner 的 transform 写入都走它（呼吸 / 蹦跳 / 啃食，共 4 处）——
     翻转**不在这里**：镜像已经挪到外面的 .rp-flip 包装层了。 */
  function setInner(rest) {
    inner.style.transform = rest;
  }
  /* 一过中线就翻：判据是"兔兔自己的中心 vs 屏幕中线"，没有距离迟滞。 */
  function updateFacing() {
    if (S.drag) return;                 // 手还捏着它：不转（见上面的规则）
    var want = (S.x + S.W / 2) < window.innerWidth / 2;
    if (want !== !!S.faceLeft) {
      S.faceLeft = want;
      setFlip();                        // 立刻改目标值；动画由 CSS 的 200ms 过渡负责
    }
  }

  function place() {
    /* 躲避动画自己逐帧写 transform（见 slideTo），这期间谁都别去动它 */
    if (angSlide.busy) return;
    pet.style.transform = 'translate3d(' + S.x.toFixed(1) + 'px,' + S.y.toFixed(1) + 'px,0) scale(' + DEBUG.scale + ')';
    /* 这里**故意不调 updateFacing()**：place() 每帧都跑，拖动的每一像素都会经过它。
       转向的时机见上面那段说明（松手落地 / 自己在走 / 起手与 resize）。 */
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
    /* 一拖胡萝卜兔兔就馋了：嘴角挂一滴口水，直到松手 */
    pet.classList.add('rp-drool-on');
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
    pet.classList.remove('rp-drool-on');    // 不馋了
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
    /* 生气那几秒不蹦：蹦跳是"高兴"的动作，和眼泪+发抖放一起就矛盾了。
       （而且抖动的 CSS 动画正压着内层变换，这里再写会和它打架。） */
    if (S.anger && (S.anger.state === 'angry' || S.anger.state === 'hide')) return;
    inner.style.transition = 'transform .34s cubic-bezier(.34,1.3,.5,1)';
    setInner('translateY(-18px) scale(1.04,.96)');
    setTimeout(function () {
      inner.style.transition = 'transform .3s cubic-bezier(.5,0,.6,1)';
      setInner('translateY(0) scale(.98,1.03)');
      setTimeout(function () { setInner('translateY(0) scale(1,1)'); }, 200);
    }, 170);
  }
  function chomp() {
    img.style.transition = 'transform .12s ease';
    img.style.transform = 'translate(1px,3px) scale(1.02,.97)';
    setTimeout(function () { img.style.transform = 'none'; }, 110);
  }

  /* ======================= 生气：戳多了会恼 =======================
     单击摸头本来是这只兔子最温柔的一面，但**一直戳**总得有个后果。
     规则（全是一次点击算一下，双击自然算两下）：

       戳满 ANGER_N(30) 下  →  生气 1 秒（眼泪 + 飞机耳 + 撇嘴 + 抖，呜一声）
                             →  躲到屏幕最近的左边/右边抽泣 3.2 秒（哭音，点不到它）
                             →  委屈 3 秒（自己挪回来，小声说话，喂一根胡萝卜就哄好）
                             →  消气

     几个刻意的地方：
      · 计数**只在戳的时候 +1**，而且会**慢慢回落**（ANGER_COOL 毫秒没被戳就 -1）：
        所以"最多 30 下"约束的是**连击**，不是这只兔子一辈子的挨戳总数 ——
        否则随便用几天就会莫名其妙生气一次。
      · 喂胡萝卜、点面板、按按钮都**不算**戳它；只有"抓起它放下"算
        （连着把兔兔拎来拎去确实烦人）。
      · 生气之后**不扣好感**：这是表演，不是惩罚。喂一根反而立刻哄好 +2 好感，
        把"我把它惹毛了"变成一个可以动手修好的状态，而不是白挨一顿。
      · 躲边用的是**安全区夹取**（至少留 15% 在视口里），
        所以窗口很窄或者兔兔本来就在屏幕边上时也不会整只消失。
      · 位置只是躲一下：哭完**回到原来的地方**，不改变用户摆好的位置。
     ================================================================ */
  var ANGER_N = 30;            // 连戳多少下生气
  var ANGER_COOL = 1600;       // 多久没戳就回落一点（连击的判定窗口）
  var ANG_ANGRY = 1000;        // 生气（流泪）持续
  var ANG_HIDE = 3200;         // 躲在屏幕边抽泣
  var ANG_SAD = 3000;          // 委屈（自己挪回来）
  var ANG_SLIDE = 460;         // 挪到屏幕边 / 挪回来的时长
  /* 躲边时**留多少在视口里**：0.72 倍兔宽。
     这个数是照着素材一点点试出来的：这只兔子是"侧躺成一团"的，脑袋在整张图的**中偏右**
     （那只可见的眼睛在 46% 处）。所以
       · 留 0.5 倍（75px）→ 眼睛离屏幕边只剩 6px，会被裁掉、眼泪就成了无源之水；
       · 留 0.62 倍（93px）→ 眼睛保住了，但脸的右半边和耳朵还在屏幕外，看着像被切了一刀；
       · 留 0.72 倍（108px）→ 整张脸（含耳朵）都在视口里，身子和外套探出屏幕外 42px。
     想更"藏"一点就把这个数调小（代价是脸会被切），想更露出脸就调大。
     下限 22px 是给很小的窗口兜底（兔兔最小 80px 宽时 0.72 倍只有 58px，够用）。 */
  var HIDE_KEEP = 0.72;
  var HIDE_MIN_PX = 22;

  /* 计时按 DEBUG.angerMs 压缩（自检用；真实运行是 1） */
  function angD(ms) { return Math.max(16, Math.round(ms * DEBUG.angerMs)); }

  /* 正在生气/躲着哭：这时候别溜达、别跟着鼠标、拖了也不让走 */
  function angBusy() {
    var a = S.anger;
    return a.state === 'angry' || a.state === 'hide';
  }
  function angDrip(now) {
    var a = S.anger;
    if (a.state !== 'calm' || a.n <= 0) return;
    if (now - a.t >= ANGER_COOL) { a.t = now; a.n--; }
  }
  /* 被戳一下。到量就生气。 */
  function poke() {
    var a = S.anger, now = performance.now();
    if (a.state !== 'calm') return;
    angDrip(now);
    a.t = now;
    a.n++;
    if (a.n >= ANGER_N) enterAnger();
  }
  function clearAngerTimers() {
    var a = S.anger;
    clearTimeout(a.t1); clearTimeout(a.t2); clearTimeout(a.hideT);
    clearTimeout(a.thinkT); clearTimeout(a.loopT); clearTimeout(a.slideT);
  }
  /* 把嘴角撇下去：耳朵压平。两处都用 class 控制，摘掉就恢复。 */
  function madFace(on) {
    [earL, earR].forEach(function (e) { e.classList.toggle('rp-down', !!on); });
  }
  function enterAnger() {
    var a = S.anger;
    clearAngerTimers();
    a.state = 'angry';
    a.n = ANGER_N;
    if (!S.eat) { Sfx.resume(); Sfx.yip(); }
    /* 眼泪是过渡 + 循环动画出来的，加 class 之后就自己淌了。
       ⚠ 加完 class 必须**强制一次重排**：这个元素是页面刚加载、上一帧还是 opacity:0
         的情况下被加上类的，浏览器很可能把"0 → 1"当成初始样式而不起过渡 ——
         结果眼泪死活不出来（无头自检里就抓到了这个：class 有、opacity 还是 0）。 */
    pet.classList.remove('rp-angry', 'rp-hide');
    void pet.offsetWidth;
    pet.classList.add('rp-angry');
    madFace(true);
    if (!S.eat) floatWord(pick(WORDS.angry), 'c-mad');
    count.classList.remove('on');           // 生气的时候别在它头上顶着 CARROT ×N
    a.t1 = setTimeout(goHide, angD(ANG_ANGRY));
  }
  /* 躲到**屏幕最近的左边/右边**：
     直接把 x 摆到屏幕外一部分，被视口裁掉大半 —— 剩下的耳朵尖、一只眼睛和眼泪就是"躲在边上"。
     没有用 clip-path：那条路在窄窗口里会把兔兔裁成一细条甚至什么都没有；
     摆到屏幕外的写法由**布局**负责裁切，各窗口下表现一致。
     位置是**夹取**过的（至少留 15% / 26px 可见），所以它不会整只消失。 */
  function goHide() {
    var a = S.anger;
    if (a.state !== 'angry') return;
    a.state = 'hide';
    a.home = { x: S.x, y: S.y };
    /* sobAt / sniffAt 归零 —— cryLoop 下一拍就会响第一声。
       光靠 enterAnger 里那声"呜"是不够的：用户说的重点是"躲起来之后在哭"，
       所以第一声抽泣必须紧跟着躲进去那一刻。 */
    a.sobAt = 0; a.sniffAt = 0;
    if (!a.reset) Sfx.sob(true);
    var w = S.W;
    var keep = Math.max(HIDE_MIN_PX, Math.round(w * HIDE_KEEP));
    var px = S.x + w / 2;
    var left = px <= window.innerWidth / 2;
    var target = left ? Math.round(keep - w) : Math.round(window.innerWidth - keep);
    pet.classList.remove('rp-angry');
    pet.classList.add('rp-hide');
    /* 同样强制重排：让"眼睛上那两串眼泪"的淡出/淡到 62% 真的走过渡 */
    void pet.offsetWidth;
    slideTo(target, ANG_SLIDE);
    a.hideT = setTimeout(comeBack, angD(ANG_HIDE));
  }
  /* 哭：抽泣 + 吸鼻子交替，间隔随机 —— 等间隔听起来像节拍器，不像在哭。
     这个循环从起手就一直挂着，不在哭的时候只是每 140ms 醒一下看看状态，
     但**必须记得重排下一次**：忘了就会变成"只在生气那一刻响一声、后面全哑"。 */
  function cryLoop() {
    var a = S.anger;
    if (a.state === 'hide' || a.state === 'sad') {
      var now = performance.now();
      if (now >= a.sobAt) {
        if (!a.reset) Sfx.sob(false);
        a.sobAt = now + rnd(420, 820) * DEBUG.angerMs;
      } else if (now >= a.sniffAt) {
        if (!a.reset) Sfx.sniff();
        a.sniffAt = now + rnd(900, 1700) * DEBUG.angerMs;
      }
    }
    a.loopT = setTimeout(cryLoop, 140);
  }
  /* 自己挪回原处（走 slideTo 而不是瞬移，否则看起来是被弹回去的） */
  function comeBack() {
    var a = S.anger;
    if (a.state !== 'hide') return;
    a.state = 'sad';
    pet.classList.remove('rp-hide');
    if (a.home) slideTo(a.home.x, ANG_SLIDE);
    a.t2 = setTimeout(calmDown, angD(ANG_SAD));
  }
  function calmDown() {
    var a = S.anger;
    clearAngerTimers();
    a.state = 'calm';
    a.n = 0;
    a.t = performance.now();
    pet.classList.remove('rp-angry', 'rp-hide');
    madFace(false);
    if (!a.reset) floatWord(pick(WORDS.sad), 'c-cry');
  }
  /* 哄好：喂一根胡萝卜立刻消气（还多给一点好感） */
  function comfort() {
    var a = S.anger;
    if (a.state === 'calm') return false;
    clearAngerTimers();
    a.state = 'calm';
    a.n = 0;
    a.t = performance.now();
    pet.classList.remove('rp-angry', 'rp-hide');
    madFace(false);
    if (a.home) { S.x = a.home.x; S.y = a.home.y; place(); }
    addAffection(2);
    floatWord('（不哭了）', 'c-mood');
    return true;
  }
  /* 挪到某个 x。
     ⚠ 用"固定帧数"推进，而不是像 playDrop 那样用 performance.now() 算进度。
       原因是在无头浏览器里 **虚拟时间会把 setTimeout 快进，而 performance.now() 走的是真实时间**：
       用真实时间算的话，几十个 setTimeout 会在几毫秒的真实时间里全部跑完，
       进度 k 一直贴着 0 —— 表现就是"挪了半天还在原地"（自检里真的抓到了这个）。
       按帧走则无论时钟怎么跳，20 多帧之后一定到位。
       顺带一个好处：主循环每帧调 place()，两边一起写 pet.style.transform 的话滑动会被
       一帧一帧拽回目标点、看起来就是瞬移，所以 angSlide.busy 期间 place() 直接让路。 */
  var angSlide = { busy: false };
  function slideTo(target, ms) {
    var a = S.anger;
    var from = S.x;
    if (!isFinite(from) || !isFinite(target) || Math.abs(target - from) < 1) {
      S.x = target; place(); return;
    }
    var STEPS = Math.max(6, Math.round(ms / 20));       // 约每 20ms 一帧
    var i = 0;
    angSlide.busy = true;
    pet.style.transition = 'none';       // 由我们逐帧写，不要 CSS 过渡来插一脚
    var step = function () {
      i++;
      var k = Math.min(1, i / STEPS);
      var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // easeInOutQuad
      S.x = from + (target - from) * e;
      pet.style.transform = 'translate3d(' + S.x.toFixed(1) + 'px,' + S.y.toFixed(1) + 'px,0) scale(' +
        DEBUG.scale + ')';
      if (k < 1) { a.slideT = setTimeout(step, 16); }
      else {
        S.x = target;
        angSlide.busy = false;
        pet.style.transition = '';
        place();
        positionOffer();
      }
    };
    step();
  }

  /* 对外报一次生气状态（探针和控制台都读这一份，不各自去猜 class） */
  function angerInfo() {
    var a = S.anger;
    return {
      state: a.state,                                   // calm / angry / hide / sad
      n: a.n,
      need: ANGER_N,
      tears: pet.classList.contains('rp-angry') || pet.classList.contains('rp-hide'),
      earsDown: earL.classList.contains('rp-down') && earR.classList.contains('rp-down'),
      clicked: getComputedStyle(pet).pointerEvents === 'none',   // 躲着的时候点不到它
      x: S.x, y: S.y, w: S.W,
      /* 视口测量换算用：?scale= 会把 rect 放大，探针拿 rect 和 S.W 比之前要先除掉它 */
      rectScale: DEBUG.scale,
      /* 躲起来之前的位置：哭完会挪回这里（探针要拿它比对"真的回来了"） */
      home: a.home ? { x: a.home.x, y: a.home.y } : null
    };
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
     才开始有存在感，前面留给"升级很快"的爽感。
     ⚠ 写的是**自定义属性** `--rp-glow`，不是 `img.style.filter`：
       内联 filter 会压掉 CSS 里所有按 class 叠加的滤镜（变暗/脸红/亮一下），
       而且压得无声无息 —— 详见 .rp-img 那段注释。 */
  function applyTierLook() {
    var t = tierOf(levelOf(cfg.xp || 0));
    var tight = Math.round(6 + t.glowA * 6);      // 紧：贴着轮廓的一圈颜色
    var loose = Math.round(12 + t.glowA * 22);    // 松：向外散开的光晕
    var a1 = Math.min(1, t.glowA * 0.95).toFixed(2);
    var a2 = (t.glowA * 0.7).toFixed(2);
    img.style.setProperty('--rp-glow',
      'drop-shadow(0 10px 18px rgba(0,0,0,.55))' +
      ' drop-shadow(0 0 ' + tight + 'px rgba(' + t.glow + ',' + a1 + '))' +
      ' drop-shadow(0 0 ' + loose + 'px rgba(' + t.glow + ',' + a2 + '))');
  }

  /* ======================= 喂胡萝卜 ======================= */
  function feed(bites) {
    if (S.eat) return false;
    /* 喂一根就哄好了：生气/躲着哭的时候先消气（还多给一点好感），再照常啃。
       所以"把它惹毛了"不是等它自己消气，而是可以动手修好的。 */
    var cheered = comfort();
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
      /* 腮红：吃完在脸颊上泛一下，2.6 秒后淡出。
         和 happy() 同时起 —— 声音和脸红是同一件事的两面。
         用 clearTimeout 兜一下，连续喂两根时不会被前一个定时器提前收掉。 */
      pet.classList.add('rp-blush-on');
      clearTimeout(S.blushTimer);
      S.blushTimer = setTimeout(function () { pet.classList.remove('rp-blush-on'); }, 2600);
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
  function touch(px, noPoke) {
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
    /* 摸够了会恼。默认在这里记一笔"被戳"，但 **拖动那条路要传 noPoke** ——
       它已经在 pointerdown 里记过了，两边都记的话点一下会算成两下（实测过：
       单击一次计数 +2，于是 30 下的耐心实际只要 15 下就没了）。 */
    if (!noPoke) poke();
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
    /* 刚被戳到炸毛的那一下，双击就不再是"聊聊天"，而是接着哼一声 ——
       不然刚说完"再戳我要生气了"下一句又笑眯眯地聊胡萝卜，情绪就断了。 */
    if (S.anger && S.anger.state === 'angry') {
      floatWord(pick(WORDS.sad), 'c-cry');
      setTimeout(function () { S.talking = false; }, 900);
      return;
    }
    setTimeout(function () { S.talking = false; }, 3200);
  }

  /* ======================= 拖动 ======================= */
  pet.addEventListener('pointerdown', function (ev) {
    if (ev.target === gear || panel.contains(ev.target)) return;
    Sfx.resume();
    /* 这一下算"戳了它一次"（生气计数用）。
       刻意只挂 pointerdown、不挂 click：双击是两个 pointerdown（正好算两下），
       而 click 只在浏览器判定为点击时才发。另外拖拽的起点也算戳 ——
       连着把兔兔拎来拎去确实烦人。 */
    poke();
    /* 生气/躲着哭的时候不让拖走：它正躲在边上演戏呢，被拎出来就全废了 */
    if (angBusy()) return;
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
    if (!S.drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      S.drag.moved = true;
      Sfx.grab();                    // 只有真的开始拖才响，单击摸头不响这个
    }
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
      /* 手动放下之后**先歇一会儿**再自己溜达：不清掉目标点的话，
         它会立刻朝"用户拖动前那个落脚点"走掉 —— 等于你刚摆好的位置被它自己挪走了。
         （S.targetX 是旧的横线溜达留下的字段，一起清掉免得混淆。） */
      S.targetX = null;
      S.spot = null;
      S.restUntil = performance.now() + rnd(2600, 9000);
      /* 锚点跟着走：以后自己溜达只在"用户刚把它放下的这一带"里游走（不许爬远） */
      S.anchorY = S.y;
      /* 松手落地：拖动时它是"被提着"的，放手就该有一记落地的分量，
         否则只是硬停在那里，动作没有收尾。
         落差给小（26px）、时长给短 —— 摸起来是轻快的一"啪"；
         关掉淡入/落地（landMs=0 且 fadeIn=0）时也照做，因为它是一次交互反馈，
         和"出场方式"是两回事。 */
      Sfx.put();                     // 放下音，和落地动画同时（"落"和"响"是一件事）
      /* 转向放在**落地动画结束**的那一刻（onDone）：
         "抓取 → 放下"两个动作都做完、站稳了才转身，而不是拖到半路就翻（见朝向那段说明）。 */
      playDrop(240, 26, updateFacing);
    }
    else if (wasTap) {
      // 没拖动 = 点它一下（这一下已经由 pointerdown 记过"被戳"，所以传 noPoke）
      var r = pet.getBoundingClientRect();
      touch(ev ? ev.clientX : r.left + r.width / 2, true);
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
        /* 自定义名称放第一行：它是"这只兔兔是谁"的标识，比大小/透明度更靠前。
           ⚠ 文本框内容要转义后再拼进 HTML —— 名字是用户自由输入的，
             含 `"` 或 `<` 时会把属性/标签掀了。 */
        '<div class="rp-row"><label>名称</label>' +
        '<input type="text" id="rp-name" class="rp-input" maxlength="12" ' +
        'placeholder="给它起个名字" value="' + escAttr(cfg.name) + '">' +
        '<button class="rp-btn" id="rp-act-name">保存</button></div>' +
        '<div class="rp-hint-row">起个名字会显示在兔兔头顶（最多 12 字）；留空 = 不显示</div>' +
        rowRange('size', '大小', '兔兔显示成多大（80~320px）', 80, 320, 2, cfg.size, '') +
        rowRange('op', '透明度', '嫌它抢眼就调低，25% 时几乎只剩个影子', 25, 100, 5,
          Math.round(cfg.opacity * 100), '%') +
        rowRange('vol', '音量', '只是音效的音量，跟系统音量无关', 0, 100, 5,
          Math.round(cfg.volume * 100), '%')) +
      group('behav', '行为', true,
        rowSwitch('sound', '音效', '关掉后摸它、啃胡萝卜都不出声，也不会占用音频通道') +
        rowSwitch('wander', '自己溜达', '隔一会儿自己在附近随机挪一段（斜着走，不是一条直线）；和"跟着鼠标"只能开一个') +
        rowSwitch('follow', '跟着鼠标', '在光标附近随机走动并停下歇会儿，不会贴着光标挡你看字') +
        rowSwitch('talk', '点击说话', '双击冒一句台词气泡；关掉后双击就没反应了') +
        rowSwitch('feed', '自动吃胡萝卜', '隔 9~22 秒自己掏一根啃，会扣今日胡萝卜')) +
      '<div class="rp-acts">' +
      '<button class="rp-btn" id="rp-act-feed">喂一根</button>' +
      '<button class="rp-btn" id="rp-act-reset">回到右下角</button>' +
      '</div>' +
      /* 清空数据：**保留**，它是"想重新开始 / 数据出问题"时的逃生舱口 ——
         去掉的话普通用户就只能去开控制台敲命令了。
         但不再单独占一个折叠分组：原来那段解释"为什么不显示本次会话计数"的说明
         是写给开发者的，对用户零价值，已删掉；按钮直接放面板最底部。 */
      '<div class="rp-acts">' +
      '<button class="rp-btn" id="rp-act-wipe">清空数据</button>' +
      '</div>' +
      '</div>';                                   // .rp-panel-scroll

    /* 属性值转义：名字是用户自由输入的，含 `"` / `<` 时直接拼进 HTML 会
       把 value 属性截断甚至插出一个标签。（面板其它地方拼的都是数字/固定文案，
       只有这一处需要它。） */
    function escAttr(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

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
    bindSwitch('follow', 'follow', function () { S.spot = null; S.restUntil = 0; S.mouse = null; S.anchorY = S.y; });
    bindSwitch('wander', 'wander', function () { S.spot = null; S.restUntil = 0; S.anchorY = S.y; });
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

    /* 自定义名称：输入框 + 「保存」（回车也算保存）。
       保存时做三件事：去掉换行/首尾空格、截到 12 字（和 maxlength 一致，
       中文按字符算）、写回输入框（让用户看见实际存下来的样子）。
       留空 = 收起头顶的牌子。 */
    var nameInput = panel.querySelector('#rp-name');
    function commitName() {
      var v = String(nameInput.value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 12);
      nameInput.value = v;
      var changed = v !== String(cfg.name || '');
      cfg.name = v;
      applyName();
      save();
      if (changed) Sfx.pop();          // "存下来了"的一点反馈（音效关掉时不响）
    }
    panel.querySelector('#rp-act-name').addEventListener('click', commitName);
    nameInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); commitName(); }
    });

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
      S.anchorY = S.y;                 // 换了地方 → 溜达的活动带也跟着挪过去
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
    /* 名称输入框：外部改过名字（比如控制台 setName）之后面板要跟上，
       但**别覆盖正在输入的内容** —— 只有失焦时才回写。 */
    var nEl = panel.querySelector('#rp-name');
    if (nEl && nEl !== document.activeElement &&
      nEl.value !== String(cfg.name == null ? '' : cfg.name)) {
      nEl.value = String(cfg.name == null ? '' : cfg.name);
    }
  }

  /* 把面板摆到兔兔旁边，并**夹回可视区内**（兔兔常待在右下角；面板是 position:fixed，
     所以用视口坐标）。展开/收起分组之后面板会变高，也必须重新摆一次 ——
     否则位置还是按旧高度算的，展开后下半截会跑到屏幕外（踩过）。 */
  /* 面板至少露出这么多（拖动时用），否则会被拖到屏幕外找不回来。
     横向留 88px 够看到标题、纵向留 42px 就是标题栏那一行。 */
  var PANEL_KEEP_X = 88;
  var PANEL_KEEP_Y = 42;

  function placePanel() {
    var pw = panel.offsetWidth || 296;
    var ph = panel.offsetHeight || 330;
    var vw = window.innerWidth, vh = window.innerHeight;
    /* 用户拖过 → 尊重他放的位置，只夹回"还看得见"的范围。
       这里刻意**不**再自动摆到兔兔旁边：那会把用户手动放的位置覆盖掉，
       拖了等于白拖（面板打开/切分组/resize 都会走这个函数）。
       想回到自动跟位：双击标题栏。 */
    if (typeof cfg.panelX === 'number' && typeof cfg.panelY === 'number') {
      panel.style.left = clamp(cfg.panelX, PANEL_KEEP_X - pw, vw - PANEL_KEEP_X) + 'px';
      panel.style.top = clamp(cfg.panelY, 0, Math.max(0, vh - PANEL_KEEP_Y)) + 'px';
      panel.style.transformOrigin = '50% 50%';
      return;
    }
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
  /* ======================= 拖动设置面板 =======================
     **面板上任意位置都能拖**（不只有标题栏）—— 面板挺长的，鼠标在下面时要移回顶部才能拖，
     很别扭。拖完把坐标记进 cfg.panelX/panelY（进 localStorage），下次打开还在那儿。
     想让它回到"自动跟在兔兔旁边"：**在面板上双击**（控件上双击不算）。 */
  var panelDrag = null;
  /* 这些地方按下/双击要留给控件自己，不算拖动把手：
       · input          —— 滑块
       · button         —— 按钮
       · .rp-sw         —— 开关。注意它是 <div> 不是 <button>！漏了它开关就点不动了。
       · .rp-group-hd   —— 折叠组标题，点击要展开/收起
       · 滚动条         —— 在那儿按下是要滚内容，不能被当成拖面板
     其余地方（状态区、说明文字、分组内的空白）都算把手。 */
  function onPanelControl(ev) {
    var t = ev.target;
    if (!t || t.nodeType !== 1) return true;
    if (t.closest && t.closest('input,button,.rp-sw,.rp-group-hd')) return true;
    var sc = t.closest && t.closest('.rp-panel-scroll');
    /* 点在滚动条上：target 就是滚动容器本身，且 offsetX 超过了内容宽度 */
    if (sc && t === sc && ev.offsetX > sc.clientWidth) return true;
    return false;
  }
  function panelDragStart(ev) {
    if (ev.button !== 0) return;                       // 只接左键
    var r = panel.getBoundingClientRect();
    panelDrag = { id: ev.pointerId, dx: ev.clientX - r.left, dy: ev.clientY - r.top };
    panel.classList.add('rp-paneling');
    /* 和兔兔/把手一样：捕获失败不该影响拖动本身 */
    try { if (panel.setPointerCapture) panel.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
    ev.preventDefault();
  }
  function panelDragMove(ev) {
    if (!panelDrag || ev.pointerId !== panelDrag.id) return;
    var pw = panel.offsetWidth;
    var vw = window.innerWidth, vh = window.innerHeight;
    panel.style.left = clamp(ev.clientX - panelDrag.dx, PANEL_KEEP_X - pw, vw - PANEL_KEEP_X) + 'px';
    panel.style.top = clamp(ev.clientY - panelDrag.dy, 0, Math.max(0, vh - PANEL_KEEP_Y)) + 'px';
  }
  function panelDragEnd(ev) {
    if (!panelDrag || (ev && ev.pointerId !== panelDrag.id)) return;
    panelDrag = null;
    panel.classList.remove('rp-paneling');
    /* 存实际渲染出来的位置（不读 style.left：它可能是空串或被夹过之前的值） */
    var r = panel.getBoundingClientRect();
    cfg.panelX = Math.round(r.left);
    cfg.panelY = Math.round(r.top);
    save();
  }
  panel.addEventListener('pointerdown', function (ev) {
    /* 面板内部的点击不该冒泡出去（否则会被 onDocDown 当成"点了外面"而关掉面板） */
    ev.stopPropagation();
    if (!onPanelControl(ev)) panelDragStart(ev);
  });
  panel.addEventListener('pointermove', panelDragMove);
  panel.addEventListener('pointerup', panelDragEnd);
  panel.addEventListener('pointercancel', panelDragEnd);
  panel.addEventListener('dblclick', function (ev) {
    if (onPanelControl(ev)) return;                     // 在控件上双击不算（比如开关会被点两下）
    ev.preventDefault();
    ev.stopPropagation();
    cfg.panelX = null; cfg.panelY = null;
    save();
    placePanel();                                       // 立刻跳回兔兔旁边
    floatWord('跟回兔兔了', 'c-mood');
  });
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
    updateFacing();     // 跟着鼠标走也算"它自己在走"，不是被拖（见朝向那段说明）
  }

  /* ======================= 自己溜达：在附近随机挑落脚点 =======================
     要求（用户提的）：别老是横着一条直线走，路径要随机。

     ⚠ 这里有个**不能想当然**的地方：不能"在整个屏幕上随机取一个点走过去"。
       溜达速度只有 26px/s（等级越高越慢，见 TIERS.speed），
       从屏幕右边走到左边要 40 秒 —— 表现出来不是"随机路径"，
       而是"沿着一条水平线慢慢挪"，而且因为 y 也只在一条线上，看着更单调。
       所以改成：
         1) 落脚点取在**当前位置附近**（[distMin, distMax] 的距离、方向均匀随机）
            → 每次走的是一小段斜线，连起来才是随机路径；
         2) 候选点要**筛掉被视口夹扁的**：兔兔默认贴在右下角，
            直接 clamp 的话"向下的目标"会退化成原地不动，路径又变回水平线；
         3) 到了就**明确休息** [restMin, restMax]，再决定下一段走不走
            （早先只有一句 0.004/帧 的概率，起步时机完全随机、也没个"歇够了"的交代）。 */
  var WANDER = {
    distMin: 90,         // 一段至少走这么远（太短看着像原地抖）
    distMax: 300,        // 一段最多这么远（再远就成了"长途跋涉"，不像溜达）
    /* 竖向活动带：以**锚点 y**（用户最后一次把它放开的那一带）为中心，上下各这么多 px。
       二维随机游走是不收敛的 —— 不加这条带，它溜达久了会一路爬上去（实测 45 秒爬了 395px），
       最后停在屏幕顶上不下来。加带之后它只在"你放它的那一带"里游走。
       用户要求就是"不许爬上去，在里面游走就行"。 */
    bandY: 110,
    speed: 26,           // 基准速度 px/s（再乘等级档位的 speed 系数）
    restMin: 2600,       // 到了之后歇多久(ms)
    restMax: 9000,
    rollChance: 0.008,   // 歇够之后，每帧决定"要不要起身走一段"
    tries: 12            // 落脚点候选个数（挑没被夹扁的那个）
  };

  function pickWanderSpot() {
    var maxX = Math.max(4, window.innerWidth - S.W - 4);
    var maxY = Math.max(4, window.innerHeight - S.H - 4);
    /* 活动带先按锚点算，再夹进视口；窗口太矮导致带子反向时收敛成一个点 */
    var anchor = (typeof S.anchorY === 'number') ? S.anchorY : S.y;
    var bandTop = Math.max(4, anchor - WANDER.bandY);
    var bandBot = Math.min(maxY, anchor + WANDER.bandY);
    if (bandBot < bandTop) bandTop = bandBot = Math.max(4, Math.min(anchor, maxY));
    var good = [];
    for (var i = 0; i < WANDER.tries; i++) {
      var a = Math.random() * TAU;
      var d = rnd(WANDER.distMin, WANDER.distMax);
      var tx = clamp(S.x + Math.cos(a) * d, 4, maxX);
      var ty = clamp(S.y + Math.sin(a) * d, bandTop, bandBot);
      /* 用曼哈顿距离衡量"实际能挪多远"：被视口/活动带夹扁的候选会明显偏小，
         直接丢掉（不是挑最远的那个 —— 那会让距离永远贴着上限）。
         兔兔默认贴在右下角，不筛的话"向下"的目标一夹就成了原地不动，
         路径又退化成一条水平线。 */
      var dd = Math.abs(tx - S.x) + Math.abs(ty - S.y);
      if (dd < WANDER.distMin) continue;
      good.push({ x: tx, y: ty });
    }
    return good.length ? good[(Math.random() * good.length) | 0] : null;
  }

  function wanderTick(dt) {
    if (S.drag) return;
    /* 生气/躲着哭的时候不许自己乱走：正委屈呢，还在屏幕上溜达就不像话了 */
    if (angBusy()) return;
    /* 两个模式互斥（开关是双向互斥的，这里再守一道：
       只要 follow 开着就绝不走溜达分支，免得配置被手改后出现"两个都在动"）。 */
    if (cfg.follow) { followTick(dt); return; }
    if (!cfg.wander) return;
    var now = performance.now();
    if (!S.spot) {
      if (now < (S.restUntil || 0)) return;            // 还在歇
      if (Math.random() > WANDER.rollChance) return;   // 歇够了也不一定马上起身
      S.spot = pickWanderSpot();
      if (!S.spot) return;
    }
    var dx = S.spot.x - S.x, dy = S.spot.y - S.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 4) {                                    // 到了：歇一会儿再挑下一段
      S.spot = null;
      S.restUntil = now + rnd(WANDER.restMin, WANDER.restMax);
      save();
      return;
    }
    /* 等级越高走得越稳（跨度小、不慌），见 TIERS.speed */
    var speed = WANDER.speed * tierOf(levelOf(cfg.xp || 0)).speed;
    var step = Math.min(dist, speed * dt);
    S.x = clamp(S.x + (dx / dist) * step, 4, Math.max(4, window.innerWidth - S.W - 4));
    S.y = clamp(S.y + (dy / dist) * step, 4, Math.max(4, window.innerHeight - S.H - 4));
    place();
    /* 自己溜达时照旧实时判朝向：它不是被谁捏着拖，"抓取-放下"那条规则不适用于它
       （而且不管的话，它走到左半边会背对着屏幕中间）。 */
    updateFacing();
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
    if (S.grounded !== false && !inner.dataset.busy) setInner(baseT);

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
    /* 溜达的活动带锚点也要跟着窗口夹一下，否则窗口变小后它会被"带子"推到屏幕外 */
    if (typeof S.anchorY === 'number') {
      S.anchorY = clamp(S.anchorY, 4, Math.max(4, window.innerHeight - S.H - 4));
    }
    place();
    /* 兔兔没动、是窗口变了：这种情况该跟着重判朝向（不然窗口缩一半后它会背对中间） */
    updateFacing();
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
  if (DEBUG.x != null && isFinite(DEBUG.x)) S.x = DEBUG.x;    // 截图用（见 DEBUG.x 的说明）
  layout();
  place();
  applyName();            // 按存档里的名字决定头顶牌子显不显示
  /* 起手也要判一次朝向：place() 已经不判了（见朝向那段说明），
     这里按恢复出来的位置定下"这只兔兔现在朝哪边"。 */
  updateFacing();
  /* 溜达的竖向锚点 = 起手位置：它只在"上次被放下的那一带"里游走（见 WANDER.bandY） */
  S.anchorY = S.y;
  positionOffer();        // 把"拖拽喂食"的胡萝卜把手摆到兔兔旁边（起手时也要定位一次）
  applyTierLook();        // 按已有等级把外观摆对（辉光）
  /* ?pose=hide —— 截图专用：**跳过挪过去的过程**，直接把兔兔摆到"躲在屏幕边抽泣"的落点。
     和 ?mad=2 的区别：mad=2 走的是真流程（先生气、再挪），配合 ?freeze=1 会把
     "正在挪"的中间帧冻住、看起来像被压扁了；pose 只摆位置和表情，不碰状态机。
     放在"起手"这一段是有原因的：它要用 HIDE_MIN_PX 等常量，而那些常量声明在
     ANGER 段里（文件中部）—— 写在 DEBUG 那一段会撞上**暂时性死区**，
     报出来的还是"Script error."这种看不出所以然的错（踩过一次）。 */
  if (DEBUG.pose === 'hide') {
    pet.classList.add('rp-angry', 'rp-hide');
    madFace(true);
    S.x = (S.x + S.W / 2) <= window.innerWidth / 2
      ? Math.round(Math.max(HIDE_MIN_PX, S.W * HIDE_KEEP) - S.W)
      : Math.round(window.innerWidth - Math.max(HIDE_MIN_PX, S.W * HIDE_KEEP));
    place();
    positionOffer();
  }
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
  /* 截图用：headless 里没法真的"拖胡萝卜"或"等它吃完"，直接把两个状态摆出来 */
  if (DEBUG.blush) pet.classList.add('rp-blush-on');
  if (DEBUG.drool) pet.classList.add('rp-drool-on');
  if (DEBUG.state === 'levelup') { setTimeout(function () { feed(); }, 80); }
  else if (DEBUG.state === 'eat') { feed(5); }
  else if (DEBUG.state === 'eat1') { feed(5); biteOnce(); }
  else if (DEBUG.state === 'eat2') { feed(5); biteOnce(); biteOnce(); }
  else if (DEBUG.state === 'talk') { setTimeout(talk, 60); }
  else if (DEBUG.state === 'touch') { setTimeout(function () { touch(S.x + S.W / 2); }, 60); }
  else if (DEBUG.state === 'panel') { togglePanel(true); }
  if (DEBUG.freeze) { /* 不启动循环，画面静止，便于截图 */ }
  else requestAnimationFrame(loop);
  /* 哭的循环在安安静静时每 140ms 空转一次，成本可以忽略 —— 换来的是
     "躲到屏幕边上就一定有抽泣声"这件事不依赖任何别的事件去唤醒它。 */
  if (!DEBUG.freeze) cryLoop();

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
    /* 生气：戳一下 / 读状态 / 哄好 / 直接惹毛。
       （enter 是给自检用的：探针不该依赖自己先把计数戳满，直接把状态摆过去更稳，
         而且这条路径是同步的，探针能立刻读到结果，不用等定时器。） */
    poke: function () { poke(); return angerInfo(); },
    anger: function () { return angerInfo(); },
    angerEnter: function () { enterAnger(); return angerInfo(); },
    angerHide: function () { enterAnger(); goHide(); return angerInfo(); },
    comfort: function () { return comfort(); },
    angerThreshold: ANGER_N,
    setFollow: function (on) {
      cfg.follow = !!on;
      S.mouse = null;
      if (cfg.follow) cfg.wander = false;
      save();
      syncPanel();
      return cfg.follow;
    },
    /* 改名字（控制台 / 外部调用）：和面板里点「保存」同一条逻辑。
       注意 `config.name = 'x'` 这种直接改法**不会**刷新头顶牌子 —— 用这个入口。 */
    setName: function (v) {
      cfg.name = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 12);
      applyName();
      save();
      syncPanel();
      return cfg.name;
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
      clearTimeout(S.blushTimer);
      clearAngerTimers();              // 生气那套定时器（含哭的循环）必须一起清
      angSlide.busy = false;
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
