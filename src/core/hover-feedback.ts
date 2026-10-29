export type HoverChannel = "pointer" | "focus";

/** Latest active input wins; releasing it restores the other channel. */
export class HoverFeedback {
  private pointer: string | null = null;
  private focus: string | null = null;
  private latest: HoverChannel = "pointer";

  get target(): string | null {
    return (
      this[this.latest] ?? this[this.latest === "pointer" ? "focus" : "pointer"]
    );
  }

  set(
    target: string | null,
    channel: HoverChannel = "pointer",
    previous?: string | null,
  ): void {
    if (previous !== undefined && this[channel] !== previous) return;
    this[channel] = target;
    if (target !== null) this.latest = channel;
  }

  clear(): void {
    this.pointer = this.focus = null;
    this.latest = "pointer";
  }
}
