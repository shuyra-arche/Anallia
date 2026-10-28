/** Minimal HMR type; Vite provides the runtime when present. */
interface ImportMeta {
  readonly hot?: { dispose(callback: () => void): void };
}
