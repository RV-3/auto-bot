// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward any request starting with "/status" to the Flask server
      '/status': {
        target: 'http://localhost:8080',    // Flask backend
        changeOrigin: true,                 // Make it appear as if request is from target
        secure: false                       // If target was https (not needed for http)
        // (No rewrite needed since we want to keep the same path)
      },
      // You can add more proxies for other API paths as needed:
      // '/api': { target: 'http://localhost:8080', changeOrigin: true }
    }
  }
});
