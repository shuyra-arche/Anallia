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

## 2026-10-29 当前受限浏览器测量

源码 `ac56117`，Vite 开发模式，Chromium 156.0.8078.4 / Linux，1366×820，DPR 1，ANGLE SwiftShader Vulkan 软件 GPU。每次测量在 3GiB、无交换、CPU 150%、110 秒全进程组限制下串行执行；这些限制也影响软件栅格化，不能与上面的无限额历史基线直接比较。

| 后端 | 30 秒路线 rAF 间隔 P95 | Scene 提交 P95 | 十万字流间隔 P95 | 流式提交 P95 | 阅读漂移 |
| --- | ---: | ---: | ---: | ---: | ---: |
| SVG | 16.8ms | 3.4ms | 16.8ms | 3.2ms | 0px |
| 软件 WebGL（强制） | 200ms | 82.3ms | 200ms | 5.4ms | 0px |

SVG 路径在本次环境达到帧间隔 ≤20ms、流式提交 ≤4ms 的目标；软件 WebGL 未达到。两项测试通过表示内容完整、节点稳定、漂移及无页面异常检查通过，不能称软件 WebGL 性能验收通过。每篇 500 段、100000 个汉字及 998 个换行符；每次动画帧注入最多 1024 字符，不模拟打字延迟。提交统计包含内容 flush、文章同步、预排版与正文高度读取，不是整个浏览器绘制耗时。

原始逐帧 JSON 与日志位于仓库外 `work/refactor-20261029/performance-ac56117/`。随后 `auto` 会对明确识别到的软件渲染器选择 SVG，`renderer=gpu` 仍允许强制测试。未知设备信息不冒充硬件或软件判定。真实 GPU、真实移动设备与第二台局域网设备仍未验收；之后源码修改还需要最终重新测量。
