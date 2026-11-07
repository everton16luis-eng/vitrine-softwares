import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Em desenvolvimento a API do painel roda em 127.0.0.1:4300 (mesma origem via proxy: o cookie
// SameSite=Strict e o CSRF funcionam igual à produção, em que o painel serve este build).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': { target: process.env.PANEL_URL ?? 'http://127.0.0.1:4300', changeOrigin: false } } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 1200 }
});
