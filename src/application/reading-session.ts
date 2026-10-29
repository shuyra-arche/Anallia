import type { Command } from "../core/types.ts";
import type { ContentChange, ContentRequest, Presentation } from "../core/content.ts";
import { ContentStore } from "../content/store.ts";
import { LoadController } from "../core/loading.ts";
import type { LoadingSnapshot } from "../core/loading.ts";
import { Field } from "./field.ts";

interface ReadingJob {
  key: string;
  id: string;
  presentation: Presentation;
  request: ContentRequest;
  taskId: string | null;
  command?: Command;
  prepared: boolean;
  readable: boolean;
  terminal: boolean;
}

/** Owns source subscriptions; the host clock owns flush, layout and presentation. */
export class ReadingSession {
  readonly loading = new LoadController();
  private jobs = new Map<string, ReadingJob>();
  private foreground: ReadingJob | null = null;
  private bypassGate = false;
  private serial = 0;
  private now = 0;
  private backendReady = false;
  private booted = false;
  private settleBoot!: () => void;
  readonly ready = new Promise<void>((resolve) => { this.settleBoot = resolve; });
  error: { chapterId: string; presentation: Presentation; message: string; command?: Command } | null = null;
  private readonly prepare?: (id: string, presentation: Presentation) => boolean;

  readonly field: Field;
  readonly store: ContentStore;

  constructor(field: Field, store: ContentStore, prepare?: (id: string, presentation: Presentation) => boolean) {
    this.field = field;
    this.store = store;
    field.catalog.bindContentStore(store);
    this.prepare = prepare;
    field.setContentGate((command) => this.gate(command));
  }

  startup(id: string, backend: Promise<void>, now = 0): void {
    this.now = now;
    this.open(id, this.presentation(id), "initial");
    void backend.then(() => { this.backendReady = true; }, () => { this.backendReady = true; });
  }

  get bootReady(): boolean { return this.booted; }
  get activeTask(): LoadingSnapshot | null {
    return this.loading.update(this.now, this.field.state.settings.reducedMotion);
  }

  private sourceId(id: string): string {
    return id.startsWith("q_hit_") ? id.slice("q_hit_".length) : id;
  }

  private presentation(id: string): Presentation {
    const chapter = this.field.catalog.get(id);
    return this.field.state.hubs[chapter.hub].targetMorph > 0.5 ? "line" : "circle";
  }

  private key(id: string, presentation: Presentation): string {
    return `${this.sourceId(id)}:${presentation}`;
  }

  private dispatch(command: Command): void {
    this.bypassGate = true;
    try { this.field.dispatch(command); }
    finally { this.bypassGate = false; }
  }

  private gate(command: Command): boolean {
    if (this.bypassGate) return false;
    if (command.type === "navigate" && command.target === "act:retry_content") {
      if (this.error) {
        const { chapterId, presentation, command } = this.error;
        this.open(chapterId, presentation, !this.booted ? "initial" : command ? "navigation" : "refresh", command, true);
      }
      return true;
    }
    if (command.type === "navigate" && command.target === "act:refresh_content") {
      this.refresh();
      return true;
    }
    if (command.type === "back" || command.type === "overview") { this.cancel(); this.error = null; }
    let id: string;
    let presentation: Presentation;
    if (command.type === "navigate" && !command.target.startsWith("act:")) {
      if (!this.field.catalog.chapters.has(command.target)) return false;
      id = command.target;
      this.error = null;
      presentation = this.presentation(id);
    } else if (command.type === "back") {
      const previous = this.field.state.history.at(-1);
      if (!previous || previous.overview) return false;
      const target = previous.hubs[previous.focus];
      id = target.path.at(-1)!;
      presentation = previous.focus === this.field.state.focus && !this.field.state.overview
        ? this.presentation(id) : target.morph > 0.5 ? "line" : "circle";
    } else if (command.type === "morph") {
      id = this.field.selected().id;
      presentation = this.field.hub.targetMorph > 0.5 ? "circle" : "line";
    } else {
      return false;
    }
    const sourceId = this.sourceId(id);
    const snapshot = this.store.get(sourceId, presentation);
    const existing = this.jobs.get(this.key(id, presentation));
    if (this.foreground && this.foreground.key !== this.key(id, presentation)) this.cancel();
    if (snapshot.complete) return false;
    if (snapshot.text.length > 0 && existing && !existing.terminal) {
      if (existing.id !== id) { existing.prepared = false; existing.readable = false; }
      existing.id = id;
      if (!existing.taskId || this.foreground !== existing) this.promote(existing, "navigation");
      return false;
    }
    this.open(id, presentation, "navigation", command);
    return true;
  }

  private open(id: string, presentation: Presentation, scope: string, command?: Command, force = false): ReadingJob {
    const key = this.key(id, presentation);
    const previous = this.jobs.get(key);
    if (previous && !force && !previous.terminal) {
      if (scope !== "prefetch") previous.id = id;
      if (command) previous.command = command;
      if (!previous.taskId && scope !== "prefetch") this.promote(previous, scope);
      return previous;
    }
    if (scope !== "prefetch") this.cancel();
    previous?.request.cancel();
    const request = this.store.start(this.sourceId(id), presentation);
    const job: ReadingJob = { key, id, presentation, request, taskId: null, command, prepared: false, readable: false, terminal: false };
    this.jobs.set(key, job);
    if (scope !== "prefetch") this.promote(job, scope);
    void request.done.catch(() => undefined);
    return job;
  }

  private promote(job: ReadingJob, scope: string): void {
    job.prepared = false;
    job.readable = false;
    job.taskId = `content-${++this.serial}`;
    this.foreground = job;
    this.error = null;
    this.loading.start({ id: job.taskId, scope, hubId: this.field.catalog.get(job.id).hub, chapterId: job.id, cancellable: scope !== "initial" }, this.now);
  }

  refresh(): void {
    const id = this.field.selected().id;
    this.open(id, this.presentation(id), "refresh", undefined, true);
  }

  cancel(): boolean {
    const job = this.foreground;
    if (!job || job.terminal || (!this.booted && !job.command)) return false;
    job.request.cancel();
    if (job.taskId) this.loading.cancel(job.taskId, this.now);
    this.jobs.delete(job.key);
    this.foreground = null;
    return true;
  }

  flush(now: number): readonly ContentChange[] {
    this.now = now;
    const changes = this.store.flush();
    for (const change of changes) {
      if (change.status === "cancelled" || (!change.text && !change.complete)) continue;
      const job = this.jobs.get(this.key(change.id, change.presentation));
      this.field.catalog.updateExpression(change.id, change.presentation, change.text, change.complete);
      if (job?.readable && job.taskId && !change.complete) this.loading.readable(job.taskId, now);
    }
    for (const job of this.jobs.values()) {
      const snapshot = this.store.get(this.sourceId(job.id), job.presentation);
      if (snapshot.status === "error") {
        if (!job.terminal && job.taskId) {
          this.loading.fail(job.taskId, snapshot.error, now);
          this.error = { chapterId: job.id, presentation: job.presentation, command: job.command, message: snapshot.error?.message ?? "内容暂时无法打开" };
        }
        job.terminal = true;
        continue;
      }
      if (!job.prepared && (snapshot.text.length > 0 || snapshot.complete)) {
        if (job.taskId && this.prepare && !this.prepare(job.id, job.presentation)) continue;
        job.prepared = true;
        if (job.taskId && this.prepare && (this.booted || this.backendReady)) {
          job.readable = true;
          this.loading.readable(job.taskId, now);
        }
        if (job.command) { this.dispatch(job.command); job.command = undefined; }
      }
    }
    return changes;
  }

  /** Called after the matching DOM content has been laid out in the host frame. */
  afterRender(isReadable: (id: string, presentation: Presentation) => boolean): void {
    for (const job of this.jobs.values()) {
      const snapshot = this.store.get(this.sourceId(job.id), job.presentation);
      if (!job.prepared || job.terminal) continue;
      if (!job.readable && (this.booted || this.backendReady) && (job.taskId && this.prepare || isReadable(job.id, job.presentation))) {
        job.readable = true;
        if (job.taskId) this.loading.readable(job.taskId, this.now);
      }
      if (job.readable && snapshot.complete && (this.booted || this.backendReady)) {
        job.terminal = true;
        if (job.taskId) this.loading.complete(job.taskId, this.now);
      }
    }
    if (!this.booted && this.backendReady && this.foreground?.readable) {
      this.booted = true;
      this.settleBoot();
    }
    if (this.booted && !this.field.state.overview) {
      const siblings = this.field.siblings();
      const index = Math.round(this.field.hub.scroll);
      const radius = Math.max(1, Math.ceil(this.field.state.settings.range));
      for (let i = Math.max(0, index - radius); i <= Math.min(siblings.length - 1, index + radius); i++) {
        for (const presentation of ["circle", "line"] as const) {
          const id = siblings[i].id;
          if (this.store.get(this.sourceId(id), presentation).status === "idle") this.open(id, presentation, "prefetch");
        }
      }
    }
  }

  destroy(): void {
    for (const job of this.jobs.values()) job.request.cancel();
    this.jobs.clear();
    this.foreground = null;
    this.field.setContentGate(null);
  }
}
