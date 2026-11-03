import type { Field } from "../application/field.ts";
import type { ReadingSession } from "../application/reading-session.ts";
import { readerMotion } from "../application/reader-navigation.ts";
import type { Scene } from "../rendering/scene.ts";
import { ReaderObservation } from "../core/reader-observation.ts";
import { captureSessionAnchor, resolveSessionAnchor } from "../core/reader-snapshot.ts";
import type { ReaderDefinition } from "../core/content.ts";
import type { ReaderPlace, ReaderRestoration, ReaderSnapshot } from "../core/reader.ts";

type Restoration =
  | { kind: "waiting"; snapshot: ReaderSnapshot }
  | { kind: "applying"; location: ReaderPlace; outcome: "matched" | "start" }
  | { kind: "done"; outcome: Exclude<ReaderRestoration, "pending"> };

/** Owns only the one-shot restore request and immutable outputs, never navigation. */
export class ReaderSessionAccess {
  readonly observation = new ReaderObservation();
  private restoration: Restoration;
  constructor(private field: Field, private reading: ReadingSession, private scene: Scene,
    private definition: ReaderDefinition, snapshot: ReaderSnapshot | null) {
    this.restoration = snapshot ? { kind: "waiting", snapshot } : { kind: "done", outcome: "none" };
  }
  private location(): ReaderPlace {
    return { hub: this.field.hub.id, chapter: this.field.selected().id,
      presentation: this.field.hub.targetMorph > 0.5 ? "line" : "circle" };
  }
  interrupt = (): void => {
    const restore = this.restoration;
    if (restore.kind === "done") return;
    if (restore.kind === "applying")
      this.scene.readingPositions.settleSource(restore.location.chapter, restore.location.presentation);
    this.restoration = { kind: "done", outcome: "cancelled" };
  };
  beforeRender(): void {
    const restore = this.restoration;
    if (restore.kind !== "waiting") return;
    const location = this.location(), target = restore.snapshot.location;
    if (location.hub !== target.hub || location.chapter !== target.chapter ||
      location.presentation !== target.presentation || this.field.state.overview) {
      this.interrupt(); return;
    }
    const document = this.field.catalog.document(target.chapter, target.presentation);
    if (!this.reading.bootReady || !document.complete || this.field.state.transition.kind !== "idle") return;
    const source = resolveSessionAnchor(restore.snapshot.anchor, document);
    this.scene.readingPositions.seek(target.chapter, target.presentation, source ?? 0, document, 0, "window");
    this.scene.invalidateContent([target.chapter]);
    this.restoration = { kind: "applying", location: target, outcome: source === null ? "start" : "matched" };
  }
  afterRender(): void {
    const restore = this.restoration;
    if (restore.kind === "applying" &&
      !this.scene.readingPositions.isSettling(restore.location.chapter, restore.location.presentation))
      this.restoration = { kind: "done", outcome: restore.outcome };
    const location = this.location();
    const requested = this.reading.requestedContent;
    this.observation.publish({ status: "active", location,
      view: this.field.state.overview ? "overview" : "reading", readable: this.reading.bootReady,
      motion: readerMotion(this.field.state).kind,
      content: this.reading.store.get(this.field.catalog.sourceChapterId(location.chapter), location.presentation).status,
      request: requested ? { location: { ...requested, hub: this.field.catalog.get(requested.chapter).hub },
        content: this.reading.store.get(this.field.catalog.sourceChapterId(requested.chapter), requested.presentation).status } : null,
      restoration: this.restoration.kind === "done" ? this.restoration.outcome : "pending" });
  }
  snapshot = (): ReaderSnapshot | null => {
    const location = this.location();
    if (this.observation.getState().status === "destroyed" || !this.reading.bootReady ||
      this.restoration.kind !== "done" || this.field.state.transition.kind !== "idle" ||
      this.reading.retainedChapterId || this.reading.error || this.reading.requestedContent ||
      Math.abs(this.field.hub.textOffset - this.field.hub.textOffsetTarget) > 0.1 ||
      this.scene.readingPositions.isSettling(location.chapter, location.presentation) ||
      !this.definition.manifest.chapters.some(chapter => chapter.id === location.chapter && chapter.hub === location.hub)) return null;
    const document = this.field.catalog.document(location.chapter, location.presentation);
    if (!document.complete) return null;
    const position = this.scene.readingPositions.get(location.chapter, location.presentation);
    return Object.freeze({ version: 1, location: Object.freeze(location),
      anchor: position ? captureSessionAnchor(document, position.source) : null });
  };
  destroy = (): void => { this.interrupt(); this.observation.publish({ status: "destroyed" }); };
}
