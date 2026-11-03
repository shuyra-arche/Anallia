# Anallia 静态阅读器入门

如果拿到已组装的 starter 压缩包，在解压后的目录运行 `python3 -m http.server 5188 --bind 127.0.0.1`，再打开 `http://127.0.0.1:5188/`。

从仓库运行 `npm run build:reader`，得到 `dist-reader/`。复制**整个目录**，保留 `assets/`、`types/`、许可证和 frame 页面；只复制一个 JS 文件不够。产物不依赖仓库源码、Vite 开发服务或 CDN。它是浏览器 ESM 分发物，未发布 npm 包，也不提供 SSR。

仓库中的 `examples/consumer/` 是一个不导入源码的消费者。把这些示例文件复制到自己的目录，再把 `dist-reader/` 复制为其中的 `vendor/anallia/`。通过 HTTP(S) 提供目录，例如：

```sh
npm run build:reader
anallia_consumer_dir="$(mktemp -d /tmp/anallia-consumer.XXXXXX)"
mkdir -p "$anallia_consumer_dir/vendor/anallia"
cp examples/consumer/* "$anallia_consumer_dir/"
cp -R dist-reader/. "$anallia_consumer_dir/vendor/anallia/"
python3 -m http.server 5188 --bind 127.0.0.1 --directory "$anallia_consumer_dir"
```

打开 `http://127.0.0.1:5188/` 体验同页两份内容；打开 `/document.html` 体验文档入口，附加 `?example=notebook` 切换内容。结束后停止服务。仓库中可运行 `npm run test:reader`，自动将产物复制到临时独立目录，验证类型、桌面与手机交互，结束后清理临时服务。

## 两种挂载方式

**同页嵌入**：父页面只导入 `embedded.js`，不要加载阅读器样式。宿主由自己的页面提供尺寸。

```js
import { mountEmbeddedReader } from './vendor/anallia/embedded.js';
import { createFieldNotebook } from './vendor/anallia/examples.js';
const definition = createFieldNotebook();
const frameUrl = new URL('./vendor/anallia/reader-frame.html', document.baseURI);
let reader = mountEmbeddedReader(host, definition, {
  frameUrl,
  label: '雨后观察手册',
});
```

**独立文档**：加载 `vendor/anallia/styles.css`，提供当前文档唯一、已连接的 `<div id="scene"></div>`，再导入 `document.js` 的 `mountReader`。该入口拥有整份文档的主题、固定定位和快捷键，每份文档只允许一个实例。

```js
import { mountReader } from './vendor/anallia/document.js';
import { createGeometryReader } from './vendor/anallia/examples.js';
const reader = mountReader(document.querySelector('#scene'), createGeometryReader());
```

`examples.js` 是可选内容，不是核心运行时的前提。它提供几何阅读、分块手册 `createFieldNotebook()` 和静态手册 `createStaticFieldNotebook()`；独立消费者页面采用静态手册。

## 公共接口

| 接口 | 约定 |
| --- | --- |
| `ReaderDefinition` | `{ manifest, source, entry, title? }`；内容清单与异步内容源分开 |
| `ReaderOptions` | 可选 `chapter`、`morph`（0–1）、`theme`、`renderer`（auto/svg/webgl）、初始 `settings`；或用 `restore` 传入快照，不能同时指定 chapter/morph |
| `EmbeddedReaderOptions` | 上述选项加必需的同源 `frameUrl`、可选的 iframe 可访问名称 `label` |
| `reader.ready` | 首次可读时解析为 `{status:'ready'}`；就绪前销毁则为 `{status:'destroyed'}`；嵌入页面加载/协议失败会拒绝 |
| `reader.dispatch(command)` | 导航、focus、morph、step、search、up、back、overview、toggle-overview-map；iframe 未加载或已销毁时抛错，应先 await ready |
| `reader.destroy()` | 幂等；取消资源并恢复宿主原节点；重新挂载创建新阅读会话 |
| `reader.getState()` | 最近一次不可变语义状态：起始、活动或销毁；活动状态区分当前位置与前台请求目标 |
| `reader.subscribe(listener)` | 同步通知当前状态，然后通知语义变化；返回幂等取消函数，销毁时清理 |
| `reader.snapshot()` | 返回可 JSON 序列化的版本 1 快照；正文未完成、转场、错误或临时搜索结果等情况下返回 null |

`ready` 是一次性结果，不是持续状态订阅。内容源出错时，阅读器显示重试入口，ready 可能继续等待可读内容。文档入口的无效宿主/清单会同步抛错。handle 不暴露 Field、Scene 或内部可变状态。`.d.ts` 声明随产物提供，可在独立 TypeScript 消费者中使用。

## 显式保存并恢复

```js
const stop = reader.subscribe(state => {
  if (state.status === 'active') console.log(state.location, state.restoration);
});
const saved = reader.snapshot(); // 在消费者选择的时机调用，不自动保存
if (saved) {
  const portable = JSON.parse(JSON.stringify(saved));
  stop();
  reader.destroy();
  reader = mountEmbeddedReader(host, definition, { frameUrl, restore: portable });
}
```

快照只包含枢、章节、圆/线形态和唯一原文块锚点，不保存像素、历史或设置。恢复时使用对应的 definition；无效结构或未知章节在改动宿主前抛错。等待正文完整后匹配锚点，缺失/改写/重复则从章节开头读。ready 可能先于恢复完成；观察活动状态的 restoration：pending → matched/start/cancelled。用户开始新操作会取消待恢复位置，防止迟到跳转；重试保留待恢复意图。没有自动存储，也没有当前实例原地 restore 方法。完整契约见分发目录的 `reader-contract.md`。

## 接入自己的内容

普通静态内容优先使用 `content.js` 的 `buildStaticReader`。`custom-content.js` 已给出完整的两页正文及搜索枢示例，作者只维护普通数据：

```js
import { buildStaticReader } from './vendor/anallia/content.js';
const definition = buildStaticReader({
  entry: 'start', hubs: [{ id: 'NOTES', glyph: '记' }],
  chapters: [
    { id: 'start', hub: 'NOTES', title: '开始', body: '读{下一页|detail}。' },
    { id: 'detail', hub: 'NOTES', parent: 'start', title: '第二页', body: '同一份正文供圆线共享。' },
  ],
});
```

ID 必须显式、稳定；正文也可写为 `{circle, line}`。构建器提供可覆盖的坐标、主题等默认值，生成完整索引和一次 replace 的静态源。重复 ID、坏引用、错误归属或父链环路抛 `ContentBuildError`，其 issues 包含字段路径和正文行列。搜索入口需要作者显式声明搜索枢及根章节，不自动生成身份。完整字段、默认值和限制见分发目录 `static-content.md`。

下面是继续使用高级内容接入时的底层约定：

`manifest` 使用 format 1，包含枢 `definitions`、章节 `chapters` 和 `searchIndex`；`entry` 必须存在。每个枢需要 ID、显示符号、主题、中心坐标、角度、圆线形态和根章节。章节包含 ID、名称、标题、所属枢、父章节与引用；无父章节填 null。只做普通阅读时 searchIndex 可为空。

`source.open(chapterId, presentation, signal)` 返回 `AsyncIterable<{type:'append'|'replace', text:string}>`；presentation 是 circle 或 line。内容源应响应 signal 取消，异步迭代完成表示内容收齐。可以保留 builder 生成的清单与索引，替换 source 来提供分块或远程内容。

可选能力按数据声明：枢的 `kind: 'search' | 'settings'` 指定相应入口，每种最多一个；不依赖符号或 s0/q0 等 ID。检索应提供作者生成的完整 searchIndex；设置能力不会自动生成设置正文。章节的 `boundaryRoutes: {previous?, next?}` 指定同级步进到边界后的额外路径。未声明时使用通用导航规则。

## 已知限制

- 多实例通过独立**同源 iframe**实现；直接共享同一 DOM 的原生容器多实例不支持。
- 嵌入需要 HTTP(S) 的 frame 页面且允许被同源父页面加载；跨源、file:// 嵌入不支持。同源隔离用于样式和资源所有权，不是不可信代码的安全沙箱。
- 每个实例独立运行渲染器；没有大量实例的性能保证。父子文档不共享选区或 CSS。键盘遵循浏览器焦点，手机需要消费者提供方便的区域切换。
- 只读订阅和显式挂载恢复已提供；没有自动持久化、任意渲染插件、自动历史 URL 路由或 SSR。销毁/重建只有明确传入 restore 才恢复位置；历史、设置、全域相机和临时搜索结果不在快照范围内。
- 跨圆线表达改写或重复段落没有稳定语义 ID 时，保守恢复目标表达书签或开头；竖排表格使用窗口排版回退。
- 声明的类型覆盖现有接口；当前仍是内部验证阶段的 0.1 产物，不承诺稳定版本兼容。
