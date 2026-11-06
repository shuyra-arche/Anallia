# Anallia

Anallia 是 Shuyra 的浏览器几何阅读框架：以枢组织内容，以空间表达关系，
以动效解释变化。支持圆线表达切换、异步内容和显式语义阅读位置恢复。

## 开发与验证

使用 Node.js 24 和 npm；依赖版本由 `package-lock.json` 固定。
`npm test` 和浏览器检查需要 Linux systemd 用户会话，以施加进程组资源限制。

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

```sh
npm run check          # 内容清单与 TypeScript
npm test               # 宿主测试
npm run build          # 演示应用
npm run build:reader   # 独立消费者的浏览器 ESM 产物
npm run test:reader    # 构建后在回环地址验证独立消费者
npm run test:browser   # 浏览器交互回归，需 Playwright 浏览器环境
```

首页 `/` 是空间读本「潮汐之间」。声音默认关闭，支持系统减少动效。
`/dev/legacy.html` 与 `/dev/multi-reader.html` 保留开发回归入口。
生产 Pages 构建使用 `npm run build:pages`，单文件导出使用
`node tools/build-single-html.mjs`。

## 代码与接口

- `src/reader.ts`：阅读器入口；状态契约见[阅读器语义契约](docs/reader-contract.md)。
- `src/content-builder.ts`：作者数据转换；见[静态内容接口](docs/static-content.md)。
- `src/examples/`：内容与演示定义；`src/demos/`：作品外壳与表现。
- `tests/`、`tests/browser/`：宿主与浏览器回归；`tools/`：构建和验证入口。
- [独立消费者示例](examples/consumer/README.md)：文档与 iframe 两种挂载方式。
- [作品交互约束](docs/tide-atlas.md)：枢内导航、标签和转场的所有权。

`dist-reader/` 必须整体分发。iframe 嵌入要求同源 HTTP(S)；文档入口
每份文档只允许一个实例。接口不暴露内部可变状态。快照恢复通过挂载选项
`restore` 请求，不自动保存数据。尚未发布 npm 包，不支持 SSR。

[Shuyra 共同贡献与维护规范](https://github.com/shuyra-arche/vanllia/blob/main/CONTRIBUTING.md)。
