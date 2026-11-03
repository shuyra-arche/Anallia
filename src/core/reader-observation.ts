import type { ReaderListener, ReaderState } from "./reader.ts";

/** Semantic output channel only; Field remains the sole navigation owner. */
export class ReaderObservation {
  private value: ReaderState = Object.freeze({ status: "starting" });
  private key = JSON.stringify(this.value);
  private listeners = new Set<ReaderListener>();
  getState = (): ReaderState => this.value;
  private call(listener: ReaderListener, value: ReaderState) {
    try { listener(value); }
    catch (error) { console.error("Anallia reader subscriber failed", error); }
  }
  subscribe = (listener: ReaderListener): (() => void) => {
    if (typeof listener !== "function") throw new TypeError("Reader listener must be a function");
    // Each registration is independent, even when the callback identity is shared.
    const registration: ReaderListener = state => listener(state);
    if (this.value.status !== "destroyed") this.listeners.add(registration);
    this.call(registration, this.value);
    return () => { this.listeners.delete(registration); };
  };
  publish(state: ReaderState): void {
    if (this.value.status === "destroyed") return;
    const key = JSON.stringify(state);
    if (key === this.key) return;
    this.key = key;
    this.value = state.status === "active"
      ? Object.freeze({ ...state, location: Object.freeze({ ...state.location }),
        request: state.request ? Object.freeze({ ...state.request, location: Object.freeze({ ...state.request.location }) }) : null })
      : Object.freeze({ ...state });
    const value = this.value;
    for (const listener of [...this.listeners]) {
      // A listener may destroy the reader or unsubscribe another registration.
      if (this.value !== value) break;
      if (this.listeners.has(listener)) this.call(listener, value);
    }
    if (this.value.status === "destroyed") this.listeners.clear();
  }
}
