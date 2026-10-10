/**
 * Host half of the dsh-rhodes-boot bundle.
 *
 * 目标：让「罗德岛启动序列」占住**第一帧**，而不是等 harness 界面出来之后才在对话界面上播。
 * 做法是往 index HTML 里塞一段"开机黑幕"脚本（内联、不含 await，不可能加载失败）。
 *
 * 四条通道都试一遍（脚本自带幂等，同时生效也只会有一层幕）：
 *   1. webserver/index-inject 的 head 行 —— 最早（解析 head 时就执行，首次绘制前）
 *   2. webserver/index-inject 的 body 行 —— 桌面端解释器确认支持 body
 *   3. webServer.tapIndex() 直接改 index HTML —— 浏览器路径
 *   4. 客户端模块在 apply() 里自己铺 —— 兜底，不依赖上面三条
 *
 * 每条通道都会往 localStorage 写一个自证标记（dsh-rhodesBoot.cover / .coverAt），
 * 所以"到底哪一层生效、比首次绘制早还是晚"是可以在事后从磁盘上读出来的，不用猜。
 *
 * 黑幕自带 30 秒看门狗，客户端没接管也绝不会把界面永久黑住。
 */

const MARK = 'rb-boot-cover';

/** ch: 'head' | 'body' | 'tap' */
function coverJs(ch) {
  return `(function () {
  try {
    function mark(name) {
      try {
        var k = 'dsh-rhodesBoot.cover';
        var v = localStorage.getItem(k) || '';
        if (v.indexOf(name) < 0) localStorage.setItem(k, v ? v + ',' + name : name);
        if (!localStorage.getItem('dsh-rhodesBoot.coverAt')) {
          localStorage.setItem('dsh-rhodesBoot.coverAt', name + '@' + Math.round(performance.now()));
        }
      } catch (e) { /* noop */ }
    }
    mark('${ch}');
    if (document.getElementById('${MARK}')) return;
    var K_AT = 'dsh-rhodesBoot.at', K_OFF = 'dsh-rhodesBoot.off',
        K_MODE = 'dsh-rhodesBoot.mode', K_DATE = 'dsh-rhodesBoot.date',
        K_PLAYED = 'dsh-rhodesBoot.played';
    function shouldCover() {
      try {
        if (localStorage.getItem(K_OFF) === '1') return false;
        var m = localStorage.getItem(K_MODE) || 'launch';
        if (m === 'off') return false;
        if (m === 'daily') {
          var d = new Date();
          var t = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
          return localStorage.getItem(K_DATE) !== t;
        }
        /* launch：新一次启动（新会话）就铺幕；同一次会话里刷新过就不铺。
           sessionStorage 取不到时宁可不铺，绝不冒险黑屏。
           （客户端在决定不播时也会主动撤幕，所以这里判断偏保守也没关系。） */
        try { if (sessionStorage.getItem(K_PLAYED) === '1') return false; } catch (e) { return false; }
        var at = Number(localStorage.getItem(K_AT) || 0);
        return !at || (Date.now() - at) > 1500;
      } catch (e) { return false; }
    }
    try { localStorage.setItem('dsh-rhodesBoot.coverGate', shouldCover() ? '1' : '0'); } catch (e) { /* noop */ }
    if (!shouldCover()) return;

    var cover = document.createElement('div');
    cover.id = '${MARK}';
    cover.setAttribute('aria-hidden', 'true');
    cover.setAttribute('style', 'position:fixed;left:0;top:0;right:0;bottom:0;width:100%;height:100%;' +
      'background:#000;z-index:2147483000;');
    /* 启动指示：一行小字 + 呼吸的点 + 一条来回扫的细线。
       比原来那行静止的 "PRTS BOOT SEQUENCE" 更像"正在起来"，不会看成卡死。 */
    var box = document.createElement('div');
    box.setAttribute('style', 'position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);' +
      'text-align:center;opacity:0;transition:opacity .45s ease;');
    var line = document.createElement('div');
    line.setAttribute('style', 'color:#9fd8ff;font:12px/1.6 Consolas,Menlo,monospace;' +
      'letter-spacing:.34em;white-space:nowrap;');
    line.textContent = 'PRTS BOOT SEQUENCE';
    var dots = document.createElement('b');
    dots.setAttribute('style', 'font-weight:400');
    line.appendChild(dots);
    var track = document.createElement('div');
    track.setAttribute('style', 'position:relative;width:230px;height:1px;margin:12px auto 0;' +
      'background:rgba(159,216,255,.16);overflow:hidden;');
    var spark = document.createElement('i');
    spark.setAttribute('style', 'position:absolute;top:0;left:0;width:56px;height:1px;' +
      'background:#9fd8ff;box-shadow:0 0 10px rgba(159,216,255,.9);');
    track.appendChild(spark);
    box.appendChild(line); box.appendChild(track);
    cover.appendChild(box);

    var dotTimer = 0, barTimer = 0, pos = -56, n = 0;
    setTimeout(function () {
      box.style.opacity = '0.65';
      dotTimer = setInterval(function () {
        n = (n + 1) % 4;
        dots.textContent = n ? ' ' + Array(n + 1).join('·') : '';
      }, 340);
      barTimer = setInterval(function () {
        pos += 7; if (pos > 230) pos = -56;
        spark.style.transform = 'translateX(' + pos + 'px)';
      }, 40);
    }, 500);

    function mount() { (document.body || document.documentElement).appendChild(cover); }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    var released = false;
    function release() {
      if (released) return;
      released = true;
      clearInterval(dotTimer); clearInterval(barTimer);
      if (cover.parentNode) cover.parentNode.removeChild(cover);
      window.__rhodesCover = null;
    }
    window.__rhodesCover = { release: release };
    setTimeout(release, 30000);   // 看门狗：客户端没接管也不会永久黑屏
  } catch (e) { /* 黑幕永远不能把页面搞坏 */ }
})();`;
}

/** 幂等：表里已经有这段脚本就别再推 */
function alreadyThere(table) {
  return table.some((row) => row && (
    (typeof row.text === 'string' && row.text.indexOf(MARK) >= 0) ||
    (typeof row.html === 'string' && row.html.indexOf(MARK) >= 0)
  ));
}

/** tapIndex: 直接插到 <head> 开头 */
function injectIntoHtml(html) {
  if (typeof html !== 'string' || html.indexOf(MARK) >= 0) return html;
  const tag = '<script>' + coverJs('tap') + '<\/script>';
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

export function apply(ctx) {
  // 通道 1 / 2：结构化注入行（每次渲染 index 都会重新取行）
  ctx.on('webserver/index-inject', (table) => {
    if (!Array.isArray(table) || alreadyThere(table)) return;
    table.push({ kind: 'script', placement: 'head', text: coverJs('head') });
    table.push({ kind: 'script', placement: 'body', text: coverJs('body') });
  });

  // 通道 3：直接变换 index HTML（webServer 服务不一定存在，所以局部 inject）
  ctx.inject(['webServer'], (scoped) => {
    try {
      if (scoped.webServer && typeof scoped.webServer.tapIndex === 'function') {
        scoped.webServer.tapIndex((html) => injectIntoHtml(html));
      }
    } catch (e) { /* noop */ }
  });
}
