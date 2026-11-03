import {
  mountReader,
  type ReaderDefinition,
  type ReaderOptions,
  type ReaderCommand,
  type ReaderHandle,
} from "./reader.ts";
import type { ReaderFrameBridge } from "./runtime/frame-bridge.ts";

const host = document.querySelector<HTMLElement>("#scene")!;
let current: ReaderHandle | null = null;
const destroy = () => {
  const reader = current;
  current = null;
  window.removeEventListener("pagehide", onPageHide);
  reader?.destroy();
};
const onPageHide = (event: PageTransitionEvent) => {
  // A cached page is suspended by the browser and will resume with its own state.
  if (!event.persisted) destroy();
};
const bridge: ReaderFrameBridge = Object.freeze({
  version: 2,
  mount(definition: ReaderDefinition, options: ReaderOptions) {
    if (current) throw new Error("Reader frame already mounted");
    const reader = mountReader(host, definition, options);
    current = reader;
    window.addEventListener("pagehide", onPageHide);
    return Object.freeze({
      ready: reader.ready,
      dispatch: (command: ReaderCommand) => reader.dispatch(command),
      getState: reader.getState,
      subscribe: reader.subscribe,
      snapshot: reader.snapshot,
      destroy: () => {
        if (current === reader) destroy();
        else reader.destroy();
      },
    });
  },
});
(window as Window & { __analliaFrame?: ReaderFrameBridge }).__analliaFrame =
  bridge;
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    destroy();
    delete (window as Window & { __analliaFrame?: ReaderFrameBridge })
      .__analliaFrame;
  });
