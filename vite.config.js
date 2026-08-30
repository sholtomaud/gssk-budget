import { defineConfig } from 'vite';

// Static output only. There is no backend and there never will be (§1), so the
// build is a set of files a static host serves — no SSR, no adapter, no
// serverless anything. `--base ./` is passed by the npm script so the bundle
// works under a GitHub Pages project path.
export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: { target: 'es2023', outDir: 'dist', emptyOutDir: true },
});
