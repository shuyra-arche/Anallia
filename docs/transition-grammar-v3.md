> 当前换色规则：遮罩由源、目标底色是否变化决定，与 Near / Flight / Remote / Axis 距离路由独立。同底色无换色遮罩或枢折叠；不同底色保留扫掠，历史返回使用相同条件。下表中的原遮罩限制以此规则为准。

# Shuyra Field · Transition Grammar v3

## 单一语义入口

**一个动作不应自动启动与它无关的动效。** 由不同状态管理不同类型转场：

| 变化 | 状态机 | 表现 | 不做什么 |
|---|---|---|---|
| 同一枢的内容层级替换，例如 ⚙₀→⚙₁ | `contentTurn` | 页片绕枢上的材料点翻出、隐藏背面、换内容、翻入 | 不改 `morph`、`fold`、相机，不开遮罩 |
| 同层不同章节 | `scrollTarget` | 圆态沿圆周、直态沿线条移动 | 不翻页，不做 Möbius |
| 圆态 ↔ 直态 | `morphTurn` | 连续的 Möbius 曲线变形；内容仍跟随材料点 | 不因为形态变化自动替换文字/标签 |
| 跨枢近距 | `passage.kind="near"` | 普通镜头平移 | 不开遮罩，不翻页 |
| 跨枢中距 | `passage.kind="flight"` | 拉远—空间位移—聚焦 | 不开遮罩，不翻页 |
| 跨枢远距 | `passage.kind="remote"` | 镜头航行 + Möbius 局部空间折叠 | 不翻页 |
| 显式父子枢 | `passage.kind="axis"` | 以枢间轴线的法向偏移与角度组成 2.5D 旋转感 | 不默认使用 Möbius |
| Loading | `passage.kind="loading"` + V24 loader | 保留原 Loading 独立动画 | 不翻页 |

## 具体执行规则

### Content page-turn

- `⚙₀ → ⚙₁` 首先决定新旧选中章节的**材料坐标** `s`，而不是根据 DOM 位置转动。`keepContentAnchor()` 在 50% 内容不可见阶段调整新层级的 `anchorOffset`，使选中锚点在世界空间中维持原位。
- 正文的 CSS 翻页与 SVG 标签的法线投影由 `pageTurnPose()` 驱动。语义在 180° 不可见背面时提交。
- `pageTurnPose()` 在 90–270° 的背面关闭文字可读性，杜绝 180° 的镜像字重新显现。
- 前进正向 360°，历史返回反向 360°。不改变 `morph`、`fold` 和相机，也不触发 Portal。
- 不同锚点的同级切换仍为 Traverse。

### Spatial navigation

1. `parentHub` 明确指定父子枢关系，优先使用 Axis；**不能根据距离猜测亲缘关系**。当前演示数据没有声明跨枢的父子关系，因此 Axis 路由在未来具有元数据时才实际可触发。
2. 其他跨枢先计算相对当前视口的距离 `d = zoom * |p_target - p_source| / hypot(viewport.width, viewport.height)`。
3. `d < 1.5` 使用 Near，`1.5 <= d < 6` 使用 Flight，`d >= 6` 使用 Remote。阈值在 `core/transitions.ts` 中，选择后整个过场冻结类型。
4. 只有 Remote 和 Loading 会显示门户几何；近、中、轴旋转均禁用 Portal。
5. Remote 的 SVG 曲线在**固定视口的 1:1 坐标图**中评估，不引用运动相机、枢心插值或任何世界参考，因此不会出现旧版那种遮罩随着相机漂浮的现象。

### 独立时钟 / 队列

- `contentTurn`、`morphTurn`、`passage` 分别编码，不再相互误用。
- 当前交互策略仍采用 last-intent-wins：如果一次导航进行中又收到新操作，则在结算后执行最后一次意图；这避免几何状态在半程被重写。
- 渲染层只在 `contentTurn` 存在时调用 `pageTurnPose()`；`morphTurn` 仅触发文字在形态交界时短暂不可读。
- 允许未来以显式复合指令编排不同层，但**目前不允许用户输入在半程强行启动另一场导航**。

## 已验证和限制

- 纯状态/几何自动化测试覆盖内容锚点恒定、反向、两种几何形态、三段距离、父子元数据优先、远距遮罩屏幕参考系恒定、输入队列、低动态模式。
- 核心 TypeScript 类型检查通过。
- 当前运行环境 Chromium 禁止访问本地 HTML/localhost，DOM 测试依赖也无法从离线 npm 缓存安装。因此**没有声称完成逐帧浏览器视觉验收**；运行界面的阴影/透视/命中热区仍需要在可用浏览器中目视检查。
- 移动端旧有的文字越界问题不属于本轮转场范围，尚未解决。
