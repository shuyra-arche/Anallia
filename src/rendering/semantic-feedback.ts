import type { Command } from "../core/types.ts";

export interface SymbolInteractionState {
  hover: boolean;
  focus: boolean;
  press: boolean;
  active: boolean;
}
interface SemanticFeedbackPorts {
  labels: SVGGElement;
  reading: HTMLElement;
  geometry: SVGGElement;
  resolve(key: string): Command | undefined;
  symbol(key: string, patch: Partial<SymbolInteractionState>): void;
  hovered(): string | null;
  hover(target: string | null): void;
}

export function bindSemanticFeedback(ports: SemanticFeedbackPorts): () => void {
  const controller = new AbortController();
  const lifetime = { signal: controller.signal };
  const ElementType = ports.labels.ownerDocument.defaultView!.Element;
    const resolveTagKey = (target: EventTarget | null): string | null => {
      if (!(target instanceof ElementType)) return null;
      const group = target.closest<SVGGElement>(".tag-group[data-symbol-kind]");
      return group?.dataset.command ?? null;
    };
    ports.labels.addEventListener("pointerover", (e) => {
      const key = resolveTagKey(e.target);
      if (key) ports.symbol(key, { hover: true });
    }, lifetime);
    ports.labels.addEventListener("pointerout", (e) => {
      const key = resolveTagKey(e.target);
      if (key) ports.symbol(key, { hover: false, press: false });
    }, lifetime);
    ports.labels.addEventListener("pointerdown", (e) => {
      const key = resolveTagKey(e.target);
      if (key) ports.symbol(key, { press: true });
    }, lifetime);
    ports.labels.addEventListener("pointerup", (e) => {
      const key = resolveTagKey(e.target);
      if (key) ports.symbol(key, { press: false });
    }, lifetime);
    ports.labels.addEventListener("focusin", (e) => {
      const key = resolveTagKey(e.target);
      if (key) ports.symbol(key, { focus: true });
    }, lifetime);
    ports.labels.addEventListener("focusout", (e) => {
      const key = resolveTagKey(e.target);
      if (key) ports.symbol(key, { focus: false, press: false });
    }, lifetime);
    const resolveRelationalTarget = (target: EventTarget | null): string | null => {
      if (!(target instanceof ElementType)) return null;
      const inlineBtn = target.closest<HTMLElement>(".inline-ref[data-target]");
      if (inlineBtn?.dataset.target && !inlineBtn.dataset.target.startsWith("act:")) {
        return inlineBtn.dataset.target;
      }
      const cmdEl = target.closest<SVGElement>("[data-command]");
      if (cmdEl?.dataset.command) {
        const cmd = ports.resolve(cmdEl.dataset.command);
        if (cmd?.type === "navigate" && !cmd.target.startsWith("act:")) return cmd.target;
        if (cmd?.type === "focus") return `hub:${cmd.hub}`;
      }
      return null;
    };
    const onOver = (e: Event) => {
      const next = resolveRelationalTarget(e.target);
      if (next !== ports.hovered()) ports.hover(next);
    };
    const onOut = (e: Event) => {
      if (ports.hovered() && resolveRelationalTarget(e.target) === ports.hovered()) {
        ports.hover(null);
      }
    };
    ports.reading.addEventListener("pointerover", onOver, lifetime);
    ports.reading.addEventListener("pointerout", onOut, lifetime);
    ports.reading.addEventListener("focusin", onOver, lifetime);
    ports.reading.addEventListener("focusout", onOut, lifetime);
    ports.labels.addEventListener("pointerover", onOver, lifetime);
    ports.labels.addEventListener("pointerout", onOut, lifetime);
    ports.geometry.addEventListener("pointerover", onOver, lifetime);
    ports.geometry.addEventListener("pointerout", onOut, lifetime);
    return () => controller.abort();
  }
