import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // vendor 单独分包：业务改动不失效 DCDN/浏览器缓存
        manualChunks: {
          vendor: ['antd', 'react', 'react-dom'],
        },
      },
    },
  },
});
