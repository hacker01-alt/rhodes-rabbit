/* =========================================================
   RHODES ISLAND // BOOT SEQUENCE
   明日方舟风格开启动画 · 逻辑层
   ---------------------------------------------------------
   想改内容只看最上面的 CONFIG 就行。
   ========================================================= */
(() => {
  'use strict';

  /* ======================= CONFIG ======================= */
  let CONFIG = {
    /* 兔子出场方式：'companion' 全程陪着陪你加载 / 'jumpscare' 加载到最后突然糊脸 / 'off' 不出现 */
    rabbitMode: 'companion',

    sound: true,          // 初始音效开关（浏览器要求先点一下页面才会响）
    grain: 0.06,          // 噪点强度 0~0.2
    hopInterval: [1150, 1900],   // 兔子蹦跶间隔(ms)

    /* 胡萝卜小剧场 */
    carrot: true,                 // 关掉就没有胡萝卜
    carrotInterval: [3000, 6600], // 随机啃一根的间隔(ms)
    carrotBites: [3, 5],          // 一根要啃几口
    carrotWords: ['咔嚓！', '咔嚓♪', '嚼嚼嚼', '好吃…', '唔姆'],

    tips: [
      '提示：点击画面或按空格，可跳过启动序列。',
      '提示：右下角那只兔子可以戳，它会吃胡萝卜。',
      '提示：PRTS 正在同步干员档案，请保持终端连接。',
      '提示：不要在源石浓度过高的区域停留过久。',
      '提示：按 R 键可以随时重新播放本段动画。',
      '提示：本终端由罗德岛制药提供技术支持。',
    ],

    logs: [
      // [文案, 标签, 相对启动的偏移ms] —— 偏移量同时决定日志时间戳和右上角时钟，
      // 这样"屏幕上走过的时间"和"日志上的时间"永远对得上，不会再出现差一分多钟。
      ['检查终端硬件…', 'OK', 250],
      ['挂载 PRTS 内核 v3.14…', 'OK', 1150],
      ['校验源石加密签名…', 'OK', 2050],
      ['载入干员档案 (247)…', 'OK', 2950],
      ['同步罗德岛数据库…', 'OK', 3850],
      ['建立神经链路…', 'OK', 4750],
      ['权限确认：博士 DOCTOR', 'GRANTED', 5650],
      ['启动完成。', 'READY', 6550],
    ],

    dialog: [
      { name: '？？？', text: '……博士？' },
      { name: 'PRTS', text: '警告：检测到未知生命体，可爱指数已超出量程。' },
      { name: '兔兔', text: '（它把外套又裹紧了一点，朝你眨了眨眼。）' },
    ],

    /* 加载分段：to=目标百分比，dur=耗时ms，at=启动后第几ms开始，stall=卡顿段（百分比不动） */
    segments: [
      { at: 1700, to: 33, dur: 900, msg: '正在校验本地资源…', link: 'SYNCING' },
      { at: 2600, to: 33, dur: 620, stall: true },
      { at: 3220, to: 57, dur: 1100, msg: '载入干员档案 (247)…', link: 'LOADING' },
      { at: 4320, to: 57, dur: 780, stall: true },
      { at: 5100, to: 78, dur: 950, msg: '同步 PRTS 数据库…', link: 'SYNCING' },
      { at: 6050, to: 78, dur: 700, stall: true },
      { at: 6750, to: 92, dur: 820, msg: '建立神经链路…', link: 'LINKING' },
      { at: 7570, to: 92, dur: 880, stall: true },
      { at: 8450, to: 100, dur: 700, msg: '连接完成，等待确认…', link: 'STABLE' },
    ],
  };

  /* 也可以用网址参数临时试试别的效果：
     index.html?rabbit=jumpscare      兔子改成最后糊脸登场
     index.html?rabbit=off            不要兔子
     index.html?sound=0               静音
     index.html?carrot=0              不要胡萝卜小剧场
     index.html?at=6800               定格在启动后第 6800ms（出预览图用，见 applyDebugLock） */
  (function applyQuery() {
    try {
      const q = new URLSearchParams(location.search);
      if (q.has('rabbit')) CONFIG.rabbitMode = q.get('rabbit');
      if (q.has('sound')) CONFIG.sound = q.get('sound') !== '0';
      if (q.has('carrot')) CONFIG.carrot = q.get('carrot') !== '0';
      if (q.has('at')) CONFIG.lockAt = Number(q.get('at'));
      /* 老配置没写 at 的分段，按顺序把 dur 累加成时间轴 */
      let t = 1700;
      CONFIG.segments.forEach((s) => { if (s.at == null) s.at = t; t = s.at + s.dur; });
    } catch (e) { /* noop */ }
  })();

  /* ======================= DOM ======================= */
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const logoWrap = $('logoWrap');
  const rule = $('rule'), subtitle = $('subtitle'), chip = $('chip'), hero = document.querySelector('.hero');
  const progress = $('progress'), fill = $('fill'), pctEl = $('pct'), statusText = $('statusText'), hexEl = $('hex');
  const tickBox = $('ticks'), tipEl = $('tip'), logEl = $('log');
  const rabbit = $('rabbit'), rabbitHop = $('rabbitHop'), rabbitRing = $('rabbitRing'), rabbitImg = $('rabbitImg');
  const carrot = $('carrot'), carrotCount = $('carrotCount');
  const dialog = $('dialog'), dialogName = $('dialogName'), dialogText = $('dialogText');
  const endcard = $('endcard'), beatEl = $('beat'), flashEl = $('flash'), tearEl = $('tear');
  const skipBtn = $('skipBtn'), soundBtn = $('soundBtn');
  const linkState = $('linkState'), signalEl = $('signal'), clockEl = $('clock'), nodeEl = $('nodeId');
  const huds = [...document.querySelectorAll('.hud')];
  const btns = [skipBtn, soundBtn];

  /* ======================= state / clock ======================= */
  const S = { running: false, phase: 'idle', raf: 0, timers: [], eating: false, carrots: 0 };

  /* 动画自己的时间线：屏幕上显示的"时间"必须和动画时长一致。
     之前时钟取真实墙钟(10.5s 的动画能显示成差一分多钟)，日志又是另一次 new Date()，
     两边各走各的。现在统一从一个基准时刻 + 动画内经过时间推算。 */
  const CLOCKSCALE = 2.15;   // 10.5s 的动画 = 屏幕上走过约 22s，看起来才像一段真实的开机
  const Timeline = { start: Date.now(), elapsed: 0, last: 0 };
  const clockMs = () => Timeline.start + Timeline.elapsed;
  const stamp = (ms) => {
    const d = new Date(ms);
    return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}`;
  };
  const advanceClock = () => {
    const now = performance.now();
    if (Timeline.last) {
      const dt = Math.min(now - Timeline.last, 250);   // 切后台/掉帧时不要一次跳过去
      Timeline.elapsed += dt * CLOCKSCALE;
    }
    Timeline.last = now;
    clockEl.textContent = stamp(clockMs());
  };
  const resetClock = () => { Timeline.start = Date.now(); Timeline.elapsed = 0; Timeline.last = 0; };

  const CLOCK = {
    later(ms, fn) {
      const id = setTimeout(() => { if (S.running) fn(); }, ms);
      S.timers.push(id);
      return id;
    },
    raf(fn) { S.raf = requestAnimationFrame(fn); return S.raf; },
    clear() {
      S.timers.forEach(clearTimeout); S.timers.length = 0;
      cancelAnimationFrame(S.raf); S.raf = 0;
    },
  };

  const pad = (n, l = 3) => String(n).padStart(l, '0');
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const randHex = (n) => Array.from({ length: n }, () => '0123456789ABCDEF'[(Math.random() * 16) | 0]).join('');

  /* ======================= FX canvas ======================= */
  const Fx = (() => {
    const cv = $('fx'), ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;              // 960x540 = 设计画布的一半
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const tctx = tile.getContext('2d');
    const img = tctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    const pattern = ctx.createPattern(tile, 'repeat');

    let parts = [], running = false, raf = 0;

    function frame() {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      // 噪点
      ctx.save();
      ctx.globalAlpha = CONFIG.grain * (0.7 + Math.random() * 0.6);
      ctx.translate(-(Math.random() * 128) | 0, -(Math.random() * 128) | 0);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, W + 128, H + 128);
      ctx.restore();
      // 粒子
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
      raf = requestAnimationFrame(frame);
    }

    return {
      start() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
      stop() { running = false; cancelAnimationFrame(raf); },
      clear() { parts = []; ctx.clearRect(0, 0, W, H); },
      burst(x, y, n = 40, color = '#ffffff') {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, sp = rnd(0.6, 4.6);
          parts.push({
            x: x / 2, y: y / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8,
            g: 0.14, s: rnd(1, 3), life: 1, decay: rnd(0.02, 0.055),
            color: Math.random() < 0.35 ? '#9fd8ff' : color,
          });
        }
      },
    };
  })();

  /* ======================= audio ======================= */
  const Sfx = (() => {
    let ac = null, master = null, on = CONFIG.sound, droneNodes = null, noiseBuf = null, pendingDrone = false;

    function ensure() {
      if (ac) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = on ? 0.9 : 0;
        master.connect(ac.destination);
      } catch (e) { ac = null; }
      return ac;
    }
    function resume() {
      if (!ensure()) return;
      const go = () => { if (pendingDrone && !droneNodes) { pendingDrone = false; startDrone(); } };
      if (ac.state === 'suspended') { const p = ac.resume(); if (p && p.then) p.then(go); else go(); }
      else go();
    }
    /* 浏览器策略：没有交互前音频上下文是 suspended 的，此时直接静音，避免恢复时所有音效一起炸出来 */
    function silent() { return !ac || ac.state !== 'running' || !on; }

    function tone(o) {
      if (silent()) return;
      const t0 = ac.currentTime + (o.delay || 0);
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.freq, t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(24, o.to), t0 + o.dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(o.gain == null ? 0.12 : o.gain, t0 + (o.attack || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      osc.connect(g).connect(master);
      osc.start(t0); osc.stop(t0 + o.dur + 0.06);
    }

    function noise(o) {
      if (silent()) return;
      if (!noiseBuf) {
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.2, ac.sampleRate);
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
      src.connect(f).connect(g).connect(master);
      src.start(t0); src.stop(t0 + o.dur + 0.05);
    }

    function startDrone() {
      if (!ensure() || silent() || droneNodes) return;
      const g = ac.createGain();
      g.gain.value = 0.0001;
      g.gain.linearRampToValueAtTime(0.075, ac.currentTime + 2.2);
      g.connect(master);
      const a = ac.createOscillator(), b = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain();
      a.type = 'sine'; a.frequency.value = 55;
      b.type = 'triangle'; b.frequency.value = 82.5;
      lfo.frequency.value = 0.11; lg.gain.value = 0.03;
      lfo.connect(lg).connect(g.gain);
      a.connect(g); b.connect(g);
      a.start(); b.start(); lfo.start();
      droneNodes = { a, b, lfo, g };
    }

    return {
      resume,
      get on() { return on; },
      set on(v) { on = v; if (master) master.gain.value = v ? 0.9 : 0; },
      get live() { return !!ac && ac.state === 'running'; },
      startDrone() {
        if (!ensure()) return;
        if (silent()) { pendingDrone = true; return; }
        startDrone();
      },
      stopDrone() {
        pendingDrone = false;
        if (!droneNodes) return;
        const { a, b, lfo, g } = droneNodes;
        try {
          g.gain.cancelScheduledValues(ac.currentTime);
          g.gain.setValueAtTime(g.gain.value, ac.currentTime);
          g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.8);
          [a, b, lfo].forEach((o) => o.stop(ac.currentTime + 0.9));
        } catch (e) { /* noop */ }
        droneNodes = null;
      },
      blip(f = 1500, g = 0.045) { tone({ freq: f, dur: 0.045, type: 'square', gain: g }); },
      tick() { tone({ freq: 2400, dur: 0.03, type: 'triangle', gain: 0.03 }); },
      thud() { tone({ freq: 130, to: 42, dur: 0.5, type: 'sine', gain: 0.4 }); noise({ freq: 1800, to: 200, dur: 0.35, gain: 0.16 }); },
      charge() { tone({ freq: 220, to: 1500, dur: 0.9, type: 'sawtooth', gain: 0.10 }); noise({ freq: 300, to: 4200, dur: 0.95, gain: 0.1 }); },
      impact() { tone({ freq: 180, to: 30, dur: 0.7, type: 'sine', gain: 0.45 }); noise({ freq: 2600, to: 120, dur: 0.5, gain: 0.24 }); },
      boing() { tone({ freq: 300, to: 900, dur: 0.18, type: 'sine', gain: 0.16 }); tone({ freq: 900, to: 420, dur: 0.22, type: 'sine', gain: 0.12, delay: 0.16 }); },
      /* 咬胡萝卜：一记脆响 + 一点低频咀嚼 */
      crunch() {
        noise({ freq: rnd(1800, 3000), to: rnd(500, 900), dur: 0.085, gain: 0.15, type: 'bandpass' });
        tone({ freq: rnd(150, 240), dur: 0.07, type: 'triangle', gain: 0.05 });
        tone({ freq: rnd(900, 1400), dur: 0.04, type: 'square', gain: 0.018, delay: 0.04 });
      },
      gulp() { tone({ freq: 320, to: 90, dur: 0.26, type: 'sine', gain: 0.09 }); },
      chord() {
        [261.6, 329.6, 392.0, 523.3].forEach((f, i) =>
          tone({ freq: f, dur: 2.6, type: 'sine', gain: 0.075, delay: i * 0.09, attack: 0.35 }));
      },
    };
  })();

  /* ======================= helpers ======================= */
  function flash(power = 0.6) {
    flashEl.style.setProperty('--f', power);
    flashEl.classList.remove('fire'); void flashEl.offsetWidth; flashEl.classList.add('fire');
  }
  function tear() {
    tearEl.classList.remove('fire'); void tearEl.offsetWidth; tearEl.classList.add('fire');
  }
  function shake() {
    stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake');
    setTimeout(() => stage.classList.remove('shake'), 460);
  }
  function sweep() {
    const bar = document.createElement('div');
    bar.className = 'sweepbar layer';
    stage.appendChild(bar);
    setTimeout(() => bar.remove(), 1700);
  }
  function setPct(v) {
    const n = Math.max(0, Math.min(100, v));
    fill.style.width = n + '%';
    pctEl.innerHTML = pad(Math.floor(n)) + '<i>%</i>';
    const bars = Math.max(1, Math.min(5, Math.ceil(n / 20)));
    signalEl.textContent = '▮'.repeat(bars) + '▯'.repeat(5 - bars);
  }
  function setStatus(t) { statusText.textContent = t; }
  function pushLog(msg, tag) {
    const t = stamp(clockMs());
    const row = document.createElement('div');
    row.innerHTML = `<span class="t">[${t}]</span>${esc(msg)}${tag ? `<span class="ok">${esc(tag)}</span>` : ''}`;
    logEl.appendChild(row);
    requestAnimationFrame(() => row.classList.add('on'));
    while (logEl.children.length > 7) logEl.removeChild(logEl.firstChild);
  }

  /* ======================= rabbit ======================= */
  function hop(big) {
    if (S.phase === 'end') return;
    rabbitHop.classList.remove('hop', 'hop-big');
    void rabbitHop.offsetWidth;
    rabbitHop.classList.add(big ? 'hop-big' : 'hop');
    if (big) { Sfx.thud(); Fx.burst(1416, 1030, 12); } else { Sfx.blip(rnd(700, 950), 0.03); }
  }
  function ringBurst() {
    rabbitRing.classList.remove('burst'); void rabbitRing.offsetWidth; rabbitRing.classList.add('burst');
  }
  function hopLoop() {
    if (!S.running || S.phase !== 'run' || CONFIG.rabbitMode === 'off') return;
    if (S.eating) { CLOCK.later(600, hopLoop); return; }   // 啃胡萝卜的时候就别蹦了
    const big = Math.random() < 0.22;
    hop(big);
    CLOCK.later(rnd(CONFIG.hopInterval[0], CONFIG.hopInterval[1]), hopLoop);
  }
  function rabbitIn() {
    rabbit.classList.add('on');
    hop(true);
    CLOCK.later(700, () => hop(false));
  }

  /* ======================= 胡萝卜小剧场 ======================= */
  /* 兔子嘴边（在真实屏幕上算一次坐标，缩放/移动都不会算错） */
  function mouthPoint() {
    const r = rabbitImg.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    const k = 1920 / (st.width || 1920);
    return {
      x: (r.left - st.left + r.width * 0.55) * k,
      y: (r.top - st.top + r.height * 0.30) * k,
    };
  }
  function floatWord(text) {
    const p = mouthPoint();
    const el = document.createElement('div');
    el.className = 'float-word';
    el.textContent = text;
    el.style.left = (p.x + 52) + 'px';       // 往右上方飘，避开兔子上方的计数条
    el.style.top = (p.y - 44) + 'px';
    stage.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }
  function chomp() {
    rabbitImg.classList.remove('chomp'); void rabbitImg.offsetWidth; rabbitImg.classList.add('chomp');
    Sfx.crunch();
    const p = mouthPoint();
    Fx.burst(p.x + 10, p.y + 6, 7, '#ffb765');
  }
  function carrotReset() {
    carrot.classList.remove('show');
    carrot.style.transform = '';
    S.eating = false;
  }
  function eatCarrot(byClick) {
    if (!CONFIG.carrot || S.eating || S.phase !== 'run') return false;
    S.eating = true;
    S.carrots++;
    carrotCount.innerHTML = 'CARROT <b>×' + S.carrots + '</b>';
    carrotCount.classList.add('on');

    carrot.classList.add('show');
    carrot.style.transform = 'rotate(-15deg) scale(.35)';
    requestAnimationFrame(() => { carrot.style.transform = 'rotate(-9deg) scale(1)'; });
    if (byClick) Sfx.blip(1600, 0.05);

    const bites = Math.round(rnd(CONFIG.carrotBites[0], CONFIG.carrotBites[1]));
    let i = 0;
    const bite = () => {
      if (!S.running) return;
      i++;
      const k = Math.max(0.02, 1 - i / (bites + 0.5));
      carrot.style.transform = `rotate(${rnd(-16, 1).toFixed(1)}deg) scale(${k.toFixed(3)})`;
      chomp();
      if (i === 1 || i === bites) floatWord(CONFIG.carrotWords[(Math.random() * CONFIG.carrotWords.length) | 0]);
      if (i < bites) CLOCK.later(300 + Math.random() * 170, bite);
      else CLOCK.later(320, () => {
        const p = mouthPoint();
        Fx.burst(p.x + 8, p.y + 4, 12, '#ffb765');
        Sfx.gulp();
        carrotReset();
        scheduleCarrot();
      });
    };
    CLOCK.later(440, bite);
    return true;
  }
  /* 随机排下一根胡萝卜 */
  function scheduleCarrot() {
    if (!CONFIG.carrot) return;
    CLOCK.later(rnd(CONFIG.carrotInterval[0], CONFIG.carrotInterval[1]), () => {
      if (S.phase === 'run' && !S.eating) eatCarrot(false);
      scheduleCarrot();
    });
  }

  /* ======================= logs & tips ======================= */
  function logsStart() {
    CONFIG.logs.forEach((entry, i) => {
      const [msg, tag, at] = entry;
      CLOCK.later(at != null ? at : i * 890, () => {
        pushLog(msg, tag);
        Sfx.blip(rnd(1200, 1700), 0.028);
      });
    });
  }
  function tipsStart() {
    tipEl.classList.add('on');
    let i = 0;
    const next = () => {
      tipEl.style.opacity = 0;
      CLOCK.later(420, () => {
        tipEl.textContent = CONFIG.tips[i % CONFIG.tips.length];
        i++;
        tipEl.style.opacity = '';
      });
      CLOCK.later(3400, next);
    };
    next();
  }

  /* ======================= progress ======================= */
  function progressRun() {
    let idx = 0, val = 0;
    const ease = (k) => 1 - Math.pow(1 - k, 2.4);

    const step = () => {
      if (!S.running) return;
      const seg = CONFIG.segments[idx++];
      if (!seg) { setPct(100); finale(); return; }
      if (seg.msg) setStatus(seg.msg);
      if (seg.link) { linkState.textContent = seg.link; }

      const from = val, to = seg.to, t0 = performance.now();
      const tween = (now) => {
        if (!S.running) return;
        const k = Math.min(1, (now - t0) / seg.dur);
        if (seg.stall) {
          val = from + Math.sin(now / 130) * 0.35;        // 卡住时的细微抖动
          setPct(val);
          if (k < 1) CLOCK.raf(tween); else { val = to; setPct(val); step(); }
          return;
        }
        const prev = Math.floor(val);
        val = from + (to - from) * ease(k);
        setPct(val);
        if (Math.floor(val) !== prev && Math.floor(val) % 10 === 0) Sfx.tick();
        if (k < 1) CLOCK.raf(tween); else { val = to; setPct(val); step(); }
      };
      CLOCK.raf(tween);
    };
    step();
  }

  /* ======================= finale ======================= */
  function finale() {
    S.phase = 'finale';
    linkState.textContent = 'STABLE';
    carrotReset();
    carrotCount.classList.remove('on');   // 终章让兔子当主角，收起计数条
    CLOCK.clear();                       // 清掉加载期间残留的定时器（兔子蹦跶等）
    S.running = true;
    Fx.stop();

    setPct(100);
    setStatus('连接完成 · LINK ESTABLISHED');
    Sfx.charge();
    flash(0.85); tear(); shake();

    CLOCK.later(140, () => {
      logoWrap.classList.add('glitch'); tear(); Sfx.impact(); Fx.burst(960, 340, 26);
      Fx.start();
    });
    CLOCK.later(520, () => logoWrap.classList.remove('glitch'));

    /* 兔子登场 */
    CLOCK.later(300, () => {
      progress.classList.add('dim'); tipEl.classList.add('dim');
      hero.classList.add('shift', 'dim');
      rabbitHop.classList.remove('hop', 'hop-big');
      if (CONFIG.rabbitMode === 'jumpscare') {
        rabbit.classList.add('on', 'scare');
        Sfx.impact(); flash(1); tear(); shake();
        Fx.burst(960, 540, 110);
        CLOCK.later(1500, () => { rabbit.classList.remove('scare'); rabbit.classList.add('center'); Sfx.boing(); });
      } else {
        rabbit.classList.add('center');
      }
      CLOCK.later(340, () => { ringBurst(); Fx.burst(960, 600, 60); Sfx.boing(); flash(0.5); tear(); shake(); });
      CLOCK.later(1250, () => hop(false));
    });

    CLOCK.later(1150, () => { dialog.classList.add('on'); typeDialog(); });
  }

  function typeDialog() {
    const lines = CONFIG.dialog;
    let li = 0;
    const nextLine = () => {
      if (!S.running) return;
      if (li >= lines.length) { CLOCK.later(820, endSequence); return; }
      const cur = lines[li++];
      dialogName.textContent = cur.name;
      dialogText.innerHTML = '<span class="cur"></span>';
      let i = 0;
      const tick = () => {
        if (!S.running) return;
        i++;
        dialogText.innerHTML = esc(cur.text.slice(0, i)) + '<span class="cur"></span>';
        if (i % 2 === 0) Sfx.blip(rnd(1050, 1450), 0.03);
        if (i < cur.text.length) CLOCK.later(36, tick);
        else CLOCK.later(500, nextLine);
      };
      tick();
    };
    nextLine();
  }

  function endSequence() {
    S.phase = 'end';
    stage.dataset.state = 'end';
    linkState.textContent = 'STABLE';
    setStatus('系统就绪 · SYSTEM ONLINE');
    pushLog('系统就绪，等待指令。', 'READY');
    rabbit.classList.remove('center');
    rabbit.classList.add('off');
    CLOCK.later(700, () => dialog.classList.remove('on'));
    CLOCK.later(950, () => {
      hero.classList.remove('shift', 'dim');
      hero.classList.add('fade');          // 副标题/版本号真正退场，不留半透明重影
      progress.classList.remove('dim'); tipEl.classList.remove('dim');
      tipEl.classList.add('hide');
      endcard.classList.add('on');
      beatEl.classList.add('on');          // "100% · LINK ESTABLISHED" 这个节拍挪到结束页
      Sfx.chord();
      flash(0.35);
    });
    Sfx.stopDrone();
  }

  /* ======================= start / skip / replay ======================= */
  function reset() {
    CLOCK.clear();
    S.running = true; S.phase = 'run'; S.raf = 0;
    stage.dataset.state = 'run';
    stage.classList.add('is-run');
    stage.classList.remove('shake');
    document.querySelectorAll('.sweepbar').forEach((n) => n.remove());

    huds.forEach((el) => el.classList.remove('show'));
    btns.forEach((el) => el.classList.remove('show'));
    logoWrap.classList.remove('slam', 'scan', 'settle', 'glitch', 'dim');
    [rule, subtitle, chip, progress, tipEl, endcard, dialog, beatEl].forEach((el) => el.classList.remove('on', 'dim', 'hide'));
    hero.classList.remove('shift', 'dim');
    rabbit.classList.remove('on', 'center', 'off');
    rabbitHop.classList.remove('hop', 'hop-big');
    rabbitRing.classList.remove('burst');
    rabbitImg.classList.remove('chomp');
    carrotReset();
    S.carrots = 0;
    carrotCount.innerHTML = 'CARROT <b>×0</b>';
    carrotCount.classList.remove('on');
    document.querySelectorAll('.float-word').forEach((n) => n.remove());

    setPct(0);
    setStatus('正在初始化…');
    linkState.textContent = 'STANDBY';
    logEl.innerHTML = '';
    tipEl.textContent = '';
    tipEl.style.opacity = '';
    dialogText.innerHTML = '';
    dialogName.textContent = '？？？';
    Fx.clear();
  }

  function play() {
    reset();
    resetClock();
    nodeEl.textContent = randHex(4);   // 一次播放只分配一次节点号，别再每 125ms 换一个
    hexEl.textContent = '0x' + randHex(8);

    huds.forEach((el, i) => CLOCK.later(140 + i * 130, () => el.classList.add('show')));
    btns.forEach((el, i) => CLOCK.later(2400 + i * 140, () => el.classList.add('show')));
    CLOCK.later(240, sweep);
    CLOCK.later(600, () => {
      logoWrap.classList.add('slam');
      flash(0.6); tear(); shake(); Sfx.thud();
      CLOCK.later(420, () => logoWrap.classList.add('scan'));
      CLOCK.later(720, () => {
        logoWrap.classList.remove('slam');
        logoWrap.classList.add('settle');
      });
    });
    CLOCK.later(1280, () => {
      rule.classList.add('on');
      CLOCK.later(180, () => { subtitle.classList.add('on'); Sfx.blip(880, 0.04); });
      CLOCK.later(420, () => { chip.classList.add('on'); Sfx.blip(1180, 0.04); });
    });
    CLOCK.later(1660, () => progress.classList.add('on'));
    CLOCK.later(1780, () => { logsStart(); progressRun(); });
    CLOCK.later(1980, tipsStart);
    if (CONFIG.rabbitMode !== 'off') {
      CLOCK.later(1700, rabbitIn);
      CLOCK.later(2600, hopLoop);
      CLOCK.later(2200, scheduleCarrot);
    }
    Sfx.startDrone();
    Fx.start();
  }

  function applyEndState() {
    CLOCK.clear();
    S.running = true;
    S.phase = 'end';
    stage.dataset.state = 'end';
    stage.classList.add('is-run');
    huds.forEach((el) => el.classList.add('show'));
    btns.forEach((el) => el.classList.add('show'));
    logoWrap.classList.remove('slam', 'scan', 'glitch', 'dim');
    logoWrap.classList.add('settle');
    [rule, subtitle, chip, progress, tipEl, endcard].forEach((el) => el.classList.add('on'));
    beatEl.classList.add('on');
    progress.classList.remove('dim'); tipEl.classList.remove('dim');
    tipEl.classList.add('hide');
    hero.classList.remove('shift', 'dim');
    hero.classList.add('fade');
    dialog.classList.remove('on');
    rabbit.classList.remove('on', 'center');
    rabbit.classList.add('off');
    rabbitImg.classList.remove('chomp');
    carrotReset();
    document.querySelectorAll('.float-word').forEach((n) => n.remove());
    setPct(100);
    setStatus('系统就绪 · SYSTEM ONLINE');
    linkState.textContent = 'STABLE';
    if (!logEl.children.length) CONFIG.logs.slice(0, 5).forEach((l) => pushLog(l[0], l[1]));
    pushLog('已跳过启动序列。', 'SKIP');
    Fx.stop(); Fx.clear();
    Sfx.stopDrone();
  }

  function skip() {
    if (S.phase === 'run' || S.phase === 'finale') {
      flash(0.5); applyEndState();
    } else if (S.phase === 'end') {
      play();
    }
  }

  /* ======================= controls ======================= */
  let lastBtnLabel = '';
  function updateButtons() {
    const soundLabel = !Sfx.on ? '♪ MUTED' : (Sfx.live ? '♪ SOUND' : '♪ 点击开启音效');
    const skipLabel = (S.phase === 'end') ? '重播 REPLAY' : '跳过 SKIP';
    const key = soundLabel + '|' + skipLabel;
    if (key === lastBtnLabel) return;
    lastBtnLabel = key;
    soundBtn.textContent = soundLabel;
    skipBtn.textContent = skipLabel;
    soundBtn.classList.toggle('off', !Sfx.on);
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    Sfx.resume();
    skip();
  });
  /* 戳兔子 = 喂胡萝卜（只在加载过程中生效，其它时候这一下照旧算作跳过/重播） */
  rabbit.addEventListener('pointerdown', (e) => {
    if (S.phase !== 'run') return;
    if (eatCarrot(true)) {
      e.stopPropagation();
      Sfx.resume();
    }
  });
  skipBtn.addEventListener('click', (e) => { e.stopPropagation(); Sfx.resume(); skip(); updateButtons(); });
  soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Sfx.on = !Sfx.on;
    Sfx.resume();
    if (Sfx.on) { Sfx.startDrone(); Sfx.blip(1200, 0.05); }
    updateButtons();
  });
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') { e.preventDefault(); Sfx.resume(); skip(); updateButtons(); }
    else if (k === 'r') { Sfx.resume(); play(); }
    else if (k === 'm') { soundBtn.click(); }
  });
  window.addEventListener('pointerdown', () => { Sfx.resume(); updateButtons(); }, { once: true });

  /* ======================= boot ======================= */
  function fit() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--fit', s.toFixed(4));
  }
  window.addEventListener('resize', fit);
  fit();

  (function watchRabbitImage() {
    let retried = false;
    rabbitImg.addEventListener('error', () => {
      if (!retried) { retried = true; rabbitImg.src = 'assets/rabbit.jpg'; return; }
      rabbit.style.display = 'none';
    });
  })();

  setInterval(() => {
    advanceClock();
    updateButtons();
  }, 125);

  clockEl.textContent = '--:--:--';
  setPct(0);
  updateButtons();

  /* 暴露一个小手柄，方便在控制台里玩：
     RHODES.eat()   立刻喂一根胡萝卜
     RHODES.play()  重播      RHODES.skip()  跳到结束
     RHODES.config  改配置（例如 RHODES.config.carrotInterval = [800, 1500]）        */
  window.RHODES = {
    play, skip, eat: () => eatCarrot(true), carrot: () => eatCarrot(true),
    config: CONFIG, state: S, sfx: Sfx,
  };

  /* ======================= debug lock =======================
     index.html?at=<ms> 让动画真正跑到启动后第 ms 毫秒，然后就地冻结。
     关键：不"手抄"一份状态，而是让真实时间轴自己走到那里（未到的定时器被推迟到几乎不会触发），
     所以截出来的画面就是真实播放时的那一帧，不会出现代码改了、截图没跟上的情况。 */
  function tweenAt(v) {
    const pts = [[0, 0], [1700, 0]].concat((CONFIG.segments || []).map((s) => [s.at, s.to]));
    if (v <= pts[0][0]) return 0;
    for (let i = 1; i < pts.length; i++) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      if (v <= t1) return t0 === t1 ? v1 : v0 + (v1 - v0) * ((v - t0) / (t1 - t0));
    }
    return 100;
  }

  function applyDebugLock() {
    const at = CONFIG.lockAt;
    if (!Number.isFinite(at)) return false;

    const past = [], future = [];
    CONFIG.logs.forEach((l) => (l[2] <= at ? past : future).push(l));
    CONFIG.logs = past.map((l) => [l[0], l[1], 0]).concat(future.map((l) => [l[0], l[1], 99999]));

    const before = [], after = [];
    CONFIG.segments.forEach((s) => (s.at <= at ? before : after).push(s));
    CONFIG.segments = before.concat(after.map((s) => Object.assign({}, s, { dur: 0, stall: false })));

    CONFIG.hopInterval = [9e5, 9e5];   // 冻结瞬间兔子正好抬在半空很难看，别让它蹦
    CONFIG.carrot = false;
    if (at < 1980) CONFIG.tips = [];

    /* 真实播放到 at 那一毫秒，然后就地冻结。冻结后挂一个超长定时器，
       让无头浏览器的虚拟时间继续往前走（否则页面空闲、截图可能落在冻结之前）。 */
    CLOCK.later(at, () => {
      S.timers.forEach(clearTimeout);
      S.timers.length = 0;
      cancelAnimationFrame(S.raf);
      S.running = false;
      Timeline.elapsed = at * CLOCKSCALE;
      clockEl.textContent = stamp(clockMs());
      try { setPct(tweenAt(at)); } catch (e) { /* noop */ }
      const css = document.createElement('style');
      css.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
      document.head.appendChild(css);
      Fx.stop();
      setTimeout(() => {}, 2e5);
    });
    return true;
  }

  /* 自动播放；如果希望改成“点击后才开始”，把下面这行换成注释里的写法 */
  applyDebugLock();
  play();
  // document.addEventListener('pointerdown', () => { if (S.phase === 'idle') play(); }, { once: true });
})();
