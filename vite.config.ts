import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    // No fixed port: `npm run dev` picks a free one (or takes the launcher's
    // `PORT`) and tells Tauri the same one as its devUrl, so it must hold.
    port: Number(process.env.PORT) || 0,
    strictPort: Boolean(process.env.PORT),
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'safari15', chunkSizeWarningLimit: 4000 },
});
