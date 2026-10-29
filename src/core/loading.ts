/**
 * Pure loading lifecycle. It owns task state and animation posture only; no DOM,
 * camera, theme or content mutation is allowed here.
 */

export const LOADING_SHOW_DELAY_MS = 150;
export const LOADING_EXIT_MS = 200;
export const LOADING_ENTER_MS = 120;

export type LoadingPhase =
  "waiting" | "readable" | "streaming" | "leaving" | "error" | "cancelled";

export type LoadingOutcome = "complete" | "error" | "cancelled" | null;

export interface LoadingTask {
  id: string;
  scope: string;
  hubId: string;
  chapterId?: string;
  cancellable: boolean;
}

export interface LoadingSnapshot {
  id: string;
  scope: string;
  hubId: string;
  chapterId?: string;
  cancellable: boolean;
  phase: LoadingPhase;
  outcome: LoadingOutcome;
  /** True only for a completed task; error and cancellation are never success. */
  succeeded: boolean;
  visible: true;
  /** Milliseconds since start(). */
  age: number;
  /** Milliseconds since the 150ms visibility gate opened. */
  visibleFor: number;
  /** Seconds passed to pure geometry; frozen while leaving/error/cancelled. */
  poseTime: number;
  /** Short entrance progress, 0..1. */
  enter: number;
  /** Short terminal progress, 0..1. */
  exit: number;
  firstReadable: boolean;
  /** Local streaming marker: a readable batch exists and the task is not complete. */
  streaming: boolean;
  reducedMotion: boolean;
  error: string | null;
}

interface TerminalState {
  phase: "leaving" | "error" | "cancelled";
  outcome: Exclude<LoadingOutcome, null>;
  at: number;
  error: string | null;
}

interface TaskState {
  task: LoadingTask;
  startedAt: number;
  shownAt: number | null;
  readableCount: number;
  reducedMotion: boolean;
  frozenPoseTime: number;
  terminal: TerminalState | null;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const safeNow = (now: number): number => (Number.isFinite(now) ? now : 0);

export const isTerminalPhase = (phase: LoadingPhase): boolean =>
  phase === "leaving" || phase === "error" || phase === "cancelled";

/**
 * Task state machine driven entirely by injected timestamps. Every query opens
 * the 150ms gate once it has elapsed, while completion before the gate clears
 * the task without painting a loading frame.
 */
export class LoadController {
  private task: TaskState | null = null;

  start(task: LoadingTask, now: number): LoadingSnapshot | null {
    const at = safeNow(now);
    this.task = {
      task: { ...task, cancellable: task.cancellable === true },
      startedAt: at,
      shownAt: null,
      readableCount: 0,
      reducedMotion: false,
      frozenPoseTime: 0,
      terminal: null,
    };
    return null;
  }

  readable(id: string, now: number): LoadingSnapshot | null {
    const state = this.owned(id);
    if (!state) return this.snapshot(safeNow(now));
    if (state.terminal) return this.snapshot(safeNow(now));
    state.readableCount += 1;
    return this.snapshot(safeNow(now));
  }

  complete(id: string, now: number): LoadingSnapshot | null {
    return this.finish(id, safeNow(now), "leaving", "complete", null);
  }

  fail(id: string, error: unknown, now: number): LoadingSnapshot | null {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : error == null
            ? "Loading failed"
            : String(error);
    return this.finish(id, safeNow(now), "error", "error", message);
  }

  cancel(id: string, now: number): LoadingSnapshot | null {
    return this.finish(id, safeNow(now), "cancelled", "cancelled", null);
  }

  update(now: number, reducedMotion = false): LoadingSnapshot | null {
    const at = safeNow(now);
    const state = this.task;
    if (!state) return null;
    state.reducedMotion = reducedMotion === true;
    if (state.terminal) return this.snapshot(at);
    if (state.shownAt === null) {
      if (at < state.startedAt + LOADING_SHOW_DELAY_MS) return null;
      state.shownAt = state.startedAt + LOADING_SHOW_DELAY_MS;
    }
    return this.snapshot(at);
  }

  private finish(
    id: string,
    now: number,
    phase: TerminalState["phase"],
    outcome: TerminalState["outcome"],
    error: string | null,
  ): LoadingSnapshot | null {
    const state = this.owned(id);
    if (!state) return this.snapshot(now);
    if (state.terminal) return this.snapshot(now);
    if (state.shownAt === null) {
      if (now < state.startedAt + LOADING_SHOW_DELAY_MS) {
        this.task = null;
        return null;
      }
      state.shownAt = state.startedAt + LOADING_SHOW_DELAY_MS;
    }
    state.frozenPoseTime = state.reducedMotion
      ? 0
      : Math.max(0, (now - state.shownAt) / 1000);
    state.terminal = { phase, outcome, at: now, error };
    return this.snapshot(now);
  }

  private owned(id: string): TaskState | null {
    const state = this.task;
    return state && state.task.id === id ? state : null;
  }

  private snapshot(now: number): LoadingSnapshot | null {
    const state = this.task;
    if (!state) return null;
    if (state.shownAt === null) {
      if (now < state.startedAt + LOADING_SHOW_DELAY_MS) return null;
      state.shownAt = state.startedAt + LOADING_SHOW_DELAY_MS;
    }
    const visibleFor = Math.max(0, now - state.shownAt);

    const readableCount = state.readableCount;
    const base: LoadingSnapshot = {
      id: state.task.id,
      scope: state.task.scope,
      hubId: state.task.hubId,
      chapterId: state.task.chapterId,
      cancellable: state.task.cancellable,
      phase:
        readableCount === 0
          ? "waiting"
          : readableCount === 1
            ? "readable"
            : "streaming",
      outcome: null,
      succeeded: false,
      visible: true,
      age: Math.max(0, now - state.startedAt),
      visibleFor,
      poseTime: state.reducedMotion ? 0 : visibleFor / 1000,
      enter: clamp(visibleFor / LOADING_ENTER_MS, 0, 1),
      exit: 0,
      firstReadable: readableCount > 0,
      streaming: readableCount > 0,
      reducedMotion: state.reducedMotion,
      error: null,
    };

    const terminal = state.terminal;
    if (!terminal) return base;
    const elapsed = now - terminal.at;
    if (elapsed >= LOADING_EXIT_MS) {
      this.task = null;
      return null;
    }
    const exit = clamp(elapsed / LOADING_EXIT_MS, 0, 1);
    return {
      ...base,
      phase: terminal.phase,
      outcome: terminal.outcome,
      succeeded: terminal.outcome === "complete",
      poseTime: state.frozenPoseTime,
      enter: clamp((terminal.at - state.shownAt) / LOADING_ENTER_MS, 0, 1),
      exit,
      error: terminal.error,
    };
  }
}
