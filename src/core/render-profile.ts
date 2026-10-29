import type { ResolvedRendererKind } from "./graphics.ts";

export type RenderStage =
  | "scene.prepare" | "scene.geometry" | "scene.host" | "scene.reading"
  | "reading.sync" | "reading.pretext" | "reading.measure" | "reading.place" | "reading.anchor"
  | "scene.labels" | "scene.compose" | "scene.background" | "backend.resize"
  | "gpu.prepare" | "gpu.geometry" | "gpu.background" | "gpu.labels"
  | "gpu.finalize" | "gpu.submit" | "svg.render";

export interface RenderSample {
  renderer: ResolvedRendererKind;
  path: "full" | "cached";
  total: number;
  stages: Partial<Record<RenderStage, number>>;
}

export type RenderProfileSink = (sample: RenderSample) => void;

/** Exclusive synchronous wall times in milliseconds; GPU execution is asynchronous. */
export class RenderProfiler {
  private started = 0;
  private previous = 0;
  private stages: RenderSample["stages"] = {};

  private readonly collect: RenderProfileSink;
  private readonly now: () => number;

  constructor(collect: RenderProfileSink, now: () => number) {
    this.collect = collect;
    this.now = now;
  }

  begin(): void {
    this.started = this.previous = this.now();
    this.stages = {};
  }

  mark(stage: RenderStage): void {
    const at = this.now();
    this.stages[stage] = (this.stages[stage] ?? 0) + at - this.previous;
    this.previous = at;
  }

  finish(renderer: ResolvedRendererKind, path: RenderSample["path"]): void {
    this.collect({ renderer, path, total: this.previous - this.started, stages: this.stages });
  }
}
