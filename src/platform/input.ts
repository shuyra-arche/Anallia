import type { Camera, Command, Vec } from "../core/types.ts";
interface InputPort {
  dispatch(command: Command): void;
  pan(delta: Vec, start: Camera): void;
  zoom(factor: number, point: Vec): void;
  camera(): Camera;
  overview(): boolean;
  loading(): boolean;
  exitLoading(): void;
  resolve(key: string): Command | undefined;
}
export function bindInput(host: HTMLElement, port: InputPort): () => void {
  const controller = new AbortController(),
    signal = controller.signal;
  let drag: { id: number; at: Vec; camera: Camera; moved: boolean } | null =
      null,
    lastWheel = -Infinity,
    suppressClick = false;
  const pointers = new Map<number, Vec>();
  let pinchDistance: number | null = null;
  const element = (target: EventTarget | null) =>
    target instanceof Element ? target : null;
  const point = (e: PointerEvent | WheelEvent): Vec => ({
    x: e.clientX,
    y: e.clientY,
  });
  host.addEventListener(
    "pointerdown",
    (e) => {
      if (element(e.target)?.closest("#loadingOverlay.active")) {
        port.exitLoading();
        return;
      }
      if (e.button !== 0 || element(e.target)?.closest("button")) return;
      pointers.set(e.pointerId, point(e));
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        drag = null;
        return;
      }
      drag = {
        id: e.pointerId,
        at: point(e),
        camera: { ...port.camera() },
        moved: false,
      };
      suppressClick = false;
    },
    { signal },
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, point(e));
      if (pointers.size === 2 && pinchDistance !== null) {
        const [a, b] = [...pointers.values()],
          distance = Math.hypot(a.x - b.x, a.y - b.y);
        port.zoom(distance / Math.max(1, pinchDistance), {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        });
        pinchDistance = distance;
        suppressClick = true;
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      const delta = { x: e.clientX - drag.at.x, y: e.clientY - drag.at.y };
      if (Math.hypot(delta.x, delta.y) > 5) drag.moved = true;
      if (drag.moved) {
        port.pan(delta, drag.camera);
        host.querySelector("#world")?.classList.add("dragging");
        suppressClick = true;
      }
    },
    { signal },
  );
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDistance = null;
    if (drag?.id === e.pointerId) drag = null;
    host.querySelector("#world")?.classList.remove("dragging");
  };
  window.addEventListener("pointerup", release, { signal });
  window.addEventListener("pointercancel", release, { signal });
  host.addEventListener(
    "click",
    (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const target = element(e.target),
        link = target?.closest<HTMLElement>("[data-target]");
      if (link?.dataset.target) {
        port.dispatch({ type: "navigate", target: link.dataset.target });
        return;
      }
      const key =
        target?.closest<SVGElement>("[data-command]")?.dataset.command;
      if (key) {
        const command = port.resolve(key);
        if (command) port.dispatch(command);
      }
    },
    { signal },
  );
  host.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (port.loading()) return;
      if (e.altKey || e.ctrlKey || e.metaKey || port.overview()) {
        port.zoom(Math.exp(-e.deltaY * 0.0015), point(e));
        return;
      }
      if (Math.abs(e.deltaY) < 3 || performance.now() - lastWheel < 260) return;
      lastWheel = performance.now();
      port.dispatch({ type: "step", delta: Math.sign(e.deltaY) });
    },
    { signal, passive: false },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      const target = element(e.target);
      if (target?.closest("input,textarea,select,[contenteditable=true]"))
        return;
      if (port.loading()) {
        if (e.key === "Escape" || e.key === " ") {
          e.preventDefault();
          port.exitLoading();
        }
        return;
      }
      if (
        (e.key === "Enter" || e.key === " ") &&
        target?.closest("[data-command]")
      ) {
        e.preventDefault();
        const key =
          target.closest<SVGElement>("[data-command]")!.dataset.command!;
        const command = port.resolve(key);
        if (command) port.dispatch(command);
        return;
      }
      if (target?.closest("button") && (e.key === " " || e.key === "Enter"))
        return;
      if (["+", "=", "-", "_"].includes(e.key)) {
        e.preventDefault();
        port.zoom(e.key === "-" || e.key === "_" ? 1 / 1.15 : 1.15, {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
        return;
      }
      const commands: Record<string, Command> = {
        Escape: { type: "back" },
        Backspace: { type: "back" },
        Home: { type: "overview" },
        ArrowDown: { type: "step", delta: 1 },
        ArrowUp: { type: "step", delta: -1 },
      };
      if (commands[e.key]) {
        e.preventDefault();
        port.dispatch(commands[e.key]);
      }
    },
    { signal },
  );
  return () => controller.abort();
}
