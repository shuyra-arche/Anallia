import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        reader: new URL("./reader-frame.html", import.meta.url).pathname,
        comparison: new URL("./dev/multi-reader.html", import.meta.url)
          .pathname,
      },
    },
  },
});
