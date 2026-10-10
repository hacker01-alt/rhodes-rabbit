/**
 * 验证启动动画的台词解析（resolveText）。
 *
 * 为什么要单独测这个函数：这条链路是"台词池 → 现算一条"，
 * 早先的写法先 pick 再判断，从数组里挑到函数之后就再也没调用过，
 * 函数被 String() 一串 —— 整段源码被当成台词逐字打了出来（真实 bug）。
 *
 * 为了测到**实际发货的代码**，这里不重写函数，而是从 client.js 里把
 * resolveText 抽出来执行；pick 用与插件相同的公式。
 * 用法: node rhodes-boot-plugin/tools/test_resolve.mjs
 *      （在仓库根目录执行；它读的是上一级的 client.js 构建产物，
 *        所以改完 client.src.js 要先跑 build_client.py 再跑这个）
 */
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/* 把 resolveText 的定义连同它的花括号整体抽出来（按括号配平找到结尾） */
const start = src.indexOf('const resolveText = ');
if (start < 0) {
  console.log('FAILED: 产物里找不到 resolveText —— 修复没进构建');
  process.exit(1);
}
let i = src.indexOf('{', start);
let depth = 0, end = -1;
for (let k = i; k < src.length; k++) {
  if (src[k] === '{') depth++;
  else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
}
const decl = src.slice(start, end).replace(/^const\s+/, '');
console.log('从产物里抽到:', decl.replace(/\s+/g, ' ').slice(0, 96) + ' …');

/* 与插件同款：pick = (arr) => arr[(Math.random() * arr.length) | 0] */
let RND = 0;
const pick = (arr) => arr[(RND * arr.length) | 0];
const resolveText = new Function('pick', decl + '; return resolveText;')(pick);

/* --- 真实的那一句（从 client.src.js 抄下来的形态，一字不改） --- */
const live = () => '今日签到完成：补给 +50 根，共可喂 50 根。';
const realPool = [
  '权限确认：博士 DOCTOR，欢迎回来。',
  '已登记临时干员「兔兔」，编制：后勤·胡萝卜消耗股。',
  '罗德岛终端已就绪，欢迎回来，博士。',
  live,
];

const cases = [
  ['纯字符串', '就直接给我', '就直接给我'],
  ['字符串数组', ['A', 'B', 'C'], null],
  ['纯函数', live, '今日签到完成：补给 +50 根，共可喂 50 根。'],
  ['函数返回数组', () => ['X', 'Y'], null],
  ['数组里混着函数（就是这个 bug）', realPool, null],
  ['嵌套数组', [[['深']]], '深'],
  ['空数组', [], undefined],
  ['null', null, null],
];

let ok = true;
for (const [name, input, expect] of cases) {
  /* 每种输入都把所有随机位置试一遍，确保不会"碰巧"才错 */
  const got = [];
  for (let r = 0; r < 5; r++) {
    RND = r / 5 + 0.01;
    got.push(resolveText(input));
  }
  const types = [...new Set(got.map((v) => typeof v))];
  const fnLeak = got.some((v) => typeof v === 'function' ||
    (typeof v === 'string' && (v.includes('=>') || v.includes('${') || v.includes('SETTINGS.'))));
  const expectOk = expect === null ? true : got.every((v) => v === expect);
  const pass = !fnLeak && types.every((t) => t === 'string' || t === 'undefined' || t === 'object') && expectOk;
  if (!pass) ok = false;
  console.log(
    (pass ? '  PASS  ' : '  FAIL  ') + name.padEnd(26) +
    ' → ' + JSON.stringify(got.slice(0, 3)) +
    (got.length > 3 ? ' …' : '') + '  类型=' + types.join('/') +
    (fnLeak ? '  ← 泄漏了函数/源码！' : '')
  );
}

console.log(ok ? '\nRESOLVE-TEXT OK' : '\nRESOLVE-TEXT FAILED');
process.exit(ok ? 0 : 1);
