import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Node resolves "localhost" to the IPv6 loopback (::1) first. On machines where
// IPv6 loopback connections are refused (seen here as EACCES), a dev server bound
// only to ::1 is unreachable from the browser. Bind and proxy over IPv4 instead.
// Set VITE_DEV_HOST=0.0.0.0 to open the dev server to phones on the same network.
const devHost = process.env.VITE_DEV_HOST || '127.0.0.1';
const apiTarget = process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: devHost,
    port: 5173,
    strictPort: true,
    // Public dev tunnels (CloudPub, ngrok, etc.) send their own Host header.
    // Leading dots allow every subdomain, so the tunnel URL can change without
    // editing this file again.
    allowedHosts: ['.cloudpub.ru'],
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      },
      '/uploads': {
        target: apiTarget,
        changeOrigin: true
      },
      '/socket.io': {
        target: apiTarget,
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
