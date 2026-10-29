# 性能修复记录

2026-10-27：处理阅读画面卡顿和持续高 CPU。

- 静止场景按显示状态跳过重绘，背景时间变化不触发正文和导航更新。
- 文字高度按章节、表达形式和宽度缓存；字体准备完成后失效缓存。
- 去掉覆盖世界空间的大范围 SVG 模糊滤镜；正文过场仍保留局部景深，稳定时使用 `filter: none`。
- 流线从 63 条调整为 35 条。平时每 400ms 重采样，波扰动期间每 125ms 重采样；示踪点单独更新。
- 默认的省电自适应档在静止阅读时最多 24 次更新/秒，交互动画最多 60 次更新/秒，不跟随高刷新率屏幕无限增大工作量。页面隐藏时取消帧循环，回来后恢复。
- 镜头和滚动插值收敛后停止跟随，避免无限逼近导致永久重绘。

## 相同 DOM 模拟检查的前后结果

使用 Node.js + happy-dom，在同一视口下重复更新 120 次。时间为单次样本，用于定位代码开销；不包含浏览器绘制、合成、GPU 和真实 CPU 使用率。

| 检查              | 修复前 | 修复后 |
| ----------------- | -----: | -----: |
| 静止场景 DOM 改动 | 28,680 |      0 |
| 静止场景循环耗时  | 98.8ms | 0.16ms |
| 背景循环耗时      | 78.6ms | 25.4ms |

回归测试覆盖静态零写入、背景路径更新预算、高刷新率帧率上限、后台暂停和动画完全收敛。实际 CPU 降幅和视觉流畅度仍需在用户浏览器中确认。

设置枢的「帧率与显示」可选择省电自适应、30 / 60 / 90 / 120 FPS 或跟随屏幕刷新率。最高档不额外限制浏览器帧回调，波场仍独立限频采样；更高帧率会增加工作量。模拟 240Hz 回调的测试验证最高档会逐帧更新，这不是实际显示器帧率测量。

## 2026-10-29 重构基线

基线提交为 `79d7c5d`，Chromium 156、Linux、1366×820、DPR 1。自动化环境报告 ANGLE / SwiftShader Vulkan 软件 GPU，不能作为真实显卡性能验收。

在 m3 阅读页面连续圆线变形 30 秒：rAF 间隔 P95 16.7ms、Field 更新 P95 0.1ms、Scene 更新 P95 1.2ms，未记录到长任务。rAF 间隔不等于完成绘制帧率；这些数值只用于同环境回归对照。

原始数据与 a0/m3 截图保存在工作目录 `work/refactor-20261029/`。真实移动设备触控、第二设备局域网与真实 GPU 性能需要单独验收。

## Test resource limits

`npm test` runs files serially in an independent Linux user-systemd unit with a 1 GiB process-group memory cap, no swap, a 256 MiB JavaScript heap per process, a 15 second test timeout and a 120 second hard wall-clock limit. Core dumps are disabled. The runner refuses to start without the user systemd bus. A test failure involving DOM objects can make assertion formatting expensive; use boolean identity assertions for DOM identity checks. These limits protect the desktop while reporting a failed run; they do not replace fixing the cause.

Browser checks use `npm run test:browser`: one worker, a 3 GiB process-group cap, no swap, 150% CPU quota and a 110 second hard limit. These checks establish behavior, not timing targets. GitHub Pages uses serial tests in its isolated job, with a 256 MiB JavaScript heap and a three minute step timeout, because that runner has no desktop user-systemd session.

## 2026-10-29 相机复用检查点测量（历史）

源码 `ac56117`，Vite 开发模式，Chromium 156.0.8078.4 / Linux，1366×820，DPR 1，ANGLE SwiftShader Vulkan 软件 GPU。每次测量在 3GiB、无交换、CPU 150%、110 秒全进程组限制下串行执行；这些限制也影响软件栅格化，不能与上面的无限额历史基线直接比较。

| 后端 | 30 秒路线 rAF 间隔 P95 | Scene 提交 P95 | 十万字流间隔 P95 | 流式提交 P95 | 阅读漂移 |
| --- | ---: | ---: | ---: | ---: | ---: |
| SVG | 16.8ms | 3.4ms | 16.8ms | 3.2ms | 0px |
| 软件 WebGL（强制） | 200ms | 82.3ms | 200ms | 5.4ms | 0px |

SVG 路径在本次环境达到帧间隔 ≤20ms、流式提交 ≤4ms 的目标；软件 WebGL 未达到。两项测试通过表示内容完整、节点稳定、漂移及无页面异常检查通过，不能称软件 WebGL 性能验收通过。每篇 500 段、100000 个汉字及 998 个换行符；每次动画帧注入最多 1024 字符，不模拟打字延迟。提交统计包含内容 flush、文章同步、预排版与正文高度读取，不是整个浏览器绘制耗时。

原始逐帧 JSON 与日志位于仓库外 `work/refactor-20261029/performance-ac56117/`。随后 `auto` 会对明确识别到的软件渲染器选择 SVG，`renderer=gpu` 仍允许强制测试。未知设备信息不冒充硬件或软件判定。真实 GPU、真实移动设备与第二台局域网设备仍未验收；之后源码修改还需要最终重新测量。

## 2026-10-29 最终源码测量

验证提交 `75886f1`，运行时源码 `1087ee7`。仍使用 Chromium 156.0.8078.4 / Linux、1366×820、DPR 1、ANGLE SwiftShader Vulkan，Vite 开发模式；单工作者、3GiB、禁用交换、CPU 150%、110 秒整组时限。默认和强制 GPU 串行测量，环境中没有 `/dev/dri`，不代表真实硬件 GPU 性能。

| 请求 / 实际后端 | 30 秒路线 rAF 间隔 P95 | Scene 提交 P95 | 十万字流间隔 P95 | 流式提交 P95 | 阅读漂移 |
| --- | ---: | ---: | ---: | ---: | ---: |
| auto / SVG | 16.8ms | 3.6ms | 16.8ms | 3.2ms | 0px |
| gpu / 软件 WebGL | 200ms | 85.5ms | 200ms | 3.5ms | 0px |

默认路径达到本次 ≤20ms / ≤4ms 目标；强制软件 WebGL 的帧间隔未达到目标。两项功能检查都完整接收 100000 个汉字加 998 个换行符，均提交 100 批、稳定文字节点仍连接、没有页面异常。统计方法与上述检查点相同，流式提交只计内容发布、文章同步、预排版及正文高度读取，rAF 间隔也不等于完成绘制帧率。

原始 JSON、日志、浏览器身份及资源范围保存在 `/home/anreonyr/Documents/shuyra/work/refactor-20261029/final-75886f1/browser-performance/` 和同目录的 `browser-performance.log`、`manifest.json`。正式默认 auto 尝试 WebGL，明确识别软件设备后在本会话保持 SVG；初始化失败或上下文丢失同样回退。保留强制 GPU 参数用于对照。真实硬件 GPU、第二台局域网设备及真实手机仍待验收。

## 2026-10-29 RTX 5070 Ti 分段观测

在 `23b41ac` 上增加默认关闭的计时探针后，以可见 Chromium 156、ANGLE / NVIDIA GeForce RTX 5070 Ti Laptop GPU / OpenGL ES 3.2 实测，`softwareGpu=false`。1366×820、DPR 1、Vite 开发模式；仍采用 3GiB、无交换、CPU 150%、110 秒整组限制，一个工作者串行运行 SVG / GPU。来源快照、SHA-256、原始数据及日志保存在仓库外 `/home/anreonyr/Documents/shuyra/work/refactor-20261029/render-profiling-20261029/`。用户之前的硬件数据也已保存在 `before-render-profiling/`，没有覆盖。

| 后端 | 路线 rAF 间隔 P95 | Scene 提交 P95 | 流式提交 P95 | 阅读漂移 |
| --- | ---: | ---: | ---: | ---: |
| SVG | 5.4ms | 3.3ms | 3.1ms | 0px |
| 硬件 WebGL | 16.7ms | 8.8ms | 3.2ms | 0px |

两条路径均达到本次 ≤20ms / ≤4ms 目标，十万字完整接收，稳定节点保留；流式提交均为 100 批。rAF 观察者记录 SVG / GPU 分别为 6820 / 2373 次，而实际 Scene 调用分别为 1801 / 1799 次（约 60 次/秒）。rAF 观察频率不等于应用更新或完成绘制的帧率。本次与用户此前的 16.7ms / 8.3ms 顺序不同，不能以单次 rAF 差异认定稳定两倍加速。

以下占比按所有对应 Scene 调用的阶段耗时之和 / 场景总耗时之和计算；阶段 P95 只取执行该阶段的帧。不同阶段的 P95 不能相加。

| GPU 测试阶段 | 同步耗时 P95 | 对应场景总耗时占比 |
| --- | ---: | ---: |
| 路线：`gpu.submit` | 6.0ms | 62.4% |
| 路线：`scene.reading` | 1.2ms | 11.2% |
| 路线：`gpu.geometry` | 0.9ms | 9.4% |
| 流式：`scene.reading` | 3.0ms | 57.3% |
| 流式：`gpu.submit` | 0.5ms | 11.8% |

路线中的完整 Scene 更新 973 次、缓存帧 826 次；完整帧的 `gpu.submit` P95 为 6.1ms。它测量 `Pixi renderer.render(stage)` 的同步墙钟时间，包含 Pixi 在此调用中执行的变换、批处理、几何/纹理准备及可能的驱动等待，不是 GPU 着色器实际执行时间。最慢路线帧为 24.9ms，其中提交调用 21.9ms；下一步需在该调用内部做 CPU/驱动跟踪才能继续归因，不能把全部耗时直接归为显卡计算。

### 使用计时报告

```sh
SHUYRA_PERF=1 npm run test:browser -- tests/browser/performance.spec.ts --headed --grep='(svg|gpu)'
```

测试自动启用并关闭 `scene.setRenderProfiler`，正常运行没有计时采样或记录数组。每阶段最多保留 10000 帧，超出会使测试失败；`test-results/` 的 JSON 包含 `profileVersion: 1`、`route.profile`、`stream.profile`、`raw.routeProfiles` 和 `raw.streamProfiles`，下次浏览器运行前需备份。

- `profile.stages`：各阶段执行样本数、P95、均值和耗时占比；终端使用这份紧凑汇总。
- `profile.full` / `profile.cached`：完整更新与缓存帧分别统计，避免把缓存跳过误当成更新加速。
- `profile.slowFrames`：耗时最高的五帧及其分段；`raw` 保留全部采样。
- `scene.prepare/geometry/host/reading/labels/compose/background`：缓存判断、数值场景、宿主 DOM、正文同步/测量、语义标签、加载组合和背景计算。
- `gpu.prepare/geometry/background/labels/finalize/submit`：Pixi 池与样式准备、图元/过场/信标、背景、标签及文字缓存、图层排序、最终提交调用；`backend.resize` 计尺寸检查，`svg.render` 计 SVG 后端。

每一帧的分段互不重叠，总和等于该帧采样总耗时；正文层内含同步、Pretext 和 DOM 尺寸读取，内容 flush 及阅读会话的帧后处理在 Scene 外，继续由原 `stream.commitP95` 按原范围统计。新探针有时间读取和记录开销，采样总时长不含收集回调。两项后端浏览器测试覆盖完整/缓存/仅背景更新，关闭后不再采样；256 项单元测试、3 项原交互定向回归及普通构建通过。此轮没有重新验收另外三种导出形式。

## 2026-10-29 默认 SVG 与屏外虚线优化

以 `55b3d51` 为基线继续检查 Pixi 提交。CPU 采样指向 `buildContextBatches → buildLine → round`；逐图元诊断发现，关联虚线单条最高约 1.6 万顶点，大量圆头和圆角网格位于屏幕外。GPU 现在按源路径完整弧长推进虚线相位，只生成扩展视口内的子路径。描边外扩保留边缘，跨顶点的可见虚线保持连接；裁切网格不使用旧相机仿射复用，视口改变时也重新构建。

本轮保持正常界面与 Scene API 默认 SVG；`renderer=gpu` 和 `renderer=auto` 是显式选择。下列 RTX 5070 Ti 对照仍使用相同 Vite 路线、1366×820、DPR 1、可见 Chromium 156、3GiB / CPU 150% / 110s 限制，不启用 CPU 采样。旧 GPU 数值来自前一节 `55b3d51` 的同环境测量；这是一次本机阶段对照，不是所有硬件上的固定收益。

| 指标 | 原 GPU | 优化后 GPU | 同期 SVG |
| --- | ---: | ---: | ---: |
| 路线 Scene 提交 P95 | 8.8ms | 5.0ms | 3.4ms |
| 路线 GPU 最终提交调用 P95 | 6.0ms | 1.8ms | — |
| 路线 rAF 间隔 P95 | 16.7ms | 4.3ms | 4.3ms |
| 流式提交 P95 | 3.2ms | 3.7ms | 2.9ms |
| 阅读漂移 | 0px | 0px | 0px |

GPU 自身的 Scene 同步耗时约下降 43%，提交调用约下降 70%；本次仍高于 SVG，不能称为已经快于 SVG。优化后的两个后端实际 Scene 调用约 60 次/秒。流式阶段 GPU / SVG 分别合并为 27 / 25 次正文提交，原 GPU 为 100 次；由于每次提交的内容量不同，不能用这些流式 P95 推断相同包大小下的加速或退化。两组都完成 100000 个汉字和 998 个换行，稳定节点保留、漂移 0px。

独立 CPU 诊断在相同 1ms 采样间隔下复核：`buildContextBatches` 包含时间合计约 3.40s → 1.12s，`buildLine` 约 1.99s → 0.40s，`round` 约 1.34s → 0.16s。函数之间嵌套，不能相加；这些是约 33 秒测试内的采样归因，含测量开销，不替代上述无 CPU 采样的性能对照。逐图元诊断的关联线最大顶点数降为 4270；冷启动诊断不作为帧时间验收。

CPU 诊断命令仅运行一组 GPU，默认关闭：

```sh
SHUYRA_PERF=1 SHUYRA_CPU_PROFILE=1 npm run test:browser -- tests/browser/performance.spec.ts --headed --grep='performance \(gpu\)'
```

它从页面就绪后开始采样，结束时写出 `cpu-gpu.cpuprofile`；JSON 的 `cpuSampling` 标记区分诊断与普通对照。原始 CPU 文件、前后性能 JSON、网格诊断、源码快照、日志和四种产物备份在 `/home/anreonyr/Documents/shuyra/work/refactor-20261029/gpu-submit-optimization-20261029/`。

最终源码通过类型检查和 260 项单元测试；可见浏览器 33 项开发回归与 4 项当前发布产物检查全部通过。新增用例把裁切路径与完整路径直接做 GPU 像素比较，同时检查网格减少、平移后不复用过期裁切、视口扩大时重新构建。普通、Pages、模块预览及离线单文件均已重建并实际打开；原局域网/HMR和触控模拟仍通过，实体第二设备与移动端未验收。
