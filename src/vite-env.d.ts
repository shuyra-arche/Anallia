/** Vite runtime fields used by the entry point. */
interface ImportMeta {
  readonly env: { readonly DEV: boolean };
  readonly hot?: { dispose(callback: () => void): void };
}
