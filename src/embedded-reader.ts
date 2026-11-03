import type { ReaderFrameBridge } from "./runtime/frame-bridge.ts";
import type {
  ReaderDefinition,
  ReaderHandle,
  ReaderOptions,
  ReaderCommand,
} from "./reader.ts";

export type {
  ReaderDefinition,
  ReaderHandle,
  ReaderOptions,
  ReaderCommand,
} from "./reader.ts";
export interface EmbeddedReaderOptions extends ReaderOptions {
  /** Same-origin HTTP(S) page built from reader-frame.html, relative to the embedding document. */
  frameUrl: string | URL;
  /** Accessible name of this independent reading region. */
  label?: string;
}
type FrameWindow = Window & { __analliaFrame?: ReaderFrameBridge };
const mounted = new WeakSet<HTMLElement>();
type EmbeddedPhase =
  | { kind: "loading" }
  | { kind: "mounted"; reader: ReaderHandle }
  | { kind: "destroyed" };

/**
 * Embed an independent document reader without applying reader CSS to the parent.
 * The caller supplies a sized host and serves reader-frame.html on the same origin.
 * This is browser-context isolation, not a security sandbox for untrusted content.
 */
export function mountEmbeddedReader(
  host: HTMLElement,
  definition: ReaderDefinition,
  options: EmbeddedReaderOptions,
): ReaderHandle {
  if (host.ownerDocument !== document || !host.isConnected)
    throw new Error(
      "Embedding requires a connected host in the current document",
    );
  if (mounted.has(host))
    throw new Error("This host already has an embedded reader");
  const url = new URL(options.frameUrl, document.baseURI);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== location.origin
  ) {
    throw new Error("Reader frame must use same-origin HTTP(S)");
  }
  if (!definition.source || typeof definition.source.open !== "function")
    throw new TypeError("ContentSource.open is required");
  // Each Field gets its own manifest. ContentSource is caller-owned and may be shared;
  // every open call still receives the owning instance's cancellation signal.
  const input: ReaderDefinition = {
    ...definition,
    manifest: structuredClone(definition.manifest),
  };
  const { frameUrl: _frameUrl, label, ...initialOptions } = options;
  const readerOptions = {
    ...initialOptions,
    settings: initialOptions.settings
      ? { ...initialOptions.settings }
      : undefined,
  };
  const children = [...host.childNodes];
  const frame = document.createElement("iframe");
  frame.title = label ?? definition.title ?? "Anallia 阅读器";
  frame.dataset.readerFrame = "";
  frame.style.cssText = "display:block;width:100%;height:100%;border:0;";
  frame.src = url.href;
  const events = new AbortController();
  let phase: EmbeddedPhase = { kind: "loading" };
  let resolveReady!: (outcome: { status: "ready" | "destroyed" }) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<{ status: "ready" | "destroyed" }>(
    (resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    },
  );
  // This prevents an unhandled rejection if a consumer mounts and immediately leaves;
  // callers awaiting ready still receive the original rejection.
  void ready.catch(() => {});
  const destroy = () => {
    if (phase.kind === "destroyed") return;
    const previous = phase;
    phase = { kind: "destroyed" };
    events.abort();
    try {
      if (previous.kind === "mounted") previous.reader.destroy();
    } finally {
      frame.remove();
      host.replaceChildren(...children);
      mounted.delete(host);
      resolveReady({ status: "destroyed" });
    }
  };
  const fail = (error: unknown) => {
    rejectReady(error);
    destroy();
  };
  frame.addEventListener(
    "load",
    () => {
      if (phase.kind === "destroyed") return;
      // A second navigation would invalidate the realm that owns the reader. Close the
      // instance rather than leaving a handle pointing to detached resources.
      if (phase.kind === "mounted") {
        fail(new Error("Reader frame navigated after mounting"));
        return;
      }
      try {
        const bridge = (frame.contentWindow as FrameWindow | null)
          ?.__analliaFrame;
        if (bridge?.version !== 1)
          throw new Error(
            "Reader frame did not provide the expected mount entry",
          );
        const reader = bridge.mount(input, readerOptions);
        // A caller-owned source can synchronously destroy its host while opening.
        if (events.signal.aborted) {
          reader.destroy();
          return;
        }
        phase = { kind: "mounted", reader };
        void reader.ready.then((outcome) => {
          if (phase.kind !== "destroyed") resolveReady(outcome);
        }, fail);
      } catch (error) {
        fail(error);
      }
    },
    { signal: events.signal },
  );
  frame.addEventListener(
    "error",
    () => fail(new Error("Reader frame failed to load")),
    { signal: events.signal },
  );
  const handle: ReaderHandle = Object.freeze({
    ready,
    dispatch(command: ReaderCommand) {
      if (phase.kind === "destroyed") throw new Error("Reader is destroyed");
      if (phase.kind === "loading")
        throw new Error("Reader frame is not ready");
      phase.reader.dispatch({ ...command });
    },
    destroy,
  });
  mounted.add(host);
  host.replaceChildren(frame);
  return handle;
}
