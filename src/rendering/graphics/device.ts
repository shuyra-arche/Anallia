export interface GraphicsDevice {
  renderer: string;
  /** null means the browser did not expose enough information to classify it. */
  software: boolean | null;
}

export function classifyGraphicsDevice(renderer: string): GraphicsDevice {
  const name = renderer.trim();
  if (!name || /^(unknown|WebKit WebGL|WebGL(?: 2\.0)?)$/i.test(name))
    return { renderer: name || "unknown", software: null };
  return {
    renderer: name,
    software:
      /SwiftShader|llvmpipe|softpipe|lavapipe|software rasterizer|Microsoft Basic Render/i.test(
        name,
      ),
  };
}

/** Read the existing rendering context; never create another canvas or context. */
export function readGraphicsDevice(
  gl: WebGLRenderingContext | WebGL2RenderingContext | null,
): GraphicsDevice {
  if (!gl) return classifyGraphicsDevice("");
  try {
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) ?? "",
    );
    return classifyGraphicsDevice(renderer);
  } catch {
    return classifyGraphicsDevice("");
  }
}
