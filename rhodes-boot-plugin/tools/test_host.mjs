/**
 * Host 半边的小测试：
 *   · apply() 往注入表推了 head/body 两行，重复调用不重复推
 *   · 存在 webServer 时注册了 tapIndex，且变换真的把脚本插进了 <head>
 * 用法: node tools/test_host.mjs
 */
import { apply } from '../index.js';

const rows = [];
let tapTransform = null;
const ctx = {
  on(name, fn) { if (name === 'webserver/index-inject') fn(rows); },
  inject(keys, cb) {
    cb({ webServer: { tapIndex(fn) { tapTransform = fn; return () => { }; } } });
  },
};

apply(ctx);
apply(ctx);   // 第二次：应该被幂等挡掉

console.log('rows:', JSON.stringify(rows.map((r) => ({ kind: r.kind, placement: r.placement, len: r.text.length }))));
console.log('tapIndex registered:', typeof tapTransform === 'function');

const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div></body></html>';
const out = tapTransform ? tapTransform(html) : '';
const headAt = out.indexOf('</head>');
const scriptAt = out.indexOf('rb-boot-cover');
const injectedIntoHead = scriptAt > 0 && scriptAt < headAt;
console.log('tapIndex injects into <head>:', injectedIntoHead);
const twice = tapTransform ? tapTransform(out) : '';
console.log('tapIndex idempotent:', twice.split('rb-boot-cover').length === out.split('rb-boot-cover').length);

const ok = rows.length === 2
  && rows[0].kind === 'script' && rows[0].placement === 'head'
  && rows[1].kind === 'script' && rows[1].placement === 'body'
  && rows[0].text.includes('rb-boot-cover')
  && rows[0].text.includes('30000')
  && typeof tapTransform === 'function'
  && injectedIntoHead;

console.log(ok ? 'HOST HALF OK' : 'HOST HALF FAILED');
process.exit(ok ? 0 : 1);
