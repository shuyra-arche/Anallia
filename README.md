# Anallia

以枢组织内容，以空间表达关系，以动效解释变化。现有实现支持几何阅读、全域定位、圆线表达切换、异步内容和语义阅读位置恢复。

```sh
npm install
npm run dev -- --host 127.0.0.1
```

默认示例在 `/`；雨后观察手册在 `/?example=field-notebook`；同页并置示例在 `/dev/multi-reader.html`。

```sh
npm run check
npm test
npm run build          # 演示应用
npm run build:reader   # 可复制到独立消费者的浏览器 ESM 产物
npm run test:reader    # 回环地址上的独立消费者验证
```

[静态阅读器入门、公共接口和限制](examples/consumer/README.md) 包含两种挂载方式及完整消费者文件。`dist-reader/` 应整体分发；iframe 嵌入要求同源 HTTP(S)，文档入口每份文档只允许一个实例。两种入口均不暴露内部可变状态。

原单文档离线导出仍可用：`node tools/build-single-html.mjs`。尚未发布 npm 包或提供 SSR。

[阅读器语义契约](docs/reader-contract.md) 说明设计语言、状态所有权、只读订阅及显式快照恢复。恢复由挂载选项 `restore` 请求，不自动保存数据。

[静态内容入门](docs/static-content.md)：用 `buildStaticReader` 从稳定 ID、正文、父章节和显式引用生成清单、索引与静态内容源；无需手写底层 manifest。高级流式接口继续保留。
