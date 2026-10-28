import type {
  ContentChange,
  ContentFlush,
  ContentRequest,
  ContentSnapshot,
  ContentSource,
  ContentStatus,
  Presentation,
  TextPatch,
} from "../core/content.ts";

interface Entry extends ContentSnapshot {
  pendingText: string | null;
  pendingComplete: boolean | null;
  pendingStatus: ContentStatus | null;
}

interface RequestControl {
  settleReady(): void;
  resolveDone(): void;
  rejectDone(error: Error): void;
}

function keyOf(id: string, presentation: Presentation) {
  return `${id}\u0000${presentation}`;
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export class ContentStore {
  private readonly source: ContentSource;
  private readonly entries = new Map<string, Entry>();
  private readonly generations = new Map<string, number>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly active = new Map<string, ContentRequest>();
  private readonly touched = new Set<string>();
  private readonly flushedVersion = new Map<string, number>();

  constructor(source: ContentSource) {
    this.source = source;
  }

  start(id: string, presentation: Presentation): ContentRequest {
    const key = keyOf(id, presentation);
    this.active.get(key)?.cancel();
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    const controller = new AbortController();
    this.controllers.set(key, controller);
    this.entries.set(key, {
      text: "",
      version: 0,
      complete: false,
      status: "loading",
      error: null,
      pendingText: null,
      pendingComplete: null,
      pendingStatus: null,
    });
    this.flushedVersion.set(key, -1);
    this.touched.delete(key);

    let readyOpen = true;
    let doneOpen = true;
    let resolveReady!: () => void;
    let resolveDone!: () => void;
    let rejectDone!: (error: Error) => void;
    const ready = new Promise<void>((resolve) => (resolveReady = resolve));
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    // A caller may only await `done` on failure paths, but the request must
    // never become an unhandled rejection merely because it was ignored.
    void done.catch(() => undefined);

    const control: RequestControl = {
      settleReady() {
        if (!readyOpen) return;
        readyOpen = false;
        resolveReady();
      },
      resolveDone() {
        if (!doneOpen) return;
        doneOpen = false;
        resolveDone();
      },
      rejectDone(error: Error) {
        if (!doneOpen) return;
        doneOpen = false;
        rejectDone(error);
      },
    };

    const request: ContentRequest = {
      ready,
      done,
      cancel: () => this.cancel(key, generation, control),
    };
    this.active.set(key, request);
    queueMicrotask(() => {
      void this.consume(
        id,
        presentation,
        key,
        generation,
        controller.signal,
        control,
      ).catch(() => undefined);
    });
    return request;
  }

  flush(): ContentFlush {
    const changes: ContentChange[] = [];
    for (const key of [...this.touched]) {
      this.touched.delete(key);
      const entry = this.entries.get(key);
      if (!entry) continue;
      this.commitPending(entry);
      const flushed = this.flushedVersion.get(key) ?? -1;
      if (entry.version <= flushed) continue;
      this.flushedVersion.set(key, entry.version);
      const separator = key.lastIndexOf("\u0000");
      changes.push({
        id: key.slice(0, separator),
        presentation: key.slice(separator + 1) as Presentation,
        text: entry.text,
        version: entry.version,
        complete: entry.complete,
        status: entry.status,
        error: entry.error,
      });
    }
    const result = changes as ContentFlush;
    Object.defineProperty(result, "changes", {
      value: result,
      enumerable: false,
    });
    return result;
  }

  get(id: string, presentation: Presentation): ContentSnapshot {
    const entry = this.entries.get(keyOf(id, presentation));
    if (!entry)
      return {
        text: "",
        version: 0,
        complete: false,
        status: "idle",
        error: null,
      };
    return {
      text: entry.text,
      version: entry.version,
      complete: entry.complete,
      status: entry.status,
      error: entry.error,
    };
  }

  private isCurrent(key: string, generation: number) {
    return this.generations.get(key) === generation;
  }

  private applyPatch(key: string, patch: TextPatch) {
    const entry = this.entries.get(key);
    if (!entry) return;
    const current = entry.pendingText ?? entry.text;
    entry.pendingText =
      patch.type === "append" ? current + patch.text : patch.text;
    if (entry.status === "loading") entry.pendingStatus = "streaming";
    this.touched.add(key);
    if (entry.text.length === 0 && (entry.pendingText?.length ?? 0) > 0) {
      this.commitPending(entry);
      this.touched.add(key);
    }
  }

  private commitPending(entry: Entry) {
    let changed = false;
    if (entry.pendingText !== null) {
      entry.text = entry.pendingText;
      entry.pendingText = null;
      changed = true;
    }
    if (entry.pendingComplete !== null) {
      entry.complete = entry.pendingComplete;
      entry.pendingComplete = null;
      changed = true;
    }
    if (entry.pendingStatus !== null) {
      entry.status = entry.pendingStatus;
      entry.pendingStatus = null;
      changed = true;
    }
    if (changed) entry.version++;
  }

  private async consume(
    id: string,
    presentation: Presentation,
    key: string,
    generation: number,
    signal: AbortSignal,
    control: RequestControl,
  ): Promise<void> {
    if (!this.isCurrent(key, generation)) return;
    let iterator: AsyncIterator<TextPatch>;
    try {
      iterator = this.source
        .open(id, presentation, signal)
        [Symbol.asyncIterator]();
    } catch (error) {
      this.fail(key, generation, control, error);
      return;
    }
    try {
      while (this.isCurrent(key, generation)) {
        const next = await iterator.next();
        if (!this.isCurrent(key, generation)) return;
        if (next.done) {
          const entry = this.entries.get(key);
          if (!entry) return;
          entry.pendingComplete = true;
          entry.pendingStatus = "complete";
          this.commitPending(entry);
          this.touched.add(key);
          control.settleReady();
          control.resolveDone();
          return;
        }
        const patch = next.value;
        if (
          !patch ||
          (patch.type !== "append" && patch.type !== "replace") ||
          typeof patch.text !== "string"
        )
          continue;
        const entry = this.entries.get(key);
        if (!entry || entry.complete || entry.status === "error") return;
        this.applyPatch(key, patch);
        if (entry.text.length > 0) control.settleReady();
      }
    } catch (error) {
      if (!this.isCurrent(key, generation)) return;
      this.fail(key, generation, control, error);
    }
  }

  private fail(
    key: string,
    generation: number,
    control: RequestControl,
    error: unknown,
  ) {
    if (!this.isCurrent(key, generation)) return;
    const entry = this.entries.get(key);
    if (entry) {
      this.commitPending(entry);
      entry.status = "error";
      entry.error = asError(error);
      entry.version++;
      this.touched.add(key);
    }
    // `ready` is a UI barrier, not an error channel; resolving it prevents a
    // failed first chunk from leaving readers waiting forever.
    control.settleReady();
    control.rejectDone(asError(error));
    this.generations.set(key, generation + 1);
  }

  private cancel(key: string, generation: number, control: RequestControl) {
    if (!this.isCurrent(key, generation)) return;
    this.generations.set(key, generation + 1);
    this.controllers.get(key)?.abort();
    const entry = this.entries.get(key);
    if (entry && entry.status !== "complete" && entry.status !== "error") {
      entry.pendingText = null;
      entry.pendingComplete = null;
      entry.pendingStatus = null;
      entry.status = "cancelled";
      entry.error = null;
      entry.version++;
      this.touched.add(key);
    }
    control.settleReady();
    control.resolveDone();
  }
}
