# 实施共享契约

基线 1dc7d89。每个工作区只修改分配范围；禁止调用外部子代理、推送、删除工作区、修改用户配置。每个任务自行运行范围内测试，交付报告要区分实际结果与跨任务尚未整合的接口。

## 职责与兼容

内容任务拥有 src/content/、src/core/content.ts 和 tests/content*.test.ts；排版任务拥有 src/rendering/article.ts、新 src/rendering/text-layout.ts、src/rendering/reading-anchor.ts 和 tests/article*.test.ts。GPU 任务拥有 src/rendering/scene.ts、新 src/core/graphics.ts、src/rendering/graphics/、src/geometry/graphics.ts、tests/graphics*.test.ts。加载任务拥有 src/effects/loading.js、新 src/core/loading.ts、src/application/loading.ts、src/geometry/loading.ts、src/rendering/loading.ts 和 tests/loading*.test.ts。其他文件由协调者修改；需要新增共享字段请在交付中列出，勿直接改 src/core/types.ts。

## 内容任务对外接口

Presentation = 'circle' | 'line'。TextPatch = {type:'append'|'replace',text:string}。ContentSource.open(chapterId,presentation,signal): AsyncIterable<TextPatch>。ContentStore.start(id,presentation) 返回请求 {ready,done,cancel}；flush() 批量提交所有累计更新并返回变化快照；get(id,presentation) 返回 text/version/complete/status/error；cancel() 阻止迟到更新；source.open 正常结束表示完成，拒绝表示失败。ready 只表示首批有效文本已提交，排版就绪由协调者确认。空流仍要 resolve ready，done 拒绝必须可控不出现 unhandledRejection。

统一 parseContent(source, complete?) 输出 ContentDocument {blocks, references}；每个 block 具有 id/kind/sourceStart/sourceEnd/stable，kind 覆盖 paragraph/horizontal-list/vertical-list/icons。Inline 为 text 或 reference，保留 sourceStart/sourceEnd 和 target/text。不闭合引用按原始文字呈现，最终文本含义与原格式一致。请导出明确的类型，供 article.ts 使用。

Catalog 保留构造/get/chain/siblings/search 接口以兼容既有 tests；增加 document(id,presentation): ContentDocument、expressionVersion(id,presentation):number、updateExpression(id,presentation,text,complete):void。get().expressions 保持可读；q_hit 不复制正文，引用原文表达。初始正文按枢拆包，构建清单与搜索索引从同一作者数据生成；本地 ContentSource 实际按需读取。原测试导入 rawContent 和 hubDefinitions 的兼容出口保留。

## 排版任务对外接口

ArticleRenderer 构造(catalog,visuals) 不变。fillArticle(article,node,hub,presentation) 保持可用但改为 keyed 增量更新；增加 syncArticle 同签名。读取 catalog.document/expressionVersion；未合并内容任务时可用 parseContent 对 node.expressions 适配，不复制另一份语法解析器。使用 Pretext 稳定段落预计算，流式末段 DOM 测量；只批量改动变更节点，保留 selection/focus/IME。提供 reading-anchor 工具，源文本位置定位与恢复保持<=2 CSS px。字体变化独立失效缓存，正文保持原生DOM。

## GPU任务对外接口

Scene(host,catalog) / render(state) / destroy() / invalidateLayout() / readingBounds / actions / isAnimating 保持。可新增 initialize():Promise<void> 和 rendererKind。render 仍同步；initialize 选用 PixiJS8 WebGL，失败永久 SVG 回退，render 相同数值 SceneFrame。禁用 Pixi 自带ticker和事件命中。不能将现有SVG截图成纹理来冒充GPU迁移，也不能逐帧读取/解析SVG DOM路径。可在迁移期间保留SVG语义代理，但GPU可视内容需由数值几何构建。正文和按钮不搬到canvas。新增 hitTest(point) 返回 HitRegion，含 command/id/localScrollHub/graspKind 等必要语义；输入由协调者接入。SVG/GPU图层顺序、相机缩放及材料锚点必须一致。Scene 调用 articleRenderer.syncArticle；禁止通过读取隐藏SVG几何来构造SceneFrame。保留导出 renderSymbolGeometryToGroup 供旧测试。

## 加载任务对外接口

LoadController 只维护任务状态与动画姿态；start({id,scope,hubId,cancellable},now)、readable(id,now)、complete(id,now)、fail(id,error,now)、cancel(id,now)、update(now,reducedMotion) 返回 LoadingSnapshot|null。阶段包括等待/首次可读/持续接收/离场/错误/取消，150ms延迟、<=200ms离场；无任务不显示。不得控制相机、主题或内容。

保留 createLoading 旧接口测试兼容，但正式主流程将不再使用独立overlay。将 V24 数学函数提取为 evaluateLoadingGeometry(time,...) -> 数值图元，传到共享GPU/SVG后端；圆心/半径/圆弧/点列/透明度结构在新src/geometry/loading.ts公开，可由协调者适配。保留相切和主变换公式，退出需从当前姿态平滑结束。任务绝不因为一轮动画结束而标记成功。字体、主题、缩放由场景注入。
