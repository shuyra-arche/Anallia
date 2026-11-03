# 静态内容入口

`buildStaticReader(input)` 把普通作者数据转换成现有 `ReaderDefinition`：内容清单、全文索引和静态 `ContentSource`。它是无 DOM 的同步函数，可在应用初始化或构建脚本中调用；不会创建文件、分配章节 ID、发起请求或修改阅读器状态。输入可以来自普通 JS/TS 对象或解析后的 JSON，不需要新的 DSL。

仓库中从 `src/content-builder.ts` 导入；运行 `npm run build:reader` 后，独立消费者从整个分发目录中的 `content.js` 导入。

```js
import { buildStaticReader } from './vendor/anallia/content.js';
import { mountReader } from './vendor/anallia/document.js';

const definition = buildStaticReader({
  title: '两页笔记',
  entry: 'start',
  hubs: [{ id: 'NOTES', glyph: '记' }],
  chapters: [
    {
      id: 'start', hub: 'NOTES', title: '开始', name: '记₀',
      body: '从{下一页|detail}继续。',
      refs: [{ label: '→', target: 'detail' }],
    },
    {
      id: 'detail', hub: 'NOTES', parent: 'start', title: '第二页', name: '记₁',
      body: { circle: '圆态下的叙述。', line: '线态下可以换一种叙述。' },
    },
  ],
});
const reader = mountReader(document.querySelector('#scene'), definition);
```

文档入口仍需页面加载 `styles.css` 并提供唯一、已连接的 `#scene`；同页多实例把同样的 definition 交给 `mountEmbeddedReader`。完整可运行示例见 `examples/consumer/custom-content.js`，包含两页正文和作者显式声明的搜索枢。

## 作者需要写什么

| 数据 | 必填与默认 |
| --- | --- |
| 顶层 | `entry`、`hubs`、`chapters` 必填；`title` 可选 |
| 枢 | 稳定 `id` 必填；`root` 默认该枢唯一的无父章节，不能有多个断开的根 |
| 章节 | 稳定 `id`、`hub`、`title`、`body` 必填；`parent` 省略/null 表示根，子章节显式指定 parent |
| 正文 | 字符串表示圆线共享；对象必须同时给出 `circle` 和 `line`。空正文允许 |
| 标签 | 枢 `glyph` 默认 ID 首字母；章节 `name` 默认 ID。建议为较长 ID 提供短标签 |
| 引用 | 正文沿用 `{显示文字|目标章节ID}`；几何引用用 `refs: [{label, target}]`，目标必须是章节 |
| 顺序 | chapters 数组顺序控制同级顺序；调整顺序不更改 ID，不重新编号 |

章 ID 在一份内容中全局唯一，枢 ID 在枢列表中唯一，两者是不同命名空间。本入口要求 ID 以 ASCII 字母开头，其余为字母、数字、下划线或连字符；保留 `q_hit_` 前缀及对象原型名称。作者自行提供和维护 ID，不能用数组下标重新生成它们。

## 默认布局和可覆盖项

默认使用圆态、window 阅读排版、parchment 主题、0° 角度。自动坐标按枢 ID 排序后放入规则网格，横向间距 1800、纵向间距 1600；列数为枢数平方根向上取整。重排输入数组不改变默认位置；增删枢可能重排网格，要固定布局就显式提供 center。

每个枢可覆盖 `glyph`、`root`、`theme`、`center: {x,y}`、`angle`、`presentation: 'circle'|'line'`、`readingLayoutMode: 'window'|'geometric'`、`parentHub`、`layout: 'anchored'`。主题值沿用现有 Theme 类型；坐标和角度必须是有限数。parentHub 只声明枢关系，不表示自动嵌套或自动排版。

章节可声明 `boundaryRoutes: {previous?, next?}`，只在同级步进到边界后生效，目标必须存在。正文、引用和这些选项都转换为既有字段，不新增导航、动效或相机语义。

## 搜索、设置与正文格式

- 索引由全部作者正文生成，无需手写。要显示搜索入口，显式增加 `kind: 'search'` 的枢和它的根章节；可用 `recommendations: ['chapter-id']` 指定空查询时展示的外枢章节。搜索枢默认 anchored，最多一个。
- 搜索仍使用原有普通文本匹配和作者顺序，最多返回 8 项；搜索枢自己的章节不进入结果。没有新增排序、分词或检索服务。
- `kind: 'settings'` 也最多一个，但不会自动生成设置正文。正文引用可以指向已支持的内置动作，例如 `{声音|act:toggle_sound}`；未知动作会报错。几何 refs 和边界路径不接受动作目标。
- 段落、`[hlist]`、`[vlist]`、`[icons]` 沿用现有解析器。不是 Markdown/HTML 编译器，不改写正文；未被现有引用语法识别的花括号仍是普通文本。诊断仅针对实际解析出的引用。
- 稳定章节 ID 不等于稳定段落 ID。显式会话恢复仍按唯一原文块匹配；改写或重复段落按既有规则回到开头，不按章节编号或像素猜测位置。

## 校验和错误定位

```js
import { buildStaticReader, ContentBuildError } from './vendor/anallia/content.js';
try {
  const definition = buildStaticReader(authorData);
} catch (error) {
  if (!(error instanceof ContentBuildError)) throw error;
  for (const issue of error.issues) {
    console.error(issue.code, issue.path, issue.line, issue.column, issue.message);
  }
}
```

校验重复 ID、保留 ID、缺失/错误字段、未知入口与目标、错误枢归属、跨枢父章节、断开的根、章节父链与 parentHub 环路、重复工具能力及无效推荐项。引用之间的回链允许存在，它们不是父子层级环路。先检查形状，再检查图关系；有错误不返回半成品。

路径如 `chapters[3].parent` 或 `hubs[1].root`。正文错误另外提供表达路径与从 1 开始的行/列，例如 `chapters[3].body.line:2:6`；位置针对正文字符串，列按 UTF-16 计数，不伪装成作者文件的源代码行号。issues 为只读列表，可直接显示给作者。

## 静态与流式边界

生成的源每次 open 只 yield 一次 `replace`，然后完成；开始前已取消的请求不发布内容。正文在内存中，不进行分块、懒加载、磁盘写入或网络请求。构建会复制所需作者数据，之后修改输入对象不会偷偷改变已经生成的正文。

高级接口不变：仍可自行实现 `ContentSource.open(chapterId, presentation, signal)`，或者把生成 definition 的 source 替换成已有分块/远程源。后续动态内容由该源负责，静态构建校验不代替流式更新的维护责任。

手册的 `createStaticFieldNotebook()` 使用这个静态源；原 `createFieldNotebook()` 共用同一份生成清单和索引，再使用原来的 96 字符分块源。原大型几何演示的生成管线没有重写。独立消费者页面的手册已使用静态版本。

验证：`tests/content-builder.test.ts`、`tests/browser/content-builder.spec.ts` 和 `npm run test:reader`，涵盖两页内容、15 章/5 层手册、搜索、错误定位、输入重排和快照恢复；高级分块源的原有测试继续保留。
