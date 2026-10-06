import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const API = 'http://127.0.0.1:8311';
// `npm run phone` serves over HTTPS on your Wi-Fi: phones only allow the camera on secure pages.
const PHONE = process.env.GARAGE_PHONE === '1';

export default defineConfig({
  root: 'web',
  plugins: [react(), ...(PHONE ? [basicSsl()] : [])],
  server: {
    port: PHONE ? 4312 : 4311,
    host: PHONE ? '0.0.0.0' : 'localhost',
    strictPort: true,
    // The browser only talks to this server; it forwards API calls and your files to the local Python API.
    proxy: { '/api': API, '/media': API },
  },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
});
