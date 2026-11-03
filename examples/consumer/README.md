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
const reader = mountEmbeddedReader(host, createFieldNotebook(), {
  frameUrl: new URL('./vendor/anallia/reader-frame.html', document.baseURI),
  label: '雨后观察手册',
});
```

**独立文档**：加载 `vendor/anallia/styles.css`，提供当前文档唯一、已连接的 `<div id="scene"></div>`，再导入 `document.js` 的 `mountReader`。该入口拥有整份文档的主题、固定定位和快捷键，每份文档只允许一个实例。

```js
import { mountReader } from './vendor/anallia/document.js';
import { createGeometryReader } from './vendor/anallia/examples.js';
const reader = mountReader(document.querySelector('#scene'), createGeometryReader());
```

`examples.js` 是可选内容，不是核心运行时的前提。它提供已有的几何阅读和雨后手册两份 `ReaderDefinition`。

## 公共接口

| 接口 | 约定 |
| --- | --- |
| `ReaderDefinition` | `{ manifest, source, entry, title? }`；内容清单与异步内容源分开 |
| `ReaderOptions` | 可选 `chapter`、`morph`（0–1）、`theme`、`renderer`（auto/svg/webgl）、初始 `settings` |
| `EmbeddedReaderOptions` | 上述选项加必需的同源 `frameUrl`、可选的 iframe 可访问名称 `label` |
| `reader.ready` | 首次可读时解析为 `{status:'ready'}`；就绪前销毁则为 `{status:'destroyed'}`；嵌入页面加载/协议失败会拒绝 |
| `reader.dispatch(command)` | 导航、focus、morph、step、search、up、back、overview、toggle-overview-map；iframe 未加载或已销毁时抛错，应先 await ready |
| `reader.destroy()` | 幂等；取消资源并恢复宿主原节点；重新挂载创建新阅读会话 |

`ready` 是一次性结果，不是持续状态订阅。内容源出错时，阅读器显示重试入口，ready 可能继续等待可读内容。文档入口的无效宿主/清单会同步抛错。handle 不暴露 Field、Scene 或内部可变状态。`.d.ts` 声明随产物提供，可在独立 TypeScript 消费者中使用。

## 接入自己的内容

`manifest` 使用 format 1，包含枢 `definitions`、章节 `chapters` 和 `searchIndex`；`entry` 必须存在。每个枢需要 ID、显示符号、主题、中心坐标、角度、圆线形态和根章节。章节包含 ID、名称、标题、所属枢、父章节与引用；无父章节填 null。只做普通阅读时 searchIndex 可为空。

`source.open(chapterId, presentation, signal)` 返回 `AsyncIterable<{type:'append'|'replace', text:string}>`；presentation 是 circle 或 line。内容源应响应 signal 取消，异步迭代完成表示内容收齐。无需流式加载时，yield 一次 replace 即可。随示例提供的 `custom-content.js` 展示了一枢两章的完整最小定义，可直接替换工厂返回值。

可选能力按数据声明：枢的 `kind: 'search' | 'settings'` 指定相应入口，每种最多一个；不依赖符号或 s0/q0 等 ID。检索应提供作者生成的完整 searchIndex；设置能力不会自动生成设置正文。章节的 `boundaryRoutes: {previous?, next?}` 指定同级步进到边界后的额外路径。未声明时使用通用导航规则。

## 已知限制

- 多实例通过独立**同源 iframe**实现；直接共享同一 DOM 的原生容器多实例不支持。
- 嵌入需要 HTTP(S) 的 frame 页面且允许被同源父页面加载；跨源、file:// 嵌入不支持。同源隔离用于样式和资源所有权，不是不可信代码的安全沙箱。
- 每个实例独立运行渲染器；没有大量实例的性能保证。父子文档不共享选区或 CSS。键盘遵循浏览器焦点，手机需要消费者提供方便的区域切换。
- 没有公共状态订阅、持久阅读会话、任意渲染插件、自动历史 URL 路由或 SSR 接口。销毁/重建不会自动恢复之前的阅读位置。
- 跨圆线表达改写或重复段落没有稳定语义 ID 时，保守恢复目标表达书签或开头；竖排表格使用窗口排版回退。
- 声明的类型覆盖现有接口；当前仍是内部验证阶段的 0.1 产物，不承诺稳定版本兼容。
