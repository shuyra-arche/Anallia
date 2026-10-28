import type { Camera, Command, Vec } from "../core/types.ts";
interface InputPort {
  dispatch(command: Command): void;
  pan(delta: Vec, start: Camera): void;
  zoom(factor: number, point: Vec): void;
  camera(): Camera;
  grasp(delta: number | null): void;
  graspGeometry(): {
    mode: "circle" | "line";
    center: Vec;
    tangent: Vec;
    stepPx: number;
    stepRad: number;
  } | null;
  overview(): boolean;
  loading(): boolean;
  exitLoading(): void;
  resolve(key: string): Command | undefined;
}
export function bindInput(host: HTMLElement, port: InputPort): () => void {
  const controller = new AbortController(),
    signal = controller.signal;
  let drag: {
      id: number;
      at: Vec;
      lastY: number;
      camera: Camera;
      moved: boolean;
      mode: "pan" | "note" | "grasp" | "local";
      maxFloat: number;
      graspInfo?: NonNullable<ReturnType<InputPort["graspGeometry"]>>;
      graspAngle?: number;
      graspAccumulated?: number;
      stepped: boolean;
    } | null = null,
    lastWheel = -Infinity,
    lastWheelSign = 0,
    suppressClick = false,
    composing = false;
  let compositionCommitted: string | null = null;
  const pointers = new Map<number, Vec>();
  let pinchDistance: number | null = null;
  const element = (target: EventTarget | null) =>
    target instanceof Element ? target : null;
  const point = (e: PointerEvent | WheelEvent): Vec => ({
    x: e.clientX,
    y: e.clientY,
  });
  host.addEventListener(
    "compositionstart",
    (e) => {
      if (element(e.target)?.matches("input.hub-search-input")) {
        composing = true;
        compositionCommitted = null;
      }
    },
    { signal },
  );
  host.addEventListener(
    "compositionend",
    (e) => {
      const target = element(e.target);
      if (
        target instanceof HTMLInputElement &&
        target.matches("input.hub-search-input")
      ) {
        composing = false;
        compositionCommitted = target.value;
        port.dispatch({ type: "search", query: target.value });
      }
    },
    { signal },
  );
  host.addEventListener(
    "input",
    (e) => {
      const target = element(e.target);
      if (
        target instanceof HTMLInputElement &&
        target.matches("input.hub-search-input") &&
        !composing &&
        !(e as InputEvent).isComposing
      ) {
        if (compositionCommitted === target.value) {
          compositionCommitted = null;
          return;
        }
        compositionCommitted = null;
        port.dispatch({ type: "search", query: target.value });
      }
    },
    { signal },
  );
  host.addEventListener(
    "pointerdown",
    (e) => {
      if (element(e.target)?.closest("#loadingOverlay.active")) {
        port.exitLoading();
        return;
      }
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const target = element(e.target);
      const onInteractiveControl = !!target?.closest("button, input");
      const note = target?.closest<HTMLElement>("article.note") ?? null;
      // On desktop mouse, pressing inside article.note selects text natively.
      if (e.pointerType === "mouse" && (onInteractiveControl || note)) return;

      pointers.set(e.pointerId, point(e));
      if (pointers.size === 2) {
        if (drag?.mode === "grasp") port.grasp(null);
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        drag = null;
        return;
      }
      if (onInteractiveControl) return;
      const maxFloat = note ? Number(note.dataset.maxFloat || 0) : 0;
      const localTag = !!target?.closest("[data-local-scroll]");
      const grabHub = !!target?.closest<SVGElement>(
        "path.hit[data-command], .tag-group.is-current",
      );
      const graspInfo =
        grabHub && !port.overview() ? port.graspGeometry() : null;
      const angle = graspInfo
        ? Math.atan2(
            e.clientY - graspInfo.center.y,
            e.clientX - graspInfo.center.x,
          )
        : 0;
      drag = {
        id: e.pointerId,
        at: point(e),
        lastY: e.clientY,
        camera: { ...port.camera() },
        moved: false,
        mode:
          localTag && !port.overview()
            ? "local"
            : note && !port.overview()
              ? "note"
              : graspInfo
                ? "grasp"
                : "pan",
        graspInfo: graspInfo || undefined,
        graspAngle: angle,
        graspAccumulated: 0,
        maxFloat,
        stepped: false,
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
      if (Math.hypot(delta.x, delta.y) > 6) drag.moved = true;
      if (!drag.moved) return;
      suppressClick = true;
      if (drag.mode === "local") {
        const dy = e.clientY - drag.lastY;
        drag.lastY = e.clientY;
        port.dispatch({
          type: "scroll-local",
          delta: -dy / (45 * port.camera().z),
        });
        return;
      }
      if (drag.mode === "grasp" && drag.graspInfo) {
        const info = port.graspGeometry() ?? drag.graspInfo;
        if (info.mode === "circle") {
          const current = Math.atan2(
            e.clientY - info.center.y,
            e.clientX - info.center.x,
          );
          let angle = current - (drag.graspAngle ?? current);
          if (angle > Math.PI) angle -= 2 * Math.PI;
          if (angle < -Math.PI) angle += 2 * Math.PI;
          drag.graspAccumulated =
            (drag.graspAccumulated ?? 0) - angle / info.stepRad;
          drag.graspAngle = current;
          port.grasp(drag.graspAccumulated);
        } else {
          const axial = delta.x * info.tangent.x + delta.y * info.tangent.y;
          port.grasp(-axial / Math.max(20, info.stepPx));
        }
        return;
      }
      if (drag.mode === "note") {
        const dy = e.clientY - drag.lastY;
        drag.lastY = e.clientY;
        if (drag.maxFloat > 0) {
          port.dispatch({
            type: "float-text",
            delta: (-dy * 1.15) / port.camera().z,
            maxOffset: drag.maxFloat,
          });
        } else if (
          !drag.stepped &&
          Math.abs(delta.y) > 30 &&
          Math.abs(delta.y) > Math.abs(delta.x) * 1.15
        ) {
          drag.stepped = true;
          port.dispatch({ type: "step", delta: delta.y < 0 ? 1 : -1 });
        }
        return;
      }
      port.pan(delta, drag.camera);
      host.querySelector("#world")?.classList.add("dragging");
    },
    { signal },
  );
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDistance = null;
    if (drag?.id === e.pointerId) {
      if (drag.mode === "grasp" && drag.moved) port.grasp(null);
      drag = null;
    }
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
      const target = element(e.target);
      if (target?.closest("input")) return;
      const selection =
        host.ownerDocument.getSelection?.()?.toString().trim() ?? "";
      if (selection.length > 0 && !target?.closest("button, [data-command]"))
        return;
      const link = target?.closest<HTMLElement>("[data-target]");
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
      if (port.loading()) return;
      if (e.altKey || e.ctrlKey || e.metaKey || port.overview()) {
        e.preventDefault();
        port.zoom(Math.exp(-e.deltaY * 0.0015), point(e));
        return;
      }
      if (element(e.target)?.closest("[data-local-scroll]")) {
        e.preventDefault();
        port.dispatch({
          type: "scroll-local",
          delta: e.deltaY / (45 * port.camera().z),
        });
        return;
      }
      const note = element(e.target)?.closest<HTMLElement>("article.note");
      if (note) {
        const maxFloat = Number(note.dataset.maxFloat || 0);
        if (maxFloat > 0) {
          e.preventDefault();
          port.dispatch({
            type: "float-text",
            delta: (e.deltaY * 0.72) / port.camera().z,
            maxOffset: maxFloat,
          });
          return;
        }
      }
      e.preventDefault();
      const sign = Math.sign(e.deltaY);
      const now = performance.now();
      if (
        Math.abs(e.deltaY) < 2.5 ||
        (sign === lastWheelSign && now - lastWheel < 190)
      )
        return;
      lastWheel = now;
      lastWheelSign = sign;
      port.dispatch({ type: "step", delta: sign });
    },
    { signal, passive: false },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      const target = element(e.target);
      if (target?.closest("input,textarea,select,[contenteditable=true]")) {
        if (e.key === "Escape" && target instanceof HTMLElement) target.blur();
        return;
      }
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
        ArrowRight: { type: "step", delta: 1 },
        ArrowUp: { type: "step", delta: -1 },
        ArrowLeft: { type: "step", delta: -1 },
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
