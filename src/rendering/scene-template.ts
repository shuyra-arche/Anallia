/** Document reader scaffold. IDs are document-scoped until embedded rendering is supported. */
export const sceneTemplate = `      <svg
        id="world"
        xmlns="http://www.w3.org/2000/svg"
        role="group"
        aria-label="Shuyra：几何阅读、流场与波动扰动"
        draggable="false"
      >
        <defs>
          <!-- 变换曲线扫过区域的精确拓扑裁剪路径 (支持 evenodd 内外翻转) -->
          <clipPath id="hubPortal" clipPathUnits="userSpaceOnUse">
            <path
              id="portalBoundaryPath"
              clip-rule="evenodd"
              fill-rule="evenodd"
              d="M0,0Z"
            />
          </clipPath>
        </defs>

        <rect
          id="baseBg"
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="#F5F6F2"
        />
        <!-- 随变换线条扫过区域实时变色的合成视口 -->
        <g id="portalViewport" clip-path="url(#hubPortal)" visibility="hidden">
          <rect
            id="portalBg"
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="#10191B"
          />
        </g>

        <!-- 世界坐标中的流场背景 -->
        <g id="gDecorations"></g>

        <g id="gGeometry"></g>
        <path id="portalStroke" d="" />
        <path id="portalEchoStroke" d="" />
        <g id="gLabels"></g>
      </svg>

      <div id="reading"></div>


      <!-- 唯一保留的左下角说明文字 -->
      <div id="descBar">
        曲线扫掠区域实时变色 · 单文本块缩放+高斯模糊沉浮（可在 ⚙
        设置枢调节显现范围） · 背景含水波涟漪圆枢与牛顿摆弦震动线枢
      </div>
`;
