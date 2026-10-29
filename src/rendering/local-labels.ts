import type { FieldAttachment } from "../core/attachments.ts";
import { clamp, ease, mix } from "../core/math.ts";

export const LOCAL_LABEL_TURN_MS = 240;
interface LocalLeaf {
  owner: string;
  attachment: FieldAttachment;
  visibility: number;
  from: number;
  target: 0 | 1;
  started: number;
  duration: number;
}
import type { LocalLabelFrame } from "../core/graphics.ts";
export type { LocalLabelFrame } from "../core/graphics.ts";

/** Local leaves keep their semantic identity until their material-hinge exit completes. */
export class LocalLabelTurns {
  private leaves = new Map<string, LocalLeaf>();
  get isAnimating(): boolean {
    return [...this.leaves.values()].some(
      (leaf) => leaf.visibility !== leaf.target,
    );
  }
  clear() {
    this.leaves.clear();
  }
  update(
    owner: string | null,
    desired: readonly FieldAttachment[],
    now: number,
    reducedMotion: boolean,
  ): LocalLabelFrame[] {
    const key = (item: FieldAttachment) =>
      `${item.anchor.hostHub}:${item.anchor.id}`;
    const wanted = new Set(desired.map(key));
    const advance = (leaf: LocalLeaf) => {
      const progress = clamp((now - leaf.started) / leaf.duration, 0, 1);
      leaf.visibility =
        progress === 1
          ? leaf.target
          : mix(leaf.from, leaf.target, ease(progress));
    };
    for (const [id, leaf] of this.leaves) {
      advance(leaf);
      if (!wanted.has(id) && leaf.target === 1) {
        leaf.from = leaf.visibility;
        leaf.target = 0;
        leaf.started = now;
        leaf.duration = Math.max(1, LOCAL_LABEL_TURN_MS * leaf.visibility);
      }
      if (!wanted.has(id) && (reducedMotion || leaf.visibility === 0))
        this.leaves.delete(id);
    }
    const enterAt = Math.max(
      now,
      ...[...this.leaves.values()]
        .filter(
          (leaf) =>
            leaf.owner !== owner && leaf.target === 0 && leaf.visibility > 0,
        )
        .map((leaf) => leaf.started + leaf.duration),
    );
    for (const attachment of desired) {
      const id = key(attachment);
      let leaf = this.leaves.get(id);
      if (!leaf) {
        leaf = {
          owner: owner!,
          attachment,
          visibility: 0,
          from: 0,
          target: 1,
          started: enterAt,
          duration: LOCAL_LABEL_TURN_MS,
        };
        this.leaves.set(id, leaf);
      } else if (leaf.target === 0) {
        leaf.from = leaf.visibility;
        leaf.target = 1;
        leaf.started = enterAt;
        leaf.duration = Math.max(
          1,
          LOCAL_LABEL_TURN_MS * (1 - leaf.visibility),
        );
      }
      leaf.attachment = attachment;
      if (reducedMotion) leaf.visibility = leaf.from = leaf.target = 1;
    }
    const frames: LocalLabelFrame[] = [];
    for (const [id, leaf] of this.leaves) {
      if (!reducedMotion) advance(leaf);
      if (leaf.visibility === 0 && leaf.target === 0) {
        this.leaves.delete(id);
        continue;
      }
      const settled = leaf.visibility === 1 && leaf.target === 1;
      const angle = 90 * (1 - leaf.visibility);
      frames.push({
        attachment: leaf.attachment,
        visibility: leaf.visibility,
        phase: settled ? "settled" : leaf.target === 1 ? "entering" : "leaving",
        pose: settled
          ? null
          : {
              angle,
              squash: Math.max(0.001, Math.cos((angle * Math.PI) / 180)),
              opacity: leaf.visibility === 0 ? 0 : 1,
              incoming: leaf.target === 1,
              interactive: false,
            },
      });
    }
    return frames;
  }
}
