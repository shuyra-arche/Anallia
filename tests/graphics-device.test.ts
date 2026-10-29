import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyGraphicsDevice,
  readGraphicsDevice,
} from "../src/rendering/graphics/device.ts";

test("only recognized software devices trigger software fallback", () => {
  for (const name of [
    "ANGLE (Google, SwiftShader Device (Subzero))",
    "llvmpipe (LLVM 19)",
    "Mesa lavapipe",
    "Microsoft Basic Render Driver",
  ])
    assert.equal(classifyGraphicsDevice(name).software, true);
  for (const name of [
    "ANGLE (NVIDIA GeForce RTX 4060)",
    "AMD Radeon RX 6800",
    "Apple M2",
    "Mesa Intel(R) UHD Graphics",
  ])
    assert.equal(classifyGraphicsDevice(name).software, false);
  for (const name of ["", "unknown", "WebKit WebGL", "WebGL 2.0"])
    assert.equal(classifyGraphicsDevice(name).software, null);
});

test("device probing uses its existing context and tolerates privacy restrictions", () => {
  let calls = 0;
  const context = {
    RENDERER: 10,
    getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 20 }),
    getParameter: (parameter: number) => {
      calls++;
      assert.equal(parameter, 20);
      return "SwiftShader";
    },
  };
  assert.equal(readGraphicsDevice(context as any).software, true);
  assert.equal(calls, 1);
  assert.equal(
    readGraphicsDevice({
      ...context,
      getExtension: () => null,
      getParameter: (parameter: number) => {
        assert.equal(parameter, 10);
        return "WebKit WebGL";
      },
    } as any).software,
    null,
  );
  assert.equal(
    readGraphicsDevice({
      ...context,
      getExtension: () => {
        throw new Error("private");
      },
    } as any).software,
    null,
  );
  assert.equal(readGraphicsDevice(null).software, null);
});
