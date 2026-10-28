# Shuyra · Field v6

几何阅读网站，包含九个枢、递归章节、跨枢引用、实时检索、设置和 V24 加载动效。v6 以 Hub → SemanticAnchor → Attachment → Presentation 统一普通标签、局部导航和全局操作的附着关系。

## 运行

要求 Node.js 22.18+。

```sh
npm ci
npm run dev
```

验证和生产构建：

```sh
npm test
npm run build
npm run preview
```

`dist/` 可部署到静态网站托管平台。

## 操作

- 点击正文链接进入子章节或其他枢；滚轮和方向键切换同层章节。
- 点击当前标签或枢曲线切换圆／线形态，形变时保持聚焦材料点的屏幕位置和缩放比例。
- 触控抓住曲线或聚焦标签连续浏览章节，松手吸附；空白处拖动平移，双指捏合缩放。Alt/Ctrl/Command + 滚轮或 `+ / -` 也可缩放。
- 长文上滚动或触控拖动会沿阅读方向浮动正文；桌面鼠标仍可选择、复制文字。局部标签带可独立滚动。
- `↑` 返回上一级；`↶ / Escape` 历史返回；`⊙ / Home` 进入全域；`⌕` 检索；`⚙` 设置；`◌` 播放加载动效。
- 聚焦时全局操作位于当前枢曲线对侧；全域或缩放小于 0.45 时使用固定工具栏，`⌖` 回到当前焦点。
- 检索实时生成结果标签，结果可跳回原章节；返回历史同时恢复查询和结果。
- 设置提供景深、伴读、减缓动效、运动速率、帧率档位及恢复默认确认层。恢复默认时遵循当前系统减缓动效偏好。
- 加载动效中点击或按 Escape / 空格可结束并离场。

## 转场与布局

同枢同层切换使用 Traverse；层级内容替换在固定材料铰点执行 Page Flip；圆／线切换使用 Morph。跨枢根据显式父子关系和视口距离选择 Axis / Near / Flight / Remote。

枢的局部尺寸、标签、图标和正文保持屏幕像素尺寸，缩放改变枢之间的投影距离。正文保持材料附着位置，可延伸到视口外；长文通过正文浮动和视野平移阅读。v6 规则见 [语义附着模型](docs/attachment-model-v6.md)，v5 规则见 [局部导航与缩放](docs/interaction-grammar-v5.md)，转场规则见 [转场语法](docs/transition-grammar-v3.md)。v4 和更早文档用于记录此前方案，与当前实现冲突时以当前代码和上述文档为准。

## 修改入口

- 内容、枢定义及显式父子关系：`src/content/field.ts`；保持章节 ID 稳定，链接使用 `{显示文字|章节ID}`。
- 配色和排版：`src/styles.css`。
- 几何和投影：`src/geometry/`。
- 附着规划：`src/application/attachments.ts`；符号形变：`src/core/symbol-morph.ts`。
- 正文构建：`src/rendering/article.ts`；场景更新：`src/rendering/scene.ts`。
- 模块边界：[architecture.md](docs/architecture.md)；本次来源、修正与验证：[gemini-merge.md](docs/gemini-merge.md)。

正文由文本节点和按钮构建。目录检查重复 ID、无效引用、父子环和不连通章节；查询结果保存在各自阅读会话中。

## 独立演示

从当前源码生成模块预览和单文件网页：

```sh
node tools/build-preview.mjs
node tools/build-single-html.mjs
```

`preview/` 需通过本地静态文件服务访问；`demo.html` 可直接在浏览器打开。两者与 `dist/` 一样是生成产物，修改源码后需重新生成。

## 验证边界

严格 TypeScript 检查和 80 项测试覆盖几何、转场、导航、附着、符号形变、搜索、中文输入、正文 DOM、帧时钟及加载生命周期。真实浏览器已进行检索、设置子层和圆／线切换的基本交互检查；尚未完成移动端触控、逐帧视觉或性能验收。DOM 模拟不能验证真实字体、模糊成本或浏览器帧率。
