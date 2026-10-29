import type { HoverChannel } from "../core/hover-feedback.ts";
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
  hover(
    target: string | null,
    channel: HoverChannel,
    previous?: string | null,
  ): void;
}

export function bindSemanticFeedback(ports: SemanticFeedbackPorts): () => void {
  const controller = new AbortController();
  const lifetime = { signal: controller.signal };
  const document = ports.labels.ownerDocument;
  const ElementType = document.defaultView!.Element;
  const owned = (element: Element) =>
    ports.labels.contains(element) ||
    ports.reading.contains(element) ||
    ports.geometry.contains(element);
  const tagKey = (target: EventTarget | null): string | null => {
    if (!(target instanceof ElementType)) return null;
    const group = target.closest<SVGGElement>(".tag-group[data-command]");
    return group && ports.labels.contains(group)
      ? (group.dataset.command ?? null)
      : null;
  };
  let pointerKey: string | null = null,
    pressedKey: string | null = null,
    focusedKey: string | null = null;
  const change = (
    property: "hover" | "press" | "focus",
    previous: string | null,
    next: string | null,
  ): string | null => {
    if (previous === next) return next;
    if (previous) ports.symbol(previous, { [property]: false });
    if (next) ports.symbol(next, { [property]: true });
    return next;
  };
  const press = (next: string | null) => {
    pressedKey = change("press", pressedKey, next);
  };
  const pointer = (next: string | null) => {
    pointerKey = change("hover", pointerKey, next);
    if (pressedKey !== next) press(null);
  };
  const focus = (next: string | null) => {
    focusedKey = change("focus", focusedKey, next);
  };
  ports.labels.addEventListener(
    "pointerover",
    (event) => pointer(tagKey(event.target)),
    lifetime,
  );
  ports.labels.addEventListener(
    "pointerout",
    (event) => {
      const key = tagKey(event.target),
        next = tagKey(event.relatedTarget);
      if (key === pointerKey && next !== key) pointer(next);
    },
    lifetime,
  );
  ports.labels.addEventListener(
    "pointerleave",
    () => {
      pointer(null);
      press(null);
    },
    lifetime,
  );
  ports.labels.addEventListener(
    "pointerdown",
    (event) => {
      const key = tagKey(event.target);
      pointer(key);
      press(key);
    },
    lifetime,
  );
  ports.labels.addEventListener(
    "focusin",
    (event) => focus(tagKey(event.target)),
    lifetime,
  );
  ports.labels.addEventListener(
    "focusout",
    (event) => {
      const key = tagKey(event.target),
        next = tagKey(event.relatedTarget);
      if (key === focusedKey && next !== key) focus(next);
    },
    lifetime,
  );

  const relationalTarget = (target: EventTarget | null): string | null => {
    if (!(target instanceof ElementType) || !owned(target)) return null;
    const inline = target.closest<HTMLElement>(".inline-ref[data-target]");
    if (inline?.dataset.target && !inline.dataset.target.startsWith("act:"))
      return inline.dataset.target;
    const element = target.closest<SVGElement>("[data-command]");
    if (!element?.dataset.command) return null;
    const command = ports.resolve(element.dataset.command);
    if (command?.type === "navigate" && !command.target.startsWith("act:"))
      return command.target;
    return command?.type === "focus" ? `hub:${command.hub}` : null;
  };
  let pointerTarget: string | null = null,
    focusTarget: string | null = null;
  const over = (event: Event) => {
    pointerTarget = relationalTarget(event.target);
    ports.hover(pointerTarget, "pointer");
  };
  const out = (event: Event) => {
    if (relationalTarget(event.target) !== pointerTarget) return;
    const previous = pointerTarget;
    pointerTarget = relationalTarget((event as PointerEvent).relatedTarget);
    ports.hover(pointerTarget, "pointer", previous);
  };
  const focusIn = (event: Event) => {
    focusTarget = relationalTarget(event.target);
    ports.hover(focusTarget, "focus");
  };
  const focusOut = (event: Event) => {
    if (relationalTarget(event.target) !== focusTarget) return;
    const previous = focusTarget;
    focusTarget = relationalTarget((event as FocusEvent).relatedTarget);
    ports.hover(focusTarget, "focus", previous);
  };
  for (const root of [ports.reading, ports.labels, ports.geometry]) {
    root.addEventListener("pointerover", over, lifetime);
    root.addEventListener("pointerout", out, lifetime);
    root.addEventListener("focusin", focusIn, lifetime);
    root.addEventListener("focusout", focusOut, lifetime);
  }
  const cancelPointer = () => {
    press(null);
    pointer(null);
    if (pointerTarget !== null) ports.hover(null, "pointer", pointerTarget);
    pointerTarget = null;
  };
  document.addEventListener(
    "pointerup",
    (event) => {
      press(null);
      if (event.pointerType === "touch") cancelPointer();
    },
    lifetime,
  );
  document.addEventListener("pointercancel", cancelPointer, lifetime);
  document.addEventListener("lostpointercapture", cancelPointer, lifetime);
  document.defaultView?.addEventListener("blur", cancelPointer, lifetime);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    pointer(null);
    press(null);
    focus(null);
    if (pointerTarget !== null) ports.hover(null, "pointer", pointerTarget);
    if (focusTarget !== null) ports.hover(null, "focus", focusTarget);
    pointerTarget = focusTarget = null;
  };
}
