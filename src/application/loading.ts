import type { Theme, Vec } from "../core/types.ts";
import {
  LoadController,
  type LoadingSnapshot,
  type LoadingTask,
} from "../core/loading.ts";
import {
  evaluateLoadingGeometry,
  type LoadingGeometry,
  type LoadingPlacementInput,
} from "../geometry/loading.ts";

export { LoadController } from "../core/loading.ts";
export type {
  LoadingOutcome,
  LoadingPhase,
  LoadingSnapshot,
  LoadingTask,
} from "../core/loading.ts";
export type {
  LoadingArc,
  LoadingCircle,
  LoadingGeometry,
  LoadingPlacement,
  LoadingPolyline,
  LoadingShape,
} from "../geometry/loading.ts";

export interface LoadingRenderTarget {
  render(geometry: LoadingGeometry): void;
  clear(): void;
}

/** Scene-supplied placement. The loading layer never changes these values. */
export interface LoadingScenePlacement {
  anchor: Vec;
  /** Radians around the anchor, matching geometry/loading.ts. */
  angle: number;
  scale: number;
  theme: Theme;
}

export function geometryForSnapshot(
  snapshot: LoadingSnapshot,
  placement: LoadingPlacementInput,
): LoadingGeometry {
  return evaluateLoadingGeometry(snapshot.poseTime, {
    placement,
    phase: snapshot.phase,
    exit: snapshot.exit,
    streaming: snapshot.streaming,
    reducedMotion: snapshot.reducedMotion,
  });
}

/**
 * Application adapter joining the pure controller to a render target. The
 * host clock calls `update(now, reducedMotion)`; this class owns no frame loop
 * and never modifies camera, theme or content.
 */
export class LoadingPresenter {
  readonly controller = new LoadController();
  readonly renderer: LoadingRenderTarget;
  private readonly placement: () => LoadingPlacementInput;

  constructor(
    renderer: LoadingRenderTarget,
    placement: () => LoadingPlacementInput,
  ) {
    this.renderer = renderer;
    this.placement = placement;
  }

  start(task: LoadingTask, now: number): LoadingSnapshot | null {
    return this.sync(this.controller.start(task, now));
  }

  readable(id: string, now: number): LoadingSnapshot | null {
    return this.sync(this.controller.readable(id, now));
  }

  receive(id: string, now: number): LoadingSnapshot | null {
    return this.sync(this.controller.receive(id, now));
  }

  complete(id: string, now: number): LoadingSnapshot | null {
    return this.sync(this.controller.complete(id, now));
  }

  fail(id: string, error: unknown, now: number): LoadingSnapshot | null {
    return this.sync(this.controller.fail(id, error, now));
  }

  cancel(id: string, now: number): LoadingSnapshot | null {
    return this.sync(this.controller.cancel(id, now));
  }

  update(now: number, reducedMotion = false): LoadingSnapshot | null {
    return this.sync(this.controller.update(now, reducedMotion));
  }

  private sync(snapshot: LoadingSnapshot | null): LoadingSnapshot | null {
    if (!snapshot) {
      this.renderer.clear();
      return null;
    }
    this.renderer.render(geometryForSnapshot(snapshot, this.placement()));
    return snapshot;
  }
}
