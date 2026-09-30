import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The agent window, bundled for Tauri to load from `dist` (task `111`). */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: { outDir: 'dist', emptyOutDir: true, target: 'safari16' },
});
