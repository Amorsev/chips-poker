import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Public dev tunnels (CloudPub, ngrok, etc.) send their own Host header.
    // Leading dots allow every subdomain, so the tunnel URL can change without
    // editing this file again.
    allowedHosts: ['.cloudpub.ru'],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 800
  }
});
