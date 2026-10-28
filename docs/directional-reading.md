# 方向与阅读支点

进入枢时，以来源枢中心指向目标枢的来向确定阅读侧；从全域进入时使用进入前镜头的位置。目标枢的焦点外法向朝向来源侧，并保留进入前镜头的坐标朝向。线枢因此可呈倾斜或水平方向；进入后滚动不重新推断来向。历史返回恢复倾角、阅读方位、路径及镜头。

正文保持正向，不沿圆弧弯曲，也不随镜头旋转字形。布局根据投影后的曲线外法向连续安排阅读窗口，使整个窗口处于该点切线的外侧半平面。屏幕边缘不反转展开侧；必要时移动镜头。圆在正文上方时，正文位于其外侧下方，反向亦然。经过顶部和底部时连续换边。

圆态切换普通标签时，各标签依次经过固定的阅读支点，保留用户倍率。外法向随章节进度有限变化，最大偏移 32 度，圆心因此可移动；这是阅读状态下的支点约束。直接抓住圆弧或普通标签时仍保持圆心投影，松手后进入阅读支点。全域保持观察布局，不应用阅读支点。线态滚动保留镜头和导轨倾角，章节沿轴移动。

键鼠可通过 `Alt + 滚轮` 围绕当前阅读锚点手动旋转摄像机；触控可通过双指捏合同时围绕双指中心缩放与旋转摄像机。手动旋转后，正文仍保持正向，且新的阅读方位角（`readingBearing`）在后续滚动切换同枢章节与圆线变形时予以保留。

阅读窗口根据视口尺寸、缩放倍率与外法向垂直分量控制行宽与窗口高度，避免超长行与超长文本失衡；长文继续通过滚轮或触控浮动，无独立滚动条。为防止长文与枢重叠，窗口仅在朝向枢切线的单侧边界（枢在上方时为上边界，枢在下方时为下边界）执行截断，并附带平滑渐变遮罩过渡；背离枢的另一侧保持开放。自动导航、章节切换、变形和调整窗口后，实际测量完成且运动结束时，镜头只做一次必要的平滑平移，尽量将阅读窗口放入屏幕。手动平移、缩放或旋转会取消当前自动避让；下一次导航重新启用。

普通标签材料位置只取决于章节序号、章节进度与枢形态，不受局部引用的数量、显隐、翻页或滚动影响。聚焦引线长度随章节进度平滑变化。局部标签沿普通序列后续方向使用已有间隙，超出容量时只在局部标签带内滚动。


## Perception, Focus & Immersion (感知、焦点与沉浸)
- **Relational Focus (`src/core/perception.ts`)**: Hubs dynamically organize into four continuous perceptual tiers based on semantic relations rather than fixed screen coordinates: `focused` (current reading anchor), `resonating` (actively hovered/previewed target or linked reference), `related` (hubs connected via `refs`, `parentHub`, or active chapter inline links), and `ambient` (background structure). Hovering or focusing an inline `[data-ref-id]` button or local hub tag cross-highlights the corresponding hub and tag in the field.
- **Natural Cognitive Opening**: Discovery progresses naturally through `threshold` (initial arrival at `a0` before any navigation, where non-essential global operations stay quiet unless hovered), `orienting` (first local steps/morphs), and `immersed` (cross-hub or multi-step exploration), paired with self-explanatory opening prose on `a0`.
- **Geometric Soundscape (`src/effects/sound.ts`)**: Procedural Web Audio synthesis maps Möbius circle↔line morph progress (`m`), page-turn angle (`contentTurn`), chapter steps, cross-hub passages, and manual camera rotation continuously to harmonic intervals, filter cutoff, overtone mix, and stereo pan, with a hub-native sound toggle (`act:toggle_sound`) in `L`.
