/**
 * Host half of the dsh-rhodes-pet bundle.
 *
 * 桌宠的画面全部在客户端半边（client.js，通过 shell.overlay 渲染），
 * 宿主这边不需要注入任何东西 —— 所以这个 apply 是空的，
 * 但**必须存在**：bundle 的入口就是它，没有它插件加载会失败。
 *
 * 保留一个空实现还有一个作用：以后要在宿主侧接事件（例如"任务完成时让兔兔提醒你"），
 * 就往这里加 ctx.on(...)，客户端那边通过 slot 的 props / 一个轻量事件桥接过去。
 */

export function apply(ctx) {
  /* 目前不需要在宿主侧做任何事。 */
  void ctx;
}
